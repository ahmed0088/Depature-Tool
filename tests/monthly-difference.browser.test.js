'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright-core');
(async()=>{
 const browser=await chromium.launch({executablePath:[process.env.CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&fs.existsSync(p)),headless:true,args:['--no-sandbox']});
 try{
  for(const width of [390,1100]){
   const page=await browser.newPage({viewport:{width,height:844},isMobile:width===390,hasTouch:width===390});const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--card:#11161f;--bg2:#161c27;--text:#e9edf3;--text2:#a4adbc;--border:#343c4b;--accent:#eab94a;--accent-bg:#2f2a19}body{background:#080b10;color:var(--text);font:14px system-ui;margin:12px}[hidden]{display:none}</style><div id="chart" class="mt-panel"></div>');
   await page.addStyleTag({content:fs.readFileSync('ingauge-workspace.css','utf8')});
   for(const file of ['ingauge-audit-core.js','monthly-tally.js'])await page.addScriptTag({content:fs.readFileSync(file,'utf8')});
   await page.evaluate(()=>{
    window.HOTEL_ID='example';window.fetches=[];window.InGaugeWorkspace={fetchMonth:async p=>fetches.push(p)};
    const binding={portalUrl:'https://app.fpg-ingauge.com/',tenantId:'1',propertyId:'2',departmentId:'3',property:'Example Hotel'};
    const journal=[{TRX_NO:'101',TRX_CODE:'1062',BUSINESS_DATE:'2026-10-05',CASHIER_DEBIT:'100',CASHIER_CREDIT:'0',CURRENCY1:'AED',ROOM:'0102',GUEST_FULL_NAME:'EXAMPLE, ALEX'}];
    const reservations=[{CONFIRMATION_NO:'12345',FULL_NAME:'Alex Example',ROOM_NO:'102',TRUNC_BEGIN:'2026-10-01',TRUNC_END:'2026-10-06',SHORT_RESV_STATUS:'CKIN'}];
    const records=[{id:'777',confirmation:'12345',propertyId:'2',departmentId:'3',product:'Late Check Out',seller:'Example Seller',totalCents:15000,businessDate:'2026-10-05',status:'APPROVED'}];
    window.S={targetKey:'independent-hotel',independent:true,binding,from:'2026-10-01',busy:false,reports:{journal:{rows:journal},reservations:{rows:reservations}},snapshot:{hotelId:'example',binding,complete:true,pagination:{verified:true,total:1,read:1},from:'2026-10-01',to:'2026-10-31',settings:{currency:'AED'},records}};
    window.ManualUpsells={date:v=>v};window.initialRecords=JSON.stringify(records);MonthlyTally.render(S,document.querySelector('#chart'));
   });
   assert.match(await page.locator('.mt-gap-meaning').innerText(),/IN-Gauge approved is AED 50.00 higher than Opera/);
   await page.locator('.mt-difference>summary').click();
   assert.match(await page.locator('.mt-diff-summary').innerText(),/2026-10-05/);
   const row=page.locator('.mt-diff-row').first();assert.match(await row.innerText(),/Confirmation 12345/);assert.match(await row.innerText(),/EXAMPLE, ALEX/);assert.match(await row.innerText(),/Both systems have entries/);
   await row.locator('summary').click();assert.match(await row.locator('details').innerText(),/101 \(1062\) · AED 100.00/);assert.match(await row.locator('details').innerText(),/777 · Late Check Out · APPROVED · Example Seller · AED 150.00/);
   assert.equal(await page.locator('.mt-diff-tools input[data-ig-file=reservations]').count(),1);
   assert.match(await page.locator('.mt-warning').first().innerText(),/last posting/);
   const downloadPromise=page.waitForEvent('download');await page.locator('[data-mt-export-difference]').click();const download=await downloadPromise;assert.equal(download.suggestedFilename(),'Monthly_difference_2026-10.csv');const csv=fs.readFileSync(await download.path(),'utf8');assert(csv.includes('12345'));assert(csv.includes('Example Seller'));
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'evidence fits screen at '+width);
   assert.equal(await page.evaluate(()=>JSON.stringify(S.snapshot.records)===initialRecords),true,'read-only evidence must preserve source records');assert.deepEqual(await page.evaluate(()=>fetches),[],'explanation and download do not fetch or submit');
   // Keep financial evidence available when optional chart visuals are off.
   await page.evaluate(()=>{window.InGaugeSettings={get:()=>({graphs:false,breakdown:false})};MonthlyTally.render(S,document.querySelector('#chart'));});
   assert.equal(await page.locator('.mt-chart').count(),0);assert.equal(await page.locator('.mt-difference').evaluate(el=>el.open),true);assert.equal(await page.locator('.mt-diff-row').count(),1);
   // Large lists expand in place and keep the source breakdown open.
   await page.evaluate(()=>{for(let n=1;n<=24;n++)S.reports.journal.rows.push({...S.reports.journal.rows[0],TRX_NO:String(101+n),CONFIRMATION_NO:'E'+n});MonthlyTally.render(S,document.querySelector('#chart'));});
   assert.equal(await page.locator('.mt-diff-row').count(),20);await page.locator('[data-mt-more-differences]').click();assert.equal(await page.locator('.mt-diff-row').count(),25);assert.equal(await page.locator('.mt-difference').evaluate(el=>el.open),true);assert.equal(await page.locator('[data-mt-more-differences]').count(),0);
   if(width===390)await page.screenshot({path:process.env.MONTHLY_DIFFERENCE_SCREENSHOT||'/tmp/hotelops-monthly-difference.png',fullPage:true});
   assert.deepEqual(errors,[]);await page.close();
  }
  console.log('Monthly difference phone/desktop passed: source IDs, exact values, booking match, coverage warning, CSV download, unchanged source records, settings and expansion.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
