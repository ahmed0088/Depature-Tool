// ═══════════════════════════════════════════════════════════
//  global-search.js  —  Global search / command palette
//  Ctrl+K (or the 🔍 topbar icon) jumps straight to a room,
//  guest, checklist step, or shift task across every panel.
// ═══════════════════════════════════════════════════════════

// Panel → search input id, used to auto-fill and re-trigger
// that panel's own filter once we land on it.
const GS_SEARCH_INPUT = {
  departures: 'depSearch',
  arrivals:   'arrSearch',
  purpose:    'purposeSearch',
  xref:       'xrefSearch',
  tourism:    'ttSearch',
  noshow:     'nsSearch',
  guestmem:   'gmSearch',
};

const GS_PANEL_LABEL = {
  departures: 'Departures',
  arrivals:   'Arrivals',
  purpose:    'Purpose of Stay',
  xref:       'Arr vs Dep',
  tourism:    'Tourism Tax',
  noshow:     'No-Show',
  guestmem:   'Guest Memory',
  checklist:  'Night Checklist',
  shifts:     'Shift Tasks',
};

let _gsSelIdx = 0;
let _gsResults = [];

function gsOpen() {
  const modal = document.getElementById('gsModal');
  if (!modal) return;
  modal.classList.add('open');
  const input = document.getElementById('gsInput');
  if (input) { input.value = ''; setTimeout(() => input.focus(), 30); }
  gsSearch('');
}

function gsClose() {
  document.getElementById('gsModal')?.classList.remove('open');
}

// ── Build the searchable index on demand (data changes constantly,
//    so we re-scan the live arrays every keystroke rather than caching) ──
function gsBuildIndex(q) {
  const out = [];
  if (!q) return out;

  const add = (panel, room, name, extra, icon, jumpTerm) => {
    out.push({ panel, room: room || '', name: name || '', extra: extra || '', icon, jumpTerm: jumpTerm ?? (room || name) });
  };
  const hit = (...vals) => vals.some(v => (v || '').toString().toLowerCase().includes(q));

  (typeof depRooms !== 'undefined' ? depRooms : []).forEach(r => {
    if (hit(r.roomStr, r.name)) add('departures', r.roomStr, r.name, r.status, '🚪', r.roomStr);
  });
  (typeof arrGuests !== 'undefined' ? arrGuests : []).forEach(g => {
    if (hit(g.room, g.name)) add('arrivals', g.room, g.name, g.purpose, '🛎️', g.room || g.name);
  });
  (typeof purposeGuests !== 'undefined' ? purposeGuests : []).forEach(g => {
    if (hit(g.room, g.name)) add('purpose', g.room, g.name, g.nat, '🧾', g.room || g.name);
  });
  (typeof ttGuests !== 'undefined' ? ttGuests : []).forEach(g => {
    if (hit(g.room, g.name)) add('tourism', g.room, g.name, 'TD portal fix', '🏛️', g.room || g.name);
  });
  (typeof nsGuests !== 'undefined' ? nsGuests : []).forEach(g => {
    if (hit(g.nameRaw, g.confNo, g.company)) add('noshow', '', g.nameRaw, g.company, '🚫', g.nameRaw || g.confNo);
  });
  (typeof CL_STEPS !== 'undefined' ? CL_STEPS : []).forEach(s => {
    if (hit(s.name, s.hint)) add('checklist', '', s.name, 'Night checklist step', '✅', '');
  });
  if (typeof SHIFTS !== 'undefined') {
    Object.entries(SHIFTS).forEach(([key, shift]) => {
      (shift.tasks || []).forEach(t => {
        if (hit(t.name, t.hint)) add('shifts', '', t.name, shift.label, '🕐', '');
      });
    });
  }

  return out.slice(0, 30);
}

function gsSearch(val) {
  const q = (val || '').trim().toLowerCase();
  _gsResults = gsBuildIndex(q);
  _gsSelIdx = 0;
  gsRenderResults(q);
}

function gsRenderResults(q) {
  const box = document.getElementById('gsResults');
  if (!box) return;

  if (!q) {
    box.innerHTML = `<div class="gs-empty">Type a room number, guest name, checklist step, or task…</div>`;
    return;
  }
  if (!_gsResults.length) {
    box.innerHTML = `<div class="gs-empty">No matches for "${q}"</div>`;
    return;
  }

  box.innerHTML = _gsResults.map((r, i) => `
    <div class="gs-result${i === _gsSelIdx ? ' sel' : ''}" onclick="gsJump(${i})" onmouseenter="_gsSelIdx=${i};gsRenderResults('${q.replace(/'/g, "\\'")}')">
      <span class="gs-result-icon">${r.icon}</span>
      <div class="gs-result-body">
        <span class="gs-result-name">${r.room ? `<span class="gs-result-room">${r.room}</span> ` : ''}${r.name || '—'}</span>
        <span class="gs-result-extra">${r.extra || ''}</span>
      </div>
      <span class="gs-result-panel">${GS_PANEL_LABEL[r.panel] || r.panel}</span>
    </div>`).join('');
}

function gsKeyNav(e) {
  if (e.key === 'ArrowDown') { e.preventDefault(); _gsSelIdx = Math.min(_gsSelIdx + 1, _gsResults.length - 1); gsRenderResults(document.getElementById('gsInput').value.toLowerCase()); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); _gsSelIdx = Math.max(_gsSelIdx - 1, 0); gsRenderResults(document.getElementById('gsInput').value.toLowerCase()); }
  else if (e.key === 'Enter') { e.preventDefault(); if (_gsResults.length) gsJump(_gsSelIdx); }
  else if (e.key === 'Escape') { gsClose(); }
}

function gsJump(i) {
  const r = _gsResults[i];
  if (!r) return;
  gsClose();
  showPanel(r.panel);

  const inputId = GS_SEARCH_INPUT[r.panel];
  if (inputId && r.jumpTerm) {
    setTimeout(() => {
      const el = document.getElementById(inputId);
      if (!el) return;
      el.value = r.jumpTerm;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.focus();
    }, 60);
  }

  if (r.panel === 'shifts') {
    // Switch to whichever shift tab contains the matched task
    for (const [key, shift] of Object.entries(SHIFTS)) {
      if ((shift.tasks || []).some(t => t.name === r.name)) {
        switchShift(key, document.querySelector(`.shift-tab[onclick*="'${key}'"]`));
        break;
      }
    }
  }
}
