'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const Core=require('../manual-sales-core.js');
const {InGaugePortal,ReviewRequired}=require('./ingauge-portal.js');
const E=process.env;
function privateError(error){let text=String(error?.message||'The run stopped.');for(const key of ['INGAUGE_PASS','HOTELOPS_PASS','INGAUGE_EMAIL','HOTELOPS_EMAIL'])if(E[key])text=text.split(E[key]).join('[redacted]');return text.slice(0,300);}
async function connectDb() {
  const text=fs.readFileSync(path.join(__dirname,'../firebase-config.js'),'utf8');
  const config=key=>(text.match(new RegExp(key+'\\s*:\\s*["\']([^"\']+)["\']'))||[])[1]||'';
  const response=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key='+encodeURIComponent(config('apiKey')),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:E.HOTELOPS_EMAIL,password:E.HOTELOPS_PASS,returnSecureToken:true})});
  const auth=await response.json();if(!response.ok||!auth.idToken)throw new Error('HotelOps cloud sign-in failed. Check HOTELOPS_EMAIL and HOTELOPS_PASS in GitHub secrets.');
  const hotelId=String(E.HOTELOPS_HOTEL||'');if(!/^[\w-]{1,80}$/.test(hotelId))throw new Error('A valid hotel ID is required.');
  const base=config('databaseURL').replace(/\/$/,'')+'/hotels/'+encodeURIComponent(hotelId)+'/';
  async function request(node,method,body,extra={}) {
    const r=await fetch(base+node+'.json?auth='+encodeURIComponent(auth.idToken),{method,headers:{'content-type':'application/json',...extra},body:body===undefined?undefined:JSON.stringify(body)});
    if(!r.ok)throw new Error('HotelOps database operation failed ('+r.status+').');return r.json();
  }
  const db={hotelId,uid:auth.localId,get:node=>request(node,'GET'),put:(node,value)=>request(node,'PUT',value),patch:(node,value)=>request(node,'PATCH',value)};
  const profile=await db.get('users/'+auth.localId);
  if(!profile?.active||!['owner','manager'].includes(profile.role))throw new Error('The configured HotelOps cloud account must be an active owner or manager for this hotel.');
  return db;
}
async function execute(plan,{portal,db,tag,test,publish,shouldStop}) {
  Core.validatePlan(plan);const results=[];
  const save=async row=>{results.push(row);await publish(results);};
  for(const sale of plan.sales) {
    if(await shouldStop())return {results,stopped:true};
    let attempted=false;
    const key=sale.transaction;
    try {
      const ledger=await db.get('manualSalesLedger/'+key);
      const existing=Core.existingFor(sale,await portal.search(sale));
      if(existing.length) {
        const exact=existing.length===1&&Core.recordMatches(sale,existing[0],['PENDING','APPROVED','REVIEWED']);
        await save({transaction:key,conf:sale.conf,state:exact?'already_exists':'needs_review',note:exact?'An existing request already represents this sale.':'An existing or denied request needs checking; nothing was added.',recordId:exact?String(existing[0].id):''});continue;
      }
      if(ledger&&['intent','unclear','submitted'].includes(ledger.state)) {
        await save({transaction:key,conf:sale.conf,state:'needs_review',note:'A prior submission may already exist. Check its outcome manually before retrying.'});continue;
      }
      await portal.fill(sale);
      if(await shouldStop())return {results,stopped:true};
      const refreshed=Core.existingFor(sale,await portal.search(sale));
      if(refreshed.length){await save({transaction:key,conf:sale.conf,state:'needs_review',note:'A request appeared during the final duplicate check. Nothing was added.'});await portal.closeForm();continue;}
      if(test){await save({transaction:key,conf:sale.conf,state:'tested',note:'Live search and form checked. No request was submitted.'});await portal.closeForm();continue;}
      await db.put('manualSalesLedger/'+key,{state:'intent',tag,at:Date.now(),conf:sale.conf,code:sale.code,day:sale.day});
      if(await shouldStop()){await db.patch('manualSalesLedger/'+key,{state:'cancelled_before_send'});return {results,stopped:true};}
      attempted=true;
      const created=await portal.submit(sale);
      await db.patch('manualSalesLedger/'+key,{state:'submitted',recordId:created.id,status:created.status,at:Date.now()});
      await save({transaction:key,conf:sale.conf,state:'submitted',recordId:created.id,note:'Verified one new PENDING request in IN-Gauge.'});
      await portal.closeForm();
    } catch(error) {
      const mayHaveSent=attempted&&portal.sent;
      if(attempted)await db.patch('manualSalesLedger/'+key,{state:mayHaveSent?'unclear':'blocked_before_send',at:Date.now()});
      await save({transaction:key,conf:sale.conf,state:mayHaveSent?'unclear':'needs_review',note:mayHaveSent?'The submission outcome is uncertain. Check IN-Gauge before retrying.':String(error.message||'The portal requires review.').slice(0,300)});
      if(mayHaveSent)return {results,stopped:true,unclear:true};
      await portal.closeForm().catch(()=>{});
    }
  }
  return {results,stopped:false};
}
async function main() {
  const tag=String(E.TAG||''),hash=String(E.PLAN_HASH||''),test=E.TEST!=='0';
  if(!/^ms[\w-]{5,70}$/.test(tag)||!/^\w{64}$/.test(hash))throw new Error('A reviewed plan tag and SHA-256 digest are required.');
  const db=await connectDb(),node='manualSalesJobs/'+tag;
  let job=await db.get(node);if(!job||job.state!=='queued')throw new Error('This plan is not queued. Review the selected sales and start a new run.');
  const plan=Core.validatePlan(JSON.parse(job.planJson)),actual=crypto.createHash('sha256').update(Core.canonical(plan)).digest('hex');
  const reviewer=await db.get('users/'+job.approvedBy);
  if(actual!==hash||job.hash!==hash||plan.hotelId!==db.hotelId||job.test!==test||!reviewer?.active||!['owner','manager'].includes(reviewer.role)||!job.reviewedAt||Date.now()-job.reviewedAt>3600000||job.reviewedAt>Date.now()+60000)throw new Error('The reviewed plan, hotel, author or review time did not pass validation.');
  if(!test){const checked=await db.get('manualSalesTests/'+hash);if(!checked?.ready||Date.now()-checked.at>3600000)throw new Error('Run a successful test for this exact selection before submitting.');}
  await db.patch(node,{state:'running',runId:String(E.GITHUB_RUN_ID||''),startedAt:Date.now()});
  const url=E.GITHUB_RUN_ID?'https://github.com/ahmed0088/Depature-Tool/actions/runs/'+E.GITHUB_RUN_ID:'';
  const publish=async(results,state='run',note='Checking reviewed sales')=>{
    const tally={submitted:0,already_exists:0,tested:0,needs_review:0,unclear:0};results.forEach(r=>{if(r.state in tally)tally[r.state]++;});
    await db.patch(node,{results,tally,state:state==='run'?'running':state,at:Date.now()});
    await db.patch('manualSalesLive',{tag,state,test,n:plan.sales.length,done:results.length,tally,note,at:Date.now(),started:job.reviewedAt,run:url});
    await db.patch('cloudRuns/'+tag,{kind:'manual',tag,state,test,n:plan.sales.length,done:results.length,tally,note,at:Date.now(),url});
  };
  let browser;
  try {
    await publish([],'run','Connecting to IN-Gauge');
    if(!E.INGAUGE_EMAIL||!E.INGAUGE_PASS)throw new ReviewRequired('Set INGAUGE_EMAIL and INGAUGE_PASS in GitHub Actions secrets, then test the selected sales. Never paste passwords into chat.');
    const {chromium}=require('playwright-core');
    browser=await chromium.launch({headless:true,executablePath:E.CHROME_PATH||undefined,args:['--disable-dev-shm-usage']});
    const page=await browser.newPage();page.setDefaultTimeout(20000);
    const portal=new InGaugePortal(page);await portal.installGuard();await portal.login(E.INGAUGE_EMAIL,E.INGAUGE_PASS);await portal.open(plan.property);
    const shouldStop=async()=>!!(await db.get(node))?.stopRequested;
    const outcome=await execute(plan,{portal,db,tag,test,publish,shouldStop});
    const ready=test&&!outcome.stopped&&outcome.results.every(r=>['tested','already_exists'].includes(r.state));
    if(test)await db.put('manualSalesTests/'+hash,{ready,at:Date.now(),tag});
    const note=outcome.unclear?'Stopped: check an uncertain submission before retrying.':outcome.stopped?'Stopped before the next submission.':test?(ready?'Test passed. No sales submitted. Review the selection, then submit.':'Test finished with cases needing review. No sales submitted.'):'Finished. Submitted requests remain PENDING in IN-Gauge.';
    await publish(outcome.results,outcome.unclear?'error':outcome.stopped?'stopped':'done',note);
    console.log('Manual sales run finished. Detailed results are in HotelOps.');
  } catch(error) {
    const current=await db.get(node).catch(()=>({}));await publish(current?.results||[],'error',privateError(error));
    console.error('::error::Manual sales run stopped. Open its private HotelOps report for setup or review details.');process.exitCode=1;
  } finally {if(browser)await browser.close().catch(()=>{});}
}
if(require.main===module)main().catch(()=>{console.error('::error::Manual sales could not load its reviewed plan or HotelOps connection. Check the cloud setup.');process.exitCode=1;});
module.exports={execute,connectDb,privateError};
