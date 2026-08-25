# AP-3 Phase 2 — ERP Posting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Post the AP-3 clearing journal to Business Central via a manual queue + preview, reusing AP-2's PPAP CU rail, with per-brand VAT/WHT accounts and an ACCOUNT-step edit before the Head approves.

**Architecture:** New services in the isolated `clr/` namespace mirror AP-2 (`clear-advance-erp-payload` builds the journal, `clear-advance-erp-context` resolves config, `clear-advance-erp-send` previews/sends). They reuse the shared `postBcPpapJournalCreateFromJson` CU and `AccRequest.ErpInterface*` status columns. One AP-3 request = one BC document. UAT-gated.

**Tech Stack:** Next.js 16 (App Router, TS), MSSQL (mssql lib), `node:test` (`npm run test`), Playwright MCP for UI/E2E.

**Spec:** `docs/superpowers/specs/2026-08-22-ap-3-phase-2-erp-posting-design.md`

---

## File structure

| File | Responsibility |
|---|---|
| `migrations/103_clr_erp_vat_wht_accounts.sql` (create) | Add `VatInputGlAccountNo`, `WhtPayableGlAccountNo` to `AccClearAdvanceInterfaceConfig` |
| `src/lib/clr/clear-advance-interface-config-service.ts` (modify) | Read/save the two new accounts |
| `src/lib/clr/clear-advance-interface-settings-service.ts` (modify) | Surface the two new accounts in the view row |
| `src/features/clear-advance/components/admin/ClrErpInterfaceSettings.tsx` (modify) | Two GL dropdowns (VAT input, WHT payable) |
| `src/lib/clr/clear-advance-erp-payload.ts` (create) | Pure builder: AP-3 clearing → `PpapJournalPayload` |
| `src/lib/clr/clear-advance-erp-payload.test.ts` (create) | Unit tests for the builder |
| `src/lib/clr/clear-advance-erp-context.ts` (create) | Resolve per-request config + BC target (reuses AP-2 context) |
| `src/lib/clr/clear-advance-erp-send.ts` (create) | `previewClrErpJournal` + `sendClrErpBatch` |
| `src/app/api/request/clear-advance/erp/preview/route.ts` (create) | GET preview |
| `src/app/api/request/clear-advance/erp/send/route.ts` (create) | POST send |
| `src/app/api/request/clear-advance/requests/[id]/account-edit/route.ts` (create) | ACCOUNT-step edit (PUT) |
| `src/app/(dashboard)/request/clear-advance/admin/interface/page.tsx` (create) | Interface ERP queue UI |
| `src/features/clear-advance/components/admin/ClrErpInterfaceQueue.tsx` (create) | Queue + preview modal + send |

---

## Task 1: Migration 103 — VAT/WHT account columns

**Files:**
- Create: `migrations/103_clr_erp_vat_wht_accounts.sql`

- [ ] **Step 1: Write the migration**

```sql
-- =============================================
-- Migration: AP-3 Phase 2 — per-brand VAT-input + WHT-payable GL accounts.
-- Database: Rocks_Portal_Form (+ Rocks_Portal_Form_UAT)
-- Apply: npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/103_clr_erp_vat_wht_accounts.sql
--        npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/103_clr_erp_vat_wht_accounts.sql
--
-- The clearing journal debits VAT input (ภาษีซื้อ) and credits WHT payable
-- (ภาษีหัก ณ ที่จ่ายค้างจ่าย). These two GL accounts are configured per brand,
-- alongside the existing Journal Batch. NULL until set; only required at send
-- time when a request actually carries VAT / WHT.
-- =============================================
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.AccClearAdvanceInterfaceConfig') AND name = 'VatInputGlAccountNo')
BEGIN
  ALTER TABLE [dbo].[AccClearAdvanceInterfaceConfig] ADD [VatInputGlAccountNo] NVARCHAR(20) NULL;
  PRINT 'Added VatInputGlAccountNo';
END
ELSE PRINT 'VatInputGlAccountNo already exists — skipping';
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.AccClearAdvanceInterfaceConfig') AND name = 'WhtPayableGlAccountNo')
BEGIN
  ALTER TABLE [dbo].[AccClearAdvanceInterfaceConfig] ADD [WhtPayableGlAccountNo] NVARCHAR(20) NULL;
  PRINT 'Added WhtPayableGlAccountNo';
END
ELSE PRINT 'WhtPayableGlAccountNo already exists — skipping';
GO
PRINT '=== Migration 103 complete ===';
GO
```

- [ ] **Step 2: Apply to UAT**

Run: `npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/103_clr_erp_vat_wht_accounts.sql`
Expected: `applied 103_clr_erp_vat_wht_accounts.sql to Rocks_Portal_Form_UAT OK`

- [ ] **Step 3: Apply to Prod**

Run: `npm run apply-sql -- --db Rocks_Portal_Form --file migrations/103_clr_erp_vat_wht_accounts.sql`
Expected: `applied … to Rocks_Portal_Form OK`

- [ ] **Step 4: Verify columns exist (both DBs)**

Use the mssql-rocks MCP:
```sql
SELECT 'UAT' db, COLUMN_NAME FROM Rocks_Portal_Form_UAT.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='AccClearAdvanceInterfaceConfig' AND COLUMN_NAME IN ('VatInputGlAccountNo','WhtPayableGlAccountNo')
UNION ALL SELECT 'Prod', COLUMN_NAME FROM Rocks_Portal_Form.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='AccClearAdvanceInterfaceConfig' AND COLUMN_NAME IN ('VatInputGlAccountNo','WhtPayableGlAccountNo')
```
Expected: 4 rows (2 per DB).

- [ ] **Step 5: Commit**

```bash
git add migrations/103_clr_erp_vat_wht_accounts.sql
git commit -m "feat(ap-3): mig 103 — VAT-input + WHT-payable account columns"
```

---

## Task 2: Config service — read/save VAT & WHT accounts

**Files:**
- Modify: `src/lib/clr/clear-advance-interface-config-service.ts`

- [ ] **Step 1: Extend the read map to include the two accounts**

Change `listClrInterfaceConfig` to return an object per brand (not just the batch string). Replace its body:

```ts
export interface ClrInterfaceConfigRow {
  journalBatchName: string | null;
  vatInputGlAccountNo: string | null;
  whtPayableGlAccountNo: string | null;
}

/** AP-3 interface config keyed by upper-case brand code. */
export async function listClrInterfaceConfig(): Promise<Record<string, ClrInterfaceConfigRow>> {
  const pool = await getAccPool();
  const r = await pool.request().query(
    `SELECT BrandCode, JournalBatchName, VatInputGlAccountNo, WhtPayableGlAccountNo
     FROM [dbo].[AccClearAdvanceInterfaceConfig]`,
  );
  const map: Record<string, ClrInterfaceConfigRow> = {};
  for (const row of r.recordset as Record<string, unknown>[]) {
    map[(row.BrandCode as string).toUpperCase()] = {
      journalBatchName: (row.JournalBatchName as string) ?? null,
      vatInputGlAccountNo: (row.VatInputGlAccountNo as string) ?? null,
      whtPayableGlAccountNo: (row.WhtPayableGlAccountNo as string) ?? null,
    };
  }
  return map;
}
```

- [ ] **Step 2: Update `listClrInterfaceConfigView` consumer (Task 3 covers the view file); add a save fn for the two accounts**

Add to the same file:

```ts
/** Set AP-3 VAT-input + WHT-payable GL for one brand (Prod + UAT). */
export async function saveClrErpAccounts(
  brandCode: string,
  vatInputGlAccountNo: string | null,
  whtPayableGlAccountNo: string | null,
  userId: number,
): Promise<void> {
  const brand = brandCode.trim().toUpperCase();
  if (!brand) throw new Error("กรุณาเลือกแบรนด์");
  const vat = vatInputGlAccountNo?.trim() || null;
  const wht = whtPayableGlAccountNo?.trim() || null;
  await writeBothPools(async (tx) => {
    await tx.request()
      .input("brand", sql.NVarChar, brand)
      .input("vat", sql.NVarChar, vat)
      .input("wht", sql.NVarChar, wht)
      .input("user", sql.Int, userId || null)
      .query(`
        MERGE [dbo].[AccClearAdvanceInterfaceConfig] AS t
        USING (SELECT @brand AS BrandCode) AS s ON t.BrandCode = s.BrandCode
        WHEN MATCHED THEN
          UPDATE SET VatInputGlAccountNo = @vat, WhtPayableGlAccountNo = @wht,
                     UpdatedAt = SYSDATETIME(), UpdatedBy = @user
        WHEN NOT MATCHED THEN
          INSERT (BrandCode, VatInputGlAccountNo, WhtPayableGlAccountNo, CreatedBy)
          VALUES (@brand, @vat, @wht, @user);
      `);
  });
}
```

- [ ] **Step 3: Fix the existing `saveClrBatch` MERGE if it referenced only BrandCode+JournalBatchName**

No change needed — `saveClrBatch` already MERGEs by BrandCode; leave it. `listClrInterfaceConfig` now returns objects, so update its other caller in Task 3.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors ONLY in files that read the old `listClrInterfaceConfig` shape (fixed in Task 3). If any other file breaks, update it to read `.journalBatchName`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/clr/clear-advance-interface-config-service.ts
git commit -m "feat(ap-3): config service reads/saves VAT-input + WHT-payable accounts"
```

---

## Task 3: Settings view + UI dropdowns

**Files:**
- Modify: `src/lib/clr/clear-advance-interface-settings-service.ts`
- Modify: `src/features/clear-advance/components/admin/ClrErpInterfaceSettings.tsx`
- Modify: `src/app/api/request/clear-advance/settings/erp-interface/route.ts` (POST accepts the two accounts)

- [ ] **Step 1: Add the two fields to the view row**

In `clear-advance-interface-settings-service.ts`, add to `ClrInterfaceConfigView`:

```ts
  vatInputGlAccountNo: string | null;
  whtPayableGlAccountNo: string | null;
```

In `listClrInterfaceConfigView`, `clr` is now `Record<string, ClrInterfaceConfigRow>`. Replace the batch read and add the accounts:

```ts
      const cfgClr = clr[code];
      const journalBatchName = cfgClr?.journalBatchName ?? null;
      // …existing return object, plus:
      vatInputGlAccountNo: cfgClr?.vatInputGlAccountNo ?? null,
      whtPayableGlAccountNo: cfgClr?.whtPayableGlAccountNo ?? null,
```

- [ ] **Step 2: Extend the POST route to save the accounts**

In `settings/erp-interface/route.ts` POST handler, after the existing batch save, read+save the accounts:

```ts
    const body = (await req.json()) as {
      brandCode: string;
      journalBatchName?: string;
      vatInputGlAccountNo?: string | null;
      whtPayableGlAccountNo?: string | null;
    };
    if (body.journalBatchName !== undefined) {
      await saveClrBatch(body.brandCode, body.journalBatchName ?? "", Number(session.user.id));
    }
    if (body.vatInputGlAccountNo !== undefined || body.whtPayableGlAccountNo !== undefined) {
      await saveClrErpAccounts(
        body.brandCode, body.vatInputGlAccountNo ?? null, body.whtPayableGlAccountNo ?? null,
        Number(session.user.id),
      );
    }
```

Add the import: `import { saveClrBatch, saveClrErpAccounts } from "@/lib/clr/clear-advance-interface-config-service";`

- [ ] **Step 3: Add the two dropdowns to the settings card**

In `ClrErpInterfaceSettings.tsx` `BrandCard`, add state + a GL-options fetch (reuse the existing GL endpoint `/api/request/clear-advance/settings/erp-gl-accounts?brand=`), mirroring the batch dropdown. Add below the Journal Batch block:

```tsx
  const [vatGl, setVatGl] = useState(row.vatInputGlAccountNo ?? "");
  const [whtGl, setWhtGl] = useState(row.whtPayableGlAccountNo ?? "");
  const { data: glData } = useSWR<{ ok: boolean; data?: { accountNo: string; displayName: string | null }[] }>(
    row.brandCode ? `/api/request/clear-advance/settings/erp-gl-accounts?brand=${encodeURIComponent(row.brandCode)}` : null,
    fetcher,
  );
  const glOpts = useMemo<SelectOption[]>(
    () => (glData?.data ?? []).map((g) => ({ value: g.accountNo, label: g.accountNo, subLabel: g.displayName ?? undefined })),
    [glData],
  );
```

Extend `save()` to POST `vatInputGlAccountNo: vatGl.trim() || null, whtPayableGlAccountNo: whtGl.trim() || null` alongside the batch, and mark `dirty` when either changed. Render two `SearchableSelect`s (VAT input GL, WHT payable GL) using `glOpts`, labels "ภาษีซื้อ (VAT input)" and "WHT payable".

- [ ] **Step 4: Verify (Playwright, UAT)**

Open `http://localhost:3081/request/clear-advance/settings?brand=PCTH&tab=erpInterface`, pick VAT + WHT GL on a card, save, reload → values persist. Check the POST returns `{ok:true}` and a re-GET of `/settings/erp-interface` shows the saved accounts.

- [ ] **Step 5: Commit**

```bash
git add src/lib/clr/clear-advance-interface-settings-service.ts src/features/clear-advance/components/admin/ClrErpInterfaceSettings.tsx "src/app/api/request/clear-advance/settings/erp-interface/route.ts"
git commit -m "feat(ap-3): settings UI for VAT-input + WHT-payable accounts"
```

---

## Task 4: Clearing-journal payload builder (pure, TDD)

**Files:**
- Create: `src/lib/clr/clear-advance-erp-payload.ts`
- Test: `src/lib/clr/clear-advance-erp-payload.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClearAdvanceJournalPayload, type ClrJournalInput } from "./clear-advance-erp-payload";

const cfg = {
  advanceGlAccountNo: "115010", bankAccountNo: "BBL-CA6332",
  vatInputGlAccountNo: "115030", whtPayableGlAccountNo: "213050",
  journalBatchName: "PPAP",
};
const base = (over: Partial<ClrJournalInput>): ClrJournalInput => ({
  requestNo: "ADC26-09005", postingDate: "2026-08-20", advanceAmount: 2000,
  departmentCode: "DEPT01", config: cfg,
  items: [{ glAccountNo: "610322005", amountBeforeVat: 2000, vatAmount: 0, whtAmount: 0, branchCode: "HQ01" }],
  ...over,
});
const sum = (p: { lines: { amount: number }[] }) => Math.round(p.lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;

test("refund=0, no VAT/WHT → 2 balanced lines", () => {
  const p = buildClearAdvanceJournalPayload(base({}));
  assert.equal(p.journalBatchName, "PPAP");
  assert.equal(p.lines.length, 2);
  assert.equal(sum(p), 0);
  const exp = p.lines.find((l) => l.accountNo === "610322005")!;
  assert.equal(exp.amount, 2000);              // Dr expense
  const adv = p.lines.find((l) => l.accountNo === "115010")!;
  assert.equal(adv.amount, -2000);             // Cr advance
  assert.equal(exp.documentType, "Payment");
  assert.equal(exp.employeeCode, "ADC26-09005");
});

test("refund>0 → Dr Bank for the returned amount", () => {
  const p = buildClearAdvanceJournalPayload(base({
    items: [{ glAccountNo: "610322005", amountBeforeVat: 1500, vatAmount: 0, whtAmount: 0, branchCode: null }],
  }));
  assert.equal(sum(p), 0);
  const bank = p.lines.find((l) => l.accountType === "Bank Account")!;
  assert.equal(bank.amount, 500);              // Dr Bank (money in)
});

test("pay-extra → Cr Bank for the excess", () => {
  const p = buildClearAdvanceJournalPayload(base({
    items: [{ glAccountNo: "610322005", amountBeforeVat: 2500, vatAmount: 0, whtAmount: 0, branchCode: null }],
  }));
  assert.equal(sum(p), 0);
  const bank = p.lines.find((l) => l.accountType === "Bank Account")!;
  assert.equal(bank.amount, -500);             // Cr Bank (money out)
});

test("VAT + WHT → aggregate lines, still balanced", () => {
  const p = buildClearAdvanceJournalPayload(base({
    advanceAmount: 1000,
    items: [{ glAccountNo: "610322005", amountBeforeVat: 1000, vatAmount: 70, whtAmount: 30, branchCode: "HQ01" }],
  }));
  assert.equal(sum(p), 0);
  assert.equal(p.lines.find((l) => l.accountNo === "115030")!.amount, 70);   // Dr VAT input
  assert.equal(p.lines.find((l) => l.accountNo === "213050")!.amount, -30);  // Cr WHT payable
  const bank = p.lines.find((l) => l.accountType === "Bank Account")!;
  assert.equal(bank.amount, -40);              // actualNet 1040 > advance 1000 → pay extra 40
});

test("VAT present but no VAT account configured → throws", () => {
  assert.throws(() => buildClearAdvanceJournalPayload(base({
    config: { ...cfg, vatInputGlAccountNo: null },
    items: [{ glAccountNo: "610322005", amountBeforeVat: 1000, vatAmount: 70, whtAmount: 0, branchCode: null }],
  })), /VAT/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test`
Expected: FAIL — `buildClearAdvanceJournalPayload` not defined / module not found.

- [ ] **Step 3: Write the implementation**

```ts
import type { PpapJournalPayload, PpapJournalLinePayload } from "@/lib/acc/erp-ppap-payload";

export interface ClrJournalConfig {
  advanceGlAccountNo: string;
  bankAccountNo: string;
  vatInputGlAccountNo: string | null;
  whtPayableGlAccountNo: string | null;
  journalBatchName: string;
}
export interface ClrJournalItem {
  glAccountNo: string;
  amountBeforeVat: number;
  vatAmount: number;
  whtAmount: number;
  branchCode: string | null;
}
export interface ClrJournalInput {
  requestNo: string;
  postingDate: string;       // YYYY-MM-DD
  advanceAmount: number;
  items: ClrJournalItem[];
  config: ClrJournalConfig;
  departmentCode: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Build the PPAP CreateFromJson payload for ONE AP-3 clearing.
 * Dr expenses (per item) + Dr VAT input − Cr WHT payable − Cr advance ± Bank diff.
 * Line amount sign: >0 = debit, <0 = credit; the lines always sum to 0.
 */
export function buildClearAdvanceJournalPayload(input: ClrJournalInput): PpapJournalPayload {
  const { config: c, items, requestNo, postingDate, departmentCode } = input;
  if (!c.advanceGlAccountNo) throw new Error("ยังไม่ได้ตั้งค่า G/L เงินทดรองจ่าย (จาก AP-2) สำหรับแบรนด์นี้");
  if (!c.bankAccountNo) throw new Error("ยังไม่ได้ตั้งค่า Bank Account (จาก AP-2) สำหรับแบรนด์นี้");
  if (!c.journalBatchName) throw new Error("ยังไม่ได้ตั้งค่า Journal Batch ของ AP-3 สำหรับแบรนด์นี้");
  if (items.length === 0) throw new Error("ไม่มีรายการค่าใช้จ่ายสำหรับสร้าง journal");

  const employeeCode = requestNo.slice(0, 35);
  const glLine = (accountNo: string, amount: number, branchCode: string | null): PpapJournalLinePayload => ({
    groupNo: "G1", postingDate, documentType: "Payment", accountType: "G/L Account",
    accountNo, description: `เคลียร์เงินทดรองจ่าย ${requestNo}`.slice(0, 100),
    paymentMethodCode: "BANK", amount: r2(amount), balAccountType: "G/L Account",
    employeeCode, branchCode: branchCode ?? "", departmentCode,
  });

  const lines: PpapJournalLinePayload[] = [];
  let vatTotal = 0, whtTotal = 0;

  for (const it of items) {
    if (r2(it.amountBeforeVat) !== 0) lines.push(glLine(it.glAccountNo, it.amountBeforeVat, it.branchCode));
    vatTotal += it.vatAmount || 0;
    whtTotal += it.whtAmount || 0;
  }
  vatTotal = r2(vatTotal); whtTotal = r2(whtTotal);

  if (vatTotal > 0) {
    if (!c.vatInputGlAccountNo) throw new Error("มี VAT แต่ยังไม่ได้ตั้งค่าบัญชีภาษีซื้อ (VAT input) ของแบรนด์นี้");
    lines.push(glLine(c.vatInputGlAccountNo, vatTotal, null));
  }
  if (whtTotal > 0) {
    if (!c.whtPayableGlAccountNo) throw new Error("มี WHT แต่ยังไม่ได้ตั้งค่าบัญชี WHT payable ของแบรนด์นี้");
    lines.push(glLine(c.whtPayableGlAccountNo, -whtTotal, null));
  }

  // Credit the advance in full.
  lines.push(glLine(c.advanceGlAccountNo, -r2(input.advanceAmount), null));

  // Bank difference balances the entry: refund (advance > actualNet) → Dr Bank; extra → Cr Bank.
  const actualNet = r2(items.reduce((s, it) => s + it.amountBeforeVat + (it.vatAmount || 0) - (it.whtAmount || 0), 0));
  const bankAmount = r2(input.advanceAmount - actualNet);
  if (bankAmount !== 0) {
    lines.push({
      groupNo: "G1", postingDate, documentType: "Payment", accountType: "Bank Account",
      accountNo: c.bankAccountNo, description: `เคลียร์เงินทดรองจ่าย ${requestNo}`.slice(0, 100),
      paymentMethodCode: "BANK", amount: bankAmount,
      employeeCode, branchCode: "", departmentCode,
    });
  }

  return { journalBatchName: c.journalBatchName.trim(), lines };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test`
Expected: all 5 new tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/clr/clear-advance-erp-payload.ts src/lib/clr/clear-advance-erp-payload.test.ts
git commit -m "feat(ap-3): clearing-journal PPAP payload builder + unit tests"
```

---

## Task 5: ERP context resolver

**Files:**
- Create: `src/lib/clr/clear-advance-erp-context.ts`

- [ ] **Step 1: Write the resolver (reuse AP-2 context for advance GL/bank/target/dept)**

```ts
import { loadAdvanceErpContext } from "@/lib/adv/advance-erp-context";
import { listClrInterfaceConfig } from "@/lib/clr/clear-advance-interface-config-service";
import type { ClrJournalConfig } from "@/lib/clr/clear-advance-erp-payload";
import type { AdvanceErpTarget } from "@/lib/adv/advance-erp-context";

export interface ClrErpContext {
  config: ClrJournalConfig;
  target: AdvanceErpTarget;
  departmentCode: string;
}

/**
 * Resolve the clearing-journal config + BC target for one AP-3 request's brand.
 * Advance GL / Bank / target Company / ERP dept are inherited from AP-2's config
 * (loadAdvanceErpContext). Journal Batch + VAT-input + WHT-payable come from AP-3's
 * own AccClearAdvanceInterfaceConfig.
 */
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
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (0 errors).

- [ ] **Step 3: Commit**

```bash
git add src/lib/clr/clear-advance-erp-context.ts
git commit -m "feat(ap-3): ERP context resolver (inherits advance GL/bank from AP-2)"
```

---

## Task 6: Send service (preview + send)

**Files:**
- Create: `src/lib/clr/clear-advance-erp-send.ts`

- [ ] **Step 1: Write the service**

Model on `advance-erp-send.ts` but **one document per request** (no per-Company batching). Reuse `assertBcJournalCreated`/`extractBcDocumentNo` by copying the two helper functions (they are private in the AP-2 file — copy them verbatim into this file to keep AP-3 isolated). Key functions:

```ts
import { getAccPool, sql } from "@/lib/acc/pool";
import { postBcPpapJournalCreateFromJson } from "@/lib/bc/bc-odata";
import { getRequest } from "@/lib/clr/clear-advance-request-service";
import { loadClearAdvanceErpContext } from "@/lib/clr/clear-advance-erp-context";
import { buildClearAdvanceJournalPayload, type ClrJournalItem } from "@/lib/clr/clear-advance-erp-payload";
import type { ErpBcEnvironment } from "@/lib/acc/erp-environment";

// COPY assertBcJournalCreated + extractBcDocumentNo verbatim from advance-erp-send.ts.

function itemsFor(clear): ClrJournalItem[] {
  return (clear.items ?? []).map((it) => ({
    glAccountNo: it.glAccountNo ?? "",
    amountBeforeVat: it.amountBeforeVat ?? 0,
    vatAmount: it.vatAmount ?? 0,
    whtAmount: it.whtAmount ?? 0,
    branchCode: it.branchCode ?? null,
  }));
}

function postingDateFor(clear): string {
  return (clear.refundTransferDate || clear.paymentDate || new Date().toISOString().slice(0, 10));
}

export interface ClrPreviewItem { id: number; requestNo: string | null; interfaceTarget: string | null; environment: ErpBcEnvironment | null; journalBatchName: string | null; ok: boolean; error?: string; lines: { accountType: string; accountNo: string; description: string; branchCode: string; departmentCode: string; debit: number | null; credit: number | null }[]; }

export async function previewClrErpJournal(ids: number[]): Promise<ClrPreviewItem[]> {
  const out: ClrPreviewItem[] = [];
  for (const id of ids) {
    try {
      const req = await getRequest(id);
      if (!req?.clear || !req.brandCode) throw new Error("ไม่พบคำขอ/ข้อมูลเคลียร์");
      const ctx = await loadClearAdvanceErpContext(req.brandCode, req.requesterDepartmentCode);
      const payload = buildClearAdvanceJournalPayload({
        requestNo: req.requestNo ?? "", postingDate: postingDateFor(req.clear),
        advanceAmount: req.clear.advanceAmount ?? 0, items: itemsFor(req.clear),
        config: ctx.config, departmentCode: ctx.departmentCode,
      });
      out.push({ id, requestNo: req.requestNo, interfaceTarget: ctx.target.interfaceTarget, environment: ctx.target.environment, journalBatchName: ctx.config.journalBatchName, ok: true,
        lines: payload.lines.map((l) => ({ accountType: l.accountType, accountNo: l.accountNo, description: l.description, branchCode: l.branchCode, departmentCode: l.departmentCode, debit: l.amount > 0 ? l.amount : null, credit: l.amount < 0 ? -l.amount : null })) });
    } catch (e) {
      out.push({ id, requestNo: null, interfaceTarget: null, environment: null, journalBatchName: null, ok: false, error: e instanceof Error ? e.message : "preview error", lines: [] });
    }
  }
  return out;
}

export interface ClrSendResult { id: number; ok: boolean; error?: string; documentNo?: string | null }

export async function sendClrErpBatch(ids: number[], userId: number): Promise<ClrSendResult[]> {
  const results: ClrSendResult[] = [];
  const pool = await getAccPool();
  for (const id of ids) {
    try {
      const req = await getRequest(id);
      if (!req?.clear || !req.brandCode) throw new Error("ไม่พบคำขอ");
      if (req.status !== "Approved") throw new Error("ต้องอนุมัติคำขอก่อนจึงจะส่ง ERP ได้");
      const st = (await pool.request().input("id", sql.Int, id)
        .query(`SELECT ErpInterfaceStatus FROM [dbo].[AccRequest] WHERE Id=@id`)).recordset[0]?.ErpInterfaceStatus ?? null;
      if (st === "Sent") throw new Error("ส่งเข้า ERP สำเร็จแล้ว");
      if (st === "Pending") throw new Error("กำลังส่งอยู่");

      const ctx = await loadClearAdvanceErpContext(req.brandCode, req.requesterDepartmentCode);
      const payload = buildClearAdvanceJournalPayload({
        requestNo: req.requestNo ?? "", postingDate: postingDateFor(req.clear),
        advanceAmount: req.clear.advanceAmount ?? 0, items: itemsFor(req.clear),
        config: ctx.config, departmentCode: ctx.departmentCode,
      });

      await pool.request().input("id", sql.Int, id)
        .query(`UPDATE [dbo].[AccRequest] SET ErpInterfaceStatus='Pending', ErpInterfaceError=NULL, UpdatedAt=SYSDATETIME() WHERE Id=@id AND (ErpInterfaceStatus IS NULL OR ErpInterfaceStatus='Failed')`);

      const bcResp = await postBcPpapJournalCreateFromJson(
        ctx.target.bcConnectionId, ctx.target.bcId, ctx.target.environment, ctx.target.baseUrl,
        payload as unknown as Record<string, unknown>,
      );
      const summary = assertBcJournalCreated(bcResp);
      const docNo = extractBcDocumentNo(bcResp);
      await pool.request()
        .input("id", sql.Int, id).input("doc", sql.NVarChar, docNo)
        .input("env", sql.NVarChar, ctx.target.environment).input("by", sql.Int, userId)
        .input("sentAt", sql.DateTime2, new Date())
        .query(`UPDATE [dbo].[AccRequest] SET ErpInterfaceStatus='Sent', ErpInterfaceError=NULL, ErpInterfaceSentAt=@sentAt, ErpInterfaceSentBy=@by, ErpInterfaceEnvironment=@env, ErpDocumentNo=@doc, UpdatedAt=SYSDATETIME() WHERE Id=@id`);
      await pool.request().input("rid", sql.Int, id).input("by", sql.Int, userId)
        .input("action", sql.NVarChar, "erp_interface_sent")
        .input("note", sql.NVarChar, `ส่งเข้า ERP · ${ctx.target.interfaceTarget} · ${req.requestNo} · Doc: ${docNo ?? "—"} · ${summary}`.slice(0, 2000))
        .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note) VALUES (@rid,@by,@action,@note)`);
      results.push({ id, ok: true, documentNo: docNo });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "ส่งเข้า ERP ไม่สำเร็จ";
      await pool.request().input("id", sql.Int, id).input("err", sql.NVarChar, msg)
        .query(`UPDATE [dbo].[AccRequest] SET ErpInterfaceStatus='Failed', ErpInterfaceError=@err, UpdatedAt=SYSDATETIME() WHERE Id=@id`).catch(() => {});
      results.push({ id, ok: false, error: msg });
    }
  }
  return results;
}
```

Note: confirm `getRequest` (AP-3) returns `clear.items` with `glAccountNo/amountBeforeVat/vatAmount/whtAmount/branchCode` and `requesterDepartmentCode` on the request — it does (see `loadClear`/`mapItemRow`). If `getAccPool` for AP-3 lives at `@/lib/acc/pool`, import from there.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. If `req.clear`/field names differ, align to the `ClearAdvanceDetail`/`ClearAdvanceItem` types in `@/features/clear-advance/types`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/clr/clear-advance-erp-send.ts
git commit -m "feat(ap-3): ERP send service — preview + send (1 request = 1 document)"
```

---

## Task 7: Preview + send routes (UAT-gated)

**Files:**
- Create: `src/app/api/request/clear-advance/erp/preview/route.ts`
- Create: `src/app/api/request/clear-advance/erp/send/route.ts`

- [ ] **Step 1: Preview route**

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { previewClrErpJournal } from "@/lib/clr/clear-advance-erp-send";

export async function GET(req: NextRequest) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;
  const ids = (req.nextUrl.searchParams.get("ids") ?? "").split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
  if (ids.length === 0) return NextResponse.json({ ok: true, data: [] });
  try {
    return NextResponse.json({ ok: true, data: await previewClrErpJournal(ids) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Send route (UAT gate)**

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { sendClrErpBatch } from "@/lib/clr/clear-advance-erp-send";

export async function POST(req: NextRequest) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;
  try {
    const body = (await req.json()) as { ids?: number[] };
    const ids = (body.ids ?? []).filter((n) => Number.isFinite(n));
    if (ids.length === 0) return NextResponse.json({ ok: false, error: "ไม่มีรายการ" }, { status: 400 });
    const results = await sendClrErpBatch(ids, Number(session.user.id));
    return NextResponse.json({ ok: true, data: results });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "error" }, { status: 400 });
  }
}
```

The UAT gate is enforced in the send service via `ctx.target.environment` (the resolved BC profile Company env). No Prod posting occurs until the Company's AP-2 BC profile points at a Prod connection, which is a separate deliberate step.

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit` → PASS.
```bash
git add "src/app/api/request/clear-advance/erp/preview/route.ts" "src/app/api/request/clear-advance/erp/send/route.ts"
git commit -m "feat(ap-3): ERP preview + send routes (admin-gated)"
```

---

## Task 8: Interface ERP queue UI

**Files:**
- Create: `src/features/clear-advance/components/admin/ClrErpInterfaceQueue.tsx`
- Create: `src/app/(dashboard)/request/clear-advance/admin/interface/page.tsx`
- Modify: AP-3 admin hub page — add an "Interface ERP" card linking to `/request/clear-advance/admin/interface`

- [ ] **Step 1: Build the queue component**

Fetch Approved AP-3 requests (add a small `?erp=queue` param to the existing Control report service, or a new `/api/request/clear-advance/erp/queue` returning id/requestNo/brand/advanceNo/actualTotal/refund/ErpInterfaceStatus/ErpDocumentNo). Render a table with checkboxes; a "ดู preview" button calls `GET /erp/preview?ids=` and shows the journal lines (Dr/Cr) in a modal; a "ส่งเข้า ERP" button POSTs `/erp/send` with the selected ids, then refetches. Show env badge (UAT/PROD) and status/Doc No. per row. Mirror the AP-2 Interface tab UX and the existing `ClrControlReport` table styling.

- [ ] **Step 2: Build the page (auth-gated IT/System Admin)**

Mirror `settings/page.tsx` auth guard; render `<ClrErpInterfaceQueue />` inside `PageContainer` + `PageHeaderBar`.

- [ ] **Step 3: Add the admin-hub card** linking to the new page.

- [ ] **Step 4: Verify (Playwright, UAT)** — page loads, lists Approved items, preview modal shows balanced Dr/Cr, send button present + disabled when nothing selected. (Actual BC send is exercised in Task 11.)

- [ ] **Step 5: Commit**

```bash
git add src/features/clear-advance/components/admin/ClrErpInterfaceQueue.tsx "src/app/(dashboard)/request/clear-advance/admin/interface/page.tsx" "src/app/(dashboard)/request/clear-advance/admin/page.tsx"
git commit -m "feat(ap-3): Interface ERP queue UI (preview + send)"
```

---

## Task 9: ACCOUNT-step edit

**Files:**
- Create: `src/app/api/request/clear-advance/requests/[id]/account-edit/route.ts`
- Modify: `src/lib/clr/clear-advance-request-service.ts` (add `saveAccountEdit`)
- Modify: `src/features/clear-advance/components/ClearAdvanceForm.tsx` (account-edit mode) or the detail page

- [ ] **Step 1: Add `saveAccountEdit` guard + write in the request service**

```ts
/** Edit the clearing data while at the ACCOUNT step (accountant correction). */
export async function saveAccountEdit(
  input: ClearAdvanceSaveInput, actorUserId: number, actorEmail: string,
): Promise<void> {
  const id = input.id;
  if (!id) throw new Error("ไม่พบคำขอ");
  const pool = await getAccPool();
  const row = (await pool.request().input("id", sql.Int, id)
    .query(`SELECT Status, CurrentStepCode FROM [dbo].[AccRequest] WHERE Id=@id AND FormCode=@f`
      .replace("@f", `'${AP3_FORM_CODE}'`))).recordset[0] as { Status: string; CurrentStepCode: string } | undefined;
  if (!row) throw new Error("ไม่พบคำขอ");
  if (row.Status !== "Submitted" || row.CurrentStepCode !== "ACCOUNT")
    throw new Error("แก้ไขได้เฉพาะตอนอยู่ขั้นบัญชี (ACCOUNT) เท่านั้น");
  const isAccount = await isClrApprover(actorEmail, "ACCOUNT");
  // admins also allowed
  // reuse the same write path as saveDraft's clear/items/wht upsert (no status change)
  await persistClearOnly(input); // extract the AccClearAdvance/Item/Wht replace-all block used by saveDraft into a shared helper
}
```

Refactor: extract the `AccClearAdvance` + items + WHT replace-all block from `saveDraft` into a private `persistClearOnly(input)` and call it from both `saveDraft` and `saveAccountEdit` (DRY). Pass admin-role allowance from the route.

- [ ] **Step 2: Route**

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getRequest, saveAccountEdit } from "@/lib/clr/clear-advance-request-service";
import { isClrApprover } from "@/lib/clr/clear-advance-approver-service";
import { isAdminRole } from "@/lib/roles";
import type { ClearAdvanceSaveInput } from "@/features/clear-advance/types";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  const { id } = await params;
  const clrReq = await getRequest(Number(id));
  if (!clrReq) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const allowed = (await isClrApprover(session.user.email ?? null, "ACCOUNT")) || isAdminRole(session.user.role);
  if (!allowed) return NextResponse.json({ ok: false, error: "ไม่มีสิทธิ์แก้ไขขั้นบัญชี" }, { status: 403 });
  try {
    const body = (await req.json()) as ClearAdvanceSaveInput;
    body.id = Number(id);
    await saveAccountEdit(body, Number(session.user.id), session.user.email ?? "");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "error" }, { status: 400 });
  }
}
```

- [ ] **Step 3: Form/detail edit mode**

On the AP-3 detail/approval view, when `status==='Submitted' && currentStepCode==='ACCOUNT'` and the viewer is an ACCOUNT approver/admin, render the clearing lines editable (reuse `ClearAdvanceForm` with a `mode="account-edit"` that PUTs to `/account-edit` and a "บันทึกการแก้ไข" button), then the normal approve action. Otherwise render read-only.

- [ ] **Step 4: Verify (Playwright, UAT)** — as an ACCOUNT approver on a Submitted@ACCOUNT request: edit an amount → save → GET shows the new value + recomputed refund; a non-ACCOUNT/non-admin user gets 403; editing at MANAGER/HEAD step is rejected.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` → PASS.
```bash
git add "src/app/api/request/clear-advance/requests/[id]/account-edit/route.ts" src/lib/clr/clear-advance-request-service.ts src/features/clear-advance/components/ClearAdvanceForm.tsx
git commit -m "feat(ap-3): ACCOUNT-step edit before Head approval"
```

---

## Task 10: E2E verification on UAT

**Files:** none (verification only)

- [ ] **Step 1: Configure a brand** — in AP-3 Interface ERP settings set Journal Batch + VAT-input + WHT-payable GL for a Sandbox Company (e.g. ROCKS→PCTH). Confirm the AP-2 config for that Company has advance GL + Bank.

- [ ] **Step 2: Full flow via Playwright on :3081** — create an AP-3 clearing a pending advance (attach receipt, one line with VAT+WHT), submit; Manager approve; **Account edits** an amount + saves; Head approve → Approved.

- [ ] **Step 3: Preview** — open `/request/clear-advance/admin/interface`, select the request, open preview; assert Dr total == Cr total and lines match the payload table (§4).

- [ ] **Step 4: Send** — click ส่งเข้า ERP; expect `{ok:true}` with a `documentNo`. Verify `ErpInterfaceStatus='Sent'` + `ErpDocumentNo` set; re-send is refused ("ส่งเข้า ERP สำเร็จแล้ว").

- [ ] **Step 5: Confirm in BC Sandbox** — via the mssql-66 / BC that the Gen. Journal document exists with the balanced lines (or the CU response `Failed: 0` + documentNo is sufficient evidence). Confirm the Control report still reconciles.

- [ ] **Step 6: Final commit (docs)** — update `project_ap3_clear_advance` memory + the spec status to "implemented (UAT)".

---

## Self-review notes
- Spec §2 decisions → Tasks 1–9 (each row maps to a task). §4 journal → Task 4 (tested). §5 config → Tasks 1–3. §6 ACCOUNT-edit → Task 9. §7 send/status → Tasks 6–8. §8 errors → Task 4 (throws) + Task 6 (assert/Failed). §9 testing → Task 4 unit + Task 10 E2E.
- Type names consistent across tasks: `ClrJournalInput`/`ClrJournalConfig`/`ClrJournalItem` (Task 4) used by Tasks 5–6; `ClrErpContext` (Task 5) used by Task 6; `loadClearAdvanceErpContext`, `buildClearAdvanceJournalPayload`, `previewClrErpJournal`, `sendClrErpBatch`, `saveClrErpAccounts`, `saveAccountEdit`, `persistClearOnly` — referenced consistently.
- Prod posting intentionally NOT enabled here (UAT-gated) — matches spec §10.
