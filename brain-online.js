// ═══════════════════════════════════════════════════════════
//  brain-online.js — Ops Brain looks it up online
//  When nothing in the app answers a question, Ops Brain searches the web
//  by itself and shows a short answer with where it came from:
//    • with an AI key on this device (the same one the roster pictures use,
//      kept on this device only): Claude searches the web and answers in a
//      few lines, with links to its sources;
//    • without a key: the best match from Wikipedia (free, no account).
//  Always a one-tap "Search Google" too. "search online …" / "google …"
//  ask it directly.
// ═══════════════════════════════════════════════════════════

const BO_SYSTEM = 'You help the front office team of hotels in Dubai, UAE (Accor brands: ibis, Mercure, Adagio). Answer the question using a quick web search. Reply in plain words, at most 6 short lines or bullet points, practical for someone at the reception desk. If rules or prices may have changed, say what the official source says and when. No preamble.';
let _boRun = 0;

/** The answer card, filled in when the search returns. */
function boCardHtml(q) {
  return `<div class="br-card" id="boCard"><div class="br-kind">🌐 Searching online…</div><div class="br-body">Nothing in the app answers "${escapeHtml(q)}", so I'm looking it up.</div>${_boActs(q)}</div>`;
}
function _boActs(q) {
  return `<div class="br-acts"><a class="btn" href="https://www.google.com/search?q=${encodeURIComponent(q)}" target="_blank" rel="noopener">🔎 Search Google</a></div>`;
}
function _boShow(run, html) {
  if (run !== _boRun) return;   // a newer question was asked meanwhile
  const c = document.getElementById('boCard'); if (c) c.outerHTML = html;
}

/** Look q up online and put the answer into the card. */
async function boSearch(q) {
  const run = ++_boRun;
  const cfg = typeof riCfg === 'function' ? riCfg() : {};
  try {
    const res = cfg.key ? await _boAskClaude(q, cfg) : await _boWikipedia(q);
    if (!res) { _boShow(run, `<div class="br-card" id="boCard"><div class="br-kind">🌐 Online</div><div class="br-body">I couldn't find a clear answer online.${cfg.key ? '' : ' With an AI key (Roster → AI settings) I can search the whole web and answer in plain words.'}</div>${_boActs(q)}</div>`); return; }
    const src = (res.sources || []).slice(0, 4).map(s => `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.title || s.url)}</a>`).join(' · ');
    _boShow(run, `<div class="br-card" id="boCard"><div class="br-kind">🌐 ${res.ai ? 'Found online (AI web search)' : 'Found online (Wikipedia)'}</div>
      <div class="br-body bo-ans">${res.html}</div>
      ${src ? `<div class="br-body bo-src">Sources: ${src}</div>` : ''}
      <div class="br-body bo-note">From the internet, not from your hotel: check anything important. Tap ✍️ Teach below to save the right answer for the team.</div>
      ${_boActs(q)}</div>`);
  } catch (e) {
    _boShow(run, `<div class="br-card" id="boCard"><div class="br-kind">🌐 Online</div><div class="br-body">${escapeHtml(e.message || 'No connection')}.</div>${_boActs(q)}</div>`);
  }
}

/** Plain text with **bold** and "- " lists → safe HTML. */
function _boFormat(t) {
  const lines = String(t || '').trim().split(/\n+/).map(l => l.trim()).filter(Boolean);
  const md = s => escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  const items = lines.filter(l => /^[-•*]\s+/.test(l));
  if (items.length >= 2 && items.length >= lines.length - 1) {
    const head = lines.filter(l => !/^[-•*]\s+/.test(l));
    return (head.length ? `<p>${md(head[0])}</p>` : '') + `<ul>${items.map(l => `<li>${md(l.replace(/^[-•*]\s+/, ''))}</li>`).join('')}</ul>`;
  }
  return lines.map(l => `<p>${md(l.replace(/^#+\s*/, ''))}</p>`).join('');
}

async function _boAskClaude(q, cfg) {
  const model = cfg.model || 'claude-sonnet-5-5';
  const older = /haiku-4|sonnet-4-5|opus-4-5/.test(model);   // these take the basic web search tool
  const body = {
    model, max_tokens: 4000, system: BO_SYSTEM,
    tools: [{ type: older ? 'web_search_20250305' : 'web_search_20260209', name: 'web_search', max_uses: 3, user_location: { type: 'approximate', city: 'Dubai', country: 'AE', timezone: 'Asia/Dubai' } }],
    messages: [{ role: 'user', content: q }],
  };
  const headers = { 'content-type': 'application/json', 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
  if (/^claude-(sonnet|opus)-5-5$/.test(model)) { body.fallbacks = 'default'; headers['anthropic-beta'] = 'server-side-fallback-2026-07-01'; }   // a declined question is retried on a model that can answer it
  let r;
  try { r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body) }); }
  catch (e) { throw new Error('No internet connection'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401) throw new Error('The AI key was refused. Check it in Roster → AI settings');
    if (r.status === 429 || r.status === 529) throw new Error('The AI is busy right now. Try again in a minute');
    const m = (j.error && j.error.message) || 'error ' + r.status;
    if (/credit|billing|balance/i.test(m)) throw new Error('The Anthropic account has no credit left');
    // the AI can't be used: still try the free lookup
    return _boWikipedia(q);
  }
  if (j.stop_reason === 'refusal') return { html: '<p>The AI won\'t answer this one.</p>', sources: [], ai: true };
  const blocks = j.content || [];
  const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('');
  if (!text.trim()) return null;
  // sources: what it cited, else what the search found
  const seen = new Set(), sources = [];
  const add = (url, title) => { if (url && !seen.has(url)) { seen.add(url); sources.push({ url, title }); } };
  blocks.forEach(b => (b.citations || []).forEach(c => add(c.url, c.title)));
  if (!sources.length) blocks.filter(b => b.type === 'web_search_tool_result' && Array.isArray(b.content)).forEach(b => b.content.forEach(x => add(x.url, x.title)));
  return { html: _boFormat(text), sources: sources.filter(s => /^https?:\/\//.test(s.url)), ai: true };
}

async function _boWikipedia(q) {
  const term = q.replace(/^(what|who|where|when|how|why|is|are|does|do|can|tell me|explain)\b\s*(is|are|does|do|the|a|an|about)?\s*/i, '').replace(/\?+$/, '').trim() || q;
  let r;
  try { r = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(term)}&srlimit=1&format=json&origin=*`); }
  catch (e) { throw new Error('No internet connection'); }
  const hit = ((await r.json().catch(() => ({}))).query || {}).search || [];
  if (!hit.length) return null;
  const title = hit[0].title;
  const s = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`).then(x => x.json()).catch(() => null);
  if (!s || !s.extract) return null;
  return { html: `<p><b>${escapeHtml(s.title || title)}</b></p><p>${escapeHtml(s.extract)}</p>`, sources: [{ url: (s.content_urls && s.content_urls.desktop && s.content_urls.desktop.page) || `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`, title: 'Wikipedia' }], ai: false };
}
