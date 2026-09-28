/**
 * 扫描结果行渲染模块（纯函数，便于单元测试）
 *
 * 安全约定：所有来自被扫描设备 / 用户输入的字段（ip、template、
 * productName、productSource、verifyHint、端口标签）必须经过 escapeHtml，
 * 避免远端可控数据注入 HTML（nodeIntegration 下可升级为 RCE）。
 */

const { escapeHtml } = require('./utils');

/**
 * 渲染单条扫描结果行
 * @param {object|string} item 扫描结果项
 * @param {object} options { existingIPs: string[], checkedIPs: string[] }
 * @returns {string} 行 HTML
 */
function renderScanResultRow(item, options = {}) {
  const existingIPs = options.existingIPs || [];
  const checkedIPs = options.checkedIPs || [];

  const ip = typeof item === 'string' ? item : item.ip;
  const latency = typeof item === 'object' ? item.latency : 0;
  const template = typeof item === 'object' ? item.template : null;
  const ports = typeof item === 'object' ? item.ports : null;
  const verifyHint = typeof item === 'object' ? item.verifyHint : null;
  const verifyHintType = typeof item === 'object' ? item.verifyHintType : null;
  const productName = typeof item === 'object' ? item.productName : null;
  const productSource = typeof item === 'object' ? item.productSource : null;
  const bmcVersion = typeof item === 'object' ? item.bmcVersion : null;

  const exists = existingIPs.includes(ip);
  const checked = !exists && checkedIPs.includes(ip);

  const safeIp = escapeHtml(ip);
  const safeTemplate = escapeHtml(template || '');
  const safeProduct = escapeHtml(productName || '');

  // 验证状态标签
  let verifyBadge;
  if (template) {
    verifyBadge = '<span class="scan-status new" title="IPMI 验证通过，使用 ' + safeTemplate + ' 凭据">' + safeTemplate + '</span>';
  } else if (verifyHint) {
    const badgeText = verifyHintType === 'ami' ? 'AMI 凭据错误?' : '凭据错误?';
    verifyBadge = '<span class="scan-status warning" title="' + escapeHtml(verifyHint) + '">' + badgeText + '</span>';
  } else {
    verifyBadge = '<span class="scan-status unknown">未验证</span>';
  }

  // 端口徽章（仅显示开放端口）
  const portsHtml = ports
    ? Object.entries(ports)
        .filter(entry => entry[1])
        .map(entry => '<span class="scan-port-badge">' + escapeHtml(entry[0]) + '</span>')
        .join('')
    : '';

  const productTitle = productName
    ? ' title="' + escapeHtml(productSource ? '来源: ' + productSource : '') + '"'
    : '';

  return '' +
    '<div class="scan-result-item ' + (exists ? 'already-exists' : '') + '">' +
      '<input type="checkbox" class="scan-checkbox" value="' + safeIp + '"' + (exists ? ' disabled' : '') + (checked ? ' checked' : '') + '>' +
      '<span class="scan-ip">' + safeIp + '</span>' +
      '<span class="scan-latency">' + escapeHtml(latency) + 'ms</span>' +
      '<span class="scan-ports">' + portsHtml + '</span>' +
      verifyBadge +
      '<span class="scan-status ' + (exists ? 'exists' : '') + '">' + (exists ? '已存在' : '') + '</span>' +
      '<span class="scan-version" title="BMC 固件版本">' + escapeHtml(bmcVersion || '') + '</span>' +
      '<span class="scan-product"' + productTitle + '>' + safeProduct + '</span>' +
      '<div class="scan-actions">' +
        '<button class="btn btn-sm btn-primary scan-add-btn" data-ip="' + safeIp + '" data-template="' + safeTemplate + '"' + (exists ? ' disabled' : '') + '>添加</button>' +
      '</div>' +
    '</div>';
}

module.exports = {
  renderScanResultRow
};
