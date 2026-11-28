'use strict';
// Synthetic reports and mocked GitHub/Firebase only: never opens Opera or changes guest data.
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright-core');
const read=p=>fs.readFileSync(__dirname+'/../'+p,'utf8');
(async()=>{
 const browser=await chromium.launch({executablePath:[process.env.CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&fs.existsSync(p)),headless:true,args:['--no-sandbox']});
 try{
  async function setup(kind='normal'){
   const p=await browser.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
   await p.route('https://hotelops.mock.test/**',r=>r.fulfill({contentType:'text/html',body:'<div id="panel-immig"><div id="immigStep4Slot"></div><div id="immigResults2"></div></div>'}));
   await p.goto('https://hotelops.mock.test/');
   await p.evaluate(kind=>{
    window.kind=kind;window.HOTEL_ID='h1';window.immigAllRows2=[{room:'102',name:'Ann Synthetic',noNat:true}];window._immigInhouseList=[{room:'102',name:'Ann Synthetic',nat:'Oman'}];window._immigMeta={hotel:'Synthetic Hotel',biz:'2026-11-26'};
    window.writes=[];window.requests=[];window.toasts=[];window.showToast=m=>toasts.push(m);
    window.listeners={};window.store={};window.emit=(path,v)=>{store[path]=v;(listeners[path]||[]).forEach(f=>f({val:()=>v}));};
    window.firebase={database:()=>({ref:path=>({
     once:async()=>({val:()=>store[path]||null}),
     set:async v=>{writes.push({path,v});emit(path,v);},
     update:async v=>{writes.push({path,v});emit(path,{...store[path],...v});},
     remove:async()=>emit(path,null),
     on:(event,fn)=>{(listeners[path]||=[]).push(fn);fn({val:()=>store[path]||null});},
     off:()=>{listeners[path]=[];},limitToLast(){return this;}
    })})};
    localStorage.setItem('ho_gh_start_key_v1','synthetic-key');
    const url='https://fake-hotel.oraclecloud.com/FAKE/operacloud/faces/opera-cloud-index/OperaCloud';
    localStorage.setItem('hoOperaUrl_h1',url);store['hotels/h1/operaUrl']=url;
    window.fetch=async(url,opts={})=>{
     requests.push({url,method:opts.method||'GET',body:opts.body?JSON.parse(opts.body):null});
     await new Promise(r=>setTimeout(r,30));
     if(kind==='bad-key')return {ok:false,status:401};
     if(opts.method==='POST')return {ok:true,status:204};
     return {ok:true,status:200,json:async()=>({workflow_runs:kind==='active'?[{id:42,display_title:'Opera fixer · save · imexisting',status:'in_progress',created_at:new Date().toISOString()}]:[]})};
    };
   },kind);
   for(const f of ['opera-auto-core.js','immig-fixer-core.js','immig-fixer.js'])await p.addScriptTag({content:read(f)});
   await p.evaluate(()=>immigFixerRender());
   await p.waitForFunction(()=>hoImmigFixerState.opera.includes('oraclecloud'));
   return {p,errors};
  }
  {
   const {p,errors}=await setup();
   await p.evaluate(()=>{document.getElementById('immigCloudOne').onclick();document.getElementById('immigCloudOne').onclick();});
   await p.waitForFunction(()=>requests.some(r=>r.method==='POST'));
   const data=await p.evaluate(()=>({requests,writes}));
   assert.equal(data.requests.filter(r=>r.method==='POST').length,1,'double start dispatches once');
   const planWrites=data.writes.filter(w=>w.path.endsWith('/operaCloudPlan')&&w.v.code);assert.equal(planWrites.length,1,'double start writes one reviewed plan');
   const input=data.requests.find(r=>r.method==='POST').body.inputs;assert.equal(input.hotel,'h1');assert.equal(input.mode,'save');assert.equal(input.limit,'5');assert.equal(input.tag,planWrites[0].v.tag);assert(input.tag.startsWith('im'));
   const plan=require('../immig-fixer-core').decodePlan(planWrites[0].v.code);assert.equal(plan.origin,'https://fake-hotel.oraclecloud.com');assert.deepEqual(plan.items[0].fields,[{field:'nationality',value:'OM'}]);
   await p.waitForFunction(()=>document.getElementById('immigCloudOne').disabled);
   await p.evaluate(tag=>{
    emit('hotels/h1/operaCloudWant',{at:Date.now(),tag:'imother',state:'waiting'});
    document.getElementById('immigCloudCode').value='123456';document.getElementById('immigCloudSend').onclick();
    emit('hotels/h1/operaCloudResult',{state:'done',mode:'save',tag:'imother',lines:[]});
   },input.tag);
   assert.equal(await p.locator('#immigCloudOne').isDisabled(),true,'other run cannot finish this run');
   assert.equal(await p.evaluate(()=>writes.filter(w=>w.path.endsWith('/operaCloudCode')).length),0,'other challenge cannot receive a code');
   await p.evaluate(tag=>{
    emit('hotels/h1/operaCloudWant',{at:Date.now(),tag,state:'waiting'});
    document.getElementById('immigCloudCode').value='123456';document.getElementById('immigCloudSend').onclick();
    emit('hotels/h1/operaCloudResult',{state:'running',mode:'save',tag,note:'Entering the Opera account password securely',lines:[]});
   },input.tag);
   assert.match(await p.locator('#immigCloudStartMsg').innerText(),/Entering the Opera account password/);
   assert.equal(await p.evaluate(()=>writes.find(w=>w.path.endsWith('/operaCloudCode')).v.tag),input.tag);
   await p.evaluate(tag=>emit('hotels/h1/operaCloudResult',{state:'failed',mode:'save',tag,error:'Microsoft requires a supported sign-in method',lines:[]}),input.tag);
   assert.match(await p.locator('#immigCloudRes').innerText(),/Opera sign-in needs attention/);assert.equal(await p.locator('#immigCloudOne').isDisabled(),false);
   await p.evaluate(async()=>{HOTEL_ID='h2';await immigFixerRender();});
   assert.equal(await p.evaluate(()=>listeners['hotels/h1/operaCloudWant'].length),0,'old hotel listener removed');
   assert.equal(await p.evaluate(()=>hoImmigFixerState.opera),'','other hotel must supply its own Opera URL');
   assert.deepEqual(errors,[]);await p.close();
  }
  {
   const {p,errors}=await setup('active');await p.locator('#immigCloudOne').click();
   await p.waitForFunction(()=>document.getElementById('immigCloudStartMsg').textContent.includes('already active'));
   assert.equal(await p.evaluate(()=>writes.length),0,'existing run never overwrites plan');assert.equal(await p.evaluate(()=>requests.some(r=>r.method==='POST')),false);
   assert.deepEqual(errors,[]);await p.close();
  }
  {
   const {p,errors}=await setup('bad-key');await p.locator('#immigCloudOne').click();
   await p.waitForFunction(()=>document.getElementById('immigCloudStartMsg').textContent.includes('expired'));
   assert.equal(await p.locator('#immigCloudKeyRow').isVisible(),true,'key can be replaced after unauthorized response');
   assert.equal(await p.locator('#immigCloudOne').isDisabled(),false);assert.equal(await p.evaluate(()=>writes.length),0);
   assert.deepEqual(errors,[]);await p.close();
  }
  console.log('Immigration cloud startup passed: one launch, correct workspace and plan, active-run guard, private progress/errors, matching codes, hotel switch and key recovery.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
