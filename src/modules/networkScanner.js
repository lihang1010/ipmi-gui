/**
 * 网络扫描模块 - 发现 IPMI 设备 (异步版本)
 */

const { exec } = require('child_process');
const net = require('net');
const os = require('os');

let scanState = {
  running: false,
  stopped: false,
  results: [],
  current: 0,
  total: 0,
  phase: ''
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
 * Ping 单个主机 (异步)
 */
function pingHost(ip, timeout = 200) {
  return new Promise((resolve) => {
    const flag = process.platform === 'win32' ? '-n' : '-c';
    const timeoutFlag = process.platform === 'win32' ? '-w' : '-W';
    const timeoutSec = Math.max(1, Math.ceil(timeout / 1000));

    const proc = exec(
      `ping ${flag} 1 ${timeoutFlag} ${timeoutSec} ${ip}`,
      { timeout: timeout + 500, windowsHide: true },
      (error) => {
        resolve(!error);
      }
    );

    proc.on('error', () => resolve(false));
  });
}

/**
 * 扫描单个端口 (异步)
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
 * 限制并发的异步执行器
 */
async function runWithLimit(tasks, limit, onItemDone) {
  const results = [];
  let index = 0;

  const worker = async () => {
    while (index < tasks.length && !scanState.stopped) {
      const i = index++;
      try {
        results[i] = await tasks[i]();
      } catch (e) {
        results[i] = null;
      }
      if (onItemDone) onItemDone(i, tasks.length, results);
    }
  };

  const workers = [];
  for (let i = 0; i < Math.min(limit, tasks.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

/**
 * Ping 扫描网段
 */
async function pingScan(subnet, options = {}) {
  const { concurrency = 30, timeout = 300, onProgress } = options;
  const alive = [];
  let current = 0;
  const total = 254;

  scanState = { running: true, stopped: false, results: [], current: 0, total, phase: 'ping' };

  const tasks = [];
  for (let i = 1; i <= total; i++) {
    const ip = `${subnet}.${i}`;
    tasks.push(async () => {
      const isAlive = await pingHost(ip, timeout);
      return isAlive ? ip : null;
    });
  }

  const results = await runWithLimit(tasks, concurrency, (i, total, results) => {
    current = i + 1;
    scanState.current = current;
    const found = results.filter(Boolean).filter(r => r !== null);
    scanState.results = found.map(ip => ({ ip, latency: 0 }));
    if (onProgress) onProgress(current, total, found.map(ip => ({ ip, latency: 0 })));
  });

  const found = results.filter(Boolean).filter(r => r !== null).map(ip => ({ ip, latency: 0 }));
  scanState.running = false;
  return found;
}

/**
 * 端口扫描
 */
async function portScan(ips, options = {}) {
  const { concurrency = 10, timeout = 300, onProgress } = options;
  const found = [];
  let current = 0;
  const total = ips.length;

  scanState = { running: true, stopped: false, results: [], current: 0, total, phase: 'port' };

  const tasks = ips.map(ip => {
    return async () => {
      const start = Date.now();
      const isOpen = await scanPort(ip, 623, timeout);
      const latency = Date.now() - start;
      return isOpen ? { ip, latency } : null;
    };
  });

  const results = await runWithLimit(tasks, concurrency, (i, total, allResults) => {
    current = i + 1;
    scanState.current = current;
    const foundItems = allResults.filter(Boolean);
    scanState.results = foundItems;
    if (onProgress) onProgress(current, total, foundItems);
  });

  const foundItems = results.filter(Boolean);
  scanState.running = false;
  return foundItems;
}

/**
 * 完整扫描流程：Ping → 端口扫描
 */
async function fullScan(subnet, options = {}) {
  const {
    pingConcurrency = 30,
    pingTimeout = 300,
    portConcurrency = 10,
    portTimeout = 300,
    onProgress
  } = options;

  scanState = { running: true, stopped: false, results: [], current: 0, total: 254, phase: 'ping' };

  // 第一步：Ping 扫描
  if (onProgress) onProgress({ phase: 'ping', current: 0, total: 254, found: [] });

  const alive = await pingScan(subnet, {
    concurrency: pingConcurrency,
    timeout: pingTimeout,
    onProgress: (current, total, found) => {
      if (onProgress) onProgress({ phase: 'ping', current, total, found });
    }
  });

  if (scanState.stopped) return scanState.results;

  // 第二步：端口扫描
  let found = [];
  if (alive.length > 0) {
    scanState.phase = 'port';
    if (onProgress) onProgress({ phase: 'port', current: 0, total: alive.length, found: [] });

    found = await portScan(alive.map(a => a.ip), {
      concurrency: portConcurrency,
      timeout: portTimeout,
      onProgress: (current, total, f) => {
        if (onProgress) onProgress({ phase: 'port', current, total, found: f });
      }
    });
  }

  // 第三步：IPMI 验证
  if (found.length > 0) {
    scanState.phase = 'verify';
    if (onProgress) onProgress({ phase: 'verify', current: 0, total: found.length, found });

    for (let i = 0; i < found.length; i++) {
      if (scanState.stopped) break;
      const device = found[i];
      const template = await verifyIPMITemplate(device.ip);
      device.template = template;
      if (onProgress) onProgress({ phase: 'verify', current: i + 1, total: found.length, found });
    }
  }

  scanState.results = found;

  scanState.running = false;
  return scanState.results;
}

/**
 * 验证 IPMI 设备使用哪个模板
 */
async function verifyIPMITemplate(ip, timeout = 3000) {
  const templates = [
    { name: 'openUBMC', username: 'Administrator', password: 'ttytty`12' },
    { name: 'AMI', username: 'admin', password: 'admin' },
    { name: 'OpenBMC', username: 'root', password: '0penBmc' }
  ];

  for (const template of templates) {
    try {
      const result = await verifyIPMI(ip, template.username, template.password, timeout);
      if (result.success) {
        return template.name;
      }
    } catch (e) {
      // 继续尝试下一个模板
    }
  }
  return null;
}

/**
 * 验证单个 IPMI 设备
 */
async function verifyIPMI(ip, username, password, timeout = 3000) {
  return new Promise((resolve) => {
    // 尝试 lanplus 接口
    const ipmitoolPath = require('path').join(__dirname, '..', '..', 'bin', 'ipmitool.exe');
    const args = [
      '-H', ip,
      '-U', username,
      '-P', password,
      '-I', 'lanplus',
      '-C', '17',
      '-N', '2',
      '-R', '1',
      'raw', '6', '1'
    ];

    const proc = exec(
      `"${ipmitoolPath}" ${args.map(a => `"${a}"`).join(' ')}`,
      { timeout, windowsHide: true },
      (err, stdout, stderr) => {
        // 成功条件：没有错误，或者错误信息不包含 "unauthorized" / "authentication"
        const success = !err || 
          (stderr && !stderr.includes('unauthorized') && 
           !stderr.includes('authentication') && 
           !stderr.includes('Invalid password') &&
           !stderr.includes('RAKP'));
        
        resolve({
          success,
          output: stdout ? stdout.trim() : '',
          error: stderr ? stderr.trim() : ''
        });
      }
    );

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
  getScanState,
  stopScan
};
