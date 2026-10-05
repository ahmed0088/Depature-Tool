// ═══════════════════════════════════════════════════════════
//  accor-standards.js — Accor Standards library (searchable)
//
//  Built ONLY from information that is public (Accor / ALL public
//  pages, Dubai rules) plus this hotel's own practice learned from
//  real reconciliations. Accor's internal brand-standard manuals are
//  NOT in here: every entry carries its source and a "check against
//  your manual" note. To add the hotel's own manual later, add
//  entries with kind: 'manual'.
// ═══════════════════════════════════════════════════════════

const STD_KINDS = {
  public: { label: 'Accor public info', cls: 'std-k-public' },
  law:    { label: 'Dubai rule',        cls: 'std-k-law' },
  hotel:  { label: 'Hotel practice',    cls: 'std-k-hotel' },
  manual: { label: 'Accor manual',      cls: 'std-k-manual' },
  app:    { label: 'How the app works', cls: 'std-k-app' }
};

const STD_CATS = [
  { id: 'app',     icon: '📱', name: 'Using this app' },
  { id: 'all',     icon: '💎', name: 'ALL loyalty' },
  { id: 'brand',   icon: '🎨', name: 'ibis Styles brand' },
  { id: 'service', icon: '🤝', name: 'Service culture' },
  { id: 'td',      icon: '🏛️', name: 'Tourism Dirham (DTCM)' },
  { id: 'reg',     icon: '🛂', name: 'Guest registration' }
];

const SRC = {
  allTerms:   { label: 'ALL terms & conditions (Accor)', url: 'https://all.accor.com/a/en/loyalty-program/legal/terms-and-conditions.html' },
  allBenef:   { label: 'ALL status benefits details (Accor)', url: 'https://all.accor.com/loyalty-program/cards-status-benefits-details/index.en.shtml' },
  allGuide:   { label: 'Learn about ALL (Accor)', url: 'https://all.accor.com/a/en/limitless/thematics/travel-tips-guides/learn-about-accor-live-limitless.html' },
  hotelsExc:  { label: 'ALL hotels exception list (Accor)', url: 'https://all.accor.com/a/en/loyalty-program/hotels-exception.html' },
  ibisPlus:   { label: 'ALL Accor+ ibis card (Accor)', url: 'https://ibis.accor.com/en/all-plus-ibis.html' },
  stylesPR:   { label: 'ibis Styles — Accor press', url: 'https://press.accor.com/ibis-styles-travel-by-design' },
  economy:    { label: 'Accor midscale & economy brands', url: 'https://group.accor.com/en/news-stories/midscale-economy-brands-novotel-mercure-ibis' },
  heartist:   { label: 'Our Heartist® ethos (Accor)', url: 'https://group.accor.com/en/group/people-at-our-heart/our-heartist-ethos' },
  tdLaw:      { label: 'Admin. Resolution No. 2 of 2020 — Tourism Dirham (Dubai)', url: 'https://dlp.dubai.gov.ae/Legislation%20Reference/2020/Administrative%20Resolution%20No.%20(2)%20of%202020%20Prescribing%20the%20Rules%20for%20Calculating,%20Collecting,%20and%20Paying%20the%20Tourism%20Dirham%20Fee%20in%20the%20Emirate%20of%20Dubai.html' },
  uaeStay:    { label: 'Where to stay in the UAE (u.ae)', url: 'https://u.ae/en/information-and-services/visiting-and-exploring-the-uae/where-to-stay-in-the-uae' },
  passports:  { label: 'Gulf News — hotels barred from keeping passports', url: 'https://gulfnews.com/uae/hotels-barred-from-keeping-passports-of-guests-1.368882' },
  recon:      { label: 'DTCM Recon tool — from this hotel\'s own reconciliations', url: '' }
};

const STD_ITEMS = [
  // ── Using this app ───────────────────────────────────────
  { cat: 'app', kind: 'app', title: 'Getting started — the basics',
    tags: 'start login help version update search sync theme offline how',
    points: [
      'Every page has a <b>❔ How to use this</b> button at the top — open it the first time you use a page.',
      '<b>Everything is shared live</b> with your colleagues (Firebase): what you load, tick or save, they see too. A green <b>Live</b> pill in the top bar means you are connected.',
      '<b>Ctrl+K</b> (or 🔍) searches every page at once: a room number, a guest name, a checklist step, or a standard like "passport".',
      'The <b>version label</b> (e.g. v95) in the top bar: tap it to load the newest version if something looks out of date.',
      'Three colour themes in the top bar (Night Ops, Opera, Midnight) — pick what is easiest on your eyes.',
      'On a phone, the bottom bar has the main pages; <b>More</b> opens every other page.'
    ],
    src: [] },

  { cat: 'app', kind: 'app', title: 'Daily front-desk pages',
    tags: 'departures arrivals extension purpose of stay pipeline neorcha shift tasks',
    points: [
      '<b>Departures</b> — today\'s departures board. Load the Opera departures report (delimited data); follow up each room until it is checked out.',
      '<b>Arrivals</b> — today\'s arrivals with purpose, nationality and email. Paste or upload the Opera arrivals report.',
      '<b>Arr vs Dep</b> — finds guests who are on both lists = an extension was booked. Load the departures board first.',
      '<b>Purpose of Stay</b> — the night-audit purpose-of-stay list (business / leisure, origin, email).',
      '<b>Guest Pipeline</b> — the daily Neorcha routine: get guest emails, clean the list, fill Purpose of Stay, enroll guests who agreed to join ALL, and log the result.',
      '<b>Shift Tasks</b> — the task list for each shift; tick as you go.'
    ],
    src: [] },

  { cat: 'app', kind: 'app', title: 'Night audit pages',
    tags: 'night audit checklist pm rooms immigration inhouse tally vicas package upsell no show',
    points: [
      '<b>Night Checklist</b> — the night run, step by step, with handover notes and an activity log.',
      '<b>Night Audit · PM Rooms</b> — compares Opera\'s PM room list with the management Excel and shows every difference.',
      '<b>Immigration Check</b> — finds guests missing what immigration needs (nationality, gender, passport, name, email) and rooms with an unregistered guest.',
      '<b>Inhouse Tally</b> — checks Opera and Vicas agree on who is in the hotel.',
      '<b>Package Audit</b> — checks every upsell in IN-Gauge against Opera: what to credit, what to remove, who sold it.',
      '<b>No-Show Tracker</b> — upload the Opera NA40 no-show PDF to get the guest data ready to copy.'
    ],
    src: [] },

  { cat: 'app', kind: 'app', title: 'Tourism Dirham pages — which one when',
    tags: 'tourism tax dtcm recon td 30 day audit portal reconcile',
    points: [
      '<b>Tourism Tax</b> — from the Opera arrivals report: rooms whose date must be corrected in the TD portal (guests checked in after midnight).',
      '<b>DTCM Recon</b> — the main reconciliation: DTCM XML vs the Opera TD journal. It explains every difference, says what to fix in Opera or in the TD portal, and shows the <b>month-end tally</b> (both totals must end equal).',
      '<b>TD 30-Day Audit</b> — finds guests still charged after the 30-night limit (Opera finjrnlbytax report + DTCM XML).',
      'Rules behind all three: see the <b>Tourism Dirham</b> topic on this page.'
    ],
    src: [] },

  { cat: 'app', kind: 'app', title: 'Reports and management pages',
    tags: 'nationality rented rooms beds trends adagio long stay collections reports',
    points: [
      '<b>Nationality Report</b> — guests per country this month (Opera stat_countrybymon).',
      '<b>Rented Rooms & Beds</b> — rooms and beds sold per day (Opera history_forecast + statroomtype).',
      '<b>Trends</b> — how the month is going, built automatically from the reports you already run every day.',
      '<b>Adagio Pro</b> — long-stay collections: balances, cheques and departure risk from the tracking sheet.',
      '<b>Arrivals Processor</b> — turns the Opera arrivals export into a day-by-day breakdown with package codes.'
    ],
    src: [] },

  // ── ALL loyalty ─────────────────────────────────────────
  { cat: 'all', kind: 'public', title: 'ALL status levels and how they are earned',
    tags: 'tier classic silver gold platinum diamond status nights points qualify',
    points: [
      '<b>Classic</b> — on joining.',
      '<b>Silver</b> — 10 status nights or 2,000 status points in a calendar year.',
      '<b>Gold</b> — 30 status nights or 7,000 status points.',
      '<b>Platinum</b> — 60 status nights or 14,000 status points.',
      '<b>Diamond</b> — 26,000 status points.',
      'At <b>ibis Styles</b> (and ibis, Adagio, Mama Shelter, Jo&amp;Joe…) members earn a <b>lower rate</b> of points than at premium brands — about half the status points.'
    ],
    src: [SRC.allBenef, SRC.allGuide] },

  { cat: 'all', kind: 'public', title: 'Tier benefits — and what applies at ibis Styles',
    tags: 'benefit welcome drink late checkout early checkin upgrade amenity lounge breakfast suite',
    points: [
      '<b>Silver</b>: priority welcome, welcome drink, late check-out <i>subject to availability</i>, bonus points on paid stays.',
      '<b>Gold</b>: Silver benefits + early check-in / late check-out <i>subject to availability</i>, welcome amenity, guaranteed room availability (see below), room upgrade.',
      '<b>Platinum</b>: Gold benefits + suite night upgrades, executive lounge where one exists, complimentary breakfast in Asia-Pacific hotels.',
      '<b>Diamond</b>: Platinum benefits + more (e.g. weekend breakfast worldwide).',
      '⚠️ <b>Room upgrades do NOT apply at ibis Styles</b> (nor ibis, Adagio, Jo&amp;Joe or any hotel without different room categories). Do not promise an upgrade at the desk.',
      'Every benefit is <i>subject to availability</i> and to the hotel taking part — recognise the status, offer what the hotel can give, and say so clearly.'
    ],
    src: [SRC.allBenef, SRC.hotelsExc] },

  { cat: 'all', kind: 'public', title: 'Gold+: guaranteed room availability',
    tags: 'guarantee availability 3 days 72 hours gold sold out',
    points: [
      'Gold members (and above) can get a room guaranteed when the hotel shows sold out.',
      'Conditions: booked <b>at least 3 days before arrival, before 12:00 noon hotel time</b>; requested at booking; via Accor channels; at standard / flexible rate (no promotions); <b>one room only</b> (the member\'s own).',
      'It guarantees <b>a room</b>, not a room type.'
    ],
    src: [SRC.allBenef, SRC.allTerms] },

  { cat: 'all', kind: 'public', title: 'Which stays earn points (and which do NOT)',
    tags: 'eligible stay ota expedia booking.com points earn channel rate tour operator',
    points: [
      'Earn: booked at an eligible rate through <b>Accor channels</b> (all.accor.com, the Accor booking office, the hotel itself) or a travel agency connected to Accor.',
      '<b>Do NOT earn</b>: bookings through third-party OTAs (Expedia, Booking.com…), resellers or tour operators. Tell the guest politely; do not add the card to promise points.',
      'The member must give the card number at booking and <b>show it at check-in</b>; the member must be the one staying.',
      'Points are credited <b>within 10 days of check-out</b>, on eligible spend excluding taxes, once the bill is paid in full.'
    ],
    src: [SRC.allTerms] },

  { cat: 'all', kind: 'public', title: 'Recognising members at the desk — checklist',
    tags: 'recognition check-in welcome loyalty card profile enrol',
    points: [
      'At check-in: check the profile for an ALL number; greet by name and mention the status.',
      'Silver+: offer the welcome drink and ask about late check-out (subject to availability).',
      'Gold+: offer early check-in / late check-out if available and the welcome amenity.',
      'Non-member on a direct booking: offer to enrol (free) so the stay can earn.',
      'OTA booking: explain the stay will not earn points; suggest booking direct next time.'
    ],
    note: 'Summarised from the public ALL benefits. Your Accor front-office SOP may set the exact wording and order.',
    src: [SRC.allBenef, SRC.allTerms] },

  { cat: 'all', kind: 'public', title: 'ALL Accor+ ibis subscription card',
    tags: 'subscription card ibis plus paid',
    points: [
      'A paid subscription card for frequent ibis-family guests that comes with its own benefits (it can include a status level such as Gold).',
      'Check the card\'s exact benefits on the guest profile before promising anything.'
    ],
    src: [SRC.ibisPlus] },

  // ── ibis Styles brand ─────────────────────────────────────
  { cat: 'brand', kind: 'public', title: 'ibis Styles — brand promise',
    tags: 'brand promise design theme economy',
    points: [
      'Uniquely <b>themed design hotels</b> in the economy segment: playful, individual, "travel by design".',
      'Guests should find everything they need for a <b>comfortable, effortless</b> stay.',
      'Accor\'s economy brands (ibis, ibis Styles, ibis budget) share three ideas: <b>modernity, simplicity, well-being</b>.'
    ],
    src: [SRC.stylesPR, SRC.economy] },

  { cat: 'brand', kind: 'public', title: 'What the room rate includes',
    tags: 'breakfast wifi included rate',
    points: [
      'ibis Styles positions itself as an <b>all-inclusive</b> economy offer: the rate normally includes <b>breakfast</b> and <b>Wi-Fi</b>.',
      'Check the rate code on each reservation — some rates (e.g. room-only OTA rates) may differ at your hotel.'
    ],
    src: [SRC.stylesPR] },

  // ── Service culture ──────────────────────────────────────
  { cat: 'service', kind: 'public', title: 'Heartist® — Accor\'s service culture',
    tags: 'heartist culture service emotion guest experience',
    points: [
      'Accor calls its people <b>Heartists®</b>: hospitality that comes from the heart, with curiosity and initiative.',
      'Guest experience depends on employee experience: be yourself, take the initiative, make the moment personal.',
      'In practice at the desk: greet first, use the guest\'s name, read the moment, solve the problem yourself where you can.'
    ],
    src: [SRC.heartist] },

  // ── Tourism Dirham (DTCM) ─────────────────────────────────
  { cat: 'td', kind: 'law', title: 'Tourism Dirham — the rule',
    tags: 'tourism dirham fee td dtcm det 30 nights rate per room',
    points: [
      'Charged <b>per room, per night</b> of occupancy — not per person.',
      'Amount by hotel category: 5★ AED 20 · 4★ AED 15 · <b>3★ AED 10</b> · 1-2★ / hotel apartments AED 7. This hotel posts <b>AED 10</b>.',
      '<b>Maximum 30 consecutive nights</b> per stay; from night 31 no Tourism Dirham.',
      'The hotel collects it and reports / pays it to Dubai\'s Department of Economy and Tourism (DET / DTCM portal).'
    ],
    src: [SRC.tdLaw, SRC.uaeStay] },

  { cat: 'td', kind: 'hotel', title: 'Day use — always counted',
    tags: 'day use dayuse manual posting 7510 tally',
    points: [
      'DTCM charges <b>one night of Tourism Dirham for every real day use</b> (check-in and check-out the same day) — your hotel\'s rate, see DTCM Recon → ⚙ Hotel TD settings.',
      'The Opera night audit <b>never</b> posts Tourism Dirham for a day use (there is no night).',
      '→ Post <b>one night of TD by hand</b> in Opera (your hotel\'s TD code and rate) on the same business date for every real day use, or the month will not tally.'
    ],
    src: [SRC.recon] },

  { cat: 'td', kind: 'hotel', title: '"Charge Extra Night on Early Check-In" — when to tick it',
    tags: 'early check in tick extra night midnight audit',
    points: [
      'Guest arrives <b>between midnight and the night audit</b> (about 04:00-04:20): <b>do NOT tick</b>. DTCM already counts the night before by itself, exactly like Opera. Ticking it charges a night nobody stayed.',
      'Guest arrives <b>after the audit</b> (early morning) on a day-use booking you charge: <b>tick it</b>, so DTCM carries that day use.',
      'Check the next DTCM XML: the stay must show one extra night of TD.'
    ],
    src: [SRC.recon] },

  { cat: 'td', kind: 'hotel', title: 'Late check-out tick',
    tags: 'late check out tick extra night',
    points: [
      '"Late check-out" in DTCM adds a night. Tick it only if the late check-out was charged and your rule says it pays Tourism Dirham — and then post that night\'s TD in Opera too.',
      'A free late check-out: leave it unticked.'
    ],
    src: [SRC.recon] },

  { cat: 'td', kind: 'hotel', title: 'Check-ins made by mistake',
    tags: 'mistake wrong check in cancel re-check-in helpdesk',
    points: [
      'Same guest checked out and checked in again in the same room the same day, or a check-in of a few minutes: this is a <b>mistake, not a day use</b>.',
      'Cancel it in DTCM <b>straight away, while it is still open</b> (Cancel Check-In). Once checked out the portal locks it and only the TD helpdesk can cancel it.',
      'Never post a mistaken check-in in Opera.',
      'Guest checked out by mistake? Re-open the original stay instead of creating a new check-in.'
    ],
    src: [SRC.recon] },

  { cat: 'td', kind: 'hotel', title: 'Month-end: DTCM must equal Opera',
    tags: 'month end tally reconcile total',
    points: [
      'At month end the DTCM XML total and the Opera Tourism Dirham journal must be equal.',
      'Run both files through <b>DTCM Recon</b>: the "Month-end tally" box shows where both totals land once every item is closed, and each item says whether to fix it in Opera or in the TD portal.',
      'Fix DTCM items while the stay is still open — a checked-out stay can no longer be edited in the portal.'
    ],
    src: [SRC.recon] },

  // ── Guest registration ───────────────────────────────────
  { cat: 'reg', kind: 'law', title: 'Every guest is registered with ID',
    tags: 'registration passport emirates id scan police every guest sharer',
    points: [
      'Every guest in the room — not only the booker — must be registered with a valid ID: <b>passport</b> (with entry stamp / visa) for visitors, <b>Emirates ID</b> for residents.',
      'The document is scanned into the authorities\' system at check-in.',
      'Sharers count: add each one to the DTCM check-in as well (the DTCM screen lists every guest "In Room").'
    ],
    note: 'From public UAE guidance and reports; your hotel\'s security procedure has the exact steps.',
    src: [SRC.uaeStay] },

  { cat: 'reg', kind: 'law', title: 'Never keep a guest\'s passport',
    tags: 'passport keep hold deposit',
    points: [
      'Hotels must <b>not hold guests\' passports</b> (not as a deposit, not overnight). Scan it and hand it back.',
      'Only judicial authorities, or cases set by law, may hold a passport.'
    ],
    src: [SRC.passports] }
];

let stdCat = 'everything';
let stdQuery = '';

function stdRender() {
  const list = document.getElementById('stdList');
  if (!list) return;
  const q = stdQuery.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const strip = s => String(s).replace(/<[^>]+>/g, '').toLowerCase();
  const items = STD_ITEMS.filter(it => {
    if (stdCat !== 'everything' && it.cat !== stdCat) return false;
    if (!words.length) return true;
    const hay = (it.title + ' ' + it.tags + ' ' + it.points.map(strip).join(' ') + ' ' + (it.note || '')).toLowerCase();
    return words.every(w => hay.includes(w));
  });

  document.querySelectorAll('#stdCats .std-chip').forEach(b => b.classList.toggle('on', b.dataset.cat === stdCat));
  const count = document.getElementById('stdCount');
  if (count) count.textContent = `${items.length} of ${STD_ITEMS.length}`;

  if (!items.length) {
    list.innerHTML = `<div class="card" style="text-align:center;padding:30px;color:var(--text3);font-size:.8rem;">Nothing matches "${escapeHtml(stdQuery)}".</div>`;
    return;
  }
  const catOf = id => STD_CATS.find(c => c.id === id) || { icon: '', name: '' };
  list.innerHTML = items.map(it => {
    const k = STD_KINDS[it.kind] || STD_KINDS.public;
    const c = catOf(it.cat);
    const srcs = (it.src || []).map(s => s.url
      ? `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.label)}</a>`
      : `<span>${escapeHtml(s.label)}</span>`).join(' · ');
    return `
      <div class="card std-card">
        <div class="std-card-hd">
          <span class="std-title">${escapeHtml(it.title)}</span>
          <span class="std-kind ${k.cls}">${k.label}</span>
        </div>
        <div class="std-cat">${c.icon} ${escapeHtml(c.name)}</div>
        <ul class="std-points">${it.points.map(p => `<li>${p}</li>`).join('')}</ul>
        ${it.note ? `<div class="std-note">${escapeHtml(it.note)}</div>` : ''}
        ${srcs ? `<div class="std-src">Source: ${srcs}${it.kind === 'public' || it.kind === 'law' ? ' · <i>check against your Accor manual / hotel SOP</i>' : ''}</div>` : ''}
      </div>`;
  }).join('');
}

function stdSetCat(cat) { stdCat = cat; stdRender(); }
function stdSearch(v) { stdQuery = v || ''; stdRender(); }

document.addEventListener('DOMContentLoaded', () => {
  const cats = document.getElementById('stdCats');
  if (cats) {
    cats.innerHTML = [{ id: 'everything', icon: '📚', name: 'Everything' }].concat(STD_CATS)
      .map(c => `<button class="std-chip" data-cat="${c.id}" onclick="stdSetCat('${c.id}')">${c.icon} ${escapeHtml(c.name)}</button>`).join('');
  }
  const badge = document.getElementById('badge-standards');
  if (badge) badge.textContent = STD_ITEMS.length;
  stdRender();
});
