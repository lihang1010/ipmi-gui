/**
 * 工具函数模块
 */

/**
 * HTML 转义 (纯函数实现)
 */
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

/**
 * 显示状态指示器
 */
function showStatus(state = 'idle', text = '') {
  const badge = document.getElementById('status-text');
  if (!badge) return;
  badge.className = 'status-badge';
  if (state === 'connected') badge.classList.add('connected');
  else if (state === 'error') badge.classList.add('error');

  // 文本走内层元素，长度过长时由 CSS 省略号截断（不再撑宽工具栏）
  const label = badge.querySelector ? badge.querySelector('.badge-text') : null;
  if (label) label.textContent = text || '未连接';
  else badge.textContent = text || '未连接';
}

/**
 * 清空输出区域
 */
function clearOutput(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const defaults = {
    'output-power': '点击按钮执行命令...',
    'output-sensor': '点击刷新获取传感器数据...',
    'output-sel': '点击刷新获取事件日志...',
    'output-user': '点击刷新获取用户列表...',
    'output-network': '点击刷新获取网络配置...',
    'output-raw': '输入命令并点击执行...'
  };
  el.textContent = defaults[elementId] || '';
}

/**
 * 格式化 ipmi:execute 的返回结果用于展示
 *
 * 注意：ipmitool 的 help / usage（如 `help`、`sdr help`）会把帮助文本写到
 * stderr，且退出码为 0 —— 因此两个流都要看，只取 stdout 会显示成"无输出"。
 *
 * @param {{code:number, stdout:string, stderr:string}} result
 * @returns {string} 展示文本
 */
function formatCommandOutput(result) {
  const stdout = (result && result.stdout) || '';
  const stderr = (result && result.stderr) || '';

  if (!result || result.code !== 0) {
    return '错误:\n' + (stderr || stdout || '未知错误');
  }
  return stdout || stderr || '(无输出)';
}

/**
 * 验证 IP 地址格式
 */
function isValidIP(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every(p => {
    const num = parseInt(p, 10);
    return !isNaN(num) && num >= 0 && num <= 255 && p === String(num);
  });
}

module.exports = {
  escapeHtml,
  showStatus,
  clearOutput,
  isValidIP,
  formatCommandOutput
};
