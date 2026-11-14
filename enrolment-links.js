// Named enrolment destinations. Selecting a link never starts or changes a job.
(function(W){
  'use strict';
  function portalUrl(value){
    const text=String(value||'').trim();if(text.length>4096)throw Error('The enrolment link is too long.');
    let u;try{u=new URL(text);}catch(_){throw Error('Paste the full enrolment link.');}
    if(u.protocol!=='https:'||u.hostname!=='secure.guestinternet.com'||u.username||u.password||u.port)throw Error('Use an HTTPS enrolment link on secure.guestinternet.com.');
    return text; // retain the hotel's query parameters and fragment exactly
  }
  function profile(value,id){
    if(!value||typeof value!=='object'||!/^p[a-zA-Z0-9_-]{1,70}$/.test(id))return null;
    const name=String(value.name||'').trim();if(!name||name.length>80)return null;
    try{return {id,name,url:portalUrl(value.url),updatedAt:Number(value.updatedAt)||0};}catch(_){return null;}
  }
  function profiles(value){return Object.fromEntries(Object.entries(value&&typeof value==='object'?value:{}).map(([id,v])=>[id,profile(v,id)]).filter(([,v])=>v).slice(0,50));}
  if(typeof module==='object'&&module.exports){module.exports={portalUrl,profile,profiles};return;}
  const D=document,esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const scope=()=>typeof HOTEL_ID!=='undefined'?String(HOTEL_ID||'device'):'device';
  const cacheKey=s=>'gp_enrolment_links_v1:'+s;
  const toast=(message,type='ok')=>{if(typeof showToast==='function')showToast(message,type);};
  let state=null;
  function cache(s){try{localStorage.setItem(cacheKey(s.scope),JSON.stringify({items:s.items,selected:s.selected,pending:s.pending,url:s.url,known:s.known}));return true;}catch(_){return false;}}
  function current(){
    const key=scope();if(state&&state.scope===key){listen(state);return state;}
    const previous=state;let saved={};try{saved=JSON.parse(localStorage.getItem(cacheKey(key))||'{}');}catch(_){}
    const items=profiles(saved.items),selected=items[saved.selected]?saved.selected:'';
    let url='';try{url=selected?items[selected].url:Object.prototype.hasOwnProperty.call(saved,'url')?String(saved.url||''):localStorage.getItem('gp_accor_url_v1:'+key)||'';if(url)url=portalUrl(url);}catch(_){url='';}
    const pending=Object.fromEntries(Object.entries(saved.pending&&typeof saved.pending==='object'?saved.pending:{}).filter(([id,value])=>/^p[a-zA-Z0-9_-]{1,70}$/.test(id)&&(value===null||profile(value,id))));
    state={scope:key,items,selected,url,known:saved.known!==undefined?!!saved.known:!!url,pending,listening:false,saving:new Set()};
    if(previous)for(const id of ['gpAccorUrl','gqUrl']){const input=D.getElementById(id);if(input)input.value=url;}
    listen(state);return state;
  }
  function connected(){return typeof fbSet==='function'&&typeof _ref!=='undefined'&&!!_ref;}
  async function sync(s,id,value){
    if(!connected())return false;
    await fbSet('enrollPortalLinks/'+id,value);
    if(JSON.stringify(s.pending[id])===JSON.stringify(value))delete s.pending[id];
    cache(s);return true;
  }
  function listen(s){
    if(s.listening||typeof fbListen!=='function'||typeof _ref==='undefined'||!_ref)return;
    s.listening=true;
    fbListen('enrollPortalLinks',remote=>{
      if(state!==s||scope()!==s.scope)return;
      const next=profiles(remote);
      for(const [id,pending]of Object.entries(s.pending)){
        if(pending===null)delete next[id];else{const valid=profile(pending,id);if(valid)next[id]=valid;}
      }
      const changed=JSON.stringify(s.items)!==JSON.stringify(next);s.items=next;let reset=false;
      if(s.selected&&!s.items[s.selected]){s.selected='';s.url='';s.known=true;reset=true;}
      else if(s.selected&&s.items[s.selected].url!==s.url)s.selected='';
      cache(s);if(changed)paint(reset);
    });
    // Offline saves are idempotent and retain their exact profile IDs.
    for(const [id,value]of Object.entries(s.pending))sync(s,id,value).catch(()=>{});
  }
  function ids(prefix){return {root:prefix==='gq'?'gqPortalPicker':'gpPortalPicker',url:prefix==='gq'?'gqUrl':'gpAccorUrl',name:prefix+'PortalName',select:prefix+'PortalSelect'};}
  function draft(prefix,s){
    const n=ids(prefix),root=D.getElementById(n.root);if(!root||root.dataset.scope!==s.scope)return null;
    return {url:D.getElementById(n.url)?.value||'',name:D.getElementById(n.name)?.value||'',edit:root.dataset.edit||'',open:!!root.querySelector('details')?.open};
  }
  function html(prefix,url,keep=true){
    const s=current(),n=ids(prefix),old=keep?draft(prefix,s):null;
    const value=old?old.url:s.url,selected=s.selected&&s.items[s.selected]?.url===value?s.selected:'',item=s.items[selected];
    const edit=old?.edit||selected,name=old?old.name:item?.name||'',open=old?old.open:!selected;
    const options=Object.values(s.items).sort((a,b)=>a.name.localeCompare(b.name));
    return `<div id="${n.root}" class="gp-portal-picker" data-scope="${esc(s.scope)}" data-edit="${esc(edit)}"><label class="gp-portal-choice"><span>Hotel enrolment link</span><select id="${n.select}" onchange="GPEnrollmentLinks.choose('${prefix}',this.value)"><option value="">${options.length?'Choose a hotel or paste a link…':'Paste a link, then save its hotel name'}</option>${options.map(p=>`<option value="${p.id}" ${selected===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label>${item?`<p class="gp-portal-selected">Selected: <b>${esc(item.name)}</b></p>`:''}<details class="gp-portal-editor" ${open?'open':''}><summary>${selected?'Edit or remove this saved link':'Paste a link · save for later if you want'}</summary><label class="gp-accor-url gq-url"><span>Enrolment portal link</span><input id="${n.url}" type="url" value="${esc(value)}" placeholder="https://secure.guestinternet.com/…" autocomplete="off" spellcheck="false" oninput="GPEnrollmentLinks.edited('${prefix}')" onchange="GPEnrollmentLinks.remember('${prefix}')"></label><label class="gp-portal-name"><span>Hotel name <small>to save this link</small></span><input id="${n.name}" value="${esc(name)}" maxlength="80" placeholder="e.g. Mercure Dubai Deira" autocomplete="off"></label><div class="gp-portal-buttons"><button type="button" class="btn" onclick="GPEnrollmentLinks.save('${prefix}')" ${s.saving.has(edit)?'disabled':''}>${edit?'Save changes':'Save hotel link'}</button>${edit?`<button type="button" class="btn" onclick="GPEnrollmentLinks.remove('${prefix}')" ${s.saving.has(edit)?'disabled':''}>Remove saved link</button>`:''}</div><p class="gp-portal-error" data-portal-error role="alert"></p></details></div>`;
  }
  function paint(reset=false){
    const active=D.activeElement,focus=active&&/^(gp|gq)(PortalName|AccorUrl|Url)$/.test(active.id)?{id:active.id,start:active.selectionStart,end:active.selectionEnd}:null;
    const s=current();for(const prefix of ['gp','gq']){const n=ids(prefix),root=D.getElementById(n.root);if(root)root.outerHTML=html(prefix,s.url,!reset);else if(prefix==='gp'){const input=D.getElementById(n.url);if(input)input.value=s.url;}}
    if(!reset&&focus){const input=D.getElementById(focus.id);if(input){input.focus({preventScroll:true});try{input.setSelectionRange(focus.start,focus.end);}catch(_){}}}
  }
  function error(prefix,message){const el=D.getElementById(ids(prefix).root)?.querySelector('[data-portal-error]');if(el)el.textContent=message;else toast(message,'err');}
  function selected(url){const s=current(),item=s.items[s.selected];return item&&item.url===String(url||'').trim()?{id:item.id,name:item.name,url:item.url}:null;}
  function choose(prefix,id){
    const s=current();if(id&&!s.items[id])return;
    s.selected=id;s.url=id?s.items[id].url:'';s.known=true;cache(s);
    if(id&&typeof gpSaveAccorUrl==='function')gpSaveAccorUrl(s.url);
    if(!id){try{localStorage.removeItem('gp_accor_url_v1:'+s.scope);}catch(_){}}
    paint(true);
  }
  function edited(prefix){
    const s=current(),n=ids(prefix),value=D.getElementById(n.url)?.value||'';
    s.url=value.trim();s.known=true;if(s.items[s.selected]?.url!==s.url)s.selected='';
    const select=D.getElementById(n.select);if(select)select.value=s.selected;
    const badge=D.getElementById(n.root)?.querySelector('.gp-portal-selected');if(badge&&!s.selected)badge.remove();
    const other=D.getElementById(prefix==='gq'?'gpAccorUrl':'gqUrl');if(other)other.value=value;
  }
  function remember(prefix){edited(prefix);const s=current();try{const url=portalUrl(s.url);if(typeof gpSaveAccorUrl==='function')gpSaveAccorUrl(url);cache(s);}catch(_){} }
  async function save(prefix){
    const s=current(),n=ids(prefix),root=D.getElementById(n.root);if(!root)return;
    let url;try{url=portalUrl(D.getElementById(n.url)?.value);}catch(e){error(prefix,e.message);return;}
    const name=String(D.getElementById(n.name)?.value||'').trim();if(!name||name.length>80){error(prefix,'Add a hotel name of up to 80 characters so you can find this link later.');return;}
    const edit=root.dataset.edit,id=edit&&s.items[edit]?edit:'p'+Date.now().toString(36)+Math.random().toString(36).slice(2,9);
    if(Object.values(s.items).some(p=>p.id!==id&&p.name.toLowerCase()===name.toLowerCase())){error(prefix,'That hotel name is already saved. Select it to edit its link.');return;}
    if(!s.items[id]&&Object.keys(s.items).length>=50){error(prefix,'You can save up to 50 hotel links.');return;}
    const value={id,name,url,updatedAt:Date.now()};s.items[id]=value;s.pending[id]=value;s.selected=id;s.url=url;s.known=true;s.saving.add(id);const stored=cache(s);paint(true);
    if(typeof gpSaveAccorUrl==='function')gpSaveAccorUrl(url);
    let shared=false;try{shared=await sync(s,id,value);}catch(_){}
    s.saving.delete(id);cache(s);if(state===s)for(const prefix of ['gp','gq']){const root=D.getElementById(ids(prefix).root);if(root?.dataset.edit===id)root.querySelectorAll('.gp-portal-buttons button').forEach(b=>b.disabled=false);}
    toast(shared?'Hotel link saved':stored?'Hotel link saved on this device'+(connected()?' · team sync unavailable':''):'Link ready for this session; device storage is unavailable',stored||shared?'ok':'err');
  }
  async function remove(prefix){
    const s=current(),root=D.getElementById(ids(prefix).root),id=root?.dataset.edit;if(!id||!s.items[id])return;
    delete s.items[id];s.pending[id]=null;if(s.selected===id){s.selected='';s.url='';s.known=true;try{localStorage.removeItem('gp_accor_url_v1:'+s.scope);}catch(_){}}
    cache(s);paint(true);try{await sync(s,id,null);}catch(_){}toast('Saved hotel link removed','ok');
  }
  function mount(){const s=current(),root=D.getElementById('gpPortalPicker');if(root)root.outerHTML=html('gp',s.url,false);}
  function adoptLegacy(url){const s=current();if(s.known||s.url||s.selected)return;try{s.url=portalUrl(url);s.known=true;cache(s);paint(true);}catch(_){}}
  W.GPEnrollmentLinks={html,mount,selected,choose,edited,remember,save,remove,adoptLegacy,validate:portalUrl};
})(typeof window!=='undefined'?window:globalThis);
