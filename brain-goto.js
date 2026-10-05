// ═══════════════════════════════════════════════════════════
//  brain-goto.js — Ops Brain takes you to the line with the problem
//
//  Any Ops Brain link (a bubble, a suggestion, a search hit, a line of a
//  data answer) now opens the page, clears filters that would hide the
//  line, scrolls to it and highlights it. When several lines have the
//  problem, a small bar steps through them: "1 of 3  ▲ ▼".
//
//  What to show is read from what the Brain said: room numbers it named,
//  or the kind of problem ("without nationality", "owe", "late check-out",
//  "isn't in the sheet"…), which is then looked up in the page's data.
// ═══════════════════════════════════════════════════════════

let bgFocus = null;      // { rooms:[], kind:'', at }
let bgHits = [], bgIdx = 0;

function bgFrom(text) {
  const t = String(text || '');
  const lt = t.toLowerCase();
  // room numbers: 3–4 digits that are not money, nights, counts or totals
  const rooms = [];
  t.replace(/(AED\s*)?\b(\d{3,4})\b(\s*(AED|nights?|guests?|arrivals?|rooms?|steps?|%|lessons?))?/gi, (m, aed, n, after) => { if (!aed && !after) rooms.push(n); return m; });
  const kind = /month-end|tally/.test(lt) ? 'dtcmPlan'
    : /not ticked|dtcm items?/.test(lt) ? 'dtcmOpen'
    : /isn't in the sheet|no row|not placed/.test(lt) ? 'unplaced'
    : /twice|duplicate/.test(lt) ? 'dup'
    : /relay email|email.*(wrong|look)/.test(lt) ? 'badEmail'
    : /(without|no|missing) (an? )?e-?mail/.test(lt) ? 'email'
    : /(without|no|missing) nationalit|guess.*nationalit|nationality to double-check/.test(lt) ? 'nat'
    : /origin/.test(lt) ? 'origin'
    : /owe|owing|balance/.test(lt) ? 'owe'
    : /late check-?out|passed the late/.test(lt) ? 'late'
    : /checklist step/.test(lt) ? 'checklist'
    : '';
  return { rooms: [...new Set(rooms)], kind };
}
function bgSet(text) { const f = bgFrom(text); bgFocus = (f.rooms.length || f.kind) ? Object.assign(f, { at: Date.now() }) : null; }

// rooms the problem is about, from the page's own data
function _bgRoomsFor(panel, kind) {
  const G = panel === 'arrivals' ? (typeof arrGuests !== 'undefined' ? arrGuests : []) : panel === 'purpose' ? (typeof purposeGuests !== 'undefined' ? purposeGuests : []) : [];
  const D = typeof depRooms !== 'undefined' ? depRooms : [];
  const R = x => String(x.room || x.roomStr || '').trim();
  if (G.length) {
    if (kind === 'nat') return G.filter(g => !g.nat).map(R);
    if (kind === 'email') return G.filter(g => !g.email || !String(g.email).includes('@')).map(R);
    if (kind === 'origin') return G.filter(g => !g.originOfTravel).map(R);
    if (kind === 'badEmail') return G.filter(g => /@(guest\.)?(booking\.com|m\.expediapartnercentral\.com|expediapartnercentral\.com|agoda-messaging\.com|guest\.trip\.com)$/i.test(String(g.email || '')) || (g.email && /@/.test(g.email) && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(g.email).trim()))).map(R);
    if (kind === 'dup') { const seen = {}, out = []; G.forEach(g => { const k = (g.conf || '').trim() ? 'c' + g.conf : 'n' + R(g) + (g.name || ''); if (seen[k]) out.push(R(g)); seen[k] = 1; }); const nm = {}; G.forEach(g => { const n = String(g.name || '').toUpperCase(); (nm[n] = nm[n] || []).push(R(g)); }); Object.values(nm).forEach(a => { if (a.length > 1) out.push(...a); }); return out; }
  }
  if (panel === 'departures') {
    if (kind === 'owe') return D.filter(r => r.balance > 0).map(R);
    if (kind === 'late') return D.filter(r => r.status === 'late' || (typeof isLcoOverdue === 'function' && isLcoOverdue(r))).map(R);
  }
  return [];
}

function _bgClearFilters(p) {
  // a filter or search could be hiding the line: show everything
  p.querySelectorAll('.fchip').forEach(c => { if (/^\s*all\s*$/i.test(c.textContent) && !c.classList.contains('on')) c.click(); });
  ['arrSearch', 'purposeSearch', 'depSearch'].forEach(id => {
    const s = document.getElementById(id);
    if (s && p.contains(s) && s.value) { s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  if (p.id === 'panel-purpose' && typeof purposeRender === 'function') try { purposeRender(); } catch (_) {}
}

function _bgRowFor(p, room) {
  const card = p.querySelector(`[data-room="${CSS.escape(room)}"]`);
  if (card) return card;
  // a table row with an input or a cell that is exactly this room
  for (const tr of p.querySelectorAll('tbody tr')) {
    if ([...tr.querySelectorAll('input')].some(i => String(i.value).trim() === room)) return tr;
    if ([...tr.children].some(td => td.textContent.trim() === room)) return tr;
  }
  // DTCM plan items, lists, anything else that names the room
  const re = new RegExp('(^|\\D)' + room + '(\\D|$)');
  const all = [...p.querySelectorAll('details, tr, li, .bs-li, .dtc-room, [class*="item"]')].filter(e => e.offsetParent && re.test(e.textContent));
  return all.find(e => !all.some(o => o !== e && e.contains(o))) || null;
}

function bgApply(panel) {
  const f = bgFocus;
  bgFocus = null;
  if (!f || Date.now() - f.at > 5000) return;
  const p = document.getElementById('panel-' + panel);
  if (!p) return;
  const find = () => {
    let els = [];
    if (f.kind === 'unplaced') els = [...p.querySelectorAll('.nx-item')];
    else if (f.kind === 'dtcmPlan') els = [p.querySelector('#dtcFixPlan details') || p.querySelector('#dtcFixPlan')].filter(Boolean);
    else if (f.kind === 'dtcmOpen') els = [...p.querySelectorAll('#dtcSheetOut tbody tr:not(.done), #dtcFixPlan details')].slice(0, 30);
    else if (f.kind === 'checklist') els = [...p.querySelectorAll('.cl-step:not(.done), .cl-item:not(.done)')].slice(0, 1);
    const rooms = f.rooms.length ? f.rooms : _bgRoomsFor(panel, f.kind);
    rooms.forEach(r => { const e = _bgRowFor(p, r); if (e && !els.includes(e)) els.push(e); });
    return els.filter(e => e && (e.offsetParent || e.getClientRects().length));
  };
  let els = find();
  if (!els.length && (f.rooms.length || f.kind)) { _bgClearFilters(p); els = find(); }
  if (!els.length && f.rooms.length === 1) {
    // last resort for the departures board: search the room (search shows every status)
    const s = document.getElementById('depSearch');
    if (panel === 'departures' && s) { s.value = f.rooms[0]; s.dispatchEvent(new Event('input', { bubbles: true })); els = find(); }
  }
  bgShow(els);
}

function bgShow(els) {
  document.querySelectorAll('.bg-glow').forEach(e => e.classList.remove('bg-glow', 'bg-cur'));
  document.getElementById('bgNav')?.remove();
  bgHits = els; bgIdx = 0;
  if (!els.length) return;
  els.forEach(e => { e.classList.add('bg-glow'); if (e.tagName === 'DETAILS') e.open = true; });
  bgStep(0);
  if (els.length > 1) {
    const n = document.createElement('div');
    n.id = 'bgNav';
    n.className = 'bg-nav';
    n.innerHTML = `<span id="bgNavTxt"></span><button title="Previous" onclick="bgStep(-1)">▲</button><button title="Next" onclick="bgStep(1)">▼</button><button title="Done" onclick="bgDone()">✕</button>`;
    document.body.appendChild(n);
    _bgNavTxt();
  }
  clearTimeout(bgShow._t);
  bgShow._t = setTimeout(bgDone, 60000);
}
function _bgNavTxt() { const t = document.getElementById('bgNavTxt'); if (t) t.textContent = `${bgIdx + 1} of ${bgHits.length}`; }
function bgStep(d) {
  if (!bgHits.length) return;
  bgIdx = (bgIdx + d + bgHits.length) % bgHits.length;
  bgHits.forEach(e => e.classList.remove('bg-cur'));
  const e = bgHits[bgIdx];
  e.classList.add('bg-cur');
  e.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const inp = e.querySelector && [...e.querySelectorAll('input')].find(i => !i.value && i.type !== 'checkbox');
  if (inp && bgHits.length && document.activeElement !== inp) setTimeout(() => { try { inp.focus({ preventScroll: true }); } catch (_) {} }, 500);
  _bgNavTxt();
}
function bgDone() {
  document.querySelectorAll('.bg-glow').forEach(e => e.classList.remove('bg-glow', 'bg-cur'));
  document.getElementById('bgNav')?.remove();
  bgHits = [];
}

// ── Listen to every Ops Brain link ────────────────────────
document.addEventListener('click', e => {
  const src = e.target.closest('#blBubble, .br-sug, .br-hit, .bs-li, .home-brain .br-sug');
  if (!src) return;
  if (src.classList.contains('bs-li')) {
    // a line of a data answer: go to that guest's line on its page
    const card = src.closest('.br-card');
    const open = card && card.querySelector('[onclick*="showPanel("]');
    const page = open && (open.getAttribute('onclick').match(/showPanel\('([^']+)'\)/) || [])[1];
    const room = (src.querySelector('b') || {}).textContent;
    if (page && room) { bgFocus = { rooms: [String(room).trim()], kind: '', at: Date.now() }; if (typeof brClose === 'function') brClose(); showPanel(page); }
    return;
  }
  // in a bubble only the buttons that go somewhere ("Show me", "Open …") jump
  if (src.id === 'blBubble') { const b = e.target.closest('button'); if (!b || !/show|open/i.test(b.textContent)) return; }
  bgSet(src.textContent);
}, true);

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    const sp = window.showPanel;
    if (typeof sp === 'function' && !sp.__bg) {
      window.showPanel = function (name) {
        const out = sp.apply(this, arguments);
        if (bgFocus) setTimeout(() => bgApply(name), 420);
        else bgDone();
        return out;
      };
      window.showPanel.__bg = true;
    }
  }, 2500);
});
