/**
 * 主题纯逻辑单测
 */

const theme = require('../src/modules/theme');

describe('theme.normalizeTheme', () => {
  test('should keep supported themes', () => {
    expect(theme.normalizeTheme('dark')).toBe('dark');
    expect(theme.normalizeTheme('light')).toBe('light');
  });

  test('should fall back to the default for anything else', () => {
    expect(theme.normalizeTheme(undefined)).toBe('dark');
    expect(theme.normalizeTheme(null)).toBe('dark');
    expect(theme.normalizeTheme('')).toBe('dark');
    expect(theme.normalizeTheme('Dark')).toBe('dark');
    expect(theme.normalizeTheme('solarized')).toBe('dark');
    expect(theme.normalizeTheme(123)).toBe('dark');
  });
});

describe('theme.nextTheme', () => {
  test('should toggle between the two themes', () => {
    expect(theme.nextTheme('dark')).toBe('light');
    expect(theme.nextTheme('light')).toBe('dark');
  });

  test('should treat unknown values as the default before toggling', () => {
    expect(theme.nextTheme(undefined)).toBe('light');
    expect(theme.nextTheme('bogus')).toBe('light');
  });
});

describe('theme.themeLabel', () => {
  test('should give Chinese labels', () => {
    expect(theme.themeLabel('dark')).toBe('暗色');
    expect(theme.themeLabel('light')).toBe('亮色');
  });

  test('should fall back to the default label', () => {
    expect(theme.themeLabel(undefined)).toBe('暗色');
    expect(theme.themeLabel('bogus')).toBe('暗色');
  });
});

describe('theme.terminalTheme', () => {
  test('should return a distinct palette per theme', () => {
    const dark = theme.terminalTheme('dark');
    const light = theme.terminalTheme('light');

    expect(dark.background).toBe('#0d0d10');
    expect(light.background).toBe('#f8f9fb');
    expect(dark.foreground).not.toBe(light.foreground);
  });

  test('should expose the same keys for both themes', () => {
    expect(Object.keys(theme.terminalTheme('light')).sort())
      .toEqual(Object.keys(theme.terminalTheme('dark')).sort());
  });

  test('should fall back to the dark palette', () => {
    expect(theme.terminalTheme('bogus')).toBe(theme.TERMINAL_THEMES.dark);
    expect(theme.terminalTheme(undefined)).toBe(theme.TERMINAL_THEMES.dark);
  });
});
