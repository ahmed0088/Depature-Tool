// ═══════════════════════════════════════════════════════════
//  db.js  —  Firebase Realtime Database layer
//  Real-time sync: all colleagues see changes instantly,
//  no page refresh needed.
// ═══════════════════════════════════════════════════════════

let _db     = null;
let _ref    = null;
let _online = false;

function dbInit() {
  try {
    _db  = firebase.database();
    _ref = _db.ref(`hotels/${HOTEL_ID}`);
    console.log('✅ Firebase DB ready — hotel:', HOTEL_ID);
    _db.ref('.info/connected').on('value', snap => {
      _online = !!snap.val();
      updateConnectionUI(_online);
    });
  } catch (e) {
    console.error('❌ dbInit failed:', e);
    updateConnectionUI(false);
  }
}

function updateConnectionUI(online) {
  const dot = document.getElementById('fbDot');
  const lbl = document.getElementById('fbLabel');
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

// ── Helpers ───────────────────────────────────────────────
async function fbSet(path, data) {
  lsSave(path, data);
  if (!_ref) return;
  try { await _ref.child(path).set(data); }
  catch (e) { console.warn('[DB] fbSet failed (saved locally):', e); }
}

async function fbGet(path) {
  if (!_ref) return lsLoad(path);
  try {
    const snap = await _ref.child(path).once('value');
    const val  = snap.val();
    if (val !== null) lsSave(path, val);
    return val;
  } catch (e) { return lsLoad(path); }
}

// KEY FUNCTION: .on('value') fires immediately AND on every future change.
// This is what makes real-time sync work without refresh.
function fbListen(path, cb) {
  if (!_ref) { cb(lsLoad(path)); return; }
  _ref.child(path).on('value', snap => {
    const val = snap.val();
    if (val !== null) lsSave(path, val);
    cb(val);
  }, err => {
    console.warn('[DB] listener error:', path, err);
    cb(lsLoad(path));
  });
}

function lsSave(path, data) {
  try { localStorage.setItem('ibis_' + path.replace(/\//g,'_'), JSON.stringify(data)); } catch(e) {}
}
function lsLoad(path) {
  try { const v = localStorage.getItem('ibis_' + path.replace(/\//g,'_')); return v ? JSON.parse(v) : null; } catch(e) { return null; }
}

// ── Save functions ────────────────────────────────────────
// In db.js - verify these functions exist
async function saveDepartures(rooms, log) {
  await fbSet('departures', { rooms, log, date: new Date().toISOString().split('T')[0], updatedAt: new Date().toISOString() });
}

async function saveArrivals(guests) {
  await fbSet('arrivals', { guests, date: new Date().toISOString().split('T')[0], updatedAt: new Date().toISOString() });
}

async function savePurpose(guests) {
  await fbSet('purpose', { guests, date: new Date().toISOString().split('T')[0], updatedAt: new Date().toISOString() });
}

async function saveShifts(shiftsObj) {
  await fbSet('shifts', { data: shiftsObj, updatedAt: new Date().toISOString() });
}

async function saveFeedback(log) {
  await fbSet('feedback', { log, updatedAt: new Date().toISOString() });
}

async function saveSettings(settings) {
  const current = await fbGet('settings') || {};
  await fbSet('settings', { ...current, ...settings, updatedAt: new Date().toISOString() });
}

// Add to db.js - loads all data from Firebase in one call
async function loadAll() {
  try {
    const [departures, arrivals, purpose, checklist, shifts, feedback, settings] = await Promise.all([
      fbGet('departures'),
      fbGet('arrivals'),
      fbGet('purpose'),
      fbGet('checklist'),
      fbGet('shifts'),
      fbGet('feedback'),
      fbGet('settings')
    ]);
    
    return {
      departures: departures || { rooms: [], log: [] },
      arrivals: arrivals || { guests: [] },
      purpose: purpose || { guests: [] },
      checklist: checklist || { steps: [], done: [], skipped: [] },
      shifts: shifts || { data: null },
      feedback: feedback || { log: [] },
      settings: settings || {}
    };
  } catch (e) {
    console.warn('loadAll error:', e);
    return {
      departures: { rooms: [], log: [] },
      arrivals: { guests: [] },
      purpose: { guests: [] },
      checklist: { steps: [], done: [], skipped: [] },
      shifts: { data: null },
      feedback: { log: [] },
      settings: {}
    };
  }
}

// ── Real-time listeners ───────────────────────────────────
// Each one fires immediately with current data, then again on every change.
function listenDepartures(cb) { fbListen('departures', cb); }
function listenArrivals(cb)   { fbListen('arrivals',   cb); }
function listenPurpose(cb)    { fbListen('purpose',    cb); }
function listenChecklist(cb)  { fbListen('checklist',  cb); }
function listenShifts(cb)     { fbListen('shifts',     cb); }
function listenSettings(cb)   { fbListen('settings',   cb); }

// ── Export / Import ───────────────────────────────────────
async function exportAllData() {
  const snap = await fbGet('');
  const blob = new Blob([JSON.stringify(snap, null, 2)], {type:'application/json'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'ibis_backup_' + new Date().toISOString().split('T')[0] + '.json';
  a.click(); URL.revokeObjectURL(a.href);
}
async function importAllData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async e => {
      try { const data = JSON.parse(e.target.result); await fbSet('', data); resolve(data); }
      catch (err) { reject(err); }
    };
    reader.readAsText(file);
  });
}

// ── Checklist ─────────────────────────────────────────────
async function saveChecklist(steps, done, skipped, photos, notes, doneTimes) {
  await fbSet('checklist', {
    steps,
    done:      [...done],
    skipped:   [...skipped],
    photos:    photos    || {},
    notes:     notes     || {},
    doneTimes: doneTimes || {},
    updatedAt: new Date().toISOString()
  });
}
