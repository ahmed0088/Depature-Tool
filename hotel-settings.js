// ═══════════════════════════════════════════════════════════
//  hotel-settings.js — Tourism Dirham settings for this hotel
//
//  Different hotels post Tourism Dirham under a different Opera
//  transaction / tax code and pay a different rate (by star rating:
//  AED 7 / 10 / 15 / 20). Nothing in the DTCM tools is hard-coded to
//  one hotel any more: they all read HotelCfg at the moment they run.
//
//  Saved in this browser right away (so it works offline and on load)
//  and shared with the team through Firebase (settings/td).
// ═══════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  const KEY = 'hotel_td_settings_v1';
  const DEFAULTS = {
    tdCodes: '7510',          // Opera code(s) for Tourism Dirham, comma-separated
    tdDesc: 'Tourism Dirham', // Opera transaction description, used when the code column is missing
    tdRate: 10,               // AED per room per night (5★ 20 · 4★ 15 · 3★ 10 · 1-2★ / apartments 7)
    tdCap: 30,                // TD stops after this many consecutive nights
    auditTime: '04:20'        // night audit finishes around this time; arrivals before it belong to the previous night
  };

  function load() {
    try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}')); }
    catch (_) { return Object.assign({}, DEFAULTS); }
  }
  let cfg = load();

  const api = {
    DEFAULTS,
    get() { return cfg; },
    codes() { return String(cfg.tdCodes || '').split(/[,\s;]+/).map(s => s.trim()).filter(Boolean); },
    isTdCode(code) { const c = String(code || '').trim(); return !!c && api.codes().includes(c); },
    descRe() {
      const d = String(cfg.tdDesc || '').trim();
      return d ? new RegExp(d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*'), 'i') : /tourism\s*dirham/i;
    },
    codeLabel() { return api.codes().join(' / ') || '—'; },
    rate() { return +cfg.tdRate > 0 ? +cfg.tdRate : DEFAULTS.tdRate; },
    cap() { return +cfg.tdCap > 0 ? Math.round(+cfg.tdCap) : DEFAULTS.tdCap; },
    /** minutes after midnight the night audit finishes */
    auditMinutes() {
      const m = String(cfg.auditTime || '').match(/^(\d{1,2}):(\d{2})$/);
      return m ? (+m[1]) * 60 + (+m[2]) : 260;
    },
    set(patch, share = true) {
      cfg = Object.assign({}, cfg, patch);
      try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (_) {}
      if (share && typeof fbSet === 'function') fbSet('settings/td', cfg);
    },
    /** pick up a colleague's change */
    listen() {
      if (typeof fbListen !== 'function') return;
      fbListen('settings/td', v => {
        if (!v || typeof v !== 'object') return;
        cfg = Object.assign({}, DEFAULTS, v);
        try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (_) {}
        if (typeof hsRenderForm === 'function') hsRenderForm();
      });
    }
  };
  global.HotelCfg = api;
})(window);

// ── Settings form (DTCM Recon page) ───────────────────────
function hsRenderForm() {
  const c = HotelCfg.get();
  const set = (id, v) => { const el = document.getElementById(id); if (el && document.activeElement !== el) el.value = v; };
  set('hsCodes', c.tdCodes); set('hsDesc', c.tdDesc); set('hsRate', c.tdRate); set('hsCap', c.tdCap); set('hsAudit', c.auditTime);
  const sum = document.getElementById('hsSummary');
  if (sum) sum.textContent = `Code ${HotelCfg.codeLabel()} · AED ${HotelCfg.rate()} per night · cap ${HotelCfg.cap()} nights · audit ${c.auditTime}`;
}

function hsSave() {
  const v = id => (document.getElementById(id)?.value || '').trim();
  const codes = v('hsCodes'), rate = parseFloat(v('hsRate')), cap = parseInt(v('hsCap'), 10), audit = v('hsAudit');
  if (!codes) { showToast('Enter at least one Tourism Dirham code', 'err'); return; }
  if (!(rate > 0)) { showToast('The rate must be a number above 0', 'err'); return; }
  if (!(cap > 0)) { showToast('The night cap must be a number above 0', 'err'); return; }
  if (!/^\d{1,2}:\d{2}$/.test(audit)) { showToast('Night audit time looks like 04:20', 'err'); return; }
  HotelCfg.set({ tdCodes: codes, tdDesc: v('hsDesc') || 'Tourism Dirham', tdRate: rate, tdCap: cap, auditTime: audit });
  hsRenderForm();
  if (typeof logActivity === 'function') logActivity('td_settings', `Code ${HotelCfg.codeLabel()} · AED ${HotelCfg.rate()} · cap ${HotelCfg.cap()} · audit ${audit}`);
  showToast('Hotel TD settings saved — run Analyze again to use them', 'ok');
}

function hsPreset(rate) {
  const el = document.getElementById('hsRate');
  if (el) el.value = rate;
}

document.addEventListener('DOMContentLoaded', () => { hsRenderForm(); setTimeout(() => HotelCfg.listen(), 1500); });
