// ═══════════════════════════════════════════════════════════
//  shift-report.js — 📝 End-of-shift report
//  One tap (Home → 📝 Shift report, or 30 minutes before the shift ends the Brain offers it): a ready-to-send summary of
//  YOUR shift from what HotelOps already knows — check-outs, extensions and late check-outs done in the shift, rooms still due /
//  overdue / no answer / DND, open balances (high and OTA ones named), your shift tasks still open, and on the night shift the
//  night checklist. 📋 Copy or 💬 WhatsApp it to the next shift or the manager. Read-only: it changes nothing.
// ═══════════════════════════════════════════════════════════
(function () {
  'use strict';
  const W = window, D = document;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const hm = d => pad(d.getHours()) + ':' + pad(d.getMinutes());
  const safe = (f, d) => { try { return f(); } catch (_) { return d; } };
  const toMin = t => { const m = String(t || '').match(/(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
  const LABEL = { morning: 'Morning', afternoon: 'Afternoon', night: 'Night', mid: 'Mid' };

  /** the shift now: its key, start and end (the end is when the next shift starts) */
  function shiftWindow(now) {
    now = now || new Date();
    const cur = safe(() => hoShiftNow(now), null) || { key: now.getHours() < 7 || now.getHours() >= 23 ? 'night' : now.getHours() < 15 ? 'morning' : 'afternoon', start: new Date(now.getTime() - 3600e3) };
    let end = new Date(cur.start.getTime() + 8 * 3600e3);
    for (let m = 15; m <= 16 * 60; m += 15) { const t = new Date(now.getTime() + m * 60e3), s = safe(() => hoShiftNow(t), null); if (s && s.key !== cur.key) { end = new Date(s.start); break; } }
    return { key: cur.key, start: cur.start, end };
  }
  /** is an "HH:MM" of today inside the shift (handles a night that crosses midnight) (pure) */
  function inShift(hhmm, startMin, endMin) {
    const m = toMin(hhmm); if (m == null) return false;
    return startMin <= endMin ? m >= startMin && m < endMin : m >= startMin || m < endMin;
  }
  /** the facts (pure over what it is given) → the report's sections */
  function build(I) {
    const S = [], money = n => 'AED ' + (Math.round(n * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
    const R = I.rooms || [], sm = I.startMin, em = I.endMin;
    if (R.length) {
      const out = R.filter(r => r.es === 'out' && inShift(r.checkoutAt, sm, em));
      const ext = R.filter(r => r.es === 'extended');
      const late = R.filter(r => r.es === 'late');
      const due = R.filter(r => r.es === 'due' || r.es === 'late' || r.es === 'na' || r.es === 'dnd');
      const over = R.filter(r => r.overdue);
      const na = R.filter(r => r.es === 'na'), dnd = R.filter(r => r.es === 'dnd');
      const L = [];
      L.push(`✅ Checked out this shift: ${out.length}${out.length ? ' (' + out.map(r => r.room).join(', ') + ')' : ''}`);
      if (ext.length) L.push(`↪ Extended: ${ext.length} (${ext.map(r => r.room + (r.nights ? ' +' + r.nights + 'n' : '')).join(', ')})`);
      if (late.length) L.push(`🕐 Late check-out: ${late.map(r => r.room + (r.lateTime ? ' ' + r.lateTime : '')).join(', ')}`);
      L.push(due.length ? `⏳ Still to leave: ${due.length} (${due.map(r => r.room).join(', ')})` : '🎉 Nobody left to check out');
      if (over.length) L.push(`⚠️ Past check-out time: ${over.map(r => r.room).join(', ')}`);
      if (na.length) L.push(`📵 No answer: ${na.map(r => r.room).join(', ')}`);
      if (dnd.length) L.push(`🚫 DND: ${dnd.map(r => r.room).join(', ')}`);
      S.push({ t: '🚪 Departures', L });
      const owe = R.filter(r => r.owes);
      if (owe.length) {
        const B = [`💳 Open balances: ${owe.length} room${owe.length === 1 ? '' : 's'} · ${money(owe.reduce((s, r) => s + r.balance, 0))}`];
        const hi = owe.filter(r => r.balance >= I.hiBal).sort((a, b) => b.balance - a.balance);
        if (hi.length) B.push(`💰 High (≥ ${I.hiBal}): ` + hi.map(r => `${r.room} ${money(r.balance)}`).join(', '));
        const ota = owe.filter(r => r.ota);
        if (ota.length) B.push('🌐 OTA (usually prepaid — check): ' + ota.map(r => `${r.room} ${r.source} ${money(r.balance)}`).join(', '));
        S.push({ t: '💳 Balances', L: B });
      }
    }
    if (I.arrivals != null) S.push({ t: '🛬 Arrivals', L: [`${I.arrivals} arrival${I.arrivals === 1 ? '' : 's'} on today's list`] });
    if (I.tasks && I.tasks.total) {
      const T = [`${I.tasks.done} of ${I.tasks.total} done`];
      if (I.tasks.left.length) T.push('Still open: ' + I.tasks.left.slice(0, 8).join(' · ') + (I.tasks.left.length > 8 ? ` (+${I.tasks.left.length - 8})` : ''));
      S.push({ t: '✅ Shift tasks', L: T });
    }
    if (I.checklist) S.push({ t: '🌙 Night checklist', L: [`${I.checklist.done} of ${I.checklist.total} steps done` + (I.checklist.next ? ` · next: ${I.checklist.next}` : '')] });
    return S;
  }
  function facts() {
    const w = shiftWindow(), sm = w.start.getHours() * 60 + w.start.getMinutes(), em = w.end.getHours() * 60 + w.end.getMinutes();
    const rooms = safe(() => (typeof depRooms !== 'undefined' ? depRooms : []).map(r => ({
      room: r.roomStr, es: effectiveStatus(r), checkoutAt: r.checkoutAt || '', nights: r.extensionNights || 0, lateTime: r.lateTime || '',
      overdue: safe(() => _depIsOverdue(r), false), balance: +r.balance || 0, owes: safe(() => depOwes(r), r.balance > 0), source: r.source || '',
      ota: safe(() => hoIsOta(r.source, r.company), false) })), []);
    let tasks = null;
    safe(() => { const inst = _stCurrentInstance(), sh = SHIFTS[w.key] || SHIFTS[inst.key]; if (!sh) return;
      const on = sh.tasks.filter(t => stTaskState(t, inst.day, inst.key) === 'on'); const left = on.filter(t => !stIsDone(inst.key, t));
      tasks = { total: on.length, done: on.length - left.length, left: left.map(t => t.name || t.text || t.label || '') }; });
    let checklist = null;
    if (w.key === 'night') safe(() => { const steps = CL_STEPS.filter(s => !(clState.skipped && clState.skipped.has(s.id))); const done = steps.filter(s => clState.done.has(s.id)).length;
      const next = steps.find(s => !clState.done.has(s.id)); checklist = { done, total: steps.length, next: next ? next.name : '' }; });
    const arrivals = safe(() => (typeof arrGuests !== 'undefined' ? arrGuests.length : null), null);
    return { w, startMin: sm, endMin: em, rooms, tasks, checklist, arrivals, hiBal: safe(() => hoHighBal(), 500) };
  }
  /** the report as plain text (WhatsApp / copy) */
  function text(I, S) {
    const hotel = safe(() => (D.getElementById('hotelName') || {}).textContent.trim(), '') || 'Hotel';
    const who = safe(() => currentProfile && currentProfile.name, '') || '';
    const day = I.w.start.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    return [`📝 *${LABEL[I.w.key] || I.w.key} shift report* · ${hotel}`, `${day} · ${hm(I.w.start)}–${hm(I.w.end)}${who ? ' · ' + who : ''}`, '']
      .concat(...S.map(s => [`*${s.t}*`].concat(s.L.map(l => '• ' + l), [''])), ['— sent from HotelOps']).join('\n');
  }
  function open() {
    const I = facts(), S = build(I), T = text(I, S);
    D.getElementById('hoShiftRep')?.remove(); css();
    const w = D.createElement('div'); w.id = 'hoShiftRep'; w.className = 'srp';
    w.innerHTML = `<div class="srp-bg" data-srp-x="1"></div><section class="srp-card" role="dialog" aria-modal="true" aria-labelledby="srpT">
      <header class="srp-h"><span aria-hidden="true">📝</span><div><b id="srpT">${esc(LABEL[I.w.key] || I.w.key)} shift report</b><small>${esc(I.w.start.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }))} · ${hm(I.w.start)}–${hm(I.w.end)} · made from HotelOps, nothing to type</small></div><button type="button" class="srp-x" data-srp-x="1" aria-label="Close">✕</button></header>
      <div class="srp-b">${S.length ? S.map(s => `<div class="srp-sec"><h4>${esc(s.t)}</h4><ul>${s.L.map(l => `<li>${esc(l)}</li>`).join('')}</ul></div>`).join('') : '<p class="srp-empty">Nothing loaded yet this shift — load Departures and Arrivals first.</p>'}</div>
      <footer class="srp-f"><button type="button" class="btn" data-srp="copy">📋 Copy</button><button type="button" class="btn gold" data-srp="wa">💬 WhatsApp</button></footer></section>`;
    D.body.appendChild(w);
    w.addEventListener('click', e => {
      if (e.target.closest('[data-srp-x]')) { w.remove(); return; }
      const b = e.target.closest('[data-srp]'); if (!b) return;
      if (b.dataset.srp === 'copy') { const ok = () => typeof showToast === 'function' && showToast('📋 Shift report copied — paste it in WhatsApp or e-mail', 'ok');
        if (typeof copyToClipboard === 'function') copyToClipboard(T, b, b.textContent); else safe(() => navigator.clipboard.writeText(T).then(ok)); ok(); }
      else { safe(() => W.open('https://wa.me/?text=' + encodeURIComponent(T), '_blank', 'noopener')); }
    });
    D.addEventListener('keydown', function k(e) { if (e.key === 'Escape') { w.remove(); D.removeEventListener('keydown', k); } });
  }
  function css() {
    if (D.getElementById('hoShiftRepCss')) return;
    const s = D.createElement('style'); s.id = 'hoShiftRepCss';
    s.textContent = `.srp{position:fixed;inset:0;z-index:10030;display:flex;align-items:center;justify-content:center}.srp-bg{position:absolute;inset:0;background:rgba(0,0,0,.5)}
.srp-card{position:relative;width:min(560px,calc(100vw - 24px));max-height:calc(100dvh - 32px);display:flex;flex-direction:column;background:var(--card2,#111827);color:var(--text);border:1px solid var(--border2);border-radius:var(--r3,18px);box-shadow:0 30px 70px -20px rgba(0,0,0,.6);overflow:hidden}
.srp-h{display:flex;gap:12px;align-items:flex-start;padding:16px;border-bottom:1px solid var(--border)}.srp-h>span{font-size:24px}.srp-h div{flex:1;display:flex;flex-direction:column;gap:3px}.srp-h b{font-size:1.05rem}.srp-h small{color:var(--text2);font-size:.78rem}
.srp-x{width:38px;height:38px;border-radius:50%;border:1px solid var(--border2);background:transparent;color:var(--text);cursor:pointer}
.srp-b{overflow:auto;padding:12px 16px;display:grid;gap:10px}.srp-sec{padding:12px 14px;border:1px solid var(--border);border-radius:var(--r2,12px);background:var(--card)}
.srp-sec h4{margin:0 0 6px;font-size:.88rem}.srp-sec ul{margin:0;padding-left:18px;display:grid;gap:4px;font-size:.88rem;line-height:1.45;color:var(--text)}.srp-empty{color:var(--text2);text-align:center;padding:20px}
.srp-f{display:flex;gap:8px;justify-content:flex-end;padding:12px 16px calc(14px + env(safe-area-inset-bottom));border-top:1px solid var(--border)}.srp-f .btn{min-height:44px}
@media (max-width:600px){.srp{align-items:flex-end}.srp-card{width:100vw;border-radius:20px 20px 0 0;max-height:92dvh}.srp-f .btn{flex:1}}`;
    D.head.appendChild(s);
  }
  // Home: the button next to Refresh
  function mount() {
    const a = D.querySelector('#panel-home .page-hd-actions'); if (!a || a.querySelector('[data-srp-open]')) return;
    const b = D.createElement('button'); b.className = 'btn'; b.dataset.srpOpen = '1'; b.textContent = '📝 Shift report'; b.title = 'A ready-to-send summary of your shift'; b.onclick = open;
    a.insertBefore(b, a.firstChild);
  }
  // the Brain offers it in the last 30 minutes of the shift (quietly: it waits in 🧠)
  (W.BL_THINKERS = W.BL_THINKERS || []).push(add => {
    const w = shiftWindow(), left = (w.end - Date.now()) / 60000;
    if (left > 0 && left <= 30) add({ id: 'srp:' + w.key + ':' + w.start.toISOString().slice(0, 10), type: 'shiftReport', icon: '📝', tone: 'idle', silent: true,
      text: `Your ${LABEL[w.key] || w.key} shift ends at ${hm(w.end)} — your shift report is ready to send`, why: 'Made from Departures, balances, your shift tasks' + (w.key === 'night' ? ' and the night checklist' : '') + '.', acts: [['📝 Open the report', open]] });
  });
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', mount); else mount();
  W.hoShiftReport = { open, _pure: { inShift, build, shiftWindow } };
})();
