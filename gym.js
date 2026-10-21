// ═══════════════════════════════════════════════════════════
//  gym.js — 🏋️ Gym & Pool memberships
//
//  Who has a gym / pool membership, until when, paid or not, with their
//  ID and the signed papers attached. One page, shared live by the team.
//
//   • Members      gym/members/{id}   (light: the list, the history of
//                                      periods, check-ins and the document
//                                      LIST — never the files themselves)
//   • Settings     gym/cfg            ({ soon: days before the end that
//                                      count as "ending soon" })
//   • Files        gymDocs/{memberId}/{docId}/c/{0..n}   base64 in pieces
//                  of 500 KB, read only when a file is opened. Written with
//                  the database reference directly so they never fill this
//                  device's localStorage (db.js keeps a copy of every fbSet).
//     No Firebase Storage here: pictures are made smaller in the browser
//     (max 1600 px, JPEG 0.8) and PDFs may be up to 1.5 MB.
//   • Paste email: "Ms. A has extended her gym membership for an additional
//     30 days starting from today." → the form, filled (parseEmail).
//   • Import: the team's sheet (Guest Name | Mobile number | Start Date |
//     End Date | Car Plate Number | Amount Paid; .xlsx or .csv, dd.mm.yyyy or
//     Excel dates) with a preview of what is new / updated (importRows,
//     mergePlan). Needs the "Import files" power.
//   • Export for the manager: one panel → a colourful Excel report (ExcelJS,
//     loaded when exporting; plain SheetJS when it cannot load) or the same
//     report as a PDF print page (month-end.js mePrintPage), plus a printable
//     member card for signing. Downloads need "Export files", deleting needs
//     "Delete records" (role-rules.js).
//   • Prices per length (1 month 299, 6 months 1499 by default) fill the
//     amount by themselves; changed in the page settings (gym/cfg/prices).
//   • ID numbers are masked everywhere (784-XXXX-XXXXXXX-1) except in a
//     member's own window after "Show". The activity log never gets them.
//
//  The module adds its own panel, menu items and styles: index.html only
//  needs <script src="gym.js"></script>. Pure helpers: window.hoGymPure
//  (tested in tests/run-tests.js).
// ═══════════════════════════════════════════════════════════
(function () {
'use strict';
const W = typeof window !== 'undefined' ? window : globalThis;
const doc = typeof document !== 'undefined' && document && document.createElement ? document : null;

// ══ Pure helpers ════════════════════════════════════════════
const pad = n => String(n).padStart(2, '0');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_OF = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const isIso = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(Date.parse(s + 'T00:00:00Z'));
const isoOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const utc = s => Date.parse(s + 'T00:00:00Z');
/** "2026-10-21" + 3 → "2026-10-24" */
const addDays = (s, n) => { const d = new Date(utc(s) + n * 864e5); return isoOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); };
/** whole days from a to b (b − a) */
const diffDays = (a, b) => Math.round((utc(b) - utc(a)) / 864e5);
/** "2026-10-03" → "3 Oct 2026" ("3 Oct" with short) */
const fmtD = (s, short) => { if (!isIso(s)) return String(s || ''); const [y, m, d] = s.split('-'); return +d + ' ' + MON[+m - 1] + (short ? '' : ' ' + y); };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => (Math.round((+n || 0) * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });

const TYPES = { gym: 'Gym', pool: 'Pool', gympool: 'Gym + Pool' };
const TYPE_ICON = { gym: '🏋️', pool: '🏊', gympool: '🏋️🏊' };
const KINDS = { guest: 'Hotel guest', outside: 'Outside member', staff: 'Staff' };
const LENGTHS = [['1m', '1 month'], ['30d', '30 days'], ['3m', '3 months'], ['6m', '6 months'], ['12m', '12 months'], ['custom', 'Custom']];
const METHODS = ['Cash', 'Card', 'Room charge (folio)', 'Bank transfer', 'Complimentary'];
const ID_TYPES = { eid: 'Emirates ID', passport: 'Passport', other: 'Other ID' };
const STATUS = { active: 'Active', ending: 'Ending soon', expired: 'Expired', notstarted: 'Not started' };

/** "30d" → { n: 30, u: 'd' } ("1m", "2w", "1y"; null for custom) */
function lenParts(len) { const m = String(len || '').match(/^(\d{1,3})([dwmy])$/); return m && +m[1] > 0 ? { n: +m[1], u: m[2] } : null; }
function lenLabel(len) {
  const k = LENGTHS.find(l => l[0] === len); if (k) return k[1];
  const p = lenParts(len); if (!p) return 'Custom';
  const w = { d: 'day', w: 'week', m: 'month', y: 'year' }[p.u]; return p.n + ' ' + w + (p.n === 1 ? '' : 's');
}
/** The last day of a period that starts on `start` and lasts `len`.
 *  Months: the day before the same date next month (3 Oct → 2 Nov); when that date does not exist
 *  (31 Jan + 1 month) the period ends on the last day of that month (28/29 Feb). Days: start + n − 1. */
function endFor(start, len) {
  const p = lenParts(len); if (!p || !isIso(start)) return '';
  if (p.u === 'd') return addDays(start, p.n - 1);
  if (p.u === 'w') return addDays(start, p.n * 7 - 1);
  const months = p.u === 'y' ? p.n * 12 : p.n;
  const [y, m, d] = start.split('-').map(Number);
  const t = m - 1 + months, ty = y + Math.floor(t / 12), tm = t % 12 + 1;
  const last = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  if (d > last) return isoOf(ty, tm, last);
  return addDays(isoOf(ty, tm, d), -1);
}
/** the length code for a start / end pair ('custom' when no standard one fits) */
function lenOf(start, end) {
  if (!isIso(start) || !isIso(end)) return 'custom';
  const k = LENGTHS.find(l => l[0] !== 'custom' && endFor(start, l[0]) === end);
  return k ? k[0] : 'custom';
}

/** active / ending (≤ soon days left) / expired / notstarted */
function statusOf(m, today, soon) {
  if (!m || !isIso(m.end)) return 'expired';
  soon = soon == null ? 3 : +soon;
  if (isIso(m.start) && today < m.start) return 'notstarted';
  if (today > m.end) return 'expired';
  return diffDays(today, m.end) <= soon ? 'ending' : 'active';
}
/** "12 days left", "1 day left", "ends today", "ended yesterday", "ended 2 days ago", "starts tomorrow", "starts in 3 days" */
function countdown(m, today) {
  if (!m || !isIso(m.end)) return '';
  if (isIso(m.start) && today < m.start) { const s = diffDays(today, m.start); return s === 1 ? 'starts tomorrow' : 'starts in ' + s + ' days'; }
  const n = diffDays(today, m.end);
  if (n === 0) return 'ends today';
  if (n > 0) return n + ' day' + (n === 1 ? '' : 's') + ' left';
  return n === -1 ? 'ended yesterday' : 'ended ' + (-n) + ' days ago';
}
/** how much of the period has gone, 0…1 (for the little bar) */
function progress(m, today) {
  if (!m || !isIso(m.start) || !isIso(m.end)) return 0;
  const all = diffDays(m.start, m.end) + 1, gone = diffDays(m.start, today) + 1;
  return Math.max(0, Math.min(1, gone / Math.max(1, all)));
}

/** The next period when a membership is extended.
 *  mode 'after' = the day after the current end, 'today', 'date' (on `date`), 'auto' = after when it is still on, else today.
 *  customEnd is used for len 'custom'. → { start, end, mode } ('' end when it can't be worked out) */
function extendPlan(m, len, today, mode, date, customEnd) {
  const on = m && isIso(m.end) && m.end >= today;
  if (!mode || mode === 'auto') mode = on ? 'after' : 'today';
  let start = today;
  if (mode === 'after' && m && isIso(m.end)) start = addDays(m.end, 1);
  else if (mode === 'date' && isIso(date)) start = date;
  let end = len === 'custom' ? (isIso(customEnd) && customEnd >= start ? customEnd : '') : endFor(start, len);
  return { start, end, mode };
}
/** The member's period after an extension: one unbroken membership keeps its first day,
 *  a gap (expired, or a later date) starts a new one. Never shortens the current end. */
function applyExtend(m, plan) {
  if (!plan || !isIso(plan.start) || !isIso(plan.end)) return null;
  const cur = m && isIso(m.end) ? m.end : '';
  const joined = cur && plan.start <= addDays(cur, 1) && isIso(m.start) && m.start <= plan.start;
  return { start: joined ? m.start : plan.start, end: joined && cur > plan.end ? cur : plan.end };
}

/** only the digits (and letters for passports), upper case */
const idClean = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
/** "784199012345671" → "784-1990-1234567-1" (else the cleaned text) */
function fmtEid(s) { const d = idClean(s); return /^784\d{12}$/.test(d) ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7, 14)}-${d.slice(14)}` : d; }
/** the full number, Emirates IDs with dashes */
const idFull = no => { const d = idClean(no); return /^784\d{12}$/.test(d) ? fmtEid(d) : d; };
/** for lists: Emirates ID → "784-XXXX-XXXXXXX-1", other IDs → "XXXXXX123" */
function maskId(no, type) {
  const d = idClean(no); if (!d) return '';
  if (/^784\d{12}$/.test(d) || (type === 'eid' && d.length >= 8)) return '784-XXXX-XXXXXXX-' + d.slice(-1);
  if (d.length <= 4) return 'X'.repeat(d.length);
  return 'X'.repeat(d.length - 3) + d.slice(-3);
}

// ── dates in text: 03-10-2026, 3/10/26, 2026-10-03, 3 October 2026, Oct 3, 2026 ──
const D_SRC = '(?:\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}[-/.]\\d{1,2}[-/.]\\d{2,4}|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?[A-Za-z]{3,9}\\.?,?\\s+\\d{4}|[A-Za-z]{3,9}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4})';
/** one date written in an email → "YYYY-MM-DD" ('' when it is not a real date). Day first (dd-mm-yyyy), as in the UAE. */
function parseDate(s) {
  s = String(s || '').trim(); let y, m, d, x;
  if ((x = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) { y = +x[1]; m = +x[2]; d = +x[3]; }
  else if ((x = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/))) { d = +x[1]; m = +x[2]; y = +x[3]; if (y < 100) y += 2000; }
  else if ((x = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([A-Za-z]{3,9})\.?,?\s+(\d{4})$/))) { d = +x[1]; m = MONTH_OF[x[2].toLowerCase().slice(0, x[2].toLowerCase().startsWith('sept') ? 4 : 3)]; y = +x[3]; }
  else if ((x = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/))) { m = MONTH_OF[x[1].toLowerCase().slice(0, 3)]; d = +x[2]; y = +x[3]; }
  if (!m || m > 12 || !d || d > 31 || !y) return '';
  const out = isoOf(y, m, d);
  return isIso(out) && new Date(utc(out)).getUTCDate() === d ? out : '';
}
const WORD_N = { a: 1, an: 1, one: 1, single: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, thirty: 30, sixty: 60, ninety: 90 };
const TITLE_RX = /\b(Mr|Mrs|Ms|Miss|Mx|Dr|Madam|Mme|Sheikh|Sheikha)\.?\s+((?:[A-Z][A-Za-z'’-]*|(?:bin|bint|al|el|de|del|van|von|da|abu|ibn)(?=\s+[A-Z]))(?:\s+(?:[A-Z][A-Za-z'’-]*|(?:bin|bint|al|el|de|del|van|von|da|abu|ibn)(?=\s+[A-Z]))){0,4})/;
const NAME_STOP = /^(?:Has|Have|Is|Was|Will|Our|The|And|From|For|In|Room|Guest)$/;

/** Reads a membership email (or WhatsApp) and returns what it says:
 *  { title, name, action: 'new'|'extend', kind: 'guest'|'outside'|'staff'|'', room, type: 'gym'|'pool'|'gympool',
 *    len, start, end, idType, idNo, passport, phone, email, nat, price, found: [what was read] } */
function parseEmail(text, today) {
  const t = String(text || '').replace(/[   ]/g, ' ');
  const out = { title: '', name: '', action: 'new', kind: '', room: '', type: 'gym', len: '', start: '', end: '', idType: '', idNo: '', phone: '', email: '', nat: '', price: '', plate: '', found: [] };
  if (!t.trim()) return out;
  const f = w => out.found.push(w);
  // the name, after Mr. / Ms. / Mrs. …, or "Name: …"
  let x = t.match(TITLE_RX);
  if (x) {
    const words = x[2].split(/\s+/); while (words.length > 1 && NAME_STOP.test(words[words.length - 1])) words.pop();
    if (!NAME_STOP.test(words[0])) { out.title = x[1].replace(/^(\w)(\w*)$/, (a, b, c) => b.toUpperCase() + c.toLowerCase()); out.name = words.join(' '); }
  }
  if (!out.name && (x = t.match(/\b(?:guest|member|client)?\s*name\s*[:\-]\s*([A-Za-z][A-Za-z'’ .-]{1,60})/i))) out.name = x[1].replace(/\s{2,}/g, ' ').trim().replace(/[ .]+$/, '');
  if (out.name) f('name');
  // new or an extension
  if (/\b(?:extend(?:ed|s|ing)?|extension|renew(?:ed|al|s|ing)?|additional|another|prolong(?:ed)?)\b/i.test(t)) out.action = 'extend';
  f(out.action === 'extend' ? 'extension' : 'new');
  // gym, pool or both
  const gym = /\b(?:gym|fitness|health\s*club)\b/i.test(t), pool = /\b(?:pool|swim(?:ming)?)\b/i.test(t);
  out.type = gym && pool ? 'gympool' : pool ? 'pool' : 'gym'; f(TYPES[out.type]);
  // who: a hotel guest, an outside member, staff
  if (/\b(?:staff|colleague|employee|team member)\b/i.test(t)) out.kind = 'staff';
  else if (/\b(?:outside|external|non[-\s]?resident|walk[-\s]?in|local)\s+(?:member|guest|customer|client)\b/i.test(t)) out.kind = 'outside';
  else if (/\b(?:our|hotel|in[-\s]?house)\s+guests?\b|\bstaying\b|\b(?:room|rm)\s*(?:no\.?|number|#)?\s*[:\-]?\s*\d{3,4}\b/i.test(t)) out.kind = 'guest';
  if ((x = t.match(/\b(?:room|rm)\s*(?:no\.?|number|#)?\s*[:\-]?\s*(\d{3,4})\b/i))) { out.room = x[1]; f('room ' + x[1]); }
  // how long: "for one month", "30 days", "an additional 30 days", "3 months", "one year"
  if ((x = t.match(/\b(?:(\d{1,3})|(a|an|one|single|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|thirty|sixty|ninety))[\s-]+(?:additional\s+|more\s+|extra\s+|further\s+)?(days?|weeks?|months?|years?)\b/i))) {
    const n = x[1] ? +x[1] : WORD_N[x[2].toLowerCase()], u = x[3].toLowerCase()[0];
    if (n > 0) { out.len = u === 'y' ? n * 12 + 'm' : u === 'w' ? n * 7 + 'd' : n + u; f(lenLabel(out.len)); }
  }
  // when: "Membership period: 03-10-2026 to 02-11-2026", "starting today", "from 5 Oct 2026"
  const range = t.match(new RegExp('(' + D_SRC + ')\\s*(?:to|till|until|through|thru|[-–—])\\s*(' + D_SRC + ')', 'i'));
  if (range) { const a = parseDate(range[1]), b = parseDate(range[2]); if (a && b && b >= a) { out.start = a; out.end = b; f('period'); } }
  if (!out.start) {
    const st = t.match(new RegExp('\\b(?:start(?:ing|s|ed)?|effective|valid|from|as of|commenc\\w*|begin(?:ning|s)?)\\b(?:\\s+(?:from|on|as of))?\\s+(today|tomorrow|' + D_SRC + ')', 'i'));
    if (st) { const w = st[1].toLowerCase(); out.start = w === 'today' ? today : w === 'tomorrow' ? addDays(today, 1) : parseDate(st[1]); }
    else if (/\b(?:today|from now)\b/i.test(t)) out.start = today;
    if (out.start) f('start ' + fmtD(out.start, true));
  }
  if (!out.start && out.action === 'new') out.start = today;
  if (out.start && !out.end && out.len) out.end = endFor(out.start, out.len);
  if (out.start && out.end && !out.len) out.len = lenOf(out.start, out.end);
  if (out.start && out.end && out.len && out.len !== 'custom' && endFor(out.start, out.len) !== out.end) out.len = lenOf(out.start, out.end);
  // the ID: an Emirates ID number anywhere (also in a file name "EID_784….pdf"), or a passport number
  if ((x = t.match(/(?<!\d)784[-\s]?\d{4}[-\s]?\d{7}[-\s]?\d(?!\d)/))) { out.idType = 'eid'; out.idNo = fmtEid(x[0]); f('Emirates ID'); }
  else if ((x = t.match(/passport\s*(?:no\.?|number|#)?\s*[:\-]?\s*([A-Za-z0-9]{6,10})\b/i)) && /\d/.test(x[1])) { out.idType = 'passport'; out.idNo = x[1].toUpperCase(); f('passport'); }
  else if (/\b(?:EID|emirates\s*id)\b/i.test(t)) out.idType = 'eid';
  if ((x = t.match(/(?:phone|mobile|mob|tel|contact|whats\s*app)\s*(?:no\.?|number|#)?\s*[:\-]?\s*(\+?\d[\d\s-]{6,16}\d)/i)) || (x = t.match(/((?:\+|00)971[\s-]?\d{1,2}[\s-]?\d{3}[\s-]?\d{4}|\b05\d[\s-]?\d{3}[\s-]?\d{4}\b)/))) { out.phone = x[1].replace(/\s{2,}/g, ' ').trim(); f('phone'); }
  if ((x = t.match(/\b(?:car\s*)?plate\s*(?:no\.?|number|#)?\s*[:\-]?\s*([A-Za-z]{0,3}[\s-]?\d{1,6})\b/i))) { out.plate = x[1].toUpperCase().replace(/[\s-]+/g, ''); f('car plate'); }
  else if (/\bno\s+car\b/i.test(t)) out.plate = 'No car';
  if ((x = t.match(/e-?mail\s*(?:address|id)?\s*[:\-]\s*([\w.+-]+@[\w-]+\.[\w.-]+)/i))) { out.email = x[1].replace(/\.$/, ''); f('email'); }
  if ((x = t.match(/nationality\s*[:\-]\s*([A-Za-z][A-Za-z ]{2,30}?)(?=\s*(?:[,.;\n]|$))/i))) { out.nat = x[1].trim(); f('nationality'); }
  if ((x = t.match(/(?:AED|Dhs?\.?|dirhams?)\s*([\d,]+(?:\.\d{1,2})?)/i) || t.match(/([\d,]+(?:\.\d{1,2})?)\s*(?:AED|Dhs?\b|dirhams?)/i))) { const v = +x[1].replace(/,/g, ''); if (v > 0) { out.price = v; f('AED ' + v); } }
  return out;
}
/** a name without titles, lower case words */
const nameToks = s => String(s || '').toLowerCase().replace(/\b(?:mr|mrs|ms|miss|mx|dr|madam|mme|sheikh|sheikha)\b\.?/g, ' ').replace(/[^a-z؀-ۿ' -]+/g, ' ').split(/[\s-]+/).filter(Boolean);
/** the member a pasted name points to (all the words of the shorter name are in the longer one), or null */
function findMember(list, name) {
  const q = nameToks(name); if (!q.length) return null;
  let best = null, score = 0;
  (list || []).forEach(m => {
    if (!m || m.del) return;
    const w = nameToks(m.name); if (!w.length) return;
    const [a, b] = q.length <= w.length ? [q, w] : [w, q];
    if (!a.every(x => b.includes(x))) return;
    const s = a.length / b.length + (q.join(' ') === w.join(' ') ? 1 : 0);
    if (s > score || (s === score && best && String(m.end || '') > String(best.end || ''))) { score = s; best = m; }
  });
  return best;
}

/** the KPI strip: active (incl. ending), ending in the next 7 days, expired this month, revenue this month (periods starting this month, paid) */
function summary(list, today, soon) {
  const mo = today.slice(0, 7), out = { active: 0, ending: 0, week: 0, expiredMonth: 0, notstarted: 0, revenue: 0, toCollect: 0, toCollectN: 0, total: 0 };
  (list || []).forEach(m => {
    if (!m || m.del) return; out.total++;
    const s = statusOf(m, today, soon);
    if (s === 'active' || s === 'ending') out.active++;
    if (s === 'ending') out.ending++;
    if (s === 'notstarted') out.notstarted++;
    if ((s === 'active' || s === 'ending') && diffDays(today, m.end) <= 6) out.week++;
    if (s === 'expired' && String(m.end).slice(0, 7) === mo) out.expiredMonth++;
    Object.values(m.hist || {}).forEach(h => {
      if (!h || String(h.start || '').slice(0, 7) !== mo) return;
      if (h.paid === 'paid') out.revenue += +h.price || 0;
      else if (+h.price > 0) { out.toCollect += +h.price; out.toCollectN++; }
    });
  });
  return out;
}
/** members whose membership ends today or tomorrow → [{ m, when: 'today'|'tomorrow' }] */
function dueSoon(list, today) {
  const tm = addDays(today, 1);
  return (list || []).filter(m => m && !m.del && (m.end === today || m.end === tm) && !(isIso(m.start) && m.start > today))
    .map(m => ({ m, when: m.end === today ? 'today' : 'tomorrow' })).sort((a, b) => (a.when === b.when ? 0 : a.when === 'today' ? -1 : 1) || String(a.m.name).localeCompare(b.m.name));
}
/** the list as filtered on the page: { st: all|active|ending|expired|notstarted, type, kind, q } */
function filterMembers(list, f, today, soon) {
  f = f || {};
  const q = String(f.q || '').trim().toLowerCase(), qd = q.replace(/\D/g, '');
  return (list || []).filter(m => {
    if (!m || m.del) return false;
    const s = statusOf(m, today, soon);
    if (f.st && f.st !== 'all' && !(f.st === s || (f.st === 'active' && s === 'ending'))) return false;
    if (f.type && m.type !== f.type) return false;
    if (f.kind && m.kind !== f.kind) return false;
    if (!q) return true;
    if (String(m.name || '').toLowerCase().includes(q)) return true;
    if (m.room && String(m.room) === q.replace(/^room\s*/, '')) return true;
    if (qd.length >= 3 && idClean(m.idNo).replace(/\D/g, '').endsWith(qd)) return true;
    if (qd.length >= 4 && String(m.phone || '').replace(/\D/g, '').includes(qd)) return true;
    if (String(m.email || '').toLowerCase().includes(q) && q.length >= 3) return true;
    if (q.length >= 3 && m.plate && String(m.plate).toLowerCase().replace(/\s+/g, '').includes(q.replace(/\s+/g, ''))) return true;
    return false;
  });
}
/** by end date: running ones first (soonest end first), then not started, then expired (latest first). by: end|name|added */
function sortMembers(list, today, by) {
  const rank = m => { const s = statusOf(m, today, 0); return s === 'expired' ? 2 : s === 'notstarted' ? 1 : 0; };
  return (list || []).slice().sort((a, b) => {
    if (by === 'name') return String(a.name || '').localeCompare(String(b.name || ''));
    if (by === 'added') return (b.at || 0) - (a.at || 0);
    const r = rank(a) - rank(b); if (r) return r;
    if (rank(a) === 2) return String(b.end).localeCompare(String(a.end));
    if (rank(a) === 1) return String(a.start).localeCompare(String(b.start));
    return String(a.end).localeCompare(String(b.end)) || String(a.name || '').localeCompare(String(b.name || ''));
  });
}
/** periods of a member, oldest first */
const histOf = m => Object.keys((m && m.hist) || {}).map(k => Object.assign({ key: k }, m.hist[k])).filter(h => h && h.start).sort((a, b) => String(a.start).localeCompare(String(b.start)) || (a.at || 0) - (b.at || 0));
/** the current period (the latest one) */
const curOf = m => { const h = histOf(m); return (m && m.curH && m.hist && m.hist[m.curH]) ? Object.assign({ key: m.curH }, m.hist[m.curH]) : h[h.length - 1] || {}; };

// ── documents ──
const CHUNK = 500 * 1024;            // characters per piece in the database
const PDF_MAX = 1.5 * 1024 * 1024;   // bytes
const IMG_MAX = 1.2 * 1024 * 1024;   // bytes after shrinking
const MAX_DOCS = 12;
/** a long base64 string → pieces of `size` characters */
function chunk(str, size) { str = String(str || ''); size = size || CHUNK; const out = []; for (let i = 0; i < str.length; i += size) out.push(str.slice(i, i + size)); return out.length ? out : ['']; }
/** pieces read back from the database (array or {0:…,1:…}) → the string */
function unchunk(c) { if (!c) return ''; if (Array.isArray(c)) return c.join(''); return Object.keys(c).sort((a, b) => +a - +b).map(k => c[k]).join(''); }
/** how many base64 characters a file of n bytes becomes */
const b64Len = n => 4 * Math.ceil((+n || 0) / 3);
/** bytes in a base64 string */
const b64Bytes = s => { s = String(s || ''); const p = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0; return Math.max(0, Math.floor(s.length * 3 / 4) - p); };
/** the size a picture is drawn at: the longest side at most `max` */
function scaleTo(w, h, max) { const s = Math.min(1, (max || 1600) / Math.max(1, w, h)); return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) }; }
/** can this file be kept? → '' or why not. kind: 'pdf' | 'image' */
function docCheck(mime, bytes) {
  mime = String(mime || '').toLowerCase();
  if (mime === 'application/pdf') return bytes > PDF_MAX ? `This PDF is ${(bytes / 1048576).toFixed(1)} MB. The limit is 1.5 MB: scan it in black & white or at a lower quality.` : '';
  if (/^image\//.test(mime)) return bytes > IMG_MAX ? 'This picture is still too big after shrinking it. Take it again a little further away.' : '';
  return 'Only PDFs and pictures (JPG, PNG) can be attached.';
}
/** a file name → what it probably is */
function guessLabel(name) {
  const n = String(name || '').toLowerCase();
  if (/\b(?:eid|emirates|passport|pp|id)\b|eid_|id[_ -]?copy|^id/.test(n)) return 'ID copy';
  if (/waiver|sign|form|agreement|contract|consent|registration/.test(n)) return 'Signed form';
  if (/receipt|invoice|folio|payment|bill/.test(n)) return 'Receipt';
  return 'Other';
}
const DOC_LABELS = ['ID copy', 'Signed form', 'Receipt', 'Other'];
const kb = n => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

// ── the manager's report (Excel + PDF): their sheet's columns first ──
const REPORT_HEAD = ['Guest Name', 'Mobile', 'Start', 'End', 'Car Plate', 'Amount Paid (AED)', 'Status', 'Days left', 'Type', 'Room', 'Paid'];
const REPORT_W = [28, 17, 12, 12, 13, 14, 13, 10, 12, 8, 7];
const SCOPES = { all: 'All', active: 'Active only', ending: 'Ending soon (≤ 7 days)', month: 'This month' };
/** "2026-10-13" → the Excel serial day number (46308) */
const xlSerial = s => (isIso(s) ? 25569 + utc(s) / 864e5 : '');
/** ending within 7 days (still running) */
const ending7 = (m, today) => { const s = statusOf(m, today, 0); return (s === 'active' || s === 'ending') && diffDays(today, m.end) <= 7; };
/** the members of an export: all | active (incl. ending) | ending (≤ 7 days) | month (the period touches this month) */
function scopeFilter(list, scope, today) {
  const mo = today.slice(0, 7), first = mo + '-01', last = endFor(first, '1m');
  return (list || []).filter(m => {
    if (!m || m.del || !m.name) return false;
    const s = statusOf(m, today, 0);
    if (scope === 'active') return s === 'active' || s === 'ending';
    if (scope === 'ending') return ending7(m, today);
    if (scope === 'month') return isIso(m.start) && isIso(m.end) && m.start <= last && m.end >= first;
    return true;
  });
}
/** one report row: dates kept as "YYYY-MM-DD" (the Excel writer turns them into real dates) */
function reportRow(m, today, soon) {
  const c = curOf(m), s = statusOf(m, today, soon), left = s === 'expired' ? '' : diffDays(today, m.end);
  const amount = c.price != null && c.price !== '' ? +c.price || 0 : (+m.price || 0);
  return [fullName0(m), m.phone || '', m.start || '', m.end || '', m.plate || '', amount, STATUS[s], left, TYPES[m.type] || '', m.kind === 'guest' ? (m.room || '') : (m.kind === 'staff' ? 'Staff' : m.kind === 'outside' ? 'Outside' : ''), c.paid === 'paid' || (!c.paid && amount > 0) ? 'Yes' : 'No'];
}
const fullName0 = m => ((m.title ? m.title + '. ' : '') + (m.name || '')).trim();
/** everything the Excel and the PDF show. all = every member (KPIs and the second sheet), scope as SCOPES */
function reportModel(list, all, today, opt) {
  opt = opt || {};
  const sel = sortMembers(scopeFilter(list, opt.scope || 'all', today), today, 'end'), S = summary(all, today, opt.soon);
  const allLive = (all || []).filter(m => m && !m.del && m.name);
  const attention = sortMembers(allLive.filter(m => ending7(m, today) || (statusOf(m, today, 0) === 'expired' && diffDays(m.end, today) <= 31)), today, 'end');
  const rows = sel.map(m => reportRow(m, today, opt.soon));
  return {
    title: 'Gym & Pool Memberships', hotel: opt.hotel || '', date: today, by: opt.user || '', scope: SCOPES[opt.scope || 'all'] || 'All',
    meta: [opt.hotel, fmtD(today), SCOPES[opt.scope || 'all'], opt.user ? 'Prepared by ' + opt.user : ''].filter(Boolean).join(' · '),
    kpis: [['Active', S.active, 'ok'], ['Ending ≤ 7 days', allLive.filter(m => ending7(m, today)).length, 'warn'], ['Expired this month', S.expiredMonth, 'bad'], ['Revenue this month', 'AED ' + money(S.revenue), 'ink']],
    head: REPORT_HEAD, widths: REPORT_W, rows,
    total: ['Total · ' + rows.length + ' member' + (rows.length === 1 ? '' : 's'), '', '', '', '', rows.reduce((t, r) => t + (+r[5] || 0), 0), '', '', '', '', ''],
    attention: attention.map(m => reportRow(m, today, opt.soon)),
  };
}
function fileName(hotel, today, ext) { return ('Gym & Pool Memberships ' + (hotel ? hotel + ' ' : '') + fmtD(today)).replace(/[\\/:*?"<>|&]+/g, '-').replace(/\s*-\s*/g, ' - ').replace(/\s+/g, ' ').trim() + '.' + (ext || 'xlsx'); }
/** "2026-10-13" → "13.10.2026" (the manager's sheet) */
const dDot = s => (isIso(s) ? s.slice(8, 10) + '.' + s.slice(5, 7) + '.' + s.slice(0, 4) : String(s || ''));

/** the printable member card (body for mePrintPage; pure). opt: { today, fullId, hotel, soon } */
function cardHtml(m, opt) {
  opt = opt || {}; const c = curOf(m), s = statusOf(m, opt.today, opt.soon);
  const id = m.idNo ? (opt.fullId ? idFull(m.idNo) : maskId(m.idNo, m.idType)) : '—';
  const row = (k, v) => `<tr><th style="width:34%">${esc(k)}</th><td>${v}</td></tr>`;
  const hist = histOf(m);
  return `<div class="hd"><div><div class="hotel">${esc(opt.hotel || '')}</div><h1>${TYPE_ICON[m.type] || ''} ${esc(TYPES[m.type] || 'Gym')} membership</h1><div class="sub">${esc(((m.title ? m.title + '. ' : '') + (m.name || '')).trim())}</div></div>
    <div class="meta">Status: <b>${esc(STATUS[s])}</b><br>${esc(countdown(m, opt.today))}</div></div>
  <table>${row('Member', esc(KINDS[m.kind] || '—') + (m.kind === 'guest' && m.room ? ' · Room ' + esc(m.room) : ''))}
    ${row('Membership', esc(TYPES[m.type] || ''))}
    ${row('Period', `<b>${esc(fmtD(m.start))}</b> to <b>${esc(fmtD(m.end))}</b> (${esc(lenLabel(lenOf(c.start || m.start, c.end || m.end)))})`)}
    ${row('Payment', c.price ? `AED ${esc(money(c.price))} · ${c.paid === 'paid' ? 'paid' : 'to pay'}${c.method ? ' · ' + esc(c.method) : ''}${c.receipt ? ' · ' + esc(c.receipt) : ''}` : '—')}
    ${row(ID_TYPES[m.idType] || 'ID', `<span class="mono">${esc(id)}</span>`)}
    ${row('Nationality', esc(m.nat || '—'))}${row('Phone', esc(m.phone || '—'))}${row('Email', esc(m.email || '—'))}
    ${row('Waiver signed', m.waiver ? 'Yes' : 'No')}${m.notes ? row('Notes', esc(m.notes)) : ''}</table>
  ${hist.length > 1 ? `<h2>Periods</h2><table><thead><tr><th>Start</th><th>End</th><th>Length</th><th class="r">AED</th><th>Payment</th><th>By</th></tr></thead><tbody>${hist.map(h => `<tr><td class="nw">${esc(fmtD(h.start))}</td><td class="nw">${esc(fmtD(h.end))}</td><td>${esc(lenLabel(h.len || lenOf(h.start, h.end)))}</td><td class="r">${h.price ? esc(money(h.price)) : ''}</td><td>${h.paid === 'paid' ? 'Paid' : (+h.price ? 'To pay' : '')}</td><td>${esc(h.by || '')}</td></tr>`).join('')}</tbody></table>` : ''}
  <div class="note">I confirm the details above are correct. I use the ${esc((TYPES[m.type] || 'gym').toLowerCase())} facilities at my own risk, follow the hotel's rules and the opening hours, and I will show my key card or this membership when asked.</div>`;
}
/** the report as a print page body (pure; the page is month-end.js mePrintPage, colours kept with print-color-adjust) */
const RPT_CSS = `<style>
  .gr-band{background:linear-gradient(120deg,#1e293b,#334155);color:#fff;border-radius:12px;padding:16px 20px;display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;border-bottom:4px solid #c9a227}
  .gr-band .gr-h{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#f5d97a;font-weight:700}
  .gr-band h1{margin:3px 0 0;font-size:22px;color:#fff} .gr-band .gr-s{color:#cbd5e1;font-size:12px;margin-top:2px} .gr-band .gr-m{text-align:right;color:#e2e8f0;font-size:11.5px}
  .gr-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:14px 0 6px}
  .gr-kpi{border-radius:10px;padding:10px 12px;border:1px solid transparent} .gr-kpi small{display:block;font-size:9.5px;letter-spacing:.07em;text-transform:uppercase;font-weight:700;opacity:.85} .gr-kpi b{display:block;font-size:22px;margin-top:2px;font-variant-numeric:tabular-nums}
  .gr-ok{background:#dcfce7;color:#166534;border-color:#bbf7d0} .gr-warn{background:#fef3c7;color:#92400e;border-color:#fde68a} .gr-bad{background:#fee2e2;color:#991b1b;border-color:#fecaca} .gr-ink{background:#dbeafe;color:#1e40af;border-color:#bfdbfe}
  .gr h2{border-bottom:2px solid #c9a227}
  .gr table{border-collapse:separate;border-spacing:0;border:1px solid #cbd5e1;border-radius:10px;overflow:hidden}
  .gr th{background:#1e293b;color:#fff;border:0;border-right:1px solid #334155;font-size:10px;padding:7px} .gr td{border:0;border-bottom:1px solid #e2e8f0;border-right:1px solid #eef2f7;padding:6px 7px}
  .gr tbody tr:nth-child(even) td{background:#f8fafc}
  .gr .pill{display:inline-block;padding:1px 9px;border-radius:999px;font-weight:700;font-size:10.5px;white-space:nowrap}
  .gr .p-Active{background:#dcfce7;color:#166534} .gr .p-Ending{background:#fef3c7;color:#92400e} .gr .p-Expired{background:#fee2e2;color:#991b1b} .gr .p-Not{background:#dbeafe;color:#1e40af}
  .gr .dl-g{color:#166534;font-weight:700} .gr .dl-a{color:#b45309;font-weight:700} .gr .dl-r{color:#b91c1c;font-weight:700}
  .gr tr.tot td{background:#fef9e7!important;border-top:2px solid #1e293b;font-weight:800}
  @media (max-width:600px){.gr-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style>`;
const dlClass = v => (v === '' || v == null ? '' : v <= 3 ? 'dl-r' : v <= 7 ? 'dl-a' : 'dl-g');
function reportHtml(M) {
  const table = (rows, total) => `<div class="tw"><table><thead><tr>${M.head.map((h, i) => `<th${i === 5 || i === 7 ? ' class="r"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>
    ${rows.map(r => `<tr><td><b>${esc(r[0])}</b></td><td class="nw">${esc(r[1])}</td><td class="nw">${esc(dDot(r[2]))}</td><td class="nw">${esc(dDot(r[3]))}</td><td class="nw">${esc(r[4])}</td><td class="r">${r[5] ? esc(money(r[5])) : ''}</td><td><span class="pill p-${esc(String(r[6]).split(' ')[0])}">${esc(r[6])}</span></td><td class="r ${dlClass(r[7])}">${esc(r[7])}</td><td>${esc(r[8])}</td><td>${esc(r[9])}</td><td>${esc(r[10])}</td></tr>`).join('') || `<tr><td colspan="${M.head.length}" class="muted">No members.</td></tr>`}
    ${total ? `<tr class="tot"><td colspan="5">${esc(total[0])}</td><td class="r">AED ${esc(money(total[5]))}</td><td colspan="5"></td></tr>` : ''}</tbody></table></div>`;
  return `${RPT_CSS}<div class="gr"><div class="gr-band"><div><div class="gr-h">${esc(M.hotel || 'HotelOps')}</div><h1>${esc(M.title)}</h1><div class="gr-s">${esc(fmtD(M.date))} · ${esc(M.scope)}</div></div><div class="gr-m">${M.by ? 'Prepared by<br><b>' + esc(M.by) + '</b>' : ''}</div></div>
  <div class="gr-kpis">${M.kpis.map(k => `<div class="gr-kpi gr-${k[2]}"><small>${esc(k[0])}</small><b>${esc(k[1])}</b></div>`).join('')}</div>
  <h2>Members · ${M.rows.length}</h2>${table(M.rows, M.total)}
  ${M.attention.length ? `<h2>Ending soon & expired · ${M.attention.length}</h2>${table(M.attention, null)}` : ''}</div>`;
}

// ── Import the team's Excel / CSV sheet (Guest Name | Mobile number | Start Date | End Date | Car Plate Number | Amount Paid) ──
const IMPORT_COLS = {
  name: ['guestname', 'name', 'membername', 'guest', 'fullname', 'customername', 'clientname'],
  phone: ['mobilenumber', 'mobile', 'mobileno', 'phone', 'phonenumber', 'phoneno', 'contact', 'contactnumber', 'contactno', 'tel', 'telephone', 'whatsapp'],
  start: ['startdate', 'start', 'from', 'datefrom', 'fromdate', 'membershipstart'],
  end: ['enddate', 'end', 'to', 'dateto', 'todate', 'expiry', 'expirydate', 'until', 'membershipend', 'expires'],
  plate: ['carplatenumber', 'carplate', 'plate', 'platenumber', 'plateno', 'carno', 'carnumber', 'car', 'vehicle', 'vehicleno'],
  price: ['amountpaid', 'amount', 'amountaed', 'paid', 'price', 'fee', 'aed', 'total'],
  room: ['room', 'roomno', 'roomnumber'],
  type: ['type', 'membership', 'membershiptype'],
  email: ['email', 'emailaddress', 'mail'],
  nat: ['nationality', 'country'],
};
const hKey = h => String(h == null ? '' : h).toLowerCase().replace(/[^a-z]/g, '');
/** a header row → { name: col, phone: col, … } */
function mapHeader(row) {
  const out = {};
  (row || []).forEach((h, i) => { const k = hKey(h); if (!k) return; Object.keys(IMPORT_COLS).forEach(f => { if (out[f] == null && IMPORT_COLS[f].includes(k)) out[f] = i; }); });
  return out;
}
/** a date cell: Excel serial (46308), Date, "13.10.2026", "13/10/2026", "2026-10-13", "13 Oct 2026" → "YYYY-MM-DD" ('' if none) */
function cellDate(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number') { if (v < 20000 || v > 80000) return ''; const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5); return isoOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
  if (v instanceof Date && !isNaN(v)) return isoOf(v.getFullYear(), v.getMonth() + 1, v.getDate());
  const s = String(v).trim().replace(/\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?$/i, '');
  if (/^\d{5}(?:\.\d+)?$/.test(s)) return cellDate(+s);
  return parseDate(s);
}
/** "AED 1,499.00" / 299 → 1499 / 299 (0 when none) */
const cellMoney = v => { const n = typeof v === 'number' ? v : +String(v == null ? '' : v).replace(/[^\d.]/g, ''); return n > 0 ? Math.round(n * 100) / 100 : 0; };
/** "No car", "no", "-", "N/A" → "No car"; a plate → upper case without extra spaces */
function cellPlate(v) {
  const s = String(v == null ? '' : v).trim(); if (!s) return '';
  if (/^(?:no(?:\s*car)?|none|nil|n\/?a|-+|–|x)$/i.test(s)) return 'No car';
  return s.toUpperCase().replace(/\s+/g, '').slice(0, 20);
}
const cellPhone = v => String(v == null ? '' : v).trim().replace(/\.0+$/, '').slice(0, 24);
/** a tiny CSV reader (quotes, commas or semicolons) → rows of cells */
function parseCsv(text) {
  const t = String(text || '').replace(/^﻿/, ''), first = t.split(/\r?\n/)[0] || '';
  const sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : first.includes('\t') && !first.includes(',') ? '\t' : ',';
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; continue; }
    if (ch === '"') q = true; else if (ch === sep) { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}
/** rows of a sheet (array of arrays) → { rows: [{ line, name, phone, start, end, len, plate, price, room, type, email, nat }], skipped: [{ line, why }], header } */
function importRows(aoa, today) {
  const out = { rows: [], skipped: [], header: -1 };
  const A = (aoa || []).map(r => (Array.isArray(r) ? r : []));
  for (let i = 0; i < Math.min(A.length, 15); i++) { const h = mapHeader(A[i]); if (h.name != null && (h.start != null || h.end != null)) { out.header = i; out.map = h; break; } }
  if (out.header < 0) return out;
  const h = out.map, g = (r, f) => (h[f] == null ? '' : r[h[f]]);
  for (let i = out.header + 1; i < A.length; i++) {
    const r = A[i], name = String(g(r, 'name') == null ? '' : g(r, 'name')).replace(/\s+/g, ' ').trim();
    if (!name && r.every(c => String(c == null ? '' : c).trim() === '')) continue;
    if (!name || /^(?:total|totals|grand total|sum)$/i.test(name)) { if (name) continue; out.skipped.push({ line: i + 1, why: 'no name' }); continue; }
    let start = cellDate(g(r, 'start')), end = cellDate(g(r, 'end'));
    if (!start && !end) { out.skipped.push({ line: i + 1, name, why: 'no dates' }); continue; }
    if (start && !end) end = endFor(start, '1m');
    if (!start && end) start = end;
    if (end < start) { out.skipped.push({ line: i + 1, name, why: 'the end is before the start' }); continue; }
    const tRaw = String(g(r, 'type') || '').toLowerCase(), gym = /gym|fitness/.test(tRaw), pool = /pool|swim/.test(tRaw);
    out.rows.push({ line: i + 1, name, phone: cellPhone(g(r, 'phone')), start, end, len: lenOf(start, end), plate: cellPlate(g(r, 'plate')), price: cellMoney(g(r, 'price')),
      room: String(g(r, 'room') || '').replace(/\D/g, '').slice(0, 5), type: gym && pool ? 'gympool' : pool ? 'pool' : 'gym', email: String(g(r, 'email') || '').trim(), nat: String(g(r, 'nat') || '').trim() });
  }
  return out;
}
const phoneKey = p => String(p || '').replace(/\D/g, '').slice(-9);
/** is an imported row the same person as a member? the same name, and the same mobile when both have one */
function samePerson(m, r) {
  if (!m || !r || nameToks(m.name).join(' ') !== nameToks(r.name).join(' ')) return false;
  const a = phoneKey(m.phone), b = phoneKey(r.phone);
  return !a || !b || a === b;
}
/** what an import would do: [{ act: 'new'|'update'|'same', row, id?, changes: [field…] }] (rows for the same person in the file: the latest end wins) */
function mergePlan(members, rows) {
  const best = new Map();
  (rows || []).forEach(r => { const k = nameToks(r.name).join(' ') + '|' + phoneKey(r.phone); const o = best.get(k); if (!o || r.end > o.end) best.set(k, r); });
  return [...best.values()].sort((a, b) => a.line - b.line).map(r => {
    const m = (members || []).find(x => x && !x.del && samePerson(x, r));
    if (!m) return { act: 'new', row: r, changes: [] };
    const c = curOf(m), ch = [];
    if (r.phone && phoneKey(r.phone) !== phoneKey(m.phone)) ch.push('mobile');
    if (r.plate && r.plate !== (m.plate || '')) ch.push('car plate');
    if (r.start !== m.start || r.end !== m.end) ch.push(r.start > m.end ? 'new period' : 'dates');
    if (r.price && r.price !== (+c.price || 0) && !ch.includes('new period')) ch.push('amount');
    return { act: ch.length ? 'update' : 'same', row: r, id: m.id, changes: ch };
  });
}
/** default prices per length (page settings can change them; 0 = none) */
const DEFAULT_PRICES = { '1m': 299, '6m': 1499 };
function pricePreset(cfg, len) { const p = cfg && cfg.prices && typeof cfg.prices === 'object' && cfg.prices[len] != null ? +cfg.prices[len] : DEFAULT_PRICES[len]; return p > 0 ? p : ''; }

W.hoGymPure = { TYPES, KINDS, LENGTHS, STATUS, isIso, addDays, diffDays, fmtD, lenParts, lenLabel, endFor, lenOf, statusOf, countdown, progress, extendPlan, applyExtend, idClean, fmtEid, maskId,
  parseDate, parseEmail, findMember, summary, dueSoon, filterMembers, sortMembers, histOf, curOf, chunk, unchunk, b64Len, b64Bytes, scaleTo, docCheck, guessLabel, CHUNK, PDF_MAX, IMG_MAX,
  REPORT_HEAD, SCOPES, xlSerial, scopeFilter, reportRow, reportModel, reportHtml, fileName, dDot, cardHtml,
  mapHeader, cellDate, cellMoney, cellPlate, parseCsv, importRows, samePerson, mergePlan, DEFAULT_PRICES, pricePreset };
if (!doc) return;

// ═════════════════════════ In the app ═════════════════════════
const PANEL = 'gym';
const ROOT = 'gym';
const DOCS = 'gymDocs';
const safe = (f, d) => { try { return f(); } catch (e) { try { console.warn('[gym]', e); } catch (_) {} return d; } };
const LS = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} } };
const today = () => (typeof hoLocalISO === 'function' ? hoLocalISO() : new Date().toISOString().slice(0, 10));
const me = () => (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || 'Front Desk';
const toast = (m, k) => safe(() => { if (typeof showToast === 'function') showToast(m, k || 'ok'); });
const act = (a, d) => safe(() => { if (typeof logActivity === 'function') logActivity(a, d); });
const can = cap => safe(() => (W.hoRoleRules && typeof W.hoRoleRules.can === 'function' ? W.hoRoleRules.can(cap) : true), true);
const deny = what => toast(what + ' is not available for your role', 'err');
const hotel = () => safe(() => { const el = doc.getElementById('hotelName'); const t = el && el.textContent.trim(); if (t) return t; const s = JSON.parse(localStorage.getItem('ibis_settings') || '{}'); return (s && s.hotelName) || ''; }, '') || '';
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const dbRef = () => (typeof _ref !== 'undefined' && _ref) ? _ref : null;   // db.js
const fullName = m => ((m.title ? m.title + '. ' : '') + (m.name || '')).trim();
const initials = n => String(n || '?').replace(/\b(?:Mr|Mrs|Ms|Miss|Dr)\b\.?/g, '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

const G = { members: {}, cfg: {}, q: '', st: 'all', type: '', kind: '', by: 'end', loaded: false, cache: {}, reveal: {}, viewed: {} };
safe(() => { const v = LS.get('gym_view_v1', {}); ['st', 'type', 'kind', 'by'].forEach(k => { if (typeof v[k] === 'string') G[k] = v[k]; }); });
const saveView = () => LS.set('gym_view_v1', { st: G.st, type: G.type, kind: G.kind, by: G.by });
const SOON = () => { const n = +((G.cfg || {}).soon); return n >= 0 && n <= 30 ? n : 3; };
const list = () => Object.keys(G.members).map(k => Object.assign({}, G.members[k], { id: k })).filter(m => m && m.name);

// ── saving (one member at a time, field by field) ──
function applyLocal(id, p) {
  const cur = G.members[id] || {};
  G.members[id] = typeof fbApplyPatch === 'function' ? fbApplyPatch(cur, p) : Object.assign({}, cur, p);
}
function patch(id, p) {
  applyLocal(id, p);
  if (typeof fbUpdate === 'function') safe(() => Promise.resolve(fbUpdate(ROOT + '/members/' + id, p)).catch(() => toast('Could not save – check the connection', 'err')));
  soon();
}
function putMember(id, v) {
  if (v == null) delete G.members[id]; else G.members[id] = JSON.parse(JSON.stringify(v));
  if (typeof fbSet === 'function') safe(() => Promise.resolve(fbSet(ROOT + '/members/' + id, v == null ? null : v)).catch(() => toast('Could not save – check the connection', 'err')));
  soon();
}

// ── files: straight to the database, in pieces, never into localStorage ──
async function docWrite(mid, did, b64) {
  const r = dbRef(); if (!r) throw new Error('Files need the connection to the team database.');
  const parts = chunk(b64);
  for (let i = 0; i < parts.length; i++) await r.child(`${DOCS}/${mid}/${did}/c/${i}`).set(parts[i]);
  return parts.length;
}
async function docRead(mid, did) {
  const k = mid + '/' + did; if (G.cache[k]) return G.cache[k];
  const r = dbRef(); if (!r) throw new Error('Files need the connection to the team database.');
  const snap = await Promise.race([r.child(`${DOCS}/${mid}/${did}`).once('value'), new Promise((_, no) => setTimeout(() => no(new Error('No answer from the database (offline?)')), 20000))]);
  const v = snap && snap.val ? snap.val() : null, s = unchunk(v && v.c);
  if (!s) throw new Error('This file is not in the database any more.');
  G.cache[k] = s; return s;
}
function docRemove(mid, did) { const r = dbRef(); if (r) safe(() => Promise.resolve(r.child(`${DOCS}/${mid}${did ? '/' + did : ''}`).set(null)).catch(() => {})); }

/** a picked picture → a smaller JPEG (max 1600 px, 0.8; smaller again when still big) as base64 */
function shrinkImage(file) {
  return new Promise((ok, no) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const draw = (max, q) => {
        const s = scaleTo(img.naturalWidth, img.naturalHeight, max), c = doc.createElement('canvas'); c.width = s.w; c.height = s.h;
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, s.w, s.h); g.drawImage(img, 0, 0, s.w, s.h);
        return c.toDataURL('image/jpeg', q).split(',')[1] || '';
      };
      let b = draw(1600, 0.8);
      if (b64Bytes(b) > 900 * 1024) b = draw(1400, 0.72);
      if (b64Bytes(b) > IMG_MAX) b = draw(1100, 0.65);
      URL.revokeObjectURL(url); ok(b);
    };
    img.onerror = () => { URL.revokeObjectURL(url); no(new Error('This picture could not be read (HEIC? Take it with the camera button instead).')); };
    img.src = url;
  });
}
function fileB64(file) {
  return new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => no(new Error('The file could not be read.')); r.readAsDataURL(file); });
}
/** a picked file → { name, mime, b64, size } ready to save, or throws why not */
async function prepFile(file) {
  if (!file) throw new Error('No file');
  const isPdf = /pdf$/i.test(file.type) || /\.pdf$/i.test(file.name || '');
  if (isPdf) { const why = docCheck('application/pdf', file.size); if (why) throw new Error(why); return { name: file.name || 'document.pdf', mime: 'application/pdf', b64: await fileB64(file), size: file.size }; }
  if (!/^image\//i.test(file.type || '') && !/\.(jpe?g|png|webp|gif|bmp|heic)$/i.test(file.name || '')) throw new Error(docCheck(file.type, file.size));
  const b64 = await shrinkImage(file), size = b64Bytes(b64), why = docCheck('image/jpeg', size); if (why) throw new Error(why);
  return { name: (file.name || 'photo').replace(/\.[a-z0-9]+$/i, '') + '.jpg', mime: 'image/jpeg', b64, size };
}
async function addDoc(mid, f, label) {
  const m = G.members[mid]; if (!m) return false;
  if (Object.keys(m.docs || {}).length >= MAX_DOCS) { toast(`A member can have up to ${MAX_DOCS} files. Delete an old one first.`, 'warn'); return false; }
  const did = newId();
  const n = await docWrite(mid, did, f.b64);
  G.cache[mid + '/' + did] = f.b64;
  patch(mid, { ['docs/' + did]: { name: String(f.name).slice(0, 120), mime: f.mime, size: f.size, label: label || guessLabel(f.name), parts: n, by: me(), at: Date.now() } });
  act('gym_doc_added', `${m.name}: ${label || guessLabel(f.name)}`);
  return true;
}

// ═════════════════ The page ═════════════════
const CSS = `
#gymRoot,.gy-modal,.gy-view{--gy-acc:var(--gold,var(--accent,#0a84ff));--gy-ok:var(--green,#16a34a);--gy-warn:var(--amber,#d97706);--gy-bad:var(--red,#dc2626);--gy-blue:var(--blue,#2563eb);
  --gy-r:16px;--gy-hair:color-mix(in srgb,var(--text) 10%,transparent);--gy-soft:color-mix(in srgb,var(--text) 4.5%,var(--card));--gy-fill:color-mix(in srgb,var(--text) 6%,transparent);
}
#gymRoot{display:grid;gap:14px;min-width:0;max-width:1020px;margin:0 auto;color:var(--text)}
#gymRoot *,.gy-modal *{box-sizing:border-box}
#gymRoot button,.gy-modal button{font-family:inherit}
#gymRoot .page-hd{display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between;margin-bottom:0!important}
#gymRoot .page-hd-left{min-width:0;flex:1 1 280px}
.gy-acts-top{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.gy-btn{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:8px 14px;border-radius:999px;font:600 13.5px/1.2 var(--font,inherit);color:var(--text);background:var(--gy-fill);border:1px solid var(--gy-hair);white-space:nowrap;transition:transform .15s,filter .15s}
.gy-btn:hover{filter:brightness(1.05)}.gy-btn:active{transform:scale(.97)}
.gy-btn.pri{background:var(--gy-acc);color:var(--bg,#fff);border-color:transparent;box-shadow:0 4px 14px -6px color-mix(in srgb,var(--gy-acc) 70%,transparent)}
.gy-btn.sm{padding:6px 11px;font-size:12.5px}
.gy-btn.bad{color:var(--gy-bad)}
.gy-btn[disabled]{opacity:.45;cursor:default}
.gy-btn:focus-visible,.gy-chipbtn:focus-visible{outline:2px solid var(--gy-acc);outline-offset:2px}
.gy-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.gy-kpi{background:var(--card);border:1px solid var(--gy-hair);border-radius:var(--gy-r);padding:12px 14px;min-width:0;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.gy-kpi small{display:block;font:600 11px/1.3 var(--font,inherit);letter-spacing:.05em;text-transform:uppercase;color:var(--text3)}
.gy-kpi b{display:block;font:700 24px/1.15 var(--font,inherit);margin-top:3px;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gy-kpi i{display:block;font-style:normal;font-size:12px;color:var(--text2);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gy-kpi.ok b{color:var(--gy-ok)}.gy-kpi.warn b{color:var(--gy-warn)}.gy-kpi.bad b{color:var(--gy-bad)}
.gy-due{display:flex;gap:10px;align-items:flex-start;background:color-mix(in srgb,var(--gy-warn) 10%,var(--card));border:1px solid color-mix(in srgb,var(--gy-warn) 35%,transparent);border-radius:var(--gy-r);padding:11px 14px;font-size:13.5px;line-height:1.45}
.gy-due b{font-weight:650}.gy-due .gy-lnk{all:unset;cursor:pointer;color:var(--gy-acc);font-weight:600;text-decoration:underline;text-underline-offset:2px}
.gy-tb{display:flex;flex-wrap:wrap;gap:8px;align-items:center;min-width:0}
.gy-search{flex:1 1 220px;min-width:0;position:relative}
.gy-in,.gy-sel{width:100%;background:var(--gy-soft);color:var(--text);border:1px solid var(--gy-hair);border-radius:11px;padding:9px 12px;font:14px var(--font,inherit);margin:0;min-width:0;color-scheme:light dark}
.gy-in:focus,.gy-sel:focus{outline:none;border-color:var(--gy-acc);box-shadow:0 0 0 3px color-mix(in srgb,var(--gy-acc) 22%,transparent)}
.gy-tb .gy-sel{width:auto;flex:0 1 auto;padding:8px 10px;font-size:13px}
.gy-seg{display:flex;gap:4px;padding:3px;background:var(--gy-fill);border-radius:12px;overflow-x:auto;scrollbar-width:none;max-width:100%}
.gy-seg::-webkit-scrollbar{display:none}
.gy-chipbtn{all:unset;cursor:pointer;padding:6px 11px;border-radius:9px;font:600 12.5px var(--font,inherit);color:var(--text2);white-space:nowrap}
.gy-chipbtn.on{background:var(--card);color:var(--text);box-shadow:0 1px 3px rgba(0,0,0,.12)}
.gy-chipbtn i{font-style:normal;opacity:.6;margin-left:4px;font-variant-numeric:tabular-nums}
.gy-list{display:grid;gap:8px}
.gy-card{position:relative;display:flex;gap:12px;align-items:center;background:var(--card);border:1px solid var(--gy-hair);border-radius:var(--gy-r);padding:12px 14px 14px;cursor:pointer;min-width:0;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.04);transition:border-color .15s,transform .15s}
.gy-card:hover{border-color:color-mix(in srgb,var(--gy-acc) 45%,transparent)}
.gy-av{flex:0 0 42px;width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;font:700 14px var(--font,inherit);color:#fff;background:linear-gradient(135deg,color-mix(in srgb,var(--gy-acc) 85%,#fff),var(--gy-acc))}
.gy-card.st-expired .gy-av{background:linear-gradient(135deg,#9ca3af,#6b7280)}
.gy-card.st-ending .gy-av{background:linear-gradient(135deg,#fbbf24,#d97706)}
.gy-card.st-notstarted .gy-av{background:linear-gradient(135deg,#60a5fa,#2563eb)}
.gy-main{flex:1 1 auto;min-width:0;display:grid;gap:3px}
.gy-l1{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}
.gy-nm{font:650 15px/1.3 var(--font,inherit);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.gy-l2,.gy-l3{font-size:12.5px;color:var(--text2);line-height:1.4;min-width:0;overflow-wrap:anywhere}
.gy-l3{color:var(--text3)}
.gy-l3 .mono,.gy-mono{font-family:var(--mono,ui-monospace,monospace);font-size:12px}
.gy-st{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:999px;font:700 11px/1.6 var(--font,inherit);white-space:nowrap}
.gy-st::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.gy-st.active{color:var(--gy-ok);background:color-mix(in srgb,var(--gy-ok) 13%,transparent)}
.gy-st.ending{color:var(--gy-warn);background:color-mix(in srgb,var(--gy-warn) 15%,transparent)}
.gy-st.expired{color:var(--text3);background:var(--gy-fill)}
.gy-st.notstarted{color:var(--gy-blue);background:color-mix(in srgb,var(--gy-blue) 13%,transparent)}
.gy-cd{font-weight:650;color:var(--text)}
.gy-card.st-ending .gy-cd{color:var(--gy-warn)}.gy-card.st-expired .gy-cd{color:var(--text3)}
.gy-pay{font-weight:600}.gy-pay.topay{color:var(--gy-bad)}
.gy-bar{position:absolute;left:0;right:0;bottom:0;height:3px;background:var(--gy-fill)}
.gy-bar i{display:block;height:100%;background:var(--gy-ok);border-radius:0 3px 3px 0}
.gy-card.st-ending .gy-bar i{background:var(--gy-warn)}.gy-card.st-expired .gy-bar i{background:var(--text3)}
.gy-cacts{display:flex;gap:6px;flex:0 0 auto}
.gy-empty{text-align:center;color:var(--text2);padding:34px 16px;background:var(--card);border:1px dashed var(--gy-hair);border-radius:var(--gy-r);line-height:1.6}
.gy-empty b{display:block;font-size:16px;color:var(--text);margin-bottom:4px}
.gy-modal{position:fixed;inset:0;z-index:10050;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:18px;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
.gy-sheet{background:var(--card,#fff);color:var(--text);border:1px solid var(--gy-hair,rgba(0,0,0,.1));border-radius:20px;width:100%;max-width:640px;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 30px 80px -20px rgba(0,0,0,.45);min-width:0}
.gy-sheet.wide{max-width:760px}
.gy-sh-hd{display:flex;align-items:center;gap:10px;padding:16px 18px 12px;border-bottom:1px solid var(--gy-hair,rgba(0,0,0,.08))}
.gy-sh-hd b{flex:1;font:700 17px var(--font,inherit);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gy-x{all:unset;cursor:pointer;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--gy-fill,rgba(0,0,0,.06));color:var(--text2)}
.gy-sh-bd{padding:14px 18px;overflow-y:auto;overflow-x:hidden;display:grid;gap:12px;min-width:0}
.gy-sh-ft{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;padding:12px 18px 16px;border-top:1px solid var(--gy-hair,rgba(0,0,0,.08))}
.gy-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 12px}
.gy-f{display:grid;gap:4px;min-width:0;font-size:12.5px;color:var(--text2);font-weight:600}
.gy-f.wide{grid-column:1/-1}
.gy-f textarea.gy-in{min-height:70px;resize:vertical}
.gy-f[hidden]{display:none}
.gy-check{display:flex;align-items:center;gap:8px;font-size:13.5px;color:var(--text);font-weight:500;cursor:pointer}
.gy-check input{width:18px;height:18px;accent-color:var(--gy-acc)}
.gy-radio{display:flex;flex-wrap:wrap;gap:6px}
.gy-radio label{cursor:pointer}
.gy-radio input{position:absolute;opacity:0;pointer-events:none}
.gy-radio span{display:inline-block;padding:7px 12px;border-radius:10px;border:1px solid var(--gy-hair);background:var(--gy-soft);font:600 13px var(--font,inherit);color:var(--text2)}
.gy-radio input:checked+span{border-color:var(--gy-acc);color:var(--text);background:color-mix(in srgb,var(--gy-acc) 14%,var(--card));box-shadow:0 0 0 1px var(--gy-acc) inset}
.gy-radio input:focus-visible+span{outline:2px solid var(--gy-acc);outline-offset:2px}
.gy-note{font-size:12.5px;color:var(--text3);line-height:1.5}
.gy-prev{background:var(--gy-soft);border:1px solid var(--gy-hair);border-radius:12px;padding:10px 12px;font-size:13.5px;line-height:1.5}
.gy-prev b{font-weight:650}
.gy-tags{display:flex;flex-wrap:wrap;gap:5px}
.gy-tag{padding:2px 8px;border-radius:999px;background:var(--gy-fill);font-size:12px;color:var(--text2)}
.gy-sec{display:grid;gap:8px}
.gy-sec h4{margin:0;font:700 12px var(--font,inherit);letter-spacing:.06em;text-transform:uppercase;color:var(--text3);display:flex;align-items:center;gap:8px;justify-content:space-between;flex-wrap:wrap}
.gy-facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 14px}
.gy-fact{min-width:0}.gy-fact small{display:block;font-size:11.5px;color:var(--text3)}.gy-fact div{font-size:14px;overflow-wrap:anywhere}
.gy-hero{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.gy-hero .gy-cd{font-size:15px}
.gy-docs,.gy-hist{display:grid;gap:6px}
.gy-doc{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--gy-hair);border-radius:12px;background:var(--gy-soft);min-width:0}
.gy-doc-ic{flex:0 0 34px;height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center;background:var(--gy-fill);font-size:17px}
.gy-doc-tx{flex:1;min-width:0;font-size:13px;line-height:1.35}
.gy-doc-tx b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gy-doc-tx small{color:var(--text3);display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gy-doc-acts{display:flex;gap:4px;flex:0 0 auto}
.gy-file{position:relative;overflow:hidden}
.gy-file input{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%}
.gy-hrow{display:flex;justify-content:space-between;gap:10px;font-size:13px;padding:7px 10px;border-radius:10px;background:var(--gy-soft);flex-wrap:wrap}
.gy-hrow small{color:var(--text3)}
.gy-view{position:fixed;inset:0;z-index:10060;background:rgba(0,0,0,.86);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px}
.gy-view img{max-width:100%;max-height:calc(100vh - 110px);border-radius:8px;object-fit:contain;background:#fff}
.gy-view .gy-vacts{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
.gy-view .gy-btn{background:rgba(255,255,255,.14);color:#fff;border-color:rgba(255,255,255,.2)}
.gy-pend{display:grid;gap:6px}
#gyDetail{display:grid;gap:14px;min-width:0}
@media (max-width:760px){
  .gy-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}
  .gy-card{flex-wrap:wrap;padding:12px 12px 14px}
  .gy-cacts{width:100%;padding-left:54px}
  .gy-cacts .gy-btn{flex:1}
  .gy-form,.gy-facts{grid-template-columns:minmax(0,1fr)}
  .gy-modal{align-items:flex-end;padding:0}
  .gy-sheet,.gy-sheet.wide{max-width:none;border-radius:18px 18px 0 0;max-height:94vh}
  .gy-kpi b{font-size:20px}
  .gy-tb .gy-sel{flex:1 1 40%}
  .gy-acts-top{width:100%}
  .gy-acts-top .gy-btn{flex:1 1 auto}
  .gy-doc{flex-wrap:wrap}
  .gy-doc-tx{flex:1 1 calc(100% - 46px)}
  .gy-doc select.gy-sel{flex:1 1 auto;width:auto}
}`;

const statusChip = s => `<span class="gy-st ${s}">${esc(STATUS[s])}</span>`;
function cardHtmlRow(m, t) {
  const s = statusOf(m, t, SOON()), c = curOf(m), nd = Object.keys(m.docs || {}).length, nv = Object.keys(m.visits || {}).length;
  const where = m.kind === 'guest' ? (m.room ? 'Room ' + esc(m.room) : 'Hotel guest') : esc(KINDS[m.kind] || '');
  const pay = +c.price ? `<span class="gy-pay${c.paid === 'paid' ? '' : ' topay'}">AED ${esc(money(c.price))} ${c.paid === 'paid' ? 'paid' : 'to pay'}</span>` : '';
  const bits = [m.plate && m.plate !== 'No car' ? `🚗 ${esc(m.plate)}` : '', m.idNo ? `<span class="mono">${esc(maskId(m.idNo, m.idType))}</span>` : '', pay, nd ? `📎 ${nd}` : '', nv ? `${nv} visit${nv === 1 ? '' : 's'}` : '', m.waiver ? '' : (m.kind === 'staff' ? '' : 'waiver not signed')].filter(Boolean);
  return `<article class="gy-card st-${s}" data-id="${esc(m.id)}" tabindex="0" aria-label="${esc(fullName(m))}">
    <div class="gy-av" aria-hidden="true">${esc(initials(m.name))}</div>
    <div class="gy-main">
      <div class="gy-l1"><span class="gy-nm">${esc(fullName(m))}</span>${statusChip(s)}</div>
      <div class="gy-l2">${TYPE_ICON[m.type] || ''} ${esc(TYPES[m.type] || '')} · ${where} · ${esc(fmtD(m.start, true))} → ${esc(fmtD(m.end))} · <span class="gy-cd">${esc(countdown(m, t))}</span></div>
      ${bits.length ? `<div class="gy-l3">${bits.join(' · ')}</div>` : ''}
    </div>
    <div class="gy-cacts">${s !== 'expired' && s !== 'notstarted' ? '<button type="button" class="gy-btn sm" data-g="checkin">Check in</button>' : ''}<button type="button" class="gy-btn sm${s === 'expired' || s === 'ending' ? ' pri' : ''}" data-g="extend">${s === 'expired' ? 'Renew' : 'Extend'}</button></div>
    <div class="gy-bar" aria-hidden="true"><i style="width:${Math.round(progress(m, t) * 100)}%"></i></div>
  </article>`;
}
function render() {
  const root = doc.getElementById('gymRoot'); if (!root) return;
  const t = today(), all = list(), S = summary(all, t, SOON()), due = dueSoon(all, t);
  const shown = sortMembers(filterMembers(all, { st: G.st, type: G.type, kind: G.kind, q: G.q }, t, SOON()), t, G.by);
  const cnt = st => filterMembers(all, { st, type: G.type, kind: G.kind }, t, SOON()).length;
  const focus = doc.activeElement && doc.activeElement.id === 'gyQ' ? [doc.activeElement.selectionStart, doc.activeElement.selectionEnd] : null;
  root.innerHTML = `
  <div class="page-hd"><div class="page-hd-left"><h1>🏋️ Gym & Pool</h1><p>Gym and pool memberships for guests, outside members and staff: dates, payment, ID and signed papers, with reminders before they end.</p></div>
    <div class="gy-acts-top"><button type="button" class="gy-btn pri" data-g="new">+ New member</button><button type="button" class="gy-btn" data-g="paste">✉️ Paste email</button>${can('canImport') ? '<button type="button" class="gy-btn" data-g="import">⬆ Import</button>' : ''}${can('canExport') ? '<button type="button" class="gy-btn" data-g="export" id="gyExport">⬇ Export</button>' : ''}<button type="button" class="gy-btn" data-g="cfg" title="Settings" aria-label="Settings">⚙︎</button></div></div>
  <div class="gy-kpis">
    <div class="gy-kpi ok"><small>Active</small><b>${S.active}</b><i>${S.notstarted ? S.notstarted + ' starting later' : 'members now'}</i></div>
    <div class="gy-kpi${S.week ? ' warn' : ''}"><small>Ending this week</small><b>${S.week}</b><i>${S.ending} in ≤ ${SOON()} day${SOON() === 1 ? '' : 's'}</i></div>
    <div class="gy-kpi"><small>Expired this month</small><b>${S.expiredMonth}</b><i>${esc(MON[+t.slice(5, 7) - 1])} ${t.slice(0, 4)}</i></div>
    <div class="gy-kpi"><small>Revenue this month</small><b>AED ${esc(money(S.revenue))}</b><i>${S.toCollectN ? `AED ${esc(money(S.toCollect))} to collect` : 'paid periods'}</i></div>
  </div>
  ${due.length ? `<div class="gy-due" role="status"><span aria-hidden="true">⏰</span><div>${due.map(d => `<b>${esc(fullName(d.m))}</b> ends <b>${d.when}</b> (<button type="button" class="gy-lnk" data-g="open" data-id="${esc(d.m.id)}">open</button>)`).join(' · ')}. Remind them, or extend in one tap.</div></div>` : ''}
  <div class="gy-tb">
    <div class="gy-search"><input id="gyQ" class="gy-in" type="search" placeholder="Search name, room, ID last digits, phone…" value="${esc(G.q)}" autocomplete="off" aria-label="Search members"></div>
    <select id="gyType" class="gy-sel" aria-label="Membership type"><option value="">All types</option>${Object.keys(TYPES).map(k => `<option value="${k}"${G.type === k ? ' selected' : ''}>${TYPES[k]}</option>`).join('')}</select>
    <select id="gyKind" class="gy-sel" aria-label="Member kind"><option value="">Guests, outside & staff</option>${Object.keys(KINDS).map(k => `<option value="${k}"${G.kind === k ? ' selected' : ''}>${KINDS[k]}</option>`).join('')}</select>
    <select id="gyBy" class="gy-sel" aria-label="Sort"><option value="end"${G.by === 'end' ? ' selected' : ''}>Sort: end date</option><option value="name"${G.by === 'name' ? ' selected' : ''}>Sort: name</option><option value="added"${G.by === 'added' ? ' selected' : ''}>Sort: newest</option></select>
  </div>
  <div class="gy-seg" role="tablist" aria-label="Status">${[['all', 'All'], ['active', 'Active'], ['ending', 'Ending soon'], ['expired', 'Expired'], ['notstarted', 'Not started']].map(([k, l]) => `<button type="button" role="tab" class="gy-chipbtn${G.st === k ? ' on' : ''}" aria-selected="${G.st === k}" data-g="st" data-st="${k}">${l}<i>${cnt(k)}</i></button>`).join('')}</div>
  <div class="gy-list" id="gyList">${shown.length ? shown.map(m => cardHtmlRow(m, t)).join('') : (all.length
    ? `<div class="gy-empty"><b>No member matches</b>Change the search or the filters.</div>`
    : `<div class="gy-empty"><b>No memberships yet</b>Add the first member, or paste the email the team sends (“Mr. A has a new gym membership for one month, starting today…”).<div style="margin-top:12px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap"><button type="button" class="gy-btn pri" data-g="new">+ New member</button><button type="button" class="gy-btn" data-g="paste">✉️ Paste email</button></div></div>`)}</div>`;
  if (focus) { const q = doc.getElementById('gyQ'); if (q) { q.focus(); try { q.setSelectionRange(focus[0], focus[1]); } catch (_) {} } }
  badge();
}
let softT = 0;
function soon() {
  clearTimeout(softT);
  softT = setTimeout(() => safe(() => {
    badge(); refreshModal();
    const p = doc.getElementById('panel-' + PANEL); if (!p || !p.classList.contains('active')) return;
    const a = doc.activeElement; if (a && a.id !== 'gyQ' && p.contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) { softT = setTimeout(soon, 1500); return; }
    render();
  }), 120);
}
function badge() {
  const t = today(), n = list().filter(m => { const s = statusOf(m, t, SOON()); return s === 'ending'; }).length;
  const b = doc.getElementById('badge-' + PANEL); if (b) { b.textContent = n ? String(n) : ''; b.style.display = n ? '' : 'none'; }
  const mb = doc.getElementById('mob-badge-' + PANEL); if (mb) mb.textContent = n ? String(n) : '';
}

// ── modal ──
let MODAL = null;   // { el, kind, id, refresh }
function openModal(title, body, opt) {
  closeModal();
  opt = opt || {};
  const m = doc.createElement('div'); m.className = 'gy-modal'; m.id = 'gy-modal';
  m.innerHTML = `<div class="gy-sheet${opt.wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="gy-sh-hd"><b>${esc(title)}</b><button type="button" class="gy-x" data-m="close" aria-label="Close">✕</button></div>
    <div class="gy-sh-bd">${body}</div>
    ${opt.foot !== false ? `<div class="gy-sh-ft">${opt.foot || `<button type="button" class="gy-btn" data-m="close">Cancel</button><button type="button" class="gy-btn pri" data-m="save">${esc(opt.save || 'Save')}</button>`}</div>` : ''}</div>`;
  m.addEventListener('click', e => safe(() => {
    if (e.target === m || e.target.closest('[data-m="close"]')) return closeModal();
    const s = e.target.closest('[data-m="save"]'); if (s && opt.onSave) { Promise.resolve(opt.onSave(m)).then(r => { if (r !== false) closeModal(); }); return; }
    if (opt.onClick) opt.onClick(e, m);
  }));
  if (opt.onInput) { m.addEventListener('input', e => safe(() => opt.onInput(e, m))); m.addEventListener('change', e => safe(() => opt.onInput(e, m))); }
  m.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); closeModal(); } });
  doc.body.appendChild(m);
  MODAL = { el: m, kind: opt.kind || '', id: opt.id || '', refresh: opt.refresh || null };
  if (opt.focus !== false) { const first = m.querySelector(opt.focus || 'input:not([type=file]):not([type=checkbox]):not([type=radio]),textarea'); if (first) setTimeout(() => { try { first.focus(); } catch (_) {} }, 60); }
  return m;
}
function closeModal() { const m = doc.getElementById('gy-modal'); if (m) m.remove(); MODAL = null; }
function refreshModal() { if (MODAL && MODAL.refresh && doc.getElementById('gy-modal')) safe(MODAL.refresh); }
const fv = (m, n) => { const el = m.querySelector(`[name="${n}"]`); if (!el) return ''; if (el.type === 'checkbox') return el.checked; if (el.type === 'radio') { const c = m.querySelector(`[name="${n}"]:checked`); return c ? c.value : ''; } return String(el.value || '').trim(); };
const field = (label, inner, wide, attrs) => `<label class="gy-f${wide ? ' wide' : ''}"${attrs || ''}><span>${label}</span>${inner}</label>`;
const opts = (o, sel) => Object.keys(o).map(k => `<option value="${k}"${sel === k ? ' selected' : ''}>${esc(o[k])}</option>`).join('');
const radios = (name, o, sel) => `<div class="gy-radio" role="radiogroup">${Object.keys(o).map(k => `<label><input type="radio" name="${name}" value="${k}"${sel === k ? ' checked' : ''}><span>${esc(o[k])}</span></label>`).join('')}</div>`;

// ── new / edit member ──
let PENDING = [];   // files picked in the form before the member exists
function memberForm(id, pre) {
  const m = id ? Object.assign({}, G.members[id], { id }) : null, c = m ? curOf(m) : {};
  const v = Object.assign({ title: '', name: '', kind: 'guest', room: '', type: 'gym', start: today(), len: '1m', end: '', price: '', paid: 'paid', method: '', receipt: '', idType: '', idNo: '', nat: '', phone: '', email: '', notes: '', waiver: false, plate: '' },
    m ? { title: m.title, name: m.name, kind: m.kind, room: m.room, type: m.type, start: m.start, end: m.end, len: lenOf(c.start || m.start, c.end || m.end) === 'custom' ? 'custom' : (c.len || lenOf(m.start, m.end)), price: c.price, paid: c.paid, method: c.method, receipt: c.receipt, idType: m.idType, idNo: m.idType === 'eid' ? fmtEid(m.idNo) : m.idNo, nat: m.nat, phone: m.phone, email: m.email, notes: m.notes, waiver: !!m.waiver, plate: m.plate || '' } : {}, pre || {});
  if (!v.end) v.end = endFor(v.start, v.len) || v.start;
  if (!m && (v.price === '' || v.price == null)) v.price = pricePreset(G.cfg, v.len);
  if (!LENGTHS.some(l => l[0] === v.len)) v.len = 'custom';
  PENDING = (pre && pre.files) || [];
  const body = `<div class="gy-form">
    ${field('Title', `<select name="title" class="gy-sel"><option value="">—</option>${['Mr', 'Ms', 'Mrs', 'Miss', 'Dr'].map(x => `<option${v.title === x ? ' selected' : ''}>${x}</option>`).join('')}</select>`)}
    ${field('Full name *', `<input name="name" class="gy-in" maxlength="80" value="${esc(v.name)}" placeholder="Full name as on the ID" autocomplete="off">`)}
    ${field('Member', radios('kind', KINDS, v.kind || 'guest'), true)}
    ${field('Room', `<input name="room" class="gy-in" maxlength="6" inputmode="numeric" value="${esc(v.room || '')}" placeholder="e.g. 512">`, false, ` data-show="guest"${v.kind === 'guest' ? '' : ' hidden'}`)}
    ${field('Membership', `<select name="type" class="gy-sel">${opts(TYPES, v.type)}</select>`)}
    ${field('Start', `<input name="start" type="date" class="gy-in" value="${esc(v.start)}">`)}
    ${field('Length', `<select name="len" class="gy-sel">${LENGTHS.map(([k, l]) => `<option value="${k}"${v.len === k ? ' selected' : ''}>${l}</option>`).join('')}</select>`)}
    ${field('End', `<input name="end" type="date" class="gy-in" value="${esc(v.end)}"${v.len === 'custom' ? '' : ' readonly'}>`)}
    <div class="gy-f"><span>&nbsp;</span><div class="gy-note" id="gyLenNote">${esc(lenLabel(v.len))}${v.len === 'custom' ? '' : ' · the end date follows the length'}</div></div>
    ${field('Amount paid (AED)', `<input name="price" type="number" min="0" step="1" inputmode="decimal" class="gy-in" value="${esc(v.price || '')}" placeholder="0">`)}
    ${field('Payment', `<select name="paid" class="gy-sel"><option value="paid"${v.paid === 'paid' ? ' selected' : ''}>Paid</option><option value="topay"${v.paid !== 'paid' ? ' selected' : ''}>To pay</option></select>`)}
    ${field('Method', `<select name="method" class="gy-sel"><option value="">—</option>${METHODS.map(x => `<option${v.method === x ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select>`)}
    ${field('Receipt / folio no.', `<input name="receipt" class="gy-in" maxlength="40" value="${esc(v.receipt || '')}">`)}
    ${field('ID type', `<select name="idType" class="gy-sel"><option value="">—</option>${opts(ID_TYPES, v.idType)}</select>`)}
    ${field('ID number', `<input name="idNo" class="gy-in gy-mono" maxlength="24" value="${esc(v.idNo || '')}" placeholder="784-XXXX-XXXXXXX-X" autocomplete="off">`)}
    ${field('Nationality', `<input name="nat" class="gy-in" maxlength="40" value="${esc(v.nat || '')}">`)}
    ${field('Mobile number', `<input name="phone" type="tel" class="gy-in" maxlength="24" value="${esc(v.phone || '')}">`)}
    ${field('Car plate number', `<input name="plate" class="gy-in" maxlength="20" value="${esc(v.plate === 'No car' ? '' : v.plate || '')}" placeholder="e.g. A12345"${v.plate === 'No car' ? ' disabled' : ''} autocomplete="off">`)}
    <label class="gy-check gy-f" style="align-self:end;padding-bottom:9px"><input type="checkbox" name="nocar"${v.plate === 'No car' ? ' checked' : ''}> No car</label>
    ${field('Email', `<input name="email" type="email" class="gy-in" maxlength="80" value="${esc(v.email || '')}">`, true)}
    ${field('Notes', `<textarea name="notes" class="gy-in" maxlength="500">${esc(v.notes || '')}</textarea>`, true)}
    <label class="gy-check gy-f wide"><input type="checkbox" name="waiver"${v.waiver ? ' checked' : ''}> The member signed the gym / pool waiver</label>
    ${id ? '' : `<div class="gy-f wide"><span>Documents (ID copy, signed form, receipt)</span><div class="gy-pend" id="gyPend"></div><div class="gy-radio">${fileBtns('pend')}</div><div class="gy-note">Pictures are made smaller before saving. PDFs up to 1.5 MB.</div></div>`}
  </div>`;
  const syncEnd = (m2, changed) => {
    const len = fv(m2, 'len'), st = fv(m2, 'start'), endEl = m2.querySelector('[name="end"]');
    if (len !== 'custom') { endEl.readOnly = true; const e = endFor(st, len); if (e) endEl.value = e; }
    else { endEl.readOnly = false; if (changed === 'len' && isIso(st) && (!isIso(endEl.value) || endEl.value < st)) endEl.value = st; }
    const n = m2.querySelector('#gyLenNote'); if (n) n.textContent = lenLabel(len) + (len === 'custom' ? (isIso(st) && isIso(endEl.value) ? ' · ' + (diffDays(st, endEl.value) + 1) + ' days' : '') : ' · the end date follows the length');
  };
  const el = openModal(id ? 'Edit member' : 'New member', body, { kind: 'form', save: id ? 'Save' : 'Add member', focus: '[name="name"]',
    onInput: (e, m2) => {
      const n = e.target.name;
      if (n === 'kind') { const r = m2.querySelector('[data-show="guest"]'); if (r) r.hidden = fv(m2, 'kind') !== 'guest'; }
      if (n === 'len' || n === 'start' || n === 'end') syncEnd(m2, n);
      if (n === 'len') { const pr = m2.querySelector('[name="price"]'), was = pr.dataset.preset != null ? pr.dataset.preset : String(pricePreset(G.cfg, v.len)); if (pr.value === '' || pr.value === was) { const np = String(pricePreset(G.cfg, fv(m2, 'len'))); pr.value = np; pr.dataset.preset = np; } }
      if (n === 'nocar') { const pl = m2.querySelector('[name="plate"]'); pl.disabled = !!e.target.checked; if (e.target.checked) pl.value = ''; }
      if (n === 'idNo' && e.type === 'change') { const d = idClean(e.target.value); if (/^784\d{12}$/.test(d)) { e.target.value = fmtEid(d); const t = m2.querySelector('[name="idType"]'); if (t && !t.value) t.value = 'eid'; } }
      if (e.target.dataset && e.target.dataset.file === 'pend' && e.type === 'change') pickPending(e.target, m2);
    },
    onClick: (e, m2) => { const x = e.target.closest('[data-pend-del]'); if (x) { PENDING.splice(+x.dataset.pendDel, 1); drawPending(m2); } },
    onSave: m2 => saveMember(id, m2) });
  drawPending(el);
  return el;
}
const fileBtns = tag => `<label class="gy-btn sm gy-file">📎 Add file<input type="file" data-file="${tag}" accept="application/pdf,image/*" multiple></label><label class="gy-btn sm gy-file">📷 Camera<input type="file" data-file="${tag}" accept="image/*" capture="environment"></label>`;
function drawPending(m2) {
  const box = m2 && m2.querySelector('#gyPend'); if (!box) return;
  box.innerHTML = PENDING.map((f, i) => `<div class="gy-doc"><div class="gy-doc-ic">${f.mime === 'application/pdf' ? '📄' : '🖼️'}</div><div class="gy-doc-tx"><b>${esc(f.label)} · ${esc(f.name)}</b><small>${kb(f.size)} · ready</small></div><div class="gy-doc-acts"><button type="button" class="gy-btn sm bad" data-pend-del="${i}" aria-label="Remove">✕</button></div></div>`).join('');
}
async function pickPending(input, m2) {
  const files = [...(input.files || [])]; input.value = '';
  for (const f of files) {
    try { const p = await prepFile(f); p.label = guessLabel(f.name); PENDING.push(p); drawPending(m2); }
    catch (err) { toast(err.message, 'warn'); }
  }
}
function readForm(m2) {
  const v = {}; ['plate', 'nocar', 'title', 'name', 'kind', 'room', 'type', 'start', 'len', 'end', 'price', 'paid', 'method', 'receipt', 'idType', 'idNo', 'nat', 'phone', 'email', 'notes', 'waiver'].forEach(k => { v[k] = fv(m2, k); });
  v.name = v.name.replace(/\s+/g, ' ').trim(); if (v.kind !== 'guest') v.room = '';
  v.price = Math.max(0, +v.price || 0);
  v.idNo = v.idType === 'eid' || /^784\d{12}$/.test(idClean(v.idNo)) ? idClean(v.idNo) : String(v.idNo || '').toUpperCase().replace(/\s+/g, '');
  if (!v.idType && /^784\d{12}$/.test(v.idNo)) v.idType = 'eid';
  if (v.len !== 'custom') v.end = endFor(v.start, v.len) || v.end;
  v.plate = v.nocar ? 'No car' : cellPlate(v.plate); delete v.nocar;
  return v;
}
async function saveMember(id, m2) {
  const v = readForm(m2);
  if (!v.name) { toast('Write the member\'s name', 'warn'); return false; }
  if (!isIso(v.start) || !isIso(v.end) || v.end < v.start) { toast('Check the start and end dates', 'warn'); return false; }
  if (v.idType === 'eid' && v.idNo && !/^784\d{12}$/.test(v.idNo)) { toast('An Emirates ID has 15 digits and starts with 784', 'warn'); return false; }
  const base = { title: v.title, name: v.name, kind: v.kind, room: v.room, type: v.type, start: v.start, end: v.end, idType: v.idType, idNo: v.idNo, nat: v.nat, phone: v.phone, email: v.email, notes: v.notes, waiver: !!v.waiver, plate: v.plate };
  const period = { start: v.start, end: v.end, len: v.len === 'custom' ? lenOf(v.start, v.end) : v.len, price: v.price, paid: v.paid, method: v.method, receipt: v.receipt };
  if (id) {
    const m = G.members[id]; if (!m) return true;
    const c = curOf(m), p = { upBy: me(), upAt: Date.now() };
    Object.keys(base).forEach(k => { if ((m[k] == null ? '' : m[k]) !== base[k]) p[k] = base[k]; });
    if (c.key) Object.keys(period).forEach(k => { if ((c[k] == null ? '' : c[k]) !== period[k]) p[`hist/${c.key}/${k}`] = period[k]; });
    patch(id, p); act('gym_member_updated', v.name); toast('Saved ✓');
    return true;
  }
  const nid = newId(), hid = newId();
  const rec = Object.assign(base, { by: me(), at: Date.now(), curH: hid, hist: { [hid]: Object.assign({ kind: 'new', by: me(), at: Date.now() }, period) } });
  putMember(nid, rec);
  act('gym_member_added', `${v.name} · ${TYPES[v.type]} · ${fmtD(v.start)} to ${fmtD(v.end)}`);
  const files = PENDING.slice(); PENDING = [];
  toast(`🏋️ ${v.name} added${files.length ? ' · saving ' + files.length + ' file' + (files.length === 1 ? '' : 's') + '…' : ''}`);
  if (files.length) {
    let ok = 0;
    for (const f of files) { try { if (await addDoc(nid, f, f.label)) ok++; } catch (err) { toast(err.message, 'err'); } }
    if (ok) toast(`📎 ${ok} file${ok === 1 ? '' : 's'} saved for ${v.name}`);
  }
  return true;
}

// ── a member's window ──
function openMember(id) {
  const m0 = G.members[id]; if (!m0) return;
  if (!G.viewed[id]) { G.viewed[id] = 1; act('gym_member_viewed', m0.name); }
  openModal(fullName(m0), '<div id="gyDetail"></div>', { kind: 'member', id, wide: true, foot: false, focus: false,
    refresh: () => drawMember(id),
    onClick: (e, m2) => onMemberClick(e, id, m2),
    onInput: (e) => { if (e.type === 'change' && e.target.dataset.file === 'doc') pickDocs(id, e.target); else if (e.type === 'change' && e.target.dataset.docLabel) relabel(id, e.target.dataset.docLabel, e.target.value); } });
  drawMember(id);
}
function drawMember(id) {
  const box = doc.getElementById('gyDetail'); if (!box) return;
  const m = G.members[id] ? Object.assign({ id }, G.members[id]) : null;
  if (!m || m.del) { closeModal(); return; }
  const t = today(), s = statusOf(m, t, SOON()), hd = doc.querySelector('#gy-modal .gy-sh-hd b'); if (hd) hd.textContent = fullName(m);
  const docs = Object.keys(m.docs || {}).map(k => Object.assign({ id: k }, m.docs[k])).sort((a, b) => (b.at || 0) - (a.at || 0));
  const visits = Object.values(m.visits || {}).map(v => +((v && v.at) || v) || 0).filter(Boolean).sort((a, b) => b - a);
  const reveal = !!G.reveal[id];
  const idTxt = m.idNo ? (reveal ? idFull(m.idNo) : maskId(m.idNo, m.idType)) : '—';
  const fact = (k, v) => `<div class="gy-fact"><small>${esc(k)}</small><div>${v}</div></div>`;
  const dt = ms => { const d = new Date(ms); return `${d.getDate()} ${MON[d.getMonth()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  box.innerHTML = `
  <div class="gy-hero">${statusChip(s)}<span class="gy-cd">${esc(countdown(m, t))}</span><span class="gy-note">${TYPE_ICON[m.type] || ''} ${esc(TYPES[m.type] || '')} · ${esc(fmtD(m.start))} → ${esc(fmtD(m.end))}</span></div>
  <div class="gy-radio">
    ${s !== 'expired' && s !== 'notstarted' ? '<button type="button" class="gy-btn sm" data-d="checkin">✓ Check in</button>' : ''}
    <button type="button" class="gy-btn sm pri" data-d="extend">${s === 'expired' ? '↻ Renew' : '＋ Extend'}</button>
    <button type="button" class="gy-btn sm" data-d="edit">✎ Edit</button>
    ${can('canExport') ? '<button type="button" class="gy-btn sm" data-d="print">🖨 Member card</button>' : ''}
    ${curOf(m).paid !== 'paid' && +curOf(m).price ? '<button type="button" class="gy-btn sm" data-d="paid">Mark paid</button>' : ''}
  </div>
  <div class="gy-sec"><h4>Details</h4><div class="gy-facts">
    ${fact('Member', esc(KINDS[m.kind] || '—') + (m.kind === 'guest' && m.room ? ' · Room ' + esc(m.room) : ''))}
    ${fact('Payment', (() => { const c = curOf(m); return +c.price ? `AED ${esc(money(c.price))} · <span class="gy-pay${c.paid === 'paid' ? '' : ' topay'}">${c.paid === 'paid' ? 'paid' : 'to pay'}</span>${c.method ? ' · ' + esc(c.method) : ''}${c.receipt ? ' · ' + esc(c.receipt) : ''}` : '—'; })())}
    ${fact(ID_TYPES[m.idType] || 'ID', `<span class="gy-mono">${esc(idTxt)}</span>${m.idNo ? ` <button type="button" class="gy-btn sm" data-d="reveal" style="margin-left:6px">${reveal ? 'Hide' : 'Show'}</button>` : ''}`)}
    ${fact('Nationality', esc(m.nat || '—'))}
    ${fact('Car plate', esc(m.plate || '—'))}
    ${fact('Mobile', m.phone ? `<a href="tel:${esc(String(m.phone).replace(/[^\d+]/g, ''))}">${esc(m.phone)}</a>` : '—')}
    ${fact('Email', m.email ? `<a href="mailto:${esc(m.email)}">${esc(m.email)}</a>` : '—')}
    ${fact('Waiver', m.waiver ? '✅ Signed' : '<span class="gy-pay topay">Not signed</span>')}
    ${fact('Check-ins', visits.length ? `${visits.length} · last ${esc(dt(visits[0]))}` : 'None yet')}
    ${m.notes ? fact('Notes', esc(m.notes)) : ''}
    ${fact('Added', `${esc(m.by || '')}${m.at ? ' · ' + esc(dt(m.at)) : ''}`)}
  </div></div>
  <div class="gy-sec"><h4><span>Documents · ${docs.length}</span><span class="gy-radio">${fileBtns('doc')}</span></h4>
    <div class="gy-docs">${docs.length ? docs.map(d => `<div class="gy-doc" data-doc="${esc(d.id)}"><div class="gy-doc-ic">${d.mime === 'application/pdf' ? '📄' : '🖼️'}</div>
      <div class="gy-doc-tx"><b>${esc(d.name)}</b><small>${kb(d.size || 0)} · ${esc(d.by || '')} · ${d.at ? esc(dt(d.at)) : ''}</small></div>
      <select class="gy-sel" data-doc-label="${esc(d.id)}" aria-label="What is this file" style="width:auto;padding:5px 8px;font-size:12px">${DOC_LABELS.map(l => `<option${(d.label || 'Other') === l ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <div class="gy-doc-acts"><button type="button" class="gy-btn sm" data-d="docview" data-doc-id="${esc(d.id)}">View</button>${can('canDelete') ? `<button type="button" class="gy-btn sm bad" data-d="docdel" data-doc-id="${esc(d.id)}" aria-label="Delete file">✕</button>` : ''}</div></div>`).join('')
      : '<div class="gy-note">No files yet. Add the ID copy and the signed form: a PDF, a picture, or take a photo.</div>'}</div>
    <div class="gy-note" id="gyDocBusy" aria-live="polite"></div></div>
  <div class="gy-sec"><h4>Periods</h4><div class="gy-hist">${histOf(m).reverse().map(h => `<div class="gy-hrow"><span><b>${esc(fmtD(h.start))} → ${esc(fmtD(h.end))}</b> · ${esc(lenLabel(h.len || lenOf(h.start, h.end)))}${h.kind === 'extend' ? ' · extension' : ''}</span><small>${+h.price ? 'AED ' + esc(money(h.price)) + ' ' + (h.paid === 'paid' ? 'paid' : 'to pay') + ' · ' : ''}${esc(h.by || '')}${h.at ? ' · ' + esc(dt(h.at)) : ''}</small></div>`).join('') || '<div class="gy-note">—</div>'}</div></div>
  ${visits.length ? `<div class="gy-sec"><h4>Last check-ins</h4><div class="gy-tags">${visits.slice(0, 12).map(v => `<span class="gy-tag">${esc(dt(v))}</span>`).join('')}</div></div>` : ''}
  ${can('canDelete') ? '<div style="display:flex;justify-content:flex-end"><button type="button" class="gy-btn sm bad" data-d="delete">Delete member</button></div>' : ''}`;
}
function onMemberClick(e, id, m2) {
  const b = e.target.closest('[data-d]'); if (!b) return;
  const a = b.dataset.d, m = G.members[id]; if (!m) return;
  if (a === 'checkin') checkIn(id);
  else if (a === 'extend') extendDialog(id);
  else if (a === 'edit') memberForm(id);
  else if (a === 'print') printCard(id);
  else if (a === 'paid') { const c = curOf(m); if (c.key) { patch(id, { [`hist/${c.key}/paid`]: 'paid', upBy: me(), upAt: Date.now() }); act('gym_paid', m.name); toast('Marked paid ✓'); } }
  else if (a === 'reveal') { G.reveal[id] = !G.reveal[id]; if (G.reveal[id]) act('gym_id_viewed', m.name); drawMember(id); }
  else if (a === 'docview') viewDoc(id, b.dataset.docId);
  else if (a === 'docdel') delDoc(id, b.dataset.docId);
  else if (a === 'delete') delMember(id);
}
async function pickDocs(id, input) {
  const files = [...(input.files || [])]; input.value = '';
  const busy = doc.getElementById('gyDocBusy');
  for (const f of files) {
    if (busy) busy.textContent = `Saving ${f.name || 'the file'}…`;
    try { const p = await prepFile(f); if (await addDoc(id, p, guessLabel(f.name))) toast(`📎 ${p.label || guessLabel(f.name)} saved (${kb(p.size)})`); }
    catch (err) { toast(err.message, 'warn'); }
  }
  const b2 = doc.getElementById('gyDocBusy'); if (b2) b2.textContent = '';
}
function relabel(id, did, label) { const m = G.members[id]; if (!m || !m.docs || !m.docs[did] || !DOC_LABELS.includes(label)) return; patch(id, { [`docs/${did}/label`]: label }); }
async function viewDoc(id, did) {
  const m = G.members[id], d = m && m.docs && m.docs[did]; if (!d) return;
  const pdf = d.mime === 'application/pdf';
  const win = null;
  const busy = doc.getElementById('gyDocBusy'); if (busy) busy.textContent = `Opening ${d.name}…`;
  let b64 = '';
  try { b64 = await docRead(id, did); } catch (err) { if (busy) busy.textContent = ''; toast(err.message, 'err'); return; }
  if (busy) busy.textContent = '';
  act('gym_doc_viewed', `${m.name}: ${d.label || 'file'}`);
  const bin = atob(b64), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: d.mime || 'application/octet-stream' }));
  const v = doc.createElement('div'); v.className = 'gy-view'; v.setAttribute('role', 'dialog'); v.setAttribute('aria-label', d.name);
  v.innerHTML = `${pdf ? `<div style="color:#fff;text-align:center;font-size:15px;line-height:1.5">📄 <b>${esc(d.name)}</b><br><small style="opacity:.75">${kb(d.size || bytes.length)} · PDF</small></div>` : `<img alt="${esc(d.label || 'Document')}" src="${url}">`}
    <div class="gy-vacts">${pdf ? '<button type="button" class="gy-btn" data-v="open">Open PDF</button>' : ''}${can('canExport') ? '<button type="button" class="gy-btn" data-v="dl">⬇ Download</button>' : ''}<button type="button" class="gy-btn" data-v="close">Close</button></div>`;
  const close = () => { v.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); doc.removeEventListener('keydown', esc1, true); };
  const esc1 = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  doc.addEventListener('keydown', esc1, true);
  v.addEventListener('click', e => {
    const b = e.target.closest('[data-v]');
    if (!b) { if (e.target === v) close(); return; }
    if (b.dataset.v === 'open') { const w = W.open(url, '_blank'); if (!w) toast('Allow pop-ups to open the PDF, or use Download', 'warn'); }
    else if (b.dataset.v === 'dl') { if (!can('canExport')) return deny('Downloading files'); const a = doc.createElement('a'); a.href = url; a.download = d.name || 'document'; doc.body.appendChild(a); a.click(); a.remove(); }
    else close();
  });
  doc.body.appendChild(v);
  void win;
}
async function delDoc(id, did) {
  if (!can('canDelete')) return deny('Deleting records');
  const m = G.members[id], d = m && m.docs && m.docs[did]; if (!d) return;
  let b64 = '';
  try { b64 = await docRead(id, did); } catch (_) {}
  const meta = JSON.parse(JSON.stringify(d));
  patch(id, { ['docs/' + did]: null }); docRemove(id, did); delete G.cache[id + '/' + did];
  act('gym_doc_deleted', `${m.name}: ${meta.label || 'file'}`);
  const back = () => { if (!b64) { toast('The file could not be brought back', 'err'); return false; } docWrite(id, did, b64).then(() => { G.cache[id + '/' + did] = b64; patch(id, { ['docs/' + did]: meta }); }).catch(err => toast(err.message, 'err')); return true; };
  if (typeof showUndoToast === 'function') showUndoToast(`File deleted: ${meta.name}`, back, 8000); else toast('File deleted');
}
function delMember(id) {
  if (!can('canDelete')) return deny('Deleting records');
  const m = G.members[id]; if (!m) return;
  if (!confirm(`Delete ${m.name}'s membership, history and files?`)) return;
  patch(id, { del: 1, delBy: me(), delAt: Date.now() }); closeModal();
  act('gym_member_deleted', m.name);
  const timer = setTimeout(() => purge(id), 9000);
  const back = () => { clearTimeout(timer); patch(id, { del: null, delBy: null, delAt: null }); return true; };
  if (typeof showUndoToast === 'function') showUndoToast(`${m.name} deleted`, back, 8000); else toast(`${m.name} deleted`);
}
/** a deleted member goes for good (files too) once the Undo time is over */
function purge(id) { const m = G.members[id]; if (!m || !m.del) return; putMember(id, null); docRemove(id); }

function checkIn(id) {
  const m = G.members[id]; if (!m) return;
  const t = today(), s = statusOf(m, t, SOON());
  if (s === 'expired' || s === 'notstarted') { toast(`${m.name}'s membership is ${STATUS[s].toLowerCase()}`, 'warn'); return; }
  const vid = newId(); patch(id, { ['visits/' + vid]: { at: Date.now(), by: me() } });
  act('gym_checkin', m.name);
  const n = Object.keys((G.members[id] || {}).visits || {}).length;
  const back = () => { patch(id, { ['visits/' + vid]: null }); return true; };
  if (typeof showUndoToast === 'function') showUndoToast(`✓ ${m.name} checked in · visit ${n}`, back, 6000); else toast(`✓ ${m.name} checked in`);
}

// ── extend / renew ──
function extendDialog(id, pre) {
  const m = G.members[id]; if (!m) return;
  pre = pre || {};
  const t = today(), on = isIso(m.end) && m.end >= t, c = curOf(m);
  const modeDef = pre.mode || (on ? 'after' : 'today');
  const L = { '30d': '+30 days', '1m': '+1 month', '3m': '+3 months', '6m': '+6 months', '12m': '+12 months', custom: 'Custom' };
  let len = pre.len && L[pre.len] ? pre.len : (pre.len ? 'custom' : '30d');
  const body = `<div class="gy-prev">${statusChip(statusOf(m, t, SOON()))} <b>${esc(fullName(m))}</b> · ${esc(TYPES[m.type] || '')} · now ${esc(fmtD(m.start))} → <b>${esc(fmtD(m.end))}</b> (${esc(countdown(m, t))})</div>
    <div class="gy-f wide"><span>Add</span>${radios('len', L, len)}</div>
    <div class="gy-f wide"><span>The new period starts</span>${radios('mode', { after: 'Day after the current end (' + fmtD(addDays(m.end, 1), true) + ')', today: 'Today (' + fmtD(t, true) + ')', date: 'On a date' }, modeDef)}</div>
    <div class="gy-form">
      ${field('Start date', `<input name="date" type="date" class="gy-in" value="${esc(pre.date || t)}">`, false, ` data-show="date"${modeDef === 'date' ? '' : ' hidden'}`)}
      ${field('End date', `<input name="cend" type="date" class="gy-in" value="${esc(pre.end || '')}">`, false, ` data-show="custom"${len === 'custom' ? '' : ' hidden'}`)}
      ${field('Amount paid (AED)', `<input name="price" type="number" min="0" step="1" inputmode="decimal" class="gy-in" value="${esc(pre.price || pricePreset(G.cfg, len) || c.price || '')}">`)}
      ${field('Payment', `<select name="paid" class="gy-sel"><option value="paid">Paid</option><option value="topay">To pay</option></select>`)}
      ${field('Method', `<select name="method" class="gy-sel"><option value="">—</option>${METHODS.map(x => `<option${c.method === x ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select>`)}
      ${field('Receipt / folio no.', '<input name="receipt" class="gy-in" maxlength="40">')}
    </div>
    <div class="gy-prev" id="gyExtPrev"></div>`;
  const plan = m2 => { const p = extendPlan(m, fv(m2, 'len'), t, fv(m2, 'mode'), fv(m2, 'date'), fv(m2, 'cend')); return { p, r: applyExtend(m, p) }; };
  const draw = m2 => {
    m2.querySelector('[data-show="date"]').hidden = fv(m2, 'mode') !== 'date';
    m2.querySelector('[data-show="custom"]').hidden = fv(m2, 'len') !== 'custom';
    const { p, r } = plan(m2), box = m2.querySelector('#gyExtPrev');
    box.innerHTML = r ? `New period <b>${esc(fmtD(p.start))} → ${esc(fmtD(p.end))}</b> (${diffDays(p.start, p.end) + 1} days).<br>Membership then runs <b>${esc(fmtD(r.start))} → ${esc(fmtD(r.end))}</b>.${on && p.start <= m.end ? ' <span class="gy-pay topay">Overlaps the current period.</span>' : ''}` : 'Choose the end date.';
  };
  const el = openModal(on ? 'Extend membership' : 'Renew membership', body, { kind: 'extend', save: on ? 'Extend' : 'Renew', focus: false,
    onInput: (e, m2) => {
      if (e.target.name === 'len' && !pre.price) { const pr = m2.querySelector('[name="price"]'), np = pricePreset(G.cfg, fv(m2, 'len')); if (np) pr.value = np; }
      draw(m2);
    },
    onSave: m2 => {
      const { p, r } = plan(m2); if (!r) { toast('Choose the end date', 'warn'); return false; }
      const hid = newId(), lenV = fv(m2, 'len');
      const h = { kind: 'extend', start: p.start, end: p.end, len: lenV === 'custom' ? lenOf(p.start, p.end) : lenV, price: Math.max(0, +fv(m2, 'price') || 0), paid: fv(m2, 'paid'), method: fv(m2, 'method'), receipt: fv(m2, 'receipt'), by: me(), at: Date.now() };
      patch(id, { start: r.start, end: r.end, curH: hid, ['hist/' + hid]: h, upBy: me(), upAt: Date.now() });
      act('gym_extended', `${m.name}: ${fmtD(p.start)} to ${fmtD(p.end)}`);
      toast(`${on ? 'Extended' : 'Renewed'} ✓ ${m.name} until ${fmtD(r.end)}`);
      if (MODAL && MODAL.kind === 'member') setTimeout(() => openMember(id), 0);
    } });
  if (pre.paid) { const s = el.querySelector('[name="paid"]'); if (s) s.value = pre.paid; }
  draw(el);
  const wasMember = MODAL; void wasMember;
}

// ── paste an email ──
function pasteDialog(text) {
  const body = `<div class="gy-note">Paste the email (or WhatsApp) about the membership. The name, new or extension, gym / pool, length, dates and the ID number are read for you. Add the file names of the attachments too (e.g. “EID_784….pdf”).</div>
    <textarea class="gy-in" name="txt" rows="6" style="min-height:130px;resize:vertical" placeholder="Ms. A, our guest, has extended her gym membership for an additional 30 days starting from today.">${esc(text || '')}</textarea>
    <div id="gyPastePrev"></div>`;
  let parsed = null, match = null, last = null;
  const draw = m2 => {
    const box = m2.querySelector('#gyPastePrev'), txt = fv(m2, 'txt');
    if (txt === last) return; last = txt;   // a "change" on leaving the box must not redraw the buttons under the tap
    if (!txt) { box.innerHTML = ''; parsed = null; return; }
    parsed = parseEmail(txt, today()); match = parsed.name ? findMember(list(), parsed.name) : null;
    const want = parsed.action === 'extend' && match ? 'extend' : 'new';
    box.innerHTML = `<div class="gy-prev"><div class="gy-tags" style="margin-bottom:6px">${parsed.found.map(f => `<span class="gy-tag">✓ ${esc(f)}</span>`).join('')}</div>
      ${parsed.name ? `<b>${esc(((parsed.title ? parsed.title + '. ' : '') + parsed.name))}</b> · ` : '<b>No name found</b> · '}${esc(TYPES[parsed.type])} · ${parsed.action === 'extend' ? 'extension' : 'new membership'}${parsed.len ? ' · ' + esc(lenLabel(parsed.len)) : ''}${parsed.start ? ' · from ' + esc(fmtD(parsed.start)) : ''}${parsed.end ? ' to ' + esc(fmtD(parsed.end)) : ''}${parsed.idNo ? ' · ID <span class="gy-mono">' + esc(maskId(parsed.idNo, parsed.idType)) + '</span>' : ''}
      ${match ? `<div style="margin-top:6px">Matches <b>${esc(fullName(match))}</b> (${esc(STATUS[statusOf(match, today(), SOON())].toLowerCase())}, ends ${esc(fmtD(match.end))}).</div>` : (parsed.action === 'extend' && parsed.name ? '<div style="margin-top:6px" class="gy-pay topay">No member with this name yet: it will be added as new.</div>' : '')}</div>
      <div class="gy-radio" style="margin-top:8px">${match ? `<button type="button" class="gy-btn${want === 'extend' ? ' pri' : ''}" data-p="extend">Extend ${esc(match.name)}</button>` : ''}<button type="button" class="gy-btn${want === 'new' ? ' pri' : ''}" data-p="new">${match ? 'New member instead' : 'Fill the new member form'}</button></div>`;
  };
  const el = openModal('Paste email', body, { kind: 'paste', foot: '<button type="button" class="gy-btn" data-m="close">Close</button>', focus: '[name="txt"]',
    onInput: (e, m2) => draw(m2),
    onClick: (e) => {
      const b = e.target.closest('[data-p]'); if (!b || !parsed) return;
      const p = parsed;
      if (b.dataset.p === 'extend' && match) {
        const mm = G.members[match.id], on = mm && isIso(mm.end) && mm.end >= today();
        // "starting today" on a membership that is still on: the day after the current end is usual; "Today" stays a choice
        const mode = p.start && p.start !== today() ? 'date' : on ? 'after' : 'today';
        closeModal(); extendDialog(match.id, { len: p.len || '30d', mode, date: p.start, end: p.len === 'custom' ? p.end : '', price: p.price });
      } else {
        closeModal();
        memberForm(null, { title: p.title, name: p.name, kind: p.kind || 'guest', room: p.room, type: p.type, start: p.start || today(), len: p.len || (p.end ? 'custom' : '1m'), end: p.end, price: p.price, idType: p.idType, idNo: p.idType === 'eid' ? fmtEid(p.idNo) : p.idNo, nat: p.nat, phone: p.phone, email: p.email, plate: p.plate });
      }
    } });
  draw(el);
}

// ── export for the manager: one panel, Excel + PDF ──
function exportDialog() {
  if (!can('canExport')) return deny('Downloading files');
  const t = today(), all = list().filter(m => !m.del);
  const n = k => scopeFilter(all, k, t).length;
  openModal('Export · Gym & Pool report', `<div class="gy-f wide"><span>Members</span>${radios('scope', Object.keys(SCOPES).reduce((o, k) => (o[k] = `${SCOPES[k]} (${n(k)})`, o), {}), 'all')}</div>
    <div class="gy-prev">The report has the columns of the team's sheet first (Guest Name, Mobile, Start, End, Car Plate, Amount Paid), then Status, Days left, Type, Room and Paid, the totals, and a second part with who is ending soon or expired. No ID numbers.</div>`,
  { kind: 'export', focus: false, foot: '<button type="button" class="gy-btn" data-m="close">Cancel</button><button type="button" class="gy-btn" data-x="pdf">📄 PDF</button><button type="button" class="gy-btn pri" data-x="xl">⬇ Excel</button>',
    onClick: (e, m2) => {
      const b = e.target.closest('[data-x]'); if (!b) return;
      const scope = fv(m2, 'scope') || 'all';
      closeModal();
      if (b.dataset.x === 'xl') exportExcel(scope); else exportPdf(scope);
    } });
}
const model = scope => { const all = list().filter(m => !m.del); return reportModel(all, all, today(), { scope, soon: SOON(), hotel: hotel(), user: me() }); };
const EXCELJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
let exLoading = null;
function loadExcelJS() {
  if (W.ExcelJS && W.ExcelJS.Workbook) return Promise.resolve(W.ExcelJS);
  if (exLoading) return exLoading;
  exLoading = new Promise((ok, no) => {
    const sc = doc.createElement('script'); sc.src = EXCELJS_URL; sc.async = true; sc.crossOrigin = 'anonymous';
    const tm = setTimeout(() => no(new Error('timeout')), 12000);
    sc.onload = () => { clearTimeout(tm); W.ExcelJS && W.ExcelJS.Workbook ? ok(W.ExcelJS) : no(new Error('no ExcelJS')); };
    sc.onerror = () => { clearTimeout(tm); no(new Error('not loaded')); };
    doc.head.appendChild(sc);
  }).catch(e => { exLoading = null; throw e; });
  return exLoading;
}
// colours: [fill, text]
const XC = { band: 'FF1E293B', gold: 'FFC9A227', head: 'FF1E293B', zebra: 'FFF8FAFC', line: 'FFE2E8F0', ink: 'FF0F172A', sub: 'FF64748B', white: 'FFFFFFFF', total: 'FFFEF9E7',
  ok: ['FFDCFCE7', 'FF166534'], warn: ['FFFEF3C7', 'FF92400E'], bad: ['FFFEE2E2', 'FF991B1B'], blue: ['FFDBEAFE', 'FF1E40AF'], grey: ['FFF1F5F9', 'FF64748B'] };
const ST_C = { Active: XC.ok, 'Ending soon': XC.warn, Expired: XC.bad, 'Not started': XC.blue };
async function proWorkbook(M) {
  const EJ = await loadExcelJS();
  const wb = new EJ.Workbook(); wb.creator = 'HotelOps'; wb.created = new Date(); wb.title = M.title;
  const thin = { style: 'thin', color: { argb: XC.line } }, box = { top: thin, left: thin, bottom: thin, right: thin };
  const fill = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
  const font = o => Object.assign({ name: 'Calibri', size: 11, color: { argb: XC.ink } }, o);
  const n = M.head.length, footer = `&L&8${(M.title + (M.hotel ? ' · ' + M.hotel : '') + ' · ' + fmtD(M.date)).replace(/&/g, '&&')}&R&8Page &P of &N`;
  const KC = { ok: XC.ok, warn: XC.warn, bad: XC.bad, ink: XC.blue };
  function titleBlock(ws, sub) {
    ws.mergeCells(1, 1, 1, n); const h = ws.getCell(1, 1); h.value = (M.hotel || 'HotelOps').toUpperCase(); h.font = font({ size: 9.5, bold: true, color: { argb: 'FFF5D97A' } }); h.alignment = { vertical: 'bottom', indent: 1 };
    ws.mergeCells(2, 1, 2, n); const t = ws.getCell(2, 1); t.value = sub ? M.title + ' · ' + sub : M.title; t.font = font({ size: 20, bold: true, color: { argb: XC.white } }); t.alignment = { vertical: 'middle', indent: 1 };
    ws.mergeCells(3, 1, 3, n); const s = ws.getCell(3, 1); s.value = `${fmtD(M.date)} · ${M.scope}${M.by ? ' · Prepared by ' + M.by : ''}`; s.font = font({ size: 10.5, color: { argb: 'FFCBD5E1' } }); s.alignment = { vertical: 'top', indent: 1 };
    for (let r = 1; r <= 3; r++) for (let c = 1; c <= n; c++) ws.getCell(r, c).fill = fill(XC.band);
    for (let c = 1; c <= n; c++) ws.getCell(3, c).border = { bottom: { style: 'thick', color: { argb: XC.gold } } };
    ws.getRow(1).height = 18; ws.getRow(2).height = 32; ws.getRow(3).height = 20; ws.getRow(4).height = 8;
    // KPI tiles: value on row 5, label on row 6
    const per = Math.floor(n / M.kpis.length);
    M.kpis.forEach(([label, v, k], i) => {
      const c1 = i * per + 1, c2 = i === M.kpis.length - 1 ? n : c1 + per - 1, col = KC[k] || XC.blue;
      ws.mergeCells(5, c1, 5, c2); ws.mergeCells(6, c1, 6, c2);
      const vc = ws.getCell(5, c1), lc = ws.getCell(6, c1);
      vc.value = v; vc.font = font({ size: 18, bold: true, color: { argb: col[1] } }); vc.alignment = { horizontal: 'center', vertical: 'middle' };
      lc.value = String(label).toUpperCase(); lc.font = font({ size: 8.5, bold: true, color: { argb: col[1] } }); lc.alignment = { horizontal: 'center', vertical: 'top' };
      for (let c = c1; c <= c2; c++) [5, 6].forEach(r => { const x = ws.getCell(r, c); x.fill = fill(col[0]); x.border = { left: { style: c === c1 ? 'thick' : undefined, color: { argb: XC.white } }, right: { style: c === c2 ? 'thick' : undefined, color: { argb: XC.white } } }; });
    });
    ws.getRow(5).height = 30; ws.getRow(6).height = 16; ws.getRow(7).height = 10;
    return 8;
  }
  function table(ws, H, rows, total) {
    const hr = ws.getRow(H); hr.values = M.head; hr.height = 24;
    M.head.forEach((_, i) => { const c = hr.getCell(i + 1); c.font = font({ bold: true, color: { argb: XC.white } }); c.fill = fill(XC.head); c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; c.border = { left: { style: 'thin', color: { argb: 'FF334155' } }, right: { style: 'thin', color: { argb: 'FF334155' } } }; });
    rows.forEach((cells, k) => {
      const row = ws.getRow(H + 1 + k);
      row.values = cells.map((v, i) => (i === 2 || i === 3) ? (isIso(v) ? xlSerial(v) : v) : v);
      row.height = 19;
      cells.forEach((_, i) => { const c = row.getCell(i + 1); c.border = box; c.font = font({ size: 10.5 }); c.alignment = { vertical: 'middle', horizontal: [2, 3, 4, 6, 7, 9, 10].includes(i) ? 'center' : i === 5 ? 'right' : 'left' }; if (k % 2) c.fill = fill(XC.zebra); });
      row.getCell(1).font = font({ size: 10.5, bold: true });
      row.getCell(3).numFmt = 'dd.mm.yyyy'; row.getCell(4).numFmt = 'dd.mm.yyyy';
      row.getCell(6).numFmt = '"AED" #,##0.00;-"AED" #,##0.00;"–"';
      const st = ST_C[cells[6]]; if (st) { const c = row.getCell(7); c.fill = fill(st[0]); c.font = font({ size: 10.5, bold: true, color: { argb: st[1] } }); }
      const dl = cells[7]; if (dl !== '' && dl != null) { const tint = dl <= 3 ? XC.bad : dl <= 7 ? XC.warn : XC.ok, c = row.getCell(8); c.fill = fill(tint[0]); c.font = font({ size: 10.5, bold: true, color: { argb: tint[1] } }); }
      if (cells[10] === 'No') row.getCell(11).font = font({ size: 10.5, bold: true, color: { argb: XC.bad[1] } });
      if (cells[4] === 'No car') row.getCell(5).font = font({ size: 10.5, italic: true, color: { argb: XC.sub } });
    });
    let last = H + rows.length;
    if (!rows.length) { ws.mergeCells(H + 1, 1, H + 1, n); const c = ws.getCell(H + 1, 1); c.value = 'No members.'; c.font = font({ italic: true, color: { argb: XC.sub } }); last++; }
    if (total) {
      const r = ws.getRow(last + 1); r.values = total; r.height = 22;
      total.forEach((_, i) => { const c = r.getCell(i + 1); c.fill = fill(XC.total); c.font = font({ bold: true, size: 11 }); c.border = { top: { style: 'medium', color: { argb: XC.head } }, bottom: { style: 'medium', color: { argb: XC.head } } }; });
      r.getCell(6).numFmt = '"AED" #,##0.00'; r.getCell(6).alignment = { horizontal: 'right' };
      if (rows.length) r.getCell(6).value = { formula: `SUM(F${H + 1}:F${H + rows.length})`, result: total[5] };
    }
    ws.autoFilter = { from: { row: H, column: 1 }, to: { row: Math.max(H, H + rows.length), column: n } };
    ws.views = [{ state: 'frozen', ySplit: H, xSplit: 1, topLeftCell: `B${H + 1}`, activeCell: `A${H + 1}`, showGridLines: false }];
    ws.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true, margins: { left: 0.3, right: 0.3, top: 0.45, bottom: 0.55, header: 0.2, footer: 0.25 }, printTitlesRow: `${H}:${H}` };
    ws.headerFooter = { oddFooter: footer, evenFooter: footer };
  }
  const ws = wb.addWorksheet('Gym Memberships', { properties: { tabColor: { argb: XC.gold } }, views: [{ showGridLines: false }] });
  ws.columns = M.widths.map(w => ({ width: w }));
  table(ws, titleBlock(ws, ''), M.rows, M.total);
  const ws2 = wb.addWorksheet('Ending soon & expired', { properties: { tabColor: { argb: 'FFDC2626' } }, views: [{ showGridLines: false }] });
  ws2.columns = M.widths.map(w => ({ width: w }));
  table(ws2, titleBlock(ws2, 'ending soon & expired'), M.attention, null);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
/** offline: a plain SheetJS file with the same columns (real dates, AED format) */
function plainWorkbook(M) {
  if (typeof XLSX === 'undefined' || !XLSX.utils) return null;
  const wb = XLSX.utils.book_new();
  const sheet = rows => {
    const aoa = [[M.title + (M.hotel ? ' · ' + M.hotel : '')], [`${fmtD(M.date)} · ${M.scope}${M.by ? ' · Prepared by ' + M.by : ''}`], M.kpis.map(k => k[0] + ': ' + k[1]), [], M.head].concat(rows.map(r => r.map((v, i) => (i === 2 || i === 3) && isIso(v) ? xlSerial(v) : v)));
    const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = M.widths.map(w => ({ wch: w }));
    rows.forEach((r, k) => { [2, 3].forEach(c => { const a = XLSX.utils.encode_cell({ r: 5 + k, c }); if (ws[a] && ws[a].t === 'n') ws[a].z = 'dd.mm.yyyy'; }); const a = XLSX.utils.encode_cell({ r: 5 + k, c: 5 }); if (ws[a]) ws[a].z = '#,##0.00'; });
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 4, c: 0 }, e: { r: 4 + rows.length, c: M.head.length - 1 } }) };
    return ws;
  };
  XLSX.utils.book_append_sheet(wb, sheet(M.rows.concat([M.total])), 'Gym Memberships');
  XLSX.utils.book_append_sheet(wb, sheet(M.attention), 'Ending soon & expired');
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
}
async function exportExcel(scope) {
  if (!can('canExport')) return deny('Downloading files');
  const M = model(scope || 'all'), name = fileName(hotel(), today());
  let bytes = null, pro = false;
  try { bytes = await proWorkbook(M); pro = true; } catch (e) { safe(() => console.warn('[gym] styled Excel not available, plain file instead:', e && e.message)); }
  if (!bytes) bytes = safe(() => plainWorkbook(M), null);
  if (!bytes) { toast('Excel is not loaded (offline?) — try again in a moment', 'warn'); return null; }
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = doc.createElement('a'); a.href = url; a.download = name; doc.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast(`⬇ ${name} · ${M.rows.length} member${M.rows.length === 1 ? '' : 's'}${pro ? '' : ' (simple layout — offline)'}`);
  act('gym_export', `Excel · ${M.scope} (${M.rows.length})`);
  return { name, pro, bytes };
}
function exportPdf(scope) {
  if (!can('canExport')) return deny('Downloading files');
  if (typeof mePrintPage !== 'function') { toast('The PDF helper did not load. Reload the page.', 'warn'); return null; }
  const M = model(scope || 'all');
  const w = mePrintPage(fileName(hotel(), today(), 'pdf').replace(/\.pdf$/, ''), reportHtml(M), { landscape: true });
  if (w) { toast('📄 PDF page opened: press "Print / Save as PDF"'); safe(() => setTimeout(() => { try { w.print(); } catch (_) {} }, 700)); }
  act('gym_export', `PDF · ${M.scope} (${M.rows.length})`);
  return w;
}

// ── import the team's sheet (Excel or CSV) ──
async function readSheet(file) {
  const name = file.name || '';
  if (/\.csv$|\.txt$/i.test(name) || /csv|text\/plain/.test(file.type || '')) return parseCsv(await file.text());
  if (typeof XLSX === 'undefined' || !XLSX.read) throw new Error('The Excel reader is not loaded yet (offline?). Try again in a moment, or save the sheet as CSV.');
  const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
  const names = wb.SheetNames.slice().sort((a, b) => (/gym/i.test(b) ? 1 : 0) - (/gym/i.test(a) ? 1 : 0));
  for (const n of names) { const aoa = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }); if (importRows(aoa, today()).header >= 0) return aoa; }
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
}
function importDialog() {
  if (!can('canImport')) return deny('Importing');
  let plan = null;
  const el = openModal('Import from Excel', `<div class="gy-note">Load the team's sheet once (Excel or CSV) with the columns <b>Guest Name · Mobile number · Start Date · End Date · Car Plate Number · Amount Paid</b>. Dates like 13.10.2026 or 13/10/2026 work. Members already here (same name and mobile) are updated, not added twice. You see everything before it is saved.</div>
    <div class="gy-radio"><label class="gy-btn pri gy-file">📂 Choose the file<input type="file" data-file="imp" accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"></label></div>
    <div id="gyImpPrev"></div>`,
  { kind: 'import', focus: false, save: 'Import', foot: '<button type="button" class="gy-btn" data-m="close">Cancel</button><button type="button" class="gy-btn pri" data-m="save" id="gyImpGo" disabled>Import</button>',
    onInput: async (e, m2) => {
      if (e.type !== 'change' || e.target.dataset.file !== 'imp') return;
      const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
      const box = m2.querySelector('#gyImpPrev'); box.innerHTML = '<div class="gy-note">Reading…</div>';
      try {
        const res = importRows(await readSheet(f), today());
        if (res.header < 0) { plan = null; box.innerHTML = '<div class="gy-prev gy-pay topay">No “Guest Name” and “Start Date / End Date” columns found in this file.</div>'; m2.querySelector('#gyImpGo').disabled = true; return; }
        plan = mergePlan(list(), res.rows);
        const c = k => plan.filter(p => p.act === k).length, t = today();
        const tag = p => p.act === 'new' ? '<span class="gy-st active">New</span>' : p.act === 'update' ? '<span class="gy-st ending">Update</span>' : '<span class="gy-st expired">Same</span>';
        box.innerHTML = `<div class="gy-prev"><b>${esc(f.name)}</b>: ${c('new')} new · ${c('update')} to update · ${c('same')} already up to date${res.skipped.length ? ` · ${res.skipped.length} row${res.skipped.length === 1 ? '' : 's'} skipped` : ''}</div>
          <div class="gy-hist">${plan.map(p => `<div class="gy-hrow"><span>${tag(p)} <b>${esc(p.row.name)}</b> · ${esc(dDot(p.row.start))} → ${esc(dDot(p.row.end))} · ${esc(lenLabel(p.row.len))}${p.row.price ? ' · AED ' + esc(money(p.row.price)) : ''}</span><small>${esc(STATUS[statusOf(p.row, t, SOON())])}${p.row.plate ? ' · 🚗 ' + esc(p.row.plate) : ''}${p.changes.length ? ' · ' + esc(p.changes.join(', ')) : ''}</small></div>`).join('')}
          ${res.skipped.map(s => `<div class="gy-hrow"><span class="gy-pay topay">Row ${s.line}${s.name ? ' · ' + esc(s.name) : ''}</span><small>skipped: ${esc(s.why)}</small></div>`).join('')}</div>`;
        const go = m2.querySelector('#gyImpGo'); const n = c('new') + c('update'); go.disabled = !n; go.textContent = n ? `Import ${n}` : 'Nothing to import';
      } catch (err) { plan = null; box.innerHTML = `<div class="gy-prev gy-pay topay">${esc(err.message)}</div>`; }
    },
    onSave: () => {
      if (!plan) return false;
      let a = 0, u = 0;
      plan.forEach(p => {
        const r = p.row, paid = r.price > 0 ? 'paid' : 'topay';
        if (p.act === 'new') {
          const nid = newId(), hid = newId();
          putMember(nid, { title: '', name: r.name, kind: 'guest', room: r.room, type: r.type, start: r.start, end: r.end, phone: r.phone, plate: r.plate, email: r.email, nat: r.nat, idType: '', idNo: '', notes: '', waiver: false,
            by: me(), at: Date.now(), src: 'import', curH: hid, hist: { [hid]: { kind: 'new', start: r.start, end: r.end, len: r.len, price: r.price, paid, method: '', receipt: '', by: me(), at: Date.now() } } });
          a++;
        } else if (p.act === 'update') {
          const m = G.members[p.id]; if (!m) return;
          const pt = { upBy: me(), upAt: Date.now() };
          if (r.phone) pt.phone = r.phone; if (r.plate) pt.plate = r.plate;
          if (p.changes.includes('new period')) {
            const ex = applyExtend(m, { start: r.start, end: r.end }), hid = newId();
            Object.assign(pt, { start: ex.start, end: ex.end, curH: hid, ['hist/' + hid]: { kind: 'extend', start: r.start, end: r.end, len: r.len, price: r.price, paid, method: '', receipt: '', by: me(), at: Date.now() } });
          } else {
            const c = curOf(m); pt.start = r.start; pt.end = r.end;
            if (c.key) Object.assign(pt, { [`hist/${c.key}/start`]: r.start, [`hist/${c.key}/end`]: r.end, [`hist/${c.key}/len`]: r.len }, r.price ? { [`hist/${c.key}/price`]: r.price, [`hist/${c.key}/paid`]: 'paid' } : {});
          }
          patch(p.id, pt); u++;
        }
      });
      act('gym_import', `${a} new, ${u} updated`);
      toast(`⬆ Imported: ${a} new, ${u} updated`);
    } });
  return el;
}

function printCard(id) {
  if (!can('canExport')) return deny('Downloading files');
  const m = G.members[id]; if (!m) return;
  if (typeof mePrintPage !== 'function') { toast('The PDF helper did not load. Reload the page.', 'warn'); return; }
  const w = mePrintPage('Gym membership ' + m.name, cardHtml(Object.assign({ id }, m), { today: today(), hotel: hotel(), fullId: !!G.reveal[id], soon: SOON() }), { sign: ['Member signature', 'Front desk'], signName: '' });
  if (w) toast('📄 Member card opened: print it for signing, or save as PDF');
  act('gym_card_printed', m.name);
}

function settingsDialog() {
  const P = [['1m', '1 month'], ['30d', '30 days'], ['3m', '3 months'], ['6m', '6 months'], ['12m', '12 months']];
  openModal('Gym & Pool settings', `${field('“Ending soon” when this many days or fewer are left', `<input name="soon" type="number" min="0" max="30" step="1" class="gy-in" value="${SOON()}">`, true)}
    <div class="gy-f wide"><span>Prices (AED), filled in by themselves for a new member or an extension · empty = none</span><div class="gy-form">${P.map(([k, l]) => field(l, `<input name="pr_${k}" type="number" min="0" step="1" inputmode="decimal" class="gy-in" value="${esc(pricePreset(G.cfg, k))}" placeholder="—">`)).join('')}</div></div>
    <div class="gy-note">Shared with the team. A reminder pops up once a day on each device when someone's membership ends today or tomorrow.</div>`,
  { kind: 'cfg', onSave: m2 => {
    const n = Math.round(+fv(m2, 'soon')); if (!(n >= 0 && n <= 30)) { toast('Enter 0 to 30 days', 'warn'); return false; }
    const prices = {}; P.forEach(([k]) => { prices[k] = Math.max(0, +fv(m2, 'pr_' + k) || 0); });
    G.cfg = Object.assign({}, G.cfg, { soon: n, prices, by: me(), at: Date.now() });
    if (typeof fbSet === 'function') safe(() => fbSet(ROOT + '/cfg', G.cfg));
    toast('Saved ✓'); soon();
  } });
}

// ── taps on the page ──
function onClick(e) {
  safe(() => {
    const b = e.target.closest('[data-g]');
    const card = e.target.closest('.gy-card');
    if (!b) { if (card) openMember(card.dataset.id); return; }
    const a = b.dataset.g, id = b.dataset.id || (card && card.dataset.id);
    if (a === 'new') memberForm(null);
    else if (a === 'paste') pasteDialog('');
    else if (a === 'import') importDialog();
    else if (a === 'export') exportDialog();
    else if (a === 'cfg') settingsDialog();
    else if (a === 'st') { G.st = b.dataset.st; saveView(); render(); }
    else if (a === 'open' && id) openMember(id);
    else if (a === 'checkin' && id) checkIn(id);
    else if (a === 'extend' && id) extendDialog(id);
  });
}

// ── reminders: once a day on this device, and Ops Brain ──
function remind() {
  if (!G.loaded) return;
  if (typeof hoPanelAllowed === 'function' && !safe(() => hoPanelAllowed(PANEL), true)) return;
  const t = today(); if (LS.get('gym_remind_day', '') === t) return;
  const due = dueSoon(list(), t); if (!due.length) return;
  LS.set('gym_remind_day', t);
  toast(`🏋️ Gym & Pool: ${due.slice(0, 3).map(d => `${d.m.name} (${d.when})`).join(', ')}${due.length > 3 ? ` +${due.length - 3}` : ''} — membership ends`, 'warn');
}
const goGym = () => { if (typeof showPanel === 'function') showPanel(PANEL); };
(W.BL_THINKERS = W.BL_THINKERS || []).push(add => {
  if (!G.loaded || (typeof hoPanelAllowed === 'function' && !safe(() => hoPanelAllowed(PANEL), true))) return;
  const t = today(), due = dueSoon(list(), t); if (!due.length) return;
  add({ id: 'gymDue:' + t + ':' + due.map(d => d.m.id).join(','), type: 'gymDue', icon: '🏋️', tone: due.some(d => d.when === 'today') ? 'warn' : 'idle',
    text: `${due.length} gym / pool membership${due.length === 1 ? '' : 's'} end${due.length === 1 ? 's' : ''} soon: ${due.slice(0, 3).map(d => `${d.m.name} (${d.when})`).join(', ')}${due.length > 3 ? '…' : ''}.`,
    why: 'Ask if they want to extend, or remind them their access ends.',
    acts: [['Open Gym & Pool', () => { G.st = 'ending'; saveView(); goGym(); render(); }]] });
});
// Ops Brain answers "gym members ending" from the live list (brain.js reads window.BR_EXTRA)
(W.BR_EXTRA = W.BR_EXTRA || []).push(() => {
  if (!G.loaded) return [];
  const t = today(), all = list().filter(m => !m.del), soonL = sortMembers(all.filter(m => ['ending', 'active'].includes(statusOf(m, t, SOON())) && diffDays(t, m.end) <= 7), t, 'end');
  const exp = sortMembers(all.filter(m => statusOf(m, t, SOON()) === 'expired' && diffDays(m.end, t) <= 7), t, 'end');
  const li = m => `<li><b>${esc(fullName(m))}</b> · ${esc(TYPES[m.type] || '')}${m.room ? ' · room ' + esc(m.room) : ''} · ends ${esc(fmtD(m.end))} (${esc(countdown(m, t))})</li>`;
  const S = summary(all, t, SOON());
  return [{ id: 'gym:ending', kind: '🏋️ Gym & Pool', title: soonL.length ? `${soonL.length} gym / pool member${soonL.length === 1 ? '' : 's'} ending in the next 7 days` : 'No gym / pool membership ends in the next 7 days',
    body: (soonL.length ? `<ul>${soonL.slice(0, 10).map(li).join('')}</ul>` : '') + (exp.length ? `<div>Ended in the last 7 days:</div><ul>${exp.slice(0, 6).map(li).join('')}</ul>` : '') + `<div>Active now: ${S.active} · revenue this month AED ${esc(money(S.revenue))}.</div>`,
    text: 'gym pool members membership memberships ending expire expiring expired end soon renew extend who gym pool members ending this week', go: PANEL, boost: 1 }];
});

// ── live data ──
function startSync() {
  let tries = 0;
  const go = () => {
    if (typeof fbListen !== 'function') { G.members = LS.get('gym_members_local', {}) || {}; G.loaded = true; render(); return; }
    if (!dbRef() && ++tries <= 40) { setTimeout(go, 500); return; }
    fbListen(ROOT + '/members', v => {
      G.members = v && typeof v === 'object' ? Object.assign({}, v) : {}; G.loaded = true; soon();
      // members deleted on a device that closed before the Undo time was over
      safe(() => Object.keys(G.members).forEach(k => { const m = G.members[k]; if (m && m.del && Date.now() - (m.delAt || 0) > 60e3 && can('canDelete')) purge(k); }));
      setTimeout(() => safe(remind), 2500);
    });
    fbListen(ROOT + '/cfg', v => { G.cfg = v && typeof v === 'object' ? v : {}; soon(); });
  };
  go();
}

function mount() {
  if (doc.getElementById('panel-' + PANEL)) return;
  const main = doc.querySelector('main.main') || doc.querySelector('main');
  const nav = doc.querySelector('nav.sidenav') || doc.querySelector('nav');
  if (!main || !nav) { console.warn('[gym] app layout not found; panel not added'); return; }
  const st = doc.createElement('style'); st.id = 'gy-style'; st.textContent = CSS; doc.head.appendChild(st);
  const panel = doc.createElement('div'); panel.className = 'panel'; panel.id = 'panel-' + PANEL; panel.innerHTML = '<div id="gymRoot"></div>';
  main.appendChild(panel);
  panel.addEventListener('click', onClick);
  panel.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('gy-card')) openMember(e.target.dataset.id); });
  panel.addEventListener('input', e => { if (e.target.id === 'gyQ') { G.q = e.target.value; clearTimeout(G.qt); G.qt = setTimeout(render, 120); } });
  panel.addEventListener('change', e => safe(() => {
    const t = e.target;
    if (t.id === 'gyType') G.type = t.value; else if (t.id === 'gyKind') G.kind = t.value; else if (t.id === 'gyBy') G.by = t.value; else return;
    saveView(); render();
  }));

  const item = doc.createElement('div');
  item.className = 'nav-item'; item.id = 'nav-' + PANEL; item.dataset.panel = PANEL;
  item.setAttribute('onclick', "showPanel('" + PANEL + "')");
  item.innerHTML = '<div class="nav-icon">🏋️</div>Gym & Pool<span class="nav-badge" id="badge-' + PANEL + '" style="display:none"></span>';
  const anchor = doc.getElementById('nav-arrivals-proc') || doc.getElementById('nav-pipeline');
  if (anchor && anchor.parentNode === nav) anchor.after(item); else nav.appendChild(item);
  const grid = doc.querySelector('.mob-more-grid');
  if (grid) {
    const b = doc.createElement('button'); b.className = 'mob-more-item'; b.dataset.panel = PANEL; b.type = 'button';
    b.setAttribute('onclick', "showPanel('" + PANEL + "');(typeof closeMobMore==='function'?closeMobMore:typeof toggleMobMore==='function'?toggleMobMore:function(){})()");
    b.innerHTML = '<span class="mob-item-icon">🏋️</span><span class="mob-more-badge" id="mob-badge-' + PANEL + '"></span>Gym & Pool';
    const after = grid.querySelector('.mob-more-item[data-panel="pipeline"]') || grid.querySelector('.mob-more-item[data-panel="rates"]');
    if (after) after.after(b); else grid.appendChild(b);
  }
  if (typeof hoApplyIcons === 'function') safe(() => hoApplyIcons());
  // the front-desk roles see it by default (Team → Roles & access can change it)
  safe(() => {
    if (typeof ROLES !== 'undefined') ['owner', 'manager', 'supervisor', 'agent'].forEach(r => { const p = ROLES[r] && ROLES[r].panels; if (p && !p.includes(PANEL)) p.push(PANEL); });
    if (typeof currentProfile !== 'undefined' && currentProfile && typeof applyRole === 'function') applyRole(currentProfile.role);
  });
  let wasOn = false;
  new MutationObserver(() => { const on = panel.classList.contains('active'); if (on && !wasOn) render(); wasOn = on; }).observe(panel, { attributes: true, attributeFilter: ['class'] });
  // the day changes at midnight: statuses and countdowns move on
  setInterval(() => safe(() => { badge(); if (panel.classList.contains('active') && !doc.getElementById('gy-modal') && !(doc.activeElement && panel.contains(doc.activeElement) && /INPUT|SELECT|TEXTAREA/.test(doc.activeElement.tagName))) render(); remind(); }), 5 * 60e3);
  // Escape closes the window even when nothing in it has the focus
  doc.addEventListener('keydown', e => { if (e.key === 'Escape' && doc.getElementById('gy-modal') && !doc.querySelector('.gy-view')) closeModal(); });
  render(); startSync();
}

W.hoGym = { render: () => render(), open: openMember, paste: pasteDialog, add: pre => memberForm(null, pre), extend: (id, pre) => extendDialog(id, pre), exportExcel: scope => exportExcel(scope), exportPdf: scope => exportPdf(scope), proBytes: scope => proWorkbook(model(scope || 'all')), plainBytes: scope => plainWorkbook(model(scope || 'all')), importDialog, state: () => G, prepFile };
if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', mount); else mount();
})();
