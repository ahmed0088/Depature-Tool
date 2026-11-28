// ═══════════════════════════════════════════════════════════
//  immig-fixer.js — "Fix in Opera" card on the Immigration Check page
//  Builds a plan of EMPTY gender / nationality / ID fields from the Opera immigration report and the
//  Vicas Inhouse list (matched by room + name), lets him edit and approve each field, and copies only
//  the approved ones for the Opera profile fixer (tools/hotelops-opera-fixer.console.js).
//  · ID numbers stay in this tab's memory: never saved to the database, never logged (last 4 only).
//  · Gender / nationality decisions and the change log are shared per hotel (hotels/<id>/immigFix, immigFixLog).
//  · Nothing here writes to Opera.
// ═══════════════════════════════════════════════════════════
(function () {
  'use strict';
  const C = window.hoImmigFix; if (!C || !window.hoOperaAuto) return;
  const S = { plan: null, ok: {}, shared: {}, uaeType: '', opera: '', scope: '5', links: {}, selectedHotel: '', linkBusy: false };
  const A = window.hoOperaAuto;
  const lsKey = () => 'hoOperaUrl_' + (typeof HOTEL_ID !== 'undefined' ? HOTEL_ID : '');   // ok: { itemId: { field: true } }
  const esc = s => (typeof escapeHtml === 'function' ? escapeHtml(s) : String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));
  const db = () => { try { return typeof firebase !== 'undefined' && typeof HOTEL_ID !== 'undefined' && HOTEL_ID ? firebase.database() : null; } catch (_) { return null; } };
  const key = it => (it.room + '_' + String(it.arrival || '').replace(/[^0-9]/g, '')).replace(/[.#$\[\]\/]/g, '');
  const toast = (m, t) => { if (typeof showToast === 'function') showToast(m, t || 'ok'); };

  function build() {
    const rows = typeof immigAllRows2 !== 'undefined' ? immigAllRows2 : [];
    const list = typeof _immigInhouseList !== 'undefined' ? _immigInhouseList : [];
    const meta = typeof _immigMeta !== 'undefined' ? _immigMeta : {};
    S.plan = C.buildPlan(rows, list, { hotel: meta.hotel, businessDate: meta.biz, uaeIdType: S.uaeType });
    S.ok = {};
    S.plan.items.forEach(it => {
      const sh = S.shared[key(it)] || {};
      S.ok[it.id] = {};
      it.fields.forEach(f => {
        const saved = sh[f.field];
        if (saved && (f.field === 'gender' || f.field === 'nationality') && saved.value) { f.value = saved.value; f.display = f.field === 'nationality' ? saved.value + ' · ' + ((C.countryList().find(c => c.code === saved.value) || {}).name || '') : saved.value; f.source = 'saved by ' + (saved.by || 'the team'); S.ok[it.id][f.field] = !!saved.on; }
        else S.ok[it.id][f.field] = !f.needsTap && !!f.value;
      });
    });
  }
  function cloudPanelHtml(){
    const selected=(S.plan?.items||[]).filter(it=>selectedFields(it).length).length;
    return '<section id="immigCloudBox" class="imm-run"><div class="imm-cloud-heading"><div><div class="imm-eyebrow">GITHUB CLOUD</div><h2>Run selected fixes</h2></div><span id="immigCloudState" class="imm-state">Ready</span></div><p class="imm-cloud-sub">Your computer can stay off.</p><p class="imm-run-hotel" id="immigCloudHotel"></p><div class="imm-selection" id="immigSelectionCount">'+selected+' guests · '+approvedCount()+' fields selected</div>'+
      '<div class="imm-run-actions"><label class="imm-scope" for="immigRunScope">Guests to fix<select id="immigRunScope"><option value="5"'+(S.scope==='5'?' selected':'')+'>First 5 selected guests</option><option value="all"'+(S.scope==='all'?' selected':'')+'>All selected guests</option></select></label><button class="btn gold imm-big" id="immigCloudOne">'+(S.scope==='all'?'Fix selected guests':'Fix first 5 guests')+'</button></div>'+
      '<p class="imm-small">Saves the ticked details to guest profiles. It never overwrites a value and never touches folios, postings or cashiering.</p>'+
      '<ol class="imm-run-steps" id="immigCloudSteps" aria-label="Automation progress"><li data-cloud-step="0">Connect</li><li data-cloud-step="1">Sign in</li><li data-cloud-step="2">Fix details</li><li data-cloud-step="3">Results</li></ol>'+
      '<div id="immigCloudStartMsg" class="imm-run-note" role="status" aria-live="polite"></div>'+
      '<div id="immigCloudCodeBox" class="imm-code" hidden><b>Enter your authentication code</b><p class="imm-small" id="immigCloudWant"></p><p class="imm-code-time" id="immigCloudTime" role="timer" aria-live="off"></p><p class="imm-small">Your authenticator has its own code timer. If that code is about to change, wait for the next one before typing it here.</p><div class="imm-row"><input id="immigCloudCode" aria-label="Six-digit authentication code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" placeholder="6-digit code"><button class="btn gold" id="immigCloudSend">Send code</button></div></div>'+
      '<div id="immigCloudRes" class="imm-result" aria-live="polite"></div>'+
      '<div id="immigCloudKeyRow" class="imm-setup-key" style="display:none"><b>Connect cloud automation on this device</b><p class="imm-small">Use the same start key as Neorcha. You only need to save it once.</p><div class="imm-row"><input id="immigCloudKey" type="password" aria-label="GitHub start key" autocomplete="off" placeholder="Paste your GitHub start key"><button class="btn" id="immigCloudKeySave">Save key</button></div></div>'+
      '<details class="imm-more" id="immigCloudAdv"><summary>Connection help & details</summary><div class="imm-support-actions"><button class="btn" id="immigCloudStartSignin">Check Opera sign-in only</button><button class="btn" id="immigCloudStartAudit">Preview without saving</button><a id="immigCloudRunLink" class="btn" target="_blank" rel="noopener" hidden>Open cloud run</a></div><p class="imm-small">Connection checks and previews do not save guest details.</p></details></section>';
  }
  function ensureCloudPanel(){
    let dock=document.getElementById('immigCloudDock');
    if(!dock){const res=document.getElementById('immigResults2');if(!res)return;const aside=document.createElement('aside');aside.id='immigCloudHome';aside.innerHTML='<details id="immigCloudSetup" class="imm-cloud-setup"><summary>Cloud connection & authentication</summary><div id="immigCloudDock"></div></details>';res.insertAdjacentElement('afterend',aside);dock=document.getElementById('immigCloudDock');}
    if(!document.getElementById('immigCloudBox')){
      dock.innerHTML=cloudPanelHtml();
      document.getElementById('immigCloudSend').onclick=sendCloudCode;
      document.getElementById('immigCloudOne').onclick=()=>oneButton(S.scope==='all');
      document.getElementById('immigCloudStartSignin').onclick=()=>startCloud('signin');
      document.getElementById('immigCloudStartAudit').onclick=()=>startCloud('audit',null,()=>sendCloudPlan(false));
      document.getElementById('immigCloudKeySave').onclick=saveCloudKey;
      document.getElementById('immigRunScope').onchange=e=>{S.scope=e.target.value==='all'?'all':'5';cloudControls();};
    }
    const res=document.getElementById('immigResults2'),review=!!(S.plan&&res&&res.style.display!=='none');
    document.getElementById('immigWorkArea')?.classList.toggle('has-review',review);
    if(review)document.getElementById('immigCloudSetup').open=true;
    cloudControls();
  }
  function watchCloudReady(){
    if(!db()||(typeof currentUser!=='undefined'&&!currentUser))return;
    cloudContext();watchCloudWant();watchCloudResult();
  }
  const linkStorage=()=> 'hoImmigOperaHotels_v1_'+String(typeof HOTEL_ID==='undefined'?'':HOTEL_ID);
  const selectedStorage=()=>linkStorage()+'_selected';
  const selectedHotel=()=>S.links[S.selectedHotel]&&!S.links[S.selectedHotel].deletedAt?S.links[S.selectedHotel]:null;
  const needsHotel=()=>!selectedHotel()&&Object.values(S.links).some(row=>!row.deletedAt);
  const dataPath=path=>S.selectedHotel?'immigOperaData/'+S.selectedHotel+'/'+path:path;
  function cleanLinks(value){const out={};for(const [id,row]of Object.entries(value||{})){if(!/^oh[a-z0-9]{6,70}$/.test(id)||!row||typeof row!=='object'||!Number.isFinite(row.at))continue;if(row.deletedAt){out[id]={at:row.at,deletedAt:row.deletedAt};continue;}const link=A.validateOperaUrl(row.url),name=String(row.name||'').trim();if(link.ok&&name&&name.length<=100)out[id]={name,url:link.url,at:row.at,...(row.localOnly===true?{localOnly:true}:{})};}return out;}
  function rememberLinks(){try{localStorage.setItem(linkStorage(),JSON.stringify(S.links));localStorage.setItem(selectedStorage(),S.selectedHotel);}catch(_){} }
  function linkMessage(message,bad=false){const el=document.getElementById('immigOperaMsg');if(el){el.textContent=message;el.style.color=bad?'var(--red,#c0392b)':'';}}
  function linkLocked(){return S.linkBusy||cloudStarting||cloudRunning;}
  function clearTargetReview(){
    ++renderToken;
    if(typeof clearImmig==='function'&&document.getElementById('immigFileInput2')&&document.getElementById('immigInhouseXmlInput'))clearImmig();
    else{if(typeof immigAllRows2!=='undefined')immigAllRows2=[];if(typeof _immigInhouseList!=='undefined')_immigInhouseList=[];const result=document.getElementById('immigResults2');if(result)result.style.display='none';}
    S.plan=null;S.ok={};S.shared={};S.uaeType='';S.lastRows=null;S.lastList=null;S.reviewIds=null;S.fxNote='';
    cloudResult=null;cloudWant=null;cloudTag='';cloudNote='';cloudStage=-1;wantedCode=null;codeSentChallenge='';focusedChallenge='';const code=document.getElementById('immigCloudCode');if(code)code.value='';
  }
  function activateHotel(id){
    if(linkLocked()){const picker=document.getElementById('immigHotelSelect');if(picker)picker.value=S.selectedHotel;return linkMessage('Wait for the current cloud run or link save before changing hotels.',true);}
    if(id&&!S.links[id]||id&&S.links[id].deletedAt)return;
    if(id!==S.selectedHotel)clearTargetReview();S.selectedHotel=id;S.opera=selectedHotel()?.url||'';
    rememberLinks();renderShell();guide();
  }
  function operaRow(){
    const row=selectedHotel(),valid=A.validateOperaUrl(S.opera),saved=Object.entries(S.links).filter(([,r])=>!r.deletedAt).sort((a,b)=>a[1].name.localeCompare(b[1].name));
    return '<div class="imm-hotel-picker"><label for="immigHotelSelect"><span>HOTEL FOR THIS CHECK</span><select id="immigHotelSelect"><option value="">'+(saved.length?'Choose a saved hotel…':'Save your first hotel below')+'</option>'+saved.map(([id,r])=>'<option value="'+id+'"'+(id===S.selectedHotel?' selected':'')+'>'+esc(r.name)+'</option>').join('')+'</select></label><button type="button" class="btn" id="immigHotelAdd">+ Add hotel</button>'+(row?'<button type="button" class="btn" id="immigHotelRemove">Remove saved link</button>':'')+'</div><p class="imm-small imm-hotel-guidance">Choose a saved hotel or save a new Opera link. Changing hotels clears the reports and selected fixes.</p>'+
      '<details id="immigConnectionDetails" class="imm-more"'+(valid.ok?'':' open')+'><summary>'+(row?'Manage '+esc(row.name)+' link':valid.ok?'✓ Opera link saved · Save under a hotel name':'Save a hotel link')+'</summary><label class="imm-lbl" for="immigHotelName">Hotel name</label><input id="immigHotelName" maxlength="100" autocomplete="organization" placeholder="e.g. Mercure Dubai Deira" value="'+esc(row?.name||'')+'"><label class="imm-lbl" for="immigOperaUrl">Opera Cloud link <small>(link only, no password)</small></label><div class="imm-row"><input id="immigOperaUrl" type="url" inputmode="url" autocomplete="off" placeholder="https://…oraclecloud.com/…/OperaCloud" value="'+esc(S.opera)+'"><button type="button" class="btn gold" id="immigOperaSave">'+(row?'Save changes':'Save hotel link')+'</button><button type="button" class="btn" id="immigHotelCancel"'+(valid.ok?'':' hidden')+'>Cancel edits</button>'+(valid.ok?'<a class="btn" id="immigOperaOpen" href="'+esc(valid.url)+'" target="_blank" rel="noopener noreferrer">Open Opera</a>':'')+'</div></details><div class="imm-msg" id="immigOperaMsg" role="status">'+(row?row.localOnly?'Saved on this device only. Save changes to share this link with the team.':'Saved hotel selected.':valid.ok?'Current workspace link. Add a name to keep it in your hotel list.':'')+'</div>';
  }
  function renderShell(){
    let el=document.getElementById('immigOperaSetup');
    if(!el){const panel=document.getElementById('panel-immig'),anchor=panel&&(document.getElementById('immigStep4Slot')||panel.querySelector('.imm-steps')||panel.querySelector('.howto'));el=document.createElement('div');el.id='immigOperaSetup';el.className='card imm-opera';if(anchor&&anchor.id==='immigStep4Slot')anchor.appendChild(el);else if(anchor)anchor.after(el);else{const res=document.getElementById('immigResults2');if(!res)return;res.insertBefore(el,res.firstChild);}}
    const typing=['immigOperaUrl','immigHotelName','immigHotelSelect'].includes(document.activeElement?.id),signature=JSON.stringify([S.opera,S.selectedHotel,S.links]),opened=el.querySelector('details')?.open;
    if(!typing&&(!el.firstChild||el.dataset.links!==signature)){const same=el.dataset.links===signature;el.innerHTML=operaRow();if(same&&opened)el.querySelector('details').open=true;el.dataset.links=signature;}
    const save=document.getElementById('immigOperaSave');if(save)save.onclick=()=>saveOperaLink().catch(()=>linkMessage('Could not save the hotel link. Try again.',true));
    const picker=document.getElementById('immigHotelSelect');if(picker)picker.onchange=e=>{e.target.blur();activateHotel(e.target.value);};
    const add=document.getElementById('immigHotelAdd');if(add)add.onclick=()=>{if(linkLocked())return;const detail=document.getElementById('immigConnectionDetails');detail.open=true;document.getElementById('immigHotelName').value='';document.getElementById('immigOperaUrl').value='';save.dataset.newHotel='1';save.textContent='Save hotel link';document.getElementById('immigHotelCancel').hidden=false;document.getElementById('immigHotelName').focus();};
    const cancel=document.getElementById('immigHotelCancel');if(cancel)cancel.onclick=()=>{if(linkLocked())return;document.activeElement?.blur();el.dataset.links='';renderShell();};
    const remove=document.getElementById('immigHotelRemove');if(remove)remove.onclick=()=>removeHotel().catch(()=>linkMessage('Could not remove the saved link. Try again.',true));
    ensureCloudPanel();watchCloudReady();renderCloudState();
  }
  let linkLoadToken=0;
  async function loadOperaLink(){
    const token=++linkLoadToken,hotel=String(typeof HOTEL_ID==='undefined'?'':HOTEL_ID);
    try{S.links={...S.links,...cleanLinks(JSON.parse(localStorage.getItem(linkStorage())||'{}'))};const id=localStorage.getItem(selectedStorage())||'';if(!S.selectedHotel&&S.links[id]&&!S.links[id].deletedAt)S.selectedHotel=id;const fallback=localStorage.getItem(lsKey());if(!S.selectedHotel&&fallback&&A.validateOperaUrl(fallback).ok)S.opera=A.validateOperaUrl(fallback).url;}catch(_){}
    if(selectedHotel())S.opera=selectedHotel().url;
    const chosen=S.selectedHotel,d=db();
    if(d){const reads=await Promise.allSettled(['operaUrl','immigOperaHotels'].map(n=>d.ref('hotels/'+hotel+'/'+n).once('value')));if(token!==linkLoadToken||hotel!==String(HOTEL_ID)||S.selectedHotel!==chosen||linkLocked())return;
      const remote=reads[1].status==='fulfilled'?cleanLinks(reads[1].value.val()):{};for(const [id,row]of Object.entries(remote))if(!S.links[id]||row.at>=S.links[id].at)S.links[id]=row;
      if(S.selectedHotel&&!selectedHotel()){if(linkLocked())return;clearTargetReview();S.selectedHotel='';S.opera='';}
      else if(selectedHotel()){if(S.opera&&S.opera!==selectedHotel().url){if(linkLocked())return;clearTargetReview();}S.opera=selectedHotel().url;}
      else if(!S.opera&&reads[0].status==='fulfilled'){const fallback=A.validateOperaUrl(reads[0].value.val());if(fallback.ok)S.opera=fallback.url;}
    }
    if(!selectedHotel()&&Object.values(S.links).some(r=>!r.deletedAt))S.opera='';
    rememberLinks();renderShell();
  }
  async function saveOperaLink(){
    if(linkLocked())return linkMessage('Wait for the current cloud run or link save before changing hotels.',true);
    const link=A.validateOperaUrl(document.getElementById('immigOperaUrl')?.value),name=String(document.getElementById('immigHotelName')?.value||'').trim();
    if(!link.ok)return linkMessage(link.reason,true);if(!name||name.length>100)return linkMessage('Enter a hotel name so you can find this link later.',true);
    const isNew=document.getElementById('immigOperaSave')?.dataset.newHotel==='1'||!selectedHotel(),duplicate=Object.entries(S.links).find(([id,r])=>!r.deletedAt&&r.name.toLowerCase()===name.toLowerCase()&&(isNew||id!==S.selectedHotel));if(duplicate)return linkMessage('A hotel with this name is already saved. Choose it to update its link.',true);
    const hotel=String(HOTEL_ID),id=isNew?'oh'+Date.now().toString(36)+Math.random().toString(36).slice(2,10):S.selectedHotel,row={name,url:link.url,at:Date.now()},changed=isNew||selectedHotel()?.url!==row.url||selectedHotel()?.name!==row.name;
    S.linkBusy=true;cloudControls();let shared=false;try{const d=db();if(d){await d.ref('hotels/'+hotel+'/immigOperaHotels/'+id).set(row);shared=true;}}catch(_){}finally{S.linkBusy=false;}
    if(hotel!==String(HOTEL_ID))return;if(changed)clearTargetReview();S.links[id]=shared?row:{...row,localOnly:true};S.selectedHotel=id;S.opera=row.url;rememberLinks();document.activeElement?.blur();renderShell();guide();linkMessage(shared?'Saved for the team. Upload this hotel’s reports to begin.':'Saved on this device only. The team copy could not be saved.',!shared);toast(shared?'Hotel link saved.':'Hotel link saved on this device only.');
  }
  async function removeHotel(){
    if(linkLocked()||!selectedHotel())return;const hotel=String(HOTEL_ID),id=S.selectedHotel,row={at:Date.now(),deletedAt:Date.now()};S.linkBusy=true;cloudControls();let shared=false;try{const d=db();if(d){await d.ref('hotels/'+hotel+'/immigOperaHotels/'+id).set(row);shared=true;}}catch(_){}finally{S.linkBusy=false;}
    if(hotel!==String(HOTEL_ID))return;clearTargetReview();S.links[id]=row;S.selectedHotel='';S.opera='';rememberLinks();document.activeElement?.blur();renderShell();guide();linkMessage(shared?'Saved link removed. Guest records are unchanged.':'Removed on this device only. The team copy could not be updated.',!shared);
  }
  async function loadShared(){
    const hotel=typeof HOTEL_ID==='undefined'?'':String(HOTEL_ID||'');
    if(!selectedHotel()&&!needsHotel())try{const link=localStorage.getItem(lsKey());if(link&&A.validateOperaUrl(link).ok)S.opera=link;}catch(_){}
    const d=db();if(!d||!S.plan)return;
    const day=String((typeof _immigMeta!=='undefined'&&_immigMeta.biz)||'').slice(0,10)||'today';
    const target=S.selectedHotel;const results=await Promise.allSettled(['operaUrl',dataPath('immigFixPrefs/uaeIdType'),dataPath('immigFix/'+day)].map(path=>d.ref('hotels/'+hotel+'/'+path).once('value')));
    if(hotel!==String(HOTEL_ID)||target!==S.selectedHotel)return;
    const values=results.map(r=>r.status==='fulfilled'?r.value.val():null);
    const link=A.validateOperaUrl(values[0]);if(link.ok&&!selectedHotel()&&!needsHotel())S.opera=link.url;
    S.uaeType=C.UAE_ID_TYPES.includes(values[1])?values[1]:'';S.shared=values[2]||{};
  }
  function chip(it, f) {
    const typeSet=!!it.fields.find(x=>x.field==='idType')?.value;
    const on=!!S.ok[it.id][f.field]&&(f.field!=='idNumber'||typeSet);
    const disabled=f.field==='idNumber'?!typeSet:f.field==='idType'?false:!f.value;
    const title=esc(f.label+' for room '+it.room), edit=' data-edit="'+esc(it.id)+'|'+f.field+'" aria-label="'+title+'"';
    let control;
    if(f.field==='gender')control='<select'+edit+'><option value="">Choose gender</option><option value="M"'+(f.value==='M'?' selected':'')+'>Male</option><option value="F"'+(f.value==='F'?' selected':'')+'>Female</option></select>';
    else if(f.field==='nationality')control='<select'+edit+'><option value="">Choose nationality</option>'+C.countryList().map(c=>'<option value="'+c.code+'"'+(c.code===f.value?' selected':'')+'>'+esc(c.name)+' ('+c.code+')</option>').join('')+'</select>';
    else if(f.field==='idType')control='<select'+edit+'><option value="">Choose document type</option>'+(f.idKind==='EID'?C.UAE_ID_TYPES:C.ID_TYPES).map(c=>'<option'+(c===f.value?' selected':'')+'>'+esc(c)+'</option>').join('')+'</select>';
    else control='<b class="imm-doc">'+esc(f.display)+'</b>';
    return '<div class="imm-field"><label><input type="checkbox" aria-label="Include '+title+'" data-ok="'+esc(it.id)+'|'+f.field+'" data-idle-disabled="'+disabled+'"'+(on?' checked':'')+(disabled?' disabled':'')+'><span>'+esc(f.label)+'</span></label><div class="imm-field-value">'+control+'<small>'+esc(f.source)+(f.needsTap&&f.value&&!on?' · Check before including':'')+'</small></div></div>';
  }
  function selectedFields(it) {
    const ok=S.ok[it.id]||{}, chosen=it.fields.filter(f=>ok[f.field]&&f.value);
    const pair=chosen.some(f=>f.field==='idType')&&chosen.some(f=>f.field==='idNumber');
    return chosen.filter(f=>!['idType','idNumber'].includes(f.field)||pair);
  }
  function approvedCount() {return (S.plan?.items||[]).reduce((n,it)=>n+selectedFields(it).length,0);}
  function paint() {
    const card=document.getElementById('immigFixerCard');if(!card||!S.plan)return;
    const opened=new Set([...card.querySelectorAll('details[open][id]')].map(e=>e.id));
    const oldScroll=card.querySelector('.imm-review-list')?.scrollTop||0;
    const focus=document.activeElement,focusKey=focus?.dataset?.edit||focus?.dataset?.ok,focusAttr=focus?.dataset?.edit?'edit':'ok';
    const items=S.plan.items,full=it=>it.fields.length&&it.fields.every(f=>S.ok[it.id][f.field]);
    const ready=items.filter(full),needs=items.filter(it=>it.fields.length&&!full(it)),skipped=items.filter(it=>!it.fields.length);
    if(!S.reviewIds)S.reviewIds=new Set(needs.map(it=>it.id));
    const reviewItems=items.filter(it=>S.reviewIds.has(it.id)),readyItems=ready.filter(it=>!S.reviewIds.has(it.id));
    const row=it=>{const notes=it.notes.filter(note=>!(/^Gender:/.test(note)&&it.fields.some(f=>f.field==='gender'&&f.value)));return '<article class="imm-guest"><div class="imm-guest-head"><b><small>ROOM</small>'+esc(it.room)+'</b><span>'+esc(it.name)+'<small>Review the ticked details</small></span></div>'+it.fields.map(f=>chip(it,f)).join('')+(notes.length?'<p class="imm-small">'+notes.map(esc).join(' · ')+'</p>':'')+'</article>';};
    card.classList.add('imm-review');card.style.cssText='';
    card.innerHTML='<div class="imm-eyebrow">REVIEW & FIX</div><p class="imm-small">'+esc(S.plan.hotel)+(S.plan.businessDate?' · '+esc(S.plan.businessDate.slice(0,10)):'')+'</p><div class="imm-h"><b>Review suggested details</b></div><p class="imm-small">Tick the fields you want to add. Only empty fields in Opera will be filled.</p>'+
      '<div class="imm-sum"><span class="ok"><b>'+ready.length+'</b><small>Ready</small></span><span class="ask"><b>'+needs.length+'</b><small>Needs your choice</small></span><span class="skip"><b>'+skipped.length+'</b><small>More information</small></span></div>'+
      (reviewItems.length?'<div class="imm-sub">Review these guests</div><div class="imm-review-list">'+reviewItems.map(row).join('')+'</div>':'')+
      (readyItems.length?'<details class="imm-more" id="immigReadyGuests"><summary>Review '+readyItems.length+' ready guests</summary>'+readyItems.map(row).join('')+'</details>':'')+
      (skipped.length?'<details class="imm-more" id="immigSkippedGuests"><summary>Guests that need more information</summary><div class="imm-small">'+skipped.map(it=>'Room '+esc(it.room)+' · '+esc(it.name)+' · '+esc(it.notes.join(' · ')||'No supported empty fields to fill')).join('<br>')+'</div></details>':'')+
      (!items.length?'<div class="imm-empty"><b>No supported fields need fixing.</b><span>You can see the full report below.</span></div>':'')+
      '<details class="imm-more imm-alternative" id="immigBrowserAlternative"><summary>Use my browser extension instead</summary><p class="imm-small">Open Opera on your computer, then send the selected fixes to your helper.</p><button class="btn" id="immigFixCopy">'+(helperFx()?'Send selected fixes to Opera':'Copy selected fixes for Opera')+' (<span id="immigFixN">'+approvedCount()+'</span> fields)</button><div class="imm-small" id="immigFixStatus">'+esc(S.fxNote||'')+'</div>'+extState()+'<p class="imm-small">'+(helperFx()?'Press Start in the Opera helper. It follows the selected fields.':'Paste the copied list into the Opera fixer, press Load, then Start.')+'</p></details>'+
      '<details class="imm-more" id="immigFixMore"><summary>Team choices & previous changes</summary><button class="btn" id="immigFixSave">Remember gender and nationality</button><div id="immigFixLogList" class="imm-small"></div><details class="imm-more" id="immigLogImport"><summary>Import a helper log or copy a support request</summary><textarea id="immigFixLogIn" aria-label="Helper change log"></textarea><div class="imm-support-actions"><button class="btn" id="immigFixLogSave">Save this log</button><button class="btn" id="immigFixCloud">Copy read-only check request</button></div></details></details>';
    ensureCloudPanel();
    card.onchange=e=>{
      const t=e.target;
      if(t.dataset?.ok){const [id,f]=t.dataset.ok.split('|');S.ok[id][f]=t.checked;paint();}
      else if(t.dataset?.edit){
        const [id,field]=t.dataset.edit.split('|'),it=S.plan.items.find(x=>x.id===id),f=it?.fields.find(x=>x.field===field);
        if(f){f.value=t.value;f.display=t.value;f.source='You chose';S.ok[id][field]=!!t.value;if(field==='idType'&&!t.value)S.ok[id].idNumber=false;
          if(field==='idType'&&f.idKind==='EID'&&C.UAE_ID_TYPES.includes(t.value)){S.uaeType=t.value;const d=db();if(d)d.ref('hotels/'+HOTEL_ID+'/'+dataPath('immigFixPrefs/uaeIdType')).set(t.value).catch(()=>{});S.plan.items.forEach(o=>o.fields.forEach(x=>{if(x.field==='idType'&&x.idKind==='EID'&&!x.value){x.value=t.value;x.display=t.value;x.source='Your usual UAE type';}}));}
          paint();}
      }
    };
    document.getElementById('immigFixCopy').onclick=copyPlan;
    document.getElementById('immigFixCloud').onclick=copyCloudRequest;
    document.getElementById('immigFixSave').onclick=saveShared;
    document.getElementById('immigFixLogSave').onclick=saveLog;
    opened.forEach(id=>{const el=document.getElementById(id);if(el)el.open=true;});
    const list=card.querySelector('.imm-review-list');if(list)list.scrollTop=oldScroll;
    if(focusKey){const next=[...card.querySelectorAll('[data-'+focusAttr+']')].find(e=>e.dataset[focusAttr]===focusKey);next?.focus({preventScroll:true});}
    else if(focus?.id==='immigRunScope')document.getElementById('immigRunScope').focus({preventScroll:true});
    cloudControls();watchCloudReady();renderCloudState();showLog();guide();
  }
  const helperFx = () => { try { return !!document.documentElement.dataset.hoFxHelper; } catch (_) { return false; } };
  // one line: is the Chrome helper's fixer as new as this page?  (the helper takes new fixer code from this page by itself; only an old helper needs a download)
  function extState() {
    if (!helperFx()) return '';
    const D = document.documentElement.dataset, app = parseFloat(String(typeof APP_VERSION !== 'undefined' ? APP_VERSION : '').replace(/^v/, '')) || 0, fx = parseFloat(D.hoFxCode || '0') || 0;
    let t, c = '';
    if (!D.hoFxCode) { t = '⚠ Old helper (' + (D.hoWaHelper || '?') + '): download the new helper once (Settings). After that, fixer updates need no reinstall.'; c = 'color:var(--red,#c0392b)'; }
    else if (D.hoWaUs === '0' && fx < app) { t = '⚠ Turn on "Allow User Scripts" for the helper (chrome://extensions > Details) so it can update itself.'; c = 'color:var(--red,#c0392b)'; }
    else if (fx >= app) t = '✓ Extension up to date (fixer v' + fx + ')';
    else t = '⏳ Updating the helper fixer (v' + fx + ' to v' + app + '), keep this page open a few seconds.';
    return '<div class="imm-small" id="immigExtState" style="opacity:.85;' + c + '">' + esc(t) + '</div>';
  }
  setInterval(() => { const el = document.getElementById('immigExtState'); if (!el) return; const h = document.createElement('div'); h.innerHTML = extState(); const n = h.firstChild; if (n) { el.textContent = n.textContent; el.style.cssText = n.style.cssText; } }, 2000);
  function setStatus(t, bad) { S.fxNote = String(t || ''); const el = document.getElementById('immigFixStatus'); if (el) { el.textContent = S.fxNote; el.style.color = bad ? 'var(--red,#c0392b)' : ''; } }
  window.addEventListener('message', e => {
    const d = e.source === window && e.data; if (!d || typeof d !== 'object') return;
    if (d.source === 'ho-fx-progress') setStatus(d.note, d.bad);
    else if (d.source === 'ho-fx-log' && d.entry) { const ta = document.getElementById('immigFixLogIn'); if (ta) ta.value += (ta.value ? '\n' : '') + JSON.stringify(d.entry); }
  });
  // Cloud run request: text only, no names, ID numbers as last 4. The cloud run checks these rooms in Opera (read-only) and reports. Nothing is stored by the app.
  function cloudRequestText() {
    const rows = [];
    (S.plan ? S.plan.items : []).forEach(it => {
      const ok = S.ok[it.id] || {}, f = {};
      it.fields.forEach(x => { if (ok[x.field] && x.value) f[x.field] = x; });
      if (!Object.keys(f).length) return;
      rows.push([it.room, it.arrival || '', f.gender ? f.gender.value : '-', f.nationality ? f.nationality.value : '-', f.idType ? f.idType.value : '-', f.idNumber ? f.idNumber.display : '-'].join('|'));
    });
    return rows.length ? 'CLOUD OPERA CHECK (read-only, change nothing in Opera)\nroom|arrival|gender|nationality|id type|id number last 4  (- = already filled in Opera, nothing to do)\n' + rows.join('\n') : '';
  }
  // All cloud launches share one guard; preparing a new plan must wait until no run is active.
  const GH_KEY = 'ho_gh_start_key_v1', GH_API = 'https://api.github.com/repos/ahmed0088/Depature-Tool/actions/workflows/opera-cloud.yml/dispatches';
  let cloudNote='',cloudBad=false,cloudResult=null,cloudWant=null,codeSentChallenge='',focusedChallenge='',cloudStage=-1;
  function codeDeadline(want){
    const at=Number(want?.at||0),expires=Number(want?.expiresAt||0);
    return Math.min(at+300000,expires>at?expires:at+180000);
  }
  function updateCodeCountdown(){
    const el=document.getElementById('immigCloudTime'),box=document.getElementById('immigCloudCodeBox');
    if(!el||!box||box.hidden||!wantedCode)return;
    const challenge=String(wantedCode.tag||'')+'|'+wantedCode.at;
    if(codeSentChallenge===challenge){el.textContent='Code sent. Waiting for confirmation…';return;}
    const left=Math.max(0,Math.ceil((codeDeadline(wantedCode)-Date.now())/1000));
    el.textContent=left?'Time to send a current code: '+Math.floor(left/60)+':'+String(left%60).padStart(2,'0'):'The waiting time ended. Start again to request a current code.';
    if(!left){document.getElementById('immigCloudCode').disabled=true;document.getElementById('immigCloudSend').disabled=true;}
  }
  setInterval(updateCodeCountdown,1000);
  function cloudMsg(t,bad){cloudNote=String(t||'');cloudBad=!!bad;renderCloudState();}
  function recovery(error){
    if(/passkey|security key|windows hello/i.test(error))return {title:'Opera needs a different sign-in method',text:'This cloud computer cannot use a device passkey. Ask your administrator to enable a supported password and authentication-code method.',login:true};
    if(/authentication code|authenticator code|verification code|code.*not accepted|code.*arrived|rejected.*codes/i.test(error))return {title:'A current authentication code is needed',text:'Start again and wait for the code box. If your authenticator’s code is about to change, wait for its next code before sending.'};
    if(/Microsoft|sign.in|password|account policy/i.test(error))return {title:'Opera sign-in needs attention',text:'Check the saved Opera login and the account’s sign-in method in connection settings, then try again.',login:true};
    if(/plan|reviewed list/i.test(error))return {title:'Review the selected details again',text:'The previous list could not be used. Check the ticked fields, then press Fix again.'};
    return {title:'The run stopped',text:'Check the explanation below before trying again. Only confirmed results are counted as saved.'};
  }
  function renderCloudState(){
    const msg=document.getElementById('immigCloudStartMsg'),result=document.getElementById('immigCloudRes'),box=document.getElementById('immigCloudCodeBox');
    if(!msg||!result||!box)return;
    if(S.selectedHotel&&cloudResult&&['done','failed'].includes(cloudResult.state)&&!cloudTag&&(!cloudResult.target||cloudResult.target.url!==S.opera||cloudResult.target.id&&cloudResult.target.id!==S.selectedHotel)){cloudResult=null;cloudStage=-1;}
    const v=cloudResult,terminal=v&&['done','failed'].includes(v.state),age=Date.now()-Number(cloudWant?.at||0);
    wantedCode=cloudWant&&cloudWant.state==='waiting'&&age>=0&&Date.now()<codeDeadline(cloudWant)&&(!cloudTag||cloudWant.tag===cloudTag)&&!terminal?cloudWant:null;
    const challenge=wantedCode?String(wantedCode.tag||'')+'|'+wantedCode.at:'';
    box.hidden=!wantedCode;const setup=document.getElementById('immigCloudSetup');if(wantedCode&&setup)setup.open=true;
    const pill=document.getElementById('immigCloudState');if(pill){const label=wantedCode?'Code needed':v?.state==='failed'?'Needs attention':v?.state==='done'?'Finished':cloudStarting?'Starting':cloudRunning||v?.state==='running'?'Running':'Ready';pill.textContent=label;pill.dataset.state=label.toLowerCase().replace(/ /g,'-');}
    const sent=!!challenge&&codeSentChallenge===challenge;
    const input=document.getElementById('immigCloudCode'),send=document.getElementById('immigCloudSend');
    input.disabled=sent;send.disabled=sent;
    document.getElementById('immigCloudWant').textContent=sent?'Code sent. Waiting for Opera to continue…':'Open your authenticator app, type the current 6 digits, then press Send code.';
    updateCodeCountdown();
    if(wantedCode&&!sent&&focusedChallenge!==challenge){focusedChallenge=challenge;input.focus({preventScroll:true});if(box.getClientRects().length)box.scrollIntoView({block:'nearest'});}
    let stage=cloudStage;
    if(v?.state==='running')stage=['starting'].includes(v.stage)?0:['email','password','signin','passkey','code','code-submit','signed-in'].includes(v.stage)?1:2;
    if(terminal)stage=v.state==='done'?3:/Microsoft|sign.in|password|passkey|authenticat|code/i.test(v.error||'')?1:Math.max(0,stage);
    if(wantedCode)stage=1;
    document.querySelectorAll('#immigCloudSteps li').forEach((el,i)=>{if(i===2)el.textContent=v?.mode==='signin'?'Check access':v?.mode==='audit'?'Preview details':'Fix details';el.classList.toggle('is-done',stage>i||(v?.state==='done'&&i===3));el.classList.toggle('is-active',stage===i&&!terminal);el.classList.toggle('is-stopped',stage===i&&v?.state==='failed');if(stage===i)el.setAttribute('aria-current','step');else el.removeAttribute('aria-current');});
    msg.textContent=v?.state==='running'?(v.note||'Working through the reviewed guest list…'):cloudNote;
    msg.classList.toggle('is-error',cloudBad&&!terminal);
    if(!v){result.innerHTML='';cloudControls();return;}
    const sm=C.cloudSummary(v.lines,v.state==='done'),rooms=a=>a.map(esc).join(', ')||'None';
    if(v.state==='failed'){
      const error=String(v.error||'No explanation was returned.'),help=recovery(error);
      result.innerHTML='<div class="imm-help"><b>'+esc(help.title)+'</b><p>'+esc(help.text)+'</p>'+(help.login?'<a class="btn" href="https://github.com/ahmed0088/Depature-Tool/settings/secrets/actions" target="_blank" rel="noopener">Open login settings</a>':'')+'<details class="imm-more"><summary>Show the exact reason</summary><p>'+esc(error.slice(0,400))+'</p></details></div>';
    }else if(v.state==='done'&&v.mode==='signin')result.innerHTML='<div class="imm-success"><b>Opera sign-in works</b><p>No guest records were changed.</p></div>';
    else if(v.state==='done')result.innerHTML='<div class="imm-success"><b>'+(v.mode==='save'?'Finished · '+sm.saved.length+' saved':'Preview finished · nothing saved')+'</b><p>'+sm.none.length+' already complete · '+sm.bad.length+' need a look</p></div><details class="imm-more"'+(sm.bad.length?' open':'')+'><summary>Results by room</summary><p>Saved: '+rooms(sm.saved)+'<br>Already complete: '+rooms(sm.none)+'</p>'+(sm.bad.length?'<ul>'+sm.bad.map(b=>'<li>Room '+esc(b[0])+': '+esc(b[1])+'</li>').join('')+'</ul>':'')+'</details>';
    else result.innerHTML='<p class="imm-small">'+sm.saved.length+' rooms confirmed saved so far'+(v.mode==='save'?'':' · Preview only; nothing saved')+'</p>';
    if(terminal){const stamp=new Date(Number(v.at||0));if(v.at&&!isNaN(stamp))result.insertAdjacentHTML('beforeend','<div class="imm-small imm-result-time">Last run · '+esc(stamp.toLocaleString())+'</div>');}
    cloudControls();
  }
  function saveCloudKey() {
    const el = document.getElementById('immigCloudKey'), v = String(el && el.value || '').trim();
    if (!v) return toast('Paste the start key first.', 'err');
    try { localStorage.setItem(GH_KEY, v); el.value = ''; const r = document.getElementById('immigCloudKeyRow'); if (r) r.style.display = 'none'; toast('Key saved on this device. Press Start again.', 'ok'); } catch (_) { toast('Could not save the key on this device.', 'err'); }
  }
  let cloudStarting=false, cloudRunning=false, cloudTag='', wantedCode=null;
  let cloudHotel='';
  function cloudContext(){
    const hotel=typeof HOTEL_ID==='undefined'?'':String(HOTEL_ID||'');
    if(cloudHotel===hotel)return;
    const changed=!!cloudHotel;cloudHotel=hotel;watchTok++;cloudStarting=false;cloudRunning=false;cloudTag='';wantedCode=null;cloudNote='';cloudBad=false;cloudResult=null;cloudWant=null;codeSentChallenge='';focusedChallenge='';cloudStage=-1;
    if(resRef){resRef.off();resRef=null;}if(wantRef){wantRef.off();wantRef=null;}
    if(changed){++linkLoadToken;clearTargetReview();if(document.activeElement?.closest?.('#immigOperaSetup'))document.activeElement.blur();S.links={};S.selectedHotel='';const code=document.getElementById('immigCloudCode');if(code)code.value='';S.opera='';S.shared={};S.lastRows=null;S.lastList=null;loadOperaLink();}
  }
  function keyProblem(status){
    if(![401,403,404].includes(status))return false;
    const row=document.getElementById('immigCloudKeyRow');if(row)row.style.display='';
    cloudMsg(status===401?'The GitHub start key has expired or was refused. Save a new key below, then start again.':'The GitHub key needs access to Depature-Tool with Actions: Read and write. Update the key below.',true);return true;
  }
  function cloudControls(){
    const review=!!(S.plan&&document.getElementById('immigResults2')?.style.display!=='none');
    const busy=cloudStarting||cloudRunning,reportError=!!document.getElementById('immigError2')?.classList.contains('show');
    for(const id of ['immigCloudOne','immigCloudStartSignin','immigCloudStartAudit','immigRunScope','immigReportsClear','immigInhouseXmlInput','immigFileInput2','immigGo']){const el=document.getElementById(id);if(el)el.disabled=busy||(['immigCloudOne','immigCloudStartAudit'].includes(id)&&(!review||!approvedCount()||reportError||needsHotel()||S.linkBusy));}
    for(const id of ['immigHotelSelect','immigHotelAdd','immigHotelRemove','immigHotelName','immigOperaUrl','immigOperaSave','immigHotelCancel']){const el=document.getElementById(id);if(el)el.disabled=busy||S.linkBusy;}
    const targetLabel=document.getElementById('immigCloudHotel');if(targetLabel)targetLabel.textContent=cloudRunning&&cloudResult?.target?.name||selectedHotel()?.name||(S.opera?'Current workspace Opera link':'Choose a hotel above');
    document.querySelectorAll('#immigFixerCard .imm-guest input, #immigFixerCard .imm-guest select').forEach(el=>{el.disabled=busy||el.dataset.idleDisabled==='true';});
    const count=document.getElementById('immigSelectionCount');if(count){const guests=review?(S.plan?.items||[]).filter(it=>selectedFields(it).length).length:0;count.textContent=guests+' guests · '+(review?approvedCount():0)+' fields selected';}
    const b=document.getElementById('immigCloudOne');if(b)b.textContent=busy?'Automation running…':S.scope==='all'?'Fix selected guests':'Fix first 5 guests';
  }
  async function startCloud(mode, lim, prepare) {
    cloudContext();
    if(S.linkBusy)return cloudMsg('Wait for the hotel link to finish saving.',true);
    if(needsHotel())return cloudMsg('Choose a saved hotel above before starting a run.',true);
    const editedLink=document.getElementById('immigOperaUrl'),editedName=document.getElementById('immigHotelName');if(editedLink&&editedLink.value.trim()!==S.opera||editedName&&editedName.value.trim()!==(selectedHotel()?.name||''))return cloudMsg('Save the hotel name and link above before starting a run.',true);
    if (mode !== 'signin' && mode !== 'audit' && mode !== 'save') return;   // 'save' is started only by the big button
    if(cloudStarting||cloudRunning)return cloudMsg('An Opera automation is already starting or running. Finish that run before starting another.',true);
    if(mode!=='signin'&&document.getElementById('immigError2')?.classList.contains('show'))return cloudMsg('Replace the Opera report above before starting. The previous review is out of date.',true);
    if(mode!=='signin'&&(!S.plan||document.getElementById('immigResults2')?.style.display==='none'))return cloudMsg('Upload and review the two reports before starting a fix.',true);
    cloudResult=null;
    let key = ''; try { key = localStorage.getItem(GH_KEY) || ''; } catch (_) {}
    if (!key) { const r = document.getElementById('immigCloudKeyRow'); if (r) r.style.display = ''; return cloudMsg('Needs the GitHub start key once on this device.', true); }
    const d = db(); if (!d) return cloudMsg('Not connected to the database. Refresh the page and try again.', true);
    const ov = S.opera ? A.validateOperaUrl(S.opera) : null, url = ov && ov.ok ? ov.url : '';
    if(!url){const setup=document.getElementById('immigConnectionDetails');if(setup)setup.open=true;return cloudMsg('Add your hotel’s Opera link above, then press Fix again.',true);}
    cloudStage=0;cloudStarting=true;cloudControls();cloudMsg('Checking whether an Opera run is already active…');const t0=Date.now(),hotel=cloudHotel;
    try {
      const active=await fetch(GH_API.replace('/dispatches','/runs?per_page=10'),{headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+key}});
      if(hotel!==String(HOTEL_ID))return;
      if(keyProblem(active.status))return;
      if(!active.ok)throw Error('Cannot check existing Opera runs (GitHub '+active.status+'). Check the start key’s Actions permission.');
      const running=(await active.json()).workflow_runs?.find(r=>['queued','in_progress','waiting','requested','pending'].includes(r.status));
      if(running){cloudRunning=true;cloudTag=(String(running.display_title||'').match(/\bim[a-z0-9]+\b/)||[])[0]||'';cloudMsg('An Opera run is already active. Following its progress; no second run was started.');watchRun(key,Date.parse(running.created_at)||t0,mode,cloudTag,running.id);return;}
      cloudTag='im'+Date.now().toString(36)+Math.random().toString(36).slice(2,9);cloudResult=null;cloudWant=null;codeSentChallenge='';focusedChallenge='';
      if(prepare&&!(await prepare())){if(!cloudBad)cloudMsg('Load the reports and tick at least one verified fix before starting.',true);return;}
      if(hotel!==String(HOTEL_ID))return;
      if (mode !== 'signin') {const plan=(await d.ref('hotels/'+hotel+'/operaCloudPlan').once('value')).val();if(hotel!==String(HOTEL_ID))return;if(!plan)return cloudMsg('Check your selected fields, then press Fix again.',true);if(mode==='save'&&plan.mode!=='save')return cloudMsg('The plan is not approved for saving. Review the selected fixes again.',true);await d.ref('hotels/'+hotel+'/operaCloudPlan').update({tag:cloudTag});if(hotel!==String(HOTEL_ID))return;}
      cloudMsg('Starting the cloud computer…');
      const r = await fetch(GH_API, { method: 'POST', headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + key, 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: 'main', inputs: { mode, url, tag:cloudTag, hotel, limit: mode === 'signin' ? '2' : (lim === 'all' ? '0' : lim === '5' ? '5' : '0') } }) });
      if(keyProblem(r.status))return;
      if (!r.ok) return cloudMsg('GitHub answered ' + r.status + '.', true);
      cloudMsg('Starting the automation. If Opera needs a code, the code box will appear here.');
      const b = document.getElementById('immigCloudBox'); if (b) b.open = true;
      cloudRunning=true;watchRun(key, t0, mode,cloudTag);
    } catch (e) { cloudMsg('Could not start the automation: ' + String(e && e.message || e).slice(0,160),true); }finally{if(hotel===cloudHotel){cloudStarting=false;cloudControls();}}
  }
  // follow the run on GitHub and show one plain status line (never silent). Does not override the "waiting for your code" line.
  let watchTok = 0;
  async function watchRun(key, t0, mode, tag, existingId) {
    const tok = ++watchTok, runs = existingId?'https://api.github.com/repos/ahmed0088/Depature-Tool/actions/runs/'+existingId:GH_API.replace('/dispatches', '/runs?event=workflow_dispatch&per_page=20');
    for (let i = 0; i < 750 && tok === watchTok; i++) {
      await new Promise(r => setTimeout(r, i ? 10000 : 6000));
      if (tok !== watchTok) return;
      try {
        const r = await fetch(runs, { headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + key, 'X-GitHub-Api-Version': '2022-11-28' } });
        if(tok!==watchTok)return;
        if (!r.ok) { cloudRunning=false;cloudControls();cloudMsg('Cannot read the run status (GitHub answered ' + r.status + ').', true); return; }
        const j = await r.json();if(tok!==watchTok)return;
        const run = existingId?j:(j.workflow_runs || []).filter(x => tag?String(x.display_title||x.name||'').includes(tag):Date.parse(x.created_at) >= t0 - 60000).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
        if (!run) {if(i>=30){cloudRunning=false;cloudControls();return cloudMsg('GitHub has not listed this run yet. Check cloud runs before starting again.',true);}cloudMsg('Waiting for GitHub to start the run…'); continue; }
        const link = ' (' + run.html_url + ')';const anchor=document.getElementById('immigCloudRunLink');if(anchor&&/^https:\/\/github\.com\/ahmed0088\/Depature-Tool\/actions\/runs\/\d+$/.test(run.html_url||'')){anchor.href=run.html_url;anchor.hidden=false;}
        if (run.status === 'completed') {
          cloudRunning=false;cloudControls();
          if (run.conclusion === 'success') return cloudMsg('Run finished. Read the private result below; a finished workflow alone does not confirm that guest fields were saved.');
          return cloudMsg('The run stopped (' + (run.conclusion || 'failed') + '). The reason shows below if the run could report it; otherwise open the run' + link, true);
        }
        const w = document.getElementById('immigCloudWant'); if (w && w.textContent.trim()) continue;
        cloudMsg(run.status === 'in_progress' ? 'Running on GitHub. The current sign-in step and any code request appear below.' : 'GitHub is starting the run…');
      } catch (_) { cloudRunning=false;cloudControls();cloudMsg('Cannot reach GitHub to read the run status.', true); return; }
    }
    if(tok===watchTok){cloudRunning=false;cloudControls();cloudMsg('Live status has paused. Open the cloud run to check its final result before starting again.',true);}
  }
  // One action prepares the reviewed list and starts a save run; preview uses its own explicit action.
  async function oneButton(all) {
    try {await startCloud('save', all ? 'all' : '5',()=>sendCloudPlan(true));}catch(e){cloudMsg('Could not start ('+String(e&&e.message||e).slice(0,120)+').',true);}
  }
  // the authenticator code for the GitHub cloud run: written once to a private path, the run reads it and deletes it
  async function sendCloudCode() {
    const el = document.getElementById('immigCloudCode'), v = String(el && el.value || '').replace(/\D/g, ''), d = db();
    if (!/^\d{6}$/.test(v)) return toast('Type the 6 digits from your authenticator app.', 'err');
    if (!d) return toast('Not connected to the database.', 'err');
    if(!wantedCode||codeSentChallenge===String(wantedCode.tag||'')+'|'+wantedCode.at||Date.now()>=codeDeadline(wantedCode))return toast('Wait for the cloud run to request a fresh authentication code first.','err');
    const request=wantedCode,hotel=String(HOTEL_ID),challenge=String(request.tag||'')+'|'+request.at;
    try { await d.ref('hotels/' + hotel + '/operaCloudCode').set({ code:v,at:Date.now(),tag:request.tag||'' });if(hotel!==String(HOTEL_ID))return;codeSentChallenge=challenge;el.value='';renderCloudState();toast('Code sent. The cloud run uses it once.', 'ok'); } catch (_) { toast('Could not send the code.', 'err'); }
  }
  // the plan for the GitHub cloud run: a private temporary path, read and deleted by the run when it starts. Names are needed to find the guests; they never go in a log.
  async function sendCloudPlan(forceSave,hotel=String(HOTEL_ID)) {
    if(cloudRunning){cloudMsg('This run already has its reviewed plan. Wait for it to finish before sending another.',true);return false;}
    const d = db(); if (!d) { toast('Not connected to the database.', 'err'); return false; }
    if (!approvedCount()) { toast('Tick at least one fix first.', 'err'); return false; }
    const save = forceSave === true;
    const copy = JSON.parse(JSON.stringify(S.plan));
    if (!save) copy.items.forEach(it => it.fields.forEach(f => { if (f.field === 'idNumber') f.value = String(f.display || '').replace(/\D/g, '').slice(-4).padStart(4, '0'); }));   // read-only: no full ID numbers leave the page
    const ov = S.opera ? A.validateOperaUrl(S.opera) : null;
    const code = C.encodePlan(copy, S.ok, { origin: ov && ov.ok ? ov.origin : '' });
    try { await d.ref('hotels/' + hotel + '/operaCloudPlan').set({ code, mode: save ? 'save' : 'audit', at: Date.now(),tag:cloudTag,target:{id:S.selectedHotel,name:selectedHotel()?.name||'',url:S.opera} }); await d.ref('hotels/' + hotel + '/operaCloudResult').remove().catch(() => {}); return true; } catch (_) { cloudMsg('Could not prepare the selected details. Check the HotelOps connection and try again.',true);return false; }
  }
  let resRef=null,wantRef=null;
  function watchCloudResult(){
    cloudContext();const d=db();if(!d||resRef)return;
    try{resRef=d.ref('hotels/'+HOTEL_ID+'/operaCloudResult');resRef.on('value',snap=>{
      const v=snap.val();if(v&&cloudTag&&v.tag!==cloudTag)return;cloudResult=v;
      if(v?.state==='running'&&Number(v.at)>Date.now()-600000)cloudRunning=true;
      if(v&&['done','failed'].includes(v.state)){cloudRunning=false;cloudNote='';cloudBad=false;cloudStage=v.state==='done'?3:cloudStage;}
      renderCloudState();
    });}catch(_){resRef=null;}
  }
  function watchCloudWant(){
    cloudContext();const d=db();if(!d||wantRef)return;
    try{wantRef=d.ref('hotels/'+HOTEL_ID+'/operaCloudWant');wantRef.on('value',snap=>{cloudWant=snap.val();renderCloudState();});}catch(_){wantRef=null;}
  }
  async function copyCloudRequest() {
    const t = cloudRequestText(); if (!t) return toast('Tick at least one fix first.', 'err');
    try { await navigator.clipboard.writeText(t); toast('Copied. Paste it in your Instinct chat and send it. The cloud run checks these rooms in Opera and replies. No names or full ID numbers are in it.', 'ok'); } catch (_) { window.prompt('Copy this, then paste it in your Instinct chat:', t); }
    setStatus('Cloud request copied: paste it in your Instinct chat. It only checks, it changes nothing.', false);
  }
  async function copyPlan() {
    if (!approvedCount()) return toast('Tick at least one fix first.', 'err');
    const ov = S.opera ? A.validateOperaUrl(S.opera) : null;
    const code = C.encodePlan(S.plan, S.ok, { origin: ov && ov.ok ? ov.origin : '' });
    if (helperFx()) { setStatus('Sending to Opera…'); window.postMessage({ source: 'ho-fx-job', code, url: ov && ov.ok ? ov.url : '' }, location.origin); return; }
    try { await navigator.clipboard.writeText(code); toast('Copied. Now paste it in the fixer window in Opera. It has ID numbers: do not share it.', 'ok'); } catch (_) { window.prompt('Copy this plan:', code); }
  }
  async function saveShared() {
    const d = db(); if (!d) return toast('Not connected to the database.', 'err');
    const bd = String((typeof _immigMeta !== 'undefined' && _immigMeta.biz) || '').slice(0, 10) || 'today', patch = {}, by = (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || '';
    S.plan.items.forEach(it => it.fields.forEach(f => {
      if ((f.field === 'gender' || f.field === 'nationality') && f.value) { patch[key(it) + '/' + f.field] = { value: f.value, on: !!S.ok[it.id][f.field], by, at: new Date().toISOString() }; }
      if (f.field === 'idNumber') patch[key(it) + '/idLast4'] = { value: C.last4(f.value) };   // never the full number
    }));
    try { await d.ref('hotels/' + HOTEL_ID + '/' + dataPath('immigFix/' + bd)).update(patch); toast('Saved for the whole team (gender and nationality only).', 'ok'); } catch (e) { toast('Could not save: ' + (e.message || e), 'err'); }
  }
  function cleanLog(text) {
    return String(text || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => { let o; try { o = JSON.parse(l); } catch (_) { return null; } if (!o || !C.FIELDS.includes(o.field)) return null;
      return { t: String(o.t || '').slice(0, 30), room: C.normRoom(o.room), arrival: String(o.arrival || '').slice(0, 12), field: o.field, to: o.field === 'idNumber' ? C.last4(String(o.to || '').replace(/[^A-Za-z0-9]/g, '')) : String(o.to || '').slice(0, 4), result: String(o.result || '').slice(0, 60), dry: !!o.dry }; }).filter(Boolean);
  }
  async function saveLog() {
    const d = db(); if (!d) return toast('Not connected to the database.', 'err');
    const rows = cleanLog(document.getElementById('immigFixLogIn').value); if (!rows.length) return toast('No log lines found.', 'err');
    const by = (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || '', hotel = S.plan && S.plan.hotel || '';
    try { const ref = d.ref('hotels/' + HOTEL_ID + '/' + dataPath('immigFixLog')); for (const r of rows) await ref.push(Object.assign({ by, hotel }, r)); document.getElementById('immigFixLogIn').value = ''; toast('Log saved (' + rows.length + ' lines).', 'ok'); showLog(); } catch (e) { toast('Could not save: ' + (e.message || e), 'err'); }
  }
  async function showLog() {
    const el = document.getElementById('immigFixLogList'), d = db(); if (!el || !d) return;
    try { const snap = await d.ref('hotels/' + HOTEL_ID + '/' + dataPath('immigFixLog')).limitToLast(15).once('value'), v = snap.val() || {}; el.textContent = Object.keys(v).map(k => v[k]).map(r => (r.t || '').slice(0, 16).replace('T', ' ') + ' room ' + r.room + ' ' + r.field + ' ' + r.to + ' · ' + r.result + (r.dry ? ' (dry)' : '') + ' · ' + (r.by || '')).reverse().join('\n') || 'No log yet.'; } catch (_) { el.textContent = ''; }
  }
  let renderToken=0;
  window.immigFixerRender = async function () {
    const token=++renderToken;
    cloudContext();
    const res = document.getElementById('immigResults2'); if (!res) return;
    let card = document.getElementById('immigFixerCard');
    if (!card) { card = document.createElement('div'); card.id = 'immigFixerCard'; card.style.cssText = 'margin:12px 0;padding:12px 14px;background:var(--card);border:1px solid var(--border);border-radius:var(--r)'; res.insertBefore(card, res.firstChild); }
    renderShell();
    try { if (typeof window.immigReconcileRender === 'function') window.immigReconcileRender(); } catch (_) {}
    const rows=typeof immigAllRows2!=='undefined'?immigAllRows2:null,list=typeof _immigInhouseList!=='undefined'?_immigInhouseList:null;
    const changed=S.lastRows!==rows||S.lastList!==list;
    if(changed){S.reviewIds=null;build();await loadShared();if(token!==renderToken)return;build();S.lastRows=rows;S.lastList=list;}
    paint();renderShell();
    if(changed&&list?.length){const reports=document.getElementById('immigReports');if(reports)reports.open=false;}

  };

  // one clear next step at a time
  function guide(){
    const nx=document.getElementById('immNext');if(!nx)return;
    ensureCloudPanel();watchCloudReady();
    const operaLabel=document.getElementById('immigOperaFileLabel'),operaInput=document.getElementById('immigFileInput2'),valid=!!(S.plan&&document.getElementById('immigResults2')?.style.display!=='none'&&!document.getElementById('immigError2')?.classList.contains('show'));
    if(operaLabel)operaLabel.textContent=valid?'✓ '+(operaInput?.files?.[0]?.name||'Report loaded'):'Not loaded';
    const vicas=document.getElementById('immigInhouseXmlLabel');if(vicas)vicas.closest('.imm-upload')?.classList.toggle('is-loaded',typeof _immigInhouseList!=='undefined'&&_immigInhouseList.length>0);if(operaLabel)operaLabel.closest('.imm-upload')?.classList.toggle('is-loaded',valid);
    if(document.getElementById('immigError2')?.classList.contains('show')){const reports=document.getElementById('immigReports');if(reports)reports.open=true;nx.textContent='This Opera report could not be read. Replace it above.';document.querySelectorAll('#panel-immig [data-imm-phase]').forEach(el=>{const active=el.dataset.immPhase==='1';el.classList.toggle('is-current',active);el.classList.remove('is-complete');if(active)el.setAttribute('aria-current','step');else el.removeAttribute('aria-current');});cloudControls();return;}
    const hasVicas=typeof _immigInhouseList!=='undefined'&&_immigInhouseList.length>0;
    const res=document.getElementById('immigResults2'),shown=!!(res&&res.style.display!=='none'&&S.plan);
    const result=cloudResult?.mode==='signin'?null:cloudResult;
    const phase=!shown||!hasVicas?1:cloudStarting||cloudRunning||result?3:2;
    const text=!hasVicas?'Upload your Vicas In-house XML to begin.':!shown?'Upload the Opera Immigration XML next.':cloudStarting||cloudRunning?'Automation is working. Follow its progress below.':result?.state==='failed'?'The run needs attention. Follow the action shown below.':result?.state==='done'?'Your results are ready below.':approvedCount()?'Review the ticked details, then press Fix.':'Choose the details you want to add, or check the full report below.';
    if(nx.textContent!==text)nx.textContent=text;
    document.querySelectorAll('#panel-immig [data-imm-phase]').forEach(el=>{const n=Number(el.dataset.immPhase);el.classList.toggle('is-current',n===phase);el.classList.toggle('is-complete',n<phase);if(n===phase)el.setAttribute('aria-current','step');else el.removeAttribute('aria-current');});
  }
  setInterval(guide, 700); setTimeout(guide, 300);
  window.hoImmigFixerState = S;
  // the Opera link box is on the page from the start, before any report is loaded
  const boot = () => { try { renderShell(); loadOperaLink(); } catch (_) {} };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  setTimeout(boot, 2500); setTimeout(boot, 7000);
})();
