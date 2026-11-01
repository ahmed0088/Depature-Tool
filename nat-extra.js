// ═══════════════════════════════════════════════════════════
//  nat-extra.js — countries Opera sends that aren't in the sheet's list
//
//  The government Nationality sheet always has the same 240 rows, and the
//  report pastes straight into them, so a row is never added. When Opera
//  reports a country spelled in a way the list doesn't know, its guests
//  would be "NOT PLACED". Now each one is placed in one tap:
//    ↪ Put it in its row — the closest rows first, or pick any of the 240.
//    ? Count it as unknown nationality (e.g. "Stateless").
//  The choice is remembered for the team, so next month it is placed by
//  itself.
// ═══════════════════════════════════════════════════════════

const NAT_FIRST_ROW = 8;   // Excel row of the first country
let natAsUnknown = [];     // Opera names counted as "no nationality"

function _natRerun() {
  if (document.getElementById('natInput')?.value.trim() && typeof processNat === 'function') processNat();
}

function natMapTo(opName, excel) {
  if (!excel) return;
  if (excel === '__unknown') { natCountUnknown(opName); return; }
  if (typeof baMapCountry === 'function') { baMapCountry(opName, excel, false); return; }   // remembered for the team
  NAME_MAP[opName] = excel;
  _natRerun();
}

/** Count an Opera name as "no nationality" (goes with the unknowns). */
function natCountUnknown(opName) {
  if (!natAsUnknown.includes(opName)) natAsUnknown.push(opName);
  NAME_MAP[opName] = null;
  try { localStorage.setItem('nat_as_unknown_v1', JSON.stringify(natAsUnknown)); } catch (_) {}
  if (typeof fbSet === 'function') fbSet('settings/natAsUnknown', natAsUnknown);
  if (typeof logActivity === 'function') try { logActivity('nat_unknown', opName); } catch (_) {}
  _natRerun();
  showToast(`"${opName}" now counts as unknown nationality`, 'ok');
}
function _natApplyUnknown(list) {
  natAsUnknown = Array.isArray(list) ? list.filter(Boolean) : [];
  natAsUnknown.forEach(n => { NAME_MAP[n] = null; });
}

// ── The "Not in Excel" box, with buttons ──────────────────
function natRenderUnmatched() {
  const box = document.getElementById('natUnmatchedList');
  if (!box) return;
  const um = window._natUnmatched || [];
  if (!um.length) return;
  const opts = EXCEL_COUNTRIES.map((c, i) => `<option value="${escapeHtml(c)}">${NAT_FIRST_ROW + i} · ${escapeHtml(c)}</option>`).join('');
  const q = s => JSON.stringify(s).replace(/&/g, '&amp;').replace(/\"/g, '&quot;').replace(/</g, '&lt;');
  box.innerHTML = um.map(u => {
    const cand = typeof baCountryCandidates === 'function' ? baCountryCandidates(u.name).filter(c => c.s >= 0.45).slice(0, 3) : [];
    const n = u.PRS || u.APR || 0;
    return `<div class="nx-item">
      <div class="nx-hd"><span>🔴</span><div><b>"${escapeHtml(u.name)}" isn't in the sheet's list</b><small>${n} guest${n === 1 ? '' : 's'} · ${u.APR || 0} arrivals · ${u.RMS || 0} room nights are left out until you choose its row. Your choice is remembered.</small></div></div>
      <div class="nx-acts">
        ${cand.map(c => `<button class="btn sm gold" onclick="natMapTo(${q(u.name)}, ${q(c.c)})">↪ ${escapeHtml(c.c)} <small>row ${NAT_FIRST_ROW + EXCEL_COUNTRIES.indexOf(c.c)}</small></button>`).join('')}
        <select class="nx-sel" onchange="natMapTo(${q(u.name)}, this.value)"><option value="">Pick its row…</option>${opts}<option value="__unknown">— Count as unknown nationality</option></select>
      </div>
    </div>`;
  }).join('');
}

// ── 🌍 Nationality check: every Opera name that is not an exact match, fixed in one place ──
// Like "beds per room": NEW names need a row (the best guess already picked, ✓ to confirm), names matched by spelling
// are confirmed once, and the team's saved choices can be changed or forgotten (a wrong old choice is found fast).
const _NC_PLACEHOLDER = /^(z+|x+|-+|\?+|n\/?a|do\s*not\s*use|unknown)$/i;
function natHow(name) {
  const t = String(name || '').trim();
  if (natAsUnknown.includes(t)) return 'saved';
  if (typeof baCountryMap !== 'undefined' && Object.prototype.hasOwnProperty.call(baCountryMap, t)) return 'saved';
  if (Object.prototype.hasOwnProperty.call(NAME_MAP, t)) return 'builtin';
  if (EXCEL_LOWER[t.toLowerCase()]) return 'exact';
  if (_NC_PLACEHOLDER.test(t)) return 'placeholder';
  if (EXCEL_LOOSE[_natLoose(t)]) return 'loose';
  return 'new';
}
function natGuess(name) {
  const r = typeof resolveCountry === 'function' ? resolveCountry(name) : null;
  if (r && r.excel) return r.excel;
  if (r && r.isUnknown) return '__unknown';
  const c = typeof baCountryCandidates === 'function' ? baCountryCandidates(name) : [];
  return c[0] && c[0].s >= 0.45 ? c[0].c : '';
}
function natForget(name) {
  const t = String(name || '').trim();
  if (typeof baCountryMap !== 'undefined' && baCountryMap[t] !== undefined) {
    delete baCountryMap[t];
    try { localStorage.setItem('brain_country_map_v1', JSON.stringify(baCountryMap)); } catch (_) {}
    if (typeof fbSet === 'function') fbSet('brain/countryMap/' + t.replace(/[.#$\[\]\/]/g, '_'), null);
  }
  if (natAsUnknown.includes(t)) {
    natAsUnknown = natAsUnknown.filter(x => x !== t);
    try { localStorage.setItem('nat_as_unknown_v1', JSON.stringify(natAsUnknown)); } catch (_) {}
    if (typeof fbSet === 'function') fbSet('settings/natAsUnknown', natAsUnknown);
  }
  delete NAME_MAP[t];
  if (typeof logActivity === 'function') try { logActivity('nat_forget', t); } catch (_) {}
  _natRerun();
  showToast(`"${t}" forgotten — choose its row again`, 'ok');
}
function natRenderCheck() {
  const res = document.getElementById('natResults'); if (!res) return;
  let box = document.getElementById('natCheck');
  if (!box) { box = document.createElement('div'); box.id = 'natCheck'; box.className = 'card nc-card'; const kpi = res.querySelector('.kpi-row'); if (kpi) kpi.after(box); else res.prepend(box); }
  const raw = (window._natRaw || []).filter(u => u && u.name && (u.APR || u.RMS || u.PRS));
  const groups = { new: [], loose: [], saved: [] };
  raw.forEach(u => { const h = natHow(u.name); if (groups[h]) groups[h].push(u); });
  const total = groups.new.length + groups.loose.length + groups.saved.length;
  if (!total) { box.innerHTML = '<div class="nc-h"><b>🌍 Nationality check</b><span>✅ Every Opera nationality is an exact match for a row of the sheet.</span></div>'; return; }
  const q = s => JSON.stringify(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const opts = sel => `<option value="__unknown"${sel === '__unknown' ? ' selected' : ''}>— Unknown nationality (merged with Unknown)</option>` + EXCEL_COUNTRIES.map((c, i) => `<option value="${escapeHtml(c)}"${c === sel ? ' selected' : ''}>${NAT_FIRST_ROW + i} · ${escapeHtml(c)}</option>`).join('');
  const row = (u, kind) => {
    const cur = kind === 'saved' ? (natAsUnknown.includes(u.name) ? '__unknown' : (NAME_MAP[u.name] || '')) : natGuess(u.name), n = u.PRS || u.APR || 0;
    return `<div class="nc-row ${kind}"><div class="nc-n"><b>${escapeHtml(u.name)}${kind === 'new' ? ' <em>new</em>' : ''}</b><i>${u.APR || 0} arrivals · ${u.RMS || 0} room nights · ${n} guests</i></div>
      <span class="nc-ar" aria-hidden="true">→</span>
      <select aria-label="Sheet row for ${escapeHtml(u.name)}" onchange="natMapTo(${q(u.name)}, this.value)">${kind === 'new' && !cur ? '<option value="" selected>Choose its row…</option>' : ''}${opts(cur)}</select>
      ${kind === 'saved' ? `<button type="button" class="btn sm" title="Forget this choice" onclick="natForget(${q(u.name)})">✕</button>` : `<button type="button" class="btn sm gold" ${cur ? '' : 'disabled'} title="${cur ? 'This is right' : 'Choose a row first'}" onclick="natMapTo(${q(u.name)}, this.previousElementSibling.value)">✓</button>`}</div>`;
  };
  const sec = (k, title, sub) => groups[k].length ? `<div class="nc-sec"><h6>${title} <span>${groups[k].length}</span></h6><p>${sub}</p>${groups[k].map(u => row(u, k)).join('')}</div>` : '';
  box.innerHTML = `<div class="nc-h"><b>🌍 Nationality check</b><span>${groups.new.length ? `❓ ${groups.new.length === 1 ? '1 name needs' : groups.new.length + ' names need'} a row — their guests are left out until then.` : 'Every guest is placed. Check the guesses once; your choices are saved for the team.'}</span></div>`
    + sec('new', '🔴 New — needs a row', 'Opera spells these in a way the sheet doesn\'t know. The best guess is picked: ✓ if it is right, or choose the row.')
    + sec('loose', '🟡 Matched by spelling — check once', 'Placed by a close spelling. ✓ confirms it (then it is a saved choice).')
    + sec('saved', '🔵 Saved choices', 'Chosen before by the team. Change the row, or ✕ to forget a wrong one.');
}

// ── Start ─────────────────────────────────────────────────
(function () {
  // an earlier version could add rows beyond the 240: those are gone, the sheet never changes
  try { localStorage.removeItem('nat_extra_rows_v1'); } catch (_) {}
  try { _natApplyUnknown(JSON.parse(localStorage.getItem('nat_as_unknown_v1') || '[]')); } catch (_) {}
  const run = () => {
    const orig = window.processNat;
    if (typeof orig === 'function' && !orig.__nx) {
      window.processNat = function () { const r = orig.apply(this, arguments); try { natRenderUnmatched(); } catch (e) { console.warn('[nat-extra]', e); } try { natRenderCheck(); } catch (e) { console.warn('[nat-extra] check', e); } return r; };
      window.processNat.__nx = true;
    }
    setTimeout(() => {
      if (typeof fbSet === 'function' && typeof fbGet === 'function') fbGet('settings/natExtraRows').then(v => { if (v) fbSet('settings/natExtraRows', null); }).catch(() => {});
      if (typeof fbListen === 'function') fbListen('settings/natAsUnknown', v => {
        _natApplyUnknown(Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : []));
        try { localStorage.setItem('nat_as_unknown_v1', JSON.stringify(natAsUnknown)); } catch (_) {}
      });
    }, 1500);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
