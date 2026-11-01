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
  const N = '(-?[\\d,]+(?:\\.\\d+)?|-)';
  const re = new RegExp('^([A-Za-z]+,\\s*[A-Za-z]+\\s+\\d{1,2},\\s*\\d{4})' + ('\\s+' + N).repeat(9) + '\\s*$');
  (lines || []).forEach(l => {
    const s = String(l).replace(/\s+/g, ' ').trim(), x = s.match(re);
    if (x) { const dt = dateOf(x[1]); if (!dt) return; if (m < 0) { y = dt.y; m = dt.m; } if (dt.m === m && dt.y === y) rows.push({ d: dt.d, v: x.slice(2, 11).map(num) }); return; }
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
  var stop = false, busy = false;
  var box = document.createElement('div');
  box.id = 'hoDtcmBox';
  box.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483000;width:380px;max-width:calc(100vw - 32px);max-height:80vh;display:flex;flex-direction:column;background:#fff;color:#111;border:1px solid #d1d5db;border-radius:14px;box-shadow:0 20px 50px rgba(0,0,0,.25);font:13px/1.45 system-ui,Segoe UI,sans-serif;overflow:hidden';
  document.body.appendChild(box);
  function head() { return '<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:#0f766e;color:#fff"><b style="flex:1">HotelOps · DTCM fill · ' + MON[D.m] + ' ' + D.y + '</b><button data-a="x" style="border:0;background:transparent;color:#fff;font-size:16px;cursor:pointer">✕</button></div>'; }
  function btn(a, t, main) { return '<button data-a="' + a + '" style="flex:1;padding:8px 10px;border-radius:9px;border:1px solid ' + (main ? '#0f766e' : '#d1d5db') + ';background:' + (main ? '#0f766e' : '#fff') + ';color:' + (main ? '#fff' : '#111') + ';font-weight:600;cursor:pointer">' + t + '</button>'; }
  var lines = [];
  // which days: "all", "1", "1-5", "1, 3, 8-10" (kept while the box is open)
  var daysTxt = 'all';
  function pickDays(t) {
    t = String(t || '').trim().toLowerCase(); if (!t || t === 'all') return D.rows;
    var want = {}; t.split(/[,\s]+/).forEach(function (p) { var m = p.match(/^(\d{1,2})(?:-(\d{1,2}))?$/); if (!m) return; for (var d = +m[1]; d <= +(m[2] || m[1]); d++) want[d] = 1; });
    return D.rows.filter(function (r) { return want[r.d]; });
  }
  function paint(msg) {
    var sel = pickDays(daysTxt), all = sel.length === D.rows.length;
    box.innerHTML = head() + '<div style="padding:10px 14px;border-bottom:1px solid #eee">' + (msg || 'Pick <b>' + MON[D.m] + ' ' + D.y + '</b> on this page and press Filter, then 🔍 Check or ▶ Fill.') + '</div>'
      + '<div style="display:flex;align-items:center;gap:8px;padding:10px 14px 0"><label for="hoDtcmDays" style="font-weight:600">Days</label>'
      + '<input id="hoDtcmDays" value="' + String(daysTxt).replace(/"/g, '') + '" placeholder="all · 1 · 1-5 · 1, 3, 8-10" style="flex:1;min-width:0;padding:7px 9px;border:1px solid #d1d5db;border-radius:8px;font:inherit"' + (busy ? ' disabled' : '') + '>'
      + '<span style="color:#6b7280;font-size:12px;white-space:nowrap">' + (all ? 'all ' + D.rows.length : sel.length + ' of ' + D.rows.length) + '</span></div>'
      // or tap the days: a grid of the month's days (tap one to choose only it, tap more to add; All = the whole month)
      + '<div style="display:grid;grid-template-columns:repeat(8,1fr);gap:4px;padding:8px 14px 0">' + D.rows.map(function (r) { var on = !all && sel.indexOf(r) >= 0;
          return '<button data-day="' + r.d + '"' + (busy ? ' disabled' : '') + ' style="padding:5px 0;border-radius:7px;border:1px solid ' + (on ? '#0f766e' : '#e5e7eb') + ';background:' + (on ? '#0f766e' : all ? '#f0fdfa' : '#fff') + ';color:' + (on ? '#fff' : '#111') + ';font:600 12px system-ui;cursor:pointer">' + r.d + '</button>'; }).join('')
      + '<button data-day="all"' + (busy ? ' disabled' : '') + ' style="grid-column:span 2;padding:5px 0;border-radius:7px;border:1px solid ' + (all ? '#0f766e' : '#e5e7eb') + ';background:' + (all ? '#0f766e' : '#fff') + ';color:' + (all ? '#fff' : '#111') + ';font:600 12px system-ui;cursor:pointer">All</button></div>'
      + '<div style="display:flex;gap:8px;padding:10px 14px">' + (busy ? btn('stop', '■ Stop') : btn('check', '🔍 Check') + btn('fill', all ? '▶ Fill all' : '▶ Fill ' + sel.length + ' day' + (sel.length === 1 ? '' : 's'), true)) + '</div>'
      + '<div style="overflow:auto;padding:0 14px 12px;font-family:Consolas,monospace;font-size:12px">' + lines.join('') + '</div>';
  }
  function line(d, icon, text, color) { lines.unshift('<div style="padding:3px 0;border-bottom:1px solid #f3f4f6;color:' + (color || '#111') + '">' + icon + ' ' + d + ' ' + MON[D.m] + ' · ' + text + '</div>'); if (lines.length > 80) lines.pop(); }
  function headers() { return Array.prototype.map.call(document.querySelectorAll('.jsgrid-header-row th'), function (th) { return th.textContent.replace(/\s+/g, ' ').trim(); }); }
  function cols() { var H = headers(); return KEYS.map(function (k) { return H.findIndex(function (h) { return k.test(h); }); }); }
  function dateText(d) { return d + '-' + MON[D.m] + '-' + D.y; }
  function rows() { return Array.prototype.slice.call(document.querySelectorAll('.jsgrid-grid-body tr')).filter(function (tr) { return /jsgrid-(row|alt-row)/.test(tr.className); }); }
  function rowFor(d) { var t = dateText(d); return rows().find(function (tr) { return Array.prototype.some.call(tr.cells, function (c) { return c.textContent.trim() === t; }); }); }
  function vals(tr, C) { return C.map(function (c) { return c >= 0 && tr.cells[c] ? n(tr.cells[c].textContent) : null; }); }
  function idle() { return !(window.jQuery && window.jQuery.active) && !document.querySelector('.jsgrid-edit-row'); }
  async function waitIdle() { for (var i = 0; i < 80; i++) { await sleep(150); if (idle()) return true; } return false; }
  function ready() {
    var C = cols();
    if (C.slice(0, 7).some(function (c) { return c < 0; })) return { err: 'The revenue table is not on this page. Open Revenue on the DTCM portal.' };
    if (!rows().some(function (tr) { return tr.textContent.indexOf('-' + MON[D.m] + '-' + D.y) >= 0; })) return { err: 'This page shows another month. Pick <b>' + MON[D.m] + ' ' + D.y + '</b> and press Filter.' };
    return { C: C };
  }
  async function run(write) {
    var R = ready(); if (R.err) { paint('⚠️ ' + R.err); return; }
    var C = R.C; busy = true; stop = false; lines = []; paint(write ? 'Filling… keep this tab open.' : 'Checking…');
    var done = 0, same0 = 0, diffs = 0, fail = '';
    var todo = pickDays(daysTxt);
    if (!todo.length) { busy = false; paint('⚠️ No day of ' + MON[D.m] + ' in "' + daysTxt + '". Type e.g. 1 or 1-5, or all.'); return; }
    for (var k = 0; k < todo.length && !stop; k++) {
      var r = todo[k], tr = rowFor(r.d);
      if (!tr) { line(r.d, '⚠️', 'not on the page', '#b45309'); diffs++; continue; }
      var got = vals(tr, C), off = C.map(function (c, i) { return c >= 0 && r.v[i] != null && !same(got[i], r.v[i]) ? i : -1; }).filter(function (i) { return i >= 0; });
      if (!off.length) { same0++; line(r.d, '✓', 'already right', '#15803d'); continue; }
      if (!write) { diffs++; line(r.d, '≠', off.map(function (i) { return FIELDS[i] + ' ' + got[i] + ' → ' + r.v[i]; }).join(' · '), '#b45309'); continue; }
      // open the line for editing: its ✎ Edit button, or a click on the line itself (how the portal opens a row)
      var eb = tr.querySelector('.jsgrid-edit-button');
      if (eb) eb.click(); else (tr.cells[2] || tr.cells[1] || tr).click();
      await sleep(300);
      if (!document.querySelector('.jsgrid-edit-row') && eb) { (tr.cells[2] || tr.cells[1] || tr).click(); await sleep(300); }
      var er = document.querySelector('.jsgrid-edit-row'); if (!er) { fail = r.d + ' ' + MON[D.m] + ': the row did not open for editing'; break; }
      C.forEach(function (c, i) {
        var inp = c >= 0 && er.cells[c] ? er.cells[c].querySelector('input') : null; if (!inp || r.v[i] == null) return;
        inp.focus(); inp.value = String(r.v[i]);
        inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true }));
        if (typeof window.jQuery === 'function') window.jQuery(inp).val(String(r.v[i])).trigger('change');
      });
      var ub = er.querySelector('.jsgrid-update-button'); if (!ub) { fail = r.d + ' ' + MON[D.m] + ': no Update button'; break; }
      ub.click();
      if (!(await waitIdle())) {
        var cb = document.querySelector('.jsgrid-edit-row .jsgrid-cancel-edit-button'); if (cb) cb.click();
        fail = r.d + ' ' + MON[D.m] + ': the portal did not save it (a message on the page may say why — e.g. a negative number)'; break;
      }
      tr = rowFor(r.d); got = tr ? vals(tr, C) : [];
      var bad = C.map(function (c, i) { return c >= 0 && r.v[i] != null && !same(got[i], r.v[i]) ? FIELDS[i] : ''; }).filter(Boolean);
      if (bad.length) { fail = r.d + ' ' + MON[D.m] + ': saved, but ' + bad.join(', ') + ' shows another number'; break; }
      done++; line(r.d, '💾', 'filled and saved', '#0f766e');
      await sleep(250);
    }
    busy = false;
    var msg = fail ? '⛔ Stopped at ' + fail + '. Nothing after it was changed.' : stop ? '■ Stopped. ' + done + ' saved so far.' : write ? '✅ Done: ' + done + ' day' + (done === 1 ? '' : 's') + ' saved, ' + same0 + ' already right.' : (diffs ? '🔍 ' + diffs + ' day' + (diffs === 1 ? '' : 's') + ' differ from the finance sheet, ' + same0 + ' already right. ▶ Fill all fixes them.' : '✅ Every day already matches the finance sheet.');
    if (!fail && write) { var C2 = cols(), tot = C2.map(function (c) { return todo.reduce(function (a, r) { var tr = rowFor(r.d); return a + (tr ? n(tr.cells[c] && tr.cells[c].textContent) : 0); }, 0); }), fin = [0, 1, 6].map(function (i) { return Math.round(todo.reduce(function (a, r) { return a + (+r.v[i] || 0); }, 0) * 100) / 100; });
      msg += '<br><small>' + (todo.length === D.rows.length ? 'The month' : todo.length === 1 ? 'That day' : 'Those ' + todo.length + ' days') + ' on the page now: Rooms ' + tot[0].toLocaleString() + ' · F&B ' + tot[1].toLocaleString() + ' · TD ' + tot[6].toLocaleString() + ' (finance: ' + fin[0].toLocaleString() + ' · ' + fin[1].toLocaleString() + ' · ' + fin[2].toLocaleString() + ')</small>'; }
    paint(msg);
  }
  function safe(w) { run(w).catch(function (e) { busy = false; paint('⛔ Stopped: ' + (e && e.message || e) + '. Nothing after it was changed.'); }); }
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
    if (b.dataset.a === 'x') { if (busy) stop = true; box.remove(); window.__hoDtcm = null; }
    else if (b.dataset.a === 'stop') stop = true;
    else if (b.dataset.a === 'check' && !busy) safe(false);
    else if (b.dataset.a === 'fill' && !busy) { var sel = pickDays(daysTxt); if (!sel.length) { paint('⚠️ No day of ' + MON[D.m] + ' in "' + daysTxt + '". Type e.g. 1 or 1-5, or all.'); return; }
      if (confirm('Fill and save ' + (sel.length === D.rows.length ? 'all ' + sel.length + ' days' : sel.length === 1 ? 'only ' + sel[0].d + ' ' + MON[D.m] : sel.length + ' days (' + daysTxt + ')') + ' of ' + MON[D.m] + ' ' + D.y + ' from the finance sheet? Days that already match are skipped.')) safe(true); }
  });
  window.__hoDtcm = { show: function (D2) { D = D2; lines = []; paint(); } };
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
function draw() {
  const out = $('out'); if (!out) return;
  if (!S) { out.innerHTML = ''; return; }
  const C = check(S), mm = MONTHS[S.m] + ' ' + S.y;
  const warn = [];
  if (S.from === 'pdf') warn.push('Read from the PDF: each day there is rounded to whole dirhams. Use the Excel file for the exact numbers.');
  if (C.missing.length) warn.push(`Days missing from the sheet: ${C.missing.join(', ')}.`);
  if (C.vsTotal.length) warn.push('The days do not add up to the sheet\'s Total row: ' + C.vsTotal.map(x => `${x.f} ${fmt(x.sum)} vs ${fmt(x.total)}`).join(' · ') + '.');
  C.neg.forEach(x => warn.push(`${x.d} ${MON[S.m]}: ${x.f} is negative (${fmt(x.v)}) — a month-end adjustment? The portal may refuse it.`));
  if (C.over.length) warn.push(`More rooms occupied than available on ${C.over.join(', ')} ${MON[S.m]}.`);
  out.innerHTML = `
    <div class="dtf-sum"><div><small>Month</small><b>${esc(mm)}</b><i>${S.rows.length} days · ${esc(S.file || '')}</i></div>
      ${[0, 1, 2, 6].map(i => `<div><small>${esc(FIELDS[i])}</small><b>${fmt(C.sums[i])}</b><i>AED</i></div>`).join('')}
      <div><small>Rooms occupied</small><b>${fmt(C.sums[7])}</b><i>of ${fmt(C.sums[8])}</i></div></div>
    ${S.heads ? `<div class="dtf-map"><b>Columns read</b> ${FIELDS.map((f, i) => `<span>${esc(f)} ← <i>${esc(S.heads[i] || '— not in the sheet')}</i></span>`).join('')}</div>` : ''}
    ${warn.length ? `<div class="dtf-warn">${warn.map(w => `<div>⚠️ ${esc(w)}</div>`).join('')}</div>` : '<div class="dtf-ok">✅ Every day is there and the days add up to the sheet\'s totals.</div>'}
    <div class="dtf-go">
      <h3>Fill the DTCM portal</h3>
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
      ${S.rows.map(r => `<tr><td>${new Date(S.y, S.m, r.d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</td>${r.v.map(v => `<td class="${v < 0 ? 'neg' : ''}">${v == null ? '–' : fmt(v)}</td>`).join('')}</tr>`).join('')}
      <tr class="tot"><td>Total</td>${C.sums.map(v => `<td>${fmt(v)}</td>`).join('')}</tr></tbody></table></div>`;
  const code = fillerCode(S);
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
#panel-${PANEL} .dtf-ok{padding:10px 14px;border-radius:12px;background:color-mix(in srgb,var(--green,#16a34a) 9%,transparent);border:1px solid color-mix(in srgb,var(--green,#16a34a) 30%,transparent);font-size:.85rem}
#panel-${PANEL} .dtf-go{margin:16px 0;padding:16px 18px;border-radius:14px;background:var(--card);border:1px solid var(--border)}
#panel-${PANEL} .dtf-go h3{margin:0 0 8px;font-size:1rem}#panel-${PANEL} .dtf-go ol{margin:0 0 12px;padding-left:20px;line-height:1.8;font-size:.88rem;color:var(--text2)}#panel-${PANEL} .dtf-go b{color:var(--text)}
#panel-${PANEL} .dtf-btns{display:flex;gap:8px;flex-wrap:wrap}#panel-${PANEL} .dtf-note{margin:10px 0 0;font-size:.78rem;color:var(--text3)}
#panel-${PANEL} .dtf-tw{overflow:auto;border:1px solid var(--border);border-radius:12px;background:var(--card)}
#panel-${PANEL} .dtf-tw table{width:100%;border-collapse:collapse;font-size:.8rem}#panel-${PANEL} .dtf-tw th,#panel-${PANEL} .dtf-tw td{padding:6px 10px;text-align:right;white-space:nowrap;border-bottom:1px solid var(--border)}
#panel-${PANEL} .dtf-tw th:first-child,#panel-${PANEL} .dtf-tw td:first-child{text-align:left}#panel-${PANEL} .dtf-tw th{font:700 10.5px var(--font);letter-spacing:.05em;text-transform:uppercase;color:var(--text3);background:var(--bg2);position:sticky;top:0}
#panel-${PANEL} .dtf-tw td{font-family:var(--mono)}#panel-${PANEL} .dtf-tw td.neg{color:var(--rose,#e11d48);font-weight:700}#panel-${PANEL} .dtf-tw tr.tot td{font-weight:700;background:var(--bg2)}`;
function mount() {
  if (document.getElementById('panel-' + PANEL)) return;
  const main = document.querySelector('main.main') || document.querySelector('main'), nav = document.querySelector('nav.sidenav') || document.querySelector('nav');
  if (!main || !nav) return;
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const panel = document.createElement('div'); panel.className = 'panel'; panel.id = 'panel-' + PANEL;
  panel.innerHTML = `<div style="max-width:1200px">
    <div class="page-hd"><div class="page-hd-left"><h1>DTCM Revenue Fill</h1><p>Finance's daily data for DTCM → the DTCM portal (Revenue), filled day by day for you</p></div>
      <div class="page-hd-actions"><button type="button" class="btn rose" id="dtf-clear">✕ Clear</button></div></div>
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
W.hoDtcmFill = { parseAoa, parseLines, check, fillerCode, dateOf, FILLER, FIELDS };
if (typeof document !== 'undefined' && document.addEventListener) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount(); }
})();
