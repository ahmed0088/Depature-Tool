// ═══════════════════════════════════════════════════════════
//  enter-save.js  —  ⏎ Enter saves
//
//  In any open window (edit task, add guest, settings dialogs…), pressing
//  Enter in a field clicks that window's main button (Save / Add / OK).
//  Left alone: text areas (Enter = new line), dropdowns, Shift/Ctrl+Enter,
//  typing in Arabic/Chinese etc. (composition), search boxes, and fields that
//  already handle Enter themselves (their own onkeydown).
// ═══════════════════════════════════════════════════════════
(function () {
'use strict';

// Windows / dialogs: the app's .modal-bg / .modal, and the overlays modules draw themselves.
const DIALOG = '.modal-bg.open, .modal-bg.show, .modal.open, [role="dialog"], [aria-modal="true"], .mb-ov, .ask-ov, .ol-modal, .rf-ov, .qz-ov, .ho-modal, .open[id$="Modal"]';
// The main button, best first.
const PRIMARY = ['[data-enter]', '.btn-task-save', 'button[type="submit"]', '.btn.gold:not(.sm)', '.btn.gold', '.btn-primary', '.btn.primary'];
const SKIP_TYPES = /^(checkbox|radio|file|range|color|button|submit|reset|search|hidden)$/i;

const visible = el => !!(el && el.offsetParent !== null && !el.disabled && getComputedStyle(el).visibility !== 'hidden');

function primaryIn(box) {
  for (const sel of PRIMARY) {
    const list = [...box.querySelectorAll(sel)].filter(visible);
    // a cancel / close / delete button is never the main one
    const b = list.find(x => !/cancel|close|delete|remove|✕|×/i.test((x.textContent || '') + ' ' + (x.className || '')));
    if (b) return b;
  }
  return null;
}

function onEnter(e) {
  if (e.key !== 'Enter' || e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
  if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
  const t = e.target;
  if (!t || t.tagName !== 'INPUT' || SKIP_TYPES.test(t.type || '')) return;
  if (t.hasAttribute('onkeydown') || t.hasAttribute('onkeyup') || t.hasAttribute('onkeypress') || t.hasAttribute('data-no-enter')) return;
  if (/search/i.test(t.id || '') || /search/i.test(t.className || '')) return;
  const box = t.closest(DIALOG);
  if (!box) return;                                   // only inside an open window
  if (t.closest('[data-no-enter]')) return;
  const btn = primaryIn(box);
  if (!btn) return;
  e.preventDefault();
  btn.classList.add('enter-pressed');
  setTimeout(() => btn.classList.remove('enter-pressed'), 180);
  btn.click();
}

document.addEventListener('keydown', onEnter);
// A short "pressed" flash on the button, so you can see Enter did it.
const st = document.createElement('style');
st.textContent = '.enter-pressed{transform:scale(.96);filter:brightness(1.1);transition:transform .12s ease}@media (prefers-reduced-motion:reduce){.enter-pressed{transform:none}}';
(document.head || document.documentElement).appendChild(st);
window.hoEnterSave = { primaryIn };
})();
