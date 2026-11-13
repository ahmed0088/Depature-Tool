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
