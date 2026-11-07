# Manual sales

Package Audit → Manual sales accepts the Opera Journal by Transaction Code and Reservation Detail text reports, plus the complete IN-Gauge product workbook. Each result leads with its confirmation number, copyable entry values, source evidence and next steps. Reservation stay dates are labeled separately from the daily date of the charge.

The reconciliation compares uploaded exports. A proposed addition is absent from that export; it is not proof of absence from live IN-Gauge. Pending requests already count as submitted. Notes identify seller credit; the posting account is shown separately. Uncertain identities, credits, amounts and coverage remain review cases.

## Reviewed cloud automation

Owners and managers select verified early check-in or late-checkout additions and review the exact confirmation, seller, daily date and net amount. Breakfast quantity and recurring dates remain manual checks in this version.

1. In the repository’s **Settings → Secrets and variables → Actions**, configure `INGAUGE_EMAIL` and `INGAUGE_PASS`. Reuse `HOTELOPS_EMAIL` and `HOTELOPS_PASS` for an active owner or manager belonging to the current hotel. Do not put passwords into chat, report files or the application.
2. Set up the existing GitHub Actions start key through Neorcha’s cloud-run setup. Manual sales reuses that device’s key.
3. Upload the reports, select the reviewed additions, and open **Review selected**.
4. Confirm the reviewed details and choose **Test selected**. This opens IN-Gauge, verifies the property, employee/product mappings, all-status duplicate search, pagination and calculated form values. It submits nothing.
5. A passing test unlocks **Submit selected as Pending** for the same reviewed plan for one hour. Changing a financial detail, report or selection invalidates that review/test.
6. Follow the live results or reopen the active run from Cloud run history. Closing the window leaves the run recorded. Stop requests are checked before the next submission.
7. Approve or reject existing Pending requests in IN-Gauge. Upload a fresh export to reconcile the new status.

The runner connects only to `https://app.fpg-ingauge.com/`. Interactive verification, CAPTCHA, changed forms or unknown quantity/date conventions stop the test for review. The authenticated workflow must be tested using the configured account before production use; public application structure and synthetic portal scenarios do not establish that the account can sign in or submit.

## Duplicate and write guards

Only selected, uniquely matched, note-credited AED one-off additions can enter a reviewed plan. The plan is stored in the hotel database and bound to the workflow by a SHA-256 digest; guest details and credentials are not workflow inputs or public log output. Runs for the same hotel are serialized.

The live search includes all statuses and staff. A same-product request on that booking, including Pending, Approved, Reviewed, Denied or an unidentified product, blocks another automatic addition. A second check runs after filling the form. The browser intercepts a create request and allows only the reviewed property, department, employee, product, confirmation, daily date, amount, one charge day and `PENDING` status. It blocks approval, update and repeated create requests.

A per-transaction ledger records submission intent before the write. Each successful addition must be read back as exactly one matching Pending record. Uncertain outcomes stop the run and block automatic resubmission; check IN-Gauge manually before further action. A fresh export showing the record resolves the audit without another addition.

Validation: `node tests/manual-upsells.test.js` and `node tests/manual-sales-automation.test.js`. Browser interaction checks cover desktop and phone review, test gating, close controls, evidence and horizontal overflow. Portal account sign-in and actual financial submissions require the first-time setup and passing live test.
