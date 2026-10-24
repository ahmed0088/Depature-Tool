// ═══════════════════════════════════════════════════════════
//  guest-autofill.js  —  type a room number, get the guest
//
//  Wherever a room number is typed (wake-up calls, lost & found,
//  maintenance, HK requests, gym guest members, WhatsApp templates),
//  the guest in that room shows right under the box: name, VIP, pax,
//  dates, nights, company / agent, balance and today's status — and
//  the guest-name box next to it fills itself (unless you typed one).
//
//  Where it looks, best first: In-House (the whole hotel), then today's
//  Departures, then Arrivals. Nothing is saved; it only reads.
//
//  API: window.hoGuestLookup(room) → { room, name, src, … } or null
//       Add data-room-input to any <input> to get the card there too;
//       data-name-target="#id" names the box to fill.
// ═══════════════════════════════════════════════════════════
(function () {
'use strict';
const W = window, doc = document;
const safe = (f, d) => { try { return f(); } catch (_) { return d; } };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// "0512", "512 " and "512" are the same room
const rk = r => { const s = String(r == null ? '' : r).trim().toUpperCase().replace(/\s+/g, ''); const m = s.match(/^([A-Z]?)0*(\d+)([A-Z]?)$/); return m ? m[1] + (m[2] || '0') + m[3] : s; };
// today's reports live in plain globals: read with typeof (no eval — the CSP blocks it)
const deps = () => safe(() => (typeof depRooms !== 'undefined' && Array.isArray(depRooms) ? depRooms : []), []);
const arrs = () => safe(() => (typeof arrGuests !== 'undefined' && Array.isArray(arrGuests) ? arrGuests : []), []);
const nice = n => String(n || '').replace(/\s+/g, ' ').trim();

/** everything the loaded reports know about the guest in a room today */
function lookup(room) {
  const k = rk(room); if (!k || !/\d/.test(k)) return null;
  const ih = safe(() => (W.hoInHouse && typeof W.hoInHouse.find === 'function' ? W.hoInHouse.find(k) : null), null);
  const d = deps().find(x => x && rk(x.roomStr != null ? x.roomStr : x.room) === k) || null;
  const a = arrs().find(x => x && rk(x.room) === k) || null;
  if (!ih && !d && !a) return null;
  const o = { room: (ih && ih.room) || (d && d.roomStr) || (a && a.room) || String(room).trim(), src: ih ? 'In-House' : d ? 'Departures' : 'Arrivals' };
  o.name = nice((ih && ih.name) || (d && d.name !== '—' && d.name) || (a && a.name) || '');
  o.names = ih && ih.names && ih.names.length > 1 ? ih.names.map(nice) : [];
  o.arrival = (ih && ih.arrival) || (d && d.arrival) || (a && a.arrival) || '';
  o.departure = (ih && ih.departure) || (d && d.departure) || (a && a.departure) || '';
  o.nights = (ih && ih.nights) || (d && d.nights) || (a && a.nights) || 0;
  o.adults = ih ? ih.adults || 0 : (a && +a.adults) || 0;
  o.children = ih ? ih.children || 0 : (a && +a.children) || 0;
  o.vip = !!((ih && ih.vip) || (d && d.isVip) || (a && (a.vip || a.isVip)));
  o.member = (ih && ih.member) || '';
  o.company = nice((ih && (ih.company || ih.agent)) || (d && (d.source || d.company)) || (a && (a.company || a.source)) || '');
  o.rateCode = (ih && ih.rateCode) || (d && d.rateCode) || '';
  o.conf = (ih && ih.conf) || (a && a.conf) || '';
  o.nat = (ih && ih.nat) || '';
  o.roomType = (ih && ih.roomType) || '';
  o.balance = ih ? +ih.balance || 0 : (d && +d.balance) || 0;
  o.status = (ih && ih.status) || (d && d.status) || '';
  o.lateTime = (ih && ih.lateTime) || (d && d.lateTime) || '';
  o.extendedTo = (ih && ih.extendedTo) || '';
  o.arriving = !ih && !d && !!a;
  return o;
}

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
function day(s) {
  s = String(s || '').trim(); if (!s) return '';
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${+m[3]} ${MON[+m[2] - 1][0] + MON[+m[2] - 1].slice(1).toLowerCase()}`;
  m = s.match(/^(\d{1,2})[-/ ]([A-Za-z]{3})/);
  if (m) return `${+m[1]} ${m[2][0].toUpperCase() + m[2].slice(1, 3).toLowerCase()}`;
  return s;
}
const STATUS = { out: ['Checked out', 'bad'], extended: ['Extended', 'ok'], late: ['Late check-out', 'warn'], due: ['Departing today', 'warn'], dnd: ['DND', 'warn'], na: ['No answer', 'warn'] };

function card(g) {
  const pax = g.adults + g.children ? `${g.adults}${g.children ? '+' + g.children : ''} pax` : '';
  const dates = g.arrival || g.departure ? `${day(g.arrival)} → ${day(g.extendedTo || g.departure)}${g.nights ? ` · ${g.nights} night${g.nights === 1 ? '' : 's'}` : ''}` : '';
  const st = STATUS[g.status];
  const tags = [
    g.vip ? '<span class="ga-t gold">VIP</span>' : '',
    g.member ? `<span class="ga-t">${esc(g.member)}</span>` : '',
    st ? `<span class="ga-t ${st[1]}">${esc(st[0])}${g.status === 'late' && g.lateTime ? ' ' + esc(g.lateTime) : ''}</span>` : '',
    g.arriving ? '<span class="ga-t sky">Arriving</span>' : '',
  ].join('');
  const bits = [pax, dates, g.company, g.roomType, g.rateCode, g.nat, g.balance > 0 ? `bal AED ${g.balance.toFixed(2)}` : ''].filter(Boolean).map(esc).join(' · ');
  return `<div class="ga-n"><span class="ga-ic" aria-hidden="true">👤</span><b>${esc(g.name || 'Guest')}</b>${g.names.length ? `<span class="ga-more">+${g.names.length - 1}</span>` : ''}${tags}</div>${bits ? `<div class="ga-d">${bits}</div>` : ''}<div class="ga-src">from ${esc(g.src)}${g.conf ? ' · conf ' + esc(g.conf) : ''}</div>`;
}

// ── which boxes are room boxes, and where their guest name goes ──
const ROOM_SEL = '#wkRoom, #wabARoom, #waRoom, .ol-form input[name="room"], .ol-form input[name="area"], input.gy-in[name="room"], input[data-room-input]';
function nameBox(inp) {
  const t = inp.getAttribute('data-name-target'); if (t) return doc.querySelector(t);
  if (inp.id === 'wkRoom') return doc.getElementById('wkName');
  if (inp.matches('input.gy-in[name="room"]')) { const f = inp.closest('form, .modal, .gy-form, [role="dialog"]') || doc; return f.querySelector('input[name="name"]'); }
  return null;
}
function holder(inp) {
  let c = W.__gaCards || (W.__gaCards = new WeakMap());
  let el = c.get(inp);
  if (el && el.isConnected) return el;
  el = doc.createElement('div');
  el.className = 'ga-card'; el.hidden = true; el.setAttribute('aria-live', 'polite');
  const at = inp.closest('label') || inp;
  // a row of small boxes (HK request): put the card under the whole row
  const row = inp.closest('.wab-lf, .wa-cmp');
  (row || at).insertAdjacentElement('afterend', el);
  c.set(inp, el);
  return el;
}

let tmr = 0;
function onInput(e) {
  const inp = e.target;
  if (!inp || !inp.matches || !inp.matches(ROOM_SEL)) {
    // typed into a name box by hand: leave it alone from now on
    if (inp && inp.matches && inp.matches('#wkName, input.gy-in[name="name"]') && e.isTrusted !== false) inp.dataset.typed = inp.value ? '1' : '';
    return;
  }
  clearTimeout(tmr);
  tmr = setTimeout(() => show(inp), 120);
}
function show(inp) {
  const v = String(inp.value || '').trim();
  // "305, lobby toilet" or "Room 305": the room is the first number
  const m = v.match(/^(?:room\s*)?([A-Za-z]?\d{2,5}[A-Za-z]?)\b/i);
  const g = m ? lookup(m[1]) : null;
  const el = holder(inp);
  if (!g) { el.hidden = true; el.innerHTML = ''; live.delete(inp); fillName(inp, ''); return; }
  el.innerHTML = card(g);
  el.hidden = false;
  fillName(inp, g.name);
  watch(inp, v);
}
// a page that clears the box after saving (no typing event): the card goes with it
const live = new Map();
let wt = 0;
function watch(inp, v) {
  live.set(inp, v);
  if (wt) return;
  wt = setInterval(() => {
    live.forEach((was, i) => { if (!i.isConnected) live.delete(i); else if (String(i.value || '').trim() !== was) { live.delete(i); show(i); } });
    if (!live.size) { clearInterval(wt); wt = 0; }
  }, 400);
}
function fillName(inp, name) {
  const b = nameBox(inp); if (!b || b.dataset.typed) return;
  // gym: only for a guest member, and only while the name box is still empty or ours
  if (b.name === 'name' && b.value && b.dataset.gaFilled !== '1') return;
  b.value = name || '';
  b.dataset.gaFilled = name ? '1' : '';
  try { b.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
}

function css() {
  if (doc.getElementById('gaCss')) return;
  const s = doc.createElement('style'); s.id = 'gaCss';
  s.textContent = `
.ga-card{margin:6px 0 2px;padding:8px 10px;border:1px solid var(--border,rgba(127,127,127,.25));border-left:3px solid var(--accent,#6366f1);border-radius:10px;background:var(--surface2,rgba(127,127,127,.06));font-size:.8rem;line-height:1.35;color:var(--text,inherit);min-width:0;max-width:100%;box-sizing:border-box;grid-column:1/-1;flex-basis:100%;animation:gaIn .16s ease-out}
.ga-card[hidden]{display:none}
.ga-n{display:flex;flex-wrap:wrap;align-items:center;gap:5px;min-width:0}
.ga-n b{font-weight:700;overflow-wrap:anywhere}
.ga-ic{font-size:.9rem}
.ga-more{font-size:.7rem;color:var(--text3,#888)}
.ga-t{font-size:.66rem;font-weight:700;padding:1px 7px;border-radius:999px;background:rgba(127,127,127,.15);color:var(--text2,inherit);white-space:nowrap}
.ga-t.gold{background:rgba(234,179,8,.18);color:#b45309}.ga-t.ok{background:rgba(16,185,129,.16);color:#047857}.ga-t.warn{background:rgba(245,158,11,.16);color:#b45309}.ga-t.bad{background:rgba(239,68,68,.15);color:#b91c1c}.ga-t.sky{background:rgba(14,165,233,.15);color:#0369a1}
[data-theme="dark"] .ga-t.gold,[data-theme="dark"] .ga-t.warn{color:#fbbf24}[data-theme="dark"] .ga-t.ok{color:#34d399}[data-theme="dark"] .ga-t.bad{color:#f87171}[data-theme="dark"] .ga-t.sky{color:#38bdf8}
.ga-d{margin-top:3px;color:var(--text2,inherit);overflow-wrap:anywhere}
.ga-src{margin-top:2px;font-size:.66rem;color:var(--text3,#888)}
@keyframes gaIn{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.ga-card{animation:none}}`;
  doc.head.appendChild(s);
}

function start() {
  css();
  doc.addEventListener('input', onInput, true);
  // the wake-up page fills the name the old way too: give it the In-House guest first
  W._wkGuest = room => { const g = lookup(room); return g ? g.name : ''; };
}
if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
W.hoGuestLookup = lookup;
})();
