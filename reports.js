// ═══════════════════════════════════════════════════════════
// reports.js — Nationality · Rented Rooms · Night Audit · Immigration
// ═══════════════════════════════════════════════════════════

// NOTE: natCopyText, rentCopyText, naCopyText are already declared in state.js
// Do NOT redeclare them here!

// ── COUNTRY MAPPINGS ──────────────────────────────────────
const EXCEL_COUNTRIES = ["Afghanistan","Albania","Algeria","American Samoa","Andorra","Angola","Anguilla","Antarctica","Antigua & Barbuda","Argentina","Armenia","Aruba","Australia","Austria","Azerbaijan","Bahamas","Bahrain","Bangladesh","Barbados","Belarus","Belgium","Belize","Benin","Bermuda","Bhutan","Bolivia","Bosnia-Herzegovina","Botswana","Brazil","British Indian Ocean Territory","British Virgin Islands","British West Indies","Brunei","Bulgaria","Burkina Faso","Burundi","Cambodia","Cameroon Republic","Canada","Cape Verde","Cayman Island","Central African Republic","Chad","Chile","China","Colombia","Comoros","Congo (Republic of the Congo)","Congo, Dem. Rep. of (Zaire)","Cook Islands","Costa Rica","Côte d'Ivoire","Croatia","Cuba","Cyprus","Czech Republic","Czechoslovakia","Denmark","Djibouti","Dominica","Dominican Republic","East Timor","Ecuador","Egypt","El Salvador","Equatorial Guinea","Eritrea","Estonia","Ethiopia","Falkland Islands (Malvinas)","Faroe Islands","Fiji","Finland","France","French Guiana","French Polynesia","Gabon","Gambia","Georgia","Germany","Ghana","Gibraltar","Greece","Greenland","Grenada","Guadeloupe","Guam","Guatemala","Guinea","Guinea-Bissau","Guyana","Haiti","Holy See (Vatican City State)","Honduras","Hong Kong","Hungary","Iceland","India","Indonesia","Iran","Iraq","Ireland","Isle of Man","Israel","Italy","Jamaica","Japan","Jordan","Kazakhstan","Kenya","Kiribati","Korea, Democratic People's Republic of (North)","Korea, Republic of (South)","Kosovo","Kuwait","Kyrghyzstan","Laos","Latvia","Lebanon","Lesotho","Liberia","Libya","Liechtenstein","Lithuania","Luxembourg","Macau","Macedonia, Republic of","Madagascar","Malagasy Republic","Malawi","Malaysia","Maldives","Mali","Malta","Marshal Islands","Martinique","Mauritania","Mauritius","Mayotte","Mexico","Micronesia, Federated States","Moldova","Monaco","Mongolia","Montenegro","Montserrat","Morocco","Mozambique","Myanmar (Burma)","Namibia","Nauru","Nepal","Netherlands","Netherlands, Antilles","New Caledonia","New Zealand","Nicaragua","Niger","Nigeria","Norfolk Island","Northern Mariana Isl.","Norway","Oman","Pakistan","Palau","Palestine","Panama","Papua New Guinea","Paraguay","Peru","Philippines","Poland","Portugal","Puerto Rico","Qatar","Reunion","Romania","Russian Federation","Rwanda","Saba","Saint Barthelemy","Saint Helena","Saint Kitts and Nevis","Saint Lucia","Saint Pierre and Miquelon","Saint Vincent and the Grenadines","Samoa","San Marino (in Italy)","Sao Tomé","Saudi Arabia","Scotland","Senegal","Serbia","Seychelles","Sierra Leone","Singapore","Slovakia Republic","Slovenia","Solomon Island","Somalia","South Africa","South Georgia and the South Sandwich Islands","South Sudan","Spain","Sri Lanka","Sudan","Surinam","Swaziland","Sweden","Switzerland","Syria","Tadjikistan","Taiwan","Tanzania","Thailand","Togo","Tokelau","Tonga","Trinidad & Tobaggo","Tunisia","Turkey","Turkmenistan","Turks and Caicos Islands","Tuvalu","Uganda","Ukraine","United Arab Emirates","United Kingdom","United States of America","Uruguay","Uzbekistan","Vanuatu","Venezuela","Vietnam","Virgin Islands, British","Virgin Islands, U.S.","Yemen","Yugoslavia","Zambia","Zimbabwe"];

const EXCEL_LOWER = {};
EXCEL_COUNTRIES.forEach(n => { EXCEL_LOWER[n.toLowerCase()] = n; });

const NAME_MAP = {
  "Cote D'Ivoire":"Côte d'Ivoire", "Ivory Coast":"Côte d'Ivoire",
  "Great Britain":"United Kingdom", "England":"United Kingdom", "Scotland":"United Kingdom",
  "Russia":"Russian Federation",
  "United States":"United States of America", "USA":"United States of America",
  "Cameroon":"Cameroon Republic",
  "Congo (Kinshasa)":"Congo, Dem. Rep. of (Zaire)",
  "Democratic Republic of the Congo":"Congo, Dem. Rep. of (Zaire)",
  "Myanmar":"Myanmar (Burma)", "Burma":"Myanmar (Burma)",
  "Tajikistan":"Tadjikistan", "Kyrgyzstan":"Kyrghyzstan",
  "Bosnia and Herzegovina":"Bosnia-Herzegovina",
  "Trinidad and Tobago":"Trinidad & Tobaggo",
  "Timor-Leste":"East Timor",
  "UAE":"United Arab Emirates", "Czechia":"Czech Republic",
  "Viet Nam":"Vietnam"
};

function resolveCountry(name) {
  if (!name) return { excel: null, isUnknown: true };
  const t = name.trim();
  if (NAME_MAP[t]) return { excel: NAME_MAP[t], isUnknown: false };
  const match = EXCEL_LOWER[t.toLowerCase()];
  return match ? { excel: match, isUnknown: false } : { excel: null, isUnknown: false };
}

// ── NATIONALITY REPORT ────────────────────────────────────
// natCopyText is already declared in state.js

function processNat() {
  const raw = document.getElementById('natInput').value.trim();
  const errBox = document.getElementById('natError');
  errBox.classList.remove('show');
  const showErr = msg => { document.getElementById('natErrorMsg').textContent = msg; errBox.classList.add('show'); };
  
  if (!raw) { showErr('Please paste the nationality report first.'); return; }
  
  const lines = raw.split('\n').filter(l => l.trim());
  if (lines.length < 3) { showErr('Not enough data rows.'); return; }
  
  // Parse headers
  const hdrs = lines[0].split('\t').map(h => h.trim().toUpperCase());
  const natIdx = hdrs.findIndex(h => h.includes('NATIONALITY') || h === 'COUNTRY');
  const arrIdx = hdrs.findIndex(h => h.includes('ARRIVAL') || h === 'ARR');
  const rmsIdx = hdrs.findIndex(h => h.includes('ROOM NIGHTS') || h === 'RMS');
  const gstIdx = hdrs.findIndex(h => h.includes('GUEST NIGHTS') || h === 'GST');
  
  if (natIdx < 0) { showErr('Could not find Nationality column.'); return; }
  
  const rows = [];
  let totalArr = 0, totalRms = 0, totalGst = 0;
  let unknownCount = 0, unmatchedCount = 0;
  const unknownList = [];
  const unmatchedList = [];
  
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    if (cols.length < 2) continue;
    
    let nat = (cols[natIdx] || '').trim();
    const arr = parseInt(cols[arrIdx]) || 0;
    const rms = parseInt(cols[rmsIdx]) || 0;
    const gst = parseInt(cols[gstIdx]) || 0;
    
    if (!nat) {
      unknownCount++;
      unknownList.push(`Row ${i}: No nationality`);
      continue;
    }
    
    const resolved = resolveCountry(nat);
    if (!resolved.excel) {
      unmatchedCount++;
      unmatchedList.push(`${nat}`);
    }
    
    rows.push({
      original: nat,
      mapped: resolved.excel || nat,
      arr, rms, gst,
      isUnknown: !nat,
      isUnmatched: !resolved.excel && !!nat
    });
    
    totalArr += arr;
    totalRms += rms;
    totalGst += gst;
  }
  
  // Update KPIs
  document.getElementById('kpi-apr').textContent = totalArr.toLocaleString();
  document.getElementById('kpi-rms').textContent = totalRms.toLocaleString();
  document.getElementById('kpi-prs').textContent = totalGst.toLocaleString();
  
  // Data quality
  const withData = rows.filter(r => r.arr > 0 || r.rms > 0 || r.gst > 0).length;
  const zeroRows = rows.filter(r => r.arr === 0 && r.rms === 0 && r.gst === 0).length;
  document.getElementById('s-active').textContent = withData;
  document.getElementById('s-zero').textContent = zeroRows;
  document.getElementById('s-unmat').textContent = unmatchedCount;
  document.getElementById('s-unk').textContent = unknownCount;
  
  // Unknown list
  const unknownDiv = document.getElementById('natUnknownList');
  unknownDiv.innerHTML = unknownList.slice(0, 10).map(u => `<div style="font-size:0.68rem;color:var(--amber);margin-bottom:3px;">⚠ ${u}</div>`).join('');
  if (unknownList.length > 10) unknownDiv.innerHTML += `<div style="font-size:0.6rem;color:var(--text3);">+${unknownList.length - 10} more</div>`;
  
  // Unmatched list
  const unmatchedDiv = document.getElementById('natUnmatchedList');
  unmatchedDiv.innerHTML = unmatchedList.slice(0, 15).map(u => `<div style="font-size:0.68rem;color:var(--rose);margin-bottom:3px;">🔴 ${u}</div>`).join('');
  if (unmatchedList.length > 15) unmatchedDiv.innerHTML += `<div style="font-size:0.6rem;color:var(--text3);">+${unmatchedList.length - 15} more</div>`;
  
  // Preview (rows 8-247 as requested)
  const previewRows = rows.slice(7, 247);
  const previewDiv = document.getElementById('natPreview');
  previewDiv.innerHTML = previewRows.map((r, idx) => `
    <div style="display:grid;grid-template-columns:36px 1fr 54px 54px 54px;padding:5px 12px;border-bottom:1px solid rgba(255,255,255,0.03);font-size:0.68rem;">
      <span style="color:var(--text3);">${idx + 8}</span>
      <span style="${r.isUnmatched ? 'color:var(--rose);' : r.isUnknown ? 'color:var(--amber);' : 'color:var(--mint);'}">${r.mapped}</span>
      <span style="text-align:right;color:var(--sky);">${r.arr || '-'}</span>
      <span style="text-align:right;color:var(--gold);">${r.rms || '-'}</span>
      <span style="text-align:right;color:var(--mint);">${r.gst || '-'}</span>
    </div>
  `).join('');
  
  // Build copy text
  natCopyText = previewRows.map(r => `${r.mapped}\t${r.arr}\t${r.rms}\t${r.gst}`).join('\n');
  
  document.getElementById('natResults').style.display = 'block';
  document.getElementById('natDiagBadge').textContent = `${rows.length} countries processed`;
  
  // Totals grid
  const totalsGrid = document.getElementById('natTotalsGrid');
  totalsGrid.innerHTML = `
    <div><div style="font-size:0.6rem;color:var(--text3);">Arrivals</div><div style="font-size:1.1rem;font-weight:700;color:var(--sky);">${totalArr.toLocaleString()}</div></div>
    <div><div style="font-size:0.6rem;color:var(--text3);">Room Nights</div><div style="font-size:1.1rem;font-weight:700;color:var(--gold);">${totalRms.toLocaleString()}</div></div>
    <div><div style="font-size:0.6rem;color:var(--text3);">Guest Nights</div><div style="font-size:1.1rem;font-weight:700;color:var(--mint);">${totalGst.toLocaleString()}</div></div>
  `;
}

function copyNat() { 
  if (!natCopyText) return; 
  copyToClipboard(natCopyText, document.getElementById('natCopyBtn'), 'Copy All 240 Rows'); 
}

function clearNat() {
  const input = document.getElementById('natInput');
  if (input) input.value = '';
  const results = document.getElementById('natResults');
  if (results) results.style.display = 'none';
  const error = document.getElementById('natError');
  if (error) error.classList.remove('show');
  natCopyText = '';
}

// ── RENTED ROOMS & BEDS ───────────────────────────────────
// rentCopyText is already declared in state.js

function processRent() {
  const raw1 = document.getElementById('rentInput1').value.trim();
  const raw2 = document.getElementById('rentInput2').value.trim();
  const errBox = document.getElementById('rentError');
  errBox.classList.remove('show');
  const showErr = msg => { document.getElementById('rentErrorMsg').textContent = msg; errBox.classList.add('show'); };
  
  if (!raw1 && !raw2) { showErr('Please paste at least one file.'); return; }
  
  // Parse History Forecast
  let roomData = {};
  let daysFound = 0;
  
  if (raw1) {
    const lines = raw1.split('\n').filter(l => l.trim());
    if (lines.length > 1) {
      const hdrs = lines[0].split('\t').map(h => h.trim().toUpperCase());
      const dateIdx = hdrs.findIndex(h => h.includes('CONSIDERED_DATE') || h.includes('DATE'));
      const roomsIdx = hdrs.findIndex(h => h.includes('NO_ROOMS') || h.includes('ROOMS'));
      
      if (dateIdx >= 0 && roomsIdx >= 0) {
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split('\t');
          const date = cols[dateIdx]?.trim();
          const rooms = parseInt(cols[roomsIdx]) || 0;
          if (date && date.length >= 10) {
            const shortDate = date.substring(0, 10);
            roomData[shortDate] = { rooms, beds: 0 };
            daysFound++;
          }
        }
      }
    }
  }
  
  // Parse Room Type Stats for TWC (Twin) beds
  let twinRooms = 0;
  let twinDate = null;
  
  if (raw2) {
    const lines = raw2.split('\n').filter(l => l.trim());
    if (lines.length > 1) {
      const hdrs = lines[0].split('\t').map(h => h.trim().toUpperCase());
      const dateIdx = hdrs.findIndex(h => h.includes('BUSINESS_DATE') || h.includes('DATE'));
      const categoryIdx = hdrs.findIndex(h => h.includes('ROOM_CATEGORY') || h.includes('CATEGORY'));
      const roomsIdx = hdrs.findIndex(h => h.includes('STAY_ROOMS') || h.includes('ROOMS'));
      
      if (dateIdx >= 0 && categoryIdx >= 0 && roomsIdx >= 0) {
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split('\t');
          const category = (cols[categoryIdx] || '').toUpperCase();
          if (category.includes('TWC') || category === 'TWIN') {
            const date = cols[dateIdx]?.trim().substring(0, 10);
            const rooms = parseInt(cols[roomsIdx]) || 0;
            twinRooms += rooms;
            if (!twinDate) twinDate = date;
          }
        }
      }
    }
  }
  
  // Calculate beds (assuming 2 beds per twin room, 1 per other)
  let totalBeds = 0;
  let totalRooms = 0;
  const dailyData = [];
  
  for (const [date, data] of Object.entries(roomData)) {
    const rooms = data.rooms;
    // Estimate beds: assume twin rooms are ~30% of total if twin file provided
    let beds = rooms;
    if (twinRooms > 0 && rooms > 0) {
      const twinRatio = Math.min(1, twinRooms / rooms);
      beds = Math.round(rooms * (1 + twinRatio));
    }
    totalRooms += rooms;
    totalBeds += beds;
    dailyData.push({ date, rooms, beds });
  }
  
  dailyData.sort((a, b) => a.date.localeCompare(b.date));
  
  document.getElementById('kpi-rooms').textContent = totalRooms.toLocaleString();
  document.getElementById('kpi-beds').textContent = totalBeds.toLocaleString();
  document.getElementById('daysFound').textContent = daysFound;
  document.getElementById('twinStatus').textContent = twinRooms > 0 ? `${twinRooms} twin rooms found` : 'No twin data';
  document.getElementById('rs-rooms').textContent = totalRooms.toLocaleString();
  document.getElementById('rs-beds').textContent = totalBeds.toLocaleString();
  document.getElementById('rs-days').textContent = dailyData.length;
  document.getElementById('rentRowCount').textContent = dailyData.length + ' DAYS';
  
  const previewDiv = document.getElementById('rentPreview');
  previewDiv.innerHTML = `
    <div style="display:grid;grid-template-columns:100px 1fr 1fr;padding:8px 14px;background:rgba(255,255,255,0.02);border-bottom:1px solid var(--border);font-family:var(--mono);font-size:0.58rem;color:var(--text3);">
      <span>DATE</span><span style="text-align:right;">ROOMS</span><span style="text-align:right;">BEDS</span>
    </div>
    ${dailyData.map(d => `
      <div style="display:grid;grid-template-columns:100px 1fr 1fr;padding:6px 14px;border-bottom:1px solid rgba(255,255,255,0.03);font-size:0.72rem;">
        <span style="font-family:var(--mono);color:var(--gold);">${d.date}</span>
        <span style="text-align:right;color:var(--sky);">${d.rooms.toLocaleString()}</span>
        <span style="text-align:right;color:var(--mint);">${d.beds.toLocaleString()}</span>
      </div>
    `).join('')}
  `;
  
  // Build copy text
  rentCopyText = dailyData.map(d => `${d.date}\t${d.rooms}\t${d.beds}`).join('\n');
  
  document.getElementById('rentResults').style.display = 'block';
}

function copyRent() { 
  if(!rentCopyText) return; 
  copyToClipboard(rentCopyText, document.getElementById('rentCopyBtn'), 'Copy All Rows'); 
}

function clearRent() {
  const input1 = document.getElementById('rentInput1');
  const input2 = document.getElementById('rentInput2');
  if (input1) input1.value = '';
  if (input2) input2.value = '';
  const results = document.getElementById('rentResults');
  if (results) results.style.display = 'none';
  const error = document.getElementById('rentError');
  if (error) error.classList.remove('show');
  rentCopyText = '';
}

// ── NIGHT AUDIT PM ROOMS ──────────────────────────────────
// naCopyText is already declared in state.js

function processAudit() {
  const operaRaw = document.getElementById('naOperaInput').value.trim();
  const excelRaw = document.getElementById('naExcelInput').value.trim();
  const errBox = document.getElementById('naError');
  errBox.classList.remove('show');
  const showErr = msg => { document.getElementById('naErrorMsg').textContent = msg; errBox.classList.add('show'); };
  
  if (!operaRaw && !excelRaw) { showErr('Please paste both Opera and Excel data.'); return; }
  
  // Parse Opera PM Rooms
  const operaRooms = [];
  if (operaRaw) {
    const lines = operaRaw.split('\n').filter(l => l.trim());
    if (lines.length > 1) {
      const hdrs = lines[0].split('\t').map(h => h.trim().toUpperCase());
      const roomIdx = hdrs.findIndex(h => h.includes('ROOM'));
      const nameIdx = hdrs.findIndex(h => h.includes('NAME') || h.includes('GUEST'));
      const arrIdx = hdrs.findIndex(h => h.includes('ARRIVAL'));
      const depIdx = hdrs.findIndex(h => h.includes('DEPARTURE'));
      const balIdx = hdrs.findIndex(h => h.includes('BALANCE'));
      
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split('\t');
        const room = (cols[roomIdx] || '').trim();
        if (!room) continue;
        operaRooms.push({
          room: room,
          name: (cols[nameIdx] || '').trim(),
          arrival: (cols[arrIdx] || '').trim(),
          departure: (cols[depIdx] || '').trim(),
          balance: (cols[balIdx] || '').trim()
        });
      }
    }
  }
  
  // Parse Excel PM Rooms
  const excelRooms = [];
  if (excelRaw) {
    const lines = excelRaw.split('\n').filter(l => l.trim());
    const dataRows = lines.map(l => l.split(',').map(c => c.replace(/^"|"$/g, '').trim()));
    
    // Find header row
    let headerIdx = 0;
    for (let i = 0; i < Math.min(5, dataRows.length); i++) {
      const row = dataRows[i];
      if (row.some(c => c.toLowerCase().includes('room'))) {
        headerIdx = i;
        break;
      }
    }
    
    const hdrs = dataRows[headerIdx].map(h => h.toLowerCase());
    const roomIdx = hdrs.findIndex(h => h.includes('room'));
    const nameIdx = hdrs.findIndex(h => h.includes('name') || h.includes('guest'));
    const arrIdx = hdrs.findIndex(h => h.includes('arrival'));
    const depIdx = hdrs.findIndex(h => h.includes('departure'));
    const balIdx = hdrs.findIndex(h => h.includes('balance'));
    
    for (let i = headerIdx + 1; i < dataRows.length; i++) {
      const cols = dataRows[i];
      const room = cols[roomIdx]?.trim();
      if (!room) continue;
      excelRooms.push({
        room: room,
        name: cols[nameIdx]?.trim() || '',
        arrival: cols[arrIdx]?.trim() || '',
        departure: cols[depIdx]?.trim() || '',
        balance: cols[balIdx]?.trim() || ''
      });
    }
  }
  
  // Compare
  const operaMap = new Map();
  operaRooms.forEach(r => { operaMap.set(r.room, r); });
  
  const differences = [];
  const matches = [];
  
  excelRooms.forEach(excelRoom => {
    const operaRoom = operaMap.get(excelRoom.room);
    if (operaRoom) {
      let status = '✅ Match';
      let changes = [];
      if (operaRoom.name !== excelRoom.name) changes.push('Name');
      if (operaRoom.balance !== excelRoom.balance) changes.push('Balance');
      if (changes.length) status = `⚠️ ${changes.join(', ')}`;
      matches.push({ ...excelRoom, status, isMatch: changes.length === 0 });
      differences.push({ ...excelRoom, opera: operaRoom, hasChanges: changes.length > 0 });
    } else {
      differences.push({ ...excelRoom, opera: null, hasChanges: true, status: '❌ Not in Opera' });
    }
  });
  
  const totalPM = excelRooms.length;
  const diffCount = differences.filter(d => d.hasChanges).length;
  const matchCount = totalPM - diffCount;
  
  document.getElementById('na-kpi-total').textContent = totalPM;
  document.getElementById('na-kpi-diff').textContent = diffCount;
  document.getElementById('na-kpi-ok').textContent = matchCount;
  document.getElementById('na-pill-total').textContent = `${totalPM} rooms`;
  document.getElementById('na-pill-diff').textContent = `${diffCount} diff`;
  document.getElementById('na-pill-ok').textContent = `${matchCount} ok`;
  
  // Comparison table
  const compareDiv = document.getElementById('naCompareTable');
  compareDiv.innerHTML = differences.map(d => `
    <div style="display:grid;grid-template-columns:60px 1fr 1fr 1fr 1fr 80px;padding:7px 14px;border-bottom:1px solid rgba(255,255,255,0.03);font-size:0.7rem;">
      <span style="font-weight:700;color:${d.opera ? 'var(--mint)' : 'var(--rose)'};">${d.room}</span>
      <span style="${d.opera && d.opera.name !== d.name ? 'color:var(--amber);' : ''}">${d.opera?.name || '—'}</span>
      <span>${d.arrival}</span>
      <span>${d.departure}</span>
      <span>${d.balance}</span>
      <span style="color:${d.opera ? 'var(--mint)' : 'var(--rose)'};">${d.opera ? (d.opera.name === d.name && d.opera.balance === d.balance ? '✓' : '⚠') : '✗'}</span>
    </div>
  `).join('');
  
  // Fixed rows (corrected Excel data)
  const fixedRows = differences.filter(d => d.hasChanges).map(d => ({
    room: d.room,
    name: d.opera?.name || d.name,
    arrival: d.arrival,
    departure: d.departure,
    balance: d.opera?.balance || d.balance
  }));
  
  document.getElementById('naFixedCount').textContent = fixedRows.length;
  
  const fixedDiv = document.getElementById('naFixedTable');
  fixedDiv.innerHTML = `
    <div style="display:grid;grid-template-columns:60px 1fr 100px 100px 80px;padding:8px 14px;background:rgba(255,255,255,0.02);border-bottom:1px solid var(--border);font-family:var(--mono);font-size:0.58rem;">
      <span>ROOM</span><span>NAME</span><span>ARRIVAL</span><span>DEPARTURE</span><span>BALANCE</span>
    </div>
    ${fixedRows.map(r => `
      <div style="display:grid;grid-template-columns:60px 1fr 100px 100px 80px;padding:6px 14px;border-bottom:1px solid rgba(255,255,255,0.03);font-size:0.68rem;">
        <span style="color:var(--mint);font-weight:700;">${r.room}</span>
        <span>${r.name}</span>
        <span>${r.arrival}</span>
        <span>${r.departure}</span>
        <span>${r.balance}</span>
      </div>
    `).join('')}
  `;
  
  // Build copy text
  naCopyText = fixedRows.map(r => `${r.room},${r.name},${r.arrival},${r.departure},${r.balance}`).join('\n');
  
  // Changes list
  const changesDiv = document.getElementById('naChangesList');
  const changesList = differences.filter(d => d.hasChanges && d.opera);
  changesDiv.innerHTML = changesList.map(d => `
    <div style="padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.05);font-size:0.68rem;">
      <span style="color:var(--amber);">📝 Room ${d.room}</span>
      <div style="margin-left:12px;font-size:0.62rem;color:var(--text3);">
        ${d.opera.name !== d.name ? `Name: "${d.name}" → "${d.opera.name}"<br>` : ''}
        ${d.opera.balance !== d.balance ? `Balance: ${d.balance} → ${d.opera.balance}` : ''}
      </div>
    </div>
  `).join('');
  if (!changesList.length) changesDiv.innerHTML = '<div style="font-size:0.68rem;color:var(--mint);">✓ No changes needed</div>';
  
  // Missing card
  const missingCard = document.getElementById('naMissingCard');
  const missingList = differences.filter(d => !d.opera);
  if (missingList.length) {
    missingCard.style.display = 'block';
    document.getElementById('naMissingList').innerHTML = missingList.map(d => `
      <div style="padding:3px 0;font-size:0.68rem;color:var(--rose);">🔴 Room ${d.room} — ${d.name}</div>
    `).join('');
  } else {
    missingCard.style.display = 'none';
  }
  
  document.getElementById('naCompareSection').style.display = 'block';
}

function copyAudit() { 
  if(!naCopyText) return; 
  copyToClipboard(naCopyText, document.getElementById('naCopyBtn'), 'Copy All Fixed Rows'); 
}

function clearAudit() {
  const operaInput = document.getElementById('naOperaInput');
  const excelInput = document.getElementById('naExcelInput');
  if (operaInput) operaInput.value = '';
  if (excelInput) excelInput.value = '';
  const compareSection = document.getElementById('naCompareSection');
  if (compareSection) compareSection.style.display = 'none';
  const error = document.getElementById('naError');
  if (error) error.classList.remove('show');
  naCopyText = '';
}

// ── IMMIGRATION CHECK ─────────────────────────────────────
// immigAllRows2 and immigFilter2_ are already declared in state.js

function immigLoadFile2(input) {
  if(!input.files[0]) return;
  const reader = new FileReader();
  reader.onload = e => {
    const pasteInput = document.getElementById('immigPasteInput2');
    if (pasteInput) pasteInput.value = e.target.result;
    processImmig2();
  };
  reader.readAsText(input.files[0]);
}

function processImmig2() {
  const xmlText = document.getElementById('immigPasteInput2').value.trim();
  const errBox = document.getElementById('immigError2');
  errBox.classList.remove('show');
  const showErr = msg => { document.getElementById('immigErrorMsg2').textContent = msg; errBox.classList.add('show'); };
  
  if (!xmlText) { showErr('Please paste XML data or upload a file.'); return; }
  
  // Simple XML parsing for guest data
  const guests = [];
  const guestRegex = /<Guest[^>]*>([\s\S]*?)<\/Guest>/gi;
  let match;
  
  while ((match = guestRegex.exec(xmlText)) !== null) {
    const guestXml = match[1];
    
    const extract = (tag) => {
      const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
      const m = regex.exec(guestXml);
      return m ? m[1].trim() : '';
    };
    
    const room = extract('RoomNumber') || extract('Room');
    const firstName = extract('FirstName');
    const lastName = extract('LastName');
    const sex = extract('Sex') || extract('Gender');
    const nationality = extract('Nationality') || extract('Country');
    const passport = extract('PassportNumber') || extract('Passport');
    const arrival = extract('ArrivalDate') || extract('Arrival');
    const departure = extract('DepartureDate') || extract('Departure');
    
    if (!room) continue;
    
    const issues = [];
    if (!nationality || nationality === '') issues.push('nationality');
    if (!sex || sex === '') issues.push('gender');
    if (!passport || passport === '') issues.push('passport');
    if (!firstName || firstName === '') issues.push('first_name');
    
    guests.push({
      room,
      firstName,
      lastName,
      name: `${firstName} ${lastName}`.trim() || '—',
      sex: sex || '—',
      nationality: nationality || '—',
      passport: passport || '—',
      arrival: arrival || '—',
      departure: departure || '—',
      issues
    });
  }
  
  if (!guests.length) { showErr('No guest data found in XML. Check format.'); return; }
  
  immigAllRows2 = guests;
  
  // KPIs
  const total = guests.length;
  const natIssues = guests.filter(g => g.issues.includes('nationality')).length;
  const genderIssues = guests.filter(g => g.issues.includes('gender')).length;
  const passportIssues = guests.filter(g => g.issues.includes('passport')).length;
  const nameIssues = guests.filter(g => g.issues.includes('first_name')).length;
  
  const kpisDiv = document.getElementById('immigKpis2');
  kpisDiv.innerHTML = `
    <div class="kpi"><div class="kpi-accent"></div><div class="kpi-label">Total Guests</div><div class="kpi-val">${total}</div></div>
    <div class="kpi rose"><div class="kpi-accent"></div><div class="kpi-label">Missing Nationality</div><div class="kpi-val">${natIssues}</div></div>
    <div class="kpi amber"><div class="kpi-accent"></div><div class="kpi-label">Missing Gender</div><div class="kpi-val">${genderIssues}</div></div>
    <div class="kpi sky"><div class="kpi-accent"></div><div class="kpi-label">Missing Passport</div><div class="kpi-val">${passportIssues}</div></div>
  `;
  
  document.getElementById('immigMeta2').innerHTML = `📄 ${total} guests processed · ${new Date().toLocaleString()}`;
  document.getElementById('ifc-all').textContent = total;
  document.getElementById('ifc-nat').textContent = natIssues;
  document.getElementById('ifc-gen').textContent = genderIssues;
  document.getElementById('ifc-pass').textContent = passportIssues;
  document.getElementById('ifc-fname').textContent = nameIssues;
  document.getElementById('immigTabCount').textContent = `${total}`;
  
  immigRender2(guests);
  document.getElementById('immigResults2').style.display = 'block';
}

function immigRender2(rows) {
  let filtered = rows;
  if (immigFilter2_ !== 'all') {
    filtered = rows.filter(g => g.issues.includes(immigFilter2_));
  }
  
  const search = (document.getElementById('immigSearch2')?.value || '').toLowerCase();
  if (search) {
    filtered = filtered.filter(g => 
      g.room.toLowerCase().includes(search) || 
      g.name.toLowerCase().includes(search) ||
      g.nationality.toLowerCase().includes(search)
    );
  }
  
  const tbody = document.getElementById('immigTable2');
  tbody.innerHTML = filtered.map(g => `
    <tr style="${g.issues.length ? 'background:rgba(240,107,122,0.05);' : ''}">
      <td><strong>${g.room}</strong></td>
      <td>${g.sex}</td>
      <td>${g.name}</td>
      <td style="${g.issues.includes('nationality') ? 'color:var(--rose);font-weight:700;' : ''}">${g.nationality}</td>
      <td style="${g.issues.includes('passport') ? 'color:var(--rose);font-weight:700;' : ''}">${g.passport}</td>
      <td>${g.arrival}</td>
      <td>${g.departure}</td>
      <td>${g.issues.map(i => ({ nationality:'🔴', gender:'🟡', passport:'🔵', first_name:'🟢' }[i] || '⚠')).join(' ')}</td>
    </tr>
  `).join('');
}

function immigFilter2(type, btn) {
  immigFilter2_ = type;
  document.querySelectorAll('#immigFilters2 .fchip').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  immigRender2(immigAllRows2);
}

function clearImmig() {
  const pasteInput = document.getElementById('immigPasteInput2');
  if (pasteInput) pasteInput.value = '';
  const results = document.getElementById('immigResults2');
  if (results) results.style.display = 'none';
  const error = document.getElementById('immigError2');
  if (error) error.classList.remove('show');
  const badge = document.getElementById('immigTabCount');
  if (badge) badge.textContent = 'Upload';
  const fileInput = document.getElementById('immigFileInput2');
  if (fileInput) fileInput.value = '';
  immigAllRows2 = [];
}

// ── FEEDBACK ──────────────────────────────────────────────
function openFeedback() {
  const textArea = document.getElementById('fb-text');
  const nameInput = document.getElementById('fb-name');
  if (textArea) textArea.value = '';
  if (nameInput) nameInput.value = '';
  const modal = document.getElementById('feedbackModal');
  if (modal) modal.classList.add('open');
}

function closeFeedbackModal() {
  const modal = document.getElementById('feedbackModal');
  if (modal) modal.classList.remove('open');
}

function saveFeedbackItem() {
  const textArea = document.getElementById('fb-text');
  const text = (textArea?.value || '').trim();
  if (!text) return alert('Please describe your feedback.');

  const entry = {
    id: Date.now(),
    type: document.getElementById('fb-type')?.value || 'other',
    text: text,
    priority: document.getElementById('fb-priority')?.value || 'med',
    name: (document.getElementById('fb-name')?.value || '').trim() || 'Anonymous',
    time: new Date().toLocaleString('en-GB')
  };

  feedbackLog.unshift(entry);
  saveFeedback(feedbackLog);
  closeFeedbackModal();
  showToast('Feedback saved to Firebase ✓');
}
