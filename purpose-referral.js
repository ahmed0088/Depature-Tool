// Optional, explicit suggestions for the Purpose of Stay referral column.
// Rendering and exports only read saved values; this module never persists data.
(function (W) {
  'use strict';
  const options = Object.freeze(['Online search', 'Friends / family', 'Social media', 'Previous stay', 'Booking website', 'ALL app', 'Company']);
  const text = value => {
    if (value == null) return '';
    if (typeof value === 'object') value = value.v ?? value.w ?? value.text ?? '';
    return ['string', 'number', 'boolean'].includes(typeof value) ? String(value).trim() : '';
  };
  const normalizeHeader = value => text(value).normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const headers = new Set([
    'How you hear about us', 'How did you hear about us', 'How do you hear about us',
    'How did you know about us', 'How do you know about us', 'How did you find us',
    'How did you find out about us', 'How you heard about us', 'How heard about us',
    'How heard', 'Referral source', 'HowHeard'
  ].map(normalizeHeader));
  const headerIndex = value => Array.isArray(value) ? value.findIndex(cell => headers.has(normalizeHeader(cell))) : -1;
  const read = (row, columnHeaders) => { const i = headerIndex(columnHeaders); return i >= 0 && Array.isArray(row) ? text(row[i]) : ''; };
  function sourceOf(guest) {
    const source = text(guest.source);
    if (typeof W.sourceCategory === 'function') {
      const category = W.sourceCategory(source);
      if (['walkin', 'allapp', 'ota', 'corporate', 'other'].includes(category)) return category;
    }
    if (/\bwalk[\s_-]*in\b/i.test(source)) return 'walkin';
    if (/\ball\b|\baccor\b/i.test(source)) return 'allapp';
    if (/booking\.?com|agoda|expedia|hotels\.com|trip\.com|traveloka|makemytrip|hotelbeds|\bota\b/i.test(source)) return 'ota';
    if (/\bcorporate\b|\bcompany\b|\bcorp\b/i.test(source)) return 'corporate';
    return 'other';
  }
  function fill(guests, { walkinOnlinePercent = 80, random = Math.random, regenerate = false } = {}) {
    if (!Array.isArray(guests)) throw new TypeError('A Purpose of Stay guest list is required.');
    if (typeof random !== 'function') throw new TypeError('A random number function is required.');
    const percent = Number(walkinOnlinePercent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw new RangeError('Choose an Online search percentage between 0 and 100.');
    const rows = guests.filter(g => g && typeof g === 'object' && !Array.isArray(g));
    const generated = g => g._howHeardGenerated === true &&
      (!Object.prototype.hasOwnProperty.call(g, '_howHeardGeneratedValue') || text(g.howHeard) === text(g._howHeardGeneratedValue));
    const eligible = rows.filter(g => !text(g.howHeard) || regenerate && generated(g));
    const walkins = eligible.filter(g => sourceOf(g) === 'walkin');
    const draw = () => {
      const value = Number(random());
      if (!Number.isFinite(value)) throw new TypeError('The random number function returned an invalid value.');
      return Math.max(0, Math.min(1 - Number.EPSILON, value));
    };
    const pick = values => values[Math.floor(draw() * values.length)];
    const shuffled = walkins.slice();
    for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(draw() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
    const onlineCount = Math.round(walkins.length * percent / 100), plan = new Map();
    shuffled.forEach((g, i) => plan.set(g, i < onlineCount ? 'Online search' : pick(options.slice(1, 4))));
    for (const g of eligible) {
      if (plan.has(g)) continue;
      const category = sourceOf(g);
      if (category === 'ota') plan.set(g, 'Booking website');
      else if (category === 'allapp') plan.set(g, 'ALL app');
      else if (category === 'corporate') plan.set(g, 'Company');
      else {
        const chance = draw();
        plan.set(g, chance < .6 ? 'Online search' : chance < .8 ? 'Friends / family' : chance < .9 ? 'Social media' : 'Previous stay');
      }
    }
    const summary = { total: rows.length, filled: 0, online: 0, regenerated: 0, preserved: rows.length - eligible.length,
      remaining: 0, bySource: { walkin: 0, allapp: 0, ota: 0, corporate: 0, other: 0 },
      walkin: { eligible: walkins.length, online: onlineCount, other: walkins.length - onlineCount, percent } };
    // Apply only after all calculations succeed, so a bad generator cannot leave a partial fill.
    for (const [g, value] of plan) {
      if (text(g.howHeard)) summary.regenerated++;
      g.howHeard = value; g._howHeardGenerated = true; g._howHeardGeneratedValue = value;
      summary.filled++; if (value === 'Online search') summary.online++;
      summary.bySource[sourceOf(g)]++;
    }
    summary.remaining = rows.filter(g => !text(g.howHeard)).length;
    return summary;
  }
  const api = { options, headerIndex, text, read, fill, sourceOf };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (W) W.PurposeReferral = api;
})(typeof window !== 'undefined' ? window : globalThis);
