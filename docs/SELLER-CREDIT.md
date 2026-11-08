# Seller credit review (v571)

A name in an Opera note is evidence of the beneficiary, not proof that they made the sale. The note remains the primary suggestion; the cashier/Opera posting login is displayed separately. Every new manual credit proposed by the IN-Gauge workspace requires explicit contributor confirmation before it can be selected, including a clear name that also matches the posting user.

The strict identity resolver is authoritative. Unmatched, ambiguous and repeated-letter suggestions cannot be turned into a match by a full-name token-subset fallback. John Smith therefore cannot silently become John Paul Smith. Standalone manual-report use accepts exact normalized full names or unique single-name tokens of at least four letters; other matches need review. Duplicate staff identities stay unresolved. Posting/cashier conflicts compare actual resolved contributor IDs or exact normalized names.

The editor shows the beneficiary suggestion, the note-identified name, who posted the charge and why the suggestion was made. Unknown/conflicting notes and posting-user fallbacks remain unconfirmed. A bare Opera INSERT_USER number never selects a numerically identical IN-Gauge contributor ID. The selected contributor must still be active and belong to the verified hotel.

Confirmation records the selected contributor ID. Changing the selector clears that confirmation; client and cloud validation reject a stale ID confirmation. When a unique note-identified person exists, choosing somebody else also needs a recorded reason. Save & select prepares a draft; the existing selected-plan review, correct-hotel binding, live checks and verified Apply workflow remain required. Monthly aggregate totals alone do not determine seller credit.

For automatic packages, Package Audit's final seller decision (after extension, remembered stay and user-pin rules) is the identity imported and validated. Per-booking Opera event actors remain separate evidence. Skip decisions are not imported as financial proposals. Unmatched/ambiguous final identities are held when live identity data is available; existing pending/manual seller requests keep their separate rules.

Tests use synthetic identities only: manual report attribution, cloud plan/assignment validation, final package seller decisions and the phone confirmation workflow. They do not submit real financial changes. Incorrect or incomplete source evidence still needs human verification; these guards prevent unsupported automatic attribution rather than guaranteeing unknowable facts.
