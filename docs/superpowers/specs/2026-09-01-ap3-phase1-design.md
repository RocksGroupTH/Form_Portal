# AP-3 Phase 1 — Design

**Scope:** every AP-3 item in `docs/technical-specification-ap-systems.md` that can ship
**without changing Business Central**. The two items that need CU 50263 extended (VAT
detail block, Mjus indicator) and §3.1 (delete/overwrite interface) are Phase 2 and are
deliberately out of scope here.

**Branch:** `feat/ap3-phase1`, cut from `feat/ap3-clear-vendor` (that branch's vendor
resolution is kept — see §1).

---

## Why no ERP change is needed

`R:\PPFunction\AL\ALProject12_SalesTran\ACCForm\AP\APJournalCreate.al` (CU 50263
`CreateFromJson`) only ever calls `GenJnlLine.Insert(true)` (line 221). **There is no
`Post` anywhere in the codeunit.** So:

- a journal batch whose lines do not sum to zero inserts fine — BC only enforces balance
  at posting time, which accounting performs by hand;
- `Validate(Amount, 0)` is legal, so zero-amount lines are accepted;
- `Refund` is already in the `documentType` enum map (line 150);
- `employeeCode` is already mapped to `External Document No.` (line 214).

---

## 1. Zero-amount WHT and Clear-Advance lines (§2.3, §3.2)

Spec §3.2 requires the WHT line and the Clear-Advance **Vendor** line to be sent as
**0.00 baht always**, leaving the journal intentionally unbalanced so accounting clears
and matches the vendor by hand in BC.

**Decision (user, 2026-09-01): follow the spec — send 0.**

The spec says the *line* carries 0, not that the line disappears. Accounting needs the
vendor line present to match against. So `feat/ap3-clear-vendor`'s work stands: the
clearing line still resolves and points at the AP-2 vendor via
`resolveAdvanceVendorNo`; only its **amount** becomes 0. Same for WHT: when
`whtTotal > 0` the line is still emitted (and the "WHT payable account not configured"
guard still applies), with amount 0.

Resulting payload for one clearing:

| Line | Account | Amount |
| :--- | :--- | :--- |
| Expense (per item) | G/L from the item | real, debit |
| VAT input | configured VAT input G/L | real, debit |
| WHT payable | configured WHT G/L | **0** |
| Clear advance | **Vendor** (from AP-2) | **0** |
| Bank difference | configured bank account | real, signed |

The bank line stays real: it is actual cash movement, and §3.2 defines its side
explicitly (debit on Refund, credit on Payment).

The existing tests assert `sum === 0`. That assertion encodes the old rule and must be
replaced with explicit per-line expectations, including an explicit assertion that the
journal is unbalanced by exactly the amounts we zeroed.

**UI consequence:** the ERP preview must not present an unbalanced total as an error.
Any balance check that blocks sending is removed; the preview shows the Debit and Credit
totals with a short note that the difference is expected.

## 2. Document Type Refund vs Payment (§3.2)

`clear-advance-erp-payload.ts` hardcodes `documentType: "Payment"` on every line.

Rule: **`Refund`** when the employee returns money to the company, **`Payment`** when the
company pays the employee more. The sign of the bank difference already encodes this —
`bankAmount = advanceAmount − actualNet`, positive when money comes back. The document
type is a property of the whole clearing, so it is computed once and applied to every
line of the journal, not per line.

`Refund` needs no AL change (enum map line 150).

## 3. Expense-line description format (§3.2)

Required: `[ADV no] + "เบิก" + "เคลียร์เงินทดลอง" + [employee name] + [document detail]`.

Today it is `เคลียร์เงินทดรองจ่าย {AP-3 request no}`. The AP-3 number is the wrong
number — the ADV number of the advance being cleared is what accounting reconciles
against. Both the ADV number and the clearing employee's name are already on the request
record. `Description` on a Gen. Journal Line is 100 characters, so the composed string is
truncated to fit, dropping the trailing document detail first.

## 4. PDF attachments on the reviewer screen (§2.1)

`AttachmentViewer` already renders PDFs inline. `ClearAdvanceDetail.tsx` does not use it —
it renders images with `<img>` and everything else as a plain download link. Route the
reviewer's attachment list through `AttachmentViewer` so PDFs open in place.

## 5. Branch selected before GL account (§2.4)

The expense table's column order is currently วันที่ · เลขที่เอกสาร · **รายการ (GL)** ·
รายละเอียด · **สาขา**. The spec requires สาขา first, because the branch is what filters
the GL list (§6 below). Move the Branch column ahead of the GL column, and reflect that
dependency in the UI: with no branch chosen the GL picker is disabled with a hint.

## 6. GL accounts filtered by branch (§2.4)

`listGlAccounts()` returns every active row regardless of branch.

Rule: **HQ** shows only accounts whose name does *not* contain "สาขา"; a **PC branch**
(PC 10xx, PC 20xx, …) shows only accounts whose name *does* contain "สาขา". Filtering is
done server-side in the query so the client cannot be handed accounts it must not offer.
Changing a row's branch after a GL account is already picked clears that pick when the
account is no longer allowed.

## 7. OCR confirmation pop-up (§2.2)

Today `verifyReceipts` writes OCR output straight into `setLines` and shows a toast. The
spec requires the user to review and correct the extracted values in a pop-up and press
"ยืนยันบันทึก" before anything reaches the expense table.

The modal holds the parsed rows in local state, every field editable, with Confirm and
Cancel. Cancel discards; the uploaded file itself stays attached either way. Nothing is
written to the expense table until Confirm.

## 8. One invoice number per row (§2.2)

Today the rule is one *file* per row. A single photo containing two invoices produces one
row, silently losing an invoice.

The OCR result becomes a list of documents rather than one document, keyed by invoice
number, and each becomes its own row. This changes the shape returned by the extractor,
so the prompt asks for an array and the parser validates it.

## 9. Multi-line receipt: description of the largest line, total of all (§2.2)

Required: when a receipt has several line items, the description shown is that of the
highest-value line, but the amount recorded is the receipt total.

This rule exists only in the Tesseract fallback (`slip-verify.ts`). The primary Claude
vision path asks for "the main item/service description" and a generic amount, so the two
paths disagree. The Claude prompt is corrected to state both halves of the rule
explicitly.

## 10. AI-suggested GL account (§2.2)

The pop-up from §7 shows a suggested expense GL account per row, derived from the
receipt description, which the user can accept or override.

The candidate list is the same branch-filtered set of allowed accounts from §6 — the
model chooses among accounts the user could have picked by hand, and never invents an
account number. A suggestion is advisory: it is pre-filled but always editable, and if
the model returns anything not in the candidate list it is discarded and the field is
left empty.

## 11. Print AP-3.1 (§2.6)

A Print button on the clearing summary that produces a paper-ready sheet for the employee
to sign and staple in front of the receipts. Rendered as a print-styled route driven by
the browser's own print dialog — no PDF library, no new dependency. It shows the header
(ADV number, employee, department, dates, advance amount), the expense lines, and the
totals with a signature block.

## 12. Inline payment-date edit in the ERP queue (§4.1)

The AP-3 ERP queue has batch select and a Pending/Sent filter, but the payment date can
only be changed from the separate account-action form. Add the same inline picker the
AP-2 queue uses, editable only while the row is still Pending.

## 13. AP-3 report parity with AP-2 (§4.2)

AP-2's report already has stacked multi-value filters, the overdue/aging filter, and
Christian-era years. The AP-3 report has not been checked against those. Audit it and
close whichever of the three is missing, reusing AP-2's components rather than writing
new ones.

---

## Out of scope (Phase 2)

- §3.2 VAT detail block (Posting Type, VAT Code, Document Date, Tax ID, Vendor Name, VAT
  Amount) — no VAT field is touched anywhere in CU 50263, and `"Document Date"` is
  hardcoded to `"Posting Date"` at line 186.
- §3.2 Mjus indicator `"MS"` — no such field in the payload or the codeunit, and which BC
  field it writes to is still unconfirmed.
- §3.1 Delete Document No. + overwriting interface — needs a new BC endpoint.
- §2.3 DBD lookup for พ.ง.ด. 53 vs 3 — not an ERP change, but blocked on DBD API access.

## Testing

Payload composition, the document-type rule, the description format, and the GL branch
filter are pure functions and are covered by unit tests. The OCR modal, the print sheet,
and the inline date picker are verified in the running app against the UAT database.
Nothing in Phase 1 can be verified end-to-end against BC until the extension is deployed
to Sandbox.
