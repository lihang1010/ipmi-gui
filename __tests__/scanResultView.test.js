/**
 * scanResultView.js 单元测试
 * 重点验证：远端可控字段必须转义（防注入），勾选状态可保留
 */

const { renderScanResultRow } = require('../src/modules/scanResultView');

describe('scanResultView', () => {
  describe('HTML 转义（防注入）', () => {
    test('应转义设备返回的 productName', () => {
      const html = renderScanResultRow({
        ip: '192.168.1.10',
        latency: 12,
        productName: '<img src=x onerror=alert(1)>',
        productSource: 'AMI'
      });

      expect(html).not.toContain('<img');
      expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    });

    test('应转义 productSource（title 属性）', () => {
      const html = renderScanResultRow({
        ip: '192.168.1.10',
        productName: 'X',
        productSource: '" onmouseover="alert(1)'
      });

      expect(html).not.toContain('onmouseover="alert(1)"');
      expect(html).toContain('&quot; onmouseover=&quot;alert(1)');
    });

    test('应转义模板名', () => {
      const html = renderScanResultRow({
        ip: '192.168.1.10',
        template: 'AMI"><script>alert(1)</script>'
      });

      expect(html).not.toContain('<script>');
    });

    test('应转义 verifyHint', () => {
      const html = renderScanResultRow({
        ip: '192.168.1.10',
        verifyHint: '<b>hint</b>'
      });

      expect(html).not.toContain('<b>hint</b>');
      expect(html).toContain('&lt;b&gt;hint&lt;/b&gt;');
    });

    test('不应再输出内联 onclick', () => {
      const html = renderScanResultRow({ ip: '192.168.1.10' });
      expect(html).not.toContain('onclick=');
      expect(html).toContain('scan-add-btn');
    });

    test('ip 中的引号不应破坏属性', () => {
      const html = renderScanResultRow({ ip: 'x" onclick="alert(1)' });
      expect(html).not.toContain('onclick="alert(1)"');
    });
  });

  describe('行结构', () => {
    test('已存在的设备应禁用勾选框与添加按钮', () => {
      const html = renderScanResultRow(
        { ip: '192.168.1.10', latency: 1 },
        { existingIPs: ['192.168.1.10'] }
      );

      expect(html).toContain('already-exists');
      expect(html).toContain('已存在');
      expect((html.match(/disabled/g) || []).length).toBe(2);
    });

    test('勾选状态应被保留', () => {
      const html = renderScanResultRow(
        { ip: '192.168.1.10' },
        { checkedIPs: ['192.168.1.10'] }
      );

      expect(html).toContain('checked');
    });

    test('已存在的设备即使传入 checkedIPs 也不勾选', () => {
      const html = renderScanResultRow(
        { ip: '192.168.1.10' },
        { existingIPs: ['192.168.1.10'], checkedIPs: ['192.168.1.10'] }
      );

      expect(html).not.toContain(' checked');
    });

    test('只渲染开放端口的徽章', () => {
      const html = renderScanResultRow({
        ip: '192.168.1.10',
        ports: { 'UDP:623': false, 'TCP:623': true, 'TCP:80': true, 'TCP:443': false }
      });

      expect(html).toContain('TCP:623');
      expect(html).toContain('TCP:80');
      expect(html).not.toContain('UDP:623');
      expect(html).not.toContain('TCP:443');
    });

    test('应渲染 BMC 版本号列', () => {
      const html = renderScanResultRow({ ip: '192.168.1.10', bmcVersion: '1.11.1109' });
      expect(html).toContain('class="scan-version"');
      expect(html).toContain('1.11.1109');
    });

    test('无版本号时该列应留空', () => {
      const html = renderScanResultRow({ ip: '192.168.1.10' });
      expect(html).toContain('<span class="scan-version" title="BMC 固件版本"></span>');
    });

    test('版本号应转义', () => {
      const html = renderScanResultRow({ ip: '192.168.1.10', bmcVersion: '<img src=x>' });
      expect(html).not.toContain('<img');
    });

    test('版本号应位于状态列之后、产品列之前', () => {
      const html = renderScanResultRow({ ip: '192.168.1.10', bmcVersion: '1.11.1109', productName: 'P' });
      expect(html.indexOf('scan-version')).toBeGreaterThan(html.indexOf('scan-status exists'));
      expect(html.indexOf('scan-version')).toBeLessThan(html.indexOf('scan-product'));
    });

    test('验证通过应显示模板徽章', () => {
      const html = renderScanResultRow({ ip: '192.168.1.10', template: 'openUBMC' });
      expect(html).toContain('scan-status new');
      expect(html).toContain('openUBMC');
    });

    test('AMI 验证失败提示文案', () => {
      const html = renderScanResultRow({
        ip: '192.168.1.10',
        verifyHint: '端口特征疑似 AMI',
        verifyHintType: 'ami'
      });

      expect(html).toContain('scan-status warning');
      expect(html).toContain('AMI 凭据错误?');
    });

    test('无验证信息时显示未验证', () => {
      const html = renderScanResultRow({ ip: '192.168.1.10' });
      expect(html).toContain('未验证');
    });

    test('应兼容字符串形式的扫描结果', () => {
      const html = renderScanResultRow('192.168.1.10');
      expect(html).toContain('192.168.1.10');
      expect(html).toContain('0ms');
    });
  });
});
