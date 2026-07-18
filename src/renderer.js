// 渲染进程脚本
const { ipcRenderer } = require('electron');
const { Terminal } = require('xterm');
const { FitAddon } = require('@xterm/addon-fit');
const { SerializeAddon } = require('@xterm/addon-serialize');
const path = require('path');
const fs = require('fs');

// 全局变量
let terminal = null;
let fitAddon = null;
let serializeAddon = null;
let config = { servers: [], settings: {} };
let currentServer = null;
let editingServerId = null;
let solRunning = false;

// 配置文件路径
const configPath = path.join(
  process.env.APPDATA || process.env.HOME,
  'ipmi-gui',
  'config.json'
);

// 加载配置
function loadConfig() {
  try {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch (e) {
    console.error('加载配置失败:', e);
  }
  return { servers: [], settings: {} };
}

// 保存配置
function saveConfigToFile() {
  try {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (e) {
    console.error('保存配置失败:', e);
  }
}

// ========== 自定义弹窗（替代 alert/confirm）==========

function showModal({ title = '提示', message = '', type = 'alert', onConfirm = null }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.style.zIndex = '99999';

    const isConfirm = type === 'confirm';

    overlay.innerHTML = `
      <div class="dialog" style="width:360px">
        <div class="dialog-header">
          <h3>${escapeHtml(title)}</h3>
        </div>
        <div class="dialog-body">
          <p style="color:var(--text-secondary);line-height:1.6;white-space:pre-wrap">${escapeHtml(message)}</p>
        </div>
        <div class="dialog-footer">
          ${isConfirm ? '<button class="btn" id="modal-cancel">取消</button>' : ''}
          <button class="btn btn-primary" id="modal-ok">确定</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const okBtn = overlay.querySelector('#modal-ok');
    const cancelBtn = overlay.querySelector('#modal-cancel');

    const close = (result) => {
      overlay.remove();
      resolve(result);
    };

    okBtn.addEventListener('click', () => close(true));
    if (cancelBtn) cancelBtn.addEventListener('click', () => close(false));

    // 点击遮罩关闭
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(isConfirm ? false : true);
    });

    // ESC 关闭
    const onKeydown = (e) => {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', onKeydown);
        close(isConfirm ? false : true);
      }
    };
    document.addEventListener('keydown', onKeydown);

    setTimeout(() => okBtn.focus(), 50);
  });
}

async function safeAlert(msg) {
  await showModal({ message: msg });
}

async function safeConfirm(msg) {
  return await showModal({ message: msg, type: 'confirm' });
}

// ========== 工具函数 ==========

function resetFocus() {
  if (document.activeElement) {
    document.activeElement.blur();
  }
  if (terminal) terminal.blur();
  document.body.focus();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showStatus(state = 'idle', text = '') {
  const badge = document.getElementById('status-text');
  badge.className = 'status-badge';
  if (state === 'connected') badge.classList.add('connected');
  else if (state === 'error') badge.classList.add('error');
  badge.textContent = text || '未连接';
}

function clearOutput(elementId) {
  const el = document.getElementById(elementId);
  if (el) {
    const defaults = {
      'output-power': '点击按钮执行命令...',
      'output-sensor': '点击刷新获取传感器数据...',
      'output-fru': '点击刷新获取 FRU 信息...',
      'output-sel': '点击刷新获取事件日志...',
      'output-user': '点击刷新获取用户列表...',
      'output-network': '点击刷新获取网络配置...',
      'output-raw': '输入命令并点击执行...'
    };
    el.textContent = defaults[elementId] || '';
  }
}

// ========== 初始化 ==========

document.addEventListener('DOMContentLoaded', () => {
  config = loadConfig();
  updateServerList();
  bindEvents();
  bindKeyboardShortcuts();

  ipcRenderer.on('sol:data', (event, data) => {
    if (terminal) terminal.write(data);
  });

  ipcRenderer.on('sol:exit', (event, code) => {
    solRunning = false;
    showStatus('disconnected', `SOL 已退出 (代码: ${code})`);
    document.getElementById('btn-sol-start').disabled = false;
  });
});

function initTerminal() {
  if (terminal) return;

  terminal = new Terminal({
    theme: {
      background: '#0d0d10',
      foreground: '#d4d4d8',
      cursor: '#e4e4e8',
      cursorAccent: '#0d0d10',
      selectionBackground: 'rgba(91, 155, 213, 0.3)',
      selectionForeground: '#ffffff'
    },
    fontFamily: "'Cascadia Code', 'JetBrains Mono', 'Fira Code', Consolas, monospace",
    fontSize: 14,
    lineHeight: 1.3,
    cursorBlink: true,
    cursorStyle: 'bar',
    scrollback: 10000,
    allowProposedApi: true
  });

  fitAddon = new FitAddon();
  serializeAddon = new SerializeAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(serializeAddon);
  terminal.open(document.getElementById('terminal'));
  fitAddon.fit();

  document.getElementById('terminal').addEventListener('click', () => terminal.focus());

  terminal.onData((data) => {
    if (solRunning) ipcRenderer.send('sol:write', data);
  });

  window.addEventListener('resize', () => { if (fitAddon) fitAddon.fit(); });

  terminal.writeln('\x1b[38;2;91;155;213m  IPMI SOL 终端\x1b[0m');
  terminal.writeln('\x1b[38;2;107;107;117m  点击 [启动 SOL] 连接到服务器\x1b[0m');
}

// ========== 键盘快捷键 ==========

function bindKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'r') { e.preventDefault(); refreshCurrentPanel(); }
    if (e.ctrlKey && e.key === 'l') { e.preventDefault(); clearCurrentPanel(); }
    if (e.ctrlKey && e.key === 'n') { e.preventDefault(); openDialog(); }
    if (e.key === 'Escape') {
      const fd = document.getElementById('favorite-dialog');
      const sd = document.getElementById('server-dialog');
      if (fd.style.display === 'flex') closeFavDialog();
      else if (sd.style.display === 'flex') closeDialog();
    }
  });
}

function refreshCurrentPanel() {
  const t = document.querySelector('.tab.active');
  if (!t) return;
  const tab = t.dataset.tab;
  if (tab === 'power') executePower('status');
  else if (tab === 'sensor') executeSensor();
  else if (tab === 'fru') executeCommand('fru list', 'output-fru');
  else if (tab === 'sel') executeCommand('sel list', 'output-sel');
  else if (tab === 'user') executeCommand('user list', 'output-user');
  else if (tab === 'network') executeCommand('lan print', 'output-network');
}

function clearCurrentPanel() {
  const t = document.querySelector('.tab.active');
  if (!t) return;
  const tab = t.dataset.tab;
  if (tab === 'sol') { if (terminal) terminal.clear(); }
  else clearOutput('output-' + tab);
}

// ========== 事件绑定 ==========

function bindEvents() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
      if (tab.dataset.tab === 'sol') {
        initTerminal();
        setTimeout(() => { if (fitAddon) fitAddon.fit(); }, 100);
      }
    });
  });

  document.getElementById('server-select').addEventListener('change', (e) => {
    currentServer = config.servers.find(s => s.id === e.target.value) || null;
    showStatus(currentServer ? 'connected' : 'idle', currentServer ? currentServer.name : '未选择服务器');
  });

  document.getElementById('btn-add-server').addEventListener('click', () => openDialog());
  document.getElementById('btn-edit-server').addEventListener('click', () => { if (currentServer) openDialog(currentServer); });
  document.getElementById('btn-delete-server').addEventListener('click', deleteServer);
  document.getElementById('btn-test-connection').addEventListener('click', testConnection);
  document.getElementById('btn-import-config').addEventListener('click', importConfig);
  document.getElementById('btn-export-config').addEventListener('click', exportConfig);

  document.getElementById('btn-sol-start').addEventListener('click', startSol);
  document.getElementById('btn-sol-stop').addEventListener('click', stopSol);
  document.getElementById('btn-sol-save').addEventListener('click', saveSolLog);
  document.getElementById('btn-sol-logdir').addEventListener('click', selectLogDir);
  document.getElementById('btn-sol-clear').addEventListener('click', () => { if (terminal) terminal.clear(); });

  document.getElementById('btn-add-favorite').addEventListener('click', () => openFavDialog());
  document.getElementById('btn-exec-favorite').addEventListener('click', executeSelectedFavorite);
  document.getElementById('btn-edit-favorite').addEventListener('click', editSelectedFavorite);
  document.getElementById('btn-delete-favorite').addEventListener('click', deleteSelectedFavorite);
  document.getElementById('btn-move-up').addEventListener('click', () => moveFavorite(-1));
  document.getElementById('btn-move-down').addEventListener('click', () => moveFavorite(1));

  document.getElementById('raw-command').addEventListener('keypress', (e) => { if (e.key === 'Enter') executeRawCommand(); });

  // IP 输入时自动更新服务器名称（如果有模板）
  document.getElementById('server-host').addEventListener('input', updateServerNameFromTemplate);

  updateLogDirDisplay();
  loadFavorites();
  initTerminal();
}

// ========== 服务器模板 ==========

const SERVER_TEMPLATES = {
  openubmc: {
    name: 'openUBMC',
    username: 'Administrator',
    password: 'ttytty`12',
    interface: 'lanplus',
    cipherSuite: 17
  },
  ami: {
    name: 'AMI',
    username: 'admin',
    password: 'admin',
    interface: 'lanplus',
    cipherSuite: 17
  },
  openbmc: {
    name: 'OpenBMC',
    username: 'root',
    password: '0penBmc',
    interface: 'lanplus',
    cipherSuite: 17
  }
};

function applyTemplate() {
  const templateId = document.getElementById('server-template').value;
  if (!templateId) return;

  const template = SERVER_TEMPLATES[templateId];
  if (!template) return;

  document.getElementById('server-username').value = template.username;
  document.getElementById('server-password').value = template.password;
  document.getElementById('server-interface').value = template.interface;
  document.getElementById('server-cipher').value = template.cipherSuite;

  // 自动填充名称: 模板名-IP地址
  updateServerNameFromTemplate();
}

function updateServerNameFromTemplate() {
  const templateId = document.getElementById('server-template').value;
  const host = document.getElementById('server-host').value.trim();
  const nameInput = document.getElementById('server-name');

  if (!templateId || !host) return;

  const template = SERVER_TEMPLATES[templateId];
  if (!template) return;

  // 名称格式: 模板名-IP地址
  nameInput.value = template.name + '-' + host;
}

// ========== 服务器管理 ==========

function updateServerList() {
  const select = document.getElementById('server-select');
  select.innerHTML = '<option value="">-- 选择服务器 --</option>';
  config.servers.forEach(server => {
    const opt = document.createElement('option');
    opt.value = server.id;
    opt.textContent = server.name + ' (' + server.host + ')';
    select.appendChild(opt);
  });
}

function openDialog(server = null) {
  editingServerId = server ? server.id : null;
  document.getElementById('dialog-title').textContent = server ? '编辑服务器' : '添加服务器';
  document.getElementById('server-template').value = '';
  document.getElementById('server-name').value = server ? server.name : '';
  document.getElementById('server-host').value = server ? server.host : '';
  document.getElementById('server-port').value = server ? (server.port || 623) : 623;
  document.getElementById('server-username').value = server ? server.username : '';
  document.getElementById('server-password').value = server ? server.password : '';
  document.getElementById('server-interface').value = server ? (server.interface || 'lanplus') : 'lanplus';
  document.getElementById('server-cipher').value = server ? (server.cipherSuite || 17) : 17;
  if (terminal) terminal.blur();
  document.getElementById('server-dialog').style.display = 'flex';
  setTimeout(() => document.getElementById('server-name').focus(), 50);
}

function closeDialog() {
  document.getElementById('server-dialog').style.display = 'none';
  editingServerId = null;
}

async function saveServer() {
  const name = document.getElementById('server-name').value.trim();
  const host = document.getElementById('server-host').value.trim();
  const port = parseInt(document.getElementById('server-port').value) || 623;

  if (!name || !host) { await safeAlert('请填写名称和IP地址'); return; }

  // 检查重复 IP（排除自身）
  const duplicate = config.servers.find(s =>
    s.host === host &&
    s.port === port &&
    s.id !== editingServerId
  );
  if (duplicate) {
    await safeAlert('IP 地址重复!\n\n' + host + ':' + port + ' 已存在服务器 "' + duplicate.name + '"');
    return;
  }

  const serverData = {
    id: editingServerId || Date.now().toString(),
    name, host, port,
    username: document.getElementById('server-username').value.trim(),
    password: document.getElementById('server-password').value,
    interface: document.getElementById('server-interface').value,
    cipherSuite: parseInt(document.getElementById('server-cipher').value) || 17,
    privilegeLevel: 'ADMINISTRATOR'
  };

  if (editingServerId) {
    const i = config.servers.findIndex(s => s.id === editingServerId);
    if (i !== -1) config.servers[i] = serverData;
  } else {
    config.servers.push(serverData);
  }

  saveConfigToFile();
  updateServerList();
  closeDialog();
  document.getElementById('server-select').value = serverData.id;
  currentServer = serverData;
  showStatus('connected', serverData.name);
}

async function deleteServer() {
  if (!currentServer) { await safeAlert('请先选择服务器'); return; }
  const ok = await safeConfirm('确定删除服务器 "' + currentServer.name + '" 吗?');
  if (!ok) return;
  config.servers = config.servers.filter(s => s.id !== currentServer.id);
  saveConfigToFile();
  updateServerList();
  currentServer = null;
  showStatus('idle', '未选择服务器');
}

// ========== 连接测试 ==========

async function testConnection() {
  if (!currentServer) { await safeAlert('请先选择服务器'); return; }
  const btn = document.getElementById('btn-test-connection');
  btn.classList.add('loading');
  showStatus('connecting', '正在测试连接...');
  try {
    const result = await ipcRenderer.invoke('ipmi:execute', currentServer, 'raw 6 1');
    if (result.code === 0 && result.stdout.trim()) {
      showStatus('connected', currentServer.name + ' - 连接正常');
      await safeAlert('连接测试成功!\n\n服务器: ' + currentServer.name + '\nIP: ' + currentServer.host + '\n\n响应: ' + result.stdout.trim());
    } else {
      showStatus('error', currentServer.name + ' - 连接失败');
      await safeAlert('连接测试失败!\n\n服务器: ' + currentServer.name + '\nIP: ' + currentServer.host + '\n\n错误: ' + (result.stderr || '无响应'));
    }
  } catch (err) {
    showStatus('error', '测试异常');
    await safeAlert('连接测试异常: ' + err.message);
  } finally {
    btn.classList.remove('loading');
  }
}

// ========== 导入导出 ==========

async function exportConfig() {
  if (!config.servers || config.servers.length === 0) { await safeAlert('没有可导出的服务器配置'); return; }
  const exportData = { exportTime: new Date().toISOString(), version: '1.0', servers: config.servers };
  const content = JSON.stringify(exportData, null, 2);
  const defaultPath = path.join(process.env.USERPROFILE || process.env.HOME, 'Desktop', 'ipmi_servers_' + new Date().toISOString().slice(0, 10) + '.json');
  const result = await ipcRenderer.invoke('file:save', defaultPath, content);
  if (result.success) showStatus('connected', '配置已导出');
}

async function importConfig() {
  const filePath = await ipcRenderer.invoke('dialog:selectFile', [{ name: 'JSON 文件', extensions: ['json'] }, { name: '所有文件', extensions: ['*'] }]);
  if (!filePath) return;
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const importData = JSON.parse(content);
    if (!importData.servers || !Array.isArray(importData.servers)) { await safeAlert('无效的配置文件格式'); return; }
    const validServers = importData.servers.filter(s => s.name && s.host);
    if (validServers.length === 0) { await safeAlert('配置文件中没有有效的服务器'); return; }
    const ok = await safeConfirm('找到 ' + validServers.length + ' 个服务器配置。\n\n点击"确定"合并到现有配置\n点击"取消"放弃导入');
    if (!ok) return;
    let imported = 0;
    for (const server of validServers) {
      if (!config.servers.some(s => s.host === server.host && s.name === server.name)) {
        server.id = server.id || Date.now().toString() + Math.random().toString(36).slice(2, 6);
        config.servers.push(server);
        imported++;
      }
    }
    saveConfigToFile();
    updateServerList();
    showStatus('connected', '已导入 ' + imported + ' 个服务器');
  } catch (err) {
    await safeAlert('导入失败: ' + err.message);
  }
}

// ========== SOL 操作 ==========

async function startSol() {
  if (!currentServer) { await safeAlert('请先选择服务器'); return; }
  initTerminal();
  const btn = document.getElementById('btn-sol-start');
  btn.classList.add('loading');
  showStatus('connecting', '正在连接...');
  try {
    const result = await ipcRenderer.invoke('sol:start', currentServer);
    if (result.success) {
      solRunning = true;
      showStatus('connected', currentServer.name);
      document.getElementById('btn-sol-start').disabled = true;
      terminal.focus();
    } else {
      showStatus('error', '连接失败');
      await safeAlert('启动 SOL 失败:\n' + result.error);
    }
  } finally {
    btn.classList.remove('loading');
  }
}

async function stopSol() {
  if (!currentServer) { await safeAlert('请先选择服务器'); return; }
  const btn = document.getElementById('btn-sol-stop');
  btn.classList.add('loading');
  try {
    const result = await ipcRenderer.invoke('sol:stop', currentServer);
    if (result.success) {
      solRunning = false;
      showStatus('idle', 'SOL 已停止');
      document.getElementById('btn-sol-start').disabled = false;
    } else {
      showStatus('error', '停止失败');
      await safeAlert('停止 SOL 失败:\n' + (result.stderr || result.error || '未知错误'));
    }
  } finally {
    btn.classList.remove('loading');
  }
}

async function saveSolLog() {
  if (!serializeAddon) { await safeAlert('终端未初始化'); return; }
  const content = serializeAddon.serialize();
  const now = new Date();
  const utc8 = new Date(now.getTime() + (8 * 60 * 60 * 1000));
  const timestamp = utc8.toISOString().replace(/[:.]/g, '-').slice(0, 19).replace('T', '_');
  const serverName = currentServer ? currentServer.host : 'unknown';
  const defaultPath = path.join(getLogDir(), 'sol_' + serverName + '_' + timestamp + '.log');
  const result = await ipcRenderer.invoke('file:save', defaultPath, content);
  if (result.success) {
    config.settings = config.settings || {};
    config.settings.lastSaveDir = path.dirname(result.path);
    saveConfigToFile();
    showStatus('connected', '日志已保存');
  }
}

// ========== 日志目录 ==========

function getLogDir() {
  return config.settings?.lastSaveDir || path.join(process.env.USERPROFILE || process.env.HOME, 'Desktop');
}

function updateLogDirDisplay() {
  const el = document.getElementById('sol-logdir-text');
  if (el) {
    el.textContent = getLogDir();
    el.title = getLogDir();
  }
}

async function selectLogDir() {
  const selectedDir = await ipcRenderer.invoke('dialog:selectDirectory');
  if (selectedDir) {
    config.settings = config.settings || {};
    config.settings.lastSaveDir = selectedDir;
    saveConfigToFile();
    updateLogDirDisplay();
    showStatus('connected', '日志目录已更新');
  }
}

// ========== 收藏夹 ==========

let favorites = [];
let selectedFavIndex = -1;
let editingFavIndex = -1;

function loadFavorites() {
  favorites = config.favorites || [];
  renderFavorites();
}

function saveFavorites() {
  config.favorites = favorites;
  saveConfigToFile();
}

function renderFavorites() {
  const list = document.getElementById('favorites-list');
  if (favorites.length === 0) {
    list.innerHTML = '<div class="favorites-empty"><div class="favorites-empty-icon">+</div><div>暂无收藏</div><div style="font-size:12px">点击"添加收藏"按钮添加常用命令</div></div>';
    return;
  }
  list.innerHTML = favorites.map((fav, i) =>
    '<div class="favorite-item ' + (i === selectedFavIndex ? 'selected' : '') + '" onclick="selectFavorite(' + i + ')" ondblclick="executeFavorite(' + i + ')">' +
    '<div class="fav-icon">></div><div class="fav-info"><div class="fav-name">' + escapeHtml(fav.name) + '</div><div class="fav-command">' + escapeHtml(fav.command) + '</div></div></div>'
  ).join('');
}

function selectFavorite(index) {
  selectedFavIndex = index;
  renderFavorites();
  updateFavoriteButtons();
  const fav = favorites[index];
  document.getElementById('favorites-preview').textContent = '命令: ' + fav.command + (fav.desc ? '\n描述: ' + fav.desc : '');
}

function updateFavoriteButtons() {
  const has = selectedFavIndex >= 0;
  document.getElementById('btn-exec-favorite').disabled = !has;
  document.getElementById('btn-edit-favorite').disabled = !has;
  document.getElementById('btn-delete-favorite').disabled = !has;
  document.getElementById('btn-move-up').disabled = !has || selectedFavIndex === 0;
  document.getElementById('btn-move-down').disabled = !has || selectedFavIndex === favorites.length - 1;
}

function openFavDialog(fav = null, index = -1) {
  editingFavIndex = index;
  document.getElementById('fav-dialog-title').textContent = fav ? '编辑收藏' : '添加收藏';
  document.getElementById('fav-name').value = fav ? fav.name : '';
  document.getElementById('fav-command').value = fav ? fav.command : '';
  document.getElementById('fav-desc').value = fav ? (fav.desc || '') : '';
  if (terminal) terminal.blur();
  document.getElementById('favorite-dialog').style.display = 'flex';
  setTimeout(() => document.getElementById('fav-name').focus(), 50);
}

function closeFavDialog() {
  document.getElementById('favorite-dialog').style.display = 'none';
  editingFavIndex = -1;
}

async function saveFavorite() {
  const name = document.getElementById('fav-name').value.trim();
  const command = document.getElementById('fav-command').value.trim();
  const desc = document.getElementById('fav-desc').value.trim();
  if (!name || !command) { await safeAlert('请填写名称和命令'); return; }
  if (editingFavIndex >= 0) favorites[editingFavIndex] = { name, command, desc };
  else favorites.push({ name, command, desc });
  saveFavorites();
  renderFavorites();
  closeFavDialog();
}

function editSelectedFavorite() {
  if (selectedFavIndex >= 0) openFavDialog(favorites[selectedFavIndex], selectedFavIndex);
}

async function deleteSelectedFavorite() {
  if (selectedFavIndex < 0) return;
  const fav = favorites[selectedFavIndex];
  const ok = await safeConfirm('确定删除收藏 "' + fav.name + '" 吗?');
  if (!ok) return;
  favorites.splice(selectedFavIndex, 1);
  selectedFavIndex = -1;
  saveFavorites();
  renderFavorites();
  updateFavoriteButtons();
}

function executeSelectedFavorite() {
  if (selectedFavIndex >= 0) executeFavorite(selectedFavIndex);
}

async function executeFavorite(index) {
  if (!currentServer) { await safeAlert('请先选择服务器'); return; }
  const fav = favorites[index];
  if (!fav) return;
  showStatus('connecting', '执行: ' + fav.name + '...');
  try {
    const result = await ipcRenderer.invoke('ipmi:execute', currentServer, fav.command);
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

function moveFavorite(dir) {
  if (selectedFavIndex < 0) return;
  const ni = selectedFavIndex + dir;
  if (ni < 0 || ni >= favorites.length) return;
  [favorites[selectedFavIndex], favorites[ni]] = [favorites[ni], favorites[selectedFavIndex]];
  selectedFavIndex = ni;
  saveFavorites();
  renderFavorites();
  updateFavoriteButtons();
}

// ========== 命令执行 ==========

async function executeCommand(command, outputId) {
  if (!currentServer) { await safeAlert('请先选择服务器'); return; }
  const el = document.getElementById(outputId);
  el.textContent = '执行中...';
  el.style.opacity = '0.5';
  try {
    const result = await ipcRenderer.invoke('ipmi:execute', currentServer, command);
    el.textContent = result.code === 0 ? (result.stdout || '(无输出)') : '错误:\n' + result.stderr;
    el.style.opacity = '1';
  } catch (err) {
    el.textContent = '执行异常: ' + err.message;
    el.style.opacity = '1';
  }
}

function executePower(action) { executeCommand('power ' + action, 'output-power'); }
function executeSensor() { executeCommand('sdr list', 'output-sensor'); }

async function executeRawCommand() {
  const command = document.getElementById('raw-command').value.trim();
  if (!command) { await safeAlert('请输入命令'); return; }
  executeCommand(command, 'output-raw');
}
