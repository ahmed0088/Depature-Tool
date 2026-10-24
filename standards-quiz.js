// ═══════════════════════════════════════════════════════════
//  standards-quiz.js — 🎓 Standards quiz for new staff
//
//  Lives on the Learn page (inserted above the lessons, no edit to
//  learn.js needed). Questions come from two places:
//   1. The Accor Standards library (STD_ITEMS in accor-standards.js):
//      "Which topic says this?" and "Which line belongs to <topic>?",
//      with wrong answers taken from other entries.
//   2. A small hand-written bank of general front-office questions.
//      These are written generically: they are NOT official brand
//      wording. Your hotel's SOP has the final say.
//
//  10 random questions a round, one at a time. Each finished round is
//  saved per person, one entry each:
//    quiz/scores/{personKey}/{id} = { name, score, of, at, topic, miss, seen }
//  Owners and managers see a team board (best, last, tries, weak topics).
//  Global: qzOpen()
// ═══════════════════════════════════════════════════════════
(function () {
  'use strict';

  const ROUND = 10;
  const BOARD_ROLES = ['owner', 'manager'];

  // ── Topics ──────────────────────────────────────────────
  const BANK_TOPICS = [
    { id: 'desk', icon: '🛎️', name: 'Front desk basics' },
    { id: 'safety', icon: '🛡️', name: 'Security & safety' }
  ];
  const stdCats = () => (typeof STD_CATS !== 'undefined' ? STD_CATS : []);
  const stdItems = () => (typeof STD_ITEMS !== 'undefined' ? STD_ITEMS : []);
  function qzTopics() { return BANK_TOPICS.concat(stdCats()); }
  function topicOf(id) {
    return qzTopics().find(t => t.id === id) || (id === 'mix' ? { id: 'mix', icon: '🎲', name: 'Everything' } : { id, icon: '•', name: id });
  }

  // ── Hand-written bank (generic, not official wording) ────
  // [topic, question, right answer, [3 wrong answers], explanation]
  const BANK = [
    ['desk', 'A guest walks up to the desk. What comes first?', 'Greet them with a smile and eye contact, even if you are busy', ['Finish your task, then look up', 'Ask for their booking number straight away', 'Hand them the registration card'], 'Greet first, always. If you are on the phone, a smile and a nod tell the guest you have seen them.'],
    ['desk', 'At check-in, what must you check before handing over the key card?', 'The guest is registered with valid ID and the room is clean and ready', ['The guest has paid for the minibar', 'The guest has a loyalty card', 'The guest has filled a feedback form'], 'No key before registration with ID and a room that is ready (clean and inspected).'],
    ['desk', 'At check-in, how should you tell the guest their room number?', 'Show it on the key card holder or say it quietly, never loudly in the lobby', ['Say it out loud so they remember it', 'Write it on the key card itself', 'Shout it to the bellboy across the lobby'], 'Other people in the lobby should not learn which room a guest is in.'],
    ['desk', 'At check-out, what do you do before closing the bill?', 'Go through the bill with the guest and settle the balance', ['Close it first and print later', 'Ask housekeeping to check the minibar after the guest leaves', 'Only check the room rate'], 'Review the charges with the guest, answer questions and settle in full before the folio is closed.'],
    ['desk', 'A guest says a charge on the bill is wrong. What do you do?', 'Listen, check the posting and explain; correct it or ask your supervisor if it is beyond your authority', ['Remove it at once without checking', 'Tell the guest the system is never wrong', 'Ask the guest to email the hotel later'], 'Check the facts first. Adjust only within your own authority; otherwise involve the supervisor or duty manager.'],
    ['desk', 'What do you write in the shift handover?', 'Everything still open: guest requests, problems, follow-ups and who is waiting for what', ['Only the cash total', 'Nothing, the next shift will see it in the system', 'Only complaints that were solved'], 'The next shift cannot follow up what it does not know about.'],
    ['desk', 'Someone finds a phone in the lobby. What happens to it?', 'Log it (date, time, place, who found it) and store it safely in lost and found', ['Keep it at the desk drawer until someone asks', 'Give it to the first guest who says it is theirs', 'Throw it away after one day'], 'Every found item is logged and kept secure. The owner must prove it is theirs before it is returned.'],
    ['desk', 'How do you answer the hotel phone?', 'Promptly, with a greeting, the hotel name and your name', ['Just say "hello"', 'Let it ring until a colleague takes it', 'Answer with the room number'], 'A clear greeting with the hotel name and your name sounds professional and tells the caller they have the right place.'],
    ['desk', 'What does "LEARN" stand for in complaint handling?', 'Listen, Empathise, Apologise, Resolve, Notify', ['Look, Explain, Argue, Refund, Note', 'Listen, Explain, Accept, Return, Notify', 'Log, Escalate, Answer, Reply, Next'], 'A common way to handle a complaint. Your hotel may use slightly different words, but the order is the same idea.'],
    ['desk', 'What is the first step when a guest complains?', 'Listen without interrupting', ['Explain hotel policy', 'Offer a discount', 'Call the manager straight away'], 'Let the guest finish. People calm down when they feel heard.'],
    ['desk', 'In LEARN, why do you "Notify" at the end?', 'So the right department and your manager know, it is logged and it does not happen again', ['To tell the guest the complaint is closed', 'To warn other hotels about the guest', 'It is only needed for written complaints'], 'Log the complaint and tell the right people so the fix sticks and the next shift knows.'],
    ['desk', 'An angry guest is shouting in a busy lobby. What is best?', 'Stay calm, listen and, if you can, invite them to a quieter spot', ['Raise your voice so they hear you', 'Ignore them until they calm down', 'Tell them to come back later'], 'Stay calm and polite. A quieter spot helps the guest and the other guests.'],
    ['desk', 'Apologising to a guest means…', 'Saying sorry for how they feel and the trouble, then fixing it', ['Admitting it was your own fault', 'Blaming another department', 'Promising a free night'], 'A sincere apology is not blame. It shows you care, then you move to the fix.'],
    ['desk', 'A guest wants a room change. What do you do first?', 'Ask the reason and check what is free that fits', ['Say the hotel is full without checking', 'Move them without asking why', 'Charge an upgrade fee first'], 'The reason often tells you the right fix (noise, view, bed type). Then check availability.'],
    ['desk', 'You take cash from a guest. How do you handle it?', 'Count it in front of the guest, say the amount, and give a receipt', ['Put it straight in the drawer and count later', 'Count it after the guest leaves', 'Give no receipt for small amounts'], 'Counting in front of the guest avoids disputes. Always give a receipt.'],
    ['desk', 'How do you give change?', 'Count it back to the guest', ['Put it on the counter without counting', 'Round it down to save time', 'Keep coins as a tip'], 'Counting change back shows it is correct and avoids mistakes.'],
    ['desk', 'At the end of your shift your cash float is short. What do you do?', 'Count again, then report the difference honestly to your supervisor', ['Put in your own money so it balances', 'Leave it for the next shift', 'Take it from the tip box'], 'Never cover a shortage yourself and never hide it. Report it so it can be traced.'],
    ['desk', 'You think a banknote may be fake. What do you do?', 'Politely refuse it, ask for another way to pay and tell your supervisor', ['Accept it and say nothing', 'Accuse the guest loudly', 'Keep the note and call the guest a thief'], 'Stay polite, do not accuse. Follow your hotel\'s procedure and inform the supervisor.'],
    ['desk', 'You must step away from the desk for a moment. What first?', 'Lock the cash drawer and lock or log off the computer', ['Leave everything open, it is only a minute', 'Ask a guest to watch the desk', 'Put the cash in your pocket'], 'Cash and guest data must never be left open.'],
    ['safety', 'A caller asks for a guest\'s room number. What do you do?', 'Never give it; offer to put the call through to the room', ['Give it if they know the guest\'s name', 'Give it if they say they are family', 'Read out the guest list'], 'Room numbers and guest details are private. Connect the call; the guest decides.'],
    ['safety', 'A guest says they lost their key card and asks for a new one. What do you do?', 'Check who they are (ID or registration details) before making a new key', ['Make one straight away, they look like a guest', 'Give a key to any room that is free', 'Tell them to wait for housekeeping to open the door'], 'Only make a key for a person you have checked is registered in that room.'],
    ['safety', 'Someone asks "Is Mr X staying here?". What do you say?', 'You cannot confirm who is staying; offer to pass on a message', ['Yes, room 512', 'Yes, but he is out now', 'Show them the arrivals list'], 'Do not confirm or deny a guest\'s stay. Offer to take a message.'],
    ['safety', 'The fire alarm goes off. What should guests use to leave the building?', 'The stairs, never the lifts', ['The lifts, they are faster', 'The service lift only', 'Stay in the room and wait'], 'Lifts can stop or take people to the fire floor. Use the stairs and the fire exits.'],
    ['safety', 'During a fire alarm, what does the front desk usually take to the assembly point?', 'The in-house guest list, so everyone can be counted', ['The cash drawer', 'Today\'s arrivals report only', 'Nothing, just leave'], 'The in-house list is how the team checks everyone is out. Follow your hotel\'s emergency plan.'],
    ['safety', 'You find a small fire. What comes first?', 'Raise the alarm and get people away from danger', ['Finish your check-in first', 'Open windows to let the smoke out', 'Post it on the team chat'], 'People first: raise the alarm, help people out, then follow the hotel plan (only fight a small fire if trained and safe).'],
    ['safety', 'In the UAE, which number do you call for an ambulance?', '998', ['999', '997', '911'], 'UAE: 999 Police · 998 Ambulance · 997 Civil Defence (fire). Also inform your duty manager.'],
    ['safety', 'In the UAE, which number calls the police?', '999', ['998', '997', '112'], 'UAE: 999 Police · 998 Ambulance · 997 Civil Defence (fire).'],
    ['safety', 'A guest feels very unwell at the desk. What do you do?', 'Call for medical help and inform the duty manager; stay with the guest', ['Give them medicine from your bag', 'Send them to their room to rest', 'Tell them to find a clinic'], 'Do not give medication. Get medical help and inform the duty manager.'],
    ['safety', 'You see someone who is not a guest walking the guest floors. What do you do?', 'Inform security or the duty manager; greet the person politely if safe', ['Ignore it', 'Chase them out shouting', 'Give them a key card so they can leave'], 'Stay polite and safe. Let security handle it.'],
    // ── facts from the Standards library (each says where it comes from) ──
    ['reg', 'Which ID does a UAE resident show at check-in?', 'Emirates ID', ['Driving licence only', 'A business card', 'No ID is needed for residents'], 'Visitors show a passport (with entry stamp / visa); residents show an Emirates ID. See Standards → Guest registration.'],
    ['reg', 'Who in the room must be registered with ID?', 'Every guest in the room, not only the booker', ['Only the person who booked', 'Only adults who pay', 'Only the first guest of the day'], 'Every guest, including sharers, is registered. See Standards → Guest registration.'],
    ['reg', 'A guest offers to leave their passport as a deposit. What do you do?', 'Politely refuse: scan it and hand it back', ['Keep it in the safe until check-out', 'Keep it overnight only', 'Keep a copy and the original'], 'Hotels must not hold guests\' passports. See Standards → Never keep a guest\'s passport.'],
    ['td', 'How is the Tourism Dirham charged?', 'Per room, per night', ['Per person, per night', 'Once per stay', 'Per booking, per month'], 'Per room, per night of occupancy. See Standards → Tourism Dirham.'],
    ['td', 'After how many consecutive nights does Tourism Dirham stop?', '30 nights', ['7 nights', '14 nights', '60 nights'], 'Maximum 30 consecutive nights per stay; from night 31 there is no Tourism Dirham.'],
    ['td', 'A real day use (in and out the same day). What about Tourism Dirham?', 'Post one night of TD by hand in Opera the same day', ['Nothing, there is no night', 'Charge two nights', 'Only DTCM needs it, not Opera'], 'DTCM counts a day use as one night; the night audit never posts it, so post it by hand.'],
    ['all', 'How many status nights in a year make an ALL Silver member?', '10 nights', ['5 nights', '30 nights', '60 nights'], 'Silver 10 · Gold 30 · Platinum 60 status nights (or the points). See Standards → ALL status levels.'],
    ['all', 'How many status nights in a year make an ALL Gold member?', '30 nights', ['10 nights', '20 nights', '60 nights'], 'Silver 10 · Gold 30 · Platinum 60 status nights (or the points).'],
    ['all', 'A Gold member asks for a room upgrade at ibis Styles. What is true?', 'Room upgrades do not apply at ibis Styles', ['Gold always gets a suite', 'Upgrade is guaranteed for Gold', 'Only on weekends'], 'Upgrades do not apply at ibis Styles (or any hotel without different room categories). Do not promise one.'],
    ['all', 'A guest booked on Booking.com wants ALL points. What do you say?', 'Politely explain that OTA bookings do not earn points; booking direct next time will', ['Add the card, it will earn', 'Promise to add the points by hand', 'Tell them to call Booking.com'], 'Stays booked through third-party OTAs do not earn ALL points.'],
    ['all', 'When are ALL points normally credited?', 'Within 10 days of check-out', ['At check-in', 'At the end of the year', 'Within 24 hours of booking'], 'Points are credited within 10 days of check-out, once the bill is paid in full.']
  ];

  // ── Helpers ─────────────────────────────────────────────
  const esc = s => (typeof escapeHtml === 'function' ? escapeHtml(s) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  function plain(html) {
    return String(html || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  const toast = (m, t) => { if (typeof showToast === 'function') showToast(m, t); };
  const fmtDate = iso => { try { const d = new Date(iso); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' + d.toTimeString().slice(0, 5); } catch (_) { return ''; } };
  const fmtDay = iso => { try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (_) { return ''; } };

  function qzMe() {
    const u = typeof currentUser !== 'undefined' ? currentUser : null;
    const p = typeof currentProfile !== 'undefined' ? currentProfile : null;
    const name = (p && p.name) || (u && (u.displayName || u.email)) || 'Me';
    const raw = (u && u.uid) || (p && (p.uid || p.email || p.name)) || 'guest';
    return { key: qzKey(raw), name, role: (p && p.role) || '' };
  }
  // Firebase keys can't contain . # $ [ ] /
  function qzKey(s) { return String(s || 'guest').replace(/[.#$\[\]\/\s]+/g, '_').slice(0, 120) || 'guest'; }

  // ── Questions ───────────────────────────────────────────
  // From the Standards library. Each point gives up to two questions.
  function qzFromStandards() {
    const items = stdItems();
    const out = [];
    const titles = items.map(it => it.title);
    items.forEach((it, i) => {
      const pts = (it.points || []).map(plain).filter(p => p.length >= 24);
      const sameCat = items.filter((o, j) => j !== i && o.cat === it.cat);
      const others = items.filter((o, j) => j !== i && o.cat !== it.cat);
      pts.forEach((p, k) => {
        // A: which topic says this?
        const wrongT = shuffle(sameCat.map(o => o.title)).concat(shuffle(others.map(o => o.title))).filter(t => t !== it.title);
        if (wrongT.length >= 3 && titles.length >= 4) {
          out.push({
            id: 's' + i + '_' + k + 'a', src: 'std', topic: it.cat, key: 'p' + i + '_' + k,
            q: 'Which topic says this?', quote: p.length > 220 ? p.slice(0, 217) + '…' : p,
            right: it.title, wrong: () => wrongT.slice(0, 3),
            why: `This line is from “${it.title}”.`, ref: it.title
          });
        }
        // B: which line belongs to this topic? (shorter points only)
        if (p.length <= 170) {
          const pool = shuffle(sameCat).concat(shuffle(others))
            .flatMap(o => shuffle((o.points || []).map(plain).filter(x => x.length >= 24 && x.length <= 170)).slice(0, 1));
          if (pool.length >= 3) {
            out.push({
              id: 's' + i + '_' + k + 'b', src: 'std', topic: it.cat, key: 'p' + i + '_' + k,
              q: `Which line belongs to “${it.title}”?`,
              right: p, wrong: () => pool.slice(0, 3),
              why: `“${it.title}” says: ${p}`, ref: it.title
            });
          }
        }
      });
    });
    return out;
  }
  function qzFromBank() {
    return BANK.map((b, i) => ({ id: 'b' + i, src: 'bank', topic: b[0], key: 'b' + i, q: b[1], right: b[2], wrong: () => b[3].slice(), why: b[4] }));
  }
  let _all = null;
  function qzAll() { if (!_all || !_all.length) _all = qzFromBank().concat(qzFromStandards()); return _all; }
  function qzTopicCounts() {
    const c = {}; qzAll().forEach(q => { c[q.topic] = (c[q.topic] || 0) + 1; }); return c;
  }

  /** 10 questions: round-robin across topics so a mixed round has variety; one question per standards line. */
  function qzPick(topic, n) {
    n = n || ROUND;
    const pool = qzAll().filter(q => topic === 'mix' || q.topic === topic);
    const byT = {};
    shuffle(pool).forEach(q => { (byT[q.topic] = byT[q.topic] || []).push(q); });
    // in a mixed round, lean on the general front-office bank a little more
    const order = Object.keys(byT);
    const out = [], usedKey = new Set();
    let guard = 0;
    while (out.length < n && guard++ < 500) {
      let added = false;
      for (const t of shuffle(order)) {
        if (out.length >= n) break;
        const list = byT[t];
        while (list.length) {
          const q = list.shift();
          if (usedKey.has(q.key)) continue;
          usedKey.add(q.key); out.push(q); added = true; break;
        }
      }
      if (!added) break;
    }
    return shuffle(out).map(q => {
      const opts = shuffle([q.right].concat(q.wrong().filter(w => w !== q.right).slice(0, 3)));
      return Object.assign({}, q, { opts, ans: opts.indexOf(q.right) });
    });
  }

  // ── State ───────────────────────────────────────────────
  const S = { view: 'home', topic: 'mix', qs: [], i: 0, picked: [], lastSaved: null, mine: null, board: null, sort: 'best' };
  try { const t = localStorage.getItem('qz_topic_v1'); if (t) S.topic = t; } catch (_) {}

  // ── Styles ──────────────────────────────────────────────
  const CSS = `
  .qz{--qz-a:var(--accent,var(--gold,#e8b84b));margin:0 0 26px;scroll-margin-top:16px}
  .qz *,.qz *::before{box-sizing:border-box}
  .qz-card{background:var(--card);border:1px solid var(--border);border-radius:var(--r,14px);padding:16px 18px}
  .qz-hd{display:flex;align-items:flex-start;gap:12px;justify-content:space-between;flex-wrap:wrap}
  .qz-hd h2{font-size:18px;font-weight:700;margin:0;letter-spacing:-.02em}
  .qz-hd p{font-size:12.5px;color:var(--text2);margin:2px 0 0}
  .qz-me{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
  .qz-stat{background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:8px 12px;min-width:90px}
  .qz-stat b{display:block;font-size:18px;font-family:var(--mono)}
  .qz-stat span{font-size:11px;color:var(--text3)}
  .qz-lbl{font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin:12px 0 6px}
  .qz-chips{display:flex;gap:6px;flex-wrap:wrap}
  .qz-chip{border:1px solid var(--border2);background:transparent;color:var(--text2);border-radius:99px;padding:8px 12px;font-size:12.5px;font-weight:600;cursor:pointer;min-height:36px}
  .qz-chip.on{background:var(--accent-bg,rgba(234,185,74,.12));border-color:var(--qz-a);color:var(--qz-a)}
  .qz-chip small{opacity:.7;font-weight:500;margin-left:3px}
  .qz-go{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
  .qz-big.btn{min-height:48px;padding:0 22px;font-size:15px;font-weight:700;border-radius:12px;cursor:pointer;justify-content:center}
  .qz-ghost{min-height:48px;padding:0 18px;font-size:14px;font-weight:600;border-radius:12px;border:1px solid var(--border2);background:transparent;color:var(--text);cursor:pointer}
  .qz-note{font-size:11.5px;color:var(--text3);margin-top:10px;line-height:1.45}
  .qz-top{display:flex;align-items:center;gap:10px;margin-bottom:12px}
  .qz-top .qz-n{font-size:12px;color:var(--text2);font-weight:600;white-space:nowrap}
  .qz-bar{flex:1;height:8px;border-radius:99px;background:var(--bg2);overflow:hidden}
  .qz-bar i{display:block;height:100%;background:var(--qz-a);border-radius:99px;transition:width .3s}
  .qz-quit{background:none;border:0;color:var(--text3);font-size:12px;cursor:pointer;padding:6px}
  .qz-tp{font-size:11.5px;color:var(--text3);margin-bottom:4px}
  .qz-q{font-size:18px;font-weight:700;line-height:1.35;margin:0 0 10px}
  .qz-quote{border-left:3px solid var(--qz-a);background:var(--card2);padding:10px 12px;border-radius:8px;font-size:14px;line-height:1.45;margin:0 0 12px;color:var(--text)}
  .qz-opts{display:grid;gap:8px}
  .qz-opt{display:flex;gap:10px;align-items:flex-start;text-align:left;width:100%;min-height:56px;padding:12px 14px;border-radius:12px;border:1.5px solid var(--border2);background:var(--card2);color:var(--text);font-size:14.5px;line-height:1.4;cursor:pointer;word-break:break-word}
  .qz-opt:hover:not(:disabled){border-color:var(--qz-a)}
  .qz-opt .qz-k{flex:none;width:26px;height:26px;border-radius:8px;display:grid;place-items:center;background:var(--bg2);font-size:12px;font-weight:700;color:var(--text2)}
  .qz-opt:disabled{cursor:default}
  .qz-opt.ok{border-color:var(--green);background:color-mix(in srgb,var(--green) 14%,var(--card2))}
  .qz-opt.ok .qz-k{background:var(--green);color:#fff}
  .qz-opt.bad{border-color:var(--red);background:color-mix(in srgb,var(--red) 14%,var(--card2))}
  .qz-opt.bad .qz-k{background:var(--red);color:#fff}
  .qz-opt.dim{opacity:.55}
  .qz-fb{margin-top:12px;border-radius:12px;padding:12px 14px;font-size:13.5px;line-height:1.45;border:1px solid var(--border)}
  .qz-fb.ok{border-color:var(--green);background:color-mix(in srgb,var(--green) 10%,transparent)}
  .qz-fb.bad{border-color:var(--red);background:color-mix(in srgb,var(--red) 10%,transparent)}
  .qz-fb b{display:block;font-size:15px;margin-bottom:3px}
  .qz-fb a{color:var(--qz-a);cursor:pointer;text-decoration:underline;font-size:12.5px}
  .qz-next{margin-top:12px;width:100%}
  .qz-res{text-align:center;padding:8px 0}
  .qz-score{font-size:46px;font-weight:800;font-family:var(--mono);line-height:1}
  .qz-score small{font-size:22px;color:var(--text3)}
  .qz-stars{font-size:30px;letter-spacing:4px;margin:8px 0 4px;color:var(--qz-a)}
  .qz-stars .off{color:var(--border2)}
  .qz-msg{font-size:14px;color:var(--text2);margin-bottom:6px}
  .qz-res .qz-go{justify-content:center}
  .qz-rev{margin-top:14px;display:grid;gap:8px;text-align:left}
  .qz-rv{background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:10px 12px;font-size:13px;line-height:1.45}
  .qz-rv .qz-rq{font-weight:700;margin-bottom:4px}
  .qz-rv .qz-ry{color:var(--red)} .qz-rv .qz-rr{color:var(--green)}
  .qz-rv .qz-rw{color:var(--text2);margin-top:4px}
  .qz-hist{display:grid;gap:4px}
  .qz-hrow{display:flex;gap:8px;align-items:center;font-size:12.5px;padding:6px 8px;border-radius:8px;background:var(--card2)}
  .qz-hrow .qz-hs{font-family:var(--mono);font-weight:700;min-width:44px}
  .qz-hrow .qz-ht{flex:1;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .qz-hrow .qz-hd2{color:var(--text3);white-space:nowrap}
  .qz-board{margin-top:14px}
  .qz-bhd{display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:8px}
  .qz-bhd h3{font-size:15px;margin:0}
  .qz-bhd select{background:var(--card2);color:var(--text);border:1px solid var(--border2);border-radius:8px;padding:6px 8px;font-size:12.5px}
  .qz-tbl{width:100%;min-width:0;border-collapse:collapse;font-size:12.5px}
  .qz-tbl th{text-align:left;color:var(--text3);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em;padding:6px 8px;border-bottom:1px solid var(--border)}
  .qz-tbl td{padding:8px;border-bottom:1px solid var(--border);vertical-align:top}
  .qz-tbl td.n{font-family:var(--mono);white-space:nowrap}
  .qz-weak{display:inline-block;font-size:11px;padding:2px 7px;border-radius:99px;background:color-mix(in srgb,var(--red) 14%,transparent);color:var(--red);margin:0 3px 3px 0}
  .qz-empty{color:var(--text3);font-size:12.5px;padding:8px 0}
  @media (max-width:600px){
    .qz-card{padding:14px}
    .qz-q{font-size:16.5px}
    .qz-tbl thead{display:none}
    .qz-tbl,.qz-tbl tbody,.qz-tbl tr,.qz-tbl td{display:block;width:100%;min-width:0}
    .qz-tbl tr{border:1px solid var(--border);border-radius:10px;margin-bottom:8px;padding:6px 4px;background:var(--card2)}
    .qz-tbl td{border:0;padding:3px 8px}
    .qz-tbl td[data-l]::before{content:attr(data-l) ": ";color:var(--text3);font-family:var(--font,inherit);font-size:11.5px}
    .qz-tbl td.who{font-weight:700;font-size:14px}
    .qz-go .qz-big,.qz-go .qz-ghost{flex:1 1 140px}
  }`;

  // ── Render ──────────────────────────────────────────────
  const root = () => document.getElementById('qzRoot');

  function qzRender() {
    const r = root(); if (!r) return;
    if (S.view === 'play') return qzRenderQ();
    if (S.view === 'result') return qzRenderResult(false);
    if (S.view === 'review') return qzRenderResult(true);
    qzRenderHome();
  }

  function myStats() {
    const list = Object.values(S.mine || {}).filter(e => e && typeof e.score === 'number').sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const best = list.reduce((m, e) => { const p = e.of ? e.score / e.of : 0; return !m || p > m.p || (p === m.p && e.at > m.e.at) ? { p, e } : m; }, null);
    return { list, best: best && best.e, tries: list.length };
  }

  function qzRenderHome() {
    const r = root(); if (!r) return;
    const counts = qzTopicCounts();
    const total = qzAll().length;
    const st = myStats();
    const topics = [{ id: 'mix', icon: '🎲', name: 'Everything' }].concat(qzTopics().filter(t => counts[t.id] >= 4));
    if (!topics.some(t => t.id === S.topic)) S.topic = 'mix';
    const me = qzMe();
    r.innerHTML = `<div class="qz-card">
      <div class="qz-hd"><div><h2>🎓 Standards quiz</h2><p>10 quick questions from the Standards and front-office basics. See how much you know, one tap at a time.</p></div></div>
      <div class="qz-me">
        <div class="qz-stat"><b>${st.best ? st.best.score + '/' + st.best.of : '—'}</b><span>Your best</span></div>
        <div class="qz-stat"><b>${st.list[0] ? st.list[0].score + '/' + st.list[0].of : '—'}</b><span>Last time</span></div>
        <div class="qz-stat"><b>${st.tries}</b><span>Tries</span></div>
      </div>
      <div class="qz-lbl">Pick a topic</div>
      <div class="qz-chips" id="qzTopics">${topics.map(t => `<button class="qz-chip ${t.id === S.topic ? 'on' : ''}" data-t="${esc(t.id)}">${t.icon} ${esc(t.name)}<small>${t.id === 'mix' ? total : counts[t.id]}</small></button>`).join('')}</div>
      <div class="qz-go"><button class="btn gold qz-big" id="qzStart">▶ Start quiz</button>${st.tries ? `<button class="qz-ghost" id="qzHistBtn">📜 My history</button>` : ''}</div>
      <div id="qzHist" style="display:none"></div>
      <div class="qz-note">Standards questions come from the Accor Standards page. Front-desk and safety questions are general good practice, not official brand wording: your hotel's SOP comes first. Scores are saved for ${esc(me.name)}.</div>
      <div id="qzBoard" class="qz-board"></div>
    </div>`;
    r.querySelectorAll('#qzTopics .qz-chip').forEach(b => b.onclick = () => { S.topic = b.dataset.t; try { localStorage.setItem('qz_topic_v1', S.topic); } catch (_) {} qzRenderHome(); });
    r.querySelector('#qzStart').onclick = () => qzStart(S.topic);
    const hb = r.querySelector('#qzHistBtn');
    if (hb) hb.onclick = () => { const h = r.querySelector('#qzHist'); const on = h.style.display === 'none'; h.style.display = on ? '' : 'none'; if (on) h.innerHTML = qzHistHtml(st.list); };
    qzBoard();
  }

  function qzHistHtml(list) {
    if (!list.length) return '<div class="qz-empty">No rounds yet.</div>';
    return `<div class="qz-lbl">My last rounds</div><div class="qz-hist">${list.slice(0, 15).map(e => {
      const t = topicOf(e.topic);
      return `<div class="qz-hrow"><span class="qz-hs">${e.score}/${e.of}</span><span class="qz-ht">${t.icon} ${esc(t.name)}</span><span class="qz-hd2">${esc(fmtDate(e.at))}</span></div>`;
    }).join('')}</div>`;
  }

  function qzStart(topic) {
    S.topic = topic || S.topic || 'mix';
    S.qs = qzPick(S.topic, ROUND);
    if (!S.qs.length) { toast('No questions for this topic yet', 'warn'); return; }
    S.i = 0; S.picked = []; S.view = 'play'; S.lastSaved = null;
    qzRender();
    qzScroll();
  }

  function qzRenderQ() {
    const r = root(); if (!r) return;
    const q = S.qs[S.i]; if (!q) { S.view = 'home'; return qzRender(); }
    const done = S.picked[S.i] != null;
    const t = topicOf(q.topic);
    const pick = S.picked[S.i];
    const right = pick === q.ans;
    r.innerHTML = `<div class="qz-card">
      <div class="qz-top"><span class="qz-n">Question ${S.i + 1} of ${S.qs.length}</span><div class="qz-bar"><i style="width:${Math.round((S.i + (done ? 1 : 0)) / S.qs.length * 100)}%"></i></div><button class="qz-quit" id="qzQuit">✕ Stop</button></div>
      <div class="qz-tp">${t.icon} ${esc(t.name)}</div>
      <div class="qz-q">${esc(q.q)}</div>
      ${q.quote ? `<div class="qz-quote">“${esc(q.quote)}”</div>` : ''}
      <div class="qz-opts">${q.opts.map((o, k) => {
        let cls = '';
        if (done) cls = k === q.ans ? 'ok' : k === pick ? 'bad' : 'dim';
        return `<button class="qz-opt ${cls}" data-k="${k}" ${done ? 'disabled' : ''}><span class="qz-k">${'ABCD'[k]}</span><span>${esc(o)}</span></button>`;
      }).join('')}</div>
      ${done ? `<div class="qz-fb ${right ? 'ok' : 'bad'}" id="qzFb"><b>${right ? '✅ Right!' : '❌ Not quite'}</b>${right ? '' : `The answer is: <i>${esc(q.right)}</i><br>`}${esc(q.why)}${q.ref ? ` <a data-ref="${esc(q.ref)}">Read it in Standards</a>` : ''}</div>
      <button class="btn gold qz-big qz-next" id="qzNext">${S.i + 1 < S.qs.length ? 'Next question →' : 'See my score'}</button>` : ''}
    </div>`;
    r.querySelectorAll('.qz-opt').forEach(b => b.onclick = () => qzAnswer(+b.dataset.k));
    r.querySelector('#qzQuit').onclick = () => { if (!S.picked.length || confirm('Stop this round? It will not be saved.')) { S.view = 'home'; qzRender(); } };
    const nx = r.querySelector('#qzNext'); if (nx) { nx.onclick = qzNext; }
    const a = r.querySelector('#qzFb a'); if (a) a.onclick = () => qzReadStd(a.dataset.ref);
  }

  function qzAnswer(k) {
    if (S.view !== 'play' || S.picked[S.i] != null) return;
    S.picked[S.i] = k;
    qzRenderQ();
    const fb = document.getElementById('qzNext');
    if (fb && fb.getBoundingClientRect().bottom > innerHeight) fb.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }

  function qzNext() {
    if (S.picked[S.i] == null) return;
    if (S.i + 1 < S.qs.length) { S.i++; qzRenderQ(); qzScroll(); return; }
    S.view = 'result';
    qzSave();
    qzRender();
    qzScroll();
  }

  function qzScore() { return S.qs.reduce((n, q, i) => n + (S.picked[i] === q.ans ? 1 : 0), 0); }

  async function qzSave() {
    const me = qzMe();
    const of = S.qs.length, score = qzScore();
    const miss = {}, seen = {};
    S.qs.forEach((q, i) => { seen[q.topic] = (seen[q.topic] || 0) + 1; if (S.picked[i] !== q.ans) miss[q.topic] = (miss[q.topic] || 0) + 1; });
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const entry = { name: me.name, score, of, at: new Date().toISOString(), topic: S.topic, miss, seen };
    S.lastSaved = { id, entry };
    S.mine = Object.assign({}, S.mine || {}, { [id]: entry });
    try {
      if (typeof fbSet === 'function') await fbSet('quiz/scores/' + me.key + '/' + id, entry);
      if (typeof logActivity === 'function') logActivity('Standards quiz', `${score}/${of} · ${topicOf(S.topic).name}`);
    } catch (e) { console.warn('[quiz] save', e); toast('Could not save your score', 'err'); }
  }

  function qzRenderResult(review) {
    const r = root(); if (!r) return;
    const of = S.qs.length, score = qzScore();
    const stars = Math.round(score / of * 5);
    const msg = score === of ? 'Perfect! You know your stuff. 🏆' : score >= of * 0.8 ? 'Great job! Nearly all right.' : score >= of * 0.6 ? 'Good. Review the ones you missed and try again.' : 'Keep going: review your mistakes, read the Standards and try again.';
    const st = myStats();
    const isBest = st.best && S.lastSaved && st.best === S.lastSaved.entry && st.tries > 1;
    const wrong = S.qs.map((q, i) => ({ q, i })).filter(x => S.picked[x.i] !== x.q.ans);
    r.innerHTML = `<div class="qz-card"><div class="qz-res">
      <div class="qz-tp">${topicOf(S.topic).icon} ${esc(topicOf(S.topic).name)} · round finished</div>
      <div class="qz-score" id="qzScore">${score}<small>/${of}</small></div>
      <div class="qz-stars" aria-label="${stars} of 5 stars">${'★'.repeat(stars)}<span class="off">${'★'.repeat(5 - stars)}</span></div>
      <div class="qz-msg">${msg}${isBest ? '<br><b>🎉 New personal best!</b>' : ''}</div>
      <div class="qz-msg" style="font-size:12px">Best: ${st.best ? st.best.score + '/' + st.best.of : '—'} · Tries: ${st.tries}</div>
      <div class="qz-go">
        <button class="btn gold qz-big" id="qzAgain">↻ Try again</button>
        ${wrong.length ? `<button class="qz-ghost" id="qzRevBtn">${review ? 'Hide mistakes' : `🔍 Review my mistakes (${wrong.length})`}</button>` : ''}
        <button class="qz-ghost" id="qzHome">Done</button>
      </div>
      ${review ? `<div class="qz-rev" id="qzRev">${wrong.map(({ q, i }) => `<div class="qz-rv">
          <div class="qz-rq">${esc(q.q)}${q.quote ? `<br><span style="font-weight:500">“${esc(q.quote)}”</span>` : ''}</div>
          <div class="qz-ry">✗ You said: ${esc(q.opts[S.picked[i]])}</div>
          <div class="qz-rr">✓ Answer: ${esc(q.right)}</div>
          <div class="qz-rw">${esc(q.why)}</div></div>`).join('')}</div>` : ''}
    </div></div>`;
    r.querySelector('#qzAgain').onclick = () => qzStart(S.topic);
    r.querySelector('#qzHome').onclick = () => { S.view = 'home'; qzRender(); qzLoadMine(); };
    const rb = r.querySelector('#qzRevBtn'); if (rb) rb.onclick = () => { S.view = review ? 'result' : 'review'; qzRender(); };
  }

  function qzReadStd(title) {
    if (typeof showPanel === 'function') showPanel('standards');
    if (typeof stdSetCat === 'function') stdSetCat('everything');
    const box = document.getElementById('stdSearchBox');
    if (box) box.value = title;
    if (typeof stdSearch === 'function') stdSearch(title);
  }

  function qzScroll() {
    const r = root(); if (!r) return;
    const top = r.getBoundingClientRect().top;
    if (top < 0 || top > innerHeight * 0.4) r.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── Data ────────────────────────────────────────────────
  async function qzLoadMine() {
    if (typeof fbGet !== 'function') return;
    try {
      const v = await fbGet('quiz/scores/' + qzMe().key);
      const local = S.mine || {};
      S.mine = Object.assign({}, v && typeof v === 'object' ? v : {}, S.lastSaved ? { [S.lastSaved.id]: S.lastSaved.entry } : {});
      if (S.view === 'home' && JSON.stringify(Object.keys(local).sort()) !== JSON.stringify(Object.keys(S.mine).sort())) qzRenderHome();
    } catch (e) { console.warn('[quiz] load', e); }
  }

  function qzCanBoard() { return BOARD_ROLES.includes(qzMe().role); }

  /** Per-person summary rows from quiz/scores. */
  function qzSummarise(all) {
    const rows = [];
    Object.keys(all || {}).forEach(pk => {
      const es = Object.values((all || {})[pk] || {}).filter(e => e && typeof e.score === 'number' && e.of);
      if (!es.length) return;
      es.sort((a, b) => String(a.at).localeCompare(String(b.at)));
      const last = es[es.length - 1];
      const best = es.reduce((m, e) => (e.score / e.of > m.score / m.of ? e : m), es[0]);
      const miss = {}, seen = {};
      es.forEach(e => {
        Object.entries(e.miss || {}).forEach(([t, n]) => { miss[t] = (miss[t] || 0) + (+n || 0); });
        Object.entries(e.seen || {}).forEach(([t, n]) => { seen[t] = (seen[t] || 0) + (+n || 0); });
      });
      const weak = Object.keys(miss).filter(t => miss[t] >= 2 && miss[t] / Math.max(seen[t] || miss[t], 1) >= 0.34)
        .sort((a, b) => miss[b] / (seen[b] || 1) - miss[a] / (seen[a] || 1)).slice(0, 3);
      rows.push({ key: pk, name: last.name || best.name || pk, best, last, tries: es.length, at: last.at, weak, pct: best.score / best.of });
    });
    return rows;
  }

  async function qzBoard() {
    const box = document.getElementById('qzBoard');
    if (!box) return;
    if (!qzCanBoard() || typeof fbGet !== 'function') { box.innerHTML = ''; return; }
    let all = {};
    try { all = (await fbGet('quiz/scores')) || {}; } catch (_) { all = {}; }
    if (S.lastSaved) { const k = qzMe().key; all = Object.assign({}, all); all[k] = Object.assign({}, all[k] || {}, { [S.lastSaved.id]: S.lastSaved.entry }); }
    S.board = qzSummarise(all);
    qzDrawBoard();
  }

  function qzSorted() {
    const rows = (S.board || []).slice();
    const by = {
      best: (a, b) => b.pct - a.pct || b.tries - a.tries,
      last: (a, b) => b.last.score / b.last.of - a.last.score / a.last.of,
      tries: (a, b) => b.tries - a.tries,
      date: (a, b) => String(b.at).localeCompare(String(a.at)),
      name: (a, b) => String(a.name).localeCompare(String(b.name))
    }[S.sort] || ((a, b) => b.pct - a.pct);
    return rows.sort(by);
  }

  function qzDrawBoard() {
    const box = document.getElementById('qzBoard');
    if (!box) return;
    const rows = qzSorted();
    const weakHtml = r => r.weak.length ? r.weak.map(t => `<span class="qz-weak">${topicOf(t).icon} ${esc(topicOf(t).name)}</span>`).join('') : '<span style="color:var(--text3)">—</span>';
    box.innerHTML = `<div class="qz-bhd"><h3>👥 Team board</h3><div style="display:flex;gap:6px;align-items:center">
        <select id="qzSort" aria-label="Sort">${[['best', 'Best score'], ['last', 'Last score'], ['tries', 'Most tries'], ['date', 'Latest'], ['name', 'Name']].map(([v, l]) => `<option value="${v}" ${S.sort === v ? 'selected' : ''}>Sort: ${l}</option>`).join('')}</select>
        <button class="btn sm" id="qzCopy" ${rows.length ? '' : 'disabled'}>📋 Copy</button></div></div>
      ${rows.length ? `<table class="qz-tbl"><thead><tr><th>Person</th><th>Best</th><th>Last</th><th>Tries</th><th>Last played</th><th>Weak topics</th></tr></thead><tbody>
        ${rows.map(r => `<tr><td class="who">${esc(r.name)}</td><td class="n" data-l="Best">${r.best.score}/${r.best.of}</td><td class="n" data-l="Last">${r.last.score}/${r.last.of}</td><td class="n" data-l="Tries">${r.tries}</td><td data-l="Last played">${esc(fmtDay(r.at))}</td><td data-l="Weak">${weakHtml(r)}</td></tr>`).join('')}
      </tbody></table>` : '<div class="qz-empty">Nobody has played yet. Scores appear here after each round.</div>'}
      <div class="qz-note">Visible to owners and managers. Weak topics = topics where the person missed at least a third of the questions.</div>`;
    const sel = box.querySelector('#qzSort'); sel.onchange = () => { S.sort = sel.value; qzDrawBoard(); };
    const cp = box.querySelector('#qzCopy'); if (cp) cp.onclick = () => {
      const txt = ['Person\tBest\tLast\tTries\tLast played\tWeak topics'].concat(rows.map(r => [r.name, r.best.score + '/' + r.best.of, r.last.score + '/' + r.last.of, r.tries, fmtDay(r.at), r.weak.map(t => topicOf(t).name).join(', ')].join('\t'))).join('\n');
      if (typeof copyToClipboard === 'function') copyToClipboard(txt, cp, '📋 Copy');
      else if (navigator.clipboard) navigator.clipboard.writeText(txt);
      toast('Team board copied', 'ok');
    };
  }

  // ── Keyboard: 1-4 / A-D to answer, Enter for next ───────
  document.addEventListener('keydown', e => {
    if (S.view !== 'play') return;
    const panel = document.getElementById('panel-learn');
    if (panel && !panel.classList.contains('active')) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '')) return;
    const k = e.key.toLowerCase();
    const idx = '1234'.indexOf(k) >= 0 ? '1234'.indexOf(k) : 'abcd'.indexOf(k);
    if (idx >= 0 && k.length === 1 && S.picked[S.i] == null && S.qs[S.i] && idx < S.qs[S.i].opts.length) { e.preventDefault(); qzAnswer(idx); }
    else if (k === 'enter' && S.picked[S.i] != null) { e.preventDefault(); qzNext(); }
  });

  // ── Mount inside the Learn page ─────────────────────────
  function mount() {
    if (document.getElementById('qzRoot')) return true;
    const wrap = document.querySelector('#panel-learn .ln-wrap') || document.getElementById('panel-learn');
    if (!wrap) return false;
    if (!document.getElementById('qz-style')) { const st = document.createElement('style'); st.id = 'qz-style'; st.textContent = CSS; document.head.appendChild(st); }
    const sec = document.createElement('section');
    sec.id = 'qzRoot'; sec.className = 'qz';
    const body = document.getElementById('learnBody');
    if (body && body.parentNode === wrap) wrap.insertBefore(sec, body); else wrap.appendChild(sec);
    const jump = wrap.querySelector('.ln-jump');
    if (jump && !jump.querySelector('[data-qz]')) {
      const a = document.createElement('a'); a.href = '#qzRoot'; a.dataset.qz = '1'; a.textContent = '🎓 Quiz';
      a.onclick = e => { e.preventDefault(); qzOpen(); };
      jump.appendChild(a);
    }
    // refresh "my scores" and the team board each time the Learn page opens
    if (typeof window.learnRender === 'function' && !window.learnRender._qz) {
      const orig = window.learnRender;
      const wrapped = function () { const r = orig.apply(this, arguments); try { if (S.view === 'home') { qzRenderHome(); qzLoadMine(); } } catch (_) {} return r; };
      wrapped._qz = true;
      window.learnRender = wrapped;
    }
    // drawing the quiz builds every question (~0.1 s on a phone): do it when the phone is idle, not while the app opens
    const later = window.requestIdleCallback || (f => setTimeout(f, 1500));
    later(() => { try { qzRender(); qzLoadMine(); } catch (_) {} }, { timeout: 4000 });
    return true;
  }

  function qzOpen(topic) {
    if (typeof showPanel === 'function') showPanel('learn');
    if (typeof closeMobMore === 'function') try { closeMobMore(); } catch (_) {}
    mount();
    if (topic && S.view === 'home') { S.topic = topic; qzRenderHome(); }
    setTimeout(() => { const r = root(); if (r) r.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 120);
  }

  // globals
  window.qzOpen = qzOpen;
  window.qzStart = qzStart;
  window._qz = { S, qzAll, qzPick, qzSummarise, qzKey, qzMe, qzBoard, BANK, mount };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { mount(); });
  else mount();
  // the signed-in profile may arrive after load: refresh once it does
  let tries = 0;
  const iv = setInterval(() => {
    tries++;
    if ((typeof currentProfile !== 'undefined' && currentProfile) || tries > 30) {
      clearInterval(iv);
      if (mount() && S.view === 'home') { qzRenderHome(); qzLoadMine(); }
    }
  }, 1000);
})();
