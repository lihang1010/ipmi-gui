/**
 * FRU 逻辑模块（纯函数，无 electron / DOM 依赖）
 *
 * 与 ipmitool 的接口契约全部来自上游源码 lib/ipmi_fru.c 与真机实测确认：
 *
 *   fru edit <fruid> field <section> <index> <string>
 *
 * 1) section 取参数的首字符：c=Chassis / b=Board / p=Product，其它值报
 *    "Wrong field type."（无换行）。
 * 2) index 取参数的首字符再减 0x30，即只能写单个数字字符 '0'~'9'。
 *    传 "50" 会被当作 5 —— 因此本模块强制 index 为 0-9。
 * 3) index 是「区内字符串字段的序号」（0 起），起点为 区起始 + 3（Chassis）
 *    / + 6（Board，跳过 Language Code 与 3 字节 Mfg Date）/ + 3（Product），
 *    之后按 FRU 字段步长（1 + 长度字段）依次前进，包含 FRU ID 与多行 Extra。
 * 4) 目标字段为空字符串时无法编辑（报 "Field not found !"）。
 * 5) 新值长度上限 63 字节（Type/Length 字节低 6 位，写入时固定为 0xC0|len）。
 * 6) 命令成功时退出码为 1（源码 returns 1），**不能用退出码判定结果**，
 *    必须解析输出：成功含 "Updating Field ... with ..." 与 "Done."。
 *
 * 由于 ipmitool 的 `fru print` 默认不显示 Board/Product FRU ID，直接解析其
 * 文本会与真实 index 错位，因此字段表与 index 一律从 `fru read` 取回的
 * 二进制镜像解析（parseFruImage）。
 */

/** FRU 字段结束标记（Type/Length = 0xC1） */
const FRU_END_OF_FIELDS = 0xc1;

/** 公共头长度（字节） */
const COMMON_HEADER_SIZE = 8;

/** 字符串字段长度上限（Type/Length 低 6 位） */
const MAX_STRING_BYTES = 63;

/** 单个数字 index 上限（ipmitool 只解析首字符） */
const MAX_FIELD_INDEX = 9;

/** Type/Length 中的编码类型：0=Binary 1=BCD+ 2=6bitASCII 3=8bitASCII */
const TYPE_BINARY = 0;
const TYPE_BCD_PLUS = 1;
const TYPE_ASCII6 = 2;
const TYPE_LATIN1 = 3;

/** BCD Plus 字符表（与 ipmitool 的 bcd_plus[] 一致） */
const BCD_PLUS_CHARS = '0123456789 -.:,_';

/** Chassis Type 描述表（索引即字段值，与 ipmitool chassis_type_desc[] 一致） */
const CHASSIS_TYPE_DESC = [
  'Unspecified', 'Other', 'Unknown', 'Desktop', 'Low Profile Desktop',
  'Pizza Box', 'Mini Tower', 'Tower', 'Portable', 'LapTop',
  'Notebook', 'Hand Held', 'Docking Station', 'All in One', 'Sub Notebook',
  'Space-saving', 'Lunch Box', 'Main Server Chassis', 'Expansion Chassis', 'SubChassis',
  'Bus Expansion Chassis', 'Peripheral Chassis', 'RAID Chassis', 'Rack Mount Chassis', 'Sealed-case PC',
  'Multi-system Chassis', 'CompactPCI', 'AdvancedTCA', 'Blade', 'Blade Enclosure'
];

/**
 * 三个可编辑区域的映射表（单一数据源）
 *
 * fieldOffset：区内第一个字符串字段相对区起始的偏移
 * fields：按 index 顺序的固定字段标签，超出部分一律使用 extraLabel
 */
const FRU_SECTIONS = [
  {
    key: 'chassis',
    shortKey: 'c',
    label: 'Chassis',
    title: 'Chassis（机箱）',
    fieldOffset: 3,
    fields: ['Chassis Part Number', 'Chassis Serial'],
    extraLabel: 'Chassis Extra'
  },
  {
    key: 'board',
    shortKey: 'b',
    label: 'Board',
    title: 'Board（主板）',
    fieldOffset: 6,
    fields: ['Board Mfg', 'Board Product', 'Board Serial', 'Board Part Number', 'Board FRU ID'],
    extraLabel: 'Board Extra'
  },
  {
    key: 'product',
    shortKey: 'p',
    label: 'Product',
    title: 'Product（产品）',
    fieldOffset: 3,
    fields: [
      'Product Manufacturer', 'Product Name', 'Product Part Number',
      'Product Version', 'Product Serial', 'Product Asset Tag', 'Product FRU ID'
    ],
    extraLabel: 'Product Extra'
  }
];

/**
 * 按 key 或单字符 shortKey 查找区域定义（大小写不敏感）
 * @param {string} key
 * @returns {object|null}
 */
function getSection(key) {
  if (!key) return null;
  const k = String(key).trim().toLowerCase();
  return FRU_SECTIONS.find(s => s.key === k || s.shortKey === k) || null;
}

/**
 * 计算字段标签：固定字段用表内名称，其余为 Extra
 * @param {object} section 区域定义
 * @param {number} index 字段序号
 * @returns {string}
 */
function fieldLabel(section, index) {
  if (index < section.fields.length) return section.fields[index];
  return section.extraLabel;
}

/**
 * 校验和（zero checksum）：sum 的二进制补码
 * @param {Buffer|Uint8Array} data
 * @param {number} start
 * @param {number} length
 * @returns {number}
 */
function computeChecksum(data, start, length) {
  let sum = 0;
  for (let i = 0; i < length; i++) {
    sum = (sum + data[start + i]) & 0xff;
  }
  return (0x100 - sum) & 0xff;
}

/**
 * 逐字节转字符串（latin1），不依赖 Buffer
 */
function bytesToString(data, start, length) {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += String.fromCharCode(data[start + i]);
  }
  return out;
}

/**
 * 按 Type/Length 解码字段值（复刻 ipmitool get_fru_area_str）
 * @param {Buffer|Uint8Array} data
 * @param {number} start 数据起始（Type/Length 字节之后）
 * @param {number} len 长度字段值（低 6 位）
 * @param {number} type 编码类型
 * @returns {string}
 */
function decodeFieldValue(data, start, len, type) {
  if (len <= 0) return '';

  if (type === TYPE_LATIN1) {
    return bytesToString(data, start, len);
  }

  if (type === TYPE_BINARY) {
    let hex = '';
    for (let i = 0; i < len; i++) {
      hex += ('0' + data[start + i].toString(16)).slice(-2);
    }
    return hex;
  }

  if (type === TYPE_BCD_PLUS) {
    const size = len * 2;
    let out = '';
    for (let k = 0; k < size; k++) {
      const byte = data[start + Math.floor(k / 2)];
      out += BCD_PLUS_CHARS[(k % 2 ? byte : byte >> 4) & 0x0f];
    }
    return out;
  }

  if (type === TYPE_ASCII6) {
    let out = '';
    for (let i = 0; i < len; i += 3) {
      const remain = Math.min(3, len - i);
      let bits = 0;
      for (let k = 0; k < remain; k++) {
        bits |= data[start + i + k] << (8 * k);
      }
      for (let k = 0; k < 4; k++) {
        out += String.fromCharCode(((bits & 0x3f) + 0x20) & 0x7f);
        bits = bits >>> 6;
      }
    }
    return out;
  }

  return '';
}

/**
 * 格式化 Board Mfg Date（自 1996-01-01 起的分钟数，本地时区显示，与 ipmitool 一致）
 * @param {Buffer|Uint8Array} data
 * @param {number} offset
 * @returns {string} 形如 2026-03-11 13:33，无效时返回空串
 */
function formatMfgDate(data, offset) {
  const minutes = data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16);
  if (!minutes) return '';
  const base = Date.UTC(1996, 0, 1, 0, 0, 0);
  const date = new Date(base + minutes * 60000);
  if (isNaN(date.getTime())) return '';
  const pad = n => (n < 10 ? '0' + n : String(n));
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
    ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

/**
 * 解析单个区域的字段列表
 * @param {Buffer|Uint8Array} data FRU 镜像
 * @param {object} section 区域定义
 * @param {number} offset 区域起始（0 表示该区不存在）
 * @returns {object|null}
 */
function parseSection(data, section, offset) {
  if (!offset) return null;

  const length = data[offset + 1] * 8;
  const end = offset + length;
  if (length <= 0 || end > data.length) return null;

  const fields = [];
  let cursor = offset + section.fieldOffset;
  let index = 0;

  while (cursor < end - 1 && index < 64) {
    const typeLength = data[cursor];
    if (typeLength === FRU_END_OF_FIELDS) break;

    const type = (typeLength & 0xc0) >> 6;
    const rawLength = typeLength & 0x3f;
    const value = decodeFieldValue(data, cursor + 1, rawLength, type);

    fields.push({
      index,
      label: fieldLabel(section, index),
      value,
      type,
      rawLength,
      offset: cursor,
      editable: type === TYPE_LATIN1 && value.length > 0 && index <= MAX_FIELD_INDEX
    });

    cursor += 1 + rawLength;
    index++;
  }

  const result = {
    key: section.key,
    shortKey: section.shortKey,
    label: section.label,
    title: section.title,
    offset,
    length,
    checksumValid: computeChecksum(data, offset, length - 1) === data[end - 1],
    fields,
    extras: {}
  };

  if (section.key === 'chassis') {
    const raw = data[offset + 2];
    result.extras.chassisType = CHASSIS_TYPE_DESC[raw] || ('0x' + raw.toString(16));
    result.extras.chassisTypeRaw = raw;
  } else if (section.key === 'board') {
    result.extras.mfgDate = formatMfgDate(data, offset + 3);
  }

  return result;
}

/**
 * 解析 `fru read` 导出的二进制镜像
 * @param {Buffer|Uint8Array} buffer FRU 镜像（通常 2048 字节）
 * @returns {object} { valid, error?, size, header, sections }
 */
function parseFruImage(buffer) {
  if (!buffer || !buffer.length || buffer.length < COMMON_HEADER_SIZE) {
    return { valid: false, error: 'FRU 数据为空或长度不足', size: 0, header: null, sections: [] };
  }

  const version = buffer[0];
  if (version !== 0x01) {
    return {
      valid: false,
      error: '未知的 FRU 格式版本: 0x' + version.toString(16),
      size: buffer.length,
      header: null,
      sections: []
    };
  }

  const header = {
    version,
    size: buffer.length,
    internalOffset: buffer[1] * 8,
    chassisOffset: buffer[2] * 8,
    boardOffset: buffer[3] * 8,
    productOffset: buffer[4] * 8,
    multiOffset: buffer[5] * 8,
    checksumValid: computeChecksum(buffer, 0, COMMON_HEADER_SIZE - 1) === buffer[COMMON_HEADER_SIZE - 1]
  };

  const offsets = {
    chassis: header.chassisOffset,
    board: header.boardOffset,
    product: header.productOffset
  };

  const sections = FRU_SECTIONS
    .map(section => parseSection(buffer, section, offsets[section.key]))
    .filter(Boolean);

  return { valid: true, error: null, size: buffer.length, header, sections };
}

/**
 * 标签 → { sectionKey, index } 映射（由 FRU_SECTIONS 生成，避免维护两份表）
 * Extra 字段的序号需按出现顺序累加，这里只做 extra 标记
 * @returns {Map<string, {sectionKey:string, index?:number, extra?:boolean}>}
 */
function buildPrintLabelMap() {
  const map = new Map();
  FRU_SECTIONS.forEach(section => {
    section.fields.forEach((label, index) => {
      map.set(label, { sectionKey: section.key, index });
    });
    map.set(section.extraLabel, { sectionKey: section.key, extra: true });
  });
  return map;
}

const PRINT_LABEL_MAP = buildPrintLabelMap();

/**
 * 解析 `fru print -v <id>` 的输出
 *
 * 用途：在 `fru read` 的二进制镜像就绪前先渲染字段表（print 比 read 快约 3 倍）。
 *
 * 关键点：print **会整行跳过空字段**，所以不能按行号数序号。这里改为按字段标签
 * 反查 FRU_SECTIONS 得到 index，Extra 字段按出现顺序累加 —— 空字段缺失不会影响
 * 其它任何字段的序号识别。
 *
 * 结果仅供展示（source === 'print'，编辑按钮锁定）；写入一律以 parseFruImage 为准。
 *
 * @param {string} output ipmitool 的 stdout
 * @returns {object} 与 parseFruImage 同构的结果
 */
function parseFruPrint(output) {
  const text = String(output || '');
  if (!text.trim()) {
    return { valid: false, error: 'fru print 没有输出', source: 'print', size: 0, header: null, sections: [] };
  }

  const sections = FRU_SECTIONS.map(section => ({
    key: section.key,
    shortKey: section.shortKey,
    label: section.label,
    title: section.title,
    offset: 0,
    length: 0,
    checksumValid: true,
    fields: [],
    extras: {}
  }));
  const byKey = new Map(sections.map(section => [section.key, section]));
  const extraCursor = new Map(FRU_SECTIONS.map(section => [section.key, section.fields.length]));

  text.split(/\r?\n/).forEach(line => {
    const match = line.match(/^\s+([^:]+?)\s*:\s?(.*)$/);
    if (!match) return;

    const label = match[1].trim();
    const value = match[2];

    // 非字符串字段：print 给出人类可读描述，作为只读附加信息
    if (label === 'Chassis Type') {
      byKey.get('chassis').extras.chassisType = value.trim();
      return;
    }
    if (label === 'Board Mfg Date') {
      byKey.get('board').extras.mfgDate = value.trim();
      return;
    }
    if (/^Internal Use Area/i.test(label)) return;

    const target = PRINT_LABEL_MAP.get(label);
    if (!target) return;

    const section = byKey.get(target.sectionKey);
    if (!section) return;

    let index = target.index;
    if (target.extra) {
      // Extra 字段没有固定标签，按出现顺序从该区固定字段数之后累加
      index = extraCursor.get(target.sectionKey);
      extraCursor.set(target.sectionKey, index + 1);
    }

    section.fields.push({
      index,
      label,
      value,
      type: TYPE_LATIN1,
      rawLength: value.length,
      offset: -1,
      editable: value.length > 0 && index <= MAX_FIELD_INDEX
    });
  });

  sections.forEach(section => section.fields.sort((a, b) => a.index - b.index));

  const kept = sections.filter(s => s.fields.length || Object.keys(s.extras).length);
  if (!kept.length) {
    return {
      valid: false,
      error: '未能从 fru print 输出中识别出字段',
      source: 'print',
      size: 0,
      header: null,
      sections: []
    };
  }

  return { valid: true, error: null, size: 0, header: null, sections: kept, source: 'print' };
}

/**
 * 解析 `fru list` 输出
 * @param {string} output
 * @returns {Array<{id:string, description:string}>}
 */
function parseFruList(output) {
  if (!output) return [];
  const result = [];
  const lines = String(output).split(/\r?\n/);

  for (const line of lines) {
    const match = line.match(/FRU Device Description\s*:\s*(.+?)\s*\(ID\s+(\d+)\)\s*$/i);
    if (match) {
      result.push({ id: match[2], description: match[1] });
    }
  }

  return result;
}

/**
 * 校验待写入的 FRU 字符串
 *
 * 空串一律拒绝：写入空串会让该字段无法再次编辑（ipmitool 判定字段无效），
 * 且会使后续字段解析错位。
 *
 * @param {string} value
 * @returns {{ok:boolean, error?:string, bytes?:number}}
 */
function validateFruString(value) {
  if (typeof value !== 'string') {
    return { ok: false, error: '新值必须是字符串' };
  }
  if (value.length === 0) {
    return { ok: false, error: '新值不能为空（清空字段会导致该字段无法再编辑）' };
  }
  if (value.length > MAX_STRING_BYTES) {
    return { ok: false, error: '新值长度 ' + value.length + ' 字节，超过上限 ' + MAX_STRING_BYTES + ' 字节' };
  }
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) {
      return {
        ok: false,
        error: '第 ' + (i + 1) + ' 个字符不是可打印 ASCII，FRU 字符串仅支持 0x20-0x7E'
      };
    }
  }
  return { ok: true, bytes: value.length };
}

/**
 * 构建 `fru edit` 调用
 *
 * 新值通过 IPC 的 argv 参数单独传递，不拼进命令字符串，
 * 避免引号 / 空格 / 特殊字符被分词破坏。
 *
 * @param {{fruId:string|number, section:string, index:number, value:string}} params
 * @returns {{ok:boolean, command?:string, args?:string[], error?:string}}
 */
function buildEditInvocation(params) {
  const section = getSection(params && params.section);
  if (!section) {
    return { ok: false, error: '未知的 FRU 区域: ' + (params && params.section) };
  }

  const index = Number(params.index);
  if (!Number.isInteger(index) || index < 0 || index > MAX_FIELD_INDEX) {
    return {
      ok: false,
      error: '字段序号必须是 0-' + MAX_FIELD_INDEX + ' 的整数（ipmitool 只解析单个数字字符）'
    };
  }

  const checked = validateFruString(params.value);
  if (!checked.ok) return { ok: false, error: checked.error };

  return {
    ok: true,
    command: 'fru edit ' + params.fruId + ' field ' + section.shortKey + ' ' + index,
    args: [params.value]
  };
}

/**
 * 解析 `fru edit` 的执行结果
 *
 * ipmitool 成功时退出码为 1，因此不能看 code，只能看输出特征。
 *
 * @param {{code?:number, stdout?:string, stderr?:string}} result
 * @returns {{ok:boolean, oldValue:string|null, newValue:string|null, error:string|null, raw:string}}
 */
function parseEditResult(result) {
  const stdout = (result && result.stdout) || '';
  const stderr = (result && result.stderr) || '';
  const raw = (stdout + '\n' + stderr).trim();

  // 失败必须先判：写入失败时同样会打印 Updating Field，只是后面紧跟错误行
  let error = null;
  if (/Field not found/i.test(raw)) {
    error = '目标字段不存在：该位置为空字段或序号超出实际字段数，ipmitool 拒绝写入';
  } else if (/Wrong field type/i.test(raw)) {
    error = '区域标识无效（仅支持 c / b / p）';
  } else if (/Device not present/i.test(raw)) {
    error = '设备未响应或凭据 / 权限不足';
  } else if (/Write to FRU data failed/i.test(raw)) {
    error = '写入 FRU 失败，设备端可能未变更，请点「刷新」确认当前值';
  } else if (/Internal error, padding length/i.test(raw)) {
    error = 'ipmitool 内部错误（重排后 padding 越界），FRU 未写入';
  } else if (/Out of memory/i.test(raw)) {
    error = 'ipmitool 内存不足';
  } else if (/Not enough parameters/i.test(raw)) {
    error = 'ipmitool 参数不足';
  }

  if (error) return { ok: false, oldValue: null, newValue: null, error, raw };

  // 成功有两条互斥路径（ipmi_fru.c:4977 / 5002），判定**不能依赖 Done.**：
  //   1) 新值与旧值等长 → 原地替换：`Updating Field '<旧>' with '<新>' ...`，
  //      不打印 Done.，且退出码为 0
  //   2) 长度改变 → 重排三区：`Updating Field : '<旧>' with '<新>' ... (Length from a to b)`
  //      后打印 `Done.`，退出码为 1
  // 历史上只认带 Done. 的第 2 种，导致等长写入被误判为「写入流程未完成」。
  // 两种格式的旧值都取自目标字段本身，可用于校验改到的确实是预期字段。
  const updating = stdout.match(/Updating Field\s*:?\s*'([\s\S]*)' with '([\s\S]*)'\s*\.\.\./);
  if (updating) {
    return { ok: true, oldValue: updating[1], newValue: updating[2], error: null, raw };
  }

  return {
    ok: false,
    oldValue: null,
    newValue: null,
    error: raw ? '未识别的输出：' + raw : 'ipmitool 无任何输出',
    raw
  };
}

/**
 * 写后重新读取校验
 * @param {object} image parseFruImage 的结果
 * @param {string} sectionKey 区域 key 或 shortKey
 * @param {number} index 字段序号
 * @param {string} expected 期望值
 * @returns {{ok:boolean, actual?:string, expected?:string, error?:string}}
 */
function verifyFieldValue(image, sectionKey, index, expected) {
  const section = getSection(sectionKey);
  if (!section) return { ok: false, error: '未知的 FRU 区域: ' + sectionKey };
  if (!image || !image.valid) return { ok: false, error: 'FRU 数据无效' };

  const target = (image.sections || []).find(s => s.key === section.key);
  if (!target) return { ok: false, error: '区域 ' + section.label + ' 在设备上不存在' };

  const field = target.fields.find(f => f.index === Number(index));
  if (!field) return { ok: false, error: '重新读取的 FRU 数据里没有字段 index=' + index };

  return { ok: field.value === expected, actual: field.value, expected };
}

/**
 * 构建备份文件名
 * @param {{host:string, fruId:string|number, now?:Date}} params
 * @returns {string}
 */
function buildBackupFileName(params) {
  const now = params.now || new Date();
  const pad = n => (n < 10 ? '0' + n : String(n));
  const stamp = now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) +
    '-' + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
  const host = String(params.host || 'unknown').replace(/[^\w.-]/g, '_');
  return 'fru-' + host + '-id' + params.fruId + '-' + stamp + '.bin';
}

/**
 * 汇总镜像中的全部可编辑字段（用于 UI 渲染前的过滤）
 * @param {object} image
 * @returns {Array<object>}
 */
function listEditableFields(image) {
  const result = [];
  if (!image || !image.valid) return result;
  for (const section of image.sections) {
    for (const field of section.fields) {
      if (field.editable) {
        result.push({
          sectionKey: section.key,
          sectionShortKey: section.shortKey,
          sectionLabel: section.label,
          index: field.index,
          label: field.label,
          value: field.value
        });
      }
    }
  }
  return result;
}

module.exports = {
  FRU_SECTIONS,
  FRU_END_OF_FIELDS,
  COMMON_HEADER_SIZE,
  MAX_STRING_BYTES,
  MAX_FIELD_INDEX,
  CHASSIS_TYPE_DESC,
  TYPE_LATIN1,
  getSection,
  fieldLabel,
  computeChecksum,
  decodeFieldValue,
  formatMfgDate,
  parseSection,
  parseFruImage,
  parseFruPrint,
  parseFruList,
  validateFruString,
  buildEditInvocation,
  parseEditResult,
  verifyFieldValue,
  buildBackupFileName,
  listEditableFields
};
