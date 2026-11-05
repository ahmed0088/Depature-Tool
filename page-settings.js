// ═══════════════════════════════════════════════════════════
//  page-settings.js — ⚙️ settings and options on every page
//  Each page has a ⚙️ in its header: the options for THAT page in one place, plus a few every page has —
//  pin it to the top of the menu, show its tile on Home, open it when HotelOps starts, hide it from your menu.
//  Options reuse the app's own settings (hoPref / the page's own switches), so Settings and the page always agree.
//  Each person's own choices (this device, and their profile when "sync my settings" is on) — never the whole hotel.
// ═══════════════════════════════════════════════════════════
(function () {
  'use strict';
  const W = window, D = document;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const safe = (f, d) => { try { return f(); } catch (_) { return d; } };
  const P = k => safe(() => hoPref(k), undefined), SP = (k, v) => safe(() => hoSetPref(k, v));
  const LSb = (k, d) => safe(() => { const v = localStorage.getItem(k); return v == null ? d : v === '1'; }, d);
  const LSs = (k, v) => safe(() => localStorage.setItem(k, v ? '1' : '0'));
  const toast = (m, k) => safe(() => showToast(m, k || 'ok'));
  const tog = (key, label, desc, get, set) => ({ t: 'tog', key, label, desc, get, set });
  const sel = (key, label, desc, opts, get, set) => ({ t: 'sel', key, label, desc, opts, get, set });
  const num = (key, label, desc, unit, get, set) => ({ t: 'num', key, label, desc, unit, get, set });
  const pref = (k, label, desc) => tog(k, label, desc, () => P(k) !== false, v => SP(k, v));

  // ── what each page can set ──
  const HIBAL = num('hibal', 'High balance starts at', 'The 💰 High balance filter (Departures, In-House) and the shift report list balances of at least this much.', 'AED',
    () => safe(() => hoHighBal(), 500), v => { if (safe(() => hoSetHighBal(v), false)) { safe(() => depRender()); return true; } return false; });
  const PAGES = {
    home: [
      pref('greetName', 'Greet me by name', '"Good morning, Sam" on top of Home.'),
      pref('homeTip', 'Show the tips', 'The small tip lines under the tiles.'),
      pref('brainHome', 'Ops Brain on Home', 'What needs you now, under the tiles.'),
      pref('mbAuto', 'Open the Morning brief by itself', 'Managers, once a day between 06:00 and 11:59.'),
      tog('startDay', 'Ask me to load the day\'s reports', 'The ☀️ Start-of-day window (In-house and Departures), 05:00–15:59, once a day.', () => !LSb('ho_startday_off', false), v => LSs('ho_startday_off', !v)),
      tog('srpRemind', 'Remind me of the shift report', 'In the last 30 minutes of a shift, the Brain says your 📝 shift report is ready.', () => !LSb('ho_srp_remind_off', false), v => LSs('ho_srp_remind_off', !v)),
    ],
    departures: [
      sel('depSize', 'Card size', 'How big the room cards are.', [['sm', 'Small'], ['md', 'Medium'], ['lg', 'Large'], ['list', 'List']], () => P('depSize') || 'md', v => SP('depSize', v)),
      sel('depSort', 'Sort the rooms by', 'The order the board opens in.', [['smart', 'Smart (overdue first, then time)'], ['room', 'Room number'], ['time', 'Check-out time'], ['status', 'Status'], ['name', 'Name'], ['balance', 'Balance (biggest first)']],
        () => safe(() => localStorage.getItem('ho_dep_sort_def'), '') || 'smart', v => { safe(() => localStorage.setItem('ho_dep_sort_def', v)); safe(() => { depSort = { key: v, dir: 1 }; depRender(); }); }),
      pref('confirmCheckout', 'Ask before checking out', '"Check out room 412?" before a check-out is saved.'),
      HIBAL,
    ],
    inhouse: [HIBAL],
    shifts: [
      pref('autoResetShifts', 'Start each shift with nothing ticked', 'The first time the app opens in a new shift, that shift\'s ticks are cleared (once, for the team).'),
      pref('taskReminders', 'Remind me of tasks', 'A reminder when a timed task is due.'),
      pref('autoTick', 'Tick tasks by themselves', 'When HotelOps sees a task is done (a report loaded, a list sent), it ticks it.'),
    ],
    opera: [
      tog('opAuto', 'Adjust the lists by itself', 'What Opera shows changes Departures, Arrivals and In-House by itself (with Undo).', () => safe(() => hoOpera.cfg().auto, true), v => safe(() => hoOpera.setCfg('auto', v))),
      tog('opReview', 'Hold changes for my OK', 'Changes from Opera wait in a list until you tap OK.', () => safe(() => hoOpera.cfg().review, false), v => safe(() => hoOpera.setCfg('review', v))),
      tog('opAsk', 'Ask me when it is not sure', '"Room 412: checked out or extended?" — here and in the reader inside Opera.', () => !LSb('ho_op_ask_off', false), v => LSs('ho_op_ask_off', !v)),
      tog('opLearn', 'Learn from my Opera use', 'Learns your routines (screen names only) and offers to start one at its usual time.', () => safe(() => hoOpera.learned().on, true), v => safe(() => hoOpera.setLearn(v))),
    ],
    pipeline: [tog('runDock', 'Show running cloud jobs at the bottom', 'The #12 chips of runs still going (🗂 Runs is always there).', () => !LSb('ho_rundock_off', false), v => { LSs('ho_rundock_off', !v); safe(() => hoRuns.paint()); })],
    neorcha: [tog('runDock', 'Show running cloud jobs at the bottom', 'The #12 chips of runs still going (🗂 Runs is always there).', () => !LSb('ho_rundock_off', false), v => { LSs('ho_rundock_off', !v); safe(() => hoRuns.paint()); })],
    settings: [],
  };
  const NO_COMMON = new Set(['home', 'settings']);
  // ── the options every page has ──
  // how a page looks, chosen per page: bigger text, or more on the screen (each person, each page)
  const LOOK_KEY = 'ho_page_look_v1';
  const looks = () => safe(() => JSON.parse(localStorage.getItem(LOOK_KEY) || '{}'), {}) || {};
  function setLook(id, k, v) { const L = looks(); L[id] = Object.assign({}, L[id], { [k]: !!v }); if (k === 'big' && v) L[id].compact = false; if (k === 'compact' && v) L[id].big = false; safe(() => localStorage.setItem(LOOK_KEY, JSON.stringify(L))); applyLooks(); }
  function applyLooks() { const L = looks(); D.querySelectorAll('.panel[id^="panel-"]').forEach(p => { const o = L[p.id.slice(6)] || {}; p.classList.toggle('pgs-big', !!o.big); p.classList.toggle('pgs-compact', !!o.compact); }); }
  function lookOpts(id) {
    if (id === 'settings') return [];
    return [tog('big', 'Larger text on this page', 'Everything on this page a size bigger — easier to read from a distance.', () => !!(looks()[id] || {}).big, v => { setLook(id, 'big', v); }),
      tog('compact', 'More on the screen', 'This page a little smaller, so more fits without scrolling.', () => !!(looks()[id] || {}).compact, v => { setLook(id, 'compact', v); })];
  }
  function common(id) {
    if (NO_COMMON.has(id)) return [];
    const pins = () => safe(() => JSON.parse(localStorage.getItem('ho_nav_pins_v1') || '[]'), []);
    const L = [
      tog('pin', 'Pin to the top of the menu', '⭐ It shows above the groups, one tap away.', () => pins().includes(id), v => { const p = pins().filter(x => x !== id); if (v) p.push(id); safe(() => localStorage.setItem('ho_nav_pins_v1', JSON.stringify(p.slice(-8)))); safe(() => hoNavFinder.refresh()); }),
      tog('start', 'Open this page when HotelOps starts', 'Instead of Home.', () => P('startPage') === id, v => SP('startPage', v ? id : 'home')),
    ];
    if (safe(() => homeTiles().some(t => t.panel === id), false)) L.push(tog('tile', 'Show its tile on Home', 'The tile with its numbers on the Home page.', () => !(P('hiddenTiles') || []).includes(id), v => { const h = (P('hiddenTiles') || []).filter(x => x !== id); if (!v) h.push(id); SP('hiddenTiles', h); safe(() => homeRender()); }));
    L.push(tog('hide', 'Hide from my menu', 'Only from your menu and the phone\'s More (Settings → Pages brings it back).', () => (P('hiddenPages') || []).includes(id),
      v => { const h = (P('hiddenPages') || []).filter(x => x !== id); if (v) { if (!confirm('Hide this page from your menu? Settings → Pages brings it back.')) return false; h.push(id); } SP('hiddenPages', h); }));
    return L;
  }
  const titleOf = id => { const n = D.getElementById('nav-' + id); const t = n ? [...n.childNodes].filter(x => x.nodeType === 3).map(x => x.nodeValue).join(' ').trim() : ''; const h = D.querySelector('#panel-' + id + ' .page-hd h1, #panel-' + id + ' h1'); return t || (h ? h.textContent.trim() : id); };

  function rowHtml(o) {
    const v = o.get();
    const ctl = o.t === 'tog' ? `<button type="button" class="pgs-sw${v ? ' on' : ''}" role="switch" aria-checked="${!!v}" data-pgs="${esc(o.key)}" aria-label="${esc(o.label)}"><i></i></button>`
      : o.t === 'sel' ? `<select class="pgs-sel" data-pgs="${esc(o.key)}" aria-label="${esc(o.label)}">${o.opts.map(([k, l]) => `<option value="${esc(k)}"${k === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`
      : `<span class="pgs-num"><input type="number" min="1" step="50" inputmode="numeric" value="${esc(v)}" data-pgs="${esc(o.key)}" aria-label="${esc(o.label)}">${o.unit ? `<small>${esc(o.unit)}</small>` : ''}</span>`;
    return `<div class="pgs-row"><div class="pgs-t"><b>${esc(o.label)}</b><small>${esc(o.desc)}</small></div>${ctl}</div>`;
  }
  function open(id) {
    id = id || safe(() => D.querySelector('.panel.active').id.replace(/^panel-/, ''), 'home');
    const own = PAGES[id] || [], look = lookOpts(id), com = common(id), all = own.concat(look, com);
    D.getElementById('hoPageSet')?.remove(); css();
    const w = D.createElement('div'); w.id = 'hoPageSet'; w.className = 'pgs';
    w.innerHTML = `<div class="pgs-bg" data-pgs-x="1"></div><section class="pgs-card" role="dialog" aria-modal="true" aria-labelledby="pgsT">
      <header class="pgs-h"><span aria-hidden="true">⚙️</span><div><b id="pgsT">${esc(titleOf(id))} · settings</b><small>Your own choices for this page</small></div><button type="button" class="pgs-x" data-pgs-x="1" aria-label="Close">✕</button></header>
      <div class="pgs-b">${own.length ? `<h4>This page</h4>${own.map(rowHtml).join('')}` : ''}${look.length ? `<h4>How it looks</h4>${look.map(rowHtml).join('')}` : ''}${com.length ? '<h4>In the menu</h4>' + com.map(rowHtml).join('') : ''}
        ${!all.length ? '<p class="pgs-empty">Nothing to set here yet.</p>' : ''}
        <button type="button" class="pgs-more" data-pgs-more="1">All settings (text size, dark mode, language, sounds…) ›</button></div></section>`;
    D.body.appendChild(w);
    const find = k => all.find(o => o.key === k);
    w.addEventListener('click', e => {
      if (e.target.closest('[data-pgs-x]')) { w.remove(); return; }
      if (e.target.closest('[data-pgs-more]')) { w.remove(); safe(() => showPanel('settings')); return; }
      const b = e.target.closest('button.pgs-sw'); if (!b) return;
      const o = find(b.dataset.pgs); if (!o) return;
      const nv = !o.get(); if (o.set(nv) === false) return;
      w.querySelectorAll('button.pgs-sw').forEach(x => { const q = find(x.dataset.pgs); if (q) { x.classList.toggle('on', !!q.get()); x.setAttribute('aria-checked', String(!!q.get())); } }); toast('Saved', 'ok');   // one switch can turn another off (bigger text / more on the screen)
    });
    w.addEventListener('change', e => {
      const t = e.target.closest('[data-pgs]'); if (!t || t.tagName === 'BUTTON') return;
      const o = find(t.dataset.pgs); if (!o) return;
      const r = o.set(t.value); if (r === false) { toast('That amount is not a number', 'err'); t.value = o.get(); return; } toast('Saved', 'ok');
    });
    D.addEventListener('keydown', function k(e) { if (e.key === 'Escape') { w.remove(); D.removeEventListener('keydown', k); } });
  }
  // the ⚙️ in every page's header
  function mount() {
    D.querySelectorAll('.panel[id^="panel-"]').forEach(p => {
      const id = p.id.slice(6); if (id === 'settings' || p.querySelector(':scope [data-pgs-open]')) return;
      let host = p.querySelector('.page-hd-actions');
      const hd = p.querySelector('.page-hd');
      if (!host && hd) { host = D.createElement('div'); host.className = 'page-hd-actions'; hd.appendChild(host); }
      const b = D.createElement('button'); b.type = 'button'; b.className = 'btn pgs-open'; b.dataset.pgsOpen = id; b.title = 'Settings for this page'; b.setAttribute('aria-label', 'Settings for this page'); b.textContent = '⚙️';
      b.onclick = () => open(id);
      if (host) host.appendChild(b); else { b.classList.add('pgs-float'); p.style.position = p.style.position || 'relative'; p.insertBefore(b, p.firstChild); }
    });
  }
  // the board opens in the sort you chose
  function applyDepSort() { const v = safe(() => localStorage.getItem('ho_dep_sort_def'), ''); if (v && v !== 'smart') safe(() => { depSort = { key: v, dir: 1 }; }); }
  function css() {
    if (D.getElementById('hoPageSetCss')) return;
    const s = D.createElement('style'); s.id = 'hoPageSetCss';
    s.textContent = `.pgs{position:fixed;inset:0;z-index:10035;display:flex;align-items:center;justify-content:center}.pgs-bg{position:absolute;inset:0;background:rgba(0,0,0,.5)}
.pgs-card{position:relative;width:min(520px,calc(100vw - 24px));max-height:calc(100dvh - 32px);display:flex;flex-direction:column;background:var(--card2,#111827);color:var(--text);border:1px solid var(--border2);border-radius:var(--r3,18px);box-shadow:0 30px 70px -20px rgba(0,0,0,.6);overflow:hidden}
.pgs-h{display:flex;gap:12px;align-items:flex-start;padding:16px;border-bottom:1px solid var(--border)}.pgs-h>span{font-size:22px}.pgs-h div{flex:1;display:flex;flex-direction:column;gap:3px}.pgs-h b{font-size:1.05rem}.pgs-h small{color:var(--text2);font-size:.78rem}
.pgs-x{width:38px;height:38px;border-radius:50%;border:1px solid var(--border2);background:transparent;color:var(--text);cursor:pointer}
.pgs-b{overflow:auto;padding:6px 16px calc(16px + env(safe-area-inset-bottom))}.pgs-b h4{margin:14px 0 6px;font:800 .7rem var(--font);letter-spacing:.1em;text-transform:uppercase;color:var(--text3)}
.pgs-row{display:flex;align-items:center;gap:14px;padding:11px 0;border-bottom:1px solid var(--border)}.pgs-row:last-of-type{border-bottom:0}
.pgs-t{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}.pgs-t b{font-size:.92rem}.pgs-t small{color:var(--text2);font-size:.78rem;line-height:1.4}
.pgs-sw{flex:none;position:relative;width:46px;height:28px;border-radius:99px;border:0;cursor:pointer;background:color-mix(in srgb,var(--text) 22%,transparent);transition:background .2s}
.pgs-sw i{position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:transform .2s}
.pgs-sw.on{background:var(--accent)}.pgs-sw.on i{transform:translateX(18px)}
.pgs-sel{flex:none;display:flex;align-items:center;max-width:52%;height:38px;border-radius:10px;padding:0 8px;font:500 13px var(--font);background:var(--bg2);color:var(--text);border:1px solid var(--border2)}
.pgs-num{flex:none;display:inline-flex;align-items:center;gap:6px}.pgs-num input{width:92px;height:38px;border-radius:10px;padding:0 10px;font:600 14px var(--font);background:var(--bg2);color:var(--text);border:1px solid var(--border2)}.pgs-num small{color:var(--text2)}
.pgs-empty{color:var(--text2);padding:14px 0}.pgs-more{display:block;width:100%;margin-top:14px;padding:12px;border-radius:12px;border:1px dashed var(--border2);background:transparent;color:var(--text2);font:600 .85rem var(--font);cursor:pointer;text-align:left}.pgs-more:hover{color:var(--text);border-color:var(--accent)}
.panel.pgs-big{zoom:1.12}.panel.pgs-compact{zoom:.9}
.pgs-open{min-width:40px;justify-content:center}.pgs-float{position:absolute;top:0;right:0;z-index:5}
@media (max-width:600px){.pgs{align-items:flex-end}.pgs-card{width:100vw;border-radius:20px 20px 0 0;max-height:92dvh}.pgs-sel{max-width:50%;font-size:16px}.pgs-num input{font-size:16px}}`;
    D.head.appendChild(s);
  }
  function start() { mount(); applyDepSort(); applyLooks(); setTimeout(mount, 3000); }   // pages that build their header later get theirs too
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', () => setTimeout(start, 400)); else setTimeout(start, 400);
  W.hoPageSettings = { open, mount, _pages: PAGES };
})();
