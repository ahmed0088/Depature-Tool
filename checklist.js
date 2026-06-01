// ═══════════════════════════════════════════════════════════
//  checklist.js  —  Night Run Checklist (editable steps)
//  + ↑↓ reorder buttons in edit mode
//  + 📷 photo attachments per step (base64, synced to Firebase)
//  + 📝 per-step notes
//  + ⏱ completion timestamps
// ═══════════════════════════════════════════════════════════

// ── Photo store: { stepId: [ { data: base64, name: string, ts: iso } ] }
let clPhotos = {};

// ── Per-step notes: { stepId: string }
let clNotes = {};

// ── Completion timestamps: { stepId: iso }
let clDoneTimes = {};

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
  clSaveAll();
}

function clDeleteStep(id) {
  if (!confirm('Delete this step?')) return;
  CL_STEPS = CL_STEPS.filter(s => s.id !== id);
  clState.done.delete(id);
  clState.skipped.delete(id);
  delete clPhotos[id];
  delete clNotes[id];
  delete clDoneTimes[id];
  clRender2();
  clSaveAll();
}

// ── Move a checklist step up or down within its phase ─────
function clMoveStep(id, dir) {
  const step  = CL_STEPS.find(s => s.id === id);
  if (!step) return;
  const phaseSteps = CL_STEPS.filter(s => s.phase === step.phase);
  const allIdx     = phaseSteps.map(s => CL_STEPS.indexOf(s));
  const localIdx   = phaseSteps.findIndex(s => s.id === id);
  const toLocal    = localIdx + dir;
  if (toLocal < 0 || toLocal >= phaseSteps.length) return;
  const aIdx = allIdx[localIdx];
  const bIdx = allIdx[toLocal];
  [CL_STEPS[aIdx], CL_STEPS[bIdx]] = [CL_STEPS[bIdx], CL_STEPS[aIdx]];
  clRender2();
  clSaveAll();
}

function openEditStep(id) {
  const s = CL_STEPS.find(s => s.id === id); if (!s) return;
  document.getElementById('es-id').value    = id;
  document.getElementById('es-name').value  = s.name;
  document.getElementById('es-hint').value  = s.hint  || '';
  document.getElementById('es-phase').value = s.phase;
  document.getElementById('es-tag').value   = s.tag;
  _renderModalPhotos(id);
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
  clSaveAll();
}

// ── Unified save ─────────────────────────────────────────
function clSaveAll() {
  saveChecklist(CL_STEPS, clState.done, clState.skipped, clPhotos, clNotes, clDoneTimes);
}

// ── Activity log ─────────────────────────────────────────
let clLog = []; // { ts, type, stepId, stepName, note }

function clAddLog(type, stepId, stepName, extra) {
  const entry = {
    ts: new Date().toISOString(),
    type,        // 'done' | 'undone' | 'skipped' | 'unskipped' | 'note' | 'reset'
    stepId,
    stepName: stepName || '',
    extra: extra || ''
  };
  clLog.unshift(entry); // newest first
  if (clLog.length > 100) clLog.pop(); // cap at 100
  clRenderLog();
}

function clRenderLog() {
  const body  = document.getElementById('clLogBody');
  const count = document.getElementById('clLogCount');
  if (!body) return;
  if (count) count.textContent = clLog.length;

  if (!clLog.length) {
    body.innerHTML = '<div class="cl-log-empty">No activity yet.<br>Tick steps to log them.</div>';
    return;
  }

  const labels = {
    done:      { dot: 'done',    text: 'Completed' },
    undone:    { dot: 'undone',  text: 'Unchecked' },
    skipped:   { dot: 'skipped', text: 'Skipped'   },
    unskipped: { dot: 'done',    text: 'Restored'  },
    note:      { dot: 'note',    text: 'Note saved' },
    reset:     { dot: 'reset',   text: 'Night reset' },
  };

  body.innerHTML = clLog.map(e => {
    const l  = labels[e.type] || { dot: 'done', text: e.type };
    const t  = new Date(e.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const nm = e.stepName ? `<strong>${e.stepName}</strong>` : '<strong>—</strong>';
    const ex = e.extra    ? `<span style="color:var(--text3);"> · ${e.extra}</span>` : '';
    return `<div class="cl-log-entry">
      <div class="cl-log-dot ${l.dot}"></div>
      <div class="cl-log-text">${l.text} ${nm}${ex}</div>
      <div class="cl-log-time">${t}</div>
    </div>`;
  }).join('');
}

function clClearLog() {
  if (!clLog.length) return;
  if (!confirm('Clear activity log?')) return;
  clLog = [];
  clRenderLog();
  showToast('Log cleared', 'info');
}

function clCopyLog() {
  if (!clLog.length) { showToast('Log is empty', 'info'); return; }
  const lines = clLog.map(e => {
    const t  = new Date(e.ts).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
    const lbl = { done:'✓ Done', undone:'↩ Undone', skipped:'— Skipped', unskipped:'↩ Restored', note:'📝 Note', reset:'↺ Reset' };
    return `${t}  ${lbl[e.type]||e.type}  ${e.stepName}${e.extra ? ' · '+e.extra : ''}`;
  });
  const header = `Night Run Log · ${new Date().toLocaleDateString('en-GB', {day:'numeric',month:'long',year:'numeric'})}\n${'─'.repeat(52)}\n`;
  copyToClipboard(header + lines.join('\n'), null, '');
  showToast('Log copied ✓', 'ok');
}

// ════════════════════════════════════════════════════════════
//  PHOTO ATTACHMENT FEATURE
// ════════════════════════════════════════════════════════════

function clHandlePhotoUpload(evt, stepId) {
  const files = Array.from(evt.target.files);
  if (!files.length) return;
  if (!clPhotos[stepId]) clPhotos[stepId] = [];
  let loaded = 0;
  files.forEach(file => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = e => {
      _compressImage(e.target.result, 1200, 0.82, compressed => {
        clPhotos[stepId].push({ data: compressed, name: file.name, ts: new Date().toISOString() });
        loaded++;
        if (loaded === files.length) {
          _renderModalPhotos(stepId);
          clRender2();
          clSaveAll();
          showToast('Photo added ✓', 'ok');
        }
      });
    };
    reader.readAsDataURL(file);
  });
  evt.target.value = '';
}

function _compressImage(dataUrl, maxW, quality, cb) {
  const img = new Image();
  img.onload = () => {
    let w = img.width, h = img.height;
    if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    cb(canvas.toDataURL('image/jpeg', quality));
  };
  img.src = dataUrl;
}

function clDeletePhoto(stepId, idx) {
  if (!clPhotos[stepId]) return;
  clPhotos[stepId].splice(idx, 1);
  if (!clPhotos[stepId].length) delete clPhotos[stepId];
  _renderModalPhotos(stepId);
  clRender2();
  clSaveAll();
  showToast('Photo removed', 'info');
}

function _renderModalPhotos(stepId) {
  const wrap = document.getElementById('es-photos');
  if (!wrap) return;
  const photos = clPhotos[stepId] || [];
  if (!photos.length) {
    wrap.innerHTML = '<div style="font-family:var(--mono);font-size:0.63rem;color:var(--text3);padding:6px 0;">No photos attached yet.</div>';
    return;
  }
  wrap.innerHTML = photos.map((p, i) => `
    <div class="cl-photo-thumb">
      <img src="${p.data}" alt="${p.name}" onclick="clOpenLightbox(${stepId},${i})" title="Click to expand"/>
      <button class="cl-photo-del" onclick="clDeletePhoto(${stepId},${i})" title="Remove photo">✕</button>
      <div class="cl-photo-name">${p.name.length > 18 ? p.name.slice(0,16)+'...' : p.name}</div>
    </div>
  `).join('');
}

function clOpenLightbox(stepId, idx) {
  const photos = clPhotos[stepId] || [];
  if (!photos[idx]) return;
  let current = idx;
  const lb  = document.getElementById('clLightbox');
  const img = document.getElementById('clLightboxImg');
  const cap = document.getElementById('clLightboxCaption');
  const step = CL_STEPS.find(s => s.id === stepId);

  function show(i) {
    current = (i + photos.length) % photos.length;
    img.src = photos[current].data;
    const ts = photos[current].ts ? ' · ' + new Date(photos[current].ts).toLocaleDateString('en-GB') : '';
    cap.innerHTML = `<strong>${step ? step.name : 'Step'}</strong><br>${(current+1)} / ${photos.length} · ${photos[current].name}${ts}`;
    document.getElementById('clLbPrev').style.display = photos.length > 1 ? '' : 'none';
    document.getElementById('clLbNext').style.display = photos.length > 1 ? '' : 'none';
  }

  document.getElementById('clLbPrev').onclick = () => show(current - 1);
  document.getElementById('clLbNext').onclick = () => show(current + 1);
  show(current);
  lb.classList.add('open');
}

function clCloseLightbox() {
  document.getElementById('clLightbox').classList.remove('open');
}

// ════════════════════════════════════════════════════════════
//  PER-STEP NOTES
// ════════════════════════════════════════════════════════════

function clSaveNote(stepId) {
  const el = document.getElementById('cl-note-' + stepId);
  if (!el) return;
  const val = el.value.trim();
  if (val) clNotes[stepId] = val;
  else delete clNotes[stepId];
  clSaveAll();
}

// ════════════════════════════════════════════════════════════
//  RENDER
// ════════════════════════════════════════════════════════════

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
      const photos  = clPhotos[s.id] || [];
      const note    = clNotes[s.id]  || '';
      const ts      = clDoneTimes[s.id] || '';

      const photoStrip = photos.length > 0 && !clEditMode ? `
        <div class="cl-photo-strip" onclick="event.stopPropagation()">
          ${photos.map((p,idx) => `<img src="${p.data}" class="cl-strip-thumb" onclick="clOpenLightbox(${s.id},${idx})" title="${p.name}"/>`).join('')}
          <span class="cl-photo-count">📷 ${photos.length} photo${photos.length>1?'s':''}</span>
        </div>` : '';

      const tsHtml = done && ts ? `<div class="cl-done-ts">✓ done at ${new Date(ts).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</div>` : '';

      const noteArea = !clEditMode ? `
        <div class="cl-note-wrap" onclick="event.stopPropagation()">
          <textarea class="cl-note-input" id="cl-note-${s.id}" rows="1" placeholder="Add a note…"
            onblur="clSaveNote(${s.id})"
          >${note}</textarea>
        </div>` : '';

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
              ${photos.length > 0 ? `<span class="cl-has-photo" title="${photos.length} photo(s) attached" style="margin-left:4px;">📷</span>` : ''}
            </div>
            <div class="cl-name">${s.name}</div>
            ${s.hint ? `<div class="cl-hint">${s.hint}</div>` : ''}
            ${tsHtml}
            ${photoStrip}
            ${noteArea}
          </div>
          <div class="cl-step-btns" onclick="event.stopPropagation()">
            ${clEditMode
              ? `<div class="st-move-btns">
                   <button class="cl-step-btn move-btn" onclick="clMoveStep(${s.id},-1)" ${isFirst?'disabled':''} title="Move up">↑</button>
                   <button class="cl-step-btn move-btn" onclick="clMoveStep(${s.id}, 1)" ${isLast ?'disabled':''} title="Move down">↓</button>
                 </div>
                 <button class="cl-step-btn photo-btn" onclick="document.getElementById('cl-upload-${s.id}').click()" title="Attach photo">📷</button>
                 <input type="file" id="cl-upload-${s.id}" accept="image/*" multiple style="display:none" onchange="clHandlePhotoUpload(event,${s.id})"/>
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
      if (!srcStep || !dstStep || srcStep.phase !== dstStep.phase) return;
      const srcIdx = CL_STEPS.indexOf(srcStep);
      const dstIdx = CL_STEPS.indexOf(dstStep);
      const [moved] = CL_STEPS.splice(srcIdx, 1);
      CL_STEPS.splice(dstIdx, 0, moved);
      clRender2();
      clSaveAll();
    });
  });
}

function clToggle2(id) {
  if (clState.skipped.has(id)) return;
  const step = CL_STEPS.find(s => s.id === id);
  if (clState.done.has(id)) {
    clState.done.delete(id);
    delete clDoneTimes[id];
    clAddLog('undone', id, step?.name);
    logActivity('checklist_undone', step?.name || id);
  } else {
    clState.done.add(id);
    clDoneTimes[id] = new Date().toISOString();
    clAddLog('done', id, step?.name);
    logActivity('checklist_done', step?.name || id);
  }
  clRender2();
  clSaveAll();
}

function clSkip2(id) {
  const step = CL_STEPS.find(s => s.id === id);
  if (clState.skipped.has(id)) {
    clState.skipped.delete(id);
    clAddLog('unskipped', id, step?.name);
    logActivity('checklist_unskipped', step?.name || id);
  } else {
    clState.skipped.add(id);
    clState.done.delete(id);
    delete clDoneTimes[id];
    clAddLog('skipped', id, step?.name);
    logActivity('checklist_skipped', step?.name || id);
  }
  clRender2();
  clSaveAll();
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
  clDoneTimes = {};
  clNotes = {};
  // Keep photos (they are step-level reference, not per-night)
  clRender2();
  clSaveAll();
  showToast('Checklist reset for new night ✓');
}
