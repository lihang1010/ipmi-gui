/**
 * FRU 面板视图与写入编排
 *
 * 分层约定（与 scanResultView + renderer 的既有范式一致）：
 *  - 本文件上半部分是**纯函数**（渲染 / 编排决策 / 结果判定），可直接单测
 *  - 下半部分是 DOM + IPC 编排，依赖通过 initFruPanel() 注入
 *
 * 写入流程：点「写入」立即下发到设备 → 重新 fru read 比对目标字段；
 * 同时校验 ipmitool 报告的旧值与预期一致，防止 index 语义偏差导致改错字段。
 * 不做写前自动备份，也没有二次确认 —— 因此「写入」按钮以
 * 「新值合法且与原值不同」为启用条件（见 validatePreview）。
 *
 * 注意：ipmitool 的 `fru edit` 成功时退出码为 1，判定一律依赖输出解析。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const fru = require('./fru');
const { escapeHtml } = require('./utils');

/** 临时镜像目录名（放在系统临时目录下，避免污染用户目录） */
const TEMP_DIR_NAME = 'ipmi-gui-fru';

// =====================================================================
// 纯函数：渲染
// =====================================================================

/**
 * 字段为何不可编辑
 * @param {object} field parseFruImage 产出的字段
 * @returns {string} 为空串表示可编辑
 */
function lockReason(field) {
  if (!field) return '字段不存在';
  if (field.type !== fru.TYPE_LATIN1) {
    return '编码类型为 ' + field.type + '（非 8-bit ASCII），不支持就地编辑';
  }
  if (!field.value) {
    return '当前为空字段，ipmitool 无法定位该字段（Field not found）';
  }
  if (field.index > fru.MAX_FIELD_INDEX) {
    return '字段序号 ' + field.index + ' 超出 ipmitool 可编辑范围（0-' + fru.MAX_FIELD_INDEX + '）';
  }
  return '';
}

/**
 * 渲染 FRU 下拉选项
 * @param {Array<{id:string, description:string}>} list
 * @param {string} selectedId
 * @returns {string}
 */
function renderFruOptions(list, selectedId) {
  if (!list || !list.length) {
    return '<option value="">未发现 FRU 设备</option>';
  }
  return list.map(item => {
    const label = item.description + ' (ID ' + item.id + ')';
    const selected = String(item.id) === String(selectedId) ? ' selected' : '';
    return '<option value="' + escapeHtml(item.id) + '"' + selected + '>' + escapeHtml(label) + '</option>';
  }).join('');
}

/**
 * 渲染只读信息行（如 Chassis Type / Board Mfg Date）
 */
function renderStaticRow(label, value, reason) {
  return '' +
    '<div class="fru-field-row readonly">' +
      '<span class="fru-field-label">' + escapeHtml(label) + '</span>' +
      '<span class="fru-field-value' + (value ? '' : ' empty') + '">' + escapeHtml(value || '(空)') + '</span>' +
      '<span class="fru-field-actions"><span class="fru-field-lock" title="' + escapeHtml(reason) + '">只读</span></span>' +
    '</div>';
}

/**
 * 渲染单个字段行
 */
function renderFieldRow(section, field) {
  const reason = lockReason(field);
  const editable = !reason;

  const valueText = field.value ? escapeHtml(field.value) : '(空)';
  const valueClass = field.value ? 'fru-field-value' : 'fru-field-value empty';

  const actions = editable
    ? '<button class="btn btn-sm fru-edit-btn" data-section="' + escapeHtml(section.shortKey) +
        '" data-index="' + field.index + '">编辑</button>'
    : '<span class="fru-field-lock" title="' + escapeHtml(reason) + '">只读</span>';

  return '' +
    '<div class="fru-field-row' + (editable ? '' : ' readonly') + '">' +
      '<span class="fru-field-label">' + escapeHtml(field.label) +
        ' <span class="fru-field-index">#' + field.index + '</span></span>' +
      '<span class="' + valueClass + '">' + valueText + '</span>' +
      '<span class="fru-field-actions">' + actions + '</span>' +
    '</div>';
}

/**
 * 渲染单个区域
 */
function renderSection(section) {
  const rows = [];

  if (section.extras && section.extras.chassisType) {
    rows.push(renderStaticRow('Chassis Type', section.extras.chassisType,
      '机箱类型为单字节数值字段，ipmitool fru edit 不提供编辑入口'));
  }
  if (section.extras && section.extras.mfgDate) {
    rows.push(renderStaticRow('Board Mfg Date', section.extras.mfgDate,
      '制造日期为 3 字节二进制时间戳，ipmitool fru edit 不提供编辑入口'));
  }

  section.fields.forEach(field => rows.push(renderFieldRow(section, field)));

  const meta = '偏移 0x' + section.offset.toString(16).toUpperCase() +
    ' · ' + section.length + 'B · 校验和 ' + (section.checksumValid ? 'OK' : 'INVALID');

  return '' +
    '<div class="fru-section">' +
      '<div class="fru-section-header">' +
        '<span class="fru-section-name">' + escapeHtml(section.title || section.label) + '</span>' +
        '<span class="fru-section-meta' + (section.checksumValid ? '' : ' invalid') + '">' + escapeHtml(meta) + '</span>' +
      '</div>' +
      rows.join('') +
    '</div>';
}

/**
 * 渲染整个字段表
 * @param {object} image parseFruImage 的产物
 * @returns {string} HTML
 */
function renderFruSections(image) {
  if (!image || !image.valid) {
    const message = (image && image.error) || '无法解析 FRU 数据';
    return '<div class="fru-placeholder">' + escapeHtml(message) + '</div>';
  }
  if (!image.sections.length) {
    return '<div class="fru-placeholder">该 FRU 没有可解析的信息区</div>';
  }
  return image.sections.map(renderSection).join('');
}

/**
 * 摘要行内容
 * @param {object} image
 * @param {string} fruId
 * @param {string} description
 * @returns {{title:string, meta:string}}
 */
function summarizeImage(image, fruId, description) {
  if (!image || !image.valid) {
    return {
      title: '读取失败',
      meta: (image && image.error) || '无数据'
    };
  }

  const fieldCount = image.sections.reduce((sum, section) => sum + section.fields.length, 0);
  const editableCount = image.sections.reduce(
    (sum, section) => sum + section.fields.filter(f => f.editable).length, 0);
  const checksumOk = image.header.checksumValid && image.sections.every(s => s.checksumValid);

  return {
    title: (description ? description + '（ID ' + fruId + '）' : 'FRU ID ' + fruId),
    meta: image.size + 'B · ' + image.sections.length + ' 个信息区 · ' +
      fieldCount + ' 个字段（可编辑 ' + editableCount + '）· 校验和 ' +
      (checksumOk ? '正常' : '异常')
  };
}

// =====================================================================
// 纯函数：编排决策
// =====================================================================

/**
 * 规划一次字段写入
 *
 * @param {{image:object, fruId:string|number, sectionKey:string, index:number, newValue:string}} params
 * @returns {{ok:boolean, error?:string, command?:string, args?:string[], oldValue?:string,
 *            fieldLabel?:string, sectionKey?:string, sectionLabel?:string, index?:number}}
 */
function planEdit(params) {
  const section = fru.getSection(params.sectionKey);
  if (!section) return { ok: false, error: '未知的 FRU 区域: ' + params.sectionKey };

  if (!params.image || !params.image.valid) {
    return { ok: false, error: '尚未读取 FRU 数据，请先刷新' };
  }

  const parsedSection = (params.image.sections || []).find(s => s.key === section.key);
  if (!parsedSection) {
    return { ok: false, error: '该 FRU 不存在 ' + section.label + ' 信息区' };
  }

  const field = parsedSection.fields.find(f => f.index === Number(params.index));
  if (!field) return { ok: false, error: '字段序号 ' + params.index + ' 不存在' };

  const reason = lockReason(field);
  if (reason) return { ok: false, error: '该字段不可编辑：' + reason };

  const invocation = fru.buildEditInvocation({
    fruId: params.fruId,
    section: section.key,
    index: params.index,
    value: params.newValue
  });
  if (!invocation.ok) return { ok: false, error: invocation.error };

  return {
    ok: true,
    command: invocation.command,
    args: invocation.args,
    oldValue: field.value,
    fieldLabel: field.label,
    sectionKey: section.key,
    sectionLabel: section.label,
    index: field.index
  };
}

/**
 * 判定一次写入的结果
 *
 * @param {{editResult:object, readbackImage:object|null, sectionKey:string, index:number,
 *          newValue:string, expectedOldValue:string}} params
 * @returns {{ok:boolean, severity:'ok'|'warning'|'error', message:string}}
 */
function evaluateEditOutcome(params) {
  const parsed = fru.parseEditResult(params.editResult);

  if (!parsed.ok) {
    return { ok: false, severity: 'error', message: parsed.error };
  }

  // ipmitool 会把命中的字段旧值打印出来：与预期不符说明改到的不是预期字段
  if (parsed.oldValue !== params.expectedOldValue) {
    return {
      ok: false,
      severity: 'error',
      message: '写入的字段与预期不符：ipmitool 报告旧值 "' + parsed.oldValue +
        '"，预期 "' + params.expectedOldValue + '"。实际改动的字段与预期不符，请点「刷新」确认设备当前值。'
    };
  }

  if (!params.readbackImage || !params.readbackImage.valid) {
    return {
      ok: true,
      severity: 'warning',
      message: '写入命令已执行，但未能重新读取确认（' +
        ((params.readbackImage && params.readbackImage.error) || '无数据') + '），请点「刷新」查看'
    };
  }

  const verified = fru.verifyFieldValue(
    params.readbackImage, params.sectionKey, params.index, params.newValue);

  if (!verified.ok) {
    return {
      ok: false,
      severity: 'error',
      message: '写入后读到的值不符合预期：期望 "' + params.newValue + '"，实际 "' +
        (verified.actual === undefined ? verified.error : verified.actual) + '"'
    };
  }

  return {
    ok: true,
    severity: 'ok',
    message: '写入成功（' + params.newValue + '）'
  };
}

// =====================================================================
// 编排：DOM + IPC
// =====================================================================

let deps = {
  getServer: () => null,
  invoke: () => Promise.resolve({ code: -1, stdout: '', stderr: 'IPC 未初始化' }),
  selectDirectory: () => Promise.resolve(null)
};

let fruList = [];
let currentFruId = null;
let currentImage = null;
let busy = false;

/**
 * 更新摘要行状态
 *
 * 面板不再有日志区：ipmitool 的原始输出作为悬停详情挂在摘要行上，
 * 既不占空间又保留排错线索。
 *
 * @param {'ok'|'error'|'pending'|''} severity
 * @param {string} text 状态文字
 * @param {string} [detail] ipmitool 原始输出
 */
function setResult(severity, text, detail) {
  const el = document.getElementById('fru-result');
  if (!el) return;
  el.className = 'fru-summary-result' + (severity ? ' ' + severity : '');
  el.textContent = text || '';
  el.title = detail || '';
}

function setBusy(value, label) {
  busy = value;
  const saveBtn = document.getElementById('fru-dialog-save');
  const refreshBtn = document.getElementById('btn-fru-refresh');
  const backupBtn = document.getElementById('btn-fru-backup');

  if (saveBtn) {
    saveBtn.disabled = value;
    saveBtn.classList.toggle('loading', value);
    if (!value) saveBtn.textContent = '写入';
  }
  if (refreshBtn) refreshBtn.disabled = value;
  if (backupBtn) backupBtn.disabled = value;

  // 写入期间冻结对话框其余交互，避免中途关闭导致状态错乱
  ['fru-dialog-close', 'fru-dialog-cancel', 'fru-dialog-value'].forEach(id => {
    const node = document.getElementById(id);
    if (node) node.disabled = value;
  });

  if (value && label) setResult('pending', label);
}

/**
 * 显示 / 清除对话框内的写入进度
 *
 * 写入与随后的重新读取都是秒级操作，对话框会遮住摘要行状态，
 * 因此进度必须显示在对话框内部。
 *
 * @param {string|null} text 传 null / 空串即隐藏
 */
function setProgress(text) {
  const box = document.getElementById('fru-dialog-progress');
  const label = document.getElementById('fru-dialog-progress-text');
  if (label) label.textContent = text || '';
  if (box) box.style.display = text ? 'flex' : 'none';
}

function tempImagePath(server, fruId) {
  const dir = path.join(os.tmpdir(), TEMP_DIR_NAME);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    // 目录已存在或创建失败，交给后续读写报错
  }
  const host = String((server && server.host) || 'unknown').replace(/[^\w.-]/g, '_');
  return path.join(dir, 'fru-' + host + '-id' + fruId + '.bin');
}

function readBinary(filePath) {
  try {
    return fs.readFileSync(filePath);
  } catch (e) {
    return null;
  }
}

function fileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch (e) {
    return -1;
  }
}

/**
 * 执行 fru read 并解析结果
 * @returns {Promise<{ok:boolean, image?:object, filePath:string, error?:string}>}
 */
async function readFruImage(server, fruId, filePath) {
  const result = await deps.invoke('fru read', [String(fruId), filePath]);
  const detail = formatResult(result);

  const size = fileSize(filePath);
  if (size <= 0) {
    return {
      ok: false,
      filePath,
      error: '未取回 FRU 数据（可能设备无响应或凭据不足）',
      detail
    };
  }

  const buffer = readBinary(filePath);
  if (!buffer) {
    return { ok: false, filePath, error: '无法读取导出的 FRU 文件', detail };
  }

  return { ok: true, image: fru.parseFruImage(buffer), filePath, detail };
}

/** ipmitool 原始输出整理为悬停详情文本 */
function formatResult(result) {
  const stdout = (result && result.stdout) || '';
  const stderr = (result && result.stderr) || '';
  const code = result ? result.code : -1;
  const body = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
  return body ? body + '\n[exit ' + code + ']' : '[exit ' + code + ']';
}

function renderCurrent() {
  const fieldsEl = document.getElementById('fru-fields');
  if (fieldsEl) fieldsEl.innerHTML = renderFruSections(currentImage);

  // 列标题只在实际有字段表时出现
  const headEl = document.getElementById('fru-table-head');
  if (headEl) {
    const hasRows = !!(currentImage && currentImage.valid && currentImage.sections.length);
    headEl.style.display = hasRows ? 'grid' : 'none';
  }

  const summary = summarizeImage(currentImage, currentFruId, currentDescription());
  const titleEl = document.getElementById('fru-summary-title');
  const metaEl = document.getElementById('fru-summary-meta');
  if (titleEl) titleEl.textContent = summary.title;
  if (metaEl) metaEl.textContent = summary.meta;
}

function currentDescription() {
  const item = fruList.find(f => String(f.id) === String(currentFruId));
  return item ? item.description : '';
}

function renderSelect() {
  const el = document.getElementById('fru-select');
  if (!el) return;
  el.innerHTML = renderFruOptions(fruList, currentFruId);
}

/**
 * 刷新 FRU 设备列表并读取当前选中的 FRU
 */
async function refresh() {
  if (busy) return;

  const server = deps.getServer();
  if (!server) {
    await deps.alert('请先选择服务器');
    return;
  }

  setResult('pending', '读取中...');

  try {
    const listResult = await deps.invoke('fru list');
    fruList = fru.parseFruList((listResult && listResult.stdout) || '');

    if (!fruList.length) {
      currentImage = null;
      currentFruId = null;
      renderSelect();
      renderCurrent();
      setResult('error', '未发现 FRU 设备');
      return;
    }

    if (!currentFruId || !fruList.some(f => String(f.id) === String(currentFruId))) {
      currentFruId = fruList[0].id;
    }
    renderSelect();

    await load();
  } catch (err) {
    setResult('error', '读取异常: ' + err.message);
  }
}

/**
 * 读取当前选中的 FRU 并解析字段
 */
async function load() {
  if (busy) return;

  const server = deps.getServer();
  if (!server || !currentFruId) {
    await deps.alert('请先选择服务器并刷新 FRU 列表');
    return;
  }

  setBusy(true, '读取中...');
  try {
    const filePath = tempImagePath(server, currentFruId);
    const read = await readFruImage(server, currentFruId, filePath);

    if (!read.ok) {
      currentImage = null;
      renderCurrent();
      setResult('error', read.error, read.detail);
      return;
    }

    currentImage = read.image;
    renderCurrent();

    if (currentImage.valid) {
      setResult('ok', '读取成功');
    } else {
      setResult('error', currentImage.error);
    }
  } catch (err) {
    setResult('error', '读取异常: ' + err.message);
  } finally {
    setBusy(false);
  }
}

/**
 * 导出整区备份到用户选择的目录
 */
async function exportBackup() {
  const server = deps.getServer();
  if (!server) {
    await deps.alert('请先选择服务器');
    return;
  }
  if (!currentFruId) {
    await deps.alert('请先刷新 FRU 列表');
    return;
  }

  const dir = await deps.selectDirectory();
  if (!dir) return;

  const target = path.join(dir, fru.buildBackupFileName({ host: server.host, fruId: currentFruId }));

  setBusy(true, '导出中...');
  try {
    const read = await readFruImage(server, currentFruId, target);
    if (!read.ok) {
      setResult('error', read.error, read.detail);
      return;
    }
    setResult('ok', '已导出备份: ' + target);
  } catch (err) {
    setResult('error', '导出异常: ' + err.message);
  } finally {
    setBusy(false);
  }
}

/**
 * 打开编辑对话框
 */
async function openEdit(sectionKey, index) {
  if (!currentImage || !currentImage.valid) {
    await deps.alert('尚未读取 FRU 数据，请先刷新');
    return;
  }

  const section = fru.getSection(sectionKey);
  const parsedSection = section && (currentImage.sections || []).find(s => s.key === section.key);
  const field = parsedSection && parsedSection.fields.find(f => f.index === Number(index));

  if (!field) {
    await deps.alert('未找到该字段，请重新刷新 FRU');
    return;
  }
  const reason = lockReason(field);
  if (reason) {
    await deps.alert('该字段不可编辑：' + reason);
    return;
  }

  const targetEl = document.getElementById('fru-dialog-target');
  const currentEl = document.getElementById('fru-dialog-current');
  const inputEl = document.getElementById('fru-dialog-value');

  if (targetEl) targetEl.textContent = section.label + ' / ' + field.label + '（序号 ' + field.index + '）';
  if (currentEl) currentEl.textContent = field.value;
  if (inputEl) {
    inputEl.value = '';
    inputEl.dataset.section = section.shortKey;
    inputEl.dataset.index = String(field.index);
  }

  setProgress(null);
  validatePreview('');

  const dialog = document.getElementById('fru-dialog');
  if (dialog) dialog.style.display = 'flex';
  if (inputEl) inputEl.focus();
}

function closeEdit() {
  const dialog = document.getElementById('fru-dialog');
  if (dialog) dialog.style.display = 'none';
}

/**
 * 输入时的实时校验提示
 */
function validatePreview(value) {
  const el = document.getElementById('fru-dialog-validate');
  const inputEl = document.getElementById('fru-dialog-value');
  const saveBtn = document.getElementById('fru-dialog-save');

  const finish = (ok, className, text) => {
    if (el) {
      el.className = className;
      el.textContent = text;
    }
    // 写入即生效，校验不通过时禁用按钮，避免空值 / 未修改时误提交
    if (saveBtn && !busy) saveBtn.disabled = !ok;
    return ok;
  };

  const current = (document.getElementById('fru-dialog-current') || {}).textContent || '';
  const text = value === undefined ? ((inputEl && inputEl.value) || '') : value;

  if (!text) {
    return finish(false, 'fru-validate', '可打印 ASCII，最长 63 字节');
  }

  const checked = fru.validateFruString(text);
  if (!checked.ok) {
    return finish(false, 'fru-validate error', checked.error);
  }

  if (text === current) {
    return finish(false, 'fru-validate error', '新值与当前值相同，无需写入');
  }

  return finish(true, 'fru-validate ok', checked.bytes + '/63 字节，可写入');
}

/**
 * 执行写入：写入 → 重新读取校验
 *
 * 点「写入」直接生效（无二次确认），因此把「新值合法且与原值不同」
 * 作为「写入」按钮的启用条件，避免空值或未修改时误提交。
 */
async function submitEdit() {
  if (busy) return;

  const server = deps.getServer();
  if (!server) {
    await deps.alert('请先选择服务器');
    return;
  }

  const inputEl = document.getElementById('fru-dialog-value');
  const value = inputEl ? inputEl.value : '';

  if (!validatePreview(value)) {
    await deps.alert('请先修正新值');
    return;
  }

  const plan = planEdit({
    image: currentImage,
    fruId: currentFruId,
    sectionKey: inputEl ? inputEl.dataset.section : null,
    index: inputEl ? inputEl.dataset.index : null,
    newValue: value
  });

  if (!plan.ok) {
    await deps.alert(plan.error);
    return;
  }

  // 禁用按钮 / 冻结对话框交互，避免写入期间重复提交
  setBusy(true, '写入中...');

  try {
    // 点「写入」直接生效，无二次确认
    setProgress('正在写入设备…');
    const editResult = await deps.invoke(plan.command, plan.args);

    // ---------- 3) 重新读取校验 ----------
    setProgress('写入已提交，正在重新读取确认…');
    const readback = await readFruImage(server, currentFruId, tempImagePath(server, currentFruId));

    const outcome = evaluateEditOutcome({
      editResult,
      readbackImage: readback.ok ? readback.image : null,
      sectionKey: plan.sectionKey,
      index: plan.index,
      newValue: value,
      expectedOldValue: plan.oldValue
    });

    if (readback.ok) {
      currentImage = readback.image;
      renderCurrent();
    }

    const label = plan.sectionLabel + ' / ' + plan.fieldLabel;
    setResult(
      outcome.severity === 'ok' ? 'ok' : outcome.severity,
      outcome.severity === 'ok' ? label + ' 已更新为 ' + value : outcome.message,
      formatResult(editResult)
    );

    if (!outcome.ok) {
      await deps.alert(outcome.message);
    } else if (outcome.severity === 'ok') {
      closeEdit();
    }
  } catch (err) {
    setResult('error', '写入异常: ' + err.message);
    await deps.alert('写入异常: ' + err.message);
  } finally {
    setBusy(false);
    setProgress(null);
    // 写入失败时对话框仍开着，按当前输入恢复按钮可用状态
    validatePreview();
  }
}

/**
 * 初始化 FRU 面板：绑定事件 + 初始占位
 *
 * @param {object} dependencies
 * @param {() => object|null} dependencies.getServer 返回当前选中的服务器
 * @param {(command:string, args?:string[]) => Promise<object>} dependencies.invoke 调用 ipmi:execute
 * @param {() => Promise<string|null>} dependencies.selectDirectory 选择目录
 * @param {(msg:string) => Promise<void>} dependencies.alert
 */
function initFruPanel(dependencies) {
  deps = Object.assign({}, deps, dependencies || {});

  const refreshBtn = document.getElementById('btn-fru-refresh');
  const backupBtn = document.getElementById('btn-fru-backup');
  const selectEl = document.getElementById('fru-select');
  const fieldsEl = document.getElementById('fru-fields');

  if (refreshBtn) refreshBtn.addEventListener('click', refresh);
  if (backupBtn) backupBtn.addEventListener('click', exportBackup);

  if (selectEl) {
    selectEl.addEventListener('change', (e) => {
      currentFruId = e.target.value;
      load();
    });
  }

  // 字段表用事件委托，避免内联 onclick（远端数据不进入属性）
  if (fieldsEl) {
    fieldsEl.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('.fru-edit-btn') : null;
      if (!btn || btn.disabled) return;
      openEdit(btn.dataset.section, btn.dataset.index);
    });
  }

  const closeBtn = document.getElementById('fru-dialog-close');
  const cancelBtn = document.getElementById('fru-dialog-cancel');
  const saveBtn = document.getElementById('fru-dialog-save');
  const inputEl = document.getElementById('fru-dialog-value');

  if (closeBtn) closeBtn.addEventListener('click', closeEdit);
  if (cancelBtn) cancelBtn.addEventListener('click', closeEdit);
  if (saveBtn) saveBtn.addEventListener('click', submitEdit);
  if (inputEl) {
    inputEl.addEventListener('input', (e) => validatePreview(e.target.value));
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitEdit();
    });
  }

  const dialog = document.getElementById('fru-dialog');
  if (dialog) {
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog && !busy) closeEdit();
    });
  }

  renderSelect();
}

/**
 * 面板首次切入时的惰性加载
 */
function ensureLoaded() {
  if (!currentImage && !busy) refresh();
}

module.exports = {
  lockReason,
  renderFruOptions,
  renderFruSections,
  renderStaticRow,
  renderFieldRow,
  summarizeImage,
  planEdit,
  evaluateEditOutcome,
  initFruPanel,
  refresh,
  load,
  exportBackup,
  openEdit,
  closeEdit,
  validatePreview,
  submitEdit,
  ensureLoaded
};
