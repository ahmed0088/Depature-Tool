// ═══════════════════════════════════════════════════════════
//  dtcm.js  —  DTCM Reconciliation panel
//  Compares the DTCM Hotel Transaction Report with the Opera TD
//  journal, lists what to add / reverse / verify, and (optionally)
//  audits the 30-night cap from the Opera tax report.
//
//  Engine files (unchanged logic from the standalone tool):
//    dtcm-core.js · dtcm-recon.js · dtcm-longstay.js
//  This file is only the screen + Firebase sync. Everything is
//  prefixed dtc / dtc- so it cannot collide with other panels.
//
//  Shared via Firebase:  hotels/{HOTEL_ID}/dtcm/state  (the result)
//                        hotels/{HOTEL_ID}/dtcm/done   (ticked rows)
//  Only results are stored, never the uploaded files.
// ═══════════════════════════════════════════════════════════

let dtcFiles   = { dtcm: null, opera: null, longstay: null };
let dtcRecon   = null;
let dtcLS      = null;
let dtcDone    = new Set();
let dtcTab     = 'summary';
let dtcSavedAt = '';
let dtcRemoteSeen = false;
let dtcDoneDoc = null;
let dtcBusy    = false;
let dtcWork    = [];
let dtcFixes   = [];

const dtcNum = (n, dp = 2) => (typeof n === 'number' && isFinite(n) ? n : 0).toFixed(dp);
const dtcR2  = n => Math.round((Number(n) || 0) * 100) / 100;
const dtcPeriod = RC => RC.mode === 'daily' ? (RC.reportDate || '')
  : RC.mode === 'window' ? `${RC.windowStart} → ${RC.windowEnd}` : '';

// ── Setup ─────────────────────────────────────────────────
function dtcInit() {
  const input = document.getElementById('dtcFileInput');
  const drop  = document.getElementById('dtcDrop');
  const panel = document.getElementById('panel-dtcm');
  if (!input || !drop || !panel) return;

  input.addEventListener('change', e => { dtcHandleFiles(e.target.files); input.value = ''; });
  drop.addEventListener('dragover',  e => { e.preventDefault(); drop.classList.add('dtc-drag'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('dtc-drag'));
  drop.addEventListener('drop', e => {
    e.preventDefault(); drop.classList.remove('dtc-drag');
    dtcHandleFiles(e.dataTransfer.files);
  });

  // One delegated listener for ticks and copy chips (no inline JS holding guest data)
  panel.addEventListener('change', e => {
    const cb = e.target.closest('input[data-dtc-key]');
    if (cb) dtcToggleDone(cb);
  });
  panel.addEventListener('click', e => {
    const c = e.target.closest('[data-dtc-copy]');
    if (c) dtcCopyChip(c);
  });
}

function dtcRouteFile(file) {
  const n = file.name.toLowerCase();
  if (n.endsWith('.xml') || n.includes('hoteltransaction') || n.includes('_dynamic')) return 'dtcm';
  if (n.includes('finjrnlbytax') || n.includes('_tax') || n.includes('longstay') || n.includes('long_stay')) return 'longstay';
  if (n.includes('finjrnlbytrans') || n.includes('_trans') || n.includes('finjrnl') || n.endsWith('.txt')) return 'opera';
  return null;
}

function dtcHandleFiles(files) {
  const skipped = [];
  for (const file of files) {
    const key = dtcRouteFile(file);
    if (!key) { skipped.push(file.name); continue; }
    dtcFiles[key] = file;
    const nameEl = document.getElementById('dtcName-' + key);
    const zone   = document.getElementById('dtcZone-' + key);
    if (nameEl) { nameEl.textContent = file.name; nameEl.style.color = 'var(--green)'; }
    if (zone)   zone.classList.add('dtc-has-file');
  }
  if (skipped.length) showToast('Not recognised: ' + skipped.join(', '), 'err');
  const btn = document.getElementById('dtcRunBtn');
  if (btn) btn.disabled = !(dtcFiles.dtcm && dtcFiles.opera);
}

function dtcShowError(msg) {
  const box = document.getElementById('dtcError'), t = document.getElementById('dtcErrorMsg');
  if (!box || !t) return;
  t.textContent = msg || '';
  box.classList.toggle('show', !!msg);
}

function dtcLoading(on, msg) {
  const w = document.getElementById('dtcLoadWrap'), m = document.getElementById('dtcLoadMsg');
  if (w) w.style.display = on ? 'flex' : 'none';
  if (m && msg) m.textContent = msg;
  const btn = document.getElementById('dtcRunBtn');
  if (btn) btn.disabled = on || !(dtcFiles.dtcm && dtcFiles.opera);
}

// ── Analyze ───────────────────────────────────────────────
async function dtcAnalyze() {
  if (dtcBusy) return;
  if (!dtcFiles.dtcm || !dtcFiles.opera) { dtcShowError('Add the DTCM XML and the Opera journal first.'); return; }
  if (!window.DtcmCore || !window.Reconciler || !window.LongStay) {
    dtcShowError('DTCM engine files did not load. Refresh the page (Ctrl+F5).'); return;
  }
  dtcBusy = true; dtcShowError('');
  dtcLoading(true, 'Reading files');
  try {
    const C = window.DtcmCore, R = window.Reconciler;
    const dtcmText  = await C.readTextSmart(dtcFiles.dtcm);
    const operaText = await C.readTextSmart(dtcFiles.opera);

    dtcLoading(true, 'Parsing DTCM XML');
    const dtcmParsed = R.parseDTCM(dtcmText);
    if (!dtcmParsed.segments.length) {
      throw new Error('No guest rows were read from the DTCM XML. Check that this is HotelTransactionReport_Dynamic.xml.');
    }
    dtcLoading(true, 'Parsing Opera journal');
    const opera = R.parseOpera(operaText);
    if (!opera.rows.length) {
      throw new Error('No Tourism Dirham rows were read from the Opera journal. Check that this is the finjrnlbytrans export (press F12 for the detected header).');
    }

    dtcLoading(true, 'Reconciling');
    const RC = R.reconcile(dtcmParsed, opera.rows, opera.fileTotal);

    let LS = null;
    if (dtcFiles.longstay) {
      dtcLoading(true, 'Reading Long Stay report');
      try {
        const lsText = await C.readTextSmart(dtcFiles.longstay);
        LS = dtcSlimLS(window.LongStay.analyze(lsText, window.LongStay.DEFAULT_THRESHOLD));
      } catch (e) {
        console.warn('[DTCM] Long Stay parse failed:', e);
        showToast('Long Stay file could not be read — reconciliation still done', 'err');
      }
    }

    dtcSavedAt = new Date().toISOString();
    RC.savedAt = dtcSavedAt;
    dtcRecon = RC; dtcLS = LS; dtcDone = new Set(); dtcDoneDoc = null;
    dtcRenderAll();
    dtcSwitch('summary');
    dtcPersist();
    dtcArchive(RC);
    try { document.getElementById('dtcResults').scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
    if (typeof logActivity === 'function') {
      const c = dtcActionCounts(RC);
      logActivity('dtcm_analyzed', `${RC.reportDate || 'multi-night'} · ${c.add} add · ${c.reverse} reverse · ${c.verify} verify · ${c.dtcm} DTCM`);
    }
  } catch (err) {
    console.error('[DTCM]', err);
    dtcShowError(err.message || String(err));
  } finally {
    dtcBusy = false;
    dtcLoading(false);
  }
}

// ── Firebase: save / listen ───────────────────────────────
const dtcClean = o => JSON.parse(JSON.stringify(o));

function dtcSlimLS(LS) {
  if (!LS) return null;
  const strip = s => { const { rooms, ...rest } = s; return rest; };
  return dtcClean({
    threshold: LS.threshold,
    rowCount: (LS.rows || []).length,
    segmentCount: (LS.segments || []).length,
    total: LS.total,
    longStays: (LS.longStays || []).map(strip),
    segments: (LS.segments || []).slice(0, 200).map(strip),
    totals: LS.totals || []
  });
}

function dtcSlimState() {
  const RC = dtcRecon;
  return dtcClean({
    savedAt: dtcSavedAt,
    savedBy: (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || '',
    meta: {
      segments: RC.segments, expectedCount: RC.expectedCount, operaCount: RC.operaCount,
      dtcmFinalFees: RC.dtcmFinalFees, operaFileTotal: RC.operaFileTotal,
      expTotal: RC.expTotal, expTotalAdj: RC.expTotalAdj,
      dayUseTotal: RC.dayUseTotal, dayUsePostedTotal: RC.dayUsePostedTotal,
      outsideWindow: RC.outsideWindow || 0, outsideRooms: RC.outsideRooms || [],
      dtcmExtraTotal: RC.dtcmExtraTotal || 0,
      actTotal: RC.actTotal, netVariance: RC.netVariance, missingTotal: RC.missingTotal,
      extraTotal: RC.extraTotal, adjustTotal: RC.adjustTotal,
      mode: RC.mode, reportDate: RC.reportDate, windowStart: RC.windowStart || '', windowEnd: RC.windowEnd || '', rate: RC.rate,
      warnings: RC.warnings || [], exemptAgree: RC.exemptAgree || 0
    },
    gap: RC.gap || null, fixPlan: RC.fixPlan || [],
    checks: RC.checks, dayUse: RC.dayUse, missing: RC.missing, extra: RC.extra,
    duplicates: RC.duplicates, phantom: RC.phantom, adjustments: RC.adjustments,
    noShows: RC.noShows, upsells: RC.upsells, reversals: RC.reversals, actions: RC.actions,
    longstay: dtcLS
  });
}

async function dtcPersist() {
  if (!dtcRecon || typeof fbSet !== 'function') return;
  const doc = dtcSlimState(), at = dtcSavedAt;   // snapshot before awaiting
  // done first, so a colleague never sees the new result with the old ticks
  await fbSet('dtcm/done', { forSavedAt: at, keys: [], updatedAt: new Date().toISOString() });
  await fbSet('dtcm/state', doc);
}

function dtcPersistDone() {
  if (typeof fbSet !== 'function' || !dtcSavedAt) return;
  fbSet('dtcm/done', {
    forSavedAt: dtcSavedAt, keys: [...dtcDone], updatedAt: new Date().toISOString(),
    by: (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || ''
  });
}

// Small dated snapshot for the Trends history (counts and totals only)
function dtcArchive(RC) {
  if (typeof saveHistory !== 'function' || !RC.reportDate) return;
  const c = dtcActionCounts(RC);
  saveHistory('dtcm', {
    netVariance: RC.netVariance, dtcmTotal: RC.expTotalAdj != null ? RC.expTotalAdj : RC.expTotal,
    operaTotal: RC.actTotal, toAdd: c.add, toReverse: c.reverse, toVerify: c.verify,
    checks: (RC.checks || []).length
  }, RC.reportDate);
}

function dtcListen() {
  if (typeof fbListen !== 'function') return;
  fbListen('dtcm/state', doc => {
    if (!doc || !doc.savedAt) {
      if (dtcRemoteSeen && dtcRecon) dtcReset(false);   // a colleague cleared it
      return;
    }
    dtcRemoteSeen = true;
    if (doc.savedAt === dtcSavedAt && dtcRecon) return; // our own write echoing back
    dtcApplyState(doc);
  });
  fbListen('dtcm/done', doc => { dtcDoneDoc = doc || null; dtcSyncDone(); });
}

function dtcApplyState(doc) {
  const A = k => doc[k] || [];
  const RC = Object.assign({}, doc.meta || {}, {
    savedAt: doc.savedAt, savedBy: doc.savedBy || '',
    warnings: (doc.meta && doc.meta.warnings) || [],
    checks: A('checks'), dayUse: A('dayUse'), missing: A('missing'), extra: A('extra'),
    duplicates: A('duplicates'), phantom: A('phantom'), adjustments: A('adjustments'),
    noShows: A('noShows'), upsells: A('upsells'), reversals: A('reversals'), actions: A('actions'),
    gap: doc.gap || null, fixPlan: A('fixPlan')
  });
  const L = doc.longstay;
  dtcLS = L ? Object.assign({ longStays: [], segments: [], totals: [] }, L) : null;
  dtcRecon = RC; dtcSavedAt = doc.savedAt;
  dtcDone = new Set();
  dtcSyncDone(true);
  dtcRenderAll();
}

function dtcSyncDone(silent) {
  if (!dtcRecon || !dtcDoneDoc || dtcDoneDoc.forSavedAt !== dtcSavedAt) return;
  const next = new Set(dtcDoneDoc.keys || []);
  const same = next.size === dtcDone.size && [...next].every(k => dtcDone.has(k));
  if (same) return;
  dtcDone = next;
  if (!silent) dtcRenderSheet();
}

// ── Navigation inside the panel ───────────────────────────
function dtcSwitch(name) {
  dtcTab = name;
  document.querySelectorAll('#panel-dtcm .vt-btn[data-dtct]').forEach(b => b.classList.toggle('on', b.dataset.dtct === name));
  document.querySelectorAll('#panel-dtcm .dtc-view').forEach(v => v.classList.toggle('active', v.id === 'dtcView-' + name));
}

function dtcRenderAll() {
  const RC = dtcRecon;
  if (!RC) return;
  document.getElementById('dtcResults').style.display = 'block';
  document.getElementById('dtcEmpty').style.display = 'none';
  dtcRenderSummary(RC);
  dtcRenderSheet();
  dtcRenderLongStay();
  const acts = RC.actions || [];
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('dtcCnt-summary', acts.length);
  set('dtcCnt-sheet', dtcPostings(RC).length + acts.filter(a => a.action !== 'Add').length);
  set('dtcCnt-longstay', dtcLS ? (dtcLS.longStays || []).length : 0);
  set('badge-dtcm', acts.length);
  const mob = document.getElementById('mob-badge-dtcm'); if (mob) mob.textContent = acts.length || '';
  dtcSwitch(dtcTab);
}

function dtcReset(askConfirm) {
  if (askConfirm && !confirm('Clear the DTCM result for everyone?\n\nColleagues will see it cleared too.')) return;
  dtcRecon = null; dtcLS = null; dtcDone = new Set(); dtcSavedAt = ''; dtcDoneDoc = null; dtcRemoteSeen = false;
  dtcFiles = { dtcm: null, opera: null, longstay: null };
  ['dtcm', 'opera', 'longstay'].forEach(k => {
    const n = document.getElementById('dtcName-' + k), z = document.getElementById('dtcZone-' + k);
    if (n) { n.textContent = 'Click or drop here'; n.style.color = ''; }
    if (z) z.classList.remove('dtc-has-file');
  });
  const btn = document.getElementById('dtcRunBtn'); if (btn) btn.disabled = true;
  document.getElementById('dtcResults').style.display = 'none';
  document.getElementById('dtcEmpty').style.display = 'block';
  const b = document.getElementById('badge-dtcm'); if (b) b.textContent = '—';
  const mob = document.getElementById('mob-badge-dtcm'); if (mob) mob.textContent = '';
  dtcShowError('');
  if (askConfirm && typeof fbSet === 'function') {
    fbSet('dtcm/state', null);
    fbSet('dtcm/done', null);
    if (typeof logActivity === 'function') logActivity('dtcm_cleared', '');
  }
}
function dtcClear() { dtcReset(true); }

// ── Summary tab ───────────────────────────────────────────
function dtcActionCounts(RC) {
  const acts = RC.actions || [];
  const n = k => acts.filter(a => a.action === k).length;
  return { add: n('Add'), reverse: n('Reverse'), verify: n('Verify'), dtcm: n('DTCM'),
           abs: acts.reduce((s, a) => s + (a.abs || 0), 0) };
}

function dtcStatusLevel(RC) {
  const c = dtcActionCounts(RC);
  const dateBad = (RC.warnings || []).some(w => /^DATE MISMATCH/.test(w));
  if (dateBad || c.add || c.reverse || (RC.duplicates || []).length) return 'red';
  if (c.verify || c.dtcm || (RC.checks || []).length || (RC.warnings || []).length) return 'amber';
  return 'green';
}

function dtcSnapshotLine() {
  if (!dtcRecon) return '';
  const c = dtcActionCounts(dtcRecon);
  const doneN = [...dtcDone].length;
  const todo = c.add + c.reverse + c.verify + c.dtcm;
  return `🏦 DTCM Reconciliation${dtcPeriod(dtcRecon) ? ' (' + dtcPeriod(dtcRecon) + ')' : ''} — ` +
    (todo ? `${c.add} to add · ${c.reverse} to reverse · ${c.verify} to verify · ${c.dtcm} to fix in DTCM · ${doneN} ticked` : 'Opera matches DTCM');
}

function dtcRenderSummary(RC) {
  const c = dtcActionCounts(RC);
  const lvl = dtcStatusLevel(RC);
  const todo = c.add + c.reverse + c.verify + c.dtcm;
  const dateBad = (RC.warnings || []).some(w => /^DATE MISMATCH/.test(w));
  const title = dateBad ? 'Stop — the two files are for different dates'
    : lvl === 'green' ? 'All clear — Opera matches DTCM'
    : lvl === 'red'   ? `${todo || 'Some'} correction${todo === 1 ? '' : 's'} needed`
    : (todo ? `${todo} item${todo === 1 ? '' : 's'} to check and fix` : 'Nothing to correct — a few things to double-check');
  const icon = lvl === 'green' ? '✅' : (lvl === 'red' ? '⛔' : '⚠️');
  const dtcmTotal = RC.expTotalAdj != null ? RC.expTotalAdj : RC.expTotal;
  const sign = RC.netVariance > 0 ? '+' : '';
  const chip = (label, n, cls) => `<span class="dtc-chip ${n ? cls : 'zero'}"><b>${n}</b> ${label}</span>`;

  /* How the DTCM XML total turns into the figure compared with Opera */
  const outside = RC.outsideWindow || 0, dayU = RC.dayUseTotal || 0, xtra = (RC.gap && RC.gap.dtcmExtra) || 0;
  const bridge = (RC.dtcmFinalFees && (outside || dayU || xtra)) ? `
      <div class="dtc-warn" style="background:rgba(90,180,232,.1);border-color:rgba(90,180,232,.35);">
        ℹ️ DTCM XML total <b>${dtcNum(RC.dtcmFinalFees)}</b>
        ${xtra ? ` − <b>${dtcNum(xtra)}</b> extra nights DTCM charged (early / late check-out tick)` : ''}
        ${outside ? ` − <b>${dtcNum(outside)}</b> for nights outside this Opera file${(RC.outsideRooms || []).length ? ' (rooms ' + escapeHtml(RC.outsideRooms.join(', ')) + ')' : ''}` : ''}
        ${dayU ? ` − <b>${dtcNum(dayU)}</b> day use in DTCM only` : ''}
        = <b>${dtcNum(dtcmTotal)}</b> compared with Opera <b>${dtcNum(RC.actTotal)}</b>.
        Raw totals, XML vs Opera: <b>${dtcNum(RC.actTotal - RC.dtcmFinalFees)}</b> AED.
      </div>` : '';
  const by = RC.savedBy ? ` · analysed by ${escapeHtml(RC.savedBy)}` : '';
  document.getElementById('dtcStatus').innerHTML = `
    <div class="dtc-status ${lvl}">
      <div class="dtc-status-top">
        <div class="dtc-status-icon">${icon}</div>
        <div>
          <div class="dtc-status-title">${escapeHtml(title)}</div>
          <div class="dtc-status-sub">
            ${RC.mode === 'daily' ? 'Business date <b>' + escapeHtml(RC.reportDate) + '</b> · ' : (RC.mode === 'window' ? 'Nights <b>' + escapeHtml(dtcPeriod(RC)) + '</b> · ' : '')}
            DTCM <b>${dtcNum(dtcmTotal)}</b> AED vs Opera <b>${dtcNum(RC.actTotal)}</b> AED ·
            difference <b>${sign}${dtcNum(RC.netVariance)}</b> AED${by}
          </div>
        </div>
      </div>
      <div class="dtc-chips">
        ${chip('to add', c.add, 'bad')}${chip('to reverse', c.reverse, 'bad')}${chip('to verify', c.verify, 'warn')}${chip('to fix in DTCM', c.dtcm, 'info')}
        ${chip('checks', (RC.checks || []).length, 'warn')}${chip('adjustments (fine)', (RC.adjustments || []).length, 'info')}
      </div>
      ${bridge}
      ${(RC.warnings || []).map(w => `<div class="dtc-warn">⚠️ ${escapeHtml(w)}</div>`).join('')}
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn sm" onclick="dtcCopyNote(this)">📋 Copy handover note</button>
      </div>
    </div>`;

  dtcRenderFixPlan(RC);
  dtcRenderActions(RC);
  dtcRenderChecks(RC);
  dtcRenderHeadline(RC);
  dtcRenderBuckets(RC);
  dtcRenderPrevention(RC);
  const exp = document.getElementById('dtcExportBtn');
  if (exp) exp.style.display = '';
}

// ── Fix plan: how to close the gap between DTCM and Opera ──
function dtcRenderFixPlan(RC) {
  let box = document.getElementById('dtcFixPlan');
  if (!box) {
    const anchor = document.getElementById('dtcStatus');
    if (!anchor) return;
    box = document.createElement('div');
    box.id = 'dtcFixPlan';
    anchor.insertAdjacentElement('afterend', box);
  }
  const G = RC.gap, plan = RC.fixPlan || [];
  if (!G) { box.innerHTML = ''; return; }          // result saved before this feature existed
  const n = v => dtcNum(v), sg = v => (v > 0 ? '+' : (v < 0 ? '−' : '')) + dtcNum(Math.abs(v));
  const row = (label, val, note, strong) => `
    <tr${strong ? ' style="font-weight:700;"' : ''}>
      <td style="padding:6px 8px;">${label}</td>
      <td style="padding:6px 8px;text-align:right;font-family:var(--mono);white-space:nowrap;">${val}</td>
      <td style="padding:6px 8px;font-size:.72rem;color:var(--text2);">${note || ''}</td>
    </tr>`;
  const bridge = `
    <table style="width:100%;border-collapse:collapse;font-size:.8rem;">
      ${row('DTCM XML total', n(G.rawDtcm) + ' AED', '')}
      ${G.outside ? row('− Nights after the Opera file ends', '−' + n(G.outside), 'Rooms ' + escapeHtml((G.outsideRooms || []).join(', ')) + '. <b>Nothing to fix.</b> These nights fall inside the NEXT Opera file. Do not post them now.') : ''}
      ${G.dtcmExtra ? row('− Extra nights DTCM charged (early / late check-out tick)', '−' + n(G.dtcmExtra), 'Rooms ' + escapeHtml((G.dtcmExtraRooms || []).join(', ')) + '. <b>Fix in DTCM</b> (blue items below). No Opera night will ever match these, not even in the next file.') : ''}
      ${G.dayUse ? row('− Day use (DTCM only)', '−' + n(G.dayUse), (G.dayUseRooms || []).length ? 'Rooms ' + escapeHtml(G.dayUseRooms.join(', ')) + '. <b>Check each one</b> (blue items below): cancel it in DTCM if it was not a real stay, or post it in Opera if it was.' : '<b>Nothing to fix.</b>') : ''}
      ${row('= DTCM to compare with Opera', n(G.adjDtcm) + ' AED', '', true)}
      ${row('Opera journal', n(G.rawOpera) + ' AED', '')}
      ${row('Difference between the two totals', sg(G.adjGap) + ' AED', G.adjGap === 0 ? 'The totals agree, but the room lines below are still wrong (the errors cancel each other).' : 'This is the gap the corrections below must close.', true)}
    </table>`;

  const cardColor = a => a === 'Add' ? 'var(--green)' : (a === 'Reverse' ? 'var(--red)' : (a === 'DTCM' ? 'var(--blue)' : 'var(--amber, #f0a43a)'));
  const cards = plan.map((p, i) => `
    <details class="dtc-fp" ${i === 0 ? 'open' : ''} style="border:1px solid var(--border, rgba(128,128,128,.3));border-left:4px solid ${cardColor(p.action)};border-radius:8px;margin:8px 0;padding:8px 12px;">
      <summary style="cursor:pointer;font-weight:600;">
        <span style="font-family:var(--mono);">${i + 1}.</span>
        <span class="dtc-act ${escapeHtml(p.action.toLowerCase())}">${escapeHtml(p.action)}</span>
        ${escapeHtml(p.title)}
        <span class="dtc-fp-eff" style="float:right;font-family:var(--mono);font-size:.72rem;color:var(--text2);">${escapeHtml(p.effect || '')}</span>
      </summary>
      <ol style="margin:8px 0 4px 18px;padding:0;font-size:.78rem;line-height:1.5;">
        ${(p.steps || []).map(t => `<li style="margin:3px 0;">${escapeHtml(t)}</li>`).join('')}
      </ol>
      ${p.monthEnd ? `<div style="font-size:.72rem;margin:2px 0 6px;"><b>Month-end:</b> close this ${p.monthEnd.side === 'DTCM' ? 'in the TD portal' : 'in Opera'} (${p.monthEnd.side} ${p.monthEnd.delta > 0 ? '+' : '−'}${n(Math.abs(p.monthEnd.delta))}).</div>` : ''}
      ${p.uid ? `<div style="font-size:.64rem;color:var(--text3);">DTCM ID ${dtcChip(p.uid)}</div>` : ''}
    </details>`).join('');

  let after;
  if (!plan.length) {
    after = `<div style="font-size:.8rem;">Nothing to do for the room lines.</div>`;
  } else if (G.leftover === 0) {
    const sure = plan.map((p, i) => (p.action === 'Add' || p.action === 'Reverse') ? i + 1 : 0).filter(Boolean).join(', ');
    after = `<div style="font-size:.8rem;line-height:1.55;">
      ${sure ? `After step${sure.includes(',') ? 's' : ''} ${sure}: Opera is <b>${n(G.operaAfterKeep)}</b> AED.` : `Opera is <b>${n(G.rawOpera)}</b> AED.`}
      ${G.verT ? `The “check the reservation” item(s) then close in one of two ways: reverse in Opera (Opera becomes <b>${n(G.operaAfter)}</b>, DTCM stays <b>${n(G.adjDtcm)}</b>), or fix it in the TD portal (DTCM becomes <b>${n(G.dtcmAfterKeep)}</b>, Opera stays <b>${n(G.operaAfterKeep)}</b>). Either way the two sides end equal.` : `DTCM is <b>${n(G.adjDtcm)}</b> AED, so both sides agree.`}
      ${G.monthEnd ? `<div style="margin-top:10px;padding:10px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg2);">
        <b>Month-end tally.</b> Close each item the recommended way (${G.monthEnd.operaChanges} in Opera, ${G.monthEnd.dtcmChanges} in the TD portal — each card says which) and both sides end at
        DTCM XML <b>${n(G.monthEnd.dtcm)}</b> AED · Opera <b>${n(G.monthEnd.opera)}</b> AED${G.monthEnd.equal ? ' — <b>equal</b>.' : '. ⚠️ Still not equal: something is not explained yet.'}
        Day use counts: DTCM always charges it, and the night audit never posts it, so post 10 AED TD (7510) by hand in Opera on the same day for every real day use.</div>` : ''}
      ${(G.dtcmExtra || G.dayUse) ? `<br>The blue DTCM items are separate: each one is fixed in the TD portal (or, for a real day use / charged late check-out, posted in Opera). Once all are fixed in DTCM, the DTCM XML total drops by <b>${n((G.dtcmExtra || 0) + (G.dayUse || 0))}</b> AED.` : ''}
    </div>`;
  } else {
    after = `<div class="dtc-warn" style="font-size:.8rem;">⚠️ Even after every step above, Opera and DTCM still differ by <b>${sg(G.leftover)}</b> AED. Look at the Checks and Phantom lists below: something is not explained yet.</div>`;
  }

  box.innerHTML = `
    <div style="margin:14px 0;padding:14px;border:1px solid var(--border, rgba(128,128,128,.3));border-radius:10px;">
      <div style="font-weight:700;font-size:.95rem;margin-bottom:4px;">🧭 How to close the gap between DTCM and Opera</div>
      <div style="font-size:.72rem;color:var(--text2);margin-bottom:8px;">Step A: what explains the difference between the two totals</div>
      ${bridge}
      <div style="font-size:.72rem;color:var(--text2);margin:14px 0 2px;">Step B: what to do, in this order${plan.length ? '' : ' (nothing)'}</div>
      ${cards}
      <div style="font-size:.72rem;color:var(--text2);margin:12px 0 4px;">Step C: result</div>
      ${after}
    </div>`;
}

function dtcRenderActions(RC) {
  const actions = RC.actions || [];
  const meta = document.getElementById('dtcActionMeta');
  const body = document.getElementById('dtcActionBody');
  if (!actions.length) {
    body.innerHTML = '<tr><td colspan="7" class="tbl-empty">Nothing to do — books are balanced.</td></tr>';
    meta.textContent = 'Nothing to do';
    return;
  }
  const totalAbs = actions.reduce((s, a) => s + (a.abs || 0), 0);
  meta.textContent = `${actions.length} correction${actions.length === 1 ? '' : 's'} · ±${dtcNum(totalAbs, 0)} AED`;
  body.innerHTML = actions.map((a, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><span class="dtc-act ${escapeHtml(a.action.toLowerCase())}">${escapeHtml(a.action)}</span></td>
      <td><b>${escapeHtml(a.room)}</b>${a.uid ? `<div style="font-size:.64rem;color:var(--text3);margin-top:3px;white-space:nowrap;">DTCM ID ${dtcChip(a.uid)}</div>` : ''}</td>
      <td style="font-family:var(--mono);white-space:nowrap;">${escapeHtml(a.date)}</td>
      <td style="text-align:right;font-family:var(--mono);font-weight:700;color:${a.amount < 0 ? 'var(--red)' : 'var(--green)'};">${a.amount > 0 ? '+' : ''}${dtcNum(a.amount)} AED</td>
      <td>${escapeHtml(a.where)}</td>
      <td style="font-size:.72rem;color:var(--text2);">${escapeHtml(a.why || '')}</td>
    </tr>`).join('');
}

function dtcCard(rows, fix) {
  const r = rows.map(([k, v, cls]) =>
    `<div class="k">${escapeHtml(k)}</div><div class="v ${cls || ''}">${escapeHtml(v)}</div>`).join('');
  return `<div class="dtc-vcard"><div class="dtc-vrow">${r}</div>${fix ? `<div class="dtc-fix"><b>Fix:</b> ${escapeHtml(fix)}</div>` : ''}</div>`;
}

function dtcBucket(cls, title, subtitle, count, metaAmount, cards, open) {
  const meta = count === 0 ? 'None' : `${count} item${count === 1 ? '' : 's'}${metaAmount ? ' · ' + metaAmount : ''}`;
  return `
    <details class="dtc-coll ${cls}"${open ? ' open' : ''}>
      <summary>
        <span class="dtc-chev">▸</span>
        <span class="dtc-sum-title">${escapeHtml(title)} <span class="dtc-sum-sub">— ${escapeHtml(subtitle)}</span></span>
        <span class="dtc-sum-meta">${escapeHtml(meta)}</span>
      </summary>
      <div class="dtc-coll-body">${count === 0 ? '<div class="dtc-empty">None</div>' : cards.join('')}</div>
    </details>`;
}

function dtcRenderChecks(RC) {
  const list = RC.checks || [];
  document.getElementById('dtcChecks').innerHTML = dtcBucket(
    'dtc-b-checks', 'Checks', 'Both files agree, but it still looks wrong', list.length,
    RC.exemptAgree ? `${RC.exemptAgree} long-stay exemptions OK` : '',
    list.map(c => dtcCard([
      ['Check', c.type], ['Severity', c.severity], ['Room', c.room], ['Guest', c.guest],
      ['Date', c.date], c.uid ? ['DTCM ID', c.uid] : null, ['Detail', c.detail]
    ].filter(Boolean), c.fix)),
    list.length > 0);
}

function dtcRenderHeadline(RC) {
  const nv = dtcNum(RC.netVariance);
  const sign = RC.netVariance > 0 ? '+' : '';
  const cls = RC.netVariance > 0 ? 'neg' : (RC.netVariance < 0 ? 'pos' : '');
  const line = (l, v, c) => `<div class="dtc-hline"><span class="l">${l}</span><span class="v ${c || ''}">${v}</span></div>`;
  const n = a => (a || []).length;
  document.getElementById('dtcHeadline').innerHTML =
    line('Net variance', `${sign}${nv} AED`, cls) +
    line('DTCM XML FinalFees_21', `${dtcNum(RC.dtcmFinalFees)} AED`) +
    line('Expected total (rebuilt)', `${dtcNum(RC.expTotal)} AED`) +
    line('Posted total (Opera, signed)', `${dtcNum(RC.actTotal)} AED`) +
    line('Report mode', `${RC.mode === 'daily' ? 'Daily · ' + escapeHtml(RC.reportDate) : (RC.mode === 'window' ? 'Window · ' + escapeHtml(dtcPeriod(RC)) : 'Multi-night (expanded from check-in)')} · ${dtcNum(RC.rate, 0)} AED / bedroom`) +
    `<div class="dtc-hbuckets">
      <span><b>Missing</b> ${n(RC.missing)} · +${dtcNum(RC.missingTotal, 0)} AED</span>
      <span><b>Extra</b> ${n(RC.extra)} · ${dtcNum(RC.extraTotal, 0)} AED</span>
      <span><b>Duplicate</b> ${n(RC.duplicates)}</span><span><b>Phantom</b> ${n(RC.phantom)}</span>
      <span><b>Adjustment</b> ${n(RC.adjustments)}</span><span><b>No-show</b> ${n(RC.noShows)}</span>
      <span><b>Upsell</b> ${n(RC.upsells)}</span><span><b>Reversal</b> ${n(RC.reversals)}</span>
      <span><b>Checks</b> ${n(RC.checks)}</span>
    </div>`;
}

function dtcRenderBuckets(RC) {
  const L = a => a || [];
  const aed = (n, dp) => `${dtcNum(n, dp)} AED`;
  const out = [];

  out.push(dtcBucket('dtc-b-missing', 'Missing', 'Expected in DTCM, absent from Opera', L(RC.missing).length,
    RC.missingTotal > 0 ? `+${aed(RC.missingTotal, 0)}` : '',
    L(RC.missing).map(m => dtcCard([
      ['Room', m.room + (m.movedRoom ? '  ⟲ room-move' : '')], ['Guest', m.guest], ['Business date', m.date],
      ['Stay', m.checkInISO && m.checkOutISO ? `${m.checkInISO} → ${m.checkOutISO}` : '—'],
      ['Reservation #', m.reservation || '—'], ['DTCM UID', m.transactionuid || '—'],
      ['Stay status', m.status || '—'], ['Expected', aed(m.expected)], ['Posted', aed(m.posted)],
      ['Variance', '+' + aed(m.variance), 'neg'], ['Root cause', m.cause || '—']
    ], m.fix))));

  out.push(dtcBucket('dtc-b-extra', 'Extra', 'Posted in Opera, not expected by DTCM', L(RC.extra).length,
    RC.extraTotal < 0 ? aed(RC.extraTotal, 0) : '',
    L(RC.extra).map(m => dtcCard([
      ['Room', m.room], ['Opera guest', m.guest], ['DTCM guest', m.dtcmGuest || '—'],
      ['Business date', m.date], ['Stay night #', m.nightNo ? String(m.nightNo) : '—'],
      ['Expected', aed(m.expected)], ['Posted', aed(m.posted)], ['Variance', aed(m.variance), 'neg'],
      ['Root cause', m.cause || '—']
    ], m.fix))));

  out.push(dtcBucket('dtc-b-dayuse', 'Day use', 'Same-day check-in/out — normal, no action', L(RC.dayUse).length,
    (RC.dayUseTotal || RC.dayUsePostedTotal) ? aed((RC.dayUseTotal || 0) + (RC.dayUsePostedTotal || 0), 0) : '',
    L(RC.dayUse).map(d => dtcCard([
      ['Room', d.room], ['Guest', d.guest], ['Date', d.date],
      [d.posted ? 'Opera posted' : 'DTCM charge', aed(d.amount)], ['Note', d.note || '—']
    ]))));

  out.push(dtcBucket('dtc-b-dup', 'Duplicate', 'Same room + date + amount posted more than once', L(RC.duplicates).length, '',
    L(RC.duplicates).map(d => dtcCard([
      ['Room', d.room], ['Guest', d.guest], ['Business date', d.businessDate],
      ['Amount each', aed(d.amount)], ['Copies', String(d.count)], ['Excess', '−' + aed(d.excess), 'neg'],
      ['TRX_NO', d.trxNos], ['Root cause', d.cause || '—']
    ], d.fix))));

  out.push(dtcBucket('dtc-b-phantom', 'Phantom', 'Charged in Opera, no matching guest/room in DTCM', L(RC.phantom).length, '',
    L(RC.phantom).map(p => dtcCard([
      ['Room', p.room], ['Guest', p.guest], ['Business date', p.businessDate],
      ['Posted', aed(p.amount)], ['Root cause', p.cause || '—']
    ], p.fix))));

  out.push(dtcBucket('dtc-b-adj', 'Adjustment', 'Manual accommodation lines & DTCM compliance credits', L(RC.adjustments).length,
    RC.adjustTotal ? aed(RC.adjustTotal, 0) : '',
    L(RC.adjustments).map(a => dtcCard([
      ['Room', a.room], ['Guest', a.guest], ['Business date', a.businessDate],
      ['Amount', aed(a.amount), a.amount < 0 ? 'neg' : 'pos'], ['Kind', a.kind || '—'],
      ['Remark', a.remark || '—'], ['Root cause', a.cause || '—']
    ], a.fix))));

  out.push(dtcBucket('dtc-b-info', 'No-show', 'No-show charges posted against the room', L(RC.noShows).length, '',
    L(RC.noShows).map(n => dtcCard([
      ['Room', n.room], ['Guest', n.guest], ['Business date', n.businessDate],
      ['Amount', aed(n.amount)], ['Remark', n.remark || '—']
    ]))));

  out.push(dtcBucket('dtc-b-info', 'Upsell', 'Upgrade / early check-in / late check-out upsells', L(RC.upsells).length, '',
    L(RC.upsells).map(u => dtcCard([
      ['Room', u.room], ['Guest', u.guest], ['Business date', u.businessDate],
      ['Amount', aed(u.amount)], ['Description', u.desc || '—']
    ]))));

  out.push(dtcBucket('dtc-b-info', 'Reversal', 'Correction lines already netted against originals', L(RC.reversals).length, '',
    L(RC.reversals).map(r => dtcCard([
      ['Room', r.room], ['Guest', r.guest], ['Business date', r.businessDate],
      ['Amount', aed(r.amount)], ['Remark', r.remark || '—'], ['Root cause', r.cause || '—']
    ], r.fix))));

  document.getElementById('dtcBuckets').innerHTML = out.join('');
}

function dtcRenderPrevention(RC) {
  const bullets = [];
  const ex = RC.extra || [];
  const has = k => ex.some(e => e.kind === k);
  const toPost = dtcPostings(RC);
  if (toPost.length) {
    const rooms = [...new Set(toPost.map(m => m.room))].slice(0, 3).join(', ');
    bullets.push(`Missing postings (room ${rooms}…) — check the Opera routing / night-audit TD rules for these rooms.`);
  }
  if (has('over_cap') || has('over_cap_diff_guest')) {
    bullets.push('TD charged past night 30 — add a night-audit alert for stays of 30+ nights, and post the "TD NA as guest stayed more than 30 nights" adjustment the same night.');
  }
  if (has('not_in_dtcm') || has('wrong_room')) {
    bullets.push('Charged in Opera but absent from DTCM — verify the DTCM check-in interface for new arrivals before night audit; a TD collected but not reported is a compliance risk.');
  }
  if ((RC.duplicates || []).length) {
    bullets.push(`${RC.duplicates.length} duplicate posting${RC.duplicates.length === 1 ? '' : 's'} in the Opera journal — enable same-day duplicate detection in the night audit.`);
  }
  if ((RC.checks || []).some(c => c.type === 'Guest name differs')) {
    bullets.push('Guest names differ between Opera and DTCM on some rooms — fix guest swaps/room moves in both systems the same day.');
  }
  if ((RC.checks || []).some(c => c.type === 'Zero fee, short stay')) {
    bullets.push('0-TD stays under 30 nights — keep the proof (earlier stay or exemption) on file for a DTCM audit.');
  }
  if ((RC.adjustments || []).length) {
    bullets.push(`${RC.adjustments.length} adjustment line${RC.adjustments.length === 1 ? '' : 's'} (manual accommodation, 30-night credit, no-show) — legitimate and already netted.`);
  }
  if ((RC.extra || []).some(e => e.kind === 'day_use_repost')) {
    bullets.push('Day use followed by a night for the same guest: Opera posts the day use by hand and the night by audit, but DTCM keeps both bookings as one check-in. Tick "Charge Extra Night on Early Check-In" in the TD portal the same morning, then confirm the stay shows the extra 10 AED in the next DTCM XML.');
  }
  if ((RC.extra || []).some(e => e.kind === 'early_arrival')) {
    bullets.push('Guests arriving after midnight but before night audit: Opera dates their first night on the previous business date, DTCM on the calendar day. Agree one rule at the desk and fix the DTCM check-in date the same morning.');
  }
  bullets.push(RC.mode === 'daily'
    ? `Daily DTCM report: every row is one night on ${RC.reportDate}; TD stops after 30 consecutive nights.`
    : RC.mode === 'window'
      ? `DTCM report covers ${dtcPeriod(RC)}: each row's Nights is the nights inside that window, matched to the same Opera dates.`
      : 'Expected postings expanded night-by-night from check-in with the 30-night cap.');
  bullets.push('Keep both source files (XML + TXT) in the reconciliation folder for the audit trail.');
  const list = bullets.slice(0, 8);
  document.getElementById('dtcPrevention').innerHTML = list.map(b => `<li>${escapeHtml(b)}</li>`).join('');
  document.getElementById('dtcPreventionMeta').textContent = `${list.length} bullets`;
}

async function dtcCopyNote(btn) {
  if (!dtcRecon) return;
  const RC = dtcRecon, c = dtcActionCounts(RC), L = [];
  L.push(`TD reconciliation${dtcPeriod(RC) ? ' — ' + dtcPeriod(RC) : ''}`);
  L.push(`DTCM ${dtcNum(RC.expTotalAdj != null ? RC.expTotalAdj : RC.expTotal)} AED · Opera ${dtcNum(RC.actTotal)} AED · difference ${dtcNum(RC.netVariance)} AED` +
    (RC.dtcmFinalFees ? ` (DTCM XML total ${dtcNum(RC.dtcmFinalFees)} AED)` : ''));
  L.push(`To add ${c.add} · to reverse ${c.reverse} · to verify ${c.verify} · to fix in DTCM ${c.dtcm} · checks ${(RC.checks || []).length}`);
  (RC.warnings || []).forEach(w => L.push('WARNING: ' + w));
  if ((RC.actions || []).length) {
    L.push('', 'TO DO:');
    RC.actions.forEach((a, i) => L.push(`${i + 1}. ${a.action} room ${a.room} · ${a.date} · ${dtcNum(a.amount)} AED${a.uid ? ' · DTCM ID ' + a.uid : ''} — ${a.why || ''}`));
  } else {
    L.push('', 'Nothing to correct.');
  }
  if (RC.gap) {
    const G = RC.gap;
    L.push('', `WHY THE TOTALS DIFFER: DTCM XML ${dtcNum(G.rawDtcm)}` +
      (G.outside ? ` − ${dtcNum(G.outside)} nights after the Opera file (rooms ${(G.outsideRooms || []).join(', ')}), nothing to fix` : '') +
      (G.dayUse ? ` − ${dtcNum(G.dayUse)} day use, nothing to fix` : '') +
      ` = ${dtcNum(G.adjDtcm)} vs Opera ${dtcNum(G.rawOpera)}.`);
  }
  if ((RC.fixPlan || []).length) {
    L.push('', 'HOW TO FIX:');
    RC.fixPlan.forEach((p, i) => {
      L.push(`${i + 1}. ${p.action.toUpperCase()} — ${p.title}`);
      (p.steps || []).forEach((t, j) => L.push(`   ${String.fromCharCode(97 + j)}) ${t}`));
    });
  }
  if ((RC.checks || []).length) {
    L.push('', 'CHECKS:');
    RC.checks.forEach(k => L.push(`- ${k.type} · room ${k.room} · ${k.detail}`));
  }
  copyToClipboard(L.join('\n'), null, '');
  showToast('Handover note copied ✓', 'ok');
}

// ── To Do tab (work sheet with ticks) ─────────────────────
function dtcGroupByRoom(list) {
  const byKey = new Map();
  for (const item of list) {
    const key = item.room + '|' + (item.guest || '') + '|' + (item.checkInISO || '');
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(item);
  }
  const keys = [...byKey.keys()].sort((a, b) => {
    const [ra, ga, da] = a.split('|'), [rb, gb, db] = b.split('|');
    return (+ra - +rb) || String(da).localeCompare(String(db)) || String(ga).localeCompare(String(gb));
  });
  return keys.map(key => {
    const items = byKey.get(key).sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    const f = items[0] || {};
    return {
      room: f.room, guest: f.guest || '', reservation: f.reservation, transactionuid: f.transactionuid,
      checkInISO: f.checkInISO, checkOutISO: f.checkOutISO, nights: f.nights, status: f.status,
      items, total: dtcR2(items.reduce((s, x) => s + (x.amount || 0), 0))
    };
  });
}

function dtcChip(value) {
  if (!value) return '—';
  return `<code>${escapeHtml(value)}</code><button class="dtc-copy" data-dtc-copy="${escapeHtml(value)}">copy</button>`;
}

/* Postings to add = the 'missing' nights that still have an Add action. A missing night that was
   paired with an over-posting in another room (room move that nets to zero) has no Add action and
   must NOT be posted, or the guest is charged twice. */
function dtcPostings(RC) {
  const adds = new Set((RC.actions || []).filter(a => a.action === 'Add').map(a => a.room + '|' + a.date));
  return (RC.missing || []).filter(m => adds.has(m.room + '|' + m.date));
}

function dtcRenderSheet() {
  const RC = dtcRecon;
  const out = document.getElementById('dtcSheetOut');
  const bar = document.getElementById('dtcSheetActions');
  if (!RC || !out) return;
  dtcWork  = dtcPostings(RC);
  dtcFixes = (RC.actions || []).filter(a => a.action !== 'Add');

  if (!dtcWork.length && !dtcFixes.length) {
    out.innerHTML = '<div class="dtc-note ok"><b>All caught up.</b> Nothing to add, reverse or verify.</div>';
    bar.style.display = 'none';
    return;
  }
  const byRoom = dtcGroupByRoom(dtcWork);
  const grand = dtcR2(dtcWork.reduce((s, x) => s + (x.amount || 0), 0));

  const fixesHtml = !dtcFixes.length ? '' : `
    <div class="dtc-room">
      <div class="dtc-room-hd">
        <span>Corrections — reverse / verify / fix in DTCM<span class="dtc-room-hint">Not postings to add — fix in Opera, in the TD portal, or confirm with the reservation</span></span>
        <span class="dtc-room-tot">${dtcFixes.length} item${dtcFixes.length === 1 ? '' : 's'}</span>
      </div>
      <table class="dtc-sheet-table">
        <thead><tr><th class="chk"></th><th>Action</th><th>Room</th><th>Date</th><th style="text-align:right;">Amount</th><th>Why</th></tr></thead>
        <tbody>${dtcFixes.map(f => {
          const key = 'fix|' + f.action + '|' + f.room + '|' + f.date;
          const on = dtcDone.has(key);
          return `<tr class="${on ? 'done' : ''}">
            <td class="chk"><input type="checkbox" data-dtc-key="${escapeHtml(key)}"${on ? ' checked' : ''}></td>
            <td><span class="dtc-act ${escapeHtml(f.action.toLowerCase())}">${escapeHtml(f.action)}</span></td>
            <td><b>${escapeHtml(f.room)}</b></td>
            <td style="font-family:var(--mono);white-space:nowrap;">${escapeHtml(f.date)}</td>
            <td class="amt">${dtcNum(f.amount)} AED</td>
            <td style="font-size:.72rem;">${escapeHtml(f.why || '')}</td></tr>`;
        }).join('')}</tbody>
      </table>
    </div>`;

  const summary = !dtcWork.length ? '' : `
    <div class="dtc-note"><b>${dtcWork.length}</b> posting${dtcWork.length === 1 ? '' : 's'} to add across
      <b>${byRoom.length}</b> stay${byRoom.length === 1 ? '' : 's'} — total <b>${dtcNum(grand)} AED</b>.
      Ticks are shared with everyone on shift.</div>`;

  const rooms = byRoom.map(g => {
    const stay = (g.checkInISO && g.checkOutISO) ? `${g.checkInISO} → ${g.checkOutISO}` : (g.checkInISO || '');
    const ident = [
      ['Search room', dtcChip(g.room)], ['Guest name', dtcChip(g.guest)], ['Stay dates', dtcChip(stay)],
      ['Nights', escapeHtml(g.nights || '—')],
      g.reservation ? ['Reservation #', dtcChip(g.reservation)] : null,
      g.transactionuid ? ['DTCM UID', dtcChip(g.transactionuid)] : null,
      g.status ? ['Stay status', escapeHtml(g.status)] : null
    ].filter(Boolean).map(([k, v]) => `<div class="k">${k}</div><div class="v">${v}</div>`).join('');
    return `
    <div class="dtc-room">
      <div class="dtc-room-hd">
        <span><span class="dtc-room-num">Room ${escapeHtml(g.room)}</span><span class="dtc-room-hint">${escapeHtml(g.guest)}</span></span>
        <span class="dtc-room-tot">${g.items.length} entr${g.items.length === 1 ? 'y' : 'ies'} · ${dtcNum(g.total)} AED</span>
      </div>
      <div class="dtc-ident">${ident}</div>
      <table class="dtc-sheet-table">
        <thead><tr><th class="chk"></th><th>Date to post</th><th>Guest</th><th style="text-align:right;">Amount</th></tr></thead>
        <tbody>${g.items.map(it => {
          const key = it.room + '|' + it.date;
          const on = dtcDone.has(key);
          return `<tr class="${on ? 'done' : ''}">
            <td class="chk"><input type="checkbox" data-dtc-key="${escapeHtml(key)}"${on ? ' checked' : ''}></td>
            <td style="font-family:var(--mono);">${escapeHtml(it.date)}</td>
            <td>${escapeHtml(it.guest)}</td>
            <td class="amt">${dtcNum(it.amount)} AED</td></tr>`;
        }).join('')}</tbody>
      </table>
    </div>`;
  }).join('');

  out.innerHTML = fixesHtml + summary + rooms;
  bar.style.display = 'flex';
  dtcUpdateProgress();
}

function dtcToggleDone(cb) {
  const key = cb.getAttribute('data-dtc-key');
  const tr = cb.closest('tr');
  if (tr) tr.classList.toggle('done', cb.checked);
  if (cb.checked) dtcDone.add(key); else dtcDone.delete(key);
  dtcUpdateProgress();
  dtcPersistDone();
}

function dtcUpdateProgress() {
  const all  = document.querySelectorAll('#dtcSheetOut tbody input[type=checkbox]');
  const done = document.querySelectorAll('#dtcSheetOut tbody input[type=checkbox]:checked');
  const pct = all.length ? Math.round(done.length / all.length * 100) : 0;
  const t = document.getElementById('dtcProgText'), b = document.getElementById('dtcBarFill');
  if (t) t.textContent = `${done.length} / ${all.length} done (${pct}%)`;
  if (b) b.style.width = pct + '%';
}

function dtcClearTicks() {
  if (!confirm('Un-tick every row for everyone?')) return;
  dtcDone = new Set();
  dtcRenderSheet();
  dtcPersistDone();
}

async function dtcCopyChip(btn) {
  copyToClipboard(btn.getAttribute('data-dtc-copy') || '', null, '');
  const old = btn.textContent;
  btn.textContent = 'copied'; btn.classList.add('copied');
  setTimeout(() => { btn.textContent = old; btn.classList.remove('copied'); }, 1200);
}

function dtcPrint() {
  if (!dtcRecon) return;
  const RC = dtcRecon;
  const rows = (RC.actions || []).map((a, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(a.action)}</td><td>${escapeHtml(a.room)}</td>
    <td>${escapeHtml(a.date)}</td><td style="text-align:right">${dtcNum(a.amount)}</td><td>${escapeHtml(a.why || '')}</td>
    <td style="width:28px">&#9744;</td></tr>`).join('');
  const win = window.open('', '_blank');
  if (!win) { showToast('Allow pop-ups to print', 'err'); return; }
  win.document.write(`<!doctype html><title>DTCM to-do ${escapeHtml(RC.reportDate || '')}</title>
    <style>body{font:12px system-ui,sans-serif;padding:20px}table{border-collapse:collapse;width:100%}
    td,th{border:1px solid #bbb;padding:5px 8px;text-align:left}th{background:#eee}</style>
    <h2>DTCM reconciliation — ${escapeHtml(RC.reportDate || '')}</h2>
    <p>DTCM ${dtcNum(RC.expTotal)} AED · Opera ${dtcNum(RC.actTotal)} AED · difference ${dtcNum(RC.netVariance)} AED</p>
    <table><thead><tr><th>#</th><th>Action</th><th>Room</th><th>Date</th><th>AED</th><th>Why</th><th></th></tr></thead>
    <tbody>${rows || '<tr><td colspan="7">Nothing to do</td></tr>'}</tbody></table>`);
  win.document.close();
  win.print();
}

// ── Long Stay tab ─────────────────────────────────────────
function dtcRenderLongStay() {
  const out = document.getElementById('dtcLongOut');
  if (!out) return;
  const LS = dtcLS;
  if (!LS) {
    out.innerHTML = `<div class="dtc-note">No Long Stay report was added. Drop the <code>finjrnlbytax_…txt</code> file with the other two and analyse again to see stays past ${window.LongStay ? window.LongStay.DEFAULT_THRESHOLD : 30} nights.</div>`;
    return;
  }
  const longs = LS.longStays || [], segs = LS.segments || [], tots = LS.totals || [];
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const excessTotal = dtcR2(longs.reduce((s, x) => s + (x.excessAmount || 0), 0));

  const head = `
    <div class="kpi-row c4">
      <div class="kpi rose"><div class="kpi-accent"></div><div class="kpi-label">Long stays</div><div class="kpi-val">${longs.length}</div><div class="kpi-sub">more than ${LS.threshold} nights</div></div>
      <div class="kpi amber"><div class="kpi-accent"></div><div class="kpi-label">Excess TD</div><div class="kpi-val">${dtcNum(excessTotal, 0)}</div><div class="kpi-sub">AED charged past the cap</div></div>
      <div class="kpi sky"><div class="kpi-accent"></div><div class="kpi-label">Stay segments</div><div class="kpi-val">${LS.segmentCount != null ? LS.segmentCount : segs.length}</div><div class="kpi-sub">${plural(LS.rowCount || 0, 'posting')} read</div></div>
      <div class="kpi mint"><div class="kpi-accent"></div><div class="kpi-label">Total net</div><div class="kpi-val">${dtcNum(LS.total, 0)}</div><div class="kpi-sub">AED in this file</div></div>
    </div>
    <div class="dtc-note">Nights are counted only inside this file's date range — a wider date range gives a more accurate excess.</div>`;

  const longTable = longs.length === 0 ? '<div class="dtc-empty">No long stays found.</div>' : `
    <div class="tbl-wrap"><table>
      <thead><tr><th>Guest</th><th>NAME_ID</th><th>Stay</th><th style="text-align:right;">Nights</th>
        <th style="text-align:right;">Excess nights</th><th style="text-align:right;">Excess (AED)</th><th>Rooms</th><th style="text-align:right;">Net (AED)</th></tr></thead>
      <tbody>${longs.map(s => `<tr>
        <td>${escapeHtml(s.guest)}</td><td style="font-family:var(--mono);">${escapeHtml(s.nameId)}</td>
        <td style="font-family:var(--mono);">${escapeHtml(s.stayStart)} → ${escapeHtml(s.stayEnd)}</td>
        <td style="text-align:right;">${s.nights}</td>
        <td style="text-align:right;color:var(--red);font-weight:700;">${s.excessNights}</td>
        <td style="text-align:right;color:var(--red);font-weight:700;">${dtcNum(s.excessAmount)}</td>
        <td>${escapeHtml(s.roomsUsed)}${s.moved ? ' ⟲' : ''}</td>
        <td style="text-align:right;">${dtcNum(s.totalNet)}</td></tr>`).join('')}</tbody>
    </table></div>`;

  const totTable = `
    <div class="tbl-wrap"><table>
      <thead><tr><th>TAX_TRX_CODE</th><th>Description</th><th style="text-align:right;">Net</th><th style="text-align:right;">Tax</th>
        <th style="text-align:right;">Gross</th><th style="text-align:right;">Rows</th></tr></thead>
      <tbody>${tots.map(t => `<tr><td>${escapeHtml(t.taxCode)}</td><td>${escapeHtml(t.taxDesc)}</td>
        <td style="text-align:right;">${dtcNum(t.net)}</td><td style="text-align:right;">${dtcNum(t.tax)}</td>
        <td style="text-align:right;">${dtcNum(t.gross)}</td><td style="text-align:right;">${t.rows}</td></tr>`).join('')}</tbody>
    </table></div>`;

  const segTable = `
    <div class="tbl-wrap"><table>
      <thead><tr><th>Guest</th><th>NAME_ID</th><th>Stay</th><th style="text-align:right;">Nights</th><th>Rooms</th><th style="text-align:right;">Net (AED)</th></tr></thead>
      <tbody>${segs.map(s => `<tr><td>${escapeHtml(s.guest)}</td><td style="font-family:var(--mono);">${escapeHtml(s.nameId)}</td>
        <td style="font-family:var(--mono);">${escapeHtml(s.stayStart)} → ${escapeHtml(s.stayEnd)}</td>
        <td style="text-align:right;">${s.nights}</td><td>${escapeHtml(s.roomsUsed)}${s.moved ? ' ⟲' : ''}</td>
        <td style="text-align:right;">${dtcNum(s.totalNet)}</td></tr>`).join('')}</tbody>
    </table></div>
    ${(LS.segmentCount || 0) > segs.length ? `<div class="dtc-empty">Showing the ${segs.length} longest of ${LS.segmentCount} segments.</div>` : ''}`;

  const wrap = (cls, title, meta, body, open) => `
    <details class="dtc-coll ${cls}"${open ? ' open' : ''}><summary><span class="dtc-chev">▸</span>
      <span class="dtc-sum-title">${title}</span><span class="dtc-sum-meta">${meta}</span></summary>
      <div class="dtc-coll-body">${body}</div></details>`;

  out.innerHTML = head +
    wrap('dtc-b-long', `Long stays (more than ${LS.threshold} nights)`, plural(longs.length, 'guest'), longTable, true) +
    wrap('dtc-b-info', 'Group totals by TAX_TRX_CODE', plural(tots.length, 'group'), totTable, false) +
    wrap('dtc-b-info', 'All stay segments', String(LS.segmentCount != null ? LS.segmentCount : segs.length), segTable, false);
}

// ── Excel exports ─────────────────────────────────────────
function dtcNeedXlsx() {
  if (typeof XLSX === 'undefined') { showToast('Excel library not loaded — check your connection', 'err'); return false; }
  return true;
}

function dtcExportFull() {
  if (!dtcRecon || !dtcNeedXlsx()) return;
  const RC = dtcRecon, wb = XLSX.utils.book_new();
  const sheet = (arr, headers) => {
    if (!arr || !arr.length) return XLSX.utils.aoa_to_sheet([headers, ['(none)']]);
    return XLSX.utils.aoa_to_sheet([headers, ...arr.map(o => headers.map(h => o[h] !== undefined ? o[h] : ''))]);
  };
  const add = (arr, headers, name) => XLSX.utils.book_append_sheet(wb, sheet(arr, headers), name);
  add(RC.missing, ['room','guest','date','checkInISO','checkOutISO','nights','reservation','transactionuid','status','expected','posted','variance','amount','cause','fix'], 'MISSING');
  add(RC.extra, ['room','guest','dtcmGuest','date','nightNo','expected','posted','variance','kind','cause','fix','note'], 'EXTRA');
  add(RC.dayUse, ['room','guest','date','amount','note'], 'DAY_USE');
  add(RC.checks, ['type','severity','room','guest','date','detail','fix'], 'CHECKS');
  add(RC.duplicates, ['room','guest','businessDate','amount','count','excess','trxNos','cause','fix'], 'DUPLICATE');
  add(RC.phantom, ['room','guest','businessDate','amount','cause','fix'], 'PHANTOM');
  add(RC.adjustments, ['room','guest','businessDate','amount','kind','remark','cause','fix'], 'ADJUSTMENT');
  add(RC.noShows, ['room','guest','businessDate','amount','remark'], 'NO_SHOW');
  add(RC.upsells, ['room','guest','businessDate','amount','desc'], 'UPSELL');
  add(RC.reversals, ['room','guest','businessDate','amount','remark'], 'REVERSAL');
  add(RC.actions, ['action','room','date','amount','where','why'], 'ACTIONS');
  XLSX.writeFile(wb, `DTCM_Reconciliation_${RC.reportDate || 'multi'}.xlsx`);
}

function dtcExportSheet() {
  if (!dtcRecon || !dtcNeedXlsx()) return;
  if (!dtcWork.length && !dtcFixes.length) return;
  const wb = XLSX.utils.book_new();
  if (dtcWork.length) {
    const rows = [['Room','Room (raw)','Date to post','Guest','Check-in','Check-out','Nights','Reservation #','DTCM UID','Status','Amount (AED)']];
    dtcWork.forEach(m => rows.push([m.room, m.roomRaw || m.room, m.date, m.guest, m.checkInISO || '', m.checkOutISO || '',
      m.nights || '', m.reservation || '', m.transactionuid || '', m.status || '', m.amount]));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Manual Entry');
  }
  if (dtcFixes.length) {
    const fr = [['Action','Room','Date','Amount (AED)','Where','Why']];
    dtcFixes.forEach(f => fr.push([f.action, f.room, f.date, f.amount, f.where, f.why || '']));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(fr), 'Corrections');
  }
  XLSX.writeFile(wb, `DTCM_Manual_Entry_${dtcRecon.reportDate || 'multi'}.xlsx`);
}

function dtcExportLong() {
  if (!dtcLS) { showToast('No Long Stay report loaded', 'err'); return; }
  if (!dtcNeedXlsx()) return;
  const LS = dtcLS, wb = XLSX.utils.book_new();
  const longRows = [['Guest','NAME_ID','Stay Start','Stay End','Nights','Excess Nights','Excess Amount','Rooms Used','Rooms Count','Moved','Total Net','Total Tax','Total Gross']];
  (LS.longStays || []).forEach(s => longRows.push([s.guest, s.nameId, s.stayStart, s.stayEnd, s.nights, s.excessNights,
    s.excessAmount, s.roomsUsed, s.roomsCount, s.moved ? 'YES' : '', s.totalNet, s.totalTax, s.totalGross]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(longRows), 'Long Stays');
  const segRows = [['Guest','NAME_ID','Stay Start','Stay End','Nights','Rooms Used','Rooms Count','Moved','Total Net']];
  (LS.segments || []).forEach(s => segRows.push([s.guest, s.nameId, s.stayStart, s.stayEnd, s.nights, s.roomsUsed,
    s.roomsCount, s.moved ? 'YES' : '', s.totalNet]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(segRows), 'All Segments');
  const totRows = [['TAX_TRX_CODE','Description','Net','Tax','Gross','Rows']];
  (LS.totals || []).forEach(t => totRows.push([t.taxCode, t.taxDesc, t.net, t.tax, t.gross, t.rows]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(totRows), 'Group Totals');
  XLSX.writeFile(wb, 'DTCM_Long_Stay.xlsx');
}

dtcInit();
