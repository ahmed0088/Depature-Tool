// ═══════════════════════════════════════════════════════════
//  skip-clean.js  —  "Skip The Clean" loyalty credit calculator
//
//  Works out the loyalty points owed to guests who skipped housekeeping:
//  Skip The Clean sheets (xlsx) + Opera "Loyalty Member Stay" export (txt)
//  -> PMID + points per guest, ready to copy into the loyalty portal.
//
//  Everything runs in the browser; nothing is uploaded or saved.
//  The module adds its own sidebar item, mobile-menu item and panel, so
//  index.html only needs:  <script src="skip-clean.js"></script>
//  (load it AFTER auth.js). Needs the XLSX library the app already loads.
// ═══════════════════════════════════════════════════════════
(function () {
'use strict';

const PANEL = 'skip-clean';

// ───────────────────────── credit logic (unchanged) ─────────────────────────
// ---- Skip The Clean credit core (pure logic) ----
const iso=(y,m,d)=>{const t=new Date(Date.UTC(y,m-1,d));return t.getUTCFullYear()===y&&t.getUTCMonth()===m-1&&t.getUTCDate()===d?t.toISOString().slice(0,10):null};
const addD=(s,n)=>new Date(Date.parse(s)+n*864e5).toISOString().slice(0,10);
const diffD=(a,b)=>Math.round((Date.parse(b)-Date.parse(a))/864e5);
const ymd=s=>s.split('-').map(Number);
function s2d(v){
  const o=[];
  if(v instanceof Date){const t=new Date(v.getTime()+18e5),y=t.getFullYear(),m=t.getMonth()+1,d=t.getDate();o.push(iso(y,m,d));if(d<=12)o.push(iso(y,d,m))}
  else if(typeof v==='string'){const m=v.match(/(\d{1,2})[-./](\d{1,2})[-./](\d{4})/);if(m)o.push(iso(+m[3],+m[2],+m[1]))}
  return [...new Set(o.filter(Boolean))];
}
const toks=s=>new Set((String(s||'').replace(/I Want To…|Manage Reservation/gi,'').toLowerCase().replace(/\b(mr|mrs|ms|miss|dr)\b\.?/g,'').match(/\p{L}+/gu))||[]);
const subset=(a,b)=>[...a].every(x=>b.has(x)), inter=(a,b)=>[...a].filter(x=>b.has(x)).length, same=(a,b)=>a.size===b.size&&subset(a,b);
function titleDate(title,fm,hdr){
  const m=String(title).trim().match(/^(\d{1,2})[.,\-/](\d{1,2})(?:[.,\-/](\d{4}))?/); if(!m)return null;
  const h0=(hdr||[]).find(Boolean),yr=+m[3]||(h0?+ymd(h0)[0]:new Date().getFullYear());   // a title with no year: the sheet's own dates, else this year
  const d=+m[1],mo=+m[2],x=iso(yr,mo,d);
  if(mo!==fm){const alt=hdr.find(h=>h&&+ymd(h)[2]===d&&+ymd(h)[1]===fm);if(alt)return alt}
  return x;
}
// wbs: [{name, wb}] ; XLSX passed in
function readEntries(XLSX,files){
  const ents=[];
  for(const f of files){
    const sheets=f.wb.SheetNames.map(n=>{
      const rows=XLSX.utils.sheet_to_json(f.wb.Sheets[n],{header:1,raw:true,defval:null,blankrows:true});
      let h=null;for(const r of rows.slice(0,10)){if(typeof r[0]==='string'&&(/IBIS/i.test(r[0])||/\d{2}[/.]\d{2}[/.]\d{4}/.test(r[0])))h=r[0]}
      const hdr=h?s2d(h):[];return {n,rows,hdr,td:(()=>{const m=n.trim().match(/^(\d{1,2})[.,\-/](\d{1,2})/);return m?+m[2]:null})()};
    });
    const cnt={};sheets.forEach(s=>{if(s.td)cnt[s.td]=(cnt[s.td]||0)+1});
    const fm=+Object.entries(cnt).sort((a,b)=>b[1]-a[1])[0]?.[0]||0;
    for(const s of sheets){
      const date0=titleDate(s.n,fm,s.hdr);
      s.rows.forEach((r,i)=>{
        if(i<11||(r[0]==null&&r[2]==null))return;
        let date=date0||(s2d(r[5])[0])||null; if(!date)return;
        const name=r[2]==null?'':String(r[2]).trim(),room=r[0]==null?'':String(r[0]).trim(),conf=r[1]==null?'':String(r[1]).trim();
        const tok=toks(name),rm=room.replace(/^0+/,'');
        ents.push({file:f.name,sheet:s.n.trim(),room,rm,conf,name,tok,cin:r[3],cout:r[4],nights:r[6]==null?null:Math.round(+r[6]),date,
          nomember:/no\s*member/i.test([r[7],r[9]].filter(Boolean).join(' ')),
          key:conf||`NOCONF-${rm}-${[...tok].sort().join('-').slice(0,20)}`});
      });
    }
  }
  return ents;
}
function readLoyalty(texts){
  const map=new Map();
  for(const t of texts){
    const lines=t.split(/\r?\n/).filter(Boolean),H=lines[0].split('\t'),ix=Object.fromEntries(H.map((h,i)=>[h,i]));
    if(ix.MEMBERSHIP_CARD_NO==null)throw new Error('This Opera file has no MEMBERSHIP_CARD_NO column – use the Loyalty Member Stay report.');
    const cd=s=>{const m=(s||'').match(/^(\d\d)-(\d\d)-(\d\d)$/);return m?iso(2000+ +m[3],+m[2],+m[1]):null};
    for(const l of lines.slice(1)){
      const c=l.split('\t'),g=n=>(c[ix[n]]||'').trim();
      const gk=[g('RESV_NAME_ID'),g('FULL_NAME'),g('ROOM'),g('ARRIVAL'),g('DEPARTURE')].join('|');
      if(!map.has(gk))map.set(gk,{name:g('FULL_NAME'),tok:toks(g('FULL_NAME')),room:g('ROOM').replace(/^0+/,''),arr:cd(g('ARRIVAL')),dep:cd(g('DEPARTURE')),cards:{}});
      const r=map.get(gk),ty=g('MEMBERSHIP_TYPE'),no=g('MEMBERSHIP_CARD_NO');if(ty&&no&&!r.cards[ty])r.cards[ty]=no;
    }
  }
  return [...map.values()];
}
function sheetWindow(es){
  const e=es[0],ci=s2d(e.cin),co=s2d(e.cout);let best=null;
  for(const a of ci)for(const b of co)if(a<b){
    const sc=[es.filter(x=>a<=x.date&&x.date<=b).length,e.nights==null?0:-Math.abs(diffD(a,b)-e.nights)];
    if(!best||sc[0]>best.sc[0]||(sc[0]===best.sc[0]&&sc[1]>best.sc[1]))best={sc,w:[a,b]};
  }
  return best?best.w:null;
}
function matchRes(es,loy){
  const e=es[0],dates=[...new Set(es.map(x=>x.date))],cin=s2d(e.cin),cout=s2d(e.cout);
  const ov=r=>r.arr&&r.dep?dates.filter(d=>r.arr<=d&&d<=r.dep).length:0;
  const nm=r=>{const a=e.tok,b=r.tok;return a.size&&b.size&&(same(a,b)||(inter(a,b)>=2&&(subset(a,b)||subset(b,a)))||(a.size===1&&subset(a,b)))};
  const best=(L)=>L.reduce((p,r)=>!p||ov(r)>ov(p)||(ov(r)===ov(p)&&(r.arr||'')>(p.arr||''))?r:p,null);
  const A=loy.filter(r=>r.room===e.rm&&nm(r));
  if(A.length){const r=best(A);return [r,ov(r)>0?'Matched':'Check – name and room match but dates differ']}
  const B=loy.filter(r=>r.room===e.rm&&cin.includes(r.arr)&&cout.includes(r.dep));
  if(B.length)return [B[0],'Check – room and dates match, name differs'];
  const C=loy.filter(r=>nm(r)&&ov(r)>0);
  if(C.length)return [best(C),'Check – name matches, room differs'];
  return [null,'No match (not in Opera export)'];
}
function simulate(win,req){
  const out={};let st=0;
  for(let d=addD(win[0],1);d<win[1];d=addD(d,1)){
    if(req.has(d)){if(st>=2){out[d]=['No','Mandatory clean (3rd day after 2 skips)'];st=0}else{out[d]=['Yes','Credited'];st++}}else st=0;
  }
  return out;
}
function compute(ents,loyalty){
  const seen=new Set(),uniq=[];let dups=0;
  for(const e of ents){const k=e.key+'|'+e.date;if(seen.has(k)){dups++;continue}seen.add(k);uniq.push(e)}
  const groups=new Map();uniq.forEach(e=>{if(!groups.has(e.key))groups.set(e.key,[]);groups.get(e.key).push(e)});
  const res=[];
  for(const [key,es] of groups){
    const [m,status]=matchRes(es,loyalty);
    let win=m&&m.arr&&m.dep?[m.arr,m.dep]:sheetWindow(es);const src=m&&m.arr&&m.dep?'Opera':'Tracking sheet';
    const req=new Set(es.map(x=>x.date)),sim=win?simulate(win,req):{};
    const detail=es.slice().sort((a,b)=>a.date<b.date?-1:1).map(x=>{
      let c,r;
      if(!win)[c,r]=['No','Stay dates unreadable'];
      else if(x.date===win[0])[c,r]=['No','Arrival day'];
      else if(x.date===win[1])[c,r]=['No','Departure day'];
      else if(!(win[0]<x.date&&x.date<win[1]))[c,r]=['No','Outside stay dates'];
      else[c,r]=sim[x.date];
      return {date:x.date,counts:c,reason:r,sheet:x.sheet,nomember:x.nomember};
    });
    res.push({key,conf:es[0].conf,name:m?m.name:es[0].name,room:es[0].room,win,src,m,cards:m?m.cards:{},status,detail});
  }
  // overlap flag: same ID credited in two rooms on same date
  res.forEach(o=>{
    o.notes=[];if(o.status!=='Matched')o.notes.push(o.status);
    if(o.src!=='Opera')o.notes.push('No Opera record – dates from tracking sheet');
    const sw=o.m?sheetWindow(groups.get(o.key)):null;if(sw&&o.win&&(sw[0]!==o.win[0]||sw[1]!==o.win[1]))o.notes.push(`Opera stay ${o.win[0]} to ${o.win[1]} differs from sheet (Opera used)`);
    const ex={};o.detail.filter(d=>d.counts==='No').forEach(d=>{const k=d.reason.split(' (')[0];ex[k]=(ex[k]||0)+1});
    const ks=Object.keys(ex);if(ks.length)o.notes.push('Not counted: '+ks.map(k=>ex[k]+'× '+k.toLowerCase()).join(', '));
    if(o.detail.some(d=>d.nomember))o.notes.push('Sheet says "no member"');
    if(o.cards.ID)res.forEach(p=>{if(p!==o&&p.cards.ID===o.cards.ID){const a=new Set(o.detail.filter(d=>d.counts==='Yes').map(d=>d.date));const n=p.detail.filter(d=>d.counts==='Yes'&&a.has(d.date)).length;if(n)o.notes.push(`Same guest also credited in room ${p.room} on ${n} same date(s) – confirm both rooms count`)}});
  });
  return {res,dups,entries:uniq.length};
}
// Higher ALL tiers (A2 Silver, A3 Gold, A4 Platinum, A5 Diamond) are Accor members too. They normally
// also hold an ID card, so this is only the fallback for the few who carry just the tier card.
const TIERS=['A2','A3','A4','A5'];
const tierCard=o=>{const t=TIERS.find(x=>o.cards[x]);return t?{type:t,no:o.cards[t]}:null};
const rawOf=(o,sel)=>sel==='ID'?(o.cards.ID||''):sel==='A1'?(o.cards.A1||''):(o.cards.ID||o.cards.A1||(tierCard(o)||{}).no||'');
// PMID = drop the final character, then keep the last 8 characters (00000009270152Z4 -> 9270152Z)
const trimPM=s=>{s=(s||'').trim();return s.length>=9?s.slice(0,-1).slice(-8):s};
const pmidOf=(o,sel)=>trimPM(rawOf(o,sel));


// ───────────────────────── panel UI ─────────────────────────
const $ = id => document.getElementById('stc-' + id);
let X = [], T = [], R = null, tab = 'Ready', autoTab = false;

// ── Saved credit history ────────────────────────────────────────────────
// credited[key] = { dates:[...], pts, pmid, name, room, conf, history:[{at,by,dates,pts}] }
// key = confirmation # (or the sheet's fallback key), so a stay that runs across two
// months is recognised: next month only the NEW days are offered.
// Saved through the app's db layer (Firebase, shared live with the team, with a local
// copy as fallback), under  hotels/<hotel>/skipClean/credited/<key>
let credited = {};
const STORE = 'skipClean/credited';
const safeKey = k => String(k).replace(/[^A-Za-z0-9_-]/g, '_');
const who = () => (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || 'Front Desk';
function persist(key){
  const rec = credited[key];
  try { if (typeof lsSave === 'function') lsSave(STORE, credited); } catch (e) { /* local copy is best-effort */ }
  try { if (typeof fbSet === 'function') fbSet(STORE + '/' + safeKey(key), rec || null); }
  catch (e) { console.warn('[skip-clean] save failed:', e); toast('Could not save – check the connection'); }
}
function loadSaved(v){
  credited = {};
  Object.entries(v || {}).forEach(([k, r]) => {
    if (!r) return;
    const dates = Array.isArray(r.dates) ? r.dates : Object.values(r.dates || {});
    const history = Array.isArray(r.history) ? r.history : Object.values(r.history || {});
    credited[r.key || k] = Object.assign({}, r, { dates, history });
  });
  histNote(); if (R) draw();
}
function startSync(){
  // Subscribe once the app's Firebase connection exists (it starts after this script loads).
  let tries = 0;
  const go = () => {
    if (typeof fbListen !== 'function') return;
    if (typeof _ref !== 'undefined' && _ref) { fbListen(STORE, loadSaved); return; }
    if (++tries > 40) { loadSaved(typeof lsLoad === 'function' ? lsLoad(STORE) : null); return; }   // offline: local copy only
    setTimeout(go, 500);
  };
  go();
}
function histNote(){
  const el = $('hist'); if (!el) return;
  const recs = Object.values(credited);
  const pts = recs.reduce((a, r) => a + (r.pts || 0), 0);
  el.textContent = recs.length ? ('Saved credit history: ' + recs.length + ' guest' + (recs.length === 1 ? '' : 's') + ', ' + pts.toLocaleString() + ' points already credited. Ticked guests are never offered twice.') : 'Nothing credited yet. Tick a guest once you have entered the points; it is saved for next month.';
}
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtDates(ds){const g=[];ds.slice().sort().forEach(d=>{const[y,m,dd]=d.split('-'),k=y+'-'+m;let x=g[g.length-1];if(!x||x.k!==k){x={k,m:MON[+m-1],d:[]};g.push(x)}x.d.push(+dd)});return g.map(x=>x.d.join(', ')+' '+x.m).join('; ')}
const h = (t,c,x)=>{const e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e};
const TABS = ['Ready','Check first','Credited','Long stay','No PMID','No credit days','All'];
const CLS = {'Ready':'ok','Check first':'warn','Credited':'ok','No PMID':'bad','No credit days':'idle','Long stay':'idle'};
let tt;
function toast(m){const t=document.getElementById('stc-toast');if(!t)return;t.textContent=m;t.classList.add('show');clearTimeout(tt);tt=setTimeout(()=>t.classList.remove('show'),1600)}
async function copy(text,label,el){
  try{await navigator.clipboard.writeText(text)}catch(e){const a=document.createElement('textarea');a.value=text;a.style.cssText='position:fixed;opacity:0';document.body.append(a);a.select();document.execCommand('copy');a.remove()}
  if(el){el.classList.add('hit');setTimeout(()=>el.classList.remove('hit'),700)}toast('Copied '+label)}
function setup(d,f,k){d.onclick=()=>f.click();d.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();f.click()}};
  d.ondragover=e=>{e.preventDefault();d.classList.add('on')};d.ondragleave=()=>d.classList.remove('on');
  d.ondrop=e=>{e.preventDefault();d.classList.remove('on');load(Array.from(e.dataTransfer.files),k)};f.onchange=()=>{const fl=Array.from(f.files);f.value='';load(fl,k)}}
async function load(fs,k){$('err').textContent='';
  if(typeof XLSX==='undefined'){$('err').textContent='The Excel library did not load. Check the internet connection and reload.';return}
  try{for(const f of fs){if(k===1)X.push({name:f.name,wb:XLSX.read(await f.arrayBuffer(),{type:'array',cellDates:true})});else T.push({name:f.name,text:await f.text()})}}
  catch(e){$('err').textContent='Could not read '+e.message}
  list();run()}
function list(){for(const[k,a]of[[1,X],[2,T]]){const l=$('l'+k);l.innerHTML='';a.forEach((x,i)=>{const li=h('li',null,'✓ '+x.name);li.title='Click to remove';li.onclick=e=>{e.stopPropagation();a.splice(i,1);list();run()};l.appendChild(li)});$('d'+k).classList.toggle('has',a.length>0)}}
function run(){R=null;$('out').hidden=true;badge('—');if(!X.length||!T.length)return;
  try{R=compute(readEntries(XLSX,X),readLoyalty(T.map(t=>t.text)))}catch(e){$('err').textContent=e.message;return}
  $('out').hidden=false;autoTab=true;draw()}
function badge(v){const b=document.getElementById('badge-skip-clean');if(b)b.textContent=v}
const days=o=>o.detail.filter(d=>d.counts==='Yes').length;
const ORDER=['Ready','Check first','No credit days','Long stay','No PMID','Credited'];
function rows(){const sel=$('sel').value,p=+$('pts').value||0;
  const lim=+$('lim').value||0;
  return R.res.map(o=>{const raw=rawOf(o,sel),pm=trimPM(raw),short=!!raw&&raw.length<9;
    const tier=(sel==='ANY'&&!o.cards.ID&&!o.cards.A1)?tierCard(o):null;
    const yes=o.detail.filter(d=>d.counts==='Yes').map(d=>d.date);
    const rec=credited[o.key],prior=new Set(rec?rec.dates:[]);
    const fresh=yes.filter(d=>!prior.has(d)),was=yes.filter(d=>prior.has(d));
    const n=fresh.length;
    const nights=o.win?diffD(o.win[0],o.win[1]):null,long=lim>0&&nights!=null&&nights>lim;
    const fully=yes.length>0&&n===0&&was.length>0;
    const st=fully?'Credited':long?'Long stay':!pm?'No PMID':n===0?'No credit days':(o.status==='Matched'&&!short&&!tier)?'Ready':'Check first';
    const notes=[...(long?['Stay of '+nights+' nights is over the '+lim+'-night limit, so no credit']:[]),...o.notes,...(short?['Card number has fewer than 9 characters, so it was not trimmed']:[])];
    if(tier)notes.unshift('Only a '+tier.type+' card on file (no ID or A1): PMID worked out the same way, check it before entering');
    if(was.length&&!fully)notes.unshift('Already credited earlier: '+fmtDates(was)+'. Only the new days are counted.');
    if(fully&&rec&&rec.history&&rec.history.length){const l=rec.history[rec.history.length-1];notes.unshift('Credited '+new Date(l.at).toLocaleDateString('en-GB')+(l.by?' by '+l.by:'')+' ('+(rec.pts||0).toLocaleString()+' pts)')}
    return{o,pm,n,pt:long?0:n*p,st,notes,fresh,yes}})
  .sort((a,b)=>ORDER.indexOf(a.st)-ORDER.indexOf(b.st)||(a.o.detail[0].date<b.o.detail[0].date?-1:1))}
const ready=()=>rows().filter(r=>r.st==='Ready');
function progress(){const c=Object.keys(credited).length;$('prog').textContent=c?'· '+c+' already credited (saved)':''}
function draw(){const all=rows(),q=$('q').value.toLowerCase().trim(),rd=all.filter(r=>r.st==='Ready');
  if(autoTab){autoTab=false;const first=['Ready','Check first','No PMID','Long stay','No credit days','Credited'].find(t=>all.some(r=>r.st===t));if(first)tab=first}
  const cnt=t=>all.filter(r=>r.st===t).length;
  const note=$('note');
  if(!rd.length){
    const bits=[];
    if(cnt('Credited'))bits.push(cnt('Credited')+' already credited (saved earlier), nothing new to do');
    if(cnt('No PMID'))bits.push(cnt('No PMID')+' have no card number: not found in the Opera Loyalty export (they may not be members, or the export does not include them)');
    if(cnt('Check first'))bits.push(cnt('Check first')+' need checking first');
    if(cnt('No credit days'))bits.push(cnt('No credit days')+' have no creditable days (arrival or departure day only, or a mandatory clean)');
    if(cnt('Long stay'))bits.push(cnt('Long stay')+' are over the long-stay limit');
    note.textContent='No guest is ready to credit. Of '+all.length+' guest'+(all.length===1?'':'s')+' on the sheet: '+bits.join('; ')+'.';
    note.hidden=false;
  }else note.hidden=true;
  $('s1').textContent=rd.length;$('s2').textContent=rd.reduce((a,r)=>a+r.pt,0).toLocaleString();progress();badge(rd.length);
  ['cpA','cpB','cpC'].forEach(i=>$(i).disabled=!rd.length);
  $('meta').textContent=R.entries+' sheet entries read, '+R.dups+' duplicates removed.';
  const tabs=$('tabs');tabs.innerHTML='';
  TABS.forEach(t=>{const n=t==='All'?all.length:all.filter(r=>r.st===t).length;const b=h('button','stc-tab',t);b.type='button';b.setAttribute('aria-pressed',t===tab);b.append(h('b',null,n));b.onclick=()=>{tab=t;draw()};tabs.append(b)});
  const tb=$('tb');tb.innerHTML='';
  const vis=all.filter(r=>(tab==='All'||r.st===tab)&&(!q||[r.o.name,r.o.room,r.pm,r.o.conf].join(' ').toLowerCase().includes(q)));
  if(!vis.length){const tr=h('tr'),td=h('td','stc-empty','Nothing in this list.');td.colSpan=11;tr.append(td);tb.append(tr);return}
  vis.forEach(r=>{
    const k=r.o.key,tr=h('tr','stc-r'+(r.st==='Credited'?' done':'')),c=()=>h('td');
    const t0=c(),cb=h('input');cb.type='checkbox';cb.checked=r.st==='Credited';cb.title=r.st==='Credited'?'Untick to undo (removes it from the saved history)':'Tick when you have entered the points. It is saved so this guest is never credited twice.';cb.setAttribute('aria-label','Credited: '+r.o.name);
    cb.disabled=!(r.st==='Credited'||r.n>0);
    cb.onclick=e=>e.stopPropagation();
    cb.onchange=()=>{
      if(cb.checked){
        if(!r.n){cb.checked=false;return}
        const rec=credited[k]||{key:k,conf:r.o.conf||'',name:r.o.name,room:r.o.room,pmid:r.pm,dates:[],pts:0,history:[]};
        rec.dates=[...new Set([...(rec.dates||[]),...r.fresh])].sort();
        rec.pts=(rec.pts||0)+r.pt;rec.pmid=r.pm||rec.pmid;rec.name=r.o.name;rec.room=r.o.room;
        rec.history=[...(rec.history||[]),{at:new Date().toISOString(),by:who(),dates:r.fresh,pts:r.pt}];
        credited[k]=rec;persist(k);toast('Saved: '+r.o.name+' credited '+r.pt.toLocaleString()+' points');
      }else{
        const rec=credited[k];if(!rec)return;
        const last=(rec.history||[]).pop();
        if(last){rec.dates=(rec.dates||[]).filter(d=>!last.dates.includes(d));rec.pts=Math.max(0,(rec.pts||0)-(last.pts||0))}
        if(!rec.history||!rec.history.length||!rec.dates.length)delete credited[k];
        persist(k);toast('Undone: '+r.o.name+' is back on the list');
      }
      histNote();draw();
    };t0.append(cb);
    const t1=c();if(r.pm){const b=h('button','stc-cp pm',r.pm);b.type='button';b.title='Click to copy PMID';b.onclick=e=>{e.stopPropagation();copy(r.pm,'PMID '+r.pm,b)};t1.append(b)}else t1.textContent='–';
    const t2=c();t2.className='stc-num';if(r.pt>0){const b=h('button','stc-cp',r.pt.toLocaleString());b.type='button';b.title='Click to copy points';b.onclick=e=>{e.stopPropagation();copy(String(r.pt),r.pt+' points',b)};t2.append(b)}
    const t3=c();t3.append(h('div','stc-name',r.o.name));if(r.notes.length)t3.append(h('div','stc-sub',r.notes.join('. ')));
    const t4=c();t4.textContent=r.o.room;
    const t4b=c();if(r.o.conf){const b=h('button','stc-cp sm',r.o.conf);b.type='button';b.title='Click to copy confirmation number';b.onclick=e=>{e.stopPropagation();copy(r.o.conf,'confirmation '+r.o.conf,b)};t4b.append(b)}else t4b.textContent='–';
    const t4d=c();if(r.o.win){const[y,m,d]=r.o.win[1].split('-'),b=h('button','stc-cp sm',+d+' '+MON[+m-1]+' '+y);b.type='button';b.title='Click to copy check-out date as DD/MM/YYYY';b.onclick=e=>{e.stopPropagation();copy(d+'/'+m+'/'+y,'check-out '+d+'/'+m+'/'+y,b)};t4d.append(b)}else t4d.textContent='–';
    const t4c=c();t4c.className='stc-dates';t4c.textContent=r.n?fmtDates(r.o.detail.filter(d=>d.counts==='Yes').map(d=>d.date)):'–';
    const t5=c();t5.className='stc-num';t5.textContent=r.n;
    const t6=c();t6.append(h('span','stc-tag '+CLS[r.st],r.st));
    const t7=c();if(r.pm&&r.pt>0){const b=h('button','stc-mini','Copy both');b.type='button';b.title='Copy PMID and points, separated by a tab';b.onclick=e=>{e.stopPropagation();copy(r.pm+'\t'+r.pt,'PMID + points',b)};t7.append(b)}
    tr.append(t0,t1,t2,t3,t4,t4b,t4d,t4c,t5,t6,t7);
    const dt=h('tr','stc-det');dt.hidden=true;const dd=h('td');dd.colSpan=11;
    const f=h('div','stc-facts');f.append(h('span',null,'Confirmation # '+(r.o.conf||'none')),h('span',null,'Stay '+(r.o.win?r.o.win[0]+' to '+r.o.win[1]:'unreadable')+' ('+r.o.src+')'));
    const ch=h('div','stc-chips');r.o.detail.forEach(d=>ch.append(h('span','stc-chip'+(d.counts==='Yes'?' y':''),d.date+(d.counts==='Yes'?' credited':' not counted: '+d.reason))));
    dd.append(f,ch);dt.append(dd);
    tr.onclick=()=>dt.hidden=!dt.hidden;tb.append(tr,dt)})}

function exportXlsx(){const all=rows(),wb=XLSX.utils.book_new();
  const a=[['PMID','Points','Status','Guest','Room','Confirmation #','Arrival','Departure','Credit days','ID number','ALL card (A1)','Notes','Credited dates']];
  all.forEach(r=>a.push([r.pm,r.pt,r.st,r.o.name,r.o.room,r.o.conf,r.o.win?r.o.win[0]:'',r.o.win?r.o.win[1]:'',r.n,r.o.cards.ID||'',r.o.cards.A1||'',r.notes.join('; '),r.o.detail.filter(d=>d.counts==='Yes').map(d=>d.date).join(', ')]));
  const s1=XLSX.utils.aoa_to_sheet(a);s1['!cols']=[12,8,14,30,7,14,11,11,9,20,20,60,40].map(w=>({wch:w}));XLSX.utils.book_append_sheet(wb,s1,'Credit List');
  const b=[['Confirmation #','Guest','Room','Date','Counts?','Reason','Source sheet']];all.forEach(r=>r.o.detail.forEach(d=>b.push([r.o.conf,r.o.name,r.o.room,d.date,d.counts,d.reason,d.sheet])));
  const s2=XLSX.utils.aoa_to_sheet(b);s2['!cols']=[14,30,7,11,9,40,16].map(w=>({wch:w}));XLSX.utils.book_append_sheet(wb,s2,'Day Detail');
  XLSX.writeFile(wb,'Skip_The_Clean_Credit_List.xlsx')}

function clearAll(){X=[];T=[];R=null;tab='Ready';$('err').textContent='';list();$('out').hidden=true;badge('—')}

// ───────────────────────── mounting into the app ─────────────────────────
const CSS = `
#panel-skip-clean{--stc-ok:var(--green,#3ecf8e);--stc-okbg:var(--green-bg,rgba(62,207,142,.14));--stc-warn:var(--amber,#d97706);--stc-warnbg:var(--amber-bg,rgba(217,119,6,.14));--stc-bad:var(--red,#f06b7a);--stc-badbg:var(--red-bg,rgba(240,107,122,.14));--stc-idle:var(--text2,#8b949e);--stc-idlebg:rgba(128,128,128,.14);--stc-acc:var(--blue,#2563eb);--stc-accbg:var(--blue-bg,rgba(37,99,235,.12));--stc-line:var(--border,#30363d)}
#panel-skip-clean .stc-wrapper{max-width:1400px}
#panel-skip-clean .stc-setup{display:grid;grid-template-columns:1fr 1fr 270px;gap:12px}
@media(max-width:860px){#panel-skip-clean .stc-setup{grid-template-columns:1fr}}
#panel-skip-clean .stc-card{background:var(--card);border:1px solid var(--stc-line);border-radius:10px;padding:14px 16px}
#panel-skip-clean .stc-drop{border:2px dashed var(--border2,#4b5563);cursor:pointer;display:flex;flex-direction:column;gap:2px;min-height:104px;transition:background .15s}
#panel-skip-clean .stc-drop span{color:var(--text2);font-size:.8rem}
#panel-skip-clean .stc-drop.on{border-color:var(--stc-acc);background:var(--stc-accbg)}
#panel-skip-clean .stc-drop.has{border:2px solid var(--stc-ok)}
#panel-skip-clean .stc-drop ul{list-style:none;margin:6px 0 0;padding:0;font-size:.8rem;color:var(--stc-ok);font-weight:600}
#panel-skip-clean .stc-drop li{cursor:pointer;padding:1px 0}
#panel-skip-clean .stc-drop li:hover{text-decoration:line-through}
#panel-skip-clean .stc-settings{display:flex;flex-direction:column;gap:10px}
#panel-skip-clean .stc-settings label{display:flex;flex-direction:column;gap:3px;font-weight:600;font-size:.78rem}
#panel-skip-clean .stc-settings input,#panel-skip-clean .stc-settings select,#panel-skip-clean .stc-filters input{padding:7px 9px;border:1px solid var(--stc-line);border-radius:6px;background:var(--bg2,var(--card));color:var(--text);font:inherit}
#panel-skip-clean .stc-hint{margin:0;font-size:.72rem;color:var(--text2)}
#panel-skip-clean .stc-err{color:var(--stc-bad);font-weight:600;margin:10px 0 0}
#panel-skip-clean .stc-err:empty{display:none}
#panel-skip-clean .stc-sum{margin:20px 0 10px;font-size:1.1rem}
#panel-skip-clean .stc-sum strong{font-size:1.9rem;font-variant-numeric:tabular-nums;margin-right:2px}
#panel-skip-clean .stc-note{margin-top:14px;padding:10px 14px;border-radius:8px;background:var(--stc-warnbg);border:1px solid var(--stc-warn);color:var(--text);font-size:.85rem;line-height:1.5}
#panel-skip-clean .stc-note[hidden]{display:none}
#panel-skip-clean .stc-prog{font-size:.85rem;color:var(--text2);margin-left:6px}
#panel-skip-clean .stc-copybar{display:flex;gap:10px 24px;flex-wrap:wrap;align-items:center;justify-content:space-between;margin-bottom:14px}
#panel-skip-clean .stc-grp{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
#panel-skip-clean .stc-lbl{font-weight:600;margin-right:4px}
#panel-skip-clean .stc-filters{display:flex;gap:10px 16px;flex-wrap:wrap;align-items:end;justify-content:space-between;margin-bottom:10px}
#panel-skip-clean .stc-filters label{display:flex;flex-direction:column;gap:3px;font-weight:600;font-size:.78rem}
#panel-skip-clean .stc-tabs{display:flex;gap:6px;flex-wrap:wrap}
#panel-skip-clean .stc-tab{background:var(--card);color:var(--text);border:1px solid var(--stc-line);border-radius:999px;padding:6px 14px;font:inherit;font-weight:600;cursor:pointer}
#panel-skip-clean .stc-tab b{margin-left:6px;color:var(--text2);font-variant-numeric:tabular-nums}
#panel-skip-clean .stc-tab[aria-pressed=true]{background:var(--text);border-color:var(--text);color:var(--bg)}
#panel-skip-clean .stc-tab[aria-pressed=true] b{color:var(--bg);opacity:.7}
#panel-skip-clean .stc-filters input{width:260px;max-width:100%}
#panel-skip-clean .stc-wrap{background:var(--card);border:1px solid var(--stc-line);border-radius:10px;overflow:auto;max-height:74vh}
#panel-skip-clean table{width:100%;border-collapse:collapse;min-width:1160px}
#panel-skip-clean th{position:sticky;top:0;z-index:1;background:var(--bg2,var(--card));color:var(--text2);font-size:.72rem;text-align:left;padding:9px 12px;border-bottom:1px solid var(--stc-line)}
#panel-skip-clean td{padding:8px 12px;border-bottom:1px solid var(--stc-line);vertical-align:middle}
#panel-skip-clean tr.stc-r{cursor:pointer}
#panel-skip-clean tr.stc-r:hover td{background:rgba(128,128,128,.07)}
#panel-skip-clean tr.done td{opacity:.45}
#panel-skip-clean tr.done .pm{text-decoration:line-through}
#panel-skip-clean td input[type=checkbox]{width:20px;height:20px;accent-color:var(--stc-ok);cursor:pointer}
#panel-skip-clean .stc-cp{border:1px dashed transparent;background:transparent;color:var(--text);padding:3px 8px;border-radius:6px;cursor:copy;font-family:Consolas,"SF Mono",Menlo,monospace;font-weight:700;font-variant-numeric:tabular-nums;font-size:1rem;transition:background .15s}
#panel-skip-clean .stc-cp.pm{font-size:1.2rem;letter-spacing:.03em}
#panel-skip-clean .stc-cp:hover{background:var(--stc-accbg);border-color:var(--stc-acc)}
#panel-skip-clean .stc-cp.hit{background:var(--stc-okbg);border-color:var(--stc-ok);color:var(--stc-ok)}
#panel-skip-clean .stc-cp.sm{font-size:.85rem}
#panel-skip-clean .stc-num{text-align:right}
#panel-skip-clean .stc-dates{max-width:240px;font-size:.85rem}
#panel-skip-clean .stc-name{font-weight:600}
#panel-skip-clean .stc-sub{font-size:.72rem;color:var(--text2);max-width:520px}
#panel-skip-clean .stc-tag{display:inline-block;padding:2px 9px;border-radius:6px;font-size:.8rem;font-weight:600;white-space:nowrap}
#panel-skip-clean .stc-tag.ok{background:var(--stc-okbg);color:var(--stc-ok)}
#panel-skip-clean .stc-tag.warn{background:var(--stc-warnbg);color:var(--stc-warn)}
#panel-skip-clean .stc-tag.bad{background:var(--stc-badbg);color:var(--stc-bad)}
#panel-skip-clean .stc-tag.idle{background:var(--stc-idlebg);color:var(--stc-idle)}
#panel-skip-clean .stc-mini{background:transparent;color:var(--stc-acc);border:1px solid var(--stc-line);border-radius:6px;padding:4px 10px;font:inherit;font-size:.78rem;font-weight:600;white-space:nowrap;cursor:pointer}
#panel-skip-clean .stc-mini:hover{background:var(--stc-accbg)}
#panel-skip-clean tr.stc-det td{background:rgba(128,128,128,.05);font-size:.8rem;color:var(--text2)}
#panel-skip-clean .stc-facts{display:flex;gap:6px 28px;flex-wrap:wrap;margin-bottom:6px;color:var(--text)}
#panel-skip-clean .stc-chips{display:flex;gap:6px;flex-wrap:wrap}
#panel-skip-clean .stc-chip{border-radius:6px;padding:2px 8px;background:var(--stc-idlebg)}
#panel-skip-clean .stc-chip.y{background:var(--stc-okbg);color:var(--stc-ok)}
#panel-skip-clean .stc-empty{text-align:center;color:var(--text2);padding:28px}
#panel-skip-clean .stc-how{margin-top:18px;font-size:.8rem;color:var(--text2)}
#panel-skip-clean .stc-how summary{cursor:pointer;font-weight:600}
#stc-toast{position:fixed;left:50%;bottom:26px;transform:translate(-50%,20px);background:var(--text,#111);color:var(--bg,#fff);padding:10px 18px;border-radius:8px;font-weight:600;opacity:0;pointer-events:none;transition:opacity .15s,transform .15s;max-width:90vw;z-index:10000}
#stc-toast.show{opacity:1;transform:translate(-50%,0)}`;

const PANEL_HTML = `
<div class="stc-wrapper">
  <div class="page-hd">
    <div class="page-hd-left">
      <h1>Skip The Clean</h1>
      <p>Loyalty point credits for skipped housekeeping · your files stay in this browser</p>
    </div>
    <div class="page-hd-actions">
      <button class="btn rose" type="button" id="stc-clear">✕ Clear</button>
    </div>
  </div>
  <section class="stc-setup">
    <div class="stc-card stc-drop" id="stc-d1" tabindex="0" role="button"><b>1. Skip The Clean Excel files</b><span>Drop the monthly .xlsx files here, or click to choose</span><ul id="stc-l1"></ul><input id="stc-f1" type="file" accept=".xlsx,.xls" multiple hidden></div>
    <div class="stc-card stc-drop" id="stc-d2" tabindex="0" role="button"><b>2. Opera “Loyalty Member Stay” export</b><span>Drop the .txt file(s) here, or click to choose</span><ul id="stc-l2"></ul><input id="stc-f2" type="file" accept=".txt,.csv,.tsv" multiple hidden></div>
    <div class="stc-card stc-settings">
      <label>Points per skipped day<input id="stc-pts" type="number" min="0" value="100"></label>
      <label>Long stay limit (nights)<input id="stc-lim" type="number" min="0" value="15"></label>
      <label>Card to use<select id="stc-sel"><option value="ANY">Any (ID, else A1, else A2–A5)</option><option value="ID">ID number</option><option value="A1">ALL card (A1)</option></select></label>
      <p class="stc-hint">Stays over the limit are long stays and get no credit (0 = no limit). PMID = last 8 characters of the card number, after dropping its final character.</p>
    </div>
  </section>
  <div id="stc-err" class="stc-err" role="alert"></div>
  <div id="stc-out" hidden>
    <div class="stc-note" id="stc-note" hidden></div>
    <p class="stc-hint" id="stc-hist" style="margin:14px 0 0"></p>
    <p class="stc-sum"><strong id="stc-s1">0</strong> guests ready, <strong id="stc-s2">0</strong> points<span class="stc-prog" id="stc-prog"></span></p>
    <div class="stc-card stc-copybar">
      <div class="stc-grp"><span class="stc-lbl">Copy all ready guests:</span><button class="btn gold" type="button" id="stc-cpC">PMID + points</button><button class="btn" type="button" id="stc-cpA">PMIDs only</button><button class="btn" type="button" id="stc-cpB">Points only</button></div>
      <button class="btn mint" type="button" id="stc-xl">📥 Download Excel</button>
    </div>
    <div class="stc-filters">
      <div class="stc-tabs" id="stc-tabs"></div>
      <label>Search<input id="stc-q" placeholder="Guest, room, PMID or conf #"></label>
    </div>
    <div class="stc-wrap"><table><thead><tr><th>Done</th><th>PMID (click to copy)</th><th class="stc-num">Points</th><th>Guest</th><th>Room</th><th>Conf #</th><th>Check-out</th><th>Skipped dates</th><th class="stc-num">Days</th><th>Status</th><th></th></tr></thead><tbody id="stc-tb"></tbody></table></div>
    <p class="stc-hint" id="stc-meta" style="margin-top:8px"></p>
    <details class="stc-how"><summary>How credits are counted</summary><p>Arrival and departure days never count. A day counts only if the guest asked for the skip. After 2 skipped days the 3rd day is a mandatory clean (not credited) and the count restarts. Stay dates come from Opera when the guest is matched, otherwise from the sheet. Guests are matched to Opera by name and room. Stays longer than the long stay limit get no credit. Click a row to see its days.</p></details>
  </div>
</div>`;

function mount() {
  if (document.getElementById('panel-' + PANEL)) return;
  const main = document.querySelector('main.main') || document.querySelector('main');
  const nav  = document.querySelector('nav.sidenav') || document.querySelector('nav');
  if (!main || !nav) { console.warn('[skip-clean] app layout not found; panel not added'); return; }

  const st = document.createElement('style'); st.id = 'stc-style'; st.textContent = CSS; document.head.appendChild(st);

  const panel = document.createElement('div');
  panel.className = 'panel'; panel.id = 'panel-' + PANEL; panel.innerHTML = PANEL_HTML;
  main.appendChild(panel);

  const t = document.createElement('div'); t.id = 'stc-toast'; t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite');
  document.body.appendChild(t);

  const item = document.createElement('div');
  item.className = 'nav-item'; item.id = 'nav-' + PANEL; item.dataset.panel = PANEL;
  item.setAttribute('onclick', "showPanel('" + PANEL + "')");
  item.innerHTML = '<div class="nav-icon">🧹</div>Skip The Clean<span class="nav-badge" id="badge-skip-clean">—</span>';
  const anchor = document.getElementById('nav-td-audit') || document.getElementById('nav-tourism');
  if (anchor && anchor.parentNode === nav) anchor.after(item); else nav.appendChild(item);

  const grid = document.querySelector('.mob-more-grid');
  if (grid) {
    const b = document.createElement('button');
    b.className = 'mob-more-item'; b.dataset.panel = PANEL;
    b.setAttribute('onclick', "showPanel('" + PANEL + "');toggleMobMore()");
    b.innerHTML = '<span class="mob-item-icon">🧹</span><span class="mob-more-badge"></span>Skip The Clean';
    grid.appendChild(b);
  }

  // role access: managers, supervisors and the owner (agents / read-only do not see it)
  try {
    ['owner', 'manager', 'supervisor'].forEach(r => {
      if (typeof ROLES !== 'undefined' && ROLES[r] && !ROLES[r].panels.includes(PANEL)) ROLES[r].panels.push(PANEL);
    });
    if (typeof currentProfile !== 'undefined' && currentProfile && typeof applyRole === 'function') applyRole(currentProfile.role);
  } catch (e) { console.warn('[skip-clean] role setup:', e); }

  setup($('d1'), $('f1'), 1); setup($('d2'), $('f2'), 2);
  ['pts', 'sel', 'q', 'lim'].forEach(id => $(id).addEventListener('input', () => R && draw()));
  $('cpC').onclick = () => { const a = ready(); copy(a.map(r => r.pm + '\t' + r.pt).join('\n'), a.length + ' rows (PMID + points)', $('cpC')); };
  $('cpA').onclick = () => { const a = ready(); copy(a.map(r => r.pm).join('\n'), a.length + ' PMIDs', $('cpA')); };
  $('cpB').onclick = () => { const a = ready(); copy(a.map(r => r.pt).join('\n'), a.length + ' point values', $('cpB')); };
  $('xl').onclick = exportXlsx;
  $('clear').onclick = clearAll;
  histNote(); startSync();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();

})();
