# Reviewed IN-Gauge audit

Open **Package Audit → IN-Gauge automation**. An owner or manager links the current HotelOps space to an exact accessible IN-Gauge property and Front Desk department. The account's products and contributors are discovered at runtime; names and numeric IDs are not embedded in the application. The portal URL is editable within the verified IN-Gauge HTTPS provider.

1. **Find or upload.** Edit a package searches the loaded live snapshot by confirmation, room, package or seller; a missing, expired or invalidated snapshot is fetched automatically. Choose Check Opera reports to use the original manual/automatic audit inputs and rules. Manual, Automatic and Both remain explicit scopes.
2. **Edit and review.** Common fields come first, with prefilled stay dates, room and notes under an expander. Save & select validates and stages the change; it does not send a financial request. Repeat for several packages to prepare one batch. Cancelling a new edit leaves no draft, and reopening an unsent edit preserves its saved values.
3. **Apply and results.** Review the exact hotel, confirmations, sellers, amounts and actions in the selected preview. Confirm the reviewed selection and Apply. Live preflight, duplicate checks, locks and final readback run in the same cloud job. The Neorcha-style console, safe cancellation and saved history remain available.

## Calculation and ownership

The existing Package Audit rules, extension credit, historical ownership, manual requests and pinned decisions remain in use. Live contributor IDs improve identity matching; an explicit optional alias can be saved to this hotel's private staff settings. An inactive historical contributor can be preserved, but new credit cannot be assigned to an inactive account. Unsupported Opera product families are held for mapping review.

Totals follow the property's live validation setting. Daily `BUSINESS_DATE` entries use the reviewed daily charge; they do not multiply it by charge days, including recurring room products. Breakfast, board and room products use verified catalog entries. Unknown products and ambiguous room types are held until assigned explicitly. An aggregate Opera journal line alone does not establish a per-person breakfast quantity.

## Limits and uncertain outcomes

Ordinary operations exclude locked, invoiced, adjusted, removed and post-lock records. These need IN-Gauge's dedicated adjustment workflows. Retail and F&B departments have a different quantity model and are excluded. Batches contain at most 100 selected changes; snapshots expire after six hours. Each reviewed plan expires after one hour, and every operation receives live preflight checks inside its apply job.

A private intent ledger is written before submission. A timeout or mismatching readback stops the batch; it is not blindly retried. Verify the outcome in IN-Gauge and fetch a fresh snapshot. A stop request prevents the next operation; it cannot undo a request already sent. Runs remain in Cloud run history.

The worker uses existing `INGAUGE_EMAIL`, `INGAUGE_PASS`, `HOTELOPS_EMAIL` and `HOTELOPS_PASS` GitHub secrets. Plans, snapshots, evidence and results live in the hotel's private Firebase paths under `ingauge`. Public workflow logs contain only operational summaries. No live financial submissions were performed during development verification.

## Ibis Neorcha migration

Ibis uses `https://ibis.myneorcha.com/tweak/`. Its new reader discovers Guest Documents, resolves the exact Ibis property and reads registration cards by the selected arrival dates. It validates hotel/document/date scope and total page counts before saving. It retains registration/contact fields used by HotelOps and excludes passport, document, birth and payment fields. A changed tenant context or incomplete result stops the run.

The cloud runner, helper/console collector and copied Guest Pipeline extractor support the Ibis design. Other hotels retain their legacy URLs, login and AngularJS card reader. No credentials need to be placed in browser code or repository files.

### Neorcha collection settings (v556)

The saved URL now selects the reader directly: `/tweak/` selects Tweak, while `/neorchaWEBPlatform/` selects the legacy reader. Explicit legacy URLs remain unchanged. The exact property name is checked inside the authenticated new portal. Only Ibis has been verified against a live Tweak account; other links must provide the expected portal and hotel access.

Choose optional fields or use Contacts & enrolment / Full registration presets. Confirmation, guest names, room and stay dates remain included for matching. Today only uses the Dubai calendar date for both arrival boundaries. These are arrival-date collections, not a list of everyone currently staying in the hotel.

Cloud collections are saved under private `neorchaCollections` and a small `neorchaCollectionIndex`. The previous current collection is archived before replacement. Reopen an archived list from Saved collections, or export the current selected-field collection as CSV. Guest Pipeline and Purpose of Stay continue to use the chosen fields. No enrollment or Neorcha business edits are made by collection.

### In-app run progress (v557)

Connecting, fetching and reviewed operations open a progress window in HotelOps. It reports sign-in, discovery, product checks and record counts; closing minimises the job. Cloud runs reopens its window. Terminal runs provide their next step, and discovery results plus the latest job are restored after refresh, including the last completed lookup from older versions. GitHub is available as an optional diagnostic link. Stage updates contain no credentials or guest identifiers. Heartbeats do not rebuild controls.

### Both Changes Log exports (v558)

The automation upload accepts both Opera Changes Log PDFs: **New Reservation** and **Update Reservation**. Select both together or add the second later. It passes the full selection into the original Package Audit loader, which merges events and excludes duplicates. The card lists all loaded files; unreadable files remain errors rather than being marked loaded. Journal and Reservation Detail still have their own upload boxes for manual sales.

### Complete snapshots and readiness (v559)

IN-Gauge returns the overall record count in `data.total`; `data.totalInList` is the number on the current page. The reader follows offsets until the overall total is reached, using unique ID ordering to avoid unstable ordering among identical update timestamps. It checks page lengths, offsets, declared totals and duplicate IDs. A count change or duplicate stops collection instead of certifying a partial snapshot. Snapshots now store pagination verification; older snapshots must be refreshed before report checks or reviewed operations.

Run completion derives readiness/apply mode and reviewed-plan hash from the job report. No caller-local variables are referenced. A browser test runs the actual selection, readiness dispatch, completed readiness, enable-Apply, simulated apply completion and selection-clearing handlers with all network/database calls mocked.


### Guided modes, mobile choices and change history (v560)

Choose **Manual upsells only**, **Automatic packages only**, or **Both**. Manual requires Journal and Reservation Detail; Automatic requires the New Reservation and Update Reservation Changes Logs; Both requires all reports. Reservation Detail remains recommended for automatic stay extensions. The main Check button fetches a complete live snapshot if the binding, dates or freshness need updating, then runs the chosen audit engines. A scope change clears selections and readiness approval. Both the UI and worker reject out-of-mode operations. Classification follows the existing audit: Pending seller requests and manually added records are manual; remaining records are automatic. An ambiguous/unmatched audit case still needs explicit review.

Hotel, department, product, contributor and status choices now use searchable in-app sheets. Original select values remain the source for validation; no native popup is required. Touch browser tests select the actual choice buttons, close both sheets and review, check width/scrolling, and complete the guided snapshot → audit → readiness → simulated apply path. These are Chromium phone-layout tests, not a physical iPhone certification.

The selected hotel's Change history loads the most recent 40 jobs, including readiness checks and financial runs. Results retain the confirmation, action, timestamp, hotel, before/requested/observed values, reason and any mismatches. Older runs fall back to their saved plan; a later complete snapshot may verify an earlier uncertain outcome without rewriting its original result. No unverified outcome is called applied. The history list can be refreshed and individual runs expanded. Full Cloud runs remain available for all run types.

Read-only inspection of an earlier uncertain edit found all reviewed financial fields correct; IN-Gauge had populated its blank memo with APPROVED. Only that exact empty-note/status-note equivalence is accepted. Explicit user notes and all financial fields remain strict. New uncertain results preserve the returned record ID, observed values and individual differences.

Product-detail reads run in groups of at most three; snapshot catalogs, contributors and records read concurrently after property verification. A scoped run reads departments only for the verified selected hotel. Immediate apply reuses only a matching preflight from the same connection, under five seconds old, consumes it once, and rereads an existing record immediately before sending. Changed or expired plans rerun preflight. Final readback, property scope, amount/seller/status checks, locks, duplicate protection and private ledger remain enforced. No financial operation was sent during development verification.

After any applied or uncertain operation, its source snapshot is invalidated in the private database and UI. Reusing it for another financial plan is blocked. The next report check automatically fetches current data; an explicit Refresh remains available for history verification.


### Private reference caching (v561)

Package catalogues and contributor lists persist under the hotel's private `ingauge/referenceCache` for up to 24 hours, separated by exact portal URL, tenant, hotel, department, account actor and industry. Only normalized reference fields are stored: no authorization headers, credentials, financial records, permissions or locks. Names, IDs, count, department and recurring flags are validated on cache reads; invalid/future/expired entries are replaced by live reads. Failed refreshes do not fall back to expired data. A cache-store failure still permits the normal verified live read. Concurrent consumers share a load, and an explicit refresh waits for an older load before replacing it.

The existing live-data refresh reuses valid reference lists and always reads sales anew. **Refresh packages & sellers** bypasses both reference caches and fetches a fresh financial snapshot in the same selected hotel. The snapshot records which lists were reused and when they were read. Readiness and apply always reread the selected package's identity, department, active status and charge rules, plus the current contributor list; a changed product invalidates its catalogue and holds the operation. Thus the full product catalogue is not scanned for each selected operation. Dynamic hotel configuration, permissions, existing-record fingerprints, accounting locks, duplicate checks and final financial readback remain live. No financial edits were sent during cache verification.


### One reviewed Apply action (v562)

The user-facing flow is review → select → confirm the reviewed values → Apply selected changes. The previous separate readiness button and prior-test-certificate gate are removed. The worker still authenticates an active owner/manager, checks the exact signed plan digest, age, hotel/department binding, complete unexpired snapshot, selected mode and operation values. `execute()` performs its live preflight before every submission; it never relies on a developer test or an old readiness certificate as financial authorization. Duplicate checks, the intent ledger, final readback, stop-on-uncertain behavior and snapshot invalidation remain in place. Historical read-only runs can still be reopened; new UI actions do not create them. Browser tests verify a reviewed selection dispatches exactly the selected apply plan directly, without first submitting a test job or reading a readiness certificate. Automated development tests run before publishing.


### Close versus cancel (v563)

Every active IN-Gauge run has **Close window** and **Cancel automation** controls. The footer stays outside the scrolling activity log on phones, and the run card also offers cancellation. Closing only hides the window; Cloud runs reopens it. Cancellation sets a durable private `stopRequested` flag with the requesting user and time, disables duplicate requests, and stops the automatic report-analysis follow-up. The UI shows Cancelling until the worker confirms a terminal result; it does not falsely report an immediate stop.

Queued cancellations exit before opening IN-Gauge. Sign-in and ordinary read requests check for cancellation (ordinary checks are coalesced for up to one second). Discovery and snapshot jobs check again before publishing/importing their results. Financial jobs check before each operation, after preflight, after ledger intent, and immediately before the actual request. A request already sent is allowed to finish readback verification despite a later stop flag; its verified or uncertain result stays in history, and the next operation is not sent. This is cancellation, not rollback. Completed changes invalidate the old snapshot as usual. Cancellation is not implemented by force-killing a browser or GitHub job during a financial write.

Tests cover closing without cancelling, reopening, durable cancellation, duplicate-click disabling, phone footer visibility with a long activity log, terminal cleanup, cancellation during preflight and before submission, retaining an already completed operation, and completing readback after a cancellation arrives during submission. All financial requests are synthetic during verification.


### Numbered audit and run steps (v564)

The page follows six sections: **1. Hotel → 2. What to fix → 3. Reports and check → 4. Review and select → 5. Run changes → 6. Results and history**. The overview navigates between sections without starting jobs or changing selections. Its current-step and status labels follow the existing state; heartbeat updates do not replace unchanged navigation controls. Review cards now precede the selection confirmation and Apply button. Hotel connection, cache refresh, report/date controls, manual requests, existing records, close/cancel and saved history remain available in their corresponding sections.

The live window has a mode-specific numbered checklist: cloud startup, sign-in, hotel access, package/seller data, sale records or live financial preflight, apply/readback, and results. Each financial change emits its preflight and apply/verification stage, and the checks repeat per selection. Concurrent reference reads are not claimed complete just because record reading has started. Unvisited or cancelled phases are not marked finished. Detailed activity is expandable, while close/cancel stays pinned below the scrolling content. These are presentation and progress updates; report matching, scoped selections, explicit approval, financial checks and cancellation behavior are preserved.


### Neorcha-style live console (v565)

The IN-Gauge run window follows Neorcha's compact cloud card: gradient cloud icon, blue/indigo progress bar, green finished steps, indigo current step, status note and a dark terminal with three coloured window dots. Its own scoped styles work without opening Neorcha first. The terminal shows escaped timestamps/stage labels and status lines, a live cursor only while running, and explicit finished/cancelled/error messages. Result lines mask confirmations; complete values remain in the existing review/history panels. No credentials or new provider data are added to progress.

Show/Hide persists per device and controls only presentation. Logs follow new activity while at the bottom, preserve position when reading older lines, and keep their nodes on heartbeat updates. Elapsed time updates its text node without rebuilding controls. Header Minimise keeps the run chip; Close hides it while preserving the run in Cloud runs. Both keep the job running. The separate safe-cancel control stays pinned in the phone footer. Financial matching, approval, cache and worker cancellation logic are unchanged. Browser checks cover Show/Hide across updates, safe rendering, follow/scroll preservation, stable heartbeat controls and minimise/close versus cancellation.


### Simpler package editing and less repeated work (v566)

The main page has three actions rather than six setup sections. Edit a package is the default; Check Opera reports retains the full audit workflow. Hotel setup and older change history are collapsed. A fresh complete snapshot can be searched repeatedly without another cloud run. A needed data fetch returns directly to the matching rows, with no extra Continue click. Changing task preserves staged edits; changing the manual/automatic scope still clears the review as before. Save & select automatically selects only a validated draft and clears the final review approval, so it never submits by itself. Batch several edits before Apply to reuse a single cloud sign-in. Common edit fields stay visible, and prefilled dates/room/memo remain editable under Stay, room and notes. The final selected preview repeats the exact hotel and values.

Search indexes record, product and contributor lookups per snapshot. It debounces typing for 90 ms, preserves the input/focus, and initially renders 20 matches with Show more. Old result controls are disabled while a new filter is pending, preventing a stale-row click. Cancelled record edits are not inserted into the draft map; reopening a saved draft uses its latest values. Record editing and selection controls are locked during an active automation and stale snapshots must be found/refreshed again before editing. This prevents a run's verified result from being applied to a newer unsent draft with the same record key.

Independent private reads at startup run in parallel; older history is queried and rendered only when opened. Cloud dispatch sends the signed job directly, skipping a redundant workflow-read request. After exact property verification, live settings and permission reads run together. Accounting-lock and duplicate probes also run together; both holds remain mandatory, with no financial request on failure. No dynamic permission or financial check has been replaced with stale cached data. Tests cover a direct search/edit with no Opera reports, saved/cancelled/batched edits, current-value reopening, bounded search DOM and stable input, lazy history, read-only automatic refresh, active-run edit locking, and both lock/duplicate/property guards under parallel reads. No real financial requests were sent during development testing.

## Saving without page navigation (v572)

Save & select retains the current records, pending or suggested-changes tab, search and loaded list limit. It updates the saved draft and selection count without scrolling to Apply. The entry page and ancestor scroll positions are restored, including nested scroll containers, and focus returns without scrolling. Cancel restores the same entry context. A saved-selection toast provides feedback; users navigate to Apply when ready. Financial validation and seller-confirmation gates are unchanged.

`node tests/ingauge-save-position.browser.test.js` verifies desktop and phone saves in document and nested scrolling across all three views, including list/search/selection retention and zero external requests.

## Focused task screens (v573)

The workspace opens on Monthly totals. Three navigation choices separate Monthly totals, Review & fix and Find a sale; switching tasks preserves saved selections and does not start a job. The old duplicated step navigation is hidden.

Monthly totals shows journal upload and Compare totals, monthly amount bars, pending amounts when present, and visible report-scope checks. Extra daily charts, detailed tables, code mappings and scope choices are disclosures. A read-only monthly refresh is blocked while saved selections are waiting, preventing that refresh from silently discarding edited drafts. The next action opens individual-sale review without submitting changes.

Review & fix shows required reports and compact scope choices. Report/date settings collapse after analysis; held and ready cases remain distinct, with bulk selection next to the proposals. Find a sale keeps direct search visible and places dates/type/refresh controls in Search options. Saved Apply controls appear only for selections or relevant Apply activity, and saving still preserves tab/search/scroll. Common errors and compact run status remain accessible from every screen; monthly fetch results return to Monthly totals. Hotel setup opens when unlinked and stays tucked away once linked.

The presentation changes do not weaken seller confirmation, reviewed-plan validation, identity matching, duplicate checks or live financial safeguards. `tests/ingauge-simple-ui.browser.test.js` covers task separation, draft retention, contextual Apply, desktop/phone layout and no external actions from navigation.
