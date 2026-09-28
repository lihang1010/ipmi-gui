/**
 * credentials.js 单元测试
 * 验证默认凭据统一来自 src/config/ipmi-credentials.json
 */

const {
  getCredentialTemplates,
  getCredentialByName,
  getServerTemplates,
  DEFAULT_TEMPLATES
} = require('../src/modules/credentials');

describe('credentials', () => {
  describe('getCredentialTemplates', () => {
    test('应返回配置文件中的全部模板', () => {
      const templates = getCredentialTemplates();
      expect(Array.isArray(templates)).toBe(true);
      expect(templates.map(t => t.name)).toEqual(['AMI', 'openUBMC', 'OpenBMC']);
    });

    test('每个模板都应包含用户名与密码', () => {
      getCredentialTemplates().forEach(template => {
        expect(typeof template.name).toBe('string');
        expect(typeof template.username).toBe('string');
        expect(typeof template.password).toBe('string');
      });
    });
  });

  describe('getCredentialByName', () => {
    test('应支持精确名称匹配', () => {
      expect(getCredentialByName('openUBMC').username).toBe('Administrator');
      expect(getCredentialByName('AMI').username).toBe('admin');
      expect(getCredentialByName('OpenBMC').username).toBe('root');
    });

    test('名称匹配应忽略大小写', () => {
      expect(getCredentialByName('openubmc').password).toBe('ttytty`12');
      expect(getCredentialByName('ami').password).toBe('admin');
      expect(getCredentialByName('openbmc').password).toBe('0penBmc');
    });

    test('未知名称应返回 null', () => {
      expect(getCredentialByName('unknown-vendor')).toBeNull();
    });

    test('空值应返回 null', () => {
      expect(getCredentialByName(null)).toBeNull();
      expect(getCredentialByName(undefined)).toBeNull();
      expect(getCredentialByName('')).toBeNull();
    });
  });

  describe('getServerTemplates', () => {
    test('key 应与 index.html 的 option value 对应', () => {
      const templates = getServerTemplates();
      expect(Object.keys(templates).sort()).toEqual(['ami', 'openbmc', 'openubmc']);
    });

    test('应包含 UI 元数据与统一凭据', () => {
      const templates = getServerTemplates();
      expect(templates.openubmc.name).toBe('openUBMC');
      expect(templates.openubmc.username).toBe('Administrator');
      expect(templates.openubmc.password).toBe('ttytty`12');
      expect(templates.openubmc.interface).toBe('lanplus');
      expect(templates.openubmc.cipherSuite).toBe(17);
    });

    test('所有模板都应具备 interface 与 cipherSuite', () => {
      Object.values(getServerTemplates()).forEach(template => {
        expect(template.interface).toBeTruthy();
        expect(typeof template.cipherSuite).toBe('number');
      });
    });
  });

  describe('配置文件缺失时的兜底', () => {
    afterEach(() => {
      jest.dontMock('../src/config/ipmi-credentials.json');
      jest.resetModules();
    });

    test('模板为空时应回退到内置模板', () => {
      jest.resetModules();
      jest.doMock('../src/config/ipmi-credentials.json', () => ({ templates: [] }));

      const fresh = require('../src/modules/credentials');
      expect(fresh.getCredentialTemplates()).toEqual(fresh.DEFAULT_TEMPLATES);
      expect(fresh.getCredentialByName('openUBMC').password).toBe('ttytty`12');
      expect(Object.keys(fresh.getServerTemplates()).sort()).toEqual(['ami', 'openbmc', 'openubmc']);
    });

    test('内置兜底模板应与配置文件内容一致', () => {
      const fromFile = {};
      getCredentialTemplates().forEach(t => { fromFile[t.name] = t.password; });
      const fromDefault = {};
      DEFAULT_TEMPLATES.forEach(t => { fromDefault[t.name] = t.password; });
      expect(fromDefault).toEqual(fromFile);
    });
  });
});
