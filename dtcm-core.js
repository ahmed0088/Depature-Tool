/* ============================================================
   dtcm-core.js — v8 (daily-report mode, name/stay helpers)
   Based on v7.1
   Fixes vs v6:
     - parseDTCM reads FinalFees_21 from ANY element (root or child).
     - buildExpected applies the DTCM 30-NIGHT CAP.
     - parseOpera accepts TAX_AMOUNT + TAX_TRX_CODE=7510 rows.
   ============================================================ */
(function(global){
  'use strict';

  /* Rate, night cap and TD code come from the hotel's settings (hotel-settings.js),
     read each time a function runs, so a change applies on the next Analyze. */
  const HC = () => global.HotelCfg;
  const tdRate = () => HC() ? HC().rate() : 10;
  const tdCap  = () => HC() ? HC().cap()  : 30;
  const isTdCode = c => HC() ? HC().isTdCode(c) : c === '7510';
  const tdDescRe = () => HC() ? HC().descRe() : /tourism\s*dirham/i;
  const auditMin = () => HC() ? HC().auditMinutes() : 260;
  const USE_GROSS = false;

  const MONTHS = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,
                  jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};

  const TD_CODES = new Set([
    '1000','1002','1004','1010','1014','1061','1062','1029','6002','7510'
  ]);

  /* LOCAL calendar date. toISOString() converts to UTC, which in Dubai (UTC+4) turns local midnight into the PREVIOUS day. */
  const toISO  = (dt => { if (!dt) return ''; const p = n => String(n).padStart(2, '0'); return dt.getFullYear() + '-' + p(dt.getMonth() + 1) + '-' + p(dt.getDate()); });
  const round2 = n => Math.round(n * 100) / 100;

  function firstAttr(node, names){
    for (const n of names){
      const v = node.getAttribute(n);
      if (v !== null && String(v).trim() !== '') return String(v).trim();
    }
    return '';
  }

  function parseFee(s){
    if (s == null) return 0;
    let str = String(s).trim();
    str = str.replace(/[A-Za-z]{3}\s*$/,'').replace(/[^\d.,\-]/g,'');
    if (/^\d+,\d{1,2}$/.test(str)) str = str.replace(',', '.');
    str = str.replace(/,(?=\d{3}\b)/g, '');
    const n = parseFloat(str);
    return Number.isFinite(n) ? n : 0;
  }

  function normName(s){
    return (s || '').toLowerCase()
      .replace(/\b(mr|mrs|ms|miss|dr|prof)\.?\b/g, '')
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  function parseUKDate(s){
    if (!s) return null;
    const p = String(s).trim().split(/[\/\-\s]/);
    if (p.length !== 3) return null;
    let d, m, y;
    if (p[0].length === 4) { y = +p[0]; m = +p[1]; d = +p[2]; }
    else                   { d = +p[0]; m = +p[1]; y = +p[2]; }
    if (y < 100) y += 2000;
    if (!d || !m || !y) return null;
    return new Date(y, m - 1, d);
  }

  function parseJournalDate(s){
    if (!s) return null;
    const str = String(s).trim();
    let m = str.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
    if (m){
      const d = +m[1], mon = MONTHS[m[2].toLowerCase()];
      let y = +m[3]; if (y < 100) y += 2000;
      if (mon === undefined || !d || !y) return null;
      return new Date(y, mon, d);
    }
    m = str.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (m){
      const d = +m[1], mon = +m[2];
      let y = +m[3]; if (y < 100) y += 2000;
      if (!d || !mon || !y || mon < 1 || mon > 12) return null;
      return new Date(y, mon - 1, d);
    }
    return null;
  }


  /* ---------- Name + stay helpers (used for guest / cap checks) ---------- */
  function nameTokens(s){ return normName(s).split(' ').filter(t => t.length > 1); }
  function lev1(a, b){            // edit distance <= 1 ?
    if (a === b) return true;
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, edits = 0;
    while (i < a.length && j < b.length){
      if (a[i] === b[j]){ i++; j++; continue; }
      if (++edits > 1) return false;
      if (a.length === b.length){ i++; j++; }
      else if (a.length > b.length) i++; else j++;
    }
    return edits + (a.length - i) + (b.length - j) <= 1;
  }
  /* number of name parts two guest names share (tolerates spelling variants,
     "Al" prefixes, Mohamed/Mohamad, comma order "SURNAME,FIRST") */
  function nameOverlap(a, b){
    const ta = nameTokens(a), tb = nameTokens(b);
    const strip = t => (t.length > 4 && t.startsWith('al')) ? t.slice(2) : t;
    const used = new Set(); let n = 0;
    for (const x of ta){
      const sx = strip(x);
      for (let j = 0; j < tb.length; j++){
        if (used.has(j)) continue;
        const sy = strip(tb[j]);
        const same = sx === sy ||
          (sx.length >= 5 && sy.length >= 5 && lev1(sx, sy)) ||
          (sx.length >= 4 && sy.length >= 4 && (sx.includes(sy) || sy.includes(sx)));
        if (same){ used.add(j); n++; break; }
      }
    }
    return n;
  }
  function namesMatch(a, b){
    if (!nameTokens(a).length || !nameTokens(b).length) return true;   // cannot judge
    return nameOverlap(a, b) >= 1;
  }
  function daysBetween(isoA, isoB){
    return Math.round((Date.parse(isoB + 'T00:00:00Z') - Date.parse(isoA + 'T00:00:00Z')) / 86400000);
  }
  /* Night number of a stay on a given business date (check-in night = 1). */
  function stayNightNo(checkInISO, dateISO){
    return (checkInISO && dateISO) ? daysBetween(checkInISO, dateISO) + 1 : 0;
  }

  /* ---------- File reading helpers (encoding + delimiter) ---------- */
  async function readTextSmart(file){
    const buf = await file.arrayBuffer();
    const b = new Uint8Array(buf);
    let enc = 'utf-8';
    if (b.length >= 2 && b[0] === 0xFF && b[1] === 0xFE)      enc = 'utf-16le';
    else if (b.length >= 2 && b[0] === 0xFE && b[1] === 0xFF) enc = 'utf-16be';
    else if (b.length >= 4 && b[1] === 0 && b[3] === 0)       enc = 'utf-16le';
    else if (b.length >= 4 && b[0] === 0 && b[2] === 0)       enc = 'utf-16be';
    let text = new TextDecoder(enc).decode(buf);
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    return text.replace(/\u0000/g, '');
  }

  function detectDelimiter(line){
    const cnt = {
      '\t': (line.match(/\t/g) || []).length,
      ';':  (line.match(/;/g)  || []).length,
      ',':  (line.match(/,/g)  || []).length,
      '|':  (line.match(/\|/g) || []).length
    };
    let best = '\t';
    for (const k of Object.keys(cnt)) if (cnt[k] > cnt[best]) best = k;
    return best;
  }

  function splitLine(line, delim){
    if (delim === '\t' || line.indexOf('"') === -1) return line.split(delim);
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++){
      const ch = line[i];
      if (ch === '"'){
        if (q && line[i+1] === '"'){ cur += '"'; i++; }
        else q = !q;
      } else if (ch === delim && !q){ out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  }

  function findHeaderIdx(lines, re, maxScan){
    for (let i = 0; i < Math.min(maxScan || 40, lines.length); i++){
      if (re.test(lines[i])) return i;
    }
    return -1;
  }

  /* ---------- DTCM XML ---------- */
  function parseDTCM(xmlText){
    const xml = new DOMParser().parseFromString(xmlText, 'text/xml');
    if (xml.querySelector('parsererror')) {
      console.error('DTCM XML parse error');
      return { segments: [], finalFees: 0 };
    }

    // FIX: FinalFees_21 is on <Tablix1>, not <Report>. Search all elements.
    let finalFees = 0;
    const all = xml.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++){
      const ff = all[i].getAttribute && all[i].getAttribute('FinalFees_21');
      if (ff !== null && ff !== undefined && String(ff).trim() !== ''){
        finalFees = parseFee(ff);
        if (finalFees > 0) break;
      }
    }

    const nodes = xml.querySelectorAll('Details');
    const segments = [];

    nodes.forEach(n => {
      const roomRaw = firstAttr(n, ['RoomNumber','Room','RoomNo','Room_Number']);
      if (!roomRaw) return;
      const room = roomRaw.replace(/^0+/, '');
      if (!room) return;

      const guest = firstAttr(n, ['MainGuestName','GuestName','Guest_Name','Guest']);

      const nightsRaw = parseInt(firstAttr(n, ['Nights','Night','NoOfNights','Nights_Count']) || '0', 10);
      const storedNights = Number.isFinite(nightsRaw) && nightsRaw > 0 ? nightsRaw : 0;

      const tdFeesStr = firstAttr(n, [
        'TDFees','TdFees','TDFee','TdFee','Td_Fees','TD_Fees',
        'TourismDirham','Tourism_Dirham','TourismFee','Tourism_Fee',
        'Fee','TotalFees','Total_Fees'
      ]);
      const storedTdFees = parseFee(tdFeesStr);

      const checkIn  = parseUKDate(firstAttr(n,
        ['Check_In_EffectiveDateTime','CheckIn','Check_In','CheckInDate']));
      const checkOut = parseUKDate(firstAttr(n,
        ['Check_Out_EffectiveDateTime','CheckOut','Check_Out','CheckOutDate']));
      const status   = firstAttr(n, ['NewAct','Status','Action']);
      const bedrooms = parseInt(firstAttr(n, ['Bedroom','Bedrooms','NoOfBedrooms']) || '1', 10) || 1;
      const houseUse = /^yes$/i.test(firstAttr(n, ['IsHouseUse']));
      const earlyCheckin = /^yes$/i.test(firstAttr(n, ['IsEarlyCheckin']));
      const lateCheckout = /^yes$/i.test(firstAttr(n, ['IsLateCheckout']));

      segments.push({
        room, roomRaw, guest, guestNorm: normName(guest),
        storedNights, storedTdFees, checkIn, checkOut, status, bedrooms, houseUse, earlyCheckin, lateCheckout,
        checkInTime: firstAttr(n, ['NewCheckin','CheckInTime','Check_In_Time']),
        checkOutTime: firstAttr(n, ['NewOut','CheckOutTime','Check_Out_Time']),
        checkInISO:  checkIn  ? toISO(checkIn)  : '',
        checkOutISO: checkOut ? toISO(checkOut) : '',
        transactionuid: firstAttr(n, ['transactionuid','TransactionUID','Transaction_UID','UID']),
        reservation: firstAttr(n, [
          'ReservationID','ReservationNo','ReservationNumber',
          'ConfirmationNumber','BookingNo','BookNo','FolioNo'
        ]),
        raw: {
          RoomNumber: roomRaw,
          Nights: String(nightsRaw),
          TDFees:  tdFeesStr,
          NewAct:  status
        }
      });
    });

    console.log(`DTCM segments parsed: ${segments.length} | FinalFees: ${finalFees}`);
    return { segments, finalFees };
  }

  /* ---------- Opera journal ---------- */
  function parseOpera(txt){
    let raw = String(txt).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    raw = raw.replace(/\u0000/g, '');
    const lines = raw.split('\n').filter(l => l.length && l.trim().length);
    if (lines.length < 2){
      console.error('Opera file has fewer than 2 lines.');
      return { rows: [], fileTotal: 0 };
    }

    let headerIdx = findHeaderIdx(lines, /GUEST_FULL_NAME|DISPLAY_NAME|TRX_DESC|TAX_TRX_CODE|BUSINESS_DATE/i, 40);
    if (headerIdx === -1) headerIdx = 0;
    const delim = detectDelimiter(lines[headerIdx]);
    console.log('Opera header line #' + headerIdx + ' | delimiter:', JSON.stringify(delim));
    const header = splitLine(lines[headerIdx], delim)
      .map(h => h.trim().replace(/^"|"$/g, '').toUpperCase());

    const find = (...names) => {
      for (const n of names){
        const i = header.indexOf(n.toUpperCase());
        if (i !== -1) return i;
      }
      for (const n of names){
        const t = n.toUpperCase();
        const i = header.findIndex(h => h.includes(t));
        if (i !== -1) return i;
      }
      return -1;
    };

    const iGuest  = find('GUEST_FULL_NAME','DISPLAY_NAME','GUEST_NAME','GUEST');
    const iDesc   = find('TRX_DESC','TRANSACTION_DESCRIPTION','TAX_DESCRIPTION','DESCRIPTION');
    const iDateA  = find('BUSINESS_DATE','CHAR_TRX_DATE');
    const iDateN  = find('BUSINESS_FORMAT_DATE','POSTING_DATE','TRX_DATE');
    const iDate   = iDateA !== -1 ? iDateA : iDateN;
    const iRoom   = find('ROOM','ROOM_NO','ROOMNUMBER');
    const iRemark = find('REMARK','REMARKS');
    const iRef    = find('REFERENCE','REF');
    const iDebit  = find('PRINT_CASHIER_DEBIT','CASHIER_DEBIT','DEBIT');
    const iCredit = find('PRINT_CASHIER_CREDIT','CASHIER_CREDIT','CREDIT');
    const iTaxAmt = find('TAX_AMOUNT');
    const iNet    = header.indexOf('NET');
    const iGross  = header.indexOf('GROSS');
    const iCashD  = header.indexOf('CASHIER_DEBIT');
    const iCashC  = header.indexOf('CASHIER_CREDIT');
    const iTrx    = find('TRX_NO','TRX_NUMBER','TRANSACTION_NO');
    const iCode   = find('TRX_CODE','TRANSACTION_CODE');
    const iTax    = find('TAX_TRX_CODE');
    const iUser   = find('USER_NAME','CASHIER_ID','CF_CASHIER');
    const iTime   = find('BUSINESS_TIME','CHAR_TRX_TIME');

    if (iRoom === -1 || iDate === -1){
      console.error('Opera file missing required columns (ROOM, BUSINESS_DATE / CHAR_TRX_DATE). Header seen:', header);
      return { rows: [], fileTotal: 0 };
    }

    const rows = [];
    let fileTotal = 0;
    const skip = { shortRow:0, notTD:0, noGuest:0, noRoom:0, badDate:0 };
    const sample = {};
    const noteSkip = (why, c) => { skip[why]++; if (!sample[why]) sample[why] = c.slice(0, 40); };
    console.log('Opera columns:', header);
    console.log('Column idx -> guest', iGuest, 'desc', iDesc, 'date', iDate, 'room', iRoom, 'trxCode', iCode, 'taxCode', iTax, 'taxAmt', iTaxAmt);

    /* A FULL journal (all revenue, payments, taxes) carries codes such as 1000 Accommodation and
       1029 Service charge that are NOT tourism dirham. If the file has real Tourism Dirham lines
       (code 7510 / description 'Tourism Dirham'), read only those; the wider TD_CODES list is a
       fallback for older TD-only exports that used other codes. */
    let hasPureTD = false;
    for (let i = headerIdx + 1; i < lines.length && !hasPureTD; i++){
      const c = splitLine(lines[i], delim);
      const cd = iCode !== -1 ? (c[iCode] || '').trim().replace(/\.0+$/, '') : '';
      if (isTdCode(cd) || tdDescRe().test(c[iDesc] || '')) hasPureTD = true;
    }
    console.log('Opera journal mode:', hasPureTD ? 'TD lines only (' + (HC() ? HC().codeLabel() : '7510') + ')' : 'legacy TD code list');

    for (let i = headerIdx + 1; i < lines.length; i++){
      const c = splitLine(lines[i], delim);
      if (c.length < 5){ skip.shortRow++; continue; }

      const descRaw = (c[iDesc] || '').trim();
      const codeRaw = iCode !== -1 ? (c[iCode] || '').trim() : '';
      const code    = codeRaw.replace(/\.0+$/,'');
      const taxCode = iTax !== -1 ? (c[iTax] || '').trim() : '';

      const isTDCode  = hasPureTD ? (isTdCode(code) || tdDescRe().test(descRaw)) : (code && (TD_CODES.has(code) || isTdCode(code)));
      const isTax7510 = isTdCode(taxCode);
      if (!isTDCode && !isTax7510){ noteSkip('notTD', c); continue; }

      const desc    = descRaw;
      const guest   = (c[iGuest] || '').trim();
      if (!guest){ noteSkip('noGuest', c); continue; }

      const rm = (c[iRoom] || '').trim().match(/\d+/);
      const room = rm ? String(parseInt(rm[0], 10)) : '';
      if (!room){ noteSkip('noRoom', c); continue; }

      const bizDate = parseJournalDate((c[iDate] || '').trim());
      if (!bizDate){ noteSkip('badDate', c); continue; }

      const debit  = parseFloat((c[iDebit]  || '0').replace(/[^\d.\-]/g,'')) || 0;
      const credit = parseFloat((c[iCredit] || '0').replace(/[^\d.\-]/g,'')) || 0;
      const netRaw   = iNet   !== -1 ? parseFloat((c[iNet]   || '0').replace(/[^\d.\-]/g,'')) : NaN;
      const grossRaw = iGross !== -1 ? parseFloat((c[iGross] || '0').replace(/[^\d.\-]/g,'')) : NaN;
      const taxAmt   = iTaxAmt !== -1 ? parseFloat((c[iTaxAmt] || '0').replace(/[^\d.\-]/g,'')) : NaN;

      let amount;
      if (Number.isFinite(taxAmt))        amount = taxAmt;
      else if (Number.isFinite(netRaw) && netRaw !== 0) amount = netRaw;
      else if (USE_GROSS && Number.isFinite(grossRaw) && grossRaw !== 0) amount = grossRaw;
      else {
        amount = debit - credit;
        if (amount === 0 && iCashD !== -1){
          const cd = parseFloat((c[iCashD] || '0').replace(/[^\d.\-]/g,'')) || 0;
          const cc = iCashC !== -1 ? (parseFloat((c[iCashC] || '0').replace(/[^\d.\-]/g,'')) || 0) : 0;
          amount = cd - cc;
        }
      }

      const remark = (c[iRemark] || '').trim();
      const ref    = (c[iRef]    || '').trim();
      const trxNo  = (c[iTrx]    || '').trim();
      const user   = (c[iUser]   || '').trim();
      const time   = iTime === -1 ? '' : (c[iTime] || '').trim();

      let kind = 'nightly';
      if (code === '1004')                                   kind = 'no_show';
      else if (code === '1002' || code === '6002')           kind = 'manual';
      else if (code === '1014')                              kind = 'early_departure';
      else if (code === '1010' || code === '1061' || code === '1062') kind = 'upsell';
      if (/manual accommodation/i.test(desc) && kind === 'nightly')  kind = 'manual';
      if (/^reclas/i.test(desc) || /reclas/i.test(remark))  kind = 'adjustment';
      if (/burn\s*4\s*stay|burn4stay|burn for stay/i.test(desc) || /burn4stay/i.test(remark)) kind = 'adjustment';
      if (/^adj\b|^adjust/i.test(desc) || /^adj$/i.test(remark)) kind = 'adjustment';
      if (/exceeds?\s*30|more than 30/i.test(desc) || /exceeds?\s*30|more than 30/i.test(remark)) kind = 'adjustment';

      const moveMatch = ref.match(/#?0*(\d{3,4})\s*=>\s*#?0*(\d{3,4})/);
      const fromRoom  = moveMatch ? String(parseInt(moveMatch[1],10)) : '';
      const toRoom    = moveMatch ? String(parseInt(moveMatch[2],10)) : '';

      const isRoomMove = !!moveMatch;
      const isPackage  = /\[NA P\.Room\]/i.test(ref);
      const isAdjustment = kind === 'adjustment' || kind === 'manual' || amount < 0;
      const isReversal   = /cancell?ed\s+posting/i.test(remark) || /^reversal$/i.test(remark);

      fileTotal += amount;

      rows.push({
        code: code || taxCode, desc,
        room, guest, guestNorm: normName(guest),
        businessDate: toISO(bizDate),
        bizStr: (c[iDate] || '').trim(),
        amount, net: netRaw, gross: grossRaw,
        debit, credit,
        remark, ref, trxNo, user, time,
        kind, taxCode,
        isRoomMove, fromRoom, toRoom, isPackage,
        isAdjustment, isReversal
      });
    }

    console.log('Opera rows skipped by reason: ' + JSON.stringify(skip) + ' | total data lines: ' + (lines.length - headerIdx - 1));
    const codeCounts = {};
    for (let i = headerIdx + 1; i < lines.length; i++){ const cc = splitLine(lines[i], delim); const k = ((iCode !== -1 ? cc[iCode] : '') || '').trim() + ' | ' + ((iDesc !== -1 ? cc[iDesc] : '') || '').trim(); codeCounts[k] = (codeCounts[k] || 0) + 1; }
    console.log('TRX_CODE | DESC counts: ' + JSON.stringify(Object.entries(codeCounts).sort((a,b)=>b[1]-a[1]).slice(0,25)));
    console.log('First skipped row per reason: ' + JSON.stringify(sample));
    console.log('Header: ' + JSON.stringify(header));
    const byKind = rows.reduce((acc,r) => (acc[r.kind]=(acc[r.kind]||0)+1, acc), {});
    console.log(`Opera TD rows parsed: ${rows.length}`, byKind, `net total: ${round2(fileTotal)}`);
    return { rows, fileTotal: round2(fileTotal) };
  }

  function computeNights(s){
    if (s.checkIn && s.checkOut){
      const ms = s.checkOut.getTime() - s.checkIn.getTime();
      const n = Math.round(ms / 86400000);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return s.storedNights;
  }

  /* ---------- buildExpected WITH 30-NIGHT CAP ---------- */
  /* opts.reportDate (ISO) => DAILY report mode: every DTCM row is ONE night
     charged on the report's business date (Check-In is just the original
     arrival date, NOT the date the charge belongs to). */
  function buildExpected(segments, opts){
    const expected = [];
    const reportDate = opts && opts.reportDate;
    const windowDates = (opts && opts.windowDates) || null;
    for (const s of segments){
      if (!s.room || !s.checkIn) continue;
      if (!Number.isFinite(s.storedTdFees) || s.storedTdFees < 0.01) continue;

      /* WINDOW report: the DTCM file covers a run of business dates (e.g. 1-2 Oct) and
         'Nights' is the number of nights INSIDE that window, not the stay length.
         Anchor the nights to the window instead of expanding from the check-in date. */
      if (windowDates && windowDates.length){
        let n = s.storedNights;
        if (!n || n <= 0) n = Math.round(s.storedTdFees / tdRate());
        if (!n || n <= 0) continue;
        const ci = s.checkInISO, co = s.checkOutISO || '';
        const isDayUse = !!(ci && ci === co);
        /* A check-in between 00:00 and 05:59 happens BEFORE that day's night audit, so Opera
           charges the first night on the PREVIOUS business date (the one being closed). */
        const beforeAudit = t => {                       // 'hh:mm AM|PM' earlier than ~04:20 (night audit starts 03:50-04:25)
          const m = String(t || '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
          if (!m || !/AM/i.test(m[3])) return false;
          return ((parseInt(m[1], 10) % 12) * 60 + parseInt(m[2], 10)) < auditMin();
        };
        const earlyArrival = beforeAudit(s.checkInTime);
        /* A check-out before the audit means that date's night was not charged: the last
           charged business date is one earlier than for a normal daytime check-out. */
        const shiftDay = (iso, k) => { const x = new Date(iso + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
        const coEff = (co && !isDayUse && beforeAudit(s.checkOutTime)) ? shiftDay(co, -1) : co;
        let set = isDayUse
          ? windowDates.filter(d => d === ci)
          : windowDates.filter(d => d >= ci && (!coEff || d < coEff));
        if (set.length > n) set = set.slice(set.length - n);
        if (earlyArrival && set.length && set.length <= n){
          /* the early-arrival night: the one business date before the check-in date */
          const first = set[0];
          const prev  = windowDates.filter(d => d < first).pop();
          if (prev && (set.length < n || isDayUse)) set = (isDayUse ? [prev] : [prev].concat(set));
        } else if (!set.length && earlyArrival){
          const prev = windowDates.filter(d => d < ci).pop();
          if (prev) set = [prev];
        }
        /* Any remaining nights DTCM counts lie beyond the last date of this file (tonight and
           later), so they are NOT back-filled onto earlier dates: they are reported as nights
           outside the file instead. */
        if (set.length > n) set = set.slice(set.length - n);
        /* DTCM 'Charge Extra Night on Early Check-In' / '... Late Check-Out' (IsEarlyCheckin /
           IsLateCheckout = Yes) each add one night to the stay:
           - early tick + check-in AFTER the audit (e.g. 05:46): the extra night is the day use on
             the check-in date, which Opera posts by hand on that business date;
           - early tick + check-in BEFORE the audit (e.g. 02:56): DTCM already counts the night
             before for that, so the tick charges a second night nobody stayed;
           - late tick: a night for the late check-out that the Opera night audit never posts.
           The last two are flagged for the reconciler instead of being called 'next file'. */
        s.extraEarlyNight = 0; s.extraLateNight = 0;
        if (s.earlyCheckin && set.length < n){
          if (!earlyArrival && !isDayUse && windowDates.includes(ci)) set = [ci].concat(set);
          else if (earlyArrival) s.extraEarlyNight = 1;
        }
        if (s.lateCheckout && set.length + s.extraEarlyNight < n) s.extraLateNight = 1;
        const amt = round2(s.storedTdFees / n);
        s.nightsOutsideFile = Math.max(0, n - set.length);
        for (const d of set){
          expected.push({
            room: s.room, guest: s.guest, guestNorm: s.guestNorm,
            businessDate: d, amount: amt, capped: false, dayUse: isDayUse
          });
        }
        continue;
      }
      if (reportDate){
        expected.push({
          room: s.room, guest: s.guest, guestNorm: s.guestNorm,
          businessDate: reportDate, amount: round2(s.storedTdFees), capped: false,
          dayUse: !!(s.checkInISO && s.checkInISO === s.checkOutISO)
        });
        continue;
      }

      let nights = s.storedNights;
      if ((!nights || nights <= 0) && s.storedTdFees > 0){
        nights = Math.round(s.storedTdFees / tdRate());
      }
      if (!nights || nights <= 0) continue;

      const chargeable = Math.min(nights, tdCap());

      const flatTotal = round2(tdRate() * chargeable);
      const useFlat   = Math.abs(flatTotal - s.storedTdFees) < 0.5;
      const rate      = useFlat ? tdRate() : round2(s.storedTdFees / chargeable);
      const remainder = round2(s.storedTdFees - rate * chargeable);

      for (let i = 0; i < nights; i++){
        const d = new Date(s.checkIn);
        d.setDate(d.getDate() + i);

        if (i >= chargeable){
          expected.push({
            room: s.room, guest: s.guest, guestNorm: s.guestNorm,
            businessDate: toISO(d), amount: 0, capped: true
          });
          continue;
        }

        const amt = (i === chargeable - 1) ? round2(rate + remainder) : rate;
        if (Math.abs(amt) < 0.01) continue;
        expected.push({
          room: s.room, guest: s.guest, guestNorm: s.guestNorm,
          businessDate: toISO(d), amount: amt, capped: false,
          dayUse: !!(s.checkIn && s.checkOut && toISO(s.checkIn) === toISO(s.checkOut))
        });
      }
    }

    const total = round2(expected.reduce((a, x) => a + x.amount, 0));
    const cappedCount = expected.filter(e => e.capped).length;
    console.log(`Expected postings: ${expected.length} | chargeable total: ${total} AED | capped (0-AED): ${cappedCount}`);
    return expected;
  }

  function indexPosted(operaRows){
    const posted = new Map();
    for (const r of operaRows){
      if (r.isReversal) continue;
      const k = r.room + '|' + r.businessDate;
      posted.set(k, round2((posted.get(k) || 0) + r.amount));
    }
    return posted;
  }

  global.DtcmCore = {
    get TD_RATE() { return tdRate(); }, get TD_CAP() { return tdCap(); }, isTdCode,
    USE_GROSS, TD_CODES,
    MONTHS, toISO, round2, normName, parseFee, firstAttr,
    parseUKDate, parseJournalDate,
    parseDTCM, parseOpera, computeNights, buildExpected, indexPosted,
    readTextSmart, detectDelimiter, splitLine, findHeaderIdx,
    nameTokens, nameOverlap, namesMatch, daysBetween, stayNightNo
  };

})(window);