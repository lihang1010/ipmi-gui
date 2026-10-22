/**
 * scanFilter.js 单元测试
 *
 * 重点固定：
 *  1. IP 必须按数值比较（192.168.60.9 < 192.168.60.10）
 *  2. 版本号按段比较（2.0.0.10 > 2.0.0.9）
 *  3. 「取不到值」的设备升序降序都排末尾，不能因为降序顶到最前
 *  4. 相等项保持原始顺序（依赖稳定排序）
 */

const scanFilter = require('../src/modules/scanFilter');

const sample = [
  {
    ip: '192.168.60.10', latency: 1200, template: 'AMI', bmcVersion: '0.01.0000',
    powerState: 'off', productName: 'Alpha', ports: { 'TCP:623': true, 'TCP:80': true }
  },
  {
    ip: '192.168.60.9', latency: 300, template: 'openUBMC', bmcVersion: '2.00.00.05',
    powerState: 'on', productName: 'Beta', ports: { 'UDP:623': true, 'TCP:623': true, 'TCP:80': true }
  },
  {
    ip: '192.168.60.110', latency: 800, template: '', bmcVersion: '',
    powerState: '', productName: '', ports: { 'TCP:80': true }
  }
];

describe('scanFilter', () => {
  describe('compareIp', () => {
    test('应按数值而非字符串比较', () => {
      expect(scanFilter.compareIp('192.168.60.9', '192.168.60.10')).toBeLessThan(0);
      expect(scanFilter.compareIp('192.168.60.110', '192.168.60.9')).toBeGreaterThan(0);
      expect(scanFilter.compareIp('10.0.0.1', '9.0.0.1')).toBeGreaterThan(0);
    });

    test('相等返回 0', () => {
      expect(scanFilter.compareIp('192.168.1.1', '192.168.1.1')).toBe(0);
    });

    test('非法 IP 排到末尾', () => {
      expect(scanFilter.compareIp('bad', '192.168.1.1')).toBeGreaterThan(0);
      expect(scanFilter.compareIp('192.168.1.1', 'bad')).toBeLessThan(0);
      expect(scanFilter.compareIp('bad', 'bad')).toBe(0);
    });

    test('parseIp 拒绝越界与段数不足', () => {
      expect(scanFilter.parseIp('256.1.1.1')).toBeNull();
      expect(scanFilter.parseIp('1.2.3')).toBeNull();
      expect(scanFilter.parseIp('1.2.3.4')).toEqual([1, 2, 3, 4]);
    });
  });

  describe('compareVersion', () => {
    test('应按段做数值比较', () => {
      expect(scanFilter.compareVersion('2.00.00.09', '2.00.00.10')).toBeLessThan(0);
      expect(scanFilter.compareVersion('10.0.0.1', '9.9.9.9')).toBeGreaterThan(0);
    });

    test('段数不同时缺省按 0', () => {
      expect(scanFilter.compareVersion('2.00', '2.00.00.00')).toBe(0);
    });

    test('空值排到末尾', () => {
      expect(scanFilter.compareVersion('', '1.0.0.0')).toBeGreaterThan(0);
      expect(scanFilter.compareVersion('1.0.0.0', '')).toBeLessThan(0);
    });
  });

  describe('openPortCount / powerRank', () => {
    test('统计开放端口数', () => {
      expect(scanFilter.openPortCount({ 'TCP:80': true, 'TCP:443': false, 'UDP:623': true })).toBe(2);
      expect(scanFilter.openPortCount(null)).toBe(0);
    });

    test('开机 < 关机 < 未知', () => {
      expect(scanFilter.powerRank('on')).toBe(0);
      expect(scanFilter.powerRank('off')).toBe(1);
      expect(scanFilter.powerRank('')).toBe(2);
    });
  });

  describe('sortScanResults', () => {
    test('默认按 IP 升序', () => {
      const sorted = scanFilter.sortScanResults(sample);
      expect(sorted.map(r => r.ip)).toEqual(['192.168.60.9', '192.168.60.10', '192.168.60.110']);
    });

    test('IP 降序', () => {
      const sorted = scanFilter.sortScanResults(sample, { key: 'ip', dir: 'desc' });
      expect(sorted.map(r => r.ip)).toEqual(['192.168.60.110', '192.168.60.10', '192.168.60.9']);
    });

    test('延迟升序', () => {
      const sorted = scanFilter.sortScanResults(sample, { key: 'latency' });
      expect(sorted.map(r => r.latency)).toEqual([300, 800, 1200]);
    });

    test('开放端口数降序', () => {
      const sorted = scanFilter.sortScanResults(sample, { key: 'ports', dir: 'desc' });
      expect(sorted.map(r => scanFilter.openPortCount(r.ports))).toEqual([3, 2, 1]);
    });

    test('版本降序时缺失版本仍排末尾', () => {
      const sorted = scanFilter.sortScanResults(sample, { key: 'version', dir: 'desc' });
      expect(sorted.map(r => r.bmcVersion)).toEqual(['2.00.00.05', '0.01.0000', '']);
    });

    test('电源排序：开机在前，未知在末尾（降序也是末尾）', () => {
      expect(scanFilter.sortScanResults(sample, { key: 'power' }).map(r => r.powerState))
        .toEqual(['on', 'off', '']);

      expect(scanFilter.sortScanResults(sample, { key: 'power', dir: 'desc' }).map(r => r.powerState))
        .toEqual(['off', 'on', '']);
    });

    test('产品名降序时空白仍排末尾', () => {
      const sorted = scanFilter.sortScanResults(sample, { key: 'product', dir: 'desc' });
      expect(sorted.map(r => r.productName)).toEqual(['Beta', 'Alpha', '']);
    });

    test('架构排序：未知模板排末尾', () => {
      const sorted = scanFilter.sortScanResults(sample, { key: 'arch' });
      expect(sorted.map(r => r.template)).toEqual(['AMI', 'openUBMC', '']);
    });

    test('相等项保持原始顺序（稳定排序）', () => {
      const same = [
        { ip: '192.168.1.1', latency: 100, productName: 'A' },
        { ip: '192.168.1.2', latency: 100, productName: 'B' },
        { ip: '192.168.1.3', latency: 100, productName: 'C' }
      ];
      const sorted = scanFilter.sortScanResults(same, { key: 'latency' });
      expect(sorted.map(r => r.productName)).toEqual(['A', 'B', 'C']);
    });

    test('不修改入参', () => {
      const copy = sample.slice();
      scanFilter.sortScanResults(sample, { key: 'ip', dir: 'desc' });
      expect(sample).toEqual(copy);
    });

    test('未知排序键回落 IP', () => {
      const sorted = scanFilter.sortScanResults(sample, { key: 'nope' });
      expect(sorted[0].ip).toBe('192.168.60.9');
    });
  });

  describe('filterByKeyword', () => {
    test('空关键词返回全部副本', () => {
      const result = scanFilter.filterByKeyword(sample, '   ');
      expect(result).toHaveLength(3);
      expect(result).not.toBe(sample);
    });

    test('匹配 IP 片段', () => {
      expect(scanFilter.filterByKeyword(sample, '60.9').map(r => r.ip)).toEqual(['192.168.60.9']);
    });

    test('匹配架构（大小写不敏感）', () => {
      expect(scanFilter.filterByKeyword(sample, 'openubmc')).toHaveLength(1);
      expect(scanFilter.filterByKeyword(sample, 'AMI')).toHaveLength(1);
    });

    test('匹配版本与产品名', () => {
      expect(scanFilter.filterByKeyword(sample, '2.00.00')).toHaveLength(1);
      expect(scanFilter.filterByKeyword(sample, 'beta')).toHaveLength(1);
    });

    test('无匹配返回空数组', () => {
      expect(scanFilter.filterByKeyword(sample, 'zzz')).toHaveLength(0);
    });
  });

  describe('filterByQuick', () => {
    test('all 返回全部', () => {
      expect(scanFilter.filterByQuick(sample, 'all')).toHaveLength(3);
    });

    test('unadded 排除已添加的 IP', () => {
      const result = scanFilter.filterByQuick(sample, 'unadded', ['192.168.60.9']);
      expect(result.map(r => r.ip)).toEqual(['192.168.60.10', '192.168.60.110']);
    });

    test('on 只保留开机设备', () => {
      expect(scanFilter.filterByQuick(sample, 'on').map(r => r.ip)).toEqual(['192.168.60.9']);
    });

    test('on 不含电源状态未知的设备', () => {
      expect(scanFilter.filterByQuick(sample, 'on')).toHaveLength(1);
    });

    test('off 只保留关机设备', () => {
      expect(scanFilter.filterByQuick(sample, 'off').map(r => r.ip)).toEqual(['192.168.60.10']);
    });

    test('failed 只保留未通过验证的', () => {
      expect(scanFilter.filterByQuick(sample, 'failed').map(r => r.ip)).toEqual(['192.168.60.110']);
    });
  });

  describe('filterScanResults', () => {
    test('关键词 + chips 同时生效', () => {
      const result = scanFilter.filterScanResults(sample, { keyword: '192.168', quick: 'off' });
      expect(result.map(r => r.ip)).toEqual(['192.168.60.10']);
    });

    test('hideExisting 排除已添加设备', () => {
      const result = scanFilter.filterScanResults(sample, {
        hideExisting: true,
        existingIPs: ['192.168.60.9', '192.168.60.10']
      });
      expect(result.map(r => r.ip)).toEqual(['192.168.60.110']);
    });

    test('hideExisting 为 false 时不过滤', () => {
      const result = scanFilter.filterScanResults(sample, {
        hideExisting: false,
        existingIPs: ['192.168.60.9']
      });
      expect(result).toHaveLength(3);
    });
  });

  describe('applyScanView', () => {
    test('先过滤再排序', () => {
      const view = scanFilter.applyScanView(sample, {
        keyword: '192.168.60',
        quick: 'all',
        sortKey: 'latency',
        sortDir: 'desc'
      });

      expect(view.map(r => r.latency)).toEqual([1200, 800, 300]);
    });

    test('过滤后为空', () => {
      const view = scanFilter.applyScanView(sample, { keyword: 'zzz' });
      expect(view).toEqual([]);
    });

    test('空数组输入不报错', () => {
      expect(scanFilter.applyScanView([], { quick: 'off' })).toEqual([]);
      expect(scanFilter.applyScanView(null, {})).toEqual([]);
    });
  });

  describe('QUICK_FILTERS', () => {
    test('提供 5 个固定选项', () => {
      expect(scanFilter.QUICK_FILTERS.map(f => f.key))
        .toEqual(['all', 'unadded', 'on', 'off', 'failed']);
    });

    test('每个选项都有文案', () => {
      scanFilter.QUICK_FILTERS.forEach(({ key, label }) => {
        expect(typeof key).toBe('string');
        expect(label.length).toBeGreaterThan(0);
      });
    });

    test('常量与 chips 键一致', () => {
      expect(scanFilter.QUICK_ON).toBe('on');
      expect(scanFilter.QUICK_OFF).toBe('off');
    });
  });
});
