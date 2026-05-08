// ═══════════════════════════════════════════════════════════
// db.js — Firebase Realtime Database (Compat version)
// ═══════════════════════════════════════════════════════════

let _db = null;
let _ref = null;        // hotels/{HOTEL_ID}
let _online = false;

const HOTEL_ID = "ibis_dubai";

// Called after Firebase scripts are loaded
function dbInit() {
  if (!firebase || !firebase.apps.length) {
    console.error("❌ Firebase not loaded");
    return;
  }

  _db = firebase.database();
  _ref = _db.ref(`hotels/${HOTEL_ID}`);

  // Connection status
  _db.ref('.info/connected').on('value', (snap) => {
    _online = !!snap.val();
    updateConnectionUI(_online);
  });

  console.log("✅ Firebase Realtime Database initialized for", HOTEL_ID);
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

// Generic helpers
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

function fbListen(path, cb) {
  if (!_ref) return;
  _ref.child(path).on('value', (snap) => cb(snap.val()));
}

// LocalStorage fallback
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

// Save functions
async function saveChecklist(steps, done, skipped) {
  await fbSet('checklist', {
    steps,
    done: [...done],
    skipped: [...skipped],
    updatedAt: new Date().toISOString()
  });
}

// Add the rest of your save functions here (saveShifts, saveDepartures, etc.)
// ... copy them from your previous code

// Load & Listen
async function loadAll() {
  const [checklist, shifts, departures, arrivals, purpose, feedback, settings] = 
    await Promise.all([
      fbGet('checklist'), fbGet('shifts'), fbGet('departures'),
      fbGet('arrivals'), fbGet('purpose'), fbGet('feedback'), fbGet('settings')
    ]);
  return { checklist, shifts, departures, arrivals, purpose, feedback, settings };
}

function listenDepartures(cb) { fbListen('departures', cb); }
function listenArrivals(cb) { fbListen('arrivals', cb); }
function listenChecklist(cb) { fbListen('checklist', cb); }
function listenShifts(cb) { fbListen('shifts', cb); }

// Export & Import (keep your existing ones)

window.dbInit = dbInit;                    // Make it globally available
window.saveChecklist = saveChecklist;
// ... expose all functions you need in other scripts
