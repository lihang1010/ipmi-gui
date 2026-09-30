/**
 * 主窗口初始尺寸计算（纯函数，便于单测）
 *
 * 顶栏自然宽度是实测的（用项目自带 Electron 起隐藏窗口量 DOM，见提交说明）：
 *   左组 726（服务器标签 37 + 下拉框 223 + 8 个按钮 + 间距）
 * + 右组 251（暗色 46 + 版本徽标 62 + 内存徽标 66 + 状态徽标 69 + 间距）
 * + 工具栏左右内边距 32
 * = 1037px
 *
 * 原先默认写死 1000px（窗口边框后内容区约 984），缺口约 53px；
 * 而右侧只有状态徽标允许收缩（min-width: 0），于是它被压到只剩一条边，
 * 看起来就是「右侧显示不完整」。
 */

/**
 * 理想尺寸：够放下完整顶栏，高度留出足够的 SOL 终端区域
 *
 * 宽度按最坏情况取：状态徽标文本由 showStatus() 传入，可能是
 * `server.name + ' - 连接正常'` 这类长串，CSS 给了 max-width: 260px。
 * 最坏自然宽度 = 1037 + (260 - 69) = 1228。
 * 再算上 Windows 窗口边框（1240 的窗口内容区只有 1224，横向被吃掉约 16px），
 * 取 1240 会正好卡住，故留到 1260（内容区约 1244，余 16px）。
 */
const IDEAL_WIDTH = 1260;
const IDEAL_HEIGHT = 780;

/** 与 BrowserWindow 的 minWidth / minHeight 保持一致 */
const MIN_WIDTH = 800;
const MIN_HEIGHT = 600;

/** 与屏幕边缘留出的余量，避免窗口顶到任务栏或屏幕边框 */
const SCREEN_MARGIN = 60;

/**
 * 按屏幕工作区计算初始窗口尺寸
 * @param {{width?: number, height?: number}} [workAreaSize] 屏幕可用区域
 *   （来自 screen.getPrimaryDisplay().workAreaSize）
 * @returns {{width: number, height: number}}
 */
function computeWindowSize(workAreaSize) {
  const area = workAreaSize || {};
  const availableWidth = Number(area.width) > 0 ? area.width - SCREEN_MARGIN : IDEAL_WIDTH;
  const availableHeight = Number(area.height) > 0 ? area.height - SCREEN_MARGIN : IDEAL_HEIGHT;

  return {
    // 上限是理想尺寸（再宽也放不下更多信息），下限是窗口自身的最小尺寸：
    // 屏幕比最小尺寸还小时只能取最小值，此时由窗口的最小尺寸兜底
    width: Math.max(MIN_WIDTH, Math.min(IDEAL_WIDTH, availableWidth)),
    height: Math.max(MIN_HEIGHT, Math.min(IDEAL_HEIGHT, availableHeight))
  };
}

module.exports = {
  computeWindowSize,
  IDEAL_WIDTH,
  IDEAL_HEIGHT,
  MIN_WIDTH,
  MIN_HEIGHT,
  SCREEN_MARGIN
};
