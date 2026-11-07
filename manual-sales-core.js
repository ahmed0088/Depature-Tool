// Shared by the browser review and cloud runner. No network or storage side effects.
(function (root) {
  'use strict';
  const clean = value => String(value ?? '').trim();
  const nameKey = value => clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\[[^\]]*\]/g, '').match(/[A-Z]+/g)?.sort().join(' ') || '';
  const PRODUCTS = { '1061':'Early Check In', '1062':'Late Check Out' };
  function eligibility(row) {
    if (!row || row.bucket !== 'add') return 'Only confirmed proposed additions can be selected.';
    if (!PRODUCTS[row.code]) return 'Breakfast quantity and recurring charge dates need a manual check; use this card’s copy buttons.';
    if (!/^\d+$/.test(clean(row.conf)) || !/^\d+$/.test(clean(row.transaction))) return 'The confirmation or journal transaction is not resolved.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.day) || !Number.isSafeInteger(row.cents) || row.cents <= 0) return 'The date or net charge is invalid.';
    if (row.currency !== 'AED') return 'This runner supports verified AED charges only.';
    if (!row.seller?.mapped || row.seller.basis !== 'Opera note' || row.seller.warning || !row.seller.name) return 'Seller credit must be uniquely confirmed by the note.';
    if (row.candidates?.length !== 1 || row.candidates[0].CONFIRMATION_NO !== row.conf) return 'The reservation must have exactly one confirmed match.';
    return '';
  }
  function validatePlan(plan) {
    if (!plan || plan.schema !== 1 || !/^[\w-]{1,80}$/.test(plan.hotelId || '') || !clean(plan.property) || !Array.isArray(plan.sales) || !plan.sales.length || plan.sales.length > 100) throw new Error('Invalid or empty reviewed plan (maximum 100 sales).');
    const transactions = new Set(), events = new Set();
    for (const row of plan.sales) {
      if (!/^\d+$/.test(row.transaction) || !/^\d+$/.test(row.conf) || !PRODUCTS[row.code] || row.product !== PRODUCTS[row.code] || row.currency !== 'AED' || !Number.isSafeInteger(row.cents) || row.cents <= 0 || row.chargeDays !== 1 || !nameKey(row.seller) || !clean(row.note) || !clean(row.guest) || !clean(row.room)) throw new Error('A sale has unresolved or unsupported entry details.');
      const date = new Date(row.day + 'T00:00:00Z');
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== row.day) throw new Error('Invalid posting date.');
      const event = [row.conf,row.code,row.day].join('|');
      if (transactions.has(row.transaction) || events.has(event)) throw new Error('The reviewed plan contains duplicate transactions or events.');
      transactions.add(row.transaction); events.add(event);
    }
    return plan;
  }
  function buildPlan(rows, selected, options) {
    const ids = [...new Set(selected)], sales = [];
    if (!ids.length) throw new Error('Select the sales you reviewed first.');
    for (const transaction of ids) {
      const matches = rows.filter(row => row.transaction === transaction);
      if (matches.length !== 1) throw new Error('Selected transaction no longer has one result. Check the reports again.');
      const row = matches[0], reason = eligibility(row);
      if (reason) throw new Error(reason);
      sales.push({ transaction:row.transaction, conf:row.conf, code:row.code, product:row.product, day:row.day, cents:row.cents, currency:row.currency, chargeDays:1, seller:row.seller.name, employeeId:clean(row.seller.employeeId), room:row.room, guest:row.guest, note:row.note });
    }
    sales.sort((a,b) => a.transaction.localeCompare(b.transaction));
    return validatePlan({ schema:1, hotelId:clean(options.hotelId), property:clean(options.property), sales });
  }
  function canonical(plan) {
    validatePlan(plan);
    return JSON.stringify({ schema:1, hotelId:plan.hotelId, property:plan.property, sales:plan.sales.map(r => ({ transaction:r.transaction,conf:r.conf,code:r.code,product:r.product,day:r.day,cents:r.cents,currency:r.currency,chargeDays:r.chargeDays,seller:r.seller,employeeId:r.employeeId,room:r.room,guest:r.guest,note:r.note })) });
  }
  function inspectSearch(response, conf) {
    if (!response || response.status !== 'SUCCESS' || !Array.isArray(response.data?.data) || !Number.isSafeInteger(response.data.totalInList) || response.data.totalInList < 0) throw new Error('IN-Gauge returned an unrecognized search response. No sale was submitted.');
    const rows = response.data.data.map(raw => {
      let map = raw.jsonMap || {};
      if (typeof map === 'string') { try { map = JSON.parse(map); } catch (_) { throw new Error('IN-Gauge returned an unreadable record.'); } }
      const row = { ...raw, ...map };
      if (!clean(row.confirmationNumber) || !clean(row.id)) throw new Error('Search records did not include confirmation numbers.');
      return row;
    });
    return { total:response.data.totalInList, rows:rows.filter(row => clean(row.confirmationNumber) === conf) };
  }
  function existingFor(sale, records) {
    // Any same one-off product on this booking blocks a second request, regardless of date, seller or status.
    return records.filter(r => { const product=clean(r.pname || r.locationGroupProductName); return !product || /^[-—]$|unknown|unmapped/i.test(product) || nameKey(product) === nameKey(sale.product); });
  }
  function recordMatches(sale, record, statuses = ['PENDING']) {
    const date = value => typeof value === 'number' ? new Date(value).toISOString().slice(0,10) : clean(value).slice(0,10);
    return clean(record.confirmationNumber) === sale.conf && nameKey(record.pname || record.locationGroupProductName) === nameKey(sale.product) && nameKey(record.userName) === nameKey(sale.seller) && Math.abs(Math.round(Number(record.upsellCharge)*100)-sale.cents) <= 2 && date(record.metricDate || record.businessDate) === sale.day && statuses.includes(record.auditStatus) && !!record.id;
  }
  function allowCreate(sale, payload, mapping) {
    const day = value => typeof value === 'number' && Number.isFinite(value) ? new Date(value).toISOString().slice(0,10) : '';
    return payload.auditStatus === 'PENDING' && clean(payload.confirmationNumber) === sale.conf && clean(payload.tenantLocationId) === mapping.location && clean(payload.locationGroupId) === mapping.group && clean(payload.userId) === mapping.user && clean(payload.locationGroupProductId) === mapping.product && Math.round(Number(payload.upsellCharge)*100) === sale.cents && Math.round(Number(payload.totalUpsellAmount)*100) === sale.cents && Number(payload.roomNights) === 1 && day(payload.metricDate) === sale.day && day(payload.departureDate) === sale.day && (payload.arrivalDate == null || day(payload.arrivalDate) === sale.day) && (payload.businessDate == null || day(payload.businessDate) === sale.day);
  }
  const api = { eligibility,validatePlan,buildPlan,canonical,inspectSearch,existingFor,recordMatches,allowCreate,nameKey };
  root.ManualSalesCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
