# AP-3 Phase 2 — ERP interface fields (กอง A)

**Date:** 2026-09-08 (revised the same day against `docs/ap3-clear-advance-specification.md`)
**Status:** design revised, not yet planned
**Requirements:** `docs/ap3-clear-advance-specification.md` §4 — the AP-3-specific
requirements summary, which **governs** where it disagrees with
`docs/technical-specification-ap-systems.md` §3.2 (see §7).
**Predecessor:** `2026-09-01-ap3-phase1-design.md` (merged to master as `b36057c`)

---

## 1. Why this exists

Phase 1 was defined as everything shippable *without* changing Business Central.
This is the first of the three groups it deliberately left behind — the journal
fields §4 asks for that Phase 1 either could not send or sent as a placeholder.

The other two groups are **not** in this spec: ภ.ง.ด. 3/53 classification from
Tax ID and the delete-document-no / overwrite-interface workflow. Each gets its
own spec.

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

- VAT: no Gen. Posting Type, no VAT Bus. / Prod. Posting Group
- No withholding-tax fields, no Applies-to fields
- No field for a counterparty tax id or name (see §7 question 1)
- "Document Date" is **forced equal to Posting Date** (`:186`), so a line cannot
  carry the date printed on its own receipt

Three facts shape the design:

- **Unknown keys are ignored, not rejected.** `GetJsonText/Date/Decimal`
  (`:285-328`) return empty on a missing key, and nothing validates the key set.
  Adding optional keys cannot break the existing callers.
- **The codeunit stages, it never posts** (`GenJnlLine.Insert(true)`, `:221`).
  BC enforces balance at posting time, which is what makes §4's deliberately
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

§4 calls for an adjustment indicator when a receipt belongs to an earlier
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

**Value spelling.** Both requirements documents write the indicator as "MS"
(§4, Mjus Indicator). The dimension value that actually exists is `M-ADJ`
(confirmed with the user, 2026-09-08). The code follows the system, not the
document; this paragraph is the record of the discrepancy. Z-ADJ also holds
`A-Adj`, whose meaning for AP-3 is unresolved — see §7.

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

| New key | Gen. Journal Line field | Value |
| --- | --- | --- |
| `genPostingType` | "Gen. Posting Type" | `Purchase` |
| `vatBusPostingGroup` | "VAT Bus. Posting Group" | `VATHO` — fixed |
| `vatProdPostingGroup` | "VAT Prod. Posting Group" | `FVAT` — fixed |
| `documentDate` | "Document Date" | the receipt's own date; currently hard-set to Posting Date at `:186`, which must become "use `documentDate` when given, else Posting Date" |

Each follows the existing pattern: read with the graceful helper, skip when
blank, `Validate()` when present. Blank keys leave today's behaviour exactly as
it is, so every existing caller is unaffected.

**The posting groups are constants, not a choice** (user, 2026-09-08). The
requirements read `VAT Code: wat H หรือ FBAT (ตามแต่กรณีที่ผู้ใช้เลือก)`, which
looks like a decision the user makes per document, and the other document reads
it as varying per branch. Both are the same pair transcribed loosely: `wat H` is
`VATHO` and `FBAT` is `FVAT` — a business group and a product group that go
together, not two alternatives. So there is no new form field, no per-branch
rule, and nothing for a user to get wrong.

**Portal.** The VAT line sends those four, with `documentDate` taken from the
receipt rather than the journal, so the VAT entry sits in the period the
document belongs to. The account is unchanged: `vatInputGlAccountNo`, configured
per brand, which is the "ภาษีซื้อยังไม่ถึงกำหนด" account §4 asks for.

**Tax id and counterparty name are unresolved** — §4 asks for both on the VAT
line, and the standard Gen. Journal Line has nowhere to put either. See §7
question 1; this design does not send them and does not add a field for them
until that is settled.

### 4.3 Step 2 — External Document No.

§4 asks for the requester's employee code, and says *only* that
("ส่งข้อมูลเป็น 'รหัสพนักงาน (Employee ID)' เท่านั้น"). What is actually sent is
the request number: `const employeeCode = requestNo.slice(0, 35)`
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

**Step 2** — `genPostingType`, `vatBusPostingGroup` and `vatProdPostingGroup`
appear only on the VAT line and only when a VAT amount exists; `documentDate` is
the receipt's date, not the posting date; External Document No. is the staff id
on AP-3 and unchanged on AP-2.

**End to end, on UAT, against BC Sandbox** — neither step is finished on a green
test run. Each ends with a real clearing driven through submit, all three
approvals and the ERP send, and a response showing the document created with
`Failed: 0`. For Step 1 that means one clearing whose receipt is dated in a
previous month and one dated in the current month, and confirming that only the
first carries the marker.

## 6. Out of scope

- **WHT and the clear-advance vendor line both stay at 0 — permanently, not as a
  stopgap.** §4 states it twice: the amounts go to the ERP as zero so accounting
  clears the vendor and reverses AP-2 by hand in BC, and the resulting
  unbalanced preview is "ตามธรรมชาติของข้อกำหนดนี้". §4.1 repeats it for the
  WHT case specifically. An earlier draft of this spec proposed sending the real
  WHT amount split per payee; that was read out of
  `technical-specification-ap-systems.md` §2.3, which frames the zero as
  temporary. It is removed. See §7 question 2.
- Applies-to / automatic matching against the AP-2 payment.
- Tax id and counterparty name on the journal (§4.2, §7 question 1).
- ภ.ง.ด. 3/53 classification from Tax ID, and the delete-document-no / re-send
  workflow. Separate specs.
- `balAccountNo`: codeunit 50263 sets "Bal. Account Type" but never writes
  "Bal. Account No." (`:211`). A real gap, found while reading the contract,
  unrelated to anything here. Recorded, not fixed.
- Persisting the codeunit's per-line result messages (§2). The same note as
  above: real, known, and someone else's ticket.

## 7. Open questions

1. **Tax id and counterparty name on the VAT line.** §4 requires them; the
   decision was to stay on standard Gen. Journal Line fields, which have nowhere
   to hold them. One of the two has to give: either they are not sent, or a
   custom field is added after all.
2. **Is the zero on WHT permanent?** `ap3-clear-advance-specification.md` §4 says
   always; `technical-specification-ap-systems.md` §2.3 says it is temporary,
   pending the back end. This spec follows the AP-3 document. If the other one is
   the live intent, the WHT item comes back and brings a sign question with it —
   the payload convention is `>0 = debit, <0 = credit`, and `actualNet` already
   subtracts WHT before the bank difference is computed (`:66-67`), so a credit
   line is what makes the remaining imbalance equal the advance.
3. **`A-Adj`.** Z-ADJ holds at least `M-ADJ` and `A-Adj`. Whether any AP-3 case
   should send `A-Adj` is unresolved (user, 2026-09-08: "ยังไม่แน่"). Step 1
   sends only `M-ADJ`.
4. **"ระบุรหัส Vendor ตั้งต้นเป็นเลข 3 เป็นหลักก่อนตามเงื่อนไขทางบัญชี"**
   (§4.1). Not implemented anywhere and its meaning is unclear — a vendor-code
   prefix, a posting group, something else. Needs accounting.
5. **When the AL extension carrying the Step 2 keys can be deployed to
   Sandbox.** Step 2 cannot be verified before that, and Phase 1 lost a day to
   exactly this when Sandbox was under maintenance.

## 8. Phase 1 items that differ from the requirements

Found while checking this spec against `ap3-clear-advance-specification.md`.
None is a Phase 2 change; they are recorded so the difference is deliberate and
visible rather than discovered later.

- **No "อ่านรายการจากไฟล์แนบ" button.** §2.2 describes four steps: upload, press
  the button, AI reads, popup to check. What shipped reads every upload
  immediately, with no button in between. It is fewer clicks, and it also means
  every attachment costs an AI read whether the user wanted one or not.
- **The G/L filter uses `DimensionType`, not the word "สาขา".** §3.2 states the
  word test — HQ gets accounts without "สาขา", a PC branch gets accounts with
  it. Phase 1 changed this deliberately (commit `a98c8da`, user decision
  2026-09-01) because the word test hid all six `Both` accounts from every
  branch. The requirements document still carries the old rule and should be
  corrected.
- **"1 receipt = 1 row" vs "1 invoice number = 1 row".** §2.2 says one document
  per row; `technical-specification-ap-systems.md` §2.2 says one invoice number
  per row. Phase 1 implemented the latter, so one file holding two invoices
  yields two rows. The two only differ in that case.
