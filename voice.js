// ═══════════════════════════════════════════════════════════
//  voice.js — speak instead of typing
//
//  "312 checked out" · "514 late check-out at 2" · "room 220 extending 2 nights"
//  "send towels to 418" · "what's left to check out" · "open departures" · "I'm away"
//
//  • Room commands are read by the SAME parser as the WhatsApp reader (hoWaBridge.parse) and
//    applied by hoWaBridge.handle(msg, 'voice'), so a spoken "312 CO" does exactly what the
//    same words in the HK group do — notes on the room, Undo toast (and Ctrl+Z), the log.
//    Nothing changes before you tap ✓ Do it on the confirm card.
//  • Questions and "open …" go to Ops Brain (brOpen + brAsk). "I'm away" / "I'm back" switch
//    the WhatsApp Away guard (hoWaGuard.set).
//  • Start it: 🎤 in the Ops Brain ask bar · hold the 🧠 button ~0.6 s · Ctrl+Shift+Space
//    (toggle) or hold Alt+V (push to talk) on a PC.
//  • Web Speech API (webkitSpeechRecognition — Chrome, Edge, Safari 14.5+). No support → nothing
//    of this shows. Speech is turned into text by Apple / Google servers, so it needs internet.
//  • Settings → Voice (own section, added to #hsBody; prefs in localStorage ho_voice_v1).
//  API: window.hoVoice = { start, stop, cancel, handleText(text, {dry}), supported, norm, classify }
//  Load after brain.js and wa-bridge.js.
// ═══════════════════════════════════════════════════════════
(function (W) {
'use strict';
const doc = document;
const SR = W.SpeechRecognition || W.webkitSpeechRecognition || null;
const supported = !!SR;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = id => doc.getElementById(id);
const mm = q => { try { return W.matchMedia(q).matches; } catch (_) { return false; } };
const isPhone = () => mm('(hover: none) and (pointer: coarse)') || W.innerWidth <= 768;
const reduced = () => mm('(prefers-reduced-motion: reduce)');
const toast = (m, t) => { try { if (typeof showToast === 'function') showToast(m, t || 'info'); } catch (_) {} };

// ── Settings (this device only) ─────────────────────────────
const LS = 'ho_voice_v1';
const LANGS = [['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['ar-AE', 'العربية']];
function cfg() {
  let c = {};
  try { c = JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (_) {}
  return {
    on: c.on !== false,
    lang: LANGS.some(l => l[0] === c.lang) ? c.lang : 'en-US',
    // spoken confirmations: on by default on a phone (hands busy), off on the desk PC (quiet office)
    speak: typeof c.speak === 'boolean' ? c.speak : isPhone(),
    hold: c.hold !== false,
  };
}
function setCfg(k, v) {
  let c = {};
  try { c = JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (_) {}
  c[k] = v;
  try { localStorage.setItem(LS, JSON.stringify(c)); } catch (_) {}
  paintAskMic(); renderSettings();
}

// ══ Understanding (pure) ═══════════════════════════════════
// Speech engines write numbers their own way: "three twelve", "3:12", "٣١٢". The WhatsApp parser
// expects what a colleague types ("312 CO"), so the transcript is tidied first, then parsed as-is.
const ONES = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const TEENS = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const NUMW = '(?:' + Object.keys(ONES).concat(Object.keys(TEENS), Object.keys(TENS), ['hundred']).join('|') + ')';
const NUM_SEQ = new RegExp('\\b' + NUMW + '(?:(?:[\\s-]+|\\s+and\\s+)' + NUMW + ')*\\b', 'gi');
const TIME_LEAD = /\b(?:at|till|until|til|by|around|about|before|after)\s*$/i;

/** "three twelve" → "312", "four oh eight" → "408", "five hundred fourteen" → "514", "at two thirty" → "at 2:30" */
function wordsToNum(m, before) {
  let w = m.toLowerCase().split(/[\s-]+/).filter(x => x && x !== 'and');
  while (w[0] === 'oh') w.shift();                      // "oh, 312 …" is a sigh, not a zero
  if (!w.length) return '';
  // pairs: "twenty two" → 22; otherwise every word is its own digit group ("three" "twelve" → 312)
  const groups = list => {
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const x = list[i];
      if (x in TENS) { const n = list[i + 1]; if (n in ONES && ONES[n] > 0) { out.push(TENS[x] + ONES[n]); i++; } else out.push(TENS[x]); }
      else if (x in TEENS) out.push(TEENS[x]);
      else if (x in ONES) out.push(ONES[x]);
    }
    return out;
  };
  const h = w.indexOf('hundred');
  if (h >= 0) {
    const a = groups(w.slice(0, h)), b = groups(w.slice(h + 1));
    const lead = a.length ? +a.join('') : 1;
    const rest = b.length ? b.reduce((s, n) => s + n, 0) : 0;
    return String(lead * 100 + rest);
  }
  const g = groups(w);
  // a time: "at two thirty" / "till eleven fifteen" → 2:30 / 11:15
  if (TIME_LEAD.test(before) && g.length === 2 && g[0] >= 1 && g[0] <= 12 && g[1] >= 10 && g[1] <= 59) return g[0] + ':' + String(g[1]).padStart(2, '0');
  return g.join('');
}

const AR_DIGITS = { '٠': 0, '١': 1, '٢': 2, '٣': 3, '٤': 4, '٥': 5, '٦': 6, '٧': 7, '٨': 8, '٩': 9, '۰': 0, '۱': 1, '۲': 2, '۳': 3, '۴': 4, '۵': 5, '۶': 6, '۷': 7, '۸': 8, '۹': 9 };
// a few front-office words in Arabic → the English the parser knows (longest first)
const AR_WORDS = [
  [/(?:ليت|لايت)\s*(?:تشيك|تشك|تشيك\s*)\s*(?:اوت|آوت|أوت)|خروج\s*متأخر/g, ' late checkout '],
  [/(?:تشيك|تشك)\s*(?:اوت|آوت|أوت)|طلعت?|خرجت?|غادرت?/g, ' checked out '],
  [/تمديد|يمدد|بيمدد|مدد/g, ' extend '],
  [/ليلتين/g, ' 2 nights '], [/ليال[يى]?|ليلة|ليله/g, ' nights '],
  [/الغرفة|غرفة|غرفه/g, ' room '], [/الساعة|الساعه/g, ' at '],
];

/** transcript → text the WhatsApp parser reads like a typed message */
function norm(raw) {
  let s = String(raw || '').replace(/[٠-٩۰-۹]/g, d => AR_DIGITS[d]);
  if (/[؀-ۿ]/.test(s)) AR_WORDS.forEach(([re, to]) => { s = s.replace(re, to); });
  s = s.replace(/[“”"]/g, '').replace(/\s+/g, ' ').trim();
  s = s.replace(/\b(\d{3,4})\s*(?:st|nd|rd|th)\b/gi, '$1');
  s = s.replace(/\b(till|until|til|to|on)\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/gi, '$1 $2');   // "extend till the 30th" → "till 30"
  s = s.replace(NUM_SEQ, (m, off, all) => wordsToNum(m, all.slice(0, off)));
  // "3:12 checked out", "room 3:12", "towels to 4:18": a room number heard as a clock time
  s = s.replace(/(^|\b(?:room|rooms|number|no\.?|to|for|in)\s+)(\d{1,2})[:.](\d{2})\b(?!\s*(?:[ap]\.?\s?m\b|o'?clock))/gi, (m, a, h, mi) => a + h + mi);
  s = s.replace(/\broom\s+(?:number|no\.?)\s+/gi, 'room ');
  s = s.replace(/\s*o'?\s?clock\b/gi, '');
  // spoken "room 220 extending 2 nights" is the agent extending it now, not papers still pending
  s = s.replace(/\bextend(?:ing|ed)?\s+(?:it\s+)?(?:by\s+|for\s+)?(\d{1,2})\s*(?:more\s+|extra\s+)?nights?\b/gi, 'ext $1N');
  s = s.replace(/^[,\s]+/, '').replace(/\s{2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').replace(/[.!?]+$/, '').trim();
  return s;
}

const GUARD_ON = /^(?:(?:i'?m|i am|am)\s+(?:going\s+)?(?:away|on\s+(?:a\s+|my\s+)?break|on\s+dnd)|going\s+(?:away|on\s+(?:a\s+|my\s+)?break)|away(?:\s+(?:guard|mode))?\s+on|(?:turn|switch)\s+on\s+(?:the\s+)?away(?:\s+(?:guard|mode))?|away)\b/i;
const GUARD_OFF = /^(?:(?:i'?m|i am)\s+back|back(?:\s+now)?|away(?:\s+(?:guard|mode))?\s+off|(?:turn|switch)\s+off\s+(?:the\s+)?away(?:\s+(?:guard|mode))?)\b/i;
const CANCEL = /^(?:cancel|never\s*mind|nevermind|stop|forget it|nothing)$/i;
// a question or a page to open: Ops Brain answers it, even when a room number is in it ("who is in 312")
const ASK = /^(?:what|what's|whats|who|who's|how|when|which|where|why|is|are|was|were|do|does|did|can|could|should|will|would|list|show|tell|give|open|go\s+to|goto|take\s+me|find|search|look\s+up|remind|plan|brief|write|any|how's|hey|ok|okay)\b/i;

function parseText(t) {
  try { const B = W.hoWaBridge; if (B && typeof B.parse === 'function') return B.parse(t); } catch (_) {}
  try { if (typeof W.hoWaParse === 'function') return W.hoWaParse(t); } catch (_) {}
  return { kind: 'none', actions: [] };
}
const ACTS = /^(?:co|lco|ext|extending|maybe|fin|note)$/;

/** what to do with one transcript → {kind: 'guard'|'cancel'|'room'|'ask'|'empty', text, said, actions?, on?} */
function classify(raw) {
  const said = String(raw || '').trim();
  const text = norm(said);
  if (!text) return { kind: 'empty', text, said };
  const bare = text.replace(/^(?:please|pls|hey brain|ops brain|brain)[,\s]+/i, '').replace(/[,\s]+(?:please|pls)$/i, '');
  if (CANCEL.test(bare)) return { kind: 'cancel', text: bare, said };
  if (GUARD_OFF.test(bare)) return { kind: 'guard', on: false, text: bare, said };
  if (GUARD_ON.test(bare)) return { kind: 'guard', on: true, text: bare, said };
  if (ASK.test(bare)) return { kind: 'ask', text: bare, said };
  let P = parseText(bare), t = bare;
  // "send towels to 418", "towels for room 418 please": the room said last → "418 send towels" (how the HK group writes it)
  if (!(P.actions || []).length) {
    const nums = bare.match(/\b\d{3,4}\b/g) || [];
    if (nums.length === 1) {
      const n = nums[0];
      const rest = bare.replace(new RegExp('\\s*\\b(?:to|for|in|at|of)?\\s*(?:room\\s+)?' + n + '\\b'), ' ').replace(/\s+/g, ' ').trim();
      if (rest) { const P2 = parseText(n + ' ' + rest); if ((P2.actions || []).length) { P = P2; t = n + ' ' + rest; } }
    }
  }
  const actions = (P.actions || []).filter(a => ACTS.test(a.act));
  if (actions.length) return { kind: 'room', text: t, said, actions };
  return { kind: 'ask', text: bare, said };
}

// the confirm card's question: "Check out room 312?"
function tl(t) { try { return W.hoWaPure && W.hoWaPure.timeLabel ? W.hoWaPure.timeLabel(t) : t; } catch (_) { return t; } }
function question(a) {
  const r = a.room;
  if (a.act === 'co') return `Check out room ${r}?`;
  if (a.act === 'lco' && a.soon) return `Room ${r} checking out in ${a.soon} min?`;
  if (a.act === 'lco') return a.time ? `Late check-out for ${r} at ${tl(a.time)}?` : `Late check-out for ${r}?`;
  if (a.act === 'ext') {
    if (a.nights) return `Extend room ${r} by ${a.nights} night${a.nights > 1 ? 's' : ''}?`;
    if (a.until) { const p = String(a.until).split('/'), M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']; return `Extend room ${r} until ${p[0]}${p[1] ? ' ' + (M[+p[1] - 1] || p[1]) : ''}?`; }
    return `Extend room ${r}?`;
  }
  if (a.act === 'extending') return `Mark room ${r} as extending?`;
  if (a.act === 'maybe') return `Note that ${r} might extend?`;
  if (a.act === 'fin') return `Room ${r} left — hold for ${a.who || 'Finance'}?`;
  return `Add to room ${r}: “${a.note || 'note'}”?`;
}
const HPchip = a => { try { return W.hoWaPure && typeof W.hoWaPure.chip === 'function' ? W.hoWaPure.chip(a) : a.act.toUpperCase() + ' ' + a.room; } catch (_) { return a.act + ' ' + a.room; } };
const TONE = { co: 'co', lco: 'lco', ext: 'ext', extending: 'ext', maybe: 'note', fin: 'lco', note: 'note' };
const onBoard = room => { try { const n = parseInt(room, 10); return typeof depRooms !== 'undefined' && depRooms.some(r => parseInt(r.roomStr, 10) === n); } catch (_) { return true; } };

// ══ Feedback ═══════════════════════════════════════════════
function buzz(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (_) {} }
function say(text) {
  if (!cfg().speak || !text || !W.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') return;
  try {
    W.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text).replace(/[^\p{L}\p{N}\s.,:'?!+-]/gu, ' ').replace(/\s+/g, ' ').trim());
    const l = cfg().lang;
    u.lang = /^ar/.test(l) ? 'en-US' : l;   // our replies are English
    u.rate = 1.05;
    W.speechSynthesis.speak(u);
  } catch (_) {}
}

// ══ Listening sheet ════════════════════════════════════════
const MIC_SVG = '<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3.5"/></svg>';
const EXAMPLES = ['312 checked out', '514 late check-out at 2', 'room 220 extend 2 nights', 'send towels to 418', "what's left to check out", 'open departures', "I'm away"];

function css() {
  if ($('hvCss')) return;
  const st = doc.createElement('style');
  st.id = 'hvCss';
  st.textContent = `
#hvOv.hv-ov{position:fixed;inset:0;z-index:9997;padding:0!important;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.42);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);opacity:0;transition:opacity .18s}
#hvOv.hv-ov.show{opacity:1}
#hvOv.hv-ov[hidden]{display:none}
.hv-sheet{--hv-co:var(--green,#16a34a);--hv-lco:var(--amber,#d97706);--hv-ext:var(--teal,#0d9488);--hv-note:var(--purple,#7c3aed);
  position:relative;width:100%;max-width:460px;box-sizing:border-box;background:var(--card);color:var(--text);border:1px solid var(--border);border-bottom:0;border-radius:22px 22px 0 0;
  padding:10px 18px calc(16px + env(safe-area-inset-bottom));box-shadow:0 -12px 40px rgba(0,0,0,.35);font-family:var(--font,inherit);transform:translateY(24px);transition:transform .22s cubic-bezier(.2,.8,.2,1)}
.hv-ov.show .hv-sheet{transform:none}
@media (min-width:769px){#hvOv.hv-ov{align-items:center}.hv-grab{display:none}.hv-sheet{border-radius:20px;border-bottom:1px solid var(--border);padding-bottom:18px}}
.hv-grab{width:38px;height:5px;border-radius:9px;background:var(--border);margin:0 auto 6px}
.hv-x{position:absolute;top:10px;right:10px;width:34px;height:34px;border-radius:10px;border:1px solid var(--border);background:transparent;color:var(--text2,var(--text));font-size:15px;cursor:pointer}
.hv-mic{position:relative;width:96px;height:96px;margin:14px auto 8px;display:grid;place-items:center}
.hv-mic button{position:relative;z-index:1;width:72px;height:72px;border-radius:50%;border:0;display:grid;place-items:center;font-size:30px;cursor:pointer;color:var(--bg,#fff);background:var(--accent);box-shadow:0 8px 24px color-mix(in srgb,var(--accent) 45%,transparent)}
.hv-ring{position:absolute;inset:12px;border-radius:50%;background:var(--accent);opacity:0}
.hv-sheet[data-st="listen"] .hv-ring{animation:hvPulse 1.6s ease-out infinite}
.hv-sheet[data-st="listen"] .hv-ring.r2{animation-delay:.8s}
.hv-sheet[data-st="think"] .hv-mic button{opacity:.6}
.hv-sheet[data-st="idle"] .hv-mic button,.hv-sheet[data-st="error"] .hv-mic button{background:var(--card2,var(--bg2));color:var(--accent);box-shadow:none;border:1px solid var(--border)}
@keyframes hvPulse{0%{transform:scale(.8);opacity:.35}100%{transform:scale(1.5);opacity:0}}
.hv-state{text-align:center;font:700 12px var(--font,inherit);letter-spacing:.06em;text-transform:uppercase;color:var(--accent)}
.hv-sheet[data-st="error"] .hv-state{color:var(--red,#dc2626)}
.hv-live{min-height:52px;margin:8px 0 4px;text-align:center;font-size:20px;line-height:1.3;font-weight:650;color:var(--text);overflow-wrap:anywhere}
.hv-live i{font-style:normal;color:var(--text3,var(--text2));font-weight:500}
.hv-live small{display:block;font-size:13px;font-weight:500;color:var(--text2,var(--text));margin-top:6px;line-height:1.45}
.hv-ex{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin:8px 0 2px}
.hv-ex button{border:1px solid var(--border);background:transparent;color:var(--text2,var(--text));border-radius:99px;padding:6px 11px;font:500 12px var(--font,inherit);cursor:pointer}
.hv-ex button:hover{color:var(--text);border-color:var(--accent)}
.hv-cf{margin-top:4px}
.hv-cf[hidden],.hv-ex[hidden],.hv-mic[hidden]{display:none}
.hv-q{font-size:21px;font-weight:750;line-height:1.25;text-align:center;margin:14px 34px 10px;text-wrap:balance}
.hv-chips{display:flex;flex-wrap:wrap;gap:6px;justify-content:center}
.hv-chip{display:inline-flex;align-items:center;gap:5px;font:650 12.5px/1.3 var(--font,inherit);padding:4px 10px;border-radius:99px;border:1px solid var(--border);color:var(--text2,var(--text))}
.hv-chip.co{color:var(--hv-co);background:color-mix(in srgb,var(--hv-co) 11%,transparent);border-color:color-mix(in srgb,var(--hv-co) 38%,transparent)}
.hv-chip.lco{color:var(--hv-lco);background:color-mix(in srgb,var(--hv-lco) 11%,transparent);border-color:color-mix(in srgb,var(--hv-lco) 38%,transparent)}
.hv-chip.ext{color:var(--hv-ext);background:color-mix(in srgb,var(--hv-ext) 11%,transparent);border-color:color-mix(in srgb,var(--hv-ext) 38%,transparent)}
.hv-chip.note{color:var(--hv-note);background:color-mix(in srgb,var(--hv-note) 10%,transparent);border-color:color-mix(in srgb,var(--hv-note) 34%,transparent)}
.hv-heard{text-align:center;color:var(--text3,var(--text2));font-size:12.5px;margin:10px 0 0}
.hv-warn{text-align:center;color:var(--amber,#d97706);font-size:12.5px;margin:6px 0 0}
.hv-btns{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px}
.hv-btns button{min-height:48px;border-radius:14px;font:700 15px var(--font,inherit);cursor:pointer;border:1px solid var(--border);background:transparent;color:var(--text)}
.hv-btns .hv-ok{background:var(--accent);border-color:var(--accent);color:var(--bg,#fff)}
.hv-again{display:block;margin:10px auto 0;border:0;background:none;color:var(--accent);font:600 13px var(--font,inherit);cursor:pointer;padding:6px}
.hv-foot{text-align:center;color:var(--text3,var(--text2));font-size:11.5px;margin-top:12px}
.hv-sheet button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
@media (hover:none){.hv-foot .hv-kb{display:none}}
.hv-askmic{flex:0 0 auto;width:42px;min-height:40px;border-radius:10px;border:1px solid var(--border2,var(--border));background:var(--bg2,var(--card));color:var(--accent);font-size:19px;display:grid;place-items:center;cursor:pointer;padding:0}
.hv-askmic:hover{border-color:var(--accent)}
.hv-askmic[hidden]{display:none}
#brFab{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}
#brFab.hv-hold{box-shadow:0 0 0 0 var(--accent);animation:hvHold .6s linear forwards}
@keyframes hvHold{to{box-shadow:0 0 0 9px color-mix(in srgb,var(--accent) 35%,transparent)}}
.hv-sec-ic svg{width:18px;height:18px}
@media (prefers-reduced-motion:reduce){#hvOv.hv-ov,.hv-sheet{transition:none}.hv-sheet[data-st="listen"] .hv-ring{animation:none;opacity:.18;transform:scale(1.25)}#brFab.hv-hold{animation:none;box-shadow:0 0 0 4px var(--accent)}}
`;
  doc.head.appendChild(st);
}

function sheet() {
  let ov = $('hvOv');
  if (ov) return ov;
  css();
  ov = doc.createElement('div');
  // .fr-overlay: utils.js' one Esc handler (it runs first and stops the key) closes the window on top — this one
  ov.id = 'hvOv'; ov.className = 'hv-ov fr-overlay'; ov.hidden = true;
  ov.innerHTML = `<div class="hv-sheet" role="dialog" aria-modal="true" aria-label="Voice command" data-st="idle">
    <div class="hv-grab"></div><button type="button" class="hv-x" aria-label="Cancel" data-hv="cancel">✕</button>
    <div class="hv-mic" id="hvMic"><span class="hv-ring"></span><span class="hv-ring r2"></span><button type="button" id="hvMicBtn" aria-label="Start / stop listening">${MIC_SVG}</button></div>
    <div class="hv-state" id="hvState">Listening</div>
    <div class="hv-live" id="hvLive" aria-live="polite"></div>
    <div class="hv-ex" id="hvEx">${EXAMPLES.map(x => `<button type="button" data-hv-ex="${esc(x)}">${esc(x)}</button>`).join('')}</div>
    <div class="hv-cf" id="hvCf" hidden></div>
    <div class="hv-foot" id="hvFoot">Tap outside to cancel<span class="hv-kb"> · Esc</span></div>
  </div>`;
  ov.addEventListener('click', e => {
    if (e.target === ov) return cancel();
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.hv === 'cancel') return cancel();
    if (b.dataset.hv === 'ok') return doIt();
    if (b.dataset.hv === 'again') { pending = null; return start({ keep: true }); }
    if (b.id === 'hvMicBtn') return rec ? stop() : start({ keep: true });
    if (b.dataset.hvEx) { abortRec(); handleText(b.dataset.hvEx); }
  });
  doc.body.appendChild(ov);
  return ov;
}
function show() {
  const ov = sheet();
  clearTimeout(hideT);
  if (!ov.hidden) { ov.classList.add('show'); return ov; }
  lastFocus = doc.activeElement;
  ov.hidden = false;
  requestAnimationFrame(() => ov.classList.add('show'));
  return ov;
}
function hide() {
  const ov = $('hvOv'); if (!ov || ov.hidden) return;
  ov.classList.remove('show');
  const done = () => { ov.hidden = true; };
  clearTimeout(hideT);
  if (reduced()) done(); else hideT = setTimeout(done, 180);
  try { if (lastFocus && lastFocus.focus && doc.contains(lastFocus) && !isPhone()) lastFocus.focus({ preventScroll: true }); } catch (_) {}
}
function setState(st, label, live) {
  const ov = sheet(), s = ov.querySelector('.hv-sheet');
  s.dataset.st = st;
  $('hvState').textContent = label;
  if (live !== undefined) $('hvLive').innerHTML = live;
  const cf = st === 'confirm';
  $('hvCf').hidden = !cf; $('hvMic').hidden = cf; $('hvEx').hidden = cf || st === 'think';
  $('hvState').hidden = cf; $('hvLive').hidden = cf;
}

// ══ Recognition ════════════════════════════════════════════
let hideT = null, rec = null, gotFinal = null, cancelled = false, safety = null, pending = null, lastFocus = null, fromBrain = false;
const HINT = '<i>Say a room and what happened…</i><small>e.g. “312 checked out” · “514 late check-out at 2”</small>';

function start(opt) {
  opt = opt || {};
  if (!supported) { toast('Voice is not available in this browser', 'err'); return false; }
  if (!cfg().on && !opt.force) { toast('Voice control is off — Settings → Voice', 'info'); return false; }
  if (rec) return true;
  if (!opt.keep) fromBrain = !!opt.brain;
  pending = null;
  show();
  setState('listen', 'Listening', HINT);
  try { if (W.speechSynthesis) W.speechSynthesis.cancel(); } catch (_) {}   // never hear ourselves
  cancelled = false; gotFinal = null;
  let r;
  try {
    r = new SR();
    r.lang = cfg().lang;
    r.interimResults = true;
    r.continuous = false;          // ends by itself after a pause
    r.maxAlternatives = 3;
  } catch (e) { setState('error', 'Voice unavailable', esc(e && e.message || 'Could not start')); return false; }
  r.onresult = e => {
    let fin = '', interim = '';
    for (let i = 0; i < e.results.length; i++) { const res = e.results[i]; if (res.isFinal) fin += res[0].transcript; else interim += res[0].transcript; }
    const last = e.results[e.results.length - 1];
    if (last && last.isFinal) {
      // the engine's other guesses for the last bit, each with what came before it
      const head = fin.slice(0, fin.length - last[0].transcript.length);
      gotFinal = []; for (let k = 0; k < last.length; k++) gotFinal.push(head + last[k].transcript);
    }
    $('hvLive').innerHTML = esc(fin) + (interim ? `<i>${fin ? ' ' : ''}${esc(interim)}</i>` : '');
  };
  r.onerror = e => {
    const c = e && e.error;
    if (cancelled || c === 'aborted') return;
    const msg = {
      'no-speech': ['Didn’t hear anything', 'Tap the mic and try again.'],
      'audio-capture': ['No microphone', 'No microphone was found on this device.'],
      'not-allowed': ['Microphone blocked', 'Allow the microphone for HotelOps (iPhone: Settings → Safari → Microphone; PC: the 🔒 in the address bar), then try again.'],
      // iPhone Home Screen apps on older iOS, or Siri & Dictation switched off
      'service-not-allowed': ['Voice not allowed here', 'On iPhone turn on Settings → General → Keyboard → Enable Dictation (and Siri). If it still fails in the Home Screen app, open HotelOps in Safari.'],
      'network': ['No connection', 'Speech is turned into text online — check the internet and try again.'],
      'language-not-supported': ['Language not supported', 'Pick another language in Settings → Voice.'],
    }[c] || ['Didn’t catch that', 'Tap the mic and try again.'];
    gotFinal = null;
    setState(c === 'no-speech' ? 'idle' : 'error', msg[0], `<small>${esc(msg[1])}</small>`);
    buzz(30);
  };
  r.onend = () => {
    clearTimeout(safety);
    const mine = rec === r; if (mine) rec = null;
    if (cancelled || !mine) return;
    if (gotFinal && gotFinal.length) { const alts = gotFinal; gotFinal = null; process(alts); }
    else if (sheet().querySelector('.hv-sheet').dataset.st === 'listen') setState('idle', 'Didn’t catch that', '<small>Tap the mic and try again — or tap an example.</small>');
  };
  try { r.start(); rec = r; }
  catch (e) {
    // iPhone needs a tap to start the mic: after a long press the sheet waits for one
    setState('idle', 'Tap the mic to talk', HINT);
    return false;
  }
  buzz(12);
  clearTimeout(safety);
  safety = setTimeout(() => { if (rec === r) try { r.stop(); } catch (_) {} }, 12000);   // never listen forever
  return true;
}
/** finish listening now and use what was heard (push-to-talk release, hoVoice.stop) */
function stop() { const r = rec; if (!r) return; try { r.stop(); } catch (_) { try { r.abort(); } catch (__) {} } }
function abortRec() { const r = rec; if (!r) return; cancelled = true; rec = null; clearTimeout(safety); try { r.abort(); } catch (_) {} }
function cancel() { abortRec(); pending = null; hide(); }
/** Esc from utils.js: gone at once (it removes a window that is still showing) */
function escCancel() { abortRec(); pending = null; const ov = $('hvOv'); if (ov) { clearTimeout(hideT); ov.classList.remove('show'); ov.hidden = true; } }

/** several things the engine might have heard: the first that is a room command wins, else the best guess */
function process(alts) {
  alts = (alts || []).map(a => String(a || '').trim()).filter(Boolean);
  if (!alts.length) return setState('idle', 'Didn’t catch that', '<small>Tap the mic and try again.</small>');
  const top = classify(alts[0]);
  let pick = alts[0];
  if (top.kind === 'ask') { const r = alts.slice(1).find(a => classify(a).kind === 'room'); if (r && !/^\s*(?:what|who|how|when|which|where|why|is|are|open|show|go)\b/i.test(alts[0])) pick = r; }
  handleText(pick);
}

// ══ Acting on it ═══════════════════════════════════════════
/** text → the same flow as speaking it. opt.dry: only say what it would do. */
function handleText(text, opt) {
  opt = opt || {};
  const c = classify(text);
  if (opt.dry) return c;
  try {
    if (c.kind === 'empty') { show(); setState('idle', 'Didn’t catch that', '<small>Tap the mic and try again.</small>'); return c; }
    if (c.kind === 'cancel') { cancel(); return c; }
    if (c.kind === 'guard') { hide(); guard(c.on); return c; }
    if (c.kind === 'ask') { hide(); toBrain(c.text); return c; }
    if (c.kind === 'room') { confirmCard(c); return c; }
  } catch (e) { toast('Voice: ' + (e && e.message || 'something went wrong'), 'err'); }
  return c;
}

function guard(on) {
  const G = W.hoWaGuard;
  if (!G || typeof G.set !== 'function') { toast('The Away guard is not available here', 'err'); say('Away guard not available'); return; }
  try { G.set(on); buzz(on ? [15, 40, 15] : 15); say(on ? 'Away guard on' : 'Welcome back. Away guard off'); }
  catch (e) { toast('Away guard: ' + (e && e.message || 'failed'), 'err'); }
}

function toBrain(q) {
  if (typeof W.brOpen !== 'function') { toast('Ops Brain is not loaded', 'err'); return; }
  W.brOpen('think');
  const box = $('brQ'); if (box) box.value = q;
  try { if (typeof W.brTabShow === 'function') W.brTabShow('think'); } catch (_) {}
  try { (W.brAsk || brAskFallback)(q); } catch (e) { toast('Ops Brain: ' + (e && e.message || 'failed'), 'err'); }
  // the phone keyboard has no business opening for a spoken question
  if (isPhone()) setTimeout(() => { try { const b = $('brQ'); if (b && doc.activeElement === b) b.blur(); } catch (_) {} }, 120);
}
function brAskFallback() {}

function confirmCard(c) {
  pending = c;
  show();
  const acts = c.actions;
  const q = acts.length === 1 ? question(acts[0]) : `Do these ${acts.length} things?`;
  const off = acts.map(a => a.room).filter((r, i, l) => l.indexOf(r) === i && !onBoard(r));
  $('hvCf').innerHTML = `
    <div class="hv-q">${esc(q)}</div>
    <div class="hv-chips">${acts.map(a => `<span class="hv-chip ${TONE[a.act] || 'note'}">${esc(HPchip(a))}</span>`).join('')}</div>
    ${off.length ? `<div class="hv-warn">⚠ ${esc(off.join(', '))} ${off.length > 1 ? 'are' : 'is'} not on today's departures — HotelOps will look ${off.length > 1 ? 'them' : 'it'} up in-house</div>` : ''}
    <div class="hv-heard">Heard: “${esc(c.said)}”</div>
    <div class="hv-btns"><button type="button" class="hv-no" data-hv="cancel">✗ Cancel</button><button type="button" class="hv-ok" data-hv="ok">✓ Do it</button></div>
    ${supported ? '<button type="button" class="hv-again" data-hv="again">🎤 Say it again</button>' : ''}`;
  setState('confirm', 'Confirm');
  buzz(10);
  say(q);
  setTimeout(() => { try { const b = $('hvOv').querySelector('.hv-ok'); if (b && !isPhone()) b.focus({ preventScroll: true }); } catch (_) {} }, 40);
}

function hhmm() { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
/** ✓ Do it: the WhatsApp reader applies it, with its own Undo toast */
function doIt() {
  const c = pending; pending = null;
  if (!c) return hide();
  hide();
  const B = W.hoWaBridge;
  if (!B || typeof B.handle !== 'function') { toast('Room commands need the WhatsApp reader (wa-bridge.js)', 'err'); return; }
  const t0 = Date.now();
  let r;
  try {
    r = B.handle({ id: 'voice-' + t0.toString(36) + Math.random().toString(36).slice(2, 6), text: c.text, sender: 'Voice', mine: true, time: hhmm() }, 'voice');
  } catch (e) { toast('Voice: could not apply — ' + (e && e.message || 'error'), 'err'); return; }
  if (r === 'dup') { toast('Already done a moment ago — nothing changed', 'info'); say('Already done'); return; }
  let res = [];
  try { const l = B.log()[0]; if (l && l.at >= t0 && l.via === 'voice') res = l.res || []; } catch (_) {}
  const acted = res.filter(x => /^(?:co|lco|ext|extending|fin|note|maybe)$/.test(x.st));
  const plain = s => String(s || '').replace(/ · .*$/, '').replace(/^[^\p{L}\p{N}]+/u, '');
  if (acted.length) { buzz([15, 40, 15]); say(acted.map(x => plain(x.text)).join('. ')); }
  else if (res.length) {
    const msg = res.map(x => plain(x.text)).join(' · ');
    // the reader toasts "not there" itself; anything else (already out, waiting for the board, a request) is said here
    if (!res.some(x => x.st === 'notlist')) toast(msg, /skip|req/.test(res[0].st) ? 'info' : 'err');
    buzz(40); say(msg);
  }
}

// ══ Triggers ═══════════════════════════════════════════════
// 1. 🎤 in the Ops Brain ask bar — brain.js builds the sheet on first open, so it is added when it appears
function paintAskMic() {
  const f = doc.querySelector('#brSheet .br-ask'); if (!f) return;
  let b = f.querySelector('.hv-askmic');
  if (!b) {
    css();
    b = doc.createElement('button');
    b.type = 'button'; b.className = 'hv-askmic'; b.innerHTML = MIC_SVG;
    b.title = 'Speak (Ctrl+Shift+Space · hold Alt+V)'; b.setAttribute('aria-label', 'Speak instead of typing');
    b.addEventListener('click', e => { e.preventDefault(); start({ brain: true }); });
    const sub = f.querySelector('[type="submit"]');
    f.insertBefore(b, sub || null);
  }
  b.hidden = !cfg().on;
}

// 2. hold 🧠 for 0.6 s: talk. A normal tap still opens Ops Brain.
let holdT = null, held = false, holdStart = 0, hx = 0, hy = 0;
function holdOn(e) {
  if (!cfg().on || !cfg().hold || e.button > 0) return;
  const fab = e.target.closest && e.target.closest('#brFab'); if (!fab) return;
  hx = e.clientX; hy = e.clientY; held = false;
  clearTimeout(holdT);
  fab.classList.add('hv-hold');
  holdT = setTimeout(() => { holdT = null; held = true; holdStart = Date.now(); fab.classList.remove('hv-hold'); buzz(20); start(); }, 600);
}
function holdOff(e) {
  const fab = $('brFab'); if (fab) fab.classList.remove('hv-hold');
  if (holdT) { clearTimeout(holdT); holdT = null; return; }
  // a real walkie-talkie hold (kept pressed while talking): letting go ends it
  if (held && e && e.type === 'pointerup' && Date.now() - holdStart > 1400) stop();
}
function holdMove(e) { if (holdT && Math.hypot(e.clientX - hx, e.clientY - hy) > 12) holdOff(); }

// 3. keyboard: Ctrl+Shift+Space toggles · hold Alt+V to talk, let go to finish
let ptt = false;
function keys(e) {
  const ov = $('hvOv'), open = ov && !ov.hidden;
  if (open && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cancel(); return; }   // before Ops Brain's own Esc
  if (open && pending && e.key === 'Enter' && !e.isComposing) { const t = e.target; if (!t || !t.closest || !t.closest('.hv-no,.hv-again,.hv-x')) { e.preventDefault(); doIt(); } return; }
  if (!supported || !cfg().on) return;
  if (e.ctrlKey && e.shiftKey && (e.code === 'Space' || e.key === ' ')) { e.preventDefault(); if (rec) stop(); else if (open && !pending) cancel(); else start(); return; }
  if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyV' && !e.repeat) { e.preventDefault(); ptt = true; start(); }
}
function keysUp(e) {
  if (!ptt) return;
  if (e.code === 'KeyV' || e.key === 'Alt') { ptt = false; stop(); }
}

// ══ Settings → Voice ═══════════════════════════════════════
function settingsHtml() {
  const c = cfg();
  const row = (k, label, desc, on) => `<label class="hs-row" data-s="${esc((label + ' ' + desc + ' voice microphone speak').toLowerCase())}">
      <span class="hs-txt"><b>${label}</b><small>${desc}</small></span>
      <span class="hs-switch"><input type="checkbox" ${on ? 'checked' : ''} onchange="hoVoice._set('${k}', this.checked)"><i></i></span></label>`;
  return `<section class="hs-sec" id="hs-voice">
    <div class="hs-sec-hd"><span class="hs-sec-ic hv-sec-ic">${MIC_SVG}</span><div><h2>Voice</h2><p>Speak instead of typing — “312 checked out”, “open departures”</p></div></div>
    <div class="hs-card">
      ${row('on', 'Voice control', 'The 🎤 in Ops Brain, hold the 🧠 button, Ctrl+Shift+Space or hold Alt+V. Room changes always ask first.', c.on)}
      <div class="hs-row" data-s="voice language english arabic accent">
        <span class="hs-txt"><b>Language</b><small>What you speak in. Arabic understands the basics (غرفة ٣١٢ طلع).</small></span>
        <span class="hs-seg">${LANGS.map(([v, t]) => `<button type="button" class="${c.lang === v ? 'on' : ''}" onclick="hoVoice._set('lang','${v}')">${esc(t)}</button>`).join('')}</span>
      </div>
      ${row('speak', 'Speak confirmations', 'Says “312 checked out” out loud when done. Handy with your hands full.', c.speak)}
      ${row('hold', 'Hold 🧠 to talk', 'Press and hold the floating 🧠 button for a moment to start listening. A tap still opens Ops Brain.', c.hold)}
      <div class="hs-row" data-s="voice try test microphone">
        <span class="hs-txt"><b>Try it</b><small>Allow the microphone when asked. Speech is turned into text online (Apple / Google).</small></span>
        <button class="btn" type="button" onclick="hoVoice.start({force:true})">🎤 Try</button>
      </div>
    </div>
  </section>`;
}
function renderSettings() {
  const box = $('hsBody'); if (!box || !supported) return;
  const old = $('hs-voice');
  const tmp = doc.createElement('div'); tmp.innerHTML = settingsHtml();
  if (old) old.replaceWith(tmp.firstElementChild); else box.appendChild(tmp.firstElementChild);
}

// ══ Start-up ═══════════════════════════════════════════════
function boot() {
  if (!supported) return;   // no Web Speech: nothing of this shows
  css();
  // Ops Brain's sheet and the settings page are (re)built by other files: add ours whenever they appear
  const mo = new MutationObserver(() => {
    if ($('brSheet') && !doc.querySelector('#brSheet .hv-askmic')) paintAskMic();
    const hs = $('hsBody'); if (hs && hs.children.length && !$('hs-voice')) renderSettings();
  });
  mo.observe(doc.body, { childList: true, subtree: true });
  paintAskMic(); if ($('hsBody') && $('hsBody').children.length) renderSettings();
  doc.addEventListener('pointerdown', holdOn, true);
  doc.addEventListener('pointerup', holdOff, true);
  doc.addEventListener('pointercancel', holdOff, true);
  doc.addEventListener('pointermove', holdMove, { capture: true, passive: true });
  // the click that ends a long press must not also open Ops Brain
  doc.addEventListener('click', e => { if (held && e.target.closest && e.target.closest('#brFab')) { e.preventDefault(); e.stopImmediatePropagation(); held = false; } }, true);
  doc.addEventListener('contextmenu', e => { if (cfg().hold && e.target.closest && e.target.closest('#brFab')) e.preventDefault(); }, true);
  try { if (typeof ESC_CLOSE === 'object' && ESC_CLOSE) ESC_CLOSE.hvOv = escCancel; } catch (_) {}
  W.addEventListener('keydown', keys, true);
  W.addEventListener('keyup', keysUp, true);
  W.addEventListener('blur', () => { if (ptt) { ptt = false; stop(); } });
}

W.hoVoice = { start, stop, cancel, handleText, supported, norm, classify, _set: setCfg, cfg };
if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();
})(window);
