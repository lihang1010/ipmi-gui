/**
 * ipmiTool.js 单元测试
 * 覆盖：连接参数构建 / ipmitool 路径解析 / 命令行分词
 */

jest.mock('fs', () => ({
  existsSync: jest.fn()
}));

const fs = require('fs');
const {
  buildArgs,
  getCandidatePaths,
  resolveIpmiToolPath,
  tokenizeCommand
} = require('../src/modules/ipmiTool');

describe('ipmiTool', () => {
  describe('buildArgs', () => {
    test('应构建完整参数', () => {
      const args = buildArgs({
        host: '192.168.1.100',
        port: 1623,
        username: 'admin',
        password: 'pass',
        interface: 'lanplus',
        cipherSuite: 17,
        privilegeLevel: 'ADMINISTRATOR'
      });

      expect(args).toEqual([
        '-H', '192.168.1.100',
        '-p', '1623',
        '-U', 'admin',
        '-P', 'pass',
        '-I', 'lanplus',
        '-C', '17',
        '-L', 'ADMINISTRATOR'
      ]);
    });

    test('默认端口 623 不应输出 -p', () => {
      expect(buildArgs({ host: '1.1.1.1', port: 623 })).toEqual(['-H', '1.1.1.1']);
    });

    test('空对象应返回空数组', () => {
      expect(buildArgs({})).toEqual([]);
    });

    test('null/undefined 字段应被跳过', () => {
      const args = buildArgs({ host: '1.1.1.1', port: null, username: undefined, password: null });
      expect(args).toEqual(['-H', '1.1.1.1']);
    });
  });

  describe('getCandidatePaths', () => {
    test('应包含 ipmitool.exe 及打包解包路径', () => {
      const candidates = getCandidatePaths();
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates.every(p => p.includes('ipmitool.exe'))).toBe(true);
      expect(candidates.some(p => p.includes('app.asar.unpacked'))).toBe(true);
      expect(candidates.some(p => p.includes('bin'))).toBe(true);
    });
  });

  describe('resolveIpmiToolPath', () => {
    beforeEach(() => {
      fs.existsSync.mockReset();
    });

    test('全部不存在时应返回 null', () => {
      fs.existsSync.mockReturnValue(false);
      expect(resolveIpmiToolPath()).toBeNull();
    });

    test('应返回第一个存在的候选路径', () => {
      const candidates = getCandidatePaths();
      fs.existsSync.mockImplementation(p => p === candidates[0]);
      expect(resolveIpmiToolPath()).toBe(candidates[0]);
    });

    test('应跳过不存在的候选并命中后续路径', () => {
      const candidates = getCandidatePaths();
      const target = candidates[candidates.length - 1];
      fs.existsSync.mockImplementation(p => p === target);
      expect(resolveIpmiToolPath()).toBe(target);
    });

    test('existsSync 抛异常时应继续尝试而不崩溃', () => {
      fs.existsSync.mockImplementation(() => { throw new Error('bad path'); });
      expect(resolveIpmiToolPath()).toBeNull();
    });
  });

  describe('tokenizeCommand', () => {
    test('普通命令按空格拆分', () => {
      expect(tokenizeCommand('power status')).toEqual(['power', 'status']);
      expect(tokenizeCommand('raw 6 1')).toEqual(['raw', '6', '1']);
    });

    test('应保留双引号内的空格', () => {
      expect(tokenizeCommand('fru write 0 "Board Mfg" "Test Value"'))
        .toEqual(['fru', 'write', '0', 'Board Mfg', 'Test Value']);
    });

    test('应保留单引号内的空格', () => {
      expect(tokenizeCommand("user set name 2 'John Doe'"))
        .toEqual(['user', 'set', 'name', '2', 'John Doe']);
    });

    test('应压缩多余空格与制表符', () => {
      expect(tokenizeCommand('  sel   list\t ')).toEqual(['sel', 'list']);
    });

    test('空字符串与 null 应返回空数组', () => {
      expect(tokenizeCommand('')).toEqual([]);
      expect(tokenizeCommand(null)).toEqual([]);
      expect(tokenizeCommand(undefined)).toEqual([]);
    });

    test('空引号应产生空参数', () => {
      expect(tokenizeCommand('chassis " " x')).toEqual(['chassis', ' ', 'x']);
    });

    test('引号内的特殊字符应原样保留', () => {
      expect(tokenizeCommand('user set password 2 "a&b|c>d"'))
        .toEqual(['user', 'set', 'password', '2', 'a&b|c>d']);
    });
  });
});
