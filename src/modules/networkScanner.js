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
 *
 * 默认发 2 个包而不是 1 个：单包丢一次就把在线设备判死，高并发下漏报明显
 *（实测同一网段连续扫描，Ping 命中的设备数能在 7 ~ 29 之间乱跳）。
 *
 * exec 的硬超时也必须留足余量：并发拉起几十个 ping.exe 时，进程创建本身
 * 就可能吃掉几百毫秒，若卡在 ping 自身的超时上，活着的设备会被误杀。
 *
 * @param {string} ip
 * @param {number} timeout 单个包的等待时间（Windows 的 -w 为毫秒，Linux 的 -W 为秒）
 * @param {number} packets 发送的 ICMP 包数，任一包有回应即视为在线
 */
function pingHost(ip, timeout = 200, packets = 2) {
  return new Promise((resolve) => {
    const isWindows = process.platform === 'win32';
    const flag = isWindows ? '-n' : '-c';
    const timeoutFlag = isWindows ? '-w' : '-W';
    // Windows 的 -w 单位为毫秒，Linux 的 -W 单位为秒
    const timeoutValue = isWindows
      ? Math.max(1, Math.round(timeout))
      : Math.max(1, Math.ceil(timeout / 1000));
    const count = Math.max(1, packets || 1);

    const proc = exec(
      `ping ${flag} ${count} ${timeoutFlag} ${timeoutValue} ${ip}`,
      // 余量按包数放大，另加 2s 覆盖并发下的进程创建开销
      { timeout: count * timeout + 2000, windowsHide: true },
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
      // 必须显式 destroy：高并发下漏掉会累积 fd，后续探测可能因资源不足失败（表现为"漏报"）
      socket.destroy();
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
 *
 * usePing=false（默认，UI 里的「Ping 预探测」不勾选）直接对全部目标地址扫端口。
 * 实测这比先 Ping 更快也更全：
 *   - Ping 走外部 ping.exe 进程，exec 硬超时 2.4s 起步，且对不存在的地址要等满
 *     ARP 解析失败（约 2~3s，-w 管不到）
 *   - 端口探测用 net.Socket.setTimeout，到点即返回（0.2s 级），不受 ARP 影响
 *   - 禁 Ping 的设备只有跳过 Ping 才扫描得到（实测就漏过一台）
 * usePing=true 时先 Ping 筛存活，可减少端口探测的流量，但更慢。
 *
 * 准入规则（曾经漏报的根源）：ipmitool 的 IPMI over LAN 走 **UDP 623**。
 * 旧规则要求「TCP:623 或 TCP:443 开放」才进入验证，会把只开 UDP:623 的设备
 * （部分老 BMC / 定制机型）整台丢掉。现在 UDP:623 与 TCP:623/443 同等对待；
 * 只有 Web 端口（80）开放的一律不验证 —— 那是普通 HTTP 服务的特征，
 * 放进来会让 /24 网段多花几分钟在无意义的 4 模板尝试上。
 *
 * @param {object} options
 * @param {object[]} [options.hosts] 显式主机列表（优先于 subnet+cidr 展开）
 * @param {boolean} [options.usePing] 是否先做 ICMP 预探测
 * @param {boolean} [options.detailLog] 是否逐地址记录「无开放端口」等明细
 * @param {string} [options.label] 日志里展示的网段标签，如 192.168.60.0/24
 * @param {Function} [options.onLog] 日志回调，收 {time, level, ip, message}
 * @param {Function} [options.onProgress] 进度回调
 */
async function fullScan(subnet, options = {}) {
  const {
    pingConcurrency = 30,
    pingTimeout = 300,
    portConcurrency = 10,
    portTimeout = 300,
    verifyTimeout = 1500,
    hosts = null,
    usePing = true,
    detailLog = false,
    label = '',
    onProgress,
    onLog
  } = options;

  const targetHosts = (hosts && hosts.length) ? hosts : cidrToHosts(subnet, 24);
  const startedAt = Date.now();

  /**
   * 统一日志出口
   * time 用相对扫描开始的毫秒数，在这里打点，保证时间轴与真实执行顺序一致
   *（不能等渲染层收到 IPC 再打点，那会被事件队列延迟污染）
   */
  const log = (level, ip, message) => {
    if (!onLog) return;
    try {
      onLog({ time: Date.now() - startedAt, level, ip: ip || '', message });
    } catch (e) {
      // 日志回调异常不能打断扫描
    }
  };

  scanState = { running: true, stopped: false, results: [], current: 0, total: targetHosts.length, phase: 'ping' };

  log('info', null,
    '目标 ' + targetHosts.length + ' 个地址' + (label ? '（' + label + '）' : '') +
    '，端口超时 ' + portTimeout + 'ms，Ping 预探测：' + (usePing ? '开' : '关') +
    '，详细日志：' + (detailLog ? '开' : '关'));

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

    log('info', null, 'Ping 预探测完成：存活 ' + alive.length + ' 台（用时 ' + formatElapsed(Date.now() - startedAt) + '）');
    if (alive.length === 0) {
      log('warn', null, '没有地址响应 Ping。若确认设备在线，请关闭「Ping 预探测」重扫 —— 禁 Ping 的设备会被这一步整台漏掉');
    }

    if (scanState.stopped) {
      log('warn', null, '扫描已被用户停止（Ping 阶段）');
      scanState.running = false;
      return scanState.results;
    }
  } else {
    // 跳过 Ping：所有目标地址直接进入端口扫描
    alive = targetHosts.map(ip => ({ ip, latency: 0 }));
    scanState.total = alive.length;
    scanState.phase = 'port';
    log('info', null, '跳过 Ping，直接对 ' + alive.length + ' 个地址做端口探测');

    if (onProgress) onProgress({ phase: 'port', current: 0, total: alive.length, found: [] });
  }

  // 第二步：端口扫描
  let found = [];
  const dropStats = { noOpenPort: 0, webOnly: 0 };

  if (alive.length > 0) {
    scanState.phase = 'port';
    if (onProgress) onProgress({ phase: 'port', current: 0, total: alive.length, found: [] });

    const portStart = Date.now();

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
        const openLabels = portTargets.filter(t => portResults[t.label]).map(t => t.label);

        if (openLabels.length === 0) {
          dropStats.noOpenPort++;
          // 逐地址记录只在 /24 量级可控，/16 会产生 6 万条，因此默认关闭（详细日志开关）
          if (detailLog) log('debug', ip, '无开放端口（UDP:623 / TCP:623 / TCP:80 / TCP:443 均无响应）');
          return null;
        }

        // 准入：UDP:623 是 IPMI over LAN 的实际端口，与 TCP:623/443 同等对待。
        // 旧规则只认 TCP:623/443，会把只开 UDP:623 的 BMC 整台丢掉（漏报根源）
        const hasIpmiPort = portResults['UDP:623'] || portResults['TCP:623'] || portResults['TCP:443'];
        if (!hasIpmiPort) {
          dropStats.webOnly++;
          log('warn', ip, '仅 ' + openLabels.join(' / ') + ' 开放，无 IPMI 特征端口 → 跳过验证' +
            '（若确认是 IPMI 设备，检查中间设备是否过滤了 623 端口）');
          return null;
        }

        const result = { ip, latency, ports: portResults };
        if (productInfo) {
          result.productName = productInfo.productName;
          result.productSource = productInfo.source;
        }

        log('ok', ip, openLabels.join(' / ') + ' 开放' +
          (productInfo ? '，产品 ' + productInfo.productName : '') + '（' + latency + 'ms）');
        return result;
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
    log('info', null,
      '端口探测完成：' + found.length + ' 台具备 IPMI 特征端口，跳过 ' +
      (dropStats.noOpenPort + dropStats.webOnly) + ' 台（无开放端口 ' + dropStats.noOpenPort +
      '，仅 Web 端口 ' + dropStats.webOnly + '），用时 ' + formatElapsed(Date.now() - portStart));
    console.log(`[SCAN] 端口扫描完成: ${found.length} 台设备有开放端口`, found.map(f => ({ ip: f.ip, ports: f.ports, product: f.productName || '-' })));
  }

  // 第三步：IPMI 验证（并行验证，只保留验证成功的 BMC 设备）
  if (found.length > 0) {
    scanState.phase = 'verify';
    const verifyConcurrency = 5;
    log('info', null, '开始 IPMI 验证：' + found.length + ' 台，并发 ' + verifyConcurrency +
      '，单次超时 ' + verifyTimeout + 'ms');
    console.log(`[SCAN] 开始验证 ${found.length} 台设备:`, found.map(f => f.ip));
    if (onProgress) onProgress({ phase: 'verify', current: 0, total: found.length, found });

    let verifyCurrent = 0;

    const tasks = found.map(device => {
      return async () => {
        // 收集每个凭据模板的尝试结果，失败时写进日志（凭据不匹配是最常见的漏报原因）
        const attempts = [];
        const template = await verifyIPMITemplate(device.ip, verifyTimeout, (attempt) => {
          attempts.push(attempt);
          if (detailLog) {
            log(attempt.success ? 'ok' : 'debug', device.ip,
              '凭据 ' + attempt.template + ' → ' + (attempt.success ? '通过' : '失败：' + (attempt.error || '无响应')));
          }
        });

        device.template = template;
        device.verified = !!template;

        // 通讯验证成功后补充信息（mc info 版本号 / power status 电源状态 / FRU 产品名）
        if (template) {
          const credential = getCredentialByName(template);
          if (credential) {
            // 两条命令互不依赖，并行执行省一个往返
            const [bmcVersion, powerState] = await Promise.all([
              fetchBmcVersion(device.ip, credential, template),
              fetchPowerState(device.ip, credential, Math.max(2000, verifyTimeout))
            ]);
            device.bmcVersion = bmcVersion || '';
            device.powerState = powerState || '';
          }

          // openUBMC: 取 FRU Board Product 拼合产品名
          if (template === 'openUBMC' && device.productName) {
            const bp = await fetchFruBoardProduct(device.ip);
            if (bp) {
              device.productName = bp + '/' + device.productName;
            }
          }

          log('ok', device.ip, '验证通过（' + template + '）' +
            (device.bmcVersion ? '，版本 ' + device.bmcVersion : '') +
            (device.powerState ? '，电源 ' + device.powerState : ''));
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

          const last = attempts.length ? attempts[attempts.length - 1] : null;
          log('error', device.ip, '验证失败：' + attempts.length + ' 个凭据模板均未通过' +
            (last ? '（最后一次 ' + last.template + '：' + (last.error || '无响应') + '）' : '') +
            '。若确认为 IPMI 设备，请检查凭据模板或改用「原始命令」手工测试');
          if (device.verifyHint) {
            log('warn', device.ip, device.verifyHint);
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

  if (scanState.stopped) {
    log('warn', null, '扫描已被用户停止：端口探测结果 ' + found.length + ' 台，已验证 ' + verifiedCount + ' 台');
  } else {
    log('info', null, '扫描完成：命中 ' + found.length + ' 台，验证通过 ' + verifiedCount +
      ' 台，验证失败 ' + (found.length - verifiedCount) + ' 台，总用时 ' + formatElapsed(Date.now() - startedAt));
  }

  console.log(`[SCAN] 扫描完成: 共 ${found.length} 台设备（已验证 ${verifiedCount} 台）`);
  found.forEach(f => console.log(`  - ${f.ip}: verified=${f.verified}, template=${f.template || '-'}, power=${f.powerState || '-'}${f.verifyHint ? ', hint=' + f.verifyHint : ''}`));

  scanState.running = false;
  return scanState.results;
}

/**
 * 验证 IPMI 设备使用哪个模板
 */
async function verifyIPMITemplate(ip, timeout = 1500, onAttempt) {
  const templates = getCredentialTemplates();

  for (const template of templates) {
    let result;
    try {
      result = await verifyIPMI(ip, template, timeout);
    } catch (e) {
      result = { success: false, error: e.message };
    }

    // 逐模板回报尝试结果：凭据不匹配是扫描「漏报」最常见的原因，
    // 日志里必须能看出试过哪些模板、各自失败在哪一步
    if (onAttempt) {
      try {
        onAttempt({ template: template.name, success: result.success, error: result.error || '' });
      } catch (e) {
        // 日志回调异常不能打断验证
      }
    }

    if (result.success) {
      return template.name;
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

/** 毫秒 → '4.6s' / '1m12s'，用于日志里的耗时展示 */
function formatElapsed(ms) {
  const total = Math.max(0, Math.round(Number(ms) || 0));
  if (total < 60000) return (total / 1000).toFixed(1) + 's';

  const minutes = Math.floor(total / 60000);
  const seconds = Math.round((total % 60000) / 1000);
  return minutes + 'm' + seconds + 's';
}

/**
 * 解析 ipmitool power status 的输出
 *
 * 输出形如 `Chassis Power is on` / `Chassis Power is off`。
 * 取不到（超时 / 权限不足 / 非预期格式）时返回空串，界面留空而不是猜测。
 *
 * @param {string} text
 * @returns {'on'|'off'|''}
 */
function parsePowerState(text) {
  const match = String(text == null ? '' : text).match(/Chassis Power is\s+(on|off)/i);
  return match ? match[1].toLowerCase() : '';
}

/**
 * 获取设备电源状态（仅在 IPMI 通讯验证成功后调用）
 * @returns {Promise<'on'|'off'|''>}
 */
async function fetchPowerState(ip, credential, timeout = 2000) {
  if (!credential) return '';

  const result = await runIpmiCommand(ip, credential, ['power', 'status'], timeout);
  if (!result.stdout) return '';

  return parsePowerState(result.stdout);
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
  fetchPowerState,
  parsePowerState,
  pingScan,
  portScan,
  fullScan,
  getScanState,
  stopScan
};
