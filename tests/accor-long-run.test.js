'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),A=require('../scripts/accor-loop-cloud');
test('large batches have a bounded wall-clock budget with enough time for 726 guests',()=>{
 assert.equal(A.enrollmentBudget(15),30*60e3);assert(A.enrollmentBudget(726)>2*3600e3);assert(A.enrollmentBudget(10000)<=210*60e3);
});
test('HotelOps session renews before expiry and shares one refresh between concurrent requests',async()=>{
 let time=0,calls=0;const session=A.tokenSession({idToken:'initial',refreshToken:'refresh-1',expiresIn:3600},{now:()=>time,refresh:async token=>{calls++;assert.equal(token,'refresh-1');return {access_token:'renewed',refresh_token:'refresh-2',expires_in:3600};}});
 assert.equal(await session.get(),'initial');assert.equal(calls,0);time=3500e3;assert.deepEqual(await Promise.all([session.get(),session.get(),session.get()]),['renewed','renewed','renewed']);assert.equal(calls,1);assert.equal(await session.get(),'renewed');
});
test('expired/revoked authentication fails clearly and does not reuse a rejected refresh',async()=>{
 let calls=0;const session=A.tokenSession({idToken:'initial',refreshToken:'refresh',expiresIn:3600},{now:()=>0,refresh:async()=>{calls++;throw Error('refresh refused');}});
 await assert.rejects(session.get(true),/refresh refused/);await assert.rejects(session.get(true),/refresh refused/);assert.equal(calls,2);
 const absent=A.tokenSession({idToken:'initial',expiresIn:1},{now:()=>0,refresh:async()=>{throw Error('must not be called')}});await assert.rejects(absent.get(),/cannot be refreshed/);
});
test('checkpoints save each completed result once and permit a failed write to retry',async()=>{
 const patches=[];let fail=true;const save=A.enrollmentCheckpoint({test:false,now:()=>Date.parse('2026-11-13T23:55:00Z'),patch:async(path,value)=>{if(fail){fail=false;throw Error('network');}patches.push({path,value});}});
 const first={email:'one@example.test',name:'Example One',conf:'1',status:'success'},second={email:'two@example.test',name:'Example Two',conf:'2',status:'bad_email'};
 await assert.rejects(save([first]),/network/);assert.equal(await save([first]),1);assert.equal(await save([first]),0);assert.equal(await save([first,second]),1);assert.equal(patches.length,2);assert.equal(patches[0].path,'enrollLog');assert.equal(Object.values(patches[0].value)[0].date,'2026-11-14');assert.equal(Object.values(patches[1].value)[0].status,'bad_email');
});
test('diagnostics never write enrolment results',async()=>{let calls=0;const save=A.enrollmentCheckpoint({test:true,patch:async()=>calls++});assert.equal(await save([{email:'one@example.test',status:'success'}]),0);assert.equal(calls,0);});
test('Firebase reads and checkpoints use renewed authentication after a 401 and across expiry',async()=>{
 const keys=['FB_AUTH_URL','FB_TOKEN_URL','FB_DB_URL','HOTELOPS_HOTEL','HOTELOPS_EMAIL','HOTELOPS_PASS'],prior=Object.fromEntries(keys.map(k=>[k,process.env[k]])),oldFetch=global.fetch,oldNow=Date.now;let time=0,refreshes=0,rejectFirst=true;const requests=[];
 Object.assign(process.env,{FB_AUTH_URL:'https://firebase.test/auth',FB_TOKEN_URL:'https://firebase.test/token',FB_DB_URL:'https://firebase.test/db',HOTELOPS_HOTEL:'example',HOTELOPS_EMAIL:'synthetic@example.test',HOTELOPS_PASS:'synthetic'});Date.now=()=>time;
 global.fetch=async(url,options)=>{
  const u=new URL(url);assert.equal(u.hostname,'firebase.test');requests.push({path:u.pathname,token:u.searchParams.get('auth'),method:options?.method});
  if(u.pathname==='/auth')return {ok:true,json:async()=>({idToken:'token-1',refreshToken:'refresh-1',expiresIn:3600})};
  if(u.pathname==='/token'){refreshes++;assert.equal(new URLSearchParams(options.body).get('grant_type'),'refresh_token');return {ok:true,json:async()=>({access_token:'token-'+(refreshes+1),refresh_token:'refresh-next',expires_in:3600})};}
  if(rejectFirst){rejectFirst=false;return {ok:false,status:401,text:async()=>''};}
  assert.equal(u.searchParams.get('auth'),'token-'+(refreshes+1));return {ok:true,status:200,text:async()=>'{"saved":true}'};
 };
 try{const db=await A.hotelDb();assert.deepEqual(await db.get('enrollLive'),{saved:true});assert.equal(refreshes,1);time=3500e3;await db.patch('enrollLog',{synthetic:{status:'success'}});assert.equal(refreshes,2);assert.equal(requests.filter(r=>r.path.endsWith('/enrollLive.json')).length,2);assert.equal(requests.at(-1).method,'PATCH');}
 finally{global.fetch=oldFetch;Date.now=oldNow;keys.forEach(k=>prior[k]===undefined?delete process.env[k]:process.env[k]=prior[k]);}
});
