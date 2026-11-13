'use strict';
// Synthetic browser regression: the authenticated storage space is not the financial target.
// Firebase, discovery, snapshots and workflow dispatches are mocked; no real financial requests.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

(async () => {
  const executablePath = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => fs.existsSync(p));
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block', hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => route.request().url() === 'https://hotelops.test/' ? route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:14px system-ui;margin:12px;background:#11161f;--bg:#11161f;--card:#171d27;--text:#e8edf4;--text2:#9aa7b9;--border:#343d4d;--accent:#eab94a;color:var(--text)}.btn{border:1px solid var(--border);border-radius:12px;padding:12px;background:var(--card);color:var(--text)}[hidden]{display:none!important}</style><b id="hotelName">Ibis Styles Example</b><nav id="pkgTabs"><button data-v="audit">Audit</button><button data-v="rules">Rules</button></nav><main><div id="pkgMainView"></div></main>'
    }) : route.abort());
    await page.goto('https://hotelops.test/');
    await page.addScriptTag({ content: fs.readFileSync('ingauge-audit-core.js', 'utf8') });
    await page.addScriptTag({ content: `
      var currentProfile={role:'owner',active:true},HOTEL_ID='ibis-private-storage';
      window.showPanel=()=>{};window.showToast=()=>{};
      const C=InGaugeAuditCore,copy=v=>v==null?null:JSON.parse(JSON.stringify(v));
      window.ibisBinding=C.binding({portalUrl:'https://app.fpg-ingauge.com/',tenantId:'1',propertyId:'2',departmentId:'3',property:'Ibis Styles Example',department:'Front Desk'});
      window.mercureBinding=C.binding({...ibisBinding,propertyId:'22',departmentId:'33',property:'Mercure Example'});
      window.adagioBinding=C.binding({...ibisBinding,propertyId:'23',departmentId:'44',property:'Adagio Example'});
      window.fixtureRecord=(b,id='100')=>C.record({id,confirmationNumber:'12345678',tenantLocationId:Number(b.propertyId),locationGroupId:Number(b.departmentId),locationGroupProductId:4,userId:55,pname:'Late Checkout',userName:'Mercure Seller',auditStatus:'PENDING',upsellCharge:80,totalUpsellAmount:80,roomNights:1,arrivalDate:'2026-11-01',departureDate:'2026-11-01',businessDate:'2026-11-01',roomNumber:'202',memo:'Fixture',updatedOn:1,isManuallyAddedRecord:true});
      window.fixtureSnapshot=(b,id='ibis-snapshot',from='2026-11-01',to='2026-11-30')=>({schema:1,id,hotelId:HOTEL_ID,binding:b,complete:true,pagination:{verified:true,total:1,read:1,sort:'id'},fetchedAt:Date.now(),from,to,settings:{currency:'AED',metricType:'DAILY',validation:'BUSINESS_DATE',maxChargeCents:100000},permissions:{canAdd:true,canEdit:true,canApprove:true,canDeny:true,canDelete:true,canReassign:true},products:[{id:'4',name:'Late Checkout',code:'1062',activeStatus:'NORMAL',recurring:false}],contributors:[{id:'55',name:'Mercure Seller',activeStatus:'NORMAL'}],records:[fixtureRecord(b)]});
      window.tree={ingauge:{binding:ibisBinding,latestSnapshot:'ibis-snapshot',snapshots:{'ibis-snapshot':fixtureSnapshot(ibisBinding)},jobs:{},discovery:{portalUrl:ibisBinding.portalUrl,hotels:[{id:'2',name:ibisBinding.property,tenantId:'1',departments:[{id:'3',name:'Front Desk'}]},{id:'22',name:mercureBinding.property,tenantId:'1',departments:[{id:'33',name:'Front Desk'}]},{id:'23',name:adagioBinding.property,tenantId:'1',departments:[{id:'44',name:'Front Desk'}]}]}}};
      window.reads=[];window.writes=[];window.dispatches=[];window.networkRequests=[];const listeners=new Map();
      window.readPath=(path='')=>path.split('/').filter(Boolean).reduce((v,k)=>v?.[k],tree)??null;
      function putPath(path,value){const keys=path.split('/').filter(Boolean);if(!keys.length){tree=copy(value)||{};return;}let node=tree;for(const key of keys.slice(0,-1))node=node[key]||(node[key]={});if(value==null)delete node[keys.at(-1)];else node[keys.at(-1)]=copy(value);}
      async function emit(path){for(const [key,fns] of listeners)if(path===key||path.startsWith(key+'/')||key.startsWith(path+'/'))for(const fn of [...fns])await fn({val:()=>copy(readPath(key))});}
      function ref(path=''){return {child:p=>ref(path?path+'/'+p:p),once:async()=>{reads.push(path);if(window.pauseReadPath===path){window.snapshotReadPaused=true;await new Promise(resolve=>window.releaseSnapshotRead=resolve);}return {val:()=>copy(readPath(path))};},set:async value=>{writes.push({path,value:copy(value)});putPath(path,value);await emit(path);},update:async patch=>{writes.push({path,value:copy(patch)});for(const [key,value] of Object.entries(patch))putPath(path?path+'/'+key:key,value);await emit(path);},transaction:async change=>{const value=change(copy(readPath(path)));if(value!==undefined){putPath(path,value);await emit(path);}return {committed:value!==undefined,snapshot:{val:()=>copy(readPath(path))}};},on:(event,fn)=>{if(!listeners.has(path))listeners.set(path,new Set());listeners.get(path).add(fn);fn({val:()=>copy(readPath(path))});},off:(event,fn)=>listeners.get(path)?.delete(fn),orderByChild:()=>ref(path),limitToLast:()=>ref(path)};}
      var _ref=ref();window.firebase={auth:()=>({currentUser:{uid:'fixture-owner'}})};
      localStorage.setItem('ho_gh_start_key_v1','synthetic-key');
      window.fetch=async(url,options={})=>{networkRequests.push({url:String(url),method:options.method||'GET'});if(!String(url).startsWith('https://api.github.com/repos/ahmed0088/Depature-Tool/actions/workflows/ingauge-audit.yml'))throw Error('Unexpected network destination');if(options.method==='POST'){dispatches.push(JSON.parse(options.body));return {ok:true,status:204};}return {ok:true,status:200,json:async()=>({workflow_runs:[]})};};
      window.fixtureTargetKey=async b=>'t'+[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(C.stable({portalUrl:b.portalUrl,tenantId:b.tenantId,propertyId:b.propertyId,departmentId:b.departmentId}))))].map(n=>n.toString(16).padStart(2,'0')).join('').slice(0,40);
    ` });
    for (const file of ['package-audit.js', 'manual-upsells.js', 'monthly-tally.js']) await page.addScriptTag({ content: fs.readFileSync(file, 'utf8') });
    for (const file of ['ingauge-workspace.css', 'forms.css']) await page.addStyleTag({ content: fs.readFileSync(file, 'utf8') });
    await page.evaluate(async () => {
      const key = await fixtureTargetKey(mercureBinding);
      await _ref.child('ingauge/targets/' + key + '/auditContext').set({ staff: { mercure: { name: 'Mercure Seller', contributorId: '55', logins: ['MSELLER'], status: 'active' } }, pins: { mercureOnly: true }, rules: { chain: false } });
    });
    await page.addScriptTag({ content: fs.readFileSync('ingauge-workspace.js', 'utf8') });
    await page.click('[data-v=ingauge]');
    await page.waitForFunction(() => InGaugeWorkspace.state.snapshot?.id === 'ibis-snapshot' && !document.querySelector('[data-ig-bind]')?.disabled);
    assert.equal(await page.evaluate(() => InGaugeWorkspace.state.independent), false);

    // Preserve all legacy raw inputs/identity context, not only the visible snapshot.
    await page.evaluate(() => {
      pkgEvents = { '87654321': [{ code: 'UPS30BB', price: 30, user: 'IBISLOGIN' }] };
      pkgPdfFiles = ['ibis-new.pdf', 'ibis-update.pdf']; pkgGuests = { '87654321': { name: 'Ibis Guest', room: '101' } };
      pkgStaffDb = { ibis: { name: 'Ibis Seller', contributorId: '99', logins: ['IBISLOGIN'] } };
      pkgPins = { ibisOnly: true }; pkgMemory = {}; pkgUnknowns = [{ id: 'legacy-unknown' }]; _pkgLastRows = { ig: [['Ibis only']] };
      ManualUpsells.state.data.journal = { rows: [{ TRX_NO: '1', BUSINESS_DATE: '2026-11-01', CASHIER_DEBIT: '999.00' }] };
      ManualUpsells.state.data.reservations = { rows: [{ CONFIRMATION_NO: '87654321' }] };
      window.legacyState = () => JSON.stringify({ pkgEvents, pkgPdfFiles, pkgGuests, pkgStaffDb, pkgPins, pkgMemory, pkgUnknowns, _pkgLastRows, manualData: ManualUpsells.state.data, manualFiles: ManualUpsells.state.files });
      window.legacyBefore = legacyState();
      const S = InGaugeWorkspace.state; S.drafts.set('old-unselected', { key: 'old-unselected' }); S.history = [{ tag: 'old' }];
    });
    async function openSetup() {
      await page.evaluate(() => { document.getElementById('igSetupDetails').open = true; document.querySelector('#igConfiguration details').open = true; });
    }
    async function selectHotel(property, department) {
      await openSetup();
      await page.tap('#igProperty + .iga-choice');
      await page.tap('[data-ig-pick-value="' + property + '"]');
      await page.tap('#igDepartment + .iga-choice');
      await page.tap('[data-ig-pick-value="' + department + '"]');
      await page.check('#igBindConfirmed');
    }
    await page.click('[data-ig-task=edit]');
    await selectHotel('22', '33');
    await page.click('[data-ig-action=edit]');
    assert.equal(await page.locator('#igEditor').isVisible(), true);
    assert.equal(await page.evaluate(() => InGaugeWorkspace.state.editing.recordId), '100');
    // Simulate an already-open old-hotel editor when the target selection completes.
    await page.evaluate(() => document.querySelector('[data-ig-bind]').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await page.waitForFunction(() => InGaugeWorkspace.state.binding?.propertyId === '22' && !InGaugeWorkspace.state.switching);
    assert.equal(await page.locator('#igEditor').isHidden(), true);
    assert.equal(await page.evaluate(() => InGaugeWorkspace.state.editing), null);
    const switched = await page.evaluate(async () => {
      const S = InGaugeWorkspace.state;
      return { storage: HOTEL_ID, property: S.binding.property, independent: S.independent, snapshot: S.snapshot, drafts: S.drafts.size, selected: S.selected.size, reports: S.reports, reportFiles: S.reportFiles, targetPdf: S.targetPdf, targetIngauge: S.targetIngauge, manualResult: S.manualResult, history: S.history, staff: S.targetContext.staff, targetKey: S.targetKey, expectedKey: await fixtureTargetKey(mercureBinding), saved: readPath('ingauge/binding'), originalMarker: readPath('ingauge/legacyContext'), legacyUnchanged: legacyBefore === legacyState(), error: S.error };
    });
    assert.equal(switched.storage, 'ibis-private-storage');
    assert.equal(switched.property, 'Mercure Example'); assert.equal(switched.independent, true);
    assert.equal(switched.snapshot, null); assert.equal(switched.drafts, 0); assert.equal(switched.selected, 0);
    assert.deepEqual(switched.reports, {}); assert.deepEqual(switched.reportFiles, {});
    assert.deepEqual(switched.targetPdf, { events: {}, files: [] });
    assert.equal(switched.targetIngauge, null); assert.equal(switched.manualResult, null); assert.deepEqual(switched.history, []);
    assert.equal(switched.staff.mercure.name, 'Mercure Seller'); assert.equal(switched.staff.ibis, undefined);
    assert.equal(switched.targetKey, switched.expectedKey); assert.equal(switched.saved.propertyId, '22');
    assert.equal(switched.originalMarker.binding.propertyId, '2'); assert.equal(switched.legacyUnchanged, true); assert.equal(switched.error, '');
    assert.equal(await page.evaluate(() => InGaugeWorkspace.reportRequirements().includes('Opera Journal')), true, 'Legacy Ibis journal must not satisfy Mercure requirements');

    // Independent uploads read the new target without calling the legacy loaders.
    await page.evaluate(async () => {
      await InGaugeWorkspace.upload('journal', new File(['TRX_NO\tTRX_CODE\tBUSINESS_DATE\tCASHIER_DEBIT\tCASHIER_CREDIT\tGUEST_FULL_NAME\tROOM\tCURRENCY1\tREFERENCE\tUSER_NAME\n2001\t1062\t2026-11-01\t100.00\t0.00\tExample Guest\t202\tAED\tUpsell ** Mercure Seller\tMSELLER'], 'mercure-journal.txt', { type: 'text/plain' }));
      await InGaugeWorkspace.upload('reservations', new File(['CONFIRMATION_NO\tFULL_NAME\tTRUNC_BEGIN\tTRUNC_END\tROOM_NO\tSHORT_RESV_STATUS\n12345678\tExample Guest\t2026-11-01\t2026-11-01\t202\tCHECKED OUT'], 'mercure-reservations.txt', { type: 'text/plain' }));
    });
    assert.deepEqual(await page.evaluate(() => ({ journal: InGaugeWorkspace.state.reports.journal.rows.length, reservations: InGaugeWorkspace.state.reports.reservations.rows.length, name: InGaugeWorkspace.state.reportFiles.journal.name, missing: InGaugeWorkspace.reportRequirements(), legacyUnchanged: legacyBefore === legacyState() })), { journal: 1, reservations: 1, name: 'mercure-journal.txt', missing: [], legacyUnchanged: true });
    // A malformed replacement must not leave the previous upload eligible for use.
    for (const [kind, required] of [['journal', 'Opera Journal'], ['reservations', 'Reservation Detail']]) {
      const failed = await page.evaluate(async kind => {
        const S = InGaugeWorkspace.state;
        try { await InGaugeWorkspace.upload(kind, new File(['wrong report'], 'invalid-' + kind + '.txt', { type: 'text/plain' })); return { rejected: false }; }
        catch (error) { return { rejected: true, message: error.message, absent: !S.reports[kind], fileAbsent: !S.reportFiles[kind], reservationText: S.reservationText, missing: InGaugeWorkspace.reportRequirements(), legacyUnchanged: legacyBefore === legacyState() }; }
      }, kind);
      assert.equal(failed.rejected, true); assert.match(failed.message, /Wrong report|missing columns/);
      assert.equal(failed.absent, true); assert.equal(failed.fileAbsent, true); assert.equal(failed.missing.includes(required), true);
      if (kind === 'reservations') assert.equal(failed.reservationText, '');
      assert.equal(failed.legacyUnchanged, true);
      await page.evaluate(async kind => {
        const text = kind === 'journal' ? 'TRX_NO\tTRX_CODE\tBUSINESS_DATE\tCASHIER_DEBIT\tCASHIER_CREDIT\tGUEST_FULL_NAME\tROOM\tCURRENCY1\tREFERENCE\tUSER_NAME\n2001\t1062\t2026-11-01\t100.00\t0.00\tExample Guest\t202\tAED\tUpsell ** Mercure Seller\tMSELLER' : 'CONFIRMATION_NO\tFULL_NAME\tTRUNC_BEGIN\tTRUNC_END\tROOM_NO\tSHORT_RESV_STATUS\n12345678\tExample Guest\t2026-11-01\t2026-11-01\t202\tCHECKED OUT';
        await InGaugeWorkspace.upload(kind, new File([text], 'mercure-' + kind + '.txt', { type: 'text/plain' }));
      }, kind);
    }
    assert.deepEqual(await page.evaluate(() => InGaugeWorkspace.reportRequirements()), []);
    await page.click('[data-mt-fetch]');
    await page.waitForFunction(() => dispatches.length === 1);
    const readPlan = await page.evaluate(() => JSON.parse(readPath('ingauge/jobs/' + InGaugeWorkspace.state.tag).planJson));
    assert.equal(readPlan.mode, 'snapshot'); assert.equal(readPlan.hotelId, 'ibis-private-storage');
    assert.equal(readPlan.binding.propertyId, '22'); assert.equal(readPlan.binding.departmentId, '33');
    assert.equal(await page.evaluate(() => dispatches[0].inputs.hid), 'ibis-private-storage');
    assert.equal(await page.evaluate(() => dispatches[0].inputs.test), '1');

    // The UI and the handler both reject switching while a run is active.
    await page.click('#igRunWindow [data-ig-run-close]'); await openSetup();
    assert.equal(await page.locator('[data-ig-bind]').isDisabled(), true);
    await page.evaluate(() => { InGaugeWorkspace.state.error = ''; document.querySelector('[data-ig-bind]').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await page.waitForFunction(() => /current run/.test(InGaugeWorkspace.state.error));
    assert.equal(await page.evaluate(() => InGaugeWorkspace.state.binding.propertyId), '22');
    assert.equal(await page.evaluate(() => readPath('ingauge/binding').propertyId), '22');
    assert.equal(await page.evaluate(() => dispatches.length), 1);
    await page.evaluate(async () => {
      const S = InGaugeWorkspace.state, plan = JSON.parse(readPath('ingauge/jobs/' + S.tag).planJson);
      await _ref.child('ingauge/snapshots/mercure-snapshot').set(fixtureSnapshot(mercureBinding, 'mercure-snapshot', plan.from, plan.to));
      window.pauseReadPath = 'ingauge/snapshots/mercure-snapshot';
      window.terminalUpdate = _ref.child('ingauge/jobs/' + S.tag).update({ state: 'done', snapshotId: 'mercure-snapshot', note: 'Synthetic Mercure read finished' });
    });
    await page.waitForFunction(() => window.snapshotReadPaused);
    assert.equal(await page.evaluate(() => InGaugeWorkspace.state.job.state), 'done');
    assert.equal(await page.evaluate(() => InGaugeWorkspace.state.busy), true, 'The target stays locked until terminal snapshot import finishes');
    assert.equal(await page.locator('[data-ig-bind]').isDisabled(), true);
    await page.evaluate(() => { InGaugeWorkspace.state.error = ''; document.querySelector('[data-ig-bind]').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await page.waitForFunction(() => /current run/.test(InGaugeWorkspace.state.error));
    assert.equal(await page.evaluate(() => InGaugeWorkspace.state.binding.propertyId), '22');
    await page.evaluate(async () => { window.pauseReadPath = ''; window.releaseSnapshotRead(); await window.terminalUpdate; });
    await page.waitForFunction(() => !InGaugeWorkspace.state.busy && InGaugeWorkspace.state.snapshot?.id === 'mercure-snapshot');
    assert.equal(await page.evaluate(() => InGaugeWorkspace.state.targetIngauge.rows.length), 1);
    assert.equal(await page.evaluate(() => legacyBefore === legacyState()), true, 'Importing a Mercure snapshot must not replace legacy Ibis data');

    // Remembering a reviewed Opera login writes only this property's staff context.
    await page.evaluate(() => {
      const S = InGaugeWorkspace.state, r = S.snapshot.records[0];
      S.drafts.set('r-' + r.id, { key: 'r-' + r.id, action: 'edit', source: 'Package Audit', recordId: r.id, expected: C.fingerprint(r), confirmation: r.confirmation, productId: r.productId, contributorId: r.contributorId, values: C.values(r), statusAfter: 'PENDING', reason: '', evidence: 'Synthetic Mercure seller evidence', operaLogin: 'MERCURE-NEW' });
    });
    await page.click('[data-ig-task=edit]');
    await page.click('[data-ig-action=edit]');
    await page.fill('#igEditUnit', '90.00');
    await page.check('#igRememberAlias'); await page.click('[data-ig-save]');
    await page.waitForFunction(() => InGaugeWorkspace.state.selected.size === 1);
    assert.deepEqual(await page.evaluate(() => readPath('ingauge/targets/' + InGaugeWorkspace.state.targetKey + '/auditContext/staff/mercure').logins), ['MSELLER', 'MERCURE-NEW']);
    assert.equal(await page.evaluate(() => readPath('packageAudit/staff')), null);
    assert.equal(await page.evaluate(() => legacyBefore === legacyState()), true);

    // A saved review selection must be dealt with before its property can change.
    await selectHotel('23', '44');
    await page.click('[data-ig-bind]');
    await page.waitForFunction(() => /unselect your saved changes/.test(InGaugeWorkspace.state.error));
    assert.equal(await page.evaluate(() => InGaugeWorkspace.state.binding.propertyId), '22');
    await page.evaluate(() => InGaugeWorkspace.state.selected.clear());

    // Every history record is filtered by the actual IN-Gauge binding, even with one storage space.
    await page.evaluate(async () => {
      const saved = b => ({ state: 'done', test: false, reviewedAt: Date.now(), note: b.property + ' saved history', results: [], planJson: C.stable({ schema: 2, mode: 'apply', hotelId: HOTEL_ID, binding: b, operations: [] }) });
      await _ref.child('ingauge/jobs').set({ ibisHistory: saved(ibisBinding), mercureHistory: saved(mercureBinding), adagioHistory: saved(adagioBinding), otherStorage: { ...saved(mercureBinding), planJson: C.stable({ mode: 'apply', hotelId: 'other-private-storage', binding: mercureBinding, operations: [] }) } });
      await InGaugeWorkspace.loadHistory();
    });
    assert.deepEqual(await page.evaluate(() => InGaugeWorkspace.state.history.map(j => j.tag)), ['mercureHistory']);
    assert.equal(await page.evaluate(() => readPath('packageAudit/staff')), null);
    assert.equal(await page.evaluate(() => legacyBefore === legacyState()), true);

    // A new authenticated space has no implicit legacy target. Its first selection
    // is independent even if the IN-Gauge property happens to share the UI name.
    await page.evaluate(() => {
      const discovery = readPath('ingauge/discovery');
      HOTEL_ID = 'new-private-storage'; tree = { ingauge: { discovery } };
      InGaugeWorkspace.open();
    });
    await page.waitForFunction(() => InGaugeWorkspace.state.binding === null && !document.querySelector('[data-ig-bind]')?.disabled);
    await selectHotel('2', '3'); await page.click('[data-ig-bind]');
    await page.waitForFunction(() => InGaugeWorkspace.state.binding?.propertyId === '2' && !InGaugeWorkspace.state.switching);
    assert.equal(await page.evaluate(() => InGaugeWorkspace.state.independent), true);
    assert.equal(await page.evaluate(() => readPath('ingauge/legacyContext').schema), 1);
    assert.equal(await page.evaluate(() => readPath('ingauge/legacyContext').binding), null);
    assert.deepEqual(await page.evaluate(() => InGaugeWorkspace.state.targetContext), {});
    assert.deepEqual(await page.evaluate(() => InGaugeWorkspace.state.reports), {});
    assert.equal(await page.evaluate(() => legacyBefore === legacyState()), true);
    assert.deepEqual(errors, []);
    assert.deepEqual(await page.evaluate(() => networkRequests.map(r => r.method)), ['POST']);
    console.log('Any IN-Gauge hotel: Mercure selected from Ibis private storage; read plans, reports, seller aliases and history stay property-scoped. Stale editors close, failed replacements lose eligibility, and target switching stays blocked during run postprocessing or saved selections. All network and financial data mocked.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
