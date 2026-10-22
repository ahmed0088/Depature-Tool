// ═══════════════════════════════════════════════════════════
//  room-card.js — 🛏️ Room card + shared room notes
//
//  One place for everything about a room, opened from anywhere:
//      window.hoRoom.open('512')        (no room → asks which room)
//
//   • Room notes, shared by the team: a note on any room, with a type
//     (guest request, VIP, payment, maintenance, HK, luggage, taxi,
//     follow-up…), pinned or not, "for this stay" (default) or "just
//     today". Stored per hotel:
//        roomNotes/{room}/{id} = { room, text, cat, by, uid, at, scope,
//                                  stay: { confs, name, arrival, departure },
//                                  until, pin, editedAt?, editedBy? }
//     A stay note lasts while the same guest is in the room (in-house
//     confirmation, else arrival date, else name) — an extension keeps it,
//     a new guest hides it. When nobody can tell who is in the room it
//     lasts until the departure date it was written for (7 days when even
//     that was unknown). "Just today" lasts until midnight.
//     Edit / delete your own notes (owner and manager: any), with Undo.
//   • Departures bridge (light): the Departures "Room notes" window shows
//     this room's stay notes read-only on top, and each Departures note
//     can be kept as a room note (⇪). The card shows the room's lines on
//     today's Departures board too. r.note is never changed by this file.
//   • The card: guest(s) in-house, arriving today, departure status today,
//     room notes, and a timeline of the current stay (newest first):
//     WhatsApp messages, HK requests, handover items, Front Office Log
//     (lost & found, maintenance, upsell), wake-up calls, gym membership,
//     Departures actions. Each line opens its page at that item.
//     Sections from pages your role cannot open are left out. Guest
//     Memory is never read.
//   • Room numbers open the card: Departures card room number, In-House
//     room chip / guest window, Handover Book room filter, HK Requests
//     room column, WhatsApp result chips, global search ("512", "Room
//     card"), Ops Brain ("room 512", "what's up with 512"). Any element
//     with data-room-card="512" opens it.
//
//  index.html only needs <script src="room-card.js"></script> after the
//  modules it reads. Pure helpers: window.hoRoomPure (tested).
// ═══════════════════════════════════════════════════════════
(function () {
'use strict';
const W = typeof window !== 'undefined' ? window : globalThis;
const doc = typeof document !== 'undefined' && document && document.createElement ? document : null;

// ══ Pure helpers ════════════════════════════════════════════
const pad = n => String(n).padStart(2, '0');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_OF = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
const isIso = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return isoOf(new Date(y, m - 1, d + n, 12)); };
const diffDays = (a, b) => { const p = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); }; return Math.round((p(b) - p(a)) / 864e5); };
const fmtD = s => (isIso(s) ? +s.slice(8, 10) + ' ' + MON[+s.slice(5, 7) - 1] : String(s || ''));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** local midnight of a day, in ms */
const dayStart = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
/** ms of "HH:MM" on a day (local); null when the time can't be read */
function atOf(day, hhmm) {
  if (!isIso(day)) return null;
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/);
  const [y, mo, d] = day.split('-').map(Number);
  return m ? new Date(y, mo - 1, d, +m[1], +m[2]).getTime() : new Date(y, mo - 1, d, 0, 0).getTime();
}
/** the day (YYYY-MM-DD, local) of a time in ms */
const dayOf = ms => isoOf(new Date(ms));

/** "0113", " 113 ", "rm113"→ no: "0113" and "113" are the same room → "113" ('' when it isn't a room) */
function roomKey(r) {
  const s = String(r == null ? '' : r).trim().toUpperCase().replace(/\s+/g, '');
  const m = s.match(/^([A-Z]?)0*(\d+)([A-Z]?)$/);
  return m ? m[1] + (m[2] || '0') + m[3] : '';
}
const sameRoom = (a, b) => { const k = roomKey(a); return !!k && k === roomKey(b); };
/** a regular expression that finds the room in a text: "0113" and "113" find room 113; not 1130, 11:30, 113.50, 2/113 */
function roomRe(room) {
  const k = roomKey(room); const m = k.match(/^([A-Z]?)(\d+)([A-Z]?)$/);
  if (!m || m[2].length < 3) return null;   // "12" in a text is too often not a room
  return new RegExp('(?<![\\d:.,/A-Za-z])' + (m[1] ? m[1] : '') + '0*' + m[2] + (m[3] || '') + '(?![\\d]|[:.,]\\d)', 'i');
}
const mentionsRoom = (text, room) => { const re = roomRe(room); return !!re && re.test(String(text || '')); };

/** an Opera / Excel date ("21-OCT-26", "21/10/2026", "2026-10-21") → "YYYY-MM-DD" ('' when not a date) */
function isoDate(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (isIso(s.slice(0, 10))) return s.slice(0, 10);
  if (W.hoInHousePure && typeof W.hoInHousePure.parseDate === 'function') { try { const r = W.hoInHousePure.parseDate(s); if (r) return r; } catch (_) {} }
  let m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*[-\s](\d{2,4})$/);
  if (m && MONTH_OF[m[2].toUpperCase()]) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return `${y}-${pad(MONTH_OF[m[2].toUpperCase()])}-${pad(+m[1])}`; }
  m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/);
  if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return `${y}-${pad(+m[2])}-${pad(+m[1])}`; }
  return '';
}

/** guest name → its words ("Fakeworth, Xi, Mr" and "XI FAKEWORTH" share "fakeworth" and "xi") */
const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'mstr', 'master', 'sir', 'madam', 'prof', 'sheikh', 'shk']);
const nameWords = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^a-z؀-ۿ]+/).filter(w => w.length >= 2 && !TITLES.has(w));
/** same guest by name: a surname-length word in common */
function sameName(a, b) {
  const A = nameWords(a), B = new Set(nameWords(b));
  if (!A.length || !B.size) return null;
  return A.some(w => w.length >= 3 && B.has(w)) || (A.length === 1 && B.has(A[0]));
}
/** who is in the room: { confs: [], name, arrival, departure } (the parts that are known), or null */
function makeStay(o) {
  if (!o) return null;
  const confs = [].concat(o.confs || [], o.conf || []).map(c => String(c || '').trim()).filter(Boolean).filter((c, i, a) => a.indexOf(c) === i).slice(0, 6);
  const st = { confs, name: String(o.name || '').trim().slice(0, 80), arrival: isoDate(o.arrival), departure: isoDate(o.departure) };
  return st.confs.length || st.name || st.arrival || st.departure ? st : null;
}
/** is stay b the same as stay a? true / false, or null when nothing tells */
function sameStay(a, b) {
  if (!a || !b) return null;
  const ac = a.confs || [], bc = b.confs || [];
  if (ac.length && bc.length) return ac.some(c => bc.includes(c));
  if (a.arrival && b.arrival && a.arrival !== b.arrival) return false;
  const n = a.name && b.name ? sameName(a.name, b.name) : null;
  if (n !== null) return n;
  if (a.arrival && b.arrival) return true;
  return null;
}
/** the last day a new note shows when nobody can tell who is in the room */
function untilFor(scope, stay, today) {
  if (scope === 'today') return today;
  return (stay && stay.departure && stay.departure >= today) ? stay.departure : addDays(today, 7);
}
/** does a note show for the guest in the room now? */
function noteVisible(n, cur, today) {
  if (!n || !String(n.text || '').trim()) return false;
  if (n.scope === 'today') return today <= (n.until || (n.at ? dayOf(n.at) : today));
  const s = sameStay(n.stay || null, cur || null);
  if (s === true) return true;
  if (s === false) return false;
  return !n.until || today <= n.until;
}
/** the notes of a room that show now: pinned first, then newest first */
function notesFor(notes, cur, today) {
  const L = Array.isArray(notes) ? notes : Object.keys(notes || {}).map(id => Object.assign({ id }, notes[id]));
  return L.filter(n => noteVisible(n, cur, today)).sort((a, b) => (b.pin ? 1 : 0) - (a.pin ? 1 : 0) || (b.at || 0) - (a.at || 0));
}
/** may this person change or delete the note? owner / manager any; others their own */
function canEdit(n, who) {
  if (!n || !who) return false;
  if (who.role === 'owner' || who.role === 'manager') return true;
  if (who.role === 'readonly') return false;
  if (n.uid && who.uid) return n.uid === who.uid;
  return !!n.by && n.by === who.name;
}
/** lists of timeline items → one list, newest first, each item once (src + id), only since `since` (ms) */
const SRC_ORDER = ['dep', 'wa', 'hk', 'ho', 'log', 'wake', 'gym', 'note'];
function mergeTimeline(lists, opt) {
  opt = opt || {};
  const seen = new Set(), out = [];
  (lists || []).forEach(L => (L || []).forEach(it => {
    if (!it || it.at == null || isNaN(it.at)) return;
    if (opt.since != null && it.at < opt.since && !it.keep) return;
    const k = (it.src || '') + '|' + (it.id || it.at + '|' + it.text);
    if (seen.has(k)) return; seen.add(k); out.push(it);
  }));
  return out.sort((a, b) => b.at - a.at || SRC_ORDER.indexOf(a.src) - SRC_ORDER.indexOf(b.src));
}
/** the note types (the same icons as the Departures notes window) */
const CATS = [
  ['gen', 'General', '📝', 'var(--text2)'], ['req', 'Guest request', '🙋', 'var(--sky,#0ea5e9)'], ['vip', 'VIP / Prefs', '⭐', 'var(--amber,#d97706)'],
  ['pay', 'Payment', '💳', 'var(--purple,#7c3aed)'], ['mnt', 'Maintenance', '🔧', 'var(--red,#dc2626)'], ['hk', 'Housekeeping', '🧹', 'var(--mint,#10b981)'],
  ['lug', 'Luggage', '🧳', 'var(--sky,#0ea5e9)'], ['taxi', 'Taxi', '🚕', 'var(--amber,#d97706)'], ['fup', 'Follow-up', '🔁', 'var(--blue,#2563eb)'],
  ['call', 'Call / DND', '📞', 'var(--rose,#e11d48)'], ['fin', 'Finance', '🧾', 'var(--blue,#2563eb)'], ['lco', 'Late CO', '⏰', 'var(--amber,#d97706)'], ['ext', 'Extension', '↪', 'var(--teal,#0d9488)'],
];
const CAT = Object.fromEntries(CATS.map(c => [c[0], { k: c[0], l: c[1], i: c[2], c: c[3] }]));
/** a short text to paste in WhatsApp */
function summaryText(M) {
  const L = [`🛏️ Room ${M.room}${M.guest ? ' · ' + M.guest : ''}`];
  if (M.dates) L.push(M.dates);
  if (M.dep) L.push('🧳 ' + M.dep);
  if (M.arr) L.push('🛎️ Arriving today: ' + M.arr);
  (M.notes || []).slice(0, 8).forEach(n => L.push(`${(CAT[n.cat] || CAT.gen).i} ${String(n.text).replace(/\s+/g, ' ').trim()}`));
  return L.join('\n');
}

// Ops Brain: "room 512", "room card 512", "what's up with 512" → the card
const BRAIN_RX = [/^\s*(?:room\s*card|card)\s*(?:for\s*)?(?:room\s*)?#?([a-z]?\d{2,5}[a-z]?)\s*\??$/i,
  /^\s*(?:what'?s|whats|what\s+is)\s+(?:up|going\s+on|new|happening|the\s+story)\s+(?:with|in|at)\s+(?:room\s*)?#?(\d{3,5})\s*\??$/i,
  /^\s*(?:room|rm)\s*#?(\d{3,5})\s*\??$/i, /^\s*(?:tell\s+me\s+about|about|show(?:\s+me)?|open)\s+room\s*#?(\d{3,5})\s*\??$/i, /^\s*(?:notes?)\s+(?:for|on)\s+(?:room\s*)?#?(\d{3,5})\s*\??$/i];
const brainRoom = q => { for (const re of BRAIN_RX) { const m = String(q || '').match(re); if (m) return m[1]; } return ''; };
W.hoRoomPure = { brainRoom, roomKey, sameRoom, roomRe, mentionsRoom, isoDate, nameWords, sameName, makeStay, sameStay, untilFor, noteVisible, notesFor, canEdit, mergeTimeline, atOf, dayStart, addDays, summaryText, CATS };
W.hoRoom = W.hoRoom || { open() {}, notes: () => [], count: () => 0 };
if (!doc) return;

// ══ App helpers ═════════════════════════════════════════════
const safe = (f, d) => { try { return f(); } catch (e) { try { console.warn('[room-card]', e); } catch (_) {} return d; } };
const today = () => (typeof hoLocalISO === 'function' ? hoLocalISO() : isoOf(new Date()));
const prof = () => (typeof currentProfile !== 'undefined' && currentProfile) || null;
const who = () => { const p = prof(); return { name: (p && p.name) || 'Front Desk', role: (p && p.role) || 'agent', uid: safe(() => (typeof currentUser !== 'undefined' && currentUser && currentUser.uid) || '', '') }; };
const canWrite = () => who().role !== 'readonly';
const allowed = panel => safe(() => (typeof hoPanelAllowed === 'function' ? hoPanelAllowed(panel) : true), true) && !!doc.getElementById('panel-' + panel);
const toast = (m, k) => safe(() => { if (typeof showToast === 'function') showToast(m, k || 'ok'); });
const act = (a, d) => safe(() => { if (typeof logActivity === 'function') logActivity(a, d); });
const icon = (name, fb) => safe(() => (typeof hoIcon === 'function' && hoIcon(name)) || fb, fb) || fb;
const depList = () => safe(() => (typeof depRooms !== 'undefined' && Array.isArray(depRooms) ? depRooms : []), []);
const arrList = () => safe(() => (typeof arrGuests !== 'undefined' && Array.isArray(arrGuests) ? arrGuests : []), []);
const tm12 = ms => { const d = new Date(ms); const h = d.getHours(); return (h % 12 || 12) + ':' + pad(d.getMinutes()) + ' ' + (h >= 12 ? 'PM' : 'AM'); };
const fbKey = k => String(k || '').replace(/[.#$\[\]\/\x00-\x1f\x7f]/g, '_').slice(0, 40) || '_';

// ══ Notes store ═════════════════════════════════════════════
const N = { all: {}, loaded: false };
const notesOf = rk => { const o = N.all[fbKey(rk)] || {}; return Object.keys(o).filter(id => o[id] && typeof o[id] === 'object').map(id => Object.assign({ id }, o[id])); };
function onNotes(v) {
  N.all = v && typeof v === 'object' ? v : {}; N.loaded = true;
  safe(() => { try { localStorage.setItem('ho_room_notes_v1', JSON.stringify(N.all)); } catch (_) {} });
  notesChanged();
}
function notesChanged() {
  if (C.rk && sheet()) paint();
  safe(() => { if (typeof _dpnRefresh === 'function') _dpnRefresh(); });
  // the Departures board shows the room notes in its note chip / count: redraw it (not while someone types on it)
  clearTimeout(N.depT);
  N.depT = setTimeout(() => safe(() => { const p = doc.getElementById('panel-departures'); if (p && depList().length && typeof depRender === 'function' && !(doc.activeElement && /TEXTAREA|INPUT|SELECT/.test(doc.activeElement.tagName) && p.contains(doc.activeElement))) depRender(); }), 60);
}
function startSync() {
  safe(() => { const v = JSON.parse(localStorage.getItem('ho_room_notes_v1') || 'null'); if (v && typeof v === 'object') N.all = v; });
  let tries = 0;
  const go = () => {
    if (typeof fbListen !== 'function') return;
    if (!(typeof _ref !== 'undefined' && _ref) && ++tries <= 40) { setTimeout(go, 500); return; }
    fbListen('roomNotes', v => safe(() => onNotes(v)));
  };
  go();
}
function writeNote(rk, id, n) {
  const k = fbKey(rk);
  if (n) (N.all[k] = N.all[k] || {})[id] = n; else if (N.all[k]) { delete N.all[k][id]; if (!Object.keys(N.all[k]).length) delete N.all[k]; }
  safe(() => { if (typeof fbSet === 'function') Promise.resolve(fbSet('roomNotes/' + k + '/' + id, n || null)).catch(() => {}); });
  notesChanged();
}

// ══ What the app knows about a room ═════════════════════════
function inHouse(room) { return safe(() => (W.hoInHouse && typeof W.hoInHouse.find === 'function' ? W.hoInHouse.find(room) : null), null); }
function depOf(room) { return depList().find(r => sameRoom(r.roomStr != null ? r.roomStr : r.room, room)) || null; }
function arrOf(room) { return arrList().filter(g => g && sameRoom(g.room, room)); }
/** the stay in the room now: the in-house guest, else the departing guest, else today's arrival */
function stayNow(room) {
  const ih = inHouse(room);
  if (ih) return makeStay({ confs: [ih.conf], name: ih.name, arrival: ih.arrival, departure: ih.departure });
  const d = depOf(room);
  if (d && d.status !== 'out') return makeStay({ name: d.name, arrival: d.arrival, departure: d.departure });
  const a = arrOf(room)[0];
  if (a) return makeStay({ confs: [a.conf], name: a.name, arrival: today(), departure: a.nights ? addDays(today(), +a.nights || 1) : '' });
  return null;
}
const notesNow = room => { const rk = roomKey(room); return rk ? notesFor(notesOf(rk), stayNow(room), today()) : []; };
/** the room is known somewhere (in-house, departures, arrivals, notes) */
const known = room => !!(inHouse(room) || depOf(room) || arrOf(room).length || notesOf(roomKey(room)).length);

function addNote(room, text, cat, scope, pin) {
  const rk = roomKey(room); text = String(text || '').trim();
  if (!rk || !text) return null;
  if (!canWrite()) { toast('Adding notes is not available for your role', 'err'); return null; }
  const t = today(), w = who(), stay = stayNow(room);
  const id = 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const n = { room: String(room).trim(), text: text.slice(0, 600), cat: CAT[cat] ? cat : 'gen', by: w.name, uid: w.uid, at: Date.now(), scope: scope === 'today' ? 'today' : 'stay', until: untilFor(scope, stay, t), pin: !!pin };
  if (stay) n.stay = stay;
  writeNote(rk, id, n);
  act('room_note', `Room ${n.room}: ${text.slice(0, 80)}`);
  safe(() => { if (typeof showUndoToast === 'function') showUndoToast(`Note added to room ${n.room}`, () => writeNote(rk, id, null)); else toast(`Note added to room ${n.room}`); });
  return id;
}
function delNote(rk, id) {
  const n = (N.all[fbKey(rk)] || {})[id]; if (!n) return;
  if (!canEdit(n, who())) { toast('You can delete only your own notes', 'err'); return; }
  const keep = JSON.parse(JSON.stringify(n));
  writeNote(rk, id, null);
  act('room_note_deleted', `Room ${n.room}: ${String(n.text).slice(0, 60)}`);
  safe(() => { if (typeof showUndoToast === 'function') showUndoToast('Note deleted', () => writeNote(rk, id, keep)); else toast('Note deleted'); });
}
function patchNote(rk, id, p) {
  const n = (N.all[fbKey(rk)] || {})[id]; if (!n) return;
  if (!canEdit(n, who()) && !('pin' in p && Object.keys(p).length === 1 && canWrite())) { toast('You can change only your own notes', 'err'); return; }
  const before = JSON.parse(JSON.stringify(n));
  const now = Object.assign({}, n, p);
  if ('text' in p) { now.editedAt = Date.now(); now.editedBy = who().name; }
  writeNote(rk, id, now);
  if ('text' in p || 'cat' in p) safe(() => { if (typeof showUndoToast === 'function') showUndoToast('Note changed', () => writeNote(rk, id, before)); });
}

// ══ The timeline of a stay ══════════════════════════════════
const ARCH = {}; // 'wa|day' / 'ho|day' → loaded at (ms)
function stayDays(st) {
  const t = today();
  const from = st && st.arrival && st.arrival <= t ? (diffDays(st.arrival, t) > 13 ? addDays(t, -13) : st.arrival) : t;
  const out = []; for (let d = from; d <= t; d = addDays(d, 1)) out.push(d);
  return out;
}
const DEP_ACT = { out: '✓ Checked out', late: '⏰ Late check-out', extended: '↪ Extended', na: '📵 No answer', dnd: '🚫 DND', undo: '↺ Undone', due: 'Back to due', fin: '🧾 Left · waiting' };
/** who did a Departures action at "HH:MM": the room's note line of that minute ("[10:05] Checked out — WhatsApp · Sam") */
function depWho(d, time) {
  if (!d || !time) return '';
  const L = String(d.note || '').split('\n').filter(x => x.startsWith('[' + time + ']') && x.includes(' — '));
  const w = L.length ? L[L.length - 1].split(' — ').pop().trim() : '';
  return w.length <= 60 && /^WhatsApp\b|·/.test(w) ? w : '';   // "WhatsApp · Sam 10:42"; not the tail of a sentence
}
function timeline(room) {
  const rk = roomKey(room), t = today(), st = stayNow(room), days = stayDays(st), since = dayStart(days[0]);
  const lists = [];
  // Departures: actions today
  if (allowed('departures')) safe(() => {
    const L = safe(() => (typeof depLog !== 'undefined' && Array.isArray(depLog) ? depLog : []), []);
    const d = depOf(room), bday = d ? isoDate(d.departure) : '';
    lists.push(L.filter(l => l && sameRoom(l.room, room) && l.action !== 'due').map((l, i) => ({ src: 'dep', id: 'dep' + i + l.time + l.action, at: atOf(t, l.time), who: depWho(d, l.time), icon: icon('departures', '🧳'),
      text: (DEP_ACT[l.action] || l.action) + (l.action === 'late' && l.lateTime ? ' until ' + l.lateTime : '') + (l.action === 'extended' && l.extensionNights ? ' +' + l.extensionNights + 'N' + (bday ? ' → ' + fmtD(addDays(bday, +l.extensionNights)) : '') : '') + (l.action === 'undo' && l.undone ? ' ' + (DEP_ACT[l.undone] || l.undone).replace(/^\S+\s/, '') : ''),
      sub: l.action === 'out' ? 'Checked out on Departures' : '', src2: 'Departures', go: () => goDeparture(room) })));
    // "left · waiting for Finance" is not in the log: from the room itself
    if (d && d.intent === 'finance_hold' && d.finAt) lists.push([{ src: 'dep', id: 'depfin' + d.finAt, at: atOf(t, d.finAt), who: '', icon: icon('departures', '🧳'), text: DEP_ACT.fin + ' for ' + (d.finWho || 'Finance'), sub: 'Guest has left; the room is still open in Opera', src2: 'Departures', go: () => goDeparture(room) }]);
  });
  // WhatsApp: today's log + the backup of earlier days of the stay
  if (allowed('departures')) safe(() => {
    const L = safe(() => (W.hoWaBridge && typeof W.hoWaBridge.log === 'function' ? W.hoWaBridge.log() : []), []);
    lists.push(L.filter(l => l && !l.deleted && ((l.res || []).some(r => sameRoom(r.room, room)) || mentionsRoom(l.text, room))).map(l => {
      const r = (l.res || []).find(x => sameRoom(x.room, room));
      return { src: 'wa', id: 'wa' + (l.mid || l.key), at: atOf(t, l.time) || l.at, who: l.sender || '', icon: '💬', text: String(l.text || '').slice(0, 240), sub: r ? String(r.text || '').slice(0, 120) + (l.undone ? ' — undone' : '') : '', src2: 'WhatsApp' + (l.group ? ' · ' + l.group : ''), go: () => goWa(room, t) };
    }));
    days.filter(d => d < t).forEach(d => {
      const recs = ARCH['wa|' + d + '|v'] || {};
      lists.push(Object.keys(recs).map(k => ({ k, r: recs[k] })).filter(o => o.r && (mentionsRoom(o.r.x, room) || String(o.r.r || '').split(' · ').some(p => sameRoom(p.split(' ')[1], room))))
        .map(o => ({ src: 'wa', id: 'wa' + o.k, at: atOf(d, o.r.t), who: o.r.s || '', icon: '💬', text: String(o.r.x || '').slice(0, 240), sub: o.r.r && !/^(none|ignore)$/.test(o.r.r) ? String(o.r.r).slice(0, 100) : '', src2: 'WhatsApp', go: () => goWa(room, d) })));
    });
  });
  // HK requests (today)
  if (allowed('hk-requests')) safe(() => {
    const B = W.hoWaBrain; if (!B || typeof B.requests !== 'function') return;
    lists.push((B.requests(t) || []).filter(i => sameRoom(i.room, room)).map(i => {
      const S = typeof B.requestStatus === 'function' ? B.requestStatus(i) : { text: i.st };
      return { src: 'hk', id: 'hk' + i.id, at: atOf(t, i.t), who: i.s || '', icon: icon('hk-requests', '🧺'), text: (i.cats && i.cats.length ? i.cats.map(c => c.icon).join('') + ' ' : '') + (i.what || 'Request') + (i.x ? ' — ' + String(i.x).slice(0, 160) : ''), sub: S.text || '', done: i.st === 'done', src2: 'HK Requests', go: () => goHk(room) };
    }));
  });
  // Handover Book (the days of the stay)
  if (allowed('handover-book')) safe(() => {
    const H = W.hoHandoverBook; if (!H || typeof H.items !== 'function') return;
    days.forEach(d => lists.push((H.items(d) || []).filter(i => i && !i.chat && ((i.rooms || []).some(r => sameRoom(r, room)) || mentionsRoom(i.text || i.orig, room)))
      .map(i => ({ src: 'ho', id: 'ho' + d + i.key, at: atOf(i.date || d, i.time), who: i.sender || '', icon: '📒', text: String(i.text || i.orig || '').slice(0, 240), sub: i.status === 'done' ? '✓ Done' + (i.doneBy ? ' · ' + i.doneBy : '') : i.status === 'open' ? '⏳ Pending' : '', done: i.status === 'done', src2: 'Handover Book', go: () => goHandover(room, i.date || d) }))));
  });
  // Front Office Log
  if (allowed('ops-logs')) safe(() => {
    const O = W.hoOpsLogs; if (!O) return;
    const lf = Object.values(O.lf() || {}).filter(r => r && sameRoom(r.room, room));
    lists.push(lf.map(r => ({ src: 'log', id: 'lf' + r.id, at: r.at || r.created, who: r.foundBy || r.by || '', icon: '🧳', text: 'Lost & found: ' + (r.what || ''), sub: r.status === 'returned' ? '✓ Returned' + (r.ret && r.ret.to ? ' to ' + r.ret.to : '') : r.status === 'found' ? 'Kept' + (r.storage ? ' · ' + r.storage : '') : r.status || '', src2: 'Front Office Log', go: () => goOps('lf') })));
    const mt = Object.values(O.mt() || {}).filter(r => r && (sameRoom(r.area, room) || mentionsRoom(r.area, room)));
    lists.push(mt.map(r => { const h = Object.values(r.hist || {}).filter(x => x && x.text).sort((a, b) => (b.at || 0) - (a.at || 0))[0];
      return { src: 'log', id: 'mt' + r.id, at: r.at || r.created, keep: r.status !== 'fixed', who: r.by || '', icon: '🔧', text: 'Maintenance: ' + (r.problem || '') + (r.prio === 'high' ? ' (high)' : ''), sub: (r.status === 'fixed' ? '✅ Fixed' + (r.fixedBy ? ' · ' + r.fixedBy : '') : '🟠 ' + (r.status || 'open')) + (h && h.text && h.text !== 'Ticket opened' ? ' · ' + String(h.text).slice(0, 80) : ''), done: r.status === 'fixed', src2: 'Front Office Log', go: () => goOps('mt') }; }));
    const UP = O.upsell ? O.upsell() || {} : {};
    arrOf(room).forEach(g => { const u = UP[O.upKey ? O.upKey(g) : '']; if (u && (u.offered || u.sold)) lists.push([{ src: 'log', id: 'up' + (g.conf || g.name), at: u.at || Date.now(), who: u.by || '', icon: '💰', text: u.sold ? 'Upsell sold' + (u.amount ? ' · AED ' + u.amount : '') : 'Upsell offered', sub: g.name || '', src2: 'Front Office Log', go: () => goOps('up') }]); });
  });
  // Wake-up calls
  if (allowed('wakeups')) safe(() => {
    const L = typeof _wkAll === 'function' ? _wkAll() : Object.keys(safe(() => bxWakes, {}) || {}).map(id => Object.assign({ id }, bxWakes[id]));
    const RES = { ok: '✓ Answered', sent: '🚶 Someone went up', cancel: 'Cancelled by guest' };
    lists.push(L.filter(w => w && w.at && sameRoom(w.room, room) && w.at >= since - 864e5).map(w => ({ src: 'wake', id: 'wk' + w.id, at: w.at, keep: !w.done, who: w.by || '', icon: '⏰', text: 'Wake-up call ' + (w.time || tm12(w.at)) + (dayOf(w.at) !== t ? ' · ' + fmtD(dayOf(w.at)) : '') + (w.note ? ' — ' + String(w.note).slice(0, 80) : ''), sub: w.done ? (RES[w.result] || '✓ Done') + (w.doneBy ? ' · ' + w.doneBy : '') : w.at > Date.now() ? 'Upcoming' : (w.tries ? '📵 No answer ×' + w.tries : 'Due now'), done: !!w.done, src2: 'Wake-up Calls', go: () => goWake(room) })));
  });
  // Gym & Pool
  if (allowed('gym')) safe(() => {
    const G = W.hoGym && typeof W.hoGym.state === 'function' ? W.hoGym.state() : null; if (!G) return;
    const TY = { gym: 'Gym', pool: 'Pool', gympool: 'Gym & Pool' };
    lists.push(Object.keys(G.members || {}).map(id => Object.assign({ id }, G.members[id])).filter(m => m && m.name && m.kind === 'guest' && sameRoom(m.room, room) && (!m.end || m.end >= days[0]))
      .map(m => ({ src: 'gym', id: 'gym' + m.id, at: m.start && isIso(m.start) ? dayStart(m.start) + 9 * 36e5 : (m.at || Date.now()), keep: true, who: '', icon: '🏋️', text: (TY[m.type] || 'Gym') + ' membership · ' + m.name, sub: m.end ? (m.end >= t ? 'until ' + fmtD(m.end) : 'ended ' + fmtD(m.end)) : '', src2: 'Gym & Pool', go: () => goGym(m.id) })));
  });
  return mergeTimeline(lists, { since });
}
/** the days before today: WhatsApp backup and handover days, loaded once a minute at most */
async function loadPast(room) {
  const t = today(), days = stayDays(stayNow(room)), jobs = [];
  days.forEach(d => {
    if (d < t && allowed('departures') && typeof fbGet === 'function' && !(Date.now() - (ARCH['wa|' + d] || 0) < 60e3)) {
      ARCH['wa|' + d] = Date.now();
      jobs.push(Promise.resolve(fbGet('waChat/' + d)).then(v => { ARCH['wa|' + d + '|v'] = v && typeof v === 'object' ? v : {}; }).catch(() => {}));
    }
    if (allowed('handover-book') && W.hoHandoverBook && typeof W.hoHandoverBook.load === 'function' && !(Date.now() - (ARCH['ho|' + d] || 0) < 60e3)) {
      ARCH['ho|' + d] = Date.now();
      jobs.push(Promise.resolve(W.hoHandoverBook.load(d)).catch(() => {}));
    }
  });
  if (jobs.length) await Promise.all(jobs);
  return jobs.length;
}

// ══ Going to a page at an item ══════════════════════════════
function goDeparture(room) {
  const d = depOf(room); if (!d) return;
  if (typeof showPanel === 'function') showPanel('departures');
  setTimeout(() => safe(() => { if (typeof depJumpTo === 'function') depJumpTo(d.roomStr, 'all', String(d.roomStr)); }), 120);
}
function goInHouse(room) { safe(() => W.hoInHouse.open(room)); }
function goArrivals(room) {
  if (typeof showPanel === 'function') showPanel('arrivals');
  setTimeout(() => safe(() => { const el = doc.getElementById('arrSearch'); if (el) { el.value = String(room); el.dispatchEvent(new Event('input', { bubbles: true })); } }), 80);
}
function goWa(room, day) {
  safe(() => {
    if (typeof waOpenFromTop !== 'function') return;
    waOpenFromTop();
    setTimeout(() => safe(() => {
      const q = doc.getElementById('waQ'); if (!q) return;
      const rng = day && day < today() ? (diffDays(day, today()) < 7 ? '7' : diffDays(day, today()) < 30 ? '30' : 'all') : 'today';
      const b = doc.querySelector(`#waRng [data-r="${rng}"]`); if (b && !b.classList.contains('on')) b.click();
      q.value = String(room); q.dispatchEvent(new Event('input', { bubbles: true }));
      q.scrollIntoView({ block: 'center' });
    }), 120);
  });
}
function goHk(room) {
  if (typeof showPanel === 'function') showPanel('hk-requests');
  setTimeout(() => safe(() => {
    const tab = doc.querySelector('[data-wab-tab="log"]'); if (tab && tab.getAttribute('aria-selected') !== 'true' && !tab.classList.contains('on')) tab.click();
    setTimeout(() => safe(() => { const i = doc.getElementById('wabLRoom'); if (i) { i.value = String(room); i.dispatchEvent(new Event('input', { bubbles: true })); } }), 250);
  }), 150);
}
function goHandover(room, day) {
  safe(() => { const H = W.hoHandoverBook, S = H && H.state && H.state(); if (S) { S.date = day || today(); S.room = String(room); } });
  if (typeof showPanel === 'function') showPanel('handover-book');
  setTimeout(() => safe(() => W.hoHandoverBook.render()), 60);
}
function goOps(tab) { safe(() => { if (typeof olTab === 'function') olTab(tab); else showPanel('ops-logs'); }); }
function goWake(room) {
  if (typeof showPanel === 'function') showPanel('wakeups');
  setTimeout(() => safe(() => { const i = doc.querySelector('#wkRoot .wk-search'); if (i) i.value = String(room); if (typeof wkSetFilter === 'function') wkSetFilter(String(room)); }), 120);
}
function goGym(id) { if (typeof showPanel === 'function') showPanel('gym'); setTimeout(() => safe(() => W.hoGym.open(id)), 150); }

// ══ The card ════════════════════════════════════════════════
const C = { room: '', rk: '', f: 'all', cat: 'gen', scope: 'stay', pin: false, edit: '', del: '', more: false, form: '', back: null, go: [] };
const sheet = () => doc.getElementById('rcSheet');
const CSS = `
.rc-scrim{position:fixed;inset:0;z-index:9993;background:rgba(10,14,22,.38);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);animation:rcFade .18s ease}
.rc-sheet{--rc-acc:var(--gold,var(--accent,#0a84ff));--rc-hair:color-mix(in srgb,var(--text) 10%,transparent);--rc-fill:color-mix(in srgb,var(--text) 6%,transparent);--rc-soft:color-mix(in srgb,var(--text) 3.5%,var(--card,#fff));
  position:fixed;top:0;right:0;bottom:0;z-index:9994;width:min(500px,100vw);display:flex;flex-direction:column;background:var(--card,#fff);color:var(--text);border-left:1px solid var(--rc-hair);box-shadow:-30px 0 80px -30px rgba(0,0,0,.5);animation:rcIn .22s cubic-bezier(.2,.8,.2,1);font-family:var(--font,inherit);outline:none}
.rc-sheet *{box-sizing:border-box}.rc-sheet button,.rc-sheet input,.rc-sheet textarea{font-family:inherit}
@keyframes rcIn{from{transform:translateX(24px);opacity:.4}to{transform:none;opacity:1}}@keyframes rcUp{from{transform:translateY(30px);opacity:.5}to{transform:none;opacity:1}}@keyframes rcFade{from{opacity:0}to{opacity:1}}
.rc-grab{display:none}
.rc-hd{display:flex;gap:12px;align-items:flex-start;padding:16px 16px 12px;border-bottom:1px solid var(--rc-hair)}
.rc-rm{flex:none;min-width:66px;padding:10px 10px;border-radius:14px;text-align:center;font:700 21px/1 var(--mono,ui-monospace,monospace);background:color-mix(in srgb,var(--rc-acc) 16%,transparent);color:var(--text);letter-spacing:.02em}
.rc-rm small{display:block;font:600 9.5px/1 var(--font,inherit);letter-spacing:.08em;text-transform:uppercase;color:var(--text3);margin-bottom:5px}
.rc-who{min-width:0;flex:1}.rc-who h2{margin:2px 0 3px;font:700 17px/1.25 var(--font,inherit);overflow-wrap:anywhere}
.rc-sub{font-size:12.5px;color:var(--text2);line-height:1.4}
.rc-x{all:unset;cursor:pointer;flex:none;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:var(--rc-fill);color:var(--text2);font-size:15px}
.rc-x:hover{color:var(--text)}
.rc-bd{flex:1;overflow-y:auto;overscroll-behavior:contain;padding:12px 16px 28px;display:grid;gap:14px;align-content:start}
.rc-tags{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}
.rc-tag{display:inline-flex;align-items:center;gap:4px;font:650 11px/1.2 var(--font,inherit);padding:3px 8px;border-radius:99px;background:var(--rc-fill);color:var(--text2);white-space:nowrap}
.rc-tag.warn{background:color-mix(in srgb,var(--amber,#d97706) 16%,transparent);color:var(--amber,#b45309)}.rc-tag.bad{background:color-mix(in srgb,var(--red,#dc2626) 14%,transparent);color:var(--red,#dc2626)}
.rc-tag.ok{background:color-mix(in srgb,var(--green,#16a34a) 14%,transparent);color:var(--green,#16a34a)}.rc-tag.acc{background:color-mix(in srgb,var(--rc-acc) 18%,transparent);color:var(--text)}
.rc-sec{display:grid;gap:8px}
.rc-h{display:flex;align-items:center;justify-content:space-between;gap:8px;font:700 11px/1.2 var(--font,inherit);letter-spacing:.07em;text-transform:uppercase;color:var(--text3);margin:2px 0 0}
.rc-h em{font-style:normal;font-weight:600;letter-spacing:0;text-transform:none;color:var(--text3)}
.rc-box{background:var(--rc-soft);border:1px solid var(--rc-hair);border-radius:14px;padding:10px 12px;display:grid;gap:6px;min-width:0}
.rc-line{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;font-size:13.5px;line-height:1.4}
.rc-line b{font-weight:650}.rc-line .dim{color:var(--text2);font-size:12.5px}
.rc-facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
.rc-fact{background:var(--card,#fff);border:1px solid var(--rc-hair);border-radius:11px;padding:7px 9px;min-width:0}
.rc-fact small{display:block;font:600 9.5px/1.2 var(--font,inherit);letter-spacing:.06em;text-transform:uppercase;color:var(--text3)}
.rc-fact b{display:block;font:650 13.5px/1.3 var(--font,inherit);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums}
.rc-fact.owe b{color:var(--red,#dc2626)}
.rc-btn{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:7px 12px;border-radius:99px;font:600 12.5px/1.2 var(--font,inherit);background:var(--rc-fill);border:1px solid var(--rc-hair);color:var(--text);white-space:nowrap;transition:transform .12s,filter .12s}
.rc-btn:hover{filter:brightness(1.06)}.rc-btn:active{transform:scale(.97)}
.rc-btn.pri{background:var(--rc-acc);border-color:transparent;color:var(--bg,#fff)}.rc-btn.sm{padding:5px 10px;font-size:12px}
.rc-btn:focus-visible,.rc-x:focus-visible,.rc-cat:focus-visible,.rc-ib:focus-visible,.rc-f:focus-visible,.rc-it:focus-visible{outline:2px solid var(--rc-acc);outline-offset:2px}
.rc-btn .ho-ic,.rc-ico .ho-ic{width:15px;height:15px}
.rc-acts{display:flex;gap:6px;flex-wrap:wrap}
.rc-in,.rc-ta{width:100%;min-width:0;background:var(--card,#fff);color:var(--text);border:1px solid var(--rc-hair);border-radius:11px;padding:9px 11px;font:14px/1.4 var(--font,inherit);margin:0;color-scheme:light dark}
.rc-sheet .rc-ta{resize:none;min-height:44px;height:44px;max-height:160px}
.rc-sheet #rcEdit{height:64px}
.rc-in:focus,.rc-ta:focus{outline:none;border-color:var(--rc-acc);box-shadow:0 0 0 3px color-mix(in srgb,var(--rc-acc) 22%,transparent)}
.rc-cats{display:flex;gap:5px;overflow-x:auto;scrollbar-width:none;padding-bottom:1px}.rc-cats::-webkit-scrollbar{display:none}
.rc-cat{all:unset;cursor:pointer;flex:none;display:inline-flex;gap:4px;align-items:center;padding:4px 9px;border-radius:99px;font:600 11.5px/1.3 var(--font,inherit);color:var(--text2);border:1px solid var(--rc-hair);background:var(--card,#fff)}
.rc-cat.on{color:var(--text);border-color:var(--k);background:color-mix(in srgb,var(--k) 14%,var(--card,#fff))}
.rc-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:space-between}
.rc-seg{display:inline-flex;gap:3px;padding:3px;border-radius:10px;background:var(--rc-fill)}
.rc-seg button{all:unset;cursor:pointer;padding:4px 10px;border-radius:8px;font:600 12px/1.3 var(--font,inherit);color:var(--text2)}
.rc-seg button.on{background:var(--card,#fff);color:var(--text);box-shadow:0 1px 3px rgba(0,0,0,.14)}
.rc-n{display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:8px;align-items:start;padding:9px 10px;border-radius:12px;background:var(--card,#fff);border:1px solid var(--rc-hair);border-left:3px solid var(--k,var(--rc-hair))}
.rc-n.pin{background:color-mix(in srgb,var(--rc-acc) 7%,var(--card,#fff))}
.rc-n .ic{font-size:16px;line-height:1.3;text-align:center}
.rc-n .tx{font-size:13.5px;line-height:1.45;overflow-wrap:anywhere;white-space:pre-wrap}
.rc-n .mt{font-size:11.5px;color:var(--text3);margin-top:3px;display:flex;flex-wrap:wrap;gap:3px 8px}
.rc-n .ac{display:flex;gap:2px}
.rc-ib{all:unset;cursor:pointer;width:28px;height:28px;border-radius:8px;display:grid;place-items:center;color:var(--text3);font-size:13px}
.rc-ib:hover{background:var(--rc-fill);color:var(--text)}.rc-ib.on{color:var(--rc-acc)}
.rc-delq{grid-column:1/-1;display:flex;gap:8px;align-items:center;justify-content:flex-end;font-size:12.5px;color:var(--text2)}
.rc-empty{font-size:13px;color:var(--text3);padding:6px 2px;line-height:1.45}
.rc-fl{display:flex;gap:5px;overflow-x:auto;scrollbar-width:none}.rc-fl::-webkit-scrollbar{display:none}
.rc-f{all:unset;cursor:pointer;flex:none;padding:4px 10px;border-radius:99px;font:600 11.5px/1.3 var(--font,inherit);color:var(--text2);background:var(--rc-fill)}
.rc-f.on{background:var(--text);color:var(--card,#fff)}.rc-f i{font-style:normal;opacity:.65;margin-left:3px}
.rc-day{font:700 11px/1.2 var(--font,inherit);color:var(--text3);margin:6px 0 0 2px}
.rc-it{display:grid;grid-template-columns:30px minmax(0,1fr);gap:9px;align-items:start;padding:8px 6px;border-radius:12px;cursor:pointer}
.rc-it:hover{background:var(--rc-fill)}
.rc-ico{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;background:var(--rc-fill);font-size:14px;color:var(--text2)}
.rc-it .tp{display:flex;gap:6px;align-items:baseline;flex-wrap:wrap;font-size:11.5px;color:var(--text3)}
.rc-it .tp b{color:var(--text2);font-weight:650}
.rc-it .tx{font-size:13.5px;line-height:1.4;overflow-wrap:anywhere;margin-top:1px}
.rc-it .sb{font-size:12px;color:var(--text2);margin-top:2px;overflow-wrap:anywhere}
.rc-it.done .tx{color:var(--text2)}
.rc-ask{display:flex;gap:8px}
.rc-note{font-size:11.5px;color:var(--text3);line-height:1.45}
.rc-dpn{display:grid;gap:6px;margin:0 0 12px;padding:10px 12px;border-radius:14px;border:1px dashed color-mix(in srgb,var(--text) 18%,transparent);background:color-mix(in srgb,var(--text) 3%,transparent)}
.rc-dpn-h{display:flex;justify-content:space-between;gap:8px;align-items:center;font:700 11px/1.2 var(--font,inherit);letter-spacing:.06em;text-transform:uppercase;color:var(--text3)}
.rc-dpn-h button{all:unset;cursor:pointer;font:600 12px var(--font,inherit);letter-spacing:0;text-transform:none;color:var(--accent,var(--gold))}
.rc-dpn-n{display:flex;gap:8px;font-size:13px;line-height:1.4;overflow-wrap:anywhere}.rc-dpn-n small{color:var(--text3);font-size:11.5px;white-space:nowrap}
.dep-card .dc-room,.dpn-room{cursor:pointer}
.dep-card .dc-room:hover{text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px}
[data-room-card]{cursor:pointer}
.rc-i{all:unset;cursor:pointer;display:inline-grid;place-items:center;width:20px;height:20px;margin-left:4px;border-radius:50%;font:700 11px/1 var(--font,inherit);color:var(--text3);background:color-mix(in srgb,var(--text) 7%,transparent);vertical-align:middle}
.rc-i:hover{color:var(--text);background:color-mix(in srgb,var(--text) 14%,transparent)}
@media (max-width:640px){
  .rc-sheet{top:auto;left:0;width:100vw;max-height:92vh;max-height:92dvh;border-left:0;border-top:1px solid var(--rc-hair);border-radius:22px 22px 0 0;animation:rcUp .24s cubic-bezier(.2,.8,.2,1);box-shadow:0 -20px 60px -20px rgba(0,0,0,.5)}
  .rc-grab{display:block;width:38px;height:5px;border-radius:3px;background:var(--rc-hair);margin:8px auto 0}
  .rc-hd{padding:10px 14px 10px}.rc-bd{padding:10px 14px calc(22px + env(safe-area-inset-bottom))}
  .rc-facts{gap:5px}.rc-fact{padding:6px 8px}.rc-fact b{font-size:12.5px}
  .rc-rm{min-width:58px;font-size:18px}
}
@media (prefers-reduced-motion:reduce){.rc-sheet,.rc-scrim{animation:none}}
`;
function ensureStyle() { if (!doc.getElementById('rc-style')) { const st = doc.createElement('style'); st.id = 'rc-style'; st.textContent = CSS; doc.head.appendChild(st); } }

function open(room) {
  ensureStyle();
  const rk = roomKey(room);
  safe(() => { if (typeof gsClose === 'function') gsClose(); });
  const wasOpen = !!sheet();
  if (!wasOpen) C.back = doc.activeElement;
  Object.assign(C, { room: rk ? displayRoom(room) : '', rk, f: C.rk === rk ? C.f : 'all', edit: '', del: '', form: '', more: false });
  let sc = doc.getElementById('rcScrim'), sh = sheet();
  if (!sc) { sc = doc.createElement('div'); sc.id = 'rcScrim'; sc.className = 'rc-scrim'; sc.addEventListener('click', close); doc.body.appendChild(sc); }
  if (!sh) {
    sh = doc.createElement('aside'); sh.id = 'rcSheet'; sh.className = 'rc-sheet'; sh.tabIndex = -1;
    sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true'); sh.setAttribute('aria-labelledby', 'rcTitle');
    sh.addEventListener('click', onClick); sh.addEventListener('keydown', onKey); sh.addEventListener('input', onInput);
    doc.body.appendChild(sh);
  }
  paint(true);
  if (rk) {
    act('room_card', 'Room ' + C.room);
    loadPast(C.room).then(n => { if (n && C.rk === rk && sheet()) paint(); }).catch(() => {});
  }
  setTimeout(() => safe(() => { const i = doc.getElementById('rcAsk'); if (i) i.focus(); else if (!wasOpen) sh.focus({ preventScroll: true }); }), 40);
}
/** the room as people write it: "0106" from the in-house list, else as asked */
function displayRoom(room) {
  const ih = inHouse(room); if (ih && ih.room) return String(ih.room);
  const d = depOf(room); if (d) return String(d.roomStr);
  const a = arrOf(room)[0]; if (a && a.room) return String(a.room);
  return String(room).trim();
}
function close() {
  const sh = sheet(), sc = doc.getElementById('rcScrim');
  const ta = doc.getElementById('rcText');
  if (ta && ta.value.trim() && !confirm('Close without saving the note you are writing?')) return;
  if (sh) sh.remove(); if (sc) sc.remove();
  C.rk = ''; C.room = '';
  safe(() => { if (C.back && C.back.focus && doc.contains(C.back)) C.back.focus({ preventScroll: true }); });
}
function closeQuiet() { const ta = doc.getElementById('rcText'); if (ta) ta.value = ''; close(); }

/** today's departure status of a room on the board */
function depStatus(d) {
  if (!d) return null;
  const es = safe(() => (typeof effectiveStatus === 'function' ? effectiveStatus(d) : d.status), d.status);
  const owes = safe(() => (typeof depOwes === 'function' ? depOwes(d) : (+d.balance || 0) > 0), false);
  let label, tone = '';
  if (d.intent === 'finance_hold' && es !== 'out') { label = '🧾 Left · waiting for finance'; tone = 'warn'; }
  else if (es === 'out') { label = '✓ Checked out' + (d.checkoutAt ? ' ' + d.checkoutAt : ''); tone = 'ok'; }
  else if (es === 'late') { label = '⏰ Late check-out' + (d.lateTime ? ' until ' + d.lateTime : ''); tone = 'warn'; }
  else if (es === 'extended') { const b = isoDate(d.departure); label = '↪ Extended' + (d.extensionNights ? ' +' + d.extensionNights + ' N' + (b ? ' → ' + fmtD(addDays(b, +d.extensionNights)) : '') : ''); tone = 'acc'; }
  else if (d.intent === 'extending') { label = '⏳ Extending (paperwork)'; tone = 'acc'; }
  else if (es === 'na') { label = '📵 No answer' + (d.naTime ? ' ' + d.naTime : ''); tone = 'bad'; }
  else if (es === 'dnd') { label = '🚫 DND' + (d.dndTime ? ' ' + d.dndTime : ''); tone = 'bad'; }
  else { label = '🧳 Due out' + (d.depTime ? ' · ' + d.depTime : ''); tone = 'warn'; }
  return { label, tone, owes, bal: +d.balance || 0 };
}
const money = n => (Math.round((+n || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function model() {
  const room = C.room, t = today();
  const ih = allowed('inhouse') ? inHouse(room) : null;
  const d = allowed('departures') ? depOf(room) : null;
  const arr = allowed('arrivals') ? arrOf(room) : [];
  const ds = depStatus(d);
  const notes = notesNow(room);
  const guest = ih ? ih.names.join(' · ') : d ? d.name : arr[0] ? arr[0].name : '';
  let dates = '';
  if (ih && ih.status === 'out') dates = `${fmtD(ih.arrival) || '—'} → ${fmtD(ih.departure) || '—'} · checked out${ih.checkedOutAt ? ' ' + ih.checkedOutAt : ''} (Departures)`;
  else if (ih) { const left = ih.departure ? diffDays(t, ih.departure) : null; dates = `${fmtD(ih.arrival) || '—'} → ${fmtD(ih.departure) || '—'}${ih.nights ? ' · ' + ih.nights + ' n' : ''}${ih.extendedTo ? ' · ↪ extended +' + ih.extNights + 'N' : ''}${left == null ? '' : left <= 0 ? ' · leaves today' : left === 1 ? ' · 1 night left' : ' · ' + left + ' nights left'}`; }
  else if (d) { const a = isoDate(d.arrival), b = isoDate(d.departure); dates = `${fmtD(a) || '—'} → ${fmtD(b) || '—'}${d.nights ? ' · ' + d.nights + ' n' : ''}`; }
  return { room, ih, d, ds, arr, notes, guest, dates, dep: ds ? ds.label.replace(/^\S+\s/, '') : '', arrTxt: arr.map(g => g.name).join(', ') };
}

function paint(first) {
  const sh = sheet(); if (!sh) return;
  const keepScroll = !first && sh.querySelector('.rc-bd') ? sh.querySelector('.rc-bd').scrollTop : 0;
  const draft = doc.getElementById('rcText'), dv = draft ? draft.value : '', hadFocus = draft && doc.activeElement === draft;
  if (!C.rk) {
    sh.setAttribute('aria-label', 'Room card');
    sh.innerHTML = `<div class="rc-grab" aria-hidden="true"></div><div class="rc-hd"><div class="rc-rm"><small>Room</small>?</div><div class="rc-who"><h2 id="rcTitle">Room card</h2><div class="rc-sub">Guest, notes and everything that happened in a room — WhatsApp, HK requests, handover, logs, wake-up calls.</div></div><button type="button" class="rc-x" data-rc="close" aria-label="Close">✕</button></div>
      <div class="rc-bd"><form class="rc-ask" data-rc-form="ask"><input class="rc-in" id="rcAsk" inputmode="numeric" maxlength="6" placeholder="Room number, e.g. 512" aria-label="Room number" autocomplete="off"><button type="submit" class="rc-btn pri">Open</button></form>${recentHtml()}</div>`;
    return;
  }
  const M = model(), t = today(), w = who();
  sh.setAttribute('aria-label', 'Room ' + M.room);
  const ih = M.ih;
  const tags = [];
  if (ih && ih.vip) tags.push(`<span class="rc-tag warn">⭐ VIP ${esc(ih.vip.length <= 4 ? ih.vip : '')}</span>`);
  if (ih && ih.member) tags.push('<span class="rc-tag acc">ALL</span>');
  if (M.ds) tags.push(`<span class="rc-tag ${M.ds.tone}">${esc(M.ds.label)}</span>`);
  else if (ih && ih.status === 'out') tags.push(`<span class="rc-tag ok">✓ Checked out${ih.checkedOutAt ? ' ' + esc(ih.checkedOutAt) : ''}</span>`);
  else if (ih && ih.status === 'extended') tags.push(`<span class="rc-tag acc">↪ Extended +${ih.extNights} N → ${esc(fmtD(ih.extendedTo))}</span>`);
  if (M.arr.length) tags.push('<span class="rc-tag acc">🛎️ Arriving today</span>');
  if (ih && ih.departure === t && !M.ds && ih.status !== 'out') tags.push('<span class="rc-tag warn">Departs today</span>');
  const head = `<div class="rc-grab" aria-hidden="true"></div><div class="rc-hd"><div class="rc-rm"><small>Room</small>${esc(M.room)}</div>
    <div class="rc-who"><h2 id="rcTitle">${esc(M.guest || 'Room ' + M.room)}</h2><div class="rc-sub">${esc(M.dates || (M.guest ? '' : 'No guest in the lists loaded today'))}</div>${tags.length ? `<div class="rc-tags">${tags.join('')}</div>` : ''}</div>
    <button type="button" class="rc-x" data-rc="close" aria-label="Close">✕</button></div>`;
  // today
  const today_ = [];
  if (M.d) today_.push(`<div class="rc-line"><span><b>Departure today</b> · ${esc(M.ds.label)}${M.ds.owes ? ` · <span style="color:var(--red)">AED ${esc(money(M.ds.bal))} owing</span>` : ''}</span><button type="button" class="rc-btn sm pri" data-rc="dep">${icon('departures', '🧳')} Open on Departures</button></div>`);
  M.arr.forEach(g => today_.push(`<div class="rc-line"><span><b>Arriving today</b> · ${esc(g.name)}${g.nights ? ' · ' + g.nights + ' n' : ''}${g.source ? ` <span class="dim">· ${esc(g.source)}</span>` : ''}</span><button type="button" class="rc-btn sm" data-rc="arr">${icon('arrivals', '🛎️')} Arrivals</button></div>`));
  if (ih) {
    const pax = ih.adults + ih.children, left = ih.departure ? diffDays(t, ih.departure) : null;
    const facts = [['Arrival', fmtD(ih.arrival) || '—'], ['Departure', (fmtD(ih.departure) || '—') + (ih.extendedTo ? ' ↪' : '')], ['Nights left', ih.status === 'out' ? 'out' : left == null ? '—' : Math.max(0, left)], ['Pax', pax ? ih.adults + (ih.children ? '+' + ih.children : '') : '—'],
      ['Company', ih.company || ih.agent || '—'], ['Rate', ih.rateCode || '—'], ['Balance', ih.balance ? 'AED ' + money(ih.balance) : '—', ih.balance > 0 ? 'owe' : ''], ['Conf.', ih.conf || '—'], ['Room type', ih.roomType || '—']];
    today_.push(`<div class="rc-facts">${facts.map(f => `<div class="rc-fact ${f[2] || ''}"><small>${esc(f[0])}</small><b title="${esc(f[1])}">${esc(f[1])}</b></div>`).join('')}</div>`);
    if (ih.names.length > 1) today_.push(`<div class="rc-note">Sharing: ${esc(ih.names.slice(1).join(' · '))}</div>`);
  }
  const todayHtml = today_.length ? `<section class="rc-sec" aria-label="Today"><div class="rc-h">Today <em>${esc(fmtD(t))}</em></div><div class="rc-box">${today_.join('')}</div></section>` : '';
  // quick actions
  const A = [];
  if (allowed('inhouse') && ih) A.push(`<button type="button" class="rc-btn sm" data-rc="ih">${icon('inhouse', '🛏️')} In-House</button>`);
  if (M.d) A.push(`<button type="button" class="rc-btn sm" data-rc="dep">${icon('departures', '🧳')} Departures</button>`);
  if (canWrite() && allowed('handover-book') && W.hoHandoverBook && W.hoHandoverBook.addByHand) A.push(`<button type="button" class="rc-btn sm" data-rc="form" data-v="ho">📒 Handover item</button>`);
  if (canWrite() && allowed('hk-requests') && W.hoWaBrain && typeof W.hoWaBrain.addRequest === 'function') A.push(`<button type="button" class="rc-btn sm" data-rc="form" data-v="hk">🧺 HK request</button>`);
  A.push(`<button type="button" class="rc-btn sm" data-rc="copy">⧉ Copy for WhatsApp</button>`);
  const form = C.form ? `<form class="rc-ask" data-rc-form="${C.form}"><input class="rc-in" id="rcFormIn" maxlength="300" placeholder="${C.form === 'ho' ? 'Handover for room ' + esc(M.room) + '…' : 'What does room ' + esc(M.room) + ' need? e.g. 2 towels'}" aria-label="${C.form === 'ho' ? 'Handover item' : 'HK request'}" autocomplete="off"><button type="submit" class="rc-btn pri">Add</button><button type="button" class="rc-btn" data-rc="form" data-v="">Cancel</button></form>` : '';
  const actsHtml = `<div class="rc-acts">${A.join('')}</div>${form}`;
  // notes
  const add = canWrite() ? `<div class="rc-box"><textarea class="rc-ta" id="rcText" rows="1" maxlength="600" placeholder="Add a note for room ${esc(M.room)}…" aria-label="New room note"></textarea>
      <div class="rc-cats" role="radiogroup" aria-label="Note type">${CATS.map(c => `<button type="button" role="radio" aria-checked="${C.cat === c[0]}" class="rc-cat${C.cat === c[0] ? ' on' : ''}" style="--k:${c[3]}" data-rc="cat" data-v="${c[0]}">${c[2]} ${esc(c[1])}</button>`).join('')}</div>
      <div class="rc-row"><span class="rc-seg" role="group" aria-label="How long">${[['stay', 'This stay'], ['today', 'Just today']].map(([k, l]) => `<button type="button" class="${C.scope === k ? 'on' : ''}" aria-pressed="${C.scope === k}" data-rc="scope" data-v="${k}">${l}</button>`).join('')}</span>
      <span class="rc-acts"><button type="button" class="rc-btn sm${C.pin ? ' pri' : ''}" data-rc="pinnew" aria-pressed="${C.pin}" title="Pin this note on top">${C.pin ? '★ Pinned' : '☆ Pin'}</button><button type="button" class="rc-btn sm pri" data-rc="add">Add note</button></span></div></div>` : '';
  const notes = M.notes.map(n => noteHtml(n, w)).join('');
  const depNotes = depNoteLines(M.d);
  const notesHtml = `<section class="rc-sec" aria-label="Room notes"><div class="rc-h">Room notes <em>${M.notes.length ? M.notes.length + ' for this stay' : ''}</em></div>${add}
    ${notes || (depNotes ? '' : '<div class="rc-empty">No notes for this stay yet. A note stays while the same guest is in the room.</div>')}
    ${depNotes}</section>`;
  // timeline
  const T = timeline(M.room);
  C.go = T.map(i => i.go);
  const srcs = [['all', 'All'], ['wa', 'WhatsApp'], ['hk', 'HK'], ['ho', 'Handover'], ['log', 'Log'], ['wake', 'Wake-up'], ['gym', 'Gym'], ['dep', 'Departures']];
  const cnt = k => (k === 'all' ? T.length : T.filter(i => i.src === k).length);
  if (C.f !== 'all' && !cnt(C.f)) C.f = 'all';
  const V = T.map((it, i) => [it, i]).filter(([it]) => C.f === 'all' || it.src === C.f);
  const LIM = C.more ? 400 : 40;
  let lastDay = '', tl = '';
  V.slice(0, LIM).forEach(([it, i]) => {
    const dd = dayOf(it.at);
    if (dd !== lastDay) { lastDay = dd; tl += `<div class="rc-day">${dd === t ? 'Today' : dd === addDays(t, -1) ? 'Yesterday' : dd > t ? fmtD(dd) + ' · upcoming' : fmtD(dd)}</div>`; }
    tl += `<div class="rc-it${it.done ? ' done' : ''}" role="button" tabindex="0" data-rc="go" data-i="${i}" title="Open in ${esc(it.src2 || '')}">
      <span class="rc-ico" aria-hidden="true">${it.icon || '•'}</span>
      <div style="min-width:0"><div class="tp"><b>${esc(it.src2 || '')}</b><span>${esc(tm12(it.at))}</span>${it.who ? `<span>· ${esc(it.who)}</span>` : ''}</div>
      <div class="tx">${esc(it.text)}</div>${it.sub ? `<div class="sb">${esc(it.sub)}</div>` : ''}</div></div>`;
  });
  const tlHtml = `<section class="rc-sec" aria-label="Timeline"><div class="rc-h">This stay <em>${T.length ? T.length + ' event' + (T.length === 1 ? '' : 's') : ''}</em></div>
    ${T.length ? `<div class="rc-fl" role="tablist" aria-label="Show">${srcs.filter(([k]) => k === 'all' || cnt(k)).map(([k, l]) => `<button type="button" role="tab" aria-selected="${C.f === k}" class="rc-f${C.f === k ? ' on' : ''}" data-rc="f" data-v="${k}">${l}<i>${cnt(k)}</i></button>`).join('')}</div>` : ''}
    <div>${tl || '<div class="rc-empty">Nothing yet for this stay — WhatsApp messages, HK requests, handover items, logs and wake-up calls about this room show here.</div>'}</div>
    ${V.length > LIM ? `<button type="button" class="rc-btn sm" data-rc="more">Show all ${V.length}</button>` : ''}</section>`;
  sh.innerHTML = head + `<div class="rc-bd">${todayHtml}${safe(() => (W.hoRoomHealth && W.hoRoomHealth.cardHtml ? W.hoRoomHealth.cardHtml(M.room) : ''), '')}${actsHtml}${notesHtml}${tlHtml}<div class="rc-note">Guest Memory is never shown here.</div></div>`;
  const bd = sh.querySelector('.rc-bd'); if (bd && keepScroll) bd.scrollTop = keepScroll;
  const ta = doc.getElementById('rcText'); if (ta && dv) { ta.value = dv; grow(ta); if (hadFocus) { ta.focus(); ta.setSelectionRange(dv.length, dv.length); } }
}
function recentHtml() {
  const rooms = safe(() => (W.hoInHouse ? W.hoInHouse.rooms() : []), []);
  const withNotes = Object.keys(N.all).filter(k => notesNow(k).length).slice(0, 12);
  const chips = withNotes.map(k => `<button type="button" class="rc-f" data-rc="open" data-v="${esc(k)}">${esc(k)}<i>${notesNow(k).length}📝</i></button>`).join('');
  return `${chips ? `<div class="rc-h">Rooms with notes</div><div class="rc-fl" style="flex-wrap:wrap">${chips}</div>` : ''}<div class="rc-note">${rooms.length ? rooms.length + ' rooms in the in-house list.' : 'Load the in-house report to see who is in each room.'}</div>`;
}
function noteHtml(n, w) {
  const c = CAT[n.cat] || CAT.gen, rk = C.rk, mine = canEdit(n, w);
  const when = dayOf(n.at) === today() ? tm12(n.at) : fmtD(dayOf(n.at)) + ', ' + tm12(n.at);
  if (C.edit === n.id) return `<div class="rc-n" style="--k:${c.c}"><span class="ic">${c.i}</span><div style="min-width:0;display:grid;gap:6px"><textarea class="rc-ta" id="rcEdit" rows="2" maxlength="600" aria-label="Edit the note">${esc(n.text)}</textarea>
    <div class="rc-cats">${CATS.map(x => `<button type="button" class="rc-cat${(C.editCat || n.cat) === x[0] ? ' on' : ''}" style="--k:${x[3]}" data-rc="ecat" data-v="${x[0]}">${x[2]} ${esc(x[1])}</button>`).join('')}</div>
    <div class="rc-acts" style="justify-content:flex-end"><button type="button" class="rc-btn sm" data-rc="ecancel">Cancel</button><button type="button" class="rc-btn sm pri" data-rc="esave" data-id="${esc(n.id)}">Save</button></div></div><span></span></div>`;
  const delQ = C.del === n.id ? `<div class="rc-delq" role="alert">Delete this note? <button type="button" class="rc-btn sm" data-rc="dkeep">Keep</button><button type="button" class="rc-btn sm pri" data-rc="ddel" data-id="${esc(n.id)}">Delete</button></div>` : '';
  return `<div class="rc-n${n.pin ? ' pin' : ''}" style="--k:${c.c}"><span class="ic" title="${esc(c.l)}">${c.i}</span>
    <div style="min-width:0"><div class="tx">${esc(n.text)}</div><div class="mt"><span>${esc(c.l)}</span><span>${esc(n.by || '')} · ${esc(when)}</span><span>${n.scope === 'today' ? 'Just today' : 'This stay'}</span>${n.editedBy ? `<span>edited by ${esc(n.editedBy)}</span>` : ''}${n.pin ? '<span>★ Pinned</span>' : ''}</div></div>
    <span class="ac">${canWrite() ? `<button type="button" class="rc-ib${n.pin ? ' on' : ''}" data-rc="pin" data-id="${esc(n.id)}" aria-pressed="${!!n.pin}" title="${n.pin ? 'Unpin' : 'Pin on top'}" aria-label="${n.pin ? 'Unpin note' : 'Pin note'}">${n.pin ? '★' : '☆'}</button>` : ''}${mine ? `<button type="button" class="rc-ib" data-rc="edit" data-id="${esc(n.id)}" title="Edit" aria-label="Edit note">✎</button><button type="button" class="rc-ib" data-rc="del" data-id="${esc(n.id)}" title="Delete" aria-label="Delete note">🗑</button>` : ''}</span>${delQ}</div>`;
}
/** the room's lines in today's Departures notes, read-only (each can be kept as a room note) */
function depNoteLines(d) {
  if (!d || !d.note || typeof dpnParse !== 'function') return '';
  const E = safe(() => dpnParse(d.note), []); if (!E.length) return '';
  const cats = safe(() => (typeof DPN_CAT !== 'undefined' ? DPN_CAT : {}), {});
  const kept = new Set(notesOf(C.rk).map(n => String(n.text).trim()));
  const L = E.slice().sort((a, b) => (b.time || '').localeCompare(a.time || '') || b.start - a.start).slice(0, 12);
  return `<div class="rc-box"><div class="rc-h" style="margin:0">On today's Departures <em>${E.length}</em></div>${L.map(e => { const c = cats[e.cat] || { i: '📝' }; const txt = String(e.body || e.text).trim();
    return `<div class="rc-dpn-n"><span>${c.i}</span><span style="flex:1;min-width:0">${esc(txt)}${e.via ? ` <small>· WhatsApp ${esc(e.via.who)}</small>` : ''}</span><small>${esc(e.time || '')}</small>${canWrite() && !kept.has(txt) ? `<button type="button" class="rc-ib" data-rc="keep" data-v="${esc(txt)}" data-c="${esc(e.cat)}" title="Keep as a room note for this stay" aria-label="Keep as a room note">⇪</button>` : ''}</div>`; }).join('')}</div>`;
}
function grow(t) { t.style.height = 'auto'; t.style.height = Math.min(160, t.scrollHeight) + 'px'; }
function submitNote() {
  const ta = doc.getElementById('rcText'); if (!ta) return;
  const txt = ta.value.trim(); if (!txt) { ta.focus(); return; }
  ta.value = '';   // before saving: saving redraws the card, which keeps what is in the box
  const pin = C.pin; C.pin = false;
  if (!addNote(C.room, txt, C.cat, C.scope, pin)) { C.pin = pin; const t1 = doc.getElementById('rcText'); if (t1) t1.value = txt; return; }
  paint(); const t2 = doc.getElementById('rcText'); if (t2) t2.focus();
}
function onInput(e) { if (e.target.id === 'rcText' || e.target.id === 'rcEdit') grow(e.target); }
function onEsc(e) {
  if (e.key !== 'Escape' || !sheet()) return;
  e.stopPropagation(); e.preventDefault();
  if (C.edit || C.del || C.form) { C.edit = C.del = C.form = ''; paint(); return; }
  close();
}
function onKey(e) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    if (e.target.id === 'rcText') { e.preventDefault(); submitNote(); return; }
    if (e.target.id === 'rcEdit') { e.preventDefault(); saveEdit(C.edit); return; }
    if (e.target.classList && e.target.classList.contains('rc-it')) { e.preventDefault(); e.target.click(); return; }
  }
  if (e.key === 'Tab') {
    const sh = sheet(); const f = [...sh.querySelectorAll('button,input,textarea,[tabindex="0"]')].filter(x => x.offsetParent && !x.disabled);
    if (!f.length) return;
    if (e.shiftKey && doc.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && doc.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  }
}
function saveEdit(id) {
  const t = doc.getElementById('rcEdit'); if (!t || !id) return;
  const txt = t.value.trim();
  if (!txt) { C.edit = ''; C.del = id; paint(); return; }
  patchNote(C.rk, id, { text: txt.slice(0, 600), cat: C.editCat || ((N.all[fbKey(C.rk)] || {})[id] || {}).cat || 'gen' });
  C.edit = ''; C.editCat = ''; paint();
}
function onClick(e) {
  safe(() => {
    const f = e.target.closest('form[data-rc-form]');
    if (f && e.target.closest('button[type="submit"]')) { e.preventDefault(); submitForm(f); return; }
    const b = e.target.closest('[data-rc]'); if (!b) return;
    const a = b.dataset.rc, v = b.dataset.v, id = b.dataset.id;
    if (a === 'close') close();
    else if (a === 'open') open(v);
    else if (a === 'cat') { C.cat = v; paint(); }
    else if (a === 'scope') { C.scope = v; paint(); }
    else if (a === 'pinnew') { C.pin = !C.pin; paint(); }
    else if (a === 'add') submitNote();
    else if (a === 'pin') { const n = (N.all[fbKey(C.rk)] || {})[id]; if (n) patchNote(C.rk, id, { pin: !n.pin }); }
    else if (a === 'edit') { C.edit = id; C.del = ''; C.editCat = ''; paint(); setTimeout(() => { const t = doc.getElementById('rcEdit'); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); grow(t); } }, 0); }
    else if (a === 'ecat') { C.editCat = v; const t = doc.getElementById('rcEdit'), keep = t ? t.value : ''; paint(); const t2 = doc.getElementById('rcEdit'); if (t2) { t2.value = keep; grow(t2); } }
    else if (a === 'ecancel') { C.edit = ''; paint(); }
    else if (a === 'esave') saveEdit(id);
    else if (a === 'del') { C.del = id; C.edit = ''; paint(); }
    else if (a === 'dkeep') { C.del = ''; paint(); }
    else if (a === 'ddel') { C.del = ''; delNote(C.rk, id); }
    else if (a === 'keep') { addNote(C.room, v, CAT[b.dataset.c] ? b.dataset.c : 'gen', 'stay', false); }
    else if (a === 'f') { C.f = v; paint(); }
    else if (a === 'more') { C.more = true; paint(); }
    else if (a === 'form') { C.form = v || ''; paint(); setTimeout(() => { const i = doc.getElementById('rcFormIn'); if (i) i.focus(); }, 0); }
    else if (a === 'go') { const fn = C.go[+b.dataset.i]; if (fn) { closeQuiet(); fn(); } }
    else if (a === 'dep') { const r = C.room; closeQuiet(); goDeparture(r); }
    else if (a === 'ih') { const r = C.room; closeQuiet(); goInHouse(r); }
    else if (a === 'arr') { const r = C.room; closeQuiet(); goArrivals(r); }
    else if (a === 'copy') copy(summaryText(Object.assign(model(), { dep: (model().ds || {}).label || '', arr: model().arrTxt })));
  });
}
function submitForm(f) {
  const kind = f.dataset.rcForm;
  if (kind === 'ask') { const v = (doc.getElementById('rcAsk') || {}).value || ''; if (roomKey(v)) open(v.trim()); else toast('Write a room number', 'err'); return; }
  const i = doc.getElementById('rcFormIn'), txt = i ? i.value.trim() : ''; if (!txt) { if (i) i.focus(); return; }
  if (kind === 'ho') {
    const n = safe(() => W.hoHandoverBook.addByHand(`Room ${C.room}: ${txt}`), 0);
    toast(n ? `📒 Added to the Handover Book` : 'Could not add the handover item', n ? 'ok' : 'err');
  } else if (kind === 'hk') safe(() => W.hoWaBrain.addRequest(C.room, '', txt, ''));
  C.form = ''; paint();
}
function copy(s) {
  const done = () => toast('Copied ✓');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(s).then(done, fallback); else fallback();
  function fallback() { const ta = doc.createElement('textarea'); ta.value = s; ta.style.cssText = 'position:fixed;opacity:0'; doc.body.appendChild(ta); ta.select(); try { doc.execCommand('copy'); done(); } catch (_) { toast('Could not copy', 'err'); } ta.remove(); }
}

// ══ Departures: the room's stay notes in the "Room notes" window ══
function depNotesHtml(roomStr) {
  return safe(() => {
    const L = notesNow(roomStr);
    const btn = `<button type="button" data-room-card="${esc(roomStr)}">Room card →</button>`;
    if (!L.length) return `<div class="rc-dpn"><div class="rc-dpn-h"><span>🛏️ Room notes · this stay</span>${btn}</div><div class="rc-note">None. Notes added on the room card stay with the guest for the whole stay; ⇪ on a note below keeps it there.</div></div>`;
    return `<div class="rc-dpn"><div class="rc-dpn-h"><span>🛏️ Room notes · this stay · ${L.length}</span>${btn}</div>${L.slice(0, 8).map(n => { const c = CAT[n.cat] || CAT.gen; return `<div class="rc-dpn-n"><span>${c.i}</span><span style="flex:1;min-width:0">${n.pin ? '★ ' : ''}${esc(n.text)}</span><small>${esc(n.by || '')} · ${esc(dayOf(n.at) === today() ? tm12(n.at) : fmtD(dayOf(n.at)))}</small></div>`; }).join('')}</div>`;
  }, '');
}
/** a Departures note kept as a room note (⇪ in the Departures notes window) */
function promote(room, text, depCat) {
  const map = { lug: 'lug', taxi: 'taxi', pay: 'pay', vip: 'vip', hk: 'hk', mnt: 'mnt', call: 'call', fin: 'fin', lco: 'lco', ext: 'ext' };
  const txt = String(text || '').trim(); if (!txt) return null;
  if (notesOf(roomKey(room)).some(n => String(n.text).trim() === txt && noteVisible(n, stayNow(room), today()))) { toast('Already a room note for this stay', 'info'); return null; }
  return addNote(room, txt, map[depCat] || 'gen', 'stay', false);
}

// ══ Wiring: room numbers open the card ══════════════════════
function onDocClick(e) {
  const t = e.target; if (!t || !t.closest) return;
  const el = t.closest('[data-room-card]');
  if (el && !el.closest('#rcSheet')) {
    e.preventDefault(); e.stopPropagation();
    safe(() => { if (typeof waClose === 'function' && el.closest('#waOv')) waClose(); });
    if (el.closest('#dpnOv')) { safe(() => depCloseNotes()); const ov = doc.getElementById('dpnOv'); if (ov && ov.classList.contains('open') && !ov.classList.contains('dpn-closing')) return; }   // a note still being written: stay
    open(el.getAttribute('data-room-card')); return;
  }
  // the room number on a Departures card (not while picking rooms: then the card itself is the button)
  const rm = t.closest('.dep-card .dc-room');
  if (rm) { const card = rm.closest('.dep-card'); if (card && !card.hasAttribute('onclick') && card.dataset.room) { e.stopPropagation(); open(card.dataset.room); } return; }
  const dh = t.closest('#dpnOv .dpn-room');
  if (dh) { const r = safe(() => _dpn.room, null); if (r) { safe(() => depCloseNotes()); if (!doc.getElementById('dpnOv') || !doc.getElementById('dpnOv').classList.contains('open')) open(r); } }
}
function wrapBrain() {
  const inner = W.brAsk;
  if (typeof inner !== 'function' || inner.__rc) return;
  W.brAsk = function (q) {
    const r = brainRoom(q);
    if (r) { safe(() => { if (typeof brClose === 'function') brClose(); }); setTimeout(() => open(r), 30); return; }
    return inner.apply(this, arguments);
  };
  W.brAsk.__rc = true;
}

function mount() {
  ensureStyle();
  doc.addEventListener('click', onDocClick, true);
  doc.addEventListener('keydown', onEsc, true);
  startSync();
  // Departures / In-House changed (inhouse.js watches the board): the open card follows, unless a note is being edited
  W.addEventListener('ho-inhouse-live', () => safe(() => {
    if (!C.rk || !sheet()) return;
    const a = doc.activeElement; if (a && (a.id === 'rcEdit' || a.id === 'rcFormIn')) return;
    paint();
  }));
  let n = 0; const iv = setInterval(() => { safe(wrapBrain); if (++n > 15) clearInterval(iv); }, 1000);
  safe(wrapBrain);
}
W.hoRoom = { open, close, notes: notesNow, count: room => notesNow(room).length, addNote, promote, depNotesHtml, timeline, stay: stayNow, known, brainRoom, state: () => C, store: () => N };
if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', mount); else mount();
})();
