// 渲染进程脚本
const { Terminal } = require('xterm');
const { FitAddon } = require('@xterm/addon-fit');
const { SerializeAddon } = require('@xterm/addon-serialize');

// 全局变量
let terminal = null;
let fitAddon = null;
let serializeAddon = null;
let config = { servers: [], settings: {} };
let currentServer = null;
let editingServerId = null;

// ========== 初始化 ==========

document.addEventListener('DOMContentLoaded', async () => {
  // 初始化终端
  initTerminal();

  // 加载配置
  config = await window.api.getConfig();
  updateServerList();

  // 绑定事件
  bindEvents();

  // 监听 SOL 数据
  window.api.onSolData((data) => {
    if (terminal) terminal.write(data);
  });

  window.api.onSolExit((code) => {
    showStatus(`SOL 已退出 (代码: ${code})`);
  });
});

function initTerminal() {
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

  // 用户输入
  terminal.onData((data) => {
    window.api.writeSol(data);
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

      if (tab.dataset.tab === 'sol' && fitAddon) {
        setTimeout(() => fitAddon.fit(), 100);
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

  window.api.saveConfig(config);
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
  window.api.saveConfig(config);
  updateServerList();
  currentServer = null;
}

// ========== SOL 操作 ==========

async function startSol() {
  if (!currentServer) {
    alert('请先选择服务器');
    return;
  }

  showStatus('正在连接...');
  const result = await window.api.startSol(currentServer);

  if (result.success) {
    showStatus(`已连接: ${currentServer.host}`);
    terminal.focus();
  } else {
    showStatus(`连接失败: ${result.error}`);
    alert(`启动 SOL 失败:\n${result.error}`);
  }
}

async function stopSol() {
  const result = await window.api.stopSol();
  if (result.success) {
    showStatus('SOL 已停止');
  }
}

async function deactivateSol() {
  if (!currentServer) {
    alert('请先选择服务器');
    return;
  }

  const result = await window.api.deactivateSol(currentServer);
  if (result.success) {
    showStatus('已发送 deactivate 命令');
  } else {
    showStatus(`deactivate 失败: ${result.error || result.stderr}`);
  }
}

function saveSolLog() {
  if (!serializeAddon) return;

  const content = serializeAddon.serialize();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const serverName = currentServer ? currentServer.host : 'unknown';
  const defaultName = `sol_${serverName}_${timestamp}.log`;

  window.api.saveFile(defaultName, content).then(result => {
    if (result.success) {
      showStatus(`日志已保存: ${result.path}`);
    }
  });
}

function clearTerminal() {
  if (terminal) terminal.clear();
}

// ========== 命令执行 ==========

async function executePower(action) {
  if (!currentServer) {
    alert('请先选择服务器');
    return;
  }

  const result = await window.api.executeCommand(currentServer, `power ${action}`);
  document.getElementById('output-power').textContent =
    result.code === 0 ? result.stdout : `错误: ${result.stderr}`;
}

async function executeSensor() {
  if (!currentServer) {
    alert('请先选择服务器');
    return;
  }

  const result = await window.api.executeCommand(currentServer, 'sdr list');
  document.getElementById('output-sensor').textContent =
    result.code === 0 ? result.stdout : `错误: ${result.stderr}`;
}

async function executeCommand(command) {
  if (!currentServer) {
    alert('请先选择服务器');
    return;
  }

  const panel = command.split(' ')[0];
  const result = await window.api.executeCommand(currentServer, command);
  const output = result.code === 0 ? result.stdout : `错误: ${result.stderr}`;

  const outputEl = document.getElementById(`output-${panel}`);
  if (outputEl) outputEl.textContent = output;
}

async function executeRawCommand() {
  if (!currentServer) {
    alert('请先选择服务器');
    return;
  }

  const command = document.getElementById('raw-command').value.trim();
  if (!command) {
    alert('请输入命令');
    return;
  }

  const result = await window.api.executeCommand(currentServer, command);
  const output = result.code === 0 ? result.stdout : `错误: ${result.stderr}`;
  document.getElementById('output-raw').textContent = output;
}

// ========== 工具函数 ==========

function showStatus(text) {
  document.getElementById('status-text').textContent = text;
}
