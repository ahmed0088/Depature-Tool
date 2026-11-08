'use strict';
const fs = require('fs');
const path = require('path');
require('./accor-loop-navigation-diagnostics.js');
const ROOT = path.join(__dirname, '..');
const E = process.env;
const mask = s => String(s || '').replace(/\S+@\S+/g, '•@•').replace(/\d{6,}/g, d => '••••' + d.slice(-4)).slice(0, 180);
const CON = [];
let ACTIVE_HISTORY = null;
let ACTIVE_FB = null;
let sensitiveValues = [];

function scrub(message) {
  let value = mask(message);
  for (const secret of sensitiveValues) {
    if (secret) value = value.split(secret).join('[guest]');
  }
  return value;
}
// Two consoles: HotelOps (private — the hotel's own database, which already holds this guest list) shows every detail;
// the GitHub log is PUBLIC (open repository), so whatever is printed there goes through scrub() first.
function tlog(group, message) {
  const entry = { t: Date.now(), g: group, m: String(message == null ? '' : message).slice(0, 300) };
  CON.push(entry);
  if (CON.length > 160) CON.splice(0, CON.length - 160);
  return entry.m;
}
const pub = (group, message) => console.log(new Date().toISOString().slice(11, 19) + '  ' + String(group).padEnd(6) + scrub(message));
const say = message => pub('', tlog('SYS', message));
const key = email => String(email || '').toLowerCase().replace(/[.#$\[\]\\/@]/g, '_');
const fail = (message, code = 1) => {
  const safe = tlog('ERR', message);
  console.error('::error::' + scrub(safe));
  process.exit(code);
};

async function publishError(message) {
  const safe = tlog('ERR', message);
  if (ACTIVE_HISTORY) await ACTIVE_HISTORY({state:'error',step:'error',note:safe});
  if (!ACTIVE_FB) return;
  try {
    await ACTIVE_FB.patch('enrollJob', { state: 'error', error: safe, errorAt: Date.now() });
    await ACTIVE_FB.patch('enrollLive', {
      at: Date.now(), state: 'error', step: 'error', note: safe, action: safe,
      con: CON.slice(-120), report: null
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
  const get = name => (src.match(new RegExp(name + '\\s*:\\s*["\']([^"\']+)["\']')) || [, ''])[1];
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
  const errors = results.filter(r => /error|timeout|unclear|bad_data|bad_email|bad_name|auth_hang|modal_other/i.test(String(r.status || ''))).length;
  const other = Math.max(0, results.length - submitted - already - pending - skipped - errors);
  const cat = st => /^(success|success_stuck)$/.test(st) ? 'enrolled' : st === 'already_member' ? 'already'
    : st === 'pending-account' ? 'pending' : /^skipped:|^title_not_committed|^country_not_found|name_not_latin/.test(st) ? 'skipped'
    : /error|timeout|unclear|bad_data|bad_email|bad_name|auth_hang|modal_other/i.test(st) ? 'error' : 'other';
  return {
    processed: results.length, total, submitted, alreadyMember: already, pending,
    skipped, errors, other, complete: results.length >= total,
    // the per-guest list, so HotelOps can show who is in each tile and why (name + confirmation only — no e-mail)
    guests: results.map(r => ({ name: String(r && r.name || '').slice(0, 60), conf: String(r && r.conf || ''), status: String(r && r.status || 'unknown'), cat: cat(String(r && r.status || '')) })),
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
  // the hotel is optional: without it the HotelOps account's own hotel is used (hotelDb)
  const missing = ['HOTELOPS_EMAIL', 'HOTELOPS_PASS'].filter(k => !String(E[k] || '').trim());
  if (missing.length) fail('Missing secrets: ' + missing.join(', '));
  const FB = await hotelDb();
  ACTIVE_FB = FB;
  const job = await FB.get('enrollJob');
  const rows = consenting(job && job.tsv);
  const test = /^(1|true|yes)$/i.test(String(E.TEST || '')) || !!(job && job.test);
  if (!rows.length) fail('No consenting guests with civility and email were found in the enrollment list');
  // never let a guest's name, e-mail or confirmation reach the public GitHub log (whole name AND each part of it)
  sensitiveValues = rows.flatMap(r => [r.name, r.email, r.conf, ...String(r.name || '').split(/\s+/).filter(x => x.length >= 3)])
    .filter(Boolean).sort((a, b) => String(b).length - String(a).length);

  const tag = String(E.TAG || (job && job.tag) || ('accor' + Date.now().toString(36))).slice(0, 40);
  const history = require('./cloud-run-history')({patch:FB.patch,tag,kind:'enrol',run:E.GITHUB_RUN_ID?'https://github.com/ahmed0088/Depature-Tool/actions/runs/'+E.GITHUB_RUN_ID:''});
  ACTIVE_HISTORY = history;
  const live = p => Promise.all([history(p), FB.patch('enrollLive', Object.assign({ at: Date.now(), tag, con: CON.slice(-120) }, p)).catch(() => {})]);
  await history({state:'run',n:rows.length,done:0,test,note:'Preparing the cloud browser…'});
  const stopRequested = async () => {
    try { const state = await FB.get('enrollLive'); return state && state.tag === tag && (state.control === 'stop' || state.stopRequested === true); }
    catch (_) { return false; }
  };
  const markStopped = async note => {
    tlog('STOP', note);
    await FB.patch('enrollJob', { state: 'stopped', stoppedAt: Date.now() });
    await live({ state: 'stopped', step: 'stopped', note, con: CON.slice(-120) });
  };

  await FB.put('enrollLive', {
    at: Date.now(), started: Date.now(), state: 'run', step: 'open', tag, test,
    n: rows.length, done: 0, control: 'run', note: 'Preparing the cloud browser…', con: CON.slice(-120)
  });
  say(`${test ? 'TEST ONLY · ' : ''}Enrollment queued for ${rows.length} consenting guest(s).`);
  await live({ step: 'open', note: 'Preparing the cloud browser and opening Accor Loop…' });

  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch (_) { try { ({ chromium } = require('playwright-core')); } catch (_) { fail('Playwright is not installed'); } }
  const executablePath = [E.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(p => p && fs.existsSync(p));
  const browser = await chromium.launch(executablePath ? { executablePath, headless: true } : { headless: true });
  // bypassCSP: the portal's security policy must not stop our own worker from starting
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'en-GB', timezoneId: 'Asia/Dubai', bypassCSP: true });
  const page = await context.newPage();
  // speed: the robot needs the form, not the portal's pictures, fonts or videos
  await context.route('**/*', route => (/^(image|media|font)$/.test(route.request().resourceType()) ? route.abort() : route.continue())).catch(() => {});
  page.on('console', message => {
    const text = message.text();
    // the worker's own lines arrive through its log store (below); here only the page's real errors
    if (message.type() === 'error' && !/^\[\d/.test(text)) tlog('WARN', 'Portal console: ' + text);
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
    // the worker's own "test" switch: it picks the title and stops before typing or submitting anything
    __accor_diagnostic_only: !!test,
    __accor_cloud_run: true,
    __accor_stop_signal: false
  };
  // Runs before the portal's own code on EVERY page load (the portal reloads itself, and the worker reloads it
  // after each guest). It stands in for the Chrome extension the worker was written for:
  //  · chrome.storage.local → this page's localStorage (survives the reloads)
  //  · chrome.runtime.sendMessage → 'log' lines go to a log store HotelOps reads; 'freshTab' = open the portal again
  // The job data is seeded only ONCE, so a reload never undoes a Stop or the worker's progress.
  await page.addInitScript(seed => {
    try {
      const P = '__accor_cloud_';
      const read = k => { try { const v = localStorage.getItem(P + k); return v == null ? undefined : JSON.parse(v); } catch (_) { return undefined; } };
      const write = (k, v) => { try { localStorage.setItem(P + k, JSON.stringify(v)); } catch (_) {} };
      if (!location.hostname) return;
      if (read('__seeded') !== seed.__accor_records) {
        Object.keys(seed).forEach(k => write(k, seed[k]));
        write('__accor_loop_state', null); write('__accor_logs', { seq: 0, list: [] }); write('__seeded', seed.__accor_records);
      }
      const pick = keys => { const names = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys || {}); const out = {}; names.forEach(k => { const v = read(k); if (v !== undefined && v !== null) out[k] = v; }); return out; };
      const local = {
        get(keys, cb) { const out = pick(keys); if (typeof cb === 'function') { setTimeout(() => cb(out), 0); return; } return Promise.resolve(out); },
        set(values, cb) { Object.keys(values || {}).forEach(k => write(k, values[k])); if (typeof cb === 'function') { setTimeout(cb, 0); return; } return Promise.resolve(); }
      };
      const runtime = {
        sendMessage(msg) {
          if (!msg) return;
          if (msg.type === 'log' && msg.entry) {
            const box = read('__accor_logs') || { seq: 0, list: [] };
            box.seq = (box.seq || 0) + 1;
            box.list = (box.list || []).concat([{ n: box.seq, level: msg.entry.level, msg: String(msg.entry.msg || '') }]).slice(-200);
            write('__accor_logs', box);
          } else if (msg.type === 'freshTab') {
            setTimeout(() => { location.href = msg.portalUrl || seed.__accor_portal_url; }, 50);
          }
        }
      };
      const prev = window.chrome && typeof window.chrome === 'object' ? window.chrome : {};
      window.chrome = Object.assign({}, prev, { storage: { local }, runtime });
    } catch (_) {}
  }, state);

  // Start the worker in the page. Called after every page load: the worker is written to pick up where it stopped.
  const workerSource = fs.readFileSync(path.join(ROOT, 'scripts', 'accor-loop-content.js'), 'utf8');
  let workerStarts = 0;
  const startWorker = async why => {
    const started = await safePageEvaluate(page, 'worker start', `(() => {
      if (window.__accorWorkerOn) return false;
      if (!/guestinternet\\.com$/.test(location.hostname)) return false;
      window.__accorWorkerOn = true;
      ${workerSource}
      return true;
    })()`, false);
    if (started) {
      workerStarts++;
      tlog('SYS', workerStarts === 1 ? 'Enrollment worker started on the portal.' : `Portal reloaded (${why}); enrollment worker resumed.`);
    }
    return started;
  };
  let pendingStart = null;
  page.on('load', () => {
    clearTimeout(pendingStart);
    pendingStart = setTimeout(() => { startWorker('page reload').catch(() => {}); }, 600);
  });

  try {
    say('Opening the Accor Loop portal…');
    await live({ step: 'open', note: 'Opening the Accor Loop portal…' });
    await page.goto(portalUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    tlog('SYS', 'Portal opened; launching the enrollment worker.');
    await live({ step: 'enroll', note: 'Portal open. Starting the enrollment worker…' });
    await page.waitForTimeout(700);
    await startWorker('first load');
    say(test ? 'TEST ONLY · checking the portal; nothing will be submitted.' : 'Enrollment worker started; monitoring progress.');
    await live({ step: 'enroll', note: test ? 'Test run: checking portal and selected list. No invitations will be sent.' : 'Worker started. Monitoring each enrollment result…' });

    let done = false;
    let seenWorkerLogs = 0;
    let lastFingerprint = '';
    let workerStartedAt = Date.now();
    let lastWorkerEvidence = workerStartedAt;
    let lastProgressAt = 0;
    for (let i = 0; i < 3600 && !done; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      const currentGuest = await safePageEvaluate(page, 'current guest poll', () => {
        try { return JSON.parse(localStorage.getItem('__accor_cloud___accor_current_guest') || 'null'); } catch (_) { return null; }
      }, null);
      const box = await safePageEvaluate(page, 'worker log poll', () => {
        try { return JSON.parse(localStorage.getItem('__accor_cloud___accor_logs') || 'null'); } catch (_) { return null; }
      }, null);
      const fresh = box && Array.isArray(box.list) ? box.list.filter(e => e && e.n > seenWorkerLogs) : [];
      if (fresh.length) {
        let last = '';
        for (const entry of fresh) {
          const msg = String(entry.msg || 'Worker activity');
          const group = entry.level === 'error' ? 'ERR' : entry.level === 'warn' ? 'WARN'
            : /GUEST RESULT/.test(msg) ? 'DONE' : /═════ \[/.test(msg) ? 'GUEST' : /^ {2}(guest: |form has ·|Accor said)/.test(msg) ? 'DATA' : /^ {2}-> |^ {5}\S/.test(msg) ? 'FORM'
            : /clicked submit|SUCCESS URL|result:|enroll (fetch )?response|^ {2}reason:/i.test(msg) ? 'SEND' : 'BOT';
          last = tlog(group, msg);
          // the public GitHub log gets every step too, masked (names / e-mails / long numbers hidden)
          pub(group, msg);
        }
        seenWorkerLogs = fresh[fresh.length - 1].n;
        lastWorkerEvidence = Date.now();
        await live({ step: 'enroll', action: last, note: last });
      }
      // the worker can sit on a page (e.g. reloading); if nothing has started it yet, start it now
      if (workerStarts === 0 && Date.now() - workerStartedAt > 8000) await startWorker('retry');

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
      const fingerprint = JSON.stringify([currentGuest && currentGuest.index, snapshot && snapshot.loop && snapshot.loop.nextIndex, snapshot && snapshot.enabled]);
      if (fingerprint !== lastFingerprint) { lastFingerprint = fingerprint; lastWorkerEvidence = Date.now(); }
      if (Date.now() - lastWorkerEvidence > 120000) {
        throw new Error(workerStarts
          ? 'The enrollment worker stopped moving for 2 minutes (no new step on the portal). The last steps are in the console above.'
          : 'The portal opened, but the enrollment worker could not start on it. The portal page may have changed.');
      }
      done = !!(snapshot && snapshot.enabled === false);
      if (Date.now() - lastProgressAt > 2500) {
        lastProgressAt = Date.now();
        const loop = snapshot && (snapshot.loop || snapshot.state);
        const processed = Math.min(rows.length, Math.max(0, Number(loop && (Array.isArray(loop.results) ? loop.results.length : loop.nextIndex) || 0)));
        const note = currentGuest
          ? `Working on guest ${currentGuest.index || '?'} of ${currentGuest.total || rows.length}. Results are recorded as each guest finishes.`
          : `Enrollment worker running · ${processed} of ${rows.length} processed.`;
        const sofar = loop && Array.isArray(loop.results) ? resultReport(loop.results, rows.length) : null;
        const tally = sofar ? { enrolled: sofar.submitted, already: sofar.alreadyMember, skipped: sofar.skipped + sofar.pending + sofar.other, errors: sofar.errors } : null;
        await live({ step: workerStarts ? 'enroll' : 'worker', done: processed, current: currentGuest || null, tally, worker: workerStarts > 0, action: note, note });
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
      for (const [status, count] of Object.entries(report.statuses)) pub('REPORT', tlog('REPORT', `${count} · ${status}`));
    }
    await FB.patch('enrollJob', { state: report.complete ? 'done' : 'partial', doneAt: Date.now(), resultSummary: report });
    say(note);
    await live({
      state: report.complete ? 'done' : 'error', step: report.complete ? 'done' : 'partial',
      done: report.processed, n: rows.length, note, action: note, report, current: null,
      tally: { enrolled: report.submitted, already: report.alreadyMember, skipped: report.skipped + report.pending + report.other, errors: report.errors },
      con: CON.slice(-120)
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
