# IPMI 管理工具

基于 Electron + Node.js 的图形化 IPMI 管理工具，支持服务器远程管理、传感器监控、SOL 远程终端等功能。

## 功能特性

### 核心功能

- **SOL 远程终端** - 内嵌终端，支持交互式操作，日志自动保存
- **电源管理** - 开机、关机、重启、状态查询
- **传感器监控** - 温度、风扇、电压等实时数据
- **FRU 信息** - 查看设备硬件信息
- **事件日志 (SEL)** - 系统事件日志查看与管理
- **用户管理** - IPMI 用户的增删改查
- **网络配置** - IPMI 网络参数配置
- **原始命令** - 执行任意 ipmitool 命令

### 特色功能

- **网络扫描** - 扫描网段自动发现 IPMI 设备（Ping → 端口 → 凭据验证）
- **多标签 SOL 终端** - 同时打开多个服务器会话
- **命令收藏夹** - 常用命令一键保存与执行
- **收藏夹分类** - 按 AMI / openUBMC / onetree / 通用 分类显示与筛选
- **收藏夹导入导出** - JSON 格式导入导出，导入时按名称+命令+分类自动去重
- **服务器配置导入/导出** - JSON 格式，方便多台电脑同步
- **批量删除服务器** - 勾选多台服务器一次删除
- **日志目录自定义** - 可设置 SOL 日志保存位置
- **配置记忆** - 自动记住上次保存目录
- **SOL 日志录制** - 会话内容可保存到文件
- **内存监控** - 工具栏实时显示应用内存占用

### 键盘快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+R` | 刷新当前面板 |
| `Ctrl+L` | 清屏当前面板 |
| `Ctrl+N` | 添加新服务器 |
| `Esc` | 关闭对话框 |

## 快速开始（解压即用）

### 下载

获取 `IPMI管理工具.zip` 压缩包。

### 安装

1. 解压到任意目录（如 `D:\IPMI管理工具\`）
2. 右键 `IPMI管理工具.exe` → **以管理员身份运行**

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

构建完成后，在 `dist\win-unpacked\` 目录下找到可运行程序。

## 部署到其他电脑

### 方式 1: 压缩包（推荐）

```powershell
# 1. 构建
powershell -ExecutionPolicy Bypass -File build.ps1

# 2. 压缩 win-unpacked 文件夹
Compress-Archive -Path "dist\win-unpacked" -DestinationPath "dist\IPMI管理工具.zip"
```

将 `IPMI管理工具.zip` 复制到目标电脑 → 解压 → 右键以管理员身份运行。

### 方式 2: 直接复制

1. 运行 `build.ps1`
2. 复制整个 `dist\win-unpacked` 文件夹到目标电脑
3. 右键 `IPMI管理工具.exe` → 以管理员身份运行

### 要求

| 项目 | 要求 |
|------|------|
| 系统 | Windows 10/11 x64 |
| 权限 | 管理员权限 |
| 安装 | 无需安装，解压即用 |
| 依赖 | 无需额外依赖，全部内置 |

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
├── __tests__/           # 单元测试（16 套件）
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
