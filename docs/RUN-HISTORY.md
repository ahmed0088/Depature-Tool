# Cloud run history

History is the default view. Active and All are separate views. Filter by run start date (Asia/Dubai, inclusive From/Through), tool and outcome. Today, 7 days, 30 days and All dates are shortcuts. Results paginate in groups of 30; metadata is no longer automatically deleted after 60 records or 45 days.

Explicit `done`, `error` and `stopped` reports determine final outcomes. A run with no heartbeat for 20 minutes is **Unconfirmed**, not assumed successful, failed or safe to repeat. Unknown end times have no advancing duration. A completed GitHub workflow without a final application report is also unconfirmed; workflow failure or cancellation is labelled with an explicit warning that the business outcome must be verified. No reconciliation operation submits or retries business changes.

Refresh status reads the exact per-tag IN-Gauge/manual-sales job, or a validated repository run URL. It never assigns a newer singleton report to an older job. Calls are batched, refreshes have a 30-second cooldown, and hotel reference changes invalidate in-flight reconciliation. Known terminal records reject late progress reports.

Neorcha and Accor Loop now patch `cloudRuns/<tag>` independently of the browser. The shared writer retains only compact metadata, throttles progress, always flushes terminal reports, and serializes writes so progress cannot overwrite completion. It never copies guest rows or console contents. Existing IN-Gauge history includes operation mode and explicit final time without erasing hotel metadata with empty values. A worker forcibly killed before publishing its last report can still have an unconfirmed application outcome.

Neorcha workflow titles include their tag and the client matches that exact tag instead of guessing by dispatch time. Legacy records without a final report or exact workflow link remain unconfirmed.

Verification: `node tests/run-history.test.js` covers stale/terminal states, date boundaries and durable metadata privacy/order. `node tests/run-history.browser.test.js` uses only synthetic data and checks mobile filters, archive retention, focus stability, live actions and dismissal. No live financial changes are used in tests.

## Quality pass (v568)

Search accepts run numbers (including #), hotel, account, starter and tool names. Reset clears all filters except the selected view. Invalid date ranges show an inline error and no results. Preview records explicitly state that they submitted no changes; malformed or future heartbeat timestamps cannot create a permanent live run.

Status refresh reports unverifiable outcomes without discarding the saved record. Repeated clicks during the 30-second cache window show when refresh will be available. Private reads have a ten-second timeout. A hotel reference change resets the refresh cache; stale in-flight reads still cannot update the next hotel.

The dialog traps keyboard focus, Escape closes only the open history, focus returns to the opener, and background scrolling is restored. Filters scroll separately on short screens so run results remain visible. Timer ticks update elapsed text only; a scheduled freshness boundary or real data change updates the list.
