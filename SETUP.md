# Ibis Styles Ops Platform — Firebase Setup Guide

## Your Files

```
ibis_firebase/
├── index.html            ← Main app (open this in browser)
├── styles.css            ← All styling — edit colours/layout here
├── firebase-config.js    ← 🔴 PUT YOUR FIREBASE KEYS HERE
├── db.js                 ← All Firebase read/write logic
├── state.js              ← All app data / default values
├── utils.js              ← Shared helpers (clock, dates, toast)
├── natguess.js           ← Nationality guessing from names
├── departures.js         ← Departure board feature
├── arrivals-purpose.js   ← Arrivals + Purpose of Stay + file loader
├── shifts.js             ← Shift tasks (Morning/Afternoon/Mid/Night)
├── checklist.js          ← Night run checklist
├── reports.js            ← Nationality, Rented Rooms, Night Audit, Immigration
└── SETUP.md              ← This guide
```

---

## Step 1 — Create Firebase Project (5 minutes)

1. Go to **https://console.firebase.google.com**
2. Click **"Add project"**
3. Name it: `ibis-ops-dubai` (or anything you like)
4. Disable Google Analytics (not needed) → **Create project**
5. Wait for it to finish → **Continue**

---

## Step 2 — Enable Realtime Database

1. In the left sidebar → **Build → Realtime Database**
2. Click **"Create Database"**
3. Choose location: **Europe-west1** (closest to Dubai)
4. Start in **Test mode** (you can add security later)
5. Click **Enable**

---

## Step 3 — Get Your Config Keys

1. In the left sidebar → Click the **gear icon ⚙️** → **Project settings**
2. Scroll down to **"Your apps"** section
3. Click **"Add app"** → Choose **Web (</>)**
4. App nickname: `ibis-ops` → **Register app**
5. You will see a block like this:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "ibis-ops-dubai.firebaseapp.com",
  databaseURL: "https://ibis-ops-dubai-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "ibis-ops-dubai",
  storageBucket: "ibis-ops-dubai.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

6. **Copy these values**

---

## Step 4 — Paste Into firebase-config.js

Open `firebase-config.js` and replace the placeholder values:

```javascript
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSy...",          // paste your value
  authDomain:        "ibis-ops-dubai.firebaseapp.com",
  databaseURL:       "https://ibis-ops-dubai-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:         "ibis-ops-dubai",
  storageBucket:     "ibis-ops-dubai.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123456789:web:abc123"
};

const HOTEL_ID = "ibis_dubai";  // change if you have multiple properties
```

---

## Step 5 — Upload to GitHub & Enable GitHub Pages

1. Create a new GitHub repo (e.g. `ibis-ops`)
2. Upload **all 12 files** to the repo (keep them in the same folder)
3. Go to **Settings → Pages → Source → main branch → / (root) → Save**
4. Your app is live at:
   `https://YOUR-USERNAME.github.io/ibis-ops/`

Share this URL with your team. Everyone uses the same URL.

---

## Step 6 — Set Firebase Security Rules (Recommended)

In Firebase Console → Realtime Database → **Rules** tab, paste:

```json
{
  "rules": {
    "hotels": {
      "$hotel_id": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```

Click **Publish**. This keeps your hotel data separate if you ever add more properties.

---

## How Data Sync Works

| Action | What Happens |
|--------|-------------|
| Load departure report | Saves to Firebase instantly |
| Check out a room | All colleagues see it update live |
| Tick checklist step | Syncs to Firebase, everyone sees it |
| Add shift task | Saved immediately |
| Colleague opens the app | Loads latest data automatically |

**No refresh needed** — Firebase pushes updates in real time.

---

## Backup & Restore

- Click **💾** in the top bar → downloads full JSON backup
- Click **📂** → upload a backup JSON to restore data
- Firebase also keeps 30 days of automatic backups

---

## What Each File Does (for future editing)

| File | Edit this when you want to... |
|------|-------------------------------|
| `styles.css` | Change colours, fonts, card sizes, layout |
| `state.js` | Change default checklist steps, default shift tasks |
| `natguess.js` | Add more names to the nationality guessing list |
| `firebase-config.js` | Change Firebase project or hotel ID |
| `db.js` | Change how data is saved/loaded (structure) |
| `departures.js` | Change departure board behaviour |
| `arrivals-purpose.js` | Change arrivals/purpose of stay behaviour |
| `shifts.js` | Change shift task behaviour |
| `checklist.js` | Change night checklist behaviour |
| `reports.js` | Change nationality/audit/immigration reports |
| `utils.js` | Change clock format, toast messages, helper functions |
| `index.html` | Change page layout, add/remove sections |

