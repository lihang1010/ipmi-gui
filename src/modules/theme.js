/**
 * 主题（亮色 / 暗色）纯逻辑
 *
 * 只负责「主题名 → 归一化 / 下一个 / 显示名 / 终端配色」这类无副作用的判断，
 * DOM 操作与持久化留在 renderer.js。
 *
 * 主题通过 <html data-theme="..."> 生效，样式表里用 `:root[data-theme='light']`
 * 覆盖 token（见 style.css）。
 */

/** 支持的主题 */
const THEMES = ['dark', 'light'];

/** 默认主题：与项目原本的暗色设计保持一致 */
const DEFAULT_THEME = 'dark';

/**
 * 归一化主题名：非法值一律回落到默认主题
 * @param {string} value
 * @returns {'dark'|'light'}
 */
function normalizeTheme(value) {
  return THEMES.indexOf(value) >= 0 ? value : DEFAULT_THEME;
}

/**
 * 取下一个主题（一键切换用）
 * @param {string} current
 * @returns {'dark'|'light'}
 */
function nextTheme(current) {
  return normalizeTheme(current) === 'dark' ? 'light' : 'dark';
}

/**
 * 主题的界面显示名
 * @param {string} theme
 * @returns {string}
 */
function themeLabel(theme) {
  return normalizeTheme(theme) === 'light' ? '亮色' : '暗色';
}

/**
 * xterm 终端配色
 *
 * 终端背景与应用主题保持一致：亮色主题下白底深字，暗色主题下沿用原有配色。
 * renderer 在切换主题时把结果赋给 `term.options.theme`。
 */
const TERMINAL_THEMES = {
  dark: {
    background: '#0d0d10',
    foreground: '#d4d4d8',
    cursor: '#e4e4e8',
    cursorAccent: '#0d0d10',
    selectionBackground: 'rgba(91,155,213,0.3)',
    selectionForeground: '#ffffff'
  },
  light: {
    background: '#f8f9fb',
    foreground: '#24292f',
    cursor: '#24292f',
    cursorAccent: '#f8f9fb',
    selectionBackground: 'rgba(47,124,191,0.25)',
    selectionForeground: '#1c2024'
  }
};

/**
 * 取某主题对应的终端配色
 * @param {string} theme
 * @returns {object}
 */
function terminalTheme(theme) {
  return TERMINAL_THEMES[normalizeTheme(theme)];
}

module.exports = {
  THEMES,
  DEFAULT_THEME,
  TERMINAL_THEMES,
  normalizeTheme,
  nextTheme,
  themeLabel,
  terminalTheme
};
