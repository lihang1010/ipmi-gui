/**
 * FRU 视图模块单测（只覆盖纯函数：渲染 / 编排决策 / 结果判定）
 *
 * DOM 与 IPC 编排部分依赖注入，由 renderer 接线，测试聚焦可确定性的逻辑。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const fruView = require('../src/modules/fruView');

/** 构造一个最小可用的 parseFruImage 产物（结构对齐 fru.parseFruImage） */
function makeImage(overrides) {
  const image = {
    valid: true,
    error: null,
    size: 2048,
    header: { version: 1, checksumValid: true, chassisOffset: 8, boardOffset: 40, productOffset: 96 },
    sections: [
      {
        key: 'chassis', shortKey: 'c', label: 'Chassis', title: 'Chassis（机箱）',
        offset: 8, length: 32, checksumValid: true,
        extras: { chassisType: 'Rack Mount Chassis', chassisTypeRaw: 23 },
        fields: [
          { index: 0, label: 'Chassis Part Number', value: 'PN-C', type: 3, rawLength: 4, offset: 11, editable: true },
          { index: 1, label: 'Chassis Serial', value: 'SN-C', type: 3, rawLength: 4, offset: 16, editable: true }
        ]
      },
      {
        key: 'board', shortKey: 'b', label: 'Board', title: 'Board（主板）',
        offset: 40, length: 56, checksumValid: true,
        extras: { mfgDate: '2026-03-11 13:33' },
        fields: [
          { index: 0, label: 'Board Mfg', value: 'TTYTTY', type: 3, rawLength: 6, offset: 46, editable: true }
        ]
      },
      {
        key: 'product', shortKey: 'p', label: 'Product', title: 'Product（产品）',
        offset: 96, length: 72, checksumValid: true,
        extras: {},
        fields: [
          { index: 5, label: 'Product Asset Tag', value: 'AT-1', type: 3, rawLength: 4, offset: 139, editable: true },
          { index: 7, label: 'Product Extra', value: 'N/A', type: 3, rawLength: 3, offset: 155, editable: true },
          { index: 8, label: 'Product Extra', value: '', type: 3, rawLength: 0, offset: 159, editable: false },
          { index: 9, label: 'Product Extra', value: 'binary', type: 0, rawLength: 3, offset: 162, editable: false },
          { index: 10, label: 'Product Extra', value: 'over-limit', type: 3, rawLength: 10, offset: 165, editable: false }
        ]
      }
    ]
  };

  if (overrides) Object.assign(image, overrides);
  return image;
}

describe('fruView.lockReason', () => {
  test('should allow editable 8-bit ASCII fields', () => {
    expect(fruView.lockReason({ index: 5, value: 'AT-1', type: 3 })).toBe('');
  });

  test('should reject non string encodings', () => {
    expect(fruView.lockReason({ index: 5, value: 'abc', type: 0 })).toContain('8-bit ASCII');
  });

  test('should reject empty fields', () => {
    expect(fruView.lockReason({ index: 5, value: '', type: 3 })).toContain('Field not found');
  });

  test('should reject index beyond ipmitool single digit range', () => {
    expect(fruView.lockReason({ index: 10, value: 'abc', type: 3 })).toContain('0-9');
  });

  test('should handle missing field', () => {
    expect(fruView.lockReason(null)).toBe('字段不存在');
  });
});

describe('fruView.renderFruOptions', () => {
  test('should render options and mark the selected one', () => {
    const html = fruView.renderFruOptions([
      { id: '0', description: 'Builtin FRU Device' },
      { id: '2', description: 'PSU1' }
    ], '2');

    expect(html).toContain('<option value="0">Builtin FRU Device (ID 0)</option>');
    expect(html).toContain('<option value="2" selected>PSU1 (ID 2)</option>');
  });

  test('should render an empty state when no device found', () => {
    expect(fruView.renderFruOptions([], null)).toContain('未发现 FRU 设备');
    expect(fruView.renderFruOptions(null, '0')).toContain('未发现 FRU 设备');
  });

  test('should escape device descriptions', () => {
    const html = fruView.renderFruOptions([{ id: '1', description: '<img src=x onerror=alert(1)>' }], '1');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});

describe('fruView.renderFruSections', () => {
  test('should render each section with header and read-only extras', () => {
    const html = fruView.renderFruSections(makeImage());

    expect(html).toContain('Chassis（机箱）');
    expect(html).toContain('偏移 0x8 · 32B · 校验和 OK');
    expect(html).toContain('Chassis Type');
    expect(html).toContain('Rack Mount Chassis');
    expect(html).toContain('Board Mfg Date');
    expect(html).toContain('2026-03-11 13:33');
  });

  test('should render edit buttons only for editable fields', () => {
    const html = fruView.renderFruSections(makeImage());

    expect(html).toContain('class="btn btn-sm fru-edit-btn" data-section="p" data-index="5"');
    expect(html).toContain('class="btn btn-sm fru-edit-btn" data-section="p" data-index="7"');
    // index 8 空字段 / 9 非 ASCII / 10 超范围 → 只读
    expect(html).not.toContain('data-section="p" data-index="8"');
    expect(html).not.toContain('data-section="p" data-index="9"');
    expect(html).not.toContain('data-section="p" data-index="10"');
    expect(html).toContain('只读');
  });

  test('should mark empty values', () => {
    const html = fruView.renderFruSections(makeImage());
    expect(html).toContain('fru-field-value empty');
    expect(html).toContain('(空)');
  });

  test('should escape field values coming from the device', () => {
    const image = makeImage();
    image.sections[2].fields[0].value = '<script>require("child_process")</script>';
    const html = fruView.renderFruSections(image);

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('should flag invalid checksums', () => {
    const image = makeImage();
    image.sections[0].checksumValid = false;
    const html = fruView.renderFruSections(image);

    expect(html).toContain('校验和 INVALID');
    expect(html).toContain('fru-section-meta invalid');
  });

  test('should render placeholders for invalid or empty images', () => {
    expect(fruView.renderFruSections(null)).toContain('无法解析 FRU 数据');
    expect(fruView.renderFruSections({ valid: false, error: '未知的 FRU 格式版本: 0x2' }))
      .toContain('未知的 FRU 格式版本: 0x2');
    expect(fruView.renderFruSections({ valid: true, sections: [] })).toContain('没有可解析的信息区');
  });
});

describe('fruView.summarizeImage', () => {
  test('should summarize valid images', () => {
    const summary = fruView.summarizeImage(makeImage(), '0', 'Builtin FRU Device');
    expect(summary.title).toBe('Builtin FRU Device（ID 0）');
    expect(summary.meta).toContain('2048B');
    expect(summary.meta).toContain('3 个信息区');
    expect(summary.meta).toContain('可编辑 5');
    expect(summary.meta).toContain('校验和 正常');
  });

  test('should report invalid images', () => {
    const summary = fruView.summarizeImage(null, '0', '');
    expect(summary.title).toBe('读取失败');
  });

  test('should report checksum anomalies', () => {
    const image = makeImage();
    image.header.checksumValid = false;
    expect(fruView.summarizeImage(image, '0', '').meta).toContain('校验和 异常');
  });
});

describe('fruView.planEdit', () => {
  test('should plan an edit from the parsed image', () => {
    const plan = fruView.planEdit({
      image: makeImage(), fruId: '0', sectionKey: 'p', index: 5, newValue: 'AT-2'
    });

    expect(plan.ok).toBe(true);
    expect(plan.command).toBe('fru edit 0 field p 5');
    expect(plan.args).toEqual(['AT-2']);
    expect(plan.oldValue).toBe('AT-1');
    expect(plan.fieldLabel).toBe('Product Asset Tag');
    expect(plan.sectionKey).toBe('product');
  });

  test('should accept a full section name', () => {
    const plan = fruView.planEdit({
      image: makeImage(), fruId: 0, sectionKey: 'product', index: 7, newValue: 'Ver=F'
    });
    expect(plan.command).toBe('fru edit 0 field p 7');
    expect(plan.oldValue).toBe('N/A');
  });

  test('should reject when FRU data has not been read', () => {
    const plan = fruView.planEdit({ image: null, fruId: '0', sectionKey: 'p', index: 0, newValue: 'X' });
    expect(plan.ok).toBe(false);
    expect(plan.error).toContain('请先刷新');
  });

  test('should reject unknown section / missing area / missing field', () => {
    expect(fruView.planEdit({ image: makeImage(), fruId: '0', sectionKey: 'zz', index: 0, newValue: 'X' }).ok).toBe(false);
    expect(fruView.planEdit({ image: makeImage(), fruId: '0', sectionKey: 'b', index: 5, newValue: 'X' }).error)
      .toContain('不存在');
  });

  test('should reject non editable fields', () => {
    const empty = fruView.planEdit({ image: makeImage(), fruId: '0', sectionKey: 'p', index: 8, newValue: 'X' });
    expect(empty.ok).toBe(false);
    expect(empty.error).toContain('不可编辑');

    const binary = fruView.planEdit({ image: makeImage(), fruId: '0', sectionKey: 'p', index: 9, newValue: 'X' });
    expect(binary.ok).toBe(false);

    const overLimit = fruView.planEdit({ image: makeImage(), fruId: '0', sectionKey: 'p', index: 10, newValue: 'X' });
    expect(overLimit.ok).toBe(false);
  });

  test('should reject invalid new values', () => {
    const plan = fruView.planEdit({ image: makeImage(), fruId: '0', sectionKey: 'p', index: 5, newValue: '' });
    expect(plan.ok).toBe(false);
    expect(plan.error).toContain('不能为空');
  });
});

describe('fruView.evaluateEditOutcome', () => {
  const okStdout = "String size are not equal, resizing fru to fit new string\n" +
    "Updating Field : 'N/A' with 'Ver=F' ... (Length from '195' to '193')\n" +
    'Writing new FRU.\nDone.';

  function readback(value) {
    const image = makeImage();
    image.sections[2].fields[1].value = value;
    return image;
  }

  test('should pass when ipmitool old value and readback both match', () => {
    const outcome = fruView.evaluateEditOutcome({
      editResult: { code: 1, stdout: okStdout, stderr: '' },
      readbackImage: readback('Ver=F'),
      sectionKey: 'product',
      index: 7,
      newValue: 'Ver=F',
      expectedOldValue: 'N/A'
    });

    expect(outcome).toMatchObject({ ok: true, severity: 'ok' });
    expect(outcome.message).toContain('写入成功');
    expect(outcome.message).toContain('Ver=F');
  });

  test('should fail when ipmitool reports a different field (wrong index safety net)', () => {
    const outcome = fruView.evaluateEditOutcome({
      editResult: { code: 1, stdout: "Updating Field : 'AT-1' with 'Ver=F' ... (Length from '195' to '193')\nDone." },
      readbackImage: readback('Ver=F'),
      sectionKey: 'product',
      index: 7,
      newValue: 'Ver=F',
      expectedOldValue: 'N/A'
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('与预期不符');
    expect(outcome.message).toContain('刷新');
    expect(outcome.message).not.toContain('fru write');
  });

  test('should surface ipmitool errors', () => {
    const outcome = fruView.evaluateEditOutcome({
      editResult: { code: 1, stdout: 'Field not found !\n', stderr: '' },
      readbackImage: null,
      sectionKey: 'product',
      index: 8,
      newValue: 'X',
      expectedOldValue: ''
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.severity).toBe('error');
  });

  test('should warn when the readback could not be performed', () => {
    const outcome = fruView.evaluateEditOutcome({
      editResult: { code: 1, stdout: okStdout, stderr: '' },
      readbackImage: null,
      sectionKey: 'product',
      index: 7,
      newValue: 'Ver=F',
      expectedOldValue: 'N/A'
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.severity).toBe('warning');
  });

  test('should fail when the readback value differs', () => {
    const outcome = fruView.evaluateEditOutcome({
      editResult: { code: 1, stdout: okStdout, stderr: '' },
      readbackImage: readback('N/A'),
      sectionKey: 'product',
      index: 7,
      newValue: 'Ver=F',
      expectedOldValue: 'N/A'
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('不符合预期');
    expect(outcome.message).toContain('N/A');
    expect(outcome.message).not.toContain('回读');
  });
});

describe('fruView exports', () => {
  test('should not export removed output-area helpers', () => {
    expect(fruView.FRU_HINT).toBeUndefined();
  });
});

/**
 * 写入交互反馈
 *
 * ipmitool 的写入与随后的重新读取都是秒级操作，期间必须在对话框内给出
 * 分阶段进度，否则界面看起来像卡死（真实设备上反馈过这个问题）。
 * 这里用 DOM 桩 + mock IPC + 真实临时镜像文件跑完整流程。
 */
describe('fruView 写入交互反馈', () => {
  // 与 fru.test.js 相同的真实设备镜像（前 168 字节）
  // prettier-ignore
  const FRU_IMAGE_HEX =
    '010001050c0000ed' + '010417c4504e2d43' + 'c4534e2d43c34e2f' + '41c55665723d43c1' +
    '0000000000000089' + '0107002d4cf2c654' + '5459545459c95431' + '4844452d545459c4' +
    '534e2d42c4504e2d' + '42ca322e30302e30' + '302e3033c34e2f41' + 'c55665723d44c175' +
    '010900c3414141cf' + '5261636b20536572' + '76657220424242c4' + '504e2d50c94b5039' +
    '323058585858c453' + '4e2d50c441542d31' + 'ca322e30302e3030' + '2e3033c34e2f41c5' +
    '5665723d45c1006d';

  const EDIT_OK_OUTPUT = [
    'String size are not equal, resizing fru to fit new string',
    "Updating Field : 'N/A' with 'FRU-UI-TEST' ... (Length from '195' to '207')",
    'Writing new FRU.',
    'Done.'
  ].join('\n');

  const imageBuffer = Buffer.alloc(2048);
  Buffer.from(FRU_IMAGE_HEX, 'hex').copy(imageBuffer);

  /** Product Extra(index 7) 值的首字节在整个镜像中的偏移（夹具注释：fields @155，值 @156） */
  const PRODUCT_EXTRA_VALUE_OFFSET = 156;

  /**
   * 模拟设备上 Product Extra（index 7）的当前值。
   * 夹具里它就是 `N/A`（3 字节），改写必须保持等长 —— 否则会破坏 type/length 编码。
   */
  let deviceValue = 'N/A';

  function readBuffer() {
    const buf = Buffer.from(imageBuffer);
    buf.write(deviceValue, PRODUCT_EXTRA_VALUE_OFFSET, 'latin1');
    return buf;
  }

  // fru print -v 的真实输出（值取自同一份镜像，便于与校准结果对照）
  // prettier-ignore
  const PRINT_V_OUTPUT = [
    ' Chassis Type          : Rack Mount Chassis',
    ' Chassis Part Number   : PN-C',
    ' Chassis Serial        : SN-C',
    ' Chassis Extra         : N/A',
    ' Chassis Extra         : Ver=C',
    ' Board Mfg Date        : Wed Mar 11 13:33:00 2026',
    ' Board Mfg             : TTYTTY',
    ' Board Product         : T1HDE-TTY',
    ' Board Serial          : SN-B',
    ' Board Part Number     : PN-B',
    ' Board FRU ID          : 2.00.00.03',
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

  const progressLog = [];
  let elements = {};
  let releaseEdit = null;

  function makeEl(id) {
    const base = {
      id, innerHTML: '', value: '', className: '', disabled: false, title: '',
      scrollTop: 0, scrollHeight: 0, style: {}, dataset: {},
      listeners: {},
      classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
      addEventListener(type, handler) { base.listeners[type] = handler; },
      focus() {}
    };
    let text = '';
    Object.defineProperty(base, 'textContent', {
      get: () => text,
      set: (value) => {
        text = value;
        if (id === 'fru-dialog-progress-text') progressLog.push(value);
      }
    });
    return base;
  }

  const el = (id) => (elements[id] = elements[id] || makeEl(id));

  /**
   * 打开编辑框并开始一次提交（fru edit 会挂起等待 releaseEdit 放行）
   *
   * 注意用对象包住 pending：async 函数返回 promise 会被自动展开，
   * 直接 return 的话外层 await 会一直等到写入结束，无法断言中间状态。
   */
  async function startEdit() {
    await fruView.openEdit('p', 7);
    el('fru-dialog-value').value = 'FRU-UI-TEST';
    fruView.validatePreview('FRU-UI-TEST');
    const pending = fruView.submitEdit();
    await Promise.resolve();
    await Promise.resolve();
    return { pending };
  }

  beforeEach(async () => {
    elements = {};
    progressLog.length = 0;
    releaseEdit = null;
    deviceValue = 'N/A';

    global.document = {
      getElementById: el,
      querySelectorAll: () => [],
      addEventListener: () => {}
    };

    const invoke = jest.fn((command, args) => {
      if (command === 'fru list') {
        return Promise.resolve({
          code: 0,
          stdout: 'FRU Device Description : Builtin FRU Device (ID 0)\n',
          stderr: ''
        });
      }
      if (command === '-v fru print') {
        return Promise.resolve({ code: 0, stdout: PRINT_V_OUTPUT, stderr: '' });
      }
      if (command === 'fru read') {
        const target = args[1];
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, readBuffer());
        return Promise.resolve({ code: 0, stdout: 'Fru Size         : 2048 bytes\nDone\n', stderr: '' });
      }
      // fru edit：挂起，便于断言写入期间的界面状态（releaseEdit 可传入自定义结果）
      return new Promise(resolve => {
        releaseEdit = (result) => resolve(result || { code: 1, stdout: EDIT_OK_OUTPUT, stderr: '' });
      });
    });

    fruView.initFruPanel({
      getServer: () => ({ host: '192.168.60.44' }),
      invoke,
      selectDirectory: async () => os.tmpdir(),
      alert: async () => {}
    });

    await fruView.refresh();
  });

  test('写入期间应显示进度而不是静默等待', async () => {
    const { pending } = await startEdit();

    expect(el('fru-dialog-progress-text').textContent).toBe('正在写入设备…');
    expect(el('fru-dialog-progress').style.display).toBe('flex');
    expect(el('fru-dialog-save').disabled).toBe(true);
    // 写入期间不允许关闭对话框，避免状态错乱
    expect(el('fru-dialog-cancel').disabled).toBe(true);
    expect(el('fru-dialog-value').disabled).toBe(true);

    releaseEdit();
    await pending;
  });

  test('重新读取阶段应切换进度文案，结束后清除', async () => {
    const { pending } = await startEdit();
    releaseEdit();
    await pending;

    expect(progressLog).toContain('正在写入设备…');
    expect(progressLog).toContain('写入已提交，正在重新读取确认…');
    expect(progressLog[progressLog.length - 1]).toBe('');
    expect(el('fru-dialog-progress').style.display).toBe('none');
  });

  test('结束后应恢复对话框交互', async () => {
    const { pending } = await startEdit();
    releaseEdit();
    await pending;

    expect(el('fru-dialog-cancel').disabled).toBe(false);
    expect(el('fru-dialog-value').disabled).toBe(false);
    expect(el('fru-dialog-progress-text').textContent).toBe('');
  });

  test('写入成功后应自动关闭对话框（等长路径无 Done. 也算成功）', async () => {
    await fruView.openEdit('p', 7);
    expect(el('fru-dialog').style.display).toBe('flex');

    el('fru-dialog-value').value = 'XYZ';
    fruView.validatePreview('XYZ');
    const pending = fruView.submitEdit();
    await Promise.resolve();
    await Promise.resolve();

    // 等长原地替换：真机上只有一行、没有 Done.、退出码 0，旧值是目标字段的真实旧值
    deviceValue = 'XYZ';
    releaseEdit({ code: 0, stdout: "Updating Field 'N/A' with 'XYZ' ...\n", stderr: '' });
    await pending;

    expect(el('fru-result').className).toContain('ok');
    // 写入成功 → 自动关闭，进度区随之清空
    expect(el('fru-dialog').style.display).toBe('none');
    expect(el('fru-dialog-progress').style.display).toBe('none');
  });

  test('未提交时只由「×」和「取消」关闭，不绑遮罩点击', async () => {
    await fruView.openEdit('p', 7);
    expect(el('fru-dialog').style.display).toBe('flex');

    // 没有绑定遮罩 click —— 不存在「手滑点到遮罩就丢掉输入」的路径
    expect(el('fru-dialog').listeners.click).toBeUndefined();

    el('fru-dialog-close').listeners.click();
    expect(el('fru-dialog').style.display).toBe('none');

    await fruView.openEdit('p', 7);
    el('fru-dialog-cancel').listeners.click();
    expect(el('fru-dialog').style.display).toBe('none');
  });

  test('二进制校准完成前应先渲染预览并锁定编辑', async () => {
    // print 立即返回、read 挂起 —— 借此捕捉中间的预览态
    let releaseRead = null;
    const slowInvoke = jest.fn((command, args) => {
      if (command === 'fru list') {
        return Promise.resolve({
          code: 0,
          stdout: 'FRU Device Description : Builtin FRU Device (ID 0)\n',
          stderr: ''
        });
      }
      if (command === '-v fru print') {
        return Promise.resolve({ code: 0, stdout: PRINT_V_OUTPUT, stderr: '' });
      }
      if (command === 'fru read') {
        return new Promise(resolve => {
          releaseRead = () => {
            const target = args[1];
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, imageBuffer);
            resolve({ code: 0, stdout: 'Done\n', stderr: '' });
          };
        });
      }
      return Promise.resolve({ code: 1, stdout: '', stderr: '' });
    });

    fruView.initFruPanel({
      getServer: () => ({ host: '192.168.60.44' }),
      invoke: slowInvoke,
      selectDirectory: async () => os.tmpdir(),
      alert: async () => {}
    });

    const refreshing = fruView.refresh();
    await new Promise(resolve => setTimeout(resolve, 0));

    // 预览已出来：内容可见，但序号未经校验 → 按钮禁用、无 data-index
    const previewHtml = el('fru-fields').innerHTML;
    expect(previewHtml).toContain('Product Extra');
    expect(previewHtml).toContain('预览 · 序号校准中');
    expect(previewHtml).toContain('fru-edit-btn" disabled');
    expect(previewHtml).not.toContain('data-index="7"');
    expect(el('fru-result').textContent).toContain('正在校准序号');

    releaseRead();
    await refreshing;

    // 校准完成：按钮解禁并携带可靠序号，meta 回到真实偏移
    const finalHtml = el('fru-fields').innerHTML;
    expect(finalHtml).not.toContain('预览 · 序号校准中');
    expect(finalHtml).toContain('data-index="7"');
    expect(finalHtml).toContain('偏移 0x');
    expect(el('fru-result').textContent).toBe('读取成功');

    // 命令形式必须是 `-v fru print`：写成 `fru print -v <id>` 时 ipmitool
    // 不报错但 stdout 为空，预览会静默失效（真机踩过，mock 测不出来）
    expect(slowInvoke.mock.calls.some(call => call[0] === '-v fru print')).toBe(true);
    expect(slowInvoke.mock.calls.some(call => call[0] === 'fru print -v')).toBe(false);
  });
});
