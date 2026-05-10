// ═══════════════════════════════════════════════════════════
//  checklist.js  —  Night Run Checklist (editable steps)
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
    steps.forEach(s => {
      const done = clState.done.has(s.id);
      const skip = clState.skipped.has(s.id);
      html += `<div class="cl-step${done?' done':''}${skip?' skipped':''}">
        <div class="cl-step-main" onclick="clToggle2(${s.id})">
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
              ? `<button class="cl-step-btn edit-btn" onclick="openEditStep(${s.id})">✏️</button>
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
