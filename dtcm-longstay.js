/* ============================================================
   longstay.js — v3.2 (net-zero nights ignored, same-night multi-room merged)
   30-night Tourism Dirham cap audit, DTCM-source-of-truth.
   Reads the finjrnlbytax (Opera TD tax report) and finds every
   room whose TD has been charged past check-in + 30 nights.
   ============================================================ */
(function(global){
  'use strict';

  /* TD code and night cap come from the hotel's settings (hotel-settings.js) */
  const isTdTax  = c => global.HotelCfg ? global.HotelCfg.isTdCode(c) : c === '7510';
  const capNights = () => global.HotelCfg ? global.HotelCfg.cap() : 30;

  const round2 = n => Math.round(n * 100) / 100;
  const toISO  = (d => { if (!d) return ''; const p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); });
  const MONTHS = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,
                  jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};

  function parseOperaDate(s){
    if (!s) return null;
    const m = String(s).trim().match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/);
    if (!m){
      const CD = global.DtcmCore;
      return CD && CD.parseJournalDate ? CD.parseJournalDate(s) : null;
    }
    let [, d, mo, y] = m;
    if (y.length === 2) y = (parseInt(y,10) < 70 ? '20' : '19') + y;
    const dt = new Date(parseInt(y,10), parseInt(mo,10)-1, parseInt(d,10));
    return isNaN(dt.getTime()) ? null : dt;
  }

  function num(v){
    const n = parseFloat(String(v||'').replace(/[^\d.\-]/g,''));
    return Number.isFinite(n) ? n : 0;
  }

  function normRoom(r){
    const m = String(r||'').match(/\d+/);
    return m ? String(parseInt(m[0],10)) : '';
  }

  /* Parse the Opera TD tax report (finjrnlbytax). */
  function parseLongStayJournal(txt){
    let raw = String(txt).replace(/\r\n/g,'\n').replace(/\r/g,'\n');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);

    raw = raw.replace(/\u0000/g, '');
    const lines = raw.split('\n').filter(l => l.trim().length);
    if (lines.length < 2) return { rows: [], total: 0, byTaxCode: {} };

    const CC = global.DtcmCore;
    let headerIdx = CC.findHeaderIdx(lines, /TAX_TRX_CODE|CHAR_TRX_DATE|DISPLAY_NAME/i, 40);
    if (headerIdx === -1) headerIdx = 0;
    const delim = CC.detectDelimiter(lines[headerIdx]);
    console.log('Long Stay header line #' + headerIdx + ' | delimiter:', JSON.stringify(delim));
    const header = CC.splitLine(lines[headerIdx], delim)
      .map(h => h.trim().replace(/^"|"$/g, '').toUpperCase());
    const idx = name => header.indexOf(name.toUpperCase());

    const iTaxCode = idx('TAX_TRX_CODE');
    const iTaxDesc = idx('TAX_DESCRIPTION');
    const iTrxCode = idx('TRX_CODE');
    const iTrxDesc = idx('TRANSACTION_DESCRIPTION');
    const iNameId  = idx('NAME_ID');
    const iTrxNo   = idx('TRX_NO');
    const iCharD   = idx('CHAR_TRX_DATE');
    const iCharT   = idx('CHAR_TRX_TIME');
    const iRoom    = idx('ROOM');
    const iDisp    = idx('DISPLAY_NAME');
    const iRef     = idx('REFERENCE');
    const iNet     = idx('NET');
    const iTax     = idx('TAX_AMOUNT');
    const iGross   = idx('GROSS');

    const rows = [];
    let total = 0;
    const byTaxCode = {};

    if (iTaxCode === -1 || iCharD === -1){
      console.error('Long Stay file missing TAX_TRX_CODE / CHAR_TRX_DATE. Header seen:', header);
      return { rows: [], total: 0, byTaxCode: {} };
    }

    for (let i = headerIdx + 1; i < lines.length; i++){
      const c = CC.splitLine(lines[i], delim);
      if (c.length < 10) continue;

      const taxCode = (c[iTaxCode] || '').trim();
      const trxCode = (c[iTrxCode] || '').trim();
      const trxDesc = (c[iTrxDesc] || '').trim();
      const taxDesc = (c[iTaxDesc] || '').trim();
      const guest   = (c[iDisp]    || '').trim();
      const nameId  = (c[iNameId]  || '').trim();
      if (!guest && !nameId) continue;

      const roomRaw = (c[iRoom] || '').trim();
      const room    = normRoom(roomRaw);

      const date = parseOperaDate((c[iCharD] || '').trim());
      if (!date) continue;

      const net   = num(c[iNet]);
      const tax   = num(c[iTax]);
      const gross = num(c[iGross]);
      const amount = net !== 0 ? net : (tax !== 0 ? tax : gross);

      const isAccommodation = isTdTax(taxCode);
      const isExcluded = false;

      total += amount;
      byTaxCode[taxCode] = round2((byTaxCode[taxCode]||0) + amount);

      rows.push({
        taxCode, taxDesc, trxCode, trxDesc,
        nameId, guest,
        guestNorm: (guest || '').toLowerCase().replace(/\s+/g,' ').trim(),
        trxNo: (c[iTrxNo] || '').trim(),
        room, roomRaw,
        date: toISO(date),
        charDate: (c[iCharD] || '').trim(),
        charTime: (c[iCharT] || '').trim(),
        net, tax, gross, amount,
        ref: (c[iRef] || '').trim().replace(/\n/g,' '),
        isAccommodation, isExcluded
      });
    }

    return { rows, total: round2(total), byTaxCode };
  }

  /* One TD night per (nameId|room|date). */
  function buildStayNights(rows){
    const byKey = new Map();
    for (const r of rows){
      if (!r.isAccommodation) continue;
      if (r.amount === 0) continue;
      const key = (r.nameId || r.guestNorm) + '|' + r.date + '|' + r.room;
      if (!byKey.has(key)){
        byKey.set(key, {
          nameId: r.nameId, guest: r.guest, guestNorm: r.guestNorm,
          date: r.date, room: r.room,
          net: 0, tax: 0, gross: 0, amount: 0, postings: 0
        });
      }
      const s = byKey.get(key);
      s.net   += r.net;
      s.tax   += r.tax;
      s.gross += r.gross;
      s.amount += r.amount;
      s.postings += 1;
    }
    /* A night whose postings net to 0 (charge + "NA >30 nights" credit) is NOT a charged night. */
    return [...byKey.values()].filter(s => Math.abs(s.amount) >= 0.005).map(s => ({
      ...s,
      net: round2(s.net), tax: round2(s.tax), gross: round2(s.gross)
    })).sort((a,b) =>
      String(a.nameId).localeCompare(String(b.nameId)) || a.date.localeCompare(b.date));
  }

  function makeSeg(n){
    return {
      nameId: n.nameId, guest: n.guest, guestNorm: n.guestNorm,
      stayStart: n.date, stayEnd: n.date, nights: 1,
      rooms: new Set([n.room]),
      totalNet: n.net, totalTax: n.tax, totalGross: n.gross,
      postings: n.postings || 1
    };
  }
  function finalizeSeg(s){
    return {
      ...s,
      roomsUsed: [...s.rooms].sort().join(', '),
      roomsCount: s.rooms.size,
      moved: s.rooms.size > 1
    };
  }

  function buildStaySegments(spine){
    const byGuest = new Map();
    for (const s of spine){
      const key = s.nameId || s.guestNorm;
      if (!byGuest.has(key)) byGuest.set(key, []);
      byGuest.get(key).push(s);
    }
    const segments = [];
    for (const [, nights] of byGuest){
      nights.sort((a,b) => a.date.localeCompare(b.date));
      let seg = null;
      for (const n of nights){
        if (!seg){ seg = makeSeg(n); continue; }
        const prev = new Date(seg.stayEnd + 'T00:00:00Z');
        const cur  = new Date(n.date + 'T00:00:00Z');
        const diff = Math.round((cur - prev) / 86400000);
        if (diff === 0){
          /* same guest, second room on the SAME night: merge, do not count a new night */
          seg.rooms.add(n.room);
          seg.totalNet   = round2(seg.totalNet   + n.net);
          seg.totalTax   = round2(seg.totalTax   + n.tax);
          seg.totalGross = round2(seg.totalGross + n.gross);
          seg.postings  += n.postings || 1;
        } else if (diff === 1){
          seg.stayEnd = n.date;
          seg.nights += 1;
          seg.rooms.add(n.room);
          seg.totalNet   = round2(seg.totalNet   + n.net);
          seg.totalTax   = round2(seg.totalTax   + n.tax);
          seg.totalGross = round2(seg.totalGross + n.gross);
          seg.postings  += n.postings || 1;
        } else {
          segments.push(finalizeSeg(seg));
          seg = makeSeg(n);
        }
      }
      if (seg) segments.push(finalizeSeg(seg));
    }
    return segments.sort((a,b) => b.nights - a.nights || a.guest.localeCompare(b.guest));
  }

  /* Flag long stays AND compute excess charge past the cap. */
  function findLongStays(segments, threshold){
    const thr = threshold || capNights();
    return segments
      .filter(s => s.nights > thr)
      .map(s => {
        const excessNights = s.nights - thr;
        // Excess amount = share of the segment's net that belongs to nights past the cap
        const excessAmount = round2(s.totalNet * (excessNights / s.nights));
        return { ...s, threshold: thr, excessNights, excessAmount };
      });
  }

  function groupTotals(rows){
    const totals = new Map();
    for (const r of rows){
      const k = r.taxCode + '|' + r.taxDesc;
      if (!totals.has(k)){
        totals.set(k, { taxCode: r.taxCode, taxDesc: r.taxDesc,
          net: 0, tax: 0, gross: 0, rows: 0 });
      }
      const t = totals.get(k);
      t.net += r.net; t.tax += r.tax; t.gross += r.gross; t.rows += 1;
    }
    return [...totals.values()].map(t => ({
      ...t, net: round2(t.net), tax: round2(t.tax), gross: round2(t.gross)
    }));
  }

  function analyze(text, threshold){
    const parsed = parseLongStayJournal(text);
    const spine = buildStayNights(parsed.rows);
    const segments = buildStaySegments(spine);
    const longStays = findLongStays(segments, threshold);
    const totals = groupTotals(parsed.rows);
    return {
      rows: parsed.rows,
      total: parsed.total,
      byTaxCode: parsed.byTaxCode,
      spine, segments, longStays, totals,
      threshold: threshold || capNights()
    };
  }

  global.LongStay = {
    get TD_TAX_CODE() { return global.HotelCfg ? global.HotelCfg.codeLabel() : '7510'; },
    get DEFAULT_THRESHOLD() { return capNights(); },
    parseLongStayJournal, buildStayNights, buildStaySegments,
    findLongStays, groupTotals, analyze
  };

})(window);