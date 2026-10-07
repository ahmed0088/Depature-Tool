// ═══════════════════════════════════════════════════════════
//  brain-expert.js — Ops Brain, an experienced colleague
//
//  1. Front-office know-how: a library of practical answers (check-in and
//     check-out, payments, OTA cards, no-shows, walking a guest, complaints,
//     cash, privacy, emergencies, Opera how-tos, night audit…). Written as
//     common good practice; where a hotel has its own SOP, the SOP wins,
//     and every answer says so where it matters.
//  2. Works with you like a colleague on shift:
//       "plan my shift"            — today's jobs in order, with live status
//       "remind me at 03:00 to …"  — "remind me in 20 min to …"
//       "wake up 512 at 6:30"      — wake-up calls, shared with the team
//       "note 512 wants …"         — shift notes (go into the handover)
//       "write the handover"       — a handover drafted from what happened
//       "hi", "thanks", "who are you"
//     and greets each new shift once, with the plan.
// ═══════════════════════════════════════════════════════════

const BX_KNOW = [
  // ── Check-in ──
  ['check in steps checkin procedure arrival welcome', 'Checking a guest in, step by step',
   'Greet first, then: <ol><li>Find the reservation and confirm name, dates, room type and rate with the guest.</li><li>Take the ID or passport of <b>every adult</b> staying, not only the booker, and register each one in the system the authorities use (Vicas). Check the name in Opera matches the passport.</li><li>Take the payment guarantee: pre-authorise the card or take the deposit (see "pre-authorisation").</li><li>Fill email, mobile, nationality and purpose of stay; offer ALL enrollment if they are not members.</li><li>Explain breakfast, Wi-Fi, check-out time; offer an upgrade or package if it fits.</li><li>Encode keys only after the room is confirmed clean and inspected.</li></ol>Your hotel\'s SOP wins if it differs.'],
  ['passport id registration immigration vicas every guest', 'Registering guests with ID',
   'Every guest staying, adults and children as your SOP requires, is registered with a valid ID: passport for visitors, Emirates ID for residents and citizens. Keep a scan only in the approved system, never on a phone or a shared drive, and never keep the original document. HotelOps → Immigration Check and Inhouse Tally show who is missing.'],
  ['early check in eci room not ready', 'Early check-in when the room isn\'t ready',
   'Be honest about the time, offer to store luggage, take the guest\'s mobile and message them when the room is ready. Ask housekeeping to prioritise the room. If your hotel sells early check-in, offer it with the price. Never promise a time you can\'t control.'],
  ['upgrade upsell sell room breakfast offer', 'Upselling at the desk',
   'Offer one relevant thing, with a reason: "for AED X more you get the bigger room with the view". Ask after the basics are done, not before. Log every upsell in IN-Gauge under your own name, or the commission goes to someone else (Package Audit checks this).'],
  ['walk in walkin rate no reservation', 'A walk-in guest',
   'Check availability and the best available rate, quote clearly, take full ID and the payment up front (or a pre-authorisation covering the stay plus incidentals), and fill every profile field: walk-ins have no booking data to copy from.'],
  ['group check in rooming list tour', 'Group check-in',
   'Before arrival: get the rooming list, pre-assign rooms, pre-encode keys and prepare key packets with the names. On arrival: collect all passports at once, register them, hand packets to the group leader. Confirm who pays what (master account vs individual extras) before keys go out.'],

  // ── Payments ──
  ['pre authorisation preauth authorization deposit hold card', 'Pre-authorisation (card hold)',
   'A pre-authorisation reserves money on the card without charging it; it is released or settled at check-out. Hold the room charges plus a fixed amount for incidentals per your policy. Tell the guest it is a hold, not a charge. At check-out settle against the same authorisation; release any holds you don\'t use.'],
  ['vcc virtual card ota booking expedia payment charge', 'OTA virtual cards (VCC)',
   'Booking.com, Expedia and others often pay with a virtual card stored on the booking. Charge it only from the activation date and up to the amount shown, and only for what the OTA prepaid (usually room, sometimes breakfast). Extras are paid by the guest directly. Note the VCC in the Opera reservation so the next shift doesn\'t charge the guest twice.'],
  ['card declined payment failed', 'A card is declined',
   'Tell the guest discreetly, away from other guests. Ask for another card or another payment method. Don\'t retry the same card again and again: it can block it. Note it in Opera so the next shift knows.'],
  ['refund overcharge wrong charge correction adjust reverse', 'Correcting a wrong charge in Opera',
   'Same business day: reverse the posting (it disappears from today\'s revenue). An earlier day: post an adjustment with the right transaction code and a clear reason. Never delete or re-key a room charge to hide a mistake. Refunds to cards go back to the same card used to pay.'],
  ['split folio routing company pays window', 'Splitting a bill (routing)',
   'Use routing instructions so charges land on the right folio window automatically: for example room and tax to the company (window 2), extras to the guest (window 1). Set it at check-in, not at check-out, so nothing has to be moved later.'],
  ['cash float count safe drop handling', 'Cash handling',
   'Count your float at the start and end of every shift, with a witness if your SOP requires it. Give change from the drawer, never your pocket. Make safe drops as your SOP says, record each one, and never share safe or drawer codes. A difference is reported at once, not fixed quietly.'],

  // ── Check-out ──
  ['check out steps checkout procedure departure bill folio', 'Checking a guest out',
   '<ol><li>Ask how the stay was, and mean it.</li><li>Check minibar and late charges are posted, then show the folio and let the guest check it.</li><li>Settle against the pre-authorisation or the payment they choose; release unused holds.</li><li>Collect keys, offer to call a taxi or store luggage, and invite them back (ALL points if they are members).</li><li>Mark the room out so housekeeping sees it.</li></ol>In HotelOps the Departures board tracks every room to out.'],
  ['late check out lco charge request', 'Late check-out requests',
   'Check the room isn\'t needed for an early arrival, then agree a time and the price per your policy. Log it on the Departures board (Late CO with the time), so everyone and housekeeping know. If you sell it, add it in IN-Gauge too; mark it as a manual sale in Package Audit if Opera won\'t show it.'],
  ['dispute bill guest disagrees charge minibar', 'A guest disputes a charge',
   'Listen, check the posting details (time, outlet, who posted), and explain calmly. If it is our mistake, adjust it now and apologise. If unsure and the amount is small, a goodwill adjustment often costs less than the argument; above your limit, call the duty manager.'],
  ['express checkout leave key', 'Express check-out',
   'If the guest leaves without coming to the desk: settle the folio against the pre-authorisation, email the invoice, and mark the room out. Check minibar first.'],

  // ── Reservations ──
  ['no show policy guarantee charge first night', 'No-shows',
   'A guaranteed booking that doesn\'t arrive is a no-show after the night audit. Charge as the rate\'s policy says (often the first night), using the guarantee on file; OTA bookings are reported to the OTA instead. Non-guaranteed bookings are released. HotelOps → No-Show Tracker turns the NA40 report into your Excel list.'],
  ['overbooked overbooking walk a guest no room full', 'Walking a guest (no room left)',
   'Decide early in the evening, not at midnight. Book a comparable or better nearby hotel, pay the first night there and the transport, and offer a call home. Choose a guest with a one-night stay, never a loyalty member, VIP or repeat guest. Apologise sincerely and offer to bring them back the next day with a gesture. The duty manager approves it.'],
  ['cancel cancellation cancel booking policy', 'Cancelling a booking',
   'Check the rate\'s cancellation deadline first. Inside the free window: cancel and give the cancellation number. After it: charge as the policy says unless a manager waives it. OTA bookings are cancelled through the OTA, not only in Opera.'],
  ['extend extension stay longer', 'A guest extends',
   'Check availability for the extra nights, quote the rate (it may differ from the original), extend in Opera and update the payment guarantee. On the Departures board mark the room Extended. If the new nights are on a new confirmation, Package Audit keeps credit with the first seller.'],
  ['room move change room swap', 'Moving a guest to another room',
   'Use the room move function in Opera, not check-out and check-in again, so the stay stays one stay (DTCM counts it right). Re-encode keys, tell housekeeping both rooms, and move any traces. Over midnight, DTCM may show the stay split: DTCM Recon explains it.'],

  // ── Guests & service ──
  ['complaint angry upset guest service recovery', 'Handling a complaint',
   'Use LEARN: <b>L</b>isten without interrupting, <b>E</b>mpathise ("I understand how frustrating…"), <b>A</b>pologise for how they feel, <b>R</b>esolve with a clear action and time, <b>N</b>otify (log it and tell the duty manager). Follow up yourself before the guest has to ask again. Never argue, never blame a colleague.'],
  ['vip special guest repeat', 'VIP and repeat guests',
   'Check arrivals for VIPs and members the day before: room pre-assigned and inspected, welcome amenity if your policy has one, greet by name. Note preferences in the Opera profile so the next stay starts right. Gold, Platinum and Diamond ALL members get their benefits without having to ask.'],
  ['privacy guest information confirm staying room number phone', 'Guest privacy',
   'Never confirm that someone is staying, give a room number, or connect a call to a room without the guest\'s permission. Say room numbers quietly, write them on the key packet instead. Keys only after checking ID. Guest lists and passports never leave the hotel\'s systems.'],
  ['lost key card new key replace', 'A guest needs a new key',
   'Check ID first (name and room on the reservation match), then encode a new key. If the guest says the key was lost, encode new keys so the old ones stop working.'],
  ['lost and found item left behind', 'Lost and found',
   'Log every item with date, room, finder and description, and store it securely. Return only after the owner describes it and shows ID. Shipping: the guest pays and gives the address in writing.'],
  ['wake up call alarm morning', 'Wake-up calls',
   'Write the room and time, repeat it back to the guest, and set it. In HotelOps type "wake up 512 at 6:30" in Ops Brain: it alerts everyone on shift at that time.'],
  ['phone call answer etiquette', 'Answering the phone',
   'Answer within three rings, smile (it is heard), say the hotel name and your name, and ask how you can help. Never leave a caller on hold more than 30 seconds without coming back. Take messages with name, number, time and the room it is for.'],
  ['taxi transport airport transfer', 'Taxis and transfers',
   'Ask the guest\'s flight time and terminal and suggest leaving early enough for traffic. Book the taxi or transfer and tell the guest the expected arrival time and the car details if you have them.'],
  ['luggage storage bags', 'Storing luggage',
   'Tag every bag with a numbered ticket, give the guest the matching half, log the room and name, and store it in the locked room. Hand back only against the ticket (or ID if it is lost).'],
  ['medical emergency doctor ill sick', 'A guest is ill or injured',
   'Stay calm, call emergency services (999 for an ambulance in the UAE) if it is serious, and the duty manager. Don\'t give medicines yourself. Send someone to meet the ambulance at the entrance and keep the lift ready.'],
  ['fire alarm evacuation emergency plan', 'Fire alarm and evacuation',
   'Follow your hotel\'s emergency plan. Front desk usually: print or take the in-house guest list from Opera (keep it updated each night for this), check the alarm panel, call the fire brigade (997) if confirmed, and guide guests to the assembly point. Never use lifts.'],

  // ── Night audit ──
  ['night audit steps procedure order end of day how does night audit work what happens in night audit sequence', 'How night audit works, in order',
   'A typical sequence: <ol><li>Check today\'s arrivals are checked in or marked no-show, and departures are out.</li><li>Check in-house balances and room rates; settle or note anything unusual.</li><li>Close cashiers and balance cash.</li><li>Run the end of day in Opera (it posts room and tax and rolls the date).</li><li>Run and file the night reports; update the in-house list for emergencies.</li><li>Then the HotelOps checks: Night Checklist, PM rooms, Immigration, Inhouse Tally, No-shows, DTCM.</li></ol>Your hotel\'s checklist is the authority: it is in HotelOps → Night Checklist.'],
  ['high balance credit limit in house balance', 'High balances in-house',
   'Each night, check guests whose balance is above the pre-authorisation or credit limit. Ask for an additional payment or increase the authorisation the next morning, politely. Long stays: follow Adagio Pro\'s list.'],

  // ── Opera how-to ──
  ['opera trace message alert note reservation', 'Opera: traces and alerts',
   'Use a trace for a task for a department on a date (e.g. "Housekeeping: extra bed at 15:00"). Use an alert for something staff must see when they open the reservation (e.g. "Card declined, collect payment"). Resolve traces when done.'],
  ['opera rate code change rate', 'Opera: changing a rate',
   'Change the rate code, not just the amount, so reports and commissions stay right. If you override the amount, add a reason. Check the package elements (breakfast etc.) follow the new code.'],
  ['opera reinstate cancelled reservation', 'Opera: reinstating a booking',
   'A cancelled booking can be reinstated if the room type is still available: reinstate it rather than creating a new one, so history and the confirmation number stay.'],

  // ── Tourism Dirham ──
  ['tourism dirham rule how much nights cap 30', 'Tourism Dirham, the basics',
   'Dubai charges Tourism Dirham per room per night, at a rate set by the hotel\'s classification (in HotelOps: Settings → Hotel). It stops after 30 consecutive nights of the same stay. DTCM and Opera must tally at month end; DTCM Recon tells you each correction and on which side to make it.'],
];

// ── Shift plan ────────────────────────────────────────────
function _bxShift() { if (typeof hoShiftNow === 'function') return hoShiftNow().key; const h = new Date().getHours(); return h >= 23 || h < 7 ? 'night' : h < 15 ? 'morning' : 'afternoon'; }
function _bxSafe(f, d) { try { return f(); } catch (_) { return d; } }
function bxPlan() {
  const k = _bxShift();
  const S = (cond, txt) => ({ ok: cond === true, todo: cond === false, txt });
  const dep = _bxSafe(() => depRooms.length ? S(depRooms.every(r => ['out', 'extended'].includes(r.status)), `${depRooms.filter(r => r.status === 'out').length}/${depRooms.length} out${depRooms.some(r => r.status === 'late') ? ' · late check-outs open' : ''}`) : S(false, 'not loaded yet'), S(null, ''));
  const arr = _bxSafe(() => arrGuests.length ? S(!arrGuests.some(g => !g.nat || !g.email), `${arrGuests.length} guests · ${arrGuests.filter(g => !g.nat).length} no nationality · ${arrGuests.filter(g => !g.email).length} no email`) : S(false, 'not loaded yet'), S(null, ''));
  const pur = _bxSafe(() => purposeGuests.length ? S(!purposeGuests.some(g => !g.originOfTravel), `${purposeGuests.length} guests · ${purposeGuests.filter(g => !g.originOfTravel).length} without origin`) : S(false, 'not started'), S(null, ''));
  const sh = _bxSafe(() => { const s = SHIFTS[k]; return S(s.done.length >= s.tasks.length, `${s.done.length}/${s.tasks.length} ticked`); }, S(null, ''));
  const cl = _bxSafe(() => { const a = CL_STEPS.filter(s => !clState.skipped.has(s.id)), d = a.filter(s => clState.done.has(s.id)).length; return S(d >= a.length, `${d}/${a.length} steps`); }, S(null, ''));
  const dt = _bxSafe(() => dtcRecon ? S(!!(dtcRecon.gap && dtcRecon.gap.monthEnd && dtcRecon.gap.monthEnd.equal) && !((dtcRecon.actions || []).length - dtcDone.size > 0), `${Math.max(0, (dtcRecon.actions || []).length - dtcDone.size)} items open`) : S(false, 'not run yet'), S(null, ''));
  const pk = _bxSafe(() => pkgResults.length ? S(true, `${pkgResults.filter(r => !r.pinSkip && (r.verdict === 'deny' || r.verdict === 'review')).length} lines to act on`) : S(false, 'not run yet'), S(null, ''));
  const ns = _bxSafe(() => nsGuests.length ? S(true, `${nsGuests.length} no-shows loaded`) : S(false, 'not loaded yet'), S(null, ''));
  const P = {
    morning: [['shifts', 'Shift tasks', sh], ['departures', 'Departures: follow every room out', dep], ['arrivals', 'Load today\'s arrivals', arr], ['xref', 'Check who extended', S(null, '')]],
    afternoon: [['shifts', 'Shift tasks', sh], ['arrivals', 'Check-ins: nationality and email', arr], ['purpose', 'Purpose of Stay', pur], ['pipeline', 'Guest emails and ALL enrollment', S(null, '')]],
    night: [['checklist', 'Night Checklist', cl], ['audit', 'PM rooms vs the Excel', S(null, '')], ['immig', 'Immigration check', S(null, '')], ['inhouse-tally', 'Opera vs Vicas tally', S(null, '')], ['noshow', 'No-shows from NA40', ns], ['dtcm', 'DTCM vs Opera Tourism Dirham', dt], ['package-audit', 'Package Audit', pk]],
  }[k];
  const d = new Date(), last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  if (d.getDate() >= last - 1) P.push(['nationality', 'Month end: Nationality report, DTCM month-end and commission reports', S(null, '')]);
  return { k, items: P };
}
function bxPlanHtml() {
  const { k, items } = bxPlan();
  const name = (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name || '').split(' ')[0];
  const open = items.filter(i => !i[2].ok).length;
  const notes = bxNotesList(), wakes = bxWakeList().filter(w => !w.done);
  return `<div class="br-kind">🗓 ${k[0].toUpperCase() + k.slice(1)} shift plan</div>
    <div class="br-title">${name ? escapeHtml(name) + ', ' : ''}${open ? `${open} thing${open > 1 ? 's' : ''} to do, in this order:` : 'everything on the plan is done 👌'}</div>
    <div class="bx-plan">${items.map(([page, t, s], i) => `<button class="bx-step ${s.ok ? 'ok' : s.todo ? 'todo' : ''}" onclick="brClose();showPanel('${page}')"><span>${s.ok ? '✓' : i + 1}</span><b>${escapeHtml(t)}</b><small>${escapeHtml(s.txt || '')}</small></button>`).join('')}</div>
    ${wakes.length ? `<div class="br-title" style="margin-top:10px">⏰ Wake-up calls</div><div class="br-body">${wakes.map(w => `Room ${escapeHtml(w.room)} at ${escapeHtml(w.time)}`).join(' · ')}</div>` : ''}
    ${notes.length ? `<div class="br-title" style="margin-top:10px">📝 Shift notes</div><ul class="ba-ul">${notes.slice(0, 6).map(n => `<li>${escapeHtml(n.text)} <small>— ${escapeHtml(n.by)}, ${escapeHtml(n.time)}</small></li>`).join('')}</ul>` : ''}
    <div class="br-acts"><button class="btn sm" onclick="brAsk('write the handover')">📋 Draft the handover</button></div>`;
}

// ── Notes, reminders, wake-up calls ───────────────────────
let bxNotes = {}, bxWakes = {};
const _bxMe = () => (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || 'Someone';
const _bxHM = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
function bxNotesList() { const since = Date.now() - 18 * 3600e3; return Object.values(bxNotes).filter(n => n && n.at > since).sort((a, b) => b.at - a.at); }
function bxWakeList() { return Object.entries(bxWakes).map(([id, w]) => Object.assign({ id }, w)).filter(w => w && w.at > Date.now() - 6 * 3600e3).sort((a, b) => a.at - b.at); }
function bxAddNote(text) {
  const id = 'n' + Date.now().toString(36);
  bxNotes[id] = { text, by: _bxMe(), at: Date.now(), time: _bxHM(new Date()) };
  if (typeof fbSet === 'function') fbSet('brain/notes/' + id, bxNotes[id]);
  if (typeof logActivity === 'function') try { logActivity('brain_note', text.slice(0, 120)); } catch (_) {}
}
function _bxParseTime(s) {
  s = String(s).trim().toLowerCase();
  let m = s.match(/^in\s+(\d+)\s*(min|mins|minutes|m|hour|hours|hr|h)\b/);
  if (m) return new Date(Date.now() + (+m[1]) * (/^h/.test(m[2]) ? 3600e3 : 60e3));
  m = s.match(/^(?:at\s+)?(\d{1,2})(?::|\.)?(\d{2})?\s*(am|pm)?/);
  if (!m) return null;
  let h = +m[1], mi = +(m[2] || 0);
  if (m[3] === 'pm' && h < 12) h += 12; if (m[3] === 'am' && h === 12) h = 0;
  if (h > 23 || mi > 59) return null;
  const d = new Date(); d.setHours(h, mi, 0, 0);
  if (d.getTime() < Date.now() - 60e3) d.setDate(d.getDate() + 1);
  return d;
}
let bxRem = (() => { try { return JSON.parse(localStorage.getItem('brain_reminders_v1') || '[]'); } catch (_) { return []; } })();
function _bxSaveRem() { try { localStorage.setItem('brain_reminders_v1', JSON.stringify(bxRem)); } catch (_) {} }
function bxTick() {
  const now = Date.now();
  bxRem.filter(r => !r.done && r.at <= now).forEach(r => {
    r.done = true;
    bxAlert('⏰', `Reminder: ${r.text}`, 'Set at ' + r.set);
  });
  _bxSaveRem();
  // a wake-up call rings at its time and again every 5 minutes (up to 3 times) until someone marks it called
  Object.entries(bxWakes).forEach(([id, w]) => {
    if (!w || w.done || w.at > now || w.at < now - 60 * 60e3) return;
    const n = w.alerts || 0;
    if (n >= 3 || (w.lastAlert && now - w.lastAlert < 5 * 60e3)) return;
    w.alerts = n + 1; w.lastAlert = now;
    if (typeof fbUpdate === 'function') fbUpdate('brain/wakeups/' + id, { alerts: w.alerts, lastAlert: now });
    bxAlert('☎️', `Wake-up call now: room ${w.room}${w.name ? ' · ' + w.name : ''} (${w.time})${n ? ' — still not marked called' : ''}`, `Set by ${w.by}${w.note ? ' · ' + w.note : ''}`);
  });
  if (typeof wkRender === 'function' && document.getElementById('panel-wakeups')?.classList.contains('active')) wkRender();
}
function bxAlert(icon, text, why) {
  if (typeof hoAlert === 'function') hoAlert(text, true);
  if (typeof blSay === 'function') blSay({ id: 'bx:' + Date.now(), type: 'heal', tone: 'bad', icon, text, why, acts: [['Done', () => {}]] }, true);
  else showToast(text, 'ok');
}

// ── Handover draft ────────────────────────────────────────
function bxHandover() {
  const { k, items } = bxPlan();
  const L = [`${k[0].toUpperCase() + k.slice(1)} shift handover — ${new Date().toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} — ${_bxMe()}`, ''];
  L.push('Done / status:'); items.forEach(([, t, s]) => L.push(`  ${s.ok ? '✓' : '•'} ${t}${s.txt ? ' — ' + s.txt : ''}`));
  const th = typeof blThink === 'function' ? _bxSafe(() => blThink().filter(t => t.tone !== 'idle'), []) : [];
  if (th.length) { L.push('', 'Still open:'); th.slice(0, 8).forEach(t => L.push('  • ' + t.text)); }
  const w = bxWakeList().filter(x => !x.done); if (w.length) { L.push('', 'Wake-up calls:'); w.forEach(x => L.push(`  • Room ${x.room} at ${x.time}`)); }
  const n = bxNotesList(); if (n.length) { L.push('', 'Notes:'); n.forEach(x => L.push(`  • ${x.text} (${x.by}, ${x.time})`)); }
  return L.join('\n');
}

// ── Commands (they go in front of the others) ─────────────
function _bxOut(html) { const b = document.getElementById('brAnswers'); if (b) b.innerHTML = `<div class="br-card ba-res">${html}</div>`; }
const BX_COMMANDS = [
  { re: /^(hi|hello|hey|salam|salaam|good (morning|evening|afternoon|night))\b/i, ask: true, run: () => { const n = (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name || '').split(' ')[0]; _bxOut(`<div class="br-title">Hi${n ? ' ' + escapeHtml(n) : ''} 👋 Here's your shift.</div>` + bxPlanHtml()); return true; } },
  { re: /^(thanks|thank you|thx|shukran|great|perfect|ok thanks)\b/i, ask: true, run: () => { _bxOut('<div class="br-title">Anytime. I\'m here all shift. 🧠</div>'); return true; } },
  { re: /^(who are you|what are you)/i, ask: true, run: () => { _bxOut('<div class="br-title">I\'m Ops Brain, your colleague inside HotelOps.</div><div class="br-body">I watch today\'s data, plan your shift, answer front-office questions, keep notes, reminders and wake-up calls, draft the handover, and do the routine fixes when you ask. Type <b>what can you do</b> for the list.</div>'); return true; } },
  { re: /^(plan( my)?( shift| day| night)?|what (should|do) i do( now| next)?|what'?s next|my plan|today'?s plan)\s*\??$/i, ask: true, ex: 'plan my shift', does: 'your jobs in order, with live status', run: () => { _bxOut(bxPlanHtml()); return true; } },
  { re: /^remind me\s+(.+?)\s+(?:to|that|about)\s+(.+)$/i, ex: 'remind me at 03:00 to call 512', does: 'a reminder on this device (also "in 20 min")', run: q => {
      const m = q.match(/^remind me\s+(.+?)\s+(?:to|that|about)\s+(.+)$/i); const d = _bxParseTime(m[1]);
      if (!d) { _bxOut('<div class="br-title">When? Try "remind me at 03:00 to …" or "remind me in 20 min to …".</div>'); return true; }
      bxRem.push({ at: d.getTime(), text: m[2], set: _bxHM(new Date()) }); _bxSaveRem();
      _bxOut(`<div class="br-kind">⏰ Reminder set</div><div class="br-title">${escapeHtml(m[2])}</div><div class="br-body">At ${_bxHM(d)}${d.getDate() !== new Date().getDate() ? ' tomorrow' : ''}. I'll chime and pop up here; keep HotelOps open.</div>`); return true; } },
  { re: /^(wake ?up|wakeup)\s+(?:call\s+)?(?:room\s*)?(\d{3,4})\s+(?:at\s+)?(.+)$/i, ex: 'wake up 512 at 6:30', does: 'a wake-up call; everyone on shift is alerted', run: q => {
      const m = q.match(/^(?:wake ?up|wakeup)\s+(?:call\s+)?(?:room\s*)?(\d{3,4})\s+(?:at\s+)?(.+)$/i); const d = _bxParseTime(m[2]);
      if (!d) { _bxOut('<div class="br-title">At what time? e.g. "wake up 512 at 6:30".</div>'); return true; }
      const id = 'w' + Date.now().toString(36); bxWakes[id] = { room: m[1], time: _bxHM(d), at: d.getTime(), by: _bxMe(), done: false };
      if (typeof fbSet === 'function') fbSet('brain/wakeups/' + id, bxWakes[id]);
      if (typeof logActivity === 'function') try { logActivity('wakeup_set', `Room ${m[1]} at ${_bxHM(d)}`); } catch (_) {}
      _bxOut(`<div class="br-kind">☎️ Wake-up call set</div><div class="br-title">Room ${escapeHtml(m[1])} at ${_bxHM(d)}</div><div class="br-body">Everyone on shift with HotelOps open gets the alert at that time.</div>`); return true; } },
  { re: /^(wake ?ups?|wake-up calls?)$/i, ask: true, run: () => { const w = bxWakeList(); _bxOut(w.length ? `<div class="br-title">Wake-up calls</div><ul class="ba-ul">${w.map(x => `<li>Room ${escapeHtml(x.room)} at ${escapeHtml(x.time)} ${x.done ? '✓ done' : ''} <small>— ${escapeHtml(x.by)}</small></li>`).join('')}</ul>` : '<div class="br-title">No wake-up calls set.</div>'); return true; } },
  { re: /^note[:\s]+(.+)$/i, ex: 'note 512 wants a late check-out at 2pm', does: 'a shift note for the team and the handover', run: q => { const t = q.replace(/^note[:\s]+/i, '').trim(); bxAddNote(t); _bxOut(`<div class="br-kind">📝 Noted for the team</div><div class="br-title">${escapeHtml(t)}</div><div class="br-body">It goes into the shift plan and the handover.</div>`); return true; } },
  { re: /^(notes|shift notes|show notes)$/i, ask: true, run: () => { const n = bxNotesList(); _bxOut(n.length ? `<div class="br-title">Shift notes</div><ul class="ba-ul">${n.map(x => `<li>${escapeHtml(x.text)} <small>— ${escapeHtml(x.by)}, ${escapeHtml(x.time)}</small></li>`).join('')}</ul>` : '<div class="br-title">No notes this shift. Type "note …" to add one.</div>'); return true; } },
  { re: /(write|draft|make|prepare).*(handover|hand over)|^handover$/i, ex: 'write the handover', does: 'a handover drafted from today', run: () => { const t = bxHandover(); _bxOut(`<div class="br-kind">📋 Handover draft</div><pre class="bx-pre">${escapeHtml(t)}</pre><div class="br-acts"><button class="btn sm gold" onclick="copyToClipboard(${JSON.stringify(t).replace(/&/g, '&amp;').replace(/\"/g, '&quot;').replace(/</g, '&lt;')}, this, '📋 Copy')">📋 Copy</button></div>`); return true; } },
];

document.addEventListener('DOMContentLoaded', () => {
  // knowledge into the answers
  if (typeof BR_FAQ !== 'undefined') BX_KNOW.forEach(([q, t, a]) => BR_FAQ.push({ q: q + ' ' + q, t, a, go: '', kind: '🎓 Front-office know-how' }));
  // commands in front of the others; the "how" questions stay questions
  if (typeof BA_COMMANDS !== 'undefined') BA_COMMANDS.unshift(...BX_COMMANDS);
  setTimeout(() => {
    if (typeof fbListen === 'function') {
      fbListen('brain/notes', v => { bxNotes = v || {}; });
      fbListen('brain/wakeups', v => { bxWakes = v || {}; if (typeof wkRender === 'function') wkRender(); });
    }
  }, 1600);
  setInterval(bxTick, 20000);
  // a new shift: say hello once, with the plan
  (window.BL_THINKERS = window.BL_THINKERS || []).push(add => {
    if (typeof currentUser === 'undefined' || !currentUser) return;
    const h = new Date().getHours(), k = _bxShift(), day = (typeof hoShiftNow === 'function' ? hoShiftNow().start : new Date(Date.now() - (k === 'night' && h < 7 ? 864e5 : 0))).toDateString();
    const { items } = bxPlan(); const open = items.filter(i => !i[2].ok).length;
    add({ id: 'shiftStart:' + k + ':' + day, type: 'shiftStart', icon: '👋', tone: 'idle', text: `${k[0].toUpperCase() + k.slice(1)} shift: ${open} thing${open === 1 ? '' : 's'} on the plan.`,
      why: 'Your jobs in order, with what is already done.', acts: [['Show the plan', () => { brOpen(); brAsk('plan my shift'); }]] });
  });
});
