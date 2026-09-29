/**
 * 自动更新状态展示映射单测
 */

const { describeUpdate } = require('../src/modules/updateStatus');

describe('updateStatus.describeUpdate', () => {
  test('idle / skipped 应隐藏，不占顶栏位置', () => {
    expect(describeUpdate({ state: 'idle' }).hidden).toBe(true);
    expect(describeUpdate({ state: 'skipped', reason: '开发模式' }).hidden).toBe(true);
    expect(describeUpdate(undefined).hidden).toBe(true);
    expect(describeUpdate(null).hidden).toBe(true);
  });

  test('checking 显示检查中且不可点击', () => {
    const view = describeUpdate({ state: 'checking' });
    expect(view.hidden).toBe(false);
    expect(view.text).toContain('检查');
    expect(view.actionable).toBe(false);
  });

  test('available 带上目标版本号', () => {
    const view = describeUpdate({ state: 'available', version: '1.2.0' });
    expect(view.text).toContain('v1.2.0');
    expect(view.hidden).toBe(false);
    expect(view.actionable).toBe(false);
  });

  test('downloading 显示百分比，缺百分比时降级为文案', () => {
    expect(describeUpdate({ state: 'downloading', percent: 42 }).text).toBe('下载 42%');
    expect(describeUpdate({ state: 'downloading' }).text).toBe('下载中');
    expect(describeUpdate({ state: 'downloading', percent: NaN }).text).toBe('下载中');
    expect(describeUpdate({ state: 'downloading', percent: 42 }).actionable).toBe(false);
  });

  test('ready 可点击，且提示会断开 SOL', () => {
    const view = describeUpdate({ state: 'ready', version: '1.2.0' });
    expect(view.actionable).toBe(true);
    expect(view.tone).toBe('ready');
    expect(view.hidden).toBe(false);
    expect(view.text).toContain('v1.2.0');
    expect(view.tooltip).toContain('SOL');
  });

  test('error 可点击重试并带上失败原因', () => {
    const view = describeUpdate({ state: 'error', error: 'ENOTFOUND' });
    expect(view.actionable).toBe(true);
    expect(view.tone).toBe('error');
    expect(view.tooltip).toContain('ENOTFOUND');
    expect(view.tooltip).toContain('重试');
  });

  test('error 无原因时也要有可读文案', () => {
    expect(describeUpdate({ state: 'error' }).tooltip).toContain('未知错误');
  });

  test('none 隐藏但仍给出 tooltip', () => {
    const view = describeUpdate({ state: 'none', version: '1.0.0' });
    expect(view.hidden).toBe(true);
    expect(view.tooltip).toContain('最新');
  });

  test('任何状态都返回完整字段，且 tone 受控', () => {
    ['idle', 'skipped', 'checking', 'available', 'downloading', 'none', 'ready', 'error', 'bogus']
      .forEach(state => {
        const view = describeUpdate({ state });
        expect(typeof view.text).toBe('string');
        expect(typeof view.tooltip).toBe('string');
        expect(typeof view.actionable).toBe('boolean');
        expect(typeof view.hidden).toBe('boolean');
        expect(['idle', 'ready', 'error']).toContain(view.tone);
      });
  });
});
