/**
 * 命令执行模块
 */

const { ipcRenderer } = require('electron');
const { safeAlert } = require('./modal');
const { showStatus } = require('./utils');

/**
 * 执行 IPMI 命令
 */
async function executeCommand(command, outputId, currentServer) {
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
    const result = await ipcRenderer.invoke('ipmi:execute', currentServer, command);
    if (el) {
      el.textContent = result.code === 0 ? (result.stdout || '(无输出)') : '错误:\n' + result.stderr;
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
