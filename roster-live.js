// ═══════════════════════════════════════════════════════════
//  roster-live.js — 🎮 the live desk, and everyone's cartoon look
//  Each hotel's reception as a little scene: who is behind the desk now,
//  how far into their shift they are, a funny line for each, who walks in
//  next and who just went home. ▶ plays the whole day in 20 seconds.
//  Looks: a cartoon for everyone. We never guess anyone's looks from their
//  name: each person picks their own (skin, hair, extras) on their card.
//  Stored on the person: rbPeople[k].look = { skin, hair, acc, shirt }
// ═══════════════════════════════════════════════════════════

const AV_SKIN = ['#f9dcc4', '#efc39a', '#d9a273', '#b07548', '#7a4a2b', '#4f2f1c'];
const AV_HAIR = [['short', 'Short'], ['long', 'Long'], ['curly', 'Curly'], ['bun', 'Bun'], ['spiky', 'Spiky'], ['hijab', 'Hijab'], ['turban', 'Turban'], ['cap', 'Cap'], ['bald', 'None']];
const AV_ACC = [['none', 'Nothing'], ['glasses', '👓 Glasses'], ['shades', '🕶 Shades'], ['headset', '🎧 Headset'], ['beard', 'Beard'], ['bowtie', '🎀 Bow tie']];
const AV_SHIRT = ['#3b6fd8', '#2f9e74', '#c2410c', '#7c3aed', '#be185d', '#0e7490', '#4b5563', '#a16207'];
const AV_HAIRCOL = ['#2b1d14', '#3d2a1c', '#5a3a22', '#1c1c1c', '#7b4a22', '#4a3b2f'];
const AV_SCARF = ['#1f2937', '#6b2140', '#1e3a5f', '#3f4a2a', '#5b3b74', '#2a4a4a'];

function _avHash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
/** Their look: what they picked, else a playful start (hair and colours from their name's letters, nothing guessed). */
function avLook(k) {
  const c = ((typeof rbPeople !== 'undefined' && rbPeople[k]) || {}).look || {}, h = _avHash(k + ((roStaff[k] || {}).name || ''));
  return {
    skin: c.skin != null ? c.skin : 2,
    hair: c.hair || ['short', 'long', 'curly', 'bun', 'spiky'][h % 5],
    acc: c.acc || (h % 7 === 0 ? 'glasses' : h % 11 === 0 ? 'headset' : 'none'),
    shirt: c.shirt != null ? c.shirt : (h >> 3) % AV_SHIRT.length,
    hc: (h >> 7) % AV_HAIRCOL.length,
  };
}
/** A cartoon face (SVG). mood: happy · busy · tired · sleepy · cheer. */
function avSvg(k, size, mood) {
  const L = avLook(k), skin = AV_SKIN[L.skin] || AV_SKIN[2], hc = AV_HAIRCOL[L.hc], sh = AV_SHIRT[L.shirt] || AV_SHIRT[0], sc = AV_SCARF[L.hc % AV_SCARF.length];
  const hair = {
    short: `<path d="M17 27c0-10 7-15 15-15s15 5 15 15c-3-5-8-7-15-7s-12 2-15 7z" fill="${hc}"/>`,
    long: `<path d="M15 30c0-12 7-18 17-18s17 6 17 18v16c-3 0-4-3-4-6V28c-3-4-7-6-13-6s-10 2-13 6v12c0 3-1 6-4 6z" fill="${hc}"/>`,
    curly: `<g fill="${hc}"><circle cx="20" cy="22" r="6"/><circle cx="27" cy="16" r="6"/><circle cx="35" cy="15" r="6"/><circle cx="42" cy="19" r="6"/><circle cx="45" cy="26" r="5"/><circle cx="18" cy="28" r="4"/></g>`,
    bun: `<g fill="${hc}"><circle cx="32" cy="9" r="6"/><path d="M17 28c0-10 7-16 15-16s15 6 15 16c-3-6-8-8-15-8s-12 2-15 8z"/></g>`,
    spiky: `<path d="M17 27l2-9 4 4 3-9 4 6 3-8 3 7 4-6 2 8 4-3 1 10c-4-5-9-7-15-7s-11 2-15 7z" fill="${hc}"/>`,
    hijab: `<path d="M13 34c0-14 8-23 19-23s19 9 19 23v18H13z" fill="${sc}"/>`,
    turban: `<g><path d="M15 26c0-10 8-15 17-15s17 5 17 15c0 2-1 3-2 3H17c-1 0-2-1-2-3z" fill="${sc}"/><path d="M18 21c6-4 22-4 28 0" stroke="rgba(255,255,255,.25)" stroke-width="2" fill="none"/></g>`,
    cap: `<g><path d="M16 26c0-9 7-14 16-14s16 5 16 14z" fill="${sh}"/><path d="M30 25h22c0 2-2 3-4 3H30z" fill="${sh}" opacity=".85"/></g>`,
    bald: '',
  }[L.hair] || '';
  const face = L.hair === 'hijab' ? `<ellipse cx="32" cy="33" rx="12" ry="13" fill="${skin}"/>` : `<ellipse cx="32" cy="32" rx="14" ry="15" fill="${skin}"/>`;
  const eyes = mood === 'sleepy' ? '<path d="M24 31h5M35 31h5" stroke="#2b2b2b" stroke-width="2" stroke-linecap="round"/>'
    : `<g class="av-eyes"><circle cx="26.5" cy="31" r="2.2" fill="#2b2b2b"/><circle cx="37.5" cy="31" r="2.2" fill="#2b2b2b"/></g>`;
  const mouth = mood === 'tired' ? '<path d="M27 40h10" stroke="#7a3b2e" stroke-width="2" stroke-linecap="round"/>'
    : mood === 'sleepy' ? '<ellipse cx="32" cy="40.5" rx="2.5" ry="2" fill="#7a3b2e"/>'
    : mood === 'cheer' ? '<path d="M26 38c2 5 10 5 12 0z" fill="#7a3b2e"/>'
    : '<path d="M26.5 38.5c2 3 9 3 11 0" stroke="#7a3b2e" stroke-width="2" fill="none" stroke-linecap="round"/>';
  const acc = {
    glasses: '<g stroke="#222" stroke-width="1.6" fill="rgba(255,255,255,.18)"><circle cx="26.5" cy="31" r="4.3"/><circle cx="37.5" cy="31" r="4.3"/><path d="M30.8 31h2.4"/></g>',
    shades: '<g fill="#111"><rect x="21.5" y="28" width="9" height="6" rx="2.5"/><rect x="33.5" y="28" width="9" height="6" rx="2.5"/><path d="M30.5 30h3" stroke="#111" stroke-width="1.6"/></g>',
    headset: '<g fill="none" stroke="#333" stroke-width="2.4"><path d="M17 32c0-10 7-16 15-16s15 6 15 16"/></g><rect x="14" y="29" width="5" height="8" rx="2" fill="#333"/><rect x="45" y="29" width="5" height="8" rx="2" fill="#333"/><path d="M47 37c0 5-5 7-10 7" stroke="#333" stroke-width="1.6" fill="none"/>',
    beard: `<path d="M19 34c1 10 6 14 13 14s12-4 13-14c-2 4-6 6-13 6s-11-2-13-6z" fill="${hc}"/>`,
    bowtie: '<path d="M26 56l6 3 6-3v6l-6-3-6 3z" fill="#e11d48"/>',
  }[L.acc] || '';
  return `<svg class="av" viewBox="0 0 64 64" width="${size || 40}" height="${size || 40}" aria-hidden="true"><rect x="12" y="48" width="40" height="18" rx="9" fill="${sh}"/>${L.hair === 'hijab' ? hair : ''}<rect x="28" y="43" width="8" height="7" fill="${skin}"/>${face}${L.hair !== 'hijab' ? hair : ''}${eyes}${mouth}${acc}</svg>`;
}

// ── The look, on their card ───────────────────────────────
function avCardHtml(k) {
  const L = avLook(k), q = typeof _rtQ === 'function' ? _rtQ(k) : JSON.stringify(k);
  const chip = (f, v, label, on) => `<button class="av-chip${on ? ' on' : ''}" onclick="avSet(${q},'${f}',${typeof v === 'number' ? v : `'${v}'`})">${label}</button>`;
  return `<details class="av-card"><summary><span class="av-prev">${avSvg(k, 34, 'happy')}</span>😀 Their look <small>for the live desk · they choose</small></summary>
    <div class="av-row"><span>Skin</span>${AV_SKIN.map((c, i) => `<button class="av-dot${L.skin === i ? ' on' : ''}" style="background:${c}" onclick="avSet(${q},'skin',${i})" aria-label="Skin tone ${i + 1}"></button>`).join('')}</div>
    <div class="av-row"><span>Hair</span>${AV_HAIR.map(([v, t]) => chip('hair', v, t, L.hair === v)).join('')}</div>
    <div class="av-row"><span>Extra</span>${AV_ACC.map(([v, t]) => chip('acc', v, t, L.acc === v)).join('')}</div>
    <div class="av-row"><span>Shirt</span>${AV_SHIRT.map((c, i) => `<button class="av-dot${L.shirt === i ? ' on' : ''}" style="background:${c}" onclick="avSet(${q},'shirt',${i})" aria-label="Shirt colour ${i + 1}"></button>`).join('')}</div>
  </details>`;
}
function avSet(k, f, v) {
  const look = Object.assign({}, (rbPeople[k] || {}).look, { [f]: v });
  if (typeof rtSet === 'function') rtSet(k, 'look', look);
  const el = document.querySelector('#rtSheet .av-card'); if (el) { const open = el.open; el.outerHTML = avCardHtml(k); const n = document.querySelector('#rtSheet .av-card'); if (n) n.open = open; }
  if (document.getElementById('lvView')) lvRender();
}

// ── 🎮 The live desk ──────────────────────────────────────
let _lvT = null, _lvAt = null, _lvPlay = null;   // _lvAt: a time picked on the slider (null = now)
function _lvHotelOf(x) {
  const own = (roStaff[x.key] || {}).group || '';
  if (!x.info.note) return own;
  const n = x.info.note.toLowerCase();
  return roGroups().find(g => g.toLowerCase().startsWith(n) || g.toLowerCase().split(' ')[0] === n.split(' ')[0]) || own;
}
const LV_LINES = [
  [0.08, ['☕ Just arrived. Coffee first', '👋 Hello team!', '🔑 Opening the shift']],
  [0.3, ['😄 Checking guests in', '💪 Fresh and ready', '🛎 Ding ding!']],
  [0.55, ['🧾 In the zone', '📞 On the phone again', '🗝 Keys, keys, keys']],
  [0.7, ['🥪 Snack time?', '😌 Halfway there', '💬 Small talk with a guest']],
  [0.9, ['⏳ Almost there', '📝 Writing the handover', '🧮 Counting the float']],
  [1.01, ['🏃 Home time soon!', '🏁 Last stretch!', '🛌 Bed is calling']],
];
function _lvLine(k, p, t, alone, night) {
  const h = _avHash(k + Math.floor(t / 9e5));   // changes every 15 minutes
  if (night && new Date(t).getHours() >= 2 && new Date(t).getHours() < 6) return ['😴 Stay awake…', '🌙 Night owl mode', '🦉 Guarding the lobby'][h % 3];
  if (alone && p > 0.1 && p < 0.9 && h % 3 === 0) return '🦸 Holding the fort alone';
  const row = LV_LINES.find(r => p < r[0]) || LV_LINES[LV_LINES.length - 1];
  return row[1][h % row[1].length];
}
function lvScene(t) {
  const now = new Date(t), all = [];
  const today = roIso(now);
  [roAdd(today, -1), today, roAdd(today, 1)].forEach(day => roPeople(day, true).forEach(x => { const sp = roSpan(day, x.info); if (sp) all.push(Object.assign({ sp, hotel: _lvHotelOf(x) }, x)); }));
  const hotels = roGroups().length ? roGroups() : [''];
  return hotels.map(g => {
    const mine = all.filter(x => x.hotel === g || (!g && !x.hotel));
    const on = mine.filter(x => x.sp.start <= now && now < x.sp.end).sort((a, b) => a.sp.start - b.sp.start);
    const coming = mine.filter(x => x.sp.start > now && x.sp.start - now <= 2 * 36e5).sort((a, b) => a.sp.start - b.sp.start);
    const gone = mine.filter(x => x.sp.end <= now && now - x.sp.end <= 40 * 6e4);
    return { g, on, coming, gone };
  });
}
function _lvHM(d) { return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
function lvHotelHtml(S, t) {
  const now = new Date(t), hr = now.getHours(), night = hr < 6 || hr >= 21;
  const person = (x, kind) => {
    const p = Math.max(0, Math.min(1, (now - x.sp.start) / (x.sp.end - x.sp.start)));
    const nightShift = x.info.type === 'night';
    const mood = kind !== 'on' ? 'happy' : night && hr >= 2 && hr < 6 ? 'sleepy' : p > 0.85 ? 'cheer' : p > 0.6 ? 'tired' : 'happy';
    const left = Math.max(0, Math.round((x.sp.end - now) / 6e4)), lh = Math.floor(left / 60), lm = left % 60;
    const bubble = kind === 'coming' ? `🚶 In at ${_lvHM(x.sp.start)}` : kind === 'gone' ? '👋 Bye, see you!' : _lvLine(x.key, p, t, S.on.length === 1, nightShift);
    const d = (_avHash(x.key) % 9) / 10;
    return `<div class="lv-p ${kind}${x.key === roMeKey ? ' me' : ''}" style="--d:${d}s" title="${escapeHtml(x.name)} · ${escapeHtml(roTime(x.info))}">
      <div class="lv-bub">${escapeHtml(bubble)}</div>
      <div class="lv-body">${avSvg(x.key, 54, mood)}</div>
      <b class="lv-nm">${escapeHtml(String(x.name).split(' ')[0])}</b>
      ${kind === 'on' ? `<div class="lv-bar" title="${Math.round(p * 100)}% done"><i style="width:${(p * 100).toFixed(1)}%"></i></div><small>${lh ? lh + ' h ' : ''}${lm} min left</small>` : `<small>${escapeHtml(roTime(x.info))}</small>`}
    </div>`;
  };
  const together = S.on.length >= 2;
  return `<div class="lv-hotel${night ? ' night' : ''}">
    <div class="lv-hd"><b>${escapeHtml(S.g || 'Reception')}</b><span>${S.on.length ? `${S.on.length} on now` : '⚠ nobody on now'}${together ? ' · 🤝 together' : ''}${S.coming.length ? ` · next: ${escapeHtml(String(S.coming[0].name).split(' ')[0])} ${_lvHM(S.coming[0].sp.start)}` : ''}</span></div>
    <div class="lv-stage">
      <div class="lv-sky">${night ? '<span class="lv-moon">🌙</span><i class="lv-star" style="left:12%;top:18%"></i><i class="lv-star" style="left:70%;top:12%"></i><i class="lv-star" style="left:40%;top:28%"></i>' : '<span class="lv-sun">☀️</span>'}<span class="lv-clock">${_lvHM(now)}</span></div>
      <div class="lv-row">${S.gone.map(x => person(x, 'gone')).join('')}${S.on.map(x => person(x, 'on')).join('') || '<div class="lv-empty">🛎 The bell is waiting…</div>'}${S.coming.map(x => person(x, 'coming')).join('')}</div>
      <div class="lv-desk"><span>🛎</span>RECEPTION<span>🪴</span></div>
    </div>
  </div>`;
}
function lvRender() {
  const box = document.getElementById('lvBody'); if (!box) return;
  const t = _lvAt != null ? _lvAt : Date.now(), d0 = roDate(roToday()).getTime();
  box.innerHTML = lvScene(t).map(S => lvHotelHtml(S, t)).join('') || '<div class="ro-empty">No roster for today yet.</div>';
  const sl = document.getElementById('lvSlider'); if (sl && document.activeElement !== sl) sl.value = Math.round((t - d0) / 6e4);
  const lb = document.getElementById('lvWhen'); if (lb) lb.textContent = _lvAt == null ? 'Live now' : _lvHM(new Date(t));
}
function lvOpen() {
  document.getElementById('lvView')?.remove();
  const d = document.createElement('div'); d.id = 'lvView'; d.className = 'ri-viewer lv-view';
  d.innerHTML = `<div class="card lv-card">
    <div class="ro-card-hd"><b>🎮 Live desk</b><button class="ro-x" onclick="lvClose()">✕</button></div>
    <div class="lv-ctl"><button class="btn sm" id="lvPlayB" onclick="lvPlay()">▶ Play the day</button><input type="range" id="lvSlider" min="0" max="1439" step="5" oninput="lvSeek(+this.value)"><span id="lvWhen">Live now</span><button class="btn sm ghost" onclick="lvSeek(null)">Now</button></div>
    <div id="lvBody" class="lv-body-wrap"></div>
    <small class="ro-hint">Each person's bar is how far into their shift they are. Their look is theirs to choose: tap a name in 🧑‍💼 Team → 😀 Their look.</small>
  </div>`;
  d.addEventListener('click', e => { if (e.target === d) lvClose(); });
  document.body.appendChild(d);
  _lvAt = null; lvRender();
  clearInterval(_lvT); _lvT = setInterval(() => { if (!document.getElementById('lvView')) { clearInterval(_lvT); return; } if (_lvAt == null) lvRender(); }, 30000);
}
function lvClose() { clearInterval(_lvT); clearInterval(_lvPlay); _lvPlay = null; document.getElementById('lvView')?.remove(); }
function lvSeek(min) { clearInterval(_lvPlay); _lvPlay = null; const b = document.getElementById('lvPlayB'); if (b) b.textContent = '▶ Play the day'; _lvAt = min == null ? null : roDate(roToday()).getTime() + min * 6e4; lvRender(); }
/** ▶ the whole day in about 20 seconds: people walk in, work, walk home. */
function lvPlay() {
  const b = document.getElementById('lvPlayB');
  if (_lvPlay) { clearInterval(_lvPlay); _lvPlay = null; if (b) b.textContent = '▶ Play the day'; return; }
  if (b) b.textContent = '⏸ Pause';
  const d0 = roDate(roToday()).getTime(); let m = _lvAt != null && _lvAt - d0 < 1430 * 6e4 ? Math.round((_lvAt - d0) / 6e4) : 0;
  _lvPlay = setInterval(() => { m += 10; if (m >= 1440) { lvSeek(null); return; } _lvAt = d0 + m * 6e4; lvRender(); }, 140);
}
