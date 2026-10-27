// ═══════════════════════════════════════════════════════════
//  notify-hub.js — 📲 one place for every phone notification
//
//  Every feature calls one function:
//     hoNotify.send({ cat, title, body, prio (1–5), key, url, at?, state?,
//                     instant?, repeat?, toast?, claimed?, force? })
//  and the hub decides whether, when and how it reaches the phone. It goes
//  through the SAME ways you already set up for the WhatsApp Away guard
//  (waGuard/{uid}: ntfy topic and/or your own Telegram bot) — there is no
//  second setup. With nothing set up, Settings shows "Set up phone alerts",
//  which opens the guard's setup (hoWaGuard.open()).
//
//  Smart rules, in this order:
//   • a switch per category (Settings → 📲 Phone notifications);
//   • nothing older than when the app opened (no storm on start), unless
//     it is a state that is still true (state: true — a room still overdue);
//   • shift categories only while you're on shift by the roster (the same
//     check as Shift alerts), unless "even off shift" is on;
//   • quiet hours mute everything except urgent (prio 5) and the guard;
//   • the same key is never sent twice: the first device to write
//     notifyHub/{uid}/claims/{key} (a transaction) is the one that sends,
//     so a phone and a PC both open never both buzz;
//   • low-priority alerts (prio ≤ 3) wait up to 60 s and go as ONE message;
//     a burst of alerts is merged the same way (storm guard);
//   • repeat: { after, check, prio } — still not done after a while → a
//     louder repeat (e.g. a wake-up call not ticked 5 min after its time).
//  Plus a toast in the app when it's in front.
//
//  Firebase (your own account only): notifyHub/{uid}/cfg, /claims/{key} =
//  {at, by}, /log (last 20). Reads waGuard/{uid}/tg and /ntfy (wa-guard.js
//  owns them). Also watches, without changing them: your roster (your
//  shifts changed / a new roster), and HK requests left open (wa-brain).
//  Pure helpers: window.hoNotifyPure (tests/run-tests.js).
// ═══════════════════════════════════════════════════════════
(function (W) {
'use strict';
const D = W.document;
const MIN = 60e3;
const pad = n => String(n).padStart(2, '0');
const toMin = t => { const m = String(t || '').match(/(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
// Firebase keys can't hold . # $ [ ] /
const fbKey = k => String(k == null ? '' : k).replace(/[.#$\[\]\/\x00-\x1f\x7f]/g, '_').slice(0, 140) || '_';
const KEEP = 4 * 24 * 60 * MIN;     // a claim / sent key is remembered this long
const BATCH_MS = 60e3;              // low-priority alerts gather this long
const STORM = { win: 5 * MIN, max: 8 };   // more phone messages than this in 5 min: the rest are merged

// ══ The categories (shift: only while on shift) ═════════════
const CATS = {
  guard:      { i: '🛡', l: 'WhatsApp Away guard', d: 'Someone using your WhatsApp while you\'re away — always instant, even in quiet hours', shift: false, def: true, tag: 'rotating_light' },
  wakeup:     { i: '☎️', l: 'Wake-up calls', d: 'When a call is due, and louder if it isn\'t ticked 5 min later', shift: true, def: true, tag: 'telephone_receiver' },
  tasks:      { i: '✅', l: 'Shift tasks', d: 'A task with a time that passes un-ticked (❗ important ones louder)', shift: true, def: true, tag: 'white_check_mark' },
  checklist:  { i: '🌙', l: 'Night run checklist', d: 'Timed steps like TD and the night audit: 15 and 5 min before, and if late', shift: true, def: true, tag: 'crescent_moon' },
  departures: { i: '🚪', l: 'Departures', d: 'A room past check-out time and not out, a late check-out time reached', shift: true, def: true, tag: 'door' },
  shift:      { i: '🔔', l: 'Shift alerts', d: 'VIP arrivals, room problems, handover items, end-of-shift summary (choose which under Shift alerts)', shift: true, def: true, tag: 'bell' },
  roster:     { i: '🗓', l: 'Roster & requests', d: 'Your shifts changed, a new roster, a swap or day-off request to you or answered', shift: false, def: true, tag: 'calendar' },
  hk:         { i: '🧹', l: 'Housekeeping requests', d: 'A guest request still open past HK\'s time (from the WhatsApp requests log)', shift: true, def: false, tag: 'broom' },
  notes:      { i: '📝', l: 'Room notes', d: 'A colleague adds a guest request, VIP, follow-up, maintenance or call note', shift: true, def: false, tag: 'memo' },
  system:     { i: '⚙️', l: 'HotelOps', d: '', shift: false, def: true, hidden: true, tag: 'gear' },
};
const DEF = { cats: {}, quiet: false, qFrom: '23:00', qTo: '07:00', offShift: false };
Object.keys(CATS).forEach(k => { DEF.cats[k] = CATS[k].def; });

// ══ Pure rules (tested) ═════════════════════════════════════
/** quiet hours now? cfg: {quiet, qFrom, qTo} (over midnight works) */
function inQuiet(cfg, now) {
  if (!cfg || !cfg.quiet) return false;
  const a = toMin(cfg.qFrom), b = toMin(cfg.qTo); if (a == null || b == null || a === b) return false;
  const m = now.getHours() * 60 + now.getMinutes();
  return a < b ? m >= a && m < b : m >= a || m < b;
}
function catOn(cfg, cat) {
  const c = CATS[cat] || CATS.system;
  if (c.hidden) return true;
  const v = cfg && cfg.cats ? cfg.cats[cat] : undefined;
  return v === undefined ? c.def : !!v;
}
/** may this alert go now? ctx: {cfg, now: Date, shift: 'on'|'off'|'soon'|'ended'|'unknown', openedAt} → {ok, why} */
function gate(o, ctx) {
  if (o.force) return { ok: true };
  const cfg = ctx.cfg || DEF, c = CATS[o.cat] || CATS.system;
  if (!catOn(cfg, o.cat)) return { ok: false, why: 'switched off' };
  // an event from before the app opened is old news (a state that is still true is not)
  if (!o.state && o.at && o.at < (ctx.openedAt || 0) - MIN) return { ok: false, why: 'old' };
  if (c.shift && !o.shiftChecked && !cfg.offShift && ctx.shift && ctx.shift !== 'on' && ctx.shift !== 'unknown') return { ok: false, why: 'off shift' };
  if (!o.ignoreQuiet && (o.prio || 3) < 5 && inQuiet(cfg, ctx.now)) return { ok: false, why: 'quiet hours' };
  return { ok: true };
}
/** the transaction step for a claim: write mine, or keep someone's that is still fresh (undefined = abort) */
function claimNext(cur, dev, now, keep) {
  if (cur && typeof cur === 'object' && cur.at && now - cur.at < (keep || KEEP)) return undefined;
  return { at: now, by: dev };
}
/** a burst: too many phone messages lately */
function storm(recent, now) { return (recent || []).filter(t => now - t < STORM.win).length >= STORM.max; }
/** wait and merge? (never the guard, never urgent, never "instant") */
function shouldBatch(o, recent, now) {
  if (o.instant || o.cat === 'guard' || (o.prio || 3) >= 5) return false;
  return (o.prio || 3) <= 3 || storm(recent, now);
}
/** several alerts → one message: the loudest priority, a line each */
function mergeBatch(items) {
  items = (items || []).filter(Boolean);
  if (items.length <= 1) return items[0] || null;
  const cats = [...new Set(items.map(o => o.cat))], one = cats.length === 1 ? (CATS[cats[0]] || CATS.system) : null;
  const prio = Math.max(...items.map(o => o.prio || 3));
  const line = o => '• ' + String(o.title || '').replace(/\s+/g, ' ').trim() + (o.body ? ' — ' + String(o.body).split('\n')[0].slice(0, 90) : '');
  const shown = items.slice(0, 8).map(line);
  return {
    cat: one ? cats[0] : 'system', prio, n: items.length, url: items[0].url || '', key: items.map(o => o.key).join('+').slice(0, 200),
    title: one ? `${one.i} ${items.length} × ${one.l}` : `🔔 ${items.length} alerts`,
    body: shown.join('\n') + (items.length > 8 ? `\n+${items.length - 8} more` : ''),
    tags: [(one || CATS.system).tag], merged: items.map(o => o.key),
  };
}
/** your roster before / now ({date: code}) → what changed for you; a day that wasn't posted before is "added" */
function rosterDiff(prev, cur) {
  const changed = [], added = [];
  Object.keys(cur || {}).sort().forEach(d => {
    const t = cur[d] || '';
    if (!prev || !(d in prev)) { if (t) added.push({ d, t }); return; }
    const f = prev[d] || '';
    if (String(f).trim().toUpperCase() !== String(t).trim().toUpperCase()) changed.push({ d, f, t });
  });
  return { changed, added };
}
/** a short, stable id for a list of things (a roster change set) */
function hash(s) { let h = 5381; s = String(s); for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

W.hoNotifyPure = { inQuiet, catOn, gate, claimNext, storm, shouldBatch, mergeBatch, rosterDiff, hash, fbKey, CATS, DEF };
if (!D || typeof D.createElement !== 'function') return;

// ══ App helpers ═════════════════════════════════════════════
const safe = (fn, fb) => { try { const v = fn(); return v === undefined ? fb : v; } catch (_) { return fb; } };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fn = n => typeof W[n] === 'function';
const uid = () => safe(() => (typeof currentUser !== 'undefined' && currentUser && currentUser.uid) || '', '');
const P = sub => 'notifyHub/' + uid() + (sub ? '/' + sub : '');
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
const toast = (m, t) => safe(() => { if (fn('showToast')) showToast(m, t || 'ok'); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hhmm = t => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const LS_CFG = 'ho_nh_cfg_v1', LS_SENT = 'ho_nh_sent_v1', LS_LOG = 'ho_nh_log_v1', LS_RO = 'ho_nh_roster_v1';
// this device (the same id Shift alerts uses), so a claim can tell "mine" from "the other phone's"
const DEV = (() => { let d = lsGet('ho_sa_dev_v1', ''); if (!/^d[a-z0-9]{6,}$/.test(d)) { d = 'd' + Math.random().toString(36).slice(2, 10); lsSet('ho_sa_dev_v1', d); } return d; })();

const openedAt = Date.now();
let CFG = Object.assign({}, DEF, lsGet(LS_CFG, {}));
CFG.cats = Object.assign({}, DEF.cats, CFG.cats || {});
let TG = null, NTFY = null;                 // waGuard/{uid}: the ways to the phone
let LOG = lsGet(LS_LOG, []) || [];          // notifyHub/{uid}/log as last heard
let SENT = lsGet(LS_SENT, {}) || {};        // key → at: handled on this device (sent, or another device had it)
const INFLIGHT = new Set(), TOASTED = new Set();
let BUF = [], bufT = 0, RECENT = [], started = false, nudged = false;

// ══ The ways to the phone (the guard's setup) ═══════════════
function channels() {
  let tg = TG, nt = NTFY;
  // the guard may have heard them first (same account, same data)
  if ((!tg || !nt) && W.hoWaGuard && typeof W.hoWaGuard.channels === 'function') {
    const g = safe(() => W.hoWaGuard.channels(), null) || {};
    tg = tg || (g.tg && g.tg.chat ? g.tg : null); nt = nt || g.ntfy || null;
  }
  return { tg: tg && tg.token && tg.chat ? tg : null, ntfy: nt && nt.topic ? nt : null };
}
function connected() { const c = channels(); return !!(c.tg || c.ntfy); }
const link = url => location.origin + location.pathname + (url ? (String(url).charAt(0) === '#' ? url : '#go=' + url) : '');
function ntfyPost(ch, m) {
  if (!ch) return Promise.resolve(false);
  const url = link(m.url);
  const body = { topic: ch.topic, title: m.title, message: m.body || ' ', priority: Math.min(5, Math.max(1, m.prio || 3)), tags: m.tags || [(CATS[m.cat] || CATS.system).tag] };
  if (/^https:/.test(url)) Object.assign(body, { click: url, actions: [{ action: 'view', label: 'Open HotelOps', url }] });
  // a plain-text body: no pre-flight check
  return fetch('https://ntfy.sh/', { method: 'POST', body: JSON.stringify(body) }).then(r => r.ok).catch(() => false);
}
function tgPost(ch, m) {
  if (!ch) return Promise.resolve(false);
  const url = link(m.url), loud = (m.prio || 3) >= 5;
  const p = { chat_id: ch.chat, parse_mode: 'HTML', text: `<b>${esc((loud ? '‼️ ' : '') + m.title)}</b>${m.body ? '\n' + esc(m.body) : ''}`, disable_notification: (m.prio || 3) <= 2 ? 'true' : 'false' };
  if (/^https:/.test(url)) p.reply_markup = JSON.stringify({ inline_keyboard: [[{ text: '📲 Open HotelOps', url }]] });
  // a form body: no pre-flight check
  return fetch('https://api.telegram.org/bot' + ch.token + '/sendMessage', { method: 'POST', body: new URLSearchParams(p) })
    .then(r => r.json()).then(j => !!(j && j.ok)).catch(() => false);
}

// ══ My shift (the same check as Shift alerts) ═══════════════
function shiftState(now) {
  return safe(() => {
    if (W.hoShiftAlerts && typeof W.hoShiftAlerts.shiftInfo === 'function') { const s = W.hoShiftAlerts.shiftInfo(); if (s && s.state) return s.state; }
    if (fn('hoMyDuty')) { const d = hoMyDuty(now); return d.state === 'off' ? 'off' : d.state === 'on' ? 'on' : 'unknown'; }
    return 'unknown';
  }, 'unknown');
}
const ctxNow = () => { const now = new Date(); return { cfg: CFG, now, shift: shiftState(now), openedAt }; };

// ══ One device sends: the claim ═════════════════════════════
/** true: sent from here · false: another device has it · null: can't ask the database (offline) */
async function fbClaim(key) {
  const R = safe(() => (typeof _ref !== 'undefined' && _ref) || null, null);
  if (!R || !uid() || (fn('isOnline') && !isOnline())) return null;
  try {
    const tx = R.child(P('claims/' + key)).transaction(cur => claimNext(cur, DEV, Date.now(), KEEP));
    const r = await Promise.race([tx, sleep(6000).then(() => 'late')]);
    if (r === 'late') return null;   // the database didn't answer in time: decide here
    const v = r && r.snapshot && typeof r.snapshot.val === 'function' ? r.snapshot.val() : null;
    return !!(r && r.committed && v && v.by === DEV);
  } catch (_) { return null; }
}
async function claim(key) {
  if (SENT[key]) return false;
  const won = await fbClaim(key);
  SENT[key] = Date.now(); lsSet(LS_SENT, SENT);
  return won !== false;
}

// ══ Send ════════════════════════════════════════════════════
function norm(o) {
  o = Object.assign({}, o || {});
  o.cat = CATS[o.cat] ? o.cat : 'system';
  o.prio = Math.min(5, Math.max(1, Math.round(+o.prio || 3)));
  o.title = String(o.title || (CATS[o.cat].i + ' ' + CATS[o.cat].l)).replace(/\s+/g, ' ').trim().slice(0, 140);
  o.body = String(o.body == null ? '' : o.body).trim().slice(0, 1200);
  o.key = fbKey(o.key || (o.cat + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)));
  if (o.tags && !Array.isArray(o.tags)) o.tags = [String(o.tags)];
  return o;
}
/** the one door: resolves true when it reached the phone (or is waiting in a batch that did) */
async function send(o) {
  try {
    o = norm(o);
    const g = gate(o, ctxNow());
    if (!g.ok) return false;
    if (!o.force && (SENT[o.key] || INFLIGHT.has(o.key))) return false;   // never the same alert twice
    // in the app, when it's in front: a toast (once per alert on this device)
    if (o.toast !== false && D.visibilityState === 'visible' && !TOASTED.has(o.key)) {
      TOASTED.add(o.key);
      toast(`${CATS[o.cat].i} ${o.title}${o.body ? ' — ' + o.body.split('\n')[0].slice(0, 90) : ''}`, o.prio >= 4 ? 'err' : 'info');
    }
    if (!o.claimed && !o.force) {
      INFLIGHT.add(o.key);
      let mine = false;
      try { mine = await claim(o.key); } finally { INFLIGHT.delete(o.key); }
      if (!mine) return false;   // another device of yours sends it
    }
    armRepeat(o);
    if (shouldBatch(o, RECENT, Date.now())) return queue(o);
    return deliver([o]);
  } catch (_) { return false; }
}
function queue(o) {
  return new Promise(res => {
    BUF.push({ o, res });
    if (BUF.length >= 6) flush();
    else if (!bufT) bufT = setTimeout(flush, BATCH_MS);
  });
}
async function flush() {
  clearTimeout(bufT); bufT = 0;
  const b = BUF.splice(0); if (!b.length) return false;
  const ok = await deliver(b.map(x => x.o)).catch(() => false);
  b.forEach(x => safe(() => x.res(ok)));
  return ok;
}
async function deliver(items) {
  const m = items.length === 1 ? items[0] : mergeBatch(items);
  if (!m) return false;
  const ch = channels();
  if (!ch.tg && !ch.ntfy) { addLog(m, false, 'no phone set up'); nudge(m); return false; }
  const r = await Promise.all([ntfyPost(ch.ntfy, m), tgPost(ch.tg, m)]).catch(() => [false, false]);
  const ok = r.some(Boolean);
  RECENT.push(Date.now()); RECENT = RECENT.filter(t => Date.now() - t < STORM.win);
  addLog(m, ok, [r[0] ? 'ntfy' : '', r[1] ? 'Telegram' : ''].filter(Boolean).join(' + ') || 'failed');
  return ok;
}
/** still not done after a while → once more, louder (only on the device that sent the first one) */
function armRepeat(o) {
  const R = o.repeat; if (!R || typeof R.check !== 'function') return;
  setTimeout(() => safe(() => {
    if (!R.check()) return;
    send(Object.assign({}, o, { key: o.key + '~r', prio: R.prio || Math.min(5, o.prio + 1), title: R.title || '🔁 Still not done: ' + o.title, body: R.body || o.body, repeat: null, instant: true, state: true, toast: true }));
  }), Math.max(MIN, +R.after || 5 * MIN));
}
/** nothing set up: say once where to set it up */
function nudge(m) {
  if (nudged || (m.prio || 3) < 4) return;
  nudged = true;
  toast('📲 Get alerts like this on your phone: Settings → 📲 Phone notifications → Set up', 'info');
}
function addLog(m, ok, via) {
  const e = { at: Date.now(), cat: m.cat || 'system', title: String(m.title || '').slice(0, 120), body: String(m.body || '').slice(0, 300), prio: m.prio || 3, n: m.n || 1, ok: !!ok, via: via || '' };
  LOG = [e].concat(LOG).slice(0, 20); lsSet(LS_LOG, LOG); renderSection();
  safe(() => {
    if (!uid()) return;
    if (fn('fbPushLog')) Promise.resolve(fbPushLog(P('log'), e, 20)).catch(() => {});
    else if (fn('fbSet')) Promise.resolve(fbSet(P('log'), LOG)).catch(() => {});
  });
}
/** old claims out of the way (our own notifyHub/{uid}/claims only) */
async function prune() {
  try {
    const now = Date.now();
    Object.keys(SENT).forEach(k => { if (now - SENT[k] > KEEP) delete SENT[k]; }); lsSet(LS_SENT, SENT);
    if (!uid() || !fn('fbGet') || (fn('isOnline') && !isOnline())) return;
    const C = await fbGet(P('claims'));
    Object.keys(C && typeof C === 'object' ? C : {}).forEach(k => { const at = C[k] && C[k].at || 0; if (now - at > KEEP && fn('fbSet')) fbSet(P('claims/' + k), null); });
  } catch (_) {}
}

// ══ Test + settings actions ═════════════════════════════════
function test() {
  if (!connected()) { toast('No phone set up yet — the setup opens now', 'warn'); setup(); return Promise.resolve(false); }
  return send({ cat: 'system', force: true, instant: true, toast: false, prio: 4, title: '🧪 Test from HotelOps', body: 'Phone notifications work ✓ Wake-up calls, shift tasks, the night run, departures and the roster will come here.', key: 'test_' + Date.now().toString(36) })
    .then(ok => { toast(ok ? '🧪 Test sent — check your phone' : 'Could not send — check the internet and try again', ok ? 'ok' : 'err'); return ok; });
}
function setup() { safe(() => { if (W.hoWaGuard && typeof W.hoWaGuard.open === 'function') W.hoWaGuard.open(); else toast('Open WhatsApp → 🛡 Away to set up phone alerts', 'warn'); }); }
function saveCfg() {
  lsSet(LS_CFG, CFG);
  safe(() => { if (uid() && fn('fbSet')) fbSet(P('cfg'), CFG); });
  renderSection();
}
function setCfg(k, v) { if (!(k in DEF) || k === 'cats') return; CFG = Object.assign({}, CFG, { [k]: v }); saveCfg(); }
function setCat(k, on) { if (!CATS[k]) return; CFG = Object.assign({}, CFG, { cats: Object.assign({}, CFG.cats, { [k]: !!on }) }); saveCfg(); }
function clearLog() { if (!confirm('Clear the recent alerts list?')) return; LOG = []; lsSet(LS_LOG, LOG); safe(() => { if (uid() && fn('fbSet')) fbSet(P('log'), null); }); renderSection(); }

// ══ Settings → 📲 Phone notifications ═══════════════════════
const TG_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#29a9eb"/><path d="M5.4 11.8l11.3-4.4c.5-.2 1 .1.8.9l-1.9 9c-.1.6-.5.8-1 .5l-2.9-2.1-1.4 1.3c-.2.2-.3.3-.6.3l.2-3 5.4-4.9c.2-.2 0-.3-.3-.1l-6.7 4.2-2.9-.9c-.6-.2-.6-.6.1-.9z" fill="#fff"/></svg>';
function stateLine() {
  const c = ctxNow(), q = inQuiet(CFG, c.now);
  const sh = c.shift === 'on' ? 'On shift now' : c.shift === 'unknown' ? 'Shift unknown (pick your name in Roster → My shifts)' : c.shift === 'soon' ? 'Your shift starts soon' : c.shift === 'ended' ? 'Your shift has ended' : 'Off shift by the roster';
  return `${sh}${c.shift !== 'on' && c.shift !== 'unknown' ? (CFG.offShift ? ' — alerting anyway' : ' — shift alerts wait') : ''}${q ? ' · 🌙 quiet hours now (urgent only)' : ''}`;
}
function sectionHtml() {
  const ic = safe(() => (fn('hoIcon') && hoIcon('feedback')) || '', '') || '📲';
  const ch = channels();
  const chRow = (on, icon, name, sub) => `<span class="nh-ch${on ? ' on' : ''}">${icon}<span><b>${name}</b><small>${sub}</small></span></span>`;
  const head = `<div class="hs-row nh-chs" data-s="phone notifications ntfy telegram connected set up channels">
      <span class="nh-chlist">${chRow(!!ch.tg, `<i class="nh-tg">${TG_SVG}</i>`, 'Telegram', ch.tg ? '@' + esc(ch.tg.bot || 'bot') + ' · connected' : 'not set up')}${chRow(!!ch.ntfy, '<i class="nh-ic">📳</i>', 'ntfy', ch.ntfy ? 'connected' : 'not set up')}</span>
      <span class="hs-inline">${ch.tg || ch.ntfy ? '<button class="btn sm" onclick="hoNotify.test()">🧪 Send a test</button><button class="btn sm ghost" onclick="hoNotify.setup()">Change</button>' : '<button class="btn gold" onclick="hoNotify.setup()">📲 Set up phone alerts</button>'}</span></div>
    ${ch.tg || ch.ntfy ? '' : '<div class="hs-row hs-mini nh-need" data-s="set up phone alerts telegram ntfy"><span class="hs-txt"><small>Uses the same Telegram bot or ntfy app as the WhatsApp 🛡 Away guard — set it up once, every alert below uses it.</small></span></div>'}`;
  const cats = Object.keys(CATS).filter(k => !CATS[k].hidden).map(k => `<label class="hs-row" data-s="${esc((CATS[k].l + ' ' + CATS[k].d + ' phone notifications').toLowerCase())}">
      <span class="hs-txt"><b>${CATS[k].i} ${esc(CATS[k].l)}</b><small>${esc(CATS[k].d)}</small></span>
      <span class="hs-switch"><input type="checkbox" ${catOn(CFG, k) ? 'checked' : ''} onchange="hoNotify.setCat('${k}', this.checked)" aria-label="${esc(CATS[k].l)}"><i></i></span></label>`).join('');
  const log = LOG.slice(0, 20).map(e => `<div class="nh-log-r${e.ok ? '' : ' bad'}"><span class="nh-log-t">${esc(hhmm(e.at))}</span><span class="nh-log-x"><b>${esc(e.title)}</b>${e.n > 1 ? `<em>${e.n} merged</em>` : ''}<small>${e.ok ? '✓ ' + esc(e.via) : '✕ ' + esc(e.via || 'not sent')}${e.prio >= 5 ? ' · urgent' : ''}</small></span></div>`).join('');
  return `<div class="hs-sec-hd"><span class="hs-sec-ic">${ic}</span><div><h2>📲 Phone notifications</h2><p>Everything HotelOps tells your phone, in one place — smart, not spammy</p></div></div>
    <div class="hs-card">${head}
      <div class="hs-row hs-mini" data-s="phone notifications status shift quiet"><span class="hs-txt"><small>${esc(stateLine())}. The same alert never comes twice, and only one of your devices sends it. Small things wait up to a minute and come together.</small></span></div>
      ${cats}
      <label class="hs-row" data-s="off shift day off roster phone notifications"><span class="hs-txt"><b>Alert me even off shift</b><small>Normally shift alerts (wake-ups, tasks, departures…) only come while you're on shift by the roster</small></span>
        <span class="hs-switch"><input type="checkbox" ${CFG.offShift ? 'checked' : ''} onchange="hoNotify.setCfg('offShift', this.checked)"><i></i></span></label>
      <div class="hs-row" data-s="quiet hours night mute phone notifications"><span class="hs-txt"><b>🌙 Quiet hours</b><small>Only urgent alerts (a wake-up call due, the guard) between these times</small></span>
        <span class="hs-inline nh-q"><input type="time" value="${esc(CFG.qFrom)}" aria-label="Quiet from" onchange="hoNotify.setCfg('qFrom', this.value)"><span>–</span><input type="time" value="${esc(CFG.qTo)}" aria-label="Quiet until" onchange="hoNotify.setCfg('qTo', this.value)">
        <label class="hs-switch"><input type="checkbox" ${CFG.quiet ? 'checked' : ''} onchange="hoNotify.setCfg('quiet', this.checked)" aria-label="Quiet hours on"><i></i></label></span></div>
      <div class="hs-row hs-col" data-s="recent alerts log history sent phone notifications"><span class="hs-txt nh-log-hd"><b>Recent alerts</b>${LOG.length ? '<button class="nh-clear" onclick="hoNotify.clearLog()">Clear</button>' : ''}</span>
        ${LOG.length ? `<div class="nh-log">${log}</div>` : '<small class="nh-empty">Nothing sent yet. Tap 🧪 Send a test to see how it looks.</small>'}</div>
    </div>`;
}
function renderSection() {
  try {
    const sec = D.getElementById('hs-notify'); if (!sec) return;
    if (sec.contains(D.activeElement) && D.activeElement.type === 'time') return;   // don't redraw under a time picker
    sec.innerHTML = sectionHtml();
  } catch (_) {}
}
function mountSection() {
  try {
    const box = D.getElementById('hsBody'); if (!box || !box.querySelector('.hs-sec') || D.getElementById('hs-notify')) return;
    const sec = D.createElement('section'); sec.className = 'hs-sec'; sec.id = 'hs-notify';
    sec.innerHTML = sectionHtml();
    const after = D.getElementById('hs-alerts');
    if (after && after.parentNode === box) after.after(sec); else box.appendChild(sec);
    const toc = D.querySelector('.hs-toc a[href="#hs-alerts"]');
    if (toc && !D.querySelector('.hs-toc a[href="#hs-notify"]')) toc.insertAdjacentHTML('afterend', '<a href="#hs-notify">Phone notifications</a>');
    const q = D.getElementById('hsSearch');
    if (q && q.value && fn('hoSettingsFilter')) hoSettingsFilter(q.value);
  } catch (_) {}
}
let obs = null;
function watchSettings() {
  const box = D.getElementById('hsBody');
  if (!box || obs) return !!obs;
  obs = new MutationObserver(mountSection);   // settings.js redraws #hsBody with innerHTML: put the section back
  obs.observe(box, { childList: true });
  mountSection();
  return true;
}

// ══ Things the hub watches itself (no changes to those pages) ═
/** your roster: your shifts changed, or a new roster with your days (compared with what this device saw last) */
function rosterTick() {
  safe(() => {
    if (typeof roMeKey === 'undefined' || !roMeKey || typeof roDays === 'undefined' || !Object.keys(roDays || {}).length || !fn('roCode') || !fn('roAdd') || !fn('roToday')) return;
    const cur = {};
    for (let i = 0; i < 21; i++) { const d = roAdd(roToday(), i); if (Object.keys(roDays[d] || {}).length) cur[d] = roCode(roMeKey, d) || ''; }
    const snap = lsGet(LS_RO, null);
    lsSet(LS_RO, { me: roMeKey, at: Date.now(), days: Object.assign({}, snap && snap.me === roMeKey ? snap.days : {}, cur) });
    if (!snap || snap.me !== roMeKey) return;   // first look (or another name): just remember
    const prev = {}; Object.keys(cur).forEach(d => { if (snap.days && d in snap.days) prev[d] = snap.days[d]; });
    const df = rosterDiff(prev, cur);
    const lbl = c => safe(() => (fn('roCellTxt') && fn('roInfo') ? roCellTxt(roInfo(c)) : c), c) || c || '—';
    const day = d => safe(() => (fn('roDayLbl') ? roDayLbl(d, true) : d), d);
    if (df.changed.length) {
      send({ cat: 'roster', prio: 4, state: true, url: 'roster', key: 'ro_chg_' + hash(roMeKey + JSON.stringify(df.changed)),
        title: `🗓 Your roster changed (${df.changed.length} day${df.changed.length === 1 ? '' : 's'})`,
        body: df.changed.slice(0, 7).map(c => `${day(c.d)}: ${lbl(c.f)} → ${lbl(c.t)}`).join('\n') + (df.changed.length > 7 ? `\n+${df.changed.length - 7} more` : '') });
    }
    // newly posted days: only when the roster was really just posted (not the first load of a fresh device)
    const posted = safe(() => (typeof roPosted !== 'undefined' && roPosted ? roPosted : null), null);
    if (df.added.length && posted && posted.at > (snap.at || 0) && Date.now() - posted.at < 24 * 60 * MIN && posted.byUid !== uid()) {
      send({ cat: 'roster', prio: 3, state: true, url: 'roster', key: 'ro_new_' + hash(roMeKey + posted.at),
        title: `🗓 New roster posted${posted.by ? ' by ' + posted.by : ''}`,
        body: df.added.slice(0, 7).map(a => `${day(a.d)}: ${lbl(a.t)}`).join('\n') + (df.added.length > 7 ? `\n+${df.added.length - 7} more` : '') });
    }
  });
}
/** HK requests left open past their time (wa-brain's requests log), once each */
function hkTick() {
  safe(() => {
    const B = W.hoWaBrain; if (!B || typeof B.openRequests !== 'function') return;
    const day = fn('hoLocalISO') ? hoLocalISO() : new Date().toISOString().slice(0, 10);
    (B.openRequests() || []).filter(it => it && it.overdue && it.id).forEach(it => send({ cat: 'hk', prio: 3, state: true, url: 'wa-bridge', key: `hk_${day}_${it.id}`,
      title: `🧹 Room ${it.room}: ${it.what || 'request'} still open`, body: `${it.open != null ? it.open + ' min' : 'A while'} since the guest asked${it.t ? ' (' + it.t + ')' : ''} — chase housekeeping.` }));
  });
}

// ══ Start ═══════════════════════════════════════════════════
function start() {
  if (started || !uid() || !fn('fbListen')) return;
  started = true;
  safe(() => fbListen(P('cfg'), v => { if (v && typeof v === 'object') { CFG = Object.assign({}, DEF, v); CFG.cats = Object.assign({}, DEF.cats, v.cats || {}); lsSet(LS_CFG, CFG); renderSection(); } }));
  safe(() => fbListen(P('log'), v => { const L = Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : null; if (L) { LOG = L.filter(e => e && e.at).sort((a, b) => b.at - a.at).slice(0, 20); lsSet(LS_LOG, LOG); renderSection(); } }));
  // the guard's setup: read only (wa-guard.js owns these)
  safe(() => fbListen('waGuard/' + uid() + '/tg', v => { TG = v && /^\d+:[\w-]{30,}$/.test(v.token || '') && v.chat ? { token: v.token, bot: v.bot || '', chat: v.chat } : null; renderSection(); }));
  safe(() => fbListen('waGuard/' + uid() + '/ntfy', v => { NTFY = v && /^hotelops-[a-z0-9]{12,40}$/.test(v.topic || '') ? { topic: v.topic } : null; renderSection(); }));
  setTimeout(prune, 60e3);
  setTimeout(rosterTick, 30e3);
  setTimeout(hkTick, 45e3);
}
const boot = setInterval(() => safe(() => { watchSettings(); if (uid()) start(); if (started && obs) clearInterval(boot); }), 1500);
setInterval(() => { if (started) rosterTick(); }, 60e3);
setInterval(() => { if (started) hkTick(); }, 2 * 60e3);
setInterval(() => { const s = D.getElementById('hs-notify'); if (s && s.offsetParent) renderSection(); }, 60e3);   // "on shift now", quiet hours
// a batch waiting when the page is hidden or closed: send it now
D.addEventListener('visibilitychange', () => { if (D.visibilityState === 'hidden' && BUF.length) flush(); });
// tapped an alert: "#go=wakeups" opens that page
if (/^#go=[\w-]+$/.test(location.hash)) {
  const pg = location.hash.slice(4);
  setTimeout(() => safe(() => {
    if (pg === 'wa-bridge' && fn('waOpenFromTop')) waOpenFromTop(); else if (fn('showPanel')) showPanel(pg);
    history.replaceState(null, '', location.pathname + location.search);
  }), 2500);
}

const css = D.createElement('style');
css.textContent = `
.nh-chs{flex-wrap:wrap}.nh-chlist{display:flex;gap:8px;flex-wrap:wrap;flex:1 1 260px;min-width:0}
.nh-ch{display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:12px;border:1px solid var(--border);background:var(--bg2);min-width:0;flex:1 1 140px}
.nh-ch>span{display:flex;flex-direction:column;min-width:0}.nh-ch b{font-size:13.5px}.nh-ch small{font-size:11.5px;color:var(--text3);overflow-wrap:anywhere}
.nh-ch.on{border-color:color-mix(in srgb,var(--mint,#22c55e) 45%,transparent);background:color-mix(in srgb,var(--mint,#22c55e) 9%,var(--card))}.nh-ch.on small{color:var(--mint,#16a34a)}
.nh-ch i{font-style:normal;width:26px;height:26px;flex:none;display:grid;place-items:center;font-size:19px}.nh-ch:not(.on) i{opacity:.55;filter:grayscale(1)}.nh-tg svg{width:24px;height:24px}
.nh-need{background:color-mix(in srgb,var(--amber,#d97706) 9%,transparent)}
.nh-q input[type=time]{min-width:0;width:132px}
.hs-txt.nh-log-hd{display:flex;flex-direction:row;align-items:center;justify-content:space-between;width:100%;text-align:left}.nh-clear{border:0;background:none;color:var(--accent);font:600 12.5px var(--font);cursor:pointer}
.nh-log{display:flex;flex-direction:column;border:1px solid var(--border);border-radius:12px;overflow:hidden}
.nh-log-r{display:flex;gap:10px;align-items:flex-start;padding:8px 12px;border-bottom:1px solid var(--border);font-size:12.5px;min-width:0}.nh-log-r:last-child{border-bottom:0}
.nh-log-t{font:600 12px var(--mono,monospace);color:var(--text3);padding-top:1px;flex:none}
.nh-log-x{display:flex;flex-direction:column;min-width:0;flex:1}.nh-log-x b{font-weight:600;color:var(--text);overflow-wrap:anywhere}.nh-log-x small{font-size:11.5px;color:var(--mint,#16a34a)}
.nh-log-x em{font-style:normal;font-size:10.5px;font-weight:700;align-self:flex-start;margin-top:2px;padding:0 7px;border-radius:99px;background:var(--accent-bg,var(--bg2));color:var(--accent)}
.nh-log-r.bad .nh-log-x small{color:var(--rose,#e11d48)}.nh-empty{color:var(--text3);font-size:12.5px}
@media (max-width:600px){.nh-ch{flex:1 1 100%}.nh-chs .hs-inline .btn{flex:1 1 auto}}`;
D.head.appendChild(css);

W.hoNotify = {
  send, test, setup, setCfg, setCat, clearLog, flush, connected, renderSection,
  /** an event this recent counts (older ones were before the app opened) */
  fresh: t => !!t && t >= openedAt - MIN,
  /** would this alert pass the switches, shift and quiet hours right now? (before doing work for it) */
  allows: o => safe(() => gate(norm(o), ctxNow()).ok, true),
  ready: () => started,
  cats: CATS,
  sent: key => !!SENT[fbKey(key)],
  get state() { return { cfg: JSON.parse(JSON.stringify(CFG)), started, openedAt, device: DEV, connected: connected(), shift: shiftState(new Date()), buffered: BUF.length, log: LOG.slice(), sent: Object.assign({}, SENT) }; },
};
})(typeof window !== 'undefined' ? window : globalThis);
