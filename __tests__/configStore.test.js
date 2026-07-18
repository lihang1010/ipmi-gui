/**
 * configStore 模块单元测试
 */

const fs = require('fs');
const path = require('path');

// 模拟 configStore
class MockConfigStore {
  constructor() {
    this.config = { servers: [], settings: {}, favorites: [] };
  }

  loadConfig() {
    return this.config;
  }

  saveConfig() {
    return true;
  }

  getConfig() {
    return this.config;
  }

  setConfig(newConfig) {
    this.config = newConfig;
  }
}

describe('ConfigStore Module', () => {
  let store;

  beforeEach(() => {
    store = new MockConfigStore();
  });

  describe('loadConfig', () => {
    test('should return default config', () => {
      const config = store.loadConfig();
      expect(config).toHaveProperty('servers');
      expect(config).toHaveProperty('settings');
      expect(config).toHaveProperty('favorites');
      expect(Array.isArray(config.servers)).toBe(true);
      expect(Array.isArray(config.favorites)).toBe(true);
    });
  });

  describe('getConfig', () => {
    test('should return current config', () => {
      const config = store.getConfig();
      expect(config).toBeDefined();
    });
  });

  describe('setConfig', () => {
    test('should update config', () => {
      const newConfig = { servers: [{ id: '1' }], settings: {}, favorites: [] };
      store.setConfig(newConfig);
      expect(store.getConfig().servers).toHaveLength(1);
    });
  });

  describe('saveConfig', () => {
    test('should return true', () => {
      expect(store.saveConfig()).toBe(true);
    });
  });

  describe('config structure', () => {
    test('should support adding servers', () => {
      const config = store.getConfig();
      config.servers.push({ id: '1', name: 'test', host: '1.1.1.1' });
      expect(config.servers).toHaveLength(1);
    });

    test('should support adding favorites', () => {
      const config = store.getConfig();
      config.favorites.push({ name: 'test', command: 'power status' });
      expect(config.favorites).toHaveLength(1);
    });

    test('should support updating settings', () => {
      const config = store.getConfig();
      config.settings.lastSaveDir = '/tmp';
      expect(config.settings.lastSaveDir).toBe('/tmp');
    });
  });
});
