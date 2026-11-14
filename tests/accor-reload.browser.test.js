'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright-core');
const source=fs.readFileSync('scripts/accor-loop-content.js','utf8'),factory=source.slice(source.indexOf('  function createEnrollmentReceipts('),source.indexOf('  const DEFAULT_TITLE')),
 interceptors=source.slice(source.indexOf('  (function installInterceptors()'),source.indexOf('  async function goHome()')),
 processOne=source.slice(source.indexOf('  async function processOne('),source.indexOf('  for (let i = startIndex;'));
(async()=>{
 const browser=await chromium.launch({executablePath:[process.env.CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&fs.existsSync(p)),headless:true,args:['--no-sandbox']});
 try{
  for(const testCase of [{name:'accepted response',status:200,body:{Message:'success',token:'MUST_NOT_STORE'},expected:'success'},{name:'explicit email rejection',status:400,body:{Message:'email undeliverable'},expected:'bad_email'},{name:'already member',status:400,body:{Message:'You already have an account'},expected:'already_member'},{name:'navigation before response',status:200,body:{Message:'success'},expected:'submission_uncertain',early:true}]){
   const context=await browser.newContext(),page=await context.newPage();let submissions=0;
   await page.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin!=='https://enroll.test')return route.abort();if(u.pathname==='/accor/enroll'){submissions++;if(testCase.early)await new Promise(r=>setTimeout(r,300));return route.fulfill({status:testCase.status,contentType:'application/json',body:JSON.stringify(testCase.body)}).catch(()=>{});}return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Synthetic Accor portal</title><p>Reload fixture</p>'});});
   await page.goto('https://enroll.test/');
   const setup=factory+`\nconst log=()=>{},CURRENT_KEY='current',results=[],cset=async()=>{},guest={conf:'12345',email:'example@example.test',first_name:'Example',last_name:'Guest'};\nconst receipts=createEnrollmentReceipts({run:'same-run',session:sessionStorage,get:async key=>JSON.parse(localStorage.getItem(key)||'null'),set:async(key,value)=>{if(value&&value.outcome)return;localStorage.setItem(key,JSON.stringify(value));}});\nconst persist=async nextIndex=>localStorage.setItem('loop',JSON.stringify({nextIndex,results}));`;
   await page.addScriptTag({content:setup+interceptors+`\nwindow.submitFixture=async()=>{await receipts.begin(guest,0);const request=new XMLHttpRequest();request.open('POST','/accor/enroll');request.addEventListener('load',()=>{location.href='/after'});request.send('{}');};`});
   await page.evaluate(()=>submitFixture());if(testCase.early)await page.goto('https://enroll.test/after');else await page.waitForURL('https://enroll.test/after');
   await page.addScriptTag({content:setup+processOne+`\nwindow.resumeFixture=()=>processOne(guest,0,1);`});
   const result=await page.evaluate(()=>resumeFixture());assert.equal(result.status,testCase.expected,testCase.name);assert.equal(result.recovered,true);assert.equal(submissions,1,'the same guest must not be sent again after '+testCase.name);
   const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('loop')));assert.equal(stored.nextIndex,1);assert.equal(stored.results.length,1);assert.equal(stored.results[0].status,testCase.expected);
   assert(!(await page.evaluate(()=>JSON.stringify(sessionStorage))).includes('MUST_NOT_STORE'),'response secrets are not persisted');await context.close();
  }
  console.log('Accor reload checks passed: accepted/rejected responses survive immediate navigation, unknown outcomes stay held, one request and one result per guest. Synthetic portal only; no live enrolments.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
