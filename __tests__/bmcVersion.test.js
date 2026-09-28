/**
 * bmcVersion.js 单元测试
 * 样本取自真实 ipmitool mc info 输出
 */

const {
  VERSION_RULES,
  parseFirmwareRevision,
  parseAuxBytes,
  formatBmcVersion
} = require('../src/modules/bmcVersion');

// 实机 mc info 输出（AMI），Aux 字节为 11 09 00 00
const MC_INFO_SAMPLE = `Device ID                 : 32
Device Revision           : 1
Firmware Revision         : 1.11
IPMI Version              : 2.0
Manufacturer ID           : 0
Manufacturer Name         : Unknown
Product ID                : 514 (0x0202)
Product Name              : Unknown (0x202)
Device Available          : yes
Provides Device SDRs      : yes
Additional Device Support :
    Sensor Device
    SDR Repository Device
    SEL Device
    FRU Inventory Device
    IPMB Event Receiver
    IPMB Event Generator
    Chassis Device
Aux Firmware Rev Info     : 
    0x11
    0x09
    0x00
    0x00`;

describe('bmcVersion', () => {
  describe('parseFirmwareRevision', () => {
    test('应取 Firmware Revision 行的值', () => {
      expect(parseFirmwareRevision(MC_INFO_SAMPLE)).toBe('1.11');
    });

    test('不应误匹配 Aux Firmware Rev Info', () => {
      const output = 'Aux Firmware Rev Info     : \n    0x11\n';
      expect(parseFirmwareRevision(output)).toBe('');
    });

    test('缺失时应返回空字符串', () => {
      expect(parseFirmwareRevision('Device ID                 : 32')).toBe('');
      expect(parseFirmwareRevision('')).toBe('');
      expect(parseFirmwareRevision(null)).toBe('');
    });
  });

  describe('parseAuxBytes', () => {
    test('应解析逐行排列的 4 个字节', () => {
      expect(parseAuxBytes(MC_INFO_SAMPLE)).toEqual([0x11, 0x09, 0x00, 0x00]);
    });

    test('应支持字节跟在冒号后同一行', () => {
      const output = 'Aux Firmware Rev Info     : 0x11 0x09\n    0x00 0x00\n';
      expect(parseAuxBytes(output)).toEqual([0x11, 0x09, 0x00, 0x00]);
    });

    test('应兼容大写十六进制', () => {
      const output = 'Aux Firmware Rev Info     : \n    0xAB\n    0x0C\n';
      expect(parseAuxBytes(output)).toEqual([0xab, 0x0c]);
    });

    test('最多返回 4 个字节', () => {
      const output = 'Aux Firmware Rev Info     : \n    0x01\n    0x02\n    0x03\n    0x04\n    0x05\n';
      expect(parseAuxBytes(output)).toHaveLength(4);
    });

    test('无 Aux 段时返回空数组', () => {
      expect(parseAuxBytes('Firmware Revision         : 1.11')).toEqual([]);
    });

    test('后续非字节行应停止收集', () => {
      const output = 'Aux Firmware Rev Info     : \n    0x11\nDevice ID                 : 32\n';
      expect(parseAuxBytes(output)).toEqual([0x11]);
    });
  });

  describe('formatBmcVersion', () => {
    test('AMI 取前两字节并直接拼接', () => {
      expect(formatBmcVersion(MC_INFO_SAMPLE, 'AMI')).toBe('1.11.1109');
    });

    test('openUBMC 取后两字节并以点分隔', () => {
      expect(formatBmcVersion(MC_INFO_SAMPLE, 'openUBMC')).toBe('1.11.00.00');
    });

    test('openUBMC 后两字节非零时逐字节以点分隔', () => {
      const output = 'Firmware Revision         : 1.11\nAux Firmware Rev Info     : \n    0x11\n    0x09\n    0x01\n    0x02\n';
      expect(formatBmcVersion(output, 'openUBMC')).toBe('1.11.01.02');
    });

    test('AMI 前两字节含字母时使用小写十六进制', () => {
      const output = 'Firmware Revision         : 1.11\nAux Firmware Rev Info     : \n    0xAB\n    0xCD\n    0x00\n    0x00\n';
      expect(formatBmcVersion(output, 'AMI')).toBe('1.11.abcd');
    });

    test('未知厂商只返回主版本号', () => {
      expect(formatBmcVersion(MC_INFO_SAMPLE, 'OpenBMC')).toBe('1.11');
      expect(formatBmcVersion(MC_INFO_SAMPLE, undefined)).toBe('1.11');
    });

    test('字节不足时退回主版本号', () => {
      const output = 'Firmware Revision         : 1.11\nAux Firmware Rev Info     : \n    0x11\n';
      expect(formatBmcVersion(output, 'AMI')).toBe('1.11');
      expect(formatBmcVersion(output, 'openUBMC')).toBe('1.11');
    });

    test('缺失 Aux 段时退回主版本号', () => {
      expect(formatBmcVersion('Firmware Revision         : 3.05', 'AMI')).toBe('3.05');
    });

    test('无 Firmware Revision 时返回空字符串', () => {
      expect(formatBmcVersion('Aux Firmware Rev Info     : \n    0x11\n    0x09\n', 'AMI')).toBe('');
      expect(formatBmcVersion('', 'AMI')).toBe('');
      expect(formatBmcVersion(null, 'AMI')).toBe('');
    });
  });

  describe('VERSION_RULES', () => {
    test('AMI 与 openUBMC 的取值规则应与文档一致', () => {
      expect(VERSION_RULES.AMI).toEqual({ bytes: [0, 1], separator: '' });
      expect(VERSION_RULES.openUBMC).toEqual({ bytes: [2, 3], separator: '.' });
    });
  });
});
