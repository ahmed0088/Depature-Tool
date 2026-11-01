// ═══════════════════════════════════════════════════════════
//  neorcha.js — Neorcha Guest Documents → HotelOps
//
//  Neorcha (ibis.myneorcha.com → Guest Documents) holds the registration cards guests fill at check-in: their
//  purpose of visit, nationality and loyalty membership. Export → CSV (All) from Neorcha, drop the file here:
//  the month at a glance (registrations, purposes, nationalities, ALL members, who checked guests in) and one tap
//  links it to Purpose of Stay — the purpose the guest gave, and the nationality where it is still empty.
//  Columns are found by their names. Passport / ID numbers, birth dates, emails, phones and addresses are never
//  read: they are dropped while the file is read and never stored.
// ═══════════════════════════════════════════════════════════
(function () {
'use strict';
const W = window, PANEL = 'neorcha', LS = 'ho_neorcha_v1';

// the columns kept, found by their names (Neorcha's own labels)
const COLS = [
  ['conf', /confirmation/i], ['first', /first\s*name/i], ['last', /last\s*name/i], ['name', /^(guest\s*)?name$|full\s*name/i],
  ['nat', /nationality/i], ['purpose', /purpose/i], ['arr', /^arrival(\s*date)?$|arrival\s*date(?!.*hijri)/i], ['dep', /^departure(\s*date)?$|departure\s*date(?!.*hijri)/i],
  ['room', /room\s*(number|no\.?|#)?$/i], ['adults', /adult/i], ['children', /child/i], ['member', /membership\s*(number|no|#)|loyalty\s*(number|no)|card\s*number/i],
  ['mtype', /membership\s*type|loyalty\s*(type|program)/i], ['by', /checked\s*in\s*by|operator|^agent$|^user$/i], ['doc', /^document\s*type|^type$/i],
  ['company', /company/i], ['at', /insertion|insert\s*date|created|creation/i], ['source', /^source$|platform/i],
];
// never read (sensitive): checked first, a column like this is skipped even if a kept name also matches
const NEVER = /passport|birth|e-?mail|phone|mobile|document\s*number|id\s*number|\bno\s*uae\b|address|city|zip|postal|car\s*reg|signature|card\s*(holder|expir)|iban/i;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toast = (m, t) => { if (typeof showToast === 'function') showToast(m, t); };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ── reading ─────────────────────────────────────────────────
/** a date cell → "YYYY-MM-DD" ("01-10-2026", "1-Oct-2026", "2026-10-01", Excel day number) */
function isoOf(v) {
  if (v instanceof Date && !isNaN(v)) return v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0');
  if (typeof v === 'number' && v > 20000 && v < 80000) { const t = new Date(Math.round((v - 25569) * 864e5)); return t.toISOString().slice(0, 10); }
  const s = String(v || '').trim(); let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/))) return (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  if ((m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*[-\s,]+(\d{2,4})/))) { const mi = MON.findIndex(x => x.toLowerCase() === m[2].toLowerCase()); if (mi >= 0) return (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + String(mi + 1).padStart(2, '0') + '-' + m[1].padStart(2, '0'); }
  return '';
}
/** "AE" → "United Arab Emirates" (a nationality given as a 2-letter code) */
function natName(v) {
  const s = String(v || '').trim();
  if (/^[A-Za-z]{2}$/.test(s)) { try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(s.toUpperCase()) || s; } catch (_) { return s; } }
  return s;
}
/** the guest's purpose of visit → Purpose of Stay's words (Business / Leisure / Flight), '' when it says nothing clear */
function purposeOf(v) {
  const s = String(v || '').toLowerCase();
  if (!s.trim()) return '';
  if (/transit|flight|crew|airline|layover|stop\s*over/.test(s)) return 'Flight';
  if (/business|work|conference|meeting|corporate|training|exhibition|mice|official/.test(s)) return 'Business';
  if (/leisure|holiday|vacation|tourism|tourist|family|personal|visit|shopping|honeymoon|pleasure|medical|religio|event|sport|study/.test(s)) return 'Leisure';
  return '';
}
/** rows of cells → { rows: [...kept fields only], cols: [{f, h}], skipped: n } */
function parseAoa(aoa) {
  aoa = (aoa || []).map(r => (r || []).map(c => (c == null ? '' : c)));
  const hi = aoa.findIndex(r => r.some(c => /confirmation/i.test(String(c))) && r.some(c => /first\s*name|last\s*name|nationality|room/i.test(String(c))));
  if (hi < 0) return null;
  const head = aoa[hi].map(h => String(h).replace(/\s+/g, ' ').trim()), map = {};
  head.forEach((h, i) => { if (!h || NEVER.test(h)) return; const k = COLS.find(([f, re]) => map[f] === undefined && re.test(h)); if (k) map[k[0]] = i; });
  if (map.conf === undefined && map.room === undefined) return null;
  const cell = (r, f) => (map[f] === undefined ? '' : String(r[map[f]] == null ? '' : r[map[f]]).trim());
  const rows = []; let skipped = 0;
  aoa.slice(hi + 1).forEach(r => {
    if (!r.some(c => String(c).trim())) return;
    const conf = cell(r, 'conf').replace(/\.0+$/, ''), room = cell(r, 'room').replace(/\.0+$/, '');
    const name = [cell(r, 'first'), cell(r, 'last')].filter(Boolean).join(' ') || cell(r, 'name');
    if (!conf && !room && !name) { skipped++; return; }
    const pv = cell(r, 'purpose');
    rows.push({ conf, room, name, nat: natName(cell(r, 'nat')), purposeRaw: pv, purpose: purposeOf(pv), arr: isoOf(map.arr === undefined ? '' : r[map.arr]), dep: isoOf(map.dep === undefined ? '' : r[map.dep]),
      adults: parseInt(cell(r, 'adults'), 10) || 0, children: parseInt(cell(r, 'children'), 10) || 0,
      member: !!cell(r, 'member').replace(/^[-0\s]+$/, ''), mtype: cell(r, 'mtype'), by: cell(r, 'by'), doc: cell(r, 'doc'), company: cell(r, 'company'), at: isoOf(map.at === undefined ? '' : r[map.at]) });
  });
  return { rows, cols: Object.keys(map).map(f => ({ f, h: head[map[f]] })), skipped };
}
/** the month at a glance (pure) */
function summary(rows) {
  const cnt = (f, val) => { const o = {}; rows.forEach(r => { const k = val(r); if (k) o[k] = (o[k] || 0) + 1; }); return Object.entries(o).sort((a, b) => b[1] - a[1]); };
  const staff = {}; rows.forEach(r => { const k = r.by || '—'; const s = staff[k] = staff[k] || { n: 0, members: 0 }; s.n++; if (r.member) s.members++; });
  const days = cnt('day', r => r.arr);
  return { n: rows.length, guests: rows.reduce((a, r) => a + (r.adults + r.children || 1), 0), members: rows.filter(r => r.member).length,
    purposes: cnt('p', r => r.purpose || (r.purposeRaw ? 'Other' : 'Not given')), nats: cnt('n', r => r.nat), mtypes: cnt('t', r => r.member ? (r.mtype || 'Member') : ''),
    staff: Object.entries(staff).map(([by, s]) => ({ by, n: s.n, members: s.members })).sort((a, b) => b.n - a.n), days: days.sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    from: days.length ? days.map(d => d[0]).sort()[0] : '', to: days.length ? days.map(d => d[0]).sort().pop() : '' };
}
// ── linking to Purpose of Stay ──────────────────────────────
const digits = s => String(s || '').replace(/\D/g, '');
const roomKey = s => String(s || '').replace(/^0+/, '').trim().toUpperCase();
const words = s => String(s || '').toLowerCase().replace(/\b(mr|mrs|ms|miss|dr)\b\.?/g, ' ').split(/[^a-zÀ-ɏ]+/).filter(w => w.length > 1);
function sameGuest(a, b) { const A = new Set(words(a)), B = words(b); return B.filter(w => A.has(w)).length >= Math.min(2, Math.max(1, Math.min(A.size, B.length))); }
/** what linking would change on Purpose of Stay (pure): the purpose the guest gave, the nationality where still empty */
function linkPlan(rows, guests) {
  const byConf = new Map(); rows.forEach(r => { const c = digits(r.conf); if (c) byConf.set(c, r); });
  const out = { matched: 0, purpose: [], nat: [], unmatched: 0 };
  (guests || []).forEach((g, i) => {
    let r = byConf.get(digits(g.conf));
    if (!r) r = rows.find(x => x.room && roomKey(x.room) === roomKey(g.room) && x.name && sameGuest(g.name, x.name));
    if (!r) { out.unmatched++; return; }
    out.matched++;
    if (r.purpose && r.purpose !== g.purpose) out.purpose.push({ i, room: g.room, name: g.name, from: g.purpose || '', to: r.purpose, said: r.purposeRaw });
    if (r.nat && !String(g.nat || '').trim()) out.nat.push({ i, room: g.room, name: g.name, to: r.nat });
  });
  return out;
}

// ── The collector: runs on Neorcha (Guest Documents), pasted in its console or a bookmark ──
// It sets the arrival dates, presses Search, opens every confirmation, reads its card, goes back, then the next one and the
// next page — and saves one CSV for the Neorcha Registrations page. It never reads passport / ID / birth / email / phone.
// Neorcha's page is learned while it runs (the fields by their ng-model "selectedGuestDoc.*"); what it can't find, it reports.
/* eslint-disable */
function COLLECTOR(O) {
  O = O || {};
  if (window.__hoNx) { window.__hoNx.show(O); return; }
  var NEVER = /passport|birth|e-?mail|phone|mobile|documentnumber|docnumber|noUae|address|city|zip|postal|carreg|signature|iban|card/i;
  var KEEP = [['Confirmation Number', /confirmation/i], ['First Name', /firstname/i], ['Last Name', /lastname/i], ['Nationality', /nationality|^country$/i], ['Purpose Of Visit', /purpose/i],
    ['Arrival Date', /^arrivaldate$/i], ['Departure Date', /^departuredate$/i], ['Room Number', /roomnumber/i], ['Number of Adults', /adults/i], ['Number of Children', /children/i],
    ['Membership Number', /membershipnumber/i], ['Membership Type', /membershiptype/i], ['Checked In By', /checkedinby|operator/i], ['Company Name', /companyname/i], ['Room Type', /roomtype/i], ['Insertion Date', /insertdate|insertiondate/i]];
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var stop = false, busy = false, got = [], seen = {}, log = [];
  var pad = function (n) { return String(n).padStart(2, '0'); }, t = new Date();
  var from = O.from || t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-01', to = O.to || t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());
  var tell = function (m) { try { if (O.progress) O.progress(m); } catch (_) {} };
  var css = document.createElement('style');
  css.textContent = '#hoNxBox{position:fixed;right:18px;bottom:18px;z-index:2147483000;width:380px;max-width:calc(100vw - 36px);background:#fff;color:#0f172a;border:1px solid #e2e8f0;border-radius:18px;box-shadow:0 24px 60px -12px rgba(15,23,42,.35);font:13px/1.45 Inter,system-ui,Segoe UI,sans-serif;overflow:hidden}'
    + '#hoNxBox *{box-sizing:border-box}#hoNxBox .h{display:flex;align-items:center;gap:10px;padding:12px 14px;background:linear-gradient(135deg,#6366f1,#4338ca);color:#fff}#hoNxBox .h b{flex:1}#hoNxBox .h button{border:0;background:rgba(255,255,255,.15);color:#fff;border-radius:8px;width:28px;height:28px;cursor:pointer}'
    + '#hoNxBox .n{margin:12px 14px 0;padding:10px 12px;border-radius:12px;background:#f8fafc;border:1px solid #e2e8f0;font-size:12.5px}#hoNxBox .n.ok{background:#f0fdf4;border-color:#bbf7d0}#hoNxBox .n.err{background:#fef2f2;border-color:#fecaca}'
    + '#hoNxBox .d{display:flex;gap:8px;margin:12px 14px 0}#hoNxBox .d label{flex:1;font-size:11px;color:#64748b;font-weight:600}#hoNxBox .d input{width:100%;margin-top:3px;padding:7px 9px;border:1px solid #cbd5e1;border-radius:9px;font:inherit}'
    + '#hoNxBox .p{margin:12px 14px 0;height:8px;border-radius:99px;background:#e2e8f0;overflow:hidden}#hoNxBox .p i{display:block;height:100%;background:linear-gradient(90deg,#818cf8,#4f46e5);transition:width .3s}'
    + '#hoNxBox .a{display:flex;gap:8px;padding:12px 14px}#hoNxBox .a button{flex:1;padding:9px;border-radius:11px;border:1px solid #cbd5e1;background:#fff;font-weight:650;cursor:pointer}#hoNxBox .a button.p1{background:linear-gradient(135deg,#818cf8,#4338ca);border-color:#4338ca;color:#fff}#hoNxBox .a button.st{background:#dc2626;border-color:#dc2626;color:#fff}'
    + '#hoNxBox .l{max-height:120px;overflow:auto;padding:0 14px 10px;font:11.5px/1.5 ui-monospace,Consolas,monospace;color:#475569}';
  document.head.appendChild(css);
  var box = document.createElement('div'); box.id = 'hoNxBox'; document.body.appendChild(box);
  var note = 'Log in, open <b>Guest Documents</b>, pick your <b>hotel</b>. Then choose the arrival dates and press ▶ Collect.', tone = '', prog = 0;
  function paint() {
    box.innerHTML = '<div class="h"><span>🪪</span><b>Neorcha collector · HotelOps</b><button data-a="x" title="Close">✕</button></div>'
      + '<div class="n ' + tone + '">' + note + (got.length ? '<br><small>' + got.length + ' guest' + (got.length === 1 ? '' : 's') + ' collected</small>' : '') + '</div>'
      + '<div class="d"><label>Arrival from<input type="date" id="hoNxFrom" value="' + from + '"' + (busy ? ' disabled' : '') + '></label><label>to<input type="date" id="hoNxTo" value="' + to + '"' + (busy ? ' disabled' : '') + '></label></div>'
      + (busy ? '<div class="p"><i style="width:' + prog + '%"></i></div>' : '')
      + '<div class="a">' + (busy ? '<button data-a="stop" class="st">■ Stop</button>' : '<button data-a="go" class="p1">▶ Collect</button>' + (got.length ? '<button data-a="save">💾 Save file</button>' : '') + '<button data-a="rep">📋 Report</button>') + '</div>'
      + (log.length ? '<div class="l">' + log.slice(-40).reverse().join('<br>') + '</div>' : '');
  }
  function say(h, t2) { note = h; tone = t2 || ''; paint(); tell({ note: String(h).replace(/<[^>]+>/g, ''), n: got.length, prog: prog }); }
  function L(s) { log.push(s); if (log.length > 200) log.shift(); }
  function vis(e) { return !!(e && (e.offsetParent || e.getClientRects().length)); }
  function all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function byClick(re) { return all('[ng-click]').filter(function (e) { return re.test(e.getAttribute('ng-click')) && vis(e); }); }
  function fire(el, v) { el.focus && el.focus(); el.value = v; ['input', 'change', 'blur', 'keyup'].forEach(function (t2) { el.dispatchEvent(new Event(t2, { bubbles: true })); }); }
  function fmt(iso, like) { var p = iso.split('-'); if (/^\d{4}-/.test(like || '')) return iso; if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(like || '')) return p[2] + '/' + p[1] + '/' + p[0]; if (/^\d{1,2}-[A-Za-z]{3}/.test(like || '')) return +p[2] + '-' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+p[1] - 1] + '-' + p[0]; return p[2] + '-' + p[1] + '-' + p[0]; }
  function viewCells() { return all('td[ng-click*="viewGuestDocument"]').filter(vis); }
  function listRows() {
    var vc = viewCells().map(function (td) { return td.parentElement; }).filter(function (tr, i, a) { return tr && a.indexOf(tr) === i; });
    if (vc.length) return vc;
    return all('tr[ng-repeat],[ng-repeat] > td').map(function (e) { return e.tagName === 'TD' ? e.parentElement : e; }).filter(function (tr, i, a) { return a.indexOf(tr) === i && vis(tr) && !/menu|submenu|item in/.test(tr.getAttribute('ng-repeat') || '') && /\d{5,}/.test(tr.textContent); });
  }
  function detailInputs() { return all('[ng-model^="selectedGuestDoc."]'); }
  function detailOpen() { return detailInputs().some(vis); }
  function readDetail() {
    var o = {};
    detailInputs().forEach(function (el) { var k = el.getAttribute('ng-model').replace('selectedGuestDoc.', ''); if (NEVER.test(k)) return;
      var v = el.tagName === 'SELECT' ? (el.selectedOptions[0] ? el.selectedOptions[0].textContent : '') : el.type === 'checkbox' ? (el.checked ? 'yes' : '') : (el.value != null && el.value !== '' ? el.value : el.textContent);
      KEEP.forEach(function (c) { if (c[1].test(k) && !o[c[0]] && String(v || '').trim()) o[c[0]] = String(v).trim(); }); });
    if (o['Membership Number']) o['Membership Number'] = 'yes';   // only that there is one, never the number
    return o;
  }
  // the row's own data straight from the page's memory (AngularJS), when it shows it: no opening needed
  function rowData(tr) {
    try { if (!window.angular) return null; var sc = angular.element(tr).scope(); if (!sc) return null; var rep = (tr.getAttribute('ng-repeat') || '').match(/^\s*(\w+)\s+in/); var it = rep && sc[rep[1]];
      if (!it || typeof it !== 'object') return null; var o = {};
      Object.keys(it).forEach(function (k) { if (NEVER.test(k)) return; var v = it[k]; if (v == null || typeof v === 'object') return; KEEP.forEach(function (c) { if (c[1].test(k) && !o[c[0]] && String(v).trim()) o[c[0]] = String(v).trim(); }); });
      if (o['Membership Number']) o['Membership Number'] = 'yes';
      return o['Purpose Of Visit'] || o['Nationality'] ? o : null; } catch (_) { return null; }
  }
  async function waitFor(fn, ms) { for (var i = 0; i < (ms || 15000) / 150; i++) { if (fn()) return true; await sleep(150); } return false; }
  async function search() {
    var f = document.querySelector('[ng-model="searchFromArrivalDate"]'), t2 = document.querySelector('[ng-model="searchToArrivalDate"]');
    if (!f || !t2) { L('date boxes not found — using the dates on the page'); } else { fire(f, fmt(from, f.value || f.placeholder)); fire(t2, fmt(to, t2.value || t2.placeholder)); L('dates set: ' + f.value + ' → ' + t2.value); }
    var pp = document.querySelector('[ng-model="paginationDoc"]');   // 100 per page: fewer pages to turn
    if (pp && +pp.value < 100) { fire(pp, '100'); L('100 per page'); await sleep(900); }
    all('select').forEach(function (sel) { if (sel.closest('#hoNxBox')) return; var op = Array.prototype.slice.call(sel.options).map(function (o) { return parseInt(o.value || o.textContent, 10); }).filter(function (n) { return !isNaN(n); });
      var cur = parseInt(sel.value, 10), mx = Math.max.apply(null, op.concat([0])); if (op.length >= 2 && !isNaN(cur) && cur < mx && mx <= 500) { sel.value = String(mx); sel.dispatchEvent(new Event('change', { bubbles: true })); L('page size ' + mx); } });
    var hs = document.querySelector('[ng-model="selectedHotel"]');   // no hotel picked yet: pick the first (your own) one
    if (hs && /ng-empty/.test(hs.className)) { var tg = hs.querySelector('.ui-select-toggle,.ui-select-match'); if (tg) { tg.click(); await sleep(600); var ch = hs.querySelector('.ui-select-choices-row'); if (ch) { (ch.querySelector('a,span,div') || ch).click(); L('hotel picked'); await sleep(600); } } }
    var b = byClick(/searchGuestDocuments/)[0]; if (!b) { b = all('button,input[type=submit]').filter(function (x) { return /^\s*search\s*$/i.test(x.textContent || x.value) && vis(x); })[0]; }
    if (!b) return 'no Search button';
    b.click(); L('Search pressed');
    await sleep(800); await waitFor(function () { return listRows().length || /no record|no result/i.test(document.body.textContent); }, 20000);
    return '';
  }
  // a row opens its card in different ways (a click, a double-click, a link, the number's cell): try them one by one
  var fails = 0, how = -1;
  function detailSig() { return ['confirmationNumber', 'firstName', 'lastName', 'country', 'roomNumber', 'arrivalDate'].map(function (f) { var e = document.querySelector('[ng-model="selectedGuestDoc.' + f + '"]'); return e ? e.value || '' : ''; }).join('|'); }
  function detailConf() { var e = document.querySelector('[ng-model="selectedGuestDoc.confirmationNumber"]'); return e ? String(e.value || '').trim() : ''; }
  async function openCard(tr) {
    var k0 = key(tr), sig0 = detailSig(), open0 = detailOpen();
    var landed = function () { var c = detailConf(); if (c && /^\d{5,}$/.test(k0)) return c.replace(/\D/g, '') === k0; return detailSig() !== sig0 || (!open0 && detailOpen()); };
    var own = tr.querySelector('td[ng-click*="viewGuestDocument"]');   // how Neorcha opens a card (the old extractor's way, proven on the real site)
    if (own) { own.click(); if (await waitFor(landed, 15000)) return true; L('viewGuestDocument cell clicked, the card did not change'); }
    var cells = Array.prototype.slice.call(tr.querySelectorAll('td,.ui-grid-cell,[role=gridcell]'));
    var els = Array.prototype.slice.call(tr.querySelectorAll('[ng-click],[ng-dblclick],a,button')).concat(cells.filter(function (c) { return /\d{6,}/.test(c.textContent); }), [tr], cells);
    els = els.filter(function (e, i) { return els.indexOf(e) === i; }).slice(0, 10);
    var ways = [];
    els.forEach(function (e) { ways.push([e, 'click'], [e, 'dblclick']); });
    if (how >= 0 && how < ways.length) ways.unshift(ways[how]);   // the way that worked on the last row first
    for (var i = 0; i < ways.length && !stop; i++) {
      var e = ways[i][0], t = ways[i][1];
      try { if (t === 'click') e.click(); else e.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window })); } catch (_) {}
      if (await waitFor(landed, i === 0 ? 5000 : 2200)) { if (how < 0 || i > 0) { how = i; L('card opens by ' + t + ' on ' + e.tagName.toLowerCase() + (e.getAttribute('ng-click') ? ' [' + e.getAttribute('ng-click') + ']' : '')); } return true; }
    }
    return false;
  }
  function masked(el) {   // the row's layout only: every letter becomes x, every digit 9
    if (!el) return '(none)';
    var c = el.cloneNode(true), w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT), n;
    while ((n = w.nextNode())) n.nodeValue = n.nodeValue.replace(/[^\s\d]/g, 'x').replace(/\d/g, '9');
    Array.prototype.forEach.call(c.querySelectorAll('*'), function (e) { ['value', 'title', 'href', 'src', 'alt', 'aria-label'].forEach(function (a) { if (e.hasAttribute(a)) e.setAttribute(a, '…'); }); });
    return c.outerHTML.replace(/\s+/g, ' ').slice(0, 3500);
  }
  function nextPage() {
    var ok = function (a) { var li = a.closest('li'); return vis(a) && !(li && /disabled/.test(li.className)) && !a.hasAttribute('disabled'); };
    var c = all('[ng-click*="setCurrent(pagination.current + 1"],[ng-click*="setCurrent(pagination.current+1"],[ng-click*="selectPage(page + 1"],[ng-click*="selectPage(page+1"],[ng-click*="nextPage"],.pagination-next a').filter(ok);
    if (!c.length) c = all('.pagination li a, a[ng-click*="selectPage"]').filter(function (a) { return /next|›|»|^\s*>\s*$/i.test(a.textContent) && ok(a); });
    return c[0] || null;
  }
  function key(tr) { var m = tr.textContent.match(/\d{6,}/); return m ? m[0] : tr.textContent.replace(/\s+/g, ' ').trim().slice(0, 80); }
  async function collect() {
    busy = true; stop = false; got = []; seen = {}; log = []; fails = 0; how = -1; prog = 3; say('Searching…');
    var err = await search();
    if (err) { busy = false; return say('⛔ ' + err + ' on this page. Open Guest Documents, then press ▶ Collect again — or 📋 Report.', 'err'); }
    if (!listRows().length) { busy = false; return say('⚠️ No guests for those dates (or the hotel is not chosen). Pick the hotel at the top, then ▶ Collect.', 'err'); }
    for (var page = 1; page < 200 && !stop; page++) {
      var rows = listRows(); L('page ' + page + ': ' + rows.length + ' rows');
      for (var i = 0; i < rows.length && !stop; i++) {
        var tr = listRows()[i]; if (!tr) break; var k = key(tr); if (seen[k]) continue; seen[k] = 1;
        prog = Math.min(97, 5 + Math.round(((page - 1) * rows.length + i) / Math.max(1, page * rows.length) * 90)); say('Reading guest ' + (got.length + 1) + ' (page ' + page + ')…');
        var o = rowData(tr);   // the list's own data (only when Neorcha's page lets us see it): without the purpose, the card is still opened
        if (!o || !o['Purpose Of Visit']) {
          var o0 = o || {};
          if (!(await openCard(tr))) {
            L('row ' + k + ': its card did not open'); fails++;
            if (!got.length && fails >= 2) { busy = false; prog = 0; return say('⚠️ I can\'t open the guest cards on this page. Press 📋 Report below and send it to me — it shows how the rows are built (names and numbers are masked).', 'err'); }
            continue;
          }
          fails = 0;
          await sleep(300); o = Object.assign({}, o0, readDetail());
          if (!o['Confirmation Number'] && /^\d{5,}$/.test(k)) o['Confirmation Number'] = k;
          if (!listRows().length) {   // the card took the whole page: back to the list
            var back = byClick(/backToPreviousPage|changeListGuestDocumentsModeTo\(true\)/)[0]; if (back) back.click(); else history.back();
            await waitFor(function () { return listRows().length; }, 8000); await sleep(250);
          }
        }
        if (o && Object.keys(o).length) { got.push(o); L('✓ ' + (o['Room Number'] || '') + ' ' + (o['Purpose Of Visit'] || '') + ' ' + (o['Nationality'] || '')); }
      }
      var nx = nextPage(); if (!nx) break;
      var before = key(listRows()[0] || document.body); nx.click(); L('next page');
      if (!(await waitFor(function () { var r = listRows()[0]; return r && key(r) !== before; }, 15000))) { L('the list did not change: last page'); break; }
    }
    busy = false; prog = 100;
    if (got.length && O.send) { try { O.send(got, from, to); } catch (_) {} say('✅ ' + got.length + ' guests collected and sent to HotelOps — you can close this tab.', 'ok'); return; }
    say(got.length ? '✅ ' + got.length + ' guests collected. Press 💾 Save file and drop it on HotelOps → Neorcha Registrations.' : '⚠️ Nothing could be read from the cards. Press 📋 Report and send it to HotelOps support.', got.length ? 'ok' : 'err');
    if (got.length) save();
  }
  function save() {
    var H = KEEP.map(function (c) { return c[0]; }), q = function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var csv = [H.join(',')].concat(got.map(function (o) { return H.map(function (h) { return q(o[h]); }).join(','); })).join('\r\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'neorcha-' + from + '-to-' + to + '.csv'; document.body.appendChild(a); a.click(); a.remove();
  }
  function report() {   // the page's shape only — no guest data
    var r = ['Neorcha collector report', location.hash, 'rows found: ' + listRows().length, 'detail fields: ' + detailInputs().map(function (e) { return e.getAttribute('ng-model').replace('selectedGuestDoc.', ''); }).join(','),
      'ng-repeat: ' + all('[ng-repeat]').map(function (e) { return e.getAttribute('ng-repeat'); }).filter(function (v, i, a) { return a.indexOf(v) === i; }).slice(0, 12).join(' | '),
      'first row (masked): ' + masked(listRows()[0]),
      'row holder: ' + (function (r) { var a = []; for (var e = r && r.parentElement, i = 0; e && i < 6; e = e.parentElement, i++) a.push(e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 3).join('.') : '') + (e.getAttribute('ng-repeat') ? '[' + e.getAttribute('ng-repeat') + ']' : '')); return a.join(' < '); })(listRows()[0]),
      'dblclicks: ' + all('[ng-dblclick]').map(function (e) { return e.getAttribute('ng-dblclick'); }).filter(function (v, i, a) { return a.indexOf(v) === i; }).slice(0, 10).join(' | '),
      'log: ' + log.filter(function (x) { return !/^✓/.test(x); }).slice(-15).join(' / ').replace(/\d{6,}/g, '#'),
      'clicks: ' + all('[ng-click]').map(function (e) { return e.getAttribute('ng-click'); }).filter(function (v, i, a) { return a.indexOf(v) === i; }).slice(0, 40).join(' | '),
      'date boxes: ' + all('[ng-model*="ArrivalDate"]').map(function (e) { return e.getAttribute('ng-model') + '=' + (e.value || e.placeholder || '').replace(/\d/g, '9'); }).join(', '), 'angular: ' + !!window.angular, 'log: ' + log.slice(-15).join(' / ')].join('\n');
    try { navigator.clipboard.writeText(r).then(function () { say('📋 Report copied — paste it to HotelOps support (no guest data in it).'); }); } catch (_) { prompt('Copy this report:', r); }
  }
  box.addEventListener('change', function (e) { if (e.target.id === 'hoNxFrom') from = e.target.value; if (e.target.id === 'hoNxTo') to = e.target.value; });
  box.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; var a = b.dataset.a;
    if (a === 'x') { stop = true; box.remove(); css.remove(); window.__hoNx = null; } else if (a === 'stop') stop = true;
    else if (a === 'go' && !busy) collect().catch(function (er) { busy = false; say('⛔ Stopped: ' + (er && er.message || er), 'err'); });
    else if (a === 'save') save(); else if (a === 'rep') report(); });
  // sent by HotelOps through the helper: wait for the login, open Guest Documents, then collect by itself
  async function auto() {
    for (var i = 0; i < 1200 && !stop; i++) {   // up to 20 minutes for the login
      if (/login/i.test(location.hash) || document.querySelector('#userPassword')) { if (i % 10 === 0) say('🔑 Log in to Neorcha — I start by myself right after.'); await sleep(1000); continue; }
      if (!/guestdocuments/i.test(location.hash)) { location.hash = '#/guestdocuments'; await sleep(1500); continue; }
      if (document.querySelector('[ng-model="searchFromArrivalDate"]') || byClick(/searchGuestDocuments/).length) { await sleep(1200); return collect(); }
      await sleep(1000);
    }
  }
  window.__hoNx = { show: function (O2) { if (O2 && O2.from) { O = O2; from = O2.from; to = O2.to || to; if (O2.auto && !busy) auto().catch(function () {}); } paint(); } };
  paint();
  if (O.auto) auto().catch(function (er) { busy = false; say('⛔ Stopped: ' + (er && er.message || er), 'err'); });
}
/* eslint-enable */
const collectorCode = () => '(' + COLLECTOR.toString() + ')();';
const collectorSrc = () => COLLECTOR.toString();

// ── the page ────────────────────────────────────────────────
let S = null;
try { S = JSON.parse(localStorage.getItem(LS) || 'null'); } catch (_) { S = null; }
const $ = id => document.getElementById('nx-' + id);
const pg = () => (typeof purposeGuests !== 'undefined' && Array.isArray(purposeGuests) ? purposeGuests : []);
async function load(file) {
  if (!file) return;
  try {
    if (typeof XLSX === 'undefined') throw new Error('The Excel reader did not load. Reload the page.');
    const wb = /\.(csv|txt)$/i.test(file.name) ? XLSX.read(await file.text(), { type: 'string', raw: true }) : XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
    let R = null;
    for (const n of wb.SheetNames) { R = parseAoa(XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' })); if (R) break; }
    if (!R || !R.rows.length) { toast('No guests found in that file — use the file the collector saved', 'err'); return; }
    S = Object.assign(R, { file: file.name, at: Date.now() });
    try { localStorage.setItem(LS, JSON.stringify(S)); } catch (_) {}
    if (typeof logActivity === 'function') try { logActivity('neorcha_loaded', R.rows.length + ' registrations'); } catch (_) {}
    draw();
  } catch (e) { toast(e.message || 'Could not read that file', 'err'); }
}
// 🤖 the cards sent by the helper's collector (objects with Neorcha's labels) → the same reading as a file
function rowsToAoa(list) {
  const H = [];
  (list || []).forEach(o => Object.keys(o || {}).forEach(k => { if (!NEVER.test(k) && H.indexOf(k) < 0 && H.length < 40) H.push(k); }));
  return [H].concat((list || []).map(o => H.map(h => (o[h] == null || typeof o[h] === 'object' ? '' : String(o[h]).slice(0, 200)))));
}
function fromCollector(list, from, to, at, by) {
  const R = parseAoa(rowsToAoa(list));
  if (!R || !R.rows.length) { if (!at) toast('Neorcha sent nothing that could be read', 'err'); return false; }
  S = Object.assign(R, { file: 'Neorcha · ' + (from && to ? dLbl(from) + ' – ' + dLbl(to) : 'collected') + (by === 'cloud' ? ' · ☁️ cloud' : ''), at: at || Date.now(), auto: true, by: by || 'helper' });
  try { localStorage.setItem(LS, JSON.stringify(S)); } catch (_) {}
  if (!at) {   // collected here: shared with the team's other devices (the cards as Neorcha's collector sent them — no passport, ID, e-mail or phone)
    if (typeof fbSet === 'function') try { fbSet('neorcha', { at: S.at, from: from || '', to: to || '', by: 'helper', n: list.length, rows: list }); } catch (_) {}
    if (typeof logActivity === 'function') try { logActivity('neorcha_collected', R.rows.length + ' registrations'); } catch (_) {}
  }
  toast('🪪 ' + R.rows.length + ' registration cards from Neorcha are in' + (by === 'cloud' ? ' (collected in the cloud)' : ''), 'ok');
  return true;
}
function applyLink(kind) {
  if (!S) return;
  const P = linkPlan(S.rows, pg()), list = kind === 'nat' ? P.nat : P.purpose;
  if (!list.length) return;
  if (!confirm(kind === 'nat' ? `Fill the nationality of ${list.length} guest${list.length === 1 ? '' : 's'} on Purpose of Stay (only where it is empty)?` : `Set the purpose of ${list.length} guest${list.length === 1 ? '' : 's'} on Purpose of Stay to what they gave on their Neorcha registration card?`)) return;
  const G = pg();
  list.forEach(x => { const g = G[x.i]; if (!g) return; if (kind === 'nat') g.nat = x.to; else g.purpose = x.to; });
  try { if (typeof savePurpose === 'function') savePurpose(G); } catch (_) {}
  try { if (typeof purposeRender === 'function') purposeRender(); } catch (_) {}
  try { if (typeof addPurposeLog === 'function') addPurposeLog('Neorcha', `${list.length} ${kind === 'nat' ? 'nationalities filled' : 'purposes set'} from the registration cards`); } catch (_) {}
  toast(`✓ ${list.length} ${kind === 'nat' ? 'nationalities filled' : 'purposes set'} on Purpose of Stay`, 'ok');
  draw();
}
const bar = (n, max) => `<i style="width:${Math.max(3, Math.round(n / Math.max(1, max) * 100))}%"></i>`;
const dLbl = s => { const [y, m, d] = String(s).split('-'); return +d + ' ' + MON[+m - 1]; };
function draw() {
  const out = $('out'); if (!out) return;
  const stp = $('steps'); if (stp) stp.querySelectorAll('li').forEach(li => { const k = +li.dataset.s; li.className = !S ? (k === 1 ? 'now' : '') : k === 1 ? 'done' : 'now'; });
  if (!S) { out.innerHTML = ''; return; }
  const Y = summary(S.rows), P = linkPlan(S.rows, pg()), maxP = Math.max(1, ...Y.purposes.map(x => x[1])), maxN = Math.max(1, ...Y.nats.slice(0, 8).map(x => x[1])), maxD = Math.max(1, ...Y.days.map(x => x[1]));
  const kpi = (cls, l, v, sub) => `<div class="${cls}"><small>${l}</small><b>${v}</b><i>${sub}</i></div>`;
  out.innerHTML = `
    <div class="nx-sum">${kpi('k0', 'Registration cards', Y.n, Y.from ? dLbl(Y.from) + ' – ' + dLbl(Y.to) : esc(S.file || ''))}${kpi('k1', 'Guests', Y.guests, 'adults + children')}${kpi('k2', 'ALL members', Y.members, Y.n ? Math.round(Y.members / Y.n * 100) + '% of cards' : '')}${kpi('k3', 'Nationalities', Y.nats.length, Y.nats[0] ? 'most: ' + esc(Y.nats[0][0]) : '')}</div>
    <div class="nx-cols">Columns read: ${S.cols.map(c => `<span>${esc(c.h)}</span>`).join('')} <em>· passport, ID, birth date, email and phone are never read</em></div>
    <div class="nx-link"><div class="nx-link-h"><span>🔗</span><div><b>Link to Purpose of Stay</b><small>${pg().length ? `${P.matched} of ${pg().length} guests on Purpose of Stay found on a registration card (by confirmation no., else room + name)` : 'Load Purpose of Stay first (Front Desk → Purpose of Stay), then come back.'}</small></div></div>
      ${pg().length ? `<div class="nx-link-a">
        <div><b>${P.purpose.length}</b> purpose${P.purpose.length === 1 ? '' : 's'} to set from the guest's own card${P.purpose.length ? `<small>${P.purpose.slice(0, 4).map(x => `${esc(x.room)} ${esc(x.from || '—')} → ${esc(x.to)}`).join(' · ')}${P.purpose.length > 4 ? ' …' : ''}</small>` : ''}<button type="button" class="btn gold sm" data-nx="purpose"${P.purpose.length ? '' : ' disabled'}>Apply</button></div>
        <div><b>${P.nat.length}</b> empty nationalit${P.nat.length === 1 ? 'y' : 'ies'} to fill${P.nat.length ? `<small>${P.nat.slice(0, 4).map(x => `${esc(x.room)} → ${esc(x.to)}`).join(' · ')}${P.nat.length > 4 ? ' …' : ''}</small>` : ''}<button type="button" class="btn gold sm" data-nx="nat"${P.nat.length ? '' : ' disabled'}>Apply</button></div></div>` : ''}</div>
    <div class="nx-grid">
      <div class="nx-box"><h4>🎯 Purpose of visit</h4>${Y.purposes.map(([k, n]) => `<div class="nx-bar"><span>${esc(k)}</span>${bar(n, maxP)}<b>${n}</b></div>`).join('') || '<p class="nx-m">Not in the file</p>'}</div>
      <div class="nx-box"><h4>🌍 Top nationalities</h4>${Y.nats.slice(0, 8).map(([k, n]) => `<div class="nx-bar"><span>${esc(k)}</span>${bar(n, maxN)}<b>${n}</b></div>`).join('') || '<p class="nx-m">Not in the file</p>'}</div>
      <div class="nx-box"><h4>💎 Members & who checked guests in</h4><table class="nx-t"><thead><tr><th>Checked in by</th><th>Cards</th><th>Members</th></tr></thead><tbody>${Y.staff.slice(0, 10).map(s => `<tr><td>${esc(s.by)}</td><td>${s.n}</td><td>${s.members} <small>${s.n ? Math.round(s.members / s.n * 100) + '%' : ''}</small></td></tr>`).join('')}</tbody></table>
        ${Y.mtypes.length ? `<p class="nx-m">${Y.mtypes.slice(0, 5).map(([k, n]) => `${esc(k)} ${n}`).join(' · ')}</p>` : ''}</div>
      <div class="nx-box"><h4>📅 Cards by arrival day</h4><div class="nx-days">${Y.days.map(([d, n]) => `<div title="${dLbl(d)}: ${n}"><i style="height:${Math.max(6, Math.round(n / maxD * 100))}%"></i><span>${+d.slice(8)}</span></div>`).join('') || '<p class="nx-m">No arrival dates in the file</p>'}</div></div>
    </div>
    <details class="nx-list"><summary>All ${Y.n} registration cards</summary><div class="nx-tw"><table class="nx-t"><thead><tr><th>Room</th><th>Guest</th><th>Arrival</th><th>Nationality</th><th>Purpose</th><th>Member</th><th>By</th></tr></thead><tbody>
      ${S.rows.slice(0, 600).map(r => `<tr><td>${esc(r.room)}</td><td>${esc(r.name)}</td><td>${r.arr ? dLbl(r.arr) : ''}</td><td>${esc(r.nat)}</td><td>${esc(r.purpose || r.purposeRaw)}</td><td>${r.member ? '💎' : ''}</td><td>${esc(r.by)}</td></tr>`).join('')}</tbody></table></div></details>`;
  out.querySelectorAll('[data-nx]').forEach(b => { b.onclick = () => applyLink(b.dataset.nx); });
}
const CSS = `
#panel-${PANEL} .nx-hero{display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding:20px 22px;margin-bottom:14px;border-radius:18px;border:1px solid var(--border);background:radial-gradient(120% 140% at 0% 0%,rgba(99,102,241,.18),transparent 55%),radial-gradient(120% 140% at 100% 0%,rgba(20,184,166,.14),transparent 55%),var(--card)}
#panel-${PANEL} .nx-hero-ic{width:56px;height:56px;border-radius:16px;display:grid;place-items:center;font-size:28px;background:linear-gradient(135deg,#6366f1,#4338ca);box-shadow:0 10px 26px -8px rgba(67,56,202,.6);flex:none}
#panel-${PANEL} .nx-hero-t{flex:1;min-width:200px}#panel-${PANEL} .nx-hero h1{margin:0;font-size:1.55rem}#panel-${PANEL} .nx-hero p{margin:4px 0 0;color:var(--text2);font-size:.88rem}
#panel-${PANEL} .nx-steps{list-style:none;display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:0 0 14px;padding:0}
#panel-${PANEL} .nx-steps li{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;border:1px solid var(--border);background:var(--card);color:var(--text3);font-size:.84rem;font-weight:600}
#panel-${PANEL} .nx-steps b{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;background:var(--bg2);border:1px solid var(--border2);font-size:.8rem;flex:none}
#panel-${PANEL} .nx-steps li.now{color:var(--text);border-color:color-mix(in srgb,var(--accent) 55%,var(--border))}#panel-${PANEL} .nx-steps li.now b{background:var(--accent);color:#111;border-color:var(--accent)}
#panel-${PANEL} .nx-steps li.done b{background:var(--green,#16a34a);color:#fff;border-color:transparent;font-size:0}#panel-${PANEL} .nx-steps li.done b::after{content:'✓';font-size:.85rem}
#panel-${PANEL} .nx-drop{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:18px;border:2px dashed var(--border2);border-radius:14px;background:var(--bg2)}#panel-${PANEL} .nx-drop.over{border-color:var(--accent)}
#panel-${PANEL} .nx-drop-t{flex:1 1 220px;display:flex;flex-direction:column;gap:2px}#panel-${PANEL} .nx-drop-t span{color:var(--text3);font-size:.8rem}
#panel-${PANEL} .nx-sum{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin:16px 0 8px}
#panel-${PANEL} .nx-sum>div{position:relative;overflow:hidden;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column}
#panel-${PANEL} .nx-sum>div::before{content:'';position:absolute;left:0;top:0;right:0;height:3px;background:var(--k)}#panel-${PANEL} .k0{--k:#6366f1}#panel-${PANEL} .k1{--k:#0ea5e9}#panel-${PANEL} .k2{--k:#d97706}#panel-${PANEL} .k3{--k:#16a34a}
#panel-${PANEL} .nx-sum small{font:700 10.5px var(--font);letter-spacing:.06em;text-transform:uppercase;color:var(--text3)}#panel-${PANEL} .nx-sum b{font-size:1.4rem;margin-top:2px}#panel-${PANEL} .nx-sum i{font-style:normal;color:var(--text3);font-size:.78rem}
#panel-${PANEL} .nx-cols{font-size:.76rem;color:var(--text3);margin:0 0 12px;display:flex;flex-wrap:wrap;gap:4px 6px;align-items:center}#panel-${PANEL} .nx-cols span{padding:1px 7px;border-radius:99px;border:1px solid var(--border);color:var(--text2)}#panel-${PANEL} .nx-cols em{font-style:normal}
#panel-${PANEL} .nx-link{padding:14px 16px;border-radius:14px;border:1px solid color-mix(in srgb,#6366f1 35%,var(--border));background:linear-gradient(180deg,color-mix(in srgb,#6366f1 7%,var(--card)),var(--card));margin-bottom:14px}
#panel-${PANEL} .nx-link-h{display:flex;gap:12px;align-items:center}#panel-${PANEL} .nx-link-h>span{font-size:22px}#panel-${PANEL} .nx-link-h small{display:block;color:var(--text3);font-size:.8rem}
#panel-${PANEL} .nx-link-a{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;margin-top:12px}
#panel-${PANEL} .nx-link-a>div{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:10px 12px;border-radius:12px;background:var(--bg2);border:1px solid var(--border);font-size:.86rem}
#panel-${PANEL} .nx-link-a b{font-size:1.1rem}#panel-${PANEL} .nx-link-a small{flex-basis:100%;order:3;color:var(--text3);font-size:.76rem}#panel-${PANEL} .nx-link-a .btn{margin-left:auto}
#panel-${PANEL} .nx-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}
#panel-${PANEL} .nx-box{padding:14px 16px;border-radius:14px;border:1px solid var(--border);background:var(--card)}#panel-${PANEL} .nx-box h4{margin:0 0 10px;font-size:.9rem}
#panel-${PANEL} .nx-bar{display:grid;grid-template-columns:minmax(80px,140px) 1fr 40px;gap:8px;align-items:center;margin:5px 0;font-size:.82rem}#panel-${PANEL} .nx-bar span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text2)}
#panel-${PANEL} .nx-bar i{display:block;height:8px;border-radius:99px;background:linear-gradient(90deg,#818cf8,#4f46e5)}#panel-${PANEL} .nx-bar b{text-align:right;font-family:var(--mono);font-size:.8rem}
#panel-${PANEL} .nx-m{margin:8px 0 0;color:var(--text3);font-size:.8rem}
#panel-${PANEL} .nx-t{width:100%;border-collapse:collapse;font-size:.8rem}#panel-${PANEL} .nx-t th,#panel-${PANEL} .nx-t td{padding:5px 8px;text-align:left;border-bottom:1px solid var(--border);white-space:nowrap}#panel-${PANEL} .nx-t th{font:700 10.5px var(--font);text-transform:uppercase;letter-spacing:.05em;color:var(--text3)}
#panel-${PANEL} .nx-t small{color:var(--text3)}
#panel-${PANEL} .nx-box{min-width:0;overflow:auto}#panel-${PANEL} .nx-box .nx-t{table-layout:fixed}#panel-${PANEL} .nx-box .nx-t th:first-child,#panel-${PANEL} .nx-box .nx-t td:first-child{overflow:hidden;text-overflow:ellipsis}#panel-${PANEL} .nx-box .nx-t th:not(:first-child),#panel-${PANEL} .nx-box .nx-t td:not(:first-child){width:84px;text-align:right}
#panel-${PANEL} .nx-days{display:flex;align-items:flex-end;gap:3px;height:110px}#panel-${PANEL} .nx-days>div{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%;gap:3px;min-width:0}
#panel-${PANEL} .nx-days i{display:block;width:100%;border-radius:4px 4px 2px 2px;background:linear-gradient(180deg,#818cf8,#4f46e5)}#panel-${PANEL} .nx-days span{font-size:9px;color:var(--text3)}
#panel-${PANEL} .nx-list{margin-top:12px;border:1px solid var(--border);border-radius:12px;background:var(--card)}#panel-${PANEL} .nx-list summary{cursor:pointer;padding:10px 14px;font-weight:600;color:var(--text2)}#panel-${PANEL} .nx-tw{max-height:420px;overflow:auto;padding:0 10px 10px}
#panel-${PANEL} .nx-col{margin:12px 0 0;padding:14px 16px;border-radius:14px;border:1px solid color-mix(in srgb,#6366f1 40%,var(--border));background:linear-gradient(180deg,color-mix(in srgb,#6366f1 8%,var(--card)),var(--card))}
#panel-${PANEL} .nx-col-h{display:flex;gap:12px;align-items:center}#panel-${PANEL} .nx-col-h>span{font-size:24px}#panel-${PANEL} .nx-col-h small{display:block;color:var(--text3);font-size:.8rem}
#panel-${PANEL} .nx-run{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin:12px 0 4px}#panel-${PANEL} .nx-run label{display:flex;flex-direction:column;gap:4px;font-size:.74rem;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.04em}
#panel-${PANEL} .nx-run input{padding:8px 10px;border-radius:10px;border:1px solid var(--border);background:var(--card);color:var(--text);font:inherit;font-size:.9rem}
#panel-${PANEL} .nx-live{margin:10px 0 0;padding:10px 12px;border-radius:10px;font-size:.86rem;background:color-mix(in srgb,#6366f1 10%,var(--card));color:var(--text)}#panel-${PANEL} .nx-live.ok{background:color-mix(in srgb,#10b981 14%,var(--card))}#panel-${PANEL} .nx-live.err{background:color-mix(in srgb,#f43f5e 12%,var(--card))}
#panel-${PANEL} .nx-run .nx-url{flex:1 1 320px}#panel-${PANEL} .nx-run .nx-url input{width:100%}
#panel-${PANEL} .nx-man .nx-drop{margin-top:12px}
#panel-${PANEL} .nx-live-b{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
#panel-${PANEL} .nx-cl{margin-top:14px;padding:14px;border-radius:14px;border:1px solid color-mix(in srgb,#0ea5e9 40%,var(--border));background:linear-gradient(180deg,color-mix(in srgb,#0ea5e9 9%,var(--card)),var(--card))}
#panel-${PANEL} .nx-cl-h{display:flex;gap:12px;align-items:center}#panel-${PANEL} .nx-cl-h>span{font-size:24px}#panel-${PANEL} .nx-cl-h small{display:block;color:var(--text3);font-size:.8rem;line-height:1.5}
#panel-${PANEL} .nx-cl-b{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px}#panel-${PANEL} .nx-cl-st{font-size:.82rem;color:var(--text2)}
#panel-${PANEL} .nx-cloud p{margin:8px 0;line-height:1.6;color:var(--text2)}#panel-${PANEL} .nx-cloud code{font-size:.78rem}
#panel-${PANEL} .nx-man{margin-top:12px;font-size:.84rem;color:var(--text3)}#panel-${PANEL} .nx-man summary{cursor:pointer}
#panel-${PANEL} .nx-col ol{margin:10px 0;padding-left:22px;line-height:1.8;font-size:.86rem;color:var(--text2)}#panel-${PANEL} .nx-col b{color:var(--text)}#panel-${PANEL} .nx-col-b{display:flex;gap:8px;flex-wrap:wrap}
@media (max-width:640px){#panel-${PANEL} .nx-steps{grid-template-columns:1fr}}`;
// ── ☁️ The cloud run: started from here (GitHub's "Run workflow" through a start key kept on this device), followed live ──
// The robot (scripts/neorcha-cloud.js) writes each step to hotels/<hotel>/neorchaLive; GitHub tells whether its computer started.
const GH = { api: 'https://api.github.com/repos/ahmed0088/depature-tool/actions/workflows/neorcha.yml', page: 'https://github.com/ahmed0088/depature-tool/actions/workflows/neorcha.yml', key: 'ho_gh_start_key_v1' };
const STEPS = [['gh', '🖥️', 'Start a GitHub computer'], ['open', '🌐', 'Open Neorcha'], ['login', '🔑', 'Log in'], ['search', '🔎', 'Search your dates'], ['read', '🪪', 'Read every card'], ['save', '💾', 'Save in HotelOps']];
const RUN = { at: 0, gh: null, live: null, timer: 0, poll: 0, view: 'run' };
const ghKey = () => { try { return localStorage.getItem(GH.key) || ''; } catch (_) { return ''; } };
const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };
async function gh(path, opt) {
  const r = await fetch(GH.api + (path || ''), Object.assign({ headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + ghKey(), 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' } }, opt || {}));
  if (r.status === 401) throw new Error('The start key was refused (expired or mistyped). Make a new one.');
  if (r.status === 403 || r.status === 404) throw new Error('The start key can\'t start this run — it needs the depature-tool repository and Actions: Read and write.');
  if (!r.ok) throw new Error('GitHub answered ' + r.status);
  return r.status === 204 ? null : r.json();
}
/** where a run is (pure): the step it is on, done / error, and the message */
function runState(live, gh, at) {
  const mine = live && (!at || +live.started >= at - 90000) ? live : null, idx = { open: 1, login: 2, search: 3, read: 4, save: 5, done: 6 };
  let k = mine ? (idx[mine.step] || 1) : 0, state = mine ? (mine.state === 'done' ? 'done' : mine.state === 'error' ? 'error' : 'run') : 'run', note = mine ? mine.note || '' : '';
  if (!mine && gh) {
    if (gh.status === 'completed' && gh.conclusion !== 'success') { state = 'error'; note = 'The GitHub run stopped (' + gh.conclusion + ') before it reached Neorcha — open it on GitHub to see why.'; }
    else if (gh.status === 'completed') { state = 'error'; note = 'The run finished but sent nothing — are the four Secrets added on GitHub (Settings → Secrets → Actions)?'; }
    else note = gh.status === 'queued' ? 'Waiting for a free GitHub computer…' : 'The GitHub computer is getting ready (about a minute)…';
  }
  if (!mine && !gh && at) note = 'Asking GitHub to start…';
  return { k, state, note, n: mine ? +mine.n || 0 : 0, prog: mine ? +mine.prog || 0 : 0, run: (mine && mine.run) || (gh && gh.html_url) || '' };
}
function runWin() {
  let w = document.getElementById('nxRun');
  if (!w) {
    w = document.createElement('div'); w.id = 'nxRun'; w.className = 'nxr';
    w.innerHTML = '<div class="nxr-bg" data-x="1"></div><div class="nxr-card" role="dialog" aria-label="Neorcha cloud run"><div class="nxr-h"><div class="nxr-ic">☁️</div><div class="nxr-t"><b>Neorcha · cloud run</b><small id="nxr-sub"></small></div><button type="button" class="nxr-x" data-x="1" aria-label="Close">✕</button></div><div class="nxr-b" id="nxr-b"></div></div>';
    document.body.appendChild(w);
    w.addEventListener('click', e => { if (e.target.closest('[data-x]')) { w.classList.remove('on'); clearInterval(RUN.timer); } });
  }
  w.classList.add('on'); clearInterval(RUN.timer); RUN.timer = setInterval(paintRun, 1000); paintRun();
}
function paintRun() {
  const b = document.getElementById('nxr-b'); if (!b) return;
  if (RUN.view === 'key') return;
  const st = runState(RUN.live, RUN.gh, RUN.at), t0 = RUN.at || (RUN.live && +RUN.live.started) || Date.now(), sec = Math.max(0, Math.round(((st.state === 'run' ? Date.now() : (RUN.live && +RUN.live.at) || Date.now()) - t0) / 1000));
  const sub = document.getElementById('nxr-sub'); if (sub) sub.textContent = (RUN.live && RUN.live.from ? dLbl(RUN.live.from) + ' – ' + dLbl(RUN.live.to) + ' · ' : '') + Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  const pct = st.state === 'done' ? 100 : Math.round(Math.min(97, st.k / 6 * 100 * (st.k === 4 ? 1 : 1) + (st.k === 4 ? st.prog / 100 * 16 : 0)));
  b.innerHTML = `<div class="nxr-bar ${st.state}"><i style="width:${pct}%"></i></div>
    <ol class="nxr-steps">${STEPS.map(([id, ic, lb], i) => { const s2 = st.state === 'done' || i < st.k ? 'ok' : i === st.k ? (st.state === 'error' ? 'bad' : 'now') : '';
      return `<li class="${s2}"><span class="d">${s2 === 'ok' ? '✓' : s2 === 'bad' ? '!' : ic}</span><span class="l">${esc(lb)}${id === 'read' && (st.k === 4 || st.n) ? ` <em>${st.n} card${st.n === 1 ? '' : 's'}</em>` : ''}</span>${s2 === 'now' ? '<span class="sp"></span>' : ''}</li>`; }).join('')}</ol>
    <div class="nxr-note ${st.state}">${st.state === 'done' ? '✅ ' : st.state === 'error' ? '⛔ ' : ''}${esc(st.note || '…')}</div>
    <div class="nxr-act">${st.state === 'done' ? '<button type="button" class="btn gold" data-x="1" id="nxr-see">See the cards</button>' : ''}${st.run ? `<a class="btn" href="${esc(st.run)}" target="_blank" rel="noopener">Open on GitHub ↗</a>` : ''}${st.state === 'run' ? '<span class="nxr-hint">You can close this — it keeps running and the cards land here.</span>' : ''}</div>`;
  if (st.state !== 'run') { clearInterval(RUN.poll); RUN.poll = 0; }
}
function keyWin(then) {
  RUN.view = 'key'; runWin();
  const sub = document.getElementById('nxr-sub'); if (sub) sub.textContent = 'One-time set-up on this device';
  document.getElementById('nxr-b').innerHTML = `<p class="nxr-p">This button starts the cloud run through GitHub. GitHub needs a <b>start key</b> once — it can only start and watch this run, nothing else, and it stays on this device.</p>
    <ol class="nxr-how"><li>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub → new fine-grained token ↗</a> (signed in as the repository owner).</li>
      <li>Name: <b>HotelOps cloud</b> · Expiration: the longest offered.</li><li>Repository access: <b>Only select repositories → depature-tool</b>.</li>
      <li>Permissions → Repository → <b>Actions: Read and write</b>. Nothing else.</li><li><b>Generate token</b>, copy it and paste it here.</li></ol>
    <div class="nxr-key"><input id="nxr-k" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_…"><button type="button" class="btn gold" id="nxr-ks">Save & run</button></div>
    <p class="nxr-p small">The Neorcha and HotelOps passwords never go here — they are GitHub Secrets (⚙️ Set up the cloud).</p>`;
  document.getElementById('nxr-ks').onclick = async () => {
    const k = document.getElementById('nxr-k').value.trim();
    if (!/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(k)) { toast('That does not look like a GitHub token (github_pat_…)', 'err'); return; }
    try { localStorage.setItem(GH.key, k); } catch (_) {}
    try { await gh(''); } catch (e) { try { localStorage.removeItem(GH.key); } catch (_) {} toast(e.message, 'err'); return; }
    RUN.view = 'run'; toast('Start key saved on this device', 'ok'); then();
  };
}
async function cloudStart(from, to) {
  if (!ghKey()) return keyWin(() => cloudStart(from, to));
  RUN.view = 'run'; RUN.at = Date.now(); RUN.gh = null; runWin();
  try { await gh('/dispatches', { method: 'POST', body: JSON.stringify({ ref: 'main', inputs: { from, to } }) }); }
  catch (e) { RUN.gh = { status: 'completed', conclusion: 'not started' }; paintRun(); toast(e.message, 'err'); if (/refused/.test(e.message)) { try { localStorage.removeItem(GH.key); } catch (_) {} } return; }
  clearInterval(RUN.poll);
  RUN.poll = setInterval(async () => {
    try { const j = await gh('/runs?per_page=5&event=workflow_dispatch'); const r = (j.workflow_runs || []).find(x => Date.parse(x.created_at) >= RUN.at - 15000); if (r) RUN.gh = r; paintRun(); } catch (_) {}
  }, 5000);
}
function cloudUI() {
  const st = $('cl-st'), paintChip = () => {
    const v = RUN.live; if (!st) return;
    st.innerHTML = !v ? '' : v.state === 'run' && Date.now() - +v.at < 15 * 60000 ? `<b class="run">● running</b> · ${esc(String(v.note || '').slice(0, 60))}` : v.state === 'done' ? `✅ Last run ${ago(+v.at)} · ${+v.n || 0} cards` : v.state === 'error' ? `⛔ Last run ${ago(+v.at)} stopped — Show progress` : '';
  };
  const listen = () => { if (typeof fbListen !== 'function') return setTimeout(listen, 1500); fbListen('neorchaLive', v => { RUN.live = v || null; paintChip(); paintRun(); }); };
  listen();
  $('cloud').onclick = () => { const f = $('from').value, t = $('to').value; if (!f || !t || f > t) { toast('Pick the arrival dates (from ≤ to)', 'err'); return; } cloudStart(f, t); };
  $('cl-show').onclick = () => { RUN.view = 'run'; if (!RUN.poll) RUN.at = RUN.at || 0; runWin(); };
  $('cl-forget').onclick = e => { e.preventDefault(); try { localStorage.removeItem(GH.key); } catch (_) {} toast('Start key removed from this device', 'ok'); };
  document.addEventListener('click', e => { if (e.target.id === 'nxr-see') { const o = $('out'); if (o) o.scrollIntoView({ behavior: 'smooth' }); } });
}
const RUN_CSS = `.nxr{position:fixed;inset:0;z-index:9000;display:none;align-items:center;justify-content:center}.nxr.on{display:flex}
.nxr-bg{position:absolute;inset:0;background:rgba(2,6,23,.55);backdrop-filter:blur(4px)}
.nxr-card{position:relative;width:min(480px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow:auto;border-radius:20px;background:var(--card,#0f172a);color:var(--text,#e2e8f0);border:1px solid var(--border,#334155);box-shadow:0 30px 80px rgba(0,0,0,.45);animation:nxrIn .22s ease}
@keyframes nxrIn{from{transform:translateY(14px);opacity:0}to{transform:none;opacity:1}}
.nxr-h{display:flex;gap:12px;align-items:center;padding:18px 18px 10px}.nxr-ic{width:44px;height:44px;border-radius:13px;display:grid;place-items:center;font-size:22px;background:linear-gradient(135deg,#38bdf8,#6366f1)}
.nxr-t{flex:1;min-width:0}.nxr-t b{display:block;font-size:1.02rem}.nxr-t small{color:var(--text3,#94a3b8);font-size:.8rem;font-variant-numeric:tabular-nums}
.nxr-x{border:0;background:transparent;color:var(--text3,#94a3b8);font-size:18px;cursor:pointer;padding:6px 8px;border-radius:10px}.nxr-x:hover{background:var(--bg2,#1e293b)}
.nxr-b{padding:6px 18px 18px}.nxr-bar{height:8px;border-radius:99px;background:var(--bg2,#1e293b);overflow:hidden;margin:4px 0 16px}.nxr-bar i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#38bdf8,#6366f1);transition:width .6s ease}
.nxr-bar.done i{background:linear-gradient(90deg,#10b981,#22c55e)}.nxr-bar.error i{background:linear-gradient(90deg,#f43f5e,#ef4444)}
.nxr-steps{list-style:none;margin:0;padding:0;display:grid;gap:4px}.nxr-steps li{display:flex;align-items:center;gap:12px;padding:9px 10px;border-radius:12px;color:var(--text3,#94a3b8);font-size:.92rem}
.nxr-steps .d{width:28px;height:28px;flex:none;border-radius:50%;display:grid;place-items:center;font-size:.85rem;background:var(--bg2,#1e293b);border:1px solid var(--border,#334155)}
.nxr-steps li.ok{color:var(--text,#e2e8f0)}.nxr-steps li.ok .d{background:#10b981;border-color:#10b981;color:#fff;font-weight:700}
.nxr-steps li.now{color:var(--text,#e2e8f0);background:color-mix(in srgb,#6366f1 12%,transparent);font-weight:600}.nxr-steps li.now .d{border-color:#6366f1;box-shadow:0 0 0 4px color-mix(in srgb,#6366f1 25%,transparent)}
.nxr-steps li.bad{color:#fda4af;background:color-mix(in srgb,#f43f5e 12%,transparent)}.nxr-steps li.bad .d{background:#f43f5e;border-color:#f43f5e;color:#fff;font-weight:700}
.nxr-steps .l{flex:1}.nxr-steps em{font-style:normal;margin-left:6px;padding:1px 8px;border-radius:99px;background:color-mix(in srgb,#6366f1 20%,transparent);font-size:.78rem}
.nxr-steps .sp{width:16px;height:16px;border-radius:50%;border:2px solid color-mix(in srgb,#6366f1 30%,transparent);border-top-color:#6366f1;animation:nxrSp .8s linear infinite}@keyframes nxrSp{to{transform:rotate(360deg)}}
.nxr-note{margin:14px 0 0;padding:11px 13px;border-radius:12px;font-size:.88rem;line-height:1.5;background:var(--bg2,#1e293b)}.nxr-note.done{background:color-mix(in srgb,#10b981 16%,transparent)}.nxr-note.error{background:color-mix(in srgb,#f43f5e 14%,transparent)}
.nxr-act{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:14px}.nxr-hint{font-size:.78rem;color:var(--text3,#94a3b8)}
.nxr-p{font-size:.88rem;line-height:1.6;color:var(--text2,#cbd5e1);margin:4px 0 10px}.nxr-p.small{font-size:.78rem;color:var(--text3,#94a3b8)}.nxr-how{margin:0 0 12px;padding-left:20px;line-height:1.8;font-size:.86rem}.nxr-how a{color:#7dd3fc}
.nxr-key{display:flex;gap:8px}.nxr-key input{flex:1;min-width:0;padding:10px 12px;border-radius:11px;border:1px solid var(--border,#334155);background:var(--bg2,#1e293b);color:inherit;font:inherit}
.nx-cl-st b.run{color:#38bdf8}
@media (max-width:600px){.nxr{align-items:flex-end}.nxr-card{width:100vw;max-height:92vh;border-radius:22px 22px 0 0;animation:nxrUp .25s ease}@keyframes nxrUp{from{transform:translateY(40px)}to{transform:none}}.nxr-key{flex-direction:column}}`;
function mount() {
  if (document.getElementById('panel-' + PANEL)) return;
  const main = document.querySelector('main.main') || document.querySelector('main'), nav = document.querySelector('nav.sidenav') || document.querySelector('nav');
  if (!main || !nav) return;
  const st = document.createElement('style'); st.textContent = CSS + RUN_CSS; document.head.appendChild(st);
  const panel = document.createElement('div'); panel.className = 'panel'; panel.id = 'panel-' + PANEL;
  panel.innerHTML = `<div style="max-width:1200px">
    <div class="nx-hero"><div class="nx-hero-ic">🪪</div><div class="nx-hero-t"><h1>Neorcha Registrations</h1><p>The registration cards from Neorcha: purpose of visit, nationality and ALL members — linked to Purpose of Stay</p></div>
      <button type="button" class="btn rose" id="nx-clear">✕ Clear</button></div>
    <ol class="nx-steps" id="nx-steps"><li data-s="1"><b>1</b><span>Collect from Neorcha</span></li><li data-s="2"><b>2</b><span>See the month</span></li><li data-s="3"><b>3</b><span>Link to Purpose of Stay</span></li></ol>
    <div class="nx-col"><div class="nx-col-h"><span>🤖</span><div><b>Collect from Neorcha — automatic</b><small>Pick the dates and press Start. Neorcha opens, you log in, it reads every confirmation by itself and the cards land here.</small></div></div>
      <div class="nx-run"><label class="nx-url">Your hotel's Neorcha link<input type="url" id="nx-url" spellcheck="false"></label><label>Arrivals from<input type="date" id="nx-from"></label><label>to<input type="date" id="nx-to"></label>
        <button type="button" class="btn gold" id="nx-start">▶ Start</button></div>
      <div class="nx-live" id="nx-live" hidden></div>
      <div class="nx-cl"><div class="nx-cl-h"><span>☁️</span><div><b>Cloud — no PC needed</b><small>A GitHub computer logs in to Neorcha and collects for you — every night at 3:17 by itself, or now, with the dates above. Works from your phone.</small></div></div>
        <div class="nx-cl-b"><button type="button" class="btn gold" id="nx-cloud">☁️ Run in the cloud</button><button type="button" class="btn" id="nx-cl-show">📡 Show progress</button><span class="nx-cl-st" id="nx-cl-st"></span></div>
        <details class="nx-man nx-cloud"><summary>⚙️ Set up the cloud (once)</summary>
          <p><b>1 · The logins</b> — on github.com open the HotelOps repository → <b>Settings → Secrets and variables → Actions → New repository secret</b>: <code>NEORCHA_USER</code>, <code>NEORCHA_PASS</code>, <code>HOTELOPS_EMAIL</code>, <code>HOTELOPS_PASS</code> (other hotel: <code>NEORCHA_URL</code>). Typed there, they stay encrypted — never in HotelOps.</p>
          <p><b>2 · The start key</b> (so this button can start it) — press ☁️ Run in the cloud and follow the steps. It is kept on this device only.</p>
          <p><a href="https://github.com/ahmed0088/depature-tool/actions/workflows/neorcha.yml" target="_blank" rel="noopener">All cloud runs on GitHub ↗</a> · <a href="#" id="nx-cl-forget">Forget the start key on this device</a></p></details></div>
      <details class="nx-man"><summary>No helper on this PC? Run it by hand</summary>
        <ol><li>Open <b>ibis.myneorcha.com</b>, log in, go to <b>Guest Documents</b> and pick your <b>hotel</b>.</li>
          <li>Press <b>📋 Copy the collector</b>, then on Neorcha press <b>F12 → Console</b>, paste and press <b>Enter</b> <small>(first time: type <code>allow pasting</code>)</small> — or click the bookmark.</li>
          <li>Choose the dates and press <b>▶ Collect</b>. It saves a file at the end: drop it here.</li></ol>
        <div class="nx-col-b"><button type="button" class="btn" id="nx-copycol">📋 Copy the collector</button><a class="btn" id="nx-bm" href="#">⭐ Drag to bookmarks</a></div>
    <div class="nx-drop" id="nx-drop"><div style="font-size:26px">🪪</div><div class="nx-drop-t"><b>Drop the collector's file here</b><span>the file it saved at the end (.csv)</span></div>
      <button type="button" class="btn gold" id="nx-browse">📂 Browse…</button><input type="file" id="nx-file" accept=".csv,.txt,.xlsx,.xls" hidden></div>
      </details></div>
    <div id="nx-out"></div></div>`;
  main.appendChild(panel);
  const item = document.createElement('div'); item.className = 'nav-item'; item.id = 'nav-' + PANEL; item.dataset.panel = PANEL;
  item.setAttribute('onclick', "showPanel('" + PANEL + "')");
  item.innerHTML = '<div class="nav-icon">🪪</div>Neorcha Registrations';
  const anchor = document.getElementById('nav-purpose'); if (anchor && nav.contains(anchor)) anchor.after(item); else nav.appendChild(item);
  // the phone's "More" menu is its own list: add this page there too (next to purpose)
  const grid = document.querySelector('.mob-more-grid');
  if (grid && !grid.querySelector('.mob-more-item[data-panel="' + PANEL + '"]')) {
    const b = document.createElement('button');
    b.className = 'mob-more-item'; b.dataset.panel = PANEL; b.type = 'button';
    b.setAttribute('onclick', "showPanel('" + PANEL + "');(typeof closeMobMore==='function'?closeMobMore:typeof toggleMobMore==='function'?toggleMobMore:function(){})()");
    b.innerHTML = '<span class="mob-item-icon">🪪</span>Neorcha Registrations';
    const at = grid.querySelector('.mob-more-item[data-panel="purpose"]');
    if (at) at.after(b); else grid.appendChild(b);
  }
  try { ['owner', 'manager', 'supervisor', 'agent'].forEach(r => { if (typeof ROLES !== 'undefined' && ROLES[r] && !ROLES[r].panels.includes(PANEL)) ROLES[r].panels.push(PANEL); });
    if (typeof currentProfile !== 'undefined' && currentProfile && typeof applyRole === 'function') applyRole(currentProfile.role); } catch (_) {}
  $('browse').onclick = () => { $('file').value = ''; $('file').click(); };
  const code = collectorCode();
  $('copycol').onclick = () => { if (typeof copyToClipboard === 'function') copyToClipboard(code, $('copycol'), '📋 Copy the collector'); else navigator.clipboard.writeText(code).then(() => toast('Copied — paste it in Neorcha\'s console', 'ok')); };
  $('bm').href = 'javascript:' + encodeURIComponent(code); $('bm').onclick = e => { e.preventDefault(); toast('Drag this button to your bookmarks bar, then click the bookmark on Neorcha', 'info'); };
  $('file').onchange = e => load(e.target.files[0]);
  cloudUI();
  // ▶ Start: dates → the helper (it opens Neorcha); its progress and the cards come back here
  const t = new Date(), iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  $('from').value = iso(new Date(t.getFullYear(), t.getMonth(), 1)); $('to').value = iso(t);
  const live = (h, tone, html) => { const L = $('live'); L.hidden = false; L.className = 'nx-live ' + (tone || ''); if (html) L.innerHTML = esc(h) + html; else L.textContent = h; };
  const NX_DEF = 'https://ibis.myneorcha.com/neorchaWEBPlatform/#/login';
  const urlKey = () => { let h = ''; try { h = typeof _meHotel === 'function' ? _meHotel() : ''; } catch (_) {} return 'ho_neorcha_url_v1:' + String(h || 'hotel').toLowerCase(); };
  const okUrl = u => { try { const x = new URL(u); return x.protocol === 'https:' && /(^|[.])myneorcha[.]com$/i.test(x.hostname); } catch (_) { return false; } };
  const NX = () => { const v = $('url').value.trim(); return okUrl(v) ? v : NX_DEF; };
  try { $('url').value = localStorage.getItem(urlKey()) || NX_DEF; } catch (_) { $('url').value = NX_DEF; }
  $('url').placeholder = NX_DEF;
  $('url').onchange = () => { const v = $('url').value.trim(); if (v && !okUrl(v)) { toast('That is not a Neorcha link (it must be https://….myneorcha.com/…)', 'err'); return; } try { localStorage.setItem(urlKey(), v || NX_DEF); } catch (_) {} toast('Neorcha link saved for this hotel', 'ok'); };
  const openBtn = () => '<a class="btn" href="' + esc(NX()) + '" target="_blank" rel="noopener">🌐 Open Neorcha myself</a>';
  const dlBtn = '<button type="button" class="btn gold" data-nxdl="1">⬇️ Download the helper</button>';
  let heard = 0, waitT = 0;
  $('live').addEventListener('click', e => { if (e.target.closest('[data-nxdl]') && W.hoWaHelper && W.hoWaHelper.download) W.hoWaHelper.download(); });
  $('start').onclick = () => {
    const f = $('from').value, to = $('to').value;
    if (!f || !to || f > to) { toast('Pick the arrival dates (from ≤ to)', 'err'); return; }
    const D = document.documentElement.dataset;
    if (!D.hoNxHelper) {
      live(D.hoWaHelper ? '⬇️ Your helper on this PC is the old one — it can\'t open Neorcha yet. Download it, unzip it over the old helper folder (replace the files), press ↻ on it in chrome://extensions, reload this page and press Start again.'
        : '⬇️ This PC has no HotelOps helper yet. Download it and add it once (the README in the zip shows how), or use "Run it by hand" below.', 'err', '<div class="nx-live-b">' + dlBtn + '</div>');
      return;
    }
    heard = 0; clearTimeout(waitT);
    window.postMessage({ source: 'ho-nx-job', from: f, to, url: NX() }, location.origin);
    live('⏳ Opening Neorcha… log in there — everything else is automatic.');
    waitT = setTimeout(() => { if (!heard) live('⚠️ The helper did not answer. In chrome://extensions press ↻ on HotelOps WhatsApp helper, reload this page and press Start again — or open Neorcha yourself: after you log in it starts by itself.', 'err', '<div class="nx-live-b">' + openBtn() + '</div>'); }, 6000);
  };
  window.addEventListener('message', e => {
    const m = e.data; if (e.source !== window || !m || typeof m !== 'object') return;
    if (/^ho-nx-(progress|rows)$/.test(m.source)) heard = 1;
    if (m.source === 'ho-nx-progress' && m.note) live('🤖 ' + String(m.note).slice(0, 300) + (m.n ? '' : ''), /⛔|⚠️/.test(m.note) ? 'err' : '');
    if (m.source === 'ho-nx-rows' && Array.isArray(m.rows) && fromCollector(m.rows.slice(0, 5000), m.from, m.to)) { live('✅ ' + S.rows.length + ' cards collected — see below, then link them to Purpose of Stay.', 'ok'); draw(); }
  });
  $('clear').onclick = () => { S = null; try { localStorage.removeItem(LS); } catch (_) {} draw(); };
  const z = $('drop');
  ['dragenter', 'dragover'].forEach(ev => z.addEventListener(ev, e => { e.preventDefault(); z.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => z.addEventListener(ev, e => { e.preventDefault(); z.classList.remove('over'); }));
  z.addEventListener('drop', e => { const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) load(f); });
  // ☁️ the cards saved by another device or by the cloud run: newer than what this device has → shown here
  const listen = () => { if (typeof fbListen !== 'function') return setTimeout(listen, 1500);
    fbListen('neorcha', v => { if (!v || !Array.isArray(v.rows) || !(+v.at > ((S && +S.at) || 0))) return;
      if (fromCollector(v.rows.slice(0, 5000), v.from, v.to, +v.at, v.by)) draw(); }); };
  listen();
  // Purpose of Stay changes (loaded later, edited): the link numbers follow
  document.addEventListener('click', e => { if (e.target.closest && e.target.closest('[data-panel="' + PANEL + '"]')) setTimeout(draw, 50); }, true);
  draw();
}
W.hoNeorcha = { runState, _run: { RUN, paintRun }, rowsToAoa, collectorSrc, collectorCode, parseAoa, summary, linkPlan, purposeOf, isoOf, natName, NEVER };
if (typeof document !== 'undefined' && document.addEventListener) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount(); }
})();
