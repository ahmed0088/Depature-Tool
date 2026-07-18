// ═══════════════════════════════════════════════════════════
//  handover.js  —  Shift Handover Digest
//  Pulls the shared activityLog (already written by every module
//  via logActivity) plus a live snapshot of every panel's state,
//  and produces one copy/print-ready handover note.
// ═══════════════════════════════════════════════════════════

const HO_ICONS = {
  shift_task_done:'✅', shift_task_undone:'↩', shift_task_added:'➕', shift_task_deleted:'🗑️', shift_reset:'↺',
  checklist_done:'✅', checklist_undone:'↩', checklist_skipped:'⏭', checklist_unskipped:'↩',
  departure_out:'🚪', departure_na:'—', departure_late:'🕐', departure_extended:'📅', departure_due:'↩',
  arrivals_loaded:'📥', arrivals_cleared:'🗑️', login:'🔓', logout:'🔒',
};

function hoOpen() {
  const modal = document.getElementById('hoModal');
  if (!modal) return;
  modal.classList.add('open');
  const sel = document.getElementById('hoRange');
  if (sel && !sel.value) sel.value = '8';
  hoGenerate();
}

function hoClose() {
  document.getElementById('hoModal')?.classList.remove('open');
}

function _hoSinceISO() {
  const sel = document.getElementById('hoRange');
  const hours = sel ? parseInt(sel.value, 10) || 8 : 8;
  const since = new Date(Date.now() - hours * 3600 * 1000);
  return since.toISOString();
}

// ── Live snapshot of every panel, independent of the activity log ──
function _hoSnapshot() {
  const lines = [];

  if (typeof depRooms !== 'undefined' && depRooms.length) {
    const due   = depRooms.filter(r => r.status === 'due').length;
    const late  = depRooms.filter(r => r.status === 'late').length;
    const na    = depRooms.filter(r => r.status === 'na').length;
    const out   = depRooms.filter(r => r.status === 'out').length;
    const ext   = depRooms.filter(r => r.status === 'extended').length;
    lines.push(`🚪 Departures — ${depRooms.length} total · ${due} due · ${late} late · ${na} no-answer · ${ext} extended · ${out} checked out`);
  }
  if (typeof arrGuests !== 'undefined' && arrGuests.length) {
    lines.push(`🛎️ Arrivals — ${arrGuests.length} guests loaded`);
  }
  if (typeof purposeGuests !== 'undefined' && purposeGuests.length) {
    const missingNat = purposeGuests.filter(g => !g.nat).length;
    lines.push(`🧾 Purpose of Stay — ${purposeGuests.length} guests${missingNat ? ` · ${missingNat} missing nationality` : ''}`);
  }
  if (typeof CL_STEPS !== 'undefined' && CL_STEPS.length) {
    const done = clState.done.size, skipped = clState.skipped.size, total = CL_STEPS.length;
    lines.push(`✅ Night Checklist — ${done}/${total} done${skipped ? `, ${skipped} skipped` : ''}`);
  }
  if (typeof SHIFTS !== 'undefined') {
    const totalTasks = Object.values(SHIFTS).reduce((s, sh) => s + sh.tasks.length, 0);
    const doneTasks  = Object.values(SHIFTS).reduce((s, sh) => s + sh.done.length,  0);
    if (totalTasks) lines.push(`🕐 Shift Tasks — ${doneTasks}/${totalTasks} done across all shifts`);
  }
  if (typeof nsGuests !== 'undefined' && nsGuests.length) {
    const unresolved = nsGuests.filter(g => !g.newConf).length;
    lines.push(`🚫 No-Show — ${nsGuests.length} on list${unresolved ? ` · ${unresolved} still unresolved` : ''}`);
  }
  if (typeof ttGuests !== 'undefined' && ttGuests.length) {
    lines.push(`🏛️ Tourism Tax — ${ttGuests.length} room(s) still need TD portal date correction`);
  }
  return lines;
}

async function hoGenerate() {
  const body = document.getElementById('hoBody');
  if (!body) return;
  body.innerHTML = `<div class="gs-empty">Loading activity…</div>`;

  const since = _hoSinceISO();
  let entries = [];
  try {
    const snap = await firebase.database()
      .ref(`hotels/${HOTEL_ID}/activityLog`)
      .orderByChild('ts')
      .startAt(since)
      .once('value');
    entries = Object.values(snap.val() || {}).sort((a, b) => (a.ts < b.ts ? 1 : -1));
  } catch (e) {
    console.warn('[Handover] activity log fetch failed:', e);
  }

  const snapshotLines = _hoSnapshot();
  const rangeLabel = document.getElementById('hoRange')?.selectedOptions?.[0]?.textContent || '';
  const generatedBy = (typeof currentProfile !== 'undefined' && currentProfile?.name) || 'Front Desk';
  const now = new Date().toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });

  const activityHtml = entries.length
    ? entries.map(e => `
        <div class="ho-log-row">
          <span class="ho-log-icon">${HO_ICONS[e.action] || '•'}</span>
          <span class="ho-log-text"><strong>${e.name || '—'}</strong> — ${(e.action || '').replace(/_/g,' ')}${e.detail ? `: ${e.detail}` : ''}</span>
          <span class="ho-log-time">${new Date(e.ts).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</span>
        </div>`).join('')
    : `<div class="gs-empty">No logged activity in this window</div>`;

  body.innerHTML = `
    <div class="ho-section">
      <div class="ho-section-title">📋 Current Status</div>
      ${snapshotLines.length ? snapshotLines.map(l => `<div class="ho-snap-row">${l}</div>`).join('') : '<div class="gs-empty">No data loaded yet</div>'}
    </div>
    <div class="ho-section">
      <div class="ho-section-title">📝 Handover Notes</div>
      <textarea id="hoNotes" class="ho-notes" placeholder="Anything the next shift needs to know — pending issues, guest requests, VIPs, follow-ups…"></textarea>
    </div>
    <div class="ho-section">
      <div class="ho-section-title">🕓 Activity — ${rangeLabel}</div>
      <div class="ho-log-list">${activityHtml}</div>
    </div>
    <div class="ho-meta">Generated by ${generatedBy} · ${now}</div>`;
}

function _hoBuildText() {
  const notes = document.getElementById('hoNotes')?.value.trim();
  const snapshotLines = _hoSnapshot();
  const logRows = Array.from(document.querySelectorAll('#hoBody .ho-log-row')).map(r => r.textContent.trim());
  const rangeLabel = document.getElementById('hoRange')?.selectedOptions?.[0]?.textContent || '';
  const generatedBy = (typeof currentProfile !== 'undefined' && currentProfile?.name) || 'Front Desk';
  const hotelName = document.getElementById('hotelName')?.textContent || 'Hotel';
  const now = new Date().toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });

  const lines = [
    `SHIFT HANDOVER — ${hotelName}`,
    `Generated by ${generatedBy} · ${now}`,
    `${'─'.repeat(50)}`,
    ``,
    `CURRENT STATUS`,
    ...snapshotLines.map(l => '  ' + l.replace(/^[^\s]+\s/, '')),
    ``,
  ];
  if (notes) lines.push(`HANDOVER NOTES`, `  ${notes}`, ``);
  lines.push(
    `ACTIVITY (${rangeLabel})`,
    ...(logRows.length ? logRows.map(l => '  ' + l) : ['  No logged activity in this window']),
  );
  return lines.join('\n');
}

function hoCopy() {
  copyToClipboard(_hoBuildText(), null, '');
  showToast('Handover copied ✓', 'ok');
  if (typeof logActivity === 'function') logActivity('handover_generated', document.getElementById('hoRange')?.selectedOptions?.[0]?.textContent || '');
}

function hoPrint() {
  const text = _hoBuildText();
  const win = window.open('', '_blank');
  win.document.write(`<pre style="font-family:monospace;font-size:13px;white-space:pre-wrap;padding:24px;">${text.replace(/</g,'&lt;')}</pre>`);
  win.document.close();
  win.print();
}
