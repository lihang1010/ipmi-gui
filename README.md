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

### 技术优势

- **node-pty** + **xterm.js** - 成熟的终端模拟方案（VS Code 同款）
- **内嵌终端** - SOL 在 GUI 内运行，无需新开窗口
- **日志录制** - 终端内容可保存到文件
- **多服务器** - 支持保存多个服务器配置
- **现代化 UI** - 深色主题，响应式布局

## 环境要求

- **Node.js** >= 16.0
- **npm** >= 8.0
- **ipmitool.exe** - 需要在上级目录或系统 PATH 中

## 安装

### 1. 克隆项目

```bash
git clone <repository-url>
cd ipmi-gui-electron
```

### 2. 安装依赖

```bash
npm install
```

**国内用户** - 使用淘宝镜像加速：

```bash
# 设置 npm 镜像
npm config set registry https://registry.npmmirror.com

# 设置 Electron 镜像（在 PowerShell 中执行）
$env:ELECTRON_MIRROR="https://registry.npmmirror.com/-/binary/electron/"

# 安装依赖
npm install
```

### 3. 启动应用

```bash
npm start
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
   - **接口**: 选择 `lanplus` (IPMI v2.0) 或 `lan` (IPMI v1.5)
   - **Cipher Suite**: 默认 17
3. 点击 **"确定"** 保存

### SOL 远程终端

1. 在下拉框选择服务器
2. 切换到 **"SOL"** 选项卡
3. 点击 **"启动 SOL"** 按钮
4. 在终端中进行操作：
   - 直接输入命令
   - 按 `Ctrl+E` 切换 SOL 模式
   - 按 `Ctrl+]` 断开连接
5. 点击 **"保存日志"** 导出会话记录

### 电源管理

1. 切换到 **"电源"** 选项卡
2. 点击相应按钮：
   - **状态** - 查询当前电源状态
   - **开机** - Power On
   - **关机** - Power Off
   - **重启** - Power Cycle

### 原始命令

1. 切换到 **"原始命令"** 选项卡
2. 在输入框输入 ipmitool 命令（如 `chassis status`）
3. 按回车或点击 **"执行"** 按钮

## 项目结构

```
ipmi-gui-electron/
├── main.js              # Electron 主进程
├── preload.js           # 预加载脚本
├── package.json         # 项目配置
├── build.yml            # electron-builder 配置
├── src/
│   ├── index.html       # 主界面
│   ├── renderer.js      # 渲染进程脚本
│   └── style.css        # 样式
└── assets/
    └── icon.ico         # 应用图标
```

## 开发

### 调试模式

应用启动时会自动打开开发者工具，可在 `main.js` 中注释/取消注释：

```javascript
// 开发时打开开发者工具
mainWindow.webContents.openDevTools();
```

### 打包发布

```bash
# 安装 electron-builder
npm install electron-builder --save-dev

# 打包 Windows 安装程序
npm run build:win
```

## 配置文件

配置保存在用户目录下：

- **Windows**: `%APPDATA%\ipmi-gui\config.json`
- **macOS/Linux**: `~/.config/ipmi-gui/config.json`

配置格式：

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
      "cipherSuite": 17,
      "privilegeLevel": "ADMINISTRATOR"
    }
  ],
  "settings": {}
}
```

## 常见问题

### Electron 安装失败

**问题**: `npm install` 超时或报错

**解决方案**:

1. 使用国内镜像（见安装章节）
2. 或手动下载 Electron：
   - 访问 https://npmmirror.com/mirrors/electron/
   - 下载对应版本的 zip 文件
   - 解压到 `node_modules/electron/dist/` 目录
   - 在 `node_modules/electron/` 创建 `path.txt`，内容为 `dist\electron.exe`

### SOL 连接失败

**问题**: `Error: Unable to establish IPMI v2 / RMCP+ session`

**解决方案**:

1. 确认服务器 IPMI 管理口可达
2. 检查用户名密码是否正确
3. 尝试切换接口类型（`lan` 或 `lanplus`）
4. 检查 Cipher Suite 设置

### 终端显示异常

**问题**: 终端内容显示不全或乱码

**解决方案**:

1. 调整窗口大小后按 `Ctrl+L` 清屏
2. 点击"清屏"按钮重置终端

## 依赖说明

| 包名 | 版本 | 说明 |
|------|------|------|
| electron | ^28.0.0 | 桌面应用框架 |
| node-pty | ^1.0.0 | 伪终端（PTY）实现 |
| xterm | ^5.3.0 | 终端模拟器组件 |
| @xterm/addon-fit | ^0.10.0 | 自适应尺寸插件 |
| @xterm/addon-serialize | ^0.12.0 | 终端内容序列化插件 |

## 许可证

MIT License

## 相关项目

- [ipmitool](https://github.com/ipmitool/ipmitool) - IPMI 命令行工具
- [xterm.js](https://github.com/xtermjs/xterm.js) - 终端模拟器
- [node-pty](https://github.com/nicl/node-pty) - Node.js 伪终端
- [Electron](https://electronjs.org/) - 桌面应用框架
