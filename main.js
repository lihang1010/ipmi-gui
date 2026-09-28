const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const pty = require('node-pty');
const { buildArgs, resolveIpmiToolPath, tokenizeCommand } = require('./src/modules/ipmiTool');

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

// 获取 ipmitool 路径（未找到返回 null，由调用方给出明确错误）
function getIpmiToolPath() {
  return resolveIpmiToolPath();
}

// ipmitool 缺失时的统一提示
const IPMITOOL_MISSING = '未找到 ipmitool.exe，请确认 bin 目录已随程序一起分发';

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

// 配置读写统一由渲染进程的 src/modules/configStore.js 负责
// （路径 %APPDATA%/ipmi-gui/config.json），主进程不再维护第二份实现

// 执行 IPMI 命令
ipcMain.handle('ipmi:execute', async (event, server, command, args = []) => {
  const ipmitoolPath = getIpmiToolPath();
  if (!ipmitoolPath) {
    return { code: -1, stdout: '', stderr: IPMITOOL_MISSING };
  }

  // 分词支持引号：例 fru write 0 "Board Mfg"
  const cmdArgs = [...buildArgs(server), ...tokenizeCommand(command), ...args];

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
  if (!ipmitoolPath) {
    return { success: false, error: IPMITOOL_MISSING };
  }

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

/**
 * 执行 sol deactivate 释放远端 SOL 会话
 * @returns {Promise<{success:boolean, stderr?:string, error?:string}>}
 */
function deactivateSolSession(server) {
  const ipmitoolPath = getIpmiToolPath();
  if (!ipmitoolPath) {
    return Promise.resolve({ success: false, error: IPMITOOL_MISSING });
  }

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
}

// 停止 SOL（释放远端会话，本地 PTY 由 sol:close 回收）
ipcMain.handle('sol:stop', (event, server) => deactivateSolSession(server));

// 关闭 SOL 标签：强制结束本地 PTY，再 deactivate 远端会话
ipcMain.handle('sol:close', async (event, tabId, server) => {
  const proc = ptyProcesses[tabId];
  if (proc) {
    try { proc.kill(); } catch (e) {}
    delete ptyProcesses[tabId];
  }

  // 没有服务器信息时只做本地清理
  if (!server) return { success: true };

  // 本地 PTY 已回收，仅远端会话无法释放
  if (!getIpmiToolPath()) return { success: true, warning: IPMITOOL_MISSING };

  return deactivateSolSession(server);
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
