// ═══════════════════════════════════════════════════════════
//  shifts.js  —  Shift Tasks (Morning / Afternoon / Mid / Night)
// ═══════════════════════════════════════════════════════════

function switchShift(key, el) {
  activeShift = key;
  document.querySelectorAll('.shift-tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
  const rb = document.getElementById('shiftResetBtn');
  if (rb) rb.textContent = '↺ Reset ' + SHIFTS[key].label;
  renderShift(key);
}

function renderShift(key) {
  if (!SHIFTS[key]) {
    console.error('Shift not found:', key);
    return;
  }
  
  const shift = SHIFTS[key];
  const doneSet = new Set(shift.done || []);
  const tasks = shift.tasks || [];
  const total = tasks.length;
  const doneCount = doneSet.size;
  const pct = total ? Math.round(doneCount / total * 100) : 0;

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
    <div id="stList-${key}" class="st-list-container">
      ${tasks.map((t, idx) => stItemHTML(key, t, doneSet.has(t.id), idx)).join('')}
    </div>
    <div class="st-add-wrap">
      <input class="st-add-in" id="stIn-${key}" placeholder="Add new task…" onkeydown="if(event.key==='Enter')stAddTask('${key}')"/>
      <input class="st-add-hint" id="stHint-${key}" placeholder="Hint (optional)"/>
      <button class="btn gold sm" onclick="stAddTask('${key}')">+ Add</button>
    </div>
    ${shift.resetAt ? `<div style="font-family:var(--mono);font-size:0.58rem;color:var(--text3);margin-top:6px;">Last reset: ${shift.resetAt}</div>` : ''}`;

  const container = document.getElementById('shiftContent');
  if (container) {
    container.innerHTML = '<div class="shift-panel active">' + html + '</div>';
  }
  makeShiftTasksDraggable(key);
  updateShiftBadge(key);
}

function stItemHTML(key, t, isDone, idx) {
  return `<div class="st-item${isDone ? ' done' : ''}" draggable="true" data-shift="${key}" data-task-id="${t.id}" data-task-idx="${idx}">
    <div class="drag-handle" style="cursor:grab; color:var(--text3); font-size:0.7rem;">⋮⋮</div>
    <div class="st-check" onclick="stToggle('${key}','${t.id}')"></div>
    <div class="st-text">
      <div class="st-name">${escapeHtmlSimple(t.name)}</div>
      ${t.hint ? `<div class="st-hint">${escapeHtmlSimple(t.hint)}</div>` : ''}
    </div>
    <div class="st-actions">
      <button class="cl-step-btn edit-btn" onclick="openEditTask('${key}','${t.id}')">✏️</button>
      <button class="cl-step-btn del" onclick="stDelete('${key}','${t.id}')">✕</button>
    </div>
  </div>`;
}

function escapeHtmlSimple(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}

let draggedTask = null;
let draggedTaskShift = null;

function makeShiftTasksDraggable(key) {
  const container = document.getElementById(`stList-${key}`);
  if (!container) return;
  
  const items = container.querySelectorAll('.st-item');
  items.forEach(item => {
    item.setAttribute('draggable', 'true');
    item.removeEventListener('dragstart', handleShiftDragStart);
    item.removeEventListener('dragend', handleShiftDragEnd);
    item.removeEventListener('dragover', handleShiftDragOver);
    item.removeEventListener('drop', handleShiftDrop);
    
    item.addEventListener('dragstart', handleShiftDragStart);
    item.addEventListener('dragend', handleShiftDragEnd);
    item.addEventListener('dragover', handleShiftDragOver);
    item.addEventListener('drop', handleShiftDrop);
  });
}

function handleShiftDragStart(e) {
  draggedTask = this;
  draggedTaskShift = this.getAttribute('data-shift');
  e.dataTransfer.effectAllowed = 'move';
  this.style.opacity = '0.5';
}

function handleShiftDragEnd(e) {
  if (draggedTask) draggedTask.style.opacity = '';
  draggedTask = null;
  draggedTaskShift = null;
}

function handleShiftDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

function handleShiftDrop(e) {
  e.preventDefault();
  if (!draggedTask || draggedTask === this) return;
  
  const fromShift = draggedTaskShift;
  const toShift = this.getAttribute('data-shift');
  const fromIdx = parseInt(draggedTask.getAttribute('data-task-idx'));
  const toIdx = parseInt(this.getAttribute('data-task-idx'));
  
  if (fromShift === toShift && fromIdx !== toIdx && !isNaN(fromIdx) && !isNaN(toIdx)) {
    const tasks = SHIFTS[fromShift].tasks;
    const [movedTask] = tasks.splice(fromIdx, 1);
    tasks.splice(toIdx, 0, movedTask);
    renderShift(fromShift);
    saveShifts(SHIFTS);
    showToast('Task reordered ✓');
  }
  
  draggedTask.style.opacity = '';
  draggedTask = null;
  draggedTaskShift = null;
}

function stToggle(key, id) {
  if (!SHIFTS[key]) return;
  const shift = SHIFTS[key];
  const idx = shift.done.indexOf(id);
  if (idx >= 0) shift.done.splice(idx, 1);
  else shift.done.push(id);
  renderShift(key);
  saveShifts(SHIFTS);
}

function stAddTask(key) {
  if (!SHIFTS[key]) return;
  const nEl = document.getElementById('stIn-' + key);
  const hEl = document.getElementById('stHint-' + key);
  const name = (nEl?.value || '').trim();
  if (!name) return;
  SHIFTS[key].tasks.push({ id: 't' + Date.now(), name, hint: (hEl?.value || '').trim() });
  if (nEl) nEl.value = '';
  if (hEl) hEl.value = '';
  renderShift(key);
  saveShifts(SHIFTS);
}

function stDelete(key, id) {
  if (!SHIFTS[key]) return;
  if (!confirm('Delete this task?')) return;
  SHIFTS[key].tasks = SHIFTS[key].tasks.filter(t => t.id !== id);
  SHIFTS[key].done = SHIFTS[key].done.filter(d => d !== id);
  renderShift(key);
  saveShifts(SHIFTS);
}

function openEditTask(key, id) {
  if (!SHIFTS[key]) return;
  const task = SHIFTS[key].tasks.find(t => t.id === id);
  if (!task) return;
  document.getElementById('et-shift').value = key;
  document.getElementById('et-id').value = id;
  document.getElementById('et-name').value = task.name;
  document.getElementById('et-hint').value = task.hint || '';
  document.getElementById('editTaskModal').classList.add('open');
}

function saveEditTask() {
  const key = document.getElementById('et-shift').value;
  const id = document.getElementById('et-id').value;
  if (!SHIFTS[key]) return;
  const task = SHIFTS[key].tasks.find(t => t.id === id);
  if (!task) return;
  task.name = document.getElementById('et-name').value.trim() || task.name;
  task.hint = document.getElementById('et-hint').value.trim();
  document.getElementById('editTaskModal').classList.remove('open');
  renderShift(key);
  saveShifts(SHIFTS);
}

function resetShift(key) {
  if (!SHIFTS[key]) return;
  if (!confirm('Reset all tasks for ' + SHIFTS[key].label + '?')) return;
  SHIFTS[key].done = [];
  SHIFTS[key].resetAt = new Date().toLocaleString('en-GB');
  renderShift(key);
  saveShifts(SHIFTS);
  showToast('Shift reset ✓');
}

function updateShiftBadge(key) {
  if (!SHIFTS[key]) return;
  const shift = SHIFTS[key];
  const spEl = document.getElementById('sp-' + key);
  if (spEl) spEl.textContent = (shift.done?.length || 0) + '/' + (shift.tasks?.length || 0);
  const total = Object.values(SHIFTS).reduce((s, sh) => s + (sh.tasks?.length || 0), 0);
  const done = Object.values(SHIFTS).reduce((s, sh) => s + (sh.done?.length || 0), 0);
  const badge = document.getElementById('badge-shifts');
  if (badge) badge.textContent = total ? done + '/' + total : '—';
}

function initShifts() {
  Object.keys(SHIFTS).forEach(k => {
    if (!SHIFTS[k].tasks || SHIFTS[k].tasks.length === 0) {
      if (DEFAULT_TASKS[k]) {
        SHIFTS[k].tasks = DEFAULT_TASKS[k].map(t => ({ ...t }));
      } else {
        SHIFTS[k].tasks = [];
      }
    }
    if (!SHIFTS[k].done) SHIFTS[k].done = [];
    if (!SHIFTS[k].resetAt) SHIFTS[k].resetAt = '';
    updateShiftBadge(k);
  });
  if (activeShift && SHIFTS[activeShift]) {
    renderShift(activeShift);
  } else {
    renderShift('morning');
  }
}

// Call init when script loads
setTimeout(() => {
  if (document.getElementById('shiftContent')) {
    initShifts();
  }
}, 100);
