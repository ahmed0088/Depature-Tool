/* Optional review list. Existing audit editors and the reviewed cloud plan own every financial action. */
(function(W){
 'use strict';
 const C=W.InGaugeAuditCore,D=document,esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),money=(v,c)=>Number.isSafeInteger(v)?c+' '+(v/100).toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2}):'Amount needs checking';
 let view={target:'',query:'',filter:'',limit:40,error:''};
 const identity=S=>JSON.stringify([S.snapshot?.hotelId,S.binding?C.binding(S.binding):null,S.from,S.to,S.scope]);
 let contextCache=null;
 function context(S){
  const ctx=D.getElementById('igMonthlyTally')?._mtMoney,source=S.independent?S.reports:W.ManualUpsells?.state?.data;
  const usable=ctx?.snapshot===S.snapshot&&ctx.result?.ready&&C.sameBinding(ctx.result.binding,S.binding)&&ctx.period.from===S.from&&ctx.period.to===S.to&&ctx.journal===source?.journal?.rows&&ctx.reservations===source?.reservations?.rows;
  if(!usable)return null;if(ctx.scope===S.scope)return ctx;
  if(contextCache?.source===ctx&&contextCache.scope===S.scope)return contextCache.value;
  const adapted={...ctx,scope:S.scope};adapted.result=W.InGaugeReconciliation.analyse(adapted);const value=adapted.result.ready?adapted:null;contextCache={source:ctx,scope:S.scope,value};return value;
 }
 function casesFor(S,id){return context(S)?.result.cases.filter(c=>c.records.some(r=>r.id===id))||[];}
 function approvalIssue(S,id){
  const access=W.InGaugeWorkspace.recordAccess(id,'approve');if(!access.allowed)return access.reason;
  const r=S.snapshot.records.find(r=>r.id===id),draft=S.drafts.get('r-'+id);
  if(!S.selected.has('r-'+id)&&S.selected.size>=100)return 'Apply or unselect the current 100 changes before selecting more.';
  if(draft&&S.selected.has(draft.key)&&draft.action!=='approve')return 'An edit or denial is already selected for this entry.';
  if(draft&&!draft.completed&&draft.action!=='approve'&&!C.matches(draft,r))return 'Review the existing package correction before approving this request.';
  const source=S.independent?S.reports:W.ManualUpsells?.state?.data;if(source?.journal?.rows?.length&&!context(S))return 'Open Monthly comparison to check the report period before using approval checkboxes.';
  if(casesFor(S,id).length)return 'Check the Opera evidence in Review before selecting this approval.';
  const op={recordId:id,key:'r-'+id,action:'approve',expected:C.fingerprint(r),confirmation:r.confirmation,productId:r.productId,contributorId:r.contributorId,values:C.values(r),statusAfter:'APPROVED',reason:''};
  return W.InGaugeWorkspace.reviewListApprovalIssue(id)||C.operationError(op,S.snapshot,{from:S.from,to:S.to});
 }
 function rows(S){
  if(S.snapshot&&(!C.sameBinding(S.snapshot.binding,S.binding)||S.snapshot.hotelId!==String(typeof HOTEL_ID==='undefined'?'':HOTEL_ID)))return [];
  const ctx=context(S),cases=ctx?.result.cases||[],history=[...(S.history||[]),...(S.job?[S.job]:[])],out=[];
  for(const r of S.snapshot?.records||[]){if(!C.withinPeriod(r.businessDate,{from:S.from,to:S.to})||!C.scopeAllows(S.scope,C.saleCategory(r)))continue;
   const issues=cases.filter(c=>c.records.some(x=>x.id===r.id)),op=S.drafts.get('r-'+r.id),selected=!!(op&&!op.completed&&S.selected.has(op.key)),outcome=W.MonthlyTally?.lastRecordOutcome({...S,history},r.id),draft=op&&!op.completed&&!selected&&!C.matches(op,r)?op:null;
   const needs=r.status==='PENDING'||!!draft||!!outcome||issues.some(c=>c.gapCents!==0||c.kind==='note-match'||c.kind==='product');
   out.push({key:'r-'+r.id,r,op:selected?op:null,draft,issues,outcome,needs,fingerprint:C.fingerprint(r),search:[r.confirmation,r.room,r.product,r.seller,r.businessDate,r.id,r.status].join(' ').toLowerCase()});
  }
  for(const op of S.drafts.values()){if(!op.completed&&S.selected.has(op.key)&&!out.some(x=>x.r?.id===op.recordId)&&C.withinPeriod(op.values?.businessDate,{from:S.from,to:S.to})&&C.scopeAllows(S.scope,C.operationCategory(op,S.snapshot)))out.push({key:'o-'+op.key,op,opOnly:true,search:[op.confirmation,op.values?.room,op.values?.businessDate,S.snapshot.products.find(p=>p.id===op.productId)?.name,S.snapshot.contributors.find(p=>p.id===op.contributorId)?.name].join(' ').toLowerCase()});}
  for(const item of cases.filter(c=>!c.records.length&&!W.MonthlyTally?.bookingCheckOnly(c))){if(W.MonthlyTally?.correctionSelection(item,S).complete)continue;out.push({key:'c-'+item.key,item,needs:true,search:[item.confirmation,item.product,...item.posts.flatMap(p=>[p.room,p.guest,p.id])].join(' ').toLowerCase()});}
  return out;
 }
 function actionButton(label,action,id,disabled=false){return '<button type="button" class="btn" data-qr-action="'+action+'" data-qr-id="'+esc(id)+'" '+(disabled?'disabled':'')+'>'+label+'</button>';}
 function renderRows(S,root){
  const all=rows(S),q=view.query.toLowerCase(),counts={pending:all.filter(x=>x.r?.status==='PENDING').length,review:all.filter(x=>x.needs&&!x.op).length,all:all.length,selected:all.filter(x=>x.op).length};
  if(!view.filter)view.filter=counts.pending?'pending':counts.review?'review':'all';
  const filtered=all.filter(x=>(!q||x.search.includes(q))&&(view.filter==='all'||view.filter==='pending'&&x.r?.status==='PENDING'||view.filter==='review'&&x.needs&&!x.op||view.filter==='selected'&&x.op)),shown=filtered.slice(0,view.limit),busy=S.busy||S.switching||S.uploading,eligible=shown.filter(x=>x.r?.status==='PENDING'&&!x.op&&!approvalIssue(S,x.r.id)).slice(0,Math.max(0,100-S.selected.size));
  root._qrRows=new Map(all.map(x=>[x.key,x]));root._qrBinding=identity(S);root._qrSnapshot=S.snapshot;
  const filters=root.querySelector('[data-qr-filters]');filters.innerHTML=[['pending','Pending'],['review','Needs review'],['all','All packages'],['selected','Selected']].map(([id,label])=>'<button type="button" class="btn" data-qr-filter="'+id+'" aria-pressed="'+(view.filter===id)+'">'+label+' <b>'+counts[id]+'</b></button>').join('');
  root.querySelector('[data-qr-count]').textContent=shown.length+' of '+filtered.length+' entries';
  const body=shown.map(x=>{
   if(x.opOnly){const op=x.op;return '<tr class="is-selected"><td></td><td data-label="Booking"><b>'+esc(op.confirmation)+'</b><small>Room '+esc(op.values.room)+' · '+esc(op.values.businessDate)+'</small></td><td data-label="Package / seller"><b>'+esc(S.snapshot.products.find(p=>p.id===op.productId)?.name||'Package')+'</b><small>'+esc(S.snapshot.contributors.find(p=>p.id===op.contributorId)?.name||'Seller needs review')+'</small></td><td data-label="Amount">'+money(op.values.totalCents,S.snapshot.settings.currency)+'</td><td data-label="Status"><span class="qr-status">Selected '+esc(op.action)+'</span><small>Not applied</small></td><td data-label="Actions"><div class="qr-actions">'+actionButton('Edit review','selected',x.key,busy)+actionButton('Unselect','unselect',x.key,busy)+'</div></td></tr>';}
   if(x.item){const c=x.item;return '<tr class="qr-case"><td></td><td data-label="Booking"><b>'+esc(c.confirmation||'Confirmation needed')+'</b><small>'+esc(c.posts.map(p=>'Room '+p.room).join(' / '))+' · '+esc(c.from)+'</small></td><td data-label="Package / seller"><b>'+esc(c.product)+'</b><small>'+esc(c.posts[0]?.guest||'')+'</small></td><td data-label="Opera amount">'+money(c.journalCents,S.snapshot.settings.currency)+'</td><td data-label="Status"><span class="qr-status">'+(c.canReview?'Missing entry':'Needs details')+'</span></td><td data-label="Actions"><div class="qr-actions">'+actionButton('Review','case',x.key,busy)+'</div><p class="qr-why">'+esc(c.reason)+'</p></td></tr>';}
   const r=x.r,approval=r.status==='PENDING'?approvalIssue(S,r.id):'',selected=x.op,reviewIssue=W.InGaugeWorkspace.recordAccess(r.id,'edit'),denyIssue=W.InGaugeWorkspace.recordAccess(r.id,'deny');
   const why=x.outcome?.note||x.issues[0]?.reason||x.draft?.evidence||'',settled=C.isRevenueStatus(r.status),lockedReview=busy||!reviewIssue.allowed;
   const buttons=selected?actionButton('Edit review','selected',x.key,busy)+actionButton('Unselect','unselect',x.key,busy):actionButton('Review','review',x.key,lockedReview)+(r.status==='PENDING'?actionButton(x.issues.length?'Review approval':'Approve','approve',x.key,busy||!W.InGaugeWorkspace.recordAccess(r.id,'approve').allowed||!!W.InGaugeWorkspace.reviewListApprovalIssue(r.id)):'')+(r.status!=='DENIED'?actionButton('Deny','deny',x.key,busy||!denyIssue.allowed):'');
   return '<tr data-qr-record="'+esc(r.id)+'" class="'+(selected?'is-selected':'')+'"><td data-label="Select approval">'+(r.status==='PENDING'&&(!selected||selected.action==='approve')?'<input type="checkbox" data-qr-approval="'+esc(r.id)+'" aria-label="Select approval for confirmation '+esc(r.confirmation)+'" '+(selected?'checked':'')+' '+(busy||!selected&&approval?'disabled':'')+'>':'')+'</td><td data-label="Booking"><b>'+esc(r.confirmation)+'</b><button type="button" class="qr-copy" data-qr-copy="'+esc(r.confirmation)+'">Copy</button><small>Room '+esc(r.room||'—')+' · '+esc(r.businessDate)+'</small></td><td data-label="Package / seller"><b>'+esc(r.product)+'</b><small>'+esc(r.seller||'Seller needs checking')+'</small><small>'+esc(C.saleCategory(r)==='manual'?'Manual upsell':'Automatic package')+' · #'+esc(r.id)+'</small></td><td data-label="Amount"><strong>'+money(C.reportingRecord(r).totalCents,S.snapshot.settings.currency)+'</strong></td><td data-label="Status"><span class="qr-status '+(r.status==='PENDING'?'pending':'')+'">'+esc(r.status)+'</span><small>'+(selected?'Selected: '+esc(({approve:'approval',deny:'denial',edit:'edit',delete:'removal'})[selected.action]||selected.action)+' · not applied':settled?'Already counted in settled revenue':r.status==='DENIED'?'Already denied':'Awaiting review')+'</small></td><td data-label="Actions"><div class="qr-actions">'+buttons+'</div>'+(why?'<p class="qr-why">'+esc(why)+'</p>':'')+(approval&&!selected?'<small class="qr-blocker">'+esc(approval)+'</small>':'')+(!reviewIssue.allowed?'<small class="qr-blocker">'+esc(reviewIssue.reason)+'</small>':'')+(!denyIssue.allowed&&r.status!=='DENIED'&&denyIssue.reason!==reviewIssue.reason?'<small class="qr-blocker">'+esc(denyIssue.reason)+'</small>':'')+'</td></tr>';
  }).join('');
  root.querySelector('[data-qr-table]').innerHTML=body?'<table><caption class="qr-sr">Package approval and review list</caption><thead><tr><th>Select</th><th>Booking</th><th>Package / seller</th><th>Amount</th><th>Status</th><th>Actions</th></tr></thead><tbody>'+body+'</tbody></table>':'<div class="qr-empty"><b>'+(q?'No matching entries':view.filter==='pending'?'No Pending requests':view.filter==='selected'?'No changes selected':'Nothing in this filter')+'</b><p>Try another filter or confirmation. Selected changes take effect only after Review &amp; apply.</p></div>';
  root.querySelector('[data-qr-bulk]').hidden=!eligible.length;root.querySelector('[data-qr-bulk]').disabled=busy;root.querySelector('[data-qr-bulk]').textContent='Select visible approvals · '+eligible.length;
  const more=root.querySelector('[data-qr-more]');more.hidden=filtered.length<=shown.length;more.disabled=busy;root._qrEligible=eligible.map(x=>x.r.id);
  const apply=root.querySelector('[data-qr-apply]');apply.disabled=busy||!S.selected.size;apply.textContent='Review & apply'+(S.selected.size?' · '+S.selected.size:'');
 }
 function render(S,root){
  if(!root)return;const target=identity(S);if(view.target!==target)view={target,query:'',filter:'',limit:40,error:''};
  const focused=D.activeElement?.hasAttribute('data-qr-search'),selection=focused?D.activeElement.selectionStart:null,scroll=root.querySelector('[data-qr-table]')?.scrollTop||0;
  root.innerHTML='<header class="qr-header"><div><span class="iga-eyebrow">QUICK REVIEW</span><h3>Approve, deny or review</h3><p>'+esc(S.binding?.property||'Choose your hotel')+' · '+esc(S.from)+' → '+esc(S.to)+'</p></div><button type="button" class="btn gold" data-qr-apply></button></header><p class="qr-guide">Choose an action below. Your selections are sent only with Review &amp; apply.</p><div class="qr-tools"><button type="button" class="btn" data-qr-refresh '+(!S.binding||S.busy||S.selected.size?'disabled':'')+'>Load / refresh records</button><button type="button" class="btn" data-qr-monthly>Monthly comparison & reports</button><div class="qr-scope" role="group" aria-label="Review list sale types">'+[['all','Both'],['manual','Manual'],['automatic','Automatic']].filter(([k])=>{const p=W.InGaugeWorkspace.preferences();return k==='all'?p.manual&&p.automatic:p[k];}).map(([k,n])=>'<button type="button" class="btn" data-qr-scope="'+k+'" aria-pressed="'+(S.scope===k)+'" '+(S.busy||S.selected.size?'disabled':'')+'>'+n+'</button>').join('')+'</div></div><div class="qr-search"><label for="igQuickReviewSearch">Find a confirmation, room, package or seller</label><input id="igQuickReviewSearch" type="search" data-qr-search value="'+esc(view.query)+'" placeholder="Search this list…"></div><nav data-qr-filters class="qr-filters" aria-label="Review list filters"></nav><div class="qr-list-tools"><span data-qr-count></span><button type="button" class="btn" data-qr-bulk hidden></button></div><details class="qr-help"><summary>How approval selection works</summary><p class="qr-notice">Checkboxes select Pending approvals for review. Requests with Opera evidence or corrections must be opened individually. Denials always need your reason and bill check.</p></details>'+(!S.snapshot?.complete||S.snapshot.invalidatedAt||Date.now()-S.snapshot.fetchedAt>21600000?'<p class="qr-alert">Load fresh IN-Gauge records to enable changes. Your current selection is kept; apply or unselect it before refreshing.</p>':'')+(!context(S)?'<p class="qr-notice">Open Monthly comparison to check these entries against Opera. Existing records can still be reviewed here.</p>':'')+'<p data-qr-error class="iga-error" role="alert" '+(view.error?'':'hidden')+'>'+esc(view.error)+'</p><div data-qr-table class="qr-table" tabindex="0" aria-label="Packages to review"></div><button type="button" class="btn" data-qr-more hidden>Show more entries</button>';
  renderRows(S,root);root.querySelector('[data-qr-table]').scrollTop=scroll;if(focused){const input=root.querySelector('[data-qr-search]');input.focus({preventScroll:true});input.setSelectionRange(selection,selection);}
  if(!root._qrBound){root._qrBound=true;
   root.addEventListener('input',e=>{if(e.target.hasAttribute('data-qr-search')){view.query=e.target.value;view.limit=40;renderRows(S,root);}});
   root.addEventListener('change',e=>{if(!e.target.hasAttribute('data-qr-approval'))return;try{if(root._qrSnapshot!==S.snapshot||root._qrBinding!==identity(S))throw Error('The hotel or records changed. Reopen this review list.');const id=e.target.dataset.qrApproval,row=root._qrRows.get('r-'+id);W.InGaugeWorkspace.queueReviewApprovals([id],e.target.checked,{[id]:row.fingerprint});}catch(error){errorAt(root,error);renderRows(S,root);}});
   root.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const act=async()=>{view.error='';const errorBox=root.querySelector('[data-qr-error]');if(errorBox){errorBox.hidden=true;errorBox.textContent='';}
    if(b.hasAttribute('data-qr-copy'))return W.InGaugeMonthlyAssistant?.copy(b.dataset.qrCopy);
    if(b.dataset.qrFilter){view.filter=b.dataset.qrFilter;view.limit=40;renderRows(S,root);return;}
    if(b.hasAttribute('data-qr-more')){view.limit+=40;renderRows(S,root);return;}
    if(b.hasAttribute('data-qr-apply'))return W.InGaugeWorkspace.showReviewSelection();
    if(b.hasAttribute('data-qr-monthly'))return W.InGaugeWorkspace.showMonthly();
    if(b.hasAttribute('data-qr-refresh'))return W.InGaugeWorkspace.refreshReviewList();
    if(b.dataset.qrScope)return W.InGaugeWorkspace.changeReviewScope(b.dataset.qrScope);
    if(root._qrSnapshot!==S.snapshot||root._qrBinding!==identity(S))throw Error('The hotel or records changed. Reopen this review list.');
    if(b.hasAttribute('data-qr-bulk')){const ids=root._qrEligible,expected=Object.fromEntries(ids.map(id=>[id,root._qrRows.get('r-'+id).fingerprint]));return W.InGaugeWorkspace.queueReviewApprovals(ids,true,expected);}
    const row=root._qrRows.get(b.dataset.qrId);if(!row)return;const ctx=context(S),action=b.dataset.qrAction;
    if(action==='selected')return W.InGaugeWorkspace.editSelectedChange(row.op.key,b);
    if(action==='unselect')return W.InGaugeWorkspace.unselectChange(row.op.key);
    if(action==='case'){if(row.item.canChooseBooking)return W.InGaugeWorkspace.chooseMoneyBooking(row.item.key,ctx);if(!row.item.canReview)throw Error(row.item.how);return W.InGaugeWorkspace.reviewMoneyDifference(row.item.key,{},ctx);}
    if(action==='review'&&row.draft)return W.InGaugeWorkspace.reviewListDraft(row.draft.key,b);
    const item=row.issues?.find(c=>c.canChooseBooking||c.canReview);
    if((action==='review'||action==='approve')&&item){if(item.canChooseBooking)return W.InGaugeWorkspace.chooseMoneyBooking(item.key,ctx);return W.InGaugeWorkspace.reviewMoneyDifference(item.key,{recordId:row.r.id},ctx);}
    return W.InGaugeWorkspace.reviewListRecord(row.r.id,action==='review'?'edit':action,b,row.fingerprint);
   };act().catch(error=>errorAt(root,error));});
  }
 }
 function errorAt(root,error){view.error=error.message;const box=root.querySelector('[data-qr-error]');if(box){box.hidden=false;box.textContent=error.message;box.scrollIntoView({block:'nearest'});}}
 W.InGaugeQuickReview={render,rows,context,casesFor,approvalIssue};
})(window);
