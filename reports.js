// ═══════════════════════════════════════════════════════════
// reports.js — Nationality · Rented Rooms · Night Audit · Immigration
// ═══════════════════════════════════════════════════════════

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
function processNat() { ... }   // (your existing function - unchanged)
function copyNat() { 
  if (!natCopyText) return; 
  copyToClipboard(natCopyText, document.getElementById('natCopyBtn'), 'Copy All 240 Rows'); 
}
function clearNat() {
  document.getElementById('natInput').value = '';
  document.getElementById('natResults').style.display = 'none';
  document.getElementById('natError').classList.remove('show');
  natCopyText = '';
}

// ── RENTED ROOMS & BEDS ───────────────────────────────────
function parseHF(raw) { ... }   // (your existing function - unchanged)
function parseSRT(raw) { ... }  // (your existing function - unchanged)

function processRent() { ... }  // (your existing function - unchanged)

function copyRent() { 
  if(!rentCopyText) return; 
  copyToClipboard(rentCopyText, document.getElementById('rentCopyBtn'), 'Copy All Rows'); 
}
function clearRent() { ... }    // (your existing function - unchanged)

// ── NIGHT AUDIT PM ROOMS ──────────────────────────────────
function parseOperaPM(raw) { ... }   // unchanged
function parseExcelPM(raw) { ... }   // unchanged
function processAudit() { ... }      // unchanged

function copyAudit() { 
  if(!naCopyText) return; 
  copyToClipboard(naCopyText, document.getElementById('naCopyBtn'), 'Copy All Fixed Rows'); 
}
function clearAudit() { ... }        // unchanged

// ── IMMIGRATION CHECK ─────────────────────────────────────
// Removed duplicate declarations (already in state.js)
function immigLoadFile2(input) {
  if(!input.files[0]) return;
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('immigPasteInput2').value = e.target.result;
    processImmig2();
  };
  reader.readAsText(input.files[0]);
}

function processImmig2() { ... }     // your existing function - unchanged

function immigRender2(rows) { ... }  // your existing function - unchanged

function immigFilter2(type, btn) {
  immigFilter2_ = type;
  document.querySelectorAll('#immigFilters2 .fchip').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  immigRender2(immigAllRows2);
}

function clearImmig() {
  document.getElementById('immigPasteInput2').value = '';
  document.getElementById('immigResults2').style.display = 'none';
  document.getElementById('immigError2').classList.remove('show');
  document.getElementById('immigTabCount').textContent = 'Upload';
  document.getElementById('immigFileInput2').value = '';
  immigAllRows2 = [];
}

// ── FEEDBACK ──────────────────────────────────────────────
function openFeedback() {
  ['fb-text','fb-name'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('feedbackModal').classList.add('open');
}

function closeFeedbackModal() {
  document.getElementById('feedbackModal').classList.remove('open');
}

function saveFeedbackItem() {
  const text = (document.getElementById('fb-text').value || '').trim();
  if (!text) return alert('Please describe your feedback.');

  const entry = {
    id: Date.now(),
    type: document.getElementById('fb-type').value,
    text,
    priority: document.getElementById('fb-priority').value,
    name: (document.getElementById('fb-name').value || '').trim() || 'Anonymous',
    time: new Date().toLocaleString('en-GB')
  };

  feedbackLog.unshift(entry);
  saveFeedback(feedbackLog);
  closeFeedbackModal();
  showToast('Feedback saved to Firebase ✓');
}
