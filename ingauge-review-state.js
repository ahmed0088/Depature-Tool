// Explain earlier unsuccessful saves only for the same reviewed operation.
(function(root,factory){const C=typeof module==='object'&&module.exports?require('./ingauge-audit-core'):root.InGaugeAuditCore,api=factory(C);if(typeof module==='object'&&module.exports)module.exports=api;else root.InGaugeReviewState=api;})(typeof window!=='undefined'?window:globalThis,function(C){
 'use strict';
 const list=v=>Array.isArray(v)?v:Object.values(v||{});
 function signature(op){return C.stable({action:op.action,recordId:op.recordId||'',transaction:op.transaction||'',expected:op.expected||'',confirmation:op.confirmation,productId:op.productId,contributorId:op.contributorId,statusAfter:op.statusAfter,values:op.values,...(['deny','delete'].includes(op.action)?{reason:op.reason}:{} )});}
 function index(jobs,snapshot){
  const found=new Map();if(!snapshot?.binding)return found;
  for(const job of list(jobs).slice().sort((a,b)=>(b.reviewedAt||b.at||0)-(a.reviewedAt||a.at||0))){
   let plan;try{plan=JSON.parse(job.planJson);}catch(_){continue;}
   if(job.test!==false||!['done','stopped','error'].includes(job.state)||plan?.mode!=='apply'||plan.hotelId!==snapshot.hotelId||!C.sameBinding(plan.binding,snapshot.binding)||!Array.isArray(plan.operations))continue;
   for(const op of plan.operations){if(!op||!op.action)continue;const key=signature(op);if(found.has(key))continue;const row=list(job.results).find(r=>r?.key===op.key);
    if(['held','uncertain'].includes(row?.state))found.set(key,{state:row.state,note:String(row.note||'Open run history to check this outcome.'),at:row.at||job.at||job.reviewedAt,tag:job.tag||'',recordId:row.recordId||op.recordId||''});
    else if(!row&&['stopped','error'].includes(job.state))found.set(key,{state:'unverified',note:'No verified result was recorded for this change. '+String(job.note||'Check run history before trying again.'),at:job.at||job.reviewedAt,tag:job.tag||'',recordId:op.recordId||''});
    else found.set(key,null); // A later verified result supersedes an earlier failure.
   }
  }
  return found;
 }
 return {signature,index};
});
