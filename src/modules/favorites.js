/**
 * 收藏夹模块
 */

const { ipcRenderer } = require('electron');
const { safeAlert, safeConfirm } = require('./modal');
const { escapeHtml, showStatus } = require('./utils');
const { getConfig, saveConfig } = require('./configStore');

let favorites = [];
let selectedIndex = -1;
let editingIndex = -1;

/**
 * 加载收藏夹
 */
function loadFavorites() {
  favorites = getConfig().favorites || [];
  render();
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
 * 渲染收藏列表
 */
function render() {
  const list = document.getElementById('favorites-list');
  if (!list) return;

  if (favorites.length === 0) {
    list.innerHTML = '<div class="favorites-empty"><div class="favorites-empty-icon">+</div><div>暂无收藏</div><div style="font-size:12px">点击"添加收藏"按钮添加常用命令</div></div>';
    return;
  }

  list.innerHTML = favorites.map((fav, i) =>
    `<div class="favorite-item ${i === selectedIndex ? 'selected' : ''}" data-index="${i}">
      <div class="fav-icon">></div>
      <div class="fav-info">
        <div class="fav-name">${escapeHtml(fav.name)}</div>
        <div class="fav-command">${escapeHtml(fav.command)}</div>
      </div>
    </div>`
  ).join('');

  // 使用事件委托
  list.onclick = (e) => {
    const item = e.target.closest('.favorite-item');
    if (item) {
      const index = parseInt(item.dataset.index);
      if (e.detail === 2) {
        // 双击执行
        execute(index);
      } else {
        // 单击选中
        select(index);
      }
    }
  };
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
  if (preview) {
    preview.textContent = '命令: ' + fav.command + (fav.desc ? '\n描述: ' + fav.desc : '');
  }
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

/**
 * 打开编辑对话框
 */
function openDialog(fav = null, index = -1) {
  editingIndex = index;
  document.getElementById('fav-dialog-title').textContent = fav ? '编辑收藏' : '添加收藏';
  document.getElementById('fav-name').value = fav ? fav.name : '';
  document.getElementById('fav-command').value = fav ? fav.command : '';
  document.getElementById('fav-desc').value = fav ? (fav.desc || '') : '';
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

  if (!name || !command) {
    await safeAlert('请填写名称和命令');
    return;
  }

  if (editingIndex >= 0) {
    favorites[editingIndex] = { name, command, desc };
  } else {
    favorites.push({ name, command, desc });
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

/**
 * 获取当前选中索引
 */
function getSelectedIndex() {
  return selectedIndex;
}

module.exports = {
  loadFavorites,
  saveFavorites,
  render,
  select,
  updateButtons,
  openDialog,
  closeDialog,
  save,
  editSelected,
  deleteSelected,
  executeSelected,
  execute,
  move,
  getSelectedIndex
};
