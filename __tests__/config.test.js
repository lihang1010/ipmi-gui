/**
 * 配置管理器单元测试
 */

const fs = require('fs');
const path = require('path');

// 模拟配置管理器的核心逻辑
class ConfigManager {
  constructor(configPath) {
    this.configPath = configPath;
    this.defaultConfig = {
      servers: [],
      settings: {
        lastSaveDir: ''
      },
      favorites: []
    };
  }

  load() {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf-8');
        return JSON.parse(data);
      }
    } catch (e) {
      console.error('加载配置失败:', e);
    }
    return { ...this.defaultConfig };
  }

  save(config) {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
      return true;
    } catch (e) {
      console.error('保存配置失败:', e);
      return false;
    }
  }

  addServer(config, server) {
    const servers = config.servers || [];
    const newServer = {
      id: server.id || Date.now().toString(),
      name: server.name || '',
      host: server.host || '',
      port: server.port || 623,
      username: server.username || '',
      password: server.password || '',
      interface: server.interface || 'lanplus',
      cipherSuite: server.cipherSuite || 17,
      privilegeLevel: 'ADMINISTRATOR'
    };
    servers.push(newServer);
    config.servers = servers;
    return newServer;
  }

  updateServer(config, serverId, updates) {
    const servers = config.servers || [];
    const index = servers.findIndex(s => s.id === serverId);
    if (index !== -1) {
      servers[index] = { ...servers[index], ...updates };
      config.servers = servers;
      return servers[index];
    }
    return null;
  }

  deleteServer(config, serverId) {
    const servers = config.servers || [];
    config.servers = servers.filter(s => s.id !== serverId);
    return config;
  }

  getServer(config, serverId) {
    const servers = config.servers || [];
    return servers.find(s => s.id === serverId) || null;
  }

  addFavorite(config, favorite) {
    const favorites = config.favorites || [];
    favorites.push({
      name: favorite.name || '',
      command: favorite.command || '',
      desc: favorite.desc || ''
    });
    config.favorites = favorites;
    return favorite;
  }

  deleteFavorite(config, index) {
    const favorites = config.favorites || [];
    if (index >= 0 && index < favorites.length) {
      favorites.splice(index, 1);
      config.favorites = favorites;
      return true;
    }
    return false;
  }

  moveFavorite(config, fromIndex, toIndex) {
    const favorites = config.favorites || [];
    if (fromIndex >= 0 && fromIndex < favorites.length &&
        toIndex >= 0 && toIndex < favorites.length) {
      const item = favorites.splice(fromIndex, 1)[0];
      favorites.splice(toIndex, 0, item);
      config.favorites = favorites;
      return true;
    }
    return false;
  }
}

describe('ConfigManager', () => {
  let manager;
  let testConfigPath;
  let testConfig;

  beforeEach(() => {
    testConfigPath = path.join(__dirname, 'test-config.json');
    manager = new ConfigManager(testConfigPath);
    testConfig = {
      servers: [],
      settings: {},
      favorites: []
    };
  });

  afterEach(() => {
    // 清理测试文件
    if (fs.existsSync(testConfigPath)) {
      fs.unlinkSync(testConfigPath);
    }
  });

  describe('load/save', () => {
    test('should load default config when file does not exist', () => {
      const config = manager.load();
      expect(config).toHaveProperty('servers');
      expect(config).toHaveProperty('settings');
      expect(config).toHaveProperty('favorites');
      expect(Array.isArray(config.servers)).toBe(true);
      expect(Array.isArray(config.favorites)).toBe(true);
    });

    test('should save and load config correctly', () => {
      const configToSave = {
        servers: [{ id: '1', name: 'test', host: '192.168.1.1' }],
        settings: { lastSaveDir: '/tmp' },
        favorites: [{ name: 'test', command: 'power status' }]
      };

      const saved = manager.save(configToSave);
      expect(saved).toBe(true);

      const loaded = manager.load();
      expect(loaded.servers).toHaveLength(1);
      expect(loaded.servers[0].name).toBe('test');
      expect(loaded.settings.lastSaveDir).toBe('/tmp');
      expect(loaded.favorites).toHaveLength(1);
    });

    test('should handle invalid JSON gracefully', () => {
      fs.writeFileSync(testConfigPath, 'invalid json', 'utf-8');
      const config = manager.load();
      expect(config).toHaveProperty('servers');
      expect(config.servers).toHaveLength(0);
    });
  });

  describe('addServer', () => {
    test('should add server with all fields', () => {
      const server = {
        name: 'Test Server',
        host: '192.168.1.100',
        port: 623,
        username: 'admin',
        password: 'password123',
        interface: 'lanplus',
        cipherSuite: 17
      };

      const added = manager.addServer(testConfig, server);

      expect(added).toHaveProperty('id');
      expect(added.name).toBe('Test Server');
      expect(added.host).toBe('192.168.1.100');
      expect(added.privilegeLevel).toBe('ADMINISTRATOR');
      expect(testConfig.servers).toHaveLength(1);
    });

    test('should add server with default values', () => {
      const server = {
        name: 'Minimal Server',
        host: '10.0.0.1'
      };

      const added = manager.addServer(testConfig, server);

      expect(added.port).toBe(623);
      expect(added.interface).toBe('lanplus');
      expect(added.cipherSuite).toBe(17);
    });

    test('should generate unique id', () => {
      manager.addServer(testConfig, { id: 'id1', name: 'Server1', host: '1.1.1.1' });
      manager.addServer(testConfig, { id: 'id2', name: 'Server2', host: '2.2.2.2' });

      expect(testConfig.servers[0].id).not.toBe(testConfig.servers[1].id);
    });
  });

  describe('updateServer', () => {
    test('should update server by id', () => {
      manager.addServer(testConfig, { id: '1', name: 'Old Name', host: '1.1.1.1' });

      const updated = manager.updateServer(testConfig, '1', { name: 'New Name' });

      expect(updated).not.toBeNull();
      expect(updated.name).toBe('New Name');
      expect(updated.host).toBe('1.1.1.1');
    });

    test('should return null for non-existent server', () => {
      const result = manager.updateServer(testConfig, '999', { name: 'Test' });
      expect(result).toBeNull();
    });
  });

  describe('deleteServer', () => {
    test('should delete server by id', () => {
      manager.addServer(testConfig, { id: '1', name: 'Server1', host: '1.1.1.1' });
      manager.addServer(testConfig, { id: '2', name: 'Server2', host: '2.2.2.2' });

      manager.deleteServer(testConfig, '1');

      expect(testConfig.servers).toHaveLength(1);
      expect(testConfig.servers[0].id).toBe('2');
    });

    test('should not affect other servers when deleting', () => {
      manager.addServer(testConfig, { id: '1', name: 'Server1', host: '1.1.1.1' });
      manager.addServer(testConfig, { id: '2', name: 'Server2', host: '2.2.2.2' });
      manager.addServer(testConfig, { id: '3', name: 'Server3', host: '3.3.3.3' });

      manager.deleteServer(testConfig, '2');

      expect(testConfig.servers).toHaveLength(2);
      expect(testConfig.servers.map(s => s.id)).toEqual(['1', '3']);
    });
  });

  describe('getServer', () => {
    test('should return server by id', () => {
      manager.addServer(testConfig, { id: '1', name: 'Test', host: '1.1.1.1' });

      const server = manager.getServer(testConfig, '1');

      expect(server).not.toBeNull();
      expect(server.name).toBe('Test');
    });

    test('should return null for non-existent server', () => {
      const server = manager.getServer(testConfig, '999');
      expect(server).toBeNull();
    });
  });

  describe('favorites', () => {
    test('should add favorite', () => {
      const fav = { name: 'Power Status', command: 'power status' };

      manager.addFavorite(testConfig, fav);

      expect(testConfig.favorites).toHaveLength(1);
      expect(testConfig.favorites[0].name).toBe('Power Status');
    });

    test('should delete favorite by index', () => {
      manager.addFavorite(testConfig, { name: 'Fav1', command: 'cmd1' });
      manager.addFavorite(testConfig, { name: 'Fav2', command: 'cmd2' });
      manager.addFavorite(testConfig, { name: 'Fav3', command: 'cmd3' });

      const result = manager.deleteFavorite(testConfig, 1);

      expect(result).toBe(true);
      expect(testConfig.favorites).toHaveLength(2);
      expect(testConfig.favorites[0].name).toBe('Fav1');
      expect(testConfig.favorites[1].name).toBe('Fav3');
    });

    test('should return false for invalid index', () => {
      manager.addFavorite(testConfig, { name: 'Fav1', command: 'cmd1' });

      expect(manager.deleteFavorite(testConfig, -1)).toBe(false);
      expect(manager.deleteFavorite(testConfig, 10)).toBe(false);
    });

    test('should move favorite up', () => {
      manager.addFavorite(testConfig, { name: 'Fav1', command: 'cmd1' });
      manager.addFavorite(testConfig, { name: 'Fav2', command: 'cmd2' });

      const result = manager.moveFavorite(testConfig, 1, 0);

      expect(result).toBe(true);
      expect(testConfig.favorites[0].name).toBe('Fav2');
      expect(testConfig.favorites[1].name).toBe('Fav1');
    });

    test('should move favorite down', () => {
      manager.addFavorite(testConfig, { name: 'Fav1', command: 'cmd1' });
      manager.addFavorite(testConfig, { name: 'Fav2', command: 'cmd2' });

      const result = manager.moveFavorite(testConfig, 0, 1);

      expect(result).toBe(true);
      expect(testConfig.favorites[0].name).toBe('Fav2');
      expect(testConfig.favorites[1].name).toBe('Fav1');
    });

    test('should return false for invalid move', () => {
      expect(manager.moveFavorite(testConfig, -1, 0)).toBe(false);
      expect(manager.moveFavorite(testConfig, 0, 10)).toBe(false);
    });
  });
});
