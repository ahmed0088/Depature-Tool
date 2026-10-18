// ═══════════════════════════════════════════════════════════
//  wa-bridge.js — WhatsApp HK group → Departures
//
//  "324 CO"          → room 324 checked out (as the card's Check out button)
//  "202 LCO 6PM"     → room 202 late check-out at 18:00
//  "415 change bed"  → a note on room 415
//  Every automatic change shows an Undo (also Ctrl+Z) and is written in the
//  room's note ("WhatsApp · Sam 9:01"), so the team sees where it came from.
//
//  Messages arrive two ways:
//   1. Linked: the console snippet (tools/hotelops-whatsapp.console.js) on
//      WhatsApp Web opens this app in a tab and postMessages each new message
//      ({source:'ho-wa', msg}); we answer {source:'ho-wa-ack', id}. Accepted only
//      from https://web.whatsapp.com (or this same window).
//   2. Pasted: text copied from WhatsApp Web ([9:01 AM, 18/10/2026] Sam: 324 CO)
//      or a phone "Export chat" .txt (18/10/2026, 9:01 am - Sam: 324 CO).
//
//  Only today's messages, only rooms on today's departures board. Each message
//  is applied once (localStorage ho_wa_done); an edited one only for what changed.
//  Pure helpers: hoWaParse(text), hoWaParseCopied(text), hoWaTime(s).
//  Load after departures.js (best after undo.js).
// ═══════════════════════════════════════════════════════════
(function () {
'use strict';
const W = typeof window !== 'undefined' ? window : globalThis;
const doc = typeof document !== 'undefined' ? document : null;

// ══ Parser (pure) ═══════════════════════════════════════════
const sp = s => String(s == null ? '' : s).replace(/[\u00a0\u202f\u2007]/g, ' ').replace(/[\u200e\u200f\u2066-\u2069]/g, '');

/** "6PM", "6 pm", "6:30pm", "18:00", "1800", "6.30 p.m.", "noon" → "18:00" (an hour 1-9 with no am/pm is afternoon) */
function hoWaTime(s) {
  let t = sp(s).toLowerCase().replace(/\b([ap])\.\s*m\.?/g, '$1m').replace(/(\d)\.(\d{2})\b/g, '$1:$2');
  if (/\bnoon\b/.test(t)) return '12:00';
  let h, mi = 0, ap = '', m;
  if ((m = t.match(/\b(\d{1,2})(?::?(\d{2}))?\s*(am|pm)\b/))) { h = +m[1]; mi = m[2] ? +m[2] : 0; ap = m[3]; }
  else if ((m = t.match(/\b(\d{1,2}):(\d{2})\b/))) { h = +m[1]; mi = +m[2]; }
  else if ((m = t.match(/\b(\d{3,4})\s*(?:hrs?|h)?\b/))) { const d = m[1]; h = +d.slice(0, d.length - 2); mi = +d.slice(-2); }
  else if ((m = t.match(/\b(\d{1,2})\s*(?:o'?clock|hrs?|h)?\b/))) { h = +m[1]; }
  else return '';
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (!ap && h >= 1 && h <= 9) h += 12;
  if (!(h >= 0 && h <= 23 && mi >= 0 && mi <= 59)) return '';
  return String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0');
}
/** "18:00" → "6 PM", "18:30" → "6:30 PM" */
function timeLabel(t) {
  const m = String(t || '').match(/^(\d{1,2}):(\d{2})$/); if (!m) return t || '';
  let h = +m[1]; const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return h + (m[2] === '00' ? '' : ':' + m[2]) + ' ' + ap;
}

const IGNORE_LINE = l => /^\s*🔁/u.test(l) || /Extensions\s*[—–-]/.test(l) || /\d{3,4}\s*·\s*\+\d+\s*N\s*→/.test(l);
const ROOM_AT = /^(?:(?:rooms?|rms?|rn)\.?\s*(?:no\.?\s*)?|#\s*)?(\d{3,4})(?![\d]|[:.]\d)/i;
const SEP = /^\s*(?:,|&|\+|\/|-|\band\b|\s)\s*/i;
const FILLER = /^(?:done|now|already|ok|okay|pls|please|plz|thanks?|thank\s*you|thx|sir|maam|ma'am|guys|team|hk|fo|room|rooms|is|are|the|guest|guests|[✅👍✔☑🙏.!,;:\s\u{1F3FB}-\u{1F3FF}])*$/iu;
const CO_NOT = /^(?:of|time|at|tomorrow|tmrw|tmr|later|by|after|before|pending|soon|in\s)/i;

function takeRooms(s) {
  const rooms = []; let m;
  while ((m = s.match(ROOM_AT))) {
    rooms.push(m[1]); s = s.slice(m[0].length);
    const sepM = s.match(SEP);
    if (sepM && ROOM_AT.test(s.slice(sepM[0].length))) { s = s.slice(sepM[0].length); continue; }
    break;
  }
  return { rooms, rest: s };
}
function classify(rest) {
  const r = sp(rest).trim().replace(/^[\s:\-–—=>.,]+/, '').replace(/[\s.!,;]+$/, '').trim();
  const low = r.toLowerCase();
  if (!r) return null;
  let m;
  if ((m = low.match(/^(?:lco|l\.c\.o\.?|l\/co|late\s*(?:check[\s-]*out|checkout|c\/o|c\.o\.?|co))(?![a-z])\s*(.*)$/))) {
    return { act: 'lco', time: hoWaTime(m[1]) };
  }
  if ((m = low.match(/^(?:co|c\/o|c\.o\.?|check(?:ed)?[\s-]*out|checkout|out)(?![a-z])\s*(.*)$/))) {
    const tail = m[1].trim();
    if (!tail || (FILLER.test(tail))) return { act: 'co' };
    if (!CO_NOT.test(tail) && !hoWaTimeStrict(tail)) return { act: 'co' };
  }
  return { act: 'note', note: r };
}
// a time written clearly (so "324 CO 2 pax" stays a check-out, "324 checkout 2pm" becomes a note)
function hoWaTimeStrict(s) { return /\b\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m|p\.m)\b|\b\d{1,2}:\d{2}\b/i.test(sp(s)); }

/**
 * One WhatsApp message → { kind: 'ignore'|'none'|'act', actions: [{room, act:'co'|'lco'|'note', time?, note?}] }
 * room keeps the digits as written ("0113"); match rooms with parseInt (0113 == 113).
 */
function hoWaParse(text) {
  const lines = sp(text).split(/\r?\n/);
  const kept = lines.filter(l => l.trim() && !IGNORE_LINE(l));
  if (lines.some(l => l.trim()) && !kept.length) return { kind: 'ignore', actions: [] };
  if (lines.some(l => /Extensions\s*[—–-]\s*\d{1,2}:\d{2}/.test(l))) return { kind: 'ignore', actions: [] };   // the app's own post
  const actions = [], seen = new Set();
  let pending = [], lastNote = null;
  const add = (rooms, c) => rooms.forEach(room => {
    const a = Object.assign({ room }, c), k = actionKey(a);
    if (!seen.has(k)) { seen.add(k); actions.push(a); }
  });
  kept.forEach(line => {
    // "202 CO, 205 LCO 2pm": a comma before another room starts a new part
    line.trim().split(/[,;]\s*(?=(?:(?:rooms?|rms?|rn)\.?\s*|#\s*)?\d{3,4}(?![\d]|[:.]\d))/i).forEach(seg => {
      const { rooms, rest } = takeRooms(seg.trim());
      const c = classify(rest);
      if (rooms.length && !c) { pending = pending.concat(rooms); return; }
      if (!c) return;
      const target = pending.concat(rooms); pending = [];
      if (target.length) { add(target, c); lastNote = c.act === 'note' ? actions.filter(a => a.act === 'note' && target.includes(a.room)) : null; }
      else if (lastNote && lastNote.length) lastNote.forEach(a => { a.note += ' ' + seg.trim().replace(/[\s.!,;]+$/, ''); });   // a note's next line
    });
  });
  return { kind: actions.length ? 'act' : 'none', actions };
}
function actionKey(a) { return [String(parseInt(a.room, 10)), a.act, a.time || '', a.note || ''].join(':'); }

// ══ Copied / exported chat text (pure) ══════════════════════
const DATE = '(\\d{1,4}[\\/.\\-]\\d{1,2}[\\/.\\-]\\d{1,4})';
const TIME = '(\\d{1,2}[:.]\\d{2}(?:[:.]\\d{2})?(?:\\s*[ap]\\.?\\s*m\\.?)?)';
const RX = [
  { re: new RegExp('^\\[' + TIME + ',\\s*' + DATE + '\\]\\s*([^:]{1,80}?):\\s?([\\s\\S]*)$', 'i'), t: 1, d: 2 },            // [9:01 AM, 18/10/2026] Sam: text (WhatsApp Web copy)
  { re: new RegExp('^\\[' + DATE + ',?\\s+' + TIME + '\\]\\s*([^:]{1,80}?):\\s?([\\s\\S]*)$', 'i'), t: 2, d: 1 },           // [18/10/2026, 9:01:05 AM] Sam: text (iPhone export)
  { re: new RegExp('^' + DATE + ',?\\s+' + TIME + '\\s+[-–]\\s+([^:]{1,80}?):\\s?([\\s\\S]*)$', 'i'), t: 2, d: 1 },         // 18/10/2026, 9:01 am - Sam: text (Android export)
];
const SYSTEM = [
  new RegExp('^\\[' + TIME + ',\\s*' + DATE + '\\]'), new RegExp('^\\[' + DATE + ',?\\s+' + TIME + '\\]'), new RegExp('^' + DATE + ',?\\s+' + TIME + '\\s+[-–]\\s'),
];
/** WhatsApp text → [{date, time, sender, text}] (lines that are not a new message belong to the one above) */
function hoWaParseCopied(text) {
  const out = []; let cur = null;
  sp(text).split(/\r?\n/).forEach(raw => {
    const line = raw.replace(/^\ufeff/, '');
    if (/^\s*#hotelops-wa\s*$/i.test(line)) { cur = null; return; }
    let hit = null;
    for (const x of RX) { const m = line.match(x.re); if (m) { hit = { time: m[x.t].trim(), date: m[x.d].trim(), sender: m[3].trim(), text: m[4] }; break; } }
    if (hit) { cur = hit; out.push(cur); return; }
    if (SYSTEM.some(re => re.test(line))) { cur = null; return; }   // "Messages are end-to-end encrypted", "Sam added Lina"…
    if (cur) cur.text += '\n' + line;
  });
  out.forEach(m => { m.text = m.text.replace(/\s+$/, ''); });
  return out;
}
const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** "18/10/2026" or "10/18/26" → ISO day; when either reading is today, today */
function waDateISO(date, now) {
  const p = sp(date).trim().split(/[\/.\-]/).map(x => parseInt(x, 10));
  if (p.length !== 3 || p.some(isNaN)) return '';
  const iso = (y, m, d) => { if (y < 100) y += 2000; if (m < 1 || m > 12 || d < 1 || d > 31) return ''; return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; };
  if (p[0] > 31) return iso(p[0], p[1], p[2]);
  const dm = iso(p[2], p[1], p[0]), md = iso(p[2], p[0], p[1]), today = isoDay(now || new Date());
  if (dm === today || md === today) return today;
  if (p[0] > 12) return dm;
  if (p[1] > 12) return md;
  return dm;
}
/** "9:01 AM" / "21:05" / "9.01 pm" → "09:01" / "21:05" / "21:01" */
function waTime24(t) {
  const m = sp(t).toLowerCase().match(/(\d{1,2})[:.](\d{2})(?:[:.]\d{2})?\s*([ap])?/);
  if (!m) return '';
  let h = +m[1]; const mi = m[2];
  if (m[3] === 'p' && h < 12) h += 12;
  if (m[3] === 'a' && h === 12) h = 0;
  return h > 23 ? '' : String(h).padStart(2, '0') + ':' + mi;
}

W.hoWaParse = hoWaParse; W.hoWaParseCopied = hoWaParseCopied; W.hoWaTime = hoWaTime;
W.hoWaPure = { hoWaParse, hoWaParseCopied, hoWaTime, timeLabel, waDateISO, waTime24, actionKey };
if (!doc) return;

// ══ Storage ═════════════════════════════════════════════════
const LS_DONE = 'ho_wa_done', LS_LOG = 'ho_wa_log_v1';
const today = () => (typeof hoLocalISO === 'function' ? hoLocalISO() : isoDay(new Date()));
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
function loadDone() { const d = lsGet(LS_DONE, {}); return d && typeof d === 'object' ? d : {}; }
function saveDone(d) { const ks = Object.keys(d); if (ks.length > 1000) ks.slice(0, ks.length - 1000).forEach(k => delete d[k]); lsSet(LS_DONE, d); }
let LOG = (() => { const l = lsGet(LS_LOG, null); return l && l.date === today() && Array.isArray(l.items) ? l.items : []; })();
function saveLog() { if (LOG.length > 300) LOG = LOG.slice(0, 300); lsSet(LS_LOG, { date: today(), items: LOG }); }
const undoFns = {};        // log key → undo (this session only)

// ══ Acting on the board ═════════════════════════════════════
const FIELDS = ['status', 'checkoutAt', 'naTime', 'dndTime', 'lateTime', 'extensionNights', 'extCheckoutTime', 'extRate', 'extReason', 'extConfirmed', 'intent', 'intentMinutes', 'lcoAcknowledged', 'note'];
const J = o => JSON.stringify(o === undefined ? null : o);
const clone = o => JSON.parse(J(o));
const pick = r => { const o = {}; FIELDS.forEach(k => { o[k] = r[k] === undefined ? null : clone(r[k]); }); return o; };
const rooms = () => (typeof depRooms !== 'undefined' ? depRooms : []);
const dlog = () => (typeof depLog !== 'undefined' ? depLog : []);
const quiet = fn => (W.hoUndo && typeof W.hoUndo.quietly === 'function') ? W.hoUndo.quietly(fn) : fn();
const hhmm = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const paint = () => { try { depRender(); } catch (_) {} try { updateDepBadge(); } catch (_) {} };
const roomIdx = room => { const n = parseInt(room, 10); return rooms().findIndex(r => parseInt(r.roomStr, 10) === n); };
function boardIsToday() {
  if (!rooms().length) return { ok: false, why: 'no departures loaded' };
  let d = null; try { d = typeof _depBoardDate === 'function' ? _depBoardDate() : null; } catch (_) {}
  if (d && isoDay(d) !== today()) return { ok: false, why: 'the board is for ' + d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) };
  return { ok: true };
}
function addNoteLine(r, line) { r.note = r.note ? r.note + '\n' + line : line; }
function dropLine(note, line) { const L = String(note || '').split('\n'); const i = L.lastIndexOf(line); if (i >= 0) L.splice(i, 1); return L.join('\n'); }

/** put a room back as it was before our change (status: the depAction status we set, or null) */
function restore(roomStr, before, after, line, topJ, status) {
  const z = rooms().find(q => q.roomStr === roomStr);
  if (!z) { showToast(`Room ${roomStr} is no longer on the board`, 'warn'); return false; }
  if (z.status !== after.status) { showToast(`Room ${roomStr} changed since — not undone`, 'warn'); return false; }
  FIELDS.forEach(k => {
    if (k === 'note') { z.note = z.note === after.note ? (before.note === null ? '' : before.note) : dropLine(z.note, line); return; }
    if (before[k] === null) delete z[k]; else z[k] = clone(before[k]);
  });
  if (status) {
    const L = dlog(), li = L.findIndex(l => J(l) === topJ);
    const u = { room: roomStr, name: z.name, action: 'undo', undone: status, time: hhmm(), roomIdx: rooms().indexOf(z), prevStatus: status };
    if (li >= 0) L.splice(li, 1, u); else L.unshift(u);
  }
  paint(); saveDeps();
  if (typeof logActivity === 'function') try { logActivity('departure_undo', `Room ${roomStr}: WhatsApp change undone`); } catch (_) {}
  return true;
}

/** one action → {room, act, time, st, text, undo?} */
function applyOne(a, who, board) {
  const res = { room: a.room, act: a.act, time: a.time || '', note: a.note || '' };
  if (!board.ok) return Object.assign(res, { st: 'notlist', text: `${a.room}: not on today's list (${board.why})` });
  const i = roomIdx(a.room);
  if (i < 0) return Object.assign(res, { st: 'notlist', text: `${a.room}: not on today's departures` });
  const r = rooms()[i], room = r.roomStr, st = r.status, before = pick(r);
  let line, setStatus = null;
  if (a.act === 'co') {
    if (st === 'out') return Object.assign(res, { st: 'skip', text: `${room}: already checked out` });
    if (st === 'extended') return Object.assign(res, { st: 'skip', text: `${room}: marked extended — not changed` });
    line = `[${hhmm()}] Checked out — ${who}`;
    addNoteLine(r, line); setStatus = 'out';
    quiet(() => depAction(i, 'out'));
    res.st = 'co'; res.text = `${room} checked out` + (r.balance > 0 ? ` · ⚠ balance AED ${r.balance}` : '');
  } else if (a.act === 'lco') {
    if (st === 'out') return Object.assign(res, { st: 'skip', text: `${room}: already checked out` });
    if (st === 'extended') return Object.assign(res, { st: 'skip', text: `${room}: marked extended — not changed` });
    line = `[${hhmm()}] Late check-out ${a.time ? timeLabel(a.time) : '(no time given)'} — ${who}`;
    addNoteLine(r, line);
    if (st === 'late') { if (a.time) r.lateTime = a.time; paint(); saveDeps(); }
    else { r.lateTime = a.time || ''; setStatus = 'late'; quiet(() => depAction(i, 'late')); }
    res.st = 'lco'; res.text = `${room} late check-out ${a.time ? timeLabel(a.time) : '(no time)'}`;
  } else {
    line = `[${hhmm()}] ${who}: ${a.note}`;
    addNoteLine(r, line); paint(); saveDeps();
    res.st = 'note'; res.text = `${room} note: ${a.note}`;
  }
  const z = rooms().find(q => q.roomStr === room) || r, after = pick(z), topJ = setStatus ? J(dlog()[0]) : null;
  res.undo = () => restore(room, before, after, line, topJ, setStatus);
  return res;
}

// ══ The pipeline ════════════════════════════════════════════
const T0 = Date.now();
function ready() {
  const signedIn = typeof currentProfile !== 'undefined' && !!currentProfile;
  if (!signedIn || typeof depRooms === 'undefined') return false;
  if (typeof depIsTyping === 'function' && depIsTyping()) return false;
  return rooms().length > 0 || Date.now() - T0 > 12000;
}
const normS = s => sp(s).replace(/\s+/g, ' ').trim();
function once(fn) { let done = false; return () => { if (done) return false; done = true; return fn(); }; }

/**
 * Handle one message {id?, text, sender, mine, time, date, edited}.
 * opt.batch: collect undo + counts instead of toasting. Returns 'wait' | 'old' | 'dup' | 'done'.
 */
function handle(msg, via, opt) {
  opt = opt || {};
  const text = String(msg && msg.text || '').slice(0, 4000);
  const sender = normS(msg && msg.sender || '').slice(0, 60) || (msg && msg.mine ? 'Me' : 'WhatsApp');
  const tIso = today();
  const dIso = msg.date ? waDateISO(msg.date, new Date()) : tIso;
  if (dIso !== tIso) return 'old';
  if (via === 'link' && !ready()) return 'wait';
  if (!text.trim()) return 'dup';
  const t24 = waTime24(msg.time) || hhmm();
  const ck = 'c:' + dIso + '|' + t24 + '|' + sender.toLowerCase() + '|' + normS(text);
  const id = msg.id ? 'i:' + String(msg.id).slice(0, 200) : ck;
  const done = loadDone();
  const prev = done[id];
  if (done[ck] !== undefined && (prev === undefined || id === ck)) return 'dup';   // the same message seen before (linked or pasted)
  const P = hoWaParse(text);
  let actions = P.actions, edited = !!msg.edited;
  if (prev !== undefined) {
    const old = new Set(String(prev).split('|').filter(Boolean));
    actions = actions.filter(a => !old.has(actionKey(a)));
    if (!actions.length) { done[id] = P.actions.map(actionKey).join('|'); done[ck] = ''; saveDone(done); return 'dup'; }
    edited = true;
  }
  const tl = timeLabel(t24);
  const who = `WhatsApp · ${sender} ${tl}${edited ? ' (edited)' : ''}`;
  const board = boardIsToday();
  const res = P.kind === 'ignore' ? [{ st: 'ignore', text: 'HotelOps post — ignored' }]
    : !actions.length ? [{ st: 'none', text: 'no room — just logged' }]
    : actions.map(a => applyOne(a, who, board));
  done[id] = P.actions.map(actionKey).join('|'); done[ck] = ''; saveDone(done);

  const key = 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const undos = res.filter(r => r.undo).map(r => r.undo);
  const entry = { key, at: Date.now(), time: t24, sender, text: text.slice(0, 500), mine: !!msg.mine, edited, via, res: res.map(r => ({ st: r.st, room: r.room || '', text: r.text })) };
  LOG.unshift(entry); saveLog();
  let undoAll = null;
  if (undos.length) {
    undoAll = once(() => { let ok = false; undos.slice().reverse().forEach(u => { try { if (u()) ok = true; } catch (_) {} }); if (ok) { entry.undone = true; saveLog(); renderCard(); } return ok; });
    undoFns[key] = undoAll;
  }
  if (opt.batch) { opt.batch.undos.push(undoAll); res.forEach(r => { opt.batch.n[r.st] = (opt.batch.n[r.st] || 0) + 1; }); }
  else {
    const acted = res.filter(r => r.undo);
    if (acted.length && typeof showUndoToast === 'function') {
      const lbl = acted.length === 1 ? acted[0].text.replace(/ · ⚠.*/, '').replace(/^(\d+)/, 'Room $1') : acted.map(r => r.text.replace(/ · ⚠.*/, '')).join(' · ');
      showUndoToast(`${lbl} (WhatsApp · ${sender} ${tl})`, undoAll, 10000);
    }
    const nl = res.filter(r => r.st === 'notlist');
    if (nl.length && !acted.length && typeof showToast === 'function') showToast(`WhatsApp: ${nl.map(r => r.room).join(', ')} not on today's departures`, 'warn');
  }
  renderCard();
  return 'done';
}

/** a whole pasted chat at once: one summary toast with "Undo all" */
function readPasted(text) {
  const list = hoWaParseCopied(text);
  if (!list.length) { showToast('No WhatsApp messages found. Copy them with the time and name, like [9:01 AM, 18/10/2026] Sam: 324 CO', 'warn'); return null; }
  const batch = { undos: [], n: {} };
  let old = 0, dup = 0, read = 0;
  list.forEach(m => { const r = handle(m, 'paste', { batch }); if (r === 'old') old++; else if (r === 'dup') dup++; else read++; });
  const n = batch.n, parts = [`Read ${read} message${read === 1 ? '' : 's'}`];
  if (n.co) parts.push(`${n.co} checked out`);
  if (n.lco) parts.push(`${n.lco} late checkout${n.lco === 1 ? '' : 's'}`);
  if (n.note) parts.push(`${n.note} note${n.note === 1 ? '' : 's'}`);
  if (n.notlist) parts.push(`${n.notlist} not on today's list`);
  const ign = (n.none || 0) + (n.ignore || 0) + (n.skip || 0); if (ign) parts.push(`${ign} ignored`);
  if (dup) parts.push(`${dup} already done`);
  if (old) parts.push(`${old} not from today`);
  const msg = parts.join(' · ');
  const undos = batch.undos.filter(Boolean);
  if (undos.length && typeof showUndoToast === 'function') {
    const all = once(() => { undos.slice().reverse().forEach(u => { try { u(); } catch (_) {} }); renderCard(); });
    showUndoToast(msg, all, 10000);
    const b = doc.getElementById('undoToastBtn'); if (b) b.textContent = '↺ Undo all';
  } else showToast(msg, read ? 'ok' : 'info');
  return { read, old, dup, counts: n, msg };
}

// ══ Messages from the WhatsApp tab ══════════════════════════
const ORIGINS = ['https://web.whatsapp.com'];
let linkSeen = 0;
W.addEventListener('message', e => {
  const d = e.data;
  if (!d || typeof d !== 'object' || d.source !== 'ho-wa') return;
  const same = e.source === W && e.origin === location.origin;
  if (!same && !ORIGINS.includes(e.origin)) return;
  const reply = o => { try { if (same) W.postMessage(o, location.origin); else if (e.source) e.source.postMessage(o, e.origin); } catch (_) {} };
  if (!same) { const was = linkSeen; linkSeen = Date.now(); if (!was || Date.now() - was > 20000) renderStatus(); }
  if (d.ping) { reply({ source: 'ho-wa-pong', ready: ready() }); return; }
  const m = d.msg;
  if (!m || typeof m !== 'object' || !m.id) return;
  const r = handle(m, same ? 'page' : 'link');
  if (r !== 'wait') reply({ source: 'ho-wa-ack', id: m.id });
});

// ══ The card on Departures ══════════════════════════════════
const CSS = `
#tbWhatsApp{color:#25d366}
#tbWhatsApp:hover{color:#2fe076}
#waOv{position:fixed;inset:0;z-index:9000;display:flex;align-items:flex-start;justify-content:center;padding:6vh 16px 16px;background:rgba(0,0,0,.55);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);animation:waFade .16s ease}
#waOv[hidden]{display:none}
#waOv #waCard{margin:0;width:min(760px,100%);max-height:88vh;display:flex;flex-direction:column;box-shadow:0 24px 60px -20px rgba(0,0,0,.6);animation:waUp .2s ease}
#waOv #waCard>summary{cursor:default;flex:none}
#waOv #waCard>summary:hover{background:transparent}
#waOv #waCard .wa-body{overflow-y:auto}
#waCard .wa-x{margin-left:auto;flex:none;width:34px;height:34px;border-radius:9px;border:1px solid var(--border);background:var(--card2,var(--bg2));color:var(--text2);cursor:pointer;font-size:14px}
#waCard .wa-x:hover{color:var(--text);border-color:var(--accent-border,var(--border))}
@keyframes waFade{from{opacity:0}to{opacity:1}}
@keyframes waUp{from{opacity:0;transform:translateY(10px) scale(.985)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){#waOv,#waOv #waCard{animation:none}}
@media (max-width:600px){#waOv{padding:10px}#waOv #waCard{max-height:calc(100vh - 20px)}}
#waCard{margin-top:16px;background:var(--card);border:1px solid var(--border);border-radius:var(--r,12px);overflow:hidden;color:var(--text)}
#waCard>summary{list-style:none;display:flex;align-items:center;gap:10px;min-height:52px;padding:0 16px;cursor:pointer;font:700 14px var(--font,inherit)}
#waCard>summary::-webkit-details-marker{display:none}
#waCard>summary:hover{background:var(--bg2)}
#waCard .wa-n{font:600 11px var(--mono,monospace);padding:2px 7px;border-radius:99px;background:var(--bg2);color:var(--text2);border:1px solid var(--border)}
#waCard .wa-last{flex:1;min-width:0;font-weight:500;font-size:12px;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#waCard .wa-tog{font:600 11.5px var(--font,inherit);color:var(--text3);white-space:nowrap}
#waCard[open] .wa-tog{transform:rotate(180deg)}
#waCard .wa-body{border-top:1px solid var(--border);padding:12px 16px 16px;display:grid;gap:12px}
#waCard .wa-st{font-size:12.5px;color:var(--text2);display:flex;gap:8px;align-items:center;flex-wrap:wrap}
#waCard .wa-dot{width:8px;height:8px;border-radius:50%;background:var(--text3);flex:none}
#waCard .wa-dot.on{background:var(--green)}
#waCard .wa-list{max-height:320px;overflow-y:auto;border:1px solid var(--border);border-radius:10px;background:var(--card2,var(--bg2))}
#waCard .wa-row{display:grid;grid-template-columns:auto 1fr auto;gap:4px 10px;padding:8px 10px;border-bottom:1px solid var(--border);font-size:12.5px;align-items:start}
#waCard .wa-row:last-child{border-bottom:0}
#waCard .wa-t{font:500 11.5px var(--mono,monospace);color:var(--text3);padding-top:1px}
#waCard .wa-m{min-width:0}
#waCard .wa-who{font-weight:700;color:var(--text2);margin-right:4px}
#waCard .wa-txt{color:var(--text);overflow-wrap:anywhere;white-space:pre-wrap}
#waCard .wa-res{grid-column:2/4;display:flex;flex-wrap:wrap;gap:4px}
#waCard .wa-chip{font-size:11.5px;padding:2px 8px;border-radius:99px;border:1px solid var(--border);background:var(--bg2);color:var(--text2);overflow-wrap:anywhere}
#waCard .wa-chip.co{color:var(--green);border-color:color-mix(in srgb,var(--green) 40%,transparent)}
#waCard .wa-chip.lco{color:var(--amber,var(--accent));border-color:color-mix(in srgb,var(--amber,var(--accent)) 40%,transparent)}
#waCard .wa-chip.notlist{color:var(--red);border-color:color-mix(in srgb,var(--red) 40%,transparent)}
#waCard .wa-row.undone .wa-res{opacity:.55;text-decoration:line-through}
#waCard .wa-u{all:unset;cursor:pointer;font:600 11.5px var(--font,inherit);color:var(--text2);padding:3px 9px;border:1px solid var(--border2,var(--border));border-radius:7px;white-space:nowrap}
#waCard .wa-u:hover{color:var(--text);background:var(--bg2)}
#waCard .wa-empty{padding:14px;color:var(--text3);font-size:12.5px;text-align:center}
#waCard h4{margin:0 0 6px;font:700 12.5px var(--font,inherit);color:var(--text2);text-transform:none}
#waCard textarea{box-sizing:border-box;width:100%;min-height:84px;resize:vertical;background:var(--bg2);color:var(--text);border:1px solid var(--border);border-radius:10px;padding:9px 11px;font:12.5px/1.45 var(--mono,monospace)}
#waCard .wa-btns{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
#waCard .wa-btn{all:unset;box-sizing:border-box;cursor:pointer;padding:8px 13px;border-radius:9px;border:1px solid var(--border2,var(--border));background:var(--bg2);color:var(--text);font:600 12.5px var(--font,inherit)}
#waCard .wa-btn:hover{border-color:var(--accent)}
#waCard .wa-btn.pri{background:var(--accent);border-color:var(--accent);color:var(--bg,#111)}
#waCard .wa-row.quiet{opacity:.6;padding-top:6px;padding-bottom:6px}
#waCard .wa-row.quiet .wa-res{display:none}
#waCard details.wa-help{border:1px solid var(--border);border-radius:10px;padding:0 12px}
#waCard details.wa-help>summary{cursor:pointer;padding:10px 0;font:700 12.5px var(--font,inherit);color:var(--text2)}
#waCard .wa-help ol{margin:4px 0 10px;padding-left:20px;font-size:12.5px;line-height:1.55;color:var(--text2)}
#waCard .wa-help p{font-size:12.5px;color:var(--text2);margin:6px 0}
#waCard .wa-help code{font:12px var(--mono,monospace);background:var(--bg2);padding:1px 5px;border-radius:5px;color:var(--text)}
#waCard .wa-help textarea{min-height:70px;font-size:11px}
@media (max-width:600px){#waCard>summary{padding:0 12px}#waCard .wa-body{padding:10px 12px 14px}#waCard .wa-last{display:none}#waCard .wa-btn{flex:1 1 auto;text-align:center}}
`;
const esc = s => (typeof escapeHtml === 'function' ? escapeHtml(s) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
const clock = t => { const m = String(t || '').match(/^(\d{1,2}):(\d{2})$/); if (!m) return t || ''; const h = +m[1]; return (h % 12 || 12) + ':' + m[2] + (h >= 12 ? ' PM' : ' AM'); };
const ICON = { co: '✓', lco: '⏰', note: '📝', notlist: '⚠', skip: '·', none: '—', ignore: '—' };

function mount() {
  if (doc.getElementById('waCard')) return true;
  const panel = doc.getElementById('panel-departures'); if (!panel) return false;
  const st = doc.createElement('style'); st.id = 'waCss'; st.textContent = CSS; doc.head.appendChild(st);
  const card = doc.createElement('details'); card.id = 'waCard';
  card.open = true;   // it lives in its own window (top bar 🟢 button), always open
  card.innerHTML = `<summary><span aria-hidden="true">💬</span><span>WhatsApp HK group</span><span class="wa-n" id="waCount">0</span><span class="wa-last" id="waLast"></span><button type="button" class="wa-x" id="waClose" aria-label="Close" title="Close (Esc)">✕</button></summary>
  <div class="wa-body">
    <div class="wa-st" id="waStatus"></div>
    <div class="wa-list" id="waList" aria-live="polite"></div>
    <div>
      <h4>Paste from WhatsApp</h4>
      <textarea id="waPaste" placeholder="[9:01 AM, 18/10/2026] Sam: 324 CO&#10;[9:05 AM, 18/10/2026] Lina: 202 LCO 6PM" aria-label="Paste WhatsApp messages"></textarea>
      <div class="wa-btns">
        <button type="button" class="wa-btn pri" id="waRead">Read messages</button>
        <button type="button" class="wa-btn" id="waClip">📋 Paste</button>
        <button type="button" class="wa-btn" id="waUpBtn">📂 Upload exported chat (.txt)</button>
        <input type="file" id="waFile" accept=".txt,text/plain" hidden>
      </div>
    </div>
    <details class="wa-help" id="waHelp"><summary>❔ How to set up</summary>
      <p><b>What it does:</b> when someone writes <code>324 CO</code> in the HK group, room 324 is checked out here. <code>202 LCO 6PM</code> sets a 6 PM late check-out. Other messages with a room (like <code>415 change bedsheet</code>) become a note. Every change has an Undo. Only today's messages and only rooms on today's list.</p>
      <p><b>Option A — automatic</b></p>
      <ol>
        <li>Open WhatsApp Web on this computer.</li>
        <li>Press <b>F12</b> and click <b>Console</b>.</li>
        <li>If Chrome asks, type <code>allow pasting</code> and press Enter.</li>
        <li>Copy the line below (<b>Copy</b> button), paste it in the Console and press Enter. Close F12.</li>
        <li>Type the HK group name when asked, then open the HK group.</li>
        <li>Click the small HotelOps badge (bottom left) once. A HotelOps tab opens — keep it open.</li>
      </ol>
      <p>Do this again each time you reload WhatsApp. If the badge turns amber, use its copy button and paste here.</p>
      <textarea id="waSnippet" readonly aria-label="Line to paste in the WhatsApp Console">Loading…</textarea>
      <div class="wa-btns"><button type="button" class="wa-btn" id="waCopySnip">Copy</button></div>
      <p><b>Option B — no setup, always works</b></p>
      <ol>
        <li>In WhatsApp Web, with the mouse, click and drag from the first message of today down to the last one.</li>
        <li>Press <b>Ctrl+C</b>. (WhatsApp copies the time and name with each message.)</li>
        <li>Paste in the box above and press <b>Read messages</b>. Messages already done are skipped, so you can paste the whole day again later.</li>
      </ol>
      <p><b>From the phone:</b> open the chat → ⋮ → More → Export chat → Without media. Send the .txt to this computer and use <b>📂 Upload exported chat</b>.</p>
    </details>
  </div>`;
  // its own window over the app, opened from the top bar
  const ov = doc.createElement('div'); ov.id = 'waOv'; ov.className = 'wa-ov'; ov.hidden = true;
  ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'WhatsApp HK group');
  ov.appendChild(card); doc.body.appendChild(ov);
  card.querySelector('summary').addEventListener('click', e => { e.preventDefault(); if (e.target.closest('#waClose')) waClose(); });
  ov.addEventListener('mousedown', e => { if (e.target === ov) waClose(); });
  doc.addEventListener('keydown', e => { if (e.key === 'Escape' && !ov.hidden) { e.preventDefault(); waClose(); } });
  if (/wa-bridge/.test(location.hash)) setTimeout(() => window.waOpenFromTop && window.waOpenFromTop(), 400);
  const ta = doc.getElementById('waPaste');
  doc.getElementById('waRead').onclick = () => { const v = ta.value; if (!v.trim()) { showToast('Paste the WhatsApp messages first', 'warn'); ta.focus(); return; } if (readPasted(v)) ta.value = ''; };
  doc.getElementById('waClip').onclick = async () => {
    try { const t = await navigator.clipboard.readText(); if (!t || !t.trim()) { showToast('The clipboard is empty', 'warn'); return; } ta.value = t; if (readPasted(t)) ta.value = ''; }
    catch (_) { showToast('Press Ctrl+V in the box, then Read messages', 'info'); ta.focus(); }
  };
  const fi = doc.getElementById('waFile');
  doc.getElementById('waUpBtn').onclick = () => fi.click();
  fi.onchange = () => { const f = fi.files && fi.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { readPasted(String(rd.result || '')); fi.value = ''; }; rd.readAsText(f); };
  doc.getElementById('waHelp').addEventListener('toggle', loadSnippet);
  doc.getElementById('waCopySnip').onclick = () => {
    const s = doc.getElementById('waSnippet'); const v = s.value;
    if (!v || /^Loading|^Could not/.test(v)) return;
    const done = () => showToast('Copied · paste it in the WhatsApp Web Console', 'ok');
    try { navigator.clipboard.writeText(v).then(done, () => { s.select(); doc.execCommand('copy'); done(); }); } catch (_) { s.select(); try { doc.execCommand('copy'); done(); } catch (__) {} }
  };
  doc.getElementById('waList').addEventListener('click', e => {
    const b = e.target.closest('[data-wa-undo]'); if (!b) return;
    const f = undoFns[b.getAttribute('data-wa-undo')]; if (f) f();
  });
  renderCard();
  return true;
}
let snipLoaded = false;
function loadSnippet() {
  if (snipLoaded) return; snipLoaded = true;
  const box = doc.getElementById('waSnippet'); if (!box) return;
  const app = location.origin + location.pathname;
  fetch('tools/hotelops-whatsapp.console.js', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(r.status); return r.text(); })
    .then(t => { box.value = t.replace("'__HO_APP_URL__'", JSON.stringify(app)); })
    .catch(() => { snipLoaded = false; box.value = 'Could not load it (offline?). Try again when online, or use Option B.'; });
}
function renderStatus() {
  const el = doc.getElementById('waStatus'); if (!el) return;
  const on = linkSeen && Date.now() - linkSeen < 20000;
  el.innerHTML = on ? '<span class="wa-dot on"></span><span>Linked to WhatsApp Web ✓ — keep this tab open.</span>'
    : `<span class="wa-dot"></span><span>${LOG.length ? 'Not linked right now. ' : ''}New HK messages show here. Set up once with <b>❔ How to set up</b>, or paste messages below.</span>`;
}
function renderCard() {
  const list = doc.getElementById('waList'); if (!list) return;
  const cnt = doc.getElementById('waCount'); if (cnt) cnt.textContent = LOG.length;
  const last = doc.getElementById('waLast');
  if (last) { const l = LOG.find(x => x.res.some(r => /co|lco|note/.test(r.st))); last.textContent = l ? `Last: ${l.res.find(r => /co|lco|note/.test(r.st)).text} · ${timeLabel(l.time)}` : ''; }
  list.innerHTML = LOG.length ? LOG.map(l => `<div class="wa-row${l.undone ? ' undone' : ''}${l.res.every(r => r.st === 'none' || r.st === 'ignore') ? ' quiet' : ''}" title="${esc(l.res.map(r => r.text).join(' · '))}">
      <span class="wa-t">${esc(clock(l.time))}</span>
      <span class="wa-m"><span class="wa-who">${esc(l.sender)}${l.edited ? ' ✎' : ''}</span><span class="wa-txt">${esc(l.text.length > 160 ? l.text.slice(0, 160) + '…' : l.text)}</span></span>
      ${undoFns[l.key] && !l.undone ? `<button type="button" class="wa-u" data-wa-undo="${esc(l.key)}">↺ Undo</button>` : '<span></span>'}
      <span class="wa-res">${l.res.map(r => `<span class="wa-chip ${esc(r.st)}">${ICON[r.st] || ''} ${esc(l.undone && r.st !== 'none' && r.st !== 'ignore' && r.st !== 'notlist' && r.st !== 'skip' ? r.text + ' — undone' : r.text)}</span>`).join('')}</span>
    </div>`).join('') : '<div class="wa-empty">No WhatsApp messages yet today.</div>';
  renderStatus();
}

function start() {
  if (!mount()) return;
  if (/wa-bridge/.test(location.hash)) {
    // opened by the WhatsApp snippet: show Departures, and keep the address clean
    setTimeout(() => { try { if (typeof showPanel === 'function') showPanel('departures'); } catch (_) {} }, 1500);
  }
  setInterval(() => { if (doc.getElementById('waStatus')) renderStatus(); }, 15000);
}
W.hoWaBridge = { handle, readPasted, parse: hoWaParse, parseCopied: hoWaParseCopied, log: () => LOG.slice(), origins: ORIGINS, render: renderCard };
if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
})();

// Top bar button: the WhatsApp window over the app, paste box ready
function waOpenFromTop() {
  const ov = document.getElementById('waOv'); if (!ov) return;
  ov.hidden = false;
  const ta = document.getElementById('waPaste'); if (ta) setTimeout(() => ta.focus({ preventScroll: true }), 120);
}
function waClose() { const ov = document.getElementById('waOv'); if (ov) ov.hidden = true; }
window.waOpenFromTop = waOpenFromTop; window.waClose = waClose;
