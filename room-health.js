// ═══════════════════════════════════════════════════════════
//  room-health.js — 🩺 Room Health
//
//  The problems that keep happening in rooms (AC, leaks, smells, bugs,
//  Wi-Fi, noise…) gathered from everything the app already reads, and a
//  clear "send Engineering / HK / IT / Security to room X" for each one:
//
//   • Sources: WhatsApp (today's log + the hotel's backup waChat/{date}),
//     HK requests added by hand, the Handover Book, Front Office Log
//     maintenance tickets, room notes. Messages HotelOps sent itself are
//     never read back as a problem.
//   • A pure classifier turns each text into room issues
//     {room, kind, dept, severity, text, at, source}, with typos ("leeking",
//     "tolet", "wifi not wrking"), negations ("AC working now", "no issue")
//     and done / fixed replies (also "Done ✅" quoting the message) closing
//     an issue. Kinds, departments and words are editable per hotel.
//   • Advice, best first: an arrival today into a room with an open problem,
//     repeat problems (same kind ≥2× in 7 days or ≥3× in 30 days), VIP and
//     long-stay guests, rooms vacant now (best time to fix), severity.
//   • One tap: a short WhatsApp message to the department's group through
//     the WhatsApp reader (copy + the WhatsApp window when it isn't linked),
//     a room note and a handover item for the next shift, "sent at / by",
//     ✓ Fixed. One calm follow-up only for a high-severity problem with no
//     fix reply after N hours.
//   • Problem rooms (30 / 90 days), Ops Brain tips and answers ("problem
//     rooms", "what to send engineering", "issues in 512"), a Health section
//     on the room card (window.hoRoomHealth.cardHtml).
//
//  Stored per hotel: roomHealth/cfg (departments, kinds, thresholds,
//  nudges) and roomHealth/acts/{id} ({sent:{at,by,dept,via,group}, fixedAt,
//  fixedBy, followed}). The module adds its own panel, menu items and
//  styles: index.html only needs <script src="room-health.js"></script>.
//  Pure helpers: window.hoRoomHealthPure (tested in tests/run-tests.js).
// ═══════════════════════════════════════════════════════════
(function () {
'use strict';
const W = typeof window !== 'undefined' ? window : globalThis;
const doc = typeof document !== 'undefined' && document && document.createElement ? document : null;

// ══ Small pure helpers ══════════════════════════════════════
const pad = n => String(n).padStart(2, '0');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayOf = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const isIso = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return dayOf(new Date(y, m - 1, d + n, 12).getTime()); };
const fmtD = s => (isIso(s) ? +s.slice(8, 10) + ' ' + MON[+s.slice(5, 7) - 1] : String(s || ''));
/** ms of "HH:MM" on a day (local) */
function atOf(day, hhmm) {
  if (!isIso(day)) return null;
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/), [y, mo, d] = day.split('-').map(Number);
  return new Date(y, mo - 1, d, m ? +m[1] : 0, m ? +m[2] : 0).getTime();
}
const hm = ms => { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sp = s => String(s == null ? '' : s).replace(/[   ]/g, ' ').replace(/[‎‏⁦-⁩]/g, '');
/** "0113", "rm 113" → "113" ('' when there is no room number) */
const rk = r => { const m = String(r == null ? '' : r).match(/\d{3,4}/); return m && parseInt(m[0], 10) >= 100 ? String(parseInt(m[0], 10)) : ''; };
const floorOf = r => { const n = parseInt(rk(r), 10); return n >= 100 ? Math.floor(n / 100) : null; };
const SEV = { low: 1, med: 2, high: 3 };
const sevMax = (a, b) => ((SEV[a] || 0) >= (SEV[b] || 0) ? a : b);
const bump = s => (s === 'low' ? 'med' : 'high');
/** messages HotelOps wrote itself (the invisible mark, our signature, our notes) */
const isOurs = t => { t = String(t || ''); return t.indexOf('⁣') >= 0 || /—\s*HotelOps\s*$/.test(t.trim()) || /^\s*🩺/u.test(t) || /^[\s⁣]*✅\s*HotelOps\b/u.test(t); };

/** room numbers in a text, as written: "324", "rm 0113", "#503" (not times, prices, nights, years) */
function roomsIn(text) {
  const t = sp(text), out = [];
  const re = /(?:\b(?:rooms?|rms?|rn)\.?\s*(?:no\.?\s*)?|#\s*)?(?<![\d:.,\/+\-])\b(\d{3,4})\b(?![:.,\/]\d)(?!\s*(?:am|pm|a\.m|p\.m|hrs?|aed|dhs?|dirhams?|nights?|n\b|nts?\b|%|pax|mins?\b|minutes|kg|ml|degrees?|°))/gi;
  let m;
  while ((m = re.exec(t))) {
    const before = t.slice(Math.max(0, m.index - 12), m.index).toLowerCase();
    if (/(?:aed|dhs?|ext\.?|tel|lco|late|till|until|untill|at|by|around|@)\s*$/.test(before) && !/(?:rooms?|rms?|#)\s*$/.test(before)) continue;
    const n = +m[1]; if (n < 100) continue;
    if (n >= 1900 && n <= 2100 && /\b(?:in|of|year|since)\s*$/.test(before)) continue;
    if (!out.some(x => rk(x) === rk(m[1]))) out.push(m[1]);
  }
  return out;
}

// ══ Words: normalising, typos, fuzzy matching ═══════════════
const TYPO = {
  toliet: 'toilet', tiolet: 'toilet', tolet: 'toilet', toilette: 'toilet', toilt: 'toilet', wify: 'wifi', wfi: 'wifi', wiifi: 'wifi', airco: 'aircon', acc: 'ac',
  nt: 'not', nott: 'not', noot: 'not', notworking: 'not working', wrking: 'working', wroking: 'working', workin: 'working', wrkng: 'working', workng: 'working', wrkn: 'working', wokring: 'working',
  smel: 'smell', smeel: 'smell', smelling: 'smelling', leek: 'leak', leeks: 'leaks', bloked: 'blocked', blockd: 'blocked', blocket: 'blocked', cleen: 'clean', coolng: 'cooling', coolin: 'cooling',
  plz: 'please', pls: 'please', plez: 'please', pse: 'please', thx: 'thanks', isnt: 'is not', doesnt: 'does not', dont: 'do not', cant: 'can not', cannot: 'can not', wont: 'will not',
  didnt: 'did not', hasnt: 'has not', havent: 'have not', arent: 'are not', wasnt: 'was not', aint: 'is not', werent: 'were not', fixd: 'fixed', fxd: 'fixed', repaird: 'repaired',
  aircondition: 'air conditioning', airconditioner: 'air conditioner', airconditioning: 'air conditioning', cockroch: 'cockroach', cockrach: 'cockroach', mosquitos: 'mosquitoes',
  odur: 'odour', deodorized: 'deodorised', deodorize: 'deodorise', ok: 'ok', okk: 'ok', okey: 'okay', tmrw: 'tomorrow', rm: 'room', bcz: 'because', coz: 'because',
};
/** text → plain lower-case words, typos fixed ("A/C nt wrking!!" → ["ac","not","working"]) */
function words(text) {
  let t = sp(text).toLowerCase()
    .replace(/[✅✔☑]️?/gu, ' done ')
    .replace(/[’'`´]/g, '')
    .replace(/\ba\s*[\/.]\s*c\b\.?/g, ' ac ').replace(/\bt\s*\.\s*v\b\.?/g, ' tv ').replace(/\bwi\s*-?\s*fi\b/g, ' wifi ')
    .replace(/[^a-z0-9؀-ۿ]+/g, ' ').trim();
  if (!t) return [];
  const out = [];
  t.split(/\s+/).forEach(w => { const x = TYPO[w]; if (x) x.split(' ').forEach(y => out.push(y)); else out.push(w); });
  return out;
}
/** "cooliing" → "coling": doubled letters say nothing about the word */
const squash = w => w.replace(/(.)\1+/g, '$1');
function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let best = i;
    for (let j = 1; j <= b.length; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); best = Math.min(best, cur[j]); }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
/** a word of the text ≈ a word of a phrase: the same, or one typo away for long words (same first letter) */
function eqW(t, k) {
  if (t === k.s) return true;
  if (k.n < 7 || t.length < 5 || t[0] !== k.s[0]) return false;
  return lev(t, k.s, k.n >= 10 ? 2 : 1) <= (k.n >= 10 ? 2 : 1);
}
const phrase = p => words(p).map(w => ({ s: squash(w), n: w.length }));
/** where a phrase is in the words: [[start, end]] (its words in order, at most 2 other words between) */
function spans(ws, ph) {
  const out = []; if (!ph.length) return out;
  for (let i = 0; i < ws.length; i++) {
    if (!eqW(ws[i], ph[0])) continue;
    let j = i, ok = true;
    for (let k = 1; k < ph.length; k++) {
      let f = -1;
      for (let x = j + 1; x <= Math.min(ws.length - 1, j + 3); x++) if (eqW(ws[x], ph[k])) { f = x; break; }
      if (f < 0) { ok = false; break; }
      j = f;
    }
    if (ok) out.push([i, j]);
  }
  return out;
}
const hasAny = (ws, list) => { const w = ws.map(squash); return list.some(ph => spans(w, ph).length > 0); };

// ══ Departments and kinds (the hotel can change words, groups, add new ones) ══
const DEFAULT_DEPTS = [
  { id: 'eng', name: 'Engineering', short: 'Engineering', emoji: '🔧', group: '' },
  { id: 'it', name: 'IT', short: 'IT', emoji: '💻', group: '' },
  { id: 'hk', name: 'Housekeeping', short: 'HK', emoji: '🧹', group: '' },
  { id: 'sec', name: 'Security', short: 'Security', emoji: '🛡️', group: '' },
];
// kw: comma list; "~word" is weak (it counts only when nothing stronger is found, and with a problem word).
// not: phrases that are something else ("toilet paper"). need: a word that must be there too.
// soft: words that make the problem one level less serious ("bulb" for power / lights).
const DEFAULT_KINDS = [
  { id: 'ac', noun: 'AC problems', label: 'AC / cooling', emoji: '❄️', dept: 'eng', sev: 'med', say: 'AC not cooling', verb: 'check the AC',
    kw: 'ac, aircon, air con, air conditioning, air conditioner, thermostat, room is hot, room hot, room too hot, room very hot, ~cooling, ~not cold, ~too hot, ~very hot, ~heating, ~too cold, ~freezing, ~temperature' },
  { id: 'leak', noun: 'a leak', label: 'Water leak / drip', emoji: '💧', dept: 'eng', sev: 'high', say: 'water leak', verb: 'fix the leak',
    kw: 'leak, leaking, leakage, leaks, drip, dripping, drips, water on the floor, water on floor, flooding, flooded, flood, seepage, seeping, ceiling wet, wet ceiling, wet carpet, water coming from' },
  { id: 'hotwater', noun: 'hot water problems', label: 'No hot water / pressure', emoji: '🚿', dept: 'eng', sev: 'high', say: 'no hot water', verb: 'check the water',
    kw: 'no hot water, water pressure, low pressure, pressure is low, no water, water not coming, cold water only, only cold water, water heater, geyser, boiler, ~hot water' },
  { id: 'plumb', noun: 'toilet / drain problems', label: 'Toilet / drain / blocked', emoji: '🚽', dept: 'eng', sev: 'med', say: 'toilet / drain problem', verb: 'check the plumbing',
    kw: '~toilet, wc, blocked, blockage, clogged, clog, drain, drainage, flush, flushing, ~sink, ~basin, overflow, overflowing, bidet, health faucet, shattaf, ~tap, ~faucet, shower head, shower not, sewage',
    not: 'toilet paper, toilet roll, toilet rolls, toilet tissue, toilet kit' },
  { id: 'elec', noun: 'power / light problems', label: 'Power / lights', emoji: '💡', dept: 'eng', sev: 'high', say: 'power / light problem', verb: 'check the power',
    kw: 'power, no power, power cut, electricity, electric, electrical, ~light, ~lights, bulb, bulbs, lamp, socket, sockets, ~plug, ~switch, fuse, tripped, short circuit, sparks, sparking, blackout, smoke detector, smoke alarm, fire alarm, beeping',
    not: 'power bank', soft: 'bulb, bulbs, lamp, light, lights, beeping, smoke detector, smoke alarm' },
  { id: 'tv', noun: 'TV problems', label: 'TV / remote', emoji: '📺', dept: 'eng', sev: 'low', say: 'TV / remote not working', verb: 'check the TV',
    kw: 'tv, television, remote, channels, channel, no signal, hdmi, chromecast, netflix, smart tv' },
  { id: 'lock', noun: 'lock / key card problems', label: 'Door lock / key card / safe', emoji: '🔐', dept: 'eng', sev: 'high', say: 'door lock / key card problem', verb: 'check the lock',
    kw: 'door lock, key card, keycard, card key, key not working, card not working, can not open the door, can not open door, door not opening, door not closing, door stuck, door handle, door closer, deadbolt, safe box, safe locked, safe not, electronic safe, locked out, ~lock, ~locked, ~safe, ~door, ~key, ~keys',
    not: 'double lock, double locked, dbl lock, do not disturb' },
  { id: 'fridge', noun: 'fridge problems', label: 'Fridge / minibar', emoji: '🧊', dept: 'eng', sev: 'low', say: 'fridge not cooling', verb: 'check the fridge',
    kw: 'fridge not cooling, fridge not cold, minibar not cooling, minibar not cold, fridge not working, ~fridge, ~refrigerator, ~minibar, ~mini bar, ~chiller' },
  { id: 'window', noun: 'window / curtain problems', label: 'Window / curtain', emoji: '🪟', dept: 'eng', sev: 'low', say: 'window / curtain problem', verb: 'check it',
    kw: 'curtain motor, ~window, ~windows, ~curtain, ~curtains, ~blinds, ~balcony door, ~sliding door, ~blackout curtain' },
  { id: 'machnoise', noun: 'machine noise', label: 'Noise from machines', emoji: '⚙️', dept: 'eng', sev: 'med', say: 'machine noise', verb: 'check the noise',
    kw: 'ac noise, ac making noise, ac is noisy, ac noisy, noisy ac, noise from ac, noise from the ac, fan noise, noise from fan, noisy fan, buzzing, humming, vibration, vibrating, rattling, machine noise, motor noise, pump noise, generator noise, dripping sound, fridge noise, noisy fridge, fridge making noise' },
  { id: 'repair', noun: 'repairs', label: 'Other repair', emoji: '🔧', dept: 'eng', sev: 'med', say: 'something broken', verb: 'check it', fallback: true,
    kw: '~broken, ~not working, ~damaged, ~repair, ~fix, ~maintenance, ~technician, ~engineering, ~faulty, ~out of order' },
  { id: 'wifi', noun: 'Wi-Fi problems', label: 'Wi-Fi / internet', emoji: '📶', dept: 'it', sev: 'med', say: 'Wi-Fi not working', verb: 'check the Wi-Fi',
    kw: 'wifi, internet, wireless, network, no connection, can not connect, router, lan cable, ethernet, ~connection' },
  { id: 'smell', noun: 'a bad smell', label: 'Smell / odour', emoji: '👃', dept: 'hk', sev: 'med', say: 'bad smell', verb: 'deodorise', ask: 'Please deodorise',
    kw: 'smell, smells, smelly, smelling, odour, odor, stink, stinks, stinking, stinky, musty, damp smell, bad smell, smoke smell, cigarette smell' },
  { id: 'pest', noun: 'pests', label: 'Bugs / pests', emoji: '🪳', dept: 'hk', sev: 'high', say: 'bugs / pests', verb: 'arrange pest control', ask: 'Please inform the HK supervisor and arrange pest control',
    kw: 'cockroach, cockroaches, roach, roaches, bug, bugs, bed bug, bed bugs, bedbugs, insect, insects, ants, ant, mosquito, mosquitoes, pest, pests, pest control, rat, rats, mouse, mice, lizard, flies, spider, spiders, termites, ~fly' },
  { id: 'stain', noun: 'stains', label: 'Stains / dirty', emoji: '🧽', dept: 'hk', sev: 'med', say: 'stains', verb: 'clean it', ask: 'Please clean it',
    kw: 'stain, stains, stained, mould, mold, mouldy, moldy, blood, hair in, hair on, hairs, dusty, vomit, urine, ~dust, ~marks, ~mess' },
  { id: 'linen', noun: 'linen problems', label: 'Linen / towels', emoji: '🛏️', dept: 'hk', sev: 'low', say: 'linen / towels problem', verb: 'change the linen', ask: 'Please change the linen',
    kw: 'dirty towel, dirty towels, dirty linen, dirty sheets, dirty bedsheet, dirty bed sheet, towels dirty, sheets dirty, stained sheets, stained towels, stained towel, ~towel, ~towels, ~linen, ~bedsheet, ~bedsheets, ~bed sheet, ~bed sheets, ~sheets, ~duvet, ~pillow case, ~pillowcase, ~blanket, ~bathrobe, ~bath mat',
    need: 'dirty, stain, stains, stained, torn, tear, hole, holes, wet, smell, smelly, smells, hair, old, damaged, used, yellow, not changed, not clean, missing, no towel, no towels, no sheets, no linen' },
  { id: 'amen', noun: 'missing amenities', label: 'Bathroom amenities', emoji: '🧴', dept: 'hk', sev: 'low', say: 'amenities missing', verb: 'restock the amenities', ask: 'Please restock the amenities',
    kw: '~amenities, ~amenity, ~shampoo, ~soap, ~shower gel, ~conditioner, ~toothbrush, ~dental kit, ~toilet paper, ~toilet roll, ~tissue, ~tissues, ~slippers, ~hair dryer, ~hairdryer',
    need: 'missing, no, not, empty, finished, ran out, run out, out of, broken, not working, not refilled, not replaced' },
  { id: 'clean', noun: 'cleaning complaints', label: 'Cleanliness complaint', emoji: '🧹', dept: 'hk', sev: 'med', say: 'room not clean', verb: 're-clean the room', ask: 'Please re-clean the room',
    kw: 'not clean, not cleaned, unclean, room not clean, dirty room, room is dirty, messy, filthy, not made up, bed not made, bin not emptied, trash not, garbage not, not serviced, missed cleaning, cleaning complaint, ~dirty',
    not: 'vacant dirty, occupied dirty, vd, od' },
  { id: 'noise', noun: 'noise complaints', label: 'Noise / disturbance', emoji: '🔊', dept: 'sec', sev: 'med', say: 'noise complaint', verb: 'check the noise', ask: 'Please check the noise',
    kw: 'noise, noisy, loud, loud music, music, ~party, partying, shouting, screaming, yelling, disturbance, disturbing, disturbed, fighting, fight, banging, neighbours, neighbors, neighbour, neighbor',
    not: 'do not disturb, do not disturbed, please do not disturb' },
  { id: 'smoking', noun: 'smoking', label: 'Smoking in room', emoji: '🚬', dept: 'sec', sev: 'med', say: 'smoking in the room', verb: 'check the room', ask: 'Please check — non-smoking room',
    kw: 'smoking, smoked, smoking in room, smoking in the room, shisha, hookah, vape, vaping, ~cigarette, ~cigarettes' },
];
const DEFAULT_TH = { rep7: 2, rep30: 3, followH: 3, staleD: 3, chaseH: 6, checkIn: '14:00' };
const DEFAULT_NUDGE = { arrival: true, repeat: true, high: true, follow: true, toast: true };
const DEFAULT_ALSO = { note: true, handover: true };
const PROBLEM = ['not', 'no', 'broken', 'problem', 'issue', 'issues', 'complain', 'complaint', 'complaining', 'complained', 'leak', 'stuck', 'damaged', 'faulty', 'fault',
  'fix', 'repair', 'check', 'too', 'very', 'again', 'still', 'bad', 'wrong', 'error', 'off', 'dead', 'missing', 'falling', 'loose', 'torn', 'noisy', 'noise', 'hot', 'cold', 'beeping', 'working'].map(w => phrase(w));
const URGENT = 'urgent, urgently, asap, emergency, immediately, flooding, flooded, sparks, sparking, burning, fire, shock, angry, upset, furious, crying, sick, guest waiting'.split(',').map(s => phrase(s.trim()));

/** saved settings ({depts:{id:{…}}, kinds:{id:{…}}, th, nudge, also}) over the defaults → the full settings */
function mergeCfg(saved) {
  const S = saved && typeof saved === 'object' ? saved : {};
  const pick = (o, keys) => { const r = {}; keys.forEach(k => { if (o && o[k] != null && o[k] !== '') r[k] = o[k]; }); return r; };
  const sd = S.depts && typeof S.depts === 'object' ? S.depts : {}, sk = S.kinds && typeof S.kinds === 'object' ? S.kinds : {};
  const depts = DEFAULT_DEPTS.map(d => Object.assign({}, d, pick(sd[d.id], ['name', 'short', 'emoji', 'group']), sd[d.id] && sd[d.id].off ? { off: true } : {}));
  Object.keys(sd).forEach(id => { if (!DEFAULT_DEPTS.some(d => d.id === id) && sd[id] && sd[id].name && !sd[id].del) depts.push(Object.assign({ id, short: sd[id].name, emoji: '🛎️', group: '' }, pick(sd[id], ['name', 'short', 'emoji', 'group']))); });
  const kinds = DEFAULT_KINDS.map(k => Object.assign({}, k, pick(sk[k.id], ['label', 'emoji', 'dept', 'sev', 'kw', 'say', 'ask']), sk[k.id] && sk[k.id].off ? { off: true } : {}));
  Object.keys(sk).forEach(id => { if (!DEFAULT_KINDS.some(k => k.id === id) && sk[id] && sk[id].label && !sk[id].del) kinds.push(Object.assign({ id, emoji: '•', sev: 'med', kw: '', say: String(sk[id].label).toLowerCase(), verb: 'check it' }, pick(sk[id], ['label', 'emoji', 'dept', 'sev', 'kw', 'say', 'ask']))); });
  kinds.forEach(k => { if (!depts.some(d => d.id === k.dept)) k.dept = depts[0].id; });
  const num = (v, d, lo, hi) => { const n = +v; return isFinite(n) && n >= lo && n <= hi ? n : d; };
  const T = S.th || {};
  const th = { rep7: num(T.rep7, DEFAULT_TH.rep7, 2, 20), rep30: num(T.rep30, DEFAULT_TH.rep30, 2, 50), followH: num(T.followH, DEFAULT_TH.followH, 1, 48),
    staleD: num(T.staleD, DEFAULT_TH.staleD, 1, 30), chaseH: num(T.chaseH, DEFAULT_TH.chaseH, 1, 48), checkIn: /^\d{1,2}:\d{2}$/.test(T.checkIn || '') ? T.checkIn : DEFAULT_TH.checkIn };
  return { depts, kinds, th, nudge: Object.assign({}, DEFAULT_NUDGE, S.nudge || {}), also: Object.assign({}, DEFAULT_ALSO, S.also || {}) };
}
const listOf = s => String(s || '').split(/[,\n]+/).map(x => x.trim()).filter(Boolean);
/** settings → ready matchers (cached by their words) */
const COMPILED = new Map();
function compile(cfg) {
  cfg = cfg && cfg.kinds ? cfg : mergeCfg(cfg);
  const sig = JSON.stringify([cfg.kinds.map(k => [k.id, k.kw, k.not, k.need, k.soft, k.dept, k.sev, k.off]), cfg.depts.map(d => [d.id, d.off])]);
  if (COMPILED.has(sig)) return COMPILED.get(sig);
  const offD = new Set(cfg.depts.filter(d => d.off).map(d => d.id));
  const kinds = cfg.kinds.filter(k => !k.off && !offD.has(k.dept)).map(k => ({
    k, id: k.id, dept: k.dept, sev: SEV[k.sev] ? k.sev : 'med', fallback: !!k.fallback,
    kw: listOf(k.kw).map(w => ({ weak: w[0] === '~', ph: phrase(w.replace(/^~/, '')), raw: w.replace(/^~/, '') })).filter(x => x.ph.length),
    not: listOf(k.not).map(phrase).filter(p => p.length), need: listOf(k.need).map(phrase).filter(p => p.length), soft: new Set(listOf(k.soft).map(s => s.toLowerCase())),
  }));
  const C = { cfg, kinds, byId: Object.fromEntries(kinds.map(x => [x.id, x])), sig };
  if (COMPILED.size > 20) COMPILED.clear();
  COMPILED.set(sig, C);
  return C;
}

/** one piece of text → the kinds of problem in it [{kind, dept, sev, hits:[words]}] */
function kindsIn(ws0, C) {
  const ws = ws0.map(squash), hits = [];
  C.kinds.forEach(K => {
    const notS = []; K.not.forEach(p => spans(ws, p).forEach(s => notS.push(s)));
    K.kw.forEach(kw => spans(ws, kw.ph).forEach(s => { if (!notS.some(n => n[0] <= s[0] && s[1] <= n[1])) hits.push({ K, s: s[0], e: s[1], weak: kw.weak, raw: kw.raw }); }));
  });
  // a word inside a longer phrase of another kind belongs to that phrase ("AC making noise" is machine noise, not AC)
  const kept = hits.filter(h => !hits.some(g => g.K !== h.K && g.s <= h.s && h.e <= g.e && (g.e - g.s) > (h.e - h.s)));
  const by = new Map();
  kept.forEach(h => { const o = by.get(h.K) || { K: h.K, strong: false, hits: [], at: new Set() }; o.strong = o.strong || !h.weak; o.hits.push(h.raw); for (let i = h.s; i <= h.e; i++) o.at.add(i); by.set(h.K, o); });
  let L = [...by.values()];
  const anyStrong = L.some(o => o.strong && !o.K.fallback);
  L = L.filter(o => {
    if (o.K.need.length) return hasAny(ws, o.K.need);
    if (o.strong) return true;
    if (L.some(x => x !== o && x.strong && !x.K.fallback)) return false;   // weak words give way to a clear problem
    if (o.K.fallback) return true;                                          // "broken", "not working": the word is the problem
    return hasAny(ws.filter((w, i) => !o.at.has(i)), PROBLEM);   // a problem word besides the thing itself ("send hot water" is a request)
  });
  if (L.some(o => !o.K.fallback)) L = L.filter(o => !o.K.fallback);
  else if (anyStrong) L = [];
  return L.map(o => {
    let sev = o.K.sev;
    if (o.K.soft.size && o.hits.every(h => o.K.soft.has(h))) sev = sev === 'high' ? 'med' : 'low';
    return { kind: o.K.id, dept: o.K.dept, sev, hits: o.hits };
  });
}
const J = ws => ' ' + ws.join(' ') + ' ';
const FIX_RX = /\b(?:fixed|repaired|resolved|sorted|solved|rectified|restored|attended|deodorised|sprayed|unblocked|unclogged|replaced|done|completed|finished|khalas|tamam)\b|\b(?:working|cooling|ok|okay|fine)\s+(?:now|again|fine|ok|okay|properly|well|already|normally)\b|\bnow\s+(?:working|ok|okay|fine|cooling)\b|\b(?:is|are|its)\s+(?:working|cooling)\b|\bno\s+(?:issue|issues|problem|problems|complaint|complaints)\b|\bnot\s+an?\s+(?:issue|problem)\b|\bnothing\s+wrong\b|\bback\s+to\s+normal\b|\bno\s+(?:more|longer)\b|\bchecked\s+(?:and\s+)?(?:ok|okay|fine|working)\b|\ball\s+good\b/;
const NOT_FIX = /\b(?:not|never|nothing|yet\s+to\s+be|has\s+not\s+been|did\s+not|no\s+one|nobody)\s+(?:\w+\s+){0,2}?(?:fixed|repaired|resolved|sorted|solved|done|working|cooling|ok|okay|fine|cleaned|changed|replaced|attended|completed|restored)\b|\bnot\s+yet\b|\bstill\b/;
const STRONG_FIX = /\b(?:fixed|repaired|resolved|rectified|restored|attended|unblocked|unclogged|replaced|deodorised|sprayed)\b|\b(?:working|cooling)\s+(?:now|again|fine|properly|normally)\b|\bnow\s+(?:working|cooling)\b|\b(?:is|are|its)\s+(?:working|cooling)\b|\bno\s+(?:issue|issues|problem|problems)\b|\bnothing\s+wrong\b|\bback\s+to\s+normal\b|\bchecked\s+(?:and\s+)?(?:ok|okay|fine|working)\b/;
const REQ_RX = /\b(?:please|kindly|need|needs|send|asap|urgent|can you|request|complain|complaining|complained|complaint)\b/;
const HK_HINT = /\b(?:towels?|linen|sheets?|clean|cleaned|cleaning|amenities|bottles?|tissue|toilet paper|mur|make up)\b/;
/** does this piece of text say a problem is over? '' | 'weak' (done, ✅) | 'strong' (fixed, working now, no issue) */
function fixOf(ws, q) {
  const s = J(ws);
  if (q || !FIX_RX.test(s) || NOT_FIX.test(s) || REQ_RX.test(s)) return '';
  return STRONG_FIX.test(s) ? 'strong' : 'weak';
}
/** a text → { kinds: [{kind, dept, severity, label}], fix: '' | 'weak' | 'strong' } (no rooms needed) */
function classify(text, cfg) {
  const C = compile(cfg), ws = words(text), q = /\?\s*$/.test(String(text || '').trim());
  const ks = kindsIn(ws, C), fix = fixOf(ws, q), urgent = hasAny(ws, URGENT);
  return { kinds: ks.map(k => ({ kind: k.kind, dept: k.dept, severity: urgent && !fix ? bump(k.sev) : k.sev, label: C.byId[k.kind].k.label })), fix };
}
/** a message in pieces, each with its own rooms ("smoke smell 206, 506 paint smell", "512 AC fixed but toilet still blocked") */
function pieces(text) {
  const out = [];
  sp(text).split(/[,;\n]+|\.(?:\s+|$)|\s+but\s+|\s+also\s+/i).forEach(seg => {
    if (!seg || !seg.trim()) return;
    const rooms = roomsIn(seg);
    out.push({ rooms, text: seg.trim() });
  });
  return out;
}
/** one message / note / ticket → issue events and fix events
 *  rec: {text, quote?, at, source, who?, room? (forced), sev? (forced, e.g. a high-priority ticket), kind? (when nothing is found)}
 *  → [{room, kind, dept, severity, text, at, source, who, fix?: 'weak'|'strong', hk?}] */
function extract(rec, cfg) {
  if (!rec || !rec.text || isOurs(rec.text)) return [];
  const C = compile(cfg), out = [], text = sp(rec.text).slice(0, 1200), at = +rec.at || 0;
  const forced = rec.room ? rk(rec.room) : '';
  const base = { at, source: rec.source || '', who: rec.who || '' };
  const snip = String(text).replace(/\s+/g, ' ').trim().slice(0, 220);
  // "Done ✅" / "fixed" in reply to a message: that message's rooms and problems are over
  const allWs = words(text);
  if (rec.quote) {
    const qr = roomsIn(rec.quote), mine = roomsIn(text);
    if (!mine.length && allWs.length <= 8 && fixOf(allWs, /\?\s*$/.test(text)) && !kindsIn(allWs, C).length) {
      const qws = words(rec.quote), qk = kindsIn(qws, C);
      (forced ? [forced] : qr).forEach(r => {
        if (qk.length) qk.forEach(k => out.push(Object.assign({ room: rk(r), kind: k.kind, dept: k.dept, severity: k.sev, text: snip, fix: 'strong' }, base)));
        else out.push(Object.assign({ room: rk(r), kind: '', dept: '', severity: '', text: snip, fix: 'strong' }, base));
      });
      return out;
    }
  }
  let last = forced ? [forced] : rec.quote ? roomsIn(rec.quote).map(rk).filter(Boolean) : [];
  const P = pieces(text);
  P.forEach((p, i) => {
    let rooms = forced ? [forced] : p.rooms.map(rk).filter(Boolean);
    if (!rooms.length) rooms = last;
    else last = rooms;
    if (!rooms.length) return;
    const ws = words(p.text), q = /\?\s*$/.test(p.text) || (i === P.length - 1 && /\?\s*$/.test(text.trim()));
    const ks = kindsIn(ws, C), fix = fixOf(ws, q);
    if (q && fixOf(ws, false)) return;   // "AC working now?" asks, it says nothing
    if (fix) {
      if (ks.length) rooms.forEach(r => ks.forEach(k => out.push(Object.assign({ room: r, kind: k.kind, dept: k.dept, severity: k.sev, text: snip, fix: 'strong' }, base))));
      else rooms.forEach(r => out.push(Object.assign({ room: r, kind: '', dept: '', severity: '', text: snip, fix, hk: HK_HINT.test(J(ws)) }, base)));
      return;
    }
    let found = ks;
    if (!found.length && rec.kind && C.byId[rec.kind] && i === 0) found = [{ kind: rec.kind, dept: C.byId[rec.kind].dept, sev: C.byId[rec.kind].sev }];
    const urgent = hasAny(ws, URGENT) || hasAny(allWs, URGENT);
    rooms.forEach(r => found.forEach(k => {
      let sev = urgent ? bump(k.sev) : k.sev; if (rec.sev) sev = sevMax(sev, rec.sev);
      out.push(Object.assign({ room: r, kind: k.kind, dept: k.dept, severity: sev, text: snip }, base));
    }));
  });
  return out;
}

// ══ Cases: the reports of one problem in one room, until it is fixed ══
/** the same room + kind (+ fix) from two sources within 20 minutes is one report */
function dedupe(ev) {
  const out = [], seen = [];
  ev.forEach(e => {
    const k = rk(e.room) + '|' + (e.kind || '') + '|' + (e.fix ? 'f' : 'i');
    const dup = seen.find(s => s.k === k && Math.abs(s.at - e.at) <= 20 * 60e3 && (s.src !== e.source || s.text === e.text));
    if (dup) { if (e.source && !dup.e.srcs.includes(e.source)) dup.e.srcs.push(e.source); return; }
    const c = Object.assign({ srcs: [e.source] }, e);
    seen.push({ k, at: e.at, src: e.source, text: e.text, e: c }); out.push(c);
  });
  return out;
}
const sentOf = a => (a && a.sent && a.sent.at ? a.sent : null);
/** events → cases [{id, key, room, kind, dept, sev, first, last, reports, status: open|fixed|stale, fixedAt, fixedBy, fixedHow, n7, n30, rep7, first7}]
 *  o: {now, cfg, acts: {id: {sent, fixedAt, fixedBy}}} */
function build(events, o) {
  o = o || {};
  const now = o.now || Date.now(), C = compile(o.cfg), th = C.cfg.th, acts = o.acts || {};
  const ev = dedupe((events || []).filter(e => e && rk(e.room) && e.at).slice().sort((a, b) => a.at - b.at || (a.fix ? 1 : 0) - (b.fix ? 1 : 0)));
  const cases = [], open = {};
  const close = (c, e, how) => { c.status = 'fixed'; c.fixedAt = e.at; c.fixedBy = e.who || ''; c.fixedHow = how || e.source || ''; c.fixText = e.text || ''; delete open[c.key]; };
  ev.forEach(e => {
    const r = rk(e.room);
    if (e.fix) {
      let T;
      if (e.kind) T = open[r + '|' + e.kind] ? [open[r + '|' + e.kind]] : [];
      else T = Object.keys(open).filter(k => k.indexOf(r + '|') === 0).map(k => open[k]).filter(c => {
        if (e.fix === 'strong') return !e.hk || c.dept === 'hk';
        const s = sentOf(acts[c.id]); return !!s && s.at <= e.at && (!e.hk || c.dept === 'hk');   // "done ✅" answers what was sent
      });
      T.forEach(c => { if (e.at >= c.first) close(c, e); });
      return;
    }
    if (!e.kind || !C.byId[e.kind]) return;
    const key = r + '|' + e.kind;
    let c = open[key];
    if (c && (e.at - c.last <= th.chaseH * 36e5 || (e.source !== 'wa' && e.at - c.last <= th.staleD * 864e5))) { c.reports.push(e); c.last = e.at; c.sev = sevMax(c.sev, e.severity); return; }
    if (c) { c.status = 'stale'; delete open[key]; }   // a new time, much later: the old one was sorted without a word
    c = { id: key + '|' + e.at, key, room: e.room, rk: r, kind: e.kind, dept: C.byId[e.kind].dept, sev: e.severity || C.byId[e.kind].sev, first: e.at, last: e.at, reports: [e], status: 'open' };
    cases.push(c); open[key] = c;
  });
  cases.forEach(c => {
    const a = acts[c.id];
    if (c.status === 'open' && a && a.fixedAt) { c.status = 'fixed'; c.fixedAt = a.fixedAt; c.fixedBy = a.fixedBy || ''; c.fixedHow = 'tap'; }
    if (c.status === 'open' && now - c.last > th.staleD * 864e5) c.status = 'stale';
  });
  // how often the same problem came back in this room
  const byKey = {};
  cases.forEach(c => (byKey[c.key] = byKey[c.key] || []).push(c));
  cases.forEach(c => {
    const L = byKey[c.key], in7 = L.filter(x => x.first >= now - 7 * 864e5 && x.first <= now), in30 = L.filter(x => x.first >= now - 30 * 864e5 && x.first <= now);
    c.n7 = in7.length; c.n30 = in30.length;
    const r7 = in7.reduce((a, x) => a.concat(x.reports.filter(e => e.at >= now - 7 * 864e5)), []);
    c.rep7 = r7.length; c.first7 = r7.length ? Math.min(...r7.map(e => e.at)) : c.first;
    c.repeat = c.n7 >= th.rep7 || c.n30 >= th.rep30;
  });
  return cases.sort((a, b) => b.last - a.last);
}

/** "today", "since yesterday", "since 18 Oct" */
function sinceTxt(ms, now) {
  const a = dayOf(ms), t = dayOf(now);
  return a === t ? 'today' : a === addDays(t, -1) ? 'since yesterday' : 'since ' + fmtD(a);
}
/** what to call the problem, from what people wrote ("smoke smell", "blocked toilet", "AC too cold") */
function sayOf(kind, texts, C) {
  const K = C.byId[kind], base = (K && K.k.say) || (K && String(K.k.label).toLowerCase()) || 'problem';
  const t = ' ' + words((texts || []).join(' ')).join(' ') + ' ';
  const sp2 = {
    ac: [[/ too cold | freezing /, 'AC too cold'], [/ heating /, 'heating not working'], [/ noise| noisy /, 'AC noise']],
    smell: [[/ smoke | cigarette | shisha | smoking /, 'smoke smell'], [/ paint /, 'paint smell'], [/ sewage | drain /, 'drain smell'], [/ damp | musty /, 'musty smell']],
    hotwater: [[/ pressure /, 'low water pressure'], [/ no water | water not coming /, 'no water']],
    plumb: [[/ block| clog/, 'blocked drain / toilet'], [/ flush/, 'toilet not flushing'], [/ overflow/, 'overflowing toilet / sink']],
    elec: [[/ bulb/, 'bulb not working'], [/ no power | power cut | blackout /, 'no power'], [/ smoke detector | smoke alarm | fire alarm | beeping /, 'alarm / detector beeping']],
    lock: [[/ safe /, 'safe not opening'], [/ key | card /, 'key card not working']],
    pest: [[/ cockroach| roach/, 'cockroaches'], [/ bed ?bugs? | bedbugs /, 'bed bugs'], [/ ants? /, 'ants'], [/ mosquito/, 'mosquitoes']],
    tv: [[/ remote /, 'TV remote not working'], [/ channel| no signal /, 'TV channels not working']],
  }[kind] || [];
  const hit = sp2.find(([re]) => re.test(t));
  return hit ? hit[1] : base;
}

/** cases + what is going on in the rooms → advice, best first
 *  o: {now, cfg, acts, ctx: {arr, vip, long, vacant, co, out} (room key → true)} */
function advise(cases, o) {
  o = o || {};
  const now = o.now || Date.now(), C = compile(o.cfg), th = C.cfg.th, acts = o.acts || {}, X = o.ctx || {};
  const flag = (m, r) => !!(m && m[r]);
  const recs = [];
  const D = id => C.cfg.depts.find(d => d.id === id) || { id, name: id, short: id };
  (cases || []).filter(c => c.status === 'open').forEach(c => {
    const r = c.rk, a = acts[c.id] || {}, sent = sentOf(a), K = C.byId[c.kind];
    if (!K) return;
    const arrival = flag(X.arr, r), vip = flag(X.vip, r), long = flag(X.long, r), vacant = flag(X.vacant, r), co = flag(X.co, r);
    const follow = !!sent && !a.chased && c.sev === 'high' && now - sent.at >= th.followH * 36e5;
    let score = 0;
    if (arrival) score += 100;
    if (c.repeat) score += 60;
    score += c.sev === 'high' ? 30 : c.sev === 'med' ? 15 : 5;
    if (vip) score += 25;
    if (long) score += 12;
    if (vacant) score += 20; else if (co) score += 10;
    score += Math.max(0, 10 - Math.floor((now - c.last) / 36e5));
    if (sent && !follow) score -= 50;
    if (follow) score += 40;
    const say = sayOf(c.kind, c.reports.map(e => e.text), C), d = D(c.dept);
    const cnt = c.rep7 >= 2 ? c.rep7 : 0;
    const reasons = [];
    if (arrival) reasons.push(['🛎️', 'Arrival today', 'bad']);
    if (c.repeat) reasons.push(['🔁', c.n30 >= th.rep30 && c.n30 > c.n7 ? `${c.n30}× in 30 days` : `${Math.max(c.n7, 2)}× in 7 days`, 'warn']);
    if (c.sev === 'high') reasons.push(['⚠️', 'High', 'bad']);
    if (vip) reasons.push(['⭐', 'VIP guest', 'warn']);
    if (long) reasons.push(['🧳', 'Long stay', '']);
    if (vacant) reasons.push(['🚪', 'Vacant now — good time to fix', 'ok']); else if (co) reasons.push(['🚪', 'Guest leaves today', 'ok']);
    if (follow) reasons.push(['⏰', `No fix reply after ${th.followH} h`, 'bad']);
    let title;
    if (arrival) title = `Send ${d.short} to ${c.room} — ${say}${cnt ? ` reported ${cnt}× ${sinceTxt(c.first7, now)}` : ''}; ${K.k.verb || 'check it'} before the arrival today (check-in ${th.checkIn})`;
    else title = `Send ${d.short} to ${c.room} — ${say}${cnt ? ` reported ${cnt}× ${sinceTxt(c.first7, now)}` : ''}`;
    recs.push({ id: c.id, caseId: c.id, type: arrival ? 'arrival' : c.repeat ? 'repeat' : 'single', room: c.room, rk: r, kind: c.kind, dept: c.dept, sev: c.sev, score, say, title, reasons,
      cnt, since: cnt ? sinceTxt(c.first7, now) : '', n7: c.n7, n30: c.n30, arrival, vip, long, vacant, co, sent, follow, followed: a.followed || 0, latest: c.reports[c.reports.length - 1], first: c.first, last: c.last });
  });
  // rooms that keep having the same problem: a full check while nobody is in them
  const openKeys = new Set((cases || []).filter(c => c.status === 'open').map(c => c.key)), done = new Set();
  (cases || []).filter(c => c.repeat && c.status !== 'open' && !openKeys.has(c.key) && c.last >= now - 30 * 864e5).sort((a, b) => b.n30 - a.n30 || b.last - a.last).forEach(c => {
    const r = c.rk; if (done.has(r)) return;
    const vacant = flag(X.vacant, r), co = flag(X.co, r);
    if (!vacant && !co) return;
    done.add(r);
    const K = C.byId[c.kind]; if (!K) return;
    const d = D(c.dept), say = sayOf(c.kind, c.reports.map(e => e.text), C), n = Math.max(c.n30, c.n7);
    const id = 'chk|' + r + '|' + c.kind + '|' + dayOf(now), a = acts[id] || {};
    if (a.fixedAt) return;
    const out = flag(X.out, r);
    recs.push({ id, caseId: c.id, type: 'check', room: c.room, rk: r, kind: c.kind, dept: c.dept, sev: c.sev, score: 40 + (vacant ? 20 : 10) + (SEV[c.sev] || 1) * 3 - (sentOf(a) ? 50 : 0), say, n30: n, n7: c.n7,
      title: `Room ${c.room} had ${K.k.noun || String(K.k.label).toLowerCase()} ${n}× in 30 days — ask ${d.short} for a full check while it's vacant${out ? ' (guest checked out today)' : co ? ' (guest checks out today)' : ''}`,
      reasons: [['🔁', `${n}× in 30 days`, 'warn'], ['🚪', vacant ? 'Vacant now' : 'Guest leaves today', 'ok']], vacant, co, sent: sentOf(a), follow: false, latest: c.reports[c.reports.length - 1], first: c.first, last: c.last });
  });
  return recs.sort((a, b) => b.score - a.score || b.last - a.last);
}

/** the WhatsApp message for a piece of advice
 *  "Engineering: Room 512 — AC not cooling (reported 2× since yesterday). Please check. — HotelOps" */
function compose(rec, dept, o) {
  o = o || {};
  const C = compile(o.cfg), th = C.cfg.th, K = C.byId[rec.kind], d = dept || C.cfg.depts.find(x => x.id === rec.dept) || { name: 'Team' };
  const verb = (K && K.k.verb) || 'check it', end = s => String(s).replace(/[.\s]+$/, '') + '.';
  const head = `${d.name}: Room ${rec.room} — `;
  let body;
  if (rec.type === 'check') body = `${rec.say} reported ${rec.n30 || 3}× in 30 days. Room is vacant${rec.co && !rec.vacant ? ' after check-out today' : ''}: please do a full check.`;
  else if (rec.follow && rec.sent) body = `${rec.say}, sent at ${hm(rec.sent.at)}. Any update?`;
  else {
    body = rec.say + (rec.cnt ? ` (reported ${rec.cnt}× ${rec.since})` : '') + '. ';
    if (rec.arrival) body += `Arrival today: please ${verb} before check-in (${th.checkIn}).`;
    else if (rec.vip) body += `VIP guest in the room: please ${verb} as soon as possible.`;
    else body += end((K && K.k.ask) || 'Please check');
  }
  return head + body + ' — HotelOps';
}

/** the numbers on top of the page */
function summary(cases, recs, now) {
  const open = (cases || []).filter(c => c.status === 'open'), byDept = {};
  open.forEach(c => { byDept[c.dept] = (byDept[c.dept] || 0) + 1; });
  const rep = new Set((cases || []).filter(c => c.repeat && c.last >= now - 30 * 864e5).map(c => c.rk));
  return { open: open.length, byDept, repeatRooms: rep.size, arrivals: new Set((recs || []).filter(r => r.arrival).map(r => r.rk)).size,
    fixedWeek: (cases || []).filter(c => c.status === 'fixed' && c.fixedAt >= now - 7 * 864e5).length, high: open.filter(c => c.sev === 'high').length };
}
/** rooms ranked by how many problems they had in the last `days` → [{room, rk, total, kinds:[{kind,n}], last, open, buckets}] */
function problemRooms(cases, days, now) {
  const from = now - days * 864e5, by = {};
  (cases || []).filter(c => c.first >= from).forEach(c => {
    const o = by[c.rk] = by[c.rk] || { room: c.room, rk: c.rk, total: 0, kinds: {}, last: 0, open: 0, cases: [] };
    o.total++; o.kinds[c.kind] = (o.kinds[c.kind] || 0) + 1; o.last = Math.max(o.last, c.last); if (c.status === 'open') o.open++; o.cases.push(c);
  });
  const nb = days > 31 ? 13 : 10, span = days * 864e5 / nb;
  return Object.values(by).map(o => {
    const buckets = Array(nb).fill(0); o.cases.forEach(c => { const i = Math.min(nb - 1, Math.max(0, Math.floor((c.first - from) / span))); buckets[i]++; });
    return Object.assign(o, { kinds: Object.entries(o.kinds).map(([kind, n]) => ({ kind, n })).sort((a, b) => b.n - a.n), buckets });
  }).sort((a, b) => b.total - a.total || b.open - a.open || b.last - a.last);
}
/** "leak ×3 · AC ×1" */
function kindsLine(kinds, C) {
  return (kinds || []).map(k => { const K = C.byId[k.kind]; const l = K ? K.k.label.split(' / ')[0] : k.kind; return `${l} ×${k.n}`; }).join(' · ');
}

const PURE = { words, squash, lev, roomsIn, rk, floorOf, mergeCfg, compile, classify, extract, build, advise, compose, summary, problemRooms, kindsLine, sayOf, sinceTxt, isOurs, DEFAULT_DEPTS, DEFAULT_KINDS, DEFAULT_TH };
W.hoRoomHealthPure = PURE;
if (!doc) return;

// ══ App helpers ═════════════════════════════════════════════
const PANEL = 'room-health', ROOT = 'roomHealth';
const safe = (f, d) => { try { return f(); } catch (e) { try { console.warn('[room-health]', e); } catch (_) {} return d; } };
const LS = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} } };
const today = () => (typeof hoLocalISO === 'function' ? hoLocalISO() : dayOf(Date.now()));
const prof = () => (typeof currentProfile !== 'undefined' && currentProfile) || null;
const me = () => (prof() && prof().name) || 'Front Desk';
const role = () => (prof() && prof().role) || 'agent';
const canWrite = () => role() !== 'readonly';
const isLead = () => ['owner', 'manager', 'supervisor'].includes(role());
const allowed = () => safe(() => (typeof hoPanelAllowed === 'function' ? hoPanelAllowed(PANEL) : true), true);
const toast = (m, k) => safe(() => { if (typeof showToast === 'function') showToast(m, k || 'ok'); });
const act = (a, d) => safe(() => { if (typeof logActivity === 'function') logActivity(a, d); });
const fbKey = k => String(k || '').replace(/[.#$\[\]\/\x00-\x1f\x7f]/g, '_').slice(0, 120) || '_';
const fbOk = () => typeof fbSet === 'function' && typeof _ref !== 'undefined' && !!_ref;

// ══ State ═══════════════════════════════════════════════════
const R = {
  saved: LS.get('rh_cfg_v1', {}) || {}, acts: LS.get('rh_acts_v1', {}) || {}, hist: {}, histSig: '', loading: null, loadedDays: 0, todayArch: {}, todayAt: 0,
  cases: [], recs: [], sum: null, at: 0, view: 'advice', dept: 'all', kind: '', floor: '', q: '', range: 30, more: false,
};
safe(() => { const v = LS.get('rh_view_v1', {}); if (v && typeof v === 'object') ['view', 'dept', 'range'].forEach(k => { if (v[k] != null) R[k] = v[k]; }); });
const saveView = () => LS.set('rh_view_v1', { view: R.view, dept: R.dept, range: R.range });
const CFG = () => mergeCfg(R.saved);
const CC = () => compile(CFG());
const deptOf = id => CFG().depts.find(d => d.id === id) || { id, name: id, short: id, emoji: '•', group: '' };
const kindOf = id => (CC().byId[id] || {}).k || { id, label: id, emoji: '•' };

// ══ Reading the sources ═════════════════════════════════════
const waLog = () => safe(() => (W.hoWaBridge && typeof W.hoWaBridge.log === 'function' ? W.hoWaBridge.log() : []), []) || [];
/** today's WhatsApp messages: this device's log and the hotel's backup of today, once each */
function todayMsgs() {
  const t = today(), seen = new Set(), out = [];
  const push = (time, s, x, q, at) => { const k = time + '|' + String(s || '').toLowerCase() + '|' + String(x || '').replace(/\s+/g, ' ').trim().slice(0, 160).toLowerCase(); if (seen.has(k)) return; seen.add(k); let ms = atOf(t, time) || at || Date.now(); if (ms > Date.now() + 10 * 60e3) ms -= 864e5;   // 23:44 read just after midnight was yesterday
    out.push({ text: x, quote: q || '', at: ms, who: s || '' }); };
  waLog().forEach(e => { if (e && !e.deleted && !e.ho && e.text) push(e.time, e.sender, e.text, e.quote, e.at); });
  const A = R.todayArch || {};
  Object.keys(A).forEach(k => { const r = A[k]; if (r && typeof r === 'object' && r.x) push(r.t, r.s, r.x, r.q); });
  return out;
}
function collect() {
  const cfg = CFG(), t = today(), ev = [];
  const add = (rec) => safe(() => extract(rec, cfg).forEach(e => ev.push(e)));
  // WhatsApp: today + the past days loaded from the backup
  todayMsgs().forEach(m => add(Object.assign({ source: 'wa' }, m)));
  Object.keys(R.hist).forEach(d => { if (d < t) (R.hist[d] || []).forEach(e => ev.push({ room: e.r, kind: e.k, dept: e.d, severity: e.v, text: e.x, at: e.a, source: 'wa', who: e.w || '', fix: e.f || undefined, hk: !!e.h })); });
  // HK requests added by hand (the chat ones are the WhatsApp messages above)
  safe(() => { const B = W.hoWaBrain; if (B && typeof B.requests === 'function') (B.requests(t) || []).filter(i => i && i.manual).forEach(i => add({ text: [i.what, i.x].filter(Boolean).join(' — '), room: i.room, at: atOf(t, i.t) || Date.now(), source: 'hk', who: i.s || '' })); });
  // Handover Book (the days loaded)
  safe(() => {
    const H = W.hoHandoverBook; if (!H || typeof H.items !== 'function') return;
    for (let i = 0; i < 7; i++) {
      const d = addDays(t, -i);
      (H.items(d) || []).forEach(it => {
        if (!it || it.chat || isOurs(it.text || it.orig)) return;
        const at = atOf(it.date || d, it.time) || it.at; const txt = it.text || it.orig || '';
        const rooms = (it.rooms || []).filter(r => rk(r));
        if (rooms.length && !roomsIn(txt).length) rooms.forEach(r => add({ text: txt, room: r, at, source: 'ho', who: it.sender || '' })); else add({ text: txt, at, source: 'ho', who: it.sender || '' });
        if (it.status === 'done') (rooms.length ? rooms : roomsIn(txt)).forEach(r => { const k = classify(txt, cfg).kinds; k.forEach(x => ev.push({ room: rk(r), kind: x.kind, dept: x.dept, severity: x.severity, text: '✓ Done in the Handover Book', at: (it.doneAt || at) + 60e3, source: 'ho', who: it.doneBy || '', fix: 'strong' })); });
      });
    }
  });
  // Front Office Log maintenance tickets
  safe(() => {
    const O = W.hoOpsLogs; if (!O || typeof O.mt !== 'function') return;
    Object.values(O.mt() || {}).forEach(r => {
      if (!r || !r.problem) return;
      const room = /^\s*(?:room\s*|rm\s*)?#?\d{3,4}\s*$/i.test(String(r.area || '')) ? rk(r.area) : (roomsIn(r.area)[0] || '');
      if (!room) return;
      const at = r.at || r.created; if (!at) return;
      const k0 = classify(r.problem, cfg).kinds;
      add({ text: r.problem, room, at, source: 'log', who: r.by || '', sev: r.prio === 'high' ? 'high' : '', kind: k0.length ? '' : 'repair' });
      if (r.status === 'fixed' && r.fixedAt) (k0.length ? k0 : [{ kind: 'repair', dept: 'eng', severity: 'med' }]).forEach(x => ev.push({ room, kind: x.kind, dept: x.dept, severity: x.severity, text: '✅ Ticket fixed', at: r.fixedAt, source: 'log', who: r.fixedBy || '', fix: 'strong' }));
    });
  });
  // room notes
  safe(() => {
    const S = W.hoRoom && typeof W.hoRoom.store === 'function' ? W.hoRoom.store() : null; if (!S || !S.all) return;
    Object.keys(S.all).forEach(k => { const o = S.all[k] || {}; Object.keys(o).forEach(id => { const n = o[id]; if (n && n.text && n.at && !isOurs(n.text) && n.at >= Date.now() - 95 * 864e5) add({ text: n.text, room: n.room || k, at: n.at, source: 'note', who: n.by || '' }); }); });
  });
  const now = Date.now();
  ev.forEach(e => { if (e.at > now + 10 * 60e3 && e.at - now < 864e5) e.at -= 864e5; });   // a late-evening time read after midnight belongs to yesterday
  return ev;
}
/** who is where today: arrivals, VIP / long stay in-house, vacant rooms, leaving today */
function context() {
  const t = today(), X = { arr: {}, vip: {}, long: {}, vacant: {}, co: {}, out: {}, ih: {} };
  safe(() => (typeof arrGuests !== 'undefined' && Array.isArray(arrGuests) ? arrGuests : []).forEach(g => { const r = rk(g && g.room); if (r) X.arr[r] = true; }));
  const ihRooms = safe(() => (W.hoInHouse && typeof W.hoInHouse.rooms === 'function' ? W.hoInHouse.rooms() : []), []) || [];
  ihRooms.forEach(g => { const r = rk(g && g.room); if (!r) return; X.ih[r] = g; if (g.vip) X.vip[r] = true; if ((+g.nights || 0) >= 7) X.long[r] = true; if (g.departure === t) X.co[r] = true; });
  safe(() => (typeof depRooms !== 'undefined' && Array.isArray(depRooms) ? depRooms : []).forEach(d => { const r = rk(d && (d.roomStr != null ? d.roomStr : d.room)); if (!r) return; if (d.status === 'out') { X.out[r] = true; X.vacant[r] = true; delete X.co[r]; } else if (d.status !== 'extended') X.co[r] = true; }));
  if (ihRooms.length) {
    const known = new Set(Object.keys(X.ih).concat(Object.keys(X.arr)));
    R.cases.forEach(c => { if (!known.has(c.rk) && !X.co[c.rk]) X.vacant[c.rk] = true; });
  }
  Object.keys(X.arr).forEach(r => { delete X.vacant[r]; });
  return X;
}
function compute() {
  const now = Date.now(), cfg = CFG();
  const ev = collect();
  R.cases = build(ev, { now, cfg, acts: R.acts });
  R.ctx = context();
  R.recs = advise(R.cases, { now, cfg, acts: R.acts, ctx: R.ctx });
  R.sum = summary(R.cases, R.recs, now);
  R.at = now;
  safe(badge);
  return R;
}

// the WhatsApp backup of the past days, read once and kept small on this device
const HIST_KEY = 'rh_hist_v1';
safe(() => { const v = LS.get(HIST_KEY, null); if (v && v.sig && v.days) { R.histSig = v.sig; R.hist = v.days; } });
function saveHist() {
  const t = today(), keep = {}; Object.keys(R.hist).filter(d => d < t && d >= addDays(t, -95)).sort().forEach(d => { keep[d] = R.hist[d]; });
  R.hist = keep; LS.set(HIST_KEY, { sig: R.histSig, days: keep });
}
async function loadHist(days) {
  if (typeof fbGet !== 'function') return false;
  const sig = CC().sig.length + ':' + hashS(CC().sig);
  if (R.histSig !== sig) { R.hist = {}; R.histSig = sig; }
  const t = today(), need = [];
  for (let i = 1; i <= days; i++) { const d = addDays(t, -i); if (!R.hist[d]) need.push(d); }
  if (!need.length) { R.loadedDays = Math.max(R.loadedDays, days); return false; }
  const cfg = CFG();
  for (let i = 0; i < need.length; i += 15) {
    await Promise.all(need.slice(i, i + 15).map(async d => {
      let v = null; try { v = await fbGet('waChat/' + d); } catch (_) { return; }
      const L = [];
      if (v && typeof v === 'object') Object.keys(v).forEach(k => { const r = v[k]; if (!r || !r.x || isOurs(r.x)) return; extract({ text: r.x, quote: r.q || '', at: atOf(d, r.t) || atOf(d, '12:00'), source: 'wa', who: r.s || '' }, cfg).forEach(e => L.push({ r: rk(e.room), k: e.kind, d: e.dept, v: e.severity, x: String(e.text).slice(0, 160), a: e.at, w: String(e.who || '').slice(0, 40), f: e.fix || 0, h: e.hk ? 1 : 0 })); });
      R.hist[d] = L;
    }));
  }
  R.loadedDays = Math.max(R.loadedDays, days);
  saveHist();
  return true;
}
const hashS = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
async function loadToday(force) {
  if (typeof fbGet !== 'function' || (!force && Date.now() - R.todayAt < 150e3)) return false;
  R.todayAt = Date.now();
  try { const v = await fbGet('waChat/' + today()); R.todayArch = v && typeof v === 'object' ? v : {}; } catch (_) { return false; }
  return true;
}
function loadHandover() {
  const H = W.hoHandoverBook; if (!H || typeof H.load !== 'function') return Promise.resolve();
  const t = today(), L = []; for (let i = 1; i < 7; i++) L.push(Promise.resolve(safe(() => H.load(addDays(t, -i)))).catch(() => {}));
  return Promise.all(L);
}
let started = false;
function ensureData(days) {
  if (R.loading) return R.loading;
  R.loading = Promise.all([loadHist(days || R.range || 30), loadToday(), started ? null : loadHandover()]).catch(() => {}).then(() => { started = true; R.loading = null; compute(); if (active()) render(); nudge(); });
  return R.loading;
}

// ══ Saving ══════════════════════════════════════════════════
function setAct(id, patch) {
  const k = fbKey(id), cur = Object.assign({}, R.acts[k] || R.acts[id] || {}, patch);
  Object.keys(patch).forEach(x => { if (patch[x] == null) delete cur[x]; });
  R.acts[k] = cur; if (k !== id) R.acts[id] = cur;
  LS.set('rh_acts_v1', pruneActs(R.acts));
  if (fbOk()) safe(() => Promise.resolve(typeof fbUpdate === 'function' ? fbUpdate(ROOT + '/acts/' + k, Object.fromEntries(Object.keys(patch).map(x => [x, patch[x] == null ? null : patch[x]]))) : fbSet(ROOT + '/acts/' + k, cur)).catch(() => {}));
}
const actOf = id => R.acts[fbKey(id)] || R.acts[id] || {};
function pruneActs(A) { const o = {}, lim = Date.now() - 120 * 864e5; Object.keys(A || {}).forEach(k => { const a = A[k]; const t = Math.max((a && a.sent && a.sent.at) || 0, (a && a.fixedAt) || 0, (a && a.at) || 0); if (a && t >= lim) o[k] = a; }); return o; }
function saveCfg(next, what) {
  R.saved = next; LS.set('rh_cfg_v1', next);
  if (fbOk()) safe(() => Promise.resolve(fbSet(ROOT + '/cfg', next)).catch(() => toast('Could not save — check the connection', 'err')));
  act('room_health_settings', what || 'Room Health settings changed');
  COMPILED.clear(); refresh(true);
}
function startSync() {
  let tries = 0;
  const go = () => {
    if (typeof fbListen !== 'function') return;
    if (!(typeof _ref !== 'undefined' && _ref) && ++tries <= 40) { setTimeout(go, 500); return; }
    fbListen(ROOT + '/cfg', v => { R.saved = v && typeof v === 'object' ? v : {}; LS.set('rh_cfg_v1', R.saved); refresh(); });
    fbListen(ROOT + '/acts', v => { R.acts = v && typeof v === 'object' ? v : {}; LS.set('rh_acts_v1', pruneActs(R.acts)); refresh(); });
  };
  go();
}

// ══ Doing things ════════════════════════════════════════════
const findRec = id => R.recs.find(r => r.id === id) || null;
function recForCase(c) {
  return findRec(c.id) || { id: c.id, caseId: c.id, type: 'single', room: c.room, rk: c.rk, kind: c.kind, dept: c.dept, sev: c.sev, say: sayOf(c.kind, c.reports.map(e => e.text), CC()), cnt: c.rep7 >= 2 ? c.rep7 : 0, since: sinceTxt(c.first7, Date.now()), latest: c.reports[c.reports.length - 1] };
}
function linkInfo() { return safe(() => (W.hoWaBridge && typeof W.hoWaBridge.link === 'function' ? W.hoWaBridge.link() : null), null); }
function groupNames() {
  const n = [], L = linkInfo();
  ((L && L.groups) || []).forEach(g => { if (g && g.name && !n.includes(g.name)) n.push(g.name); });
  waLog().forEach(l => { if (l && l.group && !n.includes(l.group)) n.push(l.group); });
  CFG().depts.forEach(d => { if (d.group && !n.includes(d.group)) n.push(d.group); });
  return n;
}
function copyText(s) {
  return new Promise(res => {
    const fb = () => { const ta = doc.createElement('textarea'); ta.value = s; ta.style.cssText = 'position:fixed;opacity:0;top:0'; doc.body.appendChild(ta); ta.select(); let ok = false; try { ok = doc.execCommand('copy'); } catch (_) {} ta.remove(); res(ok); };
    try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(s).then(() => res(true), fb); else fb(); } catch (_) { fb(); }
  });
}
async function send(id, deptId) {
  const rec = findRec(id) || (R.cases.find(c => c.id === id) ? recForCase(R.cases.find(c => c.id === id)) : null);
  if (!rec) { toast('That problem is no longer open', 'info'); return; }
  if (!canWrite()) { toast('Sending is not available for your role', 'err'); return; }
  const d = deptOf(deptId || rec.dept), text = compose(Object.assign({}, rec, { dept: d.id }), d, { cfg: CFG() });
  const L = linkInfo();
  let via = 'copy', group = d.group || '';
  if (L && L.linked && W.hoWaBridge && typeof W.hoWaBridge.send === 'function') {
    if (!group) { group = await pickGroup(d); if (!group) return; }
    const it = safe(() => W.hoWaBridge.send(text, group), null);
    if (!it) return;
    via = 'wa';
  } else {
    await copyText(text);
    toast(`Copied — paste it in the ${d.name} WhatsApp group${group ? ' (' + group + ')' : ''}`, 'info');
    safe(() => { if (typeof W.waOpenFromTop === 'function') W.waOpenFromTop(); });
  }
  const what = `${d.name} to ${rec.room} for ${rec.say}`;
  const sent = { at: Date.now(), by: me(), dept: d.id, via, group: group || '' };
  setAct(rec.id, rec.follow ? { sent, chased: Date.now(), followed: rec.followed || Date.now() } : { sent, followed: null });
  act('room_health_sent', what);
  const cfg = CFG();
  if (cfg.also.note) safe(() => { if (W.hoRoom && typeof W.hoRoom.addNote === 'function') W.hoRoom.addNote(rec.room, `🩺 ${rec.follow ? 'Chased' : 'Sent'} ${d.name} for ${rec.say}`, d.id === 'hk' ? 'hk' : 'mnt', 'stay', false); });
  if (cfg.also.handover) safe(() => { if (W.hoHandoverBook && typeof W.hoHandoverBook.addItems === 'function') W.hoHandoverBook.addItems([{ text: `🩺 ${rec.follow ? 'Chased' : 'Sent'} ${d.name} to ${rec.room} for ${rec.say} — waiting for their reply`, cat: d.id === 'hk' ? 'hk' : d.id === 'sec' ? 'guest' : 'maint' }]); });
  refresh(true);
  if (via === 'wa') toast(`📨 Sent ${what}`, 'ok');
  repaintCard(rec.room);
}
// ── one WhatsApp message per department: every room that needs them, ready to paste ──
function deptRecs(deptId) { return R.recs.filter(r => r.dept === deptId); }
function deptMsg(deptId) {
  const d = deptOf(deptId), C = CC(), th = C.cfg.th, list = deptRecs(deptId);
  const now = new Date(), day = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const lines = list.map((r, i) => {
    let x = `${i + 1}. *Room ${r.room}* — ${String(r.say || '').replace(/[.\s]+$/, '')}`;
    if (r.cnt > 1) x += ` (${r.cnt}× ${r.since})`;
    if (r.type === 'check') x += ' — vacant now, please do a full check';
    if (r.arrival) x += ` — ⚠️ arrival today, before ${th.checkIn}`;
    else if (r.vip) x += ' — ⭐ VIP in the room';
    if (r.follow && r.sent) x += ` — reminder, first sent ${hm(r.sent.at)}`;
    return x;
  });
  const text = `${d.emoji} *${d.name}* — ${list.length === 1 ? '1 room' : list.length + ' rooms'} to check · ${day} ${hm(Date.now())}\n\n${lines.join('\n')}\n\nPlease reply with the room number + "done" when fixed 🙏`;
  return { text, list, d };
}
function waCopyBar() {
  if (!canWrite()) return '';
  const deps = CFG().depts.filter(d => !d.off).map(d => [d, deptRecs(d.id).length]).filter(x => x[1]);
  if (!deps.length) return '';
  return `<div class="rh-wa"><span class="rh-wa-t">💬 One message per team</span><div class="rh-wa-b">${deps.map(([d, n]) => `<button type="button" class="rh-wa-c" data-rh-act="wamsg" data-v="${esc(d.id)}"><span>${esc(d.emoji)}</span><b>${esc(d.short)}</b><i>${n}</i></button>`).join('')}</div></div>`;
}
function waMsgDialog(deptId) {
  const m = deptMsg(deptId); if (!m.list.length) { toast('Nothing waiting for ' + m.d.name, 'info'); return; }
  const sc = modal(`<div class="rh-mh"><h2>${esc(m.d.emoji)} Message for ${esc(m.d.name)}</h2><button type="button" class="rh-x" data-x aria-label="Close">✕</button></div>
    <div class="rh-mb"><div class="rh-hint">${m.list.length} room${m.list.length === 1 ? '' : 's'}, ready for WhatsApp. You can change the text before copying.</div>
    <textarea class="rh-wa-ta" id="rhWaTxt" spellcheck="false">${esc(m.text)}</textarea>
    <div class="rh-wa-prev" id="rhWaPrev"></div></div>
    <div class="rh-mf"><button type="button" class="rh-btn" data-x>Close</button><button type="button" class="rh-btn" data-open>💬 Open WhatsApp</button><button type="button" class="rh-btn pri" data-copy>⧉ Copy message</button></div>`);
  const ta = sc.querySelector('#rhWaTxt'), prev = sc.querySelector('#rhWaPrev');
  // how it will look in WhatsApp (*bold*)
  const show = () => { prev.innerHTML = esc(ta.value).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/\n/g, '<br>'); };
  ta.addEventListener('input', show); show();
  const mark = via => {
    const sent = { at: Date.now(), by: me(), dept: m.d.id, via, group: m.d.group || '' };
    m.list.forEach(r => setAct(r.id, r.follow ? { sent, chased: Date.now(), followed: r.followed || Date.now() } : { sent, followed: null }));
    act('room_health_sent', `${m.d.name}: ${m.list.map(r => r.room).join(', ')}`);
    refresh(true);
  };
  sc.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.hasAttribute('data-x')) closeModal();
    else if (b.hasAttribute('data-copy')) copyText(ta.value).then(ok => { toast(ok ? `Copied — paste it in the ${m.d.name} group` : 'Could not copy — select the text and copy it', ok ? 'ok' : 'err'); if (ok) { mark('copy'); closeModal(); } });
    else if (b.hasAttribute('data-open')) { copyText(ta.value); mark('copy'); W.open('https://wa.me/?text=' + encodeURIComponent(ta.value), '_blank'); closeModal(); }
  });
}
function markFixed(id) {
  if (!canWrite()) { toast('Not available for your role', 'err'); return; }
  const rec = findRec(id) || (R.cases.find(c => c.id === id) ? recForCase(R.cases.find(c => c.id === id)) : null);
  const before = Object.assign({}, actOf(id));
  setAct(id, { fixedAt: Date.now(), fixedBy: me() });
  act('room_health_fixed', rec ? `Room ${rec.room}: ${rec.say}` : id);
  refresh(true);
  safe(() => { if (typeof showUndoToast === 'function') showUndoToast(`✓ Marked fixed${rec ? ' · ' + rec.room : ''}`, () => { setAct(id, { fixedAt: before.fixedAt || null, fixedBy: before.fixedBy || null }); refresh(true); }); else toast('✓ Marked fixed'); });
  if (rec) repaintCard(rec.room);
}
function ticket(id) {
  const rec = findRec(id); if (!rec) return;
  safe(() => {
    if (typeof W.olTab !== 'function') { if (typeof showPanel === 'function') showPanel('ops-logs'); return; }
    W.olTab('mt');
    setTimeout(() => safe(() => {
      const b = doc.querySelector('#panel-ops-logs [data-act="mtNew"]'); if (!b) return; b.click();
      setTimeout(() => safe(() => {
        const m = doc.getElementById('ol-modal'); if (!m) return;
        const a = m.querySelector('[name="area"]'), p = m.querySelector('[name="problem"]'), pr = m.querySelector('[name="prio"]');
        if (a && !a.value) a.value = rec.room; if (p && !p.value) p.value = rec.say + (rec.cnt ? ` (reported ${rec.cnt}× ${rec.since})` : ''); if (pr && rec.sev === 'high') pr.value = 'high';
      }), 60);
    }), 120);
  });
}
function repaintCard(room) { safe(() => { const sh = doc.getElementById('rcSheet'); const S = W.hoRoom && W.hoRoom.state && W.hoRoom.state(); if (sh && S && rk(S.room) === rk(room)) W.hoRoom.open(S.room); }); }
function openRoom(room) { safe(() => { if (W.hoRoom && typeof W.hoRoom.open === 'function') W.hoRoom.open(room); }); }

// ══ Nudges: Ops Brain thoughts and one toast ═════════════════
const TOAST_KEY = 'rh_toast_v1';
function nudge() {
  if (!started || !allowed() || !R.recs) return;
  const cfg = CFG(), N = cfg.nudge, now = Date.now(), T = LS.get(TOAST_KEY, {}) || {}, t = today();
  Object.keys(T).forEach(k => { if (T[k] < now - 3 * 864e5) delete T[k]; });
  const say = [];
  void t;
  tips().forEach(x => { if (x.toast && !T[x.id]) { T[x.id] = now; say.push(x); } });
  R.recs.filter(r => r.follow && !r.followed && N.follow).forEach(r => { if (canWrite()) setAct(r.id, { followed: now }); });   // the follow-up shows once for the whole team
  LS.set(TOAST_KEY, T);
  if (N.toast && say.length) toast(say.length === 1 ? '🩺 ' + say[0].text : `🩺 ${say.length} room problems need a decision — open Room Health`, say.some(x => x.tone === 'bad') ? 'warn' : 'info');
  }
/** the thoughts Ops Brain can show now */
function tips() {
  if (!R.recs) return [];
  const N = CFG().nudge, now = Date.now(), out = [];
  R.recs.forEach(r => {
    const d = deptOf(r.dept), base = { rec: r, dept: d };
    if (r.arrival && !r.sent && N.arrival) out.push(Object.assign({ id: 'rhArr:' + r.id, type: 'rhArrival', tone: 'bad', text: `🛎️ Arrival today in ${r.room}, but the ${r.say} isn't sorted. Send ${d.short} before check-in.`, toast: true }, base));
    else if (r.follow && N.follow && (!r.followed || now - r.followed < 36e5)) out.push(Object.assign({ id: 'rhFol:' + r.id, type: 'rhFollow', tone: 'warn', text: `No fix reply yet for ${r.room} (${r.say}) — sent to ${d.name} at ${hm(r.sent.at)}. Chase once?`, toast: !r.followed }, base));
    else if (r.type === 'repeat' && !r.sent && N.repeat && now - r.first < 24 * 36e5) out.push(Object.assign({ id: 'rhRep:' + r.id, type: 'rhRepeat', tone: 'warn', text: `${r.room}: ${r.say} again (${r.n30 > r.n7 ? r.n30 + '× in 30 days' : r.n7 + '× in 7 days'}). Send ${d.short}?`, toast: true }, base));
    else if (r.sev === 'high' && !r.sent && N.high && now - r.last < 3 * 36e5 && r.type !== 'check') out.push(Object.assign({ id: 'rhHigh:' + r.id, type: 'rhHigh', tone: 'warn', text: `${r.room}: ${r.say}. Send ${d.short}?`, toast: now - r.last < 2 * 36e5 }, base));
  });
  return out.slice(0, 6);
}
const go = (q) => { safe(() => { if (typeof brClose === 'function') brClose(); }); if (q) { R.q = q; R.view = 'advice'; } if (typeof showPanel === 'function') showPanel(PANEL); setTimeout(render, 30); };
(W.BL_THINKERS = W.BL_THINKERS || []).push(add => {
  if (!started || !allowed()) return;
  tips().forEach(x => add({ id: x.id, type: x.type, icon: '🩺', tone: x.tone, text: x.text, why: x.rec.reasons.map(r => r[1]).join(' · '),
    acts: [[`Send to ${x.dept.short}`, () => send(x.rec.id)], ['Open Room Health', () => go(x.rec.room)]] }));
});
// Ops Brain answers: "problem rooms", "what to send engineering", "issues in 512"
(W.BR_EXTRA = W.BR_EXTRA || []).push(() => {
  if (!started && !R.cases.length) return [];
  if (!allowed()) return [];
  const C = CC(), now = Date.now(), out = [], li = r => `<li><b>${esc(r.room)}</b> · ${esc(r.title.replace(/^Send [^—]+— /, ''))}${r.sent ? ` · 📨 sent ${esc(hm(r.sent.at))}` : ''}</li>`;
  const PR = problemRooms(R.cases, 30, now).filter(p => p.total >= 2);
  out.push({ id: 'rh:problem', kind: '🩺 Room Health', title: PR.length ? `${PR.length} problem room${PR.length === 1 ? '' : 's'} in the last 30 days` : 'No room had the same problem twice in 30 days',
    body: PR.length ? `<ul>${PR.slice(0, 10).map(p => `<li><b>${esc(p.room)}</b> · ${esc(kindsLine(p.kinds, C))}${p.open ? ' · ' + p.open + ' open' : ''}</li>`).join('')}</ul>` : '<div>Nothing repeats. Room Health keeps watching WhatsApp, HK requests, handover, the Front Office Log and room notes.</div>',
    text: 'problem rooms room health repeat issues rooms keep breaking worst rooms which rooms have problems maintenance history recurring', go: PANEL, boost: 1 });
  CFG().depts.filter(d => !d.off).forEach(d => {
    const L = R.recs.filter(r => r.dept === d.id);
    out.push({ id: 'rh:dept:' + d.id, kind: '🩺 Room Health', title: L.length ? `What to send ${d.name}: ${L.length} room${L.length === 1 ? '' : 's'}` : `Nothing to send ${d.name} right now`,
      body: L.length ? `<ul>${L.slice(0, 10).map(li).join('')}</ul>` : '<div>No open problem for this department.</div>',
      text: `what to send ${d.name} ${d.short} ${d.id === 'eng' ? 'engineering maintenance technician eng repair fix' : d.id === 'hk' ? 'housekeeping hk deodorise pest' : d.id === 'it' ? 'it wifi internet' : d.id === 'sec' ? 'security noise smoking' : ''} open issues needs fixing send ${d.name} now`, go: PANEL, boost: 1 });
  });
  const rooms = new Map(); R.cases.filter(c => c.last >= now - 90 * 864e5).forEach(c => { const o = rooms.get(c.rk) || []; o.push(c); rooms.set(c.rk, o); });
  [...rooms.entries()].slice(0, 60).forEach(([r, L]) => {
    const open = L.filter(c => c.status === 'open'), kinds = {}; L.forEach(c => { kinds[c.kind] = (kinds[c.kind] || 0) + 1; });
    out.push({ id: 'rh:room:' + r, kind: '🩺 Room Health', title: `Room ${L[0].room}: ${open.length ? open.length + ' open problem' + (open.length === 1 ? '' : 's') : 'no open problem'}`,
      body: `<div>${esc(kindsLine(Object.entries(kinds).map(([kind, n]) => ({ kind, n })).sort((a, b) => b.n - a.n), C))} in 90 days.</div>${open.length ? `<ul>${open.map(c => `<li>${esc(kindOf(c.kind).emoji)} ${esc(sayOf(c.kind, c.reports.map(e => e.text), C))} · ${esc(sinceTxt(c.first, now))}${actOf(c.id).sent ? ' · 📨 sent' : ''}</li>`).join('')}</ul>` : ''}`,
      text: `issues in ${r} problems ${r} room ${r} health ${r} ${r} issues problems history ${L.map(c => kindOf(c.kind).label).join(' ')}`, go: PANEL, boost: 1 });
  });
  return out;
});

// ══ The page ════════════════════════════════════════════════
const CSS = `
#rhRoot,.rh-modal{--rh-acc:var(--gold,var(--accent,#0a84ff));--rh-ok:var(--green,#16a34a);--rh-warn:var(--amber,#d97706);--rh-bad:var(--red,#dc2626);--rh-blue:var(--blue,#2563eb);
  --rh-r:16px;--rh-hair:color-mix(in srgb,var(--text) 10%,transparent);--rh-soft:color-mix(in srgb,var(--text) 4%,var(--card,#fff));--rh-fill:color-mix(in srgb,var(--text) 6%,transparent);
  --rh-font:-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display",Inter,system-ui,"Segoe UI",sans-serif}
#rhRoot{display:grid;gap:14px;min-width:0;max-width:1080px;margin:0 auto;color:var(--text);font-family:var(--rh-font);-webkit-font-smoothing:antialiased}
#rhRoot *,.rh-modal *{box-sizing:border-box}
#rhRoot button,#rhRoot input,#rhRoot select,.rh-modal button,.rh-modal input,.rh-modal select,.rh-modal textarea{font-family:var(--rh-font)}
#rhRoot .page-hd{display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between;align-items:flex-end;margin-bottom:0!important}
#rhRoot .page-hd-left{min-width:0;flex:1 1 300px}
.rh-acts{display:flex;gap:8px;flex-wrap:wrap;align-items:center;min-width:0}
.rh-btn{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:8px 14px;border-radius:999px;font:600 13.5px/1.2 var(--rh-font);color:var(--text);background:var(--rh-fill);border:1px solid var(--rh-hair);white-space:nowrap;transition:transform .15s,filter .15s;max-width:100%}
.rh-btn:hover{filter:brightness(1.05)}.rh-btn:active{transform:scale(.97)}
.rh-btn.pri{background:var(--rh-acc);color:var(--bg,#fff);border-color:transparent;box-shadow:0 4px 14px -6px color-mix(in srgb,var(--rh-acc) 70%,transparent)}
.rh-btn.ok{color:var(--rh-ok)}
.rh-btn.sm{padding:6px 11px;font-size:12.5px}
.rh-btn[disabled]{opacity:.45;pointer-events:none}
.rh-btn:focus-visible,.rh-chip:focus-visible,.rh-rm:focus-visible,.rh-kpi:focus-visible,.rh-sel:focus-visible{outline:2px solid var(--rh-acc);outline-offset:2px}
.rh-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.rh-kpi{all:unset;box-sizing:border-box;cursor:pointer;display:flex;flex-direction:column;gap:2px;background:var(--card,#fff);border:1px solid var(--rh-hair);border-radius:var(--rh-r);padding:12px 14px;min-width:0;box-shadow:0 1px 2px rgba(0,0,0,.04);transition:border-color .15s}
.rh-kpi:hover{border-color:color-mix(in srgb,var(--rh-acc) 55%,transparent)}
.rh-kpi small{font:600 10.5px/1.25 var(--rh-font);letter-spacing:.05em;text-transform:uppercase;color:var(--text3)}
.rh-kpi b{font:700 26px/1.1 var(--rh-font);font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.rh-kpi i{font-style:normal;font-size:12px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rh-kpi.bad b{color:var(--rh-bad)}.rh-kpi.warn b{color:var(--rh-warn)}.rh-kpi.ok b{color:var(--rh-ok)}
.rh-tb{display:flex;flex-wrap:wrap;gap:8px;align-items:center;min-width:0}
.rh-in,.rh-sel,.rh-ta{width:100%;background:var(--rh-soft);color:var(--text);border:1px solid var(--rh-hair);border-radius:11px;padding:9px 12px;font:14px var(--rh-font);margin:0;min-width:0;color-scheme:light dark}
.rh-in:focus,.rh-sel:focus,.rh-ta:focus{outline:none;border-color:var(--rh-acc);box-shadow:0 0 0 3px color-mix(in srgb,var(--rh-acc) 22%,transparent)}
.rh-tb .rh-in{flex:1 1 200px;width:auto}
.rh-tb .rh-sel{width:auto;flex:0 1 auto;padding:8px 10px;font-size:13px;max-width:100%}
.rh-seg{display:flex;gap:3px;padding:3px;background:var(--rh-fill);border-radius:12px;overflow-x:auto;scrollbar-width:none;max-width:100%;min-width:0}
.rh-seg::-webkit-scrollbar{display:none}
.rh-chip{all:unset;cursor:pointer;padding:6px 11px;border-radius:9px;font:600 12.5px var(--rh-font);color:var(--text2);white-space:nowrap}
.rh-chip.on{background:var(--card,#fff);color:var(--text);box-shadow:0 1px 3px rgba(0,0,0,.12)}
.rh-chip i{font-style:normal;opacity:.6;margin-left:4px;font-variant-numeric:tabular-nums}
.rh-list{display:grid;gap:10px;min-width:0}
.rh-card{margin:0!important;display:grid;grid-template-columns:auto minmax(0,1fr);gap:12px;align-items:start;background:var(--card,#fff);border:1px solid var(--rh-hair);border-radius:var(--rh-r);padding:13px 14px;box-shadow:0 1px 2px rgba(0,0,0,.04);position:relative;overflow:hidden;min-width:0}
.rh-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--rh-k,transparent)}
.rh-card.bad{--rh-k:var(--rh-bad)}.rh-card.warn{--rh-k:var(--rh-warn)}.rh-card.done{opacity:.72}
.rh-rm{all:unset;box-sizing:border-box;cursor:pointer;min-width:62px;padding:9px 8px;border-radius:13px;text-align:center;font:700 19px/1 var(--mono,ui-monospace,SFMono-Regular,monospace);background:color-mix(in srgb,var(--rh-acc) 15%,transparent);color:var(--text)}
.rh-rm small{display:block;font:600 9px/1 var(--rh-font);letter-spacing:.08em;text-transform:uppercase;color:var(--text3);margin-bottom:5px}
.rh-rm:hover{background:color-mix(in srgb,var(--rh-acc) 24%,transparent)}
.rh-main{display:grid;gap:7px;min-width:0}
.rh-ttl{font:600 15px/1.38 var(--rh-font);overflow-wrap:anywhere;letter-spacing:-.005em}
.rh-ttl .em{margin-right:5px}
.rh-why{display:flex;flex-wrap:wrap;gap:5px}
.rh-tag{display:inline-flex;align-items:center;gap:4px;font:650 11.5px/1.2 var(--rh-font);padding:3px 8px;border-radius:99px;background:var(--rh-fill);color:var(--text2);white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}
.rh-tag.bad{background:color-mix(in srgb,var(--rh-bad) 13%,transparent);color:var(--rh-bad)}
.rh-tag.warn{background:color-mix(in srgb,var(--rh-warn) 15%,transparent);color:var(--rh-warn)}
.rh-tag.ok{background:color-mix(in srgb,var(--rh-ok) 13%,transparent);color:var(--rh-ok)}
.rh-src{font-size:12.5px;color:var(--text2);line-height:1.45;overflow-wrap:anywhere}
.rh-src q{quotes:"“" "”";color:var(--text)}
.rh-st{font-size:12.5px;color:var(--text2);display:flex;flex-wrap:wrap;gap:4px 10px}
.rh-st b{color:var(--text);font-weight:650}.rh-st .ok{color:var(--rh-ok)}
.rh-btns{display:flex;flex-wrap:wrap;gap:6px;align-items:center;min-width:0}
.rh-btns .rh-sel{width:auto;padding:6px 9px;font-size:12.5px;border-radius:99px;max-width:100%}
.rh-empty{background:var(--rh-soft);border:1px dashed var(--rh-hair);border-radius:var(--rh-r);padding:22px 16px;text-align:center;color:var(--text2);font-size:14px;line-height:1.5}
.rh-empty b{display:block;color:var(--text);font-size:15px;margin-bottom:3px}
.rh-pr{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:12px;align-items:center;background:var(--card,#fff);border:1px solid var(--rh-hair);border-radius:var(--rh-r);padding:11px 14px;min-width:0}
.rh-pr b{font-weight:650;font-size:14.5px;overflow-wrap:anywhere}
.rh-pr small{display:block;color:var(--text2);font-size:12px;margin-top:3px}
.rh-n{font:700 22px/1 var(--rh-font);font-variant-numeric:tabular-nums;color:var(--text2);text-align:right}
.rh-n.hot{color:var(--rh-warn)}
.rh-spark{display:flex;gap:3px;align-items:flex-end;height:18px;margin-top:6px}
.rh-spark i{display:block;width:7px;border-radius:2px;background:color-mix(in srgb,var(--text) 12%,transparent);min-height:3px}
.rh-spark i.on{background:var(--rh-warn)}
.rh-foot{font-size:12px;color:var(--text3);line-height:1.5}
.rh-more{justify-self:center}
.rh-modal-sc{position:fixed;inset:0;z-index:10000;background:rgba(10,14,22,.42);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:16px;animation:rhFade .16s ease}
.rh-modal{width:min(720px,100%);max-height:min(88vh,900px);display:flex;flex-direction:column;background:var(--card,#fff);color:var(--text);border-radius:20px;border:1px solid var(--rh-hair);box-shadow:0 30px 80px -20px rgba(0,0,0,.5);animation:rhUp .2s cubic-bezier(.2,.8,.2,1);overflow:hidden}
.rh-modal.sm{width:min(440px,100%)}
.rh-wa{display:flex;flex-direction:column;gap:8px;margin:0 0 12px;padding:12px 14px;border-radius:16px;background:linear-gradient(135deg,color-mix(in srgb,#25d366 12%,var(--card,#fff)),var(--card,#fff));border:1px solid color-mix(in srgb,#25d366 35%,transparent)}
.rh-wa-t{font-weight:700;font-size:.86rem}.rh-wa-b{display:flex;flex-wrap:wrap;gap:8px}
.rh-wa-c{display:inline-flex;align-items:center;gap:7px;padding:9px 12px;border-radius:12px;border:1px solid var(--rh-hair);background:var(--card,#fff);color:var(--text);cursor:pointer;font-size:.84rem;transition:transform .12s}.rh-wa-c:active{transform:scale(.96)}
.rh-wa-c i{font-style:normal;font-weight:800;font-size:.72rem;color:#fff;background:#25d366;border-radius:99px;padding:1px 7px}
.rh-wa-ta{width:100%;min-height:150px;padding:11px 12px;border-radius:12px;border:1px solid var(--rh-hair);background:var(--bg2,#f3f4f6);color:var(--text);font:500 14px/1.45 var(--rh-font);resize:vertical}
.rh-wa-prev{margin-top:10px;padding:12px 14px;border-radius:14px 14px 14px 4px;background:color-mix(in srgb,#25d366 14%,var(--card,#fff));font-size:14px;line-height:1.45;overflow-wrap:anywhere;max-width:92%}
@keyframes rhFade{from{opacity:0}to{opacity:1}}@keyframes rhUp{from{transform:translateY(16px);opacity:.5}to{transform:none;opacity:1}}
.rh-mh{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:16px 18px 12px;border-bottom:1px solid var(--rh-hair)}
.rh-mh h2{margin:0;font:700 18px/1.25 var(--rh-font)}
.rh-x{all:unset;cursor:pointer;width:32px;height:32px;border-radius:50%;display:grid;place-items:center;background:var(--rh-fill);color:var(--text2)}
.rh-mb{overflow-y:auto;padding:14px 18px 18px;display:grid;gap:14px;overscroll-behavior:contain}
.rh-mf{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;padding:12px 18px;border-top:1px solid var(--rh-hair)}
.rh-sec{display:grid;gap:10px}
.rh-sec h3{margin:0;font:700 11px/1.2 var(--rh-font);letter-spacing:.07em;text-transform:uppercase;color:var(--text3)}
.rh-dept{border:1px solid var(--rh-hair);border-radius:14px;padding:12px;display:grid;gap:10px;background:var(--rh-soft)}
.rh-row{display:grid;grid-template-columns:64px minmax(0,1fr) minmax(0,1.2fr);gap:8px;align-items:center}
.rh-row .rh-in{padding:8px 10px;font-size:13.5px}
.rh-kinds{display:grid;gap:8px}
.rh-kind{display:grid;grid-template-columns:minmax(0,1fr) 116px;gap:6px 8px;align-items:center}
.rh-kind label{font:600 13px var(--rh-font);min-width:0;overflow-wrap:anywhere}
.rh-kind .rh-ta{grid-column:1/-1;min-height:54px;font-size:12.5px;line-height:1.4;resize:vertical;padding:8px 10px}
.rh-kind .rh-sel{padding:6px 8px;font-size:12.5px}
.rh-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.rh-f{display:grid;gap:4px;font:600 12px var(--rh-font);color:var(--text2);min-width:0}
.rh-sw{display:flex;align-items:center;gap:10px;font-size:13.5px;cursor:pointer}
.rh-sw input{width:18px;height:18px;accent-color:var(--rh-acc)}
.rh-glist{display:grid;gap:6px}
.rh-hint{font-size:12.5px;color:var(--text2);line-height:1.5}
@media (max-width:860px){.rh-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:560px){
  .rh-card{grid-template-columns:minmax(0,1fr);gap:9px;padding:12px}
  .rh-card .rh-rm{justify-self:start;display:inline-flex;align-items:baseline;gap:6px;min-width:0;padding:6px 10px;font-size:16px}
  .rh-card .rh-rm small{display:inline;margin:0}
  .rh-row{grid-template-columns:54px minmax(0,1fr)}.rh-row .rh-in.g{grid-column:1/-1}
  .rh-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
  .rh-kpi b{font-size:22px}
  .rh-pr{grid-template-columns:auto minmax(0,1fr) auto;padding:10px 12px}
  .rh-modal-sc{align-items:flex-end;padding:0}.rh-modal{border-radius:20px 20px 0 0;max-height:92vh}
}`;
const active = () => { const p = doc.getElementById('panel-' + PANEL); return !!(p && p.classList.contains('active')); };
const root = () => doc.getElementById('rhRoot');
const SRC = { wa: 'WhatsApp', hk: 'HK request', ho: 'Handover', log: 'Front Office Log', note: 'Room note' };
const ago = ms => { const m = Math.round((Date.now() - ms) / 60e3); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 24 * 60 ? Math.round(m / 60) + ' h ago' : fmtD(dayOf(ms)); };
const whenTxt = ms => (dayOf(ms) === today() ? hm(ms) : fmtD(dayOf(ms)) + ' ' + hm(ms));

function filtered(list) {
  const q = R.q.trim().toLowerCase();
  return list.filter(x => (R.dept === 'all' || x.dept === R.dept) && (!R.kind || x.kind === R.kind) && (!R.floor || String(floorOf(x.room)) === R.floor)
    && (!q || rk(q) && rk(q) === x.rk || (!rk(q) && (String(x.title || x.say || '').toLowerCase().includes(q) || kindOf(x.kind).label.toLowerCase().includes(q) || String((x.latest && x.latest.text) || '').toLowerCase().includes(q)))));
}
function render() {
  const el = root(); if (!el) return;
  if (!R.at) compute();
  const S = R.sum || summary([], [], Date.now()), cfg = CFG(), C = CC();
  const deps = cfg.depts.filter(d => !d.off);
  const dd = deps.map(d => S.byDept[d.id] ? `${d.emoji} ${S.byDept[d.id]}` : '').filter(Boolean).join(' · ');
  const focus = doc.activeElement && doc.activeElement.id === 'rhQ', selS = focus ? [doc.activeElement.selectionStart, doc.activeElement.selectionEnd] : null;
  const head = `<div class="page-hd"><div class="page-hd-left"><h1>🩺 Room Health</h1><p>Room problems from WhatsApp, HK requests, handover, the Front Office Log and room notes — who to send, and which rooms keep breaking.</p></div>
    <div class="rh-acts"><button type="button" class="rh-btn sm" data-rh-act="reload" title="Read the sources again">⟳ Refresh</button>${canWrite() ? `<button type="button" class="rh-btn sm" data-rh-act="settings">⚙︎ Settings</button>` : ''}</div></div>`;
  const kpis = `<div class="rh-kpis" role="group" aria-label="Summary">
    <button type="button" class="rh-kpi ${S.high ? 'bad' : S.open ? 'warn' : 'ok'}" data-rh-act="view" data-v="advice"><small>Open problems</small><b>${S.open}</b><i>${esc(dd || 'nothing open')}</i></button>
    <button type="button" class="rh-kpi ${S.repeatRooms ? 'warn' : ''}" data-rh-act="view" data-v="rooms"><small>Repeat rooms</small><b>${S.repeatRooms}</b><i>same problem again · 30 days</i></button>
    <button type="button" class="rh-kpi ${S.arrivals ? 'bad' : ''}" data-rh-act="view" data-v="advice"><small>Arrivals at risk</small><b>${S.arrivals}</b><i>${S.arrivals ? 'fix before check-in' : 'none today'}</i></button>
    <button type="button" class="rh-kpi ok" data-rh-act="view" data-v="log"><small>Fixed this week</small><b>${S.fixedWeek}</b><i>closed by a reply or ✓</i></button></div>`;
  const views = [['advice', 'What to send', R.recs.length], ['rooms', 'Problem rooms', problemRooms(R.cases, R.range, Date.now()).filter(p => p.total >= 2).length], ['log', 'All problems', R.cases.length]];
  const floors = [...new Set(R.cases.map(c => floorOf(c.room)).filter(f => f != null))].sort((a, b) => a - b);
  const kinds = C.kinds.filter(k => R.cases.some(c => c.kind === k.id));
  const tb = `<div class="rh-tb"><div class="rh-seg" role="tablist" aria-label="View">${views.map(([k, l, n]) => `<button type="button" role="tab" aria-selected="${R.view === k}" class="rh-chip${R.view === k ? ' on' : ''}" data-rh-act="view" data-v="${k}">${l}<i>${n}</i></button>`).join('')}</div>
    ${R.view === 'rooms' ? `<div class="rh-seg" role="group" aria-label="Days">${[30, 90].map(n => `<button type="button" class="rh-chip${R.range === n ? ' on' : ''}" aria-pressed="${R.range === n}" data-rh-act="range" data-v="${n}">${n} days</button>`).join('')}</div>` : ''}</div>
    <div class="rh-tb"><input class="rh-in" id="rhQ" type="search" placeholder="Room or problem, e.g. 512 or leak" aria-label="Search" value="${esc(R.q)}" autocomplete="off">
    <div class="rh-seg" role="group" aria-label="Department">${[['all', 'All', '']].concat(deps.map(d => [d.id, d.short, d.emoji])).map(([k, l, e]) => `<button type="button" class="rh-chip${R.dept === k ? ' on' : ''}" aria-pressed="${R.dept === k}" data-rh-act="dept" data-v="${esc(k)}">${e ? e + ' ' : ''}${esc(l)}</button>`).join('')}</div>
    ${kinds.length ? `<select class="rh-sel" id="rhKind" aria-label="Problem"><option value="">All problems</option>${kinds.map(k => `<option value="${esc(k.id)}"${R.kind === k.id ? ' selected' : ''}>${esc(k.k.emoji + ' ' + k.k.label)}</option>`).join('')}</select>` : ''}
    ${floors.length > 1 ? `<select class="rh-sel" id="rhFloor" aria-label="Floor"><option value="">All floors</option>${floors.map(f => `<option value="${f}"${R.floor === String(f) ? ' selected' : ''}>Floor ${f}</option>`).join('')}</select>` : ''}</div>`;
  let body = '';
  if (R.view === 'rooms') body = roomsHtml();
  else if (R.view === 'log') body = logHtml();
  else body = adviceHtml();
  const L = linkInfo();
  const foot = `<div class="rh-foot">Reading WhatsApp ${R.loadedDays ? `(today + ${R.loadedDays} days of backup)` : '(today)'}, HK requests, the Handover Book, Front Office Log tickets and room notes. ${L && L.linked ? 'WhatsApp reader linked — Send posts in the department\'s group.' : 'WhatsApp reader not linked — Send copies the message and opens the WhatsApp window.'} Messages HotelOps sends are never read back as problems.</div>`;
  el.innerHTML = head + kpis + tb + body + foot;
  if (focus) { const q = doc.getElementById('rhQ'); if (q) { q.focus(); try { q.setSelectionRange(selS[0], selS[1]); } catch (_) {} } }
}
function cardHtml(r, compact) {
  const d = deptOf(r.dept), K = kindOf(r.kind), a = actOf(r.id), s = r.sent;
  const tone = r.arrival || r.follow ? 'bad' : r.type === 'repeat' || r.sev === 'high' ? 'warn' : '';
  const others = CFG().depts.filter(x => !x.off && x.id !== r.dept);
  const e = r.latest;
  const src = e ? `<div class="rh-src"><q>${esc(String(e.text || '').slice(0, 180))}</q> · ${esc(SRC[e.source] || e.source)}${e.who ? ' · ' + esc(e.who) : ''} · ${esc(whenTxt(e.at))}</div>` : '';
  const st = s ? `<div class="rh-st"><span>📨 <b>Sent to ${esc(deptOf(s.dept).name)}</b> ${esc(whenTxt(s.at))}${s.by ? ' · by ' + esc(s.by) : ''}${s.via === 'copy' ? ' · copied' : s.group ? ' · ' + esc(s.group) : ''}</span>${a.followed && r.follow ? '<span>⏰ follow-up shown</span>' : ''}</div>` : '';
  const can = canWrite();
  const btns = can ? `<div class="rh-btns"><button type="button" class="rh-btn sm ${s && !r.follow ? '' : 'pri'}" data-rh-act="send" data-id="${esc(r.id)}">${r.follow ? '⏰ Chase' : s ? '↻ Send again to' : d.emoji + ' Send to'} ${esc(d.short)}</button>
      <button type="button" class="rh-btn sm" data-rh-act="copy" data-id="${esc(r.id)}" title="Copy the message">⧉ Copy</button>
      ${(r.dept === 'eng' || r.dept === 'it') && !compact ? `<button type="button" class="rh-btn sm" data-rh-act="ticket" data-id="${esc(r.id)}" title="Open a Front Office Log maintenance ticket">🔧 Ticket</button>` : ''}
      <button type="button" class="rh-btn sm ok" data-rh-act="fixed" data-id="${esc(r.id)}">✓ Fixed</button>
      ${others.length && !compact ? `<select class="rh-sel" data-rh-other="${esc(r.id)}" aria-label="Send to another department"><option value="">Send to…</option>${others.map(x => `<option value="${esc(x.id)}">${esc(x.emoji + ' ' + x.name)}</option>`).join('')}</select>` : ''}</div>` : '';
  return `<article class="rh-card ${tone}" data-id="${esc(r.id)}"><button type="button" class="rh-rm" data-room-card="${esc(r.room)}" aria-label="Room card ${esc(r.room)}"><small>Room</small>${esc(r.room)}</button>
    <div class="rh-main"><div class="rh-ttl"><span class="em" aria-hidden="true">${esc(K.emoji)}</span>${esc(r.title)}</div>
    ${r.reasons && r.reasons.length ? `<div class="rh-why">${r.reasons.map(x => `<span class="rh-tag ${x[2]}">${x[0]} ${esc(x[1])}</span>`).join('')}</div>` : ''}
    ${src}${st}${btns}</div></article>`;
}
function adviceHtml() {
  const L = filtered(R.recs);
  if (!L.length) {
    const any = R.recs.length;
    return `<div class="rh-empty"><b>${any ? 'Nothing matches' : 'No room problem waiting'}</b>${any ? 'Try another department, problem or floor.' : 'When the team writes about an AC, a leak, a smell, bugs, Wi-Fi or noise in a room, the advice shows here — with who to send.'}</div>`;
  }
  const lim = R.more ? 200 : 30;
  return waCopyBar() + `<div class="rh-list">${L.slice(0, lim).map(r => cardHtml(r)).join('')}</div>${L.length > lim ? `<button type="button" class="rh-btn sm rh-more" data-rh-act="more">Show all ${L.length}</button>` : ''}`;
}
function roomsHtml() {
  const C = CC(), now = Date.now();
  if (R.range > R.loadedDays && !R.loading) ensureData(R.range);
  const q = R.q.trim();
  const P = problemRooms(R.cases.filter(c => (R.dept === 'all' || c.dept === R.dept) && (!R.kind || c.kind === R.kind) && (!R.floor || String(floorOf(c.room)) === R.floor)), R.range, now)
    .filter(p => !q || (rk(q) ? p.rk === rk(q) : kindsLine(p.kinds, C).toLowerCase().includes(q.toLowerCase())));
  if (!P.length) return `<div class="rh-empty"><b>No problem rooms</b>No room had a problem in the last ${R.range} days${R.loading ? ' (still reading the WhatsApp backup…)' : ''}.</div>`;
  const max = Math.max(1, ...P.map(p => Math.max(...p.buckets)));
  return `<div class="rh-list">${P.slice(0, R.more ? 300 : 40).map(p => `<div class="rh-pr"><button type="button" class="rh-rm" data-room-card="${esc(p.room)}" aria-label="Room card ${esc(p.room)}"><small>Room</small>${esc(p.room)}</button>
    <div style="min-width:0"><b>${esc(kindsLine(p.kinds.slice(0, 4), C))}${p.kinds.length > 4 ? ' · …' : ''}</b><small>Last ${esc(fmtD(dayOf(p.last)))}${p.open ? ` · <span style="color:var(--rh-bad)">${p.open} open</span>` : ''}</small>
    <div class="rh-spark" aria-hidden="true" title="Problems over ${R.range} days">${p.buckets.map(n => `<i class="${n ? 'on' : ''}" style="height:${n ? Math.max(5, Math.round(n / max * 18)) : 3}px"></i>`).join('')}</div></div>
    <div class="rh-n${p.total >= 3 ? ' hot' : ''}" title="Problems in ${R.range} days">${p.total}</div></div>`).join('')}</div>${P.length > 40 && !R.more ? `<button type="button" class="rh-btn sm rh-more" data-rh-act="more">Show all ${P.length}</button>` : ''}`;
}
function logHtml() {
  const C = CC(), now = Date.now();
  const L = filtered(R.cases.map(c => Object.assign({}, c, { say: sayOf(c.kind, c.reports.map(e => e.text), C), latest: c.reports[c.reports.length - 1] })));
  if (!L.length) return `<div class="rh-empty"><b>No problems found</b>Nothing in the messages, requests, handover, logs or notes${R.q || R.kind || R.floor || R.dept !== 'all' ? ' for this search' : ''}.</div>`;
  const ST = { open: ['🟠 Open', 'warn'], fixed: ['✅ Fixed', 'ok'], stale: ['· No news', ''] };
  return `<div class="rh-list">${L.slice(0, R.more ? 400 : 60).map(c => {
    const K = kindOf(c.kind), s = ST[c.status] || ST.open, a = actOf(c.id), e = c.latest;
    return `<article class="rh-card ${c.status === 'fixed' || c.status === 'stale' ? 'done' : c.sev === 'high' ? 'warn' : ''}"><button type="button" class="rh-rm" data-room-card="${esc(c.room)}" aria-label="Room card ${esc(c.room)}"><small>Room</small>${esc(c.room)}</button>
      <div class="rh-main"><div class="rh-ttl"><span class="em" aria-hidden="true">${esc(K.emoji)}</span>${esc(c.say.charAt(0).toUpperCase() + c.say.slice(1))}${c.reports.length > 1 ? ` <span style="color:var(--text2);font-weight:500">· asked ${c.reports.length}×</span>` : ''}</div>
      <div class="rh-why"><span class="rh-tag ${s[1]}">${s[0]}</span><span class="rh-tag">${esc(deptOf(c.dept).emoji + ' ' + deptOf(c.dept).short)}</span>${c.sev === 'high' ? '<span class="rh-tag bad">⚠️ High</span>' : ''}${c.repeat ? `<span class="rh-tag warn">🔁 ${Math.max(c.n30, c.n7)}× in 30 days</span>` : ''}</div>
      ${e ? `<div class="rh-src"><q>${esc(String(e.text || '').slice(0, 180))}</q> · ${esc(SRC[e.source] || e.source)}${e.who ? ' · ' + esc(e.who) : ''} · ${esc(whenTxt(e.at))}</div>` : ''}
      <div class="rh-st">${a.sent ? `<span>📨 Sent to ${esc(deptOf(a.sent.dept).name)} ${esc(whenTxt(a.sent.at))}</span>` : ''}${c.status === 'fixed' ? `<span class="ok">✓ Fixed ${esc(whenTxt(c.fixedAt))}${c.fixedBy ? ' · ' + esc(c.fixedBy) : ''}${c.fixedHow === 'tap' ? '' : c.fixText ? ' · “' + esc(String(c.fixText).slice(0, 60)) + '”' : ''}</span>` : ''}<span>First ${esc(ago(c.first))}</span></div></div></article>`;
  }).join('')}</div>${L.length > 60 && !R.more ? `<button type="button" class="rh-btn sm rh-more" data-rh-act="more">Show all ${L.length}</button>` : ''}`;
}

// ── the room card section (room-card.js calls window.hoRoomHealth.cardHtml) ──
function forRoom(room) {
  const r = rk(room); if (!r) return { open: [], recs: [], history: [], kinds: [] };
  if (!R.at || Date.now() - R.at > 60e3) compute();
  const now = Date.now(), H = R.cases.filter(c => c.rk === r && c.first >= now - 90 * 864e5);
  const kinds = {}; H.forEach(c => { kinds[c.kind] = (kinds[c.kind] || 0) + 1; });
  return { open: H.filter(c => c.status === 'open'), recs: R.recs.filter(x => x.rk === r), history: H, kinds: Object.entries(kinds).map(([kind, n]) => ({ kind, n })).sort((a, b) => b.n - a.n) };
}
function roomCardHtml(room) {
  if (!allowed()) return '';
  const F = forRoom(room); if (!F.history.length && !F.recs.length) return '';
  const C = CC(), last = F.history.filter(c => c.status !== 'open')[0];
  const lines = F.recs.map(r => {
    const d = deptOf(r.dept);
    return `<div class="rc-line"><span>${esc(kindOf(r.kind).emoji)} <b>${esc(r.say)}</b>${r.cnt ? ' · reported ' + r.cnt + '× ' + esc(r.since) : ''}${r.arrival ? ' · 🛎️ arrival today' : ''}${r.sent ? ' · 📨 sent ' + esc(whenTxt(r.sent.at)) : ''}</span>
      ${canWrite() ? `<span class="rc-acts"><button type="button" class="rc-btn sm${r.sent && !r.follow ? '' : ' pri'}" data-rh-act="send" data-id="${esc(r.id)}">${r.follow ? '⏰ Chase' : esc(d.emoji) + ' Send to'} ${esc(d.short)}</button><button type="button" class="rc-btn sm" data-rh-act="fixed" data-id="${esc(r.id)}">✓ Fixed</button></span>` : ''}</div>`;
  }).join('');
  return `<section class="rc-sec" aria-label="Room health"><div class="rc-h">🩺 Room health <em>${esc(kindsLine(F.kinds.slice(0, 4), C))} · 90 days</em></div><div class="rc-box">
    ${lines || `<div class="rc-line"><span class="dim">No open problem.${last ? ` Last: ${esc(sayOf(last.kind, last.reports.map(e => e.text), C))} ${last.status === 'fixed' ? 'fixed' : 'reported'} ${esc(fmtD(dayOf(last.fixedAt || last.last)))}.` : ''}</span></div>`}
    <div class="rc-acts"><button type="button" class="rc-btn sm" data-rh-act="page" data-room="${esc(room)}">🩺 Open Room Health</button></div></div></section>`;
}

// ── windows: settings and "which group?" ──
function closeModal() { const m = doc.getElementById('rh-modal'); if (m) m.remove(); }
function modal(html, cls) {
  closeModal();
  const sc = doc.createElement('div'); sc.id = 'rh-modal'; sc.className = 'rh-modal-sc';
  sc.innerHTML = `<div class="rh-modal ${cls || ''}" role="dialog" aria-modal="true">${html}</div>`;
  sc.addEventListener('click', e => { if (e.target === sc) closeModal(); });
  doc.body.appendChild(sc);
  return sc;
}
function pickGroup(d) {
  return new Promise(res => {
    const G = groupNames();
    const sc = modal(`<div class="rh-mh"><h2>${esc(d.emoji)} ${esc(d.name)} group</h2><button type="button" class="rh-x" data-x aria-label="Close">✕</button></div>
      <div class="rh-mb"><div class="rh-hint">Which WhatsApp group should ${esc(d.name)} messages go to? HotelOps remembers it for the whole hotel (change it in ⚙︎ Settings).</div>
      ${G.length ? `<div class="rh-glist">${G.map(g => `<button type="button" class="rh-btn" data-g="${esc(g)}" style="justify-content:flex-start">💬 ${esc(g)}</button>`).join('')}</div>` : ''}
      <label class="rh-f">Or type the group name<input class="rh-in" id="rhGName" maxlength="80" placeholder="e.g. Engineering team"></label></div>
      <div class="rh-mf"><button type="button" class="rh-btn" data-x>Cancel</button><button type="button" class="rh-btn pri" data-ok>Use this group</button></div>`, 'sm');
    const done = g => { closeModal(); if (g) { const next = JSON.parse(JSON.stringify(R.saved || {})); next.depts = next.depts || {}; next.depts[d.id] = Object.assign({}, next.depts[d.id], { group: g }); saveCfg(next, `${d.name} WhatsApp group: ${g}`); } res(g || ''); };
    sc.addEventListener('click', e => {
      const t = e.target.closest('button'); if (!t) return;
      if (t.hasAttribute('data-x')) done('');
      else if (t.dataset.g) done(t.dataset.g);
      else if (t.hasAttribute('data-ok')) { const v = (doc.getElementById('rhGName').value || '').trim(); if (!v) { toast('Pick or type a group', 'warn'); return; } done(v); }
    });
    setTimeout(() => safe(() => doc.getElementById('rhGName').focus()), 40);
  });
}
function settingsDialog() {
  if (!canWrite()) return;
  const cfg = CFG(), lead = isLead(), G = groupNames(), th = cfg.th;
  const dis = lead ? '' : ' disabled';
  const kindRow = k => `<div class="rh-kind" data-kind="${esc(k.id)}"><label>${esc(k.emoji)} ${esc(k.label)}</label>
      <select class="rh-sel" data-f="sev" aria-label="Severity for ${esc(k.label)}"${dis}>${['low', 'med', 'high'].map(s => `<option value="${s}"${k.sev === s ? ' selected' : ''}>${{ low: 'Low', med: 'Medium', high: 'High' }[s]}</option>`).join('')}</select>
      <textarea class="rh-ta" data-f="kw" rows="2" aria-label="Words for ${esc(k.label)}"${dis}>${esc(k.kw || '')}</textarea></div>`;
  const deptBox = d => `<div class="rh-dept" data-dept="${esc(d.id)}"><div class="rh-row"><input class="rh-in" data-f="emoji" maxlength="4" value="${esc(d.emoji)}" aria-label="Emoji"${dis}><input class="rh-in" data-f="name" maxlength="40" value="${esc(d.name)}" aria-label="Department name"${dis}>
      <input class="rh-in g" data-f="group" maxlength="80" value="${esc(d.group || '')}" placeholder="WhatsApp group" list="rhGroups" aria-label="WhatsApp group for ${esc(d.name)}"></div>
      <div class="rh-kinds">${cfg.kinds.filter(k => k.dept === d.id).map(kindRow).join('')}</div>
      ${lead ? `<div class="rh-acts"><button type="button" class="rh-btn sm" data-add-kind="${esc(d.id)}">＋ Problem type</button></div>` : ''}</div>`;
  const sc = modal(`<div class="rh-mh"><h2>⚙︎ Room Health settings</h2><button type="button" class="rh-x" data-x aria-label="Close">✕</button></div>
    <div class="rh-mb"><datalist id="rhGroups">${G.map(g => `<option value="${esc(g)}">`).join('')}</datalist>
    <div class="rh-sec"><h3>Departments and their words</h3><div class="rh-hint">Words are separated by commas. A word starting with <b>~</b> counts only when nothing clearer is written (e.g. <i>~door</i>). Typos of long words are understood. ${lead ? '' : 'Only supervisors and managers can change words; you can set the WhatsApp groups.'}</div>
    <div id="rhDepts" class="rh-sec">${cfg.depts.map(deptBox).join('')}</div>${lead ? '<div class="rh-acts"><button type="button" class="rh-btn sm" data-add-dept>＋ Department</button></div>' : ''}</div>
    <div class="rh-sec"><h3>When is it a repeat problem</h3><div class="rh-grid">
      <label class="rh-f">Times in 7 days<input class="rh-in" type="number" min="2" max="20" id="rhT7" value="${th.rep7}"${dis}></label>
      <label class="rh-f">Times in 30 days<input class="rh-in" type="number" min="2" max="50" id="rhT30" value="${th.rep30}"${dis}></label>
      <label class="rh-f">Follow-up after (hours)<input class="rh-in" type="number" min="1" max="48" id="rhTF" value="${th.followH}"${dis}></label>
      <label class="rh-f">Open for (days)<input class="rh-in" type="number" min="1" max="30" id="rhTS" value="${th.staleD}"${dis}></label>
      <label class="rh-f">Check-in time<input class="rh-in" type="time" id="rhTC" value="${esc(th.checkIn)}"${dis}></label></div>
      <div class="rh-hint">The follow-up shows once, only for a high-severity problem with no "fixed" reply.</div></div>
    <div class="rh-sec"><h3>Nudges</h3>
      ${[['arrival', 'An arrival today goes into a room with an open problem'], ['repeat', 'A problem comes back (repeat)'], ['high', 'A high-severity problem is reported'], ['follow', 'No fix reply after the follow-up time'], ['toast', 'Also show a message once (not only in Ops Brain)']].map(([k, l]) => `<label class="rh-sw"><input type="checkbox" data-n="${k}"${cfg.nudge[k] ? ' checked' : ''}${dis}> ${esc(l)}</label>`).join('')}</div>
    <div class="rh-sec"><h3>When something is sent</h3>
      <label class="rh-sw"><input type="checkbox" data-a="note"${cfg.also.note ? ' checked' : ''}${dis}> Add a room note ("Sent Engineering for AC")</label>
      <label class="rh-sw"><input type="checkbox" data-a="handover"${cfg.also.handover ? ' checked' : ''}${dis}> Add a handover item for the next shift</label></div></div>
    <div class="rh-mf">${lead ? '<button type="button" class="rh-btn" data-reset style="margin-right:auto">Reset words</button>' : ''}<button type="button" class="rh-btn" data-x>Cancel</button><button type="button" class="rh-btn pri" data-save>Save</button></div>`);
  const newId = p => p + Date.now().toString(36).slice(-5);
  sc.addEventListener('click', e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.hasAttribute('data-x')) { closeModal(); return; }
    if (t.hasAttribute('data-add-dept')) {
      const id = newId('d'), box = doc.createElement('div');
      box.innerHTML = deptBox({ id, name: '', emoji: '🛎️', group: '' }); const el = box.firstElementChild; el.dataset.new = '1';
      sc.querySelector('#rhDepts').appendChild(el); safe(() => el.querySelector('[data-f="name"]').focus()); return;
    }
    if (t.dataset.addKind) {
      const label = (prompt('Name of the problem type (e.g. Balcony door)') || '').trim(); if (!label) return;
      const id = newId('k'), box = doc.createElement('div');
      box.innerHTML = kindRow({ id, label, emoji: '•', sev: 'med', kw: label.toLowerCase() }); const el = box.firstElementChild; el.dataset.new = '1'; el.dataset.label = label;
      t.closest('.rh-dept').querySelector('.rh-kinds').appendChild(el); safe(() => el.querySelector('textarea').focus()); return;
    }
    if (t.hasAttribute('data-reset')) { if (!confirm('Put back the original words and severities? Groups and departments you added stay.')) return; const next = JSON.parse(JSON.stringify(R.saved || {})); Object.keys(next.kinds || {}).forEach(k => { if (DEFAULT_KINDS.some(x => x.id === k)) { delete next.kinds[k].kw; delete next.kinds[k].sev; } }); saveCfg(next, 'Room Health words reset'); closeModal(); toast('Words reset'); return; }
    if (t.hasAttribute('data-save')) {
      const next = JSON.parse(JSON.stringify(R.saved || {})); next.depts = next.depts || {}; next.kinds = next.kinds || {};
      sc.querySelectorAll('.rh-dept').forEach(box => {
        const id = box.dataset.dept, v = f => (box.querySelector(`[data-f="${f}"]`) || {}).value;
        const name = String(v('name') || '').trim(), group = String(v('group') || '').trim(), emoji = String(v('emoji') || '').trim();
        if (box.dataset.new && !name) return;
        const o = Object.assign({}, next.depts[id], { group });
        if (lead) { if (name) { o.name = name; o.short = DEFAULT_DEPTS.some(x => x.id === id) && id !== 'hk' ? name : (id === 'hk' && name === 'Housekeeping' ? 'HK' : name); } if (emoji) o.emoji = emoji; }
        next.depts[id] = o;
        if (lead) box.querySelectorAll('.rh-kind').forEach(kb => {
          const kid = kb.dataset.kind, kw = (kb.querySelector('[data-f="kw"]') || {}).value || '', sev = (kb.querySelector('[data-f="sev"]') || {}).value || 'med';
          const def = DEFAULT_KINDS.find(x => x.id === kid), cur = Object.assign({}, next.kinds[kid]);
          if (def) { if (kw.trim() !== def.kw) cur.kw = kw.trim(); else delete cur.kw; if (sev !== def.sev) cur.sev = sev; else delete cur.sev; }
          else { cur.kw = kw.trim(); cur.sev = sev; cur.dept = id; if (kb.dataset.label) cur.label = kb.dataset.label; }
          if (Object.keys(cur).length) next.kinds[kid] = cur; else delete next.kinds[kid];
        });
      });
      if (lead) {
        const n = id => +((doc.getElementById(id) || {}).value || 0);
        next.th = { rep7: n('rhT7'), rep30: n('rhT30'), followH: n('rhTF'), staleD: n('rhTS'), checkIn: (doc.getElementById('rhTC') || {}).value || '14:00' };
        next.nudge = {}; sc.querySelectorAll('[data-n]').forEach(x => { next.nudge[x.dataset.n] = !!x.checked; });
        next.also = {}; sc.querySelectorAll('[data-a]').forEach(x => { next.also[x.dataset.a] = !!x.checked; });
      }
      saveCfg(next); closeModal(); toast('Room Health settings saved');
    }
  });
}

// ── clicks anywhere (the page, the room card, Ops Brain) ──
function onDocClick(e) {
  const t = e.target && e.target.closest ? e.target.closest('[data-rh-act]') : null; if (!t) return;
  const a = t.dataset.rhAct, id = t.dataset.id;
  e.preventDefault();
  safe(() => {
    if (a === 'send') send(id);
    else if (a === 'fixed') markFixed(id);
    else if (a === 'copy') { const r = findRec(id); if (r) copyText(compose(r, deptOf(r.dept), { cfg: CFG() })).then(ok => toast(ok ? 'Message copied' : 'Could not copy', ok ? 'ok' : 'err')); }
    else if (a === 'ticket') ticket(id);
    else if (a === 'wamsg') waMsgDialog(t.dataset.v);
    else if (a === 'settings') settingsDialog();
    else if (a === 'reload') { R.todayAt = 0; COMPILED.clear(); toast('Reading the sources again…', 'info'); loadToday(true).then(() => ensureData(Math.max(30, R.range))); refresh(true); }
    else if (a === 'view') { R.view = t.dataset.v; R.more = false; saveView(); render(); }
    else if (a === 'range') { R.range = +t.dataset.v; saveView(); render(); if (R.range > R.loadedDays) ensureData(R.range); }
    else if (a === 'dept') { R.dept = t.dataset.v; saveView(); render(); }
    else if (a === 'more') { R.more = true; render(); }
    else if (a === 'page') { safe(() => { if (W.hoRoom && W.hoRoom.close) W.hoRoom.close(); }); go(rk(t.dataset.room) || ''); }
  });
}
function refresh(now) {
  clearTimeout(refresh.t);
  refresh.t = setTimeout(() => safe(() => { compute(); if (active() && !doc.getElementById('rh-modal') && !(doc.activeElement && doc.activeElement.tagName === 'SELECT' && root() && root().contains(doc.activeElement))) render(); }), now ? 10 : 250);
}
function badge() {
  const n = R.sum ? R.sum.arrivals + R.recs.filter(r => r.follow && !r.followed).length : 0;
  ['badge-' + PANEL, 'mob-badge-' + PANEL].forEach(id => { const b = doc.getElementById(id); if (b) { b.textContent = n ? String(n) : ''; b.style.display = n ? '' : 'none'; } });
}

function mount() {
  if (doc.getElementById('panel-' + PANEL)) return;
  const main = doc.querySelector('main.main') || doc.querySelector('main');
  const nav = doc.querySelector('nav.sidenav') || doc.querySelector('nav');
  if (!main || !nav) { console.warn('[room-health] app layout not found; panel not added'); return; }
  const st = doc.createElement('style'); st.id = 'rh-style'; st.textContent = CSS; doc.head.appendChild(st);
  const panel = doc.createElement('div'); panel.className = 'panel'; panel.id = 'panel-' + PANEL; panel.innerHTML = '<div id="rhRoot"></div>';
  main.appendChild(panel);
  panel.addEventListener('input', e => { if (e.target.id === 'rhQ') { R.q = e.target.value; R.more = false; clearTimeout(R.qt); R.qt = setTimeout(render, 140); } });
  panel.addEventListener('change', e => safe(() => {
    const t = e.target;
    if (t.id === 'rhKind') { R.kind = t.value; render(); }
    else if (t.id === 'rhFloor') { R.floor = t.value; render(); }
    else if (t.dataset.rhOther) { const v = t.value; t.value = ''; if (v) send(t.dataset.rhOther, v); }
  }));
  doc.addEventListener('click', onDocClick);
  doc.addEventListener('keydown', e => { if (e.key === 'Escape' && doc.getElementById('rh-modal')) { e.stopPropagation(); closeModal(); } }, true);
  // the menu: Front Desk, after HK Requests (nav-order.js lists it)
  safe(() => { if (typeof HOX_ICONS !== 'undefined' && typeof _hoI === 'function' && !HOX_ICONS[PANEL]) HOX_ICONS[PANEL] = _hoI('<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M8.5 15h2l1-2.2 2 4.4 1-2.2h1"/>'); });
  const item = doc.createElement('div');
  item.className = 'nav-item'; item.id = 'nav-' + PANEL; item.dataset.panel = PANEL;
  item.setAttribute('onclick', "showPanel('" + PANEL + "')");
  item.innerHTML = '<div class="nav-icon">🩺</div>Room Health<span class="nav-badge" id="badge-' + PANEL + '" style="display:none"></span>';
  const anchor = doc.getElementById('nav-hk-requests') || doc.getElementById('nav-ops-logs');
  if (anchor && anchor.parentNode === nav) anchor.after(item); else nav.appendChild(item);
  const grid = doc.querySelector('.mob-more-grid');
  if (grid) {
    const b = doc.createElement('button'); b.className = 'mob-more-item'; b.dataset.panel = PANEL; b.type = 'button';
    b.setAttribute('onclick', "showPanel('" + PANEL + "');(typeof closeMobMore==='function'?closeMobMore:typeof toggleMobMore==='function'?toggleMobMore:function(){})()");
    b.innerHTML = '<span class="mob-item-icon">🩺</span><span class="mob-more-badge" id="mob-badge-' + PANEL + '"></span>Room Health';
    const after = grid.querySelector('.mob-more-item[data-panel="hk-requests"]') || grid.querySelector('.mob-more-item[data-panel="ops-logs"]');
    if (after) after.after(b); else grid.appendChild(b);
  }
  if (typeof hoApplyIcons === 'function') safe(() => hoApplyIcons());
  safe(() => { if (typeof W.hoNavOrder === 'function') W.hoNavOrder(); });
  // the roles that see the front desk pages see it by default (Team → Roles & access can change it)
  safe(() => {
    if (typeof ROLES !== 'undefined') Object.keys(ROLES).forEach(r => { const p = ROLES[r] && ROLES[r].panels; if (p && (p.includes('hk-requests') || p.includes('shifts')) && !p.includes(PANEL)) p.push(PANEL); });
    if (typeof currentProfile !== 'undefined' && currentProfile && typeof applyRole === 'function') applyRole(currentProfile.role);
  });
  let wasOn = false;
  new MutationObserver(() => { const on = panel.classList.contains('active'); if (on && !wasOn) { compute(); render(); ensureData(Math.max(30, R.range)); } wasOn = on; }).observe(panel, { attributes: true, attributeFilter: ['class'] });
  // calm: a look every minute (new messages, the follow-up time), the page redrawn only when nobody is typing in it
  setInterval(() => safe(() => {
    compute(); nudge();
    if (active() && !doc.getElementById('rh-modal') && !(doc.activeElement && root() && root().contains(doc.activeElement) && /INPUT|SELECT|TEXTAREA/.test(doc.activeElement.tagName))) render();
    if (active()) loadToday().then(ch => { if (ch) refresh(); });
  }), 60e3);
  render(); startSync();
  // the first read: 30 days of backup a little after start, so the app opens fast
  setTimeout(() => ensureData(30), 6000);
}

W.hoRoomHealth = { render: () => render(), refresh: () => refresh(true), forRoom, cardHtml: roomCardHtml, recs: () => R.recs.slice(), cases: () => R.cases.slice(), summary: () => R.sum, send, fixed: markFixed, compose: id => { const r = findRec(id); return r ? compose(r, deptOf(r.dept), { cfg: CFG() }) : ''; }, load: d => ensureData(d || 30), state: () => R, settings: settingsDialog, cfg: CFG, pure: PURE };
if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', mount); else mount();
})();
