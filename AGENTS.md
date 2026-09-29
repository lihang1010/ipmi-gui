# AGENTS.md — IPMI 管理工具

## 项目概览

基于 Electron 28 + Node.js 的 Windows 桌面端 IPMI 图形化管理工具。
封装 `ipmitool.exe`，提供可视化界面管理服务器 BMC。

| 项目 | 值 |
|------|-----|
| 框架 | Electron ^28.0.0 |
| 终端 | xterm.js ^5.3.0 + node-pty ^1.0.0 |
| 终端插件 | @xterm/addon-fit, @xterm/addon-serialize |
| 打包 | electron-builder ^24.0.0 (NSIS + portable) |
| 测试 | Jest ^30.4.2 |
| 模块系统 | CommonJS (require / module.exports) |
| 语言 | JavaScript (ES2020+) |
| 底层工具 | bin/ipmitool.exe + Cygwin DLL |

---

## 项目结构

```
ipmi-gui-electron/
├── main.js                  # Electron 主进程
├── package.json
├── electron-builder.yml     # 打包配置
├── build.ps1 / build.bat    # 构建脚本
├── AGENTS.md                # 本文件
├── bin/                     # ipmitool.exe + Cygwin DLL
├── assets/icon.ico          # 应用图标
├── src/
│   ├── index.html           # 主界面
│   ├── renderer.js          # 渲染进程核心
│   ├── style.css            # 暗色主题样式系统
│   ├── config/ipmi-credentials.json  # 默认凭据唯一来源
│   └── modules/
│       ├── configStore.js   # 配置读写 (唯一实现)
│       ├── ipmiTool.js      # 路径解析/参数构建/命令行分词 (主+渲染共用)
│       ├── credentials.js   # 凭据模板读取
│       ├── bmcVersion.js    # mc info 版本号解析（AMI/openUBMC 取字节规则）
│       ├── commandRunner.js # IPMI 命令执行封装
│       ├── favorites.js     # 收藏夹
│       ├── utils.js         # 工具函数
│       ├── modal.js         # 模态对话框
│       ├── templates.js     # 服务器模板 (凭据来自 credentials.js)
│       ├── scanResultView.js# 扫描结果行渲染 (纯函数)
│       ├── networkScanner.js# 网络扫描
│       ├── fru.js           # FRU 镜像解析/命令构建/结果判定 (纯函数)
│       └── fruView.js       # FRU 面板渲染与写入编排 (写入->重新读取校验)
├── __tests__/               # 单元测试 (19 套件)
└── coverage/                # 覆盖率报告 (已被 .gitignore 忽略)
```

---

## 架构

### 关键配置

```javascript
// main.js
webPreferences: {
  nodeIntegration: true,    // 渲染进程可 require
  contextIsolation: false   // 无隔离层
}
// 无 preload 脚本：渲染进程直接 require('electron') 使用 ipcRenderer
```

### IPC 通道

| 通道 | 方向 | 参数 | 返回 |
|------|------|------|------|
| ipmi:execute | 渲染→主 | server, command, args | {code, stdout, stderr} |
| sol:start | 渲染→主 | server, tabId | {success, pid/error} |
| sol:stop | 渲染→主 | server | {success, stderr} |
| sol:close | 渲染→主 | tabId, server | {success, stderr} |
| sol:write | 渲染→主 | tabId, data | - |
| sol:data | 主→渲染 | {tabId, data} | - |
| sol:exit | 主→渲染 | {tabId, exitCode} | - |
| file:save | 渲染→主 | defaultName, content | {success, path} |
| dialog:selectDirectory | 渲染→主 | - | path/null |
| dialog:selectFile | 渲染→主 | filters | path/null |
| app:getMemory | 渲染→主 | - | {rss, heapUsed, ...} |

> 配置不走 IPC：渲染进程的 `src/modules/configStore.js` 直接读写
> `%APPDATA%/ipmi-gui/config.json`。

**新增 IPC**：main.js 加 ipcMain.handle，renderer 调用 ipcRenderer.invoke。

---

## 编码规范

### JavaScript
- **CommonJS 模块**：require / module.exports
- **函数声明**：async function foo() {} (提升行为明确)
- **IPC 调用**：ipcRenderer.invoke + ipcMain.handle
- **异步**：优先 async/await
- **命名**：变量 camelCase，常量 UPPER_SNAKE，CSS 类 kebab-case

### CSS
- CSS 变量主题：var(--bg-app), var(--accent) 等 60+ token
- 深色桌面工具风格
- body user-select: none；数据区加 user-select: text
- 按钮四态：hover / active / loading / disabled

### 模块划分

| 文件 | 职责 |
|------|------|
| main.js | 主进程，不操作 DOM |
| renderer.js | 渲染进程，UI 交互 |
| src/modules/*.js | 业务逻辑，不生成 HTML |
| src/style.css | 所有样式 |
| __tests__/*.test.js | 单元测试 |

---

## 关键实现

### ipmitool 参数构建 (src/modules/ipmiTool.js buildArgs)

拼装 -H/-U/-P/-I/-C/-L 参数，SOL 额外拼 sol activate。
命令行参数用 `tokenizeCommand()` 分词（支持引号），不要用 `split(' ')`。

### ipmitool 路径查找 (src/modules/ipmiTool.js resolveIpmiToolPath)

1. process.resourcesPath/bin/ipmitool.exe
2. process.resourcesPath/app.asar.unpacked/bin/ipmitool.exe
3. exe 同级 resources/bin、resources/app.asar.unpacked/bin
4. exe 同级 bin/、exe 同目录
5. 开发模式: 项目 bin/

未找到时返回 `null`，调用方负责给出明确错误，不要返回不存在的路径。

### 配置存储

路径: %APPDATA%/ipmi-gui/config.json
唯一实现是渲染进程的 `src/modules/configStore.js`（主进程不再读写配置）。
密码明文存储，无加密。

### 网络扫描流程

```
CIDR 展开主机 (cidrToHosts, /24~/30)
   |
   +-- Ping 扫描 (可关闭：usePing=false 时跳过，直接对全部地址扫端口;
   |               Windows 的 -w 单位为毫秒)
   +-- 多端口扫描 (UDP:623 ASF Ping / TCP:623 / TCP:80 / TCP:443)
         |
         +-- 无 TCP:623 且无 TCP:443 -> 丢弃 (不验证)
         +-- 有 TCP:623 或 TCP:443 -> IPMI 验证 (凭据来自 credentials.js)
               |
               +-- 通过: 标记 verified + template 名，再执行 mc info 取 BMC 版本号
               +-- 失败: TCP:623 开放时标记 verifyHint 提示
```

BMC 版本号 = `Firmware Revision` + '.' + Aux 字节，取字节规则见 bmcVersion.js：
AMI 取 Aux 前 2 字节直接拼接（1.11.1109），openUBMC 取后 2 字节以点分隔（1.11.00.00）。
ipmitool 调用统一走 `runIpmiCommand()`（execFile 逐参数传参，凭据不经 shell）。

### 主题（亮色 / 暗色）

主题靠 `<html data-theme="dark|light">` 切换，样式表在 `:root[data-theme='light']` 覆盖
颜色类 token（见 `style.css`）。纯逻辑在 `src/modules/theme.js`，DOM 操作与持久化在
`renderer.js` 的 `applyTheme` / `toggleTheme`。

- **入口**：顶栏 `btn-theme-toggle`。选择记在 `settings.theme`，`DOMContentLoaded` 里
  `loadConfig()` 之后**立即** `applyTheme(getConfig().settings?.theme)`，避免启动闪一下默认暗色
- **终端**：`createTerminal` 用 `theme.terminalTheme(currentTheme)` 初始化；`applyTheme` 还必须
  遍历 `solTabs` 更新**已打开**终端的 `options.theme`，否则终端配色会和新主题打架
- **加新颜色时必须走 token**。尤其 `--tint-subtle/-default/-strong`：暗色主题下是白色低透明
  （提亮表面），亮色主题下翻成黑色低透明（压暗表面）。hover 底色、斑马纹、滚动条滑块全靠它，
  写死 `rgba(255,255,255,0.0x)` 在亮色主题下会彻底看不见
- 只有三类颜色允许写死：**有色按钮上的白字**（`#fff`）、**强调/危险色的半透明装饰**
  （`rgba(91,155,213,...)` 之类）、**阴影**。语义色按钮的 hover 加深色走
  `--success-hover` / `--danger-hover` / `--warning-hover`，别直接写十六进制
- 下拉箭头是内联 SVG data URI，SVG 内部着色用不了 `var()`，所以整条 URI 做成
  `--select-arrow`，两套主题各给一份

### FRU 读取与字段编辑 (src/modules/fru.js + fruView.js)

读取分两阶段（见 `fruView.load` + `loadPreview`）：

1. **预览**：`-v fru print <id>`（约 0.4s）→ `parseFruPrint()` → 先渲染字段表，编辑按钮锁定。
   **`-v` 必须写在 `fru` 之前**：写成 `fru print -v <id>` 时 ipmitool 不报错但 stdout
   为空（实测 0 字符），预览会静默失效。
2. **校准**：`fru read <id> <file>`（约 1.2s）→ `parseFruImage()` → 权威结果，解锁编辑。
   写入一律以这一份为准（`openEdit` 会拒绝未校准状态）。

两套解析并存的原因：`fru print` **会整行跳过空字段**，`-v` 前还不显示 FRU ID 行，
按行号数序号必然错位。`parseFruPrint` 改为按字段标签反查 `FRU_SECTIONS` 得到 index、
Extra 按出现顺序累加，因此空字段缺失不影响其它字段的序号识别（fru.test.js 有测试固定）。

写入：`fru edit <fruid> field <section> <index> <string>`，契约来自 ipmitool
`lib/ipmi_fru.c` 源码与真机实测（ipmitool 1.8.18）：

- `<section>` 取参数的**首字符**：`c`=Chassis / `b`=Board / `p`=Product
- `<index>` 取参数的**首字符**再减 0x30，即只能是 `'0'`~`'9'`；传 `50` 等价于 `5`
- index = 区内**字符串字段序号**（0 起），起点为 区起始 + 3（Chassis）/+ 6（Board，
  跳过 Language Code 与 3 字节 Mfg Date）/+ 3（Product），含 FRU ID 与多行 Extra
- **不能用 exit code 判定成败**：长度改变（重排三区）成功时为 1，长度不变（原地替换）成功时为 0
- **判定成功的唯一标志是 stdout 里的 `Updating Field`，不可要求 `Done.`**。ipmitool 有两条
  互斥路径（`lib/ipmi_fru.c:4977 / 5002`）：
  1. 新值与旧值**等长** → 原地替换，只打印 `Updating Field '<旧>' with '<新>' ...`，
     **没有 `Done.`、也没有 `Writing new FRU.`，退出码 0**
  2. 长度改变 → 调用 rebuild 重排三区，打印带 `(Length from a to b)` 的版本 + `Done.`，退出码 1

  只认第 2 种会让**等长写入被误判为失败**，用户看到「写入流程未完成」但设备其实已改成功
  （真机踩过，短字段如 Board Extra `N/A` 最易触发）
- **错误判定必须先于成功判定**：写入失败时同样会打印 `Updating Field`，错误行在它之后
  （`Write to FRU data failed.` / `Internal error, padding length ...`）
- 两种格式里的旧值都取自目标字段本身，可用于校验"改到的确实是预期字段"
- 空字符串字段不可编辑（报 `Field not found !`）；新值上限 63 字节且仅可打印 ASCII
- 新值一律走 IPC 的 argv 参数传递，不拼进命令字符串

写入流程：点「写入」**立即下发**（无二次确认）→ 重新 `fru read` 比对字段值，
并校验 ipmitool 报告的旧值与预期一致（防止改错字段）。
由于没有二次确认，**必须**让「写入」按钮以「新值合法且与原值不同」为启用条件
（见 fruView.validatePreview），不要改成始终可点。
写入 + 重新读取实测约 3.4 秒，且对话框会遮住摘要行状态，因此进度**必须**显示在
对话框内部（fruView.setProgress）；期间用 setBusy 冻结对话框，结束后再解除。

**对话框的关闭时机**：未提交时只有「×」和「取消」两个入口；**写入成功后自动关闭**。
刻意不绑定遮罩点击 —— 否则手滑点到对话框外面就会丢掉已输入的内容。
字段级写入**不做**写前自动备份：需要留存原始数据由用户点「导出备份」（`fru read`）自行保存；
整区刷写见下节（那条路径强制写前备份）。

### FRU 整区刷写 (fru write)

`fru write <id> <file>` 和 `fru edit` 有本质差别：**ipmitool 完全不校验文件内容**
（`lib/ipmi_fru.c:3468-3529` 直接把文件字节写进 EEPROM），而且函数返回 void，
**退出码恒为 0** —— 实测连「文件不存在」都是 0，错误只落在 stderr。因此：

- 判定成败只能解析 stdout 的 `Fru Size` / `Size to Write`，且
  **`Size to Write` 必须等于 `Fru Size` 且大于 0**。等于 0 说明文件为空（ipmitool 静默
  什么都不写），小于 `Fru Size` 说明只覆盖了前一段（FRU 会被写坏）。
  `parseWriteResult` 已覆盖这几种情况
- 下发前必须自己校验（`fru.validateFlashImage`）：**文件大小 == 设备 FRU 大小**、
  能解析成合法 FRU、公共头与三个信息区的校验和都正确。缺任何一项都可能写坏设备
- **唯一可靠的确认是写后回读逐字节比对**（`fru.compareImages`）。字段级比对会漏掉
  padding、区长度与校验和的变化，不能用来判断刷写是否成功
- 写前自动备份到 `%TEMP%/ipmi-gui-fru/fru-<host>-id<id>-before-flash.bin`。**必须与日常
  读取用的临时镜像区分命名**（见 `tempFlashBackupPath`），否则紧接着的回读会把备份
  覆盖掉，失去回滚能力
- 确认框 `fru-flash-dialog` 里用 `fruView.renderFlashDiff` 列出字段级 diff
  （`fru.diffImages`，超过 `FLASH_DIFF_LIMIT` 条折叠）。**只有校验通过才关闭**，
  失败保持打开便于重试或取消；同样不绑遮罩点击关闭

---

## 测试

```bash
npm test                    # 全量
npx jest __tests__/xxx      # 单文件
npm run test:coverage       # 带覆盖率
npm run lint                # ESLint 9 (eslint.config.js)
```

- Jest 30，testEnvironment 为 **node**（非 jsdom，DOM 靠手工 mock）
- Node 内置模块用 jest.mock() 行内 mock
- dgram、net、child_process、fs、path、os 均已 mock
- fullScan 测试设 30s 超时
- theme.test.js 覆盖主题归一化 / 切换 / 文案 / 终端配色（纯函数）
- updateStatus.test.js 覆盖更新状态的文案 / 可点击性 / 可见性映射（纯函数）
- renderer.test.js 的 `document` 桩必须带 `documentElement`，否则 `applyTheme` 写 `data-theme` 会崩
- fru.test.js 用真实设备镜像（前 168 字节 hex 夹具）与 `fru print -v` 真实输出断言 index 映射
- fruView.test.js 覆盖纯函数与写入/读取的交互时序（DOM 用注入桩 + mock IPC + 真实临时文件）
- **mock 测不出 ipmitool 的参数形式问题**（如 `-v` 位置），此类改动必须真机跑一遍
- 共 535 用例，21 套件

---

## 构建与部署

```bash
npm start            # 开发
powershell build.ps1 # 构建（NSIS 安装包 + 免安装版 + 自动更新清单）
```

- 需管理员权限运行
- 现在有两种交付形态：`ipmi-gui-<ver>-win-x64.exe`（NSIS 安装版，走自动更新）
  与 `ipmi-gui-<ver>-portable.exe`（免安装绿色版）
- `bin/` 由 electron-builder 的 `extraResources` 复制到 `resources/bin`，
  构建脚本只做存在性校验（不再手动 Copy-Item）
- **不要再用 `--dir` 构建**：它只产 `win-unpacked`，既没有安装包也不生成 `latest.yml`，
  自动更新会失效

### 自动更新（NSIS + electron-updater）

- 更新源是 **GitHub Releases**（`publish.provider: github`，仓库 `lihang1010/ipmi-gui`，
  已确认 public，客户端无需任何凭据）。
  **发布流程**：改 `package.json` 的 version → 提交 → 打 `v<version>` tag 推到 GitHub →
  `.github/workflows/release.yml` 自动 lint / test / 构建并发布 Release
- **`publish.releaseType` 必须显式写 `release`**。默认是 `draft`，而草稿不会出现在
  `releases/latest` 里，客户端会一直显示「已是最新」，**构建日志完全看不出问题**
- 同理 CI 里必须显式 `--publish always`：CI 环境下 electron-builder 的默认策略是
  `onTagOrDraft`（见 `app-builder-lib/out/publish/PublishManager.js`），
  只在「已存在 draft release」时才上传，**不会自己创建 Release**
- **tag 必须形如 `v<package.json 的 version>`**：electron-updater 拿 release 的 tag 当
  版本号，与客户端的 `app.getVersion()` 比对；tag 少了 `v` 或版本不一致，就会出现
  「检测到新版本却永远装不上」。workflow 里有一道专门的校验，不一致直接失败
- 对 `github.com`，electron-updater **刻意不请求 `api.github.com`**（避免限流），
  而是请求 `github.com/<owner>/<repo>/releases/latest`
- `artifactName` **刻意用 ASCII**：`latest.yml` 里的 url 直接取自它，一旦将来换成
  generic 更新源（内网 HTTP / 对象存储），中文名经 URL 编码后可能被反向代理解不出来，
  更新会静默失败。安装向导与快捷方式仍显示中文
- 客户端行为：启动 5 秒后检查 → 发现新版**自动后台下载** → 下载完成才在顶栏出现
  「重启更新到 vX.Y.Z」→ **由用户确认后**才 `quitAndInstall`。**绝不能自动重启**：
  SOL 会话与正在执行的命令经不起中断（`autoInstallOnAppQuit` 保持默认，用户正常退出
  时会顺带装上，这条路径是无感的）
- 文案集中在 `src/modules/updateStatus.js` 的 `describeUpdate`（纯函数），主进程只把
  electron-updater 的事件归一化成 `{state, version, percent, error}`
- 顶栏 `app-version` 徽标显示当前版本，**来源同为 `app.getVersion()`**（IPC `app:getVersion`），
  与更新比对的基准同源，不会出现"显示 1.0.0、实际按 1.0.1 比对"的错位；
  点击它可手动检查更新（开发模式下会明确提示不检查）
- 开发模式（`!app.isPackaged`）跳过检查；任何失败只更新状态，**不阻塞启动** ——
  内网更新源不可达是常态
- 主进程已加 `app.requestSingleInstanceLock()`：更新重启与重复双击都不该开出第二个窗口

### 陷阱：build.ps1 必须保持 UTF-8 BOM

`build.ps1` 里有中文（进程名 `IPMI管理工具` 等）。PowerShell 5.1 对**无 BOM** 的文件按
系统 ANSI（GBK）解码，中文字节会错位并**吃掉后面的引号**，直接导致语法错误、
整个脚本无法运行。一旦用会把 BOM 丢掉的工具编辑过，确认前 3 字节仍是 `ef bb bf`。

---

## 常见陷阱

### 1. 反射到 DOM 的数据必须转义
扫描结果里的 productName / productSource 来自被扫描设备的 HTTP 响应，
属远端可控数据；渲染前必须经 `escapeHtml`（见 scanResultView.js），
否则在 nodeIntegration 开启下可升级为 RCE。

### 2. 凭据只在 ipmi-credentials.json 维护
运行时一律走 `src/modules/credentials.js`（getCredentialTemplates /
getCredentialByName / getServerTemplates），不要在模块里内联凭据副本。

### 3. 中文编码
PowerShell 输出中文异常，apply_patch context 匹配优先用非中文行。

### 4. DOM API
getElementById 是 document 的方法，不能对普通元素调用。动态弹窗用 document.getElementById 或 querySelector。

### 5. user-select
body 设 user-select: none，新增可复制区域需加 user-select: text。

### 6. 嵌套模板字面量
${arr.map(s => \`...\`)} 可能解析异常，优先字符串拼接。

### 7. 测试超时
fullScan 扫整个 /24 网段需 30s 超时。

### 8. 密码安全
配置文件中密码明文存储，无加密。

---

## 功能面板

| 面板 | data-tab | 关键方法 |
|------|----------|---------|
| SOL 终端 | sol | startSol(), stopSol(), addSolTab() |
| 收藏夹 | favorites | favorites.execute(), favorites.select(), favorites.setCategoryFilter(), favorites.importFavorites() |
| 网络扫描 | scan | scanner.fullScan(), addSingleScanResult() |
| 电源 | power | executePower(action) |
| 传感器 | sensor | executeSensor() |
| FRU | fru | fruView.refresh(), fruView.submitEdit() |
| 事件日志 | sel | executeCommand('sel list') |
| 用户 | user | executeCommand('user list') |
| 网络 | network | executeCommand('lan print') |
| 原始命令 | raw | executeRawCommand() |

---

## 扩展指南

1. **新增 IPC**：main.js ipcMain.handle -> renderer 调用
2. **新增面板**：index.html 加 tab+panel -> renderer.js bindEvents 加事件
3. **新增扫描端口**：networkScanner.js fullScan() 中 portTargets 数组加条目
4. **新增凭据**：src/config/ipmi-credentials.json 加模板
5. **新增收藏分类**：src/modules/favorites.js 的 `FAVORITE_CATEGORIES`（编辑下拉与筛选下拉会自动同步；收藏项 category 为空视为"通用"）
6. **CSS 主题**：style.css :root 下已有 60+ 变量，遵循现有命名
7. **新增 FRU 可编辑区/字段**：只改 src/modules/fru.js 的 `FRU_SECTIONS`
   （shortKey / fieldOffset / 字段标签单一来源），并同步 __tests__/fru.test.js
8. **新增 FRU 相关命令**：新值走 `executeCommand(command, outputId, server, args)` 的
   argv 参数，不要拼进命令字符串
