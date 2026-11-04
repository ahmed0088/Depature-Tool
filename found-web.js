// ═══════════════════════════════════════════════════════════
//  found-web.js — the "Found" theme's jumping spider and its silk
//  Runs only while the Found theme is on (html[data-skin="found"]), on a computer with a mouse, and not when the
//  device asks for less motion. One canvas on top of the page that never takes a click (pointer-events: none).
//  The spider drops in on a thread, follows the pointer at a distance on eight two-bone legs (alternating gait),
//  and spins sagging silk (verlet ropes, dew drops, a glint) between the edges of the cards it walks past.
//  Your normal mouse pointer stays. The web is cleared when the page changes or scrolls (the cards move).
// ═══════════════════════════════════════════════════════════
(function () {
  'use strict';
  const D = document, H = D.documentElement;
  const want = () => H.getAttribute('data-skin') === 'found' && !matchMedia('(prefers-reduced-motion: reduce)').matches && matchMedia('(hover: hover) and (pointer: fine)').matches;
  let cv = null, ctx = null, raf = 0, W = 0, Hh = 0, dpr = 1, last = 0, B = 0;
  const P = { x: -1, y: -1, t: 0, in: false };
  const S = { x: 0, y: -120, h: Math.PI / 2, v: 0, intro: 0, feet: [], lt: 0 };
  let ropes = [], anchors = [], live = null, lastAnchor = null, anchorsAt = 0, lastAt = 0;

  // ── legs: hip (body space, +x = forward), rest foot, femur/tibia length, gait group ──
  const K = 0.9, LEGS = [];
  [[18, 9, 58, 40], [6, 11, 38, 62], [-6, 11, -8, 64], [-17, 9, -48, 50]].forEach(([hx, hy, fx, fy], i) => {
    [1, -1].forEach(side => {
      const hip = { x: hx * K, y: hy * K * side }, rest = { x: fx * K, y: fy * K * side };
      const d = Math.hypot(rest.x - hip.x, rest.y - hip.y), a = d * 0.6, b = d * 0.62;
      LEGS.push({ hip, rest, a, b, side, group: (i + (side > 0 ? 0 : 1)) % 2 });
    });
  });

  function setup() {
    cv = D.createElement('canvas'); cv.id = 'foundWeb'; cv.setAttribute('aria-hidden', 'true');
    cv.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:9500';
    D.body.appendChild(cv); ctx = cv.getContext('2d'); size();
    S.x = innerWidth * 0.62; S.y = -120; S.h = Math.PI / 2; S.intro = 0; S.feet = [];
    live = { a: { x: S.x, y: -2 } }; lastAnchor = null; ropes = []; sample();
  }
  function size() { dpr = Math.min(2, devicePixelRatio || 1); W = innerWidth; Hh = innerHeight; cv.width = W * dpr; cv.height = Hh * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
  // edge points of the cards / headings the silk can stick to (every 9px along each visible box)
  function sample() {
    anchors = []; anchorsAt = performance.now();
    D.querySelectorAll('.panel.active .card, .panel.active .home-tile, .panel.active .page-hd h1, .panel.active .kpi, .topbar, .sidenav').forEach(el => {
      const r = el.getBoundingClientRect(); if (r.width < 30 || r.height < 16 || r.bottom < 0 || r.top > Hh) return;
      const per = (x0, y0, x1, y1) => { const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / 9)); for (let i = 0; i <= n; i++) anchors.push({ x: x0 + (x1 - x0) * i / n, y: y0 + (y1 - y0) * i / n }); };
      per(r.left, r.top, r.right, r.top); per(r.right, r.top, r.right, r.bottom); per(r.left, r.bottom, r.right, r.bottom); per(r.left, r.top, r.left, r.bottom);
    });
  }
  function clearWeb() { ropes = []; lastAnchor = null; live = { a: spinneret() }; sample(); }

  // ── silk: a verlet rope of 12 segments pinned at both ends, with a little sag ──
  function rope(a, b, thick, dew) {
    const n = 12, pts = []; for (let i = 0; i <= n; i++) { const t = i / n; pts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, px: a.x + (b.x - a.x) * t, py: a.y + (b.y - a.y) * t }); }
    const len = Math.hypot(b.x - a.x, b.y - a.y), drops = [];
    if (dew) for (let i = Math.floor(len / 55 * (0.4 + Math.random())); i-- > 0;) drops.push({ u: 0.1 + Math.random() * 0.8, r: 1.4 + Math.random() * 3.6 });
    ropes.push({ pts, rest: len / n * (1.01 + Math.random() * 0.006), thick, drops, born: performance.now(), ph: Math.random() * 6.28 });
    if (ropes.length > 60) ropes.shift();
  }
  function stepRopes(dt) {
    const g = 110 * dt * dt;
    ropes.forEach(r => {
      const wind = (Math.sin(0.45 * B) * 0.6 + Math.sin(1.3 * B + 1.7) * 0.4) * 22 * dt * dt;
      for (let i = 1; i < r.pts.length - 1; i++) { const p = r.pts[i], vx = (p.x - p.px) * 0.975, vy = (p.y - p.py) * 0.975; p.px = p.x; p.py = p.y; p.x += vx + wind * (0.6 + 0.4 * Math.sin(1.1 * B + p.y * 0.012 + r.ph)); p.y += vy + g; }
      for (let k = 0; k < 4; k++) for (let i = 0; i < r.pts.length - 1; i++) {
        const p = r.pts[i], q = r.pts[i + 1], dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 1, f = (d - r.rest) / d / 2;
        if (i > 0) { p.x += dx * f; p.y += dy * f; } if (i + 1 < r.pts.length - 1) { q.x -= dx * f; q.y -= dy * f; }
      }
    });
  }
  function spinneret() { return { x: S.x - Math.cos(S.h) * 26 * K, y: S.y - Math.sin(S.h) * 26 * K }; }
  function anchorLive() {
    if (!live || !anchors.length || S.v < 30 || performance.now() - lastAt < 350) return;
    const s = spinneret(); if (Math.hypot(s.x - live.a.x, s.y - live.a.y) < 90) return;
    let best = null, bd = 70;
    for (const a of anchors) { const d = Math.hypot(a.x - s.x, a.y - s.y); if (d < bd && Math.hypot(a.x - live.a.x, a.y - live.a.y) > 54) { bd = d; best = a; } }
    if (!best) return;
    rope(live.a, best, 1.1, true);
    if (lastAnchor && Math.hypot(lastAnchor.x - best.x, lastAnchor.y - best.y) < 288) rope(lastAnchor, best, 0.7, false);
    lastAnchor = best; live = { a: best }; lastAt = performance.now();
  }

  // ── the spider ──
  function follow(dt) {
    if (S.intro < 1) { S.intro = Math.min(1, S.intro + dt / 2.3); const v = 1 - Math.pow(1 - S.intro, 2.4); S.y = -120 + (Hh * 0.45 + 120) * v; S.h = Math.PI / 2; return; }
    if (!P.in) { S.v *= Math.exp(-6 * dt); return; }
    const dx = P.x - S.x, dy = P.y - S.y, d = Math.hypot(dx, dy), gap = 90;
    const want = Math.max(0, Math.min(620, (d - gap) * 4));
    S.v += (want - S.v) * (1 - Math.exp(-10 * dt));
    if (d > 4) { let a = Math.atan2(dy, dx) - S.h; while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; S.h += a * (1 - Math.exp(-8 * dt)); }
    S.x = Math.max(10, Math.min(W - 10, S.x + Math.cos(S.h) * S.v * dt)); S.y = Math.max(10, Math.min(Hh - 10, S.y + Math.sin(S.h) * S.v * dt));
  }
  const toWorld = p => ({ x: S.x + Math.cos(S.h) * p.x - Math.sin(S.h) * p.y, y: S.y + Math.sin(S.h) * p.x + Math.cos(S.h) * p.y });
  function feet(dt) {
    if (!S.feet.length) S.feet = LEGS.map(L => { const w = toWorld(L.rest); return { x: w.x, y: w.y, fx: w.x, fy: w.y, tx: w.x, ty: w.y, t: 1 }; });
    const vx = Math.cos(S.h) * S.v, vy = Math.sin(S.h) * S.v, trig = 34 * K * (S.v < 8 ? 0.3 : 1);
    LEGS.forEach((L, i) => {
      const f = S.feet[i];
      if (f.t < 1) { f.t = Math.min(1, f.t + dt / Math.max(0.055, Math.min(0.15, 0.15 - S.v / 3200))); const e = 1 - Math.pow(1 - f.t, 3); f.x = f.fx + (f.tx - f.fx) * e; f.y = f.fy + (f.ty - f.fy) * e; return; }
      const w = toWorld(L.rest), tx = w.x + vx * 0.09, ty = w.y + vy * 0.09, d = Math.hypot(tx - f.x, ty - f.y);
      const busy = S.feet.some((o, j) => j !== i && LEGS[j].group !== L.group && o.t < 1);
      if (d > trig && (!busy || d > trig * 1.6)) { f.fx = f.x; f.fy = f.y; f.tx = tx; f.ty = ty; f.t = 0; }
    });
  }
  function drawLeg(L, f) {
    const h = toWorld(L.hip), dx = f.x - h.x, dy = f.y - h.y, d = Math.min(Math.hypot(dx, dy), (L.a + L.b) * 0.98) || 1;
    const ang = Math.atan2(dy, dx), c = Math.max(-1, Math.min(1, (L.a * L.a + d * d - L.b * L.b) / (2 * L.a * d)));
    const lift = f.t < 1 ? Math.sin(Math.PI * f.t) * 10 * K : 0, k = ang - L.side * Math.acos(c);
    const kx = h.x + Math.cos(k) * L.a, ky = h.y + Math.sin(k) * L.a - lift;
    ctx.strokeStyle = '#3a2a1e'; ctx.lineCap = 'round';
    ctx.lineWidth = 3.2 * K; ctx.beginPath(); ctx.moveTo(h.x, h.y); ctx.lineTo(kx, ky); ctx.stroke();
    ctx.lineWidth = 2.2 * K; ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(f.x, f.y - (f.t < 1 ? Math.sin(Math.PI * f.t) * 6 * K : 0)); ctx.stroke();
    ctx.strokeStyle = 'rgba(240,226,200,.55)'; ctx.lineWidth = 1 * K; ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo((kx + f.x) / 2, (ky + f.y) / 2); ctx.stroke();
  }
  function drawSpider() {
    ctx.save(); ctx.shadowColor = 'rgba(8,14,70,.4)'; ctx.shadowBlur = 7; ctx.shadowOffsetX = 5; ctx.shadowOffsetY = 9;
    LEGS.forEach((L, i) => drawLeg(L, S.feet[i]));
    ctx.translate(S.x, S.y); ctx.rotate(S.h);
    const br = 1 + Math.sin(B * 3.2) * 0.025;
    // abdomen with cream bands
    ctx.save(); ctx.translate(-24 * K, 0); ctx.scale(br, br);
    const g = ctx.createRadialGradient(-4 * K, -6 * K, 2, 0, 0, 22 * K); g.addColorStop(0, '#9b7650'); g.addColorStop(0.6, '#5b3f28'); g.addColorStop(1, '#2c1d12');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, 21 * K, 17 * K, 0, 0, 7); ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.strokeStyle = 'rgba(244,232,210,.75)'; ctx.lineWidth = 2.2 * K;
    [-9, 1, 10].forEach(x => { ctx.beginPath(); ctx.ellipse(x * K, 0, 2.5 * K, 12 * K * (1 - Math.abs(x) / 30), 0, 0, 7); ctx.stroke(); });
    ctx.restore();
    // head with the big front eyes
    const hg = ctx.createRadialGradient(4 * K, -4 * K, 1, 6 * K, 0, 17 * K); hg.addColorStop(0, '#7a5a3c'); hg.addColorStop(1, '#2a1b10');
    ctx.fillStyle = hg; ctx.beginPath(); ctx.ellipse(8 * K, 0, 16 * K, 14 * K, 0, 0, 7); ctx.fill();
    ctx.shadowColor = 'transparent';
    [[20, -5, 4.4], [20, 5, 4.4], [16, -11, 2.2], [16, 11, 2.2]].forEach(([x, y, r]) => { ctx.fillStyle = '#0b0705'; ctx.beginPath(); ctx.arc(x * K, y * K, r * K, 0, 7); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.beginPath(); ctx.arc((x - 1) * K, (y - 1.2) * K, r * 0.32 * K, 0, 7); ctx.fill(); });
    ctx.restore();
  }
  function drawRopes(now) {
    const strand = (pts, w, a) => { ctx.lineWidth = w; ctx.strokeStyle = 'rgba(255,255,255,' + a + ')'; ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y); ctx.stroke(); };
    ropes.forEach(r => {
      const age = Math.min(1, (now - r.born) / 90000), fade = 1 - age * 0.5;
      ctx.save(); ctx.shadowColor = 'rgba(8,14,70,.42)'; ctx.shadowBlur = 3.5; ctx.shadowOffsetX = 7; ctx.shadowOffsetY = 11;
      strand(r.pts, r.thick * 4, 0.06 * fade); strand(r.pts, r.thick * 0.9, 0.8 * 0.75 * fade); ctx.restore();
      const a0 = Math.atan2(r.pts[12].y - r.pts[0].y, r.pts[12].x - r.pts[0].x), Pq = 0.5 + 0.5 * Math.sin(2 * a0 + 0.3 * B + r.ph);
      ctx.strokeStyle = 'hsla(' + (190 + 150 * Pq) + ',100%,74%,' + (0.12 + 0.3 * Pq * Pq * Pq) * fade + ')'; ctx.lineWidth = r.thick * 0.7;
      ctx.beginPath(); ctx.moveTo(r.pts[0].x, r.pts[0].y); r.pts.forEach(p => ctx.lineTo(p.x, p.y)); ctx.stroke();
      // a glint travelling along the thread
      const gi = Math.floor(((B * 0.6 + r.ph) % 1) * 12), gp = r.pts[gi], gq = r.pts[gi + 1];
      ctx.strokeStyle = 'rgba(255,255,255,' + 0.9 * fade + ')'; ctx.lineWidth = r.thick * 1.1; ctx.beginPath(); ctx.moveTo(gp.x, gp.y); ctx.lineTo(gq.x, gq.y); ctx.stroke();
      r.drops.forEach(dw => {
        const f = dw.u * 12, i = Math.min(11, Math.floor(f)), t = f - i, p = r.pts[i], q = r.pts[i + 1], x = p.x + (q.x - p.x) * t, y = p.y + (q.y - p.y) * t + dw.r * 0.4;
        const g = ctx.createRadialGradient(x - dw.r * 0.35, y - dw.r * 0.4, dw.r * 0.1, x, y, dw.r);
        g.addColorStop(0, 'rgba(255,255,255,' + 0.95 * fade + ')'); g.addColorStop(0.45, 'rgba(200,220,255,' + 0.25 * fade + ')'); g.addColorStop(0.85, 'rgba(255,210,150,' + 0.35 * fade + ')'); g.addColorStop(1, 'rgba(255,255,255,' + 0.6 * fade + ')');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, dw.r, 0, 7); ctx.fill();
      });
    });
    if (live) { const s = spinneret(); ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(live.a.x, live.a.y); ctx.lineTo(s.x, s.y); ctx.stroke(); }
  }
  function frame(now) {
    raf = 0; if (!cv) return;
    const dt = Math.min(0.033, (now - (last || now)) / 1000); last = now; B += dt;
    if (D.hidden) { raf = requestAnimationFrame(frame); return; }
    follow(dt); feet(dt); stepRopes(dt); if (S.intro >= 1) anchorLive();
    if (now - anchorsAt > 1500) sample();
    ctx.clearRect(0, 0, W, Hh); drawRopes(now); drawSpider();
    raf = requestAnimationFrame(frame);
  }
  function start() { if (cv || !want() || !D.body) return; setup(); last = 0; raf = requestAnimationFrame(frame); }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; if (cv) cv.remove(); cv = null; ctx = null; ropes = []; }
  function check() { want() ? start() : stop(); }
  addEventListener('pointermove', e => { if (e.pointerType !== 'mouse') return; P.x = e.clientX; P.y = e.clientY; P.in = true; }, { passive: true });
  D.addEventListener('mouseleave', () => { P.in = false; });
  addEventListener('resize', () => { if (cv) { size(); clearWeb(); } });
  addEventListener('scroll', () => { if (cv && ropes.length) clearWeb(); }, { passive: true, capture: true });
  addEventListener('keydown', e => { if (!cv) return; const t = e.target; if ((e.key === 'Delete' || e.key === 'Backspace') && !(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) clearWeb(); });
  // the page changed (another panel): the cards moved, so the old web goes
  new MutationObserver(() => { if (cv) clearWeb(); }).observe(D.documentElement, { attributes: true, subtree: true, attributeFilter: ['class'], attributeOldValue: false });
  new MutationObserver(check).observe(H, { attributes: true, attributeFilter: ['data-skin'] });
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', check); else check();
  window.hoFoundWeb = { start, stop, clearWeb, state: () => ({ on: !!cv, ropes: ropes.length, anchors: anchors.length, spider: { x: Math.round(S.x), y: Math.round(S.y) } }) };
})();
