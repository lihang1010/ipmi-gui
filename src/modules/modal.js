/**
 * 自定义弹窗模块 - 替代原生 alert/confirm
 */

const { escapeHtml } = require('./utils');

/**
 * 显示模态框
 */
function showModal({ title = '提示', message = '', type = 'alert' }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.style.zIndex = '99999';

    const isConfirm = type === 'confirm';

    overlay.innerHTML = `
      <div class="dialog" style="width:360px">
        <div class="dialog-header">
          <h3>${escapeHtml(title)}</h3>
        </div>
        <div class="dialog-body">
          <p style="color:var(--text-secondary);line-height:1.6;white-space:pre-wrap">${escapeHtml(message)}</p>
        </div>
        <div class="dialog-footer">
          ${isConfirm ? '<button class="btn" id="modal-cancel">取消</button>' : ''}
          <button class="btn btn-primary" id="modal-ok">确定</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const okBtn = overlay.querySelector('#modal-ok');
    const cancelBtn = overlay.querySelector('#modal-cancel');

    const close = (result) => {
      overlay.remove();
      resolve(result);
    };

    okBtn.addEventListener('click', () => close(true));
    if (cancelBtn) cancelBtn.addEventListener('click', () => close(false));

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(isConfirm ? false : true);
    });

    const onKeydown = (e) => {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', onKeydown);
        close(isConfirm ? false : true);
      }
    };
    document.addEventListener('keydown', onKeydown);

    setTimeout(() => okBtn.focus(), 50);
  });
}

/**
 * 安全的 alert
 */
async function safeAlert(msg) {
  await showModal({ message: msg });
}

/**
 * 安全的 confirm
 */
async function safeConfirm(msg) {
  return await showModal({ message: msg, type: 'confirm' });
}

module.exports = {
  showModal,
  safeAlert,
  safeConfirm
};
