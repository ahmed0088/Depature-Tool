// ═══════════════════════════════════════════════════════════
//  stratum-fx.js — the "Stratum" theme's decoding labels
//  Only while html[data-skin="stratum"] is on and the device does not ask for less motion.
//  Hovering a menu item or a button makes its label resolve left-to-right in 400 ms, with a short
//  band of random A–Z letters running ahead and nothing drawn past it (the Stratum effect).
//  Only the label's own text node changes, its width is held while it decodes so nothing moves,
//  and the original text always comes back — the app's own content is never altered.
// ═══════════════════════════════════════════════════════════
(function () {
  'use strict';
  const D = document, H = D.documentElement, CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', DUR = 400;
  const on = () => H.getAttribute('data-skin') === 'stratum' && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const busy = new WeakMap();   // element → { node, text, raf, t, w }

  /** the label's own text: the first direct text node with letters in it (icons and badges are left alone) */
  function labelNode(el) {
    for (const n of el.childNodes) if (n.nodeType === 3 && /[A-Za-z]/.test(n.nodeValue)) return n;
    const span = el.querySelector(':scope > span:not(.nav-badge):not(.nav-icon)');
    if (span) for (const n of span.childNodes) if (n.nodeType === 3 && /[A-Za-z]/.test(n.nodeValue)) return n;
    return null;
  }
  function settle(el) {
    const b = busy.get(el); if (!b) return;
    cancelAnimationFrame(b.raf); clearTimeout(b.t);
    if (b.node.isConnected) b.node.nodeValue = b.text;
    el.style.width = b.w;
    busy.delete(el);
  }
  function decode(el) {
    if (!on() || busy.has(el)) return;
    const node = labelNode(el); if (!node) return;
    const raw = node.nodeValue, lead = raw.match(/^\s*/)[0], tail = raw.match(/\s*$/)[0], text = raw.trim();
    if (!text || text.length > 40) return;
    const n = text.length, rand = new Array(n), t0 = performance.now();
    const roll = () => { for (let i = 0; i < n; i++) rand[i] = CH.charAt((Math.random() * 26) | 0); };
    const b = { node, text: raw, raf: 0, t: 0, w: el.style.width };
    const r = el.getBoundingClientRect(); if (r.width) el.style.width = r.width + 'px';   // hold the width: the row never reflows
    busy.set(el, b); roll(); let last = 0;
    const step = now => {
      if (!node.isConnected) { busy.delete(el); el.style.width = b.w; return; }
      const p = Math.min(1, (now - t0) / DUR), front = p * n; let out = '';
      if (now - last > 45) { roll(); last = now; }
      for (let i = 0; i < n; i++) { const c = text.charAt(i); if (i < front) out += c; else if (i < front + 3.6) out += (c === ' ' ? ' ' : rand[i]); else break; }
      node.nodeValue = lead + out + tail;
      if (p < 1) b.raf = requestAnimationFrame(step); else settle(el);
    };
    b.raf = requestAnimationFrame(step);
    b.t = setTimeout(() => settle(el), DUR + 500);   // a throttled tab still ends on the real label
  }
  const SEL = '.nav-item, .btn, .mob-nav-btn, .mob-more-item, .fchip';
  D.addEventListener('pointerover', e => {
    if (!on() || e.pointerType === 'touch') return;
    const el = e.target.closest && e.target.closest(SEL);
    if (el && !(e.relatedTarget && el.contains(e.relatedTarget))) decode(el);
  }, { passive: true });
  window.hoStratumFx = { decode };
})();
