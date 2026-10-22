/**
 * 页面查找（Ctrl+F）的纯逻辑
 *
 * 命中收集与高亮在 renderer 里做（只在当前面板遍历文本节点，用 CSS Custom
 * Highlight API 着色，不插入任何节点）。**不用** `webContents.findInPage`：
 * 它会把查找框自己的文字也算进命中并一起高亮，计数虚高，Enter 的"下一个"
 * 还会停在输入框上，看起来像没反应。
 *
 * 这里只放 node 环境可直接单测的部分：查询归一化、文本匹配区间、
 * 计数文案、快捷键判定、选中文本提取。
 */

/**
 * 查询归一化：两端空白不代表用户意图，去掉后再判断是否为空
 * @param {*} input
 * @returns {string}
 */
function normalizeQuery(input) {
  if (input == null) return '';
  return String(input).trim();
}

/** 是否有可下发的查询 */
function isActiveQuery(input) {
  return normalizeQuery(input) !== '';
}

/**
 * 在一段文本里找出所有匹配区间（大小写不敏感，不重叠）
 *
 * 返回区间相对该文本节点，renderer 用 `range.setStart(node, start)` 直接转成 Range。
 * 不用正则：查询词里的 `.` `(` `*` 在 SEL 描述、传感器名里很常见，
 * 转义漏一个就会搜出莫名其妙的结果。
 *
 * @param {string} text 文本节点内容
 * @param {*} query 查询词
 * @returns {Array<[number, number]>} [start, end) 区间，按出现顺序
 */
function findSubstringRanges(text, query) {
  const haystack = String(text == null ? '' : text);
  const needle = normalizeQuery(query);
  if (!needle || !haystack) return [];

  const lowerHay = haystack.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  // 某些字符转小写后长度会变（如 'İ'），区间长度以原始查询词为准
  const step = needle.length;
  const ranges = [];

  let from = 0;
  while (from <= lowerHay.length - lowerNeedle.length) {
    const index = lowerHay.indexOf(lowerNeedle, from);
    if (index === -1) break;
    ranges.push([index, index + step]);
    from = index + step;   // 不重叠：「aa」在「aaa」里只算 1 处
  }

  return ranges;
}

/**
 * 计数文案
 *
 * 空查询不显示任何东西（查找栏刚打开时）；
 * 有查询但 0 命中显示「无结果」并由调用方标红——比显示 0/0 好懂。
 *
 * @param {{query?: string, matches?: number, activeMatchOrdinal?: number}} [state]
 * @returns {{text: string, tone: 'idle'|'ok'|'empty'}}
 */
function formatFindCount(state = {}) {
  if (!isActiveQuery(state.query)) return { text: '', tone: 'idle' };

  const total = Math.max(0, Math.floor(Number(state.matches) || 0));
  if (total === 0) return { text: '无结果', tone: 'empty' };

  const raw = Math.floor(Number(state.activeMatchOrdinal) || 0);
  const active = raw > 0 ? Math.min(raw, total) : 1;
  return { text: active + '/' + total, tone: 'ok' };
}

/**
 * 是否为 Ctrl+F / Cmd+F
 * @param {KeyboardEvent|{key?: string, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean}} event
 */
function isFindShortcut(event) {
  if (!event) return false;
  if (String(event.key || '').toLowerCase() !== 'f') return false;
  if (event.altKey === true) return false;
  return event.ctrlKey === true || event.metaKey === true;
}

/**
 * 从当前选中文本提取查询词
 * 单行输入框只能放一行，多行选中时取第一行非空内容
 * @param {string} selection
 */
function pickSelection(selection) {
  const text = String(selection == null ? '' : selection).trim();
  if (!text) return '';

  const line = text.split(/\r?\n/).find(item => item.trim() !== '');
  return line ? line.trim() : '';
}

/**
 * 面板级提示
 *
 * SOL 终端的正文在 xterm 的 canvas 里，不在 DOM 文本节点中，
 * 文本查找必然 0 命中；不提示的话用户会误以为「没有这个关键字」。
 * @param {string} tabKey 当前激活的 tab（dataset.tab）
 */
function terminalHint(tabKey) {
  return tabKey === 'sol' ? 'SOL 终端内容不支持页面查找' : '';
}

module.exports = {
  normalizeQuery,
  isActiveQuery,
  findSubstringRanges,
  formatFindCount,
  isFindShortcut,
  pickSelection,
  terminalHint
};
