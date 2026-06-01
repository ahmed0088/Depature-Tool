// ═══════════════════════════════════════════════════════════
//  shifts.js  —  Shift Tasks (Morning / Afternoon / Mid / Night)
// ═══════════════════════════════════════════════════════════

// ── Activity log per shift ────────────────────────────────
const SHIFT_LOGS = { morning:[], afternoon:[], mid:[], night:[] };

function stLog(key, type, taskName) {
  const t = new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
  SHIFT_LOGS[key].unshift({ t, type, taskName });
  if (SHIFT_LOGS[key].length > 50) SHIFT_LOGS[key].pop();
}

function _buildShiftLog(key) {
  const entries = SHIFT_LOGS[key] || [];
  if (!entries.length) return '<div class="st-log-empty">No activity yet</div>';
  const dot = { done:'var(--mint)', undone:'var(--text3)', added:'var(--sky)', deleted:'var(--rose)', reset:'var(--amber)' };
  return entries.map(e => `
    <div class="st-log-entry">
      <span class="st-log-dot" style="background:${dot[e.type]||'var(--text3)'}"></span>
      <span class="st-log-text"><strong>${e.taskName}</strong> — ${e.type}</span>
      <span class="st-log-time">${e.t}</span>
    </div>`).join('');
}

function stCopyLog(key) {
  const entries = SHIFT_LOGS[key] || [];
  if (!entries.length) { showToast('Log is empty','info'); return; }
  const lines = entries.map(e => `${e.t}  ${e.type.padEnd(8)}  ${e.taskName}`);
  copyToClipboard(`${SHIFTS[key].label} Log\n${'─'.repeat(40)}\n${lines.join('\n')}`, null, '');
  showToast('Log copied ✓','ok');
}

function stClearLog(key) {
  SHIFT_LOGS[key] = [];
  _renderShiftContent(key);
}

// ── Tab switch ────────────────────────────────────────────
function switchShift(key, el) {
  activeShift = key;
  document.querySelectorAll('.shift-tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
  const rb = document.getElementById('shiftResetBtn');
  if (rb) rb.textContent = '↺ Reset ' + SHIFTS[key].label;
  _renderShiftContent(key);
}

// ── Full render (initial load only) ──────────────────────
function renderShift(key) {
  activeShift = key;
  _renderShiftContent(key);
}

// ── Content render (safe — never resets active tab) ──────
function _renderShiftContent(key) {
  const shift     = SHIFTS[key];
  const done      = new Set(shift.done);
  const total     = shift.tasks.length;
  const doneCount = done.size;
  const pct       = total ? Math.round(doneCount / total * 100) : 0;

  const html = `
    <div class="shift-header">
      <div class="shift-title-block">
        <div class="shift-color-dot" style="background:${shift.color};box-shadow:0 0 8px ${shift.color}44;"></div>
        <div class="shift-title" style="color:${shift.color};">${shift.label}</div>
        <div class="shift-time-badge">${shift.time}</div>
      </div>
    </div>
    <div class="prog-wrap">
      <div class="prog-info">
        <span>${doneCount} of ${total} tasks done</span>
        <span style="font-family:var(--serif);font-size:1.2rem;color:${shift.color};">${pct}%</span>
      </div>
      <div class="prog-track">
        <div class="prog-fill" style="background:${shift.color};width:${pct}%"></div>
      </div>
    </div>
    <div id="stList-${key}" class="st-sortable">
      ${shift.tasks.map((t, i) => stItemHTML(key, t, done.has(t.id), i, total)).join('')}
    </div>
    <div class="st-add-wrap">
      <input class="st-add-in"   id="stIn-${key}"   placeholder="Add new task…" onkeydown="if(event.key==='Enter')stAddTask('${key}')"/>
      <input class="st-add-hint" id="stHint-${key}" placeholder="Hint (optional)"/>
      <button class="btn gold sm" onclick="stAddTask('${key}')">+ Add</button>
    </div>
    ${shift.resetAt ? `<div style="font-family:var(--mono);font-size:0.58rem;color:var(--text3);margin-top:6px;">Last reset: ${shift.resetAt}</div>` : ''}
    <div class="st-log-card">
      <div class="st-log-head">
        <span>📋 Shift Log</span>
        <div style="display:flex;gap:6px;">
          <button class="btn sm" style="font-size:0.58rem;padding:2px 7px;" onclick="stCopyLog('${key}')">📋 Copy</button>
          <button class="btn sm" style="font-size:0.58rem;padding:2px 7px;" onclick="stClearLog('${key}')">✕ Clear</button>
        </div>
      </div>
      <div class="st-log-body" id="stLog-${key}">${_buildShiftLog(key)}</div>
    </div>`;

  document.getElementById('shiftContent').innerHTML = '<div class="shift-panel active">' + html + '</div>';
  updateShiftBadge(key);
  initDragSort(key);
}

// ── Task card HTML ────────────────────────────────────────
function stItemHTML(key, t, isDone, index, total) {
  const isFirst = index === 0;
  const isLast  = index === total - 1;
  return `<div class="st-item${isDone ? ' done' : ''}" draggable="true" data-id="${t.id}" data-key="${key}">
    <div class="st-drag-handle" title="Drag to reorder">⠿</div>
    <div class="st-check" onclick="stToggle('${key}','${t.id}')"></div>
    <div class="st-text">
      <div class="st-name">${t.name}</div>
      ${t.hint ? `<div class="st-hint">${t.hint}</div>` : ''}
    </div>
    <div class="st-actions">
      <div class="st-move-btns">
        <button class="cl-step-btn move-btn" onclick="stMove('${key}','${t.id}',-1)" ${isFirst ? 'disabled' : ''} title="Move up">↑</button>
        <button class="cl-step-btn move-btn" onclick="stMove('${key}','${t.id}', 1)" ${isLast  ? 'disabled' : ''} title="Move down">↓</button>
      </div>
      <button class="cl-step-btn edit-btn" onclick="openEditTask('${key}','${t.id}')">✏️</button>
      <button class="cl-step-btn del"      onclick="stDelete('${key}','${t.id}')">✕</button>
    </div>
  </div>`;
}

// ── Toggle task done ──────────────────────────────────────
function stToggle(key, id) {
  const shift = SHIFTS[key];
  const task  = shift.tasks.find(t => t.id === id);
  const idx   = shift.done.indexOf(id);
  if (idx >= 0) { shift.done.splice(idx, 1); stLog(key, 'undone', task?.name || id); logActivity('shift_task_undone', `[${SHIFTS[key].label}] ${task?.name || id}`); }
  else          { shift.done.push(id);        stLog(key, 'done',   task?.name || id); logActivity('shift_task_done',  `[${SHIFTS[key].label}] ${task?.name || id}`); }
  _renderShiftContent(key);
  updateShiftBadge(key);
  saveShifts(SHIFTS);
}

// ── Move up/down ──────────────────────────────────────────
function stMove(key, id, dir) {
  const tasks = SHIFTS[key].tasks;
  const idx   = tasks.findIndex(t => t.id === id);
  const to    = idx + dir;
  if (to < 0 || to >= tasks.length) return;
  [tasks[idx], tasks[to]] = [tasks[to], tasks[idx]];
  _renderShiftContent(key);
  saveShifts(SHIFTS);
}

// ── Drag-and-drop sort ────────────────────────────────────
let _dragSrc = null;

function initDragSort(key) {
  const list = document.getElementById('stList-' + key);
  if (!list) return;
  list.querySelectorAll('.st-item[draggable]').forEach(item => {
    item.addEventListener('dragstart', e => {
      _dragSrc = item; item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      list.querySelectorAll('.st-item').forEach(i => i.classList.remove('drag-over'));
      _dragSrc = null;
    });
    item.addEventListener('dragover', e => {
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      if (_dragSrc && _dragSrc !== item) {
        list.querySelectorAll('.st-item').forEach(i => i.classList.remove('drag-over'));
        item.classList.add('drag-over');
      }
    });
    item.addEventListener('drop', e => {
      e.preventDefault();
      if (!_dragSrc || _dragSrc === item) return;
      const srcId  = _dragSrc.dataset.id;
      const dstId  = item.dataset.id;
      const tasks  = SHIFTS[key].tasks;
      const srcIdx = tasks.findIndex(t => t.id === srcId);
      const dstIdx = tasks.findIndex(t => t.id === dstId);
      if (srcIdx < 0 || dstIdx < 0) return;
      const [moved] = tasks.splice(srcIdx, 1);
      tasks.splice(dstIdx, 0, moved);
      _renderShiftContent(key);
      saveShifts(SHIFTS);
    });
  });
}

// ── Add / Delete / Edit ───────────────────────────────────
function stAddTask(key) {
  const nEl  = document.getElementById('stIn-'   + key);
  const hEl  = document.getElementById('stHint-' + key);
  const name = (nEl?.value || '').trim();
  if (!name) return;
  SHIFTS[key].tasks.push({ id: 't' + Date.now(), name, hint: (hEl?.value || '').trim() });
  if (nEl) nEl.value = '';
  if (hEl) hEl.value = '';
  stLog(key, 'added', name);
  logActivity('shift_task_added', `[${SHIFTS[key].label}] ${name}`);
  _renderShiftContent(key);
  saveShifts(SHIFTS);
}

function stDelete(key, id) {
  if (!confirm('Delete this task?')) return;
  const task = SHIFTS[key].tasks.find(t => t.id === id);
  stLog(key, 'deleted', task?.name || id);
  logActivity('shift_task_deleted', `[${SHIFTS[key].label}] ${task?.name || id}`);
  SHIFTS[key].tasks = SHIFTS[key].tasks.filter(t => t.id !== id);
  SHIFTS[key].done  = SHIFTS[key].done.filter(d => d !== id);
  _renderShiftContent(key);
  saveShifts(SHIFTS);
}

function openEditTask(key, id) {
  const task = SHIFTS[key].tasks.find(t => t.id === id);
  if (!task) return;
  document.getElementById('et-shift').value = key;
  document.getElementById('et-id').value    = id;
  document.getElementById('et-name').value  = task.name;
  document.getElementById('et-hint').value  = task.hint || '';
  document.getElementById('editTaskModal').classList.add('open');
}

function saveEditTask() {
  const key  = document.getElementById('et-shift').value;
  const id   = document.getElementById('et-id').value;
  const task = SHIFTS[key]?.tasks.find(t => t.id === id);
  if (!task) return;
  task.name = document.getElementById('et-name').value.trim() || task.name;
  task.hint = document.getElementById('et-hint').value.trim();
  document.getElementById('editTaskModal').classList.remove('open');
  _renderShiftContent(key);
  saveShifts(SHIFTS);
}

// ── Reset shift ───────────────────────────────────────────
function resetShift(key) {
  if (!confirm('Reset all tasks for ' + SHIFTS[key].label + '?')) return;
  SHIFTS[key].done    = [];
  SHIFTS[key].resetAt = new Date().toLocaleString('en-GB');
  stLog(key, 'reset', 'All tasks');
  logActivity('shift_reset', SHIFTS[key].label);
  _renderShiftContent(key);
  saveShifts(SHIFTS);
  showToast('Shift reset ✓');
}

// ── Badge update ──────────────────────────────────────────
function updateShiftBadge(key) {
  const shift = SHIFTS[key];
  const spEl  = document.getElementById('sp-' + key);
  if (spEl) spEl.textContent = shift.done.length + '/' + shift.tasks.length;
  const total = Object.values(SHIFTS).reduce((s, sh) => s + sh.tasks.length, 0);
  const done  = Object.values(SHIFTS).reduce((s, sh) => s + sh.done.length,  0);
  const badge = document.getElementById('badge-shifts');
  if (badge) badge.textContent = total ? done + '/' + total : '—';
}

// ── Init ──────────────────────────────────────────────────
function initShifts() {
  Object.keys(SHIFTS).forEach(k => {
    if (!SHIFTS[k].tasks || !SHIFTS[k].tasks.length) {
      SHIFTS[k].tasks = DEFAULT_TASKS[k].map(t => ({...t}));
      SHIFTS[k].done  = [];
    }
    updateShiftBadge(k);
  });
}
