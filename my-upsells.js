// ═══════════════════════════════════════════════════════════
//  my-upsells.js — "🧾 My upsells" tab inside Package Audit
//
//  Without IN-Gauge there is no system left that says, night by night,
//  which upsell belongs to whom. Opera still holds the proof:
//    1. User Activity Log (Changes Log, Search Text "product", PDF):
//       who ADDED / ATTACHED which package code, when, at what price.
//    2. Reservation Detail (res_detail, text): stays, rooms, dates, profile.
//    3. Journal by Transaction Code (finjrnlbytrans, text): what was posted.
//  This tab joins them under the SAME seller rules as the Package Audit
//  (package-audit.js — it reuses that engine, it does not copy it) and
//  makes a person's own record: a table, an Excel file, and saved dated
//  snapshots in the database (myUpsells/{person}/{id}, append-only).
//
//  The journal has no confirmation number, so a posting is tied to a
//  booking by room + night through the Reservation Detail. With no journal
//  (or one filtered to Tourism Dirham only) the nights are estimated from
//  the package date range and price in the Activity Log, and say so.
//
//  Self-contained: injects its own <style>, tab button and view.
// ═══════════════════════════════════════════════════════════
(function (global) {
  'use strict';

  const EXCELJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
  const TRX_KEY = 'mu_trx_v1';
  const SNAP_MAX_ROWS = 300;

  // ── small helpers ────────────────────────────────────────
  const esc = s => (typeof escapeHtml === 'function' ? escapeHtml(String(s ?? '')) : String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const toast = (m, t) => { if (typeof showToast === 'function') showToast(m, t); };
  const r2 = n => Math.round((+n || 0) * 100) / 100;
  const money = v => r2(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  // YYYYMMDD numbers <-> dates (UTC, so month ends and DST never shift a day)
  const dnDate = n => { const s = String(n); return new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8))); };
  const dateDn = d => d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  const addDays = (n, k) => dateDn(new Date(dnDate(n).getTime() + k * 86400000));
  const dnIso = n => { const s = String(n || ''); return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : ''; };
  const isoDn = s => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? +(m[1] + m[2] + m[3]) : 0; };
  const dnLabel = n => { const s = String(n || ''); return s.length === 8 ? `${+s.slice(6, 8)} ${MON[+s.slice(4, 6) - 1]} ${s.slice(0, 4)}` : ''; };
  const dnShort = n => { const s = String(n || ''); return s.length === 8 ? `${+s.slice(6, 8)} ${MON[+s.slice(4, 6) - 1]}` : ''; };
  const tsLabel = ts => { const s = String(ts || ''); return s.length >= 12 ? `${+s.slice(6, 8)} ${MON[+s.slice(4, 6) - 1]} ${s.slice(0, 4)} ${s.slice(8, 10)}:${s.slice(10, 12)}` : ''; };
  const tsShort = ts => { const s = String(ts || ''); return s.length >= 12 ? `${+s.slice(6, 8)} ${MON[+s.slice(4, 6) - 1]} ${s.slice(8, 10)}:${s.slice(10, 12)}` : ''; };
  const dayNum = s => {
    const v = String(s || '').trim();
    const n = typeof _pkgDayNum === 'function' ? _pkgDayNum(v) : 0;
    if (n) return n;
    let m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);           // 01-10-26 (DD-MM-YY)
    if (m) return +((m[3].length === 2 ? '20' + m[3] : m[3]) + m[2].padStart(2, '0') + m[1].padStart(2, '0'));
    m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? +(m[1] + m[2] + m[3]) : 0;
  };
  const roomKey = r => { const m = String(r || '').match(/\d+/); return m ? String(parseInt(m[0], 10)) : String(r || '').trim(); };
  const nowStamp = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`; };
  const me = () => (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.name) || '';

  // ── kinds of package (from the audit's PKG_KINDS) ─────────
  const KIND_STYLE = {   // soft colours for the screen chips and the Excel Kind cell
    BB: { ico: '🥐', fill: 'FFFCE7B2' }, USS: { ico: '⬆️', fill: 'FFD6E6FB' }, EC: { ico: '🌅', fill: 'FFD8F0D8' },
    LC: { ico: '🌙', fill: 'FFE6DAF5' }, DIN: { ico: '🍽️', fill: 'FFF8D3D3' }, HB: { ico: '🍲', fill: 'FFFDE2C8' }, FB: { ico: '🍱', fill: 'FFE2E8F0' },
  };
  const kindEntry = code => (typeof _pkgKindEntry === 'function' ? _pkgKindEntry(code) : null);
  const kindOf = code => (typeof _pkgKindOfCode === 'function' ? _pkgKindOfCode(code) : String(code || '').toUpperCase());
  // The broad family (BB, EC…) of a kind key or a code, also when the "each code is its own package" rule is on.
  const famOf = k => { const e = kindEntry(k); if (e) return e[0]; return KIND_STYLE[k] ? k : ''; };
  function kindLabel(k, code) {
    const e = kindEntry(code || k) || (typeof PKG_KINDS !== 'undefined' ? PKG_KINDS.find(x => x[0] === k) : null);
    return e ? e[1] : (k || code || 'Package');
  }
  const kindIco = k => (KIND_STYLE[famOf(k)] || {}).ico || '🎁';

  // Words a journal line uses for each kind, when the package code is not in it.
  const KIND_WORDS = [
    ['EC', /early\s*check|early\s*c\/?i\b|\bECI\b|early\s*arrival/i],
    ['LC', /late\s*check|late\s*c\/?o\b|\bLCO\b|late\s*departure/i],
    ['HB', /half\s*board/i], ['FB', /full\s*board/i],
    ['BB', /breakfast|\bB\s*&\s*B\b/i], ['DIN', /dinner/i],
    ['USS', /upgrade|room\s*upsell/i],
  ];
  function kindFromText(s) { const t = String(s || ''); const k = KIND_WORDS.find(x => x[1].test(t)); return k ? k[0] : ''; }

  // ── the journal (finjrnlbytrans) ─────────────────────────
  // Tab-delimited with one header line. Read generically: every
  // transaction code, not only Tourism Dirham (dtcm-core reads 7510 only).
  function parseJournal(text) {
    const DC = global.DtcmCore || {};
    let raw = String(text || '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    const lines = raw.split('\n').filter(l => l.trim());
    let hi = lines.slice(0, 40).findIndex(l => /TRX_CODE|TRX_DESC|BUSINESS_DATE/i.test(l));
    if (hi < 0) return { rows: [], codes: {}, min: 0, max: 0, lines: 0, ok: false };
    const delim = DC.detectDelimiter ? DC.detectDelimiter(lines[hi]) : '\t';
    const split = l => (DC.splitLine ? DC.splitLine(l, delim) : l.split(delim));
    const head = split(lines[hi]).map(h => h.trim().replace(/^"|"$/g, '').toUpperCase());
    const col = (...n) => { for (const x of n) { const i = head.indexOf(x); if (i >= 0) return i; } return -1; };
    const C = {
      guest: col('GUEST_FULL_NAME', 'DISPLAY_NAME', 'GUEST_NAME'), desc: col('TRX_DESC', 'TRANSACTION_DESCRIPTION', 'DESCRIPTION'),
      date: col('BUSINESS_DATE', 'CHAR_TRX_DATE', 'BUSINESS_FORMAT_DATE', 'TRX_DATE'), room: col('ROOM', 'ROOM_NO'),
      code: col('TRX_CODE', 'TRANSACTION_CODE'), debit: col('CASHIER_DEBIT', 'PRINT_CASHIER_DEBIT', 'DEBIT'),
      credit: col('CASHIER_CREDIT', 'PRINT_CASHIER_CREDIT', 'CREDIT'), ref: col('REFERENCE'), remark: col('REMARK', 'REMARKS'),
      trx: col('TRX_NO'), time: col('BUSINESS_TIME', 'CHAR_TRX_TIME'), user: col('USER_NAME', 'CASHIER_NAME'),
      conf: col('CONFIRMATION_NO', 'CONF_NO', 'CONFIRMATION_NUMBER'), arrangement: col('ARRANGEMENT_CODE', 'PRODUCT', 'PACKAGE_CODE'),
    };
    const at = (c, i) => (i >= 0 ? String(c[i] ?? '').trim().replace(/^"|"$/g, '') : '');
    const num = v => parseFloat(String(v || '0').replace(/[^\d.\-]/g, '')) || 0;
    const rows = [], codes = {};
    let min = 0, max = 0;
    for (let i = hi + 1; i < lines.length; i++) {
      const c = split(lines[i]);
      if (c.length < 5) continue;
      const date = dayNum(at(c, C.date));
      if (!date) continue;
      const code = at(c, C.code).replace(/\.0+$/, ''), desc = at(c, C.desc);
      const k = (code + ' ' + desc).trim();
      codes[k] = (codes[k] || 0) + 1;
      if (!min || date < min) min = date;
      if (date > max) max = date;
      rows.push({
        date, code, desc, room: roomKey(at(c, C.room)), guest: at(c, C.guest),
        amount: r2(num(at(c, C.debit)) - num(at(c, C.credit))),
        ref: at(c, C.ref), remark: at(c, C.remark), trxNo: at(c, C.trx), time: at(c, C.time),
        user: at(c, C.user), conf: at(c, C.conf).replace(/\.0+$/, ''), pkg: at(c, C.arrangement),
      });
    }
    return { rows, codes, min, max, lines: rows.length, ok: true };
  }
  // Payments and settlements are never an upsell, even when their remark mentions a package
  // (a Visa payment "for breakfast" is money in, not a breakfast sold). Opera payment codes are 9000+.
  const PAY_WORDS = /\b(visa|master\s*card|mastercard|amex|american\s*express|diners|card|cash|payment|deposit|settle(ment)?|transfer|city\s*ledger|paid\s*out|refund|cheque|check\s*payment|bank|wire|advance|credit\s*card|debit\s*card|union\s*pay|alipay|wechat)\b/i;
  function isPayment(r) {
    const n = parseInt(String(r.code || '').replace(/\D/g, ''), 10);
    return (n >= 9000 && n <= 9999) || PAY_WORDS.test(String(r.desc || ''));
  }
  function isTd(r) {
    const DC = global.DtcmCore;
    if (DC && DC.isTdCode && DC.isTdCode(r.code)) return true;
    return r.code === '7510' || /tourism\s*dirham/i.test(r.desc);
  }

  // Configurable package transaction codes: "2010, 2015=BB".
  function trxCodes(str) {
    const m = new Map();
    String(str || '').split(/[\s,;]+/).forEach(t => {
      const [c, k] = t.split('='); if (c && c.trim()) m.set(c.trim(), (k || '').trim().toUpperCase());
    });
    return m;
  }

  // ── link a posting to a booking: room + night through the guest list ──
  function guestIndex(guests) {
    const by = {};
    Object.entries(guests || {}).forEach(([conf, g]) => {
      const rk = roomKey(g.room); if (!rk) return;
      (by[rk] = by[rk] || []).push({ conf, a: dayNum(g.arr), d: dayNum(g.dep), norm: g.norm || (typeof _pkgNormGuestName === 'function' ? _pkgNormGuestName(g.name) : '') });
    });
    return by;
  }
  function linkConf(row, idx) {
    const list = idx[roomKey(row.room)] || [];
    const d = row.date;
    let hits = list.filter(g => g.a && g.a <= d && (d < g.d || (g.a === g.d && d === g.a)));
    if (!hits.length) hits = list.filter(g => g.d === d);     // a late check-out posted on the day the guest leaves
    if (hits.length > 1 && row.guest && typeof _pkgNormGuestName === 'function') {
      const toks = new Set(_pkgNormGuestName(row.guest).split(' ').filter(Boolean));
      const named = hits.filter(g => g.norm.split(' ').some(t => toks.has(t)));
      if (named.length) hits = named;
    }
    return hits.length ? hits[0].conf : '';
  }

  // ── charge lists ─────────────────────────────────────────
  // The latest package code of a kind (or family) a booking carries in the log.
  function codeOnBooking(evs, fam) {
    const l = (evs || []).filter(e => famOf(kindOf(e.code)) === fam || famOf(e.code) === fam).sort((a, b) => b.ts - a.ts);
    const added = l.find(e => e.action === 'ADDED');
    return (added || l[0] || {}).code || '';
  }

  /** Journal lines that are package / upsell postings, as charges. */
  function chargesFromJournal(J, events, guests, opt) {
    opt = opt || {};
    const trx = opt.trx instanceof Map ? opt.trx : trxCodes(opt.trx);
    const known = new Set();
    Object.values(events || {}).forEach(l => l.forEach(e => e.code && known.add(String(e.code).toUpperCase())));
    const knownRe = known.size ? new RegExp('\\b(' + [...known].sort((a, b) => b.length - a.length).map(c => c.replace(/[^A-Z0-9]/g, '')).filter(Boolean).join('|') + ')\\b', 'i') : null;
    const idx = guestIndex(guests);
    const out = [];
    ((J && J.rows) || []).forEach(r => {
      if (isTd(r) || !r.amount) return;
      if (isPayment(r) && !trx.has(r.code)) return;   // a code you listed yourself always counts
      // Only the line's own package column / transaction description says what was charged;
      // a remark or reference can mention a package on any kind of line.
      const text = [r.pkg, r.desc].join(' ');
      const inText = knownRe ? (text.match(knownRe) || [])[1] : '';
      const word = kindFromText(r.desc);
      const inTrx = trx.has(r.code);
      if (!inText && !word && !inTrx) return;
      const conf = r.conf || linkConf(r, idx);
      const fam = word || (inTrx ? trx.get(r.code) : '');
      let code = inText ? inText.toUpperCase() : '';
      const evs = (events || {})[conf] || [];
      if (!code && conf && fam) code = codeOnBooking(evs, fam);
      if (!code && conf && inTrx && !fam) {   // a configured code with no kind: the booking's only package kind
        const ks = [...new Set(evs.map(e => kindOf(e.code)))];
        if (ks.length === 1) code = codeOnBooking(evs, famOf(ks[0]) || ks[0]);
      }
      const g = (guests || {})[conf] || {};
      out.push({
        date: r.date, room: r.room || roomKey(g.room), conf, guest: g.name || r.guest,
        code, kind: code ? kindOf(code) : fam, amount: r.amount, src: 'journal',
        srcLine: `${r.code} ${r.desc}`.trim() + (r.trxNo ? ` · trx ${r.trxNo}` : ''),
      });
    });
    return out;
  }

  /** IN-Gauge rows (when that export is loaded on the Audit tab), as charges. */
  function chargesFromIngauge(rows, events, guests) {
    const FAM = { 'early check in': 'EC', 'late check out': 'LC', breakfast: 'BB' };
    return (rows || []).filter(u => u && u.status !== 'DENIED').map(u => {
      const evs = (events || {})[u.conf] || [];
      let code = '';
      const fam = FAM[String(u.product || '').toLowerCase()] || '';
      if (/unknown/i.test(u.product)) {
        const m = evs.filter(e => e.action === 'ADDED' && e.price && Math.abs(parseFloat(e.price) - u.charge) < 0.02);
        if (new Set(m.map(e => e.code)).size === 1) code = m[0].code;
      } else if (fam) code = codeOnBooking(evs, fam);
      else code = String(u.product || '').replace(/\s+/g, '').toUpperCase();
      const g = (guests || {})[u.conf] || {};
      return { date: dayNum(u.daily), room: roomKey(u.room || g.room), conf: u.conf, guest: g.name || '', code,
        kind: code ? kindOf(code) : fam, amount: r2(u.charge), src: 'ingauge', srcLine: `IN-Gauge: ${u.product}` };
    }).filter(c => c.date);
  }

  /** No journal: nights from each package's date range in the log × its price. */
  function chargesFromLog(events, guests, deleted, today) {
    const out = [];
    deleted = deleted || (typeof pkgDeleted !== 'undefined' ? pkgDeleted : {});
    // only nights already charged: up to yesterday (tonight's posts at night audit)
    if (!today) { const t = new Date(); today = t.getFullYear() * 10000 + (t.getMonth() + 1) * 100 + t.getDate(); }
    const lastNight = addDays(today, -1);
    Object.entries(events || {}).forEach(([conf, evs]) => {
      const g = (guests || {})[conf] || {};
      const byKind = {};
      evs.forEach(e => { const k = kindOf(e.code); if (k) (byKind[k] = byKind[k] || []).push(e); });
      Object.entries(byKind).forEach(([k, list]) => {
        const sorted = list.slice().sort((a, b) => b.ts - a.ts);
        const ranged = sorted.find(e => e.from && e.to && dayNum(e.from) && dayNum(e.to));
        if (!ranged) return;
        const priced = sorted.find(e => e.action === 'ADDED' && e.price);
        const lastAdd = sorted.find(e => e.action === 'ADDED');
        const code = (lastAdd || ranged).code;
        // taken off the booking after it was last added (e.g. UPS45BB deleted, USS50 sold instead): not charged
        const del = (deleted[conf] || []).filter(x => x.code === code && x.ts >= (lastAdd ? lastAdd.ts : 0));
        if (del.length) return;
        let a = dayNum(ranged.from), b = dayNum(ranged.to);
        if (b < a) [a, b] = [b, a];
        const ga = dayNum(g.arr), gd = dayNum(g.dep);
        if (ga && a < ga) a = ga;
        if (gd && gd > ga && b >= gd) b = addDays(gd, -1);
        if (b > lastNight) b = lastNight;
        if (b < a) return;
        const fam = famOf(k);
        const nights = fam === 'EC' ? [a] : fam === 'LC' ? [b] : [];
        if (!nights.length) for (let d = a, i = 0; d <= b && i < 120; d = addDays(d, 1), i++) nights.push(d);
        const amount = priced ? r2(priced.price) : 0;
        nights.forEach(d => out.push({ date: d, room: roomKey(g.room), conf, guest: g.name || '', code, kind: k, amount,
          src: 'log', estimated: true, priceMissing: !priced,
          srcLine: `Estimated: ${code} ${ranged.from} → ${ranged.to}${priced ? ' × ' + priced.price : ' (no price in the log)'}` }));
      });
    });
    return out.sort((x, y) => x.date - y.date || String(x.conf).localeCompare(String(y.conf)));
  }

  // ── who owns each charge: the Package Audit rules ─────────
  const isSys = u => (typeof _pkgIsSystemUser === 'function' ? _pkgIsSystemUser(u) : false);
  const same = (a, b) => (typeof _pkgSameUser === 'function' ? _pkgSameUser(a, b) : String(a) === String(b));
  const label = u => (typeof _pkgUserLabel === 'function' ? _pkgUserLabel(u) : String(u || '').split('@')[0]);
  const rule = k => (typeof _pkgRule === 'function' ? _pkgRule(k) : true);
  const byTs = (a, b) => (a.ts || 0) - (b.ts || 0);

  /**
   * Decides the seller of every charge, exactly as the Package Audit would:
   * the first real person who put that kind of package on the booking
   * (same kind at another price = same package), an extension keeps the
   * stay's first seller for the same kind, a different kind is a new sale,
   * TARS / system entries are no seller, early / late check-out once per
   * stay, and a pinned seller in Package Audit wins.
   * Adds to each charge: status (owned | system | noOpera | nolink | dup),
   * owner, decider (the Opera entry that decides), matched, evidence, extendedFrom.
   */
  function own(charges, events, guests) {
    events = events || {}; guests = guests || {};
    const chains = (Object.keys(guests).length && rule('chain') && typeof _pkgBuildChains === 'function') ? _pkgBuildChains(guests) : {};
    const arrOf = c => dayNum((guests[c] || {}).arr) || 0;

    charges.forEach(ch => {
      Object.assign(ch, { status: '', owner: null, decider: null, matched: null, evidence: [], extendedFrom: '', newKindOnExt: '', stayFromSystem: '', pinned: false, dupOf: 0 });
      if (!ch.conf) { ch.status = 'nolink'; return; }
      const cands = events[ch.conf] || [];
      const sameKind = ch.kind ? cands.filter(e => kindOf(e.code) === ch.kind) : [];
      ch.evidence = sameKind.slice().sort(byTs);
      if (!sameKind.length) { ch.status = 'noOpera'; return; }
      const priced = sameKind.filter(e => e.price && Math.abs(parseFloat(e.price) - ch.amount) < 0.02);
      const pick = l => l.slice().sort(byTs)[0] || null;
      const ev = pick(priced) || pick(sameKind);
      const origin = typeof _pkgOriginatorFor === 'function' ? _pkgOriginatorFor(ev, cands) : ev;
      ch.matched = ev; ch.decider = origin || ev;
      ch.owner = origin ? origin.user : null;
      ch.status = origin ? 'owned' : 'system';
    });

    // The stay: an extension keeps the first seller for the same kind of package.
    const headOwner = {};
    charges.forEach(ch => { if (ch.status === 'owned' && (!chains[ch.conf] || chains[ch.conf] === ch.conf) && !headOwner[ch.conf]) headOwner[ch.conf] = { user: ch.owner, ev: ch.decider }; });
    function earlierKinds(h, conf) {
      const kinds = new Map();
      Object.keys(chains).filter(c => chains[c] === h && c !== conf && arrOf(c) < arrOf(conf)).forEach(c => {
        (events[c] || []).forEach(e => {
          const k = kindOf(e.code); if (!k) return;
          const cur = kinds.get(k);
          if (!cur || e.ts < cur.ts) kinds.set(k, { user: e.user, ts: e.ts, ev: Object.assign({ conf: c }, e) });
        });
        charges.forEach(x => { if (x.conf === c && x.kind && !kinds.has(x.kind)) kinds.set(x.kind, null); });
      });
      return kinds;
    }
    charges.forEach(ch => {
      const h = chains[ch.conf];
      if (!h || h === ch.conf || ch.status === 'nolink') return;
      let stay = headOwner[h] || null;
      if (!stay && typeof _pkgOwnerFromOpera === 'function') {
        const o = _pkgOwnerFromOpera(h, events);
        if (o) stay = { user: o.user, ev: (events[h] || []).slice().sort(byTs).find(e => !isSys(e.user)) };
      }
      if (ch.kind) {
        const before = earlierKinds(h, ch.conf);
        if (before.size && !before.has(ch.kind) && rule('sameKind')) { ch.newKindOnExt = h; return; }
        const first = before.get(ch.kind);
        if (first && first.user) {
          const prior = Object.keys(chains).filter(c => chains[c] === h && c !== ch.conf && arrOf(c) < arrOf(ch.conf))
            .flatMap(c => (events[c] || []).filter(e => kindOf(e.code) === ch.kind).map(e => Object.assign({ conf: c }, e)));
          ch.evidence = prior.concat(ch.evidence).sort(byTs);
          if (isSys(first.user)) { ch.stayFromSystem = h; return; }   // the stay began online: this booking's own result stands
          stay = (!stay || !same(stay.user, first.user)) ? { user: first.user, ev: first.ev } : { user: stay.user, ev: first.ev };
        }
      }
      if (!stay || !stay.user || isSys(stay.user)) return;
      ch.owner = stay.user; ch.status = 'owned'; ch.extendedFrom = h; ch.decider = stay.ev || ch.decider;
    });

    // Early check-in / late check-out: once per stay (per booking, as in the audit).
    if (rule('oneTime')) {
      const groups = {};
      charges.forEach(ch => { const f = famOf(ch.kind); if ((f === 'EC' || f === 'LC') && (ch.status === 'owned' || ch.status === 'system')) (groups[ch.conf + '|' + ch.kind] = groups[ch.conf + '|' + ch.kind] || []).push(ch); });
      Object.values(groups).forEach(list => {
        if (list.length < 2) return;
        const opera = new Set(list.flatMap(c => c.evidence.map(e => dayNum(e.from))).filter(Boolean));
        list.sort((a, b) => a.date - b.date);
        const keep = list.find(c => opera.has(c.date)) || list[0];
        list.forEach(c => { if (c !== keep) { c.status = 'dup'; c.dupOf = keep.date; } });
      });
    }

    // A seller pinned in Package Audit (a person's decision) beats the log.
    const pins = (typeof pkgPins !== 'undefined' && pkgPins) || {};
    if (typeof _pkgPinKey === 'function') charges.forEach(ch => {
      if (!ch.conf || ch.status === 'dup') return;
      const pin = pins[_pkgPinKey({ conf: ch.conf, product: '', code: ch.code || ch.kind })];
      if (pin && pin.seller && !pin.skip) { ch.owner = pin.seller; ch.status = 'owned'; ch.pinned = true; }
    });
    return charges;
  }

  // ── one person's view ────────────────────────────────────
  function isPerson(user, person) {
    if (!user || !person) return false;
    if (same(user, person)) return true;
    const a = String(label(user)).trim().toLowerCase(), b = String(label(person)).trim().toLowerCase();
    return !!a && a === b;
  }
  /** { mine, close } for a person in a period (YYYYMMDD, inclusive). */
  function split(charges, person, from, to) {
    const mine = [], close = [];
    charges.forEach(ch => {
      if ((from && ch.date < from) || (to && ch.date > to)) return;
      if (ch.status === 'owned' && isPerson(ch.owner, person)) { mine.push(ch); return; }
      if (ch.status === 'nolink') return;
      if (ch.evidence.some(e => isPerson(e.user, person))) close.push(ch);
    });
    const ord = (a, b) => a.date - b.date || roomKey(a.room) - roomKey(b.room) || String(a.conf).localeCompare(String(b.conf));
    return { mine: mine.sort(ord), close: close.sort(ord) };
  }
  /** Everyone the rules credit, as a picker list: [{ key, label, nights }]. */
  function sellers(charges) {
    const out = [];
    charges.forEach(ch => {
      if (ch.status !== 'owned' || !ch.owner) return;
      let s = out.find(x => same(x.key, ch.owner) || x.label === label(ch.owner));
      if (!s) { s = { key: String(ch.owner).split('@')[0], label: label(ch.owner), nights: 0 }; out.push(s); }
      s.nights++;
    });
    return out.sort((a, b) => b.nights - a.nights || a.label.localeCompare(b.label));
  }
  /** The seller that is the signed-in person, from their profile name. */
  function personFor(name, list) {
    if (!name) return '';
    const n = String(name).trim().toLowerCase();
    const hit = list.find(s => s.label.toLowerCase() === n) || list.find(s => same(s.key, name));
    return hit ? hit.key : '';
  }

  // ── plain words ──────────────────────────────────────────
  const evLine = e => e ? `${e.action === 'ADDED' ? 'ADDED' : e.action} ${e.code} · ${String(e.user || '').split('@')[0] || '?'} · ${tsLabel(e.ts) || 'no time'}${e.price ? ' · price ' + e.price : ''}${e.from ? ` · ${e.from} → ${e.to || '?'}` : ''}${e.conf ? ' · conf ' + e.conf : ''}` : '';
  const who = u => (isSys(u) ? 'an online / TARS booking' : label(u));
  const srcWords = ch => ch.src === 'log' ? (ch.priceMissing ? ' Night estimated from the Opera log date range; the log shows no price.' : ' Night estimated from the Opera log date range × price (no journal loaded).')
    : ch.src === 'ingauge' ? ' Charge taken from the IN-Gauge export.' : ` Posted in the Opera journal (${ch.srcLine}).`;

  function whyMine(ch, person) {
    const kl = kindLabel(ch.kind, ch.code).toLowerCase(), d = ch.decider;
    let s;
    if (ch.pinned) s = `Pinned to you in Package Audit (a decision a person made, it beats the log).`;
    else if (ch.extendedFrom) s = `Extension of conf ${ch.extendedFrom}: same stay, and you started this ${kl}${d ? ` (${d.code} on ${tsShort(d.ts)})` : ''}.`;
    else s = `You ${d && d.action !== 'ADDED' ? 'attached' : 'added'} ${d ? d.code : ch.code} on ${d ? tsShort(d.ts) : '?'} (Opera log), the first person to put ${kl} on this booking.`;
    const others = [...new Set(ch.evidence.filter(e => !isPerson(e.user, person) && !isSys(e.user) && d && e.ts > d.ts).map(e => label(e.user)))];
    if (!ch.pinned && others.length) s += ` Later changes by ${others.join(', ')} do not move the sale.`;
    if (!ch.pinned && ch.evidence.some(e => isSys(e.user) && d && e.ts < d.ts)) s += ' The earlier online / TARS entry is no seller.';
    if (ch.newKindOnExt) s += ` It is a new kind of package on an extension of conf ${ch.newKindOnExt}, so it is a new sale.`;
    if (ch.stayFromSystem) s += ` The stay began on an online booking (conf ${ch.stayFromSystem}), so this booking's own seller counts.`;
    return s + srcWords(ch);
  }
  function whyNot(ch, person) {
    const kl = kindLabel(ch.kind, ch.code).toLowerCase(), d = ch.decider;
    const mineEv = ch.evidence.find(e => isPerson(e.user, person));
    const yours = mineEv ? ` Your entry: ${mineEv.action} ${mineEv.code} on ${tsShort(mineEv.ts)}.` : '';
    if (ch.status === 'dup') return `${kindLabel(ch.kind, ch.code)} counts once per stay; it is already counted on ${dnShort(ch.dupOf)}.${yours}`;
    if (ch.status === 'system') return `This ${kl} came with ${d ? who(d.user) : 'a system booking'} (${d ? d.code + ' ' + tsShort(d.ts) : ''}): online / TARS bookings have no desk seller.${yours}`;
    if (ch.status === 'noOpera') return `The Opera log shows no ${kl} on this booking, so nobody can be credited.${yours}`;
    if (ch.pinned) return `Pinned to ${label(ch.owner)} in Package Audit.${yours}`;
    if (ch.extendedFrom) return `Extension of conf ${ch.extendedFrom}: ${label(ch.owner)} started this ${kl} on the first booking${d ? ` (${tsShort(d.ts)})` : ''}, and the stay keeps its first seller.${yours}`;
    return `${label(ch.owner)} put ${kl} on first (${d ? d.code + ', ' + tsShort(d.ts) : '?'}); the first person keeps the package, even at another price.${yours}`;
  }

  // ── state ────────────────────────────────────────────────
  const S = {
    journal: null, journalFile: null, logFiles: [], guestFile: null,
    person: '', from: 0, to: 0, userDates: false, source: 'auto',
    charges: [], view: null, sellers: [], usedSource: '', note: '',
    trx: (() => { try { return localStorage.getItem(TRX_KEY) || ''; } catch (_) { return ''; } })(),
    showAll: false, records: {}, recordKey: '', mounted: false,
  };
  const evs = () => (typeof pkgEvents !== 'undefined' && pkgEvents) || {};
  const gst = () => (typeof pkgGuests !== 'undefined' && pkgGuests) || {};
  const igRows = () => (typeof pkgUnknowns !== 'undefined' && Array.isArray(pkgUnknowns)) ? pkgUnknowns : [];

  function compute() {
    const E = evs(), G = gst(), trx = trxCodes(S.trx);
    const J = S.journal;
    const fromJ = J ? chargesFromJournal(J, E, G, { trx }) : [];
    const ig = igRows();
    let src = S.source;
    if (src === 'auto') src = fromJ.length ? 'journal' : ig.length ? 'ingauge' : 'log';
    S.usedSource = src;
    S.note = '';
    if (J && !fromJ.length) {
      const tdOnly = J.rows.length && J.rows.every(isTd);
      S.note = tdOnly
        ? `The journal you loaded has only Tourism Dirham (7510) lines: no package charges in it. ${src === 'log' ? 'The nights below are estimated from the Opera log.' : ''} Export it again with the package codes (see "How to export the journal").`
        : 'No package postings found in the journal. Add your hotel\'s package transaction codes under "How to export the journal".';
    }
    let list = src === 'journal' ? fromJ : src === 'ingauge' ? chargesFromIngauge(ig, E, G) : chargesFromLog(E, G);
    S.charges = own(list, E, G);
    S.sellers = sellers(S.charges);
    // Who: the chosen person, else the signed-in person, else the top seller.
    if (!S.person || !S.sellers.some(s => same(s.key, S.person))) {
      S.person = personFor(me(), S.sellers) || S.person || (S.sellers[0] || {}).key || '';
    }
    // When: the journal's dates, else the charges' month, else this month.
    if (!S.userDates) {
      if (J && J.min) { S.from = J.min; S.to = J.max; }
      else {
        const t = new Date(), today = t.getFullYear() * 10000 + (t.getMonth() + 1) * 100 + t.getDate();
        S.from = Math.floor(today / 100) * 100 + 1; S.to = today;
      }
    }
    S.view = split(S.charges, S.person, S.from, S.to);
  }

  function totals(rows) {
    const pk = new Set(), byKind = {}, byDay = {};
    let aed = 0;
    rows.forEach(r => {
      pk.add(r.conf + '|' + r.kind); aed += +r.amount || 0;
      const k = byKind[r.kindLabel || kindLabel(r.kind, r.code)] = byKind[r.kindLabel || kindLabel(r.kind, r.code)] || { kind: r.kind, nights: 0, aed: 0, pk: new Set() };
      k.nights++; k.aed += +r.amount || 0; k.pk.add(r.conf);
      const d = byDay[r.date] = byDay[r.date] || { nights: 0, aed: 0 };
      d.nights++; d.aed += +r.amount || 0;
    });
    return { upsells: pk.size, nights: rows.length, aed: r2(aed), byKind, byDay };
  }

  // Rows exactly as the Excel / a snapshot holds them.
  function exportRows(list, person, mine) {
    return list.map(ch => {
      const d = ch.decider;
      return {
        date: ch.date, conf: ch.conf, room: ch.room, guest: ch.guest, code: ch.code || '', kind: ch.kind || '',
        kindLabel: kindLabel(ch.kind, ch.code), amount: r2(ch.amount),
        soldOn: d ? tsLabel(d.ts) : '', soldBy: d ? (label(d.user) !== String(d.user).split('@')[0] ? `${String(d.user).split('@')[0]} → ${label(d.user)}` : String(d.user).split('@')[0]) : '',
        why: mine ? whyMine(ch, person) : whyNot(ch, person),
        evidence: d ? evLine(d) + (ch.evidence.length > 1 ? ` (+${ch.evidence.length - 1} more Opera entr${ch.evidence.length - 1 === 1 ? 'y' : 'ies'})` : '') : (ch.srcLine || ''),
        src: ch.src === 'log' ? 'Estimated from Opera log' : ch.src === 'ingauge' ? 'IN-Gauge export' : 'Opera journal',
        owner: ch.owner ? label(ch.owner) : '',
      };
    });
  }
  function evidenceRows(list) {
    const seen = new Set(), out = [];
    list.forEach(ch => ch.evidence.forEach(e => {
      const k = (e.conf || ch.conf) + '|' + e.ts + '|' + e.code + '|' + e.action + '|' + e.user;
      if (seen.has(k)) return; seen.add(k);
      out.push({ conf: e.conf || ch.conf, room: ch.room, guest: ch.guest, action: e.action, code: e.code, kind: kindLabel(kindOf(e.code), e.code),
        login: String(e.user || '').split('@')[0], name: isSys(e.user) ? 'system / online' : label(e.user), when: tsLabel(e.ts), ts: e.ts,
        price: e.price || '', from: e.from || '', to: e.to || '', used: ch.decider && ch.decider.ts === e.ts && ch.decider.code === e.code && ch.decider.user === e.user ? 'Decides the seller' : '' });
    }));
    return out.sort((a, b) => String(a.conf).localeCompare(String(b.conf)) || a.ts - b.ts);
  }
  function filesInfo() {
    const out = [];
    const logs = S.logFiles.length ? S.logFiles : ((typeof pkgPdfFiles !== 'undefined' && pkgPdfFiles) || []).map(n => ({ name: n }));
    logs.forEach(f => out.push(['Opera User Activity Log', f.name, f.date ? new Date(f.date).toLocaleString('en-GB') : '']));
    if (typeof pkgLogRange !== 'undefined' && pkgLogRange && pkgLogRange.max) out.push(['  (the log covers)', `${dnLabel(pkgLogRange.min)} → ${dnLabel(pkgLogRange.max)}`, '']);
    if (S.guestFile) out.push(['Opera Reservation Detail', S.guestFile.name, S.guestFile.date ? new Date(S.guestFile.date).toLocaleString('en-GB') : '']);
    else if (Object.keys(gst()).length) out.push(['Opera Reservation Detail', 'loaded on the Audit tab', '']);
    if (S.journalFile) out.push(['Opera Journal by Transaction Code', S.journalFile.name, S.journalFile.date ? new Date(S.journalFile.date).toLocaleString('en-GB') : '']);
    return out;
  }
  const SOURCE_WORDS = { journal: 'Opera journal (posted charges)', ingauge: 'IN-Gauge export (Audit tab)', log: 'Estimated from the Opera User Activity Log (date range × price)' };
  function rulesText() {
    const lines = [
      'Who an upsell belongs to: the same rules as the Package Audit in HotelOps.',
      '1. The first person who put that kind of package on the booking gets it. Later changes by others (new dates, new price) do not move it.',
      '2. The same kind at another price is the same package (UPS30BB = UPS60BB = BBWIN: breakfast; USS50 = USS75: room upgrade; USS100EC = USS225EC: early check-in).',
      '3. A back-to-back extension of the same guest (new confirmation number, starts the day the last one ends) is one stay: it keeps the first seller for the same kind of package.',
      '4. A different kind of package sold on the extension is a new sale, for whoever sold it.',
      '5. Online / TARS / system bookings have no desk seller.',
      '6. Early check-in and late check-out count once per stay.',
      '7. A seller pinned in Package Audit (a person\'s decision) beats the log.',
      'Nights: from the Opera journal when it has package postings; otherwise from the Opera log date range × price (marked "estimated").',
      'The journal has no confirmation number: a posting is linked to a booking by room + night in the Reservation Detail.',
      '',
      'Rule switches as set in Package Audit → ⚙️ Rules now:',
    ];
    (typeof PKG_RULE_INFO !== 'undefined' ? PKG_RULE_INFO : []).forEach(r => {
      const on = typeof _pkgRuleOn === 'function' ? _pkgRuleOn(r.k) : !!rule(r.k);
      lines.push(`${on ? 'ON ' : 'OFF'} · ${r.t}`);
    });
    return lines;
  }

  /** Everything one Excel file holds. */
  function reportData() {
    const person = S.person, name = label(person) || person || 'Unknown';
    const rows = exportRows(S.view.mine, person, true);
    return {
      name, login: String(person).split('@')[0], from: S.from, to: S.to, madeAt: nowStamp(), madeBy: me() || name,
      source: SOURCE_WORDS[S.usedSource] || '', files: filesInfo(), rows,
      close: exportRows(S.view.close, person, false), evidence: evidenceRows(S.view.mine), totals: totals(rows), rules: rulesText(),
    };
  }
  function snapshotData(snap) {
    const rows = (snap.rows || []).map(r => Object.assign({ kindLabel: kindLabel(r.kind, r.code), soldOn: r.sold || '', soldBy: r.by || '', src: r.src || '' }, r));
    return {
      name: snap.name, login: snap.login || '', from: snap.from, to: snap.to, madeAt: snap.savedAtLabel || new Date(snap.savedAt).toLocaleString('en-GB'),
      madeBy: snap.savedBy || '', source: snap.source || '', files: snap.files || [], rows, close: [],
      evidence: rows.map(r => ({ conf: r.conf, room: r.room, guest: r.guest, action: '', code: r.code, kind: r.kindLabel, login: '', name: '', when: r.soldOn, price: '', from: '', to: '', used: r.evidence })),
      totals: totals(rows), rules: rulesText(), saved: true,
    };
  }
  const fileName = D => {
    const who = String(D.name || '').replace(/^ACCOREN-/i, '').replace(/@.*$/, '').replace(/[^A-Za-z0-9 ]+/g, ' ').trim() || 'Me';
    const f = String(D.from), t = String(D.to), mon = n => ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+n.slice(4, 6) - 1] + ' ' + n.slice(0, 4);
    const wholeMonth = f.slice(0, 6) === t.slice(0, 6) && f.slice(6) === '01' && +t.slice(6) === new Date(+t.slice(0, 4), +t.slice(4, 6), 0).getDate();
    return `Upsells - ${who} - ${wholeMonth ? mon(f) : dnLabel(D.from) + ' to ' + dnLabel(D.to)}.xlsx`;
  };

  // ── Excel: ExcelJS (colours) with a plain SheetJS fallback ─
  let _ejs = null;
  function loadExcelJS() {
    if (global.ExcelJS) return Promise.resolve(global.ExcelJS);
    if (_ejs) return _ejs;
    _ejs = new Promise((ok, no) => {
      const s = document.createElement('script');
      s.src = EXCELJS_URL; s.async = true;
      const t = setTimeout(() => no(new Error('timed out')), 20000);
      s.onload = () => { clearTimeout(t); global.ExcelJS ? ok(global.ExcelJS) : no(new Error('not loaded')); };
      s.onerror = () => { clearTimeout(t); no(new Error('could not load')); };
      document.head.appendChild(s);
    }).catch(e => { _ejs = null; throw e; });
    return _ejs;
  }


  // ── The Excel: a plain, tidy record to hand to a manager ──
  // No app names anywhere (sheets, text or file properties): just the upsells, the reason for each
  // in a short sentence, and the Opera log lines behind them.
  const cleanName = n => String(n || '').replace(/^ACCOREN-/i, '').replace(/@.*$/, '').trim() || 'Me';
  /** "Sold by me on 8 Oct 18:36" (+ "· extension of 617966995, same stay") */
  function shortReason(r) {
    const ext = String(r.why || '').match(/[Ee]xtension of conf (\d+)/);
    const sold = r.soldOn ? `Sold by me on ${r.soldOn}` : 'Sold by me';
    return ext ? `${sold} · extension of ${ext[1]} (same stay)` : sold;
  }
  const sheetRows = D => D.rows.map((r, i) => ({ n: i + 1, date: dnDate(r.date), conf: String(r.conf || ''), room: String(r.room || ''), guest: r.guest || '',
    code: r.code || '', type: r.kindLabel || '', amount: r.amount, sold: r.soldOn || '', reason: shortReason(r), est: r.src === 'log' }));
  const NAVY = 'FF1F3864', ZEBRA = 'FFF4F6FA', LINE = 'FFBFC7D5', TOT = 'FFE7ECF5';
  const fillOf = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
  const thin = { style: 'thin', color: { argb: LINE } };
  const box = { top: thin, left: thin, bottom: thin, right: thin };
  const center = { horizontal: 'center', vertical: 'middle', wrapText: true };
  const left = { horizontal: 'left', vertical: 'middle', wrapText: true };

  function buildExcelJS(EJ, D) {
    const wb = new EJ.Workbook();
    const who = cleanName(D.name);
    wb.creator = who; wb.lastModifiedBy = who; wb.company = ''; wb.title = `Upsells ${who}`; wb.created = new Date(); wb.modified = new Date();
    const T = D.totals, R = sheetRows(D);

    // Sheet 1: Upsells
    const ws = wb.addWorksheet('My Upsells', { views: [{ showGridLines: false }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } } });
    const COLS = [['No.', 6], ['Date', 13], ['Confirmation No.', 17], ['Room', 8], ['Guest Name', 30], ['Package', 12], ['Type', 16], ['Amount (AED)', 14], ['Sold On', 18]];
    const N = COLS.length, lastCol = String.fromCharCode(64 + N);
    ws.columns = COLS.map(([, w]) => ({ width: w }));
    const titleRow = (row, text, font, h) => { ws.mergeCells(`A${row}:${lastCol}${row}`); const c = ws.getCell(`A${row}`); c.value = text; c.font = font; c.alignment = { horizontal: 'center', vertical: 'middle' }; if (h) ws.getRow(row).height = h; };
    titleRow(1, 'UPSELL REPORT', { size: 18, bold: true, color: { argb: 'FFFFFFFF' } }, 34);
    ws.getCell('A1').fill = fillOf(NAVY);
    titleRow(2, `${who}   |   ${dnLabel(D.from)} – ${dnLabel(D.to)}`, { size: 12, bold: true, color: { argb: NAVY } }, 24);
    ws.getCell('A2').fill = fillOf('FFDCE3F0');
    titleRow(3, `${T.upsells} Upsells   |   ${T.nights} Nights   |   Total AED ${money(T.aed)}`, { size: 12, bold: true, color: { argb: 'FF1B5E20' } }, 24);
    ws.getCell('A3').fill = fillOf('FFE8F5E9');
    const HR = 5, hr = ws.getRow(HR);
    COLS.forEach(([h], k) => { const c = hr.getCell(k + 1); c.value = h; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = fillOf(NAVY); c.alignment = center; c.border = box; });
    hr.height = 22;
    R.forEach((r, k) => {
      const row = ws.getRow(HR + 1 + k);
      row.values = [r.n, r.date, r.conf, r.room, r.guest, r.code, r.type, r.amount, r.sold];
      row.height = 20;
      row.eachCell({ includeEmpty: true }, (c, n) => {
        if (n > N) return;
        c.border = box; c.alignment = center;
        if (k % 2) c.fill = fillOf(ZEBRA);
      });
      const kf = (KIND_STYLE[famOf(D.rows[k].kind)] || {}).fill;
      if (kf) row.getCell(7).fill = fillOf(kf);
      row.getCell(8).font = { bold: true };
      row.getCell(2).numFmt = 'dd-mmm-yyyy';
      row.getCell(8).numFmt = '#,##0.00';
    });
    const tr = ws.getRow(HR + 1 + R.length);
    tr.values = ['', 'Total', '', '', `${T.upsells} upsells · ${T.nights} nights`, '', '', T.aed, ''];
    tr.height = 22;
    tr.eachCell({ includeEmpty: true }, (c, n) => { if (n > N) return; c.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } }; c.fill = fillOf(NAVY); c.border = box; c.alignment = center; });
    tr.height = 26;
    tr.getCell(8).numFmt = '#,##0.00';
    ws.views = [{ state: 'frozen', ySplit: HR, topLeftCell: 'A' + (HR + 1), activeCell: 'A' + (HR + 1), showGridLines: false }];

    // Sheet 2: Evidence (the Opera log lines behind each upsell)
    const ev = wb.addWorksheet('Evidence', { views: [{ showGridLines: false }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true } });
    const EC = [['Confirmation No.', 17], ['Room', 8], ['Guest Name', 28], ['Action', 11], ['Package', 12], ['Type', 16], ['User', 20], ['Date / Time', 18], ['Price', 10], ['From', 12], ['To', 12]];
    ev.columns = EC.map(([, w]) => ({ width: w }));
    ev.mergeCells(1, 1, 1, EC.length);
    const et = ev.getCell('A1'); et.value = `EVIDENCE   |   ${who}   |   ${dnLabel(D.from)} – ${dnLabel(D.to)}`;
    et.font = { size: 14, bold: true, color: { argb: 'FFFFFFFF' } }; et.fill = fillOf(NAVY); et.alignment = center; ev.getRow(1).height = 30;
    ev.spliceRows(2, 0, []);
    const eh = ev.getRow(3); eh.height = 22;
    EC.forEach(([h], k) => { const c = eh.getCell(k + 1); c.value = h; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = fillOf(NAVY); c.alignment = center; c.border = box; });
    ev.views = [{ state: 'frozen', ySplit: 3, showGridLines: false }];
    let ey = 4;
    D.evidence.forEach((e, k) => {
      const r = ev.getRow(ey++);
      r.values = [e.conf, e.room || '', e.guest || '', e.action, e.code, e.kind, cleanName(e.login || e.name), e.when, e.price, e.from, e.to];
      r.height = 18;
      r.eachCell({ includeEmpty: true }, (c, n) => { if (n > EC.length) return; c.border = box; c.alignment = center; if (k % 2) c.fill = fillOf(ZEBRA); });
    });
    return wb;
  }

  function buildSheetJS(D) {
    const X = global.XLSX;
    const wb = X.utils.book_new();
    wb.Props = { Title: `Upsells ${cleanName(D.name)}`, Author: cleanName(D.name), Company: '' };
    const T = D.totals, R = sheetRows(D), who = cleanName(D.name);
    const aoa = [['Upsell Report'], [`${who}   ·   ${dnLabel(D.from)} – ${dnLabel(D.to)}`], [`${T.upsells} upsells · ${T.nights} nights · AED ${money(T.aed)}`], [],
      ['No.', 'Date', 'Confirmation No.', 'Room', 'Guest Name', 'Package', 'Type', 'Amount (AED)', 'Sold On'],
      ...R.map(r => [r.n, r.date, r.conf, r.room, r.guest, r.code, r.type, r.amount, r.sold]),
      ['', 'Total', '', '', `${T.upsells} upsells · ${T.nights} nights`, '', '', T.aed, '']];
    const ws = X.utils.aoa_to_sheet(aoa, { cellDates: true, dateNF: 'dd-mmm-yyyy' });
    ws['!cols'] = [6, 13, 17, 8, 30, 12, 16, 14, 18].map(w => ({ wch: w }));
    ws['!merges'] = [0, 1, 2].map(r => ({ s: { r, c: 0 }, e: { r, c: 8 } }));
    for (let i = 6; i <= aoa.length; i++) { const x = ws['H' + i]; if (x && x.t === 'n') x.z = '#,##0.00'; }
    X.utils.book_append_sheet(wb, ws, 'My Upsells');
    const s3 = X.utils.aoa_to_sheet([['Confirmation No.', 'Room', 'Guest Name', 'Action', 'Package', 'Type', 'User', 'Date / Time', 'Price', 'From', 'To'],
      ...D.evidence.map(e => [e.conf, e.room || '', e.guest || '', e.action, e.code, e.kind, cleanName(e.login || e.name), e.when, e.price, e.from, e.to])]);
    s3['!cols'] = [17, 8, 28, 11, 12, 16, 20, 18, 10, 12, 12].map(w => ({ wch: w }));
    X.utils.book_append_sheet(wb, s3, 'Evidence');
    return X.write(wb, { bookType: 'xlsx', type: 'array' });
  }

  /** The .xlsx as an ArrayBuffer: styled when ExcelJS loads, plain otherwise. */
  async function xlsxBuffer(D, opt) {
    if (!(opt && opt.plain)) {
      try {
        const EJ = await loadExcelJS();
        return { buf: await buildExcelJS(EJ, D).xlsx.writeBuffer(), styled: true };
      } catch (e) {
        if (!global.XLSX) throw e;
        toast('The colour Excel engine did not load, so this is a plain Excel file.', 'warn');
      }
    }
    if (!global.XLSX) throw new Error('Excel engine not loaded');
    return { buf: buildSheetJS(D), styled: false };
  }
  function saveBlob(buf, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  async function download(D) {
    D = D || (S.view && reportData());
    if (!D || !D.rows.length) { toast('Nothing to put in the Excel yet: load the Opera files and pick a person', 'err'); return; }
    const btn = document.getElementById('muDl');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Making the Excel…'; }
    try {
      const { buf } = await xlsxBuffer(D);
      saveBlob(buf, fileName(D));
      if (typeof logActivity === 'function') logActivity('my_upsells_excel', `${D.name} ${dnIso(D.from)} → ${dnIso(D.to)} · ${D.rows.length} nights`);
      toast(`📥 ${fileName(D)} downloaded`, 'ok');
    } catch (e) { toast('Could not make the Excel: ' + e.message, 'err'); }
    finally { if (btn) { btn.disabled = false; btn.textContent = '📥 Download Excel'; } }
  }

  // ── saved records (append-only) ──────────────────────────
  const personKey = p => String(String(p || '').split('@')[0] || 'unknown').toUpperCase().replace(/[.#$\[\]\/\s]+/g, '_').slice(0, 60);
  /** The snapshot(s) for one save: one per 300 rows, all sharing a group id. */
  function snapshots(D, at) {
    at = at || Date.now();
    const d = new Date(at), p = n => String(n).padStart(2, '0');
    const base = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${Math.random().toString(36).slice(2, 6)}`;
    const rows = D.rows.map(r => ({ date: r.date, room: String(r.room || ''), conf: String(r.conf || ''), guest: String(r.guest || '').slice(0, 60), code: r.code, kind: r.kind, amount: r.amount,
      sold: r.soldOn, by: r.soldBy, why: String(r.why).slice(0, 400), evidence: String(r.evidence).slice(0, 300), src: r.src }));
    const parts = Math.max(1, Math.ceil(rows.length / SNAP_MAX_ROWS));
    const T = D.totals;
    const byKind = {}; Object.entries(T.byKind).forEach(([k, v]) => { byKind[k.replace(/[.#$\[\]\/]/g, ' ')] = { nights: v.nights, aed: r2(v.aed), upsells: v.pk.size }; });
    const out = [];
    for (let i = 0; i < parts; i++) {
      out.push({ id: parts > 1 ? `${base}-p${i + 1}` : base, snap: {
        name: D.name, login: D.login, from: D.from, to: D.to, savedAt: at, savedAtLabel: D.madeAt, savedBy: D.madeBy, source: D.source,
        files: (D.files || []).map(f => f.map(x => String(x || ''))),
        totals: { upsells: T.upsells, nights: T.nights, aed: T.aed, byKind },
        group: base, part: i + 1, parts, rows: rows.slice(i * SNAP_MAX_ROWS, (i + 1) * SNAP_MAX_ROWS),
      } });
    }
    return out;
  }
  async function saveRecord() {
    if (!S.view || !S.view.mine.length) { toast('Nothing to save yet', 'err'); return; }
    if (typeof fbSet !== 'function') { toast('The database is not ready', 'err'); return; }
    const D = reportData(), key = personKey(S.person);
    const list = snapshots(D);
    for (const s of list) await fbSet(`myUpsells/${key}/${s.id}`, s.snap);   // a new id every time: nothing older is touched
    if (typeof logActivity === 'function') logActivity('my_upsells_saved', `${D.name} ${dnIso(D.from)} → ${dnIso(D.to)} · ${D.rows.length} nights · ${D.totals.aed} AED`);
    toast(`📌 Saved: ${D.totals.upsells} upsells, ${money(D.totals.aed)} AED (${dnShort(D.from)} → ${dnShort(D.to)})`, 'ok');
    listenRecords();
  }
  /** Saved snapshots grouped back into records, newest first, with month totals (each night counted once). */
  function recordList(obj) {
    const groups = {};
    Object.entries(obj || {}).forEach(([id, s]) => {
      if (!s || typeof s !== 'object') return;
      const g = s.group || id;
      const cur = groups[g] = groups[g] || Object.assign({}, s, { id: g, rows: [], partsSeen: 0 });
      cur.rows = cur.rows.concat(Array.isArray(s.rows) ? s.rows : Object.values(s.rows || {}));
      cur.partsSeen++;
    });
    const list = Object.values(groups).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    const seen = new Set(), months = {};
    list.forEach(r => r.rows.forEach(x => {
      const k = `${x.date}|${x.conf}|${x.kind}|${x.amount}`;
      if (seen.has(k)) return; seen.add(k);
      const m = String(x.date).slice(0, 6), M = months[m] = months[m] || { nights: 0, aed: 0, pk: new Set() };
      M.nights++; M.aed = r2(M.aed + (+x.amount || 0)); M.pk.add(x.conf + '|' + x.kind);
    }));
    return { list, months };
  }
  function listenRecords() {
    const key = personKey(S.person);
    if (!S.person || typeof fbListen !== 'function' || S.records[key] !== undefined) { renderRecords(); return; }
    S.records[key] = null;
    try { fbListen('myUpsells/' + key, v => { S.records[key] = v || {}; renderRecords(); }); } catch (_) {}
  }

  // ── file loading ─────────────────────────────────────────
  async function busy(title, detail, fn) {
    if (typeof busyStart === 'function') { busyStart(title, detail); if (typeof busyPaint === 'function') await busyPaint(); }
    try { return await fn(); } finally { if (typeof busyDone === 'function') busyDone(); }
  }
  async function readText(file) {
    if (global.DtcmCore && global.DtcmCore.readTextSmart) return global.DtcmCore.readTextSmart(file);
    return new TextDecoder('utf-8').decode(await file.arrayBuffer());
  }
  async function loadLog(files) {
    if (typeof pdfjsLib === 'undefined') { toast('The PDF reader is still loading. Try again in a moment.', 'err'); return; }
    await busy('Reading the Opera User Activity Log', 'opening the PDF…', async () => {
      let fresh = 0;
      for (const f of files) {
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
        const ev = await _pkgParsePdfEvents(pdf, (d, t) => { if (typeof busyStep === 'function') busyStep(d, t, `reading page ${d} of ${t}`); });
        fresh += _pkgMergeEvents(pkgEvents, ev);
        if (typeof pkgPdfFiles !== 'undefined' && !pkgPdfFiles.includes(f.name)) pkgPdfFiles.push(f.name);
        if (!S.logFiles.some(x => x.name === f.name)) S.logFiles.push({ name: f.name, date: f.lastModified || 0 });
      }
      _pkgRecomputeLogRange();
      const n = Object.keys(pkgEvents).length;
      const lbl = document.getElementById('pkgPdfLabel');   // the Audit tab sees the same log
      if (lbl) lbl.textContent = n ? `✓ ${pkgPdfFiles.length} log${pkgPdfFiles.length !== 1 ? 's' : ''} · ${n} confirmations` : 'Loaded — no product events found';
      toast(n ? `✦ ${fresh} package entries read · ${n} confirmations` : 'No package entries found: was Search Text "product"?', n ? 'ok' : 'err');
    }).catch(e => toast('Could not read the Activity Log PDF: ' + e.message, 'err'));
    refresh();
  }
  async function loadGuests(file) {
    await busy('Reading the Reservation Detail', 'matching guests to bookings…', async () => {
      const buf = await file.arrayBuffer();
      const text = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(buf));
      pkgGuests = /CONFIRMATION_NO/.test(text.slice(0, 8192)) && text.includes('\t') ? _pkgParseResDetail(text)
        : (global.XLSX ? (() => { const wb = XLSX.read(buf, { type: 'array' }); return _pkgParseGuestList(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' })); })() : {});
      S.guestFile = { name: file.name, date: file.lastModified || 0 };
      const n = Object.keys(pkgGuests).length;
      const lbl = document.getElementById('pkgGuestLabel');
      if (lbl) lbl.textContent = n ? `✓ ${n} reservations` : 'Loaded — no Confirmation No. column found';
      toast(n ? `✦ ${n} reservations loaded` : 'No CONFIRMATION_NO column in this file', n ? 'ok' : 'err');
    }).catch(e => toast('Could not read the Reservation Detail: ' + e.message, 'err'));
    refresh();
  }
  async function loadJournal(file) {
    await busy('Reading the Opera journal', 'reading the postings…', async () => {
      const J = parseJournal(await readText(file));
      if (!J.ok) { toast('This is not a Journal by Transaction Code export (no TRX_CODE column)', 'err'); return; }
      S.journal = J; S.journalFile = { name: file.name, date: file.lastModified || 0 }; S.userDates = false;
      toast(`✦ Journal: ${J.lines} postings · ${dnShort(J.min)} → ${dnShort(J.max)}`, 'ok');
    }).catch(e => toast('Could not read the journal: ' + e.message, 'err'));
    refresh();
  }
  // Any file, anywhere: sorted by what it is.
  async function route(files, want) {
    files = [...(files || [])];
    const pdfs = files.filter(f => /\.pdf$/i.test(f.name));
    if (pdfs.length) await loadLog(pdfs);
    for (const f of files.filter(f => !/\.pdf$/i.test(f.name))) {
      const head = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(await f.slice(0, 8192).arrayBuffer())).replace(/\u0000/g, '');
      if (/TRX_CODE|TRX_DESC/i.test(head)) await loadJournal(f);
      else if (/CONFIRMATION_NO/i.test(head) || want === 'guests') await loadGuests(f);
      else if (want === 'journal') await loadJournal(f);
      else toast(`Not sure what ${f.name} is: use the Browse button of the right box`, 'warn');
    }
  }

  // ── screen ───────────────────────────────────────────────
  function style() {
    if (document.getElementById('mu-style')) return;
    const st = document.createElement('style'); st.id = 'mu-style';
    st.textContent = `
#muView{margin-top:4px}
#muView .mu-card{background:var(--card);border:1px solid var(--border);border-radius:var(--r,12px);padding:16px;margin-bottom:14px;min-width:0}
#muView .mu-hd{display:flex;gap:12px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;margin-bottom:12px}
#muView .mu-t{font-weight:700;font-size:1.05rem;color:var(--text)} #muView .mu-s{font-size:.74rem;color:var(--text2);margin-top:3px;line-height:1.5;max-width:640px}
#muView .mu-files{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
#muView .mu-drop{border:1.5px dashed var(--border2,var(--border));border-radius:12px;padding:12px;background:var(--bg2,var(--card2));display:flex;flex-direction:column;gap:6px;min-width:0;transition:border-color .15s,background .15s}
#muView .mu-drop.over{border-color:var(--accent);background:var(--accent-bg,var(--card2))}
#muView .mu-drop.ok{border-style:solid;border-color:color-mix(in srgb,var(--green) 55%,transparent);background:color-mix(in srgb,var(--green) 7%,var(--card))}
#muView .mu-drop h4{margin:0;font-size:.8rem;font-weight:700;color:var(--text);display:flex;gap:6px;align-items:center}
#muView .mu-drop h4 i{font-style:normal;flex:none;width:20px;height:20px;border-radius:50%;display:inline-grid;place-items:center;font-size:.66rem;background:var(--border);color:var(--text2)}
#muView .mu-drop.ok h4 i{background:var(--green);color:#fff}
#muView .mu-drop .mu-rep{font:600 .66rem var(--mono);color:var(--text3);overflow-wrap:anywhere}
#muView .mu-drop .mu-st{font-size:.7rem;color:var(--text2);line-height:1.4;overflow-wrap:anywhere;min-height:2.8em}
#muView .mu-drop.ok .mu-st{color:var(--green);font-weight:600}
#muView .mu-drop .mu-opt{font-weight:400;color:var(--text3);font-size:.68rem}
#muView .mu-drop button{align-self:flex-start}
#muView .mu-ig{margin-top:10px;font-size:.72rem;color:var(--text2);padding:8px 10px;border-radius:10px;background:var(--bg2,var(--card2));border:1px solid var(--border)}
#muView details.mu-how{margin-top:10px;font-size:.74rem;color:var(--text2);line-height:1.55}
#muView details.mu-how summary{cursor:pointer;font-weight:600;color:var(--text)}
#muView details.mu-how ol{margin:6px 0 6px 18px;padding:0} #muView details.mu-how code{font:500 .7rem var(--mono)}
#muView .mu-trx{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px}
#muView .mu-trx input{flex:1 1 200px;min-width:0}
#muView .mu-ctl{display:grid;grid-template-columns:minmax(0,2fr) repeat(2,minmax(0,1fr)) minmax(0,1.4fr);gap:10px;align-items:end}
#muView .mu-presets{display:flex;flex-direction:column;gap:4px;font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text3)}#muView .mu-presets>div{display:flex;gap:4px;flex-wrap:wrap}#muView .mu-pre{border:1px solid var(--border);background:var(--bg2);color:var(--text2);border-radius:999px;padding:7px 11px;font:600 .74rem inherit;text-transform:none;letter-spacing:0;cursor:pointer}#muView .mu-pre:hover{border-color:var(--accent);color:var(--text)}#muView label.mu-f{display:flex;flex-direction:column;gap:4px;font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);min-width:0}
#muView select,#muView input[type=date],#muView input[type=text]{font:inherit;font-size:.82rem;padding:8px 9px;border-radius:9px;border:1px solid var(--border2,var(--border));background:var(--bg2,var(--card2));color:var(--text);min-width:0;width:100%;box-sizing:border-box}
#muView .mu-note{margin:12px 0 0;padding:9px 12px;border-radius:10px;font-size:.74rem;line-height:1.5;background:color-mix(in srgb,var(--amber,#d97706) 10%,transparent);border:1px solid color-mix(in srgb,var(--amber,#d97706) 35%,transparent);color:var(--text)}
#muView .mu-kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:10px}
#muView .mu-kpis div{background:var(--bg2,var(--card2));border:1px solid var(--border);border-radius:12px;padding:10px 12px;min-width:0}
#muView .mu-kpis small{display:block;font:600 .6rem var(--mono);text-transform:uppercase;letter-spacing:.06em;color:var(--text3)}
#muView .mu-kpis b{display:block;font-size:1.45rem;font-variant-numeric:tabular-nums;color:var(--text);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#muView .mu-kpis .acc b{color:var(--accent)}
#muView .mu-chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
#muView .mu-chip{display:inline-flex;gap:5px;align-items:center;padding:4px 10px;border-radius:999px;font-size:.72rem;font-weight:600;background:var(--bg2,var(--card2));border:1px solid var(--border);color:var(--text2)}
#muView .mu-chip b{color:var(--text);font-variant-numeric:tabular-nums}
#muView .mu-acts{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
#muView .mu-keep{font-size:.7rem;color:var(--text3);margin-top:6px}
#muView .mu-tbl{margin-top:14px;border:1px solid var(--border);border-radius:12px;overflow:hidden}
#muView .mu-row{display:grid;grid-template-columns:78px 54px 96px minmax(90px,1fr) 118px 78px minmax(180px,2.2fr) minmax(150px,1.5fr);gap:10px;padding:9px 12px;border-top:1px solid var(--border);font-size:.76rem;align-items:start;min-width:0}
#muView .mu-row:first-child{border-top:0}
#muView .mu-row>div{min-width:0;overflow-wrap:anywhere}
#muView .mu-row.h{font:600 .6rem var(--mono);text-transform:uppercase;letter-spacing:.05em;color:var(--text3);background:var(--bg2,var(--card2))}
#muView .mu-row:nth-child(even):not(.h){background:color-mix(in srgb,var(--bg2,var(--card2)) 45%,transparent)}
#muView .mu-n{text-align:right;font-variant-numeric:tabular-nums;font-family:var(--mono)}
#muView .mu-row code{font:500 .7rem var(--mono);color:var(--text2)}
#muView .mu-k{display:inline-block;margin-top:2px;font-size:.66rem;color:var(--text3)}
#muView .mu-why{color:var(--text);line-height:1.45}
#muView .mu-why:before{content:"✓ ";color:var(--green);font-weight:700}
#muView .mu-ev{font:500 .66rem/1.45 var(--mono);color:var(--text3)}
#muView .mu-est{display:inline-block;margin-left:4px;font:600 .58rem var(--mono);padding:1px 5px;border-radius:5px;background:color-mix(in srgb,var(--amber,#d97706) 15%,transparent);color:var(--text2)}
#muView .mu-more{display:block;margin:10px auto 0}
#muView .mu-close .mu-why:before{content:"✗ ";color:var(--text3)}
#muView .mu-sub{font-weight:700;font-size:.9rem;margin:0 0 4px;color:var(--text)}
#muView .mu-empty{padding:22px;text-align:center;color:var(--text3);font-size:.8rem}
#muView .mu-rec{display:flex;gap:10px;align-items:center;padding:9px 0;border-top:1px solid var(--border);font-size:.78rem}
#muView .mu-rec:first-of-type{border-top:0}
#muView .mu-rec>div{flex:1;min-width:0;overflow-wrap:anywhere} #muView .mu-rec small{display:block;color:var(--text3);font-size:.68rem;margin-top:1px}
#muView .mu-months{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 10px}
@media(max-width:760px){
  #muView .mu-card{padding:12px}
  #muView .mu-files{grid-template-columns:minmax(0,1fr)}
  #muView .mu-ctl{grid-template-columns:repeat(2,minmax(0,1fr))}
  #muView .mu-ctl .mu-who,#muView .mu-ctl .mu-src{grid-column:1/-1}
  #muView .mu-kpis b{font-size:1.15rem}
  #muView .mu-row.h{display:none}
  #muView .mu-row{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"d a" "p p" "w w" "e e";gap:4px 10px}
  #muView .mu-row>.c-d{grid-area:d} #muView .mu-row>.c-a{grid-area:a} #muView .mu-row>.c-p{grid-area:p} #muView .mu-row>.c-w{grid-area:w} #muView .mu-row>.c-e{grid-area:e}
  #muView .mu-row>.c-r,#muView .mu-row>.c-c,#muView .mu-row>.c-g{display:none}
  #muView .mu-row .c-d .mu-m{display:block;font-size:.68rem;color:var(--text3);font-family:var(--mono)}
  #muView .mu-row .c-p .mu-m{display:block;margin-top:2px;color:var(--text2)}
}
@media(min-width:761px){#muView .mu-m{display:none}}
#panel-package-audit .pa-tabs{max-width:100%;overflow-x:auto;scrollbar-width:none}`;
    document.head.appendChild(st);
  }

  function mount() {
    const tabs = document.getElementById('pkgTabs');
    const main = document.getElementById('pkgMainView');
    if (!tabs || !main) return false;
    if (S.mounted && document.getElementById('muView')) return true;
    style();
    if (!tabs.querySelector('[data-v="mine"]')) {
      const b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'tab'); b.dataset.v = 'mine'; b.setAttribute('aria-selected', 'false');
      b.id = 'muTab'; b.textContent = '🧾 My upsells';
      b.addEventListener('click', () => show());
      tabs.appendChild(b);
      // The Audit / Rules buttons hide this view again (pkgShowView handles theirs).
      tabs.addEventListener('click', e => { const t = e.target.closest('[data-v]'); if (t && t.dataset.v !== 'mine') hide(); }, true);
    }
    if (!document.getElementById('muView')) {
      const v = document.createElement('div');
      v.id = 'muView'; v.hidden = true;
      main.parentNode.insertBefore(v, main.nextSibling);
    }
    S.mounted = true;
    return true;
  }
  function hide() {
    const v = document.getElementById('muView'); if (v) v.hidden = true;
    const b = document.getElementById('muTab'); if (b) { b.classList.remove('on'); b.setAttribute('aria-selected', 'false'); }
  }
  function show() {
    if (!mount()) return;
    ['pkgRulesView', 'pkgMainView'].forEach(id => { const e = document.getElementById(id); if (e) e.hidden = true; });
    document.querySelectorAll('#pkgTabs [data-v]').forEach(b => { const on = b.dataset.v === 'mine'; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    document.getElementById('muView').hidden = false;
    try { if (typeof _pkgStyle2 === 'function') _pkgStyle2(); if (typeof _pkgStartRulesSync === 'function') _pkgStartRulesSync(); } catch (_) {}
    refresh();
  }

  function refresh() {
    const v = document.getElementById('muView');
    if (!v) return;
    try { compute(); } catch (e) { console.error('My upsells', e); S.view = { mine: [], close: [] }; }
    render();
    listenRecords();
  }

  function dropHtml(n, id, title, rep, accept, multiple, status, ok, opt) {
    return `<div class="mu-drop${ok ? ' ok' : ''}" data-drop="${id}">
      <h4><i>${ok ? '✓' : n}</i>${esc(title)}${opt ? ` <span class="mu-opt">${esc(opt)}</span>` : ''}</h4>
      <div class="mu-rep">${rep}</div>
      <div class="mu-st">${status}</div>
      <button class="btn sm" type="button" onclick="document.getElementById('muIn_${id}').click()">📂 Browse</button>
      <input type="file" id="muIn_${id}" accept="${accept}" ${multiple ? 'multiple' : ''} hidden>
    </div>`;
  }

  function render() {
    const v = document.getElementById('muView');
    if (!v) return;
    const E = evs(), G = gst(), nE = Object.keys(E).length, nG = Object.keys(G).length, J = S.journal, ig = igRows();
    const logNames = S.logFiles.length ? S.logFiles.map(f => f.name) : ((typeof pkgPdfFiles !== 'undefined' && pkgPdfFiles) || []);
    const range = (typeof pkgLogRange !== 'undefined' && pkgLogRange && pkgLogRange.max) ? ` · ${dnShort(pkgLogRange.min)} → ${dnShort(pkgLogRange.max)}` : '';
    const logSt = nE ? `✓ ${nE} bookings with packages${range}${logNames.length ? '<br>' + esc(logNames.join(', ')) : ''}` : 'Drop the PDF here, or Browse. Run it for New Reservation and Update Reservation and add both.';
    const gSt = nG ? `✓ ${nG} reservations${S.guestFile ? '<br>' + esc(S.guestFile.name) : ' (loaded on the Audit tab)'}` : 'Links extensions and rooms to bookings.';
    const jUp = J ? chargesFromJournal(J, E, G, { trx: S.trx }).length : 0;
    const jSt = J ? `✓ ${J.lines} postings · ${dnShort(J.min)} → ${dnShort(J.max)}<br>${jUp ? `${jUp} package postings` : 'no package postings (Tourism Dirham only)'}${S.journalFile ? ' · ' + esc(S.journalFile.name) : ''}` : 'Without it, nights are estimated from the log.';
    const codesFound = J ? Object.entries(J.codes).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `<code>${esc(k)}</code> ×${n}`).join(', ') : '';

    const V = S.view || { mine: [], close: [] };
    const rows = exportRows(V.mine, S.person, true);
    const T = totals(rows);
    const close = exportRows(V.close, S.person, false);
    const opts = S.sellers.map(s => `<option value="${esc(s.key)}"${same(s.key, S.person) ? ' selected' : ''}>${esc(s.label)}${s.label !== s.key ? ' · ' + esc(s.key) : ''} · ${s.nights} nights</option>`).join('');
    const srcOpt = (k, t, dis) => `<option value="${k}"${S.source === k ? ' selected' : ''}${dis ? ' disabled' : ''}>${t}</option>`;
    const chips = Object.entries(T.byKind).sort((a, b) => b[1].aed - a[1].aed).map(([k, x]) => `<span class="mu-chip">${kindIco(x.kind)} ${esc(k)} <b>${x.nights}</b> · ${money(x.aed)}</span>`).join('');
    const LIMIT = 150;
    const shown = S.showAll ? rows : rows.slice(0, LIMIT);
    const rowHtml = (r, closeRow) => `<div class="mu-row">
        <div class="c-d">${esc(dnShort(r.date))}<span class="mu-m">Room ${esc(r.room)} · ${esc(r.conf)}</span></div>
        <div class="c-r">${esc(r.room)}</div>
        <div class="c-c"><code>${esc(r.conf)}</code></div>
        <div class="c-g">${esc(r.guest)}</div>
        <div class="c-p"><code>${esc(r.code || '—')}</code> <span class="mu-k">${kindIco(r.kind)} ${esc(r.kindLabel)}</span>${/Estimated/.test(r.src) ? '<span class="mu-est">estimated</span>' : ''}<span class="mu-m">${esc(r.guest)}</span></div>
        <div class="c-a mu-n">${money(r.amount)}</div>
        <div class="c-w mu-why">${closeRow && r.owner ? `<b>${esc(r.owner)}</b> · ` : ''}${esc(r.why)}</div>
        <div class="c-e mu-ev">${esc(r.evidence)}</div>
      </div>`;
    const head = `<div class="mu-row h"><div>Night</div><div>Room</div><div>Conf</div><div>Guest</div><div>Package</div><div class="mu-n">AED</div><div>Why it's mine</div><div>Opera evidence</div></div>`;

    v.innerHTML = `
    <div class="mu-card">
      <div class="mu-hd"><div>
        <div class="mu-t">🧾 My upsells</div>
        <div class="mu-s">Your own record of the packages you sold, built from Opera's own reports and the same seller rules as the Package Audit. Use it to claim your upsells while IN-Gauge is not available.</div>
      </div></div>
      <div class="mu-files">
        ${dropHtml(1, 'log', 'Opera User Activity Log', 'Changes Log · Search Text "product" · .pdf', '.pdf,.PDF', true, logSt, nE > 0)}
        ${dropHtml(2, 'guests', 'Reservation Detail', 'res_detail · export as text · .txt', '.txt,.tsv,.csv,.xls,.xlsx', false, gSt, nG > 0)}
        ${dropHtml(3, 'journal', 'Journal by Transaction Code', 'finjrnlbytrans · export as text · .txt', '.txt,.tsv,.csv', false, jSt, !!J, '(optional)')}
      </div>
      ${ig.length ? `<div class="mu-ig">🎁 The IN-Gauge export on the Audit tab is loaded (${ig.length} rows): you can use it as the list of charges under "Charges from".</div>` : ''}
      <details class="mu-how"><summary>❔ How to export the journal in Opera</summary>
        <ol>
          <li>Opera → <b>Cashiering → Reports</b> (or Miscellaneous → Reports) → <b>Journal by Transaction Code</b> (<code>finjrnlbytrans</code>).</li>
          <li>Pick the dates you want (for example the 1st of the month → yesterday).</li>
          <li><b>Transaction codes: include the package / upsell codes</b>: breakfast, room upgrade, early check-in, late check-out, dinner, half / full board. <b>Do not filter it to 7510 Tourism Dirham only</b>: that export has no package charges in it.</li>
          <li>Output: <b>Export → delimited text (.txt)</b>, then load it in box 3.</li>
        </ol>
        If your package lines use codes this page does not recognise, type them here (add <code>=BB</code>, <code>=USS</code>, <code>=EC</code>, <code>=LC</code>, <code>=DIN</code> to say the kind):
        <div class="mu-trx"><input type="text" id="muTrx" placeholder="e.g. 2010=BB, 2050=USS" value="${esc(S.trx)}"><button class="btn sm" type="button" id="muTrxSave">Use these codes</button></div>
        ${codesFound ? `<div style="margin-top:6px">Codes in your journal: ${codesFound}</div>` : ''}
      </details>
    </div>

    <div class="mu-card">
      <div class="mu-ctl">
        <label class="mu-f mu-who">Whose upsells?<select id="muWho">${opts || '<option value="">Load the Activity Log first</option>'}</select></label>
        <label class="mu-f">From<input type="date" id="muFrom" value="${dnIso(S.from)}"></label>
        <label class="mu-f">To<input type="date" id="muTo" value="${dnIso(S.to)}"></label>
        <div class="mu-f mu-presets"><span>Period</span><div>${[['this', 'This month'], ['last', 'Last month'], ['all', 'All loaded']].map(([k, t]) => `<button type="button" class="mu-pre" data-pre="${k}">${t}</button>`).join('')}</div></div>
        <label class="mu-f mu-src">Charges from<select id="muSrc">
          ${srcOpt('auto', 'Best available')}${srcOpt('journal', 'Opera journal (posted)', !J)}${srcOpt('ingauge', 'IN-Gauge export', !ig.length)}${srcOpt('log', 'Opera log (estimated)')}
        </select></label>
      </div>
      ${S.note ? `<div class="mu-note">⚠ ${esc(S.note)}</div>` : ''}
      ${S.usedSource === 'log' && nE ? `<div class="mu-note" style="background:var(--bg2,var(--card2));border-color:var(--border)">ℹ Nights are <b>estimated from the Opera log</b>: each package's date range × its price. Load the journal with the package codes for the nights Opera really posted.</div>` : ''}
    </div>

    <div class="mu-card" id="muResult">
      <div class="mu-kpis">
        <div><small>Upsells</small><b>${T.upsells}</b></div>
        <div><small>Nights</small><b>${T.nights}</b></div>
        <div class="acc"><small>Total AED</small><b>${money(T.aed)}</b></div>
      </div>
      <div class="mu-chips">${chips || '<span class="mu-chip">No upsells for this person and period</span>'}</div>
      <div class="mu-acts">
        <button class="btn gold" type="button" id="muDl"${rows.length ? '' : ' disabled'}>📥 Download Excel</button>
        <button class="btn" type="button" id="muSave"${rows.length ? '' : ' disabled'}>📌 Save today's record</button>
        <span style="font-size:.72rem;color:var(--text3)">${esc(label(S.person) || '')} · ${esc(dnShort(S.from))} → ${esc(dnShort(S.to))}</span>
      </div>
      <div class="mu-keep">Keep the 3 Opera files too — they are the original proof.</div>
      ${rows.length ? `<div class="mu-tbl" id="muTable">${head}${shown.map(r => rowHtml(r)).join('')}</div>
        ${rows.length > LIMIT ? `<button class="btn sm mu-more" type="button" id="muMore">${S.showAll ? 'Show less' : `Show all ${rows.length} nights`}</button>` : ''}`
        : `<div class="mu-empty">${nE ? 'No upsells for this person in these dates.' : 'Load the Opera User Activity Log to start.'}</div>`}
    </div>

    ${close.length ? `<div class="mu-card mu-close">
      <div class="mu-sub">🤏 Not mine but close (${close.length})</div>
      <div class="mu-s" style="margin-bottom:8px">You touched these packages in Opera, but the rules give them to someone else. The reason is on each line.</div>
      <div class="mu-tbl">${close.slice(0, 60).map(r => rowHtml(r, true)).join('')}</div>
    </div>` : ''}

    <div class="mu-card" id="muRecords"></div>`;

    bind(v);
    renderRecords();
  }

  function bind(v) {
    v.querySelectorAll('[data-drop]').forEach(z => {
      const id = z.dataset.drop, inp = z.querySelector('input[type=file]');
      inp.addEventListener('change', async () => { const f = [...inp.files]; inp.value = ''; if (!f.length) return; if (id === 'log') await loadLog(f); else await route(f, id); });
      z.addEventListener('dragover', e => { e.preventDefault(); z.classList.add('over'); });
      z.addEventListener('dragleave', () => z.classList.remove('over'));
      z.addEventListener('drop', e => { e.preventDefault(); z.classList.remove('over'); route(e.dataTransfer.files, id); });
    });
    const on = (id, ev, fn) => { const e = v.querySelector('#' + id); if (e) e.addEventListener(ev, fn); };
    on('muWho', 'change', e => { S.person = e.target.value; S.showAll = false; refresh(); });
    document.querySelectorAll('#muView [data-pre]').forEach(b => b.addEventListener('click', () => {
      const d = new Date(), k = b.dataset.pre;
      if (k === 'all') { S.userDates = true; S.from = 19000101; S.to = 29991231; refresh(); return; }   // every night in the loaded files
      const m = k === 'last' ? new Date(d.getFullYear(), d.getMonth() - 1, 1) : new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(m.getFullYear(), m.getMonth() + 1, 0), p2 = n => String(n).padStart(2, '0');
      S.from = +`${m.getFullYear()}${p2(m.getMonth() + 1)}01`; S.to = +`${end.getFullYear()}${p2(end.getMonth() + 1)}${p2(end.getDate())}`;
      S.userDates = true; refresh();
    }));
    on('muFrom', 'change', e => { const n = isoDn(e.target.value); if (n) { S.from = n; S.userDates = true; if (S.to < n) S.to = n; refresh(); } });
    on('muTo', 'change', e => { const n = isoDn(e.target.value); if (n) { S.to = n; S.userDates = true; if (S.from > n) S.from = n; refresh(); } });
    on('muSrc', 'change', e => { S.source = e.target.value; refresh(); });
    on('muTrxSave', 'click', () => { S.trx = (v.querySelector('#muTrx') || {}).value || ''; try { localStorage.setItem(TRX_KEY, S.trx); } catch (_) {} refresh(); });
    on('muDl', 'click', () => download());
    on('muSave', 'click', () => saveRecord());
    on('muMore', 'click', () => { S.showAll = !S.showAll; render(); });
  }

  function renderRecords() {
    const box = document.getElementById('muRecords');
    if (!box) return;
    const key = personKey(S.person), raw = S.records[key];
    const name = label(S.person) || S.person;
    if (!S.person) { box.innerHTML = `<div class="mu-sub">🗂 My record</div><div class="mu-s">Pick a person to see their saved records.</div>`; return; }
    const R = recordList(raw || {});
    const months = Object.keys(R.months).sort().reverse().map(m => `<span class="mu-chip">${MONTH_FULL[+m.slice(4, 6) - 1]} ${m.slice(0, 4)}: <b>${money(R.months[m].aed)}</b> AED · ${R.months[m].pk.size} upsells · ${R.months[m].nights} nights</span>`).join('');
    box.innerHTML = `<div class="mu-sub">🗂 My record · ${esc(name)}</div>
      <div class="mu-s">Every "📌 Save today's record" is kept with its date, for good (nothing is overwritten). Month totals count each night once, even when saved twice.</div>
      ${months ? `<div class="mu-months">${months}</div>` : ''}
      ${R.list.length ? R.list.map(r => `<div class="mu-rec"><div><b>${esc(dnShort(r.from))} → ${esc(dnShort(r.to))}</b> · ${r.totals ? r.totals.upsells : 0} upsells · ${r.totals ? r.totals.nights : 0} nights · <b>${money(r.totals ? r.totals.aed : 0)} AED</b>
          <small>Saved ${esc(r.savedAtLabel || new Date(r.savedAt).toLocaleString('en-GB'))}${r.savedBy ? ' by ' + esc(r.savedBy) : ''}${r.parts > 1 ? ` · ${r.partsSeen}/${r.parts} parts` : ''}</small></div>
          <button class="btn sm" type="button" data-rec="${esc(r.id)}">📥 Excel</button></div>`).join('')
        : `<div class="mu-empty">${raw === null ? 'Loading…' : 'Nothing saved yet. Press 📌 Save today\'s record to keep a dated copy.'}</div>`}`;
    box.querySelectorAll('[data-rec]').forEach(b => b.addEventListener('click', () => {
      const rec = R.list.find(x => x.id === b.dataset.rec);
      if (rec) download(snapshotData(rec));
    }));
  }

  // ── start ────────────────────────────────────────────────
  let tries = 0;
  function boot() { if (!mount() && ++tries < 40) setTimeout(boot, 800); }
  if (typeof document !== 'undefined' && document.getElementById) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  }

  global.MyUpsells = {
    parseJournal, chargesFromJournal, chargesFromIngauge, chargesFromLog, own, split, sellers, personFor,
    whyMine, whyNot, exportRows, evidenceRows, totals, snapshots, recordList, reportData, snapshotData, fileName,
    xlsxBuffer, buildSheetJS, kindFromText, isPayment, trxCodes, linkConf, guestIndex, personKey,
    show, refresh, download, saveRecord, state: S,
  };
})(typeof window !== 'undefined' ? window : globalThis);
