// Read-only Opera/IN-Gauge reconciliation. Proposals require an explicit review before a financial run.
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./ingauge-audit-core.js'):root.InGaugeAuditCore);if(typeof module==='object'&&module.exports)module.exports=api;else root.InGaugeReconciliation=api;})(typeof window!=='undefined'?window:globalThis,function(C){
 'use strict';
 const labels={EC:'Early check-in',LC:'Late checkout',BB:'Breakfast',ROOM:'Room upselling',DIN:'Dinner',HB:'Half board',FB:'Full board'},active=new Set(['CKIN','CKOT','DUEIN','DUEOUT','DUOT']);
 const text=v=>String(v??'').trim(),room=v=>text(v).replace(/^0+(?=\d)/,''),norm=v=>text(v).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\b(MR|MRS|MS|MISS|DR|MSTR|MASTER|PROF)\b/g,' ').match(/[A-Z]+/g)?.sort().join(' ')||'';
 function reportDate(value){
  const iso=C.day(value);if(iso)return iso;
  const match=text(value).match(/^(\d{1,2})[-/.]([A-Za-z]{3}|\d{1,2})[-/.](\d{2}|\d{4})$/);if(!match)return '';
  const month=/^\d+$/.test(match[2])?Number(match[2]):['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'].indexOf(match[2].toUpperCase())+1;
  return C.day((match[3].length===2?'20'+match[3]:match[3])+'-'+String(month).padStart(2,'0')+'-'+match[1].padStart(2,'0'));
 }
 const amount=v=>C.cents(text(v)||'0'),key=(...v)=>JSON.stringify(v),unique=rows=>[...new Map(rows.map(r=>[r.conf,r])).values()];
 const sum=(rows,field)=>rows.reduce((n,r)=>{const next=n+r[field];if(!Number.isSafeInteger(next))throw Error('The reconciliation total is outside the supported range.');return next;},0);
 function analyse(input){
  const {journal=[],reservations=[],snapshot:s,period,scope='all',breakfastCode='2090',mapping={}}=input||{};
  if(!s?.complete||s.invalidatedAt||!Number.isFinite(s.fetchedAt)||Date.now()-s.fetchedAt>21600000||!s.pagination?.verified||s.pagination.total!==s.records?.length||s.pagination.read!==s.records?.length)return {ready:false,reason:'Refresh the complete IN-Gauge snapshot before reviewing corrections.',cases:[]};
  if(!C.withinPeriod(period?.from,period)||!C.withinPeriod(period?.to,period)||!C.withinPeriod(period.from,s)||!C.withinPeriod(period.to,s))return {ready:false,reason:'Fetch IN-Gauge for the same selected posting period before reviewing corrections.',cases:[]};
  if(!['all','manual','automatic'].includes(scope))throw Error('Choose a valid reconciliation scope.');
  const map={...C.journalMapping({breakfastCode}),...mapping},products=new Map(s.products.map(p=>[String(p.id),p])),families=new Map(s.products.map(p=>[String(p.id),C.kind(p.name)||C.kind(p.code)]));
  const family=r=>C.kind(r.product)||families.get(String(r.productId))||'',sourceIndex=new Map(),confRecords=new Map(),unknownByDay=new Map(),allByConfFamily=new Map();
  for(const r of reservations){const name=norm(r.FULL_NAME),a=reportDate(r.TRUNC_BEGIN),d=reportDate(r.TRUNC_END),conf=text(r.CONFIRMATION_NO);if(!name||!/^\d+$/.test(conf)||!a||!d||!active.has(text(r.SHORT_RESV_STATUS)))continue;const row={conf,name,room:room(r.ROOM_NO||r.DISP_ROOM_NO),arrival:a,departure:d};if(!sourceIndex.has(name))sourceIndex.set(name,[]);sourceIndex.get(name).push(row);}
  for(const r of s.records){
   if(String(r.propertyId)!==String(s.binding.propertyId)||String(r.departmentId)!==String(s.binding.departmentId))throw Error('A saved record belongs to another hotel or department.');
   const f=family(r),k=key(text(r.confirmation),f);if(!allByConfFamily.has(k))allByConfFamily.set(k,[]);allByConfFamily.get(k).push(r);
   if(!C.withinPeriod(r.businessDate,period)||!C.scopeAllows(scope,C.saleCategory(r)))continue;
   if(!f){const u=key(text(r.confirmation),r.businessDate);if(!unknownByDay.has(u))unknownByDay.set(u,[]);unknownByDay.get(u).push(r);}
   const k2=key(text(r.confirmation),f,r.businessDate);if(!confRecords.has(k2))confRecords.set(k2,[]);confRecords.get(k2).push(r);
  }
  const groups=new Map(),unresolved=[],seen=new Map();let excluded=0;
  for(const j of journal){
   const day=reportDate(j.BUSINESS_DATE),f=map[text(j.TRX_CODE)],automatic=/\[NA\s+Pkgs\./i.test(text(j.REFERENCE)+' '+text(j.REMARK));if(!C.withinPeriod(day,period)||!labels[f]||scope!=='all'&&(scope==='automatic')!==automatic){excluded++;continue;}
   const tx=text(j.TRX_NO),debit=amount(j.CASHIER_DEBIT),credit=amount(j.CASHIER_CREDIT);if(!/^\d+$/.test(tx)||debit===null||credit===null)throw Error('An Opera posting has no valid transaction ID or amount.');
   const signature=C.stable(j);if(seen.has(tx)){if(seen.get(tx)!==signature)throw Error('Conflicting copies of an Opera transaction.');continue;}seen.set(tx,signature);
   const note=[...new Set([text(j.REFERENCE),text(j.REMARK)].filter(Boolean))].join(' | '),rooms=new Set([room(j.ROOM)]);
   for(const m of note.matchAll(/#\s*(\d+)\s*(?:=>|→|->)[^#\[\]]*#\s*(\d+)/g))if([room(m[1]),room(m[2])].includes(room(j.ROOM))){rooms.add(room(m[1]));rooms.add(room(m[2]));}
   const rows=(sourceIndex.get(norm(j.GUEST_FULL_NAME))||[]).filter(r=>rooms.has(r.room)&&r.arrival<=day&&day<=r.departure),explicit=text(j.CONFIRMATION_NO||j.CONFIRMATION_NUMBER);
   let candidates=unique(rows),basis=rooms.size>1?'Exact guest, routed billing room and stay':'Exact guest, room and stay';
   if(explicit)candidates=candidates.filter(r=>r.conf===explicit);
   if(candidates.length>1&&automatic&&['BB','ROOM','DIN','HB','FB'].includes(f)){const nights=unique(rows.filter(r=>day<r.departure));if(nights.length===1){candidates=nights;basis='Automatic night posting: exact guest/room and arrival ≤ posting date < departure';}}
   const post={id:tx,day,family:f,cents:debit-credit,currency:text(j.CURRENCY1).toUpperCase(),automatic,note,room:text(j.ROOM),guest:text(j.GUEST_FULL_NAME),cashier:text(j.CASHIER_NAME),login:text(j.USER_NAME||j.INSERT_USER),sourceLine:j.line||'',candidates:candidates.map(r=>r.conf),basis};
   if(candidates.length!==1){unresolved.push(post);continue;}
   post.conf=candidates[0].conf;const packageCode=note.match(/\[NA\s+Pkgs\.([^\]]+)/i)?.[1]||'';
   post.logEvidence=(input.events?.[post.conf]||[]).filter(e=>e.code===packageCode&&(!e.from||reportDate(e.from)&&reportDate(e.from)<=day)&&(!e.to||day<=reportDate(e.to))).slice().sort((a,b)=>Number(b.ts)-Number(a.ts)).slice(0,3).map(e=>({action:e.action,code:e.code,price:e.price,user:e.user,from:e.from,to:e.to}));const k=key(post.conf,f,day);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(post);
  }
  const cases=[],consumed=new Set(),onceGroups=new Map();
  const make=(kind,posts,records,reason,how,extras={})=>{const conf=extras.confirmation??posts[0]?.conf??'',approved=records.filter(r=>r.status==='APPROVED'),pending=records.filter(r=>r.status==='PENDING'),source=sum(posts,'cents'),item={key:'money-'+kind+'-'+posts.map(p=>p.id).sort().join('-'),kind,confirmation:conf,family:posts[0]?.family||'',product:labels[posts[0]?.family]||'Sale',from:posts.map(p=>p.day).sort()[0],to:posts.map(p=>p.day).sort().at(-1),journalCents:source,approvedCents:sum(approved,'totalCents'),pendingCents:sum(pending,'totalCents'),gapCents:source-sum(approved,'totalCents'),posts,records:records.map(r=>({id:r.id,confirmation:r.confirmation,day:r.businessDate,product:r.product,seller:r.seller,status:r.status,cents:r.totalCents,contributorId:r.contributorId})),reason,how,...extras};cases.push(item);return item;};
  for(const [k,posts] of groups){if(['EC','LC'].includes(posts[0].family)){const b=key(posts[0].conf,posts[0].family);if(!onceGroups.has(b))onceGroups.set(b,[]);onceGroups.get(b).push(...posts);}}
  for(const [k,posts] of onceGroups){
   if(posts.length!==1||posts.some(p=>p.cents<=0||p.currency!==text(s.settings.currency).toUpperCase()))continue;const p=posts[0],all=allByConfFamily.get(k)||[],records=all.filter(r=>C.withinPeriod(r.businessDate,period)&&C.scopeAllows(scope,C.saleCategory(r))&&['APPROVED','PENDING','DENIED'].includes(r.status));
   const settled=records.filter(r=>r.status==='APPROVED');if(records.length>1&&settled.length===1&&records.every(r=>r.status==='APPROVED'||r.status==='DENIED')&&settled[0].totalCents===p.cents&&settled[0].businessDate===p.day){consumed.add(key(p.conf,p.family,p.day));continue;}
   const outside=all.filter(r=>!C.withinPeriod(r.businessDate,period)&&!['PURGED','DELETED'].includes(r.status));
   if(outside.length&&(records.length!==1||records[0].businessDate!==p.day||records[0].totalCents!==p.cents||records[0].status!=='APPROVED')){make('held',posts,records,'This one-off fee also has an existing request outside the selected posting period.','Verify the current charge against its history. Older completed entries must not be edited or duplicated from this period.',{canReview:false});consumed.add(key(p.conf,p.family,p.day));continue;}
   if(records.length>1){make('duplicate',posts,records,'This one-off fee has one Opera posting and several approved/pending IN-Gauge entries.','Check the guest bill. Choose one entry to keep at the posted amount; review each extra entry before denying it.',{canReview:true});consumed.add(key(p.conf,p.family,p.day));}
   else if(records.length===1&&records[0].businessDate!==p.day){make('date',posts,records,'The same one-off fee exists under another business date.','Review the posting date and amount on the existing entry; do not add another request.',{canReview:true});consumed.add(key(p.conf,p.family,p.day));}
   else if(!records.length&&all.some(r=>!C.withinPeriod(r.businessDate,period)&&!['PURGED','DELETED'].includes(r.status))){make('held',posts,[],'This one-off product already exists outside the selected posting period.','Check the existing request and bill. An older completed sale must not be edited or duplicated from this period.',{canReview:false});consumed.add(key(p.conf,p.family,p.day));}
  }
  for(const [k,posts] of groups){
   if(consumed.has(k))continue;const p=posts[0],records=confRecords.get(k)||[],unknown=unknownByDay.get(key(p.conf,p.day))||[],net=sum(posts,'cents');
   if(posts.some(p=>p.currency!==text(s.settings.currency).toUpperCase())||net<=0||posts.some(p=>p.cents<=0)){make('held',posts,records,'The posting contains a currency difference, zero charge or reversal.','Reconcile the original fee and reversal together before selecting a financial change.',{canReview:false});continue;}
   if(records.length>1||posts.length>1){if(net!==sum(records.filter(r=>r.status==='APPROVED'),'totalCents')||records.some(r=>r.status==='PENDING'))make('held',posts,records,'Several source postings or IN-Gauge entries share this booking, family and date.','Check split charges, quantities and sellers before editing a specific record.',{canReview:false});continue;}
   if(records.length===1){const r=records[0],product=products.get(String(r.productId));
    if(!['APPROVED','PENDING','DENIED'].includes(r.status)){make('held',posts,records,'The existing entry is locked, removed or uses a dedicated audit status.','Use the appropriate IN-Gauge workflow for this status.',{canReview:false});continue;}
    if(r.status==='DENIED'){make('denied',posts,records,'A denied request already exists for this sale.','Check the rejection and bill. Reopening requires an explicit reason; never add a duplicate.',{canReview:true});continue;}
    let calculationMatches=false;try{calculationMatches=!!product&&r.totalCents===C.amountTotal(C.values(r),product,s.settings);}catch(_){}
    if(r.totalCents===net&&r.status==='APPROVED'&&calculationMatches)continue;
    if(!product||product.recurring&&s.settings.validation!=='BUSINESS_DATE'){make('held',posts,records,'The hotel uses a stay-based calculation or the product is not verified.','Verify charge days and allocation in the existing record before changing the amount.',{canReview:false});continue;}
    const amountWhy=net===2*r.totalCents?'Opera posted twice this entry’s amount. Check whether two units or guests were charged while IN-Gauge credits one.':p.logEvidence?.some(e=>C.cents(e.price)===net)?'Opera’s activity log and posted journal agree on the customized fee, while IN-Gauge has a different amount.':'The approved/requested amount differs from the net fee posted in Opera. Check the fee or quantity against the bill.';
    make(r.totalCents===net&&calculationMatches?'pending':'amount',posts,records,r.totalCents===net&&calculationMatches?'The request is already submitted and pending; its amount matches Opera.':amountWhy,'Review the posted amount and quantity, preserve the reviewed seller, and save the correction. A pending request needs approval to enter approved revenue.',{canReview:true});
   }else if(unknown.length){make('unmapped',posts,unknown,'An unidentified IN-Gauge product already exists for this booking and date.','Identify the existing product and seller instead of adding a second request.',{canReview:unknown.length===1});}
   else if(p.automatic){make('held',posts,[],'An automatic Opera package has no matched imported IN-Gauge record in this snapshot.','Check import timing and billing before creating a manual replacement. Do not add a request from absence alone.',{canReview:false});}
   else make('missing',posts,[],'This manual posting has no matching IN-Gauge sale in the complete snapshot.','Check the confirmation, seller and current requests. Add a reviewed manual sale; Pending affects approved revenue only after approval.',{canReview:true});
  }
  for(const p of unresolved){
   const possible=s.records.filter(r=>C.withinPeriod(r.businessDate,period)&&r.businessDate===p.day&&room(r.room)===room(p.room)&&family(r)===p.family&&r.totalCents===p.cents&&['APPROVED','PENDING'].includes(r.status));
   if(possible.length===1){make('identity',[p],possible,'A charge with the same room, date and amount already exists, but the journal confirmation is not uniquely verified.','Check the reservation or routed bill. No addition or denial is proposed from this match alone.',{canReview:false,candidates:p.candidates});}
   else make('booking',[p],[],p.candidates.length?'More than one reservation matches this posting.':'Reservation Detail does not uniquely identify this posting.','Check the bill and choose the owning confirmation before reviewing a request.',{canReview:!p.automatic&&p.candidates.length>0&&p.cents>0&&p.currency===text(s.settings.currency).toUpperCase(),candidates:p.candidates});
  }
  cases.sort((a,b)=>(b.canReview-a.canReview)||Math.abs(b.gapCents)-Math.abs(a.gapCents)||a.from.localeCompare(b.from));
  return {ready:true,cases,period:{...period},snapshotId:s.id,binding:C.binding(s.binding),scope,excluded,stats:{amount:cases.filter(c=>['amount','date','unmapped'].includes(c.kind)).length,missing:cases.filter(c=>c.kind==='missing').length,pending:cases.filter(c=>c.kind==='pending').length,review:cases.filter(c=>!c.canReview||['duplicate','booking','denied'].includes(c.kind)).length}};
 }
 function seller(post,s,aliases=[]){
  const note=post.note||'';for(const re of [/\*\*\s*(.+?)(?=\s+-\s+\d|\*\*|\||$)/gi,/(?:upsold|upsell|sold)\s*(?:by\s+)?([A-Za-z][A-Za-z .'-]+)\s*$/gi,/(?:breakfast|pax)\s+([A-Za-z][A-Za-z .'-]+)\s*$/gi]){for(const m of note.matchAll(re)){const who=C.resolveSeller(m[1].trim(),s.contributors,aliases);if(who.state==='matched')return {person:who.person,basis:'Opera note',named:m[1].trim(),reason:'The note names '+m[1].trim()+'. Posted by '+(post.cashier||post.login)+'. Confirm credit before saving.'};}}
  const who=C.resolveSeller(post.login||post.cashier,s.contributors,aliases),fallback=who.state==='matched'?who:C.resolveSeller(post.cashier,s.contributors,aliases);
  return {person:fallback.person,basis:'Posting user fallback',named:post.cashier||post.login,reason:'No uniquely confirmed seller is named in the note. Posted by '+(post.cashier||post.login)+'. The posting user may differ from the seller; confirm credit.'};
 }
 function proposal(item,s,period,choice={},aliases=[]){
  if(!item.canReview)throw Error(item.how||'This case needs billing review before automation.');
  if(item.posts.some(p=>p.cents<=0||p.currency!==text(s.settings.currency).toUpperCase()||!C.withinPeriod(p.day,period)))throw Error('Verify the positive posting amount, currency and selected period first.');
  const p=item.posts[0],conf=item.confirmation||text(choice.confirmation);if(!/^\d+$/.test(conf)||item.kind==='booking'&&!item.candidates?.includes(conf))throw Error('Choose the verified owning confirmation from the booking candidates.');
  let row=item.records.length?s.records.find(r=>r.id===String(choice.recordId||item.records[0].id)):null;
  if(item.kind==='booking'){const existing=s.records.filter(r=>r.confirmation===conf&&r.businessDate===p.day&&C.kind(r.product)===item.family&&!['PURGED','DELETED'].includes(r.status));if(existing.length>1)throw Error('Several existing requests use that confirmation. Review those entries before adding.');if(existing.length===1)row=existing[0];}
  if(item.kind==='duplicate'&&!choice.recordId)throw Error('Choose the entry to retain or review as extra.');
  if(row&&((item.kind!=='booking'&&!item.records.some(r=>r.id===row.id))||!C.withinPeriod(row.businessDate,period)))throw Error('The chosen record is outside this case or posting period.');
  const action=item.kind==='duplicate'&&choice.action==='deny'?'deny':item.kind==='pending'?'approve':row?'edit':'add';
  const desired=C.resolveProduct({kind:item.family},s.products),product=row&&item.kind!=='unmapped'?s.products.find(r=>r.id===row.productId):desired.product;
  const values=row?C.values(row):{unitCents:p.cents,totalCents:p.cents,chargeDays:1,arrival:p.day,departure:p.day,businessDate:p.day,room:p.room,memo:'Opera journal '+p.id+' · '+p.note};
  if(['add','edit'].includes(action)){values.unitCents=item.journalCents;values.totalCents=product?C.amountTotal(values,product,s.settings):item.journalCents;if(['date','duplicate'].includes(item.kind))values.businessDate=p.day;}
  const credit=row?null:seller(p,s,aliases),person=row?s.contributors.find(r=>r.id===row.contributorId):credit.person;
  const op={key:row?'r-'+row.id:'t-'+p.id,action,source:'Monthly reconciliation',confirmation:conf,productId:product?.id||'',contributorId:person?.id||'',values,statusAfter:action==='approve'?'APPROVED':row?.status==='DENIED'?'':row?.status||'PENDING',reason:'',evidence:item.reason+' · '+item.how+' · Guest: '+p.guest+' · Room '+p.room+' · Opera transaction '+item.posts.map(p=>p.id).join(', ')+' · '+p.note+(p.logEvidence?.length?' · Changes Log: '+p.logEvidence.map(e=>e.action+' '+e.code+' · '+e.price+' · '+e.user).join(' / '):''),reconciliation:{schema:1,key:item.key,kind:item.kind,role:item.kind==='duplicate'?(action==='deny'?'extra':'keep'):'',snapshotId:s.id,period:{...period},journalIds:item.posts.map(p=>p.id),recordIds:item.records.map(r=>r.id),journalCents:item.journalCents,currency:s.settings.currency,why:item.reason,how:item.how,reviewed:false}};
  if(row){op.recordId=row.id;op.expected=C.fingerprint(row);if(!person&&['add','edit'].includes(action)){op.requireAssignment=true;op.assignmentReviewed=false;op.assignmentContributorId='';}}
  else{const previous=[...new Set(s.records.filter(r=>r.confirmation===conf&&C.kind(r.product)===item.family&&r.status==='APPROVED').map(r=>r.seller))].filter(Boolean);if(previous.length)credit.reason+=' Other dates on this package credit '+previous.join(' / ')+'. Confirm the seller of this extra manual charge separately.';op.transaction=p.id;op.requireAssignment=true;op.assignmentReviewed=false;op.assignmentContributorId='';op.sellerCredit={named:credit.named,recommendedContributorId:credit.basis==='Opera note'?person?.id||'':'',basis:credit.basis,warning:credit.basis==='Opera note'?'':'Posting identity is a suggestion requiring confirmation.',postedBy:p.cashier||p.login,postingLogin:p.login,explanation:credit.reason};}
  return op;
 }
 function approvedDelta(op,s){const before=s.records.find(r=>r.id===String(op.recordId||'')),old=before?.status==='APPROVED'?before.totalCents:0,nextStatus=op.action==='approve'?'APPROVED':['deny','delete'].includes(op.action)?'':op.statusAfter,next=nextStatus==='APPROVED'?(op.action==='approve'?before?.totalCents:op.values?.totalCents):0;return Number.isSafeInteger(next)?next-old:0;}
 return {analyse,proposal,seller,approvedDelta};
});
