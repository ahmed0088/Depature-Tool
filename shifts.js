// ═══════════════════════════════════════════════════════════
//  shifts.js  —  Shift Tasks (Morning / Afternoon / Mid / Night)
//  + drag-to-reorder & ↑↓ buttons
// ═══════════════════════════════════════════════════════════

// ── Shift log ─────────────────────────────────────────────
function addShiftLog(action, detail, shiftKey) {
  const t = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  shiftLog.unshift({ action, detail, shift: SHIFTS[shiftKey]?.label || shiftKey, time: t, ts: Date.now() });
  if (shiftLog.length > 200) shiftLog.pop();
  saveShiftLog(shiftLog);
  renderShiftLog();
}

function renderShiftLog() {
  const wrap  = document.getElementById('shiftLogWrap');
  const body  = document.getElementById('shiftLogBody');
  const badge = document.getElementById('shiftLogCount');
  if (!wrap) return;
  if (!shiftLog.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  if (badge) badge.textContent = shiftLog.length;
  const icons = { 'Done':'✓', 'Undone':'↩', 'Added':'➕', 'Deleted':'✕', 'Reset':'↺', 'Edited':'✏️' };
  const cls   = { 'Done':'log-act-co', 'Undone':'log-act-late', 'Added':'log-act-ext', 'Deleted':'log-act-late', 'Reset':'log-act-late', 'Edited':'log-act-ext' };
  if (body) body.innerHTML = shiftLog.map(l => `
    <div class="log-row">
      <span class="log-room" style="font-size:0.62rem;min-width:100px;color:var(--text3);">${escapeLogText(l.shift)}</span>
      <span class="log-action ${cls[l.action] || ''}">${icons[l.action] || '·'} ${l.action}</span>
      <span class="log-name">${escapeLogText(l.detail)}</span>
      <span class="log-time">${l.time}</span>
    </div>`).join('');
}

function toggleShiftLog() {
  const body = document.getElementById('shiftLogBody');
  const icon = document.getElementById('shiftLogToggleIcon');
  if (!body) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  if (icon) icon.textContent = open ? '▸' : '▾';
}

function escapeLogText(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function switchShift(key, el) {
  document.querySelectorAll('.shift-tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
  const rb = document.getElementById('shiftResetBtn');
  if (rb) rb.textContent = '↺ Reset ' + SHIFTS[key].label;
  renderShift(key);
}

function renderShift(key) {
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
      <input class="st-add-in"   id="stIn-${key}"   placeholder="Add new task…"       onkeydown="if(event.key==='Enter')stAddTask('${key}')"/>
      <input class="st-add-hint" id="stHint-${key}" placeholder="Hint (optional)"/>
      <button class="btn gold sm" onclick="stAddTask('${key}')">+ Add</button>
    </div>
    ${shift.resetAt ? `<div style="font-family:var(--mono);font-size:0.58rem;color:var(--text3);margin-top:6px;">Last reset: ${shift.resetAt}</div>` : ''}`;

  document.getElementById('shiftContent').innerHTML = '<div class="shift-panel active">' + html + '</div>';
  updateShiftBadge(key);
  initDragSort(key);
}

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

// ── Move task up or down by index ─────────────────────────
function stMove(key, id, dir) {
  const tasks = SHIFTS[key].tasks;
  const idx   = tasks.findIndex(t => t.id === id);
  const to    = idx + dir;
  if (to < 0 || to >= tasks.length) return;
  [tasks[idx], tasks[to]] = [tasks[to], tasks[idx]];
  renderShift(key);
  saveShifts(SHIFTS);
}

// ── Drag-and-drop sort ────────────────────────────────────
let _dragSrc = null;

function initDragSort(key) {
  const list = document.getElementById('stList-' + key);
  if (!list) return;

  list.querySelectorAll('.st-item[draggable]').forEach(item => {
    item.addEventListener('dragstart', e => {
      _dragSrc = item;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      list.querySelectorAll('.st-item').forEach(i => i.classList.remove('drag-over'));
      _dragSrc = null;
    });
    item.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
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
      renderShift(key);
      saveShifts(SHIFTS);
    });
  });
}

function stToggle(key, id) {
  const shift = SHIFTS[key];
  const idx   = shift.done.indexOf(id);
  const task  = shift.tasks.find(t => t.id === id);
  if (idx >= 0) {
    shift.done.splice(idx, 1);
    addShiftLog('Undone', task?.name || id, key);
  } else {
    shift.done.push(id);
    addShiftLog('Done', task?.name || id, key);
  }
  renderShift(key);
  saveShifts(SHIFTS);
}

function stAddTask(key) {
  const nEl  = document.getElementById('stIn-'   + key);
  const hEl  = document.getElementById('stHint-' + key);
  const name = (nEl?.value || '').trim();
  if (!name) return;
  SHIFTS[key].tasks.push({ id: 't' + Date.now(), name, hint: (hEl?.value || '').trim() });
  if (nEl) nEl.value = '';
  if (hEl) hEl.value = '';
  addShiftLog('Added', name, key);
  renderShift(key);
  saveShifts(SHIFTS);
}

function stDelete(key, id) {
  if (!confirm('Delete this task?')) return;
  const task = SHIFTS[key].tasks.find(t => t.id === id);
  SHIFTS[key].tasks = SHIFTS[key].tasks.filter(t => t.id !== id);
  SHIFTS[key].done  = SHIFTS[key].done.filter(d => d !== id);
  addShiftLog('Deleted', task?.name || id, key);
  renderShift(key);
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
  addShiftLog('Edited', task.name, key);
  renderShift(key);
  saveShifts(SHIFTS);
}

function resetShift(key) {
  if (!confirm('Reset all tasks for ' + SHIFTS[key].label + '?')) return;
  SHIFTS[key].done    = [];
  SHIFTS[key].resetAt = new Date().toLocaleString('en-GB');
  addShiftLog('Reset', `All ${SHIFTS[key].tasks.length} tasks reset`, key);
  renderShift(key);
  saveShifts(SHIFTS);
  showToast('Shift reset ✓');
}

function updateShiftBadge(key) {
  const shift  = SHIFTS[key];
  const spEl   = document.getElementById('sp-' + key);
  if (spEl) spEl.textContent = shift.done.length + '/' + shift.tasks.length;
  const total  = Object.values(SHIFTS).reduce((s, sh) => s + sh.tasks.length, 0);
  const done   = Object.values(SHIFTS).reduce((s, sh) => s + sh.done.length,  0);
  const badge  = document.getElementById('badge-shifts');
  if (badge) badge.textContent = total ? done + '/' + total : '—';
}

function initShifts() {
  Object.keys(SHIFTS).forEach(k => {
    if (!SHIFTS[k].tasks || !SHIFTS[k].tasks.length) {
      SHIFTS[k].tasks = DEFAULT_TASKS[k].map(t => ({...t}));
      SHIFTS[k].done  = [];
    }
    updateShiftBadge(k);
  });
}
