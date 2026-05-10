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
let natCopyText = '';

function processNat() {
  // ... (keep your existing processNat function unchanged)
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
let rentCopyText = '';

function processRent() {
  // ... (keep your existing processRent function unchanged)
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
let naCopyText = '';

function processAudit() {
  // ... (keep your existing processAudit function unchanged)
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
  // ... (your existing processImmig2 function - keep unchanged)
}

function immigRender2(rows) {
  // ... (your existing immigRender2 function - keep unchanged)
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
