// ═══════════════════════════════════════════════════════════
//  install-prompt.js — "Add to home screen" on phones
//  Android / Chrome: uses the browser's own install prompt.
//  iPhone (Safari has no prompt): shows the two taps to do it by hand.
//  Shown once a few seconds after sign-in, only on phones, never when the
//  app is already installed; "Not now" hides it for 30 days. The 📲
//  button in the More menu opens it again any time.
// ═══════════════════════════════════════════════════════════

let _ipEvent = null;
const IP_KEY = 'install_prompt_later_v1';

const _ipStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const _ipIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
const _ipPhone = () => window.matchMedia('(max-width: 768px)').matches;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _ipEvent = e;
  _ipShowButton();
});
window.addEventListener('appinstalled', () => {
  _ipEvent = null;
  document.getElementById('ipBanner')?.remove();
  _ipShowButton();
  showToast('Installed — open HotelOps from your home screen', 'ok');
});

function _ipShowButton() {
  const b = document.getElementById('mobInstallBtn');
  if (b) b.style.display = !_ipStandalone() && (_ipEvent || _ipIos()) ? '' : 'none';
}

function ipOpen(force) {
  if (_ipStandalone()) return;
  if (!_ipEvent && !_ipIos()) {
    if (force) showToast('Use your browser menu → "Install app" or "Add to Home screen"', 'ok');
    return;
  }
  document.getElementById('ipBanner')?.remove();
  const el = document.createElement('div');
  el.id = 'ipBanner';
  el.className = 'ip-banner';
  el.innerHTML = _ipEvent
    ? `<div class="ip-ico">📲</div><div class="ip-txt"><b>Add HotelOps to your home screen</b><span>Opens full-screen like an app, starts faster and works with weak Wi-Fi.</span></div>
       <div class="ip-btns"><button class="btn gold" data-ip="go">Add</button><button class="btn ghost" data-ip="later">Not now</button></div>`
    : `<div class="ip-ico">📲</div><div class="ip-txt"><b>Add HotelOps to your home screen</b><span>In Safari tap <b>Share</b> <span class="ip-share">⬆︎</span> at the bottom, then <b>Add to Home Screen</b>.</span></div>
       <div class="ip-btns"><button class="btn ghost" data-ip="later">Got it</button></div>`;
  el.addEventListener('click', async e => {
    const b = e.target.closest('[data-ip]');
    if (!b) return;
    if (b.dataset.ip === 'go' && _ipEvent) {
      _ipEvent.prompt();
      try { await _ipEvent.userChoice; } catch (_) {}
      _ipEvent = null;
      _ipShowButton();
    } else {
      try { localStorage.setItem(IP_KEY, String(Date.now() + 30 * 864e5)); } catch (_) {}
    }
    el.remove();
  });
  document.body.appendChild(el);
}

document.addEventListener('DOMContentLoaded', () => {
  _ipShowButton();
  if (_ipStandalone() || !_ipPhone()) return;
  if (typeof hoPref === 'function' && !hoPref('installPrompt')) return;
  let later = 0;
  try { later = +localStorage.getItem(IP_KEY) || 0; } catch (_) {}
  if (later > Date.now()) return;
  // after sign-in, and after the What's new window if one is up
  const t = setInterval(() => {
    const app = document.getElementById('appWrapper');
    if (!app || app.style.display === 'none' || document.getElementById('wnModal')) return;
    clearInterval(t);
    setTimeout(() => { if (!document.getElementById('wnModal')) ipOpen(false); }, 6000);
  }, 1500);
});
