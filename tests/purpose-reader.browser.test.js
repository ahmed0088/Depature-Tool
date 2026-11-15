'use strict';
// Run the actual read-only Opera reader and replay its date heartbeat into a
// reopened HotelOps bridge. All screens, properties and messages are synthetic.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright-core');
const ROOT=path.join(__dirname,'..'),source=name=>fs.readFileSync(path.join(ROOT,name),'utf8');
(async()=>{
  const executablePath=[process.env.CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&fs.existsSync(p));
  const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']});
  try{
    const reader=await browser.newPage(),errors=[];reader.on('pageerror',e=>errors.push(e.message));
    await reader.route('**/*',r=>r.request().url()==='https://example.oraclecloud.com/'?r.fulfill({contentType:'text/html',body:'<!doctype html><title>OPERA Cloud</title><main id="screen"><header><a title="Business Date: 16-Nov-2026">16-Nov-2026</a></header></main>'}):r.abort());
    await reader.goto('https://example.oraclecloud.com/');
    await reader.evaluate(()=>{window.sent=[];window.__hoOpExt={v:'597',post:o=>sent.push(JSON.parse(JSON.stringify(o))),on:callback=>window.readerAck=callback};});
    await reader.addScriptTag({content:source('tools/hotelops-opera.console.js')});
    await reader.waitForFunction(()=>sent.some(m=>m.ping&&m.businessDate==='2026-11-16'));
    const ping=await reader.evaluate(()=>sent.find(m=>m.ping&&m.businessDate==='2026-11-16'));
    assert(ping.h,'date-only frames must provide a snapshot hash when the app reopens');
    assert.equal(await reader.evaluate(()=>__hoOp.state().rows.length),0);
    assert(await reader.evaluate(()=>sent.some(m=>m.snap?.businessDate==='2026-11-16')));
    const fixtures=[
      ['<input id="globalBusinessDate" readonly value="16-Nov-2026">','2026-11-16'],
      ['<div><span>Business Date</span><span>16-Nov-2026</span></div>','2026-11-16'],
      ['<label for="filter">Business Date</label><input id="filter" value="20-Nov-2026">',''],
      ['<div><span>Business Date</span><input value="20-Nov-2026"></div>',''],
      ['<div role="grid"><div role="row"><span>Business Date: 20-Nov-2026</span></div></div>',''],
      ['<span hidden>Business Date: 13-Nov-2026</span><a title="Business Date: 16-Nov-2026">Current day</a>','2026-11-16'],
      ['<span>Business Date: 13-Nov-2026</span><a title="Business Date: 16-Nov-2026">Current day</a>',''],
      ['<h1>Arrivals 20-Nov-2026</h1><input aria-label="Arrival Date" value="20-Nov-2026">','']
    ];
    for(const [html,want] of fixtures){
      await reader.evaluate(html=>{document.getElementById('screen').innerHTML=html;__hoOp.scan();},html);
      assert.equal(await reader.evaluate(()=>__hoOp.state().businessDate),want,html);
    }
    const app=await browser.newPage();app.on('pageerror',e=>errors.push(e.message));
    await app.route('**/*',r=>r.request().url()==='https://purpose.hotelops.test/'?r.fulfill({contentType:'text/html',body:'<!doctype html><title>HotelOps fixture</title><main></main>'}):r.abort());
    await app.goto('https://purpose.hotelops.test/');
    await app.evaluate(()=>{window.HOTEL_ID='example';window.currentProfile={role:'owner',active:true};window.writes=[];window.savePurposeBusinessDate=(date,meta)=>writes.push({date,...meta});window.fbSet=async()=>{};});
    await app.addScriptTag({content:source('purpose-business-date.js')});await app.addScriptTag({content:source('opera-bridge.js')});
    await app.evaluate(()=>PurposeBusinessDate.restore({date:'2026-11-13',updatedAt:'2026-11-13T12:00:00Z'}));
    const deliver=async(data,origin='https://example.oraclecloud.com')=>app.evaluate(({data,origin})=>window.dispatchEvent(new MessageEvent('message',{data,origin})),{data,origin});
    await deliver({...ping,prop:'IBIS1'});assert.equal(await app.evaluate(()=>PurposeBusinessDate.resolve()),'2026-11-16');
    await app.evaluate(()=>PurposeBusinessDate.observe('2027-01-05',{source:'manual'}));
    await deliver({...ping,prop:'IBIS1',businessDate:'2026-11-17'});
    assert.equal(await app.evaluate(()=>PurposeBusinessDate.resolve()),'2027-01-05');
    assert.equal(await app.evaluate(()=>PurposeBusinessDate.info().operaDate),'2026-11-17');
    await deliver({...ping,prop:'OTHER1',businessDate:'2026-11-18'});
    await deliver({...ping,prop:'IBIS1',businessDate:'2026-11-19'},'https://unrelated.example');
    await deliver({...ping,prop:'IBIS1',businessDate:'2026-02-30'});
    await deliver({...ping,prop:'IBIS1',businessDate:'',date:'2026-11-20'});
    assert.equal(await app.evaluate(()=>PurposeBusinessDate.info().operaDate),'2026-11-17','foreign, invalid and filter dates must not become authorities');
    await app.evaluate(()=>PurposeBusinessDate.useOpera());assert.equal(await app.evaluate(()=>PurposeBusinessDate.resolve()),'2026-11-17');
    assert.deepEqual(errors,[]);await reader.close();await app.close();
    console.log('Actual Opera reader and reopened bridge passed: date-only heartbeat, tooltip/readonly/paired headers, hidden/filter/grid/conflict exclusions, manual dates, origin and hotel isolation. No live data or external writes.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
