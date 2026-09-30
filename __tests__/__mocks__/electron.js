// Electron 主进程 mock
const app = {
  getPath: (name) => {
    if (name === 'userData') return '/mock/userData';
    if (name === 'exe') return '/mock/app.exe';
    if (name === 'temp') return '/mock/temp';
    return '/mock/' + name;
  },
  whenReady: () => Promise.resolve(),
  on: jest.fn(),
  quit: jest.fn()
};

const BrowserWindow = jest.fn().mockImplementation((opts) => ({
  loadFile: jest.fn(),
  isDestroyed: () => false,
  webContents: {
    send: jest.fn()
  }
}));
BrowserWindow.getAllWindows = () => [];

const ipcMain = {
  handle: jest.fn(),
  on: jest.fn()
};

const dialog = {
  showSaveDialog: jest.fn().mockResolvedValue({ canceled: false, filePath: '/mock/save.json' }),
  showOpenDialog: jest.fn().mockResolvedValue({ canceled: false, filePaths: ['/mock/open.json'] })
};

// Electron 渲染进程 mock
const ipcRenderer = {
  invoke: jest.fn().mockResolvedValue({}),
  send: jest.fn(),
  on: jest.fn()
};

const contextBridge = {
  exposeInMainWorld: jest.fn()
};

// 主窗口按屏幕工作区计算尺寸（main.js createWindow）
const screen = {
  getPrimaryDisplay: jest.fn(() => ({
    workAreaSize: { width: 1920, height: 1040 }
  }))
};

module.exports = {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  ipcRenderer,
  contextBridge,
  screen
};
