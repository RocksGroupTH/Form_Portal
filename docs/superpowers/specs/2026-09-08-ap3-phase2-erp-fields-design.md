# AP-3 Phase 2 — ERP interface fields (กอง A)

**Date:** 2026-09-08
**Status:** design approved, not yet planned
**Scope source:** `docs/technical-specification-ap-systems.md` §3.2
**Predecessor:** `2026-09-01-ap3-phase1-design.md` (merged to master as `b36057c`)

---

## 1. Why this exists

Phase 1 was defined as everything shippable *without* changing Business Central.
This is the first of the three groups it deliberately left behind — the journal
fields §3.2 asks for that Phase 1 either could not send or sent as a placeholder.

The other two groups are **not** in this spec: ภ.ง.ด. 3/53 classification from
Tax ID (กอง B) and the delete-document-no / overwrite-interface workflow
(กอง C). Each gets its own spec. กอง B in particular has nothing to consume its
output until this group ships, which is why it is second.

## 2. What the BC side already accepts

Read from `R:\PPFunction\AL\ALProject12_SalesTran\ACCForm\AP\APJournalCreate.al`
(codeunit 50263, `PP_APJournalCreate`, exposed as OData `PPAPJournalCreateAPI_CreateFromJson`).

The contract is more permissive than assumed, and two items turned out to need
no AL work at all:

| JSON key | Written to | Portal sends it today? |
| --- | --- | --- |
| `employeeCode` | Gen. Journal Line **"External Document No."** (`:214`) | yes — but with the wrong value, see §4.3 |
| `adjCode` | Dimension **Z-ADJ** (`:238`) | **no** — never sent |
| `branchCode` / `departmentCode` | Dimensions BRANCH / DEPT (`:219`, `:235`) | yes |
| `salesModeCode` / `tenderCode` | Dimensions SALESMODE / TENDER (`:236`, `:237`) | no — not needed here |
| `dueDate` | "Due Date" (`:188`) | no — not needed here |

Not present anywhere in the codeunit, and therefore genuine AL work:

- VAT: no Gen. Posting Type, no VAT Bus. / Prod. Posting Group, no VAT amount field
- No withholding-tax fields, no Applies-to fields
- "Document Date" is **forced equal to Posting Date** (`:186`), so a line cannot
  carry the date printed on its own receipt

Three facts shape the design:

- **Unknown keys are ignored, not rejected.** `GetJsonText/Date/Decimal`
  (`:285-328`) return empty on a missing key, and nothing validates the key set.
  Adding optional keys cannot break the existing callers.
- **The codeunit stages, it never posts** (`GenJnlLine.Insert(true)`, `:221`).
  BC enforces balance at posting time, which is what makes §3.2's deliberately
  unbalanced journal legal.
- **Per-line results are returned but never stored** (`:57-75`). A line that
  fails validation reports a reason that is lost the moment the response is
  read. This already cost a day on AP-2's BRANCH≠DEPT bug and it is why §5's
  verification does not stop at "the tests are green".

## 3. Shape: two steps

Approach A2 of three considered. A1 shipped everything in one release and made
the parts that need nothing from BC wait on an extension deploy. A3 wrote it all
behind a config flag, which leaves untested code paths in the product — the
thing Phase 1 spent its effort avoiding.

A2 splits on the dependency instead:

- **Step 1** needs nothing from BC and can be proven against Sandbox the day it
  is written.
- **Step 2** cannot be proven until the extension carrying the new AL keys is
  deployed, so everything that waits on that deploy travels together.

## 4. Design

### 4.1 Step 1 — the Z-ADJ adjustment marker

§3.2 calls for an adjustment indicator when a receipt belongs to an earlier
accounting period than the journal it lands in. BC already has the column: the
Z-ADJ dimension, reachable through the `adjCode` key the portal has never sent.

**Rule.** For each **expense line**, when the month of the date printed on its
receipt is earlier than the month of the journal's posting date, send
`adjCode: "M-ADJ"`.

- Compared as `YYYY-MM` strings, so December 2025 against January 2026 counts.
- **Expense lines only.** The VAT, WHT, vendor and bank lines have no document
  date of their own; giving them a marker derived from someone else's date would
  be an invention.
- A receipt with no readable date gets no marker. The rule needs a date to be
  true; absent one, it is not "false", it is unknown.

**Change.** `ClrJournalItem` (`src/lib/clr/clear-advance-erp-payload.ts:11`)
carries no date at all — it holds account, amounts, branch and description. It
gains `expenseDate`, passed through from `AccClearAdvanceItem.ExpenseDate`,
which the caller already reads.

**Value spelling.** The requirements document writes the indicator as "MS"
(§3.2, Mjus Indicator). The dimension value that actually exists is `M-ADJ`
(confirmed with the user, 2026-09-08). The code follows the system, not the
document; this paragraph is the record of the discrepancy.

**Risk.** Codeunit 50263 validates a dimension value before writing it. If
`M-ADJ` is not a live Z-ADJ value for the company being posted to, the line
fails to insert — and per §2 the reason is not stored anywhere. So Step 1 is not
done when its unit tests pass; it is done when a clearing carrying the marker
has been sent to Sandbox and come back with `Failed: 0`.

### 4.2 Step 2 — the VAT line

The only part of this spec that needs AL.

**AL.** Codeunit 50263 reads four new optional keys and validates them onto the
standard Gen. Journal Line — no `tableextension`, no custom fields (decision:
user, 2026-09-08):

| New key | Gen. Journal Line field |
| --- | --- |
| `genPostingType` | "Gen. Posting Type" (purchase) |
| `vatBusPostingGroup` | "VAT Bus. Posting Group" |
| `vatProdPostingGroup` | "VAT Prod. Posting Group" |
| `documentDate` | "Document Date" — currently hard-set to Posting Date at `:186`, which must become "use `documentDate` when given, else Posting Date" |

Each follows the existing pattern: read with the graceful helper, skip when
blank, `Validate()` when present. Blank keys leave today's behaviour exactly as
it is, so every existing caller is unaffected.

**Portal.** The VAT line sends those four, with `documentDate` taken from the
receipt rather than the journal, so the VAT entry sits in the period the
document belongs to.

**Not sent: Tax ID and Vendor Name.** §3.2 lists them, but the standard
Gen. Journal Line has nowhere to put them and the decision was to stay on
standard fields. Accounting reads both off the receipt attached to the request.

### 4.3 Step 2 — WHT at its real amount

Today one WHT line is written per clearing carrying `0`
(`clear-advance-erp-payload.ts:96`), because Phase 1's §2.3 made the placeholder
explicit while the back end was unfinished.

`AccClearAdvanceWht` already stores WHT per payee — `TaxId`, `PayeeName`,
`Amount`, `WhtAmount`, `NetAmount` — and the form already refuses to submit a
WHT amount without a Tax ID and a payee name
(`clear-advance-request-service.ts:411`).

**One journal line per payee**, built from those rows rather than from the
summed `whtAmount` on the expense items. This matches the certificate that has
to be issued to each payee, and it is what lets กอง B put a ภ.ง.ด. type on a
line later instead of on a lump sum. No AL change: these are ordinary G/L lines
with an amount, which the contract has always accepted.

**Open — the sign.** The payload's convention is `>0 = debit, <0 = credit`, and
`actualNet` already subtracts WHT before the bank difference is computed
(`:66-67`). On an advance of 1,200 with expense 1,000 + VAT 70 − WHT 30, a
credit line (−30) leaves the journal short by exactly 1,200 — the amount the
vendor line would have credited if it were not deliberately 0 — while a debit
line (+30) leaves 1,260, a number that corresponds to nothing. Credit is
therefore the reading this design expects, but a wrong sign is a wrong journal,
so **this must be confirmed with accounting before implementation**.

### 4.4 Step 2 — External Document No.

§3.2 asks for the requester's employee code. What is actually sent is the
request number: `const employeeCode = requestNo.slice(0, 35)`
(`clear-advance-erp-payload.ts:53`). The field is populated, so this reads as
done until you look at the value — ADC26-09008 reached BC with an External
Document No. of `ADC26-09008`, not `10177`.

**AP-3 changes to the staff id. AP-2 stays as it is** (decision: user,
2026-09-08). AP-2 is live and does the same thing deliberately enough to carry a
comment about it (`advance-erp-payload.ts:33-35`); changing it would also split
its own history in BC between two conventions. The two forms will differ, and
that is the accepted cost.

## 5. Verification

Unit tests come first, as in Phase 1.

**Step 1** — receipt a month earlier carries `M-ADJ`; same month does not; a
December receipt against a January posting does; a receipt with no date does
not; VAT, WHT, vendor and bank lines never do.

**Step 2** — the four VAT keys appear only on the VAT line and only when
configured; `documentDate` is the receipt's date, not the posting date; one WHT
line per `AccClearAdvanceWht` row with the payee in its description; External
Document No. is the staff id on AP-3 and unchanged on AP-2.

**End to end, on UAT, against BC Sandbox** — neither step is finished on a green
test run. Each ends with a real clearing driven through submit, all three
approvals and the ERP send, and a response showing the document created with
`Failed: 0`. For Step 1 that means one clearing whose receipt is dated in a
previous month and one dated in the current month, and confirming that only the
first carries the marker.

## 6. Out of scope

- The vendor clearing line stays at `0` (decision: user, 2026-09-08). No
  Applies-to, no automatic matching against the AP-2 payment — accounting clears
  it by hand in BC, as §3.2 intends.
- Tax ID and Vendor Name on the journal (§4.2).
- กอง B (ภ.ง.ด. 3/53 from Tax ID via DBD) and กอง C (delete document no. and
  re-send).
- `balAccountNo`: codeunit 50263 sets "Bal. Account Type" but never writes
  "Bal. Account No." (`:211`). A real gap, found while reading the contract,
  unrelated to anything here. Recorded, not fixed.
- Persisting the codeunit's per-line result messages (§2). The same note as
  above: real, known, and someone else's ticket.

## 7. Open questions

1. **The sign of the WHT line** (§4.3). Blocks Step 2's WHT item only.
2. **`A-Adj`.** Z-ADJ holds at least `M-ADJ` and `A-Adj`. Whether any AP-3 case
   should send `A-Adj` is unresolved (user, 2026-09-08: "ยังไม่แน่"). Step 1
   sends only `M-ADJ`; if `A-Adj` has an AP-3 meaning, it is a follow-up.
3. **When the AL extension carrying the Step 2 keys can be deployed to
   Sandbox.** Step 2 cannot be verified before that, and Phase 1 lost a day to
   exactly this when Sandbox was under maintenance.
