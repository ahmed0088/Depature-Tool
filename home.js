// ═══════════════════════════════════════════════════════════
//  home.js — Home dashboard
//  One screen at the start of a shift: what is open on every page,
//  each tile one tap from the page that fixes it. Reads the data the
//  other pages already hold; nothing here is stored separately.
// ═══════════════════════════════════════════════════════════

function _homeSafe(fn, fallback) { try { return fn(); } catch (_) { return fallback; } }

function homeTiles() {
  const tiles = [];
  const add = t => tiles.push(t);

  // Departures
  _homeSafe(() => {
    if (typeof depRooms === 'undefined' || !depRooms.length) {
      add({ panel: 'departures', icon: '🚪', title: 'Departures', big: '—', sub: 'Load today\'s Opera departures', tone: 'idle' });
      return;
    }
    const c = typeof depCounts === 'function' ? depCounts() : {};
    const open = (c.due || 0) + (c.late || 0) + (c.na || 0);
    const out = depRooms.filter(r => r.status === 'out').length;
    add({ panel: 'departures', icon: '🚪', title: 'Departures', big: open, sub: `${open ? 'still to check out' : 'all handled'} · ${out}/${depRooms.length} out${c.late ? ` · ${c.late} late` : ''}`, tone: c.late ? 'bad' : open ? 'warn' : 'ok' });
  });

  // Arrivals
  _homeSafe(() => {
    if (typeof arrGuests === 'undefined' || !arrGuests.length) {
      add({ panel: 'arrivals', icon: '🛎️', title: 'Arrivals', big: '—', sub: 'Load today\'s Opera arrivals', tone: 'idle' });
      return;
    }
    const noEmail = arrGuests.filter(g => !g.email || !String(g.email).includes('@')).length;
    const noNat = arrGuests.filter(g => !g.nat).length;
    add({ panel: 'arrivals', icon: '🛎️', title: 'Arrivals', big: arrGuests.length, sub: `${noEmail} without email · ${noNat} without nationality`, tone: (noEmail || noNat) ? 'warn' : 'ok' });
  });

  // Purpose of Stay
  _homeSafe(() => {
    if (typeof purposeGuests === 'undefined' || !purposeGuests.length) {
      add({ panel: 'purpose', icon: '📋', title: 'Purpose of Stay', big: '—', sub: 'Sync from Arrivals to start', tone: 'idle' });
      return;
    }
    const noEmail = purposeGuests.filter(g => !g.email || !String(g.email).includes('@')).length;
    const noOrigin = purposeGuests.filter(g => !g.originOfTravel).length;
    const todo = noEmail + noOrigin;
    add({ panel: 'purpose', icon: '📋', title: 'Purpose of Stay', big: todo, sub: `${noEmail} missing email · ${noOrigin} missing origin`, tone: todo ? 'warn' : 'ok' });
  });

  // DTCM Recon
  _homeSafe(() => {
    if (typeof dtcRecon === 'undefined' || !dtcRecon) {
      add({ panel: 'dtcm', icon: '🏦', title: 'DTCM Recon', big: '—', sub: 'Not run yet', tone: 'idle' });
      return;
    }
    const n = (dtcRecon.actions || []).length;
    const done = typeof dtcDone !== 'undefined' ? [...dtcDone].length : 0;
    const me = dtcRecon.gap && dtcRecon.gap.monthEnd;
    add({ panel: 'dtcm', icon: '🏦', title: 'DTCM Recon', big: Math.max(0, n - done),
      sub: `items open of ${n}${me ? ` · month-end ${me.equal ? 'tallies' : 'does NOT tally'}` : ''}`, tone: n - done > 0 ? 'warn' : 'ok' });
  });

  // Package Audit
  _homeSafe(() => {
    if (typeof pkgResults === 'undefined' || !pkgResults.length) {
      add({ panel: 'package-audit', icon: '🎁', title: 'Package Audit', big: '—', sub: 'Not run yet', tone: 'idle' });
      return;
    }
    const live = pkgResults.filter(r => !r.pinSkip);
    const n = live.filter(r => r.verdict === 'deny' || r.verdict === 'review' || (r.verdict === 'credit' && !r.alreadyComplete)).length;
    add({ panel: 'package-audit', icon: '🎁', title: 'Package Audit', big: n, sub: n ? 'charges need action' : 'nothing to fix', tone: n ? 'warn' : 'ok' });
  });

  // Night checklist
  _homeSafe(() => {
    if (typeof CL_STEPS === 'undefined' || typeof clState === 'undefined') return;
    const active = CL_STEPS.filter(s => !clState.skipped.has(s.id));
    const done = active.filter(s => clState.done.has(s.id)).length;
    const pct = active.length ? Math.round(done / active.length * 100) : 0;
    add({ panel: 'checklist', icon: '✅', title: 'Night Checklist', big: pct + '%', sub: `${done} of ${active.length} steps`, tone: pct === 100 ? 'ok' : done ? 'warn' : 'idle', pct });
  });

  // Shift tasks
  _homeSafe(() => {
    if (typeof SHIFTS === 'undefined') return;
    const h = new Date().getHours();
    const key = h >= 23 || h < 7 ? 'night' : h < 15 ? 'morning' : 'afternoon';
    const sh = SHIFTS[key];
    if (!sh) return;
    const pct = sh.tasks.length ? Math.round(sh.done.length / sh.tasks.length * 100) : 0;
    add({ panel: 'shifts', icon: '⏰', title: 'Shift Tasks', big: `${sh.done.length}/${sh.tasks.length}`, sub: sh.label || key, tone: pct === 100 ? 'ok' : 'warn', pct });
  });

  // ALL enrollment
  _homeSafe(() => {
    if (typeof gpLog === 'undefined') return;
    const m = new Date().toISOString().slice(0, 7);
    const sent = Object.values(gpLog).filter(x => x.status === 'submitted' && String(x.date || '').startsWith(m)).length;
    add({ panel: 'pipeline', icon: '💎', title: 'ALL enrollment', big: sent, sub: 'invitations sent this month', tone: 'idle' });
  });

  return tiles;
}

function homeGreeting() {
  const h = new Date().getHours();
  const shift = h >= 23 || h < 7 ? 'Night shift' : h < 15 ? 'Morning shift' : 'Afternoon shift';
  const hi = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const name = (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) ? currentProfile.name.split(' ')[0] : '';
  return { hi: `${hi}${name ? ', ' + name : ''}`, shift };
}

function homeRender() {
  const box = document.getElementById('homeTiles');
  if (!box) return;
  const g = homeGreeting();
  const hiEl = document.getElementById('homeHi');
  if (hiEl) hiEl.textContent = g.hi;
  const sub = document.getElementById('homeSub');
  if (sub) sub.textContent = `${g.shift} · ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}`;
  const tiles = homeTiles();
  box.innerHTML = tiles.map(t => `
    <button class="home-tile ${t.tone}" onclick="showPanel('${t.panel}')">
      <div class="home-tile-top"><span class="home-ico">${(typeof hoIcon === 'function' && hoIcon(t.panel)) || t.icon}</span><span class="home-t">${escapeHtml(t.title)}</span></div>
      <div class="home-big">${escapeHtml(String(t.big))}</div>
      <div class="home-sub">${escapeHtml(t.sub)}</div>
      ${t.pct != null ? `<div class="home-bar"><div style="width:${t.pct}%"></div></div>` : ''}
    </button>`).join('');
  if (typeof brHomeStrip === 'function') brHomeStrip();
  const open = tiles.filter(t => t.tone === 'warn' || t.tone === 'bad').length;
  const b = document.getElementById('badge-home');
  if (b) b.textContent = open || '✓';
}

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(homeRender, 1200);
  setInterval(() => { if (document.getElementById('panel-home')?.classList.contains('active')) homeRender(); }, 30000);
});
