# IPMI 管理工具 - 测试报告

**测试时间**: 2026-10-22
**测试环境**: Jest 30.4.2 / Node.js / testEnvironment = node（非 jsdom）
**被测版本**: 1.1.1

---

## 一、单元测试结果

**测试套件**: 21 个 | **测试用例**: 563 个 | **全部通过** | 耗时约 8.8s

| 测试文件 | 用例数 | 覆盖对象 | 状态 |
|----------|--------|----------|------|
| `bmcVersion.test.js` | 18 | `mc info` 版本号解析（AMI / openUBMC） | PASS |
| `command.test.js` | 21 | 命令执行与输出格式化 | PASS |
| `commandRunner.test.js` | 17 | `executeCommand` / Power / Sensor / Raw | PASS |
| `config.test.js` | 18 | 配置导入导出与字段容错 | PASS |
| `configStore.test.js` | 7 | `%APPDATA%` 配置读写（唯一实现） | PASS |
| `credentials.test.js` | 11 | 凭据模板单一来源 | PASS |
| `favorites.test.js` | 60 | 收藏夹 CRUD / 分类 / 导入导出 | PASS |
| `fru.test.js` | 80 | FRU 镜像解析 / index 映射 / 写入判定 / 整区刷写 | PASS |
| `fruView.test.js` | 40 | FRU 面板渲染与写入→回读校验时序 | PASS |
| `ipmiTool.test.js` | 16 | 路径解析 / `buildArgs` / `tokenizeCommand` | PASS |
| `main.test.js` | 37 | 主进程逻辑（`buildArgs`、SOL 生命周期相关纯逻辑） | PASS |
| `modal.test.js` | 26 | `safeAlert` / `safeConfirm` | PASS |
| `networkScanner.test.js` | 47 | CIDR 展开 / Ping / 端口 / IPMI 验证 | PASS |
| `parser.test.js` | 18 | 文本输出解析 | PASS |
| `renderer.test.js` | 66 | 渲染层逻辑（DOM 用注入桩） | PASS |
| `scanResultView.test.js` | 18 | 扫描结果行渲染 + 转义 + 事件委托 | PASS |
| `templates.test.js` | 6 | 服务器模板填充 | PASS |
| `theme.test.js` | 9 | 主题归一化 / 切换 / 终端配色 | PASS |
| `ui.test.js` | 19 | 界面通用行为 | PASS |
| `updateStatus.test.js` | 9 | 更新状态文案 / 可点击性 / 可见性 | PASS |
| `utils.test.js` | 20 | `escapeHtml` / `isValidIP` / 输出处理 | PASS |
| **总计** | **563** | 21 套件 | **ALL PASS** |

> 上一版报告（275 用例 / 13 套件）对应 v1.0 时期的代码，FRU 编辑、主题、自动更新、
> 凭据与版本号解析等模块在当时还不存在，故数字已整体失效。

---

## 二、代码覆盖率

统计口径：Jest 默认只统计**被测试 require 到的文件**，因此 `main.js` 不在下表内
（其可测逻辑已抽到 `ipmiTool.js` / `windowSize.js` / `networkScanner.js`，由对应模块测试覆盖；
IPC 接线本身属集成测试范畴，见第五节）。

| 文件 | 语句覆盖 | 分支覆盖 | 函数覆盖 | 行覆盖 |
|------|----------|----------|----------|--------|
| `src/renderer.js` | 42.08% | 23.10% | 30.90% | 48.82% |
| `src/modules/bmcVersion.js` | 100% | 91.66% | 100% | 100% |
| `src/modules/commandRunner.js` | 100% | 71.42% | 100% | 100% |
| `src/modules/credentials.js` | 100% | 83.33% | 100% | 100% |
| `src/modules/favorites.js` | 92.79% | 82.03% | 89.74% | 94.92% |
| `src/modules/fru.js` | 97.53% | 92.54% | 100% | 98.55% |
| `src/modules/fruView.js` | 79.17% | 64.83% | 82.53% | 79.22% |
| `src/modules/ipmiTool.js` | 96.87% | 95.65% | 100% | 96.15% |
| `src/modules/modal.js` | 67.74% | 33.33% | 40% | 76.92% |
| `src/modules/networkScanner.js` | 84.54% | 54.46% | 87.14% | 87.81% |
| `src/modules/scanResultView.js` | 100% | 100% | 100% | 100% |
| `src/modules/templates.js` | 14.81% | 0% | 0% | 17.39% |
| `src/modules/theme.js` | 100% | 100% | 100% | 100% |
| `src/modules/updateStatus.js` | 100% | 100% | 100% | 100% |
| `src/modules/utils.js` | 46.87% | 52.38% | 71.42% | 52% |
| `src/modules/windowSize.js` | 100% | 100% | 100% | 100% |
| `src/modules/*` 小计 | **86.11%** | **72.79%** | **87.16%** | **87.58%** |
| **汇总（含 renderer.js）** | **70.84%** | **58.52%** | **65.58%** | **74.39%** |

### 未覆盖代码分析

| 文件 | 未覆盖原因 |
|------|------------|
| `renderer.js` (42%) | 主要是 DOM 编排与事件回调：面板切换、服务器对话框、扫描结果操作、SOL 标签渲染。testEnvironment 为 node，DOM 靠手工 mock，只能覆盖抽出来的纯逻辑与部分时序 |
| `templates.js` (14.81%) | `applyTemplate()` / `updateServerNameFromTemplate()` 强依赖 `document.getElementById`，node 环境下无 DOM |
| `utils.js` (46.87%) | 已覆盖 `escapeHtml` / `isValidIP`；`showStatus` / `clearOutput` 依赖 DOM |
| `modal.js` (67.74%) | `addEventListener` 内的关闭回调与 Escape 分支未被触发 |
| `fruView.js` (79.17%) | 对话框内的输入校验、刷写确认流程的部分分支需要真实 DOM 事件 |
| `networkScanner.js` (84.54%) | `getLocalNetwork()`、超时/异常分支依赖真实网卡与网络 |

> 覆盖率方向：**不给 renderer.js 设门槛**（它天然是 DOM 编排层），
> 新功能一律把判定逻辑抽到 `src/modules/*.js` 再配单测——目前 `fru.js`（97.53%）、
> `theme.js`、`updateStatus.js`、`windowSize.js`、`scanResultView.js`（均 100%）就是按这个思路做的。

---

## 三、Mock 基础设施

| 文件 | 用途 |
|------|------|
| `__tests__/__mocks__/electron.js` | Electron API（app / BrowserWindow / ipcMain / ipcRenderer / dialog） |
| `__tests__/__mocks__/node-pty.js` | PTY 进程（spawn / onData / onExit / resize / kill） |
| `__tests__/__mocks__/xterm.js` | Terminal |
| `__tests__/__mocks__/xterm-addon-fit.js` | FitAddon |
| `__tests__/__mocks__/xterm-addon-serialize.js` | SerializeAddon |
| `jest.config.js` | 上述模块的 `moduleNameMapper` + `testEnvironment: node` |

Node 内置模块（`dgram` / `net` / `child_process` / `fs` / `path` / `os`）在各测试文件内用
`jest.mock()` 行内 mock。`fullScan` 测试单独设 30s 超时。

---

## 四、关键回归用例（踩坑固定下来的）

| 场景 | 用例位置 | 固定的行为 |
|------|----------|------------|
| `-v` 必须写在 `fru` 之前 | `fruView.test.js` | 写成 `fru print -v <id>` 会静默无输出 |
| `fru print` 跳过空字段导致 index 错位 | `fru.test.js` | 按字段标签反查 `FRU_SECTIONS`，不按行号 |
| `fru edit` 等长写入退出码 0、变长退出码 1 | `fru.test.js` | 只认 `Updating Field`，不认退出码，也不要求 `Done.` |
| `fru write` 退出码恒为 0 | `fru.test.js` | 只看 `Size to Write == Fru Size`，成功与否靠回读逐字节比对 |
| Ping 单包 + 硬超时过短会误杀在线设备 | `networkScanner.test.js` | 每台 2 个包，硬超时 `count*timeout+2000` |
| 扫描结果属远端可控数据 | `scanResultView.test.js` | 渲染前必须 `escapeHtml` |
| 默认窗口宽度不足挤掉顶栏徽标 | `renderer.test.js` | `document` 桩必须带 `documentElement`；窗口尺寸走 `windowSize.js` |

> **mock 测不出 ipmitool 的参数形式问题**（例如 `-v` 的位置、`fru edit` 的 index 语义）。
> 这类改动必须真机跑一遍，单测只负责把已确认的契约钉死。

---

## 五、尚未自动化（需人工 / 集成测试）

| 项目 | 说明 |
|------|------|
| 主进程 IPC 全链路 | `ipmi:execute` / `sol:*` / `scan:*` 的真实 spawn 与事件回流 |
| SOL 交互 | 需要真实 BMC 与 node-pty，属 E2E 范畴 |
| FRU 写入 | 会改设备状态，只能在指定测试机上人工验证 |
| 自动更新 | 依赖 GitHub Releases 与已打包产物，开发模式直接 `skipped` |

---

## 六、建议

### 短期

1. 为 `templates.js` / `utils.js` 的 DOM 函数补 jsdom 子环境测试（`@jest-environment jsdom` 单文件声明即可，不必改全局配置）
2. `modal.js` 补事件触发用例（点击按钮、Esc）

### 中期

3. 引入覆盖率门槛（`coverageThreshold`），只对 `src/modules/` 设阈值（建议 statements 80%），**不含 renderer.js**
4. 为 `main.js` 的 IPC 接线补集成测试
5. 用 Playwright 对主要面板做冒烟 E2E

---

## 七、HTML 覆盖率报告

每次 `npm run test:coverage` 会生成：

```
coverage/index.html               — 主报告页面
coverage/lcov-report/index.html   — LCOV 格式报告
coverage/lcov.info                — LCOV 数据文件（供 CI 工具集成）
coverage/coverage-summary.json    — 机器可读汇总（可入 CI 校验）
```

`coverage/` 已被 `.gitignore` 忽略，不进版本库。

---

*报告生成时间: 2026-10-22*
