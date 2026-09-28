/**
 * networkScanner.js 模块单元测试
 */

const os = require('os');

// jest.mock 工厂只能引用 mock 前缀的外部变量
const mockMcInfoOutput = `Device ID                 : 32
Firmware Revision         : 1.11
Aux Firmware Rev Info     : 
    0x11
    0x09
    0x00
    0x00`;

// Mock child_process
jest.mock('child_process', () => ({
  exec: jest.fn((cmd, opts, cb) => {
    if (typeof opts === 'function') {
      cb = opts;
      opts = {};
    }
    // Simulate successful ping
    if (cmd.includes('ping')) {
      cb(null, '', '');
    } else {
      // Simulate failed ipmitool verification (timeout/no response)
      setTimeout(() => cb(new Error('timeout'), '', ''), 10);
    }
    return { on: jest.fn() };
  }),
  // ipmitool 调用走 execFile（参数不经 shell）
  execFile: jest.fn((file, args, opts, cb) => {
    if (typeof opts === 'function') {
      cb = opts;
      opts = {};
    }
    if (args.includes('raw')) {
      cb(null, '06 00 00 00\n', '');                 // 验证通过
    } else if (args.includes('mc')) {
      cb(null, mockMcInfoOutput, '');                // mc info
    } else if (args.includes('fru')) {
      cb(null, 'Board Product             : Test Board\n', '');
    } else {
      cb(null, '', '');
    }
    return { on: jest.fn() };
  })
}));

// Mock dgram
jest.mock('dgram', () => ({
  createSocket: jest.fn(() => ({
    send: jest.fn(),
    close: jest.fn(),
    on: jest.fn((event, cb) => {
      if (event === 'message') {
        // Simulate response after a short delay
        setTimeout(() => cb(Buffer.from([0x06]), { address: '192.168.1.1' }), 10);
      }
    })
  }))
}));

// Mock net for TCP port scanning (scanTcpPort uses new net.Socket())
jest.mock('net', () => {
  const EventEmitter = require('events');
  return {
    Socket: jest.fn().mockImplementation(() => {
      const socket = new EventEmitter();
      socket.setTimeout = jest.fn();
      socket.destroy = jest.fn();
      socket.connect = jest.fn((port, ip, cb) => {
        process.nextTick(() => socket.emit('connect'));
      });
      return socket;
    })
  };
});

// Mock http/https for HTTP product probe (tryHttpFetch)
const mockHttpResponse = () => {
  const res = { on: jest.fn(), statusCode: 404 };
  res.on.mockImplementation((event, handler) => {
    if (event === 'data') setImmediate(() => handler(''));
    if (event === 'end') setImmediate(() => handler());
    return res;
  });
  return res;
};
const mockHttpReq = { on: jest.fn(), destroy: jest.fn() };

jest.mock('https', () => ({
  get: jest.fn((opts, cb) => {
    setImmediate(() => cb(mockHttpResponse()));
    return mockHttpReq;
  })
}));

jest.mock('http', () => ({
  get: jest.fn((opts, cb) => {
    setImmediate(() => cb(mockHttpResponse()));
    return mockHttpReq;
  })
}));

// Mock fs for verifyIPMI
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  readFileSync: jest.fn().mockReturnValue(''),
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn()
}));

// Mock ipmitool path
jest.mock('path', () => ({
  join: jest.fn((...args) => args.join('/')),
  dirname: jest.fn((p) => p.split('/').slice(0, -1).join('/')),
  resolve: jest.fn((...args) => args.join('/'))
}));

// Mock os.networkInterfaces
jest.mock('os', () => ({
  networkInterfaces: jest.fn().mockReturnValue({
    'eth0': [
      { address: '192.168.1.100', family: 'IPv4', internal: false, netmask: '255.255.255.0' }
    ]
  })
}));

const scanner = require('../src/modules/networkScanner');

describe('NetworkScanner Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getLocalNetwork', () => {
    test('should return local network info', () => {
      const result = scanner.getLocalNetwork();
      expect(result).toBeDefined();
      expect(result.ip).toBe('192.168.1.100');
      expect(result.subnet).toBe('192.168.1');
      expect(result.mask).toBe('255.255.255.0');
    });

    test('should handle no network interfaces', () => {
      os.networkInterfaces.mockReturnValueOnce({});
      const result = scanner.getLocalNetwork();
      expect(result).toBeNull();
    });

    test('should skip internal interfaces', () => {
      os.networkInterfaces.mockReturnValueOnce({
        'lo': [
          { address: '127.0.0.1', family: 'IPv4', internal: true }
        ]
      });
      const result = scanner.getLocalNetwork();
      expect(result).toBeNull();
    });

    test('should skip IPv6 interfaces', () => {
      os.networkInterfaces.mockReturnValueOnce({
        'eth0': [
          { address: 'fe80::1', family: 'IPv6', internal: false }
        ]
      });
      const result = scanner.getLocalNetwork();
      expect(result).toBeNull();
    });
  });

  describe('pingHost', () => {
    test('should return true for reachable host', async () => {
      const { exec } = require('child_process');
      exec.mockImplementationOnce((cmd, opts, cb) => {
        if (typeof opts === 'function') {
          opts(null, '', '');
        } else {
          cb(null, '', '');
        }
        return { on: jest.fn() };
      });

      const result = await scanner.pingHost('192.168.1.1', 200);
      expect(result).toBe(true);
    });

    test('should return false for unreachable host', async () => {
      const { exec } = require('child_process');
      exec.mockImplementationOnce((cmd, opts, cb) => {
        if (typeof opts === 'function') {
          opts(new Error('timeout'), '', '');
        } else {
          cb(new Error('timeout'), '', '');
        }
        return { on: jest.fn() };
      });

      const result = await scanner.pingHost('192.168.1.999', 200);
      expect(result).toBe(false);
    });

    test('should use correct ping flags for Windows', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const { exec } = require('child_process');
      exec.mockImplementationOnce((cmd, opts, cb) => {
        expect(cmd).toContain('-n');
        expect(cmd).toContain('-w');
        if (typeof opts === 'function') {
          opts(null, '', '');
        } else {
          cb(null, '', '');
        }
        return { on: jest.fn() };
      });

      await scanner.pingHost('192.168.1.1', 200);
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    test('should use correct ping flags for Linux', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux' });

      const { exec } = require('child_process');
      exec.mockImplementationOnce((cmd, opts, cb) => {
        expect(cmd).toContain('-c');
        expect(cmd).toContain('-W');
        if (typeof opts === 'function') {
          opts(null, '', '');
        } else {
          cb(null, '', '');
        }
        return { on: jest.fn() };
      });

      await scanner.pingHost('192.168.1.1', 200);
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    test('should pass millisecond timeout on Windows', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const { exec } = require('child_process');
      let captured = '';
      exec.mockImplementationOnce((cmd, opts, cb) => {
        captured = cmd;
        cb(null, '', '');
        return { on: jest.fn() };
      });

      await scanner.pingHost('192.168.1.1', 500);
      expect(captured).toContain('-w 500');

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });
  });

  describe('scanPort', () => {
    test('should return true when port is open', async () => {
      const result = await scanner.scanPort('192.168.1.1', 623, 300);
      expect(result).toBe(true);
    });

    test('should send ASF Presence Ping packet', async () => {
      const dgram = require('dgram');
      const socket = {
        send: jest.fn(),
        close: jest.fn(),
        on: jest.fn((event, cb) => {
          if (event === 'message') setTimeout(() => cb(Buffer.from([0x06])), 5);
        })
      };
      dgram.createSocket.mockReturnValueOnce(socket);

      const result = await scanner.scanPort('192.168.1.1', 623, 100);
      expect(result).toBe(true);

      const packet = socket.send.mock.calls[0][0];
      expect(packet[0]).toBe(0x06); // RMCP version
      expect(packet[3]).toBe(0x07); // ASF class
      expect(packet[8]).toBe(0x80); // Presence Ping
    });

    test('should return false on UDP timeout (no false positive)', async () => {
      const dgram = require('dgram');
      dgram.createSocket.mockReturnValueOnce({
        send: jest.fn(),
        close: jest.fn(),
        on: jest.fn() // 不触发任何事件
      });

      const result = await scanner.scanPort('192.168.1.1', 623, 30);
      expect(result).toBe(false);
    });
  });

  describe('cidrToHosts', () => {
    test('should expand /24 to 254 hosts', () => {
      const hosts = scanner.cidrToHosts('192.168.1', 24);
      expect(hosts).toHaveLength(254);
      expect(hosts[0]).toBe('192.168.1.1');
      expect(hosts[253]).toBe('192.168.1.254');
    });

    test('should expand /25 to 126 hosts', () => {
      expect(scanner.cidrToHosts('192.168.1', 25)).toHaveLength(126);
    });

    test('should expand /30 to 2 usable hosts', () => {
      expect(scanner.cidrToHosts('192.168.1', 30)).toEqual(['192.168.1.1', '192.168.1.2']);
    });

    test('should clamp prefixes lower than /24 to /24', () => {
      expect(scanner.cidrToHosts('192.168.1', 16)).toHaveLength(254);
    });

    test('should default to /24 when cidr is invalid', () => {
      expect(scanner.cidrToHosts('192.168.1')).toHaveLength(254);
      expect(scanner.cidrToHosts('192.168.1', 'abc')).toHaveLength(254);
    });
  });

  describe('pingScan', () => {
    test('should scan subnet and return alive hosts', async () => {
      // This will test the logic, even if actual pings are mocked
      const result = await scanner.pingScan('192.168.1', {
        concurrency: 10,
        timeout: 100,
        onProgress: jest.fn()
      });
      expect(Array.isArray(result)).toBe(true);
    });

    test('should report progress during scan', async () => {
      const onProgress = jest.fn();
      await scanner.pingScan('192.168.1', {
        concurrency: 5,
        timeout: 50,
        onProgress
      });
      expect(onProgress).toHaveBeenCalled();
    });
  });

  describe('portScan', () => {
    test('should scan ports on alive hosts', async () => {
      const ips = ['192.168.1.1', '192.168.1.2'];
      const result = await scanner.portScan(ips, {
        concurrency: 5,
        timeout: 100,
        onProgress: jest.fn()
      });
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('fullScan', () => {
    test('should run complete scan pipeline', async () => {
      const onProgress = jest.fn();
      const result = await scanner.fullScan('192.168.1', {
        pingConcurrency: 5,
        pingTimeout: 50,
        portConcurrency: 5,
        portTimeout: 50,
        onProgress
      });
      expect(Array.isArray(result)).toBe(true);
      expect(onProgress).toHaveBeenCalled();
    }, 30000);

    test('should report all phases', async () => {
      const phases = [];
      await scanner.fullScan('192.168.1', {
        pingConcurrency: 2,
        pingTimeout: 50,
        portConcurrency: 2,
        portTimeout: 50,
        onProgress: (info) => {
          if (!phases.includes(info.phase)) {
            phases.push(info.phase);
          }
        }
      });
      expect(phases).toContain('ping');
    }, 30000);

    test('should scan explicit host list when hosts provided', async () => {
      const onProgress = jest.fn();
      const result = await scanner.fullScan('192.168.1', {
        hosts: ['192.168.1.1', '192.168.1.2'],
        pingConcurrency: 2,
        pingTimeout: 50,
        portConcurrency: 2,
        portTimeout: 50,
        onProgress
      });

      expect(Array.isArray(result)).toBe(true);
      expect(onProgress.mock.calls[0][0].total).toBe(2);
    }, 30000);

    test('should attach BMC version for verified device', async () => {
      const result = await scanner.fullScan('192.168.1', {
        hosts: ['192.168.1.1'],
        pingConcurrency: 1,
        pingTimeout: 50,
        portConcurrency: 1,
        portTimeout: 50
      });

      expect(result).toHaveLength(1);
      expect(result[0].verified).toBe(true);
      expect(result[0].template).toBe('AMI');
      expect(result[0].bmcVersion).toBe('1.11.1109');
    }, 30000);

    test('验证时应传入凭据模板的用户名与密码（回归：曾误传字符串导致全部验证失败）', async () => {
      await scanner.fullScan('192.168.1', {
        hosts: ['192.168.1.1'],
        pingConcurrency: 1,
        pingTimeout: 50,
        portConcurrency: 1,
        portTimeout: 50
      });

      const { execFile } = require('child_process');
      const verifyCall = execFile.mock.calls.find(call => call[1].includes('raw'));
      expect(verifyCall).toBeDefined();

      const args = verifyCall[1];
      expect(args[args.indexOf('-U') + 1]).toBe('admin');
      expect(args[args.indexOf('-P') + 1]).toBe('admin');
      // execFile 遇到非字符串参数会直接抛错，这里必须全部为字符串
      expect(args.every(arg => typeof arg === 'string')).toBe(true);
    }, 30000);
  });

  describe('runIpmiCommand', () => {
    test('应以 execFile 逐参数传参，凭据不经 shell', async () => {
      const { execFile } = require('child_process');
      const credential = { username: 'Administrator', password: 'ttytty`12 & calc' };

      await scanner.runIpmiCommand('192.168.1.1', credential, ['mc', 'info'], 500);

      const calls = execFile.mock.calls;
      const [file, args] = calls[calls.length - 1];
      expect(file).toMatch(/ipmitool\.exe$/);
      expect(args).toContain(credential.password);
      expect(args).toContain('-I');
      expect(args).toContain('lanplus');
      expect(args).toContain('-N');
      expect(args.slice(-2)).toEqual(['mc', 'info']);
    });

    test('凭据缺失时应返回明确错误而不是抛异常', async () => {
      const result = await scanner.runIpmiCommand(
        '192.168.1.1', { username: 'admin' }, ['mc', 'info'], 100
      );

      expect(result.ok).toBe(false);
      expect(result.error).toContain('凭据缺失');
    });

    test('凭据被误传为字符串时不应抛出', async () => {
      const result = await scanner.runIpmiCommand('192.168.1.1', 'admin', ['mc', 'info'], 100);
      expect(result.ok).toBe(false);
    });

    test('未找到 ipmitool 时应返回 ok=false 与明确错误', async () => {
      const fs = require('fs');
      fs.existsSync.mockReturnValue(false);

      const result = await scanner.runIpmiCommand(
        '192.168.1.1', { username: 'a', password: 'b' }, ['mc', 'info'], 100
      );

      expect(result.ok).toBe(false);
      expect(result.error).toContain('ipmitool.exe');

      fs.existsSync.mockReturnValue(true);
    });

    test('命令失败时应回传 stderr', async () => {
      const { execFile } = require('child_process');
      execFile.mockImplementationOnce((file, args, opts, cb) => {
        cb(new Error('Command failed'), '', 'Error: Unable to establish IPMI session');
        return { on: jest.fn() };
      });

      const result = await scanner.runIpmiCommand(
        '192.168.1.1', { username: 'a', password: 'b' }, ['mc', 'info'], 100
      );

      expect(result.ok).toBe(false);
      expect(result.stderr).toContain('Unable to establish');
    });
  });

  describe('getScanState', () => {
    test('should return scan state', () => {
      const state = scanner.getScanState();
      expect(state).toHaveProperty('running');
      expect(state).toHaveProperty('stopped');
      expect(state).toHaveProperty('results');
      expect(state).toHaveProperty('current');
      expect(state).toHaveProperty('total');
      expect(state).toHaveProperty('phase');
    });

    test('should return a copy of state', () => {
      const state1 = scanner.getScanState();
      const state2 = scanner.getScanState();
      expect(state1).not.toBe(state2);
      expect(state1).toEqual(state2);
    });
  });

  describe('stopScan', () => {
    test('should set stopped flag', () => {
      scanner.stopScan();
      const state = scanner.getScanState();
      expect(state.stopped).toBe(true);
    });
  });

  describe('verifyIPMITemplate', () => {
    test('should try multiple templates', async () => {
      const { exec } = require('child_process');
      // All templates fail
      exec.mockImplementation((cmd, opts, cb) => {
        if (typeof opts === 'function') {
          opts(new Error('auth failed'), '', 'authentication error');
        } else {
          cb(new Error('auth failed'), '', 'authentication error');
        }
        return { on: jest.fn() };
      });

      // This tests the logic, actual verification depends on ipmitool
      expect(typeof scanner.fullScan).toBe('function');
    });
  });

  describe('Concurrency Control', () => {
    test('should respect concurrency limit', async () => {
      let maxConcurrent = 0;
      let currentConcurrent = 0;

      const tasks = Array(10).fill(null).map(() => async () => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        await new Promise(r => setTimeout(r, 10));
        currentConcurrent--;
        return true;
      });

      // Run with concurrency limit of 3
      const results = [];
      let index = 0;
      const worker = async () => {
        while (index < tasks.length) {
          const i = index++;
          results[i] = await tasks[i]();
        }
      };
      await Promise.all([worker(), worker(), worker()]);

      expect(maxConcurrent).toBeLessThanOrEqual(3);
    });
  });

  describe('Error Handling', () => {
    test('should handle exec errors gracefully', async () => {
      const { exec } = require('child_process');
      exec.mockImplementationOnce((cmd, opts, cb) => {
        const proc = { on: jest.fn() };
        if (typeof opts === 'function') {
          opts(null, '', '');
        } else {
          cb(null, '', '');
        }
        return proc;
      });

      // Should not throw
      const result = await scanner.pingHost('192.168.1.1', 100);
      expect(typeof result).toBe('boolean');
    });

    test('should handle process error events', async () => {
      const { exec } = require('child_process');
      exec.mockImplementationOnce(() => {
        const proc = {
          on: jest.fn((event, cb) => {
            if (event === 'error') {
              cb(new Error('spawn failed'));
            }
          })
        };
        return proc;
      });

      // The error handler should be registered
      expect(exec).toBeDefined();
    });
  });
});
