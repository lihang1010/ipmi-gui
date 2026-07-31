# IPMI 管理工具 - 代码架构

## 一、项目结构

```
ipmi-gui-electron/
├── main.js                    # Electron 主进程 (307行)
├── preload.js                 # 预加载脚本 (23行, contextBridge 未实际使用)
├── package.json               # 项目配置
├── electron-builder.yml       # electron-builder 配置
├── build.ps1 / build.bat      # 构建脚本
│
├── src/
│   ├── index.html             # 主界面 HTML (295行)
│   ├── renderer.js            # 渲染进程脚本 (1056行) ⭐核心
│   ├── style.css              # 样式文件 (1119行)
│   ├── config/
│   │   └── ipmi-credentials.json  # 扫描验证用默认凭据模板
│   └── modules/               # 业务逻辑模块（不生成 HTML）
│       ├── configStore.js     # 配置读写 (71行)
│       ├── commandRunner.js   # 命令执行封装 (71行)
│       ├── favorites.js       # 收藏夹 (241行)
│       ├── modal.js           # 模态对话框 (80行)
│       ├── networkScanner.js  # 网络扫描 (574行)
│       ├── templates.js       # 服务器模板 (71行)
│       └── utils.js           # 工具函数 (66行)
│
├── bin/                       # ipmitool 文件 (打包时复制)
│   ├── ipmitool.exe
│   ├── cygwin1.dll
│   ├── cygcrypto-1.0.0.dll
│   └── cygz.dll
│
├── __tests__/                 # 单元测试 (13 套件, 275 用例)
├── assets/
│   └── icon.ico               # 应用图标
└── dist/                      # 构建产物 (win-unpacked + 安装包)
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
│  • SOL 终端管理 (node-pty, 多标签)                                │
│  • 文件对话框 (dialog)                                           │
│  • IPC 通信处理                                                  │
├─────────────────────────────────────────────────────────────────┤
│                        IPC 通道                                  │
│  config:get/save, ipmi:execute, sol:start/stop/write/deactivate │
│  file:save, dialog:selectDirectory/File, app:getMemory          │
├─────────────────────────────────────────────────────────────────┤
│                      渲染进程 (renderer.js)                      │
├─────────────────────────────────────────────────────────────────┤
│  • UI 状态管理                                                   │
│  • 服务器管理 (CRUD/批量删除)                                    │
│  • SOL 多标签终端 (xterm.js)                                     │
│  • 网络扫描 UI                                                   │
│  • 内存监控                                                      │
│  • 键盘快捷键                                                    │
├─────────────────────────────────────────────────────────────────┤
│                   业务逻辑模块 (src/modules/)                     │
│  configStore / commandRunner / favorites / modal /               │
│  networkScanner / templates / utils                              │
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
| `getIpmiToolPath()` | 查找 ipmitool 路径 (5 级) | 20 |
| IPC: `config:get/save` | 配置读写（⚠️ 渲染进程未调用，死代码） | 10 |
| IPC: `ipmi:execute` | 执行 IPMI 命令 | 20 |
| IPC: `sol:start/stop/write/deactivate` | SOL 管理（多标签） | 90 |
| IPC: `app:getMemory` | 返回进程内存占用 | 9 |
| IPC: `file:save` | 文件保存对话框 | 15 |
| IPC: `dialog:select*` | 目录/文件选择 | 20 |

**依赖**: electron, node-pty, fs, path, child_process

### 3.2 渲染进程 (renderer.js)

| 模块 | 函数 | 职责 |
|------|------|------|
| **初始化** | `bindEvents()`, `bindKeyboardShortcuts()` | 事件绑定、快捷键 |
| **SOL 多标签** | `addSolTab()`, `switchSolTab()`, `closeSolTab()`, `startSol()`, `stopSol()`, `saveSolLog()` | 多标签终端管理 |
| **服务器管理** | `updateServerList()`, `openDialog()`, `saveServer()`, `deleteServer()`, `batchDeleteServer()` | CRUD + 批量删除 |
| **连接测试** | `testConnection()` | raw 6 1 连通性测试 |
| **导入导出** | `exportConfig()`, `importConfig()` | 配置导入导出 |
| **日志目录** | `getLogDir()`, `selectLogDir()` | 日志保存位置 |
| **网络扫描 UI** | `startScan()`, `stopScan()`, `renderScanResults()`, `addSelectedScanResults()`, `exportScanResults()` | 扫描交互 |
| **内存监控** | `initMemoryMonitor()`, `updateMemoryInfo()` | 每 5s 刷新内存显示 |

**依赖**: electron (ipcRenderer), xterm, @xterm/addon-fit, @xterm/addon-serialize

### 3.3 业务逻辑模块 (src/modules/)

| 文件 | 职责 | 测试覆盖 |
|------|------|----------|
| `configStore.js` | 配置读写 (fs 直接操作 %APPDATA%) | 100% |
| `commandRunner.js` | 命令执行封装 (executeCommand/Power/Sensor/Raw) | 100% |
| `favorites.js` | 收藏夹 CRUD/执行/排序 | 86.55% |
| `modal.js` | 自定义 alert/confirm 弹窗 | 67.74% |
| `networkScanner.js` | Ping/端口/HTTP 探测/IPMI 验证 | 84.74% |
| `templates.js` | 服务器模板填充 | 11.53% |
| `utils.js` | escapeHtml/showStatus/clearOutput/isValidIP | 41.66% |

### 3.4 样式 (style.css)

| 模块 | 行数 | 说明 |
|------|------|------|
| CSS 变量 | 80 | 设计系统 (颜色/间距/圆角/阴影) |
| 工具栏 | 30 | 顶部工具栏 |
| 选项卡 | 30 | Tab 切换 |
| 面板 | 20 | 内容面板 |
| 终端 | 15 | xterm.js 容器 + SOL 标签栏 |
| 输出区域 | 20 | 命令输出显示 |
| 按钮 | 60 | 各种按钮样式 |
| 对话框 | 80 | 模态框 |
| 表单 | 40 | 输入框/选择框 |
| 收藏夹 | 80 | 收藏列表 |
| 扫描结果 | 60 | 网络扫描结果列表 |
| 滚动条 | 15 | 自定义滚动条 |

---

## 四、数据流

### 4.1 配置数据

```
配置文件 (%APPDATA%/ipmi-gui/config.json)
    │
    ├── configStore.js loadConfig() → config 对象 (渲染进程内缓存)
    │       │
    │       ├── config.servers[]     服务器列表
    │       ├── config.settings{}    设置 (lastSaveDir)
    │       └── config.favorites[]   收藏夹
    │
    └── saveConfig() ← 修改后写回
```

> ⚠️ main.js 也有一套 loadConfig/saveConfig（走 app.getPath('userData')，路径相同），
> 但渲染进程只通过 configStore.js 读写，`config:get`/`config:save` IPC 从未被调用。
> 新增配置字段需同步两边默认结构。

### 4.2 命令执行流程

```
用户点击按钮
    │
    ├── renderer.js: executeCommand() / commandRunner.js
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

### 4.3 SOL 终端流程 (多标签)

```
用户点击"启动 SOL"
    │
    ├── renderer.js: startSol() → addSolTab(server) 创建标签
    │       │
    │       └── ipcRenderer.invoke('sol:start', server, tabId)
    │
    └── main.js: ipcMain.handle('sol:start')
            │
            ├── pty.spawn()           创建伪终端
            ├── ptyProcesses[tabId]   按 tabId 存储
            ├── proc.onData()         转发输出
            └── proc.onExit()         清理并通知
                    │
                    └── mainWindow.webContents.send('sol:data', {tabId, data})
                            │
                            └── renderer.js: terminal.write(data)
```

### 4.4 网络扫描流程

```
用户点击"开始扫描"
    │
    └── networkScanner.js: fullScan(subnet)
            │
            ├── 第一步: Ping 扫描 (并发 50, 254 个 IP)
            │       └── pingHost() → 在线 IP 列表
            ├── 第二步: 端口扫描 (并发 20)
            │       └── UDP:623 + TCP:623/80/443 → HTTP 产品探测
            │       └── 过滤: 无 TCP:623 且无 TCP:443 → 丢弃
            ├── 第三步: IPMI 验证 (并发 5)
            │       └── verifyIPMITemplate() 尝试 3 组默认凭据
            │       └── 通过 → 标记 template + verified
            └── 返回结果 → renderScanResults()
```

---

## 五、IPC 通信表

| 通道 | 方向 | 参数 | 返回 |
|------|------|------|------|
| `config:get` | 渲染→主 | - | config（⚠️ 未使用） |
| `config:save` | 渲染→主 | config | true（⚠️ 未使用） |
| `ipmi:execute` | 渲染→主 | server, command, args | {code, stdout, stderr} |
| `sol:start` | 渲染→主 | server, tabId | {success, pid/error} |
| `sol:stop` | 渲染→主 | server | {success, stderr} |
| `sol:deactivate` | 渲染→主 | server | {success, stderr}（⚠️ 与 sol:stop 重复） |
| `sol:write` | 渲染→主 | tabId, data | - |
| `sol:data` | 主→渲染 | {tabId, data} | - |
| `sol:exit` | 主→渲染 | {tabId, exitCode} | - |
| `file:save` | 渲染→主 | defaultName, content | {success, path} |
| `dialog:selectDirectory` | 渲染→主 | - | path/null |
| `dialog:selectFile` | 渲染→主 | filters | path/null |
| `app:getMemory` | 渲染→主 | - | {rss, heapUsed, heapTotal, external} |

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
      "privilegeLevel": "ADMINISTRATOR"
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
│    ├── @xterm/addon-serialize (内容序列化)                   │
│    └── src/modules/* (业务逻辑)                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 八、代码统计

| 文件 | 行数 | 说明 |
|------|------|------|
| main.js | 307 | 主进程 |
| renderer.js | 1056 | 渲染进程 (核心) |
| index.html | 295 | 界面结构 |
| style.css | 1119 | 样式 |
| preload.js | 23 | 预加载 (未使用) |
| src/modules/*.js (7 个) | 1174 | 业务逻辑模块 |
| **总计** | **3974** | |

| 测试文件 | 用例数 |
|----------|--------|
| 13 个 *.test.js | 275 |

覆盖率详见 `test_report.md`：语句 77.83% / 行 81.07%（Jest 30）。

---

## 九、已知问题与技术债务

| 问题 | 说明 | 优先级 |
|------|------|--------|
| renderer.js 仍然较大 | 1056 行，已部分拆分到 modules/，可继续拆 | 中 |
| 配置读写双重逻辑 | main.js 与 configStore.js 各有读写，config IPC 是死代码 | 中 |
| sol:stop / sol:deactivate 重复 | 两个 IPC handler 功能完全相同 | 低 |
| 无 TypeScript | 类型安全缺失 | 中 |
| 密码明文存储 | 配置文件中密码未加密 | 高 |
| 原始命令参数拼接 | ipmi:execute 用 command.split(' ') 拼参，含引号/空格无法传递 | 中 |
| Jest 30 弃用警告 | getElementById soft-deleted 警告，未来版本会 hard fail | 中 |
| 凭据模板多处重复 | templates.js / ipmi-credentials.json / 两处 fallback 数组 | 低 |
| 无错误边界 | 未捕获的异常可能导致崩溃 | 低 |

---

*文档版本: v1.1*
*更新时间: 2026-07-21*
