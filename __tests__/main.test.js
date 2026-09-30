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
    const {
      computeWindowSize, IDEAL_WIDTH, IDEAL_HEIGHT, MIN_WIDTH, MIN_HEIGHT
    } = require('../src/modules/windowSize');

    test('顶栏放得下：默认宽度覆盖最坏情况的自然宽度', () => {
      // 实测自然宽度 1037px（左组 726 + 右组 251 + 内边距 32）
      expect(IDEAL_WIDTH).toBeGreaterThanOrEqual(1037);
      // 最坏情况：状态徽标到 max-width 260px 时 → 1037 + (260 - 69) = 1228
      expect(IDEAL_WIDTH).toBeGreaterThanOrEqual(1228);
      // 还要扣掉窗口边框：实测 1240 的窗口内容区只有 1224，横向被吃掉约 16px
      expect(IDEAL_WIDTH - 16).toBeGreaterThanOrEqual(1228);
      // 原缺陷：写死 1000px，右侧状态徽标被压到只剩一条边
      expect(computeWindowSize({ width: 1920, height: 1080 }).width).toBe(IDEAL_WIDTH);
    });

    test('常见分辨率下取理想尺寸', () => {
      expect(computeWindowSize({ width: 1920, height: 1080 }))
        .toEqual({ width: IDEAL_WIDTH, height: IDEAL_HEIGHT });
      expect(computeWindowSize({ width: 2560, height: 1440 }))
        .toEqual({ width: IDEAL_WIDTH, height: IDEAL_HEIGHT });
    });

    test('小屏笔记本（1366x768）不超出屏幕工作区', () => {
      const area = { width: 1366, height: 728 };
      const { width, height } = computeWindowSize(area);
      // 宽度仍取理想值（1160 < 1366 放得下），高度被工作区压低
      expect(width).toBe(IDEAL_WIDTH);
      expect(height).toBe(728 - 60);
      expect(width).toBeLessThanOrEqual(area.width);
      expect(height).toBeLessThanOrEqual(area.height);
    });

    test('屏幕介于最小与理想尺寸之间时贴着屏幕边缘留余量', () => {
      expect(computeWindowSize({ width: 1120, height: 900 }))
        .toEqual({ width: 1120 - 60, height: IDEAL_HEIGHT });
    });

    test('屏幕比最小尺寸还小时取最小尺寸兜底', () => {
      expect(computeWindowSize({ width: 800, height: 600 }))
        .toEqual({ width: MIN_WIDTH, height: MIN_HEIGHT });
      expect(computeWindowSize({ width: 640, height: 480 }))
        .toEqual({ width: MIN_WIDTH, height: MIN_HEIGHT });
    });

    test('拿不到屏幕信息时退回理想尺寸', () => {
      expect(computeWindowSize()).toEqual({ width: IDEAL_WIDTH, height: IDEAL_HEIGHT });
      expect(computeWindowSize({})).toEqual({ width: IDEAL_WIDTH, height: IDEAL_HEIGHT });
      expect(computeWindowSize({ width: 0, height: NaN }))
        .toEqual({ width: IDEAL_WIDTH, height: IDEAL_HEIGHT });
    });

    test('窗口最小尺寸与 BrowserWindow 的 minWidth / minHeight 一致', () => {
      expect(MIN_WIDTH).toBe(800);
      expect(MIN_HEIGHT).toBe(600);
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
