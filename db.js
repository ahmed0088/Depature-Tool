// ═══════════════════════════════════════════════════════════
// db.js — Firebase Realtime Database (v9 Modular)
// ═══════════════════════════════════════════════════════════

import { getDatabase, ref, set, get, push, remove, onValue, child } from "firebase/database";
import { FIREBASE_CONFIG, HOTEL_ID } from "./firebase-config.js";

let db = null;
let rootRef = null;

// Initialize Database
export function dbInit(firebaseApp) {
  if (!firebaseApp) {
    console.error("❌ Firebase App not passed to dbInit");
    return;
  }
  
  db = getDatabase(firebaseApp);
  rootRef = ref(db, `hotels/${HOTEL_ID}`);
  
  // Connection status
  const connectedRef = ref(db, '.info/connected');
  onValue(connectedRef, (snap) => {
    const online = snap.val();
    updateConnectionUI(online);
  });
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
export async function fbSet(path, data) {
  if (!rootRef) return lsSave(path, data);
  
  try {
    await set(child(rootRef, path), data);
    lsSave(path, data);
  } catch (e) {
    console.warn('[DB] fbSet failed:', e);
    lsSave(path, data);
  }
}

export async function fbGet(path) {
  if (!rootRef) return lsLoad(path);
  
  try {
    const snapshot = await get(child(rootRef, path));
    return snapshot.val();
  } catch (e) {
    console.warn('[DB] fbGet failed:', e);
    return lsLoad(path);
  }
}

export async function fbPush(path, data) {
  if (!rootRef) return;
  try {
    await push(child(rootRef, path), { ...data, _ts: Date.now() });
  } catch (e) {
    console.warn('[DB] fbPush failed:', e);
  }
}

export async function fbRemove(path) {
  if (!rootRef) return;
  try {
    await remove(child(rootRef, path));
  } catch (e) {
    console.warn('[DB] fbRemove failed:', e);
  }
}

export function fbListen(path, callback) {
  if (!rootRef) return;
  onValue(child(rootRef, path), (snapshot) => {
    callback(snapshot.val());
  });
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
  } catch (e) {
    return null;
  }
}

// Save functions
export async function saveChecklist(steps, done, skipped) {
  await fbSet('checklist', {
    steps,
    done: [...done],
    skipped: [...skipped],
    updatedAt: new Date().toISOString()
  });
}

// ... (keep your other save functions the same)

export async function saveShifts(shiftsObj) { ... }
export async function saveDepartures(rooms, log) { ... }
// etc.

// Load & Listen functions remain almost the same
export async function loadAll() { ... }

export function listenDepartures(cb) { fbListen('departures', cb); }
export function listenArrivals(cb) { fbListen('arrivals', cb); }
export function listenChecklist(cb) { fbListen('checklist', cb); }
export function listenShifts(cb) { fbListen('shifts', cb); }

// Export / Import
export async function exportAllData() { ... }
export async function importAllData(file) { ... }
