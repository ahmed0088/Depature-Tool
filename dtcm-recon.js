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
  const { toISO, round2 } = C;
  const TD_CAP = C.TD_CAP;

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
    const isWindow  = !isDaily && winDates.length >= 2 && winDates.length <= 7 && maxNights <= winDates.length;
    const earlyHr = t => {
      const m = String(t || '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
      if (!m) return false;
      let h = +m[1]; const ap = (m[3] || '').toUpperCase();
      if (ap === 'PM' && h < 12) h += 12;
      if (ap === 'AM' && h === 12) h = 0;
      return h < 5;
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
            room, date, guest: list[0].guest, amount: unposted,
            checkInISO: dseg.checkInISO || date, checkOutISO: dseg.checkOutISO || date,
            transactionuid: dseg.transactionuid || '',
            note: 'Day use — charged in DTCM, no Opera posting expected'
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
        if (n > TD_CAP){
          if (sameGuest){
            return { kind: 'over_cap', dtcmGuest: s.guest, nightNo: n,
              cause: `Over 30-night cap — DTCM stay of ${s.guest} (in since ${s.checkInISO}) is on night ${n}`,
              fix: `Reverse ${overTxt} AED on ${date}. TD stops after night ${TD_CAP}.` };
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
          dtcmGuest: c.dtcmGuest || '', nightNo: c.nightNo || 0
        });
      }
    }

    /* ---------- 8. DUPLICATES (same room|date|amount, nightly, non-zero) ---------- */
    const dupMap = new Map();
    operaRows.forEach((r, i) => {
      if (r.isReversal || cancelled.has(i) || r.isAdjustment) return;
      if (r.kind !== 'nightly' || Math.abs(r.amount) < 0.005) return;
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

        if (s.storedTdFees > 0 && n > TD_CAP){
          checks.push({
            type: 'DTCM over cap', severity: 'high', room: s.room, guest: s.guest, date: reportDate,
            detail: `DTCM charges ${s.storedTdFees} AED but this stay (in since ${s.checkInISO}) is on night ${n}.`,
            fix: 'TD should stop after night 30 — check the DTCM entry / whether the stay was split into a new registration.'
          });
        }
        if (s.storedTdFees < 0.01 && !s.houseUse){
          const posted = round2(operaByRoomDate(s.room, reportDate).reduce((a, x) => a + x.amount, 0));
          if (n > TD_CAP){
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

    /* guest-name mismatch where amounts agree (wrong guest on the room?) */
    for (const [k, list] of expectedIndex){
      const actuals = actualIndex.get(k) || [];
      if (!actuals.length) continue;
      const seg = list[0];
      const opGuest = actuals[0].guest;
      /* flag only if NO folio matches NO expected guest (two guests can share a room on one date) */
      const anyMatch = actuals.some(a => list.some(e => C.namesMatch(a.guest, e.guest) || C.nameOverlap(a.guest, e.guest) >= 2));
      if (!anyMatch && !C.namesMatch(opGuest, seg.guest)){
        const [room, date] = k.split('|');
        checks.push({
          type: 'Guest name differs', severity: 'low', room, guest: opGuest, date,
          detail: `Opera folio: "${opGuest}" · DTCM: "${seg.guest}". Amounts agree.`,
          fix: 'Check the room: guest swap / sharer / typo. Wrong DTCM guest data can fail a DTCM audit.'
        });
      }
    }
    const exemptAgreeCount = checks.exemptAgree || 0;
    delete checks.exemptAgree;

    /* ---------- 12. TOTALS ---------- */
    const expTotal     = round2(expected.reduce((s, x) => s + x.amount, 0));
    const actTotal     = round2(operaRows.reduce((s, x) => s + x.amount, 0));
    const dayUseTotal  = round2(dayUse.filter(x => !x.posted).reduce((s, x) => s + x.amount, 0));
    const dayUsePostedTotal = round2(dayUse.filter(x => x.posted).reduce((s, x) => s + x.amount, 0));
    const expTotalAdj  = round2(expTotal - dayUseTotal + dayUsePostedTotal);     // DTCM total the Opera journal is expected to match
    const netVariance  = round2(expTotalAdj - actTotal);
    const missingTotal = round2(missing.reduce((s, x) => s + x.amount, 0));
    const extraTotal   = round2(extra.reduce((s, x) => s + x.variance, 0));
    const adjustTotal  = round2(adjustments.reduce((s, x) => s + x.amount, 0));

    if (Math.abs(dtcmFinalFees - expTotal) > 0.5){
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
      amount: m.amount, where: 'Opera', abs: Math.abs(m.amount), why: m.cause
    }));
    const REVERSE_KINDS = new Set(['over_posting', 'over_cap', 'after_checkout']);
    extra.filter(e => e.kind !== 'room_move').forEach(e => actions.push({
      action: REVERSE_KINDS.has(e.kind) ? 'Reverse' : 'Verify',
      room: e.room, date: e.date,
      amount: e.variance,
      where: REVERSE_KINDS.has(e.kind) ? 'Opera' : 'Opera + DTCM',
      abs: Math.abs(e.variance),
      why: e.cause
    }));
    duplicates.forEach(d => actions.push({
      action: 'Reverse', room: d.room, date: d.businessDate,
      amount: -d.excess, where: 'Opera', abs: Math.abs(d.excess), why: 'Duplicate posting'
    }));
    actions.sort((a, b) => b.abs - a.abs ||
      (a.action === 'Verify') - (b.action === 'Verify'));

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
      expTotal, expTotalAdj, dayUse, dayUseTotal, dayUsePostedTotal, actTotal, netVariance,
      missingTotal, extraTotal, adjustTotal,
      missing, extra, duplicates, phantom,
      checks, exemptAgree: exemptAgreeCount,
      reversals: reversalList,
      adjustments,
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
