# Neorcha portal and property selection (v579)

## Phone hotel menus (v599)

On phones, **Hotel to collect from** opens a searchable list of the current hotel and saved Neorcha hotels. Switching between the current Ibis profile and Mercure preserves each profile's exact link and cloud account. It changes the next collection destination; it does not dispatch a job. The existing desktop hotel tabs remain available.

Standard single-choice phone dropdowns, including main and quick enrolment hotel links, now use the same in-app choice sheet. The original select value and its input/change handlers remain authoritative. Disabled options stay disabled; detached or replaced options are rejected instead of choosing a different hotel. Cancel/Escape changes nothing. Desktop native controls retain their keyboard behavior. Existing IN-Gauge property, department, product and seller sheets continue using their scoped controls. The new script is included in the offline shell.

`tests/phone-menus.browser.test.js` checks real taps, Ibis/Mercure destinations, search, empty/default values, disabled options, stale choices, closing and desktop restoration. The complete application was also checked on a phone across its themes, including More navigation, both enrolment contexts and IN-Gauge choices. Tests use synthetic destinations and block external actions.

## Cloud result recovery (v598)

Run [112](https://github.com/ahmed0088/Depature-Tool/actions/runs/43918756753) collected and saved 39 registrations for 16 November 2026. The client incorrectly labelled the successful workflow as a failed process because its live report was missing on that device. GitHub success alone is now shown as an unconfirmed result, without a guessed secrets error or invented process exit code.

When the workflow finishes or the reviewer presses **Refresh status**, the client reads `cloudRuns/<exact tag>` and, if needed, that tag's live report. A newer run's live feed cannot replace the selected run's result. The saved collection is loaded only when its tag, dates and row count agree; older collections without tags additionally require timestamps within the completed run's execution window. Refreshing never dispatches another workflow. The worker adds the run tag and URL to future collections. Live subscriptions requested before the database exists are queued until sign-in, and unchanged status renders preserve phone controls.

`tests/neorcha-status.test.js` and `tests/neorcha-status.browser.test.js` cover successful-but-unconfirmed workflows, stale progress, exact-run recovery, foreign runs/hotels, late replies, verified empty collections, startup listeners and stable phone/desktop controls. Browser tests use synthetic records and block external writes.

Mercure's old `/neorchaWEBPlatform/` login returned HTTP 404 in runs 43503987902 and 43499654615. Run 43504146556 used the new `/tweak` link and signed in successfully, then stopped because its saved HotelOps label `Mercure` did not exactly equal the portal property label `Mercure Dubai Deira`. This was a property-name mismatch after authentication, not a failed password.

Known Mercure legacy links now migrate to the same origin's `/tweak/` path in the app and cloud account resolver. New Mercure profiles default to Tweak, as Ibis already does. Explicit legacy links for other hotels remain unchanged. Reader selection still follows the portal path. Mercure's account still requires its own account Secrets; the main Ibis credentials are never substituted for an unconfigured Mercure account.

The scoped Tweak collector prefers an exact property name or explicit property ID. Only an unqualified alias equal to the linked portal's brand (for example `Mercure`) may fall back to one property starting with that brand. Multiple properties remain an error; qualified but incorrect names and arbitrary nicknames never fall back. Aggregate options such as All Hotels are excluded. Repeated options with the same property ID count as one identity. The error lists available property names so a full name can be entered when needed. Every returned row must still match the selected property ID, arrival range and registration document type. Context, pagination, duplicate-card and field-selection checks are retained.

The same collector function is serialized into cloud/helper/bookmark use and copied into the standalone extractor, with an exact-source regression check. The UI retains hotel-tab button nodes when saving link/account labels so input blur cannot remove a button between pointer-down and click. Structural additions/removals still rebuild the list.

## Validation

`node tests/neorcha-tweak.test.js` covers property aliases, ambiguity, exact names, aggregate exclusions, migration, credential separation, filters, pagination, source identity and field projection. `node tests/neorcha-hotels.browser.test.js` exercises a saved Mercure profile, phone link editing, the next button after native input blur, adding Mercure, exact property names, legacy Adagio, selected fields and date controls. The existing 1,228 regression checks passed after the portal/collector changes.

Authenticated read-only verification run [43505388550](https://github.com/ahmed0088/Depature-Tool/actions/runs/43505388550) used the actual Mercure account and the modified collector. It resolved `Mercure` to `Mercure Dubai Deira`; 13 November 2026 returned 26 registrations, 26 readable emails and 26 phone values, with all arrivals inside the requested day. 14 November returned zero registrations at the time of the check. Public results contained counts and the hotel name only. Allowed POST calls were sign-in and the read-only dataset execution endpoint. No cards were saved to HotelOps and no Neorcha records were changed by this verification. The temporary verification workflow remains only on its verification branch, outside the main release.
