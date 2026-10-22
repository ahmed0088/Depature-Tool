// ═══════════════════════════════════════════════════════════
//  hotel-setup.js — this hotel's own setup, changed in Settings
//
//  Times (check-out, check-in, "extending must finish by"), shift names
//  and hours, the menu (order, groups, pages hidden for everyone), the
//  Handover and HK request categories and the Departures words are all
//  read from here, so another hotel can use HotelOps as it works there
//  without anyone changing the code.
//
//  Saved per hotel in Firebase (settings/setup), only what differs from
//  the defaults. Every module asks through window.hoCfg and falls back to
//  the defaults when nothing is saved, so nothing changes until someone
//  changes it. The Settings page is in the second half of this file.
// ═══════════════════════════════════════════════════════════
(function (W) {
'use strict';

const PATH = 'settings/setup';
const LS = 'ibis_settings_setup';        // the same copy db.js keeps for settings/setup (per hotel)

const DEFAULTS = {
  profile: {
    shortName: '', city: 'Dubai, UAE', group: 'Accor brands: ibis, Mercure, Adagio', timezone: 'Asia/Dubai',
    checkout: '12:00', checkin: '15:00', extendBy: '18:00', lcoDefault: '',
    pool: '08:00 – 19:00 (8 AM to 7 PM)', gym: 'Open 24 hours. Guests get in with their room key.', bar: 'On the rooftop and on the first floor.',
  },
  shifts: {
    followRoster: true,
    morning: { label: 'Morning', icon: '🌅', from: '07:00', to: '15:00' },
    afternoon: { label: 'Afternoon', icon: '🌇', from: '15:00', to: '23:00' },
    night: { label: 'Night', icon: '🌙', from: '23:00', to: '07:00' },
  },
  menu: { groups: null, hidden: [] },
  cats: { ho: {}, hk: {} },
  dep: {
    intents: {}, overdueAlert: true, overdueSound: true,
    lcoTimes: ['10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00', '15:00', '16:00', '18:00'],
  },
};
const SHIFT_KEYS = ['morning', 'afternoon', 'night'];
const SECTIONS = Object.keys(DEFAULTS);

// ── Pure helpers (tested in tests/run-tests.js) ───────────
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const clone = v => (v == null ? v : JSON.parse(JSON.stringify(v)));
/** "7:05" / "07:05" → 425; anything else → null */
function toMin(t) {
  const m = String(t == null ? '' : t).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return +m[1] * 60 + +m[2];
}
const hhmm = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
/** 1080 → "6 PM", 1110 → "6:30 PM", 720 → "12 PM" */
function ampm(m, long) {
  if (m == null) return '';
  const h = Math.floor(m / 60) % 24, mm = m % 60, h12 = h % 12 || 12, ap = h < 12 ? 'AM' : 'PM';
  return long || mm ? `${h12}:${String(mm).padStart(2, '0')} ${ap}` : `${h12} ${ap}`;
}
/** a saved value laid over the default of the same shape; wrong types and bad times fall back */
function mergeVal(def, v) {
  if (v === undefined || v === null) return clone(def);
  if (Array.isArray(def) || def === null) return Array.isArray(v) || isObj(v) ? clone(v) : clone(def);
  if (isObj(def)) {
    if (!isObj(v)) return clone(def);
    const out = {};
    Object.keys(def).forEach(k => { out[k] = mergeVal(def[k], v[k]); });
    Object.keys(v).forEach(k => { if (!(k in def)) out[k] = clone(v[k]); });   // open maps (categories, intents)
    return out;
  }
  if (typeof def === 'boolean') return typeof v === 'boolean' ? v : def;
  if (typeof def === 'number') return typeof v === 'number' && isFinite(v) ? v : def;
  if (typeof def === 'string') {
    if (typeof v !== 'string') return def;
    if (/^\d{2}:\d{2}$/.test(def) && toMin(v) == null) return def;     // a time must stay a time
    return v;
  }
  return clone(v);
}
/** the whole setup: defaults with what the hotel saved on top */
function merge(saved) {
  const s = isObj(saved) ? saved : {};
  const out = {};
  SECTIONS.forEach(k => { out[k] = mergeVal(DEFAULTS[k], s[k]); });
  if (!Array.isArray(out.menu.hidden)) out.menu.hidden = isObj(out.menu.hidden) ? Object.values(out.menu.hidden) : [];
  if (out.menu.groups && !Array.isArray(out.menu.groups)) out.menu.groups = Object.values(out.menu.groups);
  if (!Array.isArray(out.dep.lcoTimes)) out.dep.lcoTimes = isObj(out.dep.lcoTimes) ? Object.values(out.dep.lcoTimes) : DEFAULTS.dep.lcoTimes.slice();
  out.dep.lcoTimes = out.dep.lcoTimes.filter(t => toMin(t) != null);
  if (!out.dep.lcoTimes.length) out.dep.lcoTimes = DEFAULTS.dep.lcoTimes.slice();
  return out;
}
/** the three shifts as handover-book uses them: [{ id: 'Morning', key, label, icon, from, to }] (minutes) */
function shiftBounds(shifts) {
  const S = mergeVal(DEFAULTS.shifts, shifts);
  return SHIFT_KEYS.map(k => {
    const d = DEFAULTS.shifts[k], s = S[k] || d;
    const from = toMin(s.from), to = toMin(s.to);
    return { id: d.label, key: k, label: String(s.label || '').trim() || d.label, icon: s.icon || d.icon,
      from: from == null ? toMin(d.from) : from, to: to == null ? toMin(d.to) : to };
  });
}
/** minutes after midnight → the shift key it falls in ('' when none) */
function shiftAt(bounds, m) {
  const b = (bounds || []).find(x => (x.from < x.to ? m >= x.from && m < x.to : x.from !== x.to && (m >= x.from || m < x.to)));
  return b ? b.key : '';
}
/** hours no shift covers, and hours two shifts cover: { gaps: [[from, to]], overlaps: [[from, to]] } (minutes) */
function shiftCheck(bounds) {
  const cover = new Array(1440).fill(0);
  (bounds || []).forEach(b => { if (b.from === b.to) return; for (let m = b.from; m !== b.to; m = (m + 1) % 1440) cover[m]++; });
  const runs = test => { const out = []; let s = -1; for (let m = 0; m <= 1440; m++) { const on = m < 1440 && test(cover[m]); if (on && s < 0) s = m; if (!on && s >= 0) { out.push([s, m]); s = -1; } } return out; };
  return { gaps: runs(c => c === 0), overlaps: runs(c => c > 1) };
}
/**
 * The side menu's groups from the defaults and the hotel's menu setup:
 * [{ id, title, pages }]. Groups and pages come in the saved order; a page the
 * setup does not mention (a new page in a later version) goes to the end of its
 * default group, so it never disappears.
 */
function navPlan(defs, menu) {
  const D = (defs || []).map(g => ({ id: g.id, title: g.title, pages: (g.pages || []).slice() }));
  const groups = menu && Array.isArray(menu.groups) ? menu.groups.filter(g => g && g.id) : [];
  if (!groups.length) return D;
  const seen = new Set(), out = [];
  groups.forEach(g => {
    if (out.some(x => x.id === g.id)) return;
    const def = D.find(x => x.id === g.id);
    const pages = (Array.isArray(g.pages) ? g.pages : isObj(g.pages) ? Object.values(g.pages) : []).filter(p => typeof p === 'string' && p && !seen.has(p) && seen.add(p));
    out.push({ id: g.id, title: String(g.title || '').trim() || (def ? def.title : 'Group'), pages });
  });
  D.forEach(d => {
    const rest = d.pages.filter(p => !seen.has(p));
    let g = out.find(x => x.id === d.id);
    if (!g) { if (!rest.length) return; g = { id: d.id, title: d.title, pages: [] }; out.push(g); }
    rest.forEach(p => { seen.add(p); g.pages.push(p); });
  });
  return out;
}
/** "shuttle, bus to mall" → /\b(?:shuttle|bus\s+to\s+mall)\b/ (null when there are no words) */
function wordsRe(words) {
  const L = (Array.isArray(words) ? words : String(words || '').split(/[,;\n]+/)).map(w => String(w).trim().toLowerCase()).filter(w => w.length >= 2);
  if (!L.length) return null;
  return new RegExp('(?:^|[^a-z0-9])(?:' + L.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')).join('|') + ')(?![a-z0-9])', 'i');
}
/** what to copy to another hotel: everything but this hotel's own name */
function forNewHotel(setup) {
  const s = clone(isObj(setup) ? setup : {});
  if (isObj(s.profile)) { delete s.profile.shortName; delete s.profile.name; }
  return s;
}
/** a setup file → { setup, td, balOk } or throws (only known sections and fields are kept) */
function readFile(text) {
  const d = typeof text === 'string' ? JSON.parse(text) : text;
  if (!d || d.hotelops !== 'setup' || !isObj(d.setup)) throw new Error('not a HotelOps setup file');
  const setup = {};
  SECTIONS.forEach(k => { if (d.setup[k] !== undefined) setup[k] = mergeVal(DEFAULTS[k], d.setup[k]); });
  const td = isObj(d.td) ? d.td : null;
  const balOk = Array.isArray(d.balOk) ? d.balOk.map(x => String(x || '').toLowerCase().trim()).filter(Boolean) : null;
  return { setup: forNewHotel(setup), td, balOk };
}

// ── State and live updates ────────────────────────────────
let saved = (() => { try { return JSON.parse(localStorage.getItem(LS) || 'null') || {}; } catch (_) { return {}; } })();
let cur = merge(saved);
let version = 1;
const subs = [], hooks = [];
function changed(from) {
  cur = merge(saved); version++;
  hooks.forEach(h => { try { h(); } catch (e) { console.warn('[setup] hook', e); } });
  try { applyAll(); } catch (e) { console.warn('[setup] apply', e); }
  subs.forEach(f => { try { f(cur, from); } catch (_) {} });
}

const api = {
  DEFAULTS, PATH,
  get(section) { return section ? cur[section] : cur; },
  saved() { return clone(saved); },
  version: () => version,
  /** save one section (null = back to the defaults), shared with the team */
  set(section, value) {
    if (!SECTIONS.includes(section)) return;
    saved = Object.assign({}, saved);
    if (value == null) delete saved[section]; else saved[section] = clone(value);
    try { localStorage.setItem(LS, JSON.stringify(saved)); } catch (_) {}
    if (typeof fbSet === 'function') fbSet(PATH + '/' + section, value == null ? null : clone(value));
    changed('me');
  },
  /** change some fields of a section */
  patch(section, fields) { api.set(section, Object.assign({}, saved[section] || {}, fields)); },
  /** replace everything (import): sections not in obj go back to the defaults unless keep */
  replace(obj, keep) {
    saved = Object.assign({}, keep ? saved : {}, clone(obj || {}));
    try { localStorage.setItem(LS, JSON.stringify(saved)); } catch (_) {}
    if (typeof fbSet === 'function') fbSet(PATH, Object.keys(saved).length ? clone(saved) : null);
    changed('me');
  },
  on(fn) { subs.push(fn); },
  listen() {
    if (typeof fbListen !== 'function') return;
    fbListen(PATH, v => {
      const nv = isObj(v) ? v : {};
      if (JSON.stringify(nv) === JSON.stringify(saved)) return;
      saved = nv;
      try { localStorage.setItem(LS, JSON.stringify(saved)); } catch (_) {}
      changed('team');
    });
  },
  // ── what the modules ask ──
  min: toMin, ampm, hhmm,
  checkoutMin() { const m = toMin(cur.profile.checkout); return m == null ? 720 : m; },
  checkinMin() { const m = toMin(cur.profile.checkin); return m == null ? 900 : m; },
  extendByMin() { const m = toMin(cur.profile.extendBy); return m == null ? 1080 : m; },
  shiftBounds: () => shiftBounds(cur.shifts),
  shiftLabel(key) { const b = shiftBounds(cur.shifts).find(x => x.key === key); return b ? b.label : ''; },
  /** { morning: '07:00 - 15:00', … } — the fallback hours when the roster has none */
  shiftRanges() { const o = {}; shiftBounds(cur.shifts).forEach(b => { o[b.key] = `${hhmm(b.from)} - ${hhmm(b.to)}`; }); return o; },
  followRoster: () => cur.shifts.followRoster !== false,
  hiddenForAll: () => (cur.menu.hidden || []).filter(p => p !== 'settings' && p !== 'home'),
  intent: k => (cur.dep.intents || {})[k] || null,
  _catDefaults: {},
  /**
   * A module's categories follow the setup: CATS (list) and CAT (by id) are changed in
   * place (names, emoji, colour, switched off, added) and the returned function gives
   * { words: [[id, RegExp]], off: Set } for the module's own matching.
   * row(id, setting) makes the list entry for a category the hotel added.
   */
  catHook(kind, list, map, toObj, row) {
    const base = list.map(c => c.slice()), baseMap = {};
    Object.keys(map).forEach(k => { baseMap[k] = Object.assign({}, map[k]); });
    api._catDefaults[kind] = baseMap;                       // the built-in names, for Settings
    let ver = -1, X = { words: [], off: new Set() };
    const apply = () => {
      ver = version;
      const o = (cur.cats && isObj(cur.cats[kind])) ? cur.cats[kind] : {};
      list.length = 0;
      base.forEach(c => { const s = o[c[0]] || {}; if (s.off) return; const n = c.slice(); if (s.label) n[1] = String(s.label); if (s.icon) n[2] = String(s.icon); list.push(n); });
      Object.keys(map).forEach(k => { if (!(k in baseMap)) delete map[k]; });
      Object.keys(baseMap).forEach(k => {
        const e = map[k] || (map[k] = {}), s = o[k] || {};
        Object.keys(e).forEach(f => delete e[f]);
        Object.assign(e, baseMap[k]);
        if (s.label) e.label = String(s.label);
        if (s.icon) e.icon = String(s.icon);
        if (typeof s.hue === 'number') e.hue = s.hue;
      });
      const words = [], off = new Set();
      Object.keys(o).forEach(id => {
        const s = o[id]; if (!isObj(s)) return;
        if (s.off) { off.add(id); return; }
        const re = wordsRe(s.words);
        if (s.custom && !baseMap[id] && String(s.label || '').trim()) {
          const r = row(id, s, re); list.push(r); map[id] = Object.assign(toObj(r), typeof s.hue === 'number' ? { hue: s.hue } : {});
        }
        if (re && map[id]) words.push([id, re]);
      });
      X = { words, off };
    };
    hooks.push(apply);
    apply();
    return () => { if (ver !== version) apply(); return X; };
  },
};
W.hoCfg = api;
W.hoSetupPure = { DEFAULTS, SHIFT_KEYS, toMin, ampm, hhmm, mergeVal, merge, shiftBounds, shiftAt, shiftCheck, navPlan, wordsRe, forNewHotel, readFile };
W.hoCheckoutMin = () => api.checkoutMin();
W.hoExtendByMin = () => api.extendByMin();

// ── Applied to modules that keep their words in tables ────
const _base = {};
function applyAll() {
  const D = typeof document !== 'undefined' ? document : null;
  // shift names on Shift Tasks, and the handover book's shift hours (its SHIFT_BOUNDS, changed in place)
  const B = shiftBounds(cur.shifts);
  if (typeof SHIFTS !== 'undefined') B.forEach(b => { if (SHIFTS[b.key]) SHIFTS[b.key].label = b.label + ' Shift'; });
  const SB = W.hoHandoverPure && W.hoHandoverPure.SHIFT_BOUNDS;
  if (Array.isArray(SB)) SB.forEach(x => { const b = B.find(y => y.id === x.id); if (b) { x.from = b.from; x.to = b.to; x.label = b.label; x.icon = b.icon; } });
  if (typeof rtApplyTaskTimes === 'function') { try { rtApplyTaskTimes(); } catch (_) {} }
  // Departures: what the guest said
  if (typeof INTENT_CONFIG !== 'undefined') {
    if (!_base.intents) { _base.intents = {}; Object.keys(INTENT_CONFIG).forEach(k => { _base.intents[k] = Object.assign({}, INTENT_CONFIG[k]); }); }
    Object.keys(_base.intents).forEach(k => {
      const s = (cur.dep.intents || {})[k] || {}, e = INTENT_CONFIG[k];
      Object.keys(e).forEach(f => delete e[f]); Object.assign(e, _base.intents[k]);
      if (s.label) { e.label = String(s.label); e.short = String(s.label); }
      if (s.icon) e.icon = String(s.icon);
    });
  }
  // Ops Brain's hotel facts
  if (typeof BR_FAQ !== 'undefined' && Array.isArray(BR_FAQ)) {
    const P = cur.profile, nm = P.shortName || (D && D.getElementById('hotelName') ? D.getElementById('hotelName').textContent.trim() : '') || 'the hotel';
    const find = (key, q) => {
      let f = BR_FAQ.find(x => x._setup === key);
      if (!f) { f = BR_FAQ.find(x => x.t === key); if (!f && q) { f = { q, t: key, a: '', go: '' }; BR_FAQ.push(f); } if (f) f._setup = key; }
      return f;
    };
    const set = (key, title, a) => { const f = find(key); if (f) { f.a = a; if (title) f.t = title; } };
    set('Pool timing', '', `🏊 The pool: <b>${esc(P.pool)}</b>.`);
    set('Gym', '', `🏋️ The gym: <b>${esc(P.gym)}</b>`);
    set('Bar at Ibis', `Bar at ${nm}`, `🍸 The bar at ${esc(nm)}: <b>${esc(P.bar)}</b>`);
    find('Check-in and check-out times', 'check in check out time checkout checkin hour standard what time leave room extending deadline');
    set('Check-in and check-out times', '', `🕑 Check-in from <b>${ampm(api.checkinMin(), 1)}</b>, check-out by <b>${ampm(api.checkoutMin(), 1)}</b>. A guest who extends finishes the booking, signature, TD and payment by <b>${ampm(api.extendByMin(), 1)}</b>.`);
  }
  if (!D) return;
  if (typeof W.hoNavOrder === 'function') W.hoNavOrder();
  if (typeof hoApplyPrefs === 'function') hoApplyPrefs();
  const active = id => D.getElementById('panel-' + id) && D.getElementById('panel-' + id).classList.contains('active');
  if (active('departures') && typeof depRender === 'function' && typeof depRooms !== 'undefined' && depRooms.length) depRender();
  if (active('home') && typeof homeRender === 'function') homeRender();
  if (active('settings') && typeof hoSettingsRender === 'function' && !(D.activeElement && D.activeElement.closest && D.activeElement.closest('#hsBody input, #hsBody select'))) hoSettingsRender();
}
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

if (typeof document !== 'undefined' && document.addEventListener) {
  const start = () => { try { applyAll(); } catch (_) {} setTimeout(() => { try { applyAll(); } catch (_) {} api.listen(); }, 1500); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else setTimeout(start, 0);
}

// ═══════════════════════════════════════════════════════════
//  Settings → Hotel setup (the page; settings.js puts it in place)
// ═══════════════════════════════════════════════════════════
const HSU_TZ = ['Asia/Dubai', 'Asia/Muscat', 'Asia/Qatar', 'Asia/Bahrain', 'Asia/Kuwait', 'Asia/Riyadh', 'Africa/Cairo', 'Europe/Istanbul', 'Europe/London', 'Europe/Paris', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Bangkok', 'Asia/Singapore', 'Australia/Sydney', 'America/New_York'];
const HSU_INTENTS = [['extending', 'Staying on, booking and payment still to do'], ['finance_hold', 'Left, Finance or Reservations still fixing the room'], ['maybe_extend', 'Might stay longer'],
  ['coming_back', 'Coming back later today'], ['returning', 'Has another booking'], ['pay_td', 'Coming to pay Tourism Dirham'], ['checkout_soon', 'Leaving in a few minutes']];
const HSU_TILES = [['departures', 'Departures'], ['arrivals', 'Arrivals'], ['purpose', 'Purpose of Stay'], ['dtcm', 'DTCM Recon'], ['package-audit', 'Package Audit'], ['checklist', 'Night Checklist'],
  ['shifts', 'Shift Tasks'], ['pipeline', 'ALL enrollment'], ['wakeups', 'Wake-up calls'], ['roster-build', 'Roster builder'], ['rates', 'Rates vs market'], ['roster', 'Your next shift']];
let hsuCatTab = 'ho';

function hsuCanEdit() {
  const me = (typeof currentProfile !== 'undefined' && currentProfile) || null;
  if (!me) return typeof currentUser === 'undefined';           // no sign-in at all (tests, local copy)
  if (me.role === 'owner') return true;
  try { return !!(typeof myRoleDef === 'function' && myRoleDef().canManageUsers); } catch (_) { return false; }
}
const _hsuIc = n => (typeof hoIcon === 'function' && hoIcon(n)) || '';
const _hsuDis = () => (hsuCanEdit() ? '' : ' disabled');
const _hsuReset = (sec, what) => `<div class="hs-row hs-mini hsu-foot"><span class="hs-txt"><small>${what}</small></span>${hsuCanEdit() ? `<button class="btn sm ghost" type="button" onclick="hsuReset('${sec}')">Reset to default</button>` : ''}</div>`;
const _hsuSec = (id, icon, title, sub, body) => (typeof _hoSec === 'function' ? _hoSec(id, icon, title, sub, body)
  : `<section class="hs-sec" id="hs-${id}"><div class="hs-sec-hd"><div><h2>${title}</h2><p>${sub}</p></div></div><div class="hs-card">${body}</div></section>`);
const _hsuHue = h => { const f = n => { const k = (n + h / 30) % 12, a = 0.62 * Math.min(0.55, 1 - 0.55); return Math.round(255 * (0.55 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0'); }; return '#' + f(0) + f(8) + f(4); };
function _hsuHexHue(hex) {
  const m = String(hex || '').match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i); if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map(x => parseInt(x, 16) / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return 0;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round((h * 60 + 360) % 360);
}
/** the pages of the side menu: [{ id, name }] (every page, whatever your role) */
function _hsuPages() {
  const out = [];
  document.querySelectorAll('nav.sidenav .nav-item[data-panel]').forEach(n => {
    const id = n.dataset.panel; if (!id || out.some(p => p.id === id)) return;
    const name = [...n.childNodes].filter(c => c.nodeType === 3).map(c => c.textContent).join(' ').replace(/\s+/g, ' ').trim() || n.title || id;
    out.push({ id, name: name.replace(/\s*[\d—✓/]+\s*$/, '').trim() || id });
  });
  return out;
}

// ── 1. Hotel profile ──────────────────────────────────────
function hsuProfileHtml() {
  const P = api.get('profile'), hotel = (document.getElementById('hotelName')?.textContent || '').trim(), dis = _hsuDis();
  const dev = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_) { return ''; } })();
  const tzs = [...new Set(HSU_TZ.concat(dev ? [dev] : [], P.timezone ? [P.timezone] : []))];
  const inp = (k, label, ph, type) => `<label>${label}<input data-hsu-p="${k}" ${type ? `type="${type}"` : ''} value="${esc(P[k])}" placeholder="${esc(ph || '')}"${dis}></label>`;
  return `
    <div class="hs-row hs-col" data-s="hotel name short name city group brand time zone timezone profile">
      <span class="hs-txt"><b>Hotel profile</b><small>The name under the logo and on reports; where the hotel is (Ops Brain's web answers use it)</small></span>
      <div class="hs-grid">
        <label>Hotel name<input id="hsuName" value="${esc(hotel)}" placeholder="e.g. ibis Styles Deira"${dis}></label>
        ${inp('shortName', 'Short name', 'e.g. ibis Deira')}
        ${inp('city', 'City, country', 'e.g. Dubai, UAE')}
        ${inp('group', 'Group / brands', 'e.g. Accor')}
        <label>Time zone<select data-hsu-p="timezone"${dis}>${tzs.map(z => `<option${z === P.timezone ? ' selected' : ''}>${esc(z)}</option>`).join('')}</select></label>
      </div>
      ${dev && P.timezone && dev !== P.timezone ? `<p class="hsu-warn">⚠️ This device's clock is set to <b>${esc(dev)}</b>, the hotel is in <b>${esc(P.timezone)}</b>. HotelOps uses each device's own clock, so set this device's time zone to the hotel's.</p>` : ''}
    </div>
    <div class="hs-row hs-col" data-s="times check-out checkout check-in checkin extending extension late check-out lco 12:00 6 pm">
      <span class="hs-txt"><b>Times</b><small>Departures (overdue, the time-left ring, the extension deadline), WhatsApp and Ops Brain use these</small></span>
      <div class="hs-grid">
        ${inp('checkout', 'Check-out by', '12:00', 'time')}
        ${inp('checkin', 'Check-in from', '15:00', 'time')}
        ${inp('extendBy', 'Extending guests finish by', '18:00', 'time')}
        ${inp('lcoDefault', 'Late check-out: suggested time', 'none', 'time')}
      </div>
      <p class="hsu-prev" id="hsuTimesPrev">${hsuTimesPreview()}</p>
    </div>
    <div class="hs-row hs-col" data-s="facts pool gym bar ops brain answers">
      <span class="hs-txt"><b>Hotel facts</b><small>What Ops Brain answers when someone asks "pool timing?", "gym?" or "where is the bar?"</small></span>
      <div class="hs-grid hsu-wide">
        ${inp('pool', 'Pool', '08:00 – 19:00')}
        ${inp('gym', 'Gym', 'Open 24 hours')}
        ${inp('bar', 'Bar', 'On the rooftop')}
      </div>
    </div>
    ${_hsuReset('profile', 'Times and facts back to 12:00 check-out, 15:00 check-in, extensions by 18:00. The hotel name stays.')}`;
}
function hsuTimesPreview() {
  return `A room still in at <b>${ampm(api.checkoutMin() + 1, 1)}</b> shows <b>DUE · PAST ${hhmm(api.checkoutMin())}</b>; an extending guest has until <b>${ampm(api.extendByMin(), 1)}</b> to finish the booking, TD and payment.${api.get('profile').lcoDefault ? ` Late check-out opens at <b>${esc(api.get('profile').lcoDefault)}</b>.` : ''}`;
}
function hsuProf(el) {
  if (!hsuCanEdit()) return;
  const k = el.dataset.hsuP, v = String(el.value || '').trim();
  if (['checkout', 'checkin', 'extendBy'].includes(k) && toMin(v) == null) { if (typeof showToast === 'function') showToast('Write the time like 12:00', 'err'); el.value = api.get('profile')[k]; return; }
  if (k === 'lcoDefault' && v && toMin(v) == null) { el.value = ''; return; }
  api.patch('profile', { [k]: v });
  const p = document.getElementById('hsuTimesPrev'); if (p) p.innerHTML = hsuTimesPreview();
  _hsuSaved();
}
function hsuName(el) {
  if (!hsuCanEdit()) return;
  const v = String(el.value || '').trim();
  if (!v) { if (typeof showToast === 'function') showToast('Enter the hotel name', 'err'); return; }
  const n = document.getElementById('hotelName'); if (n) n.textContent = v;
  if (typeof saveSettings === 'function') saveSettings({ hotelName: v });
  try { document.title = 'HotelOps · ' + v; } catch (_) {}
  _hsuSaved();
}
let _hsuToastT = 0;
function _hsuSaved() { clearTimeout(_hsuToastT); _hsuToastT = setTimeout(() => { if (typeof showToast === 'function') showToast('Saved for the whole team', 'ok'); }, 250); }

// ── 2. Shifts ─────────────────────────────────────────────
function hsuShiftsHtml() {
  const S = api.get('shifts'), dis = _hsuDis();
  return `
    <div class="hs-row hs-col" data-s="shifts shift names hours morning afternoon night start end times">
      <span class="hs-txt"><b>Shift names and hours</b><small>Used by the Handover Book (which shift a message belongs to), Home's greeting and Shift Tasks</small></span>
      <div class="hsu-shifts">${SHIFT_KEYS.map(k => { const s = S[k]; return `
        <div class="hsu-shift" data-k="${k}">
          <input class="hsu-emoji" data-hsu-s="icon" value="${esc(s.icon)}" maxlength="4" aria-label="${esc(s.label)} emoji"${dis}>
          <input class="hsu-sname" data-hsu-s="label" value="${esc(s.label)}" maxlength="24" aria-label="Shift name"${dis}>
          <input type="time" data-hsu-s="from" value="${esc(s.from)}" aria-label="${esc(s.label)} starts"${dis}>
          <span class="hsu-to" aria-hidden="true">→</span>
          <input type="time" data-hsu-s="to" value="${esc(s.to)}" aria-label="${esc(s.label)} ends"${dis}>
        </div>`; }).join('')}</div>
      <div class="hsu-day" id="hsuDay">${hsuDayBar(shiftBounds(S))}</div>
    </div>
    <label class="hs-row" data-s="follow roster shift tasks hours">
      <span class="hs-txt"><b>Shift Tasks follow the roster</b><small>On: each task list starts when that shift starts on the posted roster (these hours only when there is no roster). Off: always these hours</small></span>
      <span class="hs-switch"><input type="checkbox" ${S.followRoster !== false ? 'checked' : ''} onchange="hsuFollow(this.checked)"${dis}><i></i></span>
    </label>
    ${_hsuReset('shifts', 'Back to Morning 07:00–15:00, Afternoon 15:00–23:00, Night 23:00–07:00.')}`;
}
/** a 24-hour bar with each shift on it, the time now, and hours nobody or two shifts cover */
function hsuDayBar(B) {
  const pct = m => (m / 1440 * 100).toFixed(2) + '%', segs = [];
  B.forEach((b, i) => { (b.from < b.to ? [[b.from, b.to]] : [[b.from, 1440], [0, b.to]]).forEach(([a, z]) => { if (z > a) segs.push(`<i class="hsu-seg s${i}" style="left:${pct(a)};width:${pct(z - a)}" title="${esc(b.label)} ${hhmm(b.from)}–${hhmm(b.to)}">${z - a >= 180 ? esc(b.icon + ' ' + b.label) : esc(b.icon)}</i>`); }); });
  const now = new Date(), nm = now.getHours() * 60 + now.getMinutes(), k = shiftAt(B, nm), cur = B.find(b => b.key === k);
  const C = shiftCheck(B), fmt = r => r.map(([a, z]) => `${hhmm(a)}–${hhmm(z % 1440)}`).join(', ');
  return `<div class="hsu-bar" role="img" aria-label="${esc(B.map(b => `${b.label} ${hhmm(b.from)} to ${hhmm(b.to)}`).join(', '))}">${segs.join('')}<b class="hsu-now" style="left:${pct(nm)}"></b></div>
    <div class="hsu-ticks"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>
    <p class="hsu-prev">Now (${hhmm(nm)}): <b>${cur ? esc(cur.icon + ' ' + cur.label) : 'no shift'}</b>${C.gaps.length ? ` · <span class="hsu-bad">no shift ${fmt(C.gaps)}</span>` : ''}${C.overlaps.length ? ` · <span class="hsu-bad">two shifts ${fmt(C.overlaps)}</span>` : ''}</p>`;
}
function _hsuShiftsFromDom() {
  const S = clone(api.get('shifts'));
  document.querySelectorAll('.hsu-shift[data-k]').forEach(row => {
    const k = row.dataset.k, s = S[k];
    row.querySelectorAll('[data-hsu-s]').forEach(el => { const f = el.dataset.hsuS, v = String(el.value || '').trim(); if ((f === 'from' || f === 'to') && toMin(v) == null) return; if (v || f === 'icon') s[f] = v || DEFAULTS.shifts[k][f]; });
  });
  return S;
}
function hsuShiftLive() { const d = document.getElementById('hsuDay'); if (d) d.innerHTML = hsuDayBar(shiftBounds(_hsuShiftsFromDom())); }
function hsuShiftSave() { if (!hsuCanEdit()) return; api.set('shifts', _hsuShiftsFromDom()); hsuShiftLive(); _hsuSaved(); }
function hsuFollow(on) { if (!hsuCanEdit()) return; api.patch('shifts', Object.assign({}, api.get('shifts'), { followRoster: !!on })); _hsuSaved(); }

// ── 3. Menu ───────────────────────────────────────────────
function _hsuMenuPlan() {
  const defs = W.hoNavDefaults || [], plan = navPlan(defs, api.get('menu')), pages = _hsuPages();
  const placed = new Set([].concat(...plan.map(g => g.pages)));
  const tools = plan.find(g => g.id === 'tools') || plan[plan.length - 1];
  pages.forEach(p => { if (!placed.has(p.id) && tools) tools.pages.push(p.id); });
  return { plan, pages };
}
function hsuMenuHtml() {
  const { plan, pages } = _hsuMenuPlan(), hidden = new Set(api.get('menu').hidden || []), ed = hsuCanEdit();
  const name = id => (pages.find(p => p.id === id) || {}).name;
  const custom = id => !(W.hoNavDefaults || []).some(d => d.id === id);
  const groups = plan.map((g, gi) => {
    const L = g.pages.filter(name);
    return `<div class="hsu-grp" data-g="${esc(g.id)}">
      <div class="hsu-grp-hd">
        <input class="hsu-gname" value="${esc(g.title)}" aria-label="Group name" onchange="hsuMenuSave()"${ed ? '' : ' disabled'}>
        ${ed ? `<span class="hsu-mv"><button type="button" onclick="hsuGroupMove('${esc(g.id)}',-1)" aria-label="Move the group up"${gi ? '' : ' disabled'}>↑</button><button type="button" onclick="hsuGroupMove('${esc(g.id)}',1)" aria-label="Move the group down"${gi < plan.length - 1 ? '' : ' disabled'}>↓</button>${custom(g.id) && !L.length ? `<button type="button" onclick="hsuGroupDel('${esc(g.id)}')" aria-label="Remove this empty group">✕</button>` : ''}</span>` : ''}
      </div>
      <ul class="hsu-dl" data-dg="menu" data-list="${esc(g.id)}" aria-label="${esc(g.title)} pages">${L.map(id => `
        <li class="hsu-di${hidden.has(id) ? ' off' : ''}" data-k="${esc(id)}">
          ${ed ? '<span class="hsu-grip" aria-hidden="true" title="Drag to move">⋮⋮</span>' : ''}
          <span class="hsu-ic">${_hsuIc(id)}</span><span class="hsu-nm">${esc(name(id))}</span>
          ${ed && id !== 'home' && id !== 'settings' ? `<button type="button" class="hsu-eye" aria-pressed="${!hidden.has(id)}" onclick="hsuMenuHide('${esc(id)}')" title="${hidden.has(id) ? 'Hidden for everyone: tap to show' : 'Shown: tap to hide for everyone'}" aria-label="${hidden.has(id) ? 'Show' : 'Hide'} ${esc(name(id))} for everyone">${hidden.has(id) ? '🙈' : '👁️'}</button>` : hidden.has(id) ? '<span class="hsu-eye">🙈</span>' : ''}
          ${ed ? `<span class="hsu-mv"><button type="button" data-hsu-mv="-1" aria-label="Move ${esc(name(id))} up">↑</button><button type="button" data-hsu-mv="1" aria-label="Move ${esc(name(id))} down">↓</button></span>` : ''}
        </li>`).join('')}</ul>
    </div>`;
  }).join('');
  return `
    <div class="hs-row hs-col" data-s="menu order groups drag drop reorder hide pages everyone rename group ${esc(pages.map(p => p.name).join(' ').toLowerCase())}">
      <span class="hs-txt"><b>Side menu for everyone</b><small>Drag ⋮⋮ (or use ↑ ↓) to change the order or move a page to another group. Rename a group by typing its name. 🙈 hides a page for everyone; who may open what still follows Team management, and each person can hide more pages for themselves in Menu &amp; pages</small></span>
      <div class="hsu-groups">${groups}</div>
      ${ed ? '<div class="hs-acts"><button type="button" class="btn sm ghost" onclick="hsuGroupAdd()">＋ Add a group</button></div>' : ''}
    </div>
    ${_hsuReset('menu', 'Back to the standard groups: Front Desk, Night Audit, Money &amp; Tax, Guests &amp; Sales, Team, Tools, System.')}`;
}
/** the menu as it stands on screen → saved */
function hsuMenuSave(extra) {
  if (!hsuCanEdit()) return;
  const groups = [...document.querySelectorAll('.hsu-grp[data-g]')].map(g => {
    const id = g.dataset.g, def = (W.hoNavDefaults || []).find(d => d.id === id);
    const t = String(g.querySelector('.hsu-gname')?.value || '').trim();
    return { id, title: t || (def ? def.title : 'Group'), pages: [...g.querySelectorAll('.hsu-di[data-k]')].map(li => li.dataset.k) };
  });
  if (extra) extra(groups);
  api.patch('menu', { groups });
  _hsuSaved();
}
function hsuMenuHide(id) {
  if (!hsuCanEdit()) return;
  const h = new Set(api.get('menu').hidden || []);
  if (h.has(id)) h.delete(id); else h.add(id);
  api.patch('menu', { hidden: [...h] });
  if (typeof hoSettingsRender === 'function') hoSettingsRender();
  _hsuSaved();
}
function hsuGroupMove(id, d) {
  hsuMenuSave(G => { const i = G.findIndex(g => g.id === id), j = i + d; if (i < 0 || j < 0 || j >= G.length) return; const [g] = G.splice(i, 1); G.splice(j, 0, g); });
  if (typeof hoSettingsRender === 'function') hoSettingsRender();
}
function hsuGroupAdd() { hsuMenuSave(G => { const tools = G.findIndex(g => g.id === 'tools'); G.splice(tools < 0 ? G.length : tools, 0, { id: 'g' + Date.now().toString(36), title: 'New group', pages: [] }); }); if (typeof hoSettingsRender === 'function') hoSettingsRender(); }
function hsuGroupDel(id) { hsuMenuSave(G => { const i = G.findIndex(g => g.id === id); if (i >= 0 && !G[i].pages.length) G.splice(i, 1); }); if (typeof hoSettingsRender === 'function') hoSettingsRender(); }

// ── 4. Categories ─────────────────────────────────────────
function _hsuCatBase(kind) {
  const P = kind === 'ho' ? W.hoHandoverPure : W.hoWaBrainPure;
  const map = kind === 'ho' ? (P && P.CAT) : (P && P.CATS);
  return map || {};
}
function hsuCatsHtml() {
  const kind = hsuCatTab, set = (api.get('cats') || {})[kind] || {}, ed = hsuCanEdit(), dis = _hsuDis();
  const map = _hsuCatBase(kind), ids = Object.keys(map).filter(id => !(set[id] && set[id].custom)).concat(Object.keys(set).filter(id => set[id] && set[id].custom));
  const def = id => (api._catDefaults[kind] || {})[id] || map[id] || {};
  const rows = ids.map(id => {
    const s = set[id] || {}, d = def(id), on = !s.off, lab = s.label || (s.custom ? '' : d.label) || '', ic = s.icon || (s.custom ? '🏷️' : d.icon) || '';
    const hue = typeof s.hue === 'number' ? s.hue : (kind === 'ho' ? ({ guest: 340, pay: 150, res: 220, move: 265, maint: 25, hk: 185, transport: 45, lost: 300, desk: 200, fb: 10, follow: 38, cash: 120, info: 215 }[id] ?? 215) : null);
    return `<div class="hsu-cat${on ? '' : ' off'}" data-id="${esc(id)}">
      <input class="hsu-emoji" data-c="icon" value="${esc(ic)}" maxlength="4" aria-label="Emoji"${dis}>
      <input class="hsu-cname" data-c="label" value="${esc(lab)}" placeholder="${esc(d.label || 'Name')}" aria-label="Name"${dis}>
      ${hue != null ? `<input type="color" class="hsu-col" data-c="hue" value="${_hsuHue(hue)}" aria-label="Colour"${dis}>` : s.custom ? `<select data-c="kind" aria-label="Kind"${dis}><option value="req"${s.kind !== 'maint' ? ' selected' : ''}>Request</option><option value="maint"${s.kind === 'maint' ? ' selected' : ''}>Repair</option></select>` : '<span></span>'}
      <span class="hs-switch" title="${on ? 'On' : 'Off: never chosen by itself'}"><input type="checkbox" data-c="on" ${on ? 'checked' : ''} aria-label="Use ${esc(lab || id)}"${dis}><i></i></span>
      <input class="hsu-words" data-c="words" value="${esc(s.words || '')}" placeholder="${s.custom ? 'Words for it, comma separated' : 'Extra words, comma separated'}" aria-label="Extra words"${dis}>
    </div>`;
  }).join('');
  return `
    <div class="hs-row hs-col" data-s="categories handover hk housekeeping requests rename colour color emoji keywords words disable add">
      <span class="hs-txt"><b>Categories</b><small>How messages are sorted. Rename them, change the emoji${kind === 'ho' ? ' or colour' : ''}, add words your team uses (they win over the built-in words), switch one off or add your own</small></span>
      <span class="hs-seg" role="tablist"><button type="button" class="${kind === 'ho' ? 'on' : ''}" onclick="hsuCatTab='ho';hoSettingsRender()">Handover Book</button><button type="button" class="${kind === 'hk' ? 'on' : ''}" onclick="hsuCatTab='hk';hoSettingsRender()">HK requests</button></span>
      <div class="hsu-cats" data-kind="${kind}">${rows || '<p class="hsu-prev">This page has not loaded yet: open it once, then come back.</p>'}</div>
      ${ed ? `<div class="hs-acts"><button type="button" class="btn sm ghost" onclick="hsuCatAdd()">＋ Add a category</button><small>Changes apply to new messages; ones already sorted keep their category.</small></div>` : ''}
    </div>
    ${_hsuReset('cats', 'Every category back to its built-in name, emoji and words; the ones you added are removed.')}`;
}
function hsuCatChange(row) {
  if (!hsuCanEdit()) return;
  const kind = row.closest('.hsu-cats').dataset.kind, id = row.dataset.id;
  const all = clone(api.get('cats') || {}), set = all[kind] = isObj(all[kind]) ? all[kind] : {};
  const prev = set[id] || {}, s = {}, def = (api._catDefaults[kind] || {})[id] || {};
  if (prev.custom) { s.custom = true; s.kind = prev.kind || 'req'; }
  row.querySelectorAll('[data-c]').forEach(el => {
    const f = el.dataset.c, v = el.type === 'checkbox' ? el.checked : String(el.value || '').trim();
    if (f === 'on') { if (!v) s.off = true; return; }
    if (f === 'hue') { const h = _hsuHexHue(v); if (h != null && (prev.hue != null || el.dataset.touched)) s.hue = h; return; }
    if (f === 'kind') { s.kind = v === 'maint' ? 'maint' : 'req'; return; }
    if ((f === 'label' || f === 'icon') && !prev.custom && v === def[f]) return;
    if (v) s[f] = v;
  });
  if (Object.keys(s).length) set[id] = s; else delete set[id];
  api.set('cats', all);
  row.classList.toggle('off', !!s.off);
  _hsuSaved();
}
function hsuCatAdd() {
  if (!hsuCanEdit()) return;
  const all = clone(api.get('cats') || {}), kind = hsuCatTab; all[kind] = isObj(all[kind]) ? all[kind] : {};
  const id = 'c' + Date.now().toString(36);
  all[kind][id] = { custom: true, label: 'New category', icon: '🏷️', kind: 'req' };
  api.set('cats', all);
  if (typeof hoSettingsRender === 'function') hoSettingsRender();
  setTimeout(() => { const el = document.querySelector(`.hsu-cat[data-id="${id}"] .hsu-cname`); if (el) { el.focus(); el.select(); } }, 30);
}

// ── 5. Departures ─────────────────────────────────────────
function hsuDepsHtml() {
  const D = api.get('dep'), dis = _hsuDis(), ed = hsuCanEdit(), base = _base.intents || {};
  const ok = typeof depBalOkSources !== 'undefined' ? depBalOkSources : [];
  return `
    <div class="hs-row hs-col" data-s="departures guest said intents labels extending finance hold maybe extend coming back returning pay td">
      <span class="hs-txt"><b>What the guest said</b><small>The words and emoji on a room card and in the "Guest said…" list</small></span>
      <div class="hsu-ints">${HSU_INTENTS.map(([k, why]) => { const s = (D.intents || {})[k] || {}, b = base[k] || {}; return `
        <div class="hsu-int" data-k="${k}"><input class="hsu-emoji" data-i="icon" value="${esc(s.icon || b.icon || '')}" maxlength="4" aria-label="Emoji"${dis}><input data-i="label" value="${esc(s.label || '')}" placeholder="${esc(b.label || k)}" aria-label="${esc(b.label || k)}"${dis}><small>${esc(why)}</small></div>`; }).join('')}</div>
    </div>
    <div class="hs-row hs-col" data-s="balance owing ok to owe expedia company pays billed sources">
      <span class="hs-txt"><b>Balances that are fine to leave</b><small>Bookings from these sources may leave with a balance (the company or the website pays). A room's own balance can also be marked OK on its card</small></span>
      <div class="hsu-chips">${ok.map(s => `<span class="hsu-chip">${esc(s)}${ed ? `<button type="button" onclick="hsuOweDel('${esc(s)}')" aria-label="Remove ${esc(s)}">✕</button>` : ''}</span>`).join('') || '<small class="hsu-prev">None yet.</small>'}</div>
      ${ed ? `<div class="hs-inline hsu-left"><input id="hsuOweIn" placeholder="e.g. Expedia" aria-label="Booking source" onkeydown="if(event.key==='Enter')hsuOweAdd()"><button type="button" class="btn sm" onclick="hsuOweAdd()">Add</button></div>` : ''}
    </div>
    <label class="hs-row" data-s="overdue alerts late check-out alarm">
      <span class="hs-txt"><b>Overdue alerts</b><small>Warn the team when a room passes its check-out or late check-out time. Each person can still mute it with 🔔 on Departures</small></span>
      <span class="hs-switch"><input type="checkbox" ${D.overdueAlert !== false ? 'checked' : ''} onchange="hsuDep('overdueAlert', this.checked)"${dis}><i></i></span>
    </label>
    <label class="hs-row" data-s="overdue sound beep chime">
      <span class="hs-txt"><b>Sound with overdue alerts</b><small>A short beep when a room goes overdue</small></span>
      <span class="hs-switch"><input type="checkbox" ${D.overdueSound !== false ? 'checked' : ''} onchange="hsuDep('overdueSound', this.checked)"${dis}><i></i></span>
    </label>
    <div class="hs-row hs-col" data-s="late check-out quick times lco buttons">
      <span class="hs-txt"><b>Late check-out quick times</b><small>The buttons in the late check-out picker, comma separated</small></span>
      <input class="hsu-full" id="hsuLco" value="${esc((D.lcoTimes || []).join(', '))}" onchange="hsuLcoSave(this)" aria-label="Late check-out quick times"${dis}>
    </div>
    ${_hsuReset('dep', 'Back to the built-in words, alerts and sound on, and the usual late check-out times. Balance sources stay.')}`;
}
function hsuIntentChange(row) {
  if (!hsuCanEdit()) return;
  const k = row.dataset.k, b = (_base.intents || {})[k] || {}, ints = clone(api.get('dep').intents || {}), s = {};
  const icon = String(row.querySelector('[data-i="icon"]').value || '').trim(), label = String(row.querySelector('[data-i="label"]').value || '').trim();
  if (icon && icon !== b.icon) s.icon = icon;
  if (label && label !== b.label) s.label = label;
  if (Object.keys(s).length) ints[k] = s; else delete ints[k];
  api.patch('dep', { intents: ints });
  _hsuSaved();
}
function hsuDep(k, v) { if (!hsuCanEdit()) return; api.patch('dep', { [k]: v }); _hsuSaved(); }
function hsuLcoSave(el) {
  if (!hsuCanEdit()) return;
  const L = String(el.value || '').split(/[,;\s]+/).map(t => { const m = toMin(t); return m == null ? null : hhmm(m); }).filter(Boolean);
  const u = [...new Set(L)].sort((a, b) => toMin(a) - toMin(b));
  if (!u.length) { if (typeof showToast === 'function') showToast('Write the times like 13:00, 14:00', 'err'); return; }
  el.value = u.join(', ');
  api.patch('dep', { lcoTimes: u });
  _hsuSaved();
}
function hsuOweAdd() {
  const el = document.getElementById('hsuOweIn'), v = String(el && el.value || '').trim().toLowerCase();
  if (!v || !hsuCanEdit() || typeof depBalSetRule !== 'function') return;
  depBalSetRule(v, true);
  if (typeof depRender === 'function' && typeof depRooms !== 'undefined' && depRooms.length) depRender();
  if (typeof hoSettingsRender === 'function') hoSettingsRender();
  _hsuSaved();
}
function hsuOweDel(v) {
  if (!hsuCanEdit() || typeof depBalOkSources === 'undefined') return;
  depBalOkSources = depBalOkSources.filter(s => s !== v);
  if (typeof fbSet === 'function') fbSet('settings/depBalanceOk', depBalOkSources.length ? depBalOkSources : null);
  if (typeof depRender === 'function' && typeof depRooms !== 'undefined' && depRooms.length) depRender();
  if (typeof hoSettingsRender === 'function') hoSettingsRender();
  _hsuSaved();
}

// ── 6. Copy to another hotel ──────────────────────────────
function hsuCopyHtml() {
  const ed = hsuCanEdit(), owner = !!(typeof currentProfile !== 'undefined' && currentProfile && currentProfile.role === 'owner');
  return `
    <div class="hs-row" data-s="export setup file copy another hotel json download">
      <span class="hs-txt"><b>Save the setup as a file</b><small>Profile times and facts, shifts, menu, categories, Departures words and Tourism Dirham settings. No staff, guests or room data</small></span>
      <button class="btn" type="button" onclick="hsuExport()">Download</button>
    </div>
    ${ed ? `<div class="hs-row" data-s="import setup file load another hotel json">
      <span class="hs-txt"><b>Load a setup file</b><small>From another hotel. You see what changes before anything is saved; this hotel's name stays</small></span>
      <button class="btn ghost" type="button" onclick="document.getElementById('hsuFile').click()">Choose file</button>
      <input type="file" id="hsuFile" accept=".json,application/json" hidden onchange="hsuImport(this)">
    </div>` : ''}
    ${owner ? `<div class="hs-row" data-s="new hotel start from this setup without staff guests">
      <span class="hs-txt"><b>Start a new hotel from this setup</b><small>Opens Add a hotel with "Start from this hotel's setup" ticked: the new hotel gets these settings, without staff, guests or data</small></span>
      <button class="btn ghost" type="button" onclick="hsuNewHotel()">Start</button>
    </div>` : ''}`;
}
function hsuExportObj() {
  const hotel = (document.getElementById('hotelName')?.textContent || '').trim();
  return { hotelops: 'setup', v: 1, from: hotel, at: new Date().toISOString(), setup: forNewHotel(merge(saved)),
    td: typeof HotelCfg !== 'undefined' ? HotelCfg.get() : null, balOk: typeof depBalOkSources !== 'undefined' ? depBalOkSources.slice() : [] };
}
function hsuExport() {
  const o = hsuExportObj(), name = 'hotelops-setup' + (o.from ? '-' + o.from.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : '') + '.json';
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(o, null, 2)], { type: 'application/json' })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function hsuImport(input) {
  const f = input.files && input.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    input.value = '';
    let d; try { d = readFile(String(r.result)); } catch (_) { if (typeof showToast === 'function') showToast('That file is not a HotelOps setup file', 'err'); return; }
    const parts = Object.keys(d.setup).map(k => ({ profile: 'times and facts', shifts: 'shifts', menu: 'menu', cats: 'categories', dep: 'Departures words' }[k] || k));
    if (d.td) parts.push('Tourism Dirham (code ' + (d.td.tdCodes || '?') + ', AED ' + (d.td.tdRate || '?') + ')');
    if (d.balOk && d.balOk.length) parts.push('balances fine to leave (' + d.balOk.join(', ') + ')');
    if (!confirm('Load this setup for the whole team?\n\nIt replaces: ' + parts.join(', ') + '.\nThe hotel name, staff and data stay as they are.')) return;
    const keepProfile = { shortName: api.get('profile').shortName };
    if (d.setup.profile) d.setup.profile = Object.assign({}, d.setup.profile, keepProfile);
    api.replace(d.setup, true);
    if (d.td && typeof HotelCfg !== 'undefined') HotelCfg.set(Object.assign({}, HotelCfg.DEFAULTS, d.td));
    if (d.balOk && typeof fbSet === 'function') { if (typeof depBalOkSources !== 'undefined') depBalOkSources = d.balOk.slice(); fbSet('settings/depBalanceOk', d.balOk.length ? d.balOk : null); }
    if (typeof logActivity === 'function') try { logActivity('setup_import', 'Hotel setup loaded from a file: ' + parts.join(', ')); } catch (_) {}
    if (typeof hoSettingsRender === 'function') hoSettingsRender();
    if (typeof showToast === 'function') showToast('Setup loaded for the whole team', 'ok');
  };
  r.readAsText(f);
}
function hsuNewHotel() {
  const box = document.getElementById('tnBox');
  if (!box) return;
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  setTimeout(() => { const c = document.getElementById('tnCopy'); if (c) c.checked = true; document.getElementById('tnName')?.focus(); }, 400);
}
function hsuReset(sec) {
  if (!hsuCanEdit()) return;
  const what = { profile: 'the times and facts', shifts: 'the shifts', menu: 'the menu', cats: 'every category', dep: 'the Departures words and alerts' }[sec] || sec;
  if (!confirm(`Put ${what} back to the defaults for the whole team?`)) return;
  api.set(sec, null);
  if (typeof logActivity === 'function') try { logActivity('setup_reset', 'Hotel setup: ' + what + ' back to the defaults'); } catch (_) {}
  if (typeof hoSettingsRender === 'function') hoSettingsRender();
  if (typeof showToast === 'function') showToast('Back to the defaults', 'ok');
}

/** every Hotel setup section, for Settings */
function hoSetupSections() {
  const note = hsuCanEdit() ? '' : ' · only owners and managers can change it';
  return [
    _hsuSec('setup', 'adagio', 'Hotel setup', 'How HotelOps works at this hotel, shared with the whole team' + note, hsuProfileHtml()),
    _hsuSec('setup-shifts', 'shifts', 'Shifts', 'Names and hours of the three shifts' + note, hsuShiftsHtml()),
    _hsuSec('setup-menu', 'more', 'Menu for the team', 'Order, groups and pages hidden for everyone' + note, hsuMenuHtml()),
    _hsuSec('setup-cats', 'handover', 'Categories', 'Handover Book and HK request topics' + note, hsuCatsHtml()),
    _hsuSec('setup-deps', 'departures', 'Departures rules', 'Words, balances that are fine and overdue alerts' + note, hsuDepsHtml()),
    _hsuSec('setup-copy', 'save', 'Copy to another hotel', 'Use this setup somewhere else', hsuCopyHtml()),
  ].join('');
}

// ── Home tiles, your own order (Settings → Home) ──────────
function hsuTilesHtml() {
  const order = (typeof hoPref === 'function' && hoPref('tileOrder')) || [], hidden = new Set((typeof hoPref === 'function' && hoPref('hiddenTiles')) || []);
  const at = id => { const k = order.indexOf(id); return k < 0 ? 999 : k; };
  const L = HSU_TILES.map((t, i) => [t, i]).sort((a, b) => at(a[0][0]) - at(b[0][0]) || a[1] - b[1]).map(x => x[0]);
  return `<div class="hs-row hs-col" data-s="home tiles cards dashboard order drag">
    <span class="hs-txt"><b>Tiles</b><small>Untick to hide; drag ⋮⋮ (or ↑ ↓) to change the order. Only on this device${typeof hoPref === 'function' && hoPref('syncPrefs') ? ' and your other devices' : ''}. Some tiles show only when they have something to say</small></span>
    <ul class="hsu-dl hsu-tiles" data-dg="tiles" data-list="tiles" aria-label="Home tiles">${L.map(([id, name]) => `
      <li class="hsu-di${hidden.has(id) ? ' off' : ''}" data-k="${id}">
        <span class="hsu-grip" aria-hidden="true" title="Drag to move">⋮⋮</span>
        <label class="hsu-tick"><input type="checkbox" ${hidden.has(id) ? '' : 'checked'} onchange="hoToggleTile('${id}', this.checked)"><span class="hsu-ic">${_hsuIc(id)}</span><span class="hsu-nm">${esc(name)}</span></label>
        <span class="hsu-mv"><button type="button" data-hsu-mv="-1" aria-label="Move ${esc(name)} up">↑</button><button type="button" data-hsu-mv="1" aria-label="Move ${esc(name)} down">↓</button></span>
      </li>`).join('')}</ul>
    ${order.length ? '<div class="hs-acts"><button type="button" class="btn sm ghost" onclick="hoSetPref(\'tileOrder\',[]);hoSettingsRender()">Standard order</button></div>' : ''}
  </div>`;
}

// ── Drag & drop lists (pointer, touch and the ↑ ↓ buttons) ─
const HSU_DROP = {
  menu: () => hsuMenuSave(),
  tiles: lists => { if (typeof hoSetPref === 'function') hoSetPref('tileOrder', lists[0] ? lists[0].keys : []); },
};
function _hsuDropped(dg) {
  const lists = [...document.querySelectorAll(`.hsu-dl[data-dg="${dg}"]`)].map(ul => ({ id: ul.dataset.list, keys: [...ul.querySelectorAll(':scope > .hsu-di')].map(li => li.dataset.k) }));
  if (HSU_DROP[dg]) HSU_DROP[dg](lists);
}
/** ↑ ↓: one place up or down; at the top or bottom of a group, into the group before or after */
function _hsuStep(li, d) {
  const ul = li.parentElement, dg = ul.dataset.dg;
  const sib = d < 0 ? li.previousElementSibling : li.nextElementSibling;
  if (sib && sib.classList.contains('hsu-di')) { if (d < 0) ul.insertBefore(li, sib); else ul.insertBefore(sib, li); }
  else {
    const all = [...document.querySelectorAll(`.hsu-dl[data-dg="${dg}"]`)], k = all.indexOf(ul) + d;
    if (k < 0 || k >= all.length) return false;
    if (d < 0) all[k].appendChild(li); else all[k].insertBefore(li, all[k].firstElementChild);
  }
  _hsuDropped(dg);
  return true;
}
let _hsuDrag = null;
const _hsuTy = li => parseFloat((li.style.transform.match(/translateY\((-?[\d.]+)px\)/) || [])[1]) || 0;
function _hsuDragMove(e) {
  const D = _hsuDrag; if (!D) return;
  e.preventDefault();
  const under = document.elementFromPoint(e.clientX, e.clientY);
  const tli = under && under.closest && under.closest('.hsu-di'), tul = under && under.closest && under.closest(`.hsu-dl[data-dg="${D.dg}"]`);
  if (tli && tli !== D.li && tli.parentElement.dataset.dg === D.dg) {
    const r = tli.getBoundingClientRect(), ref = e.clientY < r.top + r.height / 2 ? tli : tli.nextElementSibling;
    if (ref !== D.li) tli.parentElement.insertBefore(D.li, ref);
  } else if (tul && !tul.contains(D.li) && !tul.querySelector('.hsu-di')) tul.appendChild(D.li);
  // the row stays under the finger wherever it now sits in the list
  const natural = D.li.getBoundingClientRect().top - _hsuTy(D.li);
  D.li.style.transform = `translateY(${e.clientY - D.grab - natural}px)`;
  const edge = 60; if (e.clientY < edge) scrollBy(0, -12); else if (e.clientY > innerHeight - edge) scrollBy(0, 12);
}
function _hsuDragEnd() {
  const D = _hsuDrag; if (!D) return;
  _hsuDrag = null;
  D.li.classList.remove('hsu-lift'); D.li.style.transform = '';
  document.body.classList.remove('hsu-dragging');
  removeEventListener('pointermove', _hsuDragMove); removeEventListener('pointerup', _hsuDragEnd); removeEventListener('pointercancel', _hsuDragEnd);
  const changed = D.li.parentElement !== D.ul0 || D.li.nextElementSibling !== D.next0;
  if (changed) _hsuDropped(D.dg);
}
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('pointerdown', e => {
    const g = e.target.closest && e.target.closest('.hsu-grip'); if (!g || e.button > 0) return;
    const li = g.closest('.hsu-di'), ul = li && li.parentElement; if (!ul || !ul.dataset.dg) return;
    e.preventDefault();
    _hsuDrag = { li, ul0: ul, next0: li.nextElementSibling, dg: ul.dataset.dg, grab: e.clientY - li.getBoundingClientRect().top };
    li.classList.add('hsu-lift'); document.body.classList.add('hsu-dragging');
    addEventListener('pointermove', _hsuDragMove, { passive: false }); addEventListener('pointerup', _hsuDragEnd); addEventListener('pointercancel', _hsuDragEnd);
  });
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-hsu-mv]'); if (!b) return;
    const li = b.closest('.hsu-di'); if (!li) return;
    const d = +b.dataset.hsuMv;
    if (_hsuStep(li, d)) { const nb = li.querySelector(`[data-hsu-mv="${d}"]`); if (nb) nb.focus(); li.classList.add('hsu-flash'); setTimeout(() => li.classList.remove('hsu-flash'), 500); }
  });
  // fields save when they change; shift hours preview while typing
  document.addEventListener('change', e => {
    const t = e.target; if (!t || !t.closest || !t.closest('#hsBody')) return;
    if (t.dataset.hsuP) hsuProf(t);
    else if (t.id === 'hsuName') hsuName(t);
    else if (t.dataset.hsuS) hsuShiftSave();
    else if (t.dataset.c) { if (t.dataset.c === 'hue') t.dataset.touched = '1'; hsuCatChange(t.closest('.hsu-cat')); }
    else if (t.dataset.i) hsuIntentChange(t.closest('.hsu-int'));
  });
  document.addEventListener('input', e => { const t = e.target; if (t && t.dataset && t.dataset.hsuS) hsuShiftLive(); });
}

Object.assign(W, { hoSetupSections, hsuTilesHtml, hsuReset, hsuFollow, hsuMenuHide, hsuMenuSave, hsuGroupMove, hsuGroupAdd, hsuGroupDel, hsuCatAdd, hsuDep, hsuLcoSave, hsuOweAdd, hsuOweDel, hsuExport, hsuImport, hsuNewHotel, hsuCanEdit, hsuExportObj });
Object.defineProperty(W, 'hsuCatTab', { get: () => hsuCatTab, set: v => { hsuCatTab = v === 'hk' ? 'hk' : 'ho'; }, configurable: true });
})(typeof window !== 'undefined' ? window : globalThis);
