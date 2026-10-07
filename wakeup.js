// ═══════════════════════════════════════════════════════════
//  wakeup.js — Wake-up Calls
//  One list for the whole team: add a call (room, time, day, guest, note,
//  every day until…), or several at once ("512 6:30, 610 7:15 tomorrow").
//  At the time everyone on shift with HotelOps open is alerted, again every
//  5 minutes until someone taps ✓ Called. "No answer" tries again in
//  5 minutes. Copy or print the list for the night.
//  Firebase: brain/wakeups/{id} = { room, time, at, by, name, note,
//            done, doneBy, doneAt, tries, alerts, lastAlert }
//  (the same list Ops Brain's "wake up 512 at 6:30" uses)
// ═══════════════════════════════════════════════════════════

const _wkMe = () => (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || 'Someone';
const _wkHM = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const _wkDay = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
function _wkAll() { return typeof bxWakes !== 'undefined' ? Object.entries(bxWakes || {}).filter(([, w]) => w && w.at).map(([id, w]) => Object.assign({ id }, w)) : []; }
function _wkSave(id, w) {
  bxWakes[id] = w;
  if (typeof fbSet === 'function') fbSet('brain/wakeups/' + id, w);
}
function _wkPatch(id, patch) {
  const w = bxWakes[id]; if (!w) return;
  Object.assign(w, patch);
  if (typeof fbUpdate === 'function') fbUpdate('brain/wakeups/' + id, patch); else fbSet('brain/wakeups/' + id, w);
  wkRender();
}
/** The guest in a room today, from the reports that are loaded. */
function _wkGuest(room) {
  room = String(room || '').trim(); if (!room) return '';
  const pick = (l, f) => { try { const g = (l || []).find(x => x && String(f(x)).trim() === room); return g ? g.name : ''; } catch (_) { return ''; } };
  return pick(typeof depRooms !== 'undefined' ? depRooms : [], x => x.roomStr || x.room) || pick(typeof arrGuests !== 'undefined' ? arrGuests : [], x => x.room) || pick(typeof purposeGuests !== 'undefined' ? purposeGuests : [], x => x.room) || '';
}
/** "6:30", "0630", "6.30am", "18:45" → hours and minutes. */
function _wkTime(s) {
  const m = String(s || '').trim().toLowerCase().match(/^(\d{1,2})(?:[:.h]?(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = +m[1], mi = +(m[2] || 0);
  if (m[3] === 'pm' && h < 12) h += 12; if (m[3] === 'am' && h === 12) h = 0;
  return h <= 23 && mi <= 59 ? [h, mi] : null;
}
/** When a call at h:mi on this day happens; "today" means the next time it comes round. */
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
  const last = opt.until ? new Date(opt.until + 'T23:59:59').getTime() : first.getTime();
  let n = 0;
  for (let t = new Date(first); t.getTime() <= last && n < 21; t.setDate(t.getDate() + 1)) {
    const id = 'w' + Date.now().toString(36) + n + Math.random().toString(36).slice(2, 5);
    _wkSave(id, { room, time: _wkHM(t), at: t.getTime(), by: _wkMe(), name: opt.name || _wkGuest(room) || '', note: opt.note || '', done: false, tries: 0, alerts: 0 });
    n++;
  }
  if (typeof logActivity === 'function') try { logActivity('wakeup_set', `Room ${room} at ${_wkHM(first)}${n > 1 ? ` · ${n} days` : ''}`); } catch (_) {}
  return n;
}

// ── Actions ───────────────────────────────────────────────
function wkAddFromForm() {
  const g = id => document.getElementById(id);
  const t = _wkTime(g('wkTime').value);
  if (!t) { showToast('Pick the time', 'warn'); return; }
  const n = wkAdd(g('wkRoom').value, t[0], t[1], { day: g('wkDay').value === 'today' ? '' : g('wkDay').value === 'tomorrow' ? _wkISO(Date.now() + 864e5) : g('wkDate').value, name: g('wkName').value.trim(), note: g('wkNote').value.trim(), until: g('wkRepeat').checked ? g('wkUntil').value : '' });
  if (!n) return;
  showToast(`⏰ Wake-up call set: room ${g('wkRoom').value.trim()} at ${String(t[0]).padStart(2, '0')}:${String(t[1]).padStart(2, '0')}${n > 1 ? ` for ${n} days` : ''}`, 'ok');
  ['wkRoom', 'wkName', 'wkNote'].forEach(id => { g(id).value = ''; });
  g('wkRepeat').checked = false; wkRender(); g('wkRoom').focus();
}
function _wkISO(t) { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
/** "512 6:30, 610 7:15 tomorrow; 702 0545" → one call each. */
function wkAddMany() {
  const txt = document.getElementById('wkMany').value;
  let ok = 0; const bad = [];
  txt.split(/[\n,;]+/).map(x => x.trim()).filter(Boolean).forEach(line => {
    const m = line.match(/^(?:room\s*)?(\d{1,5}[A-Za-z]?)\s*(?:at|@|-|–)?\s*(\d{1,2}(?:[:.h]?\d{2})?\s*(?:am|pm)?)\s*(tomorrow|tmrw|tmr)?\s*(.*)$/i);
    const t = m && _wkTime(m[2]);
    if (!t) { bad.push(line); return; }
    ok += wkAdd(m[1], t[0], t[1], { day: m[3] ? _wkISO(Date.now() + 864e5) : '', note: m[4] || '' }) ? 1 : 0;
  });
  if (ok) { document.getElementById('wkMany').value = bad.join('\n'); showToast(`⏰ ${ok} wake-up call${ok === 1 ? '' : 's'} set`, 'ok'); }
  if (bad.length) showToast(`Couldn't read: ${bad.join(' · ')} — write it as "512 6:30"`, 'warn');
  wkRender();
}
function wkCalled(id) { _wkPatch(id, { done: true, doneBy: _wkMe(), doneAt: Date.now(), result: 'ok' }); if (typeof logActivity === 'function') try { logActivity('wakeup_done', `Room ${bxWakes[id].room}`); } catch (_) {} }
function wkNoAnswer(id) {
  const w = bxWakes[id]; if (!w) return;
  const tries = (w.tries || 0) + 1, at = Date.now() + 5 * 60e3;
  _wkPatch(id, { tries, at, time: _wkHM(new Date(at)), alerts: 0, lastAlert: 0, note: (w.note ? w.note + ' · ' : '') + `no answer ${_wkHM(new Date())}` });
  showToast(`Room ${w.room}: trying again at ${_wkHM(new Date(at))}${tries >= 2 ? ' — after 2 tries, knock on the door or send someone up' : ''}`, tries >= 2 ? 'warn' : 'ok');
}
function wkUndo(id) { _wkPatch(id, { done: false, doneBy: null, doneAt: null, result: null }); }
function wkDelete(id) {
  const w = bxWakes[id]; if (!w || !confirm(`Delete the wake-up call for room ${w.room} at ${w.time}?`)) return;
  delete bxWakes[id]; if (typeof fbSet === 'function') fbSet('brain/wakeups/' + id, null); wkRender();
}
function wkEditTime(id) {
  const w = bxWakes[id]; if (!w) return;
  const v = prompt(`New time for room ${w.room}`, w.time); if (v == null) return;
  const t = _wkTime(v); if (!t) { showToast('Write the time like 6:30', 'warn'); return; }
  const d = new Date(w.at); d.setHours(t[0], t[1], 0, 0);
  _wkPatch(id, { at: d.getTime(), time: _wkHM(d), alerts: 0, lastAlert: 0 });
}
function _wkText(list) {
  return list.map(w => `${new Date(w.at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}  ${w.time}  Room ${w.room}${w.name ? '  ' + w.name : ''}${w.note ? '  (' + w.note + ')' : ''}${w.done ? '  ✓ called' + (w.doneBy ? ' by ' + w.doneBy : '') : ''}`).join('\n');
}
function wkCopy(btn) {
  const list = _wkAll().filter(w => !w.done && w.at > Date.now() - 3600e3).sort((a, b) => a.at - b.at);
  if (!list.length) { showToast('No wake-up calls to copy', 'warn'); return; }
  copyToClipboard('Wake-up calls\n' + _wkText(list), btn, '📋 Copy list');
}
function wkPrint() {
  const list = _wkAll().filter(w => !w.done && w.at > Date.now() - 3600e3).sort((a, b) => a.at - b.at);
  const rows = list.map(w => `<tr><td>${escapeHtml(new Date(w.at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }))}</td><td><b>${escapeHtml(w.time)}</b></td><td><b>${escapeHtml(w.room)}</b></td><td>${escapeHtml(w.name || '')}</td><td>${escapeHtml(w.note || '')}</td><td style="width:70px"></td></tr>`).join('');
  const win = window.open('', '_blank'); if (!win) { showToast('Allow pop-ups to print', 'warn'); return; }
  win.document.write(`<!doctype html><title>Wake-up calls</title><style>body{font:14px system-ui;margin:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:6px 8px;text-align:left}</style><h2>Wake-up calls</h2><p>Printed ${escapeHtml(new Date().toLocaleString('en-GB'))}</p><table><tr><th>Day</th><th>Time</th><th>Room</th><th>Guest</th><th>Note</th><th>Called ✓</th></tr>${rows || '<tr><td colspan=6>None</td></tr>'}</table>`);
  win.document.close(); win.focus(); win.print();
}

// ── Page ──────────────────────────────────────────────────
function wkRender() {
  const now = Date.now();
  const all = _wkAll();
  const due = all.filter(w => !w.done && w.at <= now && w.at > now - 6 * 3600e3).sort((a, b) => a.at - b.at);
  const next = all.filter(w => !w.done && w.at > now).sort((a, b) => a.at - b.at);
  const done = all.filter(w => w.done && (w.doneAt || w.at) > now - 24 * 3600e3).sort((a, b) => (b.doneAt || b.at) - (a.doneAt || a.at));
  // badges: calls still to make today
  const today = _wkDay(now), left = next.filter(w => _wkDay(w.at) === today).length + due.length;
  ['badge-wakeups', 'mob-badge-wakeups'].forEach(id => { const b = document.getElementById(id); if (b) b.textContent = left ? String(left) : (id === 'badge-wakeups' ? '—' : ''); });
  const root = document.getElementById('wkRoot'); if (!root) return;
  if (root.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && root.dataset.ready) { _wkLists(root, due, next, done); return; }
  const tmr = _wkISO(now + 864e5);
  root.innerHTML = `
    <div class="wk-add ro-card">
      <div class="ro-card-hd"><b>➕ New wake-up call</b><span>Everyone on shift is alerted at the time, until it's marked called</span></div>
      <div class="wk-form">
        <label>Room<input id="wkRoom" inputmode="numeric" placeholder="512" autocomplete="off" oninput="const n=_wkGuest(this.value);const g=document.getElementById('wkName');if(n&&!g.dataset.typed)g.value=n" onkeydown="if(event.key==='Enter')document.getElementById('wkTime').focus()"></label>
        <label>Time<input id="wkTime" type="time" value="06:30" onkeydown="if(event.key==='Enter')wkAddFromForm()"></label>
        <label>Day<select id="wkDay" onchange="document.getElementById('wkDate').style.display=this.value==='date'?'':'none'"><option value="today">Next time it comes</option><option value="tomorrow">Tomorrow</option><option value="date">Pick a date</option></select><input id="wkDate" type="date" value="${tmr}" style="display:none"></label>
        <label>Guest (optional)<input id="wkName" placeholder="Filled in from today's reports" oninput="this.dataset.typed=this.value?1:''"></label>
        <label class="wk-wide">Note (optional)<input id="wkNote" placeholder="e.g. call twice · second call 10 min later · coffee to the room"></label>
        <label class="wk-rep"><input type="checkbox" id="wkRepeat" onchange="document.getElementById('wkUntil').disabled=!this.checked"> Every day until <input id="wkUntil" type="date" value="${_wkISO(now + 3 * 864e5)}" disabled></label>
        <button class="btn gold" onclick="wkAddFromForm()">⏰ Set wake-up call</button>
      </div>
      <details class="wk-many"><summary>Several at once</summary>
        <textarea id="wkMany" class="tt-textarea" rows="3" placeholder="One per line or separated by commas:&#10;512 6:30&#10;610 7:15 tomorrow&#10;702 0545 call twice"></textarea>
        <button class="btn" onclick="wkAddMany()">Set them all</button>
      </details>
    </div>
    <div id="wkLists"></div>`;
  root.dataset.ready = '1';
  _wkLists(root, due, next, done);
}
function _wkLists(root, due, next, done) {
  const box = root.querySelector('#wkLists'); if (!box) return;
  const now = Date.now();
  const day = t => { const d = _wkDay(t), td = _wkDay(now); return d === td ? 'Today' : d === td + 864e5 ? 'Tomorrow' : new Date(t).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' }); };
  const row = (w, kind) => `<div class="wk-row wk-${kind}">
      <div class="wk-time">${escapeHtml(w.time)}</div>
      <div class="wk-main"><b>Room ${escapeHtml(w.room)}</b>${w.name ? ` · ${escapeHtml(w.name)}` : ''}${w.note ? `<small>${escapeHtml(w.note)}</small>` : ''}<small class="wk-by">${kind === 'done' ? `✓ called${w.doneBy ? ' by ' + escapeHtml(w.doneBy) : ''}${w.doneAt ? ' at ' + _wkHM(new Date(w.doneAt)) : ''}` : `set by ${escapeHtml(w.by || '—')}${w.tries ? ` · ${w.tries} tr${w.tries === 1 ? 'y' : 'ies'} without answer` : ''}`}</small></div>
      <div class="wk-acts">${kind === 'done' ? `<button class="btn sm ghost" onclick="wkUndo('${w.id}')">↶</button>` : `${kind === 'due' ? `<button class="btn sm gold" onclick="wkCalled('${w.id}')">✓ Called</button><button class="btn sm" onclick="wkNoAnswer('${w.id}')">📵 No answer</button>` : `<button class="btn sm ghost" onclick="wkCalled('${w.id}')" title="Already called">✓</button><button class="btn sm ghost" onclick="wkEditTime('${w.id}')" title="Change the time">✎</button>`}<button class="btn sm ghost" onclick="wkDelete('${w.id}')" title="Delete">✕</button>`}</div>
    </div>`;
  let html = '';
  if (due.length) html += `<div class="ro-card wk-now"><div class="ro-card-hd"><b>☎️ Call now</b><span>${due.length} waiting</span></div>${due.map(w => row(w, 'due')).join('')}</div>`;
  if (next.length) {
    const groups = {}; next.forEach(w => { (groups[day(w.at)] = groups[day(w.at)] || []).push(w); });
    html += `<div class="ro-card"><div class="ro-card-hd"><b>⏰ Coming up</b><span><button class="btn sm" onclick="wkCopy(this)">📋 Copy list</button> <button class="btn sm" onclick="wkPrint()">🖨 Print</button></span></div>${Object.entries(groups).map(([d, l]) => `<div class="wk-day">${escapeHtml(d)} · ${l.length}</div>${l.map(w => row(w, 'next')).join('')}`).join('')}</div>`;
  }
  if (!due.length && !next.length) html += `<div class="ro-empty">No wake-up calls set. Add one above, or tell Ops Brain "wake up 512 at 6:30".</div>`;
  if (done.length) html += `<details class="ro-card wk-done"><summary><b>✓ Done (last 24 hours)</b> · ${done.length}</summary>${done.map(w => row(w, 'done')).join('')}</details>`;
  box.innerHTML = html;
}
document.addEventListener('DOMContentLoaded', () => { setInterval(() => { if (document.getElementById('panel-wakeups')?.classList.contains('active')) wkRender(); }, 30000); setTimeout(wkRender, 2500); });
