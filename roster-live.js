// ═══════════════════════════════════════════════════════════
//  roster-live.js — 🎮 the live desk, and everyone's cartoon look
//  Each hotel's reception as a little scene: who is behind the desk now,
//  how far into their shift they are, a funny line for each, who walks in
//  next and who just went home. ▶ plays the whole day in 20 seconds.
//  Looks: a cartoon for everyone. We never guess anyone's looks from their
//  name: each person picks their own (skin, hair, extras) on their card.
//  Stored on the person: rbPeople[k].look = { skin, hair, hc, eyes, brows, face, facial, glasses, acc, outfit, shirt, bg }
// ═══════════════════════════════════════════════════════════

// Colours: the first ones of each list are the original ones (saved looks keep their meaning), more added after.
const AV_SKIN = ['#f9dcc4', '#efc39a', '#d9a273', '#b07548', '#7a4a2b', '#4f2f1c', '#fde4cf', '#e3b088', '#c68a5a', '#8d5a36'];
const AV_SKIN_ORDER = [6, 0, 1, 7, 2, 8, 3, 9, 4, 5];   // light to dark, for the picker
const AV_HAIRCOL = ['#2b1d14', '#3d2a1c', '#5a3a22', '#1c1c1c', '#7b4a22', '#4a3b2f', '#9a4a2c', '#c4652f', '#e2bd63', '#f1e3b5', '#9ca3af', '#eef0f3', '#2563eb', '#ec4899', '#8b5cf6'];
const AV_SCARF = ['#1f2937', '#6b2140', '#1e3a5f', '#3f4a2a', '#5b3b74', '#2a4a4a'];
const AV_SHIRT = ['#3b6fd8', '#2f9e74', '#c2410c', '#7c3aed', '#be185d', '#0e7490', '#4b5563', '#a16207', '#111827', '#f1f5f9', '#b91c1c', '#eab308'];
const AV_BG = ['#e0e7ff', '#dcfce7', '#fef3c7', '#fce7f3', '#e0f2fe', '#f3e8ff', '#fee2e2', '#e5e7eb', '#1f2937', '#0f3d3e'];
const AV_HAIR = [['short', 'Short'], ['side', 'Side part'], ['buzz', 'Buzz'], ['wavy', 'Wavy'], ['curly', 'Curly'], ['afro', 'Afro'], ['spiky', 'Spiky'], ['mohawk', 'Mohawk'],
  ['long', 'Long'], ['ponytail', 'Ponytail'], ['pigtails', 'Pigtails'], ['braids', 'Braids'], ['bun', 'Bun'], ['hijab', 'Hijab'], ['turban', 'Turban'], ['cap', 'Cap'], ['beanie', 'Beanie'], ['bald', 'None']];
const AV_EYES = [['dot', 'Classic'], ['big', 'Big'], ['lashes', 'Lashes'], ['happy', 'Smiley']];
const AV_BROWS = [['none', 'None'], ['thin', 'Thin'], ['thick', 'Thick'], ['arched', 'Arched']];
const AV_FACIAL = [['none', 'None'], ['stubble', 'Stubble'], ['moustache', 'Moustache'], ['goatee', 'Goatee'], ['beard', 'Beard']];
const AV_GLASSES = [['none', 'None'], ['round', 'Round'], ['square', 'Square'], ['shades', 'Shades']];
const AV_ACC = [['none', 'Nothing'], ['headset', 'Headset'], ['earrings', 'Earrings'], ['necklace', 'Necklace'], ['bowtie', 'Bow tie'], ['flower', 'Flower']];
const AV_OUTFIT = [['tee', 'T-shirt'], ['uniform', 'Uniform'], ['suit', 'Suit & tie'], ['polo', 'Polo'], ['hoodie', 'Hoodie'], ['blazer', 'Blazer']];
const AV_FACE = [['none', 'Nothing'], ['blush', 'Blush'], ['freckles', 'Freckles']];

function _avHash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
/** Their look: what they picked, else a playful start (hair and colours from their name's letters, nothing guessed). */
function avLook(k) {
  const c = ((typeof rbPeople !== 'undefined' && rbPeople[k]) || {}).look || {}, h = _avHash(k + ((roStaff[k] || {}).name || ''));
  const old = c.acc || '';   // before v274 one "extra" held glasses and beards too
  return {
    skin: c.skin != null ? c.skin : String(k).startsWith('~g') ? h % 6 : 2,   // (~g…: a made-up guest)
    hair: c.hair || ['short', 'long', 'curly', 'bun', 'spiky'][h % 5],
    hc: c.hc != null ? c.hc : (h >> 7) % 6,
    eyes: c.eyes || 'dot', brows: c.brows || 'none', face: c.face || 'none',
    facial: c.facial || (old === 'beard' ? 'beard' : 'none'),
    glasses: c.glasses || (old === 'glasses' ? 'round' : old === 'shades' ? 'shades' : c.acc ? 'none' : (h % 7 === 0 ? 'round' : 'none')),
    acc: ['glasses', 'shades', 'beard'].includes(old) ? 'none' : (old || (h % 11 === 0 ? 'headset' : 'none')),
    outfit: c.outfit || 'tee',
    shirt: c.shirt != null ? c.shirt : (h >> 3) % 8,
    bg: c.bg != null ? c.bg : (h >> 5) % 8,
  };
}
/** A cartoon (SVG). mood: happy · busy · tired · sleepy · cheer. opts.look: try a change; opts.bg: draw the round background. */
function avSvg(k, size, mood, opts) {
  opts = opts || {};
  const L = Object.assign(avLook(k), opts.look || {});
  const skin = AV_SKIN[L.skin] || AV_SKIN[2], hc = AV_HAIRCOL[L.hc] || AV_HAIRCOL[0], sh = AV_SHIRT[L.shirt] || AV_SHIRT[0], sc = AV_SCARF[L.hc % AV_SCARF.length];
  const dark = (L.hc >= 8 && L.hc <= 11) ? '#6b4b2a' : hc;   // eyebrows for very light hair
  // behind the head
  const back = {
    long: `<path d="M15 30c0-12 7-18 17-18s17 6 17 18v18c-3 0-5-3-5-7V29H20v12c0 4-2 7-5 7z" fill="${hc}"/>`,
    braids: `<g fill="${hc}"><path d="M15 30c0-12 7-18 17-18s17 6 17 18v6H15z"/><g stroke="rgba(0,0,0,.18)" stroke-width="1"><rect x="14" y="34" width="6" height="18" rx="3"/><rect x="44" y="34" width="6" height="18" rx="3"/><path d="M14 40h6M14 46h6M44 40h6M44 46h6"/></g></g>`,
    ponytail: `<path d="M43 20c9 2 11 15 7 26-2-7-5-11-9-15z" fill="${hc}"/>`,
    pigtails: `<g fill="${hc}"><circle cx="14" cy="33" r="6"/><circle cx="50" cy="33" r="6"/><circle cx="13" cy="41" r="4.5"/><circle cx="51" cy="41" r="4.5"/></g>`,
    afro: `<circle cx="32" cy="27" r="21" fill="${hc}"/>`,
    hijab: `<path d="M12 36c0-15 8-25 20-25s20 10 20 25v20H12z" fill="${sc}"/>`,
  }[L.hair] || '';
  const front = {
    short: `<path d="M17 27c0-10 7-15 15-15s15 5 15 15c-3-5-8-7-15-7s-12 2-15 7z" fill="${hc}"/>`,
    side: `<path d="M17 28c0-10 7-16 15-16s15 5 15 14c-7-1-13-4-17-9-3 5-7 9-13 11z" fill="${hc}"/>`,
    buzz: `<path d="M18 26c1-8 7-12 14-12s13 4 14 12c-4-3-9-4-14-4s-10 1-14 4z" fill="${hc}" opacity=".8"/>`,
    wavy: `<path d="M16 29c-1-11 7-17 16-17s17 6 16 17c-2-3-4-2-5-5-2 3-5 2-7-1-2 3-5 3-8 0-2 3-5 3-7 1-2 3-4 3-5 5z" fill="${hc}"/>`,
    long: `<path d="M17 27c0-9 7-14 15-14s15 5 15 14c-3-4-8-6-15-6s-12 2-15 6z" fill="${hc}"/>`,
    braids: `<path d="M17 27c0-9 7-14 15-14s15 5 15 14c-4-3-9-5-15-5s-11 2-15 5z" fill="${hc}"/>`,
    ponytail: `<path d="M17 27c0-10 7-15 15-15s15 5 15 15c-3-5-8-7-15-7s-12 2-15 7z" fill="${hc}"/>`,
    pigtails: `<path d="M17 28c0-10 7-15 15-15s15 5 15 15c-4-5-9-6-15-6s-11 1-15 6z" fill="${hc}"/>`,
    curly: `<g fill="${hc}"><circle cx="20" cy="22" r="6"/><circle cx="27" cy="16" r="6"/><circle cx="35" cy="15" r="6"/><circle cx="42" cy="19" r="6"/><circle cx="45" cy="26" r="5"/><circle cx="18" cy="28" r="4"/></g>`,
    afro: `<path d="M18 26c2-6 8-9 14-9s12 3 14 9c-4-2-9-3-14-3s-10 1-14 3z" fill="${hc}"/>`,
    bun: `<g fill="${hc}"><circle cx="32" cy="9" r="6"/><path d="M17 28c0-10 7-16 15-16s15 6 15 16c-3-6-8-8-15-8s-12 2-15 8z"/></g>`,
    spiky: `<path d="M17 27l2-9 4 4 3-9 4 6 3-8 3 7 4-6 2 8 4-3 1 10c-4-5-9-7-15-7s-11 2-15 7z" fill="${hc}"/>`,
    mohawk: `<path d="M27 21l2-12 3 6 3-6 2 12c-3-1-7-1-10 0z" fill="${hc}"/>`,
    turban: `<g><path d="M15 26c0-10 8-15 17-15s17 5 17 15c0 2-1 3-2 3H17c-1 0-2-1-2-3z" fill="${sc}"/><path d="M18 21c6-4 22-4 28 0" stroke="rgba(255,255,255,.25)" stroke-width="2" fill="none"/></g>`,
    cap: `<g><path d="M16 26c0-9 7-14 16-14s16 5 16 14z" fill="${sh}"/><path d="M30 25h22c0 2-2 3-4 3H30z" fill="${sh}" opacity=".85"/></g>`,
    beanie: `<g><path d="M16 27c0-10 7-16 16-16s16 6 16 16z" fill="${sc}"/><rect x="15" y="24" width="34" height="5" rx="2.5" fill="${sc}" opacity=".8"/><circle cx="32" cy="10" r="3.5" fill="${sc}"/></g>`,
  }[L.hair] || '';
  // clothes
  const outfit = {
    tee: '',
    uniform: '<path d="M27 49l5 5 5-5" stroke="#fff" stroke-width="2" fill="none"/><rect x="38" y="54" width="9" height="4" rx="1" fill="#f6d77e"/>',
    suit: `<path d="M12 57c0-5 4-9 9-9h3l8 14 8-14h3c5 0 9 4 9 9v9H12z" fill="#1f2937"/><path d="M30 49h4l1 4-3 9-3-9z" fill="${sh === '#1f2937' || sh === '#111827' ? '#b91c1c' : sh}"/>`,
    polo: '<path d="M26 48l6 6 6-6" fill="none" stroke="rgba(255,255,255,.65)" stroke-width="2"/><circle cx="32" cy="57" r="1" fill="rgba(255,255,255,.75)"/><circle cx="32" cy="61" r="1" fill="rgba(255,255,255,.75)"/>',
    hoodie: '<path d="M20 49c3 5 7 7 12 7s9-2 12-7" fill="none" stroke="rgba(0,0,0,.25)" stroke-width="2"/><path d="M28 55v6M36 55v6" stroke="rgba(255,255,255,.7)" stroke-width="1.5"/>',
    blazer: `<path d="M12 57c0-5 4-9 9-9h4l7 16 7-16h4c5 0 9 4 9 9v9H12z" fill="${sh}"/><path d="M25 48l7 16 7-16" fill="#f8fafc"/>`,
  }[L.outfit] || '';
  const body = `<rect x="12" y="48" width="40" height="18" rx="9" fill="${L.outfit === 'suit' || L.outfit === 'blazer' ? '#f8fafc' : sh}"/>${outfit}`;
  const covered = L.hair === 'hijab';
  const ears = covered ? '' : `<circle cx="18" cy="33" r="3" fill="${skin}"/><circle cx="46" cy="33" r="3" fill="${skin}"/>`;
  const face = covered ? `<ellipse cx="32" cy="33" rx="12" ry="13" fill="${skin}"/>` : `<ellipse cx="32" cy="32" rx="14" ry="15" fill="${skin}"/>`;
  const cheeks = { blush: '<g fill="#f472b6" opacity=".35"><ellipse cx="23" cy="37" rx="3" ry="2"/><ellipse cx="41" cy="37" rx="3" ry="2"/></g>',
    freckles: '<g fill="#a0522d" opacity=".55"><circle cx="23" cy="36" r=".8"/><circle cx="25.5" cy="37.5" r=".8"/><circle cx="22" cy="38.5" r=".8"/><circle cx="41" cy="36" r=".8"/><circle cx="38.5" cy="37.5" r=".8"/><circle cx="42" cy="38.5" r=".8"/></g>' }[L.face] || '';
  const brows = { thin: `<path d="M23 26h6M35 26h6" stroke="${dark}" stroke-width="1.2" stroke-linecap="round"/>`,
    thick: `<path d="M22.5 26h7M34.5 26h7" stroke="${dark}" stroke-width="2.4" stroke-linecap="round"/>`,
    arched: `<path d="M23 27c2-2 4-2 6 0M35 27c2-2 4-2 6 0" stroke="${dark}" stroke-width="1.6" fill="none" stroke-linecap="round"/>` }[L.brows] || '';
  const eyes = mood === 'sleepy' ? '<path d="M24 31h5M35 31h5" stroke="#2b2b2b" stroke-width="2" stroke-linecap="round"/>'
    : L.eyes === 'happy' ? '<g class="av-eyes" stroke="#2b2b2b" stroke-width="2" fill="none" stroke-linecap="round"><path d="M24 32c1-2 4-2 5 0M35 32c1-2 4-2 5 0"/></g>'
    : L.eyes === 'big' ? '<g class="av-eyes"><circle cx="26.5" cy="31" r="3.6" fill="#fff"/><circle cx="37.5" cy="31" r="3.6" fill="#fff"/><circle cx="27" cy="31.5" r="2" fill="#2b2b2b"/><circle cx="38" cy="31.5" r="2" fill="#2b2b2b"/><circle cx="27.6" cy="30.8" r=".6" fill="#fff"/><circle cx="38.6" cy="30.8" r=".6" fill="#fff"/></g>'
    : L.eyes === 'lashes' ? '<g class="av-eyes"><circle cx="26.5" cy="31" r="2.2" fill="#2b2b2b"/><circle cx="37.5" cy="31" r="2.2" fill="#2b2b2b"/><path d="M23.5 29l-1.5-1.5M25 28.3l-.6-1.8M40.5 29l1.5-1.5M39 28.3l.6-1.8" stroke="#2b2b2b" stroke-width="1" stroke-linecap="round"/></g>'
    : '<g class="av-eyes"><circle cx="26.5" cy="31" r="2.2" fill="#2b2b2b"/><circle cx="37.5" cy="31" r="2.2" fill="#2b2b2b"/></g>';
  const mouth = mood === 'tired' ? '<path d="M27 40h10" stroke="#7a3b2e" stroke-width="2" stroke-linecap="round"/>'
    : mood === 'sleepy' ? '<ellipse cx="32" cy="40.5" rx="2.5" ry="2" fill="#7a3b2e"/>'
    : mood === 'cheer' ? '<path d="M26 38c2 5 10 5 12 0z" fill="#7a3b2e"/>'
    : '<path d="M26.5 38.5c2 3 9 3 11 0" stroke="#7a3b2e" stroke-width="2" fill="none" stroke-linecap="round"/>';
  const facial = { stubble: `<path d="M20 36c1 8 6 12 12 12s11-4 12-12c-2 5-6 7-12 7s-10-2-12-7z" fill="${hc}" opacity=".28"/>`,
    moustache: `<path d="M25 37c2-2 5-2 7 0 2-2 5-2 7 0-2 1-5 1-7 0-2 1-5 1-7 0z" fill="${hc}"/>`,
    goatee: `<path d="M28 43c1 3 2 5 4 5s3-2 4-5c-2 1-6 1-8 0z" fill="${hc}"/><path d="M26 37c2-1.5 4-1.5 6 0 2-1.5 4-1.5 6 0-2 .8-4 .8-6 0-2 .8-4 .8-6 0z" fill="${hc}"/>`,
    beard: `<path d="M19 34c1 10 6 14 13 14s12-4 13-14c-2 4-6 6-13 6s-11-2-13-6z" fill="${hc}"/>` }[L.facial] || '';
  const glasses = { round: '<g stroke="#222" stroke-width="1.6" fill="rgba(255,255,255,.18)"><circle cx="26.5" cy="31" r="4.3"/><circle cx="37.5" cy="31" r="4.3"/><path d="M30.8 31h2.4"/></g>',
    square: '<g stroke="#222" stroke-width="1.6" fill="rgba(255,255,255,.18)"><rect x="21.8" y="27.5" width="9.4" height="7" rx="1.5"/><rect x="32.8" y="27.5" width="9.4" height="7" rx="1.5"/><path d="M31.2 30h1.6"/></g>',
    shades: '<g fill="#111"><rect x="21.5" y="28" width="9" height="6" rx="2.5"/><rect x="33.5" y="28" width="9" height="6" rx="2.5"/><path d="M30.5 30h3" stroke="#111" stroke-width="1.6"/></g>' }[L.glasses] || '';
  const acc = { headset: '<g fill="none" stroke="#333" stroke-width="2.4"><path d="M17 32c0-10 7-16 15-16s15 6 15 16"/></g><rect x="14" y="29" width="5" height="8" rx="2" fill="#333"/><rect x="45" y="29" width="5" height="8" rx="2" fill="#333"/><path d="M47 37c0 5-5 7-10 7" stroke="#333" stroke-width="1.6" fill="none"/>',
    earrings: covered ? '' : '<g fill="#f6c84c"><circle cx="18" cy="38" r="1.6"/><circle cx="46" cy="38" r="1.6"/></g>',
    necklace: '<path d="M25 48c2 4 5 6 7 6s5-2 7-6" stroke="#f6c84c" stroke-width="1.4" fill="none"/><circle cx="32" cy="54.5" r="1.6" fill="#f6c84c"/>',
    bowtie: '<path d="M26 56l6 3 6-3v6l-6-3-6 3z" fill="#e11d48"/>',
    flower: '<g transform="translate(44 18)"><circle r="2.6" cx="0" cy="-3" fill="#f472b6"/><circle r="2.6" cx="3" cy="0" fill="#f472b6"/><circle r="2.6" cx="0" cy="3" fill="#f472b6"/><circle r="2.6" cx="-3" cy="0" fill="#f472b6"/><circle r="2" fill="#fde047"/></g>' }[L.acc] || '';
  const bg = opts.bg ? `<circle cx="32" cy="32" r="32" fill="${AV_BG[L.bg] || AV_BG[0]}"/>` : '';
  return `<svg class="av" viewBox="0 0 64 64" width="${size || 40}" height="${size || 40}" aria-hidden="true">${bg}${back}${body}<rect x="28" y="43" width="8" height="7" fill="${skin}"/>${ears}${face}${cheeks}${front}${brows}${eyes}${mouth}${facial}${glasses}${acc}</svg>`;
}

// ── The look, on their card ───────────────────────────────
// A big preview that changes as you tap, every option shown as a little picture of them.
function avCardHtml(k, open) {
  const L = avLook(k), q = typeof _rtQ === 'function' ? _rtQ(k) : JSON.stringify(k);
  const pick = (f, list) => `<div class="av-opts">${list.map(([v, t]) => `<button class="av-opt${L[f] === v ? ' on' : ''}" onclick="avSet(${q},'${f}','${v}')" title="${escapeHtml(t)}">${avSvg(k, 46, 'happy', { look: { [f]: v } })}<small>${escapeHtml(t)}</small></button>`).join('')}</div>`;
  const dots = (f, cols, order) => `<div class="av-dots">${(order || cols.map((_, i) => i)).map(i => `<button class="av-dot${L[f] === i ? ' on' : ''}" style="background:${cols[i]}" onclick="avSet(${q},'${f}',${i})" aria-label="${f} ${i + 1}"></button>`).join('')}</div>`;
  const sec = (t, html) => `<div class="av-sec"><div class="av-sec-t">${t}</div>${html}</div>`;
  return `<details class="av-card"${open ? ' open' : ''}><summary><span class="av-prev">${avSvg(k, 44, 'happy', { bg: true })}</span>😀 Their look <small>for the live desk · they choose</small></summary>
    <div class="av-ed">
      <div class="av-stage">
        <div class="av-big">${avSvg(k, 168, 'cheer', { bg: true })}</div>
        <div class="av-stage-acts"><button class="btn sm" onclick="avRandom(${q})">🎲 Surprise me</button><button class="btn sm ghost" onclick="avReset(${q})">↺ Start again</button></div>
        ${sec('Background', dots('bg', AV_BG))}
      </div>
      <div class="av-pane">
        ${sec('Skin', dots('skin', AV_SKIN, AV_SKIN_ORDER))}
        ${sec('Hair', pick('hair', AV_HAIR))}
        ${sec('Hair colour', dots('hc', AV_HAIRCOL))}
        ${sec('Eyes', pick('eyes', AV_EYES))}
        ${sec('Eyebrows', pick('brows', AV_BROWS))}
        ${sec('Cheeks', pick('face', AV_FACE))}
        ${sec('Beard', pick('facial', AV_FACIAL))}
        ${sec('Glasses', pick('glasses', AV_GLASSES))}
        ${sec('Extra', pick('acc', AV_ACC))}
        ${sec('Outfit', pick('outfit', AV_OUTFIT))}
        ${sec('Colour', dots('shirt', AV_SHIRT))}
      </div>
    </div>
  </details>`;
}
function _avSave(k, look) {
  if (typeof rtSet === 'function') rtSet(k, 'look', look);
  const el = document.querySelector('#rtSheet .av-card');
  if (el) { const open = el.open, pane = el.querySelector('.av-pane'), top = pane ? pane.scrollTop : 0; el.outerHTML = avCardHtml(k, open); const n = document.querySelector('#rtSheet .av-card .av-pane'); if (n) n.scrollTop = top; }
  if (document.getElementById('lvView')) lvRender();
}
function avSet(k, f, v) { _avSave(k, Object.assign({}, avLook(k), (rbPeople[k] || {}).look, { [f]: v })); }
function avRandom(k) {
  const r = a => a[Math.floor(Math.random() * a.length)], L = avLook(k);
  _avSave(k, Object.assign({}, L, {   // skin stays as they chose it
    hair: r(AV_HAIR)[0], hc: Math.floor(Math.random() * AV_HAIRCOL.length), eyes: r(AV_EYES)[0], brows: r(AV_BROWS)[0], face: r(AV_FACE)[0],
    facial: Math.random() < .3 ? r(AV_FACIAL)[0] : 'none', glasses: Math.random() < .35 ? r(AV_GLASSES)[0] : 'none', acc: Math.random() < .5 ? r(AV_ACC)[0] : 'none',
    outfit: r(AV_OUTFIT)[0], shirt: Math.floor(Math.random() * AV_SHIRT.length), bg: Math.floor(Math.random() * AV_BG.length) }));
}
function avReset(k) { _avSave(k, { skin: avLook(k).skin }); }

// ── 🎮 The live desk ──────────────────────────────────────
let _lvT = null, _lvAt = null, _lvPlay = null;   // _lvAt: a time picked on the slider (null = now)
function _lvHotelOf(x) {
  const own = (roStaff[x.key] || {}).group || '';
  if (!x.info.note) return own;
  const n = x.info.note.toLowerCase();
  return roGroups().find(g => g.toLowerCase().startsWith(n) || g.toLowerCase().split(' ')[0] === n.split(' ')[0]) || own;
}
const LV_LINES = [
  [0.08, ['☕ Just arrived. Coffee first', '👋 Hello team!', '🔑 Opening the shift', '😎 The legend has arrived', '🫡 Reporting for duty']],
  [0.3, ['😄 Checking guests in', '💪 Fresh and ready', '🛎 Ding ding!', '📶 "What\'s the WiFi?" #12', '🧳 9 suitcases, 1 night stay', '🗣 "Is breakfast free?"', '🏊 "Pool?" 8 AM – 7 PM!', '🏋️ "Gym?" 24h with your key']],
  [0.55, ['🧾 In the zone', '📞 On the phone again', '🗝 Keys, keys, keys', '🤹 Juggling 5 guests', '🧠 Big brain upsell', '🔁 "Can I change rooms?"']],
  [0.7, ['🥪 Snack time?', '😌 Halfway there', '💬 Small talk with a guest', '🥱 Fighting a yawn', '🍫 Emergency chocolate', '📸 Guest selfie at the desk']],
  [0.9, ['⏳ Almost there', '📝 Writing the handover', '🧮 Counting the float', '👀 Watching the clock', '🙏 No more late check-outs pls']],
  [1.01, ['🏃 Home time soon!', '🏁 Last stretch!', '🛌 Bed is calling', '🚪 One foot out the door', '🕺 Shift-end dance loading…']],
];
const LV_HOUR = { 7: '🍳 Breakfast rush!', 10: '🧾 Check-out rush!', 11: '🏃 "Late check-out please?"', 14: '🗝 Check-in time!', 15: '🛏 "Is my room ready?"', 17: '🌇 Sunset selfies in the lobby', 19: '🍽 "Where should we eat?"', 23: '🌙 Last guests strolling in' };
const LV_NIGHT = ['😴 Stay awake…', '🌙 Night owl mode', '🦉 Guarding the lobby', '🍜 3 AM noodles', '👻 Was that the lift?', '📊 Night audit magic', '🎧 Lo-fi beats to audit to'];
function _lvLine(k, p, t, alone, night) {
  const h = _avHash(k + Math.floor(t / 9e5));   // changes every 15 minutes
  const hr = new Date(t).getHours();
  if (night && hr >= 1 && hr < 6) return LV_NIGHT[h % LV_NIGHT.length];
  if (alone && p > 0.1 && p < 0.9 && h % 3 === 0) return '🦸 Holding the fort alone';
  if (LV_HOUR[hr] && h % 3 === 1) return LV_HOUR[hr];
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
// ── The scene: a lobby with a window on the city, a clock, a sign, the desk, guests coming in ──
const LV_SKY = [[0, '#0b1330', '#1c2550'], [5, '#1e2a5a', '#3a3f7a'], [6.2, '#f6a96b', '#8bb4e8'], [8, '#7cc4ff', '#d4ecff'], [16, '#6fb8ff', '#d9eeff'], [18, '#ff9a62', '#6f63b6'], [19.5, '#3b2f6b', '#18204a'], [21, '#0b1330', '#1c2550'], [24, '#0b1330', '#1c2550']];
function _lvMix(a, b, f) { const p = x => [1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16)), A = p(a), B = p(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * f).toString(16).padStart(2, '0')).join(''); }
function lvSky(h) { for (let i = 1; i < LV_SKY.length; i++) if (h <= LV_SKY[i][0]) { const a = LV_SKY[i - 1], b = LV_SKY[i], f = (h - a[0]) / (b[0] - a[0] || 1); return [_lvMix(a[1], b[1], f), _lvMix(a[2], b[2], f)]; } return [LV_SKY[0][1], LV_SKY[0][2]]; }
/** Sun by day, moon by night: across the window in an arc. */
function lvOrb(h) { const day = h >= 6 && h < 18, x = day ? (h - 6) / 12 : ((h + 6) % 24) / 12; return { day, left: 6 + x * 82, top: 62 - Math.sin(Math.PI * x) * 50 }; }
const LV_CITY = '<svg class="lv-city" viewBox="0 0 400 80" preserveAspectRatio="none" aria-hidden="true"><path d="M0 80V52h18V40h14v14h10V30h16v24h12V44h20V24h10v-8h6v8h10v30h14V36h18v18h10V46h16v10h12V20l4-16 4 16v4h6v-4l3-14 3 14v34h12V40h18v16h14V32h16v22h10V48h20v32z"/><g class="lv-win">' +
  Array.from({ length: 34 }, (_, i) => `<rect x="${(i * 37) % 390 + 6}" y="${42 + (i * 13) % 30}" width="3" height="3"/>`).join('') + '</g></svg>';
function _lvClock(d) { const m = d.getMinutes(), h = d.getHours() % 12 + m / 60; return `<svg class="lv-clk" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18"/><line class="lv-hh" x1="20" y1="20" x2="20" y2="10" transform="rotate(${h * 30} 20 20)"/><line class="lv-mh" x1="20" y1="20" x2="20" y2="6" transform="rotate(${m * 6} 20 20)"/><circle cx="20" cy="20" r="2"/></svg>`; }
/** How busy the lobby is: check-out late morning, check-in afternoon, quiet at night. */
function _lvGuests(h) { return h >= 10 && h < 12 ? 3 : h >= 14 && h < 19 ? 3 : h >= 7 && h < 22 ? 1 : 0; }
const LV_GCOL = ['#f97316', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#eab308', '#14b8a6'];
function lvHotelHtml(S, t, idx) {
  const now = new Date(t), h = now.getHours() + now.getMinutes() / 60, night = h < 6 || h >= 20;
  const [s1, s2] = lvSky(h), orb = lvOrb(h);
  const staff = (x, kind) => {
    const p = Math.max(0, Math.min(1, (now - x.sp.start) / (x.sp.end - x.sp.start)));
    const mood = kind !== 'on' ? 'happy' : night && h >= 2 && h < 6 ? 'sleepy' : p > 0.85 ? 'cheer' : p > 0.6 ? 'tired' : 'happy';
    const left = Math.max(0, Math.round((x.sp.end - now) / 6e4)), lh = Math.floor(left / 60), lm = left % 60;
    const bubble = kind === 'coming' ? `🔔 In at ${_lvHM(x.sp.start)}` : kind === 'gone' ? '👋 See you!' : _lvLine(x.key, p, t, S.on.length === 1, x.info.type === 'night');
    const en = Math.round((1 - p) * 100);
    return `<div class="lv-st ${kind}${x.key === roMeKey ? ' me' : ''}" data-k="${escapeHtml(x.key)}" style="--d:${(_avHash(x.key) % 9) / 10}s" title="${escapeHtml(x.name)} · ${escapeHtml(roTime(x.info))} · tap me!" onclick="lvPoke(this)">${mood === 'sleepy' ? '<span class="lv-zzz"><i>z</i><i>z</i><i>Z</i></span>' : ''}${kind === 'on' && p > 0.93 ? '<span class="lv-party">🎉</span>' : ''}
      <div class="lv-bub">${escapeHtml(bubble)}</div>
      <div class="lv-tag"><b>${escapeHtml(String(x.name).split(' ')[0])}</b>${kind === 'on' ? `<span class="lv-en" title="Energy: ${en}% of the shift left"><i style="width:${en}%"></i></span><small>⚡ ${lh ? lh + 'h ' : ''}${lm}m</small>` : `<small>${escapeHtml(roTime(x.info))}</small>`}</div>
      <div class="lv-body">${avSvg(x.key, 84, mood)}</div>
    </div>`;
  };
  const g = _lvGuests(h), seed = _avHash(S.g + now.getHours());
  const guests = Array.from({ length: g }, (_, i) => `<div class="lv-guest v2" style="--gd:${(i * 2.7 + (seed % 5)).toFixed(1)}s;--gs:${9 + ((seed >> i) % 5)}s"><div class="lv-gav">${avSvg('~g' + seed + i, 34, 'happy')}</div><i class="lv-legs"><b></b><b></b></i><span>🧳</span></div>`).join('');
  const empty = !S.on.length, disco = now.getHours() === 0 && now.getMinutes() < 20;
  if (disco && typeof lvBadge === 'function') setTimeout(() => lvBadge('disco', '🪩 Disco time: found the midnight party'), 0);
  return `<div class="lv-hotel${night ? ' night' : ''}${empty ? ' empty' : ''}${disco ? ' disco' : ''}" id="lvH${idx}">
    <div class="lv-hud"><b>${escapeHtml(S.g || 'Reception')}</b>
      <span class="lv-pill ${empty ? 'bad' : 'ok'}">${empty ? '⚠ Desk EMPTY' : '🛎 Desk covered'}</span>
      <span class="lv-pill">👥 ${S.on.length}</span>${S.g && typeof roCanEdit === 'function' && roCanEdit() ? `<button type="button" class="lv-pill lv-logobtn" onclick="lvLogoMenu(this, ${escapeHtml(JSON.stringify(S.g))})" title="The hotel's logo">🏷</button>` : ''}${S.coming.length ? `<span class="lv-pill">🔜 ${escapeHtml(String(S.coming[0].name).split(' ')[0])} ${_lvHM(S.coming[0].sp.start)}</span>` : ''}</div>
    <div class="lv-scene">
      <div class="lv-window" style="--s1:${s1};--s2:${s2}">
        <span class="lv-orb ${orb.day ? 'sun' : 'moon'}" style="left:${orb.left}%;top:${orb.top}%"></span>
        ${night ? '<i class="lv-star" style="left:14%;top:16%"></i><i class="lv-star" style="left:68%;top:10%"></i><i class="lv-star" style="left:42%;top:26%"></i><i class="lv-star" style="left:86%;top:30%"></i><i class="lv-star" style="left:28%;top:8%"></i>' : '<i class="lv-cloud" style="top:14%;--cd:0s"></i><i class="lv-cloud" style="top:34%;--cd:-9s;transform:scale(.7)"></i>'}
        ${LV_CITY}
      </div>
      <div class="lv-wall">${lvLogo(S.g) ? `<img class="lv-logo" src="${escapeHtml(lvLogo(S.g))}" alt="${escapeHtml(S.g)}">` : `<span class="lv-sign">${escapeHtml((S.g || 'Hotel').split(' ')[0])}</span>`}${_lvClock(now)}<span class="lv-keys">🗝🗝🗝</span><div class="lv-lift" style="--ld:${(_avHash(S.g) % 10)}s"><i class="l"></i><i class="r"></i><span>▲</span></div></div>
      ${disco ? '<span class="lv-disco">🪩</span><i class="lv-lights"></i>' : ''}
      <div class="lv-staff">${S.gone.map(x => staff(x, 'gone')).join('')}${S.on.map(x => staff(x, 'on')).join('') || '<div class="lv-empty">🛎 Ding… is anyone here? <small>🦗 *crickets*</small></div>'}${S.coming.map(x => staff(x, 'coming')).join('')}</div>
      <div class="lv-desk"><button type="button" class="lv-bell" onclick="lvDing(${idx})" title="Ring the bell!">🛎</button><span class="lv-cup">☕<i></i><i></i></span><b>RECEPTION</b><span class="lv-phone">☎️</span><span class="lv-plant">🪴</span></div>
      <div class="lv-floor">${guests}${empty ? '<span class="lv-tumble">🌾</span>' : ''}</div>
      <div class="lv-fx"></div>
    </div>
  </div>`;
}
/** Draw again only what changed: during ▶ the sky, clocks and bars move smoothly instead of everything blinking. */
const _lvKeys = {};
function lvRender() {
  const box = document.getElementById('lvBody'); if (!box) return;
  const t = _lvAt != null ? _lvAt : Date.now(), d0 = roDate(roToday()).getTime(), now = new Date(t), h = now.getHours() + now.getMinutes() / 60;
  const scenes = lvScene(t), mine = typeof roMeKey !== 'undefined' && roMeKey ? (roStaff[roMeKey] || {}).group : '';
  _lvHome = Math.max(0, scenes.findIndex(S => S.g && S.g === mine));   // the app's live news goes to your own hotel
  if (!scenes.length) box.innerHTML = '<div class="ro-empty">No roster for today yet.</div>';
  scenes.forEach((S, i) => {
    const key = [S.g, S.on.map(x => x.key), S.coming.map(x => x.key), S.gone.map(x => x.key), now.getHours(), Math.floor(now.getMinutes() / 15), h < 6 || h >= 20].join('|');
    let el = document.getElementById('lvH' + i);
    if (!el || _lvKeys[i] !== key) {
      const html = lvHotelHtml(S, t, i);
      if (el) el.outerHTML = html; else box.insertAdjacentHTML('beforeend', html);
      _lvKeys[i] = key; return;
    }
    // the same people: move the sky, sun, clock and energy bars only
    const [s1, s2] = lvSky(h), orb = lvOrb(h), w = el.querySelector('.lv-window');
    if (w) { w.style.setProperty('--s1', s1); w.style.setProperty('--s2', s2); }
    const o = el.querySelector('.lv-orb'); if (o) { o.style.left = orb.left + '%'; o.style.top = orb.top + '%'; }
    const c = el.querySelector('.lv-clk'); if (c) c.outerHTML = _lvClock(now);
    S.on.forEach(x => { const st = el.querySelector(`.lv-st.on[data-k="${CSS.escape(x.key)}"]`); if (!st) return; const p = Math.max(0, Math.min(1, (now - x.sp.start) / (x.sp.end - x.sp.start))), left = Math.max(0, Math.round((x.sp.end - now) / 6e4));
      const i2 = st.querySelector('.lv-en i'); if (i2) i2.style.width = Math.round((1 - p) * 100) + '%';
      const sm = st.querySelector('.lv-tag small'); if (sm) sm.textContent = `⚡ ${Math.floor(left / 60) ? Math.floor(left / 60) + 'h ' : ''}${left % 60}m`; });
  });
  const sl = document.getElementById('lvSlider'); if (sl && document.activeElement !== sl) sl.value = Math.round((t - d0) / 6e4);
  const lb = document.getElementById('lvWhen'); if (lb) lb.textContent = _lvAt == null ? 'Live now' : _lvHM(now);
  if (!_lvPlay || now.getMinutes() % 20 < 4) lvStats();
  _lvOpsPaint();
}
function lvOpen() {
  document.getElementById('lvView')?.remove();
  const d = document.createElement('div'); d.id = 'lvView'; d.className = 'ri-viewer lv-view';
  d.innerHTML = `<div class="card lv-card">
    <div class="ro-card-hd"><b>🎮 Live desk</b><button class="ro-x" onclick="lvClose()">✕</button></div>
    <div class="lv-ctl"><button class="btn sm" id="lvPlayB" onclick="lvPlay()">▶ Play the day</button><input type="range" id="lvSlider" min="0" max="1439" step="5" oninput="lvSeek(+this.value)"><span id="lvWhen">Live now</span><button class="btn sm ghost" onclick="lvSeek(null)">Now</button><button class="btn sm lv-gamebtn" onclick="lgOpen()">🎯 Rush Hour</button></div>
    <div class="lv-news"><b>📣 LOBBY NEWS</b><span id="lvNews">Welcome to the live desk! Tap anyone, or ring the 🛎</span></div>
    <div class="lv-ops" id="lvOps"></div>
    <div id="lvBody" class="lv-body-wrap"></div>
    <div class="lv-stats" id="lvStats"></div>
    <div class="lv-badges" id="lvBadges"></div>
    <small class="ro-hint">Tap a person to poke them, tap 🛎 to ring the bell. The bar is how far into their shift they are. Looks are each person's own choice: 🧑‍💼 Team → 😀 Their look. <button class="lv-snd" id="lvSnd" onclick="lvSound()">${_lvMute ? '🔇 Sound off' : '🔊 Sound on'}</button></small>
  </div>`;
  d.addEventListener('click', e => { if (e.target === d) lvClose(); });
  document.body.appendChild(d);
  _lvAt = null; _lvOps = null; Object.keys(_lvKeys).forEach(k => delete _lvKeys[k]); lvOpsTick(); lvRender();
  clearInterval(_lvOpsT); _lvOpsT = setInterval(lvOpsTick, 5000);
  clearInterval(_lvT); _lvT = setInterval(() => { if (!document.getElementById('lvView')) { clearInterval(_lvT); return; } if (_lvAt == null) lvRender(); }, 30000);
  if (typeof lvBadgesRender === 'function') { lvBadgesRender(); const hr = new Date().getHours(); if (hr < 5) lvBadge('night', '🦉 Night watch: checked the live desk in the small hours'); }
  clearTimeout(_lvFx); const fx = () => { if (!document.getElementById('lvView')) return; lvSurprise(); _lvFx = setTimeout(fx, _lvPlay ? 1800 : 5000 + Math.random() * 4000); }; _lvFx = setTimeout(fx, 2500);
}
function lvClose() { if (typeof lgStop === 'function') lgStop(); clearInterval(_lvT); clearInterval(_lvOpsT); _lvOpsT = null; clearInterval(_lvPlay); clearTimeout(_lvFx); _lvPlay = null; document.getElementById('lvView')?.remove(); }

// ── 🏷 Each hotel's own logo, uploaded once for the whole team ──
function _lvLogoKey(g) { return String(typeof rbBaseGroup === 'function' ? rbBaseGroup(g) : g).replace(/[.#$\[\]\/\s]+/g, '_'); }
function lvLogo(g) { return g && typeof rbSettings !== 'undefined' ? ((rbSettings.logos || {})[_lvLogoKey(g)] || '') : ''; }
function lvLogoMenu(btn, g) {
  document.getElementById('lvLogoPop')?.remove();
  const pop = document.createElement('div'); pop.id = 'lvLogoPop'; pop.className = 'rb-menu lv-logo-pop';
  pop.innerHTML = `<b>🏷 ${escapeHtml(typeof rbBaseGroup === 'function' ? rbBaseGroup(g) : g)} logo</b>${lvLogo(g) ? `<img src="${escapeHtml(lvLogo(g))}" alt="">` : '<small>The official logo file (PNG or SVG, best with a clear background). Shown on the lobby wall for everyone.</small>'}
    <div class="lv-logo-acts"><label class="btn sm">📷 ${lvLogo(g) ? 'Change' : 'Upload'}<input type="file" accept="image/*" hidden></label>${lvLogo(g) ? '<button class="btn sm ghost" data-rm>🗑 Remove</button>' : ''}</div>`;
  document.body.appendChild(pop);
  const r = btn.getBoundingClientRect(); pop.style.left = Math.max(8, Math.min(innerWidth - 248, r.right - 240)) + 'px'; pop.style.top = (r.bottom + 6) + 'px';
  pop.querySelector('input').addEventListener('change', e => { const f = e.target.files[0]; if (f) lvLogoSave(g, f); pop.remove(); });
  const rm = pop.querySelector('[data-rm]'); if (rm) rm.addEventListener('click', () => { lvLogoSet(g, null); pop.remove(); });
  setTimeout(() => document.addEventListener('click', function off(e) { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('click', off); } }), 0);
}
/** Made small (at most 360 × 140) so it loads fast for everyone. */
function lvLogoSave(g, file) {
  const rd = new FileReader();
  rd.onload = () => { const img = new Image(); img.onload = () => {
    const k = Math.min(1, 360 / img.width, 140 / img.height), c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    lvLogoSet(g, c.toDataURL('image/png'));
  }; img.onerror = () => typeof showToast === 'function' && showToast('That file is not a picture', 'warn'); img.src = rd.result; };
  rd.readAsDataURL(file);
}
function lvLogoSet(g, url) {
  rbSettings.logos = Object.assign({}, rbSettings.logos); const k = _lvLogoKey(g);
  if (url) rbSettings.logos[k] = url; else delete rbSettings.logos[k];
  if (typeof fbSet === 'function') fbSet('roster/builder/settings/logos/' + k, url || null);
  Object.keys(_lvKeys).forEach(x => delete _lvKeys[x]); lvRender();
  if (typeof showToast === 'function') showToast(url ? '🏷 Logo saved for the whole team' : 'Logo removed', 'ok');
}

// ── The fun: surprises in the lobby, poke someone, ring the bell ──
let _lvFx = null, _lvMute = false, _lvAc = null;
const _lvFun = { dings: 0, pokes: 0, events: 0 };
try { _lvMute = localStorage.getItem('lv_mute') === '1'; } catch (_) {}
const LV_EVENTS = [
  ['🐈', 'walk', 'A cat walked in and asked for the presidential suite'],
  ['🍕', 'walk', 'Pizza for room 404… room not found'],
  ['🧹', 'walk', 'Housekeeping cart zooming past at top speed'],
  ['🎈', 'float', 'A birthday balloon escaped from the lift'],
  ['📦', 'drop', 'Parcel number 47 for the same guest'],
  ['🐕', 'walk', 'A very good dog is checking in'],
  ['👑', 'walk', 'VIP arriving: roll out the red carpet!'],
  ['🦆', 'walk', 'A duck in the lobby? Nobody knows how'],
  ['📞', 'ring', '"Hi, do you have WiFi?" (call number 38)'],
  ['🧳', 'walk', 'Guest with 9 suitcases for a 1-night stay'],
  ['🛴', 'walk', 'Someone scootered right through the lobby'],
  ['🌯', 'walk', 'Shawarma delivery. The whole lobby is hungry now'],
  ['💸', 'float', 'Upgrade sold! The revenue team is dancing'],
  ['🐪', 'walk', 'Desert safari group is back. Sand everywhere'],
  ['⭐', 'float', 'New 5-star review: "the reception team is amazing!"'],
  ['🧦', 'drop', 'Lost and found: one sock. Again'],
  ['🎂', 'walk', 'Surprise birthday cake on its way to room 312'],
  ['🤳', 'float', 'Influencer filming "my hotel tour" in the lobby'],
];
const LV_NIGHT_EV = [
  ['👻', 'float', 'Was that the lift going up by itself?'],
  ['🦉', 'walk', 'The night owl union is checking in'],
  ['🍜', 'float', '3 AM instant noodles: a night shift tradition'],
  ['🦗', 'walk', '*crickets*… a very quiet night'],
  ['🌙', 'float', 'The moon says hi to the night team'],
  ['🚕', 'walk', 'Late flight guest: "Is it too late to check in?"'],
];
function _lvBeep(f, d, type) {
  if (_lvMute) return;
  try {
    _lvAc = _lvAc || new (window.AudioContext || window.webkitAudioContext)();
    const o = _lvAc.createOscillator(), g = _lvAc.createGain(), t0 = _lvAc.currentTime;
    o.type = type || 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0.12, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + d);
    o.connect(g); g.connect(_lvAc.destination); o.start(t0); o.stop(t0 + d);
  } catch (_) {}
}
function lvSound() { _lvMute = !_lvMute; try { localStorage.setItem('lv_mute', _lvMute ? '1' : '0'); } catch (_) {} const b = document.getElementById('lvSnd'); if (b) b.textContent = _lvMute ? '🔇 Sound off' : '🔊 Sound on'; if (!_lvMute) _lvBeep(880, 0.15); }
function _lvNews(txt) { const n = document.getElementById('lvNews'); if (!n) return; n.textContent = txt; n.classList.remove('in'); void n.offsetWidth; n.classList.add('in'); }
function _lvBurst(scene, x, y, emojis, n) {
  const fx = scene && scene.querySelector('.lv-fx'); if (!fx) return;
  for (let i = 0; i < (n || 8); i++) {
    const e = document.createElement('i'); e.className = 'lv-pop'; e.textContent = emojis[i % emojis.length];
    e.style.left = x + 'px'; e.style.top = y + 'px'; e.style.setProperty('--dx', (Math.random() * 120 - 60).toFixed(0) + 'px'); e.style.setProperty('--dy', (-40 - Math.random() * 70).toFixed(0) + 'px');
    fx.appendChild(e); setTimeout(() => e.remove(), 1200);
  }
}
const LV_POKE = ['😆 Hey, that tickles!', '💪 Flex mode ON', '🕺 *dances*', '☕ More coffee please', '🙈 Don\'t tell the manager', '🤖 Beep boop, I\'m a professional', '😤 I\'m working here!', '🥳 Best team ever', '🫠 I need a holiday', '🧘 Inner peace…', '🤌 Chef\'s kiss service', '🏆 Employee of the minute!'];
/** Tap someone: they jump and say something silly. */
function lvPoke(el) {
  const sc = el.closest('.lv-scene'), b = el.querySelector('.lv-bub');
  _lvFun.pokes++; el.classList.remove('jump'); void el.offsetWidth; el.classList.add('jump');
  if (b) { const was = b.dataset.was || b.textContent; b.dataset.was = was; b.textContent = LV_POKE[Math.floor(Math.random() * LV_POKE.length)]; clearTimeout(b._t); b._t = setTimeout(() => { b.textContent = b.dataset.was; delete b.dataset.was; }, 2600); }
  if (sc) { const r = el.getBoundingClientRect(), s = sc.getBoundingClientRect(); _lvBurst(sc, r.left - s.left + r.width / 2, r.top - s.top + 40, ['❤️', '✨', '😂', '⭐'], 7); }
  _lvBeep(520 + Math.random() * 300, 0.12, 'triangle'); lvStats();
  if (typeof lvBadge === 'function') { lvBadge('poke', '👉 First poke: say hi to the team'); if (_lvFun.pokes >= 10) lvBadge('poke10', '🤪 Poke master: 10 pokes'); }
}
/** Ring the bell: DING! Everyone jumps, "Coming!" */
function lvDing(i) {
  const h = document.getElementById('lvH' + i); if (!h) return;
  _lvFun.dings++; _lvBeep(1320, 0.5); setTimeout(() => _lvBeep(1760, 0.4), 120);
  const bell = h.querySelector('.lv-bell'); if (bell) { bell.classList.remove('ding'); void bell.offsetWidth; bell.classList.add('ding'); }
  h.querySelectorAll('.lv-st.on').forEach((el, j) => setTimeout(() => { el.classList.remove('jump'); void el.offsetWidth; el.classList.add('jump'); const b = el.querySelector('.lv-bub'); if (b && !b.dataset.was) { b.dataset.was = b.textContent; b.textContent = ['🏃 Coming!', '🙋 Yes, how can I help?', '🫡 Right away!'][j % 3]; clearTimeout(b._t); b._t = setTimeout(() => { b.textContent = b.dataset.was; delete b.dataset.was; }, 2200); } }, j * 120));
  const sc = h.querySelector('.lv-scene'); if (sc) _lvBurst(sc, 28, sc.clientHeight - 60, ['DING!', '🔔', '✨'], 5);
  if (!h.querySelector('.lv-st.on')) _lvNews('🛎 DING DING… nobody here! 🦗');
  else if (_lvFun.dings % 5 === 0) _lvNews(`🛎 Bell rung ${_lvFun.dings} times. The team would like a word 😅`);
  if (_lvFun.dings >= 10 && typeof lvBadge === 'function') lvBadge('ding10', '🛎 Bell addict: 10 dings');
  lvStats();
}
/** Every few seconds something happens somewhere in a lobby. */
function lvSurprise() {
  const hs = [...document.querySelectorAll('#lvBody .lv-hotel')]; if (!hs.length) return;
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (_lvAt == null && _lvOpsHold > Date.now()) return;              // real news just came in: let it be read
  if (_lvAt == null && Math.random() < 0.45 && lvOpsReal()) return;   // half the time: something really going on in the hotel
  const h = hs[Math.floor(Math.random() * hs.length)], sc = h.querySelector('.lv-scene'), fx = h.querySelector('.lv-fx'); if (!fx) return;
  const L = h.classList.contains('night') ? LV_NIGHT_EV.concat(LV_EVENTS.slice(0, 6)) : LV_EVENTS, [e, kind, txt] = L[Math.floor(Math.random() * L.length)];
  const el = document.createElement('span'); el.className = 'lv-ev ' + kind; el.textContent = e;
  if (kind === 'walk' && Math.random() < 0.5) el.classList.add('rev');
  if (kind !== 'walk') el.style.left = (15 + Math.random() * 70).toFixed(0) + '%';
  fx.appendChild(el); setTimeout(() => el.remove(), 7000);
  if (kind === 'ring') { const ph = h.querySelector('.lv-phone'); if (ph) { ph.classList.remove('ring'); void ph.offsetWidth; ph.classList.add('ring'); } _lvBeep(660, 0.08); setTimeout(() => _lvBeep(660, 0.08), 160); }
  const g = (h.querySelector('.lv-hud b') || {}).textContent || '';
  _lvFun.events++; _lvNews(`${e} ${g ? g.split(' ')[0] + ': ' : ''}${txt}`);
  if (sc && kind === 'float' && /💸|⭐/.test(e)) _lvBurst(sc, sc.clientWidth / 2, 80, ['✨', '🎉', '💛'], 8);
  lvStats();
}
/** The day so far, in silly numbers. */
function lvStats() {
  const el = document.getElementById('lvStats'); if (!el) return;
  const t = _lvAt != null ? _lvAt : Date.now(), now = new Date(t), today = roIso(now);
  let hours = 0, people = 0;
  [roAdd(today, -1), today].forEach(day => roPeople(day, true).forEach(x => { const sp = roSpan(day, x.info); if (!sp) return; const a = Math.max(sp.start, roDate(today)), b = Math.min(sp.end, now); if (b > a) { hours += (b - a) / 36e5; people++; } }));
  const hr = now.getHours(), guests = Math.round(hours * 2.3 + (hr >= 14 ? 12 : 0));
  el.innerHTML = [`☕ <b>${Math.floor(hours / 2.5)}</b> coffees`, `🧳 <b>${guests}</b> guests helped`, `📶 <b>${Math.floor(guests / 3)}</b> "what's the WiFi?"`, `🙋 <b>${people}</b> heroes on duty today`, `🛎 <b>${_lvFun.dings}</b> dings`, `👉 <b>${_lvFun.pokes}</b> pokes`].map(x => `<span>${x}</span>`).join('');
}
function lvSeek(min) { clearInterval(_lvPlay); _lvPlay = null; const b = document.getElementById('lvPlayB'); if (b) b.textContent = '▶ Play the day'; _lvAt = min == null ? null : roDate(roToday()).getTime() + min * 6e4; lvRender(); }
/** ▶ the whole day in about 20 seconds: people walk in, work, walk home. */
function lvPlay() {
  const b = document.getElementById('lvPlayB');
  if (_lvPlay) { clearInterval(_lvPlay); _lvPlay = null; if (b) b.textContent = '▶ Play the day'; return; }
  if (b) b.textContent = '⏸ Pause';
  const d0 = roDate(roToday()).getTime(); let m = _lvAt != null && _lvAt - d0 < 1430 * 6e4 ? Math.round((_lvAt - d0) / 6e4) : 0;
  _lvPlay = setInterval(() => { m += 4; if (m >= 1440) { lvSeek(null); return; } _lvAt = d0 + m * 6e4; lvRender(); }, 60);   // smooth: small steps
}

// ── 📡 The desk lives with the app ────────────────────────
// What HotelOps knows right now shows up in your own lobby (read only: nothing here changes any data):
//   Departures (depRooms)          → the board OUT 12/34, a guest walks out with luggage for each new check-out,
//                                    overdue guests wait by the door with ⏰ and their room
//   Arrivals (arrGuests)           → ARR on the board, guests walk in when a list is loaded
//   In-house (hoInHouse.rooms)     → 🛏 in house
//   WhatsApp (hoWaBridge.log)      → the phone rings and says what it understood
//   Handover Book (hoHandoverBook) → 📋 on the desk with what is still open
//   Room Health (hoRoomHealth)     → 🧰 on the desk, an engineer / housekeeper heads to the room
//   Shift Tasks (SHIFTS, stCount)  → ✅ progress, +1 for each tick, a party when all are done
//   Ops Brain (blThoughts)         → a thought cloud over whoever is at the desk
// A part whose page isn't loaded just stays quiet. Read every 5 s while the live desk is open.
let _lvOpsT = null, _lvOps = null, _lvOpsHold = 0, _lvHome = 0, _lvInh = { at: 0, n: 0 };
const _lvTry = f => { try { return f(); } catch (_) { return null; } };
const LV_DEPT = { eng: ['🧑‍🔧', '🔧', 'Engineering'], hk: ['🧹', '🧹', 'Housekeeping'], it: ['🧑‍💻', '💻', 'IT'], sec: ['💂', '🛡', 'Security'] };
const _lvCut = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const _lvFirst = s => String(s || '').replace(/^[~+\s]+/, '').split(/[\s@]/)[0];
const _lvCalm = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** One look at the app: plain numbers and short lists, null for what isn't loaded. */
function lvOpsRead(now) {
  const W = typeof window !== 'undefined' ? window : {}, O = {};
  now = now || Date.now();
  O.dep = _lvTry(() => {
    if (typeof depRooms === 'undefined' || !depRooms.length || typeof depCounts !== 'function') return null;
    const c = depCounts(), rm = r => String(r.roomStr || r.room);
    return { out: c.out, total: c.all - c.extended, ext: c.extended, lco: depRooms.filter(r => r.status === 'late').length,
      late: typeof isLcoOverdue === 'function' ? depRooms.filter(r => _lvTry(() => isLcoOverdue(r))).map(rm) : [],
      outRooms: depRooms.filter(r => r.status === 'out').map(rm) };
  });
  O.arr = _lvTry(() => typeof arrGuests !== 'undefined' && arrGuests.length ? { n: arrGuests.length } : null);
  O.inh = _lvTry(() => {
    if (!W.hoInHouse || typeof W.hoInHouse.rooms !== 'function') return null;
    if (now - _lvInh.at > 30000) _lvInh = { at: now, n: W.hoInHouse.rooms().filter(r => r && r.name && r.status !== 'out' && !(parseInt(String(r.room || '').replace(/\D/g, ''), 10) >= 9000)).length };   // the biggest list: every 30 s is plenty
    return _lvInh.n ? { n: _lvInh.n } : null;
  });
  O.wa = _lvTry(() => {
    if (!W.hoWaBridge || typeof W.hoWaBridge.log !== 'function') return null;
    const L = W.hoWaBridge.log().filter(l => l && !l.mine && !l.preview && !l.deleted);
    return L.length ? { n: L.length, last: L.reduce((a, l) => Math.max(a, l.at || 0), 0), list: L.slice(0, 12).map(l => ({ at: l.at || 0, sender: l.sender || '', text: l.text || '', r: (l.res || []).find(r => r && r.room && !/^(skip|none|ignore|log|preview)$/.test(r.st)) || null })) } : null;
  });
  O.hb = _lvTry(() => {
    if (!W.hoHandoverBook || typeof W.hoHandoverBook.items !== 'function') return null;
    const I = W.hoHandoverBook.items().filter(i => i && !i.del && !i.chat), open = I.filter(i => i.status === 'open');
    return I.length ? { open: open.length, done: I.filter(i => i.status === 'done').length, keys: open.map(i => i.key), text: Object.fromEntries(open.slice(0, 40).map(i => [i.key, i.text || ''])) } : null;
  });
  O.rh = _lvTry(() => {
    if (!W.hoRoomHealth || typeof W.hoRoomHealth.recs !== 'function') return null;
    const R = W.hoRoomHealth.recs().filter(r => r && r.room);
    return R.length ? { n: R.length, list: R.slice(0, 8).map(r => ({ id: r.id, room: String(r.room), dept: r.dept, say: r.say || '', sev: r.sev })) } : null;
  });
  O.st = _lvTry(() => {
    if (typeof SHIFTS === 'undefined' || typeof hoShiftNow !== 'function' || typeof stCount !== 'function') return null;
    const k = hoShiftNow(new Date(now)).key, c = stCount(k);
    return c && c.total ? { key: k, label: String((SHIFTS[k] || {}).label || k).replace(/ Shift$/i, ''), done: c.done, total: c.total } : null;
  });
  O.brain = _lvTry(() => {
    if (typeof blThoughts === 'undefined' || !blThoughts.length) return null;
    const t = blThoughts.find(x => x && !x.silent && x.text); return t ? { id: t.id, icon: t.icon || '💭', text: t.text, tone: t.tone || '' } : null;
  });
  return O;
}
/** Every 5 s: read, show the numbers, and act out what changed since last time. */
function lvOpsTick() {
  if (!document.getElementById('lvView')) { clearInterval(_lvOpsT); _lvOpsT = null; return; }
  const P = _lvOps, O = lvOpsRead(); _lvOps = O;
  lvOpsStrip(O); _lvOpsPaint();
  _lvOpsBadges(O);
  if (P && _lvAt == null) _lvOpsReact(P, O);   // the first look only sets the scene; while ▶ plays the day nothing is acted out
}
/** The numbers above the lobby: tap one to go to that page. */
function lvOpsStrip(O) {
  const el = document.getElementById('lvOps'); if (!el) return;
  const chip = (go, cls, html, title, pct) => `<button type="button" class="lv-op${cls ? ' ' + cls : ''}" onclick="lvGo('${go}')" title="${escapeHtml(title)}"><span>${html}</span>${pct != null ? `<i class="lv-opbar"><i style="width:${pct}%"></i></i>` : ''}</button>`;
  const D = O.dep, out = [];
  if (D) {
    out.push(chip('departures', D.total && D.out >= D.total ? 'ok' : '', `🧳 <b>${D.out}/${D.total}</b> out`, `Departures: ${D.out} of ${D.total} checked out${D.ext ? `, ${D.ext} extended` : ''}`, D.total ? Math.round(D.out / D.total * 100) : 0));
    if (D.late.length) out.push(chip('departures', 'bad', `⏰ <b>${D.late.length}</b> overdue`, 'Past their check-out time: ' + D.late.join(', ')));
    else if (D.lco) out.push(chip('departures', '', `🕐 <b>${D.lco}</b> LCO`, 'Late check-outs agreed'));
  }
  if (O.arr) out.push(chip('arrivals', '', `🛎 <b>${O.arr.n}</b> arriving`, 'Arrivals expected today'));
  if (O.inh) out.push(chip('inhouse', '', `🛏 <b>${O.inh.n}</b> in house`, 'Rooms in house'));
  if (O.wa) out.push(chip('departures', '', `💬 <b>${O.wa.n}</b> read`, 'WhatsApp messages read today'));
  if (O.hb) out.push(chip('handover-book', O.hb.open ? 'warn' : 'ok', `📋 <b>${O.hb.open}</b> open`, `Handover Book: ${O.hb.open} open, ${O.hb.done} done`));
  if (O.rh) out.push(chip('room-health', 'warn', `🩺 <b>${O.rh.n}</b> to fix`, 'Room Health: rooms with a problem to send'));
  if (O.st) out.push(chip('shifts', O.st.done >= O.st.total ? 'ok' : '', `✅ <b>${O.st.done}/${O.st.total}</b> ${escapeHtml(O.st.label)}`, `${O.st.label} tasks done`, Math.round(O.st.done / O.st.total * 100)));
  const html = out.length ? '<span class="lv-ops-t">📡 LIVE</span>' + out.join('') : '<small class="lv-ops-none">📡 Load today\'s departures or arrivals and the lobby joins in: guests walk out with their bags, the phone rings for WhatsApp…</small>';
  if (el.innerHTML !== html) el.innerHTML = html;
}
function lvGo(p) { lvClose(); if (typeof showPanel === 'function') showPanel(p); }
function _lvHomeEl() { return document.getElementById('lvH' + _lvHome) || document.getElementById('lvH0'); }
/** What stays in your lobby while it's true: the board, the guests waiting, 📋 and 🧰 on the desk, the thought cloud. */
function _lvOpsPaint() {
  const O = _lvOps, h = _lvHomeEl(), sc = h && h.querySelector('.lv-scene'); if (!O || !sc) return;
  let L = sc.querySelector('.lv-opsl'); if (!L) { L = document.createElement('div'); L.className = 'lv-opsl'; sc.appendChild(L); }
  const D = O.dep, live = _lvAt == null, parts = [];
  if (live && (D || O.arr)) parts.push(`<div class="lv-board" onclick="lvGo('departures')" title="Today's departures"><b>${D && D.total && D.out >= D.total ? '🏆 ALL OUT' : 'TODAY'}</b>${D ? `<span>OUT <em>${D.out}/${D.total}</em></span><i class="lv-bbar"><i style="width:${D.total ? Math.round(D.out / D.total * 100) : 0}%"></i></i>${D.late.length ? `<span>LATE <em class="bad">${D.late.length}</em></span>` : ''}` : ''}${O.arr ? `<span>ARR <em>${O.arr.n}</em></span>` : ''}</div>`);
  if (live && D) D.late.slice(0, 3).forEach((r, i) => parts.push(`<div class="lv-wait" style="right:${3 + i * 13}%;--d:${i * .4}s" onclick="_lvNews('⏰ Room ${escapeHtml(r)} is past its check-out time')" title="Room ${escapeHtml(r)}: past check-out"><small>⏰ ${escapeHtml(r)}</small>${avSvg('~g' + r, 30, 'tired')}<span>🧳</span></div>`));
  if (live && O.hb && O.hb.open) parts.push(`<button type="button" class="lv-desko r" onclick="lvGo('handover-book')" title="Handover Book: ${O.hb.open} open">📋<b>${O.hb.open}</b></button>`);
  if (live && O.rh) parts.push(`<button type="button" class="lv-desko l" onclick="lvGo('room-health')" title="Room Health: ${O.rh.n} to send">🧰<b>${O.rh.n}</b></button>`);
  const sig = parts.join('');
  if (L.dataset.sig !== sig) { L.innerHTML = sig; L.dataset.sig = sig; }
  // 💭 Ops Brain thinks out loud over you (or whoever is at the desk)
  const st = h.querySelector('.lv-st.on.me') || h.querySelector('.lv-st.on'), want = live && O.brain && st ? O.brain : null;
  h.querySelectorAll('.lv-think').forEach(x => { if (!want || x.parentNode !== st || x.dataset.id !== want.id) x.remove(); });
  if (want && !st.querySelector('.lv-think')) st.insertAdjacentHTML('afterbegin', `<div class="lv-think${want.tone === 'bad' ? ' bad' : ''}" data-id="${escapeHtml(want.id)}" title="Ops Brain">${escapeHtml(want.icon)} ${escapeHtml(_lvCut(want.text, 70))}</div>`);
}
/** Someone crossing the floor: a guest leaving or arriving, or an engineer on the way. */
function _lvWalker(kind, key, tag, delay) {
  const h = _lvHomeEl(), fx = h && h.querySelector('.lv-fx'); if (!fx || _lvCalm()) return;
  const el = document.createElement('div'); el.className = 'lv-walk ' + kind; el.style.animationDelay = (delay || 0) + 's';
  const who = kind === 'fix' ? `<span class="lv-wemo">${(LV_DEPT[key] || LV_DEPT.eng)[0]}</span>` : `<div class="lv-gav">${avSvg('~g' + key, 34, 'happy')}</div><i class="lv-legs"><b></b><b></b></i>`;
  el.innerHTML = `${tag ? `<small>${escapeHtml(tag)}</small>` : ''}${who}${kind === 'fix' ? '' : '<span class="lv-bag">🧳</span>'}`;
  fx.appendChild(el); setTimeout(() => el.remove(), 7000 + (delay || 0) * 1000);
}
/** The phone rings and says what came in. */
function _lvPhone(text) {
  const h = _lvHomeEl(); if (!h) return;
  const ph = h.querySelector('.lv-phone'); if (ph) { ph.classList.remove('ring'); void ph.offsetWidth; ph.classList.add('ring'); }
  _lvBeep(660, 0.08); setTimeout(() => _lvBeep(660, 0.08), 160);
  const fx = h.querySelector('.lv-fx'); if (!fx) return;
  fx.querySelectorAll('.lv-say').forEach(x => x.remove());
  const b = document.createElement('div'); b.className = 'lv-say'; b.textContent = text; fx.appendChild(b); setTimeout(() => b.remove(), 4800);
}
function _lvParty(msg) {
  const h = _lvHomeEl(), sc = h && h.querySelector('.lv-scene'); if (msg) _lvNews(msg);
  [784, 988, 1175, 1568].forEach((f, i) => setTimeout(() => _lvBeep(f, 0.18, 'triangle'), i * 110));
  if (!sc || _lvCalm()) return;
  _lvBurst(sc, sc.clientWidth / 2, sc.clientHeight / 2, ['🎉', '✨', '🥳', '⭐', '🎊'], 16);
  h.querySelectorAll('.lv-st.on').forEach((el, j) => setTimeout(() => { el.classList.remove('jump'); void el.offsetWidth; el.classList.add('jump'); }, j * 120));
}
const _lvSay = r => r ? ({ co: '✓ Check-out', lco: '⏰ Late check-out', ext: '↪ Extension', req: '📝 Request', note: '📝 Note', maybe: '🤔 Might extend', fin: '🧾 Finance', ho: '📋 Handover' }[r.st] || '💬') + ' · ' + r.room : '';
/** What changed since the last look, acted out (and said in the lobby news). */
function _lvOpsReact(P, O) {
  const news = [], h = _lvHomeEl(), sc = h && h.querySelector('.lv-scene');
  const D = O.dep, PD = P.dep;
  if (D && PD) {
    const was = new Set(PD.outRooms), fresh = D.outRooms.filter(r => !was.has(r));
    fresh.slice(0, 3).forEach((r, i) => _lvWalker('out', r, '✓ ' + r, i * 1.4));
    if (fresh.length) { news.push(`🧳 ${fresh.length > 1 ? fresh.length + ' rooms' : 'Room ' + fresh[0]} checked out · ${D.out}/${D.total} done`); _lvBeep(523, 0.1, 'triangle'); setTimeout(() => _lvBeep(784, 0.14, 'triangle'), 110); }
    const lw = new Set(PD.late), nl = D.late.filter(r => !lw.has(r));
    if (nl.length) { news.push(`⏰ ${nl.length > 1 ? nl.length + ' rooms are' : 'Room ' + nl[0] + ' is'} past check-out time`); _lvBeep(330, 0.25, 'sawtooth'); }
    if (D.total && D.out >= D.total && PD.out < PD.total) { news.unshift('🎉 Every departure is checked out! Take a bow, team'); setTimeout(() => _lvParty(), 1200); }
  }
  if (O.arr && (!P.arr || O.arr.n > P.arr.n)) {
    const n = O.arr.n - (P.arr ? P.arr.n : 0);
    news.push(`🛎 ${P.arr ? '+' + n + ' arrival' + (n > 1 ? 's' : '') + ' · ' : ''}${O.arr.n} arriving today`);
    [0, 1].slice(0, Math.min(2, n)).forEach(i => _lvWalker('in', 'a' + O.arr.n + i, '', i * 1.6));
    const bell = h && h.querySelector('.lv-bell'); if (bell) { bell.classList.remove('ding'); void bell.offsetWidth; bell.classList.add('ding'); } _lvBeep(1320, 0.3);
  }
  if (O.wa && (!P.wa || O.wa.last > P.wa.last)) {
    const since = P.wa ? P.wa.last : 0, nw = O.wa.list.filter(l => l.at > since);
    const m = nw[0] || O.wa.list[0];
    if (m) { _lvPhone(m.r ? _lvSay(m.r) : '💬 ' + _lvCut(m.text, 28)); news.push(`💬 ${_lvFirst(m.sender) || 'WhatsApp'}: ${_lvCut(m.text, 60)}${nw.length > 1 ? ` (+${nw.length - 1} more)` : ''}`); }
  }
  if (O.hb && P.hb) {
    const was = new Set(P.hb.keys), nk = O.hb.keys.filter(k => !was.has(k));
    if (nk.length) { news.push(`📋 Handover: ${_lvCut(O.hb.text[nk[0]] || 'new item', 60)}`); const c = h && h.querySelector('.lv-desko.r'); if (c) { c.classList.remove('hop'); void c.offsetWidth; c.classList.add('hop'); } }
    if (O.hb.done > P.hb.done) { news.push(`✅ Handover item done · ${O.hb.open} still open`); if (sc && !_lvCalm()) _lvBurst(sc, sc.clientWidth * 0.85, sc.clientHeight - 90, ['✅', '✨'], 5); }
  }
  if (O.rh || P.rh) {
    const was = new Set(((P.rh || {}).list || []).map(r => r.id)), now = new Set(((O.rh || {}).list || []).map(r => r.id));
    ((O.rh || {}).list || []).filter(r => !was.has(r.id)).slice(0, 2).forEach((r, i) => { _lvWalker('fix', r.dept, (LV_DEPT[r.dept] || LV_DEPT.eng)[1] + ' ' + r.room, i * 1.5); news.push(`🩺 Room ${r.room}: ${_lvCut(r.say, 40)}. ${(LV_DEPT[r.dept] || LV_DEPT.eng)[2]} needed`); });
    const fixed = ((P.rh || {}).list || []).filter(r => !now.has(r.id));
    if (fixed.length && P.rh && (!O.rh || O.rh.n < P.rh.n)) { news.push(`🔧 Room ${fixed[0].room} sorted: ${_lvCut(fixed[0].say, 40)}`); if (sc && !_lvCalm()) _lvBurst(sc, 40, sc.clientHeight - 90, ['🔧', '✨', '👍'], 6); if (typeof lvBadge === 'function') lvBadge('fixer', '🔧 Fixer: a room problem sorted while you watched'); }
  }
  if (O.st && P.st && O.st.key === P.st.key && O.st.done !== P.st.done) {
    if (O.st.done > P.st.done && sc && !_lvCalm()) { const st = h.querySelector('.lv-st.on.me') || h.querySelector('.lv-st.on'), r = st && st.getBoundingClientRect(), s = sc.getBoundingClientRect(); _lvBurst(sc, r ? r.left - s.left + r.width / 2 : sc.clientWidth / 2, r ? r.top - s.top + 30 : 120, ['+1 ✅'], 1); }
    if (O.st.done >= O.st.total && P.st.done < P.st.total) { news.unshift(`🎉 All ${O.st.label} tasks done!`); setTimeout(() => _lvParty(), 600); }
    else if (O.st.done > P.st.done) news.push(`✅ Task ticked · ${O.st.done}/${O.st.total} ${O.st.label}`);
  }
  if (news.length) { _lvNQ = _lvNQ.concat(news).slice(-6); if (!_lvNT) _lvNDrain(); lvStats(); }
}
/** The real news, one line at a time (3.5 s each) so each can be read; the made-up surprises wait. */
let _lvNQ = [], _lvNT = null;
function _lvNDrain() {
  if (!_lvNQ.length || !document.getElementById('lvView')) { _lvNT = null; _lvNQ = []; return; }
  _lvNews(_lvNQ.shift()); _lvOpsHold = Date.now() + 6000; _lvNT = setTimeout(_lvNDrain, 3500);
}
/** 🏅 The real-work badges (once each, on this device). */
function _lvOpsBadges(O) {
  if (typeof lvBadge !== 'function' || _lvAt != null) return;
  const D = O.dep, hr = new Date().getHours();
  if (D && D.total >= 3 && D.out >= D.total) lvBadge('allout', '🏁 All out: every departure checked out');
  if (D && hr >= 13 && D.out >= 3 && !D.late.length) lvBadge('zerolate', '⏱ On time: nobody overdue after 1 PM');
  if (O.st && O.st.total >= 3 && O.st.done >= O.st.total) lvBadge('tasks', '📝 Clean sheet: every shift task ticked');
  if (O.wa && O.wa.n >= 25) lvBadge('wa25', '💬 Chatterbox: 25 WhatsApps read today');
  if (O.hb && O.hb.done >= 5 && !O.hb.open) lvBadge('hbzero', '📋 Clear desk: nothing left open in the handover');
}
/** Now and then, instead of a made-up surprise, something really going on. */
function lvOpsReal() {
  const O = _lvOps; if (!O) return false;
  const opts = [];
  if (O.rh) opts.push(() => { const r = O.rh.list[Math.floor(Math.random() * O.rh.list.length)], d = LV_DEPT[r.dept] || LV_DEPT.eng; _lvWalker('fix', r.dept, d[1] + ' ' + r.room); _lvNews(`${d[0]} Room ${r.room}: ${_lvCut(r.say, 44)}. Has ${d[2]} been told?`); });
  if (O.dep && O.dep.late.length) opts.push(() => _lvNews(`⏰ Room ${O.dep.late[Math.floor(Math.random() * O.dep.late.length)]} is still in, past check-out. A quick call?`));
  if (O.dep && O.dep.total > O.dep.out) opts.push(() => _lvNews(`🧳 ${O.dep.out} of ${O.dep.total} checked out. ${O.dep.total - O.dep.out} to go!`));
  if (O.st && O.st.done < O.st.total) opts.push(() => _lvNews(`✅ ${O.st.total - O.st.done} ${O.st.label} task${O.st.total - O.st.done > 1 ? 's' : ''} left on the list`));
  if (O.hb && O.hb.open) opts.push(() => _lvNews(`📋 ${O.hb.open} handover item${O.hb.open > 1 ? 's' : ''} still open`));
  if (O.wa && O.wa.list.length) opts.push(() => { const m = O.wa.list[0]; if (m.r) _lvPhone(_lvSay(m.r)); _lvNews(`💬 Last WhatsApp: ${_lvCut(m.text, 60)}`); });
  if (O.arr && new Date().getHours() >= 13) opts.push(() => { _lvWalker('in', 'r' + Date.now() % 97, ''); _lvNews(`🛎 ${O.arr.n} arrivals today. Keys ready?`); });
  if (!opts.length) return false;
  opts[Math.floor(Math.random() * opts.length)](); return true;
}
