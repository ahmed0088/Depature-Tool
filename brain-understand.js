// ═══════════════════════════════════════════════════════════
//  brain-understand.js — Ops Brain understands plain talk
//  No commands to remember: "can u keep souptik away from mr ali pls",
//  "ahmed not coming tmrw", "manisha dont want nights anymore". It finds
//  the names (even misspelt), the day, the shift and what you want, says
//  "I understood: …" and does it. Not sure? "Did you mean…" buttons, and
//  the one you tap is learnt for next time. Quick buttons under the box
//  do the common things with a tap and two pickers. Free, on the device.
// ═══════════════════════════════════════════════════════════

const BU_TYPO = {
  roaster: 'roster', rooster: 'roster', rosta: 'roster', tommorow: 'tomorrow', tomorow: 'tomorrow', tmrw: 'tomorrow', tmr: 'tomorrow', tmrow: 'tomorrow', tomorrw: 'tomorrow',
  tdy: 'today', tonite: 'tonight', togther: 'together', togeather: 'together', toghether: 'together', togather: 'together', shif: 'shift', shifs: 'shifts', shfit: 'shift',
  nigth: 'night', nite: 'night', nigths: 'nights', nites: 'nights', mornig: 'morning', moring: 'morning', mornings: 'mornings', evning: 'evening', evenning: 'evening',
  frday: 'friday', firday: 'friday', fri: 'friday', satarday: 'saturday', sat: 'saturday', sun: 'sunday', mon: 'monday', tue: 'tuesday', tues: 'tuesday', wed: 'wednesday', wensday: 'wednesday', wedensday: 'wednesday', thu: 'thursday', thurs: 'thursday', thrusday: 'thursday', tuseday: 'tuesday',
  vacaion: 'vacation', vaction: 'vacation', vacasion: 'vacation', holliday: 'holiday', sik: 'sick', seck: 'sick', sic: 'sick', u: 'you', ur: 'your', r: 'are', dont: "don't", doesnt: "doesn't", cant: "can't", wont: "won't", isnt: "isn't",
  plz: '', pls: '', please: '', bro: '', kindly: '', habibi: '', yalla: '', okay: '', ok: '',
};
const BU_STOP = new Set(['and', 'with', 'or', 'the', 'on', 'in', 'at', 'is', 'are', 'to', 'from', 'a', 'an', 'mr', 'mrs', 'ms', 'miss', 'sir', 'madam', 'for', 'of', 'my', 'me', 'i', 'we', 'he', 'she', 'they', 'them', 'him', 'her', 'his', 'not', 'no', 'never', 'away', 'keep', 'put', 'make', 'same', 'shift', 'shifts', 'off', 'day', 'days', 'week', 'night', 'nights', 'morning', 'mornings', 'evening', 'evenings', 'sick', 'today', 'tomorrow', 'tonight', 'who', 'what', 'if', 'can', 'you', 'together', 'apart', 'avoid', 'want', 'wants', 'need', 'needs', 'work', 'works', 'working', 'all', 'any', 'this', 'next', 'last', 'be', 'it', 'will', 'should', 'always']);
const BU_NEG = /\b(avoid|apart|separate|separately|away|not|never|no|don't|doesn't|won't|can't|cannot|shouldn't|mustn't|without|hate|hates|stop|less|fewer|problem|problems|fight|fighting|issue|issues|conflict)\b/;

/** Clean what was typed: small letters, common typos fixed, filler words gone. */
function buNorm(q) {
  let t = ' ' + String(q || '').toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z0-9:'\-\s/]/g, ' ') + ' ';
  t = t.split(/\s+/).map(w => (w in BU_TYPO ? BU_TYPO[w] : w)).join(' ');
  t = t.replace(/\b(hey|hi|hello|so|also|btw|ops brain|brain|can you|could you|would you|will you|i want you to|i'd like to|i would like to|i want to|i need you to|i need to|we need to|we have to|we want to|let's|make sure|make it so|is it possible to|try to|try)\b/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}
function _buLev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return m[a.length][b.length];
}
/** The team members named in the text (also misspelt: "souptk" → Souptik), in the order they come. */
function buNames(t) {
  if (typeof roStaff === 'undefined') return [];
  const staff = Object.keys(roStaff).filter(k => !((typeof rbPeople !== 'undefined' && rbPeople[k]) || {}).deleted).map(k => ({ k, parts: String(roStaff[k].name || '').toLowerCase().replace(/[^a-z\s'-]/g, ' ').split(/\s+/).filter(Boolean) }));
  const words = t.split(' '), out = [], used = new Set();
  const close = (w, p) => w === p || (w.length >= 4 && p.length >= 4 && _buLev(w, p) <= (w.length >= 7 ? 2 : 1)) || (w.length >= 4 && p.startsWith(w));
  for (let i = 0; i < words.length; i++) {
    const w = words[i]; if (w.length < 3 || BU_STOP.has(w) || /\d/.test(w)) continue;
    // two words that are one person's first and last name first ("ali mirza")
    const w2 = words[i + 1] || '';
    let hit = w2 && !BU_STOP.has(w2) ? staff.filter(s => s.parts.length > 1 && close(w, s.parts[0]) && s.parts.slice(1).some(p => close(w2, p))) : [];
    let len = hit.length ? 2 : 1;
    if (!hit.length) hit = staff.filter(s => s.parts.some(p => w === p));
    if (!hit.length) hit = staff.filter(s => s.parts.some(p => close(w, p)));
    hit = hit.filter(s => !used.has(s.k));
    if (!hit.length) continue;
    if (hit.length === 1) { used.add(hit[0].k); out.push({ k: hit[0].k, i, word: w }); }
    else out.push({ k: null, any: hit.map(s => s.k), i, word: w });
    i += len - 1;
  }
  return out;
}
const BU_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
function buDay(t) {
  let m;
  if (/\btonight\b/.test(t)) return 'tonight';
  if (/\btoday\b|\bnow\b/.test(t)) return 'today';
  if (/\btomorrow\b/.test(t)) return 'tomorrow';
  if (/\bnext week\b/.test(t)) return 'next week';
  if (/\bthis week\b/.test(t)) return 'this week';
  if ((m = t.match(/\b(next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/))) return (m[1] ? 'next ' : '') + m[2].charAt(0).toUpperCase() + m[2].slice(1);
  if ((m = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/))) return `on ${m[1]} ${m[2].charAt(0).toUpperCase() + m[2].slice(1)}`;
  if ((m = t.match(/\b(\d{1,2})\/(\d{1,2})\b/))) return `on ${m[1]}/${m[2]}`;
  return '';
}
function buBand(t) {
  if (/\bnights?\b|\bnight shift|\bovernight\b/.test(t)) return 'nights';
  if (/\bmornings?\b|\bearly\b/.test(t)) return 'mornings';
  if (/\bevenings?\b|\bafternoons?\b|\blate shift/.test(t)) return 'evenings';
  if (/\bday shifts?\b|\bdays\b/.test(t)) return 'day shifts';
  return '';
}
function buHotel(t) { if (typeof roGroups !== 'function') return ''; return roGroups().find(g => t.includes(g.toLowerCase().split(' ')[0])) || ''; }
function buTitle(t) { if (typeof rtTitleWord !== 'function') return null; const m = t.match(/\b(trainees?|interns?|bell\s*boys?|supervisors?|team\s*leaders?|agents?|receptionists?|duty\s*managers?|night\s*auditors?|managers?)\b/); return m ? rtTitleWord(m[1]) : null; }
const _buN = k => typeof rtName === 'function' ? rtName(k) : ((roStaff[k] || {}).name || k);

/** What each request looks like: test(ctx) → the sentence the app already knows, or null. */
const BU_INTENTS = [
  { id: 'apart', ico: '↔️', label: 'Keep two apart', need: { n: 2 }, test: c => c.n.length >= 2 && (BU_NEG.test(c.t) || /\bapart\b/.test(c.t)) && !/\b(swap|switch|exchange|trade)\b/.test(c.t), make: c => `avoid ${c.N[0]} with ${c.N[1]}` },
  { id: 'with', ico: '🤝', label: 'Always together', need: { n: 2 }, test: c => c.n.length >= 2 && !BU_NEG.test(c.t) && /\b(together|with|same shift|pair|partner|train|trains|training)\b/.test(c.t) && !/\b(swap|switch|exchange|trade)\b/.test(c.t), make: c => `${c.N[0]} always with ${c.N[1]}` },
  { id: 'swap', ico: '🔁', label: 'Swap shifts', need: { n: 2, day: 1 }, test: c => c.n.length >= 2 && /\b(swap|switch|exchange|trade|change)\b/.test(c.t), make: c => `swap ${c.N[0]} and ${c.N[1]} on ${(c.day || 'tomorrow').replace(/^on /, '')}` },
  { id: 'whatif', ico: '🤔', label: 'What if…', need: { n: 1, day: 1 }, test: c => c.n.length >= 1 && /\b(what if|what happens|suppose|imagine)\b/.test(c.t), make: c => /\b(off|rest)\b/.test(c.t) ? `what if ${c.N[0]} takes ${c.day && c.day !== 'today' ? c.day.replace(/^on /, '') : 'tomorrow'} off` : /\b(leave|vacation|holiday)\b/.test(c.t) ? `what if ${c.N[0]} is on leave ${c.day || 'next week'}` : `what if ${c.N[0]} is sick ${c.day || 'tomorrow'}` },
  { id: 'sick', ico: '🤒', label: 'Someone is sick', need: { n: 1, day: 1 }, test: c => c.n.length >= 1 && /\b(sick|ill|unwell|not coming|won't come|can't come|absent|called in|call in|fever|hospital|doctor|not feeling|emergency)\b/.test(c.t), make: c => `${c.N[0]} is sick ${c.day || 'today'}${c.span}` },
  { id: 'leave', ico: '🌴', label: 'Vacation / leave', need: { n: 1, day: 1 }, test: c => c.n.length >= 1 && /\b(vacation|annual leave|on leave|holiday|travel|travelling|going home)\b/.test(c.t) && !/\b(balance|left|how many|how much|remaining)\b/.test(c.t), make: c => `${c.N[0]} is on vacation ${c.day || 'today'}${c.span}` },
  { id: 'balance', ico: '🧮', label: 'Vacation balance', need: {}, test: c => /\b(balance|left|how many|how much|remaining)\b/.test(c.t) && /\b(vacation|leave|annual|holiday|al)\b/.test(c.t), make: c => c.n.length ? `vacation balance of ${c.N[0]}` : 'vacation balance' },
  { id: 'noGo', ico: '🚫', label: 'Never to a hotel', need: { n: 1, hotel: 1 }, test: c => c.n.length >= 1 && !!c.hotel && BU_NEG.test(c.t) && /\b(send|sent|move|moved|go|goes|work|put|lend)\b/.test(c.t), make: c => `never send ${c.N[0]} to ${c.hotel}`, run: c => buNoGo(c.n[0], c.hotel) },
  { id: 'lock', ico: '🏨', label: 'Stays in their hotel', need: { n: 1 }, test: c => c.n.length >= 1 && !c.hotel && /\b(stay|stays|keep|lock|only)\b/.test(c.t) && /\b(hotel|home|own)\b/.test(c.t), make: c => `lock ${c.N[0]} in his hotel` },
  { id: 'prefNot', ico: '⚠', label: 'Prefers not a shift', need: { n: 1, band: 1 }, test: c => c.n.length >= 1 && !!c.band && (BU_NEG.test(c.t) || /\b(prefer not|tired of|no more|anymore)\b/.test(c.t)), make: c => `${c.N[0]} prefers not ${c.band === 'day shifts' ? 'days' : c.band}` },
  { id: 'dayoff', ico: '🛋', label: 'Day off request', need: { n: 1, day: 1 }, test: c => c.n.length >= 1 && /\b(off|day off|rest|free)\b/.test(c.t) && !c.band, make: c => `${c.N[0]} wants ${(c.day && !/today|tonight/.test(c.day) ? c.day : 'Friday').replace(/^on /, '').replace(/^next /, '')} off` },
  { id: 'titleNo', ico: '🎓', label: 'A title never on a shift', need: { title: 1, band: 1 }, test: c => !c.n.length && !!c.title && !!c.band && BU_NEG.test(c.t), make: c => `${c.title.toLowerCase()}s never on ${c.band}` },
  { id: 'lastweek', ico: '📜', label: 'What someone worked', need: { n: 1 }, test: c => c.n.length === 1 && /\b(last week|worked|history|what did|schedule|shifts)\b/.test(c.t), make: c => `${c.N[0]} last week` },
  { id: 'cover', ico: '🙋', label: 'Who can cover', need: { band: 1, day: 1 }, test: c => /\b(who can|cover|replace|fill|available|free)\b/.test(c.t) && !!c.band, make: c => `who can cover ${c.band === 'day shifts' ? 'mornings' : c.band} on ${(c.day || 'tomorrow').replace(/^on /, '')}` },
  { id: 'whoOn', ico: '👀', label: 'Who is on now', need: {}, test: c => !c.n.length && /^(who|whos|who's|which)\b/.test(c.t) && /\b(on|working|work|duty|shift|desk|in)\b/.test(c.t), make: c => /tonight|night/.test(c.t) ? 'who is on tonight' : 'who is on now' },
  { id: 'build', ico: '🧩', label: 'Build next week', need: {}, test: c => /\b(build|make|create|prepare|do|plan|generate)\b/.test(c.t) && /\b(roster|rota|schedule|week)\b/.test(c.t) && !c.n.length, make: () => 'build the roster' },
  { id: 'problems', ico: '🩹', label: 'Roster problems', need: {}, test: c => /\b(problems?|gaps?|short|missing|empty|holes?|issues?)\b/.test(c.t) && /\b(roster|shifts?|week|cover)\b/.test(c.t) && !c.n.length, make: () => 'roster problems' },
  { id: 'mine', ico: '🗓', label: 'My shifts', need: {}, test: c => /\bmy\b/.test(c.t) && /\b(shifts?|roster|schedule|days? off)\b/.test(c.t), make: () => 'my shifts' },
];

/** Read a sentence: { t, n:[keys], N:[names], ambiguous, day, band, hotel, title, span }. */
function buRead(q) {
  const t = buNorm(q), found = buNames(t);
  const n = found.filter(x => x.k).map(x => x.k), amb = found.filter(x => !x.k);
  const sp = t.match(/\b(for \d+ days?|(?:until|till|to) (?:the )?\d{1,2}(?:st|nd|rd|th)?(?: [a-z]+)?|(?:until|till) [a-z0-9 ]+)$/);
  const rest = sp ? t.slice(0, sp.index) : t;   // "until 15 Oct" is the end, not the start
  return { q, t, n, N: n.map(_buN), amb, day: buDay(rest), band: buBand(t), hotel: buHotel(t), title: buTitle(t), span: sp ? ' ' + sp[1].replace(/^to /, 'until ') : '', how: /^\s*(how\s+(to|do|does|can|could|should|would|will)|where do i|what is the way|what's the way)\b/i.test(String(q || '')) };
}
/** What was meant: { sure, cmd, it, options:[{ it, cmd }] }. */
function buUnderstand(q) {
  const c = buRead(q);
  // about a guest or a room ("Mr Ahmed in 512 is sick"): never a change to the team
  if (/\b(guests?|rooms?|pax|booking|reservation|check ?in|check ?out|checkout|checkin)\b|\b\d{3,4}\b/.test(c.t)) return { sure: false, c, options: [] };
  const learned = buLearned(c);
  if (learned) return { sure: true, cmd: learned.make(c), it: learned, c, options: [] };
  const hits = BU_INTENTS.filter(it => { try { return it.test(c); } catch (_) { return false; } });
  const options = hits.map(it => ({ it, cmd: it.make(c) })).filter(o => o.cmd);
  // someone named who could be two people ("Ali" twice in the team): ask which one
  if (c.amb.length && options.length) {
    const a = c.amb[0], alt = [];
    a.any.slice(0, 3).forEach(k => { const c2 = Object.assign({}, c, { n: c.n.concat([k]), N: c.N.concat([_buN(k)]) }); const it = options[0].it; if (it.test(c2)) alt.push({ it, cmd: it.make(c2) }); });
    return { sure: false, c, options: alt.length ? alt : options, which: a.word };
  }
  // only names, no request ("ali and souptik"): offer what is usually meant, with those names
  if (!options.length && c.n.length && c.t.split(' ').length <= c.n.length * 3 + 2) {
    const ids = c.n.length >= 2 ? ['apart', 'with', 'swap'] : ['sick', 'dayoff', 'leave', 'lastweek', 'balance'];
    const c2 = Object.assign({}, c, { day: c.day || 'tomorrow' });
    const opts = ids.map(id => BU_INTENTS.find(x => x.id === id)).map(it => ({ it, cmd: it.make(c2) }));
    return { sure: false, c, options: opts, about: c.N.map(x => x.split(' ')[0]).join(' and ') };
  }
  // "how do I…": show how, with a button to do it now (never done without asking)
  if (c.how && options.length) return { sure: false, how: true, c, options };
  // "Mr / Mrs" may be a guest: ask before changing anything (Mr Ali the manager is one tap away)
  const titled = /\b(mr|mrs|ms|miss|madam|dr)\b/.test(c.t) && options[0] && !['apart', 'with', 'balance', 'lastweek', 'whoOn', 'build', 'problems', 'mine', 'cover'].includes(options[0].it.id);
  return { sure: !titled && (options.length === 1 || (options.length > 1 && options[0].it.id === 'apart')), cmd: options[0] && options[0].cmd, it: options[0] && options[0].it, c, options };
}

// ── Learning what you mean ────────────────────────────────
const BU_LEARN = 'brain_phrases_v1';
let buPhrases = {};
try { buPhrases = JSON.parse(localStorage.getItem(BU_LEARN) || '{}') || {}; } catch (_) {}
/** The sentence with its names and day taken out: "keep ~n away from ~n ~d". */
function buShape(c) {
  const ws = c.t.split(' '), names = new Set(buNames(c.t).map(x => x.word));
  return ws.map(w => names.has(w) ? '~n' : BU_DAYS.includes(w) || /^(today|tonight|tomorrow)$/.test(w) ? '~d' : w).join(' ').trim();
}
function _buKey(s) { return s.replace(/[.#$/[\]\s']/g, '_').slice(0, 120); }
function buLearned(c) { const id = buPhrases[buShape(c)]; return id ? BU_INTENTS.find(x => x.id === id) : null; }
function buLearn(c, id) {
  const s = buShape(c); if (!s || s.length < 4) return;
  buPhrases[s] = id;
  try { localStorage.setItem(BU_LEARN, JSON.stringify(buPhrases)); } catch (_) {}
  try { if (typeof fbSet === 'function') fbSet('brain/phrases/' + _buKey(s), { s, id }); } catch (_) {}
}

// ── Doing it ──────────────────────────────────────────────
let _buLast = null;
function _buBanner(cmd, canWrong) {
  const b = document.getElementById('brAnswers'); if (!b) return;
  b.insertAdjacentHTML('afterbegin', `<div class="bu-said">🧠 I understood: <b>${escapeHtml(cmd)}</b>${canWrong ? ' <button class="bu-wrong" onclick="buWrong()">Not this?</button>' : ''}</div>`);
}
function buRun(cmd, it, c) {
  let ok = false;
  try { ok = it && it.run ? it.run(c) !== false : _buTry0(cmd); } catch (e) { console.warn('brain understand', e); }
  if (ok) setTimeout(() => _buBanner(cmd, true), 0);
  return ok;
}
function buWrong() { if (!_buLast) return; buOptions(_buLast, 'What did you mean?'); }
function buOptions(u, title) {
  const b = document.getElementById('brAnswers'); if (!b) return;
  const opts = u.options.length ? u.options : [];
  b.innerHTML = `<div class="br-card"><div class="br-kind">🧠 ${escapeHtml(title || 'Did you mean…')}</div>
    ${opts.map((o, i) => `<button class="bu-opt" onclick="buPick(${i})">${o.it.ico} ${escapeHtml(o.cmd)}</button>`).join('')}
    <div class="br-body" style="margin-top:6px">Or tap one of these and pick the names:</div>${buQuickHtml(true)}</div>`;
}
function buPick(i) {
  const u = _buLast; if (!u || !u.options[i]) return;
  const o = u.options[i]; buLearn(u.c, o.it.id);
  if (!buRun(o.cmd, o.it, u.c)) _bxOutSafe(`<div class="br-title">I couldn't do "${escapeHtml(o.cmd)}".</div>`);
}
function _bxOutSafe(html) { const b = document.getElementById('brAnswers'); if (b) b.innerHTML = `<div class="br-card ba-res">${html}</div>`; }
/** Never send someone to a hotel (same as "🚫" on their card). */
function buNoGo(k, h) {
  if (!k || !h || typeof rbSetPerson !== 'function') return false;
  if (typeof roCanEdit === 'function' && !roCanEdit()) { _bxOutSafe('<div class="br-title">Only supervisors, managers and owners can change this.</div>'); return true; }
  const cur = ((rbPeople[k] || {}).noGo || []).slice(); if (!cur.includes(h)) cur.push(h);
  rbSetPerson(k, 'noGo', cur);
  _bxOutSafe(`<div class="br-kind">🚫 Team</div><div class="br-title">${escapeHtml(_buN(k))} will never be sent to ${escapeHtml(h)}</div><div class="br-body">Saved on their card. Other hotels are still possible when needed.</div>`);
  return true;
}

// ── Quick buttons: the common things with a tap ───────────
const BU_QUICK = ['sick', 'dayoff', 'leave', 'apart', 'with', 'swap', 'prefNot', 'whatif', 'balance', 'whoOn', 'build'];
function buQuickHtml(inline) {
  return `<div class="bu-quick${inline ? ' inline' : ''}">${BU_QUICK.map(id => { const it = BU_INTENTS.find(x => x.id === id); return `<button class="bu-chip" onclick="buForm('${id}')">${it.ico} ${escapeHtml(it.label)}</button>`; }).join('')}</div>`;
}
function buForm(id) {
  const it = BU_INTENTS.find(x => x.id === id), b = document.getElementById('brAnswers'); if (!it || !b) return;
  if (typeof brTabShow === 'function') brTabShow('think');
  const need = it.need || {};
  if (!need.n && !need.band && !need.title) { buRun(it.make({ t: '', n: [], N: [], day: '', band: '', span: '' }), it, {}); return; }
  const ks = Object.keys(roStaff || {}).filter(k => !((rbPeople || {})[k] || {}).deleted).sort((a, c) => _buN(a).localeCompare(_buN(c)));
  const ppl = i => `<select class="bu-sel" id="buN${i}"><option value="">${i ? 'and…' : 'Who?'}</option>${ks.map(k => `<option value="${escapeHtml(k)}">${escapeHtml(_buN(k))}</option>`).join('')}</select>`;
  const days = ['today', 'tomorrow', ...BU_DAYS.map(d => d.charAt(0).toUpperCase() + d.slice(1)), 'next week'];
  b.innerHTML = `<div class="br-card"><div class="br-kind">${it.ico} ${escapeHtml(it.label)}</div><div class="bu-form">
    ${need.n ? ppl(0) : ''}${need.n >= 2 ? ppl(1) : ''}
    ${need.band ? `<select class="bu-sel" id="buB">${['nights', 'mornings', 'evenings', 'day shifts'].map(x => `<option>${x}</option>`).join('')}</select>` : ''}
    ${need.hotel ? `<select class="bu-sel" id="buH">${(typeof roGroups === 'function' ? roGroups() : []).map(x => `<option>${escapeHtml(x)}</option>`).join('')}</select>` : ''}
    ${need.day ? `<select class="bu-sel" id="buD">${days.map(x => `<option${x === (id === 'dayoff' ? 'Friday' : id === 'leave' ? 'next week' : 'tomorrow') ? ' selected' : ''}>${x}</option>`).join('')}</select>` : ''}
    <button class="btn gold" onclick="buFormGo('${id}')">Do it</button></div></div>`;
}
function buFormGo(id) {
  const it = BU_INTENTS.find(x => x.id === id), v = x => (document.getElementById(x) || {}).value || '';
  const n = [v('buN0'), v('buN1')].filter(Boolean);
  if ((it.need.n || 0) > n.length || (n.length === 2 && n[0] === n[1])) { showToast(it.need.n === 2 ? 'Pick two different people' : 'Pick who', 'warn'); return; }
  const c = { t: '', n, N: n.map(_buN), day: v('buD'), band: v('buB'), hotel: v('buH'), span: '' };
  _buLast = { c, options: [], sure: true };
  if (!buRun(it.make(c), it, c)) _bxOutSafe(`<div class="br-title">I couldn't do that.</div>`);
}

// ── Plug in: commands first, then plain talk ──────────────
let _buTry0 = null;
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    if (typeof baTry !== 'function' || _buTry0) return;
    _buTry0 = baTry;
    baTry = function (q) {   // eslint-disable-line no-global-assign
      const u = buUnderstand(q); _buLast = u;
      // sure, and about the team (names, or a roster request): that first, before any older command that happens to match
      const team = u.sure && (u.c.n.length || ['build', 'balance', 'problems', 'mine', 'titleNo'].includes(u.it.id));
      if (team && buRun(u.cmd, u.it, u.c)) return true;
      if (_buTry0(q)) return true;
      if (!u.options.length) return false;                            // not a request: Ops Brain answers it as a question
      if (u.sure && buRun(u.cmd, u.it, u.c)) return true;
      buOptions(u, u.how ? 'Just say it like this next time. Tap to do it now:' : u.which ? `Which "${u.which}"?` : u.about ? `What about ${u.about}?` : 'Did you mean…'); return true;
    };
    // quick buttons under the box, and an easier hint
    const build = window.brBuild;
    if (typeof build === 'function' && !build.__bu) {
      window.brBuild = function () {
        build.apply(this, arguments);
        const f = document.querySelector('#brSheet .br-ask');
        if (f && !document.querySelector('#brSheet .bu-quick')) f.insertAdjacentHTML('afterend', buQuickHtml());
        const q = document.getElementById('brQ'); if (q) q.placeholder = 'Just say it: "Ahmed is not coming tomorrow", "keep Souptik away from Ali"…';
      };
      window.brBuild.__bu = true;
    }
  }, 2600);
  // the very front of Ops Brain: a clear request about the team goes first, before data questions and answers
  setTimeout(() => {
    const inner = window.brAsk;
    if (typeof inner !== 'function' || inner.__bu) return;
    window.brAsk = function (q) {
      try {
        const u = buUnderstand(q);
        if (u.sure && (u.c.n.length || ['build', 'balance', 'problems', 'mine', 'titleNo'].includes(u.it.id))) {
          if (typeof brTabShow === 'function') brTabShow('think');
          _buLast = u;
          if (buRun(u.cmd, u.it, u.c)) { if (typeof _bcRemember === 'function') try { _bcRemember(q); } catch (_) {} return; }
        }
      } catch (e) { console.warn('brain understand', e); }
      return inner(q);
    };
    window.brAsk.__bu = true;
  }, 3400);
  // phrases learnt on other devices
  setTimeout(() => { if (typeof fbListen === 'function') fbListen('brain/phrases', v => { if (v && typeof v === 'object') Object.values(v).forEach(x => { if (x && x.s && x.id) buPhrases[x.s] = x.id; }); }); }, 3000);
});
