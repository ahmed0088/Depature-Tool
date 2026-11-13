'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('scripts/accor-loop-content.js','utf8'),start=source.indexOf('  function createEnrollmentReceipts('),end=source.indexOf('  const DEFAULT_TITLE',start),factorySource=source.slice(start,end);
const create=new Function(factorySource+';return createEnrollmentReceipts;')();
const guest={conf:'12345',email:'example@example.test',first_name:'Example',last_name:'Guest'};
function fixture(run='run-1'){
 const durable={},session={};const storage={run,session:{getItem:k=>session[k]||null,setItem:(k,v)=>session[k]=v},get:async k=>durable[k]||null,set:async(k,v)=>{durable[k]=v;}};
 return{durable,session,storage,ledger:create(storage),resume:patch=>create({...storage,...patch})};
}
test('accepted response survives a lost worker and a lost asynchronous extension write',async()=>{
 const f=fixture();await f.ledger.begin(guest,0);f.storage.set=async()=>{throw Error('page destroyed')};f.ledger.capture({status:200,body:'{"Message":"success","token":"MUST_NOT_STORE"}'},f.ledger.current());
 const r=await f.resume().recover(guest,0);assert.equal(r.status,'success');assert.equal(r.recovered,true);assert(!JSON.stringify(f.session).includes('MUST_NOT_STORE'));
});
test('an in-flight submission without a readable response is held, never treated as a safe retry',async()=>{
 const f=fixture();await f.ledger.begin(guest,0);assert.equal((await f.resume().recover(guest,0)).status,'submission_uncertain');
});
test('receipts are tied to the exact run, index, confirmation and email',async()=>{
 const f=fixture();await f.ledger.begin(guest,0);f.ledger.capture({status:200,body:'{}'},f.ledger.current());
 for(const [rec,index,patch] of [[guest,1,{}],[{...guest,conf:'999'},0,{}],[{...guest,email:'another@example.test'},0,{}],[guest,0,{run:'run-2'}]])assert.equal(await f.resume(patch).recover(rec,index),null);
});
test('actual rejection messages are preserved even when an API uses HTTP 200',async()=>{
 for(const [response,status] of [[{status:400,body:'{"Message":"email undeliverable"}'},'bad_email'],[{status:200,body:'{"message":"email undeliverable"}'},'bad_email'],[{status:400,body:'{"Message":"You already have an account"}'},'already_member'],[{status:200,body:'{"success":false}'},'bad_data'],[{status:500,body:'{}'},'submission_uncertain']]){
  const f=fixture();await f.ledger.begin(guest,0);f.ledger.capture(response,f.ledger.current());assert.equal((await f.resume().recover(guest,0)).status,status);
 }
});
test('late responses cannot be assigned to another guest',async()=>{
 const f=fixture();await f.ledger.begin(guest,0);const old=f.ledger.current();await f.ledger.begin({...guest,conf:'6789'},1);f.ledger.capture({status:200,body:'{}'},old);assert.equal((await f.resume().recover({...guest,conf:'6789'},1)).status,'submission_uncertain');
});
test('a response from an earlier attempt cannot overwrite a later attempt for the same guest',async()=>{
 const f=fixture();await f.ledger.begin(guest,0);const old=f.ledger.current();await f.ledger.begin(guest,0);f.ledger.capture({status:200,body:'{}'},old);assert.equal((await f.resume().recover(guest,0)).status,'submission_uncertain');
});
test('clearing a receipt happens only after the caller persists the result',async()=>{
 const f=fixture();await f.ledger.begin(guest,0);await f.ledger.clear();assert.equal(await f.resume().recover(guest,0),null);
 const process=source.slice(source.indexOf('  async function processOne('),source.indexOf('  for (let i = startIndex;'));
 assert(process.indexOf('await persist(idx + 1);\n      await receipts.clear();')>0);
 assert(process.indexOf('await receipts.begin(rec, idx);')<process.indexOf('submit.click();'));
});
test('unknown submissions count as errors and are excluded from automatic guest selection',()=>{
 const A=require('../scripts/accor-loop-cloud'),r=A.resultReport([{...guest,status:'submission_uncertain'}],1);assert.equal(r.errors,1);assert.equal(r.submitted,0);assert.equal(r.guests[0].cat,'error');
 const pipeline=fs.readFileSync('guest-pipeline.js','utf8'),a=pipeline.indexOf('const GP_DONE_RE'),b=pipeline.indexOf('/**',a);const done=new Function(pipeline.slice(a,b)+';return GP_DONE_RE;')();assert(done.test('submission_uncertain'));assert(!done.test('bad_email'));
 const fn=pipeline.slice(pipeline.indexOf('function gpTryWords('),pipeline.indexOf('function gpCanEnroll('));const words=new Function(fn+';return gpTryWords;')();assert.match(words('submission_uncertain'),/verify it in Accor/i);assert.match(words('bad_email'),/working extension/);
});
