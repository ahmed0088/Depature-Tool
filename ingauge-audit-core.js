// Financial review model shared by HotelOps and its cloud worker. No I/O.
(function(root){
  'use strict';
  const text=v=>String(v??'').trim(), id=v=>text(v).replace(/\.0+$/,''), numId=v=>/^\d+$/.test(id(v))&&Number.isSafeInteger(Number(id(v)))&&Number(id(v))>0;
  const key=v=>text(v).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
  const words=v=>key(v).split(' ').filter(Boolean), login=v=>key(text(v).split('@')[0].split('-').pop()).replace(/ /g,'');
  const sameName=(a,b)=>words(a).sort().join(' ')===words(b).sort().join(' ');
  const terminal=new Set(['DENIED','PURGED']), editable=new Set(['PENDING','APPROVED','REVIEWED','ERROR','DENIED']);
  function fail(message){throw new Error(message);}
  function day(v){
    if(typeof v==='number'&&Number.isFinite(v))v=new Date(v).toISOString().slice(0,10);
    const s=text(v).slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return '';
    const d=new Date(s+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s?s:'';
  }
  function cents(v){
    if(typeof v==='number')return Number.isFinite(v)&&Math.abs(v*100-Math.round(v*100))<0.00001?Math.round(v*100):null;
    const input=text(v);if(!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(input))return null;
    const s=input.replace(/,/g,'');
    const negative=s[0]==='-',a=s.replace(/^-/,'').split('.');const n=Number(a[0])*100+Number((a[1]||'').padEnd(2,'0'));
    return Number.isSafeInteger(n)?(negative?-n:n):null;
  }
  function stable(v){
    if(v===null||['string','boolean'].includes(typeof v))return JSON.stringify(v);
    if(typeof v==='number'){if(!Number.isFinite(v))fail('A review contains a nonfinite number.');return JSON.stringify(v);}
    if(Array.isArray(v))return '['+v.map(stable).join(',')+']';
    if(v&&typeof v==='object')return '{'+Object.keys(v).filter(k=>v[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';
    fail('A review contains an unsupported value.');
  }
  function portalUrl(v){
    let u;try{u=new URL(text(v)||'https://app.fpg-ingauge.com/');}catch(_){fail('Enter a valid IN-Gauge HTTPS URL.');}
    if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.port||!(u.hostname==='fpg-ingauge.com'||u.hostname.endsWith('.fpg-ingauge.com')))fail('Use an IN-Gauge HTTPS address without a password, query or fragment.');
    return u.origin+u.pathname.replace(/\/+$/,'')+'/';
  }
  function binding(v){
    if(!v||!numId(v.tenantId)||!numId(v.propertyId)||!numId(v.departmentId)||!text(v.property)||!text(v.department))fail('Choose and confirm the exact IN-Gauge hotel and department.');
    return {portalUrl:portalUrl(v.portalUrl),tenantId:id(v.tenantId),propertyId:id(v.propertyId),departmentId:id(v.departmentId),property:text(v.property),department:text(v.department)};
  }
  function sameBinding(a,b){try{return stable(binding(a))===stable(binding(b));}catch(_){return false;}}
  function humanLoginMatch(query,name,fold=false){
    const q=login(query),w=words(name),f=s=>fold?s.replace(/([A-Z])\1+/g,'$1'):s;
    if(!q||!w.length||/\d/.test(q))return false;
    if(sameName(query,name))return true;
    // Two full display names never become one person merely because a surname matches.
    if(!/[-@]/.test(text(query))&&words(query).length>1)return false;
    return w.some((part,i)=>{
      if(part.length<4)return false;
      const prefixes=['',w[0][0],w.slice(0,i).map(x=>x[0]).join(''),w.slice(0,i).join('')];
      return prefixes.some(p=>f(q)===f(p+part));
    });
  }
  function resolveSeller(query,people,aliases=[]){
    const pool=(people||[]).filter(p=>numId(p.id)&&text(p.name));
    const finish=(hits,reason)=>{
      const unique=[...new Map(hits.map(p=>[id(p.id),p])).values()];
      if(unique.length!==1)return {state:unique.length?'ambiguous':'unmatched',candidates:unique,reason:unique.length?'More than one contributor matches. Select the contributor ID.':reason};
      return {state:'matched',person:unique[0],candidates:unique,reason};
    };
    const q=text(query);if(!q)return finish([],'No seller was provided.');
    const exact=pool.filter(p=>id(p.id)===id(q)||key(p.pulseId)&&key(p.pulseId)===key(q));
    if(exact.length)return finish(exact,'Exact contributor identifier.');
    const named=pool.filter(p=>sameName(q,p.name));if(named.length)return finish(named,'Exact IN-Gauge name.');
    const saved=aliases.filter(a=>(a.logins||[]).some(l=>login(l)===login(q)));
    if(saved.length){const hits=pool.filter(p=>saved.some(a=>a.contributorId?id(a.contributorId)===id(p.id):sameName(a.name,p.name)));return finish(hits,'Confirmed login alias for this hotel.');}
    const matched=pool.filter(p=>humanLoginMatch(q,p.name));if(matched.length)return finish(matched,'Unique login match to a first, middle or family name.');
    const suggestions=pool.filter(p=>humanLoginMatch(q,p.name,true));
    if(suggestions.length)return {state:'suggested',candidates:suggestions,reason:'A repeated-letter spelling differs. Confirm an alias or choose the contributor ID.'};
    return finish([],'No unique contributor matches this Opera login.');
  }
  function kind(v){
    const s=key(v),compact=s.replace(/ /g,'');
    if(/(?:EC$|^1061$)/.test(compact)||['EARLYCHECKIN','EARLYARRIVAL'].includes(compact))return 'EC';
    if(/(?:LC$|^1062$)/.test(compact)||['LATECHECKOUT','LATEDEPARTURE'].includes(compact))return 'LC';
    if(/BB$|^BB|BREAKFAST/.test(compact)||compact==='2090')return 'BB';
    if(/DIN$|^DINNER$/.test(compact))return 'DIN';if(/^HB|HALFBOARD/.test(compact))return 'HB';if(/^FB|FULLBOARD/.test(compact))return 'FB';
    if(/^USS\d+$/.test(compact)||/^ROOMUPGRADE$|^STANDARDROOM|^CLASSICROOM|^SUPERIOR(?:FAMILY)?ROOM|^PRIVILEGEROOM|^STUDIO(?:WITH|WITHOUT)|^(?:ONE|TWO|THREE|\d+)BEDROOMAPARTMENT/.test(compact))return 'ROOM';
    return '';
  }
  function resolveProduct(proposal,products){
    const pool=(products||[]).filter(p=>p.activeStatus==='NORMAL'&&!/UNKNOWN|UNMAPPED/.test(key(p.code+' '+p.name)));
    let hits=[];
    if(proposal.productId)hits=pool.filter(p=>id(p.id)===id(proposal.productId));
    else if(proposal.sku)hits=pool.filter(p=>key(p.sku)===key(proposal.sku));
    else if(proposal.code&&pool.some(p=>text(p.code)===text(proposal.code)))hits=pool.filter(p=>text(p.code)===text(proposal.code));
    else if(proposal.label&&pool.some(p=>key(p.name)===key(proposal.label)))hits=pool.filter(p=>key(p.name)===key(proposal.label));
    else{const k=proposal.kind||kind(proposal.code)||kind(proposal.label);if(k)hits=pool.filter(p=>kind(p.code)||kind(p.name)?(kind(p.code)||kind(p.name))===k:false);}
    return hits.length===1?{state:'matched',product:hits[0],candidates:hits}:{state:hits.length?'ambiguous':'unmatched',candidates:hits};
  }
  function flatten(raw){let map=raw.jsonMap||{};if(typeof map==='string'){try{map=JSON.parse(map);}catch(_){fail('IN-Gauge returned an unreadable record.');}}return {...raw,...map};}
  function record(raw){
    const r=flatten(raw),dateValue=k=>day(r[k]);
    if(!numId(r.id)||!text(r.confirmationNumber))fail('A live record is missing its identifier or confirmation.');
    return {id:id(r.id),confirmation:text(r.confirmationNumber),propertyId:id(r.tenantLocationId),departmentId:id(r.locationGroupId),productId:id(r.locationGroupProductId||r.product?.id||r.product?.intId),contributorId:id(r.userId||r.user?.id||r.user?.intId||''),product:text(r.pname||r.locationGroupProductName||r.productName||r.product?.name),seller:text(r.userName||r.employeeName),status:text(r.auditStatus).toUpperCase(),unitCents:cents(r.upsellCharge),totalCents:cents(r.totalUpsellAmount),chargeDays:Number(r.roomNights||1),arrival:dateValue('arrivalDate'),departure:dateValue('departureDate'),businessDate:dateValue('businessDate')||dateValue('metricDate'),room:text(r.roomNumber),memo:text(r.memo),updatedOn:r.updatedOn??null,isManuallyAddedRecord:r.isManuallyAddedRecord===true||r.isManuallyAddedRecord==='true',raw:r};
  }
  function fingerprint(r){return stable({id:r.id,confirmation:r.confirmation,propertyId:r.propertyId,departmentId:r.departmentId,productId:r.productId,contributorId:r.contributorId,status:r.status,unitCents:r.unitCents,totalCents:r.totalCents,chargeDays:r.chargeDays,arrival:r.arrival,departure:r.departure,businessDate:r.businessDate,room:r.room,memo:r.memo,updatedOn:r.updatedOn});}
  function amountTotal(values,product,settings){
    const unit=values.unitCents,days=values.chargeDays;
    if(!product||typeof product.recurring!=='boolean')fail('Choose a verified product first.');
    if(!Number.isSafeInteger(unit)||unit<0||!Number.isSafeInteger(days)||days<1||days>3660)fail('Enter a nonnegative unit amount and valid charge days.');
    if(!['ARRIVAL_DATE','DEPARTURE_DATE','BUSINESS_DATE'].includes(settings.validation))fail('The hotel charge-date validation setting is not verified. Refresh IN-Gauge.');
    const total=unit*(product.recurring&&settings.validation!=='BUSINESS_DATE'?days:1);
    if(!Number.isSafeInteger(total)||total>1000000000)fail('The proposed total is outside the supported range.');return total;
  }
  function operationError(op,snapshot){
    try{
      if(!['add','edit','approve','deny','delete'].includes(op.action))fail('Choose a supported operation.');
      const before=snapshot.records.find(r=>r.id===id(op.recordId));
      if(op.action!=='add'){
        if(!before||op.expected!==fingerprint(before))fail('The selected record no longer matches the fetched snapshot.');
        if(before.propertyId!==snapshot.binding.propertyId||before.departmentId!==snapshot.binding.departmentId)fail('This record belongs to a different hotel or department.');
        if(!editable.has(before.status)&&!(op.action==='delete'&&before.status==='DENIED'))fail('Locked, invoiced, adjusted or removed records need their dedicated IN-Gauge workflow.');
        if(op.action==='edit'&&before.status==='DENIED'&&text(op.reason).length<5)fail('Explain why this denied request should be reopened.');
        if(op.action==='approve'&&before.status!=='PENDING')fail('Only an existing Pending request can be approved here.');
        if(op.confirmation!==before.confirmation)fail('A reviewed operation cannot change its reservation identity.');
      }else if(!/^\d+$/.test(text(op.confirmation))||!text(op.transaction))fail('A missing sale needs its confirmation and Opera transaction.');
      if(op.action==='approve'){
        const p=snapshot.products.find(p=>p.id===before.productId),person=snapshot.contributors.find(p=>p.id===before.contributorId);
        if(!p||p.activeStatus!=='NORMAL'||/UNKNOWN|UNMAPPED/.test(key(p.code+' '+p.name))||!person)fail('Identify the product and contributor before approving this request.');
        if(before.totalCents!==amountTotal(values(before),p,snapshot.settings))fail('Review this request’s configured charge calculation before approval.');
      }
      if(['deny','delete'].includes(op.action)&&text(op.reason).length<5)fail('Enter a clear reason for this denial or removal.');
      if(['add','edit'].includes(op.action)){
        const p=snapshot.products.find(p=>p.id===id(op.productId));if(!p||p.activeStatus!=='NORMAL'||/UNKNOWN|UNMAPPED/.test(key(p.code+' '+p.name)))fail('Choose an active, identified product from this hotel.');
        if(op.requireAssignment&&!op.assignmentReviewed)fail('Review and explicitly assign the seller before selecting this sale.');
        const person=snapshot.contributors.find(p=>p.id===id(op.contributorId));
        if(!before||before.contributorId!==id(op.contributorId)){if(!person||person.activeStatus!=='NORMAL')fail('Choose an active contributor assigned to this hotel.');}
        if(before&&before.contributorId!==id(op.contributorId)&&!snapshot.permissions.canReassign)fail('This account cannot reassign contributors.');
        const v=op.values;if(!v||!day(v.businessDate)||!day(v.departure)||!day(v.arrival))fail('Confirm the arrival, departure and business dates.');
        if(v.arrival>v.departure)fail('Departure cannot be before arrival.');
        if(v.businessDate<snapshot.from||v.businessDate>snapshot.to)fail('The business date is outside the fetched audit period.');
        if(v.totalCents!==amountTotal(v,p,snapshot.settings))fail('The proposed total does not match this product’s configured charge calculation.');
        if(snapshot.settings.maxChargeCents>0&&v.unitCents>snapshot.settings.maxChargeCents)fail('The product charge exceeds this hotel’s configured limit.');
        if(!['PENDING','APPROVED'].includes(op.statusAfter))fail('Choose Pending or Approved as the resulting status.');
        if(op.statusAfter==='APPROVED'&&!snapshot.permissions.canApprove)fail('This account cannot approve requests.');
      }
      const permission={add:'canAdd',edit:'canEdit',approve:'canApprove',deny:'canDeny',delete:'canDelete'}[op.action];
      if(!snapshot.permissions[permission])fail('The connected account lacks permission for '+op.action+'.');
      return '';
    }catch(error){return error.message;}
  }
  function saleCategory(record){return record&&(record.isManuallyAddedRecord||record.status==='PENDING')?'manual':'automatic';}
  function operationCategory(op,snapshot){return op.action==='add'?'manual':saleCategory(snapshot.records.find(r=>r.id===id(op.recordId)));}
  function scopeAllows(scope,category){return ['manual','automatic','all'].includes(scope)&&['manual','automatic'].includes(category)&&(scope==='all'||scope===category);}
  function validatePlan(plan,snapshot){
    if(!plan||plan.schema!==2||plan.mode!=='apply'||!snapshot||!snapshot.complete||snapshot.invalidatedAt||!snapshot.pagination?.verified||snapshot.pagination.total!==snapshot.records.length||snapshot.pagination.read!==snapshot.records.length||!sameBinding(plan.binding,snapshot.binding)||plan.snapshotId!==snapshot.id||plan.hotelId!==snapshot.hotelId)fail('Refresh live IN-Gauge to fetch and verify every page for this hotel before reviewing changes.');
    if(!Array.isArray(plan.operations)||!plan.operations.length||plan.operations.length>100)fail('Select between 1 and 100 reviewed operations.');
    const scope=plan.scope||'all';if(!['manual','automatic','all'].includes(scope))fail('Choose Manual upsells, Automatic packages or Both.');
    const seen=new Set();for(const op of plan.operations){if(!scopeAllows(scope,operationCategory(op,snapshot)))fail('A selected change is outside your chosen audit mode. Choose the matching mode and review again.');const error=operationError(op,snapshot);if(error)fail(error);const k=op.action==='add'?'new:'+op.transaction:'record:'+op.recordId;if(seen.has(k))fail('A record or Opera transaction appears more than once in this plan.');seen.add(k);}
    return plan;
  }
  function values(r){return {unitCents:r.unitCents,totalCents:r.totalCents,chargeDays:r.chargeDays,arrival:r.arrival,departure:r.departure,businessDate:r.businessDate,room:r.room,memo:r.memo};}
  function payload(op,snapshot,current){
    const error=operationError(op,snapshot);if(error)fail(error);if(!['add','edit'].includes(op.action))fail('This action changes audit status, not product data.');
    const v=op.values,ms=s=>new Date(s+'T00:00:00Z').getTime();
    const body={mapTo:'PRODUCTMETRIC',industryId:Number(snapshot.settings.industryId),activeStatus:'NORMAL',tenantLocationId:Number(snapshot.binding.propertyId),locationGroupId:Number(snapshot.binding.departmentId),userId:Number(op.contributorId||0),locationGroupProductId:Number(op.productId),confirmationNumber:op.confirmation,upsellCharge:v.unitCents/100,totalUpsellAmount:v.totalCents/100,roomNights:v.chargeDays,arrivalDate:ms(v.arrival),departureDate:ms(v.departure),businessDate:ms(v.businessDate),metricDate:ms(v.businessDate),roomNumber:text(v.room),memo:text(v.memo),auditStatus:op.statusAfter};
    if(op.action==='add')body.isManuallyAddedRecord=true;
    if(op.action==='edit'){
      if(!current||fingerprint(current)!==op.expected)fail('The live record changed after review. Refresh and review it again.');
      body.id=Number(current.id);for(const k of ['jsonData','isError','isManuallyAddedRecord','originalRate','newRate','uniqueId','invoiceId','marketSegment','newRoomType','originalRoomType'])if(current.raw[k]!==undefined)body[k]=current.raw[k];
    }
    return body;
  }
  function auditParams(op){if(!['approve','deny','delete'].includes(op.action)||!numId(op.recordId))fail('Invalid audit-status operation.');return {entityIDs:id(op.recordId),isReview:'false',isLock:'false',isDeny:String(op.action==='deny'),isDelete:String(op.action==='delete'),denialNotes:op.action==='approve'?'Approved':text(op.reason),entityType:'PRODUCT_METRIC'};}
  function duplicates(op,records,products){
    const product=products.find(p=>p.id===id(op.productId)),once=product&&['EC','LC'].includes(kind(product.code)||kind(product.name));
    return records.filter(r=>r.confirmation===op.confirmation&&(r.productId===id(op.productId)||!r.productId||/UNKNOWN|UNMAPPED/.test(key(r.product)))&&(once||r.businessDate===op.values?.businessDate));
  }
  function differences(op,r,b){
    const expectedStatus=({approve:'APPROVED',deny:'DENIED',delete:'PURGED'})[op.action]||op.statusAfter;
    const expected={confirmation:op.confirmation,productId:id(op.productId),contributorId:id(op.contributorId),status:expectedStatus,...op.values,...(b?{propertyId:b.propertyId,departmentId:b.departmentId}:{})};
    return Object.entries(expected).filter(([field,value])=>stable(value)!==stable(r[field])&&!(field==='memo'&&value===''&&r.memo==='APPROVED'&&r.status==='APPROVED'&&['add','edit','approve'].includes(op.action))).map(([field,value])=>({field,expected:value??null,actual:r[field]??null}));
  }
  function matches(op,r){
    return differences(op,r).length===0;
  }
  const api={text,id,key,day,cents,stable,portalUrl,binding,sameBinding,humanLoginMatch,resolveSeller,resolveProduct,kind,flatten,record,fingerprint,amountTotal,operationError,validatePlan,values,payload,auditParams,duplicates,matches,differences,terminal,saleCategory,operationCategory,scopeAllows};
  root.InGaugeAuditCore=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
