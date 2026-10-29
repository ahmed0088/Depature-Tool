// ═══════════════════════════════════════════════════════════
//  motion.js  —  Calm, quick motion that makes the app feel alive
//
//  Self-contained: injects <style id="motionStyle"> and hooks into the page
//  with event delegation and a few MutationObservers (work batched to one
//  frame). It never changes data, never blocks or delays a click, and never
//  hides content waiting for an animation: everything uses the Web Animations
//  API with fill "none"/"backwards", so nothing is left on an element when it
//  ends (no transform kept on ancestors of sticky / fixed things), and if this
//  file fails the page simply shows without motion.
//
//  What it adds (transform / opacity, 120–320 ms, cubic-bezier(.2,.8,.2,1)):
//   • Page switch: the new page fades in and rises 7 px; on a phone, a tap on the
//     bottom bar slides it 14 px from the side you are going to
//   • Lists and cards stagger in the FIRST time they show (12 items × 20 ms max):
//     Departures cards, Arrivals rows, Handover items, shift tasks, checklist steps,
//     roster rows, Opera page cards, Home tiles, Settings sections … A live redraw
//     (same rooms / same items again) never plays it again; 1–3 new items fade in
//   • Numbers that count up from the old value to the new one (tabular digits)
//   • A soft green pulse on a room that was just checked out
//   • A check that draws itself in with a tiny pop (shift tasks, monthly reports,
//     night checklist, handover items) and a "saved" tick in save toasts
//   • Windows: backdrop fades, the window scales up from .96 and closes the same
//     way; toasts slide up; menus scale from where they open
//   • Buttons: press .97, a 1 px lift on hover (mouse only), the focus ring settles in;
//     chips / filters cross-fade; a soft shimmer on "Loading…" placeholders
//   • Ripple on .btn presses, new-row glow, sidebar indicator, clock tick, 🧠 hop
//   • Confetti (canvas, ~1 s) + a 🎉 pill once per milestone per day (all departures
//     out, all shift tasks done, monthly reports, Package Audit list cleared)
//
//  Settings → Appearance → Animations: Full · Subtle · Off (this device).
//  Subtle = short fades only (no movement, no stagger, no confetti).
//  Off when: prefers-reduced-motion, the setting Off (body.ho-still), or the tab is hidden.
//  API: window.hoMotion = { on(), off(), level(), setLevel(l), celebrate(text), enabled() }
// ═══════════════════════════════════════════════════════════
(function () {
'use strict';
if (window.hoMotion) return;

const LS_KEY = 'ho_motion', LS_DONE = 'ho_motion_done';
const lsGet = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_) {} };
const RM = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
const EASE = 'cubic-bezier(.2,.8,.2,1)';

// ── Pure helpers (also tested in tests/run-tests.js) ───────
/** Full · Subtle · Off from what the device says (reduced motion), the Settings switch and this file's own choice */
function levelFrom(o) {
  o = o || {};
  if (o.rm || o.still || o.ls === 'off') return 'off';
  return o.ls === 'subtle' ? 'subtle' : 'full';
}
/** how long an animation runs at a level: 0 = instant (Off), Subtle is a little shorter */
function durFor(level, ms) { return level === 'off' ? 0 : level === 'subtle' ? Math.round(ms * 0.75) : ms; }
/** how far things move: only Full moves, Subtle only fades */
function distFor(level, px) { return level === 'full' ? px : 0; }
/** start delays for a list's first appearance: Full only, at most 12 items, 20 ms apart */
function staggerPlan(n, level, max, step) {
  if (level !== 'full') return [];
  max = max || 12; step = step || 20;
  const out = []; for (let i = 0; i < Math.min(n, max); i++) out.push(i * step);
  return out;
}
/** First-appearance bookkeeping. note(group, keys) → { first, fresh }:
 *  first = this list never showed before; fresh = keys that are new since last time
 *  (empty on the first time, and empty for a live redraw of the same items). */
function createSeen(cap) {
  cap = cap || 3000;
  const groups = new Map();
  return {
    note(group, keys) {
      let s = groups.get(group); const first = !s;
      if (!s) { s = new Set(); groups.set(group, s); }
      const fresh = [];
      for (const k of keys) { if (k == null || k === '') continue; if (!s.has(k)) { s.add(k); if (!first) fresh.push(k); } }
      if (s.size > cap) { groups.set(group, new Set(keys)); }   // a very long day: start the list again, never grow without end
      return { first, fresh };
    },
    has: group => groups.has(group),
    forget: group => groups.delete(group),
    size: () => groups.size,
  };
}

let userOff = lsGet(LS_KEY) === 'off';
function level() {
  return levelFrom({ rm: RM.matches, still: !!(document.body && document.body.classList.contains('ho-still')), ls: userOff ? 'off' : lsGet(LS_KEY) });
}
function enabled() { return level() !== 'off' && !document.hidden; }
function full() { return enabled() && level() === 'full'; }
function syncClass() {
  const R = document.documentElement.classList, on = enabled();
  R.toggle('ho-mo', on);
  R.toggle('ho-mo-full', on && level() === 'full');
  R.toggle('ho-mo-subtle', on && level() === 'subtle');
  R.add('ho-mo-js');
}

// ── Styles ────────────────────────────────────────────────
const STYLE = `
html.ho-mo .mo-rip-w{position:absolute;inset:0;overflow:hidden;border-radius:inherit;pointer-events:none;z-index:0}
html.ho-mo .mo-rip{position:absolute;border-radius:50%;background:currentColor;opacity:.22;transform:scale(0);animation:moRip .35s cubic-bezier(.2,.8,.2,1) forwards}
@keyframes moRip{to{transform:scale(1);opacity:0}}
html.ho-mo .mo-pop{animation:moPop .3s cubic-bezier(.2,.8,.2,1)}
@keyframes moPop{0%{scale:.84;box-shadow:0 0 0 0 color-mix(in srgb,var(--green) 50%,transparent)}55%{scale:1.1}100%{scale:1;box-shadow:0 0 0 7px transparent}}
html.ho-mo-subtle .mo-pop{animation-name:moPopS}
@keyframes moPopS{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--green) 50%,transparent)}100%{box-shadow:0 0 0 6px transparent}}
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

/* ── v2: one motion language everywhere ───────────────────── */
:root{--mo-ease:${EASE}}
/* The page switch and first-time list staggers are played from JS (Web Animations, nothing left behind).
   These CSS entrances replayed on EVERY innerHTML redraw (every few seconds on live pages), so with
   this file running they are off; without it (JS failed) the old CSS still works. */
html.ho-mo-js .panel.active,html.ho-mo-js .panel.active>*,html.ho-mo-js .panel.mob-enter,
html.ho-mo-js .home-tile,html.ho-mo-js .rk-kpi,html.ho-mo-js .rk-allc,html.ho-mo-js .rh-tile,html.ho-mo-js .rr-card,
html.ho-mo-js .hd-row,html.ho-mo-js .rt-row,html.ho-mo-js .ev-row,html.ho-mo-js .st-item,html.ho-mo-js .st-log-entry,
html.ho-mo-js .dep-grid>.dep-card,html.ho-mo-js #panel-departures .dp-card.dp-enter,html.ho-mo-js #hbRoot .hb-it{animation:none!important}
/* a room just checked out: a soft green ring that settles (departures.js adds .dp-flash, and keeps it across its own redraws) */
html.ho-mo #panel-departures .dp-card.dp-s-out.dp-flash{animation:moOutPulse .7s var(--mo-ease)}
@keyframes moOutPulse{0%{scale:.985;box-shadow:0 0 0 0 color-mix(in srgb,var(--green) 55%,transparent)}35%{scale:1.006;box-shadow:0 0 0 7px color-mix(in srgb,var(--green) 16%,transparent)}100%{scale:1;box-shadow:var(--dp-shadow,0 0 0 0 transparent)}}
html.ho-mo-subtle #panel-departures .dp-card.dp-s-out.dp-flash{animation-name:moOutPulseS}
@keyframes moOutPulseS{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--green) 45%,transparent)}100%{box-shadow:var(--dp-shadow,0 0 0 0 transparent)}}
/* numbers that change keep their width */
.kpi-val,.dp-kpi-val,.home-big,#depRingNum,.gp-num,.stc-num,.cl-num,.mu-kpis b,.op-tile-n{font-variant-numeric:tabular-nums}
/* buttons: press, hover lift (mouse only), focus ring settles in — scale / translate compose with any transform a button already has */
html.ho-mo :is(.fchip,.dep-sort-btn,.vt-btn,.shift-tab,.hs-seg button,.op-go,.op-tile,.hb-chip,.dp-pill-btn,.mob-nav-btn,button.primary){transition:scale .12s var(--mo-ease),translate .18s var(--mo-ease),background-color .18s ease,color .18s ease,border-color .18s ease,box-shadow .18s ease,opacity .18s ease}
html.ho-mo .btn{transition:transform .12s var(--mo-ease),scale .12s var(--mo-ease),translate .18s var(--mo-ease),background-color .18s ease,color .18s ease,border-color .18s ease,box-shadow .18s ease,opacity .18s ease}
html.ho-mo :is(.fchip,.dep-sort-btn,.vt-btn,.shift-tab,.hs-seg button,.op-go,.op-tile,.hb-chip,.dp-pill-btn,.mob-nav-btn,button.primary):active:not(:disabled){scale:.97}
@media (hover:hover) and (pointer:fine){
  html.ho-mo-full :is(.btn,.op-go,.op-tile,.dp-pill-btn,button.primary):hover:not(:disabled):not(:active){translate:0 -1px}
}
html.ho-mo :is(.btn,.fchip,.dep-sort-btn,.vt-btn,.shift-tab,.hs-seg button,.op-go,.op-tile,.nav-item,.mob-nav-btn,.dca,.home-tile):focus-visible{animation:moRing .2s var(--mo-ease)}
@keyframes moRing{from{outline-offset:6px;outline-color:transparent}}
/* toggles slide, chips and filters cross-fade */
html.ho-mo .hs-switch i,html.ho-mo .rr-sw i{transition:background-color .2s ease}
html.ho-mo .hs-switch i::after,html.ho-mo .rr-sw i::after{transition:transform .22s var(--mo-ease)}
/* the app's toast slides up and fades (utils.js showToast sets only opacity) */
html.ho-mo #appToast{transition:opacity .22s var(--mo-ease),translate .26s var(--mo-ease)!important}
html.ho-mo-full #appToast[style*="opacity: 0"]{translate:0 10px}
/* menus scale from where they open */
html.ho-mo :is(.dep-copy-menu.open,.rb-menu,.dp-balpop){animation:moMenuIn .16s var(--mo-ease);transform-origin:top center}
@keyframes moMenuIn{from{opacity:0;scale:.96}}
html.ho-mo-subtle :is(.dep-copy-menu.open,.rb-menu,.dp-balpop){animation-name:moFadeIn}
@keyframes moFadeIn{from{opacity:0}}
/* a check that draws itself in */
.mo-drawing{position:relative;color:transparent!important}
.mo-drawing::before{color:transparent!important}
.mo-ck{position:absolute;left:50%;top:50%;width:68%;height:68%;translate:-50% -50%;pointer-events:none;overflow:visible}
.mo-ck path{fill:none;stroke:#fff;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;stroke-dashoffset:0}
html.ho-mo .mo-ck path{animation:moDraw .26s var(--mo-ease) .04s backwards}
@keyframes moDraw{from{stroke-dashoffset:1}}
/* "Saved ✓" — a little tick that draws in the save toast */
.mo-ok{display:inline-block;width:1.05em;height:1.05em;margin:0 .4em -.18em 0;overflow:visible}
.mo-ok path{fill:none;stroke:currentColor;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;stroke-dashoffset:0}
html.ho-mo .mo-ok path{animation:moDraw .3s var(--mo-ease) .06s backwards}
/* a soft shimmer on "Loading…" placeholders (stops by itself after ~10 s) */
html.ho-mo .mo-skel{position:relative;overflow:hidden;isolation:isolate}
html.ho-mo .mo-skel::after{content:'';position:absolute;inset:0;z-index:-1;pointer-events:none;border-radius:inherit;
  background:linear-gradient(100deg,transparent 20%,color-mix(in srgb,var(--text,#888) 7%,transparent) 50%,transparent 80%);translate:-100% 0;animation:moShim 1.3s ease-in-out 8}
@keyframes moShim{to{translate:100% 0}}
@media (prefers-reduced-motion:reduce){.mo-ck path,.mo-ok path,.mo-skel::after,html.ho-mo #panel-departures .dp-card.dp-s-out.dp-flash,:is(.dep-copy-menu.open,.rb-menu,.dp-balpop){animation:none!important}}
body.ho-still .mo-skel::after{display:none}
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
  const nb = e.target.closest && e.target.closest('#mobNav .mob-nav-btn[data-panel]');
  if (nb) navTap = { name: nb.dataset.panel, t: Date.now() };
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

// ── Check draw (shift tasks, monthly reports, night checklist, handover) ──
// A tick draws its check in (stroke) with a tiny scale pop. Lists are often drawn
// again right after a tick (save + live update), so it follows the newest copy of
// the row for a short while and carries on from where it was, never starting again.
const TICKS = [
  // [what was tapped, the row, the row's id attributes, the check inside the row]
  ['.st-check', '.st-item', ['data-id', 'data-key'], '.st-check'],
  ['.st-check', '.mr-row', null, '.st-check'],
  ['.cl-step-main', '.cl-step', ['data-cl-id'], '.cl-check'],
  ['.hb-ck', '.hb-it', ['data-key'], '.hb-ck'],
];
function onClick(e) {
  lastInput = Date.now();
  setTimeout(checkMilestones, 400);
  const t = e.target; if (!t || !t.closest) return;
  for (const [tap, rowSel, attrs, ckSel] of TICKS) {
    const c = t.closest(tap); if (!c) continue;
    const row = c.closest(rowSel); if (!row) continue;
    if (row.classList.contains('done')) return;   // un-ticking: no draw
    let find;
    if (attrs) { const sel = rowSel + attrs.map(a => `[${a}="${CSS.escape(row.getAttribute(a) || '')}"]`).join(''); find = () => document.querySelector(sel); }
    else { const nm = (row.querySelector('.mr-name') || {}).textContent; find = () => [...document.querySelectorAll(rowSel)].find(r => (r.querySelector('.mr-name') || {}).textContent === nm); }
    pendPop = { find, ckSel, t0: Date.now(), at: 0, last: null };
    setTimeout(runPop, 0);
    return;
  }
}
let pendPop = null;
function runPop() {
  const pp = pendPop; if (!pp) return;
  if (Date.now() - pp.t0 > 900) { pendPop = null; return; }
  const row = pp.find();
  if (!row || row === pp.last || !row.classList.contains('done')) return;
  pp.last = row;
  if (!enabled()) return;
  if (!pp.at) pp.at = Date.now();
  drawCheck(row.querySelector(pp.ckSel), Date.now() - pp.at);
}
const SVG_NS = 'http://www.w3.org/2000/svg';
function checkSvg(cls) {
  const s = document.createElementNS(SVG_NS, 'svg'); s.setAttribute('viewBox', '0 0 16 16'); s.setAttribute('class', cls); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG_NS, 'path'); p.setAttribute('d', 'M3.2 8.6l3.1 3.1L12.9 4.6'); p.setAttribute('pathLength', '1');
  s.appendChild(p); return s;
}
/** draw the check in `ck`, `elapsed` ms into the animation (a redrawn row carries on) */
function drawCheck(ck, elapsed) {
  if (!ck || !ck.animate || elapsed > 320) return;
  const L = level();
  const svg = checkSvg('mo-ck');
  ck.classList.add('mo-drawing'); ck.appendChild(svg);
  const end = () => { svg.remove(); ck.classList.remove('mo-drawing'); };
  try {
    const d = svg.firstChild.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: durFor(L, 260), delay: 30, easing: EASE, fill: 'backwards' });
    d.currentTime = elapsed;
    d.onfinish = end; d.oncancel = end;
    if (L === 'full') { const a = ck.animate([{ scale: .84 }, { scale: 1.1, offset: .55 }, { scale: 1 }], { duration: 300, easing: EASE }); a.currentTime = elapsed; }
  } catch (_) { end(); return; }
  setTimeout(end, 700);   // safety
}
function pop(el, cls) {
  if (!el) return; cls = cls || 'mo-pop';
  el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
  const end = e => { if (e.target !== el) return; el.removeEventListener('animationend', end); el.classList.remove(cls); };
  el.addEventListener('animationend', end);
}

// ── Count-up numbers ──────────────────────────────────────
const NUM_SEL = '.kpi-val, .dp-kpi-val, .home-big, #depRingNum, .gp-num, .stc-num, .cl-num, .mu-kpis b, .op-tile-n';
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
let pendNums = new Set(), pendRows = new Set(), pendItems = new Set(), queued = false;
const SKEL_SEL = '.gs-empty, .hist-empty, .hb-empty, .mu-empty, .dtc-loading, .adg-loading';
function onMut(recs) {
  for (const m of recs) {
    const t = m.target.nodeType === 3 ? m.target.parentElement : m.target;
    if (t && t.closest) { const n = t.closest(NUM_SEL); if (n) pendNums.add(n); }
    for (const a of m.addedNodes) {
      if (a.nodeType !== 1) continue;
      if (a.matches(NUM_SEL)) pendNums.add(a);
      if (a.matches(ROW_SEL)) pendRows.add(a);
      if (a.matches(ITEM_SEL)) pendItems.add(a);
      if (a.matches('.panel')) watchPanel(a);
      if (a.matches('.modal-bg')) watchModal(a);
      if (a.matches(SKEL_SEL) && /^\s*Loading/i.test(a.textContent || '')) a.classList.add('mo-skel');
      if (a.firstElementChild) {
        a.querySelectorAll(NUM_SEL).forEach(x => pendNums.add(x));
        a.querySelectorAll(ROW_SEL).forEach(x => pendRows.add(x));
        a.querySelectorAll(ITEM_SEL).forEach(x => pendItems.add(x));
        a.querySelectorAll('.modal-bg').forEach(watchModal);
      }
    }
  }
  if ((pendNums.size || pendRows.size || pendItems.size || pendPop) && !queued) { queued = true; requestAnimationFrame(flush); }
  scheduleMilestones();
}
function flush() {
  queued = false;
  const nums = pendNums, rows = pendRows, items = pendItems; pendNums = new Set(); pendRows = new Set(); pendItems = new Set();
  nums.forEach(n => { if (n.isConnected) try { onNumber(n); } catch (_) {} });
  if (rows.size) try { scanRows([...rows]); } catch (_) {}
  if (items.size) try { scanItems([...items]); } catch (_) {}
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
        text: `All done · all ${rs.length} departures out` };
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
  if (full()) confetti();
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
  for (const m of recs) {
    for (const a of m.addedNodes) {
      if (a.nodeType !== 1) continue;
      if (a.id === 'blBubble' && enabled()) { const f = document.querySelector('.br-fab'); if (f) pop(f, 'mo-hop'); }
      if (a.id === 'appToast') watchToast(a);
      try { onBodyAdd(a); } catch (_) {}
    }
    for (const a of m.removedNodes) try { onBodyRemove(a); } catch (_) {}
  }
}
let toastObs = null;
function watchToast(t) {
  if (!t || t._moObs) return; t._moObs = true;
  toastObs = toastObs || new MutationObserver(recs => { const t2 = recs[0] && recs[0].target; if (t2 && t2.nodeType === 1) onToast(t2.closest('#appToast') || t2); });
  toastObs.observe(t, { childList: true });
  onToast(t);
}

// ── Page switch ───────────────────────────────────────────
// The page that becomes .active fades in and rises 7 px (Subtle: fade only). On a phone,
// a tap on the bottom bar slides it 14 px from the side of the tab you tapped.
// The DOM change itself is never delayed (no View Transition snapshot, which would
// hold the update for a frame and swallow taps while it plays): the animation starts
// in the same frame, on the new page only, and leaves nothing behind when it ends.
let curPanel = null, navTap = null, panelAnim = null;
const panelSeen = new Set();
function mobBtn(id) { return id ? document.querySelector(`#mobNav .mob-nav-btn[data-panel="${CSS.escape(id.replace(/^panel-/, ''))}"]`) : null; }
function onPanelClass() {
  const now = document.querySelector('.panel.active');
  if (!now || now === curPanel) return;
  const prev = curPanel; curPanel = now;
  if (!prev || !enabled()) { panelSeen.add(now.id); return; }
  try { animatePanel(now, prev); } catch (_) {}
  try { firstShow(now); } catch (_) {}
}
function animatePanel(el, prev) {
  if (!el.animate) return;
  const L = level();
  let dx = 0, dy = distFor(L, 7);
  if (navTap && Date.now() - navTap.t < 1200 && innerWidth <= 900 && 'panel-' + navTap.name === el.id) {
    const a = mobBtn(prev.id), b = mobBtn(el.id);
    if (a && b && a !== b && a.offsetParent && b.offsetParent) { dx = distFor(L, 14) * (b.getBoundingClientRect().left > a.getBoundingClientRect().left ? 1 : -1); dy = 0; }
  }
  navTap = null;
  if (panelAnim) try { panelAnim.cancel(); } catch (_) {}
  panelAnim = el.animate([{ opacity: 0, translate: `${dx}px ${dy}px` }, { opacity: 1, translate: '0 0' }], { duration: durFor(L, dx ? 240 : 220), easing: EASE });
  panelAnim.onfinish = () => { panelAnim = null; };
}

// ── Lists and cards: stagger in the FIRST time they show ──
// Many pages redraw their lists with innerHTML every few seconds. Each list is keyed by
// a stable key (room number, task id, …): the first time a list shows it staggers in
// (12 × 20 ms max, only what is on screen); the same items drawn again never animate;
// 1–3 items that are really new fade in on their own.
const txtKey = el => {
  const d = el.dataset || {};
  const k = d.room || d.id || d.key || d.clId || el.id;
  if (k) return k;
  const head = el.cells && el.cells[0] ? el.cells[0] : el;
  let t = (head.textContent || '').replace(/[\d.,:%+\-–]+/g, '#').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!t.replace(/#/g, '').trim() && el.querySelectorAll) t = [...el.querySelectorAll('input')].slice(0, 3).map(i => i.value).join('|');
  return t;
};
const ITEMS = [
  { name: 'dep', sel: '#depGrid .dp-card', key: el => el.dataset.room },
  { name: 'arr', sel: '#arrTable > tr, #arrCards > *' },
  { name: 'hb', sel: '#hbRoot .hb-it', key: el => el.dataset.key || txtKey(el) },
  { name: 'st', sel: '.st-item', sub: el => el.dataset.key || '', row: true },
  { name: 'cl', sel: '.cl-step', key: el => el.dataset.clId },
  { name: 'ro', sel: '#panel-roster tbody > tr' },
  { name: 'op', sel: '#opRoot .op-card', key: el => el.className.split(/\s+/).slice(0, 2).join('.') },
  { name: 'home', sel: '.home-tile', key: el => el.getAttribute('onclick') || txtKey(el) },
  { name: 'tile', sel: '.rk-kpi, .rk-allc, .rh-tile, .rr-card, .rt-row, .hd-row, .ev-row, .xref-row' },
  { name: 'hs', sel: '#hsBody > .hs-sec', key: el => el.id },
  { name: 'wk', sel: '.wk-row', row: true },
  { name: 'mr', sel: '.mr-row', row: true },
];
const ITEM_SEL = ITEMS.map(d => d.sel).join(', ');
const seen = createSeen();
const animated = new WeakSet();
function itemDef(el) { for (const d of ITEMS) if (el.matches(d.sel)) return d; return null; }
function panelLive(el) { const p = el.closest('.panel'); return !p || p.classList.contains('active'); }
function onScreen(els) {
  const H = innerHeight, rs = els.map(e => e.getBoundingClientRect());   // reads first, in one go
  return els.filter((e, i) => rs[i].width > 0 && rs[i].height > 0 && rs[i].bottom > 0 && rs[i].top < H);
}
function staggerIn(els, base) {
  const L = level(), plan = staggerPlan(els.length, L);
  plan.forEach((delay, i) => {
    const el = els[i]; if (animated.has(el) || !el.animate) return;
    animated.add(el);
    el.animate([{ opacity: 0, translate: '0 8px' }, { opacity: 1, translate: '0 0' }], { duration: 240, delay: (base || 0) + delay, easing: EASE, fill: 'backwards' });
  });
}
function enterIn(el) {
  if (animated.has(el) || !el.animate) return; animated.add(el);
  const L = level();
  el.animate([{ opacity: 0, translate: `0 ${distFor(L, 6)}px` }, { opacity: 1, translate: '0 0' }], { duration: durFor(L, 220), easing: EASE });
}
function scanItems(nodes, quiet) {
  const groups = new Map();
  for (const n of nodes) {
    if (!n.isConnected) continue;
    const d = itemDef(n); if (!d) continue;
    const p = n.closest('.panel');
    const g = d.name + '|' + (p ? p.id : '') + (d.sub ? '|' + d.sub(n) : '');
    if (!groups.has(g)) groups.set(g, { d, els: [] });
    groups.get(g).els.push(n);
  }
  groups.forEach(({ d, els }, g) => {
    const keyOf = d.key || txtKey;
    const keys = els.map(e => { try { return keyOf(e); } catch (_) { return ''; } });
    const { first, fresh } = seen.note(g, keys);
    if (quiet || !enabled() || !panelLive(els[0])) return;
    if (first) { if (full()) staggerIn(onScreen(els.slice(0, 40))); return; }
    if (d.row || !fresh.length || fresh.length > 3) return;   // .st-item / .wk-row / .mr-row have their own glow
    const f = new Set(fresh);
    els.forEach((e, i) => { if (f.has(keys[i])) enterIn(e); });
  });
}
// the first time a page opens this session, what is already drawn on it staggers in after the page rise
function firstShow(panel) {
  if (panelSeen.has(panel.id)) return;
  panelSeen.add(panel.id);
  if (!full()) return;
  const els = onScreen([...panel.querySelectorAll(ITEM_SEL)].slice(0, 40));
  if (els.length) staggerIn(els, 50);
}

// ── A room checked out: soft green pulse, then it settles ──
// If the card stays on the list (the "Checked out" or a search view), departures.js marks it
// .dp-flash and the CSS above turns that into a green pulse. On the usual list the room leaves
// at once, so a see-through copy of the card plays the pulse where it was and fades away.
let pendOut = null;
function onCheckoutTap(e) {
  const b = e.target.closest && e.target.closest('#depGrid .dp-card .dca-co');
  if (!b) return;
  const card = b.closest('.dp-card');
  if (!card || card.classList.contains('dp-s-out')) return;
  pendOut = { room: card.dataset.room, rect: card.getBoundingClientRect(), copy: card.cloneNode(true), t: Date.now() };
  [80, 400, 1000].forEach(ms => setTimeout(checkOut, ms));
}
function checkOut() {
  const po = pendOut; if (!po) return;
  if (Date.now() - po.t > 1600) { pendOut = null; return; }
  let out = false;
  try { const r = typeof depRooms !== 'undefined' && depRooms.find(x => x.roomStr === po.room); out = !!r && r.status === 'out'; } catch (_) {}   // eslint-disable-line no-undef
  if (!out) return;
  pendOut = null;
  const still = document.querySelector(`#depGrid .dp-card[data-room="${CSS.escape(po.room)}"]`);
  if (still || !enabled()) return;   // on the list: the .dp-flash pulse plays on it
  const host = document.getElementById('panel-departures'), r = po.rect;
  if (!host || !r.width || r.bottom < 0 || r.top > innerHeight) return;
  const g = po.copy;
  [g, ...g.querySelectorAll('*')].forEach(x => { if (x.id) x.removeAttribute('id'); for (const a of [...x.attributes]) if (/^on/i.test(a.name)) x.removeAttribute(a.name); });
  g.removeAttribute('data-room'); g.removeAttribute('data-st');   // never found as the room's card
  g.classList.remove('dp-flash', 'dp-enter'); g.classList.add('dp-s-out', 'mo-ghost');
  g.setAttribute('aria-hidden', 'true'); g.inert = true;
  g.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;margin:0;z-index:5;pointer-events:none;box-sizing:border-box`;
  host.appendChild(g);
  const L = level(), ring = 'color-mix(in srgb, var(--green) 55%, transparent)', soft = 'color-mix(in srgb, var(--green) 16%, transparent)';
  const kf = L === 'full'
    ? [{ boxShadow: `0 0 0 0 ${ring}`, scale: 1, opacity: 1 }, { boxShadow: `0 0 0 7px ${soft}`, scale: 1.01, opacity: 1, offset: .4 }, { boxShadow: '0 0 0 10px transparent', scale: .97, opacity: 0 }]
    : [{ boxShadow: `0 0 0 0 ${ring}`, opacity: 1 }, { boxShadow: '0 0 0 8px transparent', opacity: 0 }];
  try { const a = g.animate(kf, { duration: durFor(L, 560), easing: EASE, fill: 'forwards' }); a.onfinish = () => g.remove(); } catch (_) { g.remove(); }
  setTimeout(() => g.remove(), 900);
}

// ── Windows, sheets, toasts and menus ─────────────────────
// Windows (.modal-bg, and the full-screen overlays modules add to <body>): the backdrop
// fades, the window scales up from .96, and on close a short see-through copy plays it in
// reverse (it can't be tapped, has no ids or handlers, and is gone in ~160 ms) — the
// real window is already closed, so nothing waits for the animation.
const ovShown = new WeakMap();   // window / menu → when it showed
function dialogOf(el) {
  const W = innerWidth, H = innerHeight;
  let best = null, area = 0;
  for (const k of el.children) {
    const r = k.getBoundingClientRect(), a = r.width * r.height;
    if (a > area && (r.width < W * .98 || r.height < H * .98)) { best = k; area = a; }
  }
  return best;
}
function popIn(dlg, L) {
  if (!dlg || !dlg.animate || (dlg.getAnimations && dlg.getAnimations().length)) return;
  const r = dlg.getBoundingClientRect(), sheet = r.bottom >= innerHeight - 2 && r.width >= innerWidth * .95;
  const from = L === 'full' ? (sheet ? { opacity: 0, translate: '0 28px' } : { opacity: 0, scale: .96, translate: '0 6px' }) : { opacity: 0 };
  dlg.animate([from, { opacity: 1, scale: 1, translate: '0 0' }], { duration: durFor(L, sheet ? 280 : 240), easing: EASE });
}
function overlayIn(el) {
  if (!enabled() || !el.animate) return;
  const L = level();
  ovShown.set(el, Date.now());
  if (!(el.getAnimations && el.getAnimations().length)) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: durFor(L, 200), easing: 'ease-out' });
  popIn(dialogOf(el), L);
}
function ghostOut(el, open) {
  if (!enabled() || !el.cloneNode || !document.body) return;
  const L = level(), g = el.cloneNode(true);
  // a copy you can't use: no ids, no handlers, no dialog role, can't be focused or tapped
  [g, ...g.querySelectorAll('*')].forEach(x => {
    if (x.id) x.removeAttribute('id');
    for (const a of [...x.attributes]) if (/^on/i.test(a.name) || a.name === 'role' || a.name === 'aria-modal' || a.name === 'for') x.removeAttribute(a.name);
  });
  const src = el.querySelectorAll('input, textarea, select'), dst = g.querySelectorAll('input, textarea, select');
  src.forEach((x, i) => { try { if (dst[i] && x.type !== 'file') { dst[i].value = x.value; if ('checked' in x) dst[i].checked = x.checked; } } catch (_) {} });
  if (open) g.classList.add(open);
  g.classList.add('mo-ghost'); g.setAttribute('aria-hidden', 'true'); g.inert = true;
  g.style.pointerEvents = 'none';
  if (el.parentNode) el.after(g); else document.body.appendChild(g);   // same place = same styles
  const dur = durFor(L, 160);
  const dlg = dialogOf(g);
  try {
    const a = g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur, easing: 'ease-in', fill: 'forwards' });
    if (L === 'full' && dlg && dlg.animate) dlg.animate([{ scale: 1 }, { scale: .97, translate: '0 4px' }], { duration: dur, easing: 'ease-in', fill: 'forwards' });
    a.onfinish = () => g.remove();
  } catch (_) { g.remove(); }
  setTimeout(() => g.remove(), dur + 250);
}
const modalSeen = new WeakSet();
function watchModal(m) {
  if (modalSeen.has(m)) return; modalSeen.add(m);
  modalObs = modalObs || new MutationObserver(onModalClass);
  modalObs.observe(m, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
}
let modalObs = null;
function onModalClass(recs) {
  for (const r of recs) {
    const m = r.target, was = /(^|\s)open(\s|$)/.test(r.oldValue || ''), is = m.classList.contains('open');
    if (was === is || m.classList.contains('mo-ghost')) continue;
    try { if (is) overlayIn(m); else ghostOut(m, 'open'); } catch (_) {}
  }
}
const TOAST_RE = /toast|snack|undo/i;
function onBodyAdd(el) {
  if (!enabled() || el.nodeType !== 1 || animated.has(el)) return;
  if (el.id === 'moConfetti' || el.classList.contains('mo-cele') || el.classList.contains('mo-ghost') || el.id === 'blBubble' || /^(SCRIPT|STYLE|LINK|CANVAS|IFRAME)$/.test(el.tagName)) return;
  if (el.classList.contains('modal-bg')) { watchModal(el); if (!el.classList.contains('open')) return; }
  const cs = getComputedStyle(el);
  if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') return;
  if (el.getAnimations && el.getAnimations().length) return;   // it has its own entrance
  const r = el.getBoundingClientRect(); if (!r.width || !r.height) return;
  const W = innerWidth, H = innerHeight, L = level();
  animated.add(el);
  if (r.width >= W * .9 && r.height >= H * .9) { overlayIn(el); return; }
  const role = el.getAttribute('role') || '';
  if (role === 'status' || role === 'alert' || TOAST_RE.test(el.id + ' ' + el.className)) {
    const up = r.top > H / 2;
    el.animate([{ opacity: 0, translate: `0 ${distFor(L, up ? 12 : -10)}px` }, { opacity: 1, translate: '0 0' }], { duration: durFor(L, 240), easing: EASE });
    return;
  }
  if (r.width * r.height < W * H * .45) {   // a menu / pop-up near what opened it
    el.animate([L === 'full' ? { opacity: 0, scale: .96, transformOrigin: 'top center' } : { opacity: 0 }, { opacity: 1, scale: 1, transformOrigin: 'top center' }], { duration: durFor(L, 170), easing: EASE });
    ovShown.set(el, Date.now());
    return;
  }
  el.animate([{ opacity: 0, translate: `0 ${distFor(L, 8)}px` }, { opacity: 1, translate: '0 0' }], { duration: durFor(L, 220), easing: EASE });
  ovShown.set(el, Date.now());
}
function onBodyRemove(el) {
  if (el.nodeType !== 1 || !ovShown.has(el) || el.isConnected) return;   // still in the page = it was only moved
  const at = ovShown.get(el); ovShown.delete(el);
  if (Date.now() - at < 120) return;   // a flash of a pop-up (a tooltip, a drag image): no exit
  if (!el.id || el.className) ghostOut(el);   // a window styled only by its id would look wrong without it: let it go at once
}

// ── "Saved ✓": the save toast gets a tick that draws itself ──
function onToast(t) {
  if (!t || t.querySelector('.mo-ok')) return;
  if (!/\bsaved\b/i.test(t.textContent || '')) return;
  t.insertBefore(checkSvg('mo-ok'), t.firstChild);
}

// ── Settings → Appearance → Animations: Full · Subtle · Off ──
function choice() { return levelFrom({ still: !!(document.body && document.body.classList.contains('ho-still')), ls: userOff ? 'off' : lsGet(LS_KEY) }); }
function setLevel(l) {
  if (l !== 'full' && l !== 'subtle' && l !== 'off') return;
  userOff = l === 'off';
  lsSet(LS_KEY, l === 'full' ? null : l);
  // "Off" is the app's own motion switch too (body.ho-still stops every CSS animation)
  try { if (typeof hoSetPref === 'function' && typeof hoPref === 'function' && hoPref('motion') !== (l !== 'off')) hoSetPref('motion', l !== 'off'); } catch (_) {}
  syncClass();
  if (l === 'off') { const c = document.getElementById('moConfetti'); if (c) c.remove(); }
  paintRow();
}
function rowHtml() {
  const c = choice(), rm = RM.matches;
  const b = (v, t) => `<button type="button" class="${c === v ? 'on' : ''}" data-mo-level="${v}" aria-pressed="${c === v}">${t}</button>`;
  return `<span class="hs-txt"><b>Animations</b><small>${rm ? 'Your device asks for less motion, so HotelOps stays still whatever you pick here' : 'Full: pages and lists glide in · Subtle: short fades only · Off: no movement. Off helps a slow PC'}</small></span>
    <span class="hs-seg">${b('full', 'Full')}${b('subtle', 'Subtle')}${b('off', 'Off')}</span>`;
}
function paintRow() { const r = document.getElementById('moLevelRow'); if (r) r.innerHTML = rowHtml(); }
function mountRow() {
  try {
    const box = document.getElementById('hsBody'); if (!box || document.getElementById('moLevelRow')) return;
    const inp = box.querySelector('input[onchange*="hoSetPref(\'motion\'"]'); if (!inp) return;
    const old = inp.closest('.hs-row'); if (!old) return;
    const row = document.createElement('div');
    row.className = 'hs-row'; row.id = 'moLevelRow';
    row.setAttribute('data-s', 'animations motion movement full subtle off reduce slow');
    row.innerHTML = rowHtml();
    if (old.style.display) row.style.display = old.style.display;   // the settings search hid it
    old.replaceWith(row);
  } catch (_) {}
}
function onLevelClick(e) {
  const b = e.target.closest && e.target.closest('[data-mo-level]');
  if (b) setLevel(b.dataset.moLevel);
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
  // pages: watch which one is .active
  curPanel = document.querySelector('.panel.active');
  if (curPanel) panelSeen.add(curPanel.id);
  document.querySelectorAll('.panel').forEach(watchPanel);
  // lists already on screen count as seen (no stagger for what was drawn before this file ran)
  try { const now = [...main.querySelectorAll(ITEM_SEL)]; if (now.length) scanItems(now, true); } catch (_) {}
  // windows
  document.querySelectorAll('.modal-bg').forEach(watchModal);
  watchToast(document.getElementById('appToast'));
  // Settings row
  document.addEventListener('click', onLevelClick);
  document.addEventListener('click', onCheckoutTap, true);
  const hs = document.getElementById('hsBody');
  if (hs) { new MutationObserver(mountRow).observe(hs, { childList: true }); mountRow(); }
  checkMilestones();   // learn the current states (no celebration on load)
}
let panelObs = null;
function watchPanel(p) {
  if (!p || p._moWatch) return; p._moWatch = true;
  panelObs = panelObs || new MutationObserver(onPanelClass);
  panelObs.observe(p, { attributes: true, attributeFilter: ['class'] });
}

window.hoMotion = {
  on() { setLevel('full'); },
  off() { setLevel('off'); },
  level,
  setLevel,
  celebrate,
  enabled,
  _pure: { levelFrom, durFor, distFor, staggerPlan, createSeen },
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
