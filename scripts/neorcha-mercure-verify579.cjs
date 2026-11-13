'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright-core');
(async()=>{
 const report={readOnly:true,portal:'mercure.myneorcha.com',checks:[],blockedWrites:0};let browser;
 try{
  assert(process.env.NEORCHA_USER&&process.env.NEORCHA_PASS,'Mercure account secrets are required');
  browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
  const context=await browser.newContext({serviceWorkers:'block',locale:'en-GB',timezoneId:'Asia/Dubai'});
  await context.route('**/*',route=>{const request=route.request(),u=new URL(request.url()),method=request.method();if(['GET','HEAD','OPTIONS'].includes(method)||method==='POST'&&u.origin==='https://mercure.myneorcha.com'&&(u.pathname==='/tweak/api/auth/login'||/^\/tweak\/api\/screens\/\d+\/datasets\/execute$/.test(u.pathname)))return route.continue();report.blockedWrites++;return route.abort();});
  const page=await context.newPage();
  await page.goto('https://mercure.myneorcha.com/tweak/',{waitUntil:'domcontentloaded',timeout:60000});
  await page.locator('input[formcontrolname=username]:visible').fill(process.env.NEORCHA_USER.trim());
  await page.locator('#userPassword').fill(process.env.NEORCHA_PASS);
  await page.locator('button.login-btn[type=submit]').click();
  await page.waitForURL(u=>/^\/tweak\/dashboard(?:\/|$)/.test(u.pathname),{timeout:45000});
  console.log('Mercure Tweak sign-in succeeded; verifying the scoped read-only collector.');
  const src=fs.readFileSync('neorcha.js','utf8'),a=src.indexOf('async function TWEAK_COLLECT('),b=src.indexOf('\nfunction COLLECTOR(',a),fn=src.slice(a,b);
  for(const day of ['2026-11-13','2026-11-14']){
   const summary=await page.evaluate(async({fn,day})=>{const notes=[],rows=await (0,eval)('('+fn+')')({from:day,to:day,hotelName:'Mercure',progress:p=>notes.push(p.note)});return {day,rows:rows.length,emails:rows.filter(r=>r.Email).length,phones:rows.filter(r=>r.Phone).length,allArrivalsOnRequestedDay:rows.every(r=>r['Arrival Date'].slice(0,10)===day),hotel:notes.find(n=>n.startsWith('Hotel confirmed: '))||'',containsForbiddenFields:rows.some(r=>Object.keys(r).some(k=>/passport|birth|document.?number/i.test(k)))};},{fn,day});
   assert(summary.hotel,'A single specific hotel must be confirmed');assert(summary.allArrivalsOnRequestedDay,'Arrival date scope mismatch');assert(!summary.containsForbiddenFields,'Forbidden fields present');report.checks.push(summary);
  }
  report.success=true;
 }catch(error){report.success=false;report.error=String(error.message||error).split('\n')[0].split(process.env.NEORCHA_USER||'\0').join('[redacted]').split(process.env.NEORCHA_PASS||'\0').join('[redacted]').slice(0,300);process.exitCode=1;}
 finally{if(browser)await browser.close();console.log('READ_ONLY_VERIFICATION '+JSON.stringify(report));}
})();
