// ═══════════════════════════════════════════════════════════
//  arrivals-purpose.js  —  Arrivals + Purpose of Stay + Guest modal + File loader
// ═══════════════════════════════════════════════════════════

// ── Debounced save helpers ────────────────────────────────
// Saves fire 800ms after the last keystroke — table never
// re-renders while the user is mid-edit.
let _saveArrTimer     = null;
let _savePurposeTimer = null;

function debounceSaveArrivals() {
  clearTimeout(_saveArrTimer);
  _saveArrTimer = setTimeout(() => saveArrivals(arrGuests), 5000);
}
function debounceSavePurpose() {
  clearTimeout(_savePurposeTimer);
  _savePurposeTimer = setTimeout(() => savePurpose(purposeGuests), 5000);
}

// ── Origin of Travel + Nationality — XML lookup maps ─────
// _originNameMap : normalised "GIVEN FAMILY" guest name → nationality (PRIMARY match, UAE-adjusted)
// _originMap     : normalised room number (no leading zeros, uppercase) → nationality (fallback, UAE-adjusted)
// _originNatMap  : normalised guest name → RAW passport nationality (no UAE override)
// All three populated by parseOriginXML(), which auto-detects the report format:
//   · "Inhouse" Crystal Reports XML  — GivenName1 + FamilyName1 + GuestType1 ("Main Contact")
//   · "Vicas" Transaction Report XML — FullName1 + Process1 ("Check-in" vs "Add-Escort")
// Same output shape either way, so downstream code never needs to care which one was loaded.
let _originMap       = {};
let _originNameMap   = {};
let _originNatMap    = {};
let _originNatRoomMap = {}; // room number (no leading zeros) → raw passport Nationality1 — fallback when the guest's name doesn't match exactly between reports (e.g. Opera CSV shows a shortened name)

function _normRoom(r) {
  // Strip leading zeros so "0621" matches "621", keep as string
  return String(r || '').replace(/^0+/, '').trim().toUpperCase();
}

// Normalise a guest name for matching: collapse whitespace, uppercase, trim.
function _normName(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().toUpperCase();
}

// A valid UAE Emirates ID is a 15-digit number starting with "784"
// (format 784-YYYY-XXXXXXX-X). Guests with one on file are UAE residents,
// regardless of their passport nationality.
function _isEmiratesId(doc) {
  const d = String(doc || '').replace(/[\s-]/g, '');
  return /^784\d{12}$/.test(d);
}

// Parse an Inhouse OR Vicas Crystal Reports XML export and build lookup maps:
//   nameMap: "GIVEN FAMILY" → Origin value          (primary — works for guests not yet room-assigned)
//   roomMap: room number    → Origin value          (fallback — used only if a real room number is set)
//   natMap:  "GIVEN FAMILY" → raw passport Nationality1 (NOT Emirates-ID adjusted — used for the Nationality column)
// Origin value = "UAE" if the guest has an Emirates ID on file (DocumentNumber1
// starts with 784), otherwise their passport Nationality1 — see _isEmiratesId().
//
// Two report formats are supported, auto-detected per row:
//   · Inhouse XML — fields GivenName1 + FamilyName1 + GuestType1. "Main Contact" wins on collision.
//   · Vicas XML   — fields FullName1 + Process1. "Check-in" (the actual guest) wins over
//                   "Add-Escort" (a companion added under the same room) on collision.
// Both formats share RoomNumber1, Nationality1 and DocumentNumber1, so the rest of the
// logic (Emirates-ID detection, room fallback) is identical either way.
function parseOriginXML(xmlText) {
  const roomMap    = {};
  const nameMap    = {};
  const natMap     = {};
  const natRoomMap = {}; // room → raw Nationality1 (no Emirates-ID override) — same last-checkin-wins rule as roomMap
  let   source  = null; // 'inhouse' | 'vicas' — for the toast/label only
  let   parseErrorMsg   = null; // set if the browser's XML parser itself chokes on the file
  let   sectionsFound   = 0;    // total <Section> elements matched, before the <Details>-parent filter
  let   detailRowsSeen  = 0;    // rows that passed the <Details>-parent filter (regardless of having a Nationality1)
  try {
    const parser = new DOMParser();
    const doc    = parser.parseFromString(xmlText, 'text/xml');

    // DOMParser NEVER throws on bad XML — on failure it silently returns a document
    // whose root is a <parsererror> node. Without this check, a garbled/mis-encoded
    // file (BOM, stray byte, truncated download, etc.) looks identical to "empty
    // report": both end up with 0 rows and no exception, so the real cause never
    // surfaces. Catch it explicitly and report it as a parse failure instead.
    const perr = doc.getElementsByTagName('parsererror')[0];
    if (perr) {
      parseErrorMsg = (perr.textContent || 'Unknown XML parser error').trim();
      console.warn('[OriginXML] DOMParser reported parsererror:', parseErrorMsg);
      return { roomMap, nameMap, natMap, natRoomMap, source: null, parseErrorMsg, sectionsFound: 0, detailRowsFound: 0 };
    }

    // Crystal Reports XML uses a default namespace, so querySelector('Details')
    // returns nothing in browsers. Use getElementsByTagNameNS instead — but don't
    // hardcode the schema year/URI: read the ACTUAL namespace off the root element,
    // since different Vicas/Crystal exports have been seen with slightly different
    // schemaLocation strings. Fall back to the known URI, then to a no-namespace
    // lookup, so a future export with a tweaked namespace still parses instead of
    // silently returning nothing.
    const rootNs = doc.documentElement ? doc.documentElement.namespaceURI : null;
    const knownNs = 'urn:crystal-reports:schemas:report-detail';
    let ns = rootNs || knownNs;
    let sections = doc.getElementsByTagNameNS(ns, 'Section');
    if (!sections.length && ns !== knownNs) {
      ns = knownNs;
      sections = doc.getElementsByTagNameNS(ns, 'Section');
    }
    if (!sections.length) {
      // Last resort: no-namespace lookup (covers a report exported without xmlns).
      sections = doc.getElementsByTagName('Section');
    }

    const getField = (sec, fieldName) => {
      // Find <Field Name="fieldName"> then its <FormattedValue>
      let fields = sec.getElementsByTagNameNS(ns, 'Field');
      if (!fields.length) fields = sec.getElementsByTagName('Field');
      for (let i = 0; i < fields.length; i++) {
        if (fields[i].getAttribute('Name') === fieldName) {
          let fv = fields[i].getElementsByTagNameNS(ns, 'FormattedValue')[0];
          if (!fv) fv = fields[i].getElementsByTagName('FormattedValue')[0];
          return fv ? (fv.textContent || '').trim() : '';
        }
      }
      return '';
    };

    sectionsFound = sections.length;
    for (let i = 0; i < sections.length; i++) {
      const sec   = sections[i];
      // Only process sections that are direct children of <Details>
      if (!sec.parentNode || sec.parentNode.localName !== 'Details') continue;
      detailRowsSeen++;
      const room    = getField(sec, 'RoomNumber1');
      const nat     = getField(sec, 'Nationality1');
      const docNum  = getField(sec, 'DocumentNumber1');
      if (!nat) continue;

      // Try the Inhouse schema first (GivenName1 + FamilyName1)…
      const given  = getField(sec, 'GivenName1');
      const family = getField(sec, 'FamilyName1');

      let fullName, isPrimary;
      if (given && family) {
        source    = source || 'inhouse';
        fullName  = `${given} ${family}`; // same word order as parseName(): GIVEN then FAMILY
        isPrimary = getField(sec, 'GuestType1') === 'Main Contact';
      } else {
        // …fall back to the Vicas Transaction Report schema (FullName1 + Process1)
        const vFull = getField(sec, 'FullName1');
        if (!vFull) continue; // neither schema matched this row — skip it
        source    = source || 'vicas';
        fullName  = vFull; // Vicas already reports "Given Family" order
        isPrimary = getField(sec, 'Process1') !== 'Add-Escort';
      }

      // Emirates ID on file → guest is a UAE resident, regardless of passport nationality
      const origin = _isEmiratesId(docNum) ? 'UAE' : nat;

      // Room-based map (fallback only — kept for compatibility)
      // A room can have more than one "Check-in" record on the same report if it
      // turned over that day (guest A checked out, guest B checked into the same
      // room). Every primary Check-in row overwrites the previous value here, so
      // whichever Check-in appears LAST in the report (i.e. most recent) wins —
      // that's always the guest currently occupying the room.
      if (room) {
        const rKey = _normRoom(room);
        if (isPrimary || !roomMap[rKey]) roomMap[rKey] = origin;
        if (isPrimary || !natRoomMap[rKey]) natRoomMap[rKey] = nat;
      }

      // Name-based map (primary)
      const nKey = _normName(fullName);
      if (isPrimary || !nameMap[nKey]) nameMap[nKey] = origin;
      // Raw passport nationality (no UAE override) — used to fill the Nationality column directly
      if (isPrimary || !natMap[nKey]) natMap[nKey] = nat;
    }
  } catch (e) {
    console.warn('[OriginXML] parse error:', e);
    parseErrorMsg = e && e.message ? e.message : String(e);
  }
  // Diagnostics on every run (not just on failure) — this is what tells you WHERE
  // it broke next time, instead of just "empty maps": did the browser even find
  // <Section> elements, did they have a <Details> parent, did any have a
  // Nationality1 field. Compare against the counts you'd expect from the report.
  console.log(`[OriginXML] sectionsFound=${sectionsFound} detailRowsSeen=${detailRowsSeen} rowsWithNationality=${Object.keys(natMap).length ? '~' + Object.keys(natMap).length + '+' : 0} source=${source}`);
  // Always return valid objects so Object.keys never crashes
  return {
    roomMap:    roomMap    || {},
    nameMap:    nameMap    || {},
    natMap:     natMap     || {},
    natRoomMap: natRoomMap || {},
    source:     source     || null,
    parseErrorMsg,
    sectionsFound,
    detailRowsSeen
  };
}

// Load XML from file input (called by HTML button).
// Accepts either the Inhouse Guest XML or the Vicas "Transaction Report — Check In" XML —
// format is auto-detected in parseOriginXML(), so this one button/one input handles both.
function loadOriginXML(input) {
  const file = input?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const result = parseOriginXML(e.target.result) || {};
      const roomMap    = result.roomMap    || {};
      const nameMap    = result.nameMap    || {};
      const natMap     = result.natMap     || {};
      const natRoomMap = result.natRoomMap || {};
      const source     = result.source     || null;

      _originMap        = roomMap;
      _originNameMap    = nameMap;
      _originNatMap     = natMap;
      _originNatRoomMap = natRoomMap;

      const count = Math.max(Object.keys(nameMap).length, Object.keys(roomMap).length);
      if (!count) {
        // Give a toast that actually says WHY, instead of one generic message —
        // these three cases have completely different fixes.
        if (result.parseErrorMsg) {
          showToast('XML file is not valid — the browser could not parse it (bad encoding/export?)', 'err');
        } else if (!result.sectionsFound) {
          showToast('No <Section> elements found — is this really a Crystal Reports XML export?', 'err');
        } else if (!result.detailRowsSeen) {
          showToast('XML parsed but had no data rows under <Details> — is the report empty?', 'err');
        } else {
          showToast('Rows found but none had a Nationality — check the report includes Nationality1', 'err');
        }
        console.warn('[OriginXML] empty maps — diagnostics:', {
          parseErrorMsg:   result.parseErrorMsg,
          sectionsFound:   result.sectionsFound,
          detailRowsSeen:  result.detailRowsSeen
        });
        return;
      }
      const sourceLabel = source === 'vicas' ? 'Vicas' : 'Inhouse';
      showToast(`✦ ${sourceLabel} data loaded — ${count} guests`, 'ok');
      // Apply to any already-loaded purpose guests
      _applyOriginToPurpose();
      purposeRender();
      // Update the badge/label
      const lbl = document.getElementById('originXmlLabel');
      if (lbl) lbl.textContent = `${count} guests loaded (${sourceLabel})`;
    } catch (err) {
      console.error('[OriginXML] load failed:', err);
      showToast('Failed to parse Origin XML — see console', 'err');
    }
  };
  reader.readAsText(file, 'utf-8');
}

// Fill originOfTravel field on purposeGuests from the XML lookup maps.
// Matches primarily by guest name (works even when no room is assigned yet);
// falls back to room number only if the guest has a real (numeric) room.
// Any value filled this way is also saved into shared Guest Memory so it's
// available next time, even without re-loading the Inhouse XML.
// If the Inhouse XML's Nationality field is "United Arab Emirates", it almost
// always means Opera read this from the guest's Emirates ID (residency doc),
// NOT their actual passport nationality. For Origin of Travel purposes that
// just means "UAE resident" — normalise it to the short form "UAE".
// Every other nationality is passed through unchanged.
function _normOrigin(nat) {
  const n = String(nat || '').trim();
  if (/^united arab emirates$/i.test(n)) return 'UAE';
  return n;
}

// After a fresh Opera guest list loads, nudge the user to load the
// Nationality/VICAS XML next if they haven't already this session —
// this is report #2 in the "load report 1, then report 2" workflow.
function _promptForOriginXml() {
  if (Object.keys(_originNatMap).length || Object.keys(_originMap).length) return; // already loaded
  showToast('📥 Guest list loaded — now load the Nationality/Vicas XML to fill nationalities', 'info');
  const xmlInput = document.querySelector('#purposeUploadCard input[accept=".xml"]');
  if (xmlInput) {
    xmlInput.style.outline = '2px solid var(--gold, #f0a43a)';
    xmlInput.style.borderRadius = '4px';
    if (xmlInput.scrollIntoView) xmlInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => { xmlInput.style.outline = ''; }, 4000);
  }
}

// Applies the loaded Vicas/Inhouse XML data to one guest array (either
// arrGuests or purposeGuests) — same matching rules for both: name match
// first, room-number fallback second, and a human-typed edit always wins.
function _applyOriginToGuestList(list) {
  if (!list || !list.length) return { filledOrigin: 0, filledNat: 0 };
  if (!Object.keys(_originNameMap).length && !Object.keys(_originMap).length) return { filledOrigin: 0, filledNat: 0 };
  let filledOrigin = 0;
  let filledNat    = 0;
  list.forEach(g => {
    const nameKey     = _normName(g.name);
    const roomKey     = _normRoom(g.room);
    // Ignore placeholder room text like "ASSIGN ROOM" — only use real room numbers
    const hasRealRoom = roomKey && /\d/.test(roomKey);

    if (!g.originOfTravel) {
      // Room number is primary — it's the one key both reports agree on even when
      // Opera's name is a shortened/reordered version of the XML's full legal name
      // (e.g. XML "Ahmed Ali Khan Nawab Ali Khan" vs Opera "Ahmed Khan Nawab").
      // Name match is only a fallback for guests with no real room yet.
      let nat = hasRealRoom ? _originMap[roomKey] : undefined;
      if (!nat) nat = _originNameMap[nameKey];

      if (nat) {
        const origin = _normOrigin(nat);
        g.originOfTravel = origin;
        filledOrigin++;
        // Persist to Guest Memory so future stays auto-fill even without the XML
        if (typeof gmOnEdit === 'function') gmOnEdit(g.name, 'originOfTravel', origin);
      }
    }

    // Real passport nationality straight from the XML (Vicas/Inhouse) is ground truth —
    // it wins over an AI guess AND over a Guest Memory value (a guest's nationality on
    // this specific stay is what the front-desk scan says, not what memory has from a
    // past stay). The ONLY thing that outranks it is a human typing directly into the
    // field on this screen (_natUserEdited, set by the input's oninput handler below).
    // Room number is primary — same reasoning as Origin of Travel above. Name is only
    // a fallback for guests with no real room yet.
    if (!g._natUserEdited) {
      let rawNat = hasRealRoom ? _originNatRoomMap[roomKey] : undefined;
      if (!rawNat) rawNat = _originNatMap[nameKey];
      if (rawNat && rawNat !== g.nat) {
        g.nat = rawNat;
        g._natFromXML = true;
        g._natFromAI  = false;
        g._fromMemory = false;
        filledNat++;
        if (typeof gmOnEdit === 'function') gmOnEdit(g.name, 'nat', rawNat);
      }
    }
  });
  return { filledOrigin, filledNat };
}

// Applies the XML data to whichever guest lists are currently loaded —
// Arrivals and/or Purpose of Stay — and re-renders whichever one changed.
function _applyOriginToPurpose() {
  const purposeResult  = _applyOriginToGuestList(purposeGuests);
  const arrivalsResult = _applyOriginToGuestList(arrGuests);
  const filledNat    = purposeResult.filledNat    + arrivalsResult.filledNat;
  const filledOrigin = purposeResult.filledOrigin + arrivalsResult.filledOrigin;
  const parts = [];
  if (filledNat)    parts.push(`Nationality filled for ${filledNat}`);
  if (filledOrigin) parts.push(`Origin of Travel filled for ${filledOrigin}`);
  if (parts.length) showToast(`✦ ${parts.join(' · ')}`, 'ok');
  if (purposeResult.filledNat  || purposeResult.filledOrigin)  purposeRender();
  if (arrivalsResult.filledNat || arrivalsResult.filledOrigin) arrRender();
}

// ── ARRIVALS ──────────────────────────────────────────────

// ── Shared log helper ─────────────────────────────────────
function addArrLog(action, detail) {
  const t = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  arrLog.unshift({ action, detail, time: t, ts: Date.now() });
  if (arrLog.length > 100) arrLog.pop();
  saveArrLog(arrLog);
  renderArrLog();
}

function renderArrLog() {
  const wrap  = document.getElementById('arrLogWrap');
  const body  = document.getElementById('arrLogBody');
  const badge = document.getElementById('arrLogCount');
  if (!wrap) return;
  if (!arrLog.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  if (badge) badge.textContent = arrLog.length;
  const icons = {
    'Loaded':'📥', 'Added':'➕', 'Removed':'✕', 'Purpose':'🔄',
    'Cleared':'🗑️', 'AI Nat':'✦', 'Exported':'📤', 'Synced':'🔁',
  };
  const cls = {
    'Loaded':'log-act-ext', 'Added':'log-act-co', 'Removed':'log-act-late',
    'Purpose':'log-act-ext', 'Cleared':'log-act-late', 'AI Nat':'log-act-co',
    'Exported':'log-act-ext', 'Synced':'log-act-co',
  };
  if (body) body.innerHTML = arrLog.map((l, li) => `
    <div class="log-row">
      <span class="log-action ${cls[l.action] || ''}">${icons[l.action] || '·'} ${l.action}</span>
      <span class="log-name">${escapeLogText(l.detail)}</span>
      <span class="log-time">${l.time}</span>
    </div>`).join('');
}

function escapeLogText(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function arrKpiUpdate() {
  const t   = arrGuests.length;
  const l   = arrGuests.filter(g => g.purpose === 'Leisure').length;
  const b   = arrGuests.filter(g => g.purpose === 'Business').length;
  const avg = t ? Math.round(arrGuests.reduce((s, g) => s + Number(g.nights), 0) / t) : 0;
  ['ak-total','ak-leisure','ak-business','ak-nights'].forEach((id, i) => {
    const el = document.getElementById(id); if (el) el.textContent = [t,l,b,avg][i];
  });
  const badge = document.getElementById('badge-arrivals'); if (badge) badge.textContent = t || '0';
}

function arrRemoveGuest(i) {
  const g = arrGuests[i];
  arrGuests.splice(i, 1);
  arrRender(); saveArrivals(arrGuests);
  addArrLog('Removed', `${g.name} — Room ${g.room}`);
}

function arrChangePurpose(i, val) {
  const prev = arrGuests[i].purpose;
  arrGuests[i].purpose = val;
  arrRender(); saveArrivals(arrGuests);
  addArrLog('Purpose', `${arrGuests[i]?.name || 'Guest'}: ${prev} → ${val}`);
}

function arrRender() {
  const search   = (document.getElementById('arrSearch')?.value || '').toLowerCase();
  const filtered = arrGuests.filter(g => {
    const mf  = arrFilter_ === 'all' || g.purpose === arrFilter_;
    const msf = arrSrcFilter_ === 'all' || sourceCategory(g.source) === arrSrcFilter_;
    const ms  = !search || [g.room,g.conf,g.name,g.nat,g.source].join(' ').toLowerCase().includes(search);
    return mf && msf && ms;
  });
  const tbody = document.getElementById('arrTable'); if (!tbody) return;
  if (!arrGuests.length) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:36px;font-family:var(--mono);font-size:0.7rem;color:var(--text3);">No arrivals loaded. Paste Opera data or upload a file above.</td></tr>';
    arrKpiUpdate(); return;
  }
  tbody.innerHTML = filtered.map(g => {
    const i = arrGuests.indexOf(g);
    const srcCat = sourceCategory(g.source);
    return `<tr class="${g.purpose==='Leisure'?'leisure-row':''}">
      <td><input value="${escapeHtml(g.room)}"
        oninput="arrGuests[${i}].room=this.value"
        onblur="debounceSaveArrivals()"
        style="width:46px;"/></td>
      <td><input value="${escapeHtml(g.conf)}"
        oninput="arrGuests[${i}].conf=this.value"
        style="width:86px;"/></td>
      <td><input value="${escapeHtml(g.name)}"
        oninput="arrGuests[${i}].name=this.value"
        onblur="arrGuests[${i}].name=this.value.toUpperCase();this.value=arrGuests[${i}].name;debounceSaveArrivals()"
        style="width:165px;"/></td>
      <td><select onchange="arrChangePurpose(${i},this.value)">
        ${['Business','Leisure','Flight'].map(p=>`<option${g.purpose===p?' selected':''}>${p}</option>`).join('')}
      </select></td>
      <td><input type="number" value="${escapeHtml(g.nights)}"
        oninput="arrGuests[${i}].nights=this.value"
        onblur="arrKpiUpdate();debounceSaveArrivals()"
        style="width:42px;"/></td>
      <td><div style="display:flex;gap:3px;align-items:center;">
        <input value="${escapeHtml(g.nat)}"
          oninput="arrGuests[${i}].nat=this.value"
          onblur="gmOnEdit(arrGuests[${i}].name,'nat',this.value);debounceSaveArrivals()"
          style="width:86px;${g._fromMemory?'border-color:var(--sky);':''}"/>
        <button class="icon-btn ai-btn" onclick="aiOneGuest(${i},'arr')" title="AI guess">✦</button>
      </div></td>
      <td><input value="${escapeHtml(g.email)}"
        oninput="arrGuests[${i}].email=this.value"
        onblur="gmOnEdit(arrGuests[${i}].name,'email',this.value);debounceSaveArrivals()"
        style="width:138px;${g._fromMemory?'border-color:var(--sky);':''}"/></td>
      <td><div style="display:flex;align-items:center;gap:5px;">
        <input value="${escapeHtml(g.source)}"
          oninput="arrGuests[${i}].source=this.value;_updateSrcBadge('src-badge-a-${i}',this.value)"
          onblur="debounceSaveArrivals()"
          title="Free text — categorised automatically as Walk-in / ALL App / OTA / Corporate / Other"
          style="width:82px;"/>
        <span class="src-badge ${srcCat}" id="src-badge-a-${i}">${SOURCE_CATEGORIES[srcCat].label}</span>
      </div></td>
      <td><input value="${escapeHtml(g.remarks)}"
        oninput="arrGuests[${i}].remarks=this.value"
        onblur="debounceSaveArrivals()"
        style="width:86px;"/></td>
      <td><button class="icon-btn" onclick="arrRemoveGuest(${i})">✕</button></td>
    </tr>`;
  }).join('');
  arrKpiUpdate();
}

function arrFilter(f, el) {
  arrFilter_ = f;
  document.querySelectorAll('[data-af]').forEach(c => c.classList.remove('on'));
  el.classList.add('on');
  arrRender();
}

// ── Source-category filter (Walk-in / ALL App / OTA / Corporate / Other) —
// mirrors purposeFilterSrc() so Arrivals and Purpose of Stay behave the same ──
function arrFilterSrc(f, el) {
  arrSrcFilter_ = f;
  document.querySelectorAll('[data-asf]').forEach(c => c.classList.remove('on'));
  el.classList.add('on');
  arrRender();
}

async function runAINat_arr() {
  setSpinner('aiSpinArr', true);
  arrGuests.forEach(g => {
    if (!g.nat) {
      const guessed = guessNat(g.name);
      if (guessed) { g.nat = guessed; g._natFromAI = true; }
    }
  });
  arrRender();
  setSpinner('aiSpinArr', false);
  saveArrivals(arrGuests);
  addArrLog('AI Nat', `Nationality guessed for ${arrGuests.filter(g=>g.nat).length} guests`);
}

async function aiOneGuest(i, list) {
  const guests = list === 'arr' ? arrGuests : purposeGuests;
  const nat    = guessNat(guests[i].name);
  if (nat) { guests[i].nat = nat; guests[i]._natFromXML = false; guests[i]._natFromAI = true; }
  arrRender(); purposeRender();
}

function loadArrivals() {
  const raw = document.getElementById('arrInput').value.trim();
  if (!raw) { alert('Please paste data first.'); return; }
  const lines = raw.split('\n').filter(l => l.trim());
  if (lines.length < 2) { alert('Not enough data.'); return; }
  // Auto-detect delimiter — tab-delimited Opera paste, or a quoted comma CSV
  // (e.g. Arrivals_Opera.csv) — handle both instead of assuming tabs.
  const delim     = lines[0].includes('\t') ? '\t' : ',';
  const splitLine = delim === '\t' ? (l => l.split('\t')) : parseCSVLine;
  const hdrs = splitLine(lines[0]).map(h => h.replace(/"/g,'').trim().toUpperCase());
  const ci   = n => hdrs.findIndex(h => h.includes(n));
  const rI=ci('ROOM'),nI=ci('NAME'),niI=ci('NIGHT'),cI=hdrs.findIndex(h=>h.includes('CONFIRM')),taI=ci('TRAVEL'),coI=ci('COMPANY'),srcI=ci('SOURCE'),
        eI=hdrs.findIndex(h=>h.includes('EMAIL') || h.includes('E-MAIL'));
  if (rI < 0 || nI < 0) { alert('Could not find Room/Name columns.'); return; }
  const guests = [];
  for (let i = 1; i < lines.length; i++) {
    const p    = splitLine(lines[i]);
    const room = (p[rI]||'').replace(/"/g,'').trim();
    const rn   = (p[nI]||'').replace(/"/g,'').trim();
    if (!room || !rn) continue;
    guests.push({ room, conf:cI>=0?(p[cI]||'').replace(/"/g,'').trim():'', name:cleanName(rn), purpose:'Business',
      nights:niI>=0?parseInt(p[niI])||1:1, nat:'', email: (eI>=0 && (p[eI]||'').trim()) ? (p[eI]||'').replace(/"/g,'').trim() : 'No@email.com',
      source:cleanSource(taI>=0?(p[taI]||'').replace(/"/g,'').trim():'', coI>=0?(p[coI]||'').replace(/"/g,'').trim():'', srcI>=0?(p[srcI]||'').replace(/"/g,'').trim():''),
      remarks:'' });
  }
  if (!guests.length) { alert('No guests found.'); return; }
  arrGuests = guests;
  _applyOriginToPurpose();   // re-apply any already-loaded XML instantly — don't discard it
  arrRender();
  // Real XML data (Vicas/Inhouse) first — it's ground truth, not a guess.
  // AI guesser only fills whoever wasn't matched; memory tops that off.
  setTimeout(() => {
    runAINat_arr().then(() => {
      if (typeof gmAutoFill === 'function') gmAutoFill(arrGuests);
      arrRender();
      _promptForOriginXml();   // ask for report #2 (the nationality XML) if not loaded yet
    });
  }, 300);
  addArrLog('Loaded', `${guests.length} guests loaded from paste`);
  logActivity('arrivals_loaded', `${guests.length} guests`);
}

function clearArrivals() { arrGuests = []; arrRender(); saveArrivals([]); addArrLog('Cleared', 'All arrivals cleared'); logActivity('arrivals_cleared', ''); }

function exportArrivals() {
  const wb   = XLSX.utils.book_new();
  const data = [['Room','Conf.','Name','Purpose','Nights','Nationality','Email','Source','Remarks']];
  arrGuests.forEach(g => data.push([g.room,g.conf,g.name,g.purpose,g.nights,g.nat,g.email,g.source,g.remarks]));
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [8,16,28,14,8,14,26,20,18].map(w => ({wch:w}));
  XLSX.utils.book_append_sheet(wb, ws, 'Arrivals');
  XLSX.writeFile(wb, 'Arrivals_' + new Date().toISOString().split('T')[0] + '.xlsx');
  addArrLog('Exported', `${arrGuests.length} guests exported to Excel`);
}

// ── PURPOSE OF STAY ───────────────────────────────────────

function addPurposeLog(action, detail) {
  const t = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  purposeLog.unshift({ action, detail, time: t, ts: Date.now() });
  if (purposeLog.length > 100) purposeLog.pop();
  savePurposeLog(purposeLog);
  renderPurposeLog();
}

function renderPurposeLog() {
  const wrap  = document.getElementById('purposeLogWrap');
  const body  = document.getElementById('purposeLogBody');
  const badge = document.getElementById('purposeLogCount');
  if (!wrap) return;
  if (!purposeLog.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  if (badge) badge.textContent = purposeLog.length;
  const icons = { 'Loaded':'📥','Added':'➕','Removed':'✕','Purpose':'🔄','Cleared':'🗑️','AI Nat':'✦','Exported':'📤','Synced':'🔁','Emails':'📧' };
  const cls   = { 'Loaded':'log-act-ext','Added':'log-act-co','Removed':'log-act-late','Purpose':'log-act-ext','Cleared':'log-act-late','AI Nat':'log-act-co','Exported':'log-act-ext','Synced':'log-act-co','Emails':'log-act-co' };
  if (body) body.innerHTML = purposeLog.map(l => `
    <div class="log-row">
      <span class="log-action ${cls[l.action] || ''}">${icons[l.action] || '·'} ${l.action}</span>
      <span class="log-name">${escapeLogText(l.detail)}</span>
      <span class="log-time">${l.time}</span>
    </div>`).join('');
}

function purposeRemoveGuest(i) {
  const g = purposeGuests[i];
  purposeGuests.splice(i, 1);
  purposeRender(); savePurpose(purposeGuests);
  addPurposeLog('Removed', `${g.name} — Room ${g.room}`);
}

function purposeChangePurpose(i, val) {
  const prev = purposeGuests[i].purpose;
  purposeGuests[i].purpose = val;
  purposeKpiUpdate(); purposeRender(); savePurpose(purposeGuests);
  addPurposeLog('Purpose', `${purposeGuests[i]?.name || 'Guest'}: ${prev} → ${val}`);
}

function editPurposeTitle() {
  const t = prompt('Report title:', _purposeTitle);
  if (t) { _purposeTitle = t; const el = document.getElementById('purposeTitle'); if (el) el.textContent = t; }
}

function purposeKpiUpdate() {
  const t = purposeGuests.length;
  ['pk-total','pk-biz','pk-lei'].forEach((id, i) => {
    const el = document.getElementById(id);
    if (el) el.textContent = [t, purposeGuests.filter(g=>g.purpose==='Business').length, purposeGuests.filter(g=>g.purpose==='Leisure').length][i];
  });
  const badge = document.getElementById('badge-purpose'); if (badge) badge.textContent = t || '0';
}

function purposeRender() {
  const search   = (document.getElementById('purposeSearch')?.value || '').toLowerCase();
  const filtered = purposeGuests.filter(g => {
    const mf  = purposeFilter_ === 'all' || g.purpose === purposeFilter_;
    const msf = purposeSrcFilter_ === 'all' || sourceCategory(g.source) === purposeSrcFilter_;
    const mo  = purposeOriginFilter_ !== 'missing' || !g.originOfTravel;
    const ms  = !search || [g.room,g.conf,g.name,g.nat,g.source,g.originOfTravel].join(' ').toLowerCase().includes(search);
    return mf && msf && mo && ms;
  });
  const tbody = document.getElementById('purposeTable'); if (!tbody) return;
  if (!purposeGuests.length) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:28px 36px;">
      <div style="font-family:var(--mono);font-size:0.7rem;color:var(--text3);margin-bottom:14px;">
        No guests loaded. Sync from Arrivals, upload a file, or add manually.
      </div>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
        <button class="btn mint" onclick="syncFromArrivals()" style="font-size:0.72rem;">↑ Sync from Arrivals</button>
        <button class="btn gold" onclick="openAddGuest('purpose')" style="font-size:0.72rem;">+ Add Guest Manually</button>
      </div>
    </td></tr>`;
    purposeKpiUpdate(); return;
  }
  tbody.innerHTML = filtered.map(g => {
    const i      = purposeGuests.indexOf(g);
    const origin = g.originOfTravel || '';
    // Visual cue: green border if filled from XML, orange if blank
    const originStyle = origin
      ? 'border-color:var(--mint);'
      : (Object.keys(_originMap).length ? 'border-color:var(--amber);' : '');
    const srcCat = sourceCategory(g.source);
    return `<tr class="${g.purpose==='Leisure'?'leisure-row':''}">
      <td><input value="${escapeHtml(g.room)}"
        oninput="purposeGuests[${i}].room=this.value"
        onblur="debounceSavePurpose()"
        style="width:46px;"/></td>
      <td><input value="${escapeHtml(g.conf)}"
        oninput="purposeGuests[${i}].conf=this.value"
        style="width:86px;"/></td>
      <td><input value="${escapeHtml(g.name)}"
        oninput="purposeGuests[${i}].name=this.value"
        onblur="purposeGuests[${i}].name=this.value.toUpperCase();this.value=purposeGuests[${i}].name;debounceSavePurpose()"
        style="width:165px;"/></td>
      <td><select onchange="purposeChangePurpose(${i},this.value)">
        ${['Business','Leisure','Flight'].map(p=>`<option${g.purpose===p?' selected':''}>${p}</option>`).join('')}
      </select></td>
      <td><input type="number" value="${escapeHtml(g.nights)}"
        oninput="purposeGuests[${i}].nights=this.value"
        onblur="purposeKpiUpdate();debounceSavePurpose()"
        style="width:42px;"/></td>
      <td><div style="display:flex;gap:3px;align-items:center;">
        <input value="${escapeHtml(g.nat)}"
          oninput="purposeGuests[${i}].nat=this.value;purposeGuests[${i}]._natFromXML=false;purposeGuests[${i}]._natFromAI=false;purposeGuests[${i}]._natUserEdited=true;"
          onblur="gmOnEdit(purposeGuests[${i}].name,'nat',this.value);debounceSavePurpose()"
          title="${g._natFromXML ? 'Nationality — loaded from Vicas/Inhouse XML' : 'Nationality'}"
          style="width:86px;${g._natFromXML ? 'border-color:var(--mint);' : (g._fromMemory?'border-color:var(--sky);':'')}"/>
        <button class="icon-btn ai-btn" onclick="aiOneGuest(${i},'purpose')" title="AI">✦</button>
      </div></td>
      <td><input value="${escapeHtml(g.email)}"
        oninput="purposeGuests[${i}].email=this.value"
        onblur="gmOnEdit(purposeGuests[${i}].name,'email',this.value);debounceSavePurpose()"
        style="width:138px;${g._fromMemory?'border-color:var(--sky);':''}"/></td>
      <td><div style="display:flex;align-items:center;gap:5px;">
        <input value="${escapeHtml(g.source)}"
          oninput="purposeGuests[${i}].source=this.value;_updateSrcBadge('src-badge-p-${i}',this.value)"
          onblur="debounceSavePurpose()"
          title="Free text — categorised automatically as Walk-in / ALL App / OTA / Corporate / Other"
          style="width:82px;"/>
        <span class="src-badge ${srcCat}" id="src-badge-p-${i}">${SOURCE_CATEGORIES[srcCat].label}</span>
      </div></td>
      <td>
        <input value="${escapeHtml(origin)}"
          oninput="purposeGuests[${i}].originOfTravel=this.value"
          onblur="gmOnEdit(purposeGuests[${i}].name,'originOfTravel',this.value);debounceSavePurpose()"
          placeholder="—"
          title="Origin of Travel — loaded from Vicas/Inhouse XML"
          style="width:96px;${originStyle}"/>
      </td>
      <td><input value="${escapeHtml(g.remarks)}"
        oninput="purposeGuests[${i}].remarks=this.value"
        onblur="debounceSavePurpose()"
        style="width:86px;"/></td>
      <td><button class="icon-btn" onclick="purposeRemoveGuest(${i})">✕</button></td>
    </tr>`;
  }).join('');
  purposeKpiUpdate();
}

function purposeFilter(f, el) {
  purposeFilter_ = f;
  document.querySelectorAll('[data-pf]').forEach(c => c.classList.remove('on'));
  el.classList.add('on');
  purposeRender();
}

// ── Source-category filter (Walk-in / ALL App / OTA / Corporate / Other) ──
// Each chip already carries its category's color class in the HTML — this
// only needs to toggle which one is "on", same pattern as purposeFilter().
function purposeFilterSrc(f, el) {
  purposeSrcFilter_ = f;
  document.querySelectorAll('[data-psf]').forEach(c => c.classList.remove('on'));
  el.classList.add('on');
  purposeRender();
}

// ── Missing-origin quick filter — jump straight to guests still needing
// an Origin of Travel entered manually, instead of scanning row by row ──
function purposeToggleMissingOrigin(el) {
  purposeOriginFilter_ = purposeOriginFilter_ === 'missing' ? 'all' : 'missing';
  el.classList.toggle('on', purposeOriginFilter_ === 'missing');
  purposeRender();
}

// ── Import Emails — paste the "Confirmation_Number / Name / Email" block
// produced by the Neorcha email-scraper script and update matching guests'
// email + name by Confirmation Number. Neorcha is treated as the source of
// truth for these two fields — this ALWAYS overwrites whatever's currently
// there (including anything Guest Memory auto-filled), so re-pasting a
// fresh scrape always wins. ──
function openImportEmailsModal() {
  document.getElementById('importEmailsModal')?.classList.add('open');
  const input = document.getElementById('importEmailsInput');
  if (input) input.value = '';
  const result = document.getElementById('importEmailsResult');
  if (result) result.style.display = 'none';
  setTimeout(() => input && input.focus(), 80);
}

function closeImportEmailsModal() {
  document.getElementById('importEmailsModal')?.classList.remove('open');
}

function _normConf(s) {
  return String(s || '').trim().replace(/[^a-z0-9]/gi, '').toUpperCase();
}

function processImportEmails() {
  const raw = (document.getElementById('importEmailsInput')?.value || '').trim();
  const resultBox = document.getElementById('importEmailsResult');
  if (!raw) { showToast('Paste the list first.', 'err'); return; }

  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const emailByConf = {};
  const nameByConf  = {};
  let parsedRows = 0;
  for (const line of lines) {
    const cells = line.includes('\t') ? line.split('\t') : line.split(',');
    if (cells.length < 2) continue;
    const conf  = (cells[0] || '').trim();
    const email = (cells[cells.length - 1] || '').trim();
    // 3-column rows (Conf / Name / Email) also carry a name in the middle —
    // the scraper always emits this shape, but stay tolerant of 2-column
    // (Conf / Email) pastes too.
    const name  = cells.length >= 3 ? cells.slice(1, -1).join(' ').trim() : '';
    if (!conf || /^confirmation/i.test(conf)) continue; // skip header row
    if (!email || !email.includes('@') || /no email on file/i.test(email) || /^no@email\.com$/i.test(email)) continue;
    emailByConf[_normConf(conf)] = email;
    if (name) nameByConf[_normConf(conf)] = name;
    parsedRows++;
  }

  if (!parsedRows) {
    if (resultBox) {
      resultBox.style.display = 'block';
      resultBox.textContent = "Couldn't find any Confirmation Number → Email rows in that paste. Make sure it's the TSV block the scraper script prints (or copies to your clipboard).";
    }
    return;
  }

  let updated = 0, notInList = 0, namesUpdated = 0, emailsUpdated = 0;
  purposeGuests.forEach(g => {
    const key   = _normConf(g.conf);
    const email = key ? emailByConf[key] : null;
    if (!email) { notInList++; return; }

    // Neorcha is the source of truth for these two fields — always overwrite,
    // even if Guest Memory (or anything else) already guessed a value in.
    const name = nameByConf[key];
    if (name && g.name !== name) {
      g.name = name;
      namesUpdated++;
    }
    if (g.email !== email) {
      g.email = email;
      gmOnEdit(g.name, 'email', email);
      emailsUpdated++;
    }
    updated++;
  });

  purposeRender();
  savePurpose(purposeGuests);
  addPurposeLog('Emails', `Imported ${parsedRows} pasted rows — ${updated} guests matched, ${emailsUpdated} email(s) updated, ${namesUpdated} name(s) updated, ${notInList} no match`);
  showToast(`Updated ${emailsUpdated} email${emailsUpdated === 1 ? '' : 's'}${namesUpdated ? ` · ${namesUpdated} name${namesUpdated === 1 ? '' : 's'}` : ''} ✓`, updated ? 'ok' : 'info');

  if (resultBox) {
    resultBox.style.display = 'block';
    resultBox.innerHTML = `✅ Updated <strong>${emailsUpdated}</strong> email${emailsUpdated === 1 ? '' : 's'}${namesUpdated ? ` · <strong>${namesUpdated}</strong> name${namesUpdated === 1 ? '' : 's'}` : ''} · ${updated} guest${updated === 1 ? '' : 's'} matched · ${notInList} guest${notInList === 1 ? '' : 's'} with no match in the pasted list.`;
  }
}

// ── Randomize Purpose — one click, exact split (not a coin-flip average) ──
// Ask for a % Leisure, then shuffle the guest list and assign exactly that
// share to Leisure and the rest to Business — e.g. 80 → 80% Leisure guests,
// 20% Business, no matter how small the list is.
function purposeRandomizeSplit() {
  if (!purposeGuests.length) { showToast('No guests loaded', 'err'); return; }
  const input = prompt('Percent Leisure (0-100) — the rest becomes Business:', '80');
  if (input === null) return;
  const pct = Math.max(0, Math.min(100, parseInt(input, 10) || 0));

  // Fisher-Yates shuffle a list of indices, then assign the first N to Leisure
  const idx = purposeGuests.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const leisureCount = Math.round(purposeGuests.length * pct / 100);
  idx.forEach((guestIdx, pos) => {
    purposeGuests[guestIdx].purpose = pos < leisureCount ? 'Leisure' : 'Business';
  });

  purposeKpiUpdate();
  purposeRender();
  savePurpose(purposeGuests);
  addPurposeLog('Purpose', `Randomized — ${pct}% Leisure / ${100 - pct}% Business across ${purposeGuests.length} guests`);
  showToast(`🎲 ${leisureCount} Leisure · ${purposeGuests.length - leisureCount} Business`, 'ok');
}

function syncFromArrivals() {
  if (!arrGuests.length) { alert('No arrivals loaded. Go to Arrivals tab first.'); return; }
  purposeGuests = arrGuests.map(g => ({...g}));
  _applyOriginToPurpose();
  purposeRender(); savePurpose(purposeGuests);
  showToast('Synced from Arrivals ✓');
  addPurposeLog('Synced', `${purposeGuests.length} guests synced from Arrivals`);
}

function clearPurpose() {
  purposeGuests = []; purposeRender(); savePurpose([]);
  addPurposeLog('Cleared', 'All guests cleared');
}

function loadPurpose() {
  const raw = document.getElementById('purposeInput').value.trim();
  if (!raw) { alert('Please paste data first.'); return; }
  const lines = raw.split('\n').filter(l => l.trim()); if (lines.length < 2) return;
  // Auto-detect delimiter — Opera's own paste export is tab-delimited, but a
  // report saved/re-copied as CSV (e.g. wa21) comes through comma+quoted —
  // handle both instead of assuming tabs and silently mis-parsing everything
  // into one giant column.
  const delim     = lines[0].includes('\t') ? '\t' : ',';
  const splitLine = delim === '\t' ? (l => l.split('\t')) : parseCSVLine;
  const hdrs  = splitLine(lines[0]).map(h => h.replace(/"/g,'').trim().toUpperCase());
  const ci    = n => hdrs.findIndex(h => h.includes(n));
  const rI=ci('ROOM'),nI=ci('NAME'),niI=ci('NIGHT'),cI=hdrs.findIndex(h=>h.includes('CONFIRM')),taI=ci('TRAVEL'),coI=ci('COMPANY'),srcI=ci('SOURCE'),
        eI=hdrs.findIndex(h=>h.includes('EMAIL') || h.includes('E-MAIL'));
  if (rI < 0 || nI < 0) { alert('Could not find Room/Name.'); return; }
  const guests = [];
  for (let i = 1; i < lines.length; i++) {
    const p    = splitLine(lines[i]);
    const room = (p[rI]||'').replace(/"/g,'').trim();
    const rn   = (p[nI]||'').replace(/"/g,'').trim();
    if (!room || !rn) continue;
    guests.push({ room, conf:cI>=0?(p[cI]||'').replace(/"/g,'').trim():'', name:cleanName(rn), purpose:'Business',
      nights:niI>=0?parseInt(p[niI])||1:1, nat:'', email: (eI>=0 && (p[eI]||'').trim()) ? (p[eI]||'').replace(/"/g,'').trim() : 'No@email.com',
      source:cleanSource(taI>=0?(p[taI]||'').replace(/"/g,'').trim():'', coI>=0?(p[coI]||'').replace(/"/g,'').trim():'', srcI>=0?(p[srcI]||'').replace(/"/g,'').trim():''),
      originOfTravel: '',
      remarks:'' });
  }
  purposeGuests = guests;
  _applyOriginToPurpose();   // re-apply any already-loaded XML instantly — don't discard it
  purposeRender();
  // Real XML data (Vicas/Inhouse) first — it's ground truth, not a guess.
  // AI guesser only fills whoever wasn't matched; memory tops that off.
  setTimeout(() => {
    runAINat_purpose().then(() => {
      if (typeof gmAutoFill === 'function') gmAutoFill(purposeGuests);
      purposeRender();
      _promptForOriginXml();   // ask for report #2 (the nationality XML) if not loaded yet
    });
  }, 300);
  addPurposeLog('Loaded', `${guests.length} guests loaded from paste`);
}

async function runAINat_purpose() {
  setSpinner('aiSpinPurpose', true);
  purposeGuests.forEach(g => {
    if (!g.nat) {
      const guessed = guessNat(g.name);
      if (guessed) { g.nat = guessed; g._natFromAI = true; }
    }
  });
  purposeRender();
  setSpinner('aiSpinPurpose', false);
  savePurpose(purposeGuests);
  addPurposeLog('AI Nat', `Nationality guessed for ${purposeGuests.filter(g=>g.nat).length} guests`);
}

function exportPurpose() {
  const wb   = XLSX.utils.book_new();
  const data = [['Room','Confirmation No.','Name','Purpose of Stay','Night of Stay','Nationality','Origin of Travel','Email','Booking Source','Remarks']];
  purposeGuests.forEach(g => data.push([g.room,g.conf,g.name,g.purpose,g.nights,g.nat,g.originOfTravel||'',g.email,g.source,g.remarks]));
  const ws = XLSX.utils.aoa_to_sheet(data);
  const hS = {font:{bold:true,color:{rgb:'FFFFFF'},name:'Arial',sz:10},fill:{fgColor:{rgb:'1F4E79'},patternType:'solid'},alignment:{horizontal:'center'},border:{top:{style:'thin'},bottom:{style:'thin'},left:{style:'thin'},right:{style:'thin'}}};
  const bS = {font:{name:'Arial',sz:10},fill:{fgColor:{rgb:'FFFFFF'},patternType:'solid'},border:{top:{style:'thin'},bottom:{style:'thin'},left:{style:'thin'},right:{style:'thin'}}};
  const lS = {font:{name:'Arial',sz:10},fill:{fgColor:{rgb:'E2EFDA'},patternType:'solid'},border:{top:{style:'thin'},bottom:{style:'thin'},left:{style:'thin'},right:{style:'thin'}}};
  ['A','B','C','D','E','F','G','H','I','J'].forEach(c => { if (ws[c+'1']) ws[c+'1'].s = hS; });
  purposeGuests.forEach((g, ri) => {
    const rn = ri + 2; const s = g.purpose === 'Leisure' ? lS : bS;
    ['A','B','C','D','E','F','G','H','I','J'].forEach(c => { const cell = ws[c+rn]; if (cell) cell.s = s; });
  });
  ws['!cols'] = [8,16,28,14,8,14,18,26,20,18].map(w => ({wch:w}));
  XLSX.utils.book_append_sheet(wb, ws, 'Purpose of Stay');
  XLSX.writeFile(wb, (_purposeTitle||'Purpose').replace(/\s+/g,'_')+'.xlsx', {bookSST:false,type:'binary',cellStyles:true});
  addPurposeLog('Exported', `${purposeGuests.length} guests exported`);
}

// ── ADD GUEST MODAL ───────────────────────────────────────
function openAddGuest(target = 'arrivals') {
  guestModalTarget = target;
  document.getElementById('guestModalTitle').textContent = 'Add Guest — ' + (target==='arrivals'?'Arrivals':'Purpose of Stay');
  ['mg-room','mg-conf','mg-name','mg-email','mg-source','mg-remarks','mg-nat'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('mg-nights').value  = 1;
  document.getElementById('mg-purpose').value = 'Business';
  document.getElementById('guestModal').classList.add('open');
}
function closeModal() { document.getElementById('guestModal').classList.remove('open'); }
function aiGuessModal() {
  const name = document.getElementById('mg-name').value.toUpperCase();
  if (!name) return;
  const nat = guessNat(name);
  if (nat) document.getElementById('mg-nat').value = nat;
}
function saveGuest() {
  const g = {
    room:    document.getElementById('mg-room').value,
    conf:    document.getElementById('mg-conf').value,
    name:    document.getElementById('mg-name').value.toUpperCase(),
    purpose: document.getElementById('mg-purpose').value,
    nights:  Number(document.getElementById('mg-nights').value) || 1,
    nat:     document.getElementById('mg-nat').value,
    email:   document.getElementById('mg-email').value || 'No@email.com',
    source:  document.getElementById('mg-source').value,
    remarks: document.getElementById('mg-remarks').value,
  };
  if (!g.name) return;
  if (guestModalTarget === 'arrivals') {
    arrGuests.push(g); arrRender(); saveArrivals(arrGuests);
    addArrLog('Added', `${g.name} — Room ${g.room}`);
  } else {
    purposeGuests.push(g); purposeRender(); savePurpose(purposeGuests);
    addPurposeLog('Added', `${g.name} — Room ${g.room}`);
  }
  closeModal();
}

function loadOperaFile(input, target) {
  const file = input.files[0]; if (!file) return;
  const ext  = file.name.split('.').pop().toLowerCase();
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      let rows = [];
      if (ext === 'csv') {
        const text = new TextDecoder('utf-8').decode(new Uint8Array(e.target.result));
        rows = text.split('\n').filter(l => l.trim()).map(parseCSVLine);
      } else {
        const wb = XLSX.read(e.target.result, {type:'array'});
        const ws = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
      }
      if (rows.length < 2) { alert('File empty'); return; }
      let hdrRow = 0;
      for (let i = 0; i < Math.min(5, rows.length); i++) {
        const r = rows[i].map(c => String(c).toLowerCase());
        if (r.some(c => c.includes('room') || c.includes('name'))) { hdrRow = i; break; }
      }
      const hdrs = rows[hdrRow].map(c => String(c).replace(/"/g,'').trim().toUpperCase());
      const ci   = name => hdrs.findIndex(h => h === name || h.includes(name));
      const rI=ci('ROOM'), nI=ci('NAME'), cI=hdrs.findIndex(h=>h.includes('CONFIRM')), niI=ci('NIGHT'),
            taI=hdrs.findIndex(h=>h.includes('TRAVEL')), coI=ci('COMPANY'), srcI=ci('SOURCE'),
            eI=hdrs.findIndex(h=>h.includes('EMAIL') || h.includes('E-MAIL'));
      if (rI < 0 || nI < 0) { alert('Cannot find Room/Name.\nHeaders: ' + hdrs.slice(0,10).join(', ')); return; }
      const guests = [];
      for (let i = hdrRow + 1; i < rows.length; i++) {
        const r    = rows[i];
        const room = String(r[rI]||'').replace(/"/g,'').trim();
        const rn   = String(r[nI]||'').replace(/"/g,'').trim();
        if (!room || !rn) continue;
        guests.push({
          room, conf: cI>=0?String(r[cI]||'').replace(/"/g,'').trim():'',
          name:   cleanName(rn),
          purpose:'Business',
          nights: niI>=0?parseInt(r[niI])||1:1,
          nat:    '', email: (eI>=0 && String(r[eI]||'').trim()) ? String(r[eI]).replace(/"/g,'').trim() : 'No@email.com',
          source: cleanSource(taI>=0?String(r[taI]||'').trim():'', coI>=0?String(r[coI]||'').trim():'', srcI>=0?String(r[srcI]||'').trim():''),
          originOfTravel: '',
          remarks:'',
        });
      }
      if (!guests.length) { alert('No valid guest rows found.'); return; }
      // AI guesser first, memory on top — memory always wins
      if (target === 'arr') {
        arrGuests = guests;
        _applyOriginToPurpose();   // re-apply any already-loaded XML instantly — don't discard it
        arrRender();
        setTimeout(() => {
          runAINat_arr().then(() => {
            if (typeof gmAutoFill === 'function') gmAutoFill(arrGuests);
            arrRender();
          });
        }, 400);
      } else {
        purposeGuests = guests;
        _applyOriginToPurpose();   // re-apply any already-loaded XML instantly — don't discard it
        purposeRender();
        // Real XML data (Vicas/Inhouse) first — it's ground truth, not a guess.
        // AI guesser only fills whoever wasn't matched; memory tops that off.
        setTimeout(() => {
          runAINat_purpose().then(() => {
            if (typeof gmAutoFill === 'function') gmAutoFill(purposeGuests);
            purposeRender();
            _promptForOriginXml();   // ask for report #2 (the nationality XML) if not loaded yet
          });
        }, 400);
      }
    } catch (err) { console.error(err); alert('Error: ' + err.message); }
  };
  reader.readAsArrayBuffer(file);
}
