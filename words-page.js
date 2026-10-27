// ═══════════════════════════════════════════════════════════
//  words-page.js — 📖 Words & phrases
//
//  Every word HotelOps understands, in one place: the built-in words that
//  sort HK requests, Handover Book topics and Room Health problems, the
//  WhatsApp reader's commands, the team's own dictionary and the voice
//  phrases. A search box filters them all; "🧪 Try a message" shows how a
//  message is read.
//
//  Owners and managers can change them (everyone else reads):
//   • HK requests / Handover topics: extra words go to the hotel setup
//     (settings/setup → cats[kind][id].words) and built-in words the team
//     uses differently are removed with cats[kind][id].drop = [words]
//     (hotel-setup.js keepHit: a match on a removed word does not count).
//     Rename, emoji and switch off are the same settings as Settings →
//     Hotel setup → Categories.
//   • Room Health problems: its own word lists (roomHealth/cfg kinds[id].kw).
//   • WhatsApp commands and the dictionary: window.hoWaWords (waWords/{word}).
//  The built-in patterns are turned into readable words by reWords()
//  ("towels?" → towel, towels; "bath ?mat" → bath mat, bathmat).
//  Pure helpers: window.hoWordsPure (tested in tests/run-tests.js).
//  Load after hotel-setup.js, wa-brain.js, handover-book.js, room-health.js.
// ═══════════════════════════════════════════════════════════
(function () {
'use strict';
const W = typeof window !== 'undefined' ? window : globalThis;
const doc = typeof document !== 'undefined' && document && document.createElement ? document : null;
const PANEL = 'vocab';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safe = (f, d) => { try { return f(); } catch (e) { return d; } };
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const clone = v => (v == null ? v : JSON.parse(JSON.stringify(v)));
const norm = s => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
const plural = (n, w, ws) => n + ' ' + (n === 1 ? w : (ws || w + 's'));

// ══ Patterns → readable words (pure) ════════════════════════
// A small reader for the patterns the modules use: words, (?:a|b) choices, x? optional, \s, \w*,
// [ab] letters, look-arounds (left out: they only say where a word does not count).
const LIMIT = 24;            // one alternative with more spellings than this is written short: "mov(e|ed|ing) (to|from)"
function reParse(src) {
  let i = 0;
  const bs = c => {
    switch (c) {
      case 'b': case 'B': return { t: 'none', b: 1 };
      case 's': case 'n': case 't': case 'r': return { t: 'sp' };
      case 'd': return { t: 'd' };
      case 'w': case 'W': case 'S': case 'D': return { t: 'w' };
      case 'p': case 'P': { const m = /^\{[^}]*\}/.exec(src.slice(i)); if (m) i += m[0].length; return { t: 'w' }; }
      case 'u': { const m = /^[0-9a-fA-F]{4}/.exec(src.slice(i)); if (!m) return { t: 'lit', s: 'u' }; i += 4; const ch = String.fromCharCode(parseInt(m[0], 16)); return /\s/.test(ch) ? { t: 'sp' } : { t: 'lit', s: ch }; }
      default: return { t: 'lit', s: c == null ? '' : c };
    }
  };
  const cls = () => {
    let neg = false, range = false; const chars = [];
    if (src[i] === '^') { neg = true; i++; }
    while (i < src.length && src[i] !== ']') {
      let c = src[i++], x;
      if (c === '\\') { const e = bs(src[i++]); x = e.t === 'lit' ? e.s : e.t === 'sp' ? ' ' : e.t === 'd' ? '#' : e.t === 'none' ? null : '…'; }
      else x = c;
      if (src[i] === '-' && i + 1 < src.length && src[i + 1] !== ']') { i += 2; if (src[i - 1] === '\\') i++; range = true; continue; }
      if (x != null && !chars.includes(x)) chars.push(x);
    }
    i++;
    return neg || range || chars.includes('…') ? { t: 'w' } : { t: 'cls', chars };
  };
  const atom = () => {
    const c = src[i++];
    if (c === '(') {
      let look = false;
      const m = /^\?(?::|=|!|<=|<!|<[A-Za-z_]\w*>)/.exec(src.slice(i));
      if (m) { look = /^\?(?:=|!|<=|<!)$/.test(m[0]); i += m[0].length; }
      const n = alt(); if (src[i] === ')') i++;
      return look ? { t: 'none', look: 1 } : { t: 'grp', n };
    }
    if (c === '[') return cls();
    if (c === '\\') return bs(src[i++]);
    if (c === '.') return { t: 'w' };
    if (c === '^' || c === '$') return { t: 'none', b: 1 };
    return { t: 'lit', s: c };
  };
  const quant = a => {
    let min = 1, max = 1; const c = src[i];
    if (c === '?') { min = 0; i++; }
    else if (c === '*') { min = 0; max = Infinity; i++; }
    else if (c === '+') { max = Infinity; i++; }
    else if (c === '{') { const m = /^\{(\d+)(,(\d*))?\}/.exec(src.slice(i)); if (m) { min = +m[1]; max = m[2] ? (m[3] ? +m[3] : Infinity) : min; i += m[0].length; } }
    if (src[i] === '?' && (min !== 1 || max !== 1)) i++;                       // lazy
    return { a, min, max };
  };
  function seq() { const items = []; while (i < src.length && src[i] !== '|' && src[i] !== ')') items.push(quant(atom())); return { t: 'seq', items }; }
  function alt() { const alts = [seq()]; while (src[i] === '|') { i++; alts.push(seq()); } return { t: 'alt', alts }; }
  const n = alt();
  return n;
}
const blank = s => !String(s).trim();
/** one written-out spelling: tidy spaces, "pick- up" → "pick-up", "leak……" → "leak…" */
const tidy = s => String(s).replace(/\s+/g, ' ').replace(/\s*-\s*/g, '-').replace(/\s*&\s*/g, ' & ').replace(/…+/g, '…').replace(/^[\s,;:]+|[\s,;:]+$/g, '').trim();
/** "(a|b)" is one group from its first to its last character */
function oneGroup(s) {
  if (s[0] !== '(' || s[s.length - 1] !== ')') return false;
  let d = 0;
  for (let k = 0; k < s.length; k++) { if (s[k] === '(') d++; else if (s[k] === ')') { d--; if (!d && k < s.length - 1) return false; } }
  return true;
}
/** a part of a pattern, written short: "mov(e|ed|ing) (to|from|him)" */
function short(n) {
  switch (n.t) {
    case 'alt': { const L = n.alts.map(short); return L.length === 1 ? L[0] : '(' + L.join('|') + ')'; }
    case 'seq': return n.items.map(it => {
      if (it.a.t === 'w') return '…';
      if (it.a.t === 'd') return '#';
      if (it.a.t === 'sp') return ' ';
      let s = short(it.a);
      if (it.min === 0 && s) s = oneGroup(s) ? s.slice(0, -1) + '|)' : '(' + s + '|)';
      return s;
    }).join('');
    case 'grp': return short(n.n);
    case 'cls': return n.chars.length === 1 ? n.chars[0] : '(' + n.chars.join('|') + ')';
    case 'lit': return n.s;
    case 'sp': return ' ';
    case 'w': return '…';
    case 'd': return '#';
    default: return '';
  }
}
/** a part of a pattern → every way it is written (null: more than LIMIT) */
function forms(n) {
  switch (n.t) {
    case 'alt': {
      const out = [];
      n.alts.forEach(a => { const f = forms(a); (f || [short(a)]).forEach(x => { if (!out.includes(x)) out.push(x); }); });
      return out;
    }
    case 'seq': {
      let acc = [''];
      for (const it of n.items) {
        const f = itemForms(it); if (!f) return null;
        const nx = []; acc.forEach(a => f.forEach(b => { const v = a + b; if (!nx.includes(v)) nx.push(v); }));
        if (nx.length > LIMIT) return null;
        acc = nx;
      }
      return acc;
    }
    case 'grp': return forms(n.n);
    case 'cls': return n.chars.slice();
    case 'lit': return [n.s];
    case 'sp': return [' '];
    case 'w': return ['…'];
    case 'd': return ['#'];
    default: return [''];
  }
}
function itemForms(it) {
  const a = it.a;
  if (a.t === 'w') return ['…'];                                                    // \w*, \w+, .* → "…"
  if (a.t === 'd') return ['#'];
  let f = forms(a); if (!f) return null;
  if (it.max > 1 && a.t === 'sp') f = [' '];
  // optional: "towels?" → towel, towels; an optional space or hyphen is shown written first ("bath ?mat" → bath mat, bathmat)
  if (it.min === 0) f = f.every(x => /^[\s-]*$/.test(x)) ? f.concat(['']) : [''].concat(f);
  return f;
}
/**
 * A built-in pattern → the words and phrases it understands, as people write them:
 * /\b(?:towels?|bath ?mat)\b/ → ["towel", "towels", "bath mat", "bathmat"]; "leak\w*" → "leak…" (any ending);
 * "\d" → "#"; a long list of combinations → one short form "mov(e|ed) (to|from)".
 */
function reWords(re) {
  const src = re && typeof re.source === 'string' ? re.source : String(re || '');   // a RegExp (from any window) or its source
  if (!src) return [];
  const n = safe(() => reParse(src), null); if (!n) return [src];
  const out = [];
  (n.alts || [n]).forEach(a => {
    // no \b at the end ("\btaxi"): it also finds longer words (taxis) → "taxi…"
    const its = (a.items || []).filter(it => !(it.a.t === 'none' && it.a.look)), last = its[its.length - 1];
    const open = !!last && last.a.t !== 'none' && last.a.t !== 'w';
    const f = forms({ t: 'alt', alts: [a] }) || [short(a)];
    f.forEach(x => { let t = tidy(x); if (open && /[a-z0-9]$/i.test(x)) t += '…'; if (t && t !== '…' && t !== '#' && !out.includes(t)) out.push(t); });
  });
  return out;
}
/** several patterns (the Handover Book's rules for one topic) → their words, each once */
function rulesWords(list) { const out = []; (list || []).forEach(re => reWords(re).forEach(w => { if (!out.includes(w)) out.push(w); })); return out; }
/** "a, b ,c" | ["a"] | {0:"a"} → ["a", "b", "c"] */
const listOf = v => (Array.isArray(v) ? v : isObj(v) ? Object.values(v) : String(v == null ? '' : v).split(/[,;\n]+/)).map(x => String(x == null ? '' : x).trim()).filter(Boolean);
/** is a built-in word one the hotel removed? (drop: the saved list) */
function isDropped(word, drop) {
  const L = listOf(drop); if (!L.length) return false;
  const w = norm(word);
  if (L.some(d => norm(d) === w)) return true;
  const P = W.hoSetupPure; if (!P || typeof P.dropPat !== 'function') return false;
  return L.some(d => { const p = P.dropPat(d); return !!p && p.test(w); });
}
/** what hoWaParse made of a message → a short line ("✓ 324 checked out · ⏰ 202 late check-out 6 PM") */
function parseLine(P, lbl) {
  if (!P) return '—';
  if (P.kind === 'ignore') return 'Ignored';
  const L = (P.actions || []).map(a => {
    const r = a.room ? a.room + ' ' : '';
    switch (a.act) {
      case 'co': return '✓ ' + r + 'checked out' + (a.why ? ' (' + a.why + ')' : '');
      case 'findone': return '✓ ' + r + 'Finance done';
      case 'lco': return '⏰ ' + r + 'late check-out' + (a.time ? ' ' + (lbl ? lbl(a.time) : a.time) : '');
      case 'ext': return '↪ ' + r + 'extended' + (a.nights ? ' +' + a.nights + 'N' : a.until ? ' till ' + a.until : '');
      case 'extending': return '⏳ ' + r + 'extending (paperwork on its way)';
      case 'maybe': return '🤔 ' + r + 'might extend';
      case 'fin': return '🧾 ' + r + 'waiting for ' + (a.who || 'Finance');
      case 'note': return '📝 ' + r + 'note' + (a.label ? ' (' + a.label + ')' : '');
      case 'ignore': return 'Ignored' + (a.word ? ' ("' + a.word + '")' : '');
      default: return r + a.act;
    }
  });
  return L.length ? L.join(' · ') : 'Not a command — nothing happens';
}
const PURE = { reParse, reWords, rulesWords, short, listOf, isDropped, parseLine, LIMIT };
W.hoWordsPure = PURE;
if (!doc) return;

// ══ What the page shows (curated from wa-bridge.js and voice.js; the examples run live) ══
const WA_CMDS = [
  { id: 'co', m: 'co', icon: '✓', title: 'Checked out', sub: 'The room on Departures turns ✓ Checked out',
    words: ['CO', 'C/O', 'C.O', 'C-O', 'C/OUT', 'checkout', 'check out', 'checked out', 'chkout', 'chk out', 'out', 'left', 'gone', 'vacated', 'departed', 'room free', 'room empty', 'keys returned', 'keys at desk', 'dep done', 'C/O done', 'early departure', 'make check out', 'Departures done:', 'Checkout list:'],
    ex: ['324 CO', 'CO 324, 325', '514 gone', 'keys returned 514'] },
  { id: 'lco', m: 'lco', icon: '⏰', title: 'Late check-out', sub: 'A time after the room (or "in 10 mins") sets the late check-out',
    words: ['LCO', 'L/C', 'L.C', 'LC', 'L/CO', 'late checkout', 'late check out', 'late C/O', 'late CO', 'late till 4pm', 'till 3pm', '4 pm', '2 PM check out', 'checking out in 10 mins', 'leaving at 3', 'staying till 2pm', 'wants late checkout till 2', 'Late check-outs:'],
    ex: ['202 LCO 6PM', '202 late till 4pm', '626 4 pm', '514 checking out in 10 mins'] },
  { id: 'ext', m: 'ext', icon: '↪', title: 'Extension', sub: 'Nights or a date: the room turns Extended',
    words: ['EXT', 'EXTD', 'EXTN', 'EXTND', 'EXTEN', 'extend', 'extended', 'extension', 'extention', '+2N', '2 nights', 'ext till 22', 'ext to 22 Oct', 'ext till Friday', 'one more night', '2 more nights', 'another night', 'Extensions:'],
    ex: ['0113 EXT 2N', '0113 +2N', '514 staying 2 more nights', '305 ext till Friday'] },
  { id: 'extending', m: '', icon: '⏳', title: 'Extending (paperwork on its way)', sub: 'Booking, RC signature, TD and payment still to do',
    words: ['extending', 'will extend', 'wants to extend', 'on extension', 'thinking to extend', 'waiting TD', 'RC sign', 'payment pending', 'TD done', 'all done'],
    ex: ['507 extending, waiting for TD', '507 wants to extend', '507 TD done'],
    why: 'Read from whole phrases (what is done and what is still waiting), so single words cannot be added here.' },
  { id: 'maybe', m: '', icon: '🤔', title: 'Might extend', sub: 'The guest has not gone yet',
    words: ['luggage inside', 'bags in the room', 'occupied', 'OCC'],
    ex: ['301 luggage inside', '526 occupied'], why: 'Read from whole phrases, so single words cannot be added here.' },
  { id: 'fin', m: '', icon: '🧾', title: 'Waiting for Finance / Reservations', sub: 'Left, but the folio is still open',
    words: ['waiting finance', 'folio with finance', 'res to fix', 'balance pending', 'finance done'],
    ex: ['507 left, waiting finance', '514 left, balance pending'], why: 'Read from whole phrases, so single words cannot be added here.' },
  { id: 'note', m: 'note', icon: '📝', title: 'Notes & requests', sub: 'Anything else after a room is written on the room as a note; "tomorrow", "maybe", "pending", "cancel" or a "?" turn a command into a note',
    words: ['anything else', 'tomorrow', 'maybe', 'pending', 'cancel', 'not', 'later', '?'],
    ex: ['415 change bed', '324 CO tomorrow', '324 out of order'] },
  { id: 'hk', m: 'hk', icon: '🧹', title: 'Housekeeping status codes', sub: 'Written on the room as a note with what they stand for',
    words: [], ex: ['512 DND', '516 IP', '225 N/L'] },
  { id: 'ignore', m: 'ignore', icon: '🙈', title: 'Ignored', sub: 'Never a command: questions, chat, media and HotelOps\' own posts',
    words: ['any update?', 'status?', 'ok', 'noted', 'thanks', '<media omitted>', '[Forwarded]', '<This message was edited>', '@mentions', '✅ HotelOps posts', '🔁 lines', 'Checked Out — 12:31 summaries'],
    ex: ['314 vd any updates?', 'ok noted 👍', '✅ HotelOps · 324 checked out'] },
];
const VOICE = [
  ['Room commands', 'Read like the same words typed in the HK group; nothing changes before you tap ✓ Do it', ['312 checked out', 'three twelve checked out', '514 late check-out at 2', 'room 220 extending 2 nights', 'send towels to 418']],
  ['Questions and pages', 'Ops Brain answers', ["what's left to check out", 'who is in 312', 'open departures']],
  ['Away guard', 'Switches the WhatsApp away guard', ["I'm away", "I'm on a break", "I'm back", 'away mode off']],
  ['Stop', 'Closes the voice card', ['cancel', 'never mind', 'stop']],
  ['Arabic', 'A few front-office words, with Arabic numbers', ['٣١٢ تشيك اوت', 'غرفة ٢٢٠ تمديد ليلتين']],
];
const SECS = [
  ['hk', '🧺', 'Housekeeping & maintenance requests', 'How a WhatsApp message is sorted on HK Requests'],
  ['ho', '📒', 'Handover topics and tags', 'How a Handover Book line gets its topic'],
  ['rh', '🩺', 'Room Health problems', 'The words that make a message a room problem, and who to send'],
  ['cmd', '💬', 'WhatsApp commands', 'What the WhatsApp reader does with "324 CO", "202 LCO 6PM"…'],
  ['dict', '📖', 'Your team\'s dictionary', 'Codes and words the team taught HotelOps (VD, OOO…)'],
  ['voice', '🎤', 'Voice phrases', 'What you can say to HotelOps'],
];

// ══ State ═══════════════════════════════════════════════════
const st = { q: '', open: new Set(['hk']), edit: '', try: '', dictEdit: '' };
const LSK = 'ho_words_page_v1';
safe(() => { const v = JSON.parse(localStorage.getItem(LSK) || 'null'); if (v && Array.isArray(v.open)) st.open = new Set(v.open); });
const saveOpen = () => safe(() => localStorage.setItem(LSK, JSON.stringify({ open: [...st.open] })));
const prof = () => (typeof currentProfile !== 'undefined' && currentProfile) || null;
/** owners and managers change words; everyone else reads */
function canEdit() {
  const p = prof();
  if (!p) return typeof currentUser === 'undefined';                // no sign-in at all (a local copy)
  return p.role === 'owner' || p.role === 'manager';
}
const toast = (m, k) => safe(() => { if (typeof showToast === 'function') showToast(m, k || 'ok'); });
const logAct = (a, d) => safe(() => { if (typeof logActivity === 'function') logActivity(a, d); });
const cfg = () => W.hoCfg || null;
const catsSet = kind => { const C = cfg(); const all = C ? C.get('cats') || {} : {}; return isObj(all[kind]) ? all[kind] : {}; };

// ══ The categories, from each module ═════════════════════════
/** one category card: {kind, id, icon, label, defLabel, tag, off, custom, builtin: [{w, weak}], own: [w], dropN, notes: [html]} */
function hkCats() {
  const P = W.hoWaBrainPure, C = cfg(); if (!P || !P.CAT_RE) return null;
  const defs = (C && C._catDefaults.hk) || P.CATS || {}, set = catsSet('hk');
  const out = Object.keys(P.CAT_RE).map(id => {
    const d = defs[id] || {}, s = set[id] || {}, drop = s.drop;
    const builtin = reWords(P.CAT_RE[id]).map(w => ({ w, dropped: isDropped(w, drop) }));
    return { kind: 'hk', id, icon: s.icon || d.icon || '📝', label: s.label || d.label || id, defLabel: d.label || id, tag: d.kind === 'maint' ? 'Repair' : 'Request', group: d.kind === 'maint' ? 'Repairs & maintenance' : 'Requests',
      off: !!s.off, custom: false, builtin, own: listOf(s.words), dropN: builtin.filter(b => b.dropped).length };
  });
  Object.keys(set).filter(id => set[id] && set[id].custom).forEach(id => { const s = set[id]; out.push({ kind: 'hk', id, icon: s.icon || '📝', label: s.label || 'New category', defLabel: '', tag: s.kind === 'maint' ? 'Repair' : 'Request', group: 'Added by the hotel', off: !!s.off, custom: true, builtin: [], own: listOf(s.words), dropN: 0 }); });
  return out;
}
function hoCats() {
  const P = W.hoHandoverPure, C = cfg(); if (!P || !P.CAT_RULES) return null;
  const defs = (C && C._catDefaults.ho) || P.CAT || {}, set = catsSet('ho'), byId = {};
  P.CAT_RULES.forEach(([id, re]) => { (byId[id] = byId[id] || []).push(re); });
  const out = Object.keys(defs).map(id => {
    const d = defs[id] || {}, s = set[id] || {}, drop = s.drop;
    const builtin = rulesWords(byId[id]).map(w => ({ w, dropped: isDropped(w, drop) }));
    return { kind: 'ho', id, icon: s.icon || d.icon || '🏷️', label: s.label || d.label || id, defLabel: d.label || id, tag: '', group: '', off: !!s.off, custom: false, builtin, own: listOf(s.words), dropN: builtin.filter(b => b.dropped).length,
      notes: id === 'info' ? ['Everything nothing else matches lands here.'] : [] };
  });
  Object.keys(set).filter(id => set[id] && set[id].custom).forEach(id => { const s = set[id]; out.push({ kind: 'ho', id, icon: s.icon || '🏷️', label: s.label || 'New category', defLabel: '', tag: '', group: '', off: !!s.off, custom: true, builtin: [], own: listOf(s.words), dropN: 0 }); });
  return out;
}
function rhCats() {
  const R = W.hoRoomHealth; if (!R || !R.pure || !R.pure.DEFAULT_KINDS) return null;
  const C = safe(() => R.cfg(), null) || R.pure.mergeCfg({}), saved = safe(() => R.saved(), {}) || {}, sk = saved.kinds || {};
  const dept = id => (C.depts.find(d => d.id === id) || {});
  return C.kinds.map(k => {
    const def = R.pure.DEFAULT_KINDS.find(x => x.id === k.id), raw = w => w.replace(/^~/, '').trim().toLowerCase();
    const cur = listOf(k.kw), curSet = new Set(cur.map(raw));
    const base = def ? listOf(def.kw) : [], baseSet = new Set(base.map(raw));
    const builtin = base.map(w => ({ w: raw(w), weak: w[0] === '~', dropped: !curSet.has(raw(w)) }));
    const own = cur.filter(w => !baseSet.has(raw(w))).map(w => w.replace(/^~/, '').trim());
    const dp = dept(k.dept), notes = [];
    if (def && def.not) notes.push('<b>Not when it says:</b> ' + esc(listOf(def.not).join(', ')));
    if (def && def.need) notes.push('<b>Only with one of:</b> ' + esc(listOf(def.need).join(', ')));
    return { kind: 'rh', id: k.id, icon: k.emoji || '•', label: k.label || k.id, defLabel: def ? def.label : '', tag: (dp.emoji ? dp.emoji + ' ' : '') + (dp.short || dp.name || ''), group: '', off: !!k.off, custom: !def, builtin, own,
      dropN: builtin.filter(b => b.dropped).length, notes, hasKw: !!(sk[k.id] && sk[k.id].kw != null) };
  });
}

// ══ Saving ══════════════════════════════════════════════════
/** change one category's setting in the hotel setup (the same storage as Settings → Hotel setup → Categories) */
function setCat(kind, id, fn, what) {
  const C = cfg(); if (!C || !canEdit()) return false;
  const all = clone(C.get('cats') || {}), set = all[kind] = isObj(all[kind]) ? all[kind] : {};
  const s = Object.assign({}, set[id] || {});
  fn(s);
  if (Array.isArray(s.drop) && !s.drop.length) delete s.drop;
  if (s.words != null && !String(s.words).trim()) delete s.words;
  if (Object.keys(s).length) set[id] = s; else delete set[id];
  C.set('cats', all);
  if (what) logAct('words_page', what);
  return true;
}
/** change one Room Health problem's settings (roomHealth/cfg) */
function setRh(id, fn, what) {
  const R = W.hoRoomHealth; if (!R || typeof R.saveCfg !== 'function' || !canEdit()) return false;
  const next = R.saved() || {}; next.kinds = isObj(next.kinds) ? next.kinds : {};
  const k = Object.assign({}, next.kinds[id] || {}), def = R.pure.DEFAULT_KINDS.find(x => x.id === id);
  const cur = listOf(k.kw != null ? k.kw : def ? def.kw : '');
  const kw = fn(k, cur);
  if (kw) { const s = kw.join(', '); if (def && s === listOf(def.kw).join(', ')) delete k.kw; else k.kw = s; }
  if (Object.keys(k).length) next.kinds[id] = k; else delete next.kinds[id];
  R.saveCfg(next, what || 'Room Health words changed');
  return true;
}
/** after a change: does a message with the word land where the team wants it? */
function verify(kind, id, word) {
  return safe(() => {
    if (kind === 'hk') return (W.hoWaBrainPure.wbCategorize('512 ' + word + ' please') || []).some(c => c.id === id);
    if (kind === 'ho') return W.hoHandoverPure.categorize('512 ' + word) === id;
    if (kind === 'rh') { const R = W.hoRoomHealth; return R.pure.classify('512 ' + word + ' problem', R.cfg()).kinds.some(k => k.kind === id); }
    return false;
  }, false);
}
function labelOf(kind, id) { const c = (cardsOf(kind) || []).find(x => x.id === id); return c ? c.label : id; }
const cardsOf = kind => (kind === 'hk' ? hkCats() : kind === 'ho' ? hoCats() : kind === 'rh' ? rhCats() : null);

function addWord(kind, id, raw) {
  const w = String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (w.length < 2) { toast('Type a word of 2 letters or more', 'warn'); return false; }
  if (/[,;]/.test(w)) { toast('One word or phrase at a time', 'warn'); return false; }
  const lbl = labelOf(kind, id);
  let ok = false;
  if (kind === 'rh') ok = setRh(id, (k, cur) => { if (cur.some(x => norm(x.replace(/^~/, '')) === norm(w))) return cur; return cur.concat([w]); }, `Room Health: "${w}" added to ${lbl}`);
  else ok = setCat(kind, id, s => {
    const L = listOf(s.words); if (!L.some(x => norm(x) === norm(w))) L.push(w); s.words = L.join(', ');
    if (s.drop) s.drop = listOf(s.drop).filter(d => norm(d) !== norm(w));        // adding a removed built-in word brings it back
  }, `Words: "${w}" added to ${lbl}`);
  if (!ok) return false;
  const good = verify(kind, id, w);
  toast(good ? `✓ “${w}” now counts as ${lbl}` : `Saved. A message with “${w}” still goes elsewhere first — try it in 🧪 Try a message`, good ? 'ok' : 'warn');
  return true;
}
function delOwn(kind, id, w) {
  const lbl = labelOf(kind, id);
  if (kind === 'rh') return setRh(id, (k, cur) => cur.filter(x => norm(x.replace(/^~/, '')) !== norm(w)), `Room Health: "${w}" removed from ${lbl}`);
  return setCat(kind, id, s => { s.words = listOf(s.words).filter(x => norm(x) !== norm(w)).join(', '); }, `Words: "${w}" removed from ${lbl}`);
}
function dropWord(kind, id, w) {
  const lbl = labelOf(kind, id);
  const ok = kind === 'rh' ? setRh(id, (k, cur) => cur.filter(x => norm(x.replace(/^~/, '')) !== norm(w)), `Room Health: built-in "${w}" removed from ${lbl}`)
    : setCat(kind, id, s => { const L = listOf(s.drop); if (!L.some(d => norm(d) === norm(w))) L.push(w); s.drop = L; }, `Words: built-in "${w}" removed from ${lbl}`);
  if (ok) toast(`“${w}” no longer counts as ${lbl}`, 'ok');
  return ok;
}
function undropWord(kind, id, w) {
  if (kind === 'rh') {
    const def = W.hoRoomHealth.pure.DEFAULT_KINDS.find(x => x.id === id), orig = def && listOf(def.kw).find(x => norm(x.replace(/^~/, '')) === norm(w));
    return setRh(id, (k, cur) => cur.concat([orig || w]), `Room Health: built-in "${w}" back in ${labelOf(kind, id)}`);
  }
  return setCat(kind, id, s => { s.drop = listOf(s.drop).filter(d => norm(d) !== norm(w) && !isDropped(w, [d])); }, `Words: built-in "${w}" back in ${labelOf(kind, id)}`);
}
function restoreAll(kind, id) {
  const lbl = labelOf(kind, id);
  if (!confirm(`Bring back every built-in word of ${lbl}? Words your team added stay.`)) return false;
  if (kind === 'rh') {
    const def = W.hoRoomHealth.pure.DEFAULT_KINDS.find(x => x.id === id); if (!def) return false;
    const base = listOf(def.kw), bs = new Set(base.map(x => norm(x.replace(/^~/, ''))));
    return setRh(id, (k, cur) => base.concat(cur.filter(x => !bs.has(norm(x.replace(/^~/, ''))))), `Room Health: built-in words of ${lbl} restored`);
  }
  return setCat(kind, id, s => { delete s.drop; }, `Words: built-in words of ${lbl} restored`);
}
function setOn(kind, id, on) {
  const lbl = labelOf(kind, id);
  if (kind === 'rh') return setRh(id, k => { if (on) delete k.off; else k.off = true; }, `Room Health: ${lbl} switched ${on ? 'on' : 'off'}`);
  return setCat(kind, id, s => { if (on) delete s.off; else s.off = true; }, `Category ${lbl} switched ${on ? 'on' : 'off'}`);
}
function rename(kind, id, field, v) {
  v = String(v || '').trim();
  const c = (cardsOf(kind) || []).find(x => x.id === id); if (!c) return false;
  if (kind === 'rh') {
    const def = W.hoRoomHealth.pure.DEFAULT_KINDS.find(x => x.id === id) || {}, f = field === 'icon' ? 'emoji' : 'label';
    return setRh(id, k => { if (!v || v === def[f]) delete k[f]; else k[f] = v; }, `Room Health: ${f} of ${c.label} changed`);
  }
  const C = cfg(), def = ((C && C._catDefaults[kind]) || {})[id] || {};
  return setCat(kind, id, s => { if (!v || (!c.custom && v === def[field])) { if (!c.custom) delete s[field]; } else s[field] = v; }, `Category ${c.label}: ${field} changed`);
}
function addCat(kind, name, sub) {
  name = String(name || '').trim().slice(0, 40); if (!name) { toast('Type a name for the new category', 'warn'); return ''; }
  const id = 'c' + Date.now().toString(36);
  setCat(kind, id, s => { Object.assign(s, { custom: true, label: name, icon: kind === 'ho' ? '🏷️' : '📝', kind: sub === 'maint' ? 'maint' : 'req' }); }, `Category ${name} added`);
  return id;
}

// ══ Rendering ═══════════════════════════════════════════════
const sKey = (...a) => esc(a.join(' ').toLowerCase());
function chip(c, b, ed) {
  const cls = 'wp-chip' + (b.dropped ? ' dropped' : '') + (b.weak ? ' weak' : '') + (b.own ? ' own' : '');
  const tip = b.dropped ? 'Removed: it no longer counts here' : b.own ? 'Added by your team' : b.weak ? 'Counts only together with a problem word' : 'Built in';
  let btn = '';
  if (ed && c) {
    if (b.own) btn = `<button type="button" class="wp-x" data-wp="delown" data-w="${esc(b.w)}" aria-label="Remove ${esc(b.w)}">×</button>`;
    else if (b.dropped) btn = `<button type="button" class="wp-x" data-wp="undrop" data-w="${esc(b.w)}" aria-label="Bring back ${esc(b.w)}">↺</button>`;
    else btn = `<button type="button" class="wp-x" data-wp="drop" data-w="${esc(b.w)}" aria-label="Remove the built-in word ${esc(b.w)}">×</button>`;
  }
  return `<span class="${cls}" data-wp-s="${sKey(b.w)}" title="${esc(tip)}"><span>${esc(b.w).replace(/…/g, '<i class="wp-dots">…</i>')}</span>${btn}</span>`;
}
function catCard(c, ed) {
  const editing = ed && st.edit === c.kind + ':' + c.id;
  const words = c.builtin.map(b => Object.assign({}, b)).concat(c.own.map(w => ({ w, own: true })));
  const all = [c.label, c.defLabel, c.tag].concat(words.map(x => x.w)).join(' ');
  return `<div class="wp-cat${c.off ? ' off' : ''}${editing ? ' editing' : ''}" data-k="${c.kind}" data-id="${esc(c.id)}" data-wp-s="${sKey(all)}" data-wp-h="${sKey(c.label, c.defLabel, c.tag)}">
    <div class="wp-cat-hd">
      <span class="wp-ic" aria-hidden="true">${esc(c.icon)}</span>
      <span class="wp-nm"><b>${esc(c.label)}</b>${c.defLabel && c.defLabel !== c.label ? `<small>built-in name: ${esc(c.defLabel)}</small>` : ''}</span>
      ${c.tag ? `<span class="wp-tag">${esc(c.tag)}</span>` : ''}
      ${c.off ? '<span class="wp-tag warn">Off</span>' : ''}
      ${ed ? `<button type="button" class="wp-ed" data-wp="edit" aria-expanded="${editing}" aria-label="${editing ? 'Done editing' : 'Edit'} ${esc(c.label)}">${editing ? 'Done' : 'Edit'}</button>` : ''}
    </div>
    ${editing ? `<div class="wp-form">
      <input class="wp-emoji" data-wp-f="icon" value="${esc(c.icon)}" maxlength="4" aria-label="Emoji">
      <input class="wp-name" data-wp-f="label" value="${esc(c.label)}" maxlength="40" placeholder="${esc(c.defLabel || 'Name')}" aria-label="Name">
      <label class="wp-sw" title="${c.off ? 'Off: never chosen' : 'On'}"><input type="checkbox" data-wp-f="on" ${c.off ? '' : 'checked'} aria-label="Use ${esc(c.label)}"><i></i></label>
    </div>` : ''}
    <div class="wp-chips">${words.length ? words.map(b => chip(c, b, editing)).join('') : '<small class="wp-none">No words yet.</small>'}</div>
    ${(c.notes || []).length ? `<div class="wp-notes">${c.notes.map(n => `<small>${n}</small>`).join('')}</div>` : ''}
    ${editing ? `<div class="wp-add"><input data-wp-add="1" placeholder="Add a word or phrase…" maxlength="40" aria-label="Add a word to ${esc(c.label)}" autocomplete="off"><button type="button" class="btn sm gold" data-wp="add">Add</button></div>
      ${c.dropN ? `<div class="wp-restore"><small>${plural(c.dropN, 'built-in word')} removed.</small><button type="button" class="btn sm ghost" data-wp="restore">Bring back all built-in words</button></div>` : ''}` : ''}
  </div>`;
}
function catsSection(kind, ed) {
  const L = cardsOf(kind);
  if (!L) return `<p class="wp-empty">This part of HotelOps has not loaded on this device.</p>`;
  const groups = [];
  L.forEach(c => { let g = groups.find(x => x.t === c.group); if (!g) groups.push(g = { t: c.group, L: [] }); g.L.push(c); });
  const help = {
    hk: 'A message can be about several things ("AC and towels"). Words your team adds win over the built-in ones; a removed built-in word no longer counts. "…" means any ending (leak… = leak, leaking, leakage); # is a number.',
    ho: 'The first topic that fits wins, from Lost & found down to Follow-up. Words your team adds are checked first.',
    rh: 'A dotted word counts only with a problem word ("towels" alone is a request; "dirty towels" is a problem).',
  }[kind];
  return `<p class="wp-help">${esc(help)}</p>
    ${groups.map(g => `${g.t ? `<h4 class="wp-gh">${esc(g.t)}</h4>` : ''}<div class="wp-cats">${g.L.map(c => catCard(c, ed)).join('')}</div>`).join('')}
    ${ed && kind !== 'rh' ? `<div class="wp-new" data-k="${kind}"><input data-wp-new="1" placeholder="New category name…" maxlength="40" aria-label="New category name" autocomplete="off">${kind === 'hk' ? '<select data-wp-newk="1" aria-label="Kind"><option value="req">Request</option><option value="maint">Repair</option></select>' : ''}<button type="button" class="btn sm" data-wp="newcat">＋ Add a category</button></div>` : ''}
    ${kind === 'rh' && ed && W.hoRoomHealth && typeof W.hoRoomHealth.settings === 'function' ? '<div class="wp-new"><button type="button" class="btn sm ghost" data-wp="rhset">Departments, severity and new problem types →</button></div>' : ''}
    ${kind === 'ho' ? tagsHtml() : ''}`;
}
function tagsHtml() {
  const P = W.hoHandoverPure; if (!P || !P.KW_TAGS) return '';
  return `<h4 class="wp-gh">Tags on a handover line</h4><p class="wp-help">Shown as small labels next to the item; they do not change its topic. Built in, read only.</p>
    <div class="wp-cats">${P.KW_TAGS.map(([re, t]) => { const ws = reWords(re); return `<div class="wp-cat" data-wp-s="${sKey(t, ws.join(' '))}" data-wp-h="${sKey(t)}"><div class="wp-cat-hd"><span class="wp-ic">🏷️</span><span class="wp-nm"><b>${esc(t)}</b></span></div><div class="wp-chips">${ws.map(w => chip(null, { w }, false)).join('')}</div></div>`; }).join('')}</div>`;
}
const waWords = () => safe(() => (W.hoWaWords && typeof W.hoWaWords.allWithOff === 'function' ? W.hoWaWords.allWithOff() : W.hoWaWords && W.hoWaWords.all ? W.hoWaWords.all() : []) || [], []);
const tLbl = t => safe(() => (W.hoWaPure && W.hoWaPure.timeLabel ? W.hoWaPure.timeLabel(t) : t), t);
const parse = t => safe(() => (typeof W.hoWaParse === 'function' ? W.hoWaParse(t) : null), null);
function cmdSection(ed) {
  const D = waWords(), hasDict = !!(W.hoWaWords && typeof W.hoWaWords.add === 'function');
  return `<p class="wp-help">The WhatsApp reader looks at the words right after a room number. Built-in reader words are fixed; codes and words in your team's dictionary can be added${ed ? '' : ' by an owner or manager'} or turned off. Examples run live through the reader.</p>
    <div class="wp-cats">${WA_CMDS.map(c => {
      const dict = c.m ? D.filter(e => e.m === c.m || (e.off && e.m === c.m)) : [];
      const editing = ed && hasDict && c.m && st.edit === 'cmd:' + c.id;
      const chips = c.words.map(w => chip(null, { w }, false)).join('')
        + dict.map(e => { const own = !e.builtin; return `<span class="wp-chip${own ? ' own' : ' code'}${e.off ? ' dropped' : ''}" data-wp-s="${sKey(e.word, e.note || '')}" title="${esc((e.note || '') + (own ? ' · added by your team' : e.off ? ' · turned off' : ' · built-in code'))}">${esc(e.word)}${e.note && e.m !== 'co' && e.m !== 'lco' && e.m !== 'ext' ? ` <em>${esc(e.note)}</em>` : ''}${editing ? (e.off ? `<button type="button" class="wp-x" data-wp="wres" data-w="${esc(e.key)}" aria-label="Turn ${esc(e.word)} back on">↺</button>` : `<button type="button" class="wp-x" data-wp="wdel" data-w="${esc(e.key)}" aria-label="${own ? 'Delete' : 'Turn off'} ${esc(e.word)}">×</button>`) : ''}</span>`; }).join('');
      const exs = c.ex.map(x => `<li data-wp-s="${sKey(x)}"><code>${esc(x)}</code><span>→ ${esc(parseLine(parse(x), tLbl))}</span></li>`).join('');
      return `<div class="wp-cat" data-k="cmd" data-id="${c.id}" data-wp-s="${sKey(c.title, c.sub, c.words.join(' '), dict.map(e => e.word + ' ' + (e.note || '')).join(' '), c.ex.join(' '))}" data-wp-h="${sKey(c.title)}">
        <div class="wp-cat-hd"><span class="wp-ic">${esc(c.icon)}</span><span class="wp-nm"><b>${esc(c.title)}</b><small>${esc(c.sub)}</small></span>
          ${ed && hasDict && c.m ? `<button type="button" class="wp-ed" data-wp="edit" aria-expanded="${!!editing}">${editing ? 'Done' : 'Edit'}</button>` : ''}</div>
        <div class="wp-chips">${chips || '<small class="wp-none">No words yet.</small>'}</div>
        <ul class="wp-ex">${exs}</ul>
        ${c.why ? `<p class="wp-why">${esc(c.why)}</p>` : ''}
        ${editing ? `<div class="wp-add"><input data-wp-add="1" placeholder="Add a word that means this…" maxlength="30" aria-label="Add a word for ${esc(c.title)}" autocomplete="off"><input data-wp-note="1" placeholder="Stands for (optional)" maxlength="80" aria-label="What it stands for"><button type="button" class="btn sm gold" data-wp="wadd">Add</button></div><p class="wp-why">Read when it comes right after a room: "512 ${c.m === 'ext' ? 'XTD' : c.m === 'co' ? 'VD' : c.m === 'lco' ? 'LATE' : 'XX'}".</p>` : ''}
      </div>`;
    }).join('')}</div>`;
}
function dictSection(ed) {
  const H = W.hoWaWords; if (!H) return '<p class="wp-empty">The WhatsApp dictionary has not loaded on this device.</p>';
  const M = H.meanings || {}, L = waWords().slice().sort((a, b) => (a.builtin - b.builtin) || a.key.localeCompare(b.key));
  const e0 = st.dictEdit ? L.find(e => e.key === st.dictEdit) : null;
  const opt = sel => Object.keys(M).map(m => `<option value="${m}"${sel === m ? ' selected' : ''}>${esc(M[m])}</option>`).join('');
  const when = at => (at ? new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
  return `<p class="wp-help">A word or code your colleagues type, and what it means. Built-in housekeeping codes are ready from day one; your team's words are shared with everyone at this hotel.${typeof W.hoWaWordsOpen === 'function' ? ' <a href="#" data-wp="waopen">Test messages and answer new words →</a>' : ''}</p>
    ${ed ? `<div class="wp-dform"><input id="wpDW" maxlength="30" placeholder="Word, e.g. VD" value="${esc(e0 ? e0.word : '')}" aria-label="Word"${e0 ? ' readonly' : ''} autocomplete="off">
      <select id="wpDM" aria-label="Meaning">${opt(e0 ? e0.m : 'co')}</select>
      <input id="wpDN" maxlength="80" placeholder="Stands for (optional)" value="${esc(e0 ? e0.note || '' : '')}" aria-label="What it stands for" autocomplete="off">
      <span class="wp-dbtn"><button type="button" class="btn sm gold" data-wp="dsave">${e0 ? 'Save' : 'Add'}</button>${e0 ? '<button type="button" class="btn sm ghost" data-wp="dcancel">Cancel</button>' : ''}</span></div>` : ''}
    <div class="wp-dlist">${L.map(e => `<div class="wp-drow${e.off ? ' off' : ''}" data-wp-s="${sKey(e.word, e.note || '', M[e.m] || '')}">
      <b class="wp-dw">${esc(e.word)}</b>
      <span class="wp-dm">${esc(e.off ? 'Turned off' : M[e.m] || e.m)}${e.note ? `<small>${esc(e.note)}</small>` : ''}</span>
      <span class="wp-dby">${e.builtin && !e.changed && !e.off ? 'built-in' : esc(e.by || '') + (e.at ? ' · ' + esc(when(e.at)) : '') + (e.builtin ? ' · built-in, changed' : '')}</span>
      ${ed ? `<span class="wp-dact">${e.off ? `<button type="button" class="wp-b" data-wp="wres" data-w="${esc(e.key)}">Turn back on</button>` : `<button type="button" class="wp-b" data-wp="dedit" data-w="${esc(e.key)}">Edit</button><button type="button" class="wp-b" data-wp="wdel" data-w="${esc(e.key)}">${e.builtin ? 'Turn off' : 'Delete'}</button>${e.builtin && e.changed ? `<button type="button" class="wp-b" data-wp="wres" data-w="${esc(e.key)}">Reset</button>` : ''}`}</span>` : ''}
    </div>`).join('') || '<p class="wp-empty">No words yet.</p>'}</div>`;
}
function voiceSection() {
  const V = W.hoVoice, cl = t => safe(() => (V && typeof V.classify === 'function' ? V.classify(t) : null), null);
  const say = r => {
    if (!r) return '';
    if (r.kind === 'room') return parseLine({ kind: 'act', actions: r.actions }, tLbl);
    if (r.kind === 'guard') return r.on ? 'Away guard on' : 'Away guard off';
    if (r.kind === 'cancel') return 'Cancel';
    if (r.kind === 'ask') return 'Ops Brain answers: “' + r.text + '”';
    return '';
  };
  return `<p class="wp-help">Read only. Start it with 🎤 in the Ops Brain ask bar, by holding the 🧠 button, or Ctrl+Shift+Space / hold Alt+V on a PC. ${V && V.supported === false ? 'This browser has no speech recognition, so voice is not shown here.' : 'Speech is turned into text by the browser maker\'s servers, so it needs internet.'}</p>
    <div class="wp-cats">${VOICE.map(([t, sub, L]) => `<div class="wp-cat" data-wp-s="${sKey(t, sub, L.join(' '))}" data-wp-h="${sKey(t)}"><div class="wp-cat-hd"><span class="wp-ic">🎤</span><span class="wp-nm"><b>${esc(t)}</b><small>${esc(sub)}</small></span></div>
      <ul class="wp-ex">${L.map(x => { const r = say(cl(x)); return `<li data-wp-s="${sKey(x)}"><code>“${esc(x)}”</code>${r ? `<span>→ ${esc(r)}</span>` : ''}</li>`; }).join('')}</ul></div>`).join('')}</div>`;
}
function tryHtml(text) {
  const t = String(text || '').trim(); if (!t) return '<small class="wp-none">Type a message the way the team writes it, e.g. “512 tissue box please”.</small>';
  const rows = [];
  safe(() => { const C = W.hoWaBrainPure.wbCategorize(t); rows.push(['🧺 HK request', C.length ? C.map(c => c.icon + ' ' + c.label).join(', ') : 'nothing']); });
  safe(() => { const id = W.hoHandoverPure.categorize(t), c = W.hoHandoverPure.CAT[id] || {}; rows.push(['📒 Handover topic', (c.icon ? c.icon + ' ' : '') + (c.label || id)]); });
  safe(() => { const R = W.hoRoomHealth, K = R.pure.classify(t, R.cfg()).kinds; rows.push(['🩺 Room Health', K.length ? K.map(k => k.label + ' (' + k.severity + ')').join(', ') : 'no room problem']); });
  safe(() => { const P = parse(t); if (P) rows.push(['💬 WhatsApp reader', parseLine(P, tLbl)]); });
  return `<dl class="wp-tryout">${rows.map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join('')}</dl>`;
}
function count(id) {
  return safe(() => {
    if (id === 'hk' || id === 'ho' || id === 'rh') { const L = cardsOf(id) || []; return plural(L.length, 'category', 'categories') + ' · ' + plural(L.reduce((n, c) => n + c.builtin.length + c.own.length, 0), 'word'); }
    if (id === 'cmd') return plural(WA_CMDS.length, 'command type');
    if (id === 'dict') return plural(waWords().filter(e => !e.off).length, 'word');
    if (id === 'voice') return plural(VOICE.reduce((n, v) => n + v[2].length, 0), 'example');
    return '';
  }, '');
}
function render() {
  const root = doc.getElementById('wpRoot'); if (!root) return;
  const ed = canEdit(), y = W.scrollY;
  const body = id => (id === 'hk' || id === 'ho' || id === 'rh' ? catsSection(id, ed) : id === 'cmd' ? cmdSection(ed) : id === 'dict' ? dictSection(ed) : voiceSection());
  root.innerHTML = `<div class="page-hd"><div class="page-hd-left"><h1>📖 Words &amp; phrases</h1><p>Every word HotelOps understands — built in and your team's own.${ed ? ' Tap Edit on a card to add or remove words.' : ' Only owners and managers can change them.'}</p></div></div>
    <div class="wp-top">
      <div class="wp-search"><input type="search" id="wpQ" placeholder="Search every word… (towel, LCO, leak)" value="${esc(st.q)}" autocomplete="off" aria-label="Search every word"><span id="wpQn" class="wp-qn" aria-live="polite"></span></div>
      <details class="wp-try"${st.try ? ' open' : ''}><summary>🧪 Try a message</summary>
        <input id="wpTry" placeholder="e.g. 512 tissue box please" value="${esc(st.try)}" autocomplete="off" aria-label="Try a message"><div id="wpTryOut">${tryHtml(st.try)}</div></details>
    </div>
    ${SECS.map(([id, ic, t, sub]) => `<details class="wp-sec" data-sec="${id}"${st.open.has(id) || st.q ? ' open' : ''}>
      <summary><span class="wp-sic" aria-hidden="true">${ic}</span><span class="wp-st"><b>${esc(t)}</b><small>${esc(sub)} · ${esc(count(id))}</small></span><span class="wp-chev" aria-hidden="true"></span></summary>
      <div class="wp-body">${safe(() => body(id), '<p class="wp-empty">Could not show this part.</p>')}</div></details>`).join('')}
    <p class="wp-empty" id="wpNone" hidden>No word matches your search.</p>`;
  filter();
  if (Math.abs(W.scrollY - y) > 2) W.scrollTo(0, y);
}
/** the search: cards whose name matches show all their words; otherwise only the matching words */
function filter() {
  const root = doc.getElementById('wpRoot'); if (!root) return;
  const q = norm(st.q); let n = 0;
  root.querySelectorAll('.wp-sec').forEach(sec => {
    let secHit = 0;
    sec.querySelectorAll('.wp-cat, .wp-drow').forEach(card => {
      if (!q) { card.hidden = false; card.querySelectorAll('[data-wp-s]').forEach(x => { x.hidden = false; }); secHit++; return; }
      const head = (card.dataset.wpH || '').includes(q);
      let any = head;
      card.querySelectorAll('.wp-chip[data-wp-s], .wp-ex li[data-wp-s]').forEach(x => { const hit = head || x.dataset.wpS.includes(q); x.hidden = !hit; if (hit && !head) { any = true; n++; } });
      if (card.classList.contains('wp-drow')) { any = (card.dataset.wpS || '').includes(q); if (any) n++; }
      if (head) n++;
      card.hidden = !any; if (any) secHit++;
    });
    sec.querySelectorAll('.wp-gh').forEach(h => { const g = h.nextElementSibling; h.hidden = !!q && !!g && ![...g.children].some(c => !c.hidden); });
    sec.hidden = !!q && !secHit;
    if (q && secHit) sec.open = true;
  });
  const qn = doc.getElementById('wpQn'); if (qn) qn.textContent = q ? (n ? plural(n, 'match', 'matches') : '') : '';
  const none = doc.getElementById('wpNone'); if (none) none.hidden = !q || !!n;
}
/** re-draw, keeping the field that had the focus */
function redraw() {
  const a = doc.activeElement, card = a && a.closest && a.closest('.wp-cat'), sel = a && a.id ? '#' + a.id : card && a.dataset.wpAdd ? `.wp-cat[data-k="${card.dataset.k}"][data-id="${card.dataset.id}"] [data-wp-add]` : '';
  render();
  if (sel) { const el = doc.querySelector(sel); if (el && el.focus) { el.focus(); } }
}

// ══ Taps and typing ═════════════════════════════════════════
function onClick(e) {
  const b = e.target.closest('[data-wp]'); if (!b) return;
  const act = b.dataset.wp, card = b.closest('.wp-cat'), kind = card && card.dataset.k, id = card && card.dataset.id, w = b.dataset.w;
  if (act === 'waopen') { e.preventDefault(); safe(() => W.hoWaWordsOpen()); return; }
  if (act === 'rhset') { safe(() => W.hoRoomHealth.settings()); return; }
  if (!canEdit()) { toast('Only owners and managers can change words', 'warn'); return; }
  const H = W.hoWaWords;
  switch (act) {
    case 'edit': { const k = kind + ':' + id; st.edit = st.edit === k ? '' : k; render(); const f = doc.querySelector(`.wp-cat[data-k="${kind}"][data-id="${id}"] [data-wp-add]`); if (f && st.edit) f.focus({ preventScroll: true }); return; }
    case 'add': { const f = card.querySelector('[data-wp-add]'); if (addWord(kind, id, f.value)) { redraw(); const g = doc.querySelector(`.wp-cat[data-k="${kind}"][data-id="${id}"] [data-wp-add]`); if (g) g.focus(); } return; }
    case 'delown': if (delOwn(kind, id, w)) redraw(); return;
    case 'drop': if (dropWord(kind, id, w)) redraw(); return;
    case 'undrop': if (undropWord(kind, id, w)) redraw(); return;
    case 'restore': if (restoreAll(kind, id)) redraw(); return;
    case 'newcat': { const box = b.closest('.wp-new'), k = box.dataset.k, nm = box.querySelector('[data-wp-new]').value, sub = (box.querySelector('[data-wp-newk]') || {}).value; const nid = addCat(k, nm, sub); if (nid) { st.edit = k + ':' + nid; render(); const f = doc.querySelector(`.wp-cat[data-k="${k}"][data-id="${nid}"] [data-wp-add]`); if (f) f.focus(); } return; }
    case 'wadd': {
      if (!H) return;
      const c = WA_CMDS.find(x => x.id === id), f = card.querySelector('[data-wp-add]'), nt = card.querySelector('[data-wp-note]'), word = String(f.value || '').trim();
      if (!word || /^\d+$/.test(word.replace(/\W/g, ''))) { toast('Type a word (rooms are numbers)', 'warn'); return; }
      const ex = H.lookup(word);
      if (ex && ex.m !== c.m && !confirm(`"${word}" already means ${H.meanings[ex.m] || ex.m}. Change it to ${H.meanings[c.m] || c.m}?`)) return;
      const r = H.add(word, c.m, nt ? nt.value : '');
      if (r) { const P = parse('512 ' + word), ok = c.m === 'note' || c.m === 'hk' ? true : c.m === 'ignore' ? !(P && (P.actions || []).some(a => a.act !== 'ignore')) : !!(P && (P.actions || []).some(a => a.act === c.m)); toast(ok ? `✓ “512 ${word}” now reads as ${H.meanings[c.m]}` : `Saved. “512 ${word}” is read another way first — check it in 🧪 Try a message`, ok ? 'ok' : 'warn'); }
      redraw(); return;
    }
    case 'wdel': { if (!H) return; const e0 = waWords().find(x => x.key === w); if (!confirm(e0 && e0.builtin ? `Turn off the built-in word "${e0.word}"?` : `Delete the word "${e0 ? e0.word : w}" for everyone?`)) return; H.remove(w); if (st.dictEdit === w) st.dictEdit = ''; redraw(); return; }
    case 'wres': if (H) { H.restore(w); redraw(); } return;
    case 'dedit': st.dictEdit = w; render(); { const m = doc.getElementById('wpDM'); if (m) m.focus(); } return;
    case 'dcancel': st.dictEdit = ''; render(); return;
    case 'dsave': {
      if (!H) return;
      const word = String((doc.getElementById('wpDW') || {}).value || '').trim(), m = (doc.getElementById('wpDM') || {}).value, nt = (doc.getElementById('wpDN') || {}).value;
      if (!word) { toast('Type the word first', 'warn'); return; }
      if (/^\d+$/.test(word.replace(/\W/g, ''))) { toast('A word, not a number (rooms are numbers)', 'warn'); return; }
      if (H.add(word, m, nt)) toast(`“${word}” = ${H.meanings[m] || m}. The whole team gets it.`, 'ok');
      st.dictEdit = ''; render(); return;
    }
  }
}
function onChange(e) {
  const t = e.target, f = t.dataset && t.dataset.wpF; if (!f || !canEdit()) return;
  const card = t.closest('.wp-cat'); if (!card) return;
  const kind = card.dataset.k, id = card.dataset.id;
  if (f === 'on') setOn(kind, id, t.checked); else rename(kind, id, f, t.value);
  redraw();
}
function onKey(e) {
  if (e.key !== 'Enter') return;
  const t = e.target;
  if (t.dataset.wpAdd) { e.preventDefault(); const card = t.closest('.wp-cat'), b = card && card.querySelector('[data-wp="add"], [data-wp="wadd"]'); if (b) b.click(); }
  else if (t.dataset.wpNew) { e.preventDefault(); const b = t.closest('.wp-new').querySelector('[data-wp="newcat"]'); if (b) b.click(); }
  else if (t.dataset.wpNote) { e.preventDefault(); const b = t.closest('.wp-cat').querySelector('[data-wp="wadd"]'); if (b) b.click(); }
  else if (t.id === 'wpDN' || t.id === 'wpDW') { e.preventDefault(); const b = doc.querySelector('#wpRoot [data-wp="dsave"]'); if (b) b.click(); }
}
let qT = 0;
function onInput(e) {
  const t = e.target;
  if (t.id === 'wpQ') { st.q = t.value; clearTimeout(qT); qT = setTimeout(filter, 120); }
  else if (t.id === 'wpTry') { st.try = t.value; const o = doc.getElementById('wpTryOut'); if (o) o.innerHTML = tryHtml(st.try); }
}
function onToggle(e) {
  const d = e.target; if (!d || !d.classList || !d.classList.contains('wp-sec') || st.q) return;
  if (d.open) st.open.add(d.dataset.sec); else st.open.delete(d.dataset.sec);
  saveOpen();
}

const CSS = `
#wpRoot{max-width:1100px;margin:0 auto;padding-bottom:40px;min-width:0}
#wpRoot *{box-sizing:border-box}
#wpRoot .wp-top{display:flex;flex-direction:column;gap:10px;margin:4px 0 16px}
#wpRoot .wp-search{position:relative}
#wpRoot .wp-search input{width:100%;height:44px;padding:0 92px 0 14px;border:1px solid var(--border2);border-radius:12px;background:var(--card);color:var(--text);font:500 15px var(--font)}
#wpRoot .wp-qn{position:absolute;right:12px;top:50%;transform:translateY(-50%);font:600 12px var(--font);color:var(--text3);pointer-events:none}
#wpRoot .wp-try{border:1px solid var(--border);border-radius:12px;background:var(--card);padding:0 14px}
#wpRoot .wp-try>summary{cursor:pointer;padding:11px 0;font:600 14px var(--font);color:var(--text);list-style:none}
#wpRoot .wp-try>summary::-webkit-details-marker{display:none}
#wpRoot .wp-try input{width:100%;height:40px;padding:0 12px;border:1px solid var(--border2);border-radius:10px;background:var(--bg2);color:var(--text);font:500 14px var(--font);margin-bottom:10px}
#wpRoot .wp-tryout{display:grid;grid-template-columns:max-content 1fr;gap:6px 12px;margin:0 0 12px;font-size:13.5px}
#wpRoot .wp-tryout dt{color:var(--text3);font-weight:600}
#wpRoot .wp-tryout dd{margin:0;color:var(--text);overflow-wrap:anywhere}
#wpRoot .wp-sec{border:1px solid var(--border);border-radius:14px;background:var(--card);margin-bottom:12px;box-shadow:var(--ho-shadow,none);overflow:hidden}
#wpRoot .wp-sec>summary{display:flex;align-items:center;gap:12px;padding:14px 16px;cursor:pointer;list-style:none;user-select:none}
#wpRoot .wp-sec>summary::-webkit-details-marker{display:none}
#wpRoot .wp-sic{font-size:22px;width:36px;height:36px;display:grid;place-items:center;border-radius:10px;background:var(--bg2);flex:none}
#wpRoot .wp-st{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
#wpRoot .wp-st b{font:650 15.5px var(--font);color:var(--text);letter-spacing:-.01em}
#wpRoot .wp-st small{font-size:12.5px;color:var(--text3)}
#wpRoot .wp-chev{width:9px;height:9px;border-right:2px solid var(--text3);border-bottom:2px solid var(--text3);transform:rotate(-45deg);transition:transform .2s;flex:none;margin-right:4px}
#wpRoot .wp-sec[open]>summary .wp-chev{transform:rotate(45deg)}
#wpRoot .wp-body{padding:0 16px 16px;border-top:1px solid var(--border)}
#wpRoot .wp-help{margin:12px 0;color:var(--text2);font-size:13px;line-height:1.5}
#wpRoot .wp-help a,#wpRoot .wp-help a:visited{color:var(--accent)}
#wpRoot .wp-gh{margin:16px 0 8px;font:600 11px var(--font);letter-spacing:.06em;text-transform:uppercase;color:var(--text3)}
#wpRoot .wp-cats{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px}
#wpRoot .wp-cat{border:1px solid var(--border);border-radius:12px;background:var(--bg2);padding:12px;min-width:0}
#wpRoot .wp-cat.off{opacity:.6}
#wpRoot .wp-cat.editing{opacity:1;border-color:var(--accent-border,var(--accent));box-shadow:0 0 0 3px var(--accent-bg,transparent)}
#wpRoot .wp-cat-hd{display:flex;align-items:center;gap:8px;min-width:0}
#wpRoot .wp-ic{font-size:18px;width:26px;text-align:center;flex:none}
#wpRoot .wp-nm{flex:1;min-width:0;display:flex;flex-direction:column}
#wpRoot .wp-nm b{font:600 14px var(--font);color:var(--text);overflow-wrap:anywhere}
#wpRoot .wp-nm small{font-size:11.5px;color:var(--text3);line-height:1.35}
#wpRoot .wp-tag{font:600 10.5px var(--font);padding:2px 7px;border-radius:999px;background:var(--card);color:var(--text2);border:1px solid var(--border);white-space:nowrap;flex:none}
#wpRoot .wp-tag.warn{color:#b26b00;border-color:color-mix(in srgb,#e0a800 45%,transparent)}
#wpRoot .wp-ed{flex:none;height:28px;padding:0 11px;border-radius:999px;border:1px solid var(--border2);background:var(--card);color:var(--accent);font:600 12px var(--font);cursor:pointer}
#wpRoot .wp-chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:10px}
#wpRoot .wp-chip{display:inline-flex;align-items:center;gap:4px;max-width:100%;min-height:26px;padding:3px 9px;border-radius:999px;background:var(--card);border:1px solid var(--border);color:var(--text);font:500 12.5px var(--font);line-height:1.3;overflow-wrap:anywhere}
#wpRoot .wp-chip[hidden],#wpRoot [hidden]{display:none !important}
#wpRoot .wp-chip.own{background:var(--accent-bg,var(--card));border-color:var(--accent-border,var(--accent));color:var(--accent)}
#wpRoot .wp-chip.code{border-color:var(--border2);font-weight:600}
#wpRoot .wp-chip.weak{border-style:dashed;color:var(--text2)}
#wpRoot .wp-chip.dropped{text-decoration:line-through;color:var(--text3);opacity:.7}
#wpRoot .wp-dots{font-style:normal;color:var(--text3)}
#wpRoot .wp-chip em{font-style:normal;color:var(--text3);font-weight:400}
#wpRoot .wp-x{display:inline-grid;place-items:center;width:22px;height:22px;margin:-2px -5px -2px 0;border:0;border-radius:50%;background:transparent;color:var(--text3);font:600 15px/1 var(--font);cursor:pointer;flex:none;padding:0}
#wpRoot .wp-x:hover{background:var(--border);color:var(--text)}
#wpRoot .wp-none{color:var(--text3);font-size:12.5px}
#wpRoot .wp-notes{display:flex;flex-direction:column;gap:3px;margin-top:8px}
#wpRoot .wp-notes small{font-size:12px;color:var(--text2);line-height:1.4}
#wpRoot .wp-form{display:grid;grid-template-columns:52px 1fr auto;gap:8px;align-items:center;margin-top:10px}
#wpRoot .wp-form input:not([type=checkbox]),#wpRoot .wp-add input,#wpRoot .wp-new input,#wpRoot .wp-new select,#wpRoot .wp-dform input,#wpRoot .wp-dform select{height:36px;padding:0 10px;border:1px solid var(--border2);border-radius:9px;background:var(--card);color:var(--text);font:500 13.5px var(--font);min-width:0;width:100%}
#wpRoot .wp-emoji{text-align:center;padding:0 4px !important}
#wpRoot .wp-sw{position:relative;display:inline-block;width:46px;height:28px;flex:none;cursor:pointer}
#wpRoot .wp-sw input{position:absolute;inset:0;opacity:0;margin:0;cursor:pointer}
#wpRoot .wp-sw i{position:absolute;inset:0;border-radius:999px;background:var(--border2);transition:background .2s;pointer-events:none}
#wpRoot .wp-sw i::after{content:'';position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:transform .2s}
#wpRoot .wp-sw input:checked+i{background:#30c159}
#wpRoot .wp-sw input:checked+i::after{transform:translateX(18px)}
#wpRoot .wp-sw input:focus-visible+i{box-shadow:0 0 0 3px var(--accent-bg)}
#wpRoot .wp-add{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}
#wpRoot .wp-add input{flex:1 1 140px}
#wpRoot .wp-add .btn{flex:none;height:36px}
#wpRoot .wp-restore{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px;flex-wrap:wrap}
#wpRoot .wp-restore small{color:var(--text3);font-size:12px}
#wpRoot .wp-new{display:flex;gap:6px;margin-top:12px;flex-wrap:wrap;align-items:center}
#wpRoot .wp-new input{flex:1 1 180px;max-width:320px}
#wpRoot .wp-new select{flex:0 0 120px;width:120px}
#wpRoot .wp-new .btn{flex:none;height:36px}
#wpRoot .wp-ex{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-direction:column;gap:4px}
#wpRoot .wp-ex li{display:flex;flex-wrap:wrap;gap:2px 8px;font-size:12.5px;color:var(--text2);min-width:0}
#wpRoot .wp-ex code{font:600 12px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--text);background:var(--card);border:1px solid var(--border);border-radius:6px;padding:1px 6px;overflow-wrap:anywhere}
#wpRoot .wp-ex span{overflow-wrap:anywhere}
#wpRoot .wp-why{margin:8px 0 0;font-size:12px;color:var(--text3);line-height:1.4}
#wpRoot .wp-dform{display:grid;grid-template-columns:1fr 1.2fr 1.5fr auto;gap:8px;margin:0 0 12px}
#wpRoot .wp-dbtn{display:flex;gap:6px}
#wpRoot .wp-dbtn .btn{height:36px}
#wpRoot .wp-dlist{display:flex;flex-direction:column;border:1px solid var(--border);border-radius:12px;overflow:hidden}
#wpRoot .wp-drow{display:grid;grid-template-columns:110px 1fr 160px auto;gap:10px;align-items:center;padding:9px 12px;border-top:1px solid var(--border);background:var(--bg2);font-size:13px;min-width:0}
#wpRoot .wp-drow:first-child{border-top:0}
#wpRoot .wp-drow.off{opacity:.55}
#wpRoot .wp-dw{font:700 13px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--text);overflow-wrap:anywhere}
#wpRoot .wp-dm{color:var(--text);display:flex;flex-direction:column;min-width:0}
#wpRoot .wp-dm small{color:var(--text3);font-size:12px;overflow-wrap:anywhere}
#wpRoot .wp-dby{color:var(--text3);font-size:12px;overflow-wrap:anywhere}
#wpRoot .wp-dact{display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end}
#wpRoot .wp-b{height:28px;padding:0 10px;border-radius:8px;border:1px solid var(--border2);background:var(--card);color:var(--text);font:600 12px var(--font);cursor:pointer}
#wpRoot .wp-empty{color:var(--text3);font-size:13px;margin:12px 0}
@media (max-width:640px){
  #wpRoot .wp-cats{grid-template-columns:1fr}
  #wpRoot .wp-sec>summary{padding:12px}
  #wpRoot .wp-body{padding:0 12px 12px}
  #wpRoot .wp-dform{grid-template-columns:1fr 1fr}
  #wpRoot .wp-dform #wpDN{grid-column:1/-1}
  #wpRoot .wp-dbtn{grid-column:1/-1}
  #wpRoot .wp-dbtn .btn{flex:1}
  #wpRoot .wp-drow{grid-template-columns:84px 1fr;gap:4px 10px}
  #wpRoot .wp-dby{grid-column:2}
  #wpRoot .wp-dact{grid-column:1/-1;justify-content:flex-start}
  #wpRoot .wp-new select{flex:1 1 100px}
  #wpRoot .wp-tryout{grid-template-columns:1fr;gap:0}
  #wpRoot .wp-tryout dd{margin-bottom:6px}
}`;
const NAV_IC = '<svg class="ho-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 5.5A1.5 1.5 0 0 1 3.5 4H9a3 3 0 0 1 3 3v13a2.5 2.5 0 0 0-2.5-2.5H3.5A1.5 1.5 0 0 1 2 16z"/><path d="M22 5.5A1.5 1.5 0 0 0 20.5 4H15a3 3 0 0 0-3 3v13a2.5 2.5 0 0 1 2.5-2.5h6A1.5 1.5 0 0 0 22 16z"/></svg>';
function mount() {
  const main = doc.querySelector('#appWrapper .main') || doc.querySelector('.main') || doc.querySelector('main');
  const nav = doc.querySelector('.sidenav'); if (!main || !nav || doc.getElementById('panel-' + PANEL)) return;
  const s = doc.createElement('style'); s.textContent = CSS; doc.head.appendChild(s);
  const panel = doc.createElement('div'); panel.className = 'panel'; panel.id = 'panel-' + PANEL; panel.innerHTML = '<div id="wpRoot"></div>';
  main.appendChild(panel);
  panel.addEventListener('click', onClick);
  panel.addEventListener('change', onChange);
  panel.addEventListener('keydown', onKey);
  panel.addEventListener('input', onInput);
  panel.addEventListener('toggle', onToggle, true);
  const item = doc.createElement('div'); item.className = 'nav-item'; item.id = 'nav-' + PANEL; item.dataset.panel = PANEL;
  item.setAttribute('onclick', "showPanel('" + PANEL + "')");
  item.innerHTML = '<div class="nav-icon" data-ho-ic="1" data-emoji="📖">' + NAV_IC + '</div>Words &amp; phrases';
  nav.appendChild(item);
  const grid = doc.querySelector('.mob-more-grid');
  if (grid) {
    const b = doc.createElement('button'); b.className = 'mob-more-item'; b.dataset.panel = PANEL; b.type = 'button';
    b.setAttribute('onclick', "showPanel('" + PANEL + "');(typeof closeMobMore==='function'?closeMobMore:function(){})()");
    b.innerHTML = '<span class="mob-item-icon" data-ho-ic="1" data-emoji="📖">' + NAV_IC + '</span>Words &amp; phrases'; grid.appendChild(b);
  }
  safe(() => {
    if (typeof ROLES !== 'undefined') ['owner', 'manager', 'supervisor', 'agent', 'readonly'].forEach(r => { const p = ROLES[r] && ROLES[r].panels; if (p && !p.includes(PANEL)) p.push(PANEL); });
    if (typeof currentProfile !== 'undefined' && currentProfile && typeof applyRole === 'function') applyRole(currentProfile.role);
  });
  safe(() => { if (typeof W.hoNavOrder === 'function') W.hoNavOrder(); });
  const active = () => panel.classList.contains('active');
  const busy = () => { const a = doc.activeElement; return !!(a && a.closest && a.closest('#wpRoot') && /^(?:INPUT|SELECT|TEXTAREA)$/.test(a.tagName)); };
  let was = false;
  new MutationObserver(() => { const on = active(); if (on && !was) render(); was = on; }).observe(panel, { attributes: true, attributeFilter: ['class'] });
  // the team's changes (another device, Settings) show here at once
  let t = 0; const later = () => { clearTimeout(t); t = setTimeout(() => { if (active() && !busy()) render(); }, 250); };
  safe(() => { if (cfg() && typeof cfg().on === 'function') cfg().on(later); });
  safe(() => { if (W.hoWaWords && typeof W.hoWaWords.onChange === 'function') W.hoWaWords.onChange(later); });
}
/** open the page (Settings → Categories, the WhatsApp words tab): kind 'hk' | 'ho' | 'rh' | 'wa' opens that part */
W.hoWordsOpen = function (kind) {
  const sec = { hk: 'hk', ho: 'ho', rh: 'rh', wa: 'cmd', cmd: 'cmd', dict: 'dict', voice: 'voice' }[kind] || '';
  if (sec) { st.open.add(sec); if (sec === 'cmd') st.open.add('dict'); saveOpen(); }
  st.q = '';
  if (typeof showPanel === 'function') showPanel(PANEL);
  render();
  if (sec) setTimeout(() => { const el = doc.querySelector(`#wpRoot .wp-sec[data-sec="${sec}"]`); if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60);
};
// Ops Brain: "words", "vocabulary", "what does LCO mean"…
(W.BR_EXTRA = W.BR_EXTRA || []).push(() => [{ id: 'words-page', kind: '📖 Words & phrases', title: 'Words & phrases', body: 'Every word HotelOps understands: HK requests, Handover topics, Room Health, WhatsApp commands, the team\'s dictionary and voice.<div class="br-acts"><button class="btn gold" onclick="brClose();hoWordsOpen()">Open Words &amp; phrases</button></div>', text: 'words phrases vocabulary dictionary keywords built-in words categories whatsapp commands voice', boost: 1 }]);
if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', mount); else mount();
})();
