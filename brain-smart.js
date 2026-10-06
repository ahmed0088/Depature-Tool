// ═══════════════════════════════════════════════════════════
//  brain-smart.js — Ops Brain, sharper
//
//   • Reads your data and answers questions about it:
//       "how many arrivals from France", "who has no email",
//       "which rooms are leisure", "guests staying more than 5 nights",
//       "nationality breakdown", "arrivals by source", "average nights",
//       "who checked out", "rooms that owe money", "late check-outs".
//     Each answer has the list, a Copy button (for Excel) and Open page.
//   • Understands typos ("arivals", "natonality", "chekout").
//   • Remembers what you were talking about: after "room 512",
//     "check it out" or "what about 513?" just work.
//   • Several jobs in one line: "guess nationalities then remove
//     duplicates and brief me".
//   • Notices more by itself: OTA relay emails, emails that can't be
//     right, a nationality that doesn't fit the name, the same guest in
//     two rooms, stays longer than the Tourism Dirham cap, a checked-out
//     room that still owes money.
//
//  Everything stays inside this hotel's own data.
// ═══════════════════════════════════════════════════════════

let bsCtx = { room: '', lastQ: '', lastKind: '' };
let bsLastRows = [];

// ── Typos ────────────────────────────────────────────────
const BS_VOCAB = ['arrivals', 'arrival', 'departures', 'departure', 'nationality', 'nationalities', 'purpose', 'checkout', 'checked', 'checkin',
  'business', 'leisure', 'flight', 'email', 'emails', 'origin', 'nights', 'guests', 'guest', 'rooms', 'room', 'source', 'booking', 'expedia',
  'duplicates', 'duplicate', 'breakdown', 'average', 'missing', 'without', 'package', 'packages', 'balance', 'tourism', 'dirham', 'reconciliation',
  'checklist', 'remove', 'guess', 'brief', 'report', 'history', 'leaving', 'staying', 'country', 'countries', 'commission', 'noshow', 'noshows', 'everything',
  // everyday words that must stay as they are
  'night', 'audit', 'shift', 'check', 'card', 'cards', 'late', 'early', 'plan', 'note', 'notes', 'call', 'wake', 'work', 'does', 'what', 'when', 'where', 'there', 'their', 'with', 'this', 'that', 'have', 'need', 'help', 'guest', 'angry', 'upset', 'refund', 'charge', 'cancel', 'extend', 'move', 'lost', 'fire', 'alarm', 'taxi', 'luggage', 'phone', 'group', 'remind', 'handover', 'thanks', 'hello', 'should', 'would', 'could', 'about', 'after', 'before', 'today', 'tonight', 'tomorrow', 'last', 'month', 'swap', 'cover', 'sick', 'wants', 'asks',
  'shifts', 'working', 'works', 'worked', 'roster', 'rosters', 'schedule', 'duty', 'week', 'weekend'];
function _bsLev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
function bsFixTypos(q) {
  return String(q).replace(/[a-z]{4,}/gi, w => {
    const lw = w.toLowerCase();
    if (BS_VOCAB.includes(lw)) return w;
    let best = null, bd = 9;
    for (const v of BS_VOCAB) { const d = _bsLev(lw, v); if (d < bd) { bd = d; best = v; } }
    return bd <= (lw.length >= 7 ? 2 : 1) ? best : w;
  }).replace(/\bcheck ?outs?\b/gi, 'checkout').replace(/\bcheck ?ins?\b/gi, 'checkin');
}

// ── What we were talking about ───────────────────────────
function bsWithContext(q) {
  const room = (q.match(/\b(\d{3,4})\b/) || [])[1];
  if (room) bsCtx.room = room;
  if (!room && bsCtx.room && /\b(it|him|her|them|that room|this room|the room|same room|this guest|that guest)\b/i.test(q))
    return q.replace(/\b(that room|this room|the room|same room|this guest|that guest|it|him|her|them)\b/i, 'room ' + bsCtx.room);
  // "what about 513?" / "and 513?" → the last question, with the new room
  const m = q.match(/^(?:and|what about|how about|same for)\s+(?:room\s*)?(\d{3,4})\s*\??$/i);
  if (m && bsCtx.lastQ) { bsCtx.room = m[1]; return bsCtx.lastQ.replace(/\b\d{3,4}\b/, m[1]); }
  return q;
}

// ── Questions about your data ────────────────────────────
const BS_DEMONYM = { french: 'france', british: 'united kingdom', english: 'united kingdom', german: 'germany', russian: 'russia', indian: 'india',
  chinese: 'china', saudi: 'saudi', emirati: 'emirates', egyptian: 'egypt', pakistani: 'pakistan', filipino: 'philippines', american: 'united states',
  italian: 'italy', spanish: 'spain', turkish: 'turkey', iranian: 'iran', iraqi: 'iraq', jordanian: 'jordan', lebanese: 'lebanon', kuwaiti: 'kuwait',
  omani: 'oman', qatari: 'qatar', bahraini: 'bahrain', kazakh: 'kazakhstan', uzbek: 'uzbekistan', nigerian: 'nigeria', kenyan: 'kenya',
  japanese: 'japan', korean: 'korea', australian: 'australia', canadian: 'canada', dutch: 'netherlands', polish: 'poland', ukrainian: 'ukraine',
  brazilian: 'brazil', moroccan: 'morocco', sri: 'sri lanka', bangladeshi: 'bangladesh', nepali: 'nepal', syrian: 'syria', sudanese: 'sudan' };

function _bsSets() {
  const s = [];
  if (typeof arrGuests !== 'undefined' && arrGuests.length) s.push({ k: 'arrivals', page: 'arrivals', label: 'arrivals', rows: arrGuests });
  if (typeof purposeGuests !== 'undefined' && purposeGuests.length) s.push({ k: 'purpose', page: 'purpose', label: 'Purpose of Stay guests', rows: purposeGuests });
  if (typeof depRooms !== 'undefined' && depRooms.length) s.push({ k: 'departures', page: 'departures', label: 'departures', rows: depRooms.map(r => Object.assign({ room: r.roomStr }, r)) });
  if (typeof nsGuests !== 'undefined' && nsGuests.length) s.push({ k: 'noshow', page: 'noshow', label: 'no-shows', rows: nsGuests.map(g => ({ name: g.nameRaw, conf: g.confNo, source: g.company })) });
  if (typeof pkgResults !== 'undefined' && pkgResults.length) s.push({ k: 'packages', page: 'package-audit', label: 'package lines', rows: pkgResults.filter(r => !r.pinSkip) });
  return s;
}
function _bsPickSet(q, sets) {
  const want = /depart|checkout|leaving|late|owe|balance|checked|dnd|due out|extended/i.test(q) ? 'departures'
    : /no.?show/i.test(q) ? 'noshow' : /package|upsell|seller|commission|deny|credit/i.test(q) ? 'packages'
    : /purpose|origin/i.test(q) ? 'purpose' : /arriv|checkin|coming|in.?house/i.test(q) ? 'arrivals' : null;
  return sets.find(s => s.k === want) || (want ? null : sets.find(s => s.k === 'arrivals') || sets.find(s => s.k === 'purpose') || sets[0]);
}

function bsQuery(raw) {
  const q = raw.toLowerCase();
  if (typeof roIsQuestion === 'function' && roIsQuestion(q)) return null;   // a roster question, not about guests
  // a plain question, or a phrase like "french guests" / "arrivals without email"
  const asked = !!(/^(how many|how much|which|who|whom|list|show|find|count|what rooms|any |are there|give me|top |average|avg |breakdown|by |nationality breakdown|guests? (from|with|without|staying)|rooms? (that|with|without))/.test(q)
      || /\b(breakdown|how many|who has|who is|who are|by nationality|by source|by purpose|average nights)\b/.test(q));
  const noun = /\b(guests?|arrivals?|rooms?|departures?|people|bookings?|reservations?)\b/.test(q);
  if (!asked && !noun) return null;
  const sets = _bsSets();
  if (!sets.length) return !asked ? null : { html: `<div class="br-title">No data loaded yet.</div><div class="br-body">Load today's arrivals, departures or Purpose of Stay and ask again.</div>` };
  const set = _bsPickSet(q, sets);
  if (!set) return { html: `<div class="br-title">That list isn't loaded.</div><div class="br-body">Load it first, then ask again.</div>` };
  let rows = set.rows.slice();
  const why = [];

  // filters
  const nats = [...new Set(rows.map(r => String(r.nat || '').trim()).filter(Boolean))];
  const natWanted = [];
  Object.entries(BS_DEMONYM).forEach(([d, c]) => { if (new RegExp('\\b' + d).test(q)) natWanted.push(c); });
  nats.forEach(n => { const ln = n.toLowerCase(); if (ln.length > 2 && q.includes(ln)) natWanted.push(ln); });
  if (natWanted.length && !/without|no nationality|missing nationality/.test(q)) {
    rows = rows.filter(r => natWanted.some(w => String(r.nat || '').toLowerCase().includes(w.slice(0, Math.max(4, w.length - 2)))));
    why.push('from ' + [...new Set(natWanted)].join(' / '));
  }
  const srcs = [...new Set(rows.map(r => String(r.source || '').trim()).filter(Boolean))];
  const srcHit = srcs.filter(s => { const ls = s.toLowerCase().replace(/\.com$/, ''); return ls.length > 3 && q.includes(ls); });
  if (srcHit.length) { rows = rows.filter(r => srcHit.includes(String(r.source || '').trim())); why.push('via ' + srcHit.join(' / ')); }
  else if (typeof sourceCategory === 'function') {
    const cat = /\bota\b|online/.test(q) ? 'ota' : /walk.?in/.test(q) ? 'walkin' : /corporate|company/.test(q) ? 'corporate' : /all app|accor app/.test(q) ? 'allapp' : null;
    if (cat) { rows = rows.filter(r => sourceCategory(r.source) === cat); why.push('booked ' + cat); }
  }
  ['business', 'leisure', 'flight'].forEach(p => { if (new RegExp('\\b' + p).test(q) && !/breakdown|by purpose/.test(q)) { rows = rows.filter(r => String(r.purpose || '').toLowerCase() === p); why.push(p); } });
  if (/(without|no|missing|empty) (an? )?e-?mails?/.test(q)) { rows = rows.filter(r => !r.email || !String(r.email).includes('@')); why.push('without email'); }
  else if (/with (an? )?e-?mails?|have e-?mails?/.test(q)) { rows = rows.filter(r => r.email && String(r.email).includes('@')); why.push('with email'); }
  if (/(without|no|missing|empty) nationalit/.test(q)) { rows = rows.filter(r => !r.nat); why.push('without nationality'); }
  if (/(without|no|missing|empty) origin/.test(q)) { rows = rows.filter(r => !r.originOfTravel); why.push('without origin'); }
  const nm = q.match(/(more than|over|at least|less than|under|exactly)?\s*(\d{1,3})\+?\s*nights?/);
  if (nm) {
    const n = +nm[2], op = nm[1] || 'exactly';
    rows = rows.filter(r => { const v = +r.nights || 0; return op === 'more than' || op === 'over' ? v > n : op === 'at least' ? v >= n : op === 'less than' || op === 'under' ? v < n : v === n; });
    why.push(`${op === 'exactly' ? '' : op + ' '}${n} night${n === 1 ? '' : 's'}`);
  } else if (/long stay/.test(q)) { rows = rows.filter(r => (+r.nights || 0) >= 7); why.push('7+ nights'); }
  if (set.k === 'departures') {
    const st = /checked out|\bout\b/.test(q) ? 'out' : /\blate\b/.test(q) ? 'late' : /\bdnd\b/.test(q) ? 'dnd' : /no answer|\bna\b/.test(q) ? 'na' : /extended|extension/.test(q) ? 'extended' : /\bdue\b|still (here|in)|not (yet )?out/.test(q) ? 'due' : null;
    if (st) { rows = rows.filter(r => r.status === st); why.push(st === 'out' ? 'checked out' : st); }
    if (/owe|balance|unpaid|pay/.test(q)) { rows = rows.filter(r => r.balance > 0); why.push('with a balance'); }
    if (/\bvip/.test(q)) { rows = rows.filter(r => r.isVip); why.push('VIP'); }
  }
  if (set.k === 'packages') {
    const v = /deny|remove/.test(q) ? 'deny' : /credit|ok|fine/.test(q) ? 'credit' : /review|check/.test(q) ? 'review' : null;
    if (v) { rows = rows.filter(r => r.verdict === v); why.push(v); }
  }
  const room = (q.match(/\b(\d{3,4})\b/) || [])[1];
  if (room && !nm) { rows = rows.filter(r => String(r.room || '').trim() === room); why.push('room ' + room); }

  if (!asked && !why.length && !/breakdown|by (nationality|source|purpose|seller)|average/.test(q)) return null;
  const scope = `${set.label}${why.length ? ' ' + why.join(', ') : ''}`;
  const key = set.k === 'packages' ? r => r.employee || r.user || 'Unassigned' : null;

  // breakdowns
  const by = /breakdown|by nationality|per nationality|top nationalit|which nationalit|countries/.test(q) ? 'nat'
    : /by source|per source|which source|channels?/.test(q) ? 'source' : /by purpose|purpose breakdown/.test(q) ? 'purpose'
    : /by seller|per seller|who sold/.test(q) && set.k === 'packages' ? 'seller' : null;
  if (by) {
    const g = {};
    rows.forEach(r => { const k = by === 'seller' ? key(r) : by === 'source' && typeof sourceCategory === 'function' && /channel/.test(q) ? (SOURCE_CATEGORIES[sourceCategory(r.source)] || {}).label || 'Other' : (r[by === 'nat' ? 'nat' : by] || 'Not filled in'); g[k] = (g[k] || 0) + 1; });
    const list = Object.entries(g).sort((a, b) => b[1] - a[1]);
    bsLastRows = list.map(([k, n]) => [k, n]);
    return { html: `<div class="br-kind">📊 From your data</div><div class="br-title">${escapeHtml(scope)} by ${by === 'nat' ? 'nationality' : by}</div>
      <div class="bs-bars">${list.slice(0, 15).map(([k, n]) => `<div class="bs-bar"><span>${escapeHtml(String(k))}</span><i style="width:${Math.round(n / list[0][1] * 100)}%"></i><b>${n}</b></div>`).join('')}</div>
      <div class="br-acts"><button class="btn sm" onclick="bsCopy(this, true)">📋 Copy for Excel</button><button class="btn sm ghost" onclick="brClose();showPanel('${set.page}')">Open ${escapeHtml(set.label)}</button></div>`, page: set.page };
  }
  if (/average|avg|mean/.test(q) && /night/.test(q)) {
    const v = rows.map(r => +r.nights || 0).filter(n => n > 0);
    const avg = v.length ? (v.reduce((a, b) => a + b, 0) / v.length) : 0;
    return { html: `<div class="br-kind">📊 From your data</div><div class="br-title">Average stay: ${avg.toFixed(1)} nights</div><div class="br-body">Across ${v.length} ${escapeHtml(scope)}. Longest: ${Math.max(0, ...v)} nights.</div>` };
  }

  bsLastRows = rows;
  const cols = set.k === 'departures' ? r => [r.room, r.name, r.status + (r.balance > 0 ? ' · owes AED ' + r.balance : '') + (r.lateTime ? ' · LCO ' + r.lateTime : '')]
    : set.k === 'packages' ? r => [r.room, r.family || r.code, r.verdict + (r.employee ? ' · ' + r.employee : '')]
    : set.k === 'noshow' ? r => [r.conf, r.name, r.source || '']
    : r => [r.room, r.name, [r.nat || 'no nationality', r.purpose, r.nights ? r.nights + 'n' : '', r.email ? '' : 'no email'].filter(Boolean).join(' · ')];
  if (rows.length === 1 && rows[0].room) bsCtx.room = String(rows[0].room);
  return { html: `<div class="br-kind">📊 From your data</div>
    <div class="br-title">${rows.length} ${escapeHtml(scope)}</div>
    ${rows.length ? `<div class="bs-list">${rows.slice(0, 40).map(r => { const c = cols(r); return `<div class="bs-li"><b>${escapeHtml(String(c[0] || ''))}</b><span>${escapeHtml(String(c[1] || ''))}</span><small>${escapeHtml(String(c[2] || ''))}</small></div>`; }).join('')}</div>${rows.length > 40 ? `<div class="br-body">…and ${rows.length - 40} more (Copy gets them all).</div>` : ''}` : ''}
    <div class="br-acts">${rows.length ? '<button class="btn sm" onclick="bsCopy(this)">📋 Copy for Excel</button>' : ''}<button class="btn sm ghost" onclick="brClose();showPanel('${set.page}')">Open ${escapeHtml(set.label)}</button></div>`, page: set.page };
}

function bsCopy(btn, grouped) {
  const tsv = grouped ? bsLastRows.map(r => r.join('\t')).join('\n')
    : ['Room\tName\tNationality\tPurpose\tNights\tEmail\tSource'].concat(bsLastRows.map(r => [r.room || r.roomStr || r.conf || '', r.name || r.nameRaw || '', r.nat || '', r.purpose || r.status || r.verdict || '', r.nights || '', r.email || '', r.source || ''].join('\t'))).join('\n');
  copyToClipboard(tsv, btn, '📋 Copy for Excel');
}

// ── Several jobs in one line ─────────────────────────────
function bsSplit(q) {
  const parts = q.split(/\s*(?:;|,?\s*\band then\b|,?\s*\bthen\b|,?\s*\band also\b)\s*/i).filter(Boolean);
  // "guess nationalities and remove duplicates" — split on "and" only if every half is a command
  const isCmd = p => typeof BA_COMMANDS !== 'undefined' && BA_COMMANDS.some(c => c.re.test(p.trim()));
  return parts.flatMap(part => { const a = part.split(/\s+and\s+/i); return a.length > 1 && a.every(isCmd) ? a : [part]; });
}

// ── Plug in front of the brain ───────────────────────────
function bsAsk(raw, inner) {
  let q = bsWithContext(bsFixTypos(String(raw || '').trim()));
  const _norm = s => String(s || '').trim().replace(/\bcheck ?outs?\b/gi, 'checkout').replace(/\bcheck ?ins?\b/gi, 'checkin');
  const fixed = bsFixTypos(String(raw || '').trim()) !== _norm(raw);
  const parts = bsSplit(q);
  const box = document.getElementById('brAnswers');
  if (parts.length > 1) {
    const outs = [];
    parts.forEach(p => { inner(p); outs.push(`<div class="bs-step"><span>▸ ${escapeHtml(p)}</span>${box ? box.innerHTML : ''}</div>`); });
    if (box) box.innerHTML = `<div class="br-kind">🤖 ${parts.length} jobs, in order</div>` + outs.join('');
    bsCtx.lastQ = parts[parts.length - 1];
    return;
  }
  const data = bsQuery(q);
  if (data && box) {
    brTabShow('think');
    box.innerHTML = `<div class="br-card bs-ans">${fixed ? `<div class="bs-heard">I read that as: “${escapeHtml(q)}”</div>` : ''}${data.html}</div>`;
    bsCtx.lastQ = q;
    if (typeof logActivity === 'function') try { logActivity('brain_ask', q.slice(0, 120)); } catch (_) {}
    return;
  }
  bsCtx.lastQ = q;
  inner(q);
  if (fixed && box && !box.querySelector('.bs-heard')) box.insertAdjacentHTML('afterbegin', `<div class="bs-heard">I read that as: “${escapeHtml(q)}”</div>`);
}

// ── More things it notices by itself ─────────────────────
const BS_OTA_RE = /@(guest\.)?(booking\.com|m\.expediapartnercentral\.com|expediapartnercentral\.com|agoda-messaging\.com|guest\.trip\.com|messages\.airbnb\.com|hotels\.com)$/i;
(window.BL_THINKERS = window.BL_THINKERS || []).push(add => {
  const G = (typeof arrGuests !== 'undefined' ? arrGuests : []);
  if (!G.length) return;
  const ota = G.filter(g => BS_OTA_RE.test(String(g.email || '').trim()));
  if (ota.length) add({ id: 'otaMail:' + ota.length, type: 'otaMail', icon: '📮', tone: 'warn', text: `${ota.length} arrival${ota.length > 1 ? 's have' : ' has'} a Booking/Expedia relay email, not the guest's own.`,
    why: 'Ask for the real email at check-in, or the ALL invitation goes nowhere. Rooms ' + ota.slice(0, 5).map(g => g.room).join(', '), acts: [['Show me', () => showPanel('arrivals')]] });
  const bad = G.filter(g => g.email && /@/.test(g.email) && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(g.email).trim()));
  if (bad.length) add({ id: 'badMail:' + bad.length, type: 'badMail', icon: '✉️', tone: 'warn', text: `${bad.length} email${bad.length > 1 ? 's look' : ' looks'} wrong (room ${bad.slice(0, 4).map(g => g.room).join(', ')}).`,
    why: 'A missing dot or a space; Guest Pipeline fixes common typos like gmial.com.', acts: [['Show me', () => showPanel('arrivals')]] });
  const seen = {}, twice = [];
  G.forEach(g => { const k = String(g.name || '').trim().toUpperCase(); if (!k || k === '—') return; if (seen[k] && seen[k] !== g.room) twice.push(`${g.name} (${seen[k]} & ${g.room})`); else seen[k] = g.room; });
  if (twice.length) add({ id: 'twoRooms:' + twice.length, type: 'twoRooms', icon: '🔁', tone: 'idle', text: `Same guest name in two rooms: ${twice.slice(0, 2).join(', ')}${twice.length > 2 ? '…' : ''}.`,
    why: 'A group or family is fine; otherwise it may be a duplicate reservation.', acts: [['Show me', () => showPanel('arrivals')]] });
  if (typeof guessNat === 'function') {
    const mism = G.filter(g => { if (!g.nat || g._natFromAI) return false; const s = guessNat(g.name); return s && s.toLowerCase().slice(0, 5) !== String(g.nat).toLowerCase().slice(0, 5) && !/emirat|uae/i.test(g.nat); }).slice(0, 6);
    if (mism.length >= 1) add({ id: 'natOdd:' + mism.map(g => g.room).join(','), type: 'natOdd', icon: '🛂', tone: 'idle', text: `Nationality to double-check for room${mism.length > 1 ? 's' : ''} ${mism.map(g => g.room).join(', ')}.`,
      why: 'The name usually belongs to another country. Often fine (dual nationals); worth a look at the passport.', acts: [['Show me', () => showPanel('arrivals')]] });
  }
  const cap = typeof HotelCfg !== 'undefined' ? HotelCfg.cap() : 30;
  const longS = G.filter(g => +g.nights > cap);
  if (longS.length) add({ id: 'tdCap:' + longS.length, type: 'tdCap', icon: '🧾', tone: 'idle', text: `${longS.length} arrival${longS.length > 1 ? 's stay' : ' stays'} more than ${cap} nights (room ${longS.slice(0, 4).map(g => g.room).join(', ')}).`,
    why: `Tourism Dirham stops after night ${cap}. TD 30-Day Audit catches any extra charges later.`, acts: [['Open TD Audit', () => showPanel('td-audit')]] });
});
(window.BL_THINKERS = window.BL_THINKERS || []).push(add => {
  const D = (typeof depRooms !== 'undefined' ? depRooms : []);
  const owed = D.filter(r => r.status === 'out' && r.balance > 0);
  if (owed.length) add({ id: 'outOwe:' + owed.map(r => r.roomStr).join(','), type: 'outOwe', icon: '💸', tone: 'bad', text: `Checked out but still owing: room${owed.length > 1 ? 's' : ''} ${owed.slice(0, 4).map(r => `${r.roomStr} (AED ${r.balance})`).join(', ')}.`,
    why: 'Settle or transfer the balance in Opera before the night audit.', acts: [['Open Departures', () => showPanel('departures')]] });
});

// ── Answers about the brain itself ───────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    const inner = window.brAsk;
    if (typeof inner === 'function' && !inner.__bs) {
      window.brAsk = function (q) { return bsAsk(q, inner); };
      window.brAsk.__bs = true;
    }
    // more ready-made questions under the ask box
    const chips = document.querySelector('.ba-chips');
    if (chips && !chips.dataset.bs) {
      chips.dataset.bs = '1';
      ['who has no email', 'nationality breakdown', 'arrivals by source', 'rooms that owe money'].forEach(x => chips.insertAdjacentHTML('beforeend', `<button onclick="document.getElementById('brQ').value='${x}';brAsk('${x}')">${x}</button>`));
    }
  }, 2600);
  // the chips row is built when the panel first opens: add ours then too
  const b = window.brBuild;
  if (typeof b === 'function') window.brBuild = function () { b(); setTimeout(() => {
    const chips = document.querySelector('.ba-chips');
    if (chips && !chips.dataset.bs) { chips.dataset.bs = '1'; ['who has no email', 'nationality breakdown', 'arrivals by source', 'rooms that owe money'].forEach(x => chips.insertAdjacentHTML('beforeend', `<button onclick="document.getElementById('brQ').value='${x}';brAsk('${x}')">${x}</button>`)); }
  }, 60); };
});
