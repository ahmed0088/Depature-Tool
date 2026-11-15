// Read-only monthly team performance. Money stays in integer cents; no portal writes.
(function(root){
  'use strict';
  const C=typeof module==='object'&&module.exports?require('./ingauge-audit-core.js'):root.InGaugeAuditCore;
  const E=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const list=v=>Array.isArray(v)?v:Object.values(v||{});
  const today=(now=Date.now())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dubai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
  function period(month,now=Date.now()){
    if(!/^\d{4}-\d{2}$/.test(String(month))||!C.day(month+'-01'))throw Error('Choose a valid month.');
    const current=today(now),end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10);
    return {month,from:month+'-01',to:month===current.slice(0,7)?current:end,days:Number(end.slice(8)),elapsed:month<current.slice(0,7)?Number(end.slice(8)):month===current.slice(0,7)?Number(current.slice(8)):0,future:month>current.slice(0,7)};
  }
  function summarize(snapshot,binding,month,now=Date.now()){
    const p=period(month,now),r={...p,currency:'',available:false,verified:false,fresh:false,issues:[],approved:0,pending:0,pendingCount:0,approvedCount:0,approvedOnly:0,reviewed:0,reviewedCount:0,todayCents:0,todayCount:0,unassigned:0,otherCount:0,amountRounding:[],excluded:0,team:[],products:[],daily:[],records:[],fetchedAt:0};
    if(!snapshot||!C.sameBinding(snapshot.binding,binding))return r;
    r.available=true;r.currency=C.text(snapshot.settings?.currency);r.fetchedAt=Number(snapshot.fetchedAt)||0;
    const rows=list(snapshot.records),people=new Map(),products=new Map(),days=new Map(),seen=new Set(),warn=text=>{if(!r.issues.includes(text))r.issues.push(text);};
    for(const person of list(snapshot.contributors)){const id=C.id(person.id);if(!id)continue;if(people.has(id)){warn('The seller list contains duplicate IDs.');continue;}people.set(id,{id,name:C.text(person.name)||'Contributor '+id,active:person.activeStatus==='NORMAL',listed:true,approved:0,pending:0,count:0,pendingCount:0,today:0,records:[]});}
    for(const sourceRow of rows){const row=C.reportingRecord(sourceRow);
      if(row.propertyId!==binding.propertyId||row.departmentId!==binding.departmentId){warn('Some records belong to another hotel or department.');continue;}
      const date=C.day(row.businessDate);if(!date){warn('Some records have no valid business date.');continue;}if(date<p.from||date>p.to)continue;
      const id=C.id(row.id);if(!id||seen.has(id)){warn('Some sale IDs are missing or duplicated.');continue;}seen.add(id);
      const status=C.text(row.status).toUpperCase();if(['DENIED','PURGED','DELETED'].includes(status)){r.excluded++;continue;}
      if(!C.isRevenueStatus(status)&&status!=='PENDING'){r.otherCount++;continue;}
      if(!Number.isSafeInteger(row.totalCents)){warn(C.recordAmountIssue(row));continue;}
      if(row.amountRounding?.totalCents)r.amountRounding.push({id:row.id,confirmation:row.confirmation,...row.amountRounding.totalCents});
      const amount=row.totalCents,bucket=C.isRevenueStatus(status)?'approved':'pending';
      if(!Number.isSafeInteger(r[bucket]+amount))throw Error('The revenue total exceeds the supported money range.');
      r[bucket]+=amount;if(status==='REVIEWED'){r.reviewed+=amount;r.reviewedCount++;}else r[bucket==='approved'?'approvedCount':'pendingCount']++;if(status==='APPROVED')r.approvedOnly+=amount;r.records.push(row);
      const contributor=C.id(row.contributorId),pid=contributor||'unassigned';
      if(!people.has(pid))people.set(pid,{id:pid,name:contributor?(C.text(row.seller)||'Contributor '+contributor):'Unassigned seller',active:false,listed:false,approved:0,pending:0,count:0,pendingCount:0,today:0,records:[]});
      const person=people.get(pid);person[bucket]+=amount;person.count++;if(bucket==='pending')person.pendingCount++;person.records.push(row);if(!contributor)r.unassigned++;
      const productKey=C.id(row.productId)||'unassigned';if(!products.has(productKey))products.set(productKey,{id:productKey,name:C.text(row.product)||'Unassigned product',approved:0,pending:0});products.get(productKey)[bucket]+=amount;
      if(!days.has(date))days.set(date,{day:date,approved:0,pending:0});days.get(date)[bucket]+=amount;
      if(bucket==='approved'&&date===today(now)){r.todayCents+=amount;r.todayCount++;person.today+=amount;}
    }
    r.team=[...people.values()].filter(x=>x.active||x.count).sort((a,b)=>b.approved-a.approved||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
    r.products=[...products.values()].sort((a,b)=>b.approved-a.approved||a.name.localeCompare(b.name));
    for(let n=1;n<=p.days&&p.from.slice(0,8)+String(n).padStart(2,'0')<=p.to;n++){const day=p.from.slice(0,8)+String(n).padStart(2,'0');r.daily.push(days.get(day)||{day,approved:0,pending:0});}
    if(!Number.isFinite(r.fetchedAt)||r.fetchedAt<=0||r.fetchedAt>now+60000)warn('The saved read has no valid fetch time.');
    const pag=snapshot.pagination,complete=snapshot.complete===true&&!snapshot.invalidatedAt&&pag?.verified===true&&pag.total===rows.length&&pag.read===rows.length;
    r.verified=!!(complete&&snapshot.from<=p.from&&snapshot.to>=p.to&&r.currency&&!r.issues.length&&!p.future);
    r.fresh=r.verified&&r.fetchedAt<=now+60000&&now-r.fetchedAt<=21600000;
    if(!complete)warn('Refresh required: the saved read is incomplete or changed.');
    if(snapshot.from>p.from||snapshot.to<p.to)warn('The saved read does not cover this whole month to date.');
    if(!r.currency)warn('The hotel currency was not returned.');
    if(r.otherCount)warn(r.otherCount+' records have other statuses; they are outside Approved, Reviewed and Pending.');
    return r;
  }
  function goal(value,binding,month,currency){
    if(!value||value.schema!==1||value.source!=='HotelOps manager goal'||value.month!==month||value.currency!==currency||!C.sameBinding(value.binding,binding)||!Number.isSafeInteger(value.cents)||value.cents<=0)return null;
    return value;
  }
  function pacing(r,target){
    if(!r.verified||!target||!Number.isSafeInteger(target.cents)||target.cents<=0||!r.elapsed)return null;
    const remaining=Math.max(0,target.cents-r.approved),daysLeft=Math.max(0,r.days-r.elapsed),expected=Math.round(target.cents*r.elapsed/r.days);
    return {percent:r.approved/target.cents*100,remaining,expected,behind:Math.max(0,expected-r.approved),daysLeft,daily:daysLeft?Math.ceil(remaining/daysLeft):null,met:r.approved>=target.cents};
  }
  const money=(n,currency)=>currency+' '+(n/100).toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2});
  let current=null,query='',onlySales=false,openPerson='',showCount=20;
  function source(S){const a=[S.snapshot,S.overviewSnapshot].filter(s=>s&&C.sameBinding(s.binding,S.binding)&&s.from<=S.overviewMonth+'-01'&&s.to.slice(0,7)>=S.overviewMonth);return a.sort((x,y)=>(y.fetchedAt||0)-(x.fetchedAt||0))[0]||null;}
  function chart(r){
    const max=Math.max(1,...r.daily.map(x=>Math.abs(x.approved))),w=600,h=130,step=w/Math.max(r.daily.length,1);
    return `<div class="igo-chart"><svg viewBox="0 0 ${w} ${h+25}" role="img" aria-label="Approved + reviewed revenue by business date, ${E(r.month)}"><line x1="0" y1="${h}" x2="${w}" y2="${h}" class="igo-grid"/>${r.daily.map((x,i)=>`<rect x="${i*step+step*.2}" y="${h-Math.abs(x.approved)/max*(h-15)}" width="${step*.6}" height="${Math.max(1,Math.abs(x.approved)/max*(h-15))}" rx="3" class="${x.approved<0?'igo-negative':''}"><title>${E(x.day)} · ${E(money(x.approved,r.currency))}</title></rect>${i===0||i===r.daily.length-1||((i+1)%5===0)?`<text x="${(i+.5)*step}" y="${h+19}" text-anchor="middle">${i+1}</text>`:''}`).join('')}</svg></div>`;
  }
  function teamRows(r){
    const q=query.toLowerCase(),rows=r.team.filter(p=>(!q||(p.name+' '+p.id).toLowerCase().includes(q))&&(!onlySales||p.count));
    return rows.map((p,i)=>`<article class="igo-person" data-igo-person-row="${E(p.id)}"><div class="igo-person-name"><span class="igo-avatar" aria-hidden="true">${E(p.name.split(/\s+/).map(w=>w[0]).slice(0,2).join('').toUpperCase())}</span><div><button type="button" data-igo-person="${E(p.id)}" aria-expanded="${openPerson===p.id}">${E(p.name)}</button><small>${p.id==='unassigned'?'Needs seller assignment':'ID '+E(p.id)+(p.active?'':p.listed?' · Inactive':' · Historical seller')}${p.count?' · '+p.count+' sale rows':' · No sales this month'}</small></div></div><div class="igo-person-value"><small>Approved + reviewed</small><b>${E(money(p.approved,r.currency))}</b><div class="igo-share" aria-hidden="true"><i style="width:${Math.min(100,Math.max(0,r.approved>0?p.approved/r.approved*100:0))}%"></i></div></div><div class="igo-person-pending"><small>Pending · ${p.pendingCount}</small><span>${E(money(p.pending,r.currency))}</span></div><div class="igo-person-today"><small>Today</small><span>${r.month===today().slice(0,7)?E(money(p.today,r.currency)):'—'}</span></div>${openPerson===p.id?`<div class="igo-sale-list"><p>IN-Gauge seller attribution · business date · confirmation · status · total</p>${p.records.slice().sort((a,b)=>b.businessDate.localeCompare(a.businessDate)||String(b.id).localeCompare(String(a.id))).slice(0,showCount).map(s=>`<div><span><b>${E(s.confirmation||'No confirmation')}</b> · ${E(s.product)}<small>${E(s.businessDate)} · ${E(s.status)} · Record ${E(s.id)}</small></span><strong>${E(money(s.totalCents,r.currency))}</strong></div>`).join('')||'<p>No approved, reviewed or pending sales in this month.</p>'}${p.records.length>showCount?'<button type="button" class="btn" data-igo-more>Show more sales</button>':''}</div>`:''}</article>`).join('')||'<p class="igo-empty">No matching team members.</p>';
  }
  function render(S,rootNode){
    if(!rootNode)return;S.overviewMonth=S.overviewMonth||today().slice(0,7);current={S,root:rootNode};
    const month=S.overviewMonth,s=source(S),r=summarize(s,S.binding,month),g=goal(S.overviewGoal,S.binding,month,r.currency),pace=pacing(r,g),locked=S.busy||S.switching||S.uploading,monthName=new Date(month+'-15T00:00:00Z').toLocaleDateString('en-GB',{month:'long',year:'numeric',timeZone:'Asia/Dubai'}),amount=n=>r.available?E(money(n,r.currency)):'—';
    rootNode.innerHTML=`<header class="igo-heading"><div><span class="iga-eyebrow">DAILY OVERVIEW</span><h3>${E(monthName)}</h3><p>${E(S.binding?.property||'Connect an IN-Gauge hotel to begin')}${S.binding?' · '+E(S.binding.department):''}</p></div><div class="igo-tools"><label><span>Month</span><input aria-label="Overview month" type="month" id="igOverviewMonth" value="${E(month)}" max="${today().slice(0,7)}" ${locked?'disabled':''}></label><button type="button" class="btn gold" data-igo-refresh ${!S.binding||locked?'disabled':''}>${S.busy&&S.runMode==='snapshot'?'Refreshing…':'Refresh IN-Gauge'}</button></div></header>
      <div class="igo-freshness ${r.fresh?'is-fresh':''}" role="status"><i aria-hidden="true"></i><span>${r.available?(r.fresh?'Verified read':r.verified?'Saved read · refresh for today':'Partial read · refresh required')+' · '+E(new Date(r.fetchedAt).toLocaleString('en-GB',{timeZone:'Asia/Dubai'}))+' Dubai time':'No monthly read yet · refresh to load everyone’s sales and goals'}</span>${r.available?`<small>${E(r.from)} → ${E(r.to)}</small>`:''}</div>
      ${r.amountRounding.length?'<p class="igo-reporting-time">'+r.amountRounding.length+' API amount'+(r.amountRounding.length===1?' has':'s have')+' fractions of a cent. Report totals display currency precision; original IN-Gauge values are unchanged.</p>':''}${C.reportingMessage(s)?'<p class="igo-reporting-time">'+E(C.reportingMessage(s))+'</p>':''}${r.available&&!r.verified?'<p class="igo-notice">These are observed amounts, not a verified monthly total. '+E(r.issues.join(' '))+'</p>':''}
      <div class="igo-metrics"><article><span>Approved + reviewed this month</span><strong>${amount(r.approved)}</strong><small>${r.available?r.approvedCount+' Approved · '+r.reviewedCount+' Reviewed rows':'All products · manual + automatic'}</small></article><article><span>Approved + reviewed today</span><strong>${r.month===today().slice(0,7)?amount(r.todayCents):'—'}</strong><small>${r.month===today().slice(0,7)?E(today())+' · '+r.todayCount+' sale rows':'Choose the current month for today'}</small></article><article><span>Pending requests</span><strong>${amount(r.pending)}</strong><small>${r.pendingCount} requests · separate from approved</small></article></div>
      <div class="igo-dashboard-grid"><section class="igo-goal"><header><div><span class="iga-eyebrow">MONTHLY REVENUE GOAL</span><h4>${g?E(money(g.cents,r.currency)):'Set your monthly goal'}</h4></div>${pace?'<span class="igo-goal-badge">'+(pace.met?'Goal reached':pace.percent.toFixed(1)+'% reached')+'</span>':''}</header><p>${g?'HotelOps manager goal · '+E(monthName):s?.goals?.status==='not-set'?'No saved location goal returned by IN-Gauge for this month.':'No verified monthly revenue goal is available yet.'}</p>${pace?`<div class="igo-goal-track" role="progressbar" aria-label="Monthly revenue goal progress" aria-valuenow="${Math.max(0,Math.min(100,pace.percent)).toFixed(1)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${Math.max(0,Math.min(100,pace.percent))}%"></i><b style="left:${Math.min(100,r.elapsed/r.days*100)}%" title="Calendar pace"></b></div><div class="igo-goal-stats"><div><small>Still to reach</small><b>${E(money(pace.remaining,r.currency))}</b></div><div><small>${pace.daysLeft?'Needed per remaining day':'Month finished'}</small><b>${pace.met?'Goal reached':pace.daily===null?'Review the shortfall':E(money(pace.daily,r.currency))}</b></div></div><p class="igo-pace">${pace.met?'Your approved + reviewed monthly revenue has reached the goal.':pace.behind?'Behind calendar pace by '+E(money(pace.behind,r.currency))+'.':'On or ahead of calendar pace.'} ${pace.daysLeft} days remain after the selected day.</p>`:g?'<p class="igo-notice">Refresh a complete monthly read to calculate goal progress.</p>':'<p class="igo-goal-empty">Save the revenue amount you want the team to reach. We’ll show progress, the gap, and the daily pace needed.</p>'}
      <details class="igo-goal-settings"><summary>${g?'Change monthly goal':'Set monthly goal'}</summary><form id="igOverviewGoalForm"><label for="igOverviewGoal">${E(monthName)} · ${E(r.currency||'hotel currency')}</label><div><input id="igOverviewGoal" type="text" inputmode="decimal" placeholder="e.g. 25000.00" value="${g?String(g.cents/100):''}" ${!r.currency||locked?'disabled':''}><button type="submit" class="btn" ${!r.currency||locked?'disabled':''}>Save goal</button></div><small>Saved in HotelOps for this hotel and month. Does not change IN-Gauge targets or sales.</small></form></details></section>
      <section class="igo-checks"><span class="iga-eyebrow">YOUR DAILY CHECKS</span><h4>What needs attention?</h4><button type="button" data-igo-pending ${!r.pendingCount||locked?'disabled':''}><span class="igo-check-icon">${r.pendingCount?'!':'✓'}</span><span><b>${!r.available?'Refresh to check requests':r.pendingCount?r.pendingCount+' request'+(r.pendingCount===1?'':'s')+' awaiting review':'No pending requests in this read'}</b><small>${r.pendingCount?'Review each request before approving it':'Approved + reviewed revenue excludes pending requests'}</small></span><span aria-hidden="true">→</span></button><div class="igo-check-line"><span class="igo-check-icon">${r.unassigned||r.otherCount?'!':'✓'}</span><span><b>${!r.available?'Refresh to load seller totals':r.unassigned?r.unassigned+' sale rows without a seller':r.otherCount?r.otherCount+' records with other statuses':'Seller attribution is visible'}</b><small>${r.unassigned?'Check the unassigned row below':r.otherCount?'Check these statuses in IN-Gauge': 'Open a team member to see their credited sales'}</small></span></div><button type="button" data-ig-monthly><span class="igo-check-icon">↔</span><span><b>Compare with Opera</b><small>Find missing sales, wrong values, or seller differences</small></span><span aria-hidden="true">→</span></button><p>Figures follow the seller currently credited in IN-Gauge. Use Opera audit evidence to check who should receive credit.</p></section></div>
      <section class="igo-team"><header><div><span class="iga-eyebrow">TEAM PERFORMANCE</span><h4>Everyone’s upsells</h4><p>All products · manual + automatic · grouped by contributor ID</p></div><button type="button" class="btn" data-igo-export ${!r.available?'disabled':''}>Export totals</button></header><div class="igo-team-tools"><input id="igOverviewSearch" type="search" aria-label="Search team members" placeholder="Search team member…" value="${E(query)}"><label><input id="igOverviewOnlySales" type="checkbox" ${onlySales?'checked':''}>With sales only</label></div><div class="igo-team-head" aria-hidden="true"><span>Team member</span><span>Approved + reviewed</span><span>Pending</span><span>Today</span></div><div id="igOverviewTeam">${r.available?teamRows(r):'<p class="igo-empty">Refresh IN-Gauge to load the team. No Opera reports are needed here.</p>'}</div><footer><span>Team approved + reviewed total</span><b>${amount(r.approved)}</b></footer></section>
      ${r.available?`<details class="igo-trends"><summary>Daily revenue &amp; products</summary><h4>Approved + reviewed by business date</h4>${chart(r)}<div class="igo-products">${r.products.map(p=>`<div><span>${E(p.name)}</span><b>${E(money(p.approved,r.currency))}</b></div>`).join('')}</div></details><p class="igo-footnote">${r.excluded} denied / removed rows excluded. ${r.otherCount} other-status rows excluded. Totals use IN-Gauge’s recorded daily total; charge days are not multiplied again. Refresh after changes to update these figures.</p>`:''}`;
    rootNode.onclick=e=>{
      const button=e.target.closest('button');if(!button||button.disabled)return;
      if(button.hasAttribute('data-igo-refresh'))root.InGaugeWorkspace?.refreshOverview().catch(showError);
      if(button.hasAttribute('data-igo-pending'))root.InGaugeWorkspace?.showOverviewPending().catch(showError);
      if(button.hasAttribute('data-igo-person')){openPerson=openPerson===button.dataset.igoPerson?'':button.dataset.igoPerson;showCount=20;redrawTeam();}
      if(button.hasAttribute('data-igo-more')){showCount+=20;redrawTeam();}
      if(button.hasAttribute('data-igo-export'))exportTotals(r,S.binding);
    };
    rootNode.querySelector('#igOverviewSearch').oninput=e=>{query=e.target.value;redrawTeam();};
    rootNode.querySelector('#igOverviewOnlySales').onchange=e=>{onlySales=e.target.checked;redrawTeam();};
    rootNode.querySelector('#igOverviewMonth').onchange=e=>root.InGaugeWorkspace?.chooseOverviewMonth(e.target.value).catch(showError);
    rootNode.querySelector('#igOverviewGoalForm').onsubmit=e=>{e.preventDefault();root.InGaugeWorkspace?.saveOverviewGoal(rootNode.querySelector('#igOverviewGoal').value).catch(showError);};
    function redrawTeam(){rootNode.querySelector('#igOverviewTeam').innerHTML=teamRows(r);}
    function showError(error){root.InGaugeWorkspace?.overviewError(error.message);}
  }
  function exportTotals(r,binding){
    const cell=v=>{let text=String(v??'');if(/^[\t\r\n ]*[=+@\-]/.test(text)&&!/^[-+]?\d+(?:\.\d+)?$/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';},rows=[['Hotel','Month','Currency','Contributor ID','Seller','Approved + Reviewed','Pending','Pending requests','Today','As of Dubai','Verified monthly coverage'],...r.team.map(p=>[binding.property,r.month,r.currency,p.id,p.name,(p.approved/100).toFixed(2),(p.pending/100).toFixed(2),p.pendingCount,r.month===today().slice(0,7)?(p.today/100).toFixed(2):'',new Date(r.fetchedAt).toLocaleString('en-GB',{timeZone:'Asia/Dubai'}),r.verified?'Yes':'No'])];
    const url=URL.createObjectURL(new Blob(['\ufeff'+rows.map(row=>row.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='IN-Gauge-team-'+r.month+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  const api={today,period,summarize,goal,pacing,source,render};if(typeof module==='object'&&module.exports)module.exports=api;else root.InGaugeOverview=api;
})(typeof window!=='undefined'?window:globalThis);
