/**
 * FRU 逻辑模块单测
 *
 * 夹具取自真实设备的 fru read 镜像（fru id 0，前 168 字节有效数据）：
 *   Chassis  @8  len32  fields @11,16,21,25
 *   Board    @40 len56  fields @46,53,63,68,73,84,88
 *   Product  @96 len72  fields @99,103,119,124,134,139,144,155,159
 * 该镜像的字段顺序、index 映射均已与 ipmitool 1.8.18 真机输出逐条核对。
 */

const fru = require('../src/modules/fru');

// prettier-ignore
const FRU_HEX =
  '010001050c0000ed' +
  '010417c4504e2d43' +
  'c4534e2d43c34e2f' +
  '41c55665723d43c1' +
  '0000000000000089' +
  '0107002d4cf2c654' +
  '5459545459c95431' +
  '4844452d545459c4' +
  '534e2d42c4504e2d' +
  '42ca322e30302e30' +
  '302e3033c34e2f41' +
  'c55665723d44c175' +
  '010900c3414141cf' +
  '5261636b20536572' +
  '76657220424242c4' +
  '504e2d50c94b5039' +
  '323058585858c453' +
  '4e2d50c441542d31' +
  'ca322e30302e3030' +
  '2e3033c34e2f41c5' +
  '5665723d45c1006d';

function makeImage() {
  const buf = Buffer.alloc(2048);
  Buffer.from(FRU_HEX, 'hex').copy(buf);
  return buf;
}

function sectionOf(image, key) {
  return image.sections.find(s => s.key === key);
}

describe('fru.getSection / fieldLabel', () => {
  test('should resolve section by key or short key', () => {
    expect(fru.getSection('product').key).toBe('product');
    expect(fru.getSection('p').key).toBe('product');
    expect(fru.getSection('C').key).toBe('chassis');
    expect(fru.getSection(' B ').key).toBe('board');
    expect(fru.getSection('nope')).toBeNull();
    expect(fru.getSection('')).toBeNull();
  });

  test('should label fixed fields then fall back to Extra', () => {
    const product = fru.getSection('product');
    expect(fru.fieldLabel(product, 0)).toBe('Product Manufacturer');
    expect(fru.fieldLabel(product, 5)).toBe('Product Asset Tag');
    expect(fru.fieldLabel(product, 6)).toBe('Product FRU ID');
    expect(fru.fieldLabel(product, 7)).toBe('Product Extra');
    expect(fru.fieldLabel(product, 9)).toBe('Product Extra');

    const board = fru.getSection('board');
    expect(fru.fieldLabel(board, 4)).toBe('Board FRU ID');
    expect(fru.fieldLabel(board, 5)).toBe('Board Extra');
  });

  test('should expose short keys matching ipmitool section argument', () => {
    expect(fru.FRU_SECTIONS.map(s => s.shortKey)).toEqual(['c', 'b', 'p']);
  });

  test('should keep field offsets aligned with FRU spec area layout', () => {
    const byKey = {};
    fru.FRU_SECTIONS.forEach(s => { byKey[s.key] = s.fieldOffset; });
    expect(byKey).toEqual({ chassis: 3, board: 6, product: 3 });
  });
});

describe('fru.computeChecksum', () => {
  test('should match the stored header checksum', () => {
    const image = makeImage();
    expect(fru.computeChecksum(image, 0, 7)).toBe(image[7]);
    expect(image[7]).toBe(0xed);
  });

  test('should match each area checksum', () => {
    const image = makeImage();
    expect(fru.computeChecksum(image, 8, 31)).toBe(image[39]);
    expect(fru.computeChecksum(image, 40, 55)).toBe(image[95]);
    expect(fru.computeChecksum(image, 96, 71)).toBe(image[167]);
  });
});

describe('fru.decodeFieldValue', () => {
  test('should decode 8-bit ASCII', () => {
    const data = Buffer.from('PN-C', 'latin1');
    expect(fru.decodeFieldValue(data, 0, 4, fru.TYPE_LATIN1)).toBe('PN-C');
  });

  test('should decode BCD plus', () => {
    const data = Buffer.from([0x12, 0x34, 0x56]);
    expect(fru.decodeFieldValue(data, 0, 3, 1)).toBe('123456');
  });

  test('should decode binary as hex', () => {
    const data = Buffer.from([0xab, 0xcd]);
    expect(fru.decodeFieldValue(data, 0, 2, 0)).toBe('abcd');
  });

  test('should decode 6-bit ASCII', () => {
    // 'ABCD' -> 6bit 值 0x21,0x22,0x23,0x24 -> 小端打包 0x9238A1
    const data = Buffer.from([0xa1, 0x38, 0x92]);
    expect(fru.decodeFieldValue(data, 0, 3, 2)).toBe('ABCD');
  });

  test('should return empty string for zero length', () => {
    expect(fru.decodeFieldValue(Buffer.from([0x41]), 0, 0, 3)).toBe('');
  });
});

describe('fru.formatMfgDate', () => {
  test('should decode the real board date (minutes since 1996-01-01)', () => {
    const image = makeImage();
    expect(fru.formatMfgDate(image, 43)).toMatch(/^2026-03-\d{2} \d{2}:\d{2}$/);
  });

  test('should return empty string when date is zero', () => {
    expect(fru.formatMfgDate(Buffer.from([0, 0, 0]), 0)).toBe('');
  });
});

describe('fru.parseFruImage', () => {
  test('should parse header offsets', () => {
    const image = fru.parseFruImage(makeImage());
    expect(image.valid).toBe(true);
    expect(image.header.version).toBe(1);
    expect(image.header.chassisOffset).toBe(8);
    expect(image.header.boardOffset).toBe(40);
    expect(image.header.productOffset).toBe(96);
    expect(image.header.internalOffset).toBe(0);
    expect(image.header.multiOffset).toBe(0);
    expect(image.header.checksumValid).toBe(true);
  });

  test('should parse chassis fields (index 0-3, Chassis Type is not a string field)', () => {
    const section = sectionOf(fru.parseFruImage(makeImage()), 'chassis');
    expect(section.offset).toBe(8);
    expect(section.length).toBe(32);
    expect(section.checksumValid).toBe(true);
    expect(section.fields.map(f => f.value)).toEqual(['PN-C', 'SN-C', 'N/A', 'Ver=C']);
    expect(section.fields.map(f => f.label)).toEqual([
      'Chassis Part Number', 'Chassis Serial', 'Chassis Extra', 'Chassis Extra'
    ]);
    expect(section.fields.map(f => f.offset)).toEqual([11, 16, 21, 25]);
    expect(section.extras.chassisType).toBe('Rack Mount Chassis');
  });

  test('should parse board fields including FRU ID at index 4', () => {
    const section = sectionOf(fru.parseFruImage(makeImage()), 'board');
    expect(section.offset).toBe(40);
    expect(section.length).toBe(56);
    expect(section.fields.map(f => f.value)).toEqual([
      'TTYTTY', 'T1HDE-TTY', 'SN-B', 'PN-B', '2.00.00.03', 'N/A', 'Ver=D'
    ]);
    expect(section.fields[4].label).toBe('Board FRU ID');
    expect(section.fields[5].label).toBe('Board Extra');
    expect(section.fields.map(f => f.offset)).toEqual([46, 53, 63, 68, 73, 84, 88]);
    expect(section.extras.mfgDate).toMatch(/^2026-03-\d{2} \d{2}:\d{2}$/);
  });

  test('should parse product fields with the exact index used by fru edit', () => {
    const section = sectionOf(fru.parseFruImage(makeImage()), 'product');
    expect(section.fields.map(f => f.value)).toEqual([
      'AAA', 'Rack Server BBB', 'PN-P', 'KP920XXXX', 'SN-P', 'AT-1',
      '2.00.00.03', 'N/A', 'Ver=E'
    ]);
    // 真机验证：fru edit 0 field p 5 命中 Product Asset Tag
    expect(section.fields[5].value).toBe('AT-1');
    expect(section.fields[5].label).toBe('Product Asset Tag');
    // 真机验证：fru edit 0 field p 7 命中 Product Extra
    expect(section.fields[7].value).toBe('N/A');
    expect(section.fields[7].label).toBe('Product Extra');
    expect(section.fields.map(f => f.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  test('should stop at the field end marker and ignore trailing padding', () => {
    const section = sectionOf(fru.parseFruImage(makeImage()), 'product');
    expect(section.fields).toHaveLength(9);
    const image = makeImage();
    expect(image[165]).toBe(0xc1);
  });

  test('should mark 8-bit ASCII non-empty fields within index 0-9 editable', () => {
    const section = sectionOf(fru.parseFruImage(makeImage()), 'product');
    expect(section.fields.every(f => f.editable)).toBe(true);
    expect(section.fields.every(f => f.type === fru.TYPE_LATIN1)).toBe(true);
  });

  test('should reject non FRU buffers', () => {
    expect(fru.parseFruImage(null).valid).toBe(false);
    expect(fru.parseFruImage(Buffer.alloc(4)).valid).toBe(false);
    const bad = makeImage();
    bad[0] = 0x02;
    const result = fru.parseFruImage(bad);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('0x2');
  });

  test('should skip areas declared absent in the header', () => {
    const image = makeImage();
    image[3] = 0x00; // Board 区缺失
    const parsed = fru.parseFruImage(image);
    expect(parsed.sections.map(s => s.key)).toEqual(['chassis', 'product']);
  });
});

describe('fru.listEditableFields', () => {
  test('should flatten editable fields with section context', () => {
    const list = fru.listEditableFields(fru.parseFruImage(makeImage()));
    expect(list).toHaveLength(4 + 7 + 9);
    const assetTag = list.find(f => f.label === 'Product Asset Tag');
    expect(assetTag).toMatchObject({
      sectionKey: 'product',
      sectionShortKey: 'p',
      index: 5,
      value: 'AT-1'
    });
  });

  test('should return empty array for invalid image', () => {
    expect(fru.listEditableFields(null)).toEqual([]);
  });
});

describe('fru.validateFruString', () => {
  test('should accept printable ASCII within limit', () => {
    expect(fru.validateFruString('FRU-VERIFY-20260928')).toMatchObject({ ok: true, bytes: 19 });
    expect(fru.validateFruString('A'.repeat(63)).ok).toBe(true);
  });

  test('should reject empty string', () => {
    const result = fru.validateFruString('');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('不能为空');
  });

  test('should reject strings longer than 63 bytes', () => {
    const result = fru.validateFruString('A'.repeat(64));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('63');
  });

  test('should reject non ASCII characters', () => {
    expect(fru.validateFruString('服务器').ok).toBe(false);
    expect(fru.validateFruString('PN\t1').ok).toBe(false);
    expect(fru.validateFruString('PN\u00001').ok).toBe(false);
  });

  test('should reject non string input', () => {
    expect(fru.validateFruString(123).ok).toBe(false);
    expect(fru.validateFruString(null).ok).toBe(false);
  });
});

describe('fru.buildEditInvocation', () => {
  test('should build a single-letter section and digit index command', () => {
    const result = fru.buildEditInvocation({
      fruId: 0, section: 'product', index: 7, value: 'N/A'
    });
    expect(result.ok).toBe(true);
    // 新值走 argv，不拼进命令字符串
    expect(result.command).toBe('fru edit 0 field p 7');
    expect(result.args).toEqual(['N/A']);
  });

  test('should accept section short key and normalize to it', () => {
    expect(fru.buildEditInvocation({ fruId: 0, section: 'b', index: 3, value: 'X' }).command)
      .toBe('fru edit 0 field b 3');
    expect(fru.buildEditInvocation({ fruId: 0, section: 'chassis', index: 2, value: 'X' }).command)
      .toBe('fru edit 0 field c 2');
  });

  test('should preserve spaces and quotes in the value via argv', () => {
    const result = fru.buildEditInvocation({
      fruId: 0, section: 'product', index: 1, value: 'Rack Server "BBB"'
    });
    expect(result.ok).toBe(true);
    expect(result.args).toEqual(['Rack Server "BBB"']);
    expect(result.command).not.toContain('Rack');
  });

  test('should reject index above 9 (ipmitool only parses one digit)', () => {
    const result = fru.buildEditInvocation({ fruId: 0, section: 'product', index: 10, value: 'X' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('0-9');
    // "50" 会被 ipmitool 当作 5，必须拦住
    expect(fru.buildEditInvocation({ fruId: 0, section: 'product', index: 50, value: 'X' }).ok).toBe(false);
  });

  test('should reject negative, fractional and non numeric index', () => {
    expect(fru.buildEditInvocation({ fruId: 0, section: 'product', index: -1, value: 'X' }).ok).toBe(false);
    expect(fru.buildEditInvocation({ fruId: 0, section: 'product', index: 1.5, value: 'X' }).ok).toBe(false);
    expect(fru.buildEditInvocation({ fruId: 0, section: 'product', index: 'abc', value: 'X' }).ok).toBe(false);
  });

  test('should reject unknown section and invalid value', () => {
    expect(fru.buildEditInvocation({ fruId: 0, section: 'xz', index: 1, value: 'X' }).ok).toBe(false);
    expect(fru.buildEditInvocation({ fruId: 0, section: 'product', index: 1, value: '' }).ok).toBe(false);
  });
});

describe('fru.parseEditResult', () => {
  test('should detect resize success (exit code is 1 even on success)', () => {
    const result = fru.parseEditResult({ code: 1, stderr: '', stdout: [
      'String size are not equal, resizing fru to fit new string',
      'Read All FRU area',
      "Updating Field : 'N/A' with 'FRU-VERIFY-20260928' ... (Length from '195' to '211')",
      'Calculate New Checksum: ffffff60',
      'Writing new FRU.',
      'Done.'
    ].join('\n') });

    expect(result.ok).toBe(true);
    expect(result.oldValue).toBe('N/A');
    expect(result.newValue).toBe('FRU-VERIFY-20260928');
  });

  test('should treat the same-size in-place path as success (no Done. marker)', () => {
    // 真机原文：新值与旧值等长时 ipmi_fru.c:4977 走原地替换，只打印这一行，
    // 既不打印 `Writing new FRU.` 也不打印 `Done.`，退出码为 0
    const result = fru.parseEditResult({
      code: 0,
      stderr: 'Running Get PICMG Properties my_addr 0x20\n',
      stdout: "Updating Field 'AAA' with 'XYZ' ...\n"
    });

    expect(result.ok).toBe(true);
    expect(result.oldValue).toBe('AAA');
    expect(result.newValue).toBe('XYZ');
  });

  test('should report field not found', () => {
    const result = fru.parseEditResult({ code: 1, stdout: 'Field not found !\n', stderr: '' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('为空字段或序号超出');
  });

  test('should report field not found from the rebuild path', () => {
    expect(fru.parseEditResult({ stdout: 'Field not found (1)!\n' }).ok).toBe(false);
  });

  test('should report wrong field type', () => {
    const result = fru.parseEditResult({ stdout: 'Wrong field type.' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('区域标识无效');
  });

  test('should report device not present', () => {
    expect(fru.parseEditResult({ stdout: ' Device not present (Insufficient privilege level)\n' }).ok).toBe(false);
    expect(fru.parseEditResult({ stdout: ' Device not present (No Response)\n' }).error).toContain('设备未响应');
  });

  test('should report write failure and point the user to refresh', () => {
    const result = fru.parseEditResult({ stdout: 'Write to FRU data failed.\n' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('写入 FRU 失败');
    expect(result.error).toContain('刷新');
  });

  test('should still fail when the error follows Updating Field', () => {
    // 失败时同样会先打印 Updating Field，错误行在它之后 —— 错误判定必须先于成功判定
    const result = fru.parseEditResult({
      code: 1,
      stderr: '',
      stdout: "Updating Field 'AAA' with 'XYZ' ...\nWrite to FRU data failed.\n"
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('写入 FRU 失败');
  });

  test('should report the rebuild padding error', () => {
    const result = fru.parseEditResult({
      stdout: 'Internal error, padding length 9 (must be from 0 to 7) '
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('padding');
  });

  test('should report usage errors coming from stderr', () => {
    const result = fru.parseEditResult({ code: 1, stdout: '', stderr: 'Not enough parameters given.' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('参数不足');
  });

  test('should handle empty result', () => {
    expect(fru.parseEditResult({}).ok).toBe(false);
    expect(fru.parseEditResult(null).error).toContain('无任何输出');
  });
});

describe('fru.verifyFieldValue', () => {
  test('should pass when the readback matches', () => {
    const image = fru.parseFruImage(makeImage());
    expect(fru.verifyFieldValue(image, 'p', 5, 'AT-1')).toMatchObject({ ok: true, actual: 'AT-1' });
  });

  test('should fail when the readback differs', () => {
    const image = fru.parseFruImage(makeImage());
    const result = fru.verifyFieldValue(image, 'product', 7, 'CHANGED');
    expect(result.ok).toBe(false);
    expect(result.actual).toBe('N/A');
    expect(result.expected).toBe('CHANGED');
  });

  test('should fail for unknown section / index / invalid image', () => {
    const image = fru.parseFruImage(makeImage());
    expect(fru.verifyFieldValue(image, 'zz', 0, 'x').ok).toBe(false);
    expect(fru.verifyFieldValue(image, 'product', 42, 'x').ok).toBe(false);
    expect(fru.verifyFieldValue(null, 'product', 0, 'x').ok).toBe(false);
  });
});

describe('fru.buildBackupFileName', () => {
  test('should include host, fru id and timestamp', () => {
    const name = fru.buildBackupFileName({
      host: '192.168.60.44',
      fruId: 0,
      now: new Date(2026, 8, 28, 15, 8, 35)
    });
    expect(name).toBe('fru-192.168.60.44-id0-20260928-150835.bin');
  });

  test('should sanitize unsafe host characters', () => {
    const name = fru.buildBackupFileName({ host: 'host:623/we ird', fruId: 2, now: new Date(2026, 0, 2, 3, 4, 5) });
    expect(name).toBe('fru-host_623_we_ird-id2-20260102-030405.bin');
  });
});

describe('fru 已移除的确认文本构造', () => {
  test('点「写入」直接生效后不应再导出 formatDiffText', () => {
    expect(fru.formatDiffText).toBeUndefined();
    expect(fru.buildDiffText).toBeUndefined();
  });
});

describe('fru.parseFruList', () => {
  test('should parse fru list output', () => {
    const output = [
      'FRU Device Description : Builtin FRU Device (ID 0)',
      'FRU Device Description : PSU1 (ID 2)',
      'FRU Device Description : PSU2 (ID 3)',
      'FRU Device Description : CpuBoard1 (ID 1)'
    ].join('\r\n');

    const list = fru.parseFruList(output);
    expect(list).toHaveLength(4);
    expect(list[0]).toEqual({ id: '0', description: 'Builtin FRU Device' });
    expect(list[1]).toEqual({ id: '2', description: 'PSU1' });
    expect(list[3]).toEqual({ id: '1', description: 'CpuBoard1' });
  });

  test('should ignore unrelated lines and handle empty input', () => {
    expect(fru.parseFruList('Chassis Type : Rack Mount Chassis')).toEqual([]);
    expect(fru.parseFruList('')).toEqual([]);
    expect(fru.parseFruList(null)).toEqual([]);
  });
});

/**
 * fru print 解析（方案 C 的快速预览数据源）
 *
 * 夹具是 192.168.60.44 fru id 0 的 `fru print -v 0` 真实 stdout
 * （`-v` 的 PICMG 调试信息走 stderr，不在其中）。
 */
describe('fru.parseFruPrint', () => {
  // prettier-ignore
  const PRINT_V_OUTPUT = [
    ' Chassis Type          : Rack Mount Chassis',
    ' Chassis Part Number   : 2222222222',
    ' Chassis Serial        : SN-C123',
    ' Chassis Extra         : N/A',
    ' Chassis Extra         : Ver=C',
    ' Board Mfg Date        : Wed Mar 11 13:33:00 2026',
    ' Board Mfg             : TTYTTY',
    ' Board Product         : T1HDE-TTY',
    ' Board Serial          : SN-B',
    ' Board Part Number     : PN-B',
    ' Board FRU ID          : 2.00.35.03',
    ' Board Extra           : N/A',
    ' Board Extra           : Ver=D',
    ' Product Manufacturer  : AAA',
    ' Product Name          : Rack Server BBB',
    ' Product Part Number   : PN-P',
    ' Product Version       : KP920XXXX',
    ' Product Serial        : SN-P',
    ' Product Asset Tag     : AT-1',
    ' Product FRU ID        : 2.00.00.03',
    ' Product Extra         : N/A',
    ' Product Extra         : Ver=E'
  ].join('\n');

  test('should parse fields and infer index from labels', () => {
    const image = fru.parseFruPrint(PRINT_V_OUTPUT);

    expect(image.valid).toBe(true);
    expect(image.source).toBe('print');

    const product = sectionOf(image, 'product');
    expect(product.fields.map(f => [f.index, f.label, f.value])).toEqual([
      [0, 'Product Manufacturer', 'AAA'],
      [1, 'Product Name', 'Rack Server BBB'],
      [2, 'Product Part Number', 'PN-P'],
      [3, 'Product Version', 'KP920XXXX'],
      [4, 'Product Serial', 'SN-P'],
      [5, 'Product Asset Tag', 'AT-1'],
      [6, 'Product FRU ID', '2.00.00.03'],
      [7, 'Product Extra', 'N/A'],
      [8, 'Product Extra', 'Ver=E']
    ]);
  });

  test('should infer exactly the same indexes as the binary image', () => {
    // 同一台设备：fru print -v 与 fru read 的 (区, 序号, 标签) 必须一一对应
    const fromPrint = fru.parseFruPrint(PRINT_V_OUTPUT);
    const fromBinary = fru.parseFruImage(makeImage());
    const shape = (image) => image.sections.map(s => ({
      key: s.key,
      fields: s.fields.map(f => [f.index, f.label])
    }));

    expect(shape(fromPrint)).toEqual(shape(fromBinary));
  });

  test('should not shift indexes when empty fields are omitted', () => {
    // print 会整行跳过空字段：删掉 Board Product 与 Product Version 两行来模拟
    const withGaps = PRINT_V_OUTPUT
      .split('\n')
      .filter(line => !/Board Product|Product Version/.test(line))
      .join('\n');

    const image = fru.parseFruPrint(withGaps);

    expect(sectionOf(image, 'board').fields.map(f => [f.index, f.label])).toEqual([
      [0, 'Board Mfg'],
      [2, 'Board Serial'],
      [3, 'Board Part Number'],
      [4, 'Board FRU ID'],
      [5, 'Board Extra'],
      [6, 'Board Extra']
    ]);
    // 关键：后续字段的序号不受前面缺失字段影响
    expect(sectionOf(image, 'product').fields.find(f => f.index === 7).label).toBe('Product Extra');
  });

  test('should expose non-string fields as readonly extras without consuming index', () => {
    const image = fru.parseFruPrint(PRINT_V_OUTPUT);

    expect(sectionOf(image, 'chassis').extras.chassisType).toBe('Rack Mount Chassis');
    expect(sectionOf(image, 'board').extras.mfgDate).toBe('Wed Mar 11 13:33:00 2026');
    // Chassis Type 不占字段序号
    expect(sectionOf(image, 'chassis').fields[0]).toMatchObject({
      index: 0,
      label: 'Chassis Part Number'
    });
  });

  test('should ignore internal use area and unrecognised labels', () => {
    const text = PRINT_V_OUTPUT +
      '\n Internal Use Area Offset : 0x60\n Internal Use Area Size   : 32\n Unknown Column           : x';
    const image = fru.parseFruPrint(text);
    const labels = image.sections.flatMap(s => s.fields.map(f => f.label));

    expect(labels).not.toContain('Internal Use Area Offset');
    expect(labels).not.toContain('Internal Use Area Size');
    expect(labels).not.toContain('Unknown Column');
  });

  test('should mark fields above index 9 as not editable', () => {
    const lines = [' Chassis Type          : Rack Mount Chassis', ' Chassis Part Number   : PN'];
    for (let i = 0; i < 12; i++) lines.push(' Chassis Extra         : E' + i);

    const chassis = sectionOf(fru.parseFruPrint(lines.join('\n')), 'chassis');
    expect(chassis.fields.find(f => f.index === 9).editable).toBe(true);
    expect(chassis.fields.find(f => f.index === 10).editable).toBe(false);
  });

  test('should reject empty or unrecognisable output', () => {
    expect(fru.parseFruPrint('')).toMatchObject({ valid: false, source: 'print' });
    expect(fru.parseFruPrint(null).valid).toBe(false);
    expect(fru.parseFruPrint('   \n  ').valid).toBe(false);
    expect(fru.parseFruPrint('hello world').valid).toBe(false);
  });
});
