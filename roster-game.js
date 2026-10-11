// ═══════════════════════════════════════════════════════════
//  roster-game.js — 🎯 Rush Hour: a one-minute front desk game
//  Inside the 🎮 Live desk. Guests queue at the desk with a request;
//  tap them before they lose patience. VIPs pay more and wait less,
//  ☕ slows everyone down, and the cat… does not want a room.
//  Plus 🏅 badges for playing around in the live desk.
// ═══════════════════════════════════════════════════════════

const LG_REQ = [['🔑', 'Check-in!'], ['🧾', 'Check-out'], ['📶', 'WiFi pwd?'], ['🧳', 'My bags!'], ['🚕', 'Taxi pls'], ['🛏', 'Upgrade?'], ['🗺', 'Dubai Mall?'], ['🍳', 'Breakfast?'], ['🕐', 'Late check-out?'], ['🔌', 'Adapter?'], ['🧺', 'An iron?'], ['🏊', 'Pool open?'], ['🅿️', 'Parking?'], ['🔁', 'New room!']];
const LG_THANKS = ['Shukran!', 'Merci!', 'Thanks!', 'Danke!', 'Grazie!', 'Gracias!', 'Obrigado!', 'Спасибо!', '谢谢!', 'ありがとう!', 'Dhanyavaad!', 'Salamat!'];
const LG_RANKS = [[0, '🐣', 'Trainee', 'Everyone starts somewhere. Coffee, then again!'], [120, '🛎', 'Receptionist', 'Solid shift. The guests made it upstairs.'], [260, '⭐', 'Supervisor', 'Calm under pressure. Promotion talks soon.'], [430, '🏆', 'Duty Manager', 'Running the lobby like a pro.'], [650, '👑', 'Front Desk Legend', 'They will tell stories about this shift.']];
const LG_TIME = 60000;
const _lgSlots = () => (_lg && _lg.slots) || 5;   // 4 places in the queue on a phone, 5 on a wider screen
let _lg = null;

function _lgBest() { try { return +localStorage.getItem('lv_best') || 0; } catch (_) { return 0; } }
function _lgSnd(f, d, t) { if (typeof _lvBeep === 'function') _lvBeep(f, d, t); }
/** Who is behind the desk: you, else whoever is on now, else a cartoon trainee. */
function _lgHero() {
  if (typeof roMeKey !== 'undefined' && roMeKey && roStaff[roMeKey]) return roMeKey;
  try { const S = lvScene(Date.now()).find(x => x.on.length); if (S) return S.on[0].key; } catch (_) {}
  return '~gHero';
}

/** The start screen. */
function lgOpen() {
  const body = document.getElementById('lvBody'); if (!body) return;
  lgStop();
  let g = document.getElementById('lvGame');
  if (!g) { g = document.createElement('div'); g.id = 'lvGame'; body.parentNode.insertBefore(g, body); }
  body.style.display = 'none';
  const hero = _lgHero(), nm = roStaff[hero] ? roStaff[hero].name.split(' ')[0] : 'You';
  g.innerHTML = `<div class="lg-card lg-start">
    <div class="lg-logo"><i>🎯</i> <span>RUSH HOUR</span></div>
    <div class="lg-hero">${avSvg(hero, 74, 'cheer')}</div>
    <p><b>${escapeHtml(nm)}</b> is alone at the desk and the lobby is filling up!</p>
    <ul class="lg-how"><li>👆 Tap a guest to serve them before their bar runs out</li><li>⚡ Serve fast in a row for a combo (up to ×5)</li><li>👑 VIPs pay triple but wait less</li><li>☕ Tap the coffee: everyone calms down for a bit</li><li>🐈 Don't serve the cat. It does not want a room</li><li>❤️ 3 angry guests and the shift is over</li></ul>
    <div class="lg-best">🏆 Best: <b>${_lgBest()}</b></div>
    <div class="lg-btns"><button class="btn lg-go" onclick="lgStart()">▶ Start the shift</button><button class="btn ghost" onclick="lgExit()">🏨 Back to the lobby</button></div>
  </div>`;
}
function lgExit() { lgStop(); document.getElementById('lvGame')?.remove(); const b = document.getElementById('lvBody'); if (b) b.style.display = ''; }
function lgStop() { if (_lg) { clearInterval(_lg.tick); clearTimeout(_lg.cd); } _lg = null; }

/** 3, 2, 1, GO! */
function lgStart() {
  const g = document.getElementById('lvGame'); if (!g) return;
  lgStop();
  const hero = _lgHero();
  g.innerHTML = `<div class="lg-card lg-play">
    <div class="lg-hud"><span class="lg-score">⭐ <b id="lgScore">0</b></span><span class="lg-combo" id="lgCombo"></span><span class="lg-lives" id="lgLives">❤️❤️❤️</span><span class="lg-clock">⏱ <b id="lgTime">60</b></span></div>
    <div class="lg-tbar"><i id="lgTbar"></i></div>
    <div class="lg-scene" id="lgScene">
      <div class="lg-wall"><span class="lg-sign">RECEPTION</span><div class="lv-lift lg-lift"><i class="l"></i><i class="r"></i><span>▲</span></div></div>
      <div class="lg-staff">${avSvg(hero, 70, 'happy')}</div>
      <div class="lg-desk"><span>🛎</span><b>FRONT DESK</b><span>🪴</span></div>
      <div class="lg-lane" id="lgLane"></div>
      <div class="lg-fx" id="lgFx"></div>
      <div class="lg-count" id="lgCount">3</div>
    </div>
  </div>`;
  _lg = { score: 0, combo: 1, bestCombo: 1, lives: 3, served: 0, angry: 0, cats: 0, guests: [], n: 0, t0: 0, last: 0, lastServe: 0, calmUntil: 0, nextSpawn: 0, over: false };
  { const sc = document.getElementById('lgScene'); _lg.slots = sc && sc.clientWidth < 420 ? 4 : 5; }
  let c = 3; _lgSnd(440, 0.12);
  const step = () => {
    const el = document.getElementById('lgCount'); if (!el || !_lg) return;
    c--; if (c > 0) { el.textContent = c; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); _lgSnd(440, 0.12); _lg.cd = setTimeout(step, 700); return; }
    el.textContent = 'GO!'; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); _lgSnd(880, 0.25);
    _lg.cd = setTimeout(() => el.remove(), 600);
    _lg.t0 = _lg.last = Date.now(); _lg.nextSpawn = _lg.t0 + 300;
    _lg.tick = setInterval(_lgTick, 80);
  };
  _lg.cd = setTimeout(step, 700);
}

function _lgSpawn(now) {
  const L = _lg, free = []; for (let i = 0; i < _lgSlots(); i++) if (!L.guests.some(x => x.slot === i)) free.push(i);
  if (!free.length) return;
  const el = now - L.t0, r = Math.random();
  const kind = el > 8000 && r < 0.09 ? 'cat' : el > 5000 && r < 0.2 ? 'vip' : r > 0.94 && Date.now() > L.calmUntil ? 'coffee' : 'guest';
  const patience = kind === 'cat' ? 4200 : kind === 'coffee' ? 3500 : Math.max(3000, 7600 - el * 0.07) * (kind === 'vip' ? 0.7 : 1);
  const G = { id: ++L.n, slot: free[Math.floor(Math.random() * free.length)], kind, born: now, patience, waited: 0, req: LG_REQ[Math.floor(Math.random() * LG_REQ.length)] };
  L.guests.push(G);
  const lane = document.getElementById('lgLane'); if (!lane) return;
  const d = document.createElement('div'); d.className = 'lg-g ' + kind; d.id = 'lgG' + G.id; d.style.left = (6 + G.slot * (88 / _lgSlots())) + '%'; d.style.width = (88 / _lgSlots()) + '%';
  const face = kind === 'cat' ? '<span class="lg-emo">🐈</span>' : kind === 'coffee' ? '<span class="lg-emo">☕</span>' : avSvg('~g' + G.id + '_' + L.t0, 54, 'happy');
  const bub = kind === 'cat' ? '😺 Meow?' : kind === 'coffee' ? '☕ Tap me!' : `${G.req[0]} ${G.req[1]}`;
  d.innerHTML = `<div class="lg-bub">${escapeHtml(bub)}</div><div class="lg-pat"><i></i></div><div class="lg-av">${kind === 'vip' ? '<span class="lg-crown">👑</span>' : ''}${face}</div>${kind === 'guest' || kind === 'vip' ? '<span class="lg-bag">🧳</span>' : ''}`;
  d.addEventListener('pointerdown', e => { e.preventDefault(); lgTap(G.id); });
  lane.appendChild(d);
}
function _lgFloat(x, txt, cls) {
  const fx = document.getElementById('lgFx'); if (!fx) return;
  const e = document.createElement('span'); e.className = 'lg-float ' + (cls || ''); e.textContent = txt; e.style.left = x + '%';
  fx.appendChild(e); setTimeout(() => e.remove(), 1100);
}
function _lgLeave(G, how) {
  const d = document.getElementById('lgG' + G.id); _lg.guests = _lg.guests.filter(x => x !== G);
  if (!d) return; d.classList.add(how); d.style.pointerEvents = 'none'; setTimeout(() => d.remove(), 900);
}
/** Tap a guest. */
function lgTap(id) {
  const L = _lg; if (!L || L.over || !L.t0) return;
  const G = L.guests.find(x => x.id === id); if (!G) return;
  const x = 6 + G.slot * (88 / _lgSlots()) + 6, now = Date.now();
  if (G.kind === 'cat') { L.score = Math.max(0, L.score - 15); L.combo = 1; L.cats++; _lgFloat(x, '🐈 It wanted a nap, not a room! −15', 'bad'); _lgSnd(220, 0.25, 'sawtooth'); _lgLeave(G, 'gone'); _lgHud(); return; }
  if (G.kind === 'coffee') { L.calmUntil = now + 5000; _lgFloat(x, '☕ Coffee break! Everyone calms down', 'good'); _lgSnd(660, 0.1); setTimeout(() => _lgSnd(990, 0.15), 100); _lgLeave(G, 'served'); document.getElementById('lgScene')?.classList.add('calm'); _lgHud(); return; }
  L.combo = now - L.lastServe < 1600 ? Math.min(5, L.combo + 1) : 1; L.bestCombo = Math.max(L.bestCombo, L.combo); L.lastServe = now;
  const left = 1 - G.waited / G.patience, pts = Math.round((G.kind === 'vip' ? 30 : 10) * L.combo * (left > 0.6 ? 1.5 : 1));
  L.score += pts; L.served++;
  _lgFloat(x, `+${pts} ${LG_THANKS[Math.floor(Math.random() * LG_THANKS.length)]}`, G.kind === 'vip' ? 'vip' : 'good');
  _lgSnd(600 + L.combo * 120, 0.09, 'triangle');
  _lgLeave(G, 'served');
  const st = document.querySelector('.lg-staff'); if (st) { st.classList.remove('hop'); void st.offsetWidth; st.classList.add('hop'); }
  if (L.combo >= 5) lvBadge('combo5', '🔥 On fire: a ×5 combo in Rush Hour');
  _lgHud();
}
function _lgHud() {
  const L = _lg; if (!L) return;
  const s = document.getElementById('lgScore'); if (s) s.textContent = L.score;
  const c = document.getElementById('lgCombo'); if (c) { c.textContent = L.combo > 1 ? `⚡ ×${L.combo}` : ''; c.className = 'lg-combo' + (L.combo > 1 ? ' on c' + L.combo : ''); }
  const h = document.getElementById('lgLives'); if (h) h.textContent = '❤️'.repeat(Math.max(0, L.lives)) + '🖤'.repeat(Math.min(3, Math.max(0, 3 - L.lives)));
}
function _lgTick() {
  const L = _lg; if (!L || L.over) return;
  const now = Date.now(), dt = now - L.last; L.last = now;
  const el = now - L.t0, calm = now < L.calmUntil;
  if (!calm) document.getElementById('lgScene')?.classList.remove('calm');
  if (now >= L.nextSpawn) { _lgSpawn(now); L.nextSpawn = now + Math.max(650, 1600 - el * 0.018) * (0.7 + Math.random() * 0.6); }
  L.guests.slice().forEach(G => {
    G.waited += calm && G.kind !== 'cat' ? dt * 0.25 : dt;
    const left = Math.max(0, 1 - G.waited / G.patience), d = document.getElementById('lgG' + G.id);
    if (d) { const i = d.querySelector('.lg-pat i'); if (i) { i.style.width = (left * 100) + '%'; i.style.background = left > 0.5 ? '#22c55e' : left > 0.25 ? '#f59e0b' : '#ef4444'; } d.classList.toggle('mad', left < 0.25 && G.kind !== 'cat' && G.kind !== 'coffee'); }
    if (left > 0) return;
    if (G.kind === 'cat' || G.kind === 'coffee') { _lgLeave(G, 'gone'); return; }
    L.lives--; L.angry++; L.combo = 1;
    _lgFloat(6 + G.slot * (88 / _lgSlots()) + 6, ['😡 1 star!', '😤 Never again!', '🤬 Where\'s the manager?!', '😠 I\'ll write a review!'][G.id % 4], 'bad');
    _lgSnd(160, 0.3, 'sawtooth');
    const sc = document.getElementById('lgScene'); if (sc) { sc.classList.remove('shake'); void sc.offsetWidth; sc.classList.add('shake'); }
    _lgLeave(G, 'angry'); _lgHud();
  });
  const tl = Math.max(0, LG_TIME - el), tb = document.getElementById('lgTbar'), tt = document.getElementById('lgTime');
  if (tb) tb.style.width = (tl / LG_TIME * 100) + '%'; if (tt) tt.textContent = Math.ceil(tl / 1000);
  if (tl <= 10000 && tb) tb.classList.add('hurry');
  if (L.lives <= 0 || tl <= 0) _lgEnd(L.lives <= 0 ? 'lives' : 'time');
}
function _lgEnd(why) {
  const L = _lg; if (!L) return; L.over = true; clearInterval(L.tick);
  const best = _lgBest(), rec = L.score > best; if (rec) { try { localStorage.setItem('lv_best', String(L.score)); } catch (_) {} }
  const R = LG_RANKS.slice().reverse().find(r => L.score >= r[0]) || LG_RANKS[0];
  if (L.score >= 260) lvBadge('sup', '⭐ Supervisor material: 260+ in Rush Hour');
  if (L.score >= 650) lvBadge('legend', '👑 Front Desk Legend: 650+ in Rush Hour');
  if (L.cats >= 3) lvBadge('cat', '🐈 Cat whisperer: served the cat 3 times (why?)');
  [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => _lgSnd(f, 0.18, 'triangle'), i * 130));
  const g = document.getElementById('lvGame'); if (!g) return;
  g.innerHTML = `<div class="lg-card lg-end">
    <div class="lg-logo">${why === 'lives' ? '<i>😵</i> <span>SHIFT OVER</span>' : '<i>🏁</i> <span>END OF SHIFT</span>'}</div>
    <div class="lg-rank"><span>${R[1]}</span><b>${R[2]}</b><small>${escapeHtml(R[3])}</small></div>
    <div class="lg-big">${L.score}${rec ? '<em>🎉 New best!</em>' : ''}</div>
    <div class="lg-res"><span>😊 <b>${L.served}</b> served</span><span>😡 <b>${L.angry}</b> angry</span><span>⚡ best combo <b>×${L.bestCombo}</b></span><span>🐈 <b>${L.cats}</b> cats served</span></div>
    <div class="lg-best">🏆 Best: <b>${Math.max(best, L.score)}</b></div>
    <div class="lg-btns"><button class="btn lg-go" onclick="lgStart()">🔁 Play again</button><button class="btn ghost" onclick="lgExit()">🏨 Back to the lobby</button></div>
  </div>`;
  if (rec) _lgConfetti(g);
}
function _lgConfetti(box) {
  const card = box.querySelector('.lg-card'); if (!card) return;
  for (let i = 0; i < 40; i++) { const c = document.createElement('i'); c.className = 'lg-conf'; c.style.left = Math.random() * 100 + '%'; c.style.background = ['#f43f5e', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#eab308'][i % 6]; c.style.animationDelay = (Math.random() * 0.6) + 's'; c.style.setProperty('--r', (Math.random() * 720 - 360) + 'deg'); card.appendChild(c); setTimeout(() => c.remove(), 2600); }
}

// ── 🏅 Badges: little rewards for playing around ────────────
function _lvBadges() { try { return JSON.parse(localStorage.getItem('lv_badges') || '{}'); } catch (_) { return {}; } }
function lvBadge(id, text) {
  const B = _lvBadges(); if (B[id]) return; B[id] = Date.now();
  try { localStorage.setItem('lv_badges', JSON.stringify(B)); } catch (_) {}
  if (typeof showToast === 'function') showToast('🏅 Badge: ' + text, 'ok');
  _lgSnd(784, 0.12, 'triangle'); setTimeout(() => _lgSnd(1175, 0.2, 'triangle'), 120);
  lvBadgesRender();
}
const LV_BADGES = [['poke', '👉', 'First poke'], ['poke10', '🤪', 'Poke master'], ['ding10', '🛎', 'Bell addict'], ['night', '🦉', 'Night watch'], ['disco', '🪩', 'Disco time'], ['combo5', '🔥', 'On fire'], ['sup', '⭐', 'Supervisor material'], ['legend', '👑', 'Legend'], ['cat', '🐈', 'Cat whisperer']];
function lvBadgesRender() {
  const el = document.getElementById('lvBadges'); if (!el) return;
  const B = _lvBadges();
  el.innerHTML = '🏅 ' + LV_BADGES.map(([id, e, t]) => `<span class="lv-badge${B[id] ? ' on' : ''}" title="${escapeHtml(t)}${B[id] ? '' : ' (locked)'}">${B[id] ? e : '🔒'}</span>`).join('') + ` <small>${Object.keys(B).length}/${LV_BADGES.length}</small>`;
}
