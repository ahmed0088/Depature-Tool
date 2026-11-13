# Accor enrolment diagnosis and validation

The cloud workflow uses the Accor Loop portal at secure.guestinternet.com. The copied ALL Enroll v19 PC script uses fc.accor.net. These are separate portal workflows. The PC script reports an invitation as submitted; that status alone is not independent confirmation of an active membership. A standalone Accor Loop PC extension may use GuestInternet too; its exact build and one paired failed/successful case are needed before asserting the cause of a difference in portal acceptance.

Read-only review of the latest recorded cloud run on 12 November 2026 (43256466819) found 225 processed: 140 already-member responses, 44 explicit HTTP400 responses containing email undeliverable, 33 blank-country skips, 7 Türkiye country-name mismatches, and one name skip. The process did not crash, and no new memberships were confirmed in that run. A backend email rejection does not by itself prove why the same address succeeds through another browser or portal.

## v577 corrections

The Country selector compares normalized exact names and verified equivalences, including Türkiye/Turkey, Libya's old official name, Eswatini/Swaziland and Burkina Fasa/Burkina-Faso. A committed alternate label is accepted as the same country. Fuzzy overlap cannot select a different country such as Guinea-Bissau for Guinea, or DR Congo for Congo. Unknown or ambiguous input stays held; missing countries are never guessed.

A missing country is reported before navigation/form entry. Test-only mode validates both title and country controls, and stops before typing guest data or submitting. Intentionally blocked media/font/image requests no longer replace the current run status with a network warning; genuine script/API failures remain visible. Summary buckets are mutually exclusive, so skipped exceptions cannot be counted twice.

The interface distinguishes a missing country from a portal email rejection. It does not automatically change an address, mark a rejection successful or retry an uncertain result. Agreement, civility, known-member exclusions and the selected-guest list remain enforced. Development tests use synthetic pages only; no live guest enrolments were attempted.

The cause of the 44 portal email rejections remains unverified against the working PC flow. Compare the same reviewed guest, exact portal link and working script/extension before making an infrastructure or data-quality claim.
