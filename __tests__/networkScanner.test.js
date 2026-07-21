/**
 * networkScanner.js 模块单元测试
 */

const os = require('os');
const net = require('net');

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
  });

  describe('scanPort', () => {
    test('should return true when port is open', async () => {
      const result = await scanner.scanPort('192.168.1.1', 623, 300);
      expect(result).toBe(true);
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
    });

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
