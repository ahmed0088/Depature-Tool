// Reviewed manual sales -> private HotelOps job -> cloud runner. No passwords in the app.
(function(W){
  'use strict';
  const Core=W.ManualSalesCore, S={selected:new Set(),plan:null,hash:'',confirmed:false,testReady:false,busy:false,mode:'run',live:null,job:null,unlisten:null,poll:null};
  const el=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const M=()=>W.ManualUpsells;
  const profile=()=>typeof currentProfile!=='undefined'?currentProfile:null;
  const permitted=()=>!!profile()&&['owner','manager'].includes(profile().role);
  const hotel=()=>typeof HOTEL_ID!=='undefined'?String(HOTEL_ID||''):'';
  const db=()=>typeof _ref!=='undefined'?_ref:null;
  const money=n=>(n/100).toFixed(2);
  const toast=(m,t)=>{if(W.showToast)W.showToast(m,t);};
  const resetSelection=()=>{S.selected.clear();S.plan=null;S.hash='';S.confirmed=false;S.testReady=false;};
  async function digest(plan){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(Core.canonical(plan)));return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');}
  function property(){const names=[...new Set((M()?.state.data.ingauge?.rows||[]).map(r=>String(r['Tenant Location']||'').trim()).filter(Boolean))];if(names.length!==1)throw new Error('Use an IN-Gauge export for exactly one property before automating.');return names[0];}
  async function github(path,options={}){
    const key=localStorage.getItem('ho_gh_start_key_v1');if(!key)throw new Error('Set up the GitHub start key in Neorcha → Run in the cloud first. This runner reuses that key.');
    const response=await fetch('https://api.github.com/repos/ahmed0088/Depature-Tool/actions/workflows/manual-sales.yml'+path,{...options,headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+key,'Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'}});
    if(!response.ok)throw new Error('GitHub could not start or read this run ('+response.status+'). Check the start key has Actions read/write access.');return response.status===204?null:response.json();
  }
  function render(){
    const root=el('msuResults');if(!root)return;
    let box=el('msuAutomation');
    if(!M()?.state.result){if(box)box.remove();return;}
    if(!box){box=document.createElement('div');box.id='msuAutomation';box.className='msu-automation';const anchor=root.querySelector('.msu-list-head');root.insertBefore(box,anchor);}
    const rows=M().state.result.rows;
    for(const transaction of [...S.selected])if(!rows.some(r=>r.transaction===transaction&&!Core.eligibility(r)))S.selected.delete(transaction);
    root.querySelectorAll('.msu-sale[data-ms-transaction]').forEach(card=>{
      if(card.querySelector('.msa-select'))return;
      const row=rows.find(r=>r.transaction===card.dataset.msTransaction);if(!row||row.bucket!=='add')return;
      const reason=Core.eligibility(row),label=document.createElement('label');label.className='msa-select';
      label.innerHTML=`<input type="checkbox" data-msa-select="${esc(row.transaction)}" ${S.selected.has(row.transaction)?'checked':''} ${reason||!permitted()?'disabled':''}><span>${reason?esc(reason):permitted()?'Select for reviewed automation':'An owner or manager can select this sale for automation.'}</span>`;
      card.insertBefore(label,card.firstChild);
    });
    const count=S.selected.size;
    box.innerHTML=`<div><span class="msu-eyebrow">REVIEWED AUTOMATION</span><h3>${count?count+' sale'+(count===1?'':'s')+' selected':'Select the sales you want to submit'}</h3><p>Review → test the live portal → submit selected requests as Pending. Existing requests are checked again before every addition.</p></div><div class="msa-actions"><button type="button" class="btn gold" data-msa-review ${!count||S.busy?'disabled':''}>Review selected${count?' · '+count:''}</button>${S.live?'<button type="button" class="btn" data-msa-open>Run status</button>':''}</div>`;
  }
  function modal(){
    let win=el('msuRunWindow');if(win)return win;
    win=document.createElement('div');win.id='msuRunWindow';win.className='msa-window';
    win.innerHTML='<div class="msa-backdrop" data-msa-minimize></div><section class="msa-dialog" role="dialog" aria-modal="true" aria-labelledby="msaTitle"><header><div><span class="msu-eyebrow">MANUAL SALES</span><h2 id="msaTitle">Review selected sales</h2></div><div><button type="button" data-msa-minimize aria-label="Minimise">−</button><button type="button" data-msa-close aria-label="Close">×</button></div></header><div class="msa-body" id="msaBody"></div></section>';
    document.body.appendChild(win);return win;
  }
  function openRun(){S.mode='run';modal().classList.add('on');paintRun();}
  async function review(){
    if(S.busy)return;
    try{
      if(!permitted())throw new Error('An owner or manager must review this selection.');
      if(!db())throw new Error('Connect to the hotel database before starting a cloud run.');
      const plan=Core.buildPlan(M().state.result?.rows||[],S.selected,{hotelId:hotel(),property:property()}),hash=await digest(plan);
      if(S.hash!==hash)S.confirmed=false;
      S.plan=plan;S.hash=hash;const checked=(await db().child('manualSalesTests/'+hash).once('value')).val();S.testReady=!!checked?.ready&&Date.now()-checked.at<3600000;
      S.mode='review';modal().classList.add('on');paintReview();
    }catch(error){toast(error.message,'err');}
  }
  function paintReview(){
    if(!S.plan)return;
    el('msaTitle').textContent='Review '+S.plan.sales.length+' selected sale'+(S.plan.sales.length===1?'':'s');
    el('msaBody').innerHTML=`<p class="msa-property">${esc(S.plan.property)} · ${S.plan.sales.length} request${S.plan.sales.length===1?'':'s'} · AED ${money(S.plan.sales.reduce((n,r)=>n+r.cents,0))} net</p>
      <div class="msa-review-list">${S.plan.sales.map(r=>`<article><div><b>Confirmation ${esc(r.conf)}</b><span>Room ${esc(r.room)} · ${esc(r.product)}</span></div><strong>AED ${money(r.cents)}</strong><p>${esc(r.seller)} · ${esc(r.day)} · 1 charge day</p><details><summary>Why this sale?</summary>${M().evidenceHtml(M().state.result.rows.find(x=>x.transaction===r.transaction))}</details></article>`).join('')}</div>
      <label class="msa-confirm"><input type="checkbox" id="msaReviewed" ${S.confirmed?'checked':''}><span>I reviewed these confirmation numbers, sellers, dates and net amounts.</span></label>
      <p class="msa-hint">The test opens IN-Gauge and checks the live search and form without submitting. Submit is available after a successful test for this exact selection. A request will remain Pending for approval.</p>
      <div class="msa-actions"><button type="button" class="btn" data-msa-test ${!S.confirmed||S.busy?'disabled':''}>Test selected · no submissions</button><button type="button" class="btn gold" data-msa-submit ${!S.confirmed||!S.testReady||S.busy?'disabled':''}>Submit selected as Pending</button></div>
      <details class="msa-setup"><summary>First-time cloud setup</summary><p>In <a href="https://github.com/ahmed0088/Depature-Tool/settings/secrets/actions" target="_blank" rel="noopener">GitHub Actions secrets</a>, add <code>INGAUGE_EMAIL</code> and <code>INGAUGE_PASS</code>. The runner also uses the existing <code>HOTELOPS_EMAIL</code> and <code>HOTELOPS_PASS</code>, belonging to an active owner or manager for this hotel.</p><p>It connects only to <a href="https://app.fpg-ingauge.com/" target="_blank" rel="noopener">app.fpg-ingauge.com</a>. If sign-in needs an interactive code or the form has changed, the test stops for review. Passwords are never entered in HotelOps or chat.</p><p>Early check-in and late checkout are supported. Breakfast quantity and recurring charge dates stay in manual review.</p></details>`;
  }
  async function start(test){
    if(S.busy||!S.confirmed||!S.plan||(!test&&!S.testReady))return;
    S.busy=true;
    let tag;
    try{
      // Rebuild from current results: a changed report or selection cannot reuse an old approval.
      const plan=Core.buildPlan(M().state.result?.rows||[],S.selected,{hotelId:hotel(),property:property()}),hash=await digest(plan);
      if(hash!==S.hash)throw new Error('The selection changed. Review it again.');
      const uid=W.firebase?.auth?.().currentUser?.uid;if(!uid||!permitted()||!db())throw new Error('Sign in as an owner or manager before starting.');
      // Check the start key before creating a queued job. No guest data is sent to GitHub.
      await github('');
      tag='ms'+Date.now().toString(36)+crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
      const job={tag,planJson:Core.canonical(plan),hash,test,approvedBy:uid,reviewedAt:Date.now(),state:'queued',stopRequested:false,results:[]};
      await db().child('manualSalesJobs/'+tag).set(job);
      const saved=(await db().child('manualSalesJobs/'+tag).once('value')).val();if(saved?.hash!==hash)throw new Error('The reviewed selection was not confirmed by the hotel database.');
      if(W.hoRuns)await W.hoRuns.start('manual',tag,{hotel:plan.property,n:plan.sales.length,test,how:'reviewed selection'});
      S.live={tag,state:'run',test,n:plan.sales.length,done:0,note:'Queued for the cloud runner',at:Date.now()};S.job=job;
      await db().child('manualSalesLive').set(S.live);
      await github('/dispatches',{method:'POST',body:JSON.stringify({ref:'main',inputs:{tag,hid:hotel(),plan_hash:hash,test:test?'1':'0'}})});
      watchJob(tag);openRun();pollGithub(tag);
    }catch(error){
      if(tag&&db()){await db().child('manualSalesJobs/'+tag).update({state:'error',note:error.message,at:Date.now()}).catch(()=>{});await db().child('manualSalesLive').update({tag,state:'error',note:error.message,at:Date.now()}).catch(()=>{});await db().child('cloudRuns/'+tag).update({state:'error',note:'Cloud start failed',at:Date.now()}).catch(()=>{});}
      toast(error.message,'err');
    }finally{S.busy=false;render();}
  }
  function watchJob(tag){
    if(S.unlisten)S.unlisten();if(!db())return;
    const ref=db().child('manualSalesJobs/'+tag),callback=snapshot=>{S.job=snapshot.val();if(S.mode==='run'&&el('msuRunWindow')?.classList.contains('on'))paintRun();};ref.on('value',callback);S.unlisten=()=>ref.off('value',callback);
  }
  function paintRun(){
    if(!S.live){el('msaTitle').textContent='Manual sales run';el('msaBody').innerHTML='<p>No run has started yet.</p>';return;}
    const job=S.job||{},live=S.live,terminal=['done','error','stopped'].includes(job.state||live.state),results=Array.isArray(job.results)?job.results:Object.values(job.results||{}),state=job.state||live.state;
    el('msaTitle').textContent=(live.test?'Test':'Submission')+' · '+(terminal?'finished':state==='queued'?'queued':'running');
    el('msaBody').innerHTML=`<p class="msa-hint">${esc(job.note||live.note||'Checking the selected sales…')}</p><div class="msa-progress"><span style="width:${Math.min(100,Math.round(results.length/Math.max(1,live.n)*100))}%"></span></div><p class="msa-property">${results.length} / ${live.n||0} sales checked${live.test?' · test only, no submissions':''}</p><div class="msa-run-results">${results.map(r=>`<article><b>Confirmation ${esc(r.conf)}</b><span>${esc({tested:'Tested · nothing submitted',submitted:'Submitted · Pending',already_exists:'Already submitted',needs_review:'Needs review',unclear:'Outcome uncertain'}[r.state]||r.state)}</span><p>${esc(r.note)}</p>${r.recordId?'<small>IN-Gauge ID '+esc(r.recordId)+'</small>':''}</article>`).join('')}</div><div class="msa-actions">${terminal?'<button type="button" class="btn" data-msa-review>Return to selection</button>':'<button type="button" class="btn" data-msa-stop>Stop before next submission</button>'}${live.run?`<a class="btn" href="${esc(live.run)}" target="_blank" rel="noopener">GitHub run ↗</a>`:''}</div><p class="msa-hint">Closing this window leaves the run in Cloud run history. Upload a fresh IN-Gauge report after adding or approving requests.</p>`;
  }
  async function pollGithub(tag){
    clearTimeout(S.poll);
    try{
      const data=await github('/runs?event=workflow_dispatch&per_page=20'),run=data.workflow_runs.find(r=>(r.display_title||'').includes(tag));
      if(run&&S.live?.tag===tag)S.live.run=run.html_url;
      if(run?.status==='completed'&&S.job&&['queued','running'].includes(S.job.state)){
        await db().child('manualSalesJobs/'+tag).update({state:'error',note:'The cloud workflow ended before confirming its final report. Check GitHub and any uncertain entry before retrying.',at:Date.now()});
        await db().child('manualSalesLive').update({tag,state:'error',note:'Cloud workflow ended; check its result before retrying.',at:Date.now()});
      }
      if(run?.status==='completed')return;
    }catch(_){}
    if(S.live?.tag===tag&&!['done','error','stopped'].includes(S.job?.state))S.poll=setTimeout(()=>pollGithub(tag),6000);
  }
  function boot(){
    document.addEventListener('change',event=>{
      const input=event.target;
      if(input.dataset.msaSelect){if(input.checked)S.selected.add(input.dataset.msaSelect);else S.selected.delete(input.dataset.msaSelect);S.confirmed=false;S.testReady=false;render();}
      if(input.id==='msaReviewed'){S.confirmed=input.checked;paintReview();}
    });
    document.addEventListener('click',event=>{
      const button=event.target.closest('[data-msa-review],[data-msa-open],[data-msa-test],[data-msa-submit],[data-msa-stop],[data-msa-close],[data-msa-minimize]');if(!button||button.disabled)return;
      if(button.hasAttribute('data-msa-review'))review();else if(button.hasAttribute('data-msa-open'))openRun();else if(button.hasAttribute('data-msa-test'))start(true);else if(button.hasAttribute('data-msa-submit'))start(false);
      else if(button.hasAttribute('data-msa-stop')&&S.live&&db())db().child('manualSalesJobs/'+S.live.tag).update({stopRequested:true}).then(()=>toast('Stop requested; the runner stops before the next submission.','ok')).catch(()=>toast('Stop request could not be saved.','err'));
      else {el('msuRunWindow')?.classList.remove('on');if(W.hoRuns&&S.live)(button.hasAttribute('data-msa-close')?W.hoRuns.closed:W.hoRuns.minimized)('manual');}
    });
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&el('msuRunWindow')?.classList.contains('on')){el('msuRunWindow').classList.remove('on');if(W.hoRuns&&S.live)W.hoRuns.minimized('manual');}});
    render();
    let tries=0;const listen=()=>{if(!db()){if(tries++<100)setTimeout(listen,1500);return;}const ref=db().child('manualSalesLive');ref.on('value',snapshot=>{const next=snapshot.val();if(!next)return;const changed=S.live?.tag!==next.tag;S.live=next;if(changed)watchJob(next.tag);render();if(S.mode==='run'&&el('msuRunWindow')?.classList.contains('on'))paintRun();});};listen();
  }
  W.ManualSalesAutomation={render,review,openRun,resetSelection,state:S};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})(window);
