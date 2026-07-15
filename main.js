const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const pty = require('node-pty');

let mainWindow;
let ptyProcess = null;
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
      preload: path.join(__dirname, 'preload.js'),
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
  // 优先查找同目录下的 ipmitool.exe
  const localPath = path.join(path.dirname(app.getPath('exe')), 'ipmitool.exe');
  if (fs.existsSync(localPath)) return localPath;

  // 查找上级目录
  const parentPath = path.join(path.dirname(path.dirname(app.getPath('exe'))), 'ipmitool.exe');
  if (fs.existsSync(parentPath)) return parentPath;

  // 默认路径
  return 'D:\\tools\\ipmitool\\ipmitool.exe';
}

// ========== IPC 处理 ==========

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

// ========== SOL 处理 ==========

// 启动 SOL
ipcMain.handle('sol:start', async (event, server) => {
  if (ptyProcess) {
    return { success: false, error: 'SOL 已在运行中' };
  }

  const ipmitoolPath = getIpmiToolPath();
  const args = [...buildArgs(server), 'sol', 'activate'];

  try {
    ptyProcess = pty.spawn(ipmitoolPath, args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: path.dirname(ipmitoolPath),
      env: process.env
    });

    // 转发输出到渲染进程
    ptyProcess.onData((data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('sol:data', data);
      }
    });

    // 进程退出
    ptyProcess.onExit(({ exitCode }) => {
      ptyProcess = null;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('sol:exit', exitCode);
      }
    });

    return { success: true, pid: ptyProcess.pid };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 发送数据到 SOL
ipcMain.on('sol:write', (event, data) => {
  if (ptyProcess) {
    ptyProcess.write(data);
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
      ptyProcess = null;
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
  if (ptyProcess) {
    ptyProcess.kill();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
