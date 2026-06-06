# 🏨 Ibis Styles · Ops Platform

> **Live front-desk operations dashboard** — departure tracking, arrivals, shift tasks, night audit checklist, and reporting. Synced in real-time via Firebase across all front-desk terminals.

---

## What It Does

The platform replaces paper checklists and scattered Opera exports with one live dashboard that every colleague on shift shares simultaneously. Changes made by one person appear instantly for everyone else — no refresh, no WhatsApp messages, no confusion.

---

## Modules

### 🚪 Departure Follow-Up
The core board. Paste the Opera departure report (Delimited Data) and every due-out room becomes a trackable card.

- **S / M / L / List views** — pick the density that works for your shift
- **Guest photo** — paste a screenshot directly onto a card (Ctrl+V) or drag and drop. Great for attaching a face shot from Outlook or a scanned ID
- **Statuses** — Due Out → Check Out / Extend / Late CO, each with undo
- **Guest intent** — flag "May Extend", "Coming Back", or "Returning Guest" with auto-stamped notes
- **Balance warnings** — red card border + confirmation prompt before checking out a guest who owes
- **Overdue highlight** — rooms still due after 12:00 surface automatically at the top
- **Departure countdown** — live timer badge showing time left until checkout deadline
- **Timestamped notes** — 🕐 Stamp button inserts `[HH:MM]` so notes are always traceable
- **Smart Reload** — paste a fresh Opera report mid-shift; existing statuses, notes, and photos are preserved
- **Action log** — full history of every checkout, extension, and late CO, with undo

### 🛎️ Arrivals
Paste or upload the Opera arrivals Excel/CSV. Tracks room, name, purpose, nights, nationality, email, and booking source.

- **AI Nationality** — one click guesses nationality from guest names using a built-in name map
- **Filters** — All / Business / Leisure with live search
- **Manual add** — add walk-ins or reservations not in the report

### 📋 Purpose of Stay
Night audit report. Mirror arrivals data or load separately. Used to categorise in-house guests as Business / Leisure / Flight crew.

- Sync directly from Arrivals with one button
- Export to Excel for Opera upload
- Editable title (e.g. "Purpose of Stay — 14 May 2026")

### ✅ Night Run Checklist
17-step checklist covering the full night audit workflow — Before Run, Night Run, and After Run phases.

- **Clean card design** — coloured step numbers, tag pills (CHECK / SAVE / SCAN / CHARGE / RUN), phase progress counters
- **Tick to complete** — completion time stamped automatically
- **Skip** — mark steps N/A without losing progress count
- **Per-step notes** — add context that saves with Firebase
- **Photo attachments** — attach reference screenshots to any step (stored compressed)
- **Edit mode** — rename, reorder (drag or ↑↓), add, or delete steps. Changes persist across all terminals
- **New Night** — resets ticks and notes while keeping steps and photos

### ⏰ Shift Tasks
Four shifts — Morning, Afternoon, Mid, Night — each with their own task list.

- Tick off tasks as you go, progress bar per shift
- Add tasks with optional hint text
- Drag-to-reorder or use ↑↓ buttons
- Reset per shift (prompts for confirmation)
- All four shifts sync live across all front desk terminals

### 🌍 Nationality Report
Paste the Opera `stat_countrybyday` report. Validates totals against your Excel template and generates 240 copy-ready rows.

- Flags unknown or unmatched nationalities
- Shows gap analysis (Arrivals / Room Nights / Guest Nights)
- One-click copy — paste straight into Excel cell B8

### 🛏️ Rented Rooms & Beds
Combines `history_forecast` and `statroomtype` Opera reports to calculate total rented rooms and beds (including twin beds from TWC room types).

### 🌙 Night Audit · PM Rooms
Compare Opera in-house guest data against the Management Excel PM sheet. Highlights every room where name, dates, or balance differ.

- Green = Opera (correct) · Red = Excel (wrong)
- Generates corrected rows ready to paste back into Excel

### 🛂 Immigration Check
Upload the Opera Immigration XML export. Flags every in-house guest missing nationality, gender, passport number, or first name — sorted by severity.

---

## File Structure

```
index.html          — App shell, layout, all modals
styles.css          — All styling and theming (dark + light)
firebase-config.js  — Firebase project credentials and HOTEL_ID
db.js               — Firebase Realtime Database layer (read/write/listen)
state.js            — Shared app state (rooms, guests, shifts, etc.)
utils.js            — Clock, clipboard, date formatters, toast notifications
natguess.js         — Name → nationality lookup map
departures.js       — Departure board logic and card rendering
arrivals-purpose.js — Arrivals and Purpose of Stay logic
shifts.js           — Shift task rendering and persistence
checklist.js        — Night audit checklist rendering and photo handling
reports.js          — Nationality, Rented Rooms, PM Audit, Immigration
ibis_data.json      — Default data structure (used for fresh installs)
```

---

## Setup

### 1. Firebase
The app uses Firebase Realtime Database for live sync. Credentials are already configured in `firebase-config.js`.

All colleagues using the same `HOTEL_ID` share one live dataset. No login required — just open the page.

```js
const HOTEL_ID = "ibis_dubai";
```

To run it for a different property, change `HOTEL_ID` to any unique string.

### 2. Hosting
Drop all files into any static web host (Netlify, Vercel, GitHub Pages, or a local server). No build step needed — plain HTML, CSS, and JS.

```bash
# Quick local test
npx serve .
# or
python3 -m http.server 8080
```

### 3. Backup & Restore
- **💾 Export** — downloads a full JSON snapshot of all live data
- **📂 Import** — restores from a JSON backup (reloads the page after import)

---

## How Opera Reports Work

Every data source comes from Opera Cloud exports. The formats expected:

| Module | Opera path | Format |
|---|---|---|
| Departures | Front Desk → Departures → Download | Delimited Data (.txt) |
| Arrivals | Front Desk → Arrivals | Excel or CSV |
| Nationality | Reports → Nationality by Country | Delimited Data (.txt) |
| Rented Rooms (1) | Reports → History Forecast | Delimited Data (.txt) |
| Rented Rooms (2) | Reports → Stat Room Type | Delimited Data (.txt) |
| Night Audit PM | Front Desk → In-House by Room | Delimited Data (.txt) |
| Immigration | Front Desk → Immigration Report → Export | XML |

For departures: Opera Cloud → Front Desk → Departures → Download as Delimited Data → open `.txt` → Ctrl+A → Ctrl+C → paste into the app.

---

## Guest Photos on Departure Cards

1. Open Outlook (or any window with the guest photo)
2. Take a screenshot — **Windows: Win+Shift+S** or **Print Screen**
3. Click the photo zone on any departure card
4. The app will say "Ready — press Ctrl+V to paste"
5. Press **Ctrl+V**

The image is compressed and saved to Firebase automatically. You can also drag and drop an image file directly onto the photo zone.

Click a photo to zoom. The ✕ button (appears on hover) removes it.

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Escape` | Close any open modal or photo zoom |

---

## Real-Time Sync

The app listens to Firebase with `.on('value')` listeners. This means:

- Any change made by one colleague appears on everyone else's screen **within ~1 second**, without any page refresh
- The Firebase status indicator (top-right) shows **Firebase · Live** when connected, **Firebase · Offline** when not
- All data is also saved to `localStorage` as a fallback — if Firebase is temporarily unreachable, the app keeps working and syncs when the connection is restored

---

## Theme

Toggle between **dark** (default) and **light** mode using the 🌙 button in the top bar. Theme preference saves to Firebase and applies on next load.

---

## Feedback

Use the 💬 button in the top bar to submit bugs, feature requests, or general feedback. Submissions are saved to Firebase and visible to the team.

---

*Built for Ibis Styles Dubai — front desk operations, 2026*
