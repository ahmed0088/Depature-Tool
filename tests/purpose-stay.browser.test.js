'use strict';
// Actual Purpose of Stay handlers with synthetic rows, a frozen clock and captured exports.
// No Firebase, Opera, guest records or external network are used.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const ROOT = path.join(__dirname, '..');
const source = name => fs.readFileSync(path.join(ROOT, name), 'utf8');
const DATE_RE = /13[\s-]+Nov[\s-]+(?:20)?26/i;

async function fixture(browser, { phone, clock = '2026-11-13T18:00:00Z', context, seed = true } = {}) {
  context ||= await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1360, height: 960 }, hasTouch: phone, isMobile: phone, serviceWorkers: 'block', timezoneId: 'Pacific/Kiritimati' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const index = source('index.html'), start = index.indexOf('<div class="panel" id="panel-purpose">'), end = index.indexOf('<!-- ════════════════ SHIFT TASKS', start);
  assert(start >= 0 && end > start, 'Purpose panel must remain identifiable in the real application');
  const html = '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Purpose fixture</title>' + index.slice(start, end);
  await page.route('**/*', route => route.request().url() === 'https://purpose.hotelops.test/' ? route.fulfill({ contentType: 'text/html', body: html }) : route.abort());
  await page.goto('https://purpose.hotelops.test/');
  for (const name of ['styles.css', 'pro.css']) await page.addStyleTag({ content: source(name) });
  await page.addStyleTag({ content: 'body{margin:0;padding:16px;--bg:#0b111a;--bg2:#121a26;--card:#182333;--text:#e8edf5;--text2:#a9b6c8;--text3:#8392a6;--border:#354356;--border2:#354356;--accent:#e8b337;--gold:#e8b337;--mint:#45d1b2;--sky:#58a9f8;--amber:#eab941;color:var(--text);background:var(--bg)}#panel-purpose{display:block!important;max-width:1280px;margin:auto}.tbl-wrap{max-width:100%;overflow:auto}' });
  await page.evaluate(({ clock }) => {
    window.fixtureClock = Date.parse(clock); const NativeDate = Date;
    window.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [fixtureClock])); } static now() { return fixtureClock; } };
    window.HOTEL_ID = 'purpose-fixture'; window.currentProfile = { role: 'owner', active: true };
    window.escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    window.escapeLogText = escapeHtml;
    window.sourceCategory = value => { const s = String(value || ''); return /walk[\s-]?in/i.test(s) ? 'walkin' : /\ball\b|accor/i.test(s) || !s ? 'allapp' : /booking\.?com|agoda|expedia|hotels\.com|trip\.com/i.test(s) ? 'ota' : /corp|company/i.test(s) ? 'corporate' : 'other'; };
    window.SOURCE_CATEGORIES = Object.fromEntries(['walkin', 'allapp', 'ota', 'corporate', 'other'].map(k => [k, { label: k }]));
    window.cleanSource = (...parts) => parts.find(v => String(v || '').trim()) || 'ALL App';
    window.cleanName = value => String(value || '').replace(/\s+/g, ' ').trim().toUpperCase();
    window._normName = value => String(value || '').toUpperCase().replace(/[^A-Z]/g, '');
    window.guessNat = () => ''; window.setSpinner = () => {}; window.gmOnEdit = () => {};
    window.showToast = (...args) => (window.toasts ||= []).push(args);
    window.alert = message => { throw Error('Unexpected alert: ' + message); };
    window.confirm = () => true; window.prompt = () => '80';
    window.fbPushLog = async () => null; window.fbUpdate = async () => {}; window.fbSet = async () => {};
    window.saveArrivals = async () => {}; window.savedReports = []; window.savedDates = []; window.exports = []; window.archiveWrites = [];
    window.savePurpose = async guests => savedReports.push({ guests: JSON.parse(JSON.stringify(guests)), businessDate: window.PurposeBusinessDate?.resolve() });
    window.savePurposeBusinessDate = async (date, metadata) => savedDates.push({ date, metadata });
    window.saveHistory = (...args) => archiveWrites.push(args);
    window.writeStyledXlsx = (...args) => exports.push(JSON.parse(JSON.stringify(args.slice(0, 3))));
    window.parseCSVLine = line => String(line).split(',');
    window.fetch = () => { throw Error('External requests are disabled in this fixture'); };
  }, { clock });
  for (const name of ['state.js', 'purpose-business-date.js', 'purpose-referral.js', 'arrivals-purpose.js']) await page.addScriptTag({ content: source(name) });
  // index.html historically overrides this function after arrivals-purpose.js.
  const syncStart = index.indexOf('// ── Sync arrivals → purpose of stay'), syncEnd = index.indexOf('// ── Edit purpose title', syncStart);
  if (syncStart >= 0 && syncEnd > syncStart) await page.addScriptTag({ content: index.slice(syncStart, syncEnd) });
  const listenerStart = index.indexOf('  listenPurpose(snap => {'), listenerEnd = index.indexOf('  listenNoShow(', listenerStart);
  assert(listenerStart >= 0 && listenerEnd > listenerStart, 'use the actual saved Purpose listener callback');
  await page.evaluate(() => { window.listenPurpose = callback => { window.purposeSnapshotListener = callback; }; });
  await page.addScriptTag({ content: index.slice(listenerStart, listenerEnd) });
  if (seed) await page.evaluate(() => {
    PurposeBusinessDate.restore({ businessDate: '2026-11-13', date: '2026-11-13', businessDateSource: 'opera', businessDateAt: Date.now() });
    purposeGuests = Array.from({ length: 10 }, (_, i) => ({ room: String(101 + i), conf: String(70000000 + i), name: 'SYNTHETIC WALKIN ' + i, purpose: 'Business', nights: 1, nat: 'Test country', email: 'fixture@example.test', source: 'Walk-in', originOfTravel: 'Test origin', howHeard: '', remarks: '' }));
    purposeGuests.push({ room: '201', conf: '70000101', name: 'KNOWN ANSWER', purpose: 'Leisure', nights: 2, nat: 'Test country', email: 'known@example.test', source: 'Booking.com', originOfTravel: 'Test origin', howHeard: 'Recommended by colleague', remarks: 'Known answer' });
    purposeGuests.push({ room: '202', conf: '70000102', name: 'OTA BLANK', purpose: 'Business', nights: 2, nat: 'Test country', email: 'ota@example.test', source: 'Booking.com', originOfTravel: 'Test origin', howHeard: '', remarks: '' });
    purposeRender();
  });
  return { page, context, errors };
}
function lastExport(page) { return page.evaluate(() => exports.at(-1)); }
function assertBusinessDate(rows, date, weekday) {
  assert.equal(rows[0][0], 'Day'); assert.equal(rows[0][1], 'Date');
  for (const row of rows.slice(1)) { assert.equal(row[0], weekday); assert.match(String(row[1]), date); }
}

(async () => {
  const executablePath = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium'].find(value => value && fs.existsSync(value));
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  try {
    for (const phone of [false, true]) {
      const { page, context, errors } = await fixture(browser, { phone });
      try {
        assert.equal(await page.evaluate(() => PurposeBusinessDate.resolve()), '2026-11-13');
        assert.equal(await page.locator('#purposeTable tr').count(), 12);
        assert.equal(await page.locator('#purposeTable tr').first().locator('td').nth(0).innerText(), 'Friday');
        assert.match(await page.locator('#purposeTable tr').first().locator('td').nth(1).innerText(), DATE_RE);
        assert(await page.locator('#purposeBusinessLabel').isVisible());
        assert.equal(await page.locator('#purposeRandomizeHeardButton').count(), 1);
        await page.evaluate(() => purposeRandomizeHeard(80));
        const fill = await page.evaluate(() => ({ walkin: purposeGuests.filter(g => sourceCategory(g.source) === 'walkin').map(g => g.howHeard), known: purposeGuests.find(g => g.name === 'KNOWN ANSWER').howHeard, ota: purposeGuests.find(g => g.name === 'OTA BLANK').howHeard }));
        assert.equal(fill.walkin.filter(value => value === 'Online search').length, 8);
        assert(fill.walkin.every(Boolean)); assert.equal(fill.known, 'Recommended by colleague'); assert.equal(fill.ota, 'Booking website');

        // Both layouts use the visible table under the current design layer.
        // Legacy card markup retains the same editable field for card-style themes.
        const input = page.locator('[data-purpose-heard="0"]:visible').first();
        assert(await input.isVisible());
        await input.fill('Neighbour recommendation'); await input.blur();
        const changed = await page.evaluate(() => ({ value: purposeGuests[0].howHeard, generated: purposeGuests[0]._howHeardGenerated }));
        assert.equal(changed.value, 'Neighbour recommendation'); assert.notEqual(changed.generated, true);
        await page.evaluate(() => purposeRandomizeHeard(80));
        assert.equal(await page.evaluate(() => purposeGuests[0].howHeard), 'Neighbour recommendation');
        await page.evaluate(() => { const field = document.querySelector('#purposeCards [data-purpose-heard="1"]'); field.value = 'Guest answer in card view'; field.dispatchEvent(new Event('input', { bubbles: true })); });
        assert.equal(await page.evaluate(() => purposeGuests[1].howHeard), 'Guest answer in card view');
        assert.notEqual(await page.evaluate(() => purposeGuests[1]._howHeardGenerated), true);
        const saved = await page.evaluate(() => JSON.stringify(purposeGuests));
        await page.evaluate(() => { purposeRender(); exportPurpose(); });
        assert.equal(await page.evaluate(() => JSON.stringify(purposeGuests)), saved, 'render/export must never rerandomize saved answers');
        let result = await lastExport(page), rows = result[2];
        assertBusinessDate(rows, DATE_RE, 'Friday');
        const heardColumn = rows[0].findIndex(value => /^How you hear about us$/i.test(String(value)));
        assert(heardColumn > rows[0].indexOf('Booking Source'));
        assert.equal(rows.find(row => row[4] === 'KNOWN ANSWER')[heardColumn], 'Recommended by colleague');
        assert.equal(rows[1][heardColumn], 'Neighbour recommendation');

        // Filtering affects the view, not the full day exported to the workbook.
        await page.evaluate(() => { purposeFilter_ = 'Business'; purposeRender(); exportPurpose(); });
        assert.equal(await page.locator('#purposeTable tr').count(), 11);
        assert.equal((await lastExport(page))[2].length, 13);
        await page.evaluate(() => { purposeFilter_ = 'all'; fixtureClock = Date.parse('2026-11-14T03:15:00Z'); purposeRender(); exportPurpose(); });
        assert.equal(await page.evaluate(() => PurposeBusinessDate.resolve()), '2026-11-13', 'clock midnight must not move the Opera report day');
        assertBusinessDate((await lastExport(page))[2], DATE_RE, 'Friday');
        const reload = await fixture(browser, { phone, context, seed: false, clock: '2026-11-14T03:15:00Z' });
        assert.equal(await reload.page.evaluate(() => PurposeBusinessDate.resolve()), '2026-11-13', 'the business day must survive a reopened page after midnight');
        assert.deepEqual(reload.errors, []); await reload.page.close();
        await page.evaluate(() => { PurposeBusinessDate.observe('2026-11-14', { source: 'opera', at: Date.now() }); purposeRender(); exportPurpose(); });
        assertBusinessDate((await lastExport(page))[2], /14[\s-]+Nov[\s-]+(?:20)?26/i, 'Saturday');
        assert.equal(await page.locator('#purposeTable tr').first().locator('td').nth(0).innerText(), 'Saturday');
        assert(await page.evaluate(() => archiveWrites.every(args => args[2] === PurposeBusinessDate.resolve() || args[2] === '2026-11-13')), 'daily aggregates must use the same business-day key');

        // A resync must not destroy a reviewer-entered answer on the same reservation.
        await page.evaluate(() => { arrGuests = purposeGuests.map(({ howHeard, _howHeardGenerated, _howHeardGeneratedValue, ...guest }) => guest); syncFromArrivals(); });
        assert.equal(await page.evaluate(() => purposeGuests.find(g => g.conf === '70000000').howHeard), 'Neighbour recommendation');
        assert.equal(await page.evaluate(() => purposeGuests.find(g => g.conf === '70000101').howHeard), 'Recommended by colleague');

        // Import the new header by name from a user workbook, rather than a fragile column number.
        await page.evaluate(() => {
          window.uploadRows = [['Checked In - Purpose of Stay'], ['Room', 'Name', 'Confirmation Number', 'Booking Source', 'How did you know about us', 'Nights'], ['303', 'IMPORTED FIXTURE', '70000303', 'Walk-in', 'Friend recommendation', '2']];
          window.XLSX = { read: () => ({ SheetNames: ['report'], Sheets: { report: {} } }), utils: { sheet_to_json: () => uploadRows } };
          window.FileReader = class { readAsArrayBuffer() { this.onload({ target: { result: new Uint8Array([1]).buffer } }); } };
          loadOperaFile({ files: [{ name: 'purpose-template.xlsx' }] }, 'pur');
        });
        assert.equal(await page.evaluate(() => purposeGuests[0].howHeard), 'Friend recommendation');
        await page.evaluate(() => { document.getElementById('purposeInput').value = 'Room\tName\tConfirmation Number\tHow you hear about us\tBooking Source\n304\tPASTED FIXTURE\t70000304\tExisting guest answer\tWalk-in'; loadPurpose(); });
        assert.equal(await page.evaluate(() => purposeGuests[0].howHeard), 'Existing guest answer');
        await page.waitForTimeout(500); // Existing delayed nationality/enrichment flow must preserve this column.
        assert.equal(await page.evaluate(() => purposeGuests[0].howHeard), 'Existing guest answer');
        assert.equal(await page.evaluate(() => savedReports.at(-1).guests[0].howHeard), 'Existing guest answer');
        await page.evaluate(() => exportPurpose());
        rows = (await lastExport(page))[2];
        assertBusinessDate(rows, /14[\s-]+Nov[\s-]+(?:20)?26/i, 'Saturday');
        assert.equal(rows[1][heardColumn], 'Existing guest answer');

        // A metadata-only server reply still advances the business day, even with no guest payload.
        const guestsBeforeDateOnly = await page.evaluate(() => JSON.stringify(purposeGuests));
        await page.evaluate(() => purposeSnapshotListener({ businessDate: '2026-11-15', businessDateSource: 'opera', businessDateAt: Date.now() + 1000, date: '2026-11-15' }));
        assert.equal(await page.evaluate(() => PurposeBusinessDate.resolve()), '2026-11-15');
        assert.match(await page.locator('#purposeBusinessLabel').innerText(), /Sunday.*15[\s-]+Nov/i);
        assert.equal(await page.locator('#purposeTable tr').first().locator('td').first().innerText(), 'Sunday');
        assert.equal(await page.evaluate(() => JSON.stringify(purposeGuests)), guestsBeforeDateOnly, 'date-only replies cannot clear the saved guest list');

        // An Opera rollover while typing must update Day/Date without rebuilding the focused cell.
        const typing = page.locator('#purposeTable [data-purpose-heard="0"]');
        await typing.fill('Still typing a guest answer');
        await page.evaluate(() => { window.livePurposeInput = document.activeElement; window.livePurposeGuest = purposeGuests[0]; livePurposeInput.setSelectionRange(5, 5); PurposeBusinessDate.observe('2026-11-16', { source: 'opera', at: Date.now() + 2000 }); });
        assert.equal(await page.evaluate(() => document.activeElement === livePurposeInput && livePurposeInput.isConnected), true);
        assert.equal(await typing.inputValue(), 'Still typing a guest answer');
        assert.equal(await page.evaluate(() => livePurposeInput.selectionStart), 5);
        assert.match(await page.locator('#purposeBusinessLabel').innerText(), /Monday.*16[\s-]+Nov/i);
        assert.equal(await page.locator('#purposeTable tr').first().locator('td').first().innerText(), 'Monday');
        await page.evaluate(() => purposeSnapshotListener({ businessDate: '2026-11-17', businessDateSource: 'opera', businessDateAt: Date.now() + 3000, guests: [{ room: '999', conf: 'REMOTE', name: 'REMOTE REPLACEMENT', howHeard: 'Remote answer' }] }));
        assert.equal(await page.evaluate(() => document.activeElement === livePurposeInput && purposeGuests[0] === livePurposeGuest), true, 'the server listener must not overwrite a row being edited');
        assert.equal(await typing.inputValue(), 'Still typing a guest answer');
        assert.match(await page.locator('#purposeBusinessLabel').innerText(), /Tuesday.*17[\s-]+Nov/i);
        assert.equal(await page.locator('#purposeTable tr').first().locator('td').first().innerText(), 'Tuesday');

        // Legacy card themes use the same focus guard when their card input is active.
        await page.addStyleTag({ content: '#purposeCards{display:block!important}' });
        await page.evaluate(() => { const field = document.querySelector('#purposeCards [data-purpose-heard="0"]'); field.closest('.pc-row').classList.add('open'); field.focus(); });
        const cardTyping = page.locator('#purposeCards [data-purpose-heard="0"]');
        await cardTyping.fill('Typing in card view');
        await page.evaluate(() => { window.livePurposeCardInput = document.activeElement; PurposeBusinessDate.observe('2026-11-18', { source: 'opera', at: Date.now() + 4000 }); });
        assert.equal(await page.evaluate(() => document.activeElement === livePurposeCardInput && livePurposeCardInput.isConnected), true);
        assert.equal(await cardTyping.inputValue(), 'Typing in card view');
        await page.evaluate(() => purposeSnapshotListener({ businessDate: '2026-11-19', businessDateSource: 'opera', businessDateAt: Date.now() + 5000, guests: [{ room: '999', name: 'REMOTE REPLACEMENT', howHeard: 'Remote answer' }] }));
        assert.equal(await page.evaluate(() => document.activeElement === livePurposeCardInput && purposeGuests[0] === livePurposeGuest), true, 'card edits must be protected from server list refreshes');
        assert.equal(await cardTyping.inputValue(), 'Typing in card view');
        assert.match(await page.locator('#purposeBusinessLabel').innerText(), /Thursday.*19[\s-]+Nov/i);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
    console.log('Purpose of Stay desktop/phone checks passed: Opera business-day lock across midnight/reopen, explicit rollover, date-only server updates, focused table/card edit preservation, consistent exports, editable referral suggestions, preserved answers, source-aware walk-ins and Excel/paste header imports. All data synthetic.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
