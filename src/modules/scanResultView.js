/**
 * 扫描结果行渲染模块（纯函数，便于单元测试）
 *
 * 安全约定：所有来自被扫描设备 / 用户输入的字段（ip、template、
 * productName、productSource、verifyHint、端口标签）必须经过 escapeHtml，
 * 避免远端可控数据注入 HTML（nodeIntegration 下可升级为 RCE）。
 */

const { escapeHtml } = require('./utils');

/**
 * 端口键 → 紧凑徽章文案
 *
 * 列表里必须单行排下 4 个端口：`TCP:623` 这种写法会换行，把行高从 26px 撑到 48px。
 * 全称放在 title 里，鼠标悬停仍能看到原始标签。
 */
const PORT_SHORT_LABELS = {
  'UDP:623': 'U623',
  'TCP:623': 'T623',
  'TCP:80': 'T80',
  'TCP:443': 'T443'
};

/** 协议分类，供徽章按协议分色（阶段 3） */
const PORT_PROTO = {
  'UDP:623': 'udp',
  'TCP:623': 'tcp',
  'TCP:80': 'web',
  'TCP:443': 'web'
};

/**
 * 通过验证的模板 → 徽章配色 class
 * 走白名单：模板名来自凭据配置，但一律不拼进 class
 */
const TEMPLATE_CLASSES = {
  ami: 'tpl-ami',
  openubmc: 'tpl-openubmc',
  onetree: 'tpl-onetree'
};

/**
 * 电源状态 → 文案与 class（白名单，非拼接）
 */
function describePowerState(powerState) {
  if (powerState === 'on') return { text: 'On', cls: ' on', title: '电源状态：开机' };
  if (powerState === 'off') return { text: 'Off', cls: ' off', title: '电源状态：关机' };
  return { text: '', cls: '', title: '电源状态未知（power status 未取到）' };
}

/**
 * 渲染单条扫描结果行
 *
 * 列顺序：勾选 | IP | 延迟 | 端口 | 架构 | 版本 | 电源 | 主板名/产品名 | 操作
 * 与 `index.html` 的 `#scan-result-header` 共用同一套 grid 模板（见 style.css）。
 *
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
  const powerState = typeof item === 'object' ? item.powerState : null;

  const exists = existingIPs.includes(ip);
  const checked = !exists && checkedIPs.includes(ip);

  const safeIp = escapeHtml(ip);
  const safeTemplate = escapeHtml(template || '');
  const safeProduct = escapeHtml(productName || '');

  // 验证徽章：模板彩色徽章 / 凭据错误提示 / 未验证
  let verifyBadge;
  if (template) {
    const templateClass = TEMPLATE_CLASSES[String(template).toLowerCase()] || '';
    verifyBadge = '<span class="scan-status new scan-template' + (templateClass ? ' ' + templateClass : '') +
      '" title="IPMI 验证通过，使用 ' + safeTemplate + ' 凭据">' + safeTemplate + '</span>';
  } else if (verifyHint) {
    const badgeText = verifyHintType === 'ami' ? 'AMI 凭据错误?' : '凭据错误?';
    verifyBadge = '<span class="scan-status warning" title="' + escapeHtml(verifyHint) + '">' + badgeText + '</span>';
  } else {
    verifyBadge = '<span class="scan-status unknown">未验证</span>';
  }

  // 架构（凭据模板 = BMC 代码架构）与版本号分两列，便于按版本排序/对比
  const versionCell = '<span class="scan-version" title="BMC 固件版本">' +
    escapeHtml(bmcVersion || '') + '</span>';

  // 端口徽章（仅显示开放端口），一律单行
  const portsHtml = ports
    ? Object.entries(ports)
        .filter(entry => entry[1])
        .map(entry => {
          const proto = PORT_PROTO[entry[0]] || 'tcp';
          const label = PORT_SHORT_LABELS[entry[0]] || entry[0];
          return '<span class="scan-port-badge proto-' + proto + '" title="' + escapeHtml(entry[0]) + '">' +
            escapeHtml(label) + '</span>';
        })
        .join('')
    : '';

  // 等宽列会把长产品名截断，title 里给全名 + 来源，悬停可看
  const productTitle = productName
    ? ' title="' + escapeHtml(productName + (productSource ? '（来源: ' + productSource + '）' : '')) + '"'
    : '';

  const power = describePowerState(powerState);
  const powerBadge = '<span class="scan-power' + power.cls + '" title="' + power.title + '">' +
    (power.text ? '<i class="scan-power-dot"></i>' + power.text : '') + '</span>';

  // 已存在的设备不再重复给「添加」按钮，直接显示只读状态
  const actionHtml = exists
    ? '<button class="btn btn-sm scan-add-btn" disabled title="已在服务器列表中">已添加</button>'
    : '<button class="btn btn-sm btn-primary scan-add-btn" data-ip="' + safeIp +
      '" data-template="' + safeTemplate + '" title="添加到服务器列表">添加</button>';

  return '' +
    '<div class="scan-result-item ' + (exists ? 'already-exists' : '') + '">' +
      '<input type="checkbox" class="scan-checkbox" value="' + safeIp + '"' + (exists ? ' disabled' : '') + (checked ? ' checked' : '') + '>' +
      '<span class="scan-ip" title="' + safeIp + '">' + safeIp + '</span>' +
      '<span class="scan-latency">' + escapeHtml(latency) + 'ms</span>' +
      '<span class="scan-ports">' + portsHtml + '</span>' +
      verifyBadge +
      versionCell +
      powerBadge +
      '<span class="scan-product"' + productTitle + '>' + safeProduct + '</span>' +
      '<div class="scan-actions">' + actionHtml + '</div>' +
    '</div>';
}

module.exports = {
  renderScanResultRow,
  describePowerState,
  PORT_SHORT_LABELS
};
