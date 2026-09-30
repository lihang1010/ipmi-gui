/**
 * 网络扫描模块 - 发现 IPMI 设备 (异步版本)
 */

const { exec, execFile } = require('child_process');
const net = require('net');
const os = require('os');
const { resolveIpmiToolPath } = require('./ipmiTool');
const { getCredentialTemplates, getCredentialByName } = require('./credentials');
const { formatBmcVersion } = require('./bmcVersion');

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
    const isWindows = process.platform === 'win32';
    const flag = isWindows ? '-n' : '-c';
    const timeoutFlag = isWindows ? '-w' : '-W';
    // Windows 的 -w 单位为毫秒，Linux 的 -W 单位为秒
    const timeoutValue = isWindows
      ? Math.max(1, Math.round(timeout))
      : Math.max(1, Math.ceil(timeout / 1000));

    const proc = exec(
      `ping ${flag} 1 ${timeoutFlag} ${timeoutValue} ${ip}`,
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

    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      try { socket.close(); } catch (e) {}
      resolve(result);
    };

    const timer = setTimeout(() => done(false), timeout);

    socket.on('message', () => {
      clearTimeout(timer);
      done(true);
    });

    socket.on('error', () => {
      clearTimeout(timer);
      done(false);
    });

    // RMCP Presence Ping (ASF): 06 00 00 07 | 00 00 11 BE | 80 00 00 00
    const rmcpPacket = Buffer.from([
      0x06, 0x00, 0x00, 0x07,
      0x00, 0x00, 0x11, 0xBE,
      0x80, 0x00, 0x00, 0x00
    ]);
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

/** 点分十进制 IPv4 → 32 位无符号整数；非法返回 null */
function ipToInt(ip) {
  const parts = String(ip == null ? '' : ip).trim().split('.');
  if (parts.length !== 4) return null;

  let value = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const n = parseInt(part, 10);
    if (n > 255) return null;
    // 用乘法而非左移：128.x 以上用 << 会把符号位带进来
    value = value * 256 + n;
  }
  return value;
}

/** 32 位无符号整数 → 点分十进制 */
function intToIp(value) {
  return [
    Math.floor(value / 16777216) % 256,
    Math.floor(value / 65536) % 256,
    Math.floor(value / 256) % 256,
    value % 256
  ].join('.');
}

/** 单次展开的主机数上限，避免 /16 之类的极端输入把内存撑爆 */
const MAX_SCAN_HOSTS = 65536;

/**
 * 将网段 + CIDR 前缀展开为主机列表
 * 支持 /16 ~ /30 全范围，按 32 位整数做子网运算
 *
 * 与旧实现的三点区别：
 *  1. 不再把下限卡在 /24 —— /22、/16 这类大网段能正确展开
 *  2. 不再只看前三段 —— '192.168.1.128' + /25 会先把该地址按掩码对齐到
 *     网络号 192.168.1.128，再展开 .129 ~ .254；旧实现永远只能扫 0 段的 /25
 *  3. /22 会正确跨网段（192.168.0.0 ~ 192.168.3.255），不再被截断成 254 个
 *
 * @param {string} ipOrPrefix 完整 IP（192.168.1.128）或前三段（192.168.1）
 * @param {number} cidr 前缀长度 16 ~ 30，非法值按 24
 * @returns {string[]} 主机 IP 列表（不含网络号与广播地址）
 */
function cidrToHosts(ipOrPrefix, cidr = 24) {
  let raw = String(ipOrPrefix == null ? '' : ipOrPrefix).trim();
  // 兼容旧调用：三段式补成四段
  if (/^\d+\.\d+\.\d+$/.test(raw)) raw += '.0';

  const parsed = parseInt(cidr, 10);
  const bits = Math.min(30, Math.max(16, isNaN(parsed) ? 24 : parsed));

  const ipInt = ipToInt(raw);
  if (ipInt === null) return [];

  const mask = (0xFFFFFFFF << (32 - bits)) >>> 0;
  const network = (ipInt & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;

  const hosts = [];
  for (let value = network + 1; value < broadcast && hosts.length < MAX_SCAN_HOSTS; value++) {
    hosts.push(intToIp(value));
  }
  return hosts;
}

/**
 * Ping 扫描
 * @param {string|string[]} subnetOrHosts 网段（兼容旧调用，缺省按 /24）或显式主机列表
 */
async function pingScan(subnetOrHosts, options = {}) {
  const { concurrency = 30, timeout = 300, onProgress } = options;
  const ips = Array.isArray(subnetOrHosts) ? subnetOrHosts : cidrToHosts(subnetOrHosts, 24);
  let current = 0;
  const total = ips.length;

  scanState = { running: true, stopped: false, results: [], current: 0, total, phase: 'ping' };

  const tasks = ips.map(ip => async () => {
    const isAlive = await pingHost(ip, timeout);
    return isAlive ? ip : null;
  });

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
 * 完整扫描流程：Ping（可选）→ 端口扫描 → IPMI 验证
 * @param {object} options
 *   usePing=false 时跳过 Ping，直接对全部目标地址做端口扫描
 *   （可发现禁 Ping 设备，但探测次数更多、更慢）
 */
async function fullScan(subnet, options = {}) {
  const {
    pingConcurrency = 30,
    pingTimeout = 300,
    portConcurrency = 10,
    portTimeout = 300,
    hosts = null,
    usePing = true,
    onProgress
  } = options;

  const targetHosts = (hosts && hosts.length) ? hosts : cidrToHosts(subnet, 24);

  scanState = { running: true, stopped: false, results: [], current: 0, total: targetHosts.length, phase: 'ping' };

  let alive = [];

  if (usePing) {
    // 第一步：Ping 扫描
    if (onProgress) onProgress({ phase: 'ping', current: 0, total: targetHosts.length, found: [] });

    alive = await pingScan(targetHosts, {
      concurrency: pingConcurrency,
      timeout: pingTimeout,
      onProgress: (current, total, found) => {
        if (onProgress) onProgress({ phase: 'ping', current, total, found });
      }
    });

    console.log(`[SCAN] Ping 完成: ${alive.length} 台设备在线`);

    if (scanState.stopped) return scanState.results;
  } else {
    // 跳过 Ping：所有目标地址直接进入端口扫描
    alive = targetHosts.map(ip => ({ ip, latency: 0 }));
    scanState.total = alive.length;
    scanState.phase = 'port';
    console.log(`[SCAN] 跳过 Ping，直接对 ${alive.length} 个地址做端口扫描`);

    if (onProgress) onProgress({ phase: 'port', current: 0, total: alive.length, found: [] });
  }

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

        // 通讯验证成功后补充信息（mc info 版本号 / FRU 产品名）
        if (template) {
          const credential = getCredentialByName(template);
          if (credential) {
            device.bmcVersion = await fetchBmcVersion(device.ip, credential, template);
          }

          // openUBMC: 取 FRU Board Product 拼合产品名
          if (template === 'openUBMC' && device.productName) {
            const bp = await fetchFruBoardProduct(device.ip);
            if (bp) {
              device.productName = bp + '/' + device.productName;
            }
          }
        }

        // 分析验证失败原因
        if (!template && device.ports) {
          const allPortsOpen = device.ports['UDP:623'] && device.ports['TCP:623'] && device.ports['TCP:80'] && device.ports['TCP:443'];
          if (allPortsOpen) {
            // 完整 BMC 端口特征 (UDP/TCP 623 + 80 + 443)：多为 AMI BMC
            device.verifyHint = '检测到完整 BMC 端口 (UDP:623/TCP:623/80/443)，验证失败，可能是非默认凭据的 AMI BMC';
            device.verifyHintType = 'ami';
          } else if (device.ports['TCP:623']) {
            device.verifyHint = 'TCP:623 开放但验证失败，可能是非默认凭据的 AMI BMC';
          }
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
  const templates = getCredentialTemplates();

  for (const template of templates) {
    try {
      const result = await verifyIPMI(ip, template, timeout);
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
 * 执行一条 ipmitool 命令
 * 使用 execFile：参数不经 shell，凭据含引号/&/| 等字符也不会破坏命令。
 * -N 1 -R 0：不做重试，配合 timeout 快速失败
 * @param {object} credential { username, password, interface?, cipherSuite? }
 * @returns {Promise<{ok: boolean, stdout: string, stderr: string, error: string}>}
 */
function runIpmiCommand(ip, credential, commandArgs, timeout = 1500) {
  return new Promise((resolve) => {
    // 参数校验：execFile 遇到 undefined 会抛错，这里提前给出明确原因
    if (!credential || !credential.username || !credential.password) {
      resolve({ ok: false, stdout: '', stderr: '', error: '凭据缺失（需要 username 与 password）' });
      return;
    }

    const ipmitoolPath = resolveIpmiToolPath();
    if (!ipmitoolPath) {
      resolve({ ok: false, stdout: '', stderr: '', error: '未找到 ipmitool.exe' });
      return;
    }

    const args = [
      '-H', ip,
      '-U', credential.username,
      '-P', credential.password,
      '-I', credential.interface || 'lanplus',
      '-C', String(credential.cipherSuite || 17),
      '-N', '1',
      '-R', '0',
      ...commandArgs
    ];

    execFile(ipmitoolPath, args, { timeout, windowsHide: true }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        stdout: stdout ? stdout.trim() : '',
        stderr: stderr ? stderr.trim() : '',
        error: err ? err.message : ''
      });
    });
  });
}

/**
 * 验证单个 IPMI 设备
 */
async function verifyIPMI(ip, credential, timeout = 1500) {
  const result = await runIpmiCommand(ip, credential, ['raw', '6', '1'], timeout);

  const hasHexOutput = /^[0-9a-f\s]+$/i.test(result.stdout);
  const hasNoAuthError = !result.stderr || (
    !result.stderr.includes('unauthorized') &&
    !result.stderr.includes('authentication') &&
    !result.stderr.includes('Invalid password') &&
    !result.stderr.includes('RAKP') &&
    !result.stderr.includes('SOL')
  );

  return {
    success: result.ok && hasHexOutput && hasNoAuthError,
    output: result.stdout,
    error: result.stderr || result.error
  };
}

/**
 * 获取 openUBMC 设备的 FRU Board Product
 * 使用默认凭据运行 ipmitool fru print 0，解析 Board Product 字段
 */
async function fetchFruBoardProduct(ip, timeout = 1500) {
  // 仅 openUBMC 设备会走到这里，凭据同样取自统一配置
  const credential = getCredentialByName('openUBMC');
  if (!credential) return null;

  const result = await runIpmiCommand(ip, credential, ['fru', 'print', '0'], timeout);
  if (!result.stdout) return null;

  const match = result.stdout.match(/Board Product\s*:\s*(.+)/m);
  return match ? match[1].trim() : null;
}

/**
 * 获取 BMC 版本号（仅在 IPMI 通讯验证成功后调用）
 * 执行 mc info，取 Firmware Revision 为主版本号并按厂商规则拼接 Aux Firmware Rev Info
 * @returns {Promise<string>} 如 '1.11.1109'，失败返回 ''
 */
async function fetchBmcVersion(ip, credential, templateName, timeout = 2000) {
  if (!credential) return '';

  const result = await runIpmiCommand(ip, credential, ['mc', 'info'], timeout);
  if (!result.stdout) return '';

  return formatBmcVersion(result.stdout, templateName);
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
  cidrToHosts,
  MAX_SCAN_HOSTS,
  pingHost,
  scanPort,
  scanTcpPort,
  tryHttpFetch,
  httpProbeDevice,
  runIpmiCommand,
  fetchFruBoardProduct,
  fetchBmcVersion,
  pingScan,
  portScan,
  fullScan,
  getScanState,
  stopScan
};
