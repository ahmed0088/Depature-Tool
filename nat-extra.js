// ═══════════════════════════════════════════════════════════
//  nat-extra.js — countries Opera sends that the Excel sheet doesn't have
//
//  The Nationality report fills a fixed list of Excel rows. When Opera
//  reports a country with no row, its guests used to be "NOT PLACED".
//  Now each one can be fixed in one tap:
//    ➕ Add as new row — the country gets its own row at its place in the
//       sheet (alphabetical, like the government sheet; you can move it),
//       remembered for this hotel. The page gives the exact Excel row to
//       insert, once, so Copy keeps pasting straight in.
//    ↪ Put in an existing row — pick the row it belongs to (closest
//       matches first); remembered for the team like any learned spelling.
// ═══════════════════════════════════════════════════════════

const NAT_BASE = (typeof EXCEL_COUNTRIES !== 'undefined') ? EXCEL_COUNTRIES.slice() : [];   // the sheet's own rows, in order
const NAT_BASE_COUNT = NAT_BASE.length;
const NAT_FIRST_ROW = 8;                                                                       // Excel row of the first country
// Added countries sit at their place in the government sheet (alphabetical by
// default), not at the bottom: { name, after } — after = the country above it.
let natExtraRows = [];

const _natCmp = (a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' });
/** The country a new name goes under, alphabetically ('' = very top). */
function natAlphaAfter(name, list) {
  const L = list || EXCEL_COUNTRIES;
  let after = '';
  for (const c of L) { if (c !== name && _natCmp(c, name) < 0) after = c; }
  return after;
}
const _natNorm = x => (typeof x === 'string' ? { name: x, after: null } : { name: String(x && x.name || ''), after: x && x.after != null ? String(x.after) : null });

function _natApplyExtras(list) {
  if (typeof EXCEL_COUNTRIES === 'undefined') return;
  EXCEL_COUNTRIES.length = 0;
  NAT_BASE.forEach(c => EXCEL_COUNTRIES.push(c));
  const kept = [];
  (list || []).map(_natNorm).forEach(x => {
    const n = x.name.trim();
    if (!n || EXCEL_COUNTRIES.includes(n)) return;
    const after = x.after == null ? natAlphaAfter(n) : x.after;          // older saves had no place: alphabetical
    const i = after ? EXCEL_COUNTRIES.indexOf(after) : -1;
    EXCEL_COUNTRIES.splice(after && i < 0 ? EXCEL_COUNTRIES.length : i + 1, 0, n);
    EXCEL_LOWER[n.toLowerCase()] = n;
    if (typeof EXCEL_LOOSE !== 'undefined' && typeof _natLoose === 'function') EXCEL_LOOSE[_natLoose(n)] = n;
    kept.push({ name: n, after });
  });
  natExtraRows = kept;
}
const natRowOf = name => NAT_FIRST_ROW + EXCEL_COUNTRIES.indexOf(name);

function _natSaveExtras() {
  try { localStorage.setItem('nat_extra_rows_v1', JSON.stringify(natExtraRows)); } catch (_) {}
  if (typeof fbSet === 'function') fbSet('settings/natExtraRows', natExtraRows.length ? natExtraRows : null);
}

function _natRerun() {
  if (document.getElementById('natInput')?.value.trim() && typeof processNat === 'function') processNat();
}

/** Add a country to the sheet's list, under `after` (alphabetical place when not given). */
function natAddRow(name, after) {
  name = String(name || '').trim();
  if (!name) return;
  if (EXCEL_COUNTRIES.includes(name)) { showToast(`${name} already has a row`, 'info'); return; }
  if (after == null) after = natAlphaAfter(name);
  _natApplyExtras(natExtraRows.concat([{ name, after }]));
  _natSaveExtras();
  const row = natRowOf(name), below = EXCEL_COUNTRIES[EXCEL_COUNTRIES.indexOf(name) + 1];
  if (typeof logActivity === 'function') try { logActivity('nat_row_added', `${name} → Excel row ${row} (after ${after || 'the top'})`); } catch (_) {}
  _natRerun();
  natRenderExtras();
  showToast(`${name} is row ${row}: in your Excel insert a row there${after ? ` (under ${after}` : ' (at the top'}${below ? `, above ${below})` : ')'} and type the name once`, 'ok');
}

/** Move an added country under another one. */
function natMoveRow(name, after) {
  const list = natExtraRows.map(x => x.name === name ? { name, after } : x);
  _natApplyExtras(list);
  _natSaveExtras();
  _natRerun();
  natRenderExtras();
  showToast(`${name} is now row ${natRowOf(name)}`, 'ok');
}

function natRemoveRow(name) {
  if (!natExtraRows.some(x => x.name === name)) return;
  if (!confirm(`Remove the row "${name}" (row ${natRowOf(name)})?\n\nEvery country under it moves up one row — delete that row in your Excel too.`)) return;
  _natApplyExtras(natExtraRows.filter(x => x.name !== name));
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
/** Row counts on the page follow the real number of rows. */
function natRowLabels() {
  const n = EXCEL_COUNTRIES.length, t = document.getElementById('natPrevTitle'), r = document.getElementById('natPrevRows'), b = document.getElementById('natCopyBtn');
  if (t) t.textContent = `Preview · ${n} rows`;
  if (r) r.textContent = `ROWS ${NAT_FIRST_ROW}–${NAT_FIRST_ROW + n - 1}`;
  if (b && /Copy All \d+ Rows/.test(b.textContent)) b.textContent = `Copy All ${n} Rows`;
}

function natRenderUnmatched() {
  natRowLabels();
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
        <span class="nx-place">➕ New row, under <select class="nx-sel" id="nxAfter${i}" onchange="document.getElementById('nxRow${i}').textContent=NAT_FIRST_ROW+(this.value?EXCEL_COUNTRIES.indexOf(this.value)+1:0)"><option value="">(the very top)</option>${EXCEL_COUNTRIES.map(c => `<option value="${escapeHtml(c)}" ${c === natAlphaAfter(u.name) ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}</select>
          <button class="btn sm gold" onclick="natAddRow(${JSON.stringify(u.name).replace(/"/g, '&quot;')}, document.getElementById('nxAfter${i}').value)">Add as row <b id="nxRow${i}">${NAT_FIRST_ROW + (natAlphaAfter(u.name) ? EXCEL_COUNTRIES.indexOf(natAlphaAfter(u.name)) + 1 : 0)}</b></button></span>
        ${cand.slice(0, 2).map(c => `<button class="btn sm" onclick="natMapTo(${JSON.stringify(u.name).replace(/"/g, '&quot;')}, ${JSON.stringify(c.c).replace(/"/g, '&quot;')})">↪ ${escapeHtml(c.c)}</button>`).join('')}
        <select class="nx-sel" onchange="natMapTo(${JSON.stringify(u.name).replace(/"/g, '&quot;')}, this.value)"><option value="">Put in another row…</option>${opts}</select>
      </div>
    </div>`;
  }).join('');
  natRenderExtras();
}

// ── The rows you added, and where they go in Excel ────────
function natRenderExtras() {
  natRowLabels();
  let box = document.getElementById('natExtraBox');
  const host = document.getElementById('natUnmatchedList');
  if (!host) return;
  if (!box) { box = document.createElement('div'); box.id = 'natExtraBox'; host.insertAdjacentElement('afterend', box); }
  if (!natExtraRows.length) { box.innerHTML = ''; return; }
  const rows = natExtraRows.map(x => x.name).sort((a, b) => EXCEL_COUNTRIES.indexOf(a) - EXCEL_COUNTRIES.indexOf(b));
  box.innerHTML = `<div class="nx-extra">
    <div class="nx-hd"><span>➕</span><div><b>Countries you added (${rows.length})</b><small>Each sits at its place in the sheet, like the government sheet. In your Excel, insert a row at that number and type the name, once. After that, Copy pastes straight in as usual.</small></div></div>
    <div class="nx-rows">${rows.map(n => { const i = EXCEL_COUNTRIES.indexOf(n), up = EXCEL_COUNTRIES[i - 1], dn = EXCEL_COUNTRIES[i + 1]; return `<div><code>Row ${natRowOf(n)}</code><span><b>${escapeHtml(n)}</b><small>under ${escapeHtml(up || '(top)')}${dn ? ' · above ' + escapeHtml(dn) : ''}</small></span>
      <select class="nx-sel" title="Move it" onchange="natMoveRow(${JSON.stringify(n).replace(/"/g, '&quot;')}, this.value)"><option value="__keep" selected disabled>Move…</option><option value="">to the very top</option>${EXCEL_COUNTRIES.filter(c => c !== n).map(c => `<option value="${escapeHtml(c)}">under ${escapeHtml(c)}</option>`).join('')}</select>
      <button class="nx-x" title="Remove this row" onclick="natRemoveRow(${JSON.stringify(n).replace(/"/g, '&quot;')})">✕</button></div>`; }).join('')}</div>
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
        const list = (Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : [])).map(_natNorm);
        if (JSON.stringify(list) === JSON.stringify(natExtraRows)) return;
        _natApplyExtras(list);
        try { localStorage.setItem('nat_extra_rows_v1', JSON.stringify(natExtraRows)); } catch (_) {}
        natRenderExtras();
      });
    }, 1500);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
