// Purpose of Stay follows Opera's business day, rather than wall-clock midnight.
(function (W) {
  'use strict';
  const contexts = new Map(), SOURCES = new Set(['calendar', 'saved', 'opera', 'manual']);
  const hotel = () => { try { return typeof HOTEL_ID !== 'undefined' ? String(HOTEL_ID || 'local') : 'local'; } catch (_) { return 'local'; } };
  const key = id => 'ho_purpose_business_date_v1:' + encodeURIComponent(id);
  function validISO(value) {
    if (!/^20\d\d-\d\d-\d\d$/.test(String(value || ''))) return false;
    const d = new Date(String(value) + 'T12:00:00Z');
    return Number.isFinite(+d) && d.toISOString().slice(0, 10) === value;
  }
  function dubaiDay(at = Date.now()) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(at));
    const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
    return p.year + '-' + p.month + '-' + p.day;
  }
  const stamp = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0;
  function clean(value, id) {
    if (!value || !validISO(value.date) || value.hotelId && value.hotelId !== id) return null;
    const source = SOURCES.has(value.source) ? value.source : 'saved';
    const mode = value.mode === 'manual' || value.mode !== 'opera' && source === 'manual' ? 'manual' : 'opera';
    const operaDate = validISO(value.operaDate) ? value.operaDate : source === 'opera' ? value.date : '';
    return { date: value.date, source, at: stamp(value.at), hotelId: id, mode, operaDate,
      operaAt: operaDate ? stamp(value.operaAt) || (source === 'opera' ? stamp(value.at) : 0) : 0 };
  }
  function current() {
    const id = hotel();
    if (!contexts.has(id)) {
      let saved;
      try { saved = clean(JSON.parse(W.localStorage?.getItem(key(id)) || 'null'), id); } catch (_) {}
      contexts.set(id, saved || { date: dubaiDay(), source: 'calendar', at: Date.now(), hotelId: id, mode: 'opera', operaDate: '', operaAt: 0 });
      remember(contexts.get(id));
    }
    return contexts.get(id);
  }
  function remember(value) { try { W.localStorage?.setItem(key(value.hotelId), JSON.stringify(value)); } catch (_) {} }
  function changed(before, next) {
    contexts.set(next.hotelId, next); remember(next);
    if (['date', 'source', 'mode', 'operaDate', 'operaAt'].some(k => before[k] !== next[k])) {
      try { if (typeof W.dispatchEvent === 'function' && typeof W.CustomEvent === 'function') W.dispatchEvent(new W.CustomEvent('purpose-business-date', { detail: { ...next } })); } catch (_) {}
    }
  }
  const mayWrite = () => { try { return typeof currentProfile !== 'undefined' && !!currentProfile && currentProfile.role !== 'readonly'; } catch (_) { return false; } };
  function resolve() { return current().date; }
  function info() { return { ...current() }; }
  function persist(value) {
    if (mayWrite() && typeof W.savePurposeBusinessDate === 'function') {
      try { Promise.resolve(W.savePurposeBusinessDate(value.date, value)).catch(() => {}); } catch (_) {}
    }
  }
  function restore(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return resolve();
    const id = hotel();
    if (snapshot.businessDateHotelId && snapshot.businessDateHotelId !== id) return resolve();
    const explicit = validISO(snapshot.businessDate), date = explicit ? snapshot.businessDate : snapshot.date;
    if (!validISO(date)) return resolve();
    const before = current(), source = explicit && SOURCES.has(snapshot.businessDateSource) ? snapshot.businessDateSource : 'saved';
    const at = stamp(snapshot.businessDateAt) || stamp(Date.parse(snapshot.updatedAt || ''));
    const incoming = clean({ date, source, at, mode: snapshot.businessDateMode,
      operaDate: snapshot.operaBusinessDate, operaAt: snapshot.operaBusinessDateAt }, id);
    // Remember fresh Opera evidence independently of a manually selected report.
    const latest = incoming.operaDate && incoming.operaAt >= before.operaAt && (!before.operaDate || incoming.operaDate >= before.operaDate)
      ? { operaDate: incoming.operaDate, operaAt: incoming.operaAt } : { operaDate: before.operaDate, operaAt: before.operaAt };
    let accept = true;
    if (before.source !== 'calendar') {
      if (before.mode === 'manual' && !['manual', 'opera'].includes(snapshot.businessDateMode)) accept = false;
      if (before.source === 'opera' && source !== 'opera' && snapshot.businessDateMode !== 'manual') accept = false;
      if (at < before.at || !at && before.at) accept = false;
      if (source === 'opera' && latest.operaDate && date < latest.operaDate) accept = false;
    }
    const next = accept ? { ...incoming, ...latest } : { ...before, ...latest };
    changed(before, next);
    return next.date;
  }
  function observe(date, metadata = {}) {
    if (!validISO(date)) return false;
    const source = metadata.source === 'manual' ? 'manual' : 'opera', before = current(), at = stamp(metadata.at) || Date.now();
    if (source === 'manual' && !mayWrite()) return false;
    if (source === 'manual') {
      if (date === before.date && before.mode === 'manual') return false;
      const next = { ...before, date, source, at: Math.max(at, before.at + 1), mode: 'manual' };
      changed(before, next); persist(next); return true;
    }
    if (before.operaDate && (date < before.operaDate || at < before.operaAt)) return false;
    const evidenceChanged = date !== before.operaDate;
    const selectionChanged = before.mode !== 'manual' && (date !== before.date || before.source !== 'opera');
    const next = { ...before, operaDate: date, operaAt: at,
      ...(before.mode === 'manual' ? {} : { date, source: 'opera', at }) };
    changed(before, next);
    // Repeated heartbeats refresh local freshness without writing the shared
    // report on every ping. A new day is always saved, including in manual mode.
    if (evidenceChanged || selectionChanged) persist(next);
    return evidenceChanged || selectionChanged;
  }
  function useOpera() {
    if (!mayWrite()) return false;
    const before = current(); if (before.mode === 'opera') return false;
    const next = { ...before, mode: 'opera', date: before.operaDate || before.date,
      source: before.operaDate ? 'opera' : 'saved', at: Math.max(Date.now(), before.at + 1) };
    changed(before, next); persist(next); return true;
  }
  function start(date) { if (typeof date === 'string') observe(date, { source: 'manual' }); return resolve(); }
  W.PurposeBusinessDate = { validISO, dubaiDay, resolve, info, restore, observe, start, useOpera };
  if (typeof module !== 'undefined' && module.exports) module.exports = W.PurposeBusinessDate;
})(typeof window !== 'undefined' ? window : globalThis);
