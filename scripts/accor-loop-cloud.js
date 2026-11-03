'use strict';
const fs = require('fs');
const path = require('path');
require('./accor-loop-navigation-diagnostics.js');
const ROOT = path.join(__dirname, '..');
const E = process.env;
const mask = s => String(s || '').replace(/\S+@\S+/g, '•@•').replace(/\d{6,}/g, d => '••••' + d.slice(-4)).slice(0, 180);

const CON = [];
let ACTIVE_FB = null;

const publishError = async message => {
  const m = mask(message);
  tlog('ERR', m);
  if (!ACTIVE_FB) return;
  try {
    await ACTIVE_FB.patch('enrollJob', { state: 'error', error: m, errorAt: Date.now() });
    await ACTIVE_FB.patch('enrollLive', { at: Date.now(), state: 'error', step: 'error', note: m, action: m, con: CON.slice(-80) });
  } catch (_) {}
};
const tlog = (g, s) => { const m = mask(s); CON.push({ t: Date.now(), g, m }); if (CON.length > 80) CON.splice(0, CON.length - 80); return m; };
const say = s => { const m = tlog('SYS', s); console.log(new Date().toISOString().slice(11, 19) + '  ' + m); };
const fail = (s, code = 1) => { const m = tlog('ERR', s); console.error('::error::' + m); process.exit(code); };
const key = e => String(e || '').toLowerCase().replace(/[.#$\[\]/@]/g, '_');

const safePageEvaluate = async (page, label, fn, fallbackValue = null) => {
  try {
    return await page.evaluate(fn);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    if (/Execution context was destroyed|Target page, context or browser has been closed|page has crashed|navigation/i.test(message)) {
      tlog('WARN', `${label}: page navigation or reload destroyed the execution context. ${message}`);
      try {
        const currentUrl = page && page.url ? page.url() : null;
        if (currentUrl) tlog('WARN', `Last known portal URL: ${currentUrl}`);
      } catch (_) {}
      return fallbackValue;
    }
    throw error;
  }
};

function firebaseConfig() {
  const src = fs.readFileSync(path.join(ROOT, 'firebase-config.js'), 'utf8');
  const get = k => (src.match(new RegExp(k + '\\s*:\\s*["\\\']([^"\\\']+)["\\\']')) || [, ''])[1];
  return { apiKey: get('apiKey'), databaseURL: get('databaseURL') };
}

async function hotelDb() {
  const c = firebaseConfig();
  const base = String(E.FB_DB_URL || c.databaseURL || '').replace(/\/$/, '');
  if (!c.apiKey || !base) fail('Firebase configuration is missing');
  const authUrl = String(E.FB_AUTH_URL || 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword');
  const r = await fetch(authUrl + '?key=' + encodeURIComponent(c.apiKey), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: String(E.HOTELOPS_EMAIL || ''), password: String(E.HOTELOPS_PASS || ''), returnSecureToken: true }) });
  const a = await r.json().catch(() => ({}));
  if (!r.ok || !a.idToken) fail('HotelOps sign-in refused — check HOTELOPS_EMAIL / HOTELOPS_PASS');
  let hid = String(E.HOTELOPS_HOTEL || '').trim();
  if (!hid) {
    const u = await (await fetch(base + '/userHotels/' + encodeURIComponent(a.localId) + '.json?auth=' + encodeURIComponent(a.idToken))).json().catch(() => null);
    hid = typeof u === 'string' ? u : u && typeof u === 'object' ? String(u.hotelId || u.id || Object.keys(u)[0] || '') : '';
  }
  if (!/^[\w-]{1,80}$/.test(hid)) fail('No HotelOps hotel was found for this account');
  const at = p => base + '/hotels/' + encodeURIComponent(hid) + '/' + p + '.json?auth=' + encodeURIComponent(a.idToken);
  const request = async (p, method, body) => {
    const x = await fetch(at(p), { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await x.text().catch(() => '');
    if (!x.ok && text) {
      try {
        const errorJson = JSON.parse(text);
        if (errorJson && errorJson.error) throw new Error(String(errorJson.error.message || text));
      } catch (_) {}
      throw new Error('Firebase request failed: ' + text.slice(0, 200));
    }
    try { return text ? JSON.parse(text) : null; } catch (_) { return text; }
  };
  return { get: p => request(p, 'GET'), patch: (p, v) => request(p, 'PATCH', v), put: (p, v) => request(p, 'PUT', v) };
}

function consenting(tsv) {
  const lines = String(tsv || '').split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const h = lines[0].split('\t').map(x => x.trim().toLowerCase());
  const at = re => h.findIndex(x => re.test(x));
  const ci = at(/^consent$|agreed/), civ = at(/^civility$|title|salutation/), ni = at(/^name$|guest.?name/), ei = at(/mail/), pi = at(/phone|mobile/), co = at(/national|country/), fi = at(/confirm|confirmation|ref|guest.?id/);
  if (ci < 0 || ni < 0 || ei < 0) return [];
  return lines.slice(1).map(line => line.split('\t')).filter(c => /^(y|yes|1|✓|true|x)$/i.test((c[ci] || '').trim()) && (c[civ] || '').trim() && /@/.test(c[ei] || '')).map(c => ({ conf: c[fi] || '', title: (c[civ] || '').trim(), name: (c[ni] || '').trim(), email: (c[ei] || '').trim(), phone: (c[pi] || '').trim(), country: (c[co] || '').trim() }));
}

function pipeRows(rows) { return rows.map(r => [r.conf, r.title, r.name, r.email, r.phone, r.country].map(x => String(x || '').replace(/[|\r\n]/g, '/')).join('|')).join('\n') + '\n'; }

async function main() {
  const miss = ['HOTELOPS_EMAIL', 'HOTELOPS_PASS', 'HOTELOPS_HOTEL'].filter(k => !String(E[k] || '').trim());
  if (miss.length) fail('Missing secrets: ' + miss.join(', '));

  const FB = await hotelDb();
  ACTIVE_FB = FB;

  const job = await FB.get('enrollJob');
  const rows = consenting(job && job.tsv);
  const test = /^(1|true|yes)$/i.test(String(E.TEST || '')) || !!(job && job.test);
  if (!rows.length) fail('No consenting guests with civility and email were found in enrollJob');

  const tag = String(E.TAG || (job && job.tag) || ('accor' + Date.now().toString(36))).slice(0, 40);
  const live = p => FB.patch('enrollLive', Object.assign({ at: Date.now(), tag, con: CON.slice(-60) }, p)).catch(() => {});
  const stopRequested = async () => { try { const v = await FB.get('enrollLive'); return v && v.tag === tag && (v.control === 'stop' || v.stopRequested === true); } catch (_) { return false; } };
  const markStopped = async note => { tlog('STOP', note); await FB.patch('enrollJob', { state: 'stopped', stoppedAt: Date.now() }); await live({ state: 'stopped', step: 'stopped', note, con: CON.slice(-60) }); };

  await FB.put('enrollLive', { at: Date.now(), started: Date.now(), state: 'run', step: 'open', tag, test, n: rows.length, done: 0, control: 'run', note: 'Opening Accor Loop portal…', con: CON.slice(-60) });
  say((test ? 'TEST RUN — nothing will be submitted · ' : '') + 'Starting ' + rows.length + ' consenting guest(s)');
  await live({ step: 'open', note: test ? 'Test run started — opening Accor Loop…' : 'Accor Loop cloud run started — opening portal…' });

  let chromium; try { ({ chromium } = require('playwright')); } catch (_) { try { ({ chromium } = require('playwright-core')); } catch (_) { fail('Playwright is not installed'); } }
  const executablePath = [E.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(p => p && fs.existsSync(p));
  const browser = await chromium.launch(executablePath ? { executablePath, headless: true } : { headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'en-GB', timezoneId: 'Asia/Dubai' });
  const page = await context.newPage();

  page.on('console', m => {
    const t = m.text();
    if (/SUCCESS|result:|SUMMARY|error|warn|parsed|starting|processed|All records|loaded|portal|guest|Title|Country|submit|form|fresh|skipped|enrolled|member|diagnostic/i.test(t)) {
      const level = m.type() === 'error' ? 'ERR' : /warn/i.test(m.type()) ? 'WARN' : 'BOT';
      tlog(level, t); live({ step: 'enroll', action: mask(t), note: mask(t) });
    }
  });
  page.on('pageerror', e => { const m = 'Browser page error: ' + (e && e.message || e); tlog('ERR', m); live({ step: 'browser-error', action: mask(m), note: mask(m) }); });
  page.on('requestfailed', r => { const m = 'Network request failed: ' + r.url() + ' · ' + ((r.failure() || {}).errorText || 'unknown'); tlog('WARN', m); live({ step: 'network', action: mask(m), note: mask(m) }); });
  page.on('framenavigated', frame => {
    if (frame && frame === page.mainFrame()) {
      const nextUrl = frame.url();
      if (nextUrl) tlog('NAV', `Main page navigated to ${nextUrl}`);
    }
  });

  const state = { __accor_portal_url: String(E.PORTAL_URL || 'https://secure.guestinternet.com/portal-system/portal/'), __accor_records: pipeRows(rows), __accor_enabled: true, __accor_test: !!test, __accor_cloud_run: true, __accor_stop_signal: false };
  await page.addInitScript(s => {
    const seed = s;
    Object.keys(seed).forEach(k => localStorage.setItem('__accor_cloud_' + k, JSON.stringify(seed[k])));
    const read = k => { try { const v = localStorage.getItem('__accor_cloud_' + k); return v == null ? null : JSON.parse(v); } catch (_) { return null; } };
    window.chrome = { storage: { local: { get(keys, cb) { const names = Array.isArray(keys) ? keys : Object.keys(keys || {}); const out = {}; names.forEach(k => out[k] = read(k)); if (cb) cb(out); return out; }, set(obj, cb) { Object.keys(obj || {}).forEach(k => localStorage.setItem('__accor_cloud_' + k, JSON.stringify(obj[k]))); if (cb) cb(); } } } };
  }, state);

  try {
    say('Opening Accor Loop portal…');
    await live({ step: 'open', note: 'Opening Accor Loop portal…' });
    await page.goto(state.__accor_portal_url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    say('Portal loaded · starting the enrollment worker…');
    await page.waitForTimeout(1200);

    const workerSource = fs.readFileSync(path.join(ROOT, 'scripts', 'accor-loop-content.js'), 'utf8');
    await page.evaluate(src => {
      const s = document.createElement('script');
      s.type = 'text/javascript';
      s.textContent = src;
      (document.head || document.documentElement).appendChild(s);
    }, workerSource);

    say(test ? 'Test mode: checking the form — nothing will be submitted…' : 'Enrollment worker is running…');
    await live({ step: 'enroll', note: test ? 'Test mode: checking the form, nothing will be submitted…' : 'Enrollment worker is running…' });

    let done = false, seenWorkerLogs = 0, workerStartedAt = Date.now(), lastWorkerEvidence = Date.now();
    for (let i = 0; i < 3600 && !done; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const currentGuest = await safePageEvaluate(page, 'current guest poll', () => { try { return JSON.parse(localStorage.getItem('__accor_cloud___accor_current_guest') || 'null'); } catch (_) { return null; } }, null);
      const workerLogs = await safePageEvaluate(page, 'worker log poll', () => { try { return JSON.parse(localStorage.getItem('__accor_cloud___accor_logs') || '[]'); } catch (_) { return []; } }, []);

      if (Array.isArray(workerLogs) && workerLogs.length > seenWorkerLogs) {
        workerLogs.slice(seenWorkerLogs).forEach(x => tlog(x.level === 'error' ? 'ERR' : x.level === 'warn' ? 'WARN' : 'BOT', x.msg));
        seenWorkerLogs = workerLogs.length;
        lastWorkerEvidence = Date.now();
        await live({ step: 'enroll', action: mask((workerLogs[workerLogs.length - 1].msg || 'Worker activity')), note: mask(workerLogs[workerLogs.length - 1].msg || 'Worker activity') });
      }
      if (Array.isArray(workerLogs) && workerLogs.length) lastWorkerEvidence = Date.now();

      if (i % 3 === 0 && await stopRequested()) {
        await safePageEvaluate(page, 'stop signal poll', () => { try { localStorage.setItem('__accor_cloud___accor_stop_signal', JSON.stringify(true)); } catch (_) {} }, null);
        await markStopped('Stopped from HotelOps — no more guests will be submitted.');
        return;
      }

      const s = await safePageEvaluate(page, 'worker state poll', () => {
        const read = k => { try { return JSON.parse(localStorage.getItem('__accor_cloud_' + k)); } catch (_) { return null; } };
        return { enabled: read('__accor_enabled'), state: read('__accor_state'), loop: read('__accor_loop_state') };
      }, { enabled: true, state: null, loop: null });

      if (currentGuest || (s && s.state)) lastWorkerEvidence = Date.now();
      if (Date.now() - workerStartedAt > 45000 && Date.now() - lastWorkerEvidence > 45000) {
        throw new Error('Enrollment worker produced no activity after portal load. The cloud browser could not start the shared extension worker.');
      }
      done = !!(s && s.enabled === false);
      if (i % 3 === 0) await live({ step: 'enroll', done: Math.max(0, Math.min(rows.length, Number((s && s.state && s.state.nextIndex) || 0))), current: currentGuest || null, action: currentGuest ? 'Enrolling guest' : 'Waiting for portal activity' });
    }

    const result = await safePageEvaluate(page, 'final result poll', () => { try { return JSON.parse(window.localStorage.getItem('__accor_cloud___accor_loop_state') || '{}'); } catch (_) { return {}; } }, {});
    const results = Array.isArray(result.results) ? result.results : [];
    const patch = {}; const today = new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);
    results.forEach(r => { if (r && /@/.test(r.email || '')) patch[key(r.email)] = { email: String(r.email).toLowerCase(), status: String(r.status || 'unknown'), date: today, name: String(r.name || ''), conf: String(r.conf || '') }; });
    if (!test && Object.keys(patch).length) await FB.patch('enrollLog', patch);
    await FB.patch('enrollJob', { state: 'done', doneAt: Date.now() });
    say('Finished: ' + results.length + ' result(s)' + (test ? ' (test only)' : ' saved to Enrollment tracker'));
    tlog('SAVE', test ? 'Test complete · nothing submitted' : 'Results written to Enrollment tracker');
    await live({ state: 'done', step: 'done', done: results.length, n: rows.length, note: test ? 'Test run complete — nothing was submitted.' : results.length + ' results saved in the Enrollment tracker.' });
  } finally {
    await browser.close().catch(() => {});
  }
}

if (require.main === module) main().catch(async e => {
  const message = 'Stopped: ' + (e && e.stack || e && e.message || e);
  await publishError(message);
  fail(message);
});

module.exports = { consenting, pipeRows };
