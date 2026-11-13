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
  { v: 579, items: [
    { ico: '🏨', title: 'Mercure Neorcha collection restored',
      what: 'Mercure now uses its new Tweak portal. A saved short name such as Mercure resolves to the portal property only when there is one matching hotel; full property names still match exactly.',
      does: 'The collector confirms the selected hotel before reading and lists the available names if a choice is ambiguous. Existing Mercure links move from the retired page to Tweak; other hotel legacy links and separate account credentials are preserved.' }
  ] },
  { v: 578, items: [
    { ico: '🔎', title: 'Explain the monthly revenue difference',
      what: 'Monthly totals now explains the gap by product, business date and confirmation, with Opera transaction IDs, IN-Gauge record IDs, amounts and pending requests shown separately.',
      does: 'Add Reservation Detail to match Opera postings to a unique guest, room and stay. Ambiguous matches stay unresolved. Download the full evidence breakdown; seller changes alone do not change revenue totals, and this comparison never submits financial changes.' }
  ] },
  { v: 577, items: [
    { ico: '🌍', title: 'Enrolment country matching and clearer results',
      what: 'Türkiye now matches Turkey, alongside verified alternate country names. A country must match exactly or through a known equivalent before the cloud submits it.',
      does: 'Missing countries are held before form entry, and read-only diagnostics check the country too. Results count each guest once. Portal email rejections remain visible for review; no address is changed or retried automatically. The PC-script button now identifies its fc.accor.net portal.' }
  ] },
  { v: 576, items: [
    { ico: '📅', title: 'Purpose of Stay follows Opera’s business date',
      what: 'The report and Excel export now use the same saved weekday and date. They stay on Opera’s business day until Opera rolls it forward, including after midnight.',
      does: 'How you hear about us is now an editable, saved column. Fill blank answers with one click, choose the walk-in Online search percentage, and keep entered answers. Suggestions stay fixed through refresh, sync and export.' }
  ] },
  { v: 575, items: [
    { ico: '⚙️', title: 'Your IN-Gauge tool, your settings',
      what: 'Settings is now at the top. Switch tools, allowed changes, charts, history and extra guidance on or off, choose compact cards and set your start page.',
      does: 'Preferences stay separate for each hotel and account on this device. Changes apply immediately; reset defaults restores the original layout. Hotel verification, seller review, live amount checks and final confirmation always stay enforced.' }
  ] },
  { v: 574, items: [
    { ico: '🏨', title: 'Use any hotel in your IN-Gauge account',
      what: 'Choose Mercure, Adagio, Ibis or another accessible hotel directly. You no longer need a matching HotelOps hotel space.',
      does: 'Each selected hotel keeps its own audit reports, seller mappings, decisions and change history. The original Package Audit keeps its existing data. Hotel, department, product and contributor checks still run before any reviewed change.' }
  ] },
  { v: 573, items: [
    { ico: '✨', title: 'A simpler place to manage your upsells',
      what: 'Choose Monthly totals, Review & fix, or Find a sale. Each task now has its own focused view instead of one long page of controls.',
      does: 'Monthly totals starts with Upload journal and Compare totals. Extra graphs, mappings and filters are tucked away. Apply appears for saved selections, errors and progress stay easy to find, and Save still keeps your place. Seller confirmation and live financial checks stay enforced.' }
  ] },
  { v: 572, items: [
    { ico: '✓', title: 'Save without losing your place',
      what: 'Saving a package keeps the current list tab, search and scroll position. It no longer jumps to Apply or switches you to Suggested changes.',
      does: 'Your edited draft stays selected for review and a short saved message confirms it. You can keep editing nearby packages, then open Apply when ready. Cancel also returns you to the place where you opened the editor.' }
  ] },
  { v: 571, items: [
    { ico: '👤', title: 'Seller credit backed by evidence and your confirmation',
      what: 'The review separates the named seller, posting user and explanation. New manual credits require contributor confirmation. Similar full names, conflicting notes and unresolved identities stay out of ready selection.',
      does: 'Changing the contributor clears confirmation. Overriding a uniquely identified note seller requires a reason, and bare Opera user IDs are never treated as IN-Gauge staff IDs. Automatic-package imports keep the final extension, memory or pinned seller decision and respect Skip; the per-booking editor cannot silently replace that seller.' }
  ] },
  { v: 570, items: [
    { ico: '⚡', title: 'Faster monthly comparisons and clearer scope checks',
      what: 'Product-code lookup is indexed once, keeping comparisons fast even when many records have an unrecognized label and need catalog matching.',
      does: 'The month-to-date graph renders correctly on the first day of a month. Denied, deleted and purged products no longer create irrelevant mapping warnings. New unit and phone-browser regressions cover these cases; approved, pending and net posting totals retain the same safeguards.' }
  ] },
  { v: 569, items: [
    { ico: '📊', title: 'Monthly Opera versus IN-Gauge totals',
      what: 'The IN-Gauge workspace now compares Opera net postings with approved and pending IN-Gauge revenue for a selected month. See the difference, a daily chart and product-family breakdown for manual, automatic or both.',
      does: 'Credits and reversals reduce the Opera total. Current months use month-to-date dates. Unmapped codes, partial snapshots, currencies and amount-basis checks remain visible. Extra codes can be mapped or excluded for the chart; totals never submit changes or prove a missing sale by themselves.' }
  ] },
  { v: 568, items: [
    { ico: '✓', title: 'Clearer, more reliable run history',
      what: 'Search by run number, hotel or person, reset filters in one tap, and see explicit refresh feedback if a status cannot be verified. Preview runs say clearly that no changes were submitted.',
      does: 'History keeps keyboard focus inside the window and restores it when closed. Background scrolling is locked, results stay visible on short screens, and timers update without rebuilding the full history every second. Invalid dates and timestamps cannot create misleading live results.' }
  ] },
  { v: 567, items: [
    { ico: '🗂', title: 'Run history with dates and clear results',
      what: 'History, Active and All views now have date, tool and result filters, quick date ranges and compact mobile cards. Times use Dubai time; older records are retained.',
      does: 'Old runs without a final report show Unconfirmed instead of an endless Starting timer. Final results are saved by the cloud workers even while HotelOps is closed. Refresh status checks each run’s own record; an unknown result is never called a successful transaction.' }
  ] },
  { v: 566, items: [
    { ico: '⚡', title: 'Find, edit and apply in three steps',
      what: 'Edit a package directly from live IN-Gauge data, or switch to Check Opera reports for an audit. Hotel setup and past history are tucked away. Package, seller, charge and status come first in the editor; stay details remain prefilled below.',
      does: 'Save & select prepares a validated edit without sending it. Prepare several edits and apply them together after review. Search keeps the same input, renders a short page of matches, and reuses loaded data. Saved edits reopen with your changes, and cancelled edits leave no draft.' },
    { ico: '✓', title: 'Less repeated work; the same live financial checks',
      what: 'Startup reads are parallel, history loads on demand, and cloud dispatch skips a redundant request. Independent property/permission and lock/duplicate reads run together.',
      does: 'The selected hotel is shown again before Apply. Editing is locked during an active run and stale data must be refreshed. Live permissions, sellers, amounts, duplicate checks, locks, final verification and safe cancellation remain enforced.' },
  ] },
  { v: 565, items: [
    { ico: '☁️', title: 'The Neorcha look for your IN-Gauge console',
      what: 'IN-Gauge now uses a compact cloud window with the same blue progress bar, highlighted steps and dark live console as Neorcha. Activity lines have timestamps and coloured labels.',
      does: 'Show or hide the console, minimise to keep its chip, or close and reopen from Cloud runs. Scrolling stays where you left it, elapsed time updates quietly, and safe cancellation stays available on phones.' },
  ] },
  { v: 564, items: [
    { ico: '1', title: 'Everything laid out in six steps',
      what: 'IN-Gauge automation now guides you through Hotel, What to fix, Reports, Review, Run, and Results. The numbered overview lets you jump to each section and shows your current stage.',
      does: 'The review list appears before Apply. The live run window also shows numbered sign-in, hotel, data, check, apply and result stages. Detailed activity can be expanded; close/cancel controls remain visible. No separate user test step is added.' },
  ] },
  { v: 563, items: [
    { ico: '⏹', title: 'Close or cancel an IN-Gauge run',
      what: 'Running automation has separate Close window and Cancel automation buttons. They stay visible while the activity log scrolls, including on phones.',
      does: 'Closing keeps the run going. Cancelling saves a stop request that survives refresh, stops queued work before sign-in, and stops active runs at the next safe point. Requests already sent are verified and retained in history; completed changes are not undone.' },
  ] },
  { v: 562, items: [
    { ico: '✓', title: 'Review your list, then apply',
      what: 'The separate Check selected changes step has been removed. Review your selected hotel, sales, sellers and values, then press Apply selected changes.',
      does: 'Live safety checks run inside the apply job before each change. Failed checks hold the case; uncertain outcomes stop the batch and stay in history. Development tests run before release.' },
  ] },
  { v: 561, items: [
    { ico: '⚡', title: 'Reuse packages and sellers between runs',
      what: 'IN-Gauge keeps a private, hotel-specific package catalogue and seller list for up to 24 hours. Later fetches reuse these lists while reading sales live.',
      does: 'Use Refresh packages & sellers under IN-Gauge data and refresh whenever the team or catalogue changes. Before a financial change, the selected package and current seller list are checked live. Permissions, amounts, locks and duplicate checks stay live.' },
  ] },
  { v: 560, items: [
    { ico: '✓', title: 'Choose Manual, Automatic or Both',
      what: 'IN-Gauge automation now guides you through choosing sales, uploading the matching reports, checking and reviewing. It fetches current IN-Gauge records when needed.',
      does: 'Manual uses Journal + Reservation Detail. Automatic uses both Changes Logs. Both checks everything. Only changes in your chosen mode can be selected or submitted.' },
    { ico: '☰', title: 'Phone menus you can open and search',
      what: 'Hotel, department, product, seller and status choices use searchable in-app lists, with full names and a clear close button.',
      does: 'The review form uses one column on phones, with larger controls. Saving puts the change in your review list; it does not send it immediately.' },
    { ico: '📋', title: 'See what changed and why',
      what: 'Change history shows saved runs, confirmations, actions, before/requested/final values and verified, held or uncertain results. Readiness checks are clearly separated from applied changes.',
      does: 'A blank memo filled by IN-Gauge with APPROVED is recognised; money, seller, product, dates and hotel still have to match. Other differences show exactly which values changed. Product reads run in parallel and an immediate apply reuses its exact preflight.' },
  ] },
  { v: 559, items: [
    { ico: '✓', title: 'Readiness checks finish correctly',
      what: 'Fixed “test is not defined” and the related plan-hash reference in the run completion handler. A passed readiness check now enables Apply for the exact reviewed selection.',
      does: 'The completion handler reads the mode and hash from its own job report, including restored runs. Browser tests exercise completed readiness and simulated apply jobs.' },
    { ico: '📋', title: 'Fetch every IN-Gauge page',
      what: 'Snapshots now use the portal’s total record count, rather than its page size, and read all pages in stable ID order.',
      does: 'Refresh live IN-Gauge before checking your reports again. Older snapshots without verified pagination are blocked. Progress reports the number read against the full total.' },
  ] },
  { v: 558, items: [
    { ico: '📄', title: 'Upload both Opera Changes Logs',
      what: 'IN-Gauge automation now accepts the New Reservation and Update Reservation Changes Log PDFs together or one after the other, matching the original Package Audit.',
      does: 'Use Opera Changes Logs · both PDFs. The files are merged and listed by name; uploading another log keeps the earlier events, and repeated events are deduplicated by the existing audit reader.' },
  ] },
  { v: 557, items: [
    { ico: '📡', title: 'IN-Gauge now has its own live run window',
      what: 'A progress window opens when you connect, fetch records, check readiness or apply reviewed changes. It shows sign-in, hotel lookup, catalog checks and record counts inside HotelOps.',
      does: 'Close to minimise, then reopen from Cloud runs. The latest result and hotel choices survive refresh. Completed runs show the next step, so you do not need to read GitHub logs.' },
  ] },
  { v: 556, items: [
    { ico: '🪪', title: 'Choose your Neorcha reader and collection',
      what: 'The saved link chooses the reader: /tweak/ uses the new portal; /neorchaWEBPlatform/ uses the original portal. The current reader is shown beside your collection settings.',
      does: 'Use Today only (Dubai), choose Contacts & enrolment or Full registration, or select individual fields. Reservation identity stays included. New collections are archived; reopen a saved collection or export it for later use.' },
    { ico: '☁️', title: 'Today-only Ibis cloud collection verified',
      what: 'The full automatic Tweak workflow now starts directly after sign-in. Today-only filtering and selected fields were checked against the live portal.',
      does: 'Open Neorcha Registrations, check the link and fields, press Today only, then Run in the cloud. The app also checks for updates when it opens.' },
  ] },
  { v: 555, items: [
    { ico: '↗', title: 'One IN-Gauge review workspace',
      what: 'Package Audit → IN-Gauge automation reads live records, products and contributors for your linked hotel. Upload Opera reports, review missing sales and package fixes, and choose exactly what to apply.',
      does: 'Owners and managers link the exact property and department. Review assignments, run readiness checks, then apply selected additions, edits, replacements, approvals, denials or removals. Uncertain outcomes and locked periods are held for review.' },
    { ico: '🪪', title: 'Ibis supports the new Neorcha Tweak portal',
      what: 'Ibis now uses ibis.myneorcha.com/tweak. Cloud collection, the helper and the copied email extractor recognize the new design and read complete registration-card lists.',
      does: 'The legacy reader and links remain for Mercure and Adagio. The Ibis reader verifies its exact hotel, arrival dates, document type and page counts before saving.' },
  ] },
  { v: 554, items: [
    { ico: '↗', title: 'Manual sales: confirmation first',
      what: 'Every manual sale has a prominent confirmation number, copyable entry fields, reservation details, numbered evidence and instructions for what to do in IN-Gauge.',
      does: 'Open Package Audit → Manual sales. Why this sale explains the posting, reservation match, seller credit and existing requests.' },
    { ico: '☁️', title: 'Review, test, then submit selected sales',
      what: 'Owners and managers can select verified early check-in and late-checkout additions, test the live portal without submitting, then submit the reviewed selection as Pending requests.',
      does: 'First add INGAUGE_EMAIL and INGAUGE_PASS to GitHub Actions secrets. The runner rechecks existing requests before each addition and stops on ambiguous results. Breakfast quantity remains a manual check. Run progress and ended runs stay in Cloud run history.' },
  ] },
  { v: 553, items: [
    { ico: '↗', title: 'Find missing manual sales',
      what: 'Package Audit → Manual sales: upload your Opera journal, Reservation Detail and IN-Gauge product export. See proposed additions, existing requests, uncertain matches and dates needing a newer export.',
      does: 'Every sale shows the reservation, net charge, original note, named seller and posting user. Copy the details or export the full review. Audit reports can be reused in both tabs.' },
    { ico: '⏳', title: 'Pending means already requested',
      what: 'Package Audit recognizes pending seller requests and explicitly marked manual records. A pending request awaits approval in IN-Gauge; an approved manual request keeps its approved seller.',
      does: 'Requests are not rejected just because there is no Opera package event. Upload a fresh IN-Gauge export after approving a request to update its status.' },
  ] },
  { v: 552, items: [
    { ico: '🎨', title: 'Clearer navigation across themes',
      what: 'Search, Pinned and Recent shortcuts no longer float over the page links. Sidebar rows keep their height and shortcuts use an aligned grid.',
      does: 'The sidebar scrolls as one readable menu. Native form controls match light and dark themes, and touch shortcuts have larger targets.' },
    { ico: '📡', title: 'Opera dashboard totals are recognized',
      what: 'The Room Type / Clean / Dirty dashboard grid contains totals, not guest records.',
      does: 'These known summaries no longer trigger an unknown-screen warning or become departure entries. Unfamiliar guest lists still report reading problems.' },
  ] },
  { v: 551, items: [
    { ico: '☁️', title: 'Cloud run chips stay steady',
      what: 'The elapsed-time clock and background heartbeats were rebuilding the chip and replaying its animation.',
      does: 'The clock now updates in place, with stable controls and no repeated fade or pulse. Progress and results still update as the run advances.' },
  ] },
  { v: 550, items: [
    { ico: '🎨', title: 'A cleaner Appearance menu',
      what: 'Roomier display controls, aligned switches and a clearer eye-saver strength selector replace the cramped cards.',
      does: 'Browse styles in a compact two-column grid. The panel fits the screen, includes its own close button and keeps your existing settings.' },
  ] },
  { v: 549, items: [
    { ico: '📡', title: 'Opera Departures are recognized correctly',
      what: 'An old learned screen label could call the Departures screen “other”, even after its guest rows were read correctly.',
      does: 'The explicit Departures heading now wins, so the reader can create and update the departure board. Refresh HotelOps on the desk, then reload the Opera tab to load the updated reader.' },
  ] },
  { v: 548, items: [
    { ico: '🗂', title: 'Cloud run history shows what has ended',
      what: 'Completed, failed and stopped runs now stay in history without an Open live window button or an active run chip.',
      does: 'Active runs are listed separately. Finished results keep their duration, outcome and GitHub link, and delayed progress cannot make them look active again.' },
  ] },
  { v: 547, items: [
    { ico: '💬', title: 'Chat works better on phones',
      what: 'The header, messages and typing box fit the visible screen when the keyboard opens. Closing chat also dismisses any open menu.',
      does: 'The close and back buttons stay within reach, with larger tap targets and space for the phone’s notch.' },
    { ico: '🎤', title: 'Voice messages: play, record and cancel',
      what: 'Fixed blocked voice playback. Recording now shows a timer and a cancel button, and releases the microphone when you close chat, switch conversations or leave the app.',
      does: 'Tap the microphone to record, ■ to send, or ✕ to discard. A cancelled recording is never sent to another chat.' },
  ] },
  { v: 546, items: [
    { ico: '⭐', title: 'Favorites are easier to use on your phone',
      what: 'The star for saving favorite pages was hidden on touchscreens, and the phone More menu did not have a way to add favorites.',
      does: 'Open More → ☆ Favorites and tap a star next to any page. Your favorites appear at the top of the menu. The sidebar star is also visible on touchscreens.' },
    { ico: '✕', title: 'Fixed: close Team chat from an open conversation',
      what: 'On a phone the conversation covered the only close button in the chat list.',
      does: 'An ✕ button now sits in the conversation header so you can close Team chat directly.' },
    { ico: '🔄', title: 'Fixed: deleted records could stay in offline copies',
      what: 'Firebase could confirm a record was removed while the phone or PC kept its old local copy.',
      does: 'When Firebase confirms a deletion, HotelOps removes the old cached copy as well. Temporary connection failures still keep your offline copy.' },
  ] },
  { v: 545, items: [
    { ico: '🎤', title: 'Fixed: voice messages said "Error"',
      what: 'A voice message could show "Error" instead of playing — on the iPhone (which records MP4 and would not play it from where it was stored) and for a moment while any voice message or photo was still loading.',
      does: 'Voice messages now have WhatsApp\'s own player: ▶ / ❚❚, a line that fills as it plays, and the time. New recordings are saved in a format iPhones and PCs both play. A photo or voice message that is still loading shows … instead of an error.' },
  ] },
  { v: 544, items: [
    { ico: '🩹', title: 'Fixed: Team chat broken on the iPhone',
      what: 'On a phone the open chat was see-through (the chats list showed behind your messages in Redline and other styles), its header slid up under the notch after typing, and the search and message boxes turned white.',
      does: 'The chat now always covers the screen, the header stays at the top (the window follows the part of the screen you can see when the keyboard opens and closes), the page behind it no longer scrolls, and the boxes keep WhatsApp\'s colours in every style.' },
  ] },
  { v: 543, items: [
    { ico: '💬', title: 'Team chat is now like WhatsApp',
      what: 'Chats list with search and All · Unread · Groups · Direct, unread counts and last messages; the Whole team group, your own groups and direct chats. Two panes on PC like WhatsApp Web, one screen at a time on the phone, in WhatsApp\'s colours (light and dark).',
      does: 'Tap 💬 in the top bar (More on the phone). ✏️ starts a direct chat, 👥＋ makes a group.' },
    { ico: '✓✓', title: 'Ticks, seen, typing and online',
      what: '✓ sent · ✓✓ delivered · blue ✓✓ seen by everyone; Message info lists who read it and who has it. "Sam is typing…" in the chat and in the list; "online" / "last seen today at 10:42" in direct chats.',
      does: 'You know your message reached the team — and who still hasn\'t seen it.' },
    { ico: '👥', title: 'Groups in two taps',
      what: 'Pick the people → give it a name and an emoji (Night team 🌙, HK 🧹…) → ✓. Group info: rename, description, add and remove people, make admins, exit group.',
      does: 'Admins manage the group; everyone sees who is in it.' },
    { ico: '↩', title: 'Everything you do to a message',
      what: 'Right-click / long-press (or the ⌄ on a message): reply (swipe right on the phone), react 👍❤️😂😮😢🙏, copy, forward, star, pin to the top, edit (15 min), delete for everyone or for me, message info.',
      does: 'Plus search in the chat, starred messages, mute, pin a chat, @mentions (with a pop-up even in muted chats), emoji, photos (made small) and voice notes up to 90 s. Room numbers are links to the room card.' },
  ] },
  { v: 542, items: [
    { ico: '💬', title: 'Team chat',
      what: 'A chat for your hotel\'s team, live on every PC and phone: 💬 in the top bar (More on the phone). A number shows what you haven\'t read, and a colleague\'s new message pops up for a few seconds.',
      does: 'Room numbers in a message are links (tap 412 → room 412\'s card). Enter sends, Shift+Enter is a new line; you can delete your own messages. The last 300 messages are kept.' },
    { ico: '✏️', title: 'Arrange the menu your way',
      what: 'The ✏️ next to "Find a page" puts the menu in arrange mode: drag a page (or use ↑ ↓) — also into another group — and move whole groups with the ↑ ↓ on their title.',
      does: 'It is your own menu (the phone\'s More follows it); "↺ Hotel\'s order" puts it back.' },
    { ico: '🌆', title: 'Dark in the evening — if you want it',
      what: 'In the theme menu (and Home ⚙️): 🌆 Dark in the evening — the app turns dark by itself 19:00–07:00 and light again in the morning.',
      does: 'Off unless you switch it on. 🌙 Dark mode still keeps it dark all day.' },
    { ico: '👁', title: 'Eye saver',
      what: 'A warm screen with less blue light: Off · Low · Medium · Strong, always or only in the evening (theme menu, or Home ⚙️).',
      does: 'Easier on the eyes on long and night shifts — it works with every theme and with dark mode.' },
    { ico: '🕐', title: 'AM/PM in one tap · PM rooms switch',
      what: 'Tap the clock in the top bar to switch between 9:00 PM and 21:00 (the roster follows). In In-House ⚙️: "Show PM rooms in the list" puts Opera\'s 9000+ PM rooms in All too.',
      does: 'PM rooms never count as guests either way.' },
    { ico: '🔌', title: 'Opera reopens by itself when it goes out',
      what: 'When Opera stops answering — the tab closed, crashed or hung — HotelOps brings it back: the Opera tab refreshes, or Opera opens again. When Opera says the session expired, the reader refreshes it to the sign-in page and tells you; signing in is still yours.',
      does: 'Switch it in Opera ⚙️ (Keep Opera open, on by default). To reopen Opera in a background tab by itself, download the helper once more (Settings → Opera reader); without it HotelOps opens Opera in a pop-up — allow pop-ups for HotelOps.' },
    { ico: '🏨', title: 'Clusters: each hotel with its own Opera — safely',
      what: 'Every Opera screen now tells HotelOps which property it is (the code Opera shows, like AB1C2). Each hotel learns its own code from its first read, and an Opera tab of another hotel never changes this hotel\'s lists — you get a short note instead.',
      does: 'Reopening always uses the current hotel\'s own Opera link. Opera ⚙️ → "Only this hotel\'s Opera" shows the code and can forget it.' },
  ] },
  { v: 541, items: [
    { ico: '⚙️', title: 'Settings on every page',
      what: 'Every page now has a ⚙️ in its header with the options for that page. Every page can: pin it to the top of the menu, open it when HotelOps starts, show or hide its tile on Home, hide it from your menu, show it with larger text, or fit more on the screen.',
      does: 'Page options where they matter — Departures: card size, the sort it opens in, ask before checking out, the high-balance amount. Home: greet by name, tips, Brain, Morning brief, Start-of-day and shift-report reminders. Shift Tasks: start each shift fresh, reminders, auto-tick. Opera: adjust by itself, hold for my OK, ask me when unsure, learn my routine. Guest enrolment / Neorcha: show the running-job chips. "All settings ›" opens the full Settings.' },
  ] },
  { v: 540, items: [
    { ico: '📝', title: 'New: End-of-shift report — made for you',
      what: 'Home → 📝 Shift report (or search "shift report"): a ready-to-send summary of YOUR shift, built from what HotelOps already knows — the check-outs done in your shift, extensions, late check-outs, rooms still to leave / past check-out / no answer / DND, open balances with the high and OTA ones named, your shift tasks still open, and on the night shift the night checklist.',
      does: 'Nothing to type: 📋 Copy or 💬 WhatsApp it to the next shift or your manager. In the last 30 minutes of a shift the 🧠 Brain reminds you it is ready.' },
    { ico: '🕐', title: 'Fixed: Shift Tasks opened on Morning for everyone',
      what: 'The afternoon and night teams always landed on the 🌅 Morning tab of Shift Tasks.',
      does: 'It opens on the shift you are working now (Morning, Afternoon or Night). A tab you pick yourself stays until the next shift starts.' },
    { ico: '🪟', title: 'One window at a time',
      what: 'At the start of the day, the Start-of-day window could open on top of the Morning brief or What\'s new.',
      does: 'It now waits until the other window is closed.' },
    { ico: '🧪', title: 'Tested for every shift',
      what: 'The whole app was run as if it were 07:30, 15:30, 23:30 and 03:30 (Dubai time): every page opened and every button tapped with real-looking data, the greetings, shift names, check-out timers, overdue warnings, checklist times and pop-ups checked for each shift.',
      does: 'No errors in any shift; the two shift problems found are fixed above.' },
  ] },
  { v: 539, items: [
    { ico: '🔎', title: 'Find any page in a second',
      what: 'On top of the side menu: "Find a page…". Type and the menu narrows as you type — it knows what people call things, so "balance" finds Departures and In-House, "tax" the Tourism Dirham and DTCM pages, "passport" Neorcha and Immigration. Press / anywhere to jump to it; Enter opens the first page.',
      does: 'Below it: ⭐ Pinned (the ☆ on any menu line pins it to the top) and 🕘 Recent (the last pages you opened). Tap a group title — Front Desk, Night Audit, Money & Tax… — to fold its pages away; it remembers. On the phone, More shows Pinned and Recent, and its search knows the same words.' },
    { ico: '💰', title: 'High balances and OTA balances, one tap',
      what: 'Two new filters on Departures and on In-House Guests: 💰 High balance (open balances of AED 500 or more) and 🌐 OTA balance (Booking.com, Agoda, Expedia and other online agencies with money still open — they are usually prepaid, so a balance there needs a look).',
      does: 'Both list the biggest balance first. Tap High balance again to change the amount (each device remembers its own).' },
    { ico: '🌙', title: 'Dark mode for every theme',
      what: 'In the theme menu (🎨 at the top, or Theme in the phone\'s More): a 🌙 Dark mode switch. A light theme keeps its style — fonts, corners, its own accent colour — and turns dark; themes that are dark already stay as they are. It stays on when you change theme, and the sign-in page follows.',
      does: 'Easier on the eyes at night. Accent colours too dark to read on black are lightened by themselves, and every page was checked for readable text in dark mode.' },
  ] },
  { v: 538, items: [
    { ico: '🚪', title: 'Departure cards: a calmer, clearer design on PC and phone',
      what: 'Each room card now has a status colour rail down its left edge, a softer room number, one strong green Check out with a quiet Left · waiting beside it, and the five small actions (Extend, Extending, Late CO, No answer, DND) in one even row with only their icon in colour. The notes row is slimmer, and finished rooms (out or extended) step back.',
      does: 'Your eye goes straight to what matters: the colour says the state, the green button is the next step. On the phone the five small actions no longer break into 4 + a lonely DND line, and "Guest said…" sits in the middle of its box. Works in every theme.' },
    { ico: '🎨', title: 'Small look fixes',
      what: 'In Stratum (and other see-through themes) the chosen Departures filter chip was white on white; in Apple Notes "Firebase · Offline" and "I\'m away" in the top bar were too faint.',
      does: 'Both are readable now.' },
  ] },
  { v: 537, items: [
    { ico: '🐞', title: 'Fixed: pasting Arrivals or Purpose of Stay crashed',
      what: '⚡ Load Pasted on Arrivals and ⚡ Load on Purpose of Stay stopped with an error before loading anything (a name used there was never set — it came in with the Nationality column in an earlier update).',
      does: 'Pasting works again, and the Nationality column of the paste is now read into each guest.' },
    { ico: '🚪', title: 'Fixed: Departures files with fewer columns were refused',
      what: 'A departures report with fewer than 15 columns — a shorter export, or Excel trimming the empty last columns — said "No departure rooms found" although the rooms were there.',
      does: 'Any report with a ROOM column loads; a row only needs the room and the name.' },
    { ico: '⌨️', title: 'Fixed: Space on the Night Checklist',
      what: 'The keyboard shortcut Space ("tick the first step") called an old name and did nothing but an error.',
      does: 'Space ticks the next step again.' },
    { ico: '📝', title: 'Fixed: emojis broken in handover notes',
      what: 'Cleaning a handover note could cut some emojis in half (for example 👋 next to a 👍 rule), leaving a broken character.',
      does: 'Emojis stay whole.' },
    { ico: '🧠', title: 'Things that now make sense',
      what: 'The greeting said "Good morning" at 1 a.m. to the night shift; the start-of-day window could ask at 23:00 (day over) or 01:00 (the new day\'s reports don\'t exist yet), and asked view-only logins who can\'t load anything; after many missed updates What\'s new could become a 40-card slideshow.',
      does: 'Until 05:00 it says "Good evening". Start of the day asks only 05:00–15:59 and only people who can load reports. What\'s new shows the newest 15 one by one; the rest are in "See them all as a list".' },
  ] },
  { v: 536, items: [
    { ico: '✕', title: 'Run windows: minimise or close — your choice',
      what: 'A cloud run window now has both buttons: – minimises it (a chip stays at the bottom-left) and ✕ closes it for real (no chip). A running chip has its own × too.',
      does: 'Closing never stops the run — it keeps going and stays in 🗂 Runs, where 📡 Open live window brings it (and its chip) back any time. To stop a run, use ■ Stop inside the window.' },
  ] },
  { v: 535, items: [
    { ico: '🗂', title: 'Every run has a history — and a running one is never lost',
      what: 'All runs are now kept and numbered, however they started: ☁️ Enroll, Run again, the duty PC, Neorcha\'s Run in the cloud, the nightly 03:17 Neorcha run, or a run a colleague started on another device. (Before, the main ☁️ Enroll run was not registered.) A run GitHub could not start now shows as ⛔ stopped, not running forever.',
      does: 'While a run is going and its window is closed, it sits minimised as a chip at the bottom-left — tap to open it. 🗂 Runs is always there with the full history: number, hotel, who or what started it (you, the duty PC, the nightly schedule), when, how long, the result, and its GitHub link.' },
  ] },
  { v: 534, items: [
    { ico: '☀️', title: 'Start of the day: it asks you to load the important reports',
      what: 'The first time you open HotelOps each day, if the In-house report or today\'s Departures is not loaded yet, a "Good morning — start of the day" window asks for them, with what is missing and "0 of 2 loaded".',
      does: 'Tap 📂 Load the file (it opens the right page and steps aside as a small bar) or 📡 Read from Opera (open In House, then Departures in Opera). Each line ticks ✓ by itself the moment its report is in, and the window closes when both are. Busy? ⏰ Remind me in 30 min, or Skip today.' },
  ] },
  { v: 533, items: [
    { ico: '❓', title: 'The Opera reader asks you too — right inside Opera',
      what: 'When HotelOps is not sure if a guest checked out or extended, the question now also appears in the reader\'s box in the Opera tab: "❓ HotelOps asks — Room 412: checked out or extended?" The box opens by itself for a new question, and its corner badge shows "?" while one waits.',
      does: 'Answer without leaving Opera: tap ↪ Extended or 🚪 Checked out and HotelOps updates the board at once ("Room 412 marked extended ✓"). Or tap 🔎 Let Opera show me, then open Departures, Arrivals and In House: the reader looks again and settles it by itself. The reader still only reads Opera — it never clicks or types there.' },
  ] },
  { v: 532, items: [
    { ico: '🗂', title: 'Cloud runs are never lost — minimise, numbered, with their hotel',
      what: 'Closing a cloud run window (Guest enrolment or Neorcha) now minimises it. A chip stays at the bottom-left: "#12 ✍️ Guest enrolment · Ibis Styles · 5/12 · 3:20" with a progress line. Every run gets a number, and 🗂 Runs lists them all.',
      does: 'Tap the chip and the live window opens again where the run is. 🗂 Runs shows each run with its number, hotel, Neorcha account, who started it, when, how long it took, the result (enrolled / already members / skipped / errors, or cards read) and its GitHub link.' },
    { ico: '❓', title: 'Not sure if a guest checked out or extended? It asks you',
      what: 'When Opera does not show clearly whether a departure left or stayed on, HotelOps now asks out loud, room by room: "Room 412: checked out or extended?" with the reason.',
      does: 'Tap ↪ Extended or 🚪 Checked out and the board is updated. Or tap 🔎 Let Opera show me: open Departures, then Arrivals and In House in Opera, and the reader looks again and settles it by itself. The question goes away once it is clear.' },
    { ico: '🧠', title: 'It learns your Opera routine and offers to start it',
      what: 'From the Opera screens you open every day (screen names only, never guest data), HotelOps learns your routines and the hours you do them.',
      does: 'When a routine you usually do about now has not happened today, it asks: "You usually do Departures → Billing around 10:00–12:00 — open Departures in Opera now?" One tap opens Opera. Turn learning off on the 📡 Opera page.' },
    { ico: '🔴', title: 'New theme: Redline White',
      what: 'The Redline design with white where Redline is orange: a white sky with a pearl planet, a deep-red top bar and side menu with white words, white cards with a red line, and crimson buttons.',
      does: 'Pick 🔴 Redline White in the theme menu. The sign-in page matches it too.' },
    { ico: '✨', title: 'What\'s new, one update at a time',
      what: 'This window now shows each update on its own card, with a progress line, Back / Next (or swipe on the phone, arrow keys on the PC), and "See them all as a list".',
      does: 'Each card says what changed and what it does for you, so you know exactly how to use it.' },
  ] },
  { v: 531, items: [
    "📜 New themes — Myth Atlas (warm museum paper, hairline rules, a terracotta accent, cards framed like a specimen plate), Atlas Dusk (the same at night) and 🌿 Heritage Grove (cream paper, one teal ink, a hand-drawn ink landscape of hills, a lake, pines and two cranes along the bottom). Pick them in the theme menu.",
    "🔐 The sign-in page now matches every style: its corners, title font and labels follow the theme you chose, and the flat styles drop the glow.",
    "🎨 Checked every page on PC and phone in every style: no page runs off the side, and words that were too faint (top bar on light styles, checklist chips, step numbers, a few buttons) are readable now.",
    "↪ Extensions: when a guest is checked out and checked in again (a new booking from today, same guest, same room), HotelOps marks it extended — not checked out. It also catches it after the room was already marked out.",
    "📡 Opera reader: a reservation like 03-11 → 07-11 is read as 4 nights (it was read the American way as March → July), and \"Rooms: 1\" on a reservation is no longer taken as room 1.",
  ] },
  { v: 530, items: [
    "🏛 New theme — Stratum: a calm night-navy look with a thin architectural frame around the screen, bold uppercase titles, square glass buttons with cut corners and one cream button for the main action. Pick it from the theme menu.",
    "✨ In Stratum, on a computer, hovering a menu item or button makes its label \"decode\" from random letters into the real word in under half a second. It never runs on phones or if your device asks for less motion, and the text always ends on the real label.",
  ] },
  { v: 529, items: [
    "🩹 Enrolment window: tapping Skipped / Errors / Enrolled / Already members no longer flickers open and shut. The list stays open until you tap the tile again, and the open tile is highlighted.",
  ] },
  { v: 528, items: [
    "🔁 Roster: \"Replace / swap this week with…\" now swaps when the other person already works that week — both keep a full week and nobody's shifts are lost (before, their own shifts were overwritten). With a new name, it simply moves the week over.",
  ] },
  { v: 527, items: [
    "🔁 Roster — change the people, any time: in ✏️ Edit, tap a person's name to Rename, Replace with someone else (their whole week moves over — handy for a sick-leave cover), or Remove from this week. As always, you can also edit any day's shift directly in Edit mode and it saves for the team instantly. (A reminder: you already have Swap shifts, Sick / leave, Copy last week and Change this week too.)",
  ] },
  { v: 526, items: [
    "👆 In the live enrolment window, tap a result tile — Enrolled, Already members, Skipped or Errors — to see the list of those guests and the exact reason each one did or did not go through.",
    "📱 Fixed the enrolment window on phones: the top bar and the ✕ close are always visible now (it used to slip above the screen), and the close button is bigger and easier to tap.",
    "🏨 Neorcha: the hotels you add are now saved for the whole team (and kept when you come back), not just on the device where you added them.",
  ] },
  { v: 525, items: [
    "🔗 The enrolment portal link is now remembered per hotel and shared with your team, so you don't paste it every run. Type it once; any device for that hotel fills it in by itself. (It only saves a real guestinternet.com link, and only writes to the database when it actually changes.)",
    "🏷️ Renamed the tool to neutral names — \"Guest enrolment\", \"Enrol guests\", \"Enrolment portal link\" — so it reads the same for any hotel or programme, not a brand.",
  ] },
  { v: 524, items: [
    "✉️ Enroll now fixes obvious e-mail typos by itself, so more guests go through: gmail.con → gmail.com, gmial/gamil/gnail → gmail, hotmai/hotmial → hotmail, yahoo.co → yahoo.com, a missing dot (gmailcom → gmail.com), extra spaces, and clear slips like .con/.cmo/.ocm → .com. It only fixes sure cases — a real address like name@company.co is left alone. The fix is shown in the console and on the sheet.",
  ] },
  { v: 523, items: [
    "📄 Enroll from an uploaded sheet: for a hotel with no Neorcha (e.g. Adagio), upload the Purpose of Stay Excel (with an Email column), then press ✍️ Enroll these guests on the Purpose of Stay page. It reads name, e-mail and nationality, opens the simple enroll sheet labelled \"from the uploaded sheet\", and the cloud enrolls the ones you tick.",
    "🌍 The uploaded sheet now also reads a Nationality / Country column (needed for enrollment).",
    "🇨🇮 Fixed a country mismatch: Côte d'Ivoire now matches the portal's \"Ivory Coast\".",
    "ℹ️ \"Already a member\" is not an error — it means that guest already has an ALL account, so there is nothing to enroll. A run that finds only already-members and bad e-mails is working correctly.",
  ] },
  { v: 522, items: [
    "✅ Monthly reports: fixed — none of the reports had a tick box, so you could never mark one done (it stayed 0/4 forever). Now each report has a clear box on the left: tap it to mark the report done, tap again to undo. The box is easy to see in every theme.",
    "🪐 New look: Orbit — deep-space black with frosted-glass cards, white Inter and a soft violet glow.",
    "◼️ New look: Orvante — clean monochrome editorial: grey paper, a black top bar, bold uppercase Archivo headings and crisp hairline cards.",
    "Pick either in the theme menu (top bar, or More on the phone).",
  ] },
  { v: 521, items: [
    "🔤 Accor Loop now turns Arabic names into English so they can be enrolled (the portal only accepts A–Z). Common names come out properly spelled (محمد → Mohammed, عبدالله → Abdullah, فاطمة → Fatima); anything else is written letter-by-letter in English. No more \"name must be in latin characters\" for Arabic guests.",
  ] },
  { v: 520, items: [
    "🔎 Accor Loop now proves what happened for each guest: just before sending it logs the exact values in the form (first, family, e-mail, country) and it prints Accor's full reply. In the HotelOps console you see the real values; on the public GitHub log names and e-mails stay hidden. This shows whether a \"bad e-mail\" is a real bad address or something not filled in.",
  ] },
  { v: 519, items: [
    "📡 Enroll from Opera too: on the Arrivals page press ✍️ Enroll these guests. It takes the arrivals you opened in the Opera reader that have a real e-mail (OTA / Booking relay addresses and \"No email\" are left out), fills the titles, and opens the same simple sheet — labelled \"from the Opera reader\". You still tick who agreed; Opera does not know that.",
  ] },
  { v: 518, items: [
    "✍️ After you collect the cards from Neorcha on this device, it now asks \"Enroll these guests in ALL?\" with Yes / Not now, right at the top. Yes opens the simple enroll sheet (tick who said yes, the cloud does the rest). A nightly cloud collection never pops this up.",
  ] },
  { v: 517, items: [
    "🩹 Found & Redline themes: the phone \"More\" menu was see-through, so the home page showed through it. It is solid now.",
  ] },
  { v: 516, items: [
    "🕷 New look: Found — flat electric blue, white type, frosted-glass cards, and a little jumping spider that drops in, follows your mouse and spins silk with dew drops between the cards (on a computer; your normal pointer stays, it never blocks a click, and Delete clears its web). Pick it in the theme menu.",
    "🧭 DTCM Reconciliation: when the two totals agree but there are still corrections, it now says why in one line — which items Opera is missing and which DTCM is missing, and that they happen to cancel out. Step C is shorter too.",
    "🔧 Full check of the app: every page (44) and every safe button (527) pressed on PC and phone — no errors found. The Accor Loop GitHub run no longer shows the old \"Node.js 20 is deprecated\" warning.",
  ] },
  { v: 515, items: [
    "🐞 Fixed: the Accor Loop window stayed on \"queued\" and then said \"finished without reporting back\" although the run worked — Guest Pipeline started listening before HotelOps was connected to the database, so the robot's reports never reached the screen.",
    "📱 Enroll guests on the phone: the sheet no longer slides sideways or drags the page behind it (a long e-mail made the list wider than the screen).",
    "🧹 Guest Pipeline → ALL enrollment is compact now: ✍️ Enroll guests and 📡 Progress; the link, test run and the old copy buttons are under More options.",
    "⚡ Accor Loop is faster: shorter waits between steps and guests, and the cloud browser skips the portal's pictures and fonts (about 40% quicker in our test).",
    "🖥️ Accor Loop live console (HotelOps) shows exactly what runs and every guest's data: title, name, e-mail, phone, country, then the result.",
    "☁️ Accor Loop: the GitHub run page now reports every guest — started, the portal's answer, the result (enrolled · already a member · skipped · error) and why — not just the final total. Names and e-mails stay hidden there.",
  ] },
  { v: 514, items: [
    "🪐 New look: Redline — a burnt-orange Mars sky with a planet on the horizon, heavy white headings, crimson buttons and clear white focus rings. Pick it in the theme menu (top bar, or More on the phone).",
    "🪪 Enroll guests: Mr / Ms / Mrs now fills itself — from the card when Neorcha has a title, otherwise from the guest's name (any part of it, so \"Wagner Tanja\" works too). When the name doesn't tell, it is marked \"guessed\" — tap it once to change.",
    "👆 Enroll guests: tap anywhere on a guest to tick them, or ✓ Tick all (it asks you to confirm everyone agreed first).",
    "🔗 Neorcha: the button to change a hotel's Neorcha link is now clearly called \"🔗 Change link\" (the cloud run uses it too).",
    "☁️ Neorcha cloud: when Neorcha doesn't open, it tries once more and says what it saw (site down, error page…) instead of only \"is NEORCHA_URL right?\".",
  ] },
  { v: 513, items: [
    "✍️ Enroll in one place: in Neorcha Registrations press ✍️ Enroll these guests. A simple sheet opens with the guests who can join ALL — tick the ones who said yes, tap Mr / Ms / Mrs, press ☁️ Enroll. The live window follows. (Also on the Guest Pipeline page: ✍️ Enroll guests (simple).)",
    "💎 ALL members and guests without an e-mail are left out by themselves; the guest's phone now goes to the Accor Loop form too.",
  ] },
  { v: 512, items: [
    "🧭 Fixed the broken page layout: on the PC most pages (DTCM Reconciliation and others) had dropped under the side menu, and the layout looked broken everywhere. Every page is back in its place, on PC and phone.",
    "☁️ Accor Loop cloud enrollment works again: the GitHub run no longer crashes at start, and the enrollment robot keeps going when the portal reloads (it used to vanish after the first reload — \"no activity\").",
    "🧪 Accor Loop Test run is now really a test: it opens the form and picks the title, then stops — nothing is typed or submitted. (Before, a Test run could submit real enrollments.)",
    "📡 New Accor Loop live window, same style as the Neorcha cloud run: steps, the guest being enrolled, live counts (enrolled · already members · skipped · errors), Stop, and a live console. Guest names and e-mails never appear in the public GitHub log.",
  ] },
  { v: 511, items: [
    "👤 Accor Loop live modal now shows exactly which guest is being enrolled, guest number, confirmation number, country, and whether phone/email data is present.",
  ] },
  { v: 510, items: [
    "🛠️ Fixed Accor Loop cloud startup: Firebase configuration parsing and HotelOps hotel lookup now work like the Neorcha runner, including fallback to the signed-in account's assigned hotel.",
  ] },
  { v: 509, items: [
    "🔗 Accor Loop URL field enlarged for phones: larger text, a taller tap target, clearer focus state, and guidance to paste the complete link.",
  ] },
  { v: 508, items: [
    "🖥️ Accor Loop now opens a large Neorcha-style cloud-run modal with step status, progress, live console, hide/show console, stop, run again, GitHub link, and close-without-stopping behavior.",
  ] },
  { v: 507, items: [
    "☁️ Accor Loop now uses the same hosted-cloud flow as Neorcha: start from HotelOps, provide the Accor Loop URL, and the temporary cloud browser uses only the selected guest data. No duty PC, helper, console, Accor ID, or Accor password is needed.",
  ] },
  { v: 506, items: [
    "🖥️ Accor Loop is now clearly a normal web cloud run: HotelOps creates a temporary GitHub-hosted computer, runs the browser there, streams progress back, and shuts it down when finished. It no longer depends on the duty PC.",
  ] },
  { v: 505, items: [
    "🔎 Accor Loop now shows the exact background action in the live panel, including portal loading, form preparation, title/country selection, submit attempts, result detection, fresh-page resets, and safe stop checks.",
  ] },
  { v: 504, items: [
    "⏹ Accor Loop now has GUI controls: stop a running cloud job safely, see when it stopped, and run the selected guests again without leaving Guest Pipeline.",
  ] },
  { v: 503, items: [
    "☁️ Accor Loop now has a live runner console with privacy-safe steps, progress, GitHub run link, and a minimize button. The panel stays visible while the cloud browser works.",
  ] },
  { v: 502, items: [
    "📱 Fixed phone navigation: the bottom menu and More drawer now stay above the page and respond reliably to taps, including on iPhone and Android browsers.",
  ] },
  { v: 501, items: [
    "☁️ Accor Loop cloud enrollment: after Neorcha data arrives in Guest Pipeline, provide the secure.guestinternet.com enrollment URL once, review the list, tick Agreed and choose a civility, then run only those guests in a GitHub browser. Test Accor Loop checks the flow without submitting anything; results return to the shared enrollment tracker.",
  ] },
  { v: 500, items: [
    "🔎 DTCM filler: when the portal does not keep a day's figures, the message now shows what the page has against what was typed for each box (e.g. Room Revenue 41,432 (wanted 42,942)), and any message the portal put up — so the reason is plain at once.",
  ] },
  { v: 499, items: [
    "💎 ALL enrollment from anywhere, done by the duty PC: in Guest Pipeline tick Agreed and Mr/Ms, press ☁️ Enroll (even on your phone). The duty PC opens fc.accor.net in a background tab, runs ALL Enroll v19 for those guests only, closes the tab, and the results land in the tracker — no admin rights, nothing new to install.",
    "🖥️ On the duty PC, once: download the helper again (Settings → WhatsApp helper), tick 🖥️ This PC runs the enrollments in Guest Pipeline, keep Chrome with HotelOps open and stay logged in to fc.accor.net. Your phone shows whether the duty PC is ready, and a live box with each step.",
    "🧪 Test run (sends nothing) checks the login, the enroll page and the list first.",
  ] },
  { v: 498, items: [
    "🏨 ALL enrollment now runs on the hotel's duty PC: fc.accor.net only opens inside Accor's network, so GitHub's own computers can't reach it. A GitHub runner on the duty PC does the work — invisibly, in the background — and you still start it from Guest Pipeline, even on your phone.",
    "⚙️ Set up once on the duty PC: GitHub → Settings → Actions → Runners → New self-hosted runner → Windows, label hotel, run as a service. It uses the Chrome or Edge already on that PC.",
  ] },
  { v: 497, items: [
    "☁️ ALL enrollment in the cloud: in Guest Pipeline tick Agreed and Mr/Ms for the guests who said yes, then press ☁️ Enroll in the cloud. A GitHub computer logs in to fc.accor.net with your TARS login, runs ALL Enroll v19 for those guests only, and the results land in the Enrollment tracker by themselves — no PC, no console.",
    "🧪 Test run (sends nothing): logs in, opens the enroll page and checks the list, then stops — do it first. A live box shows each step and a console.",
    "✋ Only guests ticked Agreed are ever sent — the enrollment form records that you presented ALL and the guest asked for it. It never runs by itself on a schedule. Set up once: GitHub secrets ACDC_USER and ACDC_PASS (your TARS login).",
  ] },
  { v: 496, items: [
    "✏️ DTCM Revenue Fill without a file: ✏️ Start a blank month, pick the month, then set what you want — e.g. TD Fee → 0 for all days — or tap any day's box to type a figure. ▶ Fill types only what you set; every other box on the portal stays as it is.",
    "🔧 A change you make (Put 0, Set to a number) is now filled even into a box the file didn't have.",
  ] },
  { v: 495, items: [
    "🔗 DTCM Revenue Fill reads links: paste a Google Sheets, Google Drive, OneDrive or Dropbox link (shared as \"anyone with the link\"), or a link to a photo or file, and press 🔗 Get it. A link that needs a sign-in can't be read by any app — it says so; then download or screenshot it and drop it in.",
    "📄 More kinds: Word files (.docx tables), saved emails (.eml — an attached Excel, PDF or photo, else the table in the message), web pages (.html), Numbers / ODS, and several files or photos at once — put together into one month.",
    "📷 On a phone, 📷 Photo opens the camera. A photo taken sideways or upside down is turned and read again by itself.",
  ] },
  { v: 494, items: [
    "📸 DTCM Revenue Fill reads any kind now: finance's Excel or PDF as before, any other Excel / CSV layout, a scanned PDF, a photo or screenshot (PNG, JPG), or a table pasted with Ctrl+V — even a screenshot with only the TD Fee. Pictures are read in your browser (the first time it downloads the reader, ~10 s).",
    "➕ A partial read is added to the month you already have: drop a TD-only screenshot and only the TD Fee changes; the boxes not in it stay as they are on the portal.",
    "🧩 Columns without titles? It asks once which figure each column is, and remembers it for files like that. Read from a picture? It reminds you to check a few figures before filling.",
  ] },
  { v: 493, items: [
    "🏨 Neorcha hotels as a list: on Neorcha Registrations your hotels show as chips — this hotel first, then the others. Tap one, then ▶ Start or ☁️ Run in the cloud: it uses that hotel's Neorcha link and login.",
    "＋ Add hotel: pick the brand (Mercure, Novotel, Pullman …) — the link and the cloud account fill in by themselves — give it a name, ＋ Add. Its one-time GitHub set-up opens right below with copy buttons. × removes a hotel from the list.",
    "ℹ️ A registration card exists in Neorcha only once the guest has checked in: early in the day, today's arrivals show only the guests already in (9:28 → 1, 10:22 → 3 on 2 Nov). The nightly run collects the full day.",
  ] },
  { v: 492, items: [
    "🏨 Neorcha for several hotels, made easy: each hotel's Neorcha link and cloud account now come from its name by themselves — a Mercure hotel gets mercure.myneorcha.com and account MERCURE with no typing. ✏️ Change if a hotel is different, ↺ Automatic to go back.",
    "📋 ⚙️ Set up this hotel for the cloud shows the exact secret names for that hotel with a copy button each, and opens GitHub's New secret page — copy, paste, type the password, done.",
    "🔐 Your first hotel keeps working with the main login; another hotel uses only its own secrets and, if they are missing, the run says which ones to add.",
  ] },
  { v: 491, items: [
    "🏨 More than one hotel: give each hotel its own Neorcha login on GitHub with its name at the end (NEORCHA_USER_MERCURE, NEORCHA_PASS_MERCURE), then type MERCURE in the new Neorcha account box on that hotel's Neorcha Registrations. The cloud run logs in with that account at that hotel's Neorcha link and saves the cards into that hotel — it never falls back to another hotel's login.",
    "⚡ The Neorcha cloud run is much faster: it uses the Google Chrome already on GitHub's computer (no browser download), checks each card as soon as it shows instead of waiting, and knows the last page without waiting for a next page that never comes.",
  ] },
  { v: 490, items: [
    "🖥️ Live console in the cloud-run window: a terminal that shows what the robot does as it happens — GitHub starting its computer, Chromium opening Neorcha, the network calls, the login, the dates typed, each page and each card (room · purpose · nationality · email ✓ · phone ✓ · time), saving, done. Hide / Show it any time.",
    "🔒 The console never shows a guest's name, email or phone — confirmation numbers appear as ••••1234 — and it is kept in HotelOps only, never in GitHub's public log.",
    "✅ Checked on the real Neorcha: 1–2 Nov → 27 of 27 guests in about 30 seconds.",
  ] },
  { v: 489, items: [
    "🛠 Neorcha read only the first guest: when a card opens, Neorcha hides the list, and the collector looked only for rows it could see. Now it clicks each guest's confirmation number even while the list is hidden (as the older Neorcha Extractor does), waits until the card shows that exact number, and turns the pages the same way — every guest of your dates is read.",
  ] },
  { v: 488, items: [
    "🛠 Neorcha only found 1 guest: its date boxes are calendar boxes that take dates as 2026-11-01 only — the collector typed 01-11-2026, Neorcha dropped it silently and searched without dates. Fixed: now it types them the way the boxes want, checks they took, and stops with a clear message if they did not.",
    "📋 The cloud run's log now says the dates it searches (\"searching arrivals from 1 Nov 2026 to 30 Nov 2026\") and ends with what happened on Neorcha: the dates as typed, the rows on each page, the pages turned — never a guest's name, email or phone.",
  ] },
  { v: 487, items: [
    "📧 Neorcha now also collects each guest's email and phone (for ALL enrolment) — in the cloud and with the helper. Passport, ID number and birth date are still never read, and the cloud log never shows any guest detail.",
    "🧲 New Send to Guest Pipeline button on Neorcha Registrations: the guests go straight into Guest Pipeline (clean the list, tick consent, ALL Enroll) — no copying.",
    "🔁 Run in the cloud as often as you like: each run now carries its own label, so the live window follows the run you just started (it used to show the one that had just finished).",
  ] },
  { v: 486, items: [
    "☁️ Run in the cloud straight from HotelOps: on Neorcha Registrations pick the dates and press ☁️ Run in the cloud — no GitHub app needed. The first time it asks for a start key (a GitHub token that can only start this run), kept on that device only.",
    "📡 A live window follows the run step by step — GitHub computer, Neorcha, log in, search, every card (with the count), saved — with a timer, on phone and PC. Close it any time; 📡 Show progress opens it again, and the page shows the last run.",
    "🔑 Neorcha login in the cloud is typed like a person and tried twice; a space the phone keyboard added is removed. When it can't log in it now says what Neorcha showed (its message, a verification-code box, or a new-password box) — never the password.",
  ] },
  { v: 485, items: [
    "📱 Neorcha Registrations and DTCM Revenue Fill are now in the phone's More menu (they were only in the computer's side menu). On a phone, Neorcha opens straight to the ☁️ cloud way.",
    "🧭 On the computer, Neorcha Registrations now sits under Front Desk (after Purpose of Stay) and DTCM Revenue Fill under Money & Tax (after DTCM) — not at the bottom under Tools.",
  ] },
  { v: 484, items: [
    "☁️ Neorcha with no PC: a robot on GitHub logs in to Neorcha, reads every registration card and saves them in HotelOps — every night at 3:17 by itself, or press Run workflow on GitHub (the GitHub app works on your phone). Set it up once: Neorcha Registrations → ☁️ No PC? Run it in the cloud.",
    "🔐 The Neorcha and HotelOps passwords live only in GitHub's encrypted Secrets — never in HotelOps, never in the code, never in the run's log. It still never reads passport, ID, birth date, e-mail or phone.",
    "📱 The cards now sync: collected on the desk PC or in the cloud, they show on every device (your phone too), ready for Link to Purpose of Stay.",
  ] },
  { v: 483, items: [
    "🛠 Neorcha \"its card did not open\" fixed: the collector now clicks the confirmation-number cell (Neorcha's own viewGuestDocument) and waits for the card to show that confirmation number — the way HotelOps' older Neorcha Extractor does on the real site. It used to click the row's first box instead.",
    "🌍 Nationality is now read from Neorcha's Country field too, the page size goes to the biggest choice, and it stops by itself on the last page.",
    "🔄 Helper downloaded on v480 or later? Nothing to do — it picks this up by itself (with \"Allow User Scripts\" on). Older helper: download it once more. Then reload HotelOps and press ▶ Start again.",
  ] },
  { v: 482, items: [
    "🧹 DTCM filler on the portal: new 🧹 Clear and ↻ Refill buttons for the chosen days. Clear puts 0 in every box of those days and saves; Refill types the finance figures again and saves, even if they already match. Both ask first.",
    "✏️ Change before filling is fully flexible now: Put 0, Set to any number, or Back to the sheet's figure — for a column or a whole day, all days or just some. A later change wins, so \"TD Fee 0 on all days, but the sheet on day 5\" works.",
    "👆 Click any figure in the table to change just that one (leave it empty for the sheet's figure).",
  ] },
  { v: 481, items: [
    "✏️ DTCM Revenue Fill: new \"Change before filling\" box. Put 0 in any column (e.g. all TD Fee) or a whole day, for all days or just some (type all, 5, or 1-5, 9). Add as many changes as you need; each shows as a chip you can ✕ to undo. The rest stays exactly as on the sheet.",
    "👀 The table shows each changed figure as 0 next to the sheet's crossed-out number (amber), and the totals follow. Copy the filler again after a change — it fills, checks and saves those zeros like any other figure.",
  ] },
  { v: 480, items: [
    "🛠 Neorcha: \"its card did not open\" — the collector now tries every way a row can open its card (a click, a double-click, the link, the confirmation number) and remembers the one that works, so the next rows go fast.",
    "📋 If no way works, it stops after 2 rows (instead of trying every row) and asks for the 📋 Report. The report now shows how a row is built, with every letter turned to x and every digit to 9 — no guest data.",
    "🔄 One more download, then Neorcha collector fixes reach the helper by themselves (like the Opera reader). Download the helper once more, unzip over the old one, press ↻ in chrome://extensions — and keep \"Allow User Scripts\" on for it.",
  ] },
  { v: 479, items: [
    "🛠 Fixed: ▶ Start on Neorcha Registrations did nothing — the helper read the dates wrong and dropped the job. Download the helper once more, unzip it over the old one, and press ↻ on it in chrome://extensions.",
    "🔗 New box: your hotel's Neorcha link. It starts as the ibis one; each hotel can put its own (it must be a myneorcha.com link) and HotelOps remembers it per hotel. Start opens that link.",
    "🧹 The CSV export steps are gone: the collector opens each confirmation one by one itself. The file drop now lives only under \"Run it by hand\".",
    "💬 If the helper ever doesn't answer within a few seconds, the page now says so and gives you an \"Open Neorcha myself\" button — after you log in there, it starts by itself. With an old helper you get a Download button right there.",
  ] },
  { v: 478, items: [
    "🤖 Neorcha now collects by itself. On Neorcha Registrations pick the arrival dates and press ▶ Start: Neorcha opens, you log in, and the helper does the rest — it opens Guest Documents, searches your dates, opens every confirmation, reads its card, turns the pages, and sends the cards straight here. No file, no console, no pasting.",
    "🔒 It reads purpose of visit, nationality, room, dates, adults/children and whether the guest is an ALL member. Passport and ID numbers, birth dates, emails and phones are never read. Your Neorcha password is never seen or kept — you type it yourself.",
    "⬇️ One time only: download the helper again (Settings → WhatsApp helper → Download) and reload it in chrome://extensions, so it is allowed on Neorcha. No helper on a PC? \"Run it by hand\" still works.",
  ] },
  { v: 477, items: [
    "🪪 New page: Neorcha Registrations (Front Desk, after Purpose of Stay). In Neorcha → Guest Documents, search your dates and press Export Excel → CSV (All), then drop the file here. You see the month: cards, guests, ALL members, purpose of visit, top nationalities, and who checked guests in.",
    "🔗 One tap links it to Purpose of Stay: each guest's own purpose (Business / Leisure / Flight), and their nationality where it's still empty, matched by confirmation number, else room and name. Passport and ID numbers, birth dates, emails and phones are never read.",
  ] },
  { v: 476, items: [
    "🎨 Fixed the staff card in the Roster builder: the Health tiles were squeezed into thin strips because Room Health's styles (same names) reached them. Now it's a clean card: the score ring, 8 readable tiles in rows of 4, and What would help underneath.",
  ] },
  { v: 475, items: [
    "🔎 Global search finds much more: words inside room notes and Departures notes (“umbrella” finds the room), today's Handover Book, HK requests and WhatsApp messages, Lost & found and maintenance from the Front Office Log, Gym & Pool members and Room Health issues. Each result shows the matching words and opens where it lives.",
  ] },
  { v: 474, items: [
    "↻ DTCM Revenue Fill, refill made easy: when finance sends a corrected sheet, load it, paste the new filler and press Check. The days that changed are chosen for you and the button becomes “▶ Fix 2 changed days”; only those are updated.",
    "💾 New switch “Re-save every chosen day”: opens, fills and saves the chosen days again even when they already match.",
  ] },
  { v: 473, items: [
    "🌍 Nationality Report: a new Nationality check box, like Beds per room. 🔴 New names the sheet doesn't know come with the best guess already picked: tap ✓, or choose the row (or Unknown). 🟡 Names matched by spelling are confirmed once. 🔵 The team's saved choices can be changed or ✕ forgotten, so a wrong old choice (like “DO NOT USE → UAE”) is found and fixed fast. Every choice is saved for the team and the report updates at once.",
  ] },
  { v: 472, items: [
    "🔧 DTCM Revenue Fill reads every day of the PDF: days with a negative figure (4 and 30 Dec, written “- 35,810”) were skipped before. A lone “-” counts as 0.",
    "0️⃣ Negative figures → 0 (on by default): a negative month-end figure goes into the portal as 0. The page lists each one (4 Dec TD −35,810 → 0) and the table shows the sheet's number next to the 0. Untick it to fill them as they are.",
    "✨ DTCM Revenue Fill looks pro: a 3-step guide (Load → Review → Fill) and colour-coded cards. On the portal, the box has live counters (saved, already right, differs, left), a progress bar, a day grid coloured by each day's state, a test-mode switch, a minimise button and an activity log.",
  ] },
  { v: 471, items: [
    "🧪 DTCM Revenue Fill, test mode: tick “Fill into the month shown on this page” and the sheet's days go into the month on the portal by day number (the sheet's day 1 → the page's day 1). The confirm message says which month it writes into. For real, leave it off.",
  ] },
  { v: 470, items: [
    "📅 DTCM Revenue Fill: choose the days. In the portal box, tap the days (or type 1, 1-5, 1, 3, 8-10); All is the whole month. Check and Fill touch only those days. A good first try: fill day 1 only, look at it on the portal, then fill the rest.",
  ] },
  { v: 469, items: [
    "🏛️ New: DTCM Revenue Fill (Night Audit, under DTCM). Drop finance's “Daily data for DTCM” sheet (Excel, or its PDF): it shows the month, the totals and anything odd (missing days, negative month-end lines).",
    "⚡ Then it fills the DTCM portal for you: copy the filler, paste it in the portal's console (or use the bookmark). 🔍 Check compares every day; ▶ Fill all fills each day, presses Update and checks it saved. Days that already match are skipped, and it stops at the first day the portal refuses.",
  ] },
  { v: 468, items: [
    "❓ Rented Rooms & Beds asks you: a room type it hasn't seen for this hotel is marked NEW, with “how many beds in each?”. Type the number, or tap ✓ if the guess is right, and it's remembered. The preview shows real dates even without History Forecast.",
    "🏨 Smarter guess: it reads the number of beds from the room's description (“2 Single Beds” → 2) and already knows our Ibis Styles and Mercure codes (SGC, TWC, KGD, TWD, KGB, KGBCI). The Mercure Room Type report works on its own too.",
  ] },
  { v: 467, items: [
    "🛏️ Rented Rooms & Beds works for any hotel: the Room Type Statistics report alone is enough when it's exported with every room type. Rooms = all types added up; beds = each type × its beds per room (e.g. 108 King + 25 Twin × 2 = 158). History Forecast is optional; when you give both, the rooms are cross-checked.",
    "🔢 New “Beds per room” box: every room type in the file, with its number of beds (Twin 2, others 1 to start). Change it for your hotel (a triple = 3) and it's remembered for that hotel.",
  ] },
  { v: 466, items: [
    "🛠️ No more half-updated pages: a missing file is always fetched fresh from the server, and the app also checks that the stylesheet matches the version, not just the scripts. If it doesn't, it clears its cache and reloads once (this was why Rented Rooms & Beds looked broken).",
  ] },
  { v: 465, items: [
    "🌍 Nationality Report fixed: when two Opera names go into the same row of your sheet (for example “DO NOT USE” you once put on UAE), their numbers now add up. Before, the second replaced the first, so the UAE lost its own 18 arrivals. The copy now matches Opera exactly: 2,027 · 4,123 · 6,125.",
  ] },
  { v: 464, items: [
    "🛠️ Fixed “natPickFile is not defined”: GitHub can hand out an old copy of a file for a few minutes after an update, and the app kept it. Each version is now fetched fresh, and if the page and its scripts are ever from different versions, the app clears its cache and reloads once by itself.",
    "🛏️ Rented Rooms & Beds: 📂 Browse or drop both files (History Forecast + Room Type Statistics; the Room Type PDF works too). Only the twin rows count as extra beds, added up per day. Each line shows its real date (e.g. Fri 31 Oct: 133 rooms, 25 twin → 158 beds), so you can see which row of your sheet it is.",
  ] },
  { v: 463, items: [
    "🌍 Nationality Report: 📂 Browse or drop the Opera file (stat_countrybymon) and it's read at once; pasting still works.",
    "🧮 The numbers match Opera: “DO NOT USE” (Opera's retired codes) counts as Unknown, and Unknown is merged into the country you choose (UAE by default, remembered). The gap boxes now show what is really in the copy: ✓ 0 when everything is placed.",
    "📋 Copy: choose the columns (Arrivals, Room nights, Guest nights). It shows what the copy adds up to, so you can check your sheet's Total row. The layout is cleaner and works on a phone.",
  ] },
  { v: 462, items: [
    "🗂️ Room notes are tidier: back-to-back automatic entries (status changes, undos, “Extension marked…”) fold into one line, like “6 changes · Extended ×2 · Undone ×2”. Tap Show to open them; 🕘 Activity still lists each one.",
    "🤝 No more tug-of-war on extensions: WhatsApp and the Opera check now use the same 18 minutes. Once Opera has held a room back as “not extended yet” today, WhatsApp keeps it at ⏳ Extending. An extension you tap by hand is never undone automatically; it waits in the Opera box for you to decide.",
  ] },
  { v: 461, items: [
    "🗒️ Departures → a room's Notes now shows everything about the room in one timeline: your notes plus the WhatsApp chat, Handover Book, HK requests, maintenance, lost & found, wake-up calls and gym. New filters: 🕘 Activity, 💬 WhatsApp, 📎 Around the app. ↗ opens the item where it lives.",
    "🧾 Every change says where it came from and who made it: “✓ Checked out · via WhatsApp chat · Sam”, “via Opera · auto”, or by hand with your name. A room added to the board gets a first note saying how it was added.",
    "💳 A tiny balance left after check-out (AED 1 or less, a rounding or manual adjustment) counts as settled: no more “checked out but owes AED 0.26” alerts.",
    "⚡ Lighter and faster: when you open the app it no longer downloads all its ~115 files again in the background (about 3 requests instead of ~120 — easier on hotel wifi and phone data). The sidebar and top bar also re-measure the page less often.",
  ] },
  { v: 460, items: [
    "📊 The Opera reader knows Folio History (past invoices) now. It's a known list, not guests to read, so it no longer sends a “stuck” report for it.",
  ] },
  { v: 459, items: [
    "📊 Skip The Clean → 📊 Track sheet: a professional sheet for your manager of every guest you credited, in Excel (colours, filters, totals) or PDF. Pick the period (this month, last month, all time or your own dates), one line per credit or per guest, the sort and the columns.",
    "🧾 Each guest says why they were credited: the days they asked to skip housekeeping, the housekeeping sheet and days × points. There's also a day-by-day sheet to check, a summary (totals, by staff, by day), sign-off lines and an optional cost in AED. 📋 Email text writes the message for you. Works without loading any file; your settings are remembered.",
  ] },
  { v: 458, items: [
    "📡 A room extended on WhatsApp after Opera was read is now picked up. While Opera's Departures read is fresh (30 min), the board is compared with it again every 1½ minutes and every time the reader sees the screen again. So a ⏳ Extending room that Opera doesn't have leaving today becomes Extended by itself, like 208.",
  ] },
  { v: 457, items: [
    "📡 Departures follows Opera's Departures screen more closely. A room marked 🤔 May extend that Opera no longer lists as leaving today is now marked Extended by itself, the same as ⏳ Extending. It used to stay in To do, so the board showed more rooms than Opera (18 instead of 13).",
  ] },
  { v: 456, items: [
    "🚫 PM rooms (9000 and up) are off Departures. They're Opera's posting accounts, not guests leaving, so they're skipped when you load the departure report, can't be added by hand, and any already on today's board are removed. In-House no longer suggests adding them either.",
  ] },
  { v: 455, items: [
    "🎨 New look for every menu, text box and label in the app. Menus open as a clean rounded list with a ✓ on the chosen option (Chrome / Edge). Text boxes have soft edges and a gold glow when you type. Labels are clearer, and checkboxes and date pickers match the dark or light theme.",
  ] },
  { v: 454, items: [
    "✍️ Upsells added by hand are fine. In Package Audit, pick ✍️ Manual sale on that row (keep the IN-Gauge seller, or pick a name). It's never flagged again, and My Upsells now counts it too instead of saying “nobody can be credited”.",
  ] },
  { v: 453, items: [
    "🛏️ In-House Guests: Opera's PM rooms (9000 and up, posting accounts) are no longer counted as occupied rooms or guests, so Rooms occupied can't go above the hotel's rooms any more. They're kept apart: a “PM rooms” chip lists them, and their balance shows separately under Open balances.",
  ] },
  { v: 452, items: [
    "📊 The Opera reader knows the Report Parameters screen now (From / To Date, Sort Order…). It's report settings, not guests, so it no longer sends a “stuck” report for it.",
  ] },
  { v: 451, items: [
    "📡 Opera decides extensions now. When Opera is read that day, “extended” on WhatsApp only marks the room ⏳ Extending (the guest may pay later). It becomes Extended when the room is cleared from Opera's Departures — that's the confirmation. A room marked extended here but still leaving today in Opera goes back to ⏳ Extending by itself.",
    "💬 Without the Opera reader that day, WhatsApp works as before (it's the only source).",
  ] },
  { v: 450, items: [
    "🎨 Choose how phone alerts look: Settings → 📲 Phone notifications → Alert style — Detailed (title, details and a small footer with the type and time), Compact (one line) or Minimal (plain words, no emojis). A live preview shows exactly how it will look; 🧪 Send a test to see it on your phone.",
  ] },
  { v: 449, items: [
    "🧭 Opera reader, taught from today's reports: inside a reservation it no longer reports the side tables (Payment Instructions, memberships, daily rate details, packages, the assign-room list) — card and membership-card tables are skipped completely. “Available Room Search” is known as a room screen and its room statuses are read (a room cell like “0412KING…” still gives 0412). Opera's Reports screen no longer counts as an unknown screen.",
  ] },
  { v: 448, items: [
    "🛡 One tap for everything: the new “🛡 I'm away” button in the top bar (on the phone too, and first in More) locks Opera, locks WhatsApp Web and turns on the WhatsApp alerts at once. It shows “🔒 Away · tap when back” while on — one tap again and everything unlocks. Shortcut: Ctrl+Alt+L, or say “I'm away”.",
    "🔒 WhatsApp Web now locks too, with the same dark lock screen and the same PIN as Opera (a PIN unlocks both).",
    "🧩 The lock no longer needs HotelOps open: the helper remembers you're away, so any new Opera or WhatsApp tab locks at once.",
    "🚨 Phone alerts if the helper is removed from the PC, or switched off while you're away. The guard cards show “Helper: on ✓ / switched off ⚠”. A locked tab that goes silent is reported in about a minute.",
    "👉 Get the helper once more (📡 Opera → Get the helper, unzip over the same folder, ↻ in chrome://extensions) — the new lock-without-HotelOps and removal alerts need it. Tip: turn on “Allow in Incognito” for the helper, and press Windows + L when you step away.",
  ] },
  { v: 447, items: [
    "✨ Smooth animations everywhere: pages fade and rise in (on the phone they slide the way you tapped), lists and cards glide in when a page opens (not again on every live update), a checked-out room glows green, ticks draw themselves in, numbers count up, pop-ups and messages open and close softly, and buttons press gently. 🎉 Confetti when all departures are out (once a day).",
    "⚙️ Settings → Appearance → Animations: Full / Subtle (soft fades only) / Off. They never slow a tap or a save, and they're off by themselves if your device asks for reduced motion.",
  ] },
  { v: 446, items: [
    "🛡 Opera Away guard: when you're away (the same “I'm away” as the WhatsApp guard, or 📡 Opera → 🔒 Lock Opera now), a solid dark lock screen covers Opera — nothing behind it can be seen, and clicks and typing never reach Opera. Unlock with your PIN at the desk, or “I'm back” / Unlock in HotelOps.",
    "📲 Anyone at your desk is reported to your phone at once: touching the lock screen, typing a PIN, a wrong PIN (3 wrong = locked for 60 s), trying to remove the lock (it comes straight back), or the Opera tab being closed. Set your PIN once on the 📡 Opera page (only a secure hash is stored). Optional: lock Opera by itself after 5–30 minutes without use.",
  ] },
  { v: 445, items: [
    "🧭 Opera reader, taught from your reports: the Assign-Room list next to Arrivals is read as a room list (no more “nothing useful” report), “Manage Reservation” is known as the search form (not a reservation it can't read), and columns like Last Room, Reservation Type, I Want To…, Queue Priority, Display Color and Property are no longer mistaken for other fields. Opera's “Hello, …” greeting is no longer read as a table.",
  ] },
  { v: 444, items: [
    "✨ Updates ask first now: when a new version is ready, a small bar says “New version ready · Update now / Later”. Tap Update now and it reloads straight away (back on the same page). Ignore it or tap Later and it updates by itself at a quiet moment — when the app is in the background, or nobody has touched it for 3 minutes.",
  ] },
  { v: 443, items: [
    "🔧 Opera reader: the new logo is now drawn without touching the page's HTML (keeps the reader strictly read-only).",
  ] },
  { v: 442, items: [
    "✨ The Opera reader's badge and window now use the real HotelOps logo (the white H on the indigo tile) — no more dark circle with an emoji. A small dot shows if it's linked, a small number what it read.",
  ] },
  { v: 441, items: [
    "📡 The Opera vs Departures box is now one small line at the top of Departures — e.g. “Opera 6 · HotelOps 8 · 8 out — 4 to check  Review ›”. Tap it to see the rooms; ✕ closes it again. The full list stays on the 📡 Opera page.",
  ] },
  { v: 440, items: [
    "📡 Opera vs Departures is right now: Opera's Departures list only shows guests still to leave, so rooms already out on your board are no longer counted as differences (no more “14 vs 32”). A room still due here but missing in Opera is shown as “probably left already” with Mark out first — and “Mark all out” for the whole group (asks first, with Undo).",
    "🔁 “Moved to another room” only when it's really the same reservation (confirmation number, or the exact full name only one room has) — a common name like Mohamed no longer matches the wrong guest.",
    "⏳ New: rooms you marked out here but still due out in Opera are flagged — “check the guest out in Opera too”.",
    "🎨 The box is redesigned: grouped (probably left, stayed on, moved, only in Opera…), one clear button per room, long groups fold to 3 with “Show all”, and the normal app font in every style.",
  ] },
  { v: 439, items: [
    "📡 Opera Departures vs HotelOps: open Departures in Opera and a box at the top of HotelOps Departures says e.g. “Opera: 15 departures · HotelOps: 16 — 1 difference”, names the room and the likely reason (extended, moved, cancelled, left early) with one-tap Mark extended / Remove / Keep / Add / Fix name. It never removes a room by itself, and if it hasn't seen the whole Opera list it asks you to scroll to the end first.",
    "🧭 The Opera reader now understands your real Opera Cloud screens: it ignores Opera's menus and page layout (no more false “couldn't read” reports), recognises a reservation, a guest profile, rates, Queue rooms and check-in by their headings, and reads the reservation and profile fields (arrival, departure, room, rate, nights, nationality, membership, VIP…). In House shown as cards is read one guest per card.",
    "🛟 The old “couldn't read” reports are cleared. If a screen is still missed, the new report shows the real guest list or form (layout only, no guest details) — Copy for Claude and send it to me.",
  ] },
  { v: 438, items: [
    "📡 Opera page redesigned: a clear “Linked to Opera” header with status chips (helper, auto-updates, address), four tiles (read today, changes, open bills, routines), a clean live table with coloured statuses, bills with amounts, and sections that fold away. It now looks right in every app style, including Notepad.",
    "🔗 Opera now fills the gaps everywhere: morning brief (rooms leaving with money owing, VIPs, traces, dirty/OOO rooms), shift handover, a 📡 Opera tile on Home, and search finds what Opera showed (with the balance).",
    "🧠 Guest Memory takes VIP, membership and nationality from Opera into empty fields (owners and managers). The night checklist suggests the tick when Opera shows the night audit done, wake-up traces become one-tap wake-up calls, and front office traces become Handover suggestions — nothing is ticked or added without your tap.",
    "🧾 DTCM and Tourism Tax get an “Opera vs DTCM today” check (missing rooms, different nights, departures still open) with lists to copy. In-House fills empty room type, rate, VIP, membership, nationality, ETD and balance from Opera (marked 📡). Arrivals vs Departures uses Opera when your report is missing or older, and Opera's no-shows and cancellations become one-tap suggestions on the No-Show page.",
  ] },
  { v: 437, items: [
    "⬇ The Opera page always shows the helper download now. If your helper is older than v436, a gold “Get the new helper (once)” button appears right under 🟢 Open Opera — you need it once for the new Opera window and the linking fix.",
  ] },
  { v: 436, items: [
    "📡 Opera has its own page now (menu → Front Desk → 📡 Opera): a big 🟢 Open Opera button that opens Opera in its own window like WhatsApp Web, what Opera is showing right now, today's changes with Undo, open bills, what it learned from you, and its settings.",
    "🪟 A new Opera reader window inside Opera: a proper HotelOps panel with Now / Today / 🛟 Help tabs and a status light. Drag it anywhere, or shrink it to a small round badge (it does that by itself after a minute so it never covers Opera's buttons).",
    "🔗 Fixed “linking to HotelOps…” forever: the most likely cause (the self-updated reader couldn't talk to HotelOps and silenced the working one) is fixed, and when it still can't link, the window tells you why — “HotelOps tab not found”, “reload HotelOps” or “press ↻ on the helper” — with a 🔁 Retry button.",
    "👉 Do this once: Settings → 📡 Opera reader → Get the helper again, unzip over the same folder, press ↻ in chrome://extensions. Then press 🟢 Open Opera and paste your Opera address once — it's saved for your hotel. Owners can set the Opera address for each hotel.",
    "🧠 The Brain asks when Opera shows something it doesn't know (“is the column ‘Unit’ the room?”) — your answer teaches the reader. It also suggests quick fixes: a room checked out in Opera but still due here, bills open near check-out, Opera not read for a while. Always quiet, never pop-ups, silent on your day off.",
    "🛟 Screens it can't read are saved with a 📋 Copy for Claude button — paste it to me and I'll teach the reader. The copy holds the screen's layout only, never guest details.",
  ] },
  { v: 435, items: [
    "📡 The Opera reader now reads much more: bills (folio windows, balances, charges and payments — payment type only), room status (clean / dirty / OOO), guest profiles (VIP, membership), traces and alerts, rates, group rooming lists, night audit, and any other table it sees.",
    "💳 Departures shows each room's Opera balance live: a room due out with money still open gets “💳 balance open” (and one quiet phone reminder near check-out), a zero folio shows Settled, and the room's Opera status shows as a small chip. The room card gets an “📡 Opera” part with status and traces. VIP and membership fill only empty spots — nothing anyone typed is changed.",
    "🧠 It learns from you in Opera: which screens and buttons you use and in what order (e.g. Billing → Post Charge → Settle → Check Out), at what times and how long. The pill quietly says “Usually next: …”, the Brain can tell you your routine, and Departures reminds you to open the bill first when that's your habit. See it, clear it or switch it off: Settings → 📡 Opera reader.",
    "🔒 Card numbers are masked to the last 4 digits before anything leaves Opera; card, CVV, expiry, auth code, PIN, passport and ID columns are dropped; passwords and anything you type are never read. What it learns holds no guest names, rooms or amounts.",
  ] },
  { v: 434, items: [
    "🌴 Day off now switches on by itself: on a day off, PH, vacation or leave on the posted roster (your name in Roster → My shifts), nothing is sent to your phone that day and the Brain stays quiet — no button needed. Need alerts after all? “I'm back” turns them on for the rest of that day. Don't want it automatic? Settings → 📲 Phone notifications → switch off “Day off by itself on my roster days off”. The manual Today / 2 days / More… buttons still work too.",
  ] },
  { v: 433, items: [
    "⚡ The Opera reader never slows Opera down: it waits while you type or click and reads only in the pause, only when the browser is idle, never makes Opera re-draw the page, and reads a busy screen less often. A full read of a 600-room list now takes about 30 ms.",
    "🔧 Opera reader with two HotelOps tabs open: “Review before applying”, its switches and the changes waiting for your OK now work in whichever tab you're in.",
  ] },
  { v: 432, items: [
    "📡 New: the Opera reader — like the WhatsApp one, for Opera Cloud. While Opera is open on the desk PC it reads Arrivals, Departures, In House and reservation details as you look at them, and HotelOps updates itself: rooms checked out are marked out, extensions marked, missing departures and new arrivals added, In-House kept fresh. It tells you what it did (with Undo) and the Brain can answer from it. It only reads — it never clicks or types in Opera.",
    "👉 Turn it on once: Settings → 📡 Opera reader → “Get the helper again (once)”, unzip over the same folder and press ↻ in chrome://extensions, then open Opera Cloud. From then on it updates itself. Don't want it to change things by itself? Switch on “Review before applying”.",
    "🔒 Purpose of Stay rules still hold: PM rooms 9000+ are skipped, Vicas nationality wins, a nationality is only filled when empty, and names or anything you typed are never changed.",
  ] },
  { v: 431, items: [
    "📒 Handover takes from WhatsApp only what's meant for it: a message in your Handover group (on by itself for a group named “handover” or “HO”), or one marked “HO: …”, “#ho” or “handover”. The marker is taken off. Everything else stays out — no more wrong picks and no more “None of these” questions from guesses; and if you do press “None of these”, that message is never asked about again.",
    "🧠 The Brain is calm now: it no longer pops up or pulses by itself — a quiet number on 🧠 shows when it has something, and a tip you've seen isn't shown again. Settings → Ops Brain → Hints: Calm (default) / Normal / Off. Asking it works as always. On a 🌴 day off it stays completely quiet.",
  ] },
  { v: 430, items: [
    "🌍 Purpose of Stay nationality: Vicas first; the Neorcha scraper now only fills a nationality that is empty — if there's already one, it's left as it is.",
  ] },
  { v: 429, items: [
    "🔄 Updates now install themselves, quietly: no bar, no question. The app switches to the new version only when you're not using it — it's in the background, or untouched for 3 minutes with nothing being typed and no window open — and comes back on the same page and spot.",
    "🌴 Day off: Settings → 📲 Phone notifications → 🌴 Day off → Today / 2 days / More… — nothing is sent to your phone (from any of your devices) until 06:00 the morning after. Home shows a small line while it's on, with “I'm back”. The Away guard stays silent too, unless you switch it to still come through.",
  ] },
  { v: 428, items: [
    "📅 Purpose of Stay: the Day and Date are now tomorrow's (the report is sent the next day) — on screen and in the Excel export.",
    "🚫 PM rooms (9000 and up) are left out of Purpose of Stay — when you paste the report, sync from Arrivals, and in the export.",
    "🌍 Nationality: Vicas first; if Vicas doesn't have the guest, the scraper's nationality is used (it now replaces a name guess or a memory value). A nationality you type in yourself is never changed.",
  ] },
  { v: 427, items: [
    "📲 Phone notifications for everything: wake-up calls, overdue shift tasks, the night checklist (TD and night audit), late check-outs and rooms not out, swaps and day-off requests, roster changes, open HK requests, room notes and the away guard — all through your ntfy / Telegram, no new setup.",
    "🧠 Smart, not noisy: only one of your devices sends each alert and never twice; small ones are bundled into one message; shift alerts only while you're on shift; quiet hours hold everything except urgent ones; things still not done get a louder reminder. Turn each kind on or off in Settings → 📲 Phone notifications, with a test button and your last 20 alerts.",
    "📖 New “Words & phrases” page (Tools): every built-in word the app understands — HK & maintenance requests, handover topics, Room Health problems, WhatsApp commands, voice phrases and your team dictionary. Search them, try a message to see how it's read, and (owners and managers) add or remove words — removed ones can be brought back any time.",
  ] },
  { v: 426, items: [
    "🧩 The WhatsApp helper now updates itself. Download it one last time (WhatsApp window → “Get v426”), unzip over the same folder and press ↻ in chrome://extensions. Then click Details on the helper and turn on “Allow User Scripts”. From then on, every HotelOps update reaches the helper on its own — no more downloading and re-adding it.",
    "🔁 When a new reader arrives, WhatsApp Web restarts into it only when nobody is using that window (it's in the background, or untouched for 2 minutes), so it never interrupts you mid-chat.",
  ] },
  { v: 425, items: [
    "🔄 No more refreshing like crazy: when you come back to the app it no longer reloads itself because an update arrived — a small bar offers the update instead, and it also loads on its own the next time you open the app. Update checks are now at most every 10 minutes.",
    "📍 Back where you were: if your phone closed the app in the background, it now reopens on the same page and the same spot you scrolled to (within 30 minutes). Opening it from a notification still goes to that notification's page.",
  ] },
  { v: 424, items: [
    "🎨 Handover: the “New handover item” box is one clean field again in every app style (Discord, Telegram, Notes…) — no box inside a box, a small “Auto” pill for the topic, and the field lights up when you type in it.",
  ] },
  { v: 423, items: [
    "🛡️ Away guard — faster and sharper. When you've marked yourself away, an alert now reaches your phone in well under a second (it used to wait ~2.5 s). Urgent things (someone typing, searching, opening a chat) are instant; repeat updates come every ~20 s while it keeps happening.",
    "⌨️ It now tells you WHAT they are typing: the alert shows the words as they write them, e.g. ⌨️ typing: “send me the OTP code now” · Mom — plus which chat they opened and what they searched. Only what they do and the chat name leave the PC; the messages on the screen stay in HotelOps.",
    "👉 This lives in the WhatsApp reader, so update it once: one-click helper → HotelOps shows “a new version is ready”, download, unzip over the same folder, press ↻ in chrome://extensions. Console copy → copy it again from HotelOps.",
  ] },
  { v: 422, items: [
    "🧠 Save to Memory is for owners and managers only: the button shows only for them, and the automatic save after importing emails runs only for them too. No unlock needed.",
  ] },
  { v: 421, items: [
    "🧠 “Save to Memory” (Arrivals, Purpose of Stay) works straight away — no unlocking Guest Memory first. Saving only adds the loaded guests and shows nobody's data. Opening, reading, editing, exporting and deleting stay behind the lock.",
  ] },
  { v: 420, items: [
    "🔒 Guest Memory on a computer: the owner can open it now. Before, it needed a Face ID / fingerprint built into the device, so a PC without Windows Hello could never open it. Now: Windows Hello / Touch ID if the PC has it, 📱 your phone (a QR code, confirm with Face ID), or 🔑 your HotelOps sign-in password.",
    "⌨ New ways in on a PC: Ctrl+Alt+M (Ctrl+Shift+M is Chrome's own “switch profile” key, so Chrome swallowed it), a “🔒 Open” button in Settings (owner only), or hold the HotelOps logo.",
  ] },
  { v: 419, items: [
    "⚡ WhatsApp Web is smooth again with the HotelOps reader running. It was re-reading the whole chat and saving several times a second while you typed (every letter changed the message box). Now it ignores the box you type in and the search box, waits until you pause typing, re-reads only the part that changed (the open chat or the chat list), skips messages it already read, and saves only when something changed. While typing 60 letters it went from about 5,000 page lookups and 85 saves to none.",
    "Every feature stays: new messages, edits, deleted messages, chat-list previews, sending from HotelOps, the Away guard — and a full check every 30 s as a safety net.",
    "👉 Using the one-click helper? HotelOps shows “a new version is ready” — download it again, unzip over the same folder and press ↻ on it in chrome://extensions. Using the console copy? Copy it again from HotelOps.",
  ] },
  { v: 418, items: [
    "✋ Shift tasks: HotelOps never ticks a task by itself any more. When it can see the work looks done (e.g. Purpose of Stay filled for every guest), the task only shows “🤖 Looks done: … ✓ Tick it ✕” — you decide. ✕ means not done: it isn't suggested again that shift.",
  ] },
  { v: 417, items: [
    "✋ Shift tasks: no more ticks by accident. A task is ticked only by a real tap on its circle — not while the page is scrolling, not when your finger slides over it, and not when the list was just redrawn under your finger (a colleague's tick arriving).",
    "🤖 When HotelOps ticks a task itself (it can see the work is done — e.g. Purpose of Stay filled for every guest), the task now says so: “🤖 Ticked by HotelOps: …”. Tap the tick to undo it; it stays unticked for that shift. Settings → Helpers turns this off.",
    "🐛 “Check all your Check-ins” was being read as an ALL (loyalty) enrollment task and could tick itself — fixed: only ALL in capitals counts.",
  ] },
  { v: 416, items: [
    "🛎 Roster: someone is on every front desk, every hour — before health, wishes or fairness. Any hour with nobody on a hotel's desk now counts as a missing shift (even where “cover needed” says 0, and the early hours a night started the day before covers), and the builder fills it.",
    "🚶 Last resort for an empty desk: a colleague from the nearest hotel stands in, only while their own desk stays covered and their rest is kept (their next days move to the same hours if needed). Written under Decisions.",
    "👤 On a staff card, tap the hotel button to choose: 🏨 Stays (moved only if a desk would be empty) → 🚶 Can be moved → 🔒 Never moved. “Never moved” is always respected, and so are 🚫 hotels.",
    "🛋 The weekly day off still always wins: if covering a desk would take someone's only day off, the gap shows as a problem for you to decide.",
  ] },
  { v: 415, items: [
    "📱 Roster on the phone: the whole week fits the screen — Monday to Sunday and the week total, no sideways scrolling. Times sit on two lines (08 over –17), names wrap, the role shows small under the name. On the Roster page and in the builder.",
    "📱 The “My shifts” and “Today” cards on the Roster page no longer run past the right edge of the phone.",
    "📋 Builder: the “What we noticed” list starts folded (the count shows on it), so the roster itself is right there.",
  ] },
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
/** an item → {ico, title, body, does}: a plain line is split as above; a written-out one is { ico, title, what, does } */
function wnItem(i) {
  if (i && typeof i === 'object') return { ico: i.ico || '✨', title: i.title || '', body: i.what || '', does: i.does || '' };
  return Object.assign(wnSplit(i), { does: '' });
}
function wnCard(e, latest) {
  return `<section class="wn-card${latest ? ' latest' : ''}"><div class="wn-chd"><span class="wn-v">v${e.v}</span>${latest ? '<span class="wn-new">Latest</span>' : ''}</div>
    ${e.items.map(i => { const x = wnItem(i); return `<div class="wn-item"><span class="wn-ico" aria-hidden="true">${escapeHtml(x.ico)}</span><div class="wn-txt">${x.title ? `<b>${escapeHtml(x.title)}</b>` : ''}${x.body ? `<span>${escapeHtml(x.body)}</span>` : ''}${x.does ? `<em class="wn-does">✅ ${escapeHtml(x.does)}</em>` : ''}</div></div>`; }).join('')}</section>`;
}
/** the new updates one at a time: a big card each — what changed, and what it does for you — with Back / Next (pure: the slides) */
function wnSlides(list) { const S = []; (list || []).forEach(e => e.items.forEach(i => S.push(Object.assign({ v: e.v }, wnItem(i))))); return S; }
function wnSlideHtml(S, k) {
  const x = S[k];
  return `<div class="wn-prog" aria-hidden="true">${S.map((_, j) => `<i class="${j < k ? 'past' : j === k ? 'now' : ''}"></i>`).join('')}</div>
    <article class="wn-slide" aria-live="polite">
      <div class="wn-sv"><span>v${x.v}</span><span>${k + 1} of ${S.length}</span></div>
      <div class="wn-big" aria-hidden="true">${escapeHtml(x.ico)}</div>
      ${x.title ? `<h3 class="wn-st">${escapeHtml(x.title)}</h3>` : ''}
      ${x.body ? `<div class="wn-sec"><span class="wn-lbl">What changed</span><p>${escapeHtml(x.body)}</p></div>` : ''}
      ${x.does ? `<div class="wn-sec does"><span class="wn-lbl">What it does for you</span><p>${escapeHtml(x.does)}</p></div>` : ''}
    </article>
    <div class="wn-nav"><button class="btn ghost wn-back" type="button"${k ? '' : ' disabled'}>← Back</button>
      <button class="btn gold wn-next" type="button">${k < S.length - 1 ? 'Next →' : 'Got it ✓'}</button></div>
    <button class="wn-aslist" type="button">See them all as a list</button>`;
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
  const S = all ? [] : wnSlides(list).slice(0, 15);   // many missed updates: the newest 15 one by one, the rest in the list ("See them all as a list")
  if (S.length && !wnOpen.asList) {
    let k = 0;
    m.innerHTML = `<div class="fr-sheet wn-sheet wn-story" role="dialog" aria-modal="true" aria-label="What's new">
      <div class="wn-top"><div class="fr-h">✨ What's new <small class="wn-cnt">${S.length} update${S.length === 1 ? '' : 's'} · you are on ${escapeHtml(APP_VERSION)}</small></div><button class="wn-x" type="button" aria-label="Close" title="Close">✕</button></div>
      <div class="wn-stage"></div></div>`;
    const stage = m.querySelector('.wn-stage'), go = j => { k = Math.max(0, Math.min(S.length - 1, j)); stage.innerHTML = wnSlideHtml(S, k); };
    go(0);
    m.addEventListener('click', e => {
      if (e.target.closest('.wn-back')) return go(k - 1);
      if (e.target.closest('.wn-next')) { if (k < S.length - 1) go(k + 1); else m.remove(); return; }
      if (e.target.closest('.wn-aslist')) { wnOpen.asList = true; m.remove(); wnOpen(false); wnOpen.asList = false; return; }
      if (e.target === m || e.target.closest('.wn-x')) m.remove();
    });
    let x0 = null;
    stage.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
    stage.addEventListener('touchend', e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 50) go(k + (dx < 0 ? 1 : -1)); }, { passive: true });
    const key = e => { if (document.getElementById('wnModal') !== m) return; if (e.key === 'Escape') m.remove(); else if (e.key === 'ArrowRight') go(k + 1); else if (e.key === 'ArrowLeft') go(k - 1); };
    document.addEventListener('keydown', key);
    new MutationObserver((_, o) => { if (!m.isConnected) { document.removeEventListener('keydown', key); o.disconnect(); } }).observe(document.body, { childList: true });
    document.body.appendChild(m);
    try { m.querySelector('.wn-next')?.focus({ preventScroll: true }); } catch (_) {}
    try { localStorage.setItem(WN_KEY, APP_VERSION); } catch (_) {}
    return true;
  }
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
