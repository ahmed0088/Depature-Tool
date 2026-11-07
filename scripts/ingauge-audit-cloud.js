'use strict';
const crypto=require('node:crypto');
const C=require('../ingauge-audit-core.js');
const {connectDb,privateError}=require('./manual-sales-cloud.js');
const {InGaugeAccount}=require('./ingauge-account.js');
const {ReferenceCache}=require('./ingauge-reference-cache.js');
const portalError=error=>error?.name==='TimeoutError'?'The portal did not finish the requested screen or sign-in. No further operation was sent.':privateError(error);
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const targetKey=(b,hid)=>b?'ig-'+sha(C.stable(C.binding(b))).slice(0,32):'discover-'+hid;
async function execute(plan,snapshot,{portal,db,test,publish,stop}){
  C.validatePlan(plan,snapshot);const results=[];const save=async(op,result)=>{const before=snapshot.records.find(r=>r.id===op.recordId),product=snapshot.products.find(p=>p.id===op.productId),person=snapshot.contributors.find(p=>p.id===op.contributorId);results.push({...result,action:op.action,at:Date.now(),hotel:snapshot.binding.property,currency:snapshot.settings.currency,before:before?{...C.values(before),status:before.status,product:before.product,seller:before.seller}:null,requested:{...op.values,status:op.statusAfter||({approve:'APPROVED',deny:'DENIED',delete:'PURGED'})[op.action],product:product?.name||'',seller:person?.name||''},reason:op.reason||op.evidence||''});await publish(results);};
  for(const op of plan.operations){
    if(await stop())return {results,stopped:true};
    const ledgerKey=sha(C.stable(C.binding(plan.binding))+'|'+(op.action==='add'?'transaction:'+op.transaction:'record:'+op.recordId+'|'+op.expected+'|'+op.action));
    let attempted=false;
    try{
      const old=await db.get('ingauge/ledger/'+ledgerKey);
      if(!test&&old&&['intent','uncertain','applied'].includes(old.state))throw Error('A prior operation may already have been sent. Refresh IN-Gauge and verify its outcome before retrying.');
      const checked=await portal.testOperation(op,snapshot);
      if(op.action==='edit'&&C.matches(op,checked.current)){await save(op,{key:op.key,confirmation:op.confirmation,state:'unchanged',note:'The selected record already has the reviewed values.',recordId:op.recordId});continue;}
      if(test){if(await stop())return {results,stopped:true};await save(op,{key:op.key,confirmation:op.confirmation,state:'tested',note:'Hotel, permissions, product, contributor, record version, duplicates and period lock checked. No financial change sent.'});continue;}
      if(await stop())return {results,stopped:true};
      await db.put('ingauge/ledger/'+ledgerKey,{state:'intent',at:Date.now(),job:plan.jobTag||'',action:op.action,recordId:op.recordId||'',confirmation:op.confirmation});
      if(await stop()){await db.patch('ingauge/ledger/'+ledgerKey,{state:'cancelled_before_send'});return {results,stopped:true};}
      attempted=true;const outcome=await portal.apply(op,snapshot);
      await db.patch('ingauge/ledger/'+ledgerKey,{state:'applied',at:Date.now(),recordId:outcome.recordId});
      await save(op,{key:op.key,confirmation:op.confirmation,state:'applied',recordId:outcome.recordId,after:outcome.after,note:outcome.systemNote||'The final IN-Gauge record was reread and matches the reviewed change.'});
    }catch(error){
      if(error.cancelled&&(!attempted||!portal.sent)){if(attempted)await db.patch('ingauge/ledger/'+ledgerKey,{state:'cancelled_before_send',at:Date.now()});return {results,stopped:true};}
      const uncertain=!!error.uncertain||(attempted&&portal.sent);
      if(attempted)await db.patch('ingauge/ledger/'+ledgerKey,{state:uncertain?'uncertain':'blocked_before_send',at:Date.now()});
      await save(op,{key:op.key,confirmation:op.confirmation,state:uncertain?'uncertain':'held',recordId:error.recordId||op.recordId||'',after:error.observed||null,differences:error.differences||[],note:portalError(error)});
      if(uncertain)return {results,stopped:true,uncertain:true};
    }
  }return {results,stopped:false};
}
function completionNote(outcome,test,total){
  const rows=outcome.results,counts={};for(const r of rows)counts[r.state]=(counts[r.state]||0)+1;
  const changes=Object.entries({add:'added',edit:'edited / fixed',approve:'approved',deny:'denied',delete:'removed'}).map(([action,label])=>{const n=rows.filter(r=>r.state==='applied'&&r.action===action).length;return n?n+' '+label:'';}).filter(Boolean);
  const parts=[...changes,...(counts.tested?[counts.tested+' readiness checks passed']:[]),...(counts.unchanged?[counts.unchanged+' already correct']:[]),...(counts.held?[counts.held+' held; not sent']:[]),...(counts.uncertain?[counts.uncertain+' need verification']:[]),...(total>rows.length?[total-rows.length+' not attempted']:[])];
  return (outcome.stopped?'Stopped: ':'Finished: ')+(parts.join(' · ')||'no changes')+'. '+(outcome.uncertain?'Check the returned values before retrying.':test?'No financial changes sent.':'Successful changes were reread and verified in IN-Gauge.');
}
async function main(){
  const E=process.env,tag=String(E.TAG||''),hash=String(E.PLAN_HASH||''),test=E.TEST!=='0';
  if(!/^ig[a-z0-9-]{6,70}$/.test(tag)||!/^([a-f0-9]{64})$/.test(hash))throw Error('A valid private job and plan digest are required.');
  const db=await connectDb(),node='ingauge/jobs/'+tag,job=await db.get(node);
  if(!job||job.state!=='queued')throw Error('This job is no longer queued.');
  const plan=JSON.parse(job.planJson||'null'),reviewer=await db.get('users/'+job.approvedBy);
  if(!plan||plan.schema!==2||plan.hotelId!==db.hotelId||sha(C.stable(plan))!==hash||job.hash!==hash||!reviewer?.active||!['owner','manager'].includes(reviewer.role)||(!job.stopRequested&&(Date.now()-job.reviewedAt>3600000||job.reviewedAt>Date.now()+60000))||job.test!==test)throw Error('The reviewed author, hotel, plan or time did not pass verification.');
  if(!['discover','snapshot','apply'].includes(plan.mode))throw Error('Unknown job mode.');
  if(E.TARGET_KEY!==targetKey(plan.binding,db.hotelId))throw Error('This workflow does not hold the correct property queue.');
  let snapshot=null;
  const invalidateSnapshot=async results=>{if(snapshot&&!test&&results.some(r=>['applied','uncertain'].includes(r.state)))await db.patch('ingauge/snapshots/'+snapshot.id,{invalidatedAt:Date.now(),invalidatedBy:tag});};
  const run=E.GITHUB_RUN_ID?'https://github.com/ahmed0088/Depature-Tool/actions/runs/'+E.GITHUB_RUN_ID:'';
  const publish=async(results,state='running',note='Checking IN-Gauge',extra={})=>{
    publishedResults=results;
    const tally={tested:0,applied:0,unchanged:0,held:0,uncertain:0};for(const r of results)if(r.state in tally)tally[r.state]++;
    await db.patch(node,{state,results,tally,note,run,at:Date.now(),...extra});
    const live={tag,scope:plan.scope||'all',state:state==='running'?'run':state,test,n:plan.operations?.length||0,done:results.length,note,tally,at:Date.now(),started:job.reviewedAt,run};
    await db.put('ingauge/live',live);await db.patch('cloudRuns/'+tag,{...live,kind:'ingauge',url:run,hotel:plan.binding?.property||'',from:plan.from||'',to:plan.to||''});
  };
  let browser,heartbeat,publishedResults=[];const trace=[];
  const progress=async(stage,note)=>{
    if(trace.at(-1)?.note!==note){trace.push({at:Date.now(),stage,note});if(trace.length>60)trace.shift();console.log('[IN-Gauge] '+note);}
    await publish(publishedResults,'running',note,{stage,trace});
  };
  try{
    if(job.stopRequested){await publish([],'stopped','Cancelled before starting. No financial changes sent.');return;}
  const stored=await db.get('ingauge/binding');
  if(plan.mode!=='discover'&&!C.sameBinding(plan.binding,stored))throw Error('The saved hotel binding changed. Review the correct property again.');
  if(plan.mode==='apply'){
    if(!/^ig[a-z0-9-]{6,70}$/.test(plan.snapshotId||''))throw Error('Invalid snapshot identifier.');
    snapshot=await db.get('ingauge/snapshots/'+plan.snapshotId);
    if(snapshot)for(const field of ['records','products','contributors'])snapshot[field]=Array.isArray(snapshot[field])?snapshot[field]:Object.values(snapshot[field]||{});
    C.validatePlan(plan,snapshot);
    if(Date.now()-snapshot.fetchedAt>21600000)throw Error('Fetch a new IN-Gauge snapshot before applying changes.');
    // The reviewed digest, author, scope and age are verified above. execute() performs
    // the live preflight itself before sending each selected financial operation.
  }
    await db.put('ingauge/latestJob',tag);
    heartbeat=setInterval(()=>{db.patch(node,{heartbeatAt:Date.now()}).catch(()=>{});},15000);
    await progress('starting','Cloud computer ready; starting IN-Gauge');
    const {chromium}=require('playwright-core');browser=await chromium.launch({headless:true,executablePath:E.CHROME_PATH||undefined,args:['--disable-dev-shm-usage']});
    const page=await browser.newPage();page.setDefaultTimeout(20000);
    const portal=new InGaugeAccount(page,plan.binding?.portalUrl||plan.portalUrl,{progress,referenceCache:new ReferenceCache({store:db}),stop:async()=>!!(await db.get(node))?.stopRequested});await portal.installGuard();await portal.login(E.INGAUGE_EMAIL,E.INGAUGE_PASS);
    if(plan.mode==='discover'){
      const result=await portal.discover();await portal.checkCancelled(true);await db.put('ingauge/discovery',result);await db.patch(node,{result});const note='Found '+result.hotels.length+' hotels. Next: choose your hotel and Front Desk, then save the hotel link. No financial changes.';console.log('[IN-Gauge] '+note);await publish([],'done',note);return;
    }
    if(plan.mode==='snapshot'){
      if(!C.day(plan.from)||!C.day(plan.to)||plan.from>plan.to||new Date(plan.to)-new Date(plan.from)>366*86400000)throw Error('Choose an audit period of at most one year.');
      const result=await portal.snapshot(plan.binding,plan.from,plan.to,db.hotelId,tag,{refreshReferences:plan.refreshReferenceData===true});
      await portal.checkCancelled(true);await db.put('ingauge/snapshots/'+tag,result);await db.patch(node,{snapshotId:tag});
      console.log('[IN-Gauge] Record fetch complete: '+result.records.length+' records');
      await publish([],'done',result.records.length+' live records retrieved with all statuses and complete pagination.');return;
    }
    const outcome=await execute(plan,snapshot,{portal,db,test,publish,stop:async()=>!!(await db.get(node))?.stopRequested});
    await invalidateSnapshot(outcome.results);
    const ready=test&&!outcome.stopped&&outcome.results.every(r=>['tested','unchanged'].includes(r.state));
    if(test)await db.put('ingauge/tests/'+hash,{ready,at:Date.now(),tag});
    await publish(outcome.results,outcome.uncertain?'error':outcome.stopped?'stopped':'done',completionNote(outcome,test,plan.operations.length));
  }catch(error){const current=await db.get(node).catch(()=>null);await invalidateSnapshot(current?.results||publishedResults).catch(()=>{});await publish(current?.results||publishedResults,error.cancelled?'stopped':'error',error.cancelled?'Cancelled. Completed changes are saved in history; no further operation was started.':portalError(error));if(!error.cancelled){console.error('::error::IN-Gauge stopped. Open the private HotelOps run report for details.');process.exitCode=1;}}
  finally{if(heartbeat)clearInterval(heartbeat);if(browser)await browser.close().catch(()=>{});}
}
if(require.main===module)main().catch(()=>{console.error('::error::IN-Gauge could not validate the queued job or cloud account.');process.exitCode=1;});
module.exports={execute,targetKey,completionNote};
