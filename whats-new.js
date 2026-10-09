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
    '⚠ "Prefer not" a shift: on someone\'s card tap a shift once for ⚠ prefer not (they\'re kept off it unless it\'s the only way to cover), twice for 🚫 can\'t work. Also a request for one week ("Prefer not a shift"), or tell Ops Brain "Manisha prefers not nights" / "Manisha can do nights again". When it has to be used, it\'s listed under Decisions this week.',
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
