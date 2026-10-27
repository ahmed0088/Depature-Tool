// ═══════════════════════════════════════════════════════════
//  wa-brain.js — Ops Brain learns from the WhatsApp HK group
//
//  Reads what wa-bridge.js keeps (today's log in localStorage ho_wa_log_v1
//  via hoWaBridge.log(), and the hotel's backup waChat/{YYYY-MM-DD}/{key} =
//  {t, s, x, r, m?, e?, u?}) and puts it to work:
//   • Ops Brain search: "324", "what happened with 0113", "towels",
//     "late checkouts today" → a "💬 HK chat" card with the messages.
//   • Live thoughts (BL_THINKERS): requests nobody answered, maintenance
//     words on a room, extensions still to put in Opera, a WhatsApp
//     check-out that still owes money, rooms that keep coming back, the
//     reader that went quiet, words HotelOps does not understand yet.
//   • Reminders learned from the chat ("202 LCO 6PM" → 5:45 PM and 6:05 PM,
//     "remind 305 taxi at 4" → 3:55 PM), shared at waChatRem/{date}/{id}.
//   • A 💬 chip on Departures cards when the chat talks about that room.
//   • "HK chat this shift" in the shift handover.
//   • The 🧺 HK Requests page: most requested things, room moves and why,
//     problem rooms, tips, CSV / Excel.
//   • Pure logic for typo-tolerant command words ("ckod", "xtnd", "lt co"),
//     the team's learned words (waWords/{word}) and the "what does it mean?"
//     question queue (window.hoWaAsk), ready for the WhatsApp reader.
//  Everything is wrapped in try/catch: a failure here never breaks Ops Brain
//  or Departures. Load after wa-bridge.js.
//  Pure helpers: window.hoWaBrainPure (tested in tests/run-tests.js).
// ═══════════════════════════════════════════════════════════
(function () {
'use strict';
const W = typeof window !== 'undefined' ? window : globalThis;
const doc = typeof document !== 'undefined' && document && document.createElement ? document : null;

// ══ Small pure helpers ══════════════════════════════════════
const sp = s => String(s == null ? '' : s).replace(/[\u00a0\u202f\u2007]/g, ' ').replace(/[\u200e\u200f\u2066-\u2069]/g, '');
const low = s => sp(s).toLowerCase();
const pad = n => String(n).padStart(2, '0');
const isoDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayAdd = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return isoDay(x); };
const toMin = t => { const m = String(t || '').match(/^(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
/** minutes → "6 PM" / "6:30 PM" */
const clock = min => { min = ((min % 1440) + 1440) % 1440; const h = Math.floor(min / 60), mi = min % 60; return (h % 12 || 12) + (mi ? ':' + pad(mi) : '') + ' ' + (h >= 12 ? 'PM' : 'AM'); };
/** "09:01" → "9:01 AM" */
const t12 = t => { const m = toMin(t); return m == null ? String(t || '') : (Math.floor(m / 60) % 12 || 12) + ':' + pad(m % 60) + (m >= 720 ? ' PM' : ' AM'); };
const hash = s => { s = String(s); let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
const rk = r => String(parseInt(r, 10));
const qMark = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);          // "0113" and "113" are the same room
const plural = (n, w, ws) => n + ' ' + (n === 1 ? w : (ws || w + 's'));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hourLbl = h => (h % 12 || 12) + ' ' + (h >= 12 && h < 24 ? 'PM' : 'AM');
const hourSpan = h => { const a = h % 12 || 12, b = (h + 2) % 12 || 12, ap1 = h >= 12 ? 'PM' : 'AM', ap2 = (h + 2) % 24 >= 12 ? 'PM' : 'AM'; return ap1 === ap2 ? `${a}–${b} ${ap2}` : `${a} ${ap1}–${b} ${ap2}`; };

/** room numbers in a message, as written: "324", "rm 0113", "#503" (not times, prices, phone extensions or dates) */
function wbRooms(text) {
  const t = sp(text), out = [], re = /(?:\b(?:rooms?|rms?|rn)\.?\s*(?:no\.?\s*)?|#\s*)?(?<![\d:.,\/+\-])\b(\d{3,4})\b(?![:.,\/]\d)(?!\s*(?:am|pm|a\.m|p\.m|hrs?|aed|dhs?|dirhams?|nights?|n\b|nts?\b|%|pax|mins?\b|minutes|kg|ml))/gi;
  let m;
  while ((m = re.exec(t))) {
    const before = t.slice(Math.max(0, m.index - 12), m.index).toLowerCase();
    if (/(?:aed|dhs?|ext\.?|tel|lco|late|till|until|untill|at|by|around|@)\s*$/.test(before) && !/(?:rooms?|rms?|#)\s*$/.test(before)) continue;
    const n = +m[1]; if (n >= 1900 && n <= 2100 && /\b(?:in|of|year)\s*$/.test(before)) continue;
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

// ══ What a message is about (one source of truth) ═══════════
// [id, label, icon, kind ('maint' | 'req'), words, search word]
const CATS = [
  ['ac', 'AC / cooling', '❄️', 'maint', /\b(?:a\/c|ac|aircon|air[\s-]?con\w*|cooling|not cold|too hot|room (?:is )?(?:too )?hot|thermostat)\b/, 'ac'],
  ['plumb', 'Plumbing / leak', '🚿', 'maint', /\b(?:leak\w*|drain\w*|blocked|blockage|clog\w*|flush\w*|toilet (?:not|is|blocked|broken)|sink|taps?|faucet|shower|hot water|no water|water (?:leak|on the floor|coming)|bath ?tub|geyser|heater)\b/, 'leak'],
  ['tv', 'TV', '📺', 'maint', /\b(?:tv|t\.v|television|remote|channels?)\b/, 'tv'],
  ['elec', 'Electric / light', '💡', 'maint', /\b(?:lights?|bulbs?|lamp|power|sockets?|plug|electric\w*|switch|fuse)\b/, 'light'],
  ['wifi', 'Wi-Fi', '📶', 'maint', /\b(?:wi-?fi|internet|wireless)\b/, 'wifi'],
  ['door', 'Door / key card', '🔑', 'maint', /\b(?:door|key ?cards?|keys?|locked|lock|safe ?box|safe not|card not working)\b/, 'door'],
  ['smell', 'Smell', '👃', 'maint', /\b(?:smell\w*|odou?r|stink\w*|smok\w*)\b/, 'smell'],
  ['noise', 'Noise', '🔊', 'maint', /\b(?:nois\w*|loud)\b/, 'noise'],
  ['pest', 'Pests', '🪳', 'maint', /\b(?:cockroach\w*|roach\w*|insects?|bugs?|bed ?bugs?|ants|mosquito\w*|pests?|rats?|mice|mouse|lizard)\b/, 'cockroach'],
  ['fix', 'Other repair', '🔧', 'maint', /\b(?:broken|not working|fix|repair|damaged?|maintenance|engineering|technician)\b/, 'broken'],
  ['towel', 'Towels', '🧺', 'req', /\b(?:towels?|bath ?mat)\b/, 'towel'],
  ['linen', 'Bedsheets / linen', '🛏️', 'req', /\b(?:bed ?sheets?|sheets?|linen|duvet|bed ?cover|pillow ?cases?)\b/, 'sheet'],
  ['clean', 'Cleaning / make-up room', '🧹', 'req', /\b(?:clean\w*|make ?up(?: the)? room|mur|service the room|vacuum|dust\w*|trash|garbage|rubbish|tidy)\b/, 'clean'],
  ['water', 'Water', '💧', 'req', /\b(?:water|bottles?)\b/, 'water'],
  ['amen', 'Amenities / toiletries', '🧴', 'req', /\b(?:amenit\w*|toiletr\w*|shampoo|soap|conditioner|shower gel|lotion|tooth ?brush\w*|tooth ?paste|dental kit|shaving kit|slippers?|comb|cotton|coffee|tea|sugar|kettle)\b/, 'amenities'],
  ['tp', 'Toilet paper / tissue', '🧻', 'req', /\b(?:toilet (?:paper|roll)s?|tissues?|tp)\b/, 'tissue'],
  ['pillow', 'Pillows', '🛌', 'req', /\bpillows?\b/, 'pillow'],
  ['blanket', 'Blanket', '🛌', 'req', /\b(?:blankets?|quilt|comforter)\b/, 'blanket'],
  ['iron', 'Iron', '👔', 'req', /\b(?:iron(?:ing)?(?: board)?)\b/, 'iron'],
  ['cot', 'Baby cot', '👶', 'req', /\b(?:baby ?cot|cot|crib|baby bed)\b/, 'cot'],
  ['xbed', 'Extra bed', '➕', 'req', /\b(?:extra bed|rollaway|roll away|sofa ?bed|additional bed)\b/, 'extra bed'],
  ['minibar', 'Minibar / fridge', '🧃', 'req', /\b(?:mini ?bar|fridge)\b/, 'minibar'],
  ['luggage', 'Luggage', '🧳', 'req', /\b(?:luggage|(?<!\b(?:tea|laundry|garbage|trash|plastic|shopping|sugar|coffee|dust|bin)\s)bags?|suitcases?|baggage|bell ?boy|porter)\b/, 'luggage'],
];
const CAT = {}; CATS.forEach(c => { CAT[c[0]] = { id: c[0], label: c[1], icon: c[2], kind: c[3], q: c[5] }; });
const CAT_RE = {}; CATS.forEach(c => { CAT_RE[c[0]] = c[4]; });                   // the built-in words (the Words & phrases page lists them)
// the hotel's own names, emoji, extra words, requests switched off or added (Settings → Hotel setup → Categories)
const catSetup = W.hoCfg && typeof W.hoCfg.catHook === 'function'
  ? W.hoCfg.catHook('hk', CATS, CAT, c => ({ id: c[0], label: c[1], icon: c[2], kind: c[3], q: c[5] }),
    (id, x, re) => [id, String(x.label), x.icon || '📝', x.kind === 'maint' ? 'maint' : 'req', re || /(?!)/, String(x.label).toLowerCase().split(/[\s/]+/)[0]])
  : () => null;
/** a message → the things it is about: [{id, label, icon, kind}] (maintenance first) */
// "no need cleaning", "don't clean", "no luggage", "cleaning not needed": what is NOT wanted is not a request
// (problems stay: "no water", "no hot water", "no power", "not working", "room not clean")
const NEG_KEEP = /^(?:water|hot|power|electricity|light|lights|signal|internet|wifi|wi|tv|ac|cooling|cold|answer|response|reply|one|body|towels?)$/;
function wbDropNeg(t) {
  return t.replace(/\b(?:no\s+need(?:\s+(?:to|of|for|any))?|don'?t|dont|do\s+not|no|without)\s+((?:(?:any|more|the|room|to)\s+)*)([a-z]+)/g, (m, pre, w) => (NEG_KEEP.test(w) ? m : ' '))
    .replace(/\b[a-z]+(?:\s+(?:room|service))?\s+(?:is\s+)?not\s+(?:needed|required|necessary)\b/g, ' ');
}
function wbCategorize(text) {
  const t = wbDropNeg(low(text).replace(/toliet/g, 'toilet').replace(/towles?/g, 'towel')), hit = [];
  const X = catSetup();
  CATS.forEach(c => { if (X ? X.hit(c[0], c[4], t) : c[4].test(t)) hit.push(c[0]); });   // built-in words the hotel removed do not count
  if (X) X.words.forEach(([id, re]) => { if (!hit.includes(id) && CATS.some(c => c[0] === id) && re.test(t)) hit.push(id); });
  const has = id => hit.includes(id);
  let ids = hit;
  if (has('plumb')) ids = ids.filter(x => x !== 'water');                        // "no water", "water leak"
  if (/pillow ?cases?/.test(t) && !/\bpillows?\b(?! ?case)/.test(t)) ids = ids.filter(x => x !== 'pillow');
  if (has('tp') && !/\bclean\w*/.test(t)) ids = ids.filter(x => x !== 'clean');
  if (ids.some(x => CAT[x].kind === 'maint' && x !== 'fix')) ids = ids.filter(x => x !== 'fix');
  if (has('door') && /\b(?:knock|open the door|at the door)\b/.test(t) && ids.length > 1) ids = ids.filter(x => x !== 'door');
  return ids.map(id => CAT[id]);
}
const REQ_W = /\b(?:please|pls|plz|plez|need(?:s|ed)?|send|bring|want(?:s|ed)?|requests?|requested|asap|urgent\w*|come|can (?:you|u|someone|somebody)|kindly|required?|missing|more|extra|change|replace|give|provide|asking|asked|not clean|dirty|waiting|still)\b|🙏/i;
const DONE_W = /\b(?:done|sent|delivered|given|ok(?:ay)?|noted|on (?:the|my) way|coming|going|will do|fixed|sorted|handled|completed?|finished|ready|attended|replaced|changed|cleaned)\b|✅|👍|✔|✓/i;
const STATUS_ONLY = /^\s*(?:(?:rooms?|rm)\s*)?\d{3,4}[\s.…:,\-]*(?:is\s*)?(?:physically\s+)?(?:clean(?:ed)?|ready|done|inspected|ok|vc|vd|oc|od|ip|n\/l|occ|vacant(?: clean)?|cleaned and ready|occupied|dnd|double\s+lock(?:ed)?|guest\s+(?:inside|sleeping)|(?:still\s+)?luggages?\s*🧳?\s*inside|inside\s+luggages?|no\s+luggages?|sleep\s*out(?:\s+(?:with(?:out)?|no)\s+luggages?)?)\s*(?:room)?\s*[.!✅👍🧳]*\s*$/iu;
// the team asking about rooms ("101 112 any update due out rooms plz", "please make check out 524"): not a job for HK
const ASK_FO = /\b(?:any\s*-?\s*updat\w*|updat\w*\s+(?:pl[sz]|please|pls)|status\s+updat\w*|make\s+(?:the\s+)?check\s*-?\s*out)\b/i;
// a front-office money note ("guest will pay the laundry bill at reception, collect payment"): not a job for HK
const PAY_W = /\b(?:pay|paid|payment|bill|charged?|collect\w*\s+(?:the\s+)?(?:payment|money|cash|amount)|by\s+card|cash)\b/i;
const GIVE_W = /\b(?:send|bring|give|provide|deliver|replace|change|fix|clean)\b/i;
/** one message → its parts, each with its own rooms ("203 physically IP, smoke smell 206, 506 wall paint smell") */
function wbParts(x) {
  const parts = [];
  sp(x).split(/[,;\n]+/).forEach(seg => { if (!seg.trim()) return; const rooms = wbRooms(seg); if (rooms.length || !parts.length) parts.push({ rooms, text: seg }); else parts[parts.length - 1].text += ', ' + seg; });
  return parts;
}
/** is this message an HK request about a room? → {rooms, cats, maint} | null */
function wbRequestOf(rec, parse) {
  const x = sp(rec && rec.x);
  if (!x.trim() || /^\s*🔁/u.test(x)) return null;
  const rooms = wbRooms(x); if (!rooms.length) return null;
  const noAt = t => t.replace(/@\S+[^\n]*/g, ' ').trim();                         // mentions say who, not what
  if (STATUS_ONLY.test(noAt(x))) return null;
  if (typeof parse === 'function') {
    try { const P = parse(x); if (P && P.kind === 'ignore') return null; if (P && P.actions && P.actions.length && P.actions.every(a => a.act !== 'note')) return null; } catch (_) {}
  }
  const one = seg => {
    const s2 = wbDropNeg(low(seg));                                                 // "no need cleaning", "do not clean" ask for nothing
    const cats = wbCategorize(seg), maint = cats.some(c => c.kind === 'maint');
    if (!cats.length && !REQ_W.test(s2)) return null;
    if (cats.length && !maint && !REQ_W.test(s2) && DONE_W.test(seg)) return null;   // "201 towels given ✅" is an answer
    if (!maint && PAY_W.test(seg) && !GIVE_W.test(seg)) return null;                // a payment note for the front office
    if (!cats.length && ASK_FO.test(seg)) return null;
    return { cats, maint };
  };
  const parts = wbParts(x).filter(p => p.rooms.length);
  if (parts.length > 1) {                                                          // each room with its own words
    const byRoom = {}, rs = [], all = [];
    parts.forEach(p => {
      if (STATUS_ONLY.test(noAt(p.text))) return;
      if (typeof parse === 'function') { try { const P = parse(p.text); if (P && P.actions && P.actions.length && P.actions.every(a => a.act !== 'note')) return; } catch (_) {} }   // "305 co", "306 luggage inside" in a list
      const q = one(p.text); if (!q) return; p.rooms.forEach(r => { if (!rs.includes(r)) rs.push(r); byRoom[rk(r)] = q.cats; }); q.cats.forEach(c => { if (!all.includes(c)) all.push(c); }); });
    return rs.length ? { rooms: rs, cats: all, maint: all.some(c => c.kind === 'maint'), byRoom } : null;
  }
  const q = one(x); if (!q) return null;
  return { rooms, cats: q.cats, maint: q.maint };
}

/** today's messages → open requests: a room with a request and no later message about it.
 *  recs: [{t, s, x, r?, key?}], nowMin: minutes since midnight. opt: {min:30, max:360, parse, handled:Set} */
function wbOpenRequests(recs, nowMin, opt) {
  opt = opt || {};
  const MIN = opt.min == null ? 30 : opt.min, MAX = opt.max == null ? 360 : opt.max;
  const L = (recs || []).filter(r => r && r.x && toMin(r.t) != null && !r.u).map((r, i) => Object.assign({ _m: toMin(r.t), _i: i }, r))
    .sort((a, b) => a._m - b._m || a._i - b._i);
  const open = new Map();
  L.forEach((r, i) => {
    const q = wbRequestOf(r, opt.parse); if (!q) return;
    q.rooms.forEach(room => {
      const k = rk(room);
      const answered = L.slice(i + 1).some(o => wbRooms(o.x).some(x => rk(x) === k) && (o.s !== r.s || DONE_W.test(o.x) || !wbRequestOf(o, opt.parse)));
      if (answered) { open.delete(k); return; }
      const age = nowMin - r._m;
      const id = 'rq:' + k + ':' + (r.key || hash(r.t + '|' + r.s + '|' + r.x));
      const cur = open.get(k);
      if (cur) { cur.texts.push(r.x); q.cats.forEach(c => { if (!cur.cats.some(x => x.id === c.id)) cur.cats.push(c); }); cur.maint = cur.maint || q.maint; cur.last = r; return; }
      open.set(k, { id, room, key: k, t: r.t, s: r.s, x: r.x, age, cats: q.cats.slice(), maint: q.maint, texts: [r.x], last: r });
    });
  });
  return [...open.values()].filter(o => o.age >= MIN && o.age <= MAX && !(opt.handled && opt.handled.has(o.id))).sort((a, b) => b.age - a.age);
}
/** "towels", "AC and towels", "a request" */
function wbWhat(cats) {
  const L = (cats || []).map(c => c.kind === 'maint' ? c.label.split(' / ')[0] : c.label.split(' / ')[0].toLowerCase());
  return L.length ? (L.length > 1 ? L.slice(0, -1).join(', ') + ' and ' + L[L.length - 1] : L[0]) : 'something';
}
/** rooms mentioned in min+ different messages today → [{room, n}] */
function wbRepeatsToday(recs, min) {
  const c = {}, shown = {};
  (recs || []).forEach(r => { if (!r || !r.x || r.u) return; wbRooms(r.x).forEach(x => { const k = rk(x); c[k] = (c[k] || 0) + 1; shown[k] = shown[k] || x; }); });
  return Object.keys(c).filter(k => c[k] >= (min || 3)).map(k => ({ room: shown[k], key: k, n: c[k] })).sort((a, b) => b.n - a.n);
}
/** the same maintenance word on the same room on several days → [{room, cat, days}] (byDay: {day: [rec]}) */
function wbRepeatIssues(byDay, today, opt) {
  opt = opt || {};
  const span = opt.days || 7, need = opt.min || 3, seen = {};
  for (let i = 0; i < span; i++) {
    const d = dayAdd(today, -i);
    (byDay[d] || []).forEach(r => {
      if (!r || !r.x) return;
      const cats = wbCategorize(r.x).filter(c => c.kind === 'maint' && c.id !== 'fix'); if (!cats.length) return;
      wbRooms(r.x).forEach(room => cats.forEach(c => { const k = rk(room) + '|' + c.id; const o = seen[k] = seen[k] || { room, key: rk(room), cat: c, days: new Set() }; o.days.add(d); }));
    });
  }
  return Object.values(seen).filter(o => o.days.size >= need).map(o => ({ room: o.room, key: o.key, cat: o.cat, days: o.days.size })).sort((a, b) => b.days - a.days);
}

// ══ The requests log (pure) ═════════════════════════════════
const CLOSE_W = /\b(?:done|cleaned|clean(?:ing)? done|sent|delivered|given|ok(?:ay)?|fixed|finished|completed?|sorted|handled|replaced|changed|ready)\b|✅|✔|✓|👍/i;
const NOT_DONE = /\b(?:not|still|yet to be|isn'?t|wasn'?t|never|no one|nobody)\s+(?:\w+\s+){0,2}?(?:done|cleaned|fixed|sent|delivered|given|finished|ready|changed|replaced)\b|\bnot (?:yet|ok)\b|\?/i;
/** a message that closes requests: the rooms it says are done ("206 cleaned", "206 ✓", "towels sent 201") */
function wbDoneOf(rec) {
  const out = [];
  sp(rec && rec.x).split(/[,;\n]+/).forEach(x => {
    if (!x.trim() || !CLOSE_W.test(x) || NOT_DONE.test(x) || REQ_W.test(x.replace(/\b(?:changed|change)\b/ig, ''))) return;
    wbRooms(x).forEach(r => { if (!out.includes(r)) out.push(r); });
  });
  return out;
}
// "Done ✅", "ok done", "delivered", "✅": a reply that says the quoted request is done
const DONE_REPLY = /^(?:(?:ok|okay|yes|already|all|it'?s|its|has\s+been|been|room)\s+)*(?:done|completed?|finished|sorted|handled|fixed|delivered|sent|given|cleaned|ready|khalas|tamam|dn)(?:\s+(?:already|now|sir|madam|ma'?am|dear|bro|thanks|thank\s+you|with\s+\w+(?:\s+\w+)?))*$/i;
function wbDoneReply(text) {
  const t = sp(text).replace(/@\S+(?:\s+[A-Z][\w.]*)*/g, ' ').replace(/[\p{Extended_Pictographic}\uFE0F]/gu, m => (/[✅✔☑👍]/u.test(m) ? ' done ' : ' ')).replace(/[.!,]+/g, ' ').replace(/\s+/g, ' ').trim();
  return !!t && DONE_REPLY.test(t.replace(/^(?:done\s+)+(?=done)/i, '').replace(/\bdone(?:\s+done)+\b/gi, 'done'));
}
const normQ = s => low(s).replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '').replace(/@\S+/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
/** every room request of a day, with its status.
 *  recs: [{t, s, x, g?, key?}] in any order · nowMin · shared: {id: {st:'done'|'open', by, at}} (taps saved for the team)
 *  manual: [{id, room, what, note, t, by, st}] added by hand → [{id, room, t, cats, what, x, s, g, st, doneT, doneBy, how, open (min), overdue}] newest first */
function wbRequestLog(recs, nowMin, shared, manual, opt) {
  opt = opt || {};
  const S = shared || {}, OVER = opt.over || 30, past = !!opt.past;
  const L = (recs || []).filter(r => r && r.x && toMin(r.t) != null && !r.u).map((r, i) => Object.assign({ _m: toMin(r.t), _i: i }, r)).sort((a, b) => a._m - b._m || a._i - b._i);
  const items = [], open = {};
  L.forEach(r => {
    const done = wbDoneOf(r).map(rk);
    done.forEach(k => (open[k] || []).forEach(it => { if (it.st === 'open') { it.st = 'done'; it.doneT = r.t; it.doneBy = r.s || ''; it.how = 'chat'; } }));
    if (r.q && wbDoneReply(r.x)) {                                                  // "Done ✅" in reply to the request itself
      const qn = normQ(r.q); if (qn) items.forEach(it => { const xn = normQ(it.x0 || ''); if (it.st === 'open' && xn && (xn === qn || xn.indexOf(qn) === 0 || qn.indexOf(xn) === 0)) { it.st = 'done'; it.doneT = r.t; it.doneBy = r.s || ''; it.how = 'chat'; } });
      return;
    }
    const q = wbRequestOf(r, opt.parse); if (!q) return;
    q.rooms.forEach(room => {
      const k = rk(room), qc = (q.byRoom && q.byRoom[k]) || q.cats, same = (open[k] || []).find(it => it.st === 'open' && !it.manual && (!qc.length || qc.some(c => it.cats.some(x => x.id === c.id))));
      if (same) { same.again = (same.again || 0) + 1; same.x = qMark(same.x + ' · ' + r.x, 300); qc.forEach(c => { if (!same.cats.some(x => x.id === c.id)) same.cats.push(c); }); return; }   // asked again: the same request
      const id = 'r' + hash((opt.day || '') + '|' + (r.key || r.t + '|' + r.s + '|' + r.x) + '|' + k);
      const it = { id, room, key: k, t: r.t, cats: qc.slice(), what: qc.length ? wbWhat(qc) : 'request', x: r.x, x0: r.x, s: r.s || '', g: r.g || '', st: 'open', doneT: '', doneBy: '', how: '' };
      items.push(it); (open[k] = open[k] || []).push(it);
    });
  });
  (manual || []).forEach(m => { if (!m || !m.room) return; const it = { id: m.id, room: String(m.room), key: rk(m.room), t: m.t || '', cats: (m.cat && CAT[m.cat]) ? [CAT[m.cat]] : [], what: m.what || 'request', x: m.note || '', s: m.by || '', g: '📞 added by hand', st: 'open', doneT: '', doneBy: '', how: '', manual: true }; items.push(it); });
  items.forEach(it => {
    const sh = S[it.id];
    if (sh && sh.st === 'done') { it.st = 'done'; it.doneBy = sh.by || it.doneBy; it.how = 'tap'; if (sh.at) { const d = new Date(sh.at); it.doneT = it.doneT || pad(d.getHours()) + ':' + pad(d.getMinutes()); } }
    else if (sh && sh.st === 'open') { it.st = 'open'; it.doneT = ''; it.doneBy = ''; it.how = ''; }
    const a = toMin(it.t), b = it.st === 'done' ? toMin(it.doneT) : (past ? null : nowMin);
    it.open = a != null && b != null ? Math.max(0, b - a) : null;
    it.overdue = it.st === 'open' && !past && it.open != null && it.open > OVER;
  });
  return items.sort((a, b) => (toMin(b.t) || 0) - (toMin(a.t) || 0));
}
/** how a request reads on the page. Calm (default): "📨 Sent to HK" / "✓ Done by HK 9:35" — housekeeping closes it, nobody ticks.
 *  track: the old way, "🟡 Open · ⏱ 40 min" / "✅ Done" with buttons. → {text, sub, tone ('' | 'done' | 'over')} */
function wbReqStatus(it, track) {
  if (!it) return { text: '', sub: '', tone: '' };
  if (!track) return it.st === 'done' ? { text: '✓ Done' + (it.how === 'tap' ? '' : ' by HK') + (it.doneT ? ' ' + t12(it.doneT) : ''), sub: it.doneBy || '', tone: 'done' } : { text: '📨 Sent to HK', sub: '', tone: '' };
  const fm = m => m == null ? '' : m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60 ? (m % 60) + ' min' : '');
  return it.st === 'done' ? { text: '✅ Done' + (it.doneT ? ' ' + t12(it.doneT) : ''), sub: [it.open != null ? '⏱ ' + fm(it.open) : '', it.doneBy].filter(Boolean).join(' · '), tone: 'done' }
    : { text: (it.overdue ? '🔴' : '🟡') + ' Open', sub: it.open != null ? '⏱ ' + fm(it.open) : '', tone: it.overdue ? 'over' : '' };
}
/** "206: cleaning 9:10 ✅ 9:35 · towels 1:02 PM 🟡" */
function wbRoomHistory(items, room) {
  const k = rk(room), L = (items || []).filter(i => i.key === k).sort((a, b) => (toMin(a.t) || 0) - (toMin(b.t) || 0));
  return L.length ? `${room}: ` + L.map(i => `${i.what} ${t12(i.t)} ${i.st === 'done' ? '✅' + (i.doneT ? ' ' + t12(i.doneT) : '') : '🟡'}`).join(' · ') : '';
}

// ══ Stats, room moves, tips ═════════════════════════════════
/** [{day, rec}] → what was asked for, when and by which rooms */
function wbStats(list, parse) {
  const S = { msgs: 0, reqs: 0, byHour: Array(24).fill(0), cats: {}, catHours: {}, catRooms: {}, catMsgs: {}, rooms: {}, roomLbl: {}, senders: {} };
  (list || []).forEach(o => {
    const r = o && o.rec; if (!r || !r.x) return;
    S.msgs++; if (r.s) S.senders[r.s] = (S.senders[r.s] || 0) + 1;
    const h = Math.floor((toMin(r.t) ?? -60) / 60);
    const q = wbRequestOf(r, parse); if (!q) return;
    S.reqs++; if (h >= 0) S.byHour[h]++;
    q.rooms.forEach(x => { const k = rk(x); S.rooms[k] = (S.rooms[k] || 0) + 1; S.roomLbl[k] = S.roomLbl[k] || x; });
    (q.cats.length ? q.cats : [{ id: 'other' }]).forEach(c => {
      S.cats[c.id] = (S.cats[c.id] || 0) + 1;
      const H = S.catHours[c.id] = S.catHours[c.id] || Array(24).fill(0); if (h >= 0) H[h]++;
      const R = S.catRooms[c.id] = S.catRooms[c.id] || {}; q.rooms.forEach(x => { R[rk(x)] = (R[rk(x)] || 0) + 1; });
      (S.catMsgs[c.id] = S.catMsgs[c.id] || []).push(o);
    });
  });
  return S;
}
const topOf = (obj, n) => Object.entries(obj || {}).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, n || 3);
const peakHour = H => { let b = -1, bi = -1; (H || []).forEach((v, i) => { if (v > b) { b = v; bi = i; } }); return b > 0 ? bi : -1; };
/** the busiest 2-hour window: its first hour (or -1) */
const peak2 = H => { let b = 0, bi = -1; for (let i = 0; i < 24; i++) { const v = (H[i] || 0) + (H[(i + 1) % 24] || 0); if (v > b || (v === b && v > 0 && (H[i] || 0) > (H[bi] || 0))) { b = v; bi = i; } } return bi; };

const MOVE_W = /\b(?:room\s*moves?|room\s*moved|moved?|moving|shift(?:ed|ing)?|change(?:d)?\s+(?:the\s+|his\s+|her\s+)?room|room\s+change[sd]?|relocat\w*|upgrad\w*|transfer(?:red)?)\b/i;
/** a room move in one message → {from, to} | null ("move 302 to 405", "302 → 405", "302 moved to 405", "RM 302 to 405") */
function wbMoveOf(text) {
  const x = sp(text);
  let m = x.match(/(?<![\d:.])(\d{3,4})\s*(?:→|->|=>|➡️?|➡)\s*(?:room\s*|rm\s*)?(\d{3,4})(?![\d:])/);
  if (m) return { from: m[1], to: m[2] };
  if ((m = x.match(/\bRM\b\.?\s*(\d{3,4})\s*(?:to|-|>)\s*(\d{3,4})\b/))) return { from: m[1], to: m[2] };
  if (!MOVE_W.test(x)) return null;
  if (/\b(?:shift|shifts)\b/i.test(x) && !/\bshift(?:ed|ing)?\s+(?:to|from|room|guest)\b/i.test(x) && !/\bto\s+(?:room\s*)?\d{3,4}/i.test(x)) return null;   // a work shift
  const rooms = wbRooms(x);
  const fm = x.match(/\bfrom\s+(?:room\s*|rm\s*|#)?(\d{3,4})\b/i), tm = x.match(/\b(?:to|into|in to)\s+(?:room\s*|rm\s*|#)?(\d{3,4})\b/i);
  let from = fm ? fm[1] : '', to = tm ? tm[1] : '';
  if (!from) from = rooms.find(r => r !== to) || '';
  if (!to) to = rooms.find(r => r !== from) || '';
  if (!from && !to) return null;
  if (from && to && rk(from) === rk(to)) return null;
  return { from, to };
}
const REASONS = [
  ['dirty', 'Room not clean', /\b(?:dirty|not clean|unclean|stain\w*|hair|dusty)\b/i],
  ['bed', 'Bed type', /\b(?:twin|king|queen|double bed|single beds?|separate beds?|bed type|two beds|connecting|interconnect\w*)\b/i],
  ['view', 'View / window', /\b(?:view|window|balcony|burj|sea)\b/i],
  ['guest', 'Guest request', /\b(?:guest (?:request\w*|want\w*|ask\w*|prefer\w*|didn'?t like|not happy|complain\w*)|requested|on request|as per guest|guest choice|not happy)\b/i],
  ['upgrade', 'Upgrade', /\bupgrad\w*/i],
];
/** why a room was moved: the move message first, then messages about the from-room in the 2 h before */
function wbMoveReason(text, prior) {
  const pick = (t, problemsOnly) => {
    const cats = wbCategorize(t).filter(c => c.kind === 'maint');
    const spec = cats.find(c => c.id !== 'fix'); if (spec) return { id: spec.id, label: spec.label };
    const dirty = REASONS[0][2].test(t) ? REASONS[0] : null; if (dirty) return { id: dirty[0], label: dirty[1] };
    if (cats[0]) return { id: cats[0].id, label: cats[0].label };
    if (problemsOnly) return null;
    const r = REASONS.slice(1).find(x => x[2].test(t)); return r ? { id: r[0], label: r[1] } : null;
  };
  const own = pick(sp(text).replace(/\b\d{3,4}\b/g, ' '), false);
  if (own && own.id !== 'upgrade') return Object.assign(own, { src: 'same' });
  for (const p of (prior || []).slice().reverse()) { const r = pick(p.x || '', true); if (r) return Object.assign(r, { src: 'before' }); }
  if (own) return Object.assign(own, { src: 'same' });
  return { id: 'unknown', label: 'Not said', src: '' };
}
/** [{day, rec}] → room moves [{day, t, s, from, to, reason, x}] */
function wbMoves(list) {
  const L = (list || []).filter(o => o && o.rec && o.rec.x).slice().sort((a, b) => a.day.localeCompare(b.day) || (toMin(a.rec.t) || 0) - (toMin(b.rec.t) || 0));
  const out = [];
  L.forEach((o, i) => {
    const mv = wbMoveOf(o.rec.x); if (!mv) return;
    const m0 = toMin(o.rec.t) || 0, from = mv.from && rk(mv.from);
    const prior = from ? L.slice(Math.max(0, i - 80), i).filter(p => p.day === o.day && m0 - (toMin(p.rec.t) || 0) <= 120 && wbRooms(p.rec.x).some(x => rk(x) === from)).map(p => p.rec) : [];
    out.push({ day: o.day, t: o.rec.t, s: o.rec.s, from: mv.from, to: mv.to, reason: wbMoveReason(o.rec.x, prior), x: o.rec.x });
  });
  return out;
}
/** moves → reasons ranked and the rooms that keep causing moves (2+) */
function wbMoveSummary(moves) {
  const reasons = {}, lbl = {}, rooms = {};
  (moves || []).forEach(m => {
    reasons[m.reason.id] = (reasons[m.reason.id] || 0) + 1; lbl[m.reason.id] = m.reason.label;
    if (!m.from) return;
    const k = rk(m.from), o = rooms[k] = rooms[k] || { room: m.from, key: k, n: 0, why: {}, whyLbl: {} };
    o.n++; o.why[m.reason.id] = (o.why[m.reason.id] || 0) + 1; o.whyLbl[m.reason.id] = m.reason.label;
  });
  const repeat = Object.values(rooms).filter(o => o.n >= 2).map(o => {
    const why = topOf(o.why, 5).map(([id, n]) => ({ id, label: o.whyLbl[id], n }));
    const top = why.find(w => w.id !== 'unknown') || why[0];
    const c = top && CAT[top.id];
    const tip = c && c.kind === 'maint' ? `Ask maintenance to check ${o.room}'s ${c.label.split(' / ')[0].replace(/^Other repair$/, 'repairs')}`
      : top && top.id === 'dirty' ? `Ask housekeeping to inspect ${o.room} before the next guest`
      : top && top.id === 'bed' ? `Check the bed set-up in ${o.room} matches what is sold`
      : `Find out why guests leave ${o.room}`;
    return { room: o.room, key: o.key, n: o.n, why, top, tip, maint: !!(c && c.kind === 'maint') };
  }).sort((a, b) => b.n - a.n);
  return { total: (moves || []).length, reasons: topOf(reasons, 20).map(([id, n]) => ({ id, label: lbl[id], n })), repeat };
}
/** rooms ranked by problems: maintenance mentions + moves out of them */
function wbProblemRooms(list, moves) {
  const R = {};
  const get = (room, day) => { const k = rk(room); const o = R[k] = R[k] || { room, key: k, issues: 0, moves: 0, probs: {}, last: '' }; if (day > o.last) o.last = day; return o; };
  (list || []).forEach(o => {
    const r = o && o.rec; if (!r || !r.x) return;
    const cats = wbCategorize(r.x).filter(c => c.kind === 'maint'); if (!cats.length) return;
    const rooms = wbRooms(r.x); if (wbMoveOf(r.x)) return;
    rooms.forEach(x => { const p = get(x, o.day); p.issues++; cats.forEach(c => { p.probs[c.label] = (p.probs[c.label] || 0) + 1; }); });
  });
  (moves || []).forEach(m => { if (!m.from) return; const p = get(m.from, m.day); p.moves++; if (m.reason.id !== 'unknown') p.probs[m.reason.label] = (p.probs[m.reason.label] || 0) + 1; });
  return Object.values(R).map(o => Object.assign(o, { total: o.issues + o.moves, top: topOf(o.probs, 3) })).sort((a, b) => b.total - a.total || b.last.localeCompare(a.last));
}
const TROLLEY = new Set(['towel', 'linen', 'amen', 'water', 'tp', 'pillow']);
/** helpful tips from the numbers (plain English) */
function wbTips(cur, prev, moveSum) {
  const T = [];
  try {
    const reqTotal = Object.values(cur.cats).reduce((a, b) => a + b, 0) || 0;
    const top = topOf(cur.cats, 3).filter(([id]) => CAT[id]);
    if (top[0] && reqTotal >= 3) {
      const [id, n] = top[0], pct = Math.round(n * 100 / reqTotal), h = peak2(cur.catHours[id] || []);
      const c = CAT[id], nm = c.label.split(' / ')[0];
      const what = c.kind === 'maint' ? `${nm} problems are` : `${nm} ${/s$/.test(nm) ? 'are' : 'is'}`;
      const todo = c.kind === 'maint' ? ' — ask maintenance to check them before the busy hours' : TROLLEY.has(id) && h >= 0 ? ` — stock the HK trolley before ${hourLbl(h)}` : h >= 0 ? ` — have it ready before ${hourLbl(h)}` : '';
      if (pct >= 20) T.push(`${what} ${pct}% of requests${h >= 0 ? `, most between ${hourSpan(h)}` : ''}${todo}.`);
    }
    if (prev) {
      const tr = [];
      Object.keys(cur.cats).forEach(id => {
        const c = CAT[id]; if (!c) return;
        const a = prev.cats[id] || 0, b = cur.cats[id], nm = c.label.split(' / ')[0];
        const what = c.kind === 'maint' ? `${nm} complaints` : `Requests for ${nm.toLowerCase()}`;
        const rank = (c.kind === 'maint' ? 1000 : 0) + Math.abs(b - a);
        if (b >= 3 && a >= 1 && b >= 2 * a) tr.push([rank, `${what} ${b >= 3 * a ? 'more than doubled' : 'doubled'} (${a} → ${b}) compared with the period before.`]);
        else if (b >= 3 && a === 0 && prev.msgs > 0) tr.push([rank, `${what}: ${b} this period, none the period before.`]);
        else if (a >= 4 && b <= a / 2) tr.push([rank - 500, `${what} went down (${a} → ${b}). Good work.`]);
      });
      tr.sort((x, y) => y[0] - x[0]).slice(0, 2).forEach(x => T.push(x[1]));
    }
    if (moveSum && moveSum.total >= 3) {
      const byRoom = {}; moveSum.repeat.forEach(r => { byRoom[r.room] = r.n; });
      const tops = moveSum.repeat.slice(0, 2), n = tops.reduce((s, r) => s + r.n, 0);
      if (tops.length && n * 2 >= moveSum.total) T.push(`Room${tops.length > 1 ? 's' : ''} ${tops.map(r => r.room).join(' and ')} caused ${n} of ${moveSum.total} moves.`);
      const r0 = moveSum.reasons.find(r => r.id !== 'unknown');
      if (r0 && r0.n * 3 >= moveSum.total) T.push(`The main reason for room moves: ${r0.label} (${r0.n} of ${moveSum.total}).`);
    }
    if (moveSum) moveSum.repeat.filter(r => r.maint).slice(0, 2).forEach(r => T.push(`${r.tip} (${plural(r.n, 'move')}).`));
    const ph = peakHour(cur.byHour);
    if (ph >= 0 && cur.reqs >= 5) T.push(`The HK chat is busiest around ${hourLbl(ph)} — keep someone free to answer then.`);
    const rooms = topOf(cur.rooms, 1);
    if (rooms[0] && rooms[0][1] >= 4) T.push(`Room ${cur.roomLbl[rooms[0][0]] || rooms[0][0]} asked the most (${rooms[0][1]} requests) — worth a call to the guest.`);
  } catch (_) {}
  return T.slice(0, 6);
}

// ══ Reminders learned from the chat ═════════════════════════
const REM_W = /\b(?:remind(?:er)?|call(?:\s*back)?|follow[\s-]?up|later|check again|ask again|don'?t forget|wake ?up|taxi|cab|pick ?up)\b/i;
/** "at 4", "4:30pm", "in 30 min", "tomorrow morning" → {min, day, label, at, rel, phrase} | null (msgMin: when it was written) */
function wbParseWhen(text, msgMin) {
  const t = low(text).replace(/\b([ap])\.\s*m\.?/g, '$1m');
  let m;
  const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, half: 0.5 };
  if ((m = t.match(/\bin\s+(\d{1,3}|half an?|an?|one|two|three)\s*(min(?:ute)?s?|m\b|hours?|hrs?|h\b)/))) {
    const k = m[1].split(' ')[0], n = NUM[k] != null ? NUM[k] : +m[1], hr = /^h/.test(m[2]);
    const add = Math.round(n * (hr ? 60 : 1)); if (!(add > 0 && add <= 24 * 60)) return null;
    return { min: msgMin + add, day: msgMin + add >= 1440 ? 1 : 0, label: 'in ' + (hr ? plural(n, 'hour') : add + ' min'), rel: true, phrase: m[0] };
  }
  if ((m = t.match(/\b(?:tomorrow|tmrw?|tmr)\s+morning\b/))) return { min: 8 * 60 + 30, day: 1, label: 'tomorrow morning', rel: true, phrase: m[0] };
  if ((m = t.match(/(?:\b(?:at|by|around|before|till|until)\s*|@\s*)(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?(?![\d:.])/)) || (m = t.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b/))) {
    let h = +m[1]; const mi = +(m[2] || 0), ap = m[3] || '';
    if (h > 23 || mi > 59 || (ap && h > 12)) return null;
    if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0;
    if (!ap && h >= 1 && h <= 9) h += 12;                      // like the bridge: 1-9 with no am/pm is the afternoon
    let min = h * 60 + mi;
    if (!ap && min < msgMin && h < 12) min += 720;
    return { min, day: min < msgMin ? 1 : 0, label: clock(min), at: true, phrase: m[0] };
  }
  return null;
}
/** one message → reminders [{id, at (min), day (0|1), kind, room?, text, why, cond?, tone}] */
function wbRemindersOf(rec, parse) {
  const out = [], x = sp(rec && rec.x), m0 = toMin(rec && rec.t);
  if (!x.trim() || m0 == null || rec.u || /^\s*🔁/u.test(x)) return out;
  const why = `${rec.s || 'Someone'} wrote at ${t12(rec.t)}: "${x.length > 90 ? x.slice(0, 90) + '…' : x}"`;
  let acts = [];
  try { const P = typeof parse === 'function' ? parse(x) : null; acts = P && P.actions || []; if (P && P.kind === 'ignore') return out; } catch (_) {}
  acts.filter(a => a.act === 'lco' && a.time).forEach(a => {
    const T = toMin(a.time); if (T == null) return;
    const k = rk(a.room), lbl = clock(T);
    if (T - 15 > m0) out.push({ id: 'lco1:' + k + ':' + a.time, kind: 'lco', room: a.room, at: T - 15, day: 0, text: `Room ${a.room} late check-out at ${lbl} — check if they're ready`, why, cond: 'notOut', tone: 'warn' });
    out.push({ id: 'lco2:' + k + ':' + a.time, kind: 'lco', room: a.room, at: T + 5, day: 0, text: `Room ${a.room} is past its ${lbl} late check-out`, why, cond: 'notOut', tone: 'bad' });
  });
  const cmd = acts.length && acts.every(a => a.act !== 'note');
  if (cmd) return out;
  const rooms = wbRooms(x), rw = REM_W.test(x), w = wbParseWhen(x, m0);
  if (!(rw || (w && rooms.length))) return out;
  if (!rw && w && w.at && /\b(?:lco|late)\b/i.test(x)) return out;
  let at = w ? (w.at ? w.min - 5 : w.min) : m0 + 30;
  if (w && w.at && at <= m0) at = w.min;
  let task = x.replace(/\n+/g, ' ');
  if (w) task = task.replace(new RegExp(w.phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ');
  rooms.forEach(r => { task = task.replace(new RegExp('(?:\\b(?:rooms?|rm|rn)\\.?\\s*|#\\s*)?\\b' + r + '\\b', 'i'), ' '); });
  task = task.replace(/\b(?:pls|please|plz|kindly)\b/ig, ' ').replace(/^\s*(?:remind(?:er)?(?:\s+(?:me|us|fo|team))?(?:\s+(?:to|about|that))?)\b/i, ' ').replace(/\s+/g, ' ').replace(/^[\s:,\-–—]+|[\s:,.!\-–—]+$/g, '').trim();
  if (task.length > 70) task = task.slice(0, 70) + '…';
  const text = (rooms.length ? `Room ${rooms.join(', ')}${task ? ' ' : ''}` : '') + (task || (rooms.length ? '' : 'Follow up')) + (w && w.at ? ` at ${w.label}` : w && w.label === 'tomorrow morning' ? ' (this morning)' : '');
  out.push({ id: 'rem:' + hash(rec.t + '|' + rec.s + '|' + x), kind: 'rem', room: rooms[0] || '', at: Math.min(at, 1439 + (w && w.day ? 1440 : 0)), day: w ? w.day : (at >= 1440 ? 1 : 0), text: text.trim(), why: rec.s ? `${rec.s} asked at ${t12(rec.t)}: "${x.length > 90 ? x.slice(0, 90) + '…' : x}"` : why, tone: 'warn' });
  out.forEach(r => { if (r.at >= 1440) { r.at -= 1440; r.day = 1; } });
  return out;
}
/** the end of the shift, by the default hours (07:00 / 15:00 / 23:00) → minutes since midnight (may be next day: +1440) */
function wbShiftEndDefault(nowMin) {
  if (nowMin >= 7 * 60 && nowMin < 15 * 60) return 15 * 60;
  if (nowMin >= 15 * 60 && nowMin < 23 * 60) return 23 * 60;
  return nowMin >= 23 * 60 ? 1440 + 7 * 60 : 7 * 60;
}

// ══ Words colleagues type: typo-tolerant commands (pure) ═════
// exact = the bridge already reads it · likely = act, but mark it "🤔 guessed" · unsure = ask what it means
const F_EXACT = {
  co: ['co', 'checkout', 'checkedout', 'chkout', 'chkdout', 'chkedout', 'checkdout'],
  ext: ['ext', 'extd', 'extn', 'extnd', 'exten', 'extend', 'extended', 'extending', 'extension', 'extention'],
  lco: ['lco', 'lc', 'latecheckout', 'latechkout', 'lateco', 'latecheckedout'],
};
const F_EX = {}; Object.keys(F_EXACT).forEach(m => F_EXACT[m].forEach(w => { F_EX[w] = m; }));
const F_COMMON = new Set(('ok oky okay k kk done dn clean cln cleaned dirty ready rdy cold code cool coke cot cots cost coat cut call calls check chq cheque ' +
  'exit extra exp expect express ex next text late later lady lock look luck lost list let lot also out left in on to the and pls plz pl thx ty thanks ' +
  'vc vd oc od ooo oos dnd mur so sos dl tv ac wc no yes hk fo pax bf br sr mr mrs ms dr asap nw tmrw tmr tmw tom tomorow room rooms rm guest gst go come ' +
  'clear close cloth clothes cola color colour cover cozy cook cork corn couch count cart card care case cash cake cap lcd led').split(' '));
/** "C.O.", "Chkd", "co-worker" → "co", "chkd", "coworker" (lowercase, no dots/slashes/dashes, repeated letters once) */
function wbNormWord(w) { return low(w).replace(/[.\/\\\-_'’`]/g, '').replace(/[^a-z]/g, '').replace(/(.)\1+/g, '$1'); }
/** consonant skeleton: first letter + the consonants after it ("checkout" → "chckt") */
function wbSkel(n) { return ((n[0] || '') + n.slice(1).replace(/[aeiou]/g, '')).replace(/(.)\1+/g, '$1'); }
function wbLev(a, b) {
  if (a === b) return 0; const m = a.length, n = b.length; if (!m || !n) return m + n;
  let p = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) { const c = [i]; for (let j = 1; j <= n; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = c; }
  return p[n];
}
const coSkel = n => (/^ch?c?kd?t?$/.test(wbSkel(n)) && /[dt]/.test(wbSkel(n))) || n === 'cout' || n === 'ckout' || n === 'chkot';
/** one typed word (and the next one) → {m:'co'|'ext'|'lco'|null, conf:'exact'|'likely'|'unsure', word, two} | null */
function wbFuzzyWord(raw, raw2) {
  const n = wbNormWord(raw); if (!n || n.length > 14) return null;
  const n2 = raw2 ? wbNormWord(raw2) : '';
  if (n2) {
    const j = n + n2;
    if (F_EX[j] === 'lco') return { m: 'lco', conf: 'exact', word: j, two: true };
    if (/^l(?:a|at|ate|t)?$/.test(n) && (F_EX[n2] === 'co' || coSkel(n2))) return { m: 'lco', conf: 'likely', word: j, two: true };
    if (n2 === 'out' && !F_COMMON.has(n) && n !== 'co' && coSkel(n + 't')) return { m: 'co', conf: 'likely', word: n, two: true };
  }
  if (F_COMMON.has(n)) return null;
  if (F_EX[n]) return { m: F_EX[n], conf: 'exact', word: n };
  const s = wbSkel(n), conf = n.length >= 4 ? 'likely' : 'unsure';
  if (coSkel(n)) return { m: 'co', conf, word: n };
  if (n.length >= 3 && /^l(?:a|at|ate|t)?e?c(?:h?e?c?k)?(?:o|ou|out|t|d)?$/.test(n)) return { m: 'lco', conf, word: n };
  if (/^e?x/.test(n)) { const core = s.replace(/^e/, ''); if (/^xt?n?d?(?:s?n)?d?$/.test(core) && /[tnd]/.test(core)) return { m: 'ext', conf, word: n }; }
  if (n.length >= 4) {
    const C = { co: ['checkout', 'checked', 'chkout'], ext: ['extend', 'extension', 'extended'], lco: ['latecheckout', 'lateco'] };
    for (const m of Object.keys(C)) if (C[m].some(c => c[0] === n[0] && wbLev(n, c) <= 2)) return { m, conf: 'unsure', word: n };
  }
  if (n.length >= 2 && n.length <= 4 && !/[aeiouy]/.test(n)) return { m: null, conf: 'unsure', word: n };
  return null;
}
const F_FILLER = /^(?:done|now|already|just|pls|please|plz|ok|okay|thanks?|thx|sir|maam|guys|team|hk|fo|[✅👍✔☑🙏.!,;:\s\u{1F3FB}-\u{1F3FF}])*$/iu;
/** what comes after a room → {m, conf ('learned'|'likely'|'unsure'|'exact'), word, tail} | null
 *  dict: the team's learned words {word: {m, n, c}} (n = times answered that way, c = confirmed) */
function wbReadCmd(rest, dict) {
  const r = sp(rest).trim().replace(/^[\s:\-–—=>.,]+/, '');
  if (!r) return null;
  if (/^ext\.\s*\d{3,5}\b/i.test(r) || /\b(?:call|phone|dial|tel|telephone|line)\b/i.test(r) && /\bext\.?\s*\d/i.test(r)) return null;   // a phone extension
  const tok = r.split(/\s+/), w1 = tok[0], w2 = tok[1] || '';
  if (!/^[a-z][a-z.\/\\\-'’]*$/i.test(w1)) return null;
  const D = dict || {}, n1 = wbNormWord(w1), two = w2 && /^[a-z.\/\-]+$/i.test(w2);
  const learned = (keys, isTwo) => { for (const w of keys) { const e = D[w]; if (e && e.m) return { m: e.m, conf: e.c || e.builtin || (e.n || 0) >= 2 ? 'learned' : 'likely', word: w, note: e.note || '', builtin: !!e.builtin, tail: tok.slice(isTwo ? 2 : 1).join(' '), from: 'dict' }; } return null; };
  const L = (two && learned([wbWordKey(w1 + w2), n1 + wbNormWord(w2)], true)) || learned([wbWordKey(w1), n1], false); if (L) return L;
  const f = wbFuzzyWord(w1, two ? w2 : '');
  if (!f) return null;
  const tail = tok.slice(f.two ? 2 : 1).join(' ');
  const res = Object.assign({}, f, { tail });
  if (f.conf === 'exact') return res;
  if (!F_FILLER.test(tail)) {
    if (f.m === 'ext' && /^(?:\+?\s*\d{1,2}\s*(?:n|nts?|nights?)\b|till|until|to\b)/i.test(tail)) return res;
    if (f.m === 'lco' && /\d/.test(tail)) return res;
    return null;                                                                      // a longer sentence: leave it a note
  }
  return res;
}
/** a message → words worth a question: [{room, word, m, conf, tail}] (only rooms at the start of a line or after a comma) */
function wbAskCandidates(text, dict) {
  const out = [];
  sp(text).split(/\r?\n/).forEach(line => line.split(/[,;]\s*/).forEach(seg => {
    const m = seg.trim().match(/^(?:(?:rooms?|rms?|rn)\.?\s*(?:no\.?\s*)?|#\s*)?(\d{3,4})\b(?![:.]\d)\s*[:\-–—]?\s*(.*)$/i); if (!m) return;
    const c = wbReadCmd(m[2], dict); if (!c || c.conf === 'exact' || /^(?:ignore|note|hk)$/.test(c.m || '')) return;
    if (!out.some(o => o.room === m[1] && o.word === c.word)) out.push({ room: m[1], word: c.word, m: c.m, conf: c.conf, tail: c.tail });
  }));
  return out;
}

// ══ The WhatsApp words dictionary (pure) ════════════════════
// meanings: co = checked out · ext = extension · lco = late check-out · note = a note / request
//           hk = a housekeeping room status (kept as a note, never changes the room) · ignore = not a command
const MEANINGS = { co: '✓ Checked out', ext: '↪ Extension', lco: '⏰ Late check-out', note: '📝 Note / request', hk: '🧹 Housekeeping status', ignore: 'Ignore' };
/** the dictionary key for a word: "V.D" → "vd", "C/O" → "co", "OOO" stays "ooo" (no letters merged) */
function wbWordKey(w) { return low(w).replace(/[.\/\\\-_'’`\s]/g, '').replace(/[^a-z0-9\u0600-\u06ff]/g, '').slice(0, 30); }
// housekeeping room-status codes and the usual commands, ready from day one (the team can change them)
const BUILTIN_WORDS = {
  vd: ['co', 'Vacant Dirty — the guest has left'], vc: ['co', 'Vacant Clean — room ready'], vr: ['co', 'Vacant Ready'], vci: ['co', 'Vacant Clean Inspected'],
  ed: ['co', 'Early Departure'], co: ['co', 'Check-out'], checkout: ['co', 'Check-out'],
  od: ['hk', 'Occupied Dirty — guest still in house'], oc: ['hk', 'Occupied Clean — guest still in house'], dnd: ['hk', 'Do Not Disturb'],
  so: ['hk', 'Sleep Out — bed not used'], dl: ['hk', 'Double Locked'],
  ooo: ['note', 'Out of Order (maintenance)'], oos: ['note', 'Out of Service'], ns: ['note', 'No Show'],
  lco: ['lco', 'Late check-out'], lc: ['lco', 'Late check-out'], ext: ['ext', 'Extension'],
  // how HK groups write it (kept as notes): "516 IP", "225 N/L", "526 OCC", "513 sleep out", "614 double lock", "209 NA", "406 ongoing"
  ip: ['hk', 'Inspected — room ready'], io: ['hk', 'Inspected — room ready'], nl: ['hk', 'No Luggage'], occ: ['hk', 'Occupied'], sleepout: ['hk', 'Sleep Out'], doublelock: ['hk', 'Double Lock'],
  na: ['hk', 'No Answer'], ongoing: ['hk', 'Cleaning in progress'],
};
/** the dictionary: built-in codes + what the team added (user words win). store = {load(), save(v)}, put(key, entry|null) → the hotel database */
function wbMakeWords(store, put, me) {
  let U = (() => { try { const v = store && store.load(); return v && typeof v === 'object' ? v : {}; } catch (_) { return {}; } })();
  const fns = [], who = () => (typeof me === 'function' ? me() : 'Someone');
  const fire = () => fns.forEach(f => { try { f(); } catch (_) {} });
  const keep = () => { try { store && store.save(U); } catch (_) {} };
  const entry = k => {
    const u = U[k], b = BUILTIN_WORDS[k];
    if (u && u.off) return null;
    if (u && u.m && MEANINGS[u.m]) { const note = u.note || u.label || (b && b[0] === u.m ? b[1] : ''); return { key: k, word: u.w || k, m: u.m, label: note, note, meaning: MEANINGS[u.m], by: u.by || '', at: u.at || 0, builtin: !!b, changed: !!b, c: 1 }; }
    if (b) return { key: k, word: k.toUpperCase(), m: b[0], label: b[1], note: b[1], meaning: MEANINGS[b[0]], by: '', at: 0, builtin: true, changed: false, c: 1 };
    return null;
  };
  const API = {
    MEANINGS,
    lookup(word) { const k = wbWordKey(word); return k ? entry(k) : null; },
    /** every word in use, built-in ones too: [{key, word, m, label (what it stands for), meaning, note, by, at, builtin}] */
    all() { return API.allWithOff().filter(e => !e.off); },
    /** the same, with turned-off built-in words (off: true) for the dictionary page */
    allWithOff() {
      const ks = new Set(Object.keys(BUILTIN_WORDS).concat(Object.keys(U)));
      return [...ks].map(k => entry(k) || (BUILTIN_WORDS[k] && U[k] && U[k].off ? { key: k, word: k.toUpperCase(), m: BUILTIN_WORDS[k][0], label: BUILTIN_WORDS[k][1], meaning: MEANINGS[BUILTIN_WORDS[k][0]], note: BUILTIN_WORDS[k][1], builtin: true, off: true, by: U[k].by || '', at: U[k].at || 0 } : null))
        .filter(Boolean).sort((a, b) => a.key.localeCompare(b.key));
    },
    /** {key: {m, c, builtin, note}} for the reader (turned-off words left out) */
    dict() { const o = {}; API.all().forEach(e => { if (!e.off) o[e.key] = { m: e.m, c: 1, builtin: e.builtin, note: e.note }; }); return o; },
    add(word, meaning, note, by) {
      const k = wbWordKey(word); if (!k || !MEANINGS[meaning]) return null;
      U[k] = { w: sp(word).trim().slice(0, 30), m: meaning, by: by || who(), at: Date.now() };
      if (note && String(note).trim()) U[k].note = String(note).trim().slice(0, 80);
      keep(); try { put(k, U[k]); } catch (_) {} fire(); return entry(k);
    },
    /** a team word is deleted; a built-in one is turned off (restore() brings it back) */
    remove(word, by) {
      const k = wbWordKey(word); if (!k) return;
      if (BUILTIN_WORDS[k]) { U[k] = { off: 1, by: by || who(), at: Date.now() }; try { put(k, U[k]); } catch (_) {} }
      else { delete U[k]; try { put(k, null); } catch (_) {} }
      keep(); fire();
    },
    restore(word) { const k = wbWordKey(word); if (!k || !U[k]) return; delete U[k]; try { put(k, null); } catch (_) {} keep(); fire(); },
    /** what the hotel database holds (fbListen) */
    setRemote(v) { U = {}; Object.keys(v && typeof v === 'object' ? v : {}).forEach(k => { const e = v[k]; if (e && typeof e === 'object' && (e.off || MEANINGS[e.m])) U[k] = e; }); keep(); fire(); },
    onChange(f) { if (typeof f === 'function') fns.push(f); },
    read(text) { return wbReadStatus(text, w => API.lookup(w)); },
  };
  return API;
}
/** housekeeping status lists: "VD: 315, 402, 518", "315 VD\n402 VD", "315, 402 VD" → [{room, word, m, note}] (lookup(word) → entry|null) */
function wbReadStatus(text, lookup) {
  const out = [], add = (room, word, e) => { if (e && !out.some(o => rk(o.room) === rk(room) && o.word === word)) out.push({ room, word, m: e.m, note: e.note || '', label: MEANINGS[e.m] }); };
  const ROOMS = /^(?:(?:rooms?|rms?|rn)\.?\s*)?(\d{3,4})(?:\s*(?:,|&|\/|and|\+)?\s*(?:(?:rooms?|rms?)\.?\s*)?(\d{3,4})\b)*/i;
  const roomsAt = s => (s.match(/\d{3,4}/g) || []);
  sp(text).split(/\r?\n/).forEach(line => {
    const l = line.trim(); if (!l) return;
    let m = l.match(/^([a-z][a-z\/.]{0,7})\s*[:\-–—]?\s*((?:(?:rooms?|rms?)\.?\s*)?\d{3,4}(?:\s*(?:,|&|\/|and|\+|\s)\s*\d{3,4}\b)*)\s*[.!]*$/i);
    if (m) { const e = lookup(m[1]); if (e) { roomsAt(m[2]).forEach(r => add(r, wbWordKey(m[1]), e)); return; } }
    l.split(/;\s*|(?<=[a-z.!✅])\s*,\s*(?=(?:rooms?\s*)?\d{3,4}\s+[a-z])/i).forEach(seg => {
      const mm = seg.trim().match(ROOMS); if (!mm) return;
      const rs = roomsAt(mm[0]), rest = seg.trim().slice(mm[0].length).trim().replace(/^[:\-–—=]+\s*/, '');
      const w = (rest.match(/^([a-z][a-z\/.]{0,7})(?![a-z])/i) || [])[1]; if (!w) return;
      const after = rest.slice(w.length).trim();
      if (after && !/^[.!✅👍,\s]*$/u.test(after) && !/^(?:pls|please|now|done|ok)\b/i.test(after)) return;   // "315 OD guest wants towels" is a request, not a status line
      const e = lookup(w); if (e) rs.forEach(r => add(r, wbWordKey(w), e));
    });
  });
  return out;
}
/** the question queue: an answer teaches the dictionary (words = wbMakeWords). store = {load(), save(o)} */
function wbMakeAsk(store, words, me) {
  let S = (() => { try { const v = store.load(); return v && Array.isArray(v.items) ? v : { items: [] }; } catch (_) { return { items: [] }; } })();
  const fns = [], who = () => (typeof me === 'function' ? me() : 'Someone');
  const save = () => { try { if (S.items.length > 60) S.items = S.items.slice(-60); store.save(S); } catch (_) {} };
  const API = {
    dict() { return words.dict(); },
    understand(rest) { return wbReadCmd(rest, words.dict()); },
    /** {word, room, m?, conf?, sender, time, text, day, key} → the question (one per word + message), or null when the word is known */
    add(q) {
      const word = wbWordKey(q.word); if (!word) return null;
      if (words.lookup(word) || words.lookup(wbNormWord(q.word))) return null;          // the team already said
      const id = 'q' + hash(word + '|' + (q.room || '') + '|' + (q.key || q.text || ''));
      let it = S.items.find(x => x.id === id); if (it) return it;
      it = { id, word, raw: q.raw || q.word, room: q.room || '', guess: q.m || null, conf: q.conf || 'unsure', sender: q.sender || '', time: q.time || '', text: String(q.text || '').slice(0, 300), day: q.day || '', key: q.key || '', at: Date.now(), st: 'open' };
      S.items.push(it); save(); return it;
    },
    list() { return S.items.filter(x => x.st === 'open' && !words.lookup(x.word)); },
    all() { return S.items.slice(); },
    /** the meaning of a word (co | ext | lco | note | hk | ignore) → the questions it answers */
    answer(word, meaning, by, note) {
      const w = wbWordKey(word); if (!w || !MEANINGS[meaning]) return [];
      words.add(word, meaning, note || '', by || who());
      const hit = S.items.filter(x => x.st === 'open' && (x.word === w || wbWordKey(x.raw) === w));
      hit.forEach(x => { x.st = 'done'; x.ans = meaning; x.by = by || who(); });
      save();
      fns.forEach(f => { try { f({ word: w, meaning, items: hit }); } catch (_) {} });
      return hit;
    },
    dismiss(id) { const it = S.items.find(x => x.id === id); if (it) { it.st = 'dismissed'; save(); } },
    onAnswer(f) { if (typeof f === 'function') fns.push(f); },
  };
  return API;
}

// ══ Brain search over the chat (pure) ═══════════════════════
const Q_STOP = new Set(('what happened happen with who whom room rooms rm the a an to for of in on any all show me about did does do is are was were today yesterday chat whatsapp hk group ' +
  'messages message said say tell find search there have has how many list please pls give get from by at and or this that latest last recent which when where why ' +
  'late checkouts checkout checked out check extended extensions extension ext lco co notes note wrote write written').split(' '));
/** a question → what to look for in the chat: {room, act, words, day ('today'|'yesterday'|''), q (for the WhatsApp search box)} | null */
function wbChatQuery(q) {
  const t = low(q).replace(/check[\s-]?outs?/g, 'checkout').trim();
  if (!t || /^(?:fix|bug|remember|teach|remind|wake)\b/.test(t)) return null;
  const rm = t.match(/(?<![\d:.])\b(\d{3,4})\b(?![:.]\d)/), room = rm ? rm[1] : '';
  let act = '';
  if (/\b(?:late checkout|lco|late co)\b/.test(t)) act = 'lco';
  else if (/\b(?:extend\w*|extension\w*|ext)\b/.test(t)) act = 'ext';
  else if (/\b(?:checkout|checked out|co)\b/.test(t)) act = 'co';
  else if (/\bnotes?\b/.test(t)) act = 'note';
  const day = /\btoday\b/.test(t) ? 'today' : /\byesterday\b/.test(t) ? 'yesterday' : '';
  const words = t.replace(/\d{3,4}/g, ' ').split(/[^a-z\u0600-\u06ff]+/).filter(w => w.length >= 3 && !Q_STOP.has(w)).map(w => w.length > 4 ? w.replace(/(?:ies)$/, 'y').replace(/(?<!s)s$/, '') : w).slice(0, 4);
  if (!room && !act && !words.length) return null;
  if (!room && !act && (words.length > 3 || t.split(/\s+/).filter(w => w.length >= 2).length > 4)) return null;   // a long question about something else
  return { room, act, words, day, q: [room].concat(words).concat(act && !room && !words.length ? [act] : []).filter(Boolean).join(' ') };
}
/** does a backup record match the query? parse: hoWaParse, for messages HotelOps did not act on */
function wbChatMatch(rec, Q, parse) {
  if (!rec || !rec.x) return false;
  const x = low(rec.x);
  if (Q.room && !wbRooms(rec.x).some(r => rk(r) === rk(Q.room))) return false;
  if (Q.words.length && !Q.words.every(w => x.includes(w) || low(rec.s) === w)) return false;
  if (Q.act) {
    const parts = String(rec.r || '').split(' · ').map(p => p.split(' '));
    let ok = parts.some(p => p[0] === Q.act && (!Q.room || rk(p[1]) === rk(Q.room)));
    if (!ok && !rec.r && typeof parse === 'function') { try { ok = (parse(rec.x).actions || []).some(a => a.act === Q.act && (!Q.room || rk(a.room) === rk(Q.room))); } catch (_) {} }
    if (!ok) return false;
  }
  return true;
}

W.hoWaBrainPure = { wbRooms, wbCategorize, CATS: CAT, CAT_RE, wbRequestOf, wbOpenRequests, wbWhat, wbRepeatsToday, wbRepeatIssues, wbStats, wbMoveOf, wbMoveReason, wbMoves,
  wbMoveSummary, wbProblemRooms, wbTips, wbParseWhen, wbRemindersOf, wbShiftEndDefault, wbNormWord, wbSkel, wbLev, wbFuzzyWord, wbReadCmd, wbAskCandidates, wbMakeAsk, wbWordKey, wbMakeWords, wbReadStatus, BUILTIN_WORDS, MEANINGS,
  wbChatQuery, wbChatMatch, wbDoneOf, wbRequestLog, wbReqStatus, wbDoneReply, wbDropNeg, wbParts, wbRoomHistory, topOf, peak2, clock, t12, toMin };
if (!doc) return;

// ═════════════════════════ In the app ═════════════════════════
const safe = (f, d) => { try { return f(); } catch (e) { try { console.warn('[wa-brain]', e); } catch (_) {} return d; } };
const LS = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} } };
const today = () => (typeof hoLocalISO === 'function' ? hoLocalISO() : isoDay(new Date()));
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const me = () => (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || 'Someone';
const parse = t => (typeof W.hoWaParse === 'function' ? W.hoWaParse(t) : { kind: 'none', actions: [] });
const rooms = () => (typeof depRooms !== 'undefined' && Array.isArray(depRooms) ? depRooms : []);
const depRoom = room => rooms().find(r => rk(r.roomStr) === rk(room));
const hi = (t, q) => (W.hoWaPure && W.hoWaPure.hoWaHi ? W.hoWaPure.hoWaHi(t, q) : esc(t));
const chipsOf = r => (W.hoWaPure && W.hoWaPure.archChips ? W.hoWaPure.archChips(r) : []);
const fmtDay = d => d === today() ? 'Today' : d === dayAdd(today(), -1) ? 'Yesterday' : new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const dmy = d => String(d).split('-').reverse().join('/');

// ── the chat: today's log + the backup (lazy, cached) ──
const DAYS = {}, AT = {};
let ver = 0, loading = null, lastLogSig = '';
function logEntries() {
  const L = safe(() => (W.hoWaBridge && typeof W.hoWaBridge.log === 'function' ? W.hoWaBridge.log() : null), null);
  if (Array.isArray(L)) return L.filter(e => e && !e.ho);   // handover-group messages live in the Handover Book
  const v = LS.get('ho_wa_log_v1', null);
  return v && v.date === today() && Array.isArray(v.items) ? v.items.filter(e => e && !e.ho) : [];
}
const normX = s => sp(s).replace(/\s+/g, ' ').trim().slice(0, 200).toLowerCase();
/** today's messages: the local log (newest first) and today's backup, one record each */
function todayRecs() {
  const seen = new Map(), out = [];
  const push = (r, key) => { const k = r.t + '|' + low(r.s) + '|' + normX(r.x); const was = seen.get(k); if (was) { if (r.q && !was.q) was.q = r.q; return; } const o = Object.assign({ key }, r); seen.set(k, o); out.push(o); };   // the backup keeps the quoted message (q)
  logEntries().slice().reverse().forEach(e => push({ t: e.time, s: e.sender, x: e.text, g: e.group || '', r: (e.res || []).map(r => [r.st, r.room || ''].filter(Boolean).join(' ')).join(' · '), u: e.undone ? 1 : 0, via: e.via, at: e.at }, e.key));
  const D = DAYS[today()] || {};
  Object.keys(D).forEach(k => { const r = D[k]; if (r && typeof r === 'object' && r.x) push(r, k); });
  return out.sort((a, b) => (toMin(a.t) || 0) - (toMin(b.t) || 0));
}
/** {day: [rec]} for the days loaded, today merged with the log */
function byDay() { const o = {}; Object.keys(DAYS).forEach(d => { o[d] = Object.keys(DAYS[d] || {}).map(k => Object.assign({ key: k }, DAYS[d][k])).filter(r => r && r.x); }); o[today()] = todayRecs(); return o; }
function listOf(days) { const B = byDay(), out = []; days.forEach(d => (B[d] || []).forEach(rec => out.push({ day: d, key: rec.key, rec }))); return out; }
async function loadDays(days, maxAge) {
  const now = Date.now(), need = days.filter(d => !DAYS[d] || now - (AT[d] || 0) > (d === today() ? 120e3 : (maxAge || 30 * 60e3)));
  if (!need.length || typeof fbGet !== 'function') return false;
  await Promise.all(need.map(async d => { let v = null; try { v = await fbGet('waChat/' + d); } catch (_) {} DAYS[d] = v && typeof v === 'object' ? v : {}; AT[d] = Date.now(); }));
  ver++; return true;
}
const lastDays = n => { const t = today(), o = []; for (let i = 0; i < n; i++) o.push(dayAdd(t, -i)); return o; };
function ensure30() { if (!loading) loading = loadDays(lastDays(30)).catch(() => false).then(r => { loading = null; return r; }); return loading; }

// ── shared state: handled requests, reminders done / snoozed (waChatRem/{date}/{id}) ──
let REM = { day: '', st: {} }, remListenDay = '';
function remState() {
  const d = today();
  if (REM.day !== d) { const v = LS.get('wab_rem_v1', null); REM = v && v.day === d ? v : { day: d, st: {}, nudge: {} }; REM.nudge = REM.nudge || {}; }
  if (remListenDay !== d && typeof fbListen === 'function') {
    remListenDay = d;
    safe(() => fbListen('waChatRem/' + d, v => { if (today() !== d) return; const st = v && typeof v === 'object' ? v : {}; Object.keys(st).forEach(k => { REM.st[k] = Object.assign({}, REM.st[k], st[k]); }); LS.set('wab_rem_v1', REM); softRefresh(); }));
  }
  return REM;
}
function remSet(id, patch) {
  const S = remState(); S.st[id] = Object.assign({}, S.st[id], patch); LS.set('wab_rem_v1', S);
  const p = {}; Object.keys(patch).forEach(k => { p[id.replace(/[.#$\[\]\/]/g, '_') + '/' + k] = patch[k]; });
  if (typeof fbUpdate === 'function') safe(() => Promise.resolve(fbUpdate('waChatRem/' + S.day, p)).catch(() => {}));
  softRefresh();
}
const remKey = id => id.replace(/[.#$\[\]\/]/g, '_');
const isDone = id => { const s = remState().st[remKey(id)]; return !!(s && s.d); };
const snoozed = id => { const s = remState().st[remKey(id)]; return !!(s && s.z && s.z > Date.now()); };
function markDone(id, what) { remSet(remKey(id), { d: 1, by: me(), at: Date.now() }); if (what) safe(() => showToast(what, 'ok')); }
function snooze(id, mins) { remSet(remKey(id), { z: Date.now() + mins * 60e3, by: me() }); safe(() => showToast(`OK — I'll remind you again in ${mins >= 60 ? plural(mins / 60, 'hour') : mins + ' min'}`, 'ok')); }

// ── what the chat says right now (recomputed on new messages and every minute) ──
let CUR = { sig: '', open: [], rems: [], counts: {}, repeats: [], issues: [], maint: [], ext: [], owe: [], quiet: null };
function shiftEnd() {
  const now = new Date(), nm = nowMin();
  return safe(() => {
    if (typeof hoMyDuty === 'function' && typeof rbParse === 'function' && typeof roDate === 'function') {
      const d = hoMyDuty(now); const p = d.state === 'on' && d.code ? rbParse(d.code) : null;
      if (p) { const end = roDate(d.date).getTime() + p.e * 60e3; return Math.round((end - new Date(now).setHours(0, 0, 0, 0)) / 60e3); }
    }
    if (typeof hoShiftNow === 'function') {
      const k = hoShiftNow(now).key;
      for (let i = 15; i <= 16 * 60; i += 15) { const t = new Date(now.getTime() + i * 60e3); if (hoShiftNow(t).key !== k) { t.setMinutes(Math.floor(t.getMinutes() / 15) * 15, 0, 0); return nm + Math.round((t - now) / 60e3); } }
    }
    return wbShiftEndDefault(nm);
  }, wbShiftEndDefault(nm));
}
function compute(force) {
  return safe(() => {
    const recs = todayRecs(), d = today(), nm = nowMin();
    const sig = d + '|' + recs.length + '|' + (recs[recs.length - 1] || {}).t + '|' + ver + '|' + Math.floor(Date.now() / 60e3) + '|' + Object.keys(remState().st).length + '|' + rooms().length;
    if (!force && sig === CUR.sig) return CUR;
    const handled = new Set(Object.keys(remState().st).filter(k => remState().st[k].d));
    const open = wbOpenRequests(recs, nm, { parse, handled: { has: id => handled.has(remKey(id)) } });
    const rems = []; recs.forEach(r => wbRemindersOf(r, parse).forEach(x => { if (!x.day && !rems.some(y => y.id === x.id)) rems.push(x); }));
    // yesterday's "tomorrow morning" reminders land today
    (byDay()[dayAdd(d, -1)] || []).forEach(r => wbRemindersOf(r, parse).forEach(x => { if (x.day === 1 && !rems.some(y => y.id === x.id)) rems.push(Object.assign({}, x, { day: 0 })); }));
    // counts per room for the chips
    const counts = {}; recs.forEach(r => { if (!r.u) wbRooms(r.x).forEach(x => { counts[rk(x)] = (counts[rk(x)] || 0) + 1; }); });
    // maintenance words on a room today
    const maint = []; recs.forEach(r => { const cats = wbCategorize(r.x).filter(c => c.kind === 'maint'); if (!cats.length || wbMoveOf(r.x)) return; wbRooms(r.x).forEach(x => { if (!maint.some(m => m.key === rk(x))) maint.push({ room: x, key: rk(x), cats, t: r.t, s: r.s, x: r.x, id: 'mt:' + rk(x) + ':' + cats[0].id }); }); });
    // extensions in the chat
    const ext = [];
    logEntries().forEach(e => { if (e.undone) return; safe(() => (parse(e.text).actions || []).filter(a => a.act === 'ext').forEach(a => {
      const r = depRoom(a.room), res = (e.res || []).find(x => rk(x.room) === rk(a.room)) || {};
      if (ext.some(z => z.key === rk(a.room))) return;
      if (r && r.status === 'extended' && !r.extConfirmed) ext.push({ room: r.roomStr, key: rk(a.room), kind: 'opera', t: e.time, s: e.sender });
      else if (r && r.status !== 'extended' && r.status !== 'out') ext.push({ room: r.roomStr, key: rk(a.room), kind: 'notmarked', t: e.time, s: e.sender, why: res.text || '' });
    })); });
    // a WhatsApp check-out that still owes
    const owe = []; logEntries().forEach(e => { if (e.undone) return; (e.res || []).filter(x => x.st === 'co').forEach(x => { const r = depRoom(x.room); if (r && r.status === 'out' && +r.balance > 0 && !owe.some(o => o.key === rk(x.room))) owe.push({ room: r.roomStr, key: rk(x.room), bal: r.balance, t: e.time, s: e.sender }); }); });
    // the reader went quiet
    let quiet = null;
    const linked = logEntries().filter(e => e.via === 'link');
    if (linked.length) {
      const last = linked.reduce((a, b) => (b.at || 0) > (a.at || 0) ? b : a);
      const on = /Linked to WhatsApp/.test((doc.getElementById('waStatus') || {}).textContent || '');
      if (!on && Date.now() - (last.at || 0) > 2 * 3600e3 && nm >= 7 * 60 && nm < 23 * 60) quiet = { at: last.at, t: last.time };
    }
    CUR = { sig, open, rems, counts, repeats: wbRepeatsToday(recs, 3), issues: wbRepeatIssues(byDay(), d, { days: 7, min: 3 }), maint, ext, owe, quiet, recs };
    return CUR;
  }, CUR);
}

// ── opening the WhatsApp window on a search ──
function waSearchOpen(q, range) {
  safe(() => {
    if (typeof W.waOpenFromTop !== 'function') { if (typeof showPanel === 'function') showPanel('departures'); return; }
    if (typeof brClose === 'function') safe(() => brClose());
    W.waOpenFromTop();
    const el = doc.getElementById('waQ'); if (!el) return;
    el.value = q || '';
    const b = doc.querySelector(`#waRng [data-r="${range || '30'}"]`);
    if (b) b.click(); else el.dispatchEvent(new Event('input', { bubbles: true }));
    setTimeout(() => safe(() => { el.focus({ preventScroll: true }); try { el.setSelectionRange(el.value.length, el.value.length); } catch (_) {} }), 220);
  });
}
W.waSearch = waSearchOpen;
/** a maintenance ticket on Front Office Log, filled in when possible */
function logTicket(room, problem) {
  safe(() => {
    if (typeof brClose === 'function') safe(() => brClose());
    if (typeof W.olTab === 'function') {
      W.olTab('mt');
      setTimeout(() => safe(() => {
        const b = doc.querySelector('#panel-ops-logs [data-act="mtNew"]'); if (!b) return; b.click();
        setTimeout(() => safe(() => {
          const m = doc.getElementById('ol-modal'); if (!m) return;
          const a = m.querySelector('[name="area"]'), p = m.querySelector('[name="problem"]');
          if (a && !a.value) a.value = room; if (p && !p.value) p.value = problem;
        }), 60);
      }), 120);
    } else if (typeof showPanel === 'function') showPanel('ops-logs');
  });
}

// ── 1. Ops Brain search: a "💬 HK chat" card ──
const CSS = `
.wab-card .wab-row{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;padding:8px 0;border-top:1px solid var(--border);font-size:12.5px}
.wab-card .wab-row:first-of-type{border-top:0}
.wab-card .wab-when{font:600 11px var(--mono,monospace);color:var(--text3);white-space:nowrap;padding-top:2px}
.wab-card .wab-who{font-weight:700;color:var(--text2);margin-right:4px}
.wab-card .wab-x{color:var(--text);overflow-wrap:anywhere;white-space:pre-wrap}
.wab-card .wab-res{grid-column:2;display:flex;flex-wrap:wrap;gap:4px;margin-top:3px}
.wab-chipx{font-size:11px;padding:1px 7px;border-radius:99px;border:1px solid var(--border);background:var(--bg2);color:var(--text2);overflow-wrap:anywhere}
.wab-chipx.co{color:var(--green)}.wab-chipx.notlist{color:var(--red)}
.wab-card mark,.wab-pg mark{background:color-mix(in srgb,var(--gold,#e0b24f) 35%,transparent);color:inherit;border-radius:3px;padding:0 1px}
.wab-more{font-size:12px;color:var(--text3);margin-top:6px}
.wab-pins{display:grid;gap:6px;margin:6px 0 12px}
.wab-pin{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:12px;background:var(--card2,var(--bg2));font-size:12.5px}
.wab-pin.bad{border-color:color-mix(in srgb,var(--red) 45%,var(--border))}
.wab-pin .wab-pi{font-size:16px;line-height:1.2}
.wab-pin .wab-pt{flex:1;min-width:0}
.wab-pin .wab-pt b{display:block;color:var(--text);font-weight:650;overflow-wrap:anywhere}
.wab-pin .wab-pt small{display:block;color:var(--text3);margin-top:2px;overflow-wrap:anywhere}
.wab-pin .wab-pa{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px}
.wab-b{all:unset;box-sizing:border-box;cursor:pointer;padding:5px 10px;border-radius:8px;border:1px solid var(--border2,var(--border));background:var(--card);color:var(--text);font:600 11.5px var(--font,inherit);white-space:nowrap}
.wab-b:hover{border-color:var(--gold,var(--accent))}
.wab-b.pri{background:var(--gold,var(--accent));border-color:var(--gold,var(--accent));color:var(--bg,#111)}
.wab-b:focus-visible{outline:2px solid var(--gold,var(--accent));outline-offset:2px}
.wab-oreq{border:1px solid var(--border);border-radius:12px;background:var(--card);padding:10px 12px;margin:8px 0 12px;display:grid;gap:6px}
.wab-oreq-h{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:13px;color:var(--text)}
.wab-oreq-r{display:flex;align-items:center;gap:10px;font-size:12.5px;color:var(--text);padding:6px 0;border-top:1px solid var(--border)}
.wab-oreq-r .num{font:700 13px var(--mono,monospace);min-width:44px}
.wab-oreq-r.over .num,.wab-oreq-r.over small{color:var(--red)}
.wab-oreq-t{flex:1;min-width:0;overflow-wrap:anywhere}
.wab-oreq-t small{display:block;color:var(--text3);font-size:11.5px}
#wabHomeReq:empty{display:none}
#wabHomeReq .wab-oreq{margin:12px 0}
.wab-ins{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:8px}
.wab-ins>div{border:1px solid var(--border);border-radius:10px;padding:8px 10px;background:var(--card2,var(--bg2));min-width:0}
.wab-ins h5{margin:0 0 4px;font:700 11px var(--font,inherit);color:var(--text3);text-transform:uppercase;letter-spacing:.04em}
.wab-ins li{font-size:12.5px;color:var(--text);overflow-wrap:anywhere}
.wab-ins ol{margin:0;padding-left:18px}
#panel-departures .dp-chip.wab-chip{cursor:pointer;color:#1f9d55;border-color:color-mix(in srgb,#25d366 45%,var(--dp-line,var(--border)));background:color-mix(in srgb,#25d366 10%,var(--dp-tile,var(--card2)));flex:none}
#panel-departures .dp-chip.wab-chip:hover{background:color-mix(in srgb,#25d366 18%,var(--dp-tile,var(--card2)))}
#panel-departures .dp-chip.wab-chip.wab-open{color:var(--red);border-color:color-mix(in srgb,var(--red) 45%,transparent)}
:root[data-theme-mode="dark"] #panel-departures .dp-chip.wab-chip,.dark #panel-departures .dp-chip.wab-chip{color:#5ee08f}
#depBoard:not(.dp-compact) .dp-size-list .dp-tags:has(.wab-chip){display:flex}
#depBoard:not(.dp-compact) .dp-size-list .dp-tags>.wab-chip{display:inline-flex!important}
#depBoard.dp-compact .dp-tags:has(.wab-chip){display:flex}
#depBoard.dp-compact .dp-tags>.wab-chip{display:inline-flex!important}
`;
function chatCardHtml(Q, res, more) {
  const toks = [Q.room].concat(Q.words).filter(Boolean);
  const rows = res.slice(0, 6).map(o => {
    const r = o.rec, ch = chipsOf(r.r).filter(c => c.st !== 'none' && c.st !== 'ignore');
    return `<div class="wab-row"><span class="wab-when">${esc(fmtDay(o.day))}<br>${esc(t12(r.t))}</span><span><span class="wab-who">${esc(r.s || '')}</span><span class="wab-x">${hi(String(r.x || '').slice(0, 300), toks)}</span></span>`
      + (ch.length ? `<span class="wab-res">${ch.map(c => `<span class="wab-chipx ${esc(c.st)}">${esc(c.label)}${r.u ? ' — undone' : ''}</span>`).join('')}</span>` : '') + '</div>';
  }).join('');
  return `<div class="br-card wab-card" data-wab="1"><div class="br-kind">💬 HK chat · ${plural(res.length, 'message')}${Q.day ? ' ' + Q.day : ' in the last 30 days'}</div>${rows}
    ${res.length > 6 ? `<div class="wab-more">…and ${res.length - 6} more.</div>` : ''}${more ? '<div class="wab-more">Loading older days…</div>' : ''}
    <div class="br-acts"><button class="btn" type="button" data-wab-q="${esc(Q.q)}" data-wab-r="${Q.day === 'today' ? 'today' : '30'}">💬 Open in WhatsApp search</button></div></div>`;
}
function chatSearch(Q) {
  const days = Q.day === 'today' ? [today()] : Q.day === 'yesterday' ? [dayAdd(today(), -1)] : lastDays(30);
  return listOf(days).filter(o => wbChatMatch(o.rec, Q, parse)).sort((a, b) => b.day.localeCompare(a.day) || (toMin(b.rec.t) || 0) - (toMin(a.rec.t) || 0));
}
function paintChatCard(q, tries) {
  safe(() => {
    const box = doc.getElementById('brAnswers'); if (!box) return;
    const Q = wbChatQuery(q); if (!Q) return;
    const res = chatSearch(Q), pending = !!loading || Object.keys(DAYS).length < 2;
    box.querySelectorAll('[data-wab]').forEach(n => n.remove());
    if (res.length) {
      const html = chatCardHtml(Q, res, pending);
      const first = box.firstElementChild;
      if (first && /In the app right now|Room \d/.test(first.textContent || '')) first.insertAdjacentHTML('afterend', html);
      else if (first && (tries || 0) === 0 && box.children.length > 1) first.insertAdjacentHTML('afterend', html);
      else box.insertAdjacentHTML('afterbegin', html);
    }
    if (pending && (tries || 0) < 3) ensure30().then(() => { if (brCurrentQOf() === q) paintChatCard(q, (tries || 0) + 1); });
  });
}
const brCurrentQOf = () => safe(() => (typeof brCurrentQ !== 'undefined' ? brCurrentQ : ''), '') || (doc.getElementById('brQ') || {}).value || '';
function wrapAsk() {
  const inner = W.brAsk;
  if (typeof inner !== 'function' || inner.__wab) return;
  W.brAsk = function (q) {
    const r = inner.apply(this, arguments);
    setTimeout(() => paintChatCard(String(q || '')), 0);
    setTimeout(() => { const b = doc.getElementById('brAnswers'); if (b && !b.querySelector('[data-wab]')) paintChatCard(String(q || '')); }, 450);
    return r;
  };
  W.brAsk.__wab = true;
}

// ── 2. Live thoughts ──
(W.BL_THINKERS = W.BL_THINKERS || []).push(add => {
  const C = compute();
  if (false) safe(() => C.open.slice(0, 3).forEach(o => {   // HK requests are housekeeping's to close: no alerts, the Requests log keeps them
    const n = (remState().nudge || {})[o.id] || 0;
    add({ id: 'wabReq:' + o.id + ':' + (o.age >= 75 ? 2 : 1), type: 'waReq', icon: '🧺', tone: o.age >= 75 ? 'bad' : 'warn',
      text: `Room ${o.room} asked for ${wbWhat(o.cats)} ${o.age} min ago — no reply in the group`,
      why: `${o.s} at ${t12(o.t)}: "${qMark(o.x, 90)}"${n ? '' : ''}`,
      acts: [['Open chat', () => waSearchOpen(o.room, 'today')], ['Mark handled', () => markDone(o.id, `Room ${o.room}: marked handled`)]].concat(o.maint ? [['Log a maintenance ticket', () => logTicket(o.room, wbWhat(o.cats) + ' — from the HK chat: ' + o.x)]] : []) });
  }));
  safe(() => C.maint.filter(m => !isDone(m.id) && !C.open.some(o => o.key === m.key && o.maint)).slice(0, 2).forEach(m => add({ id: 'wabMt:' + m.id, type: 'waMaint', icon: '🔧', tone: 'idle',
    text: `Room ${m.room}: ${m.cats.map(c => c.label.split(' / ')[0]).join(', ')} in the HK chat — log a maintenance ticket?`,
    why: `${m.s} at ${t12(m.t)}: "${qMark(m.x, 90)}". A ticket makes sure engineering follows it up.`,
    acts: [['Log a maintenance ticket', () => { markDone(m.id); logTicket(m.room, m.cats.map(c => c.label).join(', ') + ' — HK chat: ' + m.x); }], ['Open chat', () => waSearchOpen(m.room, 'today')], ['Not needed', () => markDone(m.id)]] })));
  safe(() => {
    const op = C.ext.filter(e => e.kind === 'opera'), nm = C.ext.filter(e => e.kind === 'notmarked');
    if (op.length) add({ id: 'wabExtOp:' + op.map(e => e.key).join(','), type: 'waExt', icon: '↪', tone: 'warn',
      text: `Extended from WhatsApp, still to update in Opera: room${op.length > 1 ? 's' : ''} ${op.slice(0, 5).map(e => e.room).join(', ')}`,
      why: 'Change the departure date in Opera, then tick "Opera updated" on the card.', acts: [['Open Departures', () => brGoSafe('departures')]] });
    if (nm.length) add({ id: 'wabExtNm:' + nm.map(e => e.key).join(','), type: 'waExt', icon: '↪', tone: 'warn',
      text: `The HK chat says room${nm.length > 1 ? 's' : ''} ${nm.slice(0, 5).map(e => e.room).join(', ')} extended, but ${nm.length > 1 ? 'they are' : 'it is'} not marked on Departures`,
      why: `${nm[0].s} at ${t12(nm[0].t)}${nm[0].why ? ' · ' + nm[0].why : ''}. Check with the guest and mark it, or ignore if it was cancelled.`, acts: [['Open Departures', () => brGoSafe('departures')], ['Open chat', () => waSearchOpen(nm[0].room, 'today')]] });
  });
  safe(() => C.owe.slice(0, 2).forEach(o => add({ id: 'wabOwe:' + o.key + ':' + o.bal, type: 'waOwe', icon: '💳', tone: 'bad',
    text: `${o.room} checked out from WhatsApp but owes AED ${o.bal}`, why: `${o.s} wrote it at ${t12(o.t)}. Settle or transfer the balance in Opera before the night audit.`,
    acts: [['Open Departures', () => brGoSafe('departures:balance')]] })));
  safe(() => {
    const iss = C.issues.filter(i => !isDone('iss:' + i.key + ':' + i.cat.id))[0];
    if (iss) add({ id: 'wabIss:' + iss.key + ':' + iss.cat.id + ':' + iss.days, type: 'waRepeat', icon: '🔁', tone: 'warn',
      text: `Room ${iss.room}: "${iss.cat.label.split(' / ')[0]}" mentioned on ${iss.days} days this week`, why: 'The same problem keeps coming back. A proper fix saves the next guest a complaint.',
      acts: [['Log a maintenance ticket', () => { markDone('iss:' + iss.key + ':' + iss.cat.id); logTicket(iss.room, `${iss.cat.label} — keeps coming back (${iss.days} days this week, HK chat)`); }], ['Open chat', () => waSearchOpen(iss.room, '7')]] });
    const rp = C.repeats.filter(r => !C.open.some(o => o.key === r.key))[0];
    if (rp && rp.n >= 3) add({ id: 'wabRep:' + rp.key + ':' + rp.n, type: 'waRepeat', icon: '💬', tone: 'idle',
      text: `Room ${rp.room} came up ${rp.n} times in the HK chat today`, why: 'Something may not be sorted for this guest. Read the messages together.', acts: [['Open chat', () => waSearchOpen(rp.room, 'today')]] });
  });
  safe(() => { if (C.quiet) add({ id: 'wabQuiet:' + today() + ':' + Math.floor(Date.now() / 36e5), type: 'waQuiet', icon: '📴', tone: 'idle',
    text: `No WhatsApp messages since ${t12(C.quiet.t)} — the reader may have stopped`, why: 'Reload WhatsApp Web and paste the reader line again, or paste today\'s chat in the WhatsApp window.',
    acts: [['Open WhatsApp window', () => { if (typeof W.waOpenFromTop === 'function') W.waOpenFromTop(); }]] }); });
  safe(() => dueRems(C).slice(0, 2).forEach(r => add({ id: 'wabRem:' + r.id, type: 'waRem', icon: '📌', tone: r.tone === 'bad' ? 'bad' : 'warn', text: r.text, why: r.why,
    acts: remActs(r) })));
  safe(() => waiting().slice(0, 2).forEach(q => add({ id: 'wabAsk:' + q.key, type: 'waAsk', icon: '❓', tone: 'idle',
    text: `${q.sender || 'Someone'} wrote "${qMark(q.text || q.word, 40)}". What does "${q.word}" mean?`, why: (q.guess ? `My guess: ${MEAN[q.guess]}. ` : '') + 'Your answer teaches HotelOps for the whole team (📖 WhatsApp words).',
    acts: askActs(q) })));
});
const brGoSafe = go => safe(() => { if (typeof brClose === 'function') brClose(); if (typeof brGo === 'function') brGo(go); else if (typeof showPanel === 'function') showPanel(String(go).split(':')[0]); });

// ── 3. Reminders: due ones pop up at the right time (max 2 per item, snoozable) ──
function remCondOk(r) {
  if (r.cond === 'notOut') { const z = depRoom(r.room); if (!z || z.status === 'out' || z.status === 'extended') return false; }
  return true;
}
function dueRems(C) {
  const nm = nowMin();
  const L = (C || CUR).rems.filter(r => nm >= r.at && nm - r.at <= 180 && !isDone(r.id) && !snoozed(r.id) && remCondOk(r));
  // a shift-end reminder for chat extensions still not in Opera
  safe(() => {
    const end = shiftEnd(), op = (C || CUR).ext.filter(e => e.kind === 'opera');
    if (op.length && nm >= end - 30 && nm < end) {
      const id = 'extEnd:' + today() + ':' + end + ':' + op.map(e => e.key).join(',');
      if (!isDone(id) && !snoozed(id)) L.push({ id, kind: 'extEnd', at: end - 30, text: `Before you go: update Opera for room${op.length > 1 ? 's' : ''} ${op.map(e => e.room).join(', ')} (extended from WhatsApp)`, why: `Your shift ends at ${clock(end)}. The next shift may not know.`, tone: 'warn' });
    }
  });
  return L;
}
function remActs(r) {
  return [['Done', () => markDone(r.id, 'Done ✓')], ['Snooze 15 min', () => snooze(r.id, 15)], ['Snooze 1 h', () => snooze(r.id, 60)]]
    .concat(r.room ? [['Open chat', () => waSearchOpen(r.room, 'today')]] : []);
}
function popAlert(item) {
  safe(() => {
    if (typeof hoQuiet === 'function' && hoQuiet()) return;
    if (typeof hoAlert === 'function') safe(() => hoAlert(item.text));
    if (typeof blSay === 'function') blSay({ id: 'wabPop:' + item.id + ':' + Date.now(), type: 'waRem', tone: item.tone === 'bad' ? 'bad' : 'warn', icon: item.icon || '📌', text: item.text, why: item.why, acts: item.acts }, true);
    else if (typeof showToast === 'function') showToast(item.text, 'warn');
  });
}
function tick() {
  safe(() => {
    const C = compute(), S = remState(), nm = nowMin();
    let changed = false;
    dueRems(C).forEach(r => {
      const n = S.nudge[r.id] || 0, last = S.nudge[r.id + '@'] || 0;
      if (n >= 2 || (n && Date.now() - last < 30 * 60e3)) return;
      S.nudge[r.id] = n + 1; S.nudge[r.id + '@'] = Date.now(); changed = true;
      popAlert({ id: r.id, text: r.text, why: r.why, tone: r.tone, icon: r.kind === 'lco' ? '⏰' : '📌', acts: remActs(r) });
    });
    if (false) C.open.forEach(o => {   // no pop-ups for HK requests (housekeeping closes them)
      const n = S.nudge[o.id] || 0, need = o.age >= 75 ? 2 : 1;
      if (n >= need || snoozed(o.id) || nm - (toMin(o.t) || 0) > 240) return;
      S.nudge[o.id] = need; changed = true;
      popAlert({ id: o.id, tone: need > 1 ? 'bad' : 'warn', icon: '🧺', text: `Room ${o.room} asked for ${wbWhat(o.cats)} ${o.age} min ago — no reply in the group`, why: `${o.s} at ${t12(o.t)}: "${qMark(o.x, 90)}"`,
        acts: [['Open chat', () => waSearchOpen(o.room, 'today')], ['Done', () => markDone(o.id, `Room ${o.room}: marked handled`)], ['Snooze 15 min', () => snooze(o.id, 15)], ['Snooze 1 h', () => snooze(o.id, 60)]] });
    });
    if (changed) LS.set('wab_rem_v1', S);
    scanAsk();
    paintChips();
    paintHomeReq();
  });
}

// ── 4. Words: the team's dictionary (window.hoWaWords) and the question queue (window.hoWaAsk) ──
const MEAN = MEANINGS;
let ASK = null, WORDS = null, FBASK = {};
const fbKey = k => String(k).replace(/[.#$\[\]\/]/g, '_');
safe(() => {
  WORDS = wbMakeWords({ load: () => LS.get('wab_words_v1', null), save: v => LS.set('wab_words_v1', v) },
    (k, e) => { if (typeof fbSet === 'function') safe(() => Promise.resolve(fbSet('waWords/' + fbKey(k), e)).catch(() => {})); }, me);
  /** for the WhatsApp parser and the question cards: lookup(word) → {m, label, note, builtin}|null, all(), add(word, meaning, note), remove(word), onChange(cb), read(text) */
  W.hoWaWords = {
    lookup: w => WORDS.lookup(w), all: () => WORDS.all(), allWithOff: () => WORDS.allWithOff(), dict: () => WORDS.dict(), meanings: Object.assign({}, MEANINGS),
    add: (w, m, note) => { const e = WORDS.add(w, m, note); if (e) { clearAsk(e.key); safe(() => logActivity('wa_word', `"${e.word}" = ${MEANINGS[m]}`)); } return e; },
    remove: w => WORDS.remove(w), restore: w => WORDS.restore(w), onChange: f => WORDS.onChange(f), read: t => WORDS.read(t), test: t => testMessage(t),
  };
  ASK = wbMakeAsk({ load: () => LS.get('wab_ask_v1', null), save: v => LS.set('wab_ask_v1', v) }, WORDS, me);
  ASK.autoScan = true;          // until the bridge reads hoWaWords itself: act on known words in today's notes, ask about the rest
  W.hoWaAsk = ASK;
  ASK.onAnswer(({ word, meaning, items }) => {
    items.forEach(it => safe(() => applyMeaning(it, meaning)));
    safe(() => showToast(`Learned: "${word}" = ${MEAN[meaning]}. The whole team gets it.`, 'ok'));
  });
  WORDS.onChange(() => { scanSig = ''; softRefresh(); });
  const add0 = ASK.add;
  ASK.add = q => { const it = add0(q); if (it && it.st === 'open' && ASK.autoScan && !FBASK[fbKey(it.word)] && typeof fbSet === 'function') safe(() => { FBASK[fbKey(it.word)] = { word: it.raw || it.word, room: it.room, text: it.text, sender: it.sender, at: it.at }; Promise.resolve(fbUpdate('waAsk', { [fbKey(it.word)]: FBASK[fbKey(it.word)] })).catch(() => {}); }); return it; };
});
function clearAsk(key) { const k = fbKey(key); if (FBASK[k]) { delete FBASK[k]; if (typeof fbSet === 'function') safe(() => Promise.resolve(fbSet('waAsk/' + k, null)).catch(() => {})); } }
/** the words waiting for an answer: this device's questions + the team's (waAsk/{word}) */
function waiting() {
  const L = [], seen = new Set();
  if (bridgeAsks()) safe(() => (W.hoWaBridge.asks() || []).forEach(q => { const k = fbKey(wbWordKey(q.word)); if (!q || !q.word || seen.has(k) || (WORDS && WORDS.lookup(q.word))) return; seen.add(k); L.push({ key: k, word: q.word, room: q.room || '', text: q.text || '', sender: q.sender || '', at: q.at || 0 }); }));
  if (ASK) ASK.list().forEach(q => { const k = fbKey(q.word); if (seen.has(k)) return; seen.add(k); L.push({ key: k, word: q.raw || q.word, room: q.room, text: q.text, sender: q.sender, guess: q.guess, at: q.at }); });
  Object.keys(FBASK).forEach(k => { const q = FBASK[k]; if (!q || seen.has(k) || (WORDS && WORDS.lookup(q.word || k))) return; seen.add(k); L.push({ key: k, word: q.word || k, room: q.room || '', text: q.text || '', sender: q.sender || '', at: q.at || 0 }); });
  return L.sort((a, b) => (b.at || 0) - (a.at || 0));
}
const bridgeAsks = () => !!(W.hoWaBridge && typeof W.hoWaBridge.answer === 'function');
function answerWord(word, m, note) {
  safe(() => {
    if (bridgeAsks()) { W.hoWaBridge.answer(word, m, note || '', me()); if (ASK) ASK.list().filter(q => wbWordKey(q.word) === wbWordKey(word)).forEach(q => ASK.dismiss(q.id)); clearAsk(wbWordKey(word)); softRefresh(); return; } if (ASK) { const hit = ASK.answer(word, m, me(), note); if (!hit.length) safe(() => showToast(`Learned: "${word}" = ${MEAN[m]}`, 'ok')); } else if (WORDS) WORDS.add(word, m, note); clearAsk(wbWordKey(word)); });
}
function askActs(q) { return ['co', 'ext', 'lco', 'note', 'hk', 'ignore'].map(m => [MEAN[m], () => answerWord(q.word, m)]); }
/** how a sample message is read: "315 VD" → ["Room 315 → ✓ Checked out (VD = Vacant Dirty, built-in)"] */
function testMessage(text) {
  const out = [];
  safe(() => {
    const P = parse(text);
    if (P.kind === 'ignore') { out.push('A HotelOps post — ignored.'); return; }
    const st = WORDS ? WORDS.read(text) : [], used = new Set();
    const rich = s => `Room ${s.room} → ${MEAN[s.m]} ("${s.word.toUpperCase()}"${s.note ? ' = ' + s.note : ''})`;
    (P.actions || []).forEach(a => {
      const s = st.find(x => rk(x.room) === rk(a.room));
      if (s && (a.act === 'note' || a.act === s.m)) { used.add(s); out.push(rich(s)); return; }
      out.push(`Room ${a.room} → ${a.act === 'co' ? MEAN.co : a.act === 'ext' ? MEAN.ext + (a.nights ? ` +${a.nights}N` : a.until ? ` till ${a.until}` : '') : a.act === 'lco' ? MEAN.lco + (a.time ? ' ' + clock(toMin(a.time)) : '') : '📝 Note: ' + a.note}${a.word ? ` ("${a.word}")` : ''}`);
    });
    st.filter(s => !used.has(s)).forEach(s => out.push(rich(s)));
    const bridgeAsk = P.ask && P.ask.word ? [String(P.ask.word).toLowerCase()] : [];
    if (WORDS) wbAskCandidates(text, WORDS.dict()).filter(c => c.conf !== 'learned').forEach(c => out.push(`Room ${c.room}: "${c.word}" is new — ${c.m ? `maybe ${MEAN[c.m]}; ` : ''}HotelOps would ask what it means.`));
    bridgeAsk.forEach(w => { if (!out.some(x => x.includes(`"${w}" is new`))) out.push(`"${w}" is new — HotelOps would ask what it means.`); });
    if (!out.length) out.push(wbRooms(text).length ? 'Nothing to do on the board.' : 'No room number — just kept in the chat log.');
  });
  return out;
}
/** apply a known meaning to the message it came from (the room's status, with the app's Undo) */
function applyMeaning(it, m) {
  if (!/^(?:co|ext|lco)$/.test(m)) return false;
  const i = rooms().findIndex(r => rk(r.roomStr) === rk(it.room)); if (i < 0) return false;
  const r = rooms()[i];
  if (r.status === 'out' || r.status === 'extended') return false;
  if (m === 'lco' && r.status === 'late') return false;
  const hm = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const w = String(it.raw || it.word || '').toUpperCase();
  const line = `[${hm}] ${m === 'co' ? 'Checked out' : m === 'ext' ? 'Extended (nights not said)' : 'Late check-out'} — WhatsApp · ${it.sender || ''} ${t12(it.time)} ("${w}"${it.note ? ' = ' + it.note : ''})`;
  r.note = r.note ? r.note + '\n' + line : line;
  if (m === 'co') depAction(i, 'out');
  else if (m === 'ext') depAction(i, 'extended', 1);
  else { const t = (String(it.tail || '').match(/\d{1,2}(?::\d{2})?\s*(?:am|pm)?/i) || [])[0]; r.lateTime = t && typeof W.hoWaTime === 'function' ? W.hoWaTime(t) : ''; depAction(i, 'late'); }
  safe(() => showToast(`Room ${r.roomStr}: ${MEAN[m].replace(/^\W+\s*/, '').toLowerCase()} (WhatsApp "${w}")`, 'ok'));
  return true;
}
let scanSig = '';
function scanAsk() {
  if (!ASK || !ASK.autoScan || !WORDS) return;
  if (bridgeAsks()) { ASK.autoScan = false; return; }       // the bridge reads hoWaWords and asks by itself
  safe(() => {
    const L = logEntries(), sig = today() + '|' + L.length + '|' + ((L[0] || {}).key || '') + '|' + Object.keys(WORDS.dict()).length;
    if (sig === scanSig) return; scanSig = sig;
    const done = LS.get('wab_ask_applied', { day: today(), ids: {} }); if (done.day !== today()) { done.day = today(); done.ids = {}; }
    L.forEach(e => {
      if (e.undone || !(e.res || []).some(r => r.st === 'note' || r.st === 'none')) return;
      // known words the bridge does not read yet ("315 VD", "VD: 315, 402")
      WORDS.read(e.text).forEach(s => {
        const id = e.key + '|' + rk(s.room) + '|' + s.word;
        if (done.ids[id] || !/^(?:co|ext|lco)$/.test(s.m)) return;
        done.ids[id] = 1; applyMeaning({ room: s.room, word: s.word, raw: s.word, note: s.note, sender: e.sender, time: e.time }, s.m);
      });
      wbAskCandidates(e.text, WORDS.dict()).forEach(c => {
        const z = depRoom(c.room); if (!z || z.status === 'out') return;
        const id = e.key + '|' + rk(c.room) + '|' + c.word;
        if (c.conf === 'learned') { if (!done.ids[id]) { done.ids[id] = 1; applyMeaning({ room: c.room, word: c.word, sender: e.sender, time: e.time, tail: c.tail }, c.m); } return; }
        ASK.add({ word: c.word, raw: c.word, room: c.room, m: c.m, conf: c.conf, sender: e.sender, time: e.time, text: e.text, day: today(), key: e.key });
      });
    });
    LS.set('wab_ask_applied', done);
  });
}

// ── 5. The 💬 chip on Departures cards ──
function paintChips() {
  safe(() => {
    const grid = doc.getElementById('depGrid'); if (!grid) return;
    const C = CUR.counts || {};
    grid.querySelectorAll('.dep-card[data-room]').forEach(card => {
      const k = rk(card.dataset.room), n = C[k] || 0, tags = card.querySelector('.dp-tags');
      let b = card.querySelector('.wab-chip');
      if (!n || !tags) { if (b) b.remove(); return; }
      const open = CUR.open.some(o => o.key === k);
      if (!b) { b = doc.createElement('button'); b.type = 'button'; b.className = 'dp-chip wab-chip'; tags.appendChild(b); }
      const txt = '💬 ' + n, ttl = `${plural(n, 'message')} about room ${card.dataset.room} in the HK chat today — tap to read`;
      if (b.textContent !== txt) b.textContent = txt;
      if (b.title !== ttl) { b.title = ttl; b.setAttribute('aria-label', ttl); }
      b.classList.toggle('wab-open', false);
    });
  });
}
function wrapRender() {
  const r = W.depRender;
  if (typeof r !== 'function' || r.__wab) return;
  const f = function () { const out = r.apply(this, arguments); paintChips(); return out; };
  f.__wab = true; Object.keys(r).forEach(k => { try { f[k] = r[k]; } catch (_) {} });
  W.depRender = f;
}

// ── 6. Shift handover: "HK chat this shift" ──
function handoverGroup() {
  return safe(() => {
    const start = typeof hoShiftNow === 'function' ? hoShiftNow().start : new Date(Date.now() - 8 * 3600e3);
    const B = byDay(), recs = [];
    [dayAdd(today(), -1), today()].forEach(d => (B[d] || []).forEach(r => { const m = toMin(r.t); if (m == null) return; const at = new Date(d + 'T00:00:00'); at.setMinutes(m); if (at >= start && at <= new Date()) recs.push(r); }));
    if (!recs.length) return null;
    const n = { co: 0, lco: 0, ext: 0, note: 0 };
    recs.forEach(r => { if (r.u) return; String(r.r || '').split(' · ').forEach(p => { const st = p.split(' ')[0]; if (n[st] != null) n[st]++; }); });
    const C = compute(true), open = reqTrack() ? C.open.filter(o => o.t && recs.some(r => r.t === o.t)) : [];
    const items = [`${plural(recs.length, 'message')} · ${n.co} checked out · ${n.lco} late check-out${n.lco === 1 ? '' : 's'} · ${n.ext} extended · ${plural(n.note, 'note')}${reqTrack() ? ` · ${open.length} open request${open.length === 1 ? '' : 's'}` : ''}`];
    open.slice(0, 8).forEach(o => items.push(`Open: Room ${o.room} — ${wbWhat(o.cats)} (${o.s}, ${t12(o.t)}, no reply yet)`));
    dueRems(C).concat(C.rems.filter(r => r.at > nowMin() && !isDone(r.id) && remCondOk(r))).slice(0, 6).forEach(r => items.push(`Reminder ${clock(r.at)}: ${r.text}`));
    C.ext.filter(e => e.kind === 'opera').forEach(e => items.push(`Room ${e.room}: extended from WhatsApp — update Opera`));
    return { icon: '💬', head: 'HK chat this shift', items };
  }, null);
}
function wrapHome() {
  return;   // no "open requests" card on Home: HK requests are housekeeping's, see the HK Requests page
  const o = W.homeRender;
  if (typeof o !== 'function' || o.__wab) return;
  const f = function () { const r = o.apply(this, arguments); setTimeout(paintHomeReq, 0); return r; };
  f.__wab = true; W.homeRender = f;
}
function wrapHandover() {
  const o = W._hoTodo;
  if (typeof o !== 'function' || o.__wab) return;
  const f = function () { const L = o.apply(this, arguments); safe(() => { const g = handoverGroup(); if (g && Array.isArray(L)) L.push(g); }); return L; };
  f.__wab = true; W._hoTodo = f;
}

// ── 7. In the Ops Brain panel: 📌 From the HK chat + 💬 HK chat insights ──
function pinsHtml() {
  const C = compute(), L = [];
  dueRems(C).forEach(r => L.push({ icon: r.kind === 'lco' ? '⏰' : '📌', tone: r.tone, text: r.text, why: r.why, acts: remActs(r).slice(0, 3).concat(r.room ? [['Open chat', null, r.room]] : []), id: r.id }));
  C.rems.filter(r => r.at > nowMin() && !isDone(r.id) && remCondOk(r)).slice(0, 4).forEach(r => L.push({ icon: '🕒', text: `${clock(r.at)} · ${r.text}`, why: r.why, id: r.id, acts: [['Done', () => markDone(r.id, 'Done ✓')]] }));
  if (false) C.open.forEach(o => L.push({ icon: '🧺', tone: o.age >= 75 ? 'bad' : '', text: `Room ${o.room}: ${wbWhat(o.cats)} — ${o.age} min, no reply`, why: `${o.s} at ${t12(o.t)}: "${qMark(o.x, 80)}"`, id: o.id,
    acts: [['Done', () => markDone(o.id, `Room ${o.room}: marked handled`)], ['Snooze 15 min', () => snooze(o.id, 15)], ['Snooze 1 h', () => snooze(o.id, 60)], ['Open chat', null, o.room]] }));
  waiting().slice(0, 3).forEach(q => L.push({ icon: '❓', text: `What does "${q.word}" mean? (${q.sender || 'HK'}: "${qMark(q.text || q.word, 40)}")`, why: q.guess ? 'My guess: ' + MEAN[q.guess] : '', id: q.key, acts: askActs(q) }));
  PIN_ACTS = [];
  const oreq = openReqCardHtml(3);
  if (!L.length) return oreq ? `<div class="br-sec">📌 From the HK chat</div>${oreq}` : '';
  return `<div class="br-sec">📌 From the HK chat</div>${oreq}<div class="wab-pins">${L.slice(0, 10).map(p => `<div class="wab-pin ${p.tone === 'bad' ? 'bad' : ''}"><span class="wab-pi">${p.icon}</span><span class="wab-pt"><b>${esc(p.text)}</b>${p.why ? `<small>${esc(p.why)}</small>` : ''}
    <span class="wab-pa">${p.acts.map((a, i) => { const k = PIN_ACTS.push(a) - 1; return `<button type="button" class="wab-b${i ? '' : ' pri'}" data-wab-act="${k}">${esc(a[0])}</button>`; }).join('')}</span></span></div>`).join('')}</div>`;
}
let PIN_ACTS = [];
async function insightsHtml() {
  await ensure30();
  const L = listOf(lastDays(30)), S = wbStats(L, parse);
  if (!S.msgs) return `<div class="br-card" id="wabIns"><div class="br-title">💬 HK chat insights</div><div class="br-body">No HK chat messages kept yet. Link WhatsApp or paste the chat on Departures → 🟢 WhatsApp, and I'll learn from it.</div></div>`;
  const hours = S.byHour.map((n, h) => [h, n]).filter(x => x[1]).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const items = topOf(S.cats, 5).filter(([id]) => CAT[id]), rms = topOf(S.rooms, 5);
  const mv = wbMoveSummary(wbMoves(L));
  return `<div class="br-card" id="wabIns"><div class="br-title">💬 HK chat insights · last 30 days</div><div class="br-body">${plural(S.msgs, 'message')} read, ${plural(S.reqs, 'request')}${mv.total ? `, ${plural(mv.total, 'room move')}` : ''}.</div>
    <div class="wab-ins"><div><h5>Busiest hours</h5><ol>${hours.map(([h, n]) => `<li>${hourLbl(h)} · ${n}</li>`).join('') || '<li>—</li>'}</ol></div>
    <div><h5>Most requested</h5><ol>${items.map(([id, n]) => `<li>${CAT[id].icon} ${esc(CAT[id].label)} · ${n}</li>`).join('') || '<li>—</li>'}</ol></div>
    <div><h5>Rooms asking most</h5><ol>${rms.map(([k, n]) => `<li>${esc(S.roomLbl[k] || k)} · ${n}</li>`).join('') || '<li>—</li>'}</ol></div></div>
    <div class="br-acts"><button class="btn" type="button" onclick="brClose();showPanel('hk-requests')">🧺 Open HK Requests</button></div></div>`;
}
function extendPanel(t) {
  safe(() => {
    const think = doc.querySelector('.br-pane[data-t="think"]');
    if (think && (t === 'think' || !t)) {
      let box = doc.getElementById('wabPins');
      if (!box) { box = doc.createElement('div'); box.id = 'wabPins'; const a = doc.getElementById('brAnswers'); if (a) a.after(box); else think.prepend(box); }
      box.innerHTML = pinsHtml();
    }
    const learned = doc.getElementById('brLearned');
    if (learned && t === 'learned') setTimeout(() => insightsHtml().then(h => { if (!doc.getElementById('brLearned')) return; doc.getElementById('wabIns')?.remove(); doc.getElementById('brLearned').insertAdjacentHTML('beforeend', h); }).catch(() => {}), 0);
  });
}
function wrapTabs() {
  const o = W.brTabShow;
  if (typeof o !== 'function' || o.__wab) return;
  const f = function (t) { const r = o.apply(this, arguments); setTimeout(() => extendPanel(t), 0); return r; };
  f.__wab = true; W.brTabShow = f;
}
function softRefresh() {
  safe(() => {
    clearTimeout(softRefresh._t);
    softRefresh._t = setTimeout(() => safe(() => {
      compute(true); paintChips(); paintHomeReq();
      if (doc.getElementById('brSheet')?.classList.contains('open') && doc.getElementById('wabPins')) doc.getElementById('wabPins').innerHTML = pinsHtml();
      if (doc.getElementById('panel-hk-requests')?.classList.contains('active')) hkRender();
    }), 150);
  });
}

// ═════════════════ 8. The 🧺 HK Requests page ═════════════════
const PANEL = 'hk-requests';
let HK = { per: '7', from: '', to: '', open: '', last: null, tab: 'log', edit: '', lf: { st: 'open', room: '', cat: '', day: '', q: '' }, adding: false };
try { HK.per = localStorage.getItem('wab_hk_per') || '7'; } catch (_) {}
const PCSS = `
.wab-pg{display:grid;gap:14px;min-width:0}
.wab-pg .wab-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.wab-pg .wab-per{display:flex;flex-wrap:wrap;gap:6px}
.wab-pg .wab-per button{all:unset;box-sizing:border-box;cursor:pointer;padding:6px 12px;border-radius:99px;border:1px solid var(--border);background:var(--card);color:var(--text2);font:600 12.5px var(--font,inherit);white-space:nowrap}
.wab-pg .wab-per button.on{background:var(--gold,var(--accent));border-color:var(--gold,var(--accent));color:var(--bg,#111)}
.wab-pg .wab-per button:focus-visible{outline:2px solid var(--gold,var(--accent));outline-offset:2px}
.wab-pg .wab-dates{display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:12.5px;color:var(--text3)}
.wab-pg .wab-dates input{background:var(--bg2);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:6px 8px;font:12.5px var(--font,inherit);color-scheme:light dark;max-width:150px}
.wab-pg .wab-dl{margin-left:auto;display:flex;gap:6px}
.wab-pg .wab-sec{background:var(--card);border:1px solid var(--border);border-radius:var(--r,12px);padding:14px 16px;min-width:0}
.wab-pg .wab-sec h3{margin:0 0 4px;font:700 14px var(--font,inherit);color:var(--text)}
.wab-pg .wab-sec>p{margin:0 0 10px;font-size:12.5px;color:var(--text3)}
.wab-pg .wab-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px}
.wab-pg .wab-kpi{background:var(--card);border:1px solid var(--border);border-radius:var(--r,12px);padding:12px 14px}
.wab-pg .wab-kpi b{display:block;font:750 22px var(--font,inherit);color:var(--text);font-variant-numeric:tabular-nums}
.wab-pg .wab-kpi span{font-size:12px;color:var(--text3)}
.wab-pg .wab-tips{margin:0;padding-left:20px;display:grid;gap:6px;font-size:13px;color:var(--text)}
.wab-pg .wab-tw{overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--border);border-radius:10px}
.wab-pg table{width:100%;border-collapse:collapse;font-size:12.5px;min-width:560px}
.wab-pg th{text-align:left;font:700 11px var(--font,inherit);text-transform:uppercase;letter-spacing:.04em;color:var(--text3);padding:8px 10px;background:var(--bg2);border-bottom:1px solid var(--border);white-space:nowrap}
.wab-pg td{padding:8px 10px;border-bottom:1px solid var(--border);color:var(--text);vertical-align:top}
.wab-pg tr:last-child td{border-bottom:0}
.wab-pg tr.wab-click{cursor:pointer}
.wab-pg tr.wab-click:hover td{background:var(--bg2)}
.wab-pg tr.wab-click:focus-visible td{outline:2px solid var(--gold,var(--accent));outline-offset:-2px}
.wab-pg .wab-share{display:flex;align-items:center;gap:8px;min-width:120px}
.wab-pg .wab-share i{display:block;height:8px;border-radius:99px;background:var(--gold,var(--accent));min-width:3px}
.wab-pg .wab-share span{font:600 11.5px var(--mono,monospace);color:var(--text2)}
.wab-pg .up{color:var(--red);font-weight:700}.wab-pg .down{color:var(--green);font-weight:700}.wab-pg .flat{color:var(--text3)}
.wab-pg .num{font-variant-numeric:tabular-nums;font-family:var(--mono,monospace);white-space:nowrap}
.wab-pg .wab-msgs td{background:var(--card2,var(--bg2))}
.wab-pg .wab-msg{padding:6px 0;border-top:1px dashed var(--border);font-size:12.5px;overflow-wrap:anywhere}
.wab-pg .wab-msg:first-child{border-top:0}
.wab-pg .wab-msg small{color:var(--text3);font-family:var(--mono,monospace);margin-right:6px}
.wab-pg .wab-cards{display:grid;gap:8px}
.wab-pg .wab-rcard{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;justify-content:space-between;border:1px solid var(--border);border-radius:10px;padding:10px 12px;background:var(--card2,var(--bg2))}
.wab-pg .wab-rcard b{color:var(--text)}
.wab-pg .wab-rcard small{display:block;color:var(--text3);font-size:12px;margin-top:2px}
.wab-pg .wab-reasons{display:flex;flex-wrap:wrap;gap:6px}
.wab-pg .wab-reasons span{font-size:12px;padding:3px 10px;border-radius:99px;border:1px solid var(--border);background:var(--card2,var(--bg2));color:var(--text2)}
.wab-pg .wab-empty{padding:12px;text-align:center;color:var(--text3);font-size:12.5px}
.wab-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 12px}
.wab-tabs button{all:unset;box-sizing:border-box;cursor:pointer;padding:8px 14px;border-radius:10px;border:1px solid var(--border);background:var(--card);color:var(--text2);font:650 13px var(--font,inherit);display:inline-flex;gap:6px;align-items:center}
.wab-tabs button.on{border-color:var(--gold,var(--accent));color:var(--text);box-shadow:inset 0 -2px 0 var(--gold,var(--accent))}
.wab-tabs button em{font-style:normal;font:700 11px var(--mono,monospace);background:var(--red);color:#fff;border-radius:99px;padding:1px 7px}
.wab-tabs button:focus-visible{outline:2px solid var(--gold,var(--accent));outline-offset:2px}
.wab-pg .wab-wform{display:grid;gap:8px}
.wab-pg .wab-wform input,.wab-pg .wab-wform select,.wab-pg .wab-wq,.wab-pg textarea{box-sizing:border-box;width:100%;background:var(--bg2);color:var(--text);border:1px solid var(--border);border-radius:9px;padding:8px 10px;font:13px var(--font,inherit);margin:0}
.wab-pg textarea{font-family:var(--mono,monospace);resize:vertical}
.wab-pg .wab-wq{margin-bottom:10px}
.wab-pg .wab-wout{margin-top:8px;display:grid;gap:6px;font-size:12.5px;color:var(--text)}
.wab-pg .wab-wout code{font:12px var(--mono,monospace);background:var(--bg2);padding:1px 6px;border-radius:5px;overflow-wrap:anywhere}
.wab-pg .wab-wout ul{margin:3px 0 0;padding-left:20px;color:var(--text2)}
.wab-pg .wab-b{all:unset;box-sizing:border-box;cursor:pointer;padding:5px 10px;border-radius:8px;border:1px solid var(--border2,var(--border));background:var(--card);color:var(--text);font:600 11.5px var(--font,inherit);white-space:nowrap}
.wab-pg .wab-b.pri{background:var(--gold,var(--accent));border-color:var(--gold,var(--accent));color:var(--bg,#111)}
.wab-pg .wab-lf{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}
.wab-pg .wab-lf input,.wab-pg .wab-lf select{box-sizing:border-box;background:var(--bg2);color:var(--text);border:1px solid var(--border);border-radius:9px;padding:7px 10px;font:13px var(--font,inherit);margin:0;color-scheme:light dark;min-width:0;flex:1 1 120px;max-width:240px}
.wab-pg .wab-lf #wabLRoom,.wab-pg .wab-lf #wabARoom{flex:0 1 90px}
.wab-pg .wab-ladd{border:1px dashed var(--border2,var(--border));border-radius:10px;padding:10px 12px;margin-bottom:10px;font-size:12.5px;color:var(--text)}
.wab-pg .wab-per button em{font-style:normal;font:700 11px var(--mono,monospace);opacity:.75;margin-left:2px}
.wab-pg .wab-hist{font-size:12.5px;color:var(--text);background:var(--card2,var(--bg2));border:1px solid var(--border);border-radius:10px;padding:8px 12px;margin-bottom:10px;overflow-wrap:anywhere}
.wab-pg table.wab-log td small{display:block;color:var(--text3);font-size:11px;margin-top:2px}
.wab-pg table.wab-log .wab-lx{max-width:340px;overflow-wrap:anywhere;color:var(--text2)}
.wab-pg table.wab-log tr.wab-over td{background:color-mix(in srgb,var(--red) 9%,transparent)}
.wab-pg table.wab-log tr.wab-over .wab-st{color:var(--red);font-weight:700}
.wab-pg table.wab-log tr.wab-done td{opacity:.78}
.wab-pg .wab-room{all:unset;cursor:pointer;font:700 13px var(--mono,monospace);color:var(--text);border-bottom:1px dashed var(--text3)}
.wab-pg .wab-room:focus-visible{outline:2px solid var(--gold,var(--accent))}
.wab-pg .wab-grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px;min-width:0}
@media (max-width:900px){.wab-pg .wab-grid2{grid-template-columns:1fr}}
@media (max-width:600px){.wab-pg .wab-sec{padding:12px}.wab-pg .wab-dl{margin-left:0}.wab-pg .wab-kpi b{font-size:19px}}
`;
function periodDays() {
  const t = today(), d = new Date(t + 'T12:00:00');
  let from = t, to = t;
  if (HK.per === '7') from = dayAdd(t, -6);
  else if (HK.per === '30') from = dayAdd(t, -29);
  else if (HK.per === 'month') from = t.slice(0, 8) + '01';
  else if (HK.per === 'last') { const a = new Date(d.getFullYear(), d.getMonth() - 1, 1), b = new Date(d.getFullYear(), d.getMonth(), 0); from = isoDay(a); to = isoDay(b); }
  else if (HK.per === 'pick') { from = HK.from || dayAdd(t, -6); to = HK.to || t; if (from > to) { const x = from; from = to; to = x; } }
  const days = []; for (let x = from; x <= to && days.length < 93; x = dayAdd(x, 1)) days.push(x);
  const n = days.length, prev = []; for (let i = n; i >= 1; i--) prev.push(dayAdd(from, -i));
  return { from, to, days, prev };
}
const PER_LBL = { today: 'Today', '7': '7 days', '30': '30 days', month: 'This month', last: 'Last month', pick: '📅 Pick dates' };
let hkSeq = 0;
// ── the requests log: every room request (in-house or departing), its status shared at waReq/{date}/{id} ──
const REQ = { shared: {}, day: '', listen: '' };
function reqListen() {
  const d = today(); if (REQ.listen === d || typeof fbListen !== 'function') return; REQ.listen = d;
  safe(() => fbListen('waReq/' + d, v => { if (today() !== d) return; REQ.shared[d] = v && typeof v === 'object' ? v : {}; LS.set('wab_req_v1', { day: d, v: REQ.shared[d] }); softRefresh(); }));
}
function reqShared(day) {
  if (!REQ.shared[day] && day === today()) { const c = LS.get('wab_req_v1', null); if (c && c.day === day) REQ.shared[day] = c.v || {}; }
  return REQ.shared[day] || {};
}
async function reqLoad(day) {
  if (day === today()) { reqListen(); return; }
  if (REQ.shared[day] && Date.now() - (REQ.shared[day].__at || 0) < 60e3) return;
  let v = null; try { v = typeof fbGet === 'function' ? await fbGet('waReq/' + day) : null; } catch (_) {}
  REQ.shared[day] = Object.assign(v && typeof v === 'object' ? v : {}, { __at: Date.now() });
}
function reqItems(day) {
  return safe(() => {
    const sh = reqShared(day), manual = Object.keys(sh).filter(k => sh[k] && sh[k].manual).map(k => Object.assign({ id: k }, sh[k]));
    const recs = day === today() ? todayRecs() : (byDay()[day] || []);
    return wbRequestLog(recs, day === today() ? nowMin() : 1440, sh, manual, { parse, day, past: day < today() });
  }, []);
}
function reqSet(day, id, st) {
  const sh = REQ.shared[day] = REQ.shared[day] || {};
  const patch = { st, by: me(), at: Date.now() };
  sh[id] = Object.assign({}, sh[id], patch);
  if (day === today()) LS.set('wab_req_v1', { day, v: sh });
  if (typeof fbUpdate === 'function') safe(() => Promise.resolve(fbUpdate('waReq/' + day, { [fbKey(id) + '/st']: st, [fbKey(id) + '/by']: patch.by, [fbKey(id) + '/at']: patch.at })).catch(() => {}));
  safe(() => logActivity('hk_request_' + st, id));
  softRefresh();
}
function reqAdd(room, cat, what, note) {
  const d = today(), id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), now = new Date();
  const e = { manual: 1, room: String(room).trim(), cat: cat || '', what: what || (CAT[cat] ? CAT[cat].label : 'Request'), note: String(note || '').slice(0, 200), t: pad(now.getHours()) + ':' + pad(now.getMinutes()), by: me(), at: Date.now(), st: 'open' };
  (REQ.shared[d] = REQ.shared[d] || {})[id] = e; LS.set('wab_req_v1', { day: d, v: REQ.shared[d] });
  if (typeof fbSet === 'function') safe(() => Promise.resolve(fbSet('waReq/' + d + '/' + id, e)).catch(() => {}));
  safe(() => logActivity('hk_request_added', `Room ${e.room}: ${e.what}`));
  safe(() => showToast(`Room ${e.room}: ${e.what} — added to the requests log`, 'ok'));
}
const fmtOpen = m => m == null ? '' : m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60 ? (m % 60) + ' min' : '');
// the log is a calm record by default: housekeeping closes requests in WhatsApp, nobody ticks or follows up.
// "Track requests" (off unless switched on, per device) brings back Open / Done, timers and the Done buttons.
const reqTrack = () => { try { return localStorage.getItem('wab_hk_track') === '1'; } catch (_) { return false; } };
function setReqTrack(on) { try { localStorage.setItem('wab_hk_track', on ? '1' : '0'); } catch (_) {} if (!on && HK.lf.st === 'open') HK.lf.st = 'all'; }
function logFiltered(items) {
  const f = HK.lf, q = low(f.q).trim();
  return items.filter(i => (f.st === 'all' || i.st === f.st) && (!f.room || i.key === rk(f.room)) && (!f.cat || i.cats.some(c => c.id === f.cat) || (f.cat === 'other' && !i.cats.length))
    && (!q || low([i.room, i.what, i.x, i.s, i.g].join(' ')).includes(q)));
}
function logRows() {
  const f = HK.lf, day = f.day || today(), all = reqItems(day), L = logFiltered(all);
  const cnt = k => all.filter(i => k === 'all' || i.st === k).length;
  doc.querySelectorAll('#wabHk [data-wab-lst]').forEach(b => { const k = b.dataset.wabLst; b.classList.toggle('on', f.st === k); b.setAttribute('aria-pressed', f.st === k); const em = b.querySelector('em'); if (em) em.textContent = cnt(k); });
  const hist = f.room ? wbRoomHistory(all, f.room) : '';
  const body = doc.getElementById('wabLogBody'); if (!body) return;
  const track = reqTrack();
  body.innerHTML = (hist ? `<div class="wab-hist">🛏️ ${esc(hist)}</div>` : '') + (L.length ? `<div class="wab-tw"><table class="wab-log"><thead><tr><th>Time</th><th>Room</th><th>What</th><th>Message</th><th>Who</th><th>Status</th>${track ? '<th></th>' : ''}</tr></thead><tbody>${L.map(i => { const S = wbReqStatus(i, track); return `<tr class="${S.tone === 'over' ? 'wab-over' : ''}${i.st === 'done' ? ' wab-done' : ''}">
      <td class="num">${esc(t12(i.t))}</td><td class="num"><button type="button" class="wab-room" data-wab-lroom="${esc(i.room)}" title="Only this room">${esc(i.room)}</button>${W.hoRoom ? `<button type="button" class="rc-i" data-room-card="${esc(i.room)}" title="Room card ${esc(i.room)}" aria-label="Room card ${esc(i.room)}">i</button>` : ''}</td>
      <td>${i.cats.length ? i.cats.map(c => c.icon).join('') + ' ' : ''}${esc(i.what)}${i.again ? `<small>asked ${i.again + 1} times</small>` : ''}</td><td class="wab-lx">${esc(qMark(i.x || '', 140))}</td><td>${esc(i.s)}${i.g ? `<small>${esc(i.g)}</small>` : ''}</td>
      <td class="wab-st">${esc(S.text)}${S.sub || (track && i.how === 'chat') ? `<small>${esc(S.sub)}${track && i.how === 'chat' ? ' · in the chat' : ''}</small>` : ''}</td>
      ${track ? `<td>${i.st === 'done' ? `<button class="wab-b" type="button" data-wab-lopen="${esc(i.id)}">Reopen</button>` : `<button class="wab-b pri" type="button" data-wab-ldone="${esc(i.id)}">✓ Done</button>`}</td>` : ''}</tr>`; }).join('')}</tbody></table></div>`
    : `<div class="wab-empty">${all.length ? 'Nothing matches these filters.' : day === today() ? 'No room requests in the HK chat today yet. They show here by themselves — for every room, in-house or departing.' : 'No room requests on this day.'}</div>`);
}
async function logRender() {
  const root = doc.getElementById('wabHk'); if (!root) return;
  const f = HK.lf; if (!f.day) f.day = today();
  if (f.day !== today()) { await loadDays([f.day], 10 * 60e3).catch(() => {}); await reqLoad(f.day); } else reqListen();
  safe(() => {
    const cats = CATS.map(c => `<option value="${c[0]}"${f.cat === c[0] ? ' selected' : ''}>${c[2]} ${esc(c[1])}</option>`).join('');
    const track = reqTrack(); if (!track && f.st === 'open' && !f.stSet) f.st = 'all';
    root.innerHTML = `<div class="wab-sec"><h3>📋 Requests log</h3><p>${track ? 'Every room request from the HK chat — in-house or departing rooms. It turns ✅ by itself when someone writes done / cleaned / sent / ✓ for that room, or when you tap Done. Open for more than 30 min shows in red.'
        : 'A record of every room request sent to housekeeping in the HK chat. Housekeeping takes care of them — nothing to tick or follow up. It shows ✓ Done by HK by itself when they reply done / ✅.'}
        <label style="display:inline-flex;gap:6px;align-items:center;margin-left:6px;white-space:nowrap"><input type="checkbox" data-wab-track="1"${track ? ' checked' : ''}> Track requests</label></p>
      <div class="wab-bar"><div class="wab-per" role="group" aria-label="Status">${(track ? [['open', '🟡 Open'], ['done', '✅ Done'], ['all', 'All']] : [['all', 'All'], ['open', '📨 Sent to HK'], ['done', '✓ Done by HK']]).map(([k, l]) => `<button type="button" data-wab-lst="${k}" class="${f.st === k ? 'on' : ''}" aria-pressed="${f.st === k}">${l} <em>0</em></button>`).join('')}</div>
        <div class="wab-dl"><button class="btn gold sm" type="button" data-wab-ladd="1">＋ Add request</button><button class="btn sm" type="button" data-wab-ldl="xlsx">⬇ Excel</button><button class="btn sm" type="button" data-wab-ldl="csv">CSV</button></div></div>
      <div class="wab-lf"><input type="date" id="wabLDay" value="${esc(f.day)}" max="${esc(today())}" aria-label="Day"><input id="wabLRoom" inputmode="numeric" placeholder="Room" value="${esc(f.room)}" aria-label="Room"><select id="wabLCat" aria-label="What"><option value="">Everything</option>${cats}<option value="other"${f.cat === 'other' ? ' selected' : ''}>📝 Other</option></select><input id="wabLQ" type="search" placeholder="Search…" value="${esc(f.q)}" aria-label="Search"></div>
      ${HK.adding ? `<div class="wab-ladd"><b>Add a request (came by phone or at the desk)</b><div class="wab-lf"><input id="wabARoom" inputmode="numeric" maxlength="5" placeholder="Room *" aria-label="Room"><select id="wabACat" aria-label="What">${CATS.map(c => `<option value="${c[0]}">${c[2]} ${esc(c[1])}</option>`).join('')}<option value="">📝 Other</option></select><input id="wabANote" maxlength="200" placeholder="Note, e.g. 2 extra towels" aria-label="Note"></div><span class="wab-reasons"><button class="btn gold sm" type="button" data-wab-asave="1">Save</button><button class="btn ghost sm" type="button" data-wab-acancel="1">Cancel</button></span></div>` : ''}
      <div id="wabLogBody"></div></div>`;
    logRows();
  });
}
function logDownload(kind) {
  safe(() => {
    const day = HK.lf.day || today(), L = logFiltered(reqItems(day)).slice().reverse();
    const track = reqTrack();
    const rows = [['Date', 'Time', 'Room', 'What', 'Message', 'Who', 'Group', 'Status', 'Done at', 'Done by'].concat(track ? ['Open (min)'] : [])].concat(L.map(i => [dmy(day), t12(i.t), i.room, i.what, i.x, i.s, i.g, i.st === 'done' ? 'Done' : track ? 'Open' : 'Sent to HK', i.doneT ? t12(i.doneT) : '', i.doneBy].concat(track ? [i.open == null ? '' : i.open] : [])));
    exportRows({ 'Requests log': rows }, `HK requests log ${day}`, kind);
  });
}
function exportRows(sheets, name, kind) {
  if (kind === 'xlsx' && typeof XLSX !== 'undefined' && XLSX.utils) { const wb = XLSX.utils.book_new(); Object.keys(sheets).forEach(k => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheets[k]), k)); XLSX.writeFile(wb, name + '.xlsx'); return; }
  const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const body = '﻿' + Object.keys(sheets).map(k => (Object.keys(sheets).length > 1 ? [[k]] : []).concat(sheets[k]).map(r => r.map(q).join(',')).join('\r\n')).join('\r\n\r\n') + '\r\n';
  const url = URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8' }));
  const a = doc.createElement('a'); a.href = url; a.download = name + '.csv'; doc.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
  if (kind === 'xlsx') safe(() => showToast('Excel is not loaded (offline?) — saved as CSV instead', 'info'));
}
/** the compact "Open requests" card (Home and Ops Brain) */
function openReqCardHtml(max) {
  if (!reqTrack()) return '';                                                   // calm by default: no "open requests" card to chase
  const L = reqItems(today()).filter(i => i.st === 'open').sort((a, b) => (b.open || 0) - (a.open || 0));
  if (!L.length) return '';
  return `<div class="wab-oreq"><div class="wab-oreq-h"><b>🧺 Open requests · ${L.length}</b><button type="button" class="wab-b" data-wab-golog="1">Open the log ›</button></div>
    ${L.slice(0, max || 4).map(i => `<div class="wab-oreq-r${i.overdue ? ' over' : ''}"><span class="num">${esc(i.room)}</span><span class="wab-oreq-t">${esc(i.what)}<small>${esc(i.s)} · ${esc(t12(i.t))} · ⏱ ${esc(fmtOpen(i.open))}</small></span><button type="button" class="wab-b" data-wab-ldone="${esc(i.id)}">✓ Done</button></div>`).join('')}
    ${L.length > (max || 4) ? `<div class="wab-more">…and ${L.length - (max || 4)} more</div>` : ''}</div>`;
}
function paintHomeReq() {
  safe(() => {
    const hb = doc.getElementById('homeBrain'); if (!hb) return;
    let box = doc.getElementById('wabHomeReq');
    if (!box) { box = doc.createElement('div'); box.id = 'wabHomeReq'; hb.after(box); }
    const h = openReqCardHtml(4); if (box.innerHTML !== h) box.innerHTML = h;
  });
}
function goLog() { safe(() => { if (typeof brClose === 'function') brClose(); HK.tab = 'log'; HK.lf.st = 'open'; HK.lf.day = today(); if (typeof showPanel === 'function') showPanel(PANEL); hkRender(); }); }

function hkTabs() {
  const t = doc.getElementById('wabHkTabs'); if (!t) return;
  const n = waiting().length;
  const no = reqTrack() ? safe(() => reqItems(today()).filter(i => i.st === 'open').length, 0) : 0;
  t.innerHTML = [['log', '📋 Requests log' + (no ? ` <em>${no}</em>` : '')], ['req', '📊 Requests & moves'], ['words', '📖 WhatsApp words' + (n ? ` <em>${n}</em>` : '')]].map(([k, l]) => `<button type="button" role="tab" data-wab-tab="${k}" class="${HK.tab === k ? 'on' : ''}" aria-selected="${HK.tab === k}">${l}</button>`).join('');
}
function hkRender() {
  hkTabs();
  if (HK.tab === 'words') { wordsRender(); return Promise.resolve(); }
  if (HK.tab === 'log') return logRender();
  return hkRenderReq();
}
const WSORT = { co: 0, ext: 1, lco: 2, hk: 3, note: 4, ignore: 5 };
function wordsRender() {
  const root = doc.getElementById('wabHk'); if (!root || !WORDS) return;
  safe(() => {
    const keepQ = (doc.getElementById('wabWQ') || {}).value || '', keepT = (doc.getElementById('wabWTest') || {}).value || '315 VD\nVD: 402, 518\n201 ckod';
    const W8 = waiting(), all = WORDS.allWithOff(), ed = HK.edit ? WORDS.lookup(HK.edit) || all.find(e => e.key === HK.edit) : null;
    const opt = sel => Object.keys(MEANINGS).map(m => `<option value="${m}"${sel === m ? ' selected' : ''}>${esc(MEANINGS[m])}</option>`).join('');
    const when = at => at ? new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
    root.innerHTML = `
      ${W8.length ? `<div class="wab-sec"><h3>❓ Waiting for an answer</h3><p>Words the HK group used that HotelOps does not know yet. Your answer is saved for the whole team.</p><div class="wab-cards">${W8.map(q => `<div class="wab-rcard"><div><b>"${esc(q.word)}"</b>${q.room ? ` · room ${esc(q.room)}` : ''}<small>${esc(q.sender || 'HK')}: "${esc(qMark(q.text || '', 120))}"${q.guess ? ` · my guess: ${esc(MEAN[q.guess])}` : ''}</small></div>
        <div class="wab-reasons">${Object.keys(MEANINGS).map(m => `<button type="button" class="wab-b${m === q.guess ? ' pri' : ''}" data-wab-ans="${esc(q.word)}" data-m="${m}">${esc(MEANINGS[m])}</button>`).join('')}</div></div>`).join('')}</div></div>` : ''}
      <div class="wab-grid2">
        <div class="wab-sec"><h3>${ed ? '✏️ Change a word' : '➕ Add a word'}</h3><p>A word or code your colleagues type, and what it means. For example <b>VD</b> = Vacant Dirty → checked out.</p>
          <div class="wab-wform"><input id="wabWWord" maxlength="30" placeholder="Word, e.g. VD" value="${esc(ed ? ed.word : '')}" aria-label="Word"${ed ? ' readonly' : ''}>
            <select id="wabWMean" aria-label="Meaning">${opt(ed ? ed.m : 'co')}</select>
            <input id="wabWNote" maxlength="80" placeholder="What it stands for (optional), e.g. Vacant Dirty" value="${esc(ed ? ed.note || '' : '')}" aria-label="Note">
            <span class="wab-reasons"><button class="btn gold" type="button" data-wab-wadd="1">${ed ? 'Save' : 'Add'}</button>${ed ? '<button class="btn ghost" type="button" data-wab-wcancel="1">Cancel</button>' : ''}</span></div></div>
        <div class="wab-sec"><h3>🧪 Test a message</h3><p>Type a message the way HK writes it and see how HotelOps reads it.</p>
          <textarea id="wabWTest" rows="3" aria-label="Test a message">${esc(keepT)}</textarea><div class="wab-wout" id="wabWOut"></div></div>
      </div>
      <div class="wab-sec"><h3>📖 Words HotelOps knows (${all.filter(e => !e.off).length})</h3><p>Built-in housekeeping codes are ready from day one; change or turn them off if your team uses them differently. Words added here are shared with everyone at this hotel.${typeof W.hoWordsOpen === 'function' ? ' <a href="#" data-wab-allwords="1">See every built-in word →</a>' : ''}</p>
        <input id="wabWQ" type="search" placeholder="Search words…" value="${esc(keepQ)}" aria-label="Search words" class="wab-wq">
        <div class="wab-tw"><table><thead><tr><th>Word</th><th>Meaning</th><th>Stands for</th><th>Added by</th><th></th></tr></thead><tbody>
        ${all.slice().sort((a, b) => (WSORT[a.m] - WSORT[b.m]) || a.key.localeCompare(b.key)).map(e => `<tr data-wab-wk="${esc(e.key + ' ' + e.word + ' ' + (e.note || '') + ' ' + MEANINGS[e.m]).toLowerCase()}"${e.off ? ' style="opacity:.55"' : ''}><td class="num"><b>${esc(e.word)}</b></td><td>${esc(e.off ? 'Turned off' : MEANINGS[e.m])}</td><td>${esc(e.note || '')}</td>
          <td>${e.builtin && !e.changed && !e.off ? '<small style="color:var(--text3)">built-in</small>' : esc(e.by || '') + (e.at ? ` <small style="color:var(--text3)">${esc(when(e.at))}</small>` : '') + (e.builtin ? ' <small style="color:var(--text3)">· built-in, changed</small>' : '')}</td>
          <td style="white-space:nowrap">${e.off ? `<button class="wab-b" type="button" data-wab-wres="${esc(e.key)}">Turn back on</button>` : `<button class="wab-b" type="button" data-wab-wedit="${esc(e.key)}">Edit</button> <button class="wab-b" type="button" data-wab-wdel="${esc(e.key)}">${e.builtin ? 'Turn off' : 'Delete'}</button>${e.builtin && e.changed ? ` <button class="wab-b" type="button" data-wab-wres="${esc(e.key)}">Reset</button>` : ''}`}</td></tr>`).join('')}
        </tbody></table></div></div>`;
    wordsFilter(); wordsTest();
  });
}
function wordsFilter() { const q = low((doc.getElementById('wabWQ') || {}).value || '').trim(); doc.querySelectorAll('#wabHk [data-wab-wk]').forEach(tr => { tr.hidden = !!q && !tr.dataset.wabWk.includes(q); }); }
function wordsTest() { const t = doc.getElementById('wabWTest'), o = doc.getElementById('wabWOut'); if (!t || !o) return; const lines = String(t.value || '').split(/\n/).filter(x => x.trim()).slice(0, 12); o.innerHTML = lines.map(l => `<div><code>${esc(l)}</code><ul>${testMessage(l).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('') || '<small>Type a message above.</small>'; }
function wordsAdd() {
  const w = (doc.getElementById('wabWWord') || {}).value || '', m = (doc.getElementById('wabWMean') || {}).value || '', n = (doc.getElementById('wabWNote') || {}).value || '';
  if (!wbWordKey(w)) { safe(() => showToast('Type the word first', 'warn')); return; }
  if (/^\d+$/.test(wbWordKey(w))) { safe(() => showToast('A word, not a number (rooms are numbers)', 'warn')); return; }
  answerWord(w, m, n); HK.edit = ''; wordsRender(); hkTabs();
}
/** open the dictionary (the WhatsApp window's "📖 Words" button) */
W.hoWaWordsOpen = function (word) {
  safe(() => {
    if (typeof W.waClose === 'function') safe(() => W.waClose());
    if (typeof brClose === 'function') safe(() => brClose());
    HK.tab = 'words'; HK.edit = '';
    if (typeof showPanel === 'function') showPanel(PANEL);
    hkRender();
    if (word) setTimeout(() => safe(() => { const e = doc.getElementById('wabWWord'); if (e) { e.value = word; doc.getElementById('wabWMean').focus(); } }), 60);
  });
};
async function hkRenderReq() {
  const root = doc.getElementById('wabHk'); if (!root) return;
  const my = ++hkSeq, P = periodDays();
  const busy = P.days.concat(P.prev).some(d => !DAYS[d] && d !== today());
  if (busy) { const st = root.querySelector('#wabHkStatus'); if (st) st.textContent = 'Loading the chat backup…'; else root.innerHTML = hkBar(P) + '<div class="wab-sec"><div class="wab-empty" id="wabHkStatus">Loading the chat backup…</div></div>'; }
  await loadDays(P.days.concat(P.prev), 10 * 60e3).catch(() => {});
  if (my !== hkSeq) return;
  safe(() => {
    const L = listOf(P.days), Lp = listOf(P.prev), S = wbStats(L, parse), Sp = wbStats(Lp, parse);
    const moves = wbMoves(L), ms = wbMoveSummary(moves), pr = wbProblemRooms(L, moves), tips = wbTips(S, Sp, ms);
    HK.last = { P, L, S, Sp, moves, ms, pr };
    const reqTotal = Object.values(S.cats).reduce((a, b) => a + b, 0) || 1;
    const cats = topOf(S.cats, 40);
    const trend = id => { const a = Sp.cats[id] || 0, b = S.cats[id] || 0; if (!Sp.msgs) return '<span class="flat">—</span>'; if (b > a) return `<span class="up" title="${a} in the period before">↑ ${b - a}</span>`; if (b < a) return `<span class="down" title="${a} in the period before">↓ ${a - b}</span>`; return '<span class="flat">=</span>'; };
    const catRow = ([id, n]) => {
      const c = CAT[id] || { label: 'Other request', icon: '📝', q: '' }, ph = peakHour(S.catHours[id] || []), pct = Math.round(n * 100 / reqTotal);
      const tr = topOf(S.catRooms[id], 3).map(([k, v]) => `${esc(S.roomLbl[k] || k)}${v > 1 ? ` (${v})` : ''}`).join(', ');
      const open = HK.open === id;
      let html = `<tr class="wab-click" tabindex="0" data-wab-cat="${esc(id)}" aria-expanded="${open}"><td>${c.icon} ${esc(c.label)}${c.kind === 'maint' ? ' <small style="color:var(--text3)">· maintenance</small>' : ''}</td><td class="num">${n}</td>
        <td><div class="wab-share"><i style="width:${Math.max(3, Math.round(pct * 1.2))}px"></i><span>${pct}%</span></div></td><td class="num">${trend(id)}</td><td class="num">${ph >= 0 ? hourLbl(ph) : '—'}</td><td>${tr || '—'}</td></tr>`;
      if (open) {
        const msgs = (S.catMsgs[id] || []).slice().sort((a, b) => b.day.localeCompare(a.day) || (toMin(b.rec.t) || 0) - (toMin(a.rec.t) || 0));
        html += `<tr class="wab-msgs"><td colspan="6">${msgs.slice(0, 40).map(o => `<div class="wab-msg"><small>${esc(dmy(o.day))} ${esc(t12(o.rec.t))}</small><b>${esc(o.rec.s || '')}</b>: ${esc(String(o.rec.x).slice(0, 240))}</div>`).join('')}
          ${msgs.length > 40 ? `<div class="wab-msg"><small>…and ${msgs.length - 40} more</small></div>` : ''}<div class="br-acts" style="margin-top:8px"><button class="btn" type="button" data-wab-q="${esc(c.q || '')}" data-wab-r="${HK.per === 'today' ? 'today' : HK.per === '7' ? '7' : '30'}">💬 Open in WhatsApp search</button></div></td></tr>`;
      }
      return html;
    };
    const mvRows = moves.slice().reverse().slice(0, 60).map(m => `<tr><td class="num">${esc(dmy(m.day))} ${esc(t12(m.t))}</td><td class="num">${esc(m.from || '?')} → ${esc(m.to || '?')}</td><td>${esc(m.reason.label)}${m.reason.src === 'before' ? ' <small style="color:var(--text3)">(earlier message)</small>' : ''}</td><td>${esc(m.s || '')}</td></tr>`).join('');
    root.innerHTML = hkBar(P) + `
      <div class="wab-kpis"><div class="wab-kpi"><b>${S.msgs}</b><span>messages</span></div><div class="wab-kpi"><b>${S.reqs}</b><span>requests</span></div>
        <div class="wab-kpi"><b>${ms.total}</b><span>room moves</span></div><div class="wab-kpi"><b>${peakHour(S.byHour) >= 0 ? hourLbl(peakHour(S.byHour)) : '—'}</b><span>busiest hour</span></div></div>
      <div class="wab-sec"><h3>💡 Helpful tips</h3>${tips.length ? `<ul class="wab-tips">${tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : '<p>Not enough messages yet for tips. They show once the chat has a few days of requests.</p>'}</div>
      <div class="wab-sec"><h3>🧺 Most requested</h3><p>Tap a row to see the messages behind it. Trend compares with the ${P.days.length === 1 ? 'day' : P.days.length + ' days'} before.</p>
        ${cats.length ? `<div class="wab-tw"><table><thead><tr><th>What</th><th>Count</th><th>Share</th><th>Trend</th><th>Busiest</th><th>Top rooms</th></tr></thead><tbody>${cats.map(catRow).join('')}</tbody></table></div>` : '<div class="wab-empty">No requests in these days.</div>'}</div>
      <div class="wab-sec"><h3>🔀 Room moves</h3><p>From messages like "move 302 to 405" or "302 → 405". The reason comes from the same message, or from messages about the old room in the 2 hours before.</p>
        ${moves.length ? `<div class="wab-tw"><table><thead><tr><th>When</th><th>From → to</th><th>Reason</th><th>Who</th></tr></thead><tbody>${mvRows}</tbody></table></div>` : '<div class="wab-empty">No room moves in these days.</div>'}
        ${ms.reasons.length ? `<h3 style="margin-top:14px">Why rooms move</h3><div class="wab-reasons">${ms.reasons.map(r => `<span>${esc(r.label)} · ${r.n}</span>`).join('')}</div>` : ''}
        ${ms.repeat.length ? `<h3 style="margin-top:14px">Rooms that keep causing moves</h3><div class="wab-cards">${ms.repeat.map(r => `<div class="wab-rcard"><div><b>Room ${esc(r.room)}: ${plural(r.n, 'move')}</b> — ${r.why.map(w => `${esc(w.label)} (${w.n})`).join(', ')}<small>${esc(r.tip)}</small></div>
          ${r.maint ? `<button class="btn" type="button" data-wab-ticket="${esc(r.room)}" data-wab-prob="${esc((r.top && r.top.label) || '')} — ${r.n} room moves (HK chat)">🔧 Log a maintenance ticket</button>` : ''}</div>`).join('')}</div>` : ''}</div>
      <div class="wab-sec"><h3>🛠 Problem rooms</h3><p>Rooms ranked by maintenance mentions and moves out of them.</p>
        ${pr.length ? `<div class="wab-tw"><table><thead><tr><th>Room</th><th>Issues</th><th>Moves</th><th>Top problems</th><th>Last</th><th></th></tr></thead><tbody>${pr.slice(0, 20).map(o => `<tr><td class="num"><b>${esc(o.room)}</b></td><td class="num">${o.issues}</td><td class="num">${o.moves}</td><td>${o.top.map(([l, n]) => `${esc(l)}${n > 1 ? ` (${n})` : ''}`).join(', ') || '—'}</td><td class="num">${esc(dmy(o.last))}</td>
          <td><button class="btn sm" type="button" data-wab-q="${esc(o.room)}" data-wab-r="30" title="Open in WhatsApp search">💬</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="wab-empty">No maintenance problems in these days. 👌</div>'}</div>`;
  });
}
function hkBar(P) {
  return `<div class="wab-bar"><div class="wab-per" role="group" aria-label="Which days">${Object.keys(PER_LBL).map(k => `<button type="button" data-wab-per="${k}" class="${HK.per === k ? 'on' : ''}" aria-pressed="${HK.per === k}">${PER_LBL[k]}</button>`).join('')}</div>
    ${HK.per === 'pick' ? `<div class="wab-dates"><input type="date" id="wabFrom" value="${esc(P.from)}" aria-label="From"><span>to</span><input type="date" id="wabTo" value="${esc(P.to)}" aria-label="To"></div>` : ''}
    <div class="wab-dl"><button class="btn sm" type="button" data-wab-dl="xlsx">⬇ Excel</button><button class="btn sm" type="button" data-wab-dl="csv">CSV</button></div></div>
    <div style="font-size:12.5px;color:var(--text3)">${P.from === P.to ? esc(fmtDay(P.from)) : esc(dmy(P.from)) + ' to ' + esc(dmy(P.to))} · from the WhatsApp HK group backup</div>`;
}
function hkDownload(kind) {
  safe(() => {
    const H = HK.last; if (!H) return;
    const reqTotal = Object.values(H.S.cats).reduce((a, b) => a + b, 0) || 1;
    const sheets = {
      'Most requested': [['What', 'Count', 'Share %', 'Period before', 'Busiest hour', 'Top rooms']].concat(topOf(H.S.cats, 40).map(([id, n]) => [(CAT[id] || { label: 'Other request' }).label, n, Math.round(n * 100 / reqTotal), H.Sp.cats[id] || 0, peakHour(H.S.catHours[id] || []) >= 0 ? hourLbl(peakHour(H.S.catHours[id])) : '', topOf(H.S.catRooms[id], 3).map(([k, v]) => (H.S.roomLbl[k] || k) + ' (' + v + ')').join(', ')])),
      'Room moves': [['Date', 'Time', 'From', 'To', 'Reason', 'Who', 'Message']].concat(H.moves.map(m => [dmy(m.day), t12(m.t), m.from, m.to, m.reason.label, m.s || '', m.x])),
      'Problem rooms': [['Room', 'Issues', 'Moves', 'Top problems', 'Last']].concat(H.pr.map(o => [o.room, o.issues, o.moves, o.top.map(([l, n]) => l + ' (' + n + ')').join(', '), dmy(o.last)])),
    };
    const name = `HK requests ${H.P.from}${H.P.from === H.P.to ? '' : ' to ' + H.P.to}`;
    if (kind === 'xlsx' && typeof XLSX !== 'undefined' && XLSX.utils) {
      const wb = XLSX.utils.book_new(); Object.keys(sheets).forEach(k => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheets[k]), k)); XLSX.writeFile(wb, name + '.xlsx'); return;
    }
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const body = '\ufeff' + Object.keys(sheets).map(k => [[k]].concat(sheets[k]).map(r => r.map(q).join(',')).join('\r\n')).join('\r\n\r\n') + '\r\n';
    const url = URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8' }));
    const a = doc.createElement('a'); a.href = url; a.download = name + '.csv'; doc.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
    if (kind === 'xlsx') safe(() => showToast('Excel is not loaded (offline?) — saved as CSV instead', 'info'));
  });
}
function mountPage() {
  if (doc.getElementById('panel-' + PANEL)) return true;
  const main = doc.querySelector('main.main') || doc.querySelector('main'), nav = doc.querySelector('nav.sidenav') || doc.querySelector('nav');
  if (!main || !nav) return false;
  const st = doc.createElement('style'); st.id = 'wab-page-style'; st.textContent = PCSS; doc.head.appendChild(st);
  const panel = doc.createElement('div'); panel.className = 'panel'; panel.id = 'panel-' + PANEL;
  panel.innerHTML = `<div class="page-hd"><div class="page-hd-left"><h1>🧺 HK Requests</h1><p>What housekeeping is asked for most, why rooms move and which rooms keep having problems — learned from the WhatsApp HK group.</p></div></div><div class="wab-tabs" id="wabHkTabs" role="tablist"></div><div class="wab-pg" id="wabHk"></div>`;
  main.appendChild(panel);
  panel.addEventListener('click', e => safe(() => {
    const ls = e.target.closest('[data-wab-lst]'); if (ls) { HK.lf.st = ls.dataset.wabLst; HK.lf.stSet = true; logRows(); return; }
    const tr = e.target.closest('[data-wab-track]'); if (tr) { setReqTrack(tr.checked); HK.lf.stSet = false; logRender(); safe(() => { hkTabs(); paintHomeReq(); }); return; }
    const lr = e.target.closest('[data-wab-lroom]'); if (lr) { HK.lf.room = HK.lf.room === lr.dataset.wabLroom ? '' : lr.dataset.wabLroom; const i = doc.getElementById('wabLRoom'); if (i) i.value = HK.lf.room; logRows(); return; }
    if (e.target.closest('[data-wab-ladd]')) { HK.adding = !HK.adding; logRender().then(() => { const r = doc.getElementById('wabARoom'); if (r) r.focus(); }); return; }
    if (e.target.closest('[data-wab-acancel]')) { HK.adding = false; logRender(); return; }
    if (e.target.closest('[data-wab-asave]')) { const room = (doc.getElementById('wabARoom') || {}).value || '', c = (doc.getElementById('wabACat') || {}).value || '', n = (doc.getElementById('wabANote') || {}).value || ''; if (!/^\d{2,5}$/.test(room.trim())) { safe(() => showToast('Write the room number', 'warn')); return; } reqAdd(room, c, CAT[c] ? CAT[c].label : (n || 'Request'), n); HK.adding = false; logRender(); hkTabs(); return; }
    const ldl = e.target.closest('[data-wab-ldl]'); if (ldl) { logDownload(ldl.dataset.wabLdl); return; }
    const tb = e.target.closest('[data-wab-tab]'); if (tb) { HK.tab = tb.dataset.wabTab; hkRender(); return; }
    const an = e.target.closest('[data-wab-ans]'); if (an) { answerWord(an.dataset.wabAns, an.dataset.m); setTimeout(() => { wordsRender(); hkTabs(); }, 50); return; }
    if (e.target.closest('[data-wab-allwords]')) { e.preventDefault(); if (typeof W.hoWordsOpen === 'function') W.hoWordsOpen('wa'); return; }
    if (e.target.closest('[data-wab-wadd]')) { wordsAdd(); return; }
    if (e.target.closest('[data-wab-wcancel]')) { HK.edit = ''; wordsRender(); return; }
    const we = e.target.closest('[data-wab-wedit]'); if (we) { HK.edit = we.dataset.wabWedit; wordsRender(); const x = doc.getElementById('wabWMean'); if (x) x.focus(); return; }
    const wd = e.target.closest('[data-wab-wdel]'); if (wd) { const k = wd.dataset.wabWdel, b = BUILTIN_WORDS[k]; if (confirm(b ? `Turn off the built-in word "${k.toUpperCase()}"?` : `Delete the word "${k}" for everyone?`)) { WORDS.remove(k); wordsRender(); } return; }
    const wr = e.target.closest('[data-wab-wres]'); if (wr) { WORDS.restore(wr.dataset.wabWres); wordsRender(); return; }
    const per = e.target.closest('[data-wab-per]'); if (per) { HK.per = per.dataset.wabPer; HK.open = ''; try { localStorage.setItem('wab_hk_per', HK.per); } catch (_) {} hkRender(); return; }
    const dl = e.target.closest('[data-wab-dl]'); if (dl) { hkDownload(dl.dataset.wabDl); return; }
    const tk = e.target.closest('[data-wab-ticket]'); if (tk) { logTicket(tk.dataset.wabTicket, tk.dataset.wabProb || ''); return; }
    const row = e.target.closest('[data-wab-cat]'); if (row) { HK.open = HK.open === row.dataset.wabCat ? '' : row.dataset.wabCat; hkRender(); }
  }));
  panel.addEventListener('keydown', e => { const row = e.target.closest && e.target.closest('[data-wab-cat]'); if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); row.click(); } });
  panel.addEventListener('input', e => { if (e.target.id === 'wabLRoom') { HK.lf.room = e.target.value.trim(); logRows(); } if (e.target.id === 'wabLQ') { HK.lf.q = e.target.value; logRows(); } if (e.target.id === 'wabWQ') wordsFilter(); if (e.target.id === 'wabWTest') { clearTimeout(wordsTest._t); wordsTest._t = setTimeout(wordsTest, 200); } });
  panel.addEventListener('keydown', e => { if (e.key === 'Enter' && /^wabW(Word|Note)$/.test(e.target.id)) { e.preventDefault(); wordsAdd(); } });
  panel.addEventListener('change', e => { if (e.target.id === 'wabLCat') { HK.lf.cat = e.target.value; logRows(); } if (e.target.id === 'wabLDay') { HK.lf.day = e.target.value || today(); logRender(); } });
  panel.addEventListener('change', e => { if (e.target.id === 'wabFrom') HK.from = e.target.value; if (e.target.id === 'wabTo') HK.to = e.target.value; if (/^wab(From|To)$/.test(e.target.id)) hkRender(); });
  const item = doc.createElement('div');
  item.className = 'nav-item'; item.id = 'nav-' + PANEL; item.dataset.panel = PANEL; item.setAttribute('onclick', "showPanel('" + PANEL + "')");
  item.innerHTML = '<div class="nav-icon">🧺</div>HK Requests';
  const anchor = doc.getElementById('nav-ops-logs') || doc.getElementById('nav-shifts');
  if (anchor && anchor.parentNode) anchor.after(item); else nav.appendChild(item);
  const grid = doc.querySelector('.mob-more-grid');
  if (grid) {
    const b = doc.createElement('button'); b.className = 'mob-more-item'; b.dataset.panel = PANEL; b.type = 'button';
    b.setAttribute('onclick', "showPanel('" + PANEL + "');(typeof closeMobMore==='function'?closeMobMore:typeof toggleMobMore==='function'?toggleMobMore:function(){})()");
    b.innerHTML = '<span class="mob-item-icon">🧺</span>HK Requests';
    const after = grid.querySelector('.mob-more-item[data-panel="ops-logs"]') || grid.querySelector('.mob-more-item[data-panel="shifts"]');
    if (after) after.after(b); else grid.appendChild(b);
  }
  if (typeof hoApplyIcons === 'function') safe(() => hoApplyIcons());
  safe(() => {
    if (typeof ROLES !== 'undefined') Object.keys(ROLES).forEach(r => { const p = ROLES[r] && ROLES[r].panels; if (p && p.includes('shifts') && !p.includes(PANEL)) p.push(PANEL); });
    if (typeof currentProfile !== 'undefined' && currentProfile && typeof applyRole === 'function') applyRole(currentProfile.role);
  });
  let wasOn = false;
  new MutationObserver(() => { const on = panel.classList.contains('active'); if (on && !wasOn) hkRender(); wasOn = on; }).observe(panel, { attributes: true, attributeFilter: ['class'] });
  return true;
}

// ── start ──
function onDocClick(e) {
  safe(() => {
    const q = e.target.closest && e.target.closest('[data-wab-q]');
    if (q) { e.preventDefault(); waSearchOpen(q.dataset.wabQ, q.dataset.wabR || '30'); return; }
    const ld = e.target.closest && e.target.closest('[data-wab-ldone]'); if (ld) { e.preventDefault(); reqSet(HK.tab === 'log' && doc.getElementById('panel-' + PANEL)?.contains(ld) ? (HK.lf.day || today()) : today(), ld.dataset.wabLdone, 'done'); setTimeout(() => { if (doc.getElementById('wabLogBody')) logRows(); hkTabs(); paintHomeReq(); const b = doc.getElementById('wabPins'); if (b) b.innerHTML = pinsHtml(); }, 30); return; }
    const lo = e.target.closest && e.target.closest('[data-wab-lopen]'); if (lo) { e.preventDefault(); reqSet(HK.lf.day || today(), lo.dataset.wabLopen, 'open'); setTimeout(() => { logRows(); hkTabs(); paintHomeReq(); }, 30); return; }
    if (e.target.closest && e.target.closest('[data-wab-golog]')) { e.preventDefault(); goLog(); return; }
    const chip = e.target.closest && e.target.closest('.wab-chip');
    if (chip) { e.preventDefault(); e.stopPropagation(); const card = chip.closest('.dep-card'); if (card) waSearchOpen(card.dataset.room, 'today'); return; }
    const a = e.target.closest && e.target.closest('[data-wab-act]');
    if (a) { const x = PIN_ACTS[+a.dataset.wabAct]; if (!x) return; if (x[1]) x[1](); else waSearchOpen(x[2], 'today'); setTimeout(() => { const b = doc.getElementById('wabPins'); if (b) b.innerHTML = pinsHtml(); }, 60); }
  });
}
function start() {
  safe(() => { const st = doc.createElement('style'); st.id = 'wab-style'; st.textContent = CSS; doc.head.appendChild(st); });
  doc.addEventListener('click', onDocClick, true);
  safe(mountPage);
  if (typeof fbListen === 'function') {
    safe(() => fbListen('waWords', v => { if (WORDS) WORDS.setRemote(v || {}); }));
    safe(() => fbListen('waAsk', v => { FBASK = v && typeof v === 'object' ? v : {}; softRefresh(); }));
  }
  const hook = () => { wrapRender(); wrapHandover(); wrapTabs(); wrapAsk(); wrapHome(); };
  [600, 2000, 4500, 8000].forEach(t => setTimeout(() => safe(hook), t));
  const bo = W.brOpen;
  if (typeof bo === 'function' && !bo.__wab) { W.brOpen = function () { safe(hook); const r = bo.apply(this, arguments); ensure30(); setTimeout(() => extendPanel(), 30); return r; }; W.brOpen.__wab = true; }
  // new messages: watch the bridge's log (cheap), think every minute
  let msgT = 0;
  doc.addEventListener('ho-wa-msg', () => { clearTimeout(msgT); msgT = setTimeout(() => safe(() => { lastLogSig = ''; compute(true); paintChips(); scanAsk(); }), 150); });
  setInterval(() => safe(() => {
    const L = logEntries(), sig = L.length + '|' + ((L[0] || {}).key || '') + '|' + ((L[0] || {}).undone ? 1 : 0);
    if (sig !== lastLogSig) { lastLogSig = sig; compute(true); paintChips(); scanAsk(); if (typeof blSoon === 'function') safe(() => blSoon()); }
  }), 5000);
  setInterval(tick, 60e3);
  setTimeout(tick, 6000);
  setTimeout(() => ensure30(), 8000);
  // for the Handover Book's "From HotelOps today"
  W.hoWaBrain = Object.assign(W.hoWaBrain || {}, { openRequests: () => safe(() => reqItems(today()).filter(i => i.st === 'open'), []),
    // for the room card (room-card.js): a day's requests, how each one shows, and "+ Add request" from the card
    requests: day => safe(() => reqItems(day || today()), []), requestStatus: it => wbReqStatus(it, reqTrack()), addRequest: (room, cat, what, note) => safe(() => reqAdd(room, cat, what, note)) });
  setInterval(() => { if (Object.keys(DAYS).length) loadDays([today()]).then(ch => { if (ch) softRefresh(); }).catch(() => {}); }, 3 * 60e3);
}
if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
})();
