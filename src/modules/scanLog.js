/**
 * 扫描日志模块
 *
 * 解决的问题：扫描漏掉某台设备时，界面上只有「它没出现」这一个信息，无法区分
 *   1. 地址根本没被扫（网段/CIDR 填错、超出展开上限）
 *   2. 端口没开（超时过小、设备禁 Ping 且用了预探测）
 *   3. 端口开但被过滤规则丢弃（只开了 TCP:80）
 *   4. 端口开、验证失败（凭据不是默认模板）
 * 日志把每台设备的判定链路逐条记下来，便于定位漏报。
 *
 * 设计要点：
 * - 条目结构 { time, level, ip, message }，time 为**相对扫描开始的毫秒数**，
 *   由扫描器生成（而不是渲染层收到 IPC 时打点），避免 IPC 延迟污染时间轴
 * - 无开放端口的地址默认不逐条记录（/16 会产生 6 万条），只在「详细日志」开启时记录
 * - 条目数有上限，超出后保留头部（阶段摘要）与尾部（最新），中间折叠并计数
 *
 * 安全约定：message / ip 可能含远端可控数据，渲染时必须走 textContent
 * 或 escapeHtml，不要直接拼 HTML。
 */

/** 日志级别（渲染层据此着色） */
const LOG_LEVELS = ['debug', 'info', 'ok', 'warn', 'error'];

/** 级别对应的定宽标签，保证文本导出后各列对齐 */
const LEVEL_LABELS = {
  debug: 'DEBUG',
  info: 'INFO ',
  ok: 'OK   ',
  warn: 'WARN ',
  error: 'ERROR'
};

/** 默认条目上限 */
const DEFAULT_MAX_ENTRIES = 4000;

/** 超限时保留的头部条数（阶段摘要集中在前部） */
const DEFAULT_KEEP_HEAD = 200;

/** 过滤模式：全部 / 仅告警与错误 */
const FILTER_ALL = 'all';
const FILTER_PROBLEM = 'problem';

function pad(value, width) {
  const str = String(value);
  return str.length >= width ? str : '0'.repeat(width - str.length) + str;
}

/**
 * 相对毫秒数 → mm:ss.mmm
 * @param {number|null} ms 相对时间；null 表示无意义（如折叠提示行）
 */
function formatOffset(ms) {
  if (ms === null || ms === undefined || isNaN(Number(ms))) return '--:--.---';

  const total = Math.max(0, Math.round(Number(ms)));
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;

  return pad(minutes, 2) + ':' + pad(seconds, 2) + '.' + pad(millis, 3);
}

/**
 * 单条日志 → 一行纯文本
 * 形如：[00:03.412] OK    192.168.60.44  验证通过（openUBMC），版本 1.11.00.00
 */
function formatLogLine(entry) {
  const item = entry || {};
  const level = LOG_LEVELS.includes(item.level) ? item.level : 'info';
  const label = LEVEL_LABELS[level];
  const time = formatOffset(item.time);
  const ip = item.ip ? String(item.ip) + '  ' : '';
  const message = item.message == null ? '' : String(item.message);
  return '[' + time + '] ' + label + ' ' + ip + message;
}

/**
 * 裁剪条目到上限
 *
 * 超限时丢**中间**部分：头部是阶段摘要、尾部是最新记录，两端都比中间有价值。
 * 纯函数，不修改入参。
 *
 * @param {Array} entries
 * @param {number} [maxEntries]
 * @param {number} [keepHead]
 * @returns {{entries: Array, omitted: number}}
 */
function trimEntries(entries, maxEntries = DEFAULT_MAX_ENTRIES, keepHead = DEFAULT_KEEP_HEAD) {
  const list = Array.isArray(entries) ? entries : [];
  const max = Math.max(0, Math.floor(Number(maxEntries) || 0));
  if (list.length <= max) return { entries: list.slice(), omitted: 0 };

  const headCount = Math.min(Math.max(0, Math.floor(Number(keepHead) || 0)), max);
  const tailCount = max - headCount;
  const kept = list.slice(0, headCount).concat(tailCount > 0 ? list.slice(list.length - tailCount) : []);

  return { entries: kept, omitted: list.length - kept.length };
}

/**
 * 按模式过滤
 * @param {Array} entries
 * @param {string} mode 'all' | 'problem'（problem = warn + error）
 */
function filterEntries(entries, mode = FILTER_ALL) {
  const list = Array.isArray(entries) ? entries : [];
  if (mode !== FILTER_PROBLEM) return list.slice();
  return list.filter(entry => entry && (entry.level === 'warn' || entry.level === 'error'));
}

/**
 * 统计各级别条数，供日志工具栏展示
 * @returns {{total:number, debug:number, info:number, ok:number, warn:number, error:number, problems:number}}
 */
function summarizeEntries(entries) {
  const stats = { total: 0, debug: 0, info: 0, ok: 0, warn: 0, error: 0, problems: 0 };
  const list = Array.isArray(entries) ? entries : [];

  for (const entry of list) {
    const level = entry && LOG_LEVELS.includes(entry.level) ? entry.level : 'info';
    stats.total++;
    stats[level]++;
  }
  stats.problems = stats.warn + stats.error;

  return stats;
}

/**
 * 条目数组 → 可保存的纯文本
 * omitted > 0 时在头部之后插入一条折叠提示，避免导出后看不出丢过日志
 */
function entriesToText(entries, options = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const omitted = Math.max(0, Math.floor(Number(options.omitted) || 0));
  const keepHead = Math.max(0, Math.floor(Number(options.keepHead)));
  const headCount = Number.isFinite(keepHead) ? keepHead : DEFAULT_KEEP_HEAD;

  const lines = list.map(formatLogLine);

  if (omitted > 0) {
    const index = Math.min(headCount, lines.length);
    lines.splice(index, 0, formatLogLine({
      time: null,
      level: 'warn',
      message: '已省略 ' + omitted + ' 条（超出日志上限）'
    }));
  }

  return lines.join('\n');
}

/**
 * 创建有状态的收集器（渲染层用）
 *
 * add() 后条目数恒不超过 maxEntries，超出的中间段计入 omitted。
 */
function createScanLog(options = {}) {
  const maxEntries = Math.max(1, Math.floor(Number(options.maxEntries) || DEFAULT_MAX_ENTRIES));
  const keepHead = Math.max(0, Math.min(
    Math.floor(Number(options.keepHead ?? DEFAULT_KEEP_HEAD)),
    maxEntries
  ));

  let entries = [];
  let omitted = 0;

  return {
    /** 追加一条（level 非法时按 info 处理） */
    add(entry) {
      const item = entry || {};
      entries.push({
        time: item.time === undefined ? null : item.time,
        level: LOG_LEVELS.includes(item.level) ? item.level : 'info',
        ip: item.ip == null ? '' : String(item.ip),
        message: item.message == null ? '' : String(item.message)
      });

      if (entries.length > maxEntries) {
        const result = trimEntries(entries, maxEntries, keepHead);
        entries = result.entries;
        omitted += result.omitted;
      }

      return entries.length;
    },

    /** 当前条目（副本） */
    toEntries() {
      return entries.slice();
    },

    get omitted() {
      return omitted;
    },

    get maxEntries() {
      return maxEntries;
    },

    clear() {
      entries = [];
      omitted = 0;
    },

    /** 导出用文本（含折叠提示） */
    toText() {
      return entriesToText(entries, { omitted, keepHead });
    }
  };
}

module.exports = {
  LOG_LEVELS,
  LEVEL_LABELS,
  DEFAULT_MAX_ENTRIES,
  DEFAULT_KEEP_HEAD,
  FILTER_ALL,
  FILTER_PROBLEM,
  formatOffset,
  formatLogLine,
  trimEntries,
  filterEntries,
  summarizeEntries,
  entriesToText,
  createScanLog
};
