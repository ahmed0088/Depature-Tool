# 🏨 Ibis Ops Platform

A front-office operations web app built for daily hotel shift work — departures, arrivals, night audit, shift tasks, and guest tracking, all synced in real time across every device on the team via Firebase.

No build step, no framework. Plain HTML/CSS/JS, deployable by dropping the files on any static host.

---

## What it does

| Module | File(s) | What it's for |
|---|---|---|
| 🚪 **Departures** | `departures.js` | Follow-up board for today's checkouts — status tracking (due/late/extended/DND/no-answer), balance flags, VIP badges, guest intent, HK copy formats, overdue alerts, swipe actions, trend history |
| 🛎️ **Arrivals** | `arrivals-purpose.js` | Arrivals list and Purpose-of-Stay report, nationality/origin tracking. Every guest's booking source is auto-categorised (Walk-in / ALL App / OTA / Corporate / Other) with a filter row and a live color-coded badge — a blank source is treated as a direct ALL App booking, not a walk-in |
| 🔗 **Arr vs Dep** | `arr-dep-xref.js` | Cross-references arrivals against the departure board to instantly verdict "can this guest extend?" |
| 📊 **Arrivals Processor** | `arrivals-proc.js` | Opera export → package-code mapping → day-by-day F&B/upsell breakdown → Excel export |
| ✅ **Night Checklist** | `checklist.js` | Night audit steps with photos, notes, timestamps, phase grouping |
| 🕐 **Shift Tasks** | `shifts.js` | Per-shift (Morning/Afternoon/Mid/Night) task lists with drag-reorder (or ↑/↓ buttons on mobile) and an activity log that records who did what and syncs across devices |
| 🚫 **No-Show Tracker** | `noshow.js` | No-show guest list with rebooking/confirmation tracking |
| 🌍 **Nationality Report** | `reports.js` | Opera `stat_countrybymon` delimited export → normalised country names → arrivals/room-nights/guest-nights breakdown |
| 🛏️ **Rented Rooms & Beds** | `reports.js` | Opera vs. Excel PM-room comparison for the night audit rented-room count |
| 🌙 **Night Audit · PM Rooms** | `reports.js` | Compares Opera and Excel pseudo-room exports and flags mismatches before the audit runs |
| 🛂 **Immigration Check** | `reports.js` | Cross-checks in-house guests against the Inhouse/Vicas XML and arrivals list to flag anyone missing from immigration reporting |
| ⏳ **TD 30-Day Audit** | `td-audit.js` | Tracks Tourism Dirham posting compliance over a rolling 30-day window |
| 🧮 **Inhouse Tally** | `inhouse-tally.js` | Reconciles Opera's in-house guest count/names against an XML export |
| ⬡ **Adagio Pro** | inline in `index.html` | Long-stay collections — upload a tracking sheet to flag high balances, cheque due-dates, and departure risk |
| 🏛️ **Tourism Tax** | `tourism-tax.js` | Flags guests needing a TD Portal date correction |
| 🧠 **Guest Memory** | `guest-memory.js` | Password-locked profile store — remembers nationality, email, purpose, origin per guest name for auto-fill on future stays. Owners bypass the password entirely (their account login already proves who they are); everyone else unlocks it once per 30-minute session |
| 👥 **Auth & Roles** | `auth.js` | Firebase Authentication, role-based panel access, admin user management, activity log |
| 💾 **Data layer** | `db.js` | Firebase Realtime Database read/write with automatic localStorage fallback when offline |

Shared utilities live in `utils.js`, `state.js`, and `natguess.js` (name-based nationality guesser). `escapeHtml()`/`escapeJsAttr()` in `utils.js` are the single canonical helpers for safely rendering guest-entered text — every panel that injects free text into the page routes through them.

---

## Cross-cutting features

These aren't tied to one panel — they work across the whole app:

- **🔍 Global Search** (`global-search.js`) — press `Ctrl+K` or tap the search icon to jump straight to a room, guest, checklist step, or shift task from anywhere.
- **📋 Shift Handover Digest** (`handover.js`) — one tap builds a copy/print-ready handover note combining a live status snapshot with the shared activity log.
- **↺ Undo toasts** (`utils.js`) — destructive actions (deleting a task, resetting the checklist) happen instantly but leave a 6–8 second window to undo instead of a blocking confirm popup.
- **📱 PWA / offline install** (`manifest.json`, `sw.js`, `icons/`) — installable to a phone/tablet home screen; the app shell loads even with no signal (live data still needs a connection). See [Updating after a deploy](#updating-after-a-deploy) — this is the one file every code change needs to touch.
- **⌨️ Keyboard shortcuts** — `1`–`0` to jump between panels, `?` for the full cheat sheet, `/` to focus search, `T` to cycle themes. See the in-app shortcut sheet for the complete list.
- **🎨 Three themes** — Night Ops (dark gold), Opera Cloud (light red), Midnight (deep blue) — synced per user profile. The login screen keeps its own dark, glassy look in all three (a deliberate choice) and only re-tints its accent color to match, with a staggered entrance animation and a real loading spinner on sign-in.
- **📊 Every data table is mobile-friendly** — tables in Arrivals, Purpose of Stay, Nationality, Reports, etc. share one component (`.tbl-wrap`) that keeps the first column (room/name) pinned while the rest of a wide row scrolls sideways, so you never lose track of which guest you're looking at on a phone.

### Departures — the deep end

Because it's the highest-traffic panel, Departures got extra investment:

- Status auto-promotion (due → late past checkout time), LCO time picker, extension workflow with Opera-sync confirmation tracking
- Balance-owing and VIP flags, guest intent banners (may extend / coming back / returning)
- Bulk select with smart time-window selection, multiple copy formats for housekeeping handoff
- **🔁 Returning-guest badge** — pulls from Guest Memory automatically, no extra lookup needed
- **🔔 Overdue alerts** — a background check every 60s beeps (Web Audio, works offline) and fires a browser notification the moment a room crosses into overdue, so you don't have to be staring at the screen
- **👆 Swipe gestures** — on mobile, swipe a card right to check out, left to mark DND
- **📈 7-day trend chart** — average late checkouts, extensions, and balance-owing rooms per day, tracked automatically in the background
- Full Excel export, undo log, print view

---

## Roles & permissions

Defined in `auth.js` (`ROLES` object):

| Role | Panels | Manage users | Export | Import | Clear data |
|---|---|:---:|:---:|:---:|:---:|
| 👑 Owner | Everything, including Adagio Pro — owner bypasses panel gating entirely, so any panel added later is visible automatically | ✓ | ✓ | ✓ | ✓ |
| 🏅 Manager | Same as Owner *except* Adagio Pro | ✓ | ✓ | — | — |
| ⭐ Supervisor | Same as Manager | — | ✓ | — | — |
| 🛎️ Agent | Departures, Arrivals, Arr vs Dep, Shifts, Checklist, No-Show | — | — | — | — |
| 👁️ Read Only | Departures, Arrivals, Arr vs Dep, Shifts | — | — | — | — |

Owner also skips Guest Memory's panel password automatically (see above) and every other per-capability check (`canExport`, `canDelete`, `canForceLogout`, etc.) in `applyRole()` — adding a new gated feature never needs an owner-specific carve-out.

Every action (checkouts, checklist ticks, shift task changes, user management) writes to a shared `activityLog` in Firebase — this is what powers the admin activity panel and the Shift Handover Digest.

---

## Tech stack

- **Frontend:** Vanilla JavaScript, HTML, CSS — no build tools, no bundler
- **Backend:** Firebase Realtime Database (data sync) + Firebase Authentication (login/roles)
- **Offline:** `localStorage` fallback baked into every read/write in `db.js`; service worker caches the app shell for full offline install
- **Libraries (via CDN):** SheetJS/XLSX (Excel export), PDF.js (PDF parsing)

---

## Setup

1. **Firebase project** — create one at [console.firebase.google.com](https://console.firebase.google.com), enable **Realtime Database** and **Authentication** (Email/Password).
2. **`firebase-config.js`** — not included in this repo (keeps credentials out of version control). Create it yourself:
   ```js
   const firebaseConfig = {
     apiKey: "...",
     authDomain: "...",
     databaseURL: "...",
     projectId: "...",
     // ...
   };
   firebase.initializeApp(firebaseConfig);
   const HOTEL_ID = "your-hotel-id"; // scopes all data under hotels/{HOTEL_ID}
   ```
3. **Host it** — any static host works (Firebase Hosting, GitHub Pages, Netlify). Just make sure the whole folder — including `icons/`, `manifest.json`, and `sw.js` — sits together at the same level as `index.html`.
4. **First login** creates an Owner account automatically (see `auth.js` master-bypass logic) — from there, use the admin panel (👥 icon, Owner/Manager only) to add your team.

### Updating after a deploy

The service worker caches app files **cache-first** for offline use — a returning browser gets the old cached copy instantly, with a network refresh only landing in the cache for *next* time. That means a code change with no version bump can sit invisible to existing users indefinitely. **Every time any cached file changes** (that's `index.html`, `styles.css`, and every `.js` file in `SHELL_FILES`), bump `CACHE_NAME` in `sw.js` (e.g. `ibis-ops-shell-v5` → `v6`) so returning devices pick up the new version instead of a stale one. After deploying, existing users need one full close-and-reopen (or hard refresh) for the new service worker to take over.

---

## File map

```
index.html              Shell — nav, panels, modals, keyboard shortcuts, Adagio Pro
styles.css               All styling, 3 themes
manifest.json / sw.js     PWA install + offline app-shell caching
icons/                    App icons for home-screen install
setup-account.html        Standalone first-time owner account creation page

db.js                     Firebase read/write + localStorage fallback
state.js                  Shared global state (arrays, checklist steps, shift defaults)
utils.js                  Clipboard, toasts, undo-toast, date/name parsing, theme
                          switching, escapeHtml()/escapeJsAttr() (safe HTML rendering)
auth.js                   Login, roles, admin panel, activity log
global-search.js          Ctrl+K command palette
handover.js               Shift handover digest

departures.js             Departure board (see "deep end" above)
arrivals-purpose.js       Arrivals / purpose of stay, booking-source categorisation
arr-dep-xref.js           Arrivals ↔ Departures extension cross-reference
arrivals-proc.js          Opera arrivals report processor
noshow.js                 No-show tracker
tourism-tax.js            TD Portal date-correction flagging
checklist.js              Night audit checklist
shifts.js                 Per-shift task lists + synced activity log
guest-memory.js           Returning-guest profile store, owner password bypass
natguess.js               Nationality guesser from guest names
reports.js                Nationality report, rented rooms, night audit PM-room
                          compare, immigration check
td-audit.js               TD 30-day compliance audit
inhouse-tally.js          Opera vs. XML in-house guest count reconciliation
```

---

## Known limitations

- Live data (Firebase) still needs a connection — the offline install covers the app shell only, not real-time sync.
- Trend history (`depTrends`) starts accumulating from first use; there's no way to backfill past days.
- `firebase-config.js` must be supplied separately — it's intentionally excluded from this bundle to avoid leaking credentials.
