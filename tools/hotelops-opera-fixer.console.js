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
  // Adds the ID document of a guest who has none (Edit is already open): New > ID Type > ID Number > Primary ticked. Only here is "New" pressed, and never when a document exists.
  async function addIdDocument(item, typeRow, numRow, res) {
    if (/\((primary)\)/i.test(document.body.innerText || '') || /\bPrimary\b[^\n]*\n?[^\n]*\b(PAS|IDC|RES|DRL|GCC ID)\b/.test(document.body.innerText || '')) { res.bad.push('a document already exists, not adding a second one'); logIt(item, 'idType', typeRow ? typeRow.f.value : '', 'not adding: a document already exists'); return; }
    const idPanel = n => { for (let p = n; p; p = p.parentElement) if (/Identification/.test(own(p).slice(0, 400)) && !/Scan ID/.test('')) return true; return false; };
    const nb = [...document.querySelectorAll('button,a,[role=button],oj-button')].filter(b => vis(b) && /^new$/i.test((b.getAttribute('aria-label') || own(b)).trim()));
    const nbtn = nb.find(idPanel) || nb[0];
    if (!nbtn) { res.bad.push('no New button for the ID document'); logIt(item, 'idType', '', 'no New button found'); return; }
    logIt(item, 'idType', '', 'no ID document: pressing New ' + dsc(nbtn)); nbtn.click();   // the one deliberate press of New; nothing is saved
    const tb = await waitFor(() => { const r = readField('idType'); return r && r.editable && isEmpty(r.value) ? r : null; }, 8000);
    if (!tb) { res.bad.push('the new ID row did not show an ID Type box'); logIt(item, 'idType', '', 'new row: no ID Type box; page shows: ' + labelsNow().slice(0, 160)); return; }
    for (const r of [typeRow, numRow].filter(Boolean)) {
      const cur = r.f.field === 'idType' ? tb : await waitFor(() => { const x = readField('idNumber'); return x && x.editable ? x : null; }, 5000);
      if (!cur) { res.bad.push('ID Number box not found on the new row'); logIt(item, r.f.field, r.f.value, 'new row: box not found'); continue; }
      const picked = await type(cur.el, r.f.value); const back = readField(r.f.field), shown = back ? String(back.value) : '';
      if (picked && fold(shown).startsWith(fold(r.f.value).slice(0, 4))) { cur.el.style.outline = '3px solid #1b9c5a'; res.done++; logIt(item, r.f.field, r.f.value, 'filled on the new row, not saved'); }
      else { res.bad.push(FIELDS[r.f.field] + ' not accepted'); logIt(item, r.f.field, r.f.value, 'could not fill on the new row: type it yourself'); }
    }
    const pl = [...document.querySelectorAll('label')].find(l => vis(l) && fold(own(l)) === 'primary'); const cb = pl && (pl.htmlFor ? document.getElementById(pl.htmlFor) : pl.parentElement.querySelector('input[type=checkbox]'));
    if (cb && cb.type === 'checkbox' && !cb.checked) { cb.click(); logIt(item, 'primary', '', 'ticked Primary'); }
  }
  async function fill(item) {
    const res = { done: 0, bad: [], note: '' };
    if (st.busy) { res.bad.push('busy'); return res; } st.busy = true;
    try {
      let c = check(item);
      if (!c.ok) { say(c.why, true); item.fields.forEach(f => logIt(item, f.field, f.value, 'refused: wrong or no profile')); res.bad.push('wrong or no profile'); return res; }
      // a masked ID number cannot be told from a filled one: with the user's OK, open Show Masked Information once and look again
      const idRow = c.rows.find(r => r.f.field === 'idNumber' && r.found && isMaskedVal(r.current));
      if (idRow) {
        if (st.dry) logIt(item, 'idNumber', idRow.f.value, 'dry run: would open Show Masked Information to check the ID number');
        else if (await revealMasked(item)) c = check(item);
      }
      let todo = c.rows.filter(r => r.found && r.empty);
      // an ID number is only typed together with its ID type; Opera keeps masked numbers non-editable and they count as filled
      c.rows.filter(r => !r.found).forEach(r => { res.bad.push(FIELDS[r.f.field] + ' not found on screen'); logIt(item, r.f.field, r.f.value, 'field not found on screen'); });
      c.rows.filter(r => r.found && !r.empty).forEach(r => logIt(item, r.f.field, r.f.value, 'skipped: already has a value'));
      if (!todo.length) { say(res.bad.length ? 'Could not find: ' + res.bad.join(', ') : 'Nothing to fill: every approved field is already set.', !!res.bad.length); return res; }
      if (st.dry) { todo.forEach(r => logIt(item, r.f.field, r.f.value, 'dry run: would fill')); say('Dry run: would fill ' + todo.map(r => FIELDS[r.f.field]).join(', ') + '. Untick Dry run to fill.', false); res.note = 'would fill ' + todo.length; return res; }
      if (todo.some(r => !r.editable)) {
        const btns = findEditButtons();
        if (!btns.length) { say('The fields are read-only and no Edit button was found. Open Edit yourself, then press Fill again.', true); res.bad.push('no Edit button'); return res; }
        // the Edit of the panel that holds the first needed field (nearest ancestor that contains one)
        const first = readField(todo[0].f.field); let scopeBtn = null;
        for (let p = first && first.label ? first.label.parentElement : null; p && !scopeBtn; p = p.parentElement) { const inside = btns.filter(b => p.contains(b)); if (inside.length) scopeBtn = inside[0]; }
        if (!scopeBtn) scopeBtn = btns[0];
        safeClick(scopeBtn); const tE = Date.now(); await waitFor(() => !busy() && (todo.some(r => { const x = readField(r.f.field); return x && x.editable; }) || [...document.querySelectorAll('button,a,[role=button],oj-button')].some(b => vis(b) && /^save$/i.test((b.getAttribute('aria-label') || own(b)).trim()))), 12000); logIt(item, 'edit', '', 'edit mode ready after ' + (Date.now() - tE) + ' ms');
      }
      const done = [], pendingId = [];
      for (const r of todo) {
        const cur = readField(r.f.field);
        if (!cur || !cur.editable) { if (r.f.field === 'idType' || r.f.field === 'idNumber') { pendingId.push(r); continue; } res.bad.push(FIELDS[r.f.field] + ' not editable'); logIt(item, r.f.field, r.f.value, 'field not editable after Edit'); continue; }
        if (!isEmpty(cur.value)) { logIt(item, r.f.field, r.f.value, 'skipped: filled meanwhile'); continue; }
        const picked = await type(cur.el, r.f.value);
        const back = readField(r.f.field), shownVal = back ? String(back.value) : '';
        const good = picked && fold(shownVal).startsWith(fold(r.f.value));
        if (good) { cur.el.style.outline = '3px solid #1b9c5a'; cur.el.style.outlineOffset = '2px'; done.push(FIELDS[r.f.field]); res.done++; logIt(item, r.f.field, r.f.value, 'filled, not saved'); }
        else { res.bad.push(FIELDS[r.f.field] + ' not accepted'); logIt(item, r.f.field, r.f.value, 'could not fill: type it yourself'); }
      }
      if (pendingId.length) {
        const n0 = res.done; await addIdDocument(item, pendingId.find(r => r.f.field === 'idType'), pendingId.find(r => r.f.field === 'idNumber'), res);
        for (let i = n0; i < res.done; i++) done.push('ID');
      }
      say(done.length ? 'Filled ' + done.join(', ') + '.' + (res.bad.length ? ' Problem: ' + res.bad.join(', ') + '.' : '') + ' Check them, then press Save in Opera yourself.' : 'Could not fill (' + (res.bad.join(', ') || 'nothing') + '). Use the values shown in the list and type them yourself.', !done.length);
    } catch (e) { say(String(e.message || e), true); res.bad.push(String(e.message || e).slice(0, 60)); }
    finally { st.busy = false; }
    return res;
  }

  // ── auto mode: opens each guest's Identification page by itself (In House > room > reservation > guest name > Identification) ──
  // Only read-style clicks: breadcrumb "In House", the Search button, a confirmation-number link, the guest name, the "Identification" menu item.
  // The same hard refusal list applies, and the fill step never presses Save: he does.
  const norm = r => String(r || '').replace(/\D/g, '').replace(/^0+/, '');
  const waitFor = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 20000)) { let r = null; try { r = fn(); } catch (_) {} if (r) return r; await sleep(120); } return null; };
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
      if (!await waitFor(smNow, 12000)) { logIt(st.cur || {}, 'nav', '', 'menu did not open; page shows: ' + labelsNow().slice(0, 200)); return null; }
    }
    logIt(st.cur || {}, 'nav', '', 'menu open' + ms(T));
    // 2. Site Map straight away (the menu search result was not clickable on his Opera; Site Map worked)
    const sm = smNow();
    if (sm) { logIt(st.cur || {}, 'nav', '', 'Site Map' + ms(T)); try { safeClick(sm); } catch (_) {} const hit = await waitFor(inHouseItem, 20000); if (hit) { logIt(st.cur || {}, 'nav', '', 'In House found in Site Map' + ms(T)); return hit; }
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
      let back = findExact('back to in house', 'a,button,[role=button],[role=link]');
      if (!back || !enabled(back)) {   // on a profile: Back to Manage Reservation first (the breadcrumbs are dead there), then Back to In House
        const bm = findExact('back to manage reservation', 'a,button,[role=button],[role=link]');
        if (bm && enabled(bm) && round === 1) { logIt(st.cur || {}, 'nav', '', 'Back to Manage Reservation ' + dsc(bm)); try { safeClick(bm); } catch (_) {} back = await waitFor(() => { const x = findExact('back to in house', 'a,button,[role=button],[role=link]'); return x && enabled(x) ? x : null; }, 25000); }
      }
      if (back && round === 1) { last = 'back'; logIt(st.cur || {}, 'nav', '', 'Back to In House ' + dsc(back)); try { safeClick(back); } catch (_) {} if (await waitFor(roomBox, 25000)) return done('back'); }
      const deep = /Manage (Profile|Reservation)/i.test(document.body.innerText || '');
      const order = round === 1 && route && route !== 'hamburger' && !deep ? [route, 'hamburger', 'front', 'crumb'] : ['hamburger', 'front', 'crumb'];
      let clicked = false;
      for (const r of [...new Set(order)]) {
        if (r === 'hamburger') { last = 'hamburger'; exclude = new Set(); const item = await viaHamburger(round); if (item) { try { safeClick(item); clicked = true; } catch (_) {} } }
        else if (r === 'front' && !deep && round === 1) {
          exclude = new Set(); const fd = findExact('front desk', 'a,button,[role=button],[role=link],[role=menuitem],[role=tab],li,span');
          if (fd) { last = 'front'; try { safeClick(fd); } catch (_) {} const item = await waitFor(inHouseItem, 1500); if (item) { try { safeClick(item); clicked = true; } catch (_) {} } }
        } else if (r === 'crumb' && !deep && round === 1) {
          const crumb = findExact('in house', 'a,[role=link]'); if (crumb && enabled(crumb)) { last = 'breadcrumb'; try { safeClick(crumb); clicked = true; } catch (_) {} }
        }
        if (clicked) { logIt(st.cur || {}, 'nav', '', 'round ' + round + ': clicked In House via ' + r); await sleep(150); await waitFor(() => !busy(), 6000); if (await waitFor(roomBox, 25000)) return done(r); const d = dialogText(); if (d) return 'The In House list did not open: Opera shows a question ("' + d + '"). Answer it yourself, then press Next guest.'; clicked = false; }
      }
    }
    const where = (location.hash || location.pathname || '').slice(0, 50);
    return 'The In House list did not open (step: ' + last + '; page: ' + where + '). Open Front Desk > In House yourself, then press Next guest.';
  }
  // The In House grid is nested tables: take the innermost <tr> that holds the room cell (textContent of an outer row holds every inner row)
  const roomCellOf = (tr, room) => [...tr.querySelectorAll('td,th,[role=gridcell],[role=cell]')].some(c => !c.querySelector('td,th') && /^\d{3,4}$/.test(own(c)) && norm(own(c)) === norm(room));
  function roomRows(item, roomOnly) {
    const want = words(item.name);
    const cands = [...document.querySelectorAll('tr')].filter(vis).filter(tr => roomCellOf(tr, item.room));
    const inner = cands.filter(tr => !cands.some(o => o !== tr && tr.contains(o)));
    return inner.filter(tr => { if (roomOnly) return true; const rw = new Set(words([...tr.querySelectorAll('td,th,[role=gridcell]')].filter(c => !c.querySelector('td,th')).map(own).join(' '))); return want.length > 0 && want.every(w => rw.has(w)); });
  }
  // the Confirmation Number link of one result row: id ends ":l1" or digits-only text; the link must sit in a row that has the room cell
  function confLinks(item, row) {
    const ok = a => vis(a) && !/AFDisabled/.test(a.className || '') && (/:l1$/.test(a.id || '') || /^\d{5,}$/.test(own(a)));
    const inRow = row ? [...row.querySelectorAll('a,[role=link]')].filter(ok) : [];
    if (inRow.length) return inRow;
    return [...document.querySelectorAll('a,[role=link]')].filter(ok).filter(a => { const tr = a.closest('tr'); return tr && roomCellOf(tr, item.room); });
  }
  const enabled = el => !!el && !/AFDisabled/.test(el.className || '') && !el.closest('.p_AFDisabled');
  const noData = () => /no data|no results|no records|nothing to display/i.test(document.body.innerText || '');
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
      let rows = null, byRoom = false;
      for (const fmt of [String(item.room).replace(/\D/g, '').padStart(4, '0'), String(item.room).replace(/\D/g, '').replace(/^0+/, '')]) {
        let box = roomBox();
        if (!box) { const mod = findExact('modify search criteria', 'button,a,[role=button]'); if (mod) { nv(item, 'search panel collapsed, expanding'); try { safeClick(mod); } catch (_) {} } box = await waitFor(roomBox, 15000); }
        if (!box) return 'Room ' + item.room + ': the Room box disappeared. Page shows: ' + labelsNow().slice(0, 150);
        box.focus(); setNative(box, ''); box.dispatchEvent(new Event('input', { bubbles: true }));
        setNative(box, fmt); box.dispatchEvent(new Event('input', { bubbles: true })); box.dispatchEvent(new Event('change', { bubbles: true })); box.dispatchEvent(new Event('blur', { bubbles: true }));
        nv(item, 'typed Room ' + fmt.length + ' digits, pressing Search');
        safeClick(findExact('search', 'button,a,[role=button]') || sb);
        // wait on the real state: results arrive late on some rooms. Act the instant the row shows; give up only after the page has been idle with no row (or says no data) for a while, cap 25 s
        const TS = Date.now(); let idleSince = 0, sawBusy = false, roomOnlyAt = 0;
        rows = await waitFor(() => {
          const b = busy(); if (b) { sawBusy = true; idleSince = 0; return null; }
          const r = roomRows(item); if (r.length) return r;
          if (!idleSince) idleSince = Date.now();
          if (roomRows(item, true).length) { if (!roomOnlyAt) roomOnlyAt = Date.now(); if (Date.now() - roomOnlyAt > 1200 && roomRows(item, true).some(tr => confLinks(item, tr).length)) return 'room'; } else roomOnlyAt = 0;
          if (Date.now() - idleSince > (sawBusy ? 2000 : 3500) && (noData() || Date.now() - idleSince > 5000)) return 'none';
          return null;
        }, 25000);
        const waited = Date.now() - TS;
        if (rows === 'none' || rows === null) rows = null; 
        const roomMode = rows === 'room'; if (roomMode) rows = null;
        nv(item, 'rows found: ' + (rows ? rows.length : 0) + ' after ' + waited + ' ms' + (sawBusy ? '' : ' (no spinner seen)'));
        if (!rows) {
          const ro = roomRows(item, true); const roo = ro.length ? ro : null;
          nv(item, 'rows by room only: ' + (roo ? roo.length : 0));
          if (roo) { rows = roo; byRoom = true; }
          else { const all = [...document.querySelectorAll('tr')].filter(vis).length; nv(item, 'table rows on screen: ' + all + (noData() ? ', page says no data' : '') + '; links: ' + [...document.querySelectorAll('a')].filter(vis).filter(a => /^\d{5,}$/.test(own(a))).slice(0, 4).map(dsc).join(' ; ')); }
        }
        if (rows) break;
      }
      if (!rows) { nv(item, 'no row; filters: ' + filtersNow());  return 'Room ' + item.room + ': not found in the In House list (checked out or not arrived yet?), skipped.'; }
      const tryN = item._try || 0;
      if (rows.length > 1 && !byRoom) return 'Room ' + item.room + ': more than one row matches. Open it yourself.';
      if (tryN >= rows.length) return 'Room ' + item.room + ': reservation found but this guest\'s name is not on it.';
      const cl = confLinks(item, rows[tryN]); const conf = cl[0] || (byRoom ? confLinks(item, null)[tryN] : null);
      if (!conf) nv(item, 'row has no confirmation link; row ids: ' + [...rows[tryN].querySelectorAll('a')].slice(0, 4).map(dsc).join(' ; '));
      if (!conf) return 'Room ' + item.room + ': no confirmation number link in the row.';
      nv(item, 'clicking Confirmation Number ' + dsc(conf).slice(0, 30)); safeClick(conf);
      if (!await waitFor(resReady, 40000)) { nv(item, 'reservation did not load; page shows: ' + labelsNow().slice(0, 200)); return 'Room ' + item.room + ': the reservation page did not load.'; }
      nv(item, 'reservation page loaded');
      const nl = await waitFor(() => nameLink(item), 20000);
      if (!nl && byRoom && tryN + 1 < rows.length) { nv(item, 'name not on reservation ' + (tryN + 1) + ' of ' + rows.length + ' (shared room), trying the next'); item._try = tryN + 1; const w = await ensureInHouse(); if (w) return w; const r2 = await goToGuest(item); item._try = 0; return r2; }
      if (!nl) { item._try = 0; nv(item, 'reservation page shows: ' + labelsNow().slice(0, 200)); return 'Room ' + item.room + ': the reservation did not open or the guest name was not found.'; }
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
  // Save the profile after filling (only called outside dry run): press Save, wait, read any dialog, re-read the fields
  async function saveProfile(item) {
    const btn = [...document.querySelectorAll('button,a,[role=button],oj-button')].find(b => vis(b) && /^save$/i.test((b.getAttribute('aria-label') || own(b)).trim()));
    if (!btn) return { ok: false, why: 'no Save button found' };
    logIt(item, 'save', '', 'pressing Save ' + dsc(btn)); btn.click();   // the one deliberate Save, profile fields only
    {
      const tS = Date.now(); let sawBusy = false, idle = 0;
      const dlgNow = () => [...document.querySelectorAll('[role=dialog],[role=alertdialog],oj-dialog,.oj-dialog')].some(vis);
      const saveGone = () => !btn.isConnected || !vis(btn);
      await waitFor(() => { if (busy()) { sawBusy = true; idle = 0; return null; } if (dlgNow() || saveGone()) return true; if (!idle) idle = Date.now(); return sawBusy && Date.now() - idle > 1000 ? true : (Date.now() - idle > 6000 ? true : null); }, 25000);
      logIt(item, 'save', '', 'save settled after ' + (Date.now() - tS) + ' ms'); await sleep(200);
    }
    const dlg = [...document.querySelectorAll('[role=dialog],[role=alertdialog],oj-dialog,.oj-dialog,[class*=messages],[class*=error-message]')].filter(vis).map(own).join(' ').replace(/\s+/g, ' ').trim();
    if (dlg) { logIt(item, 'save', '', 'Opera message: ' + dlg.slice(0, 200)); return { ok: false, why: dlg, dialog: true }; }
    const miss = [];
    for (const f of item.fields) { if (!f.value) continue; const r = readField(f.field); if (!r) { miss.push(FIELDS[f.field] + ' not visible'); continue; } if (f.field === 'idNumber') { if (isEmpty(r.value)) miss.push('ID number empty'); } else if (!fold(String(r.value)).startsWith(fold(f.value).slice(0, 4))) miss.push(FIELDS[f.field] + ' differs'); }
    if (miss.length) return { ok: false, why: 'saved but could not confirm: ' + miss.join(', ') };
    return { ok: true, why: '' };
  }
  const CODE_V = 'v645';
  async function autoRun(from) {
    if (st.auto || !st.plan) return; st.auto = true; st.stop = false; setBtns();
    logIt({}, 'version', '', 'fixer code ' + CODE_V + ', helper ' + (window.__hoFxVer || 'unknown'));
    try {
      const items = st.plan.items, seen = new Set(), summ = [];
      for (st.idx = from; st.idx < items.length; st.idx++) {
        if (st.stop) { say('Stopped.', false); return; }
        const it = items[st.idx]; st.cur = it; renderList();
        const key = norm(it.room) + '|' + fold(it.name); if (seen.has(key)) { logIt(it, 'guest', '', 'SKIPPED already done in this run'); summ.push([it.room, 'skipped', 'duplicate']); continue; } seen.add(key);
        say('Room ' + it.room + ' (' + (st.idx + 1) + ' of ' + items.length + '): opening the guest…', false);
        const TG = Date.now();
        const why = await goToGuest(it);
        if (why) { logIt(it, 'guest', '', (/not found in the In House/.test(why) ? 'SKIPPED not in list' : 'FAILED ' + why.slice(0, 70)) + ' (' + (Date.now() - TG) + ' ms)'); summ.push([it.room, /not found in the In House/.test(why) ? 'skipped' : 'failed', why.slice(0, 60)]); say(why, true); if (/In House list did not open/.test(why)) return; continue; }
        const res = await fill(it);
        logIt(it, 'guest', '', (res.bad.length ? (res.done ? 'PARTIAL ' : 'FAILED ') + res.bad.join('; ').slice(0, 90) + ' ' : 'DONE ' + (st.dry ? '(dry run) ' : '')) + (Date.now() - TG) + ' ms');
        if (!st.dry && res.done) {
          const sv = await saveProfile(it);
          logIt(it, 'guest', '', sv.ok ? 'SAVED ' + res.done + ' field(s) ' + (Date.now() - TG) + ' ms' : 'SAVE FAILED ' + sv.why.slice(0, 120));
          summ.push([it.room, sv.ok ? 'saved' : 'failed', sv.ok ? '' : sv.why.slice(0, 60)]);
          if (sv.dialog) { st.paused = true; say('Room ' + it.room + ': Opera shows a message: "' + sv.why.slice(0, 150) + '". Answer it in Opera, then press Next guest.', true); return; }
        } else summ.push([it.room, st.dry ? 'dry run' : res.bad.length ? 'failed' : 'nothing to fill', res.bad.join('; ').slice(0, 60)]);
      }
      const c = k => summ.filter(x => x[1] === k).length;
      say('Finished ' + items.length + ' room(s): ' + c('saved') + ' saved, ' + c('nothing to fill') + ' nothing to fill, ' + c('skipped') + ' skipped, ' + c('failed') + ' failed' + (st.dry ? ', ' + c('dry run') + ' dry run (nothing typed)' : '') + '. ' + summ.filter(x => x[2]).map(x => x[0] + ': ' + x[2]).join(' | ').slice(0, 300), false);
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
  sh.getElementById('dry').onchange = e => { st.dry = e.target.checked; say(st.dry ? 'Dry run: nothing will be typed.' : 'Dry run off: it fills empty fields and then presses Save for the profile.', false); };
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
  window.__hoFixer = { open() { host.style.display = ''; }, setHook(f) { st.hook = f; }, loadCode(code) { st.plan = decode(code); st.cur = null; st.paused = false; renderList(); setBtns(); host.style.display = ''; sh.getElementById('plan').value = ''; say('List loaded: ' + st.plan.items.length + ' room(s). Dry run is on. Press Start.', false); return st.plan.items.length; }, _test: { roomRows, decode, check, fill, st, nameOk, profileName, safeClick, setPlan(p) { st.plan = p; renderList(); setBtns(); }, autoRun, goToGuest, setDry(v) { st.dry = v; } } };
})();
