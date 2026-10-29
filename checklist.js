// ═══════════════════════════════════════════════════════════
//  checklist.js  —  Night Run Checklist (editable steps)
//  + ↑↓ reorder buttons in edit mode
//  + 📷 photo attachments per step (base64, synced to Firebase)
//  + 📝 per-step notes
//  + ⏱ completion timestamps
//  + 📡 Opera: the night audit read as done suggests "tick it?" (never ticks by itself)
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
  const idx  = CL_STEPS.findIndex(s => s.id === id);
  if (idx < 0) return;
  const step = CL_STEPS[idx];
  const wasDone    = clState.done.has(id);
  const wasSkipped = clState.skipped.has(id);
  const photo = clPhotos[id], note = clNotes[id], doneTime = clDoneTimes[id];

  CL_STEPS = CL_STEPS.filter(s => s.id !== id);
  clState.done.delete(id);
  clState.skipped.delete(id);
  delete clPhotos[id];
  delete clNotes[id];
  delete clDoneTimes[id];
  clRender2();
  clSaveAll();

  if (typeof showUndoToast === 'function') {
    showUndoToast(`Deleted step "${step.name}"`, () => {
      CL_STEPS.splice(idx, 0, step);
      if (wasDone) clState.done.add(id);
      if (wasSkipped) clState.skipped.add(id);
      if (photo !== undefined) clPhotos[id] = photo;
      if (note !== undefined) clNotes[id] = note;
      if (doneTime !== undefined) clDoneTimes[id] = doneTime;
      clRender2();
      clSaveAll();
    });
  }
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

let _clNew = null;   // a step being created in the editor (added on Save)
const _clLines = v => String(v || '').split('\n').map(x => x.trim()).filter(Boolean);
function _clPanelOptions(sel) {
  const seen = new Set(), opts = ['<option value="">— none —</option>'];
  document.querySelectorAll('nav.sidenav .nav-item[data-panel]').forEach(n => {
    const id = n.dataset.panel; if (!id || seen.has(id) || id === 'checklist') return; seen.add(id);
    const lbl = (n.querySelector('.nav-label, span:not(.nav-badge)') || n).textContent.replace(/\s+/g, ' ').trim() || id;
    opts.push(`<option value="${escapeHtml(id)}"${id === sel ? ' selected' : ''}>${escapeHtml(lbl)}</option>`);
  });
  if (sel && !seen.has(sel)) opts.push(`<option value="${escapeHtml(sel)}" selected>${escapeHtml(sel)}</option>`);
  return opts.join('');
}
function _clFill(s, isNew) {
  const g = id => document.getElementById(id);
  g('es-id').value = s.id;
  g('es-title').textContent = isNew ? (s.tag === 'save' ? '📁 New report' : '＋ New step') : '✏️ Edit step';
  g('es-name').value = s.name || '';
  g('es-hint').value = s.hint || '';
  g('es-phase').value = s.phase || 'pre';
  g('es-tag').value = s.tag || 'check';
  g('es-report').value = s.report || '';
  g('es-due').value = s.due || '';
  g('es-how').value = (s.how || []).join('\n');
  g('es-look').value = (s.look || []).join('\n');
  g('es-warn').value = s.warn || '';
  g('es-panel').innerHTML = _clPanelOptions(s.panel || '');
  g('es-del').hidden = !!isNew; g('es-dup').hidden = !!isNew;
  _renderModalPhotos(s.id);
  document.getElementById('editStepModal').classList.add('open');
  setTimeout(() => { try { g(isNew ? 'es-name' : 'es-hint').focus(); } catch (_) {} }, 60);
}
function openEditStep(id) {
  const s = CL_STEPS.find(s => s.id === id); if (!s) return;
  _clNew = null;
  _clFill(s, false);
}
/** + New step / + New report: the full editor, added when you press Save */
function clNewStep(tag, phase) {
  const id = Math.max(0, ...CL_STEPS.map(s => +s.id || 0), 300) + 1;
  _clNew = { id, phase: phase || 'pre', tag: tag || 'check', name: '', hint: '' };
  _clFill(_clNew, true);
  if (tag === 'save') setTimeout(() => { try { document.getElementById('es-name').placeholder = 'e.g. Market Segment report'; } catch (_) {} }, 0);
}
function closeEditStep() {
  if (_clNew) { delete clPhotos[_clNew.id]; _clNew = null; }
  document.getElementById('editStepModal').classList.remove('open');
}
function saveEditStep() {
  const g = id => document.getElementById(id);
  const id = parseInt(g('es-id').value);
  const s = _clNew && _clNew.id === id ? _clNew : CL_STEPS.find(s => s.id === id); if (!s) return;
  const name = g('es-name').value.trim();
  if (!name) { showToast('Give the step a name', 'warn'); g('es-name').focus(); return; }
  s.name = name;
  s.hint = g('es-hint').value.trim();
  s.phase = g('es-phase').value;
  s.tag = g('es-tag').value;
  const set = (k, v) => { if (v && (!Array.isArray(v) || v.length)) s[k] = v; else delete s[k]; };
  // a "Save a report" step goes in the folder under its own name unless you named the report
  set('report', g('es-report').value.trim() || (_clNew && s.tag === 'save' ? name : ''));
  set('due', g('es-due').value);
  set('how', _clLines(g('es-how').value));
  set('look', _clLines(g('es-look').value));
  set('warn', g('es-warn').value.trim());
  set('panel', g('es-panel').value);
  s.edited = true;
  if (_clNew === s) {
    // in its part of the night: after the last step of that part
    let at = -1; CL_STEPS.forEach((x, i) => { if (x.phase === s.phase) at = i; });
    if (at < 0) { const order = ['pre', 'run', 'post']; at = CL_STEPS.filter(x => order.indexOf(x.phase) <= order.indexOf(s.phase)).length - 1; }
    CL_STEPS.splice(at + 1, 0, s);
    _clNew = null;
    showToast(`Added “${name}”`, 'ok');
  }
  document.getElementById('editStepModal').classList.remove('open');
  clRender2();
  clSaveAll();
}
function clDeleteFromModal() {
  const id = parseInt(document.getElementById('es-id').value);
  document.getElementById('editStepModal').classList.remove('open');
  clDeleteStep(id);
}
function clDuplicateFromModal() {
  const id = parseInt(document.getElementById('es-id').value);
  const s = CL_STEPS.find(x => x.id === id); if (!s) return;
  const copy = JSON.parse(JSON.stringify(s));
  copy.id = Math.max(0, ...CL_STEPS.map(x => +x.id || 0), 300) + 1;
  copy.name = s.name + ' (copy)'; copy.edited = true; delete copy.rv;
  if (copy.report) copy.report += ' (copy)';
  CL_STEPS.splice(CL_STEPS.indexOf(s) + 1, 0, copy);
  clRender2(); clSaveAll();
  _clNew = null; _clFill(copy, false);
}
/** bring back built-in steps that were deleted; your own steps and edits stay as they are */
function clRestoreRoutine() {
  const missing = CL_ROUTINE.filter(r => !CL_STEPS.some(s => s.id === r.id));
  if (!missing.length) { showToast('All built-in steps are already there', 'info'); return; }
  missing.forEach(r => {
    const step = Object.assign({ rv: CL_ROUTINE_VER }, JSON.parse(JSON.stringify(r)));
    // before the next built-in step of the same part that is still there
    const after = CL_ROUTINE.slice(CL_ROUTINE.indexOf(r) + 1).map(x => CL_STEPS.findIndex(s => s.id === x.id)).find(i => i >= 0);
    if (after !== undefined && CL_STEPS[after] && CL_STEPS[after].phase === r.phase) CL_STEPS.splice(after, 0, step);
    else { let at = -1; CL_STEPS.forEach((x, i) => { if (x.phase === r.phase) at = i; }); CL_STEPS.splice(at + 1, 0, step); }
  });
  clRender2(); clSaveAll();
  showToast(`Brought back ${missing.length} step${missing.length === 1 ? '' : 's'}`, 'ok');
}


// ══ The night routine, the way the desk runs it (v409) ══════════════
//  Everything before the night, in order. "After Night Run" steps stay as the hotel set them.
//  how: what to set in Opera · look: what to check · report: saved in tonight's night-run folder
//  due: "03:45" — a countdown on the step · warn: shown in red
const CL_ROUTINE_VER = 3;
const CL_ROUTINE = [
  { id:101, phase:'pre', tag:'save', name:'Zero Rate Rooms report', report:'Zero Rate Rooms',
    hint:'Every room on a zero rate must have a reason (complimentary or house use).',
    how:['Reports → Zero Rate Rooms', 'Room Class, Room Type, Room: All Codes', '☐ Include Pseudo Rooms · ☑ Exclude Zero Rate Shares', 'Preview / Download → save the PDF in tonight\'s folder'],
    look:['A zero-rate room that is not comp or house use → fix the rate or ask the manager', 'Pseudo rooms should not show'] },
  { id:102, phase:'pre', tag:'save', name:'Complimentary rooms report', report:'Guests INH Complimentary',
    hint:'Guests INH Complimentary — every comp must be approved.',
    how:['Reports → Guests INH Complimentary', 'Room Class: All Codes', 'Include: ☑ Complimentary (☐ House Use)', 'Sort order: Room Number', 'Preview / Download → save'],
    look:['Each comp room has an approval / reason in the notes'] },
  { id:103, phase:'pre', tag:'save', name:'Rate Change report — anything changed?', report:'Rate Change',
    hint:'See every rate changed today: old vs new code and amount, and who did it.',
    how:['Reports → Rate Change Report', 'Activity date: today\'s business date', 'Reservation status: CHECKED IN', 'Sort: Alphabetical (or Room Number)', 'Preview / Download → save'],
    look:['Old Rate Amount vs New Rate Amount — a lower rate needs a reason / approval', 'Rate code changed (e.g. DAILY → RA1, PKGH1) — is it right?', 'User column: who changed it — ask them if it is not clear'] },
  { id:104, phase:'pre', tag:'check', name:'In-House Rate Check — TZ rates & higher rates', report:'Guests In House Rate Check',
    hint:'Fix TZ daily rates to the normal rate, and any rate higher than today\'s rate.',
    how:['Reports → Guests In House Rate Check', 'From date: today', 'Display: ☑ Market Code ☑ Source Code ☑ Origin Code ☑ Discount Reasons', 'Sort order: Room Number', 'Preview, fix in Opera, then run it again and save'],
    look:['TZ rates (daily) → change to the normal rate', 'Any rate higher than today\'s rate → correct it', 'Discounts have a reason'] },
  { id:105, phase:'pre', tag:'scan', name:'Journal — refunds', report:'Journal — Refunds',
    hint:'If there is a refund: print it, attach the slip to the main Opera report, scan and save.',
    look:['No refund tonight → save it anyway, or skip with a note'] },
  { id:106, phase:'pre', tag:'scan', name:'Journal — paid-outs + paid-out commission', report:'Journal — Paid-outs & commission',
    hint:'From the same journal: paid-outs and paid-out commission. Attach the receipts, scan and save.' },
  { id:107, phase:'pre', tag:'scan', name:'Expedia report', report:'Expedia',
    hint:'Check if it has anything. Scan it with the Opera reports and save in the night-run folder.',
    look:['Refunds, paid-outs and Expedia: all 3 scanned together with the Opera reports'] },
  { id:108, phase:'pre', tag:'check', name:'Check manual postings',
    hint:'Every manual posting is right — this must be OK before you settle the card machine.' },
  { id:109, phase:'pre', tag:'charge', name:'Credit card reconciliation + settle the machine',
    hint:'Get the recon ready and fix any difference. Settle the machine only when manual postings are OK.',
    how:['Prepare the CC reconciliation and fix differences', 'Settle the card machine', 'Print the recon', 'Attach it with the other colleagues\' card reports and keep it aside'] },
  { id:110, phase:'pre', tag:'save', name:'Housekeeping discrepancy report (email)', report:'HK Discrepancy',
    hint:'Save the discrepancy report housekeeping sent by email.' },
  { id:111, phase:'pre', tag:'check', name:'Cancel non-guaranteed bookings',
    hint:'Today\'s arrivals with no guarantee that did not come → cancel per policy.' },
  { id:112, phase:'pre', tag:'check', name:'Immigration — nationality & missing nationality', panel:'immig',
    hint:'Every in-house guest has a nationality; fill the missing ones before the night.' },
  { id:113, phase:'pre', tag:'check', name:'Move out-of-order & out-of-service rooms to the next day',
    hint:'Extend OOO / OOS rooms so they stay blocked tomorrow.' },
  { id:114, phase:'run', tag:'charge', name:'Tourism Dirham (TD)', due:'03:45', panel:'tourism',
    hint:'At the latest, try at 3:45.' },
  { id:115, phase:'run', tag:'run', name:'Run the night audit', due:'03:50',
    hint:'Run it by 3:50 AM at the latest. Check everything while it runs.',
    warn:'Do not click Back while it runs — it cancels the whole run.',
    look:['8 reports ready in your night-run folder before you start'] },
  // ── after the night ──
  { id:201, phase:'post', tag:'save', name:'Negative Posting report', report:'Negative Posting',
    hint:'From the End of Day reports — save it to the night folder.',
    how:['Reports → End of Day reports → Negative Posting', 'Preview / Download → save'],
    look:['Every negative posting has a reason and the right person behind it'] },
  { id:202, phase:'post', tag:'save', name:'No-show report', report:'No-Show', panel:'noshow',
    hint:'From the End of Day reports — save it to the night folder.',
    how:['Reports → End of Day reports → No Show', 'Preview / Download → save', 'HotelOps → No-Shows: upload the PDF to get the list ready'] },
  { id:203, phase:'post', tag:'send', name:'Email the no-shows to Reservations', panel:'noshow',
    hint:'Send Reservations the no-show list so they can charge / follow up.',
    how:['No-Shows page → copy the list', 'New email to Reservations, attach the No-Show report', 'Send'] },
  { id:204, phase:'post', tag:'save', name:'Manager report', report:'Manager Report',
    hint:'Save it — the flash report is filled from it.' },
  { id:205, phase:'post', tag:'save', name:'Flash report', report:'Flash Report',
    hint:'Fill the flash report from the Manager report, then save / send it.' },
  { id:206, phase:'post', tag:'upload', name:'Upload everything to DocuWare',
    hint:'When all is done: upload tonight\'s reports and scans to DocuWare.',
    how:['Before-night folder: the 8 reports + the refund / paid-out / Expedia scans', 'After-night reports: Negative Posting, No-Show, Manager, Flash', 'Upload them all to DocuWare and check they are there'] },
];
/** the old built-in steps (their names): replaced by the routine; anything the hotel added itself is kept */
const CL_OLD_DEFAULTS = ['Cancel non-guaranteed bookings', 'CC recancellations', 'Cancel OTA rooms + mark card invalid', 'Check immigration / nationality report', 'Charge VCCs for tomorrow arrivals', 'Update no-show sheet (pre-run)', 'Save Inhouse Guest Complimentary report', 'Zero rate room report — remove pseudo', 'Paidout report + attach commission docs', 'Refund report + attach documents', 'Rate check — select check-in & search', 'Run the night audit', 'Manager report', 'No-show report + post charges', 'Negative posting report', 'Room recancellations (post-night)', 'Flash report'];
/** put the routine in place of the old "before" and "run" steps (once); the "after" steps are kept */
function clApplyRoutine(list) {
  if (!Array.isArray(list) || list.some(s => s && s.rv >= CL_ROUTINE_VER)) return false;
  // what the hotel added or changed itself stays (at the end of its part of the night)
  const own = list.filter(s => s && !s.rv && !CL_OLD_DEFAULTS.includes(s.name) && !CL_ROUTINE.some(r => r.id === s.id));
  list.length = 0;
  ['pre', 'run', 'post'].forEach(ph => {
    CL_ROUTINE.filter(s => s.phase === ph).forEach(s => list.push(Object.assign({ rv: CL_ROUTINE_VER }, s)));
    own.filter(s => s.phase === ph).forEach(s => list.push(s));
  });
  return true;
}
clApplyRoutine(CL_STEPS);

/** "03:45" → minutes left tonight (negative once it has passed); null when not the night */
function clDueLeft(due) {
  const m = String(due || '').match(/^(\d{1,2}):(\d{2})$/); if (!m) return null;
  const now = new Date(), t = new Date(now); t.setHours(+m[1], +m[2], 0, 0);
  if (now.getHours() >= 12) t.setDate(t.getDate() + 1);   // the evening before: tonight's 3:45
  return Math.round((t - now) / 60000);
}
function clDueChip(s, done) {
  if (!s.due || done) return '';
  const left = clDueLeft(s.due); if (left == null) return '';
  const h = +s.due.slice(0, 2), lbl = `${h % 12 || 12}:${s.due.slice(3)} ${h < 12 ? 'AM' : 'PM'}`;
  const txt = left < 0 ? `late by ${-left} min` : left < 60 ? `in ${left} min` : `in ${Math.floor(left / 60)} h ${left % 60} min`;
  const cls = left < 0 ? 'late' : left <= 15 ? 'soon' : '';
  return `<span class="cl-due ${cls}">⏰ by ${lbl} · ${txt}</span>`;
}
/** the night-run folder: which of tonight's reports are saved */
function clFolderHtml(phase) {
  const R = CL_STEPS.filter(s => s.report && s.phase === phase && !clState.skipped.has(s.id));
  if (!R.length) return '';
  const n = R.filter(s => clState.done.has(s.id)).length;
  return `<div class="cl-folder${n === R.length ? ' full' : ''}"><div class="cl-folder-hd"><span class="cl-folder-ic">📁</span>${phase === 'post' ? 'End-of-day reports' : 'Night-run folder'}<b>${n}/${R.length}</b></div>
    <div class="cl-folder-list">${R.map(s => `<span class="${clState.done.has(s.id) ? 'ok' : ''}">${clState.done.has(s.id) ? '✓' : '○'} ${escapeHtml(s.report)}</span>`).join('')}</div><div class="cl-folder-bar"><i style="width:${Math.round(n / R.length * 100)}%"></i></div></div>`;
}
/** the next step to do, big at the top */
function clNextHtml() {
  if (clEditMode) return '';
  const order = ['pre', 'run', 'post'];
  const L = order.flatMap(ph => CL_STEPS.filter(s => s.phase === ph)).filter(s => !clState.done.has(s.id) && !clState.skipped.has(s.id));
  const s = L[0]; if (!s) return '';
  const ph = { pre: 'Before the night', run: 'Night run', post: 'After the night' }[s.phase] || '';
  return `<div class="cl-next"><div class="cl-next-l"><span class="cl-next-k">Up next · ${ph}</span><b>${escapeHtml(s.name)}</b>${clDueChip(s, false)}</div><button class="cl-next-btn" onclick="clToggle2(${s.id})">Done</button></div>`;
}
// keep the countdowns fresh while the page is open
setInterval(() => {
  try {
    const p = document.getElementById('panel-checklist');
    if (!p || !p.classList.contains('active') || clEditMode) return;
    const a = document.activeElement; if (a && a.closest && a.closest('#panel-checklist') && /TEXTAREA|INPUT/.test(a.tagName)) return;
    if (CL_STEPS.some(s => s.due && !clState.done.has(s.id))) clRender2();
  } catch (_) {}
}, 30000);

// 📲 the phone (notify-hub.js): a step with a time (TD by 03:45, the night audit by 03:50) — 15 min before,
// 5 min before (louder), and late (urgent). Only while you're on shift; one device sends each, once a night.
function clNotifyTick() {
  const H = window.hoNotify;
  if (!H || typeof H.send !== 'function' || typeof CL_STEPS === 'undefined' || typeof clState === 'undefined') return;
  const now = new Date(), night = new Date(now);
  if (now.getHours() < 12) night.setDate(night.getDate() - 1);   // 03:00 belongs to the night that started the evening before
  const nid = `${night.getFullYear()}-${String(night.getMonth() + 1).padStart(2, '0')}-${String(night.getDate()).padStart(2, '0')}`;
  CL_STEPS.forEach(s => {
    try {
      if (!s || !s.due || clState.done.has(s.id) || clState.skipped.has(s.id)) return;
      const left = clDueLeft(s.due); if (left == null || left > 15 || left < -60) return;
      const h = +s.due.slice(0, 2), lbl = `${h % 12 || 12}:${s.due.slice(3)} ${h < 12 ? 'AM' : 'PM'}`, k = `cl_${nid}_${s.id}`;
      const base = { cat: 'checklist', state: true, url: 'checklist' };
      if (left < 0) H.send(Object.assign(base, { prio: 5, key: k + '_late', title: `🚨 Late: ${s.name}`, body: `It was due by ${lbl} — ${-left} min ago, not ticked yet.${s.warn ? ' ' + s.warn : ''}` }));
      else if (left <= 5) H.send(Object.assign(base, { prio: 4, instant: true, key: k + '_5', title: `⏰ In ${left} min: ${s.name}`, body: `Due by ${lbl}.${s.hint ? ' ' + s.hint : ''}` }));
      else H.send(Object.assign(base, { prio: 3, key: k + '_15', title: `🌙 In ${left} min: ${s.name}`, body: `Due by ${lbl}.${s.hint ? ' ' + s.hint : ''}` }));
    } catch (_) {}
  });
}
setInterval(() => { try { clNotifyTick(); } catch (_) {} }, 60000);

// ── 📡 Opera: the night audit read as done in Opera SUGGESTS ticking its step ──
// (opera-bridge.js keeps the read: hoOpera.last('audit') → {at, audit:{state}}).
// Like shifts.js "🤖 Looks done … ✓ Tick it ✕": nothing is ever ticked by itself —
// only a tap on "✓ Tick it" (clToggle2) ticks. ✕ hides it for the rest of the night.
const CL_OP_RX = /night\s*audit|end\s*of\s*(?:the\s*)?day|\beod\b/i;
const CL_OP_NO = 'cl_opera_no_v1';   // {night, ids}
/** when tonight began: 12:00 today (afternoon / evening) or 12:00 yesterday (after midnight) */
function clNightStart(now) {
  const d = new Date(now || Date.now());
  if (d.getHours() < 12) d.setDate(d.getDate() - 1);
  d.setHours(12, 0, 0, 0);
  return d.getTime();
}
/** which steps the audit read suggests: {steps, done:Set, skipped:Set, audit:{state, at}, since, no:[ids]} → {id: why} */
function clOperaSugg(o) {
  const out = {}, a = o && o.audit;
  if (!a || a.state !== 'done' || !a.at || a.at < (o.since || 0)) return out;
  const t = new Date(a.at), hm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  (o.steps || []).forEach(s => {
    if (!s || !CL_OP_RX.test(s.name || '') || (o.done && o.done.has(s.id)) || (o.skipped && o.skipped.has(s.id)) || (o.no || []).includes(s.id)) return;
    out[s.id] = `Night audit done in Opera ✓ (read at ${hm})`;
  });
  return out;
}
function _clOpNo() { try { const v = JSON.parse(localStorage.getItem(CL_OP_NO) || 'null'); return v && v.night === clNightStart() && Array.isArray(v.ids) ? v.ids : []; } catch (_) { return []; } }
let _clOpSugg = {};
/** the night audit's state from Opera (read since tonight began) → the suggestions; redraws only when they change */
function clOperaTick() {
  const was = JSON.stringify(_clOpSugg);
  _clOpSugg = {};
  if (typeof hoOpera !== 'undefined' && hoOpera && typeof hoOpera.last === 'function' && typeof CL_STEPS !== 'undefined' && typeof clState !== 'undefined') {
    let L = null; try { L = hoOpera.last('audit'); } catch (_) {}
    if (L && L.audit) _clOpSugg = clOperaSugg({ steps: CL_STEPS, done: clState.done, skipped: clState.skipped, audit: { state: L.audit.state, at: L.at }, since: clNightStart(), no: _clOpNo() });
  }
  if (JSON.stringify(_clOpSugg) === was) return;
  try {
    const p = document.getElementById('panel-checklist');
    const a = document.activeElement;
    if (p && p.classList.contains('active') && !clEditMode && !(a && a.closest && a.closest('#panel-checklist') && /TEXTAREA|INPUT/.test(a.tagName))) clRender2();
  } catch (_) {}
}
/** ✕ on the suggestion: not suggested again tonight */
function clOperaNo(id) {
  const ids = _clOpNo(); if (!ids.includes(id)) ids.push(id);
  try { localStorage.setItem(CL_OP_NO, JSON.stringify({ night: clNightStart(), ids })); } catch (_) {}
  delete _clOpSugg[id]; clRender2();
}
function _clOpHtml(s, done, skip) {
  const why = !done && !skip && !clEditMode ? _clOpSugg[s.id] : '';
  return why ? `<div class="st-auto cl-op" onclick="event.stopPropagation()">📡 ${escapeHtml(why)} — tick it? <button type="button" class="st-auto-yes" onclick="clToggle2(${s.id})">✓ Tick it</button><button type="button" class="st-auto-no" onclick="clOperaNo(${s.id})" title="Not done — don't suggest it again tonight" aria-label="Not done">✕</button></div>` : '';
}
setInterval(() => { try { clOperaTick(); } catch (_) {} }, 20000);
document.addEventListener('DOMContentLoaded', () => setTimeout(() => { try { clOperaTick(); } catch (_) {} }, 6000));

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
    const nm = e.stepName ? `<strong>${escapeHtml(e.stepName)}</strong>` : '<strong>—</strong>';
    const ex = e.extra    ? `<span style="color:var(--text3);"> · ${escapeHtml(e.extra)}</span>` : '';
    return `<div class="cl-log-entry">
      <div class="cl-log-dot ${l.dot}"></div>
      <div class="cl-log-text">${escapeHtml(l.text)} ${nm}${ex}</div>
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
  const files = Array.from(evt.target.files).filter(f => (f.type || '').startsWith('image/'));   // a PDF picked too would stop the photos from saving
  if (!files.length) return;
  if (!clPhotos[stepId]) clPhotos[stepId] = [];
  let loaded = 0;
  files.forEach(file => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = e => {
      _compressImage(e.target.result, 1200, 0.82, compressed => {
        if (compressed) clPhotos[stepId].push({ data: compressed, name: file.name, ts: new Date().toISOString() });
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
  // a photo the browser can't open (e.g. HEIC on a computer) used to stop the whole batch saving
  img.onerror = () => { if (typeof showToast === 'function') showToast('One photo could not be opened (try JPG or PNG)', 'warn'); cb(null); };
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
      <img src="${escapeHtml(p.data)}" alt="${escapeHtml(p.name)}" onclick="clOpenLightbox(${stepId},${i})" title="Click to expand"/>
      <button class="cl-photo-del" onclick="clDeletePhoto(${stepId},${i})" title="Remove photo">✕</button>
      <div class="cl-photo-name">${escapeHtml(p.name.length > 18 ? p.name.slice(0,16)+'...' : p.name)}</div>
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
    cap.innerHTML = `<strong>${escapeHtml(step ? step.name : 'Step')}</strong><br>${(current+1)} / ${photos.length} · ${escapeHtml(photos[current].name)}${ts}`;
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
  const tagColors = { check:'var(--mint)', save:'var(--gold)', scan:'var(--sky)', charge:'var(--amber)', run:'var(--rose)', send:'#8b7cf8', upload:'#5ab4e8' };
  let html = '';
  phases.forEach(ph => {
    const steps = CL_STEPS.filter(s => s.phase === ph.key);
    if (!steps.length) return;
    if (ph.key === 'pre') html += clNextHtml();
    const live = steps.filter(x => !clState.skipped.has(x.id)), nd = live.filter(x => clState.done.has(x.id)).length;
    html += `<div class="cl-phase-hd">
      <div class="cl-phase-line"></div>
      <div class="cl-phase-lbl">${ph.label}</div>
      <div class="cl-phase-n${nd === live.length ? ' all' : ''}">${nd} of ${live.length}</div>
      <div class="cl-phase-line"></div>
    </div>`;
    if (!clEditMode) html += clFolderHtml(ph.key);
    html += '<div class="cl-group">';
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
          ${photos.map((p,idx) => `<img src="${escapeHtml(p.data)}" class="cl-strip-thumb" onclick="clOpenLightbox(${s.id},${idx})" title="${escapeHtml(p.name)}"/>`).join('')}
          <span class="cl-photo-count">📷 ${photos.length} photo${photos.length>1?'s':''}</span>
        </div>` : '';

      const tsHtml = done && ts ? `<div class="cl-done-ts">✓ done at ${new Date(ts).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</div>` : '';

      const noteArea = !clEditMode ? `
        <div class="cl-note-wrap" onclick="event.stopPropagation()">
          <textarea class="cl-note-input" id="cl-note-${s.id}" rows="1" placeholder="Add a note…"
            onblur="clSaveNote(${s.id})"
          >${escapeHtml(note)}</textarea>
        </div>` : '';

      html += `<div class="cl-step${done?' done':''}${skip?' skipped':''}"
                    draggable="${clEditMode}"
                    data-cl-id="${s.id}"
                    data-cl-phase="${s.phase}">
        <div class="cl-step-main" onclick="${clEditMode ? '' : `clToggle2(${s.id})`}">
          ${clEditMode ? `<div class="st-drag-handle" title="Drag to reorder">⠿</div>` : ''}
          <div class="cl-check">✓</div>
          <div class="cl-content">
            <div class="cl-num">STEP ${CL_STEPS.indexOf(s) + 1} ·
              <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${tagColors[s.tag]||'var(--text3)'};margin-right:3px;vertical-align:middle;"></span>
              <span style="font-size:0.54rem;color:${tagColors[s.tag]||'var(--text3)'};">${s.tag.toUpperCase()}</span>
              ${photos.length > 0 ? `<span class="cl-has-photo" title="${photos.length} photo(s) attached" style="margin-left:4px;">📷</span>` : ''}
            </div>
            <div class="cl-name">${escapeHtml(s.name)}</div>
            ${s.hint ? `<div class="cl-hint">${escapeHtml(s.hint)}</div>` : ''}
            ${s.warn ? `<div class="cl-warn">⚠ ${escapeHtml(s.warn)}</div>` : ''}
            ${(s.due && !done) || s.report ? `<div class="cl-chips">${clDueChip(s, done)}${s.report ? `<span class="cl-rep${done ? ' ok' : ''}">📁 ${escapeHtml(s.report)}</span>` : ''}</div>` : ''}
            ${!clEditMode && ((s.how && s.how.length) || (s.look && s.look.length)) ? `<details class="cl-how" onclick="event.stopPropagation()"><summary>${s.how && s.how.length ? 'How in Opera' : 'What to check'}</summary>${s.how && s.how.length ? `<ol>${s.how.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ol>` : ''}${s.look && s.look.length ? `<div class="cl-look"><b>Check</b><ul>${s.look.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul></div>` : ''}</details>` : ''}
            ${_clOpHtml(s, done, skip)}
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
              : `${s.panel ? `<button class="cl-step-btn open-btn" onclick="showPanel('${s.panel}')" title="Open the ${s.panel} page">Open ↗</button>` : ''}<button class="cl-step-btn photo-btn" onclick="document.getElementById('cl-upload-${s.id}').click()" title="Attach a photo — a note for yourself" aria-label="Attach a photo">📷</button><input type="file" id="cl-upload-${s.id}" accept="image/*" multiple style="display:none" onchange="clHandlePhotoUpload(event,${s.id})"/><button class="cl-step-btn" onclick="openEditStep(${s.id})" title="Edit this step" aria-label="Edit this step">✏️</button><button class="cl-step-btn"          onclick="clSkip2(${s.id})">${skip ? '↩ Show' : 'Skip'}</button>`}
          </div>
        </div>
      </div>`;
    });
    html += '</div>';
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
  const prevDone    = new Set(clState.done);
  const prevSkipped = new Set(clState.skipped);
  const prevDoneTimes = { ...clDoneTimes };
  const prevNotes      = { ...clNotes };

  clState.done.clear();
  clState.skipped.clear();
  clDoneTimes = {};
  clNotes = {};
  // Keep photos (they are step-level reference, not per-night)
  clRender2();
  clSaveAll();

  if (typeof showUndoToast === 'function') {
    showUndoToast('Checklist reset for new night', () => {
      clState.done    = prevDone;
      clState.skipped = prevSkipped;
      clDoneTimes = prevDoneTimes;
      clNotes     = prevNotes;
      clRender2();
      clSaveAll();
    }, 8000);
  } else {
    showToast('Checklist reset for new night ✓');
  }
}
