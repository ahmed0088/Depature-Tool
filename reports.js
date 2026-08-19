// ═══════════════════════════════════════════════════════════
//  reports.js  —  Nationality · Rented Rooms · Night Audit · Immigration
// ═══════════════════════════════════════════════════════════

// ── COUNTRY MAPPINGS ──────────────────────────────────────
const EXCEL_COUNTRIES = ["Afghanistan","Albania","Algeria","American Samoa","Andorra","Angola","Anguilla","Antarctica","Antigua & Barbuda","Argentina","Armenia","Aruba","Australia","Austria","Azerbaijan","Bahamas","Bahrain","Bangladesh","Barbados","Belarus","Belgium","Belize","Benin","Bermuda","Bhutan","Bolivia","Bosnia-Herzegovina","Botswana","Brazil","British Indian Ocean Territory","British Virgin Islands","British West Indies","Brunei","Bulgaria","Burkina Faso","Burundi","Cambodia","Cameroon Republic","Canada","Cape Verde","Cayman Island","Central African Republic","Chad","Chile","China","Colombia","Comoros","Congo (Republic of the Congo)","Congo, Dem. Rep. of (Zaire)","Cook Islands","Costa Rica","Côte d'Ivoire","Croatia","Cuba","Cyprus","Czech Republic","Czechoslovakia","Denmark","Djibouti","Dominica","Dominican Republic","East Timor","Ecuador","Egypt","El Salvador","Equatorial Guinea","Eritrea","Estonia","Ethiopia","Falkland Islands (Malvinas)","Faroe Islands","Fiji","Finland","France","French Guiana","French Polynesia","Gabon","Gambia","Georgia","Germany","Ghana","Gibraltar","Greece","Greenland","Grenada","Guadeloupe","Guam","Guatemala","Guinea","Guinea-Bissau","Guyana","Haiti","Holy See (Vatican City State)","Honduras","Hong Kong","Hungary","Iceland","India","Indonesia","Iran","Iraq","Ireland","Isle of Man","Israel","Italy","Jamaica","Japan","Jordan","Kazakhstan","Kenya","Kiribati","Korea, Democratic People's Republic of (North)","Korea, Republic of (South)","Kosovo","Kuwait","Kyrghyzstan","Laos","Latvia","Lebanon","Lesotho","Liberia","Libya","Liechtenstein","Lithuania","Luxembourg","Macau","Macedonia, Republic of","Madagascar","Malagasy Republic","Malawi","Malaysia","Maldives","Mali","Malta","Marshal Islands","Martinique","Mauritania","Mauritius","Mayotte","Mexico","Micronesia, Federated States of","Moldova","Monaco","Mongolia","Montenegro","Montserrat","Morocco","Mozambique","Myanmar (Burma)","Namibia","Nauru","Nepal","Netherlands","Netherlands, Antilles","New Caledonia","New Zealand","Nicaragua","Niger","Nigeria","Norfolk Island","Northern Mariana Isl.","Norway","Oman","Pakistan","Palau","Palestine","Panama","Papua New Guinea","Paraguay","Peru","Philippines","Poland","Portugal","Puerto Rico","Qatar","Reunion","Romania","Russian Federation","Rwanda","Saba","Saint Barthelemy","Saint Helena","Saint Kitts and Nevis","Saint Lucia","Saint Pierre and Miquelon","Saint Vincent and the Grenadines","Samoa","San Marino (in Italy)","Sao Tomé","Saudi Arabia","Scotland","Senegal","Serbia","Seychelles","Sierra Leone","Singapore","Slovakia Republic","Slovenia","Solomon Island","Somalia","South Africa","South Georgia and the South Sandwich Islands","South Sudan","Spain","Sri Lanka","Sudan","Surinam","Swaziland","Sweden","Switzerland","Syria","Tadjikistan","Taiwan","Tanzania","Thailand","Togo","Tokelau","Tonga","Trinidad & Tobaggo","Tunisia","Turkey","Turkmenistan","Turks and Caicos Islands","Tuvalu","Uganda","Ukraine","United Arab Emirates","United Kingdom","United States of America","Uruguay","Uzbekistan","Vanuatu","Venezuela","Vietnam","Virgin Islands, British","Virgin Islands, U.S.","Yemen","Yugoslavia","Zambia","Zimbabwe"];
const EXCEL_LOWER = {};
EXCEL_COUNTRIES.forEach(n => { EXCEL_LOWER[n.toLowerCase()] = n; });
const NAME_MAP = {
  "Cote D'Ivoire":"Côte d'Ivoire","Ivory Coast":"Côte d'Ivoire","Great Britain":"United Kingdom",
  "England":"United Kingdom","Scotland":"United Kingdom","Russia":"Russian Federation",
  "United States":"United States of America","USA":"United States of America",
  "Cameroon":"Cameroon Republic","Congo (Kinshasa)":"Congo, Dem. Rep. of (Zaire)",
  "Democratic Republic of the Congo":"Congo, Dem. Rep. of (Zaire)","Myanmar":"Myanmar (Burma)",
  "Burma":"Myanmar (Burma)","Tajikistan":"Tadjikistan","Kyrgyzstan":"Kyrghyzstan",
  "Bosnia and Herzegovina":"Bosnia-Herzegovina","Palestine, State of":"Palestine",
  "Trinidad and Tobago":"Trinidad & Tobaggo","Timor-Leste":"East Timor",
  "UAE":"United Arab Emirates","Czechia":"Czech Republic","Slovakia":"Slovakia Republic",
  "Viet Nam":"Vietnam","South Korea":"Korea, Republic of (South)",
  "North Korea":"Korea, Democratic People's Republic of (North)",
  "Cabo Verde":"Cape Verde","Brunei Darussalam":"Brunei",
  "Burkina Fasa":"Burkina Faso",
  "Korea (South)":"Korea, Republic of (South)",
  "Libyan Arab Jamahiriya":"Libya",
  "Bosnia Herzegovina":"Bosnia-Herzegovina",
  "Congo":"Congo (Republic of the Congo)",
  "Congo, The Democratic Republic of the":"Congo, Dem. Rep. of (Zaire)",
  "Kyrgzstan":"Kyrghyzstan",
  "Congo (Brazzaville)":"Congo (Republic of the Congo)",
  "Saint Barthélemy":"Saint Barthelemy",
  "San Marino":"San Marino (in Italy)",
  "Suriname":"Surinam",
  "Unknown":null,
  "UNKNOWN":null,
  "unknown":null,
  "No Nationality":null,
  "Not Specified":null,
};
function resolveCountry(name) {
  if (!name) return { excel: null, isUnknown: true };
  const t = name.trim();
  if (NAME_MAP.hasOwnProperty(t)) { const v = NAME_MAP[t]; return { excel: v, isUnknown: v === null }; }
  const match = EXCEL_LOWER[t.toLowerCase()];
  return match ? { excel: match, isUnknown: false } : { excel: null, isUnknown: false };
}

// ── NATIONALITY REPORT ────────────────────────────────────
function natRestoreSaved() {
  try {
    const saved = localStorage.getItem('ibis_nat_paste');
    if (saved) { const el = document.getElementById('natInput'); if(el && !el.value.trim()) { el.value = saved; showToast('Last session data restored ↩'); } }
  } catch(e) {}
}
// Restore saved paste on page load
if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', natRestoreSaved); } else { setTimeout(natRestoreSaved, 400); }

function processNat() {
  const raw    = document.getElementById('natInput').value.trim();
  window._natReportMonth = null; window._natDates = null;
  if (raw) { try { localStorage.setItem('ibis_nat_paste', raw); } catch(e){} }
  const errBox = document.getElementById('natError'); errBox.classList.remove('show');
  const showErr = msg => { document.getElementById('natErrorMsg').textContent = msg; errBox.classList.add('show'); };
  if (!raw) return showErr('Paste the Opera nationality report first.');
  const lines = raw.split('\n'); if (lines.length < 2) return showErr('File empty.');
  const headers = lines[0].split('\t'); const idx = {};
  headers.forEach((h, i) => { idx[h.trim()] = i; });
  // Detect format early for column validation
  const isNewFormatCheck = idx['ARR_ROOMS'] !== undefined && idx['ARR_PERSONS'] !== undefined;
  const needed = isNewFormatCheck
    ? ['COUNTRY_CODE','COUNTRY_NAME','ARR_PERSONS','STAY_ROOMS','STAY_PERSONS']
    : ['VALUE_CODE','COUNTRY_CODE','COUNTRY_NAME','SUMVALUEPERCOUNTRY_CODE','SUMVALUEPERVALUE_CODE'];
  const miss   = needed.filter(k => idx[k] === undefined);
  if (miss.length) return showErr('Missing columns: ' + miss.join(', '));

  // Detect format: new single-row format has ARR_ROOMS/ARR_PERSONS columns; old format uses separate APR/RMS/PRS rows
  const isNewFormat = idx['ARR_ROOMS'] !== undefined && idx['ARR_PERSONS'] !== undefined;

  const seenKey = new Set(), operaRaw = {};
  let grandAPR=0,grandRMS=0,grandPRS=0,fA=false,fR=false,fP=false;

  if (isNewFormat) {
    // ── New format: one row per country, arrivals in ARR_* columns ──
    // Grand totals: grab from the first data row (all rows share the same totals)
    for (let i = 1; i < lines.length; i++) {
      const p = lines[i].split('\t'); if (p.length < 22) continue;
      const name = (p[idx['COUNTRY_NAME']]||'').trim(); if (!name) continue;
      const arrR  = parseInt(p[idx['ARR_ROOMS']]   ||'0')||0;
      const arrP  = parseInt(p[idx['ARR_PERSONS']] ||'0')||0;
      const stayR = parseInt(p[idx['STAY_ROOMS']]  ||'0')||0;
      const stayP = parseInt(p[idx['STAY_PERSONS']]||'0')||0;
      const arrPly  = parseInt(p[idx['ARR_PERSONS_LY']]  ||'0')||0;
      const stayRly = parseInt(p[idx['STAY_ROOMS_LY']]   ||'0')||0;
      const stayPly = parseInt(p[idx['STAY_PERSONS_LY']] ||'0')||0;
      // Auto-detect report month — collect all dates, derive month from range
      if (idx['BUSINESS_DATE'] !== undefined) {
        const ds = (p[idx['BUSINESS_DATE']]||'').trim();
        if (ds) { const d = new Date(ds); if (!isNaN(d)) { if (!window._natDates) window._natDates=[]; window._natDates.push(d); } }
      }
      if (!window._natReportMonth && idx['MONTH'] !== undefined) {
        const ms = (p[idx['MONTH']]||'').trim(); if (ms) window._natReportMonth = ms;
      }
      const key = (p[idx['COUNTRY_CODE']]||'').trim() + '|NAT';
      if (seenKey.has(key) || !name) continue; seenKey.add(key);
      if (!operaRaw[name]) operaRaw[name] = {APR:0,RMS:0,PRS:0,APRLY:0,RMSLY:0,PRSLY:0};
      operaRaw[name].APR = arrP;   // Arrival Persons
      operaRaw[name].RMS = stayR;  // Stay Rooms
      operaRaw[name].PRS = stayP;  // Stay Persons
      operaRaw[name].APRLY = arrPly;
      operaRaw[name].RMSLY = stayRly;
      operaRaw[name].PRSLY = stayPly;
      grandAPR += arrP;
      grandRMS += stayR;
      grandPRS += stayP;
    }
    fA=true; fR=true; fP=true;
    // Derive month label from date range collected across all rows
    if (!window._natReportMonth && window._natDates && window._natDates.length > 0) {
      const minD = new Date(Math.min(...window._natDates));
      const maxD = new Date(Math.max(...window._natDates));
      if (minD.getMonth() === maxD.getMonth() && minD.getFullYear() === maxD.getFullYear()) {
        // All dates in same month — show that month
        window._natReportMonth = minD.toLocaleString('en-GB',{month:'long',year:'numeric'});
      } else {
        // Spans multiple months — show range
        window._natReportMonth = minD.toLocaleString('en-GB',{month:'short',year:'numeric'}) + ' – ' + maxD.toLocaleString('en-GB',{month:'short',year:'numeric'});
      }
    }
    window._natDates = null;
  } else {
    // ── Old format: separate rows per VALUE_CODE (APR / RMS / PRS) ──
    for (let i = 1; i < lines.length; i++) {
      const p    = lines[i].split('\t'); if (p.length < 22) continue;
      const code = (p[idx['VALUE_CODE']]||'').trim(); if (!['RMS','APR','PRS'].includes(code)) continue;
      const gtot = parseInt(p[idx['SUMVALUEPERVALUE_CODE']]||'0')||0;
      if (code==='APR'&&!fA&&gtot>0){grandAPR=gtot;fA=true;}
      if (code==='RMS'&&!fR&&gtot>0){grandRMS=gtot;fR=true;}
      if (code==='PRS'&&!fP&&gtot>0){grandPRS=gtot;fP=true;}
      const name = (p[idx['COUNTRY_NAME']]||'').trim();
      const key  = (p[idx['COUNTRY_CODE']]||'').trim() + '|' + code;
      if (seenKey.has(key) || !name) continue; seenKey.add(key);
      if (!operaRaw[name]) operaRaw[name] = {APR:0,RMS:0,PRS:0,APRLY:0,RMSLY:0,PRSLY:0};
      operaRaw[name][code] = parseInt(p[idx['SUMVALUEPERCOUNTRY_CODE']])||0;
    }
  }
  const excelData={}, unknowns=[], unmatched=[];
  for (const [opName, vals] of Object.entries(operaRaw)) {
    const { excel, isUnknown } = resolveCountry(opName);
    if (isUnknown) { unknowns.push({name:opName,...vals}); continue; }
    if (excel === null) { if (vals.APR||vals.RMS||vals.PRS) unmatched.push({name:opName,...vals}); continue; }
    excelData[excel] = vals;
  }
  let mappedAPR=0,mappedRMS=0,mappedPRS=0,active=0;
  const rows = [];
  EXCEL_COUNTRIES.forEach(c => {
    const v = excelData[c] || {APR:0,RMS:0,PRS:0,APRLY:0,RMSLY:0,PRSLY:0};
    rows.push(v); mappedAPR+=v.APR; mappedRMS+=v.RMS; mappedPRS+=v.PRS;
    if (v.APR||v.RMS||v.PRS) active++;
  });
  if (!grandAPR) grandAPR=mappedAPR; if (!grandRMS) grandRMS=mappedRMS; if (!grandPRS) grandPRS=mappedPRS;
  const gapAPR=grandAPR-mappedAPR, gapRMS=grandRMS-mappedRMS, gapPRS=grandPRS-mappedPRS;
  const z = n => n === 0 ? '' : n;

  // Store rows + unknown totals for optional UAE merge (toggled by checkbox)
  const unkTotals = unknowns.reduce((a,u)=>({APR:a.APR+u.APR,RMS:a.RMS+u.RMS,PRS:a.PRS+u.PRS}),{APR:0,RMS:0,PRS:0});
  window._natRows = rows; window._natUnkTotals = unkTotals;
  const uaeIdx = EXCEL_COUNTRIES.indexOf('United Arab Emirates');
  function buildNatCopy() {
    const mergeUnk = document.getElementById('mergeUnkChk') && document.getElementById('mergeUnkChk').checked;
    return window._natRows.map((v,i) => {
      let apr=v.APR, rms=v.RMS, prs=v.PRS;
      if (mergeUnk && i === uaeIdx) { apr+=window._natUnkTotals.APR; rms+=window._natUnkTotals.RMS; prs+=window._natUnkTotals.PRS; }
      return z(apr)+'\t'+z(rms)+'\t'+z(prs);
    }).join('\n');
  }
  window._buildNatCopy = buildNatCopy;
  natCopyText = buildNatCopy();

  // F1: Show auto-detected report month
  const monthLabel = window._natReportMonth || '';
  const mlEl = document.getElementById('natMonthLabel');
  if (mlEl) { mlEl.textContent = monthLabel ? '📅 ' + monthLabel : ''; mlEl.style.display = monthLabel ? 'block' : 'none'; }

  // F4: Sync nationality totals to handover app via localStorage
  try {
    localStorage.setItem('ibis_nat_sync', JSON.stringify({
      month: monthLabel,
      grandAPR, grandRMS, grandPRS,
      mappedAPR, mappedRMS, mappedPRS,
      active,
      ts: new Date().toISOString()
    }));
  } catch(e) {}

  ['kpi-apr','kpi-rms','kpi-prs'].forEach((id,i) => { const el=document.getElementById(id); if(el) el.textContent=[grandAPR,grandRMS,grandPRS][i].toLocaleString(); });

  const aS = (type,ico,title,sub) => `<div style="display:flex;gap:9px;padding:9px 12px;border-radius:var(--r);margin-bottom:5px;background:${type==='ok'?'rgba(62,207,142,0.04)':type==='warn'?'rgba(240,164,58,0.05)':'rgba(240,107,122,0.05)'};border:1px solid ${type==='ok'?'rgba(62,207,142,0.12)':type==='warn'?'rgba(240,164,58,0.18)':'rgba(240,107,122,0.18)'};border-left:3px solid ${type==='ok'?'var(--mint)':type==='warn'?'var(--amber)':'var(--rose)'}"><span>${ico}</span><div><strong style="font-size:0.76rem;color:var(--text);display:block;">${escapeHtml(title)}</strong><span style="font-family:var(--mono);font-size:0.62rem;color:var(--text3);">${escapeHtml(sub)}</span></div></div>`;

  document.getElementById('natTotalsGrid').innerHTML = ['apr','rms','prs'].map((_,ki) => {
    const op=[grandAPR,grandRMS,grandPRS][ki]; const mp=[mappedAPR,mappedRMS,mappedPRS][ki]; const gp=[gapAPR,gapRMS,gapPRS][ki];
    const lbl=['New Arrivals','Room Nights','Guest Nights'][ki];
    return `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:11px 13px;"><div style="font-family:var(--mono);font-size:0.56rem;letter-spacing:1px;text-transform:uppercase;color:var(--text3);margin-bottom:7px;padding-bottom:5px;border-bottom:1px solid var(--border);">${lbl}</div><div style="display:flex;justify-content:space-between;padding:3px 0;font-size:0.72rem;"><span style="color:var(--text3);">Opera</span><span style="font-family:var(--mono);">${op.toLocaleString()}</span></div><div style="display:flex;justify-content:space-between;padding:3px 0;font-size:0.72rem;"><span style="color:var(--text3);">Placed</span><span style="font-family:var(--mono);color:var(--text2);">${mp.toLocaleString()}</span></div><div style="display:flex;justify-content:space-between;padding:3px 0;font-size:0.72rem;"><span style="color:var(--text3);">Gap</span><span style="font-family:var(--mono);color:${gp>0?'var(--amber)':'var(--mint)'};">${gp>0?'−'+gp:'✓ 0'}</span></div></div>`;
  }).join('');
  const unkListHTML = unknowns.length===0 ? aS('ok','✅','No unknown guests','Perfect.') : unknowns.map(u=>aS('warn','⚠️',`"${escapeHtml(u.name)}" — ${u.APR} arrivals`,'No nationality code.')).join('');
  const mergeChkHTML = unknowns.length > 0 ? `<label style="display:flex;align-items:center;gap:8px;margin-top:8px;padding:9px 12px;border-radius:var(--r);background:rgba(90,180,232,0.05);border:1px solid rgba(90,180,232,0.15);cursor:pointer;font-size:0.72rem;color:var(--text2);user-select:none;"><input type="checkbox" id="mergeUnkChk" style="accent-color:var(--sky);width:14px;height:14px;cursor:pointer;" onchange="natCopyText=window._buildNatCopy&&window._buildNatCopy();window._renderNatPreview&&window._renderNatPreview();"> Merge unknown nationality into <strong style="color:var(--sky);margin-left:3px;">United Arab Emirates</strong></label>` : '';
  document.getElementById('natUnknownList').innerHTML = unkListHTML + mergeChkHTML;
  document.getElementById('natUnmatchedList').innerHTML = unmatched.length===0 ? aS('ok','✅','All countries matched','No data lost.') : unmatched.map(u=>aS('error','🔴',`"${escapeHtml(u.name)}" — NOT PLACED`,'Country has no Excel row.')).join('');
  const badge = document.getElementById('natDiagBadge'); const hasIssues = unknowns.length>0||unmatched.length>0;
  if (badge) { badge.style.color = hasIssues?'var(--amber)':'var(--mint)'; badge.textContent = hasIssues?`${unknowns.length} unk · ${unmatched.length} unmatched`:'✓ Clean'; }
  ['gap-apr','gap-rms','gap-prs'].forEach((id,i)=>{const el=document.getElementById(id);if(el)el.textContent=[gapAPR,gapRMS,gapPRS][i]>0?'−'+[gapAPR,gapRMS,gapPRS][i]:'0';});
  ['s-active','s-zero','s-unmat','s-unk'].forEach((id,i)=>{const el=document.getElementById(id);if(el)el.textContent=[active,240-active,unmatched.length,unknowns.length][i];});
  const hasLY = rows.some(v => v.APRLY || v.RMSLY || v.PRSLY);
  const pctStr = (cur, ly) => {
    if (!ly) return '';
    const d = ((cur - ly) / ly * 100);
    const clr = d >= 0 ? 'var(--mint)' : 'var(--rose)';
    return `<span style="font-family:var(--mono);font-size:0.54rem;color:${clr};margin-left:3px;">${d>=0?'+':''}${d.toFixed(0)}%</span>`;
  };
  // Store on window so renderNatPreview can access after processNat finishes
  window._natHasLY = hasLY;
  window._natPctStr = pctStr;
  window._natRows = rows;
  window._natUnkTotals = unkTotals;

  function renderNatPreview() {
    const merge = document.getElementById('mergeUnkChk') && document.getElementById('mergeUnkChk').checked;
    const q = (window._natSearchQ || '').toLowerCase().trim();
    const uaeRow = merge ? {
      APR:   rows[uaeIdx].APR   + window._natUnkTotals.APR,
      RMS:   rows[uaeIdx].RMS   + window._natUnkTotals.RMS,
      PRS:   rows[uaeIdx].PRS   + window._natUnkTotals.PRS,
      APRLY: rows[uaeIdx].APRLY, RMSLY: rows[uaeIdx].RMSLY, PRSLY: rows[uaeIdx].PRSLY
    } : null;
    // Sync header columns
    const prevHdr = document.getElementById('natPreviewHeader');
    if (prevHdr) {
      prevHdr.style.gridTemplateColumns = hasLY ? '36px 1fr 54px 54px 54px 54px' : '36px 1fr 54px 54px 54px';
      if (hasLY) prevHdr.innerHTML = '<span style="font-family:var(--mono);font-size:0.53rem;color:var(--text3);">ROW</span><span style="font-family:var(--mono);font-size:0.53rem;color:var(--text3);">NATIONALITY</span><span style="font-family:var(--mono);font-size:0.53rem;color:var(--sky);text-align:right;">ARR</span><span style="font-family:var(--mono);font-size:0.53rem;color:var(--gold);text-align:right;">RMS</span><span style="font-family:var(--mono);font-size:0.53rem;color:var(--mint);text-align:right;">GST</span><span style="font-family:var(--mono);font-size:0.53rem;color:var(--text3);text-align:right;">vs LY</span>';
    }
    const cols = hasLY ? '36px 1fr 54px 54px 54px 54px' : '36px 1fr 54px 54px 54px';
    document.getElementById('natPreview').innerHTML = EXCEL_COUNTRIES.map((c,i) => {
      if (q && !c.toLowerCase().includes(q)) return '';
      const v = (merge && i === uaeIdx) ? uaeRow : rows[i];
      const rn=i+8; const has=v.APR||v.RMS||v.PRS; const sn=c.length>22?c.substring(0,21)+'…':c;
      const lyBadge = hasLY && has ? pctStr(v.APR, v.APRLY) : '';
      const uaeHL = (merge && i === uaeIdx) ? 'background:rgba(90,180,232,0.08);' : (has ? 'background:rgba(90,180,232,0.03);' : '');
      return `<div style="display:grid;grid-template-columns:${cols};padding:3px 12px;border-bottom:1px solid rgba(255,255,255,0.02);${uaeHL}"><span style="font-family:var(--mono);font-size:0.58rem;color:var(--text3);">${rn}</span><span style="font-size:0.68rem;color:${has?'var(--text2)':'var(--text3)'};" title="${c}">${sn}</span><span style="font-family:var(--mono);font-size:0.7rem;text-align:right;color:${has?'var(--sky)':'var(--border2)'};">${v.APR||''}</span><span style="font-family:var(--mono);font-size:0.7rem;text-align:right;color:${has?'var(--gold)':'var(--border2)'};">${v.RMS||''}</span><span style="font-family:var(--mono);font-size:0.7rem;text-align:right;color:${has?'var(--mint)':'var(--border2)'};">${v.PRS||''}</span>${hasLY?`<span style="text-align:right;">${lyBadge}</span>`:''}</div>`;
    }).join('');
  }
  window._renderNatPreview = renderNatPreview;
  renderNatPreview();
  // The Opera how-to for this report is written directly into index.html,
  // so the copy that used to be injected here was dead — it targeted an
  // element that has never existed and would only have duplicated it.

  document.getElementById('natResults').style.display = 'block';
}
function natFilterPreview(q) {
  if (!window._renderNatPreview) return;
  window._natSearchQ = q.toLowerCase().trim();
  window._renderNatPreview();
}

function copyNat()  { if (window._buildNatCopy) natCopyText = window._buildNatCopy(); if (!natCopyText) return; copyToClipboard(natCopyText, document.getElementById('natCopyBtn'), 'Copy All 240 Rows'); }
function clearNat() { document.getElementById('natInput').value=''; document.getElementById('natResults').style.display='none'; document.getElementById('natError').classList.remove('show'); natCopyText=''; try { localStorage.removeItem('ibis_nat_paste'); } catch(e){} }

// ── RENTED ROOMS & BEDS ───────────────────────────────────
function parseHF(raw) {
  const lines=raw.trim().split('\n'); if(lines.length<2)return null;
  const idx={}; lines[0].split('\t').forEach((h,i)=>{idx[h.trim()]=i;});
  if(idx['NO_ROOMS']===undefined||idx['CONSIDERED_DATE']===undefined)return null;
  const out={};
  for(let i=1;i<lines.length;i++){const p=lines[i].split('\t');if(p.length<30)continue;const ds=(p[idx['CONSIDERED_DATE']]||'').trim();if(!ds||!ds[0].match(/\d/))continue;const day=parseInt(ds.split('-')[0]);const rooms=parseInt(p[idx['NO_ROOMS']])||0;if(day>=1&&day<=31)out[day]=rooms;}
  return Object.keys(out).length>0?out:null;
}
function parseSRT(raw) {
  const lines=raw.trim().split('\n'); if(lines.length<2)return null;
  const idx={}; lines[0].split('\t').forEach((h,i)=>{idx[h.trim()]=i;});
  if(idx['STAY_ROOMS']===undefined||idx['BUSINESS_DATE']===undefined)return null;
  const out={};
  for(let i=1;i<lines.length;i++){const p=lines[i].split('\t');if(p.length<5)continue;const ds=(p[idx['BUSINESS_DATE']]||'').trim();if(!ds||!ds[0].match(/\d/))continue;const day=parseInt(ds.split('-')[0]);const rooms=parseInt(p[idx['STAY_ROOMS']])||0;if(day>=1&&day<=31)out[day]=rooms;}
  return Object.keys(out).length>0?out:null;
}
function processRent() {
  const r1=document.getElementById('rentInput1').value.trim(), r2=document.getElementById('rentInput2').value.trim();
  const errBox=document.getElementById('rentError'); errBox.classList.remove('show');
  const showErr=msg=>{document.getElementById('rentErrorMsg').textContent=msg;errBox.classList.add('show');};
  if(!r1||!r2)return showErr('Paste both files first.');
  const isHF=t=>t.includes('NO_ROOMS')&&t.includes('CONSIDERED_DATE');
  const isSRT=t=>t.includes('STAY_ROOMS')&&t.includes('BUSINESS_DATE');
  let hfRaw=null,stRaw=null;
  if(isHF(r1)&&isSRT(r2)){hfRaw=r1;stRaw=r2;}else if(isHF(r2)&&isSRT(r1)){hfRaw=r2;stRaw=r1;}else if(isHF(r1)){hfRaw=r1;}else if(isHF(r2)){hfRaw=r2;}else return showErr('Could not detect files.');
  const hfData=parseHF(hfRaw); if(!hfData)return showErr('Could not read History Forecast.');
  const stData=stRaw?parseSRT(stRaw):{};
  const days=Math.max(...Object.keys(hfData).map(Number));
  let totalRooms=0,totalBeds=0; const rows=[];
  for(let d=1;d<=days;d++){const rm=hfData[d]||0;const twin=stData?(stData[d]||0):0;const beds=rm+twin;rows.push({day:d,rooms:rm,beds,twin});totalRooms+=rm;totalBeds+=beds;}
  rentCopyText=rows.map(r=>r.rooms+'\t'+r.beds).join('\n');
  document.getElementById('kpi-rooms').textContent=totalRooms.toLocaleString();
  document.getElementById('kpi-beds').textContent=totalBeds.toLocaleString();
  document.getElementById('daysFound').textContent=days+' days';
  document.getElementById('twinStatus').textContent=stRaw?'✓ Connected':'⚠ Not provided';
  document.getElementById('rs-rooms').textContent=totalRooms.toLocaleString();
  document.getElementById('rs-beds').textContent=totalBeds.toLocaleString();
  document.getElementById('rs-days').textContent=days;
  document.getElementById('rentRowCount').textContent=days+' ROWS';
  document.getElementById('rentPreview').innerHTML=rows.map(r=>{const has=r.rooms>0;return`<div style="display:grid;grid-template-columns:56px 1fr 66px 66px;padding:4px 14px;border-bottom:1px solid rgba(255,255,255,0.02);${has?'background:rgba(62,207,142,0.02)':''}"><span style="font-family:var(--mono);font-size:0.6rem;color:${has?'var(--sky2)':'var(--text3)'};">Day ${r.day}</span><span style="font-family:var(--mono);font-size:0.58rem;color:var(--text3);">+${r.twin}</span><span style="font-family:var(--mono);font-size:0.7rem;text-align:right;color:${has?'var(--sky)':'var(--border2)'};">${r.rooms}</span><span style="font-family:var(--mono);font-size:0.7rem;text-align:right;color:${has?'var(--mint)':'var(--border2)'};">${r.beds}</span></div>`;}).join('');
  document.getElementById('rentResults').style.display='block';
}
function copyRent()  { if(!rentCopyText)return; copyToClipboard(rentCopyText,document.getElementById('rentCopyBtn'),'Copy All Rows'); }
function clearRent() { document.getElementById('rentInput1').value=''; document.getElementById('rentInput2').value=''; document.getElementById('rentResults').style.display='none'; document.getElementById('rentError').classList.remove('show'); rentCopyText=''; }

// ── NIGHT AUDIT PM ROOMS ──────────────────────────────────
function parseOperaPM(raw) {
  const lines=raw.trim().split('\n'); if(lines.length<2)return null;
  const hdrs=lines[0].split('\t').map(h=>h.trim()); const idx={};hdrs.forEach((h,i)=>{idx[h]=i;});if(idx['ROOM']===undefined)return null;
  const rooms=[];
  for(let i=1;i<lines.length;i++){const p=lines[i].split('\t');if(p.length<6)continue;const cat=(p[idx['ROOM_CATEGORY_LABEL']]||'').trim();if(cat!=='PM')continue;const room=(p[idx['ROOM']]||'').trim();if(!room||isNaN(parseInt(room)))continue;rooms.push({room:parseInt(room),name:(p[idx['FULL_NAME']]||'').trim(),arrival:parseOperaDate(p[idx['ARRIVAL']]||''),departure:parseOperaDate(p[idx['DEPARTURE']]||''),balance:parseBalance(p[idx['BALANCE']]||'0')});}
  return rooms.length>0?rooms:null;
}
function parseExcelPM(raw) {
  const lines=raw.trim().split('\n').filter(l=>l.trim()); if(lines.length<2)return null;
  const sep=lines[0].includes('\t')?'\t':',';
  const parse=line=>{if(sep===','){const res=[];let cur='',inQ=false;for(let c of line){if(c==='"')inQ=!inQ;else if(c===','&&!inQ){res.push(cur.trim());cur='';}else cur+=c;}res.push(cur.trim());return res;}return line.split('\t').map(c=>c.trim());};
  const hdrs=parse(lines[0]).map(h=>h.replace(/"/g,'').trim().toUpperCase());
  const rI=hdrs.findIndex(h=>h==='PM'||h==='ROOM'),nI=hdrs.findIndex(h=>h==='NAME'),aI=hdrs.findIndex(h=>h==='ARRIVAL'),dI=hdrs.findIndex(h=>h==='DEPARTURE'),bI=hdrs.findIndex(h=>h==='BALANCE'),depI=hdrs.findIndex(h=>h.includes('DEPT')),remI=hdrs.findIndex(h=>h.includes('REMARK'));
  if(rI===-1||nI===-1)return null;
  const rows=[];
  for(let i=1;i<lines.length;i++){const p=parse(lines[i]);const rr=(p[rI]||'').replace(/"/g,'').trim();if(!rr||isNaN(parseInt(rr)))continue;rows.push({room:parseInt(rr),name:(p[nI]||'').replace(/"/g,'').trim(),arrival:parseExcelDate((p[aI]||'').replace(/"/g,'').trim()),departure:parseExcelDate((p[dI]||'').replace(/"/g,'').trim()),balance:parseBalance((p[bI]||'0').replace(/"/g,'').trim()),dept:depI>=0?(p[depI]||'').replace(/"/g,'').trim():'',remarks:remI>=0?(p[remI]||'').replace(/"/g,'').trim():''});}
  return rows.length>0?rows:null;
}
function processAudit() {
  const rawO=document.getElementById('naOperaInput').value.trim(), rawE=document.getElementById('naExcelInput').value.trim();
  const errBox=document.getElementById('naError'); errBox.classList.remove('show');
  const showErr=msg=>{document.getElementById('naErrorMsg').textContent=msg;errBox.classList.add('show');};
  if(!rawO)return showErr('Paste Opera PM rooms report.'); if(!rawE)return showErr('Paste management Excel report.');
  const oRooms=parseOperaPM(rawO); if(!oRooms)return showErr('Could not read Opera file.');
  const eRows=parseExcelPM(rawE);  if(!eRows) return showErr('Could not read Excel report.');
  const eMap={}; eRows.forEach(r=>{eMap[r.room]=r;});
  const diffs=[],fixed=[],missing=[],changes=[];
  oRooms.forEach(op=>{
    const ex=eMap[op.room];
    if(!ex){missing.push(op);fixed.push({...op,dept:'',remarks:'',wasFixed:false,wasMissing:true,fieldDiffs:[]});return;}
    const fd=[];
    if(op.name.toLowerCase().replace(/[.,\s]/g,'')!==ex.name.toLowerCase().replace(/[.,\s]/g,''))fd.push({field:'Name',opera:op.name,excel:ex.name});
    if(!sameDate(op.arrival,ex.arrival))fd.push({field:'Arrival',opera:fmtDate(op.arrival),excel:fmtDate(ex.arrival)});
    if(!sameDate(op.departure,ex.departure))fd.push({field:'Departure',opera:fmtDate(op.departure),excel:fmtDate(ex.departure)});
    if(Math.abs(op.balance-ex.balance)>0.005)fd.push({field:'Balance',opera:fmtBalance(op.balance),excel:fmtBalance(ex.balance)});
    const hasDiff=fd.length>0;
    diffs.push({op,ex,fd,hasDiff});
    fixed.push({room:op.room,name:op.name,arrival:op.arrival,departure:op.departure,balance:op.balance,dept:ex.dept,remarks:ex.remarks,wasFixed:hasDiff,wasMissing:false,fieldDiffs:fd});
    if(hasDiff)changes.push({room:op.room,fd});
  });
  const total=oRooms.length, diffC=diffs.filter(d=>d.hasDiff).length+missing.length, okC=total-diffC;
  document.getElementById('na-kpi-total').textContent=total; document.getElementById('na-kpi-diff').textContent=diffC; document.getElementById('na-kpi-ok').textContent=okC;
  document.getElementById('na-pill-total').textContent=total+' rooms'; document.getElementById('na-pill-diff').textContent=diffC+' diffs'; document.getElementById('na-pill-ok').textContent=okC+' match';
  document.getElementById('naTabCount').textContent=diffC>0?(diffC+' fixes'):'✓ Clean';
  const mkF=(opV,exV,h)=>!h?`<span style="font-size:0.72rem;color:var(--text2);">${escapeHtml(opV)}</span>`:`<div><div style="font-size:0.72rem;color:var(--mint);font-weight:500;">${escapeHtml(opV)}</div><div style="font-size:0.68rem;color:var(--rose);text-decoration:line-through;opacity:0.7;">${escapeHtml(exV)}</div></div>`;
  document.getElementById('naCompareTable').innerHTML=diffs.map(({op,fd,hasDiff})=>{const fdm={};fd.forEach(f=>{fdm[f.field]=f;});return`<div style="display:grid;grid-template-columns:60px 1fr 1fr 1fr 1fr 80px;padding:8px 14px;border-bottom:1px solid rgba(255,255,255,0.025);${hasDiff?'background:rgba(240,164,58,0.04);border-left:3px solid var(--amber);':''}align-items:start;"><div style="font-family:var(--mono);font-size:0.76rem;color:var(--sky);font-weight:700;">${op.room}</div><div>${fdm['Name']?mkF(fdm['Name'].opera,fdm['Name'].excel,true):`<span style="font-size:0.72rem;color:var(--text2);">${escapeHtml(op.name)}</span>`}</div><div>${fdm['Arrival']?mkF(fdm['Arrival'].opera,fdm['Arrival'].excel,true):`<span style="font-size:0.72rem;color:var(--text2);">${fmtDate(op.arrival)}</span>`}</div><div>${fdm['Departure']?mkF(fdm['Departure'].opera,fdm['Departure'].excel,true):`<span style="font-size:0.72rem;color:var(--text2);">${fmtDate(op.departure)}</span>`}</div><div>${fdm['Balance']?mkF(fdm['Balance'].opera,fdm['Balance'].excel,true):`<span style="font-size:0.72rem;color:var(--text2);">${fmtBalance(op.balance)}</span>`}</div><div style="text-align:right;"><div style="width:8px;height:8px;border-radius:50%;background:${hasDiff?'var(--amber)':'var(--mint)'};margin-left:auto;margin-top:4px;"></div></div></div>`;}).join('')+missing.map(op=>`<div style="display:grid;grid-template-columns:60px 1fr 1fr 1fr 1fr 80px;padding:8px 14px;border-bottom:1px solid rgba(255,255,255,0.025);background:rgba(240,107,122,0.04);border-left:3px solid var(--rose);align-items:start;"><div style="font-family:var(--mono);font-size:0.76rem;color:var(--sky);font-weight:700;">${op.room}</div><div style="font-size:0.72rem;color:var(--mint);">${escapeHtml(op.name)}</div><div style="font-size:0.72rem;color:var(--mint);">${fmtDate(op.arrival)}</div><div style="font-size:0.72rem;color:var(--mint);">${fmtDate(op.departure)}</div><div style="font-size:0.72rem;color:var(--mint);">${fmtBalance(op.balance)}</div><div style="font-family:var(--mono);font-size:0.56rem;color:var(--rose);text-align:right;">NOT IN EXCEL</div></div>`).join('');
  document.getElementById('naFixedTable').innerHTML=fixed.map(r=>{const bc=r.balance>0?'var(--rose)':r.balance<0?'var(--sky)':'var(--text3)';return`<div style="display:grid;grid-template-columns:60px 1fr 100px 100px 100px;padding:7px 14px;border-bottom:1px solid rgba(255,255,255,0.025);align-items:center;${r.wasFixed?'background:rgba(62,207,142,0.03);border-left:3px solid var(--mint);':'border-left:3px solid transparent;'}"><span style="font-family:var(--mono);font-size:0.76rem;color:var(--sky);font-weight:700;">${r.room}</span><span style="font-size:0.73rem;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:6px;">${escapeHtml(r.name)}${r.wasFixed?'<span style="font-family:var(--mono);font-size:0.52rem;color:var(--mint);background:rgba(62,207,142,0.1);border:1px solid rgba(62,207,142,0.2);border-radius:4px;padding:1px 5px;margin-left:4px;">FIXED</span>':''}</span><span style="font-family:var(--mono);font-size:0.68rem;color:var(--text2);">${fmtDate(r.arrival)}</span><span style="font-family:var(--mono);font-size:0.68rem;color:var(--text2);">${fmtDate(r.departure)}</span><span style="font-family:var(--mono);font-size:0.68rem;color:${bc};text-align:right;">${fmtBalance(r.balance)}</span></div>`;}).join('');
  document.getElementById('naFixedCount').textContent=fixed.length+' rows';
  const cl=document.getElementById('naChangesList');
  if(cl){if(changes.length===0&&missing.length===0)cl.innerHTML='<div style="font-size:0.76rem;color:var(--mint);">✅ No changes needed.</div>';else cl.innerHTML=changes.map(c=>`<div style="margin-bottom:7px;padding:9px 11px;background:rgba(240,164,58,0.04);border:1px solid rgba(240,164,58,0.12);border-left:3px solid var(--amber);border-radius:var(--r);"><div style="font-family:var(--mono);font-size:0.68rem;color:var(--sky);font-weight:600;margin-bottom:3px;">Room ${c.room}</div>${c.fd.map(f=>`<div style="font-size:0.7rem;color:var(--text2);">${escapeHtml(f.field)}</div><div style="font-family:var(--mono);font-size:0.62rem;color:var(--rose);">✗ ${escapeHtml(f.excel)}</div><div style="font-family:var(--mono);font-size:0.62rem;color:var(--mint);">✓ ${escapeHtml(f.opera)}</div>`).join('')}</div>`).join('')+missing.map(op=>`<div style="margin-bottom:7px;padding:9px 11px;background:rgba(240,107,122,0.04);border:1px solid rgba(240,107,122,0.12);border-left:3px solid var(--rose);border-radius:var(--r);"><div style="font-family:var(--mono);font-size:0.68rem;color:var(--sky);">Room ${op.room}</div><div style="font-size:0.7rem;color:var(--text2);">Added from Opera</div></div>`).join('');}
  const mc=document.getElementById('naMissingCard');
  if(mc){if(missing.length>0){mc.style.display='block';document.getElementById('naMissingList').innerHTML=missing.map(op=>`<div style="margin-bottom:5px;padding:7px 9px;background:rgba(240,107,122,0.04);border:1px solid rgba(240,107,122,0.12);border-radius:var(--r);"><div style="font-family:var(--mono);font-size:0.68rem;color:var(--sky);">Room ${op.room}</div><div style="font-size:0.7rem;color:var(--mint);">${escapeHtml(op.name)}</div></div>`).join('');}else mc.style.display='none';}
  naCopyText=fixed.map(r=>[r.room,r.name,fmtDateExcel(r.arrival),fmtDateExcel(r.departure),r.balance,r.dept,r.remarks].join('\t')).join('\n');
  document.getElementById('naCompareSection').style.display='block';
}
function copyAudit()  { if(!naCopyText)return; copyToClipboard(naCopyText,document.getElementById('naCopyBtn'),'Copy All Fixed Rows'); }
function clearAudit() { document.getElementById('naOperaInput').value=''; document.getElementById('naExcelInput').value=''; document.getElementById('naCompareSection').style.display='none'; document.getElementById('naError').classList.remove('show'); document.getElementById('naTabCount').textContent='Compare'; naCopyText=''; }


// ── IMMIGRATION RECOVERY SOURCES ──────────────────────────
// Optional uploads that let processImmig2() auto-fill rows flagged
// "No Nationality" / "No Gender" / "No Passport" before they're shown to the user.
//   _immigNatMap      : normalised name → raw passport Nationality (from Inhouse XML)
//   _immigPassportMap : normalised name → DocumentNumber (from Inhouse XML — Emirates ID/passport #)
//   _immigGenderMap   : normalised name → 'M' | 'F' (derived from title in arrivals export)
//   _immigInhouseRoomGuests : normalised room → [{name, key}] — everyone the
//                             Inhouse XML says is actually registered in that
//                             room, used for the named missing-profile check.
let _immigNatMap      = {};
let _immigPassportMap = {};
let _immigGenderMap   = {};
let _immigInhouseRoomGuests = {};

// Title prefix → gender, as seen in Opera's "LASTNAME, FIRSTNAME, Title" name format.
const _IMMIG_TITLE_GENDER = {
  'MR': 'M', 'MR.': 'M',
  'MRS': 'F', 'MRS.': 'F',
  'MS': 'F', 'MS.': 'F',
  'MISS': 'F',
};

// Normalise a guest name into a stable lookup key: lowercase, letters only,
// spaces stripped. Both Inhouse.xml (GivenName+FamilyName) and the immigration
// report (FIRST_NAME+LAST_NAME) preserve "given name(s) then family name(s)"
// order, so a straight concatenation matches far more guests than sorting the
// words does — sorting only helps when word order is reversed, but breaks
// matches whenever one source has extra/missing middle names (common here).
function _normName(name) {
  if (!name) return '';
  return name.toLowerCase().replace(/[^a-z]/g, '');
}

// A valid UAE Emirates ID is a 15-digit number starting with "784"
// (format 784-YYYY-XXXXXXX-X). Anything else on DocumentNumber1 is a
// passport number — same rule arrivals-purpose.js uses for Origin of Travel.
function _immigIsEmiratesId(doc) {
  const d = String(doc || '').replace(/[\s-]/g, '');
  return /^784\d{12}$/.test(d);
}

// Parse an Inhouse.xml (Crystal Reports export) and return per-guest
// Nationality + DocumentNumber (passport/Emirates ID), keyed by normalised
// name — plus a per-room guest list, since this same export already has
// everyone's name AND room (RoomNumber1). The room list is used purely as a
// per-room HEADCOUNT for the missing-profile check (see
// _immigCheckMissingProfiles) — not for matching individual guests by name,
// since the same person is routinely spelled differently between this
// report and the immigration report (front desk's transliteration vs. the
// authority-facing one), which made name-matching throw false alarms on
// roughly half of all occupied rooms when tested against a real export.
function _immigParseInhouseXML(xmlText) {
  const natMap = {};
  const docMap = {};
  const roomMap = {}; // normRoom -> [{ name, key }]
  try {
    const doc = (new DOMParser()).parseFromString(xmlText, 'text/xml');
    if (doc.querySelector('parsererror')) return { natMap, docMap, roomMap };

    const blocks = doc.querySelectorAll('Details[Level="2"]');
    blocks.forEach(b => {
      const field = fieldName => {
        const el = b.querySelector(`Field[Name="${fieldName}"] FormattedValue`);
        return (el?.textContent || '').trim();
      };
      const given  = field('GivenName1');
      const family = field('FamilyName1');
      const nat    = field('Nationality1');
      const doc_   = field('DocumentNumber1');
      const room   = field('RoomNumber1');
      if (!given && !family) return;

      const name = (given + ' ' + family).trim();
      const key = _normName(name);
      if (!key) return;
      if (nat)  natMap[key] = nat;
      if (doc_) docMap[key] = doc_;
      if (room) {
        const rn = room.replace(/^0+/, '') || '0';
        (roomMap[rn] = roomMap[rn] || []).push({ name, key });
      }
    });
  } catch (e) {
    console.warn('[Immigration] _immigParseInhouseXML failed:', e);
  }
  return { natMap, docMap, roomMap };
}

// Load Inhouse.xml — provides Nationality + Passport/Doc Number for guests missing them on the immigration report.
function immigLoadInhouseXml(input) {
  const file = input?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const { natMap, docMap, roomMap } = _immigParseInhouseXML(e.target.result);
    _immigNatMap         = natMap || {};
    _immigPassportMap    = docMap || {};
    _immigInhouseRoomGuests = roomMap || {};
    const natCount = Object.keys(_immigNatMap).length;
    const docCount = Object.keys(_immigPassportMap).length;
    const roomCount = Object.keys(_immigInhouseRoomGuests).length;
    const lbl = document.getElementById('immigInhouseXmlLabel');
    if (lbl) lbl.textContent = natCount ? `✓ ${natCount} guests loaded (${docCount} with doc #, ${roomCount} rooms)` : 'No guest data found';
    showToast(natCount ? `✦ Inhouse XML loaded — ${natCount} guests, ${roomCount} rooms` : 'No guest data found in XML', natCount ? 'ok' : 'err');
    if (immigAllRows2.length) processImmig2(true); // re-run with raw XML already in the textarea
  };
  reader.readAsText(file, 'utf-8');
}

// Load an Opera arrivals export (.xls/.html/.csv/.txt) — provides Gender via the
// Mr./Mrs./Ms./Miss title prefix in the guest name column.
function immigLoadArrivals(input) {
  const file = input?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    let content = e.target.result;
    if (/<table/i.test(content) && typeof apExtractFromHtml === 'function') {
      content = apExtractFromHtml(content);
    }
    const lines = content.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim());
    if (lines.length < 2) { showToast('Could not read arrivals export', 'err'); return; }

    const delim = lines[0].includes('\t') ? '\t' : ',';
    const hdrs  = lines[0].split(delim).map(h => h.trim().toUpperCase());
    let nameIdx = hdrs.indexOf('NAME');
    if (nameIdx < 0) nameIdx = hdrs.findIndex(h => h.includes('FULL_NAME') || h.includes('GUEST NAME'));
    if (nameIdx < 0) { showToast('Could not find a Name column in arrivals export', 'err'); return; }

    const map = {};
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(delim);
      const raw  = (cols[nameIdx] || '').trim();
      if (!raw) continue;
      const parts = raw.split(',').map(p => p.trim()).filter(Boolean);
      if (parts.length < 2) continue;
      const titlePart = parts[parts.length - 1].toUpperCase();
      const gender = _IMMIG_TITLE_GENDER[titlePart];
      if (!gender) continue; // Dr., no title, etc. — can't determine
      const nameForKey = parseName(raw); // "GIVEN FAMILY", title stripped
      map[_normName(nameForKey)] = gender;
    }

    _immigGenderMap = map;
    const count = Object.keys(map).length;
    const lbl = document.getElementById('immigArrivalsLabel');
    if (lbl) lbl.textContent = count ? `✓ ${count} guests loaded` : 'No titles found';
    showToast(count ? `✦ Arrivals export loaded — ${count} guests` : 'No usable Mr./Mrs./Ms. titles found', count ? 'ok' : 'err');
    if (immigAllRows2.length) processImmig2(true);
  };
  reader.readAsText(file, 'utf-8');
}

// Attach a *suggested* Nationality / Gender / Passport value (to type into Opera)
// on flagged rows, based on the recovery maps above. This does NOT clear the
// issue — Opera itself still has the field blank, so the row stays flagged
// until a colleague actually updates the guest profile in Opera.
//
// Gender has two tiers of confidence:
//   r.suggestedSex — from an actual Mr./Mrs./Ms. title in the arrivals export.
//                     Reliable (a human wrote that title on the booking).
//   r.guessedSex   — from guessGender() matching the guest's first name against
//                     a name dictionary. This is a heuristic ONLY — no title,
//                     no ID, nothing authoritative behind it. Inhouse.xml has
//                     no gender/title field of any kind, so this is the best
//                     available fallback, but it must always be shown to staff
//                     as "guess, verify manually" — never as a resolved fact.
function _immigApplyRecovery(rows) {
  rows.forEach(r => {
    const key = _normName(r.name);

    if (r.noNat && _immigNatMap[key]) {
      r.suggestedNat = _immigNatMap[key];
    }
    if (r.noSex) {
      if (_immigGenderMap[key]) {
        r.suggestedSex = _immigGenderMap[key];
      } else if (typeof guessGender === 'function') {
        const firstName = (r.name || '').trim().split(/\s+/)[0];
        const g = guessGender(firstName);
        if (g) r.guessedSex = g;
      }
    }
    if (r.noPass && _immigPassportMap[key]) {
      r.suggestedPassport = _immigPassportMap[key];
    }
  });
}

// ── Reservation Detail (or Guest In-House By Room) — cross-checks the
// immigration report's per-room headcount against what Opera says is
// actually booked/occupying that room (ADULTS). Fallback source when the
// Inhouse XML above doesn't cover a room — see _immigCheckMissingProfiles
// for why this compares COUNTS rather than trying to match by name.
let _immigResRooms = {}; // norm room -> { adults, names:[] }

function _immigParseResDetail(raw) {
  const lines = raw.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim());
  if (lines.length < 2) return null;
  const hdrs = lines[0].split('\t').map(h => h.trim().toUpperCase());
  // ROOM_NO tried before the bare "ROOM" — Reservation Detail also has
  // DISP_ROOM_NO (usually blank pre-check-in) earlier in the column order,
  // which would otherwise win a plain substring match on "ROOM".
  const iRoom  = hdrs.indexOf('ROOM_NO') >= 0 ? hdrs.indexOf('ROOM_NO') : hdrs.indexOf('ROOM');
  const iAdult = hdrs.indexOf('ADULTS');
  const iConf  = hdrs.indexOf('CONFIRMATION_NO');
  const iName  = hdrs.indexOf('FULL_NAME');
  if (iRoom < 0 || iAdult < 0) return null;

  const rooms = {};
  const seenConf = new Set(); // dedupe multi-row reservations (one row per ID/membership record on file) — Guest In-House By Room has no CONFIRMATION_NO column, so this is simply skipped for that format
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    if (iConf >= 0) {
      const conf = (cols[iConf] || '').trim();
      if (conf) { if (seenConf.has(conf)) continue; seenConf.add(conf); }
    }
    const room = (cols[iRoom] || '').trim();
    if (!room) continue; // not checked in / no room assigned yet — nothing to cross-check
    const rn = room.replace(/^0+/, '') || '0';
    const adults = parseInt(cols[iAdult]) || 0;
    const name   = iName >= 0 ? (cols[iName] || '').trim() : '';
    if (!rooms[rn]) rooms[rn] = { adults: 0, names: [] };
    rooms[rn].adults += adults;
    if (name) rooms[rn].names.push(typeof parseName === 'function' ? parseName(name) : name);
  }
  return rooms;
}

function immigLoadResDetail(input) {
  const file = input?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const parsed = _immigParseResDetail(e.target.result);
    if (!parsed) { showToast('Could not read Reservation Detail — check ROOM_NO and ADULTS columns are present', 'err'); return; }
    _immigResRooms = parsed;
    const roomCount = Object.keys(parsed).length;
    const lbl = document.getElementById('immigResDetailLabel');
    if (lbl) lbl.textContent = roomCount ? `✓ ${roomCount} rooms with an assigned room number` : 'No assigned rooms found';
    showToast(roomCount ? `✦ Reservation Detail loaded — ${roomCount} rooms` : 'No rooms with ROOM_NO assigned in this export', roomCount ? 'ok' : 'err');
    if (immigAllRows2.length) processImmig2(true);
  };
  reader.readAsText(file, 'utf-8');
}

// Finds rooms where MORE people are registered elsewhere than have an
// immigration record today — the "missing profile" case. Uses the full
// unfiltered guest list (not immigAllRows2, which only holds guests already
// flagged for some OTHER field) so a room where everyone's nationality/
// passport/gender/email is filled in correctly can still be caught if one
// person from that room simply never got an immigration record filed.
//
// This is COUNT-based, not name-based — an earlier version tried matching
// guests by name between the Inhouse XML and the immigration report, but
// the same person is routinely spelled differently between the two systems
// (front desk's "Khalid Abdullah" vs the authority-facing report's
// "Khaled Alhudithy" for the same guest), which threw false "missing"
// alarms on roughly half of all occupied rooms when tested against a real
// export. A plain headcount comparison isn't fooled by spelling — verified
// against the same real data: it flags 25 rooms with a genuine gap instead
// of ~40+ false positives. The room's registered names are still shown as
// context (who to check against today's report), not asserted as THE
// missing person, since we can't reliably tell which one that is.
//
// Two sources, checked in priority order per room:
//   1) Inhouse XML (_immigInhouseRoomGuests) — PRIMARY, since it only ever
//      lists people already checked in (no pre-arrival blank-room gap).
//   2) Reservation Detail (_immigResRooms) — fallback, for rooms the
//      Inhouse XML upload doesn't cover (or wasn't uploaded).
function _immigCheckMissingProfiles(allGuests) {
  const countByRoom = {};
  allGuests.forEach(g => {
    const rn = (g.room || '').replace(/^0+/, '') || '0';
    countByRoom[rn] = (countByRoom[rn] || 0) + 1;
  });

  const flagged = [];
  const flaggedRooms = new Set();

  Object.entries(_immigInhouseRoomGuests).forEach(([room, guests]) => {
    const found = countByRoom[room] || 0;
    if (guests.length > found) {
      // Best-effort: which of THIS ROOM's guests has no immigration profile?
      // Safe to name-match here (unlike the global match this file avoids
      // elsewhere) because the comparison set is just this one room's 1-4
      // people, not the whole hotel — a spelling mismatch is easy for staff
      // to spot and confirm at that scale, where matching across hundreds
      // of guests produced ~50 false positives when it was tried.
      const immigNamesInRoom = new Set(
        allGuests.filter(g => (g.room || '').replace(/^0+/, '') === room).map(g => _normName(g.fullName))
      );
      const likelyMissing = guests
        .filter(g => !immigNamesInRoom.has(g.key))
        .map(g => {
          const doc = _immigPassportMap[g.key] || '';
          return { name: g.name, nat: _immigNatMap[g.key] || '', doc, docType: doc ? (_immigIsEmiratesId(doc) ? 'Emirates ID' : 'Passport') : '' };
        });
      flagged.push({ room, source: 'inhouse', expected: guests.length, found, gap: guests.length - found, names: guests.map(g => g.name), likelyMissing });
      flaggedRooms.add(room);
    }
  });

  Object.entries(_immigResRooms).forEach(([room, res]) => {
    if (flaggedRooms.has(room)) return; // already caught via Inhouse XML above
    const found = countByRoom[room] || 0;
    if (res.adults > found) {
      flagged.push({ room, source: 'resdetail', expected: res.adults, found, gap: res.adults - found, names: res.names });
    }
  });

  flagged.sort((a, b) => a.room.localeCompare(b.room, undefined, { numeric: true }));
  return flagged;
}

function immigLoadFile2(input) {
  if(!input.files[0])return;
  const reader=new FileReader();
  reader.onload=e=>{document.getElementById('immigPasteInput2').value=e.target.result;processImmig2();};
  reader.readAsText(input.files[0]);
}

function processImmig2(silent) {
  const raw=document.getElementById('immigPasteInput2').value.trim();
  const errBox=document.getElementById('immigError2'); errBox.classList.remove('show');
  const showErr=m=>{document.getElementById('immigErrorMsg2').textContent=m;errBox.classList.add('show');};
  if(!raw)return showErr('Upload or paste XML.');
  if(!raw.includes('<G_IMMIGRATION>'))return showErr('Not an Opera immigration XML.');
  const doc=(new DOMParser()).parseFromString(raw,'text/xml');
  if(doc.querySelector('parsererror'))return showErr('XML parse error.');
  const hotel=doc.querySelector('P_RESORT1')?.textContent?.trim()||'Hotel';
  const bizStr=doc.querySelector('P_BUSINESS_DATE')?.textContent?.trim()||'';
  const rDate=doc.querySelector('P_DATE')?.textContent?.trim()||'';
  const rTime=doc.querySelector('P_TIME')?.textContent?.trim()||'';
  let bizDate=null; if(bizStr){const d=new Date(bizStr.split('T')[0]);if(!isNaN(d))bizDate=d;}
  const get=(el,tag)=>(el.querySelector(tag)?.textContent||'').trim();
  const guests=[...doc.querySelectorAll('G_IMMIGRATION')].map(el=>({fname:get(el,'FIRST_NAME'),lname:get(el,'LAST_NAME'),sex:get(el,'SEX'),nat:get(el,'NATIONALITY'),passport:get(el,'PASSPORT'),arrival:get(el,'ARRIVAL_DATE'),departure:get(el,'DEPARTURE_DATE'),room:get(el,'ROOM')}));
  guests.forEach(g=>{ g.fullName=(g.fname?g.fname+' '+g.lname:g.lname).trim(); });
  const pd=s=>{if(!s)return null;const[m,d,y]=s.split('/');return m&&d&&y?new Date(parseInt(y),parseInt(m)-1,parseInt(d)):null;};
  const inHouseNow=g=>{const a=pd(g.arrival),d=pd(g.departure);return bizDate&&a&&d?(a<=bizDate&&d>bizDate):true;};
  const rows=[];
  guests.forEach(g=>{
    if(!inHouseNow(g))return;
    const noNat=!g.nat||['u','unknown',''].includes(g.nat.toLowerCase());
    const noSex=!g.sex||['u','unknown',''].includes(g.sex.toLowerCase());
    // Missing if blank, OR if the value has no digits at all — Opera masks real
    // passport numbers like "XXXXXXXXXXXXX08" (partial real number still visible),
    // but a value like "XXXXXXXFS" has zero digits, meaning no real number was
    // ever captured — that guest still needs a passport/doc number on file.
    const noPass=!g.passport||!/[0-9]/.test(g.passport); const noFname=!g.fname;
    // Email isn't a field the immigration report or any Opera export we've
    // seen carries at all — cross-check against Guest Memory instead, which
    // is already being filled in from Purpose of Stay / the Neorcha scraper.
    const gmEntry=typeof _gmStore!=='undefined'?_gmStore[gmKey(g.fullName)]:null;
    const noEmail=!gmEntry||!gmEntry.email;
    const issues=[];
    if(noNat)issues.push('nationality');if(noSex)issues.push('gender');if(noPass)issues.push('passport');if(noFname)issues.push('first_name');if(noEmail)issues.push('email');
    if(!issues.length)return;
    rows.push({room:g.room||'',name:g.fullName,sex:g.sex,nat:g.nat,passport:g.passport,email:gmEntry?.email||'',arrival:g.arrival,departure:g.departure,issues,noNat,noSex,noPass,noFname,noEmail,critical:noNat||noSex});
  });
  // Auto-fill Nationality / Gender from optional recovery sources (Inhouse XML / arrivals export)
  _immigApplyRecovery(rows);
  rows.sort((a,b)=>{if(a.critical&&!b.critical)return-1;if(!a.critical&&b.critical)return 1;return(a.room||'ZZZ').localeCompare(b.room||'ZZZ');});
  immigAllRows2=rows; immigFilter2_='all';
  const noNatC=rows.filter(r=>r.noNat).length,noSexC=rows.filter(r=>r.noSex).length,noPassC=rows.filter(r=>r.noPass).length,noFnameC=rows.filter(r=>r.noFname).length,noEmailC=rows.filter(r=>r.noEmail).length,crit=rows.filter(r=>r.critical).length;
  const sugNatC=rows.filter(r=>r.suggestedNat).length, sugSexC=rows.filter(r=>r.suggestedSex).length, sugPassC=rows.filter(r=>r.suggestedPassport).length;
  const guessSexC=rows.filter(r=>r.guessedSex).length;
  const inHouseGuests=guests.filter(inHouseNow);
  const ihTotal=inHouseGuests.length;
  // Reservation Detail cross-check — needs the FULL in-house list, not just
  // rows already flagged for some other missing field.
  immigMissingProfiles=(Object.keys(_immigInhouseRoomGuests).length||Object.keys(_immigResRooms).length)?_immigCheckMissingProfiles(inHouseGuests):[];
  immigRenderMissingProfiles();
  document.getElementById('immigKpis2').innerHTML=`<div class="kpi rose"><div class="kpi-accent"></div><div class="kpi-label">Critical</div><div class="kpi-val">${crit}</div><div class="kpi-sub">nat or gender</div></div><div class="kpi amber"><div class="kpi-accent"></div><div class="kpi-label">No Nationality</div><div class="kpi-val">${noNatC}</div></div><div class="kpi sky"><div class="kpi-accent"></div><div class="kpi-label">No Passport</div><div class="kpi-val">${noPassC}</div></div><div class="kpi mint"><div class="kpi-accent"></div><div class="kpi-label">No Gender</div><div class="kpi-val">${noSexC}</div></div><div class="kpi purple"><div class="kpi-accent"></div><div class="kpi-label">No Email</div><div class="kpi-val">${noEmailC}</div><div class="kpi-sub">checked vs Guest Memory</div></div>`;
  const sugTotal = sugNatC+sugSexC+sugPassC;
  const suggestNote = sugTotal ? ` · ✦ ${sugTotal} suggested value${sugTotal!==1?'s':''} to enter in Opera (${sugNatC} nationality, ${sugSexC} gender, ${sugPassC} passport)` : '';
  const guessNote = guessSexC ? ` · ❓ ${guessSexC} gender guess${guessSexC!==1?'es':''} from name — verify against ID before entering` : '';
  const metaEl=document.getElementById('immigMeta2'); if(metaEl)metaEl.textContent=hotel+' · '+rDate+' '+rTime+' · '+ihTotal+' in-house · '+rows.length+' issues'+suggestNote+guessNote;
  [['ifc-all',rows.length],['ifc-nat',noNatC],['ifc-gen',noSexC],['ifc-pass',noPassC],['ifc-fname',noFnameC],['ifc-email',noEmailC]].forEach(([id,v])=>{const el=document.getElementById(id);if(el)el.textContent=v;});
  document.getElementById('immigTabCount').textContent=crit>0?(crit+' critical'):(rows.length+' issues');
  document.querySelectorAll('#immigFilters2 .fchip').forEach(b=>b.classList.remove('on'));
  const allBtn=document.querySelector('#immigFilters2 [data-if="all"]'); if(allBtn)allBtn.classList.add('on');
  immigRender2(rows);
  document.getElementById('immigResults2').style.display='block';
  if(!silent && sugTotal) showToast(`✦ Found ${sugTotal} suggested value(s) to enter in Opera (${sugNatC} nationality, ${sugSexC} gender, ${sugPassC} passport)`, 'ok');
}

function immigRender2(rows) {
  const search=(document.getElementById('immigSearch2')?.value||'').toLowerCase();
  let filtered=rows;
  if(immigFilter2_!=='all')filtered=filtered.filter(r=>r.issues.includes(immigFilter2_));
  if(search)filtered=filtered.filter(r=>r.room.toLowerCase().includes(search)||r.name.toLowerCase().includes(search));
  const tbody=document.getElementById('immigTable2'); if(!tbody)return;
  if(!filtered.length){tbody.innerHTML='<tr><td colspan="9" style="text-align:center;padding:28px;font-family:var(--mono);font-size:0.7rem;color:var(--text3);">No matches.</td></tr>';return;}
  const sC=s=>!s||s.toUpperCase()==='U'?'var(--amber)':s.toUpperCase()==='M'?'var(--sky)':'var(--rose)';
  const tM={nationality:['var(--rose)','Nationality'],gender:['var(--amber)','Gender'],passport:['var(--sky)','Passport'],first_name:['var(--mint)','First Name'],email:['var(--purple)','Email']};
  const sugChip=(label)=>`<div style="font-family:var(--mono);font-size:0.56rem;color:var(--mint);margin-top:3px;white-space:nowrap;">→ suggest: <strong>${label}</strong><br>update in Opera</div>`;
  const guessChip=(label)=>`<div style="font-family:var(--mono);font-size:0.56rem;color:var(--amber);margin-top:3px;white-space:nowrap;">❓ guess: <strong>${label}</strong><br>(name-based — verify ID)</div>`;
  tbody.innerHTML=filtered.map(r=>{
    const tags=r.issues.map(i=>{const[c,l]=tM[i]||['var(--text3)',i];return`<span style="font-family:var(--mono);font-size:0.54rem;padding:2px 7px;border-radius:8px;border:1px solid;color:${c};border-color:${c}22;background:${c}11;">${l}</span>`;}).join(' ');
    const sexCell = r.noSex
      ? '<span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:5px;background:var(--amber)11;border:1px solid var(--amber)33;font-family:var(--mono);font-size:0.63rem;font-weight:700;color:var(--amber);">?</span>'+(r.suggestedSex?sugChip(r.suggestedSex):(r.guessedSex?guessChip(r.guessedSex):''))
      : `<span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:5px;background:${sC(r.sex)}11;border:1px solid ${sC(r.sex)}33;font-family:var(--mono);font-size:0.63rem;font-weight:700;color:${sC(r.sex)};">${r.sex}</span>`;
    const natCell = r.noNat
      ? '<span style="font-family:var(--mono);font-size:0.58rem;color:var(--rose);background:rgba(240,107,122,0.08);border:1px dashed rgba(240,107,122,0.4);border-radius:5px;padding:2px 7px;">NOT SET</span>'+(r.suggestedNat?sugChip(r.suggestedNat):'')
      : `<span style="font-size:0.7rem;color:var(--text2);">${escapeHtml(r.nat)}</span>`;
    const passCell = r.noPass
      ? '<span style="font-family:var(--mono);font-size:0.58rem;color:var(--sky);background:rgba(90,180,232,0.06);border:1px dashed rgba(90,180,232,0.3);border-radius:5px;padding:2px 7px;">MISSING</span>'+(r.suggestedPassport?sugChip(r.suggestedPassport):'')
      : '<span style="font-family:var(--mono);font-size:0.62rem;color:var(--text3);">'+escapeHtml(r.passport)+'</span>';
    const emailCell = r.noEmail
      ? '<span style="font-family:var(--mono);font-size:0.58rem;color:var(--purple);background:rgba(139,124,248,0.07);border:1px dashed rgba(139,124,248,0.35);border-radius:5px;padding:2px 7px;">NOT SET</span>'
      : `<span style="font-size:0.68rem;color:var(--text2);">${escapeHtml(r.email)}</span>`;
    return`<tr style="background:${r.noNat||r.noSex?'rgba(240,107,122,0.04)':r.noPass?'rgba(90,180,232,0.03)':'transparent'};border-left:${r.noNat||r.noSex?'3px solid var(--rose)':r.noPass?'3px solid var(--sky2)':'3px solid transparent'};"><td style="font-family:var(--mono);font-size:0.8rem;font-weight:700;color:var(--sky);">${r.room||'—'}</td><td>${sexCell}</td><td style="font-size:0.73rem;color:var(--text2);">${escapeHtml(r.name)}</td><td>${natCell}</td><td>${passCell}</td><td>${emailCell}</td><td style="font-family:var(--mono);font-size:0.6rem;color:var(--text3);">${r.arrival}</td><td style="font-family:var(--mono);font-size:0.6rem;color:var(--text3);">${r.departure}</td><td>${tags}</td></tr>`;
  }).join('');
}
function immigFilter2(type,btn){immigFilter2_=type;document.querySelectorAll('#immigFilters2 .fchip').forEach(b=>b.classList.remove('on'));btn.classList.add('on');immigRender2(immigAllRows2);}

// ── Reservation Detail missing-profile section — separate from the main
// per-guest table since a room-level headcount gap isn't tied to one
// specific person the way a blank nationality/passport field is. ──
function immigRenderMissingProfiles() {
  const wrap = document.getElementById('immigMissingWrap');
  if (!wrap) return;
  if (!immigMissingProfiles.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  const badge = document.getElementById('immigMissingBadge');
  if (badge) badge.textContent = immigMissingProfiles.length;
  const body = document.getElementById('immigMissingBody');
  if (body) body.innerHTML = immigMissingProfiles.map(f => {
    const sourceLabel = f.source === 'inhouse' ? 'Inhouse XML' : 'Reservation Detail';
    // Only trust the pinpointed guest(s) when the count lines up exactly with
    // the headcount gap — if it doesn't, the diff caught something odd (e.g.
    // a duplicate name in the room) and falling back to the full roster is
    // safer than pointing at the wrong person.
    const pinpointed = f.likelyMissing && f.likelyMissing.length === f.gap ? f.likelyMissing : null;
    const detailLine = pinpointed
      ? `Likely missing: ${pinpointed.map(g => {
          const bits = [g.nat ? escapeHtml(g.nat) : '', g.doc ? `${escapeHtml(g.docType)}: ${escapeHtml(g.doc)}` : ''].filter(Boolean).join(' · ');
          return `<strong>${escapeHtml(g.name)}</strong>${bits ? ` (${bits})` : ' — no nationality/doc # on file either, check Vicas'}`;
        }).join(', ')} — create their immigration profile in Opera with these details.`
      : `${sourceLabel} shows <strong>${f.expected}</strong> guest${f.expected!==1?'s':''} (${escapeHtml(f.names.join(', ') || 'no name on file')}) —
        only <strong>${f.found}</strong> found in today's immigration report. Check which of these isn't registered yet.`;
    return `
    <div class="log-row" style="border-left:3px solid var(--rose);padding-left:10px;">
      <span style="font-family:var(--mono);font-size:0.8rem;font-weight:700;color:var(--sky);min-width:50px;">${escapeHtml(f.room)}</span>
      <span style="font-size:0.74rem;color:var(--text2);flex:1;">${detailLine}</span>
    </div>`;
  }).join('');
}

function clearImmig(){document.getElementById('immigPasteInput2').value='';document.getElementById('immigResults2').style.display='none';document.getElementById('immigError2').classList.remove('show');document.getElementById('immigTabCount').textContent='Upload';document.getElementById('immigFileInput2').value='';immigAllRows2=[];immigMissingProfiles=[];_immigResRooms={};_immigNatMap={};_immigPassportMap={};_immigGenderMap={};_immigInhouseRoomGuests={};const ihl=document.getElementById('immigInhouseXmlLabel');if(ihl)ihl.textContent='Not loaded';const ihi=document.getElementById('immigInhouseXmlInput');if(ihi)ihi.value='';const arl=document.getElementById('immigArrivalsLabel');if(arl)arl.textContent='Not loaded';const ari=document.getElementById('immigArrivalsInput');if(ari)ari.value='';const rdl=document.getElementById('immigResDetailLabel');if(rdl)rdl.textContent='Not loaded';const rdi=document.getElementById('immigResDetailInput');if(rdi)rdi.value='';const mw=document.getElementById('immigMissingWrap');if(mw)mw.style.display='none';}

// ── FEEDBACK ──────────────────────────────────────────────
function openFeedback(){['fb-text','fb-name'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});document.getElementById('feedbackModal').classList.add('open');}
function closeFeedbackModal(){document.getElementById('feedbackModal').classList.remove('open');}
function saveFeedbackItem(){
  const text=(document.getElementById('fb-text').value||'').trim();if(!text){alert('Please describe your feedback.');return;}
  const entry={id:Date.now(),type:document.getElementById('fb-type').value,text,priority:document.getElementById('fb-priority').value,name:(document.getElementById('fb-name').value||'').trim()||'Anonymous',time:new Date().toLocaleString('en-GB')};
  feedbackLog.unshift(entry);
  saveFeedback(feedbackLog);
  closeFeedbackModal();
  showToast('Feedback saved to Firebase ✓');
}
