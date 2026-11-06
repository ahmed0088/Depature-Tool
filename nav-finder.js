// ═══════════════════════════════════════════════════════════
//  nav-finder.js — finding a page without hunting for it
//  On top of the side menu: 🔎 "Find a page" (type: the menu narrows as you type, words like "balance", "tax", "late",
//  "passport" find the right pages too; Enter opens the first; "/" jumps here), ⭐ your pinned pages, 🕘 the last pages you
//  opened. Each group title folds its pages away (remembered). The ☆ on a menu line pins it.
//  Phone: the More drawer's search understands the same words, and shows Pinned and Recent above the grid.
// ═══════════════════════════════════════════════════════════
(function () {
  'use strict';
  const W = window, D = document;
  const PIN_KEY = 'ho_nav_pins_v1', REC_KEY = 'ho_nav_recent_v1', FOLD_KEY = 'ho_nav_fold_v1';
  // what people call things → the pages that do them
  const WORDS = {
    home: 'start dashboard overview today shift report end of shift summary handover', departures: 'checkout check out leaving late lco extend extension balance owing ota dnd no answer due out',
    arrivals: 'checkin check in arriving coming new guests', opera: 'reader opera cloud pms link', inhouse: 'in house staying guests balance owing ota rooms occupied',
    xref: 'compare arrivals departures cross check', purpose: 'purpose of stay business leisure report email', neorcha: 'passport id documents registration police',
    wakeups: 'wake up call alarm morning', shifts: 'tasks todo shift morning afternoon night', 'ops-logs': 'front office log logbook',
    'handover-book': 'handover shift notes book', 'hk-requests': 'housekeeping hk towels requests', 'room-health': 'maintenance broken rooms health',
    checklist: 'night audit checklist steps eod end of day', audit: 'pm rooms pseudo compare', 'inhouse-tally': 'tally count in house',
    rent: 'rented rooms beds', immig: 'immigration police upload passport', nationality: 'nationality country report',
    tourism: 'tourism dirham td tax', 'td-audit': 'tourism dirham td audit tax', dtcm: 'dtcm recon reconciliation tax', 'dtcm-fill': 'dtcm fill form',
    'package-audit': 'packages upsell breakfast audit', 'skip-clean': 'skip the clean green', noshow: 'no show noshow',
    rates: 'rates prices room rates', pipeline: 'guest enrolment all loyalty email enroll', gym: 'gym fitness', guestmem: 'guest memory returning preferences',
    'guest-messages': 'messages templates whatsapp email', 'arrivals-proc': 'arrivals procedure pre arrival', reports: 'reports monthly pdf',
    trends: 'trends charts statistics', history: 'history activity log', roster: 'roster schedule rota shifts team off days', standards: 'standards brand sop quiz',
    learn: 'learn lessons training help', qr: 'qr code', adagio: 'adagio', vocab: 'words vocabulary english', settings: 'settings setup preferences theme dark mode',
  };
  const norm = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  /** does a page match what was typed (pure): every typed word is in its name or its words */
  function pageHit(id, label, q) {
    const qq = norm(q); if (!qq) return true;
    const hay = ' ' + norm(label) + ' ' + norm(id.replace(/-/g, ' ')) + ' ' + (WORDS[id] || '') + ' ';
    return qq.split(' ').every(w => hay.includes(' ' + w) || hay.includes(w));
  }
  const LS = { get: (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (_) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} } };
  const nav = () => D.querySelector('nav.sidenav');
  const items = () => [...(nav() ? nav().querySelectorAll(':scope > .nav-item') : [])];
  const idOf = el => el.dataset.panel || el.id.replace(/^nav-/, '');
  const labelOf = el => [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.nodeValue).join(' ').trim() || el.textContent.trim();
  const iconOf = el => { const i = el.querySelector('.nav-icon'); return i ? i.textContent.trim() : '•'; };
  const visible = el => el.style.display !== 'none' && getComputedStyle(el).display !== 'none';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const go = id => { if (typeof showPanel === 'function') showPanel(id); };

  function box() {
    const n = nav(); if (!n) return null;
    let b = n.querySelector(':scope > .nvf');
    if (!b) {
      b = D.createElement('div'); b.className = 'nvf';
      b.innerHTML = `<div class="nvf-top"><label class="nvf-find"><span aria-hidden="true">🔎</span><input type="search" id="nvfQ" placeholder="Find a page…" autocomplete="off" aria-label="Find a page"><kbd title="Press / to jump here">/</kbd></label><button type="button" class="nvf-arr" id="nvfArr" title="Arrange the menu your way" aria-label="Arrange the menu">✏️</button></div>
        <div class="nvf-arrbar" id="nvfArrBar" hidden><b>✏️ Arrange your menu</b><small>Drag a page, or use ↑ ↓. Pages can move to another group; ↑ ↓ on a group title moves the whole group.</small><span><button type="button" class="btn sm gold" id="nvfArrDone">✓ Done</button><button type="button" class="btn sm" id="nvfArrReset">↺ Hotel's order</button></span></div>
        <div class="nvf-quick" id="nvfQuick"></div><div class="nvf-none" id="nvfNone" hidden>No page found — <button type="button" id="nvfAll">search everything</button></div>`;
      n.insertBefore(b, n.firstChild);
      const q = b.querySelector('#nvfQ');
      q.addEventListener('input', () => filter(q.value));
      q.addEventListener('keydown', e => {
        if (e.key === 'Enter') { const f = items().find(el => visible(el) && !el.classList.contains('nvf-out')); if (f) { go(idOf(f)); q.value = ''; filter(''); q.blur(); } }
        if (e.key === 'Escape') { q.value = ''; filter(''); q.blur(); }
      });
      b.querySelector('#nvfAll').onclick = () => { const v = q.value; if (typeof gsOpen === 'function') { gsOpen(); setTimeout(() => { const g = D.querySelector('#gsInput, .gs-input input, #globalSearchInput'); if (g) { g.value = v; g.dispatchEvent(new Event('input', { bubbles: true })); } }, 60); } };
      b.addEventListener('click', e => { const c = e.target.closest('[data-nvf-go]'); if (c) go(c.dataset.nvfGo); });
      b.querySelector('#nvfArr').onclick = () => arrange(!ARR);
      b.querySelector('#nvfArrDone').onclick = () => arrange(false);
      b.querySelector('#nvfArrReset').onclick = () => { if (!confirm('Put the menu back in the hotel\'s order?')) return; try { localStorage.removeItem(MINE_KEY()); } catch (_) {} rebuild(); if (typeof showToast === 'function') showToast('Menu back in the hotel\'s order', 'ok'); };
    } else if (n.firstChild !== b) n.insertBefore(b, n.firstChild);   // the menu was rebuilt (nav-order.js): the finder stays on top
    return b;
  }
  function filter(q) {
    const n = nav(); if (!n) return;
    const on = !!norm(q); n.classList.toggle('nvf-searching', on);
    let any = 0;
    items().forEach(el => { const hit = pageHit(idOf(el), labelOf(el), q); el.classList.toggle('nvf-out', on && !hit); if (on && hit && visible(el)) any++; });
    // titles of groups with nothing left hide while searching
    n.querySelectorAll(':scope > .nvo-lbl').forEach(l => {
      let s = l.nextElementSibling, has = false;
      while (s && !s.classList.contains('nvo-lbl') && !s.classList.contains('nvo-div')) { if (s.classList.contains('nav-item') && !s.classList.contains('nvf-out') && visible(s)) { has = true; break; } s = s.nextElementSibling; }
      l.classList.toggle('nvf-out', on && !has);
    });
    const none = D.getElementById('nvfNone'); if (none) none.hidden = !on || any > 0;
  }
  // ⭐ pinned + 🕘 recent
  function quick() {
    const b = box(); if (!b) return;
    const by = new Map(items().filter(visible).map(el => [idOf(el), el]));
    const pins = LS.get(PIN_KEY, []).filter(id => by.has(id)), cur = (D.querySelector('.panel.active') || {}).id || '';
    const rec = LS.get(REC_KEY, []).filter(id => by.has(id) && !pins.includes(id) && 'panel-' + id !== cur).slice(0, 4);
    const chip = id => { const el = by.get(id); return `<button type="button" class="nvf-chip${'panel-' + id === cur ? ' on' : ''}" data-nvf-go="${esc(id)}" title="${esc(labelOf(el))}"><span>${esc(iconOf(el))}</span>${esc(labelOf(el))}</button>`; };
    const q = b.querySelector('#nvfQuick');
    q.innerHTML = (pins.length ? `<div class="nvf-row"><b>⭐ Pinned</b>${pins.map(chip).join('')}</div>` : '') + (rec.length ? `<div class="nvf-row"><b>🕘 Recent</b>${rec.map(chip).join('')}</div>` : '');
    // the ☆ on each line
    items().forEach(el => {
      let s = el.querySelector(':scope > .nvf-star');
      if (!s) { s = D.createElement('button'); s.type = 'button'; s.className = 'nvf-star'; el.appendChild(s);
        s.addEventListener('click', e => { e.stopPropagation(); togglePin(idOf(el)); }); }
      const p = pins.includes(idOf(el)); s.textContent = p ? '★' : '☆'; s.classList.toggle('on', p);
      s.title = p ? 'Unpin from the top of the menu' : 'Pin to the top of the menu'; s.setAttribute('aria-label', s.title);
    });
    mobileQuick(by, pins, rec);
  }
  function togglePin(id) {
    let p = LS.get(PIN_KEY, []); p = p.includes(id) ? p.filter(x => x !== id) : p.concat(id).slice(-8); LS.set(PIN_KEY, p);
    if (typeof showToast === 'function') showToast(p.includes(id) ? '⭐ Pinned to the top of the menu' : 'Unpinned', 'ok');
    quick();
  }
  function remember(id) { if (!id) return; LS.set(REC_KEY, [id].concat(LS.get(REC_KEY, []).filter(x => x !== id)).slice(0, 8)); }
  // folding a group (its title is the switch); the page you are on always shows
  function folds() {
    const n = nav(); if (!n) return;
    const F = LS.get(FOLD_KEY, {});
    n.querySelectorAll(':scope > .nvo-lbl').forEach(l => {
      const name = l.textContent.replace(/[▾▸]/g, '').trim(), shut = !!F[name];
      l.classList.add('nvf-fold'); l.classList.toggle('shut', shut); l.setAttribute('role', 'button'); l.tabIndex = 0;
      l.setAttribute('aria-expanded', String(!shut)); l.title = shut ? 'Show these pages' : 'Fold these pages away';
      if (!l.dataset.nvf) { l.dataset.nvf = '1';
        const tog = () => { const G = LS.get(FOLD_KEY, {}); const k = l.textContent.replace(/[▾▸]/g, '').trim(); G[k] = !G[k]; LS.set(FOLD_KEY, G); folds(); };
        l.addEventListener('click', tog); l.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tog(); } }); }
      let s = l.nextElementSibling;
      while (s && !s.classList.contains('nvo-lbl') && !s.classList.contains('nvo-div')) { if (s.classList.contains('nav-item')) s.classList.toggle('nvf-shut', shut && !s.classList.contains('active')); s = s.nextElementSibling; }
    });
  }
  // the phone: the More drawer — same words, and Pinned / Recent on top
  function mobileQuick(by, pins, rec) {
    const grid = D.querySelector('#mobMoreDrawer .mob-more-grid'); if (!grid) return;
    let m = D.getElementById('nvfMob');
    if (!m) { m = D.createElement('div'); m.id = 'nvfMob'; m.className = 'nvf-mob'; grid.parentNode.insertBefore(m, grid);
      m.addEventListener('click', e => {
        const pin = e.target.closest('[data-nvf-pin]');
        if (pin) { e.preventDefault(); togglePin(pin.dataset.nvfPin); return; }
        const c = e.target.closest('[data-nvf-go]');
        if (c) { go(c.dataset.nvfGo); if (typeof closeMobMore === 'function') closeMobMore(); }
      }); }
    const chip = id => { const el = by.get(id); return el ? `<button type="button" class="nvf-chip" data-nvf-go="${esc(id)}"><span>${esc(iconOf(el))}</span>${esc(labelOf(el))}</button>` : ''; };
    const chooser = [...by.entries()].map(([id, el]) => {
      const pinned = pins.includes(id);
      return `<button type="button" class="nvf-fav-choice${pinned ? ' on' : ''}" data-nvf-pin="${esc(id)}" aria-pressed="${pinned}" aria-label="${pinned ? 'Remove' : 'Add'} ${esc(labelOf(el))} ${pinned ? 'from' : 'to'} favorites"><span aria-hidden="true">${pinned ? '★' : '☆'}</span><span>${esc(labelOf(el))}</span></button>`;
    }).join('');
    m.innerHTML = `<details class="nvf-fav-manage"><summary>☆ Favorites <span>${pins.length} saved · tap to edit</span></summary><div class="nvf-fav-list">${chooser}</div></details>`
      + (pins.length ? `<div class="nvf-row"><b>⭐ Favorites</b>${pins.map(chip).join('')}</div>` : '')
      + (rec.length ? `<div class="nvf-row"><b>🕘 Recent</b>${rec.map(chip).join('')}</div>` : '');
  }
  function wrapMobFilter() {
    if (typeof W.mobMoreFilter !== 'function' || W.mobMoreFilter.__nvf) return;
    const f = q => {
      D.querySelectorAll('#mobMoreDrawer .mob-more-item').forEach(b => { const id = b.dataset.panel || ''; b.style.display = pageHit(id, b.textContent, q) ? '' : 'none'; });
      const m = D.getElementById('nvfMob'); if (m) m.style.display = norm(q) ? 'none' : '';
    };
    f.__nvf = true; W.mobMoreFilter = f;
  }
  // every page opened is remembered (Recent), and the menu follows
  function wrapShow() {
    if (typeof W.showPanel !== 'function' || W.showPanel.__nvf) return;
    const o = W.showPanel;
    const f = function (name) { const r = o.apply(this, arguments); try { if (D.getElementById('panel-' + name) && D.getElementById('panel-' + name).classList.contains('active')) { remember(name); setTimeout(() => { quick(); folds(); }, 0); } } catch (_) {} return r; };
    f.__nvf = true; W.showPanel = f;
  }
  // ── ✏️ Arrange the menu: your own order of pages and groups (nav-order.js lays it over the hotel's) ──
  let ARR = false, DRAG = '';
  const MINE_KEY = () => (W.hoNavOrder && W.hoNavOrder.MINE_KEY) || 'ho_nav_mine_v1';
  const layout = () => JSON.parse(JSON.stringify(((W.hoNavOrder && W.hoNavOrder.plan()) || []).map(g => ({ id: g.id, pages: g.pages.slice() }))));
  const saveLayout = L => { try { localStorage.setItem(MINE_KEY(), JSON.stringify({ groups: L })); } catch (_) {} rebuild(); };
  function rebuild() { if (W.hoNavOrder) W.hoNavOrder.rebuild(); setTimeout(() => { box(); quick(); folds(); if (ARR) decorate(); }, 30); }
  /** move a page (pure over a layout): up / down inside its group, over the edge into the next group; or before another page / to a group's top */
  function movePage(L, id, how, target) {
    const gi = L.findIndex(g => g.pages.includes(id)); if (gi < 0) return L;
    const g = L[gi], i = g.pages.indexOf(id);
    if (how === 'up') { if (i > 0) [g.pages[i - 1], g.pages[i]] = [g.pages[i], g.pages[i - 1]]; else if (gi > 0) { g.pages.splice(i, 1); L[gi - 1].pages.push(id); } }
    else if (how === 'down') { if (i < g.pages.length - 1) [g.pages[i + 1], g.pages[i]] = [g.pages[i], g.pages[i + 1]]; else if (gi < L.length - 1) { g.pages.splice(i, 1); L[gi + 1].pages.unshift(id); } }
    else if (how === 'before' && target && target !== id) { g.pages.splice(i, 1); const tg = L.find(x => x.pages.includes(target)); if (tg) tg.pages.splice(tg.pages.indexOf(target), 0, id); else g.pages.splice(i, 0, id); }
    else if (how === 'top' && target) { const tg = L.find(x => x.id === target); if (tg) { g.pages.splice(i, 1); tg.pages.unshift(id); } }
    return L;
  }
  function moveGroup(L, gid, how) { const i = L.findIndex(g => g.id === gid), j = how === 'up' ? i - 1 : i + 1; if (i < 0 || j < 0 || j >= L.length) return L; [L[i], L[j]] = [L[j], L[i]]; return L; }
  function decorate() {
    const n = nav(); if (!n) return;
    items().forEach(el => {
      el.draggable = true;
      if (!el.querySelector(':scope > .nvf-mv')) { const m = D.createElement('span'); m.className = 'nvf-mv'; m.innerHTML = '<button type="button" data-mv="up" aria-label="Move up">↑</button><button type="button" data-mv="down" aria-label="Move down">↓</button>'; el.appendChild(m); }
    });
    n.querySelectorAll(':scope > .nvo-lbl').forEach(l => { if (!l.querySelector('.nvf-mv')) { const m = D.createElement('span'); m.className = 'nvf-mv'; m.innerHTML = '<button type="button" data-gmv="up" aria-label="Move the group up">↑</button><button type="button" data-gmv="down" aria-label="Move the group down">↓</button>'; l.appendChild(m); } });
  }
  function undecorate() { const n = nav(); if (!n) return; n.querySelectorAll('.nvf-mv').forEach(x => x.remove()); items().forEach(el => { el.draggable = false; }); }
  function arrange(on) {
    ARR = !!on; const n = nav(); if (!n) return;
    n.classList.toggle('nvf-arrange', ARR); const bar = D.getElementById('nvfArrBar'); if (bar) bar.hidden = !ARR;
    const q = D.getElementById('nvfQ'); if (q) { q.value = ''; filter(''); }
    if (ARR) { const F = LS.get(FOLD_KEY, {}); if (Object.keys(F).some(k => F[k])) { LS.set(FOLD_KEY, {}); folds(); } decorate(); } else undecorate();
    if (!n.dataset.nvfArr) {
      n.dataset.nvfArr = '1';
      n.addEventListener('click', e => {
        if (!ARR) return;
        const mv = e.target.closest('[data-mv]'), gmv = e.target.closest('[data-gmv]');
        if (mv) { e.stopPropagation(); e.preventDefault(); const it = mv.closest('.nav-item'); saveLayout(movePage(layout(), idOf(it), mv.dataset.mv)); return; }
        if (gmv) { e.stopPropagation(); e.preventDefault(); const l = gmv.closest('.nvo-lbl'); saveLayout(moveGroup(layout(), l.dataset.gid, gmv.dataset.gmv)); return; }
        if (e.target.closest('.nav-item, .nvo-lbl')) { e.stopPropagation(); e.preventDefault(); }   // arranging: a tap does not open the page or fold the group
      }, true);
      n.addEventListener('dragstart', e => { if (!ARR) return; const it = e.target.closest && e.target.closest('.nav-item'); if (!it) return; DRAG = idOf(it); it.classList.add('nvf-dragging'); try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', DRAG); } catch (_) {} });
      n.addEventListener('dragend', () => { DRAG = ''; n.querySelectorAll('.nvf-dragging, .nvf-over').forEach(x => x.classList.remove('nvf-dragging', 'nvf-over')); });
      n.addEventListener('dragover', e => { if (!ARR || !DRAG) return; const t = e.target.closest && e.target.closest('.nav-item, .nvo-lbl'); if (!t) return; e.preventDefault(); n.querySelectorAll('.nvf-over').forEach(x => x !== t && x.classList.remove('nvf-over')); t.classList.add('nvf-over'); });
      n.addEventListener('drop', e => { if (!ARR || !DRAG) return; const t = e.target.closest && e.target.closest('.nav-item, .nvo-lbl'); if (!t) return; e.preventDefault();
        const L = layout(); saveLayout(t.classList.contains('nvo-lbl') ? movePage(L, DRAG, 'top', t.dataset.gid) : movePage(L, DRAG, 'before', idOf(t))); DRAG = ''; });
    }
  }
  function all() { box(); quick(); folds(); wrapShow(); wrapMobFilter(); }
  function start() {
    all();
    D.addEventListener('keydown', e => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target; if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      const q = D.getElementById('nvfQ'); if (q && q.offsetParent) { e.preventDefault(); q.focus(); }
    });
    const n = nav(); if (n && typeof MutationObserver !== 'undefined') {
      let t = 0; new MutationObserver(ms => { if (ms.some(m => m.type === 'childList')) { clearTimeout(t); t = setTimeout(() => { box(); quick(); folds(); }, 80); } }).observe(n, { childList: true });
    }
  }
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', () => setTimeout(start, 300)); else setTimeout(start, 300);
  W.hoNavFinder = { refresh: all, arrange, _pure: { pageHit, movePage, moveGroup } };
})();
