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
/** the checks shown before filling */
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
    + '.hoA{display:flex;gap:8px;padding:12px 14px}.hoA button{flex:1;padding:9px 10px;border-radius:11px;border:1px solid #cbd5e1;background:#fff;color:#0f172a;font-weight:650}.hoA button.p{background:linear-gradient(135deg,#14b8a6,#0f766e);border-color:#0f766e;color:#fff;box-shadow:0 6px 16px -6px rgba(15,118,110,.6)}.hoA button.d{background:#dc2626;border-color:#dc2626;color:#fff}'
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
  function count(k) { return Object.keys(st).filter(function (d) { return st[d] === k; }).length; }
  function paint(msg, tone) {
    if (msg !== undefined) note = msg ? { h: msg, t: tone || (/^✅/.test(msg) ? 'ok' : /^⛔/.test(msg) ? 'err' : /^⚠️|^🔍 \d/.test(msg) ? 'warn' : 'info') } : null;
    var sel = pickDays(daysTxt), all = sel.length === D.rows.length, selSet = {}; sel.forEach(function (r) { selSet[r.d] = 1; });
    var sub = 'Finance ' + MON[D.m] + ' ' + D.y + (anyMonth ? ' → this page: ' + target() : '');
    var fillLbl = all ? '▶ Fill all ' + D.rows.length + ' days' : '▶ Fill ' + sel.length + ' day' + (sel.length === 1 ? '' : 's');
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
    h += '<div class="hoA">' + (busy ? '<button data-a="stop" class="d">■ Stop</button>' : '<button data-a="check">🔍 Check</button><button data-a="fill" class="p">' + fillLbl + '</button>') + '</div>';
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
  async function run(write) {
    var R = ready(); if (R.err) { paint('⚠️ ' + R.err); return; }
    var C = R.C; busy = true; stop = false; lines = [];
    var done = 0, same0 = 0, diffs = 0, fail = '';
    var todo = pickDays(daysTxt);
    if (!todo.length) { busy = false; paint('⚠️ No day of ' + MON[D.m] + ' in "' + daysTxt + '". Type e.g. 1 or 1-5, or all.'); return; }
    todo.forEach(function (r) { delete st[r.d]; });
    paint(write ? 'Filling… keep this tab open. Each day: open → fill → Update → check.' : 'Checking every chosen day against the finance sheet…', 'info');
    for (var k = 0; k < todo.length && !stop; k++) {
      var r = todo[k], tr = rowFor(r.d);
      prog = { k: k, n: todo.length, d: r.d, w: write }; st[r.d] = 'run'; paint();
      if (!tr) { st[r.d] = 'miss'; line(r.d, '⚠️', 'not on the page', '#b45309'); diffs++; continue; }
      var got = vals(tr, C), off = C.map(function (c, i) { return c >= 0 && r.v[i] != null && !same(got[i], r.v[i]) ? i : -1; }).filter(function (i) { return i >= 0; });
      if (!off.length) { same0++; st[r.d] = 'same'; line(r.d, '✓', 'already right', '#0e7490'); continue; }
      if (!write) { diffs++; st[r.d] = 'diff'; line(r.d, '≠', off.map(function (i) { return FIELDS[i] + ' ' + got[i] + ' → ' + r.v[i]; }).join(' · '), '#b45309'); continue; }
      // open the line for editing: its ✎ Edit button, or a click on the line itself (how the portal opens a row)
      var eb = tr.querySelector('.jsgrid-edit-button');
      if (eb) eb.click(); else (tr.cells[2] || tr.cells[1] || tr).click();
      await sleep(300);
      if (!document.querySelector('.jsgrid-edit-row') && eb) { (tr.cells[2] || tr.cells[1] || tr).click(); await sleep(300); }
      var er = document.querySelector('.jsgrid-edit-row'); if (!er) { st[r.d] = 'fail'; fail = r.d + ' ' + MON[D.m] + ': the row did not open for editing'; break; }
      C.forEach(function (c, i) {
        var inp = c >= 0 && er.cells[c] ? er.cells[c].querySelector('input') : null; if (!inp || r.v[i] == null) return;
        inp.focus(); inp.value = String(r.v[i]);
        inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true }));
        if (typeof window.jQuery === 'function') window.jQuery(inp).val(String(r.v[i])).trigger('change');
      });
      var ub = er.querySelector('.jsgrid-update-button'); if (!ub) { st[r.d] = 'fail'; fail = r.d + ' ' + MON[D.m] + ': no Update button'; break; }
      ub.click();
      if (!(await waitIdle())) {
        var cb = document.querySelector('.jsgrid-edit-row .jsgrid-cancel-edit-button'); if (cb) cb.click();
        st[r.d] = 'fail'; fail = r.d + ' ' + MON[D.m] + ': the portal did not save it (a message on the page may say why — e.g. a negative number)'; break;
      }
      tr = rowFor(r.d); got = tr ? vals(tr, C) : [];
      var bad = C.map(function (c, i) { return c >= 0 && r.v[i] != null && !same(got[i], r.v[i]) ? FIELDS[i] : ''; }).filter(Boolean);
      if (bad.length) { st[r.d] = 'fail'; fail = r.d + ' ' + MON[D.m] + ': saved, but ' + bad.join(', ') + ' shows another number'; break; }
      done++; st[r.d] = 'ok'; line(r.d, '💾', 'filled and saved', '#15803d');
      await sleep(250);
    }
    busy = false; prog = null; todo.forEach(function (r) { if (st[r.d] === 'run') delete st[r.d]; });
    var msg = fail ? '⛔ Stopped at ' + fail + '. Nothing after it was changed.' : stop ? '■ Stopped. ' + done + ' saved so far.' : write ? '✅ Done: ' + done + ' day' + (done === 1 ? '' : 's') + ' saved, ' + same0 + ' already right.' : (diffs ? '🔍 ' + diffs + ' day' + (diffs === 1 ? '' : 's') + ' differ from the finance sheet, ' + same0 + ' already right. ▶ Fill all fixes them.' : '✅ Every day already matches the finance sheet.');
    if (!fail && write) { var C2 = cols(), tot = C2.map(function (c) { return todo.reduce(function (a, r) { var tr = rowFor(r.d); return a + (tr ? n(tr.cells[c] && tr.cells[c].textContent) : 0); }, 0); }), fin = [0, 1, 6].map(function (i) { return Math.round(todo.reduce(function (a, r) { return a + (+r.v[i] || 0); }, 0) * 100) / 100; });
      msg += '<br><small>' + (todo.length === D.rows.length ? 'The month' : todo.length === 1 ? 'That day' : 'Those ' + todo.length + ' days') + ' on the page now: Rooms ' + tot[0].toLocaleString() + ' · F&B ' + tot[1].toLocaleString() + ' · TD ' + tot[6].toLocaleString() + ' (finance: ' + fin[0].toLocaleString() + ' · ' + fin[1].toLocaleString() + ' · ' + fin[2].toLocaleString() + ')</small>'; }
    paint(msg);
  }
  function safe(w) { run(w).catch(function (e) { busy = false; prog = null; paint('⛔ Stopped: ' + (e && e.message || e) + '. Nothing after it was changed.'); }); }
  box.addEventListener('change', function (e) { if (e.target.id === 'hoDtcmAny') { anyMonth = e.target.checked; lines = []; st = {}; paint(null); } });
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
    else if (b.dataset.a === 'fill' && !busy) { var sel = pickDays(daysTxt); if (!sel.length) { paint('⚠️ No day of ' + MON[D.m] + ' in "' + daysTxt + '". Type e.g. 1 or 1-5, or all.'); return; }
      if (confirm('Fill and save ' + (sel.length === D.rows.length ? 'all ' + sel.length + ' days' : sel.length === 1 ? 'only ' + sel[0].d + ' ' + MON[D.m] : sel.length + ' days (' + daysTxt + ')') + ' of the finance sheet (' + MON[D.m] + ' ' + D.y + ')' + (anyMonth ? ' INTO ' + target() + ' on this page (test mode: by day number)' : '') + '? Days that already match are skipped.')) safe(true); }
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
async function readFile(file) {
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
    return parseLines(lines);
  }
  if (typeof XLSX === 'undefined') throw new Error('The Excel reader did not load. Reload the page.');
  // dates as the sheet's own day numbers (cellDates off): a time zone can never move a day's figures to the day before
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
  for (const n of wb.SheetNames) { const R = parseAoa(XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' })); if (R) return R; }
  return null;
}
async function load(file) {
  if (!file) return;
  try {
    const R = await readFile(file);
    if (!R) { toast('No daily DTCM data found in that file (it needs a "Revenue Date" column)', 'err'); return; }
    S = Object.assign(R, { file: file.name, at: Date.now() });
    try { localStorage.setItem(LS, JSON.stringify(S)); } catch (_) {}
    draw();
  } catch (e) { toast(e.message || 'Could not read that file', 'err'); }
}
// a negative figure (a month-end adjustment, "- 35,810") goes to the portal as 0 — on unless switched off (remembered)
const neg0On = () => { try { return localStorage.getItem('ho_dtcm_neg0') !== '0'; } catch (_) { return true; } };
/** the figures that are filled in: the sheet's, with negatives as 0 when that is on (pure) */
function filled(S0, neg0) { return Object.assign({}, S0, { rows: S0.rows.map(r => ({ d: r.d, v: r.v.map(x => (neg0 && x < 0 ? 0 : x)) })) }); }
function draw() {
  const out = $('out'); if (!out) return;
  const stp = $('steps'); if (stp) stp.querySelectorAll('li').forEach(li => { const k = +li.dataset.s; li.className = !S ? (k === 1 ? 'now' : '') : k === 1 ? 'done' : 'now'; });
  if (!S) { out.innerHTML = ''; return; }
  const n0 = neg0On(), F = filled(S, n0), C = check(S), CF = check(F), mm = MONTHS[S.m] + ' ' + S.y;
  const warn = [];
  if (S.from === 'pdf') warn.push('Read from the PDF: each day there is rounded to whole dirhams. Use the Excel file for the exact numbers.');
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
    ${warn.length ? `<div class="dtf-warn">${warn.map(w => `<div>⚠️ ${esc(w)}</div>`).join('')}</div>` : '<div class="dtf-ok">✅ Every day is there and the days add up to the sheet\'s totals.</div>'}
    <div class="dtf-go">
      <div class="dtf-go-h"><span>3</span><div><h3>Fill the DTCM portal</h3><p>About a minute for a month · it skips days that already match</p></div></div>
      <ol>
        <li>Open the portal: <a href="${PORTAL}" target="_blank" rel="noopener">dhss.det.gov.ae → Revenue ↗</a>, pick <b>${esc(mm)}</b> and press <b>Filter</b>.</li>
        <li>Press <b>📋 Copy the filler</b> below.</li>
        <li>On the portal press <b>F12</b> → <b>Console</b>, paste (Ctrl+V) and press <b>Enter</b>. <small>(The first time Chrome asks you to type <code>allow pasting</code> first.)</small></li>
        <li>A HotelOps box appears: choose the <b>days</b> (tap them, or type e.g. <code>1</code> or <code>1-5</code>; <b>All</b> = the month), <b>🔍 Check</b> compares, <b>▶ Fill</b> fills each chosen day and presses <b>Update</b>, then checks it saved. <small>First time? Try day 1 only.</small></li>
      </ol>
      <div class="dtf-btns"><button type="button" class="btn gold" id="dtf-copy">📋 Copy the filler</button>
        <a class="btn" id="dtf-bm" title="Or drag this to your bookmarks bar, then click it on the portal page" href="#">⭐ Drag to bookmarks</a></div>
      <p class="dtf-note">The filler only types into the portal's own boxes and presses its Update button, one day at a time. It stops at the first day the portal refuses.</p>
    </div>
    <div class="dtf-tw"><table><thead><tr><th>Day</th>${SHORT.map(s => `<th>${esc(s)}</th>`).join('')}</tr></thead><tbody>
      ${S.rows.map(r => `<tr><td>${new Date(S.y, S.m, r.d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</td>${r.v.map(v => v == null ? '<td>–</td>' : v < 0 && n0 ? `<td class="z" title="On the sheet: ${fmt(v)}">0 <s>${fmt(v)}</s></td>` : `<td class="${v < 0 ? 'neg' : ''}">${fmt(v)}</td>`).join('')}</tr>`).join('')}
      <tr class="tot"><td>Total filled</td>${CF.sums.map(v => `<td>${fmt(v)}</td>`).join('')}</tr></tbody></table></div>`;
  const ng = $('neg0'); if (ng) ng.onchange = () => { try { localStorage.setItem('ho_dtcm_neg0', ng.checked ? '1' : '0'); } catch (_) {} draw(); };
  const code = fillerCode(F);
  $('copy').onclick = () => { if (typeof copyToClipboard === 'function') copyToClipboard(code, $('copy'), '📋 Copy the filler'); else navigator.clipboard.writeText(code).then(() => toast('Copied — paste it in the portal\'s console', 'ok')); };
  $('bm').href = 'javascript:' + encodeURIComponent(code);
  $('bm').onclick = e => { e.preventDefault(); toast('Drag this button to your bookmarks bar, then click the bookmark on the portal page', 'info'); };
}
const CSS = `
#panel-${PANEL} .dtf-drop{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:18px;border:2px dashed var(--border2);border-radius:14px;background:var(--bg2)}
#panel-${PANEL} .dtf-drop.over{border-color:var(--accent)}
#panel-${PANEL} .dtf-drop-t{flex:1 1 220px;display:flex;flex-direction:column;gap:2px}#panel-${PANEL} .dtf-drop-t span{color:var(--text3);font-size:.8rem}
#panel-${PANEL} .dtf-sum{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:16px 0}
#panel-${PANEL} .dtf-sum>div{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column}
#panel-${PANEL} .dtf-sum small{font:700 10.5px var(--font);letter-spacing:.06em;text-transform:uppercase;color:var(--text3)}#panel-${PANEL} .dtf-sum b{font-size:1.25rem;margin-top:2px}#panel-${PANEL} .dtf-sum i{font-style:normal;color:var(--text3);font-size:.78rem}
#panel-${PANEL} .dtf-warn{padding:10px 14px;border-radius:12px;background:color-mix(in srgb,var(--amber,#d97706) 9%,transparent);border:1px solid color-mix(in srgb,var(--amber,#d97706) 35%,transparent);font-size:.84rem;line-height:1.6}
#panel-${PANEL} .dtf-map{display:flex;flex-wrap:wrap;gap:6px 14px;margin:0 0 12px;font-size:.78rem;color:var(--text3)}#panel-${PANEL} .dtf-map b{color:var(--text2)}#panel-${PANEL} .dtf-map i{font-style:normal;color:var(--text)}
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
    <div class="dtf-drop" id="dtf-drop"><div style="font-size:26px">📊</div><div class="dtf-drop-t"><b>Drop finance's sheet here</b><span>“Daily data for DTCM” · Excel (exact numbers) or its PDF</span></div>
      <button type="button" class="btn gold" id="dtf-browse">📂 Browse…</button><input type="file" id="dtf-file" accept=".xlsx,.xls,.csv,.pdf" hidden></div>
    <div id="dtf-out"></div></div>`;
  main.appendChild(panel);
  const item = document.createElement('div'); item.className = 'nav-item'; item.id = 'nav-' + PANEL; item.dataset.panel = PANEL;
  item.setAttribute('onclick', "showPanel('" + PANEL + "')");
  item.innerHTML = '<div class="nav-icon">🏛️</div>DTCM Revenue Fill';
  const anchor = document.getElementById('nav-dtcm'); if (anchor && anchor.parentNode === nav) anchor.after(item); else nav.appendChild(item);
  try { ['owner', 'manager', 'supervisor'].forEach(r => { if (typeof ROLES !== 'undefined' && ROLES[r] && !ROLES[r].panels.includes(PANEL)) ROLES[r].panels.push(PANEL); });
    if (typeof currentProfile !== 'undefined' && currentProfile && typeof applyRole === 'function') applyRole(currentProfile.role); } catch (_) {}
  $('browse').onclick = () => { $('file').value = ''; $('file').click(); };
  $('file').onchange = e => load(e.target.files[0]);
  $('clear').onclick = () => { S = null; try { localStorage.removeItem(LS); } catch (_) {} draw(); };
  const z = $('drop');
  ['dragenter', 'dragover'].forEach(ev => z.addEventListener(ev, e => { e.preventDefault(); z.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => z.addEventListener(ev, e => { e.preventDefault(); z.classList.remove('over'); }));
  z.addEventListener('drop', e => { const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) load(f); });
  draw();
}
W.hoDtcmFill = { filled, parseAoa, parseLines, check, fillerCode, dateOf, FILLER, FIELDS };
if (typeof document !== 'undefined' && document.addEventListener) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount(); }
})();
