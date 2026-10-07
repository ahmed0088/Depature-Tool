// ═══════════════════════════════════════════════════════════
//  wakeup.js — Wake-up Calls
//  One list for the whole team, the way a front desk runs them:
//    • set: room, time, day, guest (filled in from today's reports), note,
//      a backup call a few minutes later, every day until a date, and
//      "read back to the guest" ticked when it was confirmed;
//      several at once ("512 6:30, 610 7:15 tomorrow");
//    • at the time: everyone on shift is alerted, again every 5 minutes
//      until the call is marked;
//    • the call: ✓ Answered (the backup call is booked by itself),
//      📵 No answer (tries again in 5 minutes; after two, send someone up),
//      🚶 Sent someone up, or Cancelled by the guest;
//    • a summary on top, the next call with a countdown, warnings for a
//      room that is already checked out or a call set twice, and a log of
//      who did what. Copy or print the list for the night.
//  Firebase: brain/wakeups/{id} = { room, time, at, by, name, note, done,
//            result, doneBy, doneAt, tries, alerts, lastAlert, backup,
//            confirmed, backupOf }
//  (the same list Ops Brain's "wake up 512 at 6:30" uses)
// ═══════════════════════════════════════════════════════════

const _wkMe = () => (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || 'Someone';
const _wkHM = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const _wkDay = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const _wkISO = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const WK_RESULT = { ok: ['✓ Answered', 'mint'], sent: ['🚶 Someone went up', 'sky'], cancel: ['Cancelled by guest', 'muted'] };
let _wkFilter = '';

function _wkAll() { return typeof bxWakes !== 'undefined' ? Object.entries(bxWakes || {}).filter(([, w]) => w && w.at).map(([id, w]) => Object.assign({ id }, w)) : []; }
function _wkSave(id, w) { bxWakes[id] = w; if (typeof fbSet === 'function') fbSet('brain/wakeups/' + id, w); }
function _wkPatch(id, patch) {
  const w = bxWakes[id]; if (!w) return;
  Object.assign(w, patch);
  if (typeof fbUpdate === 'function') fbUpdate('brain/wakeups/' + id, patch); else fbSet('brain/wakeups/' + id, w);
  wkRender();
}
function _wkLog(what, detail) { if (typeof logActivity === 'function') try { logActivity(what, detail); } catch (_) {} }
/** The guest in a room today, from the reports that are loaded. */
function _wkGuest(room) {
  room = String(room || '').trim(); if (!room) return '';
  const pick = (l, f) => { try { const g = (l || []).find(x => x && String(f(x)).trim() === room); return g ? g.name : ''; } catch (_) { return ''; } };
  return pick(typeof depRooms !== 'undefined' ? depRooms : [], x => x.roomStr || x.room) || pick(typeof arrGuests !== 'undefined' ? arrGuests : [], x => x.room) || pick(typeof purposeGuests !== 'undefined' ? purposeGuests : [], x => x.room) || '';
}
/** A room already checked out on today's departure board. */
function _wkCheckedOut(room) { try { return (depRooms || []).some(r => String(r.roomStr || r.room).trim() === String(room).trim() && r.status === 'out'); } catch (_) { return false; } }
/** "6:30", "0630", "6.30am", "18:45" → hours and minutes. */
function _wkTime(s) {
  const m = String(s || '').trim().toLowerCase().match(/^(\d{1,2})(?:[:.h]?(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = +m[1], mi = +(m[2] || 0);
  if (m[3] === 'pm' && h < 12) h += 12; if (m[3] === 'am' && h === 12) h = 0;
  return h <= 23 && mi <= 59 ? [h, mi] : null;
}
/** When a call at h:mi on this day happens; no day means the next time it comes round. */
function _wkWhen(h, mi, day) {
  const d = day ? new Date(day + 'T00:00:00') : new Date();
  d.setHours(h, mi, 0, 0);
  if (!day && d.getTime() < Date.now() - 60e3) d.setDate(d.getDate() + 1);
  return d;
}
function wkAdd(room, h, mi, opt) {
  opt = opt || {};
  room = String(room || '').trim();
  if (!/^\d{1,5}[A-Za-z]?$/.test(room)) { showToast('Write the room number', 'warn'); return 0; }
  const first = _wkWhen(h, mi, opt.day);
  if (first.getTime() < Date.now() - 60e3) { showToast('That time has already passed', 'warn'); return 0; }
  // the same room within 15 minutes of a call already set: most likely set twice
  const twin = _wkAll().find(w => !w.done && w.room === room && Math.abs(w.at - first.getTime()) < 15 * 60e3);
  if (twin && !opt.quiet && !confirm(`Room ${room} already has a wake-up call at ${twin.time}. Set another one at ${_wkHM(first)}?`)) return 0;
  const last = opt.until ? new Date(opt.until + 'T23:59:59').getTime() : first.getTime();
  let n = 0;
  for (let t = new Date(first); t.getTime() <= last && n < 21; t.setDate(t.getDate() + 1)) {
    const id = 'w' + Date.now().toString(36) + n + Math.random().toString(36).slice(2, 5);
    _wkSave(id, { room, time: _wkHM(t), at: t.getTime(), by: _wkMe(), setAt: Date.now(), name: opt.name || _wkGuest(room) || '', note: opt.note || '', done: false, tries: 0, alerts: 0, backup: +opt.backup || 0, confirmed: !!opt.confirmed });
    n++;
  }
  _wkLog('wakeup_set', `Room ${room} at ${_wkHM(first)}${n > 1 ? ` · ${n} days` : ''}`);
  return n;
}

// ── Actions ───────────────────────────────────────────────
function wkAddFromForm() {
  const g = id => document.getElementById(id);
  const t = _wkTime(g('wkTime').value);
  if (!t) { showToast('Pick the time', 'warn'); return; }
  const room = g('wkRoom').value.trim();
  const day = g('wkDay').value === 'next' ? '' : g('wkDay').value === 'tomorrow' ? _wkISO(Date.now() + 864e5) : g('wkDay').value === 'today' ? _wkISO(Date.now()) : g('wkDate').value;
  const n = wkAdd(room, t[0], t[1], { day, name: g('wkName').value.trim(), note: g('wkNote').value.trim(), until: g('wkRepeat').checked ? g('wkUntil').value : '', backup: g('wkBackup').value, confirmed: g('wkConfirm').checked });
  if (!n) return;
  showToast(`⏰ Room ${room} at ${String(t[0]).padStart(2, '0')}:${String(t[1]).padStart(2, '0')}${n > 1 ? ` · ${n} days` : ''}${g('wkConfirm').checked ? '' : ' — read it back to the guest'}`, 'ok');
  ['wkRoom', 'wkName', 'wkNote'].forEach(id => { g(id).value = ''; delete g(id).dataset.typed; });
  g('wkRepeat').checked = false; g('wkUntil').disabled = true; g('wkConfirm').checked = false;
  wkRender(); g('wkRoom').focus();
}
/** "512 6:30, 610 7:15 tomorrow; 702 0545 call twice" → one call each. */
function wkAddMany() {
  const txt = document.getElementById('wkMany').value;
  let ok = 0; const bad = [];
  txt.split(/[\n,;]+/).map(x => x.trim()).filter(Boolean).forEach(line => {
    const m = line.match(/^(?:room\s*)?(\d{1,5}[A-Za-z]?)\s*(?:at|@|-|–)?\s*(\d{1,2}(?:[:.h]?\d{2})?\s*(?:am|pm)?)\s*(tomorrow|tmrw|tmr)?\s*(.*)$/i);
    const t = m && _wkTime(m[2]);
    if (!t) { bad.push(line); return; }
    ok += wkAdd(m[1], t[0], t[1], { day: m[3] ? _wkISO(Date.now() + 864e5) : '', note: m[4] || '', quiet: true }) ? 1 : 0;
  });
  if (ok) { document.getElementById('wkMany').value = bad.join('\n'); showToast(`⏰ ${ok} wake-up call${ok === 1 ? '' : 's'} set`, 'ok'); }
  if (bad.length) showToast(`Couldn't read: ${bad.join(' · ')} — write it as "512 6:30"`, 'warn');
  wkRender();
}
function wkAnswered(id) {
  const w = bxWakes[id]; if (!w) return;
  _wkPatch(id, { done: true, result: 'ok', doneBy: _wkMe(), doneAt: Date.now() });
  // the backup call the guest asked for: booked by itself
  if (w.backup && !w.backupOf) {
    const at = Date.now() + w.backup * 60e3, nid = 'w' + Date.now().toString(36) + 'b';
    _wkSave(nid, { room: w.room, time: _wkHM(new Date(at)), at, by: _wkMe(), setAt: Date.now(), name: w.name || '', note: 'backup call', done: false, tries: 0, alerts: 0, backup: 0, confirmed: true, backupOf: id });
    showToast(`Backup call for room ${w.room} set at ${_wkHM(new Date(at))}`, 'ok');
  }
  _wkLog('wakeup_done', `Room ${w.room} answered`);
  wkRender();
}
function wkNoAnswer(id) {
  const w = bxWakes[id]; if (!w) return;
  const tries = (w.tries || 0) + 1, at = Date.now() + 5 * 60e3;
  _wkPatch(id, { tries, at, time: _wkHM(new Date(at)), alerts: 0, lastAlert: 0, lastTry: Date.now() });
  _wkLog('wakeup_noanswer', `Room ${w.room} · try ${tries}`);
  showToast(tries >= 2 ? `Room ${w.room}: no answer twice — knock on the door or send someone up (🚶)` : `Room ${w.room}: calling again at ${_wkHM(new Date(at))}`, tries >= 2 ? 'warn' : 'ok');
}
function wkSentUp(id) { const w = bxWakes[id]; if (!w) return; _wkPatch(id, { done: true, result: 'sent', doneBy: _wkMe(), doneAt: Date.now() }); _wkLog('wakeup_sent', `Room ${w.room}: someone went up`); }
function wkCancel(id) { const w = bxWakes[id]; if (!w || !confirm(`Cancel room ${w.room}'s wake-up call at ${w.time} (the guest asked)?`)) return; _wkPatch(id, { done: true, result: 'cancel', doneBy: _wkMe(), doneAt: Date.now() }); _wkLog('wakeup_cancel', `Room ${w.room} at ${w.time}`); }
function wkUndo(id) { _wkPatch(id, { done: false, result: null, doneBy: null, doneAt: null }); }
function wkDelete(id) {
  const w = bxWakes[id]; if (!w || !confirm(`Delete room ${w.room}'s wake-up call at ${w.time}? (Set by mistake. If the guest cancelled, use Cancel so it stays in the log.)`)) return;
  delete bxWakes[id]; if (typeof fbSet === 'function') fbSet('brain/wakeups/' + id, null); wkRender();
}
function wkEditTime(id) {
  const w = bxWakes[id]; if (!w) return;
  const v = prompt(`New time for room ${w.room}`, w.time); if (v == null) return;
  const t = _wkTime(v); if (!t) { showToast('Write the time like 6:30', 'warn'); return; }
  const d = new Date(w.at); d.setHours(t[0], t[1], 0, 0);
  _wkPatch(id, { at: d.getTime(), time: _wkHM(d), alerts: 0, lastAlert: 0 });
}
function wkConfirmed(id) { _wkPatch(id, { confirmed: true }); }
function _wkLine(w) {
  return `${new Date(w.at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}  ${w.time}  Room ${w.room}${w.name ? '  ' + w.name : ''}${w.backup ? `  (+backup ${w.backup} min)` : ''}${w.note ? '  · ' + w.note : ''}`;
}
function _wkOpen() { return _wkAll().filter(w => !w.done && w.at > Date.now() - 6 * 3600e3).sort((a, b) => a.at - b.at); }
function wkCopy(btn) {
  const list = _wkOpen(); if (!list.length) { showToast('No wake-up calls to copy', 'warn'); return; }
  copyToClipboard('Wake-up calls\n' + list.map(_wkLine).join('\n'), btn, '📋 Copy');
}
function wkPrint() {
  const list = _wkOpen();
  const rows = list.map(w => `<tr><td>${escapeHtml(new Date(w.at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }))}</td><td><b>${escapeHtml(w.time)}</b></td><td><b>${escapeHtml(w.room)}</b></td><td>${escapeHtml(w.name || '')}</td><td>${w.backup ? `+${w.backup} min` : ''}</td><td>${escapeHtml(w.note || '')}</td><td></td><td></td></tr>`).join('');
  const win = window.open('', '_blank'); if (!win) { showToast('Allow pop-ups to print', 'warn'); return; }
  win.document.write(`<!doctype html><title>Wake-up calls</title><style>body{font:13px system-ui;margin:24px}h2{margin:0 0 4px}table{border-collapse:collapse;width:100%;margin-top:12px}td,th{border:1px solid #999;padding:7px 8px;text-align:left}th{background:#eee}</style><h2>Wake-up calls</h2><div>Printed ${escapeHtml(new Date().toLocaleString('en-GB'))} by ${escapeHtml(_wkMe())}</div><table><tr><th>Day</th><th>Time</th><th>Room</th><th>Guest</th><th>Backup</th><th>Note</th><th>Called at</th><th>By</th></tr>${rows || '<tr><td colspan=8>None</td></tr>'}</table>`);
  win.document.close(); win.focus(); win.print();
}
function wkSetFilter(v) { _wkFilter = String(v || '').trim(); const r = document.getElementById('wkRoot'); if (r) _wkLists(r); }

// ── Page ──────────────────────────────────────────────────
function _wkLeft(t) {
  const m = Math.max(0, Math.round((t - Date.now()) / 60e3));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}
function wkRender() {
  const now = Date.now(), all = _wkAll(), today = _wkDay(now);
  const open = all.filter(w => !w.done);
  const leftToday = open.filter(w => _wkDay(w.at) === today || w.at <= now).length;
  ['badge-wakeups', 'mob-badge-wakeups'].forEach(id => { const b = document.getElementById(id); if (b) b.textContent = leftToday ? String(leftToday) : (id === 'badge-wakeups' ? '—' : ''); });
  const root = document.getElementById('wkRoot'); if (!root) return;
  if (!root.dataset.ready) {
    root.innerHTML = `
      <div id="wkKpi"></div>
      <div id="wkNext"></div>
      <div class="card wk-card">
        <div class="wk-card-hd"><div class="wk-card-t"><span class="wk-ic">${typeof hoIcon === 'function' ? hoIcon('wakeups') : '⏰'}</span>New wake-up call</div><span class="wk-card-s">Read the room and time back to the guest</span></div>
        <div class="wk-form">
          <label class="wk-f"><span>Room</span><input id="wkRoom" inputmode="numeric" placeholder="512" autocomplete="off" oninput="const n=_wkGuest(this.value);const g=document.getElementById('wkName');if(!g.dataset.typed)g.value=n;document.getElementById('wkOutWarn').hidden=!_wkCheckedOut(this.value)" onkeydown="if(event.key==='Enter')document.getElementById('wkTime').focus()"></label>
          <label class="wk-f"><span>Time</span><input id="wkTime" type="time" value="06:30" onkeydown="if(event.key==='Enter')wkAddFromForm()"></label>
          <label class="wk-f"><span>Day</span><select id="wkDay" onchange="document.getElementById('wkDate').hidden=this.value!=='date'"><option value="next">Next time it comes</option><option value="today">Today</option><option value="tomorrow">Tomorrow</option><option value="date">Pick a date…</option></select><input id="wkDate" type="date" value="${_wkISO(now + 864e5)}" hidden></label>
          <label class="wk-f"><span>Backup call</span><select id="wkBackup"><option value="0">No backup</option><option value="5">5 min later</option><option value="10">10 min later</option><option value="15">15 min later</option></select></label>
          <label class="wk-f wk-w2"><span>Guest</span><input id="wkName" placeholder="Filled in from today's reports" oninput="this.dataset.typed=this.value?1:''"></label>
          <label class="wk-f wk-w2"><span>Note</span><input id="wkNote" placeholder="e.g. coffee to the room · taxi at 7:30 · speaks French"></label>
          <div class="wk-opts wk-w4">
            <label class="wk-chk"><input type="checkbox" id="wkConfirm"> Read back to the guest ✓</label>
            <label class="wk-chk"><input type="checkbox" id="wkRepeat" onchange="document.getElementById('wkUntil').disabled=!this.checked"> Every day until <input id="wkUntil" type="date" value="${_wkISO(now + 3 * 864e5)}" disabled></label>
            <span class="wk-warn" id="wkOutWarn" hidden>⚠ This room is checked out on today's board</span>
            <button class="btn gold wk-go" onclick="wkAddFromForm()">Set wake-up call</button>
          </div>
        </div>
        <details class="wk-many"><summary>Several at once</summary>
          <textarea id="wkMany" rows="3" placeholder="One per line or separated by commas:&#10;512 6:30&#10;610 7:15 tomorrow&#10;702 0545 coffee to the room"></textarea>
          <button class="btn" onclick="wkAddMany()">Set them all</button>
        </details>
      </div>
      <div id="wkLists"></div>`;
    root.dataset.ready = '1';
  }
  // the summary and the next call
  const todays = all.filter(w => _wkDay(w.at) === today);
  const done = todays.filter(w => w.done && w.result !== 'cancel').length;
  const trouble = open.filter(w => (w.tries || 0) > 0).length + todays.filter(w => w.result === 'sent').length;
  const dueNow = open.filter(w => w.at <= now).length;
  document.getElementById('wkKpi').innerHTML = `<div class="kpi-row c4 wk-kpis">
    <div class="kpi sky"><div class="kpi-accent"></div><div class="kpi-label">Today</div><div class="kpi-val">${todays.length}</div></div>
    <div class="kpi gold"><div class="kpi-accent"></div><div class="kpi-label">Still to call</div><div class="kpi-val">${leftToday}</div></div>
    <div class="kpi mint"><div class="kpi-accent"></div><div class="kpi-label">Called</div><div class="kpi-val">${done}</div></div>
    <div class="kpi ${dueNow || trouble ? 'rose' : 'purple'}"><div class="kpi-accent"></div><div class="kpi-label">${dueNow ? 'Due now' : 'No answer / sent up'}</div><div class="kpi-val">${dueNow || trouble}</div></div></div>`;
  const nx = open.filter(w => w.at > now).sort((a, b) => a.at - b.at)[0];
  document.getElementById('wkNext').innerHTML = nx ? `<div class="wk-next"><span class="wk-next-l">Next call</span><b>${escapeHtml(nx.time)}</b><span>Room ${escapeHtml(nx.room)}${nx.name ? ' · ' + escapeHtml(nx.name) : ''}</span><span class="wk-next-in">in ${_wkLeft(nx.at)}</span></div>` : '';
  _wkLists(root);
}
function _wkLists(root) {
  const box = root.querySelector('#wkLists'); if (!box) return;
  const now = Date.now(), f = _wkFilter.toLowerCase();
  const match = w => !f || String(w.room).toLowerCase().includes(f) || String(w.name || '').toLowerCase().includes(f);
  const all = _wkAll().filter(match);
  const due = all.filter(w => !w.done && w.at <= now && w.at > now - 6 * 3600e3).sort((a, b) => a.at - b.at);
  const next = all.filter(w => !w.done && w.at > now).sort((a, b) => a.at - b.at);
  const log = all.filter(w => w.done && (w.doneAt || w.at) > now - 24 * 3600e3).sort((a, b) => (b.doneAt || b.at) - (a.doneAt || a.at));
  const dayName = t => { const d = _wkDay(t), td = _wkDay(now); return d === td ? 'Today' : d === td + 864e5 ? 'Tomorrow' : new Date(t).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' }); };
  const tags = w => [
    w.backup && !w.backupOf ? `<span class="wk-tag">+${w.backup} min backup</span>` : '',
    w.backupOf ? '<span class="wk-tag">backup call</span>' : '',
    w.confirmed ? '<span class="wk-tag ok">read back ✓</span>' : (!w.done ? `<button class="wk-tag warn" onclick="wkConfirmed('${w.id}')" title="Tap when it was read back to the guest">not read back</button>` : ''),
    w.tries ? `<span class="wk-tag bad">${w.tries}× no answer</span>` : '',
    !w.done && _wkCheckedOut(w.room) ? '<span class="wk-tag bad">checked out?</span>' : '',
  ].join('');
  const row = (w, kind) => `<div class="wk-row wk-${kind}">
      <div class="wk-tm"><b>${escapeHtml(w.time)}</b>${kind === 'next' ? `<small>in ${_wkLeft(w.at)}</small>` : kind === 'due' ? '<small>now</small>' : ''}</div>
      <div class="wk-rm">${escapeHtml(w.room)}</div>
      <div class="wk-main">
        <div class="wk-name">${w.name ? escapeHtml(w.name) : '<span class="wk-dim">Guest not named</span>'}</div>
        ${w.note ? `<div class="wk-note">${escapeHtml(w.note)}</div>` : ''}
        <div class="wk-tags">${tags(w)}</div>
        <div class="wk-by">${kind === 'log' ? `${(WK_RESULT[w.result] || ['✓ Done'])[0]}${w.doneBy ? ' · ' + escapeHtml(w.doneBy) : ''}${w.doneAt ? ' at ' + _wkHM(new Date(w.doneAt)) : ''} · set by ${escapeHtml(w.by || '—')}` : `Set by ${escapeHtml(w.by || '—')}${w.setAt ? ' at ' + _wkHM(new Date(w.setAt)) : ''}`}</div>
      </div>
      <div class="wk-acts">${kind === 'log'
        ? `<button class="btn sm ghost" onclick="wkUndo('${w.id}')" title="Undo">↶ Undo</button>`
        : kind === 'due'
          ? `<button class="btn sm gold" onclick="wkAnswered('${w.id}')">✓ Answered</button><button class="btn sm" onclick="wkNoAnswer('${w.id}')">📵 No answer</button>${w.tries ? `<button class="btn sm" onclick="wkSentUp('${w.id}')">🚶 Sent up</button>` : ''}`
          : `<button class="btn sm ghost" onclick="wkEditTime('${w.id}')" title="Change the time">Edit</button><button class="btn sm ghost" onclick="wkCancel('${w.id}')" title="The guest cancelled">Cancel</button><button class="btn sm ghost wk-del" onclick="wkDelete('${w.id}')" title="Delete (set by mistake)">✕</button>`}</div>
    </div>`;
  let html = `<div class="wk-tools"><input class="wk-search" placeholder="Find a room or guest…" value="${escapeHtml(_wkFilter)}" oninput="wkSetFilter(this.value)"><button class="btn sm" onclick="wkCopy(this)">📋 Copy</button><button class="btn sm" onclick="wkPrint()">🖨 Print</button></div>`;
  if (due.length) html += `<div class="card wk-card wk-now"><div class="wk-card-hd"><div class="wk-card-t"><span class="wk-pulse"></span>Call now</div><span class="wk-card-s">${due.length} waiting · everyone on shift is alerted every 5 minutes</span></div>${due.map(w => row(w, 'due')).join('')}</div>`;
  if (next.length) {
    const groups = {}; next.forEach(w => { (groups[dayName(w.at)] = groups[dayName(w.at)] || []).push(w); });
    html += `<div class="card wk-card"><div class="wk-card-hd"><div class="wk-card-t">Coming up</div><span class="wk-card-s">${next.length} set</span></div>${Object.entries(groups).map(([d, l]) => `<div class="wk-day">${escapeHtml(d)}<span>${l.length}</span></div>${l.map(w => row(w, 'next')).join('')}`).join('')}</div>`;
  }
  if (!due.length && !next.length) html += `<div class="card wk-card wk-empty"><div class="wk-empty-ic">${typeof hoIcon === 'function' ? hoIcon('wakeups') : '⏰'}</div><b>${f ? 'Nothing matches' : 'No wake-up calls set'}</b><span>${f ? 'Try another room or name.' : 'Add one above, or tell Ops Brain "wake up 512 at 6:30".'}</span></div>`;
  if (log.length) html += `<details class="card wk-card wk-logbox"><summary class="wk-card-hd"><div class="wk-card-t">Log · last 24 hours</div><span class="wk-card-s">${log.length}</span></summary>${log.map(w => row(w, 'log')).join('')}</details>`;
  const keepFocus = document.activeElement && document.activeElement.classList.contains('wk-search');
  box.innerHTML = html;
  if (keepFocus) { const s = box.querySelector('.wk-search'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
}
// every 30 s: the countdowns, "Call now", and the menu badge
document.addEventListener('DOMContentLoaded', () => { setInterval(wkRender, 30000); setTimeout(wkRender, 2500); });
