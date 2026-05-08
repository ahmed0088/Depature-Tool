// ═══════════════════════════════════════════════════════════
//  db.js  —  Firebase Realtime Database layer
//  Every save/load in the app goes through this file.
//  Structure in Firebase:
//    hotels/{HOTEL_ID}/
//      checklist/          ← night checklist steps + state
//      shifts/             ← all 4 shifts + tasks + done state
//      departures/         ← today's departure board state
//      departureLog/       ← action log entries
//      arrivals/           ← today's arrivals list
//      purpose/            ← purpose of stay list
//      feedback/           ← submitted feedback items
//      settings/           ← hotel name, theme
// ═══════════════════════════════════════════════════════════

// ── Firebase SDK (loaded via CDN in index.html) ───────────
let _db   = null;   // Realtime Database instance
let _ref  = null;   // root ref: hotels/{HOTEL_ID}
let _online = false;

// Called once after Firebase is initialized in index.html
function dbInit(firebaseApp) {
  _db     = firebase.database(firebaseApp);
  _ref    = _db.ref(`hotels/${HOTEL_ID}`);
  _online = true;

  // Connection state indicator
  _db.ref('.info/connected').on('value', snap => {
    _online = !!snap.val();
    updateConnectionUI(_online);
  });
}

// ── Connection UI ─────────────────────────────────────────
function updateConnectionUI(online) {
  const dot  = document.getElementById('fbDot');
  const lbl  = document.getElementById('fbLabel');
  if (!dot || !lbl) return;
  if (online) {
    dot.style.background = 'var(--mint)';
    dot.style.boxShadow  = '0 0 6px var(--mint)';
    lbl.textContent      = 'Firebase · Live';
  } else {
    dot.style.background = 'var(--amber)';
    dot.style.boxShadow  = 'none';
    lbl.textContent      = 'Firebase · Offline';
  }
}

// ── Generic helpers ───────────────────────────────────────
async function fbSet(path, data) {
  if (!_ref) { lsSave(path, data); return; }
  try {
    await _ref.child(path).set(data);
    lsSave(path, data);          // mirror to localStorage as backup
  } catch (e) {
    console.warn('[DB] fbSet failed, saved locally only:', e);
    lsSave(path, data);
  }
}

async function fbGet(path) {
  if (!_ref) return lsLoad(path);
  try {
    const snap = await _ref.child(path).once('value');
    return snap.val();
  } catch (e) {
    console.warn('[DB] fbGet failed, using localStorage:', e);
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
  try { await _ref.child(path).remove(); } catch (e) { console.warn(e); }
}

function fbListen(path, cb) {
  if (!_ref) return;
  _ref.child(path).on('value', snap => cb(snap.val()));
}

// ── localStorage fallback ─────────────────────────────────
function lsSave(path, data) {
  try { localStorage.setItem(`ibis_${path}`, JSON.stringify(data)); } catch (e) {}
}
function lsLoad(path) {
  try { const v = localStorage.getItem(`ibis_${path}`); return v ? JSON.parse(v) : null; } catch (e) { return null; }
}

// ═══════════════════════════════════════════════════════════
//  SAVE FUNCTIONS  (called from each feature module)
// ═══════════════════════════════════════════════════════════

async function saveChecklist(steps, done, skipped) {
  await fbSet('checklist', {
    steps,
    done:    [...done],
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
    date:      new Date().toISOString().split('T')[0],
    updatedAt: new Date().toISOString()
  });
}

async function saveArrivals(guests) {
  await fbSet('arrivals', {
    guests,
    date:      new Date().toISOString().split('T')[0],
    updatedAt: new Date().toISOString()
  });
}

async function savePurpose(guests) {
  await fbSet('purpose', {
    guests,
    date:      new Date().toISOString().split('T')[0],
    updatedAt: new Date().toISOString()
  });
}

async function saveFeedback(log) {
  await fbSet('feedback', { log, updatedAt: new Date().toISOString() });
}

async function saveSettings(settings) {
  await fbSet('settings', { ...settings, updatedAt: new Date().toISOString() });
}

// ═══════════════════════════════════════════════════════════
//  LOAD FUNCTIONS
// ═══════════════════════════════════════════════════════════

async function loadAll() {
  const [
    checklist, shifts, departures,
    arrivals, purpose, feedback, settings
  ] = await Promise.all([
    fbGet('checklist'),
    fbGet('shifts'),
    fbGet('departures'),
    fbGet('arrivals'),
    fbGet('purpose'),
    fbGet('feedback'),
    fbGet('settings'),
  ]);
  return { checklist, shifts, departures, arrivals, purpose, feedback, settings };
}

// ═══════════════════════════════════════════════════════════
//  REAL-TIME LISTENERS  (data auto-refreshes when colleague
//  makes a change — call these after init)
// ═══════════════════════════════════════════════════════════

function listenDepartures(cb) { fbListen('departures', cb); }
function listenArrivals(cb)   { fbListen('arrivals',   cb); }
function listenChecklist(cb)  { fbListen('checklist',  cb); }
function listenShifts(cb)     { fbListen('shifts',     cb); }

// ═══════════════════════════════════════════════════════════
//  EXPORT DATA  (download full snapshot as JSON)
// ═══════════════════════════════════════════════════════════

async function exportAllData() {
  const snap = await fbGet('');   // entire hotel node
  const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ibis_backup_${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ═══════════════════════════════════════════════════════════
//  IMPORT DATA  (restore from JSON backup)
// ═══════════════════════════════════════════════════════════

async function importAllData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async e => {
      try {
        const data = JSON.parse(e.target.result);
        await fbSet('', data);
        resolve(data);
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}
