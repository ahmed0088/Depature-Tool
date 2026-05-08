# 🏨 Ibis Styles Ops Platform

A hotel front-desk operations tool built for daily use at **Ibis Styles Dubai**.  
Runs in any browser. Real-time sync across all colleagues via **Firebase**.  
No installation. No server. Just open the link and work.

---

## ✨ What It Does

| Section | Purpose |
|---|---|
| 🚪 **Departure Follow-Up** | Load Opera departures, track checkouts, extensions, late checkouts. Live action log with undo. |
| 🛎️ **Arrivals** | Paste or upload Opera arrivals. AI nationality guessing. Export styled Excel. |
| 📋 **Purpose of Stay** | Night audit report. Sync from Arrivals. Export colour-coded Excel. |
| ⏰ **Shift Tasks** | 4 shifts (Morning / Afternoon / Mid / Night). Add, edit, delete tasks. Check off as you go. |
| 🌍 **Nationality Report** | Paste Opera stat file → maps 240 countries → copy to Excel in one click. |
| 🛏️ **Rented Rooms & Beds** | Combine History Forecast + Room Type stats → daily room/bed counts. |
| 🌙 **Night Audit · PM Rooms** | Compare Opera vs Excel PM rooms → highlights differences → corrected data ready to paste. |
| 🛂 **Immigration Check** | Upload Opera XML → flags missing nationality, gender, passport, first name. |
| ✅ **Night Run Checklist** | 17-step checklist (editable). Add, remove, edit steps. Progress saved to Firebase. |

---

## 🚀 Getting Started

### You need
- A free **Firebase** account → [console.firebase.google.com](https://console.firebase.google.com)
- A free **GitHub** account → [github.com](https://github.com)
- A browser (Chrome or Edge recommended)

### Setup takes about 15 minutes total

---

## 🔥 Firebase Setup (Step by Step)

### 1 — Create a Firebase Project
1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Click **"Add project"**
3. Name it: `ibis-ops-dubai`
4. Disable Google Analytics → **Create project**

### 2 — Enable Realtime Database
1. Left sidebar → **Build → Realtime Database**
2. Click **"Create Database"**
3. Location: **Europe-west1** (closest to Dubai)
4. Choose **Test mode** → **Enable**

### 3 — Get Your Config Keys
1. Click the **⚙️ gear icon** → **Project settings**
2. Scroll to **"Your apps"** → click **"Add app"** → choose **Web `</>`**
3. Nickname: `ibis-ops` → **Register app**
4. Copy the `firebaseConfig` object shown on screen

### 4 — Paste Keys into the App
Open `firebase-config.js` and replace the placeholder values:

```javascript
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSy...",
  authDomain:        "ibis-ops-dubai.firebaseapp.com",
  databaseURL:       "https://ibis-ops-dubai-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:         "ibis-ops-dubai",
  storageBucket:     "ibis-ops-dubai.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123456789:web:abc123"
};

// Change this if you have multiple properties
const HOTEL_ID = "ibis_dubai";
```

### 5 — Set Database Security Rules
In Firebase Console → Realtime Database → **Rules** tab → paste this → **Publish**:

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

---

## 🌐 Hosting on GitHub Pages (Free)

1. Create a new GitHub repository — e.g. `ibis-ops`
2. Upload **all 13 files** (keep them in the same folder, no subfolders)
3. Go to **Settings → Pages → Source → main branch → / (root) → Save**
4. Your app is live at:

```
https://YOUR-USERNAME.github.io/ibis-ops/
```

Share this URL with your team. Everyone opens the same link.

---

## 📁 File Structure

```
ibis_firebase/
│
├── index.html              ← App shell — all HTML panels & modals
├── styles.css              ← All styling — colours, fonts, layout
│
├── firebase-config.js      ← 🔴 YOUR FIREBASE KEYS GO HERE
├── db.js                   ← All Firebase read/write logic
│
├── state.js                ← App data — default steps, shift tasks, constants
├── utils.js                ← Shared helpers — clock, dates, clipboard, toast
├── natguess.js             ← Nationality guessing from guest names
│
├── departures.js           ← Departure board feature
├── arrivals-purpose.js     ← Arrivals + Purpose of Stay + Opera file loader
├── shifts.js               ← Shift tasks (4 shifts)
├── checklist.js            ← Night run checklist
├── reports.js              ← Nationality · Rented Rooms · Night Audit · Immigration
│
├── README.md               ← This file
└── SETUP.md                ← Detailed Firebase setup guide
```

---

## ⚡ How Real-Time Sync Works

When any colleague makes a change, **everyone sees it instantly** — no refresh needed.

```
Ahmed checks out Room 215
       ↓
Firebase updates instantly
       ↓
Sarah's screen shows Room 215 as "Checked Out" automatically
```

This works for:
- Departure checkouts, extensions, late checkouts
- Arrivals and purpose of stay data
- Night checklist ticks
- Shift task completions

---

## 💾 Backup & Restore

| Button | What it does |
|---|---|
| 💾 (top bar) | Downloads full JSON backup of all data |
| 📂 (top bar) | Upload a backup file to restore data |

Firebase also keeps your data safe in the cloud automatically.

---

## 🛠 Customising the App

| File to edit | When you want to... |
|---|---|
| `styles.css` | Change colours, card sizes, fonts, dark/light mode |
| `state.js` | Change default checklist steps or default shift tasks |
| `natguess.js` | Add more guest names to the nationality guesser |
| `firebase-config.js` | Switch to a different Firebase project |
| `db.js` | Change how/where data is stored in Firebase |
| `departures.js` | Change departure board cards or actions |
| `arrivals-purpose.js` | Change arrivals table or Excel export format |
| `shifts.js` | Change shift task UI or behaviour |
| `checklist.js` | Change checklist rendering or step editing |
| `reports.js` | Change any of the 4 report sections |
| `utils.js` | Change clock format, toast messages, date helpers |
| `index.html` | Add new sections, change nav items, add modals |

---

## 🎨 Changing Colours

All colours are CSS variables in `styles.css` at the top:

```css
:root {
  --gold:   #e8b84b;   /* main brand colour */
  --mint:   #3ecf8e;   /* success / checked out */
  --rose:   #f06b7a;   /* warnings / balance due */
  --sky:    #5ab4e8;   /* info / extended */
  --violet: #8b7cf8;   /* late checkout */
  --amber:  #f0a43a;   /* caution */
}
```

Change any value and it updates everywhere instantly.

---

## 📱 Supported Browsers

| Browser | Support |
|---|---|
| Chrome | ✅ Recommended |
| Edge | ✅ Full support |
| Firefox | ✅ Full support |
| Safari | ✅ Works |
| Mobile Chrome | ✅ Works (desktop layout) |

---

## 🔐 Security Notes

- The Firebase **Test mode** rules allow anyone with the URL to read/write
- For a hotel setting this is fine since you control who has the URL
- For stronger security, add Firebase Authentication (contact your developer)
- Never commit real API keys to a **public** GitHub repo — make the repo **private**

---

## 🐛 Troubleshooting

**App shows "Firebase · Offline"**
→ Check `firebase-config.js` — make sure all values are filled in correctly
→ Check your internet connection
→ Make sure the Realtime Database is enabled in Firebase console

**Data not syncing between colleagues**
→ Both must be on the same `HOTEL_ID` in `firebase-config.js`
→ Check Firebase Database Rules are published

**Nationality not guessing correctly**
→ Open `natguess.js` → add the surname to the correct nationality array

**Export to Excel not working**
→ Make sure `xlsx.full.min.js` CDN is loading (requires internet)

---

## 📞 Support

Built for the Front Desk team at **Ibis Styles Dubai**.  
For bugs or feature requests, use the **💬 button** inside the app.  
All feedback is saved to Firebase and can be exported.

---

*Last updated: May 2026 · v2.0*
