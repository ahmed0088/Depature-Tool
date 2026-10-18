// ═══════════════════════════════════════════════════════════
//  wa-bridge.js — WhatsApp HK group → Departures
//
//  "324 CO"          → room 324 checked out (as the card's Check out button)
//                       (also C/O, checkout, checked out, chkout, out, left, vacated, departed, "CO 324")
//  "202 LCO 6PM"     → room 202 late check-out at 18:00 (also late co, late checkout, L/C, "late till 6pm")
//  "0113 EXT 2N"     → room 0113 extended 2 nights (as the card's Extend button); also
//                       ext/extend/extended/extension, "+2N", "ext till 22", "ext to 22 Oct"
//  "415 change bed"  → a note on room 415 ("324 out of order", "324 CO tomorrow" are notes too)
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
//  Pure helpers: hoWaParse(text), hoWaParseCopied(text), hoWaTime(s), hoWaPure.*.
//  The parser (hoWaParser) is also baked into the console snippet, so both read alike.
//  Load after departures.js (best after undo.js).
// ═══════════════════════════════════════════════════════════
(function () {
'use strict';
const W = typeof window !== 'undefined' ? window : globalThis;
const doc = typeof document !== 'undefined' ? document : null;

// ══ Parser (pure) ═══════════════════════════════════════════
// Self-contained on purpose: HotelOps puts this function's own source into the WhatsApp console
// snippet (hoWaPure.snippet), so the window on WhatsApp Web reads messages exactly like the app.
function hoWaParser() {
  'use strict';
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
  // a time written clearly (so "324 CO 2 pax" stays a check-out, "324 checkout 2pm" becomes a note)
  const timeStrict = s => /\b\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m|p\.m)\b|\b\d{1,2}:\d{2}\b/i.test(sp(s));

  const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const NUMW = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  // the app's own posts (summaries, not commands)
  const IGNORE_LINE = l => /^\s*🔁/u.test(l) || /Extensions\s*[—–-]/.test(l) || /\d{3,4}\s*·\s*\+\d+\s*N\s*→/.test(l);
  const ROOM = '(?:(?:rooms?|rms?|rn)\\.?\\s*(?:no\\.?\\s*)?|#\\s*)?(\\d{3,4})(?![\\d]|[:.]\\d)';
  const ROOM_AT = new RegExp('^' + ROOM, 'i');
  const ROOM_NC = ROOM.replace('(\\d{3,4})', '(?:\\d{3,4})');
  const SPLIT = new RegExp('[,;]\\s*(?=' + ROOM_NC + ')', 'i');
  const SEP = /^\s*(?:,|&|\+|\/|-|\band\b|\s)\s*/i;
  const FILLER = /^(?:done|now|already|just|also|ok|okay|pls|please|plz|thanks?|thank\s*you|thx|sir|maam|ma'am|guys|team|hk|fo|room|rooms|hotel|is|are|has|have|the|guest|guests|[✅👍✔☑🙏.!,;:\s\u{1F3FB}-\u{1F3FF}])*$/iu;
  // words before the command: "324 guest has checked out", "324 already CO"
  const LEAD = /^(?:(?:the\s+)?guests?|gst|has|have|is|was|already|just|now|been|all)\s+/i;
  const CO_NOT = /^(?:of\b|time|at\b|by\b|after|before|in\s|on\s|date|day\b|plan|req)/i;
  const WHEN_NOT = /\?|\b(?:tomorrow|tomm?orr?ow|tmrw|tmr|tmw|tmrow|tomoro|later|pending|maybe|might|wants?|wanted|asking|asks?|asked|requests?|requested|requesting|req|not|cancel(?:led|ed)?|planning|plans?|will|soon|expected|possible|next)\b/i;
  const LCO_W = '(?:lco|l\\.c\\.o\\.?|l\\/co|l\\/c|l\\.c\\.?|lc|late\\s*(?:ch(?:ec)?k[\\s-]*out|checkout|c\\/o|c\\.o\\.?|co))';
  const CO_W = '(?:co|c\\/o|c\\.o\\.?|c-o|ch(?:ec)?k(?:e?d)?[\\s-]*out)';
  const EXT_W = '(?:ext|extd|extn|extnd|exten|extend|extended|extending|extension|extention)';
  const CMD_LEAD = new RegExp('^(' + LCO_W + '|' + EXT_W + '|' + CO_W + ')(?![a-z])\\.?\\s*[:\\-–—]?\\s*(?=' + ROOM_NC + '(?!\\s*(?:am|pm|hrs?|h)\\b))', 'i');

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
  /** "22", "22nd", "22/10", "22-10", "22 Oct", "Oct 22" → "22" | "22/10" | '' */
  function dayOf(s) {
    let m;
    if ((m = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s*[\/.\-]\s*(\d{1,2})\b/))) return okDay(+m[1], +m[2]);
    if ((m = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/))) return okDay(+m[1], MON.indexOf(m[2]) + 1);
    if ((m = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*(\d{1,2})(?:st|nd|rd|th)?\b/))) return okDay(+m[2], MON.indexOf(m[1]) + 1);
    return '';
  }
  const okDay = (d, mo) => (d >= 1 && d <= 31 && (!mo || (mo >= 1 && mo <= 12)) ? d + (mo ? '/' + mo : '') : '');
  /** what comes after "ext": nights or a new date. null = not an extension we can trust (a note) */
  function extDetail(tail) {
    const t = tail.replace(/^[\s:\-–—=>.,+]+/, ' ').replace(/[\s.!,;]+$/, '').toLowerCase();
    if (/\b(?:till|until|untill|til|to|upto|up\s*to)\s+(?:tomorrow|tomm?orr?ow|tmrw|tmr|tmw)\b/.test(t)) return { nights: 1 };
    if (WHEN_NOT.test(t)) return null;
    let m;
    const nw = '(\\d{1,2}|' + Object.keys(NUMW).join('|') + ')';
    if ((m = t.match(new RegExp('(?:^|[\\s+])' + nw + '\\s*(?:more\\s+|extra\\s+)?(?:n|nt|nts|ngt|ngts|nite|nites|nights?|days?)\\b')))) { const n = NUMW[m[1]] || +m[1]; return n >= 1 && n <= 90 ? { nights: n } : null; }
    if ((m = t.match(/^\s*(?:for\s+)?(\d{1,2})\s*$/)) || (m = t.match(/^\s*\+\s*(\d{1,2})\b/))) {
      const n = +m[1]; if (n >= 1 && n <= 14) return { nights: n };
      const d = okDay(n, 0); return d ? { until: d } : null;
    }
    const d = dayOf(t);
    if (d) return { until: d };
    if ((m = t.match(/\b(?:till|until|untill|til|to|upto|up\s*to|on|→|->)\s*(\d{1,2})(?:st|nd|rd|th)?\b/))) { const d2 = okDay(+m[1], 0); return d2 ? { until: d2 } : null; }
    return FILLER.test(t) || /^(?:stay|the\s+stay|booking|confirmed|paid|ok)?\s*$/.test(t.trim()) ? {} : null;
  }
  function classify(rest) {
    let r = sp(rest).trim().replace(/^[\s:\-–—=>.,]+/, '').replace(/[\s.!,;]+$/, '').trim();
    if (!r) return null;
    const note = { act: 'note', note: r };
    let low = r.toLowerCase(), m;
    while (LEAD.test(low)) low = low.replace(LEAD, '');
    if ((m = low.match(new RegExp('^' + LCO_W + '(?![a-z])\\s*(.*)$')))) {
      if (/\?|\b(?:cancel\w*|tomorrow|tomm?orr?ow|tmrw|tmr|tmw)\b/.test(m[1])) return note;
      return { act: 'lco', time: hoWaTime(m[1]) };
    }
    if ((m = low.match(/^late\s*(?:till|until|untill|til|to|up\s*to|upto|by|at)\s*(.+)$/)) || ((m = low.match(/^late\s+(.+)$/)) && timeStrict(m[1]))) {
      const tm = hoWaTime(m[1]); if (tm) return { act: 'lco', time: tm };
    }
    if ((m = low.match(new RegExp('^' + EXT_W + '(?![a-z])\\.?\\s*(.*)$')))) {
      const x = extDetail(m[1]); return x ? Object.assign({ act: 'ext' }, x) : note;
    }
    if ((m = low.match(/^\+\s*(\d{1,2})\s*(?:n|nt|nts|nights?)\b\s*(.*)$/))) {
      const n = +m[1]; return n >= 1 && n <= 90 && !WHEN_NOT.test(m[2]) ? { act: 'ext', nights: n } : note;
    }
    if ((m = low.match(new RegExp('^' + CO_W + '(?![a-z])\\s*(.*)$')))) {
      const tail = m[1].trim();
      if (!tail || FILLER.test(tail)) return { act: 'co' };
      if (!CO_NOT.test(tail) && !WHEN_NOT.test(tail) && !timeStrict(tail)) return { act: 'co' };
      return note;
    }
    // words that mean "gone" only when nothing else follows ("324 out of order", "324 left luggage" are notes)
    if ((m = low.match(/^(?:out|left|vacated|vacated\s+the\s+room|departed)(?![a-z])\s*(.*)$/)) && FILLER.test(m[1].trim())) return { act: 'co' };
    return note;
  }

  /**
   * One WhatsApp message → { kind: 'ignore'|'none'|'act', actions: [{room, act:'co'|'lco'|'ext'|'note', time?, nights?, until?, note?}] }
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
      let lineCmd = null;
      // "202 CO, 205 LCO 2pm": a comma before another room starts a new part
      line.trim().split(SPLIT).forEach(seg => {
        seg = seg.trim();
        let cmd = '';
        const cm = seg.match(CMD_LEAD);                       // the command first: "CO 324", "EXT 0113 2N"
        if (cm) { cmd = cm[1]; seg = seg.slice(cm[0].length); }
        const { rooms, rest } = takeRooms(seg);
        let c = classify(cmd ? cmd + ' ' + rest : rest);
        if (cmd) lineCmd = c;
        else if (!c && rooms.length && lineCmd) c = lineCmd;  // "CO 324, 325"
        if (rooms.length && !c) { pending = pending.concat(rooms); return; }
        if (!c) return;
        const target = pending.concat(rooms); pending = [];
        if (target.length) { add(target, c); lastNote = c.act === 'note' ? actions.filter(a => a.act === 'note' && target.includes(a.room)) : null; }
        else if (lastNote && lastNote.length) lastNote.forEach(a => { a.note += ' ' + seg.replace(/[\s.!,;]+$/, ''); });   // a note's next line
      });
    });
    return { kind: actions.length ? 'act' : 'none', actions };
  }
  function actionKey(a) {
    const x = a.act === 'ext' ? (a.nights ? a.nights + 'n' : a.until || '') : (a.time || '');
    return [String(parseInt(a.room, 10)), a.act, x, a.note || ''].join(':');
  }
  const dayLabel = d => d.getDate() + ' ' + MON[d.getMonth()].replace(/^./, c => c.toUpperCase());
  const untilLabel = u => { const p = String(u || '').split('/'); return p[1] ? p[0] + ' ' + MON[+p[1] - 1].replace(/^./, c => c.toUpperCase()) : p[0]; };
  /** an extension → {nights, date, guessed} from the room's departure day (base), or null when the date makes no sense */
  function extNights(a, base) {
    const b = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    let n = a.nights || 0, guessed = false;
    if (!n && a.until) {
      const p = String(a.until).split('/').map(Number);
      let t = new Date(b.getFullYear(), p[1] ? p[1] - 1 : b.getMonth(), p[0]);
      if (!p[1] && t <= b) t = new Date(b.getFullYear(), b.getMonth() + 1, p[0]);
      if (p[1] && t < b && b - t > 60 * 864e5) t = new Date(b.getFullYear() + 1, p[1] - 1, p[0]);
      n = Math.round((t - b) / 864e5);
    }
    if (!n && !a.until) { n = 1; guessed = true; }
    if (!(n >= 1 && n <= 90)) return null;
    const d = new Date(b); d.setDate(d.getDate() + n);
    return { nights: n, date: d, label: dayLabel(d), guessed };
  }
  /** a short chip for one action: "✓ CO 324", "⏰ LCO 202 6 PM", "↪ EXT 0113 +2N", "📝 note 415" */
  function chip(a) {
    if (a.act === 'co') return '✓ CO ' + a.room;
    if (a.act === 'lco') return '⏰ LCO ' + a.room + (a.time ? ' ' + timeLabel(a.time) : '');
    if (a.act === 'ext') return '↪ EXT ' + a.room + (a.nights ? ' +' + a.nights + 'N' : '') + (a.until ? ' → ' + untilLabel(a.until) : '');
    return '📝 note ' + a.room;
  }
  return { sp, hoWaTime, timeLabel, hoWaParse, actionKey, extNights, chip, dayLabel, untilLabel };
}
const HP = hoWaParser();
const { sp, hoWaTime, timeLabel, hoWaParse, actionKey } = HP;

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
// ══ Chat backup + search (pure) ═════════════════════════════
// The hotel keeps every HK message it receives: waChat/{YYYY-MM-DD}/{key} = {t:'09:01', s:'Sam', x:'324 CO', r:'co 324', m?:1, e?:1}
// (r = what HotelOps did: "co 324 · lco 202 6 PM · ext 0113 +2N → 22 Oct · note 415", "none", "ignore", "skip 324", "notlist 999"; no r = not acted on)
/** a Firebase-safe key for a WhatsApp message id (no . # $ [ ] / or control characters) */
function safeKey(id) { return String(id == null ? '' : id).replace(/[.#$\[\]\/\x00-\x1f\x7f]/g, '_').slice(0, 140) || '_'; }
/** a short key for a message with no WhatsApp id (pasted text): a hash of day|time|sender|text */
function hashKey(s) { s = String(s); let h = 5381, g = 7; for (let i = 0; i < s.length; i++) { h = ((h << 5) + h + s.charCodeAt(i)) | 0; g = (g * 31 + s.charCodeAt(i)) | 0; } return 'p' + (h >>> 0).toString(36) + (g >>> 0).toString(36); }
/** results of one message → the compact r string */
function archR(res) { return res.map(r => [r.st, r.room || '', r.d || ''].filter(Boolean).join(' ')).join(' · '); }
const R_LABEL = { co: '✓ CO', lco: '⏰ LCO', ext: '↪ EXT', note: '📝 note', notlist: '⚠ not on list', skip: '· skipped', none: '— no room', ignore: '— HotelOps post' };
/** r → chips [{st, label}] */
function archChips(r) {
  if (!r) return [{ st: 'none', label: '— not acted on (not from that day)' }];
  return String(r).split(' · ').map(p => { const st = p.split(' ')[0], rest = p.slice(st.length).trim(); return { st, label: (R_LABEL[st] || st) + (rest ? ' ' + rest : '') }; });
}
function searchTokens(q) { return sp(q).toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8); }
/** "324" finds room 324 and 0324, not 1324; other words are found anywhere (case-insensitive) */
function tokenRe(t, flags) {
  if (/^\d{3,4}$/.test(t)) return new RegExp('(?<!\\d)0*' + parseInt(t, 10) + '(?!\\d)', flags || '');
  return new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), (flags || '') + 'i');
}
/** does one record match every word of the search? */
function hoWaMatch(rec, q) {
  const toks = Array.isArray(q) ? q : searchTokens(q);
  if (!toks.length) return true;
  const hay = [rec.x || '', rec.s || '', rec.r || ''].join('\n');
  return toks.every(t => tokenRe(t).test(hay));
}
/** {day: {key: rec}} → [{day, key, rec}] matching q, newest day first, in chat order within a day */
function hoWaSearch(days, q) {
  const toks = searchTokens(q), out = [];
  Object.keys(days || {}).sort().reverse().forEach(day => {
    const recs = days[day] || {};
    Object.keys(recs).map(key => ({ day, key, rec: recs[key] })).filter(o => o.rec && typeof o.rec === 'object' && hoWaMatch(o.rec, toks))
      .sort((a, b) => String(a.rec.t || '').localeCompare(String(b.rec.t || '')) || a.key.localeCompare(b.key)).forEach(o => out.push(o));
  });
  return out;
}
const escH = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** text → safe HTML with the searched words in <mark> */
function hoWaHi(text, q) {
  text = String(text == null ? '' : text);
  const toks = Array.isArray(q) ? q : searchTokens(q), spans = [];
  toks.forEach(t => { const re = tokenRe(t, 'g'); let m; while ((m = re.exec(text))) { if (!m[0].length) { re.lastIndex++; continue; } spans.push([m.index, m.index + m[0].length]); } });
  spans.sort((a, b) => a[0] - b[0]);
  let out = '', at = 0;
  spans.forEach(([a, b]) => { if (b <= at) return; a = Math.max(a, at); out += escH(text.slice(at, a)) + '<mark>' + escH(text.slice(a, b)) + '</mark>'; at = b; });
  return out + escH(text.slice(at));
}
/** "09:01" → "9:01 AM"; "2026-10-18" → "18/10/2026" */
const t12 = t => { const m = String(t || '').match(/^(\d{1,2}):(\d{2})$/); if (!m) return t || ''; const h = +m[1]; return (h % 12 || 12) + ':' + m[2] + (h >= 12 ? ' PM' : ' AM'); };
const dmy = d => String(d).split('-').reverse().join('/');
/** results → WhatsApp's own text format (HotelOps can read it back with Paste) */
const chrono = list => list.slice().sort((a, b) => a.day.localeCompare(b.day) || String(a.rec.t || '').localeCompare(String(b.rec.t || '')));
function hoWaExportTxt(list) { return chrono(list).map(o => `[${t12(o.rec.t)}, ${dmy(o.day)}] ${o.rec.s || ''}: ${o.rec.x || ''}`).join('\n') + '\n'; }
/** results → CSV for Excel (with a BOM so Arabic and emoji show right) */
function hoWaExportCsv(list) {
  const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const rows = [['Date', 'Time', 'Sender', 'Message', 'What HotelOps did']].concat(chrono(list).map(o => [dmy(o.day), t12(o.rec.t), o.rec.s || '', o.rec.x || '', archChips(o.rec.r).map(c => c.label).join(' · ') + (o.rec.u ? ' (undone)' : '')]));
  return '\ufeff' + rows.map(r => r.map(q).join(',')).join('\r\n') + '\r\n';
}
/** the backup file name: "HK chat 2026-10-01 to 2026-10-18.txt" */
function hoWaExportName(from, to, ext) { return 'HK chat ' + (from === to || !to ? from : from + ' to ' + to) + '.' + ext; }

/** the console snippet, ready to paste: this app's address and the parser filled in */
function snippet(raw, appUrl) {
  return String(raw).replace("'__HO_APP_URL__'", () => JSON.stringify(appUrl)).replace('/*__HO_PARSER__*/null', () => '(' + hoWaParser.toString() + ')()');
}
W.hoWaPure = { hoWaParse, hoWaParseCopied, hoWaTime, timeLabel, waDateISO, waTime24, actionKey, extNights: HP.extNights, chip: HP.chip, snippet,
  safeKey, hashKey, archR, archChips, hoWaMatch, hoWaSearch, hoWaHi, hoWaExportTxt, hoWaExportCsv, hoWaExportName };
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

// ══ Chat backup (hotel database) ════════════════════════════
const ARCH = {};           // day → {key: rec}, loaded (fbGet) or written this session
let IDX = null, IDX_AT = 0; // waChatIdx: {day: true}, loaded for "All"
let archQ = {}, archT = null;
const isDay = d => /^\d{4}-\d{2}-\d{2}$/.test(d);
/** queue one message for waChat/{day}; partial: only text fields (keeps what was done on an earlier save) */
function archive(day, key, rec, partial) {
  if (!isDay(day)) return;
  const q = archQ[day] = archQ[day] || {};
  if (partial) {
    if (q[key]) Object.assign(q[key], rec);
    else Object.keys(rec).forEach(f => { q[key + '/' + f] = rec[f]; });
    if (ARCH[day]) ARCH[day][key] = Object.assign({}, ARCH[day][key], rec);
  } else {
    Object.keys(q).forEach(k => { if (k.indexOf(key + '/') === 0) delete q[k]; });
    q[key] = rec; if (ARCH[day]) ARCH[day][key] = rec;
  }
  if (IDX) IDX[day] = true;
  clearTimeout(archT); archT = setTimeout(flushArch, 400);
}
function flushArch() {
  const q = archQ; archQ = {}; clearTimeout(archT);
  const ds = Object.keys(q); if (!ds.length) return;
  if (typeof fbUpdate === 'function') {
    ds.forEach(day => { try { Promise.resolve(fbUpdate('waChat/' + day, q[day])).catch(() => {}); } catch (_) {} });
    const idx = {}; ds.forEach(d => { idx[d] = true; });
    try { Promise.resolve(fbUpdate('waChatIdx', idx)).catch(() => {}); } catch (_) {}
  }
  if (doc.getElementById('waQ')) runSearch(true);
}
/** one received message → its backup record */
function archiveMsg(msg, day, text, sender, r, partial) {
  const t = waTime24(msg.time) || (day === today() ? hhmm() : '');
  const key = msg.id ? safeKey(msg.id) : hashKey(day + '|' + t + '|' + sender.toLowerCase() + '|' + normS(text));
  const rec = { t, s: sender, x: text.slice(0, 2000) };
  if (!partial) { if (r) rec.r = r; if (msg.mine) rec.m = 1; }
  if (msg.edited) rec.e = 1;
  archive(day, key, rec, partial);
  return key;
}

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
  if (!status && z.status === 'extended' && typeof depSyncExtToLog === 'function') try { depSyncExtToLog(rooms().indexOf(z)); } catch (_) {}
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
    res.st = 'lco'; res.d = a.time ? timeLabel(a.time) : ''; res.text = `${room} late check-out ${a.time ? timeLabel(a.time) : '(no time)'}`;
  } else if (a.act === 'ext') {
    if (st === 'out') return Object.assign(res, { st: 'skip', text: `${room}: already checked out — not extended` });
    let base = null; try { base = typeof parseOperaDate === 'function' ? parseOperaDate(r.departure) : null; } catch (_) {}
    if (!base || isNaN(base)) { base = new Date(); }
    const x = HP.extNights(a, base);
    if (!x) return Object.assign(res, { st: 'skip', text: `${room}: could not read the new date — not changed` });
    const what = `+${x.nights}N → ${x.label}`;
    if (st === 'extended') {
      if (x.guessed || (r.extensionNights || 1) === x.nights) return Object.assign(res, { st: 'skip', text: `${room}: already extended` });
      line = `[${hhmm()}] Extension changed to ${what} — ${who}`;
      addNoteLine(r, line); r.extensionNights = x.nights;
      try { if (typeof depSyncExtToLog === 'function') depSyncExtToLog(i); } catch (_) {}
      paint(); saveDeps();
    } else {
      line = `[${hhmm()}] Extended ${what}${x.guessed ? ' (nights not said)' : ''} — ${who}`;
      addNoteLine(r, line); setStatus = 'extended';
      quiet(() => depAction(i, 'extended', x.nights));
    }
    res.st = 'ext'; res.d = what; res.text = `Extended ${room} (${what})` + (x.guessed ? ' · nights not said, check the card' : '');
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
  if (dIso !== tIso) { if (text.trim()) archiveMsg(msg, dIso, text, sender, '', true); return 'old'; }
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
    if (!actions.length) { done[id] = P.actions.map(actionKey).join('|'); done[ck] = ''; saveDone(done); archiveMsg(msg, dIso, text, sender, '', true); return 'dup'; }
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
  const akey = archiveMsg(Object.assign({}, msg, { edited }), dIso, text, sender, archR(res));
  let undoAll = null;
  if (undos.length) {
    undoAll = once(() => { let ok = false; undos.slice().reverse().forEach(u => { try { if (u()) ok = true; } catch (_) {} }); if (ok) { entry.undone = true; saveLog(); archive(dIso, akey, { u: 1 }, true); renderCard(); } return ok; });
    undoFns[key] = undoAll;
  }
  if (opt.batch) { opt.batch.undos.push(undoAll); res.forEach(r => { opt.batch.n[r.st] = (opt.batch.n[r.st] || 0) + 1; }); }
  else {
    const acted = res.filter(r => r.undo);
    if (acted.length && typeof showUndoToast === 'function') {
      const lbl = acted.length === 1 ? acted[0].text.replace(/ · (?:⚠|nights not said).*/, '').replace(/^(\d+)/, 'Room $1') : acted.map(r => r.text.replace(/ · ⚠.*/, '')).join(' · ');
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
  if (n.ext) parts.push(`${n.ext} extended`);
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
#waOv{position:fixed;inset:0;z-index:9000;display:flex;align-items:flex-start;justify-content:center;padding:6vh 16px 6vh;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;background:rgba(0,0,0,.55);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);animation:waFade .16s ease}
#waOv[hidden]{display:none}
#waOv #waCard{margin:0 auto auto;width:min(760px,100%);flex:none;overflow:visible;box-shadow:0 24px 60px -20px rgba(0,0,0,.6);animation:waUp .2s ease}
#waOv #waCard>summary{cursor:default;flex:none}
#waOv #waCard>summary:hover{background:transparent}
#waOv #waCard>summary{position:sticky;top:-6vh;z-index:2;background:var(--card);border-radius:var(--r,12px) var(--r,12px) 0 0;border-bottom:1px solid var(--border)}
#waCard .wa-x{margin-left:auto;flex:none;width:34px;height:34px;border-radius:9px;border:1px solid var(--border);background:var(--card2,var(--bg2));color:var(--text2);cursor:pointer;font-size:14px}
#waCard .wa-x:hover{color:var(--text);border-color:var(--accent-border,var(--border))}
@keyframes waFade{from{opacity:0}to{opacity:1}}
@keyframes waUp{from{opacity:0;transform:translateY(10px) scale(.985)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){#waOv,#waOv #waCard{animation:none}}
@media (max-width:600px){#waOv{padding:10px}#waOv #waCard>summary{top:-10px}}
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
#waCard .wa-chip.ext{color:var(--sky,#38bdf8);border-color:color-mix(in srgb,var(--sky,#38bdf8) 40%,transparent)}
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
#waCard .wa-find{display:grid;gap:8px}
#waCard .wa-q{display:flex;align-items:center;gap:8px;background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:0 11px;transition:border-color .15s}
#waCard .wa-q:focus-within{border-color:var(--accent)}
#waCard .wa-q span{font-size:13px;opacity:.7}
#waCard .wa-q input{flex:1;min-width:0;width:auto;height:auto;margin:0;background:transparent!important;border:0!important;border-radius:0;outline:0!important;box-shadow:none!important;color:var(--text);font:13px var(--font,inherit);padding:10px 0}
#waCard .wa-pick[hidden],#waCard .wa-list[hidden]{display:none}
#waCard .wa-rng{display:flex;flex-wrap:wrap;gap:6px}
#waCard .wa-rng button{all:unset;box-sizing:border-box;cursor:pointer;padding:5px 11px;border-radius:99px;border:1px solid var(--border);background:var(--card2,var(--bg2));color:var(--text2);font:600 12px var(--font,inherit);white-space:nowrap}
#waCard .wa-rng button:hover{color:var(--text);border-color:var(--border2,var(--border))}
#waCard .wa-rng button.on{background:var(--accent);border-color:var(--accent);color:var(--bg,#111)}
#waCard .wa-rng button:focus-visible,#waCard .wa-btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
#waCard .wa-pick{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12.5px;color:var(--text3)}
#waCard .wa-pick input{background:var(--bg2);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:6px 8px;font:12.5px var(--font,inherit);color-scheme:light dark;min-width:0}
#waCard .wa-sbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
#waCard .wa-scount{flex:1;min-width:0;font:600 12px var(--font,inherit);color:var(--text3)}
#waCard .wa-dl{display:flex;gap:6px}
#waCard .wa-btn.sm{padding:6px 11px;font-size:12px}
#waCard .wa-sres{max-height:440px}
#waCard .wa-day{position:sticky;top:0;z-index:1;display:flex;justify-content:space-between;gap:8px;padding:6px 10px;font:700 11.5px var(--font,inherit);color:var(--text2);background:var(--card);border-bottom:1px solid var(--border);box-shadow:0 1px 0 var(--border)}
#waCard .wa-day span{font-weight:500;color:var(--text3)}
#waCard .wa-sres mark{background:color-mix(in srgb,var(--gold,#e0b24f) 35%,transparent);color:inherit;border-radius:3px;padding:0 1px}
#waCard .wa-more{all:unset;box-sizing:border-box;display:block;width:100%;cursor:pointer;text-align:center;padding:10px;font:600 12.5px var(--font,inherit);color:var(--accent)}
#waCard .wa-more:hover{background:var(--bg2)}
@media (max-width:600px){#waCard>summary{padding:0 12px}#waCard .wa-body{padding:10px 12px 14px}#waCard .wa-last{display:none}#waCard .wa-btn{flex:1 1 auto;text-align:center}}
`;
const esc = s => (typeof escapeHtml === 'function' ? escapeHtml(s) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
const clock = t => { const m = String(t || '').match(/^(\d{1,2}):(\d{2})$/); if (!m) return t || ''; const h = +m[1]; return (h % 12 || 12) + ':' + m[2] + (h >= 12 ? ' PM' : ' AM'); };
const ICON = { co: '✓', lco: '⏰', ext: '↪', note: '📝', notlist: '⚠', skip: '·', none: '—', ignore: '—' };

function mount() {
  if (doc.getElementById('waCard')) return true;
  const panel = doc.getElementById('panel-departures'); if (!panel) return false;
  const st = doc.createElement('style'); st.id = 'waCss'; st.textContent = CSS; doc.head.appendChild(st);
  const card = doc.createElement('details'); card.id = 'waCard';
  card.open = true;   // it lives in its own window (top bar 🟢 button), always open
  card.innerHTML = `<summary><span aria-hidden="true">💬</span><span>WhatsApp HK group</span><span class="wa-n" id="waCount">0</span><span class="wa-last" id="waLast"></span><button type="button" class="wa-x" id="waClose" aria-label="Close" title="Close (Esc)">✕</button></summary>
  <div class="wa-body">
    <div class="wa-st" id="waStatus"></div>
    <div class="wa-find" id="waFind">
      <div class="wa-q"><span aria-hidden="true">🔍</span><input type="search" id="waQ" placeholder="Search the HK chat… room, word or name" aria-label="Search the HK chat" autocomplete="off" spellcheck="false"></div>
      <div class="wa-rng" id="waRng" role="group" aria-label="Which days">
        <button type="button" data-r="today" class="on" aria-pressed="true">Today</button><button type="button" data-r="7" aria-pressed="false">7 days</button><button type="button" data-r="30" aria-pressed="false">30 days</button><button type="button" data-r="all" aria-pressed="false">All</button><button type="button" data-r="pick" aria-pressed="false">📅 Pick dates</button>
      </div>
      <div class="wa-pick" id="waPick" hidden><input type="date" id="waFrom" aria-label="From"><span>to</span><input type="date" id="waTo" aria-label="To"></div>
      <div class="wa-sbar"><span class="wa-scount" id="waSCount"></span><span class="wa-dl"><button type="button" class="wa-btn sm" id="waDlTxt" title="Saves the messages shown as a .txt in WhatsApp's own format">⬇ Download backup</button><button type="button" class="wa-btn sm" id="waDlCsv" title="For Excel">CSV</button></span></div>
    </div>
    <div class="wa-list" id="waList" aria-live="polite"></div>
    <div class="wa-list wa-sres" id="waSRes" hidden aria-live="polite"></div>
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
      <p><b>What it does:</b> when someone writes <code>324 CO</code> in the HK group, room 324 is checked out here. <code>202 LCO 6PM</code> sets a 6 PM late check-out. <code>0113 EXT 2N</code> (or <code>extended till 22 Oct</code>) marks an extension. Other messages with a room (like <code>415 change bedsheet</code>) become a note. Every change has an Undo. Only today's messages and only rooms on today's list. Every message is also kept in HotelOps as a backup: search it above and download it any time.</p>
      <p><b>Option A — automatic</b></p>
      <ol>
        <li>Open WhatsApp Web on this computer.</li>
        <li>Press <b>F12</b> and click <b>Console</b>.</li>
        <li>If Chrome asks, type <code>allow pasting</code> and press Enter.</li>
        <li>Copy the line below (<b>Copy</b> button), paste it in the Console and press Enter. Close F12.</li>
        <li>Type the HK group name when asked, then open the HK group.</li>
        <li>A small HotelOps window shows at the bottom left of WhatsApp. Click <b>Connect HotelOps</b> once. A HotelOps tab opens — keep it open.</li>
      </ol>
      <p>Do this again each time you reload WhatsApp. If the window turns amber, use its <b>📋 Copy today's chat</b> button and paste here.</p>
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
  // search the chat backup
  const qEl = doc.getElementById('waQ');
  let qt = null;
  qEl.addEventListener('input', () => { clearTimeout(qt); qt = setTimeout(() => { shown = PAGE; runSearch(); }, 160); });
  qEl.addEventListener('keydown', e => { if (e.key === 'Escape' && qEl.value) { e.stopPropagation(); qEl.value = ''; runSearch(); } });
  doc.getElementById('waRng').addEventListener('click', e => {
    const b = e.target.closest('[data-r]'); if (!b) return;
    RNG = b.getAttribute('data-r');
    doc.querySelectorAll('#waRng [data-r]').forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    const pk = doc.getElementById('waPick'); pk.hidden = RNG !== 'pick';
    if (RNG === 'pick') { const f = doc.getElementById('waFrom'), t = doc.getElementById('waTo'); if (!t.value) t.value = today(); if (!f.value) f.value = dayAdd(today(), -6); }
    shown = PAGE; runSearch();
  });
  ['waFrom', 'waTo'].forEach(id => doc.getElementById(id).addEventListener('change', () => { shown = PAGE; runSearch(); }));
  doc.getElementById('waSRes').addEventListener('click', e => { if (e.target.closest('.wa-more')) { shown += PAGE; drawResults(); } });
  doc.getElementById('waDlTxt').onclick = () => download('txt');
  doc.getElementById('waDlCsv').onclick = () => download('csv');
  renderCard();
  runSearch();
  return true;
}

// ══ Search + download the backup ════════════════════════════
const PAGE = 300;
let RNG = 'today', shown = PAGE, RES = [], RANGE = null, seq = 0;
const dayAdd = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return isoDay(x); };
/** the days of the chosen range (null = every day in the index) */
function rangeDays() {
  const t = today();
  if (RNG === 'all') return null;
  let from = t, to = t;
  if (RNG === '7') from = dayAdd(t, -6);
  else if (RNG === '30') from = dayAdd(t, -29);
  else if (RNG === 'pick') {
    from = doc.getElementById('waFrom').value || t; to = doc.getElementById('waTo').value || t;
    if (from > to) { const x = from; from = to; to = x; }
  }
  const out = []; for (let d = from; d <= to && out.length < 400; d = dayAdd(d, 1)) out.push(d);
  return out;
}
const ARCH_AT = {};       // day → when it was read (read again after 30 s: other desks write too)
async function loadDays(days) {
  const now = Date.now(), need = days.filter(d => !ARCH[d] || now - (ARCH_AT[d] || 0) > 30000);
  await Promise.all(need.map(async d => {
    let v = null; try { v = typeof fbGet === 'function' ? await fbGet('waChat/' + d) : null; } catch (_) {}
    ARCH[d] = Object.assign(v && typeof v === 'object' ? v : {}, pendingRecs(d)); ARCH_AT[d] = Date.now();
  }));
}
async function runSearch(keepScroll) {
  const qEl = doc.getElementById('waQ'); if (!qEl) return;
  const q = qEl.value, my = ++seq;
  const active = !!q.trim() || RNG !== 'today';
  doc.getElementById('waList').hidden = active; doc.getElementById('waSRes').hidden = !active;
  const cnt = doc.getElementById('waSCount');
  let days = rangeDays();
  if (!days) {
    cnt.textContent = 'Loading all days…';
    if (!IDX || Date.now() - IDX_AT > 30000) { let v = null; try { v = typeof fbGet === 'function' ? await fbGet('waChatIdx') : null; } catch (_) {} IDX = Object.assign(v && typeof v === 'object' ? v : {}, IDX || {}); IDX_AT = Date.now(); }
    days = Object.keys(IDX).filter(isDay).concat(Object.keys(ARCH)).concat([today()]).filter((d, i, a) => a.indexOf(d) === i).sort();
  } else if (days.some(d => !ARCH[d])) cnt.textContent = 'Loading…';
  if (!days.length) days = [today()];
  await loadDays(days);
  if (my !== seq) return;
  const src = {}; days.forEach(d => { src[d] = Object.assign({}, ARCH[d], (archQ[d] && pendingRecs(d)) || {}); });
  RES = hoWaSearch(src, q);
  RANGE = { from: days[0] || today(), to: days[days.length - 1] || today() };
  const n = RES.length, rl = { today: 'today', '7': 'in the last 7 days', '30': 'in the last 30 days', all: 'in all days', pick: RANGE.from === RANGE.to ? 'on ' + dmy(RANGE.from) : dmy(RANGE.from) + ' to ' + dmy(RANGE.to) }[RNG];
  cnt.textContent = (q.trim() ? `${n} result${n === 1 ? '' : 's'}` : `${n} message${n === 1 ? '' : 's'} kept`) + ' ' + rl;
  doc.getElementById('waDlTxt').disabled = doc.getElementById('waDlCsv').disabled = !n;
  if (active) { if (!keepScroll) doc.getElementById('waSRes').scrollTop = 0; drawResults(); }
}
/** records still waiting to be saved (whole ones only) */
function pendingRecs(d) { const o = {}; Object.keys(archQ[d] || {}).forEach(k => { if (k.indexOf('/') < 0) o[k] = archQ[d][k]; }); return o; }
const fmtDay = d => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
function drawResults() {
  const box = doc.getElementById('waSRes'); if (!box) return;
  const q = searchTokens(doc.getElementById('waQ').value);
  if (!RES.length) { box.innerHTML = `<div class="wa-empty">${q.length ? 'Nothing found. Try a room number, a word or a name.' : 'No messages kept for these days yet.'}</div>`; return; }
  const per = {}; RES.forEach(o => { per[o.day] = (per[o.day] || 0) + 1; });
  let html = '', last = '';
  RES.slice(0, shown).forEach(o => {
    if (o.day !== last) { last = o.day; html += `<div class="wa-day">${esc(fmtDay(o.day))}<span>${per[o.day]}</span></div>`; }
    const r = o.rec, ch = archChips(r.r);
    html += `<div class="wa-row${r.u ? ' undone' : ''}"><span class="wa-t">${esc(t12(r.t))}</span><span class="wa-m"><span class="wa-who">${hoWaHi(r.s || '', q)}${r.e ? ' ✎' : ''}</span><span class="wa-txt">${hoWaHi(String(r.x || '').length > 400 ? String(r.x).slice(0, 400) + '…' : r.x, q)}</span></span><span></span>`
      + `<span class="wa-res">${ch.map(c => `<span class="wa-chip ${esc(c.st)}">${hoWaHi(c.label, q)}${r.u && /co|lco|ext|note/.test(c.st) ? ' — undone' : ''}</span>`).join('')}</span></div>`;
  });
  if (RES.length > shown) html += `<button type="button" class="wa-more">Show more (${RES.length - shown} left)</button>`;
  box.innerHTML = html;
}
function download(kind) {
  if (!RES.length) { showToast('Nothing to download for these days', 'warn'); return; }
  const body = kind === 'csv' ? hoWaExportCsv(RES) : hoWaExportTxt(RES);
  const name = hoWaExportName(RANGE.from, RANGE.to, kind);
  try {
    const url = URL.createObjectURL(new Blob([body], { type: kind === 'csv' ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8' }));
    const a = doc.createElement('a'); a.href = url; a.download = name; doc.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    showToast(`Saved ${RES.length} message${RES.length === 1 ? '' : 's'} · ${name}`, 'ok');
  } catch (_) { showToast('Could not save the file', 'err'); }
}
let snipLoaded = false;
function loadSnippet() {
  if (snipLoaded) return; snipLoaded = true;
  const box = doc.getElementById('waSnippet'); if (!box) return;
  const app = location.origin + location.pathname;
  fetch('tools/hotelops-whatsapp.console.js', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(r.status); return r.text(); })
    .then(t => { box.value = snippet(t, app); })
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
  if (last) { const l = LOG.find(x => x.res.some(r => /co|lco|ext|note/.test(r.st))); last.textContent = l ? `Last: ${l.res.find(r => /co|lco|ext|note/.test(r.st)).text} · ${timeLabel(l.time)}` : ''; }
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
W.hoWaBridge = { handle, readPasted, parse: hoWaParse, parseCopied: hoWaParseCopied, log: () => LOG.slice(), origins: ORIGINS, render: renderCard, search: runSearch, flushBackup: flushArch, results: () => RES.slice() };
if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
})();

// Top bar button: the WhatsApp window over the app, paste box ready
function waOpenFromTop() {
  const ov = document.getElementById('waOv'); if (!ov) return;
  ov.hidden = false; ov.scrollTop = 0;
  document.documentElement.style.overflow = 'hidden';   // the page behind stays still; the window scrolls
  const ta = document.getElementById('waPaste'); if (ta) setTimeout(() => ta.focus({ preventScroll: true }), 120);
}
function waClose() { const ov = document.getElementById('waOv'); if (ov) ov.hidden = true; document.documentElement.style.overflow = ''; }
window.waOpenFromTop = waOpenFromTop; window.waClose = waClose;
