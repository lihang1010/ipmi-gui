const { contextBridge, ipcRenderer } = require('electron');

// 暴露 API 到渲染进程
contextBridge.exposeInMainWorld('api', {
  // 配置
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),

  // IPMI 命令
  executeCommand: (server, command, args) =>
    ipcRenderer.invoke('ipmi:execute', server, command, args),

  // SOL
  startSol: (server) => ipcRenderer.invoke('sol:start', server),
  stopSol: () => ipcRenderer.invoke('sol:stop'),
  deactivateSol: (server) => ipcRenderer.invoke('sol:deactivate', server),
  writeSol: (data) => ipcRenderer.send('sol:write', data),
  onSolData: (callback) => ipcRenderer.on('sol:data', (event, data) => callback(data)),
  onSolExit: (callback) => ipcRenderer.on('sol:exit', (event, code) => callback(code)),

  // 文件操作
  saveFile: (defaultName, content) => ipcRenderer.invoke('file:save', defaultName, content),
  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),
});
