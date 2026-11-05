// ═══════════════════════════════════════════════════════════
//  start-day.js — ☀️ "Start of the day": before the day starts, HotelOps asks you to load the two reports everything
//  else is built on — the In-house report and today's Departures. Once a day (per hotel), a few seconds after you sign in,
//  only when one of them is not loaded for today yet. Each line ticks itself ✓ the moment its report is in (from the file
//  or read from Opera), and the window closes by itself when both are in. "Remind me in 30 min" or "Skip today".
// ═══════════════════════════════════════════════════════════
(function () {
  'use strict';
  const W = window, D = document;
  const KEY = () => 'ho_startday_v1_' + (typeof HOTEL_ID !== 'undefined' ? String(HOTEL_ID || '') : '');
  const today = () => (typeof hoLocalISO === 'function' ? hoLocalISO() : new Date().toISOString().slice(0, 10));
  const iso = d => d && !isNaN(d) ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const get = () => { try { return JSON.parse(localStorage.getItem(KEY()) || '{}') || {}; } catch (_) { return {}; } };
  const put = v => { try { localStorage.setItem(KEY(), JSON.stringify(v)); } catch (_) {} };
  let timer = 0, closing = 0;

  /** what is loaded for today (pure over what it is given): { ih: {ok, at, by}, dep: {ok, n} } */
  function statusOf(x, t) {
    const ih = { ok: !!x.ihDate && x.ihDate === t, at: x.ihAt || '', by: x.ihBy || '', date: x.ihDate || '' };
    const dep = { ok: x.depN > 0 && x.depDay === t, n: x.depN || 0, day: x.depDay || '' };
    return { ih, dep, all: ih.ok && dep.ok };
  }
  /** ask now? (pure): signed in, not answered for today, not snoozed, something missing */
  function shouldAsk(st, memo, t, now, hour, role) {
    if (st.all) return false;
    // the start of the day, not the end of it: 05:00–15:59 (at 01:00 the new day's reports don't exist yet; at 23:00 the day is over)
    if (hour != null && (hour < 5 || hour >= 16)) return false;
    if (role === 'readonly') return false;   // a view-only login can't load reports: nothing to ask
    if (memo.date === t && (memo.done || memo.skip)) return false;
    if (memo.date === t && memo.until && now < memo.until) return false;
    return true;
  }
  function read() {
    let ihDate = '', ihAt = '', ihBy = '', depN = 0, depDay = '';
    try { if (W.hoInHouse) { ihDate = W.hoInHouse.date || ''; ihAt = W.hoInHouse.loadedAt || ''; ihBy = W.hoInHouse.by || ''; } } catch (_) {}
    try { if (typeof depRooms !== 'undefined' && Array.isArray(depRooms)) { depN = depRooms.length; if (typeof _depBoardDate === 'function') depDay = iso(_depBoardDate()); } } catch (_) {}
    return statusOf({ ihDate, ihAt, ihBy, depN, depDay }, today());
  }
  const signedIn = () => { try { return typeof currentProfile !== 'undefined' && !!currentProfile; } catch (_) { return false; } };
  const hhmm = v => { if (!v) return ''; const d = new Date(typeof v === 'number' ? v : Date.parse(v) || v); return isNaN(d) ? String(v).slice(0, 5) : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); };

  function rowHtml(ic, title, ok, okText, needText, acts) {
    return `<div class="sd-row ${ok ? 'ok' : ''}"><span class="sd-ic" aria-hidden="true">${ok ? '✓' : ic}</span><div class="sd-t"><b>${esc(title)}</b><small>${esc(ok ? okText : needText)}</small>
      ${ok ? '' : `<span class="sd-acts">${acts}</span>`}</div></div>`;
  }
  function paint() {
    const w = D.getElementById('hoStartDay'); if (!w) return;
    const st = read(), body = w.querySelector('.sd-b');
    body.innerHTML = rowHtml('🏨', 'In-house report', st.ih.ok, `Loaded for today${st.ih.at ? ' at ' + hhmm(st.ih.at) : ''}${st.ih.by ? ' by ' + st.ih.by : ''}`,
      st.ih.date ? 'The list here is from ' + st.ih.date + ' — load today\'s' : 'Not loaded yet today',
      `<button type="button" class="btn sm gold" data-sd="ih">📂 Load the file</button><button type="button" class="btn sm" data-sd="opera">📡 Read from Opera</button>`)
      + rowHtml('🚪', 'Departures (today)', st.dep.ok, `${st.dep.n} room${st.dep.n === 1 ? '' : 's'} on today's board`,
        st.dep.n && st.dep.day ? 'The board is for ' + st.dep.day + ' — load today\'s' : 'Not loaded yet today',
        `<button type="button" class="btn sm gold" data-sd="dep">📂 Load the file</button><button type="button" class="btn sm" data-sd="opera">📡 Read from Opera</button>`)
      + `<p class="sd-tip">${st.all ? '✅ All set — have a good shift!' : '📡 With Opera: open <b>In House</b>, then <b>Departures</b> in Opera — the reader loads them by itself and these lines tick.'}</p>`;
    const n = (st.ih.ok ? 1 : 0) + (st.dep.ok ? 1 : 0);
    const pr = w.querySelector('.sd-prog'); if (pr) pr.textContent = n + ' of 2 loaded';
    if (st.all && !closing) { closing = setTimeout(() => { put({ date: today(), done: true }); close(); }, 2200); }
  }
  function close() { const w = D.getElementById('hoStartDay'); if (w) w.remove(); clearInterval(timer); timer = 0; clearTimeout(closing); closing = 0; }
  function open(force) {
    if (D.getElementById('hoStartDay')) return;
    const st = read(); if (st.all && !force) return;
    css();
    const w = D.createElement('div'); w.id = 'hoStartDay'; w.className = 'sd';
    const h = new Date().getHours(), hi = h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    w.innerHTML = `<div class="sd-bg"></div><section class="sd-card" role="dialog" aria-modal="true" aria-labelledby="sdTitle">
      <header class="sd-h"><span class="sd-sun" aria-hidden="true">☀️</span><div><b id="sdTitle">${hi} — start of the day</b><em class="sd-tap">tap to open</em><small>Load today's reports first: Departures, Purpose of Stay, the Brain and the checks all use them. <span class="sd-prog"></span></small></div>
        <button type="button" class="sd-x" data-sd="later" aria-label="Remind me later">✕</button></header>
      <div class="sd-b"></div>
      <footer class="sd-f"><button type="button" class="btn" data-sd="later">⏰ Remind me in 30 min</button><button type="button" class="btn ghost" data-sd="skip">Skip today</button></footer></section>`;
    D.body.appendChild(w);
    w.addEventListener('click', e => {
      const b = e.target.closest('[data-sd]'); if (!b) return;
      const a = b.dataset.sd;
      if (a === 'ih' || a === 'dep') { if (typeof showPanel === 'function') showPanel(a === 'ih' ? 'inhouse' : 'departures'); minimise(); }
      else if (a === 'opera') { try { if (W.hoOpera && W.hoOpera.openOpera) W.hoOpera.openOpera(); } catch (_) {} if (typeof showToast === 'function') showToast('📡 In Opera open In House, then Departures — HotelOps ticks them here by itself', 'info'); minimise(); }
      else if (a === 'later') { put({ date: today(), until: Date.now() + 30 * 60e3 }); close(); }
      else if (a === 'skip') { put({ date: today(), skip: true }); close(); }
    });
    paint(); clearInterval(timer); timer = setInterval(paint, 2000);
    try { w.querySelector('.btn.gold').focus({ preventScroll: true }); } catch (_) {}
  }
  /** you went to load a file: the window steps aside as a small bar and comes back ticked */
  function minimise() {
    const w = D.getElementById('hoStartDay'); if (!w) return;
    w.classList.add('mini');
    const card = w.querySelector('.sd-card');
    card.onclick = ev => { if (w.classList.contains('mini') && !ev.target.closest('[data-sd]')) { w.classList.remove('mini'); } };
  }
  function check() {
    if (!signedIn() || D.getElementById('hoStartDay')) return;
    try { if (localStorage.getItem('ho_startday_off') === '1') return; } catch (_) {}   // switched off (⚙️ on Home)
    // never on top of another window (the Morning brief, What's new, a dialog): wait until it is closed
    if (D.querySelector('#mbOverlay.open, #wnModal, .fr-overlay, .modal-bg.open, #hoShiftRep')) { clearTimeout(check.t); check.t = setTimeout(check, 15000); return; }
    const app = D.getElementById('appWrapper'); if (app && app.style.display === 'none') return;
    let role = ''; try { role = (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.role) || ''; } catch (_) {}
    if (shouldAsk(read(), get(), today(), Date.now(), new Date().getHours(), role)) open();
  }
  function css() {
    if (D.getElementById('hoStartDayCss')) return;
    const s = D.createElement('style'); s.id = 'hoStartDayCss';
    s.textContent = `.sd{position:fixed;inset:0;z-index:10040;display:flex;align-items:center;justify-content:center}
.sd-bg{position:absolute;inset:0;background:rgba(0,0,0,.5)}
.sd-card{position:relative;width:min(520px,calc(100vw - 24px));max-height:calc(100dvh - 32px);overflow:auto;background:var(--card2,#111827);color:var(--text);border:1px solid var(--border2);border-radius:var(--r3,18px);box-shadow:0 30px 70px -20px rgba(0,0,0,.6);animation:sdIn .35s cubic-bezier(.2,.8,.2,1)}
@keyframes sdIn{from{opacity:0;transform:translateY(14px) scale(.98)}}
.sd-h{display:flex;gap:12px;align-items:flex-start;padding:16px 16px 12px;border-bottom:1px solid var(--border)}.sd-h div{flex:1;display:flex;flex-direction:column;gap:3px}.sd-h b{font-size:1.05rem}.sd-h small{color:var(--text2);font-size:.8rem;line-height:1.45}
.sd-prog{display:inline-block;margin-left:4px;padding:1px 8px;border-radius:99px;background:var(--accent-bg);color:var(--text);font-weight:700;box-shadow:inset 0 0 0 1px var(--accent-border)}
.sd-tap{display:none;font-style:normal;font-size:.72rem;color:var(--text2)}.sd.mini .sd-tap{display:block}
.sd-sun{font-size:28px;line-height:1}.sd-x{flex:none;width:36px;height:36px;border-radius:50%;border:1px solid var(--border2);background:transparent;color:var(--text);cursor:pointer}
.sd-b{padding:12px 16px;display:grid;gap:10px}
.sd-row{display:flex;gap:12px;padding:12px;border:1px solid var(--border);border-radius:var(--r2,12px);background:var(--card)}
.sd-row.ok{border-color:color-mix(in srgb,var(--green,#22c55e) 50%,var(--border));background:color-mix(in srgb,var(--green,#22c55e) 8%,var(--card))}
.sd-ic{flex:none;width:38px;height:38px;border-radius:12px;display:grid;place-items:center;font-size:18px;background:var(--accent-bg)}.sd-row.ok .sd-ic{background:var(--green,#22c55e);color:#fff;font-weight:800}
.sd-t{flex:1;display:flex;flex-direction:column;gap:2px;min-width:0}.sd-t small{color:var(--text2);font-size:.8rem}
.sd-acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.sd-tip{margin:2px 0 0;font-size:.8rem;color:var(--text2)}
.sd-f{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;padding:12px 16px calc(14px + env(safe-area-inset-bottom));border-top:1px solid var(--border)}
.sd.mini{inset:auto 16px 92px auto;width:auto}.sd.mini .sd-bg,.sd.mini .sd-b,.sd.mini .sd-f,.sd.mini .sd-x{display:none}
.sd.mini .sd-card{width:auto;max-width:300px;cursor:pointer}.sd.mini .sd-h{border:0;padding:10px 14px}.sd.mini .sd-h small{font-size:0;line-height:0}.sd.mini .sd-prog{font-size:.75rem;line-height:1.4;margin:4px 0 0}
@media (max-width:768px){.sd.mini{right:10px;bottom:calc(150px + env(safe-area-inset-bottom))}}
@media (max-width:600px){.sd{align-items:flex-end}.sd-card{width:100vw;border-radius:20px 20px 0 0}.sd.mini .sd-card{border-radius:14px}}
@media (prefers-reduced-motion:reduce){.sd-card{animation:none}}`;
    D.head.appendChild(s);
  }
  // a few seconds after the app is on screen (the reports come from the database first), then every 5 minutes (a snooze ends, the day changes)
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', () => setTimeout(check, 9000)); else setTimeout(check, 9000);
  setInterval(check, 5 * 60e3);
  W.hoStartDay = { open: () => open(true), check, _pure: { statusOf, shouldAsk } };
})();
