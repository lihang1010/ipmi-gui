/**
 * scanResultView.js 单元测试
 * 重点验证：远端可控字段必须转义（防注入），勾选状态可保留
 */

const { renderScanResultRow, describePowerState } = require('../src/modules/scanResultView');

describe('scanResultView', () => {
  describe('describePowerState', () => {
    test('on / off 映射为文案与 class', () => {
      expect(describePowerState('on')).toEqual({ text: 'On', cls: ' on', title: '电源状态：开机' });
      expect(describePowerState('off')).toEqual({ text: 'Off', cls: ' off', title: '电源状态：关机' });
    });

    test('未知状态不给文案（界面留空）', () => {
      expect(describePowerState('').text).toBe('');
      expect(describePowerState(null).text).toBe('');
      expect(describePowerState('unknown').text).toBe('');
    });
  });

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
      expect(html).toContain('已添加');
      expect((html.match(/disabled/g) || []).length).toBe(2);
    });

    test('已存在的设备不再渲染可点击的 data-ip', () => {
      const html = renderScanResultRow(
        { ip: '192.168.1.10' },
        { existingIPs: ['192.168.1.10'] }
      );

      expect(html).not.toContain('data-ip=');
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

      // 列表里用紧凑标签，全称放 title
      expect(html).toContain('>T623<');
      expect(html).toContain('>T80<');
      expect(html).toContain('title="TCP:623"');
      expect(html).not.toContain('>U623<');
      expect(html).not.toContain('>T443<');
    });

    test('端口徽章带协议 class（供分色）', () => {
      const html = renderScanResultRow({
        ip: '192.168.1.10',
        ports: { 'UDP:623': true, 'TCP:623': true, 'TCP:80': true, 'TCP:443': false }
      });

      expect(html).toContain('proto-udp');
      expect(html).toContain('proto-tcp');
      expect(html).toContain('proto-web');
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

    test('列顺序：端口 → 架构 → 版本 → 电源 → 主板名/产品名', () => {
      const html = renderScanResultRow({
        ip: '192.168.1.10',
        template: 'openUBMC',
        bmcVersion: '1.11.1109',
        powerState: 'on',
        productName: 'P',
        ports: { 'TCP:623': true }
      });

      const iPorts = html.indexOf('scan-ports');
      const iTemplate = html.indexOf('scan-template');
      const iVersion = html.indexOf('scan-version');
      const iPower = html.indexOf('scan-power');
      const iProduct = html.indexOf('scan-product');

      expect(iTemplate).toBeGreaterThan(iPorts);
      expect(iVersion).toBeGreaterThan(iTemplate);
      expect(iPower).toBeGreaterThan(iVersion);
      expect(iProduct).toBeGreaterThan(iPower);
    });

    test('架构与版本是两个独立列（不再包在同一个 BMC 容器里）', () => {
      const html = renderScanResultRow({ ip: '192.168.1.10', template: 'AMI', bmcVersion: '1.05.0004' });

      expect(html).not.toContain('scan-bmc');
      expect(html).toContain('scan-template tpl-ami');
      expect(html).toContain('<span class="scan-version" title="BMC 固件版本">1.05.0004</span>');
    });

    test('模板徽章按厂商分色（白名单 class）', () => {
      expect(renderScanResultRow({ ip: '1.1.1.1', template: 'openUBMC' })).toContain('tpl-openubmc');
      expect(renderScanResultRow({ ip: '1.1.1.1', template: 'AMI' })).toContain('tpl-ami');
      expect(renderScanResultRow({ ip: '1.1.1.1', template: 'onetree' })).toContain('tpl-onetree');
    });

    test('未知模板名不会污染 class 属性', () => {
      const html = renderScanResultRow({ ip: '1.1.1.1', template: 'x" onclick="alert(1)' });
      expect(html).not.toContain('onclick="alert(1)"');
      expect(html).not.toContain('tpl-');
    });

    test('电源状态 on 应渲染圆点 + 成功色', () => {
      const html = renderScanResultRow({ ip: '192.168.1.10', powerState: 'on' });
      expect(html).toContain('class="scan-power on"');
      expect(html).toContain('scan-power-dot');
      expect(html).toContain('>On</span>');
    });

    test('电源状态 off 应渲染中性色', () => {
      const html = renderScanResultRow({ ip: '192.168.1.10', powerState: 'off' });
      expect(html).toContain('class="scan-power off"');
      expect(html).toContain('>Off</span>');
    });

    test('无电源状态时该列留空（不渲染圆点）', () => {
      const html = renderScanResultRow({ ip: '192.168.1.10' });
      expect(html).toContain('class="scan-power"');
      expect(html).not.toContain('scan-power-dot');
    });

    test('电源状态走白名单，非法值不会进入 class 或文本', () => {
      const html = renderScanResultRow({ ip: '192.168.1.10', powerState: 'on" onclick="alert(1)' });
      expect(html).not.toContain('onclick="alert(1)"');
      expect(html).not.toContain('scan-power-dot');
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
