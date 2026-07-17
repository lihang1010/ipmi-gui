/**
 * UI 逻辑单元测试
 */

// 模拟 UI 管理逻辑
class UIManager {
  constructor() {
    this.activeTab = null;
    this.activePanel = null;
    this.tabs = [];
    this.panels = {};
  }

  registerTab(tabId, panelId) {
    this.tabs.push({ tabId, panelId });
  }

  switchTab(tabId) {
    const tab = this.tabs.find(t => t.tabId === tabId);
    if (!tab) return false;

    this.activeTab = tabId;
    this.activePanel = tab.panelId;
    return true;
  }

  getActiveTab() {
    return this.activeTab;
  }

  getActivePanel() {
    return this.activePanel;
  }

  isTabActive(tabId) {
    return this.activeTab === tabId;
  }

  getTabList() {
    return this.tabs.map(t => t.tabId);
  }
}

// 模拟日志目录管理
class LogDirManager {
  constructor(defaultDir) {
    this.defaultDir = defaultDir;
    this.currentDir = defaultDir;
    this.history = [];
  }

  getCurrentDir() {
    return this.currentDir;
  }

  setDir(dir) {
    if (dir && dir !== this.currentDir) {
      this.history.push(this.currentDir);
      this.currentDir = dir;
      return true;
    }
    return false;
  }

  resetToDefault() {
    this.currentDir = this.defaultDir;
    return true;
  }

  getShortPath(maxLength = 30) {
    if (this.currentDir.length <= maxLength) {
      return this.currentDir;
    }
    return '...' + this.currentDir.slice(-maxLength + 3);
  }

  getHistory() {
    return [...this.history];
  }
}

// 模拟 SOL 状态管理
class SolStateManager {
  constructor() {
    this.isRunning = false;
    this.serverId = null;
    this.startTime = null;
    this.endTime = null;
  }

  start(serverId) {
    if (this.isRunning) return false;
    this.isRunning = true;
    this.serverId = serverId;
    this.startTime = new Date();
    return true;
  }

  stop() {
    if (!this.isRunning) return false;
    this.isRunning = false;
    this.endTime = new Date();
    return true;
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      serverId: this.serverId,
      duration: this.isRunning ?
        Date.now() - this.startTime.getTime() : 0
    };
  }

  canStart() {
    return !this.isRunning;
  }

  canStop() {
    return this.isRunning;
  }
}

describe('UIManager', () => {
  let ui;

  beforeEach(() => {
    ui = new UIManager();
    ui.registerTab('sol', 'panel-sol');
    ui.registerTab('power', 'panel-power');
    ui.registerTab('sensor', 'panel-sensor');
  });

  test('should register tabs', () => {
    expect(ui.getTabList()).toEqual(['sol', 'power', 'sensor']);
  });

  test('should switch tab', () => {
    const result = ui.switchTab('power');
    expect(result).toBe(true);
    expect(ui.getActiveTab()).toBe('power');
    expect(ui.getActivePanel()).toBe('panel-power');
  });

  test('should return false for invalid tab', () => {
    const result = ui.switchTab('invalid');
    expect(result).toBe(false);
  });

  test('should check if tab is active', () => {
    ui.switchTab('sol');
    expect(ui.isTabActive('sol')).toBe(true);
    expect(ui.isTabActive('power')).toBe(false);
  });
});

describe('LogDirManager', () => {
  let logManager;

  beforeEach(() => {
    logManager = new LogDirManager('C:\\Users\\test\\Desktop');
  });

  test('should return default directory', () => {
    expect(logManager.getCurrentDir()).toBe('C:\\Users\\test\\Desktop');
  });

  test('should change directory', () => {
    const result = logManager.setDir('D:\\logs');
    expect(result).toBe(true);
    expect(logManager.getCurrentDir()).toBe('D:\\logs');
  });

  test('should not change to same directory', () => {
    const result = logManager.setDir('C:\\Users\\test\\Desktop');
    expect(result).toBe(false);
  });

  test('should reset to default', () => {
    logManager.setDir('D:\\logs');
    logManager.resetToDefault();
    expect(logManager.getCurrentDir()).toBe('C:\\Users\\test\\Desktop');
  });

  test('should get short path for long paths', () => {
    const longPath = 'C:\\Users\\test\\Documents\\Projects\\IPMI\\logs';
    logManager.setDir(longPath);
    const short = logManager.getShortPath(20);
    expect(short.length).toBeLessThanOrEqual(20);
    expect(short).toContain('...');
  });

  test('should return full path if short enough', () => {
    const shortPath = 'C:\\logs';
    logManager.setDir(shortPath);
    expect(logManager.getShortPath(20)).toBe(shortPath);
  });

  test('should maintain history', () => {
    logManager.setDir('D:\\logs1');
    logManager.setDir('D:\\logs2');
    const history = logManager.getHistory();
    expect(history).toHaveLength(2);
    expect(history[0]).toBe('C:\\Users\\test\\Desktop');
    expect(history[1]).toBe('D:\\logs1');
  });
});

describe('SolStateManager', () => {
  let sol;

  beforeEach(() => {
    sol = new SolStateManager();
  });

  test('should start SOL session', () => {
    const result = sol.start('server-1');
    expect(result).toBe(true);
    expect(sol.canStart()).toBe(false);
    expect(sol.canStop()).toBe(true);
  });

  test('should not start if already running', () => {
    sol.start('server-1');
    const result = sol.start('server-2');
    expect(result).toBe(false);
  });

  test('should stop SOL session', () => {
    sol.start('server-1');
    const result = sol.stop();
    expect(result).toBe(true);
    expect(sol.canStart()).toBe(true);
    expect(sol.canStop()).toBe(false);
  });

  test('should not stop if not running', () => {
    const result = sol.stop();
    expect(result).toBe(false);
  });

  test('should return status', () => {
    sol.start('server-1');
    const status = sol.getStatus();
    expect(status.isRunning).toBe(true);
    expect(status.serverId).toBe('server-1');
    expect(status.duration).toBeGreaterThanOrEqual(0);
  });

  test('should return zero duration when stopped', () => {
    const status = sol.getStatus();
    expect(status.duration).toBe(0);
  });
});

describe('Timestamp', () => {
  test('should generate UTC+8 timestamp', () => {
    const now = new Date();
    const utc8 = new Date(now.getTime() + (8 * 60 * 60 * 1000));
    const timestamp = utc8.toISOString().replace(/[:.]/g, '-').slice(0, 19).replace('T', '_');

    expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/);
  });

  test('should format log filename correctly', () => {
    const serverHost = '192.168.1.100';
    const timestamp = '2026-07-17_10-30-00';
    const filename = `sol_${serverHost}_${timestamp}.log`;

    expect(filename).toBe('sol_192.168.1.100_2026-07-17_10-30-00.log');
  });
});
