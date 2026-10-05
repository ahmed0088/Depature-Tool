// ═══════════════════════════════════════════════════════════
//  month-end.js — month-end packs (print / save as PDF)
//   • DTCM month-end report  — both totals, the bridge, every correction
//     with the side it is closed on and whether it is ticked done.
//   • Package commission report — packages and AED per seller, with the
//     pinned / manual / skipped decisions listed, for payroll.
// ═══════════════════════════════════════════════════════════

const ME_HOTEL = 'Ibis Styles Dubai';

function _meWho() {
  return (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) ? currentProfile.name : '';
}
function _meNow() {
  return new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
const _meN = v => (Math.round((+v || 0) * 100) / 100).toFixed(2);
const _meE = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function _mePrint(title, body) {
  const win = window.open('', '_blank');
  if (!win) { showToast('Allow pop-ups to print or save as PDF', 'err'); return; }
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${_meE(title)}</title>
  <style>
    body{font:12px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;color:#1d1d1b;padding:28px;max-width:1000px;margin:auto}
    h1{font-size:20px;margin:0 0 2px} .sub{color:#666;margin-bottom:18px}
    h2{font-size:14px;margin:22px 0 8px;border-bottom:2px solid #1d1d1b;padding-bottom:4px}
    table{border-collapse:collapse;width:100%;margin-bottom:6px} td,th{border:1px solid #ccc;padding:5px 8px;text-align:left;vertical-align:top} td:nth-child(4){white-space:nowrap}
    th{background:#f1f1f1;font-size:11px;text-transform:uppercase;letter-spacing:.03em} .r{text-align:right;font-variant-numeric:tabular-nums}
    .tot td{font-weight:700;background:#fafafa} .ok{color:#15803d;font-weight:700} .bad{color:#b91c1c;font-weight:700}
    .box{border:2px solid #1d1d1b;border-radius:8px;padding:10px 14px;margin:10px 0} .muted{color:#777}
    .sign{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:40px} .sign div{border-top:1px solid #333;padding-top:4px;color:#555}
    @media print{body{padding:0} .noprint{display:none}}
  </style></head><body>
  <div class="noprint" style="margin-bottom:14px"><button onclick="print()" style="padding:8px 14px;font-weight:700">🖨 Print / Save as PDF</button></div>
  ${body}
  <div class="sign"><div>Prepared by</div><div>Checked by (Front Office Manager / Finance)</div></div>
  </body></html>`);
  win.document.close();
}

// ── DTCM month-end report ────────────────────────────────
function meDtcmReport() {
  const RC = typeof dtcRecon !== 'undefined' ? dtcRecon : null;
  if (!RC) { showToast('Run DTCM Recon first', 'err'); return; }
  if (typeof logActivity === 'function') logActivity('dtcm_month_end_report', RC.reportDate || '');
  const G = RC.gap || {};
  const period = typeof dtcPeriod === 'function' ? dtcPeriod(RC) : (RC.reportDate || '');
  const done = typeof dtcDone !== 'undefined' ? dtcDone : new Set();
  const plan = RC.fixPlan || [];
  const code = window.HotelCfg ? HotelCfg.codeLabel() : '7510';
  const rate = window.HotelCfg ? HotelCfg.rate() : 10;
  const doneKey = p => 'fix|' + p.action + '|' + p.room + '|' + (p.dates || [])[0];
  const rows = plan.map((p, i) => {
    const me = p.monthEnd || {};
    const ticked = done.has(doneKey(p)) || done.has((p.room || '') + '|' + (p.dates || [])[0]);
    return `<tr><td>${i + 1}</td><td>${_meE(p.action)}</td><td>${_meE(p.room)}</td><td>${_meE((p.dates || []).join(', '))}</td>
      <td>${_meE(p.title || p.why || '')}</td><td>${_meE(me.side || '')}</td><td class="r">${me.delta != null ? (me.delta > 0 ? '+' : '−') + _meN(Math.abs(me.delta)) : ''}</td>
      <td>${ticked ? '<span class="ok">✓ done</span>' : '☐'}</td></tr>`;
  }).join('');
  const meBox = G.monthEnd ? `<div class="box">Once every item is closed as listed: <b>DTCM XML ${_meN(G.monthEnd.dtcm)} AED</b> · <b>Opera ${_meN(G.monthEnd.opera)} AED</b> —
      ${G.monthEnd.equal ? '<span class="ok">the two totals are equal</span>' : '<span class="bad">still NOT equal</span>'}.</div>` : '';
  const body = `
    <h1>${ME_HOTEL} — Tourism Dirham month-end reconciliation</h1>
    <div class="sub">Period ${_meE(period)} · TD code ${_meE(code)} · AED ${_meN(rate)} per room per night · generated ${_meNow()}${_meWho() ? ' by ' + _meE(_meWho()) : ''}</div>
    <h2>1 · Totals</h2>
    <table><tbody>
      <tr><td>DTCM XML total</td><td class="r">${_meN(G.rawDtcm)}</td></tr>
      ${G.dtcmExtra ? `<tr><td>− extra nights DTCM charged (early / late check-out tick) — rooms ${_meE((G.dtcmExtraRooms || []).join(', '))}</td><td class="r">−${_meN(G.dtcmExtra)}</td></tr>` : ''}
      ${G.outside ? `<tr><td>− nights after the Opera file ends</td><td class="r">−${_meN(G.outside)}</td></tr>` : ''}
      ${G.dayUse ? `<tr><td>− day use / wrong check-ins in DTCM only — rooms ${_meE((G.dayUseRooms || []).join(', '))}</td><td class="r">−${_meN(G.dayUse)}</td></tr>` : ''}
      <tr class="tot"><td>DTCM compared with Opera</td><td class="r">${_meN(G.adjDtcm)}</td></tr>
      <tr><td>Opera TD journal</td><td class="r">${_meN(G.rawOpera)}</td></tr>
      <tr class="tot"><td>Difference</td><td class="r">${_meN(G.adjGap)}</td></tr>
    </tbody></table>
    ${meBox}
    <h2>2 · Corrections (${plan.length})</h2>
    ${plan.length ? `<table><thead><tr><th>#</th><th>Type</th><th>Room</th><th>Date</th><th>What</th><th>Close in</th><th class="r">AED</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`
      : '<p>Nothing to correct — Opera matches DTCM.</p>'}
    <h2>3 · Other checks</h2>
    <p class="muted">${(RC.checks || []).length} low-priority checks (guest-name differences, room moves that net to zero, etc.) are in the app under DTCM Recon → Checks.</p>`;
  _mePrint(`TD month-end ${period}`, body);
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
    <h1>${ME_HOTEL} — Package upsell commission</h1>
    <div class="sub">From the IN-Gauge export checked against Opera · generated ${_meNow()}${_meWho() ? ' by ' + _meE(_meWho()) : ''}</div>
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
