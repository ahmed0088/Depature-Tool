'use strict';
// Save mode on the mock Opera (FAKE guests): fills only EMPTY fields, never overwrites a value that is already there,
// presses Save only for a guest it filled, and never clicks anything about folios, postings or cashiering.
const fs = require('node:fs'), assert = require('node:assert/strict'), { chromium } = require('playwright-core'), C = require('../immig-fixer-core.js');
const fixer = fs.readFileSync(__dirname + '/../tools/hotelops-opera-fixer.console.js', 'utf8');
const m = /const html=`([\s\S]*?)`;\nconst plan=/.exec(fs.readFileSync(__dirname + '/immig-fixer-auto.browser.test.js', 'utf8'));
assert(m, 'mock Opera page found');
let html = m[1];
html = html.replace("document.getElementById('save').onclick=()=>{window.__saved=true};", "document.getElementById('save').onclick=()=>{window.__saved=true;(window.__savedRooms=window.__savedRooms||[]).push(room)};")
  .replace("document.getElementById('edit').onclick=e=>{e.preventDefault();", "document.getElementById('edit').onclick=e=>{e.preventDefault();(window.__edited=window.__edited||[]).push(room);");
assert(/__savedRooms/.test(html) && /__edited/.test(html), 'mock hooks applied');
// the plan WANTS gender M for both guests; room 0302 already has F in Opera, so it must stay F and not be saved
const plan = () => { const rows = [{ room: '0301', name: 'Zed Fakeperson', arrival: '11/23/2026', noSex: true, suggestedSex: 'M' }, { room: '0302', name: 'Amy Notreal', arrival: '11/23/2026', noSex: true, suggestedSex: 'M' }]; const p = C.buildPlan(rows, [], { hotel: 'Test' }); const ok = {}; p.items.forEach(i => { ok[i.id] = { gender: true }; }); return C.encodePlan(p, ok, { origin: '' }); };
(async () => {
  const executablePath = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => p && fs.existsSync(p)), browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 700 } }), errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.setContent(html); await page.addScriptTag({ content: fixer });
    await page.evaluate(([code]) => { const t = window.__hoFixer._test; t.setPlan(t.decode(code)); t.setDry(false); }, [plan()]);
    await page.evaluate(() => window.__hoFixer._test.autoRun(0));
    assert.deepEqual(await page.evaluate(() => window.__opened), ['0301', '0302'], 'both guests were visited');
    assert.deepEqual(await page.evaluate(() => window.__edited || []), ['0301'], 'only the empty field was opened for editing; the guest who already has a gender was not');
    assert.deepEqual(await page.evaluate(() => window.__savedRooms || []), ['0301'], 'Save pressed once, for the guest that was filled, never for the one with a value');
    const clicks = await page.evaluate(() => window.__clicks);
    assert(!clicks.some(c => /folio|post|cashier|billing|payment|settle/i.test(c)), 'nothing about folios, postings or cashiering was clicked: ' + clicks.join('|'));
    const log = await page.evaluate(() => window.__hoFixer._test.st.log.map(e => e.room + ' ' + e.field + ' ' + e.result).join('\n'));
    assert(/\b302 gender skipped: already has a value/.test(log), 'the existing value is logged as skipped: ' + log);
    assert.deepEqual(errors, []);
    assert.deepEqual([...C.FIELDS].sort(), ['gender', 'idNumber', 'idType', 'nationality'], 'only these four fields can ever be filled: Issued Place is never touched');
    // the plain result lists the card shows
    const s = C.cloudSummary([{ room: '0301', field: 'gender', result: 'filled' }, { room: '0301', field: 'guest', result: 'SAVED 1 field(s) 900 ms' }, { room: '0302', field: 'gender', result: 'skipped: already has a value' }, { room: '0302', field: 'guest', result: 'DONE 700 ms' }, { room: '0303', field: 'guest', result: 'FAILED name was not found' }], true);
    assert.deepEqual(s.saved, ['0301']); assert.deepEqual(s.none, ['0302']); assert.equal(s.bad.length, 1); assert.equal(s.bad[0][0], '0303');
    console.log('immig-save-never-overwrite: fills empty fields only, never overwrites, saves only filled guests, no folio/posting clicks; result lists ok');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
