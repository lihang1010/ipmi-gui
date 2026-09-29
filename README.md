# IPMI 管理工具

基于 Electron + Node.js 的图形化 IPMI 管理工具，支持服务器远程管理、传感器监控、SOL 远程终端等功能。

## 功能特性

### 核心功能

- **SOL 远程终端** - 内嵌终端，支持交互式操作，日志自动保存
- **电源管理** - 开机、关机、重启、状态查询
- **传感器监控** - 温度、风扇、电压等实时数据
- **FRU 信息** - 结构化查看 Chassis / Board / Product 字段，支持导出整区镜像、逐字段编辑（写入即生效 + 写后自动校验）与整区刷写（bin 覆盖 + 写前自动备份 + 逐字节回读校验）
- **事件日志 (SEL)** - 系统事件日志查看与管理
- **用户管理** - IPMI 用户的增删改查
- **网络配置** - IPMI 网络参数配置
- **原始命令** - 执行任意 ipmitool 命令

### 特色功能

- **网络扫描** - 扫描网段自动发现 IPMI 设备（Ping → 端口 → 凭据验证 → BMC 版本号，扫描结果含产品名与固件版本列）
- **Ping 预探测开关** - 默认勾选先 Ping 存活再扫端口；取消勾选则直接扫端口，可发现禁 Ping 的设备（较慢）
- **多标签 SOL 终端** - 同时打开多个服务器会话
- **命令收藏夹** - 常用命令一键保存与执行
- **收藏夹分类** - 按 AMI / openUBMC / onetree / 通用 分类显示与筛选
- **收藏夹导入导出** - JSON 格式导入导出，导入时按名称+命令+分类自动去重
- **服务器配置导入/导出** - JSON 格式，方便多台电脑同步
- **批量删除服务器** - 勾选多台服务器一次删除
- **日志目录自定义** - 可设置 SOL 日志保存位置
- **配置记忆** - 自动记住上次保存目录
- **主题切换** - 顶栏一键切换亮色 / 暗色主题，选择自动记住（SOL 终端配色同步跟随）
- **自动更新** - 后台检查并静默下载新版本，下载完成后在顶栏提示，由你决定何时重启安装（不会打断正在进行的 SOL 会话）
- **版本号显示** - 顶栏常驻显示当前版本号，鼠标悬停可见 Electron 版本，点击可手动检查更新
- **SOL 日志录制** - 会话内容可保存到文件
- **内存监控** - 工具栏实时显示应用内存占用

### 键盘快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+R` | 刷新当前面板 |
| `Ctrl+L` | 清屏当前面板 |
| `Ctrl+N` | 添加新服务器 |
| `Esc` | 关闭对话框 |

## 快速开始

### 下载

在 [Releases](https://github.com/lihang1010/ipmi-gui/releases) 页面按需选择：

| 文件 | 说明 |
|------|------|
| `ipmi-gui-<版本>-win-x64.exe` | **安装版（推荐）** —— 有安装向导、桌面 / 开始菜单快捷方式，可卸载，**支持自动更新** |
| `ipmi-gui-<版本>-portable.exe` | **免安装版** —— 双击直接运行，不写入安装目录；无快捷方式与卸载项，**不支持自动更新** |

### 安装

**安装版**：双击运行安装向导（可自选安装目录），装完后**右键快捷方式 → 以管理员身份运行**（本工具需要管理员权限）。

**免安装版**：双击即可运行，无需安装。

> **首次运行被 Windows 提示「无法验证发布者」？** 见文末「常见问题」——只需放行一次，之后不再提示。

### 使用

1. 点击 **"添加"** 按钮，填写服务器信息
2. 选择服务器 → 切换到 **"SOL 终端"**
3. 点击 **"启动 SOL"** 开始操作

## 开发环境

### 环境要求

- **Node.js** >= 16.0
- **npm** >= 8.0
- **Windows** 10/11 x64

### 安装依赖

```bash
cd ipmi-gui-electron
npm install
```

**国内加速**：

```bash
npm config set registry https://registry.npmmirror.com
$env:ELECTRON_MIRROR="https://registry.npmmirror.com/-/binary/electron/"
npm install
```

### 启动开发

```bash
npm start
```

### 构建发布

```bash
# 运行构建脚本
powershell -ExecutionPolicy Bypass -File build.ps1
```

构建完成后 `dist\` 下会生成：

- `ipmi-gui-<版本>-win-x64.exe` —— NSIS 安装包，**支持自动更新**
- `ipmi-gui-<版本>-portable.exe` —— 免安装单文件
- `latest.yml` / `*.blockmap` —— 更新清单与差分索引，发布时**必须一并上传**，删掉客户端就无法升级

（只想本地自测可以用 `build.bat`，它走 `--dir`，产物只有 `dist\win-unpacked\`，不含安装包与 `latest.yml`。）

### 发布自动更新版本

新版本由 GitHub Actions 自动构建并发布，本地不需要存任何 GitHub 凭据：

```bash
# 1. 修改 package.json 的 version 并提交
# 2. 打一个与版本一致的 tag，推送即可触发流水线
git tag v1.1.0
git push origin v1.1.0
```

流水线会自动跑 lint + 单元测试 + 构建，然后在 GitHub Releases 上发布安装包、
免安装版与更新清单 `latest.yml`。客户端下次启动就会检测到新版本。

> **只有安装版能自动更新**：`latest.yml` 的 `path` 只指向 NSIS 安装包
> （`ipmi-gui-<版本>-win-x64.exe`），免安装版不在更新链路内。

> **首次启用自动更新时需要手动安装一次新版本** —— 旧版本里还没有更新逻辑，
> 它不会自动升级自己。

## 部署到其他电脑

### 方式 1: 安装包（推荐）

```powershell
powershell -ExecutionPolicy Bypass -File build.ps1
```

把 `dist\ipmi-gui-<版本>-win-x64.exe` 复制到目标电脑，双击安装即可。
它带自动更新，装一次以后不用再管。

> 从共享盘 / U 盘拷贝**不会**被拦，从网页下载**会**被拦（SmartScreen），
> 处理办法见「常见问题」。

### 方式 2: 免安装版

把 `dist\ipmi-gui-<版本>-portable.exe` 复制过去，双击直接运行。

> 便携场景用，**不支持自动更新**。

### 方式 3: 直接复制绿色目录

1. 运行 `build.ps1`
2. 复制整个 `dist\win-unpacked` 文件夹到目标电脑
3. 右键 `IPMI管理工具.exe` → 以管理员身份运行

> 这种方式同样**不支持自动更新**（没有 `latest.yml`），但内网拷贝不会触发下载拦截。

### 要求

| 项目 | 要求 |
|------|------|
| 系统 | Windows 10/11 x64 |
| 权限 | 运行主程序时需要管理员权限 |
| 安装 | 安装版需安装；免安装版 / 绿色目录解压即用 |
| 依赖 | 无需额外依赖，全部内置（含 `ipmitool.exe` 与 Cygwin DLL）|

## 目录结构

```
IPMI管理工具\
├── IPMI管理工具.exe        # 主程序（管理员权限运行）
└── resources\
    ├── bin\
    │   ├── ipmitool.exe   # IPMI 命令行工具
    │   ├── cygwin1.dll    # Cygwin 运行库
    │   ├── cygcrypto-1.0.0.dll
    │   └── cygz.dll
    └── app.asar           # 应用代码
```

## 使用说明

### 添加服务器

1. 点击工具栏的 **"添加"** 按钮
2. 填写服务器信息：
   - **名称**: 服务器别名
   - **IP 地址**: 服务器 IPMI 管理口 IP
   - **端口**: 默认 623
   - **用户名**: IPMI 用户名
   - **密码**: IPMI 密码
   - **接口**: `lanplus` (IPMI v2.0) 或 `lan` (IPMI v1.5)
   - **Cipher Suite**: 默认 17
3. 点击 **"确定"** 保存

### 导入/导出服务器配置

**导出**：点击 **"导出"** → 保存 JSON 文件

**导入**：点击 **"导入"** → 选择 JSON 文件

导出格式示例：

```json
{
  "exportTime": "2026-07-15T10:30:00.000Z",
  "version": "1.0",
  "servers": [
    {
      "name": "生产服务器-01",
      "host": "192.168.1.100",
      "username": "ADMIN",
      "password": "password"
    }
  ]
}
```

### SOL 远程终端

1. 选择服务器 → 切换到 **"SOL 终端"**
2. 点击 **"启动 SOL"** → 点击终端区域获取焦点
3. 输入命令进行操作
4. 点击 **"停止 SOL"** 断开连接
5. 点击 **"日志目录"** 设置保存位置
6. 点击 **"保存日志"** 导出会话记录

### 电源管理

切换到 **"电源"** 选项卡：

- **查询状态** - 查询当前电源状态
- **开机** - Power On
- **关机** - Power Off
- **重启** - Power Cycle

### FRU 信息与字段编辑

切换到 **"FRU"** 选项卡：

1. 点击 **"刷新"**：先列出设备上的 FRU 填充下拉框，再分两步读取选中 FRU ——
   先快速显示字段预览（约 0.4 秒，此时「编辑」按钮暂不可用），再用二进制镜像校准字段序号
   （约 1.2 秒）后解锁编辑。切换下拉框只重读该 FRU，不重新列设备
2. 字段表按 **Chassis / Board / Product** 分区展示，每行显示 `字段名 / 当前值 / 操作`。
   `Chassis Type`、`Board Mfg Date` 属于数值 / 二进制字段，标记为「只读」
3. 点击字段右侧的 **"编辑"**，输入新值（仅可打印 ASCII，最长 63 字节）。
   校验通过后 **"写入"** 按钮才可点，点击即下发到设备，随后自动重新读取校验。
   **写入成功后对话框会自动关闭**
4. **"导出备份"** 可把整区数据导出为文件并保存到指定目录
5. 点击 **"刷写"**：选择本地 `bin` 镜像整体覆盖该 FRU。打开确认框前会先校验文件
   （大小必须与设备 FRU 一致、必须是合法且校验和正确的 FRU 镜像），确认框里会列出
   与设备当前值的逐字段差异。确认后自动备份当前镜像，再执行 `fru write`，最后回读
   逐字节比对确认；**只有比对通过才会报告成功**

> - 逐字段编辑前不会自动备份，需要留存原始数据时请先用 **"导出备份"** 保存整区镜像；
>   **整区刷写会自动备份**当前镜像。
> - 空字段无法被 ipmitool 定位，会标记为「只读」。

### 原始命令

切换到 **"原始命令"** 选项卡：

1. 输入 ipmitool 命令（如 `chassis status`）
2. 按回车或点击 **"执行"**

## 配置文件

配置保存在：`%APPDATA%\ipmi-gui\config.json`

```json
{
  "servers": [
    {
      "id": "1234567890",
      "name": "生产服务器-01",
      "host": "192.168.1.100",
      "port": 623,
      "username": "ADMIN",
      "password": "password",
      "interface": "lanplus",
      "cipherSuite": 17
    }
  ],
  "settings": {
    "lastSaveDir": "C:\\Users\\xxx\\Desktop"
  }
}
```

## 常见问题

### 需要管理员权限

ipmitool 需要管理员权限才能运行。右键应用图标 → **以管理员身份运行**。

### 首次运行提示「无法验证发布者」

安装包**没有代码签名**，而且从网页下载的文件会被 Windows 打上「下载标记」
（Mark-of-the-Web），于是触发 SmartScreen。**只需放行一次** —— 装到本机后
写出的 exe 是全新文件、不带标记，之后运行不会再提示。

- **蓝色「Windows 已保护你的电脑」**：点「更多信息」→「仍要运行」
- **黄色「无法验证发布者」**：点「是」。它只表示发布者身份未知，不代表程序有问题
- **最干净的做法**：右键 exe → 属性 → 常规 → 底部勾选「解除锁定」→ 确定

批量去标记：

```powershell
Get-ChildItem *.exe | Unblock-File
```

从内网共享盘或 U 盘拷贝的文件不带下载标记，不会触发这个提示。

> 想彻底消除提示需要代码签名证书：EV 证书或 Azure Trusted Signing 可**立即**
> 获得信任，OV 证书需要先累积下载声誉。当前版本未签名。

### SOL 连接失败

**错误**: `Error: Unable to establish IPMI v2 / RMCP+ session`

**解决方案**:
1. 确认服务器 IPMI 管理口可达
2. 检查用户名密码是否正确
3. 尝试切换接口类型（`lan` 或 `lanplus`）
4. 检查 Cipher Suite 设置
5. 确认以管理员身份运行

### 终端显示异常

按 `Ctrl+L` 或点击"清屏"按钮重置终端。

### Electron 安装失败

使用国内镜像（见开发环境章节），或手动下载 Electron 到 `node_modules/electron/dist/`。

## 项目结构

```
ipmi-gui-electron/
├── main.js              # Electron 主进程
├── package.json         # 项目配置
├── electron-builder.yml # electron-builder 配置
├── build.ps1            # 构建脚本
├── bin/                 # ipmitool 文件（打包时复制）
├── src/
│   ├── index.html       # 主界面
│   ├── renderer.js      # 渲染进程脚本
│   ├── style.css        # 样式
│   ├── config/          # 默认凭据模板（唯一来源）
│   └── modules/         # 业务逻辑模块
├── __tests__/           # 单元测试（19 套件）
└── assets/
    └── icon.ico         # 应用图标
```

## 依赖说明

| 包名 | 版本 | 说明 |
|------|------|------|
| electron | ^28.0.0 | 桌面应用框架 |
| node-pty | ^1.0.0 | 伪终端（PTY）实现 |
| xterm | ^5.3.0 | 终端模拟器组件 |
| @xterm/addon-fit | ^0.10.0 | 自适应尺寸插件 |
| @xterm/addon-serialize | ^0.12.0 | 终端内容序列化插件 |
| electron-builder | ^24.0.0 | 打包工具 |

## 许可证

MIT License

## 相关项目

- [ipmitool](https://github.com/ipmitool/ipmitool) - IPMI 命令行工具
- [xterm.js](https://github.com/xtermjs/xterm.js) - 终端模拟器
- [node-pty](https://github.com/nicl/node-pty) - Node.js 伪终端
- [Electron](https://electronjs.org/) - 桌面应用框架
