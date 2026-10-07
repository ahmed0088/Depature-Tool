// ═══════════════════════════════════════════════════════════
//  smart-fill.js — suggestions while you type, everywhere
//  Any text box in the app gets a list of likely answers under it, from
//  what the app already knows: countries for a nationality, the usual
//  booking sources, "@gmail.com" and friends after an @, today's rooms and
//  guests in a search box, the team in a name box, the roster's own shifts
//  and codes in a roster cell. Uses the browser's own suggestion list
//  (works on phones), so it never gets in the way of typing.
//  Also: "1245" becomes "12:45" in a time box, and a "FULL NAME IN CAPS"
//  box writes in capitals by itself.
//  Nothing typed is stored: guest details stay where they already are.
// ═══════════════════════════════════════════════════════════

const SF_SOURCES = ['Booking.com', 'Expedia', 'Agoda', 'Trip.com', 'Hotelbeds', 'Accor.com', 'ALL App', 'Walk in', 'Direct', 'Phone', 'Email', 'Corporate', 'Travel agent', 'Airline crew', 'Group'];
const SF_DOMAINS = ['gmail.com', 'hotmail.com', 'yahoo.com', 'outlook.com', 'icloud.com', 'live.com', 'msn.com', 'aol.com', 'mail.ru', 'yandex.ru', 'qq.com', '163.com', 'proton.me'];

const _sfArr = v => (Array.isArray(v) ? v : []);
const _sfUniq = list => { const seen = new Set(), out = []; list.forEach(x => { const s = String(x == null ? '' : x).trim(); const k = s.toLowerCase(); if (s && !seen.has(k)) { seen.add(k); out.push(s); } }); return out; };

/** Rooms and guest names a search box in this page can look for. */
function _sfGuests(which) {
  const dep = typeof depRooms !== 'undefined' ? _sfArr(depRooms) : [];
  const arr = typeof arrGuests !== 'undefined' ? _sfArr(arrGuests) : [];
  const pur = typeof purposeGuests !== 'undefined' ? _sfArr(purposeGuests) : [];
  const lists = which === 'dep' ? [dep] : which === 'arr' ? [arr] : which === 'purpose' ? [pur] : [dep, arr, pur];
  const rooms = [], names = [];
  lists.forEach(l => l.forEach(g => { if (!g) return; rooms.push(g.roomStr || g.room); names.push(g.name); }));
  return _sfUniq([...rooms.sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true })), ...names]).slice(0, 400);
}
function _sfStaff() {
  const out = [];
  if (typeof roStaff !== 'undefined') Object.keys(roStaff).forEach(k => { const p = roStaff[k]; if (p && p.name && !(typeof rbPeople !== 'undefined' && (rbPeople[k] || {}).deleted)) out.push(p.name); });
  return _sfUniq(out.sort());
}
/** What roster cells usually hold: the codes (OFF, SL, AL…) and the hours used most. */
function _sfRosterValues() {
  const cnt = {};
  if (typeof roDays !== 'undefined') Object.values(roDays || {}).forEach(day => Object.values(day || {}).forEach(v => { const s = String(v || '').replace(/\s*-\s*[A-Za-z].*$/, '').trim(); if (/^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/.test(s)) cnt[s] = (cnt[s] || 0) + 1; }));
  const hours = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]).slice(0, 20);
  const codes = typeof roAllCodes === 'function' ? Object.keys(roAllCodes()) : ['OFF'];
  return _sfUniq([...hours, ...codes]);
}
function _sfSourcesSeen() {
  const seen = [];
  try { _sfArr(arrGuests).forEach(g => g && seen.push(g.source)); } catch (_) {}
  try { _sfArr(purposeGuests).forEach(g => g && seen.push(g.source)); } catch (_) {}
  return _sfUniq([...seen, ...SF_SOURCES]);
}
function _sfCountries() { return typeof EXCEL_COUNTRIES !== 'undefined' ? EXCEL_COUNTRIES : []; }

/** What kind of answer a box wants, from its id, placeholder and what it saves to. */
function sfKind(el) {
  const id = el.id || '', ph = (el.getAttribute('placeholder') || '').toLowerCase(), on = (el.getAttribute('oninput') || '') + (el.getAttribute('onchange') || '') + (el.getAttribute('onblur') || '');
  if (el.type === 'email' || /\.email\s*=|'email'/.test(on) || /email/i.test(id)) return 'email';
  if (/\.nat\s*=|'nat'|originOfTravel/.test(on) || /(^|-)nat$|nationality/i.test(id) || /^e\.g\. india$/.test(ph) || ph.includes('nationality')) return 'country';
  if (/\.source\s*=/.test(on) || /(^|-)source$/i.test(id) || ph.includes('booking.com')) return 'source';
  if (/^(fb|es|et|mg)-name$/.test(id) && id !== 'mg-name') return 'staff';
  if (/^(roNewName|rbStaffName)$/.test(id)) return 'staff';
  if (el.closest && (el.closest('#roPreview td.ro-cell') || el.closest('.ro-table td') || /roSetCell|roPrevSet/.test(on))) return 'roster';
  if (id === 'depSearch') return 'search-dep';
  if (/^(arrSearch|xrefSearch)$/.test(id)) return 'search-arr';
  if (id === 'purposeSearch') return 'search-purpose';
  if (/^(ttSearch|itSearch|tdaSearch|immigSearch2|nsSearch|adg-search)$/.test(id)) return 'search-all';
  if (id === 'mg-room') return 'room';
  return '';
}
const SF_LISTS = {
  country: () => _sfCountries(),
  source: () => _sfSourcesSeen(),
  staff: () => _sfStaff(),
  roster: () => _sfRosterValues(),
  'search-dep': () => _sfGuests('dep'),
  'search-arr': () => _sfGuests('arr'),
  'search-purpose': () => _sfGuests('purpose'),
  'search-all': () => _sfGuests('all'),
  room: () => _sfGuests('all').filter(x => /^\d/.test(x)),
  email: el => {
    const v = String(el.value || ''), at = v.indexOf('@');
    if (at < 1) return [];
    const local = v.slice(0, at), dom = v.slice(at + 1).toLowerCase();
    return SF_DOMAINS.filter(d => d.startsWith(dom) && d !== dom).map(d => `${local}@${d}`);
  },
};

function _sfFill(el, kind) {
  const id = 'sfList-' + kind;
  let dl = document.getElementById(id);
  if (!dl) { dl = document.createElement('datalist'); dl.id = id; document.body.appendChild(dl); }
  const opts = SF_LISTS[kind](el) || [];
  const html = opts.map(o => `<option value="${escapeHtml(o)}"></option>`).join('');
  if (dl._html !== html) { dl.innerHTML = html; dl._html = html; }
  if (el.getAttribute('list') !== id) el.setAttribute('list', id);
}

(function () {
  const skip = el => !(el instanceof HTMLInputElement) || el.id === 'brQ' || el.readOnly || el.disabled
    || /^(password|file|checkbox|radio|range|color|date|time|datetime-local|month|week|number|hidden|submit|button)$/i.test(el.type)
    || (el.getAttribute('list') && !/^sfList-/.test(el.getAttribute('list')));
  document.addEventListener('focusin', e => {
    const el = e.target; if (skip(el)) return;
    const kind = sfKind(el); if (!kind) return;
    try { _sfFill(el, kind); } catch (_) {}
    if (kind === 'room' && !el.inputMode) el.inputMode = 'numeric';
    if (kind === 'email') { el.autocapitalize = 'off'; el.spellcheck = false; }
  }, true);
  document.addEventListener('input', e => {
    const el = e.target; if (!(el instanceof HTMLInputElement)) return;
    // an email box: offer the full address as soon as "@" is typed
    if (el.getAttribute('list') === 'sfList-email') try { _sfFill(el, 'email'); } catch (_) {}
    // a box that wants the full name in capitals
    if (/in caps/i.test(el.getAttribute('placeholder') || '') && el.value !== el.value.toUpperCase()) {
      const p = el.selectionStart; el.value = el.value.toUpperCase(); try { el.setSelectionRange(p, p); } catch (_) {}
    }
  });
  // a time typed without the colon: "1245" → "12:45", "930" → "09:30"
  document.addEventListener('focusout', e => {
    const el = e.target; if (!(el instanceof HTMLInputElement) || el.type !== 'text' && el.type !== '') return;
    const ph = el.getAttribute('placeholder') || '';
    if (!/\b\d{1,2}:\d{2}\b/.test(ph) || /\s-\s|–/.test(ph)) return;
    const m = el.value.trim().match(/^(\d{1,2})[.:h ]?(\d{2})$/);
    if (!m || +m[1] > 23 || +m[2] > 59) return;
    const v = `${m[1].padStart(2, '0')}:${m[2]}`;
    if (v !== el.value) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
  }, true);
})();
