// ═══════════════════════════════════════════════════════════
//  brain-complete.js — autocomplete for the Ops Brain box
//  As you type, up to 6 finished questions appear under the box: what
//  you asked before, every command Ops Brain knows, and roster questions
//  filled in with the names of the team ("what if Ah…" → "what if Ahmed
//  is sick tomorrow"). Arrows to move, Tab or → to take one, Enter or a
//  tap to ask it. Words can be typed in any order and cut short.
// ═══════════════════════════════════════════════════════════

const BC_TEMPLATES = [
  'what if {n} is sick today', 'what if {n} is sick tomorrow', 'what if {n} takes tomorrow off', 'what if {n} is off on Friday',
  "what if {n} isn't on his shift tomorrow", 'what if {n} is on leave next week', 'what if {n} is sick for 3 days',
  '{n} is sick today', '{n} is sick tomorrow', '{n} wants Friday off', '{n} last week',
  'put {n} on mornings next week', 'put {n} on nights next week', 'put {n} on day shifts this week', 'put {n} or {m} on evenings next week',
  'swap {n} and {m} on Tuesday', 'lock {n} in his hotel', 'keep {n} on his shift', 'unlock {n}',
  '{n} is a bell boy', '{n} is a supervisor', '{n} is a manager',
];
const BC_FIXED = [
  'who is on tonight', 'who is on now', 'my shifts', 'roster problems', 'who can cover nights on Wednesday', 'who can cover mornings tomorrow',
  'add new staff', 'add new staff to Ibis from Monday',
  'keep everyone in their own hotel', 'lock all in the same hotel', 'allow moving between hotels',
  'plan my shift', 'brief me', 'fix everything', 'write the handover', 'late checkouts', 'who owes', 'what can you do',
  'who has no email', 'nationality breakdown', 'arrivals by source', 'rooms that owe money',
];
const BC_ROOMS = ['check out {r}', '{r} late', '{r} dnd', '{r} no answer', 'room {r}'];
const BC_RECENT = 'brain_recent_v1';

function _bcRecent() { try { return JSON.parse(localStorage.getItem(BC_RECENT) || '[]'); } catch (_) { return []; } }
function _bcRemember(q) {
  q = String(q || '').trim(); if (q.length < 3) return;
  try { localStorage.setItem(BC_RECENT, JSON.stringify([q, ..._bcRecent().filter(x => x.toLowerCase() !== q.toLowerCase())].slice(0, 25))); } catch (_) {}
}
/** Every finished question we could offer: recent first, then commands, then roster questions with names. */
function _bcPool() {
  const cmds = [].concat(
    typeof BA_COMMANDS !== 'undefined' ? BA_COMMANDS.filter(c => c.ex).map(c => c.ex) : [],
    typeof RO_COMMANDS !== 'undefined' ? RO_COMMANDS.filter(c => c.ex).map(c => c.ex) : [], BC_FIXED)
    .filter(q => !/\b(Sam|Lina|Omar)\b/.test(q));   // examples written with made-up names: the real names come from the templates
  const names = typeof roStaff !== 'undefined' ? Object.keys(roStaff).filter(k => !(typeof rbPeople !== 'undefined' && (rbPeople[k] || {}).deleted)).map(k => String(roStaff[k].name || '').split(' ')[0]).filter(Boolean) : [];
  const uniq = [...new Set(names)];
  const roster = [];
  BC_TEMPLATES.forEach(t => uniq.forEach((n, i) => roster.push(t.replace('{n}', n).replace('{m}', uniq[(i + 1) % uniq.length] || n))));
  // today's departures: the room questions, filled in ("check out 512", "512 late")
  const rooms = typeof depRooms !== 'undefined' && Array.isArray(depRooms) ? depRooms.filter(r => r && (r.roomStr || r.room)).map(r => String(r.roomStr || r.room)).slice(0, 200) : [];
  rooms.forEach(r => BC_ROOMS.forEach(t => roster.push(t.replace('{r}', r))));
  const seen = new Set(), out = [];
  [..._bcRecent().map(q => ({ q, recent: true })), ...cmds.map(q => ({ q })), ...roster.map(q => ({ q, tpl: true }))].forEach(x => { const k = x.q.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(x); } });
  return out;
}
/** How well a question fits what's typed (lower is better), or -1. Each typed word is the start of a word, in order. */
function bcScore(typed, cand) {
  const t = typed.toLowerCase().trim(), c = cand.toLowerCase();
  if (!t || c === t) return -1;
  if (c.startsWith(t)) return c.length / 100;
  const tw = t.split(/\s+/), cw = c.split(/\s+/);
  let j = 0, skipped = 0;
  for (const w of tw) {
    while (j < cw.length && !cw[j].startsWith(w)) { j++; skipped++; }
    if (j >= cw.length) return -1;
    j++;
  }
  return 1 + skipped * 0.4 + c.length / 100;
}
function bcSuggest(typed, max) {
  const t = String(typed || '').trim();
  if (t.length < 2) return [];
  return _bcPool().map(x => { const s = bcScore(t, x.q); return s < 0 ? null : { q: x.q, recent: x.recent, s: s - (x.recent ? 0.5 : 0) + (x.tpl ? 0.05 : 0) }; })
    .filter(Boolean).sort((a, b) => a.s - b.s).slice(0, max || 6);
}

// ── The list under the box ────────────────────────────────
(function () {
  let sel = -1, items = [];
  const box = () => document.getElementById('brQ');
  const list = () => document.getElementById('bcList');
  const close = () => { list()?.remove(); sel = -1; items = []; };
  const take = (i, ask) => {
    const b = box(), it = items[i]; if (!b || !it) return;
    b.value = it.q; close(); b.focus();
    if (ask) _bcRemember(it.q);
    if (ask && typeof brAsk === 'function') { if (typeof brTabShow === 'function') try { brTabShow('think'); } catch (_) {} brAsk(it.q); }
  };
  const draw = () => {
    const b = box(); if (!b) return;
    items = bcSuggest(b.value, 6);
    if (!items.length) { close(); return; }
    let l = list();
    if (!l) { l = document.createElement('div'); l.id = 'bcList'; l.className = 'bc-list'; l.setAttribute('role', 'listbox'); b.closest('form')?.appendChild(l); }
    const t = b.value.trim().toLowerCase().split(/\s+/);
    const mark = q => escapeHtml(q).split(' ').map(w => t.some(x => x && w.toLowerCase().startsWith(x)) ? `<b>${w}</b>` : w).join(' ');
    l.innerHTML = items.map((x, i) => `<button type="button" role="option" class="bc-it${i === sel ? ' on' : ''}" data-i="${i}"><span>${x.recent ? '🕘' : '›'}</span>${mark(x.q)}</button>`).join('') + '<small class="bc-hint">Tab to fill · Enter to ask</small>';
  };
  document.addEventListener('input', e => { if (e.target && e.target.id === 'brQ') { sel = -1; draw(); } });
  document.addEventListener('keydown', e => {
    if (!e.target || e.target.id !== 'brQ' || !list()) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % items.length; draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + items.length) % items.length; draw(); }
    else if ((e.key === 'Tab' || e.key === 'ArrowRight') && items.length && (e.key === 'Tab' || e.target.selectionStart === e.target.value.length)) { e.preventDefault(); take(sel >= 0 ? sel : 0, false); draw(); }
    else if (e.key === 'Enter' && sel >= 0) { e.preventDefault(); take(sel, true); }
    else if (e.key === 'Escape') close();
  }, true);
  document.addEventListener('mousedown', e => { const it = e.target.closest && e.target.closest('.bc-it'); if (it) { e.preventDefault(); take(+it.dataset.i, true); } else if (!(e.target.closest && e.target.closest('#bcList, #brQ'))) close(); }, true);
  document.addEventListener('touchstart', e => { const it = e.target.closest && e.target.closest('.bc-it'); if (it) { e.preventDefault(); take(+it.dataset.i, true); } }, { capture: true, passive: false });
  document.addEventListener('submit', e => { if (e.target && e.target.querySelector && e.target.querySelector('#brQ')) { _bcRemember(box().value); close(); } }, true);
})();
