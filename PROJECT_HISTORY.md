# IPMI 管理工具 - 项目开发历程

## 一、项目背景

### 1.1 需求起源

用户需要在 Windows 下图形化操作所有 IPMI 命令，基于现有的 `ipmitool.exe` 工具进行封装。

### 1.2 核心需求

| 需求 | 说明 |
|------|------|
| 图形化界面 | 替代命令行，降低使用门槛 |
| SOL 远程终端 | 支持交互式远程操作 |
| 多服务器管理 | 保存多个服务器配置 |
| 日志功能 | SOL 输出可保存到文件 |
| 易于部署 | 打包后可在其他电脑使用 |

---

## 二、技术选型历程

### 2.1 第一阶段：Python + tkinter

**选择理由**：Python 内置 tkinter，无需额外依赖，开发快速。

**实现功能**：
- 8 个功能模块（电源/传感器/FRU/SEL/用户/网络/SOL/原始命令）
- 多服务器配置管理（JSON 存储）
- SOL 新窗口运行

**遇到的问题**：

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| SOL 需要新开窗口 | Python 无法在 tkinter 内嵌入真正的终端 | 改用新窗口 |
| PowerShell 日志录制失败 | Start-Transcript 干扰 ipmitool 执行 | 移除 PowerShell |
| pywinpty API 变更 | winpty.Pty → winpty.PTY | 修正类名 |
| pywinpty 字符串类型错误 | pty.write() 需要字符串不是 bytes | 统一使用字符串 |
| pywinpty 交互失败 | tcgetattr: Inappropriate ioctl for device | 放弃内嵌终端 |

**最终结论**：Python + tkinter 无法实现可靠的内嵌终端，SOL 功能只能用新窗口方式。

### 2.2 第二阶段：Node.js + Electron

**选择理由**：
- `node-pty` + `xterm.js` 是 VS Code 使用的终端方案，成熟可靠
- Electron 提供现代化 UI 能力
- 内置终端录制功能

**实现功能**：
- 内嵌 xterm.js 终端，SOL 在 GUI 内运行
- node-pty 创建伪终端，支持交互式操作
- SerializeAddon 录制终端内容
- 现代化深色主题 UI

---

## 三、核心功能实现

### 3.1 SOL 终端方案对比

| 方案 | 技术 | 优点 | 缺点 | 结论 |
|------|------|------|------|------|
| PowerShell Start-Transcript | PowerShell | 简单 | 干扰 ipmitool 执行 | ❌ 放弃 |
| 新窗口 + bat | cmd | 稳定可靠 | 无法内嵌 GUI | ✅ Python 版使用 |
| pywinpty | Python | 理论可行 | API 不稳定，交互失败 | ❌ 放弃 |
| node-pty + xterm.js | Node.js | 成熟稳定，VS Code 同款 | 需要 Electron | ✅ 最终方案 |

### 3.2 SOL 日志保存方案对比

| 方案 | 实现方式 | 可靠性 | 采用 |
|------|----------|--------|------|
| PowerShell 录制 | Start-Transcript | 低 | ❌ |
| GUI 内录制 | SerializeAddon | 高 | ✅ |
| 手动复制 | 用户操作 | 中 | 作为备选 |

### 3.3 打包方案演进

| 阶段 | 方案 | 问题 |
|------|------|------|
| 初期 | electron-builder extraResources | 绝对路径不被识别 |
| 中期 | asarUnpack 解压 | 配置不生效 |
| 最终 | 构建脚本手动复制 | ✅ 可靠 |

**当时方案（v1.0）**：
```powershell
# 构建流程
1. electron-builder --dir (创建解压版)
2. 复制 ipmitool 到 resources/bin
3. 用户直接使用或压缩分发
```

> **v1.1 起已回归 electron-builder 配置**：`extraResources` 把 `bin/` 复制到
> `resources/bin`，构建脚本只做存在性校验（不再手动 `Copy-Item`）。
> 交付形态也从「解压即用」扩展为 NSIS 安装包 + 免安装版 + 自动更新清单，
> 详见 `README.md` 的「构建发布」与 `AGENTS.md` 的「自动更新」章节。
> 上面这段保留下来，是因为它解释了为什么 `resolveIpmiToolPath()` 要按
> 「resourcesPath → app.asar.unpacked → exe 同级」多级回退。

---

## 四、UI/UX 优化历程

### 4.1 初始版本

- 基础 Bootstrap 风格
- 无动画过渡
- 无加载状态
- 原生标题栏

### 4.2 优化后版本

**CSS 设计系统**：
- 60+ CSS 变量（颜色/间距/圆角/阴影）
- 深色主题配色方案
- 按钮四态（hover/active/loading/disabled）
- 对话框毛玻璃 + 滑入动画
- 面板切换 fadeIn 过渡

**交互改进**：
- 状态指示器（connected/error/connecting/idle）
- 按钮 loading spinner
- 命令执行时输出区域 opacity 动画
- 对话框自动聚焦
- 按钮 tooltip 提示

**键盘快捷键**：
- `Ctrl+R` 刷新当前面板
- `Ctrl+L` 清屏当前面板
- `Ctrl+N` 添加新服务器
- `Esc` 关闭对话框

---

## 五、关键决策记录

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 技术栈 | Node.js + Electron | 终端模拟更可靠 |
| SOL 方案 | xterm.js + node-pty | VS Code 验证过的方案 |
| 日志保存 | GUI 内录制 | 不干扰 ipmitool |
| 停止 SOL | deactivate 命令 | 正确的断开方式 |
| 打包方式 | 解压即用 | 无需安装，便于分发 |
| UI 风格 | 深色主题 | 专业工具风格 |

---

## 六、项目最终状态

### 6.1 技术栈

| 组件 | 技术 |
|------|------|
| 框架 | Electron 28 |
| 终端 | node-pty + xterm.js |
| UI | HTML + CSS + JavaScript |
| 打包 | electron-builder |
| 语言 | Node.js |

### 6.2 功能清单

| 模块 | 功能 | 状态 |
|------|------|------|
| SOL 终端 | 内嵌终端，交互操作；多标签 + 平铺 | ✅ |
| 电源管理 | 开机/关机/重启/状态 | ✅ |
| 传感器 | sdr list 查看温度/风扇/电压 | ✅ |
| FRU | 字段表查看 + 逐字段编辑 + 整区刷写 | ✅ |
| 事件日志 | SEL 查看（`sel list`） | ✅ |
| 用户管理 | 用户列表查看（增删改走「原始命令」） | ✅ |
| 网络配置 | `lan print` 查看（修改走「原始命令」） | ✅ |
| 原始命令 | 执行任意命令 | ✅ |
| 配置导入导出 | JSON 格式 | ✅ |
| 日志目录设置 | 可自定义保存位置 | ✅ |
| SOL 日志录制 | 自动保存 + 手动导出 | ✅ |
| 网络扫描 | 网段发现 + 凭据验证 + BMC 版本 | ✅ |
| 主题 / 自动更新 | 亮暗切换、后台更新 | ✅ |

### 6.3 部署方式（当前形态）

```
安装版：ipmi-gui-<ver>-win-x64.exe（NSIS，支持自动更新）
免安装：ipmi-gui-<ver>-portable.exe
绿色目录：dist/win-unpacked/
├── IPMI管理工具.exe（管理员权限运行）
└── resources/
    ├── bin/ipmitool.exe + Cygwin DLL
    └── app.asar
```

---

## 七、经验教训

### 7.1 技术选型

- Python + tkinter 适合简单 GUI，但终端模拟能力弱
- Electron + node-pty 是 Windows 下终端模拟的最佳方案
- 不要重复造轮子，选择经过验证的方案

### 7.2 打包部署

- electron-builder 的 extraResources 在某些环境下不可靠
- 手动复制 + 构建脚本是更可靠的方案
- 解压即用比安装包更适合内部工具

### 7.3 UI/UX

- 深色主题更适合专业工具
- 加载状态和错误反馈很重要
- 键盘快捷键提升效率
- CSS 变量让主题化更灵活

### 7.4 SOL 功能

- SOL 是服务器端命令，从哪里启动都能 deactivate
- 按钮应始终可用，通过反馈告知结果
- 日志录制不应干扰正常交互

---

## 八、后续可扩展方向

| 方向 | 说明 | 状态 |
|------|------|------|
| 批量操作 | 同时管理多台服务器 | 待做 |
| 命令收藏 | 常用命令快捷执行 | ✅ 已实现（含分类与导入导出） |
| 连接测试 | 一键测试服务器可达性 | ✅ 已实现 |
| 主题切换 | 支持亮色/暗色主题 | ✅ 已实现 |
| 国际化 | 支持中英文切换 | 待做 |
| 自动更新 | 检查版本更新 | ✅ 已实现（GitHub Releases） |
| 便携版打包 | 自动生成分发包 | ✅ 已实现（portable.exe） |

> 完整的后续规划见 `FEATURES.md`（含优先级与工时估算）。

## 九、v1.1.x 版本演进（2026-07 ~ 2026-10）

`PROJECT_HISTORY.md` 前八节记录的是 v1.0 的选型与决策，以下补记后续实际交付内容。

| 版本 | 主要变化 |
|------|----------|
| v1.0.x | FRU 面板改为结构化字段表 + 字段级编辑（预览 + 二进制校准两阶段）；收藏夹分类与导入导出；扫描结果增加 BMC 固件版本列；CIDR 支持 /16~/30 |
| v1.1.0 | 支持自动更新（GitHub Releases）与顶栏版本号；亮/暗主题一键切换；FRU 支持 bin 整区刷写（写前自校验 + 备份 + 回读比对）；收敛构建入口并补 CI 发布流水线 |
| v1.1.1 | SOL 多标签平铺显示（修复输入串台、PTY 尺寸不同步）；SOL 日志自动保存；Ping 预探测改为默认关闭；修复网络扫描漏报；窗口初始尺寸按屏幕工作区自适应 |

### 踩坑沉淀（已写入 AGENTS.md）

- `fru edit` 成功时退出码可能为 0 或 1，**只能靠 `Updating Field` 判定**；等长写入不打印 `Done.`
- `fru write` 退出码恒为 0（连文件不存在都是 0），只能看 `Size to Write` + 回读比对
- `-v` 必须写在 `fru` 之前，`fru print -v <id>` 会静默无输出
- Ping 单包 + 硬超时过短会在高并发下把在线设备判死，必须 2 包 + `count*timeout+2000`
- `build.ps1` 必须保留 UTF-8 BOM（否则 PowerShell 5.1 按 GBK 解码吃掉引号）

---

*文档生成时间：2026-07-15（v1.0）*
*最后更新：2026-10-22（v1.1.1）*
