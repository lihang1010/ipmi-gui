# IPMI 管理工具 - 代码架构

## 一、项目结构

```
ipmi-gui-electron/
├── main.js                    # Electron 主进程 (302行)
├── preload.js                 # 预加载脚本 (20行)
├── package.json               # 项目配置
├── build.yml                  # electron-builder 配置
├── build.ps1                  # 构建脚本
│
├── src/
│   ├── index.html             # 主界面 HTML (249行)
│   ├── renderer.js            # 渲染进程脚本 (770行) ⭐核心
│   └── style.css              # 样式文件 (824行)
│
├── bin/                       # ipmitool 文件 (打包时复制)
│   ├── ipmitool.exe
│   ├── cygwin1.dll
│   ├── cygcrypto-1.0.0.dll
│   └── cygz.dll
│
├── __tests__/                 # 单元测试
│   ├── command.test.js        # 命令构建器测试 (19用例)
│   ├── config.test.js         # 配置管理测试 (24用例)
│   ├── parser.test.js         # 输出解析器测试 (19用例)
│   └── ui.test.js             # UI逻辑测试 (14用例)
│
└── assets/
    └── icon.ico               # 应用图标
```

---

## 二、架构分层

```
┌─────────────────────────────────────────────────────────────────┐
│                        Electron 主进程                           │
│                           (main.js)                             │
├─────────────────────────────────────────────────────────────────┤
│  • 窗口管理 (BrowserWindow)                                      │
│  • 配置文件读写 (config.json)                                     │
│  • ipmitool 命令执行 (child_process)                             │
│  • SOL 终端管理 (node-pty)                                       │
│  • 文件对话框 (dialog)                                           │
│  • IPC 通信处理                                                  │
├─────────────────────────────────────────────────────────────────┤
│                        IPC 通道                                  │
│  config:get/save, ipmi:execute, sol:start/stop/write/deactivate │
│  file:save, dialog:selectDirectory/File                        │
├─────────────────────────────────────────────────────────────────┤
│                      渲染进程 (renderer.js)                      │
├─────────────────────────────────────────────────────────────────┤
│  • UI 状态管理                                                   │
│  • 表单验证                                                      │
│  • 弹窗管理 (自定义模态框)                                        │
│  • 终端管理 (xterm.js)                                           │
│  • 收藏夹管理                                                    │
│  • 键盘快捷键                                                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 三、模块职责

### 3.1 主进程 (main.js)

| 函数 | 职责 | 行数 |
|------|------|------|
| `loadConfig()` | 加载配置文件 | 10 |
| `saveConfig()` | 保存配置文件 | 8 |
| `createWindow()` | 创建主窗口 | 18 |
| `buildArgs()` | 构建 ipmitool 参数 | 12 |
| `getIpmiToolPath()` | 查找 ipmitool 路径 | 20 |
| IPC: `config:get/save` | 配置读写 | 10 |
| IPC: `ipmi:execute` | 执行 IPMI 命令 | 20 |
| IPC: `sol:start/stop/write` | SOL 管理 | 60 |
| IPC: `file:save` | 文件保存对话框 | 15 |
| IPC: `dialog:select*` | 目录/文件选择 | 20 |

**依赖**: electron, node-pty, fs, path, child_process

### 3.2 渲染进程 (renderer.js)

| 模块 | 函数 | 职责 |
|------|------|------|
| **配置管理** | `loadConfig()`, `saveConfigToFile()` | 配置读写 |
| **弹窗系统** | `showModal()`, `safeAlert()`, `safeConfirm()` | 替代原生弹窗 |
| **工具函数** | `resetFocus()`, `escapeHtml()`, `showStatus()` | 通用工具 |
| **初始化** | `initTerminal()`, `bindEvents()` | 应用初始化 |
| **服务器管理** | `updateServerList()`, `openDialog()`, `saveServer()`, `deleteServer()` | CRUD |
| **服务器模板** | `applyTemplate()`, `updateServerNameFromTemplate()` | 模板填充 |
| **连接测试** | `testConnection()` | 测试连接 |
| **导入导出** | `exportConfig()`, `importConfig()` | 配置导入导出 |
| **SOL操作** | `startSol()`, `stopSol()`, `saveSolLog()` | SOL终端 |
| **日志目录** | `getLogDir()`, `updateLogDirDisplay()`, `selectLogDir()` | 日志管理 |
| **收藏夹** | `loadFavorites()`, `saveFavorites()`, `renderFavorites()` | 收藏管理 |
| **命令执行** | `executeCommand()`, `executePower()`, `executeRawCommand()` | 命令执行 |

**依赖**: electron (ipcRenderer), xterm, @xterm/addon-fit, @xterm/addon-serialize

### 3.3 样式 (style.css)

| 模块 | 行数 | 说明 |
|------|------|------|
| CSS 变量 | 80 | 设计系统 (颜色/间距/圆角/阴影) |
| 工具栏 | 30 | 顶部工具栏 |
| 选项卡 | 30 | Tab 切换 |
| 面板 | 20 | 内容面板 |
| 终端 | 15 | xterm.js 容器 |
| 输出区域 | 20 | 命令输出显示 |
| 按钮 | 60 | 各种按钮样式 |
| 对话框 | 80 | 模态框 |
| 表单 | 40 | 输入框/选择框 |
| 收藏夹 | 80 | 收藏列表 |
| 滚动条 | 15 | 自定义滚动条 |

---

## 四、数据流

### 4.1 配置数据

```
配置文件 (%APPDATA%/ipmi-gui/config.json)
    │
    ├── loadConfig() → config 对象
    │       │
    │       ├── config.servers[]     服务器列表
    │       ├── config.settings{}    设置
    │       └── config.favorites[]   收藏夹
    │
    └── saveConfigToFile() ← config 对象
```

### 4.2 命令执行流程

```
用户点击按钮
    │
    ├── renderer.js: executeCommand()
    │       │
    │       └── ipcRenderer.invoke('ipmi:execute', server, command)
    │
    └── main.js: ipcMain.handle('ipmi:execute')
            │
            ├── buildArgs(server)     构建参数
            ├── getIpmiToolPath()     获取路径
            └── child_process.spawn() 执行命令
                    │
                    └── 返回 { code, stdout, stderr }
```

### 4.3 SOL 终端流程

```
用户点击"启动 SOL"
    │
    ├── renderer.js: startSol()
    │       │
    │       └── ipcRenderer.invoke('sol:start', server)
    │
    └── main.js: ipcMain.handle('sol:start')
            │
            ├── pty.spawn()           创建伪终端
            ├── ptyProcess.onData()   转发输出
            └── ptyProcess.onExit()   处理退出
                    │
                    └── mainWindow.webContents.send('sol:data')
                            │
                            └── renderer.js: terminal.write(data)
```

---

## 五、IPC 通信表

| 通道 | 方向 | 参数 | 返回 |
|------|------|------|------|
| `config:get` | 渲染→主 | - | config |
| `config:save` | 渲染→主 | config | true |
| `ipmi:execute` | 渲染→主 | server, command | {code, stdout, stderr} |
| `sol:start` | 渲染→主 | server | {success, pid/error} |
| `sol:stop` | 渲染→主 | server | {success, stderr} |
| `sol:write` | 渲染→主 | data | - |
| `sol:data` | 主→渲染 | data | - |
| `sol:exit` | 主→渲染 | code | - |
| `file:save` | 渲染→主 | path, content | {success, path} |
| `dialog:selectDirectory` | 渲染→主 | - | path |
| `dialog:selectFile` | 渲染→主 | filters | path |

---

## 六、配置文件结构

```json
{
  "servers": [
    {
      "id": "string",
      "name": "string",
      "host": "string",
      "port": 623,
      "username": "string",
      "password": "string",
      "interface": "lanplus|lan",
      "cipherSuite": 17,
      "privilegeLevel": "ADMINISTRATOR",
      "groupId": "string"
    }
  ],
  "settings": {
    "lastSaveDir": "string"
  },
  "favorites": [
    {
      "name": "string",
      "command": "string",
      "desc": "string"
    }
  ]
}
```

---

## 七、依赖关系

```
┌─────────────────────────────────────────────────────────────┐
│                      Electron                                │
├─────────────────────────────────────────────────────────────┤
│  main.js                                                    │
│    ├── electron (app, BrowserWindow, ipcMain, dialog)       │
│    ├── node-pty (SOL 终端)                                   │
│    ├── child_process (执行 ipmitool)                         │
│    └── fs, path (文件操作)                                    │
├─────────────────────────────────────────────────────────────┤
│  renderer.js                                                │
│    ├── electron (ipcRenderer)                               │
│    ├── xterm (终端渲染)                                      │
│    ├── @xterm/addon-fit (自适应尺寸)                         │
│    └── @xterm/addon-serialize (内容序列化)                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 八、代码统计

| 文件 | 行数 | 说明 |
|------|------|------|
| main.js | 302 | 主进程 |
| renderer.js | 770 | 渲染进程 (核心) |
| index.html | 249 | 界面结构 |
| style.css | 824 | 样式 |
| preload.js | 20 | 预加载 |
| **总计** | **2165** | |

| 测试文件 | 用例数 |
|----------|--------|
| command.test.js | 19 |
| config.test.js | 24 |
| parser.test.js | 19 |
| ui.test.js | 14 |
| **总计** | **76** |

---

## 九、已知问题与技术债务

| 问题 | 说明 | 优先级 |
|------|------|--------|
| renderer.js 过大 | 770行，应拆分为模块 | 高 |
| 配置读写重复 | main.js 和 renderer.js 都有配置读写 | 中 |
| 无 TypeScript | 类型安全缺失 | 中 |
| 测试覆盖模拟实现 | 测试使用独立模拟，未导入源码 | 中 |
| 无错误边界 | 未捕获的异常可能导致崩溃 | 低 |

---

*文档版本: v1.0*
*更新时间: 2026-07-18*
