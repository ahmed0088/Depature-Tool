'use strict';
// Synthetic Microsoft pages only; no real sign-in, credentials, guests or profile saves.
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright-core'),{msSignIn}=require('../scripts/opera-signin');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:[process.env.CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&fs.existsSync(p)),args:['--no-sandbox']});
 try{
  const start='https://login.mock.test/code',done='https://fake.oraclecloud.com/opera';
  async function scenario(rejectFirst){
   const p=await browser.newPage();let calls=0;const events=[];
   await p.route('**/*',r=>r.fulfill({contentType:'text/html',body:r.request().url()===done?'<title>Opera</title><a id="pt1:menu">Menu</a>':`<title>Enter code</title><div id="idDiv_SAOTCC_Error" style="display:none"></div><input name="otc"><button id="idSubmit_SAOTCC_Continue">Verify</button><script>
    let attempt=0;document.querySelector('button').onclick=()=>{attempt++;const error=document.querySelector('#idDiv_SAOTCC_Error');error.style.display='none';if(${rejectFirst}&&attempt===1){setTimeout(()=>{error.textContent='That verification code expired';error.style.display='block';},80);}else setTimeout(()=>location.href='${done}',500);};
   </script>`}));
   await p.goto(start);
   await msSignIn(p,'fake@example.test','synthetic-password',async previous=>{calls++;if(calls>2)throw Error('Unnecessary code request');if(calls===2)assert.equal(previous,'111111');return calls===1?'111111':'222222';},{tickMs:15,maxSteps:120,progress:async(...args)=>events.push(args)});
   assert.equal(p.url(),done);assert.equal(calls,rejectFirst?2:1,'waits for Microsoft instead of asking for codes repeatedly');
   assert(!JSON.stringify(events).includes('111111'));assert(!JSON.stringify(events).includes('222222'));await p.close();
  }
  await scenario(false);await scenario(true);
  console.log('Authentication code verification passed: delayed acceptance asks once; rejected code asks for one new code; progress contains no codes.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
