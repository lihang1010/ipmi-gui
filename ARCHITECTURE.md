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
│       ├── windowSize.js      # 主窗口初始尺寸（按屏幕工作区自适应）
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
│       ├── scanLog.js         # 扫描判定链路日志（纯函数 + 收集器）
│       ├── scanFilter.js      # 扫描结果搜索/筛选/排序（纯函数）
│       ├── findBar.js         # 页面查找（Ctrl+F）的纯逻辑：查询/计数/快捷键
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
│  ipmi:execute                                                   │
│  sol:start/stop/close/write/resize, sol:data/exit, sol:log-*    │
│  scan:getLocalNetwork/start/stop, scan:progress                 │
│  file:save, dialog:select*, app:getMemory/getVersion            │
│  update:getStatus/check/install, update:status                  │
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

| 函数 / IPC | 职责 | 约行数 |
|------|------|------|
| `createWindow()` | 创建主窗口（尺寸按屏幕工作区自适应） | 19 |
| `getIpmiToolPath()` | 委托 `ipmiTool.resolveIpmiToolPath()`，缺失返回 null | 3 |
| IPC: `ipmi:execute` | 执行 IPMI 命令（参数经 tokenizeCommand 分词） | 30 |
| IPC: `sol:start` | pty.spawn 启动选中的 SOL（按 tabId 存储） | 39 |
| IPC: `sol:write` / `sol:resize` | 写入按键 / 同步 PTY 尺寸 | 15 |
| `deactivateSolSession()` | 执行 sol deactivate（sol:stop / sol:close 复用） | 26 |
| IPC: `sol:stop` / `sol:close` | 释放远端会话 / 强制回收本地 PTY | 16 |
| IPC: `sol:log-open/write/close` | SOL 日志追加写流（每标签一个） | 34 |
| IPC: `scan:getLocalNetwork/start/stop` | 网络扫描（进度经 `scan:progress` 推送） | 41 |
| IPC: `file:save` | 文件保存对话框 | 15 |
| IPC: `dialog:select*` | 目录/文件选择 | 23 |
| IPC: `app:getMemory` / `app:getVersion` | 内存占用 / 当前版本 | 12 |
| `setupAutoUpdater()` + `update:*` | electron-updater 接线与状态推送 | 76 |
| 单实例锁 / 生命周期 | `requestSingleInstanceLock`、退出时回收 PTY | 35 |

**说明**: 主进程不读写配置（统一由渲染进程 `configStore.js` 负责）。

**依赖**: electron, electron-updater, node-pty, fs, path, child_process

### 3.2 渲染进程 (renderer.js)

| 模块 | 函数 | 职责 |
|------|------|------|
| **初始化** | `init()`, `bindEvents()`, `bindKeyboardShortcuts()` | 加载配置、事件绑定、快捷键 |
| **SOL 多标签** | `createTerminal()`, `addSolTab()`, `renderSolTabs()`, `switchSolTab()`, `closeSolTab()` | 多标签终端创建与切换 |
| **SOL 平铺** | `applySolLayout()`, `toggleSolLayout()`, `getSolLayout()`, `updateSolButtons()` | 平铺 / 单屏切换（`settings.solLayout`） |
| **SOL 运行** | `startSol()`, `stopSol()`, `updateSolTabStatus()` | 启动 / 停止会话、标签状态点 |
| **SOL 日志** | `startSolLog()`, `stopSolLog()`, `saveSolLog()`, `buildSolLogName()`, `applyAutoSaveToRunningTabs()` | 自动保存 + 手动导出 |
| **服务器管理** | `updateServerList()`, `openDialog()`, `saveServer()`, `deleteServer()`, `batchDeleteServer()` | CRUD + 批量删除 |
| **连接测试** | `testConnection()` | raw 6 1 连通性测试 |
| **导入导出** | `exportConfig()`, `importConfig()` | 配置导入导出 |
| **日志目录** | `getLogDir()`, `selectLogDir()`, `updateLogDirDisplay()` | 日志保存位置 |
| **网络扫描 UI** | `initScan()`, `startScan()`, `stopScan()`, `updateScanProgress()`, `addSelectedScanResults()`, `exportScanResults()` | 扫描交互与进度 |
| **结果视图** | `renderScanView()`, `renderScanResults()`, `buildScanEmptyHtml()`, `updateScanSortIndicators()`, `updateScanViewCount()`, `toggleScanCheckAll()` | 搜索 / 筛选 / 排序 / 全选（数据与视图分离） |
| **扫描日志** | `toggleScanLogPanel()`, `appendScanLog()`, `renderScanLog()`, `buildScanLogLine()`, `copyScanLog()`, `exportScanLog()` | 判定链路日志面板（渲染走 textContent） |
| **主题** | `applyTheme()`, `toggleTheme()`, `updateThemeButton()` | 写 `data-theme` + 同步已开终端配色 |
| **更新徽标** | `renderVersionBadge()`, `renderUpdateBadge()`, `handleVersionClick()`, `handleUpdateClick()` | 版本号 / 更新状态展示（`updateStatus.js` 提供文案） |
| **页面查找** | `initFindBar()`, `openFindBar()`, `closeFindBar()`, `runFind()`, `stepFind()`, `collectPanelRanges()`, `applyFindHighlights()`, `clearFindHighlights()`, `scrollActiveMatchIntoView()`, `scheduleRefind()`, `renderFindCount()`, `updateFindHint()`, `mutationTouchesActivePanel()` | Ctrl+F 查找栏（面板内 Range + CSS Custom Highlight，刷新后重算） |
| **面板刷新** | `refreshCurrentPanel()`, `clearCurrentPanel()` | Ctrl+R / Ctrl+L 的落地实现 |
| **内存监控** | `initMemoryMonitor()`, `updateMemoryInfo()` | 每 5s 刷新内存显示 |

**依赖**: electron (ipcRenderer), xterm, @xterm/addon-fit, @xterm/addon-serialize

### 3.3 业务逻辑模块 (src/modules/)

| 文件 | 职责 | 测试覆盖 |
|------|------|----------|
| `configStore.js` | 配置读写 (fs 直接操作 %APPDATA%，唯一实现) | configStore.test.js |
| `ipmiTool.js` | 路径解析 / 参数构建 / 命令行分词 | ipmiTool.test.js |
| `credentials.js` | 凭据模板读取（ipmi-credentials.json 唯一入口） | credentials.test.js |
| `bmcVersion.js` | mc info 版本号解析（按厂商取 Aux 字节） | bmcVersion.test.js |
| `commandRunner.js` | 命令执行封装 (executeCommand/Power/Sensor/Raw) | commandRunner.test.js |
| `favorites.js` | 收藏夹 CRUD/执行/排序/导入导出 | favorites.test.js |
| `fru.js` | FRU 镜像与 `fru print` 解析 / index 映射 / 命令构建 / 结果判定 | fru.test.js |
| `fruView.js` | FRU 字段表渲染 + 写入→重新读取校验 / 整区刷写编排 | fruView.test.js |
| `theme.js` | 主题名归一化 / 一键切换 / 显示名 / 终端配色（纯函数） | theme.test.js |
| `updateStatus.js` | 自动更新状态的文案 / 可点击性 / 可见性映射（纯函数） | updateStatus.test.js |
| `windowSize.js` | 主窗口初始尺寸（按屏幕工作区计算，纯函数） | main.test.js |
| `modal.js` | 自定义 alert/confirm 弹窗 | modal.test.js |
| `networkScanner.js` | Ping/端口/HTTP 探测/IPMI 验证/CIDR 展开 | networkScanner.test.js |
| `scanResultView.js` | 扫描结果行渲染（转义 + 事件委托） | scanResultView.test.js |
| `scanLog.js` | 扫描判定链路日志：格式化 / 裁剪 / 过滤 / 统计（纯函数 + 收集器） | scanLog.test.js |
| `scanFilter.js` | 扫描结果搜索 / 快捷筛选 / 排序（IP 数值序、版本段比较、缺失值置底） | scanFilter.test.js |
| `findBar.js` | 页面查找纯逻辑：查询归一化 / 字面量匹配区间 / 计数文案 / 快捷键 / 选中文本 | findBar.test.js |
| `templates.js` | 服务器模板填充 | templates.test.js |
| `utils.js` | escapeHtml/showStatus/clearOutput/isValidIP | utils.test.js |

### 3.4 样式 (style.css, 2293 行)

| 模块 | 说明 |
|------|------|
| CSS 变量 | 60+ token：颜色 / 间距 / 圆角 / 阴影 / 语义色（`--tint-*` 双主题反向） |
| 主题覆盖 | `:root[data-theme='light']` 覆盖颜色类 token；`--select-arrow` 各给一份 |
| 工具栏 / 选项卡 / 面板 | 顶栏（含版本徽标、更新徽标、主题按钮）、tab 切换、面板过渡 |
| SOL 终端 | xterm 容器 + 标签栏 + 平铺网格布局 |
| 按钮 / 表单 / 对话框 | 四态（hover / active / loading / disabled）、模态框、确认框 |
| 收藏夹 / 扫描结果 / FRU 字段表 | 各面板专用列表与表格样式 |
| 滚动条 / 提示框 | 自定义滚动条、`user-select: text` 的数据区 |

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
    ├── renderer.js: executeCommand(command, outputId, server, args)
    │       │        ├── 先占位「执行中...」并将输出区 opacity 置 0.5
    │       │        └── 结果经 utils.formatCommandOutput() 统一格式化
    │       └── ipcRenderer.invoke('ipmi:execute', server, command, args)
    │
    └── main.js: ipcMain.handle('ipmi:execute')
            │
            ├── resolveIpmiToolPath()  获取路径（缺失则返回明确错误）
            ├── buildArgs(server)      构建连接参数
            ├── tokenizeCommand(cmd)   分词（支持引号）
            ├── ...args                附加 argv 原样拼在末尾（含空格/引号的值走这里）
            └── child_process.spawn()
                    │
                    └── 返回 { code, stdout, stderr }
```

### 4.3 SOL 终端流程 (多标签)

```
用户点击"启动 SOL"
    │
    ├── renderer.js: startSol() → addSolTab(server) 创建标签与终端
    │       │        ├── 若开启「自动保存」→ startSolLog(tab)
    │       │        └── 若当前为「平铺」→ applySolLayout() 重算各终端尺寸
    │       └── ipcRenderer.invoke('sol:start', server, tabId)
    │
    └── main.js: ipcMain.handle('sol:start')
            │
            ├── pty.spawn()           创建伪终端（cwd 指向 ipmitool 所在目录）
            ├── ptyProcesses[tabId]   按 tabId 存储
            ├── proc.onData()         转发输出
            └── proc.onExit()         清理并通知
                    │
                    └── mainWindow.webContents.send('sol:data', {tabId, data})
                            │
                            └── renderer.js: terminal.write(data)
                                    └── 若该标签有日志流 → sol:log-write 追加同一份数据

[键盘输入] renderer terminal.onData → sol:write(tabId, data) → proc.write
[容器尺寸变化] ResizeObserver → fitAddon.fit() → sol:resize(tabId, cols, rows) → proc.resize

[停止 / 关闭标签]
    ├── sol:stop(server)        → sol deactivate 释放远端会话（本地 PTY 保留）
    └── sol:close(tabId, server)→ 先 proc.kill() 回收本地 PTY，再 deactivate 远端
```

### 4.4 网络扫描流程

```
用户点击"开始扫描"
    │
    ├── renderer.js: startScan()
    │       ├── 校验网段 + 大网段耗时确认（超过 1024 个地址先弹框）
    │       └── ipcRenderer.invoke('scan:start', { network, cidr, timeout, usePing, detailLog })
    │               ├── 监听 scan:progress 更新进度条
    │               └── 监听 scan:log 逐条追加日志（上限由 scanLog.js 控制）
    │
    └── main.js: ipcMain.handle('scan:start')
            │   注意：扫描涉及 child_process / dgram / net / http，
            │   全部在主进程执行，渲染层只负责展示与进度
            │
            ├── cidrToHosts(network, cidr) → 主机列表 (/16~/30，按 32 位整数对齐)
            │
            └── networkScanner.fullScan(network, { hosts, label, detailLog, onLog, ... })
                    │
                    ├── 日志打点 log(level, ip, message)：time 用相对扫描开始的毫秒数
                    │
                    ├── 第一步: Ping 预探测（**默认关闭** usePing=false）
                    │       开启时并发 40、每台 2 个包；耗时瓶颈是不存在地址的 ARP 等待
                    │       （约 2~3s，-w 管不到），只能靠并发压缩批次
                    │       └── pingHost() → 在线 IP 列表 (Windows -w 为毫秒)
                    ├── 第二步: 端口扫描 (并发 20)
                    │       └── UDP:623 (ASF Presence Ping) + TCP:623/80/443 → HTTP 产品探测
                    │       └── 准入: 有 UDP:623 或 TCP:623 或 TCP:443 → 进入验证；
                    │               只有 Web(80) 的按普通 HTTP 服务跳过（并记 warn 日志）
                    │       !! UDP:623 是 IPMI over LAN 的正主端口，旧规则只认 TCP 会漏报；
                    │          但 ASF presence ping 假阴性高（实测有设备完全不响应却能用
                    │          lanplus），所以两者是「或」，不能互相替代
                    ├── 第三步: IPMI 验证 (并发 5，单次 1500ms)
                    │       └── verifyIPMITemplate() 逐条尝试 credentials.js 提供的凭据，
                    │           每次尝试经 onAttempt 回报（详细日志下逐模板记一行）
                    │       └── 通过 → 标记 template + verified，再 **并行**执行
                    │           mc info（→ bmcVersion.js 版本号）
                    │           power status（→ parsePowerState() 得 on/off）
                    │       └── 失败 → verifyHint + 最后一次失败原因写入日志
                    └── 返回结果 → renderScanResults() 存入 scanResults（原始数据，全量保留）
                            └── renderScanView() → scanFilter.applyScanView(scanResults, scanView)
                                    ├── 过滤：关键词（IP/架构/版本/产品）+ 快速筛选（全部/未添加/已开机/已关机/验证失败）+ 隐藏已添加
                                    ├── 排序：IP 数值序 / 延迟 / 端口数 / 架构 / 版本段 / 电源 / 产品
                                    │   缺失值（无版本、电源未知）恒排末尾
                                    └── scanResultView.js 渲染行
                                        └── 电源状态列：on 绿 / off 中性 / 取不到留空
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

### 4.6 SOL 日志自动保存

```
[勾选「自动保存」] settings.autoSaveSol = true
    ├── 立即对已打开的会话生效（applyAutoSaveToRunningTabs）
    └── 之后每次 startSol 都自动开流

[启动会话] renderer.startSolLog(tab)
    ├── buildSolLogName(server, tabId)  生成 %日志目录%/sol-<host>-<时间>.log
    └── ipcRenderer.invoke('sol:log-open', tabId, filePath)
            └── main.js: fs.createWriteStream(filePath, { flags: 'a' })

[收到输出] sol:data → renderer 写终端 → 同时 sol:log-write(tabId, data)
                                   └── 主进程把 PTY 原始流（含 ANSI）追加进该标签的流

[结束会话 / 关标签 / 关闭自动保存] sol:log-close(tabId) → stream.end()
```

刻意**不复用** `file:save`：那是「弹保存框 + 全量覆盖」，逐帧追加会反复弹框并互相覆盖。
写失败（磁盘满 / 权限）只放弃该标签的录制，不打断 SOL 会话。

### 4.7 自动更新

```
app.whenReady() → setupAutoUpdater()
    ├── !app.isPackaged → 状态 skipped（开发模式不检查）
    └── 延迟 5s → autoUpdater.checkForUpdates()
            ├── checking-for-update → { state: 'checking' }
            ├── update-available    → { state: 'available', version } → 自动后台下载
            ├── download-progress   → { state: 'downloading', percent }
            ├── update-downloaded   → { state: 'ready', version } → 顶栏提示「重启更新到 vX」
            ├── update-not-available→ { state: 'none' }
            └── error               → { state: 'error', error }（不阻塞启动）

[用户点击顶栏徽标] update:install → quitAndInstall(false, true)
```

状态归一化在主进程，文案在 `src/modules/updateStatus.js` 的 `describeUpdate()`（纯函数）。
**不自动重启**：SOL 会话与正在执行的命令经不起中断。

### 4.8 页面查找（Ctrl+F）

```
[Ctrl+F / Cmd+F / 传感器「查找」按钮]
    │
    └── renderer.js: openFindBar()
            ├── 有选中文本 → findBar.pickSelection() 带入（多行只取第一行）
            ├── findBar.isFindShortcut(e) 命中后 preventDefault
            └── 输入即搜索 → runFind()

[runFind] 只在当前激活面板里收集命中（查找栏在 body 下，天然被排除）
    ├── collectPanelRanges(panel, query)
    │       ├── TreeWalker + NodeFilter.SHOW_TEXT
    │       ├── 跳过 SCRIPT / STYLE / TEXTAREA 与 display:none（getClientRects 为空）
    │       └── findBar.findSubstringRanges() → 字面量、大小写不敏感、不重叠
    ├── applyFindHighlights()  CSS.highlights.set('find-match' / 'find-active', Highlight(...))
    ├── scrollActiveMatchIntoView()  最近的 overflow-y 容器，最小滚动
    └── renderFindCount() → findBar.formatFindCount() → 「1/3」/「无结果」

[Enter / Shift+Enter / ‹ ›] stepFind(±1) → findIndex 取模回绕 → 重涂高亮 + 滚动

[输出区被重写]（传感器刷新 / SEL 刷新 / 切服务器 / 切面板）
    └── MutationObserver(.main) → mutationTouchesActivePanel(records)
            └── scheduleRefind() 250ms 防抖 → runFind()

[Esc / ×] closeFindBar() → clearFindHighlights()（删掉两个 Highlight）
```

**不用 `webContents.findInPage`**：它按整页查找，会把查找框自己的文字算进命中并一起高亮
（输入 `CPU` 会多 1 个"命中"），`matches` 虚高、Enter 的"下一个"还会停在输入框上，
表现为"按 Enter 没反应"。改为面板内收集 Range + 下标推进，行为完全确定。
**不用 `<mark>`**：输出区是纯文本 `pre`，插节点会破坏换行与行结构；Custom Highlight
只着色不改 DOM（Chromium 105+，Electron 28 为 120）。
**观察范围限定在当前激活面板**：否则顶栏内存徽标每几秒的更新都会把命中重置回第一个。
**SOL 终端**正文在 canvas 里，不参与 DOM 查找，面板激活时查找栏显示明确提示。

---

## 五、IPC 通信表

| 通道 | 方向 | 参数 | 返回 |
|------|------|------|------|
| `ipmi:execute` | 渲染→主 | server, command, args | {code, stdout, stderr} |
| `sol:start` | 渲染→主 | server, tabId | {success, pid/error} |
| `sol:stop` | 渲染→主 | server | {success, stderr} |
| `sol:close` | 渲染→主 | tabId, server | {success, stderr/warning} |
| `sol:write` | 渲染→主 | tabId, data | - |
| `sol:resize` | 渲染→主 | tabId, cols, rows | - |
| `sol:data` | 主→渲染 | {tabId, data} | - |
| `sol:exit` | 主→渲染 | {tabId, exitCode} | - |
| `sol:log-open` | 渲染→主 | tabId, filePath | {success, path/error} |
| `sol:log-write` | 渲染→主 | tabId, data | - |
| `sol:log-close` | 渲染→主 | tabId | {success} |
| `scan:getLocalNetwork` | 渲染→主 | - | {ip, subnet, mask, interface} / null |
| `scan:start` | 渲染→主 | {network, cidr, timeout, usePing} | {success, results/error} |
| `scan:stop` | 渲染→主 | - | {success} |
| `scan:progress` | 主→渲染 | {phase, current, total, found} | - |
| `scan:log` | 主→渲染 | {time, level, ip, message} | - |
| `file:save` | 渲染→主 | defaultName, content, filters | {success, path} |
| `dialog:selectDirectory` | 渲染→主 | - | path/null |
| `dialog:selectFile` | 渲染→主 | filters | path/null |
| `app:getMemory` | 渲染→主 | - | {rss, heapUsed, heapTotal, external} |
| `app:getVersion` | 渲染→主 | - | string |
| `update:getStatus` | 渲染→主 | - | {state, version?, percent?, error?} |
| `update:check` | 渲染→主 | - | 同状态对象 |
| `update:install` | 渲染→主 | - | {ok, error?} |
| `update:status` | 主→渲染 | 状态对象 | - |

> `sol:stop` 只释放远端会话（本地 PTY 保留）；`sol:close` 额外回收本地 PTY，
> 关闭标签时必须走后者，否则进程句柄泄漏。

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
    "lastSaveDir": "C:\\Users\\xxx\\Desktop",
    "theme": "dark|light",
    "solLayout": "single|tile",
    "autoSaveSol": false
  },
  "favorites": [
    {
      "name": "string",
      "command": "string",
      "desc": "string",
      "category": "AMI|openUBMC|onetree|''（空字符串表示通用）"
    }
  ]
}
```

| settings 键 | 默认 | 说明 |
|-------------|------|------|
| `lastSaveDir` | 桌面 | 上次保存目录，也作为 SOL 日志默认目录 |
| `theme` | `dark` | 主题，非法值由 `theme.js` 归一化回落 |
| `solLayout` | `single` | SOL 终端单屏 / 平铺 |
| `autoSaveSol` | `false` | 启动 SOL 时自动开日志文件 |

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
| main.js | 476 | 主进程（窗口 / IPC / PTY / 扫描 / 自动更新） |
| renderer.js | 2180 | 渲染进程（核心，DOM 编排） |
| index.html | 463 | 界面结构（10 个面板 + 查找栏） |
| style.css | 2293 | 样式（双主题 token + `::highlight` 命中配色） |
| src/modules/*.js (19 个) | 5003 | 业务逻辑模块 |
| **总计** | **10415** | |

> 行数为物理行数（含注释与空行）。

模块行数前三：`fruView.js` 1142、`fru.js` 861、`networkScanner.js` 839。

| 测试套件 | 用例数 |
|----------|--------|
| 24 个 *.test.js | 674 |

覆盖率详见 `test_report.md`（Jest 30）。`src/modules/` 小计语句覆盖 87.24%，
`renderer.js` 36.70%（DOM 编排层，刻意不设门槛）。

---

## 九、已知问题与技术债务

| 问题 | 说明 | 优先级 |
|------|------|--------|
| renderer.js 仍然较大 | 1286 行，纯逻辑已抽到 modules/，剩余主要是 DOM 编排；可继续按面板拆分 | 中 |
| 无 TypeScript | 类型安全缺失（servers / settings / FRU 字段全靠约定） | 中 |
| 密码明文存储 | 配置文件中密码未加密（可考虑 Electron `safeStorage`） | 高 |
| 渲染层仍用 nodeIntegration | contextIsolation 关闭 + CSP 含 unsafe-inline/eval | 高 |
| 无错误边界 | 未捕获异常可能导致崩溃 | 低 |
| FRU 写入无自动备份（字段级） | 只有整区刷写会强制备份；字段级靠用户手点「导出备份」 | 低 |

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
  - 不提供 Internal Use 与 `fru upgEkey`（回滚走「原始命令」面板）
- FRU 整区刷写（`fru write`）：
  - 下发前 `validateFlashImage()` 自校验（大小等于设备 FRU、可解析、三区校验和正确）
  - 写前自动备份到 `%TEMP%/ipmi-gui-fru/`（独立文件名，避免被回读覆盖）
  - 成败只看 `Size to Write == Fru Size` + 回读 `compareImages()` 逐字节比对；
    `fru write` 退出码恒为 0，不可作判据

### 新增（v1.1.x）

- 亮色 / 暗色主题切换（`theme.js` 纯函数 + `data-theme` 覆盖 token，SOL 终端配色同步跟随）
- 自动更新（GitHub Releases + electron-updater）：后台下载、**不自动重启**，
  只有 `ready` 后用户确认才 `quitAndInstall`；顶栏常驻版本号，点击可手动检查
- SOL 多标签平铺显示 + PTY 尺寸同步（`sol:resize`）；修复输入串台
- SOL 日志自动保存（`sol:log-*` 追加写流，默认关闭，开关即时生效）
- 扫描链路整体移入主进程（`scan:start/stop/progress`），渲染层只做展示
- Ping 预探测改为默认关闭（实测比先 Ping 快约 3 倍，且能发现禁 Ping 设备）
- 修复 Ping 单包 + 硬超时过短导致在线设备误杀（改为 2 包、硬超时 `count*timeout+2000`）
- 扫描支持 `/16` ~ `/30` 与第 4 段指定子网，超过 1024 个地址先提示耗时
- 收藏夹分类（AMI / openUBMC / onetree / 通用）与导入导出（按名称+命令+分类去重）
- 顶栏在窄窗口下改为整组换行，不再被挤出可视区

---

*文档版本: v1.5*
*更新时间: 2026-10-22*
