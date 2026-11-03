'use strict';
const fs = require('fs');
const path = require('path');
require('./accor-loop-navigation-diagnostics.js');
const ROOT = path.join(__dirname, '..');
const E = process.env;
const mask = s => String(s || '').replace(/\S+@\S+/g, '•@•').replace(/\d{6,}/g, d => '••••' + d.slice(-4)).slice(0, 180);
const CON = [];
let ACTIVE_FB = null;
let sensitiveValues = [];

function scrub(message) {
  let value = mask(message);
  for (const secret of sensitiveValues) {
    if (secret) value = value.split(secret).join('[guest]');
  }
  return value;
}
function tlog(group, message) {
  const entry = { t: Date.now(), g: group, m: scrub(message) };
  CON.push(entry);
  if (CON.length > 80) CON.splice(0, CON.length - 80);
  return entry.m;
}
const say = message => console.log(new Date().toISOString().slice(11, 19) + '  ' + tlog('SYS', message));
const key = email => String(email || '').toLowerCase().replace(/[.#$\[\]/@]/g, '_');
const fail = (message, code = 1) => {
  const safe = tlog('ERR', message);
  console.error('::error::' + safe);
  process.exit(code);
};

async function publishError(message) {
  const safe = tlog('ERR', message);
  if (!ACTIVE_FB) return;
  try {
    await ACTIVE_FB.patch('enrollJob', { state: 'error', error: safe, errorAt: Date.now() });
    await ACTIVE_FB.patch('enrollLive', {
      at: Date.now(), state: 'error', step: 'error', note: safe, action: safe,
      con: CON.slice(-60), report: null
    });
  } catch (_) {}
}

const safePageEvaluate = async (page, label, fn, fallback = null) => {
  try {
    return await page.evaluate(fn);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    if (/Execution context was destroyed|Target page, context or browser has been closed|page has crashed|navigation/i.test(message)) {
      tlog('WARN', `${label}: portal navigated or reloaded; waiting for its page context to return.`);
      try {
        const currentUrl = page.url();
        if (currentUrl) tlog('NAV', `Current portal page: ${new URL(currentUrl).origin}${new URL(currentUrl).pathname}`);
      } catch (_) {}
      return fallback;
    }
    throw error;
  }
};

function firebaseConfig() {
  const src = fs.readFileSync(path.join(ROOT, 'firebase-config.js'), 'utf8');
  const get = name => (src.match(new RegExp(name + '\\s*:\\s*["\\']([^"\\']+)["\\']')) || [, ''])[1];
  return { apiKey: get('apiKey'), databaseURL: get('databaseURL') };
}

async function hotelDb() {
  const config = firebaseConfig();
  const base = String(E.FB_DB_URL || config.databaseURL || '').replace(/\/$/, '');
  if (!config.apiKey || !base) fail('Firebase configuration is missing');
  const authUrl = String(E.FB_AUTH_URL || 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword');
  const response = await fetch(authUrl + '?key=' + encodeURIComponent(config.apiKey), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: String(E.HOTELOPS_EMAIL || ''), password: String(E.HOTELOPS_PASS || ''), returnSecureToken: true })
  });
  const auth = await response.json().catch(() => ({}));
  if (!response.ok || !auth.idToken) fail('HotelOps sign-in refused — check HOTELOPS_EMAIL / HOTELOPS_PASS');
  let hotelId = String(E.HOTELOPS_HOTEL || '').trim();
  if (!hotelId) {
    const lookup = await fetch(base + '/userHotels/' + encodeURIComponent(auth.localId) + '.json?auth=' + encodeURIComponent(auth.idToken));
    const hotels = await lookup.json().catch(() => null);
    hotelId = typeof hotels === 'string' ? hotels : hotels && typeof hotels === 'object'
      ? String(hotels.hotelId || hotels.id || Object.keys(hotels)[0] || '') : '';
  }
  if (!/^[\w-]{1,80}$/.test(hotelId)) fail('No HotelOps hotel was found for this account');
  const endpoint = p => base + '/hotels/' + encodeURIComponent(hotelId) + '/' + p + '.json?auth=' + encodeURIComponent(auth.idToken);
  const request = async (p, method, body) => {
    const r = await fetch(endpoint(p), {
      method, headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await r.text().catch(() => '');
    if (!r.ok) throw new Error(`Firebase ${method} ${p} failed (${r.status})`);
    try { return text ? JSON.parse(text) : null; } catch (_) { return text; }
  };
  return { get: p => request(p, 'GET'), patch: (p, v) => request(p, 'PATCH', v), put: (p, v) => request(p, 'PUT', v) };
}

function consenting(tsv) {
  const lines = String(tsv || '').split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].split('\t').map(x => x.trim().toLowerCase());
  const at = regex => header.findIndex(x => regex.test(x));
  const consent = at(/^consent$|agreed/), civility = at(/^civility$|title|salutation/);
  const name = at(/^name$|guest.?name/), email = at(/mail/), phone = at(/phone|mobile/);
  const country = at(/national|country/), confirmation = at(/confirm|confirmation|ref|guest.?id/);
  if (consent < 0 || civility < 0 || name < 0 || email < 0) return [];
  return lines.slice(1).map(line => line.split('\t'))
    .filter(c => /^(y|yes|1|✓|true|x)$/i.test((c[consent] || '').trim()) && (c[civility] || '').trim() && /@/.test(c[email] || ''))
    .map(c => ({
      conf: c[confirmation] || '', title: (c[civility] || '').trim(), name: (c[name] || '').trim(),
      email: (c[email] || '').trim(), phone: (c[phone] || '').trim(), country: (c[country] || '').trim()
    }));
}
function pipeRows(rows) {
  return rows.map(r => [r.conf, r.title, r.name, r.email, r.phone, r.country]
    .map(x => String(x || '').replace(/[|\r\n]/g, '/')).join('|')).join('\n') + '\n';
}
function resultReport(results, total) {
  const count = status => results.filter(r => r.status === status).length;
  const submitted = count('success') + count('success_stuck');
  const already = count('already_member');
  const pending = count('pending-account');
  const skipped = results.filter(r => /^skipped:|^title_not_committed|^country_not_found/.test(String(r.status || ''))).length;
  const errors = results.filter(r => /error|timeout|unclear|bad_data|bad_email|auth_hang|modal_other/i.test(String(r.status || ''))).length;
  const other = Math.max(0, results.length - submitted - already - pending - skipped - errors);
  return {
    processed: results.length, total, submitted, alreadyMember: already, pending,
    skipped, errors, other, complete: results.length >= total,
    statuses: results.reduce((out, r) => {
      const status = String(r && r.status || 'unknown');
      out[status] = (out[status] || 0) + 1;
      return out;
    }, {})
  };
}
function reportNote(report, test) {
  const prefix = test ? 'TEST ONLY — nothing was submitted. ' : '';
  return `${prefix}Finished: ${report.submitted} enrolled · ${report.alreadyMember} already members · ${report.pending} pending · ${report.skipped} skipped · ${report.errors} errors · ${report.processed}/${report.total} processed.`;
}

async function main() {
  const missing = ['HOTELOPS_EMAIL', 'HOTELOPS_PASS', 'HOTELOPS_HOTEL'].filter(k => !String(E[k] || '').trim());
  if (missing.length) fail('Missing secrets: ' + missing.join(', '));
  const FB = await hotelDb();
  ACTIVE_FB = FB;
  const job = await FB.get('enrollJob');
  const rows = consenting(job && job.tsv);
  const test = /^(1|true|yes)$/i.test(String(E.TEST || '')) || !!(job && job.test);
  if (!rows.length) fail('No consenting guests with civility and email were found in the enrollment list');
  sensitiveValues = rows.flatMap(r => [r.name, r.email, r.conf]).filter(Boolean);

  const tag = String(E.TAG || (job && job.tag) || ('accor' + Date.now().toString(36))).slice(0, 40);
  const live = p => FB.patch('enrollLive', Object.assign({ at: Date.now(), tag, con: CON.slice(-60) }, p)).catch(() => {});
  const stopRequested = async () => {
    try { const state = await FB.get('enrollLive'); return state && state.tag === tag && (state.control === 'stop' || state.stopRequested === true); }
    catch (_) { return false; }
  };
  const markStopped = async note => {
    tlog('STOP', note);
    await FB.patch('enrollJob', { state: 'stopped', stoppedAt: Date.now() });
    await live({ state: 'stopped', step: 'stopped', note, con: CON.slice(-60) });
  };

  await FB.put('enrollLive', {
    at: Date.now(), started: Date.now(), state: 'run', step: 'open', tag, test,
    n: rows.length, done: 0, control: 'run', note: 'Preparing the cloud browser…', con: CON.slice(-60)
  });
  say(`${test ? 'TEST ONLY · ' : ''}Enrollment queued for ${rows.length} consenting guest(s).`);
  await live({ step: 'open', note: 'Preparing the cloud browser and opening Accor Loop…' });

  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch (_) { try { ({ chromium } = require('playwright-core')); } catch (_) { fail('Playwright is not installed'); } }
  const executablePath = [E.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(p => p && fs.existsSync(p));
  const browser = await chromium.launch(executablePath ? { executablePath, headless: true } : { headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'en-GB', timezoneId: 'Asia/Dubai' });
  const page = await context.newPage();
  page.on('console', message => {
    const text = message.text();
    if (/SUCCESS|result:|SUMMARY|error|warn|parsed|starting|processed|All records|loaded|portal|guest|Title|Country|submit|form|fresh|skipped|enrolled|member|diagnostic/i.test(text)) {
      const group = message.type() === 'error' ? 'ERR' : /warn/i.test(message.type()) ? 'WARN' : 'BOT';
      const safe = tlog(group, text);
      void live({ step: 'enroll', action: safe, note: safe });
    }
  });
  page.on('pageerror', error => {
    const safe = tlog('ERR', 'Browser page error: ' + (error && error.message || error));
    void live({ step: 'browser-error', action: safe, note: safe });
  });
  page.on('requestfailed', request => {
    let host = 'portal resource';
    try { host = new URL(request.url()).hostname; } catch (_) {}
    const safe = tlog('WARN', `Portal request failed (${host}): ${(request.failure() || {}).errorText || 'unknown'}`);
    void live({ step: 'network', action: safe, note: safe });
  });
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) {
      let location = 'portal page';
      try { const u = new URL(frame.url()); location = u.origin + u.pathname; } catch (_) {}
      const safe = tlog('NAV', `Portal page changed: ${location}`);
      void live({ step: 'page', action: safe, note: safe });
    }
  });

  const portalUrl = String((job && job.portalUrl) || E.PORTAL_URL || 'https://secure.guestinternet.com/portal-system/portal/');
  const state = {
    __accor_portal_url: portalUrl,
    __accor_records: pipeRows(rows),
    __accor_enabled: true,
    __accor_test: !!test,
    __accor_cloud_run: true,
    __accor_stop_signal: false
  };
  await page.addInitScript(seed => {
    Object.keys(seed).forEach(k => localStorage.setItem('__accor_cloud_' + k, JSON.stringify(seed[k])));
    const read = k => { try { const value = localStorage.getItem('__accor_cloud_' + k); return value == null ? null : JSON.parse(value); } catch (_) { return null; } };
    window.chrome = { storage: { local: {
      get(keys, cb) { const names = Array.isArray(keys) ? keys : Object.keys(keys || {}); const out = {}; names.forEach(k => { out[k] = read(k); }); if (cb) cb(out); return out; },
      set(values, cb) { Object.keys(values || {}).forEach(k => localStorage.setItem('__accor_cloud_' + k, JSON.stringify(values[k]))); if (cb) cb(); }
    } } };
  }, state);

  try {
    say('Opening the Accor Loop portal…');
    await live({ step: 'open', note: 'Opening the Accor Loop portal…' });
    await page.goto(portalUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    tlog('SYS', 'Portal opened; launching the enrollment worker.');
    await live({ step: 'enroll', note: 'Portal open. Starting the enrollment worker…' });
    await page.waitForTimeout(1200);
    const workerSource = fs.readFileSync(path.join(ROOT, 'scripts', 'accor-loop-content.js'), 'utf8');
    await page.evaluate(src => {
      const script = document.createElement('script');
      script.type = 'text/javascript';
      script.textContent = src;
      (document.head || document.documentElement).appendChild(script);
    }, workerSource);
    say(test ? 'TEST ONLY · checking the portal; nothing will be submitted.' : 'Enrollment worker started; monitoring progress.');
    await live({ step: 'enroll', note: test ? 'Test run: checking portal and selected list. No invitations will be sent.' : 'Worker started. Monitoring each enrollment result…' });

    let done = false;
    let seenWorkerLogs = 0;
    let workerStartedAt = Date.now();
    let lastWorkerEvidence = workerStartedAt;
    let lastProgressAt = 0;
    for (let i = 0; i < 3600 && !done; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const currentGuest = await safePageEvaluate(page, 'current guest poll', () => {
        try { return JSON.parse(localStorage.getItem('__accor_cloud___accor_current_guest') || 'null'); } catch (_) { return null; }
      }, null);
      const workerLogs = await safePageEvaluate(page, 'worker log poll', () => {
        try { return JSON.parse(localStorage.getItem('__accor_cloud___accor_logs') || '[]'); } catch (_) { return []; }
      }, []);
      if (Array.isArray(workerLogs) && workerLogs.length > seenWorkerLogs) {
        for (const entry of workerLogs.slice(seenWorkerLogs)) {
          const safe = tlog(entry.level === 'error' ? 'ERR' : entry.level === 'warn' ? 'WARN' : 'BOT', entry.msg || 'Worker activity');
          await live({ step: 'enroll', action: safe, note: safe });
        }
        seenWorkerLogs = workerLogs.length;
        lastWorkerEvidence = Date.now();
      }
      if (Array.isArray(workerLogs) && workerLogs.length) lastWorkerEvidence = Date.now();

      if (i % 3 === 0 && await stopRequested()) {
        await safePageEvaluate(page, 'stop signal poll', () => {
          try { localStorage.setItem('__accor_cloud___accor_stop_signal', JSON.stringify(true)); } catch (_) {}
        }, null);
        await markStopped('Stop requested. The current action was allowed to finish; no more guests will be submitted.');
        return;
      }

      const snapshot = await safePageEvaluate(page, 'worker state poll', () => {
        const read = k => { try { return JSON.parse(localStorage.getItem('__accor_cloud_' + k)); } catch (_) { return null; } };
        return { enabled: read('__accor_enabled'), state: read('__accor_state'), loop: read('__accor_loop_state') };
      }, { enabled: true, state: null, loop: null });
      if (currentGuest || (snapshot && snapshot.state)) lastWorkerEvidence = Date.now();
      if (Date.now() - workerStartedAt > 45000 && Date.now() - lastWorkerEvidence > 45000) {
        throw new Error('The portal opened, but the enrollment worker produced no activity. Check the portal page and runner logs.');
      }
      done = !!(snapshot && snapshot.enabled === false);
      if (Date.now() - lastProgressAt > 2500) {
        lastProgressAt = Date.now();
        const processed = Math.min(rows.length, Math.max(0, Number(snapshot && snapshot.state && snapshot.state.nextIndex || 0)));
        const note = currentGuest
          ? `Working on guest ${currentGuest.index || '?'} of ${currentGuest.total || rows.length}. Results are recorded as each guest finishes.`
          : `Enrollment worker running · ${processed} of ${rows.length} processed.`;
        await live({ step: 'enroll', done: processed, current: currentGuest || null, action: note, note });
      }
    }

    if (!done) throw new Error('Timed out waiting for the enrollment worker to finish; the run is not marked complete.');
    const result = await safePageEvaluate(page, 'final result poll', () => {
      try { return JSON.parse(localStorage.getItem('__accor_cloud___accor_loop_state') || '{}'); } catch (_) { return {}; }
    }, {});
    const results = Array.isArray(result.results) ? result.results : [];
    const report = resultReport(results, rows.length);
    const today = new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);
    const patch = {};
    results.forEach(r => {
      if (r && /@/.test(r.email || '')) {
        patch[key(r.email)] = {
          email: String(r.email).toLowerCase(), status: String(r.status || 'unknown'), date: today,
          name: String(r.name || ''), conf: String(r.conf || '')
        };
      }
    });
    if (!test && Object.keys(patch).length) await FB.patch('enrollLog', patch);
    const note = reportNote(report, test);
    tlog('SAVE', `${report.submitted} enrolled · ${report.alreadyMember} already members · ${report.pending} pending · ${report.skipped} skipped · ${report.errors} errors.`);
    if (report.statuses && Object.keys(report.statuses).length) {
      for (const [status, count] of Object.entries(report.statuses)) tlog('REPORT', `${count} · ${status}`);
    }
    await FB.patch('enrollJob', { state: report.complete ? 'done' : 'partial', doneAt: Date.now(), resultSummary: report });
    say(note);
    await live({
      state: report.complete ? 'done' : 'error', step: report.complete ? 'done' : 'partial',
      done: report.processed, n: rows.length, note, action: note, report,
      con: CON.slice(-60)
    });
  } finally {
    await browser.close().catch(() => {});
  }
}

if (require.main === module) main().catch(async error => {
  const message = 'Stopped: ' + (error && error.stack || error && error.message || error);
  await publishError(message);
  fail(message);
});
module.exports = { consenting, pipeRows, resultReport, reportNote };
