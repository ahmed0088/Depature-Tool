'use strict';
const C=require('../ingauge-audit-core.js');
const {parse}=require('graphql');
const API='/pulse/api/';
const STATUSES=['APPROVED','PENDING','DENIED','LOCKED','ERROR','PURGED','REVIEWED','APPROVED_POST_LOCK','INVOICED_POST_LOCK','DENIED_POST_LOCK','ERROR_POST_LOCK','ADJUSTED_POST_LOCK'];
class PortalError extends Error {constructor(message,uncertain=false){super(message);this.uncertain=uncertain;}}
function readQuery(body){try{const ast=parse(JSON.parse(body).query);return ast.definitions.length>0&&ast.definitions.every(d=>d.kind==='OperationDefinition'&&d.operation==='query'&&d.selectionSet.selections.every(f=>f.kind==='Field'&&/^(find|get|is|check|fetch)/.test(f.name.value)&&!/(update|create|delete|remove|save|send|assign|approve|deny|process|reset)/i.test(f.name.value)));}catch(_){return false;}}
function readAllowed(method,url,origin,body=''){
  const u=new URL(url),p=u.pathname;
  if(u.origin!==origin)return method==='GET'||(u.protocol==='https:'&&u.hostname.endsWith('.fpg-ingauge.com')&&method==='POST'&&['/u/login/password','/u/login/identifier'].includes(p));
  if(method==='GET'&&p==='/m-api/login-service/v1/get-auth0-universal-page')return true;
  if(method==='POST'&&['/m-api/login-service/v1/authenticate-with-auth0','/m-api/api/user/authenticateUserUsingLDAP','/pulse/api/tenantMenu/secure/getTenantMenuSelectedValue'].includes(p))return true;
  if(!p.startsWith('/pulse/api/')&&!p.startsWith('/m-api/'))return method==='GET';
  if(method==='POST'&&p.endsWith('/gql'))return readQuery(body);
  if(/(update|create|delete|remove|save|send|assign|approve|deny|process|suspend|reset|impersonat|set[A-Z])/i.test(p))return false;
  if(method==='GET')return /\/(get[A-Z][^/]*|find[^/]*|is[A-Z0-9][^/]*|check[A-Z][^/]*)(\/[^/]*)*$/.test(p)||/\/secure\/\d+$/.test(p)||['/pulse/api/metricAuditStatus/secure','/pulse/api/currency/secure/list'].includes(p)||/\/avatar_base64\/\d+\/\d+$/.test(p);
  return method==='POST'&&/\/(find|searchProductMetricData|getAllLocaionGroupProduct)$/.test(p);
}
class InGaugeAccount {
  constructor(page,url){this.page=page;this.context=page.context();this.url=C.portalUrl(url);this.origin=new URL(this.url).origin;this.headers=null;this.tenantId='';this.actor=null;this.sent=false;this.closed=false;}
  async installGuard(){
    await this.context.route('**/*',async route=>{
      const r=route.request(),u=new URL(r.url()),h=r.headers();
      if(u.origin===this.origin&&h.authorization){
        this.headers=Object.fromEntries(Object.entries(h).filter(([k])=>['authorization','industryid','tenantid','platform','content-type'].includes(k)));
        if(h.tenantid)this.tenantId=String(h.tenantid);
      }
      return readAllowed(r.method(),r.url(),this.origin,r.postData()||'')?route.continue():route.abort();
    });
  }
  async login(email,password){
    if(!email||!password)throw new PortalError('IN-Gauge account secrets are missing.');
    await this.page.goto(this.url,{waitUntil:'domcontentloaded',timeout:45000});
    await this.page.locator('#email:visible,input[name=username]:visible,#password[type=password]:visible').first().waitFor({state:'visible',timeout:30000});
    const valid=()=>{const u=new URL(this.page.url());if(u.origin!==this.origin&&!(u.protocol==='https:'&&u.hostname.endsWith('.fpg-ingauge.com')))throw new PortalError('Sign-in left the verified IN-Gauge provider.');return u.origin;};
    if(!await this.page.locator('#password[type=password]').isVisible().catch(()=>false)){
      const o=valid();await this.page.locator('#email:visible,input[name=username]:visible').first().fill(email);
      await this.page.locator(o===this.origin?'button.login-submit':'button[type=submit][name=action]').click();
    }
    await this.page.locator('#password[type=password]').waitFor({state:'visible',timeout:30000});
    const o=valid(),user=this.page.locator('input[name=username]');
    if(o!==this.origin&&await user.count()){const v=await user.inputValue();if(v&&v.toLowerCase()!==email.toLowerCase())throw new PortalError('The login page selected another account.');}
    await this.page.locator('#password[type=password]').fill(password);
    const exchange=this.page.waitForResponse(r=>new URL(r.url()).origin===this.origin&&new URL(r.url()).pathname==='/m-api/login-service/v1/authenticate-with-auth0',{timeout:40000}).catch(()=>null);
    await this.page.locator(o===this.origin?'button.login-submit':'button[type=submit][name=action]').click();
    await this.page.waitForURL(u=>u.origin===this.origin,{timeout:30000});
    await exchange;for(let n=0;n<60&&(!this.headers?.authorization||!this.tenantId);n++)await this.page.waitForTimeout(250);
    if(!this.headers?.authorization||!this.tenantId)throw new PortalError('Sign-in requires an interactive verification or did not finish. No financial changes were sent.');
    const actor=await this.read(API+'user/secure/getByToken');
    if(actor.status!=='SUCCESS'||!C.id(actor.data?.id))throw new PortalError('Could not verify the connected account.');
    this.actor={id:C.id(actor.data.id),name:C.text(actor.data.name)};
  }
  async read(path,data){
    if(!this.headers?.authorization)throw new PortalError('The authenticated portal connection is unavailable.');
    const method=data===undefined?'GET':'POST',url=this.origin+path;
    if(!readAllowed(method,url,this.origin,JSON.stringify(data||{})))throw new PortalError('A read attempted an unverified endpoint.');
    const options={headers:{...this.headers,...(this.scopeTenant?{tenantid:this.scopeTenant}:{})},timeout:30000};if(data!==undefined)options.data=data;
    const r=await this.context.request[method==='POST'?'post':'get'](url,options);
    if(!r.ok())throw new PortalError('IN-Gauge read failed ('+r.status()+').');
    try{return await r.json();}catch(_){throw new PortalError('IN-Gauge returned an unreadable response.');}
  }
  data(response){if(response.status!=='SUCCESS')throw new PortalError('IN-Gauge did not confirm the requested data read.');return response.data;}
  async discover(){
    const roleResponse=await this.read(API+'userTenantRole/secure/getAccessibleTenantsWithRoleDetails');
    if(!Array.isArray(roleResponse.data)||(roleResponse.status&&roleResponse.status!=='SUCCESS'))throw new PortalError('The accessible tenant list could not be verified.');
    const roles=roleResponse.data;
    const tenants=[...new Set((roles||[]).map(r=>C.id(r.tenantId)).filter(Boolean))];if(!tenants.length)throw new PortalError('No accessible tenant was returned.');
    const locations=this.data(await this.read(API+'tenantLocation/secure/getLocationsForUserAndTenants?'+new URLSearchParams({tenantIds:tenants.join(',')})));
    const hotels=[];
    for(const h of locations||[]){
      if(!tenants.includes(C.id(h.tenantId)))throw new PortalError('A location had an unverified tenant.');
      this.scopeTenant=C.id(h.tenantId);
      const groupData=this.data(await this.read(API+'locationGroup/secure/getLocationGroup/'+h.tenantId+'?'+new URLSearchParams({tenantLocationID:String(h.id)})));
      hotels.push({id:C.id(h.id),name:C.text(h.name),tenantId:C.id(h.tenantId),departments:(groupData||[]).filter(g=>g.activeStatus==='NORMAL').map(g=>({id:C.id(g.id),name:C.text(g.name),retail:!!g.isRetail,fnb:!!g.isFoodAndBeverage}))});
    }
    return {portalUrl:this.url,hotels,actor:this.actor};
  }
  async scope(binding){
    const b=C.binding(binding);if(new URL(b.portalUrl).origin!==this.origin)throw new PortalError('The reviewed portal differs from this connection.');
    const discovery=await this.discover(),hotel=discovery.hotels.find(h=>h.id===b.propertyId&&h.tenantId===b.tenantId),group=hotel?.departments.find(d=>d.id===b.departmentId);
    if(!hotel||!group||hotel.name!==b.property||group.name!==b.department)throw new PortalError('The exact reviewed hotel and department were not verified in this account.');
    if(group.retail||group.fnb)throw new PortalError('This automation requires the hotel Front Desk workflow. Retail and F&B need their own quantity model.');
    this.scopeTenant=b.tenantId;this.headers={...this.headers,tenantid:b.tenantId};this.tenantId=b.tenantId;
    const config=this.data(await this.read(API+'tenantLocation/secure/'+b.propertyId));
    if(C.id(config.id)!==b.propertyId||C.id(config.tenantId)!==b.tenantId)throw new PortalError('The live property configuration differs from the reviewed binding.');
    const query='query{respData:findUserTenantRoleWithOpenRoutes(userTenantRoleSearchForm:{industryId:'+Number(this.headers.industryid||1)+',tenantId:'+b.tenantId+',userId:'+this.actor.id+',locationId:'+b.propertyId+',departmentId:'+b.departmentId+'}){role{rolePermissions{name} roleIndustryRoute{url}}}}';
    const access=await this.read('/m-api/account/user-tenant-role/gql',{query}),roles=access.data?.respData;
    if(!Array.isArray(roles)||!roles.length)throw new PortalError('Could not verify permissions for this property.');
    const paths=new Set(roles.flatMap(r=>(r.role?.roleIndustryRoute||[]).map(x=>x.url))),names=new Set(roles.flatMap(r=>(r.role?.rolePermissions||[]).map(x=>x.name)));
    const can=suffix=>paths.has('/metrics/productMetricAuditTrail/'+suffix)||paths.has('/metrics/productMetrics/'+suffix);
    const settings={currency:C.text(config.localCurrencyCode||config.regionCurrency),metricType:C.text(config.hotelMetricsDataType),validation:C.text(config.productMetricsValidationType),industryId:Number(this.headers.industryid||1),maxChargeCents:C.cents(config.maxProductCharge)||0};
    if(!settings.currency||settings.metricType!=='DAILY')throw new PortalError('This property’s daily currency and date configuration needs review.');
    return {binding:b,settings,permissions:{canAdd:paths.has('/metrics/productMetrics/add'),canEdit:paths.has('/metrics/productMetrics/edit'),canApprove:can('approve'),canDeny:can('deny'),canDelete:can('delete'),canReassign:names.has('canChangeContributor')||names.has('isSuperAdmin')}};
  }
  async contributors(b){
    const rows=this.data(await this.read(API+'user/secure/getAvailableUsers/'+b.tenantId+'?'+new URLSearchParams({tenantLocationID:b.propertyId,locationGroupID:b.departmentId,getContributorsOnly:'true',getWithAllStatus:'true',getOperatorsOnly:'false',isWeightWiseUser:'false',allowSameWeightUser:'true',decideContributorOpratorLocationLevel:'true'})));
    if(!Array.isArray(rows))throw new PortalError('The contributor list is incomplete.');
    return rows.map(p=>({id:C.id(p.id),name:C.text(p.name),pulseId:C.text(p.pulseId),activeStatus:C.text(p.activeStatus)}));
  }
  async products(b){
    const full=await this.read('/m-api/product/product/gql',{query:'query{findAllByLocationGroupIntId(locationGroupIntId:'+b.departmentId+'){intId,name,locationGroupIntId,isRecurring,productCode,productSKU}}'});
    const list=full.data?.findAllByLocationGroupIntId;if(!Array.isArray(list))throw new PortalError('The full product catalog was not returned.');
    const out=[];for(const p of list){
      if(C.id(p.locationGroupIntId)!==b.departmentId)throw new PortalError('A product belongs to another department.');
      const detail=this.data(await this.read(API+'locationGroupProduct/secure/'+C.id(p.intId)));
      if(typeof detail.isRecurring!=='boolean')throw new PortalError('A product’s recurring flag is not verified.');
      out.push({id:C.id(p.intId),name:C.text(p.name),code:C.text(p.productCode),sku:C.text(p.productSKU),recurring:detail.isRecurring,activeStatus:C.text(detail.activeStatus),departmentId:b.departmentId});
    }return out;
  }
  async search(b,from,to,confirmation=''){
    if(!C.day(from)||!C.day(to)||from>to)throw new PortalError('Choose a valid date range.');
    const operator=this.data(await this.read(API+'locationGroup/secure/isOperator/'+b.tenantId+'/'+b.propertyId+'/'+this.actor.id+'?'+new URLSearchParams({locationGroupID:b.departmentId})));
    if(typeof operator!=='boolean')throw new PortalError('The account’s record scope was not verified.');
    const rows=[],seen=new Set();let first=0,total=null;
    for(let page=0;page<250;page++){
      const response=await this.read(API+'productMetric/secure/searchProductMetricData?sortBy=updatedOn&orderBy=DESC',{mapTo:'PRODUCTMETRICSEARCH',userId:Number(this.actor.id),isOperator:operator,searchKeyword:confirmation,industryType:'HOTEL',industryId:Number(this.headers.industryid||1),tenantLocationId:Number(b.propertyId),metricDataType:'DAILY',locationGroupId:Number(b.departmentId),auditStatus:STATUSES,sDate:from,eDate:to,first,total:200,isAllRecords:true,isAutoCorrectRecords:false,isManuallyAddedRecords:false,isAdjustedRecord:false});
      const data=this.data(response);
      if(!Array.isArray(data?.data)||!Number.isSafeInteger(data.totalInList)||Number(data.first)!==first)throw new PortalError('The live record pagination was not verified.');
      if(total!==null&&total!==data.totalInList)throw new PortalError('IN-Gauge changed while records were being read. Fetch again.');total=data.totalInList;
      for(const raw of data.data){const r=C.record(raw);if(r.propertyId!==b.propertyId||r.departmentId!==b.departmentId||seen.has(r.id))throw new PortalError('A record was duplicated or outside the selected hotel.');seen.add(r.id);rows.push(r);}
      first+=data.data.length;if(first>=total)return confirmation?rows.filter(r=>r.confirmation===confirmation):rows;
      if(!data.data.length)throw new PortalError('The live record list ended early.');
    }throw new PortalError('The record list exceeds the verified pagination limit. Narrow the date range.');
  }
  async snapshot(b,from,to,hotelId,snapshotId){
    const scope=await this.scope(b),products=await this.products(scope.binding),contributors=await this.contributors(scope.binding),records=await this.search(scope.binding,from,to);
    return {schema:1,id:snapshotId,hotelId,...scope,from,to,fetchedAt:Date.now(),complete:true,products,contributors,records,actor:this.actor};
  }
  async readRecord(id){return C.record(this.data(await this.read(API+'productMetric/secure/'+C.id(id))));}
  async testOperation(op,snapshot){
    let current=null;if(op.action!=='add'){current=await this.readRecord(op.recordId);if(C.fingerprint(current)!==op.expected)throw new PortalError('This record changed since review. Refresh before editing or changing its status.');}
    const scope=await this.scope(snapshot.binding),fresh={...snapshot,...scope,products:await this.products(scope.binding),contributors:await this.contributors(scope.binding)};
    const error=C.operationError(op,fresh);if(error)throw new PortalError(error);
    const v=op.action==='add'||op.action==='edit'?op.values:C.values(current);
    const locked=this.data(await this.read(API+'productMetric/secure/isLocked?'+new URLSearchParams({tenantLocationId:scope.binding.propertyId,arrivalDate:v.arrival,departureDate:v.departure,businessDate:v.businessDate,metricDate:v.businessDate})));
    if(typeof locked!=='boolean'||locked)throw new PortalError('This accounting period is locked or its lock state is unknown. Use IN-Gauge’s adjustment workflow.');
    if(['add','edit'].includes(op.action)){
      const records=await this.search(scope.binding,'2000-01-01','2099-12-31',op.confirmation);
      if(C.duplicates(op,records.filter(r=>String(r.id)!==String(op.recordId||'')),fresh.products).length)throw new PortalError('An existing request or product already represents this sale. It was not duplicated.');
    }
    return {current,snapshot:fresh,payload:['add','edit'].includes(op.action)?C.payload(op,fresh,current):null};
  }
  async apply(op,snapshot){
    this.sent=false;const checked=await this.testOperation(op,snapshot);let path,method,data;
    if(['add','edit'].includes(op.action)){path=API+'productMetric/secure';method=op.action==='add'?'post':'put';data=checked.payload;}
    else{path=API+'auditTrail/secure?'+new URLSearchParams(C.auditParams(op));method='post';data={};}
    // All browser traffic remains read-only. This single request is built from the validated reviewed operation.
    this.sent=true;let response;
    try{const r=await this.context.request[method](this.origin+path,{headers:{...this.headers,tenantid:snapshot.binding.tenantId},data,timeout:30000});response=await r.json();if(!r.ok()||response.status!=='SUCCESS')throw new PortalError('IN-Gauge did not confirm this change. Check the record before retrying.',true);}
    catch(error){throw new PortalError(error instanceof PortalError?error.message:'The outcome of the request is uncertain. Check IN-Gauge before retrying.',true);}
    const recordId=op.action==='add'?C.id(response.data?.id):C.id(op.recordId);
    if(!recordId)throw new PortalError('IN-Gauge did not return the new record identifier. Check the outcome before retrying.',true);
    let after;try{after=await this.readRecord(recordId);}catch(_){throw new PortalError('The change was sent but its final record could not be verified.',true);}
    if(!C.matches(op,after))throw new PortalError('IN-Gauge returned different final values. The outcome needs review.',true);
    return {recordId,after};
  }
}
module.exports={InGaugeAccount,PortalError,readAllowed,readQuery,STATUSES};


