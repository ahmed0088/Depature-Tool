/* HotelOps · Opera profile fixer (opt-in, separate from the Opera reader)
 *
 * Fills EMPTY Gender / Nationality / ID type / ID number in a guest's Opera Cloud profile, from a plan
 * he approved in HotelOps (Immigration Check → Fix in Opera → "Copy plan"). It never saves.
 *
 * What it does, in order, for the one guest he picked:
 *  1. Checks the profile on screen is that guest (every name word, any order). Wrong or unclear name: it stops.
 *  2. Reads each field. A field that already has a value (a masked number counts as a value) is never touched.
 *  3. DRY RUN is on by default: it only shows what it would fill. Turn it off to fill.
 *  4. Clicks the profile's "Edit" button if the fields are not open, types the approved values, reads them
 *     back, and highlights what it changed. It STOPS there: pressing Save is his job.
 * It never clicks Save, OK, Submit, Apply, Confirm, Done, Yes, Delete or Cancel (hard-coded refusal), never
 * touches any other field, and never sends anything anywhere. The plan stays in this tab. The change log
 * keeps the room, the field and the new value (ID numbers as last 4 only), never a name.
 *
Real Opera layout it was built for (Ibis Styles Deira): Front Desk > In House > Manage Reservation > click the guest name =
 * Manage Profile > left menu Identification. Read mode shows Personal Details (Nationality "NG Nigeria", Gender "M") and the ID
 * table (ID Type / ID Number masked / Issued Country...). After "Edit" these become text boxes (with a magnifier list) that take
 * codes: Nationality AE/NG..., Gender M/F, ID Type PAS... Start (auto mode) opens each guest itself by clicking only the In House breadcrumb, Search, a confirmation number, the guest name and the Identification menu. It never presses the magnifier, "New" or the red X, and an
 * ID Number that shows as masked counts as already filled.
 * Use: Opera Cloud tab → F12 → Console → paste → Enter. Paste the plan into the small window and press Load.
 */
(function () {
  'use strict';
  if (window.__hoFixer && window.__hoFixer.open) { window.__hoFixer.open(); return; }
  const FORBIDDEN = /\b(save|ok|submit|apply|confirm|done|yes|delete|remove|cancel|check ?in|check ?out|post|settle|finish|close|discard|new|create|enroll|merge|pay)\b/i;
  const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'mstr', 'master', 'sir', 'madam']);
  const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const words = s => fold(s).split(' ').filter(t => t && !TITLES.has(t));
  const last4 = v => { const s = String(v || '').replace(/\s+/g, ''); return s ? (s.length > 4 ? '••••' + s.slice(-4) : '••••') : ''; };
  const FIELDS = { gender: 'Gender', nationality: 'Nationality', idType: 'ID Type', idNumber: 'ID Number' };
  const VALID_NAT = /^[A-Z]{2}$/;
  const st = { hook: null, plan: null, cur: null, dry: true, log: [], busy: false, auto: false, stop: false, paused: false, idx: 0 };
  try { st.log = JSON.parse(sessionStorage.getItem('hoFixerLog') || '[]'); } catch (_) {}
  const saveLog = () => { try { sessionStorage.setItem('hoFixerLog', JSON.stringify(st.log.slice(-300))); } catch (_) {} };

  // ── plan decode (same format and checksum as immig-fixer-core.js) ──
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); }
  function decode(text) {
    const m = /^HOFIX1\.([a-z0-9]+)\.([A-Za-z0-9+/=]+)$/.exec(String(text || '').trim());
    if (!m) throw new Error('That is not a plan. Copy it again from HotelOps.');
    let body, plan; try { body = decodeURIComponent(escape(atob(m[2]))); plan = JSON.parse(body); } catch (_) { throw new Error('The plan could not be read.'); }
    if (hash(body) !== m[1]) throw new Error('The plan was changed or cut short. Copy it again.');
    if (!plan || plan.v !== 1 || !Array.isArray(plan.items)) throw new Error('Unsupported plan.');
    if (plan.origin && plan.origin !== location.origin) throw new Error('This plan was made for a different Opera link than this page. Open the hotel\'s own Opera link from HotelOps.');
    plan.items.forEach(it => it.fields.forEach(f => {
      if (!FIELDS[f.field] || typeof f.value !== 'string' || !f.value) throw new Error('A plan field is not allowed.');
      if (f.field === 'gender' && !/^[MF]$/.test(f.value)) throw new Error('Gender must be M or F.');
      if (f.field === 'nationality' && !VALID_NAT.test(f.value)) throw new Error('Bad country code.');
    }));
    return plan;
  }

  // ── screen reading (labels, not Opera internals) ──
  const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const own = el => (el.textContent || '').replace(/\s+/g, ' ').trim();
  function profileName() {
    const root = document.body;
    const re = /^(?:Mr|Mrs|Ms|Miss|Dr|Prof|Mstr)\.?\s+([A-Za-z][^\n]{1,60})$/i;
    const nodes = [...root.querySelectorAll('h1,h2,h3,[class*="title"],[class*="name"],span,div')].filter(vis).slice(0, 600);
    for (const n of nodes) {
      if (n.children.length > 2) continue;
      const t = own(n); const m = re.exec(t);
      if (m && t.length < 70) return t;
    }
    return '';
  }
  /** the visible heading/text that is exactly this guest's name (any order, titles ignored), or '' */
  function nameOnScreen(planName) {
    const nodes = [...document.body.querySelectorAll('h1,h2,h3,h4,a,[class*="title"],[class*="name"],[class*="Name"],span,div')].filter(vis).slice(0, 900);
    for (const n of nodes) {
      if (n.children.length > 2) continue;
      const t = own(n); if (t && t.length < 90 && nameOk(planName, t)) return t;
    }
    return '';
  }
  function nameOk(planName, shown) {
    const A = words(planName), B = words(shown);
    if (!A.length || A.length !== B.length) return false;
    const sb = new Set(B); return A.every(t => sb.has(t));
  }
  /** the value box next to a label ("Gender", "Nationality", "ID Number"), as { el, value, kind } */
  function fieldFor(label, scope) {
    const lab = fold(label), root = scope || document.body;
    const labels = [...root.querySelectorAll('label,span,div,th,td,oj-label,td span')].filter(n => vis(n) && n.children.length === 0 && fold(own(n)) === lab);
    const INPUT = 'input:not([type=hidden]):not([type=checkbox]):not([type=password]):not([type=submit]),select,textarea,[role=combobox]';
    // pass 1: an editable box (label for=, or a box in the label's own row); pass 2: read-only display text
    for (const l of labels) {
      let box = null;
      if (l.tagName === 'LABEL' && l.htmlFor) box = document.getElementById(l.htmlFor);
      let p = l.parentElement;
      for (let i = 0; i < 2 && p && !box; i++, p = p.parentElement) { const cand = p.querySelectorAll(INPUT); if (cand.length === 1) box = cand[0]; }
      if (box && vis(box)) return { el: box, value: 'value' in box ? box.value : own(box), editable: true, label: l };
    }
    for (const l of labels) {
      // read-only display: the text right after the label
      const holder = l.parentElement; if (holder) {
        const txt = own(holder).replace(own(l), '').trim();
        return { el: null, value: txt, editable: false, label: l };
      }
    }
    return null;
  }
  const FIELD_LABELS = { gender: ['Gender'], nationality: ['Nationality'], idType: ['ID Type'], idNumber: ['ID Number'] };
  function readField(f) {
    for (const lb of FIELD_LABELS[f]) { const r = fieldFor(lb); if (r) return r; }
    return null;
  }
  const isEmpty = v => { const s = String(v == null ? '' : v).trim(); return !s || /^[-–—_.]+$/.test(s) || /^(unknown|u|n\/a|none)$/i.test(s); };

  // ── the only clicks it can make ──
  function safeClick(el) {
    const label = (el.getAttribute('aria-label') || own(el) || el.value || '').trim();
    if (FORBIDDEN.test(label)) throw new Error('Refused to click "' + label.slice(0, 30) + '". Only he presses it.');
    el.click();
  }
  // ── the one extra button it may press: "Show Masked Information", only on the Identification page, only to read an ID number ──
  const isMaskedVal = v => /^[X*•x]{3,}/.test(String(v || '').trim());
  function findShowMasked() {
    if (!/Identification/i.test(document.body.innerText || '')) return null;
    return [...document.querySelectorAll('button,a,[role=button],oj-button')].find(b => vis(b) && /^show masked information$/i.test((b.getAttribute('aria-label') || own(b)).trim())) || null;
  }
  async function revealMasked(item) {
    const b = findShowMasked(); if (!b) return false;
    b.click(); await sleep(800);   // read-only view change: nothing is saved, nothing is typed
    logIt(item, 'idNumber', '', 'opened Show Masked Information (numbers on screen are not logged)');
    return true;
  }
  function findEditButtons() {
    return [...document.querySelectorAll('button,a,[role=button],oj-button')].filter(b => vis(b) && /^edit$/i.test((b.getAttribute('aria-label') || own(b)).trim()));
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const setNative = (el, v) => {
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const d = Object.getOwnPropertyDescriptor(proto, 'value'); (d && d.set ? d.set : (x, y) => { x.value = y; }).call(el, v);
  };
  async function type(el, text) {
    el.focus(); setNative(el, ''); el.dispatchEvent(new Event('input', { bubbles: true }));
    if (el.tagName === 'SELECT') {
      const o = [...el.options].find(o => fold(o.value) === fold(text) || fold(o.textContent) === fold(text) || fold(o.textContent).startsWith(fold(text) + ' '));
      if (!o) return false; setNative(el, o.value); el.dispatchEvent(new Event('change', { bubbles: true })); return true;
    }
    // key by key, like typing (Opera's boxes commit on key events plus leaving the box)
    for (const ch of String(text)) {
      const kc = { key: ch, code: /^[a-z]$/i.test(ch) ? 'Key' + ch.toUpperCase() : /^\d$/.test(ch) ? 'Digit' + ch : '', bubbles: true, cancelable: true };
      el.dispatchEvent(new KeyboardEvent('keydown', kc)); el.dispatchEvent(new KeyboardEvent('keypress', kc));
      setNative(el, el.value + ch); el.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }));
      el.dispatchEvent(new KeyboardEvent('keyup', kc)); await sleep(40);
    }
    await sleep(250);
    // a list that opens under the box (Oracle JET combobox): pick the one row that starts with the value
    const opts = [...document.querySelectorAll('[role=option],li[role=option],.oj-listbox-result,.oj-listbox-result-label')].filter(vis).filter(o => !FORBIDDEN.test(own(o)));
    const want = fold(text), pick = opts.filter(o => { const t = fold(own(o)); return t === want || t.startsWith(want + ' ') || t.startsWith(want); });
    if (pick.length === 1) { pick[0].click(); await sleep(150); }
    else if (pick.length > 1) return false;
    el.dispatchEvent(new Event('change', { bubbles: true })); el.dispatchEvent(new Event('blur', { bubbles: true })); try { el.blur(); } catch (_) {}
    await sleep(200);
    return true;
  }
  const say = (m, bad) => { if (UI.msg) { UI.msg.textContent = m; UI.msg.style.color = bad ? '#c0392b' : '#1b6b3a'; } try { if (st.hook) st.hook('say', m, !!bad); } catch (_) {} };
  function logIt(item, field, value, result) {
    const e = { t: new Date().toISOString(), hotel: (st.plan && st.plan.hotel) || '', room: item.room, arrival: item.arrival || '', field, to: field === 'idNumber' ? last4(value) : value, result, dry: st.dry };
    st.log.push(e); saveLog(); renderLog(); try { if (st.hook) st.hook('log', e); } catch (_) {}
  }

  /** read-only check: is the right guest open, and which approved fields are empty */
  function check(item) {
    const body = (document.body.innerText || '');
    if (!/Personal Details|Identification/i.test(body)) return { ok: false, why: 'Open the guest\'s Manage Profile and its Identification page first (In House, the reservation, then the guest name).' };
    if (!nameOnScreen(item.name)) return { ok: false, why: 'The profile open is not room ' + item.room + '\'s guest (name does not match). Nothing was changed.' };
    const rows = item.fields.map(f => {
      const r = readField(f.field);
      return { f, found: !!r, empty: r ? isEmpty(r.value) : false, masked: r ? isMaskedVal(r.value) : false, editable: r ? r.editable : false, current: r ? r.value : '' };
    });
    return { ok: true, rows };
  }
  async function fill(item) {
    if (st.busy) return; st.busy = true;
    try {
      let c = check(item);
      if (!c.ok) { say(c.why, true); item.fields.forEach(f => logIt(item, f.field, f.value, 'refused: wrong or no profile')); return; }
      // a masked ID number cannot be told from a filled one: with the user's OK, open Show Masked Information once and look again
      const idRow = c.rows.find(r => r.f.field === 'idNumber' && r.found && isMaskedVal(r.current));
      if (idRow) {
        if (st.dry) logIt(item, 'idNumber', idRow.f.value, 'dry run: would open Show Masked Information to check the ID number');
        else if (await revealMasked(item)) c = check(item);
      }
      let todo = c.rows.filter(r => r.found && r.empty);
      // an ID number is only typed together with its ID type; Opera keeps masked numbers non-editable and they count as filled
      c.rows.filter(r => !r.found).forEach(r => logIt(item, r.f.field, r.f.value, 'field not found on screen'));
      c.rows.filter(r => r.found && !r.empty).forEach(r => logIt(item, r.f.field, r.f.value, 'skipped: already has a value'));
      if (!todo.length) { say('Nothing to fill: every approved field is already set or was not found.', false); return; }
      if (st.dry) { todo.forEach(r => logIt(item, r.f.field, r.f.value, 'dry run: would fill')); say('Dry run: would fill ' + todo.map(r => FIELDS[r.f.field]).join(', ') + '. Untick Dry run to fill.', false); return; }
      if (todo.some(r => !r.editable)) {
        const btns = findEditButtons();
        if (!btns.length) { say('The fields are read-only and no Edit button was found. Open Edit yourself, then press Fill again.', true); return; }
        // the Edit of the panel that holds the first needed field (nearest ancestor that contains one)
        const first = readField(todo[0].f.field); let scopeBtn = null;
        for (let p = first && first.label ? first.label.parentElement : null; p && !scopeBtn; p = p.parentElement) { const inside = btns.filter(b => p.contains(b)); if (inside.length) scopeBtn = inside[0]; }
        if (!scopeBtn) scopeBtn = btns[0];
        safeClick(scopeBtn); await sleep(700);
      }
      const done = [];
      for (const r of todo) {
        const cur = readField(r.f.field);
        if (!cur || !cur.editable) { logIt(item, r.f.field, r.f.value, 'field not editable after Edit'); continue; }
        if (!isEmpty(cur.value)) { logIt(item, r.f.field, r.f.value, 'skipped: filled meanwhile'); continue; }
        const picked = await type(cur.el, r.f.value);
        const back = readField(r.f.field), shownVal = back ? String(back.value) : '';
        const good = picked && fold(shownVal).startsWith(fold(r.f.value));
        if (good) { cur.el.style.outline = '3px solid #1b9c5a'; cur.el.style.outlineOffset = '2px'; done.push(FIELDS[r.f.field]); logIt(item, r.f.field, r.f.value, 'filled, not saved'); }
        else { logIt(item, r.f.field, r.f.value, 'could not fill: type it yourself'); }
      }
      say(done.length ? 'Filled ' + done.join(', ') + '. Check them, then press Save in Opera yourself.' : 'Could not fill. Use the values shown in the list and type them yourself.', !done.length);
    } catch (e) { say(String(e.message || e), true); }
    finally { st.busy = false; }
  }

  // ── auto mode: opens each guest's Identification page by itself (In House > room > reservation > guest name > Identification) ──
  // Only read-style clicks: breadcrumb "In House", the Search button, a confirmation-number link, the guest name, the "Identification" menu item.
  // The same hard refusal list applies, and the fill step never presses Save: he does.
  const norm = r => String(r || '').replace(/\D/g, '').replace(/^0+/, '');
  const waitFor = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 20000)) { let r = null; try { r = fn(); } catch (_) {} if (r) return r; await sleep(150); } return null; };
  const hasText = re => re.test(document.body.innerText || '');
  function findExact(text, tags) {
    const t = text.toLowerCase();
    const all = [...document.querySelectorAll(tags || 'a,button,[role=button],[role=link],[role=tab],[role=menuitem],li,span')].filter(n => vis(n) && n.children.length <= 2 && own(n).toLowerCase() === t);
    const link = all.find(n => n.matches('a,button,[role=button],[role=link],[role=tab],[role=menuitem]'));
    const found = link || all.find(n => n.closest('a,button,[role=link],[role=menuitem]')) || all[0] || null;
    return found && (found.closest('a,button,[role=button],[role=link],[role=tab],[role=menuitem]') || found);
  }
  function roomBox() {
    const ok = el => el && vis(el) && !el.disabled && /^(input|textarea)$/i.test(el.tagName);
    for (const l of document.querySelectorAll('label')) { const lt = fold(own(l)); if (!vis(l) || !(lt === 'room' || lt === 'room number' || lt === 'rooms' || lt === 'room no')) continue; const el = l.htmlFor && document.getElementById(l.htmlFor); if (ok(el)) return el; const inner = l.querySelector('input'); if (ok(inner)) return inner; }
    const byAttr = [...document.querySelectorAll('input')].find(i => ok(i) && /^room( number| no)?$/.test(fold(i.getAttribute('aria-label') || i.placeholder || '')));
    return byAttr || null;
  }
  const busy = () => [...document.querySelectorAll('[class*=BusyIndicator],[class*=busy],[class*=spinner],[class*=Loading],[role=progressbar]')].some(vis);
  const dialogText = () => { const d = [...document.querySelectorAll('[role=dialog],[role=alertdialog],.oj-dialog,[class*=popup]')].find(vis); return d ? own(d).slice(0, 80) : ''; };
  const labelsNow = () => { const seen = new Set(); [...document.querySelectorAll('a,button,[role=menuitem],[role=option],[role=tab],li')].filter(vis).forEach(n => { const t = own(n); if (t && t.length < 40 && seen.size < 30) seen.add(t); }); return [...seen].join(' | ').slice(0, 500); };
  const setVal = (el, v) => { el.focus(); setNative(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: v.slice(-1) })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  const inHouseAll = () => [...document.querySelectorAll('a,[role=menuitem],[role=option],[role=link],li,span')].filter(n => vis(n) && n.children.length <= 3 && own(n).length < 30 && (fold(own(n)) === 'in house' || (/^in house\b/.test(fold(own(n))) && !/arrival|departure|report/.test(fold(own(n))))))
    .map(n => n.matches('a,button,[role=link],[role=menuitem]') ? n : (n.querySelector('a,[role=link],[role=menuitem]') || n.closest('a,[role=link],[role=menuitem]') || n))
    .filter((n, i, arr) => arr.indexOf(n) === i);
  let exclude = new Set();
  const inHouseItem = () => inHouseAll().find(n => !exclude.has(n)) || null;
  let route = '';   // the route that worked in this session is tried first next time
  const ms = t0 => ' (' + (Date.now() - t0) + ' ms)';
  const elTag = el => '<' + el.tagName.toLowerCase() + (el.id ? '#' + String(el.id).slice(0, 25) : '') + '>';
  // Proven manual path: hamburger > search box (type "In House") > click the result. Polls every 150 ms, clicks the moment the result shows.
  const smNow = () => findExact('site map', 'a,button,[role=button],[role=menuitem],li,span');
  async function viaHamburger(round) {
    const T = Date.now();
    { const sm0 = smNow(); const inMenu = n => { let e = n; for (let i = 0; i < 6 && e && e !== document.body && e !== document.documentElement; i++, e = e.parentElement) if (sm0 && e.contains(sm0) && e.querySelectorAll("a,li").length < 400 && !e.querySelector("#app,h1,h2,[role=main]")) return true; return false; };
      exclude = new Set(inHouseAll().filter(n => !inMenu(n))); }   // the breadcrumb already on the page is not the menu result
    // 1. always open the real menu first ("Show Menu" button); the page's own Search/Go box (dashboard) is not the menu
    if (!smNow()) {
      const cand = [...document.querySelectorAll('a,button,[role=button],oj-button')].filter(n => vis(n) && !/clear search|^go$/i.test(own(n)));
      const pick = n => (n.getAttribute('aria-label') || '') + ' ' + (n.title || '') + ' ' + (n.id || '') + ' ' + own(n);
      const ham = cand.find(n => /show menu|ode_pg_sdbr/i.test(pick(n))) || cand.find(n => { const r = n.getBoundingClientRect(); return r.left < 140 && r.top < 100 && /menu|navigat|hamburger/i.test(pick(n) + ' ' + n.className); }) || cand.find(n => { const r = n.getBoundingClientRect(); return r.left < 100 && r.top < 80; });
      logIt(st.cur || {}, 'nav', '', 'round ' + round + ': hamburger ' + (ham ? elTag(ham) + ' ' + (ham.getAttribute('aria-label') || own(ham)).slice(0, 25) : 'not found') + ms(T));
      if (!ham) return null;
      try { safeClick(ham); } catch (_) { return null; }
      if (!await waitFor(smNow, 4000)) { logIt(st.cur || {}, 'nav', '', 'menu did not open; page shows: ' + labelsNow().slice(0, 200)); return null; }
    }
    logIt(st.cur || {}, 'nav', '', 'menu open' + ms(T));
    // 2. Site Map straight away (the menu search result was not clickable on his Opera; Site Map worked)
    const sm = smNow();
    if (sm) { logIt(st.cur || {}, 'nav', '', 'Site Map' + ms(T)); try { safeClick(sm); } catch (_) {} const hit = await waitFor(inHouseItem, 10000); if (hit) { logIt(st.cur || {}, 'nav', '', 'In House found in Site Map' + ms(T)); return hit; }
      const alpha = findExact('alphabetical', 'a,button,[role=tab],[role=button],li,span'); if (alpha) { try { safeClick(alpha); } catch (_) {} const h2 = await waitFor(inHouseItem, 5000); if (h2) return h2; } }
    logIt(st.cur || {}, 'nav', '', 'menu shows: ' + labelsNow());
    return null;
  }
  const roomBoxIs = i => { const b = roomBox(); return b === i; };
  // Opens the In House list on its own and waits for its Room box. Order: Back to In House link (when on a reservation/profile),
  // the hamburger search (proven), then Front Desk menu, then breadcrumb. The route that worked is tried first next time.
  async function ensureInHouse() {
    let last = 'start'; const T0 = Date.now();
    const done = how => { route = how; logIt(st.cur || {}, 'nav', '', 'In House open via ' + how + ms(T0)); return ''; };
    for (let round = 1; round <= 3; round++) {
      if (roomBox()) return '';
      const modify = findExact('modify search criteria', 'button,a,[role=button]');
      if (modify && /in house/i.test(document.body.innerText || '')) { last = 'expand'; try { safeClick(modify); } catch (_) {} if (await waitFor(roomBox, 3000)) return done('expand'); }
      const back = findExact('back to in house', 'a,button,[role=button],[role=link]');
      if (back && round === 1) { last = 'back'; logIt(st.cur || {}, 'nav', '', 'Back to In House ' + dsc(back)); try { safeClick(back); } catch (_) {} if (await waitFor(roomBox, 10000)) return done('back'); }
      const deep = /Manage (Profile|Reservation)/i.test(document.body.innerText || '');
      const order = round === 1 && route && route !== 'hamburger' && !deep ? [route, 'hamburger', 'front', 'crumb'] : ['hamburger', 'front', 'crumb'];
      let clicked = false;
      for (const r of [...new Set(order)]) {
        if (r === 'hamburger') { last = 'hamburger'; exclude = new Set(); const item = await viaHamburger(round); if (item) { try { safeClick(item); clicked = true; } catch (_) {} } }
        else if (r === 'front' && !deep && round === 1) {
          exclude = new Set(); const fd = findExact('front desk', 'a,button,[role=button],[role=link],[role=menuitem],[role=tab],li,span');
          if (fd) { last = 'front'; try { safeClick(fd); } catch (_) {} const item = await waitFor(inHouseItem, 1500); if (item) { try { safeClick(item); clicked = true; } catch (_) {} } }
        } else if (r === 'crumb' && !deep && round === 1) {
          const crumb = findExact('in house', 'a,[role=link]'); if (crumb) { last = 'breadcrumb'; try { safeClick(crumb); clicked = true; } catch (_) {} }
        }
        if (clicked) { logIt(st.cur || {}, 'nav', '', 'round ' + round + ': clicked In House via ' + r); await sleep(150); await waitFor(() => !busy(), 6000); if (await waitFor(roomBox, 15000)) return done(r); const d = dialogText(); if (d) return 'The In House list did not open: Opera shows a question ("' + d + '"). Answer it yourself, then press Next guest.'; clicked = false; }
      }
    }
    const where = (location.hash || location.pathname || '').slice(0, 50);
    return 'The In House list did not open (step: ' + last + '; page: ' + where + '). Open Front Desk > In House yourself, then press Next guest.';
  }
  function roomRows(item) {
    const want = words(item.name);
    return [...document.querySelectorAll('tr')].filter(vis).filter(tr => {
      const cells = [...tr.children].map(own);
      if (!cells.some(c => c && norm(c) === norm(item.room) && /^\d{3,4}$/.test(c.trim()))) return false;
      const rw = new Set(words(cells.join(" ")));
      return want.length > 0 && want.every(w => rw.has(w));
    });
  }
  function nameCands(item) {
    return [...document.querySelectorAll('a,[role=link],h1,h2,h3,span')].filter(vis).filter(n => n.children.length <= 2 && own(n).length < 90 && nameOk(item.name, own(n)) && !FORBIDDEN.test(own(n)));
  }
  function nameLink(item) {
    const c = nameCands(item);
    return c.find(n => n.closest('a,[role=link]')) ? c.find(n => n.closest('a,[role=link]')) : c[0] || null;
  }
  const resReady = () => /Reservation Overview|Manage Reservation/i.test(document.body.innerText || '') && !roomBox() && !busy() && hasText(/Overview/);
  const filtersNow = () => [...document.querySelectorAll('label[for]')].filter(vis).map(l => { const el = document.getElementById(l.htmlFor); const t = own(l); return el && /^(input|select)$/i.test(el.tagName) && el.value && !/name|contact|email|phone/i.test(t) ? t.slice(0, 18) + '=' + String(el.value).slice(0, 12) : ''; }).filter(Boolean).slice(0, 10).join(', ') || 'none set';
  const dsc = el => el ? '<' + el.tagName.toLowerCase() + (el.id ? '#' + String(el.id).slice(0, 28) : '') + '> ' + own(el).slice(0, 24) : 'none';
  const nv = (item, m) => logIt(item, 'nav', '', m);
  const IDTAGS = 'a,[role=link],[role=tab],[role=menuitem],[role=treeitem],[role=button],li,span,div,td';
  const findIdent = () => findExact('identification', IDTAGS);
  async function goToGuest(item) {
    if (!hasText(/Personal Details/) || !nameOnScreen(item.name)) {
      if (!roomBox()) { nv(item, 'no Room box, returning to In House'); const why = await ensureInHouse(); if (why) return why; }
      const sb = findExact('search', 'button,a,[role=button]'); if (!sb) return 'No Search button found. ' + 'Page shows: ' + labelsNow().slice(0, 150);
      let rows = null;
      for (const fmt of [String(item.room).replace(/\D/g, '').padStart(4, '0'), String(item.room).replace(/\D/g, '').replace(/^0+/, '')]) {
        let box = roomBox();
        if (!box) { const mod = findExact('modify search criteria', 'button,a,[role=button]'); if (mod) { nv(item, 'search panel collapsed, expanding'); try { safeClick(mod); } catch (_) {} } box = await waitFor(roomBox, 6000); }
        if (!box) return 'Room ' + item.room + ': the Room box disappeared. Page shows: ' + labelsNow().slice(0, 150);
        box.focus(); setNative(box, ''); box.dispatchEvent(new Event('input', { bubbles: true }));
        setNative(box, fmt); box.dispatchEvent(new Event('input', { bubbles: true })); box.dispatchEvent(new Event('change', { bubbles: true })); box.dispatchEvent(new Event('blur', { bubbles: true }));
        nv(item, 'typed Room ' + fmt.length + ' digits, pressing Search');
        safeClick(findExact('search', 'button,a,[role=button]') || sb);
        await sleep(300); await waitFor(() => !busy(), 8000);
        rows = await waitFor(() => { const r = roomRows(item); return r.length ? r : null; }, 4000);
        nv(item, 'rows found: ' + (rows ? rows.length : 0));
        if (rows) break;
      }
      if (!rows) { nv(item, 'no row; filters: ' + filtersNow());  return 'Room ' + item.room + ': not found in the In House list (checked out or not arrived yet?), skipped.'; }
      if (rows.length > 1) return 'Room ' + item.room + ': more than one row matches. Open it yourself.';
      const conf = [...rows[0].querySelectorAll('a,[role=link]')].find(a => vis(a) && /^\d{5,}$/.test(own(a)));
      if (!conf) return 'Room ' + item.room + ': no confirmation number link in the row.';
      nv(item, 'clicking Confirmation Number ' + dsc(conf).slice(0, 30)); safeClick(conf);
      if (!await waitFor(resReady, 30000)) { nv(item, 'reservation did not load; page shows: ' + labelsNow().slice(0, 200)); return 'Room ' + item.room + ': the reservation page did not load.'; }
      nv(item, 'reservation page loaded');
      const nl = await waitFor(() => nameLink(item), 8000); if (!nl) { nv(item, 'reservation page shows: ' + labelsNow().slice(0, 200)); return 'Room ' + item.room + ': the reservation did not open or the guest name was not found.'; }
      nv(item, 'name candidates: ' + nameCands(item).slice(0, 4).map(dsc).join(' ; ').slice(0, 160)); nv(item, 'clicking guest name ' + dsc(nl).slice(0, 20)); safeClick(nl);
      await sleep(300);
      if (!await waitFor(() => !busy() && /Manage Profile|Personal Details/i.test(document.body.innerText || '') && (findIdent() || hasText(/Personal Details/)), 30000)) { nv(item, 'profile page shows: ' + labelsNow().slice(0, 250)); return 'Room ' + item.room + ': the profile did not open.'; }
      nv(item, 'profile opened');
    }
    if (!hasText(/Personal Details/)) {
      const idm = findIdent(); if (!idm) { nv(item, 'no Identification item; page shows: ' + labelsNow().slice(0, 250)); return 'The Identification page was not found.'; }
      nv(item, 'clicking Identification ' + dsc(idm).slice(0, 30)); safeClick(idm);
      if (!await waitFor(() => hasText(/Personal Details/), 20000)) return 'The Identification page did not open.';
    }
    await sleep(200);
    return '';
  }
  const CODE_V = 'v640';
  async function autoRun(from) {
    if (st.auto || !st.plan) return; st.auto = true; st.stop = false; setBtns();
    logIt({}, 'version', '', 'fixer code ' + CODE_V + ', helper ' + (window.__hoFxVer || 'unknown'));
    try {
      const items = st.plan.items;
      for (st.idx = from; st.idx < items.length; st.idx++) {
        if (st.stop) { say('Stopped.', false); return; }
        const it = items[st.idx]; st.cur = it; renderList();
        say('Room ' + it.room + ' (' + (st.idx + 1) + ' of ' + items.length + '): opening the guest…', false);
        const TG = Date.now();
        const why = await goToGuest(it);
        if (why) { logIt(it, 'guest', '', (/not found in the In House/.test(why) ? 'SKIPPED not in list' : 'FAILED ' + why.slice(0, 70)) + ' (' + (Date.now() - TG) + ' ms)'); say(why, true); if (/In House list did not open/.test(why)) return; continue; }
        await fill(it);
        logIt(it, 'guest', '', 'DONE ' + (st.dry ? '(dry run) ' : '') + (Date.now() - TG) + ' ms');
        if (!st.dry) { st.paused = true; say('Room ' + it.room + ' is filled. Check it, press Save in Opera, then press Next guest.', false); return; }
      }
      say('Done. ' + (st.dry ? 'Dry run only: nothing was typed.' : 'All rooms visited.'), false);
    } finally { st.auto = false; setBtns(); }
  }

  // ── the small window (Shadow DOM, so Opera's styles cannot touch it) ──
  const UI = {};
  const host = document.createElement('div'); host.setAttribute('data-hotelops', 'fixer');
  host.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:2147483000;width:330px;font:12px system-ui,sans-serif';
  const sh = host.attachShadow({ mode: 'closed' });
  sh.innerHTML = '<style>*{box-sizing:border-box}.w{background:#fff;color:#1d2433;border:1px solid #c9d1e0;border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.25);overflow:hidden}.h{background:#243b6b;color:#fff;padding:8px 10px;display:flex;justify-content:space-between;cursor:move}.b{padding:10px;max-height:60vh;overflow:auto}textarea{width:100%;height:46px;font:11px monospace}button{font:inherit;padding:5px 9px;border-radius:7px;border:1px solid #9aa6bf;background:#f3f6fc;cursor:pointer}button.p{background:#243b6b;color:#fff;border-color:#243b6b}.r{border:1px solid #dde3ef;border-radius:8px;padding:6px 8px;margin:6px 0;cursor:pointer}.r.on{border-color:#243b6b;background:#eef3ff}small{color:#5b6680}.m{margin:6px 0;min-height:16px}.g{font:10px monospace;color:#5b6680;max-height:80px;overflow:auto;white-space:pre-wrap}</style>' +
    '<div class="w"><div class="h"><b>Opera profile fixer</b><span id="x" style="cursor:pointer">–</span></div><div class="b" id="body"><small>Fills empty fields only. Never saves: you press Save.</small>' +
    '<textarea id="plan" placeholder="Paste the plan from HotelOps"></textarea><div><button id="load" class="p">Load plan</button> <label><input type="checkbox" id="dry" checked> Dry run</label></div><div class="m" id="msg"></div><div id="list"></div><div style="margin-top:6px"><button id="startb" class="p" disabled>▶ Start (all guests)</button> <button id="nextb" class="p" style="display:none">Next guest ▶</button> <button id="stopb">Stop</button></div><details style="margin-top:6px"><summary><small>One room by hand</small></summary><button id="fillb" class="p" disabled>Check &amp; fill the selected room</button></details><div style="margin-top:8px"><small>Change log</small> <button id="copyl">Copy log</button><div class="g" id="log"></div></div></div></div>';
  UI.msg = sh.getElementById('msg');
  function renderList() {
    const l = sh.getElementById('list'); l.textContent = '';
    if (!st.plan) return;
    st.plan.items.forEach(it => {
      const d = document.createElement('div'); d.className = 'r' + (st.cur === it ? ' on' : '');
      d.innerHTML = '<b></b> <small></small>'; d.firstChild.textContent = 'Room ' + it.room;
      d.lastChild.textContent = it.fields.map(f => FIELDS[f.field] + ': ' + (f.field === 'idNumber' ? last4(f.value) : f.value)).join(' · ');
      d.onclick = () => { st.cur = it; renderList(); sh.getElementById('fillb').disabled = false; say('Open room ' + it.room + '\'s guest profile in Opera, then press the button.', false); };
      l.appendChild(d);
    });
  }
  function renderLog() { sh.getElementById('log').textContent = st.log.slice(-12).map(e => e.t.slice(11, 19) + ' r' + e.room + ' ' + e.field + ' ' + e.to + ' ' + e.result + (e.dry ? ' (dry)' : '')).join('\n'); }
  sh.getElementById('load').onclick = () => { try { st.plan = decode(sh.getElementById('plan').value); st.cur = null; renderList(); setBtns(); say('Plan loaded: ' + st.plan.items.length + ' room(s). Pick a room.', false); } catch (e) { say(e.message, true); } };
  sh.getElementById('dry').onchange = e => { st.dry = e.target.checked; say(st.dry ? 'Dry run: nothing will be typed.' : 'Dry run off: it will fill empty fields (never Save).', false); };
  function setBtns() { const sb = sh.getElementById('startb'), nb = sh.getElementById('nextb'); if (!sb) return; sb.disabled = !st.plan || st.auto; nb.style.display = st.paused ? '' : 'none'; nb.disabled = st.auto; }
  sh.getElementById('startb').onclick = () => { st.paused = false; autoRun(0); };
  sh.getElementById('nextb').onclick = () => { st.paused = false; autoRun(st.idx + 1); };
  sh.getElementById('stopb').onclick = () => { st.stop = true; say('Stopping after this step.', false); };
  sh.getElementById('fillb').onclick = () => { if (st.cur) fill(st.cur); };
  sh.getElementById('copyl').onclick = () => { const t = st.log.map(e => JSON.stringify(e)).join('\n'); try { navigator.clipboard.writeText(t); say('Log copied. Paste it in HotelOps → Fix in Opera → Save log.', false); } catch (_) { say('Could not copy the log.', true); } };
  sh.getElementById('x').onclick = () => { const b = sh.getElementById('body'); b.style.display = b.style.display === 'none' ? '' : 'none'; };
  document.documentElement.appendChild(host); renderLog();
  // helper mode (the Chrome extension sets __hoFixerLazy): the window stays hidden until HotelOps hands it a list
  if (window.__hoFixerLazy) host.style.display = 'none';
  window.__hoFixer = { open() { host.style.display = ''; }, setHook(f) { st.hook = f; }, loadCode(code) { st.plan = decode(code); st.cur = null; st.paused = false; renderList(); setBtns(); host.style.display = ''; sh.getElementById('plan').value = ''; say('List loaded: ' + st.plan.items.length + ' room(s). Dry run is on. Press Start.', false); return st.plan.items.length; }, _test: { decode, check, fill, st, nameOk, profileName, safeClick, setPlan(p) { st.plan = p; renderList(); setBtns(); }, autoRun, goToGuest, setDry(v) { st.dry = v; } } };
})();
