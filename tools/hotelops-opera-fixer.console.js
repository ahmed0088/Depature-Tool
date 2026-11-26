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
  const waitFor = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 20000)) { let r = null; try { r = fn(); } catch (_) {} if (r) return r; await sleep(300); } return null; };
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
  const inHouseItem = () => findExact('in house', 'a,[role=menuitem],[role=option],[role=link],li,span')
    || [...document.querySelectorAll('a,[role=option],[role=menuitem],li')].find(n => vis(n) && n.children.length <= 3 && /^in house\b/.test(fold(own(n))) && own(n).length < 30 && !/arrival|departure|report/.test(fold(own(n)))) || null;
  // Proven manual path: hamburger > search box (type "In House") or Site Map > click "In House". Returns the element to click, or null.
  async function viaHamburger(round) {
    const cand = [...document.querySelectorAll('a,button,[role=button],oj-button')].filter(n => { if (!vis(n)) return false; const r = n.getBoundingClientRect(); return r.left < 140 && r.top < 100; });
    const ham = cand.find(n => /menu|navigat|hamburger/i.test((n.getAttribute('aria-label') || n.title || n.id || '') + ' ' + n.className)) || cand[0];
    logIt(st.cur || {}, 'nav', '', 'round ' + round + ': hamburger ' + (ham ? '<' + ham.tagName.toLowerCase() + (ham.id ? '#' + String(ham.id).slice(0, 25) : '') + '> ' + (ham.getAttribute('aria-label') || '').slice(0, 25) : 'not found'));
    if (!ham) return null;
    try { safeClick(ham); } catch (_) { return null; }
    await sleep(1200);
    const sbox = await waitFor(() => [...document.querySelectorAll('input')].find(i => vis(i) && /search/i.test((i.getAttribute('aria-label') || '') + ' ' + (i.placeholder || '') + ' ' + (i.id || ''))), 5000);
    if (sbox) { setVal(sbox, 'In House'); logIt(st.cur || {}, 'nav', '', 'round ' + round + ': typed In House in the menu search'); const hit = await waitFor(inHouseItem, 9000); if (hit) return hit; }
    const sm = findExact('site map', 'a,button,[role=button],[role=menuitem],li,span');
    if (sm) { logIt(st.cur || {}, 'nav', '', 'round ' + round + ': Site Map'); try { safeClick(sm); } catch (_) {} const hit = await waitFor(inHouseItem, 10000); if (hit) return hit;
      const alpha = findExact('alphabetical', 'a,button,[role=tab],[role=button],li,span'); if (alpha) { try { safeClick(alpha); } catch (_) {} return await waitFor(inHouseItem, 6000); } }
    logIt(st.cur || {}, 'nav', '', 'menu shows: ' + labelsNow());
    return null;
  }
  // Opens the In House list on its own and waits for its Room box. Tries: already there, the breadcrumb, Front Desk menu > In House,
  // expanding the collapsed Search panel. Up to 3 rounds. Returns '' when ready, else a message that names the step that failed.
  async function ensureInHouse() {
    let last = 'start';
    for (let round = 1; round <= 3; round++) {
      if (roomBox()) return '';
      const modify = findExact('modify search criteria', 'button,a,[role=button]');
      if (modify && /in house/i.test(document.body.innerText || '')) { last = 'expand'; try { safeClick(modify); } catch (_) {} if (await waitFor(roomBox, 4000)) return ''; }
      const crumb = findExact('in house', 'a,[role=link]');
      if (crumb) { last = 'breadcrumb'; logIt(st.cur || {}, 'nav', '', 'round ' + round + ': breadcrumb In House <' + crumb.tagName.toLowerCase() + (crumb.id ? '#' + String(crumb.id).slice(0, 25) : '') + '>'); try { safeClick(crumb); } catch (_) {} }
      else {
        let item = findExact('in house', 'a,[role=menuitem],[role=link],li,span');
        if (!item) {
          const fd = findExact('front desk', 'a,button,[role=button],[role=link],[role=menuitem],[role=tab],li,span');
          if (fd) { last = 'menu:Front Desk'; logIt(st.cur || {}, 'nav', '', 'round ' + round + ': opening Front Desk menu'); try { safeClick(fd); } catch (_) {}
            item = await waitFor(inHouseItem, 3500); }
          if (!item) { last = 'menu:In House not shown, hamburger'; item = await viaHamburger(round); }
          if (!item) { last = 'hamburger search found no In House'; logIt(st.cur || {}, 'nav', '', 'page shows: ' + labelsNow()); continue; }
        }
        last = 'menu:In House'; logIt(st.cur || {}, 'nav', '', 'round ' + round + ': menu In House'); try { safeClick(item); } catch (_) {}
      }
      await sleep(1200);
      for (let w = 0; w < 25 && busy(); w++) await sleep(400);
      if (await waitFor(roomBox, 20000)) return '';
      const d = dialogText(); if (d) return 'The In House list did not open: Opera shows a question ("' + d + '"). Answer it yourself, then press Next guest.';
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
  function nameLink(item) {
    return [...document.querySelectorAll('a,[role=link],h1,h2,h3,span')].filter(vis).find(n => n.children.length <= 2 && own(n).length < 90 && nameOk(item.name, own(n)) && !FORBIDDEN.test(own(n)));
  }
  async function goToGuest(item) {
    if (!hasText(/Personal Details/) || !nameOnScreen(item.name)) {
      if (!roomBox()) { const why = await ensureInHouse(); if (why) return why; }
      const box = roomBox(); box.focus(); setNative(box, String(item.room).replace(/\D/g, '').padStart(4, '0')); box.dispatchEvent(new Event('input', { bubbles: true })); box.dispatchEvent(new Event('change', { bubbles: true })); box.dispatchEvent(new Event('blur', { bubbles: true }));
      const sb = findExact('search', 'button,a,[role=button]'); if (!sb) return 'No Search button found.';
      safeClick(sb);
      const rows = await waitFor(() => { const r = roomRows(item); return r.length ? r : null; }, 15000);
      if (!rows) return 'Room ' + item.room + ': no row with this guest\'s name was found.';
      if (rows.length > 1) return 'Room ' + item.room + ': more than one row matches. Open it yourself.';
      const conf = [...rows[0].querySelectorAll('a,[role=link]')].find(a => vis(a) && /^\d{5,}$/.test(own(a)));
      if (!conf) return 'Room ' + item.room + ': no confirmation number link in the row.';
      safeClick(conf);
      const nl = await waitFor(() => nameLink(item), 20000); if (!nl) return 'Room ' + item.room + ': the reservation did not open or the guest name was not found.';
      safeClick(nl);
      if (!await waitFor(() => hasText(/Identification/) && (findExact('identification', 'a,[role=link],[role=tab],[role=menuitem],li') || hasText(/Personal Details/)), 20000)) return 'Room ' + item.room + ': the profile did not open.';
    }
    if (!hasText(/Personal Details/)) {
      const idm = findExact('identification', 'a,[role=link],[role=tab],[role=menuitem],li'); if (!idm) return 'The Identification page was not found.';
      safeClick(idm);
      if (!await waitFor(() => hasText(/Personal Details/), 20000)) return 'The Identification page did not open.';
    }
    await sleep(600);
    return '';
  }
  async function autoRun(from) {
    if (st.auto || !st.plan) return; st.auto = true; st.stop = false; setBtns();
    try {
      const items = st.plan.items;
      for (st.idx = from; st.idx < items.length; st.idx++) {
        if (st.stop) { say('Stopped.', false); return; }
        const it = items[st.idx]; st.cur = it; renderList();
        say('Room ' + it.room + ' (' + (st.idx + 1) + ' of ' + items.length + '): opening the guest…', false);
        const why = await goToGuest(it);
        if (why) { logIt(it, 'nav', '', 'could not open: ' + why.slice(0, 60)); say(why, true); if (/In House/.test(why)) return; continue; }
        await fill(it);
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
