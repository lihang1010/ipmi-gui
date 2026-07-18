/**
 * 服务器模板模块
 */

const SERVER_TEMPLATES = {
  openubmc: {
    name: 'openUBMC',
    username: 'Administrator',
    password: 'ttytty`12',
    interface: 'lanplus',
    cipherSuite: 17
  },
  ami: {
    name: 'AMI',
    username: 'admin',
    password: 'admin',
    interface: 'lanplus',
    cipherSuite: 17
  },
  openbmc: {
    name: 'OpenBMC',
    username: 'root',
    password: '0penBmc',
    interface: 'lanplus',
    cipherSuite: 17
  }
};

const { isValidIP } = require('./utils');

/**
 * 应用模板到表单
 */
function applyTemplate() {
  const templateId = document.getElementById('server-template').value;
  if (!templateId) return;

  const template = SERVER_TEMPLATES[templateId];
  if (!template) return;

  document.getElementById('server-username').value = template.username;
  document.getElementById('server-password').value = template.password;
  document.getElementById('server-interface').value = template.interface;
  document.getElementById('server-cipher').value = template.cipherSuite;

  updateServerNameFromTemplate();
}

/**
 * 根据模板和 IP 更新服务器名称
 */
function updateServerNameFromTemplate() {
  const templateId = document.getElementById('server-template').value;
  const host = document.getElementById('server-host').value.trim();
  const nameInput = document.getElementById('server-name');

  if (nameInput.value.trim()) return;
  if (!host || !isValidIP(host)) return;

  if (templateId) {
    const template = SERVER_TEMPLATES[templateId];
    if (template) {
      nameInput.value = template.name + '-' + host;
    }
  } else {
    nameInput.value = host;
  }
}

module.exports = {
  SERVER_TEMPLATES,
  applyTemplate,
  updateServerNameFromTemplate
};
