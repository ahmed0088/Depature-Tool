'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright-core');
(async()=>{const browser=await chromium.launch({executablePath:[process.env.CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&fs.existsSync(p)),headless:true,args:['--no-sandbox']});try{
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--card:#11161f;--bg2:#161c27;--text:#e9edf3;--text2:#a4adbc;--border:#343c4b;--accent:#eab94a;--accent-bg:#2f2a19}body{background:#080b10;color:var(--text);font:14px system-ui;margin:12px}[hidden]{display:none}</style><div id="chart"></div>');
 await page.addStyleTag({content:fs.readFileSync('ingauge-workspace.css','utf8')});await page.addScriptTag({content:fs.readFileSync('ingauge-audit-core.js','utf8')});await page.addScriptTag({content:fs.readFileSync('monthly-tally.js','utf8')});
 await page.evaluate(()=>{window.HOTEL_ID='example';window.fetches=[];window.InGaugeWorkspace={fetchMonth:async p=>fetches.push(p)};const b={portalUrl:'https://app.fpg-ingauge.com/',tenantId:'1',propertyId:'2',departmentId:'3',property:'Example Hotel'};window.S={binding:b,from:'2026-10-01',busy:false,snapshot:{hotelId:'example',binding:b,complete:true,pagination:{verified:true,total:2,read:2},from:'2026-10-01',to:'2026-10-31',settings:{currency:'AED'},products:[],records:[{id:'1',propertyId:'2',departmentId:'3',product:'Late Check Out',totalCents:60000,unitCents:1000,businessDate:'2026-10-05',status:'APPROVED'},{id:'2',propertyId:'2',departmentId:'3',product:'Late Check Out',totalCents:20000,unitCents:2000,businessDate:'2026-10-05',status:'PENDING'}]}};window.ManualUpsells={date:v=>v,state:{data:{journal:{rows:[{TRX_NO:'1',TRX_CODE:'1062',BUSINESS_DATE:'2026-10-05',CASHIER_DEBIT:'1000',CASHIER_CREDIT:'0',CURRENCY1:'AED'},{TRX_NO:'2',TRX_CODE:'9999',TRX_DESC:'Example room upsell',BUSINESS_DATE:'2026-10-06',CASHIER_DEBIT:'100',CASHIER_CREDIT:'0',CURRENCY1:'AED'}]}}}};const root=document.querySelector('#chart');root.className='mt-panel';MonthlyTally.render(S,root);});
 assert((await page.locator('.mt-metrics').innerText()).includes('AED 400.00'));
 assert.equal(await page.locator('svg[role=img]').count(),1);
 assert((await page.locator('.mt-pending').innerText()).includes('AED 200.00'));
 assert((await page.locator('.mt-state').innerText()).includes('Scope review needed'));
 await page.locator('.mt-mapping summary').tap();await page.locator('[data-mt-code="9999"][data-mt-family="ROOM"]').tap();
 assert((await page.locator('.mt-metrics').innerText()).includes('AED 500.00'));
 assert.equal(await page.locator('.mt-table tbody tr').count(),2);
 await page.locator('[data-mt-confirm]').check();assert((await page.locator('.mt-state').innerText()).includes('Difference found'));
 await page.locator('[data-mt-scope=automatic]').tap();assert.equal(await page.locator('[data-mt-confirm]').isChecked(),false);
 await page.locator('[data-mt-scope=all]').tap();
 await page.locator('[data-mt-fetch]').tap();assert.deepEqual(await page.evaluate(()=>fetches),[{from:'2026-10-01',to:'2026-10-31'}]);
 assert(await page.locator('.mt-panel').evaluate(el=>el.getBoundingClientRect().right<=innerWidth),'phone chart fits screen');
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'table scrolls inside its container, not the page');
 await page.screenshot({path:process.env.MONTHLY_SCREENSHOT||'/tmp/hotelops-monthly-tally.png',fullPage:true});
 await page.evaluate(()=>{S.snapshot.complete=false;MonthlyTally.render(S,document.querySelector('#chart'));});assert((await page.locator('.mt-state').innerText()).includes('Provisional'));
 await page.locator('[data-mt-month]').fill('2026-09');assert((await page.locator('.mt-state').innerText()).includes('Provisional'));
 // On the first day, month-to-date has exactly one plotted day. All positions
 // must stay finite, and excluded products must not leave a false review warning.
 await page.clock.install({time:new Date('2026-11-01T08:00:00Z')});
 await page.evaluate(()=>{
   ManualUpsells.state.data.journal={rows:[{TRX_NO:'10',TRX_CODE:'1062',BUSINESS_DATE:'2026-11-01',CASHIER_DEBIT:'10',CASHIER_CREDIT:'0',CURRENCY1:'AED'}]};
   S.snapshot={...S.snapshot,complete:true,from:'2026-11-01',to:'2026-11-01',pagination:{verified:true,total:4,read:4},records:[
     {id:'10',propertyId:'2',departmentId:'3',product:'Late Check Out',totalCents:1000,businessDate:'2026-11-01',status:'APPROVED'},
     ...['DENIED','PURGED','DELETED'].map((status,i)=>({id:String(20+i),propertyId:'2',departmentId:'3',product:'Unknown product',totalCents:null,businessDate:'2026-11-01',status}))
   ]};
   MonthlyTally.render(S,document.querySelector('#chart'));
 });
 assert((await page.locator('.iga-hint').allTextContents()).some(text=>text.includes('Month to date')));
 assert.equal(await page.locator('.mt-chart circle').count(),2,'one day supplies one Opera point and one approved point');
 const coordinates=await page.locator('.mt-chart svg').evaluate(svg=>Array.from(svg.querySelectorAll('line,polyline,circle')).flatMap(el=>Array.from(el.attributes).filter(a=>['points','cx','cy','x1','x2','y1','y2'].includes(a.name)).flatMap(a=>a.value.split(/[\s,]+/).filter(Boolean).map(Number))));
 assert(coordinates.length>0&&coordinates.every(Number.isFinite),'first-day chart cannot contain NaN or infinite SVG coordinates');
 await page.locator('[data-mt-confirm]').check();
 assert((await page.locator('.mt-state').innerText()).includes('Reported totals equal'),'excluded unknown products must not prevent confirmed equal totals');
 assert.deepEqual(errors,[]);console.log('Monthly tally mobile browser passed: graphic, amounts, pending separation, mapping, scope, month fetch, invalidation, responsive table and first-day finite chart coordinates.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
