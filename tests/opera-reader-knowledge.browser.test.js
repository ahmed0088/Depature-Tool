'use strict';
// Synthetic Opera screens, no real accounts, network requests or writes.
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright-core');
const source=fs.readFileSync(__dirname+'/../tools/hotelops-opera.console.js','utf8');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:[process.env.CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&fs.existsSync(p)),args:['--no-sandbox']});
 try{
  const p=await browser.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>OPERA Cloud</title><main id="screen"></main>'}));await p.goto('https://example.oraclecloud.com/');
  await p.evaluate(()=>{window.sent=[];window.__hoOpExt={v:'653',post:o=>sent.push(JSON.parse(JSON.stringify(o))),on:cb=>{window.readerAck=cb;}};});await p.addScriptTag({content:source});
  const pairs=values=>Object.entries(values).map(([k,v],i)=>'<label for="field'+i+'">'+k+'</label><input readonly id="field'+i+'" value="'+v+'">').join('');
  const contacts=rows=>'<table><tr><th>Primary</th><th>Type</th><th>Communication Value</th><th>Seq</th></tr>'+rows.map(row=>'<tr>'+row.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</table>';
  async function screen(html){await p.evaluate(html=>{document.getElementById('screen').innerHTML=html;__hoOp.scan();},html);return p.evaluate(()=>__hoOp.state());}
  let state=await screen('<h1>Manage Profile</h1>'+pairs({'Name':'Example','First Name':'Ann','Country':'Oman'})+contacts([['Y','EMAIL','ann@example.test','1'],['N','EMAIL','other@example.test','2']]));
  assert.equal(state.kind,'profile');assert.equal(state.rows.length,1);assert.equal(state.rows[0].name,'Example, Ann');assert.equal(state.rows[0].email,'ann@example.test');
  state=await screen('<h1>Hello</h1>'+pairs({'Name':'Example','First Name':'Ann','Country':'Oman'})+contacts([['Y','EMAIL','ann@example.test','1']]));assert.equal(state.kind,'profile','contact layout identifies a profile under a generic heading');assert.equal(state.rows[0].email,'ann@example.test');
  state=await screen('<h1>Manage Profile</h1>'+pairs({'Name':'Example','First Name':'Ann','Country':'Oman'})+contacts([['','EMAIL','ann@example.test','1'],['','EMAIL','other@example.test','2']]));assert(!state.rows[0].email,'ambiguous emails are not chosen: '+JSON.stringify(state.rows));
  state=await screen('<h1>Manage Profile</h1>'+pairs({'Name':'Example','First Name':'Ann','Country':'Oman','Email':'existing@example.test'})+contacts([['Y','EMAIL','other@example.test','1']]));assert.equal(state.rows[0].email,'existing@example.test','explicit form email stays');
  state=await screen('<h1>Manage Profile</h1>'+pairs({'Profile Type':'Company','Company Name':'Synthetic Group','Name':'Example','First Name':'Ann'})+contacts([['Y','EMAIL','company@example.test','1']]));assert(!state.rows.some(r=>r.email),'company contacts are not assigned to a guest');
  state=await screen('<h1>Manage Profile</h1>'+pairs({'Name':'Example','First Name':'Ann','Country':'Oman'}).replace(/readonly/g,'')+contacts([['Y','EMAIL','ann@example.test','1']]));assert(!state.rows.some(r=>r.email),'unsaved identity edits must not acquire a contact email');
  const head=['Select All','Reason Code','Reason','Room','Room Type','From Date','Through Date','Return Status','Remarks'];
  state=await screen('<h1>Hello</h1><table><tr>'+head.map(h=>'<th>'+h+'</th>').join('')+'</tr><tr>'+['','MAINT','Repair','0102','SGC','20-Nov-2026','30-Nov-2026','Inspected','Synthetic note'].map(x=>'<td>'+x+'</td>').join('')+'</tr></table>');
  assert.equal(state.kind,'rooms');assert.equal(state.rows.length,0,'return status must not become a current room/guest status');assert.equal(state.tables.length,1);
  await screen('<h1>Hello</h1>');await p.waitForTimeout(1700);
  const events=await p.evaluate(()=>sent.flatMap(m=>m.learn||[]));assert(!events.some(e=>e.k==='s'&&e.s==='other'&&/hello|starter|initializing/i.test(e.l||'')));
  assert.deepEqual(errors,[]);console.log('Actual Opera reader passed: individual profile names, primary emails, ambiguity/company exclusions, maintenance lists and loading-screen filtering. No live data changed.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
