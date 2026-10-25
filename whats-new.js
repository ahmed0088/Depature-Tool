// ═══════════════════════════════════════════════════════════
//  whats-new.js — "What's new" after an update
//  The first time the app opens on a new version it shows, in plain
//  words, what changed since the version this browser last saw. Shown
//  once per version; the ✨ button opens it again any time.
//
//  When you ship: add one entry at the TOP of WHATS_NEW for the new
//  version (same number as APP_VERSION). Small fixes can share a line.
// ═══════════════════════════════════════════════════════════

const WHATS_NEW = [
  { v: 414, items: [
    "🛋 Roster: everyone gets at least one day off every week — no exceptions. Fixed the ways it could slip: days off learned as 0 from an older roster, “0 days off” on a card (no longer offered), a 🚫 day-off freeze over the whole week, the ✂️ monthly cut-off when the month's days off were used, and the emergency “work a day off” (now only someone with two days off that week).",
    "If there's truly nobody to cover, the person still gets their day off and the empty shift shows as a problem for you to decide — the day off always wins.",
  ] },
  { v: 413, items: [
    "📆 Roster builder fix: someone who worked the end of last week no longer ends up working 7 days in a row. An extra day off on a Monday was being taken back by mistake (last week's days weren't counted on Mondays) — fixed. And when a run is still too long, the builder gives an extra day off on a day their hotel has someone spare, and writes it under Decisions.",
    "✅ Your rules, cover, team cards, requests and history are untouched by the new 3-step builder — every setting and button is still there (Setup tab).",
  ] },
  { v: 412, items: [
    "🗓️ Roster builder redesigned in 3 simple steps: 1 Requests (who needs what) → 2 Build & check (the roster, problems and one-tap fixes) → 3 Publish (what goes out, then one button). Team, cover needed, vacation, history and rules moved to ⚙ Setup, so the main screens stay clean.",
    "✏️ Change a posted roster any time: Roster page → “✏️ Change this week” (or the builder → “Change the posted roster”). Change cells, then Publish shows exactly what changed (who, which day, from → to) and only those people are told.",
    "📊 The extra details (decisions, desk hours, happiness, PH, fairness) are under “More about this week”, one tap away.",
  ] },
  { v: 411, items: [
    "🚶 Roster → Team → a person's card: “🏨 Stays at their hotel” / “🚶 Can be moved to other hotels” — now for anyone, not only Duty Managers and Supervisors. Then pick where they can go: ✓ yes, ⚠️ only if there is no other option, 🚫 never.",
    "🗺 Nearest hotel first: the builder and the suggestions borrow from the closest hotel on the walk — Ibis → Mercure → Adagio — so nobody walks to the far end when the hotel next door has someone spare. Change the order in ⚖️ Rules → Hotels → Walking order.",
  ] },
  { v: 410, items: [
    "✏️ Night Run Checklist is fully yours to change: tap ✏️ on any step to edit everything — name, description, part of the night, type, the report it saves to the folder, a deadline, “How in Opera” lines, “What to check”, a red warning, a page to open, and photos.",
    "📁 Edit Steps → “＋ New report” adds a whole new report step (it goes in the folder count by itself), “＋ New step (full)” adds any step with all the details. Duplicate or delete from the editor.",
    "↺ “Restore built-in steps” brings back any built-in step you deleted, in its place — your own steps and edits stay as they are.",
  ] },
  { v: 409, items: [
    "🌙 Night Run Checklist rebuilt the way you run the night: Zero Rate Rooms → Complimentary → Rate Change → In-House Rate Check (TZ rates, higher rates) → Journal refunds → paid-outs + commission → Expedia → manual postings → CC recon + settle → HK discrepancy → cancel non-guaranteed → immigration → OOO / OOS to tomorrow → TD by 3:45 → run the night by 3:50.",
    "🌅 After the night: Negative Posting and No-Show reports from End of Day, email the no-shows to Reservations, Manager report, Flash report, then upload everything to DocuWare.",
    "📖 Each step has “How in Opera” (what to tick and pick) and “Check” (what to look for). TD and the night run show a live countdown that turns red when late, and the run step warns: never click Back while it runs.",
    "📁 Report folders: “Night-run folder 3/8” and “End-of-day reports” show which reports are saved. “Up next” at the top shows the next step with one Done button.",
    "📷 Attach photos to any step (no Edit needed) — your own notes and reminders, kept night after night.",
    "🍎 New Apple-style look: clean grouped lists, round checkmarks, calm colours. Steps you added yourself are kept.",
  ] },
  { v: 408, items: [
    "🌙 Handover: the night shift stays one shift after midnight. Items written at 8 PM, 10 PM, 11 PM on a 19:00–04:00 night now sit in “Night 24–25 Oct” with the ones after midnight, and the counts include them. “Still open from yesterday” only shows what earlier shifts left open.",
    "📤 Handover export (Excel / PDF) now includes everything still pending from yesterday, plus the whole night shift — nothing open gets lost at the change of day.",
    "🔢 A number inside an e-mail address (name2087@…) is no longer taken as a room — fixed on saved items too.",
    "🎨 Handover filters: the panel no longer sticks over the list while you scroll, and the Source switch is never cut off.",
  ] },
  { v: 407, items: [
    "👤 Type a room number, get the guest: on Wake-up calls, Lost & found, Maintenance, HK requests, Gym guest members and the WhatsApp templates, the guest in that room shows right under the box — name, VIP, pax, dates and nights, company, room type, rate, nationality, balance, and today's status (departing, late check-out, checked out). It comes from In-House first (the whole hotel), then Departures and Arrivals.",
    "⏰ Wake-up calls: the Guest box now fills itself from In-House too, so any room in the hotel works — not only rooms departing or arriving today. If you type a name yourself it is kept.",
  ] },
  { v: 406, items: [
    "🎤 Voice is much more reliable: it no longer gets stuck after the first command (the phone sometimes never said it had finished listening, so the next try did nothing). If the mic gives up at once because it was still busy, it quietly starts again.",
    "⏸ Pause mid-sentence and it waits for the rest: “312 … checked out”, “send towels to … 418” or “checked out … 312” now become one command instead of opening Ops Brain.",
    "📱 On iPhone, words you see on screen are always used, even if the phone never marks them final. Holding 🧠 and letting go before you speak keeps it listening.",
    "↩ Say the same command again (for example after an Undo) and it works; before, a repeat within a minute was ignored.",
  ] },
  { v: 405, items: [
    '🎤 Voice commands: press and hold 🧠 (or tap 🎤 in the Ops Brain ask bar, or Ctrl+Shift+Space on the PC) and say it — "312 checked out", "514 late check-out at 2", "extend 220 by two nights", "send towels to 418", "what\'s left to check out", "I\'m away" / "I\'m back". Room changes always show a confirm card first (✓ Do it / ✗ Cancel), then work exactly like a WhatsApp message — note on the room, log and Undo. Spoken numbers like "three twelve" are understood. Settings → Voice: on/off, language (English / Arabic), spoken replies. iPhone needs Siri & Dictation on and internet.',
  ] },
  { v: 404, items: [
    '📂 Opera folder (desk PC, Chrome / Edge): Settings → Opera folder & auto backup → pick the folder your Opera exports go to. HotelOps checks it every 45 s and loads new Departures, Arrivals, In-House and other reports by itself — always the newest export of each, an older file never replaces a newer one. The card shows which file is loaded for each report.',
    '💾 Automatic daily backup: pick a backup folder and HotelOps saves HotelOps-backup-date.json there once a day (keeps the last 14). The weekly "download a backup" reminder stops.',
    '📲 Shift alerts on Telegram (Settings → Shift alerts): rooms past check-out (every 30 min while it lasts), VIP arrivals, room problems nobody followed up, handover items still open 30 min before your shift ends — only during your shift on the roster, never twice, with quiet hours.',
    '📋 End-of-shift summary: 10 min before your shift ends you get departures, overdue, LCO / extensions, arrivals, handover, room problems, WhatsApp and shift tasks on Telegram — and one tap to copy it or send it to the handover WhatsApp group.',
    '💌 New page: Guest messages (Guests & Sales) — 10 ready messages in English and Arabic (welcome, check-out reminder, late check-out offer / approved, extension offer, thank you + review, payment reminder, lost & found, birthday…). Pick the guest from Departures, Arrivals or In-House and it fills in name, room, dates, Wi-Fi, breakfast and check-out time. Copy, WhatsApp, email or print. Edit the wording once for the whole hotel.',
  ] },
  { v: 403, items: [
    '⚡ Faster start: the app no longer scans the whole page for translations in English, builds the standards quiz only when the phone is idle, stops re-checking the whole page on every change, and keeps 130 KB of old "What\'s new" notes aside until you ask for them (Show older updates). On a phone the first screen shows noticeably sooner.',
  ] },
  { v: 402, items: [
    '💜 The new HotelOps logo you picked: a bold white H on a glowing indigo tile — the same in every theme, on the sign-in screen, the browser tab and the Home Screen icon (re-add the app to your Home Screen to see the new icon there).',
  ] },
  { v: 401, items: [
    '✨ New HotelOps logo: a bold rounded H with a small sparkle, on a glossy gold tile that takes your theme\'s colours. New icons for the Home Screen app, the browser tab and the sign-in screen too (re-add the app to your Home Screen to see the new icon there).',
  ] },
  { v: 400, items: [
    '📊 New page: Reports (Guests & Sales menu, or ⋯ More on the phone) — an Opera-style report centre. Departures, Arrivals, In-House Guest List, Balances Due, Late Check-outs & Extensions, No-Shows, Room Problems, WhatsApp Activity Log and Shift Handover. Each one prints like Opera: hotel and report name, printed time and user, a clean table with totals, page numbers on paper. Filter, search, tap a column to sort, then 🖨 Print / PDF, ⬇ Excel, CSV or ⧉ Copy. It uses what HotelOps already has today — load the Opera reports on their pages first.',
  ] },
  { v: 399, items: [
    '🎮 The live desk game now plays what is really happening: a 📡 LIVE strip (rooms out, overdue, arriving, in house, WhatsApp, handover, room problems, your shift tasks — tap one to open that page). Checked-out guests walk out with their bags, overdue ones wait at the desk with a ⏰ tag, arrivals walk in and the bell rings, the desk phone shakes for each WhatsApp with a bubble saying what it understood, an engineer or housekeeper walks over for a room problem, +1 ✅ pops for each shift task, Ops Brain\'s thought floats over you, and the lobby news reads real events. All out = confetti and 🏆 on the board. 6 new badges: All out, On time, Clean sheet, Chatterbox, Clear desk, Fixer.',
  ] },
  { v: 398, items: [
    '⚡ One-click WhatsApp: no more F12 and pasting. In the WhatsApp window press ⬇ Get the helper — HotelOps builds a small helper for Chrome / Edge. Add it once (chrome://extensions → Developer mode → Load unpacked). From then on 🟢 Open WhatsApp Web is the only click: the reader starts by itself and links to HotelOps on its own, even after WhatsApp reloads. When the reader changes, the window offers the new helper.',
  ] },
  { v: 397, items: [
    '🔊 Style sounds: each App style has its own little sounds when you tap and when a message pops up — 🕹 Gaming bleeps, 💬 WhatsApp pops, ✈️ Telegram swish, 🎧 Discord blips, 📝 Notes ticks, 🗒 Notepad key clicks, 🏛 Classic wood, 📚 Study chimes, ⚡ Pro soft ticks. Quiet, and on only in Gaming until you choose: Settings → Appearance → Style sounds (Off · Gaming only · Every style).',
    '🚪 Departures dressed by your style: WhatsApp and Telegram show the rooms as a chat list with round avatars, Discord as server icons, Gaming as neon HUD frames, Notes as yellow stickies, Classic as brass room plates, Study as index tabs, Notepad and Pro as clean boxes.',
  ] },
  { v: 396, items: [
    '🎨 9 new App styles — the whole app dressed like an app you know. Pick one from the theme button (top bar or ⋯ More), under "App styles": 📝 Apple Notes (warm paper, Notes yellow, ruled cards) · 💬 WhatsApp (teal bar, doodle wallpaper, chat-bubble cards) · ✈️ Telegram (Telegram blue on the green wallpaper) · 🎧 Discord (blurple and the dark greys, # titles) · 🕹 Gaming (neon cyan / magenta, RGB edges, game fonts) · 🏛 Classic (cream paper, navy and gold, serif) · ⚡ Pro (black, hairlines, sharp type) · 📚 Study (graph paper, highlighter titles, index-card tiles) · 🗒 Notepad (Windows 11, Consolas, square edges). Each is your own choice on your devices only.',
  ] },
  { v: 395, items: [
    '✨ New phone tab bar: a floating glass capsule like iPhone\'s own apps — frosted see-through background, a soft pill that slides to the tab you tap, cleaner icons and labels, and small iPhone-red badges.',
  ] },
  { v: 394, items: [
    '🔓 No more Face ID every time you open the app: the 30-minute idle sign-out is for shared desk PCs. On your own device — the app on your Home Screen, "Stay signed in" ticked, or signed in with Face ID — you now stay signed in. Want it anyway? Settings → Privacy & security → Sign out when idle.',
  ] },
  { v: 393, items: [
    '💬 Room Health: "One message per team" — tap 🔧 Engineering, 🧹 HK, 💻 IT or 🛡 Security and get ONE ready WhatsApp message with every room that needs them (room in bold, the problem, arrival / VIP warnings, "reply done when fixed"). Edit it if you like, then ⧉ Copy message or 💬 Open WhatsApp with it already typed. The rooms are marked as sent.',
  ] },
  { v: 392, items: [
    '🧠 The number on the Ops Brain bubble now matches what you see inside: open 🧠 and "Noticed for you" at the top lists every note it is holding, each with its buttons. ✕ puts one away for now and the number goes down.',
  ] },
  { v: 391, items: [
    '✈️ Away guard alerts on Telegram — they always pop up on iPhone, even when the phone is locked. WhatsApp → 🛡 Away → Telegram: 1) open BotFather and send /newbot, 2) paste the token, 3) tap "Open my bot" and press Start — HotelOps connects by itself and your bot says hi. Alerts come with an "Open HotelOps" button. ntfy still works too; set up both if you like, and 🧪 Send a test checks them all.',
  ] },
  { v: 390, items: [
    '🧠 Smarter Away guard: every action gets a level — a private chat, a search, typing or closing the reader is 🚨 urgent; your work groups and a moved mouse are minor and don\'t buzz you alone. A visit is one story on your phone: "🚨 Someone is on your WhatsApp" → "⏱ Still on it · 3 min" (at most once a minute) → "✅ Stopped — Family, Mum · searched salary". A red live banner shows while someone is on it, and the history is grouped by visit with a short summary.',
    '🛡 Auto-away: WhatsApp → 🛡 Away → ⚙️ Smart alerts. Choose 5–30 minutes and the guard switches itself on when nobody has touched the WhatsApp PC that long. Also choose what reaches your phone: Urgent only, Important, or Everything. Paste the WhatsApp reader again once for these.',
  ] },
  { v: 389, items: [
    '📲 Away guard alerts on your lock screen: WhatsApp → 🛡 Away → "Set up phone alerts". Install the free ntfy app, paste your private code, tap Send a test. Now you\'re told even when your phone is locked and HotelOps is closed. Alerts say what happened and which chat — never the messages themselves.',
  ] },
  { v: 388, items: [
    '📱 iPhone app: the WhatsApp window\'s top bar (🛡 Away, 📖 Words, ✕) now stays below the clock. Apps added to the Home Screen before v379 now also keep every top bar below the clock, and ask once to be added again (delete the icon → Safari → Share → Add to Home Screen) to remove the grey strip at the bottom.',
  ] },
  { v: 387, items: [
    '📱 Last phone fixes from the full check: the Night Checklist no longer runs off the screen with long step names; Shift Tasks buttons go under long task names; Roster "My shifts" times fit; the Roster builder hour grid shows all 24 hours; vacation balances and Fix buttons fit; the Settings font picker is tidy; Lost & Found chips wrap; HK Requests details stay on screen; the Handover Book new-item box gets the full width.',
    '📱 Small phones: the app clock steps aside so ⚙️ Settings stays on screen (your phone already shows the time). Guest Memory email boxes are wider and show the full value when held.',
  ] },
  { v: 386, items: [
    '📱 Phone check with real-size data: In-House no longer runs off the screen; Departures "Open balance", Nationality, No-Show and Arrivals totals shrink to fit their tiles; the Nationality preview and copy box stack; the Arrivals processor column picker fits; long confirmation numbers show in full; the room card shows full facts instead of "…".',
    '📱 More phone fixes: Night Audit and Rented Rooms side boxes go underneath (no more cut-off names and balances); DTCM long-stay dates stay on one line; Adagio filter fits; the enrolment tracker table scrolls inside its card; Package Audit view tabs and the "Remove this charge" line fit; Gym cards with long names; Skip The Clean steps fit.',
    '🐞 Arrivals processor: assigned package codes showed "undefined" instead of UP / FO / FB — fixed.',
  ] },
  { v: 385, items: [
    '🛡 WhatsApp Away guard: going on a break or DND with WhatsApp Web open on the desk PC? Tap the WhatsApp button → 🛡 Away → "I\'m away". If anyone uses your WhatsApp while you\'re gone, your phone gets an alert: the chat they opened, what was on the screen while they scrolled, what they searched, if they typed, and if they closed the reader or WhatsApp. Tap "I\'m back" when you return. Only real mouse / keyboard use counts, never the reader\'s own clicks, and it starts 45 seconds after you switch it on. Paste the WhatsApp reader again once to get it.',
  ] },
  { v: 384, items: [
    '📈 Trends on the phone: "By product" and "Top nationalities" now sit one under the other and fit the screen — no more cut-off amounts. Long names shorten with … (tap-and-hold shows the full name).',
  ] },
  { v: 383, items: [
    '✅ Lessons (Standards & help): the circle on each lesson now works — tap it to mark the lesson learned (it turns green ✓), tap again to undo. It doesn\'t open or close the lesson, and open lessons stay open.',
  ] },
  { v: 382, items: [
    '🧠 Ops Brain on the phone: a big Close button at the bottom, swipe right (or pull down from the top) to close, and the phone\'s back gesture closes it too — you never need to reach the ✕ at the top.',
  ] },
  { v: 381, items: [
    '📱 iPhone app: Ops Brain and the pop-up windows no longer hide their top (title, ✕ close, Autopilot) under the clock, and their last buttons stay above the home bar.',
  ] },
  { v: 380, items: [
    '📱 Shift Tasks on the phone: Morning / Afternoon / Mid / Night is now a fixed 4-part switch that fits the screen — it no longer slides around or gets cut off. Other chip rows (filters, Departures chips) only move sideways now.',
  ] },
  { v: 379, items: [
    '📱 iPhone app: fixed the bottom menu floating too high with a grey strip under it. The app now fills the whole screen; the top bar sits below the clock and the menu just above the home bar.',
  ] },
  { v: 378, items: [
    '🙂 Sign in with Face ID (a passkey). After you sign in with your password, HotelOps asks "Sign in with Face ID next time?" — tap Turn on. From then on the sign-in card shows a big "Sign in with Face ID" button, and opening the app from your Home Screen asks for your face straight away. Your password stays locked on that device behind your face. Turn it on or off any time in Settings → Privacy & security. Changed your password? Sign in with the new one once and turn it on again.',
  ] },
  { v: 377, items: [
    '📱 iPhone app: open HotelOps in Safari → Share → Add to Home Screen. It opens full screen like a real app (no browser bar), with its own icon. The top bar now sits below the clock, and the bottom menu clears the home bar.',
  ] },
  { v: 376, items: [
    '🩺 New page: Room Health (Front Desk). It reads WhatsApp, HK requests, the Handover Book, maintenance tickets and room notes, and tells you who to send: "Send Engineering to 116 — AC not cooling reported 3× since yesterday", "Send HK to 206 — smoke smell; deodorise before today\'s arrival". Arrivals into a room with an open problem come first, then repeat problems. One tap sends a clear message to the right WhatsApp group and adds a room note and a handover item; a "done" reply marks it fixed. "Problem rooms" shows the rooms with the most issues in 30 / 90 days.',
    '📦 Package Audit: copy buttons and ✓ Fixed on every package (fixed ones move to "Fixed already", with Undo). The team can change every month (left / renamed people keep their old sales; import a team list). A 🧠 Memory remembers every package across months — "↪ continues from Sep" keeps the seller, and Unknown products are solved from memory. It learns your decisions as rules you accept. 🛠 Settings for package kinds, rules and report columns (drag & drop), and the seller board compares months.',
    '🏨 Settings → Hotel setup: your check-out time, extending deadline, shift names and hours, the menu order (drag & drop, rename groups, hide pages), Handover and HK categories, and Departures rules — all adjustable without code, with Reset to default. Copy the whole setup to another hotel. Nothing changes until you change it.',
  ] },
  { v: 375, items: [
    '🔗 In-House and Departures are linked live: a room checked out on Departures (by hand, by WhatsApp or "Check out all due") shows "✓ Checked out 11:02" on In-House and leaves the counts; Undo brings it back. An extension shows "↪ extended +2N → 23 Oct" with the new date and nights left. Extending, may extend, late check-out, NA and DND show as badges.',
    '➕ In-House tells you which rooms leave today but are not on Departures — "Add them" in one tap. Guests on today\'s arrivals who are in-house get "🛎️ Arrived". The room card follows all of it live, and WhatsApp never re-adds a room already checked out today.',
  ] },
  { v: 374, items: [
    '🛏️ Room card: tap a room number almost anywhere (Departures, In-House, HK Requests, the WhatsApp window, search, or ask Ops Brain "what\'s up with 512") and see everything about that room in one place — who is in it, today\'s departure status, who is arriving, and one timeline of the stay: WhatsApp messages, HK requests, handover items, Front Office Log, wake-up calls, gym and departure actions. Tap any line to open it where it came from.',
    '📝 Room notes, shared with the team: add a note to any room (request, VIP, payment, maintenance, luggage, taxi, follow-up…), pin it, keep it for the stay or just today. It goes away by itself when the guest leaves, stays when the guest extends, and shows on Departures too (⇪ keeps a Departures note as a room note).',
  ] },
  { v: 373, items: [
    '🛏️ New page: In-House Guests (Front Desk, after Arrivals). Load the Opera Cloud in-house report as Delimited Data (or paste it, or drop the file anywhere). You get rooms occupied, guests, departing today and tomorrow, long stays, VIPs and open balances at a glance, with filters, search (room, name, company, confirmation) and every guest\'s details.',
    '🔄 Loading again the same day shows what changed first (new / gone / changed rooms). Export to a styled Excel or PDF, and copy the "departing tomorrow" list for WhatsApp.',
    '💬 WhatsApp now checks the in-house list first when a room is not on today\'s Departures — so "421 Early Depart" finds 421, adds it to Departures and checks it out.',
  ] },
  { v: 372, items: [
    '✅ WhatsApp, as your team uses it: "421 Early Depart" now checks the room out (noted "early departure"; "early departure tomorrow" stays a note). "524 523 516 please make check out" checks those rooms out. A time after a room ("626 4 pm", "315 - 3 pm", "512 14:00") is a late check-out at that time (a morning time is not). "io" means IP — inspected, room ready. "105 physical check out" stays a request for housekeeping to check the room.',
  ] },
  { v: 371, items: [
    '🧠 The WhatsApp reader learned from months of your team\'s real chats: IP = inspected / room ready, N/L = no luggage, OCC = guest things still in the room (might extend), "- till 14:00" = late check-out, "Stay Extended", "on Extension", "C/out", sleep out, double lock, ongoing and more. Typos like "chekcout" are read too.',
    '🛡️ Safer: questions like "315/316 vd any updates?", "any update due out rooms" or "status?" never check a room out any more, and HotelOps\' own posts are never read back as commands. Pasting a WhatsApp chat export now reads US dates, forwarded messages, pictures, @mentions and edited / deleted messages correctly.',
    '🧺 HK Requests is a calm log now: each request shows "📨 Sent to HK", and "✓ Done by HK" by itself when housekeeping replies Done. No red Open, no timers, no Done buttons. Want them back? Switch on "Track requests".',
    '🔎 Fixed readings: "send heavy blanket" is a blanket, "no need cleaning" / "do not clean" / "no luggage" are not requests, "collect payment at reception" is a front-desk note, and each smell in a message goes to the right room.',
  ] },
  { v: 370, items: [
    '🏋️ New page: Gym & Pool (Guests & Sales). Every member with type, room or outside, dates, amount paid, car plate, mobile and ID (shown hidden, e.g. 784-XXXX-XXXXXXX-1). Each card shows Active / Ending soon / Expired with a countdown, and a banner reminds you when someone ends today or tomorrow.',
    '📎 Attach the ID copy, signed form or receipt (PDF or a photo from your phone camera) to each member. Extend in one tap (+30 days, +1/3/6/12 months) with the full history kept; check-ins are counted.',
    '✉️ Paste a gym e-mail ("new gym and pool membership for one month, starting today", "extended for an additional 30 days") and the form fills itself. ⬆ Import loads your current Excel sheet (Guest Name, Mobile, Start, End, Car Plate, Amount) with a preview first.',
    '📊 Export for your manager: a colourful Excel (title, coloured tiles, status colours, totals, filters, an "Ending soon & expired" sheet) and the same report as a PDF — All, Active only, Ending soon or This month.',
  ] },
  { v: 369, items: [
    '🔗 Shift tasks linked to tools: each task can open the page that does it, e.g. "Enrollment" → Open Guest Pipeline →. Pick it under ✏️ Edit → Linked tool (or 🔗 Tool when adding). HotelOps suggests the page from the task\'s name ("Suggested: Departures · Link it"), and "Link all suggestions" does the whole list in one tap.',
    '✅ Back from the tool, Shift Tasks asks "Mark \'Enrollment\' done?" — one tap, nothing is ticked without you. A page your role cannot open shows greyed out.',
  ] },
  { v: 368, items: [
    '📰 What\'s new is easier to read: newest update first, one card per update with the latest marked, bigger text, and each change with its own icon and a bold title. Older updates are one tap away.',
  ] },
  { v: 367, items: [
    '🤔 WhatsApp words: when a colleague writes a word HotelOps does not know ("xtendd", "ckd", "vacnt", "lte"), it now makes a best guess and asks you "My guess: Extension. Did I get it?" with ✓ Yes first. Your answer is saved for the whole team, and waiting messages are then done. Close typos ("EXTENDE") are still done straight away as 🤔 guessed.',
  ] },
  { v: 366, items: [
    '✅ Handover Book: a "Done", "Done ✅", "collected", "moved" or "506 done" in WhatsApp now ticks the right handover item by itself. It looks at the message being replied to (even when WhatsApp cuts it short), the room number, what was done (collected → payment, moved → room move…) and which item came just before. When it still is not sure, it asks at the top of the Handover Book: "Which item is done?"',
    '🔤 WhatsApp typos: "310 - EXTENDE", "exended", "extnded", "chekd out" are now read as extend / check out (marked 🤔 guessed, tap ✓ Right once and it remembers). Look-alike words such as "external", "exit" or "cheque" are left alone.',
  ] },
  { v: 365, items: [
    '👆 Holding the HotelOps logo on a phone now works reliably: hold about 1–2 seconds and lift your finger — Guest Memory opens on release (Face ID then asks). A small wobble or the phone\'s own long-press no longer cancels it.',
  ] },
  { v: 364, items: [
    '🔐 Guest Memory: only the owner can open it now, with their own saved Face ID / fingerprint. The first time on a phone, press "Save my Face ID and open"; after that only that face opens it there. No password route, and other roles see "Only the owner can open Guest Memory". Filling in nationality and e-mail from memory on import still works for everyone.',
  ] },
  { v: 363, items: [
    '🙂 Guest Memory with Face ID: open it, unlock, then press "Use Face ID on this phone". From then on, opening Guest Memory on that phone (holding the logo or Ctrl + Shift + M) asks for Face ID / fingerprint first — the owner too. The password still works as a backup. Turn it off with "Face ID: on".',
  ] },
  { v: 362, items: [
    '🧠 Guest Memory on a phone: press and hold the HotelOps logo (top left) for about 1.5 seconds. On a computer it is still Ctrl + Shift + M. It stays hidden from the menu and its password lock still applies.',
  ] },
  { v: 361, items: [
    '👤 Per-person access: Team → Users → Access on anyone\'s card. For each page and power choose Role (what their role gives), Allow (extra for this person only) or Block (taken away from this person only). The card shows e.g. "Agent + 2 extra pages, 1 blocked". Reset to role undoes it.',
    '🔒 Powers now really work: Export (downloads), Import (restore a backup), Clear (clear the board / lists), Delete (wake-up calls, lost & found, tickets, reports, QR codes), Reports (Trends) and Activity logs (History). Nobody loses anything today: agents, supervisors and managers keep Export, Clear and Delete until you switch them off.',
  ] },
  { v: 360, items: [
    '📋 DTCM: "copy" on a DTCM ID now only copies — the correction stays on the list. Press ✓ Fixed when it is done (now also on every row of the corrections table), and Undo if you pressed it by mistake.',
  ] },
];

const WN_KEY = 'whats_new_seen_v1';
const _wnNum = v => parseInt(String(v || '').replace(/\D/g, ''), 10) || 0;

function wnEntriesSince(seen) {
  return WHATS_NEW.filter(e => e.v > seen).sort((a, b) => b.v - a.v);   // newest first, always
}
/** one line → {ico, title, body}: the leading emoji, the words before the first ":" (if short), the rest */
function wnSplit(t) {
  const s = String(t || '').trim();
  const m = s.match(/^([\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}][\u{FE0F}\u{200D}\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}]*)\s*/u);
  const ico = m ? m[1] : '•', rest = m ? s.slice(m[0].length) : s;
  const c = rest.indexOf(': ');
  if (c > 0 && c <= 70) { const b = rest.slice(c + 2); return { ico, title: rest.slice(0, c), body: b.charAt(0).toUpperCase() + b.slice(1) }; }
  const dot = rest.search(/[.!?](\s|$)/);
  if (dot > 0 && dot <= 90 && dot < rest.length - 1) return { ico, title: rest.slice(0, dot + 1), body: rest.slice(dot + 1).trim() };
  return { ico, title: '', body: rest };
}
function wnCard(e, latest) {
  return `<section class="wn-card${latest ? ' latest' : ''}"><div class="wn-chd"><span class="wn-v">v${e.v}</span>${latest ? '<span class="wn-new">Latest</span>' : ''}</div>
    ${e.items.map(i => { const x = wnSplit(i); return `<div class="wn-item"><span class="wn-ico" aria-hidden="true">${escapeHtml(x.ico)}</span><div class="wn-txt">${x.title ? `<b>${escapeHtml(x.title)}</b>` : ''}${x.body ? `<span>${escapeHtml(x.body)}</span>` : ''}</div></div>`; }).join('')}</section>`;
}

/** older notes (before v360) live in whats-new-archive.js and load only when someone asks for them */
function wnAll() { return WHATS_NEW.concat(typeof WHATS_NEW_OLD !== 'undefined' ? WHATS_NEW_OLD : []); }
function wnLoadOld(then) {
  if (typeof WHATS_NEW_OLD !== 'undefined') return then();
  const sc = document.createElement('script'); sc.src = 'whats-new-archive.js'; sc.onload = then; sc.onerror = then; document.head.appendChild(sc);
}
function wnOpen(all) {
  if (all && typeof WHATS_NEW_OLD === 'undefined') { wnLoadOld(() => wnOpen(true)); return true; }
  let seen = 0;
  try { seen = _wnNum(localStorage.getItem(WN_KEY)); } catch (_) {}
  const list = (all ? wnAll() : wnEntriesSince(seen)).sort((a, b) => b.v - a.v);
  const FIRST = all ? 12 : 6;                                     // a few at a time, newest first; the rest one tap away
  if (!list.length) return false;
  document.getElementById('wnModal')?.remove();
  const m = document.createElement('div');
  m.id = 'wnModal';
  m.className = 'fr-overlay';
  m.innerHTML = `
    <div class="fr-sheet wn-sheet" role="dialog" aria-modal="true" aria-label="What's new">
      <div class="wn-top"><div class="fr-h">✨ What's new</div><button class="wn-x" type="button" aria-label="Close" title="Close">✕</button></div>
      <div class="fr-file">You are on ${escapeHtml(APP_VERSION)}</div>
      <div class="wn-body">${list.slice(0, FIRST).map((e, k) => wnCard(e, k === 0 && e.v === WHATS_NEW.reduce((mx, x) => Math.max(mx, x.v), 0))).join('')}
      <div class="wn-more" hidden>${list.slice(FIRST).map(e => wnCard(e, false)).join('')}</div></div>
      ${list.length > FIRST ? `<button class="btn ghost wn-more-btn" type="button" style="width:100%;margin-bottom:6px;">Show ${list.length - FIRST} more</button>` : ''}
      ${all ? '' : '<button class="btn ghost wn-all" style="width:100%;margin-bottom:6px;">Show older updates</button>'}
      <button class="btn gold fr-cancel">Got it</button>
    </div>`;
  m.addEventListener('click', e => {
    if (e.target.closest('.wn-all')) { wnOpen(true); return; }
    if (e.target.closest('.wn-more-btn')) { const mo = m.querySelector('.wn-more'); if (mo) mo.hidden = false; e.target.closest('.wn-more-btn').remove(); return; }
    if (e.target === m || e.target.closest('.fr-cancel') || e.target.closest('.wn-x')) m.remove();
  });
  const back = document.activeElement;
  const esc = e => { if (e.key === 'Escape' && document.getElementById('wnModal') === m) { m.remove(); } };
  document.addEventListener('keydown', esc);
  new MutationObserver((_, o) => { if (!m.isConnected) { document.removeEventListener('keydown', esc); o.disconnect(); if (back && back.focus) try { back.focus(); } catch (_) {} } }).observe(document.body, { childList: true });
  document.body.appendChild(m);
  try { m.querySelector('.fr-cancel')?.focus({ preventScroll: true }); } catch (_) {}
  const sh = m.querySelector('.wn-sheet'); if (sh) sh.scrollTop = 0;   // open at the newest update
  try { localStorage.setItem(WN_KEY, APP_VERSION); } catch (_) {}
  return true;
}

document.addEventListener('DOMContentLoaded', () => {
  let seen = null;
  try { seen = localStorage.getItem(WN_KEY); } catch (_) {}
  if (seen === null) {
    // never seen this window: someone already using the app gets the recent
    // updates once; a brand-new browser just starts counting from now
    let used = false;
    try { used = localStorage.length > 3; } catch (_) {}
    seen = used ? 'v110' : APP_VERSION;
    try { localStorage.setItem(WN_KEY, seen); } catch (_) {}
  }
  if (_wnNum(seen) >= _wnNum(APP_VERSION)) return;
  if (typeof hoPref === 'function' && !hoPref('whatsNew')) { try { localStorage.setItem(WN_KEY, APP_VERSION); } catch (_) {} return; }
  // wait until the person is signed in and the app is on screen
  const t = setInterval(() => {
    const app = document.getElementById('appWrapper');
    if (app && app.style.display !== 'none') { clearInterval(t); setTimeout(() => wnOpen(false), 1500); }
  }, 1000);
});
