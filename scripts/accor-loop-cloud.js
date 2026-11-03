// Accor Loop cloud runner
// Runs the tested accor-loop-fixed Chrome content script on a GitHub-hosted browser.
// It reads only consenting guests from HotelOps enrollJob and writes results to enrollLog.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const E = process.env;
const mask = s => String(s || '').replace(/\S+@\S+/g, '•@•').replace(/\d{6,}/g, d => '••••' + d.slice(-4)).slice(0, 180);
// Keep a privacy-safe copy of the runner console in HotelOps so the phone has the same
// useful step-by-step view as the Neorcha cloud run. Never write guest names, e-mails or passwords.
const CON = [];
const tlog = (g, s) => { const m = mask(s); CON.push({ t: Date.now(), g, m }); if (CON.length > 80) CON.splice(0, CON.length - 80); return m; };
const say = s => { const m = tlog('SYS', s); console.log(new Date().toISOString().slice(11, 19) + '  ' + m); };
const fail = (s, code = 1) => { const m = tlog('ERR', s); console.error('::error::' + m); process.exit(code); };
const key = e => String(e || '').toLowerCase().replace(/[.#$\[\]/@]/g, '_');

function firebaseConfig() {
  const src = fs.readFileSync(path.join(ROOT, 'firebase-config.js'), 'utf8');
  const get = k => (src.match(new RegExp(k + "\\\\s*:\\\\s*[\\\"']([^\\\"']+)[\\\"']")) || [, ''])[1];
  return { apiKey: get('apiKey'), databaseURL: get('databaseURL') };
}
async function hotelDb() {
  const c = firebaseConfig();
  const base = String(E.FB_DB_URL || c.databaseURL || '').replace(/\/$/, '');
  if (!c.apiKey || !base) fail('Firebase configuration is missing');
  const authUrl = String(E.FB_AUTH_URL || 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword');
  const r = await fetch(authUrl + '?key=' + encodeURIComponent(c.apiKey), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: String(E.HOTELOPS_EMAIL).trim(), password: E.HOTELOPS_PASS, returnSecureToken: true }) });
  const a = await r.json().catch(() => ({}));
  if (!r.ok || !a.idToken) fail('HotelOps sign-in refused — check HOTELOPS_EMAIL / HOTELOPS_PASS');
  const hid = String(E.HOTELOPS_HOTEL || '').trim();
  if (!/^[\w-]{1,80}$/.test(hid)) fail('HOTELOPS_HOTEL is required for the Accor Loop cloud run');
  const at = p => base + '/hotels/' + encodeURIComponent(hid) + '/' + p + '.json?auth=' + encodeURIComponent(a.idToken);
  const request = async (p, method, body) => { const x = await fetch(at(p), { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); if (!x.ok) throw new Error('Firebase ' + method + ' ' + p + ' ' + x.status); return x.json().catch(() => null); };
  return { get: p => request(p, 'GET'), patch: (p, v) => request(p, 'PATCH', v), put: (p, v) => request(p, 'PUT', v) };
}
function consenting(tsv) {
  const lines = String(tsv || '').split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const h = lines[0].split('\t').map(x => x.trim().toLowerCase());
  const at = re => h.findIndex(x => re.test(x));
  const ci = at(/^consent$|agreed/), civ = at(/^civility$|title|salutation/), ni = at(/^name$|guest.?name/), ei = at(/mail/), pi = at(/phone|mobile/), co = at(/national|country/), fi = at(/confirmation/);
  if (ci < 0 || ni < 0 || ei < 0) return [];
  return lines.slice(1).map(line => line.split('\t')).filter(c => /^(y|yes|1|✓|true|x)$/i.test((c[ci] || '').trim()) && (c[civ] || '').trim() && /@/.test(c[ei] || '')).map(c => ({ conf: c[fi] || '', title: c[civ] || 'Mr', name: c[ni] || '', email: c[ei] || '', phone: pi >= 0 ? c[pi] || '' : '', country: co >= 0 ? c[co] || '' : '' }));
}
function pipeRows(rows) { return rows.map(r => [r.conf, r.title, r.name, r.email, r.phone, r.country].map(x => String(x || '').replace(/[|\r\n]/g, '/')).join('|')).join('\n') + '\n'; }
async function main() {
  const miss = ['HOTELOPS_EMAIL', 'HOTELOPS_PASS', 'HOTELOPS_HOTEL'].filter(k => !String(E[k] || '').trim());
  if (miss.length) fail('Missing secrets: ' + miss.join(', '));
  const FB = await hotelDb();
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
    if (/SUCCESS|result:|SUMMARY|error|warn|parsed|starting|processed|All records|loaded|portal|guest|Title|Country|submit|form|fresh/i.test(t)) {
      const level = m.type() === 'error' ? 'ERR' : /warn/i.test(m.type()) ? 'WARN' : 'BOT';
      tlog(level, t); live({ step: 'enroll', action: mask(t), note: mask(t) });
    }
  });
  const state = { ["__accor_portal_url"]: String(E.PORTAL_URL || 'https://secure.guestinternet.com/portal-system/portal/'), ["__accor_records"]: pipeRows(rows), ["__accor_enabled"]: true, ["__accor_stop_signal"]: false, ["__accor_diagnostic_only"]: test, ["__accor_loop_state"]: null, ["__accor_logs"]: [] };
  await page.addInitScript(s => {
    const seed = s;
    Object.keys(seed).forEach(k => localStorage.setItem('__accor_cloud_' + k, JSON.stringify(seed[k])));
    const read = k => { try { const v = localStorage.getItem('__accor_cloud_' + k); return v == null ? null : JSON.parse(v); } catch (_) { return null; } };
    const write = obj => { Object.keys(obj || {}).forEach(k => localStorage.setItem('__accor_cloud_' + k, JSON.stringify(obj[k]))); };
    window.chrome = { storage: { local: { get(keys, cb) { const names = Array.isArray(keys) ? keys : Object.keys(keys || {}); const out = {}; names.forEach(k => out[k] = read(k)); if (cb) cb(out); return Promise.resolve(out); }, set(obj, cb) { write(obj); if (cb) cb(); return Promise.resolve(); } } }, runtime: { sendMessage(msg) { if (msg && msg.type === 'log') { const entry = Object.assign({ t: Date.now(), g: 'BOT' }, msg.entry || {}); const old = read('__accor_logs') || []; old.push(entry); if (old.length > 100) old.splice(0, old.length - 100); write({ __accor_logs: old }); console.log('[accor-loop]', entry.msg || 'log'); } if (msg && msg.type === 'freshTab') location.reload(); return Promise.resolve({ ok: true }); } } };
  }, state);
  try {
    say('Opening Accor Loop portal…');
    await live({ step: 'open', note: 'Opening Accor Loop portal…' });
    await page.goto(state.__accor_portal_url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    say('Portal loaded · starting the enrollment worker…');
    await page.waitForTimeout(1200);
    await page.addScriptTag({ path: path.join(ROOT, 'scripts', 'accor-loop-content.js') });
    say(test ? 'Test mode: checking the form — nothing will be submitted…' : 'Enrollment worker is running…');
    await live({ step: 'enroll', note: test ? 'Test mode: checking the form, nothing will be submitted…' : 'Enrollment worker is running…' });
    let done = false, seenWorkerLogs = 0;
    for (let i = 0; i < 3600 && !done; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const workerLogs = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('__accor_cloud___accor_logs') || '[]'); } catch (_) { return []; } });
      if (workerLogs.length > seenWorkerLogs) {
        workerLogs.slice(seenWorkerLogs).forEach(x => tlog(x.level === 'error' ? 'ERR' : x.level === 'warn' ? 'WARN' : 'BOT', x.msg));
        seenWorkerLogs = workerLogs.length;
        await live({ step: 'enroll', action: mask(workerLogs[workerLogs.length - 1].msg || 'Worker activity'), note: mask(workerLogs[workerLogs.length - 1].msg || 'Worker activity') });
      }
      if (i % 3 === 0 && await stopRequested()) {
        await page.evaluate(() => { try { localStorage.setItem('__accor_cloud___accor_stop_signal', JSON.stringify(true)); } catch (_) {} });
        await markStopped('Stopped from HotelOps — no more guests will be submitted.');
        return;
      }
      const s = await page.evaluate(() => { const read = k => { try { return JSON.parse(localStorage.getItem('__accor_cloud_' + k)); } catch (_) { return null; } }; return { state: read('__accor_loop_state'), enabled: read('__accor_enabled') }; });
      done = s.enabled === false;
      if (i % 3 === 0) await live({ step: 'enroll', done: Math.max(0, Math.min(rows.length, Number(s.state && s.state.nextIndex || 0))), action: 'Worker heartbeat · browser is active', note: test ? 'Test mode running — nothing will be submitted' : 'Accor Loop is processing the guest list…' });
    }
    const result = await page.evaluate(() => { try { return JSON.parse(window.localStorage.getItem('__accor_cloud___accor_loop_state') || '{}'); } catch (_) { return {}; } });
    const results = Array.isArray(result.results) ? result.results : [];
    const patch = {}; const today = new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);
    results.forEach(r => { if (r && /@/.test(r.email || '')) patch[key(r.email)] = { email: String(r.email).toLowerCase(), status: String(r.status || 'unknown'), date: today, name: '', by: 'accor cloud' }; });
    if (!test && Object.keys(patch).length) await FB.patch('enrollLog', patch);
    await FB.patch('enrollJob', { state: 'done', doneAt: Date.now() });
    say('Finished: ' + results.length + ' result(s)' + (test ? ' (test only)' : ' saved to Enrollment tracker'));
    tlog('SAVE', test ? 'Test complete · nothing submitted' : 'Results written to Enrollment tracker');
    await live({ state: 'done', step: 'done', done: results.length, n: rows.length, note: test ? 'Test run complete — nothing was submitted.' : results.length + ' results saved in the Enrollment tracker.', con: CON.slice(-60) });
  } finally { await browser.close().catch(() => {}); }
}
if (require.main === module) main().catch(e => fail('Stopped: ' + (e && e.message || e)));
module.exports = { consenting, pipeRows };
