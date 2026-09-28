/**
 * ipmitool 环境模块
 *
 * 统一主进程与渲染进程的 ipmitool 依赖，避免多处重复实现：
 * - resolveIpmiToolPath(): ipmitool.exe 路径解析（打包/开发环境通用）
 * - buildArgs(server): 连接参数构建
 * - tokenizeCommand(input): 命令行分词（支持引号，替代裸 split(' ')）
 */

const path = require('path');
const fs = require('fs');

/**
 * 构建 ipmitool 连接参数
 */
function buildArgs(server) {
  const args = [];
  if (server.host) args.push('-H', server.host);
  if (server.port && server.port !== 623) args.push('-p', String(server.port));
  if (server.username) args.push('-U', server.username);
  if (server.password) args.push('-P', server.password);
  if (server.interface) args.push('-I', server.interface);
  if (server.cipherSuite) args.push('-C', String(server.cipherSuite));
  if (server.privilegeLevel) args.push('-L', server.privilegeLevel);
  return args;
}

/**
 * ipmitool.exe 候选路径（按优先级排序）
 * 1. resources/bin            —— 构建脚本复制的位置
 * 2. resources/app.asar.unpacked/bin —— electron-builder asarUnpack 位置
 * 3. exe 同级 bin / exe 同目录
 * 4. 开发模式：项目根 bin/
 */
function getCandidatePaths() {
  const candidates = [];

  const resourcesPath = process.resourcesPath;
  if (resourcesPath) {
    candidates.push(path.join(resourcesPath, 'bin', 'ipmitool.exe'));
    candidates.push(path.join(resourcesPath, 'app.asar.unpacked', 'bin', 'ipmitool.exe'));
  }

  const exeDir = process.execPath ? path.dirname(process.execPath) : null;
  if (exeDir) {
    candidates.push(path.join(exeDir, 'resources', 'bin', 'ipmitool.exe'));
    candidates.push(path.join(exeDir, 'resources', 'app.asar.unpacked', 'bin', 'ipmitool.exe'));
    candidates.push(path.join(exeDir, 'bin', 'ipmitool.exe'));
    candidates.push(path.join(exeDir, 'ipmitool.exe'));
  }

  // 开发模式：src/modules -> 项目根/bin
  candidates.push(path.join(__dirname, '..', '..', 'bin', 'ipmitool.exe'));

  return candidates;
}

/**
 * 解析 ipmitool.exe 实际路径
 * @returns {string|null} 找到返回绝对路径，未找到返回 null
 */
function resolveIpmiToolPath() {
  for (const candidate of getCandidatePaths()) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch (e) {
      // 忽略非法路径，继续尝试下一个
    }
  }
  return null;
}

/**
 * 命令行分词，支持单/双引号包裹的参数
 * 例: fru write 0 "Board Mfg" 'a b' -> ['fru', 'write', '0', 'Board Mfg', 'a b']
 */
function tokenizeCommand(input) {
  const tokens = [];
  if (!input) return tokens;

  let current = '';
  let quote = null;
  let hasToken = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      hasToken = true;
    } else if (ch === ' ' || ch === '\t') {
      if (hasToken || current) {
        tokens.push(current);
        current = '';
        hasToken = false;
      }
    } else {
      current += ch;
      hasToken = true;
    }
  }

  if (hasToken || current) tokens.push(current);
  return tokens;
}

module.exports = {
  buildArgs,
  getCandidatePaths,
  resolveIpmiToolPath,
  tokenizeCommand
};
