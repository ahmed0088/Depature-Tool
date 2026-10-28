// ═══════════════════════════════════════════════════════════
//  handover-book.js — 📒 Handover Book (Front Desk)
//
//  A WhatsApp group used only for the shift handover (its name has "HO" or
//  "handover" in it, e.g. "HO - Ibis Styles", or it is switched to Handover
//  in the WhatsApp window's Groups) is saved here instead of changing the
//  Departures board. wa-bridge.js hands each message to hoHandoverBook.fromWa().
//
//   • A long message (lines, bullets, "1." / "-" / "•") becomes one item per
//     line; each item keeps a link to the whole message (msg, full).
//   • Each item gets a category (keyword based, changeable), the rooms and
//     tags (from hoWaParse: "LCO 2 PM", "CO", "EXT +2N" and a few words like
//     VIP, ED, TD…), a shift (SHIFT_BOUNDS) and a status: open / done / info.
//   • A free, offline "tidy English" pass (rule based, no AI): "room 512 have
//     bad smell" → "Room 512 has a bad smell." Both texts are kept.
//   • Stored at handover/{YYYY-MM-DD}/{key} with the db.js helpers
//     (fbListen / fbGet / fbUpdate; this device's copy when offline).
//   • The page: date, shift / category / status / sender / room / text
//     filters, a summary, "still open from yesterday", Done / note / edit,
//     add by hand, and Export: a styled Excel report (ExcelJS, loaded only when
//     exporting; a plain SheetJS file when it cannot load).
//  Pure helpers: window.hoHandoverPure (tested in tests/run-tests.js).
//  Load after wa-bridge.js and wa-brain.js.
// ═══════════════════════════════════════════════════════════
(function () {
'use strict';
const W = typeof window !== 'undefined' ? window : globalThis;
const doc = typeof document !== 'undefined' && document && document.createElement ? document : null;

// ══ Small pure helpers ══════════════════════════════════════
const sp = s => String(s == null ? '' : s).replace(/[   ]/g, ' ').replace(/[‎‏⁦-⁩⁣​]/g, '');
const pad = n => String(n).padStart(2, '0');
const isoDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayAdd = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return isoDay(x); };
const toMin = t => { const m = String(t || '').match(/^(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
const t12 = t => { const m = toMin(t); return m == null ? String(t || '') : (Math.floor(m / 60) % 12 || 12) + ':' + pad(m % 60) + (m >= 720 ? ' PM' : ' AM'); };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-10-20" → "20 Oct 2026" */
const dLong = d => { const p = String(d || '').split('-'); return p.length === 3 ? +p[2] + ' ' + MON[+p[1] - 1] + ' ' + p[0] : String(d || ''); };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hash = s => { s = String(s); let h = 5381, g = 7; for (let i = 0; i < s.length; i++) { h = ((h << 5) + h + s.charCodeAt(i)) | 0; g = (g * 31 + s.charCodeAt(i)) | 0; } return (h >>> 0).toString(36) + (g >>> 0).toString(36); };
const fbSafe = k => String(k == null ? '' : k).replace(/[.#$\[\]\/\x00-\x1f\x7f]/g, '_').slice(0, 140) || '_';

// ══ Handover groups ═════════════════════════════════════════
const HO_GROUP_RX = /\bHO\b|hand\s*-?\s*over/i;
/** is this WhatsApp group a handover group? setting: true / false (set by hand) or undefined (by its name) */
function isHandoverGroup(name, setting) {
  if (setting === true || setting === false) return setting;
  return HO_GROUP_RX.test(sp(name));
}

/** "HO - Room 512 to twin tomorrow", "HO: …", "ho …", "H/O …", "Handover: …" → the text after the mark (null: not marked).
 *  "HOTEL…", "HOLD…" and "Hold on" do not count. */
const HO_PREFIX_RX = /^\s*(?:\*\s*)?(?:HO|H\/O|hand\s*-?\s*over)(?![A-Za-z0-9])\s*\*?\s*[-–—:.,|>]*\s*/i;
function hoPrefix(text) {
  const s = sp(text), m = s.match(HO_PREFIX_RX); if (!m) return null;
  const rest = s.slice(m[0].length).trim();
  if (!rest) return null;
  // a plain "ho" / "Ho" (not "HO", no "-" or ":") only before a room or a number: "ho 512 ED" yes, "Ho gaya" / "ho jayega" no
  if (/^(?:\*\s*)?(?:ho|Ho|hO)$/.test(m[0].trim()) && !/^(?:\d|r(?:oo)?ms?\b)/i.test(rest)) return null;
  if (/^(?:\*\s*)?hand\s*-?\s*over$/i.test(m[0].trim()) && HANDED_RX.test(s)) return null;   // "Hand over the keys to the guest"
  if (/^(?:\*\s*)?HO$/.test(m[0].trim()) && HO_NEXT_CHAT.test((rest.match(/^([A-Za-z']+)/) || [])[1] || '')) return null;   // "HO GAYA" is Hindi
  return rest;
}

// ══ "Is this message meant for the handover?" ═══════════════
// From WhatsApp only two things go to the Handover Book (wa-bridge.js):
//   (a) everything posted in the handover group (Handover group switch, or a group name with "handover" / a standalone "HO"), and
//   (b) a message that says it is for the handover: "HO: 512 waiting for transfer", "512 waiting for transfer #ho",
//       "Handover - taxi 5am", "(HO) 305 refund", "305 refund pending HO".
// Never inside a word ("hotel", "who", "shower", "hold"), and a lower-case "ho" in the middle of a sentence is Hindi or Tagalog
// ("kya ho raha hai", "salamat ho"): a small "ho" counts only at the start (before a room or with "-" / ":"), at the end, with "#", or with ":" / "-" after it.
const HO_NEXT_CHAT = /^(?:gaya|gayi|gaye|gya|gyi|gye|jayega|jaega|jayegi|jaegi|jaye|jaaye|jaa|ja|jao|jata|jaata|jati|raha|rahi|rahe|rha|rhi|rhe|sakta|sakti|sakte|skta|skte|sake|chuka|chuki|chuke|na|naa|ga|gi|ge|to|tha|thi|the|kya|ki|hai|hain|he|kar|kr|ke|lo|le|po|kayo|ba|lang|naman)$/i;
const HO_PREV_CHAT = /^(?:kya|kaise|kese|kaisa|kahan|kaha|kidhar|jo|bhi|nahi|nahin|nhi|mat|tum|aap|ap|ready|free|busy|theek|thik|ok|okay|khush|salamat|po|opo|oo|sige|na|lang|ba|naman|kayo|ito|yan|yun|dito|diyan|saan|ano|paano)$/i;
const HO_ANY_RX = /(^|[^A-Za-z0-9\/#])(#\s?)?(hand\s*-?\s*over|h\/o|ho)(?![A-Za-z0-9])/gi;
/** the handover mark in a message → {rest, how} (rest: the text without "HO:" / "#ho"), or null when the message is not marked.
 *  how: 'prefix' (at the start), 'tag' (#ho), 'word' (HO / handover elsewhere). A mark with nothing else ("HO") is no item. */
function hoMark(text) {
  const s = sp(text);
  const pre = hoPrefix(s);
  if (pre != null) return { rest: pre, how: 'prefix' };
  let found = null, m;
  HO_ANY_RX.lastIndex = 0;
  while ((m = HO_ANY_RX.exec(s))) {
    const start = m.index + m[1].length, tag = !!m[2], w = m[3], end = start + (m[2] || '').length + w.length;
    const after = s.slice(end), before = s.slice(0, start);
    const punct = /^\s*[:\-–—|>]/.test(after), closeB = /^\s*[)\]]/.test(after) && /[(\[]\s*$/.test(before);
    const atEnd = !/[A-Za-z0-9]/.test(after), next = (after.match(/^\s*([A-Za-z']+)/) || [])[1] || '', prev = (before.match(/([A-Za-z']+)[\s,]*$/) || [])[1] || '';
    let ok = false, strip = true;
    if (tag || closeB) ok = true;
    else if (!/^ho$/i.test(w)) { ok = punct || atEnd || !HANDED_RX.test(s); strip = punct || atEnd; }    // "handover", "hand over", "H/O" (not "I'll hand over the keys")
    else if (w === 'HO') ok = punct || !HO_NEXT_CHAT.test(next);                                    // a capital HO anywhere ("HO GAYA" is Hindi)
    else ok = punct || (atEnd && !!prev && !HO_PREV_CHAT.test(prev));                                // a small "ho": only "ho:" / "ho -" or the last word
    if (!ok) continue;
    found = { start, end, strip, how: tag ? 'tag' : 'word' };
    break;
  }
  if (!found) return null;
  let rest = s;
  if (found.strip) {
    rest = s.slice(0, found.start).replace(/[(\[]\s*$/, '') + ' ' + s.slice(found.end).replace(/^\s*[)\]]/, '').replace(/^\s*[:\-–—|>]+/, '');
    rest = rest.replace(/[ \t]{2,}/g, ' ').replace(/^[\s:\-–—|>.,]+/, '').replace(/[\s:\-–—|>,]+$/, '').trim();
  }
  return rest && /[A-Za-z0-9\u0600-\u06ff]/.test(rest) ? { rest, how: found.how } : null;
}
/** the text of a WhatsApp message as it goes into the book: without its "HO:" / "#ho" mark */
const hoStrip = text => { const r = hoMark(text); return r ? r.rest : sp(text); };
/** where a WhatsApp message goes: 'group' (posted in the handover group), 'mark' (it says HO / #ho / handover) or null (not to the Handover Book at all) */
function waToHandover(group, text, setting) {
  if (isHandoverGroup(group || '', setting)) return 'group';
  return hoMark(text) ? 'mark' : null;
}

// ══ Shifts ══════════════════════════════════════════════════
/** the three shifts (minutes from midnight; Night goes past midnight). The hotel's own hours and names
 *  (Settings → Hotel setup → Shifts, hotel-setup.js) are written into these entries; the ids stay. */
const SHIFT_BOUNDS = [
  { id: 'Morning', from: 7 * 60, to: 15 * 60, icon: '🌅' },
  { id: 'Afternoon', from: 15 * 60, to: 23 * 60, icon: '🌇' },
  { id: 'Night', from: 23 * 60, to: 7 * 60, icon: '🌙' },
];
/** "09:05" → "Morning", "15:00" → "Afternoon", "23:10" / "02:00" → "Night" ('' for no time) */
function shiftOf(t) {
  const m = toMin(t); if (m == null) return '';
  const s = SHIFT_BOUNDS.find(b => (b.from < b.to ? m >= b.from && m < b.to : m >= b.from || m < b.to));
  return s ? s.id : '';
}

/** the roster's shift type (roster.js: morning / afternoon / night) → our shift name */
const SHIFT_OF_TYPE = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Afternoon', night: 'Night' };
const nameToks = n => sp(n).toLowerCase().replace(/[^a-z\u0600-\u06ff ]+/g, ' ').split(/\s+/).filter(w => w.length >= 3);
/** a WhatsApp name ("~ Sam Test", "Sam T") ↔ a roster name ("SAM TESTER"): the same first name, or a shared name part */
function sameName(a, b) {
  const A = nameToks(a), B = nameToks(b); if (!A.length || !B.length) return false;
  return A[0] === B[0] || A.some(w => w.length >= 4 && B.includes(w));
}
/** the usual hours of a group of items ("12:00–21:00"), from the roster ('' when unknown) */
function hoursOf(items) {
  const n = {}; (items || []).forEach(i => { if (i && i.shiftHours) n[i.shiftHours] = (n[i.shiftHours] || 0) + 1; });
  return Object.keys(n).sort((a, b) => n[b] - n[a])[0] || '';
}
/** the shift from the roster: whoever wrote it is working then → their shift (e.g. Afternoon 12:00–21:00).
 *  people: [{name, info:{type, from, to}, me?}] working at that moment; sender: who wrote it; mine: written by me */
function rosterShiftOf(people, sender, mine) {
  const L = (people || []).filter(x => x && x.info && SHIFT_OF_TYPE[x.info.type]);
  const p = (!mine && sender && L.find(x => sameName(sender, x.name))) || L.find(x => x.me);
  return p ? { id: SHIFT_OF_TYPE[p.info.type], hours: p.info.from && p.info.to ? p.info.from + '–' + p.info.to : '', who: p.name } : null;
}

// ══ Learning: what you remove (or add back) teaches the book ══
const LEARN_STOP = new Set('the and for with from that this have has had was were are is will would please pls plz kindly also just only need needs needed room rooms guest guests today tomorrow tonight now asap ok okay thanks thank you your our his her their him she he they them sir madam mam dear team all any not yes'.split(' '));
/** the words that carry the meaning (no numbers, rooms, times or filler) */
function learnToks(text) {
  const w = sp(text).toLowerCase().replace(/\b\d+(?:[:.]\d+)?\s*(?:am|pm)?\b/g, ' ').replace(/[^a-z\u0600-\u06ff ]+/g, ' ').split(/\s+/).filter(x => x.length >= 3 && !LEARN_STOP.has(x));
  return [...new Set(w)].slice(0, 30);
}
/** how alike two word lists are (0…1) */
function simOf(a, b) {
  const A = new Set(a || []), B = new Set(b || []); if (!A.size || !B.size) return 0;
  let n = 0; A.forEach(x => { if (B.has(x)) n++; });
  return n / (A.size + B.size - n);
}
/** what was learned about text like this: {v:'no'|'yes', sim} (sure), {v:'ask', like, sim} (not sure), or null.
 *  examples: [{t:[words], v:'no'|'yes'}] */
function learnedVerdict(text, examples) {
  const t = learnToks(text); if (!t.length) return null;
  let best = null;
  (examples || []).forEach(e => { if (!e || !Array.isArray(e.t) || (e.v !== 'yes' && e.v !== 'no')) return; const s = simOf(t, e.t); if (!best || s > best.sim || (s === best.sim && (e.at || 0) > best.at)) best = { v: e.v, sim: s, at: e.at || 0 }; });   // the same match: the newer lesson wins
  if (!best || best.sim < 0.4) return null;
  return best.sim >= 0.6 ? { v: best.v, sim: best.sim } : { v: 'ask', like: best.v, sim: best.sim };
}

/** a field you set by hand on messages like this one ('cat:res' → 'res', 'st:open' → 'open'), or '' */
function learnedField(text, examples, kind) {
  const t = learnToks(text); if (!t.length) return '';
  let best = null;
  (examples || []).forEach(e => { if (!e || !Array.isArray(e.t) || String(e.v || '').indexOf(kind + ':') !== 0) return; const s = simOf(t, e.t); if (s >= 0.6 && (!best || s > best.sim || (s === best.sim && (e.at || 0) > (best.at || 0)))) best = { v: e.v.slice(kind.length + 1), sim: s, at: e.at }; });
  return best ? best.v : '';
}
/** the words you changed when editing: "Room 512 has bad smel." → "Room 512 has a bad smell." gives [['smel', 'smell']] (one word for one word only) */
function wordSwaps(before, after) {
  const A = sp(before).split(/\s+/).filter(Boolean), B = sp(after).split(/\s+/).filter(Boolean);
  const clean = w => w.replace(/^[^\w\u0600-\u06ff]+|[^\w\u0600-\u06ff]+$/g, '');
  const out = [];
  // line the two up by the words they share, then a single word between two shared ones is a swap
  let i = 0, j = 0;
  while (i < A.length && j < B.length) {
    if (clean(A[i]).toLowerCase() === clean(B[j]).toLowerCase()) { i++; j++; continue; }
    const a1 = clean(A[i]), b1 = clean(B[j]);
    const nextA = A[i + 1] && clean(A[i + 1]).toLowerCase(), nextB = B[j + 1] && clean(B[j + 1]).toLowerCase();
    if (nextA === nextB || (!A[i + 1] && !B[j + 1])) { if (a1 && b1 && /[a-z]/i.test(a1) && !/\d/.test(a1 + b1) && a1.length >= 2) out.push([a1.toLowerCase(), b1]); i++; j++; continue; }
    if (B[j + 1] && clean(B[j + 1]).toLowerCase() === clean(A[i]).toLowerCase()) { j++; continue; }   // a word added
    if (A[i + 1] && clean(A[i + 1]).toLowerCase() === clean(B[j]).toLowerCase()) { i++; continue; }   // a word removed
    i++; j++;
  }
  return out.slice(0, 5);
}
/** your own word fixes on a new text (whole words, any case) */
function applySwaps(text, swaps) {
  let t = String(text || '');
  (swaps || []).forEach(([a, b]) => { if (!a || !b) return; t = t.replace(new RegExp('(^|[^\\w])' + a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w])', 'gi'), (m, pre) => pre + b); });
  return t;
}

// ══ "Done" replies: ticking an item from WhatsApp ══
const REPLY_DONE_RX = /^(?:(?:ok|okay|yes|yeah|already|all|it'?s|its|has\s+been|been)\s+)*(?:done|completed?|finished|sorted|handled|fixed|resolved|settled|cleared|collected|paid|moved|shifted|changed|informed|updated|delivered|khalas|tamam|dn|dne)(?:\s+(?:already|now|thanks|thank\s+you|sir|madam|ma'?am|dear|bro|done))*$/;
/** "Done ✅", "506 collected", "ok done", "✅" → {rooms:[…]} when it only says something is done; else null */
function doneReply(text) {
  const raw = sp(text).trim(); if (!raw || raw.length > 60 || /\n/.test(raw)) return null;
  const rooms = (raw.match(/\b\d{3,4}[A-Za-z]?\b/g) || []).map(r => String(parseInt(r, 10)));
  const t = raw.replace(/[✅✔☑]\ufe0f?/g, ' done ').replace(/👍(?:\p{Emoji_Modifier})?/gu, ' done ').replace(/[\p{Extended_Pictographic}\ufe0f\u200d]/gu, ' ')
    .replace(/\b(?:room|rm)\b/gi, ' ').replace(/\b\d{3,4}[A-Za-z]?\b/g, ' ').replace(/[.!,;:\-–—]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  return t && REPLY_DONE_RX.test(t) ? { rooms } : null;
}
/** what a "done" word says was done → the topics / words it fits ("collected" → payment) */
const DONE_FITS = [
  [/\b(?:collected|paid|settled|received|refunded|charged)\b/, ['pay', 'cash'], /collect|pay|balance|deposit|td|aed|refund|amount|cash/],
  [/\b(?:moved|shifted|changed)\b/, ['move'], /move|shift|change|twin|king|double|upgrade|downgrade|bed/],
  [/\b(?:fixed|repaired|resolved|working)\b/, ['maint', 'guest'], /fix|broken|leak|ac\b|not working|repair|smell|noise|wifi|tv/],
  [/\b(?:informed|called|told|updated)\b/, ['follow', 'guest', 'res'], /inform|call|tell|update|let .* know|follow/],
  [/\b(?:delivered|sent|given|handed)\b/, ['hk', 'lost', 'desk'], /deliver|send|give|hand|towel|amenit|cot|bed|key|item/],
  [/\b(?:blocked|booked|amended|cancelled|canceled)\b/, ['res'], /block|book|amend|cancel|ooo|out of (?:order|service)/],
];
/** which open item a "Done" reply is about: [{key, date, score}] best first.
 *  quote: the message it replied to; rooms: rooms in the reply; o: {text, group, at} of the reply (verb, same group, timing) */
function doneTargets(items, quote, rooms, o) {
  o = o || {};
  const qt = learnToks(quote || ''), qn = sp(quote || '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/[….]+$/, '');
  const said = sp(o.text || '').toLowerCase(), fit = DONE_FITS.find(f => f[0].test(said));
  const open = (items || []).filter(i => i && !i.del && !i.chat && i.status !== 'done');
  // the open items of the same group written shortly before the reply (newest first)
  // (by the WhatsApp time written on each message, not when HotelOps read it)
  const ts = i => (i.date && /^\d{1,2}:\d{2}/.test(i.time || '') ? Date.parse(i.date + 'T' + String(i.time).padStart(5, '0').slice(0, 5) + ':00') : 0) || i.at || 0;
  const recent = o.at ? open.filter(i => ts(i) && ts(i) <= o.at + 60e3 && o.at - ts(i) < 3 * 3600e3 && (!o.group || !i.group || i.group === o.group)).sort((a, b) => ts(b) - ts(a)) : [];
  const fits = i => !!fit && (fit[1].includes(i.cat) || fit[2].test(sp(i.orig || i.text || '').toLowerCase()));
  const nFit = open.filter(fits).length;
  return open.map(i => {
    const src = sp(i.full || i.orig || i.text || '').toLowerCase().replace(/\s+/g, ' ').trim();
    let score = 0;
    if (qn) {
      if (src && (src === qn || src.includes(qn) || qn.includes(src) || (qn.length >= 25 && src.startsWith(qn.slice(0, 25))))) score = 1;   // WhatsApp cuts long quotes
      else score = simOf(qt, learnToks(i.orig || i.text));
    }
    if (rooms && rooms.length && (i.rooms || []).some(r => rooms.includes(String(parseInt(r, 10))))) score += qn ? 0.3 : 0.7;
    if (fits(i)) score += nFit === 1 ? 0.8 : 0.4;                       // "collected" → the payment item (the only one: sure)
    if (!qn && !(rooms && rooms.length) && (!fit || fits(i))) {
      const R = recent.filter(x => !fit || fits(x)), k = R.indexOf(i);
      // the item just before the reply: sure when it came within 30 min and the one before it is clearly older
      if (k === 0) score += o.at - ts(i) <= 30 * 60e3 && (!R[1] || ts(i) - ts(R[1]) >= 3 * 60e3) ? 0.8 : 0.4;
      else if (k > 0) score += 0.15;
    }
    return { key: i.key, date: i.date, score: Math.round(score * 100) / 100 };
  }).filter(x => x.score > 0.15).sort((a, b) => b.score - a.score);
}

// ══ Categories ══════════════════════════════════════════════
const CATS = [
  ['guest', 'Guest / complaint', '🙋'], ['pay', 'Payment & billing', '💳'], ['res', 'Reservations', '📅'], ['move', 'Room move', '🔀'],
  ['maint', 'Room / maintenance', '🔧'], ['hk', 'Housekeeping', '🧹'], ['transport', 'Transport', '🚕'], ['lost', 'Lost & found', '🧳'],
  ['desk', 'Front desk & ID', '🛎️'], ['fb', 'Breakfast / F&B', '🍳'], ['follow', 'Follow-up / pending', '⏳'], ['cash', 'Cash / float', '💵'],
  ['info', 'Info / FYI', 'ℹ️'],
];
const CAT = {}; CATS.forEach(c => { CAT[c[0]] = { id: c[0], label: c[1], icon: c[2] }; });
// the hotel's own names, emoji, colours, extra words, categories switched off or added (Settings → Hotel setup → Categories)
const catSetup = W.hoCfg && typeof W.hoCfg.catHook === 'function'
  ? W.hoCfg.catHook('ho', CATS, CAT, c => ({ id: c[0], label: c[1], icon: c[2] }), (id, x) => [id, String(x.label), x.icon || '🏷️'])
  : () => null;
// first match wins (most specific first)
const CAT_RULES = [
  ['lost', /\blost\b|\bleft (?:behind|in the room)|\bforgot(?:ten)?\b|\bl\s*&\s*f\b|\blnf\b|\bitems? found\b|\bfound (?:an? |one |the |his |her |guest)/],
  ['cash', /\bfloat\b|\bpetty cash|\bcash (?:count|short|over|handover|handed|in hand|box|drawer|drop)|\bdrawer\b|\bsafe (?:balance|count)\b|\bbanking\b|\bshort(?:age)? (?:of )?(?:aed|dhs?)\b/],
  ['guest', /\bcomplain\w*|\bunhappy\b|\bangry\b|\bupset\b|\bnot happy\b|\brude\b|\bcompensat\w*|\bapologi[sz]\w*|\bnois[ey]\b|\bdisturb(?!\b)\w*|\bbad review|\bescalat\w*|\bnot satisfied|\bdissatisf\w*/],
  ['pay', /\bbalance\b|\btd\b|\bdeposit\b|\brefund\w*|\bcity ledger|\bc\/l\b|\binvoice\w*|\bpayments?\b|\bpaid\b|\bunpaid\b|\bpay\b|\bbill(?:ing|ed)?\b|\bfolio\b|\bcharged?\b|\bcredit card|\bcc\b|\bpre-?auth\w*|\bauthori[sz]ation|\boutstanding\b|\bsettle\w*|\bvcc\b|\baed\b|\bdhs?\b|\breceipt|\bcheque|\bamount\b/],
  ['guest', /\bvip\b|\bbirthday|\banniversary|\bhoneymoon/],
  ['transport', /\btaxi|\bcab\b|\bairport\b|(?<!\b(?:laundry|garbage|trash|linen|tray)\s)\bpick-?\s?up\b(?!\s+(?:the\s+)?(?:laundry|garbage|trash|tray))|\bdrop(?:-| )?off\b|\blimo\w*|\bdriver\b|\bshuttle|\bcareem|\buber\b|\bflight\b|\bcar (?:booked|arranged|service)/],
  ['res', /\bbooking\w*|\breservation\w*|\bres\b|\bamend\w*|\bcancel\w*|\bno-?\s?show|\bearly dep\w*|\bearly check-?\s?out|\bleaving early|\bcut short|\bshorten\w*|\bed\b|\bextension\b|\bextend\w*|\bext\b|\bwalk-?\s?in|\bguarantee\w*|\bconfirmation\b|\brate\b|\bgroup (?:block|booking|arrival)|\blate arrival|\beta\b|\barriv(?:al|als|ing)\b|\bpre-?reg\w*|\broom blocked|\bblocked for\b|\bblock(?:ed)? (?:room|rooms)\b|\bota\b|\bexpedia|\bstay\b/],
  ['hk', /\bextra bed|\bbaby cot|\bcot\b|\brollaway|\bsofa bed/],
  ['move', /\broom move|\bmov(?:e|ed|ing) (?:to|from|him|her|them|the guest|guest|room)\b|\bshift(?:ed|ing)? (?:to|from|room|him|her|them|the guest|guest)\b|\bchange (?:the )?room|\broom change|\bswap\b|\bupgrad\w*|\bdowngrad\w*|\bto (?:a )?(?:twin|king|double|queen)\b|\bbed type/],
  // "need king bed", "make it 2 beds", "separate the beds": how HK makes the room up, not a room move
  ['hk', /\btwin\b|\bdouble bed|\bking bed|\bqueen bed|\b(?:\d|two|one) ?beds?\b|\bseparate (?:the )?beds/],
  ['maint', /\bac\b|\ba\/c\b|\baircon\w*|\bair ?con\w*|\bleak\w*|\bbroken\b|\bnot working|\bengineer\w*|\bmaintenance|\bmaint\b|\bplumb\w*|\btoilet(?! (?:paper|roll|tissue))|\bshower(?! ?(?:gel|cap|caps|cream))|\bflush|\bdrain|\blights? (?:not|off|out)|\bbulb|\btv\b|\bremote\b|\bdoor lock|\block (?:not|broken|issue)|\bsafe (?:not|locked|issue|problem)|\bwi-?fi|\binternet\b|\bsmell\w*|\bodou?r\b|\bhot water|\bno water|\bwater (?:heater|leak|pressure)|\btechnician|\brepair\w*|\bfix(?:ed)?\b|\bout of order|\booo\b|\bout of service|\boos\b|\bfridge|\bkettle|\bsocket|\bpower cut|\belectric\w*|\bpest|\bcockroach|\bbed ?bugs?|\bceiling|\bcurtain/],
  ['guest', /\bvip\b|\bbirthday|\banniversary|\bhoneymoon|\bwelcome (?:amenity|drink|letter|card)|\bcake\b/],
  ['hk', /\bhousekeeping|\bhk\b|\bshower gel|\brefill\w*|\btowels?\b|\blinen|\bclean\w*|\bmake up room|\bmur\b|\bamenit\w*|\bturn ?down|\blaundry|\bdirty\b|\bminibar|\bbed ?sheets?|\bpillows?\b|\bblankets?\b|\btoiletr\w*|\bslippers|\bbathrobe|\bwater bottles?|\binspect\w*|\bvd\b|\bvc\b/],
  ['fb', /\bbreakfast|\bbf\b|\bb\/f\b|\bf\s?&\s?b\b|\brestaurant|\broom service|\bin-?room dining|\bird\b|\bdinner\b|\blunch\b|\bmeals?\b|\bkitchen|\bbar\b/],
  ['desk', /\bwake-?\s?up|\bmorning call|\bkeys?\b|\bkey ?cards?|\bparking|\bvalet|\bcar park|\bvisitors?\b|\bpassports?\b|\bemirates id|\bid\b|\bid copy|\bpolice|\bimmigration|\bdnd\b|\bdo not disturb|\bno answer|\bnot answering|\bn\/a\b|\bregistration card|\breg card|\brc\b|\bsecurity\b|\bcctv/],
  ['guest', /\bguest (?:request\w*|asked|asks|wants|wanted|needs|called)|\bspecial request|\bfeedback|\breview\b|\bloyal\w*|\ball member|\bplatinum|\bgold member|\brepeat guest/],
  ['follow', /\bpending\b|\bfollow[- ]?up|\bf\/u\b|\bcheck\b|\bchk\b|\bcall back|\bcallback|\bwaiting\b|\btomorrow|\btmrw?\b|\bremind\w*|\bto ?do\b|\bnot yet\b|\bstill\b|\bto be (?:done|checked|confirmed)/],
];
/** a handover line → its category id (Info / FYI when nothing matches) */
function categorize(text, head) {
  const t = sp((head ? head + ' : ' : '') + text).toLowerCase();
  const X = catSetup();
  const w = X && X.words.find(([, re]) => re.test(t));
  if (w) return w[0];
  const r = CAT_RULES.find(([id, re]) => !(X && X.off.has(id)) && (X ? X.hit(id, re, t) : re.test(t)));   // built-in words the hotel removed do not count
  return r ? r[0] : 'info';
}
const OPEN_RX = /\bpending\b|\bto ?do\b|\bplease\b|\bpl[sz]\b|\bkindly\b|\bcheck\b|\bchk\b|\bfollow[- ]?up|\bf\/u\b|\bcall back|\bcallback|\bwaiting\b|\bneeds?\b|\bneeded\b|\bmust\b|\bhas to\b|\bhave to\b|\bshould\b|\btomorrow|\btmrw?\b|\bremind\w*|\bnot yet\b|\bstill\b|\bto be\b|\bamend\w*|\bcollect\b|\bchase\b|\barrange\b|\burgent\w*|\basap\b|\bmake sure|\bdon'?t forget|\bwill (?:arrive|come|check|call|pay|leave|collect|send)|\bexpected\b|\beta\b|\bnot (?:paid|done|fixed|collected|received|working|answering)|\bmissing\b|\bno answer\b|\barriv(?:ing|al)\b|\bearly dep\w*|\bearly check-?\s?out|\bleaving early|\bcut short|\bshorten\w*|\bed\b|\brequested\b|\bwants?\b|\basked\b|\?/;
const DONE_RX = /\b(?:done|fixed|solved|resolved|completed|sorted|settled|handled|closed|informed|delivered|returned|handed (?:over|to)|picked up|collected|received|paid|refunded|checked out|approved)\b|✅|✔|☑/;
/** a new item's status: 'open' (something to do) or 'info' */
function statusOf(text, cat, head) {
  const t = sp((head ? head + ' : ' : '') + text).toLowerCase();
  if (OPEN_RX.test(t)) return 'open';
  if (DONE_RX.test(t)) return 'info';
  return cat === 'follow' || cat === 'move' || cat === 'maint' ? 'open' : 'info';
}

// ══ A handover item in another group? ═══════════════════════
// In the HK group (and others) a message is ALSO copied to the book when it reads like a handover item:
// early departure, room move, complaint, maintenance, payment pending, lost & found, VIP, taxi… —
// never a plain room command ("324 CO", "202 LCO 6pm", "0113 EXT 2N", "VD: 402, 518") or chit-chat.
const HO_COPY_MIN = 3;                                   // the score a message needs
const CAT_WEIGHT = { lost: 3, cash: 3, guest: 3, move: 3, pay: 2, res: 2, maint: 2, transport: 2, desk: 2, follow: 1, fb: 1, hk: 0, info: 0 };
// the words of plain room commands and housekeeping status codes (what is left decides)
const CMD_WORDS = /\b(?:rooms?|rm|co|c\/o|lco|l\/c|late|check(?:ed|ing)?[\s-]*(?:out|in)|checkout|chkout|out|left|gone|vacated|departed|ext(?:end(?:ed|ing)?|ension)?|extn|xtnd|stay(?:ing)?|more|nights?|\d+\s*n|till|until|to|at|by|and|all|vd|vc|oc|od|ooo|dnd|ready|clean(?:ed)?|done|ok(?:ay)?|noted|inspected|occupied|vacant|dirty|guest|inside|luggage|in|the|is|are|pls|please|asap|now|soon|mins?|minutes?|hrs?|today|am|pm|noon|[✓✔✅👍])\b|[✓✔✅👍]/gi;
// "I handover to the reception", "handed over the keys to the guest": handing something over, not a shift handover
const HANDED_RX = /\b(?:i|we|he|she|they|will|to|already|just|please|pls|kindly)\s+hand\s*-?\s*(?:over|overed)\b|\bhand\s*-?\s*over(?:ed)?\s+(?:to|it|the|them|him|her|this|that)\b|\bhanded\s+over\b/i;
// the HK group's routine asks: "physical check 301, 304", "any update due out rooms", "403 IP", "on queue"
const ROUTINE_RX = /\b(?:(?:please|pls|kindly)\s+)?(?:do\s+)?check\s+(?:the\s+)?physical(?:ly)?\s+(?:check|status)(?:\s+of)?\b|\bphysical(?:ly)?\s+(?:check(?:ed)?(?:\s*-?\s*out)?|status)(?:\s+of)?\b|\b(?:any\s+)?updat\w*\b|\bd(?:ue|uo)\s*-?\s*out\b|\bd\/o\b|\bip\b|\bon\s+queue\b|\bprepare(?:\s+(?:the\s+room\s+)?for\s+(?:the\s+)?arrival)?\b|\b(?:kindly|see|below|these|those|status|states|for|of|on)\b/gi;
// "522 move to 202", "516 moved to 517 leakage", "407 shifted to 611": a room move, whatever else is said
const MOVE_RX = /\b(?:mov(?:e|ed|ing)|shift(?:ed|ing)?|transfer(?:red)?|swap(?:ped)?)\s+(?:(?:the\s+)?guest\s+)?(?:(?:to|from|in(?:to)?)\s+)?(?:[a-z]+\s+){0,2}?(?:room\s*|rm\s*)?\d{3,4}\b/i;
/** how much a message reads like a handover item → {score, cat, rest} (score ≥ HO_COPY_MIN: copy it) */
function handoverScore(text, opt) {
  opt = opt || {};
  const t = sp(text).trim();
  if (!t || t.length < 6) return { score: 0, cat: 'info', rest: '' };
  if (typeof opt.parse === 'function') { try { const P = opt.parse(t); if (P && P.kind === 'ignore') return { score: 0, cat: 'info', rest: '' }; } catch (_) {} }
  if (/\b(?:hand\s*-?\s*over|h\/o)\b/i.test(t) && t.split(/\s+/).length >= 4 && !HANDED_RX.test(t)) return { score: 9, cat: categorize(t), rest: t };   // "Handover: …"
  const rooms = roomsOf(t);
  const rest = t.replace(/@\S+/g, ' ').replace(ROUTINE_RX, ' ').replace(/\b\d{1,4}(?:[:.]\d{2})?\b/g, ' ').replace(/[\/:,.;!?+()#\-–—]+/g, ' ').replace(CMD_WORDS, ' ').replace(/\s+/g, ' ').trim();
  if ((MOVE_RX.test(t) || categorize(t.replace(/@\S+/g, ' ')) === 'move') && rooms.length) return { score: CAT_WEIGHT.move + 1, cat: 'move', rest };
  const words = rest ? rest.split(' ').filter(w => /[a-z]{2,}/i.test(w)) : [];
  if (words.length < 1 || (words.length < 2 && !rooms.length)) return { score: 0, cat: 'info', rest };
  if (GREET_RX.test(t) || SIGN_RX.test(t)) return { score: 0, cat: 'info', rest };
  const cat = categorize(rest);
  let score = CAT_WEIGHT[cat] || 0;
  if (score && rooms.length) score += 1;
  if (score && OPEN_RX.test(rest.toLowerCase())) score += 1;
  if (cat === 'follow' && !rooms.length) score -= 1;                           // "please check" alone is chat
  return { score, cat, rest };
}
const looksLikeHandover = (text, opt) => handoverScore(text, opt).score >= ((opt && opt.min) || HO_COPY_MIN);

// ══ Rooms and tags ══════════════════════════════════════════
const ROOM_BEFORE = /^(?:aed|dhs?|usd|eur|ext|extension|tel|phone|mob|mobile|conf|confirmation|booking|res|reservation|id|ref|voucher|invoice|inv|folio|pin|code|flight|pax|amount|total|paid|balance|deposit|refund|of|x)$/i;
const ROOM_AFTER = /^\s*(?:aed|dhs?|usd|eur|am\b|pm\b|a\.m|p\.m|hrs?\b|h\b|nights?\b|n\b|pax\b|%|km\b|mins?\b|minutes?\b|k\b|\$|guests\b|people\b|persons\b|adults?\b|kids\b|children\b)/i;
/** room numbers in a handover line, as written ("rm 512", "0113", "512" — not money, times, phone extensions or dates) */
function roomsOf(text) {
  const s = sp(text), out = [], rk = r => String(parseInt(r, 10));
  const add = r => { if (!out.some(x => rk(x) === rk(r))) out.push(r); };
  const re = /(\d{3,4})/g; let m;
  while ((m = re.exec(s))) {
    const n = m[1], i = m.index, before = s.slice(0, i), after = s.slice(i + n.length);
    if (/\d$/.test(before) || /^\d/.test(after)) continue;
    if (/^[A-Za-z0-9._%+-]*@/.test(after) || /@[A-Za-z0-9.-]*$/.test(before)) continue;                  // part of an e-mail address
    if (/[A-Za-z_]$/.test(before) && !/(?:^|[^A-Za-z])(?:r|rm|room|no)$/i.test(before)) continue;         // part of a word ("yasin2087"), not "rm512"
    if (/[\/.:,\-]$/.test(before) && /\d[\/.:,\-]$/.test(before)) continue;            // 20/10/2026, 1,200, 10:30
    if (/^[\/:]\d|^\.\d|^,\d{3}|^-\d/.test(after)) continue;                              // 512/10, 1200.50, 2,500
    const pw = (before.match(/([A-Za-z.#]+)\s*#?\s*$/) || [])[1] || '';
    if (/^(?:room|rm|rm\.|rooms|rms|no|no\.|#)$/i.test(pw)) { add(n); continue; }
    if (ROOM_BEFORE.test(pw.replace(/[.#]+$/, ''))) continue;
    if (ROOM_AFTER.test(after)) continue;
    if (n.length === 4 && /^(?:call|dial|tel|phone)$/i.test(pw)) continue;                   // "call 2245"
    if (n.length === 4 && /^(?:at|till|until|by|before|after|around|lco|co|late|checkout|out)$/i.test(pw) && +n.slice(0, 2) < 24 && +n.slice(2) < 60) continue;   // "at 1800"
    if (n.length === 4 && /^(?:19|20)\d\d$/.test(n) && /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s*$/i.test(before)) continue;   // "Oct 2026"
    add(n);
  }
  return out;
}
const KW_TAGS = [
  [/\bvip\b/i, 'VIP'], [/\bearly dep\w*|\bed\b|\bearly check-?\s?out|\bleaving early|\bcut short|\bshorten\w*/i, 'ED'], [/\bno-?\s?show/i, 'No-show'],
  [/\booo\b|\bout of order/i, 'OOO'], [/\boos\b|\bout of service/i, 'OOS'], [/\bdnd\b|\bdo not disturb/i, 'DND'], [/\btd\b/i, 'TD'],
  [/\brefund/i, 'Refund'], [/\bcity ledger|\bc\/l\b/i, 'City ledger'], [/\bupgrad/i, 'Upgrade'], [/\bdowngrad/i, 'Downgrade'],
  [/\bwake-?\s?up|\bmorning call/i, 'Wake-up'], [/\bbirthday|\banniversary|\bhoneymoon/i, 'Celebration'], [/\beta\b|\blate arrival/i, 'Late arrival'],
  [/\bairport\b/i, 'Airport'], [/\binvoice/i, 'Invoice'], [/\bpassport|\bemirates id|\bid copy/i, 'ID'],
];
/** "18:00" → "6 PM" */
const tLabel = t => { const m = toMin(t); if (m == null) return ''; const h = Math.floor(m / 60), mi = m % 60; return (h % 12 || 12) + (mi ? ':' + pad(mi) : '') + ' ' + (h >= 12 ? 'PM' : 'AM'); };
/** tags for a line: what hoWaParse reads (CO, "LCO 2 PM", "EXT +2N"…) and a few handover words (VIP, ED, TD…) */
function tagsOf(text, parse) {
  const out = [], add = t => { if (t && !out.includes(t)) out.push(t); };
  if (typeof parse === 'function') {
    try {
      (parse(text).actions || []).forEach(a => {
        if ((a.act === 'co' && a.why !== 'early departure') || a.act === 'findone') add('CO');   // an early departure has its own ED tag
        else if (a.act === 'lco') add('LCO' + (a.time ? ' ' + tLabel(a.time) : ''));
        else if (a.act === 'ext') add('EXT' + (a.nights ? ' +' + a.nights + 'N' : a.until ? ' → ' + a.until : ''));
        else if (a.act === 'extending' && /\bext|extend/i.test(text)) add('Extending');
        else if (a.act === 'fin') add('Finance hold');
        else if (a.act === 'maybe') add('May extend');
      });
    } catch (_) {}
  }
  KW_TAGS.forEach(([re, t]) => { if (re.test(sp(text))) add(t); });
  return out;
}

// ══ Splitting a message into items ══════════════════════════
const BULLET_RX = /^\s*(?:[-–—•·*▪►▶➤➢→◦○●▫️✔️✅☑️🔸🔹🔺🔻⭐👉⚠❗‼📌🔴🟠🟡🟢🔵]+\s*|\(?\d{1,2}[.)]\s+|\(?[a-h][)]\s+)/u;
const GREET_RX = /^(?:good\s*(?:morning|afternoon|evening|night|day)|hi+|hello|hey|dear\b|salam|assalam\w*|greetings|morning|evening)\b[\s\w,!.]*$/i;
const SIGN_RX = /^(?:thanks?|thank\s*you|thx|thnx|ty|regards|best regards|kind regards|br|cheers|have a (?:good|nice|great|safe)\b.*|good luck.*|that'?s all.*|end of (?:handover|report).*)[\s!.🙏👍]*$/i;
const TITLE_RX = /\b(?:hand\s*-?\s*over|h\/o)\b/i;
/** a title line ("Handover morning shift 20/10", "H/O night"): no item of its own */
const isTitle = t => t.split(/\s+/).length <= 8 && TITLE_RX.test(t) && !roomsOf(t).length;
/** the text of a handover message to split into items: without its "HO -" mark, but a title line ("Handover morning shift\n- …") is kept whole (splitItems drops it) */
function hoBody(text) {
  const r = hoMark(text); if (!r) return text;
  const L = sp(text).trim().split('\n');
  return r.how === 'prefix' && L.length > 1 && isTitle(L[0].trim()) ? text : r.rest;
}
/** a WhatsApp message → its handover items [{text, head}] (one per line or bullet when the lines are separate items) */
function splitItems(text) {
  const raw = sp(text).replace(/\r/g, '');
  const lines = raw.split('\n').map(l => l.replace(/\s+$/, ''));
  const kept = [];
  let head = '';
  lines.forEach(l => {
    const t = l.trim(); if (!t) return;
    const words = t.split(/\s+/).length;
    const bullet = BULLET_RX.test(t);
    if (!bullet && words <= 7 && (GREET_RX.test(t) || SIGN_RX.test(t))) return;
    if (!bullet && isTitle(t)) { head = ''; return; }   // "Handover morning shift 20/10"
    if (!bullet && /[:：]\s*$/.test(t) && t.length <= 40 && !roomsOf(t).length) { head = t.replace(/[:：]\s*$/, '').replace(/^[*_~]+|[*_~]+$/g, '').trim(); return; }   // "Pending:", "Done:"
    if (!bullet && words <= 3 && lines.filter(x => x.trim()).length > 1 && isChat(t)) return;   // "ok" under a list
    kept.push({ t, bullet, head });
  });
  if (!kept.length) { const one = raw.trim(); return one ? [{ text: one, head: '' }] : []; }
  if (kept.length === 1) return [{ text: kept[0].t.replace(BULLET_RX, '').trim(), head: kept[0].head }];
  const out = [];
  kept.forEach((k, i) => {
    const prev = out[out.length - 1], body = k.t.replace(BULLET_RX, '').trim();
    // a sentence carried on to the next line: no bullet, starts in lower case, the line before did not end a sentence
    const cont = prev && !k.bullet && /^[a-z(&+]/.test(body) && !/[.!?:]$/.test(prev.text) && prev.head === k.head;
    if (cont) prev.text += ' ' + body; else out.push({ text: body, head: k.head });
  });
  return out;
}

// ══ Team chat in a handover group ═══════════════════════════
const CHAT_RX = /^(?:ok+(?:ay)?|k+|kk+|okie|noted|note|thanks?(?: a lot| so much)?|thank\s*you(?: so much| all| team)?|thx|thnx|tnx|ty|tq|welcome|you'?re welcome|np|no problem|no worries|yes|yeah|yep|yup|ya|no|nope|sure|done|received|recieved|got it|copy(?: that)?|roger|alright|all right|fine|great|perfect|good|nice|cool|super|amazing|wow|haha+|lol|on my way|omw|coming|i'?m coming|(?:(?:ok(?:ay)?|sure|yes|noted) )?(?:i )?will (?:do|check|see|update)(?: it| and (?:update|revert|inform))?|ok noted|noted with thanks|well noted|good (?:morning|afternoon|evening|night|day)(?: (?:all|team|guys|everyone))?|morning|hi+|hello|hey|salam|ok thanks?|ok thank you|thank u|tc|take care|bye|see you|see u|inshallah|insha'?allah|mashallah|alhamdulillah|same|me too|agreed|correct|right|true|exactly|ok sure|sure thing|why|what|when|where|who)$/i;
const MEDIA_RX = /^(?:<?\s*(?:media|image|video|audio|sticker|gif|document|contact card|voice (?:message|note))\s+omitted\s*>?|this message was deleted|you deleted this message|null|\(file attached\)|‎?(?:image|photo|video|sticker|gif|audio|voice message)\b.{0,20})$/i;
/** is this line in a handover group just team chat ("ok", "noted 👍", "thanks Sam", "who is on shift?")? Anything with substance — a room,
 *  a number or time, a task word or a handover topic — is not. */
function isChat(text) {
  const raw = sp(text).trim();
  if (!raw) return true;
  if (MEDIA_RX.test(raw)) return true;
  const ls = raw.split('\n').filter(l => l.trim()); if (ls.length > 1) return ls.every(isChat);   // "Thanks Sam\nNoted": chat on every line
  const t = raw.replace(/[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u200d\ufe0f]/gu, ' ').replace(/[.!?,;:~*_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return true;                                                                 // emoji only
  const low = t.toLowerCase(), words = low.split(' ');
  if (/\d/.test(low)) return false;                                                    // rooms, amounts, times
  if (CHAT_RX.test(low)) return true;
  const named = words.length >= 2 && CHAT_RX.test(words.slice(0, -1).join(' ')) && /^[A-Z]/.test(t.split(' ').slice(-1)[0]);   // "thanks Sam", "ok Lina"
  if (named) return true;
  const topic = categorize(low) !== 'info' || OPEN_RX.test(low.replace(/\?/g, ''));
  if (topic) return false;
  if (/\?\s*$/.test(raw)) return true;                                               // a question with no task in it
  return words.length < 3;
}

// ══ Tidy English (rule based, offline) ══════════════════════
// abbreviations (lower case as typed; at the start of a sentence also capitalised)
const ABBR = { pls: 'please', plz: 'please', plez: 'please', plse: 'please', msg: 'message', msgs: 'messages', chk: 'check', chkd: 'checked', tmrw: 'tomorrow', tmr: 'tomorrow', tmrow: 'tomorrow', tom: 'tomorrow',
  u: 'you', ur: 'your', abt: 'about', ppl: 'people', coz: 'because', cuz: 'because', bcz: 'because', bcoz: 'because', b4: 'before', hv: 'have', nite: 'night', thx: 'thanks', thnx: 'thanks', rqst: 'request', reqst: 'request',
  dont: "don't", cant: "can't", wont: "won't", didnt: "didn't", isnt: "isn't", doesnt: "doesn't", wasnt: "wasn't", werent: "weren't", couldnt: "couldn't", shouldnt: "shouldn't", havent: "haven't", hasnt: "hasn't", arent: "aren't",
  im: "I'm", ive: "I've", ill: "I'll", i: 'I', rm: 'room', rms: 'rooms', info: 'info', approx: 'approx.', asap: 'ASAP', tho: 'though', yday: 'yesterday', ystd: 'yesterday' };
// spelling mistakes seen in hotel chats
const TYPO = { recieve: 'receive', recieved: 'received', recived: 'received', reciept: 'receipt', reciepts: 'receipts', guset: 'guest', gust: 'guest', gusets: 'guests', guests: 'guests', gest: 'guest',
  luggae: 'luggage', lugage: 'luggage', laggage: 'luggage', luggege: 'luggage', maintanance: 'maintenance', maintainance: 'maintenance', maintenence: 'maintenance', maintanence: 'maintenance', mantainance: 'maintenance',
  housekeepng: 'housekeeping', houskeeping: 'housekeeping', housekeping: 'housekeeping', housekeepig: 'housekeeping', payement: 'payment', paymnet: 'payment', paymet: 'payment', refnd: 'refund', refound: 'refund',
  balanse: 'balance', balanc: 'balance', reservaton: 'reservation', resevation: 'reservation', reservtion: 'reservation', cancle: 'cancel', cancell: 'cancel', canceld: 'cancelled', adress: 'address', availble: 'available', avilable: 'available',
  tommorow: 'tomorrow', tomorow: 'tomorrow', tommorrow: 'tomorrow', accomodation: 'accommodation', arival: 'arrival', arrivel: 'arrival', depature: 'departure', departue: 'departure', extention: 'extension', invoive: 'invoice', invoce: 'invoice',
  deposite: 'deposit', amout: 'amount', alredy: 'already', allready: 'already', wich: 'which', untill: 'until', informd: 'informed', infromed: 'informed', complian: 'complain', complaine: 'complained', compalint: 'complaint', complient: 'complaint',
  managment: 'management', manger: 'manager', resturant: 'restaurant', restuarant: 'restaurant', breakfest: 'breakfast', brekfast: 'breakfast', breakfat: 'breakfast', airpot: 'airport', aiport: 'airport', tranfer: 'transfer', trasfer: 'transfer',
  passort: 'passport', pasport: 'passport', engeneering: 'engineering', enginering: 'engineering', technitian: 'technician', laundary: 'laundry', londry: 'laundry', towles: 'towels', towell: 'towel', blanket: 'blanket', pillo: 'pillow',
  shoud: 'should', woud: 'would', coud: 'could', becuase: 'because', becasue: 'because', beacuse: 'because', recieving: 'receiving', occured: 'occurred', seperate: 'separate', definately: 'definitely', calender: 'calendar', remainder: 'reminder', remaining: 'remaining' };
// short forms written in capitals
const UP = { ac: 'AC', td: 'TD', vip: 'VIP', dnd: 'DND', hk: 'HK', ooo: 'OOO', oos: 'OOS', eta: 'ETA', etd: 'ETD', cc: 'CC', vcc: 'VCC', ota: 'OTA', id: 'ID', pos: 'POS', aed: 'AED', dhs: 'AED', usd: 'USD', cl: 'CL', fo: 'FO', mur: 'MUR', rc: 'RC', gm: 'GM', dm: 'DM', fom: 'FOM', am: 'AM', pm: 'PM', tv: 'TV', ed: 'ED', bf: 'BF', ird: 'IRD', pdf: 'PDF', mod: 'MOD' };
// the hotel's codes spelled out (lower case or capitals as typed — "Co" stays: it can be a company)
const EXPAND = { co: 'check-out', lco: 'late check-out', ci: 'check-in', eci: 'early check-in', ext: 'extension', ns: 'no-show', twc: 'twin', twn: 'twin', dbl: 'double', sgl: 'single' };
const PHRASES = [
  [/\bearly\s*dep(?:art(?:ure|ing|ed)?|\.)?(?=[\s.,;:!?)]|$)/gi, 'early departure'],
  [/\blate\s*c\/o\b|\blate\s*check\s*-?\s*out\b/gi, 'late check-out'], [/\bearly\s*check\s*-?\s*in\b/gi, 'early check-in'],
  [/\bcheckout\b/gi, 'check-out'], [/\bcheckin\b/gi, 'check-in'], [/\bno\s*-?\s*show\b/gi, 'no-show'], [/\bwake\s*-?\s*up\s*call/gi, 'wake-up call'],
  [/\bwalk\s*-?\s*in\b/gi, 'walk-in'], [/\bwi\s*-?\s*fi\b/gi, 'Wi-Fi'], [/\bf\/u\b/gi, 'follow-up'], [/\bw\/o\b/gi, 'without'], [/\bw\/(?=\s|$)/gi, 'with'], [/\bw\/(?=[a-z])/gi, 'with '],
  [/\bc\/o\b/gi, 'check-out'], [/\ba\/c\b/gi, 'AC'], [/\bb\/f\b/gi, 'breakfast'], [/\bc\/l\b/gi, 'city ledger'], [/\bn\/a\b/gi, 'N/A'], [/\bl\s*&\s*f\b/gi, 'lost & found'], [/\bf\s?&\s?b\b/gi, 'F&B'],
];
const ARTICLE_ADJ = /^(?:bad|strong|small|big|huge|minor|major|broken|new|loud|long|short|high|low|special|urgent|wet|dirty|damaged|serious|weird|strange|funny|terrible|horrible|bad|leaking|noisy|old|late|early|good|nice|great|quick|slow)$/i;
const UNCOUNT = /^(?:luggage|baggage|water|money|cash|balance|payment|information|info|feedback|furniture|equipment|breakfast|lunch|dinner|laundry|power|electricity|internet|wifi|damage|noise|traffic|access|time|news|advice|food|parking|housekeeping|maintenance|pressure)$/i;
const FUNC_W = /^(?:to|and|or|in|on|at|for|with|from|of|by|the|a|an|no|not|is|are|was|be|been|it|this|that|his|her|their|my|our|your|its|some|any)$/i;
const LABEL_W = /^(?:early|late|extension|extended|check-out|check-in|balance|payment|refund|deposit|complaint|ac|maintenance|vip|ed|td|booking|amend|amendment|cancel|cancelled|cancellation|upgrade|upgraded|downgrade|no-show|dnd|ooo|oos|lost|taxi|airport|pickup|pick-up|wake-up|breakfast|laundry|invoice|keys?|parking|leak|leaking|smell|noise|city|ota|walk-in|transfer|police|passport|visitor|extra|baby|twin|king|double|move|moved|shift|shifted|group|eta|deposit|follow-up|pending|n\/a|no|urgent|guest|guests|refund|vip)$/i;
const AN = w => (/^(?:[aeio]|u(?!n[iy]|s[eu]))/i.test(w) || /^(?:hour|honest)/i.test(w) ? 'an' : 'a');
const capFirst = w => w.charAt(0).toUpperCase() + w.slice(1);
/** clean, professional English, rule based: "room 512 have bad smell" → "Room 512 has a bad smell."
 *  Numbers, times and names are never changed (only spacing, am/pm in capitals). */
function tidy(input) {
  let s = sp(input).replace(/\s+/g, ' ').trim().replace(BULLET_RX, '').trim();
  if (!s) return '';
  const keep = [];
  const protect = re => { s = s.replace(re, m => '\u0001' + (keep.push(m) - 1) + '\u0002'); };
  protect(/\bhttps?:\/\/\S+|\b[\w.+-]+@[\w-]+\.[\w.-]+\b|\+?\d[\d\s-]{8,}\d/g);   // links, e-mails, phone numbers
  PHRASES.forEach(([re, rep]) => { s = s.replace(re, rep); });
  // times: "3pm" / "3 pm" / "3.30p.m." → "3 PM" / "3.30 PM"
  s = s.replace(/\b(\d{1,2}(?:[:.]\d{2})?)\s*([ap])\.?\s*m\b\.?/gi, (m, t, a) => t + ' ' + a.toUpperCase() + 'M');
  // a number stuck to a word: "2beds" → "2 beds" (not 1st, 2N, 5kg)
  s = s.replace(/\b(\d+)([A-Za-z]{2,})\b/g, (m, d, w) => (/^(?:st|nd|rd|th|kg|km|ml|am|pm|hrs|AM|PM)$/i.test(w) ? m : d + ' ' + w));
  // "room 512", "rm 512", "rm#512", "room no 512" → "Room 512"
  s = s.replace(/\b(?:room|rm)\.?\s*(?:no\.?|number|#)?\s*#?\s*(\d{3,4})\b/gi, 'Room $1');
  // words
  const atStart = i => i === 0 || /[.!?]\s*$/.test(s.slice(0, i)) || /^\s*(?:\u0001\d+\u0002\s*)?$/.test(s.slice(0, i));
  s = s.replace(/[A-Za-z][A-Za-z']*/g, (t, i) => {
    const low = t.toLowerCase(), isLow = t === low, isUp = t.length > 1 && t === t.toUpperCase(), isCap = !isLow && !isUp && t === capFirst(low);
    const start = atStart(i), keepCase = r => (isCap ? capFirst(r) : r);
    if (low === 'ext' && /^\.?\s*\d{4,}/.test(s.slice(i + t.length))) return t;                     // a phone extension
    if (EXPAND[low] && (isLow || isUp)) return EXPAND[low];
    if (UP[low] && isLow && !(low === 'am' || low === 'pm' || low === 'id' && !/\b(?:guest|copy|card|scan)/i.test(s))) return UP[low];
    if (UP[low] && (low === 'am' || low === 'pm') && isLow && /\d\s*$/.test(s.slice(0, i))) return UP[low];
    if (low === 'i' && isLow) return 'I';
    if (ABBR[low] !== undefined && (isLow || ((isCap || isUp) && start && low.length >= 3))) return isLow ? ABBR[low] : capFirst(ABBR[low]);
    if (TYPO[low] && (isLow || isUp || (isCap && start))) return keepCase(TYPO[low]);
    return t;
  });
  // one room / guest / he / she → has, needs, wants, doesn't, is
  const VERB = { have: 'has', need: 'needs', want: 'wants', "don't": "doesn't", dont: "doesn't", 'do not': 'does not', are: 'is', were: 'was' };
  s = s.replace(/(\bRoom \d{3,4}|\b(?:[Tt]he |[Tt]his |[Tt]hat )?(?:guest|lady|gentleman|man|woman|room|client|customer|company|manager)|\b(?:[Hh]e|[Ss]he|[Ii]t))\s+(have|need|want|don't|dont|do not|are|were)\b/g, (m, subj, v, i) => {
    const pre = s.slice(0, i);
    if (/(?:\band|&|\bor)\s*$/i.test(pre) || /\d\s*,\s*$/.test(pre)) return m;                  // "511 and Room 512 have"
    if (/\b(?:did|does|do|will|would|can|could|should|must|may|might|let|make|makes|to|not|doesn't|didn't|won't|can't)\s+$/i.test(pre)) return m;
    if (/^(?:[Tt]he |[Tt]his |[Tt]hat )?(?:guest|room|client|customer)$/.test(subj) && /s$/.test(subj)) return m;
    return subj + ' ' + VERB[v.toLowerCase()];
  });
  // "has bad smell" → "has a bad smell" (only has/have/had + a common adjective + one thing)
  s = s.replace(/\b(has|have|had)\s+([A-Za-z]+)\s+([a-z]+)\b/g, (m, v, adj, noun) => {
    if (!ARTICLE_ADJ.test(adj) || FUNC_W.test(noun) || UNCOUNT.test(noun) || (/s$/.test(noun) && !/ss$/.test(noun)) || ARTICLE_ADJ.test(noun)) return m;
    return v + ' ' + AN(adj) + ' ' + adj + ' ' + noun;
  });
  // "Room 512 Early departure" / "512 - balance" → "Room 512: early departure" (a room and what it is about)
  const lead = s.match(/^(\d{3,4})\b(?!\s*(?:[:.,\/]\d|AM|PM|aed|AED|dhs|nights?|pax|%|guests\b|people))/);
  if (lead && roomsOf(s.slice(0, 12)).includes(lead[1])) s = 'Room ' + s;
  s = s.replace(/^Room (\d{3,4})\s*(?:([-–—:,])\s*)?([A-Za-z][\w'\/-]*)/, (m, n, sep, w) => {
    if (!sep && !LABEL_W.test(w)) return m;
    if (sep && /^(?:is|has|was|will|needs?|wants?|have|are|guest)$/i.test(w) && sep === ',') return m;
    const word = LABEL_W.test(w) && !(w.length > 1 && w === w.toUpperCase()) ? w.toLowerCase() : w;
    return 'Room ' + n + ': ' + word;
  });
  // spacing and punctuation
  s = s.replace(/\s+([,.;:!?)])/g, '$1').replace(/([(])\s+/g, '$1')
    .replace(/([,;])(?=[A-Za-z])/g, '$1 ').replace(/([!?])\1+/g, '$1').replace(/\.{2,}/g, '.').replace(/,{2,}/g, ',').replace(/([.!?])(?=[A-Z][a-z])/g, '$1 ')
    .replace(/:(?=[A-Za-z])/g, ': ').replace(/\s{2,}/g, ' ').trim();
  // capitals: the first letter and after a full stop
  s = s.replace(/^([^A-Za-z0-9\u0001]*)([a-z])/, (m, p, c) => p + c.toUpperCase()).replace(/([.!?]\s+)([a-z])/g, (m, p, c) => p + c.toUpperCase());
  if (/[A-Za-z0-9)\]"'%\u0002]$/.test(s)) s += '.';
  s = s.replace(/\u0001(\d+)\u0002/g, (m, k) => keep[+k]);
  return s;
}

// ══ Items ═══════════════════════════════════════════════════
/** a WhatsApp message (or a line typed here) → its items
 *  msg: {base, mid?, date, time, sender, group, text, at?, src?} · opt.parse: hoWaParse */
function buildItems(msg, opt) {
  opt = opt || {};
  const parts = splitItems(hoBody(msg.text)), n = parts.length, base = msg.base || ('p' + hash((msg.date || '') + '|' + (msg.time || '') + '|' + (msg.sender || '') + '|' + msg.text));
  return parts.map((p, i) => {
    const cat = categorize(p.text, p.head), it = {
      key: n > 1 ? base + '_' + (i + 1) : base, msg: base, at: msg.at || 0, date: msg.date || '', time: msg.time || '', shift: shiftOf(msg.time),
      sender: msg.sender || '', group: msg.group || '', orig: p.text, text: tidy(p.text), cat, rooms: roomsOf(p.text), tags: tagsOf(p.text, opt.parse),
      status: statusOf(p.text, cat, p.head), doneBy: '', doneAt: 0, note: '', mid: msg.mid || '', src: msg.src || 'wa',
    };
    if (p.head) it.head = p.head;
    if (opt.ho && !hoMark(msg.text) && isChat(p.text)) it.chat = 1;               // team chat in the handover group: kept aside
    if (n > 1) { it.part = i + 1; it.parts = n; it.full = sp(msg.text).slice(0, 3000); }
    return it;
  });
}
// ══ Paste anything ══════════════════════════════════════════
const t24of = t => { const m = sp(t).toLowerCase().match(/(\d{1,2})[:.](\d{2})(?:[:.]\d{2})?\s*([ap])?/); if (!m) return ''; let h = +m[1]; if (m[3] === 'p' && h < 12) h += 12; if (m[3] === 'a' && h === 12) h = 0; return h > 23 ? '' : pad(h) + ':' + m[2]; };
const isoOf = d => { const p = sp(d).trim().split(/[\/.\-]/).map(x => parseInt(x, 10)); if (p.length !== 3 || p.some(isNaN)) return ''; let [a, b, c] = p; if (a > 31) return `${a}-${pad(b)}-${pad(c)}`; if (c < 100) c += 2000; if (b > 12 && a <= 12) { const x = a; a = b; b = x; } return b >= 1 && b <= 12 && a >= 1 && a <= 31 ? `${c}-${pad(b)}-${pad(a)}` : ''; };
const OPERA_STAMP = /^\s*(\d{1,2}[-\/.](?:[A-Za-z]{3}|\d{1,2})[-\/.]\d{2,4})\s+(\d{1,2}:\d{2}(?:\s*[AaPp][Mm])?)?\s*(?:[A-Z][A-Z0-9_.]{2,15}\s+)?/;
/** any pasted text → handover lines [{text, head, sender, time, date, chat}]:
 *  a copied WhatsApp chat ("[1:07 PM, 20/10/2026] Sam: text", via opt.parseCopied), an e-mail (quotes, headers and signature dropped),
 *  Opera trace notes ("20-OCT-26 14:05 JDOE Guest wants…") or a typed list. */
function pasteItems(text, opt) {
  opt = opt || {};
  const out = [], push = (lines, base) => splitItems(lines).forEach(p => out.push(Object.assign({ text: p.text, head: p.head, sender: '', time: '', date: '' }, base, { chat: isChat(p.text) })));
  const raw = sp(text).replace(/\r/g, '');
  let msgs = [];
  if (typeof opt.parseCopied === 'function') { try { msgs = opt.parseCopied(raw) || []; } catch (_) { msgs = []; } }
  if (msgs.length) {
    msgs.forEach(m => { const body = hoBody(m.text); if (!sp(body).trim()) return; push(body, { sender: sp(m.sender).trim(), time: t24of(m.time), date: m.iso || isoOf(m.date), marked: !!hoMark(m.text) }); });
    return out;
  }
  // an e-mail: no quoted reply, no headers, nothing after the signature
  const L = [];
  for (const line of raw.split('\n')) {
    if (/^\s*(?:--\s*|_{5,}|sent from my\b.*|get outlook\b.*|on .{4,80} wrote:)\s*$/i.test(line)) break;
    if (/^\s*>/.test(line) || /^\s*(?:from|sent|to|cc|bcc|subject|date|importance)\s*:/i.test(line)) continue;
    L.push(line);
  }
  // Opera trace notes: each stamped line is one item, its stamp gives the time
  const stamped = L.filter(l => { const m = l.match(OPERA_STAMP); return m && /\d/.test(m[0]); });
  if (stamped.length >= 1 && stamped.length >= L.filter(l => l.trim()).length / 2) {
    let cur = null; const recs = [];
    L.forEach(l => { const m = l.match(OPERA_STAMP); if (m && /\d/.test(m[0])) { cur = { time: m[2] ? t24of(m[2]) : '', date: isoOf(m[1]), text: l.slice(m[0].length).trim() }; recs.push(cur); } else if (cur && l.trim()) cur.text += ' ' + l.trim(); });
    recs.forEach(r => { if (r.text) out.push({ text: r.text, head: '', sender: '', time: r.time, date: '', chat: isChat(r.text) }); });
    return out;
  }
  push(L.join('\n'), {});
  return out;
}
// ══ Suggestions from HotelOps' own data (nothing is added until ticked) ══
/** {rooms: depRooms, hk: [open HK requests], mt: {id: ticket}, lf: {id: item}, now: Date} → [{text, cat, src}] */
function suggestFrom(d) {
  d = d || {}; const out = [], add = (text, cat, src) => { if (text && !out.some(o => o.text === text)) out.push({ text, cat, src }); };
  const now = d.now || new Date(), nm = now.getHours() * 60 + now.getMinutes();
  (d.rooms || []).forEach(r => {
    if (!r || !r.roomStr) return; const R = 'Room ' + r.roomStr, nm2 = r.name ? ' (' + sp(r.name).trim() + ')' : '';
    if (r.status === 'out' || r.status === 'extended') return;
    if (r.intent === 'finance_hold') add(`${R}${nm2}: guest left — waiting for ${r.finWho || 'Finance'} before check-out.`, 'pay', 'Departures');
    else if (r.intent === 'extending') add(`${R}${nm2}: extending — paperwork still to finish (booking, RC, TD, payment).`, 'res', 'Departures');
    else if (r.intent === 'maybe_extend') add(`${R}${nm2}: may extend — confirm with the guest.`, 'res', 'Departures');
    if (r.status === 'late' && r.lateTime) add(`${R}${nm2}: late check-out until ${tLabel(t24of(r.lateTime)) || r.lateTime}${toMin(t24of(r.lateTime)) != null && toMin(t24of(r.lateTime)) < nm ? ' — time has passed' : ''}.`, 'res', 'Departures');
    if (r.status === 'na') add(`${R}${nm2}: no answer — still to check out.`, 'desk', 'Departures');
    if (r.note && sp(r.note).trim()) add(`${R}: ${sp(r.note).split('\n').filter(l => l.trim() && !/^WhatsApp · /.test(l)).slice(-2).join(' · ') || sp(r.note).split('\n').slice(-1)[0]}`.replace(/:\s*$/, ''), 'follow', 'Departures note');
  });
  (d.hk || []).forEach(i => { if (i && i.room) add(`Room ${i.room}: ${i.what || 'HK request'} still open (asked by ${i.s || 'HK'}${i.t ? ' at ' + t12(i.t) : ''}).`, 'hk', 'HK Requests'); });
  Object.keys(d.mt || {}).forEach(k => { const t = d.mt[k]; if (t && t.problem && t.status !== 'fixed' && t.status !== 'closed') add(`${t.area ? (/^\d{3,4}$/.test(String(t.area)) ? 'Room ' + t.area : t.area) + ': ' : ''}${t.problem} — maintenance ticket open${t.prio && t.prio !== 'normal' ? ' (' + t.prio + ')' : ''}.`, 'maint', 'Front Office Log'); });
  Object.keys(d.lf || {}).forEach(k => { const t = d.lf[k]; if (t && t.what && t.status === 'found' && (!t.at || (now - t.at) < 3 * 864e5)) add(`Lost & found: ${t.what}${t.room ? ' from Room ' + t.room : t.where ? ' (' + t.where + ')' : ''}${t.storage ? ' — kept in ' + t.storage : ''}.`, 'lost', 'Front Office Log'); });
  return out;
}
/** the items a filter shows. f: {shift, cat, st:'all'|'open'|'done', sender, room, q} */
function filterItems(items, f) {
  f = f || {};
  const q = sp(f.q || '').toLowerCase().trim(), room = String(f.room || '').trim(), rk = r => String(parseInt(r, 10));
  return (items || []).filter(i => i && !i.del && !i.chat
    && (!f.src || f.src === 'all' || (f.src === 'auto' ? i.src === 'copy' : i.src !== 'copy'))
    && (!f.group || (f.group === '—' ? !i.group : i.group === f.group))
    && (!f.shift || f.shift === 'all' || i.shift === f.shift)
    && (!f.cat || i.cat === f.cat)
    && (!f.st || f.st === 'all' || i.status === f.st)
    && (!f.sender || i.sender === f.sender)
    && (!room || (i.rooms || []).some(r => rk(r) === rk(room) || String(r).indexOf(room) === 0))
    && (!q || q.split(/\s+/).every(w => [i.text, i.orig, i.note, i.sender, (i.rooms || []).join(' '), (i.tags || []).join(' '), (CAT[i.cat] || {}).label].join(' ').toLowerCase().includes(w))));
}
const byTime = (a, b) => String(a.date || '').localeCompare(String(b.date || '')) || (shiftRank(a) - shiftRank(b)) || (toMin(a.time) || 0) - (toMin(b.time) || 0) || (a.at || 0) - (b.at || 0) || (a.part || 0) - (b.part || 0);
/** the order of a day: Night after midnight first, then Morning, Afternoon, Night */
function shiftRank(i) { const m = toMin(i.time); if (m == null) return 9; return m < 7 * 60 ? 0 : m < 15 * 60 ? 1 : m < 23 * 60 ? 2 : 3; }
/** a summary of items: {items, open, done, info, rooms, byCat, byShift} */
function summaryOf(items) {
  const L = (items || []).filter(i => i && !i.del && !i.chat), rooms = new Set(), byCat = {}, byShift = {};
  L.forEach(i => { (i.rooms || []).forEach(r => rooms.add(String(parseInt(r, 10)))); byCat[i.cat] = (byCat[i.cat] || 0) + 1; byShift[i.shift || '—'] = (byShift[i.shift || '—'] || 0) + 1; });
  return { items: L.length, open: L.filter(i => i.status === 'open').length, done: L.filter(i => i.status === 'done').length, info: L.filter(i => i.status === 'info').length, rooms: rooms.size, byCat, byShift };
}
const ST_LBL = { open: 'Pending', done: 'Done', info: 'Info' };
const URGENT_RX = /\burgent\w*|\basap\b|\bimmediately\b|\bemergency\b|\bvip\b|\bcomplain\w*|\bpolice\b|\bangry\b|\bescalat\w*|\bsecurity\b|\bfire\b|\bflood\w*|\binjur\w*|\bambulance|\bdoctor\b|\bsick\b|\btheft|\bstolen\b/i;
/** needs attention first (urgent / ASAP / VIP / complaint / police…) — only while it is not done */
const isUrgent = i => !!i && i.status !== 'done' && (URGENT_RX.test(sp([i.orig, i.text, i.head, (i.tags || []).join(' ')].join(' '))) || i.cat === 'guest' && /complain/i.test(sp(i.orig)));
/** a short written summary: "12 items · 3 open (1 urgent). Still to do: Room 512 early departure; …" */
function writtenSummary(items, opt) {
  opt = opt || {};
  const L = (items || []).filter(i => i && !i.del && !i.chat), S = summaryOf(L), open = L.filter(i => i.status === 'open').sort((a, b) => (isUrgent(b) - isUrgent(a)) || byTime(a, b));
  if (!L.length) return 'No handover items yet.';
  const u = open.filter(isUrgent).length, max = opt.max || 4;
  let s = `${S.items} item${S.items === 1 ? '' : 's'}`;
  s += open.length ? ` · ${open.length} pending${u ? ` (${u} urgent)` : ''}` : ' · nothing pending';
  if (S.done) s += ` · ${S.done} done`;
  s += '.';
  if (open.length) {
    const what = open.slice(0, max).map(i => String(i.text || i.orig || '').replace(/[.!]+$/, '')).map(t => (t.length > 70 ? t.slice(0, 68).replace(/\s+\S*$/, '') + '…' : t));
    s += (' Still to do: ' + what.join('; ') + (open.length > max ? `; and ${open.length - max} more` : '') + '.').replace(/…\.$/, '…');
  } else s += ' A clean handover.';
  return s;
}
const hhmmOf = ms => { if (!ms) return ''; const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const dmy = d => String(d || '').split('-').reverse().join('/');
/** the Excel rows (first row: the headings). opt.orig: add the "Original" column */
function excelRows(items, opt) {
  opt = opt || {};
  const head = ['Date', 'Shift', 'Time', 'From', 'Category', 'Rooms', 'Item', 'Status', 'Done by', 'Note'].concat(opt.orig ? ['Original'] : []);
  return [head].concat((items || []).filter(i => i && !i.del && !i.chat).slice().sort(byTime).map(i => [
    dmy(i.date), i.shift || '', t12(i.time), i.sender || '', (CAT[i.cat] || CAT.info).label, (i.rooms || []).join(', '),
    (i.head ? i.head + ': ' : '') + (i.text || i.orig || '') + ((i.tags || []).length ? ' [' + i.tags.join(', ') + ']' : ''),
    ST_LBL[i.status] || 'Info', i.status === 'done' ? [i.doneBy, t12(hhmmOf(i.doneAt))].filter(Boolean).join(' · ') : '', i.note || '',
  ].concat(opt.orig ? [i.orig || ''] : [])));
}
/** the "Summary" sheet: {rows, bold: [row numbers, 1-based]} */
function summaryRows(items, date, hotel) {
  const S = summaryOf(items), rows = [], bold = [];
  const B = r => { rows.push(r); bold.push(rows.length); };
  B(['Shift handover – ' + dLong(date) + (hotel ? ' – ' + hotel : '')]);
  rows.push(['Items', S.items], ['Pending', S.open], ['Done', S.done], ['Info', S.info], ['Rooms mentioned', S.rooms], []);
  B(['By category', 'Items', 'Pending']);
  CATS.forEach(c => { if (S.byCat[c[0]]) rows.push([c[1], S.byCat[c[0]], (items || []).filter(i => !i.del && !i.chat && i.cat === c[0] && i.status === 'open').length]); });
  rows.push([]);
  B(['By shift', 'Items', 'Pending']);
  SHIFT_BOUNDS.forEach(s => { if (S.byShift[s.id]) rows.push([s.id, S.byShift[s.id], (items || []).filter(i => !i.del && !i.chat && i.shift === s.id && i.status === 'open').length]); });
  rows.push([]);
  const open = (items || []).filter(i => i && !i.del && !i.chat && i.status === 'open').sort(byTime);
  B(['Pending items', 'Time', 'Rooms', 'Item', 'From']);
  open.forEach(i => rows.push([(CAT[i.cat] || CAT.info).label, t12(i.time), (i.rooms || []).join(', '), i.text || i.orig, i.sender || '']));
  if (!open.length) rows.push(['Nothing pending — a clean handover.']);
  return { rows, bold };
}
const COL_W = [12, 11, 9, 16, 20, 12, 70, 9, 18, 34, 60];
/** "Handover - Ibis Styles - 20 Oct 2026.xlsx" */
function fileName(hotel, date) {
  const h = sp(hotel).replace(/[\\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return 'Handover - ' + (h ? h + ' - ' : '') + dLong(date) + '.xlsx';
}
// ── the .xlsx made by SheetJS (community build) has no styles or frozen panes: added to its XML ──
/** styles.xml + a bold header style (with a light fill) and a wrapped-text style → {xml, head, wrap} (cellXfs indexes) */
function polishStyles(xml) {
  let x = String(xml), head = -1, wrap = -1;
  const fm = x.match(/<fonts count="(\d+)">/), fl = x.match(/<fills count="(\d+)">/), xf = x.match(/<cellXfs count="(\d+)">/);
  if (!fm || !fl || !xf) return { xml: x, head, wrap };
  const fontId = +fm[1], fillId = +fl[1];
  x = x.replace(/<fonts count="\d+">([\s\S]*?)<\/fonts>/, (m, inner) => `<fonts count="${fontId + 1}">${inner}<font><b/><sz val="12"/><color rgb="FF1F2937"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font></fonts>`);
  x = x.replace(/<fills count="\d+">([\s\S]*?)<\/fills>/, (m, inner) => `<fills count="${fillId + 1}">${inner}<fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF6"/><bgColor indexed="64"/></patternFill></fill></fills>`);
  const n = +xf[1]; head = n; wrap = n + 1;
  x = x.replace(/<cellXfs count="\d+">([\s\S]*?)<\/cellXfs>/, (m, inner) => `<cellXfs count="${n + 2}">${inner}<xf numFmtId="0" fontId="${fontId}" fillId="${fillId}" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs>`);
  return { xml: x, head, wrap };
}
/** a sheet's XML: bold rows, wrapped columns, the first row frozen. opt: {head, wrap, boldRows:[1], wrapCols:['G'], freeze:true} */
function polishSheet(xml, opt) {
  let x = String(xml); opt = opt || {};
  const setS = (cell, s) => (/\ss="\d+"/.test(cell) ? cell.replace(/\ss="\d+"/, ' s="' + s + '"') : cell.replace(/^<c /, '<c s="' + s + '" '));
  x = x.replace(/<c r="([A-Z]+)(\d+)"[^>]*?(?=\/?>)/g, (cell, col, row) => {
    if (opt.head >= 0 && (opt.boldRows || []).includes(+row)) return setS(cell, opt.head);
    if (opt.wrap >= 0 && +row > 1 && (opt.wrapCols || []).includes(col)) return setS(cell, opt.wrap);
    return cell;
  });
  if (opt.freeze) x = x.replace(/<sheetView ([^>]*?)\/>/, '<sheetView $1><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView>');
  return x;
}

// ══ The pro Excel report (ExcelJS) — the model and its styles are pure ══
/** colours (ARGB) of the report */
const XL = { ink: 'FF0F172A', slate: 'FF1E293B', sub: 'FF64748B', line: 'FFE2E8F0', zebra: 'FFF8FAFC', band: 'FFEEF2F7', white: 'FFFFFFFF', red: 'FFB91C1C', redFill: 'FFFEE2E2', accent: 'FFC2410C' };
const XL_STATUS = { open: { fill: 'FFFEF3C7', font: 'FF92400E', label: 'Pending' }, done: { fill: 'FFD1FAE5', font: 'FF065F46', label: 'Done' }, info: { fill: 'FFF1F5F9', font: 'FF475569', label: 'Info' } };
const XL_CAT = { guest: ['FFFCE7F3', 'FF9D174D'], pay: ['FFDCFCE7', 'FF166534'], res: ['FFDBEAFE', 'FF1E40AF'], move: ['FFEDE9FE', 'FF5B21B6'], maint: ['FFFFEDD5', 'FF9A3412'], hk: ['FFCCFBF1', 'FF115E59'],
  transport: ['FFFEF9C3', 'FF854D0E'], lost: ['FFFAE8FF', 'FF86198F'], desk: ['FFE0F2FE', 'FF075985'], fb: ['FFFFE4E6', 'FF9F1239'], follow: ['FFFEF3C7', 'FF92400E'], cash: ['FFECFCCB', 'FF3F6212'], info: ['FFF1F5F9', 'FF475569'] };
/** the Status cell's colours: Open amber, Done green, Info grey */
const statusStyle = st => XL_STATUS[st] || XL_STATUS.info;
/** the Category cell's soft colours */
const catStyle = c => { const x = XL_CAT[c] || XL_CAT.info; return { fill: x[0], font: x[1] }; };
/** "#c2410c" / "#fa0" / "rgb(194, 65, 12)" → "FFC2410C" ('' when it cannot be read) */
function argbOf(css) {
  const s = sp(css).trim().toLowerCase(); let m;
  if ((m = s.match(/^#([0-9a-f]{3})$/))) return 'FF' + m[1].split('').map(c => c + c).join('').toUpperCase();
  if ((m = s.match(/^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/))) return 'FF' + m[1].toUpperCase();
  if ((m = s.match(/^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/))) return 'FF' + [m[1], m[2], m[3]].map(x => Math.min(255, +x).toString(16).padStart(2, '0')).join('').toUpperCase();
  return '';
}
/** a row height (points) that shows wrapped text: texts[i] in a column of widths[i] characters */
function rowHeight(texts, widths, base) {
  let lines = 1;
  (texts || []).forEach((t, i) => { const w = Math.max(4, (widths[i] || 10) - 2); String(t == null ? '' : t).split('\n').forEach((p, j) => { const n = Math.max(1, Math.ceil(p.length / w)); if (j === 0) lines = Math.max(lines, n); else lines = Math.max(lines, n + j); }); });
  return Math.max(base || 20, Math.round(lines * 15 + 6));
}
/** "Morning, Afternoon" — the shifts the items cover */
const shiftsCovered = items => SHIFT_BOUNDS.map(s => s.id).filter(id => (items || []).some(i => i && !i.del && !i.chat && i.shift === id)).join(', ');
/** an item's shift section on its day → {k, label}: the Night after midnight is last night ("Night 19–20 Oct"), kept apart from tonight's ("Night 20–21 Oct") */
function sectionOf(i) {
  const id = (i && i.shift) || '', m = toMin(i && i.time);
  if (id !== 'Night' || !/^\d{4}-\d{2}-\d{2}$/.test(i.date || '')) return { k: id, label: id || 'No time' };
  const a = m != null && m < 12 * 60 ? dayAdd(i.date, -1) : i.date, A = a.split('-'), B = dayAdd(a, 1).split('-');
  return { k: a === i.date ? 'Night' : 'Night0', label: 'Night ' + +A[2] + (A[1] !== B[1] ? ' ' + MON[+A[1] - 1] : '') + '–' + +B[2] + ' ' + MON[+B[1] - 1] };
}
/** the sections of a day in order: last night, Morning, Afternoon, tonight */
const SECTION_ORDER = ['Night0', 'Morning', 'Afternoon', 'Night', ''];
const XL_COLS = [['Date', 11], ['Shift', 11], ['Time', 9], ['From', 16], ['Category', 20], ['Rooms', 10], ['Item', 60], ['Status', 10], ['Done by', 18], ['Note', 30], ['Original', 44]];
/** everything the report shows, ready to draw. opt: {hotel, date, user, exportedAt (ms), orig} */
function reportModel(items, opt) {
  opt = opt || {};
  const L = (items || []).filter(i => i && !i.del && !i.chat).slice().sort(byTime), S = summaryOf(L), urgent = L.filter(isUrgent).length;
  const cols = XL_COLS.slice(0, opt.orig ? 11 : 10);
  const at = opt.exportedAt ? new Date(opt.exportedAt) : null;
  const exported = at ? `${at.getDate()} ${MON[at.getMonth()]} ${at.getFullYear()}, ${pad(at.getHours())}:${pad(at.getMinutes())}` : '';
  const day = opt.date ? new Date(opt.date + 'T12:00:00') : null;
  const longD = day ? `${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day.getDay()]} ${day.getDate()} ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][day.getMonth()]} ${day.getFullYear()}` : '';
  const row = i => ({
    cells: [dmy(i.date), i.shift || '', t12(i.time), i.sender || '', (CAT[i.cat] || CAT.info).label, (i.rooms || []).join(', '),
      (i.head ? i.head + ': ' : '') + (i.text || i.orig || '') + ((i.tags || []).length ? '  [' + i.tags.join(', ') + ']' : ''),
      statusStyle(i.status).label, i.status === 'done' ? [i.doneBy, t12(hhmmOf(i.doneAt))].filter(Boolean).join(' · ') : '', i.note || ''].concat(opt.orig ? [i.orig || ''] : []),
    status: i.status || 'info', cat: i.cat || 'info', urgent: isUrgent(i), done: i.status === 'done',
  });
  const inSec = k => L.filter(i => sectionOf(i).k === k);
  const sections = SECTION_ORDER.map(id => { const R = inSec(id); return R.length ? { id, label: sectionOf(R[0]).label, hours: hoursOf(R), count: R.length, open: R.filter(i => i.status === 'open').length, rows: R.map(row) } : null; }).filter(Boolean);
  const byCat = CATS.filter(c => S.byCat[c[0]]).map(c => { const R = L.filter(i => i.cat === c[0]); return { cat: c[0], label: c[1], items: R.length, open: R.filter(i => i.status === 'open').length, done: R.filter(i => i.status === 'done').length }; });
  const byShift = SECTION_ORDER.filter(id => inSec(id).length).map(id => { const R = inSec(id); return { label: sectionOf(R[0]).label, items: R.length, open: R.filter(i => i.status === 'open').length, done: R.filter(i => i.status === 'done').length }; });
  const open = L.filter(i => i.status === 'open').sort((a, b) => (isUrgent(b) - isUrgent(a)) || byTime(a, b))
    .map(i => ({ cells: [(CAT[i.cat] || CAT.info).label, t12(i.time), (i.rooms || []).join(', '), i.text || i.orig || '', i.sender || ''], cat: i.cat || 'info', urgent: isUrgent(i) }));
  return {
    title: (opt.hotel ? opt.hotel + ' — ' : '') + 'Shift Handover',
    meta: [longD, shiftsCovered(L) ? 'Shifts: ' + shiftsCovered(L) : '', opt.user ? 'Prepared by ' + opt.user : '', exported ? 'Exported ' + exported : ''].filter(Boolean).join('   ·   '),
    summary: writtenSummary(L),
    kpis: [['Items', S.items, 'ink'], ['Pending', S.open, 'open'], ['Done', S.done, 'done'], ['Urgent', urgent, 'urgent'], ['Rooms', S.rooms, 'rooms']],
    head: cols.map(c => c[0]), widths: cols.map(c => c[1]), sections, byCat, byShift, open,
    totals: { items: S.items, open: S.open, done: S.done },
    footer: (opt.hotel ? opt.hotel + ' · ' : '') + 'Shift handover ' + dLong(opt.date || ''),
  };
}
const XL_KPI = { ink: ['FFF1F5F9', 'FF0F172A'], open: ['FFFEF3C7', 'FF92400E'], done: ['FFD1FAE5', 'FF065F46'], urgent: ['FFFEE2E2', 'FFB91C1C'], rooms: ['FFDBEAFE', 'FF1E40AF'] };

// ══ The same report as a PDF: a print page (Save as PDF), same colours as the Excel ══
const cssOf = argb => '#' + String(argb || 'FF000000').slice(2).toLowerCase();
/** the report model → the print page's body (pure; the page shell is month-end.js mePrintPage) */
function pdfHtml(m) {
  const c = cssOf, e = esc;
  const head = cols => `<thead><tr>${cols.map(h => `<th>${e(h)}</th>`).join('')}</tr></thead>`;
  const catTd = (cat, label) => { const x = catStyle(cat); return `<td class="cat" style="background:${c(x.fill)};color:${c(x.font)}">${e(label)}</td>`; };
  const stTd = st => { const x = statusStyle(st); return `<td class="st" style="background:${c(x.fill)};color:${c(x.font)}">${e(x.label)}</td>`; };
  const kpis = `<div class="hbp-kpis">${m.kpis.map(([l, n, k]) => `<div style="background:${c(XL_KPI[k][0])};color:${c(XL_KPI[k][1])}"><b>${e(n)}</b><small>${e(l)}</small></div>`).join('')}</div>`;
  const n = m.head.length;
  const rows = m.sections.map(sec => `<tr class="band"><td colspan="${n}">${e(sec.label.toUpperCase())}${sec.hours ? ' (' + e(sec.hours) + ')' : ''} · ${sec.count} item${sec.count === 1 ? '' : 's'} · ${sec.open} pending</td></tr>` +
    sec.rows.map(r => `<tr class="${r.urgent ? 'urg' : ''}${r.done ? ' done' : ''}">${r.cells.map((v, i) => i === 4 ? catTd(r.cat, v) : i === 7 ? stTd(r.status) : `<td class="${i === 5 ? 'rm' : i === 6 || i === 9 || i === 10 ? 'tx' : 'nw'}">${e(v)}</td>`).join('')}</tr>`).join('')).join('');
  const small = (title, list) => list.length ? `<h2>${e(title)}</h2><table class="hbp-s">${head([title.replace(/^By /, '').replace(/^./, x => x.toUpperCase()), 'Items', 'Pending', 'Done'])}<tbody>${list.map(r => `<tr>${r.cat ? catTd(r.cat, r.label) : `<td>${e(r.label)}</td>`}<td class="r">${r.items}</td><td class="r">${r.open}</td><td class="r">${r.done}</td></tr>`).join('')}<tr class="tot"><td>Total</td><td class="r">${m.totals.items}</td><td class="r">${m.totals.open}</td><td class="r">${m.totals.done}</td></tr></tbody></table>` : '';
  const open = m.open.length ? `<h2>Pending items</h2><table class="hbp-t">${head(['Category', 'Time', 'Rooms', '', 'Item', 'From'])}<tbody>${m.open.map(o => `<tr class="${o.urgent ? 'urg' : ''}">${catTd(o.cat, o.cells[0])}<td class="nw">${e(o.cells[1])}</td><td class="rm">${e(o.cells[2])}</td><td class="nw">${o.urgent ? '<span class="ut">URGENT</span>' : ''}</td><td class="tx">${e(o.cells[3])}</td><td class="nw">${e(o.cells[4])}</td></tr>`).join('')}</tbody></table>` : '<p class="ok">Nothing pending — a clean handover.</p>';
  return `<style>
    .hbp-h{border-bottom:3px solid ${c(XL.accent)};padding-bottom:8px;margin-bottom:10px} .hbp-h h1{font-size:22px;margin:0;color:${c(XL.ink)}} .hbp-h p{margin:3px 0 0;color:${c(XL.sub)};font-size:11px}
    .hbp-sum{font-style:italic;color:#334155;margin:8px 0 10px}
    .hbp-kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:0 0 14px} .hbp-kpis div{border-radius:8px;padding:8px 10px;text-align:center;break-inside:avoid} .hbp-kpis b{display:block;font-size:22px;line-height:1.1} .hbp-kpis small{font-size:9.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
    .hbp-t,.hbp-s{border-collapse:collapse;width:100%;font-size:10.5px} .hbp-s{width:auto;min-width:340px}
    .hbp-t th,.hbp-s th{background:${c(XL.slate)};color:#fff;text-transform:none;letter-spacing:0;font-size:10.5px;text-align:center;border-color:${c(XL.slate)};padding:6px}
    .hbp-t td,.hbp-s td{border:1px solid ${c(XL.line)};padding:4px 6px;vertical-align:top} .hbp-t tbody tr:nth-child(even) td{background-color:${c(XL.zebra)}}
    .hbp-t tr.band td{background:${c(XL.band)};font-weight:700;color:${c(XL.ink)};font-size:10px;letter-spacing:.04em}
    .hbp-t td.rm{font-weight:700;text-align:center} .hbp-t td.st{font-weight:700;text-align:center} .hbp-t td.tx{white-space:pre-wrap} .hbp-t td.nw{white-space:nowrap}
    .hbp-t tr.urg td{color:${c(XL.red)};font-weight:700} .hbp-t tr.urg td:first-child{box-shadow:inset 3px 0 0 ${c(XL.red)}} .hbp-t tr.done td{color:#64748b}
    .hbp-t .ut{background:${c(XL.redFill)};color:${c(XL.red)};font-weight:800;font-size:9px;padding:1px 5px;border-radius:4px}
    .hbp-s .tot td{font-weight:700;border-top:2px solid ${c(XL.ink)}} .hbp-two{display:flex;gap:24px;flex-wrap:wrap;break-inside:avoid}
  </style>
  <div class="hbp-h"><h1>${e(m.title)}</h1><p>${e(m.meta)}</p></div>
  ${m.summary ? `<p class="hbp-sum">${e(m.summary)}</p>` : ''}
  ${kpis}
  <div class="tw"><table class="hbp-t">${head(m.head)}<tbody>${rows}</tbody></table></div>
  <div class="hbp-two"><div>${small('By category', m.byCat)}</div><div>${small('By shift', m.byShift)}</div></div>
  <div class="tw">${open}</div>`;
}

W.hoHandoverPure = { CAT_RULES, KW_TAGS, doneReply, doneTargets, sectionOf, hoBody, learnedField, wordSwaps, applySwaps, learnToks, simOf, learnedVerdict, hoursOf, sameName, rosterShiftOf, pdfHtml, cssOf, isUrgent, XL, XL_KPI, statusStyle, catStyle, argbOf, rowHeight, shiftsCovered, reportModel, writtenSummary, HO_GROUP_RX, isHandoverGroup, HO_PREFIX_RX, hoPrefix, hoMark, hoStrip, waToHandover, isChat, pasteItems, suggestFrom, HO_COPY_MIN, handoverScore, looksLikeHandover, MOVE_RX, HANDED_RX, SHIFT_BOUNDS, shiftOf, CATS, CAT, categorize, statusOf, roomsOf, tagsOf, splitItems, tidy, buildItems, filterItems, summaryOf,
  excelRows, summaryRows, fileName, polishStyles, polishSheet, dLong, t12, COL_W, byTime };
if (!doc) return;

// ═════════════════════════ In the app ═════════════════════════
const safe = (f, d) => { try { return f(); } catch (e) { try { console.warn('[handover-book]', e); } catch (_) {} return d; } };
const LS = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} } };
const today = () => (typeof hoLocalISO === 'function' ? hoLocalISO() : isoDay(new Date()));
const me = () => (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || 'Me';
const parse = t => (typeof W.hoWaParse === 'function' ? W.hoWaParse(t) : { kind: 'none', actions: [] });
const toast = (m, k) => safe(() => { if (typeof showToast === 'function') showToast(m, k || 'ok'); });
const hotel = () => safe(() => { const el = doc.getElementById('hotelName'); const t = el && el.textContent.trim(); if (t) return t; const s = JSON.parse(localStorage.getItem('ibis_settings') || '{}'); return (s && s.hotelName) || ''; }, '') || '';
const PATH = d => 'handover/' + d;

// ── the book: handover/{date}/{key} (today live; other days read when shown) ──
const BOOK = {}, GOT = {};
let listenDay = '';
function applyPatch(day, patch) {
  const b = BOOK[day] = BOOK[day] || {};
  Object.keys(patch).forEach(p => {
    const parts = p.split('/'), k = parts[0];
    if (parts.length === 1) { if (patch[p] == null) delete b[k]; else b[k] = JSON.parse(JSON.stringify(patch[p])); return; }
    if (!b[k]) b[k] = {};
    if (patch[p] == null) delete b[k][parts[1]]; else b[k][parts[1]] = JSON.parse(JSON.stringify(patch[p]));
  });
}
function write(day, patch) {
  if (!Object.keys(patch).length) return;
  applyPatch(day, patch);
  if (typeof fbUpdate === 'function') safe(() => Promise.resolve(fbUpdate(PATH(day), patch)).catch(() => {}));
  else LS.set('hb_' + day, BOOK[day]);
  soon();
}
function listenToday() {
  const d = today(); if (listenDay === d) return; listenDay = d;
  if (typeof fbListen === 'function') safe(() => fbListen(PATH(d), v => { BOOK[d] = Object.assign({}, v && typeof v === 'object' ? v : {}); GOT[d] = Date.now(); soon(); }));
  else { BOOK[d] = LS.get('hb_' + d, {}); GOT[d] = Date.now(); }
}
async function load(day, force) {
  if (day === today()) { listenToday(); if (GOT[day]) return; }
  if (!force && GOT[day] && Date.now() - GOT[day] < 60e3) return;
  let v = null;
  try { v = typeof fbGet === 'function' ? await fbGet(PATH(day)) : LS.get('hb_' + day, null); } catch (_) {}
  BOOK[day] = Object.assign({}, v && typeof v === 'object' ? v : {}, BOOK[day] && day === today() ? BOOK[day] : {}); GOT[day] = Date.now();
}
const itemsOf = day => Object.keys(BOOK[day] || {}).map(k => withShift(cleanRooms(Object.assign({}, BOOK[day][k], { key: k, date: (BOOK[day][k] || {}).date || day })))).filter(i => i && (i.text || i.orig));
/** a room number read out of an e-mail address or a word by an older version ("…2087@hotmail.com") is not a room */
function cleanRooms(i) {
  if (!i || !Array.isArray(i.rooms) || !i.rooms.length) return i;
  const t = sp([i.text, i.orig].join(' '));
  i.rooms = i.rooms.filter(r => { const rx = new RegExp('(?:^|[^A-Za-z0-9])(?:r|rm|room|no)?\\s*#?\\s*' + String(r).replace(/\D/g, '') + '(?![0-9@])', 'i'); return rx.test(t.replace(/\S+@\S+/g, ' ')); });
  return i;
}
/** a day as the team works it: its own items, plus the night shift that started the evening before
 *  (a 19:00–04:00 night is one shift, even though midnight falls in the middle of it) */
function dayItems(d) {
  const P = itemsOf(dayAdd(d, -1)).filter(i => !i.del && lastNight(i, d));
  return itemsOf(d).concat(P.map(i => Object.assign(i, { prevNight: true })));
}
/** when last night's shift began, in minutes: the roster's hours of the people on it ("19:00–04:00"), else the Night shift's hours */
function nightStart(d) {
  const L = itemsOf(d).concat(itemsOf(dayAdd(d, -1))).filter(i => i.shift === 'Night' && /^\d{1,2}:\d{2}/.test(i.shiftHours || ''));
  const h = L.map(i => toMin(String(i.shiftHours).slice(0, 5))).filter(m => m != null && m >= 12 * 60);
  if (h.length) return Math.min(...h);
  const n = SHIFT_BOUNDS.find(b => b.id === 'Night');
  return n ? n.from : 23 * 60;
}
/** an item of the day before d that was written during the night shift running into d */
function lastNight(i, d) {
  if (!i || i.date !== dayAdd(d, -1)) return false;
  if (sectionOf(i).k === 'Night') return true;
  const m = toMin(i.time); return m != null && m >= nightStart(d);
}
/** still open from the day before, apart from last night's items (those are in the day already) */
function carryItems(d, f) {
  if (HB.st === 'done') return [];
  return shown(filterItems(itemsOf(dayAdd(d, -1)).filter(i => !lastNight(i, d)), Object.assign({}, f, { st: 'open', shift: 'all' }))).sort(byTime);
}
/** the shift as on the roster (who wrote it, or you, working at that time), else by the clock */
function withShift(i) {
  if (!i || !i.time || typeof roWorkingAt !== 'function') return i;
  return safe(() => {
    const t = new Date((i.date || today()) + 'T' + String(i.time).slice(0, 5) + ':00'); if (isNaN(t)) return i;
    const mk = typeof roMeKey !== 'undefined' ? roMeKey : '';
    const people = roWorkingAt(t, true).map(x => Object.assign({}, x, { me: !!mk && x.key === mk }));
    const r = rosterShiftOf(people, i.sender, !i.sender || i.sender === 'Me' || i.sender === me());
    if (r) { i.shift = r.id; i.shiftHours = r.hours; }
    return i;
  }, i);
}

// ── from WhatsApp (wa-bridge.js) ──
const LS_MID = 'hb_mid_v1';
function midDay(mid, day) { const m = LS.get(LS_MID, {}); if (day) { m[mid] = day; const ks = Object.keys(m); if (ks.length > 600) ks.slice(0, ks.length - 600).forEach(k => delete m[k]); LS.set(LS_MID, m); } return m[mid] || ''; }
/** p: {kind:'msg', base, mid, date, time, sender, group, text, edited, at} | {kind:'del', base, mid} → items saved / changed / removed; returns how many items */
/** a "Done" reply from WhatsApp: tick the item it answers; not sure which → ask on the page */
const DQ_MIN = 0.4;                                          // how clearly a "Done" reply must point at an item before the book asks which one
// "None of these": that message is never asked about again (this device + the team: handoverLearn/nq_<message>)
const LS_NOASK = 'hb_noask_v1';
function noAsked(base) {
  if (!base) return false;
  const L = LS.get(LS_NOASK, []);
  if (Array.isArray(L) && L.includes(String(base))) return true;
  return learnList().some(e => e && e.v === 'noask' && e.b === String(base));
}
function rememberNoAsk(base) {
  if (!base) return;
  const L = LS.get(LS_NOASK, []), A = Array.isArray(L) ? L : [];
  if (!A.includes(String(base))) LS.set(LS_NOASK, A.concat(String(base)).slice(-400));
  const key = 'nq_' + fbSafe(base).slice(-60), e = { v: 'noask', b: String(base), by: me(), at: Date.now() };
  LEARN[key] = e;
  if (typeof fbSet === 'function') safe(() => Promise.resolve(fbSet('handoverLearn/' + key, e)).catch(() => {})); else LS.set('hb_learn', LEARN);
}
async function doneFromWa(p) {
  const day = p.date || today(), prev = isoDay(new Date(new Date(day + 'T12:00:00').getTime() - 864e5));
  await load(day); await load(prev);
  const pool = itemsOf(day).concat(itemsOf(prev)), d = doneReply(p.text) || { rooms: [] };
  const at = (p.time && Date.parse(day + 'T' + String(p.time).padStart(5, '0').slice(0, 5) + ':00')) || p.at || Date.now();
  const T = doneTargets(pool, p.quote, d.rooms, { text: p.text, group: p.group, at });
  const sure = T[0] && ((T[0].score >= 0.75 && (!T[1] || T[0].score - T[1].score >= 0.2)) || (T.length === 1 && T[0].score >= 0.7));   // the only open item for that room counts too
  if (sure) {
    setField(T[0].date, T[0].key, { status: 'done', doneBy: p.sender || 'WhatsApp', doneAt: p.at || Date.now(), doneVia: 'WhatsApp reply' });
    toast(`✓ Handover: ${p.sender || 'Someone'} replied "${sp(p.text).slice(0, 20)}" — marked done`, 'ok');
    return 1;
  }
  // not sure: ask on the page, but only when the reply is clearly about a handover item — never a guess from the latest items
  // ("none of these" picked the wrong messages), never from another group, and never again once you said "None of these"
  if (p.strict || !T.length || T[0].score < DQ_MIN || noAsked(p.base)) return 0;
  const key = 'dq_' + String(p.base).slice(-40), patch = {};
  if (itemsOf(day).some(i => i.key === key && (i.doneQa || i.del))) return 0;   // already answered: the same message read again asks nothing
  patch[fbSafe(key)] = { qmsg: p.base, date: day, time: p.time || '', sender: p.sender || '', group: p.group || '', text: sp(p.text).slice(0, 200), orig: sp(p.text).slice(0, 200), quote: sp(p.quote || '').slice(0, 200),
    chat: 1, doneQ: T.slice(0, 3).map(x => x.date + '|' + x.key), at: p.at || Date.now(), src: 'wa', cat: 'info', status: 'info' };
  write(day, patch);
  toast(`🤔 ${p.sender || 'Someone'} said "${sp(p.text).slice(0, 20)}" — which handover item? (Handover Book)`, 'warn');
  return 0;
}
async function fromWa(p) {
  if (!p || !p.base) return 0;
  if (p.kind === 'done') return doneFromWa(p);
  if (p.kind === 'msg' && p.copy) return 0;                  // the old "auto-pick from other groups" (still queued on a device): no longer taken
  // a "Done" reply inside the handover group itself: tick it (the reply stays as team chat)
  if (p.kind === 'msg' && doneReply(p.text) && (p.quote || !p.copy)) { await doneFromWa(p); }   // in the handover group a plain "Done" counts too
  if (p.kind === 'del') {
    const day = midDay(p.base); if (!day) return 0;            // never saved here: nothing to remove
    await load(day, true);
    const patch = {}; itemsOf(day).filter(i => i.msg === p.base && !i.del).forEach(i => { patch[fbSafe(i.key) + '/del'] = 1; patch[fbSafe(i.key) + '/delAt'] = Date.now(); });
    write(day, patch); return Object.keys(patch).length / 2;
  }
  const day = midDay(p.base) || p.date || today();         // an edit stays on the day the message was saved (an edit after midnight, no date)
  if (day !== today()) await load(day); else listenToday();
  let items = buildItems({ base: p.base, mid: p.mid || '', date: day, time: p.time, sender: p.sender, group: p.group, text: p.text, at: p.at || Date.now(), src: p.copy ? 'copy' : p.src || 'wa' }, { parse, ho: !p.copy && p.src !== 'prefix' });
  // what the book learned from your removals and additions (a "HO -" mark is always kept)
  items = items.map(it => p.src !== 'prefix' ? applyLearned(it) : applyLearnedFields(it));
  // copied from another group (HK…): only the lines that read like handover items (or that you taught it to keep); nothing learned as "not handover"
  if (p.copy) items = items.filter(it => it.learn !== 'no' && (it.learn === 'yes' || (items.length > 1 ? looksLikeHandover(it.orig, { parse }) : looksLikeHandover(p.text, { parse }))));
  const old = itemsOf(day).filter(i => i.msg === p.base), patch = {};
  items.forEach(it => {
    const k = fbSafe(it.key), was = old.find(o => o.key === it.key);
    if (!was) { delete it.key; patch[k] = it; return; }
    const ch = { orig: it.orig, rooms: it.rooms, tags: it.tags, full: it.full || null, part: it.part || null, parts: it.parts || null, head: it.head || null, src: it.src };
    if (!was.delBy) ch.del = null;                                                // deleted here by hand: an edit in WhatsApp does not bring it back
    if (!was.chatBy) ch.chat = it.chat || null;                                   // "Add to handover" / "Not handover" taps stay
    if (!was.textBy) ch.text = it.text;
    if (!was.catBy) ch.cat = it.cat;
    if (p.edited) ch.edited = 1;
    Object.keys(ch).forEach(f => { patch[k + '/' + f] = ch[f]; });
  });
  old.forEach(o => { if (!items.some(i => i.key === o.key)) patch[fbSafe(o.key)] = null; });
  midDay(p.base, day);
  write(day, patch);
  safe(() => { if (typeof logActivity === 'function' && !old.length) logActivity('handover_item', `${p.sender || 'WhatsApp'}: ${items.length} handover item${items.length === 1 ? '' : 's'}`); });
  return items.length;
}
// ── what the book has learned (shared by the team): handoverLearn/{key} = {t, v, ex, by, at} ──
let LEARN = {};
function listenLearn() {
  if (typeof fbListen === 'function') safe(() => fbListen('handoverLearn', v => { LEARN = v && typeof v === 'object' ? v : {}; }));
  else LEARN = LS.get('hb_learn', {});
}
const REPLACED = {};   // lesson key → the lessons it replaced
/** Undo of a lesson: it is forgotten and the lessons it replaced come back */
function unlearn(key) {
  forget(key);
  (REPLACED[key] || []).forEach(([k, e]) => { LEARN[k] = e; if (typeof fbSet === 'function') safe(() => Promise.resolve(fbSet('handoverLearn/' + k, e)).catch(() => {})); else LS.set('hb_learn', LEARN); });
  delete REPLACED[key];
}
const learnList = () => Object.keys(LEARN).map(k => LEARN[k]).filter(Boolean);
/** remember: text like this is ('yes') / is not ('no') a handover item → returns the key (to forget it on Undo) */
function learn(text, v) {
  const t = learnToks(text); if (!t.length) return '';
  const key = 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  // the same words learned the other way before: that lesson is replaced (and comes back with Undo, see unlearn)
  const was = [];
  Object.keys(LEARN).forEach(k => { const e = LEARN[k]; if (e && (e.v === 'yes' || e.v === 'no') && Array.isArray(e.t) && simOf(e.t, t) >= 0.85) { was.push([k, e]); forget(k); } });
  if (was.length) REPLACED[key] = was;
  const e = { t, v, ex: sp(text).slice(0, 120), by: me(), at: Date.now() };
  LEARN[key] = e;
  if (typeof fbSet === 'function') safe(() => Promise.resolve(fbSet('handoverLearn/' + key, e)).catch(() => {})); else LS.set('hb_learn', LEARN);
  const ks = Object.keys(LEARN); if (ks.length > 500) ks.sort((a, b) => (LEARN[a].at || 0) - (LEARN[b].at || 0)).slice(0, ks.length - 500).forEach(forget);
  return key;
}
/** remember a choice you made on an item (topic, pending / info) for messages like it */
function learnField(text, kind, val) {
  const t = learnToks(text); if (!t.length || !val) return '';
  Object.keys(LEARN).forEach(k => { const e = LEARN[k]; if (e && String(e.v || '').indexOf(kind + ':') === 0 && simOf(e.t, t) >= 0.85) forget(k); });
  const key = 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), e = { t, v: kind + ':' + val, ex: sp(text).slice(0, 120), by: me(), at: Date.now() };
  LEARN[key] = e;
  if (typeof fbSet === 'function') safe(() => Promise.resolve(fbSet('handoverLearn/' + key, e)).catch(() => {})); else LS.set('hb_learn', LEARN);
  return key;
}
/** the words you fixed by hand → fixed for you next time (handoverLearn/w_<word>) */
function learnWords(before, after) {
  wordSwaps(before, after).forEach(([a, b]) => {
    const key = 'w_' + a.replace(/[^a-z0-9\u0600-\u06ff]/gi, '_').slice(0, 40), e = { w: [a, b], v: 'word', by: me(), at: Date.now() };
    LEARN[key] = e;
    if (typeof fbSet === 'function') safe(() => Promise.resolve(fbSet('handoverLearn/' + key, e)).catch(() => {})); else LS.set('hb_learn', LEARN);
  });
}
const learnedSwaps = () => learnList().filter(e => e.v === 'word' && Array.isArray(e.w)).map(e => e.w);
function forget(key) {
  if (!key || !LEARN[key]) return; delete LEARN[key];
  if (typeof fbSet === 'function') safe(() => Promise.resolve(fbSet('handoverLearn/' + key, null)).catch(() => {})); else LS.set('hb_learn', LEARN);
}
/** a new item, as learned: like one you removed → team chat; like one you kept → in; in between → ask */
/** your word fixes, topics and pending / info choices, on a new item */
function applyLearnedFields(it) {
  const L = learnList(), src = it.orig || it.text;
  const sw = learnedSwaps(); if (sw.length && it.text) it.text = applySwaps(it.text, sw);
  const c = learnedField(src, L, 'cat'); if (c && CAT[c]) it.cat = c;
  const st = learnedField(src, L, 'st'); if (st === 'open' || st === 'info') it.status = st;
  return it;
}
function applyLearned(it) {
  applyLearnedFields(it);
  const r = learnedVerdict(it.orig || it.text, learnList()); if (!r) return it;
  if (r.v === 'no') { it.chat = 1; it.learn = 'no'; }
  else if (r.v === 'yes') { it.chat = null; it.learn = 'yes'; }
  else { it.ask = 1; it.learn = 'ask:' + r.like; }
  return it;
}

// messages that came before this file was ready (wa-bridge.js keeps them in hb_queue_v1)
function drain() { const q = LS.get('hb_queue_v1', []); if (!Array.isArray(q) || !q.length) return; LS.set('hb_queue_v1', []); q.reduce((pr, p) => pr.then(() => fromWa(p)).catch(() => {}), Promise.resolve()); }

// ── changes from the page ──
function setField(day, key, fields) { const k = fbSafe(key), patch = {}; Object.keys(fields).forEach(f => { patch[k + '/' + f] = fields[f]; }); write(day, patch); }
/** add lines typed, pasted or picked here: [{text, sender?, time?, date?, cat?, src?}] → how many items */
function addItems(list, day) {
  const now = new Date(), t = pad(now.getHours()) + ':' + pad(now.getMinutes()), byDay = {};
  let n = 0;
  (list || []).forEach((x, i) => {
    if (!x || !sp(x.text).trim()) return;
    const d = /^\d{4}-\d{2}-\d{2}$/.test(x.date || '') ? x.date : day || today();
    const items = buildItems({ base: 'h' + Date.now().toString(36) + i + Math.random().toString(36).slice(2, 5), date: d, time: x.time || t, sender: x.sender || me(), group: '', text: x.text, at: Date.now() + i, src: x.src || 'hand' }, { parse });
    items.forEach(it => {
      safe(() => applyLearnedFields(it));
      if (x.cat) { it.cat = x.cat; it.catBy = me(); it.status = statusOf(it.orig, x.cat, it.head); }
      if (x.from) it.from = x.from;
      const p = byDay[d] = byDay[d] || {}; const k = fbSafe(it.key); delete it.key; p[k] = it; n++;
    });
  });
  Object.keys(byDay).forEach(d => write(d, byDay[d]));
  safe(() => { if (n && typeof logActivity === 'function') logActivity('handover_item', `${me()}: ${n} handover item${n === 1 ? '' : 's'} added`); });
  return n;
}
const addByHand = (text, cat) => addItems(splitItems(text).map(p => ({ text: (p.head ? p.head + ': ' : '') + p.text, cat })));

// ═════════════════ The 📒 Handover Book page ═════════════════
const PANEL = 'handover-book';
const SET_KEY = 'hb_settings_v1', VIEW_KEY = 'hb_view_v1';
const HB = { date: '', shift: 'all', cat: '', st: 'all', sender: '', src: 'all', group: '', room: '', q: '', by: 'time', more: false, xp: false,
  edit: '', menu: '', note: '', orig: '', fold: {}, chat: false, draft: '', draftCat: '', rows: null, rowsKind: '', seq: 0 };
safe(() => { const v = LS.get(VIEW_KEY, {}); if (v && /^(?:time|cat|room)$/.test(v.by)) HB.by = v.by; });
const SETTINGS = () => Object.assign({ exp: 'seen', orig: false }, LS.get(SET_KEY, {}));
const PCSS = `
#hbRoot{--hb-acc:var(--gold,var(--accent,#0a84ff));--hb-open:var(--amber,#d97706);--hb-done:var(--green,#16a34a);--hb-info:var(--blue,#2563eb);--hb-red:var(--red,#dc2626);
  --hb-r:16px;--hb-hair:color-mix(in srgb,var(--text) 10%,transparent);--hb-soft:color-mix(in srgb,var(--text) 4.5%,var(--card));--hb-fill:color-mix(in srgb,var(--text) 6%,transparent);
  --hb-font:-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display",Inter,system-ui,"Segoe UI",sans-serif;font-family:var(--hb-font);-webkit-font-smoothing:antialiased;
  display:grid;gap:16px;min-width:0;max-width:980px;margin:0 auto;color:var(--text)}
#hbRoot *{box-sizing:border-box}
#hbRoot button,#hbRoot input,#hbRoot select,#hbRoot textarea{font-family:var(--hb-font)}
#hbRoot .hb-chips:empty,#hbRoot #hbMore:empty,#hbRoot #hbCarry:empty,#hbRoot #hbChat:empty{display:none}
#hbRoot :focus-visible{outline:2px solid var(--hb-acc);outline-offset:2px}
#hbRoot .hb-hd{display:flex;flex-wrap:wrap;align-items:flex-end;gap:12px 16px;min-width:0}
#hbRoot .hb-ttl{flex:1 1 260px;min-width:0}
#hbRoot .hb-ttl h1{margin:0;font:700 34px/1.1 var(--hb-font);letter-spacing:-.025em;color:var(--text)}
#hbRoot .hb-sub{display:flex;align-items:center;gap:2px;margin-top:4px;flex-wrap:wrap}
#hbRoot .hb-dl{position:relative;display:inline-flex;align-items:center;font:600 15px var(--hb-font);color:var(--text2);padding:4px 6px;border-radius:8px;cursor:pointer}
#hbRoot .hb-dl:hover{background:var(--hb-fill);color:var(--text)}
#hbRoot .hb-dl input{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;color-scheme:light dark}
#hbRoot .hb-arw{all:unset;cursor:pointer;width:28px;height:28px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:var(--hb-acc);font:600 19px/1 var(--hb-font)}
#hbRoot .hb-arw:hover{background:var(--hb-fill)}
#hbRoot .hb-arw[disabled]{opacity:.3;cursor:default;background:none}
#hbRoot .hb-hda{display:flex;align-items:center;gap:4px;flex-wrap:wrap}
#hbRoot .hb-q{all:unset;box-sizing:border-box;cursor:pointer;padding:7px 11px;border-radius:10px;font:500 14px var(--hb-font);color:var(--hb-acc);white-space:nowrap}
#hbRoot .hb-q:hover{background:var(--hb-fill)}
#hbRoot .hb-q.sm{font-size:13px;padding:5px 9px}
#hbRoot .hb-pri{all:unset;box-sizing:border-box;cursor:pointer;padding:9px 16px;border-radius:999px;background:var(--hb-acc);color:var(--bg,#fff);font:600 14px var(--hb-font);white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.12),0 4px 14px -6px color-mix(in srgb,var(--hb-acc) 70%,transparent);transition:transform .18s cubic-bezier(.2,.9,.3,1.3),filter .15s}
#hbRoot .hb-pri:hover{filter:brightness(1.06)}
#hbRoot .hb-pri:active{transform:scale(.96)}
#hbRoot .hb-pri.sm{padding:7px 14px;font-size:13.5px}
#hbRoot .hb-pri[disabled]{opacity:.4;cursor:default;box-shadow:none}
#hbRoot .hb-panel{background:var(--card);border:1px solid var(--hb-hair);border-radius:var(--hb-r);padding:16px;display:grid;gap:10px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
#hbRoot .hb-panel h3{margin:0;font:650 15px var(--hb-font)}
#hbRoot .hb-hint{font-size:12.5px;color:var(--text3);line-height:1.45}
#hbRoot .hb-in{width:100%;background:var(--hb-soft);color:var(--text);border:1px solid var(--hb-hair);border-radius:11px;padding:9px 12px;font:15px var(--hb-font);margin:0;min-width:0;color-scheme:light dark;transition:border-color .15s,box-shadow .15s}
#hbRoot .hb-in:focus{outline:0;border-color:var(--hb-acc);box-shadow:0 0 0 3px color-mix(in srgb,var(--hb-acc) 22%,transparent)}
#hbRoot .hb-new{background:var(--card);border:1px solid var(--hb-hair);border-radius:var(--hb-r);padding:6px 6px 6px 14px;display:grid;gap:0;box-shadow:0 1px 2px rgba(0,0,0,.04),0 8px 24px -18px rgba(0,0,0,.35)}
#hbRoot .hb-newrow{display:flex;align-items:flex-start;gap:8px;min-width:0}
#hbRoot .hb-plus{flex:none;width:24px;height:24px;margin-top:9px;border-radius:50%;border:1.6px solid var(--hb-acc);color:var(--hb-acc);display:inline-flex;align-items:center;justify-content:center;font:500 17px/1 var(--hb-font)}
#hbRoot #hbNew{flex:1;min-width:0;border:0;background:transparent;color:var(--text);font:17px/1.4 var(--hb-font);padding:9px 2px;resize:none;outline:0;min-height:42px;max-height:220px;overflow-y:auto}
#hbRoot #hbNew::placeholder{color:var(--text3)}
#hbRoot .hb-newact{display:flex;align-items:center;gap:6px;flex:none;padding-top:4px}
#hbRoot .hb-mini{all:unset;box-sizing:border-box;cursor:pointer;max-width:140px;padding:6px 8px;border-radius:9px;font:500 13px var(--hb-font);color:var(--text2);background:var(--hb-fill);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color-scheme:light dark}
#hbRoot .hb-mini option{color:#111;background:#fff}
#hbRoot .hb-prev{border-top:1px solid var(--hb-hair);margin:4px 6px 0 18px;padding:8px 0 6px;display:grid;gap:6px;animation:hbIn .22s cubic-bezier(.2,.9,.3,1.15)}
#hbRoot .hb-prev:empty{display:none}
#hbRoot .hb-pv{display:flex;align-items:flex-start;gap:8px;font-size:14px;line-height:1.4;color:var(--text);min-width:0}
#hbRoot .hb-pv input{margin:3px 0 0;accent-color:var(--hb-acc);width:16px;height:16px;flex:none}
#hbRoot .hb-pv .tx{flex:1;min-width:0;overflow-wrap:anywhere}
#hbRoot .hb-pv .tx small{display:block;color:var(--text3);font-size:12px}
#hbRoot .hb-pv.off .tx{color:var(--text3)}
#hbRoot .hb-newft{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;padding:2px 4px 2px 22px}
#hbRoot .hb-strip{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
#hbRoot .hb-stat{all:unset;box-sizing:border-box;cursor:pointer;background:var(--card);border:1px solid var(--hb-hair);border-radius:14px;padding:12px 14px;display:grid;gap:2px;transition:transform .18s cubic-bezier(.2,.9,.3,1.3),border-color .15s}
#hbRoot .hb-stat:hover{border-color:color-mix(in srgb,var(--c) 45%,var(--hb-hair))}
#hbRoot .hb-stat:active{transform:scale(.97)}
#hbRoot .hb-stat.on{border-color:var(--c);box-shadow:inset 0 0 0 1px var(--c)}
#hbRoot .hb-stat b{font:700 26px/1.1 var(--hb-font);color:var(--c);font-variant-numeric:tabular-nums;letter-spacing:-.02em}
#hbRoot .hb-stat span{font:500 12.5px var(--hb-font);color:var(--text3)}
#hbRoot .hb-sum{margin:0;font-size:14.5px;line-height:1.5;color:var(--text2);padding:0 2px}
#hbRoot .hb-sum b{color:var(--text);font-weight:600}
#hbRoot .hb-tb{position:sticky;top:0;z-index:20;display:grid;gap:8px;padding:10px;margin:0 -10px;border-radius:18px;background:color-mix(in srgb,var(--bg) 78%,transparent);-webkit-backdrop-filter:saturate(1.8) blur(18px);backdrop-filter:saturate(1.8) blur(18px);border:1px solid transparent}
#hbRoot .hb-tb:has(.hb-more){position:relative;top:auto}   /* filters open: scroll away with the page, never cover the list */
#hbRoot .hb-carry .hb-gh{color:var(--hb-open)}
#hbRoot .hb-tb.stuck{border-color:var(--hb-hair);box-shadow:0 8px 28px -20px rgba(0,0,0,.45)}
#hbRoot .hb-tbr{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0}
#hbRoot .hb-seg{display:inline-flex;padding:2px;border-radius:10px;background:var(--hb-fill);gap:2px;max-width:100%;overflow-x:auto;scrollbar-width:none}
#hbRoot .hb-seg::-webkit-scrollbar{display:none}
#hbRoot .hb-seg button{all:unset;box-sizing:border-box;cursor:pointer;padding:6px 12px;border-radius:8px;font:500 13.5px var(--hb-font);color:var(--text2);white-space:nowrap;transition:background .18s,color .18s,box-shadow .18s}
#hbRoot .hb-seg button em{font-style:normal;font-size:12px;color:var(--text3);margin-left:3px;font-variant-numeric:tabular-nums}
#hbRoot .hb-seg button.on{background:var(--card);color:var(--text);font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.14),0 0 0 .5px rgba(0,0,0,.05)}
#hbRoot .hb-srch{flex:1 1 180px;min-width:0;position:relative}
#hbRoot .hb-srch input{width:100%;background:var(--hb-fill);border:0;border-radius:10px;padding:8px 12px 8px 32px;font:15px var(--hb-font);color:var(--text);outline:0;color-scheme:light dark}
#hbRoot .hb-srch input:focus{box-shadow:0 0 0 3px color-mix(in srgb,var(--hb-acc) 22%,transparent)}
#hbRoot .hb-srch::before{content:"";position:absolute;left:11px;top:50%;width:11px;height:11px;margin-top:-7px;border:1.8px solid var(--text3);border-radius:50%}
#hbRoot .hb-srch::after{content:"";position:absolute;left:21px;top:50%;width:6px;height:1.8px;margin-top:4px;background:var(--text3);transform:rotate(45deg);border-radius:2px}
#hbRoot .hb-chips{display:flex;flex-wrap:wrap;gap:6px;min-width:0}
#hbRoot .hb-chip{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;gap:5px;padding:5px 11px;border-radius:999px;background:var(--hb-fill);color:var(--text2);font:500 13px var(--hb-font);white-space:nowrap;max-width:100%;transition:background .15s,color .15s}
#hbRoot .hb-chip em{font-style:normal;font-size:12px;opacity:.65;font-variant-numeric:tabular-nums}
#hbRoot .hb-chip.on{background:var(--hb-acc);color:var(--bg,#fff)}
#hbRoot .hb-chip.x::after{content:"✕";font-size:10px;margin-left:3px;opacity:.7}
#hbRoot .hb-more{display:grid;gap:10px;padding:10px 2px 2px;border-top:1px solid var(--hb-hair);animation:hbIn .22s cubic-bezier(.2,.9,.3,1.15)}
#hbRoot .hb-more label{font:500 12px var(--hb-font);color:var(--text3);display:block;margin-bottom:4px}
#hbRoot .hb-more .hb-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:14px 16px;align-items:start}
#hbRoot .hb-more .hb-grid>div{min-width:0}
#hbRoot .hb-more .hb-seg{display:flex;flex-wrap:wrap;overflow:visible;width:max-content;max-width:100%}
#hbRoot .hb-more .hb-hint{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-height:36px}
#hbRoot .hb-more select{width:100%}
#hbRoot .hb-sec{display:grid;gap:0;min-width:0}
#hbRoot .hb-gh{all:unset;box-sizing:border-box;cursor:pointer;display:flex;align-items:center;gap:8px;padding:14px 4px 8px;font:650 13px var(--hb-font);color:var(--text2);text-transform:uppercase;letter-spacing:.04em;width:100%}
#hbRoot .hb-gh em{font-style:normal;font-weight:500;color:var(--text3);letter-spacing:0;text-transform:none}
#hbRoot .hb-gh .chev{margin-left:auto;transition:transform .25s cubic-bezier(.2,.9,.3,1.2);color:var(--text3)}
#hbRoot .hb-gh[aria-expanded="false"] .chev{transform:rotate(-90deg)}
#hbRoot .hb-list{background:var(--card);border:1px solid var(--hb-hair);border-radius:var(--hb-r);overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.04)}
#hbRoot .hb-it{position:relative;display:flex;gap:12px;padding:12px 12px 12px 14px;min-width:0;animation:hbIn .28s cubic-bezier(.2,.9,.3,1.15) both;transition:background .15s}
#hbRoot .hb-it+.hb-it::before{content:"";position:absolute;top:0;left:50px;right:0;height:1px;background:var(--hb-hair)}
#hbRoot .hb-it:hover{background:color-mix(in srgb,var(--text) 2.5%,transparent)}
#hbRoot .hb-ck{all:unset;box-sizing:border-box;cursor:pointer;flex:none;width:24px;height:24px;margin-top:1px;border-radius:50%;border:1.8px solid color-mix(in srgb,var(--text3) 75%,transparent);display:inline-flex;align-items:center;justify-content:center;color:transparent;font:700 13px/1 var(--hb-font);transition:transform .2s cubic-bezier(.2,.9,.3,1.5),background .2s,border-color .2s}
#hbRoot .hb-ck:active{transform:scale(.85)}
#hbRoot .hb-it.open .hb-ck{border-color:var(--hb-open)}
#hbRoot .hb-it.done .hb-ck{background:var(--hb-done);border-color:var(--hb-done);color:#fff}
#hbRoot .hb-it.info .hb-ck{border-style:dashed}
#hbRoot .hb-bd{flex:1;min-width:0;display:grid;gap:5px}
#hbRoot .hb-tx{font-size:15.5px;line-height:1.45;color:var(--text);overflow-wrap:anywhere;cursor:text;border-radius:6px;margin:-2px -4px;padding:2px 4px}
#hbRoot .hb-tx:hover{background:var(--hb-fill)}
#hbRoot .hb-tx small{display:block;font-size:12px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.03em}
#hbRoot .hb-it.done .hb-tx{color:var(--text3);text-decoration:line-through;text-decoration-color:color-mix(in srgb,var(--text3) 60%,transparent)}
#hbRoot .hb-ed{width:100%;font:15.5px/1.45 var(--hb-font);color:var(--text);background:var(--hb-soft);border:1px solid var(--hb-acc);border-radius:10px;padding:7px 10px;resize:none;outline:0;box-shadow:0 0 0 3px color-mix(in srgb,var(--hb-acc) 20%,transparent);overflow:hidden;min-height:40px}
#hbRoot .hb-meta{display:flex;flex-wrap:wrap;align-items:center;gap:5px 8px;font-size:12.5px;color:var(--text3);min-width:0}
#hbRoot .hb-av{flex:none;width:18px;height:18px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font:700 8.5px/1 var(--hb-font);color:#fff;background:hsl(var(--h,210) 52% 48%)}
#hbRoot .hb-who{display:inline-flex;align-items:center;gap:5px;max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text2)}
#hbRoot .hb-pill{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;font:500 12px var(--hb-font);background:color-mix(in srgb,hsl(var(--ch,210) 70% 50%) 13%,transparent);color:hsl(var(--ch,210) 55% 42%);white-space:nowrap}
:root[data-theme="night-ops"] #hbRoot .hb-pill,:root[data-theme="midnight"] #hbRoot .hb-pill{color:hsl(var(--ch,210) 70% 70%)}
#hbRoot .hb-rm{all:unset;cursor:pointer;font:600 12px var(--hb-font);padding:2px 7px;border-radius:6px;background:var(--hb-fill);color:var(--text);font-variant-numeric:tabular-nums}
#hbRoot .hb-rm:hover{background:color-mix(in srgb,var(--hb-acc) 18%,transparent)}
#hbRoot .hb-tag{font:500 11.5px var(--hb-font);padding:1px 7px;border-radius:6px;border:1px solid var(--hb-hair);color:var(--text2)}
#hbRoot .hb-urg{display:inline-flex;align-items:center;gap:4px;font-weight:600;color:var(--hb-red)}
#hbRoot .hb-urg::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--hb-red);box-shadow:0 0 0 3px color-mix(in srgb,var(--hb-red) 18%,transparent)}
#hbRoot .hb-note{font-size:13.5px;color:var(--text2);background:var(--hb-fill);border-radius:10px;padding:7px 10px;overflow-wrap:anywhere}
#hbRoot .hb-orig{font-size:13px;color:var(--text2);background:var(--hb-soft);border:1px dashed var(--hb-hair);border-radius:10px;padding:8px 10px;white-space:pre-wrap;overflow-wrap:anywhere}
#hbRoot .hb-orig b{display:block;font-size:11.5px;color:var(--text3);margin-bottom:2px}
#hbRoot .hb-askl{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:8px;padding:7px 10px;border-radius:10px;font-size:12px;background:color-mix(in srgb,var(--hb-info) 10%,transparent);color:var(--text)}
#hbRoot .hb-sts{display:inline-flex;border-radius:999px;background:color-mix(in srgb,var(--text3) 12%,transparent);padding:2px;gap:2px}
#hbRoot .hb-sts button{all:unset;box-sizing:border-box;cursor:pointer;font:600 11px/1 var(--hb-font);padding:5px 10px;border-radius:999px;color:var(--text2);transition:background .18s,color .18s,box-shadow .18s}
#hbRoot .hb-sts button:hover{color:var(--text)}
#hbRoot .hb-sts button.on.open{background:var(--hb-open);color:#fff;box-shadow:0 1px 3px rgba(0,0,0,.18)}
#hbRoot .hb-sts button.on.done{background:var(--hb-done);color:#fff;box-shadow:0 1px 3px rgba(0,0,0,.18)}
#hbRoot .hb-sts button:focus-visible{outline:2px solid var(--hb-acc);outline-offset:1px}
#hbRoot .hb-ib.hb-del:hover{color:var(--hb-red);background:color-mix(in srgb,var(--hb-red) 12%,transparent)}
#hbRoot .hb-acts{flex:none;display:flex;align-items:flex-start;gap:2px;opacity:.45;transition:opacity .15s}
#hbRoot .hb-it:hover .hb-acts,#hbRoot .hb-it:focus-within .hb-acts,#hbRoot .hb-it.menu .hb-acts{opacity:1}
@media (hover:none){#hbRoot .hb-acts{opacity:1}}
#hbRoot .hb-ib{all:unset;box-sizing:border-box;cursor:pointer;width:30px;height:30px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:var(--text3);font:600 15px/1 var(--hb-font)}
#hbRoot .hb-ib:hover{background:var(--hb-fill);color:var(--text)}
#hbRoot .hb-menu{display:flex;flex-wrap:wrap;gap:6px;padding:4px 0 2px;animation:hbIn .2s cubic-bezier(.2,.9,.3,1.15)}
#hbRoot .hb-menu .lbl{width:100%;font:600 11.5px var(--hb-font);color:var(--text3);text-transform:uppercase;letter-spacing:.04em;margin-top:2px}
#hbRoot .hb-chip.warn{color:var(--hb-red)}
#hbRoot .hb-carry .hb-list{border-color:color-mix(in srgb,var(--hb-open) 40%,var(--hb-hair))}
#hbRoot .hb-empty{text-align:center;padding:40px 16px;color:var(--text3);font-size:14.5px;line-height:1.55}
#hbRoot .hb-empty b{display:block;font-size:40px;margin-bottom:6px}
#hbRoot .hb-empty strong{color:var(--text2)}
#hbRoot .hb-chatl .hb-it{padding:9px 12px 9px 14px}
#hbRoot .hb-chatl .hb-tx{font-size:14px;color:var(--text2);cursor:default}
#hbRoot .hb-chatl .hb-tx:hover{background:none}
#hbRoot .hb-lbl{display:flex;align-items:center;gap:8px;font-size:14px;color:var(--text2)}
#hbRoot .hb-lbl input{accent-color:var(--hb-acc);width:16px;height:16px}
@keyframes hbIn{from{opacity:0;transform:translateY(6px) scale(.985)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){#hbRoot *{animation:none!important;transition:none!important}}
@media (max-width:700px){
  #hbRoot{gap:12px}
  #hbRoot .hb-ttl h1{font-size:28px}
  #hbRoot .hb-hda{width:100%}
  #hbRoot .hb-hda .hb-pri{margin-left:auto}
  #hbRoot .hb-strip{grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
  #hbRoot .hb-stat{padding:9px 8px;border-radius:12px;text-align:center}
  #hbRoot .hb-stat b{font-size:21px}
  #hbRoot .hb-stat span{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #hbRoot .hb-tb{margin:0 -6px;padding:8px 6px}
  #hbRoot .hb-seg button{padding:6px 9px;font-size:13px}
  #hbRoot .hb-newact .hb-mini{max-width:92px}
  #hbRoot .hb-it{gap:10px;padding:11px 8px 11px 12px}
  #hbRoot .hb-it+.hb-it::before{left:46px}
  #hbRoot .hb-acts{flex-direction:column}
  #hbRoot .hb-who{max-width:110px}
}
`;
const catOf = c => CAT[c] || CAT.info;
const CAT_HUE = { guest: 340, pay: 150, res: 220, move: 265, maint: 25, hk: 185, transport: 45, lost: 300, desk: 200, fb: 10, follow: 38, cash: 120, info: 215 };
const initials = s => { const w = String(s || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean); return w.length ? ((w[0][0] || '') + (w[1] ? w[1][0] : '')).toUpperCase() : '•'; };
const hueOf = s => { let h = 7; s = String(s || ''); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i) * 97) % 3600; return Math.floor(h / 10); };
const longDate = d => { const x = new Date(d + 'T12:00:00'); return x.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) + (x.getFullYear() !== new Date().getFullYear() ? ' ' + x.getFullYear() : ''); };
function hi(text, q) {
  const ws = sp(q).trim().split(/\s+/).filter(Boolean).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!ws.length) return esc(text);
  // matched on the text itself, then escaped piece by piece (never inside "&#39;")
  return String(text == null ? '' : text).split(new RegExp('(' + ws.join('|') + ')', 'gi')).map((x, n) => (n % 2 ? '<mark>' + esc(x) + '</mark>' : esc(x))).join('');
}
const view = () => ({ shift: HB.shift, cat: HB.cat, st: HB.st === 'urgent' ? 'all' : HB.st, sender: HB.sender, room: HB.room, q: HB.q, src: HB.src, group: HB.group });
const shown = list => (HB.st === 'urgent' ? list.filter(isUrgent) : list);
const idOf = (d, k) => d + '|' + k;
function itemHtml(i, day, opt) {
  opt = opt || {};
  const id = idOf(day, i.key), k = esc(i.key), d = esc(day), c = catOf(i.cat), st = i.status || 'info', q = HB.q;
  const a = (act, label, title, cls) => `<button type="button" class="${cls || 'hb-ib'}" data-hb="${act}" data-k="${k}" data-d="${d}"${title ? ` title="${esc(title)}" aria-label="${esc(title)}"` : ''}>${label}</button>`;
  if (opt.chat) return `<div class="hb-it" data-key="${k}"><span class="hb-av" style="--h:${hueOf(i.sender)};width:22px;height:22px;font-size:9px;margin-top:1px">${esc(initials(i.sender))}</span><div class="hb-bd"><div class="hb-tx">${hi(i.orig || i.text, q)}</div><div class="hb-meta"><span class="hb-who">${esc(i.sender || '—')}</span><span>${esc(t12(i.time))}</span>${i.learn === 'no' ? '<span title="Left out because it is like a message you removed before">🧠 learned</span>' : ''}</div></div><div class="hb-acts" style="opacity:1">${a('unchat', 'Add to handover', 'Add this to the handover', 'hb-q sm')}</div></div>`;
  const editing = HB.edit === id, menu = HB.menu === id, noting = HB.note === id, orig = HB.orig === id;
  const diff = i.orig && sp(i.orig).trim() !== sp(i.text).trim();
  const ckTitle = st === 'done' ? 'Done — tap to reopen' : 'Mark as done';
  let tx = editing ? `<textarea class="hb-ed" id="hbEdit" rows="1" data-k="${k}" data-d="${d}" aria-label="Edit the item">${esc(i.text || i.orig || '')}</textarea><div class="hb-hint">Enter saves · Esc cancels${diff ? ' · <button type="button" class="hb-q sm" data-hb="retidy" data-k="' + k + '" data-d="' + d + '">✨ Tidy the original again</button>' : ''}</div>`
    : `<div class="hb-tx" data-hb="edit" data-k="${k}" data-d="${d}" title="Tap to edit">${i.head ? `<small>${esc(i.head)}</small>` : ''}${hi(i.text || i.orig || '', q)}</div>`;
  const stSeg = `<span class="hb-sts" role="group" aria-label="Status">${[['open', '⏳ Pending'], ['done', '✓ Done']].map(([v, l]) => `<button type="button" class="${st === v ? 'on ' + v : ''}" data-hb="setst" data-v="${v}" data-k="${k}" data-d="${d}" aria-pressed="${st === v}">${l}</button>`).join('')}</span>`;
  const meta = [
    stSeg,
    isUrgent(i) ? '<span class="hb-urg">Urgent</span>' : '',
    `<button type="button" class="hb-pill" style="--ch:${c.hue ?? CAT_HUE[c.id] ?? 215}" data-hb="menu" data-k="${k}" data-d="${d}" title="Change the category">${c.icon} ${esc(c.label)}</button>`,
    (i.rooms || []).map(r => `<button type="button" class="hb-rm" data-hb="room" data-r="${esc(r)}" title="Only room ${esc(r)}">${hi(r, q)}</button>`).join(''),
    (i.tags || []).map(t => `<span class="hb-tag">${esc(t)}</span>`).join(''),
    `<span class="hb-who"><span class="hb-av" style="--h:${hueOf(i.sender)}" aria-hidden="true">${esc(initials(i.sender))}</span>${hi(i.sender || '—', q)}</span>`,
    `<span>${opt.carry ? esc(dLong(i.date || day).replace(/ \d{4}$/, '')) + ', ' : ''}${esc(t12(i.time))}</span>`,
    i.src === 'copy' ? `<span title="Picked from ${esc(i.group || 'another group')} automatically">✨ Auto${i.group ? ' · ' + esc(i.group) : ''}</span>` : i.src === 'prefix' ? '<span title="Marked HO in WhatsApp">📌 HO</span>' : i.src === 'hand' ? '<span>✍️</span>' : '',
    i.edited ? '<span title="Edited in WhatsApp">✎</span>' : '',
    st === 'done' && i.doneBy ? `<span style="color:var(--hb-done)">✓ ${esc(i.doneBy)}${i.doneAt ? ' · ' + esc(t12(hhmmOf(i.doneAt))) : ''}</span>` : '',
  ].filter(Boolean).join('');
  const menuHtml = menu ? `<div class="hb-menu"><span class="lbl">Category</span>${CATS.map(x => `<button type="button" class="hb-chip${x[0] === i.cat ? ' on' : ''}" data-hb="setcat" data-c="${x[0]}" data-k="${k}" data-d="${d}">${x[2]} ${esc(x[1])}</button>`).join('')}
    <span class="lbl">Item</span>${st !== 'info' ? a('info', 'ℹ️ Just info (no action)', '', 'hb-chip') : ''}${diff || i.parts > 1 ? a('orig', orig ? 'Hide original' : '💬 Original', '', 'hb-chip') : ''}${a('note', '📝 Note', '', 'hb-chip')}${i.src !== 'hand' ? a('reject', '✕ Not handover', 'Move it to team chat', 'hb-chip warn') : ''}${a('del', '🗑 Delete', '', 'hb-chip warn')}</div>` : '';
  const noteHtml = noting ? `<input class="hb-in" id="hbNoteIn" data-k="${k}" data-d="${d}" maxlength="300" placeholder="Add a note — Enter saves" value="${esc(i.note || '')}" aria-label="Note">`
    : i.note ? `<div class="hb-note" data-hb="note" data-k="${k}" data-d="${d}">📝 ${hi(i.note, q)}${i.noteBy ? ` <span style="color:var(--text3)">— ${esc(i.noteBy)}</span>` : ''}</div>` : '';
  const origHtml = orig ? `<div class="hb-orig"><b>WhatsApp${i.parts > 1 ? ` · line ${i.part} of ${i.parts}` : ''}</b>${esc(i.orig || '')}${i.parts > 1 && i.full ? `<b style="margin-top:8px">The whole message</b>${esc(i.full)}` : ''}</div>` : '';
  return `<div class="hb-it ${esc(st)}${menu ? ' menu' : ''}" data-key="${k}">
    <button type="button" class="hb-ck" data-hb="check" data-k="${k}" data-d="${d}" title="${ckTitle}" aria-label="${ckTitle}" aria-pressed="${st === 'done'}">✓</button>
    <div class="hb-bd">${tx}<div class="hb-meta">${meta}</div>${i.ask ? `<div class="hb-askl">🧠 Is this a handover item? ${a('askyes', 'Yes, keep', '', 'hb-chip')}${a('askno', 'No, leave out', '', 'hb-chip warn')}</div>` : ''}${noteHtml}${origHtml}${menuHtml}</div>
    <div class="hb-acts">${a('edit', '✎', 'Edit the text')}${a('del', '🗑', 'Delete (you can undo)', 'hb-ib hb-del')}${a('menu', '⋯', 'More: category, note, info, original')}</div></div>`;
}
function shell() {
  const root = doc.getElementById('hbRoot'); if (!root) return;
  const S = SETTINGS(), d = HB.date, isT = d === today();
  root.innerHTML = `
    <header class="hb-hd"><div class="hb-ttl"><h1>Handover</h1>
      <div class="hb-sub"><button type="button" class="hb-arw" data-hb="prev" aria-label="Day before" title="Day before">‹</button><label class="hb-dl">${esc(isT ? 'Today · ' + longDate(d) : longDate(d))}<input type="date" id="hbDate" value="${esc(d)}" max="${esc(today())}" aria-label="Pick a day"></label><button type="button" class="hb-arw" data-hb="next" aria-label="Next day" title="Next day"${isT ? ' disabled' : ''}>›</button>${isT ? '' : '<button type="button" class="hb-q sm" data-hb="today">Today</button>'}</div></div>
      <div class="hb-hda"><button type="button" class="hb-pri" data-hb="xp" aria-expanded="${HB.xp}" aria-haspopup="true" title="Download the handover as Excel or PDF">Export ▾</button></div></header>
    ${HB.xp ? `<section class="hb-panel hb-xp" aria-label="Export"><h3>Export</h3>
      <div class="hb-tbr"><div class="hb-seg" role="group" aria-label="What to export">${[['seen', 'What I see'], ['all', 'Whole day']].map(([k, l]) => `<button type="button" data-hb="exp" data-v="${k}" class="${S.exp === k ? 'on' : ''}" aria-pressed="${S.exp === k}">${l}</button>`).join('')}</div>
        <span class="hb-hint" id="hbXpN"></span></div>
      <label class="hb-lbl"><input type="checkbox" id="hbOrig"${S.orig ? ' checked' : ''}> Add the original WhatsApp text as a column</label>
      <div class="hb-tbr"><button type="button" class="hb-pri sm" data-hb="xlsx">⬇ Excel</button><button type="button" class="hb-pri sm" data-hb="pdf">📄 PDF</button><button type="button" class="hb-q sm" data-hb="xp">Close</button></div></section>` : ''}
    <section class="hb-new" aria-label="New handover item">
      <div class="hb-newrow"><span class="hb-plus" aria-hidden="true">+</span><textarea id="hbNew" rows="1" maxlength="6000" placeholder="New handover item…" aria-label="New handover item">${esc(HB.draft)}</textarea>
        <div class="hb-newact"><select class="hb-mini" id="hbNewCat" aria-label="Category"><option value="">Auto</option>${CATS.map(c => `<option value="${c[0]}"${HB.draftCat === c[0] ? ' selected' : ''}>${c[2]} ${esc(c[1])}</option>`).join('')}</select><button type="button" class="hb-pri sm" data-hb="addsave" id="hbAddBtn">Add</button></div></div>
      <div class="hb-prev" id="hbNewPrev" aria-live="polite"></div>
      <div class="hb-newft"><button type="button" class="hb-q sm" data-hb="sugg">✨ From HotelOps today</button><span class="hb-hint">Type “512 early departure”, or paste a WhatsApp chat, an e-mail or a list.</span></div>
    </section>
    <div class="hb-strip" id="hbStrip"></div>
    <p class="hb-sum" id="hbSum"></p>
    <div class="hb-tb" id="hbTb">
      <div class="hb-tbr"><div class="hb-seg" id="hbShifts" role="group" aria-label="Shift"></div><div class="hb-seg" id="hbSt" role="group" aria-label="Status"></div></div>
      <div class="hb-tbr"><div class="hb-srch"><input type="search" id="hbQ" placeholder="Search, or a room number" value="${esc(HB.q)}" aria-label="Search the handover"></div><button type="button" class="hb-q sm" data-hb="more" aria-expanded="${HB.more}" id="hbMoreBtn">Filters</button></div>
      <div class="hb-chips" id="hbActive"></div>
      <div id="hbMore"></div>
    </div>
    <div id="hbCarry"></div>
    <div id="hbList"></div>
    <div id="hbChat"></div>`;
  autosize(doc.getElementById('hbNew'));
  body(); preview();
}
function moreHtml(all) {
  if (!HB.more) return '';
  const f = view(), cnt = patch => shown(filterItems(all, Object.assign({}, f, patch))).length;
  const senders = [...new Set(all.map(i => i.sender).filter(Boolean))].sort(), groups = [...new Set(all.map(i => i.group || '—'))].sort();
  return `<div class="hb-more">
    <div><label>Topic</label><div class="hb-chips"><button type="button" class="hb-chip${!HB.cat ? ' on' : ''}" data-hb="catf" data-v="">All <em>${cnt({ cat: '' })}</em></button>${CATS.filter(c => cnt({ cat: c[0] }) || HB.cat === c[0]).map(c => `<button type="button" class="hb-chip${HB.cat === c[0] ? ' on' : ''}" data-hb="catf" data-v="${c[0]}">${c[2]} ${esc(c[1])} <em>${cnt({ cat: c[0] })}</em></button>`).join('')}</div></div>
    <div class="hb-grid">
      <div><label for="hbSender">From</label><select class="hb-in" id="hbSender"><option value="">Everyone</option>${senders.map(n => `<option value="${esc(n)}"${n === HB.sender ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
      <div><label for="hbGroup">Group</label><select class="hb-in" id="hbGroup"><option value="">All groups</option>${groups.map(g => `<option value="${esc(g)}"${g === HB.group ? ' selected' : ''}>${esc(g === '—' ? 'Added here' : g)}</option>`).join('')}</select></div>
      <div><label>Source</label><div class="hb-seg">${[['all', 'All'], ['marked', 'Marked HO'], ['auto', 'Auto-picked']].map(([k, l]) => `<button type="button" data-hb="src" data-v="${k}" class="${HB.src === k ? 'on' : ''}">${l} <em>${cnt({ src: k })}</em></button>`).join('')}</div></div>
      <div><label>🧠 Learned</label><div class="hb-hint">${learnList().length ? `${learnList().filter(e => e.v === 'no').length} left out · ${learnList().filter(e => e.v === 'yes').length} kept <button type="button" class="hb-q sm" data-hb="forgetall">Forget all</button>` : 'Nothing yet. Remove what is not handover and I learn from it.'}</div></div>
      <div><label>Group by</label><div class="hb-seg">${[['time', 'Shift'], ['cat', 'Topic'], ['room', 'Room']].map(([k, l]) => `<button type="button" data-hb="by" data-v="${k}" class="${HB.by === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    </div></div>`;
}
function body() {
  safe(() => {
    const d = HB.date, raw = dayItems(d), all = raw.filter(i => !i.del && !i.chat), f = view();
    const cnt = patch => shown(filterItems(all, Object.assign({}, f, patch))).length;
    const set = (id, h) => { const el = doc.getElementById(id); if (el && el.innerHTML !== h) el.innerHTML = h; };
    set('hbShifts', [['all', 'All']].concat(SHIFT_BOUNDS.map(s => [s.id, s.label || s.id])).map(([k, l]) => `<button type="button" data-hb="shift" data-v="${k}" class="${HB.shift === k ? 'on' : ''}" aria-pressed="${HB.shift === k}">${esc(l)}<em>${cnt({ shift: k })}</em></button>`).join(''));
    set('hbSt', [['all', 'All'], ['open', 'Pending'], ['done', 'Done']].map(([k, l]) => `<button type="button" data-hb="st" data-v="${k}" class="${HB.st === k ? 'on' : ''}" aria-pressed="${HB.st === k}">${l}</button>`).join(''));
    // the summary strip (taps filter) and the written summary
    const base = filterItems(all, Object.assign({}, f, { st: 'all' })), S = summaryOf(base), urg = base.filter(isUrgent).length;
    set('hbStrip', [['open', S.open, 'Pending', 'var(--hb-open)'], ['done', S.done, 'Done', 'var(--hb-done)'], ['urgent', urg, 'Urgent', 'var(--hb-red)'], ['rooms', S.rooms, 'Rooms', 'var(--hb-info)']]
      .map(([k, v, l, c]) => `<button type="button" class="hb-stat${HB.st === k ? ' on' : ''}" style="--c:${c}" data-hb="stat" data-v="${k}" aria-pressed="${HB.st === k}"><b>${v}</b><span>${l}</span></button>`).join(''));
    set('hbSum', esc(writtenSummary(base)).replace(/^([^.]+\.)/, '<b>$1</b>'));
    const act = [];
    if (HB.room) act.push(`<button type="button" class="hb-chip on x" data-hb="clr" data-v="room">Room ${esc(HB.room)}</button>`);
    if (HB.room && W.hoRoom) act.push(`<button type="button" class="hb-chip" data-room-card="${esc(HB.room)}" title="Guest, notes and everything about room ${esc(HB.room)}">🛏️ Room card</button>`);
    if (HB.cat) act.push(`<button type="button" class="hb-chip on x" data-hb="clr" data-v="cat">${esc(catOf(HB.cat).label)}</button>`);
    if (HB.sender) act.push(`<button type="button" class="hb-chip on x" data-hb="clr" data-v="sender">${esc(HB.sender)}</button>`);
    if (HB.group) act.push(`<button type="button" class="hb-chip on x" data-hb="clr" data-v="group">${esc(HB.group === '—' ? 'Added here' : HB.group)}</button>`);
    if (HB.src !== 'all') act.push(`<button type="button" class="hb-chip on x" data-hb="clr" data-v="src">${HB.src === 'auto' ? 'Auto-picked' : 'Marked HO'}</button>`);
    set('hbActive', act.join(''));
    const mb = doc.getElementById('hbMoreBtn'); if (mb) { mb.textContent = 'Filters' + (act.length ? ' · ' + act.length : ''); mb.setAttribute('aria-expanded', HB.more); }
    set('hbMore', moreHtml(all));
    // still open from the day before
    const prev = dayAdd(d, -1), P = carryItems(d, f);
    // 🤔 "Done" replies we could not place: ask which item they close
    const Q = itemsOf(d).filter(i => Array.isArray(i.doneQ) && i.doneQ.length && !i.del && !i.doneQa && !noAsked(i.qmsg));
    const qHtml = Q.map(q => {
      const opts = q.doneQ.map(ref => { const [dd, kk] = String(ref).split('|'); const it = itemsOf(dd).find(x => x.key === kk); return it && it.status !== 'done' ? { ref, it } : null; }).filter(Boolean);
      if (!opts.length) return '';
      return `<div class="hb-askl" style="flex-direction:column;align-items:stretch;margin:0 0 10px"><div>🤔 <b>${esc(q.sender || 'Someone')}</b> said “${esc(q.text)}”${q.quote ? ` replying to “${esc(String(q.quote).slice(0, 80))}”` : ''} — which item is done?</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">${opts.map(o => `<button type="button" class="hb-chip" data-hb="doneq" data-k="${esc(q.key)}" data-d="${esc(d)}" data-v="${esc(o.ref)}">✓ ${esc(String(o.it.text || o.it.orig).slice(0, 60))}</button>`).join('')}<button type="button" class="hb-chip warn" data-hb="doneq" data-k="${esc(q.key)}" data-d="${esc(d)}" data-v="">None of these</button></div></div>`;
    }).join('');
    set('hbCarry', qHtml + (P.length ? `<section class="hb-sec hb-carry"><button type="button" class="hb-gh" data-hb="fold" data-v="carry" aria-expanded="${!HB.fold.carry}">⏳ Still open from ${prev === dayAdd(today(), -1) ? 'yesterday' : esc(dLong(prev))} <em>${P.length}</em><span class="chev">▾</span></button>${HB.fold.carry ? '' : `<div class="hb-list">${P.map(i => itemHtml(i, prev, { carry: true })).join('')}</div>`}</section>` : ''));
    // the day, grouped
    const L = shown(filterItems(all, f)).sort((a, b) => (HB.by === 'time' ? 0 : (isUrgent(b) - isUrgent(a))) || byTime(a, b));
    let html = '';
    if (!L.length) html = `<div class="hb-empty"><b>${all.length ? '🔍' : '📒'}</b>${all.length ? 'Nothing matches these filters.' : d === today() ? '<strong>No handover yet today.</strong><br>Messages from your WhatsApp handover group (named like “HO - Hotel”), messages starting with “HO -” in any group, and handover-like messages from other groups land here by themselves. Or type one above.' : 'No handover saved for this day.'}</div>`;
    else {
      const groups = [];
      const gkey = i => HB.by === 'cat' ? i.cat : HB.by === 'room' ? ((i.rooms || [])[0] ? 'Room ' + String(parseInt(i.rooms[0], 10)) : 'No room') : (i.prevNight ? 'Night0' : sectionOf(i).k || 'No time');
      L.forEach(i => { const g = gkey(i); let G = groups.find(x => x.k === g); if (!G) { G = { k: g, items: [] }; groups.push(G); } G.items.push(i); });
      if (HB.by === 'cat') groups.sort((a, b) => CATS.findIndex(c => c[0] === a.k) - CATS.findIndex(c => c[0] === b.k));
      if (HB.by === 'time') groups.sort((a, b) => SECTION_ORDER.indexOf(a.k === 'No time' ? '' : a.k) - SECTION_ORDER.indexOf(b.k === 'No time' ? '' : b.k));
      if (HB.by === 'room') groups.sort((a, b) => (a.k === 'No room') - (b.k === 'No room') || (parseInt(a.k.slice(5), 10) || 0) - (parseInt(b.k.slice(5), 10) || 0));
      html = groups.map(G => {
        const fk = HB.by + ':' + G.k, open = !HB.fold[fk], sb = SHIFT_BOUNDS.find(s => s.id === G.k.replace(/0$/, ''));
        const label = HB.by === 'cat' ? catOf(G.k).icon + ' ' + catOf(G.k).label : sb ? sb.icon + ' ' + sectionOf(G.items[0]).label + (hoursOf(G.items) ? ' · ' + hoursOf(G.items) : '') : G.k;
        const no = G.items.filter(i => i.status === 'open').length;
        return `<section class="hb-sec"><button type="button" class="hb-gh" data-hb="fold" data-v="${esc(fk)}" aria-expanded="${open}">${esc(label)} <em>${G.items.length}${no ? ' · ' + no + ' pending' : ''}</em><span class="chev">▾</span></button>${open ? `<div class="hb-list">${G.items.map(i => itemHtml(i, i.prevNight ? i.date : d, { carry: !!i.prevNight })).join('')}</div>` : ''}</section>`;
      }).join('');
    }
    set('hbList', html);
    xpCount();
    // team chat in the handover group (not added)
    const C = raw.filter(i => i.chat && !i.del && !i.prevNight).sort(byTime);
    set('hbChat', C.length ? `<section class="hb-sec hb-chatl"><button type="button" class="hb-gh" data-hb="chat" aria-expanded="${HB.chat}">💬 Team chat — not added <em>${C.length}</em><span class="chev">▾</span></button>${HB.chat ? `<div class="hb-list">${C.map(i => itemHtml(i, d, { chat: true })).join('')}</div>` : ''}</section>` : '');
    const ed = doc.getElementById('hbEdit'); if (ed && doc.activeElement !== ed) { autosize(ed); ed.focus(); ed.setSelectionRange(ed.value.length, ed.value.length); }
    const ni = doc.getElementById('hbNoteIn'); if (ni && doc.activeElement !== ni) ni.focus();
  });
}
function autosize(t) { if (!t) return; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight + 2, 240) + 'px'; }
// ── the "New handover item" field: live preview; several lines (a pasted chat, an e-mail) become a checklist ──
function preview() {
  safe(() => {
    const box = doc.getElementById('hbNewPrev'); if (!box) return;
    const t = HB.draft, c = HB.draftCat;
    if (HB.rowsKind === 'sugg' && HB.rows) { box.innerHTML = rowsHtml('From HotelOps today — tick what goes in the handover'); syncAdd(); return; }
    if (!t.trim()) { HB.rows = null; HB.rowsKind = ''; box.innerHTML = ''; syncAdd(); return; }
    const rows = pasteItems(t, { parseCopied: typeof W.hoWaParseCopied === 'function' ? W.hoWaParseCopied : null });
    const old = HB.rows || [];
    HB.rows = rows.map(r => { const was = old.find(o => o.text === r.text); return Object.assign(r, { on: was ? was.on : !r.chat, cat: c || categorize(r.text, r.head) }); });
    HB.rowsKind = 'paste';
    if (HB.rows.length === 1) {
      const r = HB.rows[0], C = catOf(r.cat), rooms = roomsOf(r.text);
      box.innerHTML = `<div class="hb-pv"><span class="tx">✨ ${esc(tidy(r.text))} <span class="hb-pill" style="--ch:${C.hue ?? CAT_HUE[C.id] ?? 215}">${C.icon} ${esc(C.label)}</span>${rooms.map(x => ` <span class="hb-rm">${esc(x)}</span>`).join('')}${isUrgent({ orig: r.text, status: 'open' }) ? ' <span class="hb-urg">Urgent</span>' : ''}</span></div>`;
    } else box.innerHTML = rowsHtml(`${HB.rows.length} items found — untick what should not go in`);
    syncAdd();
  });
}
function rowsHtml(title) {
  const R = HB.rows || [];
  if (!R.length) return `<div class="hb-hint">${HB.rowsKind === 'sugg' ? 'Nothing open in HotelOps right now. 👌' : 'Nothing to add.'}</div>`;
  return `<div class="hb-hint" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">${esc(title)}<button type="button" class="hb-q sm" data-hb="rowsall">${R.every(r => r.on) ? 'Untick all' : 'Tick all'}</button>${HB.rowsKind === 'sugg' ? '<button type="button" class="hb-q sm" data-hb="rowsclose">Close</button>' : ''}</div>`
    + R.map((r, i) => { const C = catOf(r.cat); return `<label class="hb-pv${r.on ? '' : ' off'}"><input type="checkbox" data-hb-row="${i}"${r.on ? ' checked' : ''}><span class="tx">${esc(tidy(r.text))} <span class="hb-pill" style="--ch:${C.hue ?? CAT_HUE[C.id] ?? 215}">${C.icon} ${esc(C.label)}</span>${r.sender || r.time || r.from ? `<small>${esc([r.from, r.sender, r.time ? t12(r.time) : '', r.date && r.date !== HB.date ? dLong(r.date) : ''].filter(Boolean).join(' · '))}${r.chat ? ' · looks like chat' : ''}</small>` : r.chat ? '<small>looks like chat</small>' : ''}</span></label>`; }).join('');
}
function syncAdd() { const b = doc.getElementById('hbAddBtn'); if (!b) return; const n = HB.rows ? HB.rows.filter(r => r.on).length : 0; b.textContent = n > 1 ? `Add ${n}` : 'Add'; b.disabled = !n; }
function addNow() {
  const R = (HB.rows || []).filter(r => r.on);
  if (!R.length) { const t = doc.getElementById('hbNew'); if (t) t.focus(); return; }
  const day = HB.rowsKind === 'sugg' ? today() : HB.date;
  const n = addItems(R.map(r => ({ text: (r.head ? r.head + ': ' : '') + r.text, sender: r.sender || '', time: r.time || '', date: HB.rowsKind === 'sugg' ? today() : r.date || day, cat: HB.draftCat || (HB.rowsKind === 'sugg' ? r.cat : ''), src: r.sender ? 'hand' : 'hand', from: r.from || '' })), day);
  HB.draft = ''; HB.rows = null; HB.rowsKind = '';
  const t = doc.getElementById('hbNew'); if (t) { t.value = ''; autosize(t); t.focus(); }
  preview(); body();
  toast(`Added ${n} item${n === 1 ? '' : 's'} to the handover`, 'ok');
}
function suggestions() {
  const hk = safe(() => (W.hoWaBrain && typeof W.hoWaBrain.openRequests === 'function' ? W.hoWaBrain.openRequests() : []), []);
  const ls = p => safe(() => (typeof lsLoad === 'function' ? lsLoad(p) : null), null);
  const rooms = safe(() => (typeof depRooms !== 'undefined' && Array.isArray(depRooms) ? depRooms : []), []);
  const have = new Set(itemsOf(today()).concat(itemsOf(HB.date)).map(i => sp(i.text).toLowerCase()));
  return suggestFrom({ rooms, hk, mt: ls('opslogs/mt') || {}, lf: ls('opslogs/lf') || {}, now: new Date() }).filter(s => !have.has(tidy(s.text).toLowerCase()));
}
// ── Excel ──
function xpCount() { const el = doc.getElementById('hbXpN'); if (!el) return; const n = exportList(SETTINGS().exp === 'all').length; el.textContent = n + ' item' + (n === 1 ? '' : 's'); }
function exportList(all) {
  const d = HB.date, f = view();
  const L = all ? dayItems(d).filter(i => !i.del && !i.chat) : shown(filterItems(dayItems(d), f));
  // pending items from yesterday go with it, so nothing open is lost at the change of day
  const C = carryItems(d, all ? {} : f).filter(c => !L.some(x => x.date === c.date && x.key === c.key));
  return C.concat(L);
}
/** the .xlsx as bytes (styled when the zip tools are there), or null when Excel is not loaded */
function workbookBytes(list) {
  if (typeof XLSX === 'undefined' || !XLSX.utils) return null;
  const S = SETTINGS(), rows = excelRows(list, { orig: S.orig }), sum = summaryRows(list, HB.date, hotel());
  sum.rows.splice(1, 0, [writtenSummary(list)]);
  sum.bold = sum.bold.map(n => (n > 1 ? n + 1 : n));
  const wb = XLSX.utils.book_new(), ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = COL_W.slice(0, rows[0].length).map(w => ({ wch: w }));
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, rows.length - 1), c: rows[0].length - 1 } }) };
  const ws2 = XLSX.utils.aoa_to_sheet(sum.rows); ws2['!cols'] = [{ wch: 26 }, { wch: 10 }, { wch: 12 }, { wch: 70 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, ws, ('Handover ' + dLong(HB.date)).slice(0, 31));
  XLSX.utils.book_append_sheet(wb, ws2, 'Summary');
  let out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  // bold header with a light fill, the first row frozen, Item / Note wrapped (SheetJS community writes no styles)
  safe(() => {
    const C = XLSX.CFB; if (!C || typeof TextDecoder === 'undefined') return;
    const z = C.read(new Uint8Array(out), { type: 'array' }), dec = new TextDecoder(), enc = new TextEncoder();
    const get = p => C.find(z, '/' + p), txt = e => dec.decode(e.content), put = (e, s) => { e.content = enc.encode(s); e.size = e.content.length; };
    const sty = get('xl/styles.xml'), s1 = get('xl/worksheets/sheet1.xml'), s2 = get('xl/worksheets/sheet2.xml');
    if (!sty || !s1) return;
    const P = polishStyles(txt(sty)); if (P.head < 0) return;
    put(sty, P.xml);
    put(s1, polishSheet(txt(s1), { head: P.head, wrap: P.wrap, boldRows: [1], wrapCols: ['G', 'J', 'K'], freeze: true }));
    if (s2) put(s2, polishSheet(txt(s2), { head: P.head, wrap: P.wrap, boldRows: sum.bold, wrapCols: ['A', 'D'] }));
    out = C.write(z, { fileType: 'zip', type: 'array' });
  });
  return out;
}
function download(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = doc.createElement('a'); a.href = url; a.download = name; doc.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}
// ── the pro report: ExcelJS, loaded from cdnjs only when exporting (SheetJS file when it cannot load) ──
const EXCELJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
let exLoading = null;
function loadExcelJS() {
  if (W.ExcelJS && W.ExcelJS.Workbook) return Promise.resolve(W.ExcelJS);
  if (exLoading) return exLoading;
  exLoading = new Promise((ok, no) => {
    const sc = doc.createElement('script'); sc.src = EXCELJS_URL; sc.async = true; sc.crossOrigin = 'anonymous';
    const t = setTimeout(() => no(new Error('timeout')), 12000);
    sc.onload = () => { clearTimeout(t); W.ExcelJS && W.ExcelJS.Workbook ? ok(W.ExcelJS) : no(new Error('no ExcelJS')); };
    sc.onerror = () => { clearTimeout(t); no(new Error('not loaded')); };
    doc.head.appendChild(sc);
  }).catch(e => { exLoading = null; throw e; });
  return exLoading;
}
const brandArgb = () => safe(() => { const cs = getComputedStyle(doc.documentElement); return argbOf(cs.getPropertyValue('--gold')) || argbOf(cs.getPropertyValue('--accent')); }, '') || XL.accent;
/** the styled .xlsx (ExcelJS) → bytes */
async function proWorkbook(list) {
  const EJ = await loadExcelJS();
  const S = SETTINGS(), M = reportModel(list, { hotel: hotel(), date: HB.date, user: me(), exportedAt: Date.now(), orig: S.orig }), brand = brandArgb();
  const wb = new EJ.Workbook(); wb.creator = 'HotelOps'; wb.created = new Date(); wb.title = M.title;
  const thin = { style: 'thin', color: { argb: XL.line } }, box = { top: thin, left: thin, bottom: thin, right: thin };
  const fill = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
  const font = (o) => Object.assign({ name: 'Calibri', size: 11, color: { argb: XL.ink } }, o);
  // the title block: title, date line, written summary, KPI tiles → returns the next free row
  function titleBlock(ws, nCols) {
    const last = ws.getColumn(nCols).letter;
    ws.mergeCells(`A1:${last}1`); const t = ws.getCell('A1'); t.value = M.title; t.font = font({ size: 20, bold: true }); t.alignment = { vertical: 'middle' };
    ws.getRow(1).height = 34;
    ws.mergeCells(`A2:${last}2`); const m = ws.getCell('A2'); m.value = M.meta; m.font = font({ size: 10.5, color: { argb: XL.sub } }); m.alignment = { vertical: 'middle' };
    ws.getRow(2).height = 18;
    for (let c = 1; c <= nCols; c++) ws.getCell(2, c).border = { bottom: { style: 'medium', color: { argb: brand } } };
    ws.mergeCells(`A3:${last}3`); const su = ws.getCell('A3'); su.value = M.summary; su.font = font({ size: 11, italic: true, color: { argb: 'FF334155' } }); su.alignment = { wrapText: true, vertical: 'middle' };
    ws.getRow(3).height = rowHeight([M.summary], [M.head.length ? Math.max(60, ws.columns.slice(0, nCols).reduce((x, c) => x + (c.width || 10), 0)) : 100], 22);
    // KPI tiles: value row + label row, each tile over a share of the columns
    const per = Math.max(1, Math.floor(nCols / M.kpis.length));
    M.kpis.forEach(([label, v, k], i) => {
      const c1 = i * per + 1, c2 = i === M.kpis.length - 1 ? nCols : c1 + per - 1, col = XL_KPI[k] || XL_KPI.ink;
      if (c2 > c1) { ws.mergeCells(5, c1, 5, c2); ws.mergeCells(6, c1, 6, c2); }
      const vc = ws.getCell(5, c1), lc = ws.getCell(6, c1);
      vc.value = v; vc.font = font({ size: 18, bold: true, color: { argb: col[1] } }); vc.alignment = { horizontal: 'center', vertical: 'middle' };
      lc.value = label.toUpperCase(); lc.font = font({ size: 8.5, bold: true, color: { argb: XL.sub } }); lc.alignment = { horizontal: 'center', vertical: 'top' };
      for (let c = c1; c <= c2; c++) { ws.getCell(5, c).fill = fill(col[0]); ws.getCell(6, c).fill = fill(col[0]); ws.getCell(5, c).border = { top: { style: 'thin', color: { argb: XL.white } }, left: { style: 'thick', color: { argb: XL.white } }, right: { style: 'thick', color: { argb: XL.white } } }; ws.getCell(6, c).border = { left: { style: 'thick', color: { argb: XL.white } }, right: { style: 'thick', color: { argb: XL.white } } }; }
    });
    ws.getRow(4).height = 8; ws.getRow(5).height = 28; ws.getRow(6).height = 15; ws.getRow(7).height = 10;
    return 8;
  }
  function headRow(ws, r, labels) {
    const row = ws.getRow(r); row.values = labels; row.height = 24;
    labels.forEach((_, i) => { const c = row.getCell(i + 1); c.font = font({ bold: true, color: { argb: XL.white } }); c.fill = fill(XL.slate); c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; c.border = { top: { style: 'thin', color: { argb: XL.slate } }, bottom: { style: 'thin', color: { argb: XL.slate } }, left: { style: 'thin', color: { argb: 'FF334155' } }, right: { style: 'thin', color: { argb: 'FF334155' } } }; });
  }
  function page(ws, headR, land) {
    ws.pageSetup = { paperSize: 9, orientation: land ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
      margins: { left: 0.25, right: 0.25, top: 0.45, bottom: 0.55, header: 0.2, footer: 0.25 }, printTitlesRow: headR ? `${headR}:${headR}` : undefined };
    ws.headerFooter = { oddFooter: `&L&8${M.footer.replace(/&/g, '&&')}&R&8Page &P of &N`, evenFooter: `&L&8${M.footer.replace(/&/g, '&&')}&R&8Page &P of &N` };
  }
  // ── sheet 1: the handover ──
  const ws = wb.addWorksheet(('Handover ' + dLong(HB.date)).slice(0, 31), { properties: { tabColor: { argb: brand } }, views: [{ showGridLines: false }] });
  const n = M.head.length;
  ws.columns = M.widths.map(w => ({ width: w }));
  const H = titleBlock(ws, n);
  headRow(ws, H, M.head);
  let r = H + 1, z = 0;
  const C = { status: 8, cat: 5, rooms: 6, item: 7, note: 10, time: 3 };
  M.sections.forEach(sec => {
    ws.mergeCells(r, 1, r, n);
    const sc = ws.getCell(r, 1); sc.value = `${sec.label.toUpperCase()}${sec.hours ? ' (' + sec.hours + ')' : ''}   ·   ${sec.count} item${sec.count === 1 ? '' : 's'}${sec.open ? ' · ' + sec.open + ' pending' : ''}`;
    sc.font = font({ bold: true, size: 10.5, color: { argb: 'FF334155' } }); sc.alignment = { vertical: 'middle', indent: 1 };
    for (let c = 1; c <= n; c++) { const x = ws.getCell(r, c); x.fill = fill(XL.band); x.border = { top: thin, bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } }; }
    ws.getRow(r).height = 20; r++; z = 0;
    sec.rows.forEach(R => {
      const row = ws.getRow(r); row.values = R.cells;
      const zebra = z++ % 2 === 1;
      R.cells.forEach((_, i) => {
        const c = row.getCell(i + 1);
        c.border = box; c.alignment = { vertical: 'top', wrapText: i + 1 === C.item || i + 1 === C.note || i + 1 === 11, horizontal: [1, 2, 3, C.rooms, C.status].includes(i + 1) ? 'center' : 'left' };
        c.font = font({ size: 10.5, color: { argb: R.done ? 'FF64748B' : XL.ink } });
        if (zebra) c.fill = fill(XL.zebra);
      });
      const st = statusStyle(R.status), cs = catStyle(R.cat);
      Object.assign(row.getCell(C.status), { fill: fill(st.fill), font: font({ size: 10, bold: true, color: { argb: st.font } }) });
      Object.assign(row.getCell(C.cat), { fill: fill(cs.fill), font: font({ size: 10, color: { argb: cs.font } }) });
      row.getCell(C.rooms).font = font({ size: 10.5, bold: true });
      if (R.urgent) {
        row.getCell(C.item).font = font({ size: 10.5, bold: true, color: { argb: XL.red } });
        row.getCell(1).border = Object.assign({}, box, { left: { style: 'thick', color: { argb: 'FFDC2626' } } });
      }
      if (R.done) row.getCell(C.item).font = font({ size: 10.5, color: { argb: 'FF64748B' }, strike: false });
      row.height = rowHeight([R.cells[C.item - 1], R.cells[C.note - 1], R.cells[10] || ''], [M.widths[C.item - 1], M.widths[C.note - 1], M.widths[10] || 40], 20);
      r++;
    });
  });
  if (!M.sections.length) { ws.mergeCells(r, 1, r, n); ws.getCell(r, 1).value = 'No handover items.'; ws.getCell(r, 1).font = font({ italic: true, color: { argb: XL.sub } }); r++; }
  ws.autoFilter = { from: { row: H, column: 1 }, to: { row: Math.max(H, r - 1), column: n } };
  ws.views = [{ state: 'frozen', ySplit: H, xSplit: 0, topLeftCell: `A${H + 1}`, activeCell: `A${H + 1}`, showGridLines: false }];
  page(ws, H, true);
  // ── sheet 2: the summary ──
  const s2 = wb.addWorksheet('Summary', { properties: { tabColor: { argb: XL.slate } }, views: [{ showGridLines: false }] });
  s2.columns = [{ width: 26 }, { width: 11 }, { width: 11 }, { width: 11 }, { width: 62 }, { width: 18 }];
  let q = titleBlock(s2, 6);
  const table = (title, head, rows, total, styleRow) => {
    s2.mergeCells(q, 1, q, head.length); const tc = s2.getCell(q, 1); tc.value = title; tc.font = font({ bold: true, size: 13 }); s2.getRow(q).height = 22; q++;
    headRow(s2, q, head); const first = q + 1; q++;
    rows.forEach((cells, k) => {
      const row = s2.getRow(q); row.values = cells;
      cells.forEach((_, i) => { const c = row.getCell(i + 1); c.border = box; c.font = font({ size: 10.5 }); c.alignment = { vertical: 'top', wrapText: i === 4, horizontal: i >= 1 && i <= 3 ? 'center' : 'left' }; if (k % 2) c.fill = fill(XL.zebra); });
      if (styleRow) styleRow(row, k); q++;
    });
    if (total) { const row = s2.getRow(q); row.values = total; total.forEach((_, i) => { const c = row.getCell(i + 1); c.font = font({ bold: true }); c.border = { top: { style: 'medium', color: { argb: XL.slate } }, bottom: thin }; c.alignment = { horizontal: i ? 'center' : 'left' }; }); q++; }
    if (rows.length > 1) s2.addConditionalFormatting({ ref: `B${first}:B${first + rows.length - 1}`, rules: [{ type: 'dataBar', cfvo: [{ type: 'num', value: 0 }, { type: 'max' }], color: { argb: 'FF60A5FA' }, gradient: false }] });
    q++;
  };
  table('By category', ['Category', 'Items', 'Pending', 'Done'], M.byCat.map(x => [x.label, x.items, x.open, x.done]), ['Total', M.totals.items, M.totals.open, M.totals.done],
    (row, k) => { const cs = catStyle(M.byCat[k].cat); row.getCell(1).fill = fill(cs.fill); row.getCell(1).font = font({ size: 10.5, color: { argb: cs.font } }); });
  table('By shift', ['Shift', 'Items', 'Pending', 'Done'], M.byShift.map(x => [x.label, x.items, x.open, x.done]), ['Total', M.totals.items, M.totals.open, M.totals.done]);
  if (M.open.length) table('Pending items', ['Category', 'Time', 'Rooms', '', 'Item', 'From'], M.open.map(o => [o.cells[0], o.cells[1], o.cells[2], o.urgent ? 'URGENT' : '', o.cells[3], o.cells[4]]), null,
    (row, k) => { const o = M.open[k], cs = catStyle(o.cat); row.getCell(1).fill = fill(cs.fill); row.getCell(1).font = font({ size: 10.5, color: { argb: cs.font } }); row.getCell(3).font = font({ size: 10.5, bold: true });
      if (o.urgent) { row.getCell(4).font = font({ size: 9, bold: true, color: { argb: XL.red } }); row.getCell(4).fill = fill(XL.redFill); row.getCell(5).font = font({ size: 10.5, bold: true, color: { argb: XL.red } }); }
      row.height = rowHeight([o.cells[3]], [62], 18); });
  else { s2.getCell(q, 1).value = 'Nothing pending — a clean handover.'; s2.getCell(q, 1).font = font({ italic: true, color: { argb: 'FF065F46' } }); }
  page(s2, 0, false);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
async function exportExcel(silent) {
  const S = SETTINGS(), list = exportList(S.exp === 'all'), name = fileName(hotel(), HB.date);
  if (!list.length) { toast('Nothing to export for ' + (S.exp === 'all' ? 'this day' : 'these filters'), 'warn'); return null; }
  let bytes = null, pro = false;
  try { bytes = await proWorkbook(list); pro = true; } catch (e) { safe(() => console.warn('[handover-book] styled Excel not available, plain file instead:', e && e.message)); }
  if (!bytes) bytes = safe(() => workbookBytes(list), null);
  if (!bytes) { toast('Excel is not loaded (offline?) — try again in a moment', 'warn'); return null; }
  download(bytes, name);
  if (!silent) toast(`⬇ ${name} · ${list.length} item${list.length === 1 ? '' : 's'}${pro ? '' : ' (simple layout — offline)'}`, 'ok');
  safe(() => { if (typeof logActivity === 'function') logActivity('handover_export', `${name} (${list.length})`); });
  return { name, list, pro };
}
function exportPdf() {
  const S = SETTINGS(), list = exportList(S.exp === 'all');
  if (!list.length) { toast('Nothing to export for ' + (S.exp === 'all' ? 'this day' : 'these filters'), 'warn'); return null; }
  if (typeof mePrintPage !== 'function') { toast('The PDF helper did not load. Reload the page.', 'warn'); return null; }
  const m = reportModel(list, { hotel: hotel(), date: HB.date, user: me(), exportedAt: Date.now(), orig: !!S.orig });
  const win = mePrintPage(fileName(hotel(), HB.date).replace(/\.xlsx$/i, ''), pdfHtml(m), { landscape: true });
  if (win) { toast('📄 PDF page opened: press "Print / Save as PDF"', 'ok'); safe(() => { setTimeout(() => { try { win.print(); } catch (_) {} }, 600); }); }
  safe(() => { if (typeof logActivity === 'function') logActivity('handover_export', `PDF (${list.length})`); });
  return win;
}
// ── taps ──
function saveEdit(el) {
  const k = el.dataset.k, d = el.dataset.d, v = sp(el.value).trim().slice(0, 1000), it = itemsOf(d).find(i => i.key === k);
  HB.edit = '';
  if (it && v && v !== it.text) { learnWords(it.text, v); setField(d, k, { text: v, textBy: me() }); } else body();
}
function removeItem(d, k, how) {
  const it = itemsOf(d).find(i => i.key === k); if (!it) return;
  if (how === 'reject') setField(d, k, { chat: 1, chatBy: me() });
  else setField(d, k, { del: 1, delBy: me(), delAt: Date.now() });
  // 🧠 an item that came by itself (WhatsApp, auto-picked) and is removed: messages like it are not handover
  const lk = it.src !== 'hand' && it.status !== 'done' ? learn(it.orig || it.text, 'no') : '';
  const back = () => { unlearn(lk); setField(d, k, how === 'reject' ? { chat: null, chatBy: me() } : { del: null, delBy: null, delAt: null }); return true; };
  const msg = (how === 'reject' ? 'Moved to team chat' : 'Item deleted') + (lk ? ' · 🧠 I\'ll leave out messages like this' : '');
  if (typeof showUndoToast === 'function') safe(() => showUndoToast(msg, back, 7000)); else toast(msg, 'info');
}
function onClick(e) {
  safe(() => {
    const rowCk = e.target.closest && e.target.closest('[data-hb-row]');
    if (rowCk) { const r = (HB.rows || [])[+rowCk.dataset.hbRow]; if (r) { r.on = rowCk.checked; rowCk.closest('.hb-pv').classList.toggle('off', !r.on); syncAdd(); } return; }
    const b = e.target.closest && e.target.closest('[data-hb]'); if (!b) { if (HB.menu && !e.target.closest('.hb-it')) { HB.menu = ''; body(); } return; }
    const a = b.dataset.hb, k = b.dataset.k, d = b.dataset.d || HB.date, id = idOf(d, k);
    const item = k ? itemsOf(d).find(i => i.key === k) : null;
    switch (a) {
      case 'prev': HB.date = dayAdd(HB.date, -1); HB.edit = HB.menu = HB.note = ''; render(); return;
      case 'next': if (HB.date < today()) { HB.date = dayAdd(HB.date, 1); HB.edit = HB.menu = HB.note = ''; render(); } return;
      case 'today': HB.date = today(); render(); return;
      case 'shift': HB.shift = b.dataset.v; body(); return;
      case 'st': HB.st = b.dataset.v; body(); return;
      case 'stat': { const v = b.dataset.v; if (v === 'rooms') { HB.by = HB.by === 'room' ? 'time' : 'room'; LS.set(VIEW_KEY, { by: HB.by }); } else HB.st = HB.st === v ? 'all' : v; body(); return; }
      case 'catf': HB.cat = b.dataset.v; body(); return;
      case 'src': HB.src = b.dataset.v; body(); return;
      case 'by': HB.by = b.dataset.v; LS.set(VIEW_KEY, { by: HB.by }); body(); return;
      case 'more': HB.more = !HB.more; body(); return;
      case 'clr': HB[b.dataset.v] = b.dataset.v === 'src' ? 'all' : ''; body(); return;
      case 'fold': HB.fold[b.dataset.v] = !HB.fold[b.dataset.v]; body(); return;
      case 'chat': HB.chat = !HB.chat; body(); return;
      case 'room': HB.room = HB.room === b.dataset.r ? '' : b.dataset.r; body(); return;
      case 'xp': HB.xp = !HB.xp; shell(); return;
      case 'exp': { const S = SETTINGS(); S.exp = b.dataset.v; LS.set(SET_KEY, S); doc.querySelectorAll('#hbRoot [data-hb="exp"]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }); xpCount(); return; }
      case 'xlsx': exportExcel(); return;
      case 'pdf': exportPdf(); return;
      case 'addsave': addNow(); return;
      case 'sugg': { const L = suggestions(); HB.rows = L.map(s => ({ text: s.text, head: '', cat: s.cat, from: s.src, on: false })); HB.rowsKind = 'sugg'; preview(); return; }
      case 'rowsall': { const on = !(HB.rows || []).every(r => r.on); (HB.rows || []).forEach(r => { r.on = on; }); preview(); return; }
      case 'rowsclose': HB.rows = null; HB.rowsKind = ''; preview(); return;
      case 'edit': if (item && !e.target.closest('a,button.hb-rm,mark')) { HB.edit = id; HB.menu = ''; body(); safe(() => { const t = doc.getElementById('hbEdit'); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } }); } return;
      case 'menu': HB.menu = HB.menu === id ? '' : id; body(); return;
      case 'note': HB.note = HB.note === id ? '' : id; HB.menu = ''; body(); return;
      case 'orig': HB.orig = HB.orig === id ? '' : id; body(); return;
      case 'forgetall': if (confirm('Forget everything the Handover Book learned from your removals?')) { Object.keys(LEARN).forEach(forget); toast('Forgotten', 'ok'); body(); } return;
    }
    if (!item) return;
    if (a === 'check') {
      if (item.status === 'done') setField(d, k, { status: 'open', doneBy: null, doneAt: null });
      else { setField(d, k, { status: 'done', doneBy: me(), doneAt: Date.now() }); safe(() => { const ck = b; if (ck.animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) ck.animate([{ transform: 'scale(.6)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 320, easing: 'cubic-bezier(.2,.9,.3,1.4)' }); }); }
    } else if (a === 'setst') {
      const v = b.dataset.v, nv = item.status === v ? 'info' : v;      // tap the lit one again: back to plain info
      setField(d, k, nv === 'done' ? { status: 'done', doneBy: me(), doneAt: Date.now() } : { status: nv, doneBy: null, doneAt: null });
      if (nv !== 'done' && item.status !== 'done' && nv !== item.status) learnField(item.orig || item.text, 'st', nv);   // pending ↔ info: how things like this start
      HB.menu = '';
    } else if (a === 'todo') { setField(d, k, { status: 'open', doneBy: null, doneAt: null }); HB.menu = ''; }
    else if (a === 'info') { setField(d, k, { status: 'info', doneBy: null, doneAt: null }); learnField(item.orig || item.text, 'st', 'info'); HB.menu = ''; }
    else if (a === 'setcat') { setField(d, k, { cat: b.dataset.c, catBy: me() }); if (b.dataset.c !== item.cat) learnField(item.orig || item.text, 'cat', b.dataset.c); HB.menu = ''; }
    else if (a === 'retidy') { const el = doc.getElementById('hbEdit'); if (el) { el.value = tidy(item.orig || el.value); autosize(el); el.focus(); } return; }
    else if (a === 'doneq') {
      const ref = b.dataset.v;
      if (ref) { const [dd, kk] = ref.split('|'); setField(dd, kk, { status: 'done', doneBy: item.sender || me(), doneAt: item.at || Date.now(), doneVia: 'WhatsApp reply' }); toast('✓ Marked done', 'ok'); }
      setField(d, k, { doneQa: ref || 'none' });
      if (!ref) { rememberNoAsk(item.qmsg); toast('🧠 Got it — I won\'t ask about that message again', 'ok'); }
    }
    else if (a === 'unchat') { setField(d, k, { chat: null, chatBy: me(), learn: null }); learn(item.orig || item.text, 'yes'); toast('Added to the handover · 🧠 I\'ll keep messages like this', 'ok'); }
    else if (a === 'askyes') { setField(d, k, { ask: null, learn: 'yes' }); learn(item.orig || item.text, 'yes'); toast('🧠 Got it — messages like this are handover', 'ok'); }
    else if (a === 'askno') { setField(d, k, { ask: null, chat: 1, chatBy: me(), learn: 'no' }); learn(item.orig || item.text, 'no'); toast('🧠 Got it — I\'ll leave out messages like this', 'ok'); }
    else if (a === 'reject' || a === 'del') { HB.menu = ''; removeItem(d, k, a); }
    body();
  });
}
function mountPage() {
  if (doc.getElementById('panel-' + PANEL)) return true;
  const main = doc.querySelector('main.main') || doc.querySelector('main'), nav = doc.querySelector('nav.sidenav') || doc.querySelector('nav');
  if (!main || !nav) return false;
  const st = doc.createElement('style'); st.id = 'hb-page-style'; st.textContent = PCSS; doc.head.appendChild(st);
  const panel = doc.createElement('div'); panel.className = 'panel'; panel.id = 'panel-' + PANEL;
  panel.innerHTML = `<div id="hbRoot"></div>`;
  main.appendChild(panel);
  panel.addEventListener('click', onClick);
  panel.addEventListener('input', e => safe(() => {
    const t = e.target;
    if (t.id === 'hbQ') { HB.q = t.value; clearTimeout(HB.qt); HB.qt = setTimeout(body, 110); }
    else if (t.id === 'hbNew') { HB.draft = t.value; autosize(t); if (HB.rowsKind === 'sugg') { HB.rows = null; HB.rowsKind = ''; } clearTimeout(HB.pt); HB.pt = setTimeout(preview, 140); }
    else if (t.id === 'hbEdit') autosize(t);
  }));
  panel.addEventListener('change', e => safe(() => {
    const t = e.target;
    if (t.id === 'hbDate') { const v = t.value; if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { HB.date = v > today() ? today() : v; render(); } }
    else if (t.id === 'hbSender') { HB.sender = t.value; body(); }
    else if (t.id === 'hbGroup') { HB.group = t.value; body(); }
    else if (t.id === 'hbNewCat') { HB.draftCat = t.value; preview(); }
    else if (t.id === 'hbOrig') { const S = SETTINGS(); S.orig = !!t.checked; LS.set(SET_KEY, S); }
  }));
  panel.addEventListener('keydown', e => safe(() => {
    const t = e.target;
    if (t.id === 'hbNew' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); addNow(); }
    else if (t.id === 'hbNew' && e.key === 'Escape') { t.value = ''; HB.draft = ''; autosize(t); preview(); }
    else if (t.id === 'hbEdit' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); saveEdit(t); }
    else if (t.id === 'hbEdit' && e.key === 'Escape') { e.preventDefault(); HB.edit = ''; body(); }
    else if (t.id === 'hbNoteIn' && e.key === 'Enter') { e.preventDefault(); const v = sp(t.value).trim().slice(0, 300); setField(t.dataset.d, t.dataset.k, { note: v || null, noteBy: v ? me() : null }); HB.note = ''; body(); }
    else if (t.id === 'hbNoteIn' && e.key === 'Escape') { HB.note = ''; body(); }
    else if (e.key === 'Escape' && HB.menu) { HB.menu = ''; body(); }
  }));
  panel.addEventListener('focusout', e => safe(() => { if (e.target.id === 'hbEdit' && HB.edit) setTimeout(() => { const el = doc.getElementById('hbEdit'); if (el && doc.activeElement !== el && !(doc.activeElement && doc.activeElement.dataset && doc.activeElement.dataset.hb === 'retidy')) saveEdit(el); }, 150); }));
  // the frosted toolbar gets a hairline once it sticks
  safe(() => { main.addEventListener('scroll', () => { const tb = doc.getElementById('hbTb'); if (tb && panel.classList.contains('active')) tb.classList.toggle('stuck', tb.getBoundingClientRect().top <= main.getBoundingClientRect().top + 1); }, { passive: true }); });
  const item = doc.createElement('div');
  item.className = 'nav-item'; item.id = 'nav-' + PANEL; item.dataset.panel = PANEL; item.setAttribute('onclick', "showPanel('" + PANEL + "')");
  item.innerHTML = '<div class="nav-icon">📒</div>Handover Book';
  const anchor = doc.getElementById('nav-ops-logs') || doc.getElementById('nav-shifts');
  if (anchor && anchor.parentNode) anchor.after(item); else nav.appendChild(item);
  const grid = doc.querySelector('.mob-more-grid');
  if (grid) {
    const b = doc.createElement('button'); b.className = 'mob-more-item'; b.dataset.panel = PANEL; b.type = 'button';
    b.setAttribute('onclick', "showPanel('" + PANEL + "');(typeof closeMobMore==='function'?closeMobMore:typeof toggleMobMore==='function'?toggleMobMore:function(){})()");
    b.innerHTML = '<span class="mob-item-icon">📒</span>Handover Book';
    const after = grid.querySelector('.mob-more-item[data-panel="ops-logs"]') || grid.querySelector('.mob-more-item[data-panel="shifts"]');
    if (after) after.after(b); else grid.appendChild(b);
  }
  if (typeof hoApplyIcons === 'function') safe(() => hoApplyIcons());
  safe(() => {
    if (typeof ROLES !== 'undefined') Object.keys(ROLES).forEach(r => { const p = ROLES[r] && ROLES[r].panels; if (p && p.includes('shifts') && !p.includes(PANEL)) p.push(PANEL); });
    if (typeof currentProfile !== 'undefined' && currentProfile && typeof applyRole === 'function') applyRole(currentProfile.role);
  });
  let wasOn = false;
  new MutationObserver(() => { const on = panel.classList.contains('active'); if (on && !wasOn) render(); wasOn = on; }).observe(panel, { attributes: true, attributeFilter: ['class'] });
  return true;
}
let softT = 0;
function soon() {
  clearTimeout(softT);
  softT = setTimeout(() => safe(() => {
    if (!doc.getElementById('panel-' + PANEL)?.classList.contains('active')) return;
    if (HB.edit || (doc.activeElement && doc.activeElement.id === 'hbNoteIn')) { clearTimeout(softT); softT = setTimeout(soon, 1500); return; }   // never redraw under a typing hand
    body();
  }), 120);
}
async function render() {
  const my = ++HB.seq;
  if (!HB.date) HB.date = today();
  const root = doc.getElementById('hbRoot');
  if (root && !root.firstChild) root.innerHTML = '<div class="hb-empty">Loading the handover…</div>';
  await Promise.all([load(HB.date), load(dayAdd(HB.date, -1))]).catch(() => {});
  if (my !== HB.seq) return;
  if (doc.getElementById('hbNew')) { const t = doc.getElementById('hbNew'); HB.draft = t.value; }
  shell();
}
// ── the shift handover (handover.js): open items from the Handover Book ──
function wrapHandover() {
  const o = W._hoTodo;
  if (typeof o !== 'function' || o.__hb) return;
  const f = function () {
    const L = o.apply(this, arguments);
    safe(() => {
      const open = itemsOf(today()).concat(itemsOf(dayAdd(today(), -1))).filter(i => !i.del && i.status === 'open').sort(byTime);
      if (open.length && Array.isArray(L)) L.push({ icon: '📒', head: `Handover Book: ${open.length} open`, items: open.slice(0, 10).map(i => `${t12(i.time)} · ${i.text || i.orig} (${i.sender || '—'})`).concat(open.length > 10 ? [`…and ${open.length - 10} more on the Handover Book page`] : []) });
    });
    return L;
  };
  f.__hb = true; f.__wab = o.__wab; W._hoTodo = f;
}
function start() {
  safe(mountPage);
  listenToday(); safe(listenLearn);
  setTimeout(() => safe(drain), 1500);
  [700, 2500, 6000].forEach(t => setTimeout(() => safe(wrapHandover), t));
  setInterval(() => safe(() => { if (listenDay !== today()) listenToday(); }), 60e3);
}
W.hoHandoverBook = { fromWa, noAsked, rememberNoAsk, addByHand, addItems, suggestions: () => suggestions(), items: day => itemsOf(day || today()), load, render: () => render(), excel: () => exportExcel(), proBytes: list => proWorkbook(list || exportList(true)), workbookBytes: list => workbookBytes(list || itemsOf(HB.date || today())), state: () => HB };
if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
})();
