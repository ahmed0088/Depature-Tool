// ═══════════════════════════════════════════════════════════
//  db.js  —  Firebase Realtime Database layer (FIXED + LIVE SYNC)
// ═══════════════════════════════════════════════════════════

let _db = null;
let _ref = null;
let _online = false;

// HOTEL_ID comes from firebase-config.js — do NOT declare again here

function dbInit(firebaseApp) {
  try {
    _db = firebase.database(firebaseApp || firebase.apps[0]);
    _ref = _db.ref(`hotels/${HOTEL_ID}`);

    console.log(`✅ Firebase initialized for hotel: ${HOTEL_ID}`);

    // Connection status
    _db.ref('.info/connected').on('value', snap => {
      _online = !!snap.val();
      updateConnectionUI(_online);
    });
  } catch (e) {
    console.error("❌ Firebase init failed", e);
    updateConnectionUI(false);
  }
}

function updateConnectionUI(online) {
  const dot = document.getElementById('fbDot');
  const lbl = document.getElementById('fbLabel');
  if (!dot || !lbl) return;

  if (online) {
    dot.style.background = 'var(--mint)';
    dot.style.boxShadow = '0 0 6px var(--mint)';
    lbl.textContent = 'Firebase · Live';
  } else {
    dot.style.background = 'var(--amber)';
    dot.style.boxShadow = 'none';
    lbl.textContent = 'Firebase · Offline';
  }
}

// ====================== GENERIC HELPERS ======================
async function fbSet(path, data) {
  if (!_ref) { 
    lsSave(path, data); 
    return; 
  }
  try {
    await _ref.child(path).set(data);
    lsSave(path, data);
  } catch (e) {
    console.warn('[DB] fbSet failed:', e);
    lsSave(path, data);
  }
}

async function fbGet(path) {
  if (!_ref) return lsLoad(path);
  try {
    const snap = await _ref.child(path).once('value');
    return snap.val();
  } catch (e) {
    console.warn('[DB] fbGet failed:', e);
    return lsLoad(path);
  }
}

async function fbPush(path, data) {
  if (!_ref) return;
  try { 
    await _ref.child(path).push({ ...data, _ts: Date.now() }); 
  } catch (e) {
    console.warn('[DB] fbPush failed:', e);
  }
}

async function fbRemove(path) {
  if (!_ref) return;
  try { 
    await _ref.child(path).remove(); 
  } catch (e) {
    console.warn('[DB] fbRemove failed:', e);
  }
}

// ====================== REAL-TIME LISTENERS (FIXED) ======================
const listeners = {};

function fbListen(path, cb) {
  if (!_ref) return;
  
  // Remove existing listener to prevent duplicates
  if (listeners[path]) {
    _ref.child(path).off('value', listeners[path]);
  }

  const handler = snap => {
    try {
      cb(snap.val());
    } catch (err) {
      console.error(`[DB] Listener error on ${path}:`, err);
    }
  };

  listeners[path] = handler;
  _ref.child(path).on('value', handler);
}

// ====================== LOCALSTORAGE ======================
function lsSave(path, data) {
  try { 
    localStorage.setItem(`ibis_${path}`, JSON.stringify(data)); 
  } catch(e) {
    console.warn('[LS] Save failed:', e);
  }
}

function lsLoad(path) {
  try {
    const v = localStorage.getItem(`ibis_${path}`);
    return v ? JSON.parse(v) : null;
  } catch(e) { 
    console.warn('[LS] Load failed:', e);
    return null; 
  }
}

// ====================== SAVE FUNCTIONS ======================
async function saveChecklist(steps, done, skipped) {
  await fbSet('checklist', { 
    steps, 
    done: [...done], 
    skipped: [...skipped], 
    updatedAt: new Date().toISOString() 
  });
}

async function saveShifts(shiftsObj) {
  await fbSet('shifts', { 
    data: shiftsObj, 
    updatedAt: new Date().toISOString() 
  });
}

async function saveDepartures(rooms, log) {
  await fbSet('departures', { 
    rooms, 
    log, 
    date: new Date().toISOString().split('T')[0], 
    updatedAt: new Date().toISOString() 
  });
}

async function saveArrivals(guests) {
  await fbSet('arrivals', { 
    guests, 
    date: new Date().toISOString().split('T')[0], 
    updatedAt: new Date().toISOString() 
  });
}

async function savePurpose(guests) {
  await fbSet('purpose', { 
    guests, 
    date: new Date().toISOString().split('T')[0], 
    updatedAt: new Date().toISOString() 
  });
}

async function saveFeedback(log) {
  await fbSet('feedback', { 
    log, 
    updatedAt: new Date().toISOString() 
  });
}

async function saveSettings(settings) {
  await fbSet('settings', { 
    ...settings, 
    updatedAt: new Date().toISOString() 
  });
}

// ====================== LOAD & LISTEN ======================
async function loadAll() {
  const [checklist, shifts, departures, arrivals, purpose, feedback, settings] = await Promise.all([
    fbGet('checklist'), 
    fbGet('shifts'), 
    fbGet('departures'),
    fbGet('arrivals'), 
    fbGet('purpose'), 
    fbGet('feedback'), 
    fbGet('settings')
  ]);
  return { checklist, shifts, departures, arrivals, purpose, feedback, settings };
}

function listenDepartures(cb) { fbListen('departures', cb); }
function listenArrivals(cb)   { fbListen('arrivals', cb); }
function listenChecklist(cb)  { fbListen('checklist', cb); }
function listenShifts(cb)     { fbListen('shifts', cb); }

// Export / Import
async function exportAllData() {
  try {
    const snap = await fbGet('');
    const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ibis_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    console.error("Export failed", e);
  }
}

async function importAllData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async e => {
      try {
        const data = JSON.parse(e.target.result);
        await fbSet('', data);
        resolve(data);
      } catch (err) { 
        reject(err); 
      }
    };
    reader.readAsText(file);
  });
}

// Make everything globally available
window.dbInit = dbInit;
window.fbSet = fbSet;
window.fbGet = fbGet;
window.fbListen = fbListen;
window.loadAll = loadAll;
window.saveChecklist = saveChecklist;
window.saveShifts = saveShifts;
window.saveDepartures = saveDepartures;
window.saveArrivals = saveArrivals;
window.savePurpose = savePurpose;
window.saveFeedback = saveFeedback;
window.saveSettings = saveSettings;
window.listenDepartures = listenDepartures;
window.listenArrivals = listenArrivals;
window.listenChecklist = listenChecklist;
window.listenShifts = listenShifts;
window.updateConnectionUI = updateConnectionUI;
window.exportAllData = exportAllData;
window.importAllData = importAllData;
