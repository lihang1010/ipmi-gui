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
const { escapeHtml, showStatus, clearOutput, isValidIP } = require('./modules/utils');
const { SERVER_TEMPLATES, applyTemplate, updateServerNameFromTemplate } = require('./modules/templates');
const { executeCommand, executePower, executeSensor, executeRawCommand } = require('./modules/commandRunner');
const favorites = require('./modules/favorites');
const scanner = require('./modules/networkScanner');
const { renderScanResultRow } = require('./modules/scanResultView');

// ========== 全局状态 ==========
let _currentServer = null;
let editingServerId = null;

// SOL 多标签管理
let solTabs = [];  // [{id, name, server, terminal, fitAddon, serializeAddon, ptyPid, isRunning, logFile}]
let activeTabId = null;
let tabCounter = 0;

// getter 函数
function getCurrentServer() { return _currentServer; }
function setCurrentServer(server) { _currentServer = server; }
function getActiveTab() { return solTabs.find(t => t.id === activeTabId) || null; }

// ========== 初始化 ==========

document.addEventListener('DOMContentLoaded', () => {
  loadConfig();
  updateServerList();
  favorites.loadFavorites();
  bindEvents();
  bindKeyboardShortcuts();
  initScan();
  initMemoryMonitor();

  // SOL IPC 监听
  ipcRenderer.on('sol:data', (event, { tabId, data }) => {
    const tab = solTabs.find(t => t.id === tabId);
    if (tab && tab.terminal) tab.terminal.write(data);
  });

  ipcRenderer.on('sol:exit', (event, { tabId, exitCode }) => {
    const tab = solTabs.find(t => t.id === tabId);
    if (tab) {
      tab.isRunning = false;
      tab.ptyPid = null;
      updateSolTabStatus(tab.id, 'stopped');
    }
    showStatus('disconnected', `SOL 已退出 (代码: ${exitCode})`);
    updateSolButtons();
  });
});

// ========== 终端 ==========

// ========== SOL 多标签管理 ==========

function createTerminal(container) {
  const term = new Terminal({
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

  const fit = new FitAddon();
  const serialize = new SerializeAddon();
  term.loadAddon(fit);
  term.loadAddon(serialize);
  term.open(container);
  fit.fit();

  term.onData((data) => {
    const tab = getActiveTab();
    if (tab && tab.isRunning) {
      ipcRenderer.send('sol:write', tab.id, data);
    }
  });

  term.writeln('\x1b[38;2;91;155;213m  IPMI SOL 终端\x1b[0m');
  term.writeln('\x1b[38;2;107;107;117m  点击 [启动 SOL] 连接到服务器\x1b[0m');

  return { terminal: term, fitAddon: fit, serializeAddon: serialize };
}

function addSolTab(server = null) {
  tabCounter++;
  const tabId = `sol-${tabCounter}`;
  const tabName = server ? `SOL-${tabCounter}: ${server.host}` : `SOL-${tabCounter}`;

  // 创建终端容器
  const pane = document.createElement('div');
  pane.className = 'sol-terminal-pane';
  pane.id = `pane-${tabId}`;
  document.getElementById('sol-terminals').appendChild(pane);

  // 创建终端
  const { terminal, fitAddon, serializeAddon } = createTerminal(pane);

  // 创建标签数据
  const tabData = {
    id: tabId,
    name: tabName,
    server: server,
    terminal: terminal,
    fitAddon: fitAddon,
    serializeAddon: serializeAddon,
    ptyPid: null,
    isRunning: false,
    logFile: null
  };

  solTabs.push(tabData);
  renderSolTabs();
  switchSolTab(tabId);

  return tabData;
}

function renderSolTabs() {
  const list = document.getElementById('sol-tab-list');
  list.innerHTML = solTabs.map(tab => `
    <div class="sol-tab ${tab.id === activeTabId ? 'active' : ''}" data-tab-id="${tab.id}">
      <span class="sol-tab-name">${tab.name}</span>
      <button class="sol-tab-close" onclick="event.stopPropagation(); closeSolTab('${tab.id}')">&times;</button>
    </div>
  `).join('');

  // 绑定点击事件
  list.querySelectorAll('.sol-tab').forEach(el => {
    el.addEventListener('click', () => switchSolTab(el.dataset.tabId));
  });

  // 更新按钮状态
  updateSolButtons();
}

function switchSolTab(tabId) {
  // 隐藏所有面板
  document.querySelectorAll('.sol-terminal-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sol-tab').forEach(t => t.classList.remove('active'));

  // 显示选中的面板
  const pane = document.getElementById(`pane-${tabId}`);
  if (pane) {
    pane.classList.add('active');
    activeTabId = tabId;

    // 更新标签样式
    const tabEl = document.querySelector(`.sol-tab[data-tab-id="${tabId}"]`);
    if (tabEl) tabEl.classList.add('active');

    // 重新 fit 终端
    const tab = getActiveTab();
    if (tab && tab.fitAddon) {
      setTimeout(() => tab.fitAddon.fit(), 50);
      tab.terminal.focus();
    }
  }

  updateSolButtons();
}

function closeSolTab(tabId) {
  const tabIndex = solTabs.findIndex(t => t.id === tabId);
  if (tabIndex === -1) return;

  const tab = solTabs[tabIndex];

  // 释放主进程中的 PTY 并 deactivate 会话，避免关闭标签后进程泄漏
  ipcRenderer.invoke('sol:close', tab.id, tab.server || null).catch(() => {});

  // 销毁终端
  tab.terminal.dispose();

  // 移除面板
  const pane = document.getElementById(`pane-${tabId}`);
  if (pane) pane.remove();

  // 从数组中移除
  solTabs.splice(tabIndex, 1);

  // 如果关闭的是当前标签，切换到其他标签
  if (activeTabId === tabId) {
    if (solTabs.length > 0) {
      const newIndex = Math.min(tabIndex, solTabs.length - 1);
      switchSolTab(solTabs[newIndex].id);
    } else {
      activeTabId = null;
    }
  }

  renderSolTabs();
}

function updateSolButtons() {
  // 所有按钮始终可用
  document.getElementById('btn-sol-start').disabled = false;
  document.getElementById('btn-sol-stop').disabled = false;
}

function updateSolTabStatus(tabId, status) {
  const tab = solTabs.find(t => t.id === tabId);
  if (!tab) return;

  const tabEl = document.querySelector(`.sol-tab[data-tab-id="${tabId}"] .sol-tab-name`);
  if (tabEl) {
    const icon = status === 'running' ? '●' : status === 'stopped' ? '○' : '';
    tabEl.textContent = tab.name + (icon ? ' ' + icon : '');
  }
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
      // batch-delete dialog is dynamically created, handled inside the dialog
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
  if (tab === 'sol') {
    const activeTab = getActiveTab();
    if (activeTab && activeTab.terminal) activeTab.terminal.clear();
  } else {
    clearOutput('output-' + tab);
  }
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
        setTimeout(() => {
          const activeTab = getActiveTab();
          if (activeTab && activeTab.fitAddon) activeTab.fitAddon.fit();
        }, 100);
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
  document.getElementById('btn-batch-delete').addEventListener('click', batchDeleteServer);
  document.getElementById('btn-test-connection').addEventListener('click', testConnection);
  document.getElementById('btn-import-config').addEventListener('click', importConfig);
  document.getElementById('btn-export-config').addEventListener('click', exportConfig);

  // SOL 按钮
  document.getElementById('btn-sol-start').addEventListener('click', startSol);
  document.getElementById('btn-sol-stop').addEventListener('click', stopSol);
  document.getElementById('btn-sol-save').addEventListener('click', saveSolLog);
  document.getElementById('btn-sol-logdir').addEventListener('click', selectLogDir);
  document.getElementById('btn-sol-clear').addEventListener('click', () => {
    const activeTab = getActiveTab();
    if (activeTab && activeTab.terminal) activeTab.terminal.clear();
  });
  document.getElementById('btn-sol-new-tab').addEventListener('click', () => addSolTab());

  // 收藏夹按钮
  document.getElementById('btn-add-favorite').addEventListener('click', () => favorites.openDialog());
  document.getElementById('btn-exec-favorite').addEventListener('click', () => favorites.executeSelected(getCurrentServer()));
  document.getElementById('btn-edit-favorite').addEventListener('click', () => favorites.editSelected());
  document.getElementById('btn-delete-favorite').addEventListener('click', () => favorites.deleteSelected());
  document.getElementById('btn-move-up').addEventListener('click', () => favorites.move(-1));
  document.getElementById('btn-move-down').addEventListener('click', () => favorites.move(1));

  // 电源按钮
  document.getElementById('btn-power-status').addEventListener('click', () => executePower('status', getCurrentServer()));
  document.getElementById('btn-power-on').addEventListener('click', () => executePower('on', getCurrentServer()));
  document.getElementById('btn-power-off').addEventListener('click', () => executePower('off', getCurrentServer()));
  document.getElementById('btn-power-cycle').addEventListener('click', () => executePower('cycle', getCurrentServer()));

  // 传感器按钮
  document.getElementById('btn-sensor-refresh').addEventListener('click', () => executeSensor(getCurrentServer()));

  // FRU 按钮
  document.getElementById('btn-fru-refresh').addEventListener('click', () => executeCommand('fru list', 'output-fru', getCurrentServer()));

  // SEL 按钮
  document.getElementById('btn-sel-refresh').addEventListener('click', () => executeCommand('sel list', 'output-sel', getCurrentServer()));
  document.getElementById('btn-sel-info').addEventListener('click', () => executeCommand('sel info', 'output-sel', getCurrentServer()));

  // 用户按钮
  document.getElementById('btn-user-refresh').addEventListener('click', () => executeCommand('user list', 'output-user', getCurrentServer()));

  // 网络按钮
  document.getElementById('btn-network-refresh').addEventListener('click', () => executeCommand('lan print', 'output-network', getCurrentServer()));

  // 原始命令按钮
  document.getElementById('btn-raw-execute').addEventListener('click', () => executeRawCommand(getCurrentServer()));
  document.getElementById('raw-command').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') executeRawCommand(getCurrentServer());
  });

  // 清屏按钮（通用）
  document.querySelectorAll('.btn-clear').forEach(btn => {
    btn.addEventListener('click', () => clearOutput(btn.dataset.target));
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
  const activeTab = getActiveTab();
  if (activeTab && activeTab.terminal) activeTab.terminal.blur();
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

async function batchDeleteServer() {
  try {
    const config = getConfig();
    const servers = config.servers || [];

    if (servers.length === 0) {
      await safeAlert('没有可删除的服务器');
      return;
    }

    const listHtml = servers.map(s =>
      '<label class="batch-delete-item">' +
        '<input type="checkbox" class="bd-cb" value="' + s.id + '">' +
        '<span class="bd-name">' + escapeHtml(s.name) + '</span>' +
        '<span class="bd-host">' + escapeHtml(s.host) + '</span>' +
      '</label>'
    ).join('');

    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.style.zIndex = '99999';

    overlay.innerHTML =
      '<div class="dialog" style="width:520px">' +
        '<div class="dialog-header">' +
          '<h3>批量删除服务器</h3>' +
          '<button class="dialog-close" id="bd-close">&times;</button>' +
        '</div>' +
        '<div class="dialog-body" style="padding:var(--space-md) var(--space-lg);max-height:50vh;overflow-y:auto;">' +
          '<div style="margin-bottom:12px;display:flex;align-items:center;gap:10px;padding:0 4px;">' +
            '<label style="font-size:12px;color:var(--text-secondary);cursor:pointer;display:flex;align-items:center;gap:6px;">' +
              '<input type="checkbox" id="bd-select-all"> 全选' +
            '</label>' +
            '<span style="font-size:12px;color:var(--text-muted);">共 ' + servers.length + ' 台服务器</span>' +
          '</div>' +
          '<div class="batch-delete-list">' + listHtml + '</div>' +
        '</div>' +
        '<div class="dialog-footer">' +
          '<button class="btn" id="bd-cancel">取消</button>' +
          '<button class="btn btn-danger" id="bd-confirm" disabled>删除选中 (<span id="bd-count">0</span>)</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    const cbs = overlay.querySelectorAll('.bd-cb');
    const selAll = document.getElementById('bd-select-all');
    const countSpan = document.getElementById('bd-count');
    const confirmBtn = document.getElementById('bd-confirm');

    const updateCount = () => {
      const checked = overlay.querySelectorAll('.bd-cb:checked').length;
      countSpan.textContent = checked;
      confirmBtn.disabled = checked === 0;
      if (selAll) selAll.checked = checked === cbs.length;
    };

    const closeOverlay = () => overlay.remove();

    selAll.addEventListener('change', () => {
      cbs.forEach(cb => cb.checked = selAll.checked);
      updateCount();
    });

    cbs.forEach(cb => cb.addEventListener('change', updateCount));
    document.getElementById('bd-close').addEventListener('click', closeOverlay);
    document.getElementById('bd-cancel').addEventListener('click', closeOverlay);

    confirmBtn.addEventListener('click', async () => {
      const selected = [...overlay.querySelectorAll('.bd-cb:checked')].map(cb => cb.value);
      if (selected.length === 0) return;
      closeOverlay();

      const ok = await safeConfirm('确定删除选中的 ' + selected.length + ' 台服务器吗？\n\n此操作不可撤销！');
      if (!ok) return;

      const cfg = getConfig();
      cfg.servers = cfg.servers.filter(s => !selected.includes(s.id));
      saveConfig();
      updateServerList();

      const cur = getCurrentServer();
      if (cur && selected.includes(cur.id)) {
        setCurrentServer(null);
        showStatus('idle', '未选择服务器');
      }

      showStatus('connected', '已删除 ' + selected.length + ' 台服务器');
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeOverlay();
    });

    const onKeydown = (e) => {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', onKeydown);
        closeOverlay();
      }
    };
    document.addEventListener('keydown', onKeydown);

    updateCount();
  } catch (e) {
    console.error('batchDeleteServer error:', e);
    await safeAlert('操作失败: ' + e.message);
  }
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

  // 创建新标签
  const tab = addSolTab(server);

  const btn = document.getElementById('btn-sol-start');
  btn.classList.add('loading');
  showStatus('connecting', '正在连接...');

  try {
    const result = await ipcRenderer.invoke('sol:start', server, tab.id);
    if (result.success) {
      tab.isRunning = true;
      tab.ptyPid = result.pid;
      showStatus('connected', server.name);
      updateSolTabStatus(tab.id, 'running');
      updateSolButtons();
      tab.terminal.focus();
    } else {
      showStatus('error', '连接失败');
      await safeAlert('启动 SOL 失败:\n' + result.error);
    }
  } finally {
    btn.classList.remove('loading');
  }
}

async function stopSol() {
  const tab = getActiveTab();
  if (!tab || !tab.server) { await safeAlert('请先选择服务器'); return; }

  const ok = await safeConfirm(`确定停止 SOL 吗？\n\n服务器: ${tab.server.name}\nIP: ${tab.server.host}`);
  if (!ok) return;

  const btn = document.getElementById('btn-sol-stop');
  btn.classList.add('loading');

  try {
    const result = await ipcRenderer.invoke('sol:stop', tab.server);
    if (result.success) {
      tab.isRunning = false;
      tab.ptyPid = null;
      showStatus('idle', 'SOL 已停止');
      updateSolTabStatus(tab.id, 'stopped');
      updateSolButtons();
    } else {
      showStatus('error', '停止失败');
      await safeAlert('停止 SOL 失败:\n' + (result.stderr || result.error || '未知错误'));
    }
  } finally {
    btn.classList.remove('loading');
  }
}

async function saveSolLog() {
  const tab = getActiveTab();
  if (!tab || !tab.serializeAddon) { await safeAlert('终端未初始化'); return; }

  const content = tab.serializeAddon.serialize();
  const now = new Date();
  const utc8 = new Date(now.getTime() + (8 * 60 * 60 * 1000));
  const timestamp = utc8.toISOString().replace(/[:.]/g, '-').slice(0, 19).replace('T', '_');
  const serverName = tab.server ? tab.server.host : 'unknown';
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

// ========== 网络扫描 ==========

let scanResults = [];
// 扫描列表重绘限流状态
let lastScanRenderAt = 0;
let lastScanRenderPhase = '';

function initScan() {
  // 自动填充本机网段
  const local = scanner.getLocalNetwork();
  if (local) {
    document.getElementById('scan-subnet').value = local.subnet;
  }

  // 绑定事件
  document.getElementById('btn-scan-start').addEventListener('click', startScan);
  document.getElementById('btn-scan-stop').addEventListener('click', stopScan);
  document.getElementById('btn-scan-select-all').addEventListener('click', selectAllScanResults);
  document.getElementById('btn-scan-deselect-all').addEventListener('click', deselectAllScanResults);
  document.getElementById('btn-scan-add-selected').addEventListener('click', addSelectedScanResults);
  document.getElementById('btn-scan-export').addEventListener('click', exportScanResults);
}

// ========== 内存监控 ==========

let memoryMonitorInterval = null;

function initMemoryMonitor() {
  updateMemoryInfo();
  // 每 5 秒刷新一次
  memoryMonitorInterval = setInterval(updateMemoryInfo, 5000);
}

async function updateMemoryInfo() {
  try {
    const mem = await ipcRenderer.invoke('app:getMemory');
    const el = document.getElementById('memory-info');
    if (!el) return;

    el.textContent = `${mem.rss} MB`;

    // 根据内存使用量设置警告级别
    el.classList.remove('warning', 'critical');
    if (mem.rss > 500) {
      el.classList.add('critical');
    } else if (mem.rss > 300) {
      el.classList.add('warning');
    }

    el.title = `物理内存: ${mem.rss} MB\n堆内存: ${mem.heapUsed}/${mem.heapTotal} MB\n外部内存: ${mem.external} MB`;
  } catch (e) {
    // 静默失败
  }
}

function startScan() {
  const subnet = document.getElementById('scan-subnet').value.trim();
  const cidr = parseInt(document.getElementById('scan-cidr').value) || 24;
  const timeout = parseInt(document.getElementById('scan-timeout').value) || 200;

  if (!subnet || !subnet.match(/^\d+\.\d+\.\d+$/)) {
    safeAlert('请输入有效的网段，如 192.168.1.0');
    return;
  }

  const network = subnet.split('.').slice(0, 3).join('.');
  if (!isValidIP(network + '.1')) {
    safeAlert('网段格式不正确，每段需在 0-255 之间\n\n示例: 192.168.1.0');
    return;
  }

  // 按 CIDR 展开待扫描主机（/24 ~ /30，低于 /24 按 /24 处理）
  const hosts = scanner.cidrToHosts(network, cidr);

  // 更新UI状态
  document.getElementById('btn-scan-start').disabled = true;
  document.getElementById('btn-scan-stop').disabled = false;
  document.getElementById('scan-results').innerHTML = '';
  scanResults = [];
  lastScanRenderAt = 0;
  lastScanRenderPhase = '';

  // 开始扫描
  scanner.fullScan(network, {
    hosts,
    pingConcurrency: 50,
    pingTimeout: timeout,
    portConcurrency: 20,
    portTimeout: timeout,
    onProgress: (info) => updateScanProgress(info)
  }).then(results => {
    scanResults = results;
    renderScanResults(results);
    document.getElementById('btn-scan-start').disabled = false;
    document.getElementById('btn-scan-stop').disabled = true;
    document.getElementById('scan-phase').textContent = '扫描完成';
    document.getElementById('scan-progress-bar').style.width = '100%';
  });
}

function stopScan() {
  scanner.stopScan();
  document.getElementById('btn-scan-start').disabled = false;
  document.getElementById('btn-scan-stop').disabled = true;
  document.getElementById('scan-phase').textContent = '已停止';
}

function updateScanProgress(info) {
  const { phase, current, total, found } = info;
  const percent = Math.round((current / total) * 100);

  const phaseText = phase === 'ping' ? 'Ping 扫描中...' : phase === 'port' ? '端口扫描中...' : 'IPMI 验证中...';
  document.getElementById('scan-phase').textContent = phaseText;
  document.getElementById('scan-progress-bar').style.width = percent + '%';
  document.getElementById('scan-progress-text').textContent = `${current}/${total}`;
  document.getElementById('scan-found-count').textContent = `发现: ${found.length}台`;

  // 列表重绘限流（阶段切换立即刷新，其余最多 400ms 一次），
  // 避免每台设备回调都重建整个列表
  const now = Date.now();
  if (phase !== lastScanRenderPhase || now - lastScanRenderAt >= 400) {
    lastScanRenderPhase = phase;
    lastScanRenderAt = now;
    renderScanResults(found);
  }
}

function renderScanResults(results) {
  const container = document.getElementById('scan-results');
  const config = getConfig();
  const existingIPs = (config.servers || []).map(s => s.host);

  if (results.length === 0) {
    container.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:40px;">未发现设备</div>';
    bindScanResultEvents();
    return;
  }

  // 保留用户已勾选状态，避免进度刷新重绘时丢失
  const checkedIPs = [...container.querySelectorAll('.scan-checkbox:checked')].map(cb => cb.value);

  container.innerHTML = results
    .map(item => renderScanResultRow(item, { existingIPs, checkedIPs }))
    .join('');

  bindScanResultEvents();
  updateScanButtons();
}

/**
 * 绑定扫描结果的委托事件（只绑定一次）
 * - change: 勾选框变化时刷新"批量添加"按钮状态
 * - click:  行内"添加"按钮（替代原内联 onclick，避免注入）
 */
function bindScanResultEvents() {
  const container = document.getElementById('scan-results');
  if (!container || !container.dataset) return;
  if (container.dataset.scanBound === '1') return;
  container.dataset.scanBound = '1';

  container.addEventListener('change', (e) => {
    const target = e.target;
    if (target && target.classList && target.classList.contains('scan-checkbox')) {
      updateScanButtons();
    }
  });

  container.addEventListener('click', (e) => {
    const target = e.target;
    const btn = target && target.closest ? target.closest('.scan-add-btn') : null;
    if (!btn || btn.disabled) return;
    addSingleScanResult(btn.dataset.ip, btn.dataset.template);
  });
}

function updateScanButtons() {
  const checkboxes = document.querySelectorAll('.scan-checkbox:checked');
  const btn = document.getElementById('btn-scan-add-selected');
  btn.disabled = checkboxes.length === 0;
}

function selectAllScanResults() {
  const checkboxes = document.querySelectorAll('.scan-checkbox:not(:disabled)');
  checkboxes.forEach(cb => { cb.checked = true; });
  updateScanButtons();
}

function deselectAllScanResults() {
  document.querySelectorAll('.scan-checkbox').forEach(cb => { cb.checked = false; });
  updateScanButtons();
}

async function addSingleScanResult(ip, templateName) {
  const config = getConfig();

  // 从配置文件读取凭证
  let credentialTemplates;
  try {
    credentialTemplates = require('../config/ipmi-credentials.json').templates;
  } catch (e) {
    credentialTemplates = [
      { name: 'AMI', username: 'admin', password: 'admin' },
      { name: 'openUBMC', username: 'Administrator', password: 'ttytty`12' },
      { name: 'OpenBMC', username: 'root', password: '0penBmc' }
    ];
  }

  // 转换为以名称为键的对象
  const templates = {};
  credentialTemplates.forEach(t => { templates[t.name] = t; });

  const template = templates[templateName] || templates['openUBMC'];

  const server = {
    id: Date.now().toString(),
    name: ip,
    host: ip,
    port: 623,
    username: template.username,
    password: template.password,
    interface: 'lanplus',
    cipherSuite: 17,
    privilegeLevel: 'ADMINISTRATOR'
  };

  config.servers.push(server);
  saveConfig();
  updateServerList();
  await safeAlert(`已添加服务器: ${ip}\n模板: ${templateName || '默认'}`);
  renderScanResults(scanResults);
}

async function addSelectedScanResults() {
  const checkboxes = document.querySelectorAll('.scan-checkbox:checked');
  if (checkboxes.length === 0) {
    await safeAlert('请先选择要添加的设备');
    return;
  }

  // 从配置文件读取凭证
  let credentialTemplates;
  try {
    credentialTemplates = require('../config/ipmi-credentials.json').templates;
  } catch (e) {
    credentialTemplates = [
      { name: 'AMI', username: 'admin', password: 'admin' },
      { name: 'openUBMC', username: 'Administrator', password: 'ttytty`12' },
      { name: 'OpenBMC', username: 'root', password: '0penBmc' }
    ];
  }

  // 转换为以名称为键的对象
  const templates = {};
  credentialTemplates.forEach(t => { templates[t.name] = t; });

  const config = getConfig();
  let added = 0;

  checkboxes.forEach(cb => {
    const ip = cb.value;
    if (!config.servers.some(s => s.host === ip)) {
      // 从扫描结果中获取模板信息
      const result = scanResults.find(r => r.ip === ip);
      const templateName = result ? result.template : null;
      const template = templates[templateName] || templates['openUBMC'];

      config.servers.push({
        id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
        name: ip,
        host: ip,
        port: 623,
        username: template.username,
        password: template.password,
        interface: 'lanplus',
        cipherSuite: 17,
        privilegeLevel: 'ADMINISTRATOR'
      });
      added++;
    }
  });

  saveConfig();
  updateServerList();
  await safeAlert(`已添加 ${added} 台服务器`);
  renderScanResults(scanResults);
}

async function exportScanResults() {
  if (scanResults.length === 0) {
    await safeAlert('没有可导出的结果');
    return;
  }

  const exportData = {
    scanTime: new Date().toISOString(),
    results: scanResults.map(item => ({
      ip: typeof item === 'string' ? item : item.ip,
      latency: typeof item === 'object' ? item.latency : 0
    }))
  };

  const content = JSON.stringify(exportData, null, 2);
  const defaultPath = require('path').join(
    process.env.USERPROFILE || process.env.HOME,
    'Desktop',
    `ipmi_scan_${new Date().toISOString().slice(0, 10)}.json`
  );

  const result = await ipcRenderer.invoke('file:save', defaultPath, content);
  if (result.success) {
    showStatus('connected', '扫描结果已导出');
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
window.batchDeleteServer = batchDeleteServer;
window.updateServerList = updateServerList;
