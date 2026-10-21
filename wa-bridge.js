// ═══════════════════════════════════════════════════════════
//  wa-bridge.js — WhatsApp HK group → Departures
//
//  "324 CO"          → room 324 checked out (as the card's Check out button)
//                       (also C/O, checkout, checked out, chkout, out, left, vacated, departed, "CO 324")
//  "202 LCO 6PM"     → room 202 late check-out at 18:00 (also late co, late checkout, L/C, "late till 6pm")
//  "0113 EXT 2N"     → room 0113 extended 2 nights (as the card's Extend button); also
//                       ext/extend/extended/extension, "+2N", "ext till 22", "ext to 22 Oct"
//  "415 change bed"  → a note on room 415 ("324 out of order", "324 CO tomorrow" are notes too)
//  Plain talk too: "514 checking out in 10 mins" (⏱ checking out soon, or a late check-out when that is
//  after the room's check-out time), "514 will leave at 3pm", "514 gone", "keys returned 514",
//  "guest in 514 left", "514 staying 2 more nights", "514 thinking to extend". Times count only next
//  to leaving words ("514 cleaning after 2pm" stays a request).
//  Every automatic change shows an Undo (also Ctrl+Z) and is written in the
//  room's note ("WhatsApp · Sam 9:01"), so the team sees where it came from.
//
//  Messages arrive two ways:
//   1. Linked: the console snippet (tools/hotelops-whatsapp.console.js) on
//      WhatsApp Web opens this app in a tab and postMessages each new message
//      ({source:'ho-wa', msg}); we answer {source:'ho-wa-ack', id, res?} (res: what HotelOps did — request, not found…). Accepted only
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
    if (/\bmidnight\b/.test(t)) return '00:00';
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
  const IGNORE_LINE = l => /^\s*🔁/u.test(l) || /Extensions\s*[—–-]/.test(l) || /\d{3,4}\s*·\s*\+\d+\s*N\s*→/.test(l) || /^\s*[📵✓✅⏳🤔🕐]️?\s*\d{3,4}\s*·/u.test(l);
  // the app's own summaries shared to the group by hand ("✅ *Checked Out — 12:31*", "📵 NA Rooms — 13:25", "🏨 HK Update — 14:20"):
  // they carry no invisible mark, so they are known by their first line
  const APP_POST = /^[\s*_]*(?:✅|📵|🏨|↪|🔁)️?[\s*_]*(?:Checked\s+Out(?:\s+Rooms)?(?:\s*\(last\s+\d+\s*min\))?|NA\s+Rooms|HK\s+Update|Extensions)[\s*_]*[—–]\s*\d{1,2}:\d{2}/iu;
  // what a phone export puts in the text: "[Forwarded]", "<image omitted>", "[Image]", "<This message was edited>"
  const MEDIA_LEAD = /^\s*(?:(?:\[Forwarded\]|<[^<>\n]{0,40}\b(?:omitted|album message|unknown message)>|\[(?:Image|Video|Voice message|Audio|Sticker|GIF|Document|Contact|album message|unknown message|View once[^\]]*)\])\s*)+/i;
  const EDITED_TAIL = /\s*<This message was edited>\s*$/i;
  /** "@Sam Lee please" / "516 ip @~Sam" / "ok plz@Sam": a mention says who is asked, not what happened → cut (to the line's end) */
  const noMention = l => {
    const m = l.match(/(?:^|[\s.,;:!?)(]|(?<=[a-z]))@(?=[~\p{L}\p{N}\p{Extended_Pictographic}])/u);
    if (!m) return l;
    const i = m.index + m[0].length - 1;
    if (!l.slice(0, i).trim()) { const r = l.slice(i), n = r.replace(/^@~?\S+(?:\s+[\p{Lu}~][^\s\d@]*){0,3}\s+(?=\d{3,4}\b)/u, ''); return n !== r ? n : r.replace(/^@~?\S+\s*/u, ''); }   // "@Sam Lee 105 send towels", "@Sam send towels 105": only the name goes
    return l.slice(0, i).replace(/\s+$/, '');
  };
  const ROOM = '(?:(?:rooms?|rms?|rn)\\.?\\s*:?\\s*(?:no\\.?\\s*)?|#\\s*)?(\\d{3,4})(?![\\d]|[:.]\\d)';
  const ROOM_AT = new RegExp('^' + ROOM, 'i');
  const ROOM_NC = ROOM.replace('(\\d{3,4})', '(?:\\d{3,4})');
  const SPLIT = new RegExp('[,;]\\s*(?=' + ROOM_NC + ')', 'i');
  const SEP = /^\s*(?:,|&|\+|\/|-|\band\b|\s)\s*/i;
  const FILLER = /^(?:done|now|already|just|also|ok|okay|pls|please|plz|thanks?|thank\s*you|thx|khalas|tamam|yalla|shukran|sir|maam|ma'am|guys|team|hk|fo|room|rooms|hotel|is|are|has|have|the|guest|guests|[✅👍✔☑🙏.!,;:\s\u{1F3FB}-\u{1F3FF}])*$/iu;
  // words before the command: "324 guest has checked out", "324 already CO"
  const LEAD = /^(?:(?:the\s+)?guests?|gst|has|have|is|was|already|just|now|been|all|khalas|yalla)\s+/i;
  const CO_NOT = /^(?:of\b|time|at\b|by\b|after|before|in\s|on\s|date|day\b|plan|req)/i;
  const WHEN_NOT = /\?|\b(?:tomorrow|tomm?orr?ow|tmrw|tmr|tmw|tmrow|tomoro|later|pending|maybe|might|wants?|wanted|asking|asks?|asked|requests?|requested|requesting|req|not|cancel(?:led|ed)?|planning|plans?|will|soon|expected|possible|next)\b/i;
  const LCO_W = '(?:lco|l\\.c\\.o\\.?|l\\/co|l\\/c|l\\.c\\.?|lc|late\\s*(?:ch(?:ec)?k[\\s-]*out|checkout|c\\/o|c\\.o\\.?|co))';
  const CO_W = '(?:co|c\\/o|c\\.o\\.?|c-o|c\\/out|c\\.out|ch(?:ec)?k(?:e?d)?[\\s-]*out)';
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
  // "till Friday", "until Sat": the next such day after the message's day (a week on when it is today)
  const WDAY = /(?:^|\s|→|->)(?:(?:till|until|untill|til|to|upto|up\s*to|on|for)\s+)?(?:this\s+|next\s+|coming\s+)?(sun|mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?)(?:day)?\b/;
  function weekdayOf(t) {
    const m = String(t).match(WDAY); if (!m) return '';
    const want = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(m[1].slice(0, 3));
    const d = nowDate(), n = ((want - d.getDay() + 7) % 7) || 7;
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
    return x.getDate() + '/' + (x.getMonth() + 1);
  }
  const TMRW_TOO = /^\s*(?:for\s+)?(?:tomorrow|tomm?orr?ow|tmrw|tmr|tmw)\s*(?:night\s*)?(?:also|too|as\s+well|aswell)\b/;
  // the message's own time (hoWaParse opt.now: a Date, ms or "HH:MM" today), for "in 10 mins" and "till Friday"
  let NOW = null;
  const nowDate = () => (NOW instanceof Date && !isNaN(NOW) ? NOW : new Date());
  function nowOf(v) {
    if (v && typeof v === 'object' && typeof v.getTime === 'function') { const d = new Date(v.getTime()); return isNaN(d) ? null : d; }
    if (typeof v === 'number' && isFinite(v)) return new Date(v);
    const m = String(v == null ? '' : v).match(/^\s*(\d{1,2}):(\d{2})/);
    if (m) { const d = new Date(); d.setHours(+m[1], +m[2], 0, 0); return d; }
    return null;
  }
  const okDay = (d, mo) => (d >= 1 && d <= 31 && (!mo || (mo >= 1 && mo <= 12)) ? d + (mo ? '/' + mo : '') : '');
  /** what comes after "ext": nights or a new date. null = not an extension we can trust (a note) */
  function extDetail(tail) {
    const t = tail.replace(/^[\s:\-–—=>.,+]+/, ' ').replace(/[\s.!,;]+$/, '').toLowerCase().replace(/\bnext\s+(?=(?:sun|mon|tue|wed|thu|fri|sat))/, '');
    if (/\b(?:till|until|untill|til|to|upto|up\s*to)\s+(?:tomorrow|tomm?orr?ow|tmrw|tmr|tmw)\b/.test(t)) return { nights: 1 };
    if (TMRW_TOO.test(t)) return { nights: 1 };                                    // "ext tomorrow also"
    if (WHEN_NOT.test(t)) return null;
    let m;
    if (/^\s*(?:for\s+)?(?:one\s+)?(?:another|1\s+more|one\s+more)\s+(?:n|nt|ngt|nite|night|day)\b/.test(t)) return { nights: 1 };
    const nw = '(\\d{1,2}|' + Object.keys(NUMW).join('|') + ')';
    if ((m = t.match(new RegExp('(?:^|[\\s+])' + nw + '\\s*(?:more\\s+|extra\\s+)?(?:n|nt|nts|ngt|ngts|nite|nites|nights?|days?)\\b')))) { const n = NUMW[m[1]] || +m[1]; return n >= 1 && n <= 90 ? { nights: n } : null; }
    if ((m = t.match(/^\s*(?:for\s+)?(\d{1,2})\s*$/)) || (m = t.match(/^\s*\+\s*(\d{1,2})\b/))) {
      const n = +m[1]; if (n >= 1 && n <= 14) return { nights: n };
      const d = okDay(n, 0); return d ? { until: d } : null;
    }
    const d = dayOf(t);
    if (d) return { until: d };
    const wd = weekdayOf(t); if (wd) return { until: wd };
    if ((m = t.match(/\b(?:till|until|untill|til|to|upto|up\s*to|on|→|->)\s*(\d{1,2})(?:st|nd|rd|th)?\b/))) { const d2 = okDay(+m[1], 0); return d2 ? { until: d2 } : null; }
    return FILLER.test(t) || /^(?:stay|the\s+stay|booking|confirmed|paid|ok)?\s*$/.test(t.trim()) ? {} : null;
  }
  // the hotel's own word list (window.hoWaWords, made in HotelOps: "VD" = Vacant Dirty → checked out, …), asked first
  let WORDS = null;
  function dictOf(opt) {
    if (opt && typeof opt.words === 'function') return opt.words;
    try { const g = typeof globalThis !== 'undefined' ? globalThis : null; const d = g && g.hoWaWords; if (d && typeof d.lookup === 'function') return w => d.lookup(w); } catch (_) {}
    return null;
  }
  // housekeeping room statuses everyone uses, until the hotel's own list says otherwise
  const HK_BUILTIN = { vd: ['co', 'Vacant Dirty'], vc: ['co', 'Vacant Clean'], vr: ['co', 'Vacant Ready'], vci: ['co', 'Vacant Clean Inspected'], ed: ['co', 'Early Departure'],
    od: ['hk', 'Occupied Dirty'], oc: ['hk', 'Occupied Clean'], ooo: ['hk', 'Out of Order'], oos: ['hk', 'Out of Service'], dnd: ['hk', 'Do Not Disturb'], so: ['hk', 'Sleep Out'], dl: ['hk', 'Double Lock'], ns: ['hk', 'No Show'], rc: ['hk', 'Registration card (signature)'],
    // how HK groups write it: "516 IP" (inspected, ready to sell), "225 N/L" (no luggage), "526 OCC" (occupied), "513 sleep out", "614 double lock", "209 NA" (no answer), "406 ongoing" (being cleaned)
    ip: ['hk', 'Inspected — room ready'], io: ['hk', 'Inspected — room ready'], 'n/l': ['hk', 'No Luggage'], nl: ['hk', 'No Luggage'], occ: ['hk', 'Occupied'], 'sleep out': ['hk', 'Sleep Out'], sleepout: ['hk', 'Sleep Out'],
    'double lock': ['hk', 'Double Lock'], 'double locked': ['hk', 'Double Lock'], na: ['hk', 'No Answer'], ongoing: ['hk', 'Cleaning in progress'], 'on going': ['hk', 'Cleaning in progress'] };
  function lookup(w) {
    if (!w) return null;
    if (WORDS) { try { const x = WORDS(w); if (x && typeof x === 'object' && /^(?:co|lco|ext|note|hk|ignore)$/.test(x.m)) return x; } catch (_) {} }
    const b = HK_BUILTIN[String(w).toLowerCase()];
    return b ? { m: b[0], label: b[1] } : null;
  }
  /** the word (or two words) right after the room, in the hotel's list → an action, or null */
  function dictClassify(low, r) {
    const ws = low.split(/[\s:,;!?]+/).filter(Boolean); if (!ws.length) return null;
    const two = ws.length > 1 ? ws[0] + ' ' + ws[1] : '';
    let hit = two && lookup(two), used = two;
    if (!hit) { hit = lookup(ws[0]); used = ws[0]; }
    if (!hit) return null;
    // the parser's own command words in their usual meaning ("CO", "checkout", "LCO", "ext", in the built-in list too):
    // the full rules below read them, so "324 CO tomorrow", "202 LCO cancelled", "113 ext pending" are not taken as done
    const own = { co: CO_W, lco: LCO_W, ext: EXT_W }[hit.m];
    if (own && new RegExp('^(?:' + own + ')$', 'i').test(used.replace(/[:,;.!?]+$/, ''))) return null;
    const tail = low.split(/\s+/).slice(used.split(' ').length).join(' ').replace(/^[\s:\-–—]+/, '');
    const tag = { word: used.replace(/[:,;.!?]+$/, ''), label: String(hit.label || '') };
    const asNote = () => Object.assign({ act: 'note', note: r }, tag);
    if (hit.m === 'ignore') return Object.assign({ act: 'ignore' }, tag);
    if (hit.m === 'co') return tail && !FILLER.test(tail) && (CO_NOT.test(tail) || WHEN_NOT.test(tail) || timeStrict(tail)) ? asNote() : Object.assign({ act: 'co' }, tag);   // "512 ED tomorrow": a note
    if (hit.m === 'lco') return /\?|\b(?:cancel\w*|tomorrow|tomm?orr?ow|tmrw|tmr|tmw)\b/.test(tail) ? asNote() : Object.assign({ act: 'lco', time: hoWaTime(tail) }, tag);
    if (hit.m === 'ext') { const x = extDetail(tail); return x ? Object.assign({ act: 'ext' }, x, tag) : asNote(); }
    // 'note' and 'hk' (a housekeeping status) are written on the room: "VC (Vacant Clean)"
    return Object.assign({ act: 'note', note: tag.label && low === used ? r + ' (' + tag.label + ')' : r }, tag);
  }
  // ⏳ Extending: the paperwork for an extension. Each item is done (true), still to do (false) or not said (left as it is).
  const PAPER = [['book', /\b(?:booking|bkg|reservation|new\s+res|res)\b/], ['sign', /\b(?:rc(?:\s*sign(?:ed|ature)?)?|reg(?:istration)?\.?\s*card|sign(?:ed|ature|ing)?)\b/],
    ['td', /\btd\b/], ['pay', /\b(?:full\s+payment|paid\s+(?:in\s+)?full|payment|pay|balance)\b/]];
  const P_DONE = /\b(?:done|paid|collected|taken|signed|received|created|made|ok|okay|completed|complete)\b|[✓✔✅]/u;
  const P_WAIT = /\b(?:waiting|wait|pending|left|missing|needs?|needed|still|not\s+yet|remaining|to\s+do)\b/;
  /** "waiting for TD and RC sign" → {td:false, sign:false, book:true, pay:true}; "TD done" → {td:true}; "all done" → all true */
  function paperOf(t) {
    t = String(t || '').toLowerCase();
    if (/\ball\s+(?:done|ok|okay|complete|completed|ready|collected)\b/.test(t)) return { book: true, sign: true, td: true, pay: true, all: 1 };
    const hits = [];
    PAPER.forEach(([k, re]) => { const g = new RegExp(re.source, 'g'); let m; while ((m = g.exec(t))) { if (k === 'sign' && /^sign/.test(m[0]) && hits.some(h => h.k === 'sign')) continue; hits.push({ k, i: m.index }); } });
    if (!hits.length) return null;
    hits.sort((a, b) => a.i - b.i);
    const wait = P_WAIT.test(t), only = wait || /\b(?:only|just)\b/.test(t);
    const segs = hits.map((h, n) => t.slice(h.i, n + 1 < hits.length ? hits[n + 1].i : t.length));
    const anyDone = segs.some(x => P_DONE.test(x));
    const o = {};
    hits.forEach((h, n) => {
      const v = wait ? (P_DONE.test(segs[n]) && !P_WAIT.test(segs[n])) : anyDone;
      if (o[h.k] === undefined || v === false) o[h.k] = v;
    });
    if (only && Object.keys(o).some(k => o[k] === false)) PAPER.forEach(([k]) => { if (o[k] === undefined) o[k] = true; });
    return o;
  }
  /** ⏳ Extending + what the message says about the paperwork */
  function extending(t) { const p = paperOf(t) || {}; const a = { act: 'extending' }; PAPER.forEach(([k]) => { if (p[k] !== undefined) a[k] = p[k]; }); return a; }
  // ══ Talk: the team writing normally ═════════════════════════
  // "514 checking out in 10 mins", "514 will leave around 1:30", "514 gone", "keys returned 514",
  // "514 staying 2 more nights", "514 thinking to extend". Only time words tied to leaving count
  // ("514 cleaning after 2pm" stays a request).
  const NUM_T = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
    fifteen: 15, twenty: 20, 'twenty five': 25, thirty: 30, forty: 40, 'forty five': 45, fifty: 50 };
  const NUM_RX = '(\\d{1,3}(?:\\.\\d)?|' + Object.keys(NUM_T).sort((x, y) => y.length - x.length).map(k => k.replace(/ /g, '[\\s-]+')).join('|') + ')';
  const numOf = s => { s = String(s).trim().replace(/[\s-]+/g, ' '); return NUM_T[s] != null ? NUM_T[s] : +s; };
  const ABOUT = '(?:(?:about|around|approx\\.?|approximately|aprox|like|max|maximum|abt|arnd|roughly|~)\\s*)?';
  const T_UNIT = '(m|mn|mns|min|mins|minute|minutes|minits?|h|hr|hrs|hour|hours)';
  const REL_RX = new RegExp('^(?:(?:in|after|within|another)\\s+)?' + ABOUT + '(?:(?:in|after|within)\\s+)?' + NUM_RX + '(?:\\s*(?:-|to|or)\\s*' + NUM_RX + ')?\\s*' + T_UNIT + '(?![a-z])(\\s+and\\s+(?:a\\s+)?half)?');
  /** "in 10 mins", "15 min", "in half an hour", "1hr", "in 10-15 min", "after 30 mins", "in 5" → minutes (0: none) */
  function relMins(h) {
    let m;
    if (/^(?:(?:in|after|within)\s+)?(?:about\s+|around\s+|~\s*)?half\s+(?:an?\s+)?(?:hour|hr)\b/.test(h)) return 30;
    if ((m = h.match(REL_RX))) {
      const n = numOf(m[2] || m[1]), hour = /^h/.test(m[3]);
      const v = Math.round(n * (hour ? 60 : 1) + (m[4] ? 30 : 0));
      return v >= 1 && v <= 360 ? v : 0;
    }
    if ((m = h.match(/^(?:in|after|within)\s+(?:about\s+|around\s+|~\s*)?(\d{1,2})(?![\d:.\/]|\s*(?:am|pm|a\.m|p\.m|st|nd|rd|th|n\b|nights?|days?|hrs?|h\b|o'?clock))/))) { const v = +m[1]; return v >= 1 && v <= 60 ? v : 0; }
    if (/^(?:in\s+)?(?:a\s+)?few\s+(?:mins?|minutes)\b/.test(h)) return 10;
    if (/^(?:now|right\s+now|rn|asap|immediately|already\s+on\s+(?:the|his|her|their)\s+way|on\s+(?:the|his|her|their)\s+way)\b/.test(h)) return 5;
    if (/^(?:soon|shortly|in\s+a\s+(?:bit|while|moment|min(?:ute)?))\b/.test(h)) return 15;
    return 0;
  }
  /** "at 3pm", "by 2", "around 1:30", "till 3", "until 4pm", "@ 2", "3pm" → "15:00" ('': none). The time comes first. */
  function absTime(h) {
    const m = h.match(/^(?:(?:at|by|around|about|abt|arnd|before|till|until|untill|til|upto|up\s*to|@|~|approx\.?|max)\s*)*((?:\d{1,2}(?:[:.]\d{2})?|\d{3,4})\s*(?:am|pm|a\.m\.?|p\.m\.?|hrs?|h)?|noon|midday|12\s*noon)(?![\d:\/a-z])/);
    if (!m) return '';
    if (m[0] === m[1] && !timeStrict(m[1]) && !/noon|midday/.test(m[1])) return '';     // a bare "2" needs "at" / "by" / "till"
    return hoWaTime(m[1]);
  }
  /** minutes from the message's time → "HH:MM", rounded up to the next 5 minutes ('' past midnight) */
  function soonTime(n) {
    const d = nowDate(), x = Math.ceil((d.getHours() * 60 + d.getMinutes() + n) / 5) * 5;
    return x < 24 * 60 ? String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0') : '';
  }
  // words before what the guest does: "the guest will", "she is going to", "guest said he wants to"
  const T_LEAD = /^(?:the|guests?|gst|pax|family|couple|lady|gentleman|mr\.?|mrs\.?|ms\.?|he|she|they|also|just|now|already|still|will|wil|wl|gonna|wanna|be|is|are|am|was|to|that|said|says|told|informed|confirmed|going\s+to|about\s+to|ready\s+to|planning\s+to|plans?\s+to|wants?\s+to|would\s+like\s+to|needs?\s+to|has\s+to|have\s+to|expected\s+to|expects?\s+to|(?:told|informed)\s+(?:us|me|fo|hk|reception)|khalas|yalla|ok|okay)\s+/;
  const stripLead = t => { let x = t.replace(/^['’]s\b\s*/, ''), y; while ((y = x.replace(T_LEAD, '')) !== x) x = y; return x; };
  const T_NOT = /\?|\b(?:tomorrow|tomm?orr?ow|tmrw|tmr|tmw|tmrow|tomoro|yesterday|maybe|may|might|perhaps|not|don'?t|doesn'?t|didn'?t|won'?t|wont|cancel\w*|no\s+need|if|unless|whether)\b/;
  const GO_V = '(?:ch(?:e|a)?c?k(?:ing|s)?\\s*-?\\s*out|checkout|chkout|c\\/o|co|leav(?:e|es|ing)|lv|go(?:ing|es)?\\s+down|com(?:e|es|ing)\\s+down|depart(?:ing|s)?|vacat(?:e|es|ing)|head(?:ing|s)?\\s+(?:out|to\\s+(?:the\\s+)?airport)|go(?:ing|es)?\\s+to\\s+(?:the\\s+)?airport)';
  const GO_RX = new RegExp('^(' + GO_V + ')(?![a-z])\\s*(?:(?:from\\s+)?(?:the\\s+)?(?:hotel|room)\\b\\s*)?(?:(?:today|tdy)\\b\\s*)?[,:\\-–—]?\\s*(.*)$');
  // "gone", "left the hotel", "room free", "keys at desk", "dep done", "checked out": the guest has left
  const GONE = /^(?:gone|left(?:\s+(?:the\s+)?(?:hotel|room|already|now))*|out|vacated|vacant|empty|free|(?:the\s+)?room\s+(?:is\s+)?(?:free|empty|vacant|vacated)|departed|dep(?:arture)?\s+(?:done|ok|okay|complete|completed|khalas)|c\/?o\s+(?:done|ok|okay|complete|completed|khalas)|check(?:ed)?\s*-?\s*out\s+(?:done|khalas)|checked\s*-?\s*out|chkd\s*out|keys?\s+(?:cards?\s+)?(?:returned|dropped|handed\s+(?:in|over|back)|received|back|left|at\s+(?:the\s+)?(?:desk|reception|fo|front\s*desk|counter))|(?:returned|dropped|handed\s+(?:in|over|back))\s+(?:the\s+)?keys?)(?![a-z])\s*(.*)$/;
  const GONE_TAIL = /^(?:(?:the\s+)?(?:hotel|room)|already|now|today|just\s+now|khalas|tamam|done|ok|okay|thanks?|thx|pls|please|[✅👍✔☑🙏.!,;:\s])*$/iu;
  /** a sentence about leaving → an action, or null */
  function natural(low) {
    let t = stripLead(low), m;
    if (!t) return null;
    if ((m = t.match(GONE)) && GONE_TAIL.test(m[1].trim()) && !/\?|\bnot\b/.test(t)) return { act: 'co' };
    if (T_NOT.test(t)) return null;
    // "wants late checkout till 2", "got LCO 3pm", "late check out approved 4pm"
    if ((m = t.match(/^(?:(?:wants?|wanted|would\s+like|asking(?:\s+for)?|asked(?:\s+for)?|requests?|requested|requesting|needs?|got|gets|given|approved|giving|give|ok(?:ay)?|confirmed)\s+)?(?:an?\s+|the\s+)?(?:late\s*(?:ch(?:e)?c?k[\s-]*out|checkout|c\/?o|co)|lco)(?![a-z])\s*(?:(?:is\s+)?(?:approved|ok(?:ay)?|confirmed|given)\s*)?(.*)$/))) {
      const tm = m[1].trim() ? (absTime(m[1].trim()) || hoWaTime(m[1])) : '';
      return m[1].trim() && !tm ? null : { act: 'lco', time: tm };
    }
    // "needs till 4pm", "keeping the room until 3", "staying till 2pm"
    if ((m = t.match(/^(?:needs?|need|wants?|asking(?:\s+for)?|asked\s+for|requests?(?:ed)?|keep(?:ing|s)?|stay(?:ing|s)?|holding|using)\s+(?:(?:the\s+)?room\s+)?((?:till|until|untill|til|upto|up\s*to)\s+.+)$/))) {
      const tm = absTime(m[1]); if (tm) return { act: 'lco', time: tm };
      return null;
    }
    // "checking out in 10 mins", "leaving now", "will check out at 3pm", "coming down in 5"
    if ((m = t.match(GO_RX))) {
      const head = m[2].split(/[,;]|\s+(?:and(?!\s+(?:a\s+)?half)|but|pls|please|plz|then|so|kindly)\b/)[0].trim().replace(/[\s.!]+$/, '');
      const n = relMins(head);
      if (n) { const tm = soonTime(n); return tm ? { act: 'lco', time: tm, soon: n } : null; }
      const tm = absTime(head); if (tm) return { act: 'lco', time: tm, plan: 1 };
      if (!head && /ing(?:\s*out)?$/.test(m[1])) { const t5 = soonTime(5); return t5 ? { act: 'lco', time: t5, soon: 5 } : null; }   // "514 checking out", "leaving"
    }
    return null;
  }
  // "staying 2 more nights", "will stay one more night", "wants to extend till Friday", "thinking to extend"
  const EXT_UNSURE = /\?|\b(?:thinking|think|thinks|considering|consider|may|might|maybe|possibly|probably|perhaps|not\s+sure|unsure|interested|enquir\w*|inquir\w*|if|asking\s+(?:about|for)|checking\s+(?:about|if))\b/;
  const EXT_WAIT = /\b(?:but|no|not|yet|waiting|wait|pending|booking|bkg|reservation|td|rc|sign\w*|payment|pay|balance|confirm(?:ation)?)\b/;
  function naturalExt(low) {
    const t0 = low.replace(/^['’]s\b\s*/, '');
    if (new RegExp('^' + EXT_W + '(?![a-z])').test(t0)) return null;            // "ext 2N", "extending": the command words, read as before
    const t = stripLead(t0);
    // "one more night", "2 more nights", "another night": nothing before it
    if (/^(?:for\s+)?(?:another\s+(?=\d))?(?:\d{1,2}|one|two|three|four|five|six|seven|another)\s+(?:more|extra|additional|another)?\s*(?:n|nts?|nights?|nites?|days?)\b/.test(t) && /\b(?:more|extra|additional|another)\b/.test(t) && !EXT_UNSURE.test(t) && !T_NOT.test(t)) {
      const x = /^(?:for\s+)?another\s+(?:n|nt|night|nite|day)\b/.test(t) ? { nights: 1 } : extDetail(t.replace(/\badditional\b/, 'extra').replace(/\banother\s+(?=\d)/, ''));
      if (x && x.nights) return { act: 'ext', nights: x.nights };
    }
    const m = t.match(/^(?:to\s+)?(stay(?:ing|s)?|extend(?:ing|ed|s)?|extension|ext)(?![a-z])\s*(?:(?:the\s+)?stay\b\s*|longer\b\s*)?(.*)$/);
    if (!m && EXT_UNSURE.test(t0) && /\b(?:ext\w*|extend\w*|stay(?:ing)?\s+(?:longer|more|another|extra|\d|one|two))/.test(t0) && !T_NOT.test(t0.replace(/\b(?:may|might|maybe|perhaps|if)\b|\?/g, ''))) return extending('');
    if (!m) return null;
    const verb = m[1], tail = m[2].trim();
    if (TMRW_TOO.test(tail)) return { act: 'ext', nights: 1 };
    if (/^stay/.test(verb) && /^(?:till|until|untill|til|upto|up\s*to)\b/.test(tail)) { const tm = absTime(tail); if (tm) return { act: 'lco', time: tm }; }
    if (EXT_UNSURE.test(t0)) return extending('');
    if (/\bnot\b|\bcancel\w*|\bno\s+(?:more|longer)\b/.test(t0)) return null;
    if (EXT_WAIT.test(tail)) return /^stay/.test(verb) && !/^\s*$/.test(tail) && !paperOf(tail) && !/\b(?:but|no|yet|waiting|wait|pending)\b/.test(tail) ? null : extending(tail);
    const x = extDetail(tail);
    if (x && (x.nights || x.until)) return Object.assign({ act: 'ext' }, x);
    if (/^stay/.test(verb) && /^longer\b/.test(m[0].slice(verb.length).trim())) return extending('');
    return null;
  }
  // a question about a room ("314 vd any updates?", "what about 512, out or extend?") never changes it
  const QUEST = /\?|\bany\s*-?\s*updat\w*|\bupdat\w*\s+(?:pl[sz]|please|pl)\b|\b(?:what|whats|which|whether)\b|\bstatus\b/i;
  const ACTS = new Set(['co', 'lco', 'ext', 'extending', 'fin', 'findone', 'maybe']);
  const cleanRest = rest => sp(rest).trim().replace(/^['’]s\b/, '').replace(/^[\s:\-–—=>.,…]+/, '').replace(/[\s.!,;…]+$/, '').trim();
  function classify(rest) {
    const c = classify1(rest);
    if (c && ACTS.has(c.act) && QUEST.test(String(rest).replace(/\b\d{3,4}\b[\s\S]*$/, ''))) return { act: 'note', note: cleanRest(rest) };   // the question is about this room (not one named after it)
    return c;
  }
  /** "any update due out rooms", "vd update plz", "status?", "ready?": only asking → nothing to write on the room */
  function askOnly(rest) {
    const s = sp(rest).toLowerCase();
    if (!/\b(?:updat\w*|status|states|staus)\b|\?/.test(s)) return false;          // "210 VD room is ready" tells, "210 ready?" asks
    return !s.replace(/[?.!,:;…'’()\-–—]+/g, ' ').replace(/\b(?:any|updat\w*|status|states|staus|whats?|the|due|duo|d\/o|out|rooms?|rms?|vd|vc|today|tdy|on|of|for|is|it|ready|plz|pls|please|pl|kindly|ma'?am|maam|sir|dear|now|asap|again|yet|still|guys|team|hk|fo|ro|and|or|\d{3,4})\b/g, ' ').replace(/[\p{Extended_Pictographic}\uFE0F\s]+/gu, '');
  }
  // "14:00 pm", "14;00 pm", "14: 00 pm", "2.30pm" → one way of writing it
  const fixT = s => String(s).replace(/(\d{1,2})\s*[:;.]\s*(\d{2})(?!\d)/, '$1:$2');
  const afterNoon = tm => !!tm && tm >= '12:00';
  // "extended room cleaning", "stay extended, room makeup", "extended and request room cleaning": the request comes with it
  const CLEAN_REQ = /^[\s,.\-–—&+\/]*(?:and\s+)?(?:(?:please|pls|plz|kindly)\s+)?(?:(?:request(?:ed|ing)?|needs?|needed|give|do|provide)\s+)?(?:the\s+)?(?:room\s+)?(?:cleaning|clean|make\s*-?\s*up|makeup|mur|service|services)\b/;
  const NO_CLEAN = /^[\s,.\-–—]*(?:but\s+)?(?:no|don'?t|do\s+not)\s+(?:need\s+(?:to\s+)?|needed\s+)?(?:room\s+)?(?:clean\w*|service|make\s*-?\s*up|makeup)\b[\s\w]*$/;
  function classify1(rest) {
    let r = cleanRest(rest);
    if (!r) return null;
    const note = { act: 'note', note: r };
    let low = r.toLowerCase(), m;
    while (LEAD.test(low)) low = low.replace(LEAD, '');
    low = low.replace(/^physically\s+(?=(?:checked\s*-?\s*out|checkedout|vacated|left)\b)/, '');   // "physically checked out": HK saw it empty
    low = low.replace(/^(?:the\s+)?(?:stay|booking)\s+(?:is\s+|has\s+been\s+)?(?=extended\b)/, '');   // "Stay Extended"
    // "507 left, waiting finance", "507 guest left, folio with finance", "507 res to fix" → 🧾 waiting for Finance / Reservations
    const FIN = /\b(?:finance|accounts?|folio|reservations?|res)\b/;
    if (FIN.test(low) && /\b(?:done|fixed|ok|okay|cleared|sorted|settled|closed)\b/.test(low) && !/\b(?:wait\w*|pending|to\s+fix)\b/.test(low)) return { act: 'findone' };
    if (/^(?:left|out|gone|checked\s*-?\s*out|c\/?o)\b/.test(low) && /\b(?:balance|bill|billing|city\s*ledger|payment)\b/.test(low) && /\b(?:pending|open|due|wait\w*|outstanding|unpaid|not\s+(?:paid|settled))\b/.test(low)) return { act: 'fin', who: 'Finance' };   // "514 left, balance pending"
    if (FIN.test(low) && (/\b(?:wait\w*|pending|to\s+(?:fix|correct|check|update|amend|adjust|close)|hold|check(?:ing)?)\b/.test(low) || /\bwith\s+(?:the\s+)?(?:finance|accounts?|reservations?|res)\b/.test(low) || /^(?:left|out|gone)\b/.test(low))) {
      return { act: 'fin', who: /\b(?:reservations?|res)\b/.test(low) && !/\b(?:finance|accounts?|folio)\b/.test(low) ? 'Reservations' : 'Finance' };
    }
    if (/^fixed\s*[.!✓✔✅]*$/u.test(low)) return { act: 'findone', weak: true };
    // "507 TD + RC", "507 TD done", "507 waiting for TD", "507 only TD left", "507 all done": the extension's paperwork
    if (!/\bext\w*|\bextend/.test(low) && (PAPER.some(([, re]) => new RegExp('^' + re.source).test(low)) || /^(?:waiting|wait|pending|only|just|still)\b/.test(low) && paperOf(low))) {
      const pp = extending(low); if (Object.keys(pp).length > 1) return Object.keys(pp).join() === 'act,pay' ? Object.assign(pp, { weak: true }) : pp;   // "305 payment done" alone may be a dental kit: only for a room that is extending
    }
    if (/^all\s+(?:done|ok|okay|complete|completed|ready)\s*[.!✓✔✅]*$/u.test(r.toLowerCase())) return Object.assign(extending(r.toLowerCase()), { weak: true });   // only for a room that is extending
    // "421 Early Depart": the guest already left, before the day's check-out time → checked out ("early departure tomorrow" stays a note)
    // "524 523 516 please make check out": housekeeping saying the rooms are free → checked out
    const NOT_YET = /\?|\b(?:tomorrow|tomm?orr?ow|tmrw?|tmr|tmw|will|might|maybe|may|plan\w*|request\w*|wants?|asking|cancel\w*|not|no|later|tonight|next)\b/;
    if ((m = low.match(/^early\s*(?:depart(?:ure|ed|ing)?|dep|d\/o|check\s*-?\s*out|checkout|c\/?o)\b\.?\s*(.*)$/)) && !NOT_YET.test(m[1])) return { act: 'co', why: 'early departure' };
    if ((m = low.match(/^(?:(?:please|pls|plz|pl|kindly)\s+)?make\s+(?:the\s+|it\s+)?(?:check\s*-?\s*out|checkout|c\/?o)\b\.?\s*(.*)$/)) && !NOT_YET.test(m[1])) return { act: 'co' };
    // "626 4 pm", "315 - 3 pm", "512 14:00": a bare time after a room = late check-out at that time (needs am/pm or minutes)
    if ((m = low.match(/^(?:at\s+|till\s+|until\s+|by\s+)?(\d{1,2}(?:\s*[:.;]\s*\d{2})?\s*(?:am|pm|a\.m\.?|p\.m\.?)|\d{1,2}\s*[:.;]\s*\d{2})\s*$/))) { const tm = hoWaTime(m[1].replace(/\s*([:.;])\s*/, ':').replace(/;/, ':')); if (tm && tm >= '12:00') return { act: 'lco', time: tm }; }   // a morning time is not a late check-out
    // "301 luggage inside", "bags still in the room", "room occupied": the guest has not gone → 🤔 might extend
    const lowE = low.replace(/[\p{Extended_Pictographic}\uFE0F]/gu, ' ').replace(/\s+/g, ' ').trim();
    if (!/\?|\bnot\b|\bno\b/.test(low) && (
      /^(?:still\s+)?(?:(?:his|her|their|guest'?s?)\s+)?(?:luggages?|lugages?|lugguages?|laggages?|baggages?|bags?|suitcases?|belongings|things|stuff|items)\s+(?:are\s+|is\s+)?(?:still\s+)?(?:inside|in\s+(?:the\s+)?room|in\s*side|in)\s*(?:the\s+room)?\s*$/.test(lowE) ||
      /^(?:still\s+)?inside\s+(?:luggages?|baggages?|bags?)\s*$/.test(lowE) ||                     // "inside luggage"
      /^(?:room\s+)?(?:still\s+)?occupied\b/.test(low) || /^occ(?:\s+room)?\s*$/.test(lowE))) return { act: 'maybe', note: r };   // "OCC room"
    // "till 14:00 pm", "until 3pm (platinum member)": the guest keeps the room till then → late check-out
    if ((m = lowE.match(/^(?:till|until|untill|til|upto|up\s*to)\s*(\d{1,2}(?:\s*[:;.]\s*\d{2})?\s*(?:am|pm|a\.m\.?|p\.m\.?|hrs?)?)\s*(?:\([^)]*\))?\s*$/))) {
      const t = fixT(m[1]); if (timeStrict(t)) { const tm = hoWaTime(t); if (afterNoon(tm)) return { act: 'lco', time: tm }; }
    }
    // "2 PM check out", "5pm checkout": the time first → a late check-out at that time
    if ((m = lowE.match(/^(\d{1,2}(?:\s*[:.]\s*\d{2})?\s*(?:am|pm|a\.m\.?|p\.m\.?))\s*(?:check\s*-?\s*out|checkout|c\/o|co|chk\s*out)\s*$/))) {
      const tm = hoWaTime(fixT(m[1])); if (afterNoon(tm)) return { act: 'lco', time: tm };
    }
    // "on extension": the extension is on its way (⏳ Extending; "Extended" follows once it is done)
    if (/^on\s+extension\b/.test(low) && !/\bnot\b|\bcancel\w*/.test(low)) return extending(low.replace(/^on\s+extension\b/, ''));
    const dc = dictClassify(low, r); if (dc) return dc;
    if ((m = low.match(new RegExp('^' + LCO_W + '(?![a-z])\\s*(.*)$')))) {
      if (/\?|\b(?:cancel\w*|tomorrow|tomm?orr?ow|tmrw|tmr|tmw)\b/.test(m[1])) return note;
      return { act: 'lco', time: hoWaTime(m[1]) };
    }
    if ((m = low.match(/^late\s*(?:till|until|untill|til|to|up\s*to|upto|by|at)\s*(.+)$/)) || ((m = low.match(/^late\s+(.+)$/)) && timeStrict(m[1]))) {
      const tm = hoWaTime(m[1]); if (tm) return { act: 'lco', time: tm };
    }
    // "staying 2 more nights", "wants to extend till Friday", "thinking to extend": said in words
    const nx = naturalExt(low); if (nx) return nx;
    // "extending", "will extend", "wants to extend", "ext pending", "extension request": on its way (⏳ Extending), not extended yet
    if ((m = low.match(/^(?:wants?|wanted|would\s+like|will|is\s+going|going|plans?|planning|asking|asked|requests?|requested|requesting)\s+(?:to\s+)?(?:ext|extend|extension|extending|stay\s+longer)\b(.*)$/))) return extending(m[1]);
    if ((m = low.match(new RegExp('^' + EXT_W + '(?![a-z])\\.?\\s*(.*)$')))) {
      const w = low.match(/^[a-z]+/)[0], tail = m[1];
      if (TMRW_TOO.test(tail)) return { act: 'ext', nights: 1 };                  // "extending tomorrow also"
      if (w !== 'extending' && NO_CLEAN.test(tail)) return { act: 'ext' };                  // "extended but no need clean"
      if (/\?|\b(?:maybe|might|not|cancel(?:led|ed)?|no)\b/.test(tail)) return note;
      if (w !== 'extending' && CLEAN_REQ.test(tail) && !WHEN_NOT.test(tail.replace(/\brequest(?:ed|ing)?\b/, ''))) return { act: 'ext' };   // "extended room cleaning"
      if (w === 'extending' || /\b(?:pending|request(?:ed)?|req|wants?|will|planning|soon|waiting|booking|sign(?:ed|ature)?|td|rc|payment)\b/.test(tail)) return extending(tail);
      const x = extDetail(tail); return x ? Object.assign({ act: 'ext' }, x) : note;
    }
    if ((m = low.match(/^\+\s*(\d{1,2})\s*(?:n|nt|nts|nights?)\b\s*(.*)$/))) {
      const n = +m[1]; return n >= 1 && n <= 90 && !WHEN_NOT.test(m[2]) ? { act: 'ext', nights: n } : note;
    }
    if ((m = low.match(new RegExp('^' + CO_W + '(?![a-z])\\s*(.*)$')))) {
      const tail = m[1].trim();
      if (!tail || FILLER.test(tail)) return { act: 'co' };
      if (!CO_NOT.test(tail) && !WHEN_NOT.test(tail) && !timeStrict(tail)) return { act: 'co' };
      return natural(low) || note;                                                 // "check out at 2", "co in 10 min"
    }
    // words that mean "gone" only when nothing else follows ("324 out of order", "324 left luggage" are notes)
    if ((m = low.match(/^(?:out|left|vacated|vacated\s+the\s+room|departed)(?![a-z])\s*(.*)$/)) && FILLER.test(m[1].trim())) return { act: 'co' };
    // said in words: "checking out in 10 mins", "514 gone", "will leave around 1:30"
    const nat = natural(low); if (nat) return nat;
    // a typo of a command ("chekout", "lcoo"): Ops Brain's matcher (wa-brain.js), when it is there
    const fz = fuzzyOf(r);
    if (fz && fz.m && /^(?:co|lco|ext)$/.test(fz.m) && (fz.conf === 'exact' || fz.conf === 'likely')) {
      const g = fz.conf === 'likely' ? { guess: fz.word } : {};
      if (fz.m === 'co') return Object.assign({ act: 'co' }, g);
      if (fz.m === 'lco') return Object.assign({ act: 'lco', time: hoWaTime(fz.tail || '') }, g);
      const x = extDetail(fz.tail || ''); if (x) return Object.assign({ act: 'ext' }, x, g);
    }
    // no Ops Brain matcher, or it was not sure: our own small typo check ("EXTENDE", "exended", "chekd out")
    if (!fz || fz.conf === 'unsure') {
      const ty = typoCmd(low);
      if (ty) {
        if (ty.m === 'co' && FILLER.test(ty.tail)) return { act: 'co', guess: ty.word };
        if (ty.m === 'ext') { const x = extDetail(ty.tail); if (x || FILLER.test(ty.tail)) return Object.assign({ act: 'ext' }, x || {}, { guess: ty.word }); }
      }
    }
    if (fz && fz.conf === 'unsure') return Object.assign(note, { askWord: fz.word });
    return note;
  }

  /**
   * One WhatsApp message → { kind: 'ignore'|'none'|'act', actions: [{room, act:'co'|'lco'|'ext'|'note', time?, nights?, until?, note?}] }
   * room keeps the digits as written ("0113"); match rooms with parseInt (0113 == 113).
   */
  // what HotelOps itself posts in the group starts with "✅ HotelOps ·" or carries an invisible mark (U+2063):
  // read back, it is never a command
  const HO_MARK = '⁣';
  const isHoText = t => { t = String(t == null ? '' : t); return t.indexOf(HO_MARK) >= 0 || /^[\s⁣]*✅\s*HotelOps\b/u.test(t); };
  // a list's first line, said many ways → one command word ("Checkout list:", "Departures done", "Checked out: 101, 102")
  const HEADS = [
    [/^\s*(?:today'?s\s+)?departures?\s+(?:done|completed|finished|checked[\s-]*out|out|vacated)\b\s*[:\-–—]?\s*/i, 'CO '],
    [/^\s*(?:today'?s\s+)?(?:check[\s-]*outs?|checkouts?|c\/o|co)\s+(?:list|done|completed|finished|so\s+far|update)\b\s*[:\-–—]?\s*/i, 'CO '],
    [/^\s*(?:checked[\s-]*out|check[\s-]*outs|checkouts)\s*[:\-–—]\s*/i, 'CO '],
    [/^\s*(?:late\s*(?:check[\s-]*outs?|checkouts?|c\/?o'?s?)|lcos?)\s*(?:list)?\s*[:\-–—]\s*/i, 'LCO '],
    [/^\s*(?:extensions?|extended)\s*:\s*/i, 'EXT '],
    // "See the below extension", "Below rooms on extension:", "See the below late departure"
    [/^\s*(?:please\s+)?(?:see\s+)?(?:the\s+)?below\s+(?:rooms?\s+)?(?:are\s+)?(?:on\s+)?(?:extensions?|extending)(?:\s+rooms?)?\s*[:\-–—]?\s*$/i, 'extending '],
    [/^\s*(?:please\s+)?(?:see\s+)?(?:the\s+)?below\s+(?:rooms?\s+)?(?:are\s+)?extended(?:\s+rooms?)?\s*[:\-–—]?\s*$/i, 'EXT '],
    [/^\s*(?:please\s+)?(?:see\s+)?(?:the\s+)?below\s+(?:rooms?\s+)?(?:are\s+)?(?:on\s+)?late\s+(?:departures?|check[\s-]*outs?|checkouts?)(?:\s+rooms?)?\s*[:\-–—]?\s*$/i, 'LCO '],
  ];
  // "1. 101 CO", "2) 102", "- 103", "• 104"
  const BULLET = /^\s*(?:\d{1,2}[.)]|[-•*·▪●◦–])\s+/;
  // nothing but a tick after the room: "101 ✓", "102 ✅", "103 done" (a list line, or nothing on its own)
  const TICK = /^[\s✓✔✅☑👍.,;:!*\-–—]*(?:done|ok|okay)?[\s✓✔✅☑👍.!]*$/iu;
  // "212.319.504" is a list of rooms only when every part has 3-4 digits (not "12.30", "29.02", "18.10.2026", "AED 50.00")
  const DOT_ROOMS = /(?<![\d.,])\d{3,4}(?:\.\d{3,4})+(?![\d]|[.,]\d)/g;
  function headLine(l) {
    l = l.replace(BULLET, '').replace(DOT_ROOMS, m => m.split('.').join(', '));
    for (const [re, w] of HEADS) if (re.test(l)) return l.replace(re, w);
    return l;
  }
  /** a list line under a heading: "101" under "CO", "202 2pm" under "Late check-outs:", "0113 2N" under "Extended:" */
  function underHead(head, rest) {
    if (TICK.test(rest)) return Object.assign({}, head);
    if (head.act === 'lco' && timeStrict(rest) && !WHEN_NOT.test(rest)) { const tm = hoWaTime(rest); if (tm) return { act: 'lco', time: tm }; }
    if (head.act === 'ext') { const x = extDetail(rest); if (x && (x.nights || x.until)) return Object.assign({ act: 'ext' }, x); }
    return null;
  }
  const DICT_LEAD = new RegExp('^([a-z][a-z0-9\\/.&-]{0,15})\\s*[:\\-–—]?\\s*(?=' + ROOM_NC + '(?!\\s*(?:am|pm|hrs?|h)\\b))', 'i');
  function dictLead(seg) { const m = seg.match(DICT_LEAD); return m && lookup(m[1].toLowerCase().replace(/[.:]+$/, '')) ? m : null; }
  // a short word after a room that we do not know ("415 ckd"): HotelOps asks the team what it means instead of guessing.
  // Common words, hotel words and the parser's own words are never asked about.
  const ASK_STOP = new Set(('please pls plz pl room rm guest gst check chk done ok okay oki thanks thank thx ty asap clean cleaning ' +
    'dirty ready wait hold late early now later soon here there gone yes no not sir maam team hk fo mgr help fix fixed leak smell ' +
    'lost found food paid cash card bill key keys safe iron sofa cot crib bed beds towel towels soap water mini bar minibar ac tv wifi ' +
    'noise sick vip dnd ooo oos oor na td rc res bkg pay hi hello call msg sleep bath tub lamp light door lock bags bag pax kid kids baby baggage luggage ' +
    'urgent pending update info noted inform sure fine good bad issue new old open close closed sent send pick drop taxi cab car ' +
    'and the a an is are was has have had it its in on at to of for by up down off all any one two more less too also just still ' +
    'yet again then than this that these those what when where who why how which with from into over under after before ' +
    'khalas tamam yalla shukran habibi inshallah insha mafi free empty vacant leaving going coming left out stay min mins hour hours half noon lunch ' +
    'shortly quick fast will wants want needs need asked asking says said told dep exit desk lobby bell ' +
    // what guests ask HK for, and how the team asks about a room ("405 sugar", "509 status", "416 makeup")
    'tea cup cups milk sugar coffee spoon comb glass mat pen kit shaving dental tissue tissues pillow pillows slipper slippers hanger hangers ' +
    'shampoo gel cap razor water bottle bottles kettle dryer adaptor adapter plug cable charger vase makeup mur status states update ok').split(' '));
  // the best guess for a word nobody taught us: what it is closest to (asked as "Did you mean …?")
  const GUESS_W = [['co', ['checkedout', 'checkout', 'checkingout', 'checked', 'departed', 'vacated', 'left']], ['ext', ['extended', 'extend', 'extension', 'extending', 'stay', 'staying']],
    ['lco', ['latecheckout', 'late', 'lateco']], ['hk', ['vacantdirty', 'vacantclean', 'vacant', 'dirty', 'clean', 'inspected', 'occupied', 'ready', 'cleaning']]];
  function guessOf(word) {
    const w = String(word || '').toLowerCase().replace(/[^a-z]/g, ''); if (w.length < 3) return '';
    let best = null;
    GUESS_W.forEach(([m, list]) => list.forEach(g => {
      const k = dist(w, g), lim = g.length >= 7 ? 3 : g.length >= 5 ? 2 : 1;
      const pre = g.startsWith(w) && w.length >= 3 ? 0.5 : 9;                 // "exten" → extended
      const sub = w.length >= 3 && w[0] === g[0] && (() => { let i = 0; for (const ch of g) if (ch === w[i]) i++; return i === w.length; })() ? 1.5 : 9;   // "ckd" → checked, "cln" → clean
      if (k === 0) return;                                                     // a real word, not a typo
      const sc = Math.min(k <= lim ? k : 9, pre, sub);
      if (sc < 9 && (!best || sc < best.sc)) best = { m, sc };
    }));
    return best ? best.m : '';
  }
  function askWord(rest, words) {
    const w = String(rest || '').trim().replace(/[\s.!,;:]+$/, '').toLowerCase();
    if (!/^[a-z][a-z\/.\-]{1,13}$/.test(w)) return '';
    const bare = w.replace(/[\/.\-]/g, '');
    if (bare.length < 2 || ASK_STOP.has(bare) || ASK_STOP.has(w)) return '';
    if (bare.length > 6 && !guessOf(bare)) return '';                        // a longer word is only asked when it looks like a typo of one we know
    if (bare.length >= 5 && !guessOf(bare) && [...ASK_STOP].some(x => x.length >= 5 && dist(bare, x) === 1)) return '';   // "cofee", "tisuue", "staus": a typo of an everyday word
    if (lookup(w) || lookup(bare)) return '';
    return w;
  }
  // rooms said inside a sentence (not first): only taken when the words around them are a clear action
  const ROOM_G = '(?<![\\d:.\\/,$+-]|(?:aed|dhs?|ext|extn|tel|phone|call|mob|mobile|x)\\.?\\s*)' + ROOM_NC + '(?!\\s*(?:am|pm|a\\.m|p\\.m|hrs?|h|aed|dhs?|n|nts?|nights?|mins?|minutes|days?)\\b|\\s*[\\/-]\\s*\\d)';
  const ROOM_LIST = new RegExp('(?:\\b(?:in|of|from|for|at)\\s+)?' + ROOM_G + '(?:\\s*(?:,|&|\\+|\\/|\\band\\b)\\s*' + ROOM_G + ')*(?:[\'’]s\\b)?', 'gi');
  function roomInside(seg) {
    if (/\d{5,}|\+\s*\d{3}/.test(seg)) return null;                             // a phone number, not rooms
    const L = seg.match(ROOM_LIST); if (!L || L.length !== 1) return null;
    const rooms = L[0].match(/\d{3,4}/g) || []; if (!rooms.length || rooms.length > 8) return null;
    const rest = seg.replace(ROOM_LIST, ' ').replace(/\s+/g, ' ').trim();
    const c = classify(rest);
    return c && c.act !== 'note' && c.act !== 'ignore' && !c.weak ? { rooms, rest, c } : null;
  }
  /** edit distance with swapped letters (Damerau), for short words only */
  function dist(a, b) {
    const m = a.length, n = b.length; if (Math.abs(m - n) > 2) return 9;
    const d = Array.from({ length: m + 1 }, (_, i) => [i].concat(Array(n).fill(0))); for (let j = 1; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
    return d[m][n];
  }
  const TYPO_W = [['ext', ['extended', 'extend', 'extension', 'extending', 'extnd']], ['co', ['checkedout', 'checkout', 'checkingout']]];
  /** a mistyped command at the start: "extende 2n" → {m:'ext', word:'extende', tail:'2n'}; "chekd out" → {m:'co'} (one or two letters off) */
  function typoCmd(low) {
    const w = low.match(/^([a-z]+)(?:\s+([a-z]+))?/); if (!w) return null;
    const tries = [[w[1], low.slice(w[1].length)]];
    if (w[2]) tries.unshift([w[1] + w[2], low.slice(w[0].length)]);      // "chekd out" → "chekdout"
    for (const [word, tail] of tries) {
      if (word.length < 5) continue;
      for (const [m, list] of TYPO_W) for (const good of list) {
        const k = dist(word, good);
        if (k && k <= (word.length <= 6 ? 1 : 2) && word[0] === good[0]) return { m, word, tail: tail.trim() };
      }
    }
    return null;
  }
  let FUZZY = null;
  function fuzzyOf(r) {
    const f = FUZZY; if (typeof f !== 'function') return null;
    try { const x = f(r, {}); return x && typeof x === 'object' ? x : null; } catch (_) { return null; }
  }
  /** opt.words: a lookup(word) → {m, label} to use instead of window.hoWaWords (the WhatsApp window passes the list HotelOps sent it) */
  function hoWaParse(text, opt) {
    WORDS = dictOf(opt);
    NOW = nowOf(opt && opt.now);
    FUZZY = opt && typeof opt.fuzzy === 'function' ? opt.fuzzy : (() => { try { const b = globalThis.hoWaBrainPure; return b && typeof b.wbReadCmd === 'function' ? b.wbReadCmd : null; } catch (_) { return null; } })();
    if (isHoText(text)) return { kind: 'ignore', actions: [], ho: true };
    const lines = sp(text).replace(EDITED_TAIL, '').split(/\r?\n/).map(l => noMention(l.replace(MEDIA_LEAD, '')));
    if (APP_POST.test((lines.find(l => l.trim()) || ''))) return { kind: 'ignore', actions: [] };   // HotelOps' own summary, shared by hand
    const kept = lines.filter(l => l.trim() && !IGNORE_LINE(l));
    if (lines.some(l => l.trim()) && !kept.length) return { kind: 'ignore', actions: [] };
    if (lines.some(l => /Extensions\s*[—–-]\s*\d{1,2}:\d{2}/.test(l))) return { kind: 'ignore', actions: [] };   // the app's own post
    const actions = [], seen = new Set();
    let pending = [], lastNote = null, head = null, ask = null;
    const add = (rooms, c) => rooms.forEach(room => {
      if (c.act === 'ignore') return;                      // a word the hotel marked "ignore"
      const a = Object.assign({ room }, c), k = actionKey(a);
      if (!seen.has(k)) { seen.add(k); actions.push(a); }
    });
    kept.forEach(line => {
      let lineCmd = null;
      // "202 CO, 205 LCO 2pm": a comma before another room starts a new part
      headLine(line).trim().split(SPLIT).forEach(seg => {
        seg = seg.trim();
        let cmd = '';
        const cm = seg.match(CMD_LEAD) || dictLead(seg);   // the command first: "CO 324", "EXT 0113 2N", "VD: 315"
        if (cm) { cmd = cm[1]; seg = seg.slice(cm[0].length); }
        let { rooms, rest } = takeRooms(seg), inner = null;
        // the room inside the sentence: "guest in 514 left", "keys returned 514", "checked out 514 and 516"
        if (!cmd && !rooms.length && (inner = roomInside(seg))) { rooms = inner.rooms; rest = inner.rest; }
        const bare = !cmd && rooms.length && TICK.test(rest);
        if (!cmd && !rooms.length && !inner && FILLER.test(seg)) return;   // "Thank you 🙏" under a list of rooms is not about them
        if (!cmd && !inner && rooms.length && askOnly(rest)) { pending = []; lastNote = null; return; }   // "101 112 any update due out rooms plz": asking, nothing to do
        let c = inner ? inner.c : bare ? null : classify(cmd ? cmd + ' ' + rest : rest);
        if (cmd || inner) lineCmd = c;
        else if (!c && rooms.length && lineCmd) c = lineCmd;  // "CO 324, 325"
        if (!cmd && rooms.length && head && !lineCmd && (bare || (c && c.act === 'note'))) { const h = underHead(head, rest); if (h) c = h; }   // a list under its heading
        if (rooms.length && !c) { pending = pending.concat(rooms); return; }
        if (!c) return;
        const target = pending.concat(rooms); pending = [];
        // "415 ckd": a word we do not know → ask, do nothing with it
        const aw = !cmd && target.length && c.act === 'note' && !c.word ? (c.askWord || askWord(rest, true)) : '';
        if (aw) { if (!ask) ask = { word: aw, room: target[0], rooms: target.slice(), text: sp(text).trim().slice(0, 300), guess: guessOf(aw) }; lastNote = null; return; }
        if (target.length) { add(target, c); lastNote = c.act === 'note' ? actions.filter(a => a.act === 'note' && target.includes(a.room)) : null; }
        else if (c.act !== 'note') { head = c; lastNote = null; }   // "CO" / "Checkout list:" on its own line: the rooms below
        else if (lastNote && lastNote.length) lastNote.forEach(a => { a.note += ' ' + seg.replace(/[\s.!,;]+$/, ''); });   // a note's next line
      });
    });
    // a reply to HotelOps' own no-answer list ("🚫 NA Rooms"): "guest inside" for one of those rooms says what changed
    const q = opt && opt.quote ? sp(opt.quote) : '';
    if (q && /NA\s*Rooms|no\s*answer|🚫/iu.test(q)) {
      const qr = new Set((q.match(/\b\d{3,4}\b/g) || []).map(x => String(parseInt(x, 10))));
      actions.forEach(a => { if (a.act === 'note' && (!qr.size || qr.has(String(parseInt(a.room, 10))))) a.note = a.note.replace(/^./, c => c.toUpperCase()) + ' (was No answer)'; });
    }
    const out = { kind: actions.length ? 'act' : 'none', actions };
    if (ask) out.ask = ask;
    return out;
  }
  function actionKey(a) {
    const x = a.act === 'fin' ? (a.who || '') : a.act === 'lco' && a.soon ? 'in' + a.soon : a.act === 'ext' ? (a.nights ? a.nights + 'n' : a.until || '') : a.act === 'extending' ? ['book', 'sign', 'td', 'pay'].map(k => a[k] === undefined ? '' : k[0] + (a[k] ? 1 : 0)).join('') : (a.time || '');
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
  const P_NAME = { book: 'booking', sign: 'RC', td: 'TD', pay: 'payment' }, P_DONE_NAME = { book: 'booking made', sign: 'RC signed', td: 'TD collected', pay: 'paid in full' };
  /** "⏳ Extending 507 · waiting TD, RC" · "✓ 507 TD collected" · "⏳ 507 ready → mark extended" (f: {book, sign, td, pay}) */
  function paperChip(room, f) {
    const ks = ['td', 'sign', 'pay', 'book'];
    if (ks.every(k => f[k] === true)) return '⏳ ' + room + ' ready → mark extended';
    const wait = ks.filter(k => f[k] === false), done = ks.filter(k => f[k] === true);
    if (wait.length) return '⏳ Extending ' + room + ' · waiting ' + wait.map(k => P_NAME[k]).join(', ');
    if (done.length) return '✓ ' + room + ' ' + done.map(k => P_DONE_NAME[k]).join(', ');
    return '⏳ Extending ' + room;
  }
  /** the hotel word that made it: " · VD Vacant Dirty" */
  function wordTag(a) {
    if (!a || !a.word) return '';
    const w = String(a.word).toUpperCase(), l = String(a.label || '').trim();
    return ' · ' + (l && l.toUpperCase().indexOf(w) !== 0 ? w + ' ' + l : l || w);
  }
  function chip(a) {
    if (a.guess) return chip(Object.assign({}, a, { guess: '' })) + ' · 🤔 guessed';
    if (a.act === 'fin') return '🧾 ' + a.room + ' guest left · waiting for ' + (a.who || 'Finance');
    if (a.act === 'findone') return '✓ ' + a.room + ' fixed → check out';
    if (a.act === 'co') return '✓ CO ' + a.room + wordTag(a);
    if (a.act === 'lco' && a.soon) return '⏱ ' + a.room + ' out in ' + a.soon + ' min' + (a.time ? ' (≈ ' + timeLabel(a.time) + ')' : '') + wordTag(a);
    if (a.act === 'lco') return '⏰ LCO ' + a.room + (a.time ? ' ' + timeLabel(a.time) : '') + wordTag(a);
    if (a.act === 'extending') return paperChip(a.room, a) + wordTag(a);
    if (a.act === 'maybe') return '🤔 ' + a.room + ' might extend · ' + (a.note || 'guest still inside') + wordTag(a);
    if (a.act === 'ext') return '↪ EXT ' + a.room + (a.nights ? ' +' + a.nights + 'N' : '') + (a.until ? ' → ' + untilLabel(a.until) : '') + wordTag(a);
    return '📝 note ' + a.room + wordTag(a);
  }
  return { sp, hoWaTime, timeLabel, hoWaParse, actionKey, extNights, chip, paperChip, paperOf, wordTag, dayLabel, untilLabel, isHoText, HO_MARK, askWord, guessOf };
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
  new RegExp('^\\[' + TIME + ',\\s*' + DATE + '\\]', 'i'), new RegExp('^\\[' + DATE + ',?\\s+' + TIME + '\\]', 'i'), new RegExp('^' + DATE + ',?\\s+' + TIME + '\\s+[-–]\\s', 'i'),
];
const MD_SYSTEM = new RegExp('^\\[' + TIME + '\\]\\s', 'i');   // "[11:03 PM] __Sam added Lina__" in a Markdown export
// a chat saved as Markdown: "## 22 July 2026" then "[12:40 PM] **Sam:** 516 ip" ("> _Lina: 522 - baby cot_" = the message it answers)
const MD_DAY = /^\s*#{1,4}\s+(?:[A-Za-z]+,?\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\s*$/;
const MD_MSG = new RegExp('^\\[' + TIME + '\\]\\s*\\*\\*([^*]{1,80}?):?\\*\\*:?\\s?([\\s\\S]*)$', 'i');
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// what an export writes instead of the text: deleted, or media ("<image omitted>", "[Image]") and forwarding marks
const DELETED_RX = /^\s*_?\s*(?:this message was deleted|you deleted this message|this message was deleted by (?:the )?admin\b.*)\s*_?\s*$/i;
const EDITED_RX = /\s*<this message was edited>\s*$/i;
const MARK_RX = /^\s*(?:(?:\[Forwarded\]|<[^<>\n]{0,40}\b(?:omitted|album message|unknown message)>|\[(?:Image|Video|Voice message|Audio|Sticker|GIF|Document|Contact|album message|unknown message|View once[^\]]*)\])\s*)+/i;
/** WhatsApp text → [{date, time, sender, text, iso?, edited?, deleted?, quote?}] (lines that are not a new message belong to the one above).
 *  Reads WhatsApp Web copies, phone exports (iPhone "[7/22/26, 12:40:30 PM] Sam: …", Android "22/07/2026, 12:40 - Sam: …") and Markdown exports.
 *  iso: the day for sure, when the paste itself shows the order of day and month (a "7/22/26" somewhere → month first for all). */
function hoWaParseCopied(text) {
  const out = []; let cur = null, mdDay = '', inQuote = false;
  sp(text).split(/\r?\n/).forEach(raw => {
    const line = raw.replace(/^\ufeff/, '');
    if (/^\s*#hotelops-wa\s*$/i.test(line)) { cur = null; return; }
    let hit = null, m;
    if ((m = line.match(MD_DAY)) && MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) >= 0) { mdDay = m[3] + '-' + String(MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1).padStart(2, '0') + '-' + m[1].padStart(2, '0'); cur = null; return; }
    if (mdDay && (m = line.match(MD_MSG))) hit = { time: m[1].trim(), date: mdDay, iso: mdDay, sender: m[2].trim(), text: m[3] };
    else for (const x of RX) { if ((m = line.match(x.re))) { hit = { time: m[x.t].trim(), date: m[x.d].trim(), sender: m[3].trim(), text: m[4] }; break; } }
    if (hit) { cur = hit; out.push(cur); inQuote = !!mdDay && !hit.text.trim(); return; }
    if (SYSTEM.some(re => re.test(line)) || (mdDay && MD_SYSTEM.test(line))) { cur = null; return; }   // "Messages are end-to-end encrypted", "Sam added Lina"…
    if (!cur) return;
    if (mdDay && /^\s*---\s*$/.test(line)) return;
    if (inQuote === 'more') { if (/_\s*$/.test(line)) inQuote = true; cur.quote += '\n' + line.replace(/_\s*$/, ''); return; }   // a quote over several lines ends with "_"
    if (inQuote && (m = line.match(/^\s*>\s?(.*)$/))) {
      const q = m[1].replace(/^_/, '').replace(/^[^:]{1,80}:\s*/, '');
      cur.quote = (cur.quote ? cur.quote + '\n' : '') + q.replace(/_\s*$/, '');
      if (/^_/.test(m[1]) && !/_\s*$/.test(m[1])) inQuote = 'more';
      return;
    }
    inQuote = false;
    cur.text += '\n' + line;
  });
  // the order of day and month, when the paste shows it ("7/22/26" can only be month first)
  let md = 0, dm = 0;
  out.forEach(o => { if (o.iso) return; const p = o.date.split(/[\/.\-]/).map(Number); if (p.length === 3 && p[0] <= 31) { if (p[0] > 12 && p[1] <= 12) dm++; if (p[1] > 12 && p[0] <= 12) md++; } });
  out.forEach(o => {
    let t = o.text.replace(/\s+$/, '').replace(/^\n+/, '');
    if (EDITED_RX.test(t)) { o.edited = true; t = t.replace(EDITED_RX, ''); }
    if (DELETED_RX.test(t)) { o.deleted = true; t = ''; }
    o.text = t.replace(MARK_RX, '');
    if (!o.iso && (md && !dm || dm && !md)) {
      const p = o.date.split(/[\/.\-]/).map(x => parseInt(x, 10)); if (p.length === 3 && p[0] <= 31) {
        const [d, mo] = md ? [p[1], p[0]] : [p[0], p[1]], y = p[2] < 100 ? 2000 + p[2] : p[2];
        if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) o.iso = y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      }
    }
    if (o.quote) o.quote = o.quote.trim();
  });
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
const R_LABEL = { fin: '🧾 waiting for', extending: '⏳ Extending', deleted: '🗑 deleted', co: '✓ CO', lco: '⏰ LCO', ext: '↪ EXT', note: '📝 note', req: '📝 Request · room', maybe: '🤔 might extend', wait: '⏳ waiting for today\'s list', notlist: '⚠ not on list', skip: '· skipped', none: '— no room', ignore: '— HotelOps post', log: '🗂 log only', preview: '👁 preview', ask: '❓ asked', ho: '📋 handover' };
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
  const hay = [rec.x || '', rec.s || '', rec.r || '', rec.g || ''].join('\n');
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

// ══ The window's helpers (pure) ═════════════════════════════
/** "Sam Test" → "ST", "+971 50 000 0000" → '' (a phone number gets a phone icon) */
const isPhone = s => /^[+\d][\d\s()\-]{6,}$/.test(String(s || '').trim());
function initials(s) {
  s = String(s || '').trim(); if (!s || isPhone(s)) return '';
  const w = s.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  return ((w[0] || '')[0] || '?').toUpperCase() + (w[1] ? w[1][0].toUpperCase() : '');
}
/** a steady colour for a name (hue 0-359) */
function hueOf(s) { let h = 7; s = String(s || ''); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i) * 97) % 3600; return Math.floor(h / 10); }
/** the balance a check-out left: under AED 1 is "tiny" (not a warning) */
function balInfo(r) {
  let b = r && typeof r.bal === 'number' ? r.bal : null;
  if (b == null && r && r.text) { const m = String(r.text).match(/balance AED ([\d.,]+)/); if (m) b = parseFloat(m[1].replace(/,/g, '')); }
  if (!(b > 0)) return null;
  const amt = b.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return b < 1 ? { tone: 'tiny', label: 'balance AED ' + amt + ' (tiny)' } : { tone: 'warn', label: '⚠ balance AED ' + amt };
}
/** one log entry → which filters it is in: actions, notes, attention, ignored */
function entryKinds(l) {
  const k = new Set(), res = (l && l.res) || [];
  res.forEach(r => {
    if (/^(?:co|lco|ext|extending|maybe|fin)$/.test(r.st)) k.add('actions');
    if (r.guess) k.add('attention');
    if (r.st === 'note' || r.st === 'req') k.add('notes');
    if (r.st === 'notlist' || r.st === 'ask' || (r.st === 'deleted' && / check/.test(r.text || '')) || /nights not said|could not read/.test(r.text || '') || (balInfo(r) || {}).tone === 'warn') k.add('attention');
    if (/^(?:none|ignore|log|preview)$/.test(r.st)) k.add('ignored');
    if (r.st === 'ho') k.add('notes');
  });
  if (l && l.undone) { k.delete('actions'); k.add('ignored'); }
  return k;
}
/** "09:41" → "9 AM" (the timeline's hour heading) */
function hourLabel(t) { const m = String(t || '').match(/^(\d{1,2}):/); if (!m) return 'Earlier'; const h = +m[1]; return (h % 12 || 12) + (h >= 12 ? ' PM' : ' AM'); }
/**
 * Today's checkout list for the group (HotelOps' own post: it starts with "✅ HotelOps ·", so it is never read back as commands)
 * rooms: [{roomStr, status, lateTime?, extensionNights?}]
 */
function checkoutListText(list, now) {
  now = now || new Date();
  const hm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  const by = st => (list || []).filter(r => r && r.status === st).map(r => r.roomStr).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  const out = by('out'), late = (list || []).filter(r => r && r.status === 'late').sort((a, b) => parseInt(a.roomStr, 10) - parseInt(b.roomStr, 10));
  const ext = (list || []).filter(r => r && r.status === 'extended').sort((a, b) => parseInt(a.roomStr, 10) - parseInt(b.roomStr, 10));
  const due = (list || []).filter(r => r && !/^(?:out|late|extended)$/.test(r.status)).map(r => r.roomStr).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  const L = ['✅ HotelOps · Checkout list · ' + hm];
  L.push(`Checked out (${out.length}): ${out.join(', ') || '—'}`);
  if (late.length) L.push(`Late check-out (${late.length}): ${late.map(r => r.roomStr + (r.lateTime ? ' (' + timeLabel(r.lateTime) + ')' : '')).join(', ')}`);
  if (ext.length) L.push(`Extended (${ext.length}): ${ext.map(r => r.roomStr + (r.extensionNights ? ' (+' + r.extensionNights + 'N)' : '')).join(', ')}`);
  L.push(`Still due (${due.length}): ${due.join(', ') || '—'}`);
  return L.join('\n');
}
/** the quick templates: {room} and {time} filled in */
const TEMPLATES = [
  { k: 'co', label: '✓ CO done', t: '{room} CO done ✓', need: 'room' },
  { k: 'clean', label: '🧹 Please clean', t: '{room} please clean', need: 'room' },
  { k: 'lco', label: '⏰ LCO approved', t: '{room} LCO {time} approved', need: 'room time' },
  { k: 'ext', label: '↪ Extensions', t: 'Extensions — {time}: {ext}', need: '' },
];
function fillTemplate(t, v) { return String(t).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null && v[k] !== '' ? v[k] : m)); }

/** the console snippet, ready to paste: this app's address and the parser filled in */
function snippet(raw, appUrl) {
  return String(raw).replace("'__HO_APP_URL__'", () => JSON.stringify(appUrl)).replace('/*__HO_PARSER__*/null', () => '(' + hoWaParser.toString() + ')()');
}
W.hoWaPure = { hoWaParse, findRoom, hoWaParseCopied, hoWaTime, timeLabel, waDateISO, waTime24, actionKey, extNights: HP.extNights, chip: HP.chip, snippet,
  safeKey, hashKey, archR, archChips, hoWaMatch, hoWaSearch, hoWaHi, hoWaExportTxt, hoWaExportCsv, hoWaExportName,
  isHoText: HP.isHoText, HO_MARK: HP.HO_MARK, askWord: HP.askWord, wordTag: HP.wordTag, isPhone, initials, hueOf, balInfo, entryKinds, hourLabel, checkoutListText, TEMPLATES, fillTemplate };
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
const undoParts = {};      // log key → [{room, st, fn(quiet)}], to undo one message when it is deleted in WhatsApp

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
  if (msg.group) rec.g = String(msg.group).slice(0, 80);
  if (msg.quote) rec.q = String(msg.quote).slice(0, 300);
  if (!partial) { if (r) rec.r = r; if (msg.mine) rec.m = 1; if (msg.preview) rec.pv = 1; }
  if (msg.edited) rec.e = 1;
  archive(day, key, rec, partial);
  return key;
}

// ══ Acting on the board ═════════════════════════════════════
const FIELDS = ['status', 'checkoutAt', 'naTime', 'dndTime', 'lateTime', 'extensionNights', 'extCheckoutTime', 'extRate', 'extReason', 'extConfirmed', 'intent', 'intentMinutes', 'lcoAcknowledged', 'extBook', 'extSign', 'extTd', 'extPay', 'finWho', 'finAt', 'waAt', 'note'];
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
  if (!rooms().length) return { ok: false, today: false, why: 'no departures loaded' };
  let d = null; try { d = typeof _depBoardDate === 'function' ? _depBoardDate() : null; } catch (_) {}
  if (d && isoDay(d) < today()) return { ok: false, today: false, why: 'the board is for ' + d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) };
  if (d && isoDay(d) !== today()) return { ok: false, why: 'the board is for ' + d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) };
  return { ok: true };
}
/** is this room in the hotel? looks in the In-House Guests list (inhouse.js) first, then Purpose of Stay, Arrivals and the In-house tally → {src, name} or null */
function findRoom(room) {
  const n = parseInt(room, 10); if (!n) return null;
  // a guest whose departure is already past has left: not "in the hotel" any more
  const ih = W.hoInHouse && typeof W.hoInHouse.find === 'function' ? W.hoInHouse.find(room) : null;
  if (ih && !(ih.departure && ih.departure < (typeof hoLocalISO === 'function' ? hoLocalISO() : isoDay(new Date())))) return { src: 'in-house list', name: ih.name || '' };
  const same = x => parseInt(String(x == null ? '' : x).replace(/\D/g, ''), 10) === n;
  const nm = g => String(g.name || g.guest || [g.last, g.first].filter(Boolean).join(' ') || '').trim();
  const lists = [['in-house list', typeof purposeGuests !== 'undefined' ? purposeGuests : []], ['arrivals', typeof arrGuests !== 'undefined' ? arrGuests : []]];
  for (const [src, L] of lists) { const g = (L || []).find(x => x && same(x.room)); if (g) return { src, name: nm(g) }; }
  const maps = [typeof itGibyRooms !== 'undefined' ? itGibyRooms : null, typeof itXmlRooms !== 'undefined' ? itXmlRooms : null];
  for (const M of maps) {
    const k = M && Object.keys(M).find(same);
    if (k) { const v = M[k] || {}; return { src: 'in-house tally', name: (v.names && v.names[0]) || ((v.guests || [])[0] || {}).name || '' }; }
  }
  return null;
}
function addNoteLine(r, line) { r.note = r.note ? r.note + '\n' + line : line; }
// the same line from the same message is already on the room (another HotelOps on this board read it first): not twice
const noStamp = l => String(l).replace(/^\[\d{1,2}:\d{2}\]\s*/, '');
function hasLine(r, line) { const b = noStamp(line); return String(r.note || '').split('\n').some(l => noStamp(l) === b); }
function dropLine(note, line) { const L = String(note || '').split('\n'); const i = L.lastIndexOf(line); if (i >= 0) L.splice(i, 1); return L.join('\n'); }

/** put a room back as it was before our change (status: the depAction status we set, or null) */
function restore(roomStr, before, after, line, topJ, status, quiet) {
  const z = rooms().find(q => q.roomStr === roomStr);
  if (!z) { if (!quiet) showToast(`Room ${roomStr} is no longer on the board`, 'warn'); return false; }
  if (z.status !== after.status) { if (!quiet) showToast(`Room ${roomStr} changed since — not undone`, 'warn'); return false; }
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

/** is "HH:MM" after the room's own check-out time (Opera's departure time, else 12:00)? */
function pastLimit(r, t) {
  let lim = null; try { lim = typeof _depTimeMins === 'function' ? _depTimeMins(r) : null; } catch (_) {}
  if (lim == null || isNaN(lim)) lim = 12 * 60;
  const m = String(t).match(/^(\d{1,2}):(\d{2})$/); if (!m) return true;
  return +m[1] * 60 + +m[2] > lim;
}
// ── Commands that came before today's departures were loaded ──
// kept for today only; run as soon as today's board is up (checked every few seconds)
const LS_PEND = 'ho_wa_pend_v1';
let PEND = (() => { const v = lsGet(LS_PEND, null); return v && v.date === today() && Array.isArray(v.items) ? v.items : []; })();
function savePend() { lsSet(LS_PEND, { date: today(), items: PEND.slice(-200) }); }
function addPending(a, who, key, sender, tl) {
  const k = actionKey(a); if (PEND.some(p => p.k === k)) return;
  PEND.push({ k, a: JSON.parse(J(a)), who, key, sender, tl }); savePend();
}
// past midnight: yesterday's log and waiting commands are not today's (never run on today's board)
let DAY = today();
function rollDay() {
  if (today() === DAY) return;
  DAY = today(); LOG = []; PEND = []; saveLog(); savePend();
  try { renderCard(); } catch (_) {}
}
function flushPending() {
  rollDay();
  if (PEND[0] && lsGet(LS_PEND, {}).date !== today()) { PEND = []; savePend(); return; }
  const board = boardIsToday(); if (!board.ok) return;
  // messages from earlier today that were skipped because the list was not loaded yet: run them now too
  LOG.forEach(l => {
    if (l.undone || l.deleted || !Array.isArray(l.res)) return;
    l.res.forEach(r => {
      if (r.st !== 'notlist' || !/not on today's list|no departures loaded/.test(r.text || '')) return;
      let acts = []; try { acts = parse(l.text, l.quote || '').actions.filter(a => parseInt(a.room, 10) === parseInt(r.room, 10)); } catch (_) {}
      if (!acts.length) return;
      r.st = 'wait';
      acts.forEach(a => addPending(a, `WhatsApp · ${l.sender} ${timeLabel(l.time)}`, l.key, l.sender, timeLabel(l.time)));
    });
  });
  if (!PEND.length) return;
  const list = PEND; PEND = []; savePend();
  const done = [], undos = [];
  list.forEach(p => {
    let r; try { r = applyOne(p.a, p.who + ' (waited for the list)', board); } catch (_) { return; }
    if (r.undo) undos.push(r.undo);
    done.push(r);
    const l = LOG.find(x => x.key === p.key);
    if (l) {
      const j = l.res.findIndex(x => x.st === 'wait' && String(x.room) === String(p.a.room));
      const o = { st: r.st, room: r.room || '', text: r.text + ' · after the list was loaded' }; if (r.bal) o.bal = r.bal;
      if (j >= 0) l.res.splice(j, 1, o); else l.res.push(o);
      tell(l);
    }
  });
  saveLog(); try { renderCard(); } catch (_) {}
  if (!done.length) return;
  const msg = 'WhatsApp, done now that today\'s list is loaded: ' + done.map(r => r.text.replace(/ · .*$/, '')).join(' · ');
  if (undos.length && typeof showUndoToast === 'function') showUndoToast(msg, () => { let ok = false; undos.slice().reverse().forEach(u => { try { if (u()) ok = true; } catch (_) {} }); return ok; }, 12000);
  else if (typeof showToast === 'function') showToast(msg, 'ok');
}

/** one action → {room, act, time, st, text, undo?} */
function applyOne(a, who, board) {
  if (a.act === 'lco' && a.time === '00:00') a = Object.assign({}, a, { time: '23:59' });   // "LCO 12am / midnight": the end of today, not overdue at once
  const res = { room: a.room, act: a.act, time: a.time || '', note: a.note || '' };
  const tag = HP.wordTag(a); if (tag) res.w = tag;
  if (a.guess) { res.guess = a.guess; res.w = (res.w || '') + ' · 🤔 guessed from "' + a.guess + '"'; }
  const i = board.ok ? roomIdx(a.room) : -1;
  // a note or request for a room that is not leaving today is normal (an in-house guest): logged, no warning
  if (i < 0 && (a.act === 'note' || a.act === 'maybe')) return Object.assign(res, { st: 'req', text: `Request · room ${a.room}: ${a.note}` });
  // not on today's departures: is the room in the hotel at all? yes → put it on the board and act, no → say so
  // today's departures not loaded yet (none, or yesterday's board): the command waits and runs when they are (flushPending)
  if (!board.ok && board.today === false) return Object.assign(res, { st: 'wait', pending: a, text: `${a.room}: waiting for today's departures (${board.why}) — done as soon as you load them` });
  if (i < 0 && board.ok) {
    const f = findRoom(a.room);
    if (!f) return Object.assign(res, { st: 'notlist', text: `${a.room}: room not found — not on departures, arrivals or in-house` });
    if (typeof depAddManualRoom !== 'function' || !quiet(() => depAddManualRoom(a.room, f.name))) return Object.assign(res, { st: 'notlist', text: `${a.room}: could not add it to the board` });
    const out = applyOne(a, who, { ok: true });
    const added = rooms().find(q => q.roomStr === String(a.room).trim());
    if (added) {
      out.text = (out.text || '') + ` · added from ${f.src}`;
      const u = out.undo;
      // undo takes the room off the board again (only if nobody touched it since)
      out.undo = q => { const ok = u ? u(q) : true; const k = rooms().findIndex(z => z === added && z.manual && z.status === 'due' && !z.intent); if (ok && k >= 0) { rooms().splice(k, 1); paint(); saveDeps(); } return ok; };
    }
    return out;
  }
  if (!board.ok) return Object.assign(res, { st: 'notlist', text: `${a.room}: not on today's list (${board.why})` });
  if (i < 0) return Object.assign(res, { st: 'notlist', text: `${a.room}: not on today's departures` });
  const r = rooms()[i], room = r.roomStr, st = r.status, before = pick(r);
  // a message older than the last one acted on for this room (read late: scrolling up, searching) changes nothing
  if (a.t24 && r.waAt && a.t24 < r.waAt && a.act !== 'note') return Object.assign(res, { st: 'skip', text: `${room}: older message (${timeLabel(a.t24)}) — a newer one (${timeLabel(r.waAt)}) was already done` });
  let line, setStatus = null;
  if (a.act === 'co') {
    if (st === 'out') return Object.assign(res, { st: 'skip', text: `✓ ${room} already checked out${r.checkoutAt ? ' at ' + r.checkoutAt : ''} — nothing to do` });
    if (st === 'extended') return Object.assign(res, { st: 'skip', text: `${room}: marked extended — not changed` });
    line = `[${hhmm()}] Checked out${a.why ? ' (' + a.why + ')' : ''} — ${who}`;
    addNoteLine(r, line); setStatus = 'out';
    quiet(() => depAction(i, 'out'));
    res.st = 'co'; res.text = `${room} checked out`;
    // a balance marked fine (per room or for its source, departures.js depOwes) is no warning
    if (r.balance > 0 && (typeof depOwes === 'function' ? depOwes(r) : true)) res.bal = r.balance;
  } else if (a.act === 'lco' && (a.soon || a.plan) && a.time && !pastLimit(r, a.time)) {
    // "514 checking out in 10 mins" before the room's check-out time: ⏱ Checking Out Soon, not a late check-out
    if (st === 'out') return Object.assign(res, { st: 'skip', text: `${room}: already checked out` });
    if (st === 'extended') return Object.assign(res, { st: 'skip', text: `${room}: marked extended — not changed` });
    line = a.soon ? `[${hhmm()}] Checking out in ${a.soon} min (≈ ${timeLabel(a.time)}) — ${who}` : `[${hhmm()}] Checking out at ${timeLabel(a.time)} — ${who}`;
    if (hasLine(r, line)) return Object.assign(res, { st: 'skip', text: `${room}: already noted` });
    if (a.soon) {
      r.intent = 'checkout_soon'; r.intentMinutes = a.soon;
      res.text = `${room} checking out in ${a.soon} min`;
    } else {
      res.text = `${room} checking out at ${timeLabel(a.time)}`;
    }
    addNoteLine(r, line); paint(); saveDeps();
    res.st = 'note';
  } else if (a.act === 'lco') {
    if (st === 'out') return Object.assign(res, { st: 'skip', text: `${room}: already checked out` });
    if (st === 'extended') return Object.assign(res, { st: 'skip', text: `${room}: marked extended — not changed` });
    line = a.soon && a.time ? `[${hhmm()}] Checking out in ${a.soon} min (≈ ${timeLabel(a.time)}) — ${who}`
      : `[${hhmm()}] Late check-out ${a.time ? timeLabel(a.time) : '(no time given)'} — ${who}`;
    if (hasLine(r, line)) return Object.assign(res, { st: 'skip', text: `${room}: already late check-out${r.lateTime ? ' ' + timeLabel(r.lateTime) : ''}` });
    addNoteLine(r, line);
    if (r.intent === 'checkout_soon') { r.intent = ''; r.intentMinutes = null; }   // a new time replaces "checking out in 10 min"
    if (st === 'late') { if (a.time) r.lateTime = a.time; paint(); saveDeps(); }
    else { r.lateTime = a.time || ''; setStatus = 'late'; quiet(() => depAction(i, 'late')); }
    res.st = 'lco'; res.d = a.time ? timeLabel(a.time) : ''; res.text = `${room} late check-out ${a.time ? timeLabel(a.time) : '(no time)'}`;
  } else if (a.act === 'fin') {
    // 🧾 the guest has left, Finance / Reservations must fix the room before it is checked out in Opera (departures.js)
    if (st === 'out') return Object.assign(res, { st: 'skip', text: `${room}: already checked out` });
    if (r.intent === 'finance_hold' && r.finWho === a.who) return Object.assign(res, { st: 'skip', text: `${room}: already waiting for ${a.who}` });
    const at = hhmm();
    line = `[${at}] Guest has physically left. Waiting for ${a.who} to fix the room — ${who}`;
    addNoteLine(r, line);
    r.intent = 'finance_hold'; r.intentMinutes = null; r.finWho = a.who; r.finAt = at;
    paint(); saveDeps();
    res.st = 'fin'; res.d = a.who; res.text = `🧾 ${room} guest left · waiting for ${a.who}`;
  } else if (a.act === 'findone' && r.intent === 'extending' && !a.weak) {
    // "507 res done" on an extending room is the new booking
    return applyOne(Object.assign({}, a, { act: 'extending', book: true }), who, board);
  } else if (a.act === 'findone') {
    if (r.intent !== 'finance_hold') {
      if (a.weak) { line = `[${hhmm()}] ${who}: fixed`; addNoteLine(r, line); paint(); saveDeps(); res.st = 'note'; res.text = `${room} note: fixed`; }
      else return Object.assign(res, { st: 'skip', text: `${room}: was not waiting for Finance` });
    } else {
      const w = r.finWho || 'Finance';
      line = `[${hhmm()}] ${w} fixed the room → checked out — ${who}`;
      addNoteLine(r, line); setStatus = 'out';
      r.intent = '';
      quiet(() => depAction(i, 'out'));
      res.st = 'co'; res.text = `${room} fixed by ${w} → checked out`;
    }
  } else if (a.act === 'extending') {
    // ⏳ Extending (departures.js): the guest stays on, the paperwork is on its way — not extended yet
    if (st === 'out') return Object.assign(res, { st: 'skip', text: `${room}: already checked out` });
    if (st === 'extended') return Object.assign(res, { st: 'skip', text: `${room}: already extended` });
    if (a.weak && r.intent !== 'extending') { a = { room: a.room, act: 'note', note: a.note || 'all done' }; line = `[${hhmm()}] ${who}: all done`; addNoteLine(r, line); paint(); saveDeps(); res.st = 'note'; res.act = 'note'; res.text = `${room} note: all done`; }
    else {
      const F = { book: 'extBook', sign: 'extSign', td: 'extTd', pay: 'extPay' };
      const ch = Object.keys(F).filter(k => a[k] !== undefined && r[F[k]] !== a[k]);
      if (r.intent === 'extending' && !ch.length) return Object.assign(res, { st: 'skip', text: `${room}: already marked extending` });
      const said = {}; Object.keys(F).forEach(k => { if (a[k] !== undefined) said[k] = a[k]; });
      line = `[${hhmm()}] ${HP.paperChip(room, said).replace(/^\S+\s/, '')} — ${who}`;
      addNoteLine(r, line);
      if (r.intent !== 'extending') { r.intent = 'extending'; r.intentMinutes = null; }
      ch.forEach(k => { r[F[k]] = a[k]; });
      paint(); saveDeps();
      const now = {}; Object.keys(F).forEach(k => { now[k] = !!r[F[k]]; });
      const ready = Object.keys(F).every(k => now[k]);
      res.st = 'extending'; res.d = ready ? 'ready' : '';
      const sk = Object.keys(said), waitNow = {}; Object.keys(F).forEach(k => { if (!now[k]) waitNow[k] = false; });
      res.text = ready ? HP.paperChip(room, now)                                        // "⏳ 507 ready → mark extended"
        : sk.length && sk.every(k => said[k]) ? HP.paperChip(room, said)                 // "✓ 507 TD collected"
        : sk.length ? HP.paperChip(room, waitNow)                                         // "⏳ Extending 507 · waiting TD, RC"
        : HP.paperChip(room, {});                                                         // "⏳ Extending 507"
    }
  } else if (a.act === 'maybe') {
    // 🤔 "301 luggage inside": the guest has not gone, he may stay on (departures.js maybe_extend)
    if (st === 'out') return Object.assign(res, { st: 'skip', text: `${room}: checked out already — luggage inside? check the room` });
    if (st === 'extended') return Object.assign(res, { st: 'skip', text: `${room}: already extended` });
    line = `[${hhmm()}] ${a.note} — might extend — ${who}`;
    if (hasLine(r, line)) return Object.assign(res, { st: 'skip', text: `${room}: already noted` });
    addNoteLine(r, line);
    const was = r.intent;
    if (!was || was === 'checkout_soon') { r.intent = 'maybe_extend'; r.intentMinutes = null; }
    paint(); saveDeps();
    res.st = 'maybe'; res.text = was === 'extending' || was === 'finance_hold' ? `${room} note: ${a.note}` : `🤔 ${room} might extend (${a.note})`;
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
    if (hasLine(r, line)) return Object.assign(res, { st: 'skip', text: `${room}: already noted` });
    addNoteLine(r, line); paint(); saveDeps();
    res.st = 'note'; res.text = `${room} note: ${a.note}`;
  }
  const z = rooms().find(q => q.roomStr === room) || r, after = pick(z), topJ = setStatus ? J(dlog()[0]) : null;
  if (a.t24 && a.act !== 'note' && (!r.waAt || a.t24 > r.waAt)) { const z2 = rooms().find(q => q.roomStr === room); if (z2) { z2.waAt = a.t24; saveDeps(); } }
  res.undo = quiet => restore(room, before, after, line, topJ, setStatus, quiet === true);
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

// ══ Groups, previews, the hotel's words ═════════════════════
// A group can be "log only" (its messages are kept, no room is changed): set in the WhatsApp window here or in the reader.
const LS_GRP = 'ho_wa_grp_v1', LS_PV = 'ho_wa_pv_v1', LS_ASK = 'ho_wa_ask_v1', LS_KNOWN = 'ho_wa_known_v1', LS_WORDS = 'ho_wa_words_v1', LS_OUT = 'ho_wa_out_v1';
const gKey = g => normS(g).toLowerCase();
let GRP = (() => { const g = lsGet(LS_GRP, {}); return g && typeof g === 'object' ? g : {}; })();
function groupActs(msg) { if (msg && msg.act === false) return false; const g = GRP[gKey(msg && msg.group || '')]; return !(g && g.act === false); }
function setGroupAct(name, on) { GRP[gKey(name)] = Object.assign({}, GRP[gKey(name)], { name, act: !!on }); lsSet(LS_GRP, GRP); renderCard(); }
// A handover group (its name has "HO" or "handover" in it, or switched on here): everything posted there goes to the
// 📒 Handover Book (handover-book.js) and no room is changed. Other groups copy messages that read like handover items.
const HO_RX = /\bHO\b|hand\s*-?\s*over/i;
function groupIsHo(group) {
  const g = GRP[gKey(group || '')], set = g && typeof g.ho === 'boolean' ? g.ho : undefined;
  if (!normS(group) && set === undefined) return false;
  try { if (W.hoHandoverPure) return W.hoHandoverPure.isHandoverGroup(group, set); } catch (_) {}
  return set !== undefined ? set : HO_RX.test(normS(group));
}
function groupCopies(group) { const g = GRP[gKey(group || '')]; return !(g && g.copy === false); }
function setGroupHo(name, on) { GRP[gKey(name)] = Object.assign({}, GRP[gKey(name)], { name, ho: !!on }); lsSet(LS_GRP, GRP); renderCard(); }
function setGroupCopy(name, on) { GRP[gKey(name)] = Object.assign({}, GRP[gKey(name)], { name, copy: !!on }); lsSet(LS_GRP, GRP); renderCard(); }
/** hand one message to the Handover Book (kept for later when the book is not loaded yet) */
function hoBook(p) {
  try { if (W.hoHandoverBook && typeof W.hoHandoverBook.fromWa === 'function') { Promise.resolve(W.hoHandoverBook.fromWa(p)).catch(() => {}); return; } } catch (_) {}
  const q = lsGet('hb_queue_v1', []); (Array.isArray(q) ? q : []).push(p); lsSet('hb_queue_v1', (Array.isArray(q) ? q : [p]).slice(-200));
}
const hoBase = (msg, dIso, t24, sender, text) => (msg.id ? safeKey(msg.id) : hashKey(dIso + '|' + t24 + '|' + sender.toLowerCase() + '|' + normS(text)));
/** a message from another group that reads like a handover item ("512 early departure", "move 514 to twin"…): also in the book */
function hoCopy(msg, dIso, t24, sender, group, text, edited) {
  try {
    if (msg.preview || !groupCopies(group) || !W.hoHandoverPure) return false;
    const HP2 = W.hoHandoverPure, opt = { parse: t => hoWaParse(t) };
    const lines = String(text).split(/\n/).filter(l => l.trim());
    // "Done ✅" as a reply to a handover item (any group): the Handover Book ticks that item
    if (msg.quote && typeof HP2.doneReply === 'function' && HP2.doneReply(text)) { hoBook({ kind: 'done', base: hoBase(msg, dIso, t24, sender, text), date: dIso, time: t24, sender, group, text, quote: String(msg.quote).slice(0, 400), at: Date.now() }); return false; }
    if (!HP2.looksLikeHandover(text, opt) && !lines.some(l => HP2.looksLikeHandover(l, opt)) && !edited) return false;
    const base0 = hoBase(msg, dIso, t24, sender, text), done = loadDone(), dk = 'hc:' + base0, sig = hashKey(normS(text)), seen = String(done[dk] || '').split('|').filter(Boolean);
    if (seen.includes(sig)) return false;                                            // seen before: never twice, never an older version over a newer one
    done[dk] = seen.concat(sig).slice(-8).join('|'); saveDone(done); edited = edited || seen.length > 0;
    hoBook({ kind: 'msg', copy: true, base: hoBase(msg, dIso, t24, sender, text), mid: msg.id ? String(msg.id).slice(0, 200) : '', date: dIso, time: t24, sender, group, text, edited: !!edited, at: Date.now() });
    return true;
  } catch (_) { return false; }
}
/** a message in a handover group: saved to the book only (never changes the board) */
/** "HO - …", "HO: …", "H/O …", "Handover: …" at the start of a message (not "HOTEL", "HOLD") */
function hoMarked(text) {
  try { if (W.hoHandoverPure) return W.hoHandoverPure.hoPrefix(text) != null; } catch (_) {}
  const m = sp(text).match(/^\s*(?:\*\s*)?(?:HO|H\/O|hand\s*-?\s*over)(?![A-Za-z0-9])\s*\*?\s*[-–—:.,|>]*\s*/i);
  const rest = m ? sp(text).slice(m[0].length).trim() : '';
  return !!rest && !(/^(?:\*\s*)?(?:ho|Ho|hO)$/.test(m[0].trim()) && !/^(?:\d|r(?:oo)?ms?\b)/i.test(rest));   // "Ho gaya" is not a mark
}
function handleHo(msg, via, text, sender, group, dIso, src) {
  if (via === 'link' && !ready()) return 'wait';
  if (!text.trim() || msg.preview) return 'dup';      // a chat-list preview: the handover is read in full when the group is open
  const t24 = waTime24(msg.time) || (dIso === today() ? hhmm() : '');
  const base = hoBase(msg, dIso, t24, sender, text), mid = msg.id ? String(msg.id).slice(0, 200) : '';
  // the same message (id + text) is never saved twice; an older version read late (scrolling, searching) never undoes an edit
  const done = loadDone(), dk = 'h:' + base, sig = hashKey(normS(text)), seen = String(done[dk] || '').split('|').filter(Boolean);
  if (seen.includes(sig)) return 'dup';
  const edited = seen.length > 0 || !!msg.edited;
  done[dk] = seen.concat(sig).slice(-8).join('|'); saveDone(done);
  hoBook({ kind: 'msg', src: src || 'wa', base, mid, date: dIso, time: t24, sender, group, text, edited, at: Date.now(), quote: String(msg.quote || '').slice(0, 400) });
  let n = 1, chat = false;
  try { const HP2 = W.hoHandoverPure; if (HP2) { const L = HP2.splitItems(HP2.hoBody(text)); n = L.length || 1; chat = src !== 'prefix' && L.length > 0 && L.every(p => HP2.isChat(p.text)); } } catch (_) {}
  const r = { st: 'ho', room: '', text: chat ? '💬 Team chat · kept in the Handover Book, not added' : '📋 Saved to the Handover Book' + (n > 1 ? ' · ' + n + ' items' : '') + (src === 'prefix' ? ' · marked HO' : '') + (edited ? ' (edited)' : '') };
  ACK_RES = [{ st: 'ho', room: '', text: r.text }];
  if (dIso === today()) {
    let l = mid ? LOG.find(x => x.mid === mid) : null;
    if (l) { l.text = text.slice(0, 500); l.edited = true; l.res = [r]; delete l.deleted; }
    else { l = { key: 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: Date.now(), time: t24, sender, text: text.slice(0, 500), mine: !!msg.mine, edited, via, ho: 1, res: [r] }; if (group) l.group = group; if (mid) l.mid = mid; LOG.unshift(l); }
    saveLog(); renderCard(); tell(l);
  }
  return 'done';
}
function loadPv() { const v = lsGet(LS_PV, null); return v && v.date === today() && v.map ? v.map : {}; }
function savePv(map) { const ks = Object.keys(map); if (ks.length > 300) ks.slice(0, ks.length - 300).forEach(k => delete map[k]); lsSet(LS_PV, { date: today(), map }); }
/** a chat-list preview is acted on only when it is a short, complete command */
function previewOk(text, msg, P) {
  const t = String(text || '').trim();
  return !msg.truncated && !/(?:…|\.\.\.)$/.test(t) && t.length <= 40 && !/\n/.test(t) && P.actions.length > 0 && P.actions.length <= 3 && P.actions.every(a => a.act !== 'note');
}
// words the team taught HotelOps here, when the shared word list (wa-brain.js: window.hoWaWords) is not loaded
let LOCALW = (() => { const v = lsGet(LS_WORDS, {}); return v && typeof v === 'object' ? v : {}; })();
let KNOWN = (() => { const v = lsGet(LS_KNOWN, {}); return v && typeof v === 'object' ? v : {}; })();
function appLookup(w) {
  w = String(w || '').toLowerCase();
  try { if (W.hoWaWords && typeof W.hoWaWords.lookup === 'function') { const x = W.hoWaWords.lookup(w); if (x) return x; } } catch (_) {}
  return LOCALW[w] || null;
}
const parse = (text, quote, now) => hoWaParse(text, { words: appLookup, quote: quote || '', now: now || '' });


/**
 * Handle one message {id?, text, sender, mine, time, date, edited, group?, act?, preview?, truncated?}.
 * opt.batch: collect undo + counts instead of toasting. opt.rerun: read again after a word was explained.
 * Returns 'wait' | 'old' | 'dup' | 'done'.
 */
let ACK_RES = null;   // what the last message did, sent back with the "got it" so the WhatsApp window can show it
function handle(msg, via, opt) {
  opt = opt || {};
  ACK_RES = null;
  rollDay();
  if (msg && msg.deleted) { if (msg.id) hoBook({ kind: 'del', base: safeKey(msg.id), mid: String(msg.id).slice(0, 200) }); return onDeleted(msg); }
  const text = String(msg && msg.text || '').slice(0, 4000);
  const sender = normS(msg && msg.sender || '').slice(0, 60) || (msg && msg.mine ? 'Me' : 'WhatsApp');
  const group = normS(msg && msg.group || '').slice(0, 80);
  const tIso = today();
  const dIso = (msg.iso && /^\d{4}-\d{2}-\d{2}$/.test(msg.iso) ? msg.iso : '') || (msg.date ? waDateISO(msg.date, new Date()) : tIso);
  if (groupIsHo(group)) return handleHo(msg, via, text, sender, group, dIso || tIso, 'wa');
  if (hoMarked(text)) return handleHo(msg, via, text, sender, group, dIso || tIso, 'prefix');   // "HO - 512 to twin tomorrow": a note for the next shift, never a room command
  if (dIso !== tIso) { if (text.trim()) archiveMsg(msg, dIso, text, sender, '', true); return 'old'; }
  if (via === 'link' && !ready()) return 'wait';
  if (!text.trim()) return 'dup';
  const t24 = waTime24(msg.time) || hhmm();
  const ck = 'c:' + dIso + '|' + t24 + '|' + sender.toLowerCase() + '|' + normS(text);
  const id = msg.id ? 'i:' + String(msg.id).slice(0, 200) : ck;
  const done = loadDone();
  let prev = done[id];
  // a chat-list preview, and later the same message read in full when the group is opened: never twice
  const PV = loadPv(), ptxt = normS(text).toLowerCase(), pvk = dIso + '|' + t24 + '|' + ptxt;
  if (msg.preview && (PV[pvk] || done[id] !== undefined)) return 'dup';
  let caught = null;
  if (!msg.preview && prev === undefined && !opt.rerun) {
    const k = Object.keys(PV).find(x => { const v = PV[x]; return v && !v.done && x.indexOf(dIso + '|' + t24 + '|') === 0 && (x === pvk || (v.cut && v.t && ptxt.indexOf(v.t) === 0)); });
    if (k) { caught = PV[k]; caught.done = 1; savePv(PV); prev = caught.a; }
  }
  if (!caught && !opt.rerun && done[ck] !== undefined && (prev === undefined || id === ck)) return 'dup';   // the same message seen before (linked or pasted)
  if (opt.rerun && prev === undefined) prev = done[ck];
  const quote = String(msg && msg.quote || '').slice(0, 400);
  const P = parse(text, quote, t24);   // "in 10 mins" counts from the message's own time
  let actions = P.actions, edited = !!msg.edited, unEdit = [];
  if (prev !== undefined) {
    const old = new Set(String(prev).split('|').filter(Boolean));
    // edited in WhatsApp: what the old text did and the new one no longer says is taken back ("324 CO" → "325 CO")
    if (!caught && !opt.rerun && msg.id) { const now = new Set(P.actions.map(actionKey)); unEdit = undoRemoved(String(msg.id), [...old].filter(k => !now.has(k))); }
    actions = actions.filter(a => !old.has(actionKey(a)));
    if (!actions.length) {
      if (unEdit.length) { const l = LOG.find(x => x.mid === String(msg.id).slice(0, 200)); if (l) { l.res = l.res.concat(unEdit); l.edited = true; l.text = text.slice(0, 500); saveLog(); renderCard(); tell(l); } editToast(unEdit, sender, timeLabel(t24)); }
      done[id] = P.actions.map(actionKey).join('|'); done[ck] = ''; saveDone(done);
      if (caught) upgradePreview(caught, Object.assign({}, msg, { group }), dIso, text, sender);
      else archiveMsg(Object.assign({}, msg, { group }), dIso, text, sender, '', true);
      if (P.ask && !opt.rerun) askAbout(P.ask, msg, sender, group);
      if (msg.edited && !opt.rerun && P.kind !== 'ignore') hoCopy(msg, dIso, t24, sender, group, text, true);
      return 'dup';
    }
    if (!caught && !opt.rerun) edited = true;
  }
  const tl = timeLabel(t24);
  const who = `WhatsApp · ${sender} ${tl}${edited ? ' (edited)' : ''}${opt.rerun ? (via === 'redo' ? ' (redo)' : ' (word explained)') : ''}`;
  const board = boardIsToday();
  const acts = groupActs(msg);
  const pvOnly = !!msg.preview && P.kind !== 'ignore' && !previewOk(text, msg, P);
  const res = P.kind === 'ignore' ? [{ st: 'ignore', text: P.ho ? 'Sent from HotelOps — not read as a command' : 'HotelOps post — ignored' }]
    : pvOnly ? [{ st: 'preview', text: 'Only the preview was seen · open the group in WhatsApp to read it in full' }]
    : !actions.length ? [P.ask ? { st: 'ask', room: P.ask.room, text: `What does "${P.ask.word}" mean? Answer at the top` } : { st: 'none', text: 'no room — just logged' }]
    : !acts ? [{ st: 'log', text: 'Log only' + (group ? ' · ' + group : '') + ' — rooms not changed' }]
    : actions.map(a => Object.assign(applyOne(Object.assign({}, a, { t24 }), who, board), { k: actionKey(a) }));   // t24: when it was written (older never undoes newer)
  if (unEdit.length) res.unshift(...unEdit);
  if (P.ask && actions.length && acts && !pvOnly) res.push({ st: 'ask', room: P.ask.room, text: `What does "${P.ask.word}" mean? Answer at the top` });
  done[id] = (pvOnly ? (prev || '') : P.actions.map(actionKey).join('|')); done[ck] = ''; saveDone(done);

  let key = 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const undos = res.filter(r => r.undo).map(r => r.undo);
  res.filter(r => r.pending).forEach(r => addPending(r.pending, who, key, sender, tl));
  const entry = { key, at: Date.now(), time: t24, sender, text: text.slice(0, 500), mine: !!msg.mine, edited, via, res: res.map(r => { const o = { st: r.st, room: r.room || '', text: r.text }; if (r.bal) o.bal = r.bal; if (r.w) o.w = r.w; if (r.guess) { o.guess = r.guess; o.m = r.act; } return o; }) };
  if (group) entry.group = group;
  ACK_RES = entry.res.map(r => ({ st: r.st, room: r.room || '', text: String(r.text || '').slice(0, 140) }));
  if (msg.id) entry.mid = String(msg.id).slice(0, 200);
  if (quote) entry.quote = quote.slice(0, 200);
  if (msg.preview) entry.preview = true;
  if (caught) { dropPreview(caught, dIso); }
  // a message read again after its word was explained: its own line in the log gets the new result
  const orig = opt.rerun ? LOG.find(l => l.time === t24 && l.text === entry.text && l.sender === sender) : null;
  if (orig) {
    orig.res = orig.res.filter(r => r.st !== 'ask' && r.st !== 'none' && r.st !== 'deleted' && !(r.st === 'skip' && / explained: /.test(r.text))).concat(entry.res);
    delete orig.undone; delete orig.deleted;
  } else LOG.unshift(entry);
  const tgt = orig || entry; key = tgt.key;
  saveLog();
  const akey = archiveMsg(Object.assign({}, msg, { edited, group }), dIso, text, sender, archR(res));
  if (msg.preview) { const cut = !!msg.truncated || /(?:…|\.\.\.)$/.test(text.trim()); PV[pvk] = { a: done[id], ak: akey, lk: key, cut, t: cut ? ptxt.replace(/(?:…|\.\.\.)$/, '').trim() : '' }; savePv(PV); }
  if (P.ask && !opt.rerun) askAbout(P.ask, msg, sender, group);
  let undoAll = null;
  if (undos.length) {
    undoAll = once(() => { let ok = false; undos.slice().reverse().forEach(u => { try { if (u()) ok = true; } catch (_) {} }); if (ok) { tgt.undone = true; saveLog(); archive(dIso, akey, { u: 1 }, true); renderCard(); } return ok; });
    undoFns[key] = undoAll;
    undoParts[key] = res.filter(r => r.undo).map(r => ({ room: r.room, st: r.st, k: r.k, fn: r.undo }));
  }
  if (opt.batch) { opt.batch.undos.push(undoAll); res.forEach(r => { opt.batch.n[r.st] = (opt.batch.n[r.st] || 0) + 1; }); }
  else {
    const acted = res.filter(r => r.undo);
    if (acted.length && typeof showUndoToast === 'function') {
      const lbl = acted.length === 1 ? acted[0].text.replace(/ · (?:⚠|nights not said).*/, '').replace(/^(\d+)/, 'Room $1') : acted.map(r => r.text.replace(/ · ⚠.*/, '')).join(' · ');
      const bw = acted.map(balInfo).filter(b => b && b.tone === 'warn').map(b => b.label);
      showUndoToast(`${lbl} (WhatsApp · ${sender} ${tl})${bw.length ? ' · ' + bw.join(' · ') : ''}`, undoAll, 10000);
    }
    if (unEdit.length && !acted.length) editToast(unEdit, sender, tl);
    const nl = res.filter(r => r.st === 'notlist');
    if (nl.length && !acted.length && typeof showToast === 'function') showToast(`WhatsApp: room ${nl.map(r => r.room).join(', ')} is not there — ${nl[0].text.replace(/^\S+:\s*/, '')}`, 'warn');
  }
  if (!opt.rerun && P.kind !== 'ignore' && hoCopy(msg, dIso, t24, sender, group, text, edited)) { tgt.res.push({ st: 'ho', room: '', text: '📋 also in the Handover Book' }); saveLog(); if (ACK_RES) ACK_RES.push({ st: 'ho', room: '', text: '📋 also in the Handover Book' }); }
  renderCard();
  tell(tgt);
  return 'done';
}
/** Ops Brain (wa-brain.js) and others hear about each message at once */
function tell(entry) { try { doc.dispatchEvent(new CustomEvent('ho-wa-msg', { detail: JSON.parse(JSON.stringify(entry)) })); } catch (_) {} }
/** "🤔 guessed" was right: the word goes in the hotel's list */
function confirmGuess(word, m) { if (!word || !/^(?:co|lco|ext)$/.test(m)) return; answerAsk(word, m, '', null); LOG.forEach(l => l.res.forEach(r => { if (r.guess === word) { r.w = String(r.w || '').replace(/ · 🤔 guessed from "[^"]*"/, ' · ✓ ' + word); delete r.guess; } })); saveLog(); renderCard(); }
/** the preview's log line and backup record give way to the message read in full */
function dropPreview(pv, day) {
  if (pv.lk) { const i = LOG.findIndex(l => l.key === pv.lk); if (i >= 0) { LOG.splice(i, 1); saveLog(); } }
  if (pv.ak) archive(day, pv.ak, null);
}
/** the preview already did everything: keep its line, now with the full message */
function upgradePreview(pv, msg, day, text, sender) {
  const l = pv.lk && LOG.find(x => x.key === pv.lk);
  if (l) { l.text = text.slice(0, 500); l.preview = false; l.sender = sender || l.sender; saveLog(); }
  if (pv.ak) archive(day, pv.ak, null);
  archiveMsg(msg, day, text, sender, l ? archR(l.res) : '', false);
  pv.lk = ''; pv.ak = '';
  renderCard();
}

/**
 * A message edited in WhatsApp no longer says some of what it said ("324 CO" → "325 CO"): those changes are taken back,
 * when nobody changed the room since. keys: the old text's action keys that are gone → results for its log line.
 */
const BACK = { fin: 'finance hold removed', co: 'back to due out', lco: 'late check-out removed', ext: 'extension removed', extending: 'extending removed', note: 'note removed', maybe: 'note removed' };
function undoRemoved(mid, keys) {
  if (!keys.length) return [];
  const gone = new Set(keys), out = [];
  LOG.filter(l => l.mid === mid.slice(0, 200) && !l.undone && !l.deleted).forEach(l => {
    const parts = undoParts[l.key];
    if (!parts) {                                          // done before HotelOps was reloaded: cannot take it back from here
      l.res.filter(r => /^(?:co|lco|ext|extending|fin|maybe)$/.test(r.st) && !/after the list was loaded/.test(r.text || '') && keys.some(k => k.split(':')[0] === String(parseInt(r.room, 10))))
        .forEach(r => out.push({ st: 'deleted', room: r.room, text: `✎ Edited in WhatsApp · check ${r.room} (done before HotelOps was reloaded)` }));
      return;
    }
    undoParts[l.key] = parts.filter(p => {
      if (!p.k || !gone.has(p.k)) return true;
      let ok = false; try { ok = p.fn(true); } catch (_) {}
      out.push(ok ? { st: 'skip', room: p.room, text: `✎ Edited in WhatsApp → ${p.room} ${BACK[p.st] || 'undone'}` }
        : { st: 'deleted', room: p.room, text: `✎ Edited in WhatsApp · ${p.room} was changed after that message; check it` });
      return false;
    });
  });
  return out;
}
function editToast(list, sender, tl) {
  if (!list.length || typeof showToast !== 'function') return;
  showToast(list.map(r => r.text).join(' · ') + ` (${sender} ${tl})`, list.some(r => r.st === 'deleted') ? 'warn' : 'info');
}

/**
 * A message deleted in WhatsApp ("This message was deleted"): what it did is undone, when nobody changed the room since.
 * Its line in the log says so; the backup gets d:1; the toast has a Redo.
 */
function onDeleted(msg) {
  const l = LOG.find(x => x.mid && x.mid === String(msg.id));
  if (!l) return 'dup';                                   // never acted on here (or another day): nothing to undo
  if (l.deleted) return 'dup';
  const day = today(), akey = safeKey(msg.id);
  const parts = (!l.undone && undoParts[l.key]) || [];
  const back = [], changed = [];
  parts.forEach(p => { let okk = false; try { okk = p.fn(true); } catch (_) {} (okk ? back : changed).push(p); });
  const acted = l.res.filter(r => /^(?:co|lco|ext|extending|fin|note)$/.test(r.st));
  const lost = !l.undone && !parts.length && acted.length;   // done before a reload: cannot undo from here
  const BACK = { fin: 'finance hold removed', co: 'back to due out', lco: 'late check-out removed', ext: 'extension removed', extending: 'extending removed', note: 'note removed' };
  let text = '🗑 Message deleted in WhatsApp';
  if (back.length) text += ' → undone (' + back.map(p => p.room + ' ' + (BACK[p.st] || 'undone')).join(', ') + ')';
  if (changed.length) text += ' · ' + changed.map(p => p.room).join(', ') + ' was changed after that message; check it';
  if (lost) text += ' · check ' + acted.map(r => r.room).filter(Boolean).join(', ') + ' (done before HotelOps was reloaded)';
  l.deleted = true; if (back.length) l.undone = true;
  l.res.push({ st: 'deleted', room: '', text });
  delete undoFns[l.key]; delete undoParts[l.key];
  saveLog();
  const done = loadDone(); done['i:' + String(msg.id).slice(0, 200)] = ''; saveDone(done);   // a Redo applies it again
  archive(day, akey, back.length ? { d: 1, u: 1 } : { d: 1 }, true);
  const redo = once(() => {
    const m = { id: l.mid, text: l.text, sender: l.sender, mine: l.mine, time: l.time, date: dmy(day), group: l.group || '' };
    l.res = l.res.filter(r => !/^(?:co|lco|ext|extending|fin|note|deleted)$/.test(r.st)); delete l.deleted; delete l.undone;
    handle(m, 'redo', { rerun: true }); archive(day, akey, { d: null, u: null }, true); renderCard(); return true;
  });
  if (back.length && typeof showUndoToast === 'function') { showUndoToast(text.replace(/^🗑 /, '🗑 '), redo, 12000); const b = doc.getElementById('undoToastBtn'); if (b) b.textContent = '↻ Redo'; }
  else if (typeof showToast === 'function') showToast(text, changed.length || lost ? 'warn' : 'info');
  renderCard(); tell(l);
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
  if (n.extending) parts.push(`${n.extending} extending`);
  if (n.lco) parts.push(`${n.lco} late checkout${n.lco === 1 ? '' : 's'}`);
  if (n.note) parts.push(`${n.note} note${n.note === 1 ? '' : 's'}`);
  if (n.req) parts.push(`${n.req} request${n.req === 1 ? '' : 's'}`);
  if (n.notlist) parts.push(`${n.notlist} not on today's list`);
  if (n.ask) parts.push(`${n.ask} word${n.ask === 1 ? '' : 's'} to explain`);
  const ign = (n.none || 0) + (n.ignore || 0) + (n.skip || 0) + (n.log || 0); if (ign) parts.push(`${ign} ignored`);
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

// ══ "What does this word mean?" ═════════════════════════════
// A short word after a room that nobody taught HotelOps ("415 ckd") is not guessed: the team is asked once,
// here and in the WhatsApp window. The answer goes in the hotel's word list and the waiting messages are read again.
let ASKS = (() => { const v = lsGet(LS_ASK, {}); return v && typeof v === 'object' ? v : {}; })();
const MEANINGS = { co: '✓ Checked out', ext: '↪ Extension', lco: '⏰ Late CO', note: '📝 Note / request', hk: '🧹 HK status (note)', ignore: 'Ignore this word' };
function saveAsks() { lsSet(LS_ASK, ASKS); }
function askAbout(ask, msg, sender, group) {
  const w = String(ask.word || '').toLowerCase(); if (!w || KNOWN[w] || appLookup(w)) return;
  const k = safeKey(w), q = ASKS[k] || { word: w, room: ask.room, text: ask.text, sender, group: group || '', at: Date.now(), msgs: [], guess: ask.guess || '' };
  const m = { id: msg.id || '', text: String(msg.text || '').slice(0, 1000), sender, mine: !!msg.mine, time: msg.time || '', date: msg.date || '', group: group || '' };
  if (msg.quote) m.quote = String(msg.quote).slice(0, 400);
  if (!q.msgs.some(x => (x.id && x.id === m.id) || (x.text === m.text && x.time === m.time))) q.msgs.push(m);
  if (q.msgs.length > 20) q.msgs = q.msgs.slice(-20);
  ASKS[k] = q; saveAsks();
  if (typeof fbUpdate === 'function') try { Promise.resolve(fbUpdate('waAsk', { [k]: q })).catch(() => {}); } catch (_) {}
  renderAsks();
}
/** the answer: into the word list, never asked again, waiting messages read again (with Undo) */
function answerAsk(word, meaning, note, by) {
  const w = String(word || '').toLowerCase().trim(); if (!w || !MEANINGS[meaning]) return false;
  note = String(note || '').trim().slice(0, 60);
  const k = safeKey(w), q = ASKS[k];
  const who = by || (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || 'HotelOps';
  let saved = false;
  try { if (W.hoWaWords && typeof W.hoWaWords.add === 'function') { W.hoWaWords.add(w, meaning, note); saved = true; } } catch (_) {}
  LOCALW[w] = { m: meaning, label: note }; lsSet(LS_WORDS, LOCALW);
  if (!saved && typeof fbSet === 'function') try { Promise.resolve(fbSet('waWords/' + k, { m: meaning, label: note, by: who, at: Date.now() })).catch(() => {}); } catch (_) {}
  KNOWN[w] = meaning; lsSet(LS_KNOWN, KNOWN);
  LOG.forEach(l => l.res.forEach(r => { if (r.st === 'ask' && r.text.indexOf('"' + w + '"') >= 0) { r.st = 'skip'; r.text = `"${w}" explained: ${MEANINGS[meaning].replace(/^\S+\s/, '')}`; } }));
  saveLog();
  delete ASKS[k]; saveAsks();
  if (typeof fbUpdate === 'function') try { Promise.resolve(fbUpdate('waAsk', { [k]: null })).catch(() => {}); } catch (_) {}
  wordsSent = '';
  pushWords();
  const batch = { undos: [], n: {} };
  (q && q.msgs || []).forEach(m => { try { handle(m, 'ask', { rerun: true, batch }); } catch (_) {} });
  const undos = batch.undos.filter(Boolean), n = batch.n;
  const did = ['co', 'lco', 'ext', 'extending', 'note'].reduce((s, x) => s + (n[x] || 0), 0);
  const msg = `"${w}" = ${MEANINGS[meaning].replace(/^\S+\s/, '')}${note ? ' (' + note + ')' : ''}` + (did ? ` · ${did} room${did === 1 ? '' : 's'} updated` : '');
  if (undos.length && typeof showUndoToast === 'function') showUndoToast(msg, once(() => { undos.slice().reverse().forEach(u => { try { u(); } catch (_) {} }); renderCard(); }), 10000);
  else if (typeof showToast === 'function') showToast(msg, 'ok');
  renderCard();
  return true;
}
function listenAsks() {
  if (typeof fbListen !== 'function') return;
  try {
    fbListen('waAsk', v => {
      const o = v && typeof v === 'object' ? v : {};
      const next = {};
      Object.keys(o).forEach(k => { const q = o[k]; if (q && typeof q === 'object' && q.word && !KNOWN[String(q.word).toLowerCase()]) next[k] = Object.assign({ msgs: [] }, q, { msgs: Array.isArray(q.msgs) ? q.msgs : Object.values(q.msgs || {}) }); });
      // a question answered on another desk is gone from the database: gone here too (one asked here a moment ago stays)
      Object.keys(ASKS).forEach(k => { if (!next[k] && ASKS[k] && Date.now() - (ASKS[k].at || 0) < 120000 && !KNOWN[ASKS[k].word]) next[k] = ASKS[k]; });
      ASKS = next; saveAsks(); renderAsks();
    });
  } catch (_) {}
}

// ══ The link with the WhatsApp tab ══════════════════════════
const ORIGINS = ['https://web.whatsapp.com'];
let linkSeen = 0, LINK = null, wordsSent = '';
const linked = () => !!(LINK && Date.now() - LINK.at < 20000);
function postLink(o) { try { if (LINK && LINK.win) { LINK.win.postMessage(o, LINK.origin); return true; } } catch (_) {} return false; }
/** the hotel's word list for the WhatsApp window: [{w, m, label}] */
function wordsList() {
  const out = [], seen = new Set();
  const push = (w, e) => {
    if (!w || !e || typeof e !== 'object') return; const m = e.m || e.means || e.act; if (!/^(?:co|lco|ext|note|hk|ignore)$/.test(m)) return;
    const k = String(w).toLowerCase().slice(0, 40); if (seen.has(k)) return; seen.add(k); out.push({ w: k, m, label: String(e.label || '').slice(0, 60) });
  };
  try {
    const a = W.hoWaWords && typeof W.hoWaWords.all === 'function' ? W.hoWaWords.all() : null;
    if (Array.isArray(a)) a.forEach(e => { if (Array.isArray(e)) push(e[0], e[1]); else if (e && typeof e === 'object') push(e.w || e.word || e.key, e); });
    else if (a && typeof a === 'object') Object.keys(a).forEach(k => push(k, a[k]));
  } catch (_) {}
  Object.keys(LOCALW).forEach(k => push(k, LOCALW[k]));
  return out.slice(0, 500);
}
function pushWords() {
  if (!linked()) return;
  const list = wordsList(), j = JSON.stringify(list);
  if (j === wordsSent) return;
  if (postLink({ source: 'ho-wa', words: list })) wordsSent = j;
}
let wordsHooked = false;
function hookWords() {
  if (wordsHooked || !W.hoWaWords || typeof W.hoWaWords.onChange !== 'function') return;
  wordsHooked = true;
  try { W.hoWaWords.onChange(() => { wordsSent = ''; pushWords(); renderCard(); }); } catch (_) {}
}
W.addEventListener('message', e => {
  const d = e.data;
  if (!d || typeof d !== 'object') return;
  const same = e.source === W && e.origin === location.origin;
  if (!same && !ORIGINS.includes(e.origin)) return;
  if (d.source === 'ho-wa-sent') { onSent(d); return; }
  if (d.source !== 'ho-wa') return;
  if (d.send || d.words) return;                                        // what this app sends to the WhatsApp tab (same window in tests)
  const reply = o => { try { if (same) W.postMessage(o, location.origin); else if (e.source) e.source.postMessage(o, e.origin); } catch (_) {} };
  if (!same || d.ping) {
    const was = linkSeen; linkSeen = Date.now();
    const fresh = !LINK || LINK.win !== e.source;
    LINK = Object.assign(LINK && !fresh ? LINK : {}, { win: same ? W : e.source, origin: same ? location.origin : e.origin, at: Date.now() });
    if (fresh) wordsSent = '';
    if (!was || Date.now() - was > 20000) renderStatus();
  }
  if (d.answer && typeof d.answer === 'object') { answerAsk(d.answer.word, d.answer.meaning, d.answer.note, d.answer.by || 'WhatsApp window'); return; }
  if (d.ping) {
    if (Array.isArray(d.groups)) LINK.groups = d.groups.filter(g => g && g.name).slice(0, 12).map(g => ({ name: String(g.name).slice(0, 80), act: g.act !== false }));
    if (typeof d.open === 'string') LINK.open = d.open.slice(0, 80);
    if (typeof d.rtt === 'number') LINK.rtt = d.rtt;
    LINK.auto = !!d.auto;
    reply({ source: 'ho-wa-pong', ready: ready(), t: d.t });
    pushWords();
    renderStatus(); renderGroups();
    return;
  }
  const m = d.msg;
  if (!m || typeof m !== 'object' || !m.id) return;
  const r = handle(m, same ? 'page' : 'link');
  if (r !== 'wait') reply(Object.assign({ source: 'ho-wa-ack', id: m.id }, r === 'done' && ACK_RES ? { res: ACK_RES } : {}));
});

// ══ Sending to the group (only what someone types or picks here, and presses Send) ══
let OUT = (() => { const v = lsGet(LS_OUT, null); return v && v.date === today() && Array.isArray(v.items) ? v.items : []; })();
function saveOut() { if (OUT.length > 50) OUT = OUT.slice(0, 50); lsSet(LS_OUT, { date: today(), items: OUT }); }
const OUT_ST = {
  wait: ['…', 'Sending to WhatsApp…'], queued: ['⏳', 'Waiting · open the group in WhatsApp'], typed: ['⌨', 'Typed — press Enter in WhatsApp'],
  sent: ['✓', 'Sent'], failed: ['✗', 'Not sent'], cancelled: ['—', 'Cancelled'],
};
function groupNames() {
  const n = [];
  ((LINK && LINK.groups) || []).forEach(g => { if (!n.some(x => gKey(x) === gKey(g.name))) n.push(g.name); });
  LOG.forEach(l => { if (l.group && !n.some(x => gKey(x) === gKey(l.group))) n.push(l.group); });
  return n;
}
// "Send automatically" switch in the app: on = the reader presses Send in WhatsApp for you (default on; remembered on this device)
function waAutoOn() { try { return localStorage.getItem('ho_wa_autosend') !== '0'; } catch (_) { return true; } }
function waSend(text, group) {
  text = String(text || '').trim();
  if (!text) { showToast('Type a message first', 'warn'); return null; }
  if (!linked()) { showToast('Not linked to WhatsApp. Start the reader on WhatsApp Web first (❔ How to set up), then try again.', 'warn'); return null; }
  const id = 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const item = { id, group: group || (LINK && LINK.open) || groupNames()[0] || '', text: text.slice(0, 3000), at: Date.now(), st: 'wait' };
  OUT.unshift(item); saveOut();
  // the invisible mark: read back from the group, HotelOps knows it wrote this and never acts on it
  postLink({ source: 'ho-wa', send: { id, group: item.group, text: HP.HO_MARK + item.text, auto: waAutoOn() } });
  setTimeout(() => { if (item.st === 'wait') { item.st = 'failed'; item.why = 'No answer from WhatsApp · is the reader running?'; saveOut(); renderOut(); } }, 7000);
  renderOut();
  return item;
}
function onSent(d) {
  const it = OUT.find(o => o.id === d.id); if (!it || !OUT_ST[d.status]) return;
  const was = it.st; it.st = d.status; it.why = String(d.why || '').slice(0, 120); if (d.group) it.group = String(d.group).slice(0, 80);
  saveOut(); renderOut();
  if (was !== it.st && typeof showToast === 'function') {
    if (it.st === 'typed') showToast('Typed in WhatsApp · press Enter there to send', 'info');
    else if (it.st === 'sent') showToast('✓ Sent to ' + (it.group || 'WhatsApp'), 'ok');
    else if (it.st === 'queued') showToast('Open ' + (it.group || 'the group') + ' in WhatsApp to send it', 'info');
    else if (it.st === 'failed') showToast('Not sent' + (it.why ? ': ' + it.why : ''), 'warn');
  }
}
function cancelOut(id) { const it = OUT.find(o => o.id === id); if (!it) return; postLink({ source: 'ho-wa', send: { id, cancel: true } }); it.st = 'cancelled'; saveOut(); renderOut(); }

// ══ The window ══════════════════════════════════════════════
const CSS = `
#tbWhatsApp{color:#25d366}
#tbWhatsApp:hover{color:#2fe076}
#waOv{position:fixed;inset:0;z-index:9000;display:flex;align-items:flex-start;justify-content:center;padding:5vh 16px;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;background:rgba(0,0,0,.55);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);animation:waFade .16s ease}
#waOv[hidden]{display:none}
#waOv #waCard{margin:0 auto auto;width:min(880px,100%);flex:none;overflow:visible;box-shadow:0 30px 80px -24px rgba(0,0,0,.6);animation:waUp .2s ease}
@keyframes waFade{from{opacity:0}to{opacity:1}}
@keyframes waUp{from{opacity:0;transform:translateY(10px) scale(.985)}to{opacity:1;transform:none}}
@keyframes waPulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--green) 55%,transparent)}70%{box-shadow:0 0 0 8px transparent}100%{box-shadow:0 0 0 0 transparent}}
@keyframes waIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
#waCard{--wa-g:#25d366;--wa-co:var(--green);--wa-lco:var(--amber,#d97706);--wa-ext:var(--teal,#0d9488);--wa-note:var(--purple,#7c3aed);--wa-bad:var(--red);
  background:var(--card);border:1px solid var(--border);border-radius:var(--r2,14px);color:var(--text);font-family:var(--font,inherit);position:relative}
#waCard *{box-sizing:border-box}
#waCard:focus{outline:none}
#waCard .wa-hd{position:sticky;top:-5vh;z-index:3;display:flex;align-items:center;gap:12px;padding:14px 16px;background:var(--card);border-bottom:1px solid var(--border);border-radius:var(--r2,14px) var(--r2,14px) 0 0}
#waCard .wa-hd::after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:1px;background:linear-gradient(90deg,transparent,color-mix(in srgb,var(--wa-g) 60%,transparent),transparent)}
#waCard .wa-logo{flex:none;width:40px;height:40px;border-radius:12px;display:grid;place-items:center;background:linear-gradient(135deg,#25d366,#128c7e);color:#fff;box-shadow:0 6px 18px -6px rgba(37,211,102,.6)}
#waCard .wa-logo svg{width:22px;height:22px}
#waCard .wa-ttl{flex:1;min-width:0;display:grid;gap:3px}
#waCard .wa-ttl b{font:700 16px/1.2 var(--font,inherit);letter-spacing:-.01em}
#waCard .wa-live{display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--text2);min-width:0}
#waCard .wa-live span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
#waCard .wa-dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--text3)}
#waCard .wa-dot.on{background:var(--green);animation:waPulse 1.8s infinite}
#waCard .wa-ib{all:unset;box-sizing:border-box;flex:none;cursor:pointer;height:34px;min-width:34px;padding:0 10px;border-radius:10px;border:1px solid var(--border);background:var(--card2,var(--bg2));color:var(--text2);font:600 12.5px var(--font,inherit);display:inline-flex;align-items:center;justify-content:center;gap:6px}
#waCard .wa-ib:hover{color:var(--text);border-color:var(--border2,var(--border))}
#waCard .wa-ib[hidden]{display:none}
#waCard .wa-body{padding:16px;display:grid;grid-template-columns:minmax(0,1fr);gap:14px}
#waCard .wa-body>*{min-width:0}
#waCard .wa-kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}
#waCard .wa-kpi{position:relative;overflow:hidden;border:1px solid var(--border);border-radius:12px;padding:10px 12px;background:var(--card2,var(--bg2))}
#waCard .wa-kpi::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--c)}
#waCard .wa-kpi b{display:block;font:700 22px/1.1 var(--mono,monospace);color:var(--text);font-variant-numeric:tabular-nums}
#waCard .wa-kpi span{display:block;margin-top:3px;font-size:11.5px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#waCard .wa-kpi.zero b{color:var(--text3)}
#waCard .wa-kpi .wa-ks{display:none}
#waCard .wa-sec{border:1px solid var(--border);border-radius:12px;background:var(--card)}
#waCard .wa-sech{display:flex;align-items:center;gap:8px;padding:11px 14px;font:700 13px var(--font,inherit);color:var(--text)}
#waCard .wa-sech .wa-sub{font-weight:500;font-size:12px;color:var(--text3);margin-left:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
#waCard .wa-secb{padding:0 14px 14px;display:grid;grid-template-columns:minmax(0,1fr);gap:10px}
#waCard .wa-secb>*{min-width:0}
#waCard details.wa-sec>summary{list-style:none;cursor:pointer}
#waCard details.wa-sec>summary::-webkit-details-marker{display:none}
#waCard details.wa-sec>summary::after{content:"▾";margin-left:auto;padding-left:10px;color:var(--text3);transition:transform .15s}
#waCard details.wa-sec>summary .wa-sub+*{margin-left:0}
#waCard details.wa-sec>summary:has(.wa-sub)::after{margin-left:0}
#waCard details.wa-sec[open]>summary::after{transform:rotate(180deg)}
#waCard .wa-asks{display:grid;gap:10px}
#waCard .wa-ask{border:1px solid color-mix(in srgb,var(--wa-lco) 45%,var(--border));background:color-mix(in srgb,var(--wa-lco) 8%,var(--card));border-radius:12px;padding:12px 14px;display:grid;gap:9px;animation:waIn .2s ease}
#waCard .wa-ask p{margin:0;font-size:13px;line-height:1.45;color:var(--text)}
#waCard .wa-ask p q{font-weight:700}
#waCard .wa-ask .wa-aw{display:flex;flex-wrap:wrap;gap:6px}
#waCard .wa-ask input{flex:1 1 180px;min-width:0}
#waCard .wa-tpl{display:flex;flex-wrap:wrap;gap:6px}
#waCard .wa-cmp{display:grid;grid-template-columns:110px 130px 1fr;gap:8px}
#waCard .wa-cmp .wa-gsel{min-width:0}
#waCard input.wa-in,#waCard select.wa-in{width:100%;height:36px;margin:0;background:var(--bg2);color:var(--text);border:1px solid var(--border);border-radius:9px;padding:0 10px;font:13px var(--font,inherit);color-scheme:light dark}
#waCard input.wa-in:focus,#waCard select.wa-in:focus,#waCard textarea:focus{outline:0;border-color:var(--wa-g)}
#waCard textarea{width:100%;min-height:58px;resize:vertical;background:var(--bg2);color:var(--text);border:1px solid var(--border);border-radius:10px;padding:9px 11px;font:13px/1.45 var(--font,inherit);margin:0}
#waCard .wa-paste textarea,#waCard .wa-help textarea{font:12px/1.45 var(--mono,monospace)}
#waCard .wa-btns{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
#waCard .wa-btn{all:unset;box-sizing:border-box;cursor:pointer;padding:8px 13px;border-radius:9px;border:1px solid var(--border2,var(--border));background:var(--bg2);color:var(--text);font:600 12.5px var(--font,inherit);white-space:nowrap;text-align:center}
#waCard .wa-btn:hover{border-color:var(--accent)}
#waCard .wa-btn.pri{background:var(--accent);border-color:var(--accent);color:var(--bg,#111)}
#waCard .wa-btn.go{background:linear-gradient(135deg,#25d366,#128c7e);border-color:transparent;color:#fff;box-shadow:0 6px 16px -8px rgba(18,140,126,.8)}
#waCard .wa-btn.go:hover{filter:brightness(1.06)}
#waCard .wa-btn.sm{padding:6px 11px;font-size:12px}
#waCard .wa-btn:disabled{opacity:.5;cursor:default}
#waCard .wa-btn:focus-visible,#waCard .wa-ib:focus-visible,#waCard .wa-chipb:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
#waCard .wa-chipb{all:unset;box-sizing:border-box;cursor:pointer;padding:6px 11px;border-radius:99px;border:1px solid var(--border);background:var(--card2,var(--bg2));color:var(--text2);font:600 12px var(--font,inherit);white-space:nowrap;display:inline-flex;align-items:center;gap:6px}
#waCard .wa-chipb:hover{color:var(--text);border-color:var(--border2,var(--border))}
#waCard .wa-chipb.on{background:var(--accent);border-color:var(--accent);color:var(--bg,#111)}
#waCard .wa-chipb i{font-style:normal;font:600 11px var(--mono,monospace);opacity:.75}
#waCard .wa-hint{font-size:12px;color:var(--text3);line-height:1.45}
#waCard .wa-auto{display:inline-flex;align-items:center;gap:6px;font:600 12.5px var(--font,inherit);color:var(--text2);cursor:pointer;padding:6px 10px;border-radius:999px;border:1px solid var(--border);background:var(--card2,var(--bg2))}
#waCard .wa-auto input{width:16px;height:16px;accent-color:#25d366;margin:0}
#waCard .wa-out{display:grid;gap:6px}
#waCard .wa-o{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:center;padding:8px 10px;border:1px solid var(--border);border-radius:10px;background:var(--card2,var(--bg2));font-size:12.5px}
#waCard .wa-o .wa-ot{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text)}
#waCard .wa-o .wa-os{font-weight:600;color:var(--text2);text-align:right}
#waCard .wa-o.sent .wa-os{color:var(--green)}
#waCard .wa-o.typed .wa-os{color:var(--wa-lco)}
#waCard .wa-o.failed .wa-os{color:var(--red)}
#waCard .wa-o time{font:500 11.5px var(--mono,monospace);color:var(--text3)}
#waCard .wa-tools{display:grid;gap:10px;padding:12px 14px;border-bottom:1px solid var(--border)}
#waCard .wa-frow{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
#waCard .wa-frow select.wa-in{width:auto;max-width:100%;height:30px;font-size:12px;border-radius:99px}
#waCard .wa-q{display:flex;align-items:center;gap:8px;background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:0 11px;transition:border-color .15s}
#waCard .wa-q:focus-within{border-color:var(--wa-g)}
#waCard .wa-q span{font-size:13px;opacity:.7}
#waCard .wa-q input{flex:1;min-width:0;width:auto;height:auto;margin:0;background:transparent!important;border:0!important;border-radius:0;outline:0!important;box-shadow:none!important;color:var(--text);font:13px var(--font,inherit);padding:10px 0}
#waCard .wa-pick[hidden],#waCard .wa-list[hidden]{display:none}
#waCard .wa-rng{display:flex;flex-wrap:wrap;gap:6px}
#waCard .wa-rng button{all:unset;box-sizing:border-box;cursor:pointer;padding:5px 11px;border-radius:99px;border:1px solid var(--border);background:var(--card2,var(--bg2));color:var(--text2);font:600 12px var(--font,inherit);white-space:nowrap}
#waCard .wa-rng button:hover{color:var(--text)}
#waCard .wa-rng button.on{background:var(--text);border-color:var(--text);color:var(--card)}
#waCard .wa-pick{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12.5px;color:var(--text3)}
#waCard .wa-pick input{background:var(--bg2);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:6px 8px;font:12.5px var(--font,inherit);color-scheme:light dark;min-width:0}
#waCard .wa-sbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
#waCard .wa-scount{flex:1;min-width:0;font:600 12px var(--font,inherit);color:var(--text3)}
#waCard .wa-dl{display:flex;gap:6px}
#waCard .wa-list{max-height:520px;overflow-y:auto;overflow-x:hidden;padding:4px 14px 14px}
#waCard .wa-hr{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:10px;padding:10px 0 6px;font:700 11px var(--font,inherit);letter-spacing:.06em;text-transform:uppercase;color:var(--text3);background:var(--card)}
#waCard .wa-hr::after{content:"";flex:1;height:1px;background:var(--border)}
#waCard .wa-hr span{order:2;font:600 11px var(--mono,monospace);letter-spacing:0}
#waCard .wa-msg,#waCard .wa-row{position:relative;display:grid;grid-template-columns:36px 1fr auto;gap:2px 10px;padding:10px 4px 10px 0;align-items:start;animation:waIn .18s ease}
#waCard .wa-msg+.wa-msg,#waCard .wa-row+.wa-row{border-top:1px dashed color-mix(in srgb,var(--border) 80%,transparent)}
#waCard .wa-av{grid-row:1/4;width:36px;height:36px;border-radius:50%;display:grid;place-items:center;font:700 13px var(--font,inherit);color:#fff;background:hsl(var(--h,210) 55% 46%);box-shadow:inset 0 0 0 2px color-mix(in srgb,#fff 18%,transparent)}
#waCard .wa-av.ph{background:var(--bg2);color:var(--text2);box-shadow:inset 0 0 0 1px var(--border)}
#waCard .wa-av.ph svg{width:16px;height:16px}
#waCard .wa-av.me{background:linear-gradient(135deg,#25d366,#128c7e)}
#waCard .wa-mh{display:flex;align-items:baseline;gap:8px;min-width:0;flex-wrap:wrap}
#waCard .wa-who{font-weight:700;font-size:13px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
#waCard .wa-tm{font:500 11.5px var(--mono,monospace);color:var(--text3)}
#waCard .wa-tag{font:600 10.5px var(--font,inherit);padding:2px 7px;border-radius:99px;background:var(--bg2);color:var(--text2);border:1px solid var(--border);max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#waCard .wa-tag.pv{color:var(--wa-lco);border-color:color-mix(in srgb,var(--wa-lco) 40%,transparent)}
#waCard .wa-quote{grid-column:2;margin-top:4px;padding:4px 9px;border-left:3px solid var(--border2,var(--border));border-radius:4px 8px 8px 4px;background:var(--bg2);color:var(--text3);font-size:12px;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#waCard .wa-txt{grid-column:2;color:var(--text);font-size:13.5px;line-height:1.45;overflow-wrap:anywhere;white-space:pre-wrap;margin-top:2px}
#waCard .wa-res{grid-column:2/4;display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}
#waCard .wa-chip{display:inline-flex;align-items:center;gap:5px;font:600 11.5px/1.3 var(--font,inherit);padding:3px 9px;border-radius:99px;border:1px solid var(--border);background:var(--bg2);color:var(--text2);overflow-wrap:anywhere}
#waCard .wa-chip.co{color:var(--wa-co);background:color-mix(in srgb,var(--wa-co) 10%,transparent);border-color:color-mix(in srgb,var(--wa-co) 35%,transparent)}
#waCard .wa-chip.lco{color:var(--wa-lco);background:color-mix(in srgb,var(--wa-lco) 10%,transparent);border-color:color-mix(in srgb,var(--wa-lco) 35%,transparent)}
#waCard .wa-chip.fin{color:var(--wa-lco);border-color:color-mix(in srgb,var(--wa-lco) 40%,transparent)}
#waCard .wa-chip.extending{color:var(--wa-ext);border-style:dashed;border-color:color-mix(in srgb,var(--wa-ext) 45%,transparent)}
#waCard .wa-chip.maybe{color:var(--wa-note);border-style:dashed;border-color:color-mix(in srgb,var(--wa-note) 45%,transparent)}
#waCard .wa-chip.ext{color:var(--wa-ext);background:color-mix(in srgb,var(--wa-ext) 10%,transparent);border-color:color-mix(in srgb,var(--wa-ext) 35%,transparent)}
#waCard .wa-chip.note{color:var(--wa-note);background:color-mix(in srgb,var(--wa-note) 9%,transparent);border-color:color-mix(in srgb,var(--wa-note) 32%,transparent)}
#waCard .wa-chip.req{color:var(--text2)}
#waCard .wa-chip.ho{color:var(--wa-ext);background:color-mix(in srgb,var(--wa-ext) 9%,transparent);border-color:color-mix(in srgb,var(--wa-ext) 32%,transparent)}
#waCard .wa-g .wa-tag.ho{color:var(--wa-ext);border-color:color-mix(in srgb,var(--wa-ext) 40%,transparent)}
#waCard .wa-chip.notlist,#waCard .wa-chip.warn{color:var(--wa-bad);background:color-mix(in srgb,var(--wa-bad) 9%,transparent);border-color:color-mix(in srgb,var(--wa-bad) 35%,transparent)}
#waCard .wa-chip.ask{color:var(--wa-lco);border-style:dashed}
#waCard .wa-chip.deleted{color:var(--text2);border-style:dashed;text-decoration:none!important}
#waCard .wa-msg.del .wa-txt{text-decoration:line-through;color:var(--text3)}
#waCard .wa-chip.tiny,#waCard .wa-chip.skip,#waCard .wa-chip.none,#waCard .wa-chip.ignore,#waCard .wa-chip.log,#waCard .wa-chip.preview{color:var(--text3);background:transparent;font-weight:500}
#waCard .wa-msg::before{content:"";position:absolute;left:-14px;top:12px;bottom:12px;width:3px;border-radius:0 3px 3px 0;background:var(--bar,transparent)}
#waCard .wa-msg.t-co{--bar:var(--wa-co)}#waCard .wa-msg.t-lco{--bar:var(--wa-lco)}#waCard .wa-msg.t-ext{--bar:var(--wa-ext)}#waCard .wa-msg.t-note{--bar:var(--wa-note)}#waCard .wa-msg.t-bad{--bar:var(--wa-bad)}
#waCard .wa-msg.quiet .wa-txt{color:var(--text2)}
#waCard .wa-msg.quiet .wa-av{opacity:.6}
#waCard .wa-msg.undone .wa-res .wa-chip:not(.deleted){opacity:.55;text-decoration:line-through}
#waCard .wa-u{all:unset;cursor:pointer;grid-column:3;grid-row:1;font:600 11.5px var(--font,inherit);color:var(--text2);padding:4px 9px;border:1px solid var(--border2,var(--border));border-radius:8px;white-space:nowrap}
#waCard .wa-u:hover{color:var(--text);background:var(--bg2)}
#waCard .wa-empty{padding:26px 14px;color:var(--text3);font-size:13px;text-align:center;line-height:1.5}
#waCard .wa-empty b{display:block;font-size:22px;margin-bottom:4px}
#waCard .wa-row .wa-t{grid-row:1/3;font:500 11.5px var(--mono,monospace);color:var(--text3);padding-top:2px}
#waCard .wa-row .wa-m{min-width:0}
#waCard .wa-row .wa-m .wa-who{margin-right:6px}
#waCard .wa-row.undone .wa-res{opacity:.55;text-decoration:line-through}
#waCard .wa-day{position:sticky;top:0;z-index:1;display:flex;justify-content:space-between;gap:8px;padding:8px 0;font:700 11.5px var(--font,inherit);color:var(--text2);background:var(--card);border-bottom:1px solid var(--border)}
#waCard .wa-day span{font-weight:500;color:var(--text3)}
#waCard .wa-sres mark{background:color-mix(in srgb,var(--gold,#e0b24f) 35%,transparent);color:inherit;border-radius:3px;padding:0 1px}
#waCard .wa-more{all:unset;box-sizing:border-box;display:block;width:100%;cursor:pointer;text-align:center;padding:10px;font:600 12.5px var(--font,inherit);color:var(--accent)}
#waCard .wa-grps{display:grid;gap:6px}
#waCard .wa-g{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;font-size:12.5px;padding:8px 10px;border:1px solid var(--border);border-radius:10px;background:var(--card2,var(--bg2))}
#waCard .wa-g b{flex:1 1 140px;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#waCard .wa-g label{display:inline-flex;align-items:center;gap:6px;color:var(--text2);white-space:nowrap;cursor:pointer}
#waCard .wa-help p{font-size:12.5px;color:var(--text2);margin:0;line-height:1.55}
#waCard .wa-help ol{margin:0;padding-left:20px;font-size:12.5px;line-height:1.55;color:var(--text2)}
#waCard .wa-help code{font:12px var(--mono,monospace);background:var(--bg2);padding:1px 5px;border-radius:5px;color:var(--text)}
@media (prefers-reduced-motion:reduce){#waOv,#waOv #waCard,#waCard .wa-msg,#waCard .wa-row,#waCard .wa-ask{animation:none}#waCard .wa-dot.on{animation:none}}
@media (max-width:640px){
  #waOv{padding:8px}#waCard .wa-hd{top:-8px;padding:12px;gap:10px}#waCard .wa-logo{width:34px;height:34px;border-radius:10px}
  #waCard .wa-body{padding:12px;gap:12px}#waCard .wa-kpis{gap:6px}#waCard .wa-kpi{padding:8px 6px 8px 9px}#waCard .wa-kpi b{font-size:18px}#waCard .wa-kpi span{font-size:10.5px}
  #waCard .wa-kpi .wa-kl{display:none}#waCard .wa-kpi .wa-ks{display:block}
  #waCard .wa-tpl{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;margin:0 -12px;padding:0 12px}#waCard .wa-tpl::-webkit-scrollbar{display:none}
  #waCard .wa-o{grid-template-columns:auto minmax(0,1fr)}#waCard .wa-o .wa-os{grid-column:1/-1;text-align:left}
  #waCard .wa-cmp{grid-template-columns:1fr 1fr}#waCard .wa-cmp .wa-gsel{grid-column:1/-1}
  #waCard .wa-ib .wa-ibl{display:none}#waCard .wa-list{padding:4px 12px 12px;max-height:none}#waCard .wa-msg::before{left:-12px}
  #waCard .wa-btn{flex:1 1 auto}#waCard .wa-tools{padding:12px}#waCard .wa-sech{padding:11px 12px}#waCard .wa-secb{padding:0 12px 12px}
}
`;
const esc = s => (typeof escapeHtml === 'function' ? escapeHtml(s) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
const clock = t => { const m = String(t || '').match(/^(\d{1,2}):(\d{2})$/); if (!m) return t || ''; const h = +m[1]; return (h % 12 || 12) + ':' + m[2] + (h >= 12 ? ' PM' : ' AM'); };
const ICON = { wait: '⏳', maybe: '🤔', fin: '', extending: '', co: '✓', lco: '⏰', ext: '↪', note: '📝', req: '📝', notlist: '⚠', skip: '·', none: '—', ignore: '—', log: '🗂', preview: '👁', ask: '❓', deleted: '', ho: '' };
const SVG_WA = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2s.2-1.1.2-1.2-.2-.2-.5-.3Z"/></svg>';
const SVG_PH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z"/></svg>';
let FILT = 'all', GFILT = '';

function mount() {
  if (doc.getElementById('waCard')) return true;
  const panel = doc.getElementById('panel-departures'); if (!panel) return false;
  const st = doc.createElement('style'); st.id = 'waCss'; st.textContent = CSS; doc.head.appendChild(st);
  const card = doc.createElement('div'); card.id = 'waCard'; card.tabIndex = -1;
  card.innerHTML = `<div class="wa-hd"><span class="wa-logo">${SVG_WA}</span>
    <span class="wa-ttl"><b>WhatsApp</b><span class="wa-live" id="waStatus"></span></span>
    <button type="button" class="wa-ib" id="waWords" hidden title="The hotel's WhatsApp words (VD, OOO…)">📖<span class="wa-ibl"> Words</span></button>
    <button type="button" class="wa-ib" id="waClose" aria-label="Close" title="Close (Esc)">✕</button></div>
  <div class="wa-body">
    <div class="wa-asks" id="waAsks"></div>
    <div class="wa-kpis" id="waKpis" aria-label="Today"></div>
    <section class="wa-sec" id="waSendBox">
      <div class="wa-sech">✉️ Send to WhatsApp<span class="wa-sub" id="waSendTo"></span></div>
      <div class="wa-secb">
        <div class="wa-tpl" id="waTpl">${TEMPLATES.map(t => `<button type="button" class="wa-chipb" data-tpl="${t.k}">${esc(t.label)}</button>`).join('')}<button type="button" class="wa-chipb" id="waCoList" title="Builds today's list from Departures in the box. Check it, then press Send.">📋 Checkout list</button></div>
        <div class="wa-cmp"><input class="wa-in" id="waRoom" placeholder="Room" inputmode="numeric" autocomplete="off" aria-label="Room for the template"><input class="wa-in" id="waTime" placeholder="Time (2 PM)" autocomplete="off" aria-label="Time for the template"><select class="wa-in wa-gsel" id="waGrp" aria-label="Group"></select></div>
        <textarea id="waMsg" placeholder="Type a message for the group…" aria-label="Message to send to WhatsApp"></textarea>
        <div class="wa-btns"><button type="button" class="wa-btn go" id="waSendBtn">Send to WhatsApp</button><label class="wa-auto" title="On: HotelOps sends the message for you. Off: it is typed in WhatsApp and you press Enter."><input type="checkbox" id="waAutoSend"> Send automatically</label><span class="wa-hint" id="waSendHint">It is typed in WhatsApp for you. You press Enter there to send it.</span></div>
        <div class="wa-out" id="waOut"></div>
      </div>
    </section>
    <section class="wa-sec">
      <div class="wa-tools">
        <div class="wa-q"><span aria-hidden="true">🔍</span><input type="search" id="waQ" placeholder="Search the chat… room, word or name" aria-label="Search the WhatsApp chat" autocomplete="off" spellcheck="false"></div>
        <div class="wa-frow" id="waFilt" role="group" aria-label="Show">
          <button type="button" class="wa-chipb on" data-f="all">All <i data-n="all"></i></button><button type="button" class="wa-chipb" data-f="actions">Actions <i data-n="actions"></i></button><button type="button" class="wa-chipb" data-f="notes">Notes <i data-n="notes"></i></button><button type="button" class="wa-chipb" data-f="attention">Needs attention <i data-n="attention"></i></button><button type="button" class="wa-chipb" data-f="ignored">Ignored <i data-n="ignored"></i></button>
          <select class="wa-in" id="waGF" aria-label="Group" hidden></select>
        </div>
        <div class="wa-rng" id="waRng" role="group" aria-label="Which days">
          <button type="button" data-r="today" class="on" aria-pressed="true">Today</button><button type="button" data-r="7" aria-pressed="false">7 days</button><button type="button" data-r="30" aria-pressed="false">30 days</button><button type="button" data-r="all" aria-pressed="false">All</button><button type="button" data-r="pick" aria-pressed="false">📅 Pick dates</button>
        </div>
        <div class="wa-pick" id="waPick" hidden><input type="date" id="waFrom" aria-label="From"><span>to</span><input type="date" id="waTo" aria-label="To"></div>
        <div class="wa-sbar"><span class="wa-scount" id="waSCount"></span><span class="wa-n" id="waCount" hidden>0</span><span class="wa-dl"><button type="button" class="wa-btn sm" id="waDlTxt" title="Saves the messages shown as a .txt in WhatsApp's own format">⬇ Backup .txt</button><button type="button" class="wa-btn sm" id="waDlCsv" title="For Excel">CSV</button></span></div>
      </div>
      <div class="wa-list" id="waList" aria-live="polite"></div>
      <div class="wa-list wa-sres" id="waSRes" hidden aria-live="polite"></div>
    </section>
    <details class="wa-sec wa-paste" id="waPasteBox"><summary class="wa-sech">📋 Paste or upload<span class="wa-sub">when the link is off</span></summary>
      <div class="wa-secb">
        <textarea id="waPaste" placeholder="[9:01 AM, 18/10/2026] Sam: 324 CO&#10;[9:05 AM, 18/10/2026] Lina: 202 LCO 6PM" aria-label="Paste WhatsApp messages"></textarea>
        <div class="wa-btns"><button type="button" class="wa-btn pri" id="waRead">Read messages</button><button type="button" class="wa-btn" id="waClip">📋 Paste</button><button type="button" class="wa-btn" id="waUpBtn">📂 Upload exported chat (.txt)</button><input type="file" id="waFile" accept=".txt,text/plain" hidden></div>
      </div>
    </details>
    <details class="wa-sec" id="waGrpBox"><summary class="wa-sech">👥 Groups<span class="wa-sub" id="waGrpSub"></span></summary>
      <div class="wa-secb"><div class="wa-grps" id="waGrps"></div>
        <p class="wa-hint">The open group in WhatsApp is read fully. For other groups only the latest message (the preview in the chat list) is seen: open them now and then to catch up. To read a second group fully all day, link WhatsApp Web in a second browser (for example Edge) as another device and run the reader there too.</p></div>
    </details>
    <details class="wa-sec wa-help" id="waHelp"><summary class="wa-sech">❔ How to set up</summary>
      <div class="wa-secb">
      <p><b>What it does:</b> it reads your WhatsApp groups and only sends what you send from HotelOps. When someone writes <code>324 CO</code>, room 324 is checked out here. <code>202 LCO 6PM</code> sets a 6 PM late check-out. <code>0113 EXT 2N</code> (or <code>extended till 22 Oct</code>) marks an extension. Lists work too (<code>Checkout list:</code> then one room per line). Other messages with a room (like <code>415 change bedsheet</code>) become a note, or a request when the guest is not leaving today. Every change has an Undo. Every message is kept as a backup: search it above and download it any time.</p>
      <p><b>Option A — automatic</b></p>
      <ol>
        <li>Open WhatsApp Web on this computer.</li>
        <li>Press <b>F12</b> and click <b>Console</b>.</li>
        <li>If Chrome asks, type <code>allow pasting</code> and press Enter.</li>
        <li>Copy the line below (<b>Copy</b> button), paste it in the Console and press Enter. Close F12.</li>
        <li>Type the group name when asked, then open the group. Add more groups in the reader's <b>Groups</b> tab.</li>
        <li>A HotelOps window shows at the bottom left of WhatsApp. Click <b>Connect HotelOps</b> once. A HotelOps tab opens — keep it open.</li>
      </ol>
      <p>Do this again each time you reload WhatsApp. If the window turns amber, use its <b>📋 Copy today's chat</b> button (Settings tab) and paste here.</p>
      <textarea id="waSnippet" readonly aria-label="Line to paste in the WhatsApp Console">Loading…</textarea>
      <div class="wa-btns"><button type="button" class="wa-btn" id="waCopySnip">Copy</button></div>
      <p><b>Option B — no setup, always works</b></p>
      <ol>
        <li>In WhatsApp Web, with the mouse, click and drag from the first message of today down to the last one.</li>
        <li>Press <b>Ctrl+C</b>. (WhatsApp copies the time and name with each message.)</li>
        <li>Open <b>📋 Paste or upload</b> above, paste and press <b>Read messages</b>. Messages already done are skipped.</li>
      </ol>
      <p><b>From the phone:</b> open the chat → ⋮ → More → Export chat → Without media. Send the .txt to this computer and use <b>📂 Upload exported chat</b>.</p>
      </div>
    </details>
  </div>`;
  // its own window over the app, opened from the top bar
  const ov = doc.createElement('div'); ov.id = 'waOv'; ov.className = 'wa-ov'; ov.hidden = true;
  ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'WhatsApp');
  ov.appendChild(card); doc.body.appendChild(ov);
  const $ = id => doc.getElementById(id);
  $('waClose').onclick = () => waClose();
  $('waWords').onclick = () => { if (typeof W.hoWaWordsOpen === 'function') W.hoWaWordsOpen(); };
  ov.addEventListener('mousedown', e => { if (e.target === ov) waClose(); });
  doc.addEventListener('keydown', e => { if (e.key === 'Escape' && !ov.hidden) { e.preventDefault(); waClose(); } });
  if (/wa-bridge/.test(location.hash)) setTimeout(() => window.waOpenFromTop && window.waOpenFromTop(), 400);
  const ta = $('waPaste');
  $('waRead').onclick = () => { const v = ta.value; if (!v.trim()) { showToast('Paste the WhatsApp messages first', 'warn'); ta.focus(); return; } if (readPasted(v)) ta.value = ''; };
  $('waClip').onclick = async () => {
    try { const t = await navigator.clipboard.readText(); if (!t || !t.trim()) { showToast('The clipboard is empty', 'warn'); return; } ta.value = t; if (readPasted(t)) ta.value = ''; }
    catch (_) { showToast('Press Ctrl+V in the box, then Read messages', 'info'); ta.focus(); }
  };
  const fi = $('waFile');
  $('waUpBtn').onclick = () => fi.click();
  fi.onchange = () => { const f = fi.files && fi.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { readPasted(String(rd.result || '')); fi.value = ''; }; rd.readAsText(f); };
  $('waHelp').addEventListener('toggle', loadSnippet);
  $('waCopySnip').onclick = () => {
    const s = $('waSnippet'); const v = s.value;
    if (!v || /^Loading|^Could not/.test(v)) return;
    const done = () => showToast('Copied · paste it in the WhatsApp Web Console', 'ok');
    try { navigator.clipboard.writeText(v).then(done, () => { s.select(); doc.execCommand('copy'); done(); }); } catch (_) { s.select(); try { doc.execCommand('copy'); done(); } catch (__) {} }
  };
  $('waList').addEventListener('click', e => {
    const g = e.target.closest('[data-wa-ok]'); if (g) { confirmGuess(g.getAttribute('data-wa-ok'), g.getAttribute('data-m')); return; }
    const b = e.target.closest('[data-wa-undo]'); if (!b) return;
    const f = undoFns[b.getAttribute('data-wa-undo')]; if (f) f();
  });
  // filters
  $('waFilt').addEventListener('click', e => {
    const b = e.target.closest('[data-f]'); if (!b) return;
    FILT = b.getAttribute('data-f');
    doc.querySelectorAll('#waFilt [data-f]').forEach(x => x.classList.toggle('on', x === b));
    renderCard();
  });
  $('waGF').onchange = () => { GFILT = $('waGF').value; renderCard(); shown = PAGE; runSearch(); };
  // the composer
  const msgEl = $('waMsg');
  $('waTpl').addEventListener('click', e => {
    const b = e.target.closest('[data-tpl]'); if (!b) return;
    const t = TEMPLATES.find(x => x.k === b.getAttribute('data-tpl')); if (!t) return;
    const room = $('waRoom').value.trim(), time = $('waTime').value.trim();
    if (/room/.test(t.need) && !/^\d{3,4}$/.test(room)) { showToast('Type the room number first', 'warn'); $('waRoom').focus(); return; }
    if (/time/.test(t.need) && !time) { showToast('Type the time first (for example 2 PM)', 'warn'); $('waTime').focus(); return; }
    const ext = rooms().filter(r => r.status === 'extended').map(r => r.roomStr + (r.extensionNights ? ' +' + r.extensionNights + 'N' : '')).join(', ') || 'none';
    msgEl.value = fillTemplate(t.t, { room, time: t.k === 'ext' ? hhmm() : time, ext });
    msgEl.focus();
  });
  $('waCoList').onclick = () => {
    if (!rooms().length) { showToast('Load today\'s departures first', 'warn'); return; }
    msgEl.value = checkoutListText(rooms(), new Date()); msgEl.focus();
    showToast('Check the list, then press Send to WhatsApp', 'info');
  };
  const au = $('waAutoSend');
  if (au) { au.checked = waAutoOn(); au.onchange = () => { try { localStorage.setItem('ho_wa_autosend', au.checked ? '1' : '0'); } catch (_) {} showToast(au.checked ? 'Messages are sent straight away' : 'Messages are typed in WhatsApp; you press Enter', 'ok'); renderStatus(); }; }
  $('waSendBtn').onclick = () => { const it = waSend(msgEl.value, $('waGrp').value); if (it) msgEl.value = ''; };
  msgEl.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('waSendBtn').click(); } });
  $('waOut').addEventListener('click', e => {
    const c = e.target.closest('[data-out-cancel]'); if (c) { cancelOut(c.getAttribute('data-out-cancel')); return; }
    const r = e.target.closest('[data-out-again]'); if (r) { const it = OUT.find(o => o.id === r.getAttribute('data-out-again')); if (it) waSend(it.text, it.group); }
  });
  // groups (log only here too)
  $('waGrps').addEventListener('change', e => {
    const c = e.target.closest('[data-g]'); if (c) setGroupAct(c.getAttribute('data-g'), c.checked);
    const h = e.target.closest('[data-gho]'); if (h) { setGroupHo(h.getAttribute('data-gho'), h.checked); showToast(h.getAttribute('data-gho') + (h.checked ? ': handover group · saved to the 📒 Handover Book, rooms are not changed' : ': not a handover group'), 'info'); }
    const k = e.target.closest('[data-gcopy]'); if (k) setGroupCopy(k.getAttribute('data-gcopy'), k.checked);
  });
  // questions
  $('waAsks').addEventListener('click', e => {
    const b = e.target.closest('[data-ans]'); if (!b) return;
    const box = b.closest('[data-ask]'), w = box.getAttribute('data-ask'), note = (box.querySelector('input') || {}).value || '';
    answerAsk(w, b.getAttribute('data-ans'), note);
  });
  // search the chat backup
  const qEl = $('waQ');
  let qt = null;
  qEl.addEventListener('input', () => { clearTimeout(qt); qt = setTimeout(() => { shown = PAGE; runSearch(); }, 160); });
  qEl.addEventListener('keydown', e => { if (e.key === 'Escape' && qEl.value) { e.stopPropagation(); qEl.value = ''; runSearch(); } });
  $('waRng').addEventListener('click', e => {
    const b = e.target.closest('[data-r]'); if (!b) return;
    RNG = b.getAttribute('data-r');
    doc.querySelectorAll('#waRng [data-r]').forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    const pk = $('waPick'); pk.hidden = RNG !== 'pick';
    if (RNG === 'pick') { const f = $('waFrom'), t = $('waTo'); if (!t.value) t.value = today(); if (!f.value) f.value = dayAdd(today(), -6); }
    shown = PAGE; runSearch();
  });
  ['waFrom', 'waTo'].forEach(id => $(id).addEventListener('change', () => { shown = PAGE; runSearch(); }));
  $('waSRes').addEventListener('click', e => { if (e.target.closest('.wa-more')) { shown += PAGE; drawResults(); } });
  $('waDlTxt').onclick = () => download('txt');
  $('waDlCsv').onclick = () => download('csv');
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
  doc.getElementById('waFilt').style.display = active ? 'none' : '';
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
  if (GFILT) RES = RES.filter(o => gKey(o.rec.g || '') === gKey(GFILT));
  RANGE = { from: days[0] || today(), to: days[days.length - 1] || today() };
  const n = RES.length, rl = { today: 'today', '7': 'in the last 7 days', '30': 'in the last 30 days', all: 'in all days', pick: RANGE.from === RANGE.to ? 'on ' + dmy(RANGE.from) : dmy(RANGE.from) + ' to ' + dmy(RANGE.to) }[RNG];
  cnt.textContent = (q.trim() ? `${n} result${n === 1 ? '' : 's'}` : `${n} message${n === 1 ? '' : 's'} kept`) + ' ' + rl;
  doc.getElementById('waDlTxt').disabled = doc.getElementById('waDlCsv').disabled = !n;
  if (active) { if (!keepScroll) doc.getElementById('waSRes').scrollTop = 0; drawResults(); }
}
/** records still waiting to be saved (whole ones only) */
function pendingRecs(d) { const o = {}; Object.keys(archQ[d] || {}).forEach(k => { if (k.indexOf('/') < 0 && archQ[d][k]) o[k] = archQ[d][k]; }); return o; }
const fmtDay = d => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
function avatar(sender, mine) {
  if (mine || /^me$/i.test(sender)) return '<span class="wa-av me" aria-hidden="true">Me</span>';
  if (isPhone(sender)) return `<span class="wa-av ph" aria-hidden="true">${SVG_PH}</span>`;
  return `<span class="wa-av" style="--h:${hueOf(sender)}" aria-hidden="true">${esc(initials(sender) || '?')}</span>`;
}
function drawResults() {
  const box = doc.getElementById('waSRes'); if (!box) return;
  const q = searchTokens(doc.getElementById('waQ').value);
  if (!RES.length) { box.innerHTML = `<div class="wa-empty"><b>🔍</b>${q.length ? 'Nothing found. Try a room number, a word or a name.' : 'No messages kept for these days yet.'}</div>`; return; }
  const per = {}; RES.forEach(o => { per[o.day] = (per[o.day] || 0) + 1; });
  let html = '', last = '';
  RES.slice(0, shown).forEach(o => {
    if (o.day !== last) { last = o.day; html += `<div class="wa-day">${esc(fmtDay(o.day))}<span>${per[o.day]}</span></div>`; }
    const r = o.rec, ch = archChips(r.r);
    html += `<div class="wa-row${r.u ? ' undone' : ''}">${avatar(r.s, r.m)}<span class="wa-m"><span class="wa-mh"><span class="wa-who">${hoWaHi(r.s || '', q)}${r.e ? ' ✎' : ''}</span><span class="wa-tm">${esc(t12(r.t))}</span>${r.g ? `<span class="wa-tag">${esc(r.g)}</span>` : ''}</span>${r.q ? `<span class="wa-quote" style="display:block">↩ ${esc(String(r.q).replace(/\s*\n\s*/g, ' · ').slice(0, 140))}</span>` : ''}<span class="wa-txt" style="display:block">${hoWaHi(String(r.x || '').length > 400 ? String(r.x).slice(0, 400) + '…' : r.x, q)}</span></span><span></span>`
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

// ── drawing ─────────────────────────────────────────────────
function renderStatus() {
  const el = doc.getElementById('waStatus'); if (!el) return;
  const on = linkSeen && Date.now() - linkSeen < 20000;
  const g = LINK && (LINK.open || (LINK.groups && LINK.groups.map(x => x.name).join(', ')));
  el.innerHTML = on ? `<i class="wa-dot on"></i><span>Linked to WhatsApp${g ? ' · reading ' + esc(g) : ''}${LINK && LINK.rtt ? ' · ' + Math.round(LINK.rtt) + ' ms' : ''}</span>`
    : `<i class="wa-dot"></i><span>${LOG.length ? 'Not linked right now · ' : 'Not linked · '}set up once with ❔ How to set up, or paste below</span>`;
  const hint = doc.getElementById('waSendHint');
  if (hint) hint.textContent = !on ? 'Link WhatsApp Web first (❔ How to set up). Nothing is sent until you press Send.' : (waAutoOn() || (LINK && LINK.auto)) ? 'Sent straight away to the group.' : 'It is typed in WhatsApp for you. You press Enter there to send it.';
  const wb = doc.getElementById('waWords'); if (wb) wb.hidden = typeof W.hoWaWordsOpen !== 'function';
}
function renderKpis() {
  const el = doc.getElementById('waKpis'); if (!el) return;
  const n = { co: 0, lco: 0, ext: 0, note: 0, req: 0 };
  LOG.forEach(l => { if (l.undone) return; l.res.forEach(r => { if (n[r.st] !== undefined) n[r.st]++; }); });
  el.innerHTML = [['co', 'Checked out', 'var(--wa-co)', 'Out'], ['lco', 'Late check-out', 'var(--wa-lco)', 'LCO'], ['ext', 'Extended', 'var(--wa-ext)', 'Ext.'], ['note', 'Notes', 'var(--wa-note)', 'Notes'], ['req', 'Requests', 'var(--text3)', 'Req.']]
    .map(([k, l, c, sh]) => `<div class="wa-kpi${n[k] ? '' : ' zero'}" style="--c:${c}" title="${l} today"><b>${n[k]}</b><span class="wa-kl">${l}</span><span class="wa-ks">${sh}</span></div>`).join('');
}
function renderAsks() {
  const el = doc.getElementById('waAsks'); if (!el) return;
  const list = Object.keys(ASKS).map(k => ASKS[k]).filter(q => q && q.word && !KNOWN[q.word]).sort((a, b) => (a.at || 0) - (b.at || 0)).slice(0, 4);
  el.innerHTML = list.map(q => `<div class="wa-ask" data-ask="${esc(q.word)}"><p>❓ <b>${esc(q.sender || 'Someone')}</b> wrote <q>${esc(String(q.text || '').slice(0, 120))}</q>. What does <q>${esc(q.word)}</q> mean?${q.msgs && q.msgs.length > 1 ? ` <span class="wa-hint">(${q.msgs.length} messages wait for it)</span>` : ''}</p>
    ${q.guess && MEANINGS[q.guess] ? `<p class="wa-hint" style="margin:4px 0 6px">🤔 My guess: <b>${esc(MEANINGS[q.guess])}</b>. Did I get it?</p>` : ''}
    <div class="wa-aw">${(q.guess && MEANINGS[q.guess] ? [q.guess].concat(Object.keys(MEANINGS).filter(m => m !== q.guess)) : Object.keys(MEANINGS)).map(m => `<button type="button" class="wa-chipb${m === q.guess ? ' on' : ''}" data-ans="${m}"${m === q.guess ? ' style="font-weight:800;outline:2px solid var(--wa-g,#25d366)"' : ''}>${m === q.guess ? '✓ Yes, ' : ''}${esc(MEANINGS[m])}</button>`).join('')}</div>
    <div class="wa-aw"><input class="wa-in" placeholder="What it stands for (optional), e.g. Vacant Dirty" aria-label="What the word stands for" maxlength="60"></div></div>`).join('');
}
function renderGroups() {
  const names = groupNames();
  const sel = doc.getElementById('waGrp'), gf = doc.getElementById('waGF'), box = doc.getElementById('waGrps'), sub = doc.getElementById('waGrpSub');
  const to = doc.getElementById('waSendTo');
  if (sel) {
    const cur = sel.value || (LINK && LINK.open) || '';
    sel.innerHTML = names.length ? names.map(n => `<option value="${esc(n)}"${gKey(n) === gKey(cur) ? ' selected' : ''}>${esc(n)}</option>`).join('') : '<option value="">The open group</option>';
    sel.hidden = names.length < 2;
    if (to) to.textContent = names.length === 1 ? '→ ' + names[0] : names.length ? names.length + ' groups' : '';
  }
  if (gf) {
    gf.hidden = names.length < 2;
    gf.innerHTML = '<option value="">All groups</option>' + names.map(n => `<option value="${esc(n)}"${gKey(n) === gKey(GFILT) ? ' selected' : ''}>${esc(n)}</option>`).join('');
  }
  if (box) box.innerHTML = names.length ? names.map(n => { const g = GRP[gKey(n)], rg = LINK && LINK.groups && LINK.groups.find(x => gKey(x.name) === gKey(n)); const on = !(g && g.act === false) && !(rg && rg.act === false);
    return `<div class="wa-g"><b title="${esc(n)}">${esc(n)}</b>${LINK && gKey(LINK.open || '') === gKey(n) ? '<span class="wa-tag">open</span>' : ''}${groupIsHo(n) ? '<span class="wa-tag ho" title="Everything posted here is saved to the Handover Book; rooms are not changed">📋 Handover</span>' : `<label><input type="checkbox" data-g="${esc(n)}"${on ? ' checked' : ''}${rg && rg.act === false ? ' disabled title="Set to Log only in the WhatsApp window"' : ''}> Can change rooms</label><label title="Messages that read like handover items (early departure, room move, complaint…) are also copied to the Handover Book"><input type="checkbox" data-gcopy="${esc(n)}"${groupCopies(n) ? ' checked' : ''}> Copy handover items</label>`}<label title="A group used only for the shift handover: everything goes to the Handover Book"><input type="checkbox" data-gho="${esc(n)}"${groupIsHo(n) ? ' checked' : ''}> Handover group</label></div>`; }).join('')
    : '<div class="wa-hint">No groups yet. Groups show here once the reader on WhatsApp Web is linked.</div>';
  if (sub) sub.textContent = names.length ? names.length + (names.length === 1 ? ' group' : ' groups') : '';
}
function renderOut() {
  const el = doc.getElementById('waOut'); if (!el) return;
  el.innerHTML = OUT.slice(0, 5).map(o => { const s = OUT_ST[o.st] || OUT_ST.wait;
    const lbl = o.st === 'queued' ? `Waiting · open ${o.group || 'the group'} in WhatsApp` : o.st === 'failed' && o.why ? 'Not sent: ' + o.why : s[1];
    return `<div class="wa-o ${esc(o.st)}"><time>${esc(clock(new Date(o.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })))}</time><span class="wa-ot" title="${esc(o.text)}">${esc(o.text.replace(/\s*\n\s*/g, ' · '))}</span><span class="wa-os">${s[0]} ${esc(lbl)}${o.st === 'queued' || o.st === 'typed' ? ` <button type="button" class="wa-btn sm" data-out-cancel="${esc(o.id)}">Cancel</button>` : o.st === 'failed' ? ` <button type="button" class="wa-btn sm" data-out-again="${esc(o.id)}">Try again</button>` : ''}</span></div>`; }).join('');
}
function chipsOf(l) {
  const out = [];
  l.res.forEach(r => {
    let label = r.text;
    if (r.st === 'note') label = `Note on ${r.room}`;
    else if (r.st === 'req') label = `Request · room ${r.room}`;
    else if (r.st === 'co') label = String(r.text).replace(/ · ⚠ balance.*$/, '');
    if (l.undone && /^(?:co|lco|ext|extending|fin|note)$/.test(r.st)) label += ' — undone';
    out.push(`<span class="wa-chip ${esc(r.st)}">${ICON[r.st] || ''} ${esc(label)}${r.w ? esc(r.w) : ''}</span>`);
    const b = r.st === 'co' && balInfo(r); if (b) out.push(`<span class="wa-chip ${b.tone}">${esc(b.label)}</span>`);
    if (r.guess && !l.undone) out.push(`<button type="button" class="wa-u" style="grid-column:auto" data-wa-ok="${esc(r.guess)}" data-m="${esc(r.m || r.st)}" title="Yes, &quot;${esc(r.guess)}&quot; means this: remember it">✓ Right</button>`);
  });
  return out.join('');
}
function renderCard() {
  const list = doc.getElementById('waList'); if (!list) return;
  const cnt = doc.getElementById('waCount'); if (cnt) cnt.textContent = LOG.length;
  const counts = { all: 0, actions: 0, notes: 0, attention: 0, ignored: 0 };
  const shownL = LOG.slice().sort((a, b) => String(b.time || '').localeCompare(String(a.time || '')) || (b.at || 0) - (a.at || 0)).filter(l => !GFILT || gKey(l.group || '') === gKey(GFILT)).filter(l => { const k = entryKinds(l); counts.all++; k.forEach(x => { counts[x]++; }); return FILT === 'all' || k.has(FILT); });
  doc.querySelectorAll('#waFilt [data-n]').forEach(x => { const n = counts[x.getAttribute('data-n')]; x.textContent = n ? n : ''; });
  let html = '', lastH = '';
  const multi = groupNames().length > 1;
  shownL.forEach(l => {
    const h = hourLabel(l.time);
    if (h !== lastH) { lastH = h; html += `<div class="wa-hr">${esc(h)}<span>${shownL.filter(x => hourLabel(x.time) === h).length}</span></div>`; }
    const k = entryKinds(l), st = l.res.map(r => r.st);
    const tone = k.has('attention') ? 't-bad' : st.includes('co') ? 't-co' : st.includes('lco') ? 't-lco' : (st.includes('ext') || st.includes('extending')) ? 't-ext' : (st.includes('note') || st.includes('req')) ? 't-note' : '';
    const quiet = l.res.every(r => /^(?:none|ignore|log|preview)$/.test(r.st));
    html += `<article class="wa-msg ${tone}${l.undone ? ' undone' : ''}${l.deleted ? ' del' : ''}${quiet ? ' quiet' : ''}" title="${esc(l.res.map(r => r.text).join(' · '))}">${avatar(l.sender, l.mine)}
      <div class="wa-mh"><span class="wa-who">${esc(l.sender)}${l.edited ? ' ✎' : ''}</span><span class="wa-tm">${esc(clock(l.time))}</span>${l.group && multi ? `<span class="wa-tag">${esc(l.group)}</span>` : ''}${l.preview ? '<span class="wa-tag pv">preview</span>' : ''}</div>
      ${undoFns[l.key] && !l.undone ? `<button type="button" class="wa-u" data-wa-undo="${esc(l.key)}">↺ Undo</button>` : ''}
      ${l.quote ? `<div class="wa-quote" title="Reply to">↩ ${esc(l.quote.replace(/\s*\n\s*/g, ' · ').slice(0, 140))}</div>` : ''}
      <div class="wa-txt">${esc(l.text.length > 220 ? l.text.slice(0, 220) + '…' : l.text)}</div>
      <div class="wa-res">${chipsOf(l)}</div></article>`;
  });
  list.innerHTML = html || `<div class="wa-empty"><b>💬</b>${LOG.length ? 'Nothing here with this filter.' : 'No WhatsApp messages yet today.<br>New messages from the group show here as they come in.'}</div>`;
  renderKpis(); renderAsks(); renderGroups(); renderOut(); renderStatus();
}

function start() {
  if (!mount()) return;
  if (/wa-bridge/.test(location.hash)) {
    // opened by the WhatsApp snippet: show Departures, and keep the address clean
    setTimeout(() => { try { if (typeof showPanel === 'function') showPanel('departures'); } catch (_) {} }, 1500);
  }
  listenAsks(); hookWords();
  setInterval(() => { hookWords(); pushWords(); if (doc.getElementById('waStatus')) renderStatus(); }, 15000);
  setInterval(flushPending, 4000);
}
W.hoWaBridge = { handle, flushPending, findRoom, readPasted, parse, parseCopied: hoWaParseCopied, log: () => LOG.slice(), origins: ORIGINS, render: renderCard, search: runSearch, flushBackup: flushArch, results: () => RES.slice(),
  send: waSend, outbox: () => OUT.slice(), link: () => (LINK ? { at: LINK.at, groups: LINK.groups || [], open: LINK.open || '', rtt: LINK.rtt || 0, auto: !!LINK.auto, linked: linked() } : null),
  asks: () => Object.keys(ASKS).map(k => ASKS[k]), answer: answerAsk, confirmGuess, words: wordsList, setGroupAct, setGroupHo, setGroupCopy, isHandoverGroup: groupIsHo, checkoutList: () => checkoutListText(rooms(), new Date()) };
if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
})();

// Top bar button: the WhatsApp window over the app
function waOpenFromTop() {
  const ov = document.getElementById('waOv'); if (!ov) return;
  ov.hidden = false; ov.scrollTop = 0;
  document.documentElement.style.overflow = 'hidden';   // the page behind stays still; the window scrolls
  if (window.hoWaBridge) try { window.hoWaBridge.render(); } catch (_) {}
  const c = document.getElementById('waCard'); if (c) setTimeout(() => c.focus({ preventScroll: true }), 60);
}
function waClose() { const ov = document.getElementById('waOv'); if (ov) ov.hidden = true; document.documentElement.style.overflow = ''; }
window.waOpenFromTop = waOpenFromTop; window.waClose = waClose;
