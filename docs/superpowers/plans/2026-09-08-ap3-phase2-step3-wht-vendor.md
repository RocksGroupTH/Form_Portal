# AP-3 Phase 2 Step 3 — the WHT line becomes a Vendor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send the withholding-tax line as a **Vendor** line at `WHT-PND.3` or `WHT-PND.53` — the account accounting actually clears — instead of the G/L account it carries today, with the ภ.ง.ด. type suggested from the payee's tax id and confirmed by accounting.

**Architecture:** Four thin layers, each testable on its own. A pure rule turns a tax id into a suggested type. A nullable column stores what was decided. The ACCOUNT step lets accounting change it. The journal builder turns stored types into vendor lines. Nothing guesses at send time: an unset type stops the send with a readable message.

**Tech Stack:** TypeScript, `node:test` via `npm test`; MSSQL migration; React for the ACCOUNT-step editor.

**Spec:** `docs/superpowers/specs/2026-09-08-ap3-phase2-erp-fields-design.md` §5.3, §5.3a

---

## What is already there, and what is not

`AccClearAdvanceWht` already holds `TaxId`, `PayeeName` and `PayeeAddress` per
payee, the OCR already extracts a 13-digit `taxId` (`ai-receipt-core.ts:439`),
and the form already refuses a WHT amount without them. **No OCR work is
needed** — the input exists.

What is missing is only: somewhere to keep the decision, a way for accounting to
make it, and the send using it.

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `src/lib/clr/wht-pnd-core.ts` | Tax id → suggested ภ.ง.ด. type | **new** |
| `src/lib/clr/wht-pnd-core.test.ts` | Its tests | **new** |
| `migrations/139_wht_pnd_type.sql` | `PndType` on `AccClearAdvanceWht` | **new** |
| `src/features/clear-advance/types.ts:27-40` | `ClearAdvanceWhtItem` | `pndType` field |
| `src/lib/clr/clear-advance-request-service.ts` | Read + write WHT rows | map, insert, suggest on save |
| `src/features/clear-advance/components/ClearAdvanceForm.tsx:1440-1530` | WHT payee table the requester fills | a ภ.ง.ด. column |
| `src/features/clear-advance/components/ClearAdvanceDetail.tsx:637` | WHT block, read-only today | ACCOUNT-step editor |
| `src/app/api/request/clear-advance/[id]/wht-type/route.ts` | Save one row's type | **new** |
| `src/lib/clr/clear-advance-erp-payload.ts` | Journal builder | vendor lines replace the G/L line |
| `src/lib/clr/clear-advance-erp-send.ts` | Loads the request | pass the WHT rows through |

---

## Task 1: The rule

**Files:**
- Create: `src/lib/clr/wht-pnd-core.ts`
- Test: `src/lib/clr/wht-pnd-core.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { PND_VENDOR_NO, suggestPndType } from "./wht-pnd-core";

/* A juristic person is registered by the DBD with a number beginning 0; an
 * individual uses a national id, which begins 1-8. Measured against the 2,178
 * vendors in ErpVendors holding a clean 13-digit id: of those beginning 0, 1,692
 * read as juristic against 83 that do not; of those beginning with anything
 * else, exactly one does out of 403. */
test("a leading zero suggests a juristic person", () => {
  assert.equal(suggestPndType("0105500000001"), "PND53");
});

test("any other leading digit suggests an individual", () => {
  for (const id of ["1101700207999", "3100600123456", "5000000000001"]) {
    assert.equal(suggestPndType(id), "PND3");
  }
});

test("spaces and dashes are not part of the number", () => {
  assert.equal(suggestPndType(" 0-1055-00000-00-1 "), "PND53");
});

/* Null is an answer here: it means nobody has decided yet, which is different
 * from deciding "individual". A guess made from an unreadable id would be
 * indistinguishable from a person's judgement once it is stored. */
test("anything that is not 13 clean digits suggests nothing", () => {
  for (const id of ["", "   ", "0105", "01055000000012", "abc", null, undefined]) {
    assert.equal(suggestPndType(id), null);
  }
});

test("each type names the vendor accounting clears", () => {
  assert.equal(PND_VENDOR_NO.PND3, "WHT-PND.3");
  assert.equal(PND_VENDOR_NO.PND53, "WHT-PND.53");
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: `# fail 5` — the module does not exist.

- [ ] **Step 3: Write the rule**

```ts
/**
 * The payee's ภ.ง.ด. type, suggested from their tax id.
 *
 * A Thai 13-digit tax id carries this already: juristic persons are registered
 * by the DBD with a number beginning 0, individuals use a national id beginning
 * 1-8. No DBD call is needed, which is why the requirement's lookup was dropped
 * (spec §5.3a).
 *
 * **It suggests; it never decides.** Some individuals do hold 0-prefixed ids —
 * foreigners issued one by the Revenue Department — so accounting confirms the
 * type at the ACCOUNT step and can change it.
 */
export type PndType = "PND3" | "PND53";

/** The BC vendor each type clears against. Both exist for PCTH, KSI and UNO. */
export const PND_VENDOR_NO: Record<PndType, string> = {
  PND3: "WHT-PND.3",
  PND53: "WHT-PND.53",
};

export function suggestPndType(taxId: string | null | undefined): PndType | null {
  const digits = (taxId ?? "").replace(/\D/g, "");
  if (digits.length !== 13) return null;
  return digits.startsWith("0") ? "PND53" : "PND3";
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npm test 2>&1 | grep -E "^# (pass|fail)"` — expected `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/clr/wht-pnd-core.ts src/lib/clr/wht-pnd-core.test.ts
git commit -m "feat(ap-3): the payee's tax id suggests a ภ.ง.ด. type"
```

---

## Task 2: Somewhere to keep the decision

**Files:**
- Create: `migrations/139_wht_pnd_type.sql`
- Modify: `src/features/clear-advance/types.ts:27-40`

- [ ] **Step 1: Write the migration**

```sql
-- The ภ.ง.ด. type decided for one WHT payee — what picks the BC vendor at send
-- time (WHT-PND.3 / WHT-PND.53).
--
-- Nullable on purpose, and NULL is not a default: it means nobody has decided.
-- A tax id that is not 13 clean digits suggests nothing, and the send refuses a
-- clearing whose WHT has no type rather than choosing a vendor for accounting.
--
-- Existing rows stay NULL. They are already sent; back-filling them from the
-- rule would put a machine's guess where a person's decision belongs, and make
-- the two indistinguishable afterwards.

SET NOCOUNT ON;
SET XACT_ABORT ON;

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.AccClearAdvanceWht') AND name = 'PndType'
)
  ALTER TABLE [dbo].[AccClearAdvanceWht] ADD [PndType] NVARCHAR(10) NULL;
```

- [ ] **Step 2: Apply it to UAT and Production**

AP-3 runs UAT-gated, but the column goes to both so the schemas do not drift —
the same order AP-3 Phase 1 used (`Rocks_Portal_Form_UAT` first, then
`Rocks_Portal_Form`).

Verify: the column exists in both, and every existing row reads NULL.

- [ ] **Step 3: Add it to the type**

In `src/features/clear-advance/types.ts`, after `payeeAddress`:

```ts
  /** ภ.ง.ด. type deciding the BC vendor. Null = nobody has decided yet. */
  pndType?: "PND3" | "PND53" | null;
```

- [ ] **Step 4: Commit**

```bash
git add migrations/139_wht_pnd_type.sql src/features/clear-advance/types.ts
git commit -m "feat(ap-3): a column for the ภ.ง.ด. decision"
```

---

## Task 3: Suggest on save, read it back

**Files:**
- Modify: `src/lib/clr/clear-advance-request-service.ts:139-154` (`mapWhtRow`), `:540-559` (the insert)

- [ ] **Step 1: Read the column**

In `mapWhtRow`, after `payeeAddress`:

```ts
    pndType: (x.PndType as "PND3" | "PND53" | null) ?? null,
```

- [ ] **Step 2: Write it, suggesting only where nothing was decided**

Import `suggestPndType` from `@/lib/clr/wht-pnd-core`, then in the WHT insert
loop add the input and the column:

```ts
      // The row's own type wins; the tax id only fills a blank. A save must
      // never overwrite what accounting chose — the rows are deleted and
      // re-inserted on every save, so a suggestion applied unconditionally would
      // quietly revert their decision on the next edit.
      .input("pnd", sql.NVarChar, w.pndType ?? suggestPndType(w.taxId))
```

and in the SQL, `PndType` in the column list with `@pnd` in `VALUES`.

- [ ] **Step 3: Run tests and typecheck**

Run: `npm test 2>&1 | grep -E "^# (pass|fail)"` then `npx tsc --noEmit`.

- [ ] **Step 4: Verify against a real save**

Open an AP-3 draft with a WHT payee, save, then:

```sql
SELECT TaxId, PayeeName, PndType FROM Rocks_Portal_Form_UAT.dbo.AccClearAdvanceWht
ORDER BY Id DESC
```

Expected: a `0`-prefixed id reads `PND53`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/clr/clear-advance-request-service.ts
git commit -m "feat(ap-3): store the suggested ภ.ง.ด. type with the payee"
```

---

## Task 4: The requester chooses, accounting can change it

Two edit points. The requester holds the receipt and knows who they paid;
accounting knows what the distinction means for the filing and sits last before
the send.

### Task 4a: the column on the form

**Files:**
- Modify: `src/features/clear-advance/components/ClearAdvanceForm.tsx:181-193` (`whtRows` state), `:1440-1530` (the WHT table), `:519` (the save payload)

- [ ] **Step 1: Carry it in the row state**

`WhtRow` gains `pndType: "PND3" | "PND53" | ""`, seeded from
`w.pndType ?? ""` in the initialiser at `:181`.

- [ ] **Step 2: A column in the table**

A `<select>` beside ที่อยู่, disabled under `readOnly` like every other cell:
`— ยังไม่ระบุ —`, `ภ.ง.ด. 3`, `ภ.ง.ด. 53`.

Seed it from `suggestPndType(w.taxId)` when a row arrives from the OCR
(`:920-925`) and when the tax id is edited on a row nobody has set a type on —
never on a row that already carries one, or editing a typo in the id would
silently undo a deliberate choice.

- [ ] **Step 3: Send it with the save**

At `:519`, include `pndType: w.pndType || null` in the mapped `whtItems`.

**No new route:** the existing save already writes the WHT rows, and Task 3
already stores the column.

- [ ] **Step 4: Verify on screen** — set a type, save, reload, confirm it stuck;
then check the row in `AccClearAdvanceWht`.

- [ ] **Step 5: Commit**

### Task 4b: the control at the ACCOUNT step

**Files:**
- Create: `src/app/api/request/clear-advance/[id]/wht-type/route.ts`
- Modify: `src/features/clear-advance/components/ClearAdvanceDetail.tsx:637-660`

- [ ] **Step 1: The route**

`POST` with `{ whtId, pndType }`, `pndType` one of `PND3`, `PND53` or `null`.
Guarded the way the existing line editor is — **the ACCOUNT step only**, the same
rule its own note states ("แก้ไขได้เฉพาะในขั้นบัญชี (ACCOUNT) เท่านั้น"). Read
that guard and copy it rather than inventing a second one.

- [ ] **Step 2: The control**

The WHT block at `:637` renders payee rows read-only. Add a ภ.ง.ด. column: plain
text outside the ACCOUNT step, a small select inside it, with the three states
visible — `ภ.ง.ด. 3`, `ภ.ง.ด. 53`, and `— ยังไม่ระบุ —`.

Where the value came from must be visible, because the two are not equally
trustworthy: mark a value the rule suggested and nobody has confirmed as
*แนะนำจากเลขผู้เสียภาษี*. A tax id beginning `0` can still belong to a person.

- [ ] **Step 3: Verify on screen**

Approve a clearing to the ACCOUNT step, change a type the requester already set,
reload, and confirm accounting's value is the one that survived.

- [ ] **Step 4: Commit**

---

## Task 5: The send emits vendor lines

**Files:**
- Modify: `src/lib/clr/clear-advance-erp-payload.ts:135-141`, `src/lib/clr/clear-advance-erp-send.ts`
- Test: `src/lib/clr/clear-advance-erp-payload.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
/* ── The WHT line is a Vendor (spec §5.3, sheet rows 10-11) ────────────────
 *
 * What went before was a G/L line at the configured WHT-payable account: the
 * wrong kind of line pointing at the wrong kind of account. Accounting clears
 * these against the vendor.
 */

test("WHT goes out as a Vendor line at the type's vendor", () => {
  const p = buildClearAdvanceJournalPayload(base({
    items: [{ glAccountNo: "610322005", amountBeforeVat: 1000, vatAmount: 0, whtAmount: 30, branchCode: "HQ01" }],
    whtPayees: [{ pndType: "PND53" }],
  }));
  const wht = p.lines.find((l) => l.accountNo === "WHT-PND.53")!;
  assert.equal(wht.accountType, "Vendor");
  // Spec §3.2: sent as 0 — accounting posts the real amount by hand.
  assert.equal(wht.amount, 0);
  assert.equal(p.lines.some((l) => l.accountNo === "213050"), false);
});

test("an individual payee clears against WHT-PND.3", () => {
  const p = buildClearAdvanceJournalPayload(base({
    items: [{ glAccountNo: "610322005", amountBeforeVat: 1000, vatAmount: 0, whtAmount: 30, branchCode: "HQ01" }],
    whtPayees: [{ pndType: "PND3" }],
  }));
  assert.ok(p.lines.some((l) => l.accountType === "Vendor" && l.accountNo === "WHT-PND.3"));
});

/* Every amount is 0, so a line's only content is which vendor account has to be
 * cleared. Two payees of one type would make two identical empty lines. */
test("two payees of one type make one line", () => {
  const p = buildClearAdvanceJournalPayload(base({
    items: [{ glAccountNo: "610322005", amountBeforeVat: 1000, vatAmount: 0, whtAmount: 30, branchCode: "HQ01" }],
    whtPayees: [{ pndType: "PND3" }, { pndType: "PND3" }],
  }));
  assert.equal(p.lines.filter((l) => l.accountNo === "WHT-PND.3").length, 1);
});

test("two types make one line each", () => {
  const p = buildClearAdvanceJournalPayload(base({
    items: [{ glAccountNo: "610322005", amountBeforeVat: 1000, vatAmount: 0, whtAmount: 30, branchCode: "HQ01" }],
    whtPayees: [{ pndType: "PND3" }, { pndType: "PND53" }],
  }));
  assert.equal(p.lines.filter((l) => l.accountType === "Vendor" && l.accountNo.startsWith("WHT-")).length, 2);
});

/* Refusing is the feature. Picking a vendor for accounting would put a guess
 * into their ledger under their name, and a 0-amount line is easy to miss. */
test("WHT with no decided type refuses the send", () => {
  assert.throws(() => buildClearAdvanceJournalPayload(base({
    items: [{ glAccountNo: "610322005", amountBeforeVat: 1000, vatAmount: 0, whtAmount: 30, branchCode: "HQ01" }],
    whtPayees: [{ pndType: null }],
  })), /ภ\.ง\.ด/);
});

test("no WHT at all sends no WHT line and no error", () => {
  const p = buildClearAdvanceJournalPayload(base({}));
  assert.equal(p.lines.some((l) => l.accountNo.startsWith("WHT-")), false);
});
```

- [ ] **Step 2: Run and watch them fail**

- [ ] **Step 3: Implement**

`ClrJournalInput` gains `whtPayees?: { pndType?: "PND3" | "PND53" | null }[]`.
Replace the `whtTotal > 0` G/L branch with: collect the distinct types across
`whtPayees`; throw a Thai message naming the request when any payee has none;
emit one Vendor line per distinct type, amount 0, built like the advance-vendor
line — `accountType: "Vendor"`, **no `balAccountType`** — the two-explicit-lines
shape BC accepted for AP-2.

`config.whtPayableGlAccountNo` becomes unused by the builder. **Leave the setting
in place**: Step 4's VAT work is not done, the field is still shown in settings,
and removing it is a separate change with its own blast radius.

- [ ] **Step 4: The sender passes the payees**

In `clear-advance-erp-send.ts`, both call sites already load the request; pass
`whtPayees: req.clear.whtItems ?? []`.

- [ ] **Step 5: Run tests and typecheck, then commit**

---

## Task 6: Prove it in BC

- [ ] **Step 1: Send a clearing with WHT**

Drive one through the ACCOUNT step, set the type deliberately, send it. The
`ACC_MANAGER_DEV_BYPASS=1` note from Step 2c applies — **take it out afterwards.**

- [ ] **Step 2: Confirm what was sent** — preview plus a temporary wire log,
removed straight after. Expect a `Vendor` line at `WHT-PND.53` (or `.3`) with
amount 0 and no `213050` line.

- [ ] **Step 3: Confirm in BC** — as Step 2c proved the BU: the send answering
"Sent" is not proof the line landed as a Vendor. Open the batch, find the
document, and check the line's Account Type and Account No.

- [ ] **Step 4: Record the document number.**

---

## Done

- `npm test` at or above baseline; `npx tsc --noEmit` clean of source errors.
- A tax id suggesting a type, the requester able to change it, and accounting
  able to change it again.
- One BC document whose WHT line is a Vendor at `WHT-PND.3` or `WHT-PND.53`.
- A clearing with an undecided type refused, with a message that says why.

**Not in this plan:** Step 4's VAT and tax block; retiring the now-unused
WHT-payable G/L setting.
