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

  // 监听 SOL 数据
  ipcRenderer.on('sol:data', (event, data) => {
    if (terminal) terminal.write(data);
  });

  ipcRenderer.on('sol:exit', (event, code) => {
    solRunning = false;
    showStatus(`SOL 已退出 (代码: ${code})`);
    updateSolButtons();
  });
});

function initTerminal() {
  if (terminal) return;

  terminal = new Terminal({
    theme: {
      background: '#0c0c0c',
      foreground: '#cccccc',
      cursor: '#ffffff',
      selectionBackground: '#264f78'
    },
    fontFamily: 'Consolas, "Courier New", monospace',
    fontSize: 14,
    cursorBlink: true,
    scrollback: 10000
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

  // 用户输入 - 仅当终端有焦点时发送
  terminal.onData((data) => {
    if (solRunning && document.activeElement === terminal.text) {
      ipcRenderer.send('sol:write', data);
    }
  });

  // 窗口大小变化
  window.addEventListener('resize', () => {
    if (fitAddon) fitAddon.fit();
  });

  // 显示欢迎信息
  terminal.writeln('\x1b[36mIPMI SOL 终端\x1b[0m');
  terminal.writeln('点击 [启动 SOL] 连接到服务器');
  terminal.writeln('');
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
    showStatus(currentServer ? `已选择: ${currentServer.name}` : '未选择服务器');
  });

  // 按钮事件
  document.getElementById('btn-add-server').addEventListener('click', () => openDialog());
  document.getElementById('btn-edit-server').addEventListener('click', () => {
    if (currentServer) openDialog(currentServer);
  });
  document.getElementById('btn-delete-server').addEventListener('click', deleteServer);

  document.getElementById('btn-sol-start').addEventListener('click', startSol);
  document.getElementById('btn-sol-stop').addEventListener('click', stopSol);
  document.getElementById('btn-sol-deactivate').addEventListener('click', deactivateSol);
  document.getElementById('btn-sol-save').addEventListener('click', saveSolLog);
  document.getElementById('btn-sol-clear').addEventListener('click', clearTerminal);

  // 原始命令回车
  document.getElementById('raw-command').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') executeRawCommand();
  });

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

  document.getElementById('server-dialog').style.display = 'flex';
}

function closeDialog() {
  document.getElementById('server-dialog').style.display = 'none';
  editingServerId = null;
}

function saveServer() {
  const name = document.getElementById('server-name').value.trim();
  const host = document.getElementById('server-host').value.trim();

  if (!name || !host) {
    alert('请填写名称和IP地址');
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
}

function deleteServer() {
  if (!currentServer) {
    alert('请先选择服务器');
    return;
  }

  if (!confirm(`确定删除服务器 "${currentServer.name}" 吗?`)) return;

  config.servers = config.servers.filter(s => s.id !== currentServer.id);
  saveConfigToFile();
  updateServerList();
  currentServer = null;
}

// ========== SOL 操作 ==========

async function startSol() {
  if (!currentServer) {
    alert('请先选择服务器');
    return;
  }

  initTerminal();
  showStatus('正在连接...');

  const result = await ipcRenderer.invoke('sol:start', currentServer);

  if (result.success) {
    solRunning = true;
    showStatus(`已连接: ${currentServer.host}`);
    updateSolButtons();
    terminal.focus();
  } else {
    showStatus(`连接失败: ${result.error}`);
    alert(`启动 SOL 失败:\n${result.error}`);
  }
}

async function stopSol() {
  const result = await ipcRenderer.invoke('sol:stop');
  if (result.success) {
    solRunning = false;
    showStatus('SOL 已停止');
    updateSolButtons();
  }
}

async function deactivateSol() {
  if (!currentServer) {
    alert('请先选择服务器');
    return;
  }

  const result = await ipcRenderer.invoke('sol:deactivate', currentServer);
  if (result.success) {
    showStatus('已发送 deactivate 命令');
  } else {
    showStatus(`deactivate 失败: ${result.error || result.stderr}`);
  }
}

function updateSolButtons() {
  document.getElementById('btn-sol-start').disabled = solRunning;
  document.getElementById('btn-sol-stop').disabled = !solRunning;
}

function saveSolLog() {
  if (!serializeAddon) {
    alert('终端未初始化');
    return;
  }

  const content = serializeAddon.serialize();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const serverName = currentServer ? currentServer.host : 'unknown';
  const defaultName = `sol_${serverName}_${timestamp}.log`;

  // 使用原生保存对话框
  const { dialog } = require('electron').remote || {};
  if (dialog) {
    dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: [{ name: '日志文件', extensions: ['log', 'txt'] }]
    }).then(result => {
      if (!result.canceled && result.filePath) {
        fs.writeFileSync(result.filePath, content, 'utf-8');
        showStatus(`日志已保存: ${result.filePath}`);
      }
    });
  } else {
    // 降级方案：保存到桌面
    const desktopPath = path.join(process.env.USERPROFILE || process.env.HOME, 'Desktop', defaultName);
    fs.writeFileSync(desktopPath, content, 'utf-8');
    showStatus(`日志已保存到桌面: ${desktopPath}`);
  }
}

function clearTerminal() {
  if (terminal) terminal.clear();
}

// ========== 命令执行 ==========

async function executeCommand(command, outputId) {
  if (!currentServer) {
    alert('请先选择服务器');
    return;
  }

  const result = await ipcRenderer.invoke('ipmi:execute', currentServer, command);
  const output = result.code === 0 ? result.stdout : `错误: ${result.stderr}`;
  document.getElementById(outputId).textContent = output;
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
    alert('请输入命令');
    return;
  }
  executeCommand(command, 'output-raw');
}

// ========== 工具函数 ==========

function showStatus(text) {
  document.getElementById('status-text').textContent = text;
}

function clearOutput(elementId) {
  const el = document.getElementById(elementId);
  if (el) {
    const defaults = {
      'output-power': '点击按钮执行命令...',
      'output-sensor': '点击刷新获取传感器数据...',
      'output-fru': '点击刷新获取FRU信息...',
      'output-sel': '点击刷新获取事件日志...',
      'output-user': '点击刷新获取用户列表...',
      'output-network': '点击刷新获取网络配置...',
      'output-raw': '输入命令并点击执行...'
    };
    el.textContent = defaults[elementId] || '';
  }
}
