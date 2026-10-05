// ═══════════════════════════════════════════════════════════
//  nat-extra.js — countries Opera sends that the Excel sheet doesn't have
//
//  The Nationality report fills a fixed list of Excel rows. When Opera
//  reports a country with no row, its guests used to be "NOT PLACED".
//  Now each one can be fixed in one tap:
//    ➕ Add as new row — the country becomes a row at the bottom of the
//       report (remembered for this hotel); the page says which Excel row
//       numbers to type the new names into, once.
//    ↪ Put in an existing row — pick the row it belongs to (closest
//       matches first); remembered for the team like any learned spelling.
// ═══════════════════════════════════════════════════════════

const NAT_BASE_COUNT = (typeof EXCEL_COUNTRIES !== 'undefined') ? EXCEL_COUNTRIES.length : 0;   // the sheet's own rows
const NAT_FIRST_ROW = 8;                                                                      // Excel row of the first country
let natExtraRows = [];

function _natApplyExtras(list) {
  if (typeof EXCEL_COUNTRIES === 'undefined') return;
  EXCEL_COUNTRIES.length = NAT_BASE_COUNT;                       // drop old extras, keep the sheet's rows
  (list || []).forEach(n => {
    n = String(n || '').trim();
    if (!n || EXCEL_COUNTRIES.includes(n)) return;
    EXCEL_COUNTRIES.push(n);
    EXCEL_LOWER[n.toLowerCase()] = n;
    if (typeof EXCEL_LOOSE !== 'undefined' && typeof _natLoose === 'function') EXCEL_LOOSE[_natLoose(n)] = n;
  });
  natExtraRows = EXCEL_COUNTRIES.slice(NAT_BASE_COUNT);
}

function _natSaveExtras() {
  try { localStorage.setItem('nat_extra_rows_v1', JSON.stringify(natExtraRows)); } catch (_) {}
  if (typeof fbSet === 'function') fbSet('settings/natExtraRows', natExtraRows.length ? natExtraRows : null);
}

function _natRerun() {
  if (document.getElementById('natInput')?.value.trim() && typeof processNat === 'function') processNat();
}

function natAddRow(name) {
  name = String(name || '').trim();
  if (!name) return;
  if (EXCEL_COUNTRIES.includes(name)) { showToast(`${name} already has a row`, 'info'); return; }
  _natApplyExtras(natExtraRows.concat([name]));
  _natSaveExtras();
  const row = NAT_FIRST_ROW + EXCEL_COUNTRIES.length - 1;
  if (typeof logActivity === 'function') try { logActivity('nat_row_added', `${name} → Excel row ${row}`); } catch (_) {}
  _natRerun();
  showToast(`${name} added as Excel row ${row} — type it there once in your sheet`, 'ok');
}

function natRemoveRow(name) {
  const i = natExtraRows.indexOf(name);
  if (i < 0) return;
  const after = natExtraRows.slice(i + 1);
  if (!confirm(`Remove the row "${name}"?${after.length ? `\n\nThe rows under it move up one: ${after.join(', ')}. Move them up in your Excel too.` : ''}`)) return;
  _natApplyExtras(natExtraRows.filter(n => n !== name));
  _natSaveExtras();
  _natRerun();
  natRenderExtras();
}

function natMapTo(opName, excel) {
  if (!excel) return;
  if (typeof baMapCountry === 'function') { baMapCountry(opName, excel, false); return; }   // remembered for the team
  NAME_MAP[opName] = excel;
  _natRerun();
}

// ── The "Not in Excel" box, now with buttons ──────────────
function natRenderUnmatched() {
  const box = document.getElementById('natUnmatchedList');
  if (!box) return;
  const um = window._natUnmatched || [];
  if (!um.length) { natRenderExtras(); return; }
  const opts = EXCEL_COUNTRIES.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  box.innerHTML = um.map((u, i) => {
    const cand = typeof baCountryCandidates === 'function' ? baCountryCandidates(u.name).filter(c => c.s >= 0.5) : [];
    const n = u.PRS || u.APR || 0;
    return `<div class="nx-item">
      <div class="nx-hd"><span>🔴</span><div><b>"${escapeHtml(u.name)}" has no row in your Excel</b><small>${n} guest${n === 1 ? '' : 's'} · ${u.APR || 0} arrivals · ${u.RMS || 0} room nights would be left out</small></div></div>
      <div class="nx-acts">
        <button class="btn sm gold" onclick="natAddRow(${JSON.stringify(u.name).replace(/"/g, '&quot;')})">➕ Add as new row</button>
        ${cand.slice(0, 2).map(c => `<button class="btn sm" onclick="natMapTo(${JSON.stringify(u.name).replace(/"/g, '&quot;')}, ${JSON.stringify(c.c).replace(/"/g, '&quot;')})">↪ ${escapeHtml(c.c)}</button>`).join('')}
        <select class="nx-sel" onchange="natMapTo(${JSON.stringify(u.name).replace(/"/g, '&quot;')}, this.value)"><option value="">Put in another row…</option>${opts}</select>
      </div>
    </div>`;
  }).join('');
  natRenderExtras();
}

// ── The rows you added, and where they go in Excel ────────
function natRenderExtras() {
  let box = document.getElementById('natExtraBox');
  const host = document.getElementById('natUnmatchedList');
  if (!host) return;
  if (!box) { box = document.createElement('div'); box.id = 'natExtraBox'; host.insertAdjacentElement('afterend', box); }
  if (!natExtraRows.length) { box.innerHTML = ''; return; }
  const first = NAT_FIRST_ROW + NAT_BASE_COUNT;
  box.innerHTML = `<div class="nx-extra">
    <div class="nx-hd"><span>➕</span><div><b>Rows you added (${natExtraRows.length})</b><small>Your Excel needs these names under the last country, once: start at row ${first}. Then Copy works as usual.</small></div></div>
    <div class="nx-rows">${natExtraRows.map((n, i) => `<div><code>${first + i}</code><span>${escapeHtml(n)}</span><button class="nx-x" title="Remove this row" onclick="natRemoveRow(${JSON.stringify(n).replace(/"/g, '&quot;')})">✕</button></div>`).join('')}</div>
    <button class="btn sm" onclick="copyToClipboard(${JSON.stringify(natExtraRows.join('\n')).replace(/"/g, '&quot;')}, this, '📋 Copy the names for Excel')">📋 Copy the names for Excel</button>
  </div>`;
}

// ── Start: load the hotel's extra rows, hook into the report ──
(function () {
  try { _natApplyExtras(JSON.parse(localStorage.getItem('nat_extra_rows_v1') || '[]')); } catch (_) {}
  const run = () => {
    const orig = window.processNat;
    if (typeof orig === 'function' && !orig.__nx) {
      window.processNat = function () { const r = orig.apply(this, arguments); try { natRenderUnmatched(); } catch (e) { console.warn('[nat-extra]', e); } return r; };
      window.processNat.__nx = true;
    }
    setTimeout(() => {
      if (typeof fbListen === 'function') fbListen('settings/natExtraRows', v => {
        const list = Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : []);
        if (JSON.stringify(list) === JSON.stringify(natExtraRows)) return;
        _natApplyExtras(list);
        try { localStorage.setItem('nat_extra_rows_v1', JSON.stringify(natExtraRows)); } catch (_) {}
        natRenderExtras();
      });
    }, 1500);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
