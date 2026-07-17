/**
 * 输出解析器单元测试
 */

// 模拟输出解析逻辑
class OutputParser {
  static parseSensorList(output) {
    const sensors = [];
    if (!output) return sensors;

    const lines = output.trim().split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('ID') || trimmed.startsWith('---')) continue;

      const parts = trimmed.split('|');
      if (parts.length >= 3) {
        sensors.push({
          name: parts[0].trim(),
          value: parts[1].trim(),
          status: parts[2].trim()
        });
      }
    }
    return sensors;
  }

  static parseFruList(output) {
    const frus = [];
    if (!output) return frus;

    const lines = output.trim().split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      const match = trimmed.match(/FRU Device Description\s*:\s*(.*)/);
      if (match) {
        const desc = match[1];
        const idMatch = desc.match(/ID\s+(\d+)/);
        frus.push({
          id: idMatch ? idMatch[1] : '',
          description: desc
        });
      }
    }
    return frus;
  }

  static parseSelList(output) {
    const events = [];
    if (!output) return events;

    const lines = output.trim().split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('SEL')) continue;

      const parts = trimmed.split('|');
      if (parts.length >= 4) {
        events.push({
          recordId: parts[0].trim(),
          date: parts[1].trim(),
          time: parts[2].trim(),
          type: parts[3].trim(),
          data: parts.length > 4 ? parts.slice(4).join('|').trim() : ''
        });
      }
    }
    return events;
  }

  static parseUserList(output) {
    const users = [];
    if (!output) return users;

    const lines = output.trim().split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('ID') || trimmed.startsWith('---')) continue;

      const parts = trimmed.split('|');
      if (parts.length >= 6) {
        users.push({
          id: parts[0].trim(),
          name: parts[1].trim(),
          callin: parts[2].trim(),
          ipmi: parts[3].trim(),
          linkAuth: parts[4].trim(),
          privilegeLevel: parts[5].trim()
        });
      }
    }
    return users;
  }

  static parseLanPrint(output) {
    const result = {};
    if (!output) return result;

    const lines = output.trim().split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith('IP Address')) {
        result.ipAddress = trimmed.split(':').slice(1).join(':').trim();
      } else if (trimmed.startsWith('MAC Address')) {
        result.macAddress = trimmed.split(':').slice(1).join(':').trim();
      } else if (trimmed.startsWith('Subnet Mask')) {
        result.subnetMask = trimmed.split(':').slice(1).join(':').trim();
      }
    }
    return result;
  }

  static parseChassisStatus(output) {
    const result = {};
    if (!output) return result;

    const lines = output.trim().split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.includes('System Power')) {
        result.powerState = trimmed.toLowerCase().includes('on') ? 'On' : 'Off';
      } else if (trimmed.includes('Last Power Event')) {
        result.lastPowerEvent = trimmed.split(':').pop().trim();
      }
    }
    return result;
  }

  static isSuccess(returncode) {
    return returncode === 0;
  }

  static formatError(stderr, returncode) {
    if (returncode === -1) return '命令执行超时';
    if (returncode === -2) return '找不到 ipmitool';
    if (returncode === -3) return `执行错误: ${stderr}`;
    if (stderr) return stderr.trim();
    return `命令执行失败 (返回码: ${returncode})`;
  }
}

describe('OutputParser', () => {
  describe('parseSensorList', () => {
    test('should parse sensor list output', () => {
      const output = `CPU Temp         | 45 degrees C      | ok
System Fan 1     | 3200 RPM          | ok
+12V             | 12.06 Volts       | ok`;

      const sensors = OutputParser.parseSensorList(output);

      expect(sensors).toHaveLength(3);
      expect(sensors[0].name).toBe('CPU Temp');
      expect(sensors[0].value).toBe('45 degrees C');
      expect(sensors[0].status).toBe('ok');
    });

    test('should skip header lines', () => {
      const output = `ID  | Sensor Name      | Value
----|------------------|------
1   | Temp1            | 45`;

      const sensors = OutputParser.parseSensorList(output);
      expect(sensors).toHaveLength(1);
    });

    test('should handle empty output', () => {
      expect(OutputParser.parseSensorList('')).toHaveLength(0);
      expect(OutputParser.parseSensorList(null)).toHaveLength(0);
    });
  });

  describe('parseFruList', () => {
    test('should parse FRU list output', () => {
      const output = `FRU Device Description : Builtin FRU Device (ID 0)
FRU Device Description : Slot 1 (ID 1)`;

      const frus = OutputParser.parseFruList(output);

      expect(frus).toHaveLength(2);
      expect(frus[0].id).toBe('0');
      expect(frus[0].description).toContain('Builtin FRU Device');
    });

    test('should handle empty output', () => {
      expect(OutputParser.parseFruList('')).toHaveLength(0);
    });
  });

  describe('parseSelList', () => {
    test('should parse SEL list output', () => {
      const output = `SEL Information
Version          : 1.5
Entries          : 5
1 | 01/01/2024 | 12:00:00 | OEM #0xff | Test event`;

      const events = OutputParser.parseSelList(output);

      expect(events).toHaveLength(1);
      expect(events[0].recordId).toBe('1');
      expect(events[0].date).toBe('01/01/2024');
      expect(events[0].time).toBe('12:00:00');
    });

    test('should skip SEL header lines', () => {
      const output = `SEL Information
Version          : 1.5`;

      const events = OutputParser.parseSelList(output);
      expect(events).toHaveLength(0);
    });
  });

  describe('parseUserList', () => {
    test('should parse user list output', () => {
      const output = `ID  Name             Callin  Link Auth  IPMI Msg   Privilege
----|----------------|-------|----------|----------|------------
1   | user1          | true  | true     | true     | USER
2   | admin          | true  | true     | true     | ADMINISTRATOR`;

      const users = OutputParser.parseUserList(output);

      expect(users).toHaveLength(2);
      expect(users[0].id).toBe('1');
      expect(users[0].name).toBe('user1');
      expect(users[1].id).toBe('2');
      expect(users[1].name).toBe('admin');
      expect(users[1].privilegeLevel).toBe('ADMINISTRATOR');
    });

    test('should skip header lines', () => {
      const output = `ID  Name             Callin
----|----------------|------`;

      const users = OutputParser.parseUserList(output);
      expect(users).toHaveLength(0);
    });
  });

  describe('parseLanPrint', () => {
    test('should parse LAN print output', () => {
      const output = `IP Address               : 192.168.1.100
MAC Address              : 00:11:22:33:44:55
Subnet Mask              : 255.255.255.0`;

      const result = OutputParser.parseLanPrint(output);

      expect(result.ipAddress).toBe('192.168.1.100');
      expect(result.macAddress).toBe('00:11:22:33:44:55');
      expect(result.subnetMask).toBe('255.255.255.0');
    });

    test('should handle empty output', () => {
      const result = OutputParser.parseLanPrint('');
      expect(Object.keys(result)).toHaveLength(0);
    });
  });

  describe('parseChassisStatus', () => {
    test('should parse chassis status output', () => {
      const output = `System Power          : ON
Last Power Event      : power-on
Chassis Intrusion     : inactive`;

      const result = OutputParser.parseChassisStatus(output);

      expect(result.powerState).toBe('On');
      expect(result.lastPowerEvent).toBe('power-on');
    });

    test('should detect power off', () => {
      const output = `System Power          : OFF`;
      const result = OutputParser.parseChassisStatus(output);
      expect(result.powerState).toBe('Off');
    });
  });

  describe('utility functions', () => {
    test('isSuccess should return true for code 0', () => {
      expect(OutputParser.isSuccess(0)).toBe(true);
    });

    test('isSuccess should return false for non-zero codes', () => {
      expect(OutputParser.isSuccess(1)).toBe(false);
      expect(OutputParser.isSuccess(-1)).toBe(false);
    });

    test('formatError should handle timeout', () => {
      const result = OutputParser.formatError('', -1);
      expect(result).toBe('命令执行超时');
    });

    test('formatError should handle not found', () => {
      const result = OutputParser.formatError('', -2);
      expect(result).toBe('找不到 ipmitool');
    });

    test('formatError should include stderr', () => {
      const result = OutputParser.formatError('Connection refused', 1);
      expect(result).toBe('Connection refused');
    });
  });
});
