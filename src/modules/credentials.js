/**
 * 凭据模板模块
 *
 * src/config/ipmi-credentials.json 是默认凭据的唯一来源，
 * 扫描验证 / 快速添加服务器 / 服务器模板都从这里读取，
 * 避免此前 templates.js、networkScanner.js、renderer.js 各自内联一份。
 */

// 配置文件缺失或为空时的兜底（内容与 ipmi-credentials.json 保持一致）
const DEFAULT_TEMPLATES = [
  { name: 'AMI', username: 'admin', password: 'admin' },
  { name: 'openUBMC', username: 'Administrator', password: 'ttytty`12' },
  { name: 'OpenBMC', username: 'root', password: '0penBmc' }
];

// 服务器模板的 UI 元数据；key 与 index.html 中 option value 保持一致
const TEMPLATE_UI_META = {
  openUBMC: { key: 'openubmc', interface: 'lanplus', cipherSuite: 17 },
  AMI: { key: 'ami', interface: 'lanplus', cipherSuite: 17 },
  OpenBMC: { key: 'openbmc', interface: 'lanplus', cipherSuite: 17 }
};

/**
 * 获取凭据模板列表
 * @returns {Array<{name:string,username:string,password:string,description?:string}>}
 */
function getCredentialTemplates() {
  try {
    const file = require('../config/ipmi-credentials.json');
    if (file && Array.isArray(file.templates) && file.templates.length > 0) {
      return file.templates;
    }
  } catch (e) {
    // 配置文件缺失，使用内置兜底
  }
  return DEFAULT_TEMPLATES;
}

/**
 * 按名称查找凭据（忽略大小写）
 * @param {string} name 模板名，如 openUBMC
 * @returns {object|null}
 */
function getCredentialByName(name) {
  if (!name) return null;
  const target = String(name).toLowerCase();
  const found = getCredentialTemplates().find(
    template => String(template.name).toLowerCase() === target
  );
  return found || null;
}

/**
 * 构建添加服务器对话框使用的模板（key -> 模板）
 * @returns {Object<string, {name:string,username:string,password:string,interface:string,cipherSuite:number}>}
 */
function getServerTemplates() {
  const templates = {};
  for (const template of getCredentialTemplates()) {
    const meta = TEMPLATE_UI_META[template.name];
    const key = (meta && meta.key) || String(template.name).toLowerCase();
    templates[key] = {
      name: template.name,
      username: template.username,
      password: template.password,
      interface: (meta && meta.interface) || 'lanplus',
      cipherSuite: (meta && meta.cipherSuite) || 17
    };
  }
  return templates;
}

module.exports = {
  DEFAULT_TEMPLATES,
  getCredentialTemplates,
  getCredentialByName,
  getServerTemplates
};
