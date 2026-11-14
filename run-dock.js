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
    ingauge: { ic: '↗', name: 'IN-Gauge audit', live: 'ingauge/live', win: 'igRunWindow', open: () => W.InGaugeWorkspace?.openRun() },
    manual: { ic: '↗', name: 'Manual sales', live: 'manualSalesLive', win: 'msuRunWindow', open: () => { if (W.ManualSalesAutomation) W.ManualSalesAutomation.openRun(); } },
    neorcha: { ic: '🪪', name: 'Neorcha cards', live: 'neorchaLive', win: 'nxRun', open: () => { if (W.hoNxRunOpen) W.hoNxRunOpen(); } },
  };
  const DISMISS_KEY = 'ho_run_dock_hide_v1';
  let RUNS = {}, LIVE = {}, timer = 0, historyTimer = 0, historyDeadline = Infinity, returnFocus = null, oldOverflow = '';
  const FILTER = { view: 'history', from: '', to: '', kind: '', outcome: '', q: '', limit: 30 };
  const terminal = r => ['done','error','stopped'].includes(r.state);
  const day = t => { const d = new Date(+t + 4*3600e3); return +t > 0 && Number.isFinite(d.getTime()) ? d.toISOString().slice(0,10) : ''; };
  const status = (r, now = Date.now()) => { if (terminal(r)) return r.state; const at = +r.at || +r.started || 0; return r.workflowEnded || !Number.isFinite(at) || at <= 0 || at > now + 300000 || now - at > 20 * 60e3 ? 'unconfirmed' : 'run'; };
  const active = r => status(r) === 'run';
  const operation = r => r.kind === 'ingauge' && (r.mode || r.how) === 'discover' ? 'IN-Gauge connection' : r.kind === 'ingauge' && (r.mode || r.how) === 'snapshot' ? 'IN-Gauge records' : (KINDS[r.kind] || {}).name || 'Cloud run';
  function matches(r, f) { const st = status(r), d = day(r.started || r.at || 0); return (f.view === 'all' || (f.view === 'active' ? st === 'run' : st !== 'run')) && (!f.from || d >= f.from) && (!f.to || d <= f.to) && (!f.kind || r.kind === f.kind) && (!f.outcome || st === f.outcome) && (!f.q || [r.no,r.hotel,r.account,r.by,operation(r)].join(' ').toLowerCase().includes(String(f.q).replace(/^#/, '').trim().toLowerCase())); }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clean = (s, n) => String(s == null ? '' : s).replace(/\S+@\S+/g, '•@•').replace(/\s+/g, ' ').trim().slice(0, n || 60);
  const hidden = () => { try { return JSON.parse(localStorage.getItem(DISMISS_KEY) || '{}') || {}; } catch (_) { return {}; } };
  const hide = tag => { try { const h = hidden(); h[tag] = Date.now(); Object.keys(h).forEach(k => { if (Date.now() - h[k] > 7 * 864e5) delete h[k]; }); localStorage.setItem(DISMISS_KEY, JSON.stringify(h)); } catch (_) {} };
  const unhide = tag => { try { const h = hidden(); delete h[tag]; localStorage.setItem(DISMISS_KEY, JSON.stringify(h)); } catch (_) {} };
  const winOpen = kind => { const w = D.getElementById(KINDS[kind].win); return !!w && (kind==='ingauge'?!w.hidden:w.classList.contains('on')); };
  const dur = s => { s = Math.max(0, Math.round(s)); return s >= 3600 ? Math.floor(s / 3600) + ' h ' + Math.floor(s % 3600 / 60) + ' min' : Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const when = t => { if (!day(t)) return 'Not recorded'; const d = new Date(+t); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai' }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' }); };
  const me = () => { try { return (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || ''; } catch (_) { return ''; } };
  const dbOk = () => typeof fbSet === 'function' && typeof _ref !== 'undefined' && !!_ref;

  /** a run's live report → the fields kept for it (pure): state, how far, the result — no guest data */
  function fromLive(kind, v) {
    if (!v) return {};
    const o = { at: +v.at || +v.started || 0, state: v.state === 'done' ? 'done' : v.state === 'error' ? 'error' : v.state === 'stopped' || v.step === 'stopped' ? 'stopped' : 'run', note: clean(v.note, 140) };
    if (['manual','ingauge'].includes(kind)) { o.n = +v.n || 0; o.done = +v.done || 0; o.tally = v.tally || {}; }
    else if (kind === 'enrol') { o.n = +v.n || 0; o.done = Math.min(+v.done || 0, o.n || Infinity); if (v.tally) o.tally = { enrolled: +v.tally.enrolled || 0, already: +v.tally.already || 0, skipped: +v.tally.skipped || 0, errors: +v.tally.errors || 0 }; }
    else { o.n = +v.n || 0; o.prog = +v.prog || 0; o.step = clean(v.step, 20); }
    if (v.run && /^https:\/\/github\.com\//.test(v.run)) o.url = String(v.run).slice(0, 200);
    if (v.test) o.test = true;
    if (v.mode) o.mode = clean(v.mode, 20);
    if (terminal(o)) o.finishedAt = +v.finishedAt || +v.at || 0;
    return o;
  }
  /** the chip's words (pure) */
  function chipText(r) {
    const K = KINDS[r.kind] || { ic: '☁️', name: 'Cloud run' };
    const far = ['manual','ingauge'].includes(r.kind) ? `${r.done || 0}/${r.n || 0} sales` : r.kind === 'enrol' ? (r.n ? (r.done || 0) + '/' + r.n : '') : (r.n ? r.n + ' cards' : '');
    const st = { run: '⏳', done: '✅', error: '⛔', stopped: '⏹' }[r.state] || '⏳';
    return { title: '#' + (r.no || '?') + ' ' + K.ic + ' ' + operation(r), sub: [r.hotel, far].filter(Boolean).join(' · '), st };
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
    // History is retained; date filters and pagination keep the view small.
  }
  /** the window was closed: say once where it went */
  function minimized(kind) {
    const r = latest(kind);
    if (r && typeof showToast === 'function') showToast(r.state === 'run' ? 'Minimised — run #' + (r.no || '?') + ' keeps going. Tap its chip at the bottom-left to open it again.' : 'Run #' + (r.no || '?') + ' has ended. Its result is saved in Run history.', 'ok');
    paint();
  }
  /** ✕: closed for good — the window and its chip go; the run keeps going and stays in 🗂 Runs */
  function closed(kind) {
    const r = latest(kind); if (r) hide(r.tag);
    if (r && typeof showToast === 'function') showToast('Closed — run #' + (r.no || '?') + (r.state === 'run' ? ' keeps going' : ' has ended') + '. It stays in 🗂 Run history at the bottom-left.', 'ok');
    paint();
  }
  const latest = kind => Object.values(RUNS).filter(r => r.kind === kind).sort((a, b) => b.started - a.started)[0] || null;
  /** "Run #12 · Ibis Styles Dubai" for the run window's header */
  function label(kind, tag) { const r = tag ? RUNS[tag] : latest(kind); return r ? (r.no ? 'Run #' + r.no : 'Cloud run') + (r.hotel ? ' · ' + r.hotel : '') : ''; }

  /** a live report arrived: fold it into its run (written only when something that matters changed) */
  function onLive(kind, v) {
    LIVE[kind] = v || null;
    if (!v) return paint();
    const r = RUNS[liveKey(kind, v)] || (v.tag && RUNS[v.tag]) || null;
    if (!r && Date.now() - (+v.at || 0) < 24 * 3600e3) { adopt(kind, v); return paint(); }
    if (r) {
      const f = fromLive(kind, v);
      if (kind === 'enrol') {
        // Older cloud workers publish zero/missing metrics during a page reload.
        f.done = Math.max(f.done || 0, r.done || 0);
        if (!f.n && r.n) f.n = r.n;
        const sum = t => Object.values(t || {}).reduce((n,v) => n + (+v || 0), 0);
        if (!f.tally || sum(f.tally) < sum(r.tally)) f.tally = r.tally;
        if (!f.tally) delete f.tally;
      }
      // A delayed progress report must never turn a finished history record back into a live run.
      if (+v.at < +r.at || (terminal(r) && f.state === 'run')) return paint();
      const key = o => [o.state, o.done, o.n, o.prog, o.url, o.started, JSON.stringify(o.tally || '')].join('|');
      const changed = key(f) !== key(r);
      if (+v.started > 0 && +v.started < r.started && r.started - v.started < 6 * 3600e3) f.started = +v.started;   // the run's real start (it can be a little before this record)
      Object.assign(r, f);
      if (changed && dbOk()) try { fbUpdate('cloudRuns/' + r.tag, f); } catch (_) {}
    }
    paint();
  }
  // ── the dock ──
  function chips() {
    const h = hidden(), now = Date.now();
    return Object.values(RUNS).filter(r => active(r) && !winOpen(r.kind) && !h[r.tag] && now - (r.at || r.started) < 3 * 3600e3)
      .sort((a, b) => b.started - a.started).slice(0, 3);
  }
  function paint() {
    renderHistory();
    clearInterval(timer); timer = 0;
    let dock = D.getElementById('hoRunDock');
    if (!dock) { if (!D.body) return; dock = D.createElement('div'); dock.id = 'hoRunDock'; dock.className = 'hrd'; dock.setAttribute('aria-live', 'polite'); D.body.appendChild(dock);
      dock.addEventListener('click', e => {
        const x = e.target.closest('[data-hrd-x]'); if (x) { e.stopPropagation(); hide(x.dataset.hrdX); paint(); return; }
        const c = e.target.closest('[data-hrd-open]'); if (c) { const r = RUNS[c.dataset.hrdOpen]; if (r) openRun(r); return; }
        if (e.target.closest('[data-hrd-list]')) list();
      }); }
    let L = chips(); try { if (localStorage.getItem('ho_rundock_off') === '1') L = []; } catch (_) {}   // chips switched off (⚙️): 🗂 Runs stays
    const recent = Object.keys(RUNS).length > 0;   // the 🗂 Runs history stays one tap away
    if (!L.length && !recent) { if (dock.innerHTML) dock.innerHTML = ''; dock._hrdKey = ''; dock.hidden = true; return; }
    dock.hidden = false;
    // Heartbeats change "at" every second. Keep the card and its buttons mounted unless
    // actual content changes; only the clock text needs refreshing on a timer.
    const key = JSON.stringify(L.map(r => [r.tag, r.kind, r.no, r.state, r.hotel, r.n, r.done, r.prog, r.note, r.test, r.started]));
    if (dock._hrdKey !== key) {
    dock._hrdKey = key;
    dock.innerHTML = L.map(r => {
      const t = chipText(r), sec = ((r.state === 'run' ? Date.now() : r.at || Date.now()) - r.started) / 1000;
      const pct = r.state === 'done' ? 100 : ['enrol','manual','ingauge'].includes(r.kind) ? (r.n ? Math.round((r.done || 0) / r.n * 100) : 5) : Math.max(5, Math.min(97, r.prog || 10));
      return `<div class="hrd-chip ${esc(r.state)}" role="button" tabindex="0" data-hrd-open="${esc(r.tag)}" title="Open the live window of run #${esc(r.no)}">
        <span class="hrd-st">${t.st}</span><span class="hrd-t"><b>${esc(t.title)}</b><small>${esc(t.sub || r.note || '')}${t.sub || r.note ? ' · ' : ''}<time data-hrd-time="${esc(r.tag)}" aria-live="off">${dur(sec)}</time></small></span>
        <button type="button" class="hrd-x" data-hrd-x="${esc(r.tag)}" aria-label="Close this chip" title="Close${r.state === 'run' ? ' — the run keeps going;' : ' —'} it stays in 🗂 Runs">×</button>
        <i class="hrd-bar" style="width:${pct}%"></i></div>`;
    }).join('') + `<button type="button" class="hrd-all" data-hrd-list="1" title="Cloud run history and any active runs">🗂 Run history</button>`;
    }
    tickDock();
    if (L.some(r => r.state === 'run')) timer = setInterval(tickDock, 1000);
  }
  function tickDock() {
    const dock = D.getElementById('hoRunDock'); if (!dock || dock.hidden) return;
    if (Array.from(dock.querySelectorAll('[data-hrd-time]')).some(el => RUNS[el.dataset.hrdTime] && !active(RUNS[el.dataset.hrdTime]))) { paint(); return; }
    dock.querySelectorAll('[data-hrd-time]').forEach(el => {
      const r = RUNS[el.dataset.hrdTime]; if (!r) return;
      const text = dur(((r.state === 'run' ? Date.now() : r.at || r.started) - r.started) / 1000);
      if (el.textContent !== text) el.textContent = text;
    });
  }
  function openRun(r) {
    const cur = latest(r.kind);
    if (active(r) && cur && cur.tag === r.tag) { KINDS[r.kind].open(); setTimeout(paint, 50); return; }
    list(r.tag);   // an older run: its details (the live window only follows the newest of its kind)
  }
  // ── 🗂 Runs: every run with its number, hotel and result ──
  function summary(r) {
    const t = r.tally && Object.keys(r.tally).length ? r.tally : null;
    if (r.test && !['discover','snapshot'].includes(r.mode || r.how)) return 'Preview only · no changes submitted'+(t?.tested ? ' · '+t.tested+' checked' : '');
    if (r.kind === 'ingauge' && ['discover','snapshot'].includes(r.mode || r.how)) return status(r) === 'done' ? 'Read-only lookup completed' : '';
    if (r.kind === 'ingauge' && t) return `${t.applied || 0} applied · ${t.unchanged || 0} unchanged · ${t.held || 0} held${t.uncertain ? ' · '+t.uncertain+' need verification' : ''}`;
    if (r.kind === 'manual' && t) return `${t.submitted || 0} submitted · ${t.already_exists || 0} already exist · ${t.needs_review || 0} need review`;
    if (r.kind === 'enrol' && t) return `${t.enrolled || 0} enrolled · ${t.already || 0} already members · ${t.skipped || 0} skipped · ${t.errors || 0} errors`;
    return r.n ? (r.kind === 'neorcha' ? r.n+' cards read' : (r.done || 0)+' / '+r.n+' processed') : '';
  }
  function closeHistory() {
    const w = D.getElementById('hoRunList'); if (!w?.classList.contains('on')) return;
    w.classList.remove('on'); clearInterval(historyTimer); historyTimer = 0;
    D.body.style.overflow = oldOverflow;
    if (returnFocus?.isConnected) returnFocus.focus({preventScroll:true}); returnFocus = null;
  }
  function historyKeys(e) {
    const w = D.getElementById('hoRunList'); if (!w?.classList.contains('on')) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeHistory(); return; }
    if (e.key !== 'Tab') return;
    const els = Array.from(w.querySelectorAll('button:not([disabled]),input,select,a[href],summary')).filter(el => el.getClientRects().length);
    const first = els[0], last = els[els.length-1];
    if (e.shiftKey && (D.activeElement === first || !w.contains(D.activeElement))) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && (D.activeElement === last || !w.contains(D.activeElement))) { e.preventDefault(); first?.focus(); }
  }
  function list(focus) {
    let w = D.getElementById('hoRunList');
    if (!w) {
      w = D.createElement('div'); w.id = 'hoRunList'; w.className = 'hrl'; D.body.appendChild(w);
      w.innerHTML = `<div class="hrl-bg" data-hrl-x="1"></div><section class="hrl-card" role="dialog" aria-modal="true" aria-label="Cloud run history">
        <header class="hrl-h"><span class="hrl-ic">🗂</span><div><b>Cloud run history</b><small>Results, dates and activity · Dubai time</small></div><button type="button" class="hrl-close" data-hrl-x="1" aria-label="Close">✕</button></header>
        <div class="hrl-filters"><nav aria-label="Run view"><button data-view="history">History</button><button data-view="active">Active</button><button data-view="all">All</button></nav>
        <label class="hrl-search">Find a run<input type="search" data-filter="q" maxlength="80" placeholder="Run number, hotel or person" autocomplete="off"></label>
        <div class="hrl-dates"><label>From<input type="date" data-filter="from" aria-label="From date"></label><label>Through<input type="date" data-filter="to" aria-label="Through date"></label></div>
        <div class="hrl-quick"><button data-days="1">Today</button><button data-days="7">7 days</button><button data-days="30">30 days</button><button data-days="0">All dates</button></div>
        <div class="hrl-dates"><label>Tool<select data-filter="kind"><option value="">All tools</option>${Object.entries(KINDS).map(([k,v])=>`<option value="${k}">${esc(v.name)}</option>`).join('')}</select></label><label>Result<select data-filter="outcome"><option value="">All results</option><option value="done">Finished</option><option value="error">Failed</option><option value="stopped">Cancelled</option><option value="unconfirmed">Unconfirmed</option></select></label></div>
        <div class="hrl-refresh"><span data-history-count role="status"></span><div><button type="button" data-reset>Reset filters</button> <button type="button" data-refresh>Refresh status</button></div></div><p class="hrl-feedback" data-history-feedback role="status" aria-live="polite"></p></div>
        <div class="hrl-b" data-history-results></div></section>`;
      w.addEventListener('click', e => {
        if (e.target.closest('[data-hrl-x]')) return closeHistory();
        const v = e.target.closest('[data-view]'); if (v) { FILTER.view = v.dataset.view; FILTER.limit = 30; renderHistory(true); return; }
        const d = e.target.closest('[data-days]'); if (d) { const n = +d.dataset.days; FILTER.from = n ? day(Date.now()-(n-1)*864e5) : ''; FILTER.to = n ? day(Date.now()) : ''; FILTER.limit = 30; syncFilters(); renderHistory(true); return; }
        if (e.target.closest('[data-more]')) { FILTER.limit += 30; renderHistory(true); return; }
        if (e.target.closest('[data-refresh]')) return reconcile(true);
        if (e.target.closest('[data-reset]')) { Object.assign(FILTER,{from:'',to:'',kind:'',outcome:'',q:'',limit:30}); syncFilters(); renderHistory(true); return; }
        const o = e.target.closest('[data-hrl-open]'); if (o) { const r = RUNS[o.dataset.hrlOpen]; if (r && active(r) && latest(r.kind) === r) { unhide(r.tag); closeHistory(); KINDS[r.kind].open(); setTimeout(paint, 50); } }
      });
      w.addEventListener('change', e => { const k = e.target.dataset.filter; if (['from','to','kind','outcome'].includes(k)) { FILTER[k] = e.target.value; FILTER.limit = 30; renderHistory(true); } });
      w.addEventListener('input', e => { if (e.target.dataset.filter === 'q') { FILTER.q = e.target.value.slice(0,80); FILTER.limit = 30; renderHistory(); } });
      D.addEventListener('keydown', historyKeys, true);
    }
    if (focus) { FILTER.view = active(RUNS[focus] || {}) ? 'active' : 'history'; FILTER.from = ''; FILTER.to = ''; }
    const wasOpen = w.classList.contains('on');
    if (!wasOpen) { returnFocus = D.activeElement; oldOverflow = D.body.style.overflow; D.body.style.overflow = 'hidden'; }
    w.classList.add('on'); syncFilters(); renderHistory(true, focus);
    if (!wasOpen) w.querySelector('.hrl-close')?.focus({preventScroll:true});
    clearInterval(historyTimer); historyTimer = setInterval(() => { if (Date.now() >= historyDeadline) renderHistory(); tickHistory(); }, 1000);
    reconcile();
  }
  function syncFilters() { const w = D.getElementById('hoRunList'); if (w) w.querySelectorAll('[data-filter]').forEach(el => { el.value = FILTER[el.dataset.filter]; }); }
  function tickHistory() { D.getElementById('hoRunList')?.querySelectorAll('[data-history-time]').forEach(el => { const r = RUNS[el.dataset.historyTime]; if (r && active(r)) el.textContent = dur((Date.now()-r.started)/1000); }); }
  function renderHistory(force, focus) {
    const w = D.getElementById('hoRunList'); if (!w || !w.classList.contains('on')) return;
    historyDeadline = Object.values(RUNS).filter(active).reduce((next,r)=>Math.min(next,(+r.at || +r.started)+20*60e3+1),Infinity);
    const all = Object.values(RUNS).sort((a,b)=>(+b.started||0)-(+a.started||0));
    w.querySelectorAll('[data-view]').forEach(el => { const selected = el.dataset.view === FILTER.view; el.setAttribute('aria-pressed', String(selected)); el.textContent = ({history:'History',active:'Active',all:'All'})[el.dataset.view]+' ('+all.filter(r=>el.dataset.view==='all'||(el.dataset.view==='active'?active(r):!active(r))).length+')'; });
    const invalidDates = !!(FILTER.from && FILTER.to && FILTER.from > FILTER.to);
    const filtered = invalidDates ? [] : all.filter(r => matches(r,FILTER));
    w.querySelectorAll('[data-filter=from],[data-filter=to]').forEach(el=>el.setAttribute('aria-invalid',String(invalidDates)));
    const count = w.querySelector('[data-history-count]'); if (count) count.textContent = FILTER.from && FILTER.to && FILTER.from > FILTER.to ? 'Choose an end date after the start date.' : filtered.length+' run'+(filtered.length===1?'':'s');
    const body = w.querySelector('[data-history-results]'); if (!body) return;
    const html = filtered.slice(0,FILTER.limit).map(r=>{
      const st = status(r), running = st === 'run', end = +r.finishedAt || (terminal(r) ? +r.at : 0);
      const names = {run:'Running',done:'Finished',error:'Failed',stopped:'Cancelled',unconfirmed:'Unconfirmed'};
      const note = st === 'unconfirmed' ? 'No final result received. Verify the outcome before retrying.' : r.note || '';
      return `<article class="hrl-run ${st}${focus===r.tag?' focus':''}"><div class="hrl-main"><div class="hrl-title"><b>${esc(operation(r))}</b><span class="hrl-status">${names[st]}</span></div>
      <span class="hrl-meta">#${esc(r.no || '—')} · ${esc(r.hotel || 'Hotel not recorded')}${r.account?' · '+esc(r.account):''}</span>
      ${r.by?`<span class="hrl-meta">Started by ${esc(r.by)}</span>`:''}
      <span class="hrl-meta">Started ${esc(when(r.started || r.at))}</span>
      ${end ? `<span class="hrl-meta">Ended ${esc(when(end))} · ${esc(dur((end-r.started)/1000))}</span>` : running ? `<span class="hrl-meta">Elapsed <time data-history-time="${esc(r.tag)}">${dur((Date.now()-r.started)/1000)}</time></span>` : `<span class="hrl-meta">${r.workflowEnded?'Workflow ended '+esc(when(r.workflowEnded)):'End time not confirmed'} · Last update ${esc(when(r.at || r.started))}</span>`}
      ${r.from?`<span class="hrl-meta">Report dates ${esc(r.from)}${r.to && r.to!==r.from?' → '+esc(r.to):''}</span>`:''}
      ${summary(r)?`<span class="hrl-res">${esc(summary(r))}</span>`:''}<span class="hrl-note">${esc(note)}</span>
      ${st==='unconfirmed' && r.note ? `<details><summary>Last reported activity</summary><span class="hrl-note">${esc(r.note)}</span></details>`:''}
      <span class="hrl-act">${running && latest(r.kind)===r?`<button type="button" class="btn sm gold" data-hrl-open="${esc(r.tag)}">Open live window</button>`:''}${/^https:\/\/github\.com\//.test(r.url||'')?`<a class="btn sm" href="${esc(r.url)}" target="_blank" rel="noopener">GitHub ↗</a>`:''}</span></div></article>`;
    }).join('')+(filtered.length>FILTER.limit?'<button type="button" data-more>Load more runs</button>':'') || '<div class="hrl-empty">No runs match these filters.</div>';
    if (force || body._key !== html.replace(/<time[^>]*>.*?<\/time>/g,'')) { body.innerHTML = html; body._key = html.replace(/<time[^>]*>.*?<\/time>/g,''); }
    if (focus) body.querySelector('.focus')?.scrollIntoView({block:'nearest'});
  }
  let checking = false, lastCheck = 0, checkedRoot = null;
  const feedback = message => { const el = D.getElementById('hoRunList')?.querySelector('[data-history-feedback]'); if (el) el.textContent = message; };
  function boundedRead(promise) { let timeout; return Promise.race([promise,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Status check timed out')),10000);})]).finally(()=>clearTimeout(timeout)); }
  async function reconcile(manual = false) {
    const root = typeof _ref !== 'undefined' ? _ref : null;
    if (checking) { if (manual) feedback('A status check is already in progress.'); return; }
    if (root === checkedRoot && Date.now()-lastCheck < 30000) { if (manual) feedback('Checked just now. You can refresh again in '+Math.max(1,Math.ceil((30000-Date.now()+lastCheck)/1000))+' seconds.'); return; }
    checking = true; lastCheck = Date.now(); checkedRoot = root;
    let updated = 0, unavailable = 0;
    feedback('Checking saved job results…');
    const button = D.getElementById('hoRunList')?.querySelector('[data-refresh]'); if (button) { button.disabled = true; button.textContent = 'Checking…'; }
    try {
      const rows = Object.values(RUNS).filter(r=>!terminal(r)).sort((a,b)=>b.started-a.started).slice(0,60);
      for (let i=0;i<rows.length;i+=5) await Promise.all(rows.slice(i,i+5).map(async r=>{
        let patch = null;
        try {
          const path = r.kind==='ingauge'?'ingauge/jobs/':r.kind==='manual'?'manualSalesJobs/':null;
          if (path && root?.child) {
            const snap = await boundedRead(root.child(path+r.tag).once('value')), job = snap.val();
            if (job && ['done','error','stopped'].includes(job.state)) patch = {...fromLive(r.kind,job), finishedAt:+job.finishedAt || +job.at || +job.doneAt || 0};
          }
          if (!patch && /^https:\/\/github\.com\/ahmed0088\/Depature-Tool\/actions\/runs\/\d+$/i.test(r.url || '')) {
            const id = r.url.split('/').pop(), headers = {Accept:'application/vnd.github+json'};
            let token = ''; try { token = localStorage.getItem('ho_gh_start_key_v1') || ''; } catch (_) {} if (token) headers.Authorization = 'Bearer '+token;
            const response = await fetch('https://api.github.com/repos/ahmed0088/Depature-Tool/actions/runs/'+id,{headers,signal:AbortSignal.timeout(10000)});
            if (response.ok) { const job = await response.json(); if (job.status==='completed') { const end = Date.parse(job.updated_at)||Date.now(); patch = {workflowEnded:end}; if (['failure','timed_out','cancelled','startup_failure'].includes(job.conclusion)) Object.assign(patch,{state:job.conclusion==='cancelled'?'stopped':'error',finishedAt:end,note:'Workflow '+(job.conclusion==='cancelled'?'was cancelled':'ended with an error')+'. Final application result unavailable; verify the outcome before retrying.'}); } }
          }
        } catch (_) {}
        if (!patch) unavailable++;
        if (root !== (typeof _ref !== 'undefined' ? _ref : null) || !RUNS[r.tag] || terminal(RUNS[r.tag]) || !patch) return;
        updated++; Object.assign(RUNS[r.tag],patch);
        if (dbOk()) try { await fbUpdate('cloudRuns/'+r.tag,patch); } catch (_) {}
      }));
    } finally { checking = false; if (button) { button.disabled = false; button.textContent = 'Refresh status'; } if (root === (typeof _ref !== 'undefined' ? _ref : null)) feedback(unavailable ? updated+' status'+(updated===1?'':'es')+' updated · '+unavailable+' could not be verified. Saved results are kept.' : updated ? updated+' run status'+(updated===1?'':'es')+' updated.' : 'No unresolved runs to check.'); paint(); }
  }

  function css() {
    if (D.getElementById('hoRunDockCss')) return;
    const s = D.createElement('style'); s.id = 'hoRunDockCss';
    s.textContent = `.hrd{position:fixed;left:16px;bottom:16px;z-index:9000;display:flex;flex-direction:column;align-items:flex-start;gap:8px;max-width:min(340px,calc(100vw - 110px));pointer-events:none}
.hrd[hidden]{display:none}.hrd>*{pointer-events:auto}
.hrd-chip{position:relative;overflow:hidden;display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;padding:9px 12px 11px;border-radius:14px;cursor:pointer;background:var(--card2,#1e2533);color:var(--text,#fff);border:1px solid var(--border2,rgba(255,255,255,.18));box-shadow:0 12px 30px -12px rgba(0,0,0,.5)}
.hrd-chip:hover{border-color:var(--accent)}.hrd-chip:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.hrd-st{font-size:18px;flex:none}.hrd-t time{display:inline-block;min-width:4ch;font-variant-numeric:tabular-nums}
.hrd-t{display:flex;flex-direction:column;min-width:0;flex:1}.hrd-t b{font-size:.84rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.hrd-t small{font-size:.72rem;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hrd-x{flex:none;width:26px;height:26px;border-radius:50%;border:0;background:transparent;color:var(--text2);font-size:18px;cursor:pointer}.hrd-x:hover{background:var(--border)}
.hrd-bar{position:absolute;left:0;bottom:0;height:3px;background:var(--accent);transition:width .5s ease}.hrd-chip.done .hrd-bar{background:var(--green,#22c55e)}.hrd-chip.error .hrd-bar{background:var(--red,#ef4444)}
.hrd-all{border:1px solid var(--border2);background:var(--card2,#1e2533);color:var(--text);border-radius:99px;padding:6px 12px;font:600 .74rem var(--font);cursor:pointer;box-shadow:0 8px 20px -10px rgba(0,0,0,.45)}.hrd-all:hover{border-color:var(--accent)}
@keyframes hrdIn{from{opacity:0;transform:translateY(10px)}}@keyframes hrdPulse{50%{opacity:.45}}
@media (min-width:769px){.hrd{left:calc(var(--sidenav-w,244px) + 16px)}body:has(.sidenav.collapsed) .hrd{left:16px}}
@media (max-width:768px){.hrd{left:10px;bottom:calc(86px + env(safe-area-inset-bottom));max-width:calc(100vw - 96px)}}
.hrl{position:fixed;inset:0;z-index:10050;display:none;align-items:center;justify-content:center}.hrl.on{display:flex}
.hrl-bg{position:absolute;inset:0;background:rgba(0,0,0,.5)}
.hrl-card{position:relative;width:min(680px,calc(100vw - 24px));max-height:calc(100dvh - 32px);display:flex;flex-direction:column;background:var(--card2,#111827);color:var(--text);border:1px solid var(--border2);border-radius:var(--r3,18px);box-shadow:0 30px 70px -20px rgba(0,0,0,.6);overflow:hidden}
.hrl-h{flex:none;position:sticky;top:0;display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid var(--border);background:inherit}.hrl-h div{flex:1;display:flex;flex-direction:column}.hrl-h small{color:var(--text2);font-size:.76rem}
.hrl-ic{font-size:22px}.hrl-close{flex:none;width:44px;height:44px;border-radius:50%;border:1px solid var(--border2);background:transparent;color:var(--text);font-size:16px;cursor:pointer}
.hrl-b{overflow:auto;padding:12px 14px calc(14px + env(safe-area-inset-bottom));display:grid;gap:10px}
.hrl-section{margin:4px 0 0;font:700 .78rem var(--font);color:var(--text2)}
.hrl-run{display:grid;grid-template-columns:1fr;gap:12px;padding:12px;border:1px solid var(--border);border-radius:var(--r2,12px);background:var(--card)}
.hrl-run.focus{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-bg)}
.hrl-no{font:800 1.15rem var(--font);color:var(--accent);text-align:center;padding-top:2px}
.hrl-main{display:flex;flex-direction:column;gap:3px;min-width:0}.hrl-main>b{font-size:.92rem}.hrl-main em{font-style:normal;font-size:.72rem;color:var(--amber,#f59e0b)}
.hrl-meta{font-size:.76rem;color:var(--text2)}.hrl-res{font-size:.8rem;font-weight:600}.hrl-note{font-size:.76rem;color:var(--text3)}
.hrl-run.error .hrl-no{color:var(--red,#ef4444)}.hrl-run.done .hrl-no{color:var(--green,#22c55e)}
.hrl-act{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}.hrl-act:empty{display:none}
.hrl-empty{padding:24px;text-align:center;color:var(--text2)}
@media (max-width:600px){.hrl{align-items:flex-end}.hrl-card{width:100vw;border-radius:20px 20px 0 0;max-height:90dvh}}
.hrl-filters{padding:12px 16px;border-bottom:1px solid var(--border);display:grid;gap:10px;flex:none}.hrl-filters nav,.hrl-quick{display:flex;gap:6px;flex-wrap:wrap}.hrl-filters button{min-height:40px;touch-action:manipulation;font:inherit;font-size:.78rem;border:1px solid var(--border2,#bbb);border-radius:9px;padding:8px 10px;color:var(--text);background:var(--card)}.hrl-filters [aria-pressed=true]{color:var(--text);background:var(--accent-bg);border-color:var(--accent);font-weight:700}.hrl-dates{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px}.hrl-search{display:grid;gap:4px;font-size:.74rem;color:var(--text2)}.hrl-search input{box-sizing:border-box;width:100%;min-height:40px;border:1px solid var(--border2);border-radius:8px;padding:8px 10px;background:var(--card);color:var(--text);font:inherit;font-size:16px}.hrl-feedback{margin:0;color:var(--text2);font-size:.72rem;line-height:1.5}.hrl-feedback:empty{display:none}.hrl-dates [aria-invalid=true]{border-color:var(--red,#df3845)}.hrl-card :focus-visible{outline:2px solid var(--accent);outline-offset:2px}.hrl-refresh{flex-wrap:wrap;gap:8px}.hrl-dates label{min-width:0;display:grid;gap:4px;font-size:.74rem;color:var(--text2)}.hrl-dates input,.hrl-dates select{box-sizing:border-box;width:100%;min-width:0;max-width:100%;height:38px;padding:6px 8px;border:1px solid var(--border2,#aaa);border-radius:8px;background:var(--card);color:var(--text);font:inherit;font-size:16px}.hrl-refresh{display:flex;align-items:center;justify-content:space-between;color:var(--text2);font-size:.74rem}.hrl-title{display:flex;justify-content:space-between;align-items:center;gap:8px}.hrl-title b{font-size:.93rem}.hrl-status{font-size:.68rem;font-weight:700;border-radius:99px;padding:4px 8px;background:var(--border);white-space:nowrap}.hrl-run.done .hrl-status{color:var(--green,#14984b)}.hrl-run.error .hrl-status{color:var(--red,#df3845)}.hrl-run.unconfirmed .hrl-status{color:var(--text2)}.hrl-main{gap:6px}.hrl-main details{font-size:.75rem;color:var(--text2)}.hrl-main summary{cursor:pointer}.hrl-b{min-height:80px;overscroll-behavior:contain}.hrl-note{line-height:1.5}.hrl-card button{cursor:pointer}.hrl-card button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
@media (max-height:650px){.hrl-filters{gap:6px;padding:8px 12px;max-height:40dvh;overflow:auto;overscroll-behavior:contain}.hrl-h{padding:8px 12px}}
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
      RUNS = next; paint(); W.dispatchEvent(new Event('ho-enrol-history'));
    });
    Object.keys(KINDS).forEach(k => fbListen(KINDS[k].live, v => onLive(k, v)));
  })();
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', () => { css(); paint(); }); else { css(); paint(); }
  async function update(tag, fields) { const r = RUNS[tag]; if (!r || (r.url === fields.url && !fields.note)) return; const patch = {}; if (/^https:\/\/github\.com\//.test(fields.url || '')) patch.url = fields.url; if (fields.note) patch.note = clean(fields.note,140); Object.assign(r,patch); if (dbOk()) try { await fbUpdate('cloudRuns/'+tag,patch); } catch (_) {} paint(); }
  W.hoRuns = { start, update, minimized, closed, label, list, paint, get: (kind, tag) => RUNS[tag] && RUNS[tag].kind === kind ? Object.assign({}, RUNS[tag]) : null, _pure: { fromLive, chipText, liveKey, status, day, matches, operation, summary } };
})();

