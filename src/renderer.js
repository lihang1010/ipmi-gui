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

// ========== 初始化 ==========

document.addEventListener('DOMContentLoaded', () => {
  // 加载配置
  config = loadConfig();
  updateServerList();

  // 绑定事件
  bindEvents();

  // 全局键盘快捷键
  bindKeyboardShortcuts();

  // 监听 SOL 数据
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

  // 点击终端容器时才获取焦点
  document.getElementById('terminal').addEventListener('click', () => {
    terminal.focus();
  });

  // 用户输入 - xterm.js 内部已处理焦点
  terminal.onData((data) => {
    if (solRunning) {
      ipcRenderer.send('sol:write', data);
    }
  });

  // 窗口大小变化
  window.addEventListener('resize', () => {
    if (fitAddon) fitAddon.fit();
  });

  // 显示欢迎信息
  terminal.writeln('\x1b[38;2;91;155;213m  ╔══════════════════════════════════════╗\x1b[0m');
  terminal.writeln('\x1b[38;2;91;155;213m  ║        IPMI SOL 终端                 ║\x1b[0m');
  terminal.writeln('\x1b[38;2;91;155;213m  ╚══════════════════════════════════════╝\x1b[0m');
  terminal.writeln('');
  terminal.writeln('\x1b[38;2;107;107;117m  点击 [启动 SOL] 连接到服务器\x1b[0m');
  terminal.writeln('');
}

// ========== 键盘快捷键 ==========

function bindKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Ctrl+R: 刷新当前面板
    if (e.ctrlKey && e.key === 'r') {
      e.preventDefault();
      refreshCurrentPanel();
    }
    // Ctrl+L: 清屏当前面板
    if (e.ctrlKey && e.key === 'l') {
      e.preventDefault();
      clearCurrentPanel();
    }
    // Ctrl+N: 添加服务器
    if (e.ctrlKey && e.key === 'n') {
      e.preventDefault();
      openDialog();
    }
    // Escape: 关闭对话框
    if (e.key === 'Escape') {
      const dialog = document.getElementById('server-dialog');
      if (dialog.style.display === 'flex') {
        closeDialog();
      }
    }
  });
}

function refreshCurrentPanel() {
  const activeTab = document.querySelector('.tab.active');
  if (!activeTab) return;
  const tab = activeTab.dataset.tab;
  if (tab === 'power') executePower('status');
  else if (tab === 'sensor') executeSensor();
  else if (tab === 'fru') executeCommand('fru list', 'output-fru');
  else if (tab === 'sel') executeCommand('sel list', 'output-sel');
  else if (tab === 'user') executeCommand('user list', 'output-user');
  else if (tab === 'network') executeCommand('lan print', 'output-network');
}

function clearCurrentPanel() {
  const activeTab = document.querySelector('.tab.active');
  if (!activeTab) return;
  const tab = activeTab.dataset.tab;
  if (tab === 'sol') { if (terminal) terminal.clear(); }
  else if (tab === 'power') clearOutput('output-power');
  else if (tab === 'sensor') clearOutput('output-sensor');
  else if (tab === 'fru') clearOutput('output-fru');
  else if (tab === 'sel') clearOutput('output-sel');
  else if (tab === 'user') clearOutput('output-user');
  else if (tab === 'network') clearOutput('output-network');
  else if (tab === 'raw') clearOutput('output-raw');
}

// ========== 事件绑定 ==========

function bindEvents() {
  // 选项卡切换
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      document.getElementById(`panel-${tab.dataset.tab}`).classList.add('active');

      if (tab.dataset.tab === 'sol') {
        initTerminal();
        setTimeout(() => { if (fitAddon) fitAddon.fit(); }, 100);
      }
    });
  });

  // 服务器选择
  document.getElementById('server-select').addEventListener('change', (e) => {
    const serverId = e.target.value;
    currentServer = config.servers.find(s => s.id === serverId) || null;
    if (currentServer) {
      showStatus('connected', `${currentServer.name}`);
    } else {
      showStatus('idle', '未选择服务器');
    }
  });

  // 按钮事件
  document.getElementById('btn-add-server').addEventListener('click', () => openDialog());
  document.getElementById('btn-edit-server').addEventListener('click', () => {
    if (currentServer) openDialog(currentServer);
  });
  document.getElementById('btn-delete-server').addEventListener('click', deleteServer);
  document.getElementById('btn-test-connection').addEventListener('click', testConnection);
  document.getElementById('btn-import-config').addEventListener('click', importConfig);
  document.getElementById('btn-export-config').addEventListener('click', exportConfig);

  document.getElementById('btn-sol-start').addEventListener('click', startSol);
  document.getElementById('btn-sol-stop').addEventListener('click', stopSol);
  document.getElementById('btn-sol-save').addEventListener('click', saveSolLog);
  document.getElementById('btn-sol-logdir').addEventListener('click', selectLogDir);
  document.getElementById('btn-sol-clear').addEventListener('click', clearTerminal);

  // 收藏夹按钮
  document.getElementById('btn-add-favorite').addEventListener('click', () => openFavDialog());
  document.getElementById('btn-exec-favorite').addEventListener('click', executeSelectedFavorite);
  document.getElementById('btn-edit-favorite').addEventListener('click', editSelectedFavorite);
  document.getElementById('btn-delete-favorite').addEventListener('click', deleteSelectedFavorite);
  document.getElementById('btn-move-up').addEventListener('click', () => moveFavorite(-1));
  document.getElementById('btn-move-down').addEventListener('click', () => moveFavorite(1));

  // 原始命令回车
  document.getElementById('raw-command').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') executeRawCommand();
  });

  // 显示当前日志目录
  updateLogDirDisplay();

  // 加载收藏夹
  loadFavorites();

  // 初始化终端
  initTerminal();
}

// ========== 服务器管理 ==========

function updateServerList() {
  const select = document.getElementById('server-select');
  select.innerHTML = '<option value="">-- 选择服务器 --</option>';

  config.servers.forEach(server => {
    const option = document.createElement('option');
    option.value = server.id;
    option.textContent = `${server.name} (${server.host})`;
    select.appendChild(option);
  });
}

function openDialog(server = null) {
  editingServerId = server ? server.id : null;
  document.getElementById('dialog-title').textContent = server ? '编辑服务器' : '添加服务器';

  document.getElementById('server-name').value = server ? server.name : '';
  document.getElementById('server-host').value = server ? server.host : '';
  document.getElementById('server-port').value = server ? (server.port || 623) : 623;
  document.getElementById('server-username').value = server ? server.username : '';
  document.getElementById('server-password').value = server ? server.password : '';
  document.getElementById('server-interface').value = server ? (server.interface || 'lanplus') : 'lanplus';
  document.getElementById('server-cipher').value = server ? (server.cipherSuite || 17) : 17;

  // 彻底移除终端焦点
  if (terminal) {
    terminal.blur();
    const textarea = terminal.textarea;
    if (textarea) {
      textarea.blur();
      textarea.disabled = true;
    }
  }

  const dialog = document.getElementById('server-dialog');
  dialog.style.display = 'flex';

  // 多次尝试聚焦
  const nameInput = document.getElementById('server-name');
  nameInput.focus();
  setTimeout(() => {
    nameInput.focus();
    nameInput.click();
  }, 100);
}

function closeDialog() {
  document.getElementById('server-dialog').style.display = 'none';
  editingServerId = null;

  // 恢复终端 textarea
  if (terminal && terminal.textarea) {
    terminal.textarea.disabled = false;
  }
}

function saveServer() {
  const name = document.getElementById('server-name').value.trim();
  const host = document.getElementById('server-host').value.trim();

  if (!name || !host) {
    safeAlert('请填写名称和IP地址');
    return;
  }

  const serverData = {
    id: editingServerId || Date.now().toString(),
    name,
    host,
    port: parseInt(document.getElementById('server-port').value) || 623,
    username: document.getElementById('server-username').value.trim(),
    password: document.getElementById('server-password').value,
    interface: document.getElementById('server-interface').value,
    cipherSuite: parseInt(document.getElementById('server-cipher').value) || 17,
    privilegeLevel: 'ADMINISTRATOR'
  };

  if (editingServerId) {
    const index = config.servers.findIndex(s => s.id === editingServerId);
    if (index !== -1) config.servers[index] = serverData;
  } else {
    config.servers.push(serverData);
  }

  saveConfigToFile();
  updateServerList();
  closeDialog();

  // 选中新添加的服务器
  document.getElementById('server-select').value = serverData.id;
  currentServer = serverData;
  showStatus('connected', serverData.name);
}

function deleteServer() {
  if (!currentServer) {
    safeAlert('请先选择服务器');
    resetFocus();
    return;
  }

  if (!safeConfirm(`确定删除服务器 "${currentServer.name}" 吗?`)) {
    resetFocus();
    return;
  }

  config.servers = config.servers.filter(s => s.id !== currentServer.id);
  saveConfigToFile();
  updateServerList();
  currentServer = null;
  showStatus('idle', '未选择服务器');
  resetFocus();
}

// ========== 导入导出 ==========

async function exportConfig() {
  if (!config.servers || config.servers.length === 0) {
    safeAlert('没有可导出的服务器配置');
    return;
  }

  const exportData = {
    exportTime: new Date().toISOString(),
    version: '1.0',
    servers: config.servers
  };

  const content = JSON.stringify(exportData, null, 2);
  const defaultPath = path.join(
    process.env.USERPROFILE || process.env.HOME,
    'Desktop',
    `ipmi_servers_${new Date().toISOString().slice(0, 10)}.json`
  );

  const result = await ipcRenderer.invoke('file:save', defaultPath, content);
  if (result.success) {
    showStatus('connected', `配置已导出`);
  }
}

async function importConfig() {
  const filePath = await ipcRenderer.invoke('dialog:selectFile', [
    { name: 'JSON 文件', extensions: ['json'] },
    { name: '所有文件', extensions: ['*'] }
  ]);

  if (!filePath) return;

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const importData = JSON.parse(content);

    if (!importData.servers || !Array.isArray(importData.servers)) {
      safeAlert('无效的配置文件格式');
      return;
    }

    // 验证每个服务器配置
    const validServers = importData.servers.filter(s => s.name && s.host);

    if (validServers.length === 0) {
      safeAlert('配置文件中没有有效的服务器');
      return;
    }

    const action = safeConfirm(
      `找到 ${validServers.length} 个服务器配置。\n\n` +
      `点击"确定"合并到现有配置\n` +
      `点击"取消"放弃导入`
    );

    if (!action) {
      resetFocus();
      return;
    }

    // 合并配置（跳过重复的）
    let imported = 0;
    for (const server of validServers) {
      const exists = config.servers.some(s => s.host === server.host && s.name === server.name);
      if (!exists) {
        server.id = server.id || Date.now().toString() + Math.random().toString(36).slice(2, 6);
        config.servers.push(server);
        imported++;
      }
    }

    saveConfigToFile();
    updateServerList();
    showStatus('connected', `已导入 ${imported} 个服务器`);
    resetFocus();
  } catch (err) {
    safeAlert(`导入失败: ${err.message}`);
    resetFocus();
  }
}

// ========== 连接测试 ==========

async function testConnection() {
  if (!currentServer) {
    safeAlert('请先选择服务器');
    resetFocus();
    return;
  }

  const btn = document.getElementById('btn-test-connection');
  btn.classList.add('loading');
  showStatus('connecting', '正在测试连接...');

  try {
    // 使用 raw 6 1 命令测试连接 (Get Device ID)
    const result = await ipcRenderer.invoke('ipmi:execute', currentServer, 'raw 6 1');

    if (result.code === 0 && result.stdout.trim()) {
      showStatus('connected', `${currentServer.name} - 连接正常`);
      safeAlert(`连接测试成功!\n\n服务器: ${currentServer.name}\nIP: ${currentServer.host}\n\n响应: ${result.stdout.trim()}`);
    } else {
      showStatus('error', `${currentServer.name} - 连接失败`);
      safeAlert(`连接测试失败!\n\n服务器: ${currentServer.name}\nIP: ${currentServer.host}\n\n错误: ${result.stderr || '无响应'}`);
    }
  } catch (err) {
    showStatus('error', '测试异常');
    safeAlert(`连接测试异常: ${err.message}`);
  } finally {
    btn.classList.remove('loading');
    resetFocus();
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
    list.innerHTML = `
      <div class="favorites-empty">
        <div class="favorites-empty-icon">+</div>
        <div>暂无收藏</div>
        <div style="font-size:12px">点击"添加收藏"按钮添加常用命令</div>
      </div>
    `;
    return;
  }

  list.innerHTML = favorites.map((fav, index) => `
    <div class="favorite-item ${index === selectedFavIndex ? 'selected' : ''}"
         onclick="selectFavorite(${index})" ondblclick="executeFavorite(${index})">
      <div class="fav-icon">></div>
      <div class="fav-info">
        <div class="fav-name">${escapeHtml(fav.name)}</div>
        <div class="fav-command">${escapeHtml(fav.command)}</div>
      </div>
    </div>
  `).join('');
}

function selectFavorite(index) {
  selectedFavIndex = index;
  renderFavorites();
  updateFavoriteButtons();

  // 显示命令预览
  const fav = favorites[index];
  const preview = document.getElementById('favorites-preview');
  preview.textContent = `命令: ${fav.command}\n${fav.desc ? '描述: ' + fav.desc : ''}`;
}

function updateFavoriteButtons() {
  const hasSelection = selectedFavIndex >= 0;
  document.getElementById('btn-exec-favorite').disabled = !hasSelection;
  document.getElementById('btn-edit-favorite').disabled = !hasSelection;
  document.getElementById('btn-delete-favorite').disabled = !hasSelection;
  document.getElementById('btn-move-up').disabled = !hasSelection || selectedFavIndex === 0;
  document.getElementById('btn-move-down').disabled = !hasSelection || selectedFavIndex === favorites.length - 1;
}

function openFavDialog(fav = null, index = -1) {
  editingFavIndex = index;
  document.getElementById('fav-dialog-title').textContent = fav ? '编辑收藏' : '添加收藏';
  document.getElementById('fav-name').value = fav ? fav.name : '';
  document.getElementById('fav-command').value = fav ? fav.command : '';
  document.getElementById('fav-desc').value = fav ? (fav.desc || '') : '';

  // 彻底移除终端焦点
  if (terminal) {
    terminal.blur();
    const textarea = terminal.textarea;
    if (textarea) {
      textarea.blur();
      textarea.disabled = true;
    }
  }

  document.getElementById('favorite-dialog').style.display = 'flex';

  // 多次尝试聚焦
  const nameInput = document.getElementById('fav-name');
  nameInput.focus();
  setTimeout(() => {
    nameInput.focus();
    nameInput.click();
  }, 100);
}

function closeFavDialog() {
  document.getElementById('favorite-dialog').style.display = 'none';
  editingFavIndex = -1;

  // 恢复终端 textarea
  if (terminal && terminal.textarea) {
    terminal.textarea.disabled = false;
  }
}

function saveFavorite() {
  const name = document.getElementById('fav-name').value.trim();
  const command = document.getElementById('fav-command').value.trim();
  const desc = document.getElementById('fav-desc').value.trim();

  if (!name || !command) {
    safeAlert('请填写名称和命令');
    return;
  }

  const favData = { name, command, desc };

  if (editingFavIndex >= 0) {
    favorites[editingFavIndex] = favData;
  } else {
    favorites.push(favData);
  }

  saveFavorites();
  renderFavorites();
  closeFavDialog();
}

function editSelectedFavorite() {
  if (selectedFavIndex >= 0) {
    openFavDialog(favorites[selectedFavIndex], selectedFavIndex);
  }
}

function deleteSelectedFavorite() {
  if (selectedFavIndex < 0) return;

  const fav = favorites[selectedFavIndex];

  // 直接删除，不使用 safeConfirm() 以避免焦点问题
  favorites.splice(selectedFavIndex, 1);
  selectedFavIndex = -1;
  saveFavorites();
  renderFavorites();
  updateFavoriteButtons();

  // 重新聚焦到收藏夹列表
  const list = document.getElementById('favorites-list');
  if (list) list.focus();
}

function executeSelectedFavorite() {
  if (selectedFavIndex >= 0) {
    executeFavorite(selectedFavIndex);
  }
}

async function executeFavorite(index) {
  if (!currentServer) {
    safeAlert('请先选择服务器');
    return;
  }

  const fav = favorites[index];
  if (!fav) return;

  showStatus('connecting', `执行: ${fav.name}...`);

  try {
    const result = await ipcRenderer.invoke('ipmi:execute', currentServer, fav.command);
    const output = result.code === 0 ? result.stdout : `错误:\n${result.stderr}`;

    // 切换到原始命令面板显示结果
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.querySelector('[data-tab="raw"]').classList.add('active');
    document.getElementById('panel-raw').classList.add('active');

    document.getElementById('raw-command').value = fav.command;
    document.getElementById('output-raw').textContent = output || '(无输出)';

    showStatus('connected', `${fav.name} 执行完成`);
  } catch (err) {
    showStatus('error', '执行失败');
    safeAlert(`执行失败: ${err.message}`);
  }
}

function moveFavorite(direction) {
  if (selectedFavIndex < 0) return;

  const newIndex = selectedFavIndex + direction;
  if (newIndex < 0 || newIndex >= favorites.length) return;

  // 交换位置
  const temp = favorites[selectedFavIndex];
  favorites[selectedFavIndex] = favorites[newIndex];
  favorites[newIndex] = temp;

  selectedFavIndex = newIndex;
  saveFavorites();
  renderFavorites();
  updateFavoriteButtons();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ========== SOL 操作 ==========

async function startSol() {
  if (!currentServer) {
    safeAlert('请先选择服务器');
    return;
  }

  initTerminal();

  const btn = document.getElementById('btn-sol-start');
  btn.classList.add('loading');
  showStatus('connecting', '正在连接...');

  try {
    const result = await ipcRenderer.invoke('sol:start', currentServer);

    if (result.success) {
      solRunning = true;
      showStatus('connected', `${currentServer.name}`);
      document.getElementById('btn-sol-start').disabled = true;
      terminal.focus();
    } else {
      showStatus('error', `连接失败`);
      safeAlert(`启动 SOL 失败:\n${result.error}`);
    }
  } finally {
    btn.classList.remove('loading');
  }
}

async function stopSol() {
  if (!currentServer) {
    safeAlert('请先选择服务器');
    return;
  }

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
      const msg = result.stderr || result.error || '未知错误';
      safeAlert(`停止 SOL 失败:\n${msg}`);
    }
  } finally {
    btn.classList.remove('loading');
  }
}

async function saveSolLog() {
  if (!serializeAddon) {
    safeAlert('终端未初始化');
    return;
  }

  const content = serializeAddon.serialize();

  // UTC+8 时区时间戳
  const now = new Date();
  const utc8 = new Date(now.getTime() + (8 * 60 * 60 * 1000));
  const timestamp = utc8.toISOString().replace(/[:.]/g, '-').slice(0, 19).replace('T', '_');

  const serverName = currentServer ? currentServer.host : 'unknown';
  const defaultName = `sol_${serverName}_${timestamp}.log`;

  // 使用配置的日志目录
  const defaultPath = path.join(getLogDir(), defaultName);

  // 通过 IPC 调用保存对话框
  const result = await ipcRenderer.invoke('file:save', defaultPath, content);
  if (result.success) {
    // 记住本次保存目录
    config.settings = config.settings || {};
    config.settings.lastSaveDir = path.dirname(result.path);
    saveConfigToFile();
    showStatus('connected', `日志已保存`);
  }
}

function clearTerminal() {
  if (terminal) terminal.clear();
}

// ========== 日志目录 ==========

function getLogDir() {
  return config.settings?.lastSaveDir ||
    path.join(process.env.USERPROFILE || process.env.HOME, 'Desktop');
}

function updateLogDirDisplay() {
  const el = document.getElementById('sol-logdir-text');
  if (el) {
    const dir = getLogDir();
    el.textContent = dir;
    el.title = dir;  // 原生 tooltip 显示完整路径
  }
}

async function selectLogDir() {
  const selectedDir = await ipcRenderer.invoke('dialog:selectDirectory');
  if (selectedDir) {
    config.settings = config.settings || {};
    config.settings.lastSaveDir = selectedDir;
    saveConfigToFile();
    updateLogDirDisplay();
    showStatus('connected', `日志目录已更新`);
  }
}

// ========== 命令执行 ==========

async function executeCommand(command, outputId) {
  if (!currentServer) {
    safeAlert('请先选择服务器');
    return;
  }

  const outputEl = document.getElementById(outputId);
  const originalText = outputEl.textContent;
  outputEl.textContent = '执行中...';
  outputEl.style.opacity = '0.5';

  try {
    const result = await ipcRenderer.invoke('ipmi:execute', currentServer, command);
    const output = result.code === 0 ? result.stdout : `错误:\n${result.stderr}`;
    outputEl.textContent = output || '(无输出)';
    outputEl.style.opacity = '1';
  } catch (err) {
    outputEl.textContent = `执行异常: ${err.message}`;
    outputEl.style.opacity = '1';
  }
}

function executePower(action) {
  executeCommand(`power ${action}`, 'output-power');
}

function executeSensor() {
  executeCommand('sdr list', 'output-sensor');
}

function executeRawCommand() {
  const command = document.getElementById('raw-command').value.trim();
  if (!command) {
    safeAlert('请输入命令');
    return;
  }
  executeCommand(command, 'output-raw');
}

// ========== 工具函数 ==========

/**
 * 重置焦点状态 - 修复 safeConfirm/safeAlert 后输入框无法聚焦的问题
 */
function resetFocus() {
  // 移除所有焦点
  if (document.activeElement) {
    document.activeElement.blur();
  }

  // 确保终端 textarea 不会拦截输入
  if (terminal && terminal.textarea) {
    terminal.textarea.blur();
  }

  // 将焦点设置到 body
  document.body.focus();
}

/**
 * 安全的 alert - 显示后自动重置焦点
 */
function safeAlert(msg) {
  window.alert(msg);
  resetFocus();
}

/**
 * 安全的 confirm - 确认后自动重置焦点
 */
function safeConfirm(msg) {
  const result = window.confirm(msg);
  resetFocus();
  return result;
}

/**
 * 更新状态指示器
 * @param {'idle'|'connected'|'connecting'|'error'|'disconnected'} state
 * @param {string} text
 */
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
