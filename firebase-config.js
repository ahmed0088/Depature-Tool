// ═══════════════════════════════════════════════════════════
//  firebase-config.js
//  Your Firebase project credentials
// ═══════════════════════════════════════════════════════════

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyC0EEgikhcpPKqIe4B4qeL4lbPRbxrHJjc",
  authDomain:        "ibis-ops-dubai.firebaseapp.com",
  databaseURL:       "https://ibis-ops-dubai-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:         "ibis-ops-dubai",
  storageBucket:     "ibis-ops-dubai.firebasestorage.app",
  messagingSenderId: "707337551887",
  appId:             "1:707337551887:web:aaba944d6f1ae9c05ca37a"
};

// App Check (Firebase → App Check → reCAPTCHA v3): paste the reCAPTCHA SITE key here (it is public,
// it is not a secret). Empty = App Check off. Turn on "Enforce" in Firebase only after the app works with it.
const APP_CHECK_SITE_KEY = '';

// All colleagues using the same HOTEL_ID share the same live data
// The hotel this device works in. After sign-in, tenant.js moves the device
// to the hotel the person was assigned to. "ibis_dubai" is the first hotel.
let HOTEL_ID = (function () {
  try { const h = localStorage.getItem('hotelops_hotel'); if (h && /^[a-z0-9_]{1,40}$/.test(h)) return h; } catch (_) {}
  return "ibis_dubai";
})();

/** Firebase App Check: only this app (not a copy or a script) may use the database. Off while the key is empty. */
function hoAppCheck() {
  try { if (typeof APP_CHECK_SITE_KEY === 'string' && APP_CHECK_SITE_KEY && firebase.appCheck) firebase.appCheck().activate(APP_CHECK_SITE_KEY, true); }
  catch (e) { console.warn('App Check could not start:', e); }
}
