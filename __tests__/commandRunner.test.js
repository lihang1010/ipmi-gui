/**
 * commandRunner.js 模块单元测试
 */

// Mock DOM
global.document = {
  getElementById: jest.fn((id) => ({
    id,
    value: '',
    textContent: '',
    style: {},
    classList: { add: jest.fn(), remove: jest.fn() }
  }))
};

jest.mock('electron', () => ({
  ipcRenderer: {
    invoke: jest.fn().mockResolvedValue({ code: 0, stdout: 'ok', stderr: '' }),
    send: jest.fn()
  }
}));

jest.mock('../src/modules/modal', () => ({
  safeAlert: jest.fn().mockResolvedValue(undefined),
  safeConfirm: jest.fn().mockResolvedValue(true)
}));

jest.mock('../src/modules/utils', () => ({
  showStatus: jest.fn()
}));

const commandRunner = require('../src/modules/commandRunner');
const { ipcRenderer } = require('electron');
const { safeAlert } = require('../src/modules/modal');

describe('CommandRunner Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('executeCommand', () => {
    test('should execute command and return result', async () => {
      const server = { id: '1', name: 'Test', host: '192.168.1.1' };
      const result = await commandRunner.executeCommand('power status', 'output-power', server);
      expect(result.code).toBe(0);
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('ipmi:execute', server, 'power status');
    });

    test('should show alert when no server', async () => {
      await commandRunner.executeCommand('power status', 'output-power', null);
      expect(safeAlert).toHaveBeenCalledWith('请先选择服务器');
    });

    test('should update output element', async () => {
      const el = { textContent: '', style: {} };
      document.getElementById = jest.fn(() => el);
      const server = { id: '1' };
      await commandRunner.executeCommand('test', 'output-test', server);
      expect(el.textContent).toBe('ok');
    });

    test('should show error on failure', async () => {
      ipcRenderer.invoke.mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'error msg' });
      const el = { textContent: '', style: {} };
      document.getElementById = jest.fn(() => el);
      const server = { id: '1' };
      await commandRunner.executeCommand('test', 'output-test', server);
      expect(el.textContent).toContain('error msg');
    });

    test('should handle execution exception', async () => {
      ipcRenderer.invoke.mockRejectedValueOnce(new Error('Network error'));
      const server = { id: '1' };
      const result = await commandRunner.executeCommand('test', 'output-test', server);
      expect(result.code).toBe(-1);
      expect(result.stderr).toBe('Network error');
    });

    test('should show "无输出" for empty stdout', async () => {
      ipcRenderer.invoke.mockResolvedValueOnce({ code: 0, stdout: '' });
      const el = { textContent: '', style: {} };
      document.getElementById = jest.fn(() => el);
      const server = { id: '1' };
      await commandRunner.executeCommand('test', 'output-test', server);
      expect(el.textContent).toBe('(无输出)');
    });
  });

  describe('executePower', () => {
    test('should execute power status', async () => {
      const server = { id: '1' };
      await commandRunner.executePower('status', server);
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('ipmi:execute', server, 'power status');
    });

    test('should execute power on', async () => {
      const server = { id: '1' };
      await commandRunner.executePower('on', server);
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('ipmi:execute', server, 'power on');
    });

    test('should execute power off', async () => {
      const server = { id: '1' };
      await commandRunner.executePower('off', server);
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('ipmi:execute', server, 'power off');
    });

    test('should execute power cycle', async () => {
      const server = { id: '1' };
      await commandRunner.executePower('cycle', server);
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('ipmi:execute', server, 'power cycle');
    });
  });

  describe('executeSensor', () => {
    test('should execute sdr list', async () => {
      const server = { id: '1' };
      await commandRunner.executeSensor(server);
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('ipmi:execute', server, 'sdr list');
    });
  });

  describe('executeRawCommand', () => {
    test('should execute raw command from input', async () => {
      document.getElementById = jest.fn((id) => {
        if (id === 'raw-command') return { value: 'raw 6 1' };
        return { textContent: '', style: {} };
      });
      const server = { id: '1' };
      await commandRunner.executeRawCommand(server);
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('ipmi:execute', server, 'raw 6 1');
    });

    test('should show alert when command is empty', async () => {
      document.getElementById = jest.fn((id) => {
        if (id === 'raw-command') return { value: '' };
        return { textContent: '', style: {} };
      });
      const server = { id: '1' };
      await commandRunner.executeRawCommand(server);
      expect(safeAlert).toHaveBeenCalledWith('请输入命令');
    });

    test('should show alert when command is whitespace only', async () => {
      document.getElementById = jest.fn((id) => {
        if (id === 'raw-command') return { value: '   ' };
        return { textContent: '', style: {} };
      });
      const server = { id: '1' };
      await commandRunner.executeRawCommand(server);
      expect(safeAlert).toHaveBeenCalledWith('请输入命令');
    });

    test('should trim command before execution', async () => {
      document.getElementById = jest.fn((id) => {
        if (id === 'raw-command') return { value: '  raw 6 1  ' };
        return { textContent: '', style: {} };
      });
      const server = { id: '1' };
      await commandRunner.executeRawCommand(server);
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('ipmi:execute', server, 'raw 6 1');
    });
  });
});
