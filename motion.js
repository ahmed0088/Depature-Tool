// ═══════════════════════════════════════════════════════════
//  motion.js  —  Calm, smart motion that makes the app feel alive
//
//  Self-contained: injects <style id="motionStyle"> and hooks into the
//  page with event delegation and ONE debounced MutationObserver on .main.
//  It never changes data and never blocks a click.
//
//  What it adds (all transform / opacity, 150–350 ms, ease-out):
//   • Numbers that count up from the old value to the new one, with a tiny pop
//     (.kpi-val, .dp-kpi-val, .home-big, #depRingNum, .gp-num, .stc-num, .cl-num, .mu-kpis b)
//   • New rows (shift tasks, wake-up calls, monthly reports) slide in with a soft glow
//   • Ripple on .btn presses (departures cards keep their own ripple)
//   • A "check pop" when a shift task or monthly report is ticked
//   • Confetti (canvas, ~1 s) + a 🎉 pill on milestones, once per milestone per day:
//     all departures out, all tasks of a shift done, all monthly reports ticked,
//     the Package Audit "To fix" list emptied
//   • A sliding indicator on the active sidebar item, a soft tick of the
//     topbar clock each minute, a small hop of 🧠 when it has a new thought
//   • A soft shadow lift on cards when hovered (mouse only)
//
//  Off when: prefers-reduced-motion, Settings "motion" off (body.ho-still),
//  localStorage ho_motion = 'off', or the tab is hidden.
//  API: window.hoMotion = { on(), off(), celebrate(text), enabled() }
//  Page transitions + first-level stagger already live in pro.css (hoIn/hoRise),
//  so this file does not add another one.
// ═══════════════════════════════════════════════════════════
(function () {
'use strict';
if (window.hoMotion) return;

const LS_KEY = 'ho_motion', LS_DONE = 'ho_motion_done';
const lsGet = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_) {} };
const RM = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
let userOff = lsGet(LS_KEY) === 'off';

function enabled() {
  return !userOff && !RM.matches && !document.hidden && !(document.body && document.body.classList.contains('ho-still'));
}
function syncClass() { document.documentElement.classList.toggle('ho-mo', enabled()); }

// ── Styles ────────────────────────────────────────────────
const STYLE = `
html.ho-mo .mo-rip-w{position:absolute;inset:0;overflow:hidden;border-radius:inherit;pointer-events:none;z-index:0}
html.ho-mo .mo-rip{position:absolute;border-radius:50%;background:currentColor;opacity:.22;transform:scale(0);animation:moRip .35s cubic-bezier(.2,.8,.2,1) forwards}
@keyframes moRip{to{transform:scale(1);opacity:0}}
html.ho-mo .mo-pop{animation:moPop .32s cubic-bezier(.2,.8,.3,1.4)}
@keyframes moPop{0%{transform:scale(.7);box-shadow:0 0 0 0 color-mix(in srgb,var(--green) 55%,transparent)}55%{transform:scale(1.28)}100%{box-shadow:0 0 0 7px transparent}}
html.ho-mo .mo-num{animation:moNum .3s ease-out}
@keyframes moNum{0%{transform:scale(1)}40%{transform:scale(1.09)}100%{transform:scale(1)}}
html.ho-mo .mo-new{animation:moNew .32s cubic-bezier(.2,.8,.2,1) both}
@keyframes moNew{0%{opacity:0;transform:translateY(8px);box-shadow:0 0 0 2px color-mix(in srgb,var(--gold,var(--accent)) 55%,transparent)}60%{opacity:1;transform:none}100%{box-shadow:0 0 0 0 transparent}}
html.ho-mo #topbarTime.mo-tick{animation:moTick .35s ease-out}
@keyframes moTick{0%{opacity:.45}100%{opacity:1}}
html.ho-mo .br-fab.mo-hop{animation:moHop .5s cubic-bezier(.2,.8,.3,1.3)}
@keyframes moHop{0%,100%{transform:none}35%{transform:translateY(-7px) scale(1.06)}70%{transform:translateY(1px)}}
.sidenav{position:relative}
.mo-ind{position:absolute;left:1px;top:0;width:3px;height:0;border-radius:3px;background:var(--accent,var(--gold));pointer-events:none;opacity:0;z-index:2}
html.ho-mo .mo-ind{opacity:.95}
html.ho-mo .mo-ind.mo-ready{transition:transform .28s cubic-bezier(.2,.8,.2,1),height .28s cubic-bezier(.2,.8,.2,1)}
[data-theme="opera"] .mo-ind,[data-theme="night-ops"] .mo-ind{display:none}
@media (hover:hover) and (pointer:fine){
  html.ho-mo .card,html.ho-mo #muView .mu-card{transition:box-shadow .2s ease-out,border-color .2s ease-out}
  html.ho-mo .card:hover,html.ho-mo #muView .mu-card:hover{box-shadow:0 8px 26px rgba(0,0,0,.16),var(--ho-shadow,0 0 0 transparent);border-color:var(--border2)}
}
#moConfetti{position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483000}
.mo-cele{position:fixed;left:50%;top:max(14px,env(safe-area-inset-top));transform:translateX(-50%);z-index:2147483001;max-width:calc(100vw - 32px);box-sizing:border-box;
  padding:9px 18px;border-radius:999px;background:var(--card,#222);color:var(--text,#fff);border:1px solid var(--gold,var(--accent));
  box-shadow:0 10px 34px rgba(0,0,0,.28);font:700 .9rem/1.3 var(--font,system-ui);text-align:center;pointer-events:none;white-space:normal}
html.ho-mo .mo-cele{animation:moCeleIn .3s cubic-bezier(.2,.8,.3,1.25) both}
html.ho-mo .mo-cele.out{animation:moCeleOut .25s ease-in both}
@keyframes moCeleIn{from{opacity:0;transform:translate(-50%,-12px) scale(.92)}to{opacity:1;transform:translate(-50%,0)}}
@keyframes moCeleOut{to{opacity:0;transform:translate(-50%,-8px)}}
.mo-cele.out{opacity:0}
@media (prefers-reduced-motion:reduce){.mo-rip,.mo-pop,.mo-num,.mo-new,.mo-tick,.mo-hop,.mo-cele{animation:none!important}.mo-ind{transition:none!important}}
`;
function mountStyle() {
  if (document.getElementById('motionStyle')) return;
  const s = document.createElement('style'); s.id = 'motionStyle'; s.textContent = STYLE;
  document.head.appendChild(s);
}

// ── Ripple + press feedback ───────────────────────────────
const RIP_SEL = '.btn:not(.dca):not(.dc-copy-card-btn):not(.dc-stamp-btn), button.primary';
let lastInput = 0;
function onPointerDown(e) {
  lastInput = Date.now();
  if (!enabled() || e.button > 0) return;
  const b = e.target.closest && e.target.closest(RIP_SEL);
  if (!b || b.disabled || b.closest('.dp-card')) return;
  const r = b.getBoundingClientRect(); if (!r.width || !r.height) return;
  let fixPos = false;
  if (!b.style.position && getComputedStyle(b).position === 'static') { b.style.position = 'relative'; fixPos = true; }
  const w = document.createElement('span'); w.className = 'mo-rip-w'; w.setAttribute('aria-hidden', 'true');
  const d = Math.max(r.width, r.height) * 2.2;
  const s = document.createElement('span'); s.className = 'mo-rip';
  s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
  w.appendChild(s); b.appendChild(w);
  const done = () => { w.remove(); if (fixPos && !b.querySelector('.mo-rip-w')) b.style.position = ''; };
  s.addEventListener('animationend', done, { once: true });
  setTimeout(done, 700);   // safety: animations can be killed by other CSS
}

// ── Check pop (shift tasks, monthly reports) ──────────────
function onClick(e) {
  lastInput = Date.now();
  const c = e.target.closest && e.target.closest('.st-check');
  if (!c) { setTimeout(checkMilestones, 400); return; }
  const item = c.closest('.st-item'), mr = c.closest('.mr-row');
  let find;
  if (item) { const id = item.dataset.id, k = item.dataset.key; find = () => document.querySelector(`.st-item[data-id="${CSS.escape(id || '')}"][data-key="${CSS.escape(k || '')}"]`); }
  else if (mr) { const nm = (mr.querySelector('.mr-name') || {}).textContent; find = () => [...document.querySelectorAll('.mr-row')].find(r => (r.querySelector('.mr-name') || {}).textContent === nm); }
  else return;
  pendPop = { find, t0: Date.now(), last: null };
  setTimeout(runPop, 0);
  setTimeout(checkMilestones, 400);
}
// The list is often drawn again a few times right after a tick (save + live update),
// so the pop follows the newest copy of the row for a short while.
let pendPop = null;
function runPop() {
  const pp = pendPop; if (!pp) return;
  if (Date.now() - pp.t0 > 900) { pendPop = null; return; }
  const row = pp.find();
  if (row && row.classList.contains('done') && row !== pp.last) {
    pp.last = row;
    if (enabled()) pop(row.querySelector('.st-check'));
  }
}
function pop(el, cls) {
  if (!el) return; cls = cls || 'mo-pop';
  el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
  const end = e => { if (e.target !== el) return; el.removeEventListener('animationend', end); el.classList.remove(cls); };
  el.addEventListener('animationend', end);
}

// ── Count-up numbers ──────────────────────────────────────
const NUM_SEL = '.kpi-val, .dp-kpi-val, .home-big, #depRingNum, .gp-num, .stc-num, .cl-num, .mu-kpis b';
const NUM_RE = /^([^\d\-]{0,3})(-?\d{1,3}(?:,\d{3})+|-?\d{1,9})(\.\d{1,2})?(\s?[%A-Za-z]{0,4})$/;
const slotVal = new Map();          // slot key → last number seen
const wrote = new WeakMap();        // el → text we last wrote while counting
function parseNum(t) {
  const m = NUM_RE.exec((t || '').trim()); if (!m) return null;
  return { pre: m[1], v: parseFloat(m[2].replace(/,/g, '') + (m[3] || '')), dec: m[3] ? m[3].length - 1 : 0, comma: m[2].includes(','), suf: m[4] };
}
function fmt(n, p) {
  const s = p.dec ? n.toFixed(p.dec) : String(Math.round(n));
  return p.pre + (p.comma ? s.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : s) + p.suf;
}
function slotKey(el) {
  if (el.id) return '#' + el.id;
  const host = el.closest('[id]'); const cls = el.className.split(' ')[0] || el.tagName;
  const all = host ? host.querySelectorAll('.' + CSS.escape(cls)) : [];
  return (host ? host.id : '') + '|' + cls + '|' + Array.prototype.indexOf.call(all, el);
}
function onNumber(el) {
  const txt = el.textContent;
  if (wrote.get(el) === txt) return;   // our own frame
  const p = parseNum(txt), key = slotKey(el);
  if (!p) { slotVal.delete(key); return; }
  const old = slotVal.get(key);
  slotVal.set(key, p.v);
  if (old == null || old === p.v || !enabled() || !isVisible(el)) return;
  countUp(el, old, p);
  if (!el.classList.contains('dp-bump') && getComputedStyle(el).display !== 'inline') pop(el, 'mo-num');
}
function isVisible(el) {
  if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') return false;
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < innerHeight && r.width > 0;
}
function countUp(el, from, p) {
  const to = p.v, dur = Math.min(450, 220 + Math.abs(to - from) * 12), t0 = performance.now();
  const tok = {}; el._moTok = tok;
  const ease = x => 1 - Math.pow(1 - x, 3);
  const frame = now => {
    if (el._moTok !== tok) return;
    if (wrote.has(el) && el.textContent !== wrote.get(el)) { wrote.delete(el); return; }   // the app wrote something new: stop
    const k = Math.min(1, (now - t0) / dur);
    const s = k >= 1 ? fmt(to, p) : fmt(from + (to - from) * ease(k), p);
    wrote.set(el, s);
    if (el.textContent !== s) el.textContent = s;
    if (k < 1 && !document.hidden) requestAnimationFrame(frame);
    else { el.textContent = fmt(to, p); wrote.set(el, el.textContent); }
  };
  wrote.delete(el);
  // first frame now, so the old value shows at once (no flash of the final value)
  const s0 = fmt(from, p); wrote.set(el, s0); el.textContent = s0;
  requestAnimationFrame(frame);
}

// ── New rows ──────────────────────────────────────────────
const ROW_SEL = '.st-item, .wk-row, .mr-row';
const listKeys = new Map();         // container key → Set of item keys
const recentNew = new Map();        // group|item key → when it first showed
function rowKey(el) {
  return el.dataset.id || ((el.querySelector('.st-name, .mr-name, .wk-name') || el).textContent || '').trim().slice(0, 80);
}
function groupKey(el) {
  const host = el.parentElement && el.parentElement.closest('[id]');
  return (host ? host.id : '') + '|' + (el.matches('.st-item') ? 'st' : el.matches('.wk-row') ? 'wk' : 'mr') + '|' + (el.dataset.key || '');
}
function scanRows(rows) {
  const groups = new Map();
  rows.forEach(r => { if (!r.isConnected) return; const g = groupKey(r); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r); });
  groups.forEach((items, g) => {
    // read the whole group as it is now (not only the added nodes)
    const host = items[0].parentElement.closest('[id]') || document;
    const sel = g.split('|')[1] === 'st' ? '.st-item' : g.split('|')[1] === 'wk' ? '.wk-row' : '.mr-row';
    const kk = g.split('|')[2];
    const all = [...host.querySelectorAll(sel)].filter(x => (x.dataset.key || '') === kk);
    const now = new Set(all.map(rowKey));
    const prev = listKeys.get(g);
    listKeys.set(g, now);
    if (!prev || !enabled()) return;
    const t = Date.now();
    const fresh = all.filter(x => !prev.has(rowKey(x)));
    if (fresh.length > 3) return;   // many at once = a reload or a filter, not a new row
    fresh.forEach(x => recentNew.set(g + '|' + rowKey(x), t));
    // a list drawn again right after (save + live update) keeps the glow on the newest copy
    all.forEach(x => { const at = recentNew.get(g + '|' + rowKey(x)); if (at && t - at < 400 && x.offsetParent && !x.classList.contains('mo-new')) pop(x, 'mo-new'); });
    recentNew.forEach((at, k) => { if (t - at > 1000) recentNew.delete(k); });
  });
}

// ── Main observer (one, debounced to a frame) ─────────────
let pendNums = new Set(), pendRows = new Set(), queued = false;
function onMut(recs) {
  for (const m of recs) {
    const t = m.target.nodeType === 3 ? m.target.parentElement : m.target;
    if (t && t.closest) { const n = t.closest(NUM_SEL); if (n) pendNums.add(n); }
    for (const a of m.addedNodes) {
      if (a.nodeType !== 1) continue;
      if (a.matches(NUM_SEL)) pendNums.add(a);
      if (a.matches(ROW_SEL)) pendRows.add(a);
      if (a.firstElementChild) {
        a.querySelectorAll(NUM_SEL).forEach(x => pendNums.add(x));
        a.querySelectorAll(ROW_SEL).forEach(x => pendRows.add(x));
      }
    }
  }
  if ((pendNums.size || pendRows.size || pendPop) && !queued) { queued = true; requestAnimationFrame(flush); }
  scheduleMilestones();
}
function flush() {
  queued = false;
  const nums = pendNums, rows = pendRows; pendNums = new Set(); pendRows = new Set();
  nums.forEach(n => { if (n.isConnected) try { onNumber(n); } catch (_) {} });
  if (rows.size) try { scanRows([...rows]); } catch (_) {}
  if (pendPop) runPop();
}

// ── Celebrations ──────────────────────────────────────────
const msPrev = {};
let msTimer = 0;
function scheduleMilestones() { clearTimeout(msTimer); msTimer = setTimeout(checkMilestones, 350); }
const today = () => { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
function doneToday() { try { const o = JSON.parse(lsGet(LS_DONE) || '{}'); return o.d === today() ? o : { d: today(), k: [] }; } catch (_) { return { d: today(), k: [] }; } }
function milestoneStates() {
  const out = {};
  try {
    if (typeof depRooms !== 'undefined' && Array.isArray(depRooms) && depRooms.length) {   // eslint-disable-line no-undef
      const rs = depRooms;   // eslint-disable-line no-undef
      out['dep:' + (window._depDate || today())] = { on: rs.every(r => r.status === 'out' || r.status === 'extended' || r.status === 'na') && rs.some(r => r.status === 'out' || r.status === 'extended'),
        text: `All ${rs.length} departures done` };
    }
  } catch (_) {}
  try {
    if (typeof SHIFTS !== 'undefined' && typeof stCount === 'function') {   // eslint-disable-line no-undef
      Object.keys(SHIFTS).forEach(k => {   // eslint-disable-line no-undef
        const c = stCount(k); if (!c || !c.total) return;   // eslint-disable-line no-undef
        out['st:' + k] = { on: c.done === c.total, text: `All ${SHIFTS[k].label || k} tasks done` };   // eslint-disable-line no-undef
      });
    }
  } catch (_) {}
  try {
    const b = document.querySelector('#mrCard .mr-prog b'), m = b && /^(\d+)\s*\/\s*(\d+)$/.exec(b.textContent.trim());
    if (m && +m[2] > 0) out['mr:' + ((document.querySelector('#mrCard .mr-for') || {}).textContent || '')] = { on: m[1] === m[2], text: 'All monthly reports ticked' };
  } catch (_) {}
  try {
    const v = [...document.querySelectorAll('#panel-package-audit .pa-view')].find(x => /'action'/.test(x.getAttribute('onclick') || '') && !x.classList.contains('rule'));
    const n = v && v.querySelector('span') ? parseInt(v.querySelector('span').textContent, 10) : NaN;
    if (!isNaN(n)) out['pkg:' + today()] = { on: n === 0, text: 'Package Audit list cleared' };
  } catch (_) {}
  return out;
}
function checkMilestones() {
  const st = milestoneStates(), recent = Date.now() - lastInput < 10000;
  Object.keys(st).forEach(k => {
    const was = msPrev[k]; msPrev[k] = st[k].on;
    if (!(was === false && st[k].on && recent)) return;   // only when it just became complete, after a tap or key
    const dn = doneToday(); if (dn.k.includes(k)) return;
    dn.k.push(k); lsSet(LS_DONE, JSON.stringify(dn));
    celebrate(st[k].text);
  });
}

let celeEl = null, celeT = 0;
function celebrate(text) {
  mountStyle();
  if (celeEl) celeEl.remove();
  clearTimeout(celeT);
  const el = document.createElement('div'); el.className = 'mo-cele'; el.setAttribute('role', 'status');
  el.textContent = '🎉 ' + String(text == null ? 'Well done!' : text).slice(0, 120);
  document.body.appendChild(el); celeEl = el;
  celeT = setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), enabled() ? 260 : 0); if (celeEl === el) celeEl = null; }, 2600);
  if (enabled()) confetti();
}
function confetti() {
  if (document.getElementById('moConfetti')) return;
  const cv = document.createElement('canvas'); cv.id = 'moConfetti'; cv.setAttribute('aria-hidden', 'true');
  const dpr = Math.min(2, window.devicePixelRatio || 1), W = innerWidth, H = innerHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d'); if (!ctx) { cv.remove(); return; }
  ctx.scale(dpr, dpr);
  const cs = getComputedStyle(document.documentElement);
  const cols = ['--gold', '--green', '--accent', '--sky', '--rose', '--mint'].map(v => cs.getPropertyValue(v).trim()).filter(Boolean);
  if (cols.length < 3) cols.push('#eab94a', '#3ecf8e', '#5ab4e8', '#f472b6');
  const N = W < 500 ? 60 : 90, ps = [];
  for (let i = 0; i < N; i++) {
    const fromLeft = i % 2 === 0, a = (fromLeft ? -60 : -120) * Math.PI / 180 + (Math.random() - .5) * .9, sp = 7 + Math.random() * 8;
    ps.push({ x: fromLeft ? W * .2 : W * .8, y: H * .55, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: Math.random() * 6.3, vr: (Math.random() - .5) * .4,
      w: 5 + Math.random() * 5, h: 3 + Math.random() * 4, c: cols[i % cols.length] });
  }
  const t0 = performance.now(), DUR = 1100;
  const step = now => {
    const t = now - t0;
    if (t > DUR || document.hidden || !cv.isConnected) { cv.remove(); return; }
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = t > DUR * .65 ? Math.max(0, 1 - (t - DUR * .65) / (DUR * .35)) : 1;
    for (const p of ps) {
      p.vy += .32; p.vx *= .985; p.vy *= .985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ── Sidebar sliding indicator ─────────────────────────────
let ind = null;
function moveInd() {
  const nav = document.querySelector('.sidenav'); if (!nav) return;
  if (!ind || !ind.isConnected) { ind = document.createElement('div'); ind.className = 'mo-ind'; ind.setAttribute('aria-hidden', 'true'); nav.appendChild(ind); }
  const a = nav.querySelector('.nav-item.active');
  if (!a || !a.offsetParent) { ind.style.height = '0px'; return; }
  const h = Math.max(14, a.offsetHeight - 16);
  const tf = `translateY(${a.offsetTop + (a.offsetHeight - h) / 2}px)`;
  if (ind.style.transform !== tf) ind.style.transform = tf;
  if (ind.style.height !== h + 'px') ind.style.height = h + 'px';
  if (!ind.classList.contains('mo-ready')) requestAnimationFrame(() => ind && ind.classList.add('mo-ready'));
}

// ── Clock tick + Ops Brain hop ────────────────────────────
let lastMin = '';
function onClock() {
  const el = document.getElementById('topbarTime'); if (!el) return;
  const m = (/\d{1,2}:\d{2}/.exec(el.textContent) || [''])[0];
  if (lastMin && m && m !== lastMin && enabled()) pop(el, 'mo-tick');
  lastMin = m;
}
function onBody(recs) {
  for (const m of recs) for (const a of m.addedNodes) {
    if (a.nodeType === 1 && a.id === 'blBubble' && enabled()) { const f = document.querySelector('.br-fab'); if (f) pop(f, 'mo-hop'); }
  }
}

// ── Start ─────────────────────────────────────────────────
let started = false;
function start() {
  if (started) return; started = true;
  mountStyle(); syncClass();
  document.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', () => { lastInput = Date.now(); scheduleMilestones(); }, true);
  document.addEventListener('visibilitychange', syncClass);
  if (RM.addEventListener) RM.addEventListener('change', syncClass);
  new MutationObserver(syncClass).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(onBody).observe(document.body, { childList: true });

  const main = document.querySelector('.main') || document.body;
  // remember what is on screen now, so the first change counts from the real old value
  main.querySelectorAll(NUM_SEL).forEach(n => { const p = parseNum(n.textContent); if (p) slotVal.set(slotKey(n), p.v); });
  const rows = main.querySelectorAll(ROW_SEL); if (rows.length) scanRows([...rows]);
  new MutationObserver(onMut).observe(main, { childList: true, subtree: true, characterData: true });

  const nav = document.querySelector('.sidenav');
  if (nav) {
    let q = false;
    new MutationObserver(recs => { if (recs.every(r => r.target === ind)) return; if (!q) { q = true; requestAnimationFrame(() => { q = false; moveInd(); }); } })
      .observe(nav, { attributes: true, attributeFilter: ['class', 'style'], subtree: true, childList: true });
    addEventListener('resize', () => requestAnimationFrame(moveInd), { passive: true });
    moveInd();
  }
  const clk = document.getElementById('topbarTime');
  if (clk) { onClock(); new MutationObserver(onClock).observe(clk, { childList: true, characterData: true, subtree: true }); }
  checkMilestones();   // learn the current states (no celebration on load)
}

window.hoMotion = {
  on() { userOff = false; lsSet(LS_KEY, null); syncClass(); },
  off() { userOff = true; lsSet(LS_KEY, 'off'); syncClass(); const c = document.getElementById('moConfetti'); if (c) c.remove(); },
  celebrate,
  enabled,
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
