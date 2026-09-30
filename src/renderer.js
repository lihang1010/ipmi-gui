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
const { SERVER_TEMPLATES, applyTemplate } = require('./modules/templates');
const { executeCommand, executePower, executeSensor, executeRawCommand } = require('./modules/commandRunner');
const favorites = require('./modules/favorites');
const { renderScanResultRow } = require('./modules/scanResultView');
const { getCredentialByName } = require('./modules/credentials');
const fruView = require('./modules/fruView');
const theme = require('./modules/theme');
const { describeUpdate } = require('./modules/updateStatus');

// ========== 全局状态 ==========
let _currentServer = null;
let editingServerId = null;
/** 当前主题（'dark' | 'light'），由 applyTheme 维护并持久化到 settings.theme */
let currentTheme = theme.DEFAULT_THEME;

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
  // 尽早应用已保存的主题，避免启动时先闪一下默认暗色
  applyTheme(getConfig().settings?.theme);
  updateServerList();
  favorites.loadFavorites();
  bindEvents();
  bindKeyboardShortcuts();
  initScan();
  initMemoryMonitor();

  // 扫描进度（主进程推送）
  ipcRenderer.on('scan:progress', (event, info) => {
    updateScanProgress(info);
  });

  // SOL IPC 监听
  ipcRenderer.on('sol:data', (event, { tabId, data }) => {
    const tab = solTabs.find(t => t.id === tabId);
    if (!tab) return;
    if (tab.terminal) tab.terminal.write(data);
    // 自动保存：写入 PTY 原始流，内容与实时终端一致
    if (tab.logFile) ipcRenderer.send('sol:log-write', tabId, data);
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

  // 自动更新：先主动拉一次状态（主进程推送时窗口可能尚未加载完），再订阅后续变化
  ipcRenderer.invoke('update:getStatus').then(renderUpdateBadge).catch(() => {});
  ipcRenderer.on('update:status', (event, status) => renderUpdateBadge(status));

  // 版本号
  ipcRenderer.invoke('app:getVersion').then(renderVersionBadge).catch(() => {});
});

// ========== 终端 ==========

// ========== SOL 多标签管理 ==========

function createTerminal(container) {
  const term = new Terminal({
    // 终端配色跟随当前主题（见 theme.js 的 TERMINAL_THEMES）
    theme: theme.terminalTheme(currentTheme),
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
  list.innerHTML = solTabs.map(tab =>
    '<div class="sol-tab ' + (tab.id === activeTabId ? 'active' : '') + '" data-tab-id="' + tab.id + '">' +
      '<span class="sol-tab-name">' + escapeHtml(tab.name) + '</span>' +
      '<button class="sol-tab-close" data-tab-close="' + tab.id + '">&times;</button>' +
    '</div>'
  ).join('');

  // 事件委托：关闭按钮与标签切换（不依赖内联 onclick）
  list.onclick = (e) => {
    const closeBtn = e.target.closest ? e.target.closest('.sol-tab-close') : null;
    if (closeBtn) {
      e.stopPropagation();
      closeSolTab(closeBtn.dataset.tabClose);
      return;
    }
    const tabEl = e.target.closest ? e.target.closest('.sol-tab') : null;
    if (tabEl) switchSolTab(tabEl.dataset.tabId);
  };

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

  // 收掉自动保存的日志流（若有）
  stopSolLog(tab).catch(() => {});

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
  else if (tab === 'fru') fruView.refresh();
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

// ========== 主题 ==========

/**
 * 应用主题
 *
 * 做三件事：写 `<html data-theme>`（样式表靠它覆盖 token）、同步所有已打开的
 * SOL 终端配色、刷新按钮文案；`options.persist` 为真时一并写入配置。
 *
 * @param {string} name 主题名，非法值回落到默认主题
 * @param {{persist?: boolean}} [options]
 */
function applyTheme(name, options) {
  const opts = options || {};
  currentTheme = theme.normalizeTheme(name);

  document.documentElement.setAttribute('data-theme', currentTheme);

  // 已打开的 SOL 标签也要换配色，否则终端会和新主题打架
  const palette = theme.terminalTheme(currentTheme);
  solTabs.forEach(tab => {
    if (!tab.terminal) return;
    tab.terminal.options.theme = palette;
    try {
      tab.terminal.refresh(0, tab.terminal.rows - 1);
    } catch (e) {
      // 终端尺寸尚未就绪时 refresh 会抛，忽略即可
    }
  });

  updateThemeButton();

  if (opts.persist) {
    const config = getConfig();
    config.settings = config.settings || {};
    config.settings.theme = currentTheme;
    saveConfig();
  }
}

/** 一键切换亮色 / 暗色，并记住选择 */
function toggleTheme() {
  applyTheme(theme.nextTheme(currentTheme), { persist: true });
}

/** 按钮文案显示当前主题，悬停提示点击后会切到哪个 */
function updateThemeButton() {
  const btn = document.getElementById('btn-theme-toggle');
  if (!btn) return;

  const current = theme.themeLabel(currentTheme);
  const tooltip = '当前：' + current + '主题，点击切换到' + theme.themeLabel(theme.nextTheme(currentTheme));
  btn.textContent = current;
  btn.title = tooltip;
  btn.dataset.tooltip = tooltip;
}

// ========== 自动更新 ==========

/**
 * 渲染顶栏版本徽标
 *
 * 版本号取自主进程的 app.getVersion()（即 package.json 的 version），
 * 与自动更新比对用的基准是同一个来源，不会出现"显示 1.0.0、实际按 1.0.1 比对"的错位。
 * tooltip 顺带带上 Electron 版本，排查环境问题时报这个就够了。
 */
function renderVersionBadge(version) {
  const btn = document.getElementById('app-version');
  if (!btn) return;

  const v = version || '未知';
  const electron = (process.versions && process.versions.electron) || '-';

  btn.textContent = 'v' + v;
  const tooltip = '当前版本 v' + v + '\nElectron ' + electron + '\n点击检查更新';
  btn.title = tooltip;
  btn.dataset.tooltip = tooltip;
}

/** 点击版本号 = 手动检查一次更新 */
async function handleVersionClick() {
  const status = await ipcRenderer.invoke('update:check');
  if (status && status.state === 'skipped') {
    await safeAlert('开发模式（未打包）不检查更新。\n\n' + (status.reason || ''));
  }
}

/** 渲染顶栏更新徽标：文案 / tooltip / 可点击性 / 配色全部由 describeUpdate 决定 */
function renderUpdateBadge(status) {
  const btn = document.getElementById('btn-update');
  if (!btn) return;

  const view = describeUpdate(status);

  btn.style.display = view.hidden ? 'none' : '';
  btn.textContent = view.text;
  btn.title = view.tooltip;
  btn.dataset.tooltip = view.tooltip;
  btn.dataset.actionable = view.actionable ? '1' : '0';
  btn.disabled = !view.actionable;
  btn.className = 'btn btn-sm btn-ghost update-badge' + (view.tone === 'idle' ? '' : ' ' + view.tone);
}

/**
 * 点击更新徽标：可安装就确认后重启安装，否则重试检查
 *
 * 重启会掐断正在跑的 SOL 会话与命令，所以必须由用户明确确认 —— 绝不能自动 quitAndInstall。
 */
async function handleUpdateClick() {
  const btn = document.getElementById('btn-update');
  if (!btn || btn.dataset.actionable !== '1') return;

  const status = await ipcRenderer.invoke('update:getStatus');

  if (status && status.state === 'ready') {
    const ok = await safeConfirm(
      '新版本已下载完成，现在重启并安装？\n\n注意：重启会断开当前所有 SOL 会话。'
    );
    if (!ok) return;

    const result = await ipcRenderer.invoke('update:install');
    if (!result || !result.ok) {
      await safeAlert('启动安装失败：' + ((result && result.error) || '未知错误'));
    }
    return;
  }

  // error 状态下点击 = 重试
  await ipcRenderer.invoke('update:check');
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
      } else if (tab.dataset.tab === 'fru') {
        // 首次切入 FRU 面板时惰性读取一次
        fruView.ensureLoaded();
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

  // 对话框按钮与模板下拉（替代内联 onclick/onchange）
  document.getElementById('server-dialog-close').addEventListener('click', closeDialog);
  document.getElementById('server-cancel').addEventListener('click', closeDialog);
  document.getElementById('server-save').addEventListener('click', saveServer);
  document.getElementById('server-template').addEventListener('change', applyTemplate);
  document.getElementById('fav-dialog-close').addEventListener('click', () => favorites.closeDialog());
  document.getElementById('fav-cancel').addEventListener('click', () => favorites.closeDialog());
  document.getElementById('fav-save').addEventListener('click', () => favorites.save());

  // SOL 按钮
  document.getElementById('btn-sol-start').addEventListener('click', startSol);
  document.getElementById('btn-sol-stop').addEventListener('click', stopSol);
  document.getElementById('btn-sol-save').addEventListener('click', saveSolLog);
  document.getElementById('btn-sol-logdir').addEventListener('click', selectLogDir);

  // 自动保存开关：改完立刻持久化，并同步作用到已在运行的 SOL 标签
  const autoSaveEl = document.getElementById('sol-autosave');
  autoSaveEl.checked = isSolAutoSaveEnabled();
  autoSaveEl.addEventListener('change', () => {
    const config = getConfig();
    config.settings = config.settings || {};
    config.settings.autoSaveSol = autoSaveEl.checked;
    saveConfig();
    // 该设置只在 startSol 时被读取，中途改开关必须显式同步一次：
    // 否则「取消勾选」后当前会话仍会继续往文件里写
    applyAutoSaveToRunningTabs(autoSaveEl.checked);
    showStatus('connected', autoSaveEl.checked ? '已开启日志自动保存' : '已关闭日志自动保存');
  });
  document.getElementById('btn-sol-clear').addEventListener('click', () => {
    const activeTab = getActiveTab();
    if (activeTab && activeTab.terminal) activeTab.terminal.clear();
  });
  document.getElementById('btn-sol-new-tab').addEventListener('click', () => addSolTab());

  // 收藏夹按钮
  document.getElementById('fav-category-filter').addEventListener('change', (e) => favorites.setCategoryFilter(e.target.value));
  document.getElementById('btn-import-favorites').addEventListener('click', () => favorites.importFavorites());
  document.getElementById('btn-export-favorites').addEventListener('click', () => favorites.exportFavorites());
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

  // FRU 面板：刷新 / 导出备份 / 字段编辑的按钮与对话框事件由 fruView 统一绑定
  fruView.initFruPanel({
    getServer: getCurrentServer,
    invoke: (command, args) => ipcRenderer.invoke('ipmi:execute', getCurrentServer(), command, args || []),
    selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),
    selectFile: (filters) => ipcRenderer.invoke('dialog:selectFile', filters),
    alert: safeAlert
  });

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

  // 主题切换
  const themeBtn = document.getElementById('btn-theme-toggle');
  if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

  // 自动更新
  const updateBtn = document.getElementById('btn-update');
  if (updateBtn) updateBtn.addEventListener('click', handleUpdateClick);

  // 版本号：点击手动检查更新
  const versionBtn = document.getElementById('app-version');
  if (versionBtn) versionBtn.addEventListener('click', handleVersionClick);

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
  const result = await ipcRenderer.invoke(
    'file:save',
    defaultPath,
    content,
    [{ name: 'JSON 文件', extensions: ['json'] }, { name: '所有文件', extensions: ['*'] }]
  );
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
      updateSolTabStatus(tab.id, 'running');
      updateSolButtons();
      tab.terminal.focus();

      // PTY 起来之后再开日志流，避免丢掉第一屏输出
      const logging = isSolAutoSaveEnabled() ? await startSolLog(tab) : false;
      showStatus('connected', logging ? server.name + ' · 日志自动保存中' : server.name);
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

/** 是否开启 SOL 自动保存（config.settings.autoSaveSol，默认关闭） */
function isSolAutoSaveEnabled() {
  return getConfig().settings?.autoSaveSol === true;
}

/**
 * 生成 SOL 日志文件名（不含目录）
 *
 * 沿用「保存日志」按钮的命名规则，末尾追加 tabId 片段：多个标签可能连同一台
 * 服务器，不带后缀会互相覆盖。
 *
 * @param {object|null} server
 * @param {string} tabId
 * @param {Date} [now] 便于测试注入
 * @returns {string}
 */
function buildSolLogName(server, tabId, now = new Date()) {
  const utc8 = new Date(now.getTime() + (8 * 60 * 60 * 1000));
  const timestamp = utc8.toISOString().replace(/[:.]/g, '-').slice(0, 19).replace('T', '_');
  const host = (server && server.host) ? server.host : 'unknown';
  // tabId 形如 sol-1；去掉非法字符，避免拼出路径分隔符
  const suffix = String(tabId || 'x').replace(/[^a-zA-Z0-9_-]/g, '').slice(-6) || 'x';
  return `sol_${host}_${timestamp}_${suffix}.log`;
}

/**
 * 为标签开启自动保存：生成路径并让主进程打开写流
 * @returns {Promise<boolean>} 是否成功
 */
async function startSolLog(tab) {
  tab.logFile = null;
  try {
    const filePath = require('path').join(getLogDir(), buildSolLogName(tab.server, tab.id));
    const result = await ipcRenderer.invoke('sol:log-open', tab.id, filePath);
    if (result && result.success) {
      tab.logFile = result.path;
      return true;
    }
  } catch (e) {
    // 落盘失败不该影响 SOL 会话，静默降级为不记录
  }
  return false;
}

/**
 * 关闭标签的日志流
 * @returns {Promise<string|null>} 之前使用的文件路径
 */
async function stopSolLog(tab) {
  if (!tab || !tab.logFile) return null;
  const usedPath = tab.logFile;
  tab.logFile = null;
  try {
    await ipcRenderer.invoke('sol:log-close', tab.id);
  } catch (e) {
    // 主进程不可达时忽略，句柄随进程退出释放
  }
  return usedPath;
}

/**
 * 把自动保存开关同步到已经在运行的 SOL 标签
 *
 * 该设置只在 startSol 时被读取，所以中途改开关必须显式同步一次：
 *   - 关掉：立刻收掉所有正在写的日志流（否则用户以为关了，文件还在长）
 *   - 打开：给正在运行的标签补开日志流，从当前时刻开始记录
 *
 * @param {boolean} enabled
 */
function applyAutoSaveToRunningTabs(enabled) {
  solTabs.forEach(tab => {
    if (!tab.isRunning) return;
    if (enabled && !tab.logFile) {
      startSolLog(tab).catch(() => {});
    } else if (!enabled && tab.logFile) {
      stopSolLog(tab).catch(() => {});
    }
  });
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
// 本次扫描是否启用 Ping 预探测（用于进度文案）
let lastScanUsePing = true;

async function initScan() {
  // 自动填充本机网段（由主进程读取网卡信息）
  try {
    const local = await ipcRenderer.invoke('scan:getLocalNetwork');
    if (local && local.subnet) {
      document.getElementById('scan-subnet').value = local.subnet;
    }
  } catch (e) {
    // 获取失败时留空由用户填写
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

function initMemoryMonitor() {
  updateMemoryInfo();
  // 每 5 秒刷新一次（页面销毁时随渲染进程回收）
  setInterval(updateMemoryInfo, 5000);
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

    // 提示统一走 CSS data-tooltip（多行，右对齐），不再额外设原生 title
    el.dataset.tooltip = `物理内存: ${mem.rss} MB\n堆内存: ${mem.heapUsed}/${mem.heapTotal} MB\n外部内存: ${mem.external} MB`;
  } catch (e) {
    // 静默失败
  }
}

/** 与主进程 networkScanner 的并发设置保持一致（Ping 50 / 端口 20） */
const SCAN_PING_CONCURRENCY = 50;
const SCAN_PORT_CONCURRENCY = 20;

/** 展开后超过这个主机数就先弹确认（约 4 个 /24） */
const SCAN_CONFIRM_THRESHOLD = 1024;

/** 按 CIDR 前缀估算主机数（钳制范围与主进程 cidrToHosts 一致：16 ~ 30） */
function estimateHostCount(cidr) {
  const parsed = parseInt(cidr, 10);
  const bits = Math.min(30, Math.max(16, isNaN(parsed) ? 24 : parsed));
  return Math.max(0, Math.pow(2, 32 - bits) - 2);
}

function formatDuration(ms) {
  if (ms < 1000) return '不到 1 秒';
  const sec = Math.round(ms / 1000);
  if (sec < 60) return '约 ' + sec + ' 秒';
  const min = Math.round(sec / 60);
  if (min < 60) return '约 ' + min + ' 分钟';
  return '约 ' + (min / 60).toFixed(1) + ' 小时';
}

/**
 * 粗估扫描耗时
 * Ping 阶段并发 50，端口阶段并发 20，各加一点进程启动开销
 */
function estimateScanDuration(hostCount, timeout, usePing) {
  const pingMs = usePing
    ? Math.ceil(hostCount / SCAN_PING_CONCURRENCY) * (timeout + 40)
    : 0;
  // 开了 Ping 预探测时通常只有少量主机存活，按 10% 保守估；
  // 跳过 Ping 则每个地址都要扫端口，按全量算
  const portTargets = usePing ? Math.ceil(hostCount * 0.1) : hostCount;
  const portMs = Math.ceil(portTargets / SCAN_PORT_CONCURRENCY) * (timeout + 20);
  return pingMs + portMs;
}

async function startScan() {
  const subnet = document.getElementById('scan-subnet').value.trim();
  const cidr = parseInt(document.getElementById('scan-cidr').value) || 24;
  const timeout = parseInt(document.getElementById('scan-timeout').value) || 200;
  // 默认勾选：先 Ping 探测存活再扫端口；不勾选则直接对全部地址扫端口
  const usePing = document.getElementById('scan-use-ping').checked;

  // 三段式 (192.168.1) 补成 192.168.1.0；四段式原样保留。
  // 第 4 段是网段起点，如 192.168.1.128 配 /25 表示扫后半段，不能再丢掉它。
  if (!subnet || !subnet.match(/^\d+\.\d+\.\d+(\.\d+)?$/)) {
    await safeAlert('请输入有效的网段，如 192.168.1.0 或 192.168.1.128');
    return;
  }

  const network = subnet.split('.').length === 3 ? subnet + '.0' : subnet;
  if (!isValidIP(network)) {
    await safeAlert('网段格式不正确，每段需在 0-255 之间\n\n示例: 192.168.1.0');
    return;
  }

  // 大网段先确认，避免误设前缀后干等几十分钟
  const hostCount = estimateHostCount(cidr);
  if (hostCount > SCAN_CONFIRM_THRESHOLD) {
    const ok = await safeConfirm(
      '即将扫描 ' + hostCount + ' 个地址（/' + cidr + '）。\n\n' +
      '按当前超时设置预计需要 ' +
      formatDuration(estimateScanDuration(hostCount, timeout, usePing)) +
      '，扫描期间可以随时点「停止」。\n\n确定开始吗？'
    );
    if (!ok) return;
  }

  // 更新UI状态
  document.getElementById('btn-scan-start').disabled = true;
  document.getElementById('btn-scan-stop').disabled = false;
  document.getElementById('scan-use-ping').disabled = true;
  document.getElementById('scan-results').innerHTML = '';
  scanResults = [];
  lastScanRenderAt = 0;
  lastScanRenderPhase = '';
  lastScanUsePing = usePing;

  try {
    // CIDR 展开与扫描均在主进程执行，进度经 scan:progress 推送
    const result = await ipcRenderer.invoke('scan:start', { network, cidr, timeout, usePing });
    if (!result.success) {
      await safeAlert('扫描失败: ' + result.error);
      return;
    }

    scanResults = result.results || [];
    renderScanResults(scanResults);
    document.getElementById('scan-phase').textContent = '扫描完成';
    document.getElementById('scan-progress-bar').style.width = '100%';
  } catch (err) {
    await safeAlert('扫描异常: ' + err.message);
  } finally {
    document.getElementById('btn-scan-start').disabled = false;
    document.getElementById('btn-scan-stop').disabled = true;
    document.getElementById('scan-use-ping').disabled = false;
  }
}

function stopScan() {
  ipcRenderer.invoke('scan:stop').catch(() => {});
  document.getElementById('btn-scan-start').disabled = false;
  document.getElementById('btn-scan-stop').disabled = true;
  document.getElementById('scan-use-ping').disabled = false;
  document.getElementById('scan-phase').textContent = '已停止';
}

function updateScanProgress(info) {
  const { phase, current, total, found } = info;
  const percent = Math.round((current / total) * 100);

  const phaseText = phase === 'ping'
    ? 'Ping 扫描中...'
    : phase === 'port'
      ? (lastScanUsePing ? '端口扫描中...' : '端口扫描中（未做 Ping 预探测）...')
      : 'IPMI 验证中...';
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

  const template = getCredentialByName(templateName) || getCredentialByName('openUBMC');

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

  const defaultTemplate = getCredentialByName('openUBMC');

  const config = getConfig();
  let added = 0;

  checkboxes.forEach(cb => {
    const ip = cb.value;
    if (!config.servers.some(s => s.host === ip)) {
      // 从扫描结果中获取模板信息
      const result = scanResults.find(r => r.ip === ip);
      const template = getCredentialByName(result ? result.template : null) || defaultTemplate;

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
      latency: typeof item === 'object' ? item.latency : 0,
      productName: typeof item === 'object' ? (item.productName || '') : '',
      bmcVersion: typeof item === 'object' ? (item.bmcVersion || '') : ''
    }))
  };

  const content = JSON.stringify(exportData, null, 2);
  const defaultPath = require('path').join(
    process.env.USERPROFILE || process.env.HOME,
    'Desktop',
    `ipmi_scan_${new Date().toISOString().slice(0, 10)}.json`
  );

  const result = await ipcRenderer.invoke(
    'file:save',
    defaultPath,
    content,
    [{ name: 'JSON 文件', extensions: ['json'] }, { name: '所有文件', extensions: ['*'] }]
  );
  if (result.success) {
    showStatus('connected', '扫描结果已导出');
  }
}

// HTML 中的交互统一通过 bindEvents() 里的 addEventListener 绑定，
// 不再向 window 挂载函数（避免内联事件与全局污染）
