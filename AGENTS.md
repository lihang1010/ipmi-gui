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
├── preload.js               # 预加载脚本 (未实际使用)
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
│   ├── config/ipmi-credentials.json
│   └── modules/
│       ├── configStore.js   # 配置读写
│       ├── commandRunner.js # IPMI 命令执行封装
│       ├── favorites.js     # 收藏夹
│       ├── utils.js         # 工具函数
│       ├── modal.js         # 模态对话框
│       ├── templates.js     # 服务器模板
│       └── networkScanner.js# 网络扫描
├── __tests__/               # 单元测试 (275 用例)
└── coverage/                # 覆盖率报告
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
// preload.js 的 contextBridge API 未使用，renderer 直接走 ipcRenderer
```

### IPC 通道

| 通道 | 方向 | 参数 | 返回 |
|------|------|------|------|
| config:get | 渲染→主 | - | config 对象 |
| config:save | 渲染→主 | config | true |
| ipmi:execute | 渲染→主 | server, command | {code, stdout, stderr} |
| sol:start | 渲染→主 | server, tabId | {success, pid/error} |
| sol:stop | 渲染→主 | server | {success, stderr} |
| sol:write | 渲染→主 | tabId, data | - |
| sol:deactivate | 渲染→主 | server | {success, stderr} |
| sol:data | 主→渲染 | {tabId, data} | - |
| sol:exit | 主→渲染 | {tabId, exitCode} | - |
| file:save | 渲染→主 | defaultName, content | {success, path} |
| dialog:selectDirectory | 渲染→主 | - | path/null |
| dialog:selectFile | 渲染→主 | filters | path/null |
| app:getMemory | 渲染→主 | - | {rss, heapUsed, ...} |

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

### ipmitool 参数构建 (main.js buildArgs)

拼装 -H/-U/-P/-I/-C/-L 参数，SOL 额外拼 sol activate。

### ipmitool 路径查找 (5级)

1. resources/bin/ipmitool.exe
2. resources/app.asar.unpacked/bin/ipmitool.exe
3. exe 同级 bin/
4. exe 同目录
5. 开发模式: 项目 bin/

### 配置存储

路径: %APPDATA%/ipmi-gui/config.json
密码明文存储，无加密。

### 网络扫描流程

```
Ping 扫描 -> 多端口扫描 (UDP:623 TCP:623 TCP:80 TCP:443)
   |
   +-- 无 TCP:623 且无 TCP:443 -> 丢弃 (不验证)
   +-- 有 TCP:623 或 TCP:443 -> IPMI 验证
         |
         +-- 通过: 标记 verified + template 名
         +-- 失败: TCP:623 开放时标记 verifyHint 提示
```

---

## 测试

```bash
npm test                  # 全量
npx jest __tests__/xxx    # 单文件
```

- Jest 30 + jsdom
- Node 内置模块用 jest.mock() 行内 mock
- dgram、net、child_process、fs、path、os 均已 mock
- fullScan 测试设 30s 超时
- 共 275 用例，13 套件

---

## 构建与部署

```bash
npm start            # 开发
powershell build.ps1 # 构建
```

- 需管理员权限运行
- 解压即用，无安装过程
- 构建脚本手动复制 bin/ 到 dist

---

## 常见陷阱

### 1. 配置读写双重逻辑
main.js 和 configStore.js 都有独立的配置读写，新增字段需两边同步。

### 2. IPC Handler 重复
sol:stop 和 sol:deactivate 功能完全相同。

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
| 收藏夹 | favorites | favorites.execute(), favorites.select() |
| 网络扫描 | scan | scanner.fullScan(), addSingleScanResult() |
| 电源 | power | executePower(action) |
| 传感器 | sensor | executeSensor() |
| FRU | fru | executeCommand('fru list') |
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
5. **CSS 主题**：style.css :root 下已有 60+ 变量，遵循现有命名
