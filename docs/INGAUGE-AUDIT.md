# Reviewed IN-Gauge audit

Open **Package Audit → IN-Gauge automation**. An owner or manager links the current HotelOps space to an exact accessible IN-Gauge property and Front Desk department. The account's products and contributors are discovered at runtime; names and numeric IDs are not embedded in the application. The portal URL is editable within the verified IN-Gauge HTTPS provider.

1. Upload Opera Journal and Reservation Detail for manual sales. Add Opera Changes Log to audit automatic packages.
2. Choose the audit period and fetch live IN-Gauge records. Complete pagination includes Pending, Approved, Denied and other statuses. An IN-Gauge Excel report is optional when a live snapshot is available.
3. Check reports and review the proposals. Existing Audit and Manual sales tabs retain their evidence and fallback uploads. Notes identify the seller before the posting user; disagreement remains visible. A posting-user fallback requires explicit assignment. Ambiguous identities, repeated-letter spellings and unidentified products require review.
4. Review each proposed change, then select the changes to apply. Existing records can be edited or have their product/contributor replaced in place. Pending requests can be approved or denied. Removal requires a reason. Existing Pending and denied requests are considered when checking for duplicates.
5. Confirm the reviewed selection and press **Apply selected changes**. The same cloud job checks the live hotel, permissions, selected package, current sellers, record version, duplicates and period lock before each financial operation. Failed cases are held with an explanation. Every submitted operation is reread and checked against the proposed final record. There is no separate test step for the user.

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
