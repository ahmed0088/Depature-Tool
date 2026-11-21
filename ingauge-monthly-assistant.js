/* Read-only monthly assistance. History is evidence only when today's record still proves it. */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./ingauge-audit-core'):root.InGaugeAuditCore);if(typeof module==='object'&&module.exports)module.exports=api;else root.InGaugeMonthlyAssistant=api;})(typeof window!=='undefined'?window:globalThis,function(C){
 'use strict';
 const list=v=>Array.isArray(v)?v:Object.values(v||{}),text=v=>String(v??'').trim();
 function date(v){if(C.day(v))return v;const m=text(v).match(/^(\d{1,2})[-/.]([A-Za-z]{3}|\d{1,2})[-/.](\d{2}|\d{4})$/);if(!m)return '';const mo=/^\d+$/.test(m[2])?+m[2]:'JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' ').indexOf(m[2].toUpperCase())+1;return C.day((m[3].length===2?'20':'')+m[3]+'-'+String(mo).padStart(2,'0')+'-'+m[1].padStart(2,'0'));}
 const name=v=>text(v).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\b(MR|MRS|MS|MISS|DR|MSTR|MASTER|PROF)\b/g,' ').match(/[A-Z]+/g)?.sort().join(' ')||'';
 function postingSignature(value){try{const r=typeof value==='string'?JSON.parse(value):value;return C.stable(Object.fromEntries(Object.entries(r).filter(([key])=>key!=='line')));}catch(_){return '';}}
 function usable(s,b,now){return !!(s?.complete&&!s.invalidatedAt&&C.sameBinding(s.binding,b)&&Number.isFinite(s.fetchedAt)&&s.fetchedAt<=now+60000&&now-s.fetchedAt<=21600000&&s.pagination?.verified&&s.pagination.total===s.records?.length&&s.pagination.read===s.records?.length);}
 function history({history=[],snapshot:s,binding=s?.binding,hotelId=s?.hotelId,period,journal=[],reservations=[],scope='all',dateOf=date,now=Date.now()}={}){
  const output={ready:usable(s,binding,now),verified:[],changed:[],bookings:{},conflicts:[]};if(!output.ready||s.hotelId!==hotelId||!C.withinPeriod(period?.from,period)||!C.withinPeriod(period?.to,period)||!C.withinPeriod(period.from,s)||!C.withinPeriod(period.to,s))return output;
  const current=new Map(s.records.map(r=>[r.id,r])),postings=new Map(journal.map(r=>[text(r.TRX_NO),r])),seen=new Set(),hints=new Map();
  for(const job of list(history).slice().sort((a,b)=>(b.at||b.reviewedAt||0)-(a.at||a.reviewedAt||0))){
   let plan;try{plan=JSON.parse(job.planJson);}catch(_){continue;}
   if(job.test!==false||plan?.schema!==2||plan.mode!=='apply'||plan.hotelId!==hotelId||!C.sameBinding(plan.binding,binding)||!Array.isArray(plan.operations))continue;
   for(const result of list(job.results)){
    if(!['applied','unchanged','uncertain'].includes(result.state))continue;
    const op=plan.operations.find(o=>o.key===result.key),id=text(result.recordId||op?.recordId),live=current.get(id);if(!op||!live||!C.withinPeriod(op.values?.businessDate,period)||!C.withinPeriod(live.businessDate,period)||!C.scopeAllows(scope,C.saleCategory(live))||live.reportingOnly||live.propertyId!==binding.propertyId||live.departmentId!==binding.departmentId)continue;
    const observedAt=result.at||job.at||job.reviewedAt;if(!Number.isFinite(observedAt)||observedAt<(job.reviewedAt||0)||s.fetchedAt<=observedAt)continue;
    const first=!seen.has(id);seen.add(id);const row={recordId:id,confirmation:live.confirmation,product:live.product,productId:live.productId,seller:live.seller,contributorId:live.contributorId,day:live.businessDate,totalCents:live.totalCents,status:live.status,action:op.action,at:observedAt,tag:job.tag||'',note:C.systemMemoNote(op,live)||'The current record still matches the saved reviewed change.'};
    if(!C.matches(op,live)){if(first)output.changed.push({...row,note:'This entry changed after its saved review. Current values need a new decision.'});continue;}
    if(first)output.verified.push(row);
    // Only an already-settled current sale can recover a previously verified bill link.
    // This cannot generate a missing sale, move a date, assign a seller or approve a request.
    const proof=op.reconciliation,bookings=proof?.bookings||[proof?.booking].filter(Boolean);
    if(!['add','edit','approve'].includes(op.action)||!C.isRevenueStatus(live.status)||!bookings.length||proof.reviewed!==true||proof.snapshotId!==plan.snapshotId)continue;
    if(bookings.length>1&&(new Set(bookings.map(b=>b.transaction)).size!==bookings.length||bookings.length!==proof.journalIds?.length))continue;
    const checked=[];let sourceTotal=0;
    for(const b of bookings){
     if(b.schema!==1||b.verified!==true||b.snapshotId!==plan.snapshotId||b.confirmation!==live.confirmation||!C.sameBinding(b.binding,binding)||C.stable(b.period)!==C.stable(proof.period)||!proof.journalIds?.includes(b.transaction)||!C.day(b.arrival)||!C.day(b.departure)||b.arrival>b.departure)break;
     const raw=postings.get(b.transaction),day=raw&&dateOf(raw.BUSINESS_DATE),explicit=raw&&text(raw.CONFIRMATION_NO||raw.CONFIRMATION_NUMBER);if(!raw||postingSignature(raw)!==postingSignature(b.sourceSignature)||day!==b.day||day!==live.businessDate||explicit&&explicit!==live.confirmation||text(raw.CURRENCY1).toUpperCase()!==text(s.settings.currency).toUpperCase())break;
     const debit=C.cents(text(raw.CASHIER_DEBIT)||'0'),credit=C.cents(text(raw.CASHIER_CREDIT)||'0');if(debit===null||credit===null||debit-credit<=0)break;
     const known=reservations.filter(r=>text(r.CONFIRMATION_NO)===live.confirmation&&name(r.FULL_NAME));if(known.length&&!known.some(r=>name(r.FULL_NAME)===name(raw.GUEST_FULL_NAME)))break;
     sourceTotal+=debit-credit;checked.push({b,raw,day});
    }
    if(checked.length!==bookings.length||sourceTotal!==live.totalCents||proof.journalCents!==live.totalCents)continue;
    for(const {b,raw,day}of checked){
     const hint={transaction:b.transaction,sourceSignature:C.stable(raw),confirmation:live.confirmation,recordId:live.id,recordFingerprint:C.fingerprint(live),snapshotId:s.id,binding:C.binding(binding),day,arrival:live.arrival,departure:live.departure,tag:row.tag,at:row.at};
     if(hints.has(b.transaction)&&hints.get(b.transaction).confirmation!==hint.confirmation){output.conflicts.push(b.transaction);continue;}hints.set(b.transaction,hint);
    }
   }
  }
  for(const [tx,hint]of hints)if(!output.conflicts.includes(tx))output.bookings[tx]=hint;
  return output;
 }
 function booking(hints,raw,s,dateOf=date){
  const h=hints?.[text(raw.TRX_NO)];if(!h||h.snapshotId!==s?.id||!C.sameBinding(h.binding,s.binding)||h.sourceSignature!==C.stable(raw)||h.day!==dateOf(raw.BUSINESS_DATE))return null;
  const r=s.records.find(r=>r.id===h.recordId);if(!r||r.reportingOnly||!C.isRevenueStatus(r.status)||r.confirmation!==h.confirmation||r.businessDate!==h.day||C.fingerprint(r)!==h.recordFingerprint||r.propertyId!==s.binding.propertyId||r.departmentId!==s.binding.departmentId)return null;
  const explicit=text(raw.CONFIRMATION_NO||raw.CONFIRMATION_NUMBER);return explicit&&explicit!==h.confirmation?null:h;
 }
 async function copy(value){const v=text(value);if(!/^\d{1,24}$/.test(v))throw Error('A valid confirmation number is needed.');try{if(globalThis.navigator?.clipboard?.writeText){await navigator.clipboard.writeText(v);return v;}}catch(_){}if(typeof document==='undefined')throw Error('Clipboard unavailable.');const input=document.createElement('textarea');input.value=v;input.readOnly=true;input.style.cssText='position:fixed;top:0;left:0;opacity:0;font-size:16px';document.body.appendChild(input);const focused=document.activeElement;input.focus({preventScroll:true});input.select();input.setSelectionRange(0,v.length);const ok=document.execCommand?.('copy');input.remove();focused?.focus?.({preventScroll:true});if(!ok)throw Error('Copy unavailable. Long-press the confirmation to copy it.');return v;}
 return {date,postingSignature,usable,history,booking,copy};
});
