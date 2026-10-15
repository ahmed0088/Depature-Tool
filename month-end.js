// ═══════════════════════════════════════════════════════════
//  month-end.js — month-end packs (print / save as PDF)
//   • DTCM month-end report  — both totals, the bridge, every correction
//     with the side it is closed on and whether it is ticked done.
//   • Package commission report — packages and AED per seller, with the
//     pinned / manual / skipped decisions listed, for payroll.
// ═══════════════════════════════════════════════════════════

// The hotel's own name (the three hotels share this code), from the sidebar logo / settings.
function _meHotel() {
  const el = document.getElementById('hotelName');
  const t = el && el.textContent ? el.textContent.trim() : '';
  if (t) return t;
  try { const s = JSON.parse(localStorage.getItem('ibis_settings') || '{}'); if (s && s.hotelName) return String(s.hotelName); } catch (_) {}
  return 'Hotel';
}

function _meWho() {
  return (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) ? currentProfile.name : '';
}
function _meNow() {
  return new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
const _meN = v => (Math.round((+v || 0) * 100) / 100).toFixed(2);
const _meE = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Shared print page: a clean A4 page in a new window, with a bar on top that says how to save it
 * as a PDF (hidden when printed). Used by the month-end packs, Skip The Clean and the seller board.
 *   opts.sign      — signature labels, e.g. ['Prepared by', 'Checked by'] (none if empty)
 *   opts.signName  — name written under the first signature line (who made the page)
 *   opts.landscape — print the page landscape
 * Returns the window, or null when pop-ups are blocked.
 */
function mePrintPage(title, body, opts) {
  opts = opts || {};
  const win = window.open('', '_blank');
  if (!win) { if (typeof showToast === 'function') showToast('Allow pop-ups for this site to print or save as PDF', 'err'); return null; }
  const sign = (opts.sign || []).length ? `<div class="sign">${opts.sign.map((l, i) => `<div><span class="sl"></span><b>${_meE(l)}</b>
      <span class="sn">${i === 0 && opts.signName ? 'Name: ' + _meE(opts.signName) : 'Name: ………………………………'}</span><span class="sn">Date: ……………………</span></div>`).join('')}</div>` : '';
  win.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${_meE(title)}</title>
  <style>
    @page{size:A4 ${opts.landscape ? 'landscape' : 'portrait'};margin:14mm}
    *{box-sizing:border-box}
    body{font:12px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1d1d1b;background:#fff;padding:24px;max-width:1040px;margin:auto;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .bar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;background:#f4f1ea;border:1px solid #e0d9c8;border-radius:10px;padding:10px 14px;margin-bottom:18px}
    .bar button{padding:9px 16px;font:inherit;font-weight:700;border-radius:8px;border:1px solid #1d1d1b;background:#1d1d1b;color:#fff;cursor:pointer}
    .bar span{color:#555;flex:1;min-width:220px}
    .hd{display:flex;justify-content:space-between;gap:16px;align-items:flex-end;border-bottom:3px solid #1d1d1b;padding-bottom:10px;margin-bottom:14px;flex-wrap:wrap}
    .hotel{font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:#777;font-weight:700}
    h1{font-size:21px;margin:2px 0 0;line-height:1.2} .sub{color:#555;margin-top:3px}
    .meta{text-align:right;color:#555;font-size:11px}
    h2{font-size:13.5px;margin:22px 0 8px;border-bottom:1.5px solid #1d1d1b;padding-bottom:4px;break-after:avoid}
    table{border-collapse:collapse;width:100%;margin-bottom:6px} td,th{border:1px solid #cfcfcf;padding:5px 7px;text-align:left;vertical-align:top}
    thead{display:table-header-group} tr{break-inside:avoid}
    th{background:#f1f1f1;font-size:10.5px;text-transform:uppercase;letter-spacing:.03em} .r{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
    .nw{white-space:nowrap} .mono{font-family:Consolas,"SF Mono",Menlo,monospace}
    .tot td{font-weight:700;background:#fafafa} .ok{color:#15803d;font-weight:700} .bad{color:#b91c1c;font-weight:700} .warn{color:#b45309;font-weight:700}
    .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin:6px 0 4px}
    .kpi{border:1px solid #cfcfcf;border-radius:8px;padding:8px 10px;break-inside:avoid} .kpi small{display:block;font-size:9.5px;text-transform:uppercase;letter-spacing:.06em;color:#777;font-weight:700}
    .kpi b{display:block;font-size:19px;font-variant-numeric:tabular-nums;margin-top:1px} .kpi i{display:block;font-style:normal;color:#777;font-size:10.5px}
    .box{border:2px solid #1d1d1b;border-radius:8px;padding:10px 14px;margin:10px 0} .muted{color:#777}
    .note{border-left:3px solid #1d1d1b;background:#f7f7f5;padding:8px 12px;margin:8px 0;color:#333}
    .note ul{margin:4px 0 0;padding-left:18px}
    .barc{display:inline-block;height:9px;border-radius:3px;background:#1d1d1b;vertical-align:middle}
    .sign{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:40px;margin-top:46px;break-inside:avoid}
    .sign div{display:flex;flex-direction:column;gap:4px;color:#444} .sign .sl{border-top:1px solid #333;height:0;margin-bottom:2px} .sign .sn{color:#666;font-size:11px}
    .foot{margin-top:26px;color:#888;font-size:10.5px;border-top:1px solid #ddd;padding-top:6px}
    @media (max-width:600px){body{padding:12px} .meta{text-align:left} .tw{overflow-x:auto} .tw table{min-width:640px}}
    @media print{body{padding:0;max-width:none} .bar{display:none}}
  </style></head><body>
  <div class="bar"><button type="button" onclick="print()">🖨 Print / Save as PDF</button>
    <span>To get a PDF: press the button, then choose <b>Save as PDF</b> as the printer (on a phone: Share → Print, then pinch out the preview to save it).</span></div>
  ${body}
  ${sign}
  <div class="foot">Made with HotelOps · ${_meE(_meNow())}${_meWho() ? ' · ' + _meE(_meWho()) : ''}</div>
  </body></html>`);
  win.document.close();
  try { win.focus(); } catch (_) {}
  return win;
}

/** Page header used by every pack: hotel, title, subtitle, and when / who on the right. */
function mePrintHead(title, sub) {
  return `<div class="hd"><div><div class="hotel">${_meE(_meHotel())}</div><h1>${_meE(title)}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div>
    <div class="meta">Made ${_meE(_meNow())}${_meWho() ? '<br>by ' + _meE(_meWho()) : ''}</div></div>`;
}

function _mePrint(title, body) {
  return mePrintPage(title, body, { sign: ['Prepared by', 'Checked by (Front Office Manager / Finance)'], signName: _meWho() });
}

// ── DTCM month-end pack (for finance) ────────────────────
// Reads the result of DTCM Recon (dtcRecon, dtcLS, dtcDone) — never re-calculates anything.
const _ME_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function _meIsoLabel(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${+m[3]} ${_ME_MONTHS[+m[2] - 1].slice(0, 3)} ${m[1]}` : String(iso || '');
}
function _meMonthOf(RC) {
  const a = RC.windowStart || RC.reportDate || '', b = RC.windowEnd || RC.reportDate || '';
  const ma = String(a).match(/^(\d{4})-(\d{2})/), mb = String(b).match(/^(\d{4})-(\d{2})/);
  if (!ma) return '';
  const one = `${_ME_MONTHS[+ma[2] - 1]} ${ma[1]}`;
  if (!mb || (ma[1] === mb[1] && ma[2] === mb[2])) return one;
  return `${one} – ${_ME_MONTHS[+mb[2] - 1]} ${mb[1]}`;
}
/** Is a fix-plan item ticked done on the DTCM sheet? Same keys dtcm.js writes. */
function _meDtcFixed(p, done) {
  const dates = p.dates || [];
  if (!dates.length) return false;
  if (p.action === 'Add') return dates.every(d => done.has(p.room + '|' + d) || done.has('fix|Add|' + p.room + '|' + d));
  return dates.some(d => done.has('fix|' + p.action + '|' + p.room + '|' + d)) || done.has((p.room || '') + '|' + dates[0]);
}

function meDtcmReport() {
  const RC = typeof dtcRecon !== 'undefined' ? dtcRecon : null;
  if (!RC) { showToast('Run DTCM Recon first (add the DTCM XML and the Opera journal)', 'err'); return; }
  if (typeof logActivity === 'function') logActivity('dtcm_month_end_report', RC.reportDate || RC.windowStart || '');
  const G = RC.gap || {};
  const period = typeof dtcPeriod === 'function' ? dtcPeriod(RC) : (RC.reportDate || '');
  const periodTxt = RC.windowStart ? `${_meIsoLabel(RC.windowStart)} → ${_meIsoLabel(RC.windowEnd)}` : (RC.reportDate ? _meIsoLabel(RC.reportDate) : period);
  const month = _meMonthOf(RC) || period || 'This period';
  const done = typeof dtcDone !== 'undefined' && dtcDone ? dtcDone : new Set();
  const LS = typeof dtcLS !== 'undefined' ? dtcLS : null;
  const plan = RC.fixPlan || [];
  const code = window.HotelCfg ? HotelCfg.codeLabel() : '7510';
  const rate = window.HotelCfg ? HotelCfg.rate() : (RC.rate || 10);
  const cap = window.HotelCfg ? HotelCfg.cap() : 30;
  const has = v => v != null && v !== '';
  const dtcmT = has(G.adjDtcm) ? G.adjDtcm : (has(RC.expTotalAdj) ? RC.expTotalAdj : RC.expTotal);
  const operaT = has(G.rawOpera) ? G.rawOpera : RC.actTotal;
  const rawDtcm = has(G.rawDtcm) ? G.rawDtcm : RC.dtcmFinalFees;
  const diff = Math.round(((+operaT || 0) - (+dtcmT || 0)) * 100) / 100;
  const nightsD = Math.round((+dtcmT || 0) / rate);
  const nightsO = Math.round((+operaT || 0) / rate);
  const fixed = plan.filter(p => _meDtcFixed(p, done)), open = plan.filter(p => !_meDtcFixed(p, done));
  const amt = list => list.reduce((s, p) => s + Math.abs(+(p.monthEnd && p.monthEnd.delta != null ? p.monthEnd.delta : p.amount) || 0), 0);
  const sgn = v => (v > 0 ? '+' : v < 0 ? '−' : '') + _meN(Math.abs(v));
  // the 30-night cap: what the reconciliation itself found, and the Long Stay report when it was added
  const overCap = (RC.extra || []).filter(e => e.kind === 'over_cap');
  const capChecks = (RC.checks || []).filter(c => /cap/i.test(c.type || ''));
  const longs = LS ? (LS.longStays || []) : [];
  const exN = longs.reduce((s, x) => s + (+x.excessNights || 0), 0), exA = longs.reduce((s, x) => s + (+x.excessAmount || 0), 0);

  const kpi = (l, v, s, cls) => `<div class="kpi"><small>${l}</small><b${cls ? ` class="${cls}"` : ''}>${v}</b>${s ? `<i>${s}</i>` : ''}</div>`;
  const fixRow = (p, i) => {
    const me = p.monthEnd || {};
    const d = me.delta != null ? me.delta : p.amount;
    return `<tr><td>${i + 1}</td><td class="nw">${_meE(p.action)}</td><td class="nw">${_meE(p.room)}</td><td class="nw">${_meE((p.dates || []).join(', '))}</td>
      <td>${_meE(p.title || p.why || '')}</td><td class="nw">${_meE(me.side ? (me.side === 'DTCM' ? 'TD portal' : 'Opera') : '')}</td><td class="r">${d != null ? sgn(+d) : ''}</td></tr>`;
  };
  const fixTable = (list, empty) => list.length
    ? `<div class="tw"><table><thead><tr><th>#</th><th>Type</th><th>Room</th><th>Date</th><th>What</th><th>Close in</th><th class="r">AED</th></tr></thead><tbody>${list.map(fixRow).join('')}
       <tr class="tot"><td colspan="6">Total (${list.length})</td><td class="r">${_meN(amt(list))}</td></tr></tbody></table></div>`
    : `<p class="muted">${empty}</p>`;
  const meBox = G.monthEnd ? `<div class="box">Once every correction is closed as listed: <b>DTCM ${_meN(G.monthEnd.dtcm)} AED</b> · <b>Opera ${_meN(G.monthEnd.opera)} AED</b> —
      ${G.monthEnd.equal ? '<span class="ok">the two totals are equal</span>' : '<span class="bad">still NOT equal</span>'}.</div>` : '';

  const body = `
    ${mePrintHead('Tourism Dirham month-end pack', `<b>${_meE(month)}</b> · nights ${_meE(periodTxt)} · TD code ${_meE(code)} · AED ${_meN(rate)} per room per night`)}
    ${RC.savedAt ? `<p class="muted" style="margin:-6px 0 8px">Reconciliation run ${_meE(new Date(RC.savedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }))}${RC.savedBy ? ' by ' + _meE(RC.savedBy) : ''}.</p>` : ''}
    <h2>1 · Key figures</h2>
    <div class="kpis">
      ${kpi('Room nights (DTCM)', nightsD.toLocaleString('en-GB'), 'nights that pay TD (total ÷ ' + _meN(rate) + ')')}
      ${kpi('TD expected (DTCM)', _meN(dtcmT), 'AED, compared with Opera')}
      ${kpi('TD collected (Opera)', _meN(operaT), 'AED in the TD journal · ' + nightsO.toLocaleString('en-GB') + ' nights')}
      ${kpi('Difference', sgn(diff), 'AED, Opera − DTCM', Math.abs(diff) < 0.005 ? 'ok' : 'bad')}
      ${kpi('Corrections', plan.length, _meN(amt(plan)) + ' AED in total')}
      ${kpi('Still open', open.length, _meN(amt(open)) + ' AED', open.length ? 'warn' : 'ok')}
      ${kpi('Fixed', fixed.length, _meN(amt(fixed)) + ' AED', 'ok')}
    </div>
    ${meBox}
    <h2>2 · How the two totals compare</h2>
    <div class="tw"><table><tbody>
      <tr><td>DTCM XML total</td><td class="r">${_meN(rawDtcm)}</td></tr>
      ${G.dtcmExtra ? `<tr><td>− extra nights DTCM charged (early / late check-out tick) — rooms ${_meE((G.dtcmExtraRooms || []).join(', '))}</td><td class="r">−${_meN(G.dtcmExtra)}</td></tr>` : ''}
      ${G.outside ? `<tr><td>− nights after the Opera file ends — rooms ${_meE((G.outsideRooms || []).join(', '))}</td><td class="r">−${_meN(G.outside)}</td></tr>` : ''}
      ${G.dayUse ? `<tr><td>− day use / wrong check-ins in DTCM only — rooms ${_meE((G.dayUseRooms || []).join(', '))}</td><td class="r">−${_meN(G.dayUse)}</td></tr>` : ''}
      <tr class="tot"><td>DTCM compared with Opera</td><td class="r">${_meN(dtcmT)}</td></tr>
      <tr><td>Opera TD journal</td><td class="r">${_meN(operaT)}</td></tr>
      <tr class="tot"><td>Difference (Opera − DTCM)</td><td class="r">${sgn(diff)}</td></tr>
    </tbody></table></div>
    <h2>3 · Corrections still open (${open.length})</h2>
    ${fixTable(open, plan.length ? 'None — every correction is ticked done.' : 'Nothing to correct — Opera matches DTCM.')}
    <h2>4 · Corrections fixed (${fixed.length})</h2>
    ${fixTable(fixed, 'None ticked done yet. Tick each one on the DTCM page (To-do sheet) once it is fixed.')}
    <h2>5 · Long stays (${cap}-night rule)</h2>
    <div class="note">TD is charged for the first <b>${cap} nights</b> of a stay only; night ${cap + 1} onwards is free. The reconciliation already applies this rule.
      <ul>
        <li>Nights charged past the cap found in this reconciliation: <b>${overCap.length}</b>${overCap.length ? ' (' + _meN(overCap.reduce((s, e) => s + Math.abs(+e.variance || +e.amount || 0), 0)) + ' AED, listed in the corrections above)' : ''}.</li>
        ${capChecks.length ? `<li>Cap checks to look at: <b>${capChecks.length}</b> (rooms ${_meE([...new Set(capChecks.map(c => c.room))].join(', '))}).</li>` : ''}
        <li>${LS ? `Long Stay report: <b>${longs.length}</b> stay${longs.length === 1 ? '' : 's'} over ${_meE(LS.threshold || cap)} nights, <b>${exN}</b> night${exN === 1 ? '' : 's'} past the cap, <b>${_meN(exA)}</b> AED charged past the cap.` : 'The Long Stay report (finjrnlbytax) was not added, so stays past the cap were not listed.'}</li>
      </ul></div>
    ${longs.length ? `<div class="tw"><table><thead><tr><th>Guest</th><th>Stay</th><th class="r">Nights</th><th class="r">Past cap</th><th class="r">AED past cap</th><th>Rooms</th></tr></thead><tbody>
      ${longs.map(s => `<tr><td>${_meE(s.guest)}</td><td class="nw">${_meE(s.stayStart)} → ${_meE(s.stayEnd)}</td><td class="r">${_meE(s.nights)}</td><td class="r">${_meE(s.excessNights)}</td><td class="r">${_meN(s.excessAmount)}</td><td>${_meE(s.roomsUsed)}</td></tr>`).join('')}
      </tbody></table></div>` : ''}
    <h2>6 · Other notes</h2>
    <p class="muted">${(RC.checks || []).length} low-priority check${(RC.checks || []).length === 1 ? '' : 's'} (guest-name differences, room moves that net to zero, etc.) are in the app under DTCM Recon → Checks.</p>
    ${(RC.warnings || []).length ? `<div class="note"><b>Warnings from the reconciliation</b><ul>${RC.warnings.map(w => `<li>${_meE(w)}</li>`).join('')}</ul></div>` : ''}`;
  mePrintPage(`TD month-end ${month}`, body, { sign: ['Prepared by (Front Office)', 'Checked by (Finance)'], signName: _meWho() });
}

// ── Package commission report ────────────────────────────
function mePkgCommission() {
  const res = typeof pkgResults !== 'undefined' ? pkgResults : [];
  if (!res.length) { showToast('Run Package Audit first', 'err'); return; }
  if (typeof logActivity === 'function') logActivity('pkg_commission_report', `${res.length} lines`);
  const label = u => (typeof _pkgUserLabel === 'function' ? _pkgUserLabel(u) : u) || 'Unassigned';
  const credited = res.filter(r => r.verdict === 'credit' && !r.pinSkip && !r.noSeller);
  const by = {};
  credited.forEach(r => {
    const who = label(r.user || r.employee);
    const b = by[who] = by[who] || { pkgs: new Set(), nights: 0, aed: 0, fam: {} };
    const fam = typeof _pkgFamilyName === 'function' ? _pkgFamilyName(r) : (r.product || r.code);
    b.pkgs.add(r.conf + '|' + fam);
    b.nights++;
    b.aed += parseFloat(r.price ?? r.charge) || 0;
    b.fam[fam] = (b.fam[fam] || 0) + 1;
  });
  const sellers = Object.keys(by).sort((a, b) => by[b].aed - by[a].aed);
  const tot = sellers.reduce((s, k) => ({ p: s.p + by[k].pkgs.size, n: s.n + by[k].nights, a: s.a + by[k].aed }), { p: 0, n: 0, a: 0 });
  const rows = sellers.map(k => `<tr><td>${_meE(k)}</td><td class="r">${by[k].pkgs.size}</td><td class="r">${by[k].nights}</td>
    <td>${_meE(Object.entries(by[k].fam).map(([f, n]) => `${f} ×${n}`).join(', '))}</td><td class="r">${_meN(by[k].aed)}</td></tr>`).join('');
  const pinned = res.filter(r => r.pin);
  const seen = new Set();
  const pinRows = pinned.filter(r => { const k = r.conf + '|' + (r.family || r.code); if (seen.has(k)) return false; seen.add(k); return true; })
    .map(r => `<tr><td>${_meE(r.conf)}</td><td>${_meE(r.room)}</td><td>${_meE(r.family || r.product || r.code)}</td>
      <td>${r.pin.skip ? 'Skipped' : r.pin.manual ? 'Manual sale (not in Opera)' : 'Seller pinned'}</td><td>${_meE(r.pin.seller ? label(r.pin.seller) : '')}</td>
      <td>${_meE(r.pin.by || '')}${r.pin.at ? ' · ' + _meE(r.pin.at.slice(0, 10)) : ''}</td></tr>`).join('');
  const denied = res.filter(r => r.verdict === 'deny' && !r.pinSkip);
  const body = `
    ${mePrintHead('Package upsell commission', 'From the IN-Gauge export checked against Opera')}
    <h2>1 · Per seller</h2>
    <table><thead><tr><th>Seller</th><th class="r">Packages</th><th class="r">Nights</th><th>What</th><th class="r">AED</th></tr></thead>
      <tbody>${rows}<tr class="tot"><td>Total</td><td class="r">${tot.p}</td><td class="r">${tot.n}</td><td></td><td class="r">${_meN(tot.a)}</td></tr></tbody></table>
    <p class="muted">Credited charges only: denied, skipped and system-booked (TARS) charges are not counted. A package billed over several nights counts once under Packages and once per night under Nights.</p>
    <h2>2 · Decisions made by hand (${seen.size})</h2>
    ${seen.size ? `<table><thead><tr><th>Conf.</th><th>Room</th><th>Package</th><th>Decision</th><th>Seller</th><th>By · date</th></tr></thead><tbody>${pinRows}</tbody></table>` : '<p class="muted">None.</p>'}
    <h2>3 · Charges to remove (${denied.length})</h2>
    ${denied.length ? `<table><thead><tr><th>Conf.</th><th>Room</th><th>Package</th><th class="r">AED</th><th>Reason</th></tr></thead><tbody>${
      denied.map(r => `<tr><td>${_meE(r.conf)}</td><td>${_meE(r.room)}</td><td>${_meE(r.family || r.code)}</td><td class="r">${_meN(r.charge)}</td><td>${_meE(r.denyReason || '')}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">None.</p>'}`;
  _mePrint('Package commission', body);
}

async function mePkgCommissionCopy() {
  const res = typeof pkgResults !== 'undefined' ? pkgResults : [];
  if (!res.length) { showToast('Run Package Audit first', 'err'); return; }
  const label = u => (typeof _pkgUserLabel === 'function' ? _pkgUserLabel(u) : u) || 'Unassigned';
  const by = {};
  res.filter(r => r.verdict === 'credit' && !r.pinSkip && !r.noSeller).forEach(r => {
    const who = label(r.user || r.employee);
    const b = by[who] = by[who] || { p: new Set(), n: 0, a: 0 };
    b.p.add(r.conf + '|' + (r.family || r.code)); b.n++; b.a += parseFloat(r.price ?? r.charge) || 0;
  });
  const tsv = 'Seller\tPackages\tNights\tAED\n' + Object.entries(by).map(([k, b]) => `${k}\t${b.p.size}\t${b.n}\t${_meN(b.a)}`).join('\n');
  try { await navigator.clipboard.writeText(tsv); showToast('Commission per seller copied — paste into Excel', 'ok'); }
  catch (_) { showToast('Copy blocked', 'err'); }
}
