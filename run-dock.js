// ═══════════════════════════════════════════════════════════
//  run-dock.js — the cloud computer runs (Guest enrolment, Neorcha cards): never lost when their window is closed
//  · ✕ on a run window now MINIMISES it: a chip stays at the bottom-left — "#12 ✍️ Guest enrolment · Ibis Styles · 5/12" —
//    tap it and the live window opens again, right where the run is.
//  · Every run gets a number (#1, #2 … per hotel, shared by the team) and is kept in the 🗂 Runs list with all its info:
//    what it ran, for which hotel / Neorcha account, who started it, when, how long, how far, the result and its GitHub link.
//  Stored in the hotel's database at cloudRuns/<tag> (+ cloudRunSeq for the numbers). Never a guest name or e-mail.
// ═══════════════════════════════════════════════════════════
(function () {
  'use strict';
  const W = window, D = document;
  const KINDS = {
    enrol:   { ic: '✍️', name: 'Guest enrolment', live: 'enrollLive', win: 'gpAccorRunModal', open: () => { if (typeof W.gpAccorRunWin === 'function') W.gpAccorRunWin(true); else if (typeof gpAccorRunWin === 'function') gpAccorRunWin(true); } },
    neorcha: { ic: '🪪', name: 'Neorcha cards', live: 'neorchaLive', win: 'nxRun', open: () => { if (W.hoNxRunOpen) W.hoNxRunOpen(); } },
  };
  const DISMISS_KEY = 'ho_run_dock_hide_v1';
  let RUNS = {}, LIVE = {}, timer = 0;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clean = (s, n) => String(s == null ? '' : s).replace(/\S+@\S+/g, '•@•').replace(/\s+/g, ' ').trim().slice(0, n || 60);
  const hidden = () => { try { return JSON.parse(localStorage.getItem(DISMISS_KEY) || '{}') || {}; } catch (_) { return {}; } };
  const hide = tag => { try { const h = hidden(); h[tag] = Date.now(); Object.keys(h).forEach(k => { if (Date.now() - h[k] > 7 * 864e5) delete h[k]; }); localStorage.setItem(DISMISS_KEY, JSON.stringify(h)); } catch (_) {} };
  const unhide = tag => { try { const h = hidden(); delete h[tag]; localStorage.setItem(DISMISS_KEY, JSON.stringify(h)); } catch (_) {} };
  const winOpen = kind => { const w = D.getElementById(KINDS[kind].win); return !!w && w.classList.contains('on'); };
  const dur = s => { s = Math.max(0, Math.round(s)); return s >= 3600 ? Math.floor(s / 3600) + ' h ' + Math.floor(s % 3600 / 60) + ' min' : Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const when = t => { const d = new Date(+t); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); };
  const me = () => { try { return (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || ''; } catch (_) { return ''; } };
  const dbOk = () => typeof fbSet === 'function' && typeof _ref !== 'undefined' && !!_ref;

  /** a run's live report → the fields kept for it (pure): state, how far, the result — no guest data */
  function fromLive(kind, v) {
    if (!v) return {};
    const o = { at: +v.at || Date.now(), state: v.state === 'done' ? 'done' : v.state === 'error' ? 'error' : v.state === 'stopped' || v.step === 'stopped' ? 'stopped' : 'run', note: clean(v.note, 140) };
    if (kind === 'enrol') { o.n = +v.n || 0; o.done = Math.min(+v.done || 0, o.n || Infinity); if (v.tally) o.tally = { enrolled: +v.tally.enrolled || 0, already: +v.tally.already || 0, skipped: +v.tally.skipped || 0, errors: +v.tally.errors || 0 }; }
    else { o.n = +v.n || 0; o.prog = +v.prog || 0; o.step = clean(v.step, 20); }
    if (v.run && /^https:\/\/github\.com\//.test(v.run)) o.url = String(v.run).slice(0, 200);
    if (v.test) o.test = true;
    return o;
  }
  /** the chip's words (pure) */
  function chipText(r) {
    const K = KINDS[r.kind] || { ic: '☁️', name: 'Cloud run' };
    const far = r.kind === 'enrol' ? (r.n ? (r.done || 0) + '/' + r.n : '') : (r.n ? r.n + ' cards' : '');
    const st = { run: '⏳', done: '✅', error: '⛔', stopped: '⏹' }[r.state] || '⏳';
    return { title: '#' + (r.no || '?') + ' ' + K.ic + ' ' + K.name + (r.test ? ' · 🧪 test' : ''), sub: [r.hotel, far].filter(Boolean).join(' · '), st };
  }

  /** the next run number, from the hotel's counter in one step on the server (two devices never get the same number) */
  async function nextNo() {
    try {
      if (dbOk() && _ref.child) { const r = await _ref.child('cloudRunSeq').transaction(n => (+n || 0) + 1); const v = r && r.snapshot && (typeof r.snapshot.val === 'function' ? r.snapshot.val() : r.snapshot); if (+v > 0) return +v; }
      if (dbOk()) { const n = (+(await fbGet('cloudRunSeq')) || 0) + 1; await fbSet('cloudRunSeq', n); return n; }
    } catch (_) {}
    return 0;
  }
  /** a run nobody registered (the nightly schedule, the duty PC, another device, an older HotelOps): recorded the first time
   *  its live report is seen, under a key every device works out the same way, so it is one run with one number */
  const liveKey = (kind, v) => v.tag ? String(v.tag).replace(/[.#$\[\]\/]/g, '_').slice(0, 60) : kind + '_' + Math.round(+v.started || +v.at || 0).toString(36);
  const ADOPT = {};
  async function adopt(kind, v) {
    const key = liveKey(kind, v); if (RUNS[key] || ADOPT[key]) return;
    ADOPT[key] = 1;
    await new Promise(r => setTimeout(r, 400 + Math.random() * 2500));   // another device may record it first
    if (RUNS[key]) return;
    const hn = (D.getElementById('hotelName') || {}).textContent || '';
    const rec = Object.assign({ tag: key, kind, no: 0, hotel: clean(kind === 'neorcha' && W.__hoNxHotel ? W.__hoNxHotel() : hn, 50), account: '', from: clean(v.from, 10), to: clean(v.to, 10),
      by: v.tag ? '' : 'Nightly schedule', started: +v.started || +v.at || Date.now(), auto: true }, fromLive(kind, v));
    let created = false;
    try {
      if (dbOk() && _ref.child) { const r = await _ref.child('cloudRuns/' + key).transaction(cur => (cur ? undefined : rec)); created = !!(r && r.committed); }
      else created = true;
    } catch (_) { created = true; }
    if (!created) return;
    rec.no = await nextNo() || Object.keys(RUNS).length + 1;
    RUNS[key] = rec; paint();
    try { if (dbOk()) fbUpdate('cloudRuns/' + key, { no: rec.no }); } catch (_) {}
  }
  async function start(kind, tag, info) {
    if (!tag || !KINDS[kind]) return;
    ADOPT[tag] = 1;   // registered here: the live report that arrives meanwhile does not record it a second time
    info = info || {};
    let no = 0;
    no = await nextNo();
    if (!no) no = Object.keys(RUNS).length + 1;
    const rec = { tag, kind, no, hotel: clean(info.hotel, 50), account: clean(info.account, 30), from: clean(info.from, 10), to: clean(info.to, 10),
      n: +info.n || 0, test: !!info.test, how: clean(info.how, 20), by: clean(me(), 40), started: Date.now(), at: Date.now(), state: 'run', note: 'Starting…' };
    RUNS[tag] = rec; paint();
    try { if (dbOk()) await fbSet('cloudRuns/' + tag, rec); } catch (_) {}
    prune();
  }
  /** the window was closed: say once where it went */
  function minimized(kind) {
    const r = latest(kind);
    if (r && typeof showToast === 'function') showToast('Minimised — run #' + (r.no || '?') + ' keeps going. Tap its chip at the bottom-left to open it again.', 'ok');
    paint();
  }
  /** ✕: closed for good — the window and its chip go; the run keeps going and stays in 🗂 Runs */
  function closed(kind) {
    const r = latest(kind); if (r) hide(r.tag);
    if (r && typeof showToast === 'function') showToast('Closed — run #' + (r.no || '?') + (r.state === 'run' ? ' keeps going' : '') + '. It stays in 🗂 Runs at the bottom-left.', 'ok');
    paint();
  }
  const latest = kind => Object.values(RUNS).filter(r => r.kind === kind).sort((a, b) => b.started - a.started)[0] || null;
  /** "Run #12 · Ibis Styles Dubai" for the run window's header */
  function label(kind) { const r = latest(kind); return r ? 'Run #' + (r.no || '?') + (r.hotel ? ' · ' + r.hotel : '') : ''; }

  /** a live report arrived: fold it into its run (written only when something that matters changed) */
  function onLive(kind, v) {
    LIVE[kind] = v || null;
    if (!v) return paint();
    const r = RUNS[liveKey(kind, v)] || (v.tag && RUNS[v.tag]) || null;
    if (!r && Date.now() - (+v.at || 0) < 24 * 3600e3) { adopt(kind, v); return paint(); }
    if (r) {
      const f = fromLive(kind, v), key = o => [o.state, o.done, o.n, o.prog, o.url, o.started, JSON.stringify(o.tally || '')].join('|');
      const changed = key(f) !== key(r);
      if (+v.started > 0 && +v.started < r.started && r.started - v.started < 6 * 3600e3) f.started = +v.started;   // the run's real start (it can be a little before this record)
      Object.assign(r, f);
      if (changed && dbOk()) try { fbUpdate('cloudRuns/' + r.tag, f); } catch (_) {}
    }
    paint();
  }
  function prune() {
    const all = Object.values(RUNS).sort((a, b) => b.started - a.started), cut = Date.now() - 45 * 864e5;
    all.forEach((r, i) => { if (i >= 60 || r.started < cut) { delete RUNS[r.tag]; try { if (dbOk()) fbSet('cloudRuns/' + r.tag, null); } catch (_) {} } });
  }

  // ── the dock ──
  function chips() {
    const h = hidden(), now = Date.now();
    return Object.values(RUNS).filter(r => !winOpen(r.kind) && !h[r.tag] && (r.state === 'run' ? now - (r.at || r.started) < 3 * 3600e3 : now - (r.at || r.started) < 45 * 60e3))
      .sort((a, b) => b.started - a.started).slice(0, 3);
  }
  function paint() {
    let dock = D.getElementById('hoRunDock');
    if (!dock) { if (!D.body) return; dock = D.createElement('div'); dock.id = 'hoRunDock'; dock.className = 'hrd'; dock.setAttribute('aria-live', 'polite'); D.body.appendChild(dock);
      dock.addEventListener('click', e => {
        const x = e.target.closest('[data-hrd-x]'); if (x) { e.stopPropagation(); hide(x.dataset.hrdX); paint(); return; }
        const c = e.target.closest('[data-hrd-open]'); if (c) { const r = RUNS[c.dataset.hrdOpen]; if (r) openRun(r); return; }
        if (e.target.closest('[data-hrd-list]')) list();
      }); }
    const L = chips(), recent = Object.keys(RUNS).length > 0;   // the 🗂 Runs history stays one tap away
    if (!L.length && !recent) { dock.innerHTML = ''; dock.hidden = true; return; }
    dock.hidden = false;
    dock.innerHTML = L.map(r => {
      const t = chipText(r), sec = ((r.state === 'run' ? Date.now() : r.at || Date.now()) - r.started) / 1000;
      const pct = r.state === 'done' ? 100 : r.kind === 'enrol' ? (r.n ? Math.round((r.done || 0) / r.n * 100) : 5) : Math.max(5, Math.min(97, r.prog || 10));
      return `<div class="hrd-chip ${esc(r.state)}" role="button" tabindex="0" data-hrd-open="${esc(r.tag)}" title="Open the live window of run #${esc(r.no)}">
        <span class="hrd-st">${t.st}</span><span class="hrd-t"><b>${esc(t.title)}</b><small>${esc(t.sub || r.note || '')}${t.sub ? ' · ' : ''}${dur(sec)}</small></span>
        <button type="button" class="hrd-x" data-hrd-x="${esc(r.tag)}" aria-label="Close this chip" title="Close${r.state === 'run' ? ' — the run keeps going;' : ' —'} it stays in 🗂 Runs">×</button>
        <i class="hrd-bar" style="width:${pct}%"></i></div>`;
    }).join('') + `<button type="button" class="hrd-all" data-hrd-list="1" title="All cloud runs, numbered, with their hotel and results">🗂 Runs</button>`;
    clearInterval(timer); if (L.some(r => r.state === 'run')) timer = setInterval(paint, 1000);
  }
  function openRun(r) {
    const cur = latest(r.kind);
    if (cur && cur.tag === r.tag) { KINDS[r.kind].open(); setTimeout(paint, 50); return; }
    list(r.tag);   // an older run: its details (the live window only follows the newest of its kind)
  }
  // ── 🗂 Runs: every run with its number, hotel and result ──
  function list(focus) {
    let w = D.getElementById('hoRunList');
    if (!w) { w = D.createElement('div'); w.id = 'hoRunList'; w.className = 'hrl'; D.body.appendChild(w);
      w.addEventListener('click', e => {
        if (e.target.closest('[data-hrl-x]')) { w.classList.remove('on'); return; }
        const o = e.target.closest('[data-hrl-open]'); if (o) { const r = RUNS[o.dataset.hrlOpen]; if (r) { unhide(r.tag); w.classList.remove('on'); KINDS[r.kind].open(); setTimeout(paint, 50); } }
      });
      D.addEventListener('keydown', e => { if (e.key === 'Escape') w.classList.remove('on'); }); }
    const all = Object.values(RUNS).sort((a, b) => b.started - a.started);
    const res = r => r.kind === 'enrol' ? (r.tally ? `✅ ${r.tally.enrolled} ${r.test ? 'checked' : 'enrolled'} · 👤 ${r.tally.already} already · ⏭ ${r.tally.skipped} skipped · ⚠️ ${r.tally.errors} errors` : r.n ? `${r.done || 0} of ${r.n} guests` : '')
      : (r.n ? `🪪 ${r.n} card${r.n === 1 ? '' : 's'} read` : '') + (r.from ? ` · arrivals ${r.from}${r.to && r.to !== r.from ? ' → ' + r.to : ''}` : '');
    w.innerHTML = `<div class="hrl-bg" data-hrl-x="1"></div><section class="hrl-card" role="dialog" aria-modal="true" aria-label="Cloud runs">
      <header class="hrl-h"><span class="hrl-ic">🗂</span><div><b>Cloud runs</b><small>Every run, numbered — closed windows are never lost</small></div><button type="button" class="hrl-close" data-hrl-x="1" aria-label="Close">✕</button></header>
      <div class="hrl-b">${all.length ? all.map(r => { const K = KINDS[r.kind] || { ic: '☁️', name: 'Cloud run' }, isNew = latest(r.kind) === r, sec = ((r.state === 'run' ? Date.now() : r.at || r.started) - r.started) / 1000;
        return `<article class="hrl-run ${esc(r.state)}${focus === r.tag ? ' focus' : ''}">
          <div class="hrl-no">#${esc(r.no || '?')}</div>
          <div class="hrl-main"><b>${K.ic} ${esc(K.name)}${r.test ? ' <em>🧪 test</em>' : ''}</b>
            <span class="hrl-meta">🏨 ${esc(r.hotel || '—')}${r.account ? ' · ' + esc(r.account) : ''} · 👤 ${esc(r.by || '—')}${r.how ? ' · ' + esc(r.how) : ''}</span>
            <span class="hrl-meta">🕒 ${esc(when(r.started))} · ⏱ ${esc(dur(sec))} · ${{ run: '⏳ running', done: '✅ finished', error: '⛔ stopped with an error', stopped: '⏹ stopped by you' }[r.state] || ''}</span>
            ${res(r) ? `<span class="hrl-res">${esc(res(r))}</span>` : ''}${r.note ? `<span class="hrl-note">${esc(r.note)}</span>` : ''}
            <span class="hrl-act">${isNew ? `<button type="button" class="btn sm${r.state === 'run' ? ' gold' : ''}" data-hrl-open="${esc(r.tag)}">📡 Open live window</button>` : ''}${r.url ? `<a class="btn sm" href="${esc(r.url)}" target="_blank" rel="noopener">GitHub ↗</a>` : ''}</span></div></article>`; }).join('')
        : '<div class="hrl-empty">No cloud runs yet. Start one from Guest enrolment (☁️ Enroll) or Neorcha (☁️ Run in the cloud) — each gets a number here.</div>'}</div></section>`;
    w.classList.add('on');
    const f = w.querySelector('.hrl-run.focus'); if (f) f.scrollIntoView({ block: 'center' });
  }

  function css() {
    if (D.getElementById('hoRunDockCss')) return;
    const s = D.createElement('style'); s.id = 'hoRunDockCss';
    s.textContent = `.hrd{position:fixed;left:16px;bottom:16px;z-index:9000;display:flex;flex-direction:column;align-items:flex-start;gap:8px;max-width:min(340px,calc(100vw - 110px));pointer-events:none}
.hrd[hidden]{display:none}.hrd>*{pointer-events:auto}
.hrd-chip{position:relative;overflow:hidden;display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;padding:9px 12px 11px;border-radius:14px;cursor:pointer;background:var(--card2,#1e2533);color:var(--text,#fff);border:1px solid var(--border2,rgba(255,255,255,.18));box-shadow:0 12px 30px -12px rgba(0,0,0,.5);animation:hrdIn .3s ease}
.hrd-chip:hover{border-color:var(--accent)}.hrd-chip:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.hrd-st{font-size:18px;flex:none}.hrd-chip.run .hrd-st{animation:hrdPulse 1.6s ease-in-out infinite}
.hrd-t{display:flex;flex-direction:column;min-width:0;flex:1}.hrd-t b{font-size:.84rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.hrd-t small{font-size:.72rem;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hrd-x{flex:none;width:26px;height:26px;border-radius:50%;border:0;background:transparent;color:var(--text2);font-size:18px;cursor:pointer}.hrd-x:hover{background:var(--border)}
.hrd-bar{position:absolute;left:0;bottom:0;height:3px;background:var(--accent);transition:width .5s ease}.hrd-chip.done .hrd-bar{background:var(--green,#22c55e)}.hrd-chip.error .hrd-bar{background:var(--red,#ef4444)}
.hrd-all{border:1px solid var(--border2);background:var(--card2,#1e2533);color:var(--text);border-radius:99px;padding:6px 12px;font:600 .74rem var(--font);cursor:pointer;box-shadow:0 8px 20px -10px rgba(0,0,0,.45)}.hrd-all:hover{border-color:var(--accent)}
@keyframes hrdIn{from{opacity:0;transform:translateY(10px)}}@keyframes hrdPulse{50%{opacity:.45}}
@media (min-width:769px){.hrd{left:calc(var(--sidenav-w,244px) + 16px)}body:has(.sidenav.collapsed) .hrd{left:16px}}
@media (max-width:768px){.hrd{left:10px;bottom:calc(86px + env(safe-area-inset-bottom));max-width:calc(100vw - 96px)}}
.hrl{position:fixed;inset:0;z-index:10050;display:none;align-items:center;justify-content:center}.hrl.on{display:flex}
.hrl-bg{position:absolute;inset:0;background:rgba(0,0,0,.5)}
.hrl-card{position:relative;width:min(560px,calc(100vw - 24px));max-height:calc(100dvh - 32px);display:flex;flex-direction:column;background:var(--card2,#111827);color:var(--text);border:1px solid var(--border2);border-radius:var(--r3,18px);box-shadow:0 30px 70px -20px rgba(0,0,0,.6);overflow:hidden}
.hrl-h{position:sticky;top:0;display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid var(--border);background:inherit}.hrl-h div{flex:1;display:flex;flex-direction:column}.hrl-h small{color:var(--text2);font-size:.76rem}
.hrl-ic{font-size:22px}.hrl-close{width:40px;height:40px;border-radius:50%;border:1px solid var(--border2);background:transparent;color:var(--text);font-size:16px;cursor:pointer}
.hrl-b{overflow:auto;padding:12px 14px calc(14px + env(safe-area-inset-bottom));display:grid;gap:10px}
.hrl-run{display:grid;grid-template-columns:54px 1fr;gap:12px;padding:12px;border:1px solid var(--border);border-radius:var(--r2,12px);background:var(--card)}
.hrl-run.focus{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-bg)}
.hrl-no{font:800 1.15rem var(--font);color:var(--accent);text-align:center;padding-top:2px}
.hrl-main{display:flex;flex-direction:column;gap:3px;min-width:0}.hrl-main>b{font-size:.92rem}.hrl-main em{font-style:normal;font-size:.72rem;color:var(--amber,#f59e0b)}
.hrl-meta{font-size:.76rem;color:var(--text2)}.hrl-res{font-size:.8rem;font-weight:600}.hrl-note{font-size:.76rem;color:var(--text3)}
.hrl-run.error .hrl-no{color:var(--red,#ef4444)}.hrl-run.done .hrl-no{color:var(--green,#22c55e)}
.hrl-act{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}.hrl-act:empty{display:none}
.hrl-empty{padding:24px;text-align:center;color:var(--text2)}
@media (max-width:600px){.hrl{align-items:flex-end}.hrl-card{width:100vw;border-radius:20px 20px 0 0;max-height:90dvh}}
@media (prefers-reduced-motion:reduce){.hrd-chip,.hrd-chip.run .hrd-st{animation:none}}`;
    D.head.appendChild(s);
  }

  (function listen(tries) {
    tries = +tries || 0;
    if ((typeof fbListen !== 'function' || typeof _ref === 'undefined' || !_ref) && tries < 400) return setTimeout(() => listen(tries + 1), 1500);
    if (typeof fbListen !== 'function') return;
    fbListen('cloudRuns', v => {
      const next = {};
      Object.entries(v || {}).forEach(([k, r]) => { if (r && typeof r === 'object' && KINDS[r.kind]) next[k] = Object.assign({}, r, { tag: k }); });
      Object.values(RUNS).forEach(r => { if (!next[r.tag] && Date.now() - r.started < 60000) next[r.tag] = r; });   // just started here, not back from the database yet
      RUNS = next; paint();
    });
    Object.keys(KINDS).forEach(k => fbListen(KINDS[k].live, v => onLive(k, v)));
  })();
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', () => { css(); paint(); }); else { css(); paint(); }
  W.hoRuns = { start, minimized, closed, label, list, paint, _pure: { fromLive, chipText, liveKey } };
})();
