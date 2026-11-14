# Accor enrolment diagnosis and validation

The cloud workflow uses the Accor Loop portal at secure.guestinternet.com. The copied ALL Enroll v19 PC script uses fc.accor.net. These are separate portal workflows. The PC script reports an invitation as submitted; that status alone is not independent confirmation of an active membership. A standalone Accor Loop PC extension may use GuestInternet too; its exact build and one paired failed/successful case are needed before asserting the cause of a difference in portal acceptance.

Read-only review of the latest recorded cloud run on 12 November 2026 (43256466819) found 225 processed: 140 already-member responses, 44 explicit HTTP400 responses containing email undeliverable, 33 blank-country skips, 7 Türkiye country-name mismatches, and one name skip. The process did not crash, and no new memberships were confirmed in that run. A backend email rejection does not by itself prove why the same address succeeds through another browser or portal.

## v577 corrections

The Country selector compares normalized exact names and verified equivalences, including Türkiye/Turkey, Libya's old official name, Eswatini/Swaziland and Burkina Fasa/Burkina-Faso. A committed alternate label is accepted as the same country. Fuzzy overlap cannot select a different country such as Guinea-Bissau for Guinea, or DR Congo for Congo. Unknown or ambiguous input stays held; missing countries are never guessed.

A missing country is reported before navigation/form entry. Test-only mode validates both title and country controls, and stops before typing guest data or submitting. Intentionally blocked media/font/image requests no longer replace the current run status with a network warning; genuine script/API failures remain visible. Summary buckets are mutually exclusive, so skipped exceptions cannot be counted twice.

The interface distinguishes a missing country from a portal email rejection. It does not automatically change an address, mark a rejection successful or retry an uncertain result. Agreement, civility, known-member exclusions and the selected-guest list remain enforced. Development tests use synthetic pages only; no live guest enrolments were attempted.

The cause of the 44 portal email rejections remains unverified against the working PC flow. Compare the same reviewed guest, exact portal link and working script/extension before making an infrastructure or data-quality claim.


## v580: accepted responses lost during portal reload

Mercure run [43506981104](https://github.com/ahmed0088/Depature-Tool/actions/runs/43506981104) processed 26 guests and reported 0 enrolled, 19 already members, 5 email errors and 2 name skips. Its public trace contains seven `/accor/enroll` HTTP 200 responses immediately followed by navigation, resumption at the same guest index and another submission that returned already-member. The original response bodies were not retained, so this diagnosis does not independently establish active membership for those guests or rewrite their old history. It establishes a replay/reporting bug. The working PC extension uses the same GuestInternet portal according to the user; a same-guest comparison remains necessary to explain its acceptance of an address rejected by the cloud.

The worker now writes an in-flight receipt before clicking Submit. Response interceptors synchronously preserve its result in session storage and mirror it to extension storage, without storing response bodies or returned account tokens. A receipt is bound to run timestamp, list index, confirmation and email. After reload, the current guest's receipt is recovered and its result persisted before clearing the receipt, without another submission. A missing response is `submission_uncertain`, never an implicit safe retry or an inferred success. Such records are classified for review and excluded from automatic bulk selection. Late responses cannot be assigned to a different current guest. Explicit email/already-member/validation responses preserve their outcomes, including application rejections carried by HTTP 200. Server errors with an uncertain outcome stay held. Disabled submit buttons now produce a recorded non-submission error rather than disappearing from the processed count.

The five HTTP 400 email-undeliverable responses in the recorded Mercure run are distinct from the reload bug. They do not prove the addresses are bad. The two name skips happened before submission because no usable first/family-name pair remained after normalization. The fix does not invent replacement guest names, change addresses or retry live guests as a test. Existing history is retained.

Tests: `node tests/accor-receipts.test.js` checks durable recovery, run/guest identity, uncertain holds, rejections, stale responses and tracker selection. `node tests/accor-reload.browser.test.js` recreates immediate redirects after real XHR responses against a synthetic portal and checks exactly one request and one result per guest. It also tests navigation before the response and ensures no response tokens are persisted. No live enrolment submissions are used for development validation.


## v581: actionable review and long-running batches

Completed run [43529862471](https://github.com/ahmed0088/Depature-Tool/actions/runs/43529862471), at 03:50 Dubai time on 14 November 2026, processed 15 guests: 3 enrolled, 7 already members, 3 explicit email-undeliverable responses and 2 blank-country skips. The 3 accepted responses were recovered after navigation without submitting again. The v580 reload fix is therefore observed working in a live run, while the portal rejections remain separate.

The next run, 43530382828, has 726 guests. A read-only progress check at 04:07 Dubai time found 109 processed: 38 enrolled, 65 already members and 6 errors. No guest data was published and the run was not changed or restarted. The previous 70-minute workflow allowance and iteration-based worker cap could be insufficient for this batch size. The current job continues with its original v580 code; the new run controls apply to future runs.

Review details now lets the user explicitly correct a name, personal email, phone or country in the enrolment sheet. It does not edit Opera or Neorcha source cards. Edits are kept in the device draft, bound to the source guest fingerprint and HotelOps hotel. A changed name or address clears Agreed; a country correction retains existing agreement for that same recipient. A different source guest on the same confirmation, changed source details or another hotel cannot inherit the correction or agreement. Unsaved editor fields and the portal link survive a sheet repaint. Personal-email/OTA validation remains enforced and an address correction is never silently inferred by the editor.

Cloud start/restart sends only selected consenting guests with a country and excludes known members. Selected guests missing a country are visibly held before dispatch, with the held count in the confirmation and sheet. They remain available for correction. The PC copy path retains its existing behavior. Country normalization accepts ISO region codes through Intl.DisplayNames and verified aliases, including AE/IN/DE/TR and NA for Namibia; N/A remains a missing marker. Unknown or ambiguous countries still must match a real portal option before submission.

The tracker recognizes success/success_stuck/submitted and both already_member/already-member forms. Previously the tracker treated cloud successes as not sent because it counted only legacy PC status names. Unknown outcomes are displayed under Needs review.

Future cloud jobs have a 240-minute workflow cap, with a bounded wall-clock worker budget (30–210 minutes based on batch size). HotelOps authentication renews before expiry, shares concurrent refreshes, and retries a refused database request once after renewal. Completed results are checkpointed to the existing tracker as progress advances; duplicate polls do not repeat writes, failed checkpoint writes remain eligible to retry, and diagnostic-only jobs never write enrolment results. Partial per-guest reports are available during a run and are retained on an ordinary runner error. This does not guarantee delivery when Accor refuses a submission or during a hard infrastructure loss.

Validation: accor-review.test.js checks tracker accounting and country holds; accor-review.browser.test.js covers desktop/phone editing, agreement reset, source/hotel isolation, input retention, invalid/OTA addresses and ready-only dispatch with mocked external actions. accor-long-run.test.js checks the time budget, token renewal/concurrency, refused-session recovery, idempotent checkpoints and diagnostic non-writing. Existing country/receipt/reload tests remain. Development verification does not submit live guests or rewrite previous run outcomes.


## v582: named hotel enrolment links

The enrolment sheet and workbench now have a Hotel enrolment link selector. Paste the complete GuestInternet URL, give it a hotel name, and press Save hotel link. A saved choice fills the exact URL and collapses the editor. Edit its name/link or remove it from the same control. Choose the placeholder option to clear the old destination and paste a one-time link; naming/saving is optional for that path.

Profiles are cached per HotelOps space in `gp_enrolment_links_v1:<hotel id>`. The selected profile is a device preference. Connected profiles sync as individual `enrollPortalLinks/<profile id>` entries in that space, preserving unrelated colleague entries. Offline profiles and deletion markers remain local until they can sync; a failed save reports that team sync is unavailable. Scoped legacy single links remain usable and can be saved under a name. The component never adopts a different space's global legacy fallback. Shared legacy data fills an untouched empty selection only; it cannot overwrite typing or an explicitly cleared choice.

Only HTTPS links on secure.guestinternet.com without embedded username/password or alternate ports are accepted for saved profiles. The exact supplied query and fragment are retained; hotel-specific parameters are never regenerated. Cached/shared entries are validated, names are escaped and duplicate names are rejected during Save. No placeholder/example URLs are preconfigured as actual hotel destinations.

The picker is available directly in Enrol guests, with the same controls under Guest Pipeline's More options. It preserves selected guests, agreement ticks, unsaved review fields and the portal editor through review repaints. Selecting a profile does not dispatch a job. The selected name is included in the existing start/restart confirmation and stored with the captured job destination. The cloud preserves that name in live metadata. Later profile selection/editing never rewrites the active job's captured URL.

Tests: enrolment-links.test.js checks URL fidelity and validation. enrolment-links.browser.test.js checks phone/desktop save/select/edit/remove, fresh-page persistence, cleared destinations, workspace isolation, offline/per-entry sync, unchanged guest agreement, confirmation labels and exact frozen job URLs. External actions are mocked. The optional component leaves the original paste field available if the new script cannot load; the service-worker shell includes the new script.


## Live progress recovery (v583)

A portal navigation can destroy Playwright's evaluation context between polls. An unavailable snapshot is not an empty result list: the runner retains its longest confirmed result checkpoint, publishes a coherent processed count/report/tally, omits unknown fields, and uses that checkpoint if the final browser read is temporarily unavailable. Missing or shorter results never erase confirmed outcomes; an incomplete checkpoint is still reported as partial.

The live window merges sparse same-run updates, ignores older timestamps and delayed prior-run reports, restores compact counts from `gp_enrol_progress_v1:<hotel id>` or the matching cloud history record, and never borrows another run's or hotel's figures. The device cache stores only run identity/timestamps/counts, expires after 24 hours, and contains no guest details or portal link. A late history snapshot also restores totals and the correct run number/link. Unavailable totals stay visible as dashes, with a reconnect explanation rather than a false zero. A guest position can restore only the processed-position display; it does not fabricate outcome counts.

The window reconciles existing nodes when actual content changes. The one-second timer updates elapsed time without replacing the modal body, spinner, action buttons or category rows. Opening a category, hiding the console, focusing Stop, scrolling and reopening the window preserve their state. Starting again replaces the prior live record so stale reports are not inherited. Read-only GitHub status matching uses the exact dispatch tag or recorded run URL rather than a nearby creation time.

Validation: `tests/accor-progress.test.js` covers navigation gaps, regressed checkpoints, final fallback, report-derived counts and new-run resets. `tests/accor-progress.browser.test.js` covers phone and desktop full reloads, missing metrics, late history hydration, run/hotel isolation, no modal child replacement during elapsed ticks, preserved focus/scroll/category nodes and closing/reopening. External writes and invitations are mocked.


## Authorized UAE country fallback (v584, current policy)

The user explicitly requested using UAE when the source country cannot be found. This supersedes the earlier missing-country hold. Cloud selection still requires a usable email, guest agreement and title, excludes known members/completed or uncertain submissions, and preserves the guest's original source country. Missing countries remain selected with a visible “UAE fallback” label. The existing run confirmation explains the fallback; no additional confirmation step was added.

The shared worker first selects the source country using the existing exact/alias matching. If missing or unmatched, it makes one explicit attempt to select and verify `United Arab Emirates`. It never infers a country from a person's name or silently picks another available option. If the UAE option cannot be committed either, nothing is submitted for that guest and the reason states that the fallback was unavailable. Diagnostics exercise the same country choice without entering guest details or submitting.

A private `countryAudit` object records the original country, selected country, fallback flag and reason. It is included in submission receipts so a redirect does not lose the decision or cause another submission, per-guest worker results, cloud reports, checkpoints and the final tracker. The live guest card, result category details, tracker and run summary expose the fallback. Existing result statuses and mutually exclusive counts remain unchanged. Existing workers keep the code they started with; the new behavior applies to future cloud jobs.

Verified with exact country/alias preservation, missing and unmatched fallback cases, misleading names such as Guinea/Guinea-Bissau, UAE unavailable, one simulated submit per successful selection, diagnostic no-submission, receipt recovery, tracker/report propagation, phone/desktop review and visible per-guest fallback details. Browser fixtures and simulated submissions do not contact a live enrolment endpoint.
