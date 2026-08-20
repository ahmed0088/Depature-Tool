// ═══════════════════════════════════════════════════════════
//  trends.js — what the month looks like
//
//  Reads the dated snapshots the other panels write as they are used.
//  Nothing is uploaded here and nothing is recalculated from source
//  files: this panel only reads history, so it can never disagree with
//  the panel that produced a figure.
//
//  A day appears once the panel responsible for it has been run for that
//  day. Re-running a day overwrites its entry rather than adding to it,
//  so re-processing a file can't inflate a total.
// ═══════════════════════════════════════════════════════════

let trHistory = {};
let trLoaded  = false;

async function trLoad() {
  if (typeof loadHistory !== 'function') return;
  try {
    trHistory = await loadHistory() || {};
    trLoaded  = true;
  } catch (e) {
    console.warn('[trends] load failed:', e);
    trHistory = {};
  }
  trRender();
}

// The days inside the selected window, oldest first.
function _trDays() {
  const n = parseInt(document.getElementById('trRange')?.value || '30', 10);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - n);
  const min = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;
  return Object.keys(trHistory)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .filter(d => n >= 9999 || d >= min)
    .sort();
}

function _trMoney(n) {
  return Number(n || 0).toLocaleString('en-AE', { maximumFractionDigits: 0 });
}

// Sums the per-day maps into one, e.g. every day's sellers into a month total.
function _trRoll(days, section, key, field) {
  const out = {};
  days.forEach(d => {
    const rec = trHistory[d] && trHistory[d][section];
    const map = rec && rec[key];
    if (!map) return;
    Object.entries(map).forEach(([k, v]) => {
      const amount = (field && v && typeof v === 'object') ? (v[field] || 0) : (typeof v === 'number' ? v : 0);
      const rows   = (v && typeof v === 'object' && v.rows) ? v.rows : (typeof v === 'number' ? v : 0);
      out[k] = out[k] || { aed: 0, rows: 0 };
      out[k].aed  += (field ? amount : 0);
      out[k].rows += rows;
    });
  });
  return out;
}

// A labelled bar, sized against the largest value in its own list. Bars beat
// bare numbers here because the question is always "who is ahead", not
// "exactly how much".
function _trBars(entries, fmt, colour) {
  if (!entries.length) return '<div style="font-size:0.7rem;color:var(--text3);">Nothing recorded yet</div>';
  const max = Math.max(...entries.map(e => e[1]), 1);
  return entries.map(([label, value], i) => `
    <div style="display:flex;align-items:center;gap:9px;margin-bottom:7px;">
      <span style="width:16px;font-family:var(--mono);font-size:0.62rem;color:var(--text3);">${i + 1}</span>
      <span style="flex:0 0 148px;font-size:0.74rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(label)}</span>
      <span style="flex:1;height:9px;border-radius:5px;background:var(--bg2);overflow:hidden;">
        <span style="display:block;height:100%;width:${Math.max(2, Math.round(value / max * 100))}%;background:var(--${colour});"></span>
      </span>
      <span style="flex:0 0 96px;text-align:right;font-family:var(--mono);font-size:0.7rem;font-weight:600;">${fmt(value)}</span>
    </div>`).join('');
}

function trRender() {
  const body  = document.getElementById('trBody');
  const empty = document.getElementById('trEmpty');
  if (!body || !empty) return;

  const days = _trDays();
  const any  = days.some(d => trHistory[d] && Object.keys(trHistory[d]).length);
  body.style.display  = any ? 'block' : 'none';
  empty.style.display = any ? 'none'  : 'block';
  const badge = document.getElementById('badge-trends');
  if (badge) badge.textContent = days.length || '—';
  if (!any) return;

  // ── headline figures ──
  let aed = 0, nights = 0, guests = 0, guestDays = 0, ns = 0, nsDays = 0;
  days.forEach(d => {
    const u = trHistory[d].upsells, g = trHistory[d].guests, n = trHistory[d].noshows;
    if (u) { aed += u.aed || 0; nights += u.rows || 0; }
    if (g) { guests += g.total || 0; guestDays++; }
    if (n) { ns += n.count || 0; nsDays++; }
  });
  // The latest day that actually has a collections figure — an outstanding
  // balance is a position, not something to add up across days.
  const lastCol = days.slice().reverse().find(d => trHistory[d].collections);
  const col = lastCol ? trHistory[lastCol].collections : null;

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('tr-k-aed', 'AED ' + _trMoney(aed));
  set('tr-k-aed-sub', `${nights} night${nights === 1 ? '' : 's'} across ${days.filter(d => trHistory[d].upsells).length} day(s)`);
  set('tr-k-guests', guests || '—');
  set('tr-k-guests-sub', guestDays ? `${Math.round(guests / guestDays)} a day over ${guestDays} day(s)` : 'no guest data yet');
  set('tr-k-ns', ns || '—');
  set('tr-k-ns-sub', nsDays ? `${(ns / nsDays).toFixed(1)} a day over ${nsDays} day(s)` : 'no no-show data yet');
  set('tr-k-out', col ? 'AED ' + _trMoney(col.outstanding) : '—');
  set('tr-k-out-sub', col ? `${col.owingCount} account(s) · as of ${lastCol}` : 'no Adagio data yet');

  // ── leaderboard ──
  const sellers = _trRoll(days, 'upsells', 'sellers', 'aed');
  const lb = Object.entries(sellers).sort((a, b) => b[1].aed - a[1].aed);
  document.getElementById('trLeaderboard').innerHTML =
    _trBars(lb.map(([k, v]) => [k, v.aed]), v => 'AED ' + _trMoney(v), 'gold');
  const note = document.getElementById('tr-lb-note');
  if (note) note.textContent = lb.length ? `${lb.length} seller(s) · credited as the audit settled it` : '';

  // ── day by day ──
  document.getElementById('trDayTable').innerHTML = days.slice().reverse().map(d => {
    const u = trHistory[d].upsells, g = trHistory[d].guests,
          n = trHistory[d].noshows, c = trHistory[d].collections;
    const cell = v => v == null ? '<span style="color:var(--text3);">—</span>' : v;
    return `<tr>
      <td style="font-family:var(--mono);font-size:0.7rem;">${escapeHtml(d)}</td>
      <td style="text-align:right;font-family:var(--mono);">${cell(u ? _trMoney(u.aed) : null)}</td>
      <td style="text-align:right;font-family:var(--mono);">${cell(u ? u.rows : null)}</td>
      <td style="text-align:right;font-family:var(--mono);">${cell(g ? g.total : null)}</td>
      <td style="text-align:right;font-family:var(--mono);">${cell(n ? n.count : null)}</td>
      <td style="text-align:right;font-family:var(--mono);">${cell(c ? _trMoney(c.outstanding) : null)}</td>
    </tr>`;
  }).join('');

  // ── splits ──
  const products = _trRoll(days, 'upsells', 'products', 'aed');
  document.getElementById('trProducts').innerHTML =
    _trBars(Object.entries(products).sort((a, b) => b[1].aed - a[1].aed).map(([k, v]) => [k, v.aed]),
            v => 'AED ' + _trMoney(v), 'mint');

  const nats = _trRoll(days, 'guests', 'nationalities');
  document.getElementById('trNats').innerHTML =
    _trBars(Object.entries(nats).sort((a, b) => b[1].rows - a[1].rows).slice(0, 10).map(([k, v]) => [k, v.rows]),
            v => v + ' guest' + (v === 1 ? '' : 's'), 'sky');
}

function trCopyLeaderboard() {
  const days = _trDays();
  const sellers = _trRoll(days, 'upsells', 'sellers', 'aed');
  const rows = Object.entries(sellers).sort((a, b) => b[1].aed - a[1].aed);
  if (!rows.length) { showToast('Nothing to copy yet', 'err'); return; }
  const tsv = [`Seller\tNights\tAED\tPeriod`]
    .concat(rows.map(([k, v]) => [k, v.rows, v.aed.toFixed(2), `${days[0]} to ${days[days.length - 1]}`].join('\t')))
    .join('\n');
  copyToClipboard(tsv, null, '');
  showToast(`${rows.length} seller${rows.length === 1 ? '' : 's'} copied ✓`, 'ok');
}
