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
 * 扫描单个端口 (UDP - IPMI 使用 RMCP/UDP 协议)
 */
function scanPort(ip, port = 623, timeout = 300) {
  return new Promise((resolve) => {
    const dgram = require('dgram');
    const socket = dgram.createSocket('udp4');

    const timer = setTimeout(() => {
      socket.close();
      // UDP 超时 - IPMI 可能不响应未知数据包
      // 但设备可能在线，标记为潜在设备
      resolve(true);
    }, timeout);

    socket.on('message', (msg, rinfo) => {
      clearTimeout(timer);
      socket.close();
      resolve(true);
    });

    socket.on('error', () => {
      clearTimeout(timer);
      socket.close();
      resolve(false);
    });

    // 发送 RMCP 探测包
    const rmcpPacket = Buffer.from([0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x61, 0x00]);
    socket.send(rmcpPacket, 0, rmcpPacket.length, port, ip);
  });
}

/**
 * 扫描单个 TCP 端口
 */
function scanTcpPort(ip, port, timeout = 300) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeout);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => {
      resolve(false);
    });
    socket.connect(port, ip);
  });
}

/**
 * HTTP GET 请求并解析响应
 */
function tryHttpFetch(ip, port, path, timeout, parser) {
  return new Promise((resolve) => {
    const isHttps = port === 443;
    const mod = isHttps ? require('https') : require('http');
    const req = mod.get({
      hostname: ip,
      port: port,
      path: path,
      rejectUnauthorized: false,
      timeout: timeout,
      headers: { 'Accept': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const result = parser(data, res.statusCode);
        resolve(result);
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

/**
 * HTTP 产品探测 - 通过无鉴权 API 获取 BMC 产品名称
 * 先试 AMI /api/fru，再试 openUBMC /UI/Rest/Login
 */
async function httpProbeDevice(ip, port, timeout = 2000) {
  // AMI: /api/fru -> 取 device id=0 的 board.product_name / product.product_name
  const ami = await tryHttpFetch(ip, port, '/api/fru', timeout, (data, statusCode) => {
    if (statusCode !== 200) return null;
    try {
      const json = JSON.parse(data);
      const dev0 = Array.isArray(json) ? json.find(d => d.device && d.device.id === 0) : null;
      if (dev0 && dev0.board && dev0.product) {
        const b = (dev0.board.product_name || '').trim();
        const p = (dev0.product.product_name || '').trim();
        if (b || p) return { source: 'AMI', productName: b + (b && p ? '/' : '') + p };
      }
    } catch (e) {}
    return null;
  });
  if (ami) return ami;

  // openUBMC: /UI/Rest/Login -> 取 ProductName
  const ubmc = await tryHttpFetch(ip, port, '/UI/Rest/Login', timeout, (data, statusCode) => {
    try {
      const json = JSON.parse(data);
      if (json.ProductName) return { source: 'openUBMC', productName: json.ProductName };
    } catch (e) {}
    return null;
  });
  if (ubmc) return ubmc;

  return null;
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

  console.log(`[SCAN] Ping 完成: ${alive.length} 台设备在线`);

  if (scanState.stopped) return scanState.results;

  // 第二步：端口扫描
  let found = [];
  if (alive.length > 0) {
    scanState.phase = 'port';
    if (onProgress) onProgress({ phase: 'port', current: 0, total: alive.length, found: [] });

    // 扫描目标端口：UDP 623 (RMCP) + TCP 623 (RMCP+) + TCP 80/443 (Web)
    const portTargets = [
      { port: 623, proto: 'udp', label: 'UDP:623' },
      { port: 623, proto: 'tcp', label: 'TCP:623' },
      { port: 80,  proto: 'tcp', label: 'TCP:80' },
      { port: 443, proto: 'tcp', label: 'TCP:443' }
    ];

    const portTasks = alive.map(item => {
      return async () => {
        const ip = item.ip;
        const start = Date.now();
        const portResults = {};

        // 并行扫描该主机的所有目标端口
        const scans = portTargets.map(target => {
          if (target.proto === 'udp') return scanPort(ip, target.port, portTimeout);
          return scanTcpPort(ip, target.port, portTimeout);
        });

        const scanResults = await Promise.all(scans);
        portTargets.forEach((target, i) => { portResults[target.label] = scanResults[i]; });

        // HTTP 产品探测（仅对开放 Web 端口的设备）
        let productInfo = null;
        if (portResults['TCP:443'] || portResults['TCP:80']) {
          const webPort = portResults['TCP:443'] ? 443 : 80;
          productInfo = await httpProbeDevice(ip, webPort, 1500).catch(() => null);
        }

        const latency = Date.now() - start;
        const anyOpen = Object.values(portResults).some(v => v === true);
        // 过滤：仅 UDP:623 开放，或 UDP:623 + TCP:80 开放的设备不进入验证
        if (anyOpen && !portResults['TCP:623'] && !portResults['TCP:443']) {
          return null;
        }

        const result = { ip, latency, ports: portResults };
        if (productInfo) {
          result.productName = productInfo.productName;
          result.productSource = productInfo.source;
        }
        return anyOpen ? result : null;
      };
    });

    await runWithLimit(portTasks, portConcurrency, (i, total, allResults) => {
      const current = i + 1;
      scanState.current = current;
      const foundItems = allResults.filter(Boolean);
      scanState.results = foundItems;
      if (onProgress) onProgress({ phase: 'port', current, total, found: foundItems });
    });

  found = scanState.results;
  console.log(`[SCAN] 端口扫描完成: ${found.length} 台设备有开放端口`, found.map(f => ({ ip: f.ip, ports: f.ports, product: f.productName || '-' })));
  }

  // 第三步：IPMI 验证（并行验证，只保留验证成功的 BMC 设备）
  if (found.length > 0) {
    scanState.phase = 'verify';
    console.log(`[SCAN] 开始验证 ${found.length} 台设备:`, found.map(f => f.ip));
    if (onProgress) onProgress({ phase: 'verify', current: 0, total: found.length, found });

    const verifyConcurrency = 5;
    let verifyCurrent = 0;

    const tasks = found.map(device => {
      return async () => {
        const template = await verifyIPMITemplate(device.ip);
        device.template = template;
        device.verified = !!template;

        // openUBMC: 验证通过后取 FRU Board Product 拼合产品名
        if (template === 'openUBMC' && device.productName) {
          const bp = await fetchFruBoardProduct(device.ip);
          if (bp) {
            device.productName = bp + '/' + device.productName;
          }
        }

        // 分析验证失败原因
        if (!template && device.ports && device.ports['TCP:623']) {
          device.verifyHint = 'TCP:623 开放但验证失败，可能是非默认凭据的 AMI BMC';
        }

        verifyCurrent++;
        if (onProgress) onProgress({ phase: 'verify', current: verifyCurrent, total: found.length, found });
        return device;
      };
    });

    await runWithLimit(tasks, verifyConcurrency);

  }
 
  scanState.results = found;

  const verifiedCount = found.filter(d => d.verified).length;
  console.log(`[SCAN] 扫描完成: 共 ${found.length} 台设备（已验证 ${verifiedCount} 台）`);
  found.forEach(f => console.log(`  - ${f.ip}: verified=${f.verified}, template=${f.template || '-'}${f.verifyHint ? ', hint=' + f.verifyHint : ''}`));

  scanState.running = false;
  return scanState.results;
}

/**
 * 验证 IPMI 设备使用哪个模板
 */
async function verifyIPMITemplate(ip, timeout = 1500) {
  // 从配置文件读取凭证
  let templates;
  try {
    templates = require('../config/ipmi-credentials.json').templates;
  } catch (e) {
    // 配置文件读取失败时使用默认值
    templates = [
      { name: 'AMI', username: 'admin', password: 'admin' },
      { name: 'openUBMC', username: 'Administrator', password: 'ttytty`12' },
      { name: 'OpenBMC', username: 'root', password: '0penBmc' }
    ];
  }

  for (const template of templates) {
    try {
      const result = await verifyIPMI(ip, template.username, template.password, timeout);
      if (result.success) {
        return template.name;
      }
    } catch (e) {
      // 验证失败，继续尝试下一个模板
    }
  }
  return null;
}

/**
 * 验证单个 IPMI 设备
 */
async function verifyIPMI(ip, username, password, timeout = 1500) {
  return new Promise((resolve) => {
    const path = require('path');
    const fs = require('fs');

    const searchPaths = [
      path.join(__dirname, '..', '..', '..', 'bin', 'ipmitool.exe'),
      path.join(__dirname, '..', '..', '..', 'app.asar.unpacked', 'bin', 'ipmitool.exe'),
      path.join(__dirname, '..', '..', 'bin', 'ipmitool.exe')
    ];

    let ipmitoolPath = searchPaths[0];
    for (const p of searchPaths) {
      if (fs.existsSync(p)) {
        ipmitoolPath = p;
        break;
      }
    }

    const args = [
      '-H', ip,
      '-U', username,
      '-P', password,
      '-I', 'lanplus',
      '-C', '17',
      '-N', '1',
      '-R', '0',
      'raw', '6', '1'
    ];

    const proc = exec(
      `"${ipmitoolPath}" ${args.map(a => `"${a}"`).join(' ')}`,
      { timeout, windowsHide: true },
      (err, stdout, stderr) => {
        const hasHexOutput = stdout && /^[0-9a-f\s]+$/i.test(stdout.trim());
        const hasNoAuthError = !stderr || (
          !stderr.includes('unauthorized') &&
          !stderr.includes('authentication') &&
          !stderr.includes('Invalid password') &&
          !stderr.includes('RAKP') &&
          !stderr.includes('SOL')
        );

        const success = !err && hasHexOutput && hasNoAuthError;

        resolve({
          success,
          output: stdout ? stdout.trim() : '',
          error: stderr ? stderr.trim() : ''
        });
      }
    );

    proc.on('error', (e) => {
      resolve({ success: false, error: '执行失败: ' + e.message });
    });
  });
}

/**
 * 获取 openUBMC 设备的 FRU Board Product
 * 使用默认凭据运行 ipmitool fru print 0，解析 Board Product 字段
 */
async function fetchFruBoardProduct(ip, timeout = 1500) {
  const username = 'Administrator';
  const password = 'ttytty`12';

  return new Promise((resolve) => {
    const path = require('path');
    const fs = require('fs');

    const searchPaths = [
      path.join(__dirname, '..', '..', '..', 'bin', 'ipmitool.exe'),
      path.join(__dirname, '..', '..', '..', 'app.asar.unpacked', 'bin', 'ipmitool.exe'),
      path.join(__dirname, '..', '..', 'bin', 'ipmitool.exe')
    ];

    let ipmitoolPath = searchPaths[0];
    for (const p of searchPaths) {
      if (fs.existsSync(p)) { ipmitoolPath = p; break; }
    }

    const args = [
      '-H', ip,
      '-U', username,
      '-P', password,
      '-I', 'lanplus',
      '-C', '17',
      'fru', 'print', '0'
    ];

    const proc = exec(
      '"' + ipmitoolPath + '" ' + args.map(a => '"' + a + '"').join(' '),
      { timeout, windowsHide: true },
      (err, stdout, stderr) => {
        if (stdout) {
          const match = stdout.match(/Board Product\s*:\s*(.+)/m);
          if (match) resolve(match[1].trim());
          else resolve(null);
        } else {
          resolve(null);
        }
      }
    );

    proc.on('error', () => resolve(null));
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
  scanTcpPort,
  tryHttpFetch,
  httpProbeDevice,
  fetchFruBoardProduct,
  pingScan,
  portScan,
  fullScan,
  getScanState,
  stopScan
};
