// ═══════════════════════════════════════════════════════════
//  rates.js — 💲 Rate Shop: our rates next to the hotels around us
//  For each of our hotels: a list of hotels nearby (the comp set) and
//  a price per night for each date. Prices come from:
//    • ✨ Check online — the AI searches the web (needs the AI key from
//      Roster → AI settings), marked "online" so you can check it
//    • one-tap links to Booking.com, Google and Google Maps
//    • typed in by hand
//  It shows the difference from the market (median of the hotels
//  around), where we rank, a chart for the next 14 days and the table.
//  Firebase: rates/setup  (hotels, comp sets)
//            rates/prices/{date}/{hotel}/{who} = { r, src, at, by }
// ═══════════════════════════════════════════════════════════

let rkSetup = {}, rkPrices = {}, rkHotel = null, rkFrom = null, rkSel = null, rkBusy = false;
const RK_DAYS = 14;

function _rkId(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'h'; }
function _rkQ(s) { return escapeHtml(JSON.stringify(String(s))); }
function rkToday() { return typeof roToday === 'function' ? roToday() : new Date().toISOString().slice(0, 10); }
function rkAdd(d, n) { return typeof roAdd === 'function' ? roAdd(d, n) : new Date(new Date(d + 'T12:00:00').getTime() + n * 864e5).toISOString().slice(0, 10); }
function rkDates() { const f = rkFrom || rkToday(); return Array.from({ length: RK_DAYS }, (_, i) => rkAdd(f, i)); }
function rkDay(d, long) { const x = new Date(d + 'T12:00:00'); return x.toLocaleDateString('en-GB', long ? { weekday: 'short', day: 'numeric', month: 'short' } : { weekday: 'short', day: 'numeric' }); }

/** Our hotels: the ones set up here, else the hotels on the roster. */
function rkHotels() {
  const set = (rkSetup.hotels || {});
  const ids = Object.keys(set);
  if (ids.length) return ids.map(id => Object.assign({ id }, set[id]));
  return RK_OURS.map(n => ({ id: _rkId(n), name: n, search: n, comps: [] }));
}
const RK_OURS = ['Ibis Styles Dubai Deira', 'Mercure Dubai Deira', 'Adagio Dubai Deira'];   // ours to start with: add, rename or remove any
function rkCur() { const H = rkHotels(); return H.find(h => h.id === rkHotel) || H[0] || null; }
function rkPrice(d, hid, who) { const p = (((rkPrices[d] || {})[hid] || {})[who]); return p && p.r > 0 ? p : null; }
function rkSaveHotel(h) {
  if (!Object.keys(rkSetup.hotels || {}).length) {   // the starting three become a saved list the first time anything changes
    const all = {}; rkHotels().forEach(x => { all[x.id] = { name: x.name, search: x.search || x.name, comps: [] }; });
    rkSetup.hotels = all; fbSet('rates/setup/hotels', all);
  }
  const clean = { name: h.name, search: h.search || '', comps: (h.comps || []).map(c => ({ id: c.id, name: c.name })) };
  rkSetup.hotels = Object.assign({}, rkSetup.hotels, { [h.id]: clean });
  fbSet('rates/setup/hotels/' + h.id, clean);
}

/** The market on a date: every nearby price, its median, lowest, highest; our place among them (1 = cheapest). */
function rkMarket(h, d) {
  const comps = (h.comps || []).map(c => ({ c, p: rkPrice(d, h.id, c.id) })).filter(x => x.p);
  const vals = comps.map(x => x.p.r).sort((a, b) => a - b);
  const us = rkPrice(d, h.id, 'us');
  if (!vals.length) return { n: 0, us };
  const med = vals.length % 2 ? vals[vals.length >> 1] : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2;
  const out = { n: vals.length, med, min: vals[0], max: vals[vals.length - 1], us, comps };
  if (us) { out.diff = (us.r - med) / med; out.rank = vals.filter(v => v < us.r).length + 1; out.of = vals.length + 1; }
  return out;
}

// ── Screen ────────────────────────────────────────────────
function rkRender() {
  const root = document.getElementById('rkRoot'); if (!root) return;
  const H = rkHotels(), h = rkCur();
  if (!h) { root.innerHTML = `<div class="rk"><div class="rk-empty"><div class="rk-empty-ico">🏨</div><b>Add your hotel first</b><p>Its name as guests search for it.</p><div class="rk-addrow"><input id="rkNewH" placeholder="e.g. Ibis Styles Dubai Deira"><button class="btn gold" onclick="rkAddHotel()">＋ Add</button></div></div></div>`; return; }
  const dates = rkDates(); if (!rkSel || !dates.includes(rkSel)) rkSel = dates[0];
  if (rkHotel === '*' && H.length > 1) { root.innerHTML = `<div class="rk">${rkTopHtml(H, '*')}${rkAllHtml(H, dates)}</div>`; return; }
  rkHotel = h.id;
  const M = rkMarket(h, rkSel), cfg = typeof riCfg === 'function' ? riCfg() : {};
  const fmt = v => v == null ? '—' : Math.round(v).toLocaleString('en-GB');
  const pct = v => (v > 0 ? '+' : '') + Math.round(v * 100) + '%';
  const tone = M.diff == null ? 'none' : Math.abs(M.diff) <= 0.05 ? 'ok' : M.diff > 0 ? 'up' : 'down';
  const ord = n => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');
  const kpi = (label, val, unit, sub, cls) => `<div class="rk-kpi ${cls || ''}"><span class="rk-kl">${label}</span><span class="rk-kv">${val}${unit ? `<i>${unit}</i>` : ''}</span><span class="rk-ks">${sub}</span></div>`;
  const comps = (h.comps || []).length;
  root.innerHTML = `<div class="rk">
    ${rkTopHtml(H, h.id, h)}
    <div class="rk-kpis">
      ${kpi(`Our rate · ${escapeHtml(rkDay(rkSel, true))}`, M.us ? fmt(M.us.r) : '—', 'AED', M.us ? (M.us.src === 'online' ? '🌐 Found online' : '✍️ Typed in') : 'Not entered yet')}
      ${kpi('Market median', fmt(M.med), M.n ? 'AED' : '', M.n ? `${fmt(M.min)} – ${fmt(M.max)} · ${M.n} hotel${M.n === 1 ? '' : 's'}` : 'No prices around us yet')}
      ${kpi('Vs the market', M.diff == null ? '—' : pct(M.diff), '', M.diff == null ? 'Needs our rate and the market' : tone === 'ok' ? '● In line with the market' : tone === 'up' ? '▲ Above the market' : '▼ Below the market', 'rk-t-' + tone)}
      ${kpi('Our place', M.rank ? ord(M.rank) : '—', M.rank ? 'of ' + M.of : '', M.rank ? (M.rank === 1 ? 'The cheapest around' : M.rank === M.of ? 'The most expensive around' : '1 = the cheapest') : '1 = the cheapest')}
    </div>
    ${rkAdviceHtml(h, dates)}
    <section class="rk-panel">
      <header class="rk-ph"><div><h3>Next ${RK_DAYS} days</h3><p>Our rate against the hotels around us, AED a night. Tap a day to choose it.</p></div></header>
      ${rkChartHtml(h, dates)}
    </section>
    <section class="rk-panel">
      <header class="rk-ph"><div><h3>Prices</h3><p>1 night, 2 adults, the cheapest public room. Tap a price to type it.</p></div>
        <div class="rk-tools">
          <button class="btn sm gold" onclick="rkCheckOnline()"${rkBusy ? ' disabled' : ''}>${rkBusy ? '<span class="ri-spin"></span> Checking…' : `✨ Check ${escapeHtml(rkDay(rkSel))}`}</button>
          <button class="btn sm" onclick="rkCheckOnline(7)"${rkBusy ? ' disabled' : ''}>✨ Next 7 days</button>
          <details class="rk-more"><summary class="btn sm ghost" title="More">＋ Hotels around</summary><div class="rk-pop">
            <button onclick="this.closest('details').open=false;rkFindNearby()">✨ Find hotels around us</button>
            <button onclick="this.closest('details').open=false;rkAddCompDlg()">✍️ Add one by name</button>
            <a target="_blank" rel="noopener" href="https://www.google.com/maps/search/${encodeURIComponent('hotels near ' + (h.search || h.name))}">🗺 See them on Google Maps</a>
          </div></details>
        </div>
      </header>
      ${!cfg.key ? `<div class="rk-note">To look up the prices by itself, the app needs the AI key once on this device (the same one that reads roster pictures).${typeof riSetupOpen === 'function' ? ' <button class="btn sm" onclick="riSetupOpen()">✨ Set it up</button>' : ''} Until then, tap B (Booking.com) or G (Google) next to a hotel and type the price.</div>` : ''}
      ${rkTableHtml(h, dates)}
      ${comps ? '' : `<div class="rk-empty in"><div class="rk-empty-ico">📍</div><b>Add the hotels around ${escapeHtml(h.name)}</b><p>The hotels guests compare you with. Pick from a list found online, or add them by name.</p><div class="rk-addrow"><button class="btn gold" onclick="rkFindNearby()"${rkBusy ? ' disabled' : ''}>✨ Find hotels around us</button><button class="btn" onclick="rkAddCompDlg()">✍️ Add by name</button></div></div>`}
      <div class="rk-foot">🌐 = found online by the AI: check the important ones on the link · the market is the median of the hotels around us</div>
    </section>
  </div>`;
}
function rkTopHtml(H, cur, h) {
  return `<div class="rk-bar">
      <div class="rk-seg">${H.length > 1 ? `<button class="${cur === '*' ? 'on' : ''}" onclick="rkHotel='*';rkRender()">All our hotels</button>` : ''}${H.map(x => `<button class="${x.id === cur ? 'on' : ''}" onclick="rkHotel='${x.id}';rkRender()">${escapeHtml(x.name)}</button>`).join('')}</div>
      <div class="rk-bar-r">
        <details class="rk-more"><summary class="rk-icon" title="Our hotels">⋯</summary><div class="rk-pop right">
          <button onclick="this.closest('details').open=false;rkAddHotelDlg()">＋ Add one of our hotels</button>
          ${h ? `<button onclick="this.closest('details').open=false;rkRenameHotel()">✏️ Rename ${escapeHtml(h.name)}</button><button class="danger" onclick="this.closest('details').open=false;rkDelHotel()">🗑 Remove ${escapeHtml(h.name)}</button>` : ''}
        </div></details>
        <div class="rk-dates"><button class="rk-icon" onclick="rkShift(-7)" title="7 days back">‹</button><input type="date" value="${rkDates()[0]}" onchange="rkFrom=this.value||null;rkRender()" aria-label="From"><button class="rk-icon" onclick="rkShift(7)" title="7 days on">›</button></div>
      </div>
    </div>`;
}
function rkShift(n) { rkFrom = rkAdd(rkDates()[0], n); if (rkFrom < rkAdd(rkToday(), -60)) rkFrom = rkAdd(rkToday(), -60); rkRender(); }

function rkAdviceHtml(h, dates) {
  const rows = dates.map(d => ({ d, M: rkMarket(h, d) })).filter(x => x.M.diff != null);
  if (!rows.length) return '';
  const hi = rows.filter(x => x.M.diff > 0.15).sort((a, b) => b.M.diff - a.M.diff), lo = rows.filter(x => x.M.diff < -0.15).sort((a, b) => a.M.diff - b.M.diff);
  const list = (L, t) => L.slice(0, 3).map(x => `${rkDay(x.d)} (${t > 0 ? '+' : ''}${Math.round(x.M.diff * 100)}%)`).join(', ');
  const items = [];
  if (hi.length) items.push(`<div class="rk-adv up">▲ <b>Well above the market</b> on ${escapeHtml(list(hi, 1))}${hi.length > 3 ? ` and ${hi.length - 3} more` : ''}: check if we're losing bookings those days.</div>`);
  if (lo.length) items.push(`<div class="rk-adv down">▼ <b>Well below the market</b> on ${escapeHtml(list(lo, -1))}${lo.length > 3 ? ` and ${lo.length - 3} more` : ''}: there may be room to go up.</div>`);
  if (!items.length) items.push(`<div class="rk-adv ok">● Within 15% of the market on every day with prices.</div>`);
  return `<div class="rk-advs">${items.join('')}</div>`;
}

/** Line chart: our rate and the market median, the market's lowest–highest as a band. One axis (AED). */
function rkChartHtml(h, dates) {
  const pts = dates.map(d => ({ d, M: rkMarket(h, d) }));
  const vals = []; pts.forEach(p => { if (p.M.us) vals.push(p.M.us.r); if (p.M.n) vals.push(p.M.min, p.M.max); });
  if (!vals.length) return '<div class="rk-chart-empty"><span>📈</span>No prices yet for these days. ✨ Check online, or type them in the table below.</div>';
  const box = document.getElementById('rkRoot'), W = Math.max(300, Math.min(1200, ((box && box.clientWidth) || 720) - 34)), H = W < 500 ? 200 : 240, L = 40, R = 12, T = 14, B = 28, lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = Math.max(10, (hi - lo) * 0.12), y0 = Math.max(0, Math.floor((lo - pad) / 10) * 10), y1 = Math.ceil((hi + pad) / 10) * 10;
  const x = i => L + (W - L - R) * (dates.length === 1 ? 0.5 : i / (dates.length - 1)), y = v => T + (H - T - B) * (1 - (v - y0) / ((y1 - y0) || 1));
  const ticks = Array.from({ length: 4 }, (_, i) => y0 + (y1 - y0) * i / 3);
  const seg = get => { let out = '', open = false; pts.forEach((p, i) => { const v = get(p); if (v == null) { open = false; return; } out += `${open ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `; open = true; }); return out; };
  // the band: one closed shape per run of days that have market prices
  let band = ''; { let run = []; const flush = () => { if (run.length) { band += `<path class="rk-band" d="M${run.map(i => `${x(i).toFixed(1)},${y(pts[i].M.max).toFixed(1)}`).join(' L')} L${run.slice().reverse().map(i => `${x(i).toFixed(1)},${y(pts[i].M.min).toFixed(1)}`).join(' L')} Z"/>`; } run = []; }; pts.forEach((p, i) => { if (p.M.n) run.push(i); else flush(); }); flush(); }
  const dots = (get, cls) => pts.map((p, i) => { const v = get(p); return v == null ? '' : `<circle class="${cls}" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="4"/>`; }).join('');
  const lastI = (get) => { for (let i = pts.length - 1; i >= 0; i--) if (get(pts[i]) != null) return i; return -1; };
  const usI = lastI(p => p.M.us && p.M.us.r), mdI = lastI(p => p.M.n ? p.M.med : null);
  const tip = p => `${rkDay(p.d, true)}\nOurs: ${p.M.us ? Math.round(p.M.us.r) : '—'} AED\nMarket median: ${p.M.n ? Math.round(p.M.med) : '—'} AED${p.M.n ? `\nAround us: ${Math.round(p.M.min)} – ${Math.round(p.M.max)} (${p.M.n} hotels)` : ''}${p.M.diff != null ? `\nDifference: ${p.M.diff > 0 ? '+' : ''}${Math.round(p.M.diff * 100)}%` : ''}`;
  const colW = (W - L - R) / Math.max(1, dates.length - 1);
  return `<div class="rk-chart">
    <div class="rk-legend"><span><i class="k-us"></i>Our rate</span><span><i class="k-md"></i>Market median</span><span><i class="k-bd"></i>Lowest – highest around us</span></div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Our rate and the market over the next ${dates.length} days">
      ${ticks.map(t => `<line class="rk-grid" x1="${L}" x2="${W - R}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/><text class="rk-ax" x="${L - 8}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end">${Math.round(t)}</text>`).join('')}
      ${pts.map((p, i) => i % (W < 500 ? 3 : 2) === 0 || dates.length <= 8 ? `<text class="rk-ax" x="${x(i).toFixed(1)}" y="${H - 10}" text-anchor="middle">${escapeHtml(rkDay(p.d).replace(' ', ' '))}</text>` : '').join('')}
      ${band}
      <path class="rk-md" d="${seg(p => p.M.n ? p.M.med : null)}"/>
      <path class="rk-us" d="${seg(p => p.M.us ? p.M.us.r : null)}"/>
      ${dots(p => p.M.n ? p.M.med : null, 'rk-dmd')}${dots(p => p.M.us ? p.M.us.r : null, 'rk-dus')}
      ${usI >= 0 ? `<text class="rk-lbl" x="${Math.min(W - R, x(usI) + 8).toFixed(1)}" y="${(y(pts[usI].M.us.r) - 9).toFixed(1)}" text-anchor="end">Ours ${Math.round(pts[usI].M.us.r)}</text>` : ''}
      ${mdI >= 0 ? `<text class="rk-lbl mut" x="${Math.min(W - R, x(mdI) + 8).toFixed(1)}" y="${(y(pts[mdI].M.med) + 18).toFixed(1)}" text-anchor="end">Market ${Math.round(pts[mdI].M.med)}</text>` : ''}
      ${pts.map((p, i) => `<rect class="rk-hit${p.d === rkSel ? ' sel' : ''}" x="${(x(i) - colW / 2).toFixed(1)}" y="${T}" width="${colW.toFixed(1)}" height="${H - T - B}" onclick="rkSel='${p.d}';rkRender()"><title>${escapeHtml(tip(p))}</title></rect>`).join('')}
    </svg></div>`;
}

function rkTableHtml(h, dates) {
  const comps = h.comps || [];
  const cell = (d, who) => { const p = rkPrice(d, h.id, who); return `<td class="rk-c${d === rkSel ? ' sel' : ''}${p && p.src === 'online' ? ' web' : ''}" onclick="rkEdit(this,'${d}',${_rkQ(who)})" title="${p ? (p.src === 'online' ? 'Found online' : 'Typed in') + (p.by ? ' by ' + escapeHtml(p.by) : '') + (p.at ? ' · ' + new Date(p.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '') : 'Tap to type the price'}">${p ? Math.round(p.r) + (p.src === 'online' ? '<i>🌐</i>' : '') : '<span>·</span>'}</td>`; };
  const links = c => { const q = encodeURIComponent((c.name || '') + ' Dubai'), d = rkSel, d2 = rkAdd(rkSel, 1);
    return `<span class="rk-links"><a target="_blank" rel="noopener" title="Booking.com · ${escapeHtml(rkDay(d))}" href="https://www.booking.com/searchresults.html?ss=${q}&checkin=${d}&checkout=${d2}&group_adults=2&no_rooms=1&group_children=0">B</a><a target="_blank" rel="noopener" title="Google · ${escapeHtml(rkDay(d))}" href="https://www.google.com/travel/search?q=${q}">G</a><a target="_blank" rel="noopener" title="Google Maps" href="https://www.google.com/maps/search/${q}">🗺</a></span>`; };
  const diffRow = dates.map(d => { const M = rkMarket(h, d); if (M.diff == null) return '<td class="rk-c">·</td>'; const t = Math.abs(M.diff) <= 0.05 ? 'ok' : M.diff > 0 ? 'up' : 'down'; return `<td class="rk-c rk-d-${t}">${M.diff > 0 ? '+' : ''}${Math.round(M.diff * 100)}%</td>`; }).join('');
  return `<div class="rk-scroll"><table class="rk-table">
    <thead><tr><th class="rk-n">Hotel</th>${dates.map(d => `<th class="${d === rkSel ? 'sel' : ''}" onclick="rkSel='${d}';rkRender()">${escapeHtml(rkDay(d))}</th>`).join('')}</tr></thead>
    <tbody>
      <tr class="rk-us-row"><td class="rk-n"><b>${escapeHtml(h.name)}</b><small class="rk-us-tag">Our hotel</small>${links({ name: h.search || h.name })}</td>${dates.map(d => cell(d, 'us')).join('')}</tr>
      ${comps.map(c => `<tr><td class="rk-n"><b>${escapeHtml(c.name)}</b>${links(c)}<button class="rk-x" title="Remove" onclick="rkDelComp(${_rkQ(c.id)})">✕</button></td>${dates.map(d => cell(d, c.id)).join('')}</tr>`).join('') || ''}
      <tr class="rk-sum"><td class="rk-n">Market median</td>${dates.map(d => { const M = rkMarket(h, d); return `<td class="rk-c">${M.n ? Math.round(M.med) : '·'}</td>`; }).join('')}</tr>
      <tr class="rk-sum"><td class="rk-n">Us vs market</td>${diffRow}</tr>
    </tbody></table></div>`;
}
function rkEdit(td, d, who) {
  if (td.querySelector('input')) return;
  const h = rkCur(), p = rkPrice(d, h.id, who);
  td.innerHTML = `<input type="number" inputmode="numeric" min="0" step="1" value="${p ? Math.round(p.r) : ''}">`;
  const inp = td.querySelector('input'); inp.focus(); inp.select();
  let fin = false;   // Enter saves and redraws, which also blurs the box: save once
  const done = save => { if (fin) return; fin = true; if (save) rkSetPrice(d, h.id, who, inp.value === '' ? null : +inp.value, 'typed'); setTimeout(rkRender, 0); };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
  inp.addEventListener('blur', () => done(true));
}
function rkSetPrice(d, hid, who, r, src, extra) {
  const by = (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || '';
  const v = r > 0 ? Object.assign({ r: Math.round(r), src, at: Date.now(), by }, extra || {}) : null;
  rkPrices[d] = rkPrices[d] || {}; rkPrices[d][hid] = rkPrices[d][hid] || {};
  if (v) rkPrices[d][hid][who] = v; else delete rkPrices[d][hid][who];
  fbSet(`rates/prices/${d}/${hid}/${_rkId(who) === who ? who : _rkId(who)}`, v);
}

/** 📊 Every one of our hotels on the chosen date, and the difference from its market over the 14 days. */
function rkAllHtml(H, dates) {
  const fmt = v => v == null ? '—' : Math.round(v).toLocaleString('en-GB');
  const cls = d => d == null ? 'none' : Math.abs(d) <= 0.05 ? 'ok' : d > 0 ? 'up' : 'down';
  const pct = d => d == null ? '·' : (d > 0 ? '+' : '') + Math.round(d * 100) + '%';
  return `<div class="rk-all">${H.map(h => { const M = rkMarket(h, rkSel); return `<button class="rk-allc rk-t-${cls(M.diff)}" onclick="rkHotel='${h.id}';rkRender()"><span class="rk-kl">${escapeHtml(h.name)}</span><span class="rk-kv">${M.us ? fmt(M.us.r) : '—'}<i>AED</i></span><span class="rk-ks">Market ${fmt(M.med)}${M.n ? ` · ${M.n} hotels` : ''}</span><span class="rk-chip">${M.diff == null ? 'No comparison yet' : (M.diff > 0 ? '▲ ' : M.diff < 0 ? '▼ ' : '● ') + pct(M.diff) + ' vs market'}</span></button>`; }).join('')}</div>
  <section class="rk-panel">
    <header class="rk-ph"><div><h3>Us vs the market, every day</h3><p>+ we are dearer · − we are cheaper. Tap a day to choose it.</p></div></header>
    <div class="rk-scroll"><table class="rk-table">
      <thead><tr><th class="rk-n">Hotel</th>${dates.map(d => `<th class="${d === rkSel ? 'sel' : ''}" onclick="rkSel='${d}';rkRender()">${escapeHtml(rkDay(d))}</th>`).join('')}</tr></thead>
      <tbody>${H.map(h => `<tr><td class="rk-n"><b>${escapeHtml(h.name)}</b></td>${dates.map(d => { const M = rkMarket(h, d); return `<td class="rk-c rk-d-${cls(M.diff)}${d === rkSel ? ' sel' : ''}" title="Ours ${M.us ? Math.round(M.us.r) : '—'} · market ${M.n ? Math.round(M.med) : '—'}">${pct(M.diff)}</td>`; }).join('')}</tr>`).join('')}
      ${H.length > 1 ? `<tr class="rk-sum"><td class="rk-n">Our rates</td>${dates.map(d => `<td class="rk-c">${H.map(h => { const p = rkPrice(d, h.id, 'us'); return p ? Math.round(p.r) : '·'; }).join('<br>')}</td>`).join('')}</tr>` : ''}
      </tbody></table></div>
  </section>`;
}

// ── Our hotels and the hotels around ──────────────────────
function rkRenameHotel() { const h = rkCur(); if (!h) return; const n = prompt('Name of our hotel (as guests search for it)', h.name); if (!n || !n.trim()) return; h.name = n.trim(); h.search = n.trim(); rkSaveHotel(h); rkRender(); }
function rkDelHotel() {
  const h = rkCur(); if (!h || !confirm(`Remove ${h.name} from our hotels? Its prices stay saved.`)) return;
  if (!Object.keys(rkSetup.hotels || {}).length) rkSaveHotel(h);   // (saves the starting three first)
  const hs = Object.assign({}, rkSetup.hotels); delete hs[h.id]; rkSetup.hotels = hs; fbSet('rates/setup/hotels/' + h.id, null); rkHotel = null; rkRender();
}
function rkAddHotelDlg() {
  const n = prompt('Our hotel\'s name (as guests search for it), e.g. "Ibis Dubai Deira"'); if (!n || !n.trim()) return;
  const id = _rkId(n); rkSaveHotel({ id, name: n.trim(), search: n.trim(), comps: [] }); rkHotel = id; rkRender();
}
function rkAddHotel() { const el = document.getElementById('rkNewH'); if (!el || !el.value.trim()) return; const id = _rkId(el.value); rkSaveHotel({ id, name: el.value.trim(), search: el.value.trim(), comps: [] }); rkHotel = id; rkRender(); }
function rkAddCompDlg(name) {
  const h = rkCur(); if (!h) return;
  const n = name || prompt('A hotel near ' + h.name + ' (its name as on Google Maps)'); if (!n || !n.trim()) return;
  const id = _rkId(n); if ((h.comps || []).some(c => c.id === id)) { showToast('Already in the list', 'warn'); return; }
  h.comps = (h.comps || []).concat([{ id, name: n.trim() }]); rkSaveHotel(h); rkRender();
}
function rkDelComp(id) { const h = rkCur(); if (!h) return; const c = (h.comps || []).find(x => x.id === id); if (!c || !confirm(`Remove ${c.name} from the hotels around ${h.name}?`)) return; h.comps = h.comps.filter(x => x.id !== id); rkSaveHotel(h); rkRender(); }

// ── ✨ Online (the AI with web search) ─────────────────────
async function _rkAsk(prompt, uses) {
  const cfg = typeof riCfg === 'function' ? riCfg() : {};
  if (!cfg.key) throw new Error('Add the AI key first (Roster → ✨ AI settings)');
  const model = cfg.model || 'claude-sonnet-5-5', older = /haiku-4|sonnet-4-5|opus-4-5/.test(model);
  const body = { model, max_tokens: 3000,
    system: 'You look up hotel prices for a hotel front office in Dubai. Use web search. Answer ONLY with the JSON asked for, no other text. Prices: the cheapest public room for the dates, 2 adults, in AED, as a number; null when you cannot find a price for that hotel and date. Never guess a price.',
    tools: [{ type: older ? 'web_search_20250305' : 'web_search_20260209', name: 'web_search', max_uses: uses || 5, user_location: { type: 'approximate', city: 'Dubai', country: 'AE', timezone: 'Asia/Dubai' } }],
    messages: [{ role: 'user', content: prompt }] };
  const headers = { 'content-type': 'application/json', 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
  let r; try { r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body) }); } catch (_) { throw new Error('No internet connection'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { if (r.status === 401) throw new Error('The AI key was refused'); if (r.status === 429 || r.status === 529) throw new Error('The AI is busy: try again in a minute'); throw new Error((j.error && j.error.message) || 'error ' + r.status); }
  const text = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const m = text.match(/\{[\s\S]*\}/); if (!m) throw new Error('No prices came back');
  return JSON.parse(m[0]);
}
/** Prices for the chosen date (or the next n days), ours and the hotels around, all in one search. */
async function rkCheckOnline(nDays) {
  const h = rkCur(); if (!h || rkBusy) return;
  if (!(typeof riCfg === 'function' && riCfg().key)) { if (typeof riSetupOpen === 'function') riSetupOpen(); showToast('The price check needs the AI key once on this device', 'warn'); return; }
  if (!(h.comps || []).length && !confirm('No hotels around us in the list yet: check only our own rate?')) return;
  const days = nDays ? rkDates().slice(rkDates().indexOf(rkSel), rkDates().indexOf(rkSel) + nDays) : [rkSel];
  rkBusy = true; rkRender();
  const names = [{ id: 'us', name: h.search || h.name }].concat((h.comps || []).map(c => ({ id: c.id, name: c.name })));
  let got = 0;
  try {
    const res = await _rkAsk(`Hotels in Dubai: ${names.map(n => `"${n.name}"`).join(', ')}.\nCheck-in dates (1 night each): ${days.join(', ')}.\nReply JSON: {"prices":[{"hotel":"<exact name from my list>","date":"YYYY-MM-DD","aed":<number or null>,"source":"<url>"}]}`, Math.min(10, 2 + days.length * 2));
    (res.prices || []).forEach(p => {
      const n = names.find(x => x.name.toLowerCase() === String(p.hotel || '').toLowerCase()) || names.find(x => String(p.hotel || '').toLowerCase().includes(x.name.toLowerCase().split(' ')[0]));
      if (!n || !days.includes(p.date) || !(+p.aed > 0)) return;
      rkSetPrice(p.date, h.id, n.id, +p.aed, 'online', p.source ? { url: String(p.source).slice(0, 300) } : null); got++;
    });
    showToast(got ? `${got} price${got === 1 ? '' : 's'} found online (🌐): check the important ones on the links` : 'No prices found online for those dates: try the links', got ? 'ok' : 'warn');
  } catch (e) { showToast(e.message, 'err'); }
  rkBusy = false; rkRender();
}
/** ✨ Hotels around ours, a similar kind, to choose from. */
async function rkFindNearby() {
  const h = rkCur(); if (!h || rkBusy) return;
  rkBusy = true; rkRender();
  try {
    const res = await _rkAsk(`Find 8 hotels within about 2 km of "${h.search || h.name}" in Dubai that compete with it (similar stars and price). Reply JSON: {"hotels":[{"name":"<name as on Google Maps>","stars":<number>,"km":<distance>}]}`, 4);
    const have = new Set((h.comps || []).map(c => c.id).concat([_rkId(h.name)]));
    const list = (res.hotels || []).filter(x => x && x.name && !have.has(_rkId(x.name))).slice(0, 8);
    rkBusy = false; rkRender();
    if (!list.length) { showToast('No new hotels found: add them by name', 'warn'); return; }
    const d = document.createElement('div'); d.id = 'rkDlg'; d.className = 'ri-viewer';
    d.innerHTML = `<div class="card rt-sheet"><div class="ro-card-hd"><b>✨ Hotels around ${escapeHtml(h.name)}</b><button class="ro-x" onclick="document.getElementById('rkDlg').remove()">✕</button></div>
      <small class="ro-hint">Found online: tap the ones to compare with.</small>
      <div class="rk-find">${list.map(x => `<button class="rb-opt" onclick="this.classList.toggle('on')" data-n="${escapeHtml(x.name)}">${escapeHtml(x.name)}${x.stars ? ` · ${'★'.repeat(Math.min(5, Math.round(x.stars)))}` : ''}${x.km != null ? ` · ${x.km} km` : ''}</button>`).join('')}</div>
      <div class="ro-acts"><button class="btn gold" onclick="[...document.querySelectorAll('#rkDlg .rb-opt.on')].forEach(b=>rkAddCompDlg(b.dataset.n));document.getElementById('rkDlg').remove()">Add the ones picked</button></div></div>`;
    d.addEventListener('click', e => { if (e.target === d) d.remove(); });
    document.body.appendChild(d);
  } catch (e) { rkBusy = false; rkRender(); showToast(e.message, 'err'); }
}

document.addEventListener('DOMContentLoaded', () => {
  let rzT = 0; window.addEventListener('resize', () => { clearTimeout(rzT); rzT = setTimeout(() => { if (document.getElementById('panel-rates')?.classList.contains('active')) rkRender(); }, 250); });
  setTimeout(() => {
    if (typeof fbListen !== 'function') return;
    const re = () => { if (document.getElementById('panel-rates')?.classList.contains('active') && !(document.activeElement && document.activeElement.closest && document.activeElement.closest('#rkRoot'))) rkRender(); };
    fbListen('rates/setup', v => { rkSetup = v || {}; re(); });
    fbListen('rates/prices', v => { rkPrices = v || {}; re(); });
  }, 1800);
});
