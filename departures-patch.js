// ═══════════════════════════════════════════════════════════
//  PATCH: departures.js  — add xref auto-inject
//
//  Find the function depRender() in departures.js.
//  Scroll to the very bottom of it, just before the closing }.
//  Add this single line:
// ═══════════════════════════════════════════════════════════

  // At the bottom of depRender(), before the closing }:
  if (typeof xrefInjectDepWarnings === 'function') xrefInjectDepWarnings();

// ═══════════════════════════════════════════════════════════
//  That's it. Every time the board re-renders (status change,
//  filter switch, reload), the arrival strips auto-update.
// ═══════════════════════════════════════════════════════════

// ── ALSO: Add nav item to index.html ─────────────────────
// Find your existing nav items (e.g. departures, arrivals, etc.)
// and insert this alongside them:

/*
<div class="nav-item" id="nav-xref" onclick="showPanel('xref')">
  <span class="nav-icon">🔗</span>
  <span class="nav-label">Arr vs Dep</span>
  <span class="nav-badge" id="badge-xref">0</span>
</div>
*/

// ── ALSO: Add script tag to index.html before </body> ─────
/*
<script src="arr-dep-xref.js"></script>
*/
