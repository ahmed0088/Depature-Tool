// ═══════════════════════════════════════════════════════════
//  brain-live.js — Ops Brain, awake
//  The brain watches the app all the time (every few seconds, and
//  right after anything is loaded or changed), forms its own
//  "thoughts" and speaks up in a bubble next to 🧠 with a button that
//  does the work for you. Runs fully offline, inside the app.
//
//   • Reacts   — new arrivals loaded, a late check-out, the database
//                dropped, a new version waiting, an error on a page.
//   • Acts     — "Guess them now", "Remove duplicates", "Sync", "Update"
//                — one tap and it does it, then tells you what it did.
//   • Learns   — from your corrections: when you fix a nationality it
//                remembers the surname and guesses it right next time
//                (for the whole team). From your answers to its thoughts:
//                ideas you keep dismissing stop, ones you use come first.
//   • Heals    — when a page throws an error it rebuilds that page
//                straight away, says so, and keeps the details ready to
//                send to the developer.
// ═══════════════════════════════════════════════════════════

const BL_STATS_KEY = 'brain_thought_stats_v1';
const BL_SNOOZE_KEY = 'brain_snooze_v1';
const BL_NAT_KEY = 'brain_nat_learn_v1';

let blThoughts = [];          // what it is thinking right now
let blFeed = [];              // what it said / did, newest first
let blShown = null;           // the thought in the bubble
let blNatLearn = {};          // surname word → { nationality: times }
let blOfflineBeats = 0;
let blLatestVersion = null;
let blLastSig = '';

const _blLS = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
};

// ── Learning from corrections ─────────────────────────────
const _blWords = name => String(name || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(w => w.length >= 3);

function blLearnNat(name, nat) {
  nat = String(nat || '').trim();
  if (!nat || !name) return;
  const ws = _blWords(name);
  if (!ws.length) return;
  ws.forEach(w => {
    blNatLearn[w] = blNatLearn[w] || {};
    blNatLearn[w][nat] = (blNatLearn[w][nat] || 0) + 1;
    if (typeof fbSet === 'function') fbSet('brain/natLearn/' + w, blNatLearn[w]);
  });
  _blLS.set(BL_NAT_KEY, blNatLearn);
}

/** What the team taught for this name, or '' */
function blGuessNat(name) {
  const ws = _blWords(name);
  const votes = {};
  ws.forEach((w, i) => {
    const m = blNatLearn[w];
    if (!m) return;
    const tot = Object.values(m).reduce((a, b) => a + b, 0);
    const [nat, c] = Object.entries(m).sort((a, b) => b[1] - a[1])[0];
    // a word seen twice that always meant the same country, or the surname (first word) seen once
    if ((c >= 2 && c / tot >= 0.75) || (i === 0 && tot === 1)) votes[nat] = (votes[nat] || 0) + c + (i === 0 ? 1 : 0);
  });
  const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : '';
}

function _blWrap(name, before) {
  const orig = window[name];
  if (typeof orig !== 'function' || orig.__bl) return;
  const w = function (...a) { try { before.apply(this, a); } catch (_) {} return orig.apply(this, a); };
  w.__bl = true;
  window[name] = w;
}

function blHook() {
  // a person typed a nationality → learn it
  _blWrap('gmOnEdit', (name, field, value) => { if (field === 'nat') blLearnNat(name, value); });
  // built-in guesses ask the team's corrections first
  const g = window.guessNat;
  if (typeof g === 'function' && !g.__bl) {
    window.guessNat = function (name) { return blGuessNat(name) || g(name); };
    window.guessNat.__bl = true;
  }
  // anything loaded or changed → think again soon
  ['arrRender', 'purposeRender', 'depRender', 'dtcRenderAll', 'pkgRender', 'processNat'].forEach(fn => _blWrap(fn, () => blSoon()));
}

// ── Self-healing ──────────────────────────────────────────
const BL_RENDER = { home: 'homeRender', departures: 'depRender', arrivals: 'arrRender', purpose: 'purposeRender', dtcm: 'dtcRenderAll',
  'package-audit': 'pkgRender', history: 'histRender', standards: 'stdRender' };
let _blHealing = false;
const _blHealLog = [];

function blHeal(err) {
  if (_blHealing) return;
  const page = document.querySelector('.panel.active')?.id.slice(6) || 'home';
  const now = Date.now();
  _blHealLog.push(now);
  const burst = _blHealLog.filter(t => now - t < 60000).length;
  _blHealing = true;
  setTimeout(() => {
    let healed = false;
    const fn = window[BL_RENDER[page]];
    if (burst <= 3 && typeof fn === 'function') {
      try { fn(); healed = true; } catch (_) { healed = false; }
    }
    _blHealing = false;
    const where = (typeof _brPanelName === 'function' ? _brPanelName(page) : page);
    const msg = String(err && (err.message || err) || 'unknown').slice(0, 160);
    const stack = String(err && err.stack || '').split('\n').slice(0, 4).join(' | ').slice(0, 400);
    blSay({
      id: 'heal:' + now, type: 'heal', tone: healed ? 'warn' : 'bad', icon: healed ? '🩹' : '🚑',
      text: healed ? `Something broke on ${where}. I rebuilt the page and it works again.` : `${where} keeps failing (${burst}× in a minute).`,
      why: msg,
      acts: [
        ['Send to developer', () => { brOpen('fix'); const t = document.getElementById('brFixText'); const s = document.getElementById('brFixPage'); if (s) s.value = page; if (t) t.value = `Error on ${where}: ${msg}\nTechnical: ${stack}\nWhat I was doing: `; }],
        ...(healed ? [] : [['Reload the app', () => location.reload()]]),
      ],
    }, true);
  }, 400);
}
window.addEventListener('error', e => { if (e.message && !/ResizeObserver|Script error/.test(e.message)) blHeal(e.error || e); });
window.addEventListener('unhandledrejection', e => { const r = e.reason; if (r && !/network|fetch|Failed to fetch|permission_denied/i.test(String(r.message || r))) blHeal(r); });

// ── Thinking ──────────────────────────────────────────────
function blThink() {
  const T = [];
  const add = t => T.push(t);
  const safe = f => { try { f(); } catch (_) {} };
  const h = new Date().getHours();

  safe(() => {   // arrivals: nationalities it can fill
    if (typeof arrGuests === 'undefined' || !arrGuests.length) return;
    const miss = arrGuests.filter(g => !g.nat);
    if (!miss.length) return;
    const can = miss.filter(g => guessNat(g.name)).length;
    add({ id: 'arrNat:' + miss.length, type: 'arrNat', icon: '🌍', tone: 'warn',
      text: `${miss.length} arrival${miss.length > 1 ? 's have' : ' has'} no nationality. I can guess ${can ? can : 'none'} of them from the names${can ? '' : ' yet'}.`,
      why: can ? 'Uses what the team corrected before, then the name lists. Check the passport at check-in.' : 'Fill one in and I\'ll learn the surname.',
      acts: can ? [['Guess them now', () => { const before = arrGuests.filter(g => !g.nat).length; runAINat_arr(); setTimeout(() => { const after = arrGuests.filter(g => !g.nat).length; blDid('🌍', `Filled ${before - after} nationalit${before - after === 1 ? 'y' : 'ies'} on Arrivals${after ? `; ${after} I couldn't guess` : ''}.`); }, 300); }], ['Show me', () => showPanel('arrivals')]] : [['Show me', () => showPanel('arrivals')]] });
  });
  safe(() => {   // purpose: empty while arrivals are loaded
    if (typeof arrGuests === 'undefined' || typeof purposeGuests === 'undefined') return;
    if (arrGuests.length && !purposeGuests.length) add({ id: 'purSync:' + arrGuests.length, type: 'purSync', icon: '📋', tone: 'warn',
      text: `Arrivals has ${arrGuests.length} guests but Purpose of Stay is empty.`, why: 'Copy them over to start the purpose report.',
      acts: [['Copy them over', () => { syncFromArrivals(); blDid('📋', `Copied ${arrGuests.length} guests to Purpose of Stay.`); showPanel('purpose'); }]] });
  });
  safe(() => {   // purpose: nationalities
    if (typeof purposeGuests === 'undefined' || !purposeGuests.length) return;
    const miss = purposeGuests.filter(g => !g.nat);
    const can = miss.filter(g => guessNat(g.name)).length;
    if (can) add({ id: 'purNat:' + miss.length, type: 'purNat', icon: '🌍', tone: 'warn',
      text: `Purpose of Stay: ${miss.length} without nationality, I can guess ${can}.`, why: 'Based on names and the team\'s corrections.',
      acts: [['Guess them now', () => { runAINat_purpose(); blDid('🌍', `Guessed nationalities on Purpose of Stay.`); }]] });
  });
  safe(() => {   // duplicates on arrivals
    if (typeof arrGuests === 'undefined' || arrGuests.length < 2) return;
    const seen = new Set(), dups = [];
    arrGuests.forEach((g, i) => { const k = (g.conf || '').trim() ? 'c' + g.conf.trim() : 'n' + (g.room || '') + '|' + (g.name || '').trim().toUpperCase(); if (seen.has(k)) dups.push(i); else seen.add(k); });
    if (dups.length) add({ id: 'arrDup:' + dups.length, type: 'arrDup', icon: '👯', tone: 'bad',
      text: `${dups.length} guest${dups.length > 1 ? 's appear' : ' appears'} twice on Arrivals.`, why: 'Same confirmation number (or same room and name) loaded twice.',
      acts: [['Remove duplicates', () => { const n = dups.length; dups.reverse().forEach(i => arrGuests.splice(i, 1)); arrRender(); saveArrivals(arrGuests); blDid('👯', `Removed ${n} duplicate${n > 1 ? 's' : ''} from Arrivals.`); }]] });
  });
  safe(() => {   // late check-outs past their time
    if (typeof depRooms === 'undefined' || !depRooms.length || typeof isLcoOverdue !== 'function') return;
    const late = depRooms.filter(r => isLcoOverdue(r));
    if (late.length) add({ id: 'lco:' + late.map(r => r.roomStr).join(','), type: 'lco', icon: '⏰', tone: 'bad',
      text: `Room${late.length > 1 ? 's' : ''} ${late.slice(0, 4).map(r => r.roomStr).join(', ')}${late.length > 4 ? '…' : ''} passed the late check-out time.`, why: 'Call the room, or extend in Opera.',
      acts: [['Open Departures', () => showPanel('departures')]] });
  });
  safe(() => {   // DTCM month end
    if (typeof dtcRecon === 'undefined' || !dtcRecon || !dtcRecon.gap || !dtcRecon.gap.monthEnd) return;
    const me = dtcRecon.gap.monthEnd;
    if (!me.equal) add({ id: 'dtcMe:' + me.dtcm + ':' + me.opera, type: 'dtcMe', icon: '🏦', tone: 'bad',
      text: `DTCM and Opera won't tally at month end (${me.dtcm} vs ${me.opera}).`, why: 'Step B on DTCM Recon says which side to fix for each item.',
      acts: [['Open DTCM Recon', () => showPanel('dtcm')]] });
  });
  safe(() => {   // connection
    const live = /Live/.test(document.getElementById('fbLabel')?.textContent || '');
    blOfflineBeats = live ? 0 : blOfflineBeats + 1;
    if (blOfflineBeats >= 9) add({ id: 'offline', type: 'offline', icon: '📡', tone: 'warn',
      text: 'I\'ve been disconnected from the team database for a few minutes.', why: 'Your work is kept on this device and sent when the connection is back.',
      acts: [['Reconnect', () => location.reload()]] });
  });
  if (blLatestVersion && +blLatestVersion > +String(APP_VERSION).replace(/\D/g, '')) add({ id: 'update:' + blLatestVersion, type: 'update', icon: '✨', tone: 'warn',
    text: `A newer version (v${blLatestVersion}) is ready.`, why: 'Updating takes a few seconds. Fixes and new features are in it.', acts: [['Update now', () => appForceUpdate()]] });
  safe(() => {   // its own sense of routine
    if (typeof brHabits !== 'function') return;
    const hb = brHabits();
    const top = hb.atHour[0];
    if (top && top[1] >= 4 && top[0] !== hb.cur) add({ id: 'habit:' + top[0] + ':' + new Date().toDateString() + ':' + h, type: 'habit', icon: '🕘', tone: 'idle',
      text: `It's ${String(h).padStart(2, '0')}:00, this is when you usually open ${_brPanelName(top[0])}.`, why: `I've seen you do it ${top[1]} times around this hour.`,
      acts: [['Open it', () => showPanel(top[0])]] });
  });
  safe(() => {
    const d = new Date(), last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    if (d.getDate() >= last - 1) add({ id: 'monthEnd:' + d.toDateString(), type: 'monthEnd', icon: '🗂', tone: 'idle',
      text: 'Month end is here. Time for the DTCM month-end report and the package commission report.', why: 'Both print with signature lines.',
      acts: [['Open DTCM Recon', () => showPanel('dtcm')], ['Open Package Audit', () => showPanel('package-audit')]] });
  });
  return T;
}

// ── Deciding what to say (and learning what you want to hear) ─
function _blStats() { return _blLS.get(BL_STATS_KEY, {}); }
function _blNote(type, k) { const s = _blStats(); s[type] = s[type] || { shown: 0, used: 0, no: 0, never: false }; if (k === 'never') s[type].never = true; else s[type][k]++; _blLS.set(BL_STATS_KEY, s); }
function _blWanted(t) {
  const s = _blStats()[t.type];
  if (!s) return true;
  if (s.never && t.tone !== 'bad') return false;
  if (s.no >= 3 && s.used === 0 && t.tone === 'idle') return false;   // you never want this one
  return true;
}
const _blRank = t => ({ bad: 30, warn: 20, idle: 10 }[t.tone] || 0) + Math.min(10, ((_blStats()[t.type] || {}).used || 0) * 2);

function blSoon() { clearTimeout(blSoon._t); blSoon._t = setTimeout(blTick, 900); }

function blTick() {
  if (document.getElementById('appWrapper')?.style.display === 'none') return;
  const snooze = _blLS.get(BL_SNOOZE_KEY, {});
  blThoughts = blThink().filter(_blWanted).sort((a, b) => _blRank(b) - _blRank(a));
  const sig = blThoughts.map(t => t.id).join('|');
  const fab = document.getElementById('brFab');
  if (fab) { fab.classList.toggle('thinking', blThoughts.length > 0); fab.dataset.n = blThoughts.length || ''; }
  if (sig === blLastSig && document.getElementById('blBubble')) return;
  blLastSig = sig;
  if (document.getElementById('brSheet')?.classList.contains('open')) return;
  const next = blThoughts.find(t => !(snooze[t.id] > Date.now()));
  if (next && (!blShown || blShown.id !== next.id)) blSay(next);
  if (typeof brTab !== 'undefined' && brTab === 'think' && document.getElementById('brSheet')?.classList.contains('open')) blRenderFeed();
}

// ── Speaking ──────────────────────────────────────────────
function blSay(t, urgent) {
  if (!urgent && Date.now() - (blSay._last || 0) < 25000 && blShown) return;   // don't chatter
  blSay._last = Date.now();
  blShown = t;
  _blNote(t.type, 'shown');
  document.getElementById('blBubble')?.remove();
  const el = document.createElement('div');
  el.id = 'blBubble';
  el.className = 'bl-bubble ' + (t.tone || '');
  el.innerHTML = `<div class="bl-b-top"><span class="bl-b-i">${t.icon}</span><div class="bl-b-t"><b>${escapeHtml(t.text)}</b>${t.why ? `<small>${escapeHtml(t.why)}</small>` : ''}</div><button class="bl-b-x" title="Not now">✕</button></div>
    <div class="bl-b-acts">${(t.acts || []).map((a, i) => `<button class="btn ${i ? 'ghost' : 'gold'}" data-a="${i}">${escapeHtml(a[0])}</button>`).join('')}
      <button class="bl-b-never" title="Don't suggest this kind of thing again">Don't suggest this</button></div>`;
  el.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.a != null) { _blNote(t.type, 'used'); el.remove(); blShown = null; try { t.acts[+b.dataset.a][1](); } catch (err) { showToast('That did not work: ' + err.message, 'err'); } setTimeout(blTick, 800); return; }
    const sn = _blLS.get(BL_SNOOZE_KEY, {});
    if (b.classList.contains('bl-b-never')) { _blNote(t.type, 'never'); blDid('🤐', 'OK, I won\'t suggest that again. (🧠 → Learned to undo.)'); }
    else { _blNote(t.type, 'no'); sn[t.id] = Date.now() + 2 * 3600e3; }
    Object.keys(sn).forEach(k => { if (sn[k] < Date.now()) delete sn[k]; });
    _blLS.set(BL_SNOOZE_KEY, sn);
    el.remove(); blShown = null;
  });
  document.body.appendChild(el);
  blFeed.unshift({ at: Date.now(), icon: t.icon, text: t.text, kind: 'thought' });
  blFeed = blFeed.slice(0, 25);
}

/** Report something it did */
function blDid(icon, text) {
  blFeed.unshift({ at: Date.now(), icon, text, kind: 'did' });
  blFeed = blFeed.slice(0, 25);
  showToast(text, 'ok');
  if (typeof logActivity === 'function') try { logActivity('brain_did', text); } catch (_) {}
}

function blRenderFeed() {
  const box = document.getElementById('blFeed');
  if (!box) return;
  box.innerHTML = blFeed.length ? blFeed.slice(0, 10).map(f => `<div class="bl-feed-row ${f.kind}"><span>${f.icon}</span><span>${escapeHtml(f.text)}</span><small>${new Date(f.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</small></div>`).join('')
    : '<div class="br-empty">Nothing yet today. I\'m watching.</div>';
}

function blResetLearned() {
  if (!confirm('Let Ops Brain suggest everything again (undo every "Don\'t suggest this")?')) return;
  _blLS.set(BL_STATS_KEY, {}); _blLS.set(BL_SNOOZE_KEY, {});
  blDid('🧠', 'All suggestions are back on.');
}

// ── Version check (a new version on the server) ───────────
async function blCheckVersion() {
  try {
    const t = await (await fetch('sw.js?x=' + Date.now(), { cache: 'no-store' })).text();
    blLatestVersion = (t.match(/ibis-ops-shell-v(\d+)/) || [])[1] || null;
  } catch (_) {}
}

// ── Plug into the Ops Brain panel ─────────────────────────
function blExtendPanel() {
  const think = document.querySelector('.br-pane[data-t="think"]');
  if (think && !document.getElementById('blFeed')) think.insertAdjacentHTML('beforeend', '<div class="br-sec">What I noticed and did</div><div id="blFeed"></div>');
  const learned = document.getElementById('brLearned');
  if (learned && !document.getElementById('blLearnedBox')) {
    const nWords = Object.keys(blNatLearn).length;
    const st = _blStats();
    const off = Object.entries(st).filter(([, v]) => v.never).map(([k]) => k);
    learned.insertAdjacentHTML('beforeend', `<div class="br-card" id="blLearnedBox"><div class="br-title">Learned from your corrections</div>
      <div class="br-body">${nWords} name word${nWords === 1 ? '' : 's'} → nationality, from what the team typed. I use them before my own guesses.</div>
      <div class="br-title" style="margin-top:10px;">Suggestions you turned off</div>
      <div class="br-body">${off.length ? off.map(escapeHtml).join(', ') : 'None'}</div>
      <div class="br-acts"><button class="btn ghost" onclick="blResetLearned()">Turn all suggestions back on</button></div></div>`);
  }
  blRenderFeed();
}

document.addEventListener('DOMContentLoaded', () => {
  blNatLearn = _blLS.get(BL_NAT_KEY, {}) || {};
  setTimeout(() => {
    blHook();
    _blWrap('brTabShow', () => setTimeout(blExtendPanel, 0));
    _blWrap('brOpen', () => { document.getElementById('blBubble')?.remove(); blShown = null; });
    _blWrap('showPanel', () => blSoon());
    if (typeof fbListen === 'function') fbListen('brain/natLearn', v => { if (v && typeof v === 'object') { blNatLearn = v; _blLS.set(BL_NAT_KEY, v); } });
    blCheckVersion();
    setInterval(blCheckVersion, 30 * 60e3);
    setInterval(blTick, 20000);
    setTimeout(blTick, 4000);
  }, 1800);
});
