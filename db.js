// ═══════════════════════════════════════════════════════════
//  db.js  —  Firebase Realtime Database layer
//  Real-time sync: all colleagues see changes instantly,
//  no page refresh needed.
// ═══════════════════════════════════════════════════════════

let _db     = null;
let _ref    = null;
let _online = false;
// Set when Firebase actively rejects us — as opposed to simply being
// unreachable. Every call below falls back to localStorage on failure,
// which is right for a dropped connection but dangerous in silence: the
// app keeps showing yesterday's cache and keeps accepting edits that never
// leave the device. This is what makes that state visible.
let _dbError = '';

// Read-only accessor used by other modules (shifts.js, etc.)
function isOnline() { return _online; }
function dbError()  { return _dbError; }

// Firebase reports a rules rejection as PERMISSION_DENIED. That is a very
// different problem from being offline — usually the Realtime Database
// rules expired or were changed — so it is worth naming precisely.
function _dbNoteError(where, err) {
  const code = String(err && (err.code || err.message) || '').toUpperCase();
  const msg  = /PERMISSION[_ ]DENIED/.test(code)
    ? 'The database refused this device. Check the Realtime Database rules in the Firebase console — test-mode rules expire on a set date.'
    : `Could not reach the database (${where}).`;
  if (_dbError === msg) return;      // don't re-announce the same fault
  _dbError = msg;
  console.warn('[DB]', where, err);
  updateConnectionUI(_online);
  _dbShowBanner(msg);
}

function _dbClearError() {
  if (!_dbError) return;
  _dbError = '';
  const b = document.getElementById('dbErrorBanner');
  if (b) b.remove();
  updateConnectionUI(_online);
}

// Deliberately its own banner rather than a toast: a toast disappears, and
// a person needs to know their work is not being saved for as long as that
// is true. The connection pill is hidden on mobile, so this is the only
// signal a phone gets.
function _dbShowBanner(msg) {
  let b = document.getElementById('dbErrorBanner');
  if (!b) {
    b = document.createElement('div');
    b.id = 'dbErrorBanner';
    b.className = 'db-error-banner';
    document.body.appendChild(b);
  }
  b.innerHTML = `<span>⚠</span><span id="dbErrorText"></span>`
              + `<button type="button" class="db-error-x" aria-label="Dismiss">✕</button>`;
  b.querySelector('#dbErrorText').textContent = msg + ' Anything you change is being kept on this device only.';
  b.querySelector('.db-error-x').onclick = () => b.remove();
}

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
  if (_dbError) {
    dot.style.background = 'var(--rose)';
    dot.style.boxShadow  = '0 0 6px var(--rose)';
    lbl.textContent      = 'Firebase · Not saving';
  } else if (online) {
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
  try { await _ref.child(path).set(data); _dbClearError(); }
  catch (e) { _dbNoteError('saving ' + path, e); }
}

async function fbGet(path) {
  if (!_ref) return lsLoad(path);
  try {
    const snap = await _ref.child(path).once('value');
    const val  = snap.val();
    if (val !== null) lsSave(path, val);
    _dbClearError();
    return val;
  } catch (e) { _dbNoteError('reading ' + path, e); return lsLoad(path); }
}

// KEY FUNCTION: .on('value') fires immediately AND on every future change.
// This is what makes real-time sync work without refresh.
function fbListen(path, cb) {
  if (!_ref) { cb(lsLoad(path)); return; }
  _ref.child(path).on('value', snap => {
    const val = snap.val();
    if (val !== null) lsSave(path, val);
    _dbClearError();
    cb(val);
  }, err => {
    _dbNoteError('reading ' + path, err);
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

async function saveShiftLog(shiftLogsObj) {
  await fbSet('shiftLog', { data: shiftLogsObj, updatedAt: new Date().toISOString() });
}

async function saveFeedback(log) {
  await fbSet('feedback', { log, updatedAt: new Date().toISOString() });
}

async function saveArrLog(log) {
  await fbSet('arrLog', { log, updatedAt: new Date().toISOString() });
}

async function savePurposeLog(log) {
  await fbSet('purposeLog', { log, updatedAt: new Date().toISOString() });
}

async function saveNoShow(guests) {
  await fbSet('noshow', { guests, date: new Date().toISOString().split('T')[0], updatedAt: new Date().toISOString() });
}

async function saveSettings(settings) {
  const current = await fbGet('settings') || {};
  await fbSet('settings', { ...current, ...settings, updatedAt: new Date().toISOString() });
}

// Add to db.js - loads all data from Firebase in one call
async function loadAll() {
  try {
    const [departures, arrivals, purpose, checklist, shifts, feedback, settings,
           arrLogData, purposeLogData, shiftLogData, checkLogData, noshowData] = await Promise.all([
      fbGet('departures'),
      fbGet('arrivals'),
      fbGet('purpose'),
      fbGet('checklist'),
      fbGet('shifts'),
      fbGet('feedback'),
      fbGet('settings'),
      fbGet('arrLog'),
      fbGet('purposeLog'),
      fbGet('shiftLog'),
      fbGet('checkLog'),
      fbGet('noshow'),
    ]);

    return {
      departures:  departures  || { rooms: [], log: [] },
      arrivals:    arrivals    || { guests: [] },
      purpose:     purpose     || { guests: [] },
      checklist:   checklist   || { steps: [], done: [], skipped: [] },
      shifts:      shifts      || { data: null },
      feedback:    feedback    || { log: [] },
      settings:    settings    || {},
      arrLog:      arrLogData  || { log: [] },
      purposeLog:  purposeLogData || { log: [] },
      shiftLog:    shiftLogData   || { data: null },
      checkLog:    checkLogData   || { log: [] },
      noshow:      noshowData     || { guests: [] },
    };
  } catch (e) {
    console.warn('loadAll error:', e);
    return {
      departures: { rooms: [], log: [] },
      arrivals:   { guests: [] },
      purpose:    { guests: [] },
      checklist:  { steps: [], done: [], skipped: [] },
      shifts:     { data: null },
      feedback:   { log: [] },
      settings:   {},
      arrLog:     { log: [] },
      purposeLog: { log: [] },
      shiftLog:   { data: null },
      checkLog:   { log: [] },
      noshow:     { guests: [] },
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
function listenNoShow(cb)     { fbListen('noshow',     cb); }

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
