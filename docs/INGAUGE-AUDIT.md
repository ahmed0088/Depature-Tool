# Reviewed IN-Gauge audit

Open **Package Audit → IN-Gauge automation**. An owner or manager links the current HotelOps space to an exact accessible IN-Gauge property and Front Desk department. The account's products and contributors are discovered at runtime; names and numeric IDs are not embedded in the application. The portal URL is editable within the verified IN-Gauge HTTPS provider.

1. Upload Opera Journal and Reservation Detail for manual sales. Add Opera Changes Log to audit automatic packages.
2. Choose the audit period and fetch live IN-Gauge records. Complete pagination includes Pending, Approved, Denied and other statuses. An IN-Gauge Excel report is optional when a live snapshot is available.
3. Check reports and review the proposals. Existing Audit and Manual sales tabs retain their evidence and fallback uploads. Notes identify the seller before the posting user; disagreement remains visible. A posting-user fallback requires explicit assignment. Ambiguous identities, repeated-letter spellings and unidentified products require review.
4. Review each proposed change, then select the changes to apply. Existing records can be edited or have their product/contributor replaced in place. Pending requests can be approved or denied. Removal requires a reason. Existing Pending and denied requests are considered when checking for duplicates.
5. Confirm the reviewed selection and **Check readiness**. This checks the live hotel, permissions, catalog, contributors, record version, duplicates and period lock without financial writes. **Apply selected changes** is enabled only for the same recently tested plan. Every submitted operation is reread and checked against the proposed final record.

## Calculation and ownership

The existing Package Audit rules, extension credit, historical ownership, manual requests and pinned decisions remain in use. Live contributor IDs improve identity matching; an explicit optional alias can be saved to this hotel's private staff settings. An inactive historical contributor can be preserved, but new credit cannot be assigned to an inactive account. Unsupported Opera product families are held for mapping review.

Totals follow the property's live validation setting. Daily `BUSINESS_DATE` entries use the reviewed daily charge; they do not multiply it by charge days, including recurring room products. Breakfast, board and room products use verified catalog entries. Unknown products and ambiguous room types are held until assigned explicitly. An aggregate Opera journal line alone does not establish a per-person breakfast quantity.

## Limits and uncertain outcomes

Ordinary operations exclude locked, invoiced, adjusted, removed and post-lock records. These need IN-Gauge's dedicated adjustment workflows. Retail and F&B departments have a different quantity model and are excluded. Batches contain at most 100 selected changes; snapshots expire after six hours and readiness checks after 15 minutes. Each reviewed plan also expires after one hour.

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
