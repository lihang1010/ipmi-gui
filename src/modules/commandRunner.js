/**
 * 命令执行模块
 */

const { ipcRenderer } = require('electron');
const { safeAlert } = require('./modal');
const { formatCommandOutput } = require('./utils');

/**
 * 执行 IPMI 命令
 *
 * @param {string} command 命令串（会被 tokenizeCommand 分词，支持引号）
 * @param {string} outputId 展示输出的元素 id
 * @param {object} currentServer 服务器配置
 * @param {string[]} [args] 附加 argv，拼在 command 分词之后，原样传给 spawn
 *        —— 传含空格 / 引号 / 特殊字符的值时走这里，不要拼进 command
 */
async function executeCommand(command, outputId, currentServer, args) {
  if (!currentServer) {
    await safeAlert('请先选择服务器');
    return;
  }

  const el = document.getElementById(outputId);
  if (el) {
    el.textContent = '执行中...';
    el.style.opacity = '0.5';
  }

  try {
    const result = await ipcRenderer.invoke('ipmi:execute', currentServer, command, args || []);
    if (el) {
      el.textContent = formatCommandOutput(result);
      el.style.opacity = '1';
    }
    return result;
  } catch (err) {
    if (el) {
      el.textContent = '执行异常: ' + err.message;
      el.style.opacity = '1';
    }
    return { code: -1, stdout: '', stderr: err.message };
  }
}

/**
 * 执行电源命令
 */
function executePower(action, currentServer) {
  return executeCommand('power ' + action, 'output-power', currentServer);
}

/**
 * 执行传感器命令
 */
function executeSensor(currentServer) {
  return executeCommand('sdr list', 'output-sensor', currentServer);
}

/**
 * 执行原始命令
 */
async function executeRawCommand(currentServer) {
  const input = document.getElementById('raw-command');
  const command = input ? input.value.trim() : '';
  if (!command) {
    await safeAlert('请输入命令');
    return;
  }
  return executeCommand(command, 'output-raw', currentServer);
}

module.exports = {
  executeCommand,
  executePower,
  executeSensor,
  executeRawCommand
};
