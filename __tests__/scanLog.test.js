/**
 * scanLog.js 单元测试
 *
 * 重点固定三件事：
 *  1. 时间格式固定为 mm:ss.mmm，日志导出后可直接对时间轴
 *  2. 超限时丢**中间**（保留阶段摘要与最新记录），且折叠条数可追溯
 *  3. 「仅告警与错误」过滤只放行 warn / error
 */

const scanLog = require('../src/modules/scanLog');

describe('scanLog', () => {
  describe('formatOffset', () => {
    test('0 应为 00:00.000', () => {
      expect(scanLog.formatOffset(0)).toBe('00:00.000');
    });

    test('应补零到毫秒', () => {
      expect(scanLog.formatOffset(1234)).toBe('00:01.234');
      expect(scanLog.formatOffset(61234)).toBe('01:01.234');
      expect(scanLog.formatOffset(600000)).toBe('10:00.000');
    });

    test('null / NaN 输出占位符（折叠提示行用）', () => {
      expect(scanLog.formatOffset(null)).toBe('--:--.---');
      expect(scanLog.formatOffset(NaN)).toBe('--:--.---');
      expect(scanLog.formatOffset(undefined)).toBe('--:--.---');
    });

    test('负数按 0 处理', () => {
      expect(scanLog.formatOffset(-5)).toBe('00:00.000');
    });
  });

  describe('formatLogLine', () => {
    test('应包含时间、定宽级别、IP 与消息', () => {
      const line = scanLog.formatLogLine({
        time: 3412,
        level: 'ok',
        ip: '192.168.60.44',
        message: '验证通过（openUBMC）'
      });

      expect(line).toBe('[00:03.412] OK    192.168.60.44  验证通过（openUBMC）');
    });

    test('无 IP 时不留多余空列', () => {
      const line = scanLog.formatLogLine({ time: 0, level: 'info', message: '目标 254 个地址' });
      expect(line).toBe('[00:00.000] INFO  目标 254 个地址');
    });

    test('非法级别回落 info', () => {
      const line = scanLog.formatLogLine({ time: 0, level: 'fatal', message: 'x' });
      expect(line).toContain('INFO');
    });
  });

  describe('trimEntries', () => {
    const make = (n) => Array.from({ length: n }, (_, i) => ({ level: 'info', message: 'm' + i }));

    test('未超限时原样返回', () => {
      const { entries, omitted } = scanLog.trimEntries(make(3), 10, 1);
      expect(entries).toHaveLength(3);
      expect(omitted).toBe(0);
    });

    test('超限时保留头部与尾部，丢弃中间', () => {
      const { entries, omitted } = scanLog.trimEntries(make(10), 6, 2);

      expect(entries).toHaveLength(6);
      expect(omitted).toBe(4);
      // 头部两条
      expect(entries[0].message).toBe('m0');
      expect(entries[1].message).toBe('m1');
      // 尾部四条
      expect(entries[2].message).toBe('m6');
      expect(entries[5].message).toBe('m9');
    });

    test('maxEntries 为 0 时全部省略', () => {
      const { entries, omitted } = scanLog.trimEntries(make(5), 0, 0);
      expect(entries).toHaveLength(0);
      expect(omitted).toBe(5);
    });
  });

  describe('filterEntries', () => {
    const entries = [
      { level: 'info', message: 'a' },
      { level: 'warn', message: 'b' },
      { level: 'ok', message: 'c' },
      { level: 'error', message: 'd' },
      { level: 'debug', message: 'e' }
    ];

    test('all 返回全部', () => {
      expect(scanLog.filterEntries(entries, scanLog.FILTER_ALL)).toHaveLength(5);
    });

    test('problem 只保留 warn 与 error', () => {
      const result = scanLog.filterEntries(entries, scanLog.FILTER_PROBLEM);
      expect(result.map(e => e.level)).toEqual(['warn', 'error']);
    });

    test('返回副本，不共享原数组', () => {
      const result = scanLog.filterEntries(entries, scanLog.FILTER_ALL);
      result.push({ level: 'info' });
      expect(entries).toHaveLength(5);
    });
  });

  describe('summarizeEntries', () => {
    test('应统计各级别并合计告警数', () => {
      const stats = scanLog.summarizeEntries([
        { level: 'info' }, { level: 'ok' }, { level: 'warn' },
        { level: 'error' }, { level: 'debug' }, { level: 'info' }
      ]);

      expect(stats.total).toBe(6);
      expect(stats.info).toBe(2);
      expect(stats.ok).toBe(1);
      expect(stats.warn).toBe(1);
      expect(stats.error).toBe(1);
      expect(stats.debug).toBe(1);
      expect(stats.problems).toBe(2);
    });

    test('空数组', () => {
      expect(scanLog.summarizeEntries([])).toEqual({
        total: 0, debug: 0, info: 0, ok: 0, warn: 0, error: 0, problems: 0
      });
    });
  });

  describe('entriesToText', () => {
    test('按行拼接', () => {
      const text = scanLog.entriesToText([
        { time: 0, level: 'info', message: 'a' },
        { time: 1000, level: 'ok', ip: '1.1.1.1', message: 'b' }
      ]);

      expect(text.split('\n')).toHaveLength(2);
      expect(text).toContain('[00:00.000] INFO  a');
      expect(text).toContain('[00:01.000] OK    1.1.1.1  b');
    });

    test('有省略条数时插入折叠提示', () => {
      const text = scanLog.entriesToText(
        [{ time: 0, level: 'info', message: 'a' }, { time: 1, level: 'info', message: 'b' }],
        { omitted: 42, keepHead: 1 }
      );

      const lines = text.split('\n');
      expect(lines).toHaveLength(3);
      expect(lines[1]).toContain('已省略 42 条');
    });
  });

  describe('createScanLog', () => {
    test('add 后可按序取出，且规整字段', () => {
      const log = scanLog.createScanLog();
      log.add({ time: 0, level: 'ok', ip: '1.1.1.1', message: 'x' });
      log.add({ time: 5, level: 'oops', message: null });

      const entries = log.toEntries();
      expect(entries).toHaveLength(2);
      expect(entries[0]).toEqual({ time: 0, level: 'ok', ip: '1.1.1.1', message: 'x' });
      // 非法级别与 null 消息被归一化，渲染层不用再判空
      expect(entries[1]).toEqual({ time: 5, level: 'info', ip: '', message: '' });
    });

    test('超出上限后条目数不超过上限，并累计省略数', () => {
      const log = scanLog.createScanLog({ maxEntries: 5, keepHead: 2 });
      for (let i = 0; i < 12; i++) {
        log.add({ time: i, level: 'info', message: 'm' + i });
      }

      const entries = log.toEntries();
      expect(entries).toHaveLength(5);
      expect(entries[0].message).toBe('m0');        // 头部保留
      expect(entries[4].message).toBe('m11');       // 尾部保留最新
      expect(log.omitted).toBe(7);
    });

    test('clear 重置条目与省略计数', () => {
      const log = scanLog.createScanLog({ maxEntries: 2, keepHead: 1 });
      for (let i = 0; i < 5; i++) log.add({ level: 'info', message: 'm' + i });

      log.clear();
      expect(log.toEntries()).toHaveLength(0);
      expect(log.omitted).toBe(0);
    });

    test('toText 含折叠提示', () => {
      const log = scanLog.createScanLog({ maxEntries: 2, keepHead: 1 });
      for (let i = 0; i < 4; i++) log.add({ level: 'warn', message: 'm' + i });

      expect(log.toText()).toContain('已省略');
    });

    test('toEntries 返回副本，外部修改不影响内部', () => {
      const log = scanLog.createScanLog();
      log.add({ level: 'info', message: 'a' });

      log.toEntries().push({ level: 'info', message: 'b' });
      expect(log.toEntries()).toHaveLength(1);
    });
  });
});
