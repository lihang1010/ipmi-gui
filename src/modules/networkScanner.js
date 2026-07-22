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

    found = await portScan(alive.map(a => a.ip), {
      concurrency: portConcurrency,
      timeout: portTimeout,
      onProgress: (current, total, f) => {
        if (onProgress) onProgress({ phase: 'port', current, total, found: f });
      }
    });

    console.log(`[SCAN] 端口扫描完成: ${found.length} 台设备有 IPMI 端口`);
  }

  // 第三步：IPMI 验证（并行验证，只保留验证成功的 BMC 设备）
  if (found.length > 0) {
    scanState.phase = 'verify';
    console.log(`[SCAN] 开始验证 ${found.length} 台设备:`, found.map(f => f.ip));
    if (onProgress) onProgress({ phase: 'verify', current: 0, total: found.length, found });

    const verifyConcurrency = 5;
    const verified = [];
    let verifyCurrent = 0;

    const tasks = found.map(device => {
      return async () => {
        const template = await verifyIPMITemplate(device.ip);
        device.template = template;
        if (template) {
          verified.push(device);
        }
        verifyCurrent++;
        if (onProgress) onProgress({ phase: 'verify', current: verifyCurrent, total: found.length, found: [...verified] });
        return template ? device : null;
      };
    });

    await runWithLimit(tasks, verifyConcurrency);

    // 只保留验证成功的设备
    found.length = 0;
    found.push(...verified);
  }

  scanState.results = found;

  console.log(`[SCAN] 扫描完成: 共 ${found.length} 台设备`);
  found.forEach(f => console.log(`  - ${f.ip}: template=${f.template || 'null'}`));

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
      console.log(`[VERIFY] ${ip} - ${template.name}: success=${result.success}, output="${result.output}", error="${result.error}"`);
      if (result.success) {
        return template.name;
      }
    } catch (e) {
      console.log(`[VERIFY] ${ip} - ${template.name}: error - ${e.message}`);
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

    console.log(`[VERIFY-DEBUG] __dirname = ${__dirname}`);

    // 查找 ipmitool 路径 (渲染进程中无法使用 app.getPath)
    // 打包后 __dirname = resources/app.asar/src/modules
    // 需要向上 3 级到达 resources/ 目录，然后找 bin/
    const searchPaths = [
      // 打包后：resources/bin/ipmitool.exe (手动复制)
      path.join(__dirname, '..', '..', '..', 'bin', 'ipmitool.exe'),
      // 打包后：resources/app.asar.unpacked/bin/ipmitool.exe
      path.join(__dirname, '..', '..', '..', 'app.asar.unpacked', 'bin', 'ipmitool.exe'),
      // 开发模式：项目 bin 目录
      path.join(__dirname, '..', '..', 'bin', 'ipmitool.exe')
    ];

    console.log(`[VERIFY-DEBUG] Search paths:`);
    searchPaths.forEach((p, i) => {
      const exists = fs.existsSync(p);
      console.log(`  [${i}] ${p} -> ${exists ? 'FOUND' : 'NOT FOUND'}`);
    });

    let ipmitoolPath = searchPaths[0];
    for (const p of searchPaths) {
      if (fs.existsSync(p)) {
        ipmitoolPath = p;
        break;
      }
    }
    console.log(`[VERIFY-DEBUG] Using ipmitool: ${ipmitoolPath}`);

    // 保存密码到临时文件，避免特殊字符问题
    const os = require('os');
    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `ipmi_pwd_${Date.now()}.txt`);

    try {
      require('fs').writeFileSync(tmpFile, password, 'utf-8');
      // 验证文件确实写入成功
      if (!require('fs').existsSync(tmpFile)) {
        console.log(`[VERIFY-DEBUG] Failed to create temp file: ${tmpFile}`);
        resolve({ success: false, error: '无法创建临时文件' });
        return;
      }
    } catch (writeErr) {
      console.log(`[VERIFY-DEBUG] Temp file write error: ${writeErr.message}`);
      resolve({ success: false, error: '临时文件写入失败: ' + writeErr.message });
      return;
    }

    console.log(`[VERIFY-DEBUG] Temp file created: ${tmpFile}`);

    const args = [
      '-H', ip,
      '-U', username,
      '-f', tmpFile,
      '-I', 'lanplus',
      '-C', '17',
      '-N', '1',
      '-R', '0',
      'raw', '6', '1'
    ];

    const cmd = `"${ipmitoolPath}" ${args.map(a => `"${a}"`).join(' ')}`;
    console.log(`[VERIFY-DEBUG] Command: ${cmd}`);

    const proc = exec(
      cmd,
      { timeout, windowsHide: true },
      (err, stdout, stderr) => {
        // 清理临时文件
        try { require('fs').unlinkSync(tmpFile); } catch (e) {}

        // 严格的成功条件：
        // 1. 没有错误
        // 2. stdout 包含十六进制数据（IPMI 响应格式）
        const hasHexOutput = stdout && /^[0-9a-f\s]+$/i.test(stdout.trim());
        const hasNoAuthError = !stderr || (
          !stderr.includes('unauthorized') &&
          !stderr.includes('authentication') &&
          !stderr.includes('Invalid password') &&
          !stderr.includes('RAKP') &&
          !stderr.includes('SOL')
        );
        
        const success = !err && hasHexOutput && hasNoAuthError;

        console.log(`[VERIFY-DEBUG] Result: success=${success}, err=${err ? err.message : 'none'}`);
        console.log(`[VERIFY-DEBUG] stdout: ${stdout ? stdout.trim().substring(0, 100) : 'empty'}`);
        console.log(`[VERIFY-DEBUG] stderr: ${stderr ? stderr.trim().substring(0, 100) : 'empty'}`);

        resolve({
          success,
          output: stdout ? stdout.trim() : '',
          error: stderr ? stderr.trim() : ''
        });
      }
    );

    proc.on('error', (e) => {
      console.log(`[VERIFY-DEBUG] Process error: ${e.message}`);
      try { require('fs').unlinkSync(tmpFile); } catch (e) {}
      resolve({ success: false, error: '执行失败: ' + e.message });
    });
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
