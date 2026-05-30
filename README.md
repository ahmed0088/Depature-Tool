# Ibis Ops Platform
### Ibis Styles Dubai · Front Desk Operations · 2026

A live operations dashboard built for hotel front desk teams. Every module syncs in real time across all terminals via Firebase — no refresh, no paper checklists, no WhatsApp coordination.

---

## Modules

### 🚪 Departure Follow-Up
Paste the Opera departure report and every due-out room becomes a live trackable card. Mark rooms as checked out, extended, or late checkout — all with undo. Includes guest photos, balance warnings, overdue highlights, timestamped notes, and a full action log. Smart Reload preserves all statuses and notes when you paste a fresh report mid-shift.

### 🛎️ Arrivals
Paste or upload the Opera arrivals report. Tracks room, name, nationality, nights, and booking source. One-click AI nationality guess from guest names. Manual add for walk-ins not in the report.

### 📋 Purpose of Stay
Night audit categorisation — Business / Leisure / Flight Crew. Sync directly from Arrivals with one button, or load separately. Export to Excel for Opera upload. Report title is editable.

### ✅ Night Run Checklist
17-step checklist covering the full night audit workflow — Before Run, Night Run, and After Run phases. Each step has a tag (CHECK / SAVE / SCAN / CHARGE / RUN), per-step notes, photo attachments, and an automatic completion timestamp. Edit mode lets you rename, reorder, add, or delete steps. New Night resets ticks without touching step configuration.

### ⏰ Shift Tasks
Four shifts — Morning, Afternoon, Mid, Night — each with a task list, progress bar, and activity log. Add tasks with optional hint text, drag to reorder, reset per shift. All four shifts sync live across every terminal.

### 🌍 Nationality Report
Paste the Opera `stat_countrybyday` report. Validates totals, flags unknown nationalities, and generates 240 copy-ready rows to paste straight into Excel cell B8 for DET submission.

### 🛏️ Rented Rooms & Beds
Combines the Opera `history_forecast` and `statroomtype` reports to calculate total rented rooms and beds, including twin beds from TWC room types.

### 🌙 PM Rooms Audit
Compare Opera in-house guest data against the Management Excel PM sheet. Highlights every room where name, dates, or balance differ. Generates corrected rows ready to paste back into Excel.

### 🛂 Immigration Check
Upload the Opera Immigration XML export. Flags every in-house guest missing nationality, gender, passport number, or first name — sorted by severity.

### 🧾 Tourism Tax · TD Portal
Finds guests where Opera marks the arrival time with an asterisk (*) — meaning they physically checked in the next calendar day after their booking date. Shows the corrected TD portal arrival date for each room so you can fix it manually.

---

## Opera Cloud · Report Sources

| Module | Opera Path | Format |
|---|---|---|
| Departures | Front Desk → Departures → Download | Delimited Data (.txt) |
| Arrivals | Front Desk → Arrivals → Export | Excel or CSV |
| Tourism Tax | Front Desk → Arrivals → Export | Delimited Data (.txt) |
| Nationality | Reports → stat_countrybyday | Delimited Data (.txt) |
| Rented Rooms (1) | Reports → history_forecast | Delimited Data (.txt) |
| Rented Rooms (2) | Reports → statroomtype | Delimited Data (.txt) |
| PM Rooms Audit | Front Desk → In-House by Room | Delimited Data (.txt) |
| Immigration | Front Desk → Immigration Report → Export | XML |

For departures: Opera Cloud → Front Desk → Departures → Download as Delimited Data → open the .txt file → Ctrl+A → Ctrl+C → paste into the app.

---

## File Structure

```
index.html           — App shell, layout, all modals and panels
styles.css           — All styling and theming (three colour schemes)
firebase-config.js   — Firebase credentials and HOTEL_ID
db.js                — Firebase Realtime Database read / write / listen
state.js             — Shared app state (rooms, guests, shifts, etc.)
utils.js             — Clock, clipboard, date parsers, toast notifications
natguess.js          — Name → nationality lookup map
departures.js        — Departure board logic and card rendering
arrivals-purpose.js  — Arrivals and Purpose of Stay logic
shifts.js            — Shift task rendering and persistence
checklist.js         — Night audit checklist and photo handling
reports.js           — Nationality, Rented Rooms, PM Audit, Immigration
tourism-tax.js       — TD Portal date correction tool
ibis_data.json       — Default data structure for fresh installs
```

---

## Setup

### 1. Firebase
Go to console.firebase.google.com → Add project → Enable Realtime Database (Europe-west1, test mode). Credentials are already configured in `firebase-config.js` for Ibis Dubai.

All colleagues sharing the same `HOTEL_ID` share one live dataset. No login required — just open the URL.

```js
const HOTEL_ID = "ibis_dubai";
```

To run for a different property, change `HOTEL_ID` to any unique string.

### 2. Hosting
Drop all files into GitHub Pages, Netlify, Vercel, or any static host. No build step needed — plain HTML, CSS, and JS.

```bash
# Quick local test
npx serve .
# or
python3 -m http.server 8080
```

### 3. Security Rules
In Firebase Console → Realtime Database → Rules, paste:

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

This keeps each property's data isolated if you ever add more properties.

---

## Real-Time Sync

The app uses Firebase `.on('value')` listeners — any change made by one colleague appears on everyone else's screen within about one second, without any page refresh.

The Firebase status indicator in the top bar shows **Firebase · Live** when connected and **Firebase · Offline** when not. If the connection drops, the app continues working from localStorage and pushes all changes back to Firebase once reconnected — nothing is lost.

---

## Guest Photos on Departure Cards

1. Open Outlook or any window with the guest photo
2. Take a screenshot — Windows: **Win+Shift+S** or Print Screen
3. Click the photo zone on the departure card
4. The app will say "Ready — press Ctrl+V to paste"
5. Press **Ctrl+V**

The image is compressed and saved to Firebase automatically. You can also drag and drop an image file directly onto the photo zone. Click a photo to zoom, hover for the ✕ remove button.

---

## Backup & Restore

- **💾 Export** — downloads a full JSON snapshot of all live data
- **📂 Import** — restores from a JSON backup (page reloads after import)

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Escape` | Close any open modal, drawer, or photo zoom |
| `Ctrl+V` | Paste screenshot onto a departure card photo zone (click zone first) |

---

*Ibis Styles Dubai · Front Desk Operations · 2026*
