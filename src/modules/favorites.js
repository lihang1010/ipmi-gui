/**
 * 收藏夹模块
 *
 * 收藏项结构: { name, command, desc, category }
 * - category 取值见 FAVORITE_CATEGORIES，空字符串表示"通用"
 * - 分类筛选、导入解析、去重合并均为纯函数，便于单元测试
 */

const { ipcRenderer } = require('electron');
const path = require('path');
const { safeAlert, safeConfirm } = require('./modal');
const { escapeHtml, showStatus } = require('./utils');
const { getConfig, saveConfig } = require('./configStore');

// 收藏命令分类（新增分类只需在此追加）
const FAVORITE_CATEGORIES = ['AMI', 'openUBMC', 'onetree'];
// 未分类的显示名
const GENERAL_CATEGORY_LABEL = '通用';
// 筛选用的哨兵值（不会与分类名冲突）
const FILTER_ALL = 'all';
const FILTER_GENERAL = 'none';

let favorites = [];
let selectedIndex = -1;
let editingIndex = -1;
let categoryFilter = FILTER_ALL;

// ========== 纯函数 ==========

/**
 * 归一化分类值：非法/缺失一律视为"通用"（空字符串）
 */
function normalizeCategory(value) {
  return FAVORITE_CATEGORIES.indexOf(value) === -1 ? '' : value;
}

/**
 * 分类显示名
 */
function categoryLabel(category) {
  return normalizeCategory(category) || GENERAL_CATEGORY_LABEL;
}

/**
 * 按分类筛选收藏
 * @param {Array} list 收藏列表
 * @param {string} filter FILTER_ALL / FILTER_GENERAL / 具体分类名
 */
function filterFavorites(list, filter) {
  if (!filter || filter === FILTER_ALL) return list;
  if (filter === FILTER_GENERAL) {
    return list.filter(fav => !normalizeCategory(fav.category));
  }
  return list.filter(fav => normalizeCategory(fav.category) === filter);
}

/**
 * 生成分类下拉框的 option HTML
 * @param {boolean} includeAll true 生成筛选用（含"全部"/"通用"），false 生成表单用
 */
function buildCategoryOptions(includeAll) {
  const options = [];
  if (includeAll) {
    options.push('<option value="' + FILTER_ALL + '">全部</option>');
    options.push('<option value="' + FILTER_GENERAL + '">' + GENERAL_CATEGORY_LABEL + '</option>');
  } else {
    options.push('<option value="">' + GENERAL_CATEGORY_LABEL + '</option>');
  }
  FAVORITE_CATEGORIES.forEach(category => {
    options.push('<option value="' + category + '">' + category + '</option>');
  });
  return options.join('');
}

/**
 * 解析导入文件内容
 * 兼容 { favorites: [...] } 与裸数组两种格式
 * @returns {{ok: true, favorites: Array}|{ok: false, error: string}}
 */
function parseFavoritesFile(content) {
  let data;
  try {
    data = JSON.parse(content);
  } catch (e) {
    return { ok: false, error: '文件不是合法的 JSON' };
  }

  const list = Array.isArray(data) ? data : (data && Array.isArray(data.favorites) ? data.favorites : null);
  if (!list) return { ok: false, error: '未找到 favorites 数组' };

  const valid = list
    .filter(item => item && typeof item.name === 'string' && typeof item.command === 'string')
    .map(item => ({
      name: item.name.trim(),
      command: item.command.trim(),
      desc: typeof item.desc === 'string' ? item.desc : '',
      category: normalizeCategory(item.category)
    }))
    .filter(item => item.name && item.command);

  if (valid.length === 0) {
    return { ok: false, error: '没有有效的收藏项（每项需包含 name 与 command）' };
  }
  return { ok: true, favorites: valid };
}

/**
 * 合并收藏（按 名称 + 命令 + 分类 去重，同名同命令但不同分类视为两条）
 * @returns {{list: Array, added: number}}
 */
function mergeFavorites(existing, incoming) {
  const keyOf = (fav) => fav.name + '\u0000' + fav.command + '\u0000' + normalizeCategory(fav.category);
  const seen = new Set(existing.map(keyOf));
  const list = existing.slice();
  let added = 0;

  incoming.forEach(fav => {
    const key = keyOf(fav);
    if (seen.has(key)) return;
    seen.add(key);
    list.push(fav);
    added++;
  });

  return { list, added };
}

// ========== 列表渲染 ==========

/**
 * 加载收藏夹
 */
function loadFavorites() {
  favorites = getConfig().favorites || [];
  renderCategorySelects();
  render();
}

/**
 * 填充分类下拉框
 */
function renderCategorySelects() {
  const dialogSelect = document.getElementById('fav-category');
  if (dialogSelect) dialogSelect.innerHTML = buildCategoryOptions(false);

  const filterSelect = document.getElementById('fav-category-filter');
  if (filterSelect) filterSelect.innerHTML = buildCategoryOptions(true);
}

/**
 * 保存收藏夹
 */
function saveFavorites() {
  const config = getConfig();
  config.favorites = favorites;
  saveConfig();
}

/**
 * 渲染收藏列表（按当前分类筛选）
 */
function render() {
  const list = document.getElementById('favorites-list');
  if (!list) return;

  if (favorites.length === 0) {
    list.innerHTML = '<div class="favorites-empty"><div class="favorites-empty-icon">+</div><div>暂无收藏</div><div style="font-size:12px">点击"添加收藏"按钮添加常用命令</div></div>';
    updateButtons();
    return;
  }

  const visible = filterFavorites(favorites, categoryFilter);
  if (visible.length === 0) {
    list.innerHTML = '<div class="favorites-empty"><div>当前分类下暂无收藏</div><div style="font-size:12px">切换分类或添加新的收藏</div></div>';
    updateButtons();
    return;
  }

  list.innerHTML = visible.map(fav => {
    const index = favorites.indexOf(fav);
    const category = normalizeCategory(fav.category);
    return '<div class="favorite-item ' + (index === selectedIndex ? 'selected' : '') + '" data-index="' + index + '">' +
      '<div class="fav-icon">></div>' +
      '<div class="fav-info">' +
        '<div class="fav-name">' + escapeHtml(fav.name) + '</div>' +
        '<div class="fav-command">' + escapeHtml(fav.command) + '</div>' +
      '</div>' +
      '<span class="fav-category' + (category ? '' : ' general') + '">' + escapeHtml(categoryLabel(fav.category)) + '</span>' +
    '</div>';
  }).join('');

  // 使用事件委托
  list.onclick = (e) => {
    const item = e.target.closest('.favorite-item');
    if (item) {
      const index = parseInt(item.dataset.index, 10);
      if (e.detail === 2) {
        // 双击执行
        execute(index);
      } else {
        // 单击选中
        select(index);
      }
    }
  };

  updateButtons();
}

/**
 * 选中收藏
 */
function select(index) {
  selectedIndex = index;
  render();
  updateButtons();

  const fav = favorites[index];
  const preview = document.getElementById('favorites-preview');
  if (preview && fav) {
    preview.textContent = '分类: ' + categoryLabel(fav.category) +
      '\n命令: ' + fav.command +
      (fav.desc ? '\n描述: ' + fav.desc : '');
  }
}

/**
 * 切换分类筛选
 */
function setCategoryFilter(value) {
  categoryFilter = value || FILTER_ALL;
  selectedIndex = -1;
  const preview = document.getElementById('favorites-preview');
  if (preview) preview.textContent = '选择收藏的命令查看详情';
  render();
  updateButtons();
}

/**
 * 获取当前分类筛选值
 */
function getCategoryFilter() {
  return categoryFilter;
}

/**
 * 更新按钮状态
 */
function updateButtons() {
  const has = selectedIndex >= 0;
  const btnExec = document.getElementById('btn-exec-favorite');
  const btnEdit = document.getElementById('btn-edit-favorite');
  const btnDelete = document.getElementById('btn-delete-favorite');
  const btnUp = document.getElementById('btn-move-up');
  const btnDown = document.getElementById('btn-move-down');

  if (btnExec) btnExec.disabled = !has;
  if (btnEdit) btnEdit.disabled = !has;
  if (btnDelete) btnDelete.disabled = !has;
  if (btnUp) btnUp.disabled = !has || selectedIndex === 0;
  if (btnDown) btnDown.disabled = !has || selectedIndex === favorites.length - 1;
}

// ========== 编辑 ==========

/**
 * 打开编辑对话框
 */
function openDialog(fav = null, index = -1) {
  editingIndex = index;
  document.getElementById('fav-dialog-title').textContent = fav ? '编辑收藏' : '添加收藏';
  document.getElementById('fav-name').value = fav ? fav.name : '';
  document.getElementById('fav-command').value = fav ? fav.command : '';
  document.getElementById('fav-desc').value = fav ? (fav.desc || '') : '';
  document.getElementById('fav-category').value = fav ? normalizeCategory(fav.category) : '';
  document.getElementById('favorite-dialog').style.display = 'flex';
  setTimeout(() => document.getElementById('fav-name').focus(), 50);
}

/**
 * 关闭编辑对话框
 */
function closeDialog() {
  document.getElementById('favorite-dialog').style.display = 'none';
  editingIndex = -1;
}

/**
 * 保存收藏
 */
async function save() {
  const name = document.getElementById('fav-name').value.trim();
  const command = document.getElementById('fav-command').value.trim();
  const desc = document.getElementById('fav-desc').value.trim();
  const category = normalizeCategory(document.getElementById('fav-category').value);

  if (!name || !command) {
    await safeAlert('请填写名称和命令');
    return;
  }

  if (editingIndex >= 0) {
    favorites[editingIndex] = { name, command, desc, category };
  } else {
    favorites.push({ name, command, desc, category });
  }

  saveFavorites();
  render();
  closeDialog();
}

/**
 * 编辑选中的收藏
 */
function editSelected() {
  if (selectedIndex >= 0) {
    openDialog(favorites[selectedIndex], selectedIndex);
  }
}

/**
 * 删除选中的收藏
 */
async function deleteSelected() {
  if (selectedIndex < 0) return;

  const fav = favorites[selectedIndex];
  const ok = await safeConfirm('确定删除收藏 "' + fav.name + '" 吗?');
  if (!ok) return;

  favorites.splice(selectedIndex, 1);
  selectedIndex = -1;
  saveFavorites();
  render();
  updateButtons();
}

// ========== 执行 ==========

/**
 * 执行选中的收藏
 */
function executeSelected(currentServer) {
  if (selectedIndex >= 0) {
    execute(selectedIndex, currentServer);
  }
}

/**
 * 执行收藏的命令
 */
async function execute(index, currentServer) {
  if (!currentServer) {
    await safeAlert('请先选择服务器');
    return;
  }

  const fav = favorites[index];
  if (!fav) return;

  showStatus('connecting', '执行: ' + fav.name + '...');

  try {
    const result = await ipcRenderer.invoke('ipmi:execute', currentServer, fav.command);

    // 切换到原始命令面板显示结果
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.querySelector('[data-tab="raw"]').classList.add('active');
    document.getElementById('panel-raw').classList.add('active');

    document.getElementById('raw-command').value = fav.command;
    document.getElementById('output-raw').textContent = result.code === 0 ? (result.stdout || '(无输出)') : '错误:\n' + result.stderr;

    showStatus('connected', fav.name + ' 执行完成');
  } catch (err) {
    showStatus('error', '执行失败');
    await safeAlert('执行失败: ' + err.message);
  }
}

/**
 * 移动收藏顺序
 */
function move(dir) {
  if (selectedIndex < 0) return;
  const ni = selectedIndex + dir;
  if (ni < 0 || ni >= favorites.length) return;

  [favorites[selectedIndex], favorites[ni]] = [favorites[ni], favorites[selectedIndex]];
  selectedIndex = ni;
  saveFavorites();
  render();
  updateButtons();
}

// ========== 导入 / 导出 ==========

/**
 * 生成桌面上的默认导出路径
 */
function getDefaultExportPath(prefix) {
  const desktop = path.join(process.env.USERPROFILE || process.env.HOME || '', 'Desktop');
  return path.join(desktop, prefix + '_' + new Date().toISOString().slice(0, 10) + '.json');
}

/**
 * 导出收藏夹
 */
async function exportFavorites() {
  if (favorites.length === 0) {
    await safeAlert('没有可导出的收藏');
    return;
  }

  const payload = {
    exportTime: new Date().toISOString(),
    version: '1.0',
    favorites
  };

  const result = await ipcRenderer.invoke(
    'file:save',
    getDefaultExportPath('ipmi_favorites'),
    JSON.stringify(payload, null, 2),
    [{ name: 'JSON 文件', extensions: ['json'] }, { name: '所有文件', extensions: ['*'] }]
  );

  if (result && result.success) {
    showStatus('connected', '收藏已导出');
  }
}

/**
 * 导入收藏夹（合并，按 名称+命令 去重）
 */
async function importFavorites() {
  const filePath = await ipcRenderer.invoke('dialog:selectFile', [
    { name: 'JSON 文件', extensions: ['json'] },
    { name: '所有文件', extensions: ['*'] }
  ]);
  if (!filePath) return;

  try {
    const content = require('fs').readFileSync(filePath, 'utf-8');
    const parsed = parseFavoritesFile(content);
    if (!parsed.ok) {
      await safeAlert('导入失败: ' + parsed.error);
      return;
    }

    const merged = mergeFavorites(favorites, parsed.favorites);
    const ok = await safeConfirm(
      '文件中找到 ' + parsed.favorites.length + ' 条收藏。\n\n' +
      '点击"确定"合并到现有收藏（新增 ' + merged.added + ' 条，重复 ' +
      (parsed.favorites.length - merged.added) + ' 条将跳过）'
    );
    if (!ok) return;

    favorites = merged.list;
    saveFavorites();
    render();
    updateButtons();
    showStatus('connected', '已导入 ' + merged.added + ' 条收藏');
  } catch (err) {
    await safeAlert('导入失败: ' + err.message);
  }
}

/**
 * 获取当前选中索引
 */
function getSelectedIndex() {
  return selectedIndex;
}

module.exports = {
  FAVORITE_CATEGORIES,
  GENERAL_CATEGORY_LABEL,
  FILTER_ALL,
  FILTER_GENERAL,
  normalizeCategory,
  categoryLabel,
  filterFavorites,
  buildCategoryOptions,
  parseFavoritesFile,
  mergeFavorites,
  loadFavorites,
  saveFavorites,
  render,
  renderCategorySelects,
  select,
  setCategoryFilter,
  getCategoryFilter,
  updateButtons,
  openDialog,
  closeDialog,
  save,
  editSelected,
  deleteSelected,
  executeSelected,
  execute,
  move,
  exportFavorites,
  importFavorites,
  getDefaultExportPath,
  getSelectedIndex
};
