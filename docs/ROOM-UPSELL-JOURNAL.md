# Room-upsell journal recognition (v586)

The provided Opera report identifies transaction **1010** as **Upgrade / Upsell Fee**. It contains the incremental upsell fee, not the whole room rate. The monthly reconciliation maps 1010 to the ROOM family by default, sums debit minus credit in integer cents, and retains transaction IDs, posting dates and booking evidence. Explicit chart mappings still override the default.

Entries with `[NA Pkgs.…]` in the note/reference stay with automatic packages and the Changes Log audit. Other 1010 entries participate in the manual-sale comparison. The report's posting user does not establish the original seller of an automatic package. Manual seller credit follows the existing notes-first rule, with the posting user exposed as a fallback requiring review when no seller is named.

Room product names, USS codes, 1010 and the Room upselling label share the same comparison family. An approved or pending room request is checked before suggesting a missing sale. A room request on another business date is held for review because it may cover multiple nights. A journal posting is not multiplied by reservation nights or used to infer a tax conversion. The exact room product remains unselected when multiple active products match the family. Existing mismatches, reversals, ambiguous reservations, missing coverage and seller conflicts remain review items.

Upload the journal with 1010 included, Reservation Detail covering the postings, and refresh the complete live IN-Gauge snapshot. The monthly chart can include 1010 without Reservation Detail, but booking matches and missing-sale claims still require reservation evidence. A code mapping cannot prove report coverage or that a sale is absent from IN-Gauge. Review and select financial changes before running automation.

Validation uses synthetic parser, matching, pending, reversal, product-ambiguity and monthly-scope tests. The supplied private journal was also parsed locally: 697 transactions, including 233 code-1010 postings (230 automatic markers, 3 unmarked); November room-upsell fees net to AED 3,596.00. Guest data and the private source report are not committed.
