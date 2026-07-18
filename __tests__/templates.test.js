/**
 * templates 模块单元测试
 */

const { SERVER_TEMPLATES } = require('../src/modules/templates');

describe('Templates Module', () => {
  describe('SERVER_TEMPLATES', () => {
    test('should have openUBMC template', () => {
      expect(SERVER_TEMPLATES.openubmc).toBeDefined();
      expect(SERVER_TEMPLATES.openubmc.name).toBe('openUBMC');
      expect(SERVER_TEMPLATES.openubmc.username).toBe('Administrator');
      expect(SERVER_TEMPLATES.openubmc.password).toBe('ttytty`12');
    });

    test('should have AMI template', () => {
      expect(SERVER_TEMPLATES.ami).toBeDefined();
      expect(SERVER_TEMPLATES.ami.name).toBe('AMI');
      expect(SERVER_TEMPLATES.ami.username).toBe('admin');
      expect(SERVER_TEMPLATES.ami.password).toBe('admin');
    });

    test('should have OpenBMC template', () => {
      expect(SERVER_TEMPLATES.openbmc).toBeDefined();
      expect(SERVER_TEMPLATES.openbmc.name).toBe('OpenBMC');
      expect(SERVER_TEMPLATES.openbmc.username).toBe('root');
      expect(SERVER_TEMPLATES.openbmc.password).toBe('0penBmc');
    });

    test('all templates should have required fields', () => {
      Object.values(SERVER_TEMPLATES).forEach(template => {
        expect(template).toHaveProperty('name');
        expect(template).toHaveProperty('username');
        expect(template).toHaveProperty('password');
        expect(template).toHaveProperty('interface');
        expect(template).toHaveProperty('cipherSuite');
      });
    });

    test('all templates should use lanplus interface', () => {
      Object.values(SERVER_TEMPLATES).forEach(template => {
        expect(template.interface).toBe('lanplus');
      });
    });

    test('all templates should use cipher suite 17', () => {
      Object.values(SERVER_TEMPLATES).forEach(template => {
        expect(template.cipherSuite).toBe(17);
      });
    });
  });
});
