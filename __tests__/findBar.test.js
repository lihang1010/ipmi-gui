/**
 * findBar.js 单元测试
 *
 * 重点固定：
 *  1. 匹配必须是「字面量」匹配，查询词里的正则元字符不能当模式
 *  2. 0 命中要显示「无结果」而不是 0/0
 *  3. 计数越界（activeMatchOrdinal > matches）不能显示 4/3
 *  4. Ctrl+F / Cmd+F 都要识别，Alt 组合键不能误触发
 *  5. 多行选中只取第一行（查找框是单行输入）
 */

const findBar = require('../src/modules/findBar');

describe('findBar', () => {
  describe('normalizeQuery', () => {
    test('去掉两端空白（复制来的数据常带换行/缩进）', () => {
      expect(findBar.normalizeQuery('  CPU Temp \n')).toBe('CPU Temp');
    });

    test('保留中间空格（多词短语按原样匹配）', () => {
      expect(findBar.normalizeQuery('CPU Temp')).toBe('CPU Temp');
    });

    test('null / undefined / 数字都不抛', () => {
      expect(findBar.normalizeQuery(null)).toBe('');
      expect(findBar.normalizeQuery(undefined)).toBe('');
      expect(findBar.normalizeQuery(0)).toBe('0');
    });
  });

  describe('isActiveQuery', () => {
    test('只有空白不算有效查询', () => {
      expect(findBar.isActiveQuery('   ')).toBe(false);
      expect(findBar.isActiveQuery('T')).toBe(true);
    });
  });

  describe('findSubstringRanges', () => {
    test('找出一行里的全部匹配（按出现顺序）', () => {
      expect(findBar.findSubstringRanges('CPU0 Temp 30 CPU1 Temp 40 CPU2', 'CPU'))
        .toEqual([[0, 3], [13, 16], [26, 29]]);
    });

    test('大小写不敏感（传感器名/厂商字段混排）', () => {
      expect(findBar.findSubstringRanges('cpu CPU Cpu', 'Cpu'))
        .toEqual([[0, 3], [4, 7], [8, 11]]);
    });

    test('查询词里的正则元字符按字面量匹配', () => {
      expect(findBar.findSubstringRanges('Temp (0x01) 30', '(0x01)')).toEqual([[5, 11]]);
      expect(findBar.findSubstringRanges('a.b axb', 'a.b')).toEqual([[0, 3]]);
      expect(findBar.findSubstringRanges('100% load', '%')).toEqual([[3, 4]]);
    });

    test('重叠不算两处（aaa 里找 aa 只有 1 处）', () => {
      expect(findBar.findSubstringRanges('aaa', 'aa')).toEqual([[0, 2]]);
    });

    test('空查询 / 空文本 / 无匹配返回空数组', () => {
      expect(findBar.findSubstringRanges('CPU', '   ')).toEqual([]);
      expect(findBar.findSubstringRanges('', 'CPU')).toEqual([]);
      expect(findBar.findSubstringRanges(null, 'CPU')).toEqual([]);
      expect(findBar.findSubstringRanges('CPU', 'MEM')).toEqual([]);
    });

    test('查询词比文本长时不越界', () => {
      expect(findBar.findSubstringRanges('CPU', 'CPU Temp')).toEqual([]);
    });

    test('区间终点是开区间，正好等于匹配长度', () => {
      const [[start, end]] = findBar.findSubstringRanges('xxTempyy', 'Temp');
      expect(start).toBe(2);
      expect(end).toBe(6);
    });
  });

  describe('formatFindCount', () => {
    test('空查询不显示任何文字', () => {
      expect(findBar.formatFindCount({ query: '  ', matches: 3 })).toEqual({ text: '', tone: 'idle' });
    });

    test('0 命中显示无结果（不是 0/0）', () => {
      expect(findBar.formatFindCount({ query: 'xyz', matches: 0 })).toEqual({ text: '无结果', tone: 'empty' });
    });

    test('正常显示 当前/总数', () => {
      expect(findBar.formatFindCount({ query: 'CPU', matches: 12, activeMatchOrdinal: 3 }))
        .toEqual({ text: '3/12', tone: 'ok' });
    });

    test('activeMatchOrdinal 越界时夹到总数内', () => {
      expect(findBar.formatFindCount({ query: 'CPU', matches: 3, activeMatchOrdinal: 9 }).text).toBe('3/3');
    });

    test('缺 activeMatchOrdinal 时从 1 开始', () => {
      expect(findBar.formatFindCount({ query: 'CPU', matches: 5 }).text).toBe('1/5');
    });

    test('缺 matches 视为无结果', () => {
      expect(findBar.formatFindCount({ query: 'CPU' }).tone).toBe('empty');
    });
  });

  describe('isFindShortcut', () => {
    test('Ctrl+F', () => {
      expect(findBar.isFindShortcut({ key: 'f', ctrlKey: true })).toBe(true);
    });

    test('大写 F 与 Cmd+F（macOS）', () => {
      expect(findBar.isFindShortcut({ key: 'F', ctrlKey: true })).toBe(true);
      expect(findBar.isFindShortcut({ key: 'f', metaKey: true })).toBe(true);
    });

    test('单独的 f 不触发（否则打字都会开查找栏）', () => {
      expect(findBar.isFindShortcut({ key: 'f' })).toBe(false);
    });

    test('Ctrl+Alt+F 不触发（留给输入法/系统快捷键）', () => {
      expect(findBar.isFindShortcut({ key: 'f', ctrlKey: true, altKey: true })).toBe(false);
    });

    test('其它键不触发', () => {
      expect(findBar.isFindShortcut({ key: 'g', ctrlKey: true })).toBe(false);
      expect(findBar.isFindShortcut(null)).toBe(false);
    });
  });

  describe('pickSelection', () => {
    test('取选中文本并去空白', () => {
      expect(findBar.pickSelection('  Temp  ')).toBe('Temp');
    });

    test('多行选中只取第一行非空内容', () => {
      expect(findBar.pickSelection('\n  0x01  \n0x02')).toBe('0x01');
    });

    test('空选中返回空串', () => {
      expect(findBar.pickSelection('   ')).toBe('');
      expect(findBar.pickSelection(null)).toBe('');
    });
  });

  describe('terminalHint', () => {
    test('SOL 面板给出「不支持查找」的提示', () => {
      expect(findBar.terminalHint('sol')).toContain('不支持');
    });

    test('普通文本面板不提示', () => {
      expect(findBar.terminalHint('sensor')).toBe('');
      expect(findBar.terminalHint('')).toBe('');
    });
  });
});
