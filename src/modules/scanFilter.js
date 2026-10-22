/**
 * 扫描结果的筛选与排序（纯函数）
 *
 * 从 renderer 里抽出来的原因：这些判定全是数据逻辑，可以直接单测；
 * 而 DOM 再渲染一遍很难在 node 环境下验证（testEnvironment = node，无 jsdom）。
 *
 * 排序稳定性：依赖 Array.prototype.sort 的稳定性（ES2019 起规范保证），
 * 相等项保持原始（探测完成）顺序，不会因为刷新而乱跳。
 */

/** 可排序的列 */
const SORT_KEYS = ['ip', 'latency', 'ports', 'arch', 'version', 'power', 'product'];

/** 快速筛选（chips） */
const QUICK_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'unadded', label: '未添加' },
  { key: 'on', label: '已开机' },
  { key: 'off', label: '已关机' },
  { key: 'failed', label: '验证失败' }
];

const QUICK_ALL = 'all';
const QUICK_UNADDED = 'unadded';
const QUICK_ON = 'on';
const QUICK_OFF = 'off';
const QUICK_FAILED = 'failed';

/**
 * 点分 IP → 数字数组；非法返回 null（排到末尾）
 * @param {string} ip
 * @returns {number[]|null}
 */
function parseIp(ip) {
  if (typeof ip !== 'string') return null;

  const parts = ip.split('.');
  if (parts.length !== 4) return null;

  const nums = parts.map(part => Number(part));
  if (nums.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;

  return nums;
}

/**
 * IP 按**数值**比较
 * 字符串比较会把 192.168.60.9 排到 192.168.60.10 后面
 */
function compareIp(a, b) {
  const pa = parseIp(a);
  const pb = parseIp(b);

  if (!pa && !pb) return 0;
  if (!pa) return 1;
  if (!pb) return -1;

  for (let i = 0; i < 4; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/**
 * 版本号 → 数字数组（按点切分，非数字段落记 0）
 * `2.00.00.05` → [2, 0, 0, 5]
 */
function parseVersion(version) {
  if (typeof version !== 'string' || version.trim() === '') return null;

  const parts = version.trim().split('.');
  const nums = parts.map(part => {
    const n = parseInt(part, 10);
    return Number.isFinite(n) ? n : 0;
  });

  return nums.length ? nums : null;
}

/** 版本号按段数值比较（2.0.0.10 > 2.0.0.9，字符串比较会反） */
function compareVersion(a, b) {
  const va = parseVersion(a);
  const vb = parseVersion(b);

  if (!va && !vb) return 0;
  if (!va) return 1;
  if (!vb) return -1;

  const len = Math.max(va.length, vb.length);
  for (let i = 0; i < len; i++) {
    const na = va[i] === undefined ? 0 : va[i];
    const nb = vb[i] === undefined ? 0 : vb[i];
    if (na !== nb) return na - nb;
  }
  return 0;
}

/** 开放端口数（端口列排序用：开放的越多越"完整"） */
function openPortCount(ports) {
  if (!ports || typeof ports !== 'object') return 0;
  return Object.values(ports).filter(Boolean).length;
}

/** 电源状态排序权重：开机在前，未知在最后 */
function powerRank(state) {
  if (state === 'on') return 0;
  if (state === 'off') return 1;
  return 2;
}

/**
 * 按列比较两条结果
 * @returns {number} 负数表示 a 在前
 */
function compareField(a, b, key) {
  switch (key) {
    case 'ip':
      return compareIp(a.ip, b.ip);
    case 'latency':
      return (Number(a.latency) || 0) - (Number(b.latency) || 0);
    case 'ports':
      return openPortCount(a.ports) - openPortCount(b.ports);
    case 'arch':
      return String(a.template || '').localeCompare(String(b.template || ''), 'en');
    case 'version':
      return compareVersion(a.bmcVersion, b.bmcVersion);
    case 'power':
      return powerRank(a.powerState) - powerRank(b.powerState);
    case 'product':
      return String(a.productName || '').localeCompare(String(b.productName || ''), 'en');
    default:
      return 0;
  }
}

/**
 * 排序（返回新数组）
 * 未知状态（无版本 / 无电源 / 无产品）统一排在末尾：升序降序都放末尾，
 * 否则降序会把「取不到值」的设备顶到最前面，误导用户。
 *
 * @param {object[]} results
 * @param {object} options { key: 'ip'|'latency'|..., dir: 'asc'|'desc' }
 */
function sortScanResults(results, options = {}) {
  const list = Array.isArray(results) ? results.slice() : [];
  const key = SORT_KEYS.includes(options.key) ? options.key : 'ip';
  const dir = options.dir === 'desc' ? -1 : 1;

  list.sort((a, b) => {
    const raw = compareField(a, b, key);

    // 「缺失值」判定：只在支持缺失的列上生效
    if (key === 'version') {
      const missA = !parseVersion(a.bmcVersion);
      const missB = !parseVersion(b.bmcVersion);
      if (missA !== missB) return missA ? 1 : -1;
    }
    if (key === 'power') {
      const missA = powerRank(a.powerState) === 2;
      const missB = powerRank(b.powerState) === 2;
      if (missA !== missB) return missA ? 1 : -1;
    }
    if (key === 'product') {
      const missA = !a.productName;
      const missB = !b.productName;
      if (missA !== missB) return missA ? 1 : -1;
    }
    if (key === 'arch') {
      const missA = !a.template;
      const missB = !b.template;
      if (missA !== missB) return missA ? 1 : -1;
    }

    return raw * dir;
  });

  return list;
}

/** 搜索用文本：IP / 架构 / 版本 / 产品名 拼一起，统一小写 */
function buildSearchText(entry) {
  if (!entry || typeof entry !== 'object') return '';
  return [entry.ip, entry.template, entry.bmcVersion, entry.productName]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/**
 * 按关键词过滤（大小写不敏感，匹配 IP / 架构 / 版本 / 产品名）
 */
function filterByKeyword(results, keyword) {
  const list = Array.isArray(results) ? results : [];
  const kw = String(keyword == null ? '' : keyword).trim().toLowerCase();
  if (!kw) return list.slice();

  return list.filter(entry => buildSearchText(entry).includes(kw));
}

/**
 * 按快速筛选（chips）过滤
 * @param {string} quick 'all' | 'unadded' | 'on' | 'off' | 'failed'
 */
function filterByQuick(results, quick, existingIPs = []) {
  const list = Array.isArray(results) ? results : [];

  switch (quick) {
    case QUICK_UNADDED:
      return list.filter(entry => !existingIPs.includes(entry.ip));
    case QUICK_ON:
      return list.filter(entry => entry.powerState === 'on');
    case QUICK_OFF:
      return list.filter(entry => entry.powerState === 'off');
    case QUICK_FAILED:
      return list.filter(entry => !entry.template);
    default:
      return list.slice();
  }
}

/**
 * 完整筛选（关键词 + chips + 隐藏已添加）
 *
 * @param {object[]} results
 * @param {object} options { keyword, quick, hideExisting, existingIPs }
 */
function filterScanResults(results, options = {}) {
  const existingIPs = options.existingIPs || [];

  let list = filterByKeyword(results, options.keyword);
  list = filterByQuick(list, options.quick, existingIPs);

  if (options.hideExisting === true) {
    list = list.filter(entry => !existingIPs.includes(entry.ip));
  }

  return list;
}

/**
 * 视图 = 过滤 + 排序
 * @param {object[]} results
 * @param {object} options { keyword, quick, hideExisting, existingIPs, sortKey, sortDir }
 */
function applyScanView(results, options = {}) {
  const filtered = filterScanResults(results, options);
  return sortScanResults(filtered, { key: options.sortKey, dir: options.sortDir });
}

module.exports = {
  SORT_KEYS,
  QUICK_FILTERS,
  QUICK_ALL,
  QUICK_UNADDED,
  QUICK_ON,
  QUICK_OFF,
  QUICK_FAILED,
  parseIp,
  compareIp,
  parseVersion,
  compareVersion,
  openPortCount,
  powerRank,
  compareField,
  sortScanResults,
  buildSearchText,
  filterByKeyword,
  filterByQuick,
  filterScanResults,
  applyScanView
};
