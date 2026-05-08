// ═══════════════════════════════════════════════════════════
// db.js — Firebase Realtime Database (Compat CDN Version)
// ═══════════════════════════════════════════════════════════

let _db = null;
let _ref = null;
let _online = false;


// Initialize Firebase Database
function dbInit(firebaseApp) {
  try {
    if (firebaseApp) {
      _db = firebase.database(firebaseApp);
    } else {
      _db = firebase.database();   // fallback
    }

    _ref = _db.ref(`hotels/${HOTEL_ID}`);

    console.log(`✅ Firebase connected → hotels/${HOTEL_ID}`);

    // Connection status
    _db.ref('.info/connected').on('value', (snap) => {
      _online = !!snap.val();
      updateConnectionUI(_online);
    });

  } catch (e) {
    console.error("❌ Firebase Database init failed", e);
    updateConnectionUI(false);
  }
}

// Connection UI
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
    console.warn('[DB] fbSet failed → local only', e);
    lsSave(path, data);
  }
}

async function fbGet(path) {
  if (!_ref) return lsLoad(path);
  try {
    const snap = await _ref.child(path).once('value');
    return snap.val();
  } catch (e) {
    console.warn('[DB] fbGet failed', e);
    return lsLoad(path);
  }
}

async function fbPush(path, data) {
  if (!_ref) return;
  try {
    await _ref.child(path).push({ ...data, _ts: Date.now() });
  } catch (e) {
    console.warn('[DB] fbPush failed', e);
  }
}

async function fbRemove(path) {
  if (!_ref) return;
  try {
    await _ref.child(path).remove();
  } catch (e) {
    console.warn('[DB] fbRemove failed', e);
  }
}

function fbListen(path, cb) {
  if (!_ref) return;
  _ref.child(path).on('value', (snap) => cb(snap.val()));
}

// ====================== LOCALSTORAGE FALLBACK ======================
function lsSave(path, data) {
  try {
    localStorage.setItem(`ibis_${path}`, JSON.stringify(data));
  } catch (e) {}
}

function lsLoad(path) {
  try {
    const v = localStorage.getItem(`ibis_${path}`);
    return v ? JSON.parse(v) : null;
  } catch (e) { return null; }
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
  await fbSet('feedback', { log, updatedAt: new Date().toISOString() });
}

async function saveSettings(settings) {
  await fbSet('settings', { ...settings, updatedAt: new Date().toISOString() });
}

// ====================== LOAD & LISTEN ======================
async function loadAll() {
  const [checklist, shifts, departures, arrivals, purpose, feedback, settings] = 
    await Promise.all([
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
function listenArrivals(cb) { fbListen('arrivals', cb); }
function listenChecklist(cb) { fbListen('checklist', cb); }
function listenShifts(cb) { fbListen('shifts', cb); }

// Export all functions to window so your inline script can access them
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
