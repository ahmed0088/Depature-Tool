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
  { v: 346, items: [
    '⏳ Departures: a guest who is extending is no longer shown as "Due" or "overdue" — he is staying. The room shows "⏳ EXTENDING · BY 6 PM" with a countdown, and turns red only if the booking, signature, TD or payment is still not done at 6 PM.',
    '🧾 A guest who left while Finance or Reservations fix the room shows "LEFT · FINANCE" (or Reservations) instead of Due or overdue.',
  ] },
  { v: 345, items: [
    '🏷️ WhatsApp reader: each message now also shows what HotelOps did with it — "📝 Request · 206" for a room that is staying, "⚠ 999 not found" (red, with a "Room 999 is not there" pop-up), and "＋ 512 added from arrivals" when a room was put on Departures. Paste the console line again in WhatsApp Web to get it.',
  ] },
  { v: 344, items: [
    '💚 New WhatsApp reader look: a dark green glass window with a live "connected" light, counters (read today, acted, sent, waiting), an activity graph, search and filters in the feed, colour labels for CO / LCO / EXT / notes, a small pill you can drag anywhere, and Alt+H to show or hide it. Paste the console line again in WhatsApp Web to get it.',
  ] },
  { v: 343, items: [
    '🔎 WhatsApp: "CO", "LCO" or "EXT" for a room that is not on today\'s Departures — HotelOps now looks for the room in Arrivals, the in-house list and the In-house tally. Found → it adds the room to Departures and does it (Undo takes it off again). Not found → it tells you "room not found".',
  ] },
  { v: 342, items: [
    '✉️ WhatsApp "Send automatically" now finds WhatsApp\'s new Send button and presses it like a finger; if it still can\'t, it presses Enter in the message box. Paste the console line again in WhatsApp Web to get it.',
  ] },
  { v: 341, items: [
    '📷 Roster pictures: the reader now handles rosters that start with last week\'s Sunday before the names, the first hotel name in the title box, employee numbers before names, and white writing on red leave cells (AL, SL). A misread time is marked "?" for you to check.',
  ] },
  { v: 340, items: [
    '☀️ Roster: two at the front desk every morning (09:00 – 12:00), the busiest time. Bell boys don\'t count. (⚖️ Rules → "Two at the desk every morning".)',
    '🏨 Every hotel can use every hotel\'s shifts (a 09:00 - 18:00 at Mercure is possible at Ibis and Adagio too), so spare people go on another shift instead of doubling up. (⚖️ Rules → "Same shifts in every hotel".)',
    '🛌 Days off are spread over the week: the builder avoids several people of the same hotel off on the same day.',
    '🔁 A deputy may always do the shift they cover (like a Supervisor-only night): no more "is for Supervisor, Duty Manager only" problem for Charlene or Hnin when they cover.',
    '⏰ Starting up to 3 hours earlier the next day is fine now (15:00 - 00:00 then 12:00 - 21:00), as long as the rest between is kept. Night to day still needs a day off.',
    '🎓 Training shows clearly on the roster: a "🎓 Training" tag on the person\'s day (from 📅 Meetings & training).',
  ] },
  { v: 339, items: [
    '📌 Set a fixed shift by typing in Ask the roster: "Sam always 09:00 - 18:00", "Sam always 00-09", "Sam always on 12pm". "Sam any shift" frees it again.',
  ] },
  { v: 338, items: [
    '✍️ Two new roster rules (⚖️ Rules → Your own rules, or tell Ops Brain): "Sam and Lina never off on the same day" (days off and leave), and "Sam never on 12:00" / "avoid Sam on nights" (one person kept off a shift or a type of shift). Each has a level like your other rules.',
  ] },
  { v: 337, items: [
    '🛌 Roster: nobody loses their weekly day off any more to fill a shift. If a shift can\'t be covered, it shows as a problem for you to decide (Fix suggests who could take it). To allow it again: ⚖️ Rules → PH days → "Work a day off to fill a shift".',
  ] },
  { v: 336, items: [
    '👥 Roster: the builder tries much harder not to put two people on the same shift when that shift needs one (like two on 12:00 the same day). Extra people go on another shift where it fits; two together only when there is no other way.',
  ] },
  { v: 335, items: [
    '🏨 Roster: the builder no longer moves agents to another hotel. Only Duty Managers and Supervisors are ever moved, and only when nobody at the hotel can do it ("Lend to another hotel…" only shows for them too).',
    '🔁 New "Covers for" on each team card (same hotel only): on the days that colleague is off or away, this person takes their shift, even over their own shift request; after covering a night they get the next day off, then back to their usual shift. Or type it in Ask the roster, e.g. "Sam will cover Alex when he is off" ("Sam stops covering Alex" to undo).',
    '🌴 V (Vacation) is now in the roster menus next to AL, SL and EL.',
  ] },
  { v: 334, items: [
    '✉️ WhatsApp → Send: a "Send automatically" switch next to Send to WhatsApp. On (default): your message goes straight into the group. Off: it is typed for you and you press Enter. The same switch is still in the reader\'s Settings on WhatsApp Web.',
    '⚡ The WhatsApp reader picks up new messages faster (within a quarter of a second) and only watches the chat and the chat list, so WhatsApp Web stays smooth.',
    '🧺 HK requests are housekeeping\'s to close: no more pop-ups or Ops Brain alerts telling you to finish them, and no "open requests" card on Home. They are still logged on the HK Requests page.',
  ] },
  { v: 333, items: [
    '📝 Room notes open in their own window: a timeline with a type for each note (WhatsApp, Late CO, Luggage, Taxi, Payment, Finance…), filters, search, quick templates, pin a note to the card, edit or delete any line. "Left · waiting" is now also on No answer and DND cards.',
    '💬 WhatsApp got a big upgrade: a new look for the HotelOps window and the reader on WhatsApp Web (live chart, counters, Feed / Send / Groups / Settings), send messages and the checkout list to the group from HotelOps (it is typed for you, you press Enter), read more than one group, full lists ("CO 101 102 103", "212.319.504 all VD"), replies, deleted messages undone, "507 extending, waiting TD + RC", "507 left, waiting finance", and HotelOps asks you when it doesn\'t know a word.',
    '🧺 New HK Requests page (Front Desk): a log of every room request with open/done, what is asked most, why rooms move, problem rooms, tips, and the 📖 WhatsApp words dictionary (VD = Vacant Dirty and more, add your own).',
    '🧠 Ops Brain now learns from the HK chat: search it ("324", "towels"), reminders for late check-outs and requests nobody answered, 💬 chips on room cards, and an "HK chat this shift" part in the handover.',
  ] },
  { v: 332, items: [
    '🛠 Late check-out cards: "Left · waiting" now sits on its own neat line under Check out and Undo, with a clean receipt icon.',
  ] },
  { v: 331, items: [
    '🧾 New "Left · waiting" button next to Check out: the guest has physically left but Finance or Reservations still has to fix the room (you pick which). The card shows "Guest left at 11:18 · waiting for Reservations" with how long it has waited, it stops counting as overdue, the housekeeping list shows it as LEFT, and Ops Brain reminds you. When it is fixed, press ✓ Fixed · check out.',
  ] },
  { v: 330, items: [
    '⏳ New "Extending" button on Departures cards: the guest is staying on but the paperwork isn\'t done yet. Tick ✓ Booking (made by the guest or by us), ✓ Signature, ✓ TD and ✓ Payment (full payment taken) as they come in, then press ↪ Mark extended. Ops Brain reminds you about extending rooms still missing a booking, signature, TD or payment, and they show under the "May extend" filter.',
  ] },
  { v: 329, items: [
    '💳 Balance that\'s fine to leave: tap the red "AED … owing" chip on a departure and choose "OK for this room" or "Always OK for Expedia bookings" (works for any agent or company). The chip turns green ("Expedia pays ✓") and the room no longer counts as owing: no warning at check-out, not in the Balance filter, the Ops Brain tip or the morning brief. Tap it again to undo. "Always OK" is shared with the whole team.',
  ] },
  { v: 328, items: [
    '🛠 WhatsApp reader: "Copy today\'s chat" works even when WhatsApp blocks copying (if it still can\'t, it shows the text selected so you just press Ctrl+C). It also finds the HK group even if the name has emoji or extra words, and fills in the open chat\'s name for you.',
  ] },
  { v: 327, items: [
    '💬 WhatsApp understands more words: "checked out", "checkedout", "left", "C/O", "324co", "CO 324". Extensions work too ("ext", "extended 2 nights", "ext till 22 Oct", "+2N"): the room is marked extended, with Undo. "Out of order" and "checkout tomorrow" stay as notes.',
    '🔎 Every HK message HotelOps receives is now kept as a backup. Search it in the WhatsApp window by room (324 also finds 0324), word or name, for today, 7 days, 30 days or any dates, then download it as .txt or CSV.',
    '🟢 Pasting the console line in WhatsApp Web now shows a live HotelOps window: what it is reading, counters, and a feed of each message with what it means.',
  ] },
  { v: 326, items: [
    '🛠 Departures list view (≡) fixed: each room is one neat line (room, name, status, time left, owing, buttons on the right). Notes and extensions open as a full-width strip under the row.',
  ] },
  { v: 325, items: [
    '✨ Departures cards have a fresh look: a room badge, a countdown ring to checkout (red when overdue), names in normal capitals, clearer buttons, and a ✓ DONE stamp on checked-out rooms. Works in every theme and on phones.',
    '↩ The Undo bar is now a small pill at the very bottom. It disappears as soon as you click, scroll or type somewhere else, so it never covers your work. Ctrl+Z still undoes.',
  ] },
  { v: 324, items: [
    '💳 Tapping "rooms still owe a balance" now opens Departures showing only those rooms. "Late check-outs past their time" opens just the overdue rooms.',
  ] },
  { v: 323, items: [
    '🛠 WhatsApp window: you can now scroll down to the paste box and the help. The title and ✕ stay at the top.',
  ] },
  { v: 322, items: [
    '🟢 WhatsApp is now a button at the top of the app (green icon, on every page). It opens a window with the paste box ready: paste the HK chat, Read messages, done. Esc or ✕ closes it.',
  ] },
  { v: 321, items: [
    '💬 WhatsApp → Departures: when the HK group writes "324 CO" HotelOps checks room 324 out, "202 LCO 6PM" sets a 6 PM late check-out, and "415 change bedsheet" becomes a note on the room. Every change has an Undo.',
    '📋 Paste a whole day of the HK chat at once (Departures → WhatsApp HK group): select the messages in WhatsApp Web, Ctrl+C, paste, Read messages. One summary and one "Undo all". Messages already done are skipped. You can also upload a chat exported from your phone, or use the automatic console line (see How to set up).',
  ] },
  { v: 320, items: [
    '⭐ QR Code Maker: press ⭐ Save to keep a code for the whole team (menu, Wi-Fi, review page…). Saved codes show as tiles with a small preview on every device: tap one to open it, ✕ to delete.',
  ] },
  { v: 319, items: [
    '🔳 New QR Code Maker (menu → Tools): paste a link or text and the QR code appears straight away, ready to scan with a phone. Add a caption, pick a size, then Download, Print or Copy it. There is also a Wi-Fi mode so guests can scan to join the network. Your recent codes are kept on this device.',
  ] },
  { v: 318, items: [
    '🎨 Menu: "Night Audit · PM Rooms" is now just "PM Rooms" (it sits under Night Audit), so it fits on one line and its highlight no longer spills over. Menu names always stay on one line, and the hover tip shows only the page name.',
  ] },
  { v: 317, items: [
    '🗂️ The side menu is tidier, in clear groups: Front Desk, Night Audit, Money & Tax, Guests & Sales, Team, Tools and System. A group you can\'t use for your role hides itself.',
  ] },
  { v: 316, items: [
    '🎨 Arr vs Dep: the arrivals upload box now looks like the Departures one. Drop the file or press Browse, with 3 short steps underneath. Pasting the text is still there under "Paste the report text instead".',
  ] },
  { v: 315, items: [
    '🎨 Front Office Log now has the same line icon as the rest of the menu.',
  ] },
  { v: 313, items: [
    '🔑 A fresh sign-in page: it matches your theme, has clearer messages, a Stay signed in switch and smooth animations.',
    '✨ The app feels more alive: numbers count up, new tasks slide in, ticks pop, and you get a little celebration when a shift\'s tasks, all departures or the monthly reports are done. It turns off if your phone is set to reduce motion.',
  ] },
  { v: 311, items: [
    '🎨 Upload boxes look cleaner on every page: a neat card with a readable paste field. On Purpose of Stay the file inputs are now proper buttons ("📂 Opera Excel", "🌍 Origin XML") with the Load button next to the paste box.',
  ] },
  { v: 310, items: [
    '🧳 Departures: 4 rooms per row in straight lines (3 on a smaller screen, 2 on a tablet, 1 on a phone). Cards in the same row are the same height and their Check out buttons line up.',
  ] },
  { v: 309, items: [
    '🧳 Departures: no more empty gaps between room cards. Cards of different heights now fit together (each moves up under the one above it, still in order left to right), and the spacing inside each card is tighter.',
  ] },
  { v: 308, items: [
    '🧾 My upsells fix: tax and service-charge lines Opera posts next to a package (e.g. 2.45 service charge on a 24.48 breakfast, VAT, municipality fee) are no longer counted as a separate upsell. Only the package itself counts.',
  ] },
  { v: 307, items: [
    '🧾 My upsells: when a guest stays on and a colleague makes a new confirmation and adds the package again, it stays yours, and the Excel says so on that line: "Extension. Original booking 617680069 (same guest), sold by me on 12 Sep 2026 13:25. Re-added by CNONIS on the new booking." The Evidence sheet shows the Opera lines of both bookings (your original sale and the re-add) as proof.',
  ] },
  { v: 306, items: [
    '🧾 My upsells Excel: a short "Reason" column on every line, e.g. "Added by me", "Extension of 617680069 (same guest), sold by me" or "Changed from UPS30BB, sold by me", so your manager sees at a glance why each upsell is yours.',
  ] },
  { v: 305, items: [
    '📌 Pin packages in My upsells: on any line in "Not mine but close" tap 📌 Mine and it counts as yours from then on (totals and Excel update at once). On your own lines, 📌 Pin locks them to you whatever later changes say; 📌 Pinned · unpin lets the rules decide again. These are the same pins as 📌 Freeze seller in Package Audit, saved for the team, with Undo / Ctrl+Z.',
  ] },
  { v: 304, items: [
    '🧾 My upsells counts more accurately: a package a colleague removed and put straight back (to change its price) is still counted for whoever sold it, at the price it was first sold for. On a long stay this had dropped a whole room upgrade from the total.',
  ] },
  { v: 303, items: [
    '🧾 My upsells Excel: just two sheets, "My Upsells" and "Evidence". A navy title band, your name, the period and the totals, then every upsell (No., Date, Confirmation No., Room, Guest Name, Package, Type, Amount, Sold On), all centred, with a soft colour per type and a total row. Evidence lists the Opera log lines. No rules, notes or anything about how it was made.',
  ] },
  { v: 302, items: [
    '🧾 My upsells Excel, cleaner: a simple, centred report ready for your manager. "Upsell Report" with your name, the period and the totals at the top, then No. · Date · Confirmation No. · Room · Guest Name · Package · Type · Amount · Sold On · Reason ("Sold by me on 8 Oct 18:36 · extension of 617966995, same stay"). A Summary sheet (by type and by date) and an Opera Log sheet with the log lines behind each upsell. The file is named like "Upsells - Name - Oct 2026".',
    '🧾 My upsells estimate is closer to the truth: packages that were deleted later (e.g. breakfast swapped for an upgrade) are no longer counted, and only nights up to yesterday are counted (tonight is charged at night audit). With the journal that has the package codes loaded, the real posted amounts are used.',
  ] },
  { v: 301, items: [
    '🧾 My upsells fix: card and cash payments (Visa, Mastercard, cash, deposits… codes 9000+) are never counted as an upsell any more, even when their remark mentions breakfast. Only the line\'s own code and description decide what was sold, so the day totals are right again. A real package reversal (e.g. the upgrade fee taken back) still shows as a minus.',
    '📅 My upsells: one-tap period buttons next to From / To: This month, Last month, All loaded. Load older reports and only the nights in the period you pick are counted.',
  ] },
  { v: 300, items: [
    '🧾 New: My upsells (Package Audit → 🧾 My upsells), works without IN-Gauge. Load 3 Opera files: the User Activity Log PDF, the Reservation Detail (res_detail) and the Journal by Transaction Code (finjrnlbytrans). Pick whose upsells (you by default) and see every night you sold: date, confirmation, room, guest, package, amount, and in plain words WHY it is yours, with the exact Opera entry as proof. 📥 Download a colour Excel (My upsells, Summary, Evidence, Rules used), and 📌 Save today\'s record: every save is kept with its date and time, never overwritten. Keep the 3 Opera files too: they are the original proof.',
  ] },
  { v: 299, items: [
    '🧳 Departures has a new look. Load the Opera file with 📂 Browse or drag it onto the page (txt, Excel, csv or xml; paste still works), or drop it on any page and it goes to Departures. See the day at a glance: a progress ring ("3 of 22 done") and tiles you tap to filter (Due out, Checked out, Late check-out, the new Overdue, No answer, DND, Extended, Open balance). Clean room cards with a big Check out button, sort by room / status / time / name / balance, and a compact view.',
  ] },
  { v: 298, items: [
    '🔁 Arr vs Dep is now all about extensions: a big "Extensions today" count and one card per guest, with the room (old → new if they moved), the new booking number to copy, nights and new check-out date, ✓ Sure (same name and room) or ~ Check (only the surname matches), and a shared "Mark as checked". Guests extended on the same booking show too. Everything about arrivals is folded under "Other details".',
  ] },
  { v: 297, items: [
    '↩ Undo anything with Ctrl+Z (⌘Z on Mac): ticked a task, changed a room\'s status, answered a wake-up call, deleted something by mistake? Press Ctrl+Z, or tap ↩ Undo on the bar that shows for a few seconds. Ctrl+Shift+Z (or Ctrl+Y) puts it back. Inside a text box Ctrl+Z still undoes your typing. Your last actions are in ⌨ Shortcuts → Recent actions.',
  ] },
  { v: 296, items: [
    '⚙️ Package Audit rules, redesigned: each rule is now one simple Yes/No question with a tiny example (Sam → Lina ⇒ 🏆 Sam) and the recommended answer marked. A "How it decides" guide at the top in 3 steps, a 🔍 box to type any confirmation number and see who gets it and why, Undo after every change, and the fine-tuning tucked under "More options".',
  ] },
  { v: 295, items: [
    '⏎ Enter saves: in any window (edit a task, add something, settings…), press Enter in a field and it clicks the window\'s main button (Save / Add / OK). In a big text box Enter still makes a new line; Shift+Enter never saves.',
  ] },
  { v: 293, items: [
    '📦 Package Audit: the same kind of package at a different price is the same package, and stays with whoever started it, also after an extension. Breakfast = any …BB, BBSUM, BBWIN, MBREAK; dinner = …DIN; early check-in = …EC; late check-out = …LC; room upgrade = USS + a number (USS50, USS75…). Half board and full board are their own kinds.',
  ] },
  { v: 292, items: [
    '🥐 Package Audit: every package ending in BB is breakfast. Whoever started the breakfast keeps it, even when it changes to 30BB, 60BB or 80BB, and also when the guest extends on a new confirmation. (The "each code is its own package" switch in Rules is now off; turn it on only if you want 30BB and 60BB counted separately.)',
  ] },
  { v: 291, items: [
    '📦 Package Audit: each package code is its own package. UPS30BB and UPS60BB are different upsells, so whoever first put UPS60BB on the stay gets it, even if someone else sold UPS30BB before on the same guest. When a booking\'s package was swapped (UPS30BB → UPS60BB), the code it ended up with is the one that counts. Switch: Rules → "Each package code is its own package".',
  ] },
  { v: 290, items: [
    '📦 Package Audit is one simple list now: only what still needs fixing in IN-Gauge. Copy the confirmation number and it is done, it leaves the list (Undo if needed). It only comes back if a NEWER IN-Gauge report still shows it wrong, marked "Came back" with the nights still wrong. The line at the top shows what was fixed today and what is waiting to be confirmed.',
    '⚙️ New Package Audit Rules: see every rule that decides the seller, with an example, switch rules on or off and see straight away which packages would change. Tap Why? on any package for the step-by-step story (who added what in Opera, the chain of bookings, which rule decided). 📌 Freeze a seller on any package. Smart suggestions tell you what to check.',
    '👥 Team names for Package Audit are kept in the app now (Rules → Staff names), not in the code. Until you add them, names are taken from the IN-Gauge file.',
  ] },
  { v: 289, items: [
    '🧹 Skip The Clean: a guest who stays on with a new confirmation number now shows as ONE line, with the points added up (e.g. 2 skipped days = 200 points), so you enter the points once per member. Both confirmation numbers are shown; tap "2 stays merged" to see each stay. Ticking Done marks every stay on the line as credited.',
  ] },
  { v: 288, items: [
    '❗ Important shift tasks: tap ❗ next to a task (or "❗ Important" when adding one, or in Edit) and it gets a red IMPORTANT tag and a red edge on the list. Its reminder shows ❗ too, and the handover lists important tasks first.',
  ] },
  { v: 287, items: [
    '📦 Package Audit follows one simple rule: the package belongs to the first one who put it on the guest\'s stay. A guest staying on with new confirmations (same guest, back to back) keeps that first seller for the same package, even if someone re-adds it on a later booking, and even when the stay\'s very first booking had no package at all. A different package (breakfast vs a room upgrade) belongs to whoever first put that one.',
  ] },
  { v: 286, items: [
    '📦 Package Audit: a guest who stays on with a new confirmation (an extension) only keeps the first seller for the SAME kind of package. If the first booking had breakfast and someone sells a room upgrade on the new booking, that upgrade is their sale, not the first seller\'s (and the other way round). Before, every package on the extension went to whoever sold the first booking.',
  ] },
  { v: 285, items: [
    '🏛️ DTCM Recon remembers what you fixed. Copying a correction\'s DTCM ID (or ticking it, or tapping ✓ Fixed) marks it as fixed for good: when the next day\'s files still show the same correction (same room and night), it no longer comes back as a to-do. It sits under "✓ Fixed already" with who and when; if it is still in the files 3 days later you get a gentle note, and Undo puts it back on the list. Home, the handover, the morning brief and Ops Brain count only what is still open.',
  ] },
  { v: 284, items: [
    '🔐 Safer accounts: when someone signs in from a phone or browser their account never used before, the owner and managers see it in Ops Brain ("Sam signed in on a new device: Chrome on Android"), and the person\'s own other devices are told too. Not you? Change your password; a manager can sign that person out everywhere (Team → Disconnect).',
    '💾 Owners get a weekly reminder to download a backup of everything to their own computer.',
    '🛡️ Ready for Firebase App Check: once switched on, only this app (not a copy or a script) can use the database. Guest Memory now loads after sign-in, ready for the stricter database rules.',
  ] },
  { v: 283, items: [
    '☀️ Morning brief: the whole day on one screen. Who is on, departures and arrivals, wake-up calls, tasks, monthly reports and open items. Tap ☀️ Brief on Home, copy it or send it on WhatsApp. It opens by itself for managers each morning (untick "Open by itself" inside it to stop that).',
    '🙋 Ask for a day off from your phone: Roster → My shifts → Ask for a day off (a day off, annual leave or a shift wish). Your manager approves or declines in one tap and you see the answer straight away. Approved days go into the roster builder for weeks not posted yet; for a posted week the manager can put OFF/AL on those days in one tap.',
    '⚖️ Monthly fairness on the Roster page (managers): who did the nights, weekends and public holidays each month, with ▲▼ when someone is far above or below others with the same title. Copy as text or CSV.',
    '🧾 My balances under My shifts: your PH owed, vacation left, and days off and nights this month. Only you see your own numbers.',
    '👥 New roster rule (off until you turn it on): Rules → Hotels & managers → "Own Team Leader for night gaps". On a night the Supervisor is off, the hotel\'s own Team Leader covers it before a Supervisor is lent from another hotel.',
    '🗂️ New Front Office Log page: 🧳 Lost & Found with photos and who it was returned to, 🔧 maintenance tickets followed until fixed, 💵 float count per shift (shows short or over), and 💰 an upsell list from today\'s arrivals with offered and sold.',
    '📄 Skip The Clean month summary as a PDF, 🏆 a Seller board in Package Audit (packages, value and commission per person per month; set the commission % once), and a fuller 🗂 DTCM month-end pack for finance with open and fixed corrections and signature lines.',
    '🎓 Standards quiz on the Learn page: 10 quick questions on the Standards and front-desk basics, with your score saved. Managers see everyone\'s best score and weak topics.',
  ] },
  { v: 282, items: [
    '📆 New: Monthly reports, at the top of Shift Tasks. Add the reports you finish every month once (Monthly TD check, Revenue data by accounts, Statistics report, or your own). Each month they come back for the month that ended: October\'s are due 1 to 4 November (you can change the last day). Everyone sees the same list; tick one and it shows who did it and when. From the 1st, Ops Brain reminds whoever is on shift every day until they are all done; on the last day and after it, it rings. Search "monthly report" to jump there.',
    '🔁 Shift tasks can repeat: pick "Every week" or "Every month" next to the date. The task comes back on the same weekday or the same day of the month (the 31st becomes the last day in shorter months) and reminds you on the day. Tick it and it moves on to the next time; miss it and it stays as "missed" until the next time comes.',
    '📋 The handover now writes "For the next shift" first: late check-outs, wake-up calls coming up, the shift\'s tasks not done, monthly reports due, DTCM and package lines, no-shows and notes, by name. Send it on WhatsApp with one tap, and 30 minutes before your shift ends Ops Brain tells you it is ready.',
  ] },
  { v: 281, items: [
    '🔧 Behind the scenes: the automatic test checks on GitHub now use the newest tools (checkout v7, setup-node v7). Nothing changes in the app.',
  ] },
  { v: 280, items: [
    '🧹 Skip The Clean is redesigned and explains itself: three steps on the page, each ticking green when its file is in. 1) the housekeeping "SKIP THE CLEAN" email\'s Excel files, 2) Opera Reports → Manage Reports → "Membership Stays" (loyalty_member_stay), all 5 statuses, Download As → Delimited Data → Tab, 3) credit the points. Big tiles show who is ready, the points, who to check, who is already credited and who is not a member; a rules card with a worked example shows which days count (no arrival or departure day, every 3rd day a mandatory clean). Downloading the Opera file in the wrong format now tells you exactly what to pick.',
  ] },
  { v: 279, items: [
    '🏨 A new kind of own rule: "never at the same hotel on the same day". Before, "never on duty together" only kept two people off the same (or an overlapping) shift; now you can choose that they are never at the same property on the same day, whatever their shifts. Rules → Your own rules → pick "never at the same hotel (the same day) as", or tell Ops Brain "Sam and Lina never in the same hotel".',
  ] },
  { v: 278, items: [
    '🔎 Search results open again when you tap them: moving the mouse over a result redrew the list and swallowed the click. Now the option\'s page opens, the section unfolds and the option lights up, also on big pages that take a moment to draw.',
  ] },
  { v: 277, items: [
    '🔎 Search finds options too (Ctrl+K or the search bar): type what you want, like "fixed day off", "12 hour", "freeze", "cut off", "avatar", "idle", "auto tick", "language". Tap the result and the app opens that page, unfolds the right section and lights the option up. Every setting is searchable, and words can be in any order ("day off fixed" works too). You only see options for pages you can open.',
  ] },
  { v: 276, items: [
    '📌 Fixed days off for the whole team in one place: Roster builder → Rules → 📌 Fixed days off. Everyone is listed by hotel with their title, managers too; tap Sat (or any day) to make it their day off every week, tap again to free it. The builder always gives them that day off, unless leave or a request is already on it. It is the same setting as on each person\'s card.',
  ] },
  { v: 275, items: [
    '📅 Roster weeks show their days: "Mon, 5 Oct – Sun, 11 Oct 2026" on the Roster page, in the builder, in roster notifications, on the person card\'s history and on the "My week" picture.',
    '🕐 Roster times in 24-hour or 12-hour: tap 🕐 24h / 12h next to "This week" (or Settings → Clock and roster times). 12-hour shows the grid as 9a–6p, 12a–9a and other places as 9:00 AM – 6:00 PM. The roster itself is unchanged.',
  ] },
  { v: 274, items: [
    '😀 Each person\'s character is far more customisable (Team → their card → Their look): a big preview that changes as you tap, every option shown as a little picture of them, 18 hair styles (afro, braids, ponytail, mohawk, beanie…), 15 hair colours, 10 skin tones, eyes, eyebrows, blush or freckles, beard or moustache, glasses, extras (earrings, necklace, flower…), outfits (uniform, suit & tie, polo, hoodie, blazer), outfit colour and a background colour. 🎲 Surprise me (keeps the skin they chose) and ↺ Start again. Looks already chosen stay as they were.',
    '🎮 The live desk shows everyone bigger, and a crowded desk shrinks them a little so nobody is cut off.',
  ] },
  { v: 273, items: [
    '🧭 The roster builder moves people as little as it can: "Work at your own hotel" and "Same hours" are now Very important by default, and "No morning straight after nights" Important. On your team: fewer shift changes in a week (10 → 7 over 8 test weeks, and no more earlier starts after a later shift), fewer night → morning (9 → 4 in the hard weeks with sick leave), the same cover, rest never cut, a few more wishes granted. You can lower any of them in Rules.',
  ] },
  { v: 272, items: [
    '✅ Shift tasks tick themselves when the app can see the work is done: "ALL enrollment" once an enrollment is sent today in Guest Pipeline, the night audit checklist when every step is done, "pending check-outs" when every departure is out or extended, today\'s arrivals, departure board, Purpose of Stay, No Show, DTCM corrections, Package Audit and wake-up calls. The shift log says why ("ticked by HotelOps: 3 ALL enrollments sent today"). Untick it and it stays unticked for that shift. Settings → Helpers to turn it off.',
  ] },
  { v: 271, items: [
    '🛡️ A full check of the app, with about 30 fixes. The big ones: saving no longer wipes what a colleague did meanwhile. Departures saves only the rooms you changed (a colleague\'s check-out typed while you wrote a note stays), the Arrivals, Purpose, Feedback and Shift logs add your line on top of everyone\'s, shift task edits touch only that shift, and Package Audit pins and copied marks save one at a time (Undo only puts back yours).',
    '🔄 Clearing or resetting (the departure board, No Show, the night checklist) now reaches every device; before, another device kept the old data and brought it back. The Arrivals and Purpose activity logs load again after a reload.',
    '📶 Sign-in no longer hangs with no signal, and roster, wake-ups, notes and settings stay live after signing out and in again.',
    '⏰ Sign out when idle follows the setting (Never, 15 min… 4 hours) and never stops on a "Sign out?" question. Wake-up calls: changing 23:45 to 00:15 moves the call to the next morning, and missed calls stay in Call now until someone marks them. Late check-out typed as "1pm" or "1300" is understood.',
    '🗓️ Roster: "Build again" on a posted week keeps the new build instead of snapping back to the posted one, approving a swap no longer deletes unpublished edits, "next shift" shows the right day for night shifts (00:00 on Saturday = Saturday night), a new shift code takes effect at once, and a scanned roster can\'t merge two people into one.',
    '🔒 Names, notes and file names from the team or from reports can no longer run code on someone else\'s screen (No Show, checklist, undo messages, user name). The ready-made Firebase rules are stricter: a disabled account can\'t read anything, nobody can raise their own role, and a new hotel can be set up by the person who creates it.',
  ] },
  { v: 270, items: [
    '🔄 Shift tasks start fresh every day by themselves: each list (morning, mid, afternoon, night) is cleared once when its shift begins, for the whole team, even a list nobody opened that day. The shift that just ended keeps its ticks for the handover, and dated tasks keep theirs. Settings → Helpers → Fresh shift tasks every day.',
    '🧹 The browser\'s own storage message ("database without an in-progress transaction", from the sign-in library) no longer counts as an app error in Ops Brain.',
  ] },
  { v: 269, items: [
    '📅 Shift tasks can have a date: a one-off for that day ("Sat 17 Oct: send the group rooming list"). Pick it next to the time when you add a task, or ✏️ edit one. Until then it waits in 📅 Coming up (not counted). On the day it is on that shift\'s list and reminds you, at its time, or when the shift starts if it has no time. If nobody ticks it that day, it stays on the list in red as "missed" until it\'s done. Its tick is never cleared by the fresh start of the next shift.',
  ] },
  { v: 268, items: [
    '✅ Shift tasks: ticking a task (on the page, or ✓ Done in an Ops Brain reminder) now adds only that tick to what the team already ticked. Before, a phone whose list was behind saved its whole old list and wiped everyone else\'s ticks, so it looked like a reset with only your task done.',
    '🔄 The fresh list at the start of each shift checks what is saved first: if a colleague already started the shift, it keeps their ticks instead of clearing them again, and it never clears while offline.',
  ] },
  { v: 267, items: [
    '🏛️ DTCM Recon reads a month-to-date report properly (e.g. 1–14 Oct). Before, a report longer than a week was counted night by night from each guest\'s check-in, so guests who arrived in September made hundreds of false "to add" and "to verify" items. Your 1–13 Oct files went from 565 corrections to 31 real ones, and the 30 AED is fully explained.',
    '🛑 The 30-night limit is counted in that window too: for a long stay the free nights are the ones after night 30, not the first days of the month. A night 31 posted in Opera shows as one to reverse.',
  ] },
  { v: 266, items: [
    '📦 Package Audit has two windows now: 🛠 To fix (not copied yet) and 📋 Copied (who copied it and when). Copying a confirmation number moves the package to Copied.',
    '📅 A package of several days is charged day by day in IN-Gauge, and each day keeps the old seller until you change it. When you copy one, the app lists its days, and in Copied each day has its own tick. Until every day is ticked, the package stays open with an orange reminder saying which days are left. Copy rows to update ticks every day it copies.',
    '↺ A fix that didn\'t stick comes back: if you load an IN-Gauge report saved after your fix and it still shows the package wrong, it moves back to the top of To fix in red: "Still wrong after the fix of 13 Oct". Copy it again, fix those days, tick them.',
  ] },
  { v: 265, items: [
    '⏰ Wake-up calls: the Coming up list is tidy again. Each call is a clean row (time, room, guest, buttons) instead of a half-coloured box with the time stuck to its edge.',
  ] },
  { v: 263, items: [
    '✅ Package Audit: copying a package marks it done, so you always know which ones you fixed. Tap a confirmation number (or use Copy rows to update / Copy rows to remove) and the row shows ✅ with the time and who copied it, fades and moves to the bottom. Needs action counts only what\'s left. The whole team sees it; the new ✅ Done chip lists them, and ↩ (or Undo) puts one back.',
  ] },
  { v: 262, items: [
    '🔒 Safety: sample emails in the sign-up and add-user boxes are now neutral ones, the project blocks report and roster files (Excel, CSV, backups) from ever being uploaded to GitHub by mistake, CI runs with read-only access, and ready-made Firebase rules (database.rules.json) let only your hotel\'s signed-in team read its data.',
  ] },
  { v: 261, items: [
    '⏰ Shift tasks can have a time: pick it when you add a task (or ✏️ edit one). At that time, on that shift, you get a chime, a notification and a bubble with ✓ Done / In 10 min. A task whose time has passed and isn\'t ticked shows its time in red.',
    '🌴 Quiet when you\'re off: on your day off, PH, vacation or leave, or outside your shift, the app no longer rings or pops up (late check-outs, wake-up calls, Ops Brain bubbles, task reminders). It knows from the roster: your name in Roster → My shifts. Reminders you set yourself ("remind me at …") still ring. Settings → Alerts → Quiet when I\'m off turns it off.',
  ] },
  { v: 260, items: [
    '📖 The project guide (README) is rewritten and up to date: every page, the roster and builder, Ops Brain, themes and languages, how to set up and ship, plus a security checklist. A sample guest email shown in an input box is now a made-up one.',
  ] },
  { v: 259, items: [
    '📌 A posted week in the builder is always the posted roster, whoever posted it and whatever draft the builder had, even one made later. You see what was posted, with its problems and the "What we noticed" check. Changes you make to it in the builder are kept until you publish them; if the posted roster changes meanwhile, the posted one wins.',
  ] },
  { v: 258, items: [
    '🏖 A PH in a posted roster is management\'s decision: it is added to that person\'s balance and taken in the same step, so it evens out. It is never a problem, never a "balance not set" note, and never a debt that cancels the next holiday they work. The week check just lists the PH days given; 🏖 PH balances stays there (folded) if you want to look.',
    '📌 Management\'s posted roster is final: the builder takes it as it is (even when it differs from the builder\'s own draft), learns from it, and builds the next week on top of it.',
  ] },
  { v: 257, items: [
    '📌 The builder shows the roster you posted: open a posted week and you see what was posted (like management\'s roster given for 12–18 Oct), not the draft the builder made before. Edits made later on the Roster page show up there too. A draft started after posting and still being worked on is kept.',
  ] },
  { v: 256, items: [
    '🏖 PH only counts as someone\'s rest when they had a PH to take. In the builder\'s "What we noticed" check, a PH given to someone with no balance set shows a note, plus a 🏖 PH balances list for the whole team with − / +. Set each person\'s PH owed once; after that the app keeps count (a PH given −1, a public holiday worked +1). Setting a balance now works even when PH days were already given before the app knew any holidays.',
  ] },
  { v: 255, items: [
    '📋 Give the builder a roster (📥 Give this week\'s roster, or post it on the Roster page): it learns from it, and the builder now shows "What we noticed" for that week in plain words. Hours with nobody on a hotel\'s desk come first, then the small things (earlier starts, night → day off → morning). PH days owed and vacation (V) are never counted as problems: a PH counts as that week\'s rest.',
  ] },
  { v: 254, items: [
    '💡 Roster page → "Ideas to make this week kinder": for a posted week it finds small trades between two colleagues of the same hotel that remove a hard spot (an earlier start without a day off, a night → one day off → morning, short rest). The cover stays exactly the same, nobody gains or loses a day off, nothing new goes wrong. Tap Apply, or ignore it.',
    '✅ Roster checks: a shift the hotel doesn\'t usually run (like a 19:00 – 04:00 at Adagio) now counts for the desk hours, so its hours are no longer reported as empty, and someone on vacation all week (V) is no longer asked for a day off. "V" is now read as vacation.',
  ] },
  { v: 253, items: [
    '🩹 Tap a red cell in the draft (like a day off before the cut-off) and "Fix this for me" is right at the top. It re-plans only that hotel and keeps everything else as you left it. For Judith it keeps her on the 19:00 nights she was already on (a 12:00 start after Sunday\'s night is too little rest), with her day off after the 15th.',
  ] },
  { v: 252, items: [
    '✂️ HR cut-off card redesigned for phones: a proper on/off switch, − / + for the cut-off day and the days off in each half (no more oversized number box), and each half shows how many people still have days off left. Tap a half to see and change who.',
  ] },
  { v: 251, items: [
    '🛎 Bell boys are part of their hotel\'s team and follow the same day-off rules (cut-off, freeze), but the team works without them when they are off: a bell boy\'s day off is never a gap, nobody is moved from another hotel to cover it, and it never weighs on the rest of the week.',
  ] },
  { v: 250, items: [
    '🩹 Fix one person without rebuilding: next to a problem in the draft (a day off before the cut-off, short rest, too many days in a row…) tap 🩹 Fix. Only that person\'s hotel is re-planned, changing as little as possible; every other hotel and the bell teams stay exactly as you left them, hand changes included. It is kept only if the week gets better, it lists every cell it changed, and ↶ Undo puts it back.',
  ] },
  { v: 249, items: [
    '✅ "Everyone took their days off, except…": tell Ops Brain "from 1 to 15 all took 2 days else Sam, Alex and Lina", or in ⚖️ Rules → ✂️ HR cut-off tap "Everyone took theirs, except…" and pick them. Only those people get a day off before the cut-off; everyone else (bell boys too) gets theirs after it. Then build the week again.',
  ] },
  { v: 248, items: [
    '🔄 A draft now tells you when it is out of date: if the rules (day-off freeze, cut-off…) or someone\'s card changed after it was built, or it was built by an older version of the app, a yellow note says so with a "Build it again" button. Old drafts keep their old days off until rebuilt, which is why Judith and Uzoma still showed Monday off.',
  ] },
  { v: 247, items: [
    '🛎 Bell boys now follow the 🚫 day-off freeze and the ✂️ HR cut-off like everyone else: no day off before the cut-off unless you picked them. Only managers (and anyone with a 📌 fixed day off) keep their days off as usual.',
  ] },
  { v: 246, items: [
    '🛠 Days off fixed: with a 🚫 day-off freeze and the ✂️ HR cut-off both on, people outside the freeze could end up with no day off at all that week. Now the freeze comes first and their one day off moves to after the cut-off. Nobody gets two in a week, and nobody gets none.',
    '✂️ The cut-off card now says when there is no roster in the app for part of the half (like 1–4 Oct), because days off taken then cannot be counted. Set what each person has LEFT directly with − / +, or "Everyone left: 0 1 2" in one tap.',
  ] },
  { v: 245, items: [
    '✂️ HR cut-off is a must, every week, and never two days off in one week: each week gives one day off, in the half of the month that still owes one (the half ending first first), so 2 before the 15th and 2 after are done in time. If someone has more left than the weeks allow, the draft says so instead of giving two in one week.',
    '🚫 Day-off freeze: the people you pick now MUST take their day off inside those dates (not just "may"); nobody else is off. A missed day off is no longer given back as a second day off in one week.',
    '⚠️ Hotels a person should not go to: on their card, tap a hotel: ✓ fine → ⚠️ only if there is no other option → 🚫 never. With ⚠️ the builder sends someone else first and only sends them when nobody else can.',
  ] },
  { v: 244, items: [
    '📱 Person card on iPhone: it no longer slides sideways and cuts off the left side (names, titles). A long shift choice like "Static: always 00:00 – 09:00" now shortens to fit, and the week table scrolls inside its own box.',
  ] },
  { v: 243, items: [
    '✂️ HR cut-off: ⚖️ Rules → ✂️ HR cut-off (or tell Ops Brain "everyone 2 off before 15 and 2 after"). The month is cut on the 15th: each half, everyone has a number of days off. The builder counts what each person already took, gives what is left and finishes it before the cut-off; none left means no day off until the 16th. Change anyone\'s number with − / +, or "Everyone 0 1 2 3" in one tap. Managers stay as they are.',
    '📌 Fixed day off: on a person\'s card in 🧑‍💼 Team (or "Saad always off on Thursday"). That weekday is their day off every week; leave and requests still come first.',
  ] },
  { v: 242, items: [
    '🚫 Day-off freeze: pick a from-date, a to-date and who may still be off (⚖️ Rules → 🚫 Day-off freeze, or tell Ops Brain "only Sam, Alex and Lina can be off until 15"). Everyone else works through and takes their day off after it ends; managers keep their days off as usual. If someone misses a whole week\'s day off, they get it back the week the freeze ends. The draft notes say so, and a day off inside a freeze shows as a problem.',
  ] },
  { v: 241, items: [
    '🌐 Languages: ⚙️ Settings → Appearance → Language. English, العربية, Français, हिन्दी, Русский, 中文 and Filipino. The menus, page names, Home tiles, main buttons, settings and sign-in screen change; guest names, rooms and everything typed stay exactly as they are. Works offline, nothing is sent anywhere. Words not translated yet stay in English.',
    '🔤 Font styles: 12 to choose from, each shown in its own letters. Inter, your phone\'s own, DM Sans, Poppins, Nunito, Montserrat, Roboto, Lato, Lexend (easiest to read fast), Atkinson (made for clear reading), Cairo (Arabic and English) and Playfair (elegant). Each person picks their own.',
  ] },
  { v: 240, items: [
    '📱 Phone layout: the 🧠 Ops Brain bubble no longer sits on top of buttons and text. It slides away while you scroll down and comes back when you scroll up or stop. Every page now ends with enough room that its last button (like Copy Log) is never under the bubble or the menu.',
  ] },
  { v: 239, items: [
    '📱 iPhone: the end of every page was hidden under the bottom menu. The app was sized to the full screen, including the part behind the browser\'s own bar. It now fits the screen you can actually see, and every page ends with room to spare above the menu. Pop-ups and long lists fit the visible screen too.',
  ] },
  { v: 238, items: [
    '🏷 Hotel logos: in the 🎮 Live desk, tap 🏷 next to a hotel\'s name and upload its official logo (PNG or SVG). It replaces the painted name on that lobby\'s wall and in Rush Hour, for the whole team.',
    '🏊 Hotel facts: ask Ops Brain "pool timing?", "gym?" or "where is the bar?". Pool 08:00 – 19:00, gym open 24 hours with the room key, and at Ibis the bar is on the rooftop and the first floor. In Rush Hour the desk now gives guests these real answers.',
  ] },
  { v: 237, items: [
    '🎯 Rush Hour: a real one-minute game in the 🎮 Live desk. You are alone at the desk and guests queue up with requests (WiFi password, late check-out, Dubai Mall, an iron…). Tap them before their bar runs out. Fast serves build a combo up to ×5, 👑 VIPs pay triple but wait less, ☕ calms everyone down, and 🐈 the cat does not want a room. 3 angry guests and the shift is over. Each guest thanks you in their language, angry ones threaten a 1-star review, and you get a rank from 🐣 Trainee to 👑 Front Desk Legend, with your best score kept and confetti for a new best.',
    '🏅 Badges for playing around: First poke, Poke master, Bell addict, Night watch, Disco time, On fire, Supervisor material, Legend and Cat whisperer.',
    '🧳 Guests in the lobby are now little cartoon people who walk on their own legs, and each lobby has a lift whose doors open now and then.',
  ] },
  { v: 236, items: [
    '🎮 The live desk got funny: every few seconds something happens in a lobby (a cat asking for the presidential suite, pizza for room 404, a duck nobody can explain, a VIP with a crown, parcel number 47, a ghost in the lift at night…), told in 📣 Lobby News at the top.',
    '👉 Tap anyone to poke them: they jump and say something silly. Tap the 🛎 bell: DING, everyone jumps and says "Coming!" (and if the desk is empty: 🦗 crickets). Sleepy night staff float little Zzz, the coffee steams, the phone shakes when it rings, the plant sways, and at midnight there\'s a 🪩 disco.',
    '📊 Silly numbers for the day: coffees, guests helped, "what\'s the WiFi?" questions, heroes on duty, dings and pokes. Small sounds on taps (🔊/🔇 to turn them off).',
  ] },
  { v: 235, items: [
    '🎨 Phone menu (More): the long row of theme icons made the menu wider than the screen, so the whole page slid sideways and cut off Roster, No-Shows and the rest. It is now one button showing your theme ("● Night Ops ▾") that opens the list of every theme, like the sign-in screen and the top bar.',
  ] },
  { v: 234, items: [
    '🎨 Sign-in screen: the row of theme buttons that ran off the screen on phones (and was hard to read) is now one button, "🎨 Night Ops ▾", that opens the list of every theme, the same list as the top bar inside the app. All 18 themes, not just 7.',
  ] },
  { v: 233, items: [
    '🌙 Night shifts read the way your managers write them: "00:00 – 09:00" on Saturday is Saturday night (right after Saturday\'s 15:00 – 00:00, until Sunday 09:00), not Friday night. Rest is now counted on the real hours everywhere: the builder, Team Health, swaps, who\'s on now and the live desk. So 15:00 – 00:00 then 00:00 – 09:00 the next day is a full day of rest, not "back to back", and a night is followed by a day shift only after real sleep.',
    '📋 Learning from posted rosters got more honest: false "managers do back-to-back shifts" and "7 h rest" lessons are gone, and an evening before a night is no longer counted as a rule bent. When one hotel has two people on a night and another hotel nobody (Ibis and Mercure, 5–6 Oct), one of them is read as covering the other hotel.',
    '🛡 Even the very last way to cover a shift never goes under your rest floor (7 h unless you change it). Before, a night could be followed by a 12:00 start the same morning in the hardest weeks.',
  ] },
  { v: 232, items: [
    '🌙 Team Leaders on nights, the way a manager would do it: when no Supervisor or Duty Manager can take the 00:00 night (from this hotel or borrowed for a short time), a Team Leader takes it, with their rest and day off kept. This now comes before cutting anyone\'s rest or putting someone from an evening straight into a night. Only when no Team Leader can (for example, they are still on their 19:00 – 04:00) is another colleague asked. Each time, the Decisions list says so in plain words.',
  ] },
  { v: 231, items: [
    '🌙 Back from nights on a later shift: going from 00:00 – 09:00 to a 09:00 morning is hard even after a day off. As a last step the builder now trades with a colleague in the same hotel, so the first shifts back start at 12:00, 15:00 or 19:00 and the colleague takes the mornings. The same shifts are worked at the same hotel every day, so the cover, the days off and every other rule stay exactly as they were. You see it in the notes ("🌙 … traded with …"). On your team\'s next weeks this cut the hard returns from 7 to 3; the other 3 had no safe trade.',
  ] },
  { v: 230, items: [
    '⎋ Esc closes anything: the live desk, a person\'s card, Ops Brain, the theme list, menus and every other window. With two open, each Esc closes the top one. If you are typing in a box, the first Esc leaves the box (or cancels that edit) and the next one closes the window. Lock screens stay put.',
  ] },
  { v: 229, items: [
    '🎮 The live desk is a real little game now: each hotel\'s lobby with a window on the city (sunrise, blue sky and drifting clouds, sunset, stars and lit windows at night, the sun and moon moving across), a glowing hotel sign, a wall clock showing the time, guests rolling in with suitcases (busier at check-in and check-out), and the team behind a wooden desk with gold name plates and ⚡ energy bars. "Desk covered" or a flashing "Desk EMPTY" on top. ▶ Play the day runs smoothly now.',
  ] },
  { v: 228, items: [
    '🛎 What counts is that the front office is never empty, not that every shift name is filled. The draft\'s first tile now says "desk never empty" ✓ (or how many hours a desk would have nobody, tap for why), and nobody is borrowed from another hotel for a shift whose hours the other shifts already cover.',
  ] },
  { v: 227, items: [
    '🧠 Thinks like your managers: moving someone LATER is fine (08:00 → 12:00 → 15:00 → 19:00, even onto a night the next day, as long as the rest is kept), and it costs little to change hours that way. EARLIER stays hard: night → morning, or a start more than an hour earlier, always needs a day off.',
    '📋 Learned from your posted rosters: what your managers do when there is no other way (an evening into a night, borrowing from another hotel, a little less rest, an earlier start). The builder keeps every rule when it can; when it can\'t, it tries these first, the most used first. See them in ⚖️ Rules → "What your managers do".',
    '⚠ Every rule bent is explained simply in 📝 Decisions: who takes which shift, which rule (e.g. "Rest between shifts · only 7 h instead of 11 h, finishes 17:00, starts 00:00"), why, and what else changes.',
  ] },
  { v: 226, items: [
    '🎨 Five new bright, white themes: 📄 Paper (clean white and teal), 🌤 Sky (white and blue), 🌿 Mint (fresh green), 🌸 Sakura (soft pink) and 🏜 Desert (warm sand and gold). Pick one from the theme button in the top bar (or the theme row in the phone menu); like every theme it is your own, on all your devices.',
  ] },
  { v: 225, items: [
    '🛋 One day off a week, always: a final check on every built week turns any second day off into a working day on a shift that fits (enough rest, no night ↔ day, not too many days in a row), or into a PH day when they are owed one. Requests, leave and PH asked for are never touched. Two days off only when set on someone\'s card.',
  ] },
  { v: 224, items: [
    '🛋 Fixed: covering a night in the middle of the week was giving that person two days off (a day off before the night and one after). Now a midweek night is only for someone who has two days off a week anyway; everyone else covers nights at the start or end of the week and keeps their one day off.',
  ] },
  { v: 223, items: [
    '🕐 The builder thinks like management now: what matters is that every hour has someone at the desk, not that every shift name is filled. A shift nobody works is fine when the other shifts cover its hours that day (like no 19:00 – 04:00 when 15:00 – 00:00 and 00:00 – 09:00 are on), as in the 5 Oct roster. So it stops bending rules and moving people to fill shifts management never runs, and "places filled" counts only real gaps.',
    '🛎 Reception is never empty: if hours are still uncovered after everything else, as the very last way one person on their day off works it (at most one a week per hotel, never a manager or a locked shift, no other rule broken), written under Decisions with "give them a day back (PH) later".',
  ] },
  { v: 222, items: [
    '📋 Someone away? The builder copies how management ran it the last time they were away: with Sam on leave, Adagio runs like the week of 5 Oct — the same cover on those days (not an average guess), the same people on the same shifts and days off, and the same colleagues borrowed first. It says so in the draft.',
    '🌙 Night cover inside the hotel: when two people do nights at a hotel (like two night auditors), the one with fewer nights covers the other\'s night off, as management did, instead of leaving it to a last resort. A single night in the middle of the week (with the day off after) is possible too, so nobody has to come from another hotel for one night.',
  ] },
  { v: 221, items: [
    '🌴 Leave never overwrites the posted roster: a day already OFF or on leave (like an ALA from management) stays as it is; only working days become AL / SL.',
    '🩹 After marking sick or leave, Ops Brain offers cover only for gaps that this caused. A shift that was already short is mentioned apart ("already short before this, not because of …"), and days in a week not built yet are saved for the builder.',
    '✓ A two-step cover fix no longer shows a wrong "drops to 0" note when its second step fills that shift.',
    '🔴 The red "places filled" tile in the draft is tappable: it jumps to the empty shift and why each person can\'t take it.',
  ] },
  { v: 220, items: [
    '🌴 "Sam on vacation until 15" now books today to the 15th (a day number alone, "the 15th" or "15 Oct" all work as the end date).',
    '❓ "How do I…" questions show how to say it, with a button to do it now, instead of doing it straight away.',
  ] },
  { v: 219, items: [
    '🧠 Ops Brain understands plain talk, no commands to remember: "can u keep alex away from mr ali pls", "ahmed not coming tmrw", "lina dont want nights anymore", "how many vacation days left for lina". It finds the names (even misspelt), the day and the shift, says "I understood: …" and does it. "Not this?" shows the other choices.',
    '❓ Not sure what you mean? It shows "Did you mean…" buttons, and learns the one you tap, for everyone, next time. Only names ("ali and alex")? It asks: keep apart, together or swap?',
    '👆 Quick buttons under the Ops Brain box: Someone is sick · Day off · Vacation · Keep two apart · Always together · Swap · Prefers not a shift · What if… · Vacation balance · Who is on · Build next week. Pick the names and the day, tap Do it.',
    '🛡 Anything about a guest or a room ("Mr Ahmed in 512 is sick") never changes the team; "Mr …" alone asks first.',
  ] },
  { v: 218, items: [
    '↔️ Keep two people apart: "never on duty together" now also counts shifts that overlap 2 hours or more at the same hotel (09–18 and 12–21), not only the exact same shift. A handover (00–09 then 09–18) is fine. Tell Ops Brain "avoid Alex with Ali", "Sam and Lina never together" or "Sam can\'t work with Lina", or add it in ⚖️ Rules → Your own rules.',
  ] },
  { v: 217, items: [
    '📌 The builder carries on from the posted roster: the one management gave (5 Oct) and then each week you post. It now says so at the top ("Builds on the posted roster: 5 Oct – 11 Oct"). A draft counts only once it is posted; if last week isn\'t posted yet, it warns you and offers to go there first.',
  ] },
  { v: 216, items: [
    '⚖️ Rules in plain words: every rule has an example from your own team (like "Ali works 09–18 and Abhinav comes at 15: 3 h together, so one can take a break. Fine."). Tap how much each counts: Off · Nice · Important · Very important · Must.',
    '✍️ Your own rules: "Sam and Lina never on the same shift", "Rita always on the same shift as Lina", "Trainees never on nights". Make them in Rules or just tell Ops Brain. The draft shows whether they are kept.',
    '❓ Quick questions ("which is worse?") set the levels for you, and 💡 Ops Brain suggests changes from this week\'s draft, with one tap to apply.',
    '💚 Extra care: anyone whose Team Health drops under 70 gets a gentler week (fewer nights, their wishes first, days off together, one steady shift), written under Decisions.',
    '🎖 Team Leaders can take the 00:00–09:00 night when no Supervisor or Duty Manager can, before anyone else.',
    '🎮 Live desk (Roster → Today): each hotel\'s reception as a little scene: who is on, how far into their shift, a funny line each, who walks in next. ▶ plays the whole day. Everyone has a cartoon look they choose themselves on their card.',
  ] },
  { v: 215, items: [
    '📋 ⚖️ Rules now shows "What comes first": the order the builder follows, from "reception is never empty" and the hard rules down to wishes and fairness.',
    '👥 Nobody alone the whole shift: if someone would be on their own with nobody on the desk with them for a break, a colleague may come from a hotel that has one spare on the same shift (that hotel is never left short). With 2 hours of company from another shift, one person is still fine and nobody is moved.',
  ] },
  { v: 214, items: [
    '🌅 No earlier start the next day: 12:00 – 21:00 then 09:00 – 18:00 (or any start more than an hour earlier than the day before) now needs a day off between, like night and day. The builder never plans it; only as the very last way to keep reception covered, written under Decisions. Switch it in ⚖️ Rules → "Day off before an earlier start".',
    '🚫 Never to a hotel: on each person\'s card, tap a hotel they must never be sent to (e.g. not Ibis). The builder, cover suggestions and last resorts all respect it; other hotels stay possible.',
    '🤲 Gentler fixes: when a shift is empty the builder now looks further for a small fix (a day off moved plus one night borrowed) instead of moving someone to another hotel for the whole week. In tests with your team, every move became a single day.',
  ] },
  { v: 213, items: [
    '🤝 One person on a shift is fine when someone else is on the desk with them for a while: 2 hours together by default (enough for a break), like 08–17 with 15–00. The builder no longer pushes for a second person on those shifts and they are not listed as one-person problems, so it keeps more wishes and steadier weeks. Change the hours in ⚖️ Rules → "Alone is fine with company for" (0 = two the whole shift).',
    '🛎 Reception first: if a week still ends with an empty shift, the builder also tries it the strict way and keeps whichever covers more.',
  ] },
  { v: 212, items: [
    '🏨 Staff stay in their own hotel even more: when a shift is empty, the builder now compares every fix and picks the gentlest one: fewest days changed, a day at another hotel counting far more than a change at home, no new one-person shifts, and never a third hotel if it can be helped. Before, it could move someone for a whole week to fill one night; now it borrows one person for that one night.',
  ] },
  { v: 211, items: [
    '⚡ Faster everywhere in the roster: the app was counting every roster day again and again (once per person, dozens of times per card). Now it counts once per screen. A person\'s card opens about 10 times faster, the vacation list about 30 times faster, and the builder, undo, rules and requests react about a third to half quicker.',
    '🧠 Ops Brain\'s background check (every 20 seconds) no longer re-reads the whole posted week each time, so the app stays smooth while it runs.',
  ] },
  { v: 210, items: [
    '🌴 Vacation balance: everyone earns vacation every day (30 days a year, 2.5 a month; change it in Rules or for one person on their card). AL, ALA and VAC days in the roster and leave added on their card come off it: days up to today are used, later ones are booked.',
    '👤 Each card shows the vacation days today, used, booked and what is left after. Type the balance from HR once and it counts on from there; without it, it counts from the day they joined.',
    '🧩 The builder has a 🌴 Vacation balance section with everyone, biggest first. Adding more leave than someone has asks you first, and Ops Brain warns when leave is booked over the balance or a balance gets big. Ask it "vacation balance of Sam".',
  ] },
  { v: 209, items: [
    '💛 When you post a week, the app tells you which wishes it grants (for example "Lina: a day off on Fri/Sat"). Ops Brain keeps the message for the day.',
    '📜 Team history: everything that happens to the team is now written down as it happens: weeks posted, wishes granted, PH days given, sick and leave, people joining and leaving, swaps, days at another hotel, meetings, public holidays and roster changes.',
    '👤 Each person\'s card has a 📜 History with their past, and how many weeks their wishes were granted. The builder has a 📜 Team history section with filters and a name search.',
  ] },
  { v: 208, items: [
    '🧘 Steady shifts: the builder keeps each person on the same shift all week as far as it can. A change of hours without a day off between now counts far more (more again if the start gets earlier), a second shift in the same week counts too, and a last pass trades days between colleagues so both keep one shift. Cover and the rules still come first; one person on a shift only when there is no other way.',
    '📅 A daytime meeting or training now steers that person\'s whole week toward day shifts (a night one toward nights), so they can be there without breaking their week.',
  ] },
  { v: 207, items: [
    '🎬 Building a roster now shows it being built: your team on a week grid, names flying into shifts, swaps being tried (⇅) and rest being checked (🔎). Then the real week comes in, day by day.',
    '✨ Smooth animations across the app: pages and cards slide in, buttons press, pop-ups and menus glide, health rings and charts fill. Everything stays still if your phone or PC is set to reduce motion.',
    '🟢 Roster → Today: each name has a small initials badge, and the "on shift now" green dot sits on it, pulsing, instead of being cut off.',
  ] },
  { v: 206, items: [
    '🔄 Public holidays update themselves every year: the app works out each year\'s UAE holidays on the device (New Year, Eid Al Fitr, Arafat Day, Eid Al Adha, Hijri New Year, Prophet\'s Birthday, National Day) from the Hijri calendar, no internet or key needed. In December next year\'s are already there.',
    '🎉 When a new year starts, Ops Brain tells you once that its holidays are in. As before, each one is asked about 3 weeks before (✓ Add, ✏️ Dates if the announced date differs, or Not a PH), with a link to check the announced dates.',
  ] },
  { v: 205, items: [
    '🔗 Home has new tiles: ⏰ wake-up calls today (red if one is late), 🧩 Roster builder (is next week built or posted, a holiday to answer, meetings today/tomorrow, who needs care) and 💲 our rates vs the market today.',
    '🔍 Search (Ctrl K) now finds team members (opens their card), meetings and training, wake-up calls, our hotels in the Rate Shop, and any page by its name. Whole-word matches first.',
    '🚪 Someone leaves: set "Left on" on their card and the app takes them off the posted days after it (the gaps show in Cover to fix) and offers to build the draft week again. Ops Brain warns if someone who left is still on a posted shift.',
    '📅 Meetings and training now show on the posted roster too (a small 📅 on that day).',
  ] },
  { v: 204, items: [
    '🌍 Purpose of Stay: load both nationality reports at once. In "Origin XML", pick Vicas and Arrival Today Vicas together (Ctrl or Shift + click), or drop both on the app: one question for both, and one message with what each file added.',
  ] },
  { v: 203, items: [
    '🔎 Rate Shop without AI or any subscription: 🔎 Search prices opens Booking.com with every hotel in Deira for that night (cheapest first), and a quick box here to type what you see: Enter jumps to the next hotel, then "Save · next night →" moves on to the next day in the same Booking tab.',
    '💲 The AI buttons only show if an AI key is ever added; nothing needs one.',
  ] },
  { v: 202, items: [
    '💲 Rate Shop has a new, cleaner design: one bar to switch hotels and dates, four clear numbers, a chart and a tidy price table, and a guided start when a hotel has no neighbours yet. Fixed: typing a price and pressing Enter.',
  ] },
  { v: 201, items: [
    '💲 New: Rate Shop (menu → Tools). Our hotels (Ibis Styles, Mercure and Adagio Dubai Deira; add, rename or remove any) next to the hotels around each one: our rate, the market (median, lowest–highest), the difference in %, our place (1 = cheapest), a chart of the next 14 days and the table of prices.',
    '✨ Check online fills the prices for a day or the next 7 days (AI web search with the key from Roster → AI settings; marked 🌐 so you can check them). ✨ Find hotels around us suggests the hotels to compare with. Every hotel has one-tap links to Booking.com, Google and Google Maps, and any price can be typed in.',
    '📊 All our hotels: the three side by side with their market, and "us vs market" for every day.',
  ] },
  { v: 200, items: [
    '🛎 Reception is never left empty (the bell team may be short): after every other way, the builder now also lets a day shift go next to a night without the day off between, and if a night is for Supervisors only and none is free, a front-desk colleague covers it. Each one is flagged ⚠ and written under Decisions this week.',
    '👥 A Duty Manager and a Supervisor are never put on the same shift together in the same hotel (one of them is enough). If it happens anyway (by hand), the week summary shows "DM + Supervisor together" in red.',
    '✨ Building a roster or reading a roster picture now shows a little animated week filling in, a message that changes as it works, and a moving bar.',
  ] },
  { v: 199, items: [
    '⚖️ Builder rules have a new look: 4 small cards (Rest & hours · Desk & cover · PH days · Hotels & managers), each rule with a short title and hint, − / + buttons for numbers and on/off switches.',
  ] },
  { v: 198, items: [
    '⚡ The roster builder is much smoother, especially on phones: 🔨 Build now works in the background (the screen no longer freezes for seconds; you can scroll while it builds), and tapping a cell, undo, rules and requests answer straight away.',
    '⚡ "Cover to fix" and the desk check fill in a moment after the table, one gap at a time; folded sections (Team, Rules, Cover needed) are drawn only when you open them; and a change you save is no longer drawn twice when it comes back from the database.',
  ] },
  { v: 197, items: [
    '🎉 Public holidays (Builder → ⚖️ Rules) has a new look: proper dropdowns, a "Coming up" list with a date tile and its status (✓ Added, Not a PH, or when I\'ll ask), the PH list grouped by holiday (Eid = one row) with ✕ to remove, and a neat add row.',
  ] },
  { v: 196, items: [
    '🏨 Moving staff between hotels is now the very last step: an empty shift is first fixed inside the hotel (a day off moved, two people trading), and only what is still empty borrows someone from another hotel.',
    '🏨 When someone has to move, it stays between one pair of hotels that week (one hotel helps one other), for the night cover too. A third hotel only when there is no other way, and the week summary shows it in red ("moves, 3 hotels"); otherwise it shows "nobody moved" or how many shifts were moved.',
  ] },
  { v: 195, items: [
    '⚡ Staff profiles are much lighter: a tap on a person\'s card (likes, shifts, titles) no longer redraws the whole roster builder behind it, and the card stays where you were instead of jumping to the top. The builder screen itself also draws faster.',
    '🏨 Staff stay in their own hotel as much as we can: the builder moves someone to another hotel only when a shift there would be empty (not just for the ideal second person), covers night days off from their own hotel first, and cover suggestions show options in their own hotel first.',
  ] },
  { v: 194, items: [
    '🏖 PH as the last option, now for 1 person a week per hotel: the builder gives a PH day to only one person each week in each hotel (whoever is owed the most), and only when a shift has someone spare anyway. Both numbers can be changed under ⚖️ Rules.',
  ] },
  { v: 193, items: [
    '🏖 A week normally has one day off (4 a month), so a PH day (a second day off that week) is now the last option: the builder gives at most 1 PH a week each, and only when a shift has someone spare anyway. You can change the number under ⚖️ Rules.',
  ] },
  { v: 192, items: [
    '👔 Fixed: the "one is enough for all the hotels" rule is for the main managers (Manager and Asst. Manager), not Duty Managers. The builder keeps at least one manager on duty every day across all hotels (two is fine) and doesn\'t give them the same day off. ⚖️ Rules shows who counts as a manager; set the title on their card in 🧑‍💼 Team.',
  ] },
  { v: 191, items: [
    '🎉 Public holidays for the UAE are built in. 3 weeks before each one the app asks you (in the builder and in Ops Brain): ✓ Add, ✏️ change the dates (Eid moves with the moon), or Not a PH. Nothing is added without your yes.',
    '🏖 Everyone on the team earns a PH day for each holiday you accept, also people who were off that day (new staff only from the day they joined). You can switch to "only who works that day" under ⚖️ Rules. A PH day comes off the balance once the roster with it is posted.',
    '📅 New: Meetings & training in the roster builder. Add one by hand, or from Outlook: a saved email (.msg or .eml), an invite (.ics), or paste the email text. It reads the subject, day, time, place and the team members named.',
    '📅 The builder keeps them in mind: no day off that day, and a shift that covers the time (or the whole day as TRN for an all-day course). It warns you when the roster doesn\'t fit, with a button to build the week again. Ops Brain reminds you the day before and an hour before.',
  ] },
  { v: 190, items: [
    '💚 Team health: every team member gets a health score out of 100 from the last 4 weeks of rosters, as a ring next to their name in 🧑‍💼 Team (green = thriving, amber = watch, red = needs care), with small icons for what needs a look.',
    '💚 On top of the team list: the whole team at a glance and "Look after first", the people who need care, one tap to their card.',
    '💚 On each person\'s card: 8 tiles (rest between shifts, days in a row, nights, weekends off, hours, days off, sick days, PH owed), compared with their hotel, plus "What would help".',
  ] },
  { v: 189, items: [
    '🏖 The roster builder clears PH balances: whoever is owed the most goes first, up to 2 PH days a week each, placed next to their day off where it can (a longer break), oldest PH first, and only when the shift still has enough people.',
    '🏖 New in the builder: "PH balance", person by person: what this week gives, what is still owed, and one-tap "PH on Thu" buttons for other days where a PH fits.',
    '🏖 A day-off request for someone with PH owed now shows a "→ PH" button: one tap turns it into a PH day from their balance.',
  ] },
  { v: 188, items: [
    '🧠 The roster builder learns from every posted week, whoever made it (built here, a picture, Excel, or a manager who made it themselves), up to the last 8 weeks that have a roster; weeks with none are skipped. It learns each person\'s usual shift, their usual days off, whether they take them together, and how they rotate week to week (mornings → evenings → …), and builds the same way. Anything set on someone\'s card comes first.',
    '📅 The builder opens on the week right after the latest posted roster, so you can pick up from any week you give it.',
    '🧠 New in the builder: "What I learned", person by person, and from which weeks.',
  ] },
  { v: 187, items: [
    '😴 Night → one day off → morning is avoided: that day off goes on sleep, so the builder gives a morning after a night only with two days off between, unless there\'s no other way (then it says so under Decisions this week). Cover suggestions put these last too.',
    '🛌 Under 7 hours of rest only after every other way: before that, the builder also tries a longer chain (A covers the gap, B covers A\'s shift, C covers B\'s).',
    '🛡 Safer builder: covering every shift always comes before wishes (a week left with an empty shift is tried again without wishes, and the better one wins); wishes for shifts a hotel doesn\'t have, more days off than someone gets, or "no nights" on a static night person can\'t confuse it; an empty rest setting can\'t make it slow. Tested with random wishes, sick staff and odd settings.',
  ] },
  { v: 186, items: [
    '⚖️ The builder is fair over time: every week it reads the last 4 posted weeks. Wishes that weren\'t granted lately count more this week (📈 first in line in Team happiness), so everyone gets their turn as the rotation moves. Whoever had more nights than the team lately gets fewer, and whoever had fewer weekends off gets one first. Static night staff aren\'t counted against anyone.',
  ] },
  { v: 185, items: [
    '🛌 Rest between shifts stays 11 hours. Only when a shift can\'t be covered any other way does the builder give up rest, and then one hour at a time (10 h, then 9 h, 8 h…), keeping as much as it can, and it tells you who and why. Builder → rules: "Only when there\'s no other way, down to [7] hours" sets the lowest it may go.',
  ] },
  { v: 184, items: [
    '💛 Wishes on a person\'s card are now small one-tap chips: ☀️ Mornings · 🌤 Day · 🌆 Evenings · 🌙 Nights · 🚫 No nights · 🌙 ≤ 2 nights · 🌅 No early start · 🌃 No late finish · 🏖 Weekends off · 📅 Days off together · ⏱ Same hours. Plus the days they\'d like off (Mo–Su) and a one-line note. Tap to turn on, tap again to turn off; only the options that fit their hotel\'s shifts appear.',
  ] },
  { v: 183, items: [
    '💛 Likes & wishes for every team member (open their card in 🧑‍💼 Team): shifts they like (tap a shift: 💛 likes → ⚠ prefer not → 🚫 can\'t → fine), the days they\'d like off (as many as they want), days off together, same hours all week, a limit on nights a week, and a note for anything else ("studying Tuesday evenings", "takes the 8:00 bus"). The builder tries to grant every wish, as long as every shift is still covered and the rest rules hold.',
    '😊 Team happiness in the builder: how many wishes this week grants ("14 of 16 wishes granted"), person by person with ✓ and ✗, the least happy first, and their notes. Not happy with it? 🔀 Try another way.',
  ] },
  { v: 182, items: [
    '🔁 Supervisors, managers and owners swap shifts straight away: Roster → 🔁 Swap shifts (or on My shifts). Pick the day and the two people, see both shifts and the rest check, tap Swap now. No asking and no approval, because most of the team doesn\'t use the app. Staff who do use it still ask, and you approve.',
    '🖼 The roster picture is easier to read: bigger writing, full day names, the weekend shaded, each hotel\'s bar with its staff count, alternate row shading, and a colour key at the bottom (Morning, Afternoon / evening, Night, Day off, Leave / sick, Public holiday).',
    '👤 "A picture for each person" (in the picture options): every staff member\'s own week as one big, simple picture, ready to send to them on WhatsApp.',
  ] },
  { v: 181, items: [
    '🔁 Shift swaps: on Roster → My shifts, tap 🔁 Ask to swap, pick the day and the colleague. You see both shifts and whether the rest rules still hold for both of you. They tap Agree on their phone (Ops Brain tells them), then a supervisor taps Approve and the posted roster changes, and both get the usual message.',
    '📷 My week picture: your next 7 days as one clean picture (shift colours, today marked), to keep or send to anyone.',
    '🏨 Second-choice hotel: on a person\'s card, "If moved, prefers" a hotel. When they have to work at another hotel, the builder and the cover suggestions try that one first.',
  ] },
  { v: 180, items: [
    '🎨 Six new themes, the best-loved colour themes in their own official colours: 🐱 Catppuccin (soft pastels on dark), 🥛 Latte (the light version), 🧊 Nord (arctic blue-grey), 🧛 Dracula (purple and pink), 🌃 Tokyo Night (city-lights blue) and 🌹 Rosé Pine (muted rose). Tap the theme button in the top bar, or More → themes on a phone. Your theme is only yours.',
  ] },
  { v: 179, items: [
    '🔕 Roster reminders are quiet now: no alarm sound, and nothing about a shift that has already started or a day gone by (nothing can change it any more; "Cover to fix" leaves those out too). An empty shift later today or tomorrow waits in Ops Brain (the 🧠 count) and pops up only once, when it starts within 3 hours. Closed with ✕, it stays closed.',
  ] },
  { v: 178, items: [
    '⏰ Wake-up Calls, redesigned: a summary on top (today, still to call, called, due now), the next call with a countdown, and a cleaner list. New: a backup call 5, 10 or 15 minutes later (booked by itself once the first is answered), "read back to the guest ✓", ✓ Answered / 📵 No answer / 🚶 Sent someone up / Cancelled by the guest, a warning when the room is already checked out or the call is set twice, search, and a log of who did what. Its icon now matches the rest of the menu.',
  ] },
  { v: 177, items: [
    '⏰ New page: Wake-up Calls (in the menu, and under More on a phone). Write the room and time (the guest\'s name fills in from today\'s reports), pick the day, add a note, or repeat it every day until a date. Several at once: "512 6:30, 610 7:15 tomorrow". At the time everyone on shift is alerted, again every 5 minutes until someone taps ✓ Called. 📵 No answer tries again in 5 minutes. Copy or print the list for the night. Ops Brain\'s "wake up 512 at 6:30" lands on the same list.',
    '✕ What\'s new has a close button at the top now, always visible while you scroll.',
  ] },
  { v: 176, items: [
    '🌐 Ops Brain searches online when the app can\'t answer: it looks the question up by itself and shows a short answer with its sources. With an AI key on the device (Roster → AI settings) it searches the whole web and answers in plain words; without one it uses Wikipedia. "🔎 Search Google" is always one tap away, and "search online …" or "google …" asks the web directly.',
  ] },
  { v: 175, items: [
    '🖱 On a computer, rows that scroll sideways (Ops Brain suggestions, tabs, filters, chips) now move with the mouse wheel, and you can drag them with the mouse. Everywhere in the app.',
    '🛏️ A room that isn\'t loaded today still works: ask Ops Brain "512" and it offers to add it to today\'s departures or as an arrival. "check out 512" on a room not on the board offers "Add room 512 and check it out" in one tap. Rooms added by hand stay on the board when you reload the report.',
    '💡 The app remembers every room number your hotel has had, so room suggestions include rooms not in today\'s reports.',
  ] },
  { v: 174, items: [
    '💡 Suggestions while you type, everywhere: every country in a nationality box, the usual booking sources, the whole email after you type "@g" (gmail.com, hotmail.com…), today\'s rooms and guests in the search boxes, the team in a name box, and the roster\'s own shifts and codes when you change a roster cell. Tap one to fill it in.',
    '⌚ Times fill themselves in: type 1245 and it becomes 12:45. A "full name in caps" box writes in capitals by itself. Room boxes open the number keypad.',
    '🧠 Ops Brain suggests room questions too: type a room number and pick "512 late", "room 512", "512 dnd"…',
  ] },
  { v: 173, items: [
    '🚪 Departures: "Reload" keeps everything tracked on each room (extension rate and reason, DND time, acknowledged late check-out).',
    '📅 Days are saved on Dubai time: the night audit after midnight no longer writes over the day before. No-show history is saved under the report\'s own date.',
    '🍳 Arrivals: cancelled and no-show rooms no longer count in F&B, a room with two meal codes counts once, and days sort properly across a month end.',
    '🧠 Guest Memory: names with a full stop ("John A. Smith") save properly, an edit isn\'t lost when another hotel saves at the same moment, and the list stays fast (500 rows, search for the rest).',
    '✅ Night Checklist doesn\'t offer a "new night" reset after midnight in the middle of a shift. Handover notes survive Refresh. A photo picked with a PDF still saves. Enrolment results don\'t wipe colleagues\' rows. Guest and staff names are shown safely everywhere.',
  ] },
  { v: 172, items: [
    '🗓️ Roster fixes: Undo takes back only your own change (not a colleague\'s since), notes two people add at once are both kept, and every way of changing a week (what-if, sick, cover, plans) now saves cell by cell. "Put X on mornings" on a posted week no longer stops halfway.',
    '📷 Roster pictures: someone matched to the team is saved under their own record (no duplicate person), three rows with the same name stay separate, a new joiner with an employee number is never dropped, Escape cancels a cell edit, and giving a second picture while one is being read no longer mixes them up.',
    '🛡 Names with unusual characters can no longer break buttons or run anything.',
  ] },
  { v: 171, items: [
    '🔒 Safer sign-in: an account nobody added to the team no longer gets access, and each role can only open its own pages (also through Ops Brain and the home tiles). A read-only account can\'t change departures.',
    '🎨 Your theme is your own: changing it no longer changes everyone else\'s screen.',
    '🔄 "HotelOps was updated" is now a button that stays until you tap it. Signing out starts the app fresh, so the next person doesn\'t get double updates. Offline, signing in no longer hangs.',
  ] },
  { v: 170, items: [
    '👥 Two people can work on the same roster draft at once: each change saves only the cells it touched, so nobody\'s edits are wiped by someone else\'s save (only the very same cell: the last change wins).',
    '📷 Roster photos: names are matched to your team using the name and the employee number together, so a blurry "Charlene Ponda" is still Charlene Pineda. Everyone gets their own hotel even when the hotel bar can\'t be read, and junk rows (a title bar read as a person) are left out.',
  ] },
  { v: 169, items: [
    '📷 Roster photos read better: a photo taken a little tilted or at an angle is straightened first, then read. Blurry or small photos get a second try at each cell, and anything it isn\'t sure of is marked to check (never silently guessed). A screenshot still reads best; for a photo, hold the phone straight above the roster in good light.',
  ] },
  { v: 168, items: [
    '⚠ "Prefer not" a shift: on someone\'s card tap a shift once for ⚠ prefer not (they\'re kept off it unless it\'s the only way to cover), twice for 🚫 can\'t work. Also a request for one week ("Prefer not a shift"), or tell Ops Brain "Lina prefers not nights" / "Lina can do nights again". When it has to be used, it\'s listed under Decisions this week.',
    '🖼 The roster picture options look like the rest of the app.',
  ] },
  { v: 167, items: [
    '🗓️ Roster page: no more empty space. "My shifts" is one row on a computer (on shift now, then your next 7 days) and "Today" runs full width under it, with a wider timeline.',
  ] },
  { v: 166, items: [
    '🛌 A day shift and a night always have a day off between them: nobody on 08:00 - 17:00 or 12:00 - 21:00 goes onto 00:00 - 09:00 or 19:00 - 04:00 the next day, or the other way. This is never bent, even when stuck.',
    '✅ Every shift gets covered: the builder uses your rules first. Only when there is no other way does it use what past rosters did, mildest first: an evening (15:00 - 00:00) next to a night without a day off, rest down to 7 hours, an evening straight into a night. Never more than 9 hours a shift. Each time it says so ("needed a rule bent") and writes who, what and why under Decisions this week.',
  ] },
  { v: 165, items: [
    '🌙 Nights are planned across all hotels first: every hotel gets a Supervisor or above every night. The regular night person\'s day off at each hotel is lined up next to the others, and one Supervisor or Duty Manager covers those nights as one block, with their day off right next to it, so nobody goes from night to day without a day off. With 3 Duty Managers and 2 Supervisors, every night is covered with no rule bent.',
    '🏨 People stay in their own hotel by preference: a hotel\'s own Supervisor covers its own night first, and someone moves hotel only when nobody there could; a Duty Manager is used before a Supervisor. The plan is written under Decisions this week ("Nights: Charlene covers… Sun at Mercure DD… only because nobody there could").',
  ] },
  { v: 164, items: [
    '🌙 The roster builder now fills empty shifts itself when a fix keeps every rule: another hotel\'s Duty Manager or Supervisor, a day off moved, or two people trading ("Charlene does the Mercure night, Irene takes her 09:00 - 18:00"). Every move is listed under Decisions this week. Fixes that would bend a rule are still only suggested, never made for you.',
    '🔄 Updates arrive properly: the app always fetches the new version fresh, checks for one whenever you come back to it, and loads it (right away if you just opened the app, otherwise "tap to load the new version" so nothing you\'re doing is lost).',
  ] },
  { v: 163, items: [
    '📱 New themes: iPhone (Apple\'s system font, soft grey background, white rounded cards, blue, glass top and bottom bars, large titles), iPhone Dark (true black), Titanium (warm graphite with the Pro titanium finish) and Ocean (deep blue and teal). Tap the theme button in the top bar, or Settings → Appearance; on a phone, More at the bottom.',
    '⚡ Faster: the first screen shows about a third sooner. The Excel and PDF readers and the fonts now load in the background instead of holding up the start, and pages open with a shorter, lighter animation.',
    '🧠 Ops Brain calls the roster builder "Roster builder", not "roster-build".',
  ] },
  { v: 162, items: [
    '🌙 When nobody can take a shift with every rule kept, the builder now shows the closest real fix instead of only "bring in a staff member", e.g. "Put Charlene on 00:00 - 09:00; then Irene from Mercure takes her 09:00 - 18:00 ⚠ no day off between night and day". It bends only the night ↔ day rule, only when there is no other way; rest (11 h) and 9-hour shifts are always kept.',
    '📝 Decisions this week: when you use a plan like that, HotelOps tells you exactly what it did and why, and keeps it under the draft ("Charlene covers the Tue night with no day off between night and day: nobody else could…"), with everyone working at another hotel listed too. The rule break it caused is marked "bent on purpose".',
    '🧑‍💼 Duty Managers can work anywhere (any hotel, any shift), even when everyone else stays at their own hotel. Supervisors can too, but only when nobody else can.',
    '🛎️ Bell boys: a day without one is fine. Their day off, sickness or vacation is never listed as cover to fix, and What if… needs no cover for them.',
  ] },
  { v: 161, items: [
    '🖼 Roster picture options: before you download or share, choose to show or hide the heading (and change its words), show job titles next to names (Manager, Supervisor…), and show or hide employee numbers, with a live preview. Your choice is kept and used for the picture posted with the roster.',
    '⚡ No more lag when you change titles or anything on the team: the "same people, more overlap" check (which builds the week several times) now only runs when you tap "Check", instead of in the background after every change.',
  ] },
  { v: 160, items: [
    '🧹 Roster builder tidied: the setup sections (requests, cover, team, rules) stack in one column with no empty gaps, the team shows as a neat grid, and the "two on the desk" setting sits on one line. Desk hours can run past midnight (8 to 2 = 08:00 – 02:00).',
    '🛡️ Ops Brain is careful with names: "Mr Ahmed is sick", "the guest in 512…", "breakfast starts at 6:30" or "swap room 512 and 514" are never taken as roster commands, and a name must match a whole word ("Khalid" is not Ali).',
    '🛠 Fixes: PH days are never given on a day already fixed (or gone by); hotels whose names start with the same word are told apart when lending; a renamed person stays one person when a week is published; people with no hotel set are still rostered; edits made just before changing week are saved to the right week.',
  ] },
  { v: 159, items: [
    '📱 On phones, rows of buttons at the top of a page fade at the edge when there are more to swipe to, and the Roster page shows all its buttons (What if, Picture, Alerts were hidden off the side).',
    '🗓️ Roster page: "My shifts" no longer stretches into a tall empty box next to Today.',
  ] },
  { v: 158, items: [
    '📥 Give this week\'s roster: in the roster builder, tap it and choose the roster picture (or Excel). HotelOps reads it, you check it and press Save, and it goes straight on to build the next week from it.',
    '📋 Same as last week: builds the week by carrying last week on (same days off and shifts where they still fit), changed only for this week\'s requests, leave and the rules.',
    '＋ New staff: a proper form for someone joining (name, hotel, title, start date, days off, shift). Or tell Ops Brain "add new staff Maria Santos to Ibis as agent from Monday". They\'re on the roster from their start date.',
    '🖼 Download picture is now one tap at the top of the builder, for the draft or the posted week.',
  ] },
  { v: 157, items: [
    '📋 Package Audit: tap any confirmation number to copy it (it shows a ✓). Tapping it no longer opens or closes the row, and you can still select the text.',
  ] },
  { v: 155, items: [
    '🔒 Managers keep their own shift (e.g. 09:00 - 18:00) to run the operation: the builder never moves them and they are never suggested to cover. Lock or unlock anyone on their card ("🔒 Keeps 09:00 - 18:00"), or tell Ops Brain "keep Sam on his shift".',
    '🏨 Lock someone to their hotel (card: "Stays at Adagio GD", or "lock Sam in his hotel"), or everyone at once: ⚖️ Rules → "Keep everyone in their own hotel" (or tell Ops Brain "keep everyone in their own hotel"). Nobody is then moved between hotels, by the builder or in suggestions.',
    '🛎️ Bell boys: title "Bell Boy" (or tell Ops Brain "Sam and Lina are bell boys"). They get their own bell shifts, days off and cover ("Adagio GD · Bell"), never count as front desk and are never suggested for desk gaps.',
    '⌨️ Ops Brain autocomplete: start typing and finished questions appear, with the team\'s names filled in ("what if ah…" → "what if Ahmed is sick tomorrow"). Tab to fill, Enter or tap to ask; your recent questions come first.',
    '🤔 What if… finds more full-cover plans: one move may open a gap the next move fills.',
  ] },
  { v: 152, items: [
    '🤔 What if…: ask before you change anything: "what if Ahmed is sick tomorrow", "takes Thursday off", "is on leave next week", "isn\'t on 12-21 on Friday". Roster → 🤔 What if…, the builder, or Ops Brain.',
    '🤔 You see what would be short, then whole plans that fill every gap under your rules (rest, night ↔ day, who can work nights, 9 h, days off), fewest changes first: % covered, rules kept, one-person shifts, who else changes. If nothing reaches 100% with this team, it says so and shows the closest. Leave, PH and days gone by are never moved; "Use this" changes the roster and tells only the people affected.',
  ] },
  { v: 151, items: [
    '🕐 Two on the desk: the builder now counts people on the desk hour by hour, so 08–17 and 12–21 overlapping from 12:00 to 17:00 counts as two at once. It aims for 2 at the same time from 08:00 to 23:00 (set the number and hours in ⚖️ Rules) and never at the cost of cover or the rules.',
    '🕐 New "On the desk, hour by hour" grid under the draft: how many are on each hour of each day (hover or long-press for names), with the hours someone is alone in amber and a summary like "Alone at the desk: 21–23 every day". Tap an amber hour for who can come in on an overlapping shift; "2 on desk" in the summary row shows the share of hours with two at once.',
    '💡 Same people, more overlap: when moving one place in the cover table (e.g. from 12–21 to 15–00) leaves fewer hours with someone alone, the builder says so. It tries the week with your team first and only suggests it if every shift and rule still holds.',
  ] },
  { v: 150, items: [
    '🧭 Roster builder, cleaner: a 4-step guide at the top (Requests → Build → Check → Publish) shows where the week is, and the setup sections fold away so the draft is what you see.',
    '📈 The draft at a glance: places filled, rules kept, one-person shifts and hours changes in one row; a Week column with days and hours for each person; tap Morning, Afternoon, Night, Off, Leave or ↻ Changes to highlight them in the table. Ctrl+Z undoes on a computer.',
    '📊 New Fairness view under the draft: nights, weekend days off and hours a week for everyone over the last 4 weeks, with anyone well out of line in amber.',
    '🛠 Fixed: the cover table (has / needs) showed every day stacked in one column on phones.',
  ] },
  { v: 149, items: [
    '🎯 Put someone on a shift type: in the roster builder, "🎯 Put someone on…" → pick a person (or two, "this one or that one"), Morning, Day (morning + 12:00), Evening or Night, and the days. It builds the week each way, changing as little as possible, and shows the options best first: covered or not, who else changes, and any hours changing mid-run. Tap one to use it, in the draft or in the posted week (only the people affected are told).',
    '🧠 Or tell Ops Brain: "put Sam on mornings next week", "put Sam or Lina on day shifts this week", "Lina evening next week". The choice is kept as a request, so building the week again keeps it.',
  ] },
  { v: 148, items: [
    '↻ Steadier hours: the builder keeps each person on the same shift through a run of working days and changes hours only after a day off; never earlier hours than the day before (afternoon → morning) unless there\'s no other way. A week built for the current team has 0–1 such changes instead of 3–5.',
    '↻ Any change of hours left in a run is marked in the draft and listed ("Hours change mid-run: Lina Wed 08:00→12:00"), and cover suggestions put "same hours" people first and flag "⚠ hours change" on the rest.',
  ] },
  { v: 147, items: [
    '🙋 Short shift? The builder now says who you can put there and why they\'re OK: "Put Sam on 08:00 - 17:00, their day off moves to Thu · OK: off the day before, 15 h rest after, 9 h shift". It also finds bigger fixes a manager would do: two days changed together, or a night block ("19:00 - 04:00 from Thu to Sun").',
    '🔎 "Why not the others" lists every colleague who can\'t take it and the reason: on SL, only 7 h rest, night ↔ day without a day off, nights are for Supervisors only, it would leave their own shift empty. Tap any number in the cover table to see who can take that shift that day.',
  ] },
  { v: 146, items: [
    '🌙 New rules in the roster builder: a day off between night and day shifts (nobody goes from a night to 08:00 the next day, or the other way), and the 00:00 – 09:00 night only for Supervisors and Duty Managers. Change who can work any shift in 👥 Cover needed.',
    '🧑‍💼 People can be set to 🌙 nights only or ☀️ days only on their card; new title: Duty Manager.',
    '🖼 Roster → Picture: download or send any posted week as a picture, in the usual roster style. 📥 Team file: load the whole team (names, numbers, hotels, titles) and a roster in one go.',
  ] },
  { v: 145, items: [
    '🧑‍💼 Team in the roster builder: titles (Manager, Supervisor, Team Leader, Agent…), each person static on a shift, rotating week to week, or any shift; can\'t-work shifts; sick and leave dates; joined and left dates; add and delete staff; and their history (what they worked the last weeks).',
    '🤒 Someone sick or on leave mid-week: Roster → Sick / leave (or tell Ops Brain "Omar is sick tomorrow"). It goes straight into the posted roster and you get the ways to cover: a day off moved, a move from a shift with spare, borrowing from another hotel, a manager as the last resort, or "bring in a staff member". One tap applies it; only the people whose shifts changed are told.',
    '✏️ Edit the posted week any time; drag a cell onto another to swap; 🔁 swap suggestions that keep everyone\'s rest; ↶ undo. Cover is the ideal (keep 2) with one-person shifts only when there\'s no other way. Shifts over 9 hours are refused. Change a shift\'s hours (bus times) in one place.',
    '🧠 Ops Brain: "Ali wants Friday off", "swap Sam and Lina on Tue", "who can cover nights on Wed", "roster problems", "Lina last week"; and on Saturday and Sunday it reminds you to post next week\'s roster. ⏰ Shift Tasks now follow the roster\'s hours (night from 00:00, morning from 08:00…).',
  ] },
  { v: 144, items: [
    '🛠 Roster builder: Roster → Build roster makes next week\'s roster for you. Add the requests (day off, AL / ALA / SL, PH, must or can\'t work a shift), press Build, check it, publish. It learns the shifts, the cover each hotel needs and everyone\'s usual pattern (the night auditor stays on nights) from your past rosters.',
    '⚖️ It keeps the rules: one OFF a week, at least 11 hours\' rest between shifts (no 15:00–00:00 then 08:00), a cap on days in a row, leave and requests first. If a shift can\'t be covered it shows the gap instead of breaking a rule. Short hotels borrow from the others ("12:00 - 21:00 - Adagio"); PH days owed are given when there is spare cover.',
    '📋 Tap any cell to change it; the cover table and problems update as you go. Publish tells the whole team, and 🖼 Picture to share makes a roster picture in the usual style for WhatsApp.',
  ] },
  { v: 143, items: [
    '📷 Roster pictures are now read on your phone or PC, free, with no AI and no key: it finds the table\'s lines and reads every cell (hours digits-only, so 09 is never 08), the hotel titles, the dates and the names. Your roster read 133 of 133 cells right in about 15 seconds.',
    '🛡️ It checks itself: a shift one digit away from the usual ones, an odd shift length or a code it doesn\'t know is marked red. Tap a cell to correct it. From the second week names are matched to the team by employee number, even when the picture is blurry.',
    '🕑 Understands 7-3, 3-11, 11-7 and 9-6 style hours too. AI reading is still there as an option for hard pictures.',
  ] },
  { v: 142, items: [
    '📷 Roster from a picture: Add roster → choose the roster image management sent (or drop or paste it). Claude, Anthropic\'s AI, reads the whole table even when the layout changes: hotels, names, dates and every shift. Check it against the picture, fix anything marked in red, and save. Needs AI reading set up once on the device that posts the roster.',
    '🔎 Words nobody understands: the roster\'s unknown codes are listed with the most likely meaning; confirm or correct it once and it is remembered for every roster after.',
    '🕘 Today is now a timeline of everyone\'s hours, with a red line at the time now and a green dot for who is on shift. 📷 Original picture opens what management sent.',
    '🔔 New roster posted: everyone sees NEW on Roster (and the new 🗓 button in the top bar), a message and an Ops Brain note. Turn on 🔔 Alerts on the Roster page for a phone or desktop notification.',
  ] },
  { v: 141, items: [
    '🗓️ Roster reads the cluster roster as it comes: the hotel sections (each hotel gets its own filter, and you see your own hotel first), employee numbers in front of names, hours like 00:00 - 09:00 or 19:00-04:00, ALA / SL / PH, and notes like "12:00 - 21:00 - Adagio".',
    '🌙 Night shifts are understood: 00:00–09:00 on the 6th is the night of the 5th. "Today" shows who is on shift right now (green dot), Home says "On shift now, until 09:00", and Ops Brain answers "who is on now" and "who is on tonight" correctly, even after midnight.',
  ] },
  { v: 140, items: [
    '🗓️ New: Roster. Add the team\'s roster once (paste it from Excel or upload the .xlsx) and everyone sees it on any phone: My shifts (your next shift and the next 7 days), who is on today, and the full week. Weekly, two-week or monthly rosters all work; each paste only replaces its own days.',
    '🗓️ Understands M, A, N, OFF, AL, SL, PH and hours like 07-15 by itself; add your hotel\'s own codes under Shift codes and times. Supervisors can edit any day, and Edit → Copy last week starts a new week.',
    '🏠 Home shows your next shift. Ask Ops Brain "my shifts", "who is on tonight" or "who is working tomorrow".',
  ] },
  { v: 139, items: [
    '🎨 Design check of every page on phone and desktop: Guest Memory now has the same header as the other pages; "Choose file" buttons match the app instead of the browser\'s grey ones; History filters are readable (no more "Ev" / "La"); Shift Tasks give the task name more room; the button row under each page title scrolls edge to edge instead of sticking out; search boxes and upload rows stay inside their cards, even with Extra large text.',
  ] },
  { v: 138, items: [
    '📱 Settings on the phone: choice buttons such as "Sign out when idle" and "Text size" now fit inside the card and wrap to a second line when needed, even with large text.',
  ] },
  { v: 137, items: [
    '🧠 Ops Brain works with you like a colleague: "plan my shift" (your jobs in order with live status, and it greets each new shift once with the plan), "remind me at 03:00 to call 512" or "in 20 min", "wake up 512 at 6:30" (everyone on shift is alerted), "note 512 wants a late check-out at 2pm" (shared notes) and "write the handover" (drafted from the shift, notes and what is still open).',
    '🎓 It knows the front office: check-in and check-out, pre-authorisations, OTA virtual cards, declined cards, wrong charges, no-shows, walking a guest, complaints, VIPs, privacy, keys, lost and found, emergencies, Opera tips and night audit. Ask in plain words; your hotel\'s SOP always wins.',
    '🙊 A suggestion you have acted on rests for 30 minutes instead of popping up again.',
  ] },
  { v: 136, items: [
    '📱 Tables on the phone: when you swipe sideways, the pinned room column stays solid, so room numbers no longer float over the guest names. On Purpose of Stay the Room column is the one that stays pinned (not the day), and the header lines up too. Fixed on every table that pins a column.',
  ] },
  { v: 135, items: [
    '🎯 Ops Brain takes you to the exact line: tapping a suggestion, a bubble\'s Show me, a search hit or a line in a data answer opens the page, clears filters that would hide it, scrolls to the row or card and highlights it (and puts the cursor in the empty box). When several lines have the problem, a bar at the bottom steps through them: 1 of 3 ▲ ▼.',
  ] },
  { v: 134, items: [
    '🌍 Nationality report: the sheet always keeps its 240 rows. A country Opera spells differently goes into one of those rows: the closest rows are offered first with their row number, or pick from all 240, or count it as unknown nationality. Your choice is remembered for the team. Adding new rows is gone, and any rows added before were removed.',
  ] },
  { v: 133, items: [
    '🌍 Nationality report: a country you add now goes to its place in the sheet, alphabetically like the government sheet, not at the bottom. It shows the exact Excel row to insert (e.g. "row 211, under South Sudan, above Spain"), and you can move it under another country if your sheet differs. Copy for Excel pastes straight in, and the row counts update to match.',
  ] },
  { v: 132, items: [
    '🎓 Learn HotelOps: a guide for anyone new (menu → System → Learn HotelOps, or the card on Home). Start here (6 basics), your shift step by step (morning, afternoon, night), and a short lesson for every page: what it is for, which Opera report it needs, the steps and tips.',
    '👉 "Show me" opens the page and points at the exact place. Tick "I\'ve learned this" to track your progress; owners and managers see the whole team\'s progress. 🖨 Print guide makes a handout for a new colleague. Ops Brain answers from the guide too.',
  ] },
  { v: 131, items: [
    '🌍 Nationality report: a country Opera sends that your Excel has no row for is fixed in one tap. ➕ Add as new row puts it at the bottom of the report and tells you which Excel row to type it in (once). Or put it into an existing row: the closest matches are first, and there is a list of every row. Both are remembered for your hotel, so next month it is placed by itself.',
  ] },
  { v: 130, items: [
    '🧠 Guest Memory saves by itself: whatever you load, import or edit on Arrivals and Purpose of Stay goes into Guest Memory 2 minutes after your last change. Clearing a page always saves its guests first, so the daily clear never loses anyone.',
    '⏰ Shift tasks start fresh by themselves: each new morning (07:00), afternoon (15:00) and night (23:00) shift begins with nothing ticked, once for the whole team. The shift that just ended keeps its ticks for handover. Turn it off in ⚙️ Settings → Helpers.',
  ] },
  { v: 129, items: [
    '📧 After Import Emails, the guests go into Guest Memory by themselves: HotelOps waits 2 minutes so you can fix a wrong email, then saves. Tap 🧠 Save to Memory to save right away. Leaving the page or the app before then saves straight away, so nothing is lost.',
  ] },
  { v: 128, items: [
    '🧠 Guest Memory is now shared by all hotels: a returning guest seen at any of your hotels has their nationality, email and purpose filled in at the others. Each hotel\'s existing memory was merged in, nothing lost. Everything else stays separate per hotel, and each hotel keeps its own Guest Memory password.',
    '🔒 Clearing all of Guest Memory now empties it for every hotel, so only an owner can do it, after typing CLEAR.',
  ] },
  { v: 127, items: [
    '🧠 Ops Brain reads your data: ask "how many arrivals from France", "who has no email", "french guests", "guests staying more than 5 nights", "nationality breakdown", "arrivals by source", "average nights", "rooms that owe money", "who checked out". Each answer has the list and a Copy for Excel button.',
    '🧠 It understands typos ("arivals without natonality"), remembers the room you just asked about ("room 513" then "check it out" or "what about 512?"), and does several jobs in one line ("guess nationalities then remove duplicates and brief me").',
    '🧠 It notices more: Booking/Expedia relay emails, emails that can\'t be right, a nationality that doesn\'t fit the name, the same guest in two rooms, stays longer than the TD cap, and checked-out rooms that still owe money.',
    '🏨 Ops Brain\'s memory (habits, 👍/👎, turned-off suggestions) now stays with each hotel, so hotels never mix.',
  ] },
  { v: 126, items: [
    '🏨 More than one hotel: each hotel has its own separate space. People you add in Team management work in your hotel, and the app opens their hotel when they sign in.',
    '➕ Owners can add a new hotel in ⚙️ Settings → Hotel: its name, TD code and rate, and its owner\'s login. That owner then adds their own team. Nothing is shared between the hotels.',
    '📱 Phone: upload boxes stack instead of squeezing side by side (Package Audit, TD Audit), checklist notes use the full width, and page descriptions no longer run off the screen.',
  ] },
  { v: 125, items: [
    '📱 Phone polish: the top bar fits the screen (your role icon only, version moved to Settings), header buttons show their names in one swipeable row, Clear is a quiet outline button instead of a red box, and cards have inner spacing so buttons no longer touch the edges.',
  ] },
  { v: 124, items: [
    '⚙️ Settings, now complete:',
    '• Appearance: accent colour (gold, blue, green, teal, rose, purple), corners (rounded, soft, sharp), font, high contrast.',
    '• Top bar: show or hide the clock, connection, version, theme dots and your name. Date & time: 24 or 12-hour clock, seconds, greeting by name.',
    '• Alerts: late check-out alerts, a chime and desktop notifications for urgent things, phone vibration.',
    '• Departures: default card size. Privacy: a privacy screen that blurs guest names and emails until you point at them, and sign out after 15 min to 4 h without activity.',
    '• Sync: your settings follow you to every device you sign in on. Export or import settings as a file, storage meter, technical details and error log.',
  ] },
  { v: 123, items: [
    '📋 Purpose of Stay and Arrivals are a table again on every screen, restyled: the header stays on top while you scroll, rows are shaded in turns, the room number stands out, and boxes only show a border when you touch them. On a phone, swipe the table sideways.',
  ] },
  { v: 122, items: [
    '📋 Phone: Purpose of Stay and Arrivals are a plain list again. One thin line per guest under a Room · Guest · Missing · Purpose header, with small icons for a missing email, nationality or origin. Tap B / L / F to change purpose, or tap the line to edit.',
  ] },
  { v: 121, items: [
    '⚙️ Settings page (gear in the top bar, or More → Settings): theme, text size, compact mode, icons-only menu, animations; show or hide any page; choose the page HotelOps opens on; pick the Home tiles; switch Ops Brain, its bubbles and autopilot on or off; turn helpers off; hotel name and Tourism Dirham settings; backup, restore, health check and reset. Search settings by typing.',
  ] },
  { v: 120, items: [
    '🏨 The name is written as one word: HotelOps.',
  ] },
  { v: 119, items: [
    '🏨 The app is now called HotelOps, with its own logo and app icon. Your hotel\'s name shows under it; tap it to change.',
    '✨ New look: cleaner fonts, line icons in the menus, a search box in the top bar (Ctrl K), sharper cards, buttons and numbers, and a new sign-in screen. The three themes are still there.',
    '📲 On phones, add it to the home screen again to get the new icon.',
  ] },
  { v: 118, items: [
    '🤖 Ops Brain is now your agent: tell it what to do in 🧠, e.g. "fix everything", "brief me", "check out 512", "512 late", "who owes", "late checkouts", "guess nationalities", "remove duplicates", "copy arrivals to purpose", "set TD rate to 15", "month end report", "history 512". Type "what can you do" for the full list.',
    '🌍 The Nationality report fixes itself: a country spelling it doesn\'t know (Phillipines, Kazakstan…) is mapped to the right row and the report runs again. If it isn\'t sure, it asks with the 3 closest rows and remembers your answer for the team. Türkiye, KSA, Holland, UK and other modern names are known now.',
    '🤖 Autopilot (switch at the top of 🧠): it fixes safe things by itself (duplicates, nationality guesses, country names, copying arrivals to Purpose) and tells you, with Undo.',
  ] },
  { v: 117, items: [
    '🧠 Ops Brain is awake: it watches the app all the time and speaks up in a bubble next to 🧠, with a button that does the job (guess nationalities, remove duplicate arrivals, copy arrivals to Purpose, update the app…). Then it tells you what it did.',
    '📚 It learns from your corrections: type a nationality once and it guesses that surname right next time, for the whole team.',
    '🙊 "Don\'t suggest this" turns an idea off; ideas you use come first.',
    '🩹 Self-healing: if a page breaks, it rebuilds the page straight away and keeps the details ready to send to the developer.',
  ] },
  { v: 116, items: [
    '🧠 Ops Brain (bottom-right button, Ctrl+J): suggests what to do next from what is loaded and from your own routine, answers questions (room 512, how do I post TD…), and learns. 👍 / 👎 an answer, or teach it a new one for the whole team.',
    '🩺 Health check inside Ops Brain: finds a waiting update, damaged saved data and page errors, and repairs them with one tap.',
    '🛠 Fix requests: write what is wrong or what you want changed (or type "fix: …"). Send it on GitHub and the developer fixes the code.',
    '📱 Phone: Purpose of Stay and Arrivals are a compact list, one line per guest showing what is missing. Tap the B / L / F button to change purpose, tap the line to edit.',
  ] },
  { v: 115, items: [
    '📱 Phone: Arrivals shows one card per guest (big fields, one-tap Business / Leisure / Flight). Empty email or nationality is outlined.',
    '📱 Phone: the DTCM gap summary fits the screen. The explanation sits under each line.',
    '📲 Add to home screen: phones get a one-time prompt to install the app (iPhone shows the two taps). It is also under More → Install app.',
  ] },
  { v: 114, items: [
    '✨ This window: after every update the app tells you what changed.',
    '🕘 History page: who did what and when, for the whole team. Search by name, room or page.',
  ] },
  { v: 113, items: [
    '📥 Drop any report anywhere: drag a DTCM XML, Opera journal, nationality or rent report, or a PDF onto the app. It opens the right page and loads the file. If it can\'t tell, it asks.',
  ] },
  { v: 112, items: [
    '🗂 DTCM month-end report: totals, every correction and where to make it, with signature lines. Print or save as PDF.',
    '💰 Package commission report per seller (PDF or Excel), with pinned decisions and the deny list.',
  ] },
  { v: 111, items: [
    '🏠 Home page: one screen with what is still open on every page. Tap a tile to go there.',
  ] },
  { v: 110, items: [
    '🧪 Automatic checks: every update is tested against real (anonymised) DTCM and Opera reports before it goes live.',
  ] },
  { v: 109, items: [
    '🎁 Package Audit: a package billed night by night shows as one line per confirmation. Tap it to see the nights.',
    '✍️ Manual sale pin for packages added by hand in IN-Gauge (e.g. 6 pm late checkout).',
    '📌 Pin a package to its real seller, or skip it. Saved for the whole team.',
  ] },
  { v: 104, items: [
    '⚙️ Hotel TD settings: set your Opera TD code, the rate (7 / 10 / 15 / 20 AED), night cap and audit time.',
    '📱 Phone: faster menu, page search in More, cards instead of wide tables.',
  ] },
];

const WN_KEY = 'whats_new_seen_v1';
const _wnNum = v => parseInt(String(v || '').replace(/\D/g, ''), 10) || 0;

function wnEntriesSince(seen) {
  return WHATS_NEW.filter(e => e.v > seen);
}

function wnOpen(all) {
  let seen = 0;
  try { seen = _wnNum(localStorage.getItem(WN_KEY)); } catch (_) {}
  const list = all ? WHATS_NEW : wnEntriesSince(seen);
  if (!list.length) return false;
  document.getElementById('wnModal')?.remove();
  const m = document.createElement('div');
  m.id = 'wnModal';
  m.className = 'fr-overlay';
  m.innerHTML = `
    <div class="fr-sheet wn-sheet" role="dialog" aria-modal="true" aria-label="What's new">
      <div class="wn-top"><div class="fr-h">✨ What's new</div><button class="wn-x" type="button" aria-label="Close" title="Close">✕</button></div>
      <div class="fr-file">You are on ${escapeHtml(APP_VERSION)}</div>
      ${list.map(e => `<div class="wn-ver">v${e.v}</div><ul class="wn-list">${e.items.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`).join('')}
      ${all ? '' : '<button class="btn ghost wn-all" style="width:100%;margin-bottom:6px;">Show older updates</button>'}
      <button class="btn gold fr-cancel">Got it</button>
    </div>`;
  m.addEventListener('click', e => {
    if (e.target.closest('.wn-all')) { wnOpen(true); return; }
    if (e.target === m || e.target.closest('.fr-cancel') || e.target.closest('.wn-x')) m.remove();
  });
  const back = document.activeElement;
  const esc = e => { if (e.key === 'Escape' && document.getElementById('wnModal') === m) { m.remove(); } };
  document.addEventListener('keydown', esc);
  new MutationObserver((_, o) => { if (!m.isConnected) { document.removeEventListener('keydown', esc); o.disconnect(); if (back && back.focus) try { back.focus(); } catch (_) {} } }).observe(document.body, { childList: true });
  document.body.appendChild(m);
  m.querySelector('.fr-cancel')?.focus();
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
