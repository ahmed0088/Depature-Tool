// Read-only monthly posting reconciliation. All arithmetic uses integer cents.
(function(W){
  'use strict';
  const FAMILIES={EC:'Early check-in',LC:'Late checkout',BB:'Breakfast',ROOM:'Room upselling',DIN:'Dinner',HB:'Half board',FB:'Full board'};
  const DEFAULTS={'1061':'EC','1062':'LC','2090':'BB'};
  function period(month){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('Choose a valid month.');const [y,m]=month.split('-').map(Number);if(y<2000||y>2100)throw Error('Choose a month between 2000 and 2100.');return {from:month+'-01',to:month+'-'+new Date(Date.UTC(y,m,0)).getUTCDate()};}
  const iso=v=>{const s=String(v||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return '';const d=new Date(s+'T00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===s?s:'';};
  const cents=v=>{const s=String(v??'').trim().replace(/,/g,'').replace(/^\((.*)\)$/,'-$1');if(!s)return 0;if(!/^-?\d+(?:\.\d{1,2})?$/.test(s))throw Error('An Opera posting has an invalid amount.');const negative=s.startsWith('-'),[whole,fraction='']=s.replace(/^-/,'').split('.');const n=(Number(whole)*100+Number(fraction.padEnd(2,'0')))*(negative?-1:1);if(!Number.isSafeInteger(n))throw Error('An Opera amount is outside the supported range.');return n;};
  const add=(a,b)=>{const n=a+b;if(!Number.isSafeInteger(n))throw Error('The monthly total is outside the supported range.');return n;};
  function compare({journal,snapshot,month,mapping={},scope='all',binding,hotelId,dateOf=iso,kind=()=>'',asOf=''}){
    const dates=period(month);if(iso(asOf)&&asOf>=dates.from&&asOf<dates.to)dates.to=asOf;const map={...DEFAULTS,...mapping},currency=String(snapshot?.settings?.currency||'AED').toUpperCase();
    if(!['all','manual','automatic'].includes(scope))throw Error('Choose a valid comparison scope.');
    const result={...dates,month,currency,scope,opera:0,approved:0,pending:0,excluded:0,unmapped:[],warnings:[],products:[],daily:[],journalReady:Array.isArray(journal),snapshotReady:false};
    const families=new Set(Object.values(map).filter(f=>FAMILIES[f])),products=new Map(),days=new Map(),codes=new Map(),codeTotals=new Map(),seen=new Map();
    const group=f=>{if(!products.has(f))products.set(f,{family:f,label:FAMILIES[f]||'Unclassified products',opera:0,approved:0,pending:0,countOpera:0,countIngauge:0});return products.get(f);};
    const daily=d=>{if(!days.has(d))days.set(d,{day:d,opera:0,approved:0,pending:0});return days.get(d);};
    const warning=(key,label)=>{let item=result.warnings.find(x=>x.key===key);if(!item){item={key,label,count:0};result.warnings.push(item);}item.count++;};
    for(const r of journal||[]){
      const id=String(r.TRX_NO||'');if(!id)throw Error('An Opera transaction has no ID.');const signature=JSON.stringify(Object.fromEntries(Object.entries(r).filter(([key])=>key!=='line')));if(seen.has(id)){if(seen.get(id)!==signature)throw Error('Conflicting duplicate Opera transactions. Reload the journal.');continue;}seen.set(id,signature);
      const d=dateOf(r.BUSINESS_DATE);if(!iso(d)){warning('opera-date','Opera postings with invalid dates were excluded');continue;}if(d<dates.from||d>dates.to)continue;
      const code=String(r.TRX_CODE||'').trim(),value=cents(r.CASHIER_DEBIT)-cents(r.CASHIER_CREDIT),family=map[code];
      if(String(r.CURRENCY1||'').trim().toUpperCase()!==currency){warning('currency','Opera postings in another or missing currency were excluded');continue;}
      const auto=/\[NA\s+Pkgs\./i.test(String(r.REMARK||'')+' '+String(r.REFERENCE||'')+' '+String(r.TRX_DESC||''));
      if(scope!=='all'&&(scope==='automatic')!==auto)continue;
      if(!codeTotals.has(code))codeTotals.set(code,{code,label:String(r.TRX_DESC||'Transaction '+code),cents:0,count:0});const codeTotal=codeTotals.get(code);codeTotal.cents=add(codeTotal.cents,value);codeTotal.count++;
      if(family==='exclude'){result.excluded++;continue;}
      if(!FAMILIES[family]){if(!codes.has(code))codes.set(code,{code,label:String(r.TRX_DESC||'Unknown transaction code'),cents:0,count:0});const c=codes.get(code);c.cents=add(c.cents,value);c.count++;continue;}
      if(family==='BB'&&!auto&&!/upsell/i.test(Object.values(r).join(' ')))warning('breakfast','Breakfast postings without upsell notes need a scope check');
      const g=group(family);g.opera=add(g.opera,value);g.countOpera++;result.opera=add(result.opera,value);const t=daily(d);t.opera=add(t.opera,value);
    }
    result.unmapped=[...codes.values()];result.codes=[...codeTotals.values()];
    if(snapshot){
      if(!/^[A-Z]{3}$/.test(String(snapshot.settings?.currency||'').toUpperCase()))throw Error('The IN-Gauge currency is missing. Refresh the snapshot.');
      if(!Array.isArray(snapshot.records))throw Error('The IN-Gauge records are incomplete. Refresh the snapshot.');
      if(!binding||!hotelId||snapshot.hotelId!==hotelId||!['portalUrl','tenantId','propertyId','departmentId'].every(k=>String(snapshot.binding?.[k]||'')===String(binding[k]||'')))throw Error('IN-Gauge data belongs to a different hotel or department. Refresh the linked hotel.');
      result.snapshotReady=!!(snapshot.complete&&!snapshot.invalidatedAt&&snapshot.pagination?.verified&&snapshot.pagination.total===snapshot.records.length&&snapshot.pagination.read===snapshot.records.length&&(!asOf||dates.from<=asOf)&&snapshot.from<=dates.from&&snapshot.to>=dates.to);
      const ids=new Map();
      for(const r of snapshot.records||[]){
        if(!r.id)throw Error('An IN-Gauge record has no ID.');const signature=JSON.stringify(r);if(ids.has(r.id)){if(ids.get(r.id)!==signature)throw Error('Conflicting duplicate IN-Gauge records. Refresh the data.');continue;}ids.set(r.id,signature);
        if(String(r.propertyId)!==String(binding.propertyId)||String(r.departmentId)!==String(binding.departmentId))throw Error('An IN-Gauge record belongs to another hotel or department.');
        const d=iso(r.businessDate);if(!d){warning('ingauge-date','IN-Gauge records without a valid business date were excluded');continue;}if(d<dates.from||d>dates.to)continue;
        const manual=!!r.isManuallyAddedRecord||r.status==='PENDING';if(scope!=='all'&&(scope==='manual')!==manual)continue;
        const f=kind(r.product)||kind(snapshot.products?.find(p=>String(p.id)===String(r.productId))?.code)||'OTHER';if(!families.has(f))warning('ingauge-product','IN-Gauge products without a corresponding Opera code mapping need review');
        const state=String(r.status||'').toUpperCase();if(['DENIED','PURGED','DELETED'].includes(state)){result.excluded++;continue;}if(!['APPROVED','PENDING'].includes(state)){warning('status','IN-Gauge records with an unsupported status were excluded');continue;}
        if(!Number.isSafeInteger(r.totalCents))throw Error('An IN-Gauge record has no valid total amount. Refresh the snapshot.');
        const key=state==='APPROVED'?'approved':'pending',g=group(f),t=daily(d);g[key]=add(g[key],r.totalCents);g.countIngauge++;t[key]=add(t[key],r.totalCents);result[key]=add(result[key],r.totalCents);
      }
    }
    for(let n=1;n<=Number(dates.to.slice(-2));n++)daily(month+'-'+String(n).padStart(2,'0'));
    result.products=[...products.values()];result.daily=[...days.values()].sort((a,b)=>a.day.localeCompare(b.day));result.gap=add(result.opera,-result.approved);result.afterPending=add(result.gap,-result.pending);
    return result;
  }
  const api={compare,period,FAMILIES,DEFAULTS};
  if(typeof module==='object'&&module.exports){module.exports=api;return;}
  const D=document,esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let view={month:new Date().toISOString().slice(0,7),scope:'all',mapping:{},confirmed:false,source:null,hotel:'',error:''};
  const money=(n,c)=>c+' '+(n/100).toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2});
  function graph(r){
    const values=r.daily.flatMap(d=>[d.opera,d.approved]),lo=Math.min(0,...values),hi=Math.max(1,...values),y=n=>130-(n-lo)/(hi-lo)*110,x=d=>20+(Number(d.slice(-2))-1)/(Number(r.to.slice(-2))-1)*560;
    const line=key=>r.daily.map(d=>`${x(d.day).toFixed(1)},${y(d[key]).toFixed(1)}`).join(' ');
    return `<svg viewBox="0 0 600 155" role="img" aria-label="Daily Opera postings and approved IN-Gauge amounts for ${esc(r.month)}. Exact monthly amounts are listed above and by product below."><line x1="20" y1="${y(0)}" x2="580" y2="${y(0)}" class="mt-axis"/><polyline points="${line('opera')}" class="mt-line mt-opera"/><polyline points="${line('approved')}" class="mt-line mt-approved"/>${r.daily.map(d=>`<circle cx="${x(d.day)}" cy="${y(d.opera)}" r="3" class="mt-opera-dot"><title>${esc(d.day)} · Opera ${money(d.opera,r.currency)}</title></circle><circle cx="${x(d.day)}" cy="${y(d.approved)}" r="3" class="mt-approved-dot"><title>${esc(d.day)} · IN-Gauge approved ${money(d.approved,r.currency)}</title></circle>`).join('')}<text x="20" y="151">1 ${esc(r.month)}</text><text x="580" y="151" text-anchor="end">${esc(r.to)}</text></svg>`;
  }
  function render(S,root){
    if(!root)return;const hotel=String(S.binding?.propertyId||'');if(view.hotel!==hotel){view={month:S.from?.slice(0,7)||new Date().toISOString().slice(0,7),scope:'all',mapping:{},confirmed:false,source:null,hotel,error:''};}
    const source=W.ManualUpsells?.state.data.journal;if(view.source!==source){view.source=source;view.confirmed=false;const months=[...new Set((source?.rows||[]).map(r=>W.ManualUpsells?.date(r.BUSINESS_DATE)?.slice(0,7)).filter(Boolean))];if(months.length===1)view.month=months[0];}
    const mappingOpen=!!root.querySelector('.mt-mapping')?.open;
    root.innerHTML=`<header class="mt-header"><div><span class="iga-eyebrow">MONTHLY RECONCILIATION</span><h3>Opera ↔ IN-Gauge</h3><p>${esc(S.binding?.property||'Connect your hotel')} · compare posted upsell revenue</p></div><label>Month<input type="month" data-mt-month value="${esc(view.month)}"></label></header><div class="mt-tools"><div class="mt-scope" role="group" aria-label="Monthly comparison scope">${[['all','Both'],['manual','Manual'],['automatic','Automatic']].map(([k,n])=>`<button type="button" data-mt-scope="${k}" aria-pressed="${view.scope===k}">${n}</button>`).join('')}</div><label class="btn mt-upload">Upload Opera journal<input type="file" data-ig-file="journal" accept=".txt,.tsv" ${S.busy?'disabled':''}></label><button type="button" class="btn" data-mt-fetch ${!S.binding||S.busy?'disabled':''}>Fetch this month’s IN-Gauge</button></div><div data-mt-results></div>`;
    const target=root.querySelector('[data-mt-results]');
    try{
      const r=compare({journal:source?.rows,snapshot:S.snapshot,month:view.month,mapping:view.mapping,scope:view.scope,binding:S.binding,hotelId:typeof HOTEL_ID!=='undefined'?String(HOTEL_ID):'',dateOf:W.ManualUpsells?.date,kind:W.InGaugeAuditCore.kind,asOf:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dubai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())});
      const ready=r.journalReady&&r.snapshotReady;
      target.innerHTML=`<div class="mt-metrics"><div><span>Opera · net posted</span><strong>${r.journalReady?money(r.opera,r.currency):'Upload journal'}</strong><small>Debits − credits / reversals</small></div><div><span>IN-Gauge · approved</span><strong>${S.snapshot?money(r.approved,r.currency):'Fetch records'}</strong><small>Reported total · confirm net / tax basis</small></div><div class="mt-gap"><span>Difference to investigate</span><strong>${r.journalReady&&S.snapshot?money(r.gap,r.currency):'—'}</strong><small>Opera − approved IN-Gauge</small></div></div>
      ${S.snapshot?.fetchedAt?`<p class="iga-hint">IN-Gauge as of ${esc(new Date(S.snapshot.fetchedAt).toLocaleString('en-GB',{timeZone:'Asia/Dubai'}))} · ${esc(source?.rows.length||0)} Opera journal rows loaded.</p>`:''}<p class="mt-state" role="status">${!ready?'Provisional · ':r.unmapped.length||r.warnings.length||!view.confirmed?'Scope review needed · ':r.gap===0?'Reported totals equal · ':'Difference found · '}${!r.journalReady?'Upload the Opera journal for this hotel and month.':!S.snapshot?'Fetch IN-Gauge for the same month.':!r.snapshotReady?'The IN-Gauge snapshot does not fully cover this month or needs refreshing.':r.unmapped.length?r.unmapped.length+' Opera transaction codes need a mapping or explicit exclusion.':!view.confirmed?'Confirm the Opera report covers the hotel and selected period.':'Review individual records before making changes.'}</p>
      ${r.journalReady&&S.snapshot?`<p class="iga-hint">Posting period ${esc(r.from)} → ${esc(r.to)}${r.to!==period(view.month).to?' · Month to date':''}. ${r.excluded} explicitly excluded / denied records.</p><div class="mt-pending"><b>Pending requests ${money(r.pending,r.currency)}</b><span>Difference after pending: ${money(r.afterPending,r.currency)} · pending is not approved revenue.</span></div><div class="mt-legend"><span>● Opera net posted</span><span>● IN-Gauge approved</span><small>Daily amounts within the selected month</small></div><div class="mt-chart">${graph(r)}</div><div class="mt-table"><table><caption>Monthly totals by mapped product family</caption><thead><tr><th>Product</th><th>Opera</th><th>Approved</th><th>Pending</th><th>Difference</th></tr></thead><tbody>${r.products.map(p=>`<tr><th>${esc(p.label)}</th><td>${money(p.opera,r.currency)}</td><td>${money(p.approved,r.currency)}</td><td>${money(p.pending,r.currency)}</td><td>${money(p.opera-p.approved,r.currency)}</td></tr>`).join('')}</tbody></table></div>`:''}
      ${source?`<label class="mt-confirm"><input type="checkbox" data-mt-confirm ${view.confirmed?'checked':''}>The Opera journal is for ${esc(S.binding?.property||'this hotel')} and covers the whole selected period; both systems use the same net / tax basis.</label>`:''}
      ${r.warnings.map(w=>`<p class="iga-hint">${esc(w.label)} · ${w.count} row(s).</p>`).join('')}
      <details class="mt-mapping" ${mappingOpen?'open':''}><summary>Product scope and Opera transaction-code mapping${r.unmapped.length?' · '+r.unmapped.length+' unmapped':''}</summary><p>Current mappings: ${Object.entries({...DEFAULTS,...view.mapping}).map(([k,f])=>esc(k)+' → '+esc(FAMILIES[f]||'Excluded')).join(' · ')}. Map additional upsell codes; explicitly exclude tax, payments and unrelated revenue. These choices affect this chart only.</p>${r.codes.map(c=>`<div class="mt-code"><b>${esc(c.code)} · ${esc(c.label)} · ${money(c.cents,r.currency)}</b><div>${Object.entries(FAMILIES).concat([['exclude','Exclude from upsells']]).map(([f,n])=>`<button type="button" data-mt-code="${esc(c.code)}" data-mt-family="${f}" aria-pressed="${({...DEFAULTS,...view.mapping})[c.code]===f}">${n}</button>`).join('')}</div></div>`).join('')}<button type="button" data-mt-reset>Reset mappings</button><p>Manual Opera rows have no [NA Pkgs.] marker; automatic rows have that marker. IN-Gauge pending requests are included in Manual. No tax conversion or stay-night multiplication is inferred. Changes Logs describe edits and cannot establish monthly posted revenue. Matching totals alone do not prove that sellers or reservations are correct.</p></details>`;
    }catch(error){target.innerHTML=`<p class="iga-error" role="alert">${esc(error.message)}</p>`;}
    if(!root._mtBound){root._mtBound=true;
      root.addEventListener('change',e=>{if(e.target.hasAttribute('data-mt-month')){view.month=e.target.value;view.confirmed=false;render(S,root);}else if(e.target.hasAttribute('data-mt-confirm')){view.confirmed=e.target.checked;render(S,root);}});
      root.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.mtScope){view.scope=b.dataset.mtScope;view.confirmed=false;render(S,root);}else if(b.dataset.mtFamily){view.mapping[b.dataset.mtCode]=b.dataset.mtFamily;view.confirmed=false;render(S,root);}else if(b.hasAttribute('data-mt-reset')){view.mapping={};view.confirmed=false;render(S,root);}else if(b.hasAttribute('data-mt-fetch')){try{const p=period(view.month),today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dubai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());if(p.from>today)throw Error('Choose the current month or a past month.');if(p.to>today)p.to=today;W.InGaugeWorkspace.fetchMonth(p).catch(error=>{root.querySelector('[data-mt-results]').innerHTML=`<p class="iga-error">${esc(error.message)}</p>`;});}catch(error){root.querySelector('[data-mt-results]').innerHTML=`<p class="iga-error">${esc(error.message)}</p>`;}}});
    }
  }
  W.MonthlyTally={...api,render};
})(typeof window!=='undefined'?window:globalThis);
