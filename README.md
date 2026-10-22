# 🏨 HotelOps

A front-office operations app for daily hotel shift work. It covers departures, arrivals, night audit, shift tasks, guest tracking, and a full **staff roster** with an automatic **roster builder**. Data syncs live between colleagues through Firebase, and the app keeps working offline.

It has no build step and no framework. It is plain HTML, CSS and JavaScript, installable as a PWA, and served from GitHub Pages.

> **Privacy rule for this repo:** it is public. Never commit real staff names, guest names, emails, phone numbers or rosters. Real data lives only in the app (Firebase / the browser), never in Git. Test fixtures use made-up names.

---

## What it does

### Front office

| Module | File(s) | What it's for |
|---|---|---|
| 🏠 **Home** | `home.js` | Today at a glance: what's due, alerts and shortcuts |
| 🚪 **Departures** | `departures.js` | Checkout follow-up board: due, late, extended, DND, balance and VIP flags, swipe gestures, overdue beeps, 7-day trend |
| 🛎️ **Arrivals / Purpose of stay** | `arrivals-purpose.js`, `guest-pipeline.js` | Arrivals list, booking-source grouping, nationality and origin |
| 🔗 **Arr vs Dep** | `arr-dep-xref.js` | "Can this guest extend?" check against the departure board |
| 📊 **Arrivals processor** | `arrivals-proc.js`, `package-audit.js` | Opera export → package codes → daily F&B / upsell breakdown → Excel |
| ✅ **Night checklist** | `checklist.js` | Night audit steps with photos, notes and timestamps |
| 🕐 **Shift tasks** | `shifts.js` | Morning / Afternoon / Mid / Night task lists and an activity log |
| ⏰ **Wake-up calls** | `wakeup.js` | Wake-up call list and reminders |
| 🚫 **No-shows** | `noshow.js` | No-show tracking |
| 🌍 **Reports** | `reports.js`, `month-end.js`, `trends.js` | Nationality, rented rooms, PM-room compare, immigration check, month end |
| 🏛️ **Tourism Dirham / DTCM** | `tourism-tax.js`, `td-audit.js`, `dtcm*.js` | TD portal corrections, 30-day audit, DTCM reconciliation and long stays |
| 🧮 **In-house tally** | `inhouse-tally.js` | Opera in-house list vs. XML export |
| 💲 **Rates** | `rates.js` | Rate lookup |
| 🧠 **Guest memory** | `guest-memory.js`, `natguess.js` | Remembers returning guests' details for auto-fill (locked) |
| 📚 **Standards / Learn** | `accor-standards.js`, `learn.js` | Brand standards and training |

### Roster (staff schedule)

| Part | File(s) | What it's for |
|---|---|---|
| 📅 **Roster page** | `roster.js` | The posted week for every hotel, swaps, ideas to make a week kinder |
| 👥 **Team** | `roster-team.js` | Each person: hotels they can work (✓ / ⚠️ only if no other option / 🚫 never), shifts, static day off, rest floor, Team Leader night tier |
| 📏 **Rules** | `roster-rules.js` | Desk cover per hotel, the **HR cut-off** (2 days off before the 15th and 2 after, never 2 in one week), **freeze** dates |
| 🏗️ **Builder** | `roster-build.js`, `roster-worker.js` | Builds next week automatically, checks a posted week ("📋 What we noticed"), fixes one person, PH balances |
| 🏖 **Holidays & vacation** | `roster-holidays.js`, `roster-vacation.js` | Public holidays, PH owed / taken, vacation (V) |
| 🔁 **Swaps / events / health** | `roster-swap.js`, `roster-events.js`, `roster-health.js` | Shift trades, roster history, fairness and rest checks |
| 📷 **Import** | `roster-image.js`, `roster-ocr.js` | Read a roster from Excel or a photo |
| 🎮 **Live desk & Rush Hour** | `roster-live.js`, `roster-game.js` | Live lobby view of who is on shift, plus a small mini-game with badges |

**How the roster reads times**
- A shift that starts before 04:00 belongs to the **night of that date**. For example, "00:00–09:00 on Saturday" is Saturday night, ending Sunday at 09:00.
- A **posted** roster (including one written by management outside the app) is final. The builder shows it exactly as posted and builds the next week on top of it.
- A PH in a posted roster is added to that person's balance and taken at once, so the balance stays even.

### Ops Brain (assistant)

`brain*.js` is an on-device assistant. It answers hotel questions (pool, gym, bar…), understands plain requests like "freeze days off from the 1st to the 15th", and takes you to the right page. It runs locally and calls **no paid AI services**.

### Across the whole app

- 🔍 **Global search**: `Ctrl+K` (`global-search.js`)
- 📋 **Shift handover digest** (`handover.js`), 📒 team log (`team-log.js`)
- ↺ **Undo toasts** for destructive actions
- ⌨️ **Keyboard**: `1`–`0` to switch panels, `?` for the cheat sheet, `/` to search, `T` to change theme, **`Esc` to close anything**
- 🎨 **19 themes** (Night Ops, iPhone, Opera, Midnight, Nord, Dracula, Sakura…), available on the login screen too
- 🌐 **7 languages** (English, العربية, Français, हिन्दी, Русский, 中文, Tagalog) and **12 fonts** (`i18n.js`, under Settings)
- ✨ **What's new** after every update (`whats-new.js`)
- 📱 **PWA**: installable, and the app shell works offline (`manifest.json`, `sw.js`)

---

## Roles

Roles are defined in `auth.js` (`ROLES`): 👑 Owner, 🏅 Manager, ⭐ Supervisor, 🛎️ Agent and 👁️ Read only. Each role decides which panels a person sees and whether they can export, import, delete or manage users. Every action is written to a shared activity log.

---

## Tech stack

- **Frontend:** vanilla JavaScript, HTML and CSS (`styles.css`, `pro.css`, `themes.css`)
- **Backend:** Firebase Realtime Database and Firebase Authentication
- **Offline:** `localStorage` fallback in `db.js`; the service worker caches the app shell
- **Libraries (CDN):** SheetJS (Excel), PDF.js (PDF), Tesseract (photo OCR)

---

## Setup

1. Create a Firebase project and enable **Realtime Database** and **Authentication (Email/Password)**. `SETUP.md` has step-by-step instructions.
2. Put your project's web config in **`firebase-config.js`**, which is committed in this repo. A Firebase *web* API key is not a secret: it only identifies the project. Your data is protected by the **database rules** below, not by hiding the key.
3. Create the first Owner account with `setup-account.html`. After that, add users from the 👥 admin panel.
4. Host the folder on any static host. This repo is served by GitHub Pages from `main`.

### Realtime Database rules

`database.rules.json` holds rules made for this app:
- Only signed-in members of a hotel can read or change that hotel's data.
- Only an Owner or Manager can add or change other people's accounts. Nobody can raise their own role or switch their own account back on, and a Manager can't make anyone an Owner.
- A disabled account (active = false) can't read or write anything.
- The person who creates a new hotel can set it up (its settings and the new owner's link) once.
- The very first account of a new hotel can still create itself as Owner.

To use them, open Firebase console → Realtime Database → **Rules**. **Copy your current rules somewhere first** (to undo if needed), paste the file, then try it in the **Rules Playground** and click **Publish**. Then sign in to the app and check that pages load and saving works.

---

## Development

```bash
python3 -m http.server 8765        # then open http://localhost:8765
node tests/run-tests.js            # regression tests (also run by GitHub Actions)
```

**Shipping a version**
1. Bump `APP_VERSION` in `utils.js`.
2. Add an entry at the top of `WHATS_NEW` in `whats-new.js`, written in plain words.
3. Run the tests, then commit and push to `main`.

The service worker sees the new version and refreshes users' cached files.

---

## File map

```
index.html            Shell: nav, panels, modals, login
styles.css pro.css themes.css   Styling and the 19 themes
manifest.json sw.js   PWA install and offline cache
setup-account.html    First Owner account
firebase-config.js    Firebase web config (public by design; rules protect data)

db.js state.js utils.js tenant.js hotel-settings.js hotel-setup.js brand.js   Core: data, state, helpers, hotels, logos
auth.js               Login, roles, admin, activity log
i18n.js settings.js   Languages, fonts, user settings
global-search.js handover.js team-log.js whats-new.js install-prompt.js file-router.js

home.js departures.js arrivals-*.js arr-dep-xref.js guest-*.js noshow.js wakeup.js
checklist.js shifts.js reports.js month-end.js trends.js history.js rates.js
tourism-tax.js td-audit.js dtcm*.js inhouse-tally.js package-audit.js smart-fill.js
natguess.js nat-extra.js accor-standards.js learn.js skip-clean.js neorcha-scraper.js

roster.js roster-*.js  Roster, team, rules, builder, holidays, swaps, import, live desk, game
brain*.js             Ops Brain assistant (on device)

tests/                run-tests.js + anonymised fixtures
database.rules.json   Firebase Realtime Database rules (paste in the Firebase console)
SECURITY.md .gitignore .github/dependabot.yml   Repo safety: how to report, what never gets committed, CI updates
scripts/              Helper scripts
.github/workflows/    CI: syntax check and tests on every push
```

---

## Security checklist (for the repo owner)

- Turn on **2FA** (or a passkey) for the GitHub account.
- **Settings → Code security**: enable *Secret scanning*, *Push protection* and *Dependabot alerts*.
- **Settings → Branches / Rules**: protect `main` by blocking force-pushes and deletion, and requiring the *Tests* check.
- **Settings → Collaborators / Deploy keys / GitHub Apps**: remove anything you don't recognise.
- **Firebase**: publish `database.rules.json` (see Setup); never leave the rules in *test mode*. In Google Cloud → Credentials, restrict the web API key to your site (`https://<user>.github.io/*`).
- Keep real people's data out of commits. If something private was committed, removing it in a new commit is not enough, because it stays in history. Rotate any leaked secret first, then clean history.

---

## Known limitations

- Live sync needs a connection; offline mode covers the app shell and local data only.
- Trend history starts from first use and cannot be backfilled.
