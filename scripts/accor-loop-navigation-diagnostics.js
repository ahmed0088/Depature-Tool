'use strict';

// Instrument Playwright's main-frame navigation events for the Accor Loop cloud
// runner. Log only origin + path so query parameters and fragments are not exposed.
const Module = require('module');
const originalLoad = Module._load;
const patched = new WeakSet();

function safeUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch (_) {
    return '(unavailable URL)';
  }
}

function instrumentChromium(chromium) {
  if (!chromium || typeof chromium.launch !== 'function' || patched.has(chromium)) return chromium;
  patched.add(chromium);
  const launch = chromium.launch.bind(chromium);
  chromium.launch = async (...args) => {
    const browser = await launch(...args);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (...contextArgs) => {
      const context = await newContext(...contextArgs);
      const newPage = context.newPage.bind(context);
      context.newPage = async (...pageArgs) => {
        const page = await newPage(...pageArgs);
        let lastUrl = page.url();
        page.on('framenavigated', frame => {
          if (frame !== page.mainFrame()) return;
          const nextUrl = frame.url();
          if (nextUrl !== lastUrl) {
            console.log(`[NAV] Main page navigated: ${safeUrl(lastUrl)} -> ${safeUrl(nextUrl)}`);
            lastUrl = nextUrl;
          }
        });
        page.on('close', () => console.log('[NAV] Main page closed'));
        return page;
      };
      return context;
    };
    return browser;
  };
  return chromium;
}

Module._load = function (request, parent, isMain) {
  const loaded = originalLoad.call(this, request, parent, isMain);
  if (request === 'playwright' || request === 'playwright-core') instrumentChromium(loaded && loaded.chromium);
  return loaded;
};
