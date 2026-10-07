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

// ── Start ─────────────────────────────────────────────────
(function () {
  // an earlier version could add rows beyond the 240: those are gone, the sheet never changes
  try { localStorage.removeItem('nat_extra_rows_v1'); } catch (_) {}
  try { _natApplyUnknown(JSON.parse(localStorage.getItem('nat_as_unknown_v1') || '[]')); } catch (_) {}
  const run = () => {
    const orig = window.processNat;
    if (typeof orig === 'function' && !orig.__nx) {
      window.processNat = function () { const r = orig.apply(this, arguments); try { natRenderUnmatched(); } catch (e) { console.warn('[nat-extra]', e); } return r; };
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
