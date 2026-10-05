// ═══════════════════════════════════════════════════════════
//  brain-agent.js — Ops Brain as your agent
//  Tell it what to do in plain words and it does it:
//    "fix everything", "guess nationalities", "remove duplicates",
//    "copy arrivals to purpose", "fix the nationality report",
//    "check out 512", "512 late", "set TD rate to 15",
//    "month end report", "commission report", "late checkouts",
//    "who owes", "how many arrivals", "history 512", "update the app"…
//  "what can you do" lists everything.
//
//  It also fixes the Nationality report by itself: when Opera sends a
//  country spelling the report doesn't know, it finds the right row,
//  maps it, runs the report again and tells you. If it isn't sure it
//  asks with the 3 closest rows — your pick is remembered for the team.
// ═══════════════════════════════════════════════════════════

// ── Nationality report: new Opera spellings ───────────────
let baCountryMap = {};   // Opera spelling → Excel row (learned, shared)

function _baBigrams(s) { const a = []; for (let i = 0; i < s.length - 1; i++) a.push(s.slice(i, i + 2)); return a; }
function _baSim(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length > 3 && (b.startsWith(a) || a.startsWith(b))) return 0.9;
  const A = _baBigrams(a), B = _baBigrams(b);
  const m = new Map(); B.forEach(x => m.set(x, (m.get(x) || 0) + 1));
  let hit = 0; A.forEach(x => { const c = m.get(x); if (c) { hit++; m.set(x, c - 1); } });
  return (2 * hit) / (A.length + B.length);
}
/** closest Excel rows for an Opera country spelling */
function baCountryCandidates(name) {
  if (typeof EXCEL_COUNTRIES === 'undefined') return [];
  const L = typeof _natLoose === 'function' ? _natLoose : s => s.toLowerCase();
  const q = L(name);
  const words = String(name).toLowerCase().split(/[^a-z]+/).filter(w => w.length > 3);
  return EXCEL_COUNTRIES.map(c => {
    const cl = L(c);
    let s = _baSim(q, cl);
    // a long word of the Opera name inside the row name ("Korea, Republic of" → "Korea, Republic of (South)")
    if (words.some(w => cl.includes(w))) s = Math.max(s, 0.55 + 0.3 * words.filter(w => cl.includes(w)).length / words.length);
    return { c, s };
  }).sort((a, b) => b.s - a.s).slice(0, 3);
}

function baApplyCountryMap() {
  if (typeof NAME_MAP === 'undefined') return;
  Object.entries(baCountryMap).forEach(([k, v]) => { if (v) NAME_MAP[k] = v; });
}

function baMapCountry(opName, excel, auto) {
  baCountryMap[opName] = excel;
  NAME_MAP[opName] = excel;
  try { localStorage.setItem('brain_country_map_v1', JSON.stringify(baCountryMap)); } catch (_) {}
  if (typeof fbSet === 'function') fbSet('brain/countryMap/' + opName.replace(/[.#$\[\]\/]/g, '_'), { from: opName, to: excel });
  if (typeof processNat === 'function' && document.getElementById('natInput')?.value.trim()) processNat();
  if (typeof logActivity === 'function') try { logActivity('brain_country_map', `${opName} → ${excel}`); } catch (_) {}
  blDid('🌍', `${auto ? 'I mapped' : 'Mapped'} "${opName}" to the "${excel}" row and ran the Nationality report again.`, () => {
    delete baCountryMap[opName]; delete NAME_MAP[opName];
    try { localStorage.setItem('brain_country_map_v1', JSON.stringify(baCountryMap)); } catch (_) {}
    if (typeof fbSet === 'function') fbSet('brain/countryMap/' + opName.replace(/[.#$\[\]\/]/g, '_'), null);
    if (typeof processNat === 'function') processNat();
  });
}

(window.BL_THINKERS = window.BL_THINKERS || []).push(add => {
  const um = window._natUnmatched || [];
  if (!um.length) return;
  um.forEach(u => {
    const cand = baCountryCandidates(u.name);
    const sure = cand[0] && cand[0].s >= 0.78 && (!cand[1] || cand[0].s - cand[1].s >= 0.08);
    const n = u.PRS || u.APR || 0;
    add({ id: 'natMap:' + u.name, type: 'natMap', icon: '🌍', tone: 'bad', safe: sure ? 0 : undefined,
      text: `The Nationality report has no row for "${u.name}"${n ? ` (${n} guest${n > 1 ? 's' : ''} would be lost)` : ''}.`,
      why: sure ? `It is "${cand[0].c}". I'll remember it for next month.` : 'Which row is it? I\'ll remember your answer.',
      acts: (sure ? cand.slice(0, 1) : cand).map(c => [(sure ? 'Map to ' : '') + c.c, () => baMapCountry(u.name, c.c, sure)]).concat([['Open report', () => showPanel('nationality')]]) });
  });
});

// ── Commands ──────────────────────────────────────────────
const _baRoom = s => (String(s).match(/\b(\d{3,4})\b/) || [])[1];
const _baDepIdx = room => (typeof depRooms !== 'undefined' ? depRooms.findIndex(r => String(r.roomStr).trim() === String(room)) : -1);
const _baOut = (html) => { const box = document.getElementById('brAnswers'); if (box) box.innerHTML = `<div class="br-card ba-res">${html}</div>`; };
const _baList = (title, rows) => `<div class="br-kind">🤖 Done</div><div class="br-title">${escapeHtml(title)}</div>${rows.length ? '<ul class="ba-ul">' + rows.map(r => `<li>${r}</li>`).join('') + '</ul>' : ''}`;

function _baThinkNow() { return typeof blThink === 'function' ? blThink() : []; }
function _baRunThought(types) {
  const t = _baThinkNow().find(x => types.includes(x.type) && x.acts && x.acts.length);
  if (!t) return false;
  t.acts[t.safe != null ? t.safe : 0][1]();
  return t;
}

const BA_COMMANDS = [
  { re: /^(what can you do|help|commands|\?)$/i, ask: true, run: () => {
      _baOut(`<div class="br-kind">🤖 I can do these for you — just type them</div><ul class="ba-ul">${BA_COMMANDS.filter(c => c.ex).map(c => `<li><a href="#" onclick="document.getElementById('brQ').value=this.textContent;brAsk(this.textContent);return false;">${escapeHtml(c.ex)}</a> <small>${escapeHtml(c.does)}</small></li>`).join('')}</ul>`);
      return true; } },
  { re: /^(fix|do) (everything|all|it all)|^clean ?up$|^sort (it|everything) out$/i, ex: 'fix everything', does: 'does every safe fix I can see right now', run: () => {
      const done = [];
      for (let k = 0; k < 8; k++) {
        const t = _baThinkNow().find(x => x.safe != null && x.acts && x.acts[x.safe] && !done.some(d => d.id === x.id));
        if (!t) break;
        try { t.acts[t.safe][1](); done.push(t); } catch (_) {}
      }
      const left = _baThinkNow().filter(x => x.safe == null && x.tone !== 'idle');
      _baOut(_baList(done.length ? `I fixed ${done.length} thing${done.length > 1 ? 's' : ''}:` : 'Nothing I can fix by myself right now.', done.map(d => escapeHtml(d.text)))
        + (left.length ? `<div class="br-title" style="margin-top:10px;">These need you:</div><ul class="ba-ul">${left.map(x => `<li>${x.icon} ${escapeHtml(x.text)}</li>`).join('')}</ul>` : ''));
      return true; } },
  { re: /^(?!.*(report|countr)).*(guess|fill|fix).*(nationalit|\bnat\b)/i, ex: 'guess nationalities', does: 'fills missing nationalities on Arrivals and Purpose', run: () => {
      const a = _baRunThought(['arrNat']), p = _baRunThought(['purNat']);
      _baOut(_baList(a || p ? 'Guessing the missing nationalities now.' : 'No missing nationality I can guess.', []));
      return true; } },
  { re: /(remove|delete|clean).*(duplicate|double|twice)/i, ex: 'remove duplicates', does: 'removes guests loaded twice on Arrivals (with Undo)', run: () => {
      const t = _baRunThought(['arrDup']);
      _baOut(_baList(t ? 'Removing the duplicates.' : 'No duplicates on Arrivals.', []));
      return true; } },
  { re: /(copy|sync|move).*(arrival).*(purpose)|sync purpose/i, ex: 'copy arrivals to purpose', does: 'fills Purpose of Stay from Arrivals', run: () => {
      if (typeof arrGuests === 'undefined' || !arrGuests.length) { _baOut(_baList('Arrivals is empty — load it first.', [])); return true; }
      if (purposeGuests.length && !confirm(`Purpose of Stay already has ${purposeGuests.length} guests. Replace them with the ${arrGuests.length} arrivals?`)) return true;
      syncFromArrivals(); _baOut(_baList(`Copied ${arrGuests.length} guests to Purpose of Stay.`, [])); return true; } },
  { re: /(fix|check).*(nationality|country) ?report|map (the )?countr/i, ex: 'fix the nationality report', does: 'maps country names the report doesn\'t know', run: () => {
      const um = window._natUnmatched || [];
      if (!um.length) { _baOut(_baList(document.getElementById('natInput')?.value.trim() ? 'The Nationality report is clean: every country has its row.' : 'Run the Nationality report first (paste or drop stat_countrybymon).', [])); return true; }
      const rows = [];
      um.slice().forEach(u => { const c = baCountryCandidates(u.name); if (c[0] && c[0].s >= 0.78 && (!c[1] || c[0].s - c[1].s >= 0.08)) { baMapCountry(u.name, c[0].c, true); rows.push(`"${escapeHtml(u.name)}" → ${escapeHtml(c[0].c)}`); } });
      const left = (window._natUnmatched || []).map(u => escapeHtml(u.name));
      _baOut(_baList(rows.length ? 'Mapped:' : 'I couldn\'t map any by myself.', rows) + (left.length ? `<div class="br-body">Still needs you: ${left.join(', ')} — I'm asking in the bubble.</div>` : ''));
      if (left.length) setTimeout(() => typeof blTick === 'function' && blTick(), 500);
      return true; } },
  { re: /^(?:check ?out|co|mark)?\s*(?:room\s*)?(\d{3,4})\s*(?:is\s*)?(out|checked out|check ?out|late|lco|na|no answer|dnd|due|undo)$|^(?:check ?out|co)\s+(?:room\s*)?(\d{3,4})$/i, ex: 'check out 512', does: 'marks a departure (also "512 late", "512 dnd", "512 due")', run: (q) => {
      const m = q.match(/(\d{3,4})/); const room = m && m[1];
      const w = q.toLowerCase();
      const st = /late|lco/.test(w) ? 'late' : /\bna\b|no answer/.test(w) ? 'na' : /dnd/.test(w) ? 'dnd' : /due|undo/.test(w) ? 'due' : 'out';
      const i = _baDepIdx(room);
      if (i < 0) { _baOut(_baList(`Room ${room} is not on today's departures.`, [])); return true; }
      const r = depRooms[i];
      if (st === 'out' && r.balance > 0 && (typeof hoPref !== 'function' || hoPref('confirmCheckout')) && !confirm(`Room ${room} still owes AED ${r.balance}. Check out anyway?`)) return true;
      depAction(i, st);
      _baOut(_baList(`Room ${room} (${escapeHtml(r.name)}) → ${{ out: 'checked out', late: 'late check-out', na: 'no answer', dnd: 'DND', due: 'back to due' }[st]}.`, []));
      return true; } },
  { re: /(late check ?outs?|lco list|who is late)/i, ex: 'late checkouts', does: 'lists late check-outs and who passed the time', run: () => {
      const L = (typeof depRooms !== 'undefined' ? depRooms : []).filter(r => r.status === 'late');
      _baOut(_baList(L.length ? `${L.length} late check-out${L.length > 1 ? 's' : ''}:` : 'No late check-outs.', L.map(r => `<b>${escapeHtml(r.roomStr)}</b> ${escapeHtml(r.name)} · ${escapeHtml(r.lateTime || '?')}${typeof isLcoOverdue === 'function' && isLcoOverdue(r) ? ' · <span style="color:var(--rose)">past the time</span>' : ''}`)));
      return true; } },
  { re: /(who owes|balance|unpaid|owing)/i, ex: 'who owes', does: 'departures that still owe money', run: () => {
      const L = (typeof depRooms !== 'undefined' ? depRooms : []).filter(r => r.balance > 0 && r.status !== 'out' && r.status !== 'extended');
      _baOut(_baList(L.length ? `${L.length} room${L.length > 1 ? 's' : ''} owe AED ${L.reduce((s, r) => s + r.balance, 0).toLocaleString('en')}:` : 'Nobody owes anything.', L.map(r => `<b>${escapeHtml(r.roomStr)}</b> ${escapeHtml(r.name)} · AED ${r.balance}`)));
      return true; } },
  { re: /how many|status|summary|where are we|brief me|what('?s| is) (left|open)/i, ask: true, ex: 'brief me', does: 'a short summary of the shift', run: () => {
      const rows = [];
      try { if (depRooms.length) { const c = depCounts(); rows.push(`🚪 Departures: ${c.out} out of ${depRooms.length} · ${c.due} due · ${c.late} late`); } } catch (_) {}
      try { if (arrGuests.length) rows.push(`🛎️ Arrivals: ${arrGuests.length} · ${arrGuests.filter(g => !g.email).length} without email · ${arrGuests.filter(g => !g.nat).length} without nationality`); } catch (_) {}
      try { if (purposeGuests.length) rows.push(`📋 Purpose of Stay: ${purposeGuests.length} guests`); } catch (_) {}
      try { if (dtcRecon) rows.push(`🏦 DTCM: ${(dtcRecon.actions || []).length} items · month-end ${dtcRecon.gap && dtcRecon.gap.monthEnd && dtcRecon.gap.monthEnd.equal ? 'tallies' : 'not tallied yet'}`); } catch (_) {}
      try { const a = CL_STEPS.filter(s => !clState.skipped.has(s.id)); rows.push(`✅ Night checklist: ${a.filter(s => clState.done.has(s.id)).length} of ${a.length}`); } catch (_) {}
      const th = _baThinkNow().filter(t => t.tone !== 'idle');
      _baOut(_baList('Here\'s where we are:', rows.map(escapeHtml)) + (th.length ? `<div class="br-title" style="margin-top:10px;">I'd do next:</div><ul class="ba-ul">${th.slice(0, 5).map(t => `<li>${t.icon} ${escapeHtml(t.text)}</li>`).join('')}</ul><div class="br-body">Type <b>fix everything</b> and I'll do the ones I can.</div>` : ''));
      return true; } },
  { re: /set (the )?td rate (to )?(\d+)/i, ex: 'set TD rate to 15', does: 'changes the Tourism Dirham rate for this hotel', run: (q) => {
      const v = +q.match(/(\d+)\s*$/)[1];
      if (!confirm(`Set the Tourism Dirham rate to AED ${v} per night for the whole team?`)) return true;
      HotelCfg.set({ tdRate: v }); if (typeof hsRenderForm === 'function') hsRenderForm();
      if (typeof logActivity === 'function') logActivity('td_settings', `rate AED ${v} (by Ops Brain)`);
      _baOut(_baList(`TD rate is now AED ${v}. Run DTCM Analyze again to use it.`, [])); return true; } },
  { re: /set (the )?td code (to )?([\d ,]+)/i, ex: 'set TD code to 7510', does: 'changes the Opera TD code(s)', run: (q) => {
      const v = q.match(/code (?:to )?([\d ,]+)/i)[1].trim();
      if (!confirm(`Set the Opera TD code to ${v} for the whole team?`)) return true;
      HotelCfg.set({ tdCodes: v }); if (typeof hsRenderForm === 'function') hsRenderForm();
      _baOut(_baList(`TD code is now ${escapeHtml(v)}.`, [])); return true; } },
  { re: /month.?end( report)?|dtcm report/i, ex: 'month end report', does: 'prints the DTCM month-end report', run: () => { meDtcmReport(); _baOut(_baList('Opening the month-end report.', [])); return true; } },
  { re: /commission/i, ex: 'commission report', does: 'prints the package commission per seller', run: () => { mePkgCommission(); _baOut(_baList('Opening the commission report.', [])); return true; } },
  { re: /export arrivals|arrivals (to )?excel/i, ex: 'export arrivals', does: 'downloads Arrivals as Excel', run: () => { exportArrivals(); _baOut(_baList('Arrivals exported.', [])); return true; } },
  { re: /copy no.?shows?/i, ex: 'copy no-shows', does: 'copies the no-show list for Excel', run: () => { nsCopyForExcel(); _baOut(_baList('No-shows copied — paste in Excel.', [])); return true; } },
  { re: /^history\s+(.+)|who (did|changed|checked out|touched)\s+(.+)/i, ex: 'history 512', does: 'who did what to a room or guest', run: (q) => {
      const term = (q.match(/^history\s+(.+)/i) || q.match(/who (?:did|changed|checked out|touched)\s+(.+)/i))[1].replace(/^room\s*/i, '');
      showPanel('history'); setTimeout(() => { const s = document.getElementById('histSearch'); const w = document.getElementById('histWhen'); if (w) w.value = '0'; if (s) { s.value = term; histRender(); } }, 900);
      brClose(); return true; } },
  { re: /update( the)? app|new version|refresh app/i, ex: 'update the app', does: 'loads the newest version', run: () => { appForceUpdate(); return true; } },
  { re: /health|check (the )?app|anything (broken|wrong)/i, ex: 'health check', does: 'checks for updates, damaged data and errors', run: () => { brTabShow('health'); return true; } },
  { re: /autopilot (on|off)|(turn|switch) (on|off) autopilot/i, ex: 'autopilot on', does: 'lets me fix safe things by myself', run: (q) => { blSetAutopilot(/\bon\b/i.test(q)); _baOut(_baList(`Autopilot is ${blAutopilot() ? 'on' : 'off'}.`, [])); return true; } },
];

function baTry(q) {
  const s = String(q || '').trim();
  // a question ("how do I…", "why…") is answered, not carried out
  const question = /^(how|why|explain|where|when|is|are|does|do i|can i|should)\b/i.test(s);
  for (const c of BA_COMMANDS) {
    if (question && !c.ask) continue;
    if (c.re.test(s)) {
      if (typeof logActivity === 'function') try { logActivity('brain_command', s.slice(0, 120)); } catch (_) {}
      try { return c.run(s) !== false; } catch (e) { _baOut(`<div class="br-title">I couldn't do that.</div><div class="br-body">${escapeHtml(e.message)}</div>`); return true; }
    }
  }
  return false;
}

// ── Plug in ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  try { baCountryMap = JSON.parse(localStorage.getItem('brain_country_map_v1') || '{}') || {}; } catch (_) {}
  setTimeout(() => {
    baApplyCountryMap();
    if (typeof fbListen === 'function') fbListen('brain/countryMap', v => {
      if (!v || typeof v !== 'object') return;
      Object.values(v).forEach(x => { if (x && x.from && x.to) baCountryMap[x.from] = x.to; });
      try { localStorage.setItem('brain_country_map_v1', JSON.stringify(baCountryMap)); } catch (_) {}
      baApplyCountryMap();
    });
    // commands come before questions
    const ask = window.brAsk;
    if (typeof ask === 'function' && !ask.__ba) {
      window.brAsk = function (q) { brTabShow('think'); if (baTry(q)) { setTimeout(() => typeof blRenderFeed === 'function' && blRenderFeed(), 400); return; } return ask(q); };
      window.brAsk.__ba = true;
    }
    // autopilot switch + placeholder in the panel
    const build = window.brBuild;
    window.brBuild = function () {
      build();
      const head = document.querySelector('#brSheet .br-head div');
      if (head) head.insertAdjacentHTML('beforeend', `<label class="bl-auto" title="Fix safe things by myself and tell you, with Undo"><input type="checkbox" class="bl-auto-sw" ${blAutopilot() ? 'checked' : ''} onchange="blSetAutopilot(this.checked)"> 🤖 Autopilot</label>`);
      const q = document.getElementById('brQ');
      if (q) q.placeholder = 'Tell me what to do… fix everything · check out 512 · brief me';
      const pane = document.querySelector('.br-pane[data-t="think"]');
      if (pane) pane.insertAdjacentHTML('afterbegin', `<div class="ba-chips">${['plan my shift', 'brief me', 'fix everything', 'write the handover', 'late checkouts', 'who owes', 'what can you do'].map(x => `<button onclick="document.getElementById('brQ').value='${x}';brAsk('${x}')">${x}</button>`).join('')}</div>`);
    };
  }, 2000);
});
