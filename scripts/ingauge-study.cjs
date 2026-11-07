'use strict';
// Isolated read-only inspection. No application or financial records are written.
const crypto=require('node:crypto'),fs=require('node:fs'),zlib=require('node:zlib');
const ORIGIN='https://app.fpg-ingauge.com';
function permitted(method,address,body='') {
  const u=new URL(address); if(u.origin!==ORIGIN)return method==='GET'&&!u.pathname.includes('/m-api/');
  const p=u.pathname;
  if(!p.startsWith('/m-api/'))return method==='GET';
  if(method==='POST'&&p==='/m-api/api/user/authenticateUserUsingLDAP')return true;
  if(/(?:create|update|delete|remove|save|set[A-Z]|send|approve|deny|process|suspend|discontinue|reset|impersonat|logout|signout|track|mark|configure)/i.test(p))return false;
  if(method==='GET')return /\/(?:get[A-Z][^/]*|find[^/]*|is[A-Z][^/]*|check[A-Z][^/]*)(?:\/[^/]*)*$/.test(p)||/\/secure\/\d+$/.test(p)||/\/(?:logo_base64|checkLogo)\//.test(p);
  if(method==='POST'&&/\/(?:find|searchProductMetricData|getAllLocaionGroupProduct)$/.test(p))return true;
  return false;
}
function envelope(report,key) {
 const secret=crypto.randomBytes(32),iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',secret,iv);
 const ciphertext=Buffer.concat([cipher.update(zlib.gzipSync(JSON.stringify(report))),cipher.final()]);
 return {key:crypto.publicEncrypt({key,padding:crypto.constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},secret).toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:ciphertext.toString('base64')};
}
async function main(){
 const report={version:1,started:new Date().toISOString(),stage:'initial',blocked:[],requests:[],hotels:[],failures:[]};
 let browser;
 try {
  if(!process.env.INGAUGE_EMAIL||!process.env.INGAUGE_PASS)throw Error('MISSING_CREDENTIALS');
  const {chromium}=require('playwright-core');
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',args:['--no-sandbox']});
  const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();
  page.setDefaultTimeout(15000);
  let headers=null,tenant=null;
  await context.route('**/*',async route=>{
   const r=route.request(),u=new URL(r.url());
   if(u.origin===ORIGIN&&u.pathname.startsWith('/m-api/')){
    const h=r.headers();if(h.authorization&&h.tenantid){headers=Object.fromEntries(Object.entries(h).filter(([k])=>['authorization','industryid','tenantid','platform','content-type'].includes(k)));tenant=h.tenantid;}
    const item={method:r.method(),path:u.pathname.replace(/\/\d+(?=\/|$)/g,'/:id')};
    if(!report.requests.some(x=>x.method===item.method&&x.path===item.path))report.requests.push(item);
   }
   if(permitted(r.method(),r.url(),r.postData()||''))return route.continue();
   const item={method:r.method(),path:u.pathname.replace(/\/\d+(?=\/|$)/g,'/:id')};
   if(!report.blocked.some(x=>x.method===item.method&&x.path===item.path))report.blocked.push(item);
   return route.abort();
  });
  report.stage='login';await page.goto(ORIGIN,{waitUntil:'domcontentloaded'});
  await page.locator('#email').waitFor({state:'visible',timeout:30000});
  await page.locator('#email').fill(process.env.INGAUGE_EMAIL);
  if(!await page.locator('#password[type=password]').isVisible().catch(()=>false))await page.locator('button.login-submit').click();
  await page.locator('#password[type=password]').waitFor({state:'visible',timeout:20000});
  await page.locator('#password[type=password]').fill(process.env.INGAUGE_PASS);
  await page.locator('button.login-submit').click();
  await page.waitForFunction(()=>!document.querySelector('#email')&&!document.querySelector('#password'),{},{timeout:30000});
  report.stage='metrics';await page.goto(ORIGIN+'/metrics/productMetrics',{waitUntil:'domcontentloaded'});
  await page.locator('select#TenantLocation option').nth(1).waitFor({state:'attached',timeout:30000});
  async function options(selector){return page.locator(selector+' option').evaluateAll(ns=>ns.map(n=>({id:n.value,name:n.textContent.trim(),attributes:Object.fromEntries([...n.attributes].filter(a=>a.name.startsWith('data-')).map(a=>[a.name,a.value]))})).filter(n=>n.id&&!['0','-1','null','undefined',''].includes(n.id)));}
  async function select(selector,id){await page.locator(selector).selectOption(id,{force:true});await page.locator(selector).evaluate((n,v)=>{if(window.jQuery)window.jQuery(n).trigger('change',[{selected:v}]);},id);await page.waitForTimeout(1800);}
  async function read(path,data){
   const method=data?'POST':'GET';if(!permitted(method,ORIGIN+path))throw Error('READ_GUARD');
   const result=await page.evaluate(async ({path,data,headers})=>{try{const r=await fetch(path,{method:data?'POST':'GET',headers:{...headers,'content-type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});return {status:r.status,body:await r.json()};}catch(_){return {status:0};}}, {path,data,headers});
   if(result.status!==200)return {error:'HTTP_'+result.status};return result.body;
  }
  function rows(x){return Array.isArray(x?.data)?x.data:Array.isArray(x?.data?.data)?x.data.data:[];}
  function pick(x,keys){return Object.fromEntries(keys.filter(k=>x[k]!==undefined).map(k=>[k,x[k]]));}
  async function schema(){return page.locator('#fastAddModal input,#fastAddModal select,#fastAddModal textarea').evaluateAll(ns=>ns.map(n=>({id:n.id,name:n.name,type:n.type,required:n.required,disabled:n.disabled,readonly:n.readOnly,min:n.min,max:n.max,options:n.tagName==='SELECT'?[...n.options].map(o=>({id:o.value,name:o.textContent.trim()})):undefined})));}
  report.locations=await options('select#TenantLocation');
  for(const hotel of report.locations){
   // Scope the requested study to the three hotel brands; retain visible location names for coverage.
   if(!/ibis|adagio|mercure/i.test(hotel.name))continue;
   const h={...hotel,departments:[]};report.hotels.push(h);report.stage='hotel';
   try{
    await select('select#TenantLocation',hotel.id);h.tenantId=tenant;
    h.statuses=await options('select#roleAuditStatus');h.departmentsAvailable=await options('select#LocationGroup');
    for(const department of h.departmentsAvailable){
     const d={...department};h.departments.push(d);
     try{
      await select('select#LocationGroup',department.id);
      const product=await read('/m-api/api/locationGroupProduct/secure/getAllLocaionGroupProduct',{first:-1,total:-1,locationGroupId:Number(department.id),filterProducts:false,activeStatus:-1});
      d.productsStatus=product.status||product.error;
      d.products=rows(product).map(x=>pick(x,['id','intId','name','productCode','productSKU','isRecurring','activeStatus','locationGroupId','productCharge','maxProductCharge','type','code']));
      if(tenant){
       const team=await read('/m-api/api/user/secure/getAvailableUsers/'+encodeURIComponent(tenant)+'?'+new URLSearchParams({tenantLocationID:hotel.id,locationGroupID:department.id,getContributorsOnly:'true',getWithAllStatus:'true',getOperatorsOnly:'false',isWeightWiseUser:'false',allowSameWeightUser:'true',decideContributorOpratorLocationLevel:'true'}));
       d.teamStatus=team.status||team.error;d.team=rows(team).map(x=>pick(x,['id','intId','name','firstName','lastName','pulseId','activeStatus','roleType']));
      }
      const add=page.locator('a[title="Add"],button[title="Add"]').first();d.canOpenAdd=await add.isVisible().catch(()=>false);
      d.actionLabels=await page.locator('a[title],button[title]').evaluateAll(ns=>[...new Set(ns.map(n=>n.title).filter(s=>/edit|approv|deny|lock|delet|adjust|add|review/i.test(s)))]);
      if(d.canOpenAdd){
       await add.click();await page.locator('#fastAddModal').waitFor({state:'visible'});
       await select('select#TenantLocationSel',hotel.id);await select('select#LocationGroupSel',department.id);
       d.formProducts=await options('select#Product');d.formTeam=await options('select#User');d.schemas=[];
       for(const p of d.formProducts){
        await select('select#Product',p.id);d.schemas.push({productId:p.id,fields:await schema()});
       }
       // Navigation discards the untouched form; no submit/confirmation buttons are clicked.
       await page.goto(ORIGIN+'/metrics/productMetrics',{waitUntil:'domcontentloaded'});
       await page.locator('select#TenantLocation option').nth(1).waitFor({state:'attached'});
       await select('select#TenantLocation',hotel.id);
      }
     }catch(_){d.error='DEPARTMENT_INSPECTION_INCOMPLETE';}
    }
   }catch(_){h.error='HOTEL_INSPECTION_INCOMPLETE';}
  }
  report.stage='complete';
 }catch(e){report.failure=['MISSING_CREDENTIALS','READ_GUARD'].includes(e.message)?e.message:'INSPECTION_STOPPED';}
 finally{
  if(browser)await browser.close().catch(()=>{});
  report.finished=new Date().toISOString();
  const result=envelope(report,fs.readFileSync('scripts/study-public.pem'));
  const encoded=Buffer.from(JSON.stringify(result)).toString('base64');
  console.log('STUDY_BEGIN');for(let i=0;i<encoded.length;i+=2000)console.log('STUDY_CHUNK '+encoded.slice(i,i+2000));console.log('STUDY_END');
  console.log(report.stage==='complete'?'Read-only inspection completed.':'Read-only inspection stopped; encrypted diagnostic available.');
 }
}
module.exports={permitted,envelope};if(require.main===module)main().catch(()=>{console.log('Study report unavailable.');process.exitCode=1;});
