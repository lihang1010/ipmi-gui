# IPMI 管理工具 - 代码架构

## 一、项目结构

```
ipmi-gui-electron/
├── main.js                    # Electron 主进程
├── package.json               # 项目配置
├── electron-builder.yml       # electron-builder 配置
├── build.ps1 / build.bat      # 构建脚本
│
├── src/
│   ├── index.html             # 主界面 HTML
│   ├── renderer.js            # 渲染进程脚本 ⭐核心
│   ├── style.css              # 样式文件
│   ├── config/
│   │   └── ipmi-credentials.json  # 默认凭据唯一来源
│   └── modules/               # 业务逻辑模块（不生成 HTML）
│       ├── configStore.js     # 配置读写（唯一实现）
│       ├── ipmiTool.js        # 路径解析 / 参数构建 / 命令行分词（主+渲染共用）
│       ├── credentials.js     # 凭据模板读取
│       ├── bmcVersion.js      # mc info 版本号解析
│       ├── commandRunner.js   # 命令执行封装
│       ├── favorites.js       # 收藏夹
│       ├── fru.js             # FRU 镜像解析 / 命令构建 / 结果判定（纯函数）
│       ├── fruView.js         # FRU 面板渲染与写入编排（写入→重新读取校验）
│       ├── modal.js           # 模态对话框
│       ├── networkScanner.js  # 网络扫描
│       ├── scanResultView.js  # 扫描结果行渲染（纯函数）
│       ├── templates.js       # 服务器模板（凭据来自 credentials.js）
│       └── utils.js           # 工具函数
│
├── bin/                       # ipmitool 文件 (打包时复制)
│   ├── ipmitool.exe
│   ├── cygwin1.dll
│   ├── cygcrypto-1.0.0.dll
│   └── cygz.dll
│
├── __tests__/                 # 单元测试 (21 套件)
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
│  • ipmitool 命令执行 (child_process)                             │
│  • SOL 终端管理 (node-pty, 多标签)                                │
│  • 文件对话框 (dialog)                                           │
│  • IPC 通信处理                                                  │
├─────────────────────────────────────────────────────────────────┤
│                        IPC 通道                                  │
│  ipmi:execute, sol:start/stop/close/write, sol:data/exit        │
│  file:save, dialog:selectDirectory/File, app:getMemory          │
├─────────────────────────────────────────────────────────────────┤
│                      渲染进程 (renderer.js)                      │
├─────────────────────────────────────────────────────────────────┤
│  • UI 状态管理                                                   │
│  • 服务器管理 (CRUD/批量删除)                                    │
│  • SOL 多标签终端 (xterm.js)                                     │
│  • 网络扫描 UI                                                   │
│  • 配置读写 (configStore.js)                                     │
│  • 内存监控                                                      │
│  • 键盘快捷键                                                    │
├─────────────────────────────────────────────────────────────────┤
│                   业务逻辑模块 (src/modules/)                     │
│  configStore / ipmiTool / credentials / commandRunner /          │
│  favorites / fru / fruView / modal / networkScanner /            │
│  scanResultView / templates / utils                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## 三、模块职责

### 3.1 主进程 (main.js)

| 函数 | 职责 | 行数 |
|------|------|------|
| `createWindow()` | 创建主窗口（尺寸按屏幕工作区自适应） | 20 |
| `getIpmiToolPath()` | 委托 `ipmiTool.resolveIpmiToolPath()`，缺失返回 null | 3 |
| `deactivateSolSession()` | 执行 sol deactivate（sol:stop / sol:close 复用） | 26 |
| IPC: `ipmi:execute` | 执行 IPMI 命令（参数经 tokenizeCommand 分词） | 30 |
| IPC: `sol:start/stop/close/write` | SOL 管理（多标签 + PTY 回收） | 55 |
| IPC: `app:getMemory` | 返回进程内存占用 | 9 |
| IPC: `file:save` | 文件保存对话框 | 15 |
| IPC: `dialog:select*` | 目录/文件选择 | 20 |

**说明**: 主进程不读写配置（统一由渲染进程 `configStore.js` 负责）。

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
| `configStore.js` | 配置读写 (fs 直接操作 %APPDATA%，唯一实现) | 见 test_report.md |
| `ipmiTool.js` | 路径解析 / 参数构建 / 命令行分词 | 新增 |
| `credentials.js` | 凭据模板读取（ipmi-credentials.json 唯一入口） | 见 test_report.md |
| `bmcVersion.js` | mc info 版本号解析（按厂商取 Aux 字节） | 见 test_report.md |
| `commandRunner.js` | 命令执行封装 (executeCommand/Power/Sensor/Raw) | 见 test_report.md |
| `favorites.js` | 收藏夹 CRUD/执行/排序 | 见 test_report.md |
| `fru.js` | FRU 镜像与 `fru print` 解析 / index 映射 / 命令构建 / 结果判定 | 见 fru.test.js |
| `theme.js` | 主题名归一化 / 一键切换 / 显示名 / 终端配色（纯函数） | 见 theme.test.js |
| `updateStatus.js` | 自动更新状态的文案 / 可点击性 / 可见性映射（纯函数） | 见 updateStatus.test.js |
| `fruView.js` | FRU 字段表渲染 + 写入→重新读取校验编排 | 见 fruView.test.js |
| `modal.js` | 自定义 alert/confirm 弹窗 | 见 test_report.md |
| `networkScanner.js` | Ping/端口/HTTP 探测/IPMI 验证/CIDR 展开 | 见 test_report.md |
| `scanResultView.js` | 扫描结果行渲染（转义 + 事件委托） | 新增 |
| `templates.js` | 服务器模板填充 | 见 test_report.md |
| `utils.js` | escapeHtml/showStatus/clearOutput/isValidIP | 见 test_report.md |

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

> 配置只有一处实现：渲染进程 `src/modules/configStore.js`。
> 主进程不再读写配置，也不提供 config 相关 IPC。

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
            ├── resolveIpmiToolPath()  获取路径（缺失则返回明确错误）
            ├── buildArgs(server)      构建连接参数
            ├── tokenizeCommand(cmd)   分词（支持引号）
            └── child_process.spawn()  执行命令
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
    ├── renderer.js: 校验网段 + 大网段耗时确认（超过 1024 个地址先弹框）
    │
    ├── main.js: cidrToHosts(network, cidr) → 主机列表 (/16~/30，按 32 位整数对齐)
    │
    └── networkScanner.js: fullScan(network, { hosts })
            │
            ├── 第一步: Ping 扫描 (并发 40，每台发 2 个包；
            │       耗时瓶颈是不存在地址的 ARP 等待约 2~3s，只能靠并发压缩批次)
            │       └── pingHost() → 在线 IP 列表 (Windows -w 为毫秒)
            ├── 第二步: 端口扫描 (并发 20)
            │       └── UDP:623 (ASF Presence Ping) + TCP:623/80/443 → HTTP 产品探测
            │       └── 过滤: 无 TCP:623 且无 TCP:443 → 丢弃
            ├── 第三步: IPMI 验证 (并发 5)
            │       └── verifyIPMITemplate() 逐条尝试 credentials.js 提供的凭据
            │       └── 通过 → 标记 template + verified
            │       └── 再执行 mc info → bmcVersion.js 生成版本号
            └── 返回结果 → renderScanResults() → scanResultView.js 渲染行
```

### 4.5 FRU 字段读取与编辑

```
[刷新 / 读取] → fruView.load() 分两阶段
    │
    ├── fru list                         → fru.parseFruList()   → 顶部下拉选择 FRU 设备
    │
    ├── 1) -v fru print <id>   (~0.4s)   → fru.parseFruPrint()  → 字段表立即可见，编辑锁定
    │        └── -v 必须写在 fru 之前；`fru print -v <id>` 会静默无输出
    │
    └── 2) fru read <id> <file> (~1.2s)  → fru.parseFruImage()  → 权威序号，解锁编辑
             └── index 与 ipmitool 内部字段序完全一致
                 （print 会整行跳过空字段，不能按行号数序号）

[编辑某字段] → fruView.planEdit()
    ├── 1) fru edit <id> field <c|b|p> <index>    点「写入」立即下发，新值走 argv
    └── 2) 重新 fru read → verifyFieldValue() 比对字段值
             └── 同时校验 ipmitool 报告的旧值与预期一致（防止改错字段）

[刷写整区] → fruView.flashFru() → selectFile → validateFlashImage → diffImages → 确认框
    │     └── 大小不等 / 非合法 FRU / 校验和错 → 直接拒绝，不下发
    └── fruView.confirmFlash()
         ├── 1) fru read  → 写前自动备份（独立文件名，避免被回读覆盖）
         ├── 2) fru write <id> <file> → parseWriteResult
         │        └── 退出码恒为 0，只看 Size to Write 是否等于 Fru Size
         └── 3) fru read → compareImages 逐字节比对
                  └── 唯一可靠的成败判据（字段级比对会漏掉 padding / 校验和）
```

> `fru edit` **成功时退出码为 1**，判定一律依赖输出解析；契约细节见
> `AGENTS.md` 的「FRU 读取与字段编辑」章节。
> 点「写入」直接生效（无二次确认），因此按钮以「新值合法且与原值不同」为启用条件；
> 不做写前自动备份，需要留存原始数据时由用户点「导出备份」自行保存。

---

## 五、IPC 通信表

| 通道 | 方向 | 参数 | 返回 |
|------|------|------|------|
| `ipmi:execute` | 渲染→主 | server, command, args | {code, stdout, stderr} |
| `sol:start` | 渲染→主 | server, tabId | {success, pid/error} |
| `sol:stop` | 渲染→主 | server | {success, stderr} |
| `sol:close` | 渲染→主 | tabId, server | {success, stderr/warning} |
| `sol:write` | 渲染→主 | tabId, data | - |
| `sol:data` | 主→渲染 | {tabId, data} | - |
| `sol:exit` | 主→渲染 | {tabId, exitCode} | - |
| `file:save` | 渲染→主 | defaultName, content | {success, path} |
| `dialog:selectDirectory` | 渲染→主 | - | path/null |
| `dialog:selectFile` | 渲染→主 | filters | path/null |
| `app:getMemory` | 渲染→主 | - | {rss, heapUsed, heapTotal, external} |

> `sol:stop` 释放远端会话；`sol:close` 额外回收本地 PTY（关闭标签时使用）。

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
| main.js | 298 | 主进程 |
| renderer.js | 1091 | 渲染进程 (核心) |
| index.html | 355 | 界面结构 |
| style.css | 1490 | 样式 |
| src/modules/*.js (13 个) | 3257 | 业务逻辑模块 |
| **总计** | **6193** | |

| 测试文件 | 用例数 |
|----------|--------|
| 21 个 *.test.js | 563 |

覆盖率详见 `test_report.md`（Jest 30）。

---

## 九、已知问题与技术债务

| 问题 | 说明 | 优先级 |
|------|------|--------|
| renderer.js 仍然较大 | 1041 行，已部分拆分到 modules/，可继续拆 | 中 |
| 无 TypeScript | 类型安全缺失 | 中 |
| 密码明文存储 | 配置文件中密码未加密（可考虑 safeStorage） | 高 |
| 扫描仍在渲染进程 | child_process/dgram/net 在渲染层执行，应移入主进程 | 中 |
| 渲染层仍用 nodeIntegration | contextIsolation 关闭 + CSP 含 unsafe-inline/eval | 高 |
| 无错误边界 | 未捕获异常可能导致崩溃 | 低 |

### 已修复（v1.2）

- 扫描结果未转义 → `scanResultView.js` 统一转义 + 事件委托（原 XSS/RCE 通道）
- SOL 标签关闭后 PTY 泄漏 → 新增 `sol:close`
- `sol:stop` 与 `sol:deactivate` 重复 → 合并为 `deactivateSolSession`
- 配置读写双重逻辑 + `config:*` 死 IPC → 统一由 `configStore.js` 负责
- 凭据模板 5 处重复 → `credentials.js` 单一来源
- `ipmi:execute` 用 `split(' ')` 拼参 → `tokenizeCommand` 支持引号
- 打包后扫描器找不到 ipmitool → 统一 `resolveIpmiToolPath()`
- 扫描 CIDR 输入无效、Windows ping 超时恒为 1 秒、UDP 探测误判为开放
- ipmitool 调用用 shell 拼字符串 → 统一 `runIpmiCommand()`（execFile 逐参数传参）
- 提示框向上弹出被窗口/面板裁切 → 统一向下弹出 + 左右对齐修饰
- 窄窗口工具栏换行、状态徽标溢出 → 宽度压缩 + 省略号截断
- 默认窗口写死 1000×700 而顶栏自然宽度实测 1037px（最坏 1228px）→ 最右侧状态徽标
  被压得只剩一条边。改为按屏幕工作区自适应（`src/modules/windowSize.js`，纯函数可单测）；
  窗口被手动拉窄时顶栏右侧整组换行，不再被挤出可视区

### 新增（v1.3）

- FRU 面板由「只读文本」升级为「结构化字段表 + 字段级编辑」：
  - `fru.js` 解析 `fru read` 二进制镜像（不用 `fru print` 文本，避免 FRU ID 行省略导致 index 错位）
  - `fruView.js` 编排「`fru edit` 写入 → 重新读取校验」，点「写入」直接生效（无二次确认、不做写前自动备份）
  - 新值经 IPC argv 传递；`fru edit` 成功退出码为 1，改为解析输出判定
  - 可编辑范围：Chassis / Board / Product 的 8-bit ASCII 字段（index 0-9、非空、≤63 字节）
  - 不提供 Internal Use、整区 `fru write` 覆盖与 `fru upgEkey`（回滚走「原始命令」面板）

---

*文档版本: v1.2*
*更新时间: 2026-09-28*
