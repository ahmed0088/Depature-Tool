'use strict';
// Isolated read-only inspection. No application or financial records are written.
const crypto=require('node:crypto'),fs=require('node:fs'),zlib=require('node:zlib');
const ORIGIN='https://app.fpg-ingauge.com';
function readQuery(body){
 try{
  const {parse}=require('graphql'),payload=JSON.parse(body),ast=parse(payload.query);
  return ast.definitions.length>0&&ast.definitions.every(d=>d.kind==='OperationDefinition'&&d.operation==='query'&&d.selectionSet.selections.length>0&&d.selectionSet.selections.every(f=>f.kind==='Field'&&/^(?:find|get|is|check|fetch|currentUser|me$)/.test(f.name.value)&&!/(?:update|create|delete|remove|assign|process|save|send|approve|deny|reset|impersonat)/i.test(f.name.value)));
 }catch(_){return false;}
}
function permitted(method,address,body='') {
  const u=new URL(address);
  if(u.origin==='https://login.app.fpg-ingauge.com'&&method==='POST'&&['/u/login/password','/u/login/identifier'].includes(u.pathname))return true;
  if(u.origin!==ORIGIN)return method==='GET'&&!u.pathname.includes('/m-api/');
  const p=u.pathname;
  if(method==='POST'&&p==='/pulse/api/tenantMenu/secure/getTenantMenuSelectedValue')return true;
  if(method==='GET'&&['/pulse/api/currency/secure/list','/pulse/api/metricAuditStatus/secure'].includes(p))return true;
  if(method==='GET'&&/^\/m-api\/account\/user\/avatar_base64\/\d+\/\d+$/.test(p))return true;
  if(method==='GET'&&p==='/m-api/login-service/v1/get-auth0-universal-page')return true;
  if(!p.startsWith('/m-api/')&&!p.startsWith('/pulse/api/'))return method==='GET';
  if(method==='POST'&&p==='/m-api/api/user/authenticateUserUsingLDAP')return true;
  if(method==='POST'&&p==='/m-api/login-service/v1/authenticate-with-auth0')return true;
  if(method==='POST'&&/^\/m-api\/(?:account|configuration|product|data)\/[A-Za-z0-9-]+\/gql$/.test(p))return readQuery(body);
  if(/(?:create|update|delete|remove|save|set[A-Z]|send|approve|deny|process|suspend|discontinue|reset|impersonat|logout|signout|track|mark|configure)/i.test(p))return false;
  if(method==='GET')return /\/(?:get[A-Z][^/]*|find[^/]*|is[A-Z0-9][^/]*|check[A-Z][^/]*)(?:\/[^/]*)*$/.test(p)||/\/secure\/\d+$/.test(p)||/\/(?:logo_base64|checkLogo)\//.test(p);
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
 let browser,page;const responseTasks=[];
 try {
  if(!process.env.INGAUGE_EMAIL||!process.env.INGAUGE_PASS)throw Error('MISSING_CREDENTIALS');
  const {chromium}=require('playwright-core');
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',args:['--no-sandbox']});
  const context=await browser.newContext({serviceWorkers:'block'});page=await context.newPage();
  page.setDefaultTimeout(15000);
  report.catalogReads=[];
  function catalogProjection(value){
   if(Array.isArray(value))return value.map(catalogProjection);
   if(!value||typeof value!=='object')return undefined;
   const keys=new Set(['id','intId','name','firstName','lastName','activeStatus','tenantId','tenantLocationId','locationGroupId','locationId','productCode','productSKU','isRecurring','roleType','pulseId','currency','code','url','moduleCode','productMetricsValidationType','hotelMetricsDataType','maxProductCharge']);
   return Object.fromEntries(Object.entries(value).flatMap(([k,v])=>v&&typeof v==='object'?[[k,catalogProjection(v)]]:keys.has(k)?[[k,v]]:[]));
  }
  page.on('response',response=>{
   const path=new URL(response.url()).pathname;
   if(['/m-api/account/location/gql','/m-api/account/location-group/gql','/m-api/account/user-tenant-role/gql','/pulse/api/userTenantRole/secure/getAccessibleTenantsWithRoleDetails'].includes(path)||/^\/pulse\/api\/(?:tenantLocation|locationGroup)\/secure\/get/.test(path))responseTasks.push((async()=>{
    try{const req=response.request();if(!permitted(req.method(),req.url(),req.postData()||''))return;const entry={path,http:response.status(),data:catalogProjection(await response.json())};if(!report.catalogReads.some(e=>e.path===path&&JSON.stringify(e.data)===JSON.stringify(entry.data)))report.catalogReads.push(entry);}catch(_){}
   })());
   if(path==='/pulse/api/user/is2FARequired')responseTasks.push((async()=>{try{const body=await response.json();report.twoFARequired=typeof body.data==='boolean'?body.data:'UNKNOWN';}catch(_){}})());
  });
  let headers=null,tenant=null;
  await context.route('**/*',async route=>{
   const r=route.request(),u=new URL(r.url());
   if(u.origin===ORIGIN&&(u.pathname.startsWith('/m-api/')||u.pathname.startsWith('/pulse/api/'))){
    const h=r.headers();if(h.authorization&&h.tenantid){headers=Object.fromEntries(Object.entries(h).filter(([k])=>['authorization','industryid','tenantid','platform','content-type'].includes(k)));tenant=h.tenantid;}
    const item={method:r.method(),path:u.pathname.replace(/\/\d+(?=\/|$)/g,'/:id')};
    if(u.pathname.endsWith('/gql'))try{item.queryFields=require('graphql').parse(JSON.parse(r.postData()).query).definitions.flatMap(d=>d.selectionSet?.selections.map(f=>f.name?.value)||[]).filter(Boolean);}catch(_){}
    if(!report.requests.some(x=>x.method===item.method&&x.path===item.path))report.requests.push(item);
   }
   if(permitted(r.method(),r.url(),r.postData()||''))return route.continue();
   const item={method:r.method(),path:u.pathname.replace(/\/\d+(?=\/|$)/g,'/:id')};
   if(!report.blocked.some(x=>x.method===item.method&&x.path===item.path))report.blocked.push(item);
   return route.abort();
  });
  report.stage='login';await page.goto(ORIGIN,{waitUntil:'domcontentloaded'});
  await page.locator('#email:visible,input[name=username]:visible,#password[type=password]:visible').first().waitFor({state:'visible',timeout:30000});
  function validLoginOrigin(){const o=new URL(page.url()).origin;if(![ORIGIN,'https://login.app.fpg-ingauge.com'].includes(o))throw Error('LOGIN_ORIGIN');return o;}
  if(!await page.locator('#password[type=password]').isVisible().catch(()=>false)){
   report.stage='login-identifier';const o=validLoginOrigin();
   const identifier=page.locator('#email:visible,input[name=username]:visible').first();await identifier.fill(process.env.INGAUGE_EMAIL);
   await page.locator(o===ORIGIN?'button.login-submit':'button[type=submit][name=action]').click();
  }
  report.stage='login-password';
  await page.locator('#password[type=password]').waitFor({state:'visible',timeout:30000});
  const passwordOrigin=validLoginOrigin();
  const username=page.locator('input[name=username]');
  if(passwordOrigin!==ORIGIN&&await username.count()){
   const value=await username.inputValue();if(value&&value.toLowerCase()!==process.env.INGAUGE_EMAIL.toLowerCase())throw Error('LOGIN_ACCOUNT_MISMATCH');
  }
  await page.locator('#password[type=password]').fill(process.env.INGAUGE_PASS);
  report.stage='login-submit';
  const exchangePromise=page.waitForResponse(r=>new URL(r.url()).origin===ORIGIN&&new URL(r.url()).pathname==='/m-api/login-service/v1/authenticate-with-auth0',{timeout:40000}).catch(()=>null);
  await page.locator(passwordOrigin===ORIGIN?'button.login-submit':'button[type=submit][name=action]').click();
  report.stage='login-callback';
  await page.waitForURL(url=>url.origin===ORIGIN,{timeout:30000});
  const exchange=await exchangePromise;
  if(exchange){
   const body=await exchange.json().catch(()=>null);
   report.authExchange={http:exchange.status(),status:['SUCCESS','FAIL','FAILED','ERROR','FAILURE'].includes(body?.status)?body.status:'OTHER',keys:body?Object.keys(body):[],dataKeys:body?.data&&typeof body.data==='object'?Object.keys(body.data):[],hasAccessToken:!!(body?.access_token||body?.data?.access_token)};
  }
  await page.waitForTimeout(7000);
  let view=page;
  async function findView(){for(let n=0;n<30;n++){for(const f of page.frames())if(await f.locator('select#TenantLocation option').count().catch(()=>0)>1)return f;await page.waitForTimeout(500);}throw Error('PRODUCT_VIEW_UNAVAILABLE');}
  async function options(selector){return view.locator(selector+' option').evaluateAll(ns=>ns.map(n=>({id:n.value,name:n.textContent.trim(),attributes:Object.fromEntries([...n.attributes].filter(a=>a.name.startsWith('data-')).map(a=>[a.name,a.value]))})).filter(n=>n.id&&!['0','-1','null','undefined',''].includes(n.id)));}
  async function select(selector,id){await view.locator(selector).selectOption(id,{force:true});await view.locator(selector).evaluate((n,v)=>{if(window.jQuery)window.jQuery(n).trigger('change',[{selected:v}]);},id);await page.waitForTimeout(1800);}
  async function read(path,data){
   const method=data?'POST':'GET';if(!permitted(method,ORIGIN+path,JSON.stringify(data||{})))throw Error('READ_GUARD');
   if(!headers||!tenant)return {error:'AUTH_CONTEXT_UNAVAILABLE'};
   const response=method==='POST'?await context.request.post(ORIGIN+path,{headers,data}):await context.request.get(ORIGIN+path,{headers});
   if(!response.ok())return {error:'HTTP_'+response.status()};return await response.json();
  }
  function rows(x){return Array.isArray(x?.data)?x.data:Array.isArray(x?.data?.data)?x.data.data:[];}
  function pick(x,keys){return Object.fromEntries(keys.filter(k=>x[k]!==undefined).map(k=>[k,x[k]]));}
  async function schema(){return view.locator('#fastAddModal input,#fastAddModal select,#fastAddModal textarea').evaluateAll(ns=>ns.map(n=>({id:n.id,name:n.name,type:n.type,required:n.required,disabled:n.disabled,readonly:n.readOnly,min:n.min,max:n.max,options:n.tagName==='SELECT'?[...n.options].map(o=>({id:o.value,name:o.textContent.trim()})):undefined})));}
  report.stage='catalog';
  for(let n=0;n<50&&(!headers||!tenant);n++)await page.waitForTimeout(200);
  const loc=await read('/pulse/api/tenantLocation/secure/getLocationsForUserAndTenants?'+new URLSearchParams({tenantIds:String(tenant)}));
  report.locationReadStatus=loc.status||loc.error;
  report.accountCatalog=[];
  for(const hotel of rows(loc)){
   if(!/ibis|adagio|mercure/i.test(hotel.name))continue;
   const h={...pick(hotel,['id','name','tenantId','hotelMetricsDataType','productMetricsValidationType','maxProductCharge','localCurrency','currency','regionCurrency']),departments:[]};report.accountCatalog.push(h);
   const deps=await read('/pulse/api/locationGroup/secure/getLocationGroup/'+encodeURIComponent(tenant)+'?'+new URLSearchParams({tenantLocationID:String(hotel.id)}));
   h.departmentReadStatus=deps.status||deps.error;
   for(const department of rows(deps)){
    const d={...pick(department,['id','name','activeStatus','tenantLocationId','isRetail','isFnB']),products:[],team:[]};h.departments.push(d);
    const products=await read('/pulse/api/locationGroupProduct/secure/getAllLocaionGroupProduct?industryId='+encodeURIComponent(headers.industryid||'1'),{first:-1,total:-1,locationGroupId:department.id,filterProducts:true,activeStatus:"NORMAL"});
    d.productsStatus=products.status||products.error;
    d.activeProducts=products.status==='SUCCESS'?rows(products).map(x=>pick(x,['id','name','productCode','productSKU','isRecurring','activeStatus'])):[];
    const full=await read('/m-api/product/product/gql',{query:'query { findAllByLocationGroupIntId(locationGroupIntId:'+department.id+') {intId,name,locationGroupIntId,isRecurring,productCode,productSKU} }'});
    d.allProductsStatus=Array.isArray(full.data?.findAllByLocationGroupIntId)?'SUCCESS':(full.error||'FAIL');
    d.allProducts=Array.isArray(full.data?.findAllByLocationGroupIntId)?full.data.findAllByLocationGroupIntId:[];
    d.products=rows(products).map(x=>pick(x,['id','intId','name','productCode','productSKU','isRecurring','activeStatus','locationGroupId','productCharge','maxProductCharge','type','code']));
    const team=await read('/pulse/api/user/secure/getAvailableUsers/'+encodeURIComponent(tenant)+'?'+new URLSearchParams({tenantLocationID:String(hotel.id),locationGroupID:String(department.id),getContributorsOnly:'true',getWithAllStatus:'true',getOperatorsOnly:'false',isWeightWiseUser:'false',allowSameWeightUser:'true',decideContributorOpratorLocationLevel:'true'}));
    d.teamStatus=team.status||team.error;
    d.team=rows(team).map(x=>pick(x,['id','intId','name','firstName','lastName','pulseId','employeeId','activeStatus','roleType']));
   }
  }
  console.log('Scoped hotel catalog reads finished; no financial writes.');
  report.stage='metrics';await page.goto(ORIGIN+'/metrics/productMetrics',{waitUntil:'domcontentloaded'});
  try{view=await findView();}catch(_){report.frames=await Promise.all(page.frames().map(async f=>({origin:new URL(f.url()).origin,path:new URL(f.url()).pathname,selects:await f.locator('select').evaluateAll(ns=>ns.map(n=>({id:n.id,name:n.name,options:n.options.length}))).catch(()=>[])})));report.stage='catalog-read-ui-incomplete';return;}
  console.log('Authenticated product screen reached; business writes remain blocked.');
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
      const product=await read('/pulse/api/locationGroupProduct/secure/getAllLocaionGroupProduct?industryId='+encodeURIComponent(headers.industryid||'1'),{first:-1,total:-1,locationGroupId:Number(department.id),filterProducts:true,activeStatus:"NORMAL"});
      d.productsStatus=product.status||product.error;
      d.products=rows(product).map(x=>pick(x,['id','intId','name','productCode','productSKU','isRecurring','activeStatus','locationGroupId','productCharge','maxProductCharge','type','code']));
      if(tenant){
       const team=await read('/pulse/api/user/secure/getAvailableUsers/'+encodeURIComponent(tenant)+'?'+new URLSearchParams({tenantLocationID:hotel.id,locationGroupID:department.id,getContributorsOnly:'true',getWithAllStatus:'true',getOperatorsOnly:'false',isWeightWiseUser:'false',allowSameWeightUser:'true',decideContributorOpratorLocationLevel:'true'}));
       d.teamStatus=team.status||team.error;d.team=rows(team).map(x=>pick(x,['id','intId','name','firstName','lastName','pulseId','activeStatus','roleType']));
      }
      const add=view.locator('a[title="Add"],button[title="Add"]').first();d.canOpenAdd=await add.isVisible().catch(()=>false);
      d.actionLabels=await view.locator('a[title],button[title]').evaluateAll(ns=>[...new Set(ns.map(n=>n.title).filter(s=>/edit|approv|deny|lock|delet|adjust|add|review/i.test(s)))]);
      if(d.canOpenAdd){
       await add.click();await view.locator('#fastAddModal').waitFor({state:'visible'});
       await select('select#TenantLocationSel',hotel.id);await select('select#LocationGroupSel',department.id);
       d.formProducts=await options('select#Product');d.formTeam=await options('select#User');d.schemas=[];
       for(const p of d.formProducts){
        await select('select#Product',p.id);d.schemas.push({productId:p.id,fields:await schema()});
       }
       // Navigation discards the untouched form; no submit/confirmation buttons are clicked.
       await page.goto(ORIGIN+'/metrics/productMetrics',{waitUntil:'domcontentloaded'});
       view=await findView();
       await select('select#TenantLocation',hotel.id);
      }
     }catch(_){d.error='DEPARTMENT_INSPECTION_INCOMPLETE';}
    }
   }catch(_){h.error='HOTEL_INSPECTION_INCOMPLETE';}
  }
  report.stage='complete';
 }catch(e){report.failure=['MISSING_CREDENTIALS','READ_GUARD','LOGIN_ACCOUNT_MISMATCH','LOGIN_ORIGIN'].includes(e.message)?e.message:'INSPECTION_STOPPED';
  if(page)try{report.page={origin:new URL(page.url()).origin,path:new URL(page.url()).pathname,title:await page.title(),fields:await page.locator('input,button').evaluateAll(ns=>ns.map(n=>({tag:n.tagName,id:n.id,name:n.name,type:n.type,label:n.tagName==='BUTTON'?n.textContent.trim().slice(0,80):n.getAttribute('placeholder')})))};}catch(_){}
 }
 finally{
  await Promise.allSettled(responseTasks);
  if(browser)await browser.close().catch(()=>{});
  report.finished=new Date().toISOString();
  const result=envelope(report,fs.readFileSync('scripts/study-public.pem'));
  const encoded=Buffer.from(JSON.stringify(result)).toString('base64');
  console.log('STUDY_BEGIN');for(let i=0;i<encoded.length;i+=2000)console.log('STUDY_CHUNK '+encoded.slice(i,i+2000));console.log('STUDY_END');
  console.log(report.stage==='complete'?'Read-only inspection completed.':'Read-only inspection stopped; encrypted diagnostic available.');
 }
}
module.exports={permitted,envelope,readQuery};if(require.main===module)main().catch(()=>{console.log('Study report unavailable.');process.exitCode=1;});
