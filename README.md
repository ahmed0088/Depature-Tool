# Ibis Styles Ops Platform v2.0

A hotel operations management tool for daily front desk work.

---

## 📁 Files

| File | Purpose |
|------|---------|
| `ibis_ops.html` | **Main app** — open this in any browser |
| `ibis_data.json` | **Local database** — share this with colleagues to sync data |
| `README.md` | This guide |

---

## 🚀 Getting Started

### Option A — Local use (single person)
1. Download `ibis_ops.html`
2. Open it in Chrome, Edge, or Firefox
3. Your data auto-saves to your browser's local storage

### Option B — GitHub Pages (share with team)
1. Create a new GitHub repository (e.g. `ibis-ops`)
2. Upload both `ibis_ops.html` and `ibis_data.json`
3. Go to **Settings → Pages → Source → main branch → Save**
4. GitHub gives you a URL like: `https://yourusername.github.io/ibis-ops/ibis_ops.html`
5. Share that URL with your colleagues

---

## 💾 Sharing Data With Colleagues

Since GitHub Pages is static (no server), data sync works like this:

### Exporting your data
1. Click the 💾 button in the top bar
2. This downloads `ibis_data_YYYY-MM-DD.json`
3. Send this file to your colleague (WhatsApp, email, Teams, etc.)

### Importing a colleague's data
1. Click the 📂 button in the top bar
2. Select the `.json` file they sent you
3. Page reloads with their data

**Tip:** Do this at the start/end of each shift to sync up.

---

## 🔧 Features

### Departures
- Paste Opera departure report → load board
- Card sizes: S / M / L / List view
- Double-click guest name to edit inline
- Check Out / Extend / Late Checkout actions
- Checked out & extended rooms move to **Action Log**
- Undo any action from the log
- Export to Excel

### Arrivals & Purpose of Stay
- Paste or upload Opera Excel/CSV file
- AI nationality guessing from names
- Edit all fields inline
- Export styled Excel

### Shift Tasks ⏰
- 4 shifts: Morning / Afternoon / Mid / Night
- Add, edit, delete tasks per shift
- Check off tasks as you go
- Progress bar per shift
- Reset at start of shift

### Night Checklist ✅
- 17 default steps (pre / run / post)
- Edit mode: add steps, edit steps, delete steps
- Skip steps you don't need
- Progress saved automatically

### Reports
- **Nationality Report** — Opera XML → 240-row paste for Excel
- **Rented Rooms & Beds** — History Forecast + Room Type stats
- **Night Audit PM Rooms** — Compare Opera vs Excel, auto-fix differences
- **Immigration Check** — Upload Opera XML, flags missing nationality/gender/passport

### Feedback
- Click 💬 to submit bug reports or feature requests
- Saved locally, exported with your data

---

## ⚠️ Important Notes

- **No server needed** — runs 100% in the browser
- **No login** — data lives in your browser's localStorage
- **Clearing browser data** will erase your checklist/shift task progress
- To prevent data loss, export (💾) regularly and keep the JSON file safe
- The app works offline after first load (no internet needed for the tool itself, only for Google Fonts)

---

## 🛠️ Customisation

- Click the hotel name in the top bar to rename it
- Dark/light theme toggle (🌙/☀️) in the top bar
- All shift tasks and checklist steps are fully editable inside the app

