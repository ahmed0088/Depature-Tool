/*
 * A.C.D.C / ALL enrollment helper – v19 (consent-safe)
 *
 * What's new in v19:
 *   • A list WITHOUT a Consent column (e.g. straight from Neorcha) can be used:
 *     tick "Every guest on this list agreed to join ALL" in the panel to confirm
 *     the whole list in one go.
 *   • "Civility when missing" (Skip / Mr / Ms) for guests without a Mr/Ms.
 *
 * What's new in v18:
 *   • CONSENT ONLY: the list must have a "Consent" column. Only guests marked
 *     Y / Yes / 1 / ✓ (the guest agreed at the desk) are enrolled. Everyone else
 *     is listed as "no consent" and never sent. The two attestation boxes
 *     ("I personally presented the ALL programme" / "Guest has requested this
 *     invitation") are ticked only for those guests — because for them it is true.
 *   • CIVILITY FROM THE LIST: a "Civility" column (Mr / Ms / Mrs / Miss). A guest
 *     without one is skipped ("civility missing") instead of everyone being "Mr".
 *   • No faked "trusted" clicks: plain DOM events only.
 *   • RESULTS TSV: when the run ends, "Copy results" puts Email · Status · Date on
 *     the clipboard — paste it into Hotel Ops → Guest Pipeline → Enrollment tracker.
 *
 * Easiest: build the list in Hotel Ops → Guest Pipeline (tick Consent, pick
 * Civility, "Copy enrollment list") and paste it into this panel.
 *
 * Unchanged from v17: reads each name field before writing, never touches
 * pre-filled values, only writes empty/corrupted fields.
 */
(async () => {
  if (window.__acdcEnrollmentStop) window.__acdcEnrollmentStop();

  let stopped = false;
  window.__acdcEnrollmentStop = () => { stopped = true; };

  const CONFIG = {
    dryRun: false,
    delayMs: 1500,
    stepTimeoutMs: 20000,
    emailSelector: 'input[name="customerEmail"], input[type="email"]',
    checkButtonText: 'Check E-mail',
  };

  const norm = s => (s || '').toLowerCase().replace(/[\s_\-]+/g, ' ').trim();
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const shown = el => !!el && el.offsetParent !== null;
  const visible = el => !!el && el.offsetParent !== null && !el.disabled;
  const originalEnrollHash = location.hash.includes('/enroll') ? location.hash : '';
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ═══════════════════════════════════════════════════════════════════
  // GUI PANEL
  // ═══════════════════════════════════════════════════════════════════
  const panel = {
    root: null, els: {}, records: [], excluded: [], results: [], running: false,

    mount() {
      document.getElementById('__acdc_panel')?.remove();
      const root = document.createElement('div');
      root.id = '__acdc_panel';
      root.style.cssText = `
        position:fixed; top:20px; right:20px; width:440px; max-height:92vh;
        background:#0f1216; color:#e6e9ee; z-index:2147483647;
        border-radius:14px; box-shadow:0 20px 60px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.08);
        font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
        display:flex; flex-direction:column; overflow:hidden;`;
      root.innerHTML = `
        <div style="background:linear-gradient(135deg,#2563eb,#1d4ed8);padding:12px 16px;font-weight:700;font-size:13px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
          <span style="display:flex;align-items:center;gap:8px"><span id="__acdc_dot" style="width:8px;height:8px;background:#4ade80;border-radius:50%;display:inline-block"></span>ALL Enroll · v19</span>
          <span id="__acdc_state" style="font-size:11px;background:rgba(0,0,0,.3);padding:3px 10px;border-radius:10px">idle</span>
        </div>
        <div id="__acdc_tabs" style="display:flex;background:#0a0d11;border-bottom:1px solid #1e2530;flex-shrink:0">
          <button data-tab="data" style="flex:1;background:transparent;border:0;color:#e6e9ee;padding:10px;font-size:12px;font-weight:600;cursor:pointer;border-bottom:2px solid #3b82f6">Data</button>
          <button data-tab="log" style="flex:1;background:transparent;border:0;color:#8892a0;padding:10px;font-size:12px;font-weight:600;cursor:pointer;border-bottom:2px solid transparent">Log</button>
        </div>
        <div id="__acdc_body_data" style="padding:14px 16px;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:10px">
          <div>
            <div style="font-size:11px;color:#8892a0;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Paste the enrollment list (from Hotel Ops → Guest Pipeline)</div>
            <textarea id="__acdc_input" placeholder="Confirmation_Number&#9;Name&#9;Email&#9;Nationality&#9;Civility&#9;Consent
595963843717&#9;Mohammed Sameer&#9;mdsam@example.com&#9;UAE&#9;Mr&#9;Y" style="width:100%;box-sizing:border-box;height:150px;resize:vertical;background:#0a0d11;color:#e6e9ee;border:1px solid #1e2530;border-radius:8px;padding:10px 12px;font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;outline:none;"></textarea>
          </div>
          <label style="display:flex;gap:8px;align-items:flex-start;font-size:12px;color:#cbd5e1;background:#0a0d11;border:1px solid #1e2530;border-radius:8px;padding:8px 10px;cursor:pointer">
            <input type="checkbox" id="__acdc_allconsent" style="margin-top:2px">
            <span><b>Every guest on this list agreed to join ALL</b> — I presented the programme and they asked for the invitation. <span style="color:#8892a0">Needed only when the list has no Consent column.</span></span>
          </label>
          <div style="display:flex;gap:8px;align-items:center;font-size:12px;color:#cbd5e1">
            Civility when missing:
            <select id="__acdc_defciv" style="background:#0a0d11;color:#e6e9ee;border:1px solid #1e2530;border-radius:6px;padding:4px 6px">
              <option value="">Skip the guest</option><option>Mr</option><option>Ms</option>
            </select>
          </div>
          <div style="display:flex;gap:8px">
            <button id="__acdc_parse" style="flex:1;padding:9px 14px;border:0;border-radius:8px;cursor:pointer;background:#2563eb;color:#fff;font-weight:600;font-size:12px;">Parse</button>
            <button id="__acdc_clear" style="padding:9px 14px;border:0;border-radius:8px;cursor:pointer;background:#1e2530;color:#cbd5e1;font-weight:600;font-size:12px;">Clear</button>
          </div>
          <div id="__acdc_preview" style="font-size:12px;color:#8892a0;background:#0a0d11;border:1px solid #1e2530;border-radius:8px;padding:10px 12px;min-height:60px;">Paste data and click <b style="color:#93c5fd">Parse</b>. Only guests with <b>Consent = Y</b> are enrolled.</div>
          <div style="display:flex;gap:8px;margin-top:4px">
            <button id="__acdc_start" style="flex:2;padding:11px 14px;border:0;border-radius:8px;cursor:pointer;background:#16a34a;color:#fff;font-weight:700;font-size:13px;opacity:.4;pointer-events:none;">▶ Start Enrollment</button>
            <button id="__acdc_stop" style="flex:1;padding:11px 14px;border:0;border-radius:8px;cursor:pointer;background:#7f1d1d;color:#fca5a5;font-weight:700;font-size:13px;opacity:.5;pointer-events:none;">■ Stop</button>
          </div>
          <button id="__acdc_copyres" style="padding:9px 14px;border:0;border-radius:8px;cursor:pointer;background:#1e2530;color:#cbd5e1;font-weight:600;font-size:12px;opacity:.4;pointer-events:none;">📋 Copy results for Hotel Ops</button>
        </div>
        <div id="__acdc_body_log" style="padding:12px 14px;overflow-y:auto;flex:1;display:none">
          <div id="__acdc_log" style="font:11px/1.55 ui-monospace,Menlo,Consolas,monospace;color:#cbd5e1;background:#0a0d11;border:1px solid #1e2530;border-radius:8px;padding:10px;min-height:200px;max-height:60vh;overflow-y:auto;white-space:pre-wrap;word-break:break-word;"></div>
        </div>`;
      document.body.appendChild(root);
      this.root = root;
      const q = id => root.querySelector('#' + id);
      this.els = {
        dot: q('__acdc_dot'), state: q('__acdc_state'), input: q('__acdc_input'), parse: q('__acdc_parse'),
        clear: q('__acdc_clear'), preview: q('__acdc_preview'), start: q('__acdc_start'), stop: q('__acdc_stop'),
        copyres: q('__acdc_copyres'), allConsent: q('__acdc_allconsent'), defCiv: q('__acdc_defciv'), log: q('__acdc_log'), bodyData: q('__acdc_body_data'), bodyLog: q('__acdc_body_log'),
        tabs: [...root.querySelectorAll('#__acdc_tabs button[data-tab]')],
      };
      this.els.parse.onclick = () => this.parse();
      this.els.clear.onclick = () => { this.els.input.value = ''; this.records = []; this.setStartEnabled(false); this.els.preview.textContent = 'Cleared.'; };
      this.els.start.onclick = () => this.startRun();
      this.els.stop.onclick = () => { stopped = true; this.setState('stopping', '#f59e0b'); this.log('User requested stop.'); };
      this.els.copyres.onclick = () => this.copyResults();
      this.els.tabs.forEach(btn => { btn.onclick = () => this.switchTab(btn.dataset.tab); });
    },
    switchTab(name) {
      this.els.bodyData.style.display = name === 'data' ? 'flex' : 'none';
      this.els.bodyLog.style.display  = name === 'log'  ? 'block' : 'none';
      this.els.tabs.forEach(b => { const on = b.dataset.tab === name; b.style.borderBottom = on ? '2px solid #3b82f6' : '2px solid transparent'; b.style.color = on ? '#e6e9ee' : '#8892a0'; });
    },
    setState(text, color = '#4ade80') { this.els.state.textContent = text; this.els.dot.style.background = color; },
    setStartEnabled(en) { this.els.start.style.opacity = en ? '1' : '.4'; this.els.start.style.pointerEvents = en ? 'auto' : 'none'; },
    setStopEnabled(en)  { this.els.stop.style.opacity  = en ? '1' : '.5'; this.els.stop.style.pointerEvents  = en ? 'auto' : 'none'; },
    log(msg) {
      const line = document.createElement('div');
      line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
      this.els.log.appendChild(line);
      this.els.log.scrollTop = this.els.log.scrollHeight;
    },
    parse() {
      const raw = this.els.input.value.trim();
      if (!raw) { this.els.preview.innerHTML = `<span style="color:#f87171">No data pasted.</span>`; this.setStartEnabled(false); return; }
      try {
        const { records, excluded } = parseGuestData(raw, { allConsent: this.els.allConsent.checked, defCiv: this.els.defCiv.value });
        this.records = records; this.excluded = excluded; this.results = [];
        const exc = excluded.length ? `<div style="color:#fbbf24;margin-top:6px">${excluded.length} not enrolled: ` +
          Object.entries(excluded.reduce((m, e) => (m[e.reason] = (m[e.reason] || 0) + 1, m), {})).map(([k, v]) => `${v} ${esc(k)}`).join(' · ') + '</div>' : '';
        if (!records.length) { this.els.preview.innerHTML = `<span style="color:#f87171">No guest with Consent = Y and a civility.</span>${exc}`; this.setStartEnabled(false); return; }
        const list = records.slice(0, 5).map(r => `${esc(r.civility)} ${esc(r.firstName)} ${esc(r.lastName)} · ${esc(r.email)}`).join('<br>');
        const more = records.length > 5 ? `<br><span style="color:#64748b">…and ${records.length - 5} more</span>` : '';
        this.els.preview.innerHTML = `<div style="color:#4ade80;font-weight:700;margin-bottom:6px">✓ ${records.length} guest(s) who agreed</div><div style="font:11px/1.5 ui-monospace,monospace;color:#cbd5e1">${list}${more}</div>${exc}`;
        this.setStartEnabled(true);
        this.log(`Parsed ${records.length} consenting guest(s); ${excluded.length} excluded.`);
        excluded.forEach(e => panel.results.push({ email: e.email, status: e.reason }));
      } catch (e) {
        this.els.preview.innerHTML = `<span style="color:#f87171">${esc(e.message)}</span>`;
        this.records = []; this.setStartEnabled(false);
      }
    },
    async startRun() {
      if (this.running || !this.records.length) return;
      this.running = true;
      this.switchTab('log');
      this.setStartEnabled(false); this.setStopEnabled(true);
      this.setState('running', '#4ade80');
      stopped = false;
      await runEnrollment(this.records);
      this.setStopEnabled(false);
      this.setState(stopped ? 'stopped' : 'done', stopped ? '#f59e0b' : '#4ade80');
      this.els.copyres.style.opacity = '1'; this.els.copyres.style.pointerEvents = 'auto';
      this.switchTab('data');
      this.running = false;
    },
    resultsTsv() {
      const d = new Date().toISOString().slice(0, 10);
      return 'Email\tStatus\tDate\n' + this.results.map(r => `${r.email}\t${r.status}\t${d}`).join('\n');
    },
    async copyResults() {
      const tsv = this.resultsTsv();
      try { await navigator.clipboard.writeText(tsv); this.els.copyres.textContent = '✓ Results copied'; }
      catch (_) { this.log('Copy blocked — results:\n' + tsv); }
    },
  };

  // ═══════════════════════════════════════════════════════════════════
  // Parse — consent + civility required
  // ═══════════════════════════════════════════════════════════════════
  const EMAIL_FIXES = {
    'gmai.com':'gmail.com','gmial.com':'gmail.com','gamil.com':'gmail.com','gnail.com':'gmail.com',
    'hotmai.com':'hotmail.com','hotmal.com':'hotmail.com','homail.com':'hotmail.com',
    'yaho.com':'yahoo.com','yahho.com':'yahoo.com','outlok.com':'outlook.com',
    'iclould.com':'icloud.com','iclod.com':'icloud.com',
  };
  const fixEmailTypos = e => {
    const p = String(e || '').split('@');
    if (p.length !== 2 || !p[0] || !p[1]) return e;
    return `${p[0]}@${EMAIL_FIXES[p[1].toLowerCase()] || p[1]}`;
  };
  const countryNames = {
    UAE:'United Arab Emirates',KSA:'Saudi Arabia',UK:'United Kingdom',GB:'United Kingdom',
    USA:'United States',US:'United States','RUSSIAN FEDERATION':'Russia','SYRIAN ARAB REPUBLIC':'Syria',
    'IRAN, ISLAMIC REPUBLIC OF':'Iran','KOREA, REPUBLIC OF':'South Korea','VIET NAM':'Vietnam',
    'BRUNEI DARUSSALAM':'Brunei','TANZANIA, UNITED REPUBLIC OF':'Tanzania','MOLDOVA, REPUBLIC OF':'Moldova',
    'CONGO, THE DEMOCRATIC REPUBLIC OF THE':'DR Congo',"COTE D'IVOIRE":'Ivory Coast',
    'MACEDONIA, THE FORMER YUGOSLAV REPUBLIC OF':'North Macedonia','PALESTINIAN TERRITORY, OCCUPIED':'Palestine',
    'TAIWAN, PROVINCE OF CHINA':'Taiwan','VENEZUELA, BOLIVARIAN REPUBLIC OF':'Venezuela',
    'BOLIVIA, PLURINATIONAL STATE OF':'Bolivia','CZECH REPUBLIC':'Czechia','CAPE VERDE':'Cabo Verde',
    'BURMA':'Myanmar',"PEOPLE'S REPUBLIC OF CHINA":'China',MACAU:'Macao',
  };
  const CIVILITIES = { mr: 'Mr', mrs: 'Mrs', ms: 'Ms', miss: 'Miss', mme: 'Mrs', mlle: 'Miss' };

  function parseGuestData(tsv, opts = {}) {
    const rows = tsv.trim().split(/\r?\n/).map(line => line.split('\t'));
    const header = rows.shift().map(x => norm(x));
    const col = (...names) => names.map(norm).map(n => header.findIndex(h => h === n || h.startsWith(n))).find(i => i >= 0);
    const nameCol = col('name'), emailCol = col('email'), countryCol = col('nationality', 'country');
    const civCol = col('civility', 'title'), consentCol = col('consent', 'agreed');
    if (emailCol == null || nameCol == null) throw new Error('Could not find Name and Email columns (the first line must be the header).');
    if (consentCol == null && !opts.allConsent) throw new Error('This list has no Consent column. If every guest on it agreed to join ALL, tick "Every guest on this list agreed" above and press Parse again. Otherwise tick only the guests who agreed in Hotel Ops → Guest Pipeline.');
    const seen = new Set(), records = [], excluded = [];
    for (const row of rows) {
      let email = (row[emailCol] || '').trim().toLowerCase();
      if (!email || !/^\S+@\S+\.\S+$/.test(email) || /^no@email\.com$/.test(email)) { excluded.push({ email: email || '(none)', reason: 'no valid email' }); continue; }
      email = fixEmailTypos(email);
      if (seen.has(email)) continue;
      seen.add(email);
      if (consentCol != null && !/^(y|yes|1|true|✓|x)$/i.test((row[consentCol] || '').trim())) { excluded.push({ email, reason: 'no consent' }); continue; }
      const civility = CIVILITIES[norm(civCol != null ? row[civCol] || '' : '').replace(/\./g, '')] || opts.defCiv || '';
      if (!civility) { excluded.push({ email, reason: 'civility missing' }); continue; }
      const fullName = (row[nameCol] || '').trim().replace(/\s+/g, ' ');
      const parts = fullName.split(' ');
      const firstName = parts.shift() || email.split('@')[0];
      const lastName = parts.length ? parts[parts.length - 1] : firstName;
      const country = (row[countryCol] || '').trim();
      records.push({ email, firstName, lastName, civility, country: countryNames[country.toUpperCase()] || country });
    }
    return { records, excluded };
  }

  // ═══════════════════════════════════════════════════════════════════
  // Value shield + write-if-needed helpers (unchanged from v17)
  // ═══════════════════════════════════════════════════════════════════
  function installValueShield(el, desiredValue) {
    if (!el.__acdcShieldInstalled) {
      el.__acdcShieldInstalled = true;
      const proto = HTMLInputElement.prototype;
      const realSet = Object.getOwnPropertyDescriptor(proto, 'value').set;
      el.__acdcDesired = desiredValue;
      el.__acdcRealSet = realSet;
      Object.defineProperty(el, 'value', {
        configurable: true,
        get() { return el.__acdcDesired; },
        set(v) {
          const s = String(v ?? '');
          if (/\[object\s+\w+\]/.test(s)) { panel.log(`[SHIELD] blocked "${s}"`); return; }
          el.__acdcDesired = s;
          realSet.call(el, s);
        },
      });
      realSet.call(el, desiredValue);
    } else {
      el.__acdcDesired = desiredValue;
      el.__acdcRealSet.call(el, desiredValue);
    }
  }
  function readRaw(el) {
    if (!el) return '';
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype
                : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype
                : HTMLInputElement.prototype;
    const getter = Object.getOwnPropertyDescriptor(proto, 'value')?.get;
    const v = getter ? getter.call(el) : el.value;
    return String(v ?? '').trim();
  }
  async function setTextIfNeeded(el, desiredValue, label) {
    if (!el) return 'missing';
    const cur = readRaw(el).replace(/\s+/g, ' ').trim();
    const want = String(desiredValue ?? '').replace(/\s+/g, ' ').trim();
    if (cur && cur.toLowerCase() === want.toLowerCase()) { panel.log(`[SKIP] ${label} already "${cur}"`); return 'skipped'; }
    if (cur && !/\[object\s+\w+\]/i.test(cur)) { panel.log(`[SKIP] ${label} keeps backend "${cur}"`); return 'skipped'; }
    panel.log(`[WRITE] ${label} "${cur || '(empty)'}" → "${want}"`);
    el.focus();
    installValueShield(el, want);
    try { el._value = '__acdc_stale__'; } catch (_) {}
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(150);
    if (readRaw(el).toLowerCase() === want.toLowerCase()) return 'written';
    el.__acdcRealSet.call(el, want);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(150);
    return readRaw(el).toLowerCase() === want.toLowerCase() ? 'written' : 'failed';
  }

  // ═══════════════════════════════════════════════════════════════════
  // DOM helpers (unchanged from v17)
  // ═══════════════════════════════════════════════════════════════════
  function buttonByText(label) {
    const wanted = norm(label);
    return [...document.querySelectorAll('button,[role="button"]')].find(b => shown(b) && norm(b.textContent) === wanted) ||
      [...document.querySelectorAll('.button-cta__label')].find(s => shown(s) && norm(s.textContent) === wanted)?.closest('button');
  }
  function controlByText(label) {
    const wanted = norm(label);
    return [...document.querySelectorAll('button,a,[role="button"]')].find(el => shown(el) && norm(el.textContent) === wanted);
  }
  function navLinkByLabel(label) {
    const wanted = norm(label);
    const labelEl = [...document.querySelectorAll('a .label, a span.label')]
      .find(el => norm(el.textContent) === wanted && (shown(el) || el.closest('.menu,nav,.sidebar')));
    return labelEl?.closest('a') || controlByText(label);
  }
  async function openNavigation() {
    const burger = document.querySelector('a.burger, .burger');
    if (burger && !shown(document.querySelector('nav,.sidebar,.menu.open'))) burger.click();
    await sleep(250);
  }
  function waitFor(fn, timeout = CONFIG.stepTimeoutMs) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        if (stopped) return reject(new Error('Superseded'));
        try { const v = fn(); if (v) return resolve(v); } catch (_) {}
        if (Date.now() - start >= timeout) return reject(new Error('Timeout'));
        setTimeout(tick, 150);
      };
      tick();
    });
  }
  function enrollmentMessage() {
    const el = document.querySelector('.enroll-message');
    if (!el || !visible(el)) return '';
    return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  }
  function updateProblemModal() {
    const modal = [...document.querySelectorAll('body > div.modal-mask, div.modal-mask')].find(shown);
    if (!modal || !/an update problem has occurred|modification won.?t be effective/i.test(modal.textContent || '')) return null;
    return modal;
  }
  function closeUpdateProblemModal() {
    const modal = updateProblemModal();
    if (!modal) return false;
    modal.querySelector('.btn-close')?.click();
    return true;
  }
  function findTextInputByLabel(labels) {
    const wanted = labels.map(norm);
    for (const label of document.querySelectorAll('label')) {
      const t = norm(label.textContent);
      if (!wanted.some(w => t === w || t.startsWith(w))) continue;
      const forId = label.getAttribute('for');
      if (forId) {
        const el = document.getElementById(forId);
        if (el && el.tagName === 'INPUT' && shown(el)) return el;
      }
      const c = label.closest('div, .field, .form-group') || label.parentElement;
      const input = c.querySelector('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="email"])');
      if (input && shown(input)) return input;
    }
    return null;
  }
  function findByName(names, tag) {
    for (const n of names) {
      const sel = tag ? `${tag.toLowerCase()}[name="${n}"]` : `[name="${n}"]`;
      const el = [...document.querySelectorAll(sel)].find(e => shown(e) && !e.disabled);
      if (el) return el;
    }
    return null;
  }
  async function setNativeSelect(el, value) {
    const wanted = norm(value);
    const compact = s => norm(String(s)).replace(/[^a-z0-9]/g, '');
    const option = [...el.options].find(o =>
      norm(o.value) === wanted || norm(o.textContent) === wanted || norm(o.textContent).includes(wanted) ||
      compact(o.value) === compact(value) || compact(o.textContent).includes(compact(value)));
    if (!option) { panel.log(`No option matching "${value}"`); return false; }
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(el, option.value);
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(200);
    return true;
  }

  /* Civility from the list (Mr / Mrs / Ms / Miss). Plain clicks, no faked "trusted" events. */
  async function setCivility(value) {
    const want = norm(value);
    const nativeSel = document.querySelector('select[name="civility"]');
    if (nativeSel) {
      if (readRaw(nativeSel)) return true;
      return await setNativeSelect(nativeSel, value);
    }
    let labelEl = null;
    for (const el of document.querySelectorAll('label, span, div')) {
      const t = norm(el.textContent);
      if ((t === 'civility' || t === 'civility *') && shown(el)) { labelEl = el; break; }
    }
    if (!labelEl) return false;
    const lr = labelEl.getBoundingClientRect();
    const trigger = [...document.querySelectorAll('div, button')].find(el => {
      if (!shown(el)) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 60 || r.height < 25 || r.width > 400 || r.height > 80) return false;
      return Math.abs(r.left - lr.left) < 60 && r.top - lr.bottom > -10 && r.top - lr.bottom < 80;
    });
    if (!trigger) return false;
    const cur = norm(trigger.textContent).replace(/\./g, '');
    if (cur === want) return true;
    trigger.scrollIntoView({ block: 'center' });
    await sleep(200);
    trigger.click();
    await sleep(700);
    for (const el of document.querySelectorAll('*')) {
      if (!shown(el)) continue;
      if (norm(el.textContent).replace(/\./g, '') !== want) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 5 || r.height < 5) continue;
      for (const type of ['mousedown', 'mouseup', 'click']) {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
        await sleep(25);
      }
      await sleep(300);
      panel.log(`[CIVILITY] ${value}`);
      return true;
    }
    document.body.click();
    return false;
  }

  async function returnToEmailStep() {
    const ready = () =>
      [...document.querySelectorAll(CONFIG.emailSelector)].some(el => !el.disabled && el.offsetParent !== null) &&
      buttonByText(CONFIG.checkButtonText);
    if (ready()) return true;
    for (let attempt = 1; attempt <= 3; attempt++) {
      document.querySelectorAll('.btn-close').forEach(b => shown(b) && b.click());
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(400);
      controlByText('Back')?.click();
      await openNavigation();
      navLinkByLabel('Search')?.click();
      await sleep(400);
      (navLinkByLabel('Enroll ALL') || controlByText('Enroll ALL'))?.click();
      if (!document.querySelector('a,button') && originalEnrollHash) {
        location.hash = '#/'; await sleep(150); location.hash = originalEnrollHash;
      }
      try { await waitFor(ready, 9000); await sleep(400); return true; }
      catch (_) { panel.log(`[RESET RETRY ${attempt}/3]`); }
    }
    return false;
  }

  // ═══════════════════════════════════════════════════════════════════
  // Per-guest enrollment
  // ═══════════════════════════════════════════════════════════════════
  async function fillRecord(record) {
    const emailEl = [...document.querySelectorAll(CONFIG.emailSelector)].find(el => visible(el));
    if (!emailEl) throw new Error('Email field not found');
    if (readRaw(emailEl).toLowerCase() !== record.email.toLowerCase()) {
      installValueShield(emailEl, record.email);
      emailEl.focus();
      try { emailEl._value = '__acdc_stale__'; } catch (_) {}
      emailEl.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(250);
    }
    await sleep(300);

    const checkBtn = await waitFor(() => buttonByText(CONFIG.checkButtonText), 5000).catch(() => null);
    if (!checkBtn) throw new Error('Check E-mail button not found');
    checkBtn.click();

    const state = await waitFor(() => {
      if (updateProblemModal()) return { kind: 'update-error' };
      if (findTextInputByLabel(['first name']) || document.querySelector('select, [role="combobox"]')) return { kind: 'form' };
      const msg = enrollmentMessage();
      if (msg) return { kind: 'message', message: msg };
      return null;
    }, 15000).catch(() => ({ kind: 'timeout' }));

    if (state.kind === 'update-error') { closeUpdateProblemModal(); panel.log(`[UPDATE-ERROR] ${record.email}`); return 'update-error'; }
    if (state.kind === 'message') {
      if (/already\s+(?:an?\s+)?all\s+member|already\s+member/i.test(state.message)) { panel.log(`✅ [ALREADY MEMBER] ${record.email}`); return 'already-member'; }
      if (/pending account/i.test(state.message)) { panel.log(`⏳ [PENDING] ${record.email}`); return 'pending-account'; }
      panel.log(`⚠️ [CHECK] ${record.email}: ${state.message.slice(0, 80)}`);
      return 'check-message';
    }
    if (state.kind !== 'form') { panel.log(`[TIMEOUT] ${record.email}`); return 'form-timeout'; }

    await sleep(1000);
    panel.log(`[FILL] ${record.email} — "${record.civility} ${record.firstName} ${record.lastName}"`);
    const firstInput = findTextInputByLabel(['first name']) || findByName(['firstName'], 'INPUT');
    const lastInput  = findTextInputByLabel(['last name'])  || findByName(['lastName'],  'INPUT');
    const r1 = await setTextIfNeeded(firstInput, record.firstName, 'firstName');
    const r2 = await setTextIfNeeded(lastInput,  record.lastName,  'lastName');
    panel.log(`[FILL-RESULT] first=${r1} last=${r2}`);

    const invalid = v => !v || /\[object|undefined|null|^select|^choose|^please/i.test(v);
    if (invalid(readRaw(firstInput)) || invalid(readRaw(lastInput))) { panel.log('[SKIP] names invalid'); return 'names-not-set'; }

    const langSel = document.querySelector('select[name="language"]');
    if (langSel && !readRaw(langSel)) await setNativeSelect(langSel, 'English');
    const countrySel = document.querySelector('select[name="personalCountry"], select[name="country"]');
    if (countrySel && !readRaw(countrySel) && record.country) await setNativeSelect(countrySel, record.country);

    if (!(await setCivility(record.civility))) { panel.log(`[SKIP] could not set civility ${record.civility}`); return 'civility-not-set'; }
    await sleep(600);
    if (firstInput) {
      firstInput.dispatchEvent(new Event('focus', { bubbles: true })); await sleep(80);
      firstInput.dispatchEvent(new Event('blur',  { bubbles: true })); await sleep(250);
    }

    // Attestations — this guest is on the list only because they agreed at the desk (Consent = Y).
    const attestationTexts = [/personally presented the all loyalty programme/i, /guest has requested to receive this invitation/i];
    let attestations = [
      document.querySelector('#enroll-toggleAllProgram label[role="checkbox"]'),
      document.querySelector('#enroll-toggleAllInvitation label[role="checkbox"]'),
    ].filter(Boolean);
    if (attestations.length < 2) {
      attestations = [...document.querySelectorAll('label')].filter(l => attestationTexts.some(re => re.test((l.innerText || l.textContent || '').replace(/\s+/g, ' ')))).map(label => {
        let cb = label.querySelector('input[type="checkbox"]');
        if (!cb && label.htmlFor) cb = document.getElementById(label.htmlFor);
        if (!cb) cb = (label.closest('.field,.form-group,[class*="checkbox"]') || label.parentElement)?.querySelector('input[type="checkbox"]');
        return cb || label;
      }).filter(Boolean);
    }
    for (const el of attestations) {
      const checked = el.type === 'checkbox' ? el.checked : el.getAttribute?.('aria-checked') === 'true';
      if (!checked) {
        el.scrollIntoView({ block: 'center' });
        el.click();
        if (el.type === 'checkbox' && !el.checked) {
          el.checked = true;
          el.dispatchEvent(new Event('input',  { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    }
    await sleep(400);

    await waitFor(() => {
      const btn = [...document.querySelectorAll('button')].find(b => /send all invitation/i.test(norm(b.textContent)));
      return btn && !btn.disabled ? btn : null;
    }, 5000).catch(() => panel.log('[SUBMIT] still disabled — clicking anyway'));

    const submit = [...document.querySelectorAll('button')]
      .find(b => shown(b) && /send all invitation|submit|enroll/i.test(norm(b.textContent)) && !/check e-mail/i.test(norm(b.textContent)));
    if (!submit) throw new Error('Send ALL Invitation button not found');
    if (CONFIG.dryRun) { panel.log(`[DRY RUN] ${record.email}`); return 'dry-run'; }

    submit.scrollIntoView({ block: 'center' });
    submit.click();
    await waitFor(() => document.querySelector('div.modal-mask .btn-close') || enrollmentMessage(), 12000).catch(() => {});
    if (updateProblemModal()) { closeUpdateProblemModal(); panel.log(`[UPDATE-ERROR] ${record.email}`); return 'update-error-on-submit'; }
    await sleep(CONFIG.delayMs);
    panel.log(`✅ [SUBMITTED] ${record.email}`);
    return 'submitted';
  }

  async function runEnrollment(records) {
    if (location.hostname !== 'fc.accor.net') panel.log('Warning: not on fc.accor.net');
    panel.log(`Starting — ${records.length} guest(s) who agreed`);
    for (let i = 0; i < records.length; i++) {
      if (stopped) { panel.log('Stopped by user.'); break; }
      const record = records[i];
      panel.log(`[${i + 1}/${records.length}] ${record.email}`);
      try {
        const status = await fillRecord(record);
        panel.results.push({ email: record.email, status });
        if (i < records.length - 1) { await returnToEmailStep(); await sleep(CONFIG.delayMs); }
      } catch (err) {
        panel.log(`[SKIPPED] ${record.email}: ${err.message || err}`);
        panel.results.push({ email: record.email, status: 'error' });
        if (i < records.length - 1) {
          try { await returnToEmailStep(); await sleep(CONFIG.delayMs); }
          catch (_) { if (originalEnrollHash) { location.hash = originalEnrollHash; await sleep(2000); } }
        }
      }
    }
    const n = s => panel.results.filter(r => r.status === s).length;
    panel.log('');
    panel.log('──── Done ────');
    panel.log(`✓ Submitted:      ${n('submitted')}`);
    panel.log(`◯ Already member: ${n('already-member')}`);
    panel.log(`◯ Pending:        ${n('pending-account')}`);
    panel.log(`◯ No consent:     ${n('no consent')}`);
    panel.log(`✗ Other:          ${panel.results.length - n('submitted') - n('already-member') - n('pending-account') - n('no consent')}`);
    panel.log('Use "Copy results for Hotel Ops" on the Data tab to log this run.');
    console.table(panel.results);
    window.__enrollmentResults = panel.results;
  }

  panel.mount();
  panel.log('Panel ready. Paste the list from Hotel Ops → Guest Pipeline and click Parse.');
  console.info('%c ALL Enroll v19 ready — use the panel on the right.', 'color:#3b82f6;font-weight:700');
})();
