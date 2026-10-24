// ═══════════════════════════════════════════════════════════
//  guest-messages.js — 💌 Guest messages: ready-to-send texts for guests
//  Pick a guest from today's Departures, Arrivals or In-House list (or type
//  one in), pick a message, and it is filled in for you: name, room, dates,
//  balance, Wi-Fi, breakfast, check-out time. English or Arabic (shown right
//  to left) or your own words. Then copy it, open it in WhatsApp or email, or
//  print it. Every send is logged for the team (guestMsgLog/<date>).
//  The hotel's own wording and details are saved for the whole hotel
//  (guestMsgTemplates) — only what differs from the built-in text is stored,
//  so improving a default here reaches every hotel that never changed it.
//  Other pages open it prefilled: hoGuestMsg.open({ room: '204', template: 'checkout' }).
// ═══════════════════════════════════════════════════════════

(function (W) {
  'use strict';
  const doc = W.document, PANEL = 'guest-messages', ROOT = 'guestMsgTemplates';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safe = (f, d) => { try { return f(); } catch (_) { return d; } };
  const $ = id => doc.getElementById(id);
  const toast = (m, t) => { if (typeof showToast === 'function') safe(() => showToast(m, t)); };
  const user = () => safe(() => (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || '', '');
  const role = () => safe(() => (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.role) || '', '');
  const canEdit = () => role() !== 'readonly';
  const dbReady = () => safe(() => typeof _ref !== 'undefined' && !!_ref, false);   // db.js; listening before it exists would only ever read this device's copy
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = () => (typeof hoLocalISO === 'function' ? safe(() => hoLocalISO(), iso(new Date())) : iso(new Date()));   // Dubai day, not UTC
  const LS = { get: (k, d) => { try { const v = localStorage.getItem('gm_' + k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } }, set: (k, v) => { try { localStorage.setItem('gm_' + k, JSON.stringify(v)); } catch (_) {} } };

  // ── the built-in messages (the hotel can change every word in the page) ──
  // A line that ends in a detail nobody filled in ("🔑 Password: {wifi_pass}", "{signature}") is left out
  // of the message, so a hotel that has not set its Wi-Fi yet still sends a clean welcome.
  const TPL = [
    { id: 'prearrival', icon: '🧳', name: 'Pre-arrival welcome',
      subEn: 'Your upcoming stay at {hotel}', subAr: 'إقامتك القادمة في {hotel}',
      en: 'Dear {name},\n\nWe look forward to welcoming you to {hotel} on {arrival} for {stay}.\n\nCheck-in is from {checkin_time}. If you would like to share your arrival time or any special request (early check-in, airport transfer, a quiet room), just reply to this message.\n\nSafe travels, and see you soon!\n{signature}',
      ar: 'عزيزنا {name}،\n\nيسعدنا استقبالك في {hotel} يوم {arrival} لمدة {stay}.\n\nيبدأ تسجيل الدخول من الساعة {checkin_time}. إذا رغبت في إبلاغنا بموعد وصولك أو بأي طلب خاص (تسجيل دخول مبكر، توصيل من المطار، غرفة هادئة)، يُرجى الرد على هذه الرسالة.\n\nنتمنى لك رحلة آمنة، ونراك قريبًا!\n{signature}' },
    { id: 'welcome', icon: '🛎️', name: 'Welcome on check-in',
      subEn: 'Welcome to {hotel}', subAr: 'أهلًا بك في {hotel}',
      en: 'Welcome to {hotel}, {first}! 🌟\n\nYou are in room {room} until {departure}.\n\n📶 Wi-Fi: {wifi}\n🔑 Password: {wifi_pass}\n🍳 Breakfast: {breakfast}\n🕛 Check-out: {checkout_time}\n\nIf you need anything, message us here or call reception from your room phone. Enjoy your stay!\n{signature}',
      ar: 'أهلًا وسهلًا بك في {hotel}، {first}! 🌟\n\nغرفتك رقم {room} حتى {departure}.\n\n📶 شبكة الواي فاي: {wifi}\n🔑 كلمة المرور: {wifi_pass}\n🍳 الإفطار: {breakfast}\n🕛 تسجيل المغادرة: {checkout_time}\n\nإذا احتجت إلى أي شيء، راسلنا هنا أو اتصل بالاستقبال من هاتف غرفتك. نتمنى لك إقامة ممتعة!\n{signature}' },
    { id: 'checkout', icon: '🕛', name: 'Check-out reminder',
      subEn: 'Your check-out from {hotel}', subAr: 'موعد مغادرتك من {hotel}',
      en: 'Good morning {first},\n\nA gentle reminder that check-out for room {room} is on {departure} at {checkout_time}.\n\nNeed a little more time? We can offer a late check-out, subject to availability: just reply and we will check for you. We are also happy to keep your luggage after check-out.\n\nThank you for staying with us!\n{signature}',
      ar: 'صباح الخير {first}،\n\nنود تذكيرك بأن موعد تسجيل المغادرة للغرفة {room} هو {departure} الساعة {checkout_time}.\n\nهل تحتاج إلى وقت إضافي؟ يمكننا أن نوفر لك تسجيل مغادرة متأخر حسب التوفر، فقط رد على هذه الرسالة وسنتحقق لك. كما يسعدنا الاحتفاظ بأمتعتك بعد المغادرة.\n\nشكرًا لإقامتك معنا!\n{signature}' },
    { id: 'lco_offer', icon: '⏰', name: 'Late check-out offer',
      subEn: 'Late check-out at {hotel}', subAr: 'تسجيل مغادرة متأخر في {hotel}',
      en: 'Dear {first},\n\nWould you like a relaxed last morning? We can offer you a late check-out until {late_time} for room {room}, subject to availability.\n💳 Supplement: {price}\n\nJust reply "Yes" and we will arrange it for you.\n{signature}',
      ar: 'عزيزنا {first}،\n\nهل ترغب في صباح هادئ قبل مغادرتك؟ يمكننا أن نوفر لك تسجيل مغادرة متأخر حتى الساعة {late_time} للغرفة {room}، حسب التوفر.\n💳 الرسوم الإضافية: {price}\n\nفقط رد بكلمة "نعم" وسنقوم بترتيب ذلك لك.\n{signature}' },
    { id: 'lco_ok', icon: '✅', name: 'Late check-out approved',
      subEn: 'Your late check-out is confirmed', subAr: 'تم تأكيد تسجيل المغادرة المتأخر',
      en: 'Dear {first},\n\nGood news: your late check-out for room {room} is confirmed until {late_time} on {departure}.\n💳 Supplement: {price}\n\nPlease hand in your key at reception when you leave. Enjoy the extra time!\n{signature}',
      ar: 'عزيزنا {first}،\n\nيسعدنا إبلاغك بتأكيد تسجيل المغادرة المتأخر للغرفة {room} حتى الساعة {late_time} يوم {departure}.\n💳 الرسوم الإضافية: {price}\n\nيُرجى تسليم مفتاح الغرفة إلى الاستقبال عند المغادرة. استمتع بوقتك الإضافي!\n{signature}' },
    { id: 'extend', icon: '📅', name: 'Extension offer',
      subEn: 'Extend your stay at {hotel}', subAr: 'مدّد إقامتك في {hotel}',
      en: 'Dear {first},\n\nWe hope you are enjoying your stay at {hotel}! Your check-out is planned for {departure}.\n\nIf you would like to stay longer, we would be happy to extend your booking for room {room}.\n💳 Rate per night: {price}\n\nJust reply with the number of extra nights and we will check availability for you.\n{signature}',
      ar: 'عزيزنا {first}،\n\nنتمنى أن تكون مستمتعًا بإقامتك في {hotel}! موعد مغادرتك المقرر هو {departure}.\n\nإذا رغبت في تمديد إقامتك، يسعدنا تمديد حجزك للغرفة {room}.\n💳 سعر الليلة: {price}\n\nفقط رد بعدد الليالي الإضافية وسنتحقق من التوفر لك.\n{signature}' },
    { id: 'thanks', icon: '⭐', name: 'Thank you + review',
      subEn: 'Thank you for staying at {hotel}', subAr: 'شكرًا لإقامتك في {hotel}',
      en: 'Dear {first},\n\nThank you for choosing {hotel}. It was a pleasure having you with us, and we hope to welcome you back soon.\n\nIf you have a minute, we would love to hear about your stay. Your review helps other travellers and our team:\n⭐ {review_link}\n\nSafe travels!\n{signature}',
      ar: 'عزيزنا {first}،\n\nشكرًا لاختيارك {hotel}. سعدنا بإقامتك معنا، ونتطلع إلى استقبالك مجددًا قريبًا.\n\nإذا سمح وقتك، يسعدنا أن نعرف رأيك في إقامتك، فتقييمك يساعد المسافرين الآخرين وفريقنا:\n⭐ {review_link}\n\nرحلة سعيدة!\n{signature}' },
    { id: 'balance', icon: '💳', name: 'Payment reminder',
      subEn: 'Your account at {hotel}', subAr: 'حسابك في {hotel}',
      en: 'Dear {first},\n\nWe hope you are having a pleasant stay. A kind reminder that there is an open balance of {balance} on room {room}.\n\nWhenever it suits you, you can settle it at reception by card or cash. If you have already taken care of it, please ignore this message, and thank you!\n{signature}',
      ar: 'عزيزنا {first}،\n\nنتمنى أن تكون إقامتك ممتعة. نود تذكيرك بلطف بوجود رصيد مستحق بقيمة {balance} على الغرفة {room}.\n\nيمكنك تسويته في الوقت المناسب لك لدى الاستقبال نقدًا أو بالبطاقة. إذا كنت قد قمت بالسداد بالفعل، يُرجى تجاهل هذه الرسالة، وشكرًا لك!\n{signature}' },
    { id: 'lostfound', icon: '🔎', name: 'Lost & found',
      subEn: 'We found an item after your stay at {hotel}', subAr: 'عثرنا على غرض بعد إقامتك في {hotel}',
      en: 'Dear {name},\n\nThank you for staying at {hotel}. After your stay in room {room}, our team found an item we believe is yours:\n🔎 {item}\n\nWe are keeping it safe for you. Please reply to let us know whether you would like to collect it or have it sent to you (delivery at your cost).\n{signature}',
      ar: 'عزيزنا {name}،\n\nشكرًا لإقامتك في {hotel}. بعد إقامتك في الغرفة {room}، عثر فريقنا على غرض نعتقد أنه يخصك:\n🔎 {item}\n\nنحتفظ به لك بأمان. يُرجى الرد لإعلامنا إن كنت ترغب في استلامه أو إرساله إليك (تكلفة التوصيل على حسابك).\n{signature}' },
    { id: 'occasion', icon: '🎂', name: 'Birthday / anniversary',
      subEn: 'Happy {occasion} from {hotel}', subAr: '{occasion} من {hotel}',
      en: 'Dear {first},\n\nHappy {occasion}! 🎉 Everyone at {hotel} wishes you a wonderful day.\n\nIf there is anything we can do to make it extra special, just let us know.\n\nWith our warmest wishes,\n{signature}',
      ar: 'عزيزنا {first}،\n\n{occasion}! 🎉 يتمنى لك فريق {hotel} بأكمله يومًا رائعًا.\n\nإذا كان بإمكاننا فعل أي شيء لنجعل يومك أكثر تميزًا، فقط أخبرنا.\n\nمع أطيب التمنيات،\n{signature}' },
  ];
  const T = id => TPL.find(t => t.id === id);

  // the placeholders, for the legend in the editor (and so the editor can insert them)
  const PH = [
    ['name', 'Guest full name'], ['first', 'First name'], ['room', 'Room'], ['arrival', 'Arrival date'], ['departure', 'Departure date'],
    ['nights', 'Nights (number)'], ['stay', '"3 nights"'], ['checkout_time', 'Check-out time'], ['checkin_time', 'Check-in time'], ['late_time', 'Late check-out time'],
    ['hotel', 'Hotel name'], ['balance', 'Balance AED'], ['price', 'Price AED'], ['wifi', 'Wi-Fi network'], ['wifi_pass', 'Wi-Fi password'],
    ['breakfast', 'Breakfast times'], ['review_link', 'Review link'], ['item', 'Found item'], ['occasion', 'Birthday / anniversary'], ['signature', 'Signature'], ['today', 'Today\'s date'],
  ];
  // the ones a message makes no sense without: warned about before sending
  const NEED = new Set(['name', 'first', 'room', 'late_time', 'item', 'balance']);
  // asked for under the template when it uses them (they are not in the guest lists)
  const EXTRA = { late_time: ['Late check-out until', 'time'], price: ['Price (AED)', 'text', 'e.g. 150 — leave empty to leave it out'], item: ['Found item', 'text', 'e.g. black phone charger'], occasion: ['Occasion', 'select'] };
  const OCCASION = { birthday: ['birthday', 'عيد ميلاد سعيد'], anniversary: ['anniversary', 'ذكرى زواج سعيدة'] };
  const SET_DEF = { hotel: '', wifi: '', wifiPass: '', breakfast: '', checkout: '', checkin: '', review: '', sigEn: 'The Front Office team, {hotel}', sigAr: 'فريق الاستقبال، {hotel}' };

  // ── pure helpers (no DOM: tested in tests/run-tests.js style sandboxes) ──
  const MON = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
  /** "24-OCT-26", "2026-10-24", "24/10/2026" → "2026-10-24" ('' when it is not a date) */
  function toISO(v) {
    const s = String(v == null ? '' : v).trim(); let m;
    const ok = (y, mo, d) => { y = +y; if (y < 100) y += 2000; const t = new Date(y, mo, +d); return t.getMonth() === mo && t.getDate() === +d ? iso(t) : ''; };
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return ok(m[1], +m[2] - 1, m[3]);
    if ((m = s.match(/^(\d{1,2})[-\s/.]([A-Za-z]{3})[A-Za-z]*\.?[-\s/.,]+(\d{2,4})/))) { const mo = MON[m[2].toUpperCase()]; return mo == null ? '' : ok(m[3], mo, m[1]); }
    if ((m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/))) return ok(m[3], +m[2] - 1, m[1]);   // dd/mm first (Dubai)
    return '';
  }
  const addDays = (isoS, n) => { const d = new Date(isoS + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };
  function fmtDate(isoS, lang) {
    if (!isoS) return '';
    const d = new Date(isoS + 'T12:00:00'); if (isNaN(d)) return isoS;
    return lang === 'ar' ? safe(() => d.toLocaleDateString('ar-AE-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' }), isoS)
      : safe(() => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }), isoS);
  }
  /** "14:00" → "2 PM" / "2:00 مساءً"; anything else is kept as typed */
  function fmtTime(t, lang) {
    const m = String(t || '').trim().match(/^(\d{1,2})[:.](\d{2})/); if (!m) return String(t || '').trim();
    const h = +m[1] % 24, mm = m[2], h12 = h % 12 || 12;
    if (lang === 'ar') return `${h12}:${mm} ${h === 12 && mm === '00' ? 'ظهرًا' : h < 12 ? 'صباحًا' : 'مساءً'}`;
    return `${h12}${mm === '00' ? '' : ':' + mm} ${h < 12 ? 'AM' : 'PM'}`;
  }
  const money = (v, lang) => { const n = parseFloat(String(v == null ? '' : v).replace(/[^\d.\-]/g, '')); if (!isFinite(n)) return String(v || '').trim(); const s = n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }); return lang === 'ar' ? `${s} درهم` : `AED ${s}`; };
  /** Arabic counts nights in four forms; English in two */
  function stayText(n, lang) {
    n = +n || 0; if (!n) return '';
    if (lang !== 'ar') return n + (n === 1 ? ' night' : ' nights');
    return n === 1 ? 'ليلة واحدة' : n === 2 ? 'ليلتين' : n <= 10 ? n + ' ليالٍ' : n + ' ليلة';
  }
  /** Opera names: "RASMUSSEN, ANNA MRS" → "Anna Rasmussen"; mixed case is kept as written */
  function niceName(raw) {
    let s = String(raw || '').replace(/\s+/g, ' ').trim(); if (!s || s === '—') return '';
    if (s.includes(',')) { const p = s.split(',').map(x => x.trim()).filter(Boolean); s = p.slice(1).concat(p[0]).join(' '); }
    s = s.replace(/\b(?:MR|MRS|MS|MISS|DR|MSTR)\b\.?/gi, '').replace(/\s+/g, ' ').trim();
    if (s === s.toUpperCase()) s = s.toLowerCase().replace(/(^|[\s'\-])(\p{L})/gu, (a, b, c) => b + c.toUpperCase());
    return s;
  }
  const firstOf = n => String(n || '').split(' ')[0] || '';
  /** a phone as typed → digits for wa.me (UAE 05x… gets 971 in front; 00 prefix dropped) */
  function waPhone(p) {
    let d = String(p || '').replace(/[^\d+]/g, ''); if (!d) return '';
    if (d.startsWith('+')) d = d.slice(1); else if (d.startsWith('00')) d = d.slice(2); else if (/^0\d{8,9}$/.test(d)) d = '971' + d.slice(1);
    d = d.replace(/\D/g, ''); return d.length >= 8 ? d : '';
  }
  /**
   * The message with every {placeholder} filled. vals: { key: text } already in the right language.
   * Returns { text, missing: [keys left empty] }. Lines that end in an empty detail are left out;
   * an empty detail in the middle of a sentence stays as {key} so the agent sees it before sending.
   */
  function fill(tpl, vals) {
    const missing = new Set(), out = [];
    String(tpl || '').split('\n').forEach(line => {
      const re = /\{([a-z_]+)\}/g; let m, drop = false;
      while ((m = re.exec(line))) {
        const v = vals[m[1]];
        if (m[1] in vals && (v == null || String(v).trim() === '')) {
          missing.add(m[1]);
          if (/^\s*$/.test(line.slice(m.index + m[0].length).replace(/[.!،,]/g, '')) && line.slice(0, m.index).length <= 34) drop = true;   // "🔑 Password: {wifi_pass}", "{signature}"
        }
      }
      if (drop) return;
      out.push(line.replace(/\{([a-z_]+)\}/g, (a, k) => (k in vals && vals[k] != null && String(vals[k]).trim() !== '') ? String(vals[k]) : a));
    });
    return { text: out.join('\n').replace(/\n{3,}/g, '\n\n').trim(), missing: [...missing] };
  }
  const tokens = s => [...new Set((String(s || '').match(/\{([a-z_]+)\}/g) || []).map(x => x.slice(1, -1)))];

  // ── state ──
  const st = {
    src: LS.get('src', 'dep'), q: '', g: blank(), tpl: LS.get('tpl', 'checkout'), lang: LS.get('lang', 'en'),
    extra: { late_time: '', price: '', item: '', occasion: 'birthday' }, other: '', edited: null,
    saved: {}, log: [], logDay: '', edTpl: 'checkout', edLang: 'en', mounted: false,
  };
  if (!['dep', 'arr', 'ih', 'man'].includes(st.src)) st.src = 'dep';
  if (!['en', 'ar', 'other'].includes(st.lang)) st.lang = 'en';
  if (!TPL.some(t => t.id === st.tpl)) st.tpl = 'checkout';
  function blank() { return { key: '', src: 'man', room: '', name: '', phone: '', email: '', arrival: '', departure: '', nights: '', balance: '', late: '' }; }
  const cfg = () => Object.assign({}, SET_DEF, (st.saved && st.saved.settings) || {});
  /** a template's text in one language: the hotel's own wording, else the built-in one */
  function tplText(id, lang, field) {
    const t = T(id) || TPL[0], own = safe(() => st.saved.tpl[id] || {}, {});
    const k = field === 'sub' ? (lang === 'ar' ? 'subAr' : 'subEn') : (lang === 'ar' ? 'ar' : 'en');
    return typeof own[k] === 'string' && own[k].trim() ? own[k] : t[k];
  }

  // ── today's guests from the other pages (each [] when that page has nothing loaded) ──
  const depRows = () => safe(() => (typeof depRooms !== 'undefined' && depRooms || []).slice(), []);
  const arrRows = () => safe(() => (typeof arrGuests !== 'undefined' && arrGuests || []).slice(), []);
  const ihRows = () => safe(() => (W.hoInHouse && W.hoInHouse.rooms ? W.hoInHouse.rooms() : []) || [], []);
  const phoneOf = r => String(r.phone || r.mobile || r.tel || r.whatsapp || '').trim();
  const emailOf = r => { const e = String(r.email || '').trim(); return /^no@email/i.test(e) || !/@/.test(e) ? '' : e; };
  function guests(src) {
    const t = today();
    if (src === 'dep') return depRows().map((r, i) => ({ key: 'dep:' + i + ':' + (r.roomStr || r.room), src: 'dep', room: String(r.roomStr || r.room || ''), name: niceName(r.name), phone: phoneOf(r), email: emailOf(r),
      arrival: toISO(r.arrival), departure: toISO(r.departure) || t, nights: r.nights || '', balance: (+r.balance || 0) > 0 ? +r.balance : '', late: r.lateTime || '', status: r.status || '' }));
    if (src === 'arr') return arrRows().map((g, i) => { const n = +g.nights || 1; return { key: 'arr:' + i + ':' + g.room, src: 'arr', room: String(g.room || ''), name: niceName(g.name), phone: phoneOf(g), email: emailOf(g),
      arrival: t, departure: addDays(t, n), nights: n, balance: '', late: '' }; });
    if (src === 'ih') return ihRows().map((r, i) => ({ key: 'ih:' + i + ':' + r.room, src: 'ih', room: String(r.room || ''), name: niceName(r.name || (r.names || [])[0]), phone: phoneOf(r), email: emailOf(r),
      arrival: toISO(r.arrival), departure: toISO(r.departure), nights: r.nights || '', balance: (+r.balance || 0) > 0 ? +r.balance : '', late: r.lateTime || '' }));
    return [];
  }
  const SRC = [['dep', 'Departures'], ['arr', 'Arrivals'], ['ih', 'In-House'], ['man', '✎ Type']];
  const SRC_TAG = { dep: 'Departing', arr: 'Arriving', ih: 'In-house', man: '' };

  /** every value for the placeholders, in one language */
  function values(lang) {
    const g = st.g, c = cfg(), L = lang === 'ar' ? 'ar' : 'en';
    const hotelName = c.hotel || safe(() => ($('hotelName') && $('hotelName').textContent.trim()) || '', '') || 'our hotel';
    const prof = safe(() => (W.hoCfg && W.hoCfg.get('profile')) || {}, {});
    const co = c.checkout || prof.checkout || (typeof W.hoCheckoutMin === 'function' ? safe(() => { const m = W.hoCheckoutMin(); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }, '') : '') || '12:00';
    const ci = c.checkin || prof.checkin || '15:00';
    const nm = niceName(g.name);
    const v = {
      name: nm, first: firstOf(nm), room: String(g.room || '').trim(), arrival: fmtDate(g.arrival, L), departure: fmtDate(g.departure, L),
      nights: g.nights ? String(g.nights) : '', stay: stayText(g.nights, L), checkout_time: fmtTime(co, L), checkin_time: fmtTime(ci, L),
      late_time: fmtTime(st.extra.late_time || g.late, L), hotel: hotelName, balance: g.balance !== '' && +g.balance ? money(g.balance, L) : '',
      price: st.extra.price ? money(st.extra.price, L) : '', wifi: c.wifi, wifi_pass: c.wifiPass, breakfast: c.breakfast, review_link: c.review,
      item: st.extra.item, occasion: (OCCASION[st.extra.occasion] || OCCASION.birthday)[L === 'ar' ? 1 : 0], today: fmtDate(today(), L),
    };
    // in Arabic, an English name, time or link is wrapped in a bidi isolate (FSI…PDI, also honoured by WhatsApp
    // and mail apps), so "Beta!" does not come out as "!Beta" and "6:30 – 10:30 AM" keeps its order
    if (L === 'ar') Object.keys(v).forEach(k => { if (v[k] && /[A-Za-z0-9]/.test(v[k]) && !/[\u0600-\u06FF]/.test(v[k])) v[k] = '\u2068' + v[k] + '\u2069'; });
    v.signature = fill(L === 'ar' ? c.sigAr : c.sigEn, v).text;   // a signature may name the hotel
    return v;
  }
  /** the message as it will be sent: { text, subject, missing, dir } */
  function compose() {
    const L = st.lang, base = L === 'other' ? 'en' : L, vals = values(base);
    const src = L === 'other' ? (st.other || tplText(st.tpl, 'en')) : tplText(st.tpl, L);
    const r = fill(src, vals);
    const text = st.edited != null ? st.edited : r.text;
    return { text, subject: fill(tplText(st.tpl, base, 'sub'), vals).text, missing: st.edited != null ? [] : r.missing, dir: L === 'ar' || (L === 'other' && /[֐-ࣿ]/.test(text.slice(0, 80))) ? 'rtl' : 'ltr' };
  }

  // ── the page ──
  function shell() {
    const root = $('gmRoot'); if (!root) return;
    root.innerHTML = `<div class="page-hd"><div class="page-hd-left"><h1>💌 Guest messages</h1><p>Ready-to-send messages filled in from today's lists — copy, WhatsApp, email or print.</p></div></div>
      <div class="gm-grid">
        <div class="gm-col">
          <section class="gm-card"><div class="gm-h"><span class="gm-n">1</span>Guest</div>
            <div class="gm-seg" id="gmSrc"></div>
            <div id="gmPick"><input type="search" id="gmQ" class="gm-in" placeholder="Search room or name…" autocomplete="off" enterkeyhint="search"><div id="gmList" class="gm-list"></div></div>
            <div id="gmGuest" class="gm-fields"></div>
          </section>
          <section class="gm-card"><div class="gm-h"><span class="gm-n">2</span>Message</div>
            <div id="gmTpls" class="gm-tpls"></div>
            <div class="gm-seg gm-lang" id="gmLang"></div>
            <div id="gmExtra" class="gm-fields"></div>
            <div id="gmOtherW" hidden><label class="gm-lb" for="gmOther">Your message (any language — {placeholders} still work)</label><textarea id="gmOther" class="gm-in gm-ta" rows="8" dir="auto"></textarea></div>
          </section>
        </div>
        <div class="gm-col gm-side">
          <section class="gm-card gm-pv"><div class="gm-h"><span class="gm-n">3</span>Preview &amp; send<span class="gm-sp"></span><button type="button" class="btn sm" id="gmEditBtn">✎ Edit this one</button></div>
            <div class="gm-chat"><div class="gm-to" id="gmTo"></div><div id="gmBubble" class="gm-bubble"></div><textarea id="gmEdit" class="gm-in gm-ta" rows="10" hidden></textarea></div>
            <div id="gmMiss" class="gm-miss"></div>
            <div class="gm-acts">
              <button type="button" class="btn" data-gm-send="copy">⧉ Copy</button>
              <button type="button" class="btn gm-wa" data-gm-send="whatsapp">💬 WhatsApp</button>
              <button type="button" class="btn" data-gm-send="email">✉️ Email</button>
              <button type="button" class="btn" data-gm-send="print">🖨 Print</button>
            </div>
          </section>
          <section class="gm-card"><div class="gm-h">Sent today<span class="gm-sp"></span><small id="gmLogN"></small></div><div id="gmLog" class="gm-log"></div></section>
        </div>
      </div>
      <details class="gm-card gm-more" id="gmTplEd"><summary>✏️ Edit the templates</summary><div id="gmEd"></div></details>
      <details class="gm-card gm-more" id="gmSetW"><summary>🏨 Hotel details used in messages</summary><div id="gmSet"></div></details>
      <div id="gmPrint" class="gm-print" aria-hidden="true"></div>`;
    renderAll();
  }
  function renderAll() { renderSrc(); renderList(); renderGuest(); renderTpls(); renderLang(); renderExtra(); renderPreview(); renderLog(); renderEditor(); renderSettings(); }

  function renderSrc() {
    const el = $('gmSrc'); if (!el) return;
    el.innerHTML = SRC.map(([k, l]) => { const n = k === 'man' ? 0 : guests(k).length; return `<button type="button" class="${st.src === k ? 'on' : ''}" data-gm-src="${k}">${esc(l)}${k !== 'man' ? `<i>${n}</i>` : ''}</button>`; }).join('');
    const pick = $('gmPick'); if (pick) pick.hidden = st.src === 'man';
  }
  function renderList() {
    const el = $('gmList'); if (!el || st.src === 'man') return;
    const all = guests(st.src), q = st.q.trim().toLowerCase();
    const L = q ? all.filter(g => g.room.toLowerCase().startsWith(q) || g.name.toLowerCase().includes(q)) : all;
    if (!all.length) { el.innerHTML = `<div class="gm-empty">Nothing loaded on ${esc((SRC.find(s => s[0] === st.src) || [])[1])} today. Load it there first, or tap <b>✎ Type</b> to write the guest in.</div>`; return; }
    if (!L.length) { el.innerHTML = `<div class="gm-empty">No room or name matches "${esc(st.q)}".</div>`; return; }
    el.innerHTML = L.slice(0, 60).map(g => `<button type="button" class="gm-row${st.g.key === g.key ? ' on' : ''}" data-gm-pick="${esc(g.key)}"><b>${esc(g.room || '—')}</b><span>${esc(g.name || '—')}</span><small>${g.status === 'out' ? 'Checked out' : g.departure ? (st.src === 'arr' ? esc(stayText(g.nights, 'en')) : 'Out ' + esc(fmtDate(g.departure, 'en'))) : ''}${g.balance ? ' · <em>AED ' + esc(g.balance) + '</em>' : ''}</small></button>`).join('')
      + (L.length > 60 ? `<div class="gm-empty">${L.length - 60} more — search to narrow it down.</div>` : '');
  }
  const FIELDS = [['name', 'Guest name', 'text', 'name'], ['room', 'Room', 'text', ''], ['phone', 'WhatsApp / phone', 'tel', 'tel'], ['email', 'Email', 'email', 'email'],
    ['arrival', 'Arrival', 'date', ''], ['departure', 'Departure', 'date', ''], ['nights', 'Nights', 'number', ''], ['balance', 'Balance AED', 'number', '']];
  function renderGuest() {
    const el = $('gmGuest'); if (!el) return;
    const g = st.g, picked = !!g.key || st.src === 'man';
    el.innerHTML = (g.key ? `<div class="gm-who"><span class="gm-tag">${esc(SRC_TAG[g.src] || '')}</span><b>${esc(g.room)}</b> ${esc(g.name)}<button type="button" class="gm-x" data-gm-clear title="Clear">✕</button></div>` : '')
      + (picked ? FIELDS.map(([k, l, type, ac], i) => (i === 4 ? `<details class="gm-dt"${st.dtOpen || !g.key ? ' open' : ''}><summary>📅 Dates &amp; balance <small>${esc([g.arrival && fmtDate(g.arrival, 'en'), g.departure && '→ ' + fmtDate(g.departure, 'en'), g.balance && 'AED ' + g.balance].filter(Boolean).join(' · '))}</small></summary><div class="gm-fields">` : '') + `<label class="gm-f gm-f-${k}"><span>${esc(l)}</span><input class="gm-in" data-gm-g="${k}" type="${type}" value="${esc(g[k])}"${ac ? ` autocomplete="${ac}"` : ' autocomplete="off"'}${type === 'number' ? ' inputmode="decimal" min="0"' : ''}${k === 'phone' ? ' placeholder="+971 5x xxx xxxx" inputmode="tel"' : ''}${k === 'room' ? ' inputmode="numeric"' : ''}></label>` + (i === FIELDS.length - 1 ? '</div></details>' : '')).join('')
        : '<div class="gm-empty gm-hint">Pick a guest above — the message fills in their name, room and dates.</div>');
  }
  function renderTpls() {
    const el = $('gmTpls'); if (!el) return;
    el.innerHTML = TPL.map(t => `<button type="button" class="gm-tpl${st.tpl === t.id ? ' on' : ''}" data-gm-tpl="${t.id}"><span>${t.icon}</span>${esc(t.name)}</button>`).join('');
  }
  function renderLang() {
    const el = $('gmLang'); if (!el) return;
    el.innerHTML = [['en', 'English'], ['ar', 'العربية'], ['other', 'Other…']].map(([k, l]) => `<button type="button" class="${st.lang === k ? 'on' : ''}" data-gm-lang="${k}"${k === 'ar' ? ' lang="ar"' : ''}>${l}</button>`).join('');
    const w = $('gmOtherW'); if (w) w.hidden = st.lang !== 'other';
    const o = $('gmOther'); if (o && st.lang === 'other' && o.value !== st.other) o.value = st.other;
  }
  function renderExtra() {
    const el = $('gmExtra'); if (!el) return;
    const src = st.lang === 'other' ? st.other : tplText(st.tpl, st.lang === 'ar' ? 'ar' : 'en');
    const need = tokens(src).filter(k => EXTRA[k]);
    el.innerHTML = need.map(k => {
      const [l, type, ph] = EXTRA[k];
      if (type === 'select') return `<label class="gm-f"><span>${esc(l)}</span><select class="gm-in" data-gm-x="${k}">${Object.keys(OCCASION).map(o => `<option value="${o}"${st.extra[k] === o ? ' selected' : ''}>${o[0].toUpperCase() + o.slice(1)}</option>`).join('')}</select></label>`;
      const v = k === 'late_time' ? (st.extra.late_time || (/^\d{1,2}:\d{2}$/.test(st.g.late) ? st.g.late.padStart(5, '0') : '')) : st.extra[k];
      return `<label class="gm-f"><span>${esc(l)}</span><input class="gm-in" data-gm-x="${k}" type="${type}" value="${esc(v)}"${ph ? ` placeholder="${esc(ph)}"` : ''}${k === 'price' ? ' inputmode="decimal"' : ''} autocomplete="off"></label>`;
    }).join('');
  }
  function bubbleHtml(text) {
    // a {placeholder} still in the text is marked, so the agent sees what to fill in
    return esc(text).replace(/\{([a-z_]+)\}/g, '<mark>{$1}</mark>').replace(/(https?:\/\/[^\s<]+)/g, '<u>$1</u>');
  }
  /** WhatsApp's own light or dark chat colours, matching whichever theme or skin is on (there are many) */
  function tone() {
    const r = $('gmRoot'); if (!r) return;
    const c = safe(() => getComputedStyle(r.querySelector('.gm-card') || r).backgroundColor.match(/[\d.]+/g).map(Number), null);
    if (c && c.length >= 3) r.classList.toggle('gm-dark', (c[0] * 299 + c[1] * 587 + c[2] * 114) / 1000 < 128 && (c[3] == null || c[3] > 0.3));
  }
  function renderPreview() {
    const b = $('gmBubble'); if (!b) return;
    tone();
    const m = compose(), g = st.g;
    b.innerHTML = bubbleHtml(m.text) + `<span class="gm-time">${esc(new Date().toTimeString().slice(0, 5))} ✓✓</span>`;
    b.dir = m.dir; b.lang = st.lang === 'ar' ? 'ar' : st.lang === 'en' ? 'en' : '';
    const to = $('gmTo'); if (to) to.innerHTML = `<span>To</span> ${g.name || g.room ? `<b>${esc(g.name || 'Guest')}</b>${g.room ? ' · room ' + esc(g.room) : ''}` : '<i>no guest picked</i>'}${waPhone(g.phone) ? ' · +' + esc(waPhone(g.phone)) : ''}`;
    const need = m.missing.filter(k => NEED.has(k)), soft = m.missing.filter(k => !NEED.has(k) && k !== 'signature');
    const label = k => (PH.find(p => p[0] === k) || [k, k])[1];
    const miss = $('gmMiss'); if (miss) miss.innerHTML = (need.length ? `<div class="gm-warn">⚠ Still to fill in: ${need.map(k => '<b>' + esc(label(k)) + '</b>').join(', ')}</div>` : '')
      + (soft.length ? `<div class="gm-note">Left out (not set): ${soft.map(k => esc(label(k))).join(', ')}${soft.some(k => ['wifi', 'wifi_pass', 'breakfast', 'review_link'].includes(k)) ? ' — add them in <a href="#" data-gm-open-set>Hotel details</a>' : ''}</div>` : '');
    const ed = $('gmEdit'), eb = $('gmEditBtn');
    if (ed) { ed.hidden = st.edited == null; b.hidden = st.edited != null; ed.dir = m.dir; }
    if (eb) eb.textContent = st.edited == null ? '✎ Edit this one' : '↺ Back to template';
    const wa = doc.querySelector('[data-gm-send="whatsapp"]'); if (wa) wa.title = waPhone(g.phone) ? 'Open WhatsApp to +' + waPhone(g.phone) : 'Open WhatsApp and choose the chat';
    const em = doc.querySelector('[data-gm-send="email"]'); if (em) em.title = g.email ? 'Email ' + g.email : 'Opens your mail app — add the address there';
  }
  function renderLog() {
    const el = $('gmLog'); if (!el) return;
    const L = (st.log || []).filter(Boolean);
    const n = $('gmLogN'); if (n) n.textContent = L.length ? L.length + ' sent' : '';
    const VIA = { copy: '⧉', whatsapp: '💬', email: '✉️', print: '🖨' };
    el.innerHTML = L.length ? L.slice(0, 30).map(x => `<div class="gm-li"><span class="gm-via">${VIA[x.via] || '•'}</span><b>${esc(x.room || '—')}</b><span class="gm-lt">${esc((T(x.tpl) || {}).name || x.tpl || '')}${x.lang === 'ar' ? ' · AR' : x.lang === 'other' ? ' · other' : ''}</span><small>${esc(x.t || '')}${x.by ? ' · ' + esc(x.by) : ''}</small></div>`).join('')
      : '<div class="gm-empty">Nothing sent yet today.</div>';
  }
  function renderEditor() {
    const el = $('gmEd'); if (!el) return;
    const id = st.edTpl, L = st.edLang, own = safe(() => st.saved.tpl[id] || {}, {}), changed = Object.keys(own).some(k => own[k]);
    el.innerHTML = `<p class="gm-p">Change the wording for the whole hotel. Tap a placeholder to put it where the cursor is. ${canEdit() ? '' : '<b>Read-only access: you can look but not save.</b>'}</p>
      <div class="gm-edbar"><select id="gmEdTpl" class="gm-in">${TPL.map(t => `<option value="${t.id}"${t.id === id ? ' selected' : ''}>${t.icon} ${esc(t.name)}${Object.values(safe(() => st.saved.tpl[t.id] || {}, {})).some(Boolean) ? ' (changed)' : ''}</option>`).join('')}</select>
        <div class="gm-seg">${[['en', 'English'], ['ar', 'العربية']].map(([k, l]) => `<button type="button" class="${L === k ? 'on' : ''}" data-gm-edlang="${k}">${l}</button>`).join('')}</div></div>
      <label class="gm-lb" for="gmEdSub">Email subject</label><input id="gmEdSub" class="gm-in" dir="${L === 'ar' ? 'rtl' : 'ltr'}" value="${esc(tplText(id, L, 'sub'))}">
      <label class="gm-lb" for="gmEdBody">Message</label><textarea id="gmEdBody" class="gm-in gm-ta" rows="11" dir="${L === 'ar' ? 'rtl' : 'ltr'}">${esc(tplText(id, L))}</textarea>
      <div class="gm-ph">${PH.map(([k, l]) => `<button type="button" data-gm-ph="${k}" title="${esc(l)}">{${k}}</button>`).join('')}</div>
      <div class="gm-acts gm-acts-l"><button type="button" class="btn gold" data-gm-edsave${canEdit() ? '' : ' disabled'}>Save for the hotel</button><button type="button" class="btn" data-gm-edreset${changed && canEdit() ? '' : ' disabled'}>↺ Back to the built-in text</button></div>`;
  }
  const SET_FIELDS = [['hotel', 'Hotel name in messages', 'Leave empty to use the app\'s hotel name'], ['wifi', 'Wi-Fi network', 'e.g. Hotel-Guest'], ['wifiPass', 'Wi-Fi password', ''],
    ['breakfast', 'Breakfast times', 'e.g. 6:30 – 10:30 AM, ground floor restaurant'], ['checkout', 'Check-out time', ''], ['checkin', 'Check-in time', ''],
    ['review', 'Review link', 'https://…'], ['sigEn', 'Signature (English)', ''], ['sigAr', 'Signature (Arabic)', '']];
  function renderSettings() {
    const el = $('gmSet'); if (!el) return;
    const c = cfg(), prof = safe(() => (W.hoCfg && W.hoCfg.get('profile')) || {}, {});
    const ph = { checkout: prof.checkout || '12:00', checkin: prof.checkin || '15:00', hotel: safe(() => $('hotelName').textContent.trim(), '') || 'Hotel name' };
    el.innerHTML = `<p class="gm-p">Saved for the whole hotel and used in every message. Times left empty follow Settings → Hotel setup.</p><div class="gm-fields gm-setf">${SET_FIELDS.map(([k, l, p]) =>
      `<label class="gm-f${k === 'hotel' || k === 'breakfast' || k === 'review' ? ' gm-wide' : ''}"><span>${esc(l)}</span><input class="gm-in" data-gm-set="${k}" ${k === 'checkout' || k === 'checkin' ? 'type="text" inputmode="numeric" maxlength="5"' : k === 'review' ? 'type="url"' : 'type="text"'} value="${esc((st.saved.settings || {})[k] != null ? st.saved.settings[k] : (k === 'sigEn' || k === 'sigAr' ? c[k] : ''))}" placeholder="${esc(ph[k] || p)}"${k === 'sigAr' ? ' dir="rtl"' : ''} autocomplete="off"></label>`).join('')}</div>
      <div class="gm-acts gm-acts-l"><button type="button" class="btn gold" data-gm-setsave${canEdit() ? '' : ' disabled'}>Save hotel details</button></div>`;
  }

  // ── picking ──
  function pick(g, keepExtra) {
    st.g = Object.assign(blank(), g || {}); st.edited = null;
    if (!keepExtra) st.extra.late_time = '';
    renderList(); renderGuest(); renderExtra(); renderPreview();
  }
  function findRoom(room) {
    const r = String(room == null ? '' : room).trim(); if (!r) return null;
    for (const s of ['dep', 'ih', 'arr']) { const g = guests(s).find(x => x.room === r && x.status !== 'out') || guests(s).find(x => x.room === r); if (g) return g; }
    return null;
  }

  // ── sending ──
  function copyText(t) {
    if (navigator.clipboard && W.isSecureContext !== false) return navigator.clipboard.writeText(t).catch(() => legacyCopy(t));
    return legacyCopy(t);
  }
  function legacyCopy(t) {
    return new Promise((ok, no) => { try { const a = doc.createElement('textarea'); a.value = t; a.style.cssText = 'position:fixed;opacity:0;top:0'; doc.body.appendChild(a); a.select(); const r = doc.execCommand('copy'); a.remove(); r ? ok() : no(); } catch (e) { no(e); } });
  }
  function logSend(via) {
    const now = new Date(), e = { at: now.toISOString(), t: now.toTimeString().slice(0, 5), by: user(), tpl: st.tpl, lang: st.lang, room: st.g.room || '', via };
    st.log = [e].concat(st.log || []); renderLog();
    if (typeof fbPushLog === 'function') safe(() => fbPushLog('guestMsgLog/' + today(), e, 300).catch(() => {}));
  }
  function send(via) {
    const m = compose();
    if (!m.text.trim()) { toast('The message is empty', 'warn'); return; }
    const need = m.missing.filter(k => NEED.has(k));
    if (need.length && !W.confirm('Still to fill in: ' + need.join(', ') + '.\nSend it anyway?')) return;
    const g = st.g;
    if (via === 'copy') { copyText(m.text).then(() => { toast('Message copied — paste it to the guest', 'ok'); logSend('copy'); }, () => toast('Could not copy — select the text and copy it', 'err')); return; }
    if (via === 'whatsapp') {
      const p = waPhone(g.phone);
      W.open((p ? 'https://wa.me/' + p : 'https://wa.me/') + '?text=' + encodeURIComponent(m.text), '_blank', 'noopener');
      logSend('whatsapp'); return;
    }
    if (via === 'email') {
      const to = String(g.email || '').trim();
      // mailto bodies need CRLF and %-encoding; a very long one is cut by some mail apps, so it is copied too
      const href = 'mailto:' + encodeURIComponent(to).replace(/%40/g, '@') + '?subject=' + encodeURIComponent(m.subject) + '&body=' + encodeURIComponent(m.text.replace(/\n/g, '\r\n'));
      if (href.length > 1800) copyText(m.text).catch(() => {});
      const a = doc.createElement('a'); a.href = href; a.rel = 'noopener'; doc.body.appendChild(a); a.click(); a.remove();
      if (!to) toast('Add the guest\'s address in your mail app', 'info');
      logSend('email'); return;
    }
    if (via === 'print') {
      const P = $('gmPrint'); if (!P) return;
      const v = values(st.lang === 'ar' ? 'ar' : 'en');
      P.innerHTML = `<div class="gm-ph-hd"><b>${esc(v.hotel)}</b><span>${esc(fmtDate(today(), st.lang === 'ar' ? 'ar' : 'en'))}${g.room ? ' · ' + (st.lang === 'ar' ? 'الغرفة ' : 'Room ') + esc(g.room) : ''}</span></div><div class="gm-ph-body" dir="${m.dir}">${esc(m.text)}</div>`;
      doc.documentElement.classList.add('gm-printing');
      setTimeout(() => { safe(() => W.print()); setTimeout(() => doc.documentElement.classList.remove('gm-printing'), 600); }, 60);
      logSend('print');
    }
  }

  // ── saving the hotel's wording and details ──
  function saveTpl() {
    if (!canEdit()) return;
    const id = st.edTpl, L = st.edLang, t = T(id), sub = ($('gmEdSub') || {}).value || '', body = ($('gmEdBody') || {}).value || '';
    const kB = L === 'ar' ? 'ar' : 'en', kS = L === 'ar' ? 'subAr' : 'subEn';
    // the built-in text is not stored, so a later improvement of it still reaches this hotel
    const patch = { ['tpl/' + id + '/' + kB]: body.trim() && body.trim() !== t[kB].trim() ? body : null, ['tpl/' + id + '/' + kS]: sub.trim() && sub.trim() !== t[kS].trim() ? sub : null };
    applyLocal(patch);
    if (typeof fbUpdate === 'function') safe(() => fbUpdate(ROOT, patch));
    toast('Template saved for the hotel', 'ok'); renderEditor(); renderExtra(); renderPreview();
  }
  function resetTpl() {
    if (!canEdit() || !W.confirm('Go back to the built-in wording for this template (English and Arabic)?')) return;
    const id = st.edTpl, patch = { ['tpl/' + id]: null };
    applyLocal(patch); if (typeof fbUpdate === 'function') safe(() => fbUpdate(ROOT, patch));
    toast('Back to the built-in text', 'ok'); renderEditor(); renderExtra(); renderPreview();
  }
  function saveSettings() {
    if (!canEdit()) return;
    const patch = {};
    let bad = '';
    doc.querySelectorAll('[data-gm-set]').forEach(i => {
      const k = i.dataset.gmSet; let v = i.value.trim();
      if ((k === 'checkout' || k === 'checkin') && v) { const m = v.match(/^(\d{1,2})[:.]?(\d{2})$/); if (m && +m[1] < 24 && +m[2] < 60) v = m[1].padStart(2, '0') + ':' + m[2]; else { bad = bad || k; return; } }
      patch['settings/' + k] = v && v !== SET_DEF[k] ? v : null;
    });
    if (bad) { toast('Type the ' + (bad === 'checkout' ? 'check-out' : 'check-in') + ' time like 12:00', 'warn'); return; }
    applyLocal(patch); if (typeof fbUpdate === 'function') safe(() => fbUpdate(ROOT, patch));
    toast('Hotel details saved', 'ok'); renderSettings(); renderPreview();
  }
  function applyLocal(patch) {
    st.saved = typeof fbApplyPatch === 'function' ? fbApplyPatch(st.saved, patch) : (() => { const o = JSON.parse(JSON.stringify(st.saved || {})); Object.keys(patch).forEach(p => { const ks = p.split('/'), last = ks.pop(); let x = o; ks.forEach(k => { x = x[k] = x[k] && typeof x[k] === 'object' ? x[k] : {}; }); if (patch[p] == null) delete x[last]; else x[last] = patch[p]; }); return o; })();
  }

  // ── events ──
  function onClick(e) {
    const t = e.target.closest('button, a'); if (!t) return;
    const d = t.dataset;
    if (d.gmSrc) { st.src = d.gmSrc; LS.set('src', st.src); st.q = ''; const q = $('gmQ'); if (q) q.value = ''; if (st.src === 'man' && st.g.key) pick(Object.assign({}, st.g, { key: '', src: 'man' }), true); renderSrc(); renderList(); renderGuest(); }
    else if (d.gmPick) { const g = guests(st.src).find(x => x.key === d.gmPick); if (g) pick(g); if (W.innerWidth < 900) { const f = $('gmTpls'); if (f) safe(() => f.scrollIntoView({ behavior: 'smooth', block: 'center' })); } }
    else if (t.hasAttribute('data-gm-clear')) pick(blank());
    else if (d.gmTpl) { st.tpl = d.gmTpl; LS.set('tpl', st.tpl); st.edited = null; if (st.lang === 'other') st.other = tplText(st.tpl, 'en'); renderTpls(); renderLang(); renderExtra(); renderPreview(); }
    else if (d.gmLang) { st.lang = d.gmLang; LS.set('lang', st.lang); st.edited = null; if (st.lang === 'other' && !st.other) st.other = tplText(st.tpl, 'en'); renderLang(); renderExtra(); renderPreview(); }
    else if (d.gmSend) send(d.gmSend);
    else if (t.id === 'gmEditBtn') { if (st.edited == null) { st.edited = compose().text; const ed = $('gmEdit'); if (ed) ed.value = st.edited; renderPreview(); if (ed) ed.focus(); } else { st.edited = null; renderPreview(); } }
    else if (d.gmEdlang) { st.edLang = d.gmEdlang; renderEditor(); }
    else if (d.gmPh != null && d.gmPh !== '') { const ta = $('gmEdBody'); if (ta) { const s = ta.selectionStart || ta.value.length, en = ta.selectionEnd || s, ins = '{' + d.gmPh + '}'; ta.value = ta.value.slice(0, s) + ins + ta.value.slice(en); ta.focus(); ta.setSelectionRange(s + ins.length, s + ins.length); } }
    else if (t.hasAttribute('data-gm-edsave')) saveTpl();
    else if (t.hasAttribute('data-gm-edreset')) resetTpl();
    else if (t.hasAttribute('data-gm-setsave')) saveSettings();
    else if (t.hasAttribute('data-gm-open-set')) { e.preventDefault(); const s = $('gmSetW'); if (s) { s.open = true; safe(() => s.scrollIntoView({ behavior: 'smooth', block: 'start' })); } }
  }
  function onInput(e) {
    const t = e.target, d = t.dataset;
    if (t.id === 'gmQ') { st.q = t.value; renderList(); return; }
    if (d.gmG) { st.g[d.gmG] = t.value; st.edited = null; renderPreview(); return; }
    if (d.gmX) { st.extra[d.gmX] = t.value; st.edited = null; renderPreview(); return; }
    if (t.id === 'gmOther') { st.other = t.value; renderExtra(); renderPreview(); return; }
    if (t.id === 'gmEdit') { st.edited = t.value; return; }
  }
  function onChange(e) {
    const t = e.target;
    if (t.id === 'gmEdTpl') { st.edTpl = t.value; renderEditor(); }
    else if (t.dataset.gmX) { st.extra[t.dataset.gmX] = t.value; renderPreview(); }
  }
  function onKey(e) {
    // Enter in the search picks the only (or first) match: a room number + Enter is the fastest way in
    if (e.target.id === 'gmQ' && e.key === 'Enter') { const b = doc.querySelector('#gmList [data-gm-pick]'); if (b) b.click(); }
  }

  // ── live data ──
  function startSync() {
    let tries = 0;
    const go = () => {
      if (typeof fbListen !== 'function') return;
      if (!dbReady() && ++tries <= 40) { setTimeout(go, 500); return; }
      safe(() => fbListen(ROOT, v => { st.saved = v && typeof v === 'object' ? v : {}; if (st.mounted) { renderEditorKeep(); renderSettingsKeep(); renderTpls(); renderExtra(); renderPreview(); } }));
      listenLog();
    };
    go();
  }
  function listenLog() {
    const d = today(); if (st.logDay === d || typeof fbListen !== 'function') return;
    st.logDay = d; st.log = [];
    safe(() => fbListen('guestMsgLog/' + d, v => { if (st.logDay !== d) return; st.log = Array.isArray(v) ? v.filter(Boolean) : v && typeof v === 'object' ? Object.values(v) : []; renderLog(); }));
  }
  // a colleague's save must not wipe what this agent is typing in the editor
  const typingIn = id => { const a = doc.activeElement; return a && a.closest && a.closest('#' + id); };
  const renderEditorKeep = () => { if (!typingIn('gmEd')) renderEditor(); };
  const renderSettingsKeep = () => { if (!typingIn('gmSet')) renderSettings(); };

  const CSS = `
#gmRoot{--gm-bub:#d9fdd3;--gm-bubtx:#111b21;--gm-chat:#efeae2;max-width:1180px}
#gmRoot.gm-dark{--gm-bub:#005c4b;--gm-bubtx:#e9edef;--gm-chat:#0b141a}
#gmRoot .gm-grid{display:grid;grid-template-columns:minmax(0,1.08fr) minmax(0,.92fr);gap:14px;align-items:start}
#gmRoot .gm-col{display:flex;flex-direction:column;gap:14px;min-width:0}
#gmRoot .gm-side{position:sticky;top:12px}
#gmRoot .gm-card{background:var(--card);color:var(--text);border:1px solid var(--border);border-radius:var(--r2,14px);padding:14px;min-width:0;box-sizing:border-box}
#gmRoot .gm-more{margin-top:14px}#gmRoot .gm-more>summary{cursor:pointer;font-weight:700;font-size:14px;list-style:none;padding:2px 0;user-select:none}
#gmRoot .gm-more>summary::-webkit-details-marker{display:none}#gmRoot .gm-more>summary::after{content:'▾';float:right;color:var(--text3);transition:transform .15s}#gmRoot .gm-more[open]>summary::after{transform:rotate(180deg)}
#gmRoot .gm-more[open]>summary{margin-bottom:10px}
#gmRoot .gm-h{display:flex;align-items:center;gap:8px;font-weight:700;font-size:14px;margin-bottom:10px}#gmRoot .gm-h small{color:var(--text3);font-weight:600}
#gmRoot .gm-sp{flex:1}
#gmRoot .gm-n{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--accent);color:#fff;font-size:12px;flex:none}
#gmRoot .gm-seg{display:flex;gap:3px;padding:3px;border-radius:11px;background:var(--bg2,rgba(127,127,127,.12));margin-bottom:10px;overflow-x:auto;scrollbar-width:none}
#gmRoot .gm-seg::-webkit-scrollbar{display:none}
#gmRoot .gm-seg button{flex:1 0 auto;padding:8px 10px;border:0;border-radius:8px;background:none;color:var(--text2);font:600 13px var(--font,inherit);cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;justify-content:center;gap:6px}
#gmRoot .gm-seg button.on{background:var(--card);color:var(--accent);box-shadow:0 1px 3px rgba(0,0,0,.14)}
#gmRoot .gm-seg button i{font-style:normal;font-size:11px;min-width:18px;padding:1px 5px;border-radius:9px;background:var(--border);color:var(--text2)}
#gmRoot .gm-seg button.on i{background:var(--accent);color:#fff}
#gmRoot .gm-in{width:100%;box-sizing:border-box;padding:9px 11px;border-radius:10px;border:1px solid var(--border2,var(--border));background:var(--surface,var(--card));color:var(--text);font:inherit;font-size:16px;min-width:0}
@media (min-width:900px){#gmRoot .gm-in{font-size:14px}}
#gmRoot .gm-in:focus{outline:2px solid var(--accent);outline-offset:-1px;border-color:transparent}
#gmRoot .gm-ta{resize:vertical;line-height:1.5;font-family:inherit}
#gmRoot .gm-list{display:flex;flex-direction:column;gap:4px;max-height:230px;overflow:auto;margin:8px 0 4px;-webkit-overflow-scrolling:touch}
#gmRoot .gm-row{display:grid;grid-template-columns:52px 1fr auto;align-items:center;gap:8px;text-align:left;padding:9px 10px;border-radius:10px;border:1px solid transparent;background:var(--bg2,rgba(127,127,127,.08));color:var(--text);font:inherit;cursor:pointer;min-height:42px}
#gmRoot .gm-row:hover{border-color:var(--border2,var(--border))}#gmRoot .gm-row.on{border-color:var(--accent);background:var(--accent-bg,rgba(127,127,127,.12))}
#gmRoot .gm-row b{font-variant-numeric:tabular-nums}#gmRoot .gm-row span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#gmRoot .gm-row small{color:var(--text3);font-size:11.5px;white-space:nowrap}#gmRoot .gm-row em{font-style:normal;color:var(--amber,#c27c0e);font-weight:600}
#gmRoot .gm-empty{color:var(--text3);font-size:13px;padding:10px 4px}#gmRoot .gm-hint{grid-column:1/-1}
#gmRoot .gm-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 10px}
#gmRoot #gmGuest{margin-top:6px}#gmRoot #gmExtra:not(:empty){margin-top:2px}
#gmRoot .gm-f{display:flex;flex-direction:column;gap:3px;min-width:0}#gmRoot .gm-f>span,#gmRoot .gm-lb{font-size:11.5px;font-weight:600;color:var(--text3);letter-spacing:.02em}
#gmRoot .gm-lb{display:block;margin:10px 0 4px}
#gmRoot .gm-f-name,#gmRoot .gm-wide,#gmRoot .gm-dt{grid-column:1/-1}
#gmRoot .gm-dt>summary{cursor:pointer;font-size:12.5px;font-weight:600;color:var(--text2);padding:6px 0;list-style:none}#gmRoot .gm-dt>summary::-webkit-details-marker{display:none}#gmRoot .gm-dt>summary small{color:var(--text3);font-weight:500;margin-left:4px}#gmRoot .gm-dt[open]>summary{margin-bottom:6px}
#gmRoot .gm-who{grid-column:1/-1;display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:10px;background:var(--accent-bg,rgba(127,127,127,.1));font-size:14px;min-width:0}
#gmRoot .gm-tag{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--accent)}
#gmRoot .gm-x{margin-left:auto;border:0;background:none;color:var(--text3);font-size:15px;cursor:pointer;padding:2px 6px}
#gmRoot .gm-tpls{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px;margin-bottom:12px}
#gmRoot .gm-tpl{display:flex;align-items:center;gap:7px;text-align:left;padding:9px 10px;border-radius:10px;border:1px solid var(--border);background:var(--card);color:var(--text);font:600 13px var(--font,inherit);cursor:pointer;line-height:1.25;min-height:44px}
#gmRoot .gm-tpl span{font-size:17px;flex:none}#gmRoot .gm-tpl:hover{border-color:var(--accent)}
#gmRoot .gm-tpl.on{border-color:var(--accent);background:var(--accent);color:#fff}
#gmRoot .gm-chat{background:var(--gm-chat);border-radius:12px;padding:12px;min-height:160px;display:flex;flex-direction:column;gap:8px}
#gmRoot .gm-to{font-size:12px;color:var(--text2)}#gmRoot .gm-to span{font-weight:700;color:var(--text3);text-transform:uppercase;font-size:10.5px;letter-spacing:.05em;margin-right:4px}
#gmRoot .gm-chat .gm-to{color:var(--gm-bubtx);opacity:.75}
#gmRoot .gm-bubble{align-self:flex-end;max-width:92%;background:var(--gm-bub);color:var(--gm-bubtx);border-radius:10px 2px 10px 10px;padding:8px 10px 18px;white-space:pre-wrap;word-wrap:break-word;overflow-wrap:anywhere;font-size:14.5px;line-height:1.45;position:relative;box-shadow:0 1px .5px rgba(0,0,0,.13);min-width:110px}
#gmRoot .gm-bubble[dir="rtl"]{text-align:right;unicode-bidi:plaintext;font-family:'Segoe UI','Noto Naskh Arabic','Geeza Pro',Tahoma,sans-serif;font-size:15.5px;line-height:1.7}
#gmRoot .gm-bubble mark{background:#ffd54a;color:#111;border-radius:4px;padding:0 3px}
#gmRoot .gm-time{position:absolute;bottom:3px;right:8px;font-size:10.5px;opacity:.6}#gmRoot .gm-bubble[dir="rtl"] .gm-time{right:auto;left:8px}
#gmRoot #gmEdit{background:var(--gm-bub);color:var(--gm-bubtx);border:0}
#gmRoot .gm-miss{margin:8px 0 2px;font-size:12.5px;display:flex;flex-direction:column;gap:4px}#gmRoot .gm-miss:empty{display:none}
#gmRoot .gm-warn{color:var(--amber,#b45309);font-weight:600}#gmRoot .gm-note{color:var(--text3)}#gmRoot .gm-note a{color:var(--accent)}
#gmRoot .gm-acts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin-top:10px}
#gmRoot .gm-acts .btn{justify-content:center;padding:10px 6px;font-size:13px;min-height:42px}
#gmRoot .gm-acts .gm-wa{background:#25d366;border-color:#25d366;color:#fff}#gmRoot .gm-acts .gm-wa:hover{background:#1ebe5b}
#gmRoot .gm-acts-l{display:flex;flex-wrap:wrap}#gmRoot .gm-acts-l .btn{flex:0 1 auto;padding:9px 14px}
#gmRoot .gm-log{display:flex;flex-direction:column;gap:2px;max-height:260px;overflow:auto}
#gmRoot .gm-li{display:grid;grid-template-columns:22px 44px 1fr auto;gap:6px;align-items:center;font-size:12.5px;padding:6px 2px;border-bottom:1px solid var(--border)}
#gmRoot .gm-li:last-child{border-bottom:0}#gmRoot .gm-lt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text2)}#gmRoot .gm-li small{color:var(--text3);white-space:nowrap}
#gmRoot .gm-p{font-size:12.5px;color:var(--text3);margin:0 0 10px}
#gmRoot .gm-edbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}#gmRoot .gm-edbar select{flex:1 1 220px;width:auto}#gmRoot .gm-edbar .gm-seg{margin:0}
#gmRoot .gm-ph{display:flex;flex-wrap:wrap;gap:4px;margin-top:8px}
#gmRoot .gm-ph button{font:600 11.5px var(--mono,monospace);padding:4px 7px;border-radius:7px;border:1px solid var(--border);background:var(--bg2,transparent);color:var(--accent);cursor:pointer}
#gmRoot .gm-print{display:none}
@media (max-width:899px){
  #gmRoot .gm-grid{grid-template-columns:minmax(0,1fr)}
  #gmRoot .gm-side{position:static}
  #gmRoot .gm-card{padding:12px}
  #gmRoot .gm-seg button{padding:8px 6px;font-size:12.5px;gap:4px}#gmRoot .gm-seg button i{padding:1px 4px;min-width:14px}
  #gmRoot .gm-tpls{grid-template-columns:repeat(2,minmax(0,1fr))}
  #gmRoot .gm-acts{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media (max-width:360px){#gmRoot .gm-fields{grid-template-columns:minmax(0,1fr)}}
@media print{
  html.gm-printing body *{visibility:hidden !important}
  html.gm-printing #gmPrint,html.gm-printing #gmPrint *{visibility:visible !important}
  html.gm-printing #gmPrint{display:block !important;position:absolute;left:0;top:0;width:100%;color:#111;background:#fff;font:14px/1.6 Arial,'Segoe UI',Tahoma,sans-serif}
  html.gm-printing .gm-ph-hd{display:flex;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:22px;font-size:13px}
  html.gm-printing .gm-ph-hd b{font-size:16px;text-transform:uppercase;letter-spacing:.05em}
  html.gm-printing .gm-ph-body{white-space:pre-wrap;font-size:15px}html.gm-printing .gm-ph-body[dir="rtl"]{text-align:right;font-size:16px;line-height:1.9}
  @page{size:A5 portrait;margin:16mm}
}`;

  function mount() {
    const main = doc.querySelector('#appWrapper .main') || doc.querySelector('.main') || doc.querySelector('main');
    const nav = doc.querySelector('.sidenav'); if (!main || !nav || $('panel-' + PANEL)) return;
    const s = doc.createElement('style'); s.id = 'gmCss'; s.textContent = CSS; doc.head.appendChild(s);
    const panel = doc.createElement('div'); panel.className = 'panel'; panel.id = 'panel-' + PANEL; panel.innerHTML = '<div id="gmRoot"></div>';
    main.appendChild(panel);
    panel.addEventListener('click', onClick); panel.addEventListener('input', onInput); panel.addEventListener('change', onChange); panel.addEventListener('keydown', onKey);
    panel.addEventListener('toggle', e => { if (e.target.classList && e.target.classList.contains('gm-dt')) st.dtOpen = e.target.open; }, true);   // 'toggle' does not bubble
    const item = doc.createElement('div'); item.className = 'nav-item'; item.id = 'nav-' + PANEL; item.dataset.panel = PANEL;
    item.setAttribute('onclick', "showPanel('" + PANEL + "')");
    item.innerHTML = '<div class="nav-icon">💌</div>Guest messages';
    const anchor = $('nav-guestmem') || $('nav-reports'); if (anchor && anchor.parentNode) anchor.after(item); else nav.appendChild(item);
    const grid = doc.querySelector('.mob-more-grid');
    if (grid) {
      const b = doc.createElement('button'); b.className = 'mob-more-item'; b.dataset.panel = PANEL; b.type = 'button';
      b.setAttribute('onclick', "showPanel('" + PANEL + "');(typeof closeMobMore==='function'?closeMobMore:function(){})()");
      b.innerHTML = '<span class="mob-item-icon">💌</span>Guest messages'; grid.appendChild(b);
    }
    if (typeof hoApplyIcons === 'function') safe(() => hoApplyIcons());
    safe(() => {
      // read-only accounts can look in Reports but not message guests
      if (typeof ROLES !== 'undefined') ['owner', 'manager', 'supervisor', 'agent'].forEach(r => { const p = ROLES[r] && ROLES[r].panels; if (p && !p.includes(PANEL)) p.push(PANEL); });
      if (typeof currentProfile !== 'undefined' && currentProfile && typeof applyRole === 'function') applyRole(currentProfile.role);
    });
    st.saved = safe(() => (typeof lsLoad === 'function' && lsLoad(ROOT)) || {}, {});   // this device's copy until the database answers
    st.mounted = true; shell();
    // the lists change on other pages: refresh the counts and the picked list each time the page is opened
    let was = false;
    new MutationObserver(() => { const on = panel.classList.contains('active'); if (on && !was) { listenLog(); renderSrc(); renderList(); renderGuest(); renderPreview(); } was = on; }).observe(panel, { attributes: true, attributeFilter: ['class'] });
    startSync();
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', mount); else mount();

  // Ops Brain: "send wifi password to guest", "check-out reminder message", "review request"…
  (W.BR_EXTRA = W.BR_EXTRA || []).push(() => [{ id: 'gm:open', kind: '💌 Guest messages', title: 'Message a guest (WhatsApp, email, copy, print)',
    body: 'Ready-to-send messages in English or Arabic, filled in from today\'s Departures, Arrivals and In-House.' + `<div class="br-acts"><button class="btn gold" onclick="brClose();hoGuestMsg.open()">Open Guest messages</button></div>`,
    text: 'guest message messages whatsapp email text sms template templates send write guest arabic english wifi password breakfast review', go: PANEL, boost: 1 }]
    .concat(TPL.map(t => ({ id: 'gm:' + t.id, kind: '💌 Guest messages', title: t.icon + ' ' + t.name + ' message',
      body: esc(fill(tplText(t.id, 'en'), {}).text.split('\n').slice(0, 3).join(' ')).slice(0, 180) + '…' + `<div class="br-acts"><button class="btn gold" onclick="brClose();hoGuestMsg.open({template:'${t.id}'})">Write it</button></div>`,
      text: t.name + ' message whatsapp email guest template send ' + t.id.replace(/_/g, ' ') + ({ welcome: ' wifi wi-fi password breakfast check-in', checkout: ' check out checkout time reminder', lco_offer: ' late checkout lco', lco_ok: ' late checkout lco approved confirmed', extend: ' extension extend stay longer', thanks: ' review tripadvisor google feedback thanks', balance: ' balance payment owing pay settle', lostfound: ' lost found item forgot left', occasion: ' birthday anniversary celebrate', prearrival: ' pre arrival before arrival booking' }[t.id] || ''), boost: 1 }))));

  W.hoGuestMsg = {
    /** open the page prefilled: { room, template, lang, name, phone, email, item, lateTime, price } */
    open(o) {
      o = o || {};
      if (o.template && T(o.template)) { st.tpl = o.template; LS.set('tpl', st.tpl); }
      if (o.lang && ['en', 'ar', 'other'].includes(o.lang)) st.lang = o.lang;
      ['item', 'price'].forEach(k => { if (o[k] != null) st.extra[k] = String(o[k]); });
      if (o.room != null || o.name) {
        const g = findRoom(o.room) || { key: '', src: 'man', room: String(o.room || '') };
        if (g.src !== 'man') st.src = g.src;
        st.g = Object.assign(blank(), g, o.name ? { name: o.name } : {}, o.phone ? { phone: String(o.phone) } : {}, o.email ? { email: o.email } : {});
        if (!g.key) st.src = 'man';
      }
      st.extra.late_time = o.lateTime || ''; st.edited = null; st.q = '';
      if (typeof showPanel === 'function') safe(() => showPanel(PANEL));
      if (st.mounted) { const q = $('gmQ'); if (q) q.value = ''; renderAll(); }
    },
    templates: () => TPL.map(t => ({ id: t.id, icon: t.icon, name: t.name })),
    /** the filled text for a template, guest and language, without opening anything */
    text(template, guest, lang) { const keep = { g: st.g, tpl: st.tpl, lang: st.lang, edited: st.edited }; try { st.g = Object.assign(blank(), guest || {}); st.tpl = T(template) ? template : st.tpl; st.lang = lang || 'en'; st.edited = null; return compose().text; } finally { Object.assign(st, keep); } },
    pure: { fill, toISO, fmtTime, stayText, niceName, waPhone, money, tokens, TPL },
  };
})(window);
