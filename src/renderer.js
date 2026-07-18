/**
 * IPMI GUI - 主渲染进程
 */

const { ipcRenderer } = require('electron');
const { Terminal } = require('xterm');
const { FitAddon } = require('@xterm/addon-fit');
const { SerializeAddon } = require('@xterm/addon-serialize');

// 导入模块
const { loadConfig, saveConfig, getConfig } = require('./modules/configStore');
const { safeAlert, safeConfirm } = require('./modules/modal');
const { showStatus, clearOutput, isValidIP } = require('./modules/utils');
const { SERVER_TEMPLATES, applyTemplate, updateServerNameFromTemplate } = require('./modules/templates');
const { executeCommand, executePower, executeSensor, executeRawCommand } = require('./modules/commandRunner');
const favorites = require('./modules/favorites');

// ========== 全局状态 ==========
let terminal = null;
let fitAddon = null;
let serializeAddon = null;
let _currentServer = null;
let editingServerId = null;
let solRunning = false;

// getter 函数，确保始终获取最新值
function getCurrentServer() { return _currentServer; }
function setCurrentServer(server) { _currentServer = server; }

// ========== 初始化 ==========

document.addEventListener('DOMContentLoaded', () => {
  loadConfig();
  updateServerList();
  favorites.loadFavorites();
  bindEvents();
  bindKeyboardShortcuts();
  initTerminal();

  // SOL IPC 监听
  ipcRenderer.on('sol:data', (event, data) => {
    if (terminal) terminal.write(data);
  });

  ipcRenderer.on('sol:exit', (event, code) => {
    solRunning = false;
    showStatus('disconnected', `SOL 已退出 (代码: ${code})`);
    document.getElementById('btn-sol-start').disabled = false;
  });
});

// ========== 终端 ==========

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
    scrollback: 10000
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
      if (fd && fd.style.display === 'flex') favorites.closeDialog();
      else if (sd && sd.style.display === 'flex') closeDialog();
    }
  });
}

function refreshCurrentPanel() {
  const t = document.querySelector('.tab.active');
  if (!t) return;
  const tab = t.dataset.tab;
  const server = getCurrentServer();
  if (tab === 'power') executePower('status', server);
  else if (tab === 'sensor') executeSensor(server);
  else if (tab === 'fru') executeCommand('fru list', 'output-fru', server);
  else if (tab === 'sel') executeCommand('sel list', 'output-sel', server);
  else if (tab === 'user') executeCommand('user list', 'output-user', server);
  else if (tab === 'network') executeCommand('lan print', 'output-network', server);
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
  // 选项卡
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

  // 服务器选择
  document.getElementById('server-select').addEventListener('change', (e) => {
    const servers = getConfig().servers || [];
    const server = servers.find(s => s.id === e.target.value) || null;
    setCurrentServer(server);
    showStatus(server ? 'connected' : 'idle', server ? server.name : '未选择服务器');
  });

  // 服务器管理按钮
  document.getElementById('btn-add-server').addEventListener('click', () => openDialog());
  document.getElementById('btn-edit-server').addEventListener('click', () => { const s = getCurrentServer(); if (s) openDialog(s); });
  document.getElementById('btn-delete-server').addEventListener('click', deleteServer);
  document.getElementById('btn-test-connection').addEventListener('click', testConnection);
  document.getElementById('btn-import-config').addEventListener('click', importConfig);
  document.getElementById('btn-export-config').addEventListener('click', exportConfig);

  // SOL 按钮
  document.getElementById('btn-sol-start').addEventListener('click', startSol);
  document.getElementById('btn-sol-stop').addEventListener('click', stopSol);
  document.getElementById('btn-sol-save').addEventListener('click', saveSolLog);
  document.getElementById('btn-sol-logdir').addEventListener('click', selectLogDir);
  document.getElementById('btn-sol-clear').addEventListener('click', () => { if (terminal) terminal.clear(); });

  // 收藏夹按钮
  document.getElementById('btn-add-favorite').addEventListener('click', () => favorites.openDialog());
  document.getElementById('btn-exec-favorite').addEventListener('click', () => favorites.executeSelected(getCurrentServer()));
  document.getElementById('btn-edit-favorite').addEventListener('click', () => favorites.editSelected());
  document.getElementById('btn-delete-favorite').addEventListener('click', () => favorites.deleteSelected());
  document.getElementById('btn-move-up').addEventListener('click', () => favorites.move(-1));
  document.getElementById('btn-move-down').addEventListener('click', () => favorites.move(1));

  // 原始命令
  document.getElementById('raw-command').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') executeRawCommand(getCurrentServer());
  });

  // 日志目录
  updateLogDirDisplay();
}

// ========== 服务器管理 ==========

function updateServerList() {
  const select = document.getElementById('server-select');
  select.innerHTML = '<option value="">-- 选择服务器 --</option>';
  const servers = getConfig().servers || [];
  servers.forEach(server => {
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
  let name = document.getElementById('server-name').value.trim();
  const host = document.getElementById('server-host').value.trim();
  const port = parseInt(document.getElementById('server-port').value) || 623;
  const username = document.getElementById('server-username').value.trim();
  const password = document.getElementById('server-password').value;
  const templateId = document.getElementById('server-template').value;

  if (!host) { await safeAlert('请填写 IP 地址'); return; }
  if (!isValidIP(host)) { await safeAlert('IP 地址格式不正确\n\n示例: 192.168.1.100'); return; }
  if (!username || !password) { await safeAlert('请填写用户名和密码'); return; }

  if (!name) {
    if (templateId && SERVER_TEMPLATES[templateId]) {
      name = SERVER_TEMPLATES[templateId].name + '-' + host;
    } else {
      name = host;
    }
  }

  const config = getConfig();
  const duplicate = config.servers.find(s => s.host === host && s.port === port && s.id !== editingServerId);
  if (duplicate) {
    await safeAlert('IP 地址重复!\n\n' + host + ':' + port + ' 已存在服务器 "' + duplicate.name + '"');
    return;
  }

  const serverData = {
    id: editingServerId || Date.now().toString(),
    name, host, port, username, password,
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

  saveConfig();
  updateServerList();
  closeDialog();
  document.getElementById('server-select').value = serverData.id;
  setCurrentServer(serverData);
  showStatus('connected', serverData.name);
}

async function deleteServer() {
  const server = getCurrentServer();
  if (!server) { await safeAlert('请先选择服务器'); return; }
  const ok = await safeConfirm('确定删除服务器 "' + server.name + '" 吗?');
  if (!ok) return;

  const config = getConfig();
  config.servers = config.servers.filter(s => s.id !== server.id);
  saveConfig();
  updateServerList();
  setCurrentServer(null);
  showStatus('idle', '未选择服务器');
}

// ========== 连接测试 ==========

async function testConnection() {
  const server = getCurrentServer();
  if (!server) { await safeAlert('请先选择服务器'); return; }
  const btn = document.getElementById('btn-test-connection');
  btn.classList.add('loading');
  showStatus('connecting', '正在测试连接...');
  try {
    const result = await ipcRenderer.invoke('ipmi:execute', server, 'raw 6 1');
    if (result.code === 0 && result.stdout.trim()) {
      showStatus('connected', server.name + ' - 连接正常');
      await safeAlert('连接测试成功!\n\n服务器: ' + server.name + '\nIP: ' + server.host + '\n\n响应: ' + result.stdout.trim());
    } else {
      showStatus('error', server.name + ' - 连接失败');
      await safeAlert('连接测试失败!\n\n服务器: ' + server.name + '\nIP: ' + server.host + '\n\n错误: ' + (result.stderr || '无响应'));
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
  const config = getConfig();
  if (!config.servers || config.servers.length === 0) { await safeAlert('没有可导出的服务器配置'); return; }
  const exportData = { exportTime: new Date().toISOString(), version: '1.0', servers: config.servers };
  const content = JSON.stringify(exportData, null, 2);
  const defaultPath = require('path').join(process.env.USERPROFILE || process.env.HOME, 'Desktop', 'ipmi_servers_' + new Date().toISOString().slice(0, 10) + '.json');
  const result = await ipcRenderer.invoke('file:save', defaultPath, content);
  if (result.success) showStatus('connected', '配置已导出');
}

async function importConfig() {
  const filePath = await ipcRenderer.invoke('dialog:selectFile', [{ name: 'JSON 文件', extensions: ['json'] }, { name: '所有文件', extensions: ['*'] }]);
  if (!filePath) return;
  try {
    const content = require('fs').readFileSync(filePath, 'utf-8');
    const importData = JSON.parse(content);
    if (!importData.servers || !Array.isArray(importData.servers)) { await safeAlert('无效的配置文件格式'); return; }
    const validServers = importData.servers.filter(s => s.name && s.host);
    if (validServers.length === 0) { await safeAlert('配置文件中没有有效的服务器'); return; }
    const ok = await safeConfirm('找到 ' + validServers.length + ' 个服务器配置。\n\n点击"确定"合并到现有配置\n点击"取消"放弃导入');
    if (!ok) return;
    const config = getConfig();
    let imported = 0;
    for (const server of validServers) {
      if (!config.servers.some(s => s.host === server.host && s.name === server.name)) {
        server.id = server.id || Date.now().toString() + Math.random().toString(36).slice(2, 6);
        config.servers.push(server);
        imported++;
      }
    }
    saveConfig();
    updateServerList();
    showStatus('connected', '已导入 ' + imported + ' 个服务器');
  } catch (err) {
    await safeAlert('导入失败: ' + err.message);
  }
}

// ========== SOL 操作 ==========

async function startSol() {
  const server = getCurrentServer();
  if (!server) { await safeAlert('请先选择服务器'); return; }
  initTerminal();
  const btn = document.getElementById('btn-sol-start');
  btn.classList.add('loading');
  showStatus('connecting', '正在连接...');
  try {
    const result = await ipcRenderer.invoke('sol:start', server);
    if (result.success) {
      solRunning = true;
      showStatus('connected', server.name);
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
  const server = getCurrentServer();
  if (!server) { await safeAlert('请先选择服务器'); return; }
  const btn = document.getElementById('btn-sol-stop');
  btn.classList.add('loading');
  try {
    const result = await ipcRenderer.invoke('sol:stop', server);
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
  const server = getCurrentServer();
  const serverName = server ? server.host : 'unknown';
  const defaultPath = require('path').join(getLogDir(), 'sol_' + serverName + '_' + timestamp + '.log');
  const result = await ipcRenderer.invoke('file:save', defaultPath, content);
  if (result.success) {
    const config = getConfig();
    config.settings = config.settings || {};
    config.settings.lastSaveDir = require('path').dirname(result.path);
    saveConfig();
    showStatus('connected', '日志已保存');
  }
}

// ========== 日志目录 ==========

function getLogDir() {
  return getConfig().settings?.lastSaveDir || require('path').join(process.env.USERPROFILE || process.env.HOME, 'Desktop');
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
    const config = getConfig();
    config.settings = config.settings || {};
    config.settings.lastSaveDir = selectedDir;
    saveConfig();
    updateLogDirDisplay();
    showStatus('connected', '日志目录已更新');
  }
}

// ========== 导出给 HTML 使用 ==========
window.applyTemplate = applyTemplate;
window.updateServerNameFromTemplate = updateServerNameFromTemplate;
window.openDialog = openDialog;
window.closeDialog = closeDialog;
window.saveServer = saveServer;
window.selectFavorite = favorites.select;
window.executeFavorite = (index) => favorites.execute(index, getCurrentServer());
window.closeFavDialog = favorites.closeDialog;
window.saveFavorite = favorites.save;
window.updateServerList = updateServerList;
window.executeCommand = (cmd, id) => executeCommand(cmd, id, getCurrentServer());
window.executePower = (action) => executePower(action, getCurrentServer());
window.executeSensor = () => executeSensor(getCurrentServer());
window.executeRawCommand = () => executeRawCommand(getCurrentServer());
window.clearOutput = clearOutput;
