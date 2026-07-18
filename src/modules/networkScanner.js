/**
 * 网络扫描模块 - 发现 IPMI 设备
 */

const { execSync } = require('child_process');
const net = require('net');
const os = require('os');

// 扫描状态
let scanState = {
  running: false,
  stopped: false,
  results: [],
  current: 0,
  total: 0,
  phase: '' // 'ping' | 'port' | 'verify'
};

/**
 * 获取本机网络信息
 */
function getLocalNetwork() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        const ip = iface.address;
        const parts = ip.split('.');
        return {
          ip,
          subnet: `${parts[0]}.${parts[1]}.${parts[2]}`,
          mask: iface.netmask,
          interface: name
        };
      }
    }
  }
  return null;
}

/**
 * Ping 单个主机
 */
function pingHost(ip, timeout = 200) {
  try {
    const flag = process.platform === 'win32' ? '-n' : '-c';
    const timeoutFlag = process.platform === 'win32' ? '-w' : '-W';
    execSync(`ping ${flag} 1 ${timeoutFlag} ${Math.ceil(timeout / 1000)} ${ip}`, {
      timeout: timeout + 200,
      stdio: 'pipe',
      windowsHide: true
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * 扫描单个端口
 */
function scanPort(ip, port = 623, timeout = 200) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeout);

    socket.connect(port, ip, () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });

    socket.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/**
 * 并发执行器
 */
async function parallel(tasks, concurrency) {
  const results = [];
  let index = 0;

  const worker = async () => {
    while (index < tasks.length && !scanState.stopped) {
      const i = index++;
      results[i] = await tasks[i]();
    }
  };

  await Promise.all(Array(Math.min(concurrency, tasks.length)).fill(null).map(() => worker()));
  return results;
}

/**
 * Ping 扫描网段
 */
async function pingScan(subnet, options = {}) {
  const { concurrency = 50, timeout = 200, onProgress } = options;
  const alive = [];
  let current = 0;
  const total = 254;

  scanState = { running: true, stopped: false, results: [], current: 0, total, phase: 'ping' };

  const tasks = Array.from({ length: total }, (_, i) => {
    return async () => {
      if (scanState.stopped) return null;
      const ip = `${subnet}.${i + 1}`;
      const isAlive = pingHost(ip, timeout);
      current++;
      scanState.current = current;
      if (isAlive) {
        alive.push(ip);
        scanState.results = [...alive];
      }
      if (onProgress) onProgress(current, total, alive);
      return isAlive ? ip : null;
    };
  });

  await parallel(tasks, concurrency);
  scanState.running = false;
  return alive;
}

/**
 * 端口扫描
 */
async function portScan(ips, options = {}) {
  const { concurrency = 20, timeout = 200, onProgress } = options;
  const found = [];
  let current = 0;
  const total = ips.length;

  scanState = { running: true, stopped: false, results: [], current: 0, total, phase: 'port' };

  const tasks = ips.map(ip => {
    return async () => {
      if (scanState.stopped) return null;
      const isOpen = await scanPort(ip, 623, timeout);
      current++;
      scanState.current = current;
      if (isOpen) {
        found.push({ ip, latency: 0 });
        scanState.results = [...found];
      }
      if (onProgress) onProgress(current, total, found);
      return isOpen ? ip : null;
    };
  });

  await parallel(tasks, concurrency);
  scanState.running = false;
  return found;
}

/**
 * 完整扫描流程：Ping → 端口扫描
 */
async function fullScan(subnet, options = {}) {
  const {
    pingConcurrency = 50,
    pingTimeout = 200,
    portConcurrency = 20,
    portTimeout = 200,
    onProgress
  } = options;

  scanState = { running: true, stopped: false, results: [], current: 0, total: 254, phase: 'ping' };

  // 第一步：Ping 扫描
  if (onProgress) onProgress({ phase: 'ping', current: 0, total: 254, found: [] });

  const alive = await pingScan(subnet, {
    concurrency: pingConcurrency,
    timeout: pingTimeout,
    onProgress: (current, total, found) => {
      scanState.current = current;
      scanState.total = total;
      scanState.results = found.map(ip => ({ ip, latency: 0 }));
      if (onProgress) onProgress({ phase: 'ping', current, total, found });
    }
  });

  if (scanState.stopped) return scanState.results;

  // 第二步：端口扫描
  if (alive.length > 0) {
    scanState.phase = 'port';
    if (onProgress) onProgress({ phase: 'port', current: 0, total: alive.length, found: [] });

    const found = await portScan(alive, {
      concurrency: portConcurrency,
      timeout: portTimeout,
      onProgress: (current, total, found) => {
        scanState.current = current;
        scanState.total = total;
        scanState.results = found;
        if (onProgress) onProgress({ phase: 'port', current, total, found });
      }
    });

    scanState.results = found;
  }

  scanState.running = false;
  return scanState.results;
}

/**
 * 验证 IPMI 设备
 */
async function verifyIPMI(ip, username, password, timeout = 2000) {
  const ipmitoolPath = require('./configStore').getIpmiToolPath ? 
    require('./configStore').getIpmiToolPath() : 'ipmitool.exe';

  return new Promise((resolve) => {
    const cmd = `"${ipmitoolPath}" -H ${ip} -U ${username} -P ${password} -I lanplus -C 17 -N 1 -R 0 raw 6 1`;

    const proc = require('child_process').exec(cmd, { timeout, windowsHide: true }, (err, stdout, stderr) => {
      resolve({
        success: !err && stdout.trim().length > 0,
        output: stdout.trim(),
        error: stderr
      });
    });

    proc.on('error', () => resolve({ success: false, error: '执行失败' }));
  });
}

/**
 * 获取扫描状态
 */
function getScanState() {
  return { ...scanState };
}

/**
 * 停止扫描
 */
function stopScan() {
  scanState.stopped = true;
}

module.exports = {
  getLocalNetwork,
  pingHost,
  scanPort,
  pingScan,
  portScan,
  fullScan,
  verifyIPMI,
  getScanState,
  stopScan
};
