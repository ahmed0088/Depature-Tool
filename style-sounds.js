// ═══════════════════════════════════════════════════════════
//  style-sounds.js — each App style has its own little sounds
//  Made on the spot with the Web Audio API (no sound files): a tap on a
//  button / menu / tab, a message popping up, and switching style.
//  🕹 Gaming bleeps · 💬 WhatsApp pops · ✈️ Telegram swish · 🎧 Discord
//  blips · 📝 Notes ticks · 🗒 Notepad key clicks · 🏛 Classic wood ·
//  📚 Study chimes · ⚡ Pro a soft tick.
//  Settings → Appearance → Style sounds: Off · Gaming only (default) · Every style.
//  Quiet on purpose, never on a hidden page, never more than one at a time.
// ═══════════════════════════════════════════════════════════

(function (W) {
  let ctx = null, last = 0;
  const skin = () => document.documentElement.getAttribute('data-skin') || '';
  const mode = () => (typeof hoPref === 'function' && hoPref('styleSounds')) || 'gaming';
  function on() {
    const m = mode(), s = skin();
    if (m === 'off' || document.hidden) return false;
    if (m === 'gaming') return s === 'gaming';
    return !!PACKS[s];
  }
  function ac() {
    if (!ctx) { const A = W.AudioContext || W.webkitAudioContext; if (!A) return null; ctx = new A(); }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  /** one tone: wave, start → end pitch (Hz), length (s), loudness, delay (s) */
  function tone(type, f0, f1, len, vol, at) {
    const c = ac(); if (!c) return;
    const t = c.currentTime + (at || 0), o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + len);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + len + 0.02);
  }
  /** a short noise burst (clicks, keys, wood) through a filter */
  function noise(len, vol, freq, q, at) {
    const c = ac(); if (!c) return;
    const t = c.currentTime + (at || 0), n = Math.max(1, Math.floor(c.sampleRate * len)), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q || 1; g.gain.value = vol;
    s.buffer = b; s.connect(f).connect(g).connect(c.destination); s.start(t);
  }
  const PACKS = {
    gaming:   { tap: () => tone('square', 880, 1320, 0.05, 0.035), toast: () => { tone('square', 660, 660, 0.06, 0.03); tone('square', 990, 990, 0.06, 0.03, 0.06); tone('square', 1320, 1320, 0.09, 0.03, 0.12); }, switch: () => { tone('sawtooth', 220, 1760, 0.28, 0.03); } },
    whatsapp: { tap: () => tone('sine', 500, 820, 0.06, 0.05), toast: () => { tone('sine', 700, 1100, 0.08, 0.06); tone('sine', 1100, 1400, 0.07, 0.04, 0.07); }, switch: () => tone('sine', 400, 900, 0.12, 0.05) },
    telegram: { tap: () => tone('sine', 900, 1250, 0.05, 0.04), toast: () => { tone('triangle', 1200, 700, 0.18, 0.05); }, switch: () => tone('triangle', 600, 1400, 0.16, 0.04) },
    discord:  { tap: () => tone('triangle', 740, 740, 0.04, 0.04), toast: () => { tone('sine', 880, 880, 0.09, 0.05); tone('sine', 1175, 1175, 0.14, 0.05, 0.09); }, switch: () => { tone('sine', 523, 523, 0.08, 0.04); tone('sine', 784, 784, 0.12, 0.04, 0.08); } },
    notes:    { tap: () => noise(0.025, 0.12, 3200, 2), toast: () => tone('sine', 1320, 1320, 0.12, 0.03), switch: () => noise(0.06, 0.1, 1800, 1) },
    notepad:  { tap: () => { noise(0.018, 0.2, 2600, 3); noise(0.012, 0.1, 900, 2, 0.02); }, toast: () => tone('sine', 1000, 1000, 0.1, 0.03), switch: () => { for (let i = 0; i < 4; i++) noise(0.018, 0.16, 2400 + i * 200, 3, i * 0.05); } },
    classic:  { tap: () => { tone('sine', 320, 260, 0.05, 0.06); noise(0.02, 0.06, 1200, 4); }, toast: () => tone('sine', 660, 660, 0.25, 0.035), switch: () => { tone('sine', 392, 392, 0.2, 0.035); tone('sine', 523, 523, 0.3, 0.03, 0.12); } },
    study:    { tap: () => tone('sine', 1500, 1500, 0.05, 0.025), toast: () => { tone('sine', 1047, 1047, 0.3, 0.035); tone('sine', 1568, 1568, 0.35, 0.025, 0.08); }, switch: () => { [523, 659, 784].forEach((f, i) => tone('sine', f, f, 0.25, 0.03, i * 0.08)); } },
    pro:      { tap: () => noise(0.012, 0.06, 4000, 2), toast: () => tone('sine', 1800, 1800, 0.05, 0.02), switch: () => tone('sine', 1200, 1600, 0.08, 0.02) },
  };
  function play(kind) {
    if (!on()) return;
    const p = PACKS[skin()]; if (!p || !p[kind]) return;
    const now = Date.now(); if (now - last < 60) return; last = now;
    try { p[kind](); } catch (_) {}
  }

  // a tap on something you press (only real fingers / mouse)
  document.addEventListener('pointerdown', e => {
    if (!e.isTrusted || e.button > 0) return;
    const t = e.target && e.target.closest && e.target.closest('button, .btn, .nav-item, .mob-nav-btn, .home-tile, [role="tab"], a[href], summary, .hs-switch, input[type=checkbox]');
    if (t && !t.disabled) play('tap');
  }, { capture: true, passive: true });
  // a message popping up
  const wrap = () => {
    if (typeof W.showToast !== 'function' || W.showToast._snd) return false;
    const orig = W.showToast;
    W.showToast = function () { play('toast'); return orig.apply(this, arguments); };
    W.showToast._snd = true; return true;
  };
  if (!wrap()) document.addEventListener('DOMContentLoaded', wrap);
  // switching style: its own little intro
  new MutationObserver(() => setTimeout(() => play('switch'), 30)).observe(document.documentElement, { attributes: true, attributeFilter: ['data-skin'] });

  W.hoStyleSounds = { play, packs: Object.keys(PACKS), on };
})(window);
