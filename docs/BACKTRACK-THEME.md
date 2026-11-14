# BackTrack app style

Select **Theme → BackTrack**, or **Settings → Appearance → BackTrack**. The choice uses the existing personal/device preference and profile sync. Other users and existing theme choices are unaffected.

`backtrack.css` scopes every rule to `html[data-skin="backtrack"]`. It uses the existing Inter and JetBrains Mono stacks, without adding a font download, animation loop, timer or theme script. The stylesheet is part of the offline shell. The theme registry, early page bootstrap and sign-in accent map all register the same name, so a saved choice restores before the first paint.

The palette uses charcoal layers, high-contrast neutral text and crimson accents. Primary actions have white text on a deeper crimson fill. Success, warning, failure and information remain distinct. Shared tokens theme existing pages; explicit palette bridges cover Adagio and team chat. The layout covers the dashboard, navigation, settings, reports, native and custom dropdowns, package editing, run history, enrolment/Neorcha/IN-Gauge consoles, chat and voice controls. Printed tables use dark text on light backgrounds.

Phone dashboard actions form a grid instead of clipping; page settings sit beside the dashboard label. Redundant desktop toolbar shortcuts stay accessible from the phone's More menu. Dialog close targets stay touchable. Menus and run windows open on solid surfaces without fade-through effects. The theme respects reduced motion, retains keyboard focus indicators, and never fabricates console output or changes automation logic.

Verification: `node tests/backtrack.browser.test.js` exercises 360, 390, 768 and 1440px layouts, early restoration, the actual appearance selector, theme isolation, text contrast, hotel selection, live-run totals and close, actual team-chat close, and print readability. Full-app visual previews cover desktop and phone home, sign-in, More, appearance, departures, settings, Adagio, monthly audit, package review, contributor choice, cloud run and chat with synthetic data and external writes blocked.
