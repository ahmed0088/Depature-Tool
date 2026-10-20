// ═══════════════════════════════════════════════════════════
//  nav-order.js  —  the side menu, in clear groups
//
//  Pages are sorted by what you are doing: the front desk, the night
//  audit, money and tax checks, guests and sales, the team, small tools.
//  Pages that add themselves later (Front Office Log, Skip The Clean, QR…)
//  are put in their group as soon as they appear. A group whose pages
//  are all hidden for your role hides its title too.
// ═══════════════════════════════════════════════════════════
(function () {
'use strict';

const GROUPS = [
  ['Front Desk',     ['home', 'departures', 'arrivals', 'xref', 'purpose', 'wakeups', 'shifts', 'ops-logs', 'handover-book', 'hk-requests']],
  ['Night Audit',    ['checklist', 'audit', 'inhouse-tally', 'rent', 'immig', 'nationality']],
  ['Money & Tax',    ['tourism', 'td-audit', 'dtcm', 'package-audit', 'skip-clean', 'noshow']],
  ['Guests & Sales', ['rates', 'pipeline', 'guestmem', 'arrivals-proc', 'trends', 'history']],
  ['Team',           ['roster', 'standards', 'learn']],
  ['Tools',          ['qr', 'adagio']],
  ['System',         ['settings']],
];
const TOOLS = 'Tools';

let busy = false;

function order() {
  const nav = document.querySelector('nav.sidenav');
  if (!nav || busy) return;
  busy = true;
  try {
    // old titles and lines go; ours are rebuilt each time
    nav.querySelectorAll(':scope > .nav-section-label:not(.nvo-lbl), :scope > .nav-divider:not(.nvo-div)').forEach(el => el.remove());
    nav.querySelectorAll(':scope > .nvo-lbl, :scope > .nvo-div').forEach(el => el.remove());

    const items = [...nav.querySelectorAll(':scope > .nav-item')];
    const byPanel = new Map(items.map(el => [el.dataset.panel || el.id.replace(/^nav-/, ''), el]));
    const placed = new Set();
    const frag = document.createDocumentFragment();

    GROUPS.forEach(([name, panels], gi) => {
      const list = panels.map(p => byPanel.get(p)).filter(Boolean);
      if (name === TOOLS) items.forEach(el => { if (!placed.has(el) && !GROUPS.some(([, ps]) => ps.includes(el.dataset.panel))) list.push(el); });
      if (!list.length) return;
      if (gi) { const d = document.createElement('div'); d.className = 'nav-divider nvo-div'; frag.appendChild(d); }
      const l = document.createElement('div'); l.className = 'nav-section-label nvo-lbl'; l.textContent = name; frag.appendChild(l);
      list.forEach(el => { placed.add(el); frag.appendChild(el); });
    });
    nav.insertBefore(frag, nav.firstChild);
    labels(nav);
  } finally { busy = false; }
}

// a title (and the line above it) hides when none of its pages are shown
function labels(nav) {
  nav.querySelectorAll(':scope > .nvo-lbl').forEach(l => {
    let n = l.nextElementSibling, any = false;
    while (n && !n.classList.contains('nvo-div') && !n.classList.contains('nvo-lbl')) {
      if (n.classList.contains('nav-item') && n.style.display !== 'none' && getComputedStyle(n).display !== 'none') { any = true; break; }
      n = n.nextElementSibling;
    }
    l.style.display = any ? '' : 'none';
    const d = l.previousElementSibling;
    if (d && d.classList.contains('nvo-div')) d.style.display = any ? '' : 'none';
  });
}

let t = 0, obs = null;
function soon() { clearTimeout(t); t = setTimeout(run, 60); }
// our own moves and label changes are not news: drop those records
function run() { order(); if (obs) obs.takeRecords(); try { window.dispatchEvent(new Event('resize')); } catch (_) {} }   // resize: the sliding marker finds the active page again
function relabel(nav) { labels(nav); if (obs) obs.takeRecords(); }

function start() {
  run();
  const nav = document.querySelector('nav.sidenav');
  if (!nav || typeof MutationObserver === 'undefined') return;
  obs = new MutationObserver(muts => {
    if (muts.some(m => m.type === 'childList' && m.target === nav && [...m.addedNodes].some(n => n.nodeType === 1 && n.classList.contains('nav-item')))) soon();
    else relabel(nav);
  });
  obs.observe(nav, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
  setTimeout(run, 1500); setTimeout(run, 4500);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
window.hoNavOrder = order;
window.hoNavGroups = GROUPS;   // Team → Roles & access lists pages in these groups
})();
