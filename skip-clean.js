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
    const lines=t.split(/\r?\n/).filter(Boolean),H=(lines[0]||'').split('\t').map(x=>x.trim()),ix=Object.fromEntries(H.map((h,i)=>[h,i]));
    if(ix.MEMBERSHIP_CARD_NO==null){
      if(H.length<3)throw new Error('The Opera file is not tab-separated. In Opera: Download As… → File Format "Delimited Data" → Delimiter "Tab" (not HTML, RTF, XML or plain "Delimited").');
      throw new Error('This Opera file has no MEMBERSHIP_CARD_NO column. Use the report "Membership Stays" (internal name loyalty_member_stay, in the Reservation group), downloaded as Delimited Data with a Tab delimiter.');
    }
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
  const g = savedGuests();
  el.textContent = recs.length ? ('Saved credit history: ' + g + ' guest' + (g === 1 ? '' : 's') + ', ' + pts.toLocaleString() + ' points already credited. Ticked guests are never offered twice.') : 'Nothing credited yet. Tick a guest once you have entered the points; it is saved for next month.';
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
function list(){for(const[k,a]of[[1,X],[2,T]]){const l=$('l'+k);l.innerHTML='';a.forEach((x,i)=>{const li=h('li',null,x.name);li.title='Click to remove this file';li.onclick=e=>{e.stopPropagation();a.splice(i,1);list();run()};l.appendChild(li)});$('d'+k).classList.toggle('has',a.length>0);const s=$('st'+k);if(s)s.classList.toggle('done',a.length>0)}
  const s3=$('st3');if(s3)s3.classList.toggle('ready',X.length>0&&T.length>0)}
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
// ── One line per member ─────────────────────────────────────────────────
// A guest who stays on under a new confirmation # is a separate stay in rows() (points are
// worked out per stay and never change here). For the list, copy, Excel, PDF and the Done
// tick, stays of the same member (same PMID) with the same status are merged into ONE line,
// because points are entered per member. No PMID = never merged. Saved credit stays per stay
// (per confirmation #), so earlier saved data is still recognised.
const MERGE=new Set(['Ready','Check first','Credited']);
function mergeLine(st){
  if(st.length===1)return Object.assign({},st[0],{stays:st});
  st=st.slice().sort((a,b)=>a.o.detail[0].date<b.o.detail[0].date?-1:1);
  const f=st[0],uniq=a=>[...new Set(a.filter(Boolean))];
  const wins=st.map(r=>r.o.win).filter(Boolean);
  const win=wins.length?[wins.map(w=>w[0]).sort()[0],wins.map(w=>w[1]).sort().pop()]:null;
  const detail=[].concat(...st.map(r=>r.o.detail)).sort((a,b)=>a.date<b.date?-1:1);
  const o={key:st.map(r=>r.o.key).join('+'),conf:uniq(st.map(r=>r.o.conf)).join(' + '),name:uniq(st.map(r=>r.o.name)).join(' / '),
    room:uniq(st.map(r=>r.o.room)).join(' / '),win,src:uniq(st.map(r=>r.o.src)).join(' / '),cards:f.o.cards,detail};
  const notes=[],isCr=f.st==='Credited',crd=/^Credited \S+ /;
  if(isCr){const when=uniq(st.map(r=>{const h=(credited[r.o.key]||{}).history||[],l=h[h.length-1];return l?new Date(l.at).toLocaleDateString('en-GB')+(l.by?' by '+l.by:''):''}));
    notes.push('Credited '+(when.join(', ')||'earlier')+' ('+st.reduce((a,r)=>a+((credited[r.o.key]||{}).pts||0),0).toLocaleString()+' pts)')}
  st.forEach(r=>{const n=isCr?r.notes.filter(x=>!crd.test(x)):r.notes;if(n.length)notes.push((r.o.conf||'Stay')+': '+n.join('. '))});
  return{o,pm:f.pm,st:f.st,stays:st,n:st.reduce((a,r)=>a+r.n,0),pt:st.reduce((a,r)=>a+r.pt,0),notes,
    fresh:[].concat(...st.map(r=>r.fresh)).sort(),yes:[].concat(...st.map(r=>r.yes)).sort()};
}
function lines(){
  const groups=[],by=new Map();
  rows().forEach(r=>{
    if(!r.pm||!MERGE.has(r.st)){groups.push([r]);return}
    const k=r.st+'|'+r.pm;if(by.has(k))by.get(k).push(r);else{const a=[r];by.set(k,a);groups.push(a)}
  });
  const out=groups.map(mergeLine);
  out.forEach(l=>{if(l.st!=='Ready')return;
    const c=out.filter(x=>x.st==='Check first'&&x.pm===l.pm).reduce((a,x)=>a+x.stays.length,0);
    if(c)l.hint='This member also has '+c+' stay'+(c===1?'':'s')+' to check (see Check first)'});
  return out.sort((a,b)=>ORDER.indexOf(a.st)-ORDER.indexOf(b.st)||(a.o.detail[0].date<b.o.detail[0].date?-1:1));
}
const credPtsOf=l=>l.stays.reduce((a,s)=>a+((credited[s.o.key]||{}).pts||0),0);
// saved guests = members (by PMID), not confirmation numbers
const savedGuests=()=>new Set(Object.entries(credited).map(([k,r])=>r.pmid||k)).size;
const ready=()=>lines().filter(r=>r.st==='Ready');
function progress(){const c=savedGuests();$('prog').textContent=c?'· '+c+' already credited (saved)':''}
function draw(){const all=lines(),q=$('q').value.toLowerCase().trim(),rd=all.filter(r=>r.st==='Ready');
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
  [['k3','Check first'],['k4','Credited'],['k5','No PMID']].forEach(([id,t])=>{const e=$(id);if(e)e.textContent=cnt(t)});
  const kg=$('k6');if(kg)kg.textContent=all.length;
  ['cpA','cpB','cpC'].forEach(i=>$(i).disabled=!rd.length);
  $('meta').textContent=R.entries+' sheet entries read, '+R.dups+' duplicates removed.';
  const tabs=$('tabs');tabs.innerHTML='';
  TABS.forEach(t=>{const n=t==='All'?all.length:all.filter(r=>r.st===t).length;const b=h('button','stc-tab',t);b.type='button';b.setAttribute('aria-pressed',t===tab);b.append(h('b',null,n));b.onclick=()=>{tab=t;draw()};tabs.append(b)});
  const tb=$('tb');tb.innerHTML='';
  const vis=all.filter(r=>(tab==='All'||r.st===tab)&&(!q||[r.o.name,r.o.room,r.pm,r.o.conf].join(' ').toLowerCase().includes(q)));
  if(!vis.length){const tr=h('tr'),td=h('td','stc-empty','Nothing in this list.');td.colSpan=11;tr.append(td);tb.append(tr);return}
  vis.forEach(r=>{
    const tr=h('tr','stc-r'+(r.st==='Credited'?' done':'')),c=()=>h('td'),multi=r.stays.length>1;
    const dt=h('tr','stc-det');dt.hidden=true;
    const t0=c(),cb=h('input');cb.type='checkbox';cb.checked=r.st==='Credited';cb.title=r.st==='Credited'?'Untick to undo (removes it from the saved history)':'Tick when you have entered the points. It is saved so this guest is never credited twice.';cb.setAttribute('aria-label','Credited: '+r.o.name);
    cb.disabled=!(r.st==='Credited'||r.n>0);
    cb.onclick=e=>e.stopPropagation();
    cb.onchange=()=>{
      if(cb.checked){
        if(!r.n){cb.checked=false;return}
        r.stays.forEach(s=>{if(!s.n)return;const k=s.o.key;
          const rec=credited[k]||{key:k,conf:s.o.conf||'',name:s.o.name,room:s.o.room,pmid:s.pm,dates:[],pts:0,history:[]};
          rec.dates=[...new Set([...(rec.dates||[]),...s.fresh])].sort();
          rec.pts=(rec.pts||0)+s.pt;rec.pmid=s.pm||rec.pmid;rec.name=s.o.name;rec.room=s.o.room;
          const fr=new Set(s.fresh),src=[...new Set(s.o.detail.filter(d=>fr.has(d.date)&&d.counts==='Yes').map(d=>d.sheet).filter(Boolean))];
          rec.history=[...(rec.history||[]),{at:new Date().toISOString(),by:who(),dates:s.fresh,pts:s.pt,rate:+$('pts').value||0,src}];
          credited[k]=rec;persist(k)});
        toast('Saved: '+r.o.name+' credited '+r.pt.toLocaleString()+' points'+(multi?' ('+r.stays.length+' stays)':''));
      }else{
        r.stays.forEach(s=>{const k=s.o.key,rec=credited[k];if(!rec)return;
          const last=(rec.history||[]).pop();
          if(last){rec.dates=(rec.dates||[]).filter(d=>!last.dates.includes(d));rec.pts=Math.max(0,(rec.pts||0)-(last.pts||0))}
          if(!rec.history||!rec.history.length||!rec.dates.length)delete credited[k];
          persist(k)});
        toast('Undone: '+r.o.name+' is back on the list');
      }
      histNote();draw();
    };t0.append(cb);
    const t1=c();if(r.pm){const b=h('button','stc-cp pm',r.pm);b.type='button';b.title='Click to copy PMID';b.onclick=e=>{e.stopPropagation();copy(r.pm,'PMID '+r.pm,b)};t1.append(b)}else t1.textContent='–';
    const t2=c();t2.className='stc-num';if(r.pt>0){const b=h('button','stc-cp',r.pt.toLocaleString());b.type='button';b.title='Click to copy points';b.onclick=e=>{e.stopPropagation();copy(String(r.pt),r.pt+' points',b)};t2.append(b)}
    const t3=c();t3.append(h('div','stc-name',r.o.name));
    if(multi){const m=h('button','stc-merged',r.stays.length+' stays merged');m.type='button';
      m.title='Same member, '+r.stays.length+' confirmation numbers. Points are added up so you enter them once:\n'+r.stays.map(s=>(s.o.conf||'no conf #')+' · '+(s.o.win?s.o.win[0]+' to '+s.o.win[1]:'dates unreadable')+' · '+s.n+' day'+(s.n===1?'':'s')+' · '+s.pt.toLocaleString()+' pts').join('\n');
      m.onclick=e=>{e.stopPropagation();dt.hidden=!dt.hidden};t3.append(m)}
    if(r.hint)t3.append(h('div','stc-hint2',r.hint));
    if(r.notes.length)t3.append(h('div','stc-sub',r.notes.join('. ')));
    const t4=c();t4.textContent=r.o.room;
    const t4b=c(),confs=[...new Set(r.stays.map(s=>s.o.conf).filter(Boolean))];confs.forEach((cf,i)=>{if(i)t4b.append(h('span','stc-plus','+'));const b=h('button','stc-cp sm',cf);b.type='button';b.title='Click to copy confirmation number';b.onclick=e=>{e.stopPropagation();copy(cf,'confirmation '+cf,b)};t4b.append(b)});if(!confs.length)t4b.textContent='–';
    const t4d=c();if(r.o.win){const[y,m,d]=r.o.win[1].split('-'),b=h('button','stc-cp sm',+d+' '+MON[+m-1]+' '+y);b.type='button';b.title='Click to copy check-out date as DD/MM/YYYY';b.onclick=e=>{e.stopPropagation();copy(d+'/'+m+'/'+y,'check-out '+d+'/'+m+'/'+y,b)};t4d.append(b)}else t4d.textContent='–';
    const t4c=c();t4c.className='stc-dates';t4c.textContent=r.n?fmtDates(r.o.detail.filter(d=>d.counts==='Yes').map(d=>d.date)):'–';
    const t5=c();t5.className='stc-num';t5.textContent=r.n;
    const t6=c();t6.append(h('span','stc-tag '+CLS[r.st],r.st));
    const t7=c();if(r.pm&&r.pt>0){const b=h('button','stc-mini','Copy both');b.type='button';b.title='Copy PMID and points, separated by a tab';b.onclick=e=>{e.stopPropagation();copy(r.pm+'\t'+r.pt,'PMID + points',b)};t7.append(b)}
    tr.append(t0,t1,t2,t3,t4,t4b,t4d,t4c,t5,t6,t7);
    const dd=h('td');dd.colSpan=11;
    r.stays.forEach(s=>{
      const f=h('div','stc-facts');f.append(h('span',null,'Confirmation # '+(s.o.conf||'none')),h('span',null,'Stay '+(s.o.win?s.o.win[0]+' to '+s.o.win[1]:'unreadable')+' ('+s.o.src+')'));
      if(multi)f.append(h('span',null,s.n+' day'+(s.n===1?'':'s')+' · '+s.pt.toLocaleString()+' pts'+(s.o.room!==r.stays[0].o.room?' · room '+s.o.room:'')));
      const ch=h('div','stc-chips');s.o.detail.forEach(d=>ch.append(h('span','stc-chip'+(d.counts==='Yes'?' y':''),d.date+(d.counts==='Yes'?' credited':' not counted: '+d.reason))));
      const box=h('div',multi?'stc-stay':null);box.append(f,ch);dd.append(box)});
    dt.append(dd);
    tr.onclick=()=>dt.hidden=!dt.hidden;tb.append(tr,dt)})}

function exportXlsx(){const all=lines(),wb=XLSX.utils.book_new();
  const a=[['PMID','Points','Status','Guest','Room','Confirmation #','Arrival','Departure','Credit days','Stays','ID number','ALL card (A1)','Notes','Credited dates']];
  all.forEach(r=>a.push([r.pm,r.pt,r.st,r.o.name,r.o.room,r.o.conf,r.o.win?r.o.win[0]:'',r.o.win?r.o.win[1]:'',r.n,r.stays.length,r.o.cards.ID||'',r.o.cards.A1||'',[...(r.hint?[r.hint]:[]),...r.notes].join('; '),r.o.detail.filter(d=>d.counts==='Yes').map(d=>d.date).join(', ')]));
  const s1=XLSX.utils.aoa_to_sheet(a);s1['!cols']=[12,8,14,30,7,22,11,11,9,6,20,20,60,40].map(w=>({wch:w}));XLSX.utils.book_append_sheet(wb,s1,'Credit List');
  const b=[['Confirmation #','Guest','Room','Date','Counts?','Reason','Source sheet']];all.forEach(l=>l.stays.forEach(r=>r.o.detail.forEach(d=>b.push([r.o.conf,r.o.name,r.o.room,d.date,d.counts,d.reason,d.sheet]))));
  const s2=XLSX.utils.aoa_to_sheet(b);s2['!cols']=[14,30,7,11,9,40,16].map(w=>({wch:w}));XLSX.utils.book_append_sheet(wb,s2,'Day Detail');
  XLSX.writeFile(wb,'Skip_The_Clean_Credit_List.xlsx')}

// ── Month summary (print / save as PDF) ────────────────────────────────
// Reads the same rows() the screen shows; nothing is re-calculated or saved.
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function monthOf(){
  const cnt = {};
  (R ? R.res : []).forEach(o => (o.detail || []).forEach(d => { const k = String(d.date || '').slice(0, 7); if (/^\d{4}-\d{2}$/.test(k)) cnt[k] = (cnt[k] || 0) + 1; }));
  const ks = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a] || (a < b ? -1 : 1));
  if (!ks.length) return '';
  const lab = k => MONTHS[+k.slice(5) - 1] + ' ' + k.slice(0, 4);
  const extra = ks.slice(1).sort();
  return lab(ks[0]) + (extra.length ? ' (also ' + extra.map(lab).join(', ') + ')' : '');
}
function hotelName(){
  if (typeof _meHotel === 'function') return _meHotel();
  const el = document.getElementById('hotelName'); return (el && el.textContent.trim()) || 'Hotel';
}
function summaryPdf(){
  if (!R) { toast('Add the files first'); return; }
  if (typeof mePrintPage !== 'function') { toast('The print helper did not load. Reload the page.'); return; }
  const all = lines(), cnt = t => all.filter(r => r.st === t), rd = cnt('Ready');
  const p = +$('pts').value || 0, lim = +$('lim').value || 0, card = $('sel').selectedOptions[0]?.textContent || '';
  const credPts = cnt('Credited').reduce((a, r) => a + credPtsOf(r), 0);
  const month = monthOf() || 'This month';
  const now = new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const kpi = (l, v, sub, cls) => `<div class="kpi"><small>${l}</small><b${cls ? ` class="${cls}"` : ''}>${v}</b>${sub ? `<i>${sub}</i>` : ''}</div>`;
  const stCls = { 'Ready': 'ok', 'Credited': 'ok', 'Check first': 'warn', 'No PMID': 'bad' };
  const stTxt = { 'No PMID': 'Not a member' };
  const tr = all.map((r, i) => `<tr><td class="r">${i + 1}</td><td class="nw">${esc(r.o.room || '–')}</td><td>${esc(r.o.name)}${r.stays.length > 1 ? `<br><span class="muted">${r.stays.length} stays: ${esc(r.o.conf)}</span>` : ''}</td>
    <td class="r">${r.n}</td><td class="mono nw">${esc(r.pm || '–')}</td><td class="r">${r.pt && (r.st === 'Ready' || r.st === 'Check first') ? r.pt.toLocaleString('en-GB') : (r.st === 'Credited' ? esc(credPtsOf(r).toLocaleString('en-GB')) + ' ✓' : '–')}</td>
    <td class="nw"><span class="${stCls[r.st] || ''}">${esc(stTxt[r.st] || r.st)}</span></td><td>${r.yes.length ? esc(fmtDates(r.yes)) : '–'}</td></tr>`).join('');
  const body = `
    <div class="hd"><div><div class="hotel">${esc(hotelName())}</div><h1>Skip The Clean · month summary</h1><div class="sub"><b>${esc(month)}</b> · loyalty points for guests who skipped housekeeping</div></div>
      <div class="meta">Made ${esc(now)}<br>by ${esc(who())}</div></div>
    <h2>1 · Totals</h2>
    <div class="kpis">
      ${kpi('Guests ready', rd.length, 'to credit now', 'ok')}
      ${kpi('Points to enter', rd.reduce((a, r) => a + r.pt, 0).toLocaleString('en-GB'), 'for the ready guests', 'ok')}
      ${kpi('To check', cnt('Check first').length, 'check before crediting', cnt('Check first').length ? 'warn' : '')}
      ${kpi('Already credited', cnt('Credited').length, credPts.toLocaleString('en-GB') + ' points (saved)')}
      ${kpi('Not members', cnt('No PMID').length, 'no card in Opera')}
      ${kpi('Guests on sheets', all.length, cnt('No credit days').length + ' no credit days · ' + cnt('Long stay').length + ' long stay')}
    </div>
    <h2>2 · Guests (${all.length})</h2>
    <div class="tw"><table><thead><tr><th class="r">#</th><th>Room</th><th>Guest</th><th class="r">Nights counted</th><th>PMID</th><th class="r">Points</th><th>Status</th><th>Skipped dates counted</th></tr></thead>
      <tbody>${tr || '<tr><td colspan="8" class="muted">No guests on the sheets.</td></tr>'}</tbody></table></div>
    <h2>3 · Rules used</h2>
    <div class="note"><ul>
      <li><b>${p.toLocaleString('en-GB')} points</b> for each skipped day that counts. Card used: ${esc(card)}.</li>
      <li>A day counts only when the guest asked to skip it (it is on the housekeeping sheet). Arrival and departure days never count.</li>
      <li>Every 3rd day is a mandatory clean: after 2 skipped days in a row the next one is cleaned, not credited.</li>
      <li>${lim > 0 ? `Stays over <b>${lim} nights</b> get no credit.` : 'No long-stay limit was set.'}</li>
      <li>PMID = the card number without its last character, then its last 8 characters. <b>Not a member</b>: not in the Opera Membership Stays report.</li>
      <li>Already credited days (ticked Done in the app) are never counted twice.</li>
    </ul></div>`;
  if (typeof logActivity === 'function') logActivity('stc_month_summary', month + ' · ' + rd.length + ' ready');
  mePrintPage('Skip The Clean ' + month, body, { sign: ['Prepared by', 'Checked by'], signName: who() });
}

// ── Track sheet for the manager (Excel) ────────────────────────────────
// Built from the SAVED credit history (every guest ticked Done, shared with the team), so it works
// without loading any file. One line per credit (each tick) or per guest; the period is the day it
// was credited. Options are remembered on this device.
const TK_KEY = 'ho_stc_track_v1';
const TK_COLS = [['at', 'Date credited'], ['by', 'Credited by'], ['name', 'Guest'], ['room', 'Room'], ['conf', 'Confirmation #'], ['pmid', 'PMID'], ['days', 'Days'], ['dates', 'Skipped dates'], ['pts', 'Points'], ['why', 'Why credited'], ['cost', 'Cost (AED)']];
const TK_DEF = { period: 'month', from: '', to: '', mode: 'credit', sort: 'date', cols: { at: 1, by: 1, name: 1, room: 1, conf: 1, pmid: 1, days: 1, dates: 1, pts: 1, why: 1, cost: 0 },
  summary: true, detail: true, sign: true, colours: true, title: 'Skip The Clean · track sheet', manager: '', preparedBy: '', file: 'Skip_The_Clean_Track', costPer: 0 };
function tkLoad() { try { const v = JSON.parse(localStorage.getItem(TK_KEY) || 'null'); return Object.assign({}, TK_DEF, v || {}, { cols: Object.assign({}, TK_DEF.cols, (v && v.cols) || {}) }); } catch (_) { return Object.assign({}, TK_DEF, { cols: Object.assign({}, TK_DEF.cols) }); } }
function tkSave(o) { try { localStorage.setItem(TK_KEY, JSON.stringify(o)); } catch (_) {} }
const tkDay = at => { const d = new Date(at); return isNaN(d) ? '' : d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
/** the period as [from, to] (YYYY-MM-DD, inclusive; '' = open) */
function tkRange(o, now) {
  now = now || new Date();
  const y = now.getFullYear(), m = now.getMonth(), f = (a, b) => tkDay(new Date(a, b, 1)), l = (a, b) => tkDay(new Date(a, b + 1, 0));
  if (o.period === 'month') return [f(y, m), l(y, m)];
  if (o.period === 'last') return [f(y, m - 1), l(y, m - 1)];
  if (o.period === 'custom') return [o.from || '', o.to || ''];
  return ['', ''];
}
/** the reason, in one plain sentence a manager can check against the housekeeping sheet */
function tkWhy(dates, rate, pts, src) {
  if (!dates.length) return pts ? pts.toLocaleString('en-GB') + ' points credited' : '';
  const n = dates.length;
  return 'Asked to skip housekeeping on ' + fmtDates(dates) + ' (on the housekeeping sheet' + (src && src.length ? ': ' + src.join(', ') : '') + ') → '
    + n + ' day' + (n === 1 ? '' : 's') + (rate ? ' × ' + rate.toLocaleString('en-GB') : '') + ' = ' + pts.toLocaleString('en-GB') + ' points';
}
/** credited records → the lines of the sheet + totals (pure) */
function tkData(cred, o, now) {
  const [from, to] = tkRange(o, now), per = +o.costPer || 0;
  let rows = [];
  Object.entries(cred || {}).forEach(([k, r]) => (r && Array.isArray(r.history) ? r.history : []).forEach(h => {
    const day = tkDay(h.at); if (!day || (from && day < from) || (to && day > to)) return;
    const dates = (Array.isArray(h.dates) ? h.dates : []).slice().sort();
    const pts = +h.pts || 0, rate = +h.rate || (dates.length ? Math.round(pts / dates.length) : 0), src = (Array.isArray(h.src) ? h.src : []).filter(Boolean);
    rows.push({ at: day, by: h.by || '', name: r.name || '', room: r.room || '', conf: r.conf || '', pmid: r.pmid || '', g: r.pmid || k, dates, days: dates.length, pts, rate, src,
      why: tkWhy(dates, rate, pts, src) });
  }));
  if (o.mode === 'guest') {
    const by = new Map();
    rows.forEach(x => { const g = by.get(x.g); if (!g) { by.set(x.g, Object.assign({}, x, { dates: x.dates.slice(), byL: [x.by] })); return; }
      g.dates = g.dates.concat(x.dates).sort(); g.days += x.days; g.pts += x.pts; if (x.at > g.at) g.at = x.at; g.byL.push(x.by); g.src = [...new Set(g.src.concat(x.src))];
      g.why = tkWhy(g.dates, g.rate === x.rate ? g.rate : 0, g.pts, g.src);
      [['room', x.room], ['conf', x.conf]].forEach(([f, v]) => { if (v && !String(g[f]).split(' / ').includes(v)) g[f] = g[f] ? g[f] + ' / ' + v : v; }); });
    rows = [...by.values()].map(g => Object.assign(g, { by: [...new Set(g.byL.filter(Boolean))].join(', ') }));
  }
  rows.forEach(x => { x.cost = per ? Math.round(x.pts * per * 100) / 100 : 0; });
  const rn = s => parseInt(String(s).replace(/\D/g, ''), 10) || 0;
  rows.sort(o.sort === 'room' ? (a, b) => rn(a.room) - rn(b.room) || (a.at < b.at ? -1 : 1) : o.sort === 'guest' ? (a, b) => a.name.localeCompare(b.name) || (a.at < b.at ? -1 : 1) : (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : rn(a.room) - rn(b.room)));
  const sum = f => rows.reduce((a, x) => a + (+x[f] || 0), 0);
  const staff = {}, days = {};
  rows.forEach(x => { (x.by || '—').split(', ').forEach(p => { const s = staff[p] = staff[p] || { n: 0, pts: 0 }; s.n++; s.pts += x.pts / ((x.by || '—').split(', ').length); });
    const d = days[x.at] = days[x.at] || { n: 0, pts: 0 }; d.n++; d.pts += x.pts; });
  const detail = [];
  rows.forEach(x => x.dates.forEach(d => detail.push({ day: d, name: x.name, room: x.room, conf: x.conf, pmid: x.pmid, pts: x.rate || (x.days ? Math.round(x.pts / x.days) : 0), at: x.at, by: x.by, src: (x.src || []).join(', ') })));
  detail.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : (parseInt(a.room, 10) || 0) - (parseInt(b.room, 10) || 0)));
  return { from, to, rows, detail, totals: { lines: rows.length, guests: new Set(rows.map(x => x.g)).size, days: sum('days'), pts: sum('pts'), cost: Math.round(sum('cost') * 100) / 100 },
    staff: Object.entries(staff).map(([k, v]) => ({ by: k, n: v.n, pts: Math.round(v.pts) })).sort((a, b) => b.pts - a.pts),
    byDay: Object.entries(days).map(([k, v]) => ({ day: k, n: v.n, pts: v.pts })).sort((a, b) => (a.day < b.day ? -1 : 1)) };
}
const tkCols = o => TK_COLS.filter(([k]) => o.cols[k] && (k !== 'cost' || +o.costPer > 0));
const tkFmtDay = s => { if (!s) return ''; const [y, m, d] = s.split('-'); return +d + ' ' + MON[+m - 1] + ' ' + y; };
const tkPeriod = D => D.from && D.to ? (D.from.slice(0, 7) === D.to.slice(0, 7) && D.from.endsWith('-01') && +D.to.slice(8) >= 28 ? MONTHS[+D.from.slice(5, 7) - 1] + ' ' + D.from.slice(0, 4) : tkFmtDay(D.from) + ' – ' + tkFmtDay(D.to)) : D.from ? 'From ' + tkFmtDay(D.from) : D.to ? 'Until ' + tkFmtDay(D.to) : 'All time';
const tkCell = (x, k) => k === 'at' ? tkFmtDay(x.at) : k === 'dates' ? fmtDates(x.dates) : x[k];
/** the sheet as rows of values (SheetJS / copy) */
function tkAoa(D, o, meta) {
  const C = tkCols(o), a = [[o.title || TK_DEF.title], [meta.hotel + ' · ' + tkPeriod(D)], ['Made ' + meta.made + (o.preparedBy || meta.who ? ' by ' + (o.preparedBy || meta.who) : '') + (o.manager ? ' · for ' + o.manager : '')], [],
    C.map(c => c[1])];
  D.rows.forEach(x => a.push(C.map(([k]) => tkCell(x, k))));
  a.push(C.map(([k], i) => k === 'pts' ? D.totals.pts : k === 'days' ? D.totals.days : k === 'cost' ? D.totals.cost : i === 0 ? 'Total (' + D.totals.guests + ' guest' + (D.totals.guests === 1 ? '' : 's') + ')' : ''));
  if (o.sign) a.push([], ['Prepared by', o.preparedBy || meta.who || '', '', 'Signature', ''], ['Checked / approved by', o.manager || '', '', 'Signature', '']);
  return a;
}
let _tkEj = null;
function tkExcelJS() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  if (_tkEj) return _tkEj;
  _tkEj = new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js'; s.async = true;
    const t = setTimeout(() => no(new Error('timed out')), 15000);
    s.onload = () => { clearTimeout(t); window.ExcelJS ? ok(window.ExcelJS) : no(new Error('not loaded')); }; s.onerror = () => { clearTimeout(t); no(new Error('could not load')); };
    document.head.appendChild(s); }).catch(e => { _tkEj = null; throw e; });
  return _tkEj;
}
async function tkStyled(EJ, D, o, meta) {
  const wb = new EJ.Workbook(), C = tkCols(o), TEAL = 'FF0F766E', LIGHT = 'FFF0FDFA', LINE = 'FFD1D5DB';
  wb.creator = o.preparedBy || meta.who || ''; wb.created = new Date();
  const ws = wb.addWorksheet('Track sheet', { views: [{ state: 'frozen', ySplit: 5 }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const W = { at: 13, by: 18, name: 30, room: 8, conf: 16, pmid: 13, days: 7, dates: 30, pts: 10, why: 60, cost: 12 };
  ws.columns = C.map(([k]) => ({ key: k, width: W[k] || 14 }));
  const last = Math.max(1, C.length);
  const title = (r, v, sz, bold, col) => { ws.mergeCells(r, 1, r, last); const c = ws.getCell(r, 1); c.value = v; c.font = { size: sz, bold, color: { argb: col || 'FF111827' } }; };
  title(1, o.title || TK_DEF.title, 15, true, TEAL);
  title(2, meta.hotel + ' · ' + tkPeriod(D), 11, true);
  title(3, 'Made ' + meta.made + (o.preparedBy || meta.who ? ' by ' + (o.preparedBy || meta.who) : '') + (o.manager ? ' · for ' + o.manager : ''), 9, false, 'FF6B7280');
  const hr = ws.getRow(5); C.forEach(([, l], i) => { const c = hr.getCell(i + 1); c.value = l; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } }; c.alignment = { vertical: 'middle', horizontal: ['days', 'pts', 'cost'].includes(C[i][0]) ? 'right' : 'left' }; });
  hr.height = 20;
  D.rows.forEach((x, n) => { const r = ws.getRow(6 + n); C.forEach(([k], i) => { const c = r.getCell(i + 1); c.value = tkCell(x, k);
      if (n % 2) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } };
      c.border = { bottom: { style: 'hair', color: { argb: LINE } } };
      if (k === 'pts' || k === 'days') c.numFmt = '#,##0'; if (k === 'cost') c.numFmt = '#,##0.00'; if (k === 'pmid' || k === 'conf') c.font = { name: 'Consolas' };
      if (k === 'dates' || k === 'name' || k === 'why') c.alignment = { wrapText: true, vertical: 'top' }; }); });
  const tr = ws.getRow(6 + D.rows.length);
  C.forEach(([k], i) => { const c = tr.getCell(i + 1); c.value = k === 'pts' ? D.totals.pts : k === 'days' ? D.totals.days : k === 'cost' ? D.totals.cost : i === 0 ? 'Total · ' + D.totals.guests + ' guest' + (D.totals.guests === 1 ? '' : 's') : null;
    c.font = { bold: true }; c.border = { top: { style: 'medium', color: { argb: TEAL } } }; if (k === 'pts' || k === 'days') c.numFmt = '#,##0'; if (k === 'cost') c.numFmt = '#,##0.00'; });
  if (D.rows.length) ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5 + D.rows.length, column: last } };
  if (o.sign) { const s = 8 + D.rows.length;
    [['Prepared by', o.preparedBy || meta.who || ''], ['Checked / approved by', o.manager || '']].forEach(([l, v], i) => { const r = ws.getRow(s + i * 2);
      r.getCell(1).value = l; r.getCell(1).font = { bold: true }; r.getCell(2).value = v; r.getCell(Math.min(last, 4)).value = 'Signature: ____________________'; r.getCell(Math.min(last, 4)).font = { color: { argb: 'FF6B7280' } }; }); }
  if (o.summary) {
    const S = wb.addWorksheet('Summary'); S.columns = [{ width: 26 }, { width: 14 }, { width: 14 }];
    S.getCell('A1').value = 'Summary · ' + tkPeriod(D); S.getCell('A1').font = { size: 14, bold: true, color: { argb: TEAL } };
    const kv = [['Guests credited', D.totals.guests], ['Credits (ticks)', D.rows.length && o.mode === 'guest' ? null : D.totals.lines], ['Skipped days credited', D.totals.days], ['Points credited', D.totals.pts]].filter(x => x[1] != null);
    if (+o.costPer > 0) kv.push(['Cost (AED)', D.totals.cost]);
    kv.forEach(([l, v], i) => { const r = S.getRow(3 + i); r.getCell(1).value = l; r.getCell(2).value = v; r.getCell(2).numFmt = l.startsWith('Cost') ? '#,##0.00' : '#,##0'; r.getCell(2).font = { bold: true }; });
    const tbl = (row, head, list) => { const h = S.getRow(row); head.forEach((t, i) => { const c = h.getCell(i + 1); c.value = t; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } }; });
      list.forEach((v, n) => v.forEach((x, i) => { const c = S.getRow(row + 1 + n).getCell(i + 1); c.value = x; if (i) c.numFmt = '#,##0'; })); return row + list.length + 2; };
    let r = 4 + kv.length;
    r = tbl(r, ['Credited by', 'Lines', 'Points'], D.staff.map(s => [s.by, s.n, s.pts]));
    tbl(r, ['Day credited', 'Lines', 'Points'], D.byDay.map(d => [tkFmtDay(d.day), d.n, d.pts]));
  }
  if (o.detail && D.detail.length) {
    const V = wb.addWorksheet('Day by day', { views: [{ state: 'frozen', ySplit: 1 }] });
    const H = [['Skipped day', 14], ['Guest', 30], ['Room', 8], ['Confirmation #', 16], ['PMID', 13], ['Points', 9], ['Housekeeping sheet', 30], ['Credited on', 13], ['Credited by', 18]];
    V.columns = H.map(([, w]) => ({ width: w }));
    H.forEach(([t], i) => { const c = V.getRow(1).getCell(i + 1); c.value = t; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } }; });
    D.detail.forEach((x, n) => { const r = V.getRow(2 + n); [tkFmtDay(x.day), x.name, x.room, x.conf, x.pmid, x.pts, x.src, tkFmtDay(x.at), x.by].forEach((v, i) => { const c = r.getCell(i + 1); c.value = v; if (n % 2) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } }; if (i === 5) c.numFmt = '#,##0'; }); });
    V.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1 + D.detail.length, column: H.length } };
  }
  return wb.xlsx.writeBuffer();
}
function tkPlain(D, o, meta) {
  const wb = XLSX.utils.book_new(), C = tkCols(o), s = XLSX.utils.aoa_to_sheet(tkAoa(D, o, meta));
  const W = { at: 13, by: 18, name: 30, room: 8, conf: 16, pmid: 13, days: 7, dates: 30, pts: 10, why: 60, cost: 12 }; s['!cols'] = C.map(([k]) => ({ wch: W[k] || 14 }));
  XLSX.utils.book_append_sheet(wb, s, 'Track sheet');
  if (o.summary) { const a = [['Summary · ' + tkPeriod(D)], [], ['Guests credited', D.totals.guests], ['Skipped days credited', D.totals.days], ['Points credited', D.totals.pts]];
    if (+o.costPer > 0) a.push(['Cost (AED)', D.totals.cost]);
    a.push([], ['Credited by', 'Lines', 'Points'], ...D.staff.map(x => [x.by, x.n, x.pts]), [], ['Day credited', 'Lines', 'Points'], ...D.byDay.map(x => [tkFmtDay(x.day), x.n, x.pts]));
    const S = XLSX.utils.aoa_to_sheet(a); S['!cols'] = [{ wch: 26 }, { wch: 12 }, { wch: 12 }]; XLSX.utils.book_append_sheet(wb, S, 'Summary'); }
  if (o.detail && D.detail.length) { const V = XLSX.utils.aoa_to_sheet([['Skipped day', 'Guest', 'Room', 'Confirmation #', 'PMID', 'Points', 'Housekeeping sheet', 'Credited on', 'Credited by'], ...D.detail.map(x => [tkFmtDay(x.day), x.name, x.room, x.conf, x.pmid, x.pts, x.src, tkFmtDay(x.at), x.by])]);
    V['!cols'] = [14, 30, 8, 16, 13, 9, 30, 13, 18].map(w => ({ wch: w })); XLSX.utils.book_append_sheet(wb, V, 'Day by day'); }
  return wb;
}
const tkMeta = () => ({ hotel: hotelName(), who: who(), made: new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) });
const tkFile = (o, D) => (String(o.file || TK_DEF.file).replace(/[\\/:*?"<>|]+/g, '_').trim() || TK_DEF.file) + '_' + tkPeriod(D).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') + '.xlsx';
async function tkDownload(o) {
  const D = tkData(credited, o), meta = tkMeta();
  if (!D.rows.length) { toast('Nothing credited in this period'); return false; }
  const name = tkFile(o, D);
  if (o.colours) {
    try { const EJ = await tkExcelJS(), buf = await tkStyled(EJ, D, o, meta);
      const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })), a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
      tkDone(D, name); return true;
    } catch (e) { toast('Colours could not load: a plain Excel instead'); }
  }
  if (typeof XLSX === 'undefined') { toast('The Excel library did not load. Reload the page.'); return false; }
  XLSX.writeFile(tkPlain(D, o, meta), name); tkDone(D, name); return true;
}
function tkDone(D, name) { toast('✓ ' + name + ' · ' + D.totals.guests + ' guests · ' + D.totals.pts.toLocaleString('en-GB') + ' points'); if (typeof logActivity === 'function') logActivity('stc_track_sheet', tkPeriod(D) + ' · ' + D.totals.guests + ' guests · ' + D.totals.pts + ' pts'); }
function tkEmail(o) {
  const D = tkData(credited, o), m = tkMeta();
  return [(o.manager ? 'Hi ' + o.manager + ',' : 'Hi,'), '', 'Skip The Clean points credited for ' + tkPeriod(D) + ' (' + m.hotel + '):', '',
    '• Guests credited: ' + D.totals.guests, '• Skipped days credited: ' + D.totals.days, '• Points credited: ' + D.totals.pts.toLocaleString('en-GB') + (+o.costPer > 0 ? ' (AED ' + D.totals.cost.toLocaleString('en-GB', { minimumFractionDigits: 2 }) + ')' : ''),
    '', 'The track sheet is attached.', '', 'Thank you,', o.preparedBy || m.who].join('\n');
}
/** the same track sheet as a page to print / save as PDF (landscape, sign-off at the end) */
function tkPdf(o) {
  const D = tkData(credited, o), m = tkMeta(), C = tkCols(o), t = D.totals;
  if (!t.lines) { toast('Nothing credited in this period'); return false; }
  if (typeof mePrintPage !== 'function') { toast('The print helper did not load. Reload the page.'); return false; }
  const num = { days: 1, pts: 1, cost: 1 }, nf = (k, v) => k === 'cost' ? (+v || 0).toLocaleString('en-GB', { minimumFractionDigits: 2 }) : (+v || 0).toLocaleString('en-GB');
  const kpi = (l, v, sub) => `<div class="kpi"><small>${l}</small><b>${v}</b>${sub ? `<i>${sub}</i>` : ''}</div>`;
  const head = `<tr><th class="r">#</th>${C.map(([k, l]) => `<th${num[k] ? ' class="r"' : ''}>${esc(l)}</th>`).join('')}</tr>`;
  const body = D.rows.map((x, i) => `<tr><td class="r">${i + 1}</td>${C.map(([k]) => `<td class="${num[k] ? 'r' : k === 'pmid' || k === 'conf' ? 'mono nw' : k === 'at' || k === 'room' ? 'nw' : ''}">${num[k] ? nf(k, x[k]) : esc(tkCell(x, k) || '–')}</td>`).join('')}</tr>`).join('');
  const tot = `<tr class="tot"><td></td>${C.map(([k], i) => `<td class="${num[k] ? 'r' : ''}">${num[k] ? nf(k, t[k]) : i === 0 ? 'Total · ' + t.guests + ' guest' + (t.guests === 1 ? '' : 's') : ''}</td>`).join('')}</tr>`;
  const sumHtml = o.summary ? `<h2>Summary</h2><div class="kpis">${kpi('Guests credited', t.guests)}${kpi('Skipped days', t.days)}${kpi('Points credited', t.pts.toLocaleString('en-GB'))}${+o.costPer > 0 ? kpi('Cost', 'AED ' + nf('cost', t.cost), (+o.costPer) + ' per point') : ''}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px">
      <table><thead><tr><th>Credited by</th><th class="r">Lines</th><th class="r">Points</th></tr></thead><tbody>${D.staff.map(x => `<tr><td>${esc(x.by)}</td><td class="r">${x.n}</td><td class="r">${nf('pts', x.pts)}</td></tr>`).join('')}</tbody></table>
      <table><thead><tr><th>Day credited</th><th class="r">Lines</th><th class="r">Points</th></tr></thead><tbody>${D.byDay.map(x => `<tr><td class="nw">${esc(tkFmtDay(x.day))}</td><td class="r">${x.n}</td><td class="r">${nf('pts', x.pts)}</td></tr>`).join('')}</tbody></table></div>` : '';
  const detHtml = o.detail && D.detail.length ? `<h2 style="break-before:page">Day by day (${D.detail.length} skipped day${D.detail.length === 1 ? '' : 's'})</h2><div class="tw"><table><thead><tr><th>Skipped day</th><th>Guest</th><th>Room</th><th>Confirmation #</th><th>PMID</th><th class="r">Points</th><th>Housekeeping sheet</th><th>Credited</th></tr></thead><tbody>
    ${D.detail.map(x => `<tr><td class="nw">${esc(tkFmtDay(x.day))}</td><td>${esc(x.name)}</td><td class="nw">${esc(x.room)}</td><td class="mono nw">${esc(x.conf)}</td><td class="mono nw">${esc(x.pmid)}</td><td class="r">${nf('pts', x.pts)}</td><td>${esc(x.src || '–')}</td><td class="nw">${esc(tkFmtDay(x.at))}${x.by ? ' · ' + esc(x.by) : ''}</td></tr>`).join('')}</tbody></table></div>` : '';
  const html = `<div class="hd"><div><div class="hotel">${esc(m.hotel)}</div><h1>${esc(o.title || TK_DEF.title)}</h1><div class="sub"><b>${esc(tkPeriod(D))}</b> · loyalty points credited to guests who skipped housekeeping${o.manager ? ' · for ' + esc(o.manager) : ''}</div></div>
      <div class="meta">Made ${esc(m.made)}<br>by ${esc(o.preparedBy || m.who)}</div></div>
    ${sumHtml}<h2>Guests credited (${t.lines} line${t.lines === 1 ? '' : 's'})</h2><div class="tw"><table><thead>${head}</thead><tbody>${body}${tot}</tbody></table></div>
    <div class="note">Each line is a guest ticked as credited in the app. A day counts only when the guest asked to skip housekeeping (on the housekeeping sheet); arrival and departure days never count, every 3rd day is a mandatory clean, and a day is never credited twice.</div>
    ${detHtml}`;
  mePrintPage((o.title || TK_DEF.title) + ' · ' + tkPeriod(D), html, { landscape: true, sign: o.sign ? ['Prepared by', 'Checked / approved by'] : [], signName: o.preparedBy || m.who });
  if (typeof logActivity === 'function') logActivity('stc_track_pdf', tkPeriod(D) + ' · ' + t.guests + ' guests · ' + t.pts + ' pts');
  return true;
}
/** the export window */
function tkOpen() {
  let o = tkLoad(); document.getElementById('stc-tk')?.remove();
  const w = document.createElement('div'); w.id = 'stc-tk'; w.className = 'stc-tk'; w.setAttribute('role', 'dialog'); w.setAttribute('aria-modal', 'true'); w.setAttribute('aria-label', 'Track sheet');
  const seg = (name, list) => `<div class="stc-tk-seg" data-k="${name}">${list.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${o[name] === v}">${l}</button>`).join('')}</div>`;
  const chk = (k, l, on, sub) => `<label class="stc-tk-chk"><input type="checkbox" data-o="${k}"${on ? ' checked' : ''}><span><b>${l}</b>${sub ? `<i>${sub}</i>` : ''}</span></label>`;
  w.innerHTML = `<div class="stc-tk-box"><div class="stc-tk-hd"><div><b>📊 Track sheet for your manager</b><small>Every guest you ticked as credited, and why · Excel or PDF</small></div><button type="button" class="stc-tk-x" data-a="close" aria-label="Close">✕</button></div>
    <div class="stc-tk-body">
      <section><h4>Period <small>(the day it was credited)</small></h4>${seg('period', [['month', 'This month'], ['last', 'Last month'], ['all', 'All time'], ['custom', 'Custom']])}
        <div class="stc-tk-dates"${o.period === 'custom' ? '' : ' hidden'}><label for="stc-tk-from">From</label><input type="date" id="stc-tk-from" data-f="from" value="${esc(o.from)}"><label for="stc-tk-to">To</label><input type="date" id="stc-tk-to" data-f="to" value="${esc(o.to)}"></div></section>
      <section><h4>Lines</h4>${seg('mode', [['credit', 'One per credit'], ['guest', 'One per guest']])}<h4 style="margin-top:12px">Sort by</h4>${seg('sort', [['date', 'Date'], ['room', 'Room'], ['guest', 'Guest']])}</section>
      <section><h4>Columns</h4><div class="stc-tk-cols">${TK_COLS.map(([k, l]) => `<label class="stc-tk-chip"><input type="checkbox" data-c="${k}"${o.cols[k] ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div></section>
      <section><h4>Extras</h4>${chk('summary', 'Summary sheet', o.summary, 'totals, by staff and by day')}${chk('detail', 'Day-by-day sheet', o.detail, 'every skipped day credited, with its housekeeping sheet: easy to check')}${chk('sign', 'Sign-off lines', o.sign, 'prepared by · approved by')}${chk('colours', 'Colours and filters', o.colours, 'styled header, stripes, totals row')}</section>
      <section><h4>Settings <small>(remembered on this device)</small></h4><div class="stc-tk-grid">
        <label for="stc-tk-title">Report title</label><input id="stc-tk-title" data-f="title" value="${esc(o.title)}">
        <label for="stc-tk-man">Manager's name</label><input id="stc-tk-man" data-f="manager" value="${esc(o.manager)}" placeholder="e.g. the Front Office Manager">
        <label for="stc-tk-prep">Prepared by</label><input id="stc-tk-prep" data-f="preparedBy" value="${esc(o.preparedBy)}" placeholder="${esc(who())}">
        <label for="stc-tk-file">File name</label><input id="stc-tk-file" data-f="file" value="${esc(o.file)}">
        <label for="stc-tk-cost">Cost per point (AED)</label><input id="stc-tk-cost" data-f="costPer" type="number" min="0" step="0.001" value="${+o.costPer || ''}" placeholder="optional: adds a Cost column"></div></section>
    </div>
    <div class="stc-tk-ft"><div class="stc-tk-pv" id="stc-tk-pv" aria-live="polite"></div><div class="stc-tk-btns"><button type="button" class="btn" data-a="email">📋 Email text</button><button type="button" class="btn" data-a="pdf">🖨 PDF</button><button type="button" class="btn gold" data-a="go">⬇ Excel</button></div></div></div>`;
  document.body.appendChild(w);
  const pv = () => { const D = tkData(credited, o), t = D.totals;
    w.querySelector('#stc-tk-pv').innerHTML = t.lines ? `<b>${tkPeriod(D)}</b> · ${t.guests} guest${t.guests === 1 ? '' : 's'} · ${t.days} day${t.days === 1 ? '' : 's'} · <b>${t.pts.toLocaleString('en-GB')} points</b>${+o.costPer > 0 ? ' · AED ' + t.cost.toLocaleString('en-GB', { minimumFractionDigits: 2 }) : ''}` : `<span class="muted">Nothing credited in ${tkPeriod(D)}</span>`;
    w.querySelectorAll('[data-a="go"],[data-a="pdf"]').forEach(x => { x.disabled = !t.lines; }); };
  const set = (k, v) => { o[k] = v; tkSave(o); pv(); };
  w.addEventListener('click', e => {
    if (e.target === w) { w.remove(); return; }
    const b = e.target.closest('button'); if (!b) return;
    const sg = b.closest('.stc-tk-seg');
    if (sg) { sg.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b)); set(sg.dataset.k, b.dataset.v); if (sg.dataset.k === 'period') w.querySelector('.stc-tk-dates').hidden = b.dataset.v !== 'custom'; return; }
    if (b.dataset.a === 'close') w.remove();
    else if (b.dataset.a === 'email') copy(tkEmail(o), 'email text', b);
    else if (b.dataset.a === 'pdf') tkPdf(o);
    else if (b.dataset.a === 'go') { b.disabled = true; tkDownload(o).then(ok => { b.disabled = false; if (ok) w.remove(); }); }
  });
  w.addEventListener('input', e => { const t = e.target;
    if (t.dataset.f === 'costPer') { const v = +t.value || 0; if (v > 0 && !o.cols.cost) { o.cols = Object.assign({}, o.cols, { cost: 1 }); const c = w.querySelector('[data-c="cost"]'); if (c) c.checked = true; } set('costPer', v); }   // a cost per point turns the Cost column on
    else if (t.dataset.f) set(t.dataset.f, t.value);
    else if (t.dataset.c) { o.cols = Object.assign({}, o.cols, { [t.dataset.c]: t.checked ? 1 : 0 }); if (!tkCols(o).length) { t.checked = true; o.cols[t.dataset.c] = 1; toast('Keep at least one column'); } tkSave(o); pv(); }
    else if (t.dataset.o) set(t.dataset.o, t.checked); });
  w.addEventListener('keydown', e => { if (e.key === 'Escape') w.remove(); });
  pv(); setTimeout(() => w.querySelector('.stc-tk-seg button[aria-pressed="true"]')?.focus(), 30);
}
window.hoStcTrack = { _load: v => loadSaved(v), tkWhy, tkData, tkRange, tkAoa, tkCols, tkPeriod, tkFile, TK_DEF };

function clearAll(){X=[];T=[];R=null;tab='Ready';$('err').textContent='';list();$('out').hidden=true;badge('—')}

// ───────────────────────── mounting into the app ─────────────────────────
const CSS = `
.stc-tk{position:fixed;inset:0;z-index:10050;background:rgba(5,8,14,.55);backdrop-filter:blur(3px);display:grid;place-items:center;padding:16px;animation:stcTkIn .16s ease}
@keyframes stcTkIn{from{opacity:0}to{opacity:1}}
.stc-tk-box{width:min(680px,100%);max-height:min(92vh,860px);display:flex;flex-direction:column;background:var(--card);color:var(--text);border:1px solid var(--border2);border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,.45);overflow:hidden;animation:stcTkUp .2s cubic-bezier(.2,.8,.2,1)}
@keyframes stcTkUp{from{transform:translateY(10px) scale(.985);opacity:0}to{transform:none;opacity:1}}
.stc-tk-hd{display:flex;align-items:flex-start;gap:12px;padding:16px 18px;border-bottom:1px solid var(--border);background:linear-gradient(135deg,rgba(45,212,191,.12),rgba(129,140,248,.10))}
.stc-tk-hd b{display:block;font-size:1.05rem}.stc-tk-hd small{color:var(--text2);font-size:.8rem}
.stc-tk-x{margin-left:auto;border:0;background:transparent;color:var(--text2);font-size:18px;cursor:pointer;border-radius:8px;width:32px;height:32px}.stc-tk-x:hover{background:var(--border)}
.stc-tk-body{overflow:auto;padding:6px 18px 12px}
.stc-tk-body section{padding:12px 0;border-bottom:1px dashed var(--border)}.stc-tk-body section:last-child{border-bottom:0}
.stc-tk-body h4{margin:0 0 8px;font-size:.78rem;letter-spacing:.05em;text-transform:uppercase;color:var(--text2)}.stc-tk-body h4 small{text-transform:none;letter-spacing:0;font-weight:500;color:var(--text3)}
.stc-tk-seg{display:inline-flex;flex-wrap:wrap;gap:4px;padding:4px;border-radius:12px;background:var(--bg2);border:1px solid var(--border)}
.stc-tk-seg button{border:0;background:transparent;color:var(--text2);font:600 13px var(--font);padding:7px 12px;border-radius:9px;cursor:pointer}
.stc-tk-seg button[aria-pressed="true"]{background:var(--card);color:var(--text);box-shadow:0 1px 4px rgba(0,0,0,.18);outline:1px solid var(--border2)}
.stc-tk-dates[hidden]{display:none}
.stc-tk-dates{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:10px}.stc-tk-dates input{width:auto}
.stc-tk-cols{display:flex;flex-wrap:wrap;gap:6px}
.stc-tk-chip{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid var(--border2);border-radius:999px;font-size:.82rem;cursor:pointer;user-select:none}
.stc-tk-chip:has(input:checked){border-color:#2dd4bf;background:rgba(45,212,191,.12)}
.stc-tk-chk{display:flex;gap:10px;align-items:flex-start;padding:6px 0;cursor:pointer}.stc-tk-chk span{display:flex;flex-direction:column}.stc-tk-chk i{font-style:normal;color:var(--text3);font-size:.78rem}
.stc-tk-grid{display:grid;grid-template-columns:minmax(120px,170px) 1fr;gap:8px 12px;align-items:center}
.stc-tk-grid input{width:100%;box-sizing:border-box}
.stc-tk-ft{display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:12px 18px;border-top:1px solid var(--border);background:var(--bg2)}
.stc-tk-pv{flex:1 1 220px;font-size:.84rem;color:var(--text2)}.stc-tk-pv b{color:var(--text)}.stc-tk-pv .muted{color:var(--text3)}
.stc-tk-btns{display:flex;gap:8px;margin-left:auto}
@media (max-width:560px){.stc-tk{padding:0;place-items:end stretch}.stc-tk-box{border-radius:18px 18px 0 0;max-height:94vh}.stc-tk-grid{grid-template-columns:1fr}.stc-tk-btns{width:100%}.stc-tk-btns .btn{flex:1}}

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
#panel-skip-clean .stc-merged{display:inline-block;margin:3px 0 1px;font:600 .68rem/1.2 inherit;padding:2px 8px;border-radius:999px;border:1px solid var(--stc-acc);background:var(--stc-accbg);color:var(--stc-acc);cursor:pointer}
#panel-skip-clean .stc-hint2{font-size:.72rem;color:var(--stc-warn);font-weight:600;margin-top:2px}
#panel-skip-clean .stc-plus{margin:0 3px;color:var(--text3)}
#panel-skip-clean .stc-stay+.stc-stay{margin-top:8px;padding-top:8px;border-top:1px dashed var(--stc-line)}
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
#stc-toast.show{opacity:1;transform:translate(-50%,0)}
/* ── v280 look ── */
#panel-skip-clean .stc-hero{position:relative;overflow:hidden;border-radius:18px;padding:22px 24px;margin-bottom:16px;background:radial-gradient(120% 140% at 0% 0%,rgba(45,212,191,.22),transparent 55%),radial-gradient(120% 140% at 100% 0%,rgba(129,140,248,.22),transparent 55%),var(--card);border:1px solid var(--stc-line);display:flex;gap:18px;align-items:center;flex-wrap:wrap}
#panel-skip-clean .stc-hero-ic{width:62px;height:62px;border-radius:18px;display:grid;place-items:center;font-size:32px;background:linear-gradient(135deg,#2dd4bf,#818cf8);box-shadow:0 10px 28px rgba(45,212,191,.35);flex:none;animation:stcFloat 4s ease-in-out infinite}
@keyframes stcFloat{50%{transform:translateY(-4px) rotate(-4deg)}}
#panel-skip-clean .stc-hero h1{margin:0;font-size:1.6rem;letter-spacing:-.01em}
#panel-skip-clean .stc-hero p{margin:4px 0 0;color:var(--text2);font-size:.86rem;max-width:720px;line-height:1.5}
#panel-skip-clean .stc-hero .stc-hero-act{margin-left:auto;display:flex;gap:8px}
#panel-skip-clean .stc-steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:14px}
@media(max-width:980px){#panel-skip-clean .stc-steps{grid-template-columns:1fr}}
#panel-skip-clean .stc-step{position:relative;background:var(--card);border:1px solid var(--stc-line);border-radius:16px;padding:16px 16px 14px;display:flex;flex-direction:column;gap:10px;transition:border-color .2s,box-shadow .2s}
#panel-skip-clean .stc-step.done{border-color:var(--stc-ok);box-shadow:0 0 0 1px var(--stc-ok),0 10px 26px var(--stc-okbg)}
#panel-skip-clean .stc-step.ready{border-color:var(--stc-acc);box-shadow:0 0 0 1px var(--stc-acc),0 10px 26px var(--stc-accbg)}
#panel-skip-clean .stc-step-hd{display:flex;align-items:center;gap:10px}
#panel-skip-clean .stc-step-n{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;font-weight:800;background:var(--stc-accbg);color:var(--stc-acc);flex:none}
#panel-skip-clean .stc-step.done .stc-step-n{background:var(--stc-ok);color:#06281c}
#panel-skip-clean .stc-step.done .stc-step-n::before{content:'✓'}
#panel-skip-clean .stc-step.done .stc-step-n span{display:none}
#panel-skip-clean .stc-step-t{font-weight:750;font-size:.95rem}
#panel-skip-clean .stc-step-t small{display:block;font-weight:500;color:var(--text3);font-size:.72rem}
#panel-skip-clean .stc-step ol{margin:0;padding-left:18px;font-size:.8rem;color:var(--text2);line-height:1.6}
#panel-skip-clean .stc-step ol b{color:var(--text)}
#panel-skip-clean .stc-step code{font-size:.74rem;padding:1px 6px;border-radius:5px;background:var(--bg2,rgba(127,127,127,.12));color:var(--text)}
#panel-skip-clean .stc-step .stc-drop{min-height:86px;border-radius:12px;padding:12px;align-items:center;justify-content:center;text-align:center;background:var(--bg2,transparent)}
#panel-skip-clean .stc-step .stc-drop b{font-size:.86rem}
#panel-skip-clean .stc-step .stc-drop ul{display:flex;flex-wrap:wrap;gap:4px;justify-content:center}
#panel-skip-clean .stc-step .stc-drop li{background:var(--stc-okbg);border-radius:999px;padding:2px 10px;font-size:.72rem}
#panel-skip-clean .stc-step .stc-drop li::before{content:'📄 '}
#panel-skip-clean .stc-mock{border:1px solid var(--stc-line);border-radius:10px;padding:8px 10px;font-size:.74rem;background:var(--bg2,transparent);display:grid;gap:3px}
#panel-skip-clean .stc-mock i{font-style:normal;color:var(--text3)}
#panel-skip-clean .stc-mock .on{color:var(--stc-acc);font-weight:700}
#panel-skip-clean .stc-kpis{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin:16px 0 12px}
@media(max-width:980px){#panel-skip-clean .stc-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:520px){#panel-skip-clean .stc-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
#panel-skip-clean .stc-kpi{border-radius:14px;padding:12px 14px;background:var(--card);border:1px solid var(--stc-line);position:relative;overflow:hidden}
#panel-skip-clean .stc-kpi::after{content:'';position:absolute;inset:auto 0 0 0;height:3px;background:var(--k,var(--stc-acc))}
#panel-skip-clean .stc-kpi small{display:block;font-size:.66rem;text-transform:uppercase;letter-spacing:.07em;color:var(--text3);font-weight:700}
#panel-skip-clean .stc-kpi strong{display:block;font-size:1.7rem;font-variant-numeric:tabular-nums;margin-top:2px;color:var(--k,var(--text))}
#panel-skip-clean .stc-kpi.big{background:linear-gradient(135deg,var(--stc-okbg),transparent),var(--card)}
#panel-skip-clean .stc-rules{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:14px;margin-top:16px}
@media(max-width:860px){#panel-skip-clean .stc-rules{grid-template-columns:1fr}}
#panel-skip-clean .stc-rules ul{margin:6px 0 0;padding-left:18px;font-size:.8rem;color:var(--text2);line-height:1.65}
#panel-skip-clean .stc-rules ul b{color:var(--text)}
#panel-skip-clean .stc-tl{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px;margin-top:8px}
#panel-skip-clean .stc-tl div{border-radius:10px;padding:8px 4px;text-align:center;font-size:.68rem;line-height:1.35;background:var(--stc-idlebg);color:var(--text2)}
#panel-skip-clean .stc-tl div b{display:block;font-size:.78rem;color:var(--text)}
#panel-skip-clean .stc-tl div.y{background:var(--stc-okbg);color:var(--stc-ok)}
#panel-skip-clean .stc-tl div.m{background:var(--stc-warnbg);color:var(--stc-warn)}
#panel-skip-clean .stc-sec-t{font-weight:750;font-size:.9rem;display:flex;align-items:center;gap:8px}
#panel-skip-clean .stc-sum{display:none}
`;

const PANEL_HTML = `
<div class="stc-wrapper">
  <div class="stc-hero">
    <div class="stc-hero-ic">🧹</div>
    <div>
      <h1>Skip The Clean</h1>
      <p>Guests who skip housekeeping earn ALL points. Give it the housekeeping sheets and the Opera Membership Stays report: it finds each member, works out which days count, and gives you the PMID and points to enter. Your files stay in this browser; only what you tick as credited is saved for the team.</p>
    </div>
    <div class="stc-hero-act"><button class="btn gold" type="button" id="stc-track" title="Excel of every guest credited, for your manager">📊 Track sheet</button><button class="btn rose" type="button" id="stc-clear">✕ Start over</button></div>
  </div>

  <section class="stc-steps">
    <div class="stc-step" id="stc-st1">
      <div class="stc-step-hd"><div class="stc-step-n"><span>1</span></div><div class="stc-step-t">Housekeeping sheets<small>from the daily "SKIP THE CLEAN" email</small></div></div>
      <ol>
        <li>Housekeeping sends <b>SKIP THE CLEAN</b> every day, with the Excel file attached (e.g. <code>SKIP THE CLEAN OCT-2026.xlsx</code>).</li>
        <li>Save the attachments of the month (one file, or several: the app removes duplicate days).</li>
        <li>Drop them here.</li>
      </ol>
      <div class="stc-card stc-drop" id="stc-d1" tabindex="0" role="button"><b>📥 Drop the Excel files</b><span>.xlsx · several at once is fine · or tap to choose</span><ul id="stc-l1"></ul><input id="stc-f1" type="file" accept=".xlsx,.xls" multiple hidden></div>
    </div>
    <div class="stc-step" id="stc-st2">
      <div class="stc-step-hd"><div class="stc-step-n"><span>2</span></div><div class="stc-step-t">Opera: Membership Stays<small>who is a member, and their card number</small></div></div>
      <ol>
        <li>Opera → <b>Reports</b> → <b>Manage Reports</b> → search <b>Membership Stays</b> (internal name <code>loyalty_member_stay</code>, group Reservation).</li>
        <li><b>Edit Report Parameters</b>: From / To date covering the stays on the sheets (e.g. the 1st of the month to today); keep all 5 statuses ticked: Arrivals, Checked In, In House, Departures, Checked Out.</li>
        <li><b>Download As…</b> → File Format <b>Delimited Data</b> → Delimiter <b>Tab</b> → Download, then drop the .txt here.</li>
      </ol>
      <div class="stc-mock"><i>Download As…</i><span>○ HTML ○ RTF ○ XML ○ Delimited</span><span class="on">◉ Delimited Data · Delimiter: Tab</span></div>
      <div class="stc-card stc-drop" id="stc-d2" tabindex="0" role="button"><b>📥 Drop the Opera .txt</b><span>Delimited Data (Tab) · or tap to choose</span><ul id="stc-l2"></ul><input id="stc-f2" type="file" accept=".txt,.csv,.tsv" multiple hidden></div>
    </div>
    <div class="stc-step" id="stc-st3">
      <div class="stc-step-hd"><div class="stc-step-n"><span>3</span></div><div class="stc-step-t">Credit the points<small>in the ALL loyalty portal</small></div></div>
      <ol>
        <li>The list below shows who is <b>Ready</b>: their <b>PMID</b> and the <b>points</b>.</li>
        <li>Tap a PMID or points to copy, or <b>Copy PMID + points</b> for all at once (paste straight into Excel or the portal).</li>
        <li>Tick <b>Done</b> once entered: it is saved for the whole team, so nobody credits the same guest twice, even next month.</li>
      </ol>
      <div class="stc-settings">
        <label>Points per skipped day<input id="stc-pts" type="number" min="0" value="100"></label>
        <label>No credit for stays over (nights)<input id="stc-lim" type="number" min="0" value="15"></label>
        <label>Card to use<select id="stc-sel"><option value="ANY">Any (ID, else A1, else A2–A5)</option><option value="ID">ID number</option><option value="A1">ALL card (A1)</option></select></label>
      </div>
    </div>
  </section>
  <div id="stc-err" class="stc-err" role="alert"></div>

  <div id="stc-out" hidden>
    <div class="stc-kpis">
      <div class="stc-kpi big" style="--k:var(--stc-ok)"><small>Ready to credit</small><strong id="stc-s1">0</strong></div>
      <div class="stc-kpi big" style="--k:var(--stc-ok)"><small>Points to enter</small><strong id="stc-s2">0</strong></div>
      <div class="stc-kpi" style="--k:var(--stc-warn)"><small>Check first</small><strong id="stc-k3">0</strong></div>
      <div class="stc-kpi" style="--k:var(--stc-acc)"><small>Already credited</small><strong id="stc-k4">0</strong></div>
      <div class="stc-kpi" style="--k:var(--stc-bad)"><small>Not a member</small><strong id="stc-k5">0</strong></div>
      <div class="stc-kpi" style="--k:var(--stc-idle)"><small>Guests on sheets</small><strong id="stc-k6">0</strong></div>
    </div>
    <div class="stc-note" id="stc-note" hidden></div>
    <p class="stc-hint" id="stc-hist" style="margin:0 0 10px"></p>
    <p class="stc-sum"><span class="stc-prog" id="stc-prog"></span></p>
    <div class="stc-card stc-copybar">
      <div class="stc-grp"><span class="stc-lbl">Copy every Ready guest:</span><button class="btn gold" type="button" id="stc-cpC">📋 PMID + points</button><button class="btn" type="button" id="stc-cpA">PMIDs only</button><button class="btn" type="button" id="stc-cpB">Points only</button></div>
      <div class="stc-grp"><button class="btn mint" type="button" id="stc-xl">📥 Download Excel</button><button class="btn" type="button" id="stc-pdf" title="A clean page with the totals and every guest: print it or save it as a PDF">📄 Month summary (PDF)</button></div>
    </div>
    <div class="stc-filters">
      <div class="stc-tabs" id="stc-tabs"></div>
      <label>Search<input id="stc-q" placeholder="Guest, room, PMID or conf #"></label>
    </div>
    <div class="stc-wrap"><table><thead><tr><th>Done</th><th>PMID (tap to copy)</th><th class="stc-num">Points</th><th>Guest</th><th>Room</th><th>Conf #</th><th>Check-out</th><th>Skipped dates</th><th class="stc-num">Days</th><th>Status</th><th></th></tr></thead><tbody id="stc-tb"></tbody></table></div>
    <p class="stc-hint" id="stc-meta" style="margin-top:8px"></p>
  </div>

  <section class="stc-rules">
    <div class="stc-card">
      <div class="stc-sec-t">📏 How the credit is worked out</div>
      <ul>
        <li><b>A day counts</b> only when the guest asked to skip it (it is on the housekeeping sheet).</li>
        <li><b>Arrival and departure days never count.</b> Stay dates come from Opera (else from the sheet).</li>
        <li><b>Every 3rd day is a mandatory clean:</b> after 2 skipped days in a row the next one is cleaned, not credited, and the count starts again.</li>
        <li><b>Long stays</b> over the limit (15 nights unless you change it) get no credit.</li>
        <li><b>PMID</b> = the member's card number without its last character, then its last 8 characters (00000009270152Z4 → 9270152Z). The ID card is used first, then the ALL card (A1), then a tier card (A2–A5, shown as Check first).</li>
        <li><b>Check first</b> means the name, room or dates don't match Opera exactly: open the row to see why.</li>
        <li><b>Not a member</b>: the guest is not in the Membership Stays report, so there is no card to credit.</li>
      </ul>
    </div>
    <div class="stc-card">
      <div class="stc-sec-t">🗓 Example: a 6-night stay, guest skips every day</div>
      <div class="stc-tl">
        <div><b>Mon</b>Arrival<br>✗</div><div class="y"><b>Tue</b>Skip<br>✓ 100</div><div class="y"><b>Wed</b>Skip<br>✓ 100</div><div class="m"><b>Thu</b>Must clean<br>✗</div><div class="y"><b>Fri</b>Skip<br>✓ 100</div><div class="y"><b>Sat</b>Skip<br>✓ 100</div><div><b>Sun</b>Departure<br>✗</div>
      </div>
      <p class="stc-hint" style="margin-top:8px">4 days credited = 400 points (at 100 a day). Tap any guest in the list to see their own days like this.</p>
    </div>
  </section>
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
  $('pdf').onclick = summaryPdf;
  $('clear').onclick = clearAll;
  $('track').onclick = tkOpen;
  histNote(); startSync();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();

})();
