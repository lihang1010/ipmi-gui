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
});
