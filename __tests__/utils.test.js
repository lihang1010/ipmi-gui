/**
 * utils 模块单元测试
 */

const { escapeHtml, isValidIP } = require('../src/modules/utils');

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
});
