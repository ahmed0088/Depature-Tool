(async function () {
  "use strict";

  const PORTAL_URL_KEY = "__accor_portal_url";
  const LOOP_STATE_KEY = "__accor_loop_state";
  const ENABLED_KEY    = "__accor_enabled";
  const RECORDS_KEY    = "__accor_records";
  const STOP_SIGNAL    = "__accor_stop_signal";
  const DIAGNOSTIC_KEY = "__accor_diagnostic_only";
  const CURRENT_KEY    = "__accor_current_guest";

  const DEFAULT_TITLE    = "Mr.";
  // Portal options are exactly: Ms. | Prof. | Mr. | Mrs | Dr.
  const TITLE_ALIASES = {
    "mr":"Mr.", "mr.":"Mr.", "mister":"Mr.",
    "ms":"Ms.", "ms.":"Ms.", "miss":"Ms.",
    "mrs":"Mrs", "mrs.":"Mrs",
    "dr":"Dr.", "dr.":"Dr.",
    "prof":"Prof.", "prof.":"Prof.", "professor":"Prof."
  };
  function normalizeTitle(raw) { return TITLE_ALIASES[String(raw || "").trim().toLowerCase()] || DEFAULT_TITLE; }
  const POST_SUBMIT_MAX  = 12000;
  const POST_SUBMIT_POLL = 400;
  const BETWEEN_GUESTS   = 2000;

  const SUCCESS_URL_MARKERS = [
    "connected_type=enrollment",
    "#/template/hospitality-accor/connected",
    "/template/hospitality-accor/connected",
    "connected_type=success",
    "/portal/autologin.html"
  ];

  function isSuccessUrl(url) {
    if (!url) return false;
    const u = String(url);
    for (const m of SUCCESS_URL_MARKERS) {
      if (u.indexOf(m) >= 0) return m;
    }
    return false;
  }

  const COUNTRY_ALIASES = {
    "uae": "United Arab Emirates",
    "u.a.e.": "United Arab Emirates",
    "u.a.e": "United Arab Emirates",
    "emirates": "United Arab Emirates",
    "ksa": "Saudi Arabia",
    "uk": "United Kingdom",
    "great britain": "United Kingdom",
    "england": "United Kingdom",
    "scotland": "United Kingdom",
    "wales": "United Kingdom",
    "northern ireland": "United Kingdom",
    "usa": "United States",
    "us": "United States",
    "america": "United States",
    "drc": "Congo, the Democratic Republic of the",
    "ivory coast": "Côte d'Ivoire",
    "cote divoire": "Côte d'Ivoire",
    "cote d'ivoire": "Côte d'Ivoire",
    "macedonia": "North Macedonia",
    "swaziland": "Eswatini",
    "burma": "Myanmar",
    "cape verde": "Cabo Verde",
    "holland": "Netherlands",
    "the netherlands": "Netherlands"
  };

  function mapCountry(raw) {
    if (!raw) return raw;
    const key = String(raw).trim().toLowerCase();
    return COUNTRY_ALIASES[key] || raw;
  }

  function sanitizePhone(raw) {
    if (!raw) return "";
    let s = String(raw).trim();
    s = s.replace(/[^\d+]/g, "");
    if (s.indexOf("+") > 0) s = "+" + s.replace(/\+/g, "");
    s = s.replace(/^\++/, "+");
    if (s[0] === "0") s = s.replace(/^0+/, "");
    const plus = s[0] === "+" ? "+" : "";
    const digits = s.replace(/\D/g, "");
    return plus + digits.slice(0, 15);
  }

  function splitName(fullName) {
    if (!fullName) return { first: "Test", last: "User" };
    const parts = String(fullName).trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return { first: "Test", last: "User" };
    if (parts.length === 1) return { first: parts[0].slice(0, 30), last: "User" };
    const first = parts[0].slice(0, 30);
    let last = parts.slice(1).join(" ");
    if (last.length > 30) last = last.slice(0, 30);
    if (last.length < 2) last = last + ".";
    return { first: first, last: last };
  }

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  function cget(keys) { return new Promise(r => chrome.storage.local.get(keys, r)); }
  function cset(obj)  { return new Promise(r => chrome.storage.local.set(obj, r)); }

  function log(msg, level) {
    level = level || "info";
    const line = "[" + new Date().toLocaleTimeString() + "] " + msg;
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
    try {
      chrome.runtime.sendMessage({ type: "log", entry: { ts: Date.now(), level: level, msg: msg } });
    } catch (e) {}
  }

  const boot = await cget([PORTAL_URL_KEY, LOOP_STATE_KEY, ENABLED_KEY, RECORDS_KEY]);
  const enabled    = boot[ENABLED_KEY] === true;
  const diagnosticOnly = boot[DIAGNOSTIC_KEY] === true;
  const portalUrl  = boot[PORTAL_URL_KEY] || "";
  const recordsRaw = boot[RECORDS_KEY] || "";
  let   loopState  = boot[LOOP_STATE_KEY] || null;

  log("content loaded on " + location.hostname + " | enabled=" + enabled);

  if (!enabled) { log("disabled, exiting"); return; }

  if (location.hostname.indexOf("guestinternet.com") < 0) {
    log("wrong origin (" + location.hostname + "), redirecting to portal");
    if (portalUrl) location.href = portalUrl;
    return;
  }

  log("waiting for portal SPA...");
  await sleep(800);

  function parseLine(line) {
    const raw = (line || "").trim();
    if (!raw) return null;
    const p = raw.split("|").map(s => s.trim());
    if (p.length < 6) return null;
    const conf = p[0], titleRaw = p[1], name = p[2], email = p[3], phone = p[4], countryRaw = p[5];
    const title = normalizeTitle(titleRaw);
    if (!email || email.indexOf("@") < 0) return null;
    const nm = splitName(name);
    const cleanPhone = sanitizePhone(phone);
    return { conf: conf, title: title || DEFAULT_TITLE,
             first_name: nm.first, last_name: nm.last,
             email: email, phone: cleanPhone, phoneRaw: phone,
             country: mapCountry(countryRaw), countryRaw: countryRaw };
  }

  const records = recordsRaw.split("\n").map(parseLine).filter(Boolean);
  log("parsed " + records.length + " records");
  if (!records.length) { log("no records, exiting", "warn"); return; }

  let results, startIndex;
  if (loopState && loopState.active && loopState.totalRecords === records.length) {
    startIndex = loopState.nextIndex || 0;
    results    = loopState.results || [];
    log("RESUMING from index " + startIndex + " (" + results.length + " processed)");
  } else {
    startIndex = 0;
    results    = [];
    loopState  = { active: true, startedAt: Date.now() };
    log("starting fresh");
  }

  async function persist(nextIndex) {
    await cset({
      [LOOP_STATE_KEY]: {
        active: true, nextIndex: nextIndex, totalRecords: records.length,
        results: results, startedAt: loopState.startedAt || Date.now()
      }
    });
  }

  function waitFor(fn, opts) {
    opts = opts || {};
    const timeout  = opts.timeout  || 15000;
    const interval = opts.interval || 150;
    const name     = opts.name     || "element";
    const start    = Date.now();
    return new Promise((resolve, reject) => {
      (function tick() {
        let v;
        try { v = fn(); } catch (e) { v = null; }
        if (v) return resolve(v);
        if (Date.now() - start > timeout)
          return reject(new Error("waitFor timeout: " + name));
        setTimeout(tick, interval);
      })();
    });
  }

  function inputByLabel(labelText) {
    const wanted = labelText.toLowerCase();
    const labels = Array.from(document.querySelectorAll("label"));
    const label  = labels.find(l => l.textContent.trim().toLowerCase() === wanted);
    if (label) {
      const forId = label.getAttribute("for");
      if (forId) {
        const el = document.getElementById(forId);
        if (el) return el;
      }
      const wrap = label.closest("div");
      const inp  = wrap ? wrap.querySelector("input, [role='combobox']") : null;
      if (inp) return inp;
    }
    return document.querySelector("[aria-labelledby='" + labelText + "-label']");
  }

  function reactSelectInputByLabel(labelText) {
    const direct = document.querySelector(
      "input[role='combobox'][aria-labelledby='" + labelText + "-label']"
    );
    if (direct) return direct;
    const wanted = labelText.toLowerCase();
    const label  = Array.from(document.querySelectorAll("label"))
      .find(l => l.textContent.trim().toLowerCase() === wanted);
    if (label) {
      const cont = label.closest("div");
      if (cont) {
        const inp = cont.querySelector("input[role='combobox']");
        if (inp) return inp;
      }
    }
    return null;
  }

  function setReactInput(el, value) {
    if (!el) throw new Error("setReactInput: missing element");
    const proto  = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input",  { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function humanType(el, value) {
    if (!el) throw new Error("humanType: missing element");
    try { el.focus(); } catch (e) {}
    const proto  = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input",  { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    try { el.dispatchEvent(new Event("blur", { bubbles: true })); } catch (e) {}
    await sleep(60);
  }

  async function clearReactSelect(labelText) {
    const input = reactSelectInputByLabel(labelText);
    if (!input) return;
    const container = input.closest("[class*='-container']") || input.closest("div");
    const clearBtn  = container ? container.querySelector("[class*='clear-indicator']") : null;
    if (clearBtn) { clearBtn.click(); await sleep(200); }
    input.focus();
    for (let i = 0; i < 8; i++) {
      input.dispatchEvent(new KeyboardEvent("keydown",
        { key: "Backspace", keyCode: 8, bubbles: true }));
    }
    await sleep(150);
  }


  /** Dedicated Title picker for Accor portal (Ms. Prof. Mr. Mrs Dr.) — no typing needed */
  async function pickTitle(wanted) {
    const target = normalizeTitle(wanted);
    log('  -> Title: "' + target + '"');

    function findTitleInput() {
      return document.querySelector('input[role="combobox"][aria-labelledby="title-label"]')
          || document.querySelector('input[role="combobox"][aria-labelledby*="title"]')
          || document.querySelector('#react-select-2-input, #react-select-3-input, #react-select-4-input, #react-select-5-input, #react-select-6-input')
          || reactSelectInputByLabel("Title");
    }

    // Clear any previous value first
    await clearReactSelect("Title");
    const input = await waitFor(findTitleInput, { name: "Title combo", timeout: 8000 });

    // Walk up to the react-select control (the clickable box)
    let control = input.closest("[class*='-control']");
    if (!control) control = input.closest("div");
    // Chevron / dropdown indicator (the SVG arrow the user clicks)
    const indicator =
      control.querySelector("div[class*='indicatorContainer']") ||
      control.querySelector("div[class*='dropdown']") ||
      control.querySelector("svg") ||
      control;

    function realClick(el) {
      if (!el) return;
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
      el.dispatchEvent(new PointerEvent("pointerdown", { ...opts, pointerId: 1, pointerType: "mouse" }));
      el.dispatchEvent(new MouseEvent("mousedown", opts));
      el.dispatchEvent(new PointerEvent("pointerup", { ...opts, pointerId: 1, pointerType: "mouse" }));
      el.dispatchEvent(new MouseEvent("mouseup", opts));
      el.dispatchEvent(new MouseEvent("click", opts));
    }

    function getTitleOptions() {
      const out = [];
      const seen = new Set();
      document.querySelectorAll("[role='listbox'] [role='option'], [role='option'], [id*='-option-']").forEach(el => {
        if (seen.has(el)) return;
        const t = (el.textContent || "").trim();
        if (!t || t.length > 20) return;
        // must be visible
        if (el.offsetParent === null && !el.getClientRects().length) return;
        seen.add(el);
        out.push({ el, txt: t });
      });
      return out;
    }

    // === Mimic a real user: click the box, then the chevron ===
    try { input.scrollIntoView({ block: "center", behavior: "instant" }); } catch (e) {}
    await sleep(50);

    realClick(control);
    await sleep(100);
    realClick(indicator);
    await sleep(100);
    try { input.focus(); } catch (e) {}
    // Open menu via keyboard as well (react-select responds well to this)
    input.dispatchEvent(new KeyboardEvent("keydown", {
      key: "ArrowDown", code: "ArrowDown", keyCode: 40, which: 40, bubbles: true, cancelable: true
    }));
    input.dispatchEvent(new KeyboardEvent("keyup", {
      key: "ArrowDown", code: "ArrowDown", keyCode: 40, which: 40, bubbles: true, cancelable: true
    }));

    // Wait for menu — poll until we see the known titles
    let opts = [];
    for (let i = 0; i < 15; i++) {
      await sleep(150);
      opts = getTitleOptions();
      if (opts.length >= 3) break;
      // nudge again mid-way
      if (i === 4 || i === 9) {
        realClick(control);
        realClick(indicator);
        input.dispatchEvent(new KeyboardEvent("keydown", {
          key: "ArrowDown", code: "ArrowDown", keyCode: 40, which: 40, bubbles: true
        }));
      }
    }
    log("     " + opts.length + " title option(s): " + opts.map(o => o.txt).join(", "));
    if (!opts.length) {
      log("     Title menu did not open", "warn");
      return false;
    }

    const norm = s => String(s).toLowerCase().replace(/\./g, "").trim();
    let best = opts.find(o => o.txt === target)
            || opts.find(o => norm(o.txt) === norm(target));
    if (!best) {
      log("     no match for \"" + target + "\" among: " + opts.map(o => o.txt).join(", "), "warn");
      return false;
    }
    log('     selecting "' + best.txt + '"');

    // Click the option with the same real pointer sequence
    try { best.el.scrollIntoView({ block: "nearest" }); } catch (e) {}
    realClick(best.el);
    await sleep(220);

    // Confirm value committed into the control
    const selected = control.querySelector("[class*='singleValue']");
    const got = selected ? selected.textContent.trim() : "";
    if (norm(got) === norm(target) || norm(got) === norm(best.txt)) return true;

    // Keyboard fallback: focus option path via Enter
    input.focus();
    input.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true
    }));
    await sleep(200);
    const selected2 = control.querySelector("[class*='singleValue']");
    const got2 = selected2 ? selected2.textContent.trim() : "";
    if (norm(got2) === norm(target) || norm(got2) === norm(best.txt)) return true;

    log('     Title did not commit (got "' + got2 + '")', "warn");
    return false;
  }

  async function pickReactSelectByLabel(labelText, text) {
    log("  -> " + labelText + ": \"" + text + "\"");
    await clearReactSelect(labelText);
    const input = await waitFor(() => reactSelectInputByLabel(labelText),
                                { name: labelText + " combo", timeout: 8000 });
    const wrap = input.closest("[class*='-control']") || input.parentElement;

    // Open the menu: click + ArrowDown (more reliable than click alone)
    wrap.click();
    await sleep(200);
    input.focus();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", keyCode: 40, bubbles: true }));
    await sleep(250);

    function collectOptions() {
      // React-select options can live in a portal; check several selectors
      const sels = [
        "[role='option']",
        "[id*='-option-']",
        "[class*='option']",
        "div[class*='menu'] div[class*='option']"
      ];
      const seen = new Set();
      const out = [];
      for (const sel of sels) {
        document.querySelectorAll(sel).forEach(el => {
          if (seen.has(el) || el.offsetParent === null) return;
          const t = el.textContent.trim();
          if (!t || t.length > 80) return;
          seen.add(el);
          out.push({ el, txt: t });
        });
      }
      return out;
    }

    // First try: open menu and pick without typing (best for Title - few options)
    let opts = collectOptions();
    if (!opts.length) {
      // Type a short prefix to help filter, then collect again
      await humanType(input, text.slice(0, 3));
      for (let attempt = 0; attempt < 5; attempt++) {
        await sleep(200);
        opts = collectOptions();
        if (opts.length) break;
      }
    }
    log("     " + opts.length + " option(s) visible");
    if (!opts.length) {
      // Last try: clear and type full text
      await clearReactSelect(labelText);
      wrap.click();
      await sleep(200);
      input.focus();
      await humanType(input, text);
      for (let attempt = 0; attempt < 5; attempt++) {
        await sleep(220);
        opts = collectOptions();
        if (opts.length) break;
        log("     waiting for options... (" + (attempt + 1) + ")");
      }
      log("     " + opts.length + " option(s) visible after type");
    }
    if (!opts.length) return false;

    const stopWords = new Set([
      "the", "of", "and", "a", "an", "republic", "state", "states",
      "union", "united", "federation", "kingdom", "islands", "island",
      "province", "territory", "region", "country", "nation",
      "democratic", "people's", "peoples", "arab", "islamic"
    ]);

    function norm(s) {
      return String(s).toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9 ]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }
    function normTitle(s) {
      return norm(s).replace(/\b(mr|mrs|ms|miss|dr)\s*$/, "$1");
    }
    function words(s) {
      return norm(s).split(" ").filter(w => w && !stopWords.has(w));
    }
    function primaryWord(s) {
      const w = words(s);
      return w.length ? w[0] : norm(s);
    }
    function lev(a, b) {
      const m = a.length, n = b.length;
      if (!m) return n;
      if (!n) return m;
      const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
      for (let i = 0; i <= m; i++) dp[i][0] = i;
      for (let j = 0; j <= n; j++) dp[0][j] = j;
      for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
          dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1]
            : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
        }
      }
      return dp[m][n];
    }
    function similarity(a, b) {
      const A = norm(a), B = norm(b);
      if (!A || !B) return 0;
      return 1 - lev(A, B) / Math.max(A.length, B.length);
    }
    function scoreOption(optTxt) {
      const a = norm(optTxt), b = norm(text);
      const titleA = normTitle(optTxt), titleB = normTitle(text);
      if (titleA === titleB) return 1000;
      if (a === b) return 1000;
      const aw = words(optTxt), bw = words(text);
      const overlap = aw.filter(w => bw.includes(w)).length;
      const unionSize = new Set([...aw, ...bw]).size;
      const jaccard = unionSize ? overlap / unionSize : 0;
      const sim = similarity(optTxt, text);
      const primaryMatch = primaryWord(optTxt) === primaryWord(text) ? 1 : 0;
      return primaryMatch * 50 + overlap * 10 + jaccard * 20 + sim * 15;
    }

    let best = null, bestScore = 0;
    for (const o of opts) {
      const s = scoreOption(o.txt);
      if (s > bestScore) { bestScore = s; best = o; }
    }
    log("     best match: \"" + (best ? best.txt : "none") + "\" (score " + bestScore.toFixed(1) + ")");

    if (best && bestScore >= 30) {
      best.el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
      best.el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
      best.el.click();
      await sleep(300);
      const selected = input.closest("[class*='-control']")?.querySelector("[class*='singleValue']");
      const selectedNorm = selected ? normTitle(selected.textContent) : "";
      const wantedNorm = normTitle(text);
      const ok = selected && (selectedNorm === wantedNorm ||
                              selectedNorm.indexOf(wantedNorm) >= 0 ||
                              wantedNorm.indexOf(selectedNorm) >= 0);
      if (!ok) {
        input.focus();
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
        await sleep(250);
      }
      const selectedAfter = input.closest("[class*='-control']")?.querySelector("[class*='singleValue']");
      const afterNorm = selectedAfter ? normTitle(selectedAfter.textContent) : "";
      const okAfter = selectedAfter && (afterNorm === wantedNorm ||
                                        afterNorm.indexOf(wantedNorm) >= 0 ||
                                        wantedNorm.indexOf(afterNorm) >= 0);
      if (!okAfter) {
        log("     option was visible but React did not commit (got \"" + (selectedAfter ? selectedAfter.textContent : "empty") + "\")", "warn");
        return false;
      }
      return true;
    }

    log("     no good match for \"" + text + "\" (best=" + bestScore.toFixed(1) + ")", "warn");
    opts.slice(0, 40).forEach(o => log("       . " + o.txt));
    input.dispatchEvent(new KeyboardEvent("keydown",
      { key: "Escape", keyCode: 27, bubbles: true }));
    await sleep(100);
    return false;
  }


  function findByText(sel, text) {
    const w = text.toLowerCase();
    return Array.from(document.querySelectorAll(sel))
      .find(el => el.textContent.trim().toLowerCase() === w) || null;
  }
  function findByTextContains(sel, text) {
    const w = text.toLowerCase();
    return Array.from(document.querySelectorAll(sel))
      .find(el => el.textContent.trim().toLowerCase().indexOf(w) >= 0) || null;
  }

  function findModalOkButton() {
    const byClass = document.querySelector("button.css-1abo4v2");
    if (byClass && byClass.offsetParent !== null) return byClass;
    const btns = Array.from(document.querySelectorAll("button, [role='button']"));
    for (const b of btns) {
      if (b.offsetParent === null) continue;
      const t = b.textContent.trim().toLowerCase();
      if (t === "ok" || t === "okay" || t === "close") return b;
    }
    return null;
  }
  function isModalOpen() { return !!findModalOkButton(); }

  async function dismissModalIfPresent(maxWaitMs) {
    maxWaitMs = maxWaitMs || 2000;
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const ok = findModalOkButton();
      if (ok) {
        const dialog = ok.closest("[role='dialog'], [role='alertdialog'], [aria-modal='true']")
                    || ok.closest("div[class*='modal'], div[class*='Modal'], div[class*='overlay']")
                    || (ok.parentElement && ok.parentElement.parentElement);
        const modalText = dialog ? dialog.innerText.trim() : "";
        window.__lastModalText = modalText;
        log("  modal text: \"" + modalText.replace(/\s+/g, " ").slice(0, 200) + "\"");
        try { ok.scrollIntoView({ block: "center" }); } catch (e) {}
        await sleep(50);
        ok.click();
        await sleep(250);
        const ok2 = findModalOkButton();
        if (ok2) {
          ok2.click();
          await sleep(250);
        }
        return true;
      }
      await sleep(120);
    }
    return false;
  }

  function isLandingPage() {
    if (isModalOpen()) return false;
    return !!(findByText("button", "Sign up to ALL for free") ||
              findByTextContains("button", "sign up to all for free"));
  }

  function detectResult() {
    const matchedUrl = isSuccessUrl(location.href);
    if (matchedUrl) { log("  reason: success URL " + matchedUrl); return "success"; }

    const mt = (window.__lastModalText || "").toLowerCase();
    if (mt) {
      const snippet = window.__lastModalText.slice(0, 100).replace(/\s+/g, " ");
      if (mt.indexOf("already have an account") >= 0 ||
          mt.indexOf("already registered") >= 0 ||
          mt.indexOf("please login") >= 0 ||
          mt.indexOf("already a member") >= 0 ||
          mt.indexOf("existing account") >= 0) {
        log("  reason: modal \"" + snippet + "\"");
        return "already_member";
      }
      if (mt.indexOf("undeliverable") >= 0 ||
          mt.indexOf("invalid email") >= 0 ||
          mt.indexOf("cannot be delivered") >= 0) {
        log("  reason: modal \"" + snippet + "\"");
        return "bad_email";
      }
      if (mt.indexOf("welcome") >= 0 || mt.indexOf("thank you") >= 0 ||
          mt.indexOf("successfully") >= 0 || mt.indexOf("you are now") >= 0 ||
          mt.indexOf("congratulations") >= 0 || mt.indexOf("enrolled") >= 0) {
        log("  reason: modal \"" + snippet + "\"");
        return "success";
      }
      if (mt.indexOf("invalid") >= 0 || mt.indexOf("error") >= 0 ||
          mt.indexOf("failed") >= 0) {
        log("  reason: modal \"" + snippet + "\"");
        return "bad_data";
      }
      log("  reason: modal unrecognized \"" + snippet + "\"");
      return "modal_other";
    }

    if (window.__lastAuthError) { log("  reason: auth error"); return "auth_hang"; }

    const r = window.__lastEnrollResult;
    if (r) {
      if (r.status >= 200 && r.status < 300) {
        try {
          const j = JSON.parse(r.body);
          const m = ((j.Message || j.message || "") + "").toLowerCase();
          if (m.indexOf("undeliverable") >= 0) return "bad_email";
          if (m.indexOf("already") >= 0)       return "already_member";
          if (m.indexOf("invalid") >= 0)       return "bad_data";
        } catch (e) {}
        log("  reason: XHR " + r.status);
        return "success";
      }
      try {
        const j = JSON.parse(r.body);
        const m = ((j.Message || j.message || "") + "").toLowerCase();
        log("  reason: XHR " + r.status + " body: \"" + m.slice(0, 150) + "\"");
        if (m.indexOf("undeliverable") >= 0) return "bad_email";
        if (m.indexOf("already") >= 0)       return "already_member";
        if (m.indexOf("invalid") >= 0)       return "bad_data";
      } catch (e) {}
      log("  reason: XHR " + r.status);
      return "bad_data";
    }

    const submitStill = document.querySelector("button[type=submit]") ||
                        findByText("button", "Become a member");
    if (!submitStill) { log("  reason: submit gone"); return "success_stuck"; }

    log("  reason: no signal after " + (POST_SUBMIT_MAX / 1000) + "s");
    return "unclear";
  }

  (function installInterceptors() {
    if (window.__accorInterceptor) return;
    window.__accorInterceptor = true;
    const oOpen = XMLHttpRequest.prototype.open;
    const oSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) {
      this.__url = u;
      return oOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (body) {
      const u = this.__url || "";
      if (u.indexOf("/accor/enroll") >= 0) {
        this.addEventListener("load", function () {
          window.__lastEnrollResult = { status: this.status, body: this.responseText, attempted: true };
          log("enroll response: " + this.status);
        });
      }
      return oSend.apply(this, arguments);
    };
    const oFetch = window.fetch;
    if (oFetch) {
      window.fetch = function (input, init) {
        const url = (typeof input === "string") ? input : (input && input.url) || "";
        const p = oFetch.apply(this, arguments);
        if (url.indexOf("/accor/enroll") >= 0) {
          p.then(res => res.clone().text().then(t => {
            window.__lastEnrollResult = { status: res.status, body: t, attempted: true };
            log("enroll fetch response: " + res.status);
          })).catch(() => {});
        }
        return p;
      };
    }
    window.addEventListener("message", ev => {
      try {
        const s = (typeof ev.data === "string") ? ev.data : JSON.stringify(ev.data);
        if (s && s.indexOf("login_required") >= 0) {
          window.__lastAuthError = s;
          log("postMessage: login_required", "warn");
        }
      } catch (e) {}
    });
  })();

  async function goHome() {
    await dismissModalIfPresent(1500);
    if (isLandingPage()) return;
    for (let i = 0; i < 6; i++) {
      if (isLandingPage()) break;
      history.back();
      await sleep(300);
    }
    if (isLandingPage()) return;
    log("  hard nav to portal URL");
    location.href = portalUrl;
  }

  async function openSignupForm() {
    await dismissModalIfPresent(1000);
    let btn = findByText("button", "Sign up to ALL for free")
           || findByTextContains("button", "sign up to all for free");
    if (!btn) {
      await goHome();
      btn = findByText("button", "Sign up to ALL for free")
         || findByTextContains("button", "sign up to all for free");
    }
    if (!btn) throw new Error("signup button not found");
    btn.scrollIntoView({ block: "center" });
    await sleep(100);
    btn.click();
    await waitFor(() => inputByLabel("First name"), { name: "form", timeout: 10000 });
  }

  async function waitForOutcome(maxMs) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const sc = await cget([STOP_SIGNAL]);
      if (sc[STOP_SIGNAL] === true) return;
      const m = isSuccessUrl(location.href);
      if (m) { window.__lastSuccessUrl = location.href; log("  SUCCESS URL: " + m); return; }
      if (window.__lastEnrollResult) { await sleep(200); return; }
      if (window.__lastAuthError)    { await sleep(200); return; }
      if (isModalOpen())             { await sleep(200); return; }
      const body = document.body.innerText.toLowerCase();
      if (body.indexOf("already have an account") >= 0 ||
          body.indexOf("email undeliverable") >= 0 ||
          body.indexOf("welcome") >= 0 ||
          body.indexOf("thank you") >= 0) { await sleep(200); return; }
      const submit = document.querySelector("button[type=submit]") ||
                     findByText("button", "Become a member");
      if (!submit) { await sleep(300); return; }
      await sleep(POST_SUBMIT_POLL);
    }
  }

  async function processOne(rec, idx, total) {
    await cset({ [CURRENT_KEY]: { index: idx + 1, total, conf: rec.conf, name: rec.first_name + " " + rec.last_name, title: rec.title, country: rec.country, phone: rec.phone ? "provided" : "not provided", email: "provided" } });
    log("═════ [" + (idx + 1) + "/" + total + "] " + rec.first_name + " " + rec.last_name + " · " + rec.conf + " ═════");
    window.__lastEnrollResult = null;
    window.__lastAuthError    = null;
    window.__lastModalText    = null;
    window.__lastSuccessUrl   = null;

    await goHome();
    await openSignupForm();

    await clearReactSelect("Title");
    await clearReactSelect("Country");
    const fnEl = inputByLabel("First name");
    const lnEl = inputByLabel("Family name");
    const emEl = inputByLabel("Email address");
    const phEl = inputByLabel("Phone number") || inputByLabel("Phone")
              || inputByLabel("Mobile number") || inputByLabel("Mobile");
    if (fnEl) setReactInput(fnEl, "");
    if (lnEl) setReactInput(lnEl, "");
    if (emEl) setReactInput(emEl, "");
    if (phEl) setReactInput(phEl, "");

    let titleOk = await pickTitle(rec.title || DEFAULT_TITLE);
    if (!titleOk) {
      // one more attempt after a short pause (menu sometimes slow)
      await sleep(400);
      titleOk = await pickTitle(rec.title || DEFAULT_TITLE);
    }
    if (!titleOk) {
      log("  Title selection failed — skipping this record", "warn");
      results.push({ email: rec.email, conf: rec.conf, status: "title_not_committed" });
      await persist(idx + 1);
      return { status: "title_not_committed" };
    }
    if (diagnosticOnly) {
      log("DIAGNOSTIC: title selection committed; stopping before any submission", "info");
      results.push({ email: rec.email, conf: rec.conf, status: "diagnostic_title_ok" });
      await persist(idx + 1);
      return { status: "diagnostic_title_ok" };
    }
    await humanType(inputByLabel("First name"), rec.first_name);
    await humanType(inputByLabel("Family name"), rec.last_name);
    await humanType(inputByLabel("Email address"), rec.email);
    if (phEl) await humanType(phEl, rec.phone);
    const cOk = await pickReactSelectByLabel("Country", rec.country);

    if (cOk === false) return { status: "country_not_found: " + rec.country };

    const submit = await waitFor(() => {
      return document.querySelector("button[type=submit]") ||
             findByText("button", "Become a member");
    }, { name: "submit", timeout: 10000 });

    if (submit.disabled) return { status: "disabled" };

    await sleep(300 + Math.random() * 400);
    await persist(idx);

    submit.scrollIntoView({ block: "center" });
    await sleep(150 + Math.random() * 150);
    submit.click();
    log("  clicked submit");

    await waitForOutcome(POST_SUBMIT_MAX);
    await dismissModalIfPresent(1500);

    const status = detectResult();
    log("  ✅ result: " + status);

    results.push({ email: rec.email, conf: rec.conf, status: status });
    await persist(idx + 1);

    if (status === "success" || status === "success_stuck" ||
        status === "auth_hang" || status === "already_member" ||
        status === "modal_other" || status === "unclear") {
      log("  closing tab + opening fresh tab...");
      await sleep(400);
      try {
        chrome.runtime.sendMessage({ type: "freshTab", portalUrl: portalUrl });
      } catch (e) {
        log("  freshTab failed, reloading instead", "warn");
        location.reload();
      }
      return { status: status };
    }

    try { await goHome(); } catch (e) {}
    return { status: status };
  }

  for (let i = startIndex; i < records.length; i++) {
    const sc = await cget([ENABLED_KEY, STOP_SIGNAL]);
    if (sc[ENABLED_KEY] !== true || sc[STOP_SIGNAL] === true) {
      log("⏸ stop signal — halting before record " + (i + 1));
      break;
    }
    let status = "crash";
    try {
      const r = await processOne(records[i], i, records.length);
      status = r.status;
    } catch (e) {
      log("  ❌ " + records[i].email + ": " + e.message, "error");
      status = "error: " + e.message;
      results.push({ email: records[i].email, conf: records[i].conf, status: status });
      await persist(i + 1);   // advance past the failed record
      log("  ⏭ skipping failed record, continuing to next...");
    }
    if (i < records.length - 1) await sleep(BETWEEN_GUESTS);
  }

  await cset({ [CURRENT_KEY]: null });
  log("══════ SUMMARY ══════");
  const counts = {};
  results.forEach(r => {
    counts[r.status] = (counts[r.status] || 0) + 1;
    log("  " + r.status + "  " + r.email);
  });
  Object.keys(counts).forEach(k => log("    " + k + ": " + counts[k]));

  if (results.length >= records.length) {
    log("🎉 All records processed");
    await cset({
      [LOOP_STATE_KEY]: {
        active: false, nextIndex: records.length, totalRecords: records.length,
        results: results, startedAt: loopState.startedAt
      },
      [ENABLED_KEY]: false
    });
  } else {
    log("⏸ Paused at " + results.length + "/" + records.length);
  }
})();