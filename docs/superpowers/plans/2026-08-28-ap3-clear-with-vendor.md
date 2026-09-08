# AP-3 Clear-with-Vendor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AP-3's clearing journal credit the **Vendor** that the AP-2 it clears debited, instead of a G/L advance account, so the two forms actually reverse each other in BC.

**Architecture:** Only the advance-reversal line of the payload changes (amounts untouched, still sums to zero). The vendor number is read from `AccAdvance.MatchedVendorNo` of the linked AP-2 (`AccClearAdvance.AdvanceRequestId`), resolved in the AP-3 ERP context and passed through the existing config object. A missing vendor is a pre-flight refusal, never a fallback.

**Tech Stack:** TypeScript, Next.js 15/16 App Router, `mssql` (T-SQL), node:test. Verify with `npm run typecheck` + `npm test`. **Never run `npm run build`** — it shares `.next` with the running dev server and breaks it.

**Spec:** `docs/superpowers/specs/2026-08-28-ap3-clear-with-vendor-design.md`
**Branch:** `feat/ap3-clear-vendor` (already checked out)

---

## File Structure

| File | Responsibility after this change |
|---|---|
| `src/lib/clr/clear-advance-erp-payload.ts` | Pure payload builder. Config carries `advanceVendorNo` (was `advanceGlAccountNo`); the reversal line is a Vendor credit. |
| `src/lib/clr/clear-advance-erp-payload.test.ts` | Unit tests for the builder, including the new Vendor line and its guard. |
| `src/lib/clr/clear-advance-erp-context.ts` | Resolves config + BC target. Now also resolves the linked AP-2's matched vendor; no longer inherits AP-2's G/L. |
| `src/lib/clr/clear-advance-erp-send.ts` | Preview + send orchestration. Passes `advanceRequestId` into the context at both call sites. |

Tasks are ordered so the pure builder (and its tests) changes first, then the context that feeds it, then the two call sites. Task 1 alone leaves the tree type-broken (the context still passes `advanceGlAccountNo`), so **Tasks 1–3 land as one commit** at the end of Task 3; Task 4 is the test-only follow-up. This is deliberate: splitting a renamed field across commits would leave a non-compiling tree.

---

## Task 1: Payload builds a Vendor credit line

**Files:**
- Modify: `src/lib/clr/clear-advance-erp-payload.ts`

- [ ] **Step 1: Rename the config field**

In `src/lib/clr/clear-advance-erp-payload.ts`, change the `ClrJournalConfig` interface (line 3-9). Replace:

```ts
export interface ClrJournalConfig {
  advanceGlAccountNo: string;
```

with:

```ts
export interface ClrJournalConfig {
  /** The vendor AP-2 debited — this clearing credits the same one. */
  advanceVendorNo: string;
```

Leave `bankAccountNo`, `vatInputGlAccountNo`, `whtPayableGlAccountNo`, `journalBatchName` exactly as they are.

- [ ] **Step 2: Update the guard**

Still in the same file, replace this line (currently line 37):

```ts
  if (!c.advanceGlAccountNo) throw new Error("ยังไม่ได้ตั้งค่า G/L เงินทดรองจ่าย (จาก AP-2) สำหรับแบรนด์นี้");
```

with:

```ts
  if (!c.advanceVendorNo) throw new Error("ยังไม่ได้เลือก Vendor ในใบเบิก AP-2 ที่เคลียร์ใบนี้ — เปิดใบ AP-2 แล้วเลือก Vendor ก่อนส่ง");
```

- [ ] **Step 3: Replace the G/L reversal line with a Vendor line**

Still in the same file, replace this line (currently line 70):

```ts
  lines.push(glLine(c.advanceGlAccountNo, -r2(input.advanceAmount), null));
```

with:

```ts
  // Cr the vendor AP-2 debited. Built inline rather than via glLine because the
  // vendor line must carry accountType "Vendor" and NO balAccountType — the
  // two-explicit-lines shape BC accepted for AP-2 (doc PVA2608-0012).
  lines.push({
    groupNo: "G1", postingDate, documentType: "Payment",
    accountType: "Vendor", accountNo: c.advanceVendorNo,
    description: `เคลียร์เงินทดรองจ่าย ${requestNo}`.slice(0, 100),
    paymentMethodCode: "BANK", amount: -r2(input.advanceAmount),
    employeeCode, branchCode: defaultBranch, departmentCode,
  });
```

- [ ] **Step 4: Update the doc comment**

Still in the same file, replace this comment line (currently line 32):

```ts
 * Dr expenses (per item) + Dr VAT input - Cr WHT payable - Cr advance +/- Bank diff.
```

with:

```ts
 * Dr expenses (per item) + Dr VAT input - Cr WHT payable - Cr advance Vendor +/- Bank diff.
```

- [ ] **Step 5: Do NOT commit yet**

The tree does not compile until Task 3 — `clear-advance-erp-context.ts` still sets `advanceGlAccountNo`. Continue to Task 2.

---

## Task 2: Context resolves the AP-2's matched vendor

**Files:**
- Modify: `src/lib/clr/clear-advance-erp-context.ts`

- [ ] **Step 1: Add the pool import**

At the top of `src/lib/clr/clear-advance-erp-context.ts`, the current imports are:

```ts
import { loadAdvanceErpContext } from "@/lib/adv/advance-erp-context";
import { listClrInterfaceConfig } from "@/lib/clr/clear-advance-interface-config-service";
import type { ClrJournalConfig } from "@/lib/clr/clear-advance-erp-payload";
import type { AdvanceErpTarget } from "@/lib/adv/advance-erp-context";
```

Add this as the first line:

```ts
import { getAccPool, sql } from "@/lib/acc/pool";
```

- [ ] **Step 2: Add the vendor lookup helper**

In the same file, immediately above the exported `loadClearAdvanceErpContext` function, add:

```ts
/**
 * The vendor AP-2 debited for the advance this AP-3 clears.
 *
 * Read live from `AccAdvance` rather than copied onto the AP-3 row: the officer
 * can still change the vendor on the AP-2 up to its approval, and the clearing
 * must credit whatever was actually posted.
 */
async function resolveAdvanceVendorNo(advanceRequestId: number): Promise<string | null> {
  const pool = await getAccPool();
  const res = await pool
    .request()
    .input("rid", sql.Int, advanceRequestId)
    .query(`SELECT TOP 1 MatchedVendorNo FROM [dbo].[AccAdvance] WHERE RequestId = @rid`);
  const raw = (res.recordset[0]?.MatchedVendorNo as string) ?? "";
  return raw.trim() || null;
}
```

- [ ] **Step 3: Take the advance id and resolve the vendor**

In the same file, replace the whole `loadClearAdvanceErpContext` function body's signature and AP-2 guard. The function currently reads:

```ts
export async function loadClearAdvanceErpContext(
  brandCode: string,
  hrDeptCode?: string | null,
): Promise<ClrErpContext> {
  const code = brandCode.trim().toUpperCase();
  const [ap2, clrMap] = await Promise.all([
    loadAdvanceErpContext(code, hrDeptCode ?? null),
    listClrInterfaceConfig(),
  ]);
  const clr = clrMap[code] ?? { journalBatchName: null, vatInputGlAccountNo: null, whtPayableGlAccountNo: null };

  if (!ap2.config.glAccountNo) throw new Error(`ยังไม่ได้ตั้งค่า G/L เงินทดรองจ่าย (AP-2) สำหรับ ${code}`);
  if (!ap2.config.bankAccountNo) throw new Error(`ยังไม่ได้ตั้งค่า Bank Account (AP-2) สำหรับ ${code}`);
  if (!clr.journalBatchName) throw new Error(`ยังไม่ได้ตั้งค่า Journal Batch ของ AP-3 สำหรับ ${code}`);

  return {
    config: {
      advanceGlAccountNo: ap2.config.glAccountNo,
      bankAccountNo: ap2.config.bankAccountNo,
      vatInputGlAccountNo: clr.vatInputGlAccountNo,
      whtPayableGlAccountNo: clr.whtPayableGlAccountNo,
      journalBatchName: clr.journalBatchName,
    },
    target: ap2.target,
    departmentCode: ap2.erpDeptCode,
    branchCode: ap2.config.branchCode ?? null,
  };
}
```

Replace it with:

```ts
export async function loadClearAdvanceErpContext(
  brandCode: string,
  hrDeptCode?: string | null,
  advanceRequestId?: number | null,
): Promise<ClrErpContext> {
  const code = brandCode.trim().toUpperCase();
  if (advanceRequestId == null) {
    throw new Error("ใบเคลียร์นี้ไม่ได้ผูกกับใบเบิก AP-2 — ส่ง ERP ไม่ได้");
  }
  const [ap2, clrMap, advanceVendorNo] = await Promise.all([
    loadAdvanceErpContext(code, hrDeptCode ?? null),
    listClrInterfaceConfig(),
    resolveAdvanceVendorNo(advanceRequestId),
  ]);
  const clr = clrMap[code] ?? { journalBatchName: null, vatInputGlAccountNo: null, whtPayableGlAccountNo: null };

  // No G/L fallback on purpose: AP-2 posts the debit to a vendor, so the
  // clearing credit must go to the same vendor or the vendor never clears.
  if (!advanceVendorNo) {
    throw new Error("ยังไม่ได้เลือก Vendor ในใบเบิก AP-2 ที่เคลียร์ใบนี้ — เปิดใบ AP-2 แล้วเลือก Vendor ก่อนส่ง");
  }
  if (!ap2.config.bankAccountNo) throw new Error(`ยังไม่ได้ตั้งค่า Bank Account (AP-2) สำหรับ ${code}`);
  if (!clr.journalBatchName) throw new Error(`ยังไม่ได้ตั้งค่า Journal Batch ของ AP-3 สำหรับ ${code}`);

  return {
    config: {
      advanceVendorNo,
      bankAccountNo: ap2.config.bankAccountNo,
      vatInputGlAccountNo: clr.vatInputGlAccountNo,
      whtPayableGlAccountNo: clr.whtPayableGlAccountNo,
      journalBatchName: clr.journalBatchName,
    },
    target: ap2.target,
    departmentCode: ap2.erpDeptCode,
    branchCode: ap2.config.branchCode ?? null,
  };
}
```

- [ ] **Step 4: Update the function's doc comment**

In the same file, the comment above the function currently says:

```
 * Advance GL / Bank / target Company / ERP dept are inherited from AP-2's config
 * (loadAdvanceErpContext). Journal Batch + VAT-input + WHT-payable come from AP-3's
 * own AccClearAdvanceInterfaceConfig.
```

Replace those three lines with:

```
 * Bank / target Company / ERP dept are inherited from AP-2's config
 * (loadAdvanceErpContext); the advance vendor is read from the linked AP-2 request.
 * Journal Batch + VAT-input + WHT-payable come from AP-3's own
 * AccClearAdvanceInterfaceConfig.
```

- [ ] **Step 5: Do NOT commit yet** — the two call sites in Task 3 still omit the new argument.

---

## Task 3: Pass the advance id from both call sites

**Files:**
- Modify: `src/lib/clr/clear-advance-erp-send.ts` (two call sites)

- [ ] **Step 1: Update the preview call site**

In `src/lib/clr/clear-advance-erp-send.ts`, inside `previewClrErpJournal` (currently line 210), replace:

```ts
      const { config, target, departmentCode } = await loadClearAdvanceErpContext(req.brandCode, req.requesterDepartmentCode);
```

with:

```ts
      const { config, target, departmentCode } = await loadClearAdvanceErpContext(req.brandCode, req.requesterDepartmentCode, req.clear.advanceRequestId);
```

- [ ] **Step 2: Update the send call site**

In the same file, inside `sendClrErpBatch` (currently line 329), replace the identical line:

```ts
      const { config, target, departmentCode } = await loadClearAdvanceErpContext(req.brandCode, req.requesterDepartmentCode);
```

with:

```ts
      const { config, target, departmentCode } = await loadClearAdvanceErpContext(req.brandCode, req.requesterDepartmentCode, req.clear.advanceRequestId);
```

Both sites already guard `if (!req.clear)` above, so `req.clear.advanceRequestId` is safe to read. It is typed `number | null`, which the new third parameter accepts.

- [ ] **Step 3: Verify the tree compiles**

Run: `cd /r/Form_Portal && npm run typecheck`
Expected: clean, no errors. If `advanceGlAccountNo` still appears anywhere, run `grep -rn "advanceGlAccountNo" src/` and fix the leftover — the only legitimate remaining hits are in the test file, which Task 4 updates.

- [ ] **Step 4: Run the tests (expect the payload suite to FAIL)**

Run: `cd /r/Form_Portal && npm test`
Expected: `clear-advance-erp-payload.test.ts` fails — its `cfg` still sets `advanceGlAccountNo`, so the builder now throws the vendor error. Every other suite passes. This failure is the proof that the guard works; Task 4 fixes the fixture.

- [ ] **Step 5: Commit the three source files together**

```bash
cd /r/Form_Portal
git add src/lib/clr/clear-advance-erp-payload.ts src/lib/clr/clear-advance-erp-context.ts src/lib/clr/clear-advance-erp-send.ts
git commit -m "feat(ap-3): clear the advance against the AP-2 vendor, not a G/L

AP-2 posts its debit to a matched Vendor, so AP-3's clearing credit has to
go to the same vendor or the vendor balance never clears. The reversal line
becomes accountType Vendor with the AP-2's MatchedVendorNo (read live via
AccClearAdvance.AdvanceRequestId), and the inherited advanceGlAccountNo -- a
value AP-2 stopped maintaining when its Dr moved to Vendor -- is dropped.

A missing vendor refuses the send rather than falling back to a G/L: nothing
in Production carries one, and the ACC_OFFICER gate guarantees a vendor on
every new advance."
```

---

## Task 4: Tests for the Vendor reversal line

**Files:**
- Modify: `src/lib/clr/clear-advance-erp-payload.test.ts`

- [ ] **Step 1: Point the fixture at a vendor**

In `src/lib/clr/clear-advance-erp-payload.test.ts`, replace the `cfg` const (lines 5-9):

```ts
const cfg = {
  advanceGlAccountNo: "115010", bankAccountNo: "BBL-CA6332",
  vatInputGlAccountNo: "115030", whtPayableGlAccountNo: "213050",
  journalBatchName: "PPAP",
};
```

with:

```ts
const cfg = {
  advanceVendorNo: "ADV0001", bankAccountNo: "BBL-CA6332",
  vatInputGlAccountNo: "115030", whtPayableGlAccountNo: "213050",
  journalBatchName: "PPAP",
};
```

- [ ] **Step 2: Fix the first test's assertion on the reversal line**

In the same file, in the test `"refund=0, no VAT/WHT -> 2 balanced lines"`, replace these two lines:

```ts
  const adv = p.lines.find((l) => l.accountNo === "115010")!;
  assert.equal(adv.amount, -2000);
```

with:

```ts
  const adv = p.lines.find((l) => l.accountType === "Vendor")!;
  assert.equal(adv.accountNo, "ADV0001");
  assert.equal(adv.amount, -2000);
```

- [ ] **Step 3: Add tests for the vendor line's shape and its guard**

In the same file, append at the end:

```ts
test("advance reversal credits the Vendor with no balAccountType", () => {
  const p = buildClearAdvanceJournalPayload(base({}));
  const adv = p.lines.find((l) => l.accountType === "Vendor")!;
  assert.equal(adv.accountNo, "ADV0001");
  assert.equal(adv.amount, -2000);
  // AP-2's proven BC shape: two explicit lines, no bal account on the vendor line.
  assert.equal(adv.balAccountType, undefined);
  assert.equal(adv.documentType, "Payment");
  assert.equal(adv.employeeCode, "ADC26-09005");
});

test("exactly one Vendor line, and no G/L line carries the advance amount", () => {
  const p = buildClearAdvanceJournalPayload(base({
    advanceAmount: 1000,
    items: [{ glAccountNo: "610322005", amountBeforeVat: 1000, vatAmount: 70, whtAmount: 30, branchCode: "HQ01" }],
  }));
  assert.equal(p.lines.filter((l) => l.accountType === "Vendor").length, 1);
  assert.equal(sum(p), 0);
});

test("no vendor on the cleared advance -> throws", () => {
  assert.throws(() => buildClearAdvanceJournalPayload(base({
    config: { ...cfg, advanceVendorNo: "" },
  })), /Vendor/);
});
```

- [ ] **Step 4: Run the tests**

Run: `cd /r/Form_Portal && npm test`
Expected: all suites pass, including the three new tests. Total count rises by 3 from the pre-change baseline of 689.

- [ ] **Step 5: Run typecheck**

Run: `cd /r/Form_Portal && npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
cd /r/Form_Portal
git add src/lib/clr/clear-advance-erp-payload.test.ts
git commit -m "test(ap-3): cover the Vendor reversal line and its missing-vendor guard"
```

---

## Final verification (after all tasks)

- [ ] `cd /r/Form_Portal && npm run typecheck` — clean.
- [ ] `cd /r/Form_Portal && npm test` — all pass (692 expected).
- [ ] `grep -rn "advanceGlAccountNo" src/` — returns nothing.
- [ ] **Do NOT run `npm run build`.**
- [ ] Manual (report to the user, do not perform an ERP send without their say-so): in the AP-3 ERP queue on UAT, preview a clearing whose AP-2 has a matched vendor and confirm the credit line shows that vendor and the journal balances; preview one clearing an advance from `900037` / `900059` / `900064` and confirm it is refused with the vendor message rather than posting.

---

## Self-review notes

- **Spec coverage:** journal-shape change → Task 1; context vendor lookup + dropped G/L + both error messages → Task 2; both call sites → Task 3; unit tests incl. the no-`balAccountType` assertion and the guard → Task 4; manual UAT checks → Final verification. Applies-to and the unused `AccBrandGlAccount` rows are spec follow-ups, deliberately not tasks.
- **Type consistency:** `advanceVendorNo` is the field name in Task 1 (interface), Task 2 (context return) and Task 4 (fixture); `resolveAdvanceVendorNo` and the third parameter `advanceRequestId?: number | null` match the `number | null` type of `req.clear.advanceRequestId`.
- **No migration, no new endpoint, no UI change.**
