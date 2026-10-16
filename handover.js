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
    const _c = Object.keys(SHIFTS).map(k => typeof stCount === 'function' ? stCount(k) : { done: SHIFTS[k].done.length, total: SHIFTS[k].tasks.length });
    const totalTasks = _c.reduce((s, x) => s + x.total, 0);
    const doneTasks  = _c.reduce((s, x) => s + x.done, 0);
    if (totalTasks) lines.push(`🕐 Shift Tasks — ${doneTasks}/${totalTasks} done across all shifts`);
  }
  if (typeof nsGuests !== 'undefined' && nsGuests.length) {
    const unresolved = nsGuests.filter(g => !g.newConf).length;
    lines.push(`🚫 No-Show — ${nsGuests.length} on list${unresolved ? ` · ${unresolved} still unresolved` : ''}`);
  }
  if (typeof dtcSnapshotLine === 'function') {
    const dl = dtcSnapshotLine();
    if (dl) lines.push(dl);
  }
  if (typeof ttGuests !== 'undefined' && ttGuests.length) {
    lines.push(`🏛️ Tourism Tax — ${ttGuests.length} room(s) still need TD portal date correction`);
  }
  return lines;
}

/** What the next shift has to do: rooms, times and tasks by name, not only counts. */
function _hoTodo() {
  const L = [], add = (icon, head, items) => { if (items && items.length) L.push({ icon, head, items }); };
  const now = Date.now(), hm = t => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  try {
    if (typeof depRooms !== 'undefined' && depRooms.length) {
      add('🕐', 'Late check-outs', depRooms.filter(r => r.status === 'late').map(r => `Room ${r.roomStr}${r.lateTime ? ' until ' + r.lateTime : ''}${r.name ? ' · ' + r.name : ''}`));
      add('🚪', 'Still due to check out', depRooms.filter(r => r.status === 'due').map(r => `Room ${r.roomStr}${r.name ? ' · ' + r.name : ''}${r.balance ? ' · balance' : ''}`));
      add('📞', 'No answer yet', depRooms.filter(r => r.status === 'na').map(r => `Room ${r.roomStr}${r.naTime ? ' (tried ' + r.naTime + ')' : ''}`));
    }
  } catch (_) {}
  try {
    if (typeof bxWakes !== 'undefined') {
      const w = Object.values(bxWakes).filter(x => x && !x.done && x.at < now + 14 * 3600e3).sort((a, b) => a.at - b.at);
      add('⏰', 'Wake-up calls', w.map(x => `Room ${x.room} at ${x.time}${x.at < now ? ' — MISSED, call now' : ''}${x.name ? ' · ' + x.name : ''}`));
    }
  } catch (_) {}
  try {
    if (typeof SHIFTS !== 'undefined' && typeof hoShiftNow === 'function') {
      const k = hoShiftNow().key, sh = SHIFTS[k], day = typeof stDayOf === 'function' ? stDayOf(k) : '';
      const open = (sh.tasks || []).filter(t => (typeof stTaskState !== 'function' || stTaskState(t, day, k) === 'on') && !(typeof stIsDone === 'function' ? stIsDone(k, t) : sh.done.includes(t.id)));
      add('✅', `${sh.label}: tasks not done`, open.map(t => (t.at ? t.at + ' · ' : '') + t.name));
    }
  } catch (_) {}
  try {
    if (typeof CL_STEPS !== 'undefined' && typeof hoShiftNow === 'function' && hoShiftNow().key === 'night') {
      const left = CL_STEPS.filter(x => !clState.done.has(x.id) && !clState.skipped.has(x.id));
      if (left.length && clState.done.size) add('🌙', 'Night checklist still open', left.slice(0, 8).map(x => x.name).concat(left.length > 8 ? [`…and ${left.length - 8} more`] : []));
    }
  } catch (_) {}
  try {
    if (typeof dtcRecon !== 'undefined' && dtcRecon && typeof dtcDone !== 'undefined') {
      const n = typeof dtcOpenCount === 'function' ? dtcOpenCount() : (dtcRecon.actions || []).length - dtcDone.size;
      if (n > 0) add('🏛️', 'DTCM', [`${n} correction${n > 1 ? 's' : ''} still to do (DTCM Recon)`]);
    }
  } catch (_) {}
  try {
    if (typeof pkgResults !== 'undefined' && pkgResults.length && typeof pkgNightDone === 'function') {
      const n = pkgResults.filter(x => !x.pinSkip && (x.verdict === 'deny' || x.verdict === 'review' || (x.verdict === 'credit' && !x.alreadyComplete)) && !pkgNightDone(x)).length;
      if (n) add('📦', 'Package Audit', [`${n} line${n > 1 ? 's' : ''} still to fix in IN-Gauge`]);
    }
  } catch (_) {}
  try {
    if (typeof nsGuests !== 'undefined' && nsGuests.length) {
      const n = nsGuests.filter(g => !g.newConf).length;
      if (n) add('🚫', 'No-shows', [`${n} still without a new confirmation number`]);
    }
  } catch (_) {}
  try {
    if (typeof mrOpen === 'function' && typeof mrPeriod === 'function') {
      const p = mrPeriod(), o = mrOpen();
      if (o.length && (p.late || p.left < 4)) add('📆', `Monthly reports ${p.late ? 'late' : 'due by the ' + p.by + 'th'}`, o.map(r => r.name));
    }
  } catch (_) {}
  try {
    if (typeof bxNotesList === 'function') add('📝', 'Notes from the shift', bxNotesList().slice(0, 8).map(n => `${n.text} (${n.by}, ${n.time})`));
  } catch (_) {}
  return L;
}
function hoWhatsApp() {
  const t = _hoBuildText();
  if (navigator.share && /Mobi|Android|iPhone/i.test(navigator.userAgent)) { navigator.share({ text: t }).catch(() => {}); return; }
  window.open('https://wa.me/?text=' + encodeURIComponent(t), '_blank', 'noopener');
}

async function hoGenerate() {
  const body = document.getElementById('hoBody');
  if (!body) return;
  const typed = document.getElementById('hoNotes')?.value || hoGenerate._notes || '';   // notes typed before Refresh or a new range stay
  hoGenerate._notes = typed;
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
          <span class="ho-log-text"><strong>${escapeHtml(e.name || '—')}</strong> — ${escapeHtml((e.action || '').replace(/_/g,' '))}${e.detail ? `: ${escapeHtml(e.detail)}` : ''}</span>
          <span class="ho-log-time">${new Date(e.ts).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</span>
        </div>`).join('')
    : `<div class="gs-empty">No logged activity in this window</div>`;

  const todo = _hoTodo();
  body.innerHTML = `
    <div class="ho-section ho-todo">
      <div class="ho-section-title">➡️ For the next shift</div>
      ${todo.length ? todo.map(g => `<div class="ho-todo-g"><b>${g.icon} ${escapeHtml(g.head)}</b><ul>${g.items.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul></div>`).join('') : '<div class="gs-empty">🎉 Nothing open: a clean handover.</div>'}
    </div>
    <div class="ho-section">
      <div class="ho-section-title">📋 Current Status</div>
      ${snapshotLines.length ? snapshotLines.map(l => `<div class="ho-snap-row">${l}</div>`).join('') : '<div class="gs-empty">No data loaded yet</div>'}
    </div>
    <div class="ho-section">
      <div class="ho-section-title">📝 Handover Notes</div>
      <textarea id="hoNotes" class="ho-notes" oninput="hoGenerate._notes=this.value" placeholder="Anything the next shift needs to know — pending issues, guest requests, VIPs, follow-ups…">${escapeHtml(typed)}</textarea>
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
    `FOR THE NEXT SHIFT`,
    ...(() => { const T = _hoTodo(); return T.length ? T.flatMap(g => [`  ${g.icon} ${g.head}:`, ...g.items.map(i => `     • ${i}`)]) : ['  Nothing open.']; })(),
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

// ── A nudge 30 minutes before your shift ends: the handover is ready ──
(window.BL_THINKERS = window.BL_THINKERS || []).push(add => {
  try {
    if (typeof hoShiftNow !== 'function' || typeof hoMyDuty !== 'function') return;
    const d = hoMyDuty(); if (d.state !== 'on' || !d.code || typeof rbParse !== 'function') return;
    const p = rbParse(d.code); if (!p) return;
    const end = roDate(d.date).getTime() + p.e * 60e3, left = end - Date.now();
    if (left > 0 && left <= 30 * 60e3) add({ id: 'handover:' + d.date + ':' + d.code, type: 'handover', icon: '📋', tone: 'idle',
      text: `Your shift ends at ${p.to}: the handover is ready`, why: 'Late rooms, wake-up calls, tasks not done and notes, written for the next shift. Copy it or send it on WhatsApp.',
      acts: [['Open the handover', () => hoOpen()]] });
  } catch (_) {}
});
