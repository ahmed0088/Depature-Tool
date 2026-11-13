# Monthly Opera / IN-Gauge reconciliation

Open Package Audit → IN-Gauge automation → Monthly totals. Choose the month, upload the Journal by Transaction Code, and press Compare totals. Review & fix opens the report audit; Find a sale opens direct search. Reservation Detail / Changes Logs remain required by the existing audit rules when preparing changes; they are not posting-revenue reports and cannot establish monthly posted totals.

The default comparison includes both manual and automatic sales. Opera uses the posting business date and debit minus credit, including reversals. IN-Gauge uses each record's `totalCents` once, by business date, without multiplying unit charge by nights. Approved revenue and pending requests are separate. Denied/deleted/purged records are excluded. The primary difference is Opera less approved; a secondary figure shows the difference after pending. A difference is evidence to investigate, never an automatic add instruction.

Default transaction families: 1061 early check-in, 1062 late checkout, 2090 breakfast. Review these against the hotel's transaction configuration. Additional codes (including room upsells) need explicit mapping to a supported product family or exclusion as unrelated revenue. All approved/pending IN-Gauge totals are retained within the chosen scope, including unclassified products; missing Opera family mappings are flagged for review. No tax conversion or currency conversion is inferred. Confirm the journal belongs to the named hotel, covers the selected period and uses a compatible net/tax basis before treating matching totals as meaningful. Journal completeness cannot be proved from the dates of its postings alone.

A current month is month-to-date in Asia/Dubai; closed months cover the entire calendar month. Live snapshots must match the exact HotelOps hotel, portal, tenant, property and department, have verified pagination, and cover the posting period. Invalidated / partial data are provisional. Missing values, conflicting duplicate transaction/record IDs, mixed hotel records and invalid totals stop the comparison. Identical duplicate IDs do not double count. Unsupported currencies/dates/statuses are excluded and reported. Every plotted day is populated, including zero-posting days. Exact amounts remain available in a horizontally scrollable table.

Mappings and scope changes apply to this session's chart only. They do not modify matching rules or financial records. The existing Apply workflow still requires review and live safeguards. Code mappings reset on hotel switch; journal/period/mapping/scope changes reset the report confirmation. A new snapshot must be fetched after applied/uncertain changes before treating the comparison as current.

Tests: `node tests/monthly-tally.test.js`, `node tests/monthly-tally.browser.test.js`. Browser tests use synthetic records only and verify graph values, pending separation, mapping, scope, month fetch, invalidation and phone table sizing.

## Performance and edge cases (v570)

Catalog product codes are indexed by ID once before reading records, avoiding one catalog scan per unfamiliar product label. A synthetic local Node benchmark (10,000 Opera postings, 10,000 IN-Gauge records, 5,000 catalog products, every record requiring fallback) took approximately 88 ms with the index, versus 816 ms with the previous lookup. This measures calculation time on the development machine, not phone performance or cloud sign-in/fetch latency.

A single-day current-month chart uses a finite centered x-coordinate. Denied/purged/deleted records and unsupported statuses are handled before product mapping warnings; excluded unknown products cannot falsely keep the comparison in scope review. Tests cover excluded amounts, warning relevance, approved/pending catalog fallback and first-day chart coordinates in a mobile browser.


## Independent hotel selection (v574)

Monthly totals follows the selected IN-Gauge target, without requiring a matching HotelOps space. A different portal, tenant, property or department resets the comparison controls and uses that target's locally uploaded Opera Journal and live snapshot. Another hotel's legacy journal is never used as a fallback. Switching targets clears loaded report sessions; upload the intended hotel's Journal again before comparing.


## Explain a revenue difference (v578)

Seller-credit corrections do not necessarily change posted/approved amounts. A negative main difference means approved IN-Gauge revenue is higher than included Opera postings. The new explanation uses exactly the included journal and snapshot rows behind the headline, with the same scope, dates, currency, transaction mappings, exclusions and duplicate guards. Product/date summaries show the five largest contributions; booking groups show the largest gaps first. Zero overall difference can still contain opposing booking/date differences.

Add Reservation Detail directly in Monthly totals to identify confirmations. An explicit journal confirmation is retained. Otherwise a match requires the normalized full guest name, room and an inclusive arrival/departure date match from an eligible reservation, with exactly one confirmation. Duplicate reservation rows for the same confirmation do not create ambiguity. Overlapping stays/extension boundaries with different confirmations remain unresolved. No room-only or fuzzy-name match is guessed. Source names, rooms, transaction IDs/codes/amounts and IN-Gauge IDs/products/statuses/sellers/amounts remain visible. Pending requests never become approved revenue and are called out before considering a new sale. Same-booking/product entries on other business dates are identified for date-allocation review, without moving the amounts.

The actual first/last observed posting dates are evidence only. When the last observed posting precedes the comparison end, the screen asks the user to check export coverage; it cannot infer completeness from posting dates. Missing source-side matches, net-zero reversals and multiple approved entries get distinct explanations. No missing match alone proves a duplicate or authorizes a financial change. Net/tax basis and hotel scope still require review.

Download full breakdown exports every included evidence group (including equal amounts), while the screen initially renders 20 nonzero/pending groups and expands in place. CSV includes the exact component amounts, identities and explanation, uses real numeric negative amounts, quotes text and protects formula-leading text. No data is sent to IN-Gauge by explaining or downloading. Reservation reports and the current snapshot stay within their existing selected-target context.

Validation: `node tests/monthly-difference.test.js` checks headline/evidence sum invariants, unique/ambiguous booking matching, reversals, pending requests, split entries, date allocation, scope, coverage and CSV. `node tests/monthly-difference.browser.test.js` checks phone/desktop layout, source details, CSV download, read-only behavior, visual settings and in-place list expansion. These use synthetic data; the user's current private journal/snapshot is not available to the development tests.
