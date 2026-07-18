/**
 * 配置存储模块
 */

const path = require('path');
const fs = require('fs');

const configPath = path.join(
  process.env.APPDATA || process.env.HOME,
  'ipmi-gui',
  'config.json'
);

let config = { servers: [], settings: {}, favorites: [] };

/**
 * 加载配置
 */
function loadConfig() {
  try {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      // 确保必要字段存在
      config.servers = config.servers || [];
      config.settings = config.settings || {};
      config.favorites = config.favorites || [];
      return config;
    }
  } catch (e) {
    console.error('加载配置失败:', e);
  }
  return config;
}

/**
 * 保存配置到文件
 */
function saveConfig() {
  try {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('保存配置失败:', e);
    return false;
  }
}

/**
 * 获取配置
 */
function getConfig() {
  return config;
}

/**
 * 设置配置
 */
function setConfig(newConfig) {
  config = newConfig;
}

module.exports = {
  loadConfig,
  saveConfig,
  getConfig,
  setConfig,
  configPath
};
