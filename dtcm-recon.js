/* ============================================================
   reconciler.js — v15
   DTCM Hotel Transaction Report vs Opera TD postings.

   How the DTCM report works (verified on real data):
   - The XML is a DAILY report: one <Details> row per room occupied
     at that day's night audit. Nights = 1 / TDFees = 10 means "this
     room pays TD for the report night". Nights = 0 / TDFees = 0 means
     checked out that day (no night slept) or past the 30-night cap.
   - Check_In_EffectiveDateTime is the guest's ORIGINAL arrival date,
     NOT the date the charge belongs to.
   - TD stops after 30 consecutive nights (night 31 = 0 AED).

   What this file does:
   1. Detects daily mode and the business date.
   2. Compares expected vs posted per room + date (signed).
   3. Explains every difference (over cap, not in DTCM, wrong room…).
   4. Runs extra checks: DTCM over-cap, zero-fee short stays,
      guest-name mismatches, rate outliers, date mismatch.
   ============================================================ */

(function(global){
  'use strict';
  const C = global.DtcmCore;
  const TDC = () => (global.HotelCfg ? global.HotelCfg.codeLabel() : '7510');
  const { toISO, round2 } = C;

  const parseDTCM     = C.parseDTCM;
  const parseOpera    = C.parseOpera;
  const buildExpected = C.buildExpected;

  const modeOf = arr => {
    const c = {};
    arr.forEach(x => { if (x) c[x] = (c[x] || 0) + 1; });
    return Object.keys(c).sort((a, b) => c[b] - c[a])[0] || '';
  };

  function classifyMissing(v, segments){
    const seg = segments.find(s =>
      s.room === v.room &&
      s.checkIn &&
      toISO(s.checkIn) <= v.date &&
      (!s.checkOut || toISO(s.checkOut) >= v.date)
    );
    if (!seg) return { cause: 'Interface gap', fix: `Add ${v.shortfall.toFixed(2)} AED on ${v.date}` };
    if (seg.storedNights === 0 && seg.storedTdFees === 0) return { cause: 'Exempt stay', fix: 'No action — exempt' };
    if (seg.status === 'Change Room') return { cause: 'Room-move remainder', fix: `Add ${v.shortfall.toFixed(2)} AED on ${v.date} (movement leg)` };
    if (seg.status === 'Canceled') return { cause: 'Cancelled stay', fix: 'No action — cancelled' };
    return { cause: 'Not posted', fix: `Add ${v.shortfall.toFixed(2)} AED on ${v.date}` };
  }

  function reconcile(dtcmParsed, operaRows, operaFileTotal){
    const dtcmSegments  = dtcmParsed.segments || dtcmParsed;
    const dtcmFinalFees = dtcmParsed.finalFees || 0;
    const warnings = [];

    /* ---------- 1. MODE + BUSINESS DATE ---------- */
    const nonRev      = operaRows.filter(r => !r.isReversal);
    const operaDates  = [...new Set(nonRev.map(r => r.businessDate))].sort();
    const operaDate   = modeOf(nonRev.map(r => r.businessDate));
    const isDaily     = dtcmSegments.length > 0 &&
                        dtcmSegments.every(s => (s.storedNights || 0) <= 1);
    const reportDate  = isDaily ? operaDate : '';

    /* WINDOW report: DTCM file spans several business dates (same as the Opera file)
       and its 'Nights' = nights inside that window. */
    const addDays = (iso, n) => {
      const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().slice(0, 10);
    };
    const winDates = [];
    if (!isDaily && operaDates.length >= 2){
      let d = operaDates[0];
      while (d <= operaDates[operaDates.length - 1] && winDates.length < 15){ winDates.push(d); d = addDays(d, 1); }
    }
    const maxNights = dtcmSegments.reduce((m, s) => Math.max(m, s.storedNights || 0), 0);
    /* A few rooms can legitimately show MORE nights than the Opera file covers (a night before
       the first date, or after the last). One or two of those must not throw the whole file
       into night-by-night expansion, so accept window mode when ~all rows fit inside it. */
    const nightsList = dtcmSegments.map(s => s.storedNights || 0).filter(n => n > 0);
    const fitCount   = nightsList.filter(n => n <= winDates.length).length;
    const outlierSegs = dtcmSegments.filter(s => (s.storedNights || 0) > winDates.length);
    const isWindow  = !isDaily && winDates.length >= 2 && winDates.length <= 7 &&
                      nightsList.length > 0 && (fitCount / nightsList.length) >= 0.9;
    const earlyHr = t => {
      const m = String(t || '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
      if (!m) return false;
      let h = +m[1]; const ap = (m[3] || '').toUpperCase();
      if (ap === 'PM' && h < 12) h += 12;
      if (ap === 'AM' && h === 12) h = 0;
      return h * 60 + (+m[2]) < (global.HotelCfg ? global.HotelCfg.auditMinutes() : 300);
    };

    if (isDaily){
      /* DTCM tells us its own date: guests with Nights=0 who checked out
         left on the report date. */
      const dtcmDate = modeOf(dtcmSegments
        .filter(s => s.status === 'Checked Out' && !s.storedNights && s.checkOutISO)
        .map(s => s.checkOutISO));
      if (dtcmDate && operaDate && dtcmDate !== operaDate){
        warnings.push(`DATE MISMATCH: the DTCM report looks like business date ${dtcmDate}, ` +
          `but the Opera postings are dated ${operaDate}. Wrong file pair? Nothing below can be trusted until this is fixed.`);
      }
      if (operaDates.length > 1){
        warnings.push(`Opera file has postings on ${operaDates.length} business dates (${operaDates.join(', ')}) ` +
          `but the DTCM file is a one-day report. Only ${operaDate} is compared; postings on the other dates show as EXTRA.`);
      }
    } else if (!isWindow && dtcmSegments.length){
      warnings.push('DTCM file has rows with more than 1 night: expected charges are expanded night-by-night ' +
        'from check-in. Make sure the report covers the same period as the Opera file.');
    }

    /* ---------- 2. DOMINANT RATE (per bedroom) ---------- */
    const rate = Number(modeOf(dtcmSegments
      .filter(s => s.storedTdFees > 0)
      .map(s => String(round2(s.storedTdFees / (s.bedrooms || 1)))))) || C.TD_RATE;

    /* ---------- 3. ROOM MOVES + PAIR REVERSALS WITH ORIGINALS ---------- */
    const movedRooms = new Set();
    for (const r of operaRows){
      if (r.isRoomMove){
        if (r.fromRoom) movedRooms.add(r.fromRoom);
        if (r.toRoom)   movedRooms.add(r.toRoom);
      }
    }

    const cancelled = new Set();      // indexes of originals cancelled by a reversal
    const pairedRev = new Set();      // indexes of reversal lines that found an original
    operaRows.forEach((rv, i) => {
      if (!rv.isReversal) return;
      const j = operaRows.findIndex((o, k) =>
        !o.isReversal && !cancelled.has(k) &&
        o.room === rv.room && o.businessDate === rv.businessDate &&
        round2(o.amount) === round2(-rv.amount));
      if (j !== -1){ cancelled.add(j); pairedRev.add(i); }
    });

    /* ---------- 4. EXPECTED ---------- */
    const expected = buildExpected(dtcmSegments,
      isWindow ? { windowDates: winDates } : (reportDate ? { reportDate } : undefined));
    const expectedIndex = new Map();
    for (const e of expected){
      const k = e.room + '|' + e.businessDate;
      if (!expectedIndex.has(k)) expectedIndex.set(k, []);
      expectedIndex.get(k).push(e);
    }

    const segsByRoom = new Map();
    for (const s of dtcmSegments){
      if (!segsByRoom.has(s.room)) segsByRoom.set(s.room, []);
      segsByRoom.get(s.room).push(s);
    }

    /* The night audit posts every room at almost the same minute. A line posted at a clearly
       different time (e.g. right after a check-in) is the odd one out, and that is the line to reverse. */
    const auditTime = new Map();
    {
      const cnt = new Map();
      operaRows.forEach(r => { if (!r.time) return; const k = r.businessDate + '|' + r.time; cnt.set(k, (cnt.get(k) || 0) + 1); });
      const best = new Map();
      for (const [k, n] of cnt){ const [d, t] = k.split('|'); if (!best.has(d) || n > best.get(d).n) best.set(d, { t, n }); }
      for (const [d, b] of best) auditTime.set(d, b.t);
    }

    /* DAY USE + NIGHT, SAME GUEST, SAME DATE: the guest had a day-use reservation (arrival = departure,
       e.g. 05:46 → 15:04) and then an overnight one in the same room. Opera posts the day-use TD by hand
       and the night audit posts the night: two identical lines on one business date. That is NOT a
       duplicate when DTCM shows this guest checking in that day: the manual line is the day use.
       DTCM usually keeps both reservations as ONE check-in, so it charges one night less unless the
       day use is in DTCM too (its own check-in, or 'Charge Extra Night on Early Check-In'). */
    const sameName = (a, b) => C.namesMatch(a, b) || C.nameOverlap(a, b) >= 2;
    const nf2 = v => round2(Math.abs(v || 0)).toFixed(2);
    const dayUseRepost = (room, date, guest) => {
      const at = auditTime.get(date);
      if (!at) return null;
      const lines = operaRows.filter((r, i) => !r.isReversal && !cancelled.has(i) && !r.isAdjustment &&
        r.kind === 'nightly' && r.room === room && r.businessDate === date && sameName(guest, r.guest));
      if (lines.length !== 2) return null;
      const audit  = lines.filter(r => r.time === at);
      const manual = lines.filter(r => r.time && r.time !== at);
      if (audit.length !== 1 || manual.length !== 1) return null;
      const seg = (segsByRoom.get(room) || []).find(s => s.checkInISO === date && sameName(guest, s.guest));
      if (!seg) return null;
      return { seg, manual: manual[0], audit: audit[0] };
    }

    /* DTCM transaction ID of the stay a line belongs to, so it can be searched in the DTCM portal.
       Prefer the segment whose guest name matches; otherwise the stay that covers the date. */
    const uidFor = (room, date, guest) => {
      const segs = segsByRoom.get(String(room)) || [];
      const covers = s => s.checkInISO && s.checkInISO <= date && (!s.checkOutISO || s.checkOutISO >= date);
      const nameOk = s => guest && (C.namesMatch(guest, s.guest) || C.nameOverlap(guest, s.guest) >= 2);
      const pick = segs.find(s => nameOk(s) && covers(s)) || segs.find(nameOk) ||
                   segs.find(s => covers(s) && s.storedNights > 0) || segs.find(covers);
      return (pick && pick.transactionuid) || '';
    };

    /* ---------- 5. ACTUAL ---------- */
    const actualIndex = new Map();
    const reversals   = [];
    const adjustments = [];
    const noShows     = [];
    const upsells     = [];

    operaRows.forEach((r, i) => {
      if (r.isReversal){ reversals.push({ r, paired: pairedRev.has(i) }); return; }
      if (cancelled.has(i)) return;               // cancelled by a reversal line

      if (r.kind === 'no_show') noShows.push(r);
      if (r.kind === 'upsell')  upsells.push(r);

      if (r.isAdjustment){
        adjustments.push({
          room: r.room, guest: r.guest, businessDate: r.businessDate,
          amount: r.amount, remark: r.remark || r.desc,
          kind: r.kind,
          cause: r.kind === 'no_show' ? 'No-show charge'
               : r.kind === 'manual' ? 'Manual accommodation line'
               : 'DTCM compliance adjustment',
          fix: 'No action — already netted against the gross posting'
        });
      }

      const k = r.room + '|' + r.businessDate;
      if (!actualIndex.has(k)) actualIndex.set(k, []);
      actualIndex.get(k).push(r);
    });

    /* ---------- 6. MISSING (expected > posted) ----------
       Day use (check-in and check-out the same day) is charged in DTCM but is
       normal when Opera has no posting: it goes to dayUse, never to missing. */
    /* GUEST CHANGED IN THE ROOM: Opera has this room under one name for the earlier nights and has
       NOTHING at all under the DTCM guest's name (e.g. the guest left and a friend extended the stay in
       the same room under his own name). The later nights are then missing on every folio. */
    function detectGuestChange(room, date, dtcmGuest){
      const rows = operaRows.filter((r, i) => !r.isReversal && !cancelled.has(i) && r.room === room);
      if (!rows.length) return null;
      const sameName = rows.some(r => C.namesMatch(r.guest, dtcmGuest) || C.nameOverlap(r.guest, dtcmGuest) >= 2);
      if (sameName) return null;
      const earlier = rows.filter(r => r.businessDate < date)
        .sort((a, b) => a.businessDate < b.businessDate ? -1 : 1);
      if (!earlier.length) return null;
      return { operaGuest: earlier[earlier.length - 1].guest,
               firstDate: earlier[0].businessDate,
               lastDate: earlier[earlier.length - 1].businessDate };
    }

    const missing = [];
    const dayUse = [];
    for (const [k, list] of expectedIndex){
      const [room, date] = k.split('|');
      const actuals = actualIndex.get(k) || [];
      const expectedAmount = round2(list.reduce((s, x) => s + x.amount, 0));
      const actualAmount   = round2(actuals.reduce((s, x) => s + x.amount, 0));
      const dayUseAmt      = round2(list.filter(x => x.dayUse).reduce((s, x) => s + x.amount, 0));
      const mustHave       = round2(expectedAmount - dayUseAmt);

      if (dayUseAmt > 0 && actualAmount + 0.005 < expectedAmount){
        const unposted = round2(expectedAmount - Math.max(actualAmount, mustHave));
        if (unposted >= 0.01){
          const dseg = dtcmSegments.find(s => s.room === room && s.checkInISO === date && s.checkInISO === s.checkOutISO) || {};
          dayUse.push({
            room, date, guest: dseg.guest || list[0].guest, amount: unposted,
            checkInISO: dseg.checkInISO || date, checkOutISO: dseg.checkOutISO || date,
            transactionuid: dseg.transactionuid || '',
            checkInTime: dseg.checkInTime || '', checkOutTime: dseg.checkOutTime || '',
            closed: /checked\s*out/i.test(dseg.status || ''),
            note: 'Day use in DTCM only — cancel it in DTCM if it was not a real stay, or post it in Opera if it was'
          });
        }
      }

      if (actualAmount + 0.005 < mustHave){
        const shortfall = round2(mustHave - actualAmount);
        if (!isFinite(shortfall) || shortfall < 0.01) continue;

        const seg = dtcmSegments.find(s =>
          s.room === room && s.checkIn &&
          toISO(s.checkIn) <= date &&
          (!s.checkOut || toISO(s.checkOut) >= date)
        ) || {};

        const v = {
          room, date,
          guest: list[0].guest,
          expected: mustHave,
          posted: actualAmount,
          variance: shortfall,
          amount: shortfall,
          shortfall,
          checkInISO:  seg.checkInISO  || '',
          checkOutISO: seg.checkOutISO || '',
          nights:      seg.storedNights || 0,
          tdFees:      seg.storedTdFees || 0,
          status:      seg.status      || '',
          transactionuid: seg.transactionuid || '',
          reservation:    seg.reservation    || '',
          roomRaw:        seg.roomRaw        || room,
          movedRoom:      movedRooms.has(room)
        };
        const c = classifyMissing(v, dtcmSegments);
        v.cause = c.cause; v.fix = c.fix;
        if (v.cause === 'Not posted' || v.cause === 'Interface gap'){
          const gc = detectGuestChange(room, date, v.guest);
          if (gc){
            v.kind = 'guest_change'; v.gc = gc;
            v.cause = `Guest changed in the room: Opera has "${gc.operaGuest}" until ${gc.lastDate}; DTCM has "${v.guest}" for the stay. These nights are not on any Opera folio.`;
            v.fix = `Post ${v.shortfall.toFixed(2)} AED on the folio of "${v.guest}" (the extension), date ${date}.`;
          }
        }
        missing.push(v);
      }
    }

    /* ---------- 7. EXTRA (posted > expected) — with root cause ---------- */
    function classifyExtra(room, date, guest, expectedList, over){
      const overTxt = over.toFixed(2);

      /* DAY USE: the folio guest checked in AND out on this very date in this room.
         Opera legitimately posts the TD for that day even if DTCM shows 0 for him
         (and even when another guest took the room afterwards). Not a reversal. */
      const dayUseSeg = (segsByRoom.get(room) || []).find(s =>
        s.checkInISO && s.checkInISO === s.checkOutISO && s.checkOutISO === date &&
        (C.namesMatch(guest, s.guest) || C.nameOverlap(guest, s.guest) >= 2));
      if (dayUseSeg){
        return { kind: 'day_use_posted', dtcmGuest: dayUseSeg.guest,
          cause: `Day use — ${dayUseSeg.guest} checked in and out on ${date}; TD posted for the day`,
          fix: 'No action — day-use TD is legitimate' };
      }
      const du = dayUseRepost(room, date, guest);
      if (du){
        const s = du.seg;
        return { kind: 'day_use_repost', dtcmGuest: s.guest,
          dayUse: { trxNo: du.manual.trxNo || '', time: du.manual.time, auditTrx: du.audit.trxNo || '', auditTime: du.audit.time,
                    checkInTime: s.checkInTime, early: !!s.earlyCheckin, dtcmAmt: round2(s.storedTdFees || 0) },
          cause: `Day use + night on ${date}: ${s.guest} checked in at ${s.checkInTime} on a day-use booking, then stayed the night. ` +
                 `Opera charged the day use (trx ${du.manual.trxNo}, ${du.manual.time}) and the night (night audit). ` +
                 `DTCM ${s.earlyCheckin ? 'has' : 'does NOT have'} the early check-in extra night for this stay.`,
          fix: s.earlyCheckin
            ? `DTCM already flags early check-in; re-check the nights in the TD portal.`
            : `Not a duplicate. Make DTCM charge the day use (Charge Extra Night on Early Check-In), or reverse trx ${du.manual.trxNo} in Opera.` };
      }
      /* ROOM-MOVE CHAIN: DTCM keeps one transaction ID for the whole stay but one row per room. If the
         guest changed rooms across midnight DTCM can lose a night. Compare the whole stay, not one room. */
      const myDtcm = (segsByRoom.get(room) || []).find(s => s.transactionuid &&
        (C.namesMatch(guest, s.guest) || C.nameOverlap(guest, s.guest) >= 2));
      if (myDtcm){
        const chain = dtcmSegments.filter(s => s.transactionuid === myDtcm.transactionuid);
        const chainRooms = [...new Set(chain.map(s => s.room))];
        if (chainRooms.length >= 2){
          const dtcmAmt = round2(chain.reduce((a, s) => a + (s.storedTdFees || 0), 0));
          const operaAmt = round2(operaRows.reduce((a, r, i) => (r.isReversal || cancelled.has(i) || !chainRooms.includes(r.room) ||
            !(C.namesMatch(guest, r.guest) || C.nameOverlap(guest, r.guest) >= 2)) ? a : a + r.amount, 0));
          if (operaAmt > dtcmAmt + 0.005){
            const path = chain.slice().sort((a, b) => (a.checkInISO + a.checkInTime) < (b.checkInISO + b.checkInTime) ? -1 : 1)
              .map(s => s.room).join(' → ');
            return { kind: 'room_chain_short', dtcmGuest: myDtcm.guest,
              chain: { path, rooms: chainRooms, dtcmAmt, operaAmt, uid: myDtcm.transactionuid },
              cause: `Room-move stay of ${myDtcm.guest} (${path}): Opera charges ${operaAmt.toFixed(2)} AED in total, DTCM only ${dtcmAmt.toFixed(2)} AED. DTCM lost a night in the room moves.`,
              fix: `Verify the stay. If he really slept those nights, the missing night is in DTCM, not in Opera.` };
          }
        }
      }
      /* EARLY ARRIVAL: guest checked in after midnight but before night audit. Opera dates
         that first night on the PREVIOUS business date, DTCM dates the stay from the calendar day. */
      const earlySeg = (segsByRoom.get(room) || []).find(s =>
        s.checkInISO === addDays(date, 1) && earlyHr(s.checkInTime) &&
        (C.namesMatch(guest, s.guest) || C.nameOverlap(guest, s.guest) >= 2));
      if (earlySeg){
        return { kind: 'early_arrival', dtcmGuest: earlySeg.guest,
          cause: `Early-morning arrival: ${earlySeg.guest} checked in ${earlySeg.checkInISO} at ${earlySeg.checkInTime}, before night audit. ` +
                 `Opera charges that first night on ${date}; DTCM starts the stay on ${earlySeg.checkInISO}.`,
          fix: `Verify. If he really arrived before audit, correct the DTCM check-in date to ${date} (DTCM then shows +${overTxt} AED). ` +
               `If he arrived after audit, reverse ${overTxt} AED on ${date}.` };
      }
      if (expectedList.length){
        return { kind: 'over_posting', cause: 'Over-posting',
                 fix: `Reverse ${overTxt} AED on ${date}` };
      }
      if (movedRooms.has(room)){
        return { kind: 'room_move', cause: 'Room-move leg (linked to counterpart room)',
                 fix: 'No action — counterpart room is being charged' };
      }
      const segs    = segsByRoom.get(room) || [];
      const inHouse = segs.filter(s => s.checkInISO && s.checkInISO <= date &&
                                       (!s.checkOutISO || s.checkOutISO > date));
      const left    = segs.filter(s => s.checkOutISO && s.checkOutISO <= date);

      if (inHouse.length){
        const s = inHouse[0];
        const n = C.stayNightNo(s.checkInISO, date);
        const sameGuest = C.namesMatch(guest, s.guest);
        const nameNote = sameGuest ? '' :
          ` Opera folio guest "${guest}" is NOT the DTCM guest "${s.guest}".`;
        if (n > C.TD_CAP){
          if (sameGuest){
            return { kind: 'over_cap', dtcmGuest: s.guest, nightNo: n,
              cause: `Over 30-night cap — DTCM stay of ${s.guest} (in since ${s.checkInISO}) is on night ${n}`,
              fix: `Reverse ${overTxt} AED on ${date}. TD stops after night ${C.TD_CAP}.` };
          }
          return { kind: 'over_cap_diff_guest', dtcmGuest: s.guest, nightNo: n,
            cause: `Room is past the 30-night cap in DTCM (night ${n}, ${s.guest}) but the folio belongs to a different guest.`,
            fix: `Verify first.${nameNote} If he shares the same registration → reverse ${overTxt} AED. ` +
                 `If he is a NEW guest, his 30 nights start fresh: the charge is right and DTCM is missing him.` };
        }
        return { kind: 'zero_fee', dtcmGuest: s.guest, nightNo: n,
          cause: `DTCM shows 0 TD for this stay (only night ${n}).${nameNote}`,
          fix: 'Verify why DTCM shows 0 (exemption, continuous earlier stay, wrong guest) before reversing.' };
      }
      if (left.length){
        const s = left[0];
        return { kind: 'after_checkout', dtcmGuest: s.guest,
          cause: `Posted after DTCM check-out (${s.guest} left ${s.checkOutISO})`,
          fix: `Reverse ${overTxt} AED on ${date}` };
      }
      /* Not in DTCM under this room: is the guest there under another room? */
      const other = dtcmSegments.find(s => s.room !== room && s.storedTdFees > 0 &&
        s.checkInISO && s.checkInISO <= date && C.nameOverlap(guest, s.guest) >= 2);
      if (other){
        return { kind: 'wrong_room', dtcmGuest: other.guest,
          cause: `Guest appears in DTCM under room ${other.room}, not ${room}`,
          fix: `Verify: charge may be on the wrong room. Check ${room} vs ${other.room} in Opera.` };
      }
      return { kind: 'not_in_dtcm',
        cause: 'Charged in Opera but no matching guest/room in the DTCM report',
        fix: `Verify the reservation. If the guest really is in-house, the stay is missing from the DTCM feed ` +
             `(TD collected but not reported). If not, reverse ${overTxt} AED.` };
    }

    const extra = [];
    const correctedList = [];
    /* A correction (negative posting) for the same room, same amount, on ANOTHER business
       date cancels an over-posting: e.g. the original +10 is on 09-30 and the fix -10 was
       posted today. Each correction is used once. */
    const usedCorr = new Set();
    function findCorrection(room, date, guest, over){
      let best = -1;
      operaRows.forEach((r, i) => {
        if (usedCorr.has(i) || r.isReversal || cancelled.has(i)) return;
        if (r.room !== room || r.businessDate === date) return;
        if (r.businessDate < date) return;                       // fix is posted on/after the original
        if (round2(r.amount) !== round2(-over)) return;
        const same = C.namesMatch(guest, r.guest) || C.nameOverlap(guest, r.guest) >= 2;
        if (best === -1 || same) best = i;
      });
      return best;
    }
    for (const [k, list] of actualIndex){
      const [room, date] = k.split('|');
      const expectedList = expectedIndex.get(k) || [];
      const expectedAmount = expectedList.length
        ? round2(expectedList.reduce((s, x) => s + x.amount, 0)) : 0;
      const actualAmount = round2(list.reduce((s, x) => s + x.amount, 0));
      if (actualAmount > expectedAmount + 0.005){
        const over = round2(actualAmount - expectedAmount);
        const c = classifyExtra(room, date, list[0].guest, expectedList, over);
        if (c.kind !== 'room_move' && c.kind !== 'day_use_posted'){
          const ci = findCorrection(room, date, list[0].guest, over);
          if (ci !== -1){
            usedCorr.add(ci);
            correctedList.push({ room, date, guest: list[0].guest, over, original: c,
              fixDate: operaRows[ci].businessDate, fixAmount: operaRows[ci].amount });
            continue;
          }
        }
        if (c.kind === 'day_use_posted'){
          dayUse.push({
            room, date, guest: list[0].guest, amount: over, posted: true,
            checkInISO: date, checkOutISO: date,
            note: 'Day use — posted in Opera, DTCM shows no charge for this guest'
          });
          continue;
        }
        extra.push({
          room, date, guest: list[0].guest,
          expected: expectedAmount,
          posted: actualAmount,
          variance: round2(expectedAmount - actualAmount),
          over,
          note: c.kind === 'room_move' ? 'Room-move leg (linked)'
              : expectedList.length ? 'Partially over-posted' : 'No expected stay',
          kind: c.kind, cause: c.cause, fix: c.fix,
          dtcmGuest: c.dtcmGuest || '', nightNo: c.nightNo || 0, chain: c.chain || null, dayUse: c.dayUse || null
        });
      }
    }

    /* ---------- 8. DUPLICATES (same room|date|amount, nightly, non-zero) ---------- */
    const dupMap = new Map();
    operaRows.forEach((r, i) => {
      if (r.isReversal || cancelled.has(i) || r.isAdjustment) return;
      if (r.kind !== 'nightly' || Math.abs(r.amount) < 0.005) return;
      if (dayUseRepost(r.room, r.businessDate, r.guest)) return;   // day use + night, see dayUseRepost
      /* same guest only: two DIFFERENT guests in one room on one date (day use + next arrival) are not a duplicate */
      const k = r.room + '|' + r.businessDate + '|' + round2(r.amount) + '|' + String(r.guest || '').toLowerCase().replace(/[^a-z]/g, '');
      if (!dupMap.has(k)) dupMap.set(k, []);
      dupMap.get(k).push(r);
    });
    const duplicates = [];
    for (const [, arr] of dupMap){
      if (arr.length > 1){
        const extraCopies = arr.length - 1;
        duplicates.push({
          room: arr[0].room, guest: arr[0].guest,
          businessDate: arr[0].businessDate,
          amount: arr[0].amount,
          count: arr.length,
          excess: round2(extraCopies * arr[0].amount),
          trxNos: arr.map(x => x.trxNo || '—').join(', '),
          lines: arr.map(x => ({ trxNo: x.trxNo || '', time: x.time || '', guest: x.guest || '' })),
          cause: 'Duplicate posting',
          fix: `Reverse ${round2(extraCopies * arr[0].amount).toFixed(2)} AED (${extraCopies} extra cop${extraCopies>1?'ies':'y'})`
        });
      }
    }

    /* ---------- 9. PHANTOM = charged with no matching guest/room in DTCM ---------- */
    const PHANTOM_KINDS = new Set(['not_in_dtcm', 'wrong_room', 'after_checkout']);
    const phantom = extra.filter(v => PHANTOM_KINDS.has(v.kind))
      .map(v => ({
        room: v.room, guest: v.guest, businessDate: v.date,
        amount: v.posted, cause: v.cause, fix: v.fix
      }));

    /* ---------- 10. REVERSAL LINES ---------- */
    const reversalList = reversals.map(({ r, paired }) => ({
      room: r.room, guest: r.guest, businessDate: r.businessDate,
      amount: r.amount, remark: r.remark,
      cause: paired ? 'Correction line (matched to its original)' : 'Unpaired correction line',
      fix: paired ? 'No action — already netted'
                  : 'Original posting not found on this date — check the earlier business date'
    }));

    /* ---------- 11. EXTRA CHECKS ---------- */
    const checks = [];
    if (isWindow){
      /* rooms whose extra nights are an early / late tick already have their own DTCM to-do item */
      outlierSegs.filter(sg => (sg.nightsOutsideFile || 0) > (sg.extraEarlyNight || 0) + (sg.extraLateNight || 0)).forEach(sg => checks.push({
        type: 'More nights in DTCM than the file covers', severity: 'med',
        room: sg.room, guest: sg.guest, date: sg.checkInISO || '',
        detail: `DTCM counts ${sg.storedNights} nights (${sg.storedTdFees} AED) but the Opera file only covers ` +
                `${winDates.length} dates (${winDates[0]} to ${winDates[winDates.length - 1]}). ` +
                `Only the nights inside the file were compared.`,
        fix: 'Check the night just before/after the file range: is it posted in another journal, or is DTCM counting an extra night?'
      }));
    }
    const extraRooms = new Set(extra.map(e => e.room + '|' + e.date));
    correctedList.forEach(x => checks.push({
      type: 'Already corrected', severity: 'low', room: x.room, guest: x.guest, date: x.date,
      detail: `Opera had ${x.over.toFixed(2)} AED extra on ${x.date} (${x.original.cause}). ` +
              `A correction of ${x.fixAmount.toFixed(2)} AED was posted on ${x.fixDate}, so it nets to zero.`,
      fix: 'No action. Just make sure the correction is the right one (same room, same amount).'
    }));
    const operaByRoomDate = (room, date) =>
      (actualIndex.get(room + '|' + date) || []);
    const operaNote = (room) => {
      const r = operaRows.find(x => x.room === room && x.remark && /30|night|exempt|NA/i.test(x.remark));
      return r ? r.remark : '';
    };

    if (reportDate){
      let exemptAgree = 0;
      for (const s of dtcmSegments){
        if (!s.checkInISO) continue;
        const inHouse = s.checkInISO <= reportDate && (!s.checkOutISO || s.checkOutISO > reportDate);
        if (!inHouse) continue;
        const n = C.stayNightNo(s.checkInISO, reportDate);

        if (s.storedTdFees > 0 && n > C.TD_CAP){
          checks.push({
            type: 'DTCM over cap', severity: 'high', room: s.room, guest: s.guest, date: reportDate,
            detail: `DTCM charges ${s.storedTdFees} AED but this stay (in since ${s.checkInISO}) is on night ${n}.`,
            fix: 'TD should stop after night 30 — check the DTCM entry / whether the stay was split into a new registration.'
          });
        }
        if (s.storedTdFees < 0.01 && !s.houseUse){
          const posted = round2(operaByRoomDate(s.room, reportDate).reduce((a, x) => a + x.amount, 0));
          if (n > C.TD_CAP){
            if (Math.abs(posted) < 0.005) exemptAgree++;
          } else if (!extraRooms.has(s.room + '|' + reportDate)){
            const note = operaNote(s.room);
            checks.push({
              type: 'Zero fee, short stay', severity: 'medium', room: s.room, guest: s.guest, date: reportDate,
              detail: `DTCM and Opera agree on 0 TD, but this stay only started ${s.checkInISO} (night ${n}).` +
                      (note ? ` Opera note: "${note}".` : ''),
              fix: 'Confirm the reason: guest re-registered after a 30+ night stay, or a real exemption. Keep the proof on file.'
            });
          }
        }
        if (s.storedTdFees > 0 && Math.abs(s.storedTdFees - rate * (s.bedrooms || 1)) > 0.005){
          checks.push({
            type: 'Rate outlier', severity: 'medium', room: s.room, guest: s.guest, date: reportDate,
            detail: `DTCM fee ${s.storedTdFees} AED for ${s.bedrooms || 1} bedroom(s); the hotel rate is ${rate} AED per bedroom.`,
            fix: 'Check bedroom count / rate in the DTCM entry.'
          });
        }
      }
      checks.exemptAgree = exemptAgree;
    }

    /* guest-name mismatch where amounts agree (wrong guest on the room?) — one item per room + guest pair */
    const nameDiff = new Map();
    for (const [k, list] of expectedIndex){
      const actuals = actualIndex.get(k) || [];
      if (!actuals.length) continue;
      const seg = list[0];
      const opGuest = actuals[0].guest;
      /* flag only if NO folio matches NO expected guest (two guests can share a room on one date) */
      const anyMatch = actuals.some(a => list.some(e => C.namesMatch(a.guest, e.guest) || C.nameOverlap(a.guest, e.guest) >= 2));
      if (!anyMatch && !C.namesMatch(opGuest, seg.guest)){
        const [room, date] = k.split('|');
        const nk = room + '|' + opGuest + '|' + seg.guest;
        if (!nameDiff.has(nk)) nameDiff.set(nk, { room, opGuest, dtcmGuest: seg.guest, dates: [] });
        nameDiff.get(nk).dates.push(date);
      }
    }
    for (const n of nameDiff.values()){
      n.dates.sort();
      checks.push({
        type: 'Guest name differs', severity: 'low', room: n.room, guest: n.opGuest, date: n.dates[0],
        detail: `Opera folio: "${n.opGuest}" · DTCM: "${n.dtcmGuest}"` +
                (n.dates.length > 1 ? ` (${n.dates.length} nights: ${n.dates.join(', ')})` : '') + '. Amounts agree.',
        fix: 'Check the room: guest swap / sharer / typo. Wrong DTCM guest data can fail a DTCM audit.'
      });
    }
    const exemptAgreeCount = checks.exemptAgree || 0;
    delete checks.exemptAgree;

    /* ---------- 12. TOTALS ---------- */
    const expTotal     = round2(expected.reduce((s, x) => s + x.amount, 0));
    const actTotal     = round2(operaRows.reduce((s, x) => s + x.amount, 0));
    const dayUseTotal  = round2(dayUse.filter(x => !x.posted).reduce((s, x) => s + x.amount, 0));
    const dayUsePostedTotal = round2(dayUse.filter(x => x.posted).reduce((s, x) => s + x.amount, 0));
    let expTotalAdj    = round2(expTotal - dayUseTotal + dayUsePostedTotal);     // DTCM total the Opera journal is expected to match
    let netVariance    = round2(expTotalAdj - actTotal);
    const missingTotal = round2(missing.reduce((s, x) => s + x.amount, 0));
    let extraTotal     = round2(extra.reduce((s, x) => s + x.variance, 0));
    const adjustTotal  = round2(adjustments.reduce((s, x) => s + x.amount, 0));

    /* Nights DTCM counts that fall outside the dates the Opera file covers (window mode only).
       They are real DTCM money but cannot be compared with this journal, so they are shown as a
       separate step in the headline instead of silently widening the difference. */
    const outsideRaw    = (isWindow && dtcmFinalFees > expTotal) ? round2(dtcmFinalFees - expTotal) : 0;

    /* Of those, the nights added by a DTCM early/late tick (see buildExpected) are NOT in a later
       Opera file: no Opera night will ever match them. They are DTCM-side items to check. */
    const operaFor = (room, guest) => round2(operaRows.reduce((a, r, i) =>
      (r.isReversal || cancelled.has(i) || r.room !== room || !sameName(guest, r.guest)) ? a : a + r.amount, 0));
    const dtcmExtra = [];
    if (isWindow) dtcmSegments.forEach(sg => {
      const n = sg.storedNights || Math.round((sg.storedTdFees || 0) / C.TD_RATE) || 1;
      const per = round2((sg.storedTdFees || 0) / n);
      const base = { room: sg.room, guest: sg.guest, uid: sg.transactionuid || '', amount: per,
        nights: sg.storedNights || 0, dtcmAmt: round2(sg.storedTdFees || 0), operaAmt: operaFor(sg.room, sg.guest),
        checkInISO: sg.checkInISO, checkInTime: sg.checkInTime || '', checkOutISO: sg.checkOutISO || '', checkOutTime: sg.checkOutTime || '',
        closed: /checked\s*out/i.test(sg.status || '') };
      if (sg.extraEarlyNight) dtcmExtra.push(Object.assign({ kind: 'early_tick', date: sg.checkInISO }, base));
      if (sg.extraLateNight)  dtcmExtra.push(Object.assign({ kind: 'late_tick', date: sg.checkOutISO || sg.checkInISO }, base));
    });
    /* TWO DTCM ERRORS THAT CANCEL: the early-check-in tick adds a night nobody stayed, AND the check-out
       date was set one day too early, so Opera's last night looks 'after check-out'. The stay's total then
       matches Opera: the tick night stands in for that last night. Nothing to post for the tally; only
       DTCM's dates are wrong, so it becomes a low check instead of two corrections. */
    let pairedTick = 0;
    for (let i = dtcmExtra.length - 1; i >= 0; i--){
      const t = dtcmExtra[i];
      if (t.kind !== 'early_tick') continue;
      const j = extra.findIndex(e => e.kind === 'after_checkout' && e.room === t.room &&
        Math.abs(Math.abs(e.variance) - t.amount) < 0.01 && (sameName(e.guest, t.guest) || sameName(e.dtcmGuest || '', t.guest)));
      if (j === -1) continue;
      const e = extra[j];
      checks.push({
        type: 'Total right, DTCM dates wrong', severity: 'low', room: t.room, guest: t.guest, date: e.date, uid: t.uid,
        detail: `DTCM ${nf2(t.dtcmAmt)} AED = Opera ${nf2(t.operaAmt)} AED, so this stay tallies. But DTCM has check-out ${t.checkOutISO} ${t.checkOutTime} ` +
                `while Opera charged the night of ${e.date}, and "Charge Extra Night on Early Check-In" is still ticked (arrival ${t.checkInTime}, before the audit). ` +
                `The two errors cancel each other.`,
        fix: 'Nothing to post for the month-end tally. For a correct DTCM record: check-out one day later and untick the early check-in (TD helpdesk if the stay is closed).'
      });
      pairedTick = round2(pairedTick + t.amount);
      extra.splice(j, 1); dtcmExtra.splice(i, 1);
      const ph = phantom.findIndex(x => x.room === e.room && x.businessDate === e.date);
      if (ph !== -1) phantom.splice(ph, 1);
    }
    expTotalAdj = round2(expTotalAdj + pairedTick);
    extraTotal  = round2(extra.reduce((a, x) => a + x.variance, 0));
    netVariance = round2(expTotalAdj - actTotal);
    const dtcmExtraTotal = round2(dtcmExtra.reduce((a, x) => a + x.amount, 0));
    const outsideWindow  = Math.max(0, round2(outsideRaw - dtcmExtraTotal - pairedTick));
    const outsideRooms   = isWindow ? [...new Set(dtcmSegments.filter(sg =>
      (sg.nightsOutsideFile || 0) - (sg.extraEarlyNight || 0) - (sg.extraLateNight || 0) > 0).map(sg => sg.room))].sort() : [];
    if (outsideRaw === 0 && Math.abs(dtcmFinalFees - expTotal) > 0.5){
      warnings.push(`DTCM FinalFees (${dtcmFinalFees}) differs from the rebuilt expected total (${expTotal}). ` +
        'The XML may contain rows the tool skipped (missing room / check-in date).');
    }
    if (operaFileTotal != null && Math.abs(operaFileTotal - actTotal) > 0.5){
      warnings.push(`Opera file total (${operaFileTotal}) differs from the sum of parsed rows (${actTotal}).`);
    }

    /* ---------- 13. ACTIONS ---------- */
    const actions = [];
    missing.forEach(m => actions.push({
      action: 'Add', room: m.room, date: m.date,
      amount: m.amount, where: 'Opera', abs: Math.abs(m.amount), why: m.cause,
      uid: m.transactionuid || uidFor(m.room, m.date, m.guest),
      kind: m.kind || 'add', guest: m.guest, gc: m.gc || null
    }));
    const REVERSE_KINDS = new Set(['over_posting', 'over_cap', 'after_checkout']);
    /* A duplicate posting IS the over-posting for that room/date. Listing both would tell the
       user to reverse the same 10 AED twice, so the duplicate covers the over-posting first. */
    const dupLeft = new Map();
    duplicates.forEach(d => {
      const k = d.room + '|' + d.businessDate;
      dupLeft.set(k, round2((dupLeft.get(k) || 0) + d.excess));
    });
    extra.filter(e => e.kind !== 'room_move').forEach(e => {
      let variance = e.variance;
      if (e.kind === 'over_posting'){
        const k = e.room + '|' + e.date;
        const left = dupLeft.get(k) || 0;
        if (left > 0 && variance < 0){
          const covered = Math.min(left, Math.abs(variance));
          dupLeft.set(k, round2(left - covered));
          variance = round2(variance + covered);
          if (Math.abs(variance) < 0.005) return;      // fully explained by the duplicate line
        }
      }
      actions.push({
        action: REVERSE_KINDS.has(e.kind) ? 'Reverse' : 'Verify',
        room: e.room, date: e.date,
        amount: variance,
        where: REVERSE_KINDS.has(e.kind) ? 'Opera' : 'Opera + DTCM',
        abs: Math.abs(variance),
        why: e.cause,
        uid: uidFor(e.room, e.date, e.dtcmGuest || e.guest),
        kind: e.kind, guest: e.guest, dtcmGuest: e.dtcmGuest || '', fixText: e.fix, chain: e.chain || null, dayUse: e.dayUse || null
      });
    });
    duplicates.forEach(d => actions.push({
      action: 'Reverse', room: d.room, date: d.businessDate,
      amount: -d.excess, where: 'Opera', abs: Math.abs(d.excess), why: 'Duplicate posting',
      uid: uidFor(d.room, d.businessDate, d.guest),
      kind: 'duplicate', guest: d.guest, trxNos: d.trxNos, copies: d.count, lines: d.lines
    }));
    /* DTCM-side items: they change the DTCM total, not the Opera one, so they are kept out of the
       Add/Reverse/Verify sums used for the Opera totals below. */
    dtcmExtra.forEach(x => actions.push({
      action: 'DTCM', room: x.room, date: x.date, amount: -x.amount, where: 'DTCM', abs: x.amount,
      why: x.kind === 'early_tick'
        ? `Early check-in ticked, but ${x.guest} arrived at ${x.checkInTime}, before the night audit. DTCM already counts the night before, so it charges one night too many (DTCM ${x.dtcmAmt.toFixed(2)}, Opera ${x.operaAmt.toFixed(2)}).`
        : `Late check-out ticked for ${x.guest} (out ${x.checkOutISO} ${x.checkOutTime}). DTCM charges a night for it; Opera has no TD for it (DTCM ${x.dtcmAmt.toFixed(2)}, Opera ${x.operaAmt.toFixed(2)}).`,
      uid: x.uid, kind: x.kind, guest: x.guest, dtcmGuest: x.guest, extra: x
    }));
    const minsOf = t => { const m = String(t || '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i); if (!m) return null;
      let h = +m[1] % 12; if (/PM/i.test(m[3] || '')) h += 12; return h * 60 + +m[2]; };
    dayUse.filter(x => !x.posted).forEach(x => {
      const a = minsOf(x.checkInTime), b = minsOf(x.checkOutTime);
      const mins = (a != null && b != null && b >= a) ? b - a : null;
      const prev = (segsByRoom.get(x.room) || []).find(sg => sg.checkOutISO === x.date && sg.checkInISO < x.date && sameName(x.guest, sg.guest));
      const what = prev
        ? `${x.guest} checked out at ${prev.checkOutTime} and was checked in again ${x.checkInTime} → ${x.checkOutTime} the same day`
        : `${x.guest} checked in and out on ${x.date} (${x.checkInTime} → ${x.checkOutTime})`;
      /* The same guest checked in again in the same room after checking out that day is a desk mistake
         (re-check-in), not a day use: it is cancelled in DTCM, never posted in Opera. So is a check-in of a
         few minutes. */
      const mistake = !!prev || (mins != null && mins <= 15);
      x.detail = { mins, prevOut: prev ? prev.checkOutTime : '', what, mistake };
      actions.push({
        action: 'DTCM', room: x.room, date: x.date, amount: -x.amount, where: mistake ? 'DTCM' : 'DTCM or Opera', abs: x.amount,
        why: mistake
          ? `Check-in made by mistake: ${what}${mins != null && mins <= 15 ? ` (only ${mins} min)` : ''}. Not a day use: cancel it in DTCM. Opera has no TD for it.`
          : `Day use in DTCM only: ${what}. Opera has no TD for it.`,
        uid: x.transactionuid || uidFor(x.room, x.date, x.guest), kind: 'dtcm_day_use', guest: x.guest, dtcmGuest: x.guest, extra: x
      });
    });
    /* ROOM MOVE WITHOUT A REMARK: the same guest's night is posted in room A in Opera but sits in
       room B in DTCM. That shows up as an over-posting in A and a missing posting in B, same
       amount, same (or adjacent) date. Pair them one-to-one: net zero, nothing to post. */
    (function pairMoves(){
      const dayDiff = (a, b) => Math.abs(Math.round((new Date(a + 'T00:00:00Z') - new Date(b + 'T00:00:00Z')) / 86400000));
      const cand = actions.filter(a => a.action === 'Verify' && a.amount < 0);
      const adds = actions.filter(a => a.action === 'Add');
      const extraBy = new Map(extra.map(e => [e.room + '|' + e.date, e]));
      const missBy  = new Map(missing.map(m => [m.room + '|' + m.date, m]));
      const used = new Set();
      for (const v of cand){
        const e = extraBy.get(v.room + '|' + v.date); if (!e) continue;
        const opts = adds.filter(ad => !used.has(ad) && ad.room !== v.room &&
          Math.abs(ad.abs - v.abs) < 0.01 && dayDiff(ad.date, v.date) <= 1 && (() => {
            const m = missBy.get(ad.room + '|' + ad.date); if (!m) return false;
            return (e.dtcmGuest && (C.namesMatch(e.dtcmGuest, m.guest) || C.nameOverlap(e.dtcmGuest, m.guest) >= 2)) ||
                   C.nameOverlap(e.guest, m.guest) >= 2;
          })());
        if (opts.length !== 1) continue;                    // only pair when unambiguous
        const ad = opts[0]; used.add(ad);
        v.paired = ad.paired = true;
        const m = missBy.get(ad.room + '|' + ad.date);
        m.pairedMove = true;
        m.cause = `Room move: already posted in room ${v.room} on ${v.date} (nets to zero, do not post)`;
        m.fix = 'No posting needed';
        checks.push({
          type: 'Room move (nets to zero)', severity: 'low', room: v.room + ' → ' + ad.room,
          guest: m.guest, date: v.date,
          detail: `Opera posted ${v.abs.toFixed(2)} AED in room ${v.room} on ${v.date}; DTCM has the same night for ${m.guest} in room ${ad.room} on ${ad.date}. ` +
                  `Same guest, same amount, so the totals agree.`,
          fix: 'No posting needed. Only transfer the charge in Opera if you want the folio to match DTCM\'s room.'
        });
      }
      for (let i = actions.length - 1; i >= 0; i--) if (actions[i].paired) actions.splice(i, 1);
    })();

    checks.forEach(c => {
      if (c.uid) return;
      const rm = (String(c.room || '').match(/\d+/) || [''])[0];
      if (rm && c.date) c.uid = uidFor(rm, c.date, c.guest);
    });

    actions.sort((a, b) => b.abs - a.abs ||
      (a.action === 'Verify') - (b.action === 'Verify'));

    /* ---------- 14. GAP BRIDGE + FIX PLAN ----------
       Turns the two totals into: what explains the raw gap, what to do in what order, and what the
       totals will be once it is done. */
    const nf = n => round2(Math.abs(n)).toFixed(2);
    const sumAct = k => round2(actions.filter(a => a.action === k).reduce((s, a) => s + a.amount, 0));
    const addT = sumAct('Add'), revT = sumAct('Reverse'), verT = sumAct('Verify');
    const operaAfter = round2(actTotal + addT + revT + verT);       // if every Verify turns out to be an Opera reversal
    const operaAfterKeep = round2(actTotal + addT + revT);          // if every Verify is fixed on the DTCM side instead
    const gap = {
      rawDtcm: dtcmFinalFees, rawOpera: actTotal, rawGap: round2(actTotal - dtcmFinalFees),
      outside: outsideWindow, outsideRooms, dayUse: dayUseTotal,
      dtcmExtra: dtcmExtraTotal, dtcmExtraRooms: [...new Set(dtcmExtra.map(x => x.room))],
      dayUseRooms: dayUse.filter(x => !x.posted).map(x => x.room),
      adjDtcm: expTotalAdj, adjGap: netVariance,
      addT, revT, verT, operaAfter, operaAfterKeep,
      dtcmAfterKeep: round2(expTotalAdj - verT),
      leftover: round2(expTotalAdj - operaAfter)
    };

    const plan = [];
    const gcByRoom = new Map();
    actions.forEach(a => {
      if (a.kind === 'guest_change'){
        let g = gcByRoom.get(a.room);
        if (!g){
          g = { action: 'Add', kind: 'guest_change', room: a.room, dates: [], amount: 0, uid: a.uid, guest: a.guest, gc: a.gc };
          gcByRoom.set(a.room, g); plan.push(g);
        }
        g.dates.push(a.date); g.amount = round2(g.amount + a.amount);
        return;
      }
      plan.push({ action: a.action, kind: a.kind || '', room: a.room, dates: [a.date], amount: a.amount,
                  uid: a.uid, guest: a.guest || '', dtcmGuest: a.dtcmGuest || '', why: a.why,
                  fixText: a.fixText || '', trxNos: a.trxNos || '', copies: a.copies || 0, lines: a.lines || null, chain: a.chain || null, dayUse: a.dayUse || null, extra: a.extra || null });
    });
    plan.forEach(p => {
      const d = p.dates.join(', '), n = p.dates.length;
      const ref = p.uid ? `DTCM ID ${p.uid}` : 'DTCM report';
      if (p.kind === 'guest_change'){
        p.title = `Room ${p.room}: post ${nf(p.amount)} AED TD for ${n} night${n > 1 ? 's' : ''} on the extension folio`;
        p.steps = [
          `Room ${p.room} changed guest. Opera has "${p.gc.operaGuest}" until ${p.gc.lastDate}. DTCM has "${p.guest}" for the whole stay (${ref}).`,
          `Open the reservation of "${p.guest}" in room ${p.room} (the extension). Find out why Tourism Dirham did not post there (rate code, tax or exempt setting on that reservation).`,
          `Post ${nf(p.amount)} AED Tourism Dirham (code ${TDC()}) on that folio for: ${d}. Remark: "DTCM correction ${p.uid || ''}".`,
          `If Opera does not accept those old dates, post it on the current business date with the same remark. It will land in a later journal, so tell the person doing the next reconciliation.`,
          `Make sure TD keeps posting every night on that extension folio from now on.`,
          `Do not change anything in DTCM. DTCM already has this stay.`
        ];
        p.effect = 'Opera +' + nf(p.amount);
      } else if (p.action === 'Add'){
        p.title = `Room ${p.room}: post ${nf(p.amount)} AED TD for ${d}`;
        p.steps = [
          `Open the folio of room ${p.room}${p.guest ? ' (' + p.guest + ')' : ''} in Opera.`,
          `Post ${nf(p.amount)} AED Tourism Dirham (code ${TDC()}) for ${d}. Remark: "DTCM correction ${p.uid || ''}".`,
          `Reason: ${p.why}. (${ref})`
        ];
        p.effect = 'Opera +' + nf(p.amount);
      } else if (p.kind === 'duplicate'){
        const nos = String(p.trxNos || '').split(',').map(x => x.trim()).filter(Boolean);
        const at = auditTime.get(p.dates[0]) || '';
        const odd = (p.lines || []).filter(l => l.time && at && l.time !== at);
        const oddLine = odd.length === 1 && (p.lines || []).length === 2 ? odd[0] : null;
        const later = oddLine ? oddLine.trxNo : nos.slice().sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0)).pop();
        const whyLine = oddLine
          ? `trx ${oddLine.trxNo} was posted at ${oddLine.time}, not by the night audit (the audit posted at ${at}). It is the odd one, so reverse that one and keep the night-audit line.`
          : `Reverse the later one, trx ${later}.`;
        p.title = `Room ${p.room}: reverse the duplicate TD of ${nf(p.amount)} AED on ${d}`;
        p.steps = [
          `Open the folio of room ${p.room}${p.guest ? ' (' + p.guest + ')' : ''} in Opera.`,
          `There are ${p.copies || 2} identical TD (${TDC()}) postings on ${d}${nos.length ? ' (trx ' + nos.join(', ') + ')' : ''}. Only one should exist.`,
          `Reverse ONE of them. ${whyLine} Remark: "Duplicate TD".`,
          `Before you do: confirm this is the same guest and the same room. Two guests sharing one room, or one guest in two rooms, is NOT a duplicate (check the other room too).`
        ];
        p.effect = 'Opera −' + nf(p.amount);
      } else if (p.action === 'Reverse'){
        p.title = `Room ${p.room}: reverse ${nf(p.amount)} AED TD on ${d}`;
        p.steps = [
          `Open the folio of room ${p.room}${p.guest ? ' (' + p.guest + ')' : ''} in Opera.`,
          `Reverse ${nf(p.amount)} AED Tourism Dirham dated ${d}. Remark: "DTCM correction ${p.uid || ''}".`,
          `Reason: ${p.why}. (${ref})`
        ];
        p.effect = 'Opera −' + nf(p.amount);
      } else if (p.kind === 'day_use_repost'){
        const u = p.dayUse || {};
        p.title = `Room ${p.room} (${p.dtcmGuest || p.guest}): day use + night on ${d}. DTCM is ${nf(p.amount)} AED short`;
        p.steps = [
          `This is NOT a duplicate. ${p.dtcmGuest || p.guest} checked in at ${u.checkInTime || '?'} on a day-use booking (arrival = departure) and then stayed the night on a new reservation in the same room.`,
          `Opera charged both: the day use by hand (trx ${u.trxNo}, ${u.time}) and the night (trx ${u.auditTrx}, night audit ${u.auditTime}).`,
          `DTCM has the two bookings as ONE check-in (${ref}, ${nf(u.dtcmAmt || 0)} AED), so it does not charge the day use. ` +
            (u.early
              ? `The DTCM report already shows early check-in for this stay; count its nights in the TD portal.`
              : `The DTCM report still shows "Early check-in: No" for this stay. If you ticked "Charge Extra Night on Early Check-In", download the DTCM XML again: this stay must show +${nf(p.amount)} AED. If it does not, the portal did not take it.`),
          `Day-use TD is charged (your rule): keep the Opera line and fix DTCM. Only if DTCM cannot carry it, reverse trx ${u.trxNo} in Opera.`
        ];
        p.effect = 'Closes either way';
      } else if (p.kind === 'early_tick'){
        const x = p.extra || {};
        p.title = `Room ${p.room} (${p.guest}): DTCM charges one night too many (early check-in)`;
        p.steps = [
          `${p.guest} checked in on ${x.checkInISO} at ${x.checkInTime}, before the night audit. For that, DTCM already counts the night before (the same night Opera charged).`,
          `"Charge Extra Night on Early Check-In" is ALSO ticked on this stay, so DTCM adds one more night that nobody stayed. DTCM: ${x.nights} nights = ${nf(x.dtcmAmt)} AED. Opera: ${nf(x.operaAmt)} AED.`,
          x.closed ? `This stay is already CHECKED OUT in DTCM, so the portal will not let you edit it. Either ask DTCM / the TD helpdesk to correct ${ref} (DTCM −${nf((p.extra || {}).amount || 0)}), or post ${nf((p.extra || {}).amount || 0)} AED TD (${TDC()}) in Opera on ${d} so the hotel's books match what DTCM will bill: on the guest folio if it is still open, otherwise on a house / PM account. Remark: "DTCM correction ${p.uid || ''}".` : `In the TD portal open ${ref} → Edit Check-In → untick "Charge Extra Night on Early Check-In" and save. DTCM drops by ${nf(x.amount)} AED. Nothing to do in Opera.`,
          `Rule for the desk: arrival after midnight but before the audit (about 04:00) → do NOT tick it, DTCM counts that night by itself. Tick it only for a daytime early check-in that you charge as a day use (like 05:46).`
        ];
        p.effect = 'DTCM −' + nf(x.amount);
      } else if (p.kind === 'late_tick'){
        const x = p.extra || {};
        p.title = `Room ${p.room} (${p.guest}): DTCM charges a night for the late check-out`;
        p.steps = [
          `${p.guest} checked out on ${x.checkOutISO} at ${x.checkOutTime} and "late check-out" is ticked in DTCM, so DTCM charges one extra night. DTCM: ${nf(x.dtcmAmt)} AED. Opera: ${nf(x.operaAmt)} AED.`,
          `If the late check-out was charged to the guest and your rule says it pays TD: post ${nf(x.amount)} AED TD (${TDC()}) on the folio in Opera for ${x.checkOutISO}.`,
          x.closed ? `If not (free late check-out): the stay is already checked out in DTCM, so it cannot be edited there. Ask DTCM / the TD helpdesk to remove it, or post the TD in Opera anyway so the books match what DTCM will bill.`
                   : `If not (free late check-out): in the TD portal open ${ref} and untick the late check-out. DTCM drops by ${nf(x.amount)} AED.`
        ];
        p.effect = 'DTCM −' + nf(x.amount) + ' or Opera +' + nf(x.amount);
      } else if (p.kind === 'dtcm_day_use'){
        const x = p.extra || {}, dt = x.detail || {};
        if (dt.mistake){
          p.title = `Room ${p.room} (${p.guest}): check-in made by mistake on ${d} — cancel it in DTCM`;
          p.steps = [
            `${dt.what || ''}${dt.mins != null && dt.mins <= 15 ? ` (only ${dt.mins} minute${dt.mins === 1 ? '' : 's'})` : ''}. ` +
              (dt.prevOut ? 'Same guest, same room, same day, right after check-out: this is a re-check-in made by mistake, not a day use.' : 'Far too short to be a stay: a check-in made by mistake.') +
              ` DTCM charges ${nf(x.amount)} AED for it; Opera correctly has nothing.`,
            x.closed
              ? `It is already checked out, so the portal will not let you edit it: ask DTCM / the TD helpdesk to cancel ${ref}. DTCM drops by ${nf(x.amount)} AED. Do NOT post it in Opera.`
              : `In the TD portal open ${ref} → Cancel Check-In. DTCM drops by ${nf(x.amount)} AED. Do NOT post it in Opera.`,
            `Desk rule: if a guest was checked out by mistake, re-open the original stay instead of making a new check-in; cancel a wrong check-in straight away, while it is still open.`
          ];
          p.effect = 'DTCM −' + nf(x.amount);
          return;
        }
        p.title = `Room ${p.room} (${p.guest}): day use on ${d} is in DTCM only`;
        p.steps = [
          `${dt.what || ''}. DTCM charges ${nf(x.amount)} AED for it; Opera has no TD.` +
            (dt.mins != null && dt.mins <= 15 ? ` It lasted only ${dt.mins} minute${dt.mins === 1 ? '' : 's'}: almost certainly a check-in made by mistake.` : '') +
            (dt.prevOut && !(dt.mins != null && dt.mins <= 15) ? ` Same guest, same room, same day: it looks like the stay was checked out and then checked in again, not a new day use.` : ''),
          x.closed ? `This stay is already CHECKED OUT in DTCM, so the portal will not let you edit it. Either ask DTCM / the TD helpdesk to correct ${ref} (DTCM −${nf((p.extra || {}).amount || 0)}), or post ${nf((p.extra || {}).amount || 0)} AED TD (${TDC()}) in Opera on ${d} so the hotel's books match what DTCM will bill: on the guest folio if it is still open, otherwise on a house / PM account. Remark: "DTCM correction ${p.uid || ''}".` : `Not a real day use → in the TD portal open ${ref} and cancel that check-in (or fold it into the main stay). DTCM drops by ${nf(x.amount)} AED.`,
          `Real day use (your rule: day use pays TD) → post ${nf(x.amount)} AED TD (${TDC()}) in Opera on ${d}.`
        ];
        p.effect = 'DTCM −' + nf(x.amount) + ' or Opera +' + nf(x.amount);
      } else if (p.kind === 'room_chain_short'){
        const c = p.chain || {};
        p.title = `Room ${p.room} (${p.dtcmGuest || p.guest}): Opera has one more night than DTCM`;
        p.steps = [
          `DTCM shows this stay across rooms ${c.path || ''}. Total in DTCM: ${nf(c.dtcmAmt || 0)} AED. Total in Opera: ${nf(c.operaAmt || 0)} AED. Difference ${nf(p.amount)} AED.`,
          `Open the reservation in Opera and count the nights he really slept in the hotel (check the room moves and their times).`,
          `If the Opera nights are right (most likely, because the room moves across midnight make DTCM lose a night): fix the stay in the TD portal so its nights match Opera (${ref}). Opera stays unchanged.`,
          `If he really stayed one night less: reverse ${nf(p.amount)} AED in Opera on ${d}.`
        ];
        p.effect = 'Closes either way';
      } else {
        p.title = `Room ${p.room}: check the reservation (${nf(p.amount)} AED)`;
        p.steps = [ p.fixText || p.why, `(${ref})` ];
        p.effect = 'Closes either way';
      }
    });
    /* MONTH-END: the recommended way to close each item, and where BOTH totals end up. At month end
       the DTCM XML total and the Opera journal must be equal, so every item is closed on one side:
       - Add / Reverse                         → Opera
       - Verify, DTCM is short (day use + night, room-move chain, early arrival) → fix DTCM (+)
       - other Verify                          → reverse in Opera
       - early tick, stay still open           → untick in DTCM (−)
       - check-in made by mistake (re-check-in after check-out, or a few minutes) → cancel it in DTCM (−)
       - closed early tick, late tick, real day use → post the TD in Opera (+), since DTCM cannot be edited */
    const DTCM_SHORT = new Set(['day_use_repost', 'room_chain_short', 'early_arrival']);
    let endDtcm = round2(dtcmFinalFees - outsideWindow), endOpera = actTotal;
    plan.forEach(p => {
      const x = p.extra || {}, a = Math.abs(p.amount);
      let side, delta;
      if (p.action === 'Add' || p.action === 'Reverse'){ side = 'Opera'; delta = p.amount; }
      else if (p.action === 'Verify'){ if (DTCM_SHORT.has(p.kind)){ side = 'DTCM'; delta = a; } else { side = 'Opera'; delta = p.amount; } }
      else if (p.kind === 'early_tick' && !x.closed){ side = 'DTCM'; delta = -a; }
      else if (p.kind === 'dtcm_day_use' && x.detail && x.detail.mistake){ side = 'DTCM'; delta = -a; }
      else { side = 'Opera'; delta = a; }
      p.monthEnd = { side, delta };
      if (side === 'DTCM') endDtcm = round2(endDtcm + delta); else endOpera = round2(endOpera + delta);
    });
    gap.monthEnd = { dtcm: endDtcm, opera: endOpera, equal: Math.abs(endDtcm - endOpera) < 0.005,
      opera: endOpera, dtcmChanges: plan.filter(p => p.monthEnd.side === 'DTCM').length,
      operaChanges: plan.filter(p => p.monthEnd.side === 'Opera').length };

    const order = { Add: 0, Reverse: 1, Verify: 2, DTCM: 3 };
    plan.sort((a, b) => (order[a.action] - order[b.action]) || (Math.abs(b.amount) - Math.abs(a.amount)));

    console.log('--- RECONCILE SUMMARY ---');
    console.log('Mode / date         :', isDaily ? 'daily' : (isWindow ? 'window' : 'multi-night'), reportDate || winDates.join(','));
    console.log('DTCM FinalFees (XML):', dtcmFinalFees);
    console.log('DTCM rebuilt total  :', expTotal);
    console.log('Opera file total    :', operaFileTotal);
    console.log('Opera net total     :', actTotal);
    console.log('Net variance        :', netVariance);
    console.log('Adjustments total   :', adjustTotal);
    console.log('Warnings            :', warnings);

    return {
      mode: isDaily ? 'daily' : (isWindow ? 'window' : 'multi'), reportDate, rate, warnings,
      windowStart: isWindow ? winDates[0] : '', windowEnd: isWindow ? winDates[winDates.length - 1] : '',
      segments: dtcmSegments.length,
      expectedCount: expected.length,
      operaCount: operaRows.length,
      dtcmFinalFees,
      operaFileTotal,
      expTotal, expTotalAdj, dayUse, dayUseTotal, dayUsePostedTotal, outsideWindow, outsideRooms, dtcmExtra, dtcmExtraTotal, actTotal, netVariance,
      missingTotal, extraTotal, adjustTotal,
      missing, extra, duplicates, phantom,
      checks, exemptAgree: exemptAgreeCount,
      reversals: reversalList,
      adjustments, gap, fixPlan: plan,
      noShows: noShows.map(r => ({
        room: r.room, guest: r.guest, businessDate: r.businessDate,
        amount: r.amount, remark: r.remark || r.desc
      })),
      upsells: upsells.map(r => ({
        room: r.room, guest: r.guest, businessDate: r.businessDate,
        amount: r.amount, desc: r.desc
      })),
      actions
    };
  }

  global.Reconciler = {
    parseDTCM, parseOpera, buildExpected, reconcile,
    parseUKDate: C.parseUKDate,
    parseJournalDate: C.parseJournalDate,
    normName: C.normName,
    toISO, fmtDate: toISO, round2
  };

})(window);
