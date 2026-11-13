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
    return value && validISO(value.date) && (!value.hotelId || value.hotelId === id)
      ? { date: value.date, source: SOURCES.has(value.source) ? value.source : 'saved', at: stamp(value.at), hotelId: id } : null;
  }
  function current() {
    const id = hotel();
    if (!contexts.has(id)) {
      let saved;
      try { saved = clean(JSON.parse(W.localStorage?.getItem(key(id)) || 'null'), id); } catch (_) {}
      contexts.set(id, saved || { date: dubaiDay(), source: 'calendar', at: Date.now(), hotelId: id });
      remember(contexts.get(id));
    }
    return contexts.get(id);
  }
  function remember(value) { try { W.localStorage?.setItem(key(value.hotelId), JSON.stringify(value)); } catch (_) {} }
  function changed(before, next) {
    contexts.set(next.hotelId, next); remember(next);
    if (before.date !== next.date || before.source !== next.source) {
      try { if (typeof W.dispatchEvent === 'function' && typeof W.CustomEvent === 'function') W.dispatchEvent(new W.CustomEvent('purpose-business-date', { detail: { ...next } })); } catch (_) {}
    }
  }
  const mayWrite = () => { try { return typeof currentProfile !== 'undefined' && !!currentProfile && currentProfile.role !== 'readonly'; } catch (_) { return false; } };
  function resolve() { return current().date; }
  function info() { return { ...current() }; }
  function restore(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return resolve();
    const id = hotel();
    if (snapshot.businessDateHotelId && snapshot.businessDateHotelId !== id) return resolve();
    const explicit = validISO(snapshot.businessDate), date = explicit ? snapshot.businessDate : snapshot.date;
    if (!validISO(date)) return resolve();
    const before = current(), source = explicit && SOURCES.has(snapshot.businessDateSource) ? snapshot.businessDateSource : 'saved';
    const at = stamp(snapshot.businessDateAt) || stamp(Date.parse(snapshot.updatedAt || ''));
    // A restored report outranks the first-load calendar fallback. Once Opera
    // or a reviewer establishes a day, stale Firebase/cache replies cannot undo it.
    if (before.source !== 'calendar') {
      if (before.source === 'opera' && source !== 'opera') return before.date;
      if (at < before.at || !at && before.at) return before.date;
      if (source === 'opera' && date < before.date) return before.date;
    }
    changed(before, { date, source, at, hotelId: id });
    return date;
  }
  function observe(date, metadata = {}) {
    if (!validISO(date)) return false;
    const source = metadata.source === 'manual' ? 'manual' : 'opera', before = current(), at = stamp(metadata.at) || Date.now();
    if (source === 'manual' && !mayWrite()) return false;
    if (source === 'opera' && before.source !== 'calendar') {
      if (date < before.date || before.source === 'opera' && at < before.at) return false;
    }
    if (date === before.date && source === before.source) return false;
    const next = { date, source, at, hotelId: hotel() };
    changed(before, next);
    if (mayWrite() && typeof W.savePurposeBusinessDate === 'function') {
      try { Promise.resolve(W.savePurposeBusinessDate(date, next)).catch(() => {}); } catch (_) {}
    }
    return true;
  }
  function start(date) { if (typeof date === 'string') observe(date, { source: 'manual' }); return resolve(); }
  W.PurposeBusinessDate = { validISO, dubaiDay, resolve, info, restore, observe, start };
  if (typeof module !== 'undefined' && module.exports) module.exports = W.PurposeBusinessDate;
})(typeof window !== 'undefined' ? window : globalThis);
