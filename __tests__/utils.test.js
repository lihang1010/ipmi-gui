/**
 * utils 模块单元测试
 */

const { escapeHtml, isValidIP, formatCommandOutput } = require('../src/modules/utils');

describe('Utils Module', () => {
  describe('escapeHtml', () => {
    test('should escape HTML entities', () => {
      expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    });

    test('should escape ampersand', () => {
      expect(escapeHtml('a & b')).toBe('a &amp; b');
    });

    test('should escape quotes', () => {
      expect(escapeHtml('"test"')).toBe('&quot;test&quot;');
    });

    test('should handle empty string', () => {
      expect(escapeHtml('')).toBe('');
    });

    test('should handle normal text', () => {
      expect(escapeHtml('hello world')).toBe('hello world');
    });
  });

  describe('isValidIP', () => {
    test('should validate correct IP', () => {
      expect(isValidIP('192.168.1.100')).toBe(true);
    });

    test('should validate 0.0.0.0', () => {
      expect(isValidIP('0.0.0.0')).toBe(true);
    });

    test('should validate 255.255.255.255', () => {
      expect(isValidIP('255.255.255.255')).toBe(true);
    });

    test('should reject IP with octet > 255', () => {
      expect(isValidIP('256.1.1.1')).toBe(false);
    });

    test('should reject IP with less than 4 octets', () => {
      expect(isValidIP('192.168.1')).toBe(false);
    });

    test('should reject IP with more than 4 octets', () => {
      expect(isValidIP('192.168.1.1.1')).toBe(false);
    });

    test('should reject non-numeric octets', () => {
      expect(isValidIP('abc.1.1.1')).toBe(false);
    });

    test('should reject empty string', () => {
      expect(isValidIP('')).toBe(false);
    });

    test('should reject IP with leading zeros', () => {
      expect(isValidIP('01.1.1.1')).toBe(false);
    });
  });

  describe('formatCommandOutput', () => {
    test('成功且有 stdout 时应显示 stdout', () => {
      expect(formatCommandOutput({ code: 0, stdout: 'Chassis Power is on', stderr: '' }))
        .toBe('Chassis Power is on');
    });

    test('成功但只有 stderr 时应显示 stderr（ipmitool help 走 stderr）', () => {
      const help = 'Commands:\n\traw           Send a RAW IPMI request and print response\n';
      expect(formatCommandOutput({ code: 0, stdout: '', stderr: help })).toBe(help);
    });

    test('成功且两个流都为空时显示无输出', () => {
      expect(formatCommandOutput({ code: 0, stdout: '', stderr: '' })).toBe('(无输出)');
      expect(formatCommandOutput({ code: 0, stdout: '' })).toBe('(无输出)');
    });

    test('失败时应优先显示 stderr', () => {
      expect(formatCommandOutput({ code: 1, stdout: '', stderr: 'Error: Unable to establish IPMI session' }))
        .toBe('错误:\nError: Unable to establish IPMI session');
    });

    test('失败且 stderr 为空时应回退到 stdout', () => {
      expect(formatCommandOutput({ code: 1, stdout: 'partial output', stderr: '' }))
        .toBe('错误:\npartial output');
    });

    test('失败且两个流都为空时给出兜底文案', () => {
      expect(formatCommandOutput({ code: -1, stdout: '', stderr: '' })).toBe('错误:\n未知错误');
      expect(formatCommandOutput(null)).toBe('错误:\n未知错误');
    });
  });
});
