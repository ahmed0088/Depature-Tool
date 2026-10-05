// ═══════════════════════════════════════════════════════════════════════════
//  NEORCHA GUEST DOCUMENTS — Email + Phone Extractor  ·  v10.0
// ═══════════════════════════════════════════════════════════════════════════
//
//  v10 (on top of v9.0 PRO)
//   • RESUME: progress is saved after every guest. If the run is interrupted
//     (tab reload, Stop, Neorcha logout) just run it again — it offers to carry
//     on and skips every guest already read.
//   • Speed + elapsed time in the HUD
//   • Output is unchanged (5 columns) so it pastes straight into the
//     Ibis Ops "Guest Pipeline" workbench or Purpose of Stay → Import Emails:
//       Confirmation_Number · Name · Email · Phone · Nationality
//
//  Kept from v9: fast last-page detection, live HUD, dedupe by confirmation
//  number, OTA relay email → No@email.com, UAE normalization, Copy TSV.
//
//  Usage: paste into DevTools console on the Neorcha Guest Documents list
// ═══════════════════════════════════════════════════════════════════════════

(async function NeorchaProScraper() {
  const VERSION = '10.0';
  const NS = '__neorcha_pro';
  const SAVE_KEY = '__neorcha_pro_progress';

  if (window[NS]?.running) {
    console.warn(`[Neorcha ${VERSION}] Already running. Call window.${NS}.stop() to abort.`);
    return;
  }

  const CFG = {
    LIMIT: 0,                       // 0 = all guests
    MAX_PAGES: 60,
    POLL_MS: 200,
    PAUSE_BETWEEN_MS: 250,
    PAGE_LOAD_SETTLE_MS: 900,
    NEXT_PAGE_WAIT_MS: 4000,
    DETAIL_WAIT_MS: 3000,
    HUD_Z_INDEX: 2147483647,
    RESUME_MAX_AGE_H: 12,           // a saved run older than this is ignored
  };

  let stopped = false;
  window[NS] = { running: true, stop: () => { stopped = true; }, version: VERSION };

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const style = {
    header: 'color:#fff;background:#0a7;padding:3px 8px;border-radius:4px;font-weight:700',
    ok:     'color:#0a7;font-weight:600',
    warn:   'color:#c60;font-weight:600',
    err:    'color:#c33;font-weight:600',
    dim:    'color:#888;font-style:italic',
    guest:  'color:#06c;font-weight:600',
  };
  const log = {
    header: msg => console.log(`%c${msg}`, style.header),
    info:   msg => console.log(msg),
    ok:     msg => console.log(`%c✓ ${msg}`, style.ok),
    warn:   msg => console.log(`%c⚠ ${msg}`, style.warn),
    err:    msg => console.log(`%c✗ ${msg}`, style.err),
    dim:    msg => console.log(`%c${msg}`, style.dim),
    guest:  msg => console.log(`%c${msg}`, style.guest),
  };

  // ── Progress save / resume ─────────────────────────────────────────────
  const saveProgress = results => {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ at: Date.now(), results })); } catch (_) {}
  };
  const loadProgress = () => {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (!d || !Array.isArray(d.results) || !d.results.length) return null;
      if (Date.now() - d.at > CFG.RESUME_MAX_AGE_H * 3600e3) return null;
      return d;
    } catch (_) { return null; }
  };
  const clearProgress = () => { try { localStorage.removeItem(SAVE_KEY); } catch (_) {} };

  // ── Neorcha-specific DOM readers ───────────────────────────────────────
  function readDetailField(field) {
    const el = document.querySelector(`input[ng-model="selectedGuestDoc.${field}"]`);
    return el ? (el.value || '').trim() : '';
  }
  function getRows() {
    return document.querySelectorAll('td[ng-click*="viewGuestDocument"]');
  }
  function getCurrentPageList() {
    const rows = getRows();
    if (!rows.length) return { rows: [], list: [] };
    if (typeof angular === 'undefined') return { rows, list: [] };
    const scope = angular.element(rows[0]).scope();
    const list = scope?.guestDocuments
              || scope?.$parent?.guestDocuments
              || scope?.$parent?.$parent?.guestDocuments
              || [];
    return { rows, list };
  }
  function pageSignature() {
    const { list } = getCurrentPageList();
    return list.map(g => g.confirmationNumber || g.id).join(',');
  }
  function findNextPageEl() {
    let el = document.querySelector('a[ng-click="setCurrent(pagination.current + 1)"]');
    if (!el) el = document.querySelector('a[ng-click*="setCurrent(pagination.current"]');
    if (!el) el = Array.from(document.querySelectorAll('a')).find(a => a.textContent.trim() === '›') || null;
    return el;
  }
  function advanceToNextPage() {
    const el = findNextPageEl();
    if (!el) return false;
    el.addEventListener('click', e => e.preventDefault(), { once: true });
    el.click();
    return true;
  }
  async function waitForNewPage(oldSignature) {
    const start = Date.now();
    while (Date.now() - start < CFG.NEXT_PAGE_WAIT_MS) {
      if (stopped) return false;
      await sleep(CFG.POLL_MS);
      const sig = pageSignature();
      if (sig && sig !== oldSignature) return true;
    }
    return false;
  }
  function tryBumpPageSize() {
    for (const sel of document.querySelectorAll('select')) {
      const opts = Array.from(sel.options).map(o => parseInt(o.value || o.textContent, 10)).filter(n => !isNaN(n));
      if (opts.length < 2) continue;
      const current = parseInt(sel.value, 10);
      const max = Math.max(...opts);
      if (!isNaN(current) && current < max && opts.includes(max)) {
        sel.value = String(max);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        sel.dispatchEvent(new Event('input',  { bubbles: true }));
        log.ok(`Bumped records-per-page from ${current} to ${max}`);
        return true;
      }
    }
    return false;
  }

  function normalizeNationality(nat) {
    if (!nat) return '';
    const c = nat.trim().toLowerCase().replace(/[.\s]+/g, ' ');
    if (c === 'united arab emirates' || c === 'uae' || c === 'u a e' || c.includes('united arab emirates')) return 'UAE';
    return nat.trim();
  }

  const OTA_RELAY_DOMAIN_RE = /(^|@|\.)(guest\.)?(trip\.com|booking\.com|expedia(partnercentral)?\.com|airbnb\.com|hotels\.com|agoda\.com)$/i;
  function isOtaRelayEmail(email) {
    const at = String(email || '').split('@')[1];
    if (!at) return false;
    return OTA_RELAY_DOMAIN_RE.test('@' + at.toLowerCase());
  }

  // ── Floating HUD ───────────────────────────────────────────────────────
  const hud = {
    root: null, els: {},
    mount() {
      document.getElementById('__neorcha_hud')?.remove();
      const root = document.createElement('div');
      root.id = '__neorcha_hud';
      root.style.cssText = `
        position:fixed; bottom:20px; right:20px; z-index:${CFG.HUD_Z_INDEX};
        width:340px; background:#141414; color:#eaeaea;
        border-radius:12px; box-shadow:0 12px 32px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.06);
        font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
        overflow:hidden; user-select:none;`;
      root.innerHTML = `
        <div style="background:linear-gradient(135deg,#0a7,#086);padding:10px 14px;font-weight:700;font-size:13px;display:flex;justify-content:space-between;align-items:center;">
          <span>🕵 Neorcha Extractor <span style="opacity:.7;font-weight:500">v${VERSION}</span></span>
          <span id="__neorcha_hud_status" style="font-size:11px;background:rgba(0,0,0,.25);padding:2px 8px;border-radius:10px">idle</span>
        </div>
        <div style="padding:12px 14px 14px">
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px">
            <div style="background:#1e1e1e;padding:8px 10px;border-radius:6px"><div style="font-size:10px;color:#888;text-transform:uppercase">Page</div><div id="__neorcha_hud_page" style="font-size:18px;font-weight:700;color:#0d9">—</div></div>
            <div style="background:#1e1e1e;padding:8px 10px;border-radius:6px"><div style="font-size:10px;color:#888;text-transform:uppercase">Guests</div><div id="__neorcha_hud_guests" style="font-size:18px;font-weight:700;color:#0d9">0</div></div>
            <div style="background:#1e1e1e;padding:8px 10px;border-radius:6px"><div style="font-size:10px;color:#888;text-transform:uppercase">Per min</div><div id="__neorcha_hud_rate" style="font-size:18px;font-weight:700;color:#0d9">—</div></div>
          </div>
          <div style="font-size:11px;color:#aaa;margin-bottom:8px">Current action</div>
          <div id="__neorcha_hud_action" style="font-size:12px;color:#ddd;min-height:34px;background:#1a1a1a;padding:8px 10px;border-radius:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Starting…</div>
          <div style="margin-top:10px;display:flex;gap:8px">
            <button id="__neorcha_hud_stop" style="flex:1;padding:8px 12px;border:0;border-radius:6px;cursor:pointer;background:#3a1a1a;color:#f88;font-weight:600;font-size:12px;">Stop</button>
            <button id="__neorcha_hud_copy" style="flex:1;padding:8px 12px;border:0;border-radius:6px;cursor:pointer;background:#1a3a1a;color:#8f8;font-weight:600;font-size:12px;opacity:.4;pointer-events:none;">Copy TSV</button>
          </div>
          <div style="margin-top:8px;font-size:10.5px;color:#777">Progress is saved — if it stops, run the script again to carry on.</div>
        </div>`;
      document.body.appendChild(root);
      this.root = root;
      const q = id => root.querySelector('#' + id);
      this.els = { status: q('__neorcha_hud_status'), page: q('__neorcha_hud_page'), guests: q('__neorcha_hud_guests'),
                   rate: q('__neorcha_hud_rate'), action: q('__neorcha_hud_action'), stop: q('__neorcha_hud_stop'), copy: q('__neorcha_hud_copy') };
      this.els.stop.onclick = () => { stopped = true; this.setStatus('stopping', '#c60'); log.warn('User requested stop. Progress is saved.'); };
    },
    setStatus(text, color = '#8f8') { if (this.els.status) { this.els.status.textContent = text; this.els.status.style.color = color; } },
    setPage(n)   { if (this.els.page)   this.els.page.textContent = n; },
    setGuests(n) { if (this.els.guests) this.els.guests.textContent = n; },
    setRate(n)   { if (this.els.rate)   this.els.rate.textContent = n; },
    setAction(s) { if (this.els.action) this.els.action.textContent = s; },
    enableCopy(tsv, count) {
      const btn = this.els.copy;
      if (!btn) return;
      btn.style.opacity = '1'; btn.style.pointerEvents = 'auto';
      btn.textContent = `Copy ${count} guests`;
      btn.onclick = async () => {
        try { await navigator.clipboard.writeText(tsv); }
        catch (_) {
          const ta = document.createElement('textarea');
          ta.value = tsv; ta.style.cssText = 'position:fixed;left:-9999px';
          document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); } catch (_) {}
          ta.remove();
        }
        btn.textContent = '✓ Copied!';
        setTimeout(() => { btn.textContent = `Copy ${count} guests`; }, 1800);
      };
    },
  };

  // ── Validate page ──────────────────────────────────────────────────────
  if (!getRows().length) { log.err('No guest rows found. Are you on the Guest Documents list page?'); window[NS].running = false; return; }
  if (typeof angular === 'undefined') { log.err('AngularJS not found.'); window[NS].running = false; return; }

  // ── Resume? ───────────────────────────────────────────────────────────
  const results = [];
  const seenConf = new Set();
  const saved = loadProgress();
  if (saved && confirm(`Neorcha Extractor: carry on from the last run?\n\n${saved.results.length} guests were already read. OK = resume (skip them), Cancel = start fresh.`)) {
    saved.results.forEach(r => { results.push(r); seenConf.add(String(r.conf)); });
    log.ok(`Resuming — ${results.length} guests already read will be skipped.`);
  } else {
    clearProgress();
  }

  log.header(`NEORCHA EXTRACTOR v${VERSION}`);
  hud.mount();
  hud.setStatus('running', '#8f8');
  hud.setGuests(results.length);
  hud.setAction('Preparing page size…');

  tryBumpPageSize();
  await sleep(CFG.PAGE_LOAD_SETTLE_MS);

  // ── Main loop ─────────────────────────────────────────────────────────
  let page = 1;
  let prevSignature = '';
  const t0 = Date.now();
  let readThisRun = 0;

  while (page <= CFG.MAX_PAGES && !stopped) {
    const { list } = getCurrentPageList();
    if (!list.length) { log.warn('No guest data on this page.'); break; }

    const signature = list.map(g => g.confirmationNumber || g.id).join(',');
    if (signature === prevSignature) { log.ok(`Reached last page (list unchanged). Stopping at page ${page - 1}.`); break; }
    prevSignature = signature;

    log.header(`── PAGE ${page} — ${list.length} guests ──`);
    hud.setPage(page);

    for (const item of list) {
      if (stopped) break;
      if (CFG.LIMIT > 0 && results.length >= CFG.LIMIT) break;

      const conf = item.confirmationNumber || item.confirmation_number || item.confNumber || item.id;
      if (!conf) continue;
      if (seenConf.has(String(conf))) continue;          // dedupe + resume skip
      seenConf.add(String(conf));

      hud.setAction(`#${results.length + 1} · ${item.firstName || ''} ${item.lastName || ''}`.trim());

      const prev = ['email', 'firstName', 'lastName', 'country', 'phone'].map(readDetailField).join('|');

      let row = null;
      for (const r of getRows()) { if (r.textContent.trim() === String(conf).trim()) { row = r; break; } }
      if (!row) { log.warn(`Row not found for ${conf} — skipping`); continue; }
      row.click();

      const start = Date.now();
      while (['email', 'firstName', 'lastName', 'country', 'phone'].map(readDetailField).join('|') === prev &&
             Date.now() - start < CFG.DETAIL_WAIT_MS) {
        if (stopped) break;
        await sleep(CFG.POLL_MS);
      }

      let email = readDetailField('email');
      const first = readDetailField('firstName') || item.firstName || item.first_name || '';
      const last  = readDetailField('lastName')  || item.lastName  || item.last_name  || '';
      const phone = readDetailField('phone')     || item.phone     || item.mobile    || '';
      const nat   = normalizeNationality(readDetailField('country') || item.country || item.nationality || '');

      if (isOtaRelayEmail(email)) { log.dim(`(${email} → OTA relay → No@email.com)`); email = 'No@email.com'; }

      log.guest(`${String(results.length + 1).padStart(2, ' ')}  ${conf}  ${first} ${last}`);
      log.info(`    ${email || '(no email)'}  ·  ${phone || '(no phone)'}  ·  ${nat || '(no nationality)'}`);

      results.push({ conf, first, last, email, phone, nat });
      readThisRun++;
      saveProgress(results);
      hud.setGuests(results.length);
      const mins = (Date.now() - t0) / 60000;
      if (mins > 0.05) hud.setRate(Math.round(readThisRun / mins));

      await sleep(CFG.PAUSE_BETWEEN_MS);
    }

    if (stopped) break;
    if (CFG.LIMIT > 0 && results.length >= CFG.LIMIT) { log.ok('Hit LIMIT — stopping.'); break; }

    hud.setAction(`Advancing to page ${page + 1}…`);
    if (!advanceToNextPage()) { log.ok('No more pages (Next button missing).'); break; }
    const loaded = await waitForNewPage(signature);
    if (!loaded) { log.ok(`Last page reached (list did not change within ${CFG.NEXT_PAGE_WAIT_MS}ms).`); break; }
    await sleep(400);
    page++;
  }

  // ── Output ────────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const tsv = 'Confirmation_Number\tName\tEmail\tPhone\tNationality\n' +
    results.map(r => `${r.conf}\t${(r.first + ' ' + r.last).trim()}\t${r.email || 'No email'}\t${r.phone || 'No phone'}\t${r.nat || ''}`).join('\n');

  log.header(`RESULTS · ${results.length} guests · ${elapsed}s`);
  console.log(tsv);

  try { await navigator.clipboard.writeText(tsv); log.ok('Auto-copied to clipboard — paste it into Ibis Ops → Guest Pipeline.'); }
  catch (_) { log.warn('Auto-copy blocked — use the Copy button in the HUD.'); }

  if (!stopped) clearProgress();           // finished cleanly: nothing to resume
  hud.enableCopy(tsv, results.length);
  hud.setStatus(stopped ? 'stopped (saved)' : 'done', stopped ? '#c60' : '#0d9');
  hud.setAction(`${stopped ? 'Stopped' : 'Complete'} — ${results.length} guests in ${elapsed}s`);

  log.ok(`Done. ${results.length} guests across ${page} page(s) in ${elapsed}s.`);
  log.info(`   ${results.filter(r => r.email && r.email !== 'No@email.com').length} had a real email`);
  log.info(`   ${results.filter(r => r.phone).length} had a phone number`);
  log.info(`   ${results.filter(r => r.nat).length} had a nationality`);

  window[NS].running = false;
  window[NS].results = results;
  window[NS].tsv = tsv;
  window[NS].copy = () => navigator.clipboard.writeText(tsv);
  window[NS].clearSaved = clearProgress;
})();
