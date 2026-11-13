// Personal IN-Gauge controls. Financial checks and target authorization stay in the audit engine.
(function (W) {
  'use strict';
  const SCHEMA = 1;
  const DEFAULTS = Object.freeze({ monthly: true, manual: true, automatic: true, find: true, automation: true,
    add: true, edit: true, approve: true, deny: true, remove: true, graphs: true, breakdown: true,
    history: true, hints: true, compact: false, autoOpenRun: true, landing: 'monthly' });
  const KEYS = Object.freeze(Object.keys(DEFAULTS));
  const BOOL_KEYS = KEYS.filter(k => k !== 'landing');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let state = null, trigger = null, error = '';
  const doc = () => W.document;
  const overlay = () => doc()?.getElementById('igSettingsOverlay');
  function identity(S = {}) {
    const b = S.binding || {};
    return S.targetKey || JSON.stringify([b.portalUrl || '', b.tenantId || '', b.propertyId || '', b.departmentId || '']);
  }
  function key(S = {}) {
    let uid = '', space = '';
    try { uid = String(W.firebase?.auth?.().currentUser?.uid || ''); } catch (_) {}
    try { space = typeof HOTEL_ID !== 'undefined' ? String(HOTEL_ID || '') : ''; } catch (_) {}
    return 'ho_ingauge_settings_v1:' + [uid || space || 'local', space || 'local', identity(S)].map(encodeURIComponent).join(':');
  }
  function landingOptions(prefs) {
    return [['monthly', 'Monthly totals'], ['audit', 'Review & fix'], ['edit', 'Find a sale']].filter(([value]) => value === 'audit' || value === 'monthly' && prefs.monthly || value === 'edit' && prefs.find);
  }
  function normalize(value) {
    const next = { ...DEFAULTS };
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const k of BOOL_KEYS) if (typeof value[k] === 'boolean') next[k] = value[k];
      if (['monthly', 'audit', 'edit'].includes(value.landing)) next.landing = value.landing;
    }
    if (!next.manual && !next.automatic) { next.manual = true; next.automatic = true; }
    if (!landingOptions(next).some(([v]) => v === next.landing)) next.landing = 'audit';
    return next;
  }
  function get(S = {}) {
    try {
      const value = JSON.parse(W.localStorage.getItem(key(S)) || 'null');
      return normalize(value?.schema === SCHEMA ? value.prefs : null);
    } catch (_) { return { ...DEFAULTS }; }
  }
  function set(S = {}, patch = {}) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw Error('Choose valid settings.');
    for (const k of Object.keys(patch)) {
      if (!KEYS.includes(k)) throw Error('Unknown IN-Gauge setting.');
      if (k === 'landing' ? !['monthly', 'audit', 'edit'].includes(patch[k]) : typeof patch[k] !== 'boolean') throw Error('Choose a valid value for this setting.');
    }
    const merged = { ...get(S), ...patch };
    if (!merged.manual && !merged.automatic) throw Error('Keep Manual upsells or Automatic packages switched on.');
    const next = normalize(merged);
    try { W.localStorage.setItem(key(S), JSON.stringify({ schema: SCHEMA, prefs: next })); }
    catch (_) { throw Error('Settings could not be saved on this device. Allow browser storage and try again.'); }
    return next;
  }
  function reset(S = {}) { return set(S, { ...DEFAULTS }); }
  const GROUPS = [
    ['Tools', [
      ['monthly', 'Monthly totals', 'Compare Opera postings with approved and pending sales.'],
      ['manual', 'Manual upsells', 'Check Journal sales and seller requests.'],
      ['automatic', 'Automatic packages', 'Check imported packages and automatic seller credit.'],
      ['find', 'Find a sale', 'Search and review existing packages.'],
      ['automation', 'Run reviewed changes', 'Apply only the changes you select and confirm.']
    ]],
    ['Allowed changes', [
      ['add', 'Add missing sales', 'Prepare new manual upsells for review.'],
      ['edit', 'Edit packages', 'Change a reviewed package, seller, dates or charge.'],
      ['approve', 'Approve pending requests', 'Review and approve existing seller requests.'],
      ['deny', 'Deny requests', 'Review a reason before denying a request.'],
      ['remove', 'Remove records', 'Review a reason before removing an eligible record.']
    ]],
    ['Display', [
      ['graphs', 'Revenue graphs', 'Show monthly and daily comparison charts.'],
      ['breakdown', 'Product breakdown', 'Show totals grouped by package type.'],
      ['history', 'Change history', 'Show saved runs and their verified outcomes.'],
      ['hints', 'Help and explanations', 'Show extra guidance beside controls.'],
      ['compact', 'Compact cards', 'Use less space in the review and search lists.'],
      ['autoOpenRun', 'Open run progress automatically', 'Open the progress window when a cloud run starts.']
    ]]
  ];
  function locked(S) {
    return !!(S?.busy || S?.uploading || S?.switching || W.InGaugeWorkspace?.settingsLocked?.());
  }
  function focusable(root) {
    return [...root.querySelectorAll('button, input, select, summary, [tabindex="0"]')].filter(node => !node.disabled && !node.hidden && node.getClientRects().length);
  }
  function paint() {
    const root = overlay(); if (!root || root.hidden || !state) return;
    const prefs = get(state), disabled = locked(state), body = root.querySelector('.iga-settings-body'), top = body?.scrollTop || 0;
    const focused = root.contains(doc().activeElement) ? doc().activeElement.id : '';
    const expanded = new Set([...root.querySelectorAll('details[open]')].map(node => node.dataset.igSettingGroup));
    const firstPaint = !root.querySelector('.iga-settings-panel');
    const row = ([name, title, description]) => `<label class="iga-settings-row" for="igSetting-${name}"><span class="iga-settings-copy"><b>${esc(title)}</b><small>${esc(description)}</small></span><input id="igSetting-${name}" type="checkbox" role="switch" data-ig-setting="${name}" ${prefs[name] ? 'checked' : ''} ${disabled ? 'disabled' : ''}></label>`;
    root.innerHTML = `<section class="iga-editor iga-settings-panel" role="dialog" aria-modal="true" aria-labelledby="igSettingsTitle" aria-describedby="igSettingsContext"><header class="iga-settings-header"><div><span class="iga-eyebrow">PERSONAL PREFERENCES</span><h2 id="igSettingsTitle">IN-Gauge settings</h2><p class="iga-settings-context" id="igSettingsContext">${esc(state.binding?.property || 'Choose a hotel to keep its settings separate')} · saved on this device</p></div><button type="button" id="igSettingsClose" data-ig-settings-close aria-label="Close settings">×</button></header><div class="iga-settings-body"><section class="iga-settings-group"><h3>Hotel connection</h3><p class="iga-settings-context">${esc(state.binding?.property || 'No hotel selected')} · ${esc(state.binding?.department || 'Choose the hotel and department to audit.')}</p><button type="button" class="btn" id="igSettingsHotel" data-ig-settings-hotel ${disabled ? 'disabled' : ''}>${state.binding ? 'Change hotel or connection' : 'Choose IN-Gauge hotel'}</button></section><p class="iga-settings-note">Hotel verification, seller review and amount checks always stay on.</p><p class="iga-settings-error" id="igSettingsError" role="alert" ${error ? '' : 'hidden'}>${esc(error)}</p>${disabled ? '<p class="iga-settings-note">Settings are locked while a run, report upload or hotel change is in progress.</p>' : ''}${GROUPS.map(([title, rows], i) => i === 0 ? `<section class="iga-settings-group"><h3>${title}</h3>${rows.map(row).join('')}</section>` : `<details class="iga-settings-group" data-ig-setting-group="${i}" ${expanded.has(String(i)) ? 'open' : ''}><summary>${title}</summary><div class="iga-settings-group-body">${rows.map(row).join('')}</div></details>`).join('')}<section class="iga-settings-group"><h3>Start page</h3><p class="iga-settings-context" id="igSettingLandingLabel">Open this page when the tool starts</p><div class="iga-settings-landing-options" role="radiogroup" aria-labelledby="igSettingLandingLabel">${landingOptions(prefs).map(([value, label]) => `<label for="igSetting-landing-${value}"><input id="igSetting-landing-${value}" type="radio" name="igSettingsLanding" data-ig-setting="landing" value="${value}" ${prefs.landing === value ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span>${label}</span></label>`).join('')}</div></section></div><footer class="iga-settings-footer"><button type="button" class="btn" id="igSettingsReset" data-ig-settings-reset ${disabled ? 'disabled' : ''}>Reset defaults</button><button type="button" class="btn gold" id="igSettingsDone" data-ig-settings-close>Done</button></footer></section>`;
    const nextBody = root.querySelector('.iga-settings-body'); if (nextBody) nextBody.scrollTop = top;
    if (focused && doc().getElementById(focused)) doc().getElementById(focused).focus({ preventScroll: true });
    else if (firstPaint) doc().getElementById('igSettingsClose')?.focus({ preventScroll: true });
  }
  function ensure() {
    let root = overlay(); if (root) return root;
    root = doc().createElement('div'); root.id = 'igSettingsOverlay'; root.className = 'iga-overlay iga-settings-overlay'; root.hidden = true;
    root.addEventListener('click', async event => {
      if (event.target === root || event.target.closest('[data-ig-settings-close]')) { close(); return; }
      if (event.target.closest('[data-ig-settings-hotel]')) {
        try { if (typeof W.InGaugeWorkspace?.openHotelSettings !== 'function') throw Error('Refresh the app to load hotel settings.'); W.InGaugeWorkspace.openHotelSettings(); }
        catch (cause) { error = cause.message || 'Hotel settings could not be opened.'; paint(); }
        return;
      }
      if (!event.target.closest('[data-ig-settings-reset]')) return;
      try {
        if (typeof W.InGaugeWorkspace?.updateSettings !== 'function') throw Error('Refresh the app to load settings controls.');
        await W.InGaugeWorkspace.updateSettings({ ...DEFAULTS }); error = '';
      } catch (cause) { error = cause.message || 'Settings could not be updated.'; }
      paint();
    });
    root.addEventListener('change', async event => {
      const name = event.target.dataset.igSetting; if (!name) return;
      try {
        if (typeof W.InGaugeWorkspace?.updateSettings !== 'function') throw Error('Refresh the app to load settings controls.');
        await W.InGaugeWorkspace.updateSettings({ [name]: name === 'landing' ? event.target.value : event.target.checked }); error = '';
      } catch (cause) { error = cause.message || 'Settings could not be updated.'; }
      paint();
    });
    root.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key !== 'Tab') return;
      const items = focusable(root), first = items[0], last = items.at(-1);
      if (!first) return;
      if (event.shiftKey && (doc().activeElement === first || !root.contains(doc().activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (doc().activeElement === last || !root.contains(doc().activeElement))) { event.preventDefault(); first.focus(); }
    });
    doc().body.appendChild(root); return root;
  }
  function open(S, source) {
    state = S; trigger = source || doc().activeElement; error = '';
    const root = ensure(); root.hidden = false; trigger?.setAttribute?.('aria-expanded', 'true'); paint(); doc().getElementById('igSettingsClose')?.focus({ preventScroll: true });
  }
  function close() {
    const root = overlay(); if (root) root.hidden = true;
    trigger?.setAttribute?.('aria-expanded', 'false'); if (trigger?.isConnected) trigger.focus({ preventScroll: true }); trigger = null;
  }
  function sync(S) { state = S; paint(); }
  W.InGaugeSettings = { SCHEMA, DEFAULTS, KEYS, get, key, set, reset, open, close, sync };
})(typeof window !== 'undefined' ? window : globalThis);
