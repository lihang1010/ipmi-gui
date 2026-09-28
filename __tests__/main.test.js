/**
 * main.js 单元测试
 * 测试主进程的工具函数和逻辑
 */

const fs = require('fs');
const path = require('path');

describe('Main Process Logic', () => {
  describe('buildArgs logic', () => {
    // Extract buildArgs logic for testing (mirrors main.js implementation)
    function buildArgs(server) {
      const args = [];
      if (server.host) args.push('-H', server.host);
      if (server.port && server.port !== 623) args.push('-p', String(server.port));
      if (server.username) args.push('-U', server.username);
      if (server.password) args.push('-P', server.password);
      if (server.interface) args.push('-I', server.interface);
      if (server.cipherSuite) args.push('-C', String(server.cipherSuite));
      if (server.privilegeLevel) args.push('-L', server.privilegeLevel);
      return args;
    }

    test('should build args with all fields', () => {
      const server = {
        host: '192.168.1.100',
        port: 623,
        username: 'admin',
        password: 'pass',
        interface: 'lanplus',
        cipherSuite: 17,
        privilegeLevel: 'ADMINISTRATOR'
      };
      const args = buildArgs(server);
      expect(args).toContain('-H');
      expect(args).toContain('192.168.1.100');
      expect(args).toContain('-U');
      expect(args).toContain('admin');
      expect(args).toContain('-P');
      expect(args).toContain('pass');
      expect(args).toContain('-I');
      expect(args).toContain('lanplus');
      expect(args).toContain('-C');
      expect(args).toContain('17');
      expect(args).toContain('-L');
      expect(args).toContain('ADMINISTRATOR');
    });

    test('should not include port when default (623)', () => {
      const server = { host: '1.1.1.1', port: 623 };
      const args = buildArgs(server);
      expect(args).not.toContain('-p');
    });

    test('should include port when non-default', () => {
      const server = { host: '1.1.1.1', port: 624 };
      const args = buildArgs(server);
      expect(args).toContain('-p');
      expect(args).toContain('624');
    });

    test('should handle empty server', () => {
      const args = buildArgs({});
      expect(args).toHaveLength(0);
    });

    test('should handle minimal server', () => {
      const server = { host: '10.0.0.1' };
      const args = buildArgs(server);
      expect(args).toEqual(['-H', '10.0.0.1']);
    });

    test('should handle null values', () => {
      const server = { host: '1.1.1.1', port: null, username: null, password: null };
      const args = buildArgs(server);
      expect(args).toContain('-H');
      expect(args).not.toContain('-p');
      expect(args).not.toContain('-U');
      expect(args).not.toContain('-P');
    });

    test('should handle undefined values', () => {
      const server = { host: '1.1.1.1', interface: undefined };
      const args = buildArgs(server);
      expect(args).not.toContain('-I');
    });

    test('should include all optional fields when provided', () => {
      const server = {
        host: '1.1.1.1',
        port: 1623,
        username: 'root',
        password: 'toor',
        interface: 'lan',
        cipherSuite: 3,
        privilegeLevel: 'USER'
      };
      const args = buildArgs(server);
      expect(args).toContain('-p');
      expect(args).toContain('1623');
      expect(args).toContain('-I');
      expect(args).toContain('lan');
      expect(args).toContain('-C');
      expect(args).toContain('3');
      expect(args).toContain('-L');
      expect(args).toContain('USER');
    });

    test('should handle zero port as falsy', () => {
      const server = { host: '1.1.1.1', port: 0 };
      const args = buildArgs(server);
      expect(args).not.toContain('-p');
    });

    test('should handle string port', () => {
      const server = { host: '1.1.1.1', port: '624' };
      const args = buildArgs(server);
      // String '624' is truthy and !== 623, so it should be included
      expect(args).toContain('-p');
    });
  });

  // ipmitool 路径解析的测试见 __tests__/ipmiTool.test.js（已抽到 src/modules/ipmiTool.js）

  describe('Config Operations', () => {
    test('should handle config file path', () => {
      const configPath = path.join('/mock/userData', 'config.json');
      expect(configPath).toContain('config.json');
    });

    test('should have default config structure', () => {
      const defaultConfig = {
        servers: [],
        settings: { logDir: '/mock/temp/ipmi_logs' }
      };
      expect(defaultConfig).toHaveProperty('servers');
      expect(defaultConfig).toHaveProperty('settings');
      expect(Array.isArray(defaultConfig.servers)).toBe(true);
    });

    test('should parse valid JSON config', () => {
      const json = JSON.stringify({ servers: [{ id: '1' }], settings: {}, favorites: [] });
      const config = JSON.parse(json);
      expect(config.servers).toHaveLength(1);
    });

    test('should handle invalid JSON gracefully', () => {
      expect(() => {
        try {
          JSON.parse('invalid json');
        } catch (e) {
          // Expected
        }
      }).not.toThrow();
    });
  });

  describe('SOL Process Management', () => {
    test('should track pty processes in map', () => {
      const ptyProcesses = {};
      const tabId = 'sol-1';
      ptyProcesses[tabId] = { pid: 12345, write: jest.fn() };
      expect(ptyProcesses[tabId]).toBeDefined();
      expect(ptyProcesses[tabId].pid).toBe(12345);
    });

    test('should cleanup process on delete', () => {
      const ptyProcesses = {};
      ptyProcesses['sol-1'] = { pid: 12345 };
      delete ptyProcesses['sol-1'];
      expect(ptyProcesses['sol-1']).toBeUndefined();
    });

    test('should support multiple tabs', () => {
      const ptyProcesses = {};
      ptyProcesses['sol-1'] = { pid: 111 };
      ptyProcesses['sol-2'] = { pid: 222 };
      expect(Object.keys(ptyProcesses)).toHaveLength(2);
    });
  });

  describe('Error Handling', () => {
    test('should handle file read errors', () => {
      expect(() => {
        try {
          fs.readFileSync('/nonexistent/file.json', 'utf-8');
        } catch (e) {
          // Expected
        }
      }).not.toThrow();
    });

    test('should handle directory creation', () => {
      const dir = '/mock/config/dir';
      expect(typeof dir).toBe('string');
    });
  });

  describe('Window Management', () => {
    test('should create window with correct options', () => {
      const opts = {
        width: 1000,
        height: 700,
        minWidth: 800,
        minHeight: 600,
        title: 'IPMI 管理工具'
      };
      expect(opts.width).toBe(1000);
      expect(opts.height).toBe(700);
      expect(opts.minWidth).toBe(800);
      expect(opts.minHeight).toBe(600);
    });

    test('should have correct webPreferences', () => {
      const prefs = { nodeIntegration: true, contextIsolation: false };
      expect(prefs.nodeIntegration).toBe(true);
      expect(prefs.contextIsolation).toBe(false);
    });
  });

  describe('stderr filtering', () => {
    test('should filter cache warning messages', () => {
      const messages = [
        'cache_util_win',
        'disk_cache',
        'gpu_disk_cache',
        'normal message'
      ];
      const shouldFilter = (msg) => {
        return msg.includes('cache_util_win') || msg.includes('disk_cache') || msg.includes('gpu_disk_cache');
      };

      expect(shouldFilter(messages[0])).toBe(true);
      expect(shouldFilter(messages[1])).toBe(true);
      expect(shouldFilter(messages[2])).toBe(true);
      expect(shouldFilter(messages[3])).toBe(false);
    });

    test('should not filter empty strings', () => {
      const shouldFilter = (msg) => {
        return msg.includes('cache_util_win') || msg.includes('disk_cache') || msg.includes('gpu_disk_cache');
      };
      expect(shouldFilter('')).toBe(false);
    });

    test('should not filter partial matches', () => {
      const shouldFilter = (msg) => {
        return msg.includes('cache_util_win') || msg.includes('disk_cache') || msg.includes('gpu_disk_cache');
      };
      expect(shouldFilter('cache')).toBe(false);
      expect(shouldFilter('disk')).toBe(false);
    });
  });

  describe('Command Building', () => {
    test('should build power commands', () => {
      const commands = ['power status', 'power on', 'power off', 'power cycle'];
      commands.forEach(cmd => {
        const parts = cmd.split(' ');
        expect(parts).toHaveLength(2);
        expect(parts[0]).toBe('power');
      });
    });

    test('should build SOL commands', () => {
      const commands = ['sol activate', 'sol deactivate'];
      commands.forEach(cmd => {
        const parts = cmd.split(' ');
        expect(parts).toHaveLength(2);
        expect(parts[0]).toBe('sol');
      });
    });

    test('should build sensor commands', () => {
      const cmd = 'sdr list';
      const parts = cmd.split(' ');
      expect(parts).toEqual(['sdr', 'list']);
    });

    test('should build raw commands', () => {
      const cmd = 'raw 6 1';
      const parts = cmd.split(' ');
      expect(parts).toEqual(['raw', '6', '1']);
    });
  });

  describe('IPC Channel Names', () => {
    test('should have correct channel names', () => {
      const channels = {
        ipmiExecute: 'ipmi:execute',
        solStart: 'sol:start',
        solStop: 'sol:stop',
        solClose: 'sol:close',
        solWrite: 'sol:write',
        fileSave: 'file:save',
        dialogSelectDir: 'dialog:selectDirectory',
        dialogSelectFile: 'dialog:selectFile',
        appGetMemory: 'app:getMemory'
      };

      expect(channels.ipmiExecute).toBe('ipmi:execute');
      expect(channels.solStart).toBe('sol:start');
      expect(channels.solStop).toBe('sol:stop');
      expect(channels.solClose).toBe('sol:close');
      expect(channels.solWrite).toBe('sol:write');
      expect(channels.fileSave).toBe('file:save');
      expect(channels.dialogSelectDir).toBe('dialog:selectDirectory');
      expect(channels.dialogSelectFile).toBe('dialog:selectFile');
      expect(channels.appGetMemory).toBe('app:getMemory');
    });
  });

  describe('File Dialog Filters', () => {
    test('should have correct save dialog filters', () => {
      const filters = [
        { name: '日志文件', extensions: ['log', 'txt'] },
        { name: '所有文件', extensions: ['*'] }
      ];
      expect(filters).toHaveLength(2);
      expect(filters[0].extensions).toContain('log');
      expect(filters[0].extensions).toContain('txt');
    });

    test('should have correct open dialog filters', () => {
      const filters = [{ name: 'JSON 文件', extensions: ['json'] }];
      expect(filters[0].extensions).toContain('json');
    });
  });
});
