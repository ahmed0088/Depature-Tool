'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {CODE_WAIT_MS,codeFromHotelOps,freshTotp,totp}=require('../scripts/opera-cloud');
const KEY='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // Public RFC 6238 test key.
test('a current code entered after four minutes is accepted within a five-minute request',async()=>{
 let time=1000000;const start=time,store={},sent=[];
 const db={put:async(k,v)=>{store[k]=v;sent.push([k,v]);},get:async k=>k==='operaCloudCode'&&time-start>=290000?{tag:'run-a',at:time,code:'123456'}:store[k]||null,del:async k=>{delete store[k];}};
 assert.equal(await codeFromHotelOps(db,'','run-a',{now:()=>time,delay:async ms=>{time+=ms;}}),'123456');
 const want=sent.find(([k])=>k==='operaCloudWant')[1];assert.equal(CODE_WAIT_MS,300000);assert.equal(want.expiresAt-want.at,300000);
 assert(time-start>180000,'does not time out at the old three-minute boundary');assert.equal(store.operaCloudWant,undefined);
});
test('timeout is bounded and preserves a different run’s request',async()=>{
 let time=1000000;const start=time,store={};
 const db={put:async(k,v)=>{store[k]=v;},get:async k=>store[k]||null,del:async k=>{delete store[k];}};
 const result=await codeFromHotelOps(db,'','run-a',{now:()=>time,delay:async ms=>{time+=ms;if(time-start>=299000)store.operaCloudWant={tag:'run-b',at:time};}});
 assert.equal(result,'');assert.equal(time-start,300000);assert.equal(store.operaCloudWant.tag,'run-b');
});
test('automatic codes wait for a full new interval when only ten seconds remain',async()=>{
 let time=50000;const waits=[];
 const code=await freshTotp(KEY,'',{now:()=>time,delay:async ms=>{waits.push(ms);time+=ms;}});
 assert.deepEqual(waits,[10200]);assert.equal(code,totp(KEY,60200));assert.notEqual(code,totp(KEY,50000));
});
test('automatic codes never reuse the previously submitted code',async()=>{
 let time=61000;const previous=totp(KEY,time),waits=[];
 const code=await freshTotp(KEY,previous,{now:()=>time,delay:async ms=>{waits.push(ms);time+=ms;}});
 assert.deepEqual(waits,[29200]);assert.notEqual(code,previous);
});
test('a code with enough time remaining is available immediately',async()=>{
 let waited=false;assert.equal(await freshTotp(KEY,'',{now:()=>61000,delay:async()=>{waited=true;}}),totp(KEY,61000));assert.equal(waited,false);
});
