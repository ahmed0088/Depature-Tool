# Tests

`node tests/run-tests.js` runs the real app code against the files in `fixtures/` and checks
answers that were verified by hand (DTCM month-end tally, which rooms need fixing, hotel TD
settings, nationality spellings). It runs automatically on every push (GitHub → Actions → Tests).

The fixtures are real DTCM / Opera reports with **every guest and staff name replaced by a
made-up one** (the same replacement in both files, so matching behaves exactly like the original).
Never add a report with real guest names here — the repository is public.

When you fix a bug, add a check for it here so it cannot come back.
