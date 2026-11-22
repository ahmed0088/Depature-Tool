// Financial review model shared by HotelOps and its cloud worker. No I/O.
(function(root){
  'use strict';
  const text=v=>String(v??'').trim(), id=v=>text(v).replace(/\.0+$/,''), numId=v=>/^\d+$/.test(id(v))&&Number.isSafeInteger(Number(id(v)))&&Number(id(v))>0;
  const key=v=>text(v).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
  const words=v=>key(v).split(' ').filter(Boolean), login=v=>key(text(v).split('@')[0].split('-').pop()).replace(/ /g,'');
  const sameName=(a,b)=>words(a).sort().join(' ')===words(b).sort().join(' ');
  const terminal=new Set(['DENIED','PURGED']), editable=new Set(['PENDING','APPROVED','REVIEWED','ERROR','DENIED']);
  // REVIEWED settles seller credit; its charge still contributes to revenue.
  // Reporting eligibility does not grant edit/approval rights or unlock records.
  const isRevenueStatus=value=>['APPROVED','REVIEWED'].includes(text(value).toUpperCase());
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
  // Provider amounts can contain fractional cents. Currency reports use decimal
  // HALF_UP; user input and every financial operation still use strict cents().
  function reportingCents(value){
    if(typeof value!=='string'&&typeof value!=='number')return null;
    if(typeof value==='number'&&!Number.isFinite(value))return null;
    const exact=cents(value);if(Number.isSafeInteger(exact))return exact;
    const input=text(value);if(!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(input)||input.length>100)return null;
    const negative=input.startsWith('-'),[whole,fraction='']=input.replace(/,/g,'').replace(/^-/,'').split('.');
    let amount=BigInt(whole)*100n+BigInt((fraction+'00').slice(0,2));if((fraction[2]||'0')>='5')amount++;
    if(negative)amount=-amount;if(amount>BigInt(Number.MAX_SAFE_INTEGER)||amount<BigInt(Number.MIN_SAFE_INTEGER))return null;
    return Number(amount);
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
  function journalMapping(options={}){
    const breakfast=options.breakfastCode===undefined?'2090':options.breakfastCode;
    if(typeof breakfast!=='string'||!/^\d{1,10}$/.test(breakfast.trim())||Number(breakfast)===0)fail('Enter a numeric Opera breakfast transaction code.');
    const code=breakfast.trim();if(['1010','1061','1062'].includes(code))fail('The breakfast code conflicts with room upselling, early check-in or late checkout. Choose a different code.');
    return {'1010':'ROOM','1061':'EC','1062':'LC',[code]:'BB'};
  }
  function kind(v){
    const s=key(v),compact=s.replace(/ /g,'');
    if(/(?:EC$|^1061$)/.test(compact)||['EARLYCHECKIN','EARLYARRIVAL'].includes(compact))return 'EC';
    if(/(?:LC$|^1062$)/.test(compact)||['LATECHECKOUT','LATEDEPARTURE'].includes(compact))return 'LC';
    if(/BB$|^BB|BREAKFAST/.test(compact)||compact==='2090')return 'BB';
    if(/DIN$|^DINNER$/.test(compact))return 'DIN';if(/^HB|HALFBOARD/.test(compact))return 'HB';if(/^FB|FULLBOARD/.test(compact))return 'FB';
    if(/^(?:1010|ROOMUPSELL(?:ING)?|ROOMUPGRADE|USS\d+)$/.test(compact)||/^STANDARDROOM|^CLASSICROOM|^SUPERIOR(?:FAMILY)?ROOM|^PRIVILEGEROOM|^STUDIO(?:WITH|WITHOUT)|^(?:ONE|TWO|THREE|\d+)BEDROOMAPARTMENT/.test(compact))return 'ROOM';
    return '';
  }
  function recordFamily(record,products){const product=products.find(p=>p.id===record.productId);return kind(record.product)||kind(product?.name)||kind(product?.code);}
  const familyLabel=family=>({EC:'Early check-in',LC:'Late checkout',BB:'Breakfast',ROOM:'Room upselling',DIN:'Dinner',HB:'Half board',FB:'Full board'})[family]||'';
  const journalIds=value=>[...new Set([...text(value).matchAll(/\bOpera\s+journal\s+(\d+)\b/gi)].map(m=>m[1]))];
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
  function reportingRecord(value){
    if(!value||Number.isSafeInteger(value.unitCents)&&Number.isSafeInteger(value.totalCents)||!value.raw)return value;
    let original;try{original=record(value.raw);}catch(_){return value;}
    const identity=['id','confirmation','propertyId','departmentId','productId','contributorId','status','chargeDays','arrival','departure','businessDate','room','memo','updatedOn'];
    if(!identity.every(k=>stable(original[k]??null)===stable(value[k]??null)))return value;
    for(const k of ['unitCents','totalCents']){const rawField=k==='unitCents'?'upsellCharge':'totalUpsellAmount',sourceAmount=reportingCents(original.raw[rawField]);if(Number.isSafeInteger(value[k])&&Number.isSafeInteger(sourceAmount)&&value[k]!==sourceAmount)return value;}
    const patch={},amountRounding={};
    for(const [field,source] of [['unitCents','upsellCharge'],['totalCents','totalUpsellAmount']]){
      if(Number.isSafeInteger(value[field]))continue;const amount=reportingCents(original.raw[source]);if(!Number.isSafeInteger(amount))continue;
      patch[field]=amount;amountRounding[field]={source:text(original.raw[source]),cents:amount};
    }
    return Object.keys(patch).length?{...value,...patch,reportingOnly:true,amountRounding}:value;
  }
  const recordAmountIssue=r=>'IN-Gauge record #'+text(r?.id)+' (confirmation '+text(r?.confirmation||'unavailable')+', '+text(r?.product||'product unavailable')+') has no valid total amount. Refresh IN-Gauge and check that entry. No zero amount was assumed.';
  function reportingMessage(snapshot){
    const p=snapshot?.reporting;if(p?.status!=='available'||!Number.isFinite(p.processedAt)||p.processedAt<=0)return '';
    const when=new Date(p.processedAt).toLocaleString('en-GB',{timeZone:'Asia/Dubai'});
    return 'IN-Gauge dashboard processed through '+when+' Dubai time.'+(Number.isSafeInteger(p.updatedAfterProcessing)&&p.updatedAfterProcessing>0?' '+p.updatedAfterProcessing+' accepted sale rows were updated after that run. The dashboard can differ until IN-Gauge processes those changes.':' The dashboard is a processed reporting view; these totals use current sale records.');
  }
  function fingerprint(r){
    const unparsedAmounts={};
    if(!Number.isSafeInteger(r.unitCents))unparsedAmounts.unit=text(r.raw?.upsellCharge);
    if(!Number.isSafeInteger(r.totalCents))unparsedAmounts.total=text(r.raw?.totalUpsellAmount);
    return stable({id:r.id,confirmation:r.confirmation,propertyId:r.propertyId,departmentId:r.departmentId,productId:r.productId,contributorId:r.contributorId,status:r.status,unitCents:r.unitCents??null,totalCents:r.totalCents??null,chargeDays:r.chargeDays,arrival:r.arrival,departure:r.departure,businessDate:r.businessDate,room:r.room,memo:r.memo,updatedOn:r.updatedOn,...(Object.keys(unparsedAmounts).length?{unparsedAmounts}:{})});
  }

  function amountTotal(values,product,settings){
    const unit=values.unitCents,days=values.chargeDays;
    if(!product||typeof product.recurring!=='boolean')fail('Choose a verified product first.');
    if(!Number.isSafeInteger(unit)||unit<0||!Number.isSafeInteger(days)||days<1||days>3660)fail('Enter a nonnegative unit amount and valid charge days.');
    if(!['ARRIVAL_DATE','DEPARTURE_DATE','BUSINESS_DATE'].includes(settings.validation))fail('The hotel charge-date validation setting is not verified. Refresh IN-Gauge.');
    const total=unit*(product.recurring&&settings.validation!=='BUSINESS_DATE'?days:1);
    if(!Number.isSafeInteger(total)||total>1000000000)fail('The proposed total is outside the supported range.');return total;
  }
  function withinPeriod(value,period){return !!(day(value)&&day(period?.from)&&day(period?.to)&&period.from<=period.to&&period.from<=value&&value<=period.to);}
  function operationPeriodError(op,snapshot,period){
    const selected=period===undefined?{from:snapshot?.from,to:snapshot?.to}:period;
    if(!day(selected?.from)||!day(selected?.to)||selected.from>selected.to)return 'Choose a valid audit period before reviewing changes.';
    const before=snapshot?.records?.find(r=>r.id===id(op.recordId)),sourceDate=op.action==='add'?op.values?.businessDate:before?.businessDate;
    if(!withinPeriod(sourceDate,snapshot)||!withinPeriod(sourceDate,selected))return 'The original posting business date is missing or outside the selected audit period. Choose that period explicitly to review this sale.';
    if(['add','edit'].includes(op.action)&&(!withinPeriod(op.values?.businessDate,snapshot)||!withinPeriod(op.values?.businessDate,selected)))return 'The proposed business date is outside the selected audit period.';
    return '';
  }
  function journalDate(value){
    const iso=day(value);if(iso)return iso;
    const m=text(value).match(/^(\d{1,2})[-/.]([A-Za-z]{3}|\d{1,2})[-/.](\d{2}|\d{4})$/);if(!m)return '';
    const month=/^\d+$/.test(m[2])?Number(m[2]):'JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' ').indexOf(m[2].toUpperCase())+1;
    return day((m[3].length===2?'20':'')+m[3]+'-'+String(month).padStart(2,'0')+'-'+m[1].padStart(2,'0'));
  }
  const isPmRoom=v=>/^\d+$/.test(text(v))&&Number(v)>=9000;
  function pmOwner(raw,reservations,snapshot,dateOf){
    if(!isPmRoom(raw.ROOM))return null;
    const normalize=v=>key(v).replace(/\b(MR|MRS|MS|MISS|DR|MSTR|MASTER|PROF)\b/g,' ').split(' ').filter(Boolean).sort().join(' '),room=v=>text(v).replace(/^0+(?=\d)/,''),note=[raw.REFERENCE,raw.REMARK,raw.CREDIT_CARD_SUPPLEMENT].map(text).join(' '),physical=new Set();
    for(const m of note.matchAll(/#\s*(\d+)\s*(?:=>|→|->)[^#\[\]]*#\s*(\d+)/g)){const a=room(m[1]),b=room(m[2]);if([a,b].includes(room(raw.ROOM))&&isPmRoom(a)!==isPmRoom(b))physical.add(isPmRoom(a)?b:a);}
    const original=physical.size===1?[...physical][0]:'',day=dateOf(raw.BUSINESS_DATE),guest=normalize(raw.GUEST_FULL_NAME),explicit=text(raw.CONFIRMATION_NO||raw.CONFIRMATION_NUMBER),matches=[];
    if(original&&guest&&day)for(const r of reservations||[]){const conf=text(r.CONFIRMATION_NO),arrival=dateOf(r.TRUNC_BEGIN),departure=dateOf(r.TRUNC_END),rr=room(r.ROOM_NO||r.DISP_ROOM_NO);if(!/^\d+$/.test(conf)||isPmRoom(rr)||normalize(r.FULL_NAME)!==guest||!arrival||!departure||arrival>day||day>departure||!['CKIN','CKOT','DUEIN','DUEOUT','DUOT'].includes(text(r.SHORT_RESV_STATUS))||explicit&&conf!==explicit)continue;
      const recorded=(snapshot?.records||[]).some(x=>x.confirmation===conf&&room(x.room)===original&&x.propertyId===snapshot.binding.propertyId&&x.departmentId===snapshot.binding.departmentId&&x.businessDate>=arrival&&x.businessDate<=departure);
      if(rr===original||recorded)matches.push({confirmation:conf,arrival,departure,roomType:text(r.ROOM_CATEGORY_LABEL)});
    }
    let unique=[...new Map(matches.map(x=>[x.confirmation,x])).values()],night=false;if(unique.length>1&&/\[NA\s+Pkgs\./i.test(note)){const nights=unique.filter(x=>day<x.departure);if(nights.length===1){unique=nights;night=true;}}const owner=unique.length===1?unique[0]:null;
    return {pm:true,pmRoom:text(raw.ROOM),room:original,confirmation:owner?.confirmation||'',arrival:owner?.arrival||'',departure:owner?.departure||'',roomType:owner?.roomType||'',candidates:unique.map(x=>x.confirmation),reason:owner?(night?'Automatic night posting: ':'')+'PM '+text(raw.ROOM)+' holds the charge for original room '+original+'. Keep the original guest booking; no new PM sale is needed.':'PM holding account. Verify the transfer reference and original booking; do not create a sale for the PM room.'};
  }
  function operationError(op,snapshot,period){
    try{
      if(!['add','edit','approve','deny','delete'].includes(op.action))fail('Choose a supported operation.');
      const before=snapshot.records.find(r=>r.id===id(op.recordId));
      if(op.action!=='add'){
        if(!before||op.expected!==fingerprint(before))fail('The selected record no longer matches the fetched snapshot.');
        if(before.reportingOnly)fail('A rounded reporting view cannot authorize financial changes. Review the original IN-Gauge record.');
        if(before.propertyId!==snapshot.binding.propertyId||before.departmentId!==snapshot.binding.departmentId)fail('This record belongs to a different hotel or department.');
        if(!editable.has(before.status)&&!(op.action==='delete'&&before.status==='DENIED'))fail('Locked, invoiced, adjusted or removed records need their dedicated IN-Gauge workflow.');
        if(op.action==='edit'&&before.status==='DENIED'&&text(op.reason).length<5)fail('Explain why this denied request should be reopened.');
        if(op.action==='approve'&&before.status!=='PENDING')fail('Only an existing Pending request can be approved here.');
        if(op.confirmation!==before.confirmation)fail('A reviewed operation cannot change its reservation identity.');
      }else if(!/^\d+$/.test(text(op.confirmation))||!text(op.transaction))fail('A missing sale needs its confirmation and Opera transaction.');
      const dateIssue=operationPeriodError(op,snapshot,period);if(dateIssue)fail(dateIssue);
      if(op.recordReview){const issue=recordReviewError(op,snapshot);if(issue)fail(issue);}
      if(op.action==='add'){const existing=snapshot.records.filter(r=>journalIds(r.memo).includes(text(op.transaction)));if(existing.length)fail('Opera transaction '+text(op.transaction)+' already exists in IN-Gauge as record '+existing.map(r=>r.id).join(', ')+'. Review the existing entry and product instead of adding it again.');}
      if(op.reconciliation){const proof=op.reconciliation;
        const unsupported=op.action==='deny'&&proof.role==='unsupported'&&['ingauge-only','reversed'].includes(proof.kind)&&proof.journalCents===0&&(proof.kind==='reversed'?proof.journalIds?.length>1:proof.coverageVerified===true);
        if(proof.schema!==1||proof.snapshotId!==snapshot.id||proof.reviewed!==true||!text(proof.key)||!Array.isArray(proof.journalIds)||(!proof.journalIds.length&&!unsupported)||proof.journalIds.some(v=>!/^\d+$/.test(String(v)))||!Number.isSafeInteger(proof.journalCents)||(proof.journalCents<=0&&!unsupported)||text(proof.currency).toUpperCase()!==text(snapshot.settings.currency).toUpperCase())fail('Check the Opera evidence, amount, confirmation and credit before saving this correction.');
        if(proof.role==='unsupported'&&(!unsupported||!before||!proof.recordIds?.includes(before.id)))fail('Review the existing entry and Opera coverage before denying this sale.');
        if(proof.kind==='split-missing'){
          const posts=proof.postings,ids=proof.journalIds.map(text),v=op.values;
          if(op.action!=='add'||proof.recordIds?.length||!Array.isArray(posts)||posts.length<2||posts.length>100||posts.some(p=>!p||typeof p!=='object')||new Set(ids).size!==posts.length||!ids.includes(text(op.transaction))||stable(posts.map(p=>text(p.id)).sort())!==stable(ids.slice().sort())||!op.requireAssignment||!op.assignmentReviewed||id(op.assignmentContributorId)!==id(op.contributorId))fail('Confirm every included charge, the booking and one seller before selecting this combined sale.');
          if(!Array.isArray(proof.bookings)||proof.bookings.length!==posts.length||proof.bookings.some(b=>!b||typeof b!=='object')||new Set(proof.bookings.map(b=>b.transaction)).size!==posts.length||posts.some(p=>!proof.bookings.some(b=>b.transaction===p.id&&b.sourceSignature===p.sourceSignature&&b.arrival===p.arrival&&b.departure===p.departure)))fail('Keep a verified booking link for every included Opera charge.');
          let total=0;for(const p of posts){
            if(!Number.isSafeInteger(p.cents)||p.cents<=0||p.confirmation!==op.confirmation||p.day!==v?.businessDate||!withinPeriod(p.day,proof.period)||p.currency!==proof.currency||p.arrival!==v.arrival||p.departure!==v.departure||text(p.room)!==text(v.room))fail('The combined source amount, booking, posting day or stay changed. Review these charges again.');
            let raw;try{raw=JSON.parse(p.sourceSignature);}catch(_){fail('The original Opera evidence is missing. Refresh the reports.');}
            if(!raw||typeof raw!=='object'||Array.isArray(raw))fail('The original Opera evidence is unreadable. Refresh the reports.');
            const debit=cents(text(raw.CASHIER_DEBIT)||'0'),credit=cents(text(raw.CASHIER_CREDIT)||'0');
            if(debit===null||credit===null||text(raw.TRX_NO)!==text(p.id)||text(raw.TRX_CODE)!==text(p.code)||journalDate(raw.BUSINESS_DATE)!==p.day||debit-credit!==p.cents||text(raw.CURRENCY1).toUpperCase()!==p.currency||text(raw.GUEST_FULL_NAME)!==text(p.guest)||text(raw.ROOM)!==text(p.room)||/\[NA\s+Pkgs\./i.test(text(raw.REFERENCE)+' '+text(raw.REMARK)))fail('The original Opera posting does not support this combined manual sale.');
            if(p.namedContributorId&&id(p.namedContributorId)!==id(op.contributorId)&&text(op.reason).length<5)fail('Explain any change from a seller named on an included Opera posting.');
            total+=p.cents;if(!Number.isSafeInteger(total))fail('The combined charge is outside the supported amount range.');
          }
          if(total!==proof.journalCents||v?.unitCents!==total||v.totalCents!==total||v.chargeDays!==1||stable(journalIds(v.memo).sort())!==stable(ids.slice().sort()))fail('Keep the exact sum, one charge day and every Opera transaction link for this combined sale.');
          if(snapshot.records.some(r=>journalIds(r.memo).some(tx=>ids.includes(tx))||r.confirmation===op.confirmation&&r.businessDate===v.businessDate&&(!recordFamily(r,snapshot.products)||recordFamily(r,snapshot.products)===proof.family)))fail('An included Opera posting already has an IN-Gauge request. Refresh and review that existing entry.');
        }
        const sourceDay=before?.businessDate||op.values?.businessDate;if(!withinPeriod(sourceDay,proof.period))fail('This correction was prepared for another posting period. Review it again.');
        if(proof.booking){const b=proof.booking;if(b.schema!==1||b.verified!==true||b.confirmation!==op.confirmation||b.snapshotId!==snapshot.id||!sameBinding(b.binding,snapshot.binding)||stable(b.period)!==stable(proof.period)||!proof.journalIds.includes(b.transaction)||!text(b.sourceSignature)||!day(b.arrival)||!day(b.departure)||b.arrival>b.departure||!withinPeriod(b.day,proof.period)||op.values?.businessDate!==b.day)fail('Recheck the manually entered booking and keep the original Opera posting date.');}
        if(proof.bookings&&(!Array.isArray(proof.bookings)||proof.bookings.some(b=>b.schema!==1||b.verified!==true||b.confirmation!==op.confirmation||b.snapshotId!==snapshot.id||!sameBinding(b.binding,snapshot.binding)||stable(b.period)!==stable(proof.period)||!proof.journalIds.includes(b.transaction)||!text(b.sourceSignature)||b.day!==op.values?.businessDate||!day(b.arrival)||!day(b.departure)||b.arrival>b.departure)))fail('Recheck every selected posting against this booking.');
        if(op.action==='edit'&&before&&stable(values(before))!==stable(op.values)&&journalIds(before.memo).some(tx=>!proof.journalIds.includes(tx)))fail('This entry already represents another Opera posting. Review all linked postings together; one charge must not replace another.');
        if(proof.role==='extra'&&op.action!=='deny'||proof.role==='keep'&&op.action!=='edit')fail('Review the one-off duplicate action again.');
        if(proof.kind==='duplicate'&&(!Array.isArray(proof.recordIds)||proof.recordIds.length<2||!proof.recordIds.includes(op.recordId)||proof.recordIds.some(id=>{const r=snapshot.records.find(r=>r.id===id);return !r||r.confirmation!==op.confirmation||r.propertyId!==snapshot.binding.propertyId||r.departmentId!==snapshot.binding.departmentId||!withinPeriod(r.businessDate,proof.period);})))fail('Refresh the exact duplicate entries before reviewing this action.');
        if(proof.role==='keep'&&op.productId!==before?.productId)fail('Review a product replacement separately from retaining a one-off entry.');
        if(['add','edit'].includes(op.action)&&op.values?.totalCents!==proof.journalCents&&text(op.reason).length<5)fail('Explain why the reviewed amount differs from the Opera posting.');
      }
      const expectedFamily=op.journalFamily||op.reconciliation?.family;
      if(expectedFamily&&['add','edit','approve'].includes(op.action)){
        if(!familyLabel(expectedFamily))fail('Review the Opera transaction-code mapping again.');
        const product=snapshot.products.find(p=>p.id===id(op.action==='approve'?before?.productId:op.productId));
        if(product&&(kind(product.name)||kind(product.code))!==expectedFamily)fail('Opera '+(op.journalCodes||op.reconciliation?.codes||[]).join(', ')+' is mapped to '+familyLabel(expectedFamily)+'. Choose a product from that family, or change the transaction-code mapping and review again.');
      }
      if(op.action==='approve'){
        if(isPmRoom(before.room))fail('A PM holding account cannot receive upsell credit. Verify the original guest booking first.');
        const p=snapshot.products.find(p=>p.id===before.productId),person=snapshot.contributors.find(p=>p.id===before.contributorId);
        if(!p||p.activeStatus!=='NORMAL'||/UNKNOWN|UNMAPPED/.test(key(p.code+' '+p.name))||!person)fail('Identify the product and contributor before approving this request.');
        if(id(op.productId)!==before.productId||id(op.contributorId)!==before.contributorId||!op.values||stable(op.values)!==stable(values(before)))fail('An approval must preserve the existing product, seller, amount, dates and notes. Use Edit package to review other changes.');
        if(before.totalCents!==amountTotal(values(before),p,snapshot.settings))fail('Review this request’s configured charge calculation before approval.');
        if(!snapshot.permissions.canEdit)fail('IN-Gauge approval uses Edit → Approved → Save. This account needs edit permission as well as approval permission.');
      }
      if(['deny','delete'].includes(op.action)&&text(op.reason).length<5)fail('Enter a clear reason for this denial or removal.');
      if(['add','edit'].includes(op.action)){
        if(op.sellerFreeze&&id(op.sellerFreeze.contributorId)!==id(op.contributorId))fail('The reviewed contributor differs from the fixed seller. Reopen the sale to change or unfreeze it.');
        const p=snapshot.products.find(p=>p.id===id(op.productId));if(!p||p.activeStatus!=='NORMAL'||/UNKNOWN|UNMAPPED/.test(key(p.code+' '+p.name)))fail('Choose an active, identified product from this hotel.');
        if(op.requireAssignment&&(!op.assignmentReviewed||!id(op.assignmentContributorId)||id(op.assignmentContributorId)!==id(op.contributorId)))fail('Review and explicitly assign the seller before selecting this sale.');
        if(op.sellerCredit?.recommendedContributorId&&id(op.contributorId)!==id(op.sellerCredit.recommendedContributorId)&&text(op.reason).length<5)fail('Explain why credit should differ from the seller identified in the Opera note.');
        const person=snapshot.contributors.find(p=>p.id===id(op.contributorId));
        if(!before||before.contributorId!==id(op.contributorId)){if(!person||person.activeStatus!=='NORMAL')fail('Choose an active contributor assigned to this hotel.');}
        if(before&&before.contributorId!==id(op.contributorId)&&!snapshot.permissions.canReassign)fail('This account cannot reassign contributors.');
        const v=op.values;if(isPmRoom(v?.room))fail('PM rooms (9000 and above) only hold transferred charges. Use the original guest room and booking; never create or move an upsell to a PM room.');if(!v||!day(v.businessDate)||!day(v.departure)||!day(v.arrival))fail('Confirm the arrival, departure and business dates.');
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
    const seen=new Set(),sources=new Map();for(const op of plan.operations){if(!scopeAllows(scope,operationCategory(op,snapshot)))fail('A selected change is outside your chosen audit mode. Choose the matching mode and review again.');const error=operationError(op,snapshot,plan.period);if(error)fail(error);const k=op.action==='add'?'new:'+op.transaction:'record:'+op.recordId;if(seen.has(k))fail('A record or Opera transaction appears more than once in this plan.');seen.add(k);for(const tx of new Set([op.transaction,...(op.reconciliation?.journalIds||[])].map(text).filter(Boolean))){const prior=sources.get(tx);if(prior&&!(prior.reconciliation?.key===op.reconciliation?.key&&prior.reconciliation?.kind==='duplicate'&&op.reconciliation?.kind==='duplicate'))fail('The same Opera posting is selected in more than one change. Review the combined booking charges first.');sources.set(tx,op);}}
    const keepers=new Set();for(const op of plan.operations){const proof=op.reconciliation;if(proof?.recordIds?.some(id=>!withinPeriod(snapshot.records.find(r=>r.id===id)?.businessDate,plan.period===undefined?snapshot:plan.period)))fail('A reconciliation source entry is outside the selected posting period.');if(proof?.role==='keep'){if(keepers.has(proof.key))fail('Choose only one entry to retain for this one-off fee.');keepers.add(proof.key);}}
    return plan;
  }
  function values(r){return {unitCents:r.unitCents,totalCents:r.totalCents,chargeDays:r.chargeDays,arrival:r.arrival,departure:r.departure,businessDate:r.businessDate,room:r.room,memo:r.memo};}
  // Existing charges may share a booking, package and date. Reassigning one
  // exact record does not add revenue or decide whether its siblings are duplicates.
  function creditOnlyEdit(op,current){
    return !!(op?.action==='edit'&&current&&id(op.recordId)===current.id&&op.expected===fingerprint(current)
      &&op.confirmation===current.confirmation&&id(op.productId)===current.productId
      &&op.statusAfter===current.status&&stable(op.values)===stable(values(current)));
  }
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
  function approvalPayload(op,snapshot,current){
    if(op.action!=='approve')fail('Choose an existing Pending request for approval.');
    const error=operationError(op,snapshot);if(error)fail(error);
    if(!current||fingerprint(current)!==op.expected)fail('The live request changed after review. Refresh before approving it.');
    return payload({...op,action:'edit',productId:current.productId,contributorId:current.contributorId,values:values(current),statusAfter:'APPROVED'},snapshot,current);
  }
  function auditParams(op){if(op.action==='approve')fail('Approvals use the existing-record edit workflow.');if(!['deny','delete'].includes(op.action)||!numId(op.recordId))fail('Invalid audit-status operation.');return {entityIDs:id(op.recordId),isReview:'false',isLock:'false',isDeny:String(op.action==='deny'),isDelete:String(op.action==='delete'),denialNotes:text(op.reason),entityType:'PRODUCT_METRIC'};}
  function duplicates(op,records,products){
    const product=products.find(p=>p.id===id(op.productId)),once=product&&['EC','LC'].includes(kind(product.code)||kind(product.name));
    const sourceIds=new Set([op.transaction,...(op.reconciliation?.journalIds||[])].map(text).filter(Boolean));
    return records.filter(r=>journalIds(r.memo).some(tx=>sourceIds.has(tx))||r.confirmation===op.confirmation&&(r.productId===id(op.productId)||!r.productId||/UNKNOWN|UNMAPPED/.test(key(r.product))||op.reconciliation?.kind==='split-missing'&&(!recordFamily(r,products)||recordFamily(r,products)===op.reconciliation.family))&&(once||r.businessDate===op.values?.businessDate));
  }
  function reviewedDuplicate(op,live,snapshot){
    if(op.recordReview&&op.action==='edit'&&!recordReviewError(op,snapshot)){
      const proof=op.recordReview,source=snapshot.records.find(r=>r.id===String(live.id));
      if(proof.related.some(r=>r.id===String(live.id))&&source&&fingerprint(source)===fingerprint(live))return true;
    }
    const proof=op.reconciliation;if(op.action!=='edit'||proof?.kind!=='duplicate'||proof.role!=='keep'||proof.reviewed!==true||!proof.recordIds?.includes(String(live.id)))return false;
    const source=snapshot.records.find(r=>r.id===String(live.id)),before=snapshot.records.find(r=>r.id===String(op.recordId));
    if(!source||!before||live.confirmation!==op.confirmation||live.propertyId!==snapshot.binding.propertyId||live.departmentId!==snapshot.binding.departmentId||live.productId!==before.productId||!withinPeriod(live.businessDate,proof.period))return false;
    return live.status==='DENIED'||live.status==='PURGED'||fingerprint(live)===fingerprint(source);
  }
  // Review an existing row alongside its distinct same-day charges. This never authorizes a new sale.
  function recordReview(op,snapshot,period){
    const before=snapshot.records.find(r=>r.id===id(op.recordId));if(!before)fail('Refresh the existing IN-Gauge entry before reviewing it.');
    const rows=duplicates(op,snapshot.records.filter(r=>r.id!==before.id),snapshot.products);
    return {schema:1,snapshotId:snapshot.id,binding:binding(snapshot.binding),period:{...period},recordId:before.id,expected:fingerprint(before),reviewed:false,related:rows.map(r=>({id:r.id,expected:fingerprint(r)}))};
  }
  function recordReviewError(op,snapshot,liveRecords=snapshot.records){
    const p=op.recordReview,before=snapshot.records.find(r=>r.id===id(op.recordId));if(!p)return '';
    if(p.schema!==1||!['edit','deny'].includes(op.action)||p.reviewed!==true||p.snapshotId!==snapshot.id||!sameBinding(p.binding,snapshot.binding)||p.recordId!==before?.id||p.expected!==op.expected||p.expected!==fingerprint(before)||!withinPeriod(before?.businessDate,p.period)||!Array.isArray(p.related)||p.related.length>100||new Set(p.related.map(r=>r?.id)).size!==p.related.length)return 'Check the bill and the existing entries before selecting this monthly edit.';
    const expected=duplicates({...op,productId:before.productId,values:values(before)},snapshot.records.filter(r=>r.id!==before.id),snapshot.products);
    if(stable(expected.map(r=>r.id).sort())!==stable(p.related.map(r=>r.id).sort()))return 'The related entries changed. Refresh and review this room again.';
    for(const proof of p.related){const source=snapshot.records.find(r=>r.id===proof.id),live=liveRecords.find(r=>r.id===proof.id);if(!source||proof.expected!==fingerprint(source)||!live||fingerprint(live)!==proof.expected)return 'A related IN-Gauge entry changed after review. Refresh and review this room again.';}
    if(op.action==='edit'&&p.related.length){
      const product=snapshot.products.find(r=>r.id===before.productId),f=kind(product?.name)||kind(product?.code),v=op.values;
      if(['EC','LC'].includes(f)||op.productId!==before.productId||['arrival','departure','businessDate','room'].some(k=>v?.[k]!==before[k])||v.chargeDays!==before.chargeDays||p.related.some(proof=>{const r=snapshot.records.find(r=>r.id===proof.id);return r.propertyId!==before.propertyId||r.departmentId!==before.departmentId||r.confirmation!==before.confirmation||r.productId!==before.productId||r.businessDate!==before.businessDate||journalIds(r.memo).some(tx=>journalIds(before.memo).includes(tx));}))return 'Review these booking, date, product or duplicate source changes separately. Only distinct existing charges on the same day can be edited together.';
    }
    if(op.action==='edit'&&stable(journalIds(op.values?.memo).sort())!==stable(journalIds(before.memo).sort()))return 'Keep the existing Opera transaction links on this entry. Check booking links separately.';
    return '';
  }
  // IN-Gauge uses bare audit-status words as automatic memos on some records.
  // Match only observed, identity-bound rewrites; real notes remain exact.
  function systemMemoChange(op,r){
    if(!r||!op.values||!['add','edit','approve'].includes(op.action)||r.status!=='APPROVED'||r.memo!=='APPROVED')return null;
    if(op.values.memo==='')return {from:'',to:'APPROVED',kind:'blank-status'};
    if(op.action!=='edit'||op.statusAfter!=='APPROVED'||op.values.memo!=='REVIEWED')return null;
    let before;try{before=JSON.parse(op.expected);}catch(_){return null;}
    if(!before||before.status!=='REVIEWED'||before.memo!=='REVIEWED'||id(before.id)!==id(op.recordId)||id(r.id)!==id(op.recordId)||before.confirmation!==op.confirmation||r.confirmation!==op.confirmation||before.propertyId!==r.propertyId||before.departmentId!==r.departmentId)return null;
    return {from:'REVIEWED',to:'APPROVED',kind:'reviewed-status'};
  }
  function systemMemoNote(op,r){
    const change=systemMemoChange(op,r);if(!change)return '';
    return change.kind==='blank-status'?'IN-Gauge filled the blank memo with its APPROVED status note. All reviewed financial values match.':'Saved and verified. IN-Gauge updated its automatic status memo from REVIEWED to APPROVED; all reviewed financial values and booking details match.';
  }
  function differences(op,r,b){
    const expectedStatus=({approve:'APPROVED',deny:'DENIED',delete:'PURGED'})[op.action]||op.statusAfter;
    const expected={confirmation:op.confirmation,productId:id(op.productId),contributorId:id(op.contributorId),status:expectedStatus,...op.values,...(b?{propertyId:b.propertyId,departmentId:b.departmentId}:{})};
    return Object.entries(expected).filter(([field,value])=>stable(value)!==stable(r[field])&&!(field==='memo'&&systemMemoChange(op,r))).map(([field,value])=>({field,expected:value??null,actual:r[field]??null}));
  }
  function matches(op,r){
    return differences(op,r).length===0;
  }
  const api={isPmRoom,pmOwner,text,id,key,day,cents,stable,portalUrl,binding,sameBinding,humanLoginMatch,resolveSeller,resolveProduct,journalMapping,kind,familyLabel,journalIds,flatten,record,fingerprint,amountTotal,withinPeriod,operationPeriodError,operationError,validatePlan,values,creditOnlyEdit,payload,approvalPayload,auditParams,duplicates,reviewedDuplicate,recordReview,recordReviewError,matches,differences,systemMemoChange,systemMemoNote,terminal,saleCategory,operationCategory,scopeAllows,isRevenueStatus,reportingMessage,reportingCents,reportingRecord,recordAmountIssue};
  root.InGaugeAuditCore=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
