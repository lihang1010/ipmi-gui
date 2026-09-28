/**
 * BMC 版本号解析模块
 *
 * 输入 ipmitool mc info 的原始输出，生成展示用版本号：
 *   Firmware Revision              -> 主版本号，如 1.11
 *   Aux Firmware Rev Info (4 字节)  -> 按厂商规则追加后缀
 *
 * 厂商差异（按实机输出确认）：
 *   AMI      : 取前 2 字节，直接拼接   0x11 0x09 0x00 0x00 -> 1.11.1109
 *   openUBMC : 取后 2 字节，以点分隔   0x11 0x09 0x00 0x00 -> 1.11.00.00
 *   其他     : 只返回主版本号（不猜测 Aux 字节含义）
 */

const AUX_BYTE_COUNT = 4;

// bytes: 取 Aux Firmware Rev Info 的下标；separator: 字节间分隔符
const VERSION_RULES = {
  AMI: { bytes: [0, 1], separator: '' },
  openUBMC: { bytes: [2, 3], separator: '.' }
};

/**
 * 解析 Firmware Revision（主版本号）
 * @returns {string} 如 '1.11'，未找到返回 ''
 */
function parseFirmwareRevision(output) {
  const match = String(output || '').match(/^Firmware Revision\s*:\s*(\S+)/m);
  return match ? match[1].trim() : '';
}

/**
 * 解析 Aux Firmware Rev Info 的 4 个字节
 * 支持两种排版：
 *   Aux Firmware Rev Info     :            Aux Firmware Rev Info     : 0x11 0x09
 *       0x11                                   0x00 0x00
 *       0x09
 * @returns {number[]} 最多 4 个字节，缺失时数组更短
 */
function parseAuxBytes(output) {
  const lines = String(output || '').split(/\r?\n/);
  const startIndex = lines.findIndex(line => /aux firmware rev info/i.test(line));
  if (startIndex === -1) return [];

  const bytes = [];
  const collect = (text) => {
    const matches = text.match(/0x[0-9a-fA-F]{1,2}/g);
    if (!matches) return;
    matches.forEach(token => {
      if (bytes.length < AUX_BYTE_COUNT) bytes.push(parseInt(token.slice(2), 16));
    });
  };

  // 冒号后可跟同行的字节
  const headerValue = lines[startIndex].split(':').slice(1).join(':');
  collect(headerValue);

  // 后续每行应为若干 0xNN
  for (let i = startIndex + 1; i < lines.length && bytes.length < AUX_BYTE_COUNT; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (!/^\s*(0x[0-9a-fA-F]{1,2}\s*)+$/.test(line)) break;
    collect(line);
  }

  return bytes;
}

/**
 * 生成 BMC 版本号
 * @param {string} output ipmitool mc info 输出
 * @param {string} templateName 凭据模板名（AMI / openUBMC / ...）
 * @returns {string} 如 '1.11.1109'；无法解析时返回 ''
 */
function formatBmcVersion(output, templateName) {
  const revision = parseFirmwareRevision(output);
  if (!revision) return '';

  const rule = VERSION_RULES[templateName];
  if (!rule) return revision;

  const bytes = parseAuxBytes(output);
  const picked = rule.bytes.map(index => bytes[index]);
  if (picked.some(value => typeof value !== 'number')) return revision;

  const suffix = picked.map(value => value.toString(16).toLowerCase().padStart(2, '0'));
  return revision + '.' + suffix.join(rule.separator);
}

module.exports = {
  AUX_BYTE_COUNT,
  VERSION_RULES,
  parseFirmwareRevision,
  parseAuxBytes,
  formatBmcVersion
};
