# AP-3 Phase 2 Step 4 — the VAT line and the tax block Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each VAT line the ten columns the interface layout asks for — the posting-group trio, the invoice's own number, date and base, and the seller's identity — so the tax report in BC can be built from the journal instead of from the paper.

**Architecture:** Three portal layers and one AL layer, in dependency order. The seller's identity has to be kept before it can be sent; the VAT line has to be split per invoice before it can carry an invoice's fields; then the keys go on, and the codeunit reads them. Nothing is sent on a line it does not belong to.

**Tech Stack:** TypeScript, `node:test` via `npm test`; MSSQL migration; AL (codeunit 50263).

**Spec:** `docs/superpowers/specs/2026-09-08-ap3-phase2-erp-fields-design.md` §5.4

---

## What is in the way, and why the order is what it is

**The seller's identity is read and then dropped.** The OCR returns `taxId`,
`payeeName` and `payeeAddress` per receipt and the confirm modal shows them, but
`LineRow` has no such fields and neither does `AccClearAdvanceItem`. They survive
only on the WHT rows — which exist only where withholding does. A VAT receipt
without WHT therefore has no seller on our side at all. **Task 1.**

**One VAT line cannot carry two invoices.** The builder sums every item's VAT
into a single G/L line. `Tax Invoice No.`, `Tax Invoice Date`, `Tax Invoice Base`
and `Tax Invoice Name` all belong to one specific invoice. **Task 2** changes the
journal's shape, which is why it comes before the keys and not with them.

**Field names, read from the symbols** (`tableextension 80105 GenJnlext extends
"Gen. Journal Line"`, in `.alpackages`). Two of the sheet's column names are
captions, not field names:

| Sheet column | AL field name | Type |
| --- | --- | --- |
| Tax Vendor No. | `Tax Vendor No.` | Code[20] |
| Tax Invoice No. | `Tax Invoice No.` | Code[35] |
| Tax Invoice Name | `Tax Invoice Name` | Text[250] |
| Tax Invoice Base | `Tax Invoice Base` | Decimal |
| Document Date | `Tax Invoice Date` | Date |
| Tax Branch Code | **`Branch Code`** | Code[20] |
| Tax VAT Registration No. | **`Revolic VAT Registration No.`** | Code[20] |

Gen. Posting Type, VAT Bus. Posting Group and VAT Prod. Posting Group are
standard `Gen. Journal Line` fields and need no dependency.

**All ten go on the VAT line only** (user, 2026-09-08). An expense, vendor or
bank line carrying a VAT posting group would change how BC treats it.

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `migrations/140_item_seller.sql` | Seller identity on the expense line | **new** |
| `src/features/clear-advance/types.ts` | `ClearAdvanceItem` | `taxId`, `payeeName`, `payeeAddress` |
| `src/features/clear-advance/components/ClearAdvanceForm.tsx` | `LineRow`, OCR apply, save payload | carry the three fields |
| `src/lib/clr/clear-advance-request-service.ts` | Item read + write | map and insert them |
| `src/lib/clr/clear-advance-erp-payload.ts` | Journal builder | one VAT line per invoice, tax keys |
| `src/lib/acc/erp-ppap-payload.ts` | `PpapJournalLinePayload` | the ten optional keys |
| `R:\PPFunction\AL\...\APJournalCreate.al` | Codeunit 50263 | read the keys, Document Date |

---

## Task 1: Keep the seller

**Files:**
- Create: `migrations/140_item_seller.sql`
- Modify: `src/features/clear-advance/types.ts`, `ClearAdvanceForm.tsx`, `clear-advance-request-service.ts`

- [ ] **Step 1: The migration**

```sql
-- The seller on one expense line — who issued the tax invoice.
--
-- The OCR already reads all three per receipt and the confirm modal shows them;
-- until now they were kept only on AccClearAdvanceWht, which exists only where
-- withholding does. A VAT receipt without WHT therefore lost its seller
-- entirely, which is what stopped Tax Invoice Name from being sendable.
--
-- Nullable: a hand-added line has no receipt behind it, and an OCR that could
-- not read a tax id must leave the column empty rather than carry a guess.

SET NOCOUNT ON;
SET XACT_ABORT ON;

IF OBJECT_ID('dbo.AccClearAdvanceItem', 'U') IS NULL
  RAISERROR ('Migration 140 expects dbo.AccClearAdvanceItem — wrong database?', 16, 1);
ELSE
BEGIN
  IF COL_LENGTH('dbo.AccClearAdvanceItem', 'TaxId') IS NULL
    ALTER TABLE [dbo].[AccClearAdvanceItem] ADD [TaxId] NVARCHAR(40) NULL;
  IF COL_LENGTH('dbo.AccClearAdvanceItem', 'PayeeName') IS NULL
    ALTER TABLE [dbo].[AccClearAdvanceItem] ADD [PayeeName] NVARCHAR(600) NULL;
  IF COL_LENGTH('dbo.AccClearAdvanceItem', 'PayeeAddress') IS NULL
    ALTER TABLE [dbo].[AccClearAdvanceItem] ADD [PayeeAddress] NVARCHAR(1000) NULL;
END
```

Widths match `AccClearAdvanceWht` so the same OCR value fits in both.

- [ ] **Step 2: Apply to UAT and Production**, then confirm all three columns
exist in both and every existing row reads NULL. The `mssql-rocks` MCP refuses
DDL — run the file through the app's own pool over both database names, as
migration 139 was.

- [ ] **Step 3: Carry them through the form**

`LineRow` gains `taxId`, `payeeName`, `payeeAddress` (all `string`). The OCR
apply at `ClearAdvanceForm.tsx:840-851` already has `r.taxId`, `r.payeeName` and
`r.payeeAddress` in hand and currently drops them for the line — pass them
through. The save payload maps each with `|| null`.

- [ ] **Step 3b: Accounting can fill them in**

The values come off the tax invoice, and accounting holds it — so they can type
what the OCR could not read (user, 2026-09-08). The same shape as the ภ.ง.ด.
type: the OCR suggests, the ACCOUNT step decides.

The inline editor at `ClearAdvanceDetail.tsx:381-400` already `PUT`s
`/account-edit` with `items: editItems`, so this is columns on a table that is
already saved and already ACCOUNT-guarded — no new route, as in Step 3 Task 4b.

Its columns today are #, วันที่, รายละเอียด, ก่อน VAT, VAT, WHT. Add three:

| Column | Field | Why it is needed |
| --- | --- | --- |
| เลขที่ใบกำกับ | `docNo` | Becomes `Tax Invoice No.` — **not editable anywhere today** |
| เลขผู้เสียภาษี | `taxId` | Becomes `Revolic VAT Registration No.` |
| ชื่อผู้ขาย | `payeeName` | Becomes `Tax Invoice Name` |

`docNo` is the one to notice: it already reaches BC as part of the description
and will become a tax field, and until now nobody could correct a misread one
after the request was submitted.

Widen the table's `minWidth` past 760 and keep it inside its `overflow-x-auto`
so the page still does not scroll sideways.

- [ ] **Step 4: Read and write them in the service**

`mapItemRow` gains the three; the `AccClearAdvanceItem` INSERT gains the columns
and inputs. Unlike the ภ.ง.ด. type there is no precedence puzzle: these are
transcription, not a decision, so the incoming value simply wins.

- [ ] **Step 5: Verify against a real save** — scan a receipt with a tax id,
save, then edit one at the ACCOUNT step and confirm accounting's value is what
survives. Read the row back:

```sql
SELECT DocNo, TaxId, PayeeName FROM Rocks_Portal_Form_UAT.dbo.AccClearAdvanceItem
ORDER BY Id DESC
```

- [ ] **Step 6: Commit**

---

## Task 2: One VAT line per invoice

**Files:**
- Modify: `src/lib/clr/clear-advance-erp-payload.ts` (the `vatTotal` branch)
- Test: `src/lib/clr/clear-advance-erp-payload.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
/* ── The VAT line is per invoice (spec §5.4) ───────────────────────────────
 *
 * It used to be one G/L line carrying the sum of every item's VAT. Tax Invoice
 * No., Date, Base and Name each belong to one invoice, and a summed line cannot
 * carry them for two.
 */

test("two receipts with VAT make two VAT lines", () => {
  const p = buildClearAdvanceJournalPayload(base({
    advanceAmount: 5000,
    items: [
      { glAccountNo: "610322005", amountBeforeVat: 1000, vatAmount: 70, whtAmount: 0, branchCode: "HQ01", docNo: "INV-A" },
      { glAccountNo: "610319001", amountBeforeVat: 2000, vatAmount: 140, whtAmount: 0, branchCode: "HQ01", docNo: "INV-B" },
    ],
  }));
  const vat = p.lines.filter((l) => l.accountNo === "115030");
  assert.equal(vat.length, 2);
  assert.deepEqual(vat.map((l) => l.amount), [70, 140]);
});

test("an item with no VAT makes no VAT line", () => {
  const p = buildClearAdvanceJournalPayload(base({
    advanceAmount: 5000,
    items: [
      { glAccountNo: "610322005", amountBeforeVat: 1000, vatAmount: 70, whtAmount: 0, branchCode: "HQ01", docNo: "INV-A" },
      { glAccountNo: "610319001", amountBeforeVat: 2000, vatAmount: 0, whtAmount: 0, branchCode: "HQ01", docNo: "INV-B" },
    ],
  }));
  assert.equal(p.lines.filter((l) => l.accountNo === "115030").length, 1);
});

/* Each VAT line belongs to its own receipt, so it takes that line's branch —
 * and its BU with it — rather than the request's default. */
test("a VAT line follows its own item's branch", () => {
  const p = buildClearAdvanceJournalPayload(base({
    advanceAmount: 5000,
    branchBu: new Map([
      ["PCCT01", { buCode: "CTPS", isBlocked: false }],
      ["HQ01", { buCode: "COCO", isBlocked: false }],
    ]),
    items: [
      { glAccountNo: "610322005", amountBeforeVat: 1000, vatAmount: 70, whtAmount: 0, branchCode: "PCCT01", docNo: "INV-A" },
      { glAccountNo: "610319001", amountBeforeVat: 2000, vatAmount: 140, whtAmount: 0, branchCode: "HQ01", docNo: "INV-B" },
    ],
  }));
  const vat = p.lines.filter((l) => l.accountNo === "115030");
  assert.deepEqual(vat.map((l) => l.branchCode), ["PCCT01", "HQ01"]);
  assert.deepEqual(vat.map((l) => l.buCode), ["CTPS", "COCO"]);
});

/* A VAT line on a prior-period receipt is part of that adjustment. */
test("a VAT line inherits its item's Z-ADJ marker", () => {
  const p = buildClearAdvanceJournalPayload(base({
    postingDate: "2026-09-08",
    items: [{ glAccountNo: "610322005", amountBeforeVat: 1000, vatAmount: 70, whtAmount: 0, branchCode: "HQ01", expenseDate: "2026-07-15" }],
  }));
  assert.equal(p.lines.find((l) => l.accountNo === "115030")!.adjCode, "M-ADJ");
});

test("the VAT total is unchanged by the split", () => {
  const p = buildClearAdvanceJournalPayload(base({
    advanceAmount: 5000,
    items: [
      { glAccountNo: "610322005", amountBeforeVat: 1000, vatAmount: 70, whtAmount: 0, branchCode: "HQ01" },
      { glAccountNo: "610319001", amountBeforeVat: 2000, vatAmount: 140, whtAmount: 0, branchCode: "HQ01" },
    ],
  }));
  const vat = p.lines.filter((l) => l.accountNo === "115030");
  assert.equal(vat.reduce((s, l) => s + l.amount, 0), 210);
});
```

- [ ] **Step 2: Run and watch them fail**

- [ ] **Step 3: Implement**

Move the VAT line inside the item loop: for each item whose `vatAmount` rounds
above 0, push a `glLine` at `c.vatInputGlAccountNo` for that item's VAT, with
**that item's** branch and Z-ADJ marker. Drop the `vatTotal` accumulator and the
single line after the loop. The account check
(`if (!c.vatInputGlAccountNo) throw`) moves with it and must still fire on the
first VAT-carrying item, not once at the end.

`ClrJournalItem` gains `docNo?: string | null` — the invoice number, needed by
Task 3 and easiest to add while the loop is being rewritten.

- [ ] **Step 4: Run tests and typecheck** — the existing single-VAT-line tests
change count, not intent; check each one still asks what it asked.

- [ ] **Step 5: Commit**

---

## Task 3: The ten columns

**Files:**
- Modify: `src/lib/acc/erp-ppap-payload.ts`, `src/lib/clr/clear-advance-erp-payload.ts`, `clear-advance-erp-send.ts`
- Test: `src/lib/clr/clear-advance-erp-payload.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test("a VAT line carries the posting-group trio", () => {
  const p = buildClearAdvanceJournalPayload(base({
    items: [{ glAccountNo: "610322005", amountBeforeVat: 1000, vatAmount: 70, whtAmount: 0, branchCode: "HQ01" }],
  }));
  const vat = p.lines.find((l) => l.accountNo === "115030")!;
  assert.equal(vat.genPostingType, "Purchase");
  assert.equal(vat.vatBusPostingGroup, "VATHO");
  assert.equal(vat.vatProdPostingGroup, "FVAT");
});

/* Only the VAT line. A posting group on an expense, vendor or bank line would
 * change how BC treats it. */
test("no other line carries them", () => {
  const p = buildClearAdvanceJournalPayload(base({
    items: [{ glAccountNo: "610322005", amountBeforeVat: 1000, vatAmount: 70, whtAmount: 0, branchCode: "HQ01" }],
  }));
  for (const l of p.lines.filter((x) => x.accountNo !== "115030")) {
    assert.equal(l.genPostingType, undefined, `${l.accountType} ${l.accountNo}`);
    assert.equal(l.vatBusPostingGroup, undefined);
    assert.equal(l.vatProdPostingGroup, undefined);
  }
});

test("a VAT line carries its invoice's number, date and base", () => {
  const p = buildClearAdvanceJournalPayload(base({
    postingDate: "2026-09-08",
    items: [{
      glAccountNo: "610322005", amountBeforeVat: 1000, vatAmount: 70, whtAmount: 0,
      branchCode: "HQ01", docNo: "INV-A", expenseDate: "2026-09-02",
      taxId: "0105500000001", payeeName: "บริษัท ทดสอบ จำกัด",
    }],
  }));
  const vat = p.lines.find((l) => l.accountNo === "115030")!;
  assert.equal(vat.taxInvoiceNo, "INV-A");
  assert.equal(vat.taxInvoiceDate, "2026-09-02");
  assert.equal(vat.taxInvoiceBase, 1000);
  assert.equal(vat.taxInvoiceName, "บริษัท ทดสอบ จำกัด");
  assert.equal(vat.taxVatRegistrationNo, "0105500000001");
});

/* Absence stays absence, as everywhere else in this payload: a receipt the OCR
 * could not read sends no key rather than an empty string, so the field in BC
 * stays untouched instead of being overwritten with nothing. */
test("a receipt with no seller sends no seller keys", () => {
  const p = buildClearAdvanceJournalPayload(base({
    items: [{ glAccountNo: "610322005", amountBeforeVat: 1000, vatAmount: 70, whtAmount: 0, branchCode: "HQ01", docNo: "INV-A" }],
  }));
  const vat = p.lines.find((l) => l.accountNo === "115030")!;
  assert.equal("taxInvoiceName" in vat, false);
  assert.equal("taxVatRegistrationNo" in vat, false);
  // The invoice number is still there — it does not depend on the seller.
  assert.equal(vat.taxInvoiceNo, "INV-A");
});

/* The date is the invoice's, not the journal's. They differ exactly when the
 * receipt is from another month, which is the case Step 1 marks with M-ADJ. */
test("no expense date leaves the tax invoice date out", () => {
  const p = buildClearAdvanceJournalPayload(base({
    items: [{ glAccountNo: "610322005", amountBeforeVat: 1000, vatAmount: 70, whtAmount: 0, branchCode: "HQ01" }],
  }));
  assert.equal("taxInvoiceDate" in p.lines.find((l) => l.accountNo === "115030")!, false);
});
```

- [ ] **Step 2: Run and watch them fail**

- [ ] **Step 3: Implement**

`PpapJournalLinePayload` gains, all optional:
`genPostingType`, `vatBusPostingGroup`, `vatProdPostingGroup`, `taxInvoiceNo`,
`taxInvoiceDate`, `taxInvoiceBase`, `taxInvoiceName`, `taxVatRegistrationNo`,
`taxVendorNo`. `ClrJournalItem` gains `taxId` and `payeeName`.

Constants live beside the code that uses them:

```ts
/** Sheet row 8, constant for every AP-3 VAT line (user, 2026-09-08). */
const VAT_GEN_POSTING_TYPE = "Purchase";
const VAT_BUS_POSTING_GROUP = "VATHO";
const VAT_PROD_POSTING_GROUP = "FVAT";
```

Every key is spread in only when it has a value, the `...(x ? { x } : null)`
shape the rest of this payload uses.

**`taxVendorNo` is not sent.** AP-3 matches no vendor for a seller — the only
vendor it knows is the one the advance was drawn against. The field is in the
type because the codeunit will accept it and because `Tax Vendor No.`'s
`OnValidate` fills the name, branch and VAT registration from the vendor card;
the day AP-3 learns to match sellers, sending it replaces three other keys.

- [ ] **Step 4: The sender passes the new item fields** — `toJournalItems` in
`clear-advance-erp-send.ts` maps `docNo`, `taxId` and `payeeName` across.

- [ ] **Step 5: Run tests and typecheck, then commit**

---

## Task 4: The codeunit reads them

**Files:** `R:\PPFunction\AL\ALProject12_SalesTran\ACCForm\AP\APJournalCreate.al`

- [ ] **Step 1: Back up** — `APJournalCreate.al.bak-vat`, beside the existing
`.bak-bu`.

- [ ] **Step 2: Document Date stops being forced**

`:188` reads `GenJnlLine."Document Date" := GenJnlLine."Posting Date";`. It
becomes: use `documentDate` from the payload when given, else Posting Date. A
payload without the key behaves exactly as today.

- [ ] **Step 3: Read the ten keys**

Each through the existing graceful helpers (`GetJsonText`, `GetJsonDate`,
`GetJsonDecimal`), each applied only when non-blank, so a payload without them is
byte-for-byte what it is now — the same discipline `buCode` follows.

Standard fields, `Validate()`d so BC recalculates what depends on them:
`Gen. Posting Type`, `VAT Bus. Posting Group`, `VAT Prod. Posting Group`.

NWTH fields, assigned by their **field names, not the sheet's captions**:
`Tax Vendor No.` (Validate — its OnValidate fills three others),
`Tax Invoice No.`, `Tax Invoice Name`, `Tax Invoice Base`, `Tax Invoice Date`,
`Branch Code`, `Revolic VAT Registration No.`

Order matters: set `Tax Vendor No.` **first** if it is ever sent, then let the
explicit keys overwrite what its trigger filled. Otherwise the trigger wins over
a seller the OCR read from the receipt.

- [ ] **Step 4: Compile and publish** — in VS Code; the NWTH symbols are already
in `.alpackages`. Bump `app.json` to `1.0.0.206`.

- [ ] **Step 5: Confirm it is inert** — send one AP-3 clearing built by the
*current* portal build (no new keys) and check nothing changed.

---

## Task 5: Prove it in BC

- [ ] **Step 1: Send a clearing with two VAT receipts**, different sellers,
different branches, one of them prior-period.

- [ ] **Step 2: Confirm at the wire** — preview plus a temporary file log,
removed straight after.

- [ ] **Step 3: Confirm in BC** — as Steps 2c and 3 taught, "Sent" proves only
that the payload was accepted. Open the batch, find the document, and read the
VAT lines' Tax Invoice No., Tax Invoice Name and the three posting-group fields.

- [ ] **Step 4: Record the document number.**

---

## Done

- `npm test` at or above baseline; `npx tsc --noEmit` clean of source errors.
- A receipt's seller surviving from the OCR to the database.
- One VAT line per invoice, each with its own number, date, base and seller.
- The posting-group trio on VAT lines and on nothing else.
- One BC document whose VAT lines carry all ten, read back in BC.

**Not in this plan:** matching a seller to a BC vendor (which would let
`Tax Vendor No.` replace three keys); editing the seller on screen; retiring the
now-unused WHT-payable G/L setting.
