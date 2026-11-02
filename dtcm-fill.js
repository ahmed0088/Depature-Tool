// ═══════════════════════════════════════════════════════════
//  dtcm-fill.js — DTCM Revenue Fill
//
//  Finance's "Daily data for DTCM" sheet (Excel, or its PDF) → the DTCM portal (dhss.det.gov.ae → Revenue).
//  HotelOps reads the sheet and checks it; the filler (pasted in the portal's console, or a bookmark) fills each
//  day: ✎ Edit → the boxes → Update, then checks the saved row. Days that already match are skipped, so it can run
//  twice. It never goes past a row the portal refused. Nothing is sent anywhere by HotelOps itself.
// ═══════════════════════════════════════════════════════════
(function () {
'use strict';
const W = window, PANEL = 'dtcm-fill', PORTAL = 'https://dhss.det.gov.ae/Hotel/Revenue', LS = 'ho_dtcm_fill_v1';
const FIELDS = ['Room Revenue', 'Food & Beverage', 'Other Revenue', 'Municipality', 'Service Charge', 'VAT', 'TD Fee', 'Rooms Occupied', 'Total Available'];
const SHORT = ['Rooms', 'F&B', 'Other', 'Municip.', 'Service', 'VAT', 'TD Fee', 'Occ.', 'Avail.'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { if (typeof v === 'number') return v; const s = String(v == null ? '' : v).replace(/[,\s]/g, '').replace(/^\((.*)\)$/, '-$1'); if (!s || s === '-') return 0; const n = parseFloat(s); return isNaN(n) ? 0 : n; };
const r2 = n => Math.round(n * 100) / 100;
const fmt = n => (+n || 0).toLocaleString('en-GB', { maximumFractionDigits: 2 });
const toast = (m, t) => { if (typeof showToast === 'function') showToast(m, t); };

// ── Reading the finance sheet ───────────────────────────────
// a date cell: Excel date, "Monday, December 1, 2025", "1-Dec-2025", "01/12/2025"
function dateOf(v) {
  if (v instanceof Date && !isNaN(v)) return { y: v.getFullYear(), m: v.getMonth(), d: v.getDate() };
  if (typeof v === 'number' && v > 20000 && v < 80000) { const t = new Date(Math.round((v - 25569) * 864e5)); return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() }; }
  const s = String(v || '').trim();
  let m = s.match(/([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/);   // December 1, 2025
  if (m) { const mi = MONTHS.findIndex(x => x.toLowerCase().startsWith(m[1].slice(0, 3).toLowerCase())); if (mi >= 0) return { y: +m[3], m: mi, d: +m[2] }; }
  m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s,]+(\d{2,4})/);   // 1-Dec-2025
  if (m) { const mi = MONTHS.findIndex(x => x.toLowerCase().startsWith(m[2].slice(0, 3).toLowerCase())); if (mi >= 0) return { y: +m[3] < 100 ? 2000 + +m[3] : +m[3], m: mi, d: +m[1] }; }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);   // 2025-12-01
  if (m) return { y: +m[1], m: +m[2] - 1, d: +m[3] };
  m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/);   // 01/12/2025 (day first)
  if (m) return { y: +m[3] < 100 ? 2000 + +m[3] : +m[3], m: +m[2] - 1, d: +m[1] };
  return null;
}
const HEAD_KEYS = [/room.*rev/i, /f\s*&\s*b|food/i, /other/i, /municip/i, /service/i, /\bvat\b/i, /\btd\b|tourism/i, /occupied/i, /available/i];
/** rows of cells (Excel / CSV) → { y, m, rows: [{ d, v: [9 numbers] }], total: [9] | null } */
function parseAoa(aoa) {
  aoa = (aoa || []).map(r => (r || []).map(c => (c == null ? '' : c)));
  const hi = aoa.findIndex(r => r.some(c => /revenue\s*date/i.test(String(c))) && r.some(c => /room/i.test(String(c))));
  if (hi < 0) return null;
  // a header can run over two lines ("Rooms Revenue" / "(AED)"): join the next line's words in
  // …only when that next line is words (no numbers, no date): a one-line header must not take the first day's figures
  const nx = aoa[hi + 1] || [], cont = nx.some(c => String(c).trim()) && !nx.some(c => typeof c === 'number' || c instanceof Date || /\d{2,}/.test(String(c).replace(/\(AED\)/gi, '')));
  const head = aoa[hi].map((c, i) => String(c) + (cont ? ' ' + String(nx[i] || '') : '')).map(s => s.replace(/\s+/g, ' ').trim());
  const di = head.findIndex(h => /revenue\s*date/i.test(h));
  const cols = HEAD_KEYS.map(k => head.findIndex((h, i) => i !== di && k.test(h)));
  if (cols.slice(0, 7).some(c => c < 0)) return null;
  const rows = []; let total = null, y = 0, m = -1;
  for (let i = hi + 1; i < aoa.length; i++) {
    const r = aoa[i], first = String(r[di] || r[0] || '').trim();
    if (/^total$/i.test(first) || /^total$/i.test(String(r[0] || '').trim())) { if (!total) total = cols.map(c => (c >= 0 ? num(r[c]) : 0)); continue; }
    const dt = dateOf(r[di]); if (!dt) continue;
    if (m < 0) { y = dt.y; m = dt.m; }
    if (dt.m !== m || dt.y !== y) continue;
    rows.push({ d: dt.d, v: cols.map(c => (c >= 0 ? r2(num(r[c])) : null)) });
  }
  if (!rows.length) return null;
  rows.sort((a, b) => a.d - b.d);
  return { y, m, rows, total, from: 'excel', heads: cols.map(c => (c >= 0 ? head[c] : '')) };
}
/** the PDF's text lines → the same (each number there is rounded to whole dirhams) */
function parseLines(lines) {
  const rows = []; let total = null, y = 0, m = -1;
  // the figures after the date: 9 of them. The PDF writes a negative with a space ("- 35,810"), and a zero in Excel's
  // accounting format is a lone "-": with 9 values a lone "-" is a zero, with more it is the minus of the number after it
  const DAY = /^([A-Za-z]+,\s*[A-Za-z]+\s+\d{1,2},\s*\d{4})\s+(.*)$/;
  const figures = rest => {
    const t = rest.replace(/[\u2212\u2013\u2014\u2012]/g, '-').trim().split(/\s+/).filter(Boolean);
    if (!t.every(x => /^-?[\d,]+(?:\.\d+)?$|^-$/.test(x))) return null;
    for (let i = 0; i < t.length && t.length > 9; i++) if (t[i] === '-' && i + 1 < t.length && /^[\d,]/.test(t[i + 1])) { t.splice(i, 2, '-' + t[i + 1]); i--; }
    return t.length === 9 ? t.map(x => (x === '-' ? 0 : num(x))) : null;
  };
  (lines || []).forEach(l => {
    const s = String(l).replace(/\s+/g, ' ').trim(), x = s.match(DAY), v = x && figures(x[2]);
    if (v) { const dt = dateOf(x[1]); if (!dt) return; if (m < 0) { y = dt.y; m = dt.m; } if (dt.m === m && dt.y === y) rows.push({ d: dt.d, v }); return; }
    const t = s.match(/^Total\s+(.*)$/i);
    if (t && !total) { const ns = (t[1].replace(/-\s+/g, '-').match(/-?[\d,]+(?:\.\d+)?/g) || []).map(num); if (ns.length >= 9) total = ns.slice(0, 9); }
  });
  if (!rows.length) return null;
  rows.sort((a, b) => a.d - b.d);
  return { y, m, rows, total, from: 'pdf' };
}
// ── Any layout: a sheet in another order, a few columns only, text pasted from anywhere, a picture read by OCR ──
// The figures are found by their column titles (Room Revenue, F&B, TD Fee …) in whatever order; a column without a
// title is asked once ("which figure is this?") and remembered. Fields that are not there stay empty, and the filler
// leaves those boxes on the portal as they are.
/** the fields named in a header line, in the order they appear (pure) */
// in a header LINE the titles sit side by side: each pattern must stay inside its own title ("Rooms Occupied … Room Revenue")
const HEAD_TXT = [/rooms?\s*rev/i, /f\s*&\s*b|food/i, /\bother\b/i, /municip/i, /service/i, /\bvat\b/i, /\btd\b|tourism/i, /occupied|\bocc\.?(?=\s|$)/i, /available|\bavail\.?(?=\s|$)/i];
function headOrder(text) {
  const t = ' ' + String(text || '') + ' ', hits = [];
  HEAD_TXT.forEach((re, i) => { const m = t.match(re); if (m) hits.push([m.index, i]); });
  return hits.sort((a, b) => a[0] - b[0]).map(h => h[1]);
}
const DATE_RES = [
  /^(?:[A-Za-z]+,?\s+)?([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4})(?:\s+|$)(.*)$/,             // (Monday,) November 1, 2026
  /^(?:[A-Za-z]+,?\s+)?(\d{1,2}[-\s/.][A-Za-z]{3,9}\.?[-\s/.,]+\d{2,4})(?:\s+|$)(.*)$/,     // 1-Nov-2026 · 1 Nov 2026
  /^(?:[A-Za-z]+,?\s+)?(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})(?:\s+|$)(.*)$/,                     // 01/11/2026
  /^(\d{4}-\d{1,2}-\d{1,2})(?:T[\d:.]+Z?)?(?:\s+|$)(.*)$/,                                    // 2026-11-01
];
/** a line's date and what follows it ({ dt, rest } or null) (pure) */
function lineDate(line) {
  const s = String(line || '').replace(/[|¦]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const re of DATE_RES) { const m = s.match(re); if (m) { const dt = dateOf(m[1].replace(/\.(?=\s)/, '').replace(/[-/.]([A-Za-z]{3,9})[-/.]/, ' $1 ').replace(/\s+/g, ' ').trim()) || dateOf(m[1]);
    if (dt && dt.m >= 0 && dt.m < 12 && dt.d >= 1 && dt.d <= new Date(dt.y, dt.m + 1, 0).getDate() && dt.y > 2000 && dt.y < 2100) return { dt, rest: m[2] || '' }; } }
  return null;
}
/** the numbers after the date: "1,234.50" · "(1,234)" = negative · "- 35,810" = negative · a lone "-" = 0 · "AED", "%" ignored (pure) */
function lineNums(rest) {
  const t = String(rest || '').replace(/[\u2212\u2013\u2014\u2012]/g, '-').replace(/AED|Dhs?\.?|%/gi, ' ').replace(/\((\d[\d,]*(?:\.\d+)?)\)/g, '-$1').trim().split(/\s+/).filter(Boolean)
    .map(x => x.replace(/^[Oo](?=[\d,])|(?<=[\d,])[Oo]/g, '0').replace(/(?<=\d)[lI](?=[\d,])/g, '1')).map(x => (/^-?\d{1,3}(\.\d{3})+$/.test(x) ? x.replace(/\./g, '') : x)).filter(x => /^-?[\d,]+(?:\.\d+)?$|^-$/.test(x));
  for (let i = 0; i < t.length; i++) if (t[i] === '-' && i + 1 < t.length && /^[\d,]/.test(t[i + 1])) { t.splice(i, 2, '-' + t[i + 1]); }
  return t.map(x => (x === '-' ? 0 : num(x)));
}
/** text lines (a pasted table, a PDF, a picture's OCR, a sheet in another layout) → the month, or { need: 'map' } when the
 *  columns have no titles it knows (map = the field of each number column, -1 = ignore) (pure) */
function parseText(lines, map) {
  lines = (lines || []).map(l => String(l || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  let head = [], headLine = '';
  lines.forEach(l => { if (lineDate(l)) return; const o = headOrder(l); if (o.length > head.length) { head = o; headLine = l; } });
  const data = []; let total = null;
  lines.forEach(l => { const x = lineDate(l); if (x) { const n = lineNums(x.rest); if (n.length) data.push({ dt: x.dt, n }); return; }
    const t = l.match(/^(?:grand\s+)?total\b[:\s]*(.*)$/i); if (t && !total) { const n = lineNums(t[1]); if (n.length) total = n; } });
  if (!data.length) return null;
  const width = Math.max(...data.map(r => r.n.length)), common = (() => { const c = {}; data.forEach(r => { c[r.n.length] = (c[r.n.length] || 0) + 1; }); return +Object.keys(c).sort((a, b) => c[b] - c[a])[0]; })();
  let order = map && map.length ? map : head.length && head.length === common ? head : !head.length && common === 9 ? [0, 1, 2, 3, 4, 5, 6, 7, 8] : head.length && common > head.length && head.length >= 1 ? null : null;
  if (!order) return { need: 'map', width: common || width, head: head.map(i => FIELDS[i]), sample: data.slice(0, 4).map(r => ({ d: r.dt.d + ' ' + MON[r.dt.m], n: r.n })) };
  const y = data[0].dt.y, m = data[0].dt.m, rows = [], seen = {};
  data.forEach(r => { if (r.dt.y !== y || r.dt.m !== m || seen[r.dt.d]) return; seen[r.dt.d] = 1;
    const v = FIELDS.map(() => null); order.forEach((f, k) => { if (f >= 0 && f < 9 && r.n[k] != null) v[f] = r2(r.n[k]); }); rows.push({ d: r.dt.d, v }); });
  rows.sort((a, b) => a.d - b.d);
  const fields = [...new Set(order.filter(f => f >= 0 && f < 9))].sort((a, b) => a - b);
  const tot = total && total.length === order.length ? FIELDS.map((_, i) => { const k = order.indexOf(i); return k >= 0 ? total[k] : 0; }) : null;
  return { y, m, rows, total: fields.length === 9 ? tot : null, from: 'text', fields, heads: FIELDS.map((_, i) => (order.indexOf(i) >= 0 ? (head.length ? FIELDS[i] : 'column ' + (order.indexOf(i) + 1)) : '')), sig: (headLine || 'cols' + common).slice(0, 80) };
}
/** a sheet (rows of cells) in any layout → text lines for parseText (dates as YYYY-MM-DD) (pure) */
function aoaLines(aoa) {
  return (aoa || []).map(r => (r || []).map((c, i) => {
    if (c instanceof Date && !isNaN(c)) return c.getFullYear() + '-' + (c.getMonth() + 1) + '-' + c.getDate();
    if (typeof c === 'number' && c > 20000 && c < 80000 && i === (r || []).findIndex(x => x !== '' && x != null)) { const d = dateOf(c); return d.y + '-' + (d.m + 1) + '-' + d.d; }
    return String(c == null ? '' : c).replace(/\s+/g, ' ');
  }).filter(x => x !== '').join('  '));
}
/** a partial read (some fields only, e.g. a TD screenshot) added to the month already here: only those fields change (pure) */
function mergeInto(S0, R) {
  const rows = S0.rows.map(r => ({ d: r.d, v: r.v.slice() }));
  R.rows.forEach(n => { let r = rows.find(x => x.d === n.d); if (!r) { r = { d: n.d, v: FIELDS.map(() => null) }; rows.push(r); } R.fields.forEach(f => { if (n.v[f] != null) r.v[f] = n.v[f]; }); });
  rows.sort((a, b) => a.d - b.d);
  return Object.assign({}, S0, { rows, heads: S0.heads ? S0.heads.map((h, i) => (R.fields.includes(i) ? (R.heads && R.heads[i]) || FIELDS[i] : h)) : S0.heads });
}

/** the checks shown before filling */
/** a blank month: every day there, every figure empty — only what you set is filled (pure) */
function blankMonth(y, m) {
  const n = new Date(y, m + 1, 0).getDate(), rows = [];
  for (let d = 1; d <= n; d++) rows.push({ d, v: FIELDS.map(() => null) });
  return { y, m, rows, total: null, from: 'blank', fields: [], heads: null };
}
function check(S) {
  const sums = FIELDS.map((_, i) => r2(S.rows.reduce((a, r) => a + (+r.v[i] || 0), 0)));
  const days = new Date(S.y, S.m + 1, 0).getDate(), have = new Set(S.rows.map(r => r.d));
  const missing = []; for (let d = 1; d <= days; d++) if (!have.has(d)) missing.push(d);
  const neg = [], over = [];
  S.rows.forEach(r => { r.v.forEach((v, i) => { if (v < 0) neg.push({ d: r.d, f: FIELDS[i], v }); }); if (r.v[7] > r.v[8] && r.v[8] > 0) over.push(r.d); });
  const vsTotal = S.total ? FIELDS.map((f, i) => ({ f, sum: sums[i], total: S.total[i], diff: r2(sums[i] - S.total[i]) })).filter(x => Math.abs(x.diff) >= 1) : [];
  return { sums, days, missing, neg, over, vsTotal };
}

// ── The filler: runs on the portal page (pasted in its console, or a bookmark) ──
/* eslint-disable */
function FILLER(D) {
  if (window.__hoDtcm) { window.__hoDtcm.show(D); return; }
  var FIELDS = ['Room Revenue', 'Food & Beverage', 'Other Revenue', 'Municipality', 'Service Charge', 'VAT', 'TD Fee', 'Rooms Occupied', 'Total Available'];
  var KEYS = [/room\s*rev/i, /food|f\s*&\s*b/i, /other/i, /municip/i, /service/i, /\bvat\b/i, /\btd\b/i, /occupied/i, /available/i];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var n = function (s) { var x = parseFloat(String(s == null ? '' : s).replace(/[,\s]/g, '')); return isNaN(x) ? 0 : x; };
  var same = function (a, b) { return Math.abs((+a || 0) - (+b || 0)) < 0.005; };
  var stop = false, busy = false, mini = false, logOpen = false;
  var force = false, fixSet = '';   // force: save the chosen days again even when they match · fixSet: the days a Check found changed
  var st = {}, prog = null, note = null;   // st: day → ok | same | diff | fail | miss | run · prog: { k, n, d } while running · note: { t: info|ok|warn|err, h }
  var css = document.createElement('style');
  css.textContent = '#hoDtcmBox{position:fixed;right:18px;bottom:18px;z-index:2147483000;width:400px;max-width:calc(100vw - 36px);max-height:86vh;display:flex;flex-direction:column;background:#fff;color:#0f172a;border:1px solid #e2e8f0;border-radius:18px;box-shadow:0 24px 60px -12px rgba(15,23,42,.35),0 4px 14px rgba(15,23,42,.08);font:13px/1.45 Inter,system-ui,Segoe UI,sans-serif;overflow:hidden;animation:hoIn .22s cubic-bezier(.2,.8,.2,1)}'
    + '@keyframes hoIn{from{opacity:0;transform:translateY(12px) scale(.98)}to{opacity:1;transform:none}}'
    + '#hoDtcmBox *{box-sizing:border-box}#hoDtcmBox button{font:inherit;cursor:pointer}#hoDtcmBox button:disabled{cursor:default;opacity:.55}'
    + '.hoH{display:flex;align-items:center;gap:10px;padding:12px 14px;background:linear-gradient(135deg,#0f766e,#115e59 55%,#134e4a);color:#fff}'
    + '.hoLogo{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;background:rgba(255,255,255,.16);font-weight:800;font-size:13px;flex:none}'
    + '.hoT{flex:1;min-width:0}.hoT b{display:block;font-size:14px;letter-spacing:-.01em}.hoT i{display:block;font-style:normal;font-size:11.5px;opacity:.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '.hoIc{width:28px;height:28px;border-radius:8px;border:0;background:rgba(255,255,255,.12);color:#fff;font-size:14px;display:grid;place-items:center}.hoIc:hover{background:rgba(255,255,255,.24)}'
    + '.hoB{overflow:auto;display:flex;flex-direction:column}'
    + '.hoN{margin:12px 14px 0;padding:10px 12px;border-radius:12px;font-size:12.5px;display:flex;gap:9px;align-items:flex-start;border:1px solid}'
    + '.hoN.info{background:#f8fafc;border-color:#e2e8f0}.hoN.ok{background:#f0fdf4;border-color:#bbf7d0;color:#14532d}.hoN.warn{background:#fffbeb;border-color:#fde68a;color:#78350f}.hoN.err{background:#fef2f2;border-color:#fecaca;color:#7f1d1d}'
    + '.hoN small{display:block;margin-top:3px;opacity:.85}'
    + '.hoS{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:12px 14px 0}.hoS div{padding:7px 6px;border-radius:10px;background:#f8fafc;border:1px solid #eef2f7;text-align:center}.hoS b{display:block;font-size:16px;font-variant-numeric:tabular-nums}.hoS span{font-size:10.5px;color:#64748b;text-transform:uppercase;letter-spacing:.04em;font-weight:600}'
    + '.hoP{margin:12px 14px 0}.hoP .bar{height:8px;border-radius:99px;background:#e2e8f0;overflow:hidden}.hoP .bar i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#14b8a6,#0f766e);transition:width .3s}.hoP div.l{display:flex;justify-content:space-between;font-size:11.5px;color:#475569;margin-top:5px}'
    + '.hoSec{margin:12px 14px 0}.hoSec h6{margin:0 0 6px;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:#64748b;display:flex;justify-content:space-between;align-items:center}'
    + '.hoDays{display:flex;gap:6px}.hoDays input{flex:1;min-width:0;padding:7px 10px;border:1px solid #cbd5e1;border-radius:9px;font:inherit;outline:none}.hoDays input:focus{border-color:#0f766e;box-shadow:0 0 0 3px rgba(15,118,110,.15)}'
    + '.hoG{display:grid;grid-template-columns:repeat(7,1fr);gap:5px;margin-top:8px}.hoG button{position:relative;padding:6px 0;border-radius:8px;border:1px solid #e2e8f0;background:#fff;color:#0f172a;font-weight:650;font-size:12px;font-variant-numeric:tabular-nums;transition:transform .08s,box-shadow .12s}'
    + '.hoG button:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 3px 8px rgba(15,23,42,.08)}'
    + '.hoG button.sel{border-color:#0f766e;box-shadow:inset 0 0 0 1.5px #0f766e}.hoG button.ok{background:#dcfce7;border-color:#86efac}.hoG button.same{background:#ecfeff;border-color:#a5f3fc}.hoG button.diff{background:#fef3c7;border-color:#fcd34d}.hoG button.fail,.hoG button.miss{background:#fee2e2;border-color:#fca5a5}'
    + '.hoG button.run{background:#0f766e;color:#fff;border-color:#0f766e;animation:hoPulse 1s infinite}@keyframes hoPulse{50%{box-shadow:0 0 0 4px rgba(20,184,166,.3)}}'
    + '.hoG button.all{grid-column:span 2;font-weight:700}.hoG button.all.on{background:#0f766e;color:#fff;border-color:#0f766e}'
    + '.hoLeg{display:flex;flex-wrap:wrap;gap:4px 10px;margin-top:7px;font-size:10.5px;color:#64748b}.hoLeg i{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:4px;vertical-align:-1px;border:1px solid}'
    + '.hoSw{display:flex;gap:10px;align-items:flex-start;margin:12px 14px 0;padding:9px 11px;border-radius:12px;border:1px solid #e2e8f0;cursor:pointer;font-size:12px}.hoSw.on{background:#fffbeb;border-color:#fcd34d}'
    + '.hoSw input{appearance:none;-webkit-appearance:none;width:32px;height:18px;border-radius:99px;background:#cbd5e1;position:relative;flex:none;margin-top:1px;cursor:pointer;transition:background .15s}.hoSw input:checked{background:#d97706}.hoSw input::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:left .15s}.hoSw input:checked::after{left:16px}'
    + '.hoA2{padding-top:0!important}.hoA button.c{color:#b91c1c;border-color:#fca5a5;background:#fff5f5}.hoA{display:flex;gap:8px;padding:12px 14px}.hoA button{flex:1;padding:9px 10px;border-radius:11px;border:1px solid #cbd5e1;background:#fff;color:#0f172a;font-weight:650}.hoA button.p{background:linear-gradient(135deg,#14b8a6,#0f766e);border-color:#0f766e;color:#fff;box-shadow:0 6px 16px -6px rgba(15,118,110,.6)}.hoA button.d{background:#dc2626;border-color:#dc2626;color:#fff}'
    + '.hoL{border-top:1px solid #f1f5f9}.hoL>button{width:100%;padding:8px 14px;border:0;background:#f8fafc;text-align:left;font-size:11.5px;font-weight:650;color:#475569}.hoL div{max-height:170px;overflow:auto;padding:4px 14px 10px;font:11.5px/1.5 ui-monospace,Consolas,monospace}.hoL p{margin:0;padding:3px 0;border-bottom:1px solid #f1f5f9}'
    + '#hoDtcmBox.mini{width:auto;min-width:240px}#hoDtcmBox.mini .hoB{display:none}';
  document.head.appendChild(css);
  var box = document.createElement('div');
  box.id = 'hoDtcmBox';
  document.body.appendChild(box);
  function E(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var lines = [];
  // which days: "all", "1", "1-5", "1, 3, 8-10" (kept while the box is open)
  var daysTxt = 'all';
  // "Fill into the month shown on this page": for a test, the sheet's day 1 goes into the page's day 1, whatever its month
  var anyMonth = false;
  function pageMonth() {   // the month of the days on the page, read cell by cell ("1-Oct-2026")
    var rs = rows();
    for (var i = 0; i < rs.length; i++) for (var j = 0; j < rs[i].cells.length; j++) { var m = rs[i].cells[j].textContent.trim().match(/^\d{1,2}-([A-Z][a-z]{2})-(\d{4})$/); if (m) return { mon: m[1], y: m[2] }; }
    return null;
  }
  function target() { var p = anyMonth && pageMonth(); return p ? p.mon + ' ' + p.y : MON[D.m] + ' ' + D.y; }
  function pickDays(t) {
    t = String(t || '').trim().toLowerCase(); if (!t || t === 'all') return D.rows;
    var want = {}; t.split(/[,\s]+/).forEach(function (p) { var m = p.match(/^(\d{1,2})(?:-(\d{1,2}))?$/); if (!m) return; for (var d = +m[1]; d <= +(m[2] || m[1]); d++) want[d] = 1; });
    return D.rows.filter(function (r) { return want[r.d]; });
  }
  function ranges(ds) { var parts = []; ds.slice().sort(function (a, c) { return a - c; }).forEach(function (x) { var last = parts[parts.length - 1]; if (last && last[1] === x - 1) last[1] = x; else parts.push([x, x]); });
    return parts.map(function (p) { return p[0] === p[1] ? String(p[0]) : p[0] + '-' + p[1]; }).join(', '); }
  function count(k) { return Object.keys(st).filter(function (d) { return st[d] === k; }).length; }
  function paint(msg, tone) {
    if (msg !== undefined) note = msg ? { h: msg, t: tone || (/^✅/.test(msg) ? 'ok' : /^⛔/.test(msg) ? 'err' : /^⚠️|^🔍 \d/.test(msg) ? 'warn' : 'info') } : null;
    var sel = pickDays(daysTxt), all = sel.length === D.rows.length, selSet = {}; sel.forEach(function (r) { selSet[r.d] = 1; });
    var sub = 'Finance ' + MON[D.m] + ' ' + D.y + (anyMonth ? ' → this page: ' + target() : '');
    var fillLbl = (force ? '↻ Re-save ' : fixSet && daysTxt === fixSet ? '▶ Fix ' : '▶ Fill ') + (all ? (force ? 'all ' : 'all ') + D.rows.length + ' days' : sel.length + (fixSet && daysTxt === fixSet && !force ? ' changed' : '') + ' day' + (sel.length === 1 ? '' : 's'));
    var h = '<div class="hoH"><div class="hoLogo">H</div><div class="hoT"><b>DTCM fill · HotelOps</b><i>' + E(sub) + (mini && prog ? ' · ' + prog.k + '/' + prog.n : '') + '</i></div>'
      + '<button class="hoIc" data-a="min" title="' + (mini ? 'Open' : 'Make small') + '">' + (mini ? '▢' : '–') + '</button><button class="hoIc" data-a="x" title="Close">✕</button></div><div class="hoB">';
    h += '<div class="hoN ' + (note ? note.t : 'info') + '"><span>' + (note ? '' : 'ℹ️') + '</span><div>' + (note ? note.h : 'Pick <b>' + MON[D.m] + ' ' + D.y + '</b> on this page and press <b>Filter</b>. Then <b>Check</b> to compare, or choose days and <b>Fill</b>.') + '</div></div>';
    if (Object.keys(st).length || prog) h += '<div class="hoS"><div><b style="color:#15803d">' + count('ok') + '</b><span>Saved</span></div><div><b style="color:#0e7490">' + count('same') + '</b><span>Right</span></div><div><b style="color:#b45309">' + (count('diff') + count('miss')) + '</b><span>Differ</span></div><div><b style="color:#475569">' + (prog ? prog.n - prog.k : sel.filter(function (r) { return !st[r.d] || st[r.d] === 'diff'; }).length) + '</b><span>Left</span></div></div>';
    if (prog) h += '<div class="hoP"><div class="bar"><i style="width:' + Math.round(prog.k / Math.max(1, prog.n) * 100) + '%"></i></div><div class="l"><span>' + (prog.w ? 'Filling' : 'Checking') + ' ' + prog.d + ' ' + ((anyMonth && pageMonth()) || { mon: MON[D.m] }).mon + '…</span><span>' + prog.k + ' / ' + prog.n + ' · ' + Math.round(prog.k / Math.max(1, prog.n) * 100) + '%</span></div></div>';
    h += '<div class="hoSec"><h6><span>Days</span><span style="text-transform:none;letter-spacing:0">' + (all ? 'whole month · ' + D.rows.length : sel.length + ' of ' + D.rows.length + ' chosen') + '</span></h6>'
      + '<div class="hoDays"><input id="hoDtcmDays" value="' + E(daysTxt) + '" placeholder="all · 1 · 1-5 · 1, 3, 8-10"' + (busy ? ' disabled' : '') + '></div><div class="hoG">'
      + D.rows.map(function (r) { var c = (st[r.d] || '') + (!all && selSet[r.d] ? ' sel' : ''); return '<button data-day="' + r.d + '" class="' + c + '"' + (busy ? ' disabled' : '') + ' title="' + r.d + ' ' + MON[D.m] + (st[r.d] ? ' · ' + ({ ok: 'saved', same: 'already right', diff: 'differs', fail: 'not saved', miss: 'not on the page', run: 'working…' })[st[r.d]] : '') + '">' + r.d + '</button>'; }).join('')
      + '<button data-day="all" class="all' + (all ? ' on' : '') + '"' + (busy ? ' disabled' : '') + '>All</button></div>'
      + '<div class="hoLeg"><span><i style="background:#dcfce7;border-color:#86efac"></i>saved</span><span><i style="background:#ecfeff;border-color:#a5f3fc"></i>already right</span><span><i style="background:#fef3c7;border-color:#fcd34d"></i>differs</span><span><i style="background:#fee2e2;border-color:#fca5a5"></i>problem</span></div></div>';
    h += '<label class="hoSw' + (anyMonth ? ' on' : '') + '"><input type="checkbox" id="hoDtcmAny"' + (anyMonth ? ' checked' : '') + (busy ? ' disabled' : '') + '><span><b>Test mode</b> — fill into the month shown on this page' + (anyMonth ? ': <b>' + E(target()) + '</b> (the sheet\'s day 1 → this page\'s day 1)' : '') + '</span></label>';
    h += '<label class="hoSw' + (force ? ' on' : '') + '"><input type="checkbox" id="hoDtcmForce"' + (force ? ' checked' : '') + (busy ? ' disabled' : '') + '><span><b>Re-save every chosen day</b> — even the days that already match' + (force ? ' (each is opened, filled and saved again)' : '') + '</span></label>';
    h += '<div class="hoA">' + (busy ? '<button data-a="stop" class="d">■ Stop</button>' : '<button data-a="check">🔍 Check</button><button data-a="fill" class="p">' + fillLbl + '</button>') + '</div>'
      + (busy ? '' : '<div class="hoA hoA2"><button data-a="refill" title="Open the chosen days, type the finance figures and save again — even when they already match">↻ Refill</button><button data-a="clear" class="c" title="Put 0 in every box of the chosen days and save (the finance sheet is not changed)">🧹 Clear</button></div>');
    if (lines.length) h += '<div class="hoL"><button data-a="log">' + (logOpen ? '▾' : '▸') + ' Activity (' + lines.length + ')</button>' + (logOpen ? '<div>' + lines.join('') + '</div>' : '') + '</div>';
    box.innerHTML = h + '</div>';
    box.classList.toggle('mini', mini);
  }
  function line(d, icon, text, color) { lines.unshift('<p style="color:' + (color || '#0f172a') + '">' + icon + ' ' + d + ' ' + ((anyMonth && pageMonth()) || { mon: MON[D.m] }).mon + ' · ' + text + '</p>'); if (lines.length > 80) lines.pop(); }
  function headers() { return Array.prototype.map.call(document.querySelectorAll('.jsgrid-header-row th'), function (th) { return th.textContent.replace(/\s+/g, ' ').trim(); }); }
  function cols() { var H = headers(); return KEYS.map(function (k) { return H.findIndex(function (h) { return k.test(h); }); }); }
  function dateText(d) { var p = anyMonth && pageMonth(); return p ? d + '-' + p.mon + '-' + p.y : d + '-' + MON[D.m] + '-' + D.y; }
  function rows() { return Array.prototype.slice.call(document.querySelectorAll('.jsgrid-grid-body tr')).filter(function (tr) { return /jsgrid-(row|alt-row)/.test(tr.className); }); }
  function rowFor(d) { var t = dateText(d); return rows().find(function (tr) { return Array.prototype.some.call(tr.cells, function (c) { return c.textContent.trim() === t; }); }); }
  function vals(tr, C) { return C.map(function (c) { return c >= 0 && tr.cells[c] ? n(tr.cells[c].textContent) : null; }); }
  function idle() { return !(window.jQuery && window.jQuery.active) && !document.querySelector('.jsgrid-edit-row'); }
  async function waitIdle() { for (var i = 0; i < 80; i++) { await sleep(150); if (idle()) return true; } return false; }
  function ready() {
    var C = cols();
    if (C.slice(0, 7).some(function (c) { return c < 0; })) return { err: 'The revenue table is not on this page. Open Revenue on the DTCM portal.' };
    if (anyMonth) { if (!pageMonth()) return { err: 'No days on this page yet. Pick a month and press Filter.' }; }
    else if (!rows().some(function (tr) { return tr.textContent.indexOf('-' + MON[D.m] + '-' + D.y) >= 0; })) return { err: 'This page shows another month. Pick <b>' + MON[D.m] + ' ' + D.y + '</b> and press Filter — or, for a test, tick “Fill into the month shown on this page”.' };
    return { C: C };
  }
  // mode: '' fill · 'refill' save again even when they match · 'clear' every box of the chosen days becomes 0 (the sheet itself stays)
  async function run(write, mode) {
    var R = ready(); if (R.err) { paint('⚠️ ' + R.err); return; }
    var C = R.C; busy = true; stop = false; lines = [];
    var done = 0, same0 = 0, diffs = 0, fail = '';
    var todo = pickDays(daysTxt);
    if (!todo.length) { busy = false; paint('⚠️ No day of ' + MON[D.m] + ' in "' + daysTxt + '". Type e.g. 1 or 1-5, or all.'); return; }
    todo.forEach(function (r) { delete st[r.d]; });
    var frc = force || mode === 'refill' || mode === 'clear', clr = mode === 'clear';
    paint(clr ? 'Clearing… keep this tab open. Each day: open → every box 0 → Update → check.' : write ? 'Filling… keep this tab open. Each day: open → fill → Update → check.' : 'Checking every chosen day against the finance sheet…', 'info');
    for (var k = 0; k < todo.length && !stop; k++) {
      var r = todo[k], tr = rowFor(r.d), vv = clr ? r.v.map(function (x) { return x == null ? null : 0; }) : r.v;
      prog = { k: k, n: todo.length, d: r.d, w: write }; st[r.d] = 'run'; paint();
      if (!tr) { st[r.d] = 'miss'; line(r.d, '⚠️', 'not on the page', '#b45309'); diffs++; continue; }
      var got = vals(tr, C), off = C.map(function (c, i) { return c >= 0 && vv[i] != null && !same(got[i], vv[i]) ? i : -1; }).filter(function (i) { return i >= 0; });
      if (!off.length && !(write && frc)) { same0++; st[r.d] = 'same'; line(r.d, '✓', 'already right', '#0e7490'); continue; }
      if (!write) { diffs++; st[r.d] = 'diff'; line(r.d, '≠', off.map(function (i) { return FIELDS[i] + ' ' + got[i] + ' → ' + vv[i]; }).join(' · '), '#b45309'); continue; }
      // open the line for editing: its ✎ Edit button, or a click on the line itself (how the portal opens a row)
      var eb = tr.querySelector('.jsgrid-edit-button');
      if (eb) eb.click(); else (tr.cells[2] || tr.cells[1] || tr).click();
      await sleep(300);
      if (!document.querySelector('.jsgrid-edit-row') && eb) { (tr.cells[2] || tr.cells[1] || tr).click(); await sleep(300); }
      var er = document.querySelector('.jsgrid-edit-row'); if (!er) { st[r.d] = 'fail'; fail = r.d + ' ' + MON[D.m] + ': the row did not open for editing'; break; }
      C.forEach(function (c, i) {
        var inp = c >= 0 && er.cells[c] ? er.cells[c].querySelector('input') : null; if (!inp || vv[i] == null) return;
        inp.focus(); inp.value = String(vv[i]);
        inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true }));
        if (typeof window.jQuery === 'function') window.jQuery(inp).val(String(vv[i])).trigger('change');
      });
      var ub = er.querySelector('.jsgrid-update-button'); if (!ub) { st[r.d] = 'fail'; fail = r.d + ' ' + MON[D.m] + ': no Update button'; break; }
      ub.click();
      if (!(await waitIdle())) {
        var cb = document.querySelector('.jsgrid-edit-row .jsgrid-cancel-edit-button'); if (cb) cb.click();
        st[r.d] = 'fail'; fail = r.d + ' ' + MON[D.m] + ': the portal did not save it (a message on the page may say why — e.g. a negative number)'; break;
      }
      tr = rowFor(r.d); got = tr ? vals(tr, C) : [];
      var bad = C.map(function (c, i) { return c >= 0 && vv[i] != null && !same(got[i], vv[i]) ? FIELDS[i] : ''; }).filter(Boolean);
      if (bad.length) { st[r.d] = 'fail'; fail = r.d + ' ' + MON[D.m] + ': saved, but ' + bad.join(', ') + ' shows another number'; break; }
      done++; st[r.d] = 'ok'; line(r.d, clr ? '🧹' : '💾', clr ? 'cleared (all 0) and saved' : mode === 'refill' ? 'filled and saved again' : 'filled and saved', '#15803d');
      await sleep(250);
    }
    busy = false; prog = null; todo.forEach(function (r) { if (st[r.d] === 'run') delete st[r.d]; });
    if (!write && !stop) { var ch = todo.filter(function (r) { return st[r.d] === 'diff'; }).map(function (r) { return r.d; }); fixSet = ch.length && ch.length < D.rows.length ? ranges(ch) : ''; if (fixSet) daysTxt = fixSet; }
    if (write) fixSet = '';
    var msg = fail ? '⛔ Stopped at ' + fail + '. Nothing after it was changed.' : stop ? '■ Stopped. ' + done + ' saved so far.' : clr ? '✅ Cleared ' + done + ' day' + (done === 1 ? '' : 's') + ': every box is 0 now. ▶ Fill puts the finance figures back.' : write ? '✅ Done: ' + done + ' day' + (done === 1 ? '' : 's') + ' saved, ' + same0 + ' already right.' : (diffs ? '🔍 ' + diffs + ' day' + (diffs === 1 ? '' : 's') + ' differ from the finance sheet, ' + same0 + ' already right.' + (fixSet ? ' They are chosen below: ▶ Fix fills only those.' : ' ▶ Fill fixes them.') : '✅ Every day already matches the finance sheet.');
    if (!fail && write && !clr) { var C2 = cols(), tot = C2.map(function (c) { return todo.reduce(function (a, r) { var tr = rowFor(r.d); return a + (tr ? n(tr.cells[c] && tr.cells[c].textContent) : 0); }, 0); }), fin = [0, 1, 6].map(function (i) { return Math.round(todo.reduce(function (a, r) { return a + (+r.v[i] || 0); }, 0) * 100) / 100; });
      msg += '<br><small>' + (todo.length === D.rows.length ? 'The month' : todo.length === 1 ? 'That day' : 'Those ' + todo.length + ' days') + ' on the page now: Rooms ' + tot[0].toLocaleString() + ' · F&B ' + tot[1].toLocaleString() + ' · TD ' + tot[6].toLocaleString() + ' (finance: ' + fin[0].toLocaleString() + ' · ' + fin[1].toLocaleString() + ' · ' + fin[2].toLocaleString() + ')</small>'; }
    paint(msg);
  }
  function safe(w, mode) { run(w, mode).catch(function (e) { busy = false; prog = null; paint('⛔ Stopped: ' + (e && e.message || e) + '. Nothing after it was changed.'); }); }
  box.addEventListener('change', function (e) { if (e.target.id === 'hoDtcmForce') { force = e.target.checked; paint(); return; } if (e.target.id === 'hoDtcmAny') { anyMonth = e.target.checked; lines = []; st = {}; paint(null); } });
  box.addEventListener('input', function (e) { if (e.target.id !== 'hoDtcmDays') return; daysTxt = e.target.value; var pos = e.target.selectionStart; paint(); var i = document.getElementById('hoDtcmDays'); if (i) { i.focus(); i.setSelectionRange(pos, pos); } });
  box.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.day && !busy) {
      if (b.dataset.day === 'all') daysTxt = 'all';
      else { var cur = pickDays(daysTxt), set = {}, d = +b.dataset.day; if (cur.length !== D.rows.length) cur.forEach(function (r) { set[r.d] = 1; });
        if (set[d]) delete set[d]; else set[d] = 1;
        var ds = Object.keys(set).map(Number).sort(function (a, c) { return a - c; }), parts = [];
        ds.forEach(function (x) { var last = parts[parts.length - 1]; if (last && last[1] === x - 1) last[1] = x; else parts.push([x, x]); });
        daysTxt = parts.length ? parts.map(function (p) { return p[0] === p[1] ? String(p[0]) : p[0] + '-' + p[1]; }).join(', ') : 'all'; }
      paint(); return;
    }
    if (b.dataset.a === 'x') { if (busy) stop = true; box.remove(); css.remove(); window.__hoDtcm = null; }
    else if (b.dataset.a === 'min') { mini = !mini; paint(); }
    else if (b.dataset.a === 'log') { logOpen = !logOpen; paint(); }
    else if (b.dataset.a === 'stop') stop = true;
    else if (b.dataset.a === 'check' && !busy) safe(false);
    else if ((b.dataset.a === 'refill' || b.dataset.a === 'clear') && !busy) { var sl = pickDays(daysTxt); if (!sl.length) { paint('⚠️ No day of ' + MON[D.m] + ' in "' + daysTxt + '". Type e.g. 1 or 1-5, or all.'); return; }
      var which = sl.length === D.rows.length ? 'ALL ' + sl.length + ' days' : sl.length === 1 ? 'only ' + sl[0].d + ' ' + MON[D.m] : sl.length + ' days (' + daysTxt + ')';
      if (b.dataset.a === 'clear' ? confirm('🧹 Clear ' + which + (anyMonth ? ' on ' + target() : '') + ' on the portal?\n\nEvery box of those days becomes 0 and is saved. The finance sheet is not changed — ▶ Fill or ↻ Refill puts its figures back.')
        : confirm('↻ Refill ' + which + (anyMonth ? ' INTO ' + target() : '') + '?\n\nEach day is opened, the finance figures are typed again and saved — even the days that already match.')) safe(true, b.dataset.a); }
    else if (b.dataset.a === 'fill' && !busy) { var sel = pickDays(daysTxt); if (!sel.length) { paint('⚠️ No day of ' + MON[D.m] + ' in "' + daysTxt + '". Type e.g. 1 or 1-5, or all.'); return; }
      if (confirm((force ? 'Re-save (open, fill and save again, even if they match) ' : 'Fill and save ') + (sel.length === D.rows.length ? 'all ' + sel.length + ' days' : sel.length === 1 ? 'only ' + sel[0].d + ' ' + MON[D.m] : sel.length + ' days (' + daysTxt + ')') + ' of the finance sheet (' + MON[D.m] + ' ' + D.y + ')' + (anyMonth ? ' INTO ' + target() + ' on this page (test mode: by day number)' : '') + '? Days that already match are skipped.')) safe(true); }
  });
  window.__hoDtcm = { show: function (D2) { D = D2; lines = []; st = {}; paint(null); } };
  paint();
}
/* eslint-enable */
function fillerCode(S) {
  const C = check(S);
  const D = { y: S.y, m: S.m, rows: S.rows, sums: C.sums };
  return '(' + FILLER.toString() + ')(' + JSON.stringify(D) + ');';
}

// ── The page in HotelOps ────────────────────────────────────
let S = null;
try { S = JSON.parse(localStorage.getItem(LS) || 'null'); } catch (_) { S = null; }
const $ = id => document.getElementById('dtf-' + id);
// ── reading anything: Excel / CSV (finance's layout or any other), PDF (text or scanned), a picture (PNG / JPG / screenshot),
// text or a screenshot pasted — pictures are read by Tesseract (free, in the browser; the same reader as Roster's photo import)
const OCR_CDN = (typeof W.__hoOcrBase === 'string' && /^http:\/\/localhost(:\d+)?\//.test(W.__hoOcrBase) ? W.__hoOcrBase : 'https://cdn.jsdelivr.net/npm/'), OCR_VER = '5.1.1', MAPS = 'ho_dtcm_map_v1';   // __hoOcrBase: tests only (localhost)
const isPic = f => /^image\//.test(f.type || '') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name || '');
function ocrLib() {
  if (W.Tesseract) return Promise.resolve(W.Tesseract);
  return new Promise((ok, no) => { const sc = document.createElement('script'); sc.src = OCR_CDN + 'tesseract.js@' + OCR_VER + '/dist/tesseract.min.js'; sc.onload = () => ok(W.Tesseract); sc.onerror = () => no(new Error('Couldn\'t download the picture reader — connect to the internet and try again.')); document.head.appendChild(sc); });
}
/** a picture (File / Blob / canvas) → its text lines; small screenshots are enlarged first so the digits read well */
async function ocrLines(src, what, deg) {
  toast('🔎 Reading ' + (what || 'the picture') + '… (the first time it downloads the reader, ~10 s)', 'info');
  const T = await ocrLib();
  let pic = src instanceof HTMLCanvasElement ? src : await createImageBitmap(src);
  if (deg) { const c = document.createElement('canvas'), sw = deg % 180 !== 0; c.width = sw ? pic.height : pic.width; c.height = sw ? pic.width : pic.height; const g = c.getContext('2d'); g.translate(c.width / 2, c.height / 2); g.rotate(deg * Math.PI / 180); g.drawImage(pic, -pic.width / 2, -pic.height / 2); pic = c; }
  const img = cleanPic(pic);
  const opt = { workerPath: OCR_CDN + 'tesseract.js@' + OCR_VER + '/dist/worker.min.js', corePath: OCR_CDN + 'tesseract.js-core@' + OCR_VER, langPath: OCR_CDN + '@tesseract.js-data/eng/4.0.0' };
  if (typeof W.__hoOcrLog === 'function') opt.logger = W.__hoOcrLog;   // tests only
  const w = await T.createWorker('eng', 1, opt);
  try { await w.setParameters({ tessedit_pageseg_mode: '4', preserve_interword_spaces: '1' }); return String((await w.recognize(img)).data.text || '').split(/\r?\n/); }
  finally { try { await w.terminate(); } catch (_) {} }
}
/** a picture made easy to read: enlarged to ~3200 px wide, black on white by its own light (Otsu), table lines wiped out
 *  (long straight runs of dark pixels are borders, not digits) — that is what turns a grid screenshot from noise into text */
function cleanPic(bmp) {
  const k = Math.max(1, Math.min(3, 3200 / bmp.width)), c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.imageSmoothingQuality = 'high'; g.drawImage(bmp, 0, 0, c.width, c.height);
  const W2 = c.width, H = c.height, im = g.getImageData(0, 0, W2, H), d = im.data, lum = new Uint8Array(W2 * H), hist = new Array(256).fill(0);
  for (let i = 0; i < W2 * H; i++) { const y = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) | 0; lum[i] = y; hist[y]++; }
  let sum = 0, sB = 0, wB = 0, best = 0, th = 150; for (let t = 0; t < 256; t++) sum += t * hist[t];
  for (let t = 0; t < 256; t++) { wB += hist[t]; if (!wB) continue; const wF = W2 * H - wB; if (!wF) break; sB += t * hist[t]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF); if (v > best) { best = v; th = t; } }
  const dark = new Uint8Array(W2 * H); for (let i = 0; i < W2 * H; i++) dark[i] = lum[i] < Math.min(th, 200) ? 1 : 0;
  // the letters' height, from the picture itself: the usual length of an up-down stroke ("1", "4", "l") — a border is much longer
  const strokes = [];
  for (let x = 0; x < W2; x += 3) { let run = 0; for (let y = 0; y <= H; y++) { if (y < H && dark[y * W2 + x]) run++; else { if (run >= 4 && run < H / 2) strokes.push(run); run = 0; } } }
  strokes.sort((a, b) => a - b);
  const tall = strokes.length ? strokes[Math.floor(strokes.length * 0.9)] : 40;   // the tall strokes of the digits
  const Lv = Math.max(24, Math.round(tall * 1.35)), Lh = Math.max(50, Math.round(W2 / 30), Math.round(tall * 4));
  for (let y = 0; y < H; y++) { let run = 0; for (let x = 0; x <= W2; x++) { if (x < W2 && dark[y * W2 + x]) run++; else { if (run > Lh) for (let q = x - run; q < x; q++) dark[y * W2 + q] = 2; run = 0; } } }
  for (let x = 0; x < W2; x++) { let run = 0; for (let y = 0; y <= H; y++) { if (y < H && dark[y * W2 + x]) run++; else { if (run > Lv) for (let q = y - run; q < y; q++) dark[q * W2 + x] = 2; run = 0; } } }
  // specks left where borders crossed (a dot before "3,025" reads as a 1): a little blot with no ink around it is not part of a digit
  const R2 = Math.max(2, Math.round(tall / 6)), BOX = R2 * 3;
  for (let pass = 0; pass < 2; pass++) for (let y = 1; y < H - 1; y++) for (let x = 1; x < W2 - 1; x++) { const i = y * W2 + x; if (dark[i] !== 1) continue;
    let n = 0; for (let yy = Math.max(0, y - BOX); yy <= Math.min(H - 1, y + BOX) && n <= R2 * R2 * 2; yy += 1) for (let xx = Math.max(0, x - BOX); xx <= Math.min(W2 - 1, x + BOX); xx += 1) if (dark[yy * W2 + xx] === 1) n++;
    if (n <= R2 * R2 * 2) dark[i] = 0; }
  for (let i = 0; i < W2 * H; i++) { const v = dark[i] === 1 ? 0 : 255; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
  g.putImageData(im, 0, 0); return c;
}
const savedMaps = () => { try { return JSON.parse(localStorage.getItem(MAPS) || '{}') || {}; } catch (_) { return {}; } };
/** text lines → the month (a column map remembered for this shape is used when the columns have no titles) */
function fromLines(lines, from) {
  let R = parseText(lines);
  if (R && R.need) { const mp = savedMaps()[R.width]; if (mp && mp.length === R.width) { const R2 = parseText(lines, mp); if (R2 && !R2.need) R = Object.assign(R2, { mapped: 1 }); } }
  if (R && R.need) R.lines = lines;
  if (R && !R.need) R.from = from;
  return R;
}
// ── links: a shared link is turned into the file's own address (Google Sheets / Docs / Drive, OneDrive, Dropbox, GitHub) (pure) ──
function linkTargets(url) {
  let u; try { u = new URL(String(url || '').trim()); } catch (_) { return []; }
  const h = u.hostname.toLowerCase(), p = u.pathname, id = (p.match(/\/d\/([\w-]{10,})/) || [])[1] || u.searchParams.get('id') || '';
  const gid = (u.hash.match(/gid=(\d+)/) || [])[1] || u.searchParams.get('gid') || '0';
  if (h === 'docs.google.com' && /\/spreadsheets\//.test(p) && id) return [{ url: 'https://docs.google.com/spreadsheets/d/' + id + '/gviz/tq?tqx=out:csv&gid=' + gid, name: 'Google Sheet.csv' }, { url: 'https://docs.google.com/spreadsheets/d/' + id + '/export?format=csv&gid=' + gid, name: 'Google Sheet.csv' }];
  if (h === 'docs.google.com' && /\/document\//.test(p) && id) return [{ url: 'https://docs.google.com/document/d/' + id + '/export?format=txt', name: 'Google Doc.txt' }];
  if ((h === 'drive.google.com' || h === 'drive.usercontent.google.com') && id) return [{ url: 'https://drive.usercontent.google.com/download?id=' + id + '&export=download&confirm=t', name: '' }, { url: 'https://drive.google.com/uc?export=download&id=' + id, name: '' }];
  if (/(^|\.)dropbox\.com$/.test(h)) { const x = new URL(u.href); x.hostname = 'dl.dropboxusercontent.com'; x.searchParams.delete('dl'); return [{ url: x.href, name: decodeURIComponent(p.split('/').pop() || '') }]; }
  if (h === '1drv.ms' || /(^|\.)onedrive\.live\.com$/.test(h)) { const b = btoa(unescape(encodeURIComponent(u.href))).replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-'); return [{ url: 'https://api.onedrive.com/v1.0/shares/u!' + b + '/root/content', name: '' }]; }
  if (h === 'github.com' && /\/blob\//.test(p)) return [{ url: 'https://raw.githubusercontent.com' + p.replace('/blob/', '/'), name: decodeURIComponent(p.split('/').pop()) }];
  return [{ url: u.href, name: decodeURIComponent(p.split('/').pop() || '') }];
}
const EXT = { 'text/csv': 'csv', 'text/plain': 'txt', 'text/html': 'html', 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'message/rfc822': 'eml' };
/** a link → the file it points to (when that site lets apps read it) */
async function fromLink(url) {
  const T = linkTargets(url); if (!T.length) throw new Error('That is not a link (it starts with https://)');
  let last = '';
  for (const t of T) {
    try {
      const r = await fetch(t.url, { credentials: 'omit', redirect: 'follow' }); if (!r.ok) { last = 'the site answered ' + r.status; continue; }
      const type = (r.headers.get('content-type') || '').split(';')[0].trim(), cd = r.headers.get('content-disposition') || '', b = await r.blob();
      let name = (cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i) || [])[1] || t.name || 'link';
      if (type === 'text/html' && /google|onedrive|dropbox/.test(new URL(t.url).hostname) && !/\.html?$/i.test(name)) { last = 'it asks to sign in — share it as "Anyone with the link"'; continue; }
      if (!/\.\w{2,5}$/.test(name) && EXT[type]) name += '.' + EXT[type];
      return new File([b], decodeURIComponent(name), { type });
    } catch (e) { last = /Content Security|CSP|Refused/i.test(String(e)) ? 'HotelOps may not read from that site' : 'that site does not let apps read its files'; }
  }
  throw new Error('Could not get it from the link (' + last + '). Open the link, download or screenshot it, then drop it here.');
}
/** a Word file (.docx): its tables (and paragraphs) as text lines */
async function docxLines(file) {
  const z = XLSX.CFB.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' }), f = XLSX.CFB.find(z, 'word/document.xml') || XLSX.CFB.find(z, '/word/document.xml');
  if (!f) throw new Error('That Word file could not be opened');
  const xml = new TextDecoder().decode(f.content), cell = c => (c.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || []).map(t => t.replace(/<[^>]+>/g, '')).join('');
  const out = [];
  (xml.match(/<w:tr[\s>][\s\S]*?<\/w:tr>/g) || []).forEach(tr => out.push((tr.match(/<w:tc[\s>][\s\S]*?<\/w:tc>/g) || []).map(cell).join('  ')));
  (xml.replace(/<w:tbl[\s>][\s\S]*?<\/w:tbl>/g, '').match(/<w:p[\s>][\s\S]*?<\/w:p>/g) || []).forEach(p => { const t = cell(p); if (t.trim()) out.push(t); });
  return out.map(l => l.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
}
/** an HTML table (a web page, an email body) → text lines */
function htmlLines(html) {
  // raw: the cells as written — the library would read 01/11/2026 the American way (11 January); dates here are day first
  const wb = XLSX.read(String(html || ''), { type: 'string', raw: true }), out = [];
  wb.SheetNames.forEach(n => aoaLines(XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' })).forEach(l => out.push(l)));
  if (!out.some(l => /\d/.test(l))) String(html).replace(/<(br|\/p|\/div|\/tr)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ').split('\n').forEach(l => out.push(l.replace(/&nbsp;/g, ' ')));
  return out;
}
/** a saved email (.eml): an attachment it carries first (Excel, PDF, a photo), else the table in the message */
async function emlRead(file) {
  const raw = await file.text(), bd = (raw.match(/boundary="?([^";\r\n]+)"?/i) || [])[1];
  const parts = bd ? raw.split('--' + bd) : [raw], dec = (body, enc) => /base64/i.test(enc || '') ? Uint8Array.from(atob(body.replace(/\s+/g, '')), c => c.charCodeAt(0)) : /quoted-printable/i.test(enc || '') ? new TextEncoder().encode(body.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))) : new TextEncoder().encode(body);
  let html = '', text = '';
  for (const pt of parts) {
    const i = pt.search(/\r?\n\r?\n/); if (i < 0) continue; const hd = pt.slice(0, i), body = pt.slice(i).trim(), enc = (hd.match(/content-transfer-encoding:\s*([\w-]+)/i) || [])[1];
    const nm = (hd.match(/filename\*?=(?:UTF-8'')?"?([^";\r\n]+)/i) || hd.match(/name="?([^";\r\n]+)/i) || [])[1];
    if (nm && /\.(xlsx?|csv|pdf|png|jpe?g|docx|ods)$/i.test(nm)) { try { const R = await readFile(new File([dec(body, enc)], nm, { type: (hd.match(/content-type:\s*([\w/.+-]+)/i) || [])[1] || '' })); if (R) return Object.assign(R, { via: nm }); } catch (_) {} }
    if (/content-type:\s*text\/html/i.test(hd)) html = new TextDecoder().decode(dec(body, enc));
    else if (/content-type:\s*text\/plain/i.test(hd)) text = new TextDecoder().decode(dec(body, enc));
  }
  return (html && fromLines(htmlLines(html), 'email')) || fromLines((text || raw).split(/\r?\n/), 'email');
}
async function readFile(file) {
  if (isPic(file)) {   // a photo: read; if nothing makes sense, it may be sideways or upside down — turn it and read again
    let R = fromLines(await ocrLines(file), 'picture');
    for (const deg of [90, 270, 180]) { if (R) break; R = fromLines(await ocrLines(file, 'the picture turned ' + deg + '°', deg), 'picture'); }
    return R;
  }
  if (/\.docx$/i.test(file.name) || /wordprocessingml/.test(file.type || '')) return fromLines(await docxLines(file), 'word');
  if (/\.(html?|mht)$/i.test(file.name) || /^text\/html/.test(file.type || '')) return fromLines(htmlLines(await file.text()), 'web page');
  if (/\.eml$/i.test(file.name) || /^message\/rfc822/.test(file.type || '')) return emlRead(file);
  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
    for (let i = 0; i < 50 && typeof pdfjsLib === 'undefined'; i++) await new Promise(r => setTimeout(r, 100));
    if (typeof pdfjsLib === 'undefined') throw new Error('The PDF reader is still loading — try again in a moment');
    if (typeof PDFJS_WORKER !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise, lines = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const items = (await (await pdf.getPage(p)).getTextContent()).items.filter(it => String(it.str).trim()), rows = [];
      items.forEach(it => { const y = it.transform[5]; let r = rows.find(q => Math.abs(q.y - y) < 2.5); if (!r) { r = { y, parts: [] }; rows.push(r); } r.parts.push({ x: it.transform[4], s: it.str }); });
      rows.sort((a, b) => b.y - a.y).forEach(r => lines.push(r.parts.sort((a, b) => a.x - b.x).map(q => q.s.trim()).join(' ')));
    }
    const strict = parseLines(lines); if (strict) return strict;
    if (lines.filter(l => /\d/.test(l)).length >= 2) { const R = fromLines(lines, 'pdf'); if (R) return R; }
    // a scanned PDF (a picture inside): read each page as a picture (5 pages at most)
    const ocr = [];
    for (let p = 1; p <= Math.min(5, pdf.numPages); p++) { const pg = await pdf.getPage(p), vp = pg.getViewport({ scale: 2.2 }), c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
      await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise; (await ocrLines(c, 'page ' + p + ' of the scan')).forEach(l => ocr.push(l)); }
    return fromLines(ocr, 'scan');
  }
  if (/\.(txt|tsv)$/i.test(file.name) || /^text\/plain/.test(file.type || '')) return fromLines(String(await file.text()).split(/\r?\n/), 'text');
  if (typeof XLSX === 'undefined') throw new Error('The Excel reader did not load. Reload the page.');
  if (/\.(csv)$/i.test(file.name) || /^text\/csv/.test(file.type || '')) {   // a CSV is text: its dates stay as written (day first), never the library's month-first guess
    const wb = XLSX.read(await file.text(), { type: 'string', raw: true });
    for (const n of wb.SheetNames) { const aoa = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }), R = parseAoa(aoa) || fromLines(aoaLines(aoa), 'sheet'); if (R) return R; }
    return null;
  }
  // dates as the sheet's own day numbers (cellDates off): a time zone can never move a day's figures to the day before
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
  for (const n of wb.SheetNames) { const R = parseAoa(XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' })); if (R) return R; }
  for (const n of wb.SheetNames) { const R = fromLines(aoaLines(XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' })), 'sheet'); if (R) return R; }
  return null;
}
/** what was read becomes the month — or, when it holds only some figures of the same month (a TD screenshot), it is added in */
function accept(R, name, batch) {
  if (!R.fields) R.fields = FIELDS.map((_, i) => i).filter(i => R.rows.some(r => r.v[i] != null));
  const part = R.fields && R.fields.length < 9, label = part ? R.fields.map(i => FIELDS[i]).join(', ') : '';
  if ((part || batch) && S && S.y === R.y && S.m === R.m) {
    S = Object.assign(mergeInto(S, R), { file: String(S.file || '') + ' + ' + name, at: Date.now() });
    toast('✓ ' + label + ' from ' + name + ' added to ' + MONTHS[S.m] + ' (' + R.rows.length + ' days) — the other figures stay', 'ok');
  } else {
    S = Object.assign(R, { file: name, at: Date.now(), adj: [] });
    if (part) toast('✓ ' + label + ' read for ' + R.rows.length + ' days — ▶ Fill changes only those boxes on the portal; the others stay as they are', 'ok');
  }
  try { localStorage.setItem(LS, JSON.stringify(S)); } catch (_) {}
  draw();
}
/** the columns had no titles: ask once which figure each one is (remembered for files of the same shape) */
function askMap(R, name) {
  const box = $('ask'); if (!box) return;
  const guess = k => (R.head && R.head.length === R.width ? FIELDS.indexOf(R.head[k]) : -1);
  box.hidden = false;
  box.innerHTML = `<div class="dtf-ask-h"><b>🧩 Which figure is each column?</b><small>${esc(name)} has ${R.width} column${R.width === 1 ? '' : 's'} of figures without titles I know. Pick each one (or Ignore) — remembered for files like this.</small></div>
    <div class="dtf-ask-t"><table><thead><tr><th>Day</th>${Array.from({ length: R.width }, (_, k) => `<th><select data-k="${k}"><option value="-1">Ignore</option>${FIELDS.map((f, i) => `<option value="${i}"${guess(k) === i ? ' selected' : ''}>${esc(f)}</option>`).join('')}</select></th>`).join('')}</tr></thead>
    <tbody>${R.sample.map(r => `<tr><td>${esc(r.d)}</td>${Array.from({ length: R.width }, (_, k) => `<td>${r.n[k] == null ? '–' : fmt(r.n[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <div class="dtf-btns"><button type="button" class="btn gold" id="dtf-ask-ok">✓ Use these columns</button><button type="button" class="btn" id="dtf-ask-no">Cancel</button></div>`;
  $('ask-no').onclick = () => { box.hidden = true; box.innerHTML = ''; };
  $('ask-ok').onclick = () => {
    const mp = Array.from(box.querySelectorAll('select[data-k]')).map(x => +x.value);
    if (!mp.some(f => f >= 0)) { toast('Pick at least one column', 'err'); return; }
    const R2 = parseText(R.lines, mp); if (!R2 || R2.need) { toast('Those columns could not be read', 'err'); return; }
    try { const all = savedMaps(); all[R.width] = mp; localStorage.setItem(MAPS, JSON.stringify(all)); } catch (_) {}
    box.hidden = true; box.innerHTML = ''; accept(Object.assign(R2, { from: R.from || 'text' }), name);
  };
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
async function load(file, name, batch) {
  if (!file) return;
  name = name || file.name || 'pasted';
  try {
    const R = typeof file.text === 'string' ? fromLines(file.text.split(/\r?\n/), 'text') : await readFile(file);
    if (!R) { toast('No daily figures found in ' + name + ' — it needs a date on each day\'s line (e.g. 01/11/2026, 1 Nov 2026) and its figures', 'err'); return false; }
    if (R.need) { askMap(R, name); return false; }
    accept(R, name + (R.via ? ' (' + R.via + ')' : ''), batch);
    return true;
  } catch (e) { toast(e.message || 'Could not read that file', 'err'); return false; }
}
/** several files or photos at once (the month in two screenshots, TD and the rest …): read one by one and put together */
async function loadMany(list) {
  list = Array.from(list || []).filter(Boolean); if (!list.length) return;
  if (list.length === 1) return load(list[0]);
  let ok = 0; for (let i = 0; i < list.length; i++) { toast('📚 ' + (i + 1) + ' of ' + list.length + ': ' + list[i].name, 'info'); if (await load(list[i], list[i].name, i > 0)) ok++; }
  toast('✓ ' + ok + ' of ' + list.length + ' files read and put together', ok ? 'ok' : 'err');
}
// a negative figure (a month-end adjustment, "- 35,810") goes to the portal as 0 — on unless switched off (remembered)
const neg0On = () => { try { return localStorage.getItem('ho_dtcm_neg0') !== '0'; } catch (_) { return true; } };
/** the figures that are filled in: the sheet's, with negatives as 0 when that is on (pure) */
/** "all", "5", "1-5, 9, 12-14" → the days (1…max); "" or nonsense → [] (pure) */
function daysOf(txt, max) {
  const t = String(txt == null ? '' : txt).trim().toLowerCase(), out = new Set();
  if (t === 'all' || t === '*') { for (let d = 1; d <= max; d++) out.add(d); return [...out]; }
  t.split(/[,;\s]+/).forEach(p => { const m = p.match(/^(\d{1,2})(?:-(\d{1,2}))?$/); if (!m) return; const a = +m[1], b = m[2] ? +m[2] : a; for (let d = Math.min(a, b); d <= Math.max(a, b); d++) if (d >= 1 && d <= max) out.add(d); });
  return [...out].sort((a, b) => a - b);
}
/** the changes made on the page, in order (a later one wins): [{ f: field index or -1 for the whole day, days: "1-5", set: number | sheet: true }]
 *  ("put 0" = set 0; sheet = back to the sheet's figure) → day → Map(field → the figure, or 'sheet') (pure) */
function changeMap(adj, max) {
  const z = {};
  (adj || []).forEach(a => daysOf(a.days, max).forEach(d => {
    const m = z[d] || (z[d] = new Map()), v = a.sheet ? 'sheet' : Number.isFinite(+a.set) ? +a.set : 0;
    (a.f < 0 ? FIELDS.map((_, i) => i) : [+a.f]).forEach(i => m.set(i, v));
  }));
  return z;
}
/** the figures that are filled in: the sheet's, with negatives as 0 when that is on, then the changes made on the page (pure) */
function filled(S0, neg0, adj) {
  const z = changeMap(adj, 31);
  return Object.assign({}, S0, { rows: S0.rows.map(r => ({ d: r.d, v: r.v.map((x, i) => { const c = z[r.d] && z[r.d].get(i);
    return c === undefined || c === 'sheet' ? (neg0 && x < 0 ? 0 : x) : c; }) })) });
}
function draw() {
  const out = $('out'); if (!out) return;
  const stp = $('steps'); if (stp) stp.querySelectorAll('li').forEach(li => { const k = +li.dataset.s; li.className = !S ? (k === 1 ? 'now' : '') : k === 1 ? 'done' : 'now'; });
  if (!S) { out.innerHTML = ''; return; }
  const adj = S.adj || [], n0 = neg0On(), F = filled(S, n0, adj), C = check(S), CF = check(F), mm = MONTHS[S.m] + ' ' + S.y, ZM = changeMap(adj, 31);
  const dim = new Date(S.y, S.m + 1, 0).getDate();
  const warn = [];
  if (S.from === 'pdf') warn.push('Read from the PDF: each day there is rounded to whole dirhams. Use the Excel file for the exact numbers.');
  if (S.from === 'picture' || S.from === 'scan') warn.push('Read from a picture: check a few figures against it before you fill (the reader can mistake a digit).');
  const have = FIELDS.map((_, i) => S.rows.some(r => r.v[i] != null)), miss = FIELDS.filter((_, i) => !have[i]);
  if (S.from === 'blank') warn.push(adj.length ? 'Blank month: only what you set (' + adj.length + ' change' + (adj.length === 1 ? '' : 's') + ') is filled — every other box on the portal stays as it is.' : 'Blank month: nothing is set yet — use Change before filling (e.g. TD Fee → 0, all days) or tap a box in the table.');
  else if (miss.length && miss.length < 9) warn.push('Not in what was read: ' + miss.join(', ') + ' — ▶ Fill leaves those boxes on the portal as they are. Drop another file or screenshot with them to add them.');
  if (C.missing.length) warn.push(`Days missing from the sheet: ${C.missing.join(', ')}.`);
  if (C.vsTotal.length) warn.push('The days do not add up to the sheet\'s Total row: ' + C.vsTotal.map(x => `${x.f} ${fmt(x.sum)} vs ${fmt(x.total)}`).join(' · ') + '.');
  if (!n0) C.neg.forEach(x => warn.push(`${x.d} ${MON[S.m]}: ${x.f} is negative (${fmt(x.v)}) — a month-end adjustment? The portal may refuse it.`));
  if (C.over.length) warn.push(`More rooms occupied than available on ${C.over.join(', ')} ${MON[S.m]}.`);
  out.innerHTML = `
    <div class="dtf-sum"><div class="m"><small>Month</small><b>${esc(mm)}</b><i>${S.rows.length} days · ${esc(S.file || '')}</i></div>
      ${[0, 1, 2, 6].map(i => `<div class="k${i}"><small>${esc(FIELDS[i])}</small><b>${fmt(CF.sums[i])}</b><i>AED${n0 && CF.sums[i] !== C.sums[i] ? ' · sheet ' + fmt(C.sums[i]) : ''}</i></div>`).join('')}
      <div class="k7"><small>Rooms occupied</small><b>${fmt(C.sums[7])}</b><i>of ${fmt(C.sums[8])}</i></div></div>
    ${S.heads ? `<div class="dtf-map"><b>Columns read</b> ${FIELDS.map((f, i) => `<span>${esc(f)} ← <i>${esc(S.heads[i] || '— not in the sheet')}</i></span>`).join('')}</div>` : ''}
    ${C.neg.length ? `<label class="dtf-neg"><input type="checkbox" id="dtf-neg0"${n0 ? ' checked' : ''}> <span><b>Negative figures → 0</b> ${n0 ? `· ${C.neg.map(x => `${x.d} ${MON[S.m]} ${esc(x.f)} ${fmt(x.v)} → 0`).join(' · ')}` : `· off: ${C.neg.length} negative figure${C.neg.length === 1 ? '' : 's'} will be filled as they are`}</span></label>` : ''}
    <div class="dtf-adj"><div class="dtf-adj-h"><b>✏️ Change before filling</b><small>Put 0 or any figure in a column (e.g. all TD Fee) or a whole day, for all days or just some — or click any figure in the table below. The rest stays as on the sheet; your file never changes.</small></div>
      <div class="dtf-adj-r"><label>Do<select id="dtf-aact"><option value="zero">Put 0</option><option value="set">Set to a number</option><option value="sheet">Back to the sheet's figure</option></select></label>
        <label>What<select id="dtf-af"><option value="-1">Whole day (every column)</option>${FIELDS.map((f, i) => `<option value="${i}"${i === 6 ? ' selected' : ''}>${esc(f)}</option>`).join('')}</select></label>
        <label>Days<input id="dtf-ad" placeholder="all  ·  5  ·  1-5, 9" value="all"></label>
        <label id="dtf-avl" hidden>Number<input id="dtf-aval" inputmode="decimal" placeholder="e.g. 1250.50"></label>
        <button type="button" class="btn gold" id="dtf-aadd">✓ Apply</button></div>
      ${adj.length ? `<div class="dtf-adj-l">${adj.map((a, k) => { const ds = daysOf(a.days, dim); return `<span>${a.f < 0 ? 'Whole day' : esc(FIELDS[a.f])} → ${a.sheet ? 'the sheet' : fmt(+a.set || 0)} · ${String(a.days).trim().toLowerCase() === 'all' ? 'all days' : ds.length === 1 ? 'day ' + ds[0] : 'days ' + esc(a.days)}<button type="button" data-adel="${k}" title="Undo this change">✕</button></span>`; }).join('')}<button type="button" class="dtf-adj-x" id="dtf-aclr">Undo all</button></div>` : ''}</div>
    ${warn.length ? `<div class="dtf-warn">${warn.map(w => `<div>⚠️ ${esc(w)}</div>`).join('')}</div>` : '<div class="dtf-ok">✅ Every day is there and the days add up to the sheet\'s totals.</div>'}
    <div class="dtf-go">
      <div class="dtf-go-h"><span>3</span><div><h3>Fill the DTCM portal</h3><p>About a minute for a month · it skips days that already match</p></div></div>
      <ol>
        <li>Open the portal: <a href="${PORTAL}" target="_blank" rel="noopener">dhss.det.gov.ae → Revenue ↗</a>, pick <b>${esc(mm)}</b> and press <b>Filter</b>.</li>
        <li>Press <b>📋 Copy the filler</b> below.</li>
        <li>On the portal press <b>F12</b> → <b>Console</b>, paste (Ctrl+V) and press <b>Enter</b>. <small>(The first time Chrome asks you to type <code>allow pasting</code> first.)</small></li>
        <li>A HotelOps box appears: choose the <b>days</b> (tap them, or type e.g. <code>1</code> or <code>1-5</code>; <b>All</b> = the month), <b>🔍 Check</b> compares, <b>▶ Fill</b> fills each chosen day and presses <b>Update</b>, then checks it saved. <small>First time? Try day 1 only.</small></li>
        <li>Need to redo days? <b>↻ Refill</b> types the figures again and saves, even if they match. <b>🧹 Clear</b> puts 0 in every box of the chosen days and saves. Both ask first.</li>
      </ol>
      <div class="dtf-btns"><button type="button" class="btn gold" id="dtf-copy">📋 Copy the filler</button>
        <a class="btn" id="dtf-bm" title="Or drag this to your bookmarks bar, then click it on the portal page" href="#">⭐ Drag to bookmarks</a></div>
      <p class="dtf-note">The filler only types into the portal's own boxes and presses its Update button, one day at a time. It stops at the first day the portal refuses.</p>
    </div>
    <div class="dtf-tw"><table><thead><tr><th>Day</th>${SHORT.map(s => `<th>${esc(s)}</th>`).join('')}</tr></thead><tbody>
      ${S.rows.map(r => `<tr><td>${new Date(S.y, S.m, r.d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</td>${r.v.map((v, i) => v == null ? (ZM[r.d] && ZM[r.d].has(i) && ZM[r.d].get(i) !== 'sheet' ? `<td class="zz" data-cd="${r.d}" data-ci="${i}" title="Set by you · click to change">${fmt(ZM[r.d].get(i))}</td>` : `<td data-cd="${r.d}" data-ci="${i}" title="Empty — click to set">–</td>`) : ZM[r.d] && ZM[r.d].has(i) && ZM[r.d].get(i) !== 'sheet' ? (ZM[r.d].get(i) !== v ? `<td class="z zz" data-cd="${r.d}" data-ci="${i}" title="Changed by you · on the sheet: ${fmt(v)} · click to change">${fmt(ZM[r.d].get(i))} <s>${fmt(v)}</s></td>` : `<td class="zz" data-cd="${r.d}" data-ci="${i}">${fmt(v)}</td>`) : v < 0 && n0 ? `<td class="z" data-cd="${r.d}" data-ci="${i}" title="On the sheet: ${fmt(v)}">0 <s>${fmt(v)}</s></td>` : `<td class="${v < 0 ? 'neg' : ''}" data-cd="${r.d}" data-ci="${i}">${fmt(v)}</td>`).join('')}</tr>`).join('')}
      <tr class="tot"><td>Total filled</td>${CF.sums.map(v => `<td>${fmt(v)}</td>`).join('')}</tr></tbody></table></div>`;
  const keep = a => { S.adj = a; try { localStorage.setItem(LS, JSON.stringify(S)); } catch (_) {} draw(); };
  const act = () => $('aact').value;
  $('aact').onchange = () => { $('avl').hidden = act() !== 'set'; if (act() === 'set') $('aval').focus(); };
  $('aadd').onclick = () => {
    const f = +$('af').value, days = $('ad').value.trim() || 'all', ds = daysOf(days, dim), a = act();
    if (!ds.length) { toast('Type the days: all, 5, or 1-5, 9', 'err'); return; }
    let c = { f, days };
    if (a === 'sheet') c.sheet = true;
    else if (a === 'set') { const t = $('aval').value.replace(/[,\s]/g, ''); if (!/^-?\d+(\.\d+)?$/.test(t)) { toast('Type the number to put (e.g. 1250.50)', 'err'); $('aval').focus(); return; } c.set = +t; }
    else c.set = 0;
    keep(adj.concat([c]));
    toast(`${f < 0 ? 'Whole day' : FIELDS[f]} → ${c.sheet ? 'the sheet' : fmt(c.set)} on ${ds.length === dim ? 'all days' : ds.length + ' day' + (ds.length === 1 ? '' : 's')} — copy the filler again`, 'ok');
  };
  ['ad', 'aval'].forEach(id => { $(id).onkeydown = e => { if (e.key === 'Enter') $('aadd').click(); }; });
  // click any figure: change just that one (empty = back to the sheet)
  out.querySelectorAll('td[data-cd]').forEach(td => { td.style.cursor = 'pointer'; td.onclick = () => {
    const d = +td.dataset.cd, i = +td.dataset.ci, row = S.rows.find(r => r.d === d), was = F.rows.find(r => r.d === d).v[i];
    const t = prompt(`${FIELDS[i]} on ${d} ${MON[S.m]} — the figure to fill (now ${fmt(was)}, sheet ${fmt(row && row.v[i])}).\nLeave empty for the sheet's figure.`, String(was == null ? '' : was));
    if (t === null) return;
    const v = t.replace(/[,\s]/g, '');
    if (v === '') { keep(adj.concat([{ f: i, days: String(d), sheet: true }])); return; }
    if (!/^-?\d+(\.\d+)?$/.test(v)) { toast('That is not a number', 'err'); return; }
    keep(adj.concat([{ f: i, days: String(d), set: +v }]));
  }; });
  out.querySelectorAll('[data-adel]').forEach(b => { b.onclick = () => keep(adj.filter((_, k) => k !== +b.dataset.adel)); });
  const ac = $('aclr'); if (ac) ac.onclick = () => keep([]);
  const ng = $('neg0'); if (ng) ng.onchange = () => { try { localStorage.setItem('ho_dtcm_neg0', ng.checked ? '1' : '0'); } catch (_) {} draw(); };
  const code = fillerCode(F);
  $('copy').onclick = () => { if (typeof copyToClipboard === 'function') copyToClipboard(code, $('copy'), '📋 Copy the filler'); else navigator.clipboard.writeText(code).then(() => toast('Copied — paste it in the portal\'s console', 'ok')); };
  $('bm').href = 'javascript:' + encodeURIComponent(code);
  $('bm').onclick = e => { e.preventDefault(); toast('Drag this button to your bookmarks bar, then click the bookmark on the portal page', 'info'); };
}
const CSS = `
#panel-${PANEL} .dtf-drop{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:18px;border:2px dashed var(--border2);border-radius:14px;background:var(--bg2)}
#panel-${PANEL} .dtf-link{flex:1 1 100%;display:flex;gap:8px}#panel-${PANEL} .dtf-link input{flex:1;min-width:0;padding:9px 12px;border-radius:11px;border:1px solid var(--border2);background:var(--card);color:var(--text);font:inherit;font-size:.86rem}
#panel-${PANEL} #dtf-paste{flex:1 1 100%;resize:vertical;min-height:38px;padding:9px 12px;border-radius:11px;border:1px dashed var(--border2);background:var(--card);color:var(--text);font:inherit;font-size:.86rem}
#panel-${PANEL} .dtf-blank{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:10px 0 0;padding:12px 14px;border-radius:12px;border:1px dashed var(--border2);background:var(--bg2)}#panel-${PANEL} .dtf-blank>span{font-size:20px}#panel-${PANEL} .dtf-blank>div{flex:1 1 240px}
#panel-${PANEL} .dtf-blank small{display:block;color:var(--text3);font-size:.8rem;line-height:1.5}#panel-${PANEL} .dtf-blank input{padding:8px 10px;border-radius:10px;border:1px solid var(--border);background:var(--card);color:var(--text);font:inherit}
#panel-${PANEL} .dtf-ask{margin:12px 0;padding:14px;border-radius:14px;border:1px solid color-mix(in srgb,#f59e0b 45%,var(--border));background:color-mix(in srgb,#f59e0b 8%,var(--card))}#panel-${PANEL} .dtf-ask[hidden]{display:none}
#panel-${PANEL} .dtf-ask-h small{display:block;color:var(--text3);font-size:.8rem;margin:2px 0 10px}#panel-${PANEL} .dtf-ask-t{overflow-x:auto}#panel-${PANEL} .dtf-ask-t table{border-collapse:collapse;font-size:.84rem}
#panel-${PANEL} .dtf-ask-t th,#panel-${PANEL} .dtf-ask-t td{padding:6px 8px;border-bottom:1px solid var(--border);text-align:right;white-space:nowrap}#panel-${PANEL} .dtf-ask-t td:first-child,#panel-${PANEL} .dtf-ask-t th:first-child{text-align:left}
#panel-${PANEL} .dtf-ask-t select{padding:6px 8px;border-radius:9px;border:1px solid var(--border);background:var(--card);color:var(--text);font:inherit;font-size:.8rem}
#panel-${PANEL} .dtf-drop.over{border-color:var(--accent)}
#panel-${PANEL} .dtf-drop-t{flex:1 1 220px;display:flex;flex-direction:column;gap:2px}#panel-${PANEL} .dtf-drop-t span{color:var(--text3);font-size:.8rem}
#panel-${PANEL} .dtf-sum{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:16px 0}
#panel-${PANEL} .dtf-sum>div{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column}
#panel-${PANEL} .dtf-sum small{font:700 10.5px var(--font);letter-spacing:.06em;text-transform:uppercase;color:var(--text3)}#panel-${PANEL} .dtf-sum b{font-size:1.25rem;margin-top:2px}#panel-${PANEL} .dtf-sum i{font-style:normal;color:var(--text3);font-size:.78rem}
#panel-${PANEL} .dtf-warn{padding:10px 14px;border-radius:12px;background:color-mix(in srgb,var(--amber,#d97706) 9%,transparent);border:1px solid color-mix(in srgb,var(--amber,#d97706) 35%,transparent);font-size:.84rem;line-height:1.6}
#panel-${PANEL} .dtf-map{display:flex;flex-wrap:wrap;gap:6px 14px;margin:0 0 12px;font-size:.78rem;color:var(--text3)}#panel-${PANEL} .dtf-map b{color:var(--text2)}#panel-${PANEL} .dtf-map i{font-style:normal;color:var(--text)}
#panel-${PANEL} .dtf-adj{margin:0 0 10px;padding:12px 14px;border-radius:12px;background:var(--bg2);border:1px solid var(--border)}#panel-${PANEL} .dtf-adj-h small{display:block;color:var(--text3);font-size:.8rem;margin-top:2px}
#panel-${PANEL} .dtf-adj-r{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-top:10px}#panel-${PANEL} .dtf-adj-r label{display:flex;flex-direction:column;gap:4px;font-size:.72rem;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.04em}
#panel-${PANEL} .dtf-adj-r select,#panel-${PANEL} .dtf-adj-r input{padding:8px 10px;border-radius:10px;border:1px solid var(--border);background:var(--card);color:var(--text);font:inherit;font-size:.88rem;min-width:170px}
#panel-${PANEL} .dtf-adj-l{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;align-items:center}#panel-${PANEL} .dtf-adj-l span{display:inline-flex;gap:6px;align-items:center;padding:4px 6px 4px 10px;border-radius:99px;background:color-mix(in srgb,#f59e0b 16%,var(--card));border:1px solid color-mix(in srgb,#f59e0b 40%,var(--border));font-size:.8rem}
#panel-${PANEL} .dtf-adj-l span button{border:0;background:transparent;color:var(--text2);cursor:pointer;font-size:.8rem;padding:0 4px}#panel-${PANEL} .dtf-adj-x{border:0;background:transparent;color:var(--text3);text-decoration:underline;cursor:pointer;font-size:.8rem}
#panel-${PANEL} .dtf-tw td[data-cd]:hover{outline:1px dashed color-mix(in srgb,#f59e0b 70%,transparent);outline-offset:-3px}
#panel-${PANEL} .dtf-tw td.zz{background:color-mix(in srgb,#f59e0b 12%,transparent)!important}
#panel-${PANEL} .dtf-neg{display:flex;gap:8px;align-items:flex-start;margin:0 0 10px;padding:10px 14px;border-radius:12px;background:var(--bg2);border:1px solid var(--border);font-size:.84rem;cursor:pointer}#panel-${PANEL} .dtf-tw td.z s{color:var(--text3);font-size:.72rem;margin-left:4px}
#panel-${PANEL} .dtf-ok{padding:10px 14px;border-radius:12px;background:color-mix(in srgb,var(--green,#16a34a) 9%,transparent);border:1px solid color-mix(in srgb,var(--green,#16a34a) 30%,transparent);font-size:.85rem}
#panel-${PANEL} .dtf-go{margin:16px 0;padding:16px 18px;border-radius:14px;background:var(--card);border:1px solid var(--border)}
#panel-${PANEL} .dtf-go h3{margin:0 0 8px;font-size:1rem}#panel-${PANEL} .dtf-go ol{margin:0 0 12px;padding-left:20px;line-height:1.8;font-size:.88rem;color:var(--text2)}#panel-${PANEL} .dtf-go b{color:var(--text)}
#panel-${PANEL} .dtf-btns{display:flex;gap:8px;flex-wrap:wrap}#panel-${PANEL} .dtf-note{margin:10px 0 0;font-size:.78rem;color:var(--text3)}
#panel-${PANEL} .dtf-tw{overflow:auto;border:1px solid var(--border);border-radius:12px;background:var(--card)}
#panel-${PANEL} .dtf-tw table{width:100%;border-collapse:collapse;font-size:.8rem}#panel-${PANEL} .dtf-tw th,#panel-${PANEL} .dtf-tw td{padding:6px 10px;text-align:right;white-space:nowrap;border-bottom:1px solid var(--border)}
#panel-${PANEL} .dtf-tw th:first-child,#panel-${PANEL} .dtf-tw td:first-child{text-align:left}#panel-${PANEL} .dtf-tw th{font:700 10.5px var(--font);letter-spacing:.05em;text-transform:uppercase;color:var(--text3);background:var(--bg2);position:sticky;top:0}
#panel-${PANEL} .dtf-hero{display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding:20px 22px;margin-bottom:14px;border-radius:18px;border:1px solid var(--border);background:radial-gradient(120% 140% at 0% 0%,rgba(20,184,166,.18),transparent 55%),radial-gradient(120% 140% at 100% 0%,rgba(234,185,74,.14),transparent 55%),var(--card)}
#panel-${PANEL} .dtf-hero-ic{width:56px;height:56px;border-radius:16px;display:grid;place-items:center;font-size:28px;background:linear-gradient(135deg,#14b8a6,#0f766e);box-shadow:0 10px 26px -8px rgba(15,118,110,.6);flex:none}
#panel-${PANEL} .dtf-hero-t{flex:1;min-width:200px}#panel-${PANEL} .dtf-hero h1{margin:0;font-size:1.55rem;letter-spacing:-.01em}#panel-${PANEL} .dtf-hero p{margin:4px 0 0;color:var(--text2);font-size:.88rem}
#panel-${PANEL} .dtf-steps{list-style:none;display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:0 0 14px;padding:0}
#panel-${PANEL} .dtf-steps li{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;border:1px solid var(--border);background:var(--card);color:var(--text3);font-size:.84rem;font-weight:600}
#panel-${PANEL} .dtf-steps b{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;background:var(--bg2);border:1px solid var(--border2);font-size:.8rem;flex:none}
#panel-${PANEL} .dtf-steps li.now{color:var(--text);border-color:color-mix(in srgb,var(--accent) 55%,var(--border))}#panel-${PANEL} .dtf-steps li.now b{background:var(--accent);color:#111;border-color:var(--accent)}
#panel-${PANEL} .dtf-steps li.done{color:var(--text2)}#panel-${PANEL} .dtf-steps li.done b{background:var(--green,#16a34a);color:#fff;border-color:transparent;font-size:0}#panel-${PANEL} .dtf-steps li.done b::after{content:'✓';font-size:.85rem}
#panel-${PANEL} .dtf-sum>div{position:relative;overflow:hidden}#panel-${PANEL} .dtf-sum>div::before{content:'';position:absolute;left:0;top:0;right:0;height:3px;background:var(--k,var(--accent))}
#panel-${PANEL} .dtf-sum .m{--k:#0f766e}#panel-${PANEL} .dtf-sum .k0{--k:#2563eb}#panel-${PANEL} .dtf-sum .k1{--k:#d97706}#panel-${PANEL} .dtf-sum .k2{--k:#7c3aed}#panel-${PANEL} .dtf-sum .k6{--k:#db2777}#panel-${PANEL} .dtf-sum .k7{--k:#16a34a}
#panel-${PANEL} .dtf-sum b{font-variant-numeric:tabular-nums}
#panel-${PANEL} .dtf-go{background:linear-gradient(180deg,color-mix(in srgb,#14b8a6 7%,var(--card)),var(--card))}
#panel-${PANEL} .dtf-go-h{display:flex;gap:12px;align-items:center;margin-bottom:10px}#panel-${PANEL} .dtf-go-h>span{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:var(--accent);color:#111;font-weight:800;flex:none}#panel-${PANEL} .dtf-go-h h3{margin:0}#panel-${PANEL} .dtf-go-h p{margin:2px 0 0;font-size:.78rem;color:var(--text3)}
#panel-${PANEL} .dtf-tw tbody tr:nth-child(even) td{background:color-mix(in srgb,var(--bg2) 55%,transparent)}#panel-${PANEL} .dtf-tw tbody tr:hover td{background:color-mix(in srgb,var(--accent) 8%,transparent)}
@media (max-width:640px){#panel-${PANEL} .dtf-steps{grid-template-columns:1fr}}
#panel-${PANEL} .dtf-tw td{font-family:var(--mono)}#panel-${PANEL} .dtf-tw td.neg{color:var(--rose,#e11d48);font-weight:700}#panel-${PANEL} .dtf-tw tr.tot td{font-weight:700;background:var(--bg2)}`;
function mount() {
  if (document.getElementById('panel-' + PANEL)) return;
  const main = document.querySelector('main.main') || document.querySelector('main'), nav = document.querySelector('nav.sidenav') || document.querySelector('nav');
  if (!main || !nav) return;
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const panel = document.createElement('div'); panel.className = 'panel'; panel.id = 'panel-' + PANEL;
  panel.innerHTML = `<div style="max-width:1200px">
    <div class="dtf-hero"><div class="dtf-hero-ic">🏛️</div><div class="dtf-hero-t"><h1>DTCM Revenue Fill</h1><p>Finance's daily figures → the DTCM portal, filled and saved day by day, then checked</p></div>
      <button type="button" class="btn rose" id="dtf-clear">✕ Clear</button></div>
    <ol class="dtf-steps" id="dtf-steps"><li data-s="1"><b>1</b><span>Load finance's sheet</span></li><li data-s="2"><b>2</b><span>Review the month</span></li><li data-s="3"><b>3</b><span>Fill on the portal</span></li></ol>
    <div class="dtf-drop" id="dtf-drop"><div style="font-size:26px">📊</div><div class="dtf-drop-t"><b>Drop the figures here — any kind</b><span>Finance's “Daily data for DTCM” · any Excel, CSV, Numbers, ODS · Word · PDF (also scanned) · photos and screenshots · a saved email · a web page · several at once · even one column, e.g. only the TD Fee</span></div>
      <button type="button" class="btn gold" id="dtf-browse">📂 Browse…</button><button type="button" class="btn" id="dtf-cam">📷 Photo</button>
      <input type="file" id="dtf-file" multiple accept=".xlsx,.xls,.xlsm,.xlsb,.csv,.ods,.numbers,.pdf,.txt,.tsv,.docx,.html,.htm,.eml,image/*" hidden><input type="file" id="dtf-camf" accept="image/*" capture="environment" hidden>
      <div class="dtf-link"><input id="dtf-url" type="url" inputmode="url" placeholder="…or a link: Google Sheets / Drive, OneDrive, Dropbox, a photo or file link" spellcheck="false"><button type="button" class="btn" id="dtf-urlgo">🔗 Get it</button></div>
      <textarea id="dtf-paste" rows="1" placeholder="…or paste here: a screenshot, or a table copied from Excel / an email (Ctrl+V)"></textarea></div>
    <div class="dtf-blank"><span>✏️</span><div><b>No file? Start a blank month</b><small>Then set what you want — e.g. TD Fee → 0 for all days — or tap a day's box to type a figure. Only what you set is filled; every other box on the portal stays as it is.</small></div>
      <input type="month" id="dtf-bm-m"><button type="button" class="btn" id="dtf-bm-go">✏️ Start</button></div>
    <div class="dtf-ask" id="dtf-ask" hidden></div>
    <div id="dtf-out"></div></div>`;
  main.appendChild(panel);
  const item = document.createElement('div'); item.className = 'nav-item'; item.id = 'nav-' + PANEL; item.dataset.panel = PANEL;
  item.setAttribute('onclick', "showPanel('" + PANEL + "')");
  item.innerHTML = '<div class="nav-icon">🏛️</div>DTCM Revenue Fill';
  const anchor = document.getElementById('nav-dtcm'); if (anchor && anchor.parentNode === nav) anchor.after(item); else nav.appendChild(item);
  // the phone's "More" menu is its own list: add this page there too (next to dtcm)
  const grid = document.querySelector('.mob-more-grid');
  if (grid && !grid.querySelector('.mob-more-item[data-panel="' + PANEL + '"]')) {
    const b = document.createElement('button');
    b.className = 'mob-more-item'; b.dataset.panel = PANEL; b.type = 'button';
    b.setAttribute('onclick', "showPanel('" + PANEL + "');(typeof closeMobMore==='function'?closeMobMore:typeof toggleMobMore==='function'?toggleMobMore:function(){})()");
    b.innerHTML = '<span class="mob-item-icon">🏛️</span>DTCM Revenue Fill';
    const at = grid.querySelector('.mob-more-item[data-panel="dtcm"]');
    if (at) at.after(b); else grid.appendChild(b);
  }
  try { ['owner', 'manager', 'supervisor'].forEach(r => { if (typeof ROLES !== 'undefined' && ROLES[r] && !ROLES[r].panels.includes(PANEL)) ROLES[r].panels.push(PANEL); });
    if (typeof currentProfile !== 'undefined' && currentProfile && typeof applyRole === 'function') applyRole(currentProfile.role); } catch (_) {}
  $('browse').onclick = () => { $('file').value = ''; $('file').click(); };
  $('file').onchange = e => { loadMany(e.target.files); e.target.value = ''; };
  // ✏️ a blank month: no file needed
  { const t = new Date(); $('bm-m').value = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0'); }
  $('bm-go').onclick = () => {
    const v = $('bm-m').value; if (!/^\d{4}-\d{2}$/.test(v)) { toast('Pick the month', 'err'); return; }
    const y = +v.slice(0, 4), m = +v.slice(5) - 1;
    if (S && !confirm('Replace the figures loaded now (' + MONTHS[S.m] + ' ' + S.y + ') with a blank ' + MONTHS[m] + ' ' + y + '?')) return;
    S = Object.assign(blankMonth(y, m), { file: 'Blank month', at: Date.now(), adj: [] });
    try { localStorage.setItem(LS, JSON.stringify(S)); } catch (_) {}
    draw(); toast('✏️ Blank ' + MONTHS[m] + ' ' + y + ' — now set the figures (e.g. TD Fee → 0, all days)', 'ok');
    setTimeout(() => { const a = document.querySelector('#panel-' + PANEL + ' .dtf-adj'); if (a) a.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 100);
  };
  $('cam').onclick = () => $('camf').click(); $('camf').onchange = e => { loadMany(e.target.files); e.target.value = ''; };
  const goLink = async () => { const u = $('url').value.trim(); if (!u) { $('url').focus(); return; } const b = $('urlgo'); b.disabled = true; b.textContent = '⏳ Getting…';
    try { const f = await fromLink(u); await load(f, f.name); $('url').value = ''; } catch (e) { toast(e.message, 'err'); } finally { b.disabled = false; b.textContent = '🔗 Get it'; } };
  $('urlgo').onclick = goLink; $('url').onkeydown = e => { if (e.key === 'Enter') goLink(); };
  // paste: a screenshot (picture) or a copied table (text) — in the paste box, or anywhere on this page
  const onPaste = e => {
    const cd = e.clipboardData; if (!cd) return;
    const img = Array.from(cd.items || []).find(it => /^image\//.test(it.type));
    if (img) { e.preventDefault(); const f = img.getAsFile(); if (f) load(f, 'pasted screenshot'); return; }
    const t = cd.getData('text/plain');
    if (t && /^https?:\/\/\S+$/.test(t.trim())) { e.preventDefault(); $('url').value = t.trim(); goLink(); $('paste').value = ''; return; }
    const ht = cd.getData('text/html'); if (ht && /<t[dr][\s>]/i.test(ht)) { e.preventDefault(); const R = fromLines(htmlLines(ht), 'text'); if (R && R.need) askMap(R, 'pasted table'); else if (R) accept(R, 'pasted table'); else toast('No daily figures in what was pasted', 'err'); $('paste').value = ''; return; }
    if (t && /\d/.test(t)) { e.preventDefault(); load({ text: t }, 'pasted table'); $('paste').value = ''; }
  };
  $('paste').addEventListener('paste', onPaste);
  document.addEventListener('paste', e => { const pn = document.getElementById('panel-' + PANEL); if (pn && pn.classList.contains('active') && !e.target.closest('input,textarea,[contenteditable]')) onPaste(e); });
  $('clear').onclick = () => { S = null; try { localStorage.removeItem(LS); } catch (_) {} draw(); };
  const z = $('drop');
  ['dragenter', 'dragover'].forEach(ev => z.addEventListener(ev, e => { e.preventDefault(); z.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => z.addEventListener(ev, e => { e.preventDefault(); z.classList.remove('over'); }));
  z.addEventListener('drop', e => { const dt = e.dataTransfer; if (!dt) return;
    if (dt.files && dt.files.length) { loadMany(dt.files); return; }
    const u = (dt.getData('text/uri-list') || dt.getData('text/plain') || '').trim(); if (/^https?:\/\//.test(u)) { $('url').value = u.split(/\s/)[0]; goLink(); } else if (/\d/.test(u)) load({ text: u }, 'dropped text'); });
  draw();
}
W.hoDtcmFill = { blankMonth, linkTargets, cleanPic, ocrLines, headOrder, lineDate, lineNums, parseText, aoaLines, mergeInto, daysOf, changeMap, filled, parseAoa, parseLines, check, fillerCode, dateOf, FILLER, FIELDS };
if (typeof document !== 'undefined' && document.addEventListener) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount(); }
})();
