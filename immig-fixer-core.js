// ═══════════════════════════════════════════════════════════
//  immig-fixer-core.js — plan logic for "Fix in Opera" (pure, no page, no network)
//  Builds, from the Immigration Check rows and the Vicas Inhouse list, the list of
//  EMPTY fields (gender, nationality, ID type + number) that can be filled in a guest's
//  Opera profile. It only proposes: nothing here touches Opera.
//  Document numbers live in the plan only for the one browser session; logs and shared
//  records keep the last 4 characters (last4).
// ═══════════════════════════════════════════════════════════
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.hoImmigFix = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const CODES = 'AF:Afghanistan|AL:Albania|DZ:Algeria|AD:Andorra|AO:Angola|AG:Antigua and Barbuda|AR:Argentina|AM:Armenia|AU:Australia|AT:Austria|AZ:Azerbaijan|BS:Bahamas|BH:Bahrain|BD:Bangladesh|BB:Barbados|BY:Belarus|BE:Belgium|BZ:Belize|BJ:Benin|BT:Bhutan|BO:Bolivia|BA:Bosnia and Herzegovina|BW:Botswana|BR:Brazil|BN:Brunei|BG:Bulgaria|BF:Burkina Faso|BI:Burundi|KH:Cambodia|CM:Cameroon|CA:Canada|CV:Cape Verde|CF:Central African Republic|TD:Chad|CL:Chile|CN:China|CO:Colombia|KM:Comoros|CG:Congo|CD:Democratic Republic of the Congo|CR:Costa Rica|CI:Cote d\'Ivoire|HR:Croatia|CU:Cuba|CY:Cyprus|CZ:Czech Republic|DK:Denmark|DJ:Djibouti|DM:Dominica|DO:Dominican Republic|EC:Ecuador|EG:Egypt|SV:El Salvador|GQ:Equatorial Guinea|ER:Eritrea|EE:Estonia|SZ:Eswatini|ET:Ethiopia|FJ:Fiji|FI:Finland|FR:France|GA:Gabon|GM:Gambia|GE:Georgia|DE:Germany|GH:Ghana|GR:Greece|GD:Grenada|GT:Guatemala|GN:Guinea|GW:Guinea-Bissau|GY:Guyana|HT:Haiti|HN:Honduras|HK:Hong Kong|HU:Hungary|IS:Iceland|IN:India|ID:Indonesia|IR:Iran|IQ:Iraq|IE:Ireland|IL:Israel|IT:Italy|JM:Jamaica|JP:Japan|JO:Jordan|KZ:Kazakhstan|KE:Kenya|KI:Kiribati|KW:Kuwait|KG:Kyrgyzstan|LA:Laos|LV:Latvia|LB:Lebanon|LS:Lesotho|LR:Liberia|LY:Libya|LI:Liechtenstein|LT:Lithuania|LU:Luxembourg|MO:Macao|MG:Madagascar|MW:Malawi|MY:Malaysia|MV:Maldives|ML:Mali|MT:Malta|MH:Marshall Islands|MR:Mauritania|MU:Mauritius|MX:Mexico|FM:Micronesia|MD:Moldova|MC:Monaco|MN:Mongolia|ME:Montenegro|MA:Morocco|MZ:Mozambique|MM:Myanmar|NA:Namibia|NR:Nauru|NP:Nepal|NL:Netherlands|NZ:New Zealand|NI:Nicaragua|NE:Niger|NG:Nigeria|KP:North Korea|MK:North Macedonia|NO:Norway|OM:Oman|PK:Pakistan|PW:Palau|PS:Palestine|PA:Panama|PG:Papua New Guinea|PY:Paraguay|PE:Peru|PH:Philippines|PL:Poland|PT:Portugal|QA:Qatar|RO:Romania|RU:Russian Federation|RW:Rwanda|KN:Saint Kitts and Nevis|LC:Saint Lucia|VC:Saint Vincent and the Grenadines|WS:Samoa|SM:San Marino|ST:Sao Tome and Principe|SA:Saudi Arabia|SN:Senegal|RS:Serbia|SC:Seychelles|SL:Sierra Leone|SG:Singapore|SK:Slovakia|SI:Slovenia|SB:Solomon Islands|SO:Somalia|ZA:South Africa|KR:South Korea|SS:South Sudan|ES:Spain|LK:Sri Lanka|SD:Sudan|SR:Suriname|SE:Sweden|CH:Switzerland|SY:Syria|TW:Taiwan|TJ:Tajikistan|TZ:Tanzania|TH:Thailand|TL:Timor-Leste|TG:Togo|TO:Tonga|TT:Trinidad and Tobago|TN:Tunisia|TR:Turkey|TM:Turkmenistan|TV:Tuvalu|UG:Uganda|UA:Ukraine|AE:United Arab Emirates|GB:United Kingdom|US:United States|UY:Uruguay|UZ:Uzbekistan|VU:Vanuatu|VA:Vatican City|VE:Venezuela|VN:Vietnam|YE:Yemen|ZM:Zambia|ZW:Zimbabwe|XK:Kosovo';
  const ALIAS = { 'russia': 'RU', 'uk': 'GB', 'great britain': 'GB', 'england': 'GB', 'united states of america': 'US', 'usa': 'US', 'uae': 'AE', 'ivory coast': 'CI', 'korea republic of': 'KR', 'republic of korea': 'KR', 'south korea': 'KR', 'korea': 'KR', 'viet nam': 'VN', 'czechia': 'CZ', 'turkiye': 'TR', 'cabo verde': 'CV', 'timor leste': 'TL', 'swaziland': 'SZ', 'burma': 'MM', 'syrian arab republic': 'SY', 'iran islamic republic of': 'IR', 'lao peoples democratic republic': 'LA', 'brunei darussalam': 'BN', 'congo democratic republic': 'CD', 'dr congo': 'CD', 'macedonia': 'MK', 'palestinian territory': 'PS', 'holy see': 'VA', 'tanzania united republic of': 'TZ', 'moldova republic of': 'MD' };
  const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const BY_NAME = {}, VALID = {};
  CODES.split('|').forEach(p => { const i = p.indexOf(':'); BY_NAME[fold(p.slice(i + 1))] = p.slice(0, i); VALID[p.slice(0, i)] = p.slice(i + 1); });
  Object.keys(ALIAS).forEach(k => { BY_NAME[fold(k)] = ALIAS[k]; });
  /** Opera's two-letter country code for a name, or '' when the name is not an exact known country. */
  function countryCode(name) {
    const s = String(name || '').trim();
    if (/^[A-Za-z]{2}$/.test(s) && VALID[s.toUpperCase()]) return s.toUpperCase();
    return BY_NAME[fold(s)] || '';
  }
  const countryList = () => Object.keys(VALID).map(c => ({ code: c, name: VALID[c] })).sort((a, b) => a.name.localeCompare(b.name));
  const normRoom = r => String(r == null ? '' : r).trim().replace(/^0+(?=\d)/, '').toUpperCase();
  const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'mstr', 'master', 'sir', 'madam']);
  const tokens = s => fold(s).split(' ').filter(t => t && !TITLES.has(t));
  /** how many name words two spellings share, and whether one name's words all appear in the other */
  function nameMatch(a, b) {
    const A = tokens(a), B = tokens(b);
    if (!A.length || !B.length) return { shared: 0, full: false, same: false };
    const sb = new Set(B), shared = A.filter(t => sb.has(t)).length;
    const sa = new Set(A);
    return { shared, full: A.every(t => sb.has(t)) || B.every(t => sa.has(t)), same: A.length === B.length && A.every(t => sb.has(t)) };
  }
  /** Emirates ID: 15 digits starting 784; everything else with letters/digits is treated as a passport number */
  function docKind(n) { return /^784\d{12}$/.test(String(n || '').replace(/[\s-]/g, '')) ? 'EID' : 'PAS'; }
  const last4 = v => { const s = String(v == null ? '' : v).replace(/\s+/g, ''); return s ? (s.length > 4 ? '••••' + s.slice(-4) : '••••') : ''; };
  const isMasked = v => /[Xx*•]{3,}/.test(String(v || '')) ;
  /** a profile value counts as empty when blank or a dash; a masked number with real characters is NOT empty */
  const isEmptyValue = v => { const s = String(v == null ? '' : v).trim(); return !s || /^[-–—_.]+$/.test(s) || /^(unknown|u|n\/a|none)$/i.test(s); };

  /** the one Inhouse guest for this immigration row: same room, then the best name. Ambiguity is never guessed. */
  function matchInhouse(row, list) {
    const room = normRoom(row.room), cand = (list || []).filter(g => normRoom(g.room) === room && room);
    if (!cand.length) return { guest: null, why: 'room not in the Vicas list' };
    const scored = cand.map(g => ({ g, m: nameMatch(row.name, g.name) })).filter(x => x.m.shared > 0);
    if (!scored.length) return { guest: null, why: 'no name in that room matches' };
    scored.sort((a, b) => b.m.shared - a.m.shared || Number(b.m.full) - Number(a.m.full));
    const top = scored[0], tie = scored.filter(x => x.m.shared === top.m.shared && x.m.full === top.m.full);
    if (tie.length > 1) return { guest: null, why: 'more than one guest in the room matches the name' };
    return { guest: top.g, strong: top.m.full && top.m.shared >= 2, why: '' };
  }

  /**
   * rows: Immigration Check rows ({room,name,arrival,noNat,noSex,noPass,suggestedSex,guessedSex}); list: Vicas guests
   * ({room,name,nat,doc,arrival}). Only fields that are EMPTY in the report are proposed.
   * needsTap: true = off until he turns it on (guesses, partial name matches, every ID number).
   */
  const blank = (field, label) => ({ field, label, value: '', display: '', source: 'you choose', needsTap: true });
  function buildPlan(rows, list, meta) {
    const items = [];
    (rows || []).forEach((r, i) => {
      const fields = [], notes = [];
      const mt = (r.noNat || r.noPass) ? matchInhouse(r, list) : { guest: null, why: '' };
      if (r.noNat) {
        if (mt.guest && mt.guest.nat) {
          const code = countryCode(mt.guest.nat);
          if (code) fields.push({ field: 'nationality', label: 'Nationality', value: code, display: code + ' · ' + VALID[code], source: 'Vicas Inhouse', needsTap: !mt.strong });
          else { notes.push('Vicas nationality "' + mt.guest.nat + '" has no exact Opera country code'); fields.push(blank('nationality', 'Nationality')); }
        } else { if (mt.why) notes.push('Nationality: ' + mt.why); fields.push(blank('nationality', 'Nationality')); }
      }
      if (r.noSex) {
        const g = r.suggestedSex || r.guessedSex;
        if (g === 'M' || g === 'F') fields.push({ field: 'gender', label: 'Gender', value: g, display: g, source: r.suggestedSex ? 'title (Mr/Mrs/Ms)' : 'guessed from first name', needsTap: !r.suggestedSex });
        else { notes.push('Gender: nothing to suggest, choose it yourself'); fields.push(blank('gender', 'Gender')); }
      }
      if (r.noPass) {
        if (mt.guest && !isEmptyValue(mt.guest.doc) && !isMasked(mt.guest.doc)) {
          const kind = docKind(mt.guest.doc);
          const pref = kind === 'EID' && meta && UAE_ID_TYPES.includes(meta.uaeIdType) ? meta.uaeIdType : '';
          const tv = kind === 'PAS' ? 'PAS' : pref;
          fields.push({ field: 'idType', label: 'ID type', value: tv, display: tv, source: kind === 'PAS' ? 'Vicas Inhouse' : (pref ? 'Emirates ID: your usual UAE type' : 'Emirates ID: choose RES or IDC'), needsTap: true, idKind: kind });
          fields.push({ field: 'idNumber', label: 'ID number', value: String(mt.guest.doc).replace(/\s+/g, ''), display: last4(mt.guest.doc), source: 'Vicas Inhouse', needsTap: true, idKind: kind, secret: true });
        } else if (mt.why) notes.push('ID: ' + mt.why);
      }
      if (fields.length || notes.length) items.push({ id: 'i' + i + '-' + normRoom(r.room), room: normRoom(r.room), arrival: r.arrival || '', name: r.name || '', fields, notes });
    });
    return { v: 1, hotel: (meta && meta.hotel) || '', businessDate: (meta && meta.businessDate) || '', items };
  }

  const FIELDS = ['gender', 'nationality', 'idType', 'idNumber'];
  // ID Type codes seen in Opera (Ibis Styles Deira). Opera has no Emirates ID code: he picks one (RES, IDC or GCC ID) until it is settled.
  const UAE_ID_TYPES = ['RES', 'IDC'];   // both are used for UAE documents; GCC ID is for other GCC nationals' cards, PAS for passports
  const ID_TYPES = ['PAS', 'DRL', 'IDC', 'MID', 'GCC ID', 'RES', 'GRN', 'SSC', 'VISA', 'UNKNOWN'];
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); }
  const b64 = s => typeof Buffer !== 'undefined' ? Buffer.from(s, 'utf8').toString('base64') : btoa(unescape(encodeURIComponent(s)));
  const unb64 = s => typeof Buffer !== 'undefined' ? Buffer.from(s, 'base64').toString('utf8') : decodeURIComponent(escape(atob(s)));
  /** the text he copies to the Opera fixer: only the APPROVED fields. Approvals: { itemId: { fieldName: true } } */
  function encodePlan(plan, approved) {
    const items = [];
    (plan.items || []).forEach(it => {
      const ok = it.fields.filter(f => f.value && approved && approved[it.id] && approved[it.id][f.field]);
      // an ID number is only sent together with its type, and an ID type never travels alone
      const hasNum = ok.some(f => f.field === 'idNumber'), hasType = ok.some(f => f.field === 'idType');
      // the number is only typed when its type is approved too (Opera needs a type for the document)
      const f2 = ok.filter(f => f.field === 'idType' ? hasNum : f.field === 'idNumber' ? hasType : true);
      if (f2.length) items.push({ id: it.id, room: it.room, name: it.name, arrival: it.arrival, fields: f2.map(f => ({ field: f.field, value: f.value })) });
    });
    const body = JSON.stringify({ v: 1, hotel: plan.hotel, bd: plan.businessDate, items });
    return 'HOFIX1.' + hash(body) + '.' + b64(body);
  }
  function decodePlan(text) {
    const m = /^HOFIX1\.([a-z0-9]+)\.([A-Za-z0-9+/=]+)$/.exec(String(text || '').trim());
    if (!m) throw new Error('That is not an Opera fixer plan. Copy it again from HotelOps.');
    let body, plan;
    try { body = unb64(m[2]); plan = JSON.parse(body); } catch (_) { throw new Error('The plan could not be read. Copy it again.'); }
    if (hash(body) !== m[1]) throw new Error('The plan was changed or cut short. Copy it again.');
    if (!plan || plan.v !== 1 || !Array.isArray(plan.items)) throw new Error('Unsupported plan.');
    plan.items.forEach(it => {
      if (!it.room || !it.name || !Array.isArray(it.fields)) throw new Error('A plan row is incomplete.');
      it.fields.forEach(f => {
        if (!FIELDS.includes(f.field) || typeof f.value !== 'string' || !f.value) throw new Error('A plan field is not allowed.');
        if (f.field === 'gender' && !/^[MF]$/.test(f.value)) throw new Error('Gender must be M or F.');
        if (f.field === 'nationality' && !VALID[f.value]) throw new Error('Unknown country code.');
        if (f.field === 'idType' && !ID_TYPES.includes(f.value)) throw new Error('Unknown ID type.');
      });
    });
    return plan;
  }
  /** one change-log row. Names and document numbers never go in: room, field, new value (ID numbers as last 4), result. */
  function logEntry(o) {
    const secret = o.field === 'idNumber';
    return { t: o.t || new Date().toISOString(), hotel: o.hotel || '', room: normRoom(o.room), arrival: o.arrival || '', field: o.field, to: secret ? last4(o.value) : String(o.value || ''), result: o.result, by: o.by || '', dry: !!o.dry };
  }
  return { countryCode, countryList, normRoom, tokens, nameMatch, docKind, last4, isMasked, isEmptyValue, matchInhouse, ID_TYPES, UAE_ID_TYPES, buildPlan, encodePlan, decodePlan, logEntry, FIELDS };
});
