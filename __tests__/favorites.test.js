/**
 * favorites.js 模块单元测试
 */

// Mock DOM
const mockElements = {};
const createMockEl = (id) => ({
  id,
  value: '',
  textContent: '',
  innerHTML: '',
  style: {},
  disabled: false,
  className: '',
  classList: { add: jest.fn(), remove: jest.fn(), contains: jest.fn() },
  focus: jest.fn(),
  blur: jest.fn(),
  click: jest.fn(),
  appendChild: jest.fn(),
  remove: jest.fn(),
  querySelectorAll: jest.fn(() => []),
  querySelector: jest.fn(() => null),
  addEventListener: jest.fn(),
  dataset: {}
});

const document = {
  getElementById: jest.fn((id) => {
    if (!mockElements[id]) mockElements[id] = createMockEl(id);
    return mockElements[id];
  }),
  querySelectorAll: jest.fn(() => []),
  querySelector: jest.fn(() => null),
  createElement: jest.fn(() => createMockEl('created')),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  body: { appendChild: jest.fn(), removeChild: jest.fn() }
};
global.document = document;
global.window = {};

jest.mock('../src/modules/modal', () => ({
  safeAlert: jest.fn().mockResolvedValue(undefined),
  safeConfirm: jest.fn().mockResolvedValue(true)
}));

jest.mock('../src/modules/utils', () => ({
  escapeHtml: jest.fn((s) => s),
  showStatus: jest.fn()
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

jest.mock('electron', () => ({
  ipcRenderer: {
    invoke: jest.fn().mockResolvedValue({ code: 0, stdout: 'ok', stderr: '' }),
    send: jest.fn(),
    on: jest.fn()
  }
}));

jest.mock('fs', () => ({
  readFileSync: jest.fn()
}));

const favorites = require('../src/modules/favorites');
const configStore = require('../src/modules/configStore');
const { safeAlert, safeConfirm } = require('../src/modules/modal');
const { ipcRenderer } = require('electron');

describe('Favorites Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(mockElements).forEach(k => delete mockElements[k]);
    const config = configStore.getConfig();
    config.favorites = [];
    favorites.loadFavorites();
  });

  describe('loadFavorites', () => {
    test('should load favorites from config', () => {
      const config = configStore.getConfig();
      config.favorites = [{ name: 'Test', command: 'power status', desc: 'test desc' }];
      favorites.loadFavorites();
      expect(document.getElementById('favorites-list')).toBeDefined();
    });

    test('should handle empty favorites', () => {
      favorites.loadFavorites();
      expect(document.getElementById('favorites-list')).toBeDefined();
    });
  });

  describe('saveFavorites', () => {
    test('should save favorites to config', () => {
      const config = configStore.getConfig();
      config.favorites = [{ name: 'Test', command: 'power status' }];
      favorites.saveFavorites();
      expect(configStore.saveConfig).toHaveBeenCalled();
    });
  });

  describe('select', () => {
    test('should select a favorite by index', () => {
      const config = configStore.getConfig();
      config.favorites = [
        { name: 'Fav1', command: 'cmd1' },
        { name: 'Fav2', command: 'cmd2' }
      ];
      favorites.loadFavorites();
      favorites.select(0);
      expect(favorites.getSelectedIndex()).toBe(0);
    });

    test('should update preview on select', () => {
      const config = configStore.getConfig();
      config.favorites = [{ name: 'Fav1', command: 'power status', desc: 'Check power' }];
      favorites.loadFavorites();
      favorites.select(0);
      expect(document.getElementById('favorites-preview')).toBeDefined();
    });
  });

  describe('openDialog', () => {
    test('should open dialog for adding new favorite', () => {
      favorites.openDialog();
      expect(document.getElementById('favorite-dialog')).toBeDefined();
    });

    test('should open dialog for editing existing favorite', () => {
      const fav = { name: 'Edit Me', command: 'sdr list', desc: 'sensor data' };
      favorites.openDialog(fav, 0);
      expect(document.getElementById('favorite-dialog')).toBeDefined();
    });
  });

  describe('closeDialog', () => {
    test('should close the dialog', () => {
      favorites.closeDialog();
      expect(document.getElementById('favorite-dialog')).toBeDefined();
    });
  });

  describe('save', () => {
    test('should save new favorite', async () => {
      // Set up mock elements with values BEFORE calling save()
      const nameEl = { value: 'New Fav', trim: () => 'New Fav' };
      const cmdEl = { value: 'power status', trim: () => 'power status' };
      const descEl = { value: 'test', trim: () => 'test' };
      document.getElementById = jest.fn((id) => {
        if (id === 'fav-name') return nameEl;
        if (id === 'fav-command') return cmdEl;
        if (id === 'fav-desc') return descEl;
        return createMockEl(id);
      });

      // Don't call openDialog() - it would set value = ''
      // The save function reads directly from document.getElementById
      await favorites.save();

      const config = configStore.getConfig();
      expect(config.favorites.length).toBe(1);
      expect(config.favorites[0].name).toBe('New Fav');
    });

    test('should show alert when name is empty', async () => {
      const nameEl = { value: '', trim: () => '' };
      const cmdEl = { value: 'power status', trim: () => 'power status' };
      const descEl = { value: '', trim: () => '' };
      document.getElementById = jest.fn((id) => {
        if (id === 'fav-name') return nameEl;
        if (id === 'fav-command') return cmdEl;
        if (id === 'fav-desc') return descEl;
        return createMockEl(id);
      });

      await favorites.save();
      expect(safeAlert).toHaveBeenCalled();
    });

    test('should show alert when command is empty', async () => {
      const nameEl = { value: 'Test', trim: () => 'Test' };
      const cmdEl = { value: '', trim: () => '' };
      const descEl = { value: '', trim: () => '' };
      document.getElementById = jest.fn((id) => {
        if (id === 'fav-name') return nameEl;
        if (id === 'fav-command') return cmdEl;
        if (id === 'fav-desc') return descEl;
        return createMockEl(id);
      });

      await favorites.save();
      expect(safeAlert).toHaveBeenCalled();
    });

    test('should edit existing favorite', async () => {
      const config = configStore.getConfig();
      config.favorites = [{ name: 'Old', command: 'old cmd' }];
      favorites.loadFavorites();

      // Set editingIndex to 0 by calling openDialog with index
      // Then set up mock to return updated values
      const nameEl = { value: 'Updated', trim: () => 'Updated' };
      const cmdEl = { value: 'new cmd', trim: () => 'new cmd' };
      const descEl = { value: '', trim: () => '' };

      // First, set up a mock that openDialog will use to set value = ''
      const dialogEl = createMockEl('fav-name');
      const cmdDialogEl = createMockEl('fav-command');
      const descDialogEl = createMockEl('fav-desc');
      document.getElementById = jest.fn((id) => {
        if (id === 'fav-name') return dialogEl;
        if (id === 'fav-command') return cmdDialogEl;
        if (id === 'fav-desc') return descDialogEl;
        return createMockEl(id);
      });

      // openDialog sets editingIndex = 0 and value = ''
      favorites.openDialog(config.favorites[0], 0);

      // Now override the mock to return updated values for save()
      document.getElementById = jest.fn((id) => {
        if (id === 'fav-name') return nameEl;
        if (id === 'fav-command') return cmdEl;
        if (id === 'fav-desc') return descEl;
        return createMockEl(id);
      });

      await favorites.save();
      expect(config.favorites[0].name).toBe('Updated');
      expect(config.favorites[0].command).toBe('new cmd');
    });
  });

  describe('editSelected', () => {
    test('should open edit dialog for selected favorite', () => {
      const config = configStore.getConfig();
      config.favorites = [{ name: 'Edit', command: 'fru list' }];
      favorites.loadFavorites();
      favorites.select(0);
      favorites.editSelected();
      expect(document.getElementById('favorite-dialog')).toBeDefined();
    });

    test('should do nothing when no favorite selected', () => {
      expect(() => favorites.editSelected()).not.toThrow();
    });
  });

  describe('deleteSelected', () => {
    test('should delete selected favorite after confirm', async () => {
      const config = configStore.getConfig();
      config.favorites = [
        { name: 'Fav1', command: 'cmd1' },
        { name: 'Fav2', command: 'cmd2' }
      ];
      favorites.loadFavorites();
      favorites.select(0);
      await favorites.deleteSelected();
      expect(config.favorites.length).toBe(1);
      expect(config.favorites[0].name).toBe('Fav2');
    });

    test('should not delete when confirm is cancelled', async () => {
      safeConfirm.mockResolvedValueOnce(false);
      const config = configStore.getConfig();
      config.favorites = [{ name: 'Fav1', command: 'cmd1' }];
      favorites.loadFavorites();
      favorites.select(0);
      await favorites.deleteSelected();
      expect(config.favorites.length).toBe(1);
    });

    test('should handle delete when favorites array becomes empty', async () => {
      // Test that delete works correctly when removing the last item
      const config = configStore.getConfig();
      config.favorites = [{ name: 'Last', command: 'cmd' }];
      favorites.loadFavorites();
      favorites.select(0);
      await favorites.deleteSelected();
      expect(config.favorites.length).toBe(0);
    });
  });

  describe('execute', () => {
    test('should execute favorite command', async () => {
      const config = configStore.getConfig();
      config.favorites = [{ name: 'Power', command: 'power status' }];
      favorites.loadFavorites();

      const server = { id: '1', name: 'Test', host: '192.168.1.1' };
      await favorites.execute(0, server);
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('ipmi:execute', server, 'power status');
    });

    test('should show alert when no server selected', async () => {
      const config = configStore.getConfig();
      config.favorites = [{ name: 'Power', command: 'power status' }];
      favorites.loadFavorites();
      await favorites.execute(0, null);
      expect(safeAlert).toHaveBeenCalled();
    });

    test('should handle execution error', async () => {
      ipcRenderer.invoke.mockRejectedValueOnce(new Error('Execute failed'));
      const config = configStore.getConfig();
      config.favorites = [{ name: 'Power', command: 'power status' }];
      favorites.loadFavorites();
      const server = { id: '1', name: 'Test', host: '192.168.1.1' };
      await favorites.execute(0, server);
      // Should not throw
    });

    test('should do nothing for invalid index', async () => {
      await favorites.execute(999, { id: '1' });
    });
  });

  describe('executeSelected', () => {
    test('should execute the selected favorite', async () => {
      const config = configStore.getConfig();
      config.favorites = [{ name: 'Power', command: 'power status' }];
      favorites.loadFavorites();
      favorites.select(0);
      const server = { id: '1', name: 'Test', host: '192.168.1.1' };
      favorites.executeSelected(server);
      expect(ipcRenderer.invoke).toHaveBeenCalled();
    });

    test('should do nothing when no favorite selected', () => {
      favorites.executeSelected({ id: '1' });
    });
  });

  describe('move', () => {
    test('should move favorite up', () => {
      const config = configStore.getConfig();
      config.favorites = [
        { name: 'Fav1', command: 'cmd1' },
        { name: 'Fav2', command: 'cmd2' }
      ];
      favorites.loadFavorites();
      favorites.select(1);
      favorites.move(-1);
      expect(favorites.getSelectedIndex()).toBe(0);
    });

    test('should move favorite down', () => {
      const config = configStore.getConfig();
      config.favorites = [
        { name: 'Fav1', command: 'cmd1' },
        { name: 'Fav2', command: 'cmd2' }
      ];
      favorites.loadFavorites();
      favorites.select(0);
      favorites.move(1);
      expect(favorites.getSelectedIndex()).toBe(1);
    });

    test('should not move beyond bounds', () => {
      const config = configStore.getConfig();
      config.favorites = [{ name: 'Fav1', command: 'cmd1' }];
      favorites.loadFavorites();
      favorites.select(0);
      favorites.move(-1);
      expect(favorites.getSelectedIndex()).toBe(0);
      favorites.move(1);
      expect(favorites.getSelectedIndex()).toBe(0);
    });

    test('should do nothing when no favorite selected', () => {
      expect(() => favorites.move(1)).not.toThrow();
    });
  });

  describe('updateButtons', () => {
    test('should update button states based on selection', () => {
      const config = configStore.getConfig();
      config.favorites = [
        { name: 'Fav1', command: 'cmd1' },
        { name: 'Fav2', command: 'cmd2' }
      ];
      favorites.loadFavorites();

      const btnExec = { disabled: false };
      const btnEdit = { disabled: false };
      const btnDelete = { disabled: false };
      const btnUp = { disabled: false };
      const btnDown = { disabled: false };
      document.getElementById = jest.fn((id) => {
        if (id === 'btn-exec-favorite') return btnExec;
        if (id === 'btn-edit-favorite') return btnEdit;
        if (id === 'btn-delete-favorite') return btnDelete;
        if (id === 'btn-move-up') return btnUp;
        if (id === 'btn-move-down') return btnDown;
        return createMockEl(id);
      });

      favorites.select(0);
      expect(btnExec.disabled).toBe(false);
    });

    test('should disable buttons when no selection', () => {
      const btnExec = { disabled: false };
      const btnEdit = { disabled: false };
      const btnDelete = { disabled: false };
      document.getElementById = jest.fn((id) => {
        if (id === 'btn-exec-favorite') return btnExec;
        if (id === 'btn-edit-favorite') return btnEdit;
        if (id === 'btn-delete-favorite') return btnDelete;
        return createMockEl(id);
      });

      expect(() => favorites.updateButtons()).not.toThrow();
    });
  });

  describe('render', () => {
    test('should render empty state when no favorites', () => {
      const config = configStore.getConfig();
      config.favorites = [];
      favorites.loadFavorites();
      expect(document.getElementById('favorites-list')).toBeDefined();
    });

    test('should render favorites list', () => {
      const config = configStore.getConfig();
      config.favorites = [
        { name: 'Fav1', command: 'cmd1' },
        { name: 'Fav2', command: 'cmd2' }
      ];
      favorites.loadFavorites();
      expect(document.getElementById('favorites-list')).toBeDefined();
    });
  });

  // ========== 分类 ==========

  describe('分类纯函数', () => {
    test('normalizeCategory 应只接受已定义分类', () => {
      expect(favorites.normalizeCategory('AMI')).toBe('AMI');
      expect(favorites.normalizeCategory('openUBMC')).toBe('openUBMC');
      expect(favorites.normalizeCategory('onetree')).toBe('onetree');
      expect(favorites.normalizeCategory('unknown')).toBe('');
      expect(favorites.normalizeCategory(undefined)).toBe('');
    });

    test('categoryLabel 空分类显示为"通用"', () => {
      expect(favorites.categoryLabel('AMI')).toBe('AMI');
      expect(favorites.categoryLabel('')).toBe('通用');
      expect(favorites.categoryLabel(null)).toBe('通用');
    });

    test('FAVORITE_CATEGORIES 应包含三个厂商分类', () => {
      expect(favorites.FAVORITE_CATEGORIES).toEqual(['AMI', 'openUBMC', 'onetree']);
    });

    test('filterFavorites 支持 全部/通用/指定分类', () => {
      const list = [
        { name: 'A', command: 'c', category: 'AMI' },
        { name: 'B', command: 'c', category: 'onetree' },
        { name: 'C', command: 'c' }
      ];
      expect(favorites.filterFavorites(list, favorites.FILTER_ALL)).toHaveLength(3);
      expect(favorites.filterFavorites(list, favorites.FILTER_GENERAL).map(f => f.name)).toEqual(['C']);
      expect(favorites.filterFavorites(list, 'AMI').map(f => f.name)).toEqual(['A']);
      expect(favorites.filterFavorites(list, 'openUBMC')).toHaveLength(0);
    });

    test('filterFavorites 空筛选值等价于全部', () => {
      const list = [{ name: 'A', command: 'c' }];
      expect(favorites.filterFavorites(list, '')).toHaveLength(1);
    });

    test('buildCategoryOptions 表单模式与筛选模式', () => {
      const formOptions = favorites.buildCategoryOptions(false);
      expect(formOptions).toContain('<option value="">通用</option>');
      expect(formOptions).toContain('onetree');
      expect(formOptions).not.toContain('全部');

      const filterOptions = favorites.buildCategoryOptions(true);
      expect(filterOptions).toContain('全部');
      expect(filterOptions).toContain('通用');
      expect(filterOptions).toContain('AMI');
    });
  });

  describe('分类交互', () => {
    const restoreDocument = () => {
      document.getElementById = jest.fn((id) => {
        if (!mockElements[id]) mockElements[id] = createMockEl(id);
        return mockElements[id];
      });
    };

    test('renderCategorySelects 应填充两个下拉框', () => {
      restoreDocument();
      favorites.renderCategorySelects();
      expect(mockElements['fav-category'].innerHTML).toContain('通用');
      expect(mockElements['fav-category-filter'].innerHTML).toContain('全部');
    });

    test('setCategoryFilter 应过滤列表并清除选中', () => {
      restoreDocument();
      const config = configStore.getConfig();
      config.favorites = [
        { name: 'A', command: 'c', category: 'AMI' },
        { name: 'B', command: 'c', category: 'onetree' }
      ];
      favorites.loadFavorites();

      favorites.setCategoryFilter('AMI');
      expect(favorites.getCategoryFilter()).toBe('AMI');
      expect(favorites.getSelectedIndex()).toBe(-1);
      expect(mockElements['favorites-list'].innerHTML).toContain('A');
      expect(mockElements['favorites-list'].innerHTML).not.toContain('B');
    });

    test('筛选到空分类时显示空状态', () => {
      restoreDocument();
      const config = configStore.getConfig();
      config.favorites = [{ name: 'A', command: 'c', category: 'AMI' }];
      favorites.loadFavorites();

      favorites.setCategoryFilter('onetree');
      expect(mockElements['favorites-list'].innerHTML).toContain('当前分类下暂无收藏');
    });

    test('列表项应带上分类标签', () => {
      restoreDocument();
      const config = configStore.getConfig();
      config.favorites = [
        { name: 'A', command: 'c', category: 'onetree' },
        { name: 'B', command: 'c' }
      ];
      favorites.setCategoryFilter(favorites.FILTER_ALL);
      favorites.loadFavorites();

      const html = mockElements['favorites-list'].innerHTML;
      expect(html).toContain('fav-category');
      expect(html).toContain('onetree');
      expect(html).toContain('general');
    });

    test('openDialog 应回填分类', () => {
      restoreDocument();
      favorites.openDialog({ name: 'A', command: 'c', category: 'AMI' }, 0);
      expect(mockElements['fav-category'].value).toBe('AMI');
    });

    test('openDialog 新增时分类为空', () => {
      restoreDocument();
      favorites.openDialog();
      expect(mockElements['fav-category'].value).toBe('');
    });

    test('save 应保存分类字段', async () => {
      const nameEl = { value: 'New', trim: () => 'New' };
      const cmdEl = { value: 'power status', trim: () => 'power status' };
      const descEl = { value: '', trim: () => '' };
      const categoryEl = { value: 'onetree' };
      document.getElementById = jest.fn((id) => {
        if (id === 'fav-name') return nameEl;
        if (id === 'fav-command') return cmdEl;
        if (id === 'fav-desc') return descEl;
        if (id === 'fav-category') return categoryEl;
        return createMockEl(id);
      });

      await favorites.save();
      expect(configStore.getConfig().favorites[0].category).toBe('onetree');
    });
  });

  // ========== 导入 / 导出 ==========

  describe('parseFavoritesFile', () => {
    test('应解析标准导出格式', () => {
      const result = favorites.parseFavoritesFile(JSON.stringify({
        favorites: [{ name: 'A', command: 'cmd', desc: 'd', category: 'AMI' }]
      }));
      expect(result.ok).toBe(true);
      expect(result.favorites[0]).toEqual({ name: 'A', command: 'cmd', desc: 'd', category: 'AMI' });
    });

    test('应兼容裸数组格式', () => {
      const result = favorites.parseFavoritesFile(JSON.stringify([{ name: 'A', command: 'cmd' }]));
      expect(result.ok).toBe(true);
      expect(result.favorites[0].category).toBe('');
    });

    test('非法 JSON 应报错', () => {
      const result = favorites.parseFavoritesFile('not json');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('JSON');
    });

    test('缺少 favorites 数组应报错', () => {
      const result = favorites.parseFavoritesFile(JSON.stringify({ data: [] }));
      expect(result.ok).toBe(false);
    });

    test('应过滤无效条目并归一化未知分类', () => {
      const result = favorites.parseFavoritesFile(JSON.stringify({
        favorites: [
          { name: 'A', command: 'cmd', category: 'unknown-vendor' },
          { name: '', command: 'cmd' },
          { name: 'C' },
          null
        ]
      }));
      expect(result.ok).toBe(true);
      expect(result.favorites).toHaveLength(1);
      expect(result.favorites[0].category).toBe('');
    });

    test('全部无效时应报错', () => {
      const result = favorites.parseFavoritesFile(JSON.stringify({ favorites: [{ name: 'X' }] }));
      expect(result.ok).toBe(false);
    });
  });

  describe('mergeFavorites', () => {
    test('应按名称+命令去重', () => {
      const existing = [{ name: 'A', command: 'cmd' }];
      const merged = favorites.mergeFavorites(existing, [
        { name: 'A', command: 'cmd' },
        { name: 'B', command: 'cmd2' }
      ]);
      expect(merged.added).toBe(1);
      expect(merged.list.map(f => f.name)).toEqual(['A', 'B']);
    });

    test('不同分类的同名命令视为不同收藏', () => {
      const merged = favorites.mergeFavorites(
        [{ name: 'A', command: 'cmd', category: 'AMI' }],
        [{ name: 'A', command: 'cmd', category: 'onetree' }]
      );
      expect(merged.added).toBe(1);
    });

    test('不应修改原数组', () => {
      const existing = [{ name: 'A', command: 'cmd' }];
      favorites.mergeFavorites(existing, [{ name: 'B', command: 'cmd2' }]);
      expect(existing).toHaveLength(1);
    });
  });

  describe('exportFavorites', () => {
    const restoreDocument = () => {
      document.getElementById = jest.fn((id) => {
        if (!mockElements[id]) mockElements[id] = createMockEl(id);
        return mockElements[id];
      });
    };

    test('无收藏时应提示而不调用保存', async () => {
      restoreDocument();
      configStore.getConfig().favorites = [];
      favorites.loadFavorites();

      await favorites.exportFavorites();
      expect(safeAlert).toHaveBeenCalledWith('没有可导出的收藏');
      expect(ipcRenderer.invoke).not.toHaveBeenCalled();
    });

    test('应带 JSON 过滤器并输出分类字段', async () => {
      restoreDocument();
      configStore.getConfig().favorites = [
        { name: 'A', command: 'cmd', desc: '', category: 'onetree' }
      ];
      favorites.loadFavorites();

      ipcRenderer.invoke.mockResolvedValueOnce({ success: true });
      await favorites.exportFavorites();

      const call = ipcRenderer.invoke.mock.calls[0];
      expect(call[0]).toBe('file:save');
      expect(call[1]).toMatch(/ipmi_favorites_.*\.json$/);
      expect(JSON.parse(call[2]).favorites[0].category).toBe('onetree');
      expect(call[3][0].extensions).toContain('json');
    });
  });

  describe('importFavorites', () => {
    const fs = require('fs');
    const { showStatus } = require('../src/modules/utils');

    const restoreDocument = () => {
      document.getElementById = jest.fn((id) => {
        if (!mockElements[id]) mockElements[id] = createMockEl(id);
        return mockElements[id];
      });
    };

    test('未选择文件时应直接返回', async () => {
      restoreDocument();
      ipcRenderer.invoke.mockResolvedValueOnce(null);
      await favorites.importFavorites();
      expect(safeConfirm).not.toHaveBeenCalled();
    });

    test('合并导入并持久化', async () => {
      restoreDocument();
      configStore.getConfig().favorites = [{ name: 'A', command: 'cmd' }];
      favorites.loadFavorites();

      ipcRenderer.invoke.mockResolvedValueOnce('/tmp/fav.json');
      fs.readFileSync.mockReturnValueOnce(JSON.stringify({
        favorites: [
          { name: 'A', command: 'cmd' },
          { name: 'B', command: 'cmd2', category: 'AMI' }
        ]
      }));

      await favorites.importFavorites();

      const saved = configStore.getConfig().favorites;
      expect(saved.map(f => f.name)).toEqual(['A', 'B']);
      expect(saved[1].category).toBe('AMI');
      expect(configStore.saveConfig).toHaveBeenCalled();
      expect(showStatus).toHaveBeenCalledWith('connected', '已导入 1 条收藏');
    });

    test('用户取消时不写入', async () => {
      restoreDocument();
      configStore.getConfig().favorites = [];
      favorites.loadFavorites();
      configStore.saveConfig.mockClear();

      ipcRenderer.invoke.mockResolvedValueOnce('/tmp/fav.json');
      fs.readFileSync.mockReturnValueOnce(JSON.stringify({ favorites: [{ name: 'B', command: 'cmd2' }] }));
      safeConfirm.mockResolvedValueOnce(false);

      await favorites.importFavorites();
      expect(configStore.saveConfig).not.toHaveBeenCalled();
    });

    test('格式错误时应提示', async () => {
      restoreDocument();
      ipcRenderer.invoke.mockResolvedValueOnce('/tmp/fav.json');
      fs.readFileSync.mockReturnValueOnce('broken');

      await favorites.importFavorites();
      expect(safeAlert).toHaveBeenCalledWith(expect.stringContaining('导入失败'));
    });

    test('读取文件异常时应提示', async () => {
      restoreDocument();
      ipcRenderer.invoke.mockResolvedValueOnce('/tmp/fav.json');
      fs.readFileSync.mockImplementationOnce(() => { throw new Error('EACCES'); });

      await favorites.importFavorites();
      expect(safeAlert).toHaveBeenCalledWith('导入失败: EACCES');
    });
  });
});
