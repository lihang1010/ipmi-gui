const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const pty = require('node-pty');
const { buildArgs, resolveIpmiToolPath, tokenizeCommand } = require('./src/modules/ipmiTool');
const { getLocalNetwork, cidrToHosts, fullScan, stopScan } = require('./src/modules/networkScanner');

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

// 当前应用版本（取自 package.json 的 version，自动更新也以它作为比对基准）
ipcMain.handle('app:getVersion', () => app.getVersion());

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
ipcMain.handle('file:save', async (event, defaultName, content, filters) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters: filters || [
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

// ========== 网络扫描 ==========
// 扫描在渲染进程会直接使用 child_process / dgram / net / http，
// 统一放到主进程执行，渲染层只负责展示与进度。

// 获取本机网段
ipcMain.handle('scan:getLocalNetwork', () => getLocalNetwork());

// 开始扫描，进度通过 scan:progress 推送
ipcMain.handle('scan:start', async (event, options = {}) => {
  // usePing 默认 false：实测直接扫端口比先 Ping 更快（约 3 倍）也更全
  //（禁 Ping 的设备只有跳过 Ping 才扫得到）
  const { network, cidr = 24, timeout = 200, usePing = false } = options || {};
  if (!network) {
    return { success: false, error: '缺少网段参数' };
  }

  try {
    const results = await fullScan(network, {
      hosts: cidrToHosts(network, cidr),
      usePing: usePing !== false,
      // 并发 40 是实测的折中点。慢的根源是不存在地址的 ARP 等待（约 2~3s，
      // -w 管不到），只能靠并发压缩批次：62 个地址实测 15→10.3s、40→5.6s。
      // 原值 50 之所以不稳，是因为「单包 + exec 硬超时仅 700ms」—— ping.exe
      // 还没起来就被 kill，在线设备被判离线。这两条已在 pingHost 里修掉
      //（2 个包、硬超时 count*timeout+2000），并发 60 也复测过稳定。
      pingConcurrency: 40,
      pingTimeout: timeout,
      portConcurrency: 20,
      portTimeout: timeout,
      onProgress: (info) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('scan:progress', info);
        }
      }
    });
    return { success: true, results };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 停止扫描
ipcMain.handle('scan:stop', () => {
  stopScan();
  return { success: true };
});

// ========== 自动更新 ==========

/**
 * 当前更新状态
 *
 * 流转：idle → checking → available → downloading → ready
 *                          ↘ none（已是最新）
 *      任意阶段出错 → error；未打包运行 → skipped
 * 渲染进程既可在启动时用 update:getStatus 拉取，也会收到 update:status 推送。
 */
let updateStatus = { state: 'idle' };

/** 更新状态变化时通知渲染进程（窗口还没建好时只记录，由渲染进程主动拉取） */
function pushUpdateStatus(patch) {
  updateStatus = Object.assign({}, updateStatus, patch);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update:status', updateStatus);
  }
}

/**
 * 接线 electron-updater
 *
 * - 发现新版本后**自动后台下载**，但**不自动安装**。SOL 会话和正在执行的命令经不起
 *   重启，何时重启交给用户在顶栏决定。`autoInstallOnAppQuit` 保持默认，用户正常退出
 *   时会顺带装上，这条路径是无感的
 * - 任何失败都只更新状态，**绝不阻塞启动** —— 内网更新源不可达是常态
 */
function setupAutoUpdater() {
  if (!app.isPackaged) {
    pushUpdateStatus({ state: 'skipped', reason: '开发模式（未打包）跳过更新检查' });
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.autoRunAppAfterInstall = true;

  autoUpdater.on('checking-for-update', () => pushUpdateStatus({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => pushUpdateStatus({ state: 'available', version: info.version }));
  autoUpdater.on('update-not-available', (info) => pushUpdateStatus({ state: 'none', version: info && info.version }));
  autoUpdater.on('download-progress', (progress) => {
    pushUpdateStatus({ state: 'downloading', percent: Math.round(progress.percent) });
  });
  autoUpdater.on('update-downloaded', (info) => pushUpdateStatus({ state: 'ready', version: info.version }));
  autoUpdater.on('error', (err) => {
    pushUpdateStatus({ state: 'error', error: (err && err.message) || String(err) });
  });

  // 延迟几秒，避开启动时读取服务器列表 / FRU 的流量
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {
      // 失败已由 error 事件接管，这里只是避免未处理的 rejection
    });
  }, 5000);
}

ipcMain.handle('update:getStatus', () => updateStatus);

ipcMain.handle('update:check', async () => {
  if (!app.isPackaged) return updateStatus;
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    pushUpdateStatus({ state: 'error', error: err.message });
  }
  return updateStatus;
});

ipcMain.handle('update:install', () => {
  if (updateStatus.state !== 'ready') {
    return { ok: false, error: '还没有可安装的更新' };
  }
  // isSilent=false：配置里 nsis.oneClick 为 false，交给安装向导更可靠
  // isForceRunAfter=true：装完自动把应用拉起来
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return { ok: true };
});

// ========== 单实例 ==========

// 更新重启与重复双击都不该开出第二个窗口；拿不到锁的实例直接退出
// （app.quit() 是异步的，下面的 whenReady 可能仍被登记，但进程会随即结束）
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

// ========== 生命周期 ==========

app.whenReady().then(() => {
  createWindow();
  setupAutoUpdater();
});

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
