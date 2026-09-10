# AP-4: a BC vendor per expense line, chosen on the accounting queue

**Date:** 2026-09-10
**Status:** design agreed; not yet implemented
**Migration:** 147 (`Rocks_Portal_Form` **and** `Rocks_Portal_Form_UAT`)
**Branch:** `feat/ap4-accounting-and-erp`, after it merged master (147 commits,
mostly AP-3) — see §7 for why that merge came first

The accounting approver works AP-4 claims at คิวอนุมัติ (บัญชี). Today each
expense line offers one editable field, the G/L account. It gains a second, the
Business Central **vendor**, and the three answers an approver gives — G/L,
vendor, payment date — are laid out as a table rather than a list.

Nothing here posts to Business Central. AP-4 still has no sender (CLAUDE.md,
"AP-4 never reaches Business Central, deliberately"); this fills in a field that
sender will need, on the screen where the person who knows the answer already
is.

---

## 1. Decisions taken

| Question | Decision |
|---|---|
| What is "Vendor"? | The **BC vendor number** from `ErpVendors`, not the seller printed on the receipt. |
| Where is it stored? | `AccReimburseItem.VendorNo NVARCHAR(20) NULL`, migration 147. |
| Per line or per claim? | **Per line**, like the G/L account beside it. One claim can reimburse purchases from several sellers. |
| Payment date | **Per claim**, seeded from the suggested round; the bulk control stays as a "fill every selected claim" convenience. Outside the line table, because it belongs to the claim. |
| Line layout | The **full** detail-view table — all thirteen columns — plus `G/L` and `Vendor`. |
| New endpoint for the write? | **No.** `setReimburseItemAccounts` is extended. |
| Vendor list endpoint | New, `GET /api/request/reimburse/vendors?brand=…`, modelled on AP-3's. |
| Picker component | The searchable picker is **extracted** from `ExpenseAccountPicker` and shared by both. |

---

## 2. What already exists, and is reused unchanged

The merge in §7 is what makes this section short.

- **`listTaxVendors(company)`** (`src/lib/clr/tax-vendor-service.ts`) — every
  active, unblocked vendor card in one BC company. It takes a company code and
  knows nothing about AP-3, so AP-4 calls it as it stands. Its own docblock
  carries the reason the whole list is sent at once rather than searched
  server-side, and that reason is **not** performance laziness: `DisplayName` is
  `Thai_CI_AS`, where `LIKE` compares collation elements — a Thai consonant and
  the mark above it are one — so a substring pattern did not match the very name
  it was taken from, and a seller whose name was read one mark short came back
  as "not a vendor at all". JavaScript compares code units. Filtering in the
  browser is the fix, not a shortcut.
- **`getBrandErpInterfaceMap(brand, formCode)`** — claim brand to the Company the
  journal posts into. `ErpVendors` is keyed by Company, and a vendor number from
  one is meaningless in another.
- **`setReimburseItemAccounts`** — see §4.

## 3. Migration 147

```sql
ALTER TABLE [dbo].[AccReimburseItem] ADD [VendorNo] NVARCHAR(20) NULL;
```

Copied from `143_item_tax_vendor.sql`, which did exactly this to
`AccClearAdvanceItem` for AP-3.

- **Both form databases, before the code.** SQL Server binds column names at
  compile time, so the column missing from either side is `Invalid object name`
  — the whole query fails rather than returning a null — and AP-4 resolves
  either database depending on who is asking.
- **`check:alignment` must stay at 28.** `AccReimburseItem` is transactional: it
  is not dual-written and not in `MASTER_TABLES`. A changed count means the
  wrong table was altered.
- **Nullable, no default, no backfill.** An existing line reads NULL, which is
  honest — no vendor has been chosen — where a default would claim one had.
- **Not a foreign key.** `ErpVendors` lives in `Rocks_ERP_Data`, a different
  database. Same as AP-3.
- **147, not 145 or 146.** Master reached 146, and this branch's own
  `144_acc_reimburse_approver_brand.sql` already collides with master's
  `144_erp_interface_response.sql`. Read `ls migrations/`, never a number
  written down anywhere — including here.

## 4. The write extends the path that is already correct

`setReimburseItemAccounts(requestId, actor, edits)` gains `vendorNo` alongside
`category` in each edit. It is **not** given a sibling endpoint, because every
guard such an endpoint would need already exists here and is already right:

- `requireApproverStaffId(actor)` before anything;
- the state predicate **claimed**, not read — a conditional `UPDATE` bounded on
  id, form, status and step and checked on `rowsAffected`, which takes and holds
  the exclusive lock to commit. A bare `SELECT` releases its shared lock at
  statement end under this database's READ COMMITTED, which is how a G/L edit
  once landed after a concurrent approval had already moved the claim on;
- `requireApproverScopeFor(actor, brand)` decided **from the database inside
  that same transaction**, because this edit repoints where money posts and is
  bound by the same brand scope an approval at this step is;
- the old-to-new activity-log row.

A second endpoint would re-implement all four and could only get one wrong.
This is the same argument AP-17's bulk payout-date control and AP-4's own
approve loop already make.

**Validation.** A posted `vendorNo` is checked against the claim's own Company
before it is stored — a vendor number from another company is meaningless, and
storing one produces a journal that fails at the far end with nothing on screen
having warned. Blank clears the field; that is a legitimate answer.

## 5. The list endpoint

`GET /api/request/reimburse/vendors?brand=…`, mirroring
`/api/request/clear-advance/tax-vendors` with `AP4_FORM_CODE` in place of
`AP2_FORM_CODE`.

`requireAuth()` alone matches AP-3's, and is the right level here: the response
is the BC vendor master for a brand, not anything about a claim. It takes a
**brand**, not a request id, so there is no record to authorize — resolving the
Company server-side rather than trusting a posted one is the check that matters,
since sending `ROCKS` where `PCTH` is meant returns an empty list that looks
exactly like "this company has no vendors".

## 6. UI

*(Revised 2026-09-10 after the first review. The original said the lines kept
their list layout with two fields bolted on, and that the payment date stayed a
single control for the whole selection. Both were replaced by what follows.)*

**The expense lines are the full table, the same columns the detail view
prints** — ลำดับที่ · วันที่ · เลขที่เอกสาร · รายละเอียด · สาขา · เลขผู้เสียภาษี ·
ผู้ขาย · ที่อยู่ · ก่อน VAT · VAT · ค่าใช้จ่ายรวม · หัก ณ ที่จ่าย · จ่ายสุทธิ —
**plus `G/L` and `Vendor` as two more columns in the same row**. An approver
deciding which BC card a line posts to is reading the seller, the tax id and
the address to decide it; those three were not on this screen at all, and the
decision was being made from a description and an amount.

`รายการ` is **not** among them, for the reason §8 gives: it *is* the G/L
account, so it appears once, as the editable `G/L` column.

That is fifteen columns. The card scrolls horizontally in its own container, as
the detail view's table already does — the page must not widen.

**The payment date is per claim, not per selection.** Each claim carries its own
date field, seeded from the suggested round. This is a change from what is
there: today one control at the bottom of the queue sets a single date and the
approve loop sends it to every selected id. **The server already works this
way** — `POST .../requests/[id]/approve` takes `paymentDate` per request and
validates it with `paymentDateProblem`, so the loop was sending the same value N
times by choice, not by constraint. Nothing server-side changes.

The bulk control is kept, retitled to say what it now does: it fills every
selected claim's field. Approving a batch is the point of this queue, and
losing "same date for all of these" to gain per-claim would be a bad trade — but
the field that is actually submitted is the claim's own, so what an approver
sees on a row is what that row gets.

`PaymentDate` remains a column on `AccRequest`, one per claim. It is therefore
**not** a column inside the line table: putting it there would tell an approver
they can set it per expense line, and they cannot.

**The searchable picker is extracted, not copied.** `ExpenseAccountPicker`
already solves everything a vendor picker needs — a filter-as-you-type list
(around 280 accounts per brand; up to 1,604 vendor cards), a portalled dropdown,
"no brand chosen yet", and "the stored value is not in the list", which happens
both to a claim filed before that column meant an ERP account and to a vendor
since blocked in BC. It becomes a generic picker over a code-and-name pair, and
both call it.

That extraction touches code in daily use on the queue, so it carries a guard
test asserting both surfaces resolve through the one component. The risk of an
extraction is a silent behaviour change in the **old** caller, not in the new
one.

## 7. Why master was merged first

Building this on the branch as it stood would have produced a **third**
independent vendor implementation, written without sight of the first two, on
the path that decides where money posts. Master already carried
`vendor-match-core` / `vendor-match-service` (AP-2), `tax-vendor-core` /
`tax-vendor-service` (AP-3) and their routes; none existed on this branch. The
merge also settled the migration number, which could not be known otherwise.

## 8. What this does not do

- **No Business Central call.** AP-4 has no sender. This stores a field.
- **No readiness gate.** `erpReadiness` (`reimburse/erp-queue-policy.ts`) judges
  a claim on its G/L accounts today. Whether a missing vendor should also block
  a claim is the sender's decision to make, and the sender does not exist.
  Adding the gate now would park approved claims behind a rule nothing can
  satisfy.
- **It does not touch `VendorName` / `VendorTaxId` / `VendorAddress`** (migration
  118). Those are the seller as printed on the receipt, read by the AI and owned
  by the requester. `VendorNo` is accounting's answer about which BC card to
  post against. They are different facts and both are worth keeping — the pair
  is what lets somebody check that the right card was chosen.
- **AP-1, AP-2, AP-3 and AP-17 are untouched**, apart from the G/L picker's
  extraction, which is AP-4's own component.

## 9. Deployment

1. Apply 147 to `Rocks_Portal_Form` **and** `Rocks_Portal_Form_UAT`.
2. `npm run check:alignment` — the table **count** must still read **28**.
3. Deploy.

Out of order, an AP-4 claim's item read fails outright on whichever database
lacks the column.

**Read step 2 carefully, because that command already fails today and this
change is not why.** Measured 2026-09-10, `check:alignment` reports `FAIL —
configuration has drifted`, on four shared tables whose rows agree on every
business column and differ only on `Id`: `AccFormBrand`, `AccBrandBankAccount`,
`AccBrandBranchCode` and `AccBrandJournalBatch`, all on their AP-4 rows. That is
the identity-lockstep drift CLAUDE.md describes under "Shared configuration is
dual-written", and it predates this work. What step 2 is checking is that the
**count** stays at 28 — `MASTER_TABLES.length`, verified at 28 the same day.
`AccReimburseItem` is transactional, so 147 must not move it. A count of 29
means the wrong table was altered; a `FAIL` naming those four tables means the
pre-existing drift, which wants a realign migration of its own and is not this
one. Note also that the checker prints only the **first** differing row per
table and then stops, so its output understates how many rows are involved.
