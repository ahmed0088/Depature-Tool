
'use strict';
// Source-verified reads only. Does not save targets or financial records.
const fs=require('node:fs'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {InGaugeAccount}=require('./ingauge-account.js'),C=require('../ingauge-audit-core.js');
function envelope(report){const key=crypto.randomBytes(32),iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv),data=Buffer.concat([cipher.update(zlib.gzipSync(JSON.stringify(report))),cipher.final()]);return {key:crypto.publicEncrypt({key:fs.readFileSync('scripts/goal-read-public.pem'),padding:crypto.constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},key).toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')};}
(async()=>{const out={schema:1,at:new Date().toISOString(),hotels:[],stage:'login'};let browser;try{
 const {chromium}=require('playwright-core');browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true,args:['--no-sandbox']});const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage(),p=new InGaugeAccount(page,'https://app.fpg-ingauge.com/');await p.installGuard();await p.login(process.env.INGAUGE_EMAIL,process.env.INGAUGE_PASS);const d=await p.discover();
 const month=Number(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dubai',month:'2-digit'}).format(new Date())),year=Number(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dubai',year:'numeric'}).format(new Date()));out.month=month;out.year=year;
 for(const h of d.hotels){const g=h.departments.find(x=>x.name==='Front Desk');if(!g)continue;out.stage='hotel '+h.id;const b=C.binding({portalUrl:d.portalUrl,tenantId:h.tenantId,propertyId:h.id,departmentId:g.id,property:h.name,department:g.name});const scope=await p.scope(b),r={binding:b,settings:scope.settings,reads:[]};out.hotels.push(r);
  const read=async(path,params,method='POST')=>{const u=p.origin+'/pulse/api/goal/secure/'+path+'?'+new URLSearchParams(params),response=await context.request[method==='POST'?'post':'get'](u,{headers:p.headers,...(method==='POST'?{data:'null'}:{}),timeout:30000});let data;try{data=await response.json();}catch(_){data={unreadable:true};}r.reads.push({path,params,http:response.status(),data});};
  const common={industryId:scope.settings.industryId,tenantId:b.tenantId,tenantLocationId:b.propertyId,month,year};
  await read('getRevenueGoal',{...common,isMultiple:false,isLocationGoal:true,currentMonthGoalsGroupedByCategory:false});
  await read('getRevenueGoal',{...common,locationGroupId:b.departmentId,isMultiple:false,isLocationGoal:false,currentMonthGoalsGroupedByCategory:false});
  await read('goalProgress',{...common,locationGroupId:b.departmentId},'GET');
 }
 out.stage='complete';
}catch(e){out.error=e.message;}finally{if(browser)await browser.close().catch(()=>{});const encoded=Buffer.from(JSON.stringify(envelope(out))).toString('base64');console.log('GOAL_BEGIN');for(let i=0;i<encoded.length;i+=2000)console.log('GOAL_CHUNK '+encoded.slice(i,i+2000));console.log('GOAL_END');}})();
