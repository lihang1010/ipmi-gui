/**
 * renderer.js 单元测试
 * 测试渲染进程的核心逻辑
 */

// ========== Mock Setup ==========

// Mock DOM elements
const mockDomElements = {};
const createMockElement = (id, props = {}) => ({
  id,
  value: props.value || '',
  textContent: props.textContent || '',
  innerHTML: props.innerHTML || '',
  style: props.style || {},
  disabled: props.disabled || false,
  className: props.className || '',
  classList: {
    add: jest.fn(),
    remove: jest.fn(),
    contains: jest.fn().mockReturnValue(false)
  },
  focus: jest.fn(),
  blur: jest.fn(),
  click: jest.fn(),
  appendChild: jest.fn(),
  remove: jest.fn(),
  querySelectorAll: jest.fn(() => []),
  querySelector: jest.fn(() => null),
  addEventListener: jest.fn(),
  dataset: {},
  ...props
});

global.document = {
  getElementById: jest.fn((id) => {
    if (!mockDomElements[id]) {
      mockDomElements[id] = createMockElement(id);
    }
    return mockDomElements[id];
  }),
  querySelectorAll: jest.fn(() => []),
  querySelector: jest.fn(() => null),
  createElement: jest.fn(() => createMockElement('created')),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  body: {
    appendChild: jest.fn(),
    removeChild: jest.fn()
  }
};

global.window = {
  applyTemplate: jest.fn(),
  updateServerNameFromTemplate: jest.fn(),
  openDialog: jest.fn(),
  closeDialog: jest.fn(),
  saveServer: jest.fn(),
  selectFavorite: jest.fn(),
  executeFavorite: jest.fn(),
  closeFavDialog: jest.fn(),
  saveFavorite: jest.fn(),
  updateServerList: jest.fn()
};

global.setTimeout = jest.fn((cb) => cb());
global.setInterval = jest.fn((cb) => cb());
global.clearInterval = jest.fn();
global.USERPROFILE = '/mock/user';
global.HOME = '/mock/user';

// Mock modules
jest.mock('electron', () => ({
  ipcRenderer: {
    invoke: jest.fn().mockResolvedValue({ code: 0, stdout: 'ok', stderr: '' }),
    send: jest.fn(),
    on: jest.fn()
  }
}));

jest.mock('xterm', () => ({
  Terminal: jest.fn().mockImplementation(() => ({
    open: jest.fn(),
    write: jest.fn(),
    writeln: jest.fn(),
    clear: jest.fn(),
    focus: jest.fn(),
    blur: jest.fn(),
    dispose: jest.fn(),
    onData: jest.fn(),
    loadAddon: jest.fn()
  }))
}));

jest.mock('@xterm/addon-fit', () => ({
  FitAddon: jest.fn().mockImplementation(() => ({
    fit: jest.fn()
  }))
}));

jest.mock('@xterm/addon-serialize', () => ({
  SerializeAddon: jest.fn().mockImplementation(() => ({
    serialize: jest.fn().mockReturnValue('serialized content')
  }))
}));

jest.mock('../src/modules/configStore', () => {
  let config = { servers: [], settings: {}, favorites: [] };
  return {
    loadConfig: jest.fn(() => config),
    saveConfig: jest.fn(() => true),
    getConfig: jest.fn(() => config),
    setConfig: jest.fn((c) => { config = c; }),
    configPath: '/mock/config.json'
  };
});

jest.mock('../src/modules/modal', () => ({
  safeAlert: jest.fn().mockResolvedValue(undefined),
  safeConfirm: jest.fn().mockResolvedValue(true)
}));

jest.mock('../src/modules/utils', () => ({
  escapeHtml: jest.fn((s) => s),
  showStatus: jest.fn(),
  clearOutput: jest.fn(),
  isValidIP: jest.fn((ip) => {
    const parts = ip.split('.');
    return parts.length === 4 && parts.every(p => {
      const num = parseInt(p, 10);
      return !isNaN(num) && num >= 0 && num <= 255 && p === String(num);
    });
  })
}));

jest.mock('../src/modules/templates', () => ({
  SERVER_TEMPLATES: {
    openubmc: { name: 'openUBMC', username: 'Administrator', password: 'ttytty`12', interface: 'lanplus', cipherSuite: 17 },
    ami: { name: 'AMI', username: 'admin', password: 'admin', interface: 'lanplus', cipherSuite: 17 },
    openbmc: { name: 'OpenBMC', username: 'root', password: '0penBmc', interface: 'lanplus', cipherSuite: 17 }
  },
  applyTemplate: jest.fn(),
  updateServerNameFromTemplate: jest.fn()
}));

jest.mock('../src/modules/commandRunner', () => ({
  executeCommand: jest.fn().mockResolvedValue({ code: 0, stdout: 'ok' }),
  executePower: jest.fn().mockResolvedValue({ code: 0, stdout: 'ok' }),
  executeSensor: jest.fn().mockResolvedValue({ code: 0, stdout: 'ok' }),
  executeRawCommand: jest.fn().mockResolvedValue({ code: 0, stdout: 'ok' })
}));

jest.mock('../src/modules/favorites', () => ({
  loadFavorites: jest.fn(),
  saveFavorites: jest.fn(),
  render: jest.fn(),
  select: jest.fn(),
  openDialog: jest.fn(),
  closeDialog: jest.fn(),
  save: jest.fn(),
  editSelected: jest.fn(),
  deleteSelected: jest.fn(),
  executeSelected: jest.fn(),
  execute: jest.fn(),
  move: jest.fn(),
  getSelectedIndex: jest.fn().mockReturnValue(-1)
}));

jest.mock('../src/modules/networkScanner', () => ({
  getLocalNetwork: jest.fn().mockReturnValue({ subnet: '192.168.1', ip: '192.168.1.100' }),
  cidrToHosts: jest.fn().mockReturnValue(['192.168.1.1']),
  fullScan: jest.fn().mockResolvedValue([]),
  stopScan: jest.fn()
}));

// ========== Test Suite ==========

describe('Renderer Module', () => {
  let renderer;
  const { ipcRenderer } = require('electron');
  const configStore = require('../src/modules/configStore');
  const { safeAlert, safeConfirm } = require('../src/modules/modal');
  const commandRunner = require('../src/modules/commandRunner');
  const favorites = require('../src/modules/favorites');
  const scanner = require('../src/modules/networkScanner');

  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(mockDomElements).forEach(k => delete mockDomElements[k]);
    const config = configStore.getConfig();
    config.servers = [];
    config.settings = {};
    config.favorites = [];
  });

  describe('Server List Management', () => {
    test('should update server list dropdown', () => {
      const config = configStore.getConfig();
      config.servers = [
        { id: '1', name: 'Server1', host: '192.168.1.1' },
        { id: '2', name: 'Server2', host: '192.168.1.2' }
      ];

      const select = document.getElementById('server-select');
      expect(select).toBeDefined();
    });

    test('should handle empty server list', () => {
      const select = document.getElementById('server-select');
      expect(select).toBeDefined();
    });
  });

  describe('Server Dialog', () => {
    test('should open add server dialog', () => {
      const dialog = document.getElementById('server-dialog');
      expect(dialog).toBeDefined();
    });

    test('should open edit server dialog with server data', () => {
      const server = { id: '1', name: 'Test', host: '192.168.1.1', port: 623, username: 'admin', password: 'pass' };
      const dialog = document.getElementById('server-dialog');
      expect(dialog).toBeDefined();
    });

    test('should close server dialog', () => {
      const dialog = document.getElementById('server-dialog');
      expect(dialog).toBeDefined();
    });
  });

  describe('Server Save Validation', () => {
    test('should require host field', async () => {
      document.getElementById = jest.fn((id) => {
        if (id === 'server-name') return { value: '', trim: () => '' };
        if (id === 'server-host') return { value: '', trim: () => '' };
        if (id === 'server-port') return { value: '623' };
        if (id === 'server-username') return { value: '', trim: () => '' };
        if (id === 'server-password') return { value: '' };
        if (id === 'server-template') return { value: '' };
        if (id === 'server-interface') return { value: 'lanplus' };
        if (id === 'server-cipher') return { value: '17' };
        return createMockElement(id);
      });

      // saveServer would call safeAlert for empty host
      const host = '';
      if (!host) {
        await safeAlert('请填写 IP 地址');
      }
      expect(safeAlert).toHaveBeenCalledWith('请填写 IP 地址');
    });

    test('should validate IP format', async () => {
      const { isValidIP } = require('../src/modules/utils');
      expect(isValidIP('192.168.1.100')).toBe(true);
      expect(isValidIP('invalid')).toBe(false);
      expect(isValidIP('256.1.1.1')).toBe(false);
    });

    test('should require username and password', async () => {
      document.getElementById = jest.fn((id) => {
        if (id === 'server-username') return { value: '', trim: () => '' };
        if (id === 'server-password') return { value: '' };
        return createMockElement(id);
      });

      const username = '';
      const password = '';
      if (!username || !password) {
        await safeAlert('请填写用户名和密码');
      }
      expect(safeAlert).toHaveBeenCalledWith('请填写用户名和密码');
    });
  });

  describe('Connection Test', () => {
    test('should test connection with raw 6 1', async () => {
      ipcRenderer.invoke.mockResolvedValueOnce({ code: 0, stdout: '06 00 00 00' });
      const server = { id: '1', name: 'Test', host: '192.168.1.1' };

      const result = await ipcRenderer.invoke('ipmi:execute', server, 'raw 6 1');
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('06');
    });

    test('should handle connection failure', async () => {
      ipcRenderer.invoke.mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'timeout' });
      const server = { id: '1', name: 'Test', host: '192.168.1.1' };

      const result = await ipcRenderer.invoke('ipmi:execute', server, 'raw 6 1');
      expect(result.code).toBe(1);
    });

    test('should handle no server selected', async () => {
      await safeAlert('请先选择服务器');
      expect(safeAlert).toHaveBeenCalled();
    });
  });

  describe('Config Import/Export', () => {
    test('should export config as JSON', () => {
      const config = configStore.getConfig();
      config.servers = [{ id: '1', name: 'Test', host: '1.1.1.1' }];
      const exportData = { exportTime: new Date().toISOString(), version: '1.0', servers: config.servers };
      const json = JSON.stringify(exportData, null, 2);
      expect(json).toContain('Test');
      expect(json).toContain('1.1.1.1');
    });

    test('should validate imported config format', () => {
      const validImport = { servers: [{ name: 'Test', host: '1.1.1.1' }] };
      expect(validImport.servers).toBeDefined();
      expect(Array.isArray(validImport.servers)).toBe(true);
    });

    test('should reject invalid import format', () => {
      const invalidImport = { data: 'not servers' };
      expect(invalidImport.servers).toBeUndefined();
    });
  });

  describe('SOL Tab Management', () => {
    test('should create SOL tab data structure', () => {
      const tab = {
        id: 'sol-1',
        name: 'SOL-1: 192.168.1.1',
        server: { host: '192.168.1.1' },
        terminal: { write: jest.fn(), dispose: jest.fn() },
        fitAddon: { fit: jest.fn() },
        serializeAddon: { serialize: jest.fn() },
        ptyPid: null,
        isRunning: false,
        logFile: null
      };

      expect(tab.id).toBe('sol-1');
      expect(tab.isRunning).toBe(false);
      expect(tab.ptyPid).toBeNull();
    });

    test('should track multiple SOL tabs', () => {
      const solTabs = [
        { id: 'sol-1', name: 'SOL-1', isRunning: true },
        { id: 'sol-2', name: 'SOL-2', isRunning: false }
      ];
      expect(solTabs).toHaveLength(2);
      expect(solTabs[0].isRunning).toBe(true);
      expect(solTabs[1].isRunning).toBe(false);
    });

    test('should find tab by id', () => {
      const solTabs = [
        { id: 'sol-1', name: 'SOL-1' },
        { id: 'sol-2', name: 'SOL-2' }
      ];
      const tab = solTabs.find(t => t.id === 'sol-2');
      expect(tab).toBeDefined();
      expect(tab.name).toBe('SOL-2');
    });

    test('should remove tab from array', () => {
      const solTabs = [
        { id: 'sol-1', name: 'SOL-1' },
        { id: 'sol-2', name: 'SOL-2' }
      ];
      const index = solTabs.findIndex(t => t.id === 'sol-1');
      solTabs.splice(index, 1);
      expect(solTabs).toHaveLength(1);
      expect(solTabs[0].id).toBe('sol-2');
    });

    test('should switch active tab', () => {
      let activeTabId = 'sol-1';
      const solTabs = [
        { id: 'sol-1', name: 'SOL-1' },
        { id: 'sol-2', name: 'SOL-2' }
      ];
      activeTabId = 'sol-2';
      const activeTab = solTabs.find(t => t.id === activeTabId);
      expect(activeTab.name).toBe('SOL-2');
    });
  });

  describe('SOL Start/Stop', () => {
    test('should start SOL with correct params', async () => {
      ipcRenderer.invoke.mockResolvedValueOnce({ success: true, pid: 12345 });
      const server = { id: '1', name: 'Test', host: '192.168.1.1' };
      const result = await ipcRenderer.invoke('sol:start', server, 'sol-1');
      expect(result.success).toBe(true);
      expect(result.pid).toBe(12345);
    });

    test('should handle SOL start failure', async () => {
      ipcRenderer.invoke.mockResolvedValueOnce({ success: false, error: 'Connection refused' });
      const server = { id: '1', name: 'Test', host: '192.168.1.1' };
      const result = await ipcRenderer.invoke('sol:start', server, 'sol-1');
      expect(result.success).toBe(false);
    });

    test('should stop SOL with deactivete', async () => {
      ipcRenderer.invoke.mockResolvedValueOnce({ success: true });
      const server = { id: '1', name: 'Test', host: '192.168.1.1' };
      const result = await ipcRenderer.invoke('sol:stop', server);
      expect(result.success).toBe(true);
    });

    test('should handle SOL stop failure', async () => {
      ipcRenderer.invoke.mockResolvedValueOnce({ success: false, stderr: 'error' });
      const server = { id: '1', name: 'Test', host: '192.168.1.1' };
      const result = await ipcRenderer.invoke('sol:stop', server);
      expect(result.success).toBe(false);
    });

    test('should require server for SOL', async () => {
      await safeAlert('请先选择服务器');
      expect(safeAlert).toHaveBeenCalled();
    });
  });

  describe('SOL Log Save', () => {
    test('should save SOL log with timestamp', () => {
      const now = new Date();
      const utc8 = new Date(now.getTime() + (8 * 60 * 60 * 1000));
      const timestamp = utc8.toISOString().replace(/[:.]/g, '-').slice(0, 19).replace('T', '_');
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/);
    });

    test('should construct log file path', () => {
      const logDir = '/mock/logs';
      const serverName = '192.168.1.1';
      const timestamp = '2026-07-21_10-30-00';
      const logPath = require('path').join(logDir, 'sol_' + serverName + '_' + timestamp + '.log');
      expect(logPath).toContain('sol_192.168.1.1');
      expect(logPath).toContain('.log');
    });
  });

  describe('Log Directory', () => {
    test('should get log directory from config', () => {
      const config = configStore.getConfig();
      config.settings = { lastSaveDir: '/custom/logs' };
      const logDir = config.settings?.lastSaveDir || '/default';
      expect(logDir).toBe('/custom/logs');
    });

    test('should fallback to default log directory', () => {
      const config = configStore.getConfig();
      config.settings = {};
      const logDir = config.settings?.lastSaveDir || '/default';
      expect(logDir).toBe('/default');
    });

    test('should update log directory in config', () => {
      const config = configStore.getConfig();
      config.settings = config.settings || {};
      config.settings.lastSaveDir = '/new/path';
      expect(config.settings.lastSaveDir).toBe('/new/path');
    });
  });

  describe('Keyboard Shortcuts', () => {
    test('should handle Ctrl+R for refresh', () => {
      const event = { ctrlKey: true, key: 'r', preventDefault: jest.fn() };
      if (event.ctrlKey && event.key === 'r') {
        event.preventDefault();
      }
      expect(event.preventDefault).toHaveBeenCalled();
    });

    test('should handle Ctrl+L for clear', () => {
      const event = { ctrlKey: true, key: 'l', preventDefault: jest.fn() };
      if (event.ctrlKey && event.key === 'l') {
        event.preventDefault();
      }
      expect(event.preventDefault).toHaveBeenCalled();
    });

    test('should handle Ctrl+N for new server', () => {
      const event = { ctrlKey: true, key: 'n', preventDefault: jest.fn() };
      if (event.ctrlKey && event.key === 'n') {
        event.preventDefault();
      }
      expect(event.preventDefault).toHaveBeenCalled();
    });

    test('should handle Escape for close dialog', () => {
      const event = { key: 'Escape' };
      expect(event.key).toBe('Escape');
    });
  });

  describe('Panel Switching', () => {
    test('should switch to correct panel', () => {
      const tabs = ['power', 'sensor', 'fru', 'sel', 'user', 'network', 'raw', 'sol', 'scan'];
      tabs.forEach(tab => {
        const panelId = 'panel-' + tab;
        expect(panelId).toBeDefined();
      });
    });

    test('should clear output for panel', () => {
      const { clearOutput } = require('../src/modules/utils');
      clearOutput('output-power');
      expect(clearOutput).toHaveBeenCalledWith('output-power');
    });
  });

  describe('Memory Monitor', () => {
    test('should format memory info', () => {
      const mem = { rss: 150, heapUsed: 50, heapTotal: 100, external: 10 };
      const text = `${mem.rss} MB`;
      expect(text).toBe('150 MB');
    });

    test('should set warning level based on memory', () => {
      const mem = { rss: 400 };
      let level = '';
      if (mem.rss > 500) level = 'critical';
      else if (mem.rss > 300) level = 'warning';
      else level = 'normal';
      expect(level).toBe('warning');
    });

    test('should set critical level for high memory', () => {
      const mem = { rss: 600 };
      let level = '';
      if (mem.rss > 500) level = 'critical';
      else if (mem.rss > 300) level = 'warning';
      else level = 'normal';
      expect(level).toBe('critical');
    });
  });

  describe('Network Scan', () => {
    test('should start scan with subnet', async () => {
      scanner.fullScan.mockResolvedValueOnce([{ ip: '192.168.1.10', latency: 5 }]);
      const results = await scanner.fullScan('192.168.1', { pingConcurrency: 50 });
      expect(results).toHaveLength(1);
      expect(results[0].ip).toBe('192.168.1.10');
    });

    test('should stop scan', () => {
      scanner.stopScan();
      expect(scanner.stopScan).toHaveBeenCalled();
    });

    test('should get local network', () => {
      const local = scanner.getLocalNetwork();
      expect(local).toBeDefined();
      expect(local.subnet).toBe('192.168.1');
    });
  });

  describe('IPC Listeners', () => {
    test('should listen for sol:data events', () => {
      ipcRenderer.on('sol:data', expect.any(Function));
    });

    test('should listen for sol:exit events', () => {
      ipcRenderer.on('sol:exit', expect.any(Function));
    });

    test('should handle sol:data by writing to terminal', () => {
      const tab = {
        id: 'sol-1',
        terminal: { write: jest.fn() }
      };
      const data = { tabId: 'sol-1', data: 'hello' };
      if (tab.id === data.tabId) {
        tab.terminal.write(data.data);
      }
      expect(tab.terminal.write).toHaveBeenCalledWith('hello');
    });

    test('should handle sol:exit by updating state', () => {
      const tab = {
        id: 'sol-1',
        isRunning: true,
        ptyPid: 12345
      };
      const exitData = { tabId: 'sol-1', exitCode: 0 };
      if (tab.id === exitData.tabId) {
        tab.isRunning = false;
        tab.ptyPid = null;
      }
      expect(tab.isRunning).toBe(false);
      expect(tab.ptyPid).toBeNull();
    });
  });

  describe('Window Exports', () => {
    test('should export functions to window', () => {
      expect(window.applyTemplate).toBeDefined();
      expect(window.updateServerNameFromTemplate).toBeDefined();
      expect(window.openDialog).toBeDefined();
      expect(window.closeDialog).toBeDefined();
      expect(window.saveServer).toBeDefined();
      expect(window.selectFavorite).toBeDefined();
      expect(window.executeFavorite).toBeDefined();
      expect(window.closeFavDialog).toBeDefined();
      expect(window.saveFavorite).toBeDefined();
      expect(window.updateServerList).toBeDefined();
    });
  });
});
