'use strict';
// All data is synthetic. Browser preferences never submit or edit a financial record.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

async function fixture(browser, phone) {
  const page = await browser.newPage({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 900 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url() === 'https://settings.hotelops.test/' ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:14px system-ui;margin:12px;background:#080b10;--card:#11161f;--bg:#0b0e14;--bg2:#161c27;--text:#edf1f7;--text2:#a4adbc;--border:#343c4b;--accent:#eab94a;--accent-bg:#302a18;color:var(--text)}.btn{padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--card);color:var(--text)}[hidden]{display:none!important}</style><b id="hotelName">Example Hotel</b><nav id="pkgTabs"><button data-v="audit">Audit</button><button data-v="rules">Rules</button></nav><main><div id="pkgMainView"></div></main>' }) : route.abort());
  await page.goto('https://settings.hotelops.test/');
  await page.addStyleTag({ content: fs.readFileSync('ingauge-workspace.css', 'utf8') });
  for (const name of ['ingauge-audit-core.js', 'manual-upsells.js', 'ingauge-settings.js', 'monthly-tally.js']) await page.addScriptTag({ content: fs.readFileSync(name, 'utf8') });
  await page.evaluate(() => {
    window.HOTEL_ID = 'example-private'; window.currentProfile = { role: 'owner', active: true }; window._ref = null;
    window.firebase = { auth: () => ({ currentUser: { uid: 'owner-one' } }) };
    window.showPanel = () => {}; window.showToast = () => {}; window.requests = [];
    window.fetch = async (...args) => { requests.push(args); throw Error('No external requests allowed'); };
  });
  await page.addScriptTag({ content: fs.readFileSync('ingauge-workspace.js', 'utf8') });
  await page.evaluate(() => {
    const C = InGaugeAuditCore, S = InGaugeWorkspace.state;
    window.originalBinding = C.binding({ portalUrl: 'https://app.fpg-ingauge.com/', tenantId: '1', propertyId: '2', departmentId: '3', property: 'Example Hotel', department: 'Front Desk' });
    const record = C.record({ id: 100, confirmationNumber: '12345678', tenantLocationId: 2, locationGroupId: 3, locationGroupProductId: 4, userId: 5, pname: 'Late Check Out', userName: 'Jordan River', auditStatus: 'PENDING', upsellCharge: 100, totalUpsellAmount: 100, roomNights: 1, arrivalDate: '2026-11-01', departureDate: '2026-11-03', businessDate: '2026-11-01', roomNumber: '101', memo: 'Synthetic fixture', updatedOn: 1, isManuallyAddedRecord: true });
    S.binding = originalBinding;
    S.snapshot = { schema: 1, id: 'settings-ui', hotelId: HOTEL_ID, binding: originalBinding, complete: true, pagination: { verified: true, total: 1, read: 1 }, fetchedAt: Date.now(), from: '2026-11-01', to: '2026-11-30', settings: { currency: 'AED', validation: 'BUSINESS_DATE', metricType: 'DAILY', maxChargeCents: 100000 }, permissions: { canAdd: true, canEdit: true, canApprove: true, canDeny: true, canDelete: true, canReassign: true }, products: [{ id: '4', name: 'Late Check Out', code: '1062', activeStatus: 'NORMAL', recurring: false }], contributors: [{ id: '5', name: 'Jordan River', pulseId: 'JR001', activeStatus: 'NORMAL' }], records: [record] };
    S.from = S.snapshot.from; S.to = S.snapshot.to; S.scope = 'all';
    ManualUpsells.state.data.journal = { rows: [{ TRX_NO: '1', TRX_CODE: '1062', BUSINESS_DATE: '2026-11-01', CASHIER_DEBIT: '100', CASHIER_CREDIT: '0', CURRENCY1: 'AED' }] };
    ManualUpsells.state.data.reservations = { rows: [] };
    window.sourceBefore = JSON.stringify(ManualUpsells.state.data);
    window.makeDraft = () => {
      const r = S.snapshot.records[0];
      return { key: 'r-100', action: 'edit', source: 'Existing record', recordId: r.id, expected: C.fingerprint(r), confirmation: r.confirmation, productId: r.productId, contributorId: r.contributorId, values: { ...C.values(r), unitCents: 12500, totalCents: 12500 }, statusAfter: 'PENDING', reason: '', evidence: 'Synthetic reviewed edit' };
    };
    InGaugeWorkspace.open();
  });
  return { page, errors };
}

(async () => {
  const executablePath = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => p && fs.existsSync(p));
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  try {
    for (const phone of [false, true]) {
      const { page, errors } = await fixture(browser, phone);
      try {
        const trigger = page.locator('[data-ig-settings]');
        assert(await trigger.isVisible(), 'settings must be available at the top of every task');
        await trigger.click();
        assert(await page.locator('#igSettingsOverlay').isVisible());
        assert.equal(await page.locator('#igSettingsOverlay [role=dialog]').getAttribute('aria-modal'), 'true');
        assert((await page.locator('#igSettingsOverlay').innerText()).includes('always stay on'));
        assert(await page.locator('#igSettingsOverlay [role=dialog]').evaluate(el => { const r = el.getBoundingClientRect(); return r.right <= innerWidth + 1 && r.left >= -1 && r.top >= -1 && r.bottom <= innerHeight + 1; }));
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'sheet cannot widen the phone viewport');
        if (process.env.INGAUGE_SETTINGS_SCREENSHOT_DIR) {
          fs.mkdirSync(process.env.INGAUGE_SETTINGS_SCREENSHOT_DIR, { recursive: true });
          await page.screenshot({ path: process.env.INGAUGE_SETTINGS_SCREENSHOT_DIR + (phone ? '/settings-phone.png' : '/settings-desktop.png') });
        }
        await page.keyboard.press('Shift+Tab');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'igSettingsDone', 'backwards Tab stays in the dialog');
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'igSettingsClose', 'forwards Tab wraps to the close button');

        await page.locator('[data-ig-setting=monthly]').uncheck();
        assert(await page.locator('[data-ig-monthly]').isHidden(), 'monthly tool turns off immediately');
        assert(await page.locator('#igMonthlyTally').isHidden());
        assert.equal(await page.evaluate(() => InGaugeSettings.get(InGaugeWorkspace.state).monthly), false);
        await page.locator('[data-ig-setting=manual]').uncheck();
        assert.equal(await page.evaluate(() => InGaugeWorkspace.state.scope), 'automatic');
        await page.locator('[data-ig-setting=automatic]').click();
        assert(await page.locator('#igSettingsError').isVisible(), 'cannot switch every audit mode off');
        assert.equal(await page.evaluate(() => InGaugeSettings.get(InGaugeWorkspace.state).automatic), true);
        await page.keyboard.press('Escape');
        assert(await page.locator('#igSettingsOverlay').isHidden());
        assert(await trigger.evaluate(el => document.activeElement === el), 'Escape restores focus to top settings button');

        // A stored preference survives task rerenders and is isolated from other properties.
        await page.evaluate(() => { InGaugeWorkspace.open(); });
        assert(await page.locator('[data-ig-monthly]').isHidden());
        const isolated = await page.evaluate(() => {
          const S = InGaugeWorkspace.state;
          return InGaugeSettings.get({ ...S, targetKey: '', binding: { ...S.binding, propertyId: '22', property: 'Other hotel' } }).monthly;
        });
        assert.equal(isolated, true);

        await page.evaluate(() => { InGaugeWorkspace.state.busy = true; InGaugeWorkspace.openSettings(); });
        assert(await page.locator('[data-ig-setting=monthly]').isDisabled(), 'running jobs lock preferences while settings remain readable');
        await page.locator('#igSettingsClose').click();
        assert(await page.locator('#igSettingsOverlay').isHidden(), 'settings can still be closed during a run');
        await page.evaluate(() => { InGaugeWorkspace.state.busy = false; });

        // Business switches are guarded; visual choices remain usable with a staged edit.
        const guard = await page.evaluate(() => {
          const S = InGaugeWorkspace.state; S.busy = true; let busy = '';
          try { InGaugeWorkspace.updateSettings({ manual: true }); } catch (e) { busy = e.message; }
          S.busy = false;
          const draft = makeDraft(); S.drafts.set(draft.key, draft); S.selected.add(draft.key);
          let selected = ''; try { InGaugeWorkspace.updateSettings({ edit: false }); } catch (e) { selected = e.message; }
          S.reviewed = true;
          InGaugeWorkspace.updateSettings({ compact: true, hints: false });
          const reviewed = S.reviewed; InGaugeWorkspace.updateSettings({ automation: false });
          return { busy, selected, reviewed, automation: InGaugeSettings.get(S).automation, count: S.selected.size, compact: document.getElementById('igWorkspace').classList.contains('iga-compact') };
        });
        assert(guard.busy); assert(guard.selected); assert.equal(guard.count, 1); assert.equal(guard.compact, true);
        assert.equal(guard.reviewed, true, 'display preferences retain the review approval'); assert.equal(guard.automation, false, 'automation can be paused with drafts selected');

        // Reset and display controls never touch loaded source records or evidence.
        await page.evaluate(() => { InGaugeWorkspace.state.selected.clear(); });
        await trigger.click(); await page.locator('#igSettingsReset').click();
        await page.waitForFunction(() => InGaugeSettings.get(InGaugeWorkspace.state).monthly && InGaugeSettings.get(InGaugeWorkspace.state).automation);
        await page.keyboard.press('Escape'); await page.evaluate(() => InGaugeWorkspace.setScope('all'));
        assert.equal(await page.evaluate(() => sourceBefore === JSON.stringify(ManualUpsells.state.data)), true);
        assert.equal(await page.evaluate(() => InGaugeWorkspace.state.snapshot.records.length), 1);
        await page.evaluate(() => { InGaugeWorkspace.updateSettings({ graphs: false, breakdown: false, history: false }); InGaugeWorkspace.showMonthly(); });
        assert.equal(await page.locator('.mt-total-bars,.mt-chart,.mt-legend,.mt-table,.mt-more').count(), 0);
        assert(await page.locator('#igHistoryDetails').isHidden());
        assert(await page.locator('.mt-metrics').isVisible(), 'totals remain visible when optional charts are off');

        // A forged click cannot bypass the automation setting or reach a workflow dispatch.
        await page.evaluate(() => {
          const S = InGaugeWorkspace.state; InGaugeWorkspace.updateSettings({ automation: false });
          const draft = makeDraft(); S.drafts.set(draft.key, draft); S.selected.add(draft.key); S.reviewed = true;
          InGaugeWorkspace.setTask('edit'); S.error = '';
          document.querySelector('[data-ig-apply]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        await page.waitForFunction(() => !!InGaugeWorkspace.state.error);
        assert.match(await page.evaluate(() => InGaugeWorkspace.state.error), /automation|reviewed changes|switched off|disabled|settings/i);
        assert.equal(await page.evaluate(() => requests.length), 0);

        // Disabling Approve also blocks an edit/add that tries to produce APPROVED.
        for (const action of ['edit', 'add']) {
          await page.evaluate(action => {
            const S = InGaugeWorkspace.state; S.selected.clear(); InGaugeWorkspace.updateSettings({ ...InGaugeSettings.DEFAULTS, approve: false });
            const draft = makeDraft(); draft.statusAfter = 'APPROVED';
            if (action === 'add') { delete draft.recordId; delete draft.expected; draft.action = 'add'; draft.key = 't-synthetic'; draft.transaction = '987'; draft.confirmation = '87654321'; }
            S.drafts.clear(); S.drafts.set(draft.key, draft); S.selected.add(draft.key); S.reviewed = true; InGaugeWorkspace.setTask('edit'); S.error = '';
            document.querySelector('[data-ig-apply]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
          }, action);
          await page.waitForFunction(() => !!InGaugeWorkspace.state.error);
          assert.match(await page.evaluate(() => InGaugeWorkspace.state.error), /approv|turned off|settings/i, action + ' cannot bypass disabled approval');
          assert.equal(await page.evaluate(() => requests.length), 0);
        }
        await page.evaluate(() => { const S = InGaugeWorkspace.state; S.selected.clear(); InGaugeWorkspace.updateSettings({ ...InGaugeSettings.DEFAULTS, edit: false }); InGaugeWorkspace.setTask('edit'); });
        assert(await page.locator('[data-ig-record="100"][data-ig-action=edit]').isHidden(), 'disabled edit action is hidden');
        await page.evaluate(() => {
          InGaugeWorkspace.state.error = '';
          const b = document.createElement('button'); b.dataset.igRecord = '100'; b.dataset.igAction = 'edit'; document.getElementById('igWorkspace').appendChild(b); b.dispatchEvent(new MouseEvent('click', { bubbles: true })); b.remove();
        });
        await page.waitForFunction(() => !!InGaugeWorkspace.state.error);
        assert.equal(await page.evaluate(() => InGaugeWorkspace.state.editing), null, 'forged disabled action cannot open an editor');
        assert.equal(await page.evaluate(() => requests.length), 0); assert.deepEqual(errors, []);
      } finally { await page.close(); }
    }
    console.log('IN-Gauge settings passed on desktop and phone: accessible drawer, scoped persistence, live feature controls, financial guards, optional chart display and reset without source-data changes. All external actions mocked.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
