// ═══════════════════════════════════════════════════════════
//  checklist.js  —  Night Run Checklist (editable steps)
//  + ↑↓ reorder buttons in edit mode
// ═══════════════════════════════════════════════════════════

function clToggleEdit() {
  clEditMode = !clEditMode;
  const addRow = document.getElementById('clAddRow');
  if (addRow) addRow.style.display = clEditMode ? 'block' : 'none';
  const btn = document.getElementById('clEditBtn');
  if (btn) btn.textContent = clEditMode ? '✅ Done Editing' : '✏️ Edit Steps';
  clRender2();
}

function clAddStep() {
  const name = (document.getElementById('clNewName').value  || '').trim(); if (!name) return;
  const hint = (document.getElementById('clNewHint').value  || '').trim();
  const phase = document.getElementById('clNewPhase').value;
  const tag   = document.getElementById('clNewTag').value;
  const id    = Math.max(0, ...CL_STEPS.map(s => s.id)) + 1;
  CL_STEPS.push({ id, phase, name, tag, hint });
  document.getElementById('clNewName').value = '';
  document.getElementById('clNewHint').value = '';
  clRender2();
  saveChecklist(CL_STEPS, clState.done, clState.skipped);
}

function clDeleteStep(id) {
  if (!confirm('Delete this step?')) return;
  CL_STEPS = CL_STEPS.filter(s => s.id !== id);
  clState.done.delete(id);
  clState.skipped.delete(id);
  clRender2();
  saveChecklist(CL_STEPS, clState.done, clState.skipped);
}

// ── Move a checklist step up or down within its phase ─────
function clMoveStep(id, dir) {
  const step  = CL_STEPS.find(s => s.id === id);
  if (!step) return;
  // Work within same phase only
  const phaseSteps = CL_STEPS.filter(s => s.phase === step.phase);
  const allIdx     = phaseSteps.map(s => CL_STEPS.indexOf(s));
  const localIdx   = phaseSteps.findIndex(s => s.id === id);
  const toLocal    = localIdx + dir;
  if (toLocal < 0 || toLocal >= phaseSteps.length) return;
  // Swap in the master array
  const aIdx = allIdx[localIdx];
  const bIdx = allIdx[toLocal];
  [CL_STEPS[aIdx], CL_STEPS[bIdx]] = [CL_STEPS[bIdx], CL_STEPS[aIdx]];
  clRender2();
  saveChecklist(CL_STEPS, clState.done, clState.skipped);
}

function openEditStep(id) {
  const s = CL_STEPS.find(s => s.id === id); if (!s) return;
  document.getElementById('es-id').value    = id;
  document.getElementById('es-name').value  = s.name;
  document.getElementById('es-hint').value  = s.hint  || '';
  document.getElementById('es-phase').value = s.phase;
  document.getElementById('es-tag').value   = s.tag;
  document.getElementById('editStepModal').classList.add('open');
}
function closeEditStep() { document.getElementById('editStepModal').classList.remove('open'); }

function saveEditStep() {
  const id = parseInt(document.getElementById('es-id').value);
  const s  = CL_STEPS.find(s => s.id === id); if (!s) return;
  s.name  = document.getElementById('es-name').value.trim()  || s.name;
  s.hint  = document.getElementById('es-hint').value.trim();
  s.phase = document.getElementById('es-phase').value;
  s.tag   = document.getElementById('es-tag').value;
  closeEditStep();
  clRender2();
  saveChecklist(CL_STEPS, clState.done, clState.skipped);
}

function clRender2() {
  const phases = [
    { key:'pre',  label:'Before Night Run' },
    { key:'run',  label:'Night Run' },
    { key:'post', label:'After Night Run' },
  ];
  const tagColors = { check:'var(--mint)', save:'var(--gold)', scan:'var(--sky)', charge:'var(--amber)', run:'var(--rose)' };
  let html = '';
  phases.forEach(ph => {
    const steps = CL_STEPS.filter(s => s.phase === ph.key);
    if (!steps.length) return;
    html += `<div class="cl-phase-hd">
      <div class="cl-phase-line"></div>
      <div class="cl-phase-lbl">${ph.label}</div>
      <div class="cl-phase-line"></div>
    </div>`;
    steps.forEach((s, i) => {
      const done    = clState.done.has(s.id);
      const skip    = clState.skipped.has(s.id);
      const isFirst = i === 0;
      const isLast  = i === steps.length - 1;
      html += `<div class="cl-step${done?' done':''}${skip?' skipped':''}"
                    draggable="${clEditMode}"
                    data-cl-id="${s.id}"
                    data-cl-phase="${s.phase}">
        <div class="cl-step-main" onclick="${clEditMode ? '' : `clToggle2(${s.id})`}">
          ${clEditMode ? `<div class="st-drag-handle" title="Drag to reorder">⠿</div>` : ''}
          <div class="cl-check">✓</div>
          <div class="cl-content">
            <div class="cl-num">STEP ${s.id} ·
              <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${tagColors[s.tag]||'var(--text3)'};margin-right:3px;vertical-align:middle;"></span>
              <span style="font-size:0.54rem;color:${tagColors[s.tag]||'var(--text3)'};">${s.tag.toUpperCase()}</span>
            </div>
            <div class="cl-name">${s.name}</div>
            ${s.hint ? `<div class="cl-hint">${s.hint}</div>` : ''}
          </div>
          <div class="cl-step-btns" onclick="event.stopPropagation()">
            ${clEditMode
              ? `<div class="st-move-btns">
                   <button class="cl-step-btn move-btn" onclick="clMoveStep(${s.id},-1)" ${isFirst?'disabled':''} title="Move up">↑</button>
                   <button class="cl-step-btn move-btn" onclick="clMoveStep(${s.id}, 1)" ${isLast ?'disabled':''} title="Move down">↓</button>
                 </div>
                 <button class="cl-step-btn edit-btn" onclick="openEditStep(${s.id})">✏️</button>
                 <button class="cl-step-btn del"      onclick="clDeleteStep(${s.id})">✕</button>`
              : `<button class="cl-step-btn"          onclick="clSkip2(${s.id})">${skip ? '↩ Show' : 'Skip'}</button>`}
          </div>
        </div>
      </div>`;
    });
  });
  const el = document.getElementById('clStepList2');
  if (el) el.innerHTML = html;
  clUpdateProgress();
  if (clEditMode) clInitDragSort();
}

// ── Drag-and-drop for checklist steps (within same phase) ─
let _clDragSrc = null;

function clInitDragSort() {
  const list = document.getElementById('clStepList2');
  if (!list) return;
  list.querySelectorAll('.cl-step[draggable="true"]').forEach(item => {
    item.addEventListener('dragstart', e => {
      _clDragSrc = item;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      list.querySelectorAll('.cl-step').forEach(i => i.classList.remove('drag-over'));
      _clDragSrc = null;
    });
    item.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (_clDragSrc && _clDragSrc !== item) {
        list.querySelectorAll('.cl-step').forEach(i => i.classList.remove('drag-over'));
        item.classList.add('drag-over');
      }
    });
    item.addEventListener('drop', e => {
      e.preventDefault();
      if (!_clDragSrc || _clDragSrc === item) return;
      const srcId    = parseInt(_clDragSrc.dataset.clId);
      const dstId    = parseInt(item.dataset.clId);
      const srcStep  = CL_STEPS.find(s => s.id === srcId);
      const dstStep  = CL_STEPS.find(s => s.id === dstId);
      // Only allow drop within same phase
      if (!srcStep || !dstStep || srcStep.phase !== dstStep.phase) return;
      const srcIdx = CL_STEPS.indexOf(srcStep);
      const dstIdx = CL_STEPS.indexOf(dstStep);
      const [moved] = CL_STEPS.splice(srcIdx, 1);
      CL_STEPS.splice(dstIdx, 0, moved);
      clRender2();
      saveChecklist(CL_STEPS, clState.done, clState.skipped);
    });
  });
}

function clToggle2(id) {
  if (clState.skipped.has(id)) return;
  if (clState.done.has(id)) clState.done.delete(id);
  else                      clState.done.add(id);
  clRender2();
  saveChecklist(CL_STEPS, clState.done, clState.skipped);
}

function clSkip2(id) {
  if (clState.skipped.has(id)) clState.skipped.delete(id);
  else { clState.skipped.add(id); clState.done.delete(id); }
  clRender2();
  saveChecklist(CL_STEPS, clState.done, clState.skipped);
}

function clUpdateProgress() {
  const active = CL_STEPS.filter(s => !clState.skipped.has(s.id));
  const done   = active.filter(s => clState.done.has(s.id)).length;
  const total  = active.length;
  const pct    = total ? Math.round(done / total * 100) : 0;

  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setEl('clProgLabel', `${done} of ${total} steps done`);
  setEl('clProgPct',   pct + '%');
  setEl('badge-checklist', pct === 100 ? '✓' : total);
  const fill = document.getElementById('clProgFill');
  if (fill) fill.style.width = pct + '%';

  const comp = document.getElementById('clComplete2');
  const tEl  = document.getElementById('clCompleteTime2');
  if (comp) {
    if (pct === 100 && total > 0) {
      comp.style.display = 'block';
      if (tEl) tEl.textContent = 'Completed at ' + new Date().toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'});
    } else {
      comp.style.display = 'none';
    }
  }
}

function clReset() {
  if (!confirm('Reset all checkboxes for a new night?')) return;
  clState.done.clear();
  clState.skipped.clear();
  clRender2();
  saveChecklist(CL_STEPS, clState.done, clState.skipped);
  showToast('Checklist reset for new night ✓');
}
