/**
 * IPMI 命令构建器单元测试
 */

// 模拟命令构建逻辑
class IpmiCommandBuilder {
  constructor(ipmitoolPath) {
    this.ipmitoolPath = ipmitoolPath;
  }

  buildArgs(server) {
    const args = [];
    if (server.host) args.push('-H', server.host);
    if (server.port && server.port !== 623) args.push('-p', String(server.port));
    if (server.username) args.push('-U', server.username);
    if (server.password) args.push('-P', server.password);
    if (server.interface) args.push('-I', server.interface);
    if (server.cipherSuite) args.push('-C', String(server.cipherSuite));
    if (server.privilegeLevel) args.push('-L', server.privilegeLevel);
    return args;
  }

  buildCommand(server, command, args = []) {
    const cmdArgs = this.buildArgs(server);
    cmdArgs.push(...command.split(' '));
    cmdArgs.push(...args);
    return {
      executable: this.ipmitoolPath,
      args: cmdArgs
    };
  }

  buildPowerCommand(server, action) {
    return this.buildCommand(server, 'power ' + action);
  }

  buildRawCommand(server, rawArgs) {
    return this.buildCommand(server, 'raw ' + rawArgs);
  }

  buildSolCommand(server, action) {
    return this.buildCommand(server, 'sol ' + action);
  }

  buildSensorCommand(server) {
    return this.buildCommand(server, 'sdr list');
  }

  buildFruCommand(server) {
    return this.buildCommand(server, 'fru list');
  }

  buildSelCommand(server, action = 'list') {
    return this.buildCommand(server, 'sel ' + action);
  }

  buildUserCommand(server) {
    return this.buildCommand(server, 'user list');
  }

  buildLanCommand(server) {
    return this.buildCommand(server, 'lan print');
  }
}

describe('IpmiCommandBuilder', () => {
  let builder;
  let testServer;

  beforeEach(() => {
    builder = new IpmiCommandBuilder('/path/to/ipmitool.exe');
    testServer = {
      host: '192.168.1.100',
      port: 623,
      username: 'admin',
      password: 'password123',
      interface: 'lanplus',
      cipherSuite: 17,
      privilegeLevel: 'ADMINISTRATOR'
    };
  });

  describe('buildArgs', () => {
    test('should build basic args', () => {
      const args = builder.buildArgs(testServer);

      expect(args).toContain('-H');
      expect(args).toContain('192.168.1.100');
      expect(args).toContain('-U');
      expect(args).toContain('admin');
      expect(args).toContain('-P');
      expect(args).toContain('password123');
      expect(args).toContain('-I');
      expect(args).toContain('lanplus');
      expect(args).toContain('-C');
      expect(args).toContain('17');
    });

    test('should not include port when default', () => {
      const args = builder.buildArgs(testServer);
      expect(args).not.toContain('-p');
    });

    test('should include port when non-default', () => {
      testServer.port = 624;
      const args = builder.buildArgs(testServer);
      expect(args).toContain('-p');
      expect(args).toContain('624');
    });

    test('should handle minimal server config', () => {
      const minimalServer = { host: '10.0.0.1' };
      const args = builder.buildArgs(minimalServer);

      expect(args).toContain('-H');
      expect(args).toContain('10.0.0.1');
      expect(args).not.toContain('-U');
      expect(args).not.toContain('-P');
    });
  });

  describe('buildCommand', () => {
    test('should build full command', () => {
      const cmd = builder.buildCommand(testServer, 'power status');

      expect(cmd.executable).toBe('/path/to/ipmitool.exe');
      expect(cmd.args).toContain('power');
      expect(cmd.args).toContain('status');
    });

    test('should include additional args', () => {
      const cmd = builder.buildCommand(testServer, 'raw', ['6', '1']);

      expect(cmd.args).toContain('raw');
      expect(cmd.args).toContain('6');
      expect(cmd.args).toContain('1');
    });

    test('should handle command with spaces', () => {
      const cmd = builder.buildCommand(testServer, 'chassis status');

      expect(cmd.args).toContain('chassis');
      expect(cmd.args).toContain('status');
    });
  });

  describe('power commands', () => {
    test('should build power on command', () => {
      const cmd = builder.buildPowerCommand(testServer, 'on');
      expect(cmd.args).toContain('power');
      expect(cmd.args).toContain('on');
    });

    test('should build power off command', () => {
      const cmd = builder.buildPowerCommand(testServer, 'off');
      expect(cmd.args).toContain('power');
      expect(cmd.args).toContain('off');
    });

    test('should build power cycle command', () => {
      const cmd = builder.buildPowerCommand(testServer, 'cycle');
      expect(cmd.args).toContain('power');
      expect(cmd.args).toContain('cycle');
    });

    test('should build power status command', () => {
      const cmd = builder.buildPowerCommand(testServer, 'status');
      expect(cmd.args).toContain('power');
      expect(cmd.args).toContain('status');
    });
  });

  describe('special commands', () => {
    test('should build raw command', () => {
      const cmd = builder.buildRawCommand(testServer, '6 1');
      expect(cmd.args).toContain('raw');
      expect(cmd.args).toContain('6');
      expect(cmd.args).toContain('1');
    });

    test('should build SOL activate command', () => {
      const cmd = builder.buildSolCommand(testServer, 'activate');
      expect(cmd.args).toContain('sol');
      expect(cmd.args).toContain('activate');
    });

    test('should build SOL deactivate command', () => {
      const cmd = builder.buildSolCommand(testServer, 'deactivate');
      expect(cmd.args).toContain('sol');
      expect(cmd.args).toContain('deactivate');
    });

    test('should build sensor command', () => {
      const cmd = builder.buildSensorCommand(testServer);
      expect(cmd.args).toContain('sdr');
      expect(cmd.args).toContain('list');
    });

    test('should build FRU command', () => {
      const cmd = builder.buildFruCommand(testServer);
      expect(cmd.args).toContain('fru');
      expect(cmd.args).toContain('list');
    });

    test('should build SEL command', () => {
      const cmd = builder.buildSelCommand(testServer);
      expect(cmd.args).toContain('sel');
      expect(cmd.args).toContain('list');
    });

    test('should build user command', () => {
      const cmd = builder.buildUserCommand(testServer);
      expect(cmd.args).toContain('user');
      expect(cmd.args).toContain('list');
    });

    test('should build LAN command', () => {
      const cmd = builder.buildLanCommand(testServer);
      expect(cmd.args).toContain('lan');
      expect(cmd.args).toContain('print');
    });
  });

  describe('error handling', () => {
    test('should handle empty server', () => {
      const args = builder.buildArgs({});
      expect(args).toHaveLength(0);
    });

    test('should handle null values', () => {
      const server = {
        host: '1.1.1.1',
        port: null,
        username: null,
        password: null
      };
      const args = builder.buildArgs(server);
      expect(args).toContain('-H');
      expect(args).not.toContain('-p');
    });
  });
});
