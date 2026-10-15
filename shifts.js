// ═══════════════════════════════════════════════════════════
//  shifts.js  —  Shift Tasks (Morning / Afternoon / Mid / Night)
// ═══════════════════════════════════════════════════════════

// ── Activity log per shift ────────────────────────────────
const SHIFT_LOGS = { morning:[], afternoon:[], mid:[], night:[] };

function stLog(key, type, taskName) {
  const t  = new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
  const by = (typeof currentProfile !== 'undefined' && currentProfile?.name) || 'Front Desk';
  const entry = { t, type, taskName, by };
  SHIFT_LOGS[key].unshift(entry);
  if (SHIFT_LOGS[key].length > 50) SHIFT_LOGS[key].pop();
  // one entry on top of the saved log (a colleague's entries stay), not this device's whole copy
  if (typeof fbPushLog === 'function') fbPushLog(`shiftLog/data/${key}`, entry, 50).then(v => {
    if (!v) return;
    SHIFT_LOGS[key] = v;
    const el = document.getElementById('stLog-' + key); if (el) el.innerHTML = _buildShiftLog(key);
  });
  else if (typeof saveShiftLog === 'function') saveShiftLog(SHIFT_LOGS);
}

function _buildShiftLog(key) {
  const entries = SHIFT_LOGS[key] || [];
  if (!entries.length) return '<div class="st-log-empty">No activity yet</div>';
  const dot = { done:'var(--mint)', undone:'var(--text3)', added:'var(--sky)', deleted:'var(--rose)', reset:'var(--amber)' };
  return entries.map(e => `
    <div class="st-log-entry">
      <span class="st-log-dot" style="background:${dot[e.type]||'var(--text3)'}"></span>
      <span class="st-log-text"><strong>${escapeHtml(e.taskName)}</strong> — ${escapeHtml(e.type)}${e.by ? ` <span class="st-log-by">· ${escapeHtml(e.by)}</span>` : ''}</span>
      <span class="st-log-time">${escapeHtml(e.t)}</span>
    </div>`).join('');
}

function stCopyLog(key) {
  const entries = SHIFT_LOGS[key] || [];
  if (!entries.length) { showToast('Log is empty','info'); return; }
  const lines = entries.map(e => `${e.t}  ${e.type.padEnd(8)}  ${e.taskName}${e.by ? `  (${e.by})` : ''}`);
  copyToClipboard(`${SHIFTS[key].label} Log\n${'─'.repeat(40)}\n${lines.join('\n')}`, null, '');
  showToast('Log copied ✓','ok');
}

function stClearLog(key) {
  if (!confirm(`Clear the ${SHIFTS[key].label} activity log? This can't be undone.`)) return;
  SHIFT_LOGS[key] = [];
  _renderShiftContent(key);
  if (typeof fbSet === 'function') fbSet(`shiftLog/data/${key}`, null);   // only this shift's log
  else if (typeof saveShiftLog === 'function') saveShiftLog(SHIFT_LOGS);
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
  const day       = stDayOf(key);
  const active    = shift.tasks.filter(t => stTaskState(t, day, key) === 'on');
  const soon      = shift.tasks.filter(t => stTaskState(t, day) === 'soon').sort((a, b) => a.on < b.on ? -1 : 1);
  const total     = active.length;
  const doneCount = active.filter(t => stIsDone(key, t)).length;
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
        <span>${total ? (pct === 100 ? '✓ All tasks done' : `${doneCount} of ${total} tasks done`) : 'No tasks yet'}</span>
        <span style="font-family:var(--serif);font-size:1.2rem;color:${shift.color};">${pct}%</span>
      </div>
      <div class="prog-track">
        <div class="prog-fill${pct === 100 ? ' prog-fill-complete' : ''}" style="background:${shift.color};width:${pct}%"></div>
      </div>
    </div>
    ${total > 0 && pct === 100 ? `
    <div class="shift-complete-banner" style="border-color:${shift.color}55;background:${shift.color}14;color:${shift.color};">
      🎉 All caught up on the ${shift.label} — nice work.
    </div>` : ''}
    ${stQuietHtml()}
    <div id="stList-${key}" class="st-sortable">
      ${total ? active.map(t => stItemHTML(key, t, stIsDone(key, t), shift.tasks.indexOf(t), shift.tasks.length)).join('')
              : '<div class="st-empty">No tasks on this shift yet — add one below.</div>'}
    </div>
    ${soon.length ? `<div class="st-soon"><div class="st-soon-hd">📅 Coming up <span>${soon.length}</span></div>${soon.map(t => `<div class="st-soon-row"><b>${escapeHtml(_stDateLbl(t.on))}</b>${t.at ? `<span class="st-at">⏰ ${escapeHtml(t.at)}</span>` : ''}<span class="st-soon-n">${escapeHtml(t.name)}</span><button class="cl-step-btn edit-btn" onclick="openEditTask('${key}','${t.id}')" title="Edit">✏️</button><button class="cl-step-btn del" onclick="stDelete('${key}','${t.id}')" title="Delete">✕</button></div>`).join('')}</div>` : ''}
    <div class="st-add-wrap">
      <input class="st-add-in"   id="stIn-${key}"   placeholder="Add new task…" onkeydown="if(event.key==='Enter')stAddTask('${key}')"/>
      <input class="st-add-hint" id="stHint-${key}" placeholder="Hint (optional)" onkeydown="if(event.key==='Enter')stAddTask('${key}')"/>
      <input class="st-add-at" id="stAt-${key}" type="time" title="Time (optional): I remind you then, on this shift" aria-label="Time"/>
      <input class="st-add-at" id="stOn-${key}" type="date" title="Date (optional): a one-off task for that day only. It waits in Coming up and reminds you on the day" aria-label="Date"/>
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
      <div class="st-name">${t.on ? _stOnChip(key, t, isDone) : ''}${t.at ? `<span class="st-at${!isDone && stIsLate(key, t) ? ' late' : ''}" title="${stIsLate(key, t) && !isDone ? 'Time passed, not done yet' : 'Reminder at this time'}">⏰ ${escapeHtml(t.at)}</span>` : ''}${escapeHtml(t.name)}</div>
      ${t.hint ? `<div class="st-hint">${escapeHtml(t.hint)}</div>` : ''}
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
  if (task && task.on) return _stToggleDated(key, task);
  const idx   = shift.done.indexOf(id);
  if (idx >= 0) { shift.done.splice(idx, 1); stLog(key, 'undone', task?.name || id); logActivity('shift_task_undone', `[${SHIFTS[key].label}] ${task?.name || id}`); }
  else          { shift.done.push(id);        stLog(key, 'done',   task?.name || id); logActivity('shift_task_done',  `[${SHIFTS[key].label}] ${task?.name || id}`); }
  _renderShiftContent(key);
  updateShiftBadge(key);
  _stSaveTick(key, id, idx < 0);
  if (typeof isOnline === 'function' && !isOnline()) showToast('Saved locally — offline', 'info');
}

// A tick changes only that one task, on top of what the team has ticked: the
// saved list is read fresh and this tick is added to (or taken from) it. Saving
// this device's whole list instead wiped the ticks of a colleague whenever this
// copy was behind (a phone waking up, a bubble tapped minutes later).
async function _stSaveTick(key, id, add) {
  if (!_shiftsLoaded) { console.warn('[shifts] not saving — the saved tasks have not loaded yet'); return; }
  const path = 'shifts/data/' + key + '/done';
  let cur = null;
  try { cur = typeof fbGet === 'function' ? await fbGet(path) : null; } catch (_) {}
  const list = Array.isArray(cur) ? cur : (cur && typeof cur === 'object') ? Object.values(cur) : SHIFTS[key].done.slice();
  const set = new Set(list.filter(Boolean));
  if (add) set.add(id); else set.delete(id);
  SHIFTS[key].done = [...set].filter(x => SHIFTS[key].tasks.some(t => t.id === x));
  if (typeof fbSet === 'function') { fbSet(path, SHIFTS[key].done); fbSet('shifts/updatedAt', new Date().toISOString()); }
  else persistShifts();
  updateShiftBadge(key);
  if (typeof activeShift !== 'undefined' && activeShift === key && document.getElementById('panel-shifts')?.classList.contains('active')) _renderShiftContent(key);
}

// ── Move up/down ──────────────────────────────────────────
function stMove(key, id, dir) {
  const tasks = SHIFTS[key].tasks;
  const idx   = tasks.findIndex(t => t.id === id);
  const to    = idx + dir;
  if (to < 0 || to >= tasks.length) return;
  [tasks[idx], tasks[to]] = [tasks[to], tasks[idx]];
  _renderShiftContent(key);
  persistShifts(key);
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
      persistShifts(key);
    });
  });
}

// ── Add / Delete / Edit ───────────────────────────────────
function stAddTask(key) {
  const nEl  = document.getElementById('stIn-'   + key);
  const hEl  = document.getElementById('stHint-' + key);
  const aEl  = document.getElementById('stAt-'   + key);
  const name = (nEl?.value || '').trim();
  if (!name) return;
  const task = { id: 't' + Date.now(), name, hint: (hEl?.value || '').trim() };
  if (aEl?.value) task.at = aEl.value;
  const oEl = document.getElementById('stOn-' + key);
  if (oEl?.value) task.on = oEl.value;
  SHIFTS[key].tasks.push(task);
  if (nEl) nEl.value = '';
  if (hEl) hEl.value = '';
  if (aEl) aEl.value = '';
  if (oEl) oEl.value = '';
  if (task.on && task.on > stDayOf(key) && typeof showToast === 'function') showToast(`📅 Saved for ${_stDateLbl(task.on)}: it waits in Coming up and reminds you on the day`, 'ok');
  stLog(key, 'added', name);
  logActivity('shift_task_added', `[${SHIFTS[key].label}] ${name}`);
  _renderShiftContent(key);
  persistShifts(key);
  // Re-render swaps the DOM out from under the old input — refocus the new
  // one so adding several tasks in a row doesn't need a re-click each time
  document.getElementById('stIn-' + key)?.focus();
}

function stDelete(key, id) {
  const idx  = SHIFTS[key].tasks.findIndex(t => t.id === id);
  if (idx < 0) return;
  const task = SHIFTS[key].tasks[idx];
  const wasDone = SHIFTS[key].done.includes(id);

  stLog(key, 'deleted', task?.name || id);
  logActivity('shift_task_deleted', `[${SHIFTS[key].label}] ${task?.name || id}`);
  SHIFTS[key].tasks = SHIFTS[key].tasks.filter(t => t.id !== id);
  SHIFTS[key].done  = SHIFTS[key].done.filter(d => d !== id);
  _renderShiftContent(key);
  persistShifts(key);

  if (typeof showUndoToast === 'function') {
    showUndoToast(`Deleted "${task.name}"`, () => {
      SHIFTS[key].tasks.splice(idx, 0, task);
      if (wasDone) SHIFTS[key].done.push(id);
      stLog(key, 'added', task.name + ' (restored)');
      _renderShiftContent(key);
      persistShifts(key);
      if (wasDone) _stSaveTick(key, id, true);
    });
  }
}

function openEditTask(key, id) {
  const task = SHIFTS[key].tasks.find(t => t.id === id);
  if (!task) return;
  document.getElementById('et-shift').value = key;
  document.getElementById('et-id').value    = id;
  document.getElementById('et-name').value  = task.name;
  document.getElementById('et-hint').value  = task.hint || '';
  const at = document.getElementById('et-at'); if (at) at.value = task.at || '';
  const on = document.getElementById('et-on'); if (on) on.value = task.on || '';
  document.getElementById('editTaskModal').classList.add('open');
}

function saveEditTask() {
  const key  = document.getElementById('et-shift').value;
  const id   = document.getElementById('et-id').value;
  const task = SHIFTS[key]?.tasks.find(t => t.id === id);
  if (!task) return;
  task.name = document.getElementById('et-name').value.trim() || task.name;
  task.hint = document.getElementById('et-hint').value.trim();
  const at = document.getElementById('et-at')?.value || '';
  if (at) task.at = at; else delete task.at;
  const on = document.getElementById('et-on')?.value || '';
  if (on) task.on = on; else delete task.on;
  document.getElementById('editTaskModal').classList.remove('open');
  _renderShiftContent(key);
  persistShifts(key);
}

// ── Reset shift ───────────────────────────────────────────
function resetShift(key) {
  if (!confirm('Reset all tasks for ' + SHIFTS[key].label + '?')) return;
  SHIFTS[key].done    = [];
  SHIFTS[key].resetAt = new Date().toLocaleString('en-GB');
  stLog(key, 'reset', 'All tasks');
  logActivity('shift_reset', SHIFTS[key].label);
  _renderShiftContent(key);
  persistShifts(key, { done: null, resetAt: SHIFTS[key].resetAt });
  const isOffline = typeof isOnline === 'function' && !isOnline();
  showToast(isOffline ? 'Shift reset ✓ (offline — will sync when reconnected)' : 'Shift reset ✓', isOffline ? 'info' : 'ok');
}

// ── Badge update ──────────────────────────────────────────
function updateShiftBadge(key) {
  const shift = SHIFTS[key];
  const spEl  = document.getElementById('sp-' + key);
  const c = stCount(key);
  if (spEl) spEl.textContent = c.done + '/' + c.total;
  const all = Object.keys(SHIFTS).map(stCount);
  const total = all.reduce((s, x) => s + x.total, 0);
  const done  = all.reduce((s, x) => s + x.done, 0);
  const badge = document.getElementById('badge-shifts');
  if (badge) badge.textContent = total ? done + '/' + total : '—';
}

// ── Init ──────────────────────────────────────────────────
// A shift with no tasks at all is not a real state — it means nothing has
// been saved yet, so the standard list is what should be on screen. A shift
// keeps whatever it holds as long as it holds something, so a task deleted
// on purpose stays deleted.
function initShifts() {
  Object.keys(SHIFTS).forEach(k => {
    if (!SHIFTS[k].tasks || !SHIFTS[k].tasks.length) {
      SHIFTS[k].tasks = DEFAULT_TASKS[k].map(t => ({...t}));
      SHIFTS[k].done  = [];
    }
    updateShiftBadge(k);
  });
}

// True once Firebase has actually answered about the shifts node — either
// with data or with a confirmed absence of it.
//
// This gates every write. saveShifts() replaces the whole node, so a save
// fired before the real tasks have arrived overwrites them for the entire
// team with whatever this device happens to be holding. That is not
// hypothetical: saveShifts(SHIFTS) is called from places that have nothing
// to do with shifts, such as copying a no-show report, so a single click in
// the wrong moment was enough to wipe everyone's tasks.
let _shiftsLoaded = false;
function shiftsLoaded() { return _shiftsLoaded; }

// Every write goes through here. Nothing is sent until the database has
// been heard from, so the app can only ever overwrite data it has seen.
function persistShifts(key, extra) {
  if (!_shiftsLoaded) {
    console.warn('[shifts] not saving — the saved tasks have not loaded yet');
    return false;
  }
  // One shift's task list only (and what the caller says changed): saving all four lists from this
  // device's copy undid a colleague's ticks and tasks on the other shifts whenever this copy was behind.
  if (key && SHIFTS[key] && typeof fbUpdate === 'function') {
    fbUpdate('shifts/data/' + key, Object.assign({ tasks: SHIFTS[key].tasks }, extra || {}));
    fbSet('shifts/updatedAt', new Date().toISOString());
    return true;
  }
  saveShifts(SHIFTS);
  return true;
}

// The single place saved shift data is applied, used by both the initial
// load and the live listener. They previously did this separately and
// disagreed: an empty task list from Firebase fell back to the defaults on
// load but overwrote them in the listener, so the board could end up blank
// with no way back. Pass null/undefined when there is nothing saved, and
// heardFromDb=false when the read failed rather than came back empty — a
// failed read must not unlock writing.
function applyShiftData(saved, heardFromDb = true) {
  Object.keys(SHIFTS).forEach(k => {
    const s = saved && saved[k];
    if (s) {
      SHIFTS[k].tasks   = Array.isArray(s.tasks) && s.tasks.length ? s.tasks : [];
      SHIFTS[k].done    = Array.isArray(s.done) ? s.done.filter(Boolean) : (s.done && typeof s.done === 'object') ? Object.values(s.done) : [];
      SHIFTS[k].resetAt = s.resetAt || '';
      SHIFTS[k].autoDay = s.autoDay || '';
      SHIFTS[k].doneDated = s.doneDated && typeof s.doneDated === 'object' ? s.doneDated : {};
    }
  });
  initShifts();   // fills in any shift left with nothing, and repaints the badges
  if (heardFromDb) _shiftsLoaded = true;
}

// ── A fresh list for every shift, by itself ───────────────
// Each shift starts with nothing ticked: the first time the app is open
// during a new morning / afternoon / night, that shift's ticks are cleared
// for the whole team (once — the date is saved with the tasks). The shift
// that just ended keeps its ticks for the handover. Settings → Helpers can
// turn this off.
/** Which shift's task list is current, by the hours on the roster (night from 00:00, morning from 08:00…).
 *  Falls back to 07:00 / 15:00 / 23:00 before any roster is in. */
function hoShiftNow(now) {
  now = now || new Date();
  const T = typeof rtTaskTimes === 'function' ? (() => { try { return rtTaskTimes(); } catch (_) { return null; } })() : null;
  const min = t => { const m = String(t || '').match(/(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
  const starts = [['night', min(T && T.night) ?? 23 * 60], ['morning', min(T && T.morning) ?? 7 * 60], ['afternoon', min(T && T.afternoon) ?? 15 * 60]].sort((a, b) => a[1] - b[1]);
  const m = now.getHours() * 60 + now.getMinutes();
  let cur = starts.filter(s => s[1] <= m).pop(), prevDay = false;
  if (!cur) { cur = starts[starts.length - 1]; prevDay = true; }   // before the first start: the last shift of yesterday
  const start = new Date(now); start.setHours(0, 0, 0, 0); if (prevDay) start.setDate(start.getDate() - 1);
  start.setMinutes(cur[1]);
  return { key: cur[0], start };
}
function _stCurrentInstance() {
  const now = new Date(), sh = hoShiftNow(now), key = sh.key, start = sh.start;
  const pad = n => String(n).padStart(2, '0');   // local date, not UTC
  return { key, day: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}` };
}
let _stFreshBusy = false;
/** The day the latest run of this shift started (a list is fresh once per day, when its shift begins).
 *  Start times come from the roster (Shift Tasks hours); before any roster: 07:00, 12:00, 15:00, 23:00. */
function _stLastStartDay(key, now) {
  now = now || new Date();
  const T = typeof rtTaskTimes === 'function' ? (() => { try { return rtTaskTimes(); } catch (_) { return null; } })() : null;
  const min = t => { const m = String(t || '').match(/(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
  const def = { morning: 7 * 60, mid: 12 * 60, afternoon: 15 * 60, night: 23 * 60 }[key];
  const st = min(T && T[key]) ?? def;
  const d = new Date(now); d.setHours(0, 0, 0, 0);
  if (now.getHours() * 60 + now.getMinutes() < st) d.setDate(d.getDate() - 1);   // not started yet today: yesterday's run
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** Every list starts fresh each day, by itself: each shift's ticks are cleared once when that shift
 *  begins, for the whole team, even if nobody opened that list since. The shift that just ended keeps
 *  its ticks until its next start, for the handover. Settings → Helpers can turn this off. */
async function stAutoFreshStart() {
  if (typeof hoPref === 'function' && hoPref('autoResetShifts') === false) return;
  if (typeof _shiftsLoaded === 'undefined' || !_shiftsLoaded || typeof SHIFTS === 'undefined') return;
  if (typeof currentUser === 'undefined' || !currentUser) return;
  if (typeof isOnline === 'function' && !isOnline()) return;   // offline: can't see what the team did, so never clear
  if (_stFreshBusy) return;
  _stFreshBusy = true;
  try { for (const key of Object.keys(SHIFTS)) await _stFreshOne(key, _stLastStartDay(key)); }
  finally { _stFreshBusy = false; }
}
async function _stFreshOne(key, day) {
  const sh = SHIFTS[key];
  if (!sh || (sh.autoDay && sh.autoDay >= day)) return;
  // another device may have started this shift fresh already, and the team may have ticked since:
  // read the saved state first and only clear when nobody has started this run of the shift yet
  let saved = null;
  try { saved = typeof fbGet === 'function' ? await fbGet('shifts/data/' + key) : null; } catch (_) { return; }
  if (saved && saved.autoDay && saved.autoDay >= day) {
    sh.autoDay = saved.autoDay;
    sh.done = Array.isArray(saved.done) ? saved.done : (saved.done && typeof saved.done === 'object') ? Object.values(saved.done) : [];
    updateShiftBadge(key);
    return;
  }
  const saveThis = patch => { if (typeof fbUpdate === 'function') { fbUpdate('shifts/data/' + key, patch); fbSet('shifts/updatedAt', new Date().toISOString()); } else persistShifts(); };
  // never counted before (first run after an update) and running right now: keep what is ticked, count from now
  const running = typeof hoShiftNow === 'function' ? (() => { try { return hoShiftNow().key === key; } catch (_) { return false; } })() : false;
  if (!sh.autoDay && running) { sh.autoDay = day; saveThis({ autoDay: day }); return; }
  const hadTicks = (sh.done || []).length;
  sh.done = [];
  sh.autoDay = day;
  sh.resetAt = new Date().toLocaleString('en-GB');
  if (hadTicks) { try { stLog(key, 'reset', 'New day — started fresh automatically'); } catch (_) {} }
  saveThis({ done: null, autoDay: day, resetAt: sh.resetAt });   // only this shift's ticks, never the other lists
  updateShiftBadge(key);
  if (typeof activeShift !== 'undefined' && activeShift === key && document.getElementById('panel-shifts')?.classList.contains('active')) _renderShiftContent(key);
  const now = typeof hoShiftNow === 'function' ? (() => { try { return hoShiftNow().key; } catch (_) { return ''; } })() : '';
  if (hadTicks && key === now && typeof showToast === 'function' && !(typeof hoQuiet === 'function' && hoQuiet())) showToast(`⏰ New ${sh.label || key}: shift tasks start fresh`, 'ok');
}
setInterval(stAutoFreshStart, 60000);
document.addEventListener('DOMContentLoaded', () => setTimeout(stAutoFreshStart, 6000));

// ── Task times and reminders ──────────────────────────────
// A task can have a time ("02:00 check the cash"). On its shift, at that time, it rings (chime, a
// notification, a bubble with ✓ Done / Later) until it is ticked. Nothing rings when the roster says
// you're not working (day off, PH, leave, or outside your shift) — Settings → Alerts → Quiet when I'm off.
const _stMin = t => { const m = String(t || '').match(/^(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
const _stDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** Is this the shift running now? Mid has no slot of its own, so it counts during the day. */
function _stIsNow(key, now) {
  if (key === 'mid') { const h = now.getHours(); return h >= 8 && h < 22; }
  return hoShiftNow(now).key === key;
}
/** The time passed on the running shift and it isn't ticked */
function stIsLate(key, t, now) {
  now = now || new Date();
  const m = _stMin(t.at); if (m == null || !_stIsNow(key, now)) return false;
  const st = key === 'mid' ? null : hoShiftNow(now).start;
  const due = new Date(st ? st : now); if (!st) due.setHours(0, 0, 0, 0);
  due.setHours(Math.floor(m / 60), m % 60, 0, 0);
  if (st && due < st) due.setDate(due.getDate() + 1);   // 02:00 on a night that started at 23:00
  return now >= due;
}
function stQuietHtml() {
  if (typeof hoQuiet !== 'function' || !hoQuiet()) return '';
  const d = hoMyDuty();
  return `<div class="st-quiet">🌴 Reminders are quiet: ${escapeHtml(d.why || 'you\'re not on shift')}. <small>From the roster · Settings → Alerts</small></div>`;
}
const ST_REM_KEY = 'st_reminded_v1';
function stRemindTick() {
  if (typeof hoPref === 'function' && hoPref('taskReminders') === false) return;
  if (!_shiftsLoaded || typeof currentUser === 'undefined' || !currentUser) return;
  if (typeof hoQuiet === 'function' && hoQuiet()) return;
  const now = new Date(), nowMs = now.getTime();
  let seen = {}; try { seen = JSON.parse(localStorage.getItem(ST_REM_KEY) || '{}'); } catch (_) {}
  const keep = new Set([_stDay(now), _stDay(new Date(nowMs - 86400e3))]);
  Object.keys(seen).forEach(id => { if (!keep.has(id.slice(0, 10))) delete seen[id]; });
  Object.keys(SHIFTS).forEach(key => {
    const sh = SHIFTS[key];
    (sh.tasks || []).forEach(t => {
      const day = key === 'mid' ? _stDay(now) : _stDay(hoShiftNow(now).start);
      if (stIsDone(key, t)) return;
      if (t.on && t.on !== day) return;                       // a dated task rings only on its day
      if (t.on && !t.at) {                                    // no time: once, when its shift is on
        if (!_stIsNow(key, now)) return;
        const id = `${day}|${key}|${t.id}`;
        if (seen[id] != null && !(seen[id] > 0 && seen[id] <= nowMs)) return;
        seen[id] = 0; _stRing(key, t, id); return;
      }
      if (!t.at || !stIsLate(key, t, now)) return;
      const id = `${day}|${key}|${t.id}`, v = seen[id];
      if (v === 0 || (v && v > nowMs)) return;           // done with it, or "later" not due yet
      const due = _stMin(t.at), late = (now.getHours() * 60 + now.getMinutes() - due + 1440) % 1440;
      if (v == null && late > 30) { seen[id] = 0; return; }   // set long after its time: just show it as late
      seen[id] = 0;
      _stRing(key, t, id);
    });
  });
  try { localStorage.setItem(ST_REM_KEY, JSON.stringify(seen)); } catch (_) {}
}
function _stLater(id, min) {
  let seen = {}; try { seen = JSON.parse(localStorage.getItem(ST_REM_KEY) || '{}'); } catch (_) {}
  seen[id] = Date.now() + min * 60e3;
  try { localStorage.setItem(ST_REM_KEY, JSON.stringify(seen)); } catch (_) {}
}
function _stRing(key, t, id) {
  const text = `${t.at ? '⏰ ' + t.at : '📅 Today'} · ${t.name}`, why = `${SHIFTS[key].label}${t.hint ? ' · ' + t.hint : ''}`;
  if (typeof hoAlert === 'function') hoAlert(text, true);
  if (typeof blSay === 'function') blSay({ id: 'st:' + id, type: 'heal', tone: 'warn', icon: '⏰', text: `${t.at || '📅 Today'} · ${t.name}`, why,
    acts: [['✓ Done', () => { if (!stIsDone(key, t)) stToggle(key, t.id); }], ['In 10 min', () => _stLater(id, 10)]] }, true);
  else if (typeof showToast === 'function') showToast(text, 'warn');
  if (typeof activeShift !== 'undefined' && activeShift === key && document.getElementById('panel-shifts')?.classList.contains('active')) _renderShiftContent(key);
}
setInterval(stRemindTick, 30000);
document.addEventListener('DOMContentLoaded', () => setTimeout(stRemindTick, 8000));

// ── Dated tasks ───────────────────────────────────────────
// A task can have a date ("15 Oct: send the group rooming list"): a one-off for that day.
// Before it, it waits in 📅 Coming up (not counted). On the day it is on that shift's list and
// reminds you (at its time, or when the shift starts). Not ticked by the end of its day, it
// stays on the list as "missed" until someone ticks or deletes it. Its tick is kept apart
// (doneDated), so the fresh start of each shift doesn't clear it.
const _stIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** The date a shift's list is for: the running shift's own day (a night started yesterday), else today */
function stDayOf(key, now) {
  now = now || new Date();
  try { if (key !== 'mid' && hoShiftNow(now).key === key) return _stIso(hoShiftNow(now).start); } catch (_) {}
  return _stIso(now);
}
function stIsDone(key, t) { const sh = SHIFTS[key]; return t.on ? !!(sh.doneDated || {})[t.id] : (sh.done || []).includes(t.id); }
/** 'on' (on the list), 'soon' (a later date), 'gone' (its day passed and it was ticked) */
function stTaskState(t, day, key) {
  if (!t.on) return 'on';
  if (t.on > day) return 'soon';
  if (t.on < day && key && stIsDone(key, t)) return 'gone';
  return 'on';
}
function stCount(key) {
  const sh = SHIFTS[key]; if (!sh) return { done: 0, total: 0 };
  const day = stDayOf(key);
  const act = (sh.tasks || []).filter(t => stTaskState(t, day, key) === 'on');
  return { done: act.filter(t => stIsDone(key, t)).length, total: act.length };
}
function _stDateLbl(iso) {
  const d = new Date(iso + 'T12:00:00'), t = new Date(), tm = new Date(); tm.setDate(t.getDate() + 1);
  if (_stIso(d) === _stIso(t)) return 'Today';
  if (_stIso(d) === _stIso(tm)) return 'Tomorrow';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}
function _stOnChip(key, t, isDone) {
  const day = stDayOf(key);
  if (t.on < day && !isDone) return `<span class="st-on late" title="Its day passed and it wasn't ticked">📅 missed ${escapeHtml(_stDateLbl(t.on))}</span>`;
  return `<span class="st-on" title="A one-off task for this day">📅 ${escapeHtml(_stDateLbl(t.on))}</span>`;
}
function _stToggleDated(key, task) {
  const sh = SHIFTS[key]; sh.doneDated = sh.doneDated || {};
  const was = !!sh.doneDated[task.id];
  if (was) delete sh.doneDated[task.id]; else sh.doneDated[task.id] = { by: (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || '', at: new Date().toISOString() };
  stLog(key, was ? 'undone' : 'done', task.name);
  if (typeof logActivity === 'function') logActivity(was ? 'shift_task_undone' : 'shift_task_done', `[${sh.label}] ${task.name} (${task.on})`);
  _renderShiftContent(key); updateShiftBadge(key);
  if (!_shiftsLoaded) return;
  if (typeof fbSet === 'function') { fbSet(`shifts/data/${key}/doneDated/${task.id}`, was ? null : sh.doneDated[task.id]); fbSet('shifts/updatedAt', new Date().toISOString()); }
  else persistShifts();
}
/** Dated tasks ticked more than 2 weeks after their day are tidied away (once a day, on one device is enough) */
function _stTidyDated() {
  if (!_shiftsLoaded || typeof SHIFTS === 'undefined') return;
  const cut = _stIso(new Date(Date.now() - 14 * 864e5));
  Object.keys(SHIFTS).forEach(k => {
    const sh = SHIFTS[k], old = (sh.tasks || []).filter(t => t.on && t.on < cut && stIsDone(k, t));
    if (!old.length) return;
    sh.tasks = sh.tasks.filter(t => !old.includes(t));
    old.forEach(t => { delete (sh.doneDated || {})[t.id]; });
    persistShifts(k, Object.fromEntries(old.map(t => ['doneDated/' + t.id, null])));
  });
}
setTimeout(() => setInterval(_stTidyDated, 6 * 3600e3), 60e3);
