// ═══════════════════════════════════════════════════════════
//  td-audit.js — Tourism Dirham 30-Night Cap Audit
//  Ibis Ops Platform
//
//  Problem: Opera keeps charging Tourism Dirham (tax code 7510)
//  every night for the life of a reservation. DTCM only counts/
//  charges TD for a guest's first 30 CONSECUTIVE nights — after
//  that the guest is "Long Stay" and TD should stop.
//
//  Logic (DTCM is always the source of truth):
//    1. Read DTCM export → find guests whose stay has run
//       30+ nights (in-house or already checked out).
//    2. capDate = check-in + 30 nights = first night that should
//       NOT be charged.
//    3. Read Opera's Financial Transactions by Tax Type export,
//       keep only tax code 7510 rows.
//    4. For each long-stay room, any Opera 7510 charge dated on
//       or after capDate is an EXCESS charge → flag it.
//    5. Match Opera ↔ DTCM by ROOM NUMBER (not name — DTCM names
//       can differ from Opera names). A loose name-overlap check
//       is shown as a "verify" flag, never used to reject a match.
// ═══════════════════════════════════════════════════════════

let tdaOperaRows = [];   // parsed Opera 7510 charge rows
let tdaDtcmRows  = [];   // parsed DTCM stay rows
let tdaResults   = [];   // computed per-room exceptions
let tdaFilter    = 'all';
let tdaSearchQ   = '';

const TDA_CAP_NIGHTS = 30;

// ───────────────────────── date helpers ─────────────────────────
function tdaParseOperaDate(s) {
  // Opera CHAR_TRX_DATE format: "01-08-26" (dd-mm-yy)
  if (!s) return null;
  const m = s.trim().match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})/);
  if (!m) return null;
  let [, d, mo, y] = m;
  if (y.length === 2) y = (parseInt(y, 10) < 70 ? '20' : '19') + y;
  const dt = new Date(parseInt(y, 10), parseInt(mo, 10) - 1, parseInt(d, 10));
  return isNaN(dt.getTime()) ? null : dt;
}
function tdaParseDtcmDate(s) {
  // DTCM format: "29/7/2026" (d/m/yyyy)
  if (!s) return null;
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const dt = new Date(parseInt(y, 10), parseInt(mo, 10) - 1, parseInt(d, 10));
  return isNaN(dt.getTime()) ? null : dt;
}
function tdaFmtDate(d) {
  if (!d) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function tdaAddDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function tdaNormRoom(r) { return (r || '').toString().trim().replace(/^0+(?=\d)/, ''); }
function tdaNormName(s) { return (s || '').toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean).sort().join(' '); }
function tdaNameOverlap(a, b) {
  const A = new Set(tdaNormName(a).split(' ').filter(w => w.length > 1));
  const B = new Set(tdaNormName(b).split(' ').filter(w => w.length > 1));
  if (!A.size || !B.size) return false;
  for (const w of A) if (B.has(w)) return true;
  return false;
}

// ───────────────────────── parsers ─────────────────────────
// Two Opera exports are accepted, auto-detected by header shape:
//   A) "Financial Transactions by Tax Type"  (finjrnlbytax)
//      columns: TAX_TRX_CODE, NAME_ID, ROOM, DISPLAY_NAME, CHAR_TRX_DATE, TAX_AMOUNT
//   B) "Financial Journal by Transaction"    (finjrnlbytrans)
//      columns: TRX_CODE, ROOM, GUEST_FULL_NAME, BUSINESS_FORMAT_DATE, CASHIER_DEBIT, CASHIER_CREDIT
//      amount = CASHIER_DEBIT − CASHIER_CREDIT (this correctly captures negative
//      "EXCEEDS 30 NIGHTS" reversal rows, e.g. CASHIER_DEBIT=-10, CASHIER_CREDIT=0)
function tdaParseOperaTSV(raw) {
  const lines = raw.split(/\r?\n/).filter(l => l.trim().length);
  if (!lines.length) return [];
  const headers = lines[0].split('\t').map(h => h.trim());
  const idx = {};
  headers.forEach((h, i) => idx[h] = i);
  const colCount = headers.length;

  const isTaxSchema   = 'TAX_TRX_CODE' in idx && 'TAX_AMOUNT' in idx;
  const isTransSchema = 'TRX_CODE' in idx && 'CASHIER_DEBIT' in idx && 'CASHIER_CREDIT' in idx;

  if (!isTaxSchema && !isTransSchema) {
    throw new Error('Opera file columns not recognized. Export either "Financial Transactions by Tax Type" (finjrnlbytax) or "Financial Journal by Transaction" (finjrnlbytrans) from Opera.');
  }

  const dateCol = isTaxSchema
    ? idx['CHAR_TRX_DATE']
    : (('BUSINESS_FORMAT_DATE' in idx) ? idx['BUSINESS_FORMAT_DATE'] : idx['BUSINESS_DATE']);

  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t');

    if (isTaxSchema) {
      // Opera sometimes truncates rows tied to a REFERENCE/adjustment code (e.g. an
      // "EXCEEDS 30 NIGHTS" credit reversal) to ~20 columns instead of the full 28,
      // dropping TAX_AMOUNT. The TAX_TRX_CODE check below still filters correctly
      // since it's an early column present on every row. Don't skip by row length —
      // that would silently discard real credit/reversal rows.
      if ((cols[idx['TAX_TRX_CODE']] || '').trim() !== '7510') continue; // Tourism Dirham only
      const dt = tdaParseOperaDate(cols[dateCol]);
      if (!dt) continue;
      let amount;
      if (idx['TAX_AMOUNT'] < cols.length && (cols[idx['TAX_AMOUNT']] || '').trim() !== '') {
        amount = parseFloat(cols[idx['TAX_AMOUNT']]) || 0;
      } else if ('SUMTAX_AMOUNTPERTRX_CODE' in idx && idx['SUMTAX_AMOUNTPERTRX_CODE'] < cols.length && (cols[idx['SUMTAX_AMOUNTPERTRX_CODE']] || '').trim() !== '') {
        amount = parseFloat(cols[idx['SUMTAX_AMOUNTPERTRX_CODE']]) || 0; // fallback for truncated rows
      } else {
        amount = 0;
      }
      out.push({
        nameId: (cols[idx['NAME_ID']] || '').trim(),
        room: tdaNormRoom(cols[idx['ROOM']]),
        name: (cols[idx['DISPLAY_NAME']] || '').trim(),
        date: dt,
        amount,
      });
    } else {
      // finjrnlbytrans rows are a fixed 43 columns; footer/title rows (e.g. trailing
      // "R_DEBIT R_CREDIT LOGO" or grand-total lines) are shorter, so cols[idx['TRX_CODE']]
      // is simply undefined on them and fails the '7510' check below — no length check needed.
      if ((cols[idx['TRX_CODE']] || '').trim() !== '7510') continue; // Tourism Dirham only
      const dt = tdaParseOperaDate(cols[dateCol]);
      if (!dt) continue;
      const debit  = parseFloat(cols[idx['CASHIER_DEBIT']])  || 0;
      const credit = parseFloat(cols[idx['CASHIER_CREDIT']]) || 0;
      out.push({
        nameId: '',
        room: tdaNormRoom(cols[idx['ROOM']]),
        name: (cols[idx['GUEST_FULL_NAME']] || '').trim(),
        date: dt,
        amount: debit - credit,
      });
    }
  }
  return out;
}

function tdaParseDtcmXML(raw) {
  const blocks = raw.match(/<Details\b[^>]*\/>/g) || [];
  if (!blocks.length) throw new Error('No <Details> rows found. Make sure this is the DTCM Hotel Transaction Report XML.');
  const out = [];
  blocks.forEach(b => {
    const attr = name => { const m = b.match(new RegExp(name + '="([^"]*)"')); return m ? m[1] : ''; };
    const room = tdaNormRoom(attr('RoomNumber'));
    const checkIn = tdaParseDtcmDate(attr('Check_In_EffectiveDateTime'));
    const checkOutRaw = (attr('Check_Out_EffectiveDateTime') || '').trim();
    const checkOut = tdaParseDtcmDate(checkOutRaw);
    if (!room || !checkIn) return;
    out.push({
      room,
      guestName: attr('MainGuestName'),
      checkIn,
      checkOut,
      inHouse: !checkOutRaw,
      nights: parseInt(attr('Nights'), 10) || 0,
      tdFees: parseFloat(attr('TDFees')) || 0,
    });
  });
  return out;
}

// ───────────────────────── file/paste loaders ─────────────────────────
function tdaToggleHowTo() {
  const body = document.getElementById('tdaHowToBody');
  const chev = document.getElementById('tdaHowToChevron');
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  if (chev) chev.style.transform = open ? 'rotate(0deg)' : 'rotate(180deg)';
}

function tdaLoadOperaFile(input) {
  const f = input.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = e => {
    document.getElementById('tdaOperaInput').value = e.target.result;
    document.getElementById('tdaOperaLabel').textContent = '✓ ' + f.name;
  };
  r.readAsText(f);
}
function tdaLoadDtcmFile(input) {
  const f = input.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = e => {
    document.getElementById('tdaDtcmInput').value = e.target.result;
    document.getElementById('tdaDtcmLabel').textContent = '✓ ' + f.name;
  };
  r.readAsText(f);
}

// ───────────────────────── core compute ─────────────────────────
function tdaRun() {
  const errBox = document.getElementById('tdaError');
  const errMsg = document.getElementById('tdaErrorMsg');
  errBox.classList.remove('show');

  const operaRaw = document.getElementById('tdaOperaInput').value;
  const dtcmRaw  = document.getElementById('tdaDtcmInput').value;

  if (!operaRaw.trim() || !dtcmRaw.trim()) {
    errMsg.textContent = 'Please load both the Opera Tax report and the DTCM report first.';
    errBox.classList.add('show');
    return;
  }

  let opera, dtcm;
  try {
    opera = tdaParseOperaTSV(operaRaw);
    dtcm  = tdaParseDtcmXML(dtcmRaw);
  } catch (e) {
    errMsg.textContent = e.message || 'Could not parse one of the files.';
    errBox.classList.add('show');
    return;
  }
  if (!opera.length) { errMsg.textContent = 'No Tourism Dirham (tax code 7510) rows found in the Opera file.'; errBox.classList.add('show'); return; }

  tdaOperaRows = opera;
  tdaDtcmRows  = dtcm;

  const operaByRoom = {};
  opera.forEach(r => { (operaByRoom[r.room] = operaByRoom[r.room] || []).push(r); });

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const results = [];

  dtcm.forEach(stay => {
    const stayEnd = stay.inHouse ? today : stay.checkOut;
    if (!stayEnd) return;
    const totalDays = Math.round((stayEnd - stay.checkIn) / 86400000);
    if (totalDays < TDA_CAP_NIGHTS) return; // never crossed 30 nights — not relevant

    const capDate = tdaAddDays(stay.checkIn, TDA_CAP_NIGHTS); // first night that should NOT be charged
    const roomCharges = (operaByRoom[stay.room] || []).filter(c => c.date >= stay.checkIn && c.date <= stayEnd);
    const excessCharges = roomCharges.filter(c => c.date >= capDate);
    const excessPaid = excessCharges.filter(c => c.amount > 0);   // real over-charges — need a fix
    const excessZero = excessCharges.filter(c => c.amount <= 0);  // posting still firing, but AED 0 — informational only

    const excessNights = excessPaid.length;
    const excessAmount = excessPaid.reduce((s, c) => s + c.amount, 0);
    const zeroNights = excessZero.length;
    const operaName = (excessCharges[0] || roomCharges[roomCharges.length - 1] || {}).name || '';

    results.push({
      room: stay.room,
      dtcmName: stay.guestName,
      operaName,
      checkIn: stay.checkIn,
      capDate,
      stayEnd,
      inHouse: stay.inHouse,
      dtcmNights: stay.nights,
      dtcmFees: stay.tdFees,
      excessNights,
      excessAmount,
      zeroNights,
      hasOperaData: roomCharges.length > 0,
      nameMatch: operaName ? tdaNameOverlap(stay.guestName, operaName) : true,
    });
  });

  results.sort((a, b) => b.excessAmount - a.excessAmount);
  tdaResults = results;

  document.getElementById('tdaResultsWrap').style.display = results.length ? 'block' : 'none';
  document.getElementById('tdaNoLongStay').style.display  = results.length ? 'none' : 'block';

  tdaRenderKpis();
  tdaSetFilter('all', document.querySelector('#tdaFilters .fchip[data-tdf="all"]'));

  const badge = document.getElementById('badge-td-audit');
  if (badge) {
    const flaggedCount = results.filter(r => r.excessNights > 0).length;
    badge.textContent = flaggedCount || '0';
  }
}

function tdaRenderKpis() {
  const flagged = tdaResults.filter(r => r.excessNights > 0);
  const totalExcessNights = flagged.reduce((s, r) => s + r.excessNights, 0);
  const totalExcessAmount = flagged.reduce((s, r) => s + r.excessAmount, 0);
  const verify = tdaResults.filter(r => r.excessNights > 0 && !r.nameMatch).length;

  document.getElementById('tdaKpis').innerHTML = `
    <div class="kpi rose"><div class="kpi-accent"></div><div class="kpi-label">Rooms Over-Charged</div><div class="kpi-val">${flagged.length}</div></div>
    <div class="kpi amber"><div class="kpi-accent"></div><div class="kpi-label">Excess Nights</div><div class="kpi-val">${totalExcessNights}</div></div>
    <div class="kpi gold"><div class="kpi-accent"></div><div class="kpi-label">Excess AED</div><div class="kpi-val">${totalExcessAmount.toLocaleString()}</div></div>
    <div class="kpi sky"><div class="kpi-accent"></div><div class="kpi-label">⚠ Verify Name</div><div class="kpi-val">${verify}</div></div>
  `;
}

function tdaSetFilter(type, btn) {
  tdaFilter = type;
  document.querySelectorAll('#tdaFilters .fchip').forEach(b => b.classList.remove('on'));
  if (btn) btn.classList.add('on');
  tdaRender();
}
function tdaSetSearch(v) { tdaSearchQ = (v || '').toLowerCase(); tdaRender(); }

function tdaRender() {
  let rows = tdaResults.slice();
  if (tdaFilter === 'excess') rows = rows.filter(r => r.excessNights > 0);
  if (tdaFilter === 'verify') rows = rows.filter(r => r.excessNights > 0 && !r.nameMatch);
  if (tdaFilter === 'zero')   rows = rows.filter(r => r.excessNights === 0 && r.zeroNights > 0);
  if (tdaFilter === 'clean')  rows = rows.filter(r => r.excessNights === 0 && r.zeroNights === 0);

  if (tdaSearchQ) {
    rows = rows.filter(r =>
      r.room.toLowerCase().includes(tdaSearchQ) ||
      (r.dtcmName || '').toLowerCase().includes(tdaSearchQ) ||
      (r.operaName || '').toLowerCase().includes(tdaSearchQ)
    );
  }

  const c = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n; };
  c('tdfc-all',    tdaResults.length);
  c('tdfc-excess', tdaResults.filter(r => r.excessNights > 0).length);
  c('tdfc-verify', tdaResults.filter(r => r.excessNights > 0 && !r.nameMatch).length);
  c('tdfc-zero',   tdaResults.filter(r => r.excessNights === 0 && r.zeroNights > 0).length);
  c('tdfc-clean',  tdaResults.filter(r => r.excessNights === 0 && r.zeroNights === 0).length);

  document.getElementById('tdaTable').innerHTML = rows.map(r => {
    let verdict;
    if (r.excessNights > 0) {
      verdict = `<span style="font-family:var(--mono);font-size:0.62rem;font-weight:700;color:var(--rose);background:rgba(240,107,122,0.08);border:1px solid rgba(240,107,122,0.3);border-radius:6px;padding:3px 8px;white-space:nowrap;">🔴 ${r.excessNights} night${r.excessNights > 1 ? 's' : ''} · AED ${r.excessAmount.toFixed(0)}</span>`;
    } else if (r.zeroNights > 0) {
      verdict = `<span style="font-family:var(--mono);font-size:0.62rem;font-weight:700;color:var(--text3);background:rgba(255,255,255,0.04);border:1px dashed var(--border-2,rgba(255,255,255,0.15));border-radius:6px;padding:3px 8px;white-space:nowrap;">⚪ ${r.zeroNights} night${r.zeroNights > 1 ? 's' : ''} posted at AED 0 — no charge to fix</span>`;
    } else if (!r.hasOperaData) {
      verdict = `<span style="font-family:var(--mono);font-size:0.6rem;color:var(--text3);">— no Opera 7510 data for this room in range</span>`;
    } else {
      verdict = `<span style="font-family:var(--mono);font-size:0.62rem;font-weight:700;color:var(--mint);background:rgba(80,200,150,0.08);border:1px solid rgba(80,200,150,0.3);border-radius:6px;padding:3px 8px;white-space:nowrap;">✅ Correctly stopped</span>`;
    }
    const nameFlag = !r.nameMatch
      ? `<div style="font-family:var(--mono);font-size:0.56rem;color:var(--sky);margin-top:3px;">⚠ verify — names don't overlap</div>`
      : '';
    const statusTag = r.inHouse
      ? `<span style="font-family:var(--mono);font-size:0.56rem;color:var(--mint);">● in-house</span>`
      : `<span style="font-family:var(--mono);font-size:0.56rem;color:var(--text3);">checked out</span>`;

    return `<tr>
      <td style="font-family:var(--mono);font-weight:700;color:var(--sky);">${r.room}</td>
      <td><div style="font-size:0.73rem;color:var(--text2);">${r.dtcmName || '—'}</div>${statusTag}</td>
      <td><div style="font-size:0.73rem;color:var(--text2);">${r.operaName || '—'}</div>${nameFlag}</td>
      <td style="font-family:var(--mono);font-size:0.68rem;color:var(--text3);">${tdaFmtDate(r.checkIn)}</td>
      <td style="font-family:var(--mono);font-size:0.68rem;color:var(--text3);">${tdaFmtDate(r.capDate)}</td>
      <td>${verdict}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="6" style="text-align:center;padding:24px;font-family:var(--mono);font-size:0.7rem;color:var(--text3);">No rows match this filter</td></tr>`;
}

function tdaCopyFlagged() {
  const flagged = tdaResults.filter(r => r.excessNights > 0);
  if (!flagged.length) return;
  const text = flagged.map(r =>
    `Room ${r.room} — ${r.dtcmName} — ${r.excessNights} excess night(s) — AED ${r.excessAmount.toFixed(0)} — TD should have stopped ${tdaFmtDate(r.capDate)}`
  ).join('\n');
  copyToClipboard(text, document.getElementById('tdaCopyBtn'), '📋 Copy Flagged Rooms');
}

function tdaClear() {
  document.getElementById('tdaOperaInput').value = '';
  document.getElementById('tdaDtcmInput').value = '';
  document.getElementById('tdaOperaLabel').textContent = 'Click to upload, or paste below';
  document.getElementById('tdaDtcmLabel').textContent = 'Click to upload, or paste below';
  const fi1 = document.getElementById('tdaOperaFileInput'); if (fi1) fi1.value = '';
  const fi2 = document.getElementById('tdaDtcmFileInput');  if (fi2) fi2.value = '';
  document.getElementById('tdaResultsWrap').style.display = 'none';
  document.getElementById('tdaNoLongStay').style.display = 'none';
  document.getElementById('tdaError').classList.remove('show');
  tdaOperaRows = []; tdaDtcmRows = []; tdaResults = [];
  const badge = document.getElementById('badge-td-audit');
  if (badge) badge.textContent = '—';
}
