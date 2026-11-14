# Reviewed money reconciliation (v589; selection queues v590; pending/product review v591)

Open **Monthly totals → Explain the difference → Fix the money differences**. The cards show the confirmation, posting date, Opera net amount, approved and pending IN-Gauge amounts, why they differ, and the proposed remedy. Posting evidence includes transaction IDs, notes, cashier/login, matched stay and existing record IDs. Relevant Changes Log entries explain customized fees; the journal supplies the posted amount.

Choose **Review correction** or **Review missing sale**, verify the evidence in the existing package editor, and **Save & select**. For ambiguous bookings choose the owning confirmation first. **Review selected changes** opens the existing reviewed cloud apply screen, including the projected change in approved revenue. The usual automation console, cancellation and saved results are reused. Preparing or saving a review does not change IN-Gauge.

## Selected and remaining queues

Saving a valid reviewed correction moves its case out of **Remaining to review** and into the compact **Selected for automation** list. Saved changes can be edited or unselected from that list. Unselecting restores the case; canceling an edit preserves the selection. The duplicate-fee case remains until its keeper and all extra entries have decisions, with each already selected decision labeled on its own row. A keeper that already has the correct approved amount/date does not require a redundant edit.

Selection never changes the snapshot, financial totals or remote records. Pending additions still await approval. Invalid or stale selections cannot hide unresolved cases. When a real run invalidates its snapshot, cached correction cards are discarded until fresh complete data is read. Final outcomes remain in run history. The phone/desktop tests cover these transitions alongside the existing mocked cloud handoff.

## Matching and proposals

- Match the normalized full guest name, room and active reservation stay, including Opera's DUOT status. An explicit room-routing reference can connect the source and billing rooms. Automatic night postings use arrival ≤ posting date < departure when that uniquely resolves adjacent stays. Manual overlaps require a confirmation choice.
- A single positive same-currency posting and single existing daily record can produce an amount correction. Preserve the existing contributor ID, stay dates and charge days. Use the posted daily amount; do not infer tax conversions or multiply it by the whole stay.
- A missing manual sale becomes a reviewed addition, Pending by default. A uniquely resolved name in the note takes priority over the posting user. Otherwise the posting user is a suggestion. Both paths require explicit credit confirmation and show who posted the fee. Other dates' package owners are context, not automatic ownership of an extra manual charge.
- Reuse existing pending, denied or unidentified requests. Matching pending requests can be approved through the existing approval workflow. Reopening a denied request requires a reason. Do not create another sale to bypass either state.
- For a one-off early/late fee with several entries, the reviewer chooses the keeper and each extra entry. Correcting the keeper and denying an extra are separate selected operations. Denial requires a reason. Only one keeper is allowed. Known denied extras remain review evidence until the keeper is corrected; a completed cleanup does not reappear.
- Currency differences, reversals, split postings, uncertain identities, missing automatic imports and stay-based calculations remain billing checks. A room/date/amount match without verified reservation identity does not authorize an addition or denial. Older one-off requests remain history.

## Pending approvals and existing product corrections (v591)

Pending revenue is shown next to the approved total, with the number of existing requests awaiting review. Approval uses the existing record; it is never a duplicate addition. If an exact `Opera journal <transaction ID>` memo links one Pending entry to one of several candidate stays, the difference list offers a booking-review approval. The editor names the existing confirmation and alternative candidates. The reviewer must verify the bill before acknowledgement; approval preserves the existing confirmation. An incorrect booking identity must be corrected through the appropriate IN-Gauge workflow, not silently reassigned by this action.

An exact journal-reference memo also finds a fee saved under another known product family. With one current-period record on the same confirmation and day, offer a product correction on that record, preserving seller, status, dates and amount. Several linked entries, another confirmation/date, denied requests or unsupported identity remain held. Matching amounts alone never establish a cross-product replacement.

Journal-derived proposals carry the mapped product family and transaction codes. The editor limits choices to that family, and the shared core rejects a different family before portal or ledger access. Update the transaction-code mapping and re-review if the mapping itself is wrong. An exact, unique Opera room-type SKU match in the verified room-product catalog preselects the matching room product. Conflicting or unknown codes leave multiple room products for an explicit reviewer choice. Existing non-journal edits and older reviewed plans retain compatibility.

An addition is blocked if its exact source transaction already appears in any saved record memo. Live duplicate preflight also checks that reference across product families. Do not bypass the source transaction ledger to retry an already processed sale; correct its existing record instead. Tests cover wrong-product corrections, exact ID matching, late-arriving duplicates, manual-audit family guards, ambiguous source-linked approval and unchanged source records on phone/desktop.

## Scope and execution

Use a fresh complete snapshot for the same hotel, department and dates. Financial actions use the intersection of the chart month and explicitly selected audit period. Uploads and snapshot restore cannot widen that period. Sources are rechecked when a card is opened; a changed hotel, report or snapshot requires a fresh review. Manual, automatic and combined modes remain available.

The shared core checks original/proposed posting dates, snapshot ID, verified journal evidence, review acknowledgement, seller confirmation, amount consistency and existing permissions before a cloud request or intent ledger. Changing the proposed amount away from the journal requires an explanation. Private reconciliation evidence stays in HotelOps review/history and is omitted from IN-Gauge payloads.

Portal duplicate preflight has one narrow exception: a reviewed one-off keeper correction may coexist with the exact reviewed extra record IDs, with unchanged fingerprints or a verified denied/purged state. New, changed or unrelated duplicates still stop execution. Each selected operation retains the normal fresh-read, hotel binding, accounting lock, fingerprint, result verification and idempotency checks. An uncertain result stops for review instead of being retried blindly.

Pending additions do not reduce the approved-revenue difference until approved. Matching totals alone do not establish the right seller, complete report coverage or a correct billing allocation.

## Verification

`tests/ingauge-reconciliation.test.js` checks quantity/custom fees, exact IDs and unchanged dates, named notes versus poster fallback, required seller review, pending/denied reuse, booking selection, routed rooms and night boundaries, one-off keeper/extra plans, actual portal preflight wiring, partial-run recovery, old periods, reversals, split amounts and no requests from unchecked evidence. `tests/ingauge-reconciliation.browser.test.js` exercises the complete phone/desktop review → selection → mocked cloud-dispatch flow, including the combined evidence acknowledgement, denial reason, approved-revenue projection and unchanged source records. Fixtures use synthetic hotels and guests; no real financial action is performed.
