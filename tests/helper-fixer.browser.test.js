'use strict';
// The Opera fixer inside the Chrome helper (FAKE guests, fake chrome API): the relay keeps the list in memory only, hands it to the fixer
// on the Opera tab, the fixer shows its window and loads it (dry run on), and nothing here ever presses Save.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{chromium}=require('playwright-core'),C=require('../immig-fixer-core.js');
const W={};new Function('window','APP_VERSION','document',fs.readFileSync(__dirname+'/../wa-helper.js','utf8')+'\n;')(W,'v633',undefined);
const fixerSrc=fs.readFileSync(__dirname+'/../tools/hotelops-opera-fixer.console.js','utf8');
const F=Object.fromEntries(W.hoWaHelper.files('/*r*/','https://app.test','/*o*/','',fixerSrc));
const M=JSON.parse(F['manifest.json']);
assert(M.content_scripts.some(c=>c.js.includes('fixer.js')&&c.matches.some(m=>/oraclecloud/.test(m))&&!c.all_frames),'fixer.js runs on Opera hosts, top frame only');
assert(/ho-fx-job/.test(F['hotelops.js'])&&/hoFxHelper/.test(F['hotelops.js']),'HotelOps side carries the job and says the fixer is there');
const plan=()=>{const p=C.buildPlan([{room:'0301',name:'Zed Fakeperson',arrival:'11/23/2026',noSex:true,suggestedSex:'M'}],[],{hotel:'Test'}),ok={};p.items.forEach(i=>{ok[i.id]={gender:true}});return C.encodePlan(p,ok,{origin:''});};
// ── relay in a sandbox with a fake chrome ──
const mkPort=(name,url)=>{const msgs=[],ls=[];return{name,sender:{url,tab:{id:7,windowId:3}},msgs,postMessage:m=>msgs.push(m),onMessage:{addListener:f=>ls.push(f)},onDisconnect:{addListener(){}},fire:m=>Promise.all(ls.map(f=>f(m)))};};
const stores={local:{},session:{}};const calls=[];
const area=n=>({get:async k=>{const o={};(Array.isArray(k)?k:[k]).forEach(x=>{if(x in stores[n])o[x]=stores[n][x]});return o},set:async o=>{Object.assign(stores[n],o)},remove:async k=>{(Array.isArray(k)?k:[k]).forEach(x=>delete stores[n][x])}});
let onConnect;
const chrome={runtime:{getManifest:()=>({version:'633'}),onConnect:{addListener:f=>{onConnect=f}},setUninstallURL(){},connect(){}},storage:{local:area('local'),session:area('session')},userScripts:{getScripts:async()=>[],configureWorld:async()=>{},register:async()=>{},update:async()=>{},unregister:async()=>{}},tabs:{create:async o=>{calls.push(['create',o.url]);return{id:1}},update:(id,o)=>calls.push(['tab',id,o.active]),remove(){}},windows:{update:(id,o)=>calls.push(['win',id,o.focused])}};
vm.runInNewContext(F['relay.js'],{chrome,console,URL,setTimeout,Date,JSON,Promise});
(async()=>{
 const app=mkPort('app','https://app.test/'),fix=mkPort('fixer','https://x.oraclehospitality.com/'),code=plan();
 onConnect(app);await new Promise(r=>setTimeout(r,50));
 // no Opera tab yet: the Opera link opens, the list waits in memory
 await app.fire({source:'ho-fx-job',code,url:'https://fake.oraclehospitality.eu-frankfurt-1.ocs.oraclecloud.com/X/operacloud/'});
 assert(calls.some(c=>c[0]==='create'&&/oraclecloud/.test(c[1])),'Opera opened');assert(!('fxJob' in stores.local),'the list is never written to disk storage');assert(stores.session.fxJob&&stores.session.fxJob.code===code);
 // the fixer tab connects and asks: it gets the list
 onConnect(fix);await fix.fire({source:'ho-fx-ask'});assert.equal(fix.msgs.find(m=>m.source==='ho-fx-job').code,code);
 await fix.fire({source:'ho-fx-got'});assert(!stores.session.fxJob,'cleared once the fixer has it');
 // a bad list or a non-Oracle address is refused
 const before=calls.filter(c=>c[0]==='create').length;await app.fire({source:'ho-fx-job',code:'rm -rf',url:'https://evil.example/'});await app.fire({source:'ho-fx-job',code:'HOFIX1.abc.AAAA',url:'https://evil.example/'});assert.equal(calls.filter(c=>c[0]==='create').length,before,'nothing opened for a bad list or a foreign address');
 // fixer messages reach the app; only the fixer's three message kinds
 await fix.fire({source:'ho-fx-progress',note:'hi'});await fix.fire({source:'something-else'});assert(app.msgs.some(m=>m.source==='ho-fx-progress'));assert(!app.msgs.some(m=>m.source==='something-else'));
 // with the tab open, the job goes straight there and the tab is brought forward
 await app.fire({source:'ho-fx-job',code});assert(fix.msgs.filter(m=>m.source==='ho-fx-job').length>=2);assert.equal(fix.msgs[fix.msgs.length-1].code,code);assert(calls.some(c=>c[0]==='tab'&&c[1]===7&&c[2]===true));
 // ── the fixer script in a page with a fake chrome.runtime ──
 const executablePath=[process.env.CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&fs.existsSync(p)),browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']});
 try{const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<!doctype html><body><h2>Mr. Zed Fakeperson</h2><button id="save">Save</button><script>window.__saved=false;document.getElementById("save").onclick=()=>{window.__saved=true};window.__sent=[];window.__ls=[];window.chrome={runtime:{connect:()=>({postMessage:m=>window.__sent.push(m),onMessage:{addListener:f=>window.__ls.push(f)},onDisconnect:{addListener(){}}})}};</script>');
  await page.addScriptTag({content:F['fixer.js']});
  assert.equal(await page.evaluate(()=>document.querySelector('[data-hotelops=fixer]').style.display),'none','window hidden until a list arrives');
  assert(await page.evaluate(()=>window.__sent.some(m=>m.source==='ho-fx-ask')),'asks for a waiting list');
  await page.evaluate(c=>window.__ls.forEach(f=>f({source:'ho-fx-job',code:c})),code);
  assert.equal(await page.evaluate(()=>document.querySelector('[data-hotelops=fixer]').style.display),'');
  const sent=await page.evaluate(()=>window.__sent.map(m=>m.source));assert(sent.includes('ho-fx-got')&&sent.includes('ho-fx-progress'));
  assert.equal(await page.evaluate(()=>window.__hoFixer._test.st.dry),true,'dry run stays on');assert.equal(await page.evaluate(()=>window.__saved),false);
  await page.evaluate(c=>window.__ls.forEach(f=>f({source:'ho-fx-job',code:'HOFIX1.zz.AAAA'})),code);
  assert(await page.evaluate(()=>window.__sent.some(m=>m.source==='ho-fx-progress'&&m.bad)),'a broken list is reported, not loaded');
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
 console.log('Fixer in the helper passed: list kept in memory only, Opera opens or comes forward, fixer loads it hidden until then with dry run on, bad lists refused.');
})().catch(e=>{console.error(e);process.exit(1)});
