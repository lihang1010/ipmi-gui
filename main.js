const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const pty = require('node-pty');

// 过滤 stderr 中的缓存警告日志
const originalStderrWrite = process.stderr.write;
process.stderr.write = function(chunk, ...args) {
  const str = chunk.toString();
  if (str.includes('cache_util_win') || str.includes('disk_cache') || str.includes('gpu_disk_cache')) {
    return true;
  }
  return originalStderrWrite.call(this, chunk, ...args);
};

let mainWindow;
let ptyProcesses = {};  // 多标签支持：{ tabId: ptyProcess }
let configPath = path.join(app.getPath('userData'), 'config.json');

// 默认配置
const defaultConfig = {
  servers: [],
  settings: {
    logDir: path.join(app.getPath('temp'), 'ipmi_logs')
  }
};

// 加载配置
function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch (e) {
    console.error('加载配置失败:', e);
  }
  return defaultConfig;
}

// 保存配置
function saveConfig(config) {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (e) {
    console.error('保存配置失败:', e);
  }
}

// 创建主窗口
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    title: 'IPMI 管理工具',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
}

// 构建 ipmitool 参数
function buildArgs(server) {
  const args = [];
  if (server.host) args.push('-H', server.host);
  if (server.port && server.port !== 623) args.push('-p', String(server.port));
  if (server.username) args.push('-U', server.username);
  if (server.password) args.push('-P', server.password);
  if (server.interface) args.push('-I', server.interface);
  if (server.cipherSuite) args.push('-C', String(server.cipherSuite));
  if (server.privilegeLevel) args.push('-L', server.privilegeLevel);
  return args;
}

// 获取 ipmitool 路径
function getIpmiToolPath() {
  // 按优先级查找
  const searchPaths = [
    // 1. extraResources: resources/bin/ipmitool.exe
    path.join(process.resourcesPath, 'bin', 'ipmitool.exe'),
    // 2. exe 同级目录
    path.join(path.dirname(app.getPath('exe')), 'resources', 'bin', 'ipmitool.exe'),
    // 3. exe 同目录
    path.join(path.dirname(app.getPath('exe')), 'ipmitool.exe'),
    // 4. 开发模式：项目 bin 目录
    path.join(__dirname, 'bin', 'ipmitool.exe'),
    // 5. 开发模式：上级 ipmitool 目录
    path.join(__dirname, '..', 'ipmitool', 'ipmitool.exe'),
    // 6. 兜底
    'D:\\tools\\ipmitool\\ipmitool.exe'
  ];

  for (const p of searchPaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return searchPaths[0];
}

// ========== IPC 处理 ==========

// 获取应用内存使用情况
ipcMain.handle('app:getMemory', () => {
  const mem = process.memoryUsage();
  return {
    rss: Math.round(mem.rss / 1024 / 1024),
    heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
    heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
    external: Math.round(mem.external / 1024 / 1024)
  };
});

// 获取配置
ipcMain.handle('config:get', () => loadConfig());

// 保存配置
ipcMain.handle('config:save', (event, config) => {
  saveConfig(config);
  return true;
});

// 执行 IPMI 命令
ipcMain.handle('ipmi:execute', async (event, server, command, args = []) => {
  const ipmitoolPath = getIpmiToolPath();
  const cmdArgs = [...buildArgs(server), ...command.split(' '), ...args];

  return new Promise((resolve) => {
    const spawn = require('child_process').spawn;
    const proc = spawn(ipmitoolPath, cmdArgs, {
      windowsHide: true
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data; });
    proc.stderr.on('data', (data) => { stderr += data; });

    proc.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });

    proc.on('error', (err) => {
      resolve({ code: -1, stdout: '', stderr: err.message });
    });
  });
});

// ========== SOL 处理 (多标签支持) ==========

// 启动 SOL
ipcMain.handle('sol:start', async (event, server, tabId) => {
  const ipmitoolPath = getIpmiToolPath();
  const args = [...buildArgs(server), 'sol', 'activate'];

  try {
    const proc = pty.spawn(ipmitoolPath, args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: path.dirname(ipmitoolPath),
      env: process.env
    });

    ptyProcesses[tabId] = proc;

    // 转发输出到渲染进程
    proc.onData((data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('sol:data', { tabId, data });
      }
    });

    // 进程退出
    proc.onExit(({ exitCode }) => {
      delete ptyProcesses[tabId];
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('sol:exit', { tabId, exitCode });
      }
    });

    return { success: true, pid: proc.pid };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 发送数据到 SOL
ipcMain.on('sol:write', (event, tabId, data) => {
  const proc = ptyProcesses[tabId];
  if (proc) {
    proc.write(data);
  }
});

// 停止 SOL - 直接执行 deactivate
ipcMain.handle('sol:stop', async (event, server) => {
  const ipmitoolPath = getIpmiToolPath();
  const args = [...buildArgs(server), 'sol', 'deactivate'];

  return new Promise((resolve) => {
    const spawn = require('child_process').spawn;
    const proc = spawn(ipmitoolPath, args, {
      windowsHide: true
    });

    let stderr = '';
    proc.stderr.on('data', (data) => { stderr += data; });

    proc.on('close', (code) => {
      resolve({ success: code === 0, stderr });
    });

    proc.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
  });
});

// 执行 sol deactivate
ipcMain.handle('sol:deactivate', async (event, server) => {
  const ipmitoolPath = getIpmiToolPath();
  const args = [...buildArgs(server), 'sol', 'deactivate'];

  return new Promise((resolve) => {
    const spawn = require('child_process').spawn;
    const proc = spawn(ipmitoolPath, args, {
      windowsHide: true
    });

    let stderr = '';
    proc.stderr.on('data', (data) => { stderr += data; });

    proc.on('close', (code) => {
      resolve({ success: code === 0, stderr });
    });

    proc.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
  });
});

// ========== 文件操作 ==========

// 保存文件
ipcMain.handle('file:save', async (event, defaultName, content) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters: [
      { name: '日志文件', extensions: ['log', 'txt'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  });

  if (!result.canceled && result.filePath) {
    fs.writeFileSync(result.filePath, content, 'utf-8');
    return { success: true, path: result.filePath };
  }
  return { success: false };
});

// 选择目录
ipcMain.handle('dialog:selectDirectory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// 选择文件
ipcMain.handle('dialog:selectFile', async (event, filters) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: filters || [{ name: '所有文件', extensions: ['*'] }]
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// ========== 生命周期 ==========

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  // 关闭所有 pty 进程
  Object.values(ptyProcesses).forEach(proc => {
    try { proc.kill(); } catch (e) {}
  });
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
