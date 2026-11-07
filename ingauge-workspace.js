// Opera reports -> live IN-Gauge snapshot -> explicit review -> exact selected operations.
(function(W){
  'use strict';
  const C=W.InGaugeAuditCore,D=document,el=id=>D.getElementById(id),E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dubai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const S={binding:null,discovery:null,snapshot:null,drafts:new Map(),selected:new Set(),view:'proposals',query:'',from:today().slice(0,7)+'-01',to:today(),busy:false,reviewed:false,readyHash:'',readyAt:0,job:null,tag:'',unwatch:null,error:'',editing:null,runMode:'',runShown:false,scope:'manual',analysisScope:'',analysisDone:false,autoAnalyse:false,history:[],historyLoading:false,historyError:''};
  const db=()=>typeof _ref!=='undefined'?_ref:null,hotel=()=>typeof HOTEL_ID!=='undefined'?String(HOTEL_ID):'',profile=()=>typeof currentProfile!=='undefined'?currentProfile:null;
  const allowed=()=>['owner','manager'].includes(profile()?.role),notify=(m,t)=>W.showToast?.(m,t),money=n=>Number.isSafeInteger(n)?(n/100).toFixed(2):'',hotelName=()=>el('hotelName')?.textContent.trim()||hotel();
  const list=v=>Array.isArray(v)?v:Object.values(v||{}),clone=v=>JSON.parse(JSON.stringify(v));
  async function digest(s){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
  async function github(suffix,options={}){
    const key=localStorage.getItem('ho_gh_start_key_v1');if(!key)throw Error('Set the GitHub start key in Neorcha → Run in the cloud. This workspace reuses it.');
    const r=await fetch('https://api.github.com/repos/ahmed0088/Depature-Tool/actions/workflows/ingauge-audit.yml'+suffix,{...options,headers:{Accept:'application/vnd.github+json','Content-Type':'application/json',Authorization:'Bearer '+key,'X-GitHub-Api-Version':'2022-11-28'}});
    if(!r.ok)throw Error('GitHub could not access this workflow ('+r.status()+'). Check the start key’s Actions access.');return r.status===204?null:r.json();
  }
  function invalidate(){S.reviewed=false;S.readyHash='';S.readyAt=0;}
  function currentPlan(){const operations=[...S.selected].map(k=>S.drafts.get(k)).filter(Boolean);if(operations.some(op=>!inScopeOperation(op)))throw Error('The selection contains a sale outside the chosen mode. Review it again.');return C.validatePlan({schema:2,mode:'apply',hotelId:hotel(),binding:S.binding,snapshotId:S.snapshot?.id,scope:S.scope,operations},S.snapshot);}
  function hydrate(s){s.records=list(s.records);s.products=list(s.products);s.contributors=list(s.contributors);if(s.invalidatedAt||!s.pagination?.verified||s.pagination.total!==s.records.length||s.pagination.read!==s.records.length)s.complete=false;return s;}
  async function job(plan,test=true){
    if(S.busy)throw Error('Wait for the current cloud job to finish.');if(restoring)throw Error('Restoring your last run. Please wait a moment.');if(!allowed()||!db())throw Error('An owner or manager must start this job.');
    const uid=W.firebase?.auth?.().currentUser?.uid;if(!uid)throw Error('Sign in before starting.');
    S.busy=true;renderScope();renderControls();renderConfiguration();
    try {
    await github('');const hash=await digest(C.stable(plan)),target=plan.binding?'ig-'+(await digest(C.stable(C.binding(plan.binding)))).slice(0,32):'discover-'+hotel();
    const tag='ig'+Date.now().toString(36)+crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
    const record={planJson:C.stable(plan),hash,test,scope:plan.scope||S.scope,approvedBy:uid,reviewedAt:Date.now(),state:'queued',results:[],tag};
    await db().child('ingauge/jobs/'+tag).set(record);await db().child('ingauge/latestJob').set(tag);S.runMode=plan.mode;S.tag=tag;S.job=record;S.busy=true;S.error='';
    if(W.hoRuns)await W.hoRuns.start('ingauge',tag,{hotel:plan.binding?.property||hotelName(),test,how:plan.mode==='apply'?scopeLabel(plan.scope||S.scope)+' · '+(test?'check':'apply'):plan.mode,from:plan.from||'',to:plan.to||'',n:plan.operations?.length||0});
    openRun();renderControls();
    try{await github('/dispatches',{method:'POST',body:JSON.stringify({ref:'main',inputs:{tag,hid:hotel(),plan_hash:hash,target_key:target,test:test?'1':'0'}})});}
    catch(error){S.busy=false;S.job={...record,state:'error',note:error.message};await db().child('ingauge/jobs/'+tag).update({state:'error',note:error.message});renderRun();throw error;}
    watchJob(tag,plan);return tag;
    }catch(error){S.busy=false;renderScope();renderControls();renderConfiguration();throw error;}
  }
  function watchJob(tag,plan){
    if(S.unwatch)S.unwatch();
    const ref=db().child('ingauge/jobs/'+tag);let finished=false;
    const callback=async snap=>{
      if(S.tag!==tag)return;const report=snap.val();if(!report)return;S.job=report;renderRun();
      if(!finished&&['done','error','stopped'].includes(S.job.state)){
        finished=true;S.busy=false;loadHistory();if(S.job.state!=='done')S.autoAnalyse=false;
        try{
          const test=report.test,hash=report.hash;
          if(plan.mode==='apply'&&typeof test!=='boolean')throw Error('The run’s readiness mode is missing. Refresh and check the selection again.');
          if(S.job.state==='done'&&plan.mode==='discover'){S.discovery=hydrateDiscovery(S.job.result);renderConfiguration();}
          if(S.job.state==='done'&&plan.mode==='snapshot'){
            const data=(await db().child('ingauge/snapshots/'+S.job.snapshotId).once('value')).val();if(!data?.complete||!C.sameBinding(data.binding,S.binding))throw Error('The fetched snapshot did not match this hotel.');
            S.snapshot=hydrate(data);S.drafts.clear();S.selected.clear();invalidate();importSnapshot();await db().child('ingauge/latestSnapshot').set(data.id);render();if(S.autoAnalyse){S.autoAnalyse=false;await analyseReports();}
          }
          if(plan.mode==='apply'&&test&&S.job.state==='done'){
            if(!/^[a-f0-9]{64}$/.test(hash||''))throw Error('The run’s reviewed-plan hash is missing. Check readiness again.');
            const checked=(await db().child('ingauge/tests/'+hash).once('value')).val();if(S.tag!==tag)return;S.readyHash=checked?.ready?hash:'';S.readyAt=checked?.at||0;
          }
          if(plan.mode==='apply'&&!test){if(S.snapshot&&list(S.job.results).some(r=>['applied','uncertain'].includes(r.state))){S.snapshot.complete=false;S.snapshot.invalidatedAt=Date.now();}invalidate();S.selected.clear();for(const r of list(S.job.results))if(['applied','unchanged'].includes(r.state)){const draft=S.drafts.get(r.key);if(draft)draft.completed=true;}renderProposals();}
        }catch(error){S.autoAnalyse=false;S.error=error.message;}renderScope();renderConfiguration();renderControls();renderRun();
      }
    };
    ref.on('value',callback);S.unwatch=()=>ref.off('value',callback);
    setTimeout(()=>poll(tag),12000);
  }
  async function poll(tag){if(S.tag!==tag||!S.busy)return;try{const data=await github('/runs?event=workflow_dispatch&per_page=20'),run=data.workflow_runs.find(r=>(r.display_title||'').includes(tag));if(run){S.job.run=run.html_url;renderRun();if(run.status==='completed'&&['queued','running'].includes(S.job.state)){const latest=(await db().child('ingauge/jobs/'+tag).once('value')).val();if(latest&&!['queued','running'].includes(latest.state))return;await db().child('ingauge/jobs/'+tag).update({state:'error',note:'The workflow ended without a final private report. Inspect its run before retrying.'});return;}}}catch(_){}setTimeout(()=>poll(tag),12000);}
  async function discover(){const url=C.portalUrl(el('igPortalUrl').value);await job({schema:2,mode:'discover',hotelId:hotel(),portalUrl:url},true);}
  async function saveBinding(){
    if(!allowed())throw Error('An owner or manager must link this hotel.');
    const property=el('igProperty').value,department=el('igDepartment').value,h=S.discovery?.hotels.find(h=>h.id===property),g=h?.departments.find(g=>g.id===department);
    if(!h||!g||!el('igBindConfirmed').checked)throw Error('Choose the property and department, then confirm the hotel link.');
    const brand=s=>(String(s).match(/ibis|adagio|mercure/i)||[''])[0].toLowerCase();if(brand(hotelName())&&brand(h.name)&&brand(hotelName())!==brand(h.name))throw Error('The selected brand differs from this HotelOps hotel. Switch to the correct hotel space first.');
    S.binding=C.binding({portalUrl:S.discovery.portalUrl,tenantId:h.tenantId,propertyId:h.id,departmentId:g.id,property:h.name,department:g.name});
    await db().child('ingauge/binding').set({...S.binding,linkedBy:W.firebase.auth().currentUser.uid,linkedAt:Date.now()});S.snapshot=null;S.drafts.clear();S.selected.clear();invalidate();render();el('igControls')?.scrollIntoView({behavior:'smooth',block:'center'});notify('Hotel linked. Next: choose dates and fetch live IN-Gauge.','ok');
  }
  async function fetchSnapshot(refreshReferenceData=false){if(!S.binding)throw Error('Link the exact IN-Gauge hotel first.');S.from=el('igFrom').value;S.to=el('igTo').value;if(!C.day(S.from)||!C.day(S.to)||S.from>S.to)throw Error('Choose a valid audit period.');await job({schema:2,mode:'snapshot',hotelId:hotel(),binding:C.binding(S.binding),from:S.from,to:S.to,...(refreshReferenceData?{refreshReferenceData:true}:{})},true);}
  function tableRows(snapshot){
    const head=['ID','Product','Product ID','Employee','Employee ID','Confirmation no','Room No','Product Charge','Charge Days','Arrival Date','Departure Date','Daily Date( Other Data )','Daily Date','Status','Currency','Tenant Location','Manually Added Record','Created By'];
    return [head,...snapshot.records.map(r=>[r.id,r.product,r.productId,r.seller||'-',r.contributorId,r.confirmation,r.room,r.unitCents===null?'':r.unitCents/100,r.chargeDays,r.arrival,r.departure,r.businessDate,r.businessDate,r.status,snapshot.settings.currency,snapshot.binding.property,r.isManuallyAddedRecord?'Yes':'No',r.raw?.cByIdentity||''])];
  }
  function importSnapshot(){
    if(!S.snapshot?.complete)return;
    const rows=tableRows(S.snapshot);
    if(W.ManualUpsells)W.ManualUpsells.useLiveSnapshot(S.snapshot,rows);
    if(typeof _pkgLastRows!=='undefined'&&typeof _pkgParseExcelUnknowns==='function'){
      _pkgLastRows.ig=rows;pkgUnknowns=_pkgParseExcelUnknowns(rows);pkgReportAt=S.snapshot.fetchedAt;
      const label=el('pkgExcelLabel');if(label)label.textContent='✓ Live IN-Gauge · '+pkgUnknowns.length+' records · '+S.binding.property;
      if(typeof _pkgRenderCoverage==='function')_pkgRenderCoverage();
    }
  }
  function draftFor(r,action='edit',source='Existing record'){
    return {key:'r-'+r.id,action,source,recordId:r.id,expected:C.fingerprint(r),confirmation:r.confirmation,productId:r.productId,contributorId:r.contributorId,values:C.values(r),statusAfter:r.status==='PENDING'?'PENDING':r.status==='APPROVED'?'APPROVED':'',reason:'',evidence:'Selected IN-Gauge record '+r.id};
  }
  function proposedAudit(r){
    const current=S.snapshot.records.find(x=>x.id===String(r.recordId||''));if(!current)return null;
    const op=draftFor(current,r.verdict==='deny'?'deny':'edit','Package Audit');op.operaLogin=r.originEvent?.user||'';op.evidence=[r.note,r.denyReason,r.memoryNote,r.originEvent?.user&&'Opera original seller: '+r.originEvent.user].filter(Boolean).join(' · ');
    if(op.action==='deny'){op.reason=r.denyReason||r.note||'Opera evidence does not support this charge.';return op;}
    if(r.needsProduct){const p=C.resolveProduct({code:r.matchedEvent?.code||r.code,kind:C.kind(r.matchedEvent?.code||r.code)},S.snapshot.products);op.productId=p.product?.id||'';}
    if(r.reassign||r.needsEmployee){const alias=typeof pkgStaffDb!=='undefined'?Object.values(pkgStaffDb):[],who=C.resolveSeller(r.originEvent?.user||r.user,S.snapshot.contributors,alias);op.contributorId=who.person?.id||'';op.evidence+=' · '+who.reason;}
    if(op.productId){const p=S.snapshot.products.find(p=>p.id===op.productId);try{op.values.totalCents=C.amountTotal(op.values,p,S.snapshot.settings);}catch(_){} }
    if(C.matches(op,current))return null;return op;
  }
  function buildProposals(){
    if(!S.snapshot)throw Error('Fetch live IN-Gauge records first.');S.drafts.clear();S.selected.clear();invalidate();
    if(S.scope!=='manual'&&typeof pkgResults!=='undefined')for(const row of pkgResults){if(!row.requestedSale&&['credit','deny','review'].includes(row.verdict)&&(!row.alreadyComplete||row.needsEmployee||row.needsProduct||row.reassign)){const op=proposedAudit(row);if(op)S.drafts.set(op.key,op);}}
    for(const row of S.scope==='automatic'?[]:W.ManualUpsells?.state.result?.rows||[]){
      if(row.bucket!=='add'&&!(row.bucket==='review'&&/^Not found in this export, but seller credit needs confirmation\./.test(row.reason)&&row.conf&&row.candidates.length===1&&!row.matches.length))continue;
      const p=C.resolveProduct({code:row.code,label:row.product},S.snapshot.products),who=C.resolveSeller(row.seller.employeeId||row.seller.name,S.snapshot.contributors);
      const values={unitCents:row.cents,totalCents:row.cents,chargeDays:1,arrival:row.day,departure:row.day,businessDate:row.day,room:row.room,memo:'Opera journal '+row.transaction+' · '+row.note};
      const op={key:'t-'+row.transaction,transaction:row.transaction,action:'add',source:'Opera manual sale',confirmation:row.conf,productId:p.product?.id||'',contributorId:who.person?.id||'',values,statusAfter:'PENDING',reason:'',requireAssignment:row.seller.basis!=='Opera note'||!row.seller.mapped,assignmentReviewed:false,evidence:row.seller.explanation+' · '+row.reason+' · Guest: '+row.guest+' · Room: '+row.room+' · Reservation stay: '+(row.candidates[0]?.TRUNC_BEGIN||'')+' → '+(row.candidates[0]?.TRUNC_END||'')+' · Opera posting user: '+(row.username||row.cashier)+' · Journal line '+row.line+' · '+row.note};
      S.drafts.set(op.key,op);
    }
    S.analysisScope=S.scope;S.analysisDone=true;S.view='proposals';render();
  }
  const scopeLabel=scope=>({manual:'Manual upsells only',automatic:'Automatic packages only',all:'Manual + automatic'}[scope]||'Both');
  function inScopeRecord(record){return C.scopeAllows(S.scope,C.saleCategory(record));}
  function inScopeOperation(op){return !!S.snapshot&&C.scopeAllows(S.scope,C.operationCategory(op,S.snapshot));}
  function reportRequirements(){
    const missing=[],data=W.ManualUpsells?.state.data||{};
    if(S.scope!=='automatic'&&!data.journal)missing.push('Opera Journal');
    if(S.scope!=='automatic'&&!data.reservations)missing.push('Reservation Detail');
    if(S.scope!=='manual'&&!(typeof pkgEvents!=='undefined'&&Object.keys(pkgEvents).length&&typeof pkgPdfFiles!=='undefined'&&new Set(pkgPdfFiles).size>=2))missing.push('Changes Logs: New Reservation + Update Reservation');
    return missing;
  }
  function clearReview(){S.drafts.clear();S.selected.clear();S.analysisScope='';S.analysisDone=false;invalidate();}
  function setScope(scope){
    if(!['manual','automatic','all'].includes(scope))throw Error('Choose one of the three audit modes.');
    if(S.busy||restoring)throw Error('Wait for the current run to finish before changing mode.');
    if(scope===S.scope)return;S.scope=scope;S.autoAnalyse=false;clearReview();S.view='proposals';S.query='';S.error='';
    try{localStorage.setItem('ho_ingauge_scope_v1:'+hotel(),scope);}catch(_){}render();
  }
  async function checkReports(){
    if(S.busy)throw Error('Wait for the current run to finish.');
    const missing=reportRequirements();if(missing.length)throw Error('Add these reports first: '+missing.join(' · '));
    S.from=el('igFrom')?.value||S.from;S.to=el('igTo')?.value||S.to;
    if(!C.day(S.from)||!C.day(S.to)||S.from>S.to)throw Error('Choose valid From and Through dates.');
    if(!S.binding)throw Error('Connect this HotelOps hotel to IN-Gauge first.');
    const current=S.snapshot?.complete&&C.sameBinding(S.snapshot.binding,S.binding)&&S.snapshot.from===S.from&&S.snapshot.to===S.to&&Date.now()-S.snapshot.fetchedAt<=21600000;
    if(!current){S.autoAnalyse=true;try{await fetchSnapshot();}catch(error){S.autoAnalyse=false;throw error;}return;}
    await analyseReports();
  }
  async function analyseReports(){
    if(!S.snapshot?.complete)throw Error('Fetch a complete IN-Gauge snapshot first.');
    const missing=reportRequirements();if(missing.length)throw Error('Add these reports first: '+missing.join(' · '));
    if(S.scope!=='automatic'&&W.ManualUpsells.state.busy)throw Error('Wait for the Opera report to finish loading.');
    S.busy=true;clearReview();renderScope();renderControls();
    try{
      importSnapshot();
      if(S.scope!=='automatic'){await W.ManualUpsells.run();if(W.ManualUpsells.state.error)throw Error(W.ManualUpsells.state.error);}
      if(S.scope!=='manual'){
        if(typeof pkgRun==='function'&&typeof pkgUnknowns!=='undefined'&&pkgUnknowns.length)await pkgRun();
        else if(typeof pkgResults!=='undefined')pkgResults=[];
      }
      buildProposals();
    }finally{S.busy=false;render();}
  }

  function fromAudit(recordId){open();const source=S.snapshot?.records.find(r=>r.id===String(recordId));if(source&&!inScopeRecord(source)){S.error='This record is outside '+scopeLabel(S.scope)+'. Choose Automatic packages or Both to review it.';renderControls();return;}if(!S.snapshot){notify('Fetch the live IN-Gauge snapshot to review this record.','warn');return;}const rows=typeof pkgResults!=='undefined'?pkgResults:[],row=rows.find(r=>String(r.recordId)===String(recordId)),op=row&&proposedAudit(row);if(op){S.drafts.set(op.key,op);edit(op.key);}else{S.view='records';S.query=recordId;renderProposals();}}
  async function upload(kind,selection){
    const files=selection&&typeof selection.length==='number'&&!selection.name?Array.from(selection):selection?[selection]:[];
    if(!files.length)return;S.error='';clearReview();renderControls();renderProposals();
    if(kind==='changes'){
      await pkgLoadPdf({files});
      const loaded=typeof pkgPdfFiles!=='undefined'?pkgPdfFiles:[];
      const missing=files.filter(file=>!loaded.includes(file.name));
      invalidate();renderControls();
      const label=el('igFile-changes');if(label)label.textContent=loaded.length?'✓ '+loaded.length+' log'+(loaded.length===1?'':'s')+' loaded · '+loaded.join(' · '):'Choose both Changes Log PDFs';
      if(missing.length)throw Error('These Changes Logs were not loaded: '+missing.map(f=>f.name).join(', ')+'. Check the PDF message and try those files again.');
      return;
    }
    const file=files[0];
    await W.ManualUpsells.load(kind,file);
    if(!W.ManualUpsells.state.data[kind])throw Error(W.ManualUpsells.state.error||'This report could not be loaded.');
    if(kind==='reservations'&&typeof pkgLoadGuests==='function')await pkgLoadGuests({files:[file]});
    if(kind==='journal'){const days=W.ManualUpsells.state.data.journal?.rows.map(r=>W.ManualUpsells.date(r.BUSINESS_DATE)).filter(Boolean).sort();if(days?.length){S.from=days[0];S.to=days.at(-1);}}
    invalidate();renderControls();const label=el('igFile-'+kind);if(label)label.textContent='✓ '+file.name;
  }
  function edit(k){const op=S.drafts.get(k);if(!op)return;S.editing=clone(op);paintEditor();}
  function editRecord(id,action){const r=S.snapshot?.records.find(r=>r.id===String(id));if(!r)return;if(!inScopeRecord(r))throw Error('This record is outside the chosen audit mode.');const op=draftFor(r,action);S.drafts.set(op.key,op);edit(op.key);}
  // Use an ordinary searchable sheet: phone webviews can fail to open native select popups.
  let pickerSource=null,pickerReturn=null;
  function closePicker(){const sheet=el('igPicker');if(sheet)sheet.hidden=true;const back=pickerReturn;if(back)back.setAttribute('aria-expanded','false');pickerSource=null;pickerReturn=null;if(back?.isConnected)back.focus({preventScroll:true});}
  function pickerRows(query=''){
    const root=el('igPickerOptions');if(!root||!pickerSource)return;
    const options=[...pickerSource.options].filter(o=>!o.disabled&&o.value&&o.textContent.toLowerCase().includes(query.toLowerCase()));
    root.innerHTML=options.length?options.map(o=>`<button type="button" role="option" aria-selected="${o.selected}" data-ig-pick-value="${E(o.value)}"><span>${E(o.textContent)}</span><b aria-hidden="true">${o.selected?'✓':''}</b></button>`).join(''):'<p class="iga-hint">No matching options. Try another name.</p>';
  }
  function openPicker(source,button){
    if(source.disabled)return;pickerSource=source;pickerReturn=button;
    let sheet=el('igPicker');if(!sheet){sheet=D.createElement('div');sheet.id='igPicker';sheet.className='iga-overlay iga-picker-overlay';sheet.hidden=true;D.body.appendChild(sheet);
      sheet.addEventListener('click',e=>{if(e.target===sheet||e.target.closest('[data-ig-picker-close]'))closePicker();const row=e.target.closest('[data-ig-pick-value]');if(!row||!pickerSource)return;const source=pickerSource;source.value=row.dataset.igPickValue;source.dispatchEvent(new Event('change',{bubbles:true}));refreshPickers(source.parentNode);closePicker();});
      sheet.addEventListener('input',e=>{if(e.target.id==='igPickerSearch')pickerRows(e.target.value);});
      sheet.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closePicker();}if(['ArrowDown','ArrowUp'].includes(e.key)){const items=[...sheet.querySelectorAll('[data-ig-pick-value]')];if(!items.length)return;e.preventDefault();const i=items.indexOf(D.activeElement);items[(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length].focus();}if(e.key==='Tab'){const items=[...sheet.querySelectorAll('button,input')],first=items[0],last=items.at(-1);if(e.shiftKey&&D.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&D.activeElement===last){e.preventDefault();first.focus();}}});
    }
    const title=source.closest('label')?.firstChild?.textContent?.trim()||'Choose an option';
    sheet.innerHTML=`<section class="iga-editor iga-picker" role="dialog" aria-modal="true" aria-labelledby="igPickerTitle"><header><h2 id="igPickerTitle">${E(title)}</h2><button type="button" data-ig-picker-close aria-label="Close choices">×</button></header><div class="iga-picker-search"><label for="igPickerSearch">Search ${E(title.toLowerCase())}</label><input id="igPickerSearch" type="search" autocomplete="off" placeholder="Type a name…"></div><div id="igPickerOptions" role="listbox" aria-labelledby="igPickerTitle"></div></section>`;
    sheet.hidden=false;button.setAttribute('aria-expanded','true');pickerRows();sheet.querySelector('[data-ig-picker-close]').focus({preventScroll:true});
  }
  function refreshPickers(root){
    if(!root)return;for(const source of root.querySelectorAll('select')){
      let button=source.nextElementSibling;if(!button?.classList.contains('iga-choice')){button=D.createElement('button');button.type='button';button.className='iga-choice';button.setAttribute('aria-haspopup','dialog');button.addEventListener('click',()=>openPicker(source,button));source.after(button);source.classList.add('iga-native-select');source.tabIndex=-1;source.setAttribute('aria-hidden','true');source.addEventListener('change',()=>refreshPickers(source.parentNode));}
      button.setAttribute('aria-label',(source.closest('label')?.firstChild?.textContent?.trim()||'Choose')+': '+(source.selectedOptions[0]?.textContent||'Choose…'));button.disabled=source.disabled;button.setAttribute('aria-expanded',String(pickerSource===source));button.innerHTML=`<span>${E(source.selectedOptions[0]?.textContent||'Choose…')}</span><b aria-hidden="true">⌄</b>`;
    }
  }
  function option(values,selected,label){return values.map(p=>`<option value="${E(p.id)}" ${p.id===selected?'selected':''}>${E(label(p))}</option>`).join('');}
  function paintEditor(){
    const op=S.editing;if(!op)return;const before=S.snapshot.records.find(r=>r.id===op.recordId),financial=['add','edit'].includes(op.action),currency=S.snapshot.settings.currency;
    let modal=el('igEditor');if(!modal){modal=D.createElement('div');modal.id='igEditor';modal.className='iga-overlay';D.body.appendChild(modal);modal.addEventListener('click',e=>{if(e.target===modal||e.target.closest('[data-ig-cancel]'))closeEditor();else if(e.target.closest('[data-ig-save]'))saveEditor().catch(error=>{el('igEditError').textContent=error.message;});});}
    const people=S.snapshot.contributors.filter(p=>p.activeStatus==='NORMAL'||p.id===before?.contributorId);
    modal.innerHTML=`<section class="iga-editor" role="dialog" aria-modal="true" aria-labelledby="igEditTitle"><header><div><span class="iga-eyebrow">${E(op.source)}</span><h2 id="igEditTitle">${E(op.action==='add'?'Add missing sale':op.action==='edit'?'Review package changes':op.action+' request')}</h2><p>Confirmation ${E(op.confirmation)} · ${E(S.binding.property)}</p></div><button type="button" data-ig-cancel aria-label="Close review">×</button></header><div class="iga-editor-body">
      ${before?`<div class="iga-before"><b>Currently in IN-Gauge · #${E(before.id)}</b><p>${E(before.product)} · ${E(before.seller||'Unassigned')} · ${E(currency)} ${money(before.totalCents)} · ${E(before.status)}</p></div>`:''}
      <p class="iga-evidence">${E(op.evidence)}</p><div class="iga-fields">
      ${financial?`<label>Product<select id="igEditProduct"><option value="">Choose the exact product…</option>${option(S.snapshot.products.filter(p=>p.activeStatus==='NORMAL'&&!/unknown|unmapped/i.test(p.code+' '+p.name)),op.productId,p=>p.name+(p.sku?' · '+p.sku:''))}</select></label>
      <label>Credit to<select id="igEditPerson"><option value="">Choose a contributor…</option>${before&&!before.contributorId?'<option value="0">Keep unassigned</option>':''}${option(people,op.contributorId,p=>p.name+' · '+p.pulseId+(p.activeStatus!=='NORMAL'?' · historical/inactive':''))}</select></label>
      <label>Unit / daily charge · ${E(currency)}<input id="igEditUnit" inputmode="decimal" value="${E(money(op.values.unitCents))}"></label><label>Charge days<input id="igEditDays" type="number" min="1" max="3660" value="${E(op.values.chargeDays)}"></label>
      <label>Arrival<input id="igEditArrival" type="date" value="${E(op.values.arrival)}"></label><label>Departure<input id="igEditDeparture" type="date" value="${E(op.values.departure)}"></label><label>Business date<input id="igEditDay" type="date" value="${E(op.values.businessDate)}"></label><label>Room<input id="igEditRoom" value="${E(op.values.room)}"></label>
      <label>Resulting status<select id="igEditStatus"><option value="">Choose resulting status…</option><option ${op.statusAfter==='PENDING'?'selected':''}>PENDING</option><option ${op.statusAfter==='APPROVED'?'selected':''}>APPROVED</option></select></label><label class="iga-wide">Memo<textarea id="igEditMemo" rows="2">${E(op.values.memo)}</textarea></label>`:''}
      <label class="iga-wide">${['deny','delete'].includes(op.action)?'Required reason':'Review note (optional)'}<textarea id="igEditReason" rows="2" placeholder="Explain why this change is needed">${E(op.reason)}</textarea></label></div>
      ${financial&&op.operaLogin?`<label class="iga-confirm"><input type="checkbox" id="igRememberAlias"><span>Remember Opera login <b>${E(op.operaLogin)}</b> as the selected contributor for this hotel’s future audits.</span></label>`:''}<p class="iga-hint">${financial?'The total follows this hotel’s '+E(S.snapshot.settings.validation)+' setting. Daily business-date records use the unit charge as their daily total.':'This changes the status of the selected existing record. No replacement record is created.'}</p>
      <p id="igEditError" class="iga-error" role="alert"></p><footer><button class="btn" data-ig-cancel>Cancel</button><button class="btn gold" data-ig-save>Save to review list</button></footer></div></section>`;
    refreshPickers(modal);modal.hidden=false;modal.querySelector('button')?.focus({preventScroll:true});
  }
  function closeEditor(){closePicker();if(el('igEditor'))el('igEditor').hidden=true;S.editing=null;}
  async function saveEditor(){
    const op=S.editing;if(!op)return;
    if(['add','edit'].includes(op.action)){
      op.productId=el('igEditProduct').value;op.contributorId=el('igEditPerson').value;op.statusAfter=el('igEditStatus').value;
      op.values={unitCents:C.cents(el('igEditUnit').value),chargeDays:Number(el('igEditDays').value),arrival:el('igEditArrival').value,departure:el('igEditDeparture').value,businessDate:el('igEditDay').value,room:el('igEditRoom').value.trim(),memo:el('igEditMemo').value.trim()};
      try{op.values.totalCents=C.amountTotal(op.values,S.snapshot.products.find(p=>p.id===op.productId),S.snapshot.settings);}catch(error){el('igEditError').textContent=error.message;return;}
    }
    op.reason=el('igEditReason').value.trim();op.assignmentReviewed=true;const error=C.operationError(op,S.snapshot);if(error){el('igEditError').textContent=error;return;}
    if(op.operaLogin&&el('igRememberAlias')?.checked){const person=S.snapshot.contributors.find(p=>p.id===op.contributorId);if(!person||person.activeStatus!=='NORMAL'||!allowed())throw Error('Choose an active contributor before saving an alias.');const current=typeof pkgStaffDb!=='undefined'?Object.entries(pkgStaffDb).find(([k,s])=>s.contributorId===person.id||s.name===person.name):null;const staffKey=current?.[0]||'ig_'+person.id,previous=current?.[1]||{};const value={...previous,name:person.name,contributorId:person.id,logins:[...new Set([...(previous.logins||[]),op.operaLogin])],status:'active'};await db().child('packageAudit/staff/'+staffKey).set(value);if(typeof pkgStaffDb!=='undefined'){pkgStaffDb={...pkgStaffDb,[staffKey]:value};_pkgApplyStaff();}}
    S.drafts.set(op.key,op);S.selected.delete(op.key);invalidate();closeEditor();S.view='proposals';renderProposals();renderControls();
  }
  async function startApply(){
    if(!S.reviewed)throw Error('Review the selected hotel, confirmations, sellers, amounts and resulting statuses first.');
    // Live preflight runs inside the same cloud job, before each reviewed operation.
    await job(currentPlan(),false);
  }

  function renderConfiguration(){
    const root=el('igConfiguration');if(!root)return;
    const bound=S.binding;root.innerHTML=`<p class="iga-guidance"><b>${bound?'Hotel connected':'Connect your hotel once'}</b> · ${bound?E(bound.property):S.discovery?'Choose the correct hotel and Front Desk below.':'Press Connect IN-Gauge. A progress window will open here.'}</p><details ${bound?'':'open'}><summary>${bound?'Linked to '+E(bound.property)+' · '+E(bound.department):'Connect this hotel to IN-Gauge'}</summary><p class="iga-hint">This HotelOps space: <b>${E(hotelName())}</b>. Account passwords stay in GitHub secrets.</p><div class="iga-config"><label>Portal URL<input id="igPortalUrl" type="url" value="${E(S.discovery?.portalUrl||bound?.portalUrl||'https://app.fpg-ingauge.com/')}"></label><button class="btn" data-ig-discover ${S.busy||restoring?'disabled':''}>Connect IN-Gauge</button></div>
      ${S.discovery?`<div class="iga-fields"><label>Exact property<select id="igProperty"><option value="">Choose hotel…</option>${option(S.discovery.hotels,bound?.propertyId||'',h=>h.name+' · ID '+h.id)}</select></label><label>Department<select id="igDepartment"></select></label></div><label class="iga-confirm"><input type="checkbox" id="igBindConfirmed"><span>I am linking this HotelOps space to the exact IN-Gauge hotel selected above.</span></label><button class="btn" data-ig-bind>Save hotel link</button>`:''}</details>`;
    if(S.discovery)renderDepartments();refreshPickers(root);
  }
  function renderDepartments(){const h=S.discovery?.hotels.find(h=>h.id===el('igProperty')?.value),field=el('igDepartment');if(field)field.innerHTML='<option value="">Choose department…</option>'+option((h?.departments||[]).filter(d=>!d.retail&&!d.fnb),S.binding?.departmentId||'',g=>g.name);refreshPickers(el('igConfiguration'));}
  function renderScope(){
    const root=el('igScope');if(!root)return;
    root.innerHTML=`<h3 class="iga-section-title">1. What do you want to fix?</h3><div class="iga-scope-options" role="group" aria-label="Choose audit mode">${[
      ['manual','Manual upsells only','Find missing journal sales and review manual requests.'],
      ['automatic','Automatic packages only','Fix imported packages, products and seller credit.'],
      ['all','Both','Review manual upsells and automatic packages together.']
    ].map(([key,title,description])=>`<button type="button" class="iga-scope-option ${S.scope===key?'on':''}" data-ig-scope="${key}" aria-pressed="${S.scope===key}" ${S.busy||restoring?'disabled':''}><b>${title}</b><span>${description}</span>${S.scope===key?'<small>Selected</small>':''}</button>`).join('')}</div>`;
    D.querySelectorAll('[data-ig-upload]').forEach(label=>{const input=label.querySelector('input');if(input)input.disabled=S.busy||restoring;label.hidden=label.dataset.igUpload==='journal'&&S.scope==='automatic'||label.dataset.igUpload==='changes'&&S.scope==='manual';});
    const help=el('igReportHelp');if(help)help.textContent=S.scope==='manual'?'Required: Opera Journal + Reservation Detail. Changes Log PDFs are not needed for this mode.':S.scope==='automatic'?'Required: both Changes Log PDFs (New Reservation + Update Reservation). Reservation Detail is recommended for matching extensions.':'Required: Opera Journal + Reservation Detail + both Changes Log PDFs.';
  }
  function renderControls(){
    const root=el('igControls');if(!root)return;const snapshot=S.snapshot,missing=reportRequirements();
    const mainLabel=S.scope==='manual'?'Find manual upsells':S.scope==='automatic'?'Check automatic packages':'Check manual + automatic';
    root.innerHTML=`<div class="iga-period"><label>From<input id="igFrom" type="date" value="${E(S.from)}" ${S.busy?'disabled':''}></label><label>Through<input id="igTo" type="date" value="${E(S.to)}" ${S.busy?'disabled':''}></label><button class="btn gold" data-ig-check ${!S.binding||missing.length||S.busy?'disabled':''}>${mainLabel}</button></div>
      <p class="iga-hint">${!S.binding?'Connect your hotel above first.':missing.length?'Add the required reports above: '+E(missing.join(' · ')):'Ready to check. Current IN-Gauge data is fetched automatically when needed.'}</p>
      ${snapshot&&!snapshot.complete?'<p class="iga-error">Live data needs refreshing. Press the check button after adding your reports, or use Refresh live IN-Gauge below.</p>':''}
      <details class="iga-data-details"><summary>IN-Gauge data and refresh</summary>${snapshot?`<div class="iga-snapshot"><span>${snapshot.complete?'✓ All pages verified':'Refresh required'}</span><b>${E(snapshot.binding.property)}</b><small>${snapshot.records.length} records · ${E(snapshot.from)} → ${E(snapshot.to)}</small></div>`:'<p class="iga-hint">Data is fetched for your chosen hotel and dates when you check reports.</p>'}<p class="iga-hint">Packages and sellers are saved privately for this hotel for up to 24 hours. Sales, permissions and final financial checks stay live.${snapshot?.referenceData?' '+Object.entries(snapshot.referenceData).map(([kind,m])=>(kind==='products'?'Packages':'Sellers')+': '+(m.cached?'reused':'refreshed')+' '+new Date(m.fetchedAt).toLocaleString('en-GB',{timeZone:'Asia/Dubai'})).map(E).join(' · '):''}</p><button class="btn" data-ig-refresh-reference ${!S.binding||S.busy?'disabled':''}>Refresh packages &amp; sellers</button> <button class="btn" data-ig-fetch ${!S.binding||S.busy?'disabled':''}>${snapshot?'Refresh':'Fetch'} live IN-Gauge</button></details>
      <div class="iga-reviewbar"><div><b>3. Review and apply · ${E(scopeLabel(S.scope))}</b><small>${S.selected.size} selected changes</small></div>${S.analysisDone?'<p class="iga-hint">Review each suggested change. You can select ready suggestions together; held cases need your attention first.</p><button type="button" class="btn" data-ig-select-ready '+(S.busy?'disabled':'')+'>Select ready suggestions</button>':''}<label class="iga-confirm"><input id="igReviewed" type="checkbox" ${S.reviewed?'checked':''} ${!S.selected.size||S.busy?'disabled':''}><span>I reviewed the hotel, selected sales, sellers and amounts.</span></label><div class="iga-actions"><button class="btn gold" data-ig-apply ${!S.reviewed||!S.selected.size||S.busy?'disabled':''}>Apply ${S.selected.size} selected changes</button></div><p class="iga-hint">Live safety checks run automatically before each change. Cases that fail checks are held and explained in your results.</p></div>
      ${S.error?`<p class="iga-error" role="alert">${E(S.error)}</p>`:''}`;
  }
  function renderProposals(){
    const root=el('igProposals');if(!root)return;
    const drafts=S.snapshot?[...S.drafts.values()].filter(inScopeOperation):[],records=S.snapshot?.records.filter(inScopeRecord)||[],pending=records.filter(r=>r.status==='PENDING');
    const visible=S.view==='proposals'?drafts:S.view==='pending'?pending:records;
    const q=S.query.toLowerCase(),rows=visible.filter(r=>!q||[r.confirmation,r.recordId,r.id,r.product,r.seller,r.evidence].some(v=>String(v||'').toLowerCase().includes(q))).slice(0,80);
    root.innerHTML=`<div class="iga-tabs" role="tablist">${[['proposals','Suggested changes',drafts.length],...(S.scope==='automatic'?[]:[['pending','Manual requests',pending.length]]),['records','Find an existing sale',records.length]].map(([k,n,count])=>`<button type="button" role="tab" aria-selected="${S.view===k}" class="${S.view===k?'on':''}" data-ig-view="${k}">${n}<span>${count}</span></button>`).join('')}</div><label class="iga-search"><span>Search confirmation, product or seller</span><input id="igSearch" type="search" value="${E(S.query)}" placeholder="Confirmation number…"></label>
      <div class="iga-list">${rows.length?rows.map(r=>{
        if(S.view!=='proposals')return `<article class="iga-card"><header><div><b>Confirmation ${E(r.confirmation)}</b><p>${C.saleCategory(r)==='manual'?'Manual upsell':'Automatic package'} · ${E(r.product)} · ${E(r.seller||'Unassigned')}</p></div><span class="iga-status">${E(r.status)}</span></header><div class="iga-facts"><span>${E(S.snapshot.settings.currency)} ${money(r.totalCents)}</span><span>${E(r.businessDate)}</span><span>Room ${E(r.room||'—')}</span><span>ID ${E(r.id)}</span></div><div class="iga-actions">${r.status==='PENDING'?`<button class="btn" data-ig-record="${E(r.id)}" data-ig-action="approve">Review approval</button>`:''}<button class="btn" data-ig-record="${E(r.id)}" data-ig-action="edit">Review edit / replace</button><button class="iga-text" data-ig-record="${E(r.id)}" data-ig-action="deny">Review denial</button><button class="iga-text" data-ig-record="${E(r.id)}" data-ig-action="delete">Review removal</button></div></article>`;
        const error=C.operationError(r,S.snapshot),before=S.snapshot.records.find(x=>x.id===r.recordId),product=S.snapshot.products.find(p=>p.id===r.productId),person=S.snapshot.contributors.find(p=>p.id===r.contributorId);
        return `<article class="iga-card ${error?'held':''}"><header><label class="iga-select"><input type="checkbox" data-ig-select="${E(r.key)}" ${S.selected.has(r.key)?'checked':''} ${error||r.completed||S.busy?'disabled':''}><span><small>${C.operationCategory(r,S.snapshot)==='manual'?'Manual upsell':'Automatic package'} · ${E(r.source)}</small><b>Confirmation ${E(r.confirmation)}</b></span></label><span class="iga-status">${r.completed?'VERIFIED':E(r.action.toUpperCase())}</span></header><div class="iga-change"><div><small>Currently</small><p>${before?E(before.product)+' · '+E(before.seller||'Unassigned'):'Missing sale'}</p><b>${before?E(before.status)+' · '+E(S.snapshot.settings.currency)+' '+money(before.totalCents):'No new request confirmed'}</b></div><span aria-hidden="true">→</span><div><small>Proposed</small><p>${['add','edit'].includes(r.action)?E(product?.name||'Choose product')+' · '+E(person?.name||'Choose contributor'):E(r.action==='approve'?'Approve existing request':r.action==='deny'?'Deny existing request':'Remove existing request')}</p><b>${['add','edit'].includes(r.action)?E(r.statusAfter)+' · '+E(S.snapshot.settings.currency)+' '+money(r.values.totalCents):E(r.action==='approve'?'APPROVED':r.action==='deny'?'DENIED':'PURGED')}</b></div></div><details><summary>Evidence and explanation</summary><p>${E(r.evidence)}</p>${r.reason?'<p>Reason: '+E(r.reason)+'</p>':''}<p>${r.recordId?'Existing record ID '+E(r.recordId):'Opera transaction '+E(r.transaction)} · ${E(r.values?.businessDate||before?.businessDate||'')}</p></details>${error?'<p class="iga-error">'+E(error)+'</p>':''}<button class="btn" data-ig-edit="${E(r.key)}">Review details / assignment</button></article>`;
      }).join(''):`<div class="iga-empty"><b>${S.analysisDone?'No suggested changes for this mode':S.snapshot?'Ready for your reports':'Choose a mode and add reports'}</b><p>${S.analysisDone?'Already matching sales need no update. Cases that need more matching or evidence remain in the detailed Audit and Manual sales views.':'Choose the reports for this mode, then press the check button. You can also review existing requests.'}</p></div>`}</div>${visible.length>80?'<p class="iga-hint">Showing up to 80 matches. Search a confirmation to narrow the list.</p>':''}`;
  }
  function hydrateDiscovery(value){if(!value)return null;return {...value,hotels:list(value.hotels).map(h=>({...h,departments:list(h.departments)}))};}
  const actionLabel=action=>({add:'Added',edit:'Edited / fixed',approve:'Approved',deny:'Denied',delete:'Removed'})[action]||action||'Change';
  function resultSummary(results){const counts={applied:0,unchanged:0,tested:0,held:0,uncertain:0};for(const r of results)if(r.state in counts)counts[r.state]++;return `<div class="iga-result-tally" role="status">${Object.entries({add:'Added',edit:'Edited / fixed',approve:'Approved',deny:'Denied',delete:'Removed'}).map(([action,label])=>{const count=results.filter(r=>r.state==='applied'&&r.action===action).length;return count?`<span><b>${count}</b> ${label}</span>`:'';}).join('')}${[['applied','Verified changes'],['unchanged','Already correct'],['tested','Readiness passed'],['held','Held — not sent'],['uncertain','Needs verification']].filter(([k])=>counts[k]).map(([k,label])=>`<span><b>${counts[k]}</b> ${label}</span>`).join('')}</div>`;}
  function historyValues(value){if(!value)return '<p>No previous record</p>';return `<p>${E(value.product||value.productId||'')} · ${E(value.seller||value.contributorId||'')}<br>${E(value.status||'')} · Unit ${E(money(value.unitCents))} · Total ${E(money(value.totalCents))}<br>${E(value.chargeDays??'')} days · Room ${E(value.room||'—')}<br>Stay ${E(value.arrival||'—')} → ${E(value.departure||'—')}<br>Business date ${E(value.businessDate||'—')}<br>Memo: ${E(value.memo||'(blank)')}</p>`;}
  function resultDetails(r){return `${r.differences?.length?`<div class="iga-error">${list(r.differences).map(d=>`<p><b>${E(d.field)}</b>: requested ${E(d.expected??'(empty)')} · returned ${E(d.actual??'(empty)')}</p>`).join('')}</div>`:''}${r.before||r.requested||r.after?`<details><summary>Before, requested and final values</summary><div class="iga-history-values"><div><b>Before</b>${historyValues(r.before)}</div><div><b>Requested</b>${historyValues(r.requested)}</div>${r.after?`<div><b>Observed in IN-Gauge</b>${historyValues(r.after)}</div>`:''}</div>${r.reason?`<p>Why: ${E(r.reason)}</p>`:''}</details>`:''}`;}
  async function loadHistory(){
    if(!allowed()||!db()||S.historyLoading)return;const hid=hotel();S.historyLoading=true;S.historyError='';renderHistory();
    try{const rows=(await db().child('ingauge/jobs').orderByChild('reviewedAt').limitToLast(40).once('value')).val();if(hotel()!==hid)return;S.history=Object.entries(rows||{}).map(([tag,j])=>({...j,tag})).filter(j=>{try{const p=JSON.parse(j.planJson);return p.mode==='apply'&&p.hotelId===hid;}catch(_){return false;}}).sort((a,b)=>b.reviewedAt-a.reviewedAt);}
    catch(error){S.historyError=error.message;}finally{S.historyLoading=false;renderHistory();}
  }
  function renderHistory(){
    const root=el('igHistory');if(!root)return;root.innerHTML=`<header><div><h3>Change history</h3><p class="iga-hint">Saved runs for this HotelOps hotel, including readiness checks and changes. Older entries show the evidence saved at the time.</p></div><button class="btn" data-ig-history ${S.historyLoading?'disabled':''}>${S.historyLoading?'Loading…':'Refresh history'}</button></header>${S.historyError?`<p class="iga-error">${E(S.historyError)}</p>`:''}${S.history.length?S.history.map(j=>{let plan;try{plan=JSON.parse(j.planJson);}catch(_){return '';}const results=list(j.results),terminal=['done','error','stopped'].includes(j.state);return `<details class="iga-history-run"><summary><b>${E(new Date(j.reviewedAt).toLocaleString('en-GB',{timeZone:'Asia/Dubai'}))}</b> · ${j.test?'Readiness check':'Reviewed changes'} · ${E(terminal?'Finished':'In progress')} · ${results.length}/${plan.operations.length}</summary><p>${E(plan.binding?.property)} · ${E(scopeLabel(plan.scope||'all'))}<br>${E(j.note||j.state)}</p>${resultSummary(results)}${results.map(row=>{const op=plan.operations.find(o=>o.key===row.key),r={...row};if(op&&!r.requested){const product=S.snapshot?.products.find(p=>p.id===op.productId),person=S.snapshot?.contributors.find(p=>p.id===op.contributorId);r.requested={...op.values,status:op.statusAfter,product:product?.name||op.productId,seller:person?.name||op.contributorId};try{r.before=op.expected?JSON.parse(op.expected):null;}catch(_){}r.reason=op.reason||op.evidence||'';}const live=S.snapshot?.records.find(x=>x.id===(r.recordId||op?.recordId));const reconciled=r.state==='uncertain'&&live&&op&&S.snapshot.complete&&C.sameBinding(S.snapshot.binding,plan.binding)&&S.snapshot.fetchedAt>(j.at||j.reviewedAt)&&C.matches(op,live);if(reconciled)r.after=live;return `<article><b>Confirmation ${E(r.confirmation)} · ${E(actionLabel(r.action||op?.action))}</b><p>${reconciled?'✓ Verified by the latest refresh; the saved values match your reviewed change.':r.state==='applied'?'✓ Saved and verified':r.state==='held'?'Held; no request sent':r.state==='uncertain'?'Request sent; final outcome needs verification':E(r.state)}${r.recordId?' · Record '+E(r.recordId):''}<br>${E(r.note||'')}</p>${resultDetails(r)}</article>`;}).join('')}${terminal&&results.length<plan.operations.length?`<p>${plan.operations.length-results.length} remaining changes were not attempted.</p>`:''}</details>`;}).join(''):'<p class="iga-hint">No saved changes loaded yet. Refresh history to see earlier runs.</p>'}`;
  }
  const runTitle=()=>S.runMode==='discover'?'Connect IN-Gauge':S.runMode==='snapshot'?'Fetch IN-Gauge records':S.job?.test?'Check selected changes':'Apply reviewed changes';
  function closeRun(){S.runShown=false;if(el('igRunWindow'))el('igRunWindow').hidden=true;W.hoRuns?.minimized?.('ingauge');}
  let cancellingTag='';
  async function cancelRun(){
    const tag=S.tag;if(!tag||!S.job||!['queued','running'].includes(S.job.state)||S.job.stopRequested||cancellingTag===tag)return;
    if(!allowed()||!db())throw Error('An owner or manager must cancel this automation.');
    cancellingTag=tag;S.autoAnalyse=false;renderRun();
    try{await db().child('ingauge/jobs/'+tag).update({stopRequested:true,stopRequestedAt:Date.now(),stopRequestedBy:W.firebase?.auth?.().currentUser?.uid||''});if(S.tag===tag){S.job={...S.job,stopRequested:true};renderRun();}}
    finally{if(cancellingTag===tag)cancellingTag='';renderRun();}
  }
  function openRun(){open();S.runShown=true;let modal=el('igRunWindow');if(!modal){modal=D.createElement('div');modal.id='igRunWindow';modal.className='iga-overlay';modal.hidden=true;D.body.appendChild(modal);modal.addEventListener('click',e=>{if(e.target===modal||e.target.closest('[data-ig-run-close]'))closeRun();else if(e.target.closest('[data-ig-stop]'))cancelRun().catch(error=>{notify(error.message,'err');S.error=error.message;renderControls();});else if(e.target.closest('[data-ig-run-next]')){closeRun();const target=S.runMode==='discover'?'igConfiguration':S.runMode==='snapshot'&&!S.analysisDone?'igControls':'igProposals';el(target)?.scrollIntoView({behavior:'smooth',block:'start'});if(S.runMode==='discover'){const details=el('igConfiguration')?.querySelector('details');if(details)details.open=true;el('igProperty')?.focus();}}});}modal.hidden=false;renderRun();}
  function renderRun(){
    const box=el('igRunBox');if(!box)return;const j=S.job;if(!j){box.hidden=true;return;}box.hidden=false;
    const terminal=['done','error','stopped'].includes(j.state),success=j.state==='done',results=list(j.results);
    const next=success?(S.runMode==='snapshot'&&S.analysisDone?'Your '+scopeLabel(S.scope)+' results are ready. Review the suggested changes below.':S.runMode==='discover'?'Choose your hotel and Front Desk, then Save hotel link.':S.runMode==='snapshot'?'The records are loaded. Upload Opera reports, then Check Opera reports.':j.test?'This earlier check finished without changing financial records. Review your selection before applying.':'Review the results below, then refresh IN-Gauge before another audit.') : '';
    const stopping=!terminal&&(j.stopRequested||cancellingTag===S.tag),label=stopping?'Cancelling':success?'Completed':j.state==='error'?'Stopped with a problem':j.state==='stopped'?'Stopped':j.state==='queued'?'Starting cloud computer':'Working';
    const signature=JSON.stringify([S.tag,j.state,j.note,j.stage,j.trace,j.results,j.stopRequested,cancellingTag===S.tag,next]);
    if(box.dataset.signature!==signature){box.dataset.signature=signature;box.innerHTML=`<header><div><span class="iga-eyebrow">IN-GAUGE CLOUD RUN</span><h3>${E(runTitle())} · ${E(label)}</h3></div><div class="iga-actions"><button class="btn" data-ig-open-run>Show progress</button>${!terminal?`<button type="button" class="btn" data-ig-stop ${stopping?'disabled':''}>${stopping?'Cancel requested':'Cancel automation'}</button>`:''}</div></header><p>${E(stopping?'Cancel requested. Stopping at the next safe point; an already sent request will be verified.':j.note||'Starting the cloud computer. Browser setup and sign-in can take a moment.')}</p>${next?`<p class="iga-next"><b>Next step</b> ${E(next)}</p>`:''}`;}
    const modal=el('igRunWindow');if(!modal||!S.runShown)return;
    if(modal.dataset.signature===signature)return;modal.dataset.signature=signature;
    const trace=list(j.trace),progress=terminal?100:Math.max(5,Math.min(90,({starting:8,open:15,login:25,account:40,hotels:55,products:65,contributors:75,records:85})[j.stage]||5));
    modal.innerHTML=`<section class="iga-editor iga-run-window" role="dialog" aria-modal="true" aria-labelledby="igRunTitle"><header><div><span class="iga-eyebrow">${terminal?'FINISHED RUN':'LIVE CLOUD RUN'}</span><h2 id="igRunTitle">${E(runTitle())}</h2><p>${E(label)} · ${j.test?'Read-only check':'Reviewed changes'}</p></div><button type="button" data-ig-run-close aria-label="Close progress">×</button></header><div class="iga-editor-body"><div class="iga-run-status ${success?'done':''}"><span class="iga-run-indicator" aria-hidden="true">${success?'✓':terminal?'!':'◌'}</span><p role="status">${E(stopping?'Cancel requested. Stopping at the next safe point; an already sent request will be verified.':j.note||'Starting the cloud computer. Browser setup and sign-in can take a moment.')}</p></div><progress max="100" value="${progress}" aria-label="Run stage"></progress>${next?`<div class="iga-next"><b>Next step</b><p>${E(next)}</p><button type="button" class="btn gold" data-ig-run-next>${S.runMode==='discover'?'Choose hotel':S.runMode==='snapshot'?(S.analysisDone?'Review suggested changes':'Check Opera reports'):'Return to review list'}</button></div>`:''}
      <details class="iga-run-log" open><summary>Activity</summary><ol>${trace.map(t=>`<li><time>${E(new Date(t.at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'Asia/Dubai'}))}</time><span>${E(t.note)}</span></li>`).join('')||'<li>Waiting for the cloud computer to report its first step…</li>'}</ol></details>
      ${results.length?`${resultSummary(results)}<div class="iga-run-results">${results.map(r=>`<div><b>${E(r.confirmation)}</b><span>${E(r.state)}</span><p>${E(actionLabel(r.action))} · ${E(r.note)}</p>${resultDetails(r)}${r.recordId?'<small>Record '+E(r.recordId)+'</small>':''}</div>`).join('')}</div>`:''}
      <p class="iga-hint">Close window keeps the automation running; reopen it from Cloud runs. Cancel automation stops before the next change. A request already sent is verified and kept in history; it cannot be undone here.</p>${j.run?`<details><summary>Technical details</summary><p><a href="${E(j.run)}" target="_blank" rel="noopener">GitHub diagnostic log ↗</a></p></details>`:''}</div><footer><button type="button" class="btn" data-ig-run-close>${terminal?'Close':'Close window'}</button>${!terminal?`<button type="button" class="btn" data-ig-stop ${stopping?'disabled':''}>${stopping?'Cancel requested':'Cancel automation'}</button>`:''}</footer></section>`;
  }
  function render(){renderHistory();renderScope();renderConfiguration();renderControls();renderProposals();renderRun();}
  function open(){mount();restoreHotel().catch(error=>{S.error=error.message;renderControls();});if(W.showPanel)W.showPanel('package-audit');for(const id of ['pkgMainView','pkgRulesView','pkgMemoryView','pkgSettingsView','muView','manualUpsellView'])if(el(id))el(id).hidden=true;el('igWorkspace').hidden=false;D.querySelectorAll('#pkgTabs [data-v]').forEach(b=>{const on=b.dataset.v==='ingauge';b.classList.toggle('on',on);b.setAttribute('aria-selected',String(on));});render();}
  let restoredHotel='',restoring=false;
  async function restoreHotel(){
    if(!db()||!hotel()||restoring||restoredHotel===hotel())return;
    const hid=hotel(),ref=db();restoring=true;
    try {
      if(restoredHotel&&restoredHotel!==hid){if(S.unwatch)S.unwatch();S.binding=null;S.discovery=null;S.snapshot=null;S.drafts.clear();S.selected.clear();S.job=null;S.busy=false;S.history=[];S.historyError='';invalidate();}
      const binding=(await ref.child('ingauge/binding').once('value')).val();
      const latest=(await ref.child('ingauge/latestSnapshot').once('value')).val();
      const snapshot=latest&&(await ref.child('ingauge/snapshots/'+latest).once('value')).val();
      if(hotel()!==hid)return;
      try{const mode=localStorage.getItem('ho_ingauge_scope_v1:'+hid);if(['manual','automatic','all'].includes(mode))S.scope=mode;}catch(_){}
      S.binding=binding;
      let latestTag=(await ref.child('ingauge/latestJob').once('value')).val();
      let job=latestTag&&(await ref.child('ingauge/jobs/'+latestTag).once('value')).val();
      if(!job){const jobs=(await ref.child('ingauge/jobs').orderByChild('reviewedAt').limitToLast(1).once('value')).val();const last=Object.entries(jobs||{})[0];if(last){latestTag=last[0];job=last[1];}}
      const discovery=(await ref.child('ingauge/discovery').once('value')).val();
      if(hotel()!==hid)return;
      if(discovery)S.discovery=hydrateDiscovery(discovery);
      if(job){let plan;try{plan=JSON.parse(job.planJson);}catch(_){}if(plan?.hotelId===hid){S.tag=latestTag;S.job=job;S.runMode=plan.mode;S.busy=['queued','running'].includes(job.state);if(plan.mode==='discover'&&job.state==='done'&&job.result)S.discovery=hydrateDiscovery(job.result);if(S.busy)watchJob(latestTag,plan);}}
      if(snapshot?.complete&&snapshot.hotelId===hid&&C.sameBinding(snapshot.binding,binding)){S.snapshot=hydrate(snapshot);S.from=snapshot.from;S.to=snapshot.to;importSnapshot();}
      restoredHotel=hid;render();loadHistory();
    }finally{restoring=false;renderScope();renderConfiguration();renderControls();}
  }
  function mount(){
    const tabs=el('pkgTabs'),main=el('pkgMainView');if(!tabs||!main)return false;if(el('igWorkspace'))return true;
    const tab=D.createElement('button');tab.type='button';tab.dataset.v='ingauge';tab.setAttribute('role','tab');tab.textContent='IN-Gauge automation';tab.onclick=open;tabs.insertBefore(tab,tabs.querySelector('[data-v="rules"]'));
    tabs.addEventListener('click',e=>{const v=e.target.closest('[data-v]');if(v&&v.dataset.v!=='ingauge')el('igWorkspace').hidden=true;},true);
    const root=D.createElement('section');root.id='igWorkspace';root.className='iga';root.hidden=true;
    root.innerHTML=`<div class="iga-hero"><div><span class="iga-eyebrow">PACKAGE AUDIT + MANUAL SALES</span><h2>Fix your upsells.<br><em>Choose, check, review.</em></h2><p>Choose the type of sales, add the matching Opera reports, then review the suggested changes before applying.</p></div><ol><li>Choose what to fix</li><li>Add reports and check</li><li>Review and apply</li></ol></div><div id="igScope"></div><div id="igConfiguration" class="iga-panel"></div>
      <h3 class="iga-section-title">2. Add your Opera reports</h3><p id="igReportHelp" class="iga-hint"></p><div class="iga-uploads">${[['journal','Opera journal','.txt,.tsv','Manual charges and original notes'],['reservations','Reservation Detail','.txt,.tsv','Confirmations, guests, rooms and dates'],['changes','Opera Changes Logs · both PDFs','.pdf,.PDF','New Reservation + Update Reservation · select both, or add one at a time']].map(([k,n,a,h])=>`<label class="iga-upload" data-ig-upload="${k}"><span>${n}</span><small>${h}</small><input type="file" data-ig-file="${k}" accept="${a}" ${k==='changes'?'multiple':''}><b id="igFile-${k}">Choose report</b></label>`).join('')}</div>
<div id="igControls"></div><div id="igProposals"></div><section id="igRunBox" class="iga-panel" hidden></section><section id="igHistory" class="iga-panel iga-history"></section>`;
    main.parentNode.insertBefore(root,main.nextSibling);
    root.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const act=async()=>{S.error='';if(b.hasAttribute('data-ig-history'))await loadHistory();else if(b.dataset.igScope)setScope(b.dataset.igScope);else if(b.hasAttribute('data-ig-select-ready')){S.selected.clear();for(const op of S.drafts.values())if(inScopeOperation(op)&&!op.completed&&!C.operationError(op,S.snapshot))S.selected.add(op.key);invalidate();renderProposals();renderControls();}else if(b.hasAttribute('data-ig-open-run'))openRun();else if(b.hasAttribute('data-ig-discover'))await discover();else if(b.hasAttribute('data-ig-bind'))await saveBinding();else if(b.hasAttribute('data-ig-refresh-reference'))await fetchSnapshot(true);else if(b.hasAttribute('data-ig-fetch'))await fetchSnapshot();else if(b.hasAttribute('data-ig-check'))await checkReports();else if(b.hasAttribute('data-ig-apply'))await startApply();else if(b.dataset.igView){S.view=b.dataset.igView;renderProposals();}else if(b.dataset.igEdit)edit(b.dataset.igEdit);else if(b.dataset.igRecord)editRecord(b.dataset.igRecord,b.dataset.igAction);else if(b.hasAttribute('data-ig-stop'))await cancelRun();};act().catch(error=>{S.error=error.message;renderControls();notify(error.message,'err');});});
    root.addEventListener('change',e=>{
      if(e.target.dataset.igFile&&e.target.files[0])upload(e.target.dataset.igFile,Array.from(e.target.files)).catch(error=>{S.error=error.message;renderControls();}).finally(()=>{e.target.value='';});
      else if(e.target.id==='igProperty')renderDepartments();
      else if(e.target.id==='igReviewed'){S.reviewed=e.target.checked;renderControls();}
      else if(e.target.dataset.igSelect){e.target.checked?S.selected.add(e.target.dataset.igSelect):S.selected.delete(e.target.dataset.igSelect);invalidate();renderControls();}
      else if(e.target.id==='igFrom')S.from=e.target.value;else if(e.target.id==='igTo')S.to=e.target.value;
    });
    root.addEventListener('input',e=>{if(e.target.id==='igSearch'){const pos=e.target.selectionStart;S.query=e.target.value;renderProposals();const i=el('igSearch');i.focus();try{i.setSelectionRange(pos,pos);}catch(_){}}});
    D.addEventListener('keydown',e=>{if(e.key==='Escape'){if(S.editing)closeEditor();else if(S.runShown)closeRun();}});

    render();return true;
  }
  W.InGaugeWorkspace={state:S,setScope,checkReports,reportRequirements,loadHistory,renderHistory,open,openRun,closeRun,cancelRun,renderRun,fromAudit,upload,mount,tableRows,buildProposals,hydrate};
  if(D.readyState==='loading')D.addEventListener('DOMContentLoaded',mount);else mount();
})(window);
