/**
 * 自动更新状态的展示映射（纯函数）
 *
 * 主进程把 electron-updater 的各类事件归一化成 { state, version, percent, error }，
 * 渲染进程用 describeUpdate() 把它翻译成顶栏徽标的文案与可点击性。
 *
 * 状态流转（主进程侧）：
 *   idle → checking → available → downloading → ready
 *                    ↘ none（已是最新）
 *   任意阶段出错 → error
 *   未打包运行时（开发模式）直接 skipped
 */

/**
 * 把更新状态映射成顶栏徽标要显示的内容
 *
 * @param {{state?:string, version?:string, percent?:number, error?:string, reason?:string}} status
 * @returns {{text:string, tooltip:string, tone:'idle'|'ready'|'error', actionable:boolean, hidden:boolean}}
 */
function describeUpdate(status) {
  const s = status || {};
  const version = s.version ? 'v' + s.version : '新版本';

  switch (s.state) {
    case 'checking':
      return {
        text: '检查更新…', tone: 'idle', actionable: false, hidden: false,
        tooltip: '正在检查新版本'
      };

    case 'available':
      return {
        text: '发现 ' + version, tone: 'idle', actionable: false, hidden: false,
        tooltip: '发现新版本 ' + version + '，正在后台下载'
      };

    case 'downloading':
      return {
        text: Number.isFinite(s.percent) ? '下载 ' + s.percent + '%' : '下载中',
        tone: 'idle', actionable: false, hidden: false,
        tooltip: '新版本下载中，可以继续使用'
      };

    case 'ready':
      return {
        text: '重启更新到 ' + version, tone: 'ready', actionable: true, hidden: false,
        tooltip: '新版本 ' + version + ' 已下载完成，点击重启并安装' +
          '\n注意：重启会断开当前的 SOL 会话'
      };

    case 'error':
      return {
        text: '更新失败', tone: 'error', actionable: true, hidden: false,
        tooltip: (s.error || '未知错误') + '\n点击重试'
      };

    case 'none':
      return {
        text: '已是最新', tone: 'idle', actionable: false, hidden: true,
        tooltip: '当前已是最新版本' + (s.version ? '（' + version + '）' : '')
      };

    default:
      // idle / skipped：不占用顶栏位置
      return {
        text: '', tone: 'idle', actionable: false, hidden: true,
        tooltip: s.reason || ''
      };
  }
}

module.exports = { describeUpdate };
