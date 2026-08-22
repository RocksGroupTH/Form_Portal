# AP-2 Phase 2: Migrate off AccAdvanceInterfaceConfig — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove `AccAdvanceInterfaceConfig` and move AP-2's per-brand ERP config (GL, Bank, Branch, Batch, Company target) into the shared per-form tables already used by every other form.

**Architecture:** New per-form write functions are added to the four `acc/` services (no changes to existing AP-1 write functions). The settings read path explicitly filters for `formCode === "AP-2"` rows — no reliance on `primaryByBrand` ordering. `advance-erp-context.ts` reads per-form rows directly, removing the `AccAdvanceInterfaceConfig` dependency entirely.

**Tech Stack:** TypeScript/Next.js 16, MSSQL (mssql driver), `writeBothPools` dual-write pattern, PowerShell with `$env:Path="C:\Users\pc\AppData\Local\nvm\v22.23.2;$env:Path"` for npm/tsc, Bash for git. Dev server port 3081.

---

## Key Schema Facts (read before coding)

- **`AccBrandErpInterface`** unique index: `(FormCode, BrandCode)` — one row per (form, brand). MERGE on this key is safe.
- **`AccBrandGlAccount` / `AccBrandBankAccount`** unique index: `(FormCode, BrandCode, AccountNo)` — multiple accounts per brand per form allowed. Use DELETE+INSERT to replace AP-2 override cleanly.
- **`AccBrandBranchCode`** unique index: `(FormCode, BrandCode, BranchCode)`. Same DELETE+INSERT pattern.
- **`AccBrandJournalBatch`** unique index: `(FormCode, BrandCode, BatchName)`. Same DELETE+INSERT pattern.
- All existing rows have `FormCode = NULL` (migration 097 reset them). `perFormPredicate()` = `(FormCode = @formCode OR FormCode IS NULL)` — AP-2 rows will be returned alongside NULL defaults.

## Read Pattern (used in Tasks 6 and 7)

Because multiple rows can match per brand after `pickAllForForm`, always filter explicitly:
```typescript
// Load all brands' rows for AP-2:
const rows = await listBrandAccounts("gl", null, "AP-2");
// Only AP-2 overrides (not NULL defaults):
const ap2Map = new Map(rows.filter(r => r.formCode === "AP-2").map(r => [r.brandCode.toUpperCase(), r]));
// Per brand: AP-2 value OR fall back to ctx.brandAccounts[code]:
const glAccountNo = ap2Map.get(code)?.accountNo ?? ctx.brandAccounts[code]?.glAccountNo ?? null;
```

---

## File Map

| File | Action |
|------|--------|
| `migrations/115_migrate_advance_interface_to_per_form.sql` | **Create** |
| `src/lib/acc/brand-erp-interface-map-service.ts` | **Modify** — add `upsertFormBrandErpInterfaceMap` |
| `src/lib/acc/brand-account-service.ts` | **Modify** — add `mergeFormBrandAccount` |
| `src/lib/acc/brand-branch-service.ts` | **Modify** — add `mergeFormBrandBranch` |
| `src/lib/acc/brand-journal-batch-service.ts` | **Modify** — add `mergeFormBrandBatch` |
| `src/lib/adv/advance-interface-settings-service.ts` | **Rewrite** read + add `saveAdvanceInterfacePerForm` |
| `src/lib/adv/advance-erp-context.ts` | **Modify** — remove AccAdvanceInterfaceConfig dep |
| `src/app/api/request/advance/settings/erp-interface/route.ts` | **Modify** — POST calls new save |
| `src/lib/adv/advance-interface-config-service.ts` | **Delete** |

---

## Task 1: SQL Migration — migrate data + drop table

**Files:**
- Create: `migrations/115_migrate_advance_interface_to_per_form.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- 115: Migrate AccAdvanceInterfaceConfig → shared per-form tables (FormCode='AP-2').
-- Apply on BOTH Rocks_Portal_Form AND Rocks_Portal_Form_UAT.
--
-- Safe to run multiple times: all INSERTs guarded by NOT EXISTS.
-- AccAdvanceInterfaceConfig is DROPPED at the end — run only after service-layer
-- changes are deployed (Tasks 2–8) or in a maintenance window.

SET XACT_ABORT ON;
GO

-- ① InterfaceBrandCode → AccBrandErpInterface (FormCode='AP-2')
-- Unique index on AccBrandErpInterface is (FormCode, BrandCode); one row per pair.
INSERT INTO [dbo].[AccBrandErpInterface] (BrandCode, InterfaceBrandCode, FormCode, CreatedBy)
SELECT src.BrandCode, src.InterfaceBrandCode, 'AP-2', NULL
FROM [dbo].[AccAdvanceInterfaceConfig] src
WHERE src.InterfaceBrandCode IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM [dbo].[AccBrandErpInterface] x
    WHERE x.BrandCode = src.BrandCode AND x.FormCode = 'AP-2'
  );
PRINT 'Migrated InterfaceBrandCode to AccBrandErpInterface (FormCode=AP-2)';
GO

-- ② GlAccountNo → AccBrandGlAccount (FormCode='AP-2')
-- Unique index is (FormCode, BrandCode, AccountNo).
INSERT INTO [dbo].[AccBrandGlAccount]
  (BrandCode, AccountNo, ErpDescription, FormCode, IsActive, SortOrder, CreatedBy)
SELECT src.BrandCode, src.GlAccountNo, src.GlErpDescription, 'AP-2', 1, 0, NULL
FROM [dbo].[AccAdvanceInterfaceConfig] src
WHERE src.GlAccountNo IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM [dbo].[AccBrandGlAccount] x
    WHERE x.BrandCode = src.BrandCode AND x.FormCode = 'AP-2'
  );
PRINT 'Migrated GlAccountNo to AccBrandGlAccount (FormCode=AP-2)';
GO

-- ③ BankAccountNo → AccBrandBankAccount (FormCode='AP-2')
INSERT INTO [dbo].[AccBrandBankAccount]
  (BrandCode, AccountNo, FormCode, IsActive, SortOrder, CreatedBy)
SELECT src.BrandCode, src.BankAccountNo, 'AP-2', 1, 0, NULL
FROM [dbo].[AccAdvanceInterfaceConfig] src
WHERE src.BankAccountNo IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM [dbo].[AccBrandBankAccount] x
    WHERE x.BrandCode = src.BrandCode AND x.FormCode = 'AP-2'
  );
PRINT 'Migrated BankAccountNo to AccBrandBankAccount (FormCode=AP-2)';
GO

-- ④ BranchCode → AccBrandBranchCode (FormCode='AP-2')
INSERT INTO [dbo].[AccBrandBranchCode]
  (BrandCode, BranchCode, FormCode, IsActive, SortOrder, DeptAsBranch, CreatedBy)
SELECT src.BrandCode, src.BranchCode, 'AP-2', 1, 0, 0, NULL
FROM [dbo].[AccAdvanceInterfaceConfig] src
WHERE src.BranchCode IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM [dbo].[AccBrandBranchCode] x
    WHERE x.BrandCode = src.BrandCode AND x.FormCode = 'AP-2'
  );
PRINT 'Migrated BranchCode to AccBrandBranchCode (FormCode=AP-2)';
GO

-- ⑤ JournalBatchName → AccBrandJournalBatch (FormCode='AP-2', keyed by claim brand)
INSERT INTO [dbo].[AccBrandJournalBatch]
  (BrandCode, BatchName, FormCode, IsActive, SortOrder, CreatedBy)
SELECT src.BrandCode, src.JournalBatchName, 'AP-2', 1, 0, NULL
FROM [dbo].[AccAdvanceInterfaceConfig] src
WHERE src.JournalBatchName IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM [dbo].[AccBrandJournalBatch] x
    WHERE x.BrandCode = src.BrandCode AND x.FormCode = 'AP-2'
  );
PRINT 'Migrated JournalBatchName to AccBrandJournalBatch (FormCode=AP-2)';
GO

-- ⑥ Drop the old table
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'AccAdvanceInterfaceConfig')
BEGIN
  DROP TABLE [dbo].[AccAdvanceInterfaceConfig];
  PRINT 'Dropped AccAdvanceInterfaceConfig';
END
ELSE
  PRINT 'AccAdvanceInterfaceConfig already gone — skipping';
GO

PRINT '=== Migration 115 complete ===';
GO
```

- [ ] **Step 2: Apply on UAT**

```powershell
$env:Path="C:\Users\pc\AppData\Local\nvm\v22.23.2;$env:Path"
Set-Location R:\Form_Portal
npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/115_migrate_advance_interface_to_per_form.sql
```

Expected: each PRINT line appears, "Migration 115 complete" at end, no errors.

- [ ] **Step 3: Apply on Prod**

```powershell
npm run apply-sql -- --db Rocks_Portal_Form --file migrations/115_migrate_advance_interface_to_per_form.sql
```

- [ ] **Step 4: Verify rows migrated (UAT)**

Run in SSMS or mssql-rocks MCP:
```sql
-- Should return rows with FormCode='AP-2'
SELECT BrandCode, InterfaceBrandCode, FormCode FROM AccBrandErpInterface WHERE FormCode = 'AP-2';
SELECT BrandCode, AccountNo, FormCode FROM AccBrandGlAccount WHERE FormCode = 'AP-2';
SELECT BrandCode, AccountNo, FormCode FROM AccBrandBankAccount WHERE FormCode = 'AP-2';
SELECT BrandCode, BranchCode, FormCode FROM AccBrandBranchCode WHERE FormCode = 'AP-2';
SELECT BrandCode, BatchName, FormCode FROM AccBrandJournalBatch WHERE FormCode = 'AP-2';
-- Should return 0 (table dropped)
SELECT COUNT(*) FROM sys.tables WHERE name = 'AccAdvanceInterfaceConfig';
```

- [ ] **Step 5: Commit**

```bash
git add migrations/115_migrate_advance_interface_to_per_form.sql
git commit -m "feat(mig): 115 migrate AccAdvanceInterfaceConfig → per-form tables, drop old table"
```

---

## Task 2: Add `upsertFormBrandErpInterfaceMap` to brand-erp-interface-map-service.ts

**Files:**
- Modify: `src/lib/acc/brand-erp-interface-map-service.ts`

- [ ] **Step 1: Append the new export to the file** (after `deleteBrandErpInterfaceMap`)

```typescript
/**
 * Upsert a per-form InterfaceBrandCode override for `formCode`.
 *
 * Does NOT call assertClaimBrandAllowed — the AP-2 settings route is admin-gated
 * and the brand comes from listFormBrands("AP-2"), so validation is already done.
 * The unique index on AccBrandErpInterface is (FormCode, BrandCode), so MERGE on
 * that key finds at most one row and is safe.
 */
export async function upsertFormBrandErpInterfaceMap(
  claimBrandCode: string,
  interfaceBrandCode: string,
  formCode: string,
  userId: number,
): Promise<void> {
  const claim = claimBrandCode.trim().toUpperCase();
  const target = interfaceBrandCode.trim().toUpperCase();
  const form = formCode.trim();
  if (!claim) throw new Error("กรุณาระบุแบรนด์เบิก");
  if (!target) throw new Error("กรุณาเลือกแบรนด์ปลายทาง");
  if (!form) throw new Error("กรุณาระบุ FormCode");
  if (!isErpInterfaceBrandCode(target)) {
    throw new Error(`แบรนด์ปลายทาง "${target}" ไม่มีใน Brand Config`);
  }
  await writeBothPools(async (tx) => {
    await tx
      .request()
      .input("brand", sql.NVarChar, claim)
      .input("target", sql.NVarChar, target)
      .input("formCode", sql.NVarChar(20), form)
      .input("user", sql.Int, userId || null)
      .query(`
        MERGE [dbo].[AccBrandErpInterface] AS t
        USING (SELECT @brand AS BrandCode, @formCode AS FormCode) AS s
          ON t.BrandCode = s.BrandCode AND t.FormCode = s.FormCode
        WHEN MATCHED THEN
          UPDATE SET InterfaceBrandCode = @target, UpdatedAt = SYSDATETIME()
        WHEN NOT MATCHED THEN
          INSERT (BrandCode, InterfaceBrandCode, FormCode, CreatedBy)
          VALUES (@brand, @target, @formCode, @user);
      `);
  });
}
```

- [ ] **Step 2: Verify tsc**

```powershell
$env:Path="C:\Users\pc\AppData\Local\nvm\v22.23.2;$env:Path"
Set-Location R:\Form_Portal
npx tsc --noEmit 2>&1 | Select-Object -Last 5
```

Expected: no output (0 errors).

- [ ] **Step 3: Commit**

```bash
git add src/lib/acc/brand-erp-interface-map-service.ts
git commit -m "feat(acc): add upsertFormBrandErpInterfaceMap for per-form target Company override"
```

---

## Task 3: Add `mergeFormBrandAccount` to brand-account-service.ts

**Files:**
- Modify: `src/lib/acc/brand-account-service.ts`

- [ ] **Step 1: Append after `upsertBrandAccount`**

```typescript
/**
 * Write exactly one per-form GL or Bank account override for `formCode`.
 *
 * DELETE + INSERT within one writeBothPools call so the per-form row is always
 * exactly one (replacing whatever was there before). Never touches FormCode=NULL
 * rows — AP-1's defaults are untouched.
 */
export async function mergeFormBrandAccount(
  kind: BrandAccountKind,
  brandCode: string,
  formCode: string,
  accountNo: string,
  erpDescription: string | null,
  userId: number,
): Promise<void> {
  const brand = brandCode.trim().toUpperCase();
  const form = formCode.trim();
  const accNo = accountNo.trim();
  if (!brand) throw new Error("กรุณาระบุแบรนด์");
  if (!accNo) throw new Error("กรุณาระบุเลขบัญชี");
  const table = TABLE[kind];
  await writeBothPools(async (tx) => {
    // Clear existing per-form rows for this brand (there should be at most one,
    // but DELETE + INSERT is the safe pattern for a per-(brand,form) constraint).
    await tx
      .request()
      .input("brand", sql.NVarChar, brand)
      .input("formCode", sql.NVarChar(20), form)
      .query(`
        DELETE FROM [dbo].[${table}]
        WHERE BrandCode = @brand AND FormCode = @formCode
      `);
    const req = tx
      .request()
      .input("brand", sql.NVarChar, brand)
      .input("formCode", sql.NVarChar(20), form)
      .input("accNo", sql.NVarChar, accNo)
      .input("user", sql.Int, userId || null);
    if (kind === "gl") {
      req.input("erpDesc", sql.NVarChar, erpDescription?.trim() || null);
    }
    await req.query(`
      INSERT INTO [dbo].[${table}]
        (BrandCode, AccountNo, FormCode, IsActive, SortOrder${kind === "gl" ? ", ErpDescription" : ""}, CreatedBy)
      VALUES (@brand, @accNo, @formCode, 1, 0${kind === "gl" ? ", @erpDesc" : ""}, @user)
    `);
  });
}
```

- [ ] **Step 2: Verify tsc**

```powershell
$env:Path="C:\Users\pc\AppData\Local\nvm\v22.23.2;$env:Path"
Set-Location R:\Form_Portal
npx tsc --noEmit 2>&1 | Select-Object -Last 5
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/lib/acc/brand-account-service.ts
git commit -m "feat(acc): add mergeFormBrandAccount for per-form GL/Bank override"
```

---

## Task 4: Add `mergeFormBrandBranch` to brand-branch-service.ts

**Files:**
- Modify: `src/lib/acc/brand-branch-service.ts`

- [ ] **Step 1: Append after `upsertBrandBranch`**

```typescript
/**
 * Write one per-form BranchCode override for `formCode`, or clear it when
 * `branchCode` is null (falls back to the NULL-default row).
 */
export async function mergeFormBrandBranch(
  brandCode: string,
  formCode: string,
  branchCode: string | null,
  userId: number,
): Promise<void> {
  const brand = brandCode.trim().toUpperCase();
  const form = formCode.trim();
  const branch = branchCode?.trim() || null;
  if (!brand) throw new Error("กรุณาระบุแบรนด์");
  await writeBothPools(async (tx) => {
    await tx
      .request()
      .input("brand", sql.NVarChar, brand)
      .input("formCode", sql.NVarChar(20), form)
      .query(`
        DELETE FROM [dbo].[AccBrandBranchCode]
        WHERE BrandCode = @brand AND FormCode = @formCode
      `);
    if (branch) {
      await tx
        .request()
        .input("brand", sql.NVarChar, brand)
        .input("formCode", sql.NVarChar(20), form)
        .input("branch", sql.NVarChar, branch)
        .input("user", sql.Int, userId || null)
        .query(`
          INSERT INTO [dbo].[AccBrandBranchCode]
            (BrandCode, BranchCode, FormCode, IsActive, SortOrder, DeptAsBranch, CreatedBy)
          VALUES (@brand, @branch, @formCode, 1, 0, 0, @user)
        `);
    }
  });
}
```

- [ ] **Step 2: Verify tsc**

```powershell
$env:Path="C:\Users\pc\AppData\Local\nvm\v22.23.2;$env:Path"
Set-Location R:\Form_Portal
npx tsc --noEmit 2>&1 | Select-Object -Last 5
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/acc/brand-branch-service.ts
git commit -m "feat(acc): add mergeFormBrandBranch for per-form BranchCode override"
```

---

## Task 5: Add `mergeFormBrandBatch` to brand-journal-batch-service.ts

**Files:**
- Modify: `src/lib/acc/brand-journal-batch-service.ts`

- [ ] **Step 1: Append after `upsertBrandJournalBatch`**

```typescript
/**
 * Write one per-form BatchName override for `formCode`, or clear it when
 * `batchName` is null. Keyed by claim brand (AP-2 stores batch per claim brand,
 * not per interface brand). Read path uses explicit formCode='AP-2' filter
 * (see advance-erp-context.ts) to avoid resolveJournalBatchName's interface-
 * brand-first lookup.
 */
export async function mergeFormBrandBatch(
  brandCode: string,
  formCode: string,
  batchName: string | null,
  userId: number,
): Promise<void> {
  const brand = brandCode.trim().toUpperCase();
  const form = formCode.trim();
  const batch = batchName?.trim() || null;
  if (!brand) throw new Error("กรุณาระบุแบรนด์");
  await writeBothPools(async (tx) => {
    await tx
      .request()
      .input("brand", sql.NVarChar, brand)
      .input("formCode", sql.NVarChar(20), form)
      .query(`
        DELETE FROM [dbo].[AccBrandJournalBatch]
        WHERE BrandCode = @brand AND FormCode = @formCode
      `);
    if (batch) {
      await tx
        .request()
        .input("brand", sql.NVarChar, brand)
        .input("formCode", sql.NVarChar(20), form)
        .input("batch", sql.NVarChar, batch)
        .input("user", sql.Int, userId || null)
        .query(`
          INSERT INTO [dbo].[AccBrandJournalBatch]
            (BrandCode, BatchName, FormCode, IsActive, SortOrder, CreatedBy)
          VALUES (@brand, @batch, @formCode, 1, 0, @user)
        `);
    }
  });
}
```

- [ ] **Step 2: Verify tsc**

```powershell
$env:Path="C:\Users\pc\AppData\Local\nvm\v22.23.2;$env:Path"
Set-Location R:\Form_Portal
npx tsc --noEmit 2>&1 | Select-Object -Last 5
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/acc/brand-journal-batch-service.ts
git commit -m "feat(acc): add mergeFormBrandBatch for per-form JournalBatch override"
```

---

## Task 6: Rewrite advance-interface-settings-service.ts

**Files:**
- Modify: `src/lib/adv/advance-interface-settings-service.ts`

This task rewrites the file. The `listAdvanceInterfaceConfigView` function no longer reads from `AccAdvanceInterfaceConfig`. `saveAdvanceInterfacePerForm` replaces `saveAdvanceInterface`.

- [ ] **Step 1: Replace the entire file content**

```typescript
import { listAllBrands } from "@/lib/acc/brand-options";
import { listFormBrands } from "@/lib/acc/settings-service";
import { loadErpJournalBuildContext } from "@/lib/acc/erp-journal-context";
import { resolveErpTargetProfile } from "@/lib/acc/erp-target-profile";
import { listBrandErpInterfaceMaps, upsertFormBrandErpInterfaceMap } from "@/lib/acc/brand-erp-interface-map-service";
import { listBrandAccounts, mergeFormBrandAccount } from "@/lib/acc/brand-account-service";
import { listBrandBranches, mergeFormBrandBranch } from "@/lib/acc/brand-branch-service";
import { listBrandJournalBatches, mergeFormBrandBatch } from "@/lib/acc/brand-journal-batch-service";
import { AP2_FORM_CODE } from "@/features/advance/constants";

export interface AdvanceInterfaceConfigView {
  brandCode: string;
  brandName: string;
  brandLogo: string | null;
  interfaceTarget: string;
  targetFromAp2: boolean;
  bcName: string | null;
  bcConnectionName: string | null;
  bcProfileComplete: boolean;
  environment: string | null;
  branchCode: string | null;
  glAccountNo: string | null;
  bankAccountNo: string | null;
  journalBatchName: string | null;
  ready: boolean;
  active: boolean;
}

export async function listAdvanceInterfaceConfigView(): Promise<AdvanceInterfaceConfigView[]> {
  const [allBrands, ctx, ifaceMaps, ap2Brands, glRows, bankRows, branchRows, batchRows] =
    await Promise.all([
      listAllBrands(),
      loadErpJournalBuildContext(AP2_FORM_CODE),
      listBrandErpInterfaceMaps(AP2_FORM_CODE),
      listFormBrands(AP2_FORM_CODE),
      listBrandAccounts("gl", null, AP2_FORM_CODE),
      listBrandAccounts("bank", null, AP2_FORM_CODE),
      listBrandBranches(null, AP2_FORM_CODE),
      listBrandJournalBatches(null, AP2_FORM_CODE),
    ]);

  const activeByCode = new Map(ap2Brands.map((b) => [b.brandCode.toUpperCase(), b.isActive]));
  const brandByCode = new Map(allBrands.map((b) => [b.brandCode.toUpperCase(), b]));

  // Per-form maps: only keep FormCode='AP-2' overrides (not NULL defaults).
  // Fall through to ctx.brandAccounts for brands without AP-2-specific config.
  const ifaceByCode = new Map(ifaceMaps.map((m) => [m.brandCode.toUpperCase(), m]));
  const ap2GlByCode  = new Map(glRows.filter(r => r.formCode === AP2_FORM_CODE).map(r => [r.brandCode.toUpperCase(), r]));
  const ap2BankByCode = new Map(bankRows.filter(r => r.formCode === AP2_FORM_CODE).map(r => [r.brandCode.toUpperCase(), r]));
  const ap2BranchByCode = new Map(branchRows.filter(r => r.formCode === AP2_FORM_CODE).map(r => [r.brandCode.toUpperCase(), r]));
  const ap2BatchByCode = new Map(batchRows.filter(r => r.formCode === AP2_FORM_CODE).map(r => [r.brandCode.toUpperCase(), r]));

  const codes: string[] = [];
  const seen = new Set<string>();
  for (const b of ap2Brands) {
    const c = b.brandCode.toUpperCase();
    if (!seen.has(c)) { seen.add(c); codes.push(c); }
  }

  const rows = await Promise.all(
    codes.map(async (code) => {
      const master = brandByCode.get(code);
      const base = ctx.brandAccounts[code];
      const ifaceRow = ifaceByCode.get(code);

      const targetFromAp2 = ifaceRow?.formCode === AP2_FORM_CODE;
      const target = (ifaceRow?.interfaceBrandCode ?? code).toUpperCase();
      const profile = await resolveErpTargetProfile(target, AP2_FORM_CODE);

      const glAccountNo     = ap2GlByCode.get(code)?.accountNo ?? base?.glAccountNo ?? null;
      const bankAccountNo   = ap2BankByCode.get(code)?.accountNo ?? base?.bankAccountNo ?? null;
      const branchCode      = ap2BranchByCode.get(code)?.branchCode ?? base?.branchCode ?? null;
      const journalBatchName = ap2BatchByCode.get(code)?.batchName ?? base?.journalBatchName ?? null;

      const ready = !!(
        glAccountNo && bankAccountNo && journalBatchName &&
        branchCode && profile?.profileComplete
      );

      return {
        brandCode: code,
        brandName: master?.brandName ?? code,
        brandLogo: master?.brandLogo ?? null,
        interfaceTarget: target,
        targetFromAp2,
        bcName: profile?.bcName ?? null,
        bcConnectionName: profile?.bcConnectionName ?? null,
        bcProfileComplete: profile?.profileComplete ?? false,
        environment: profile?.environment ?? null,
        branchCode,
        glAccountNo,
        bankAccountNo,
        journalBatchName,
        ready,
        active: activeByCode.get(code) ?? false,
      } satisfies AdvanceInterfaceConfigView;
    }),
  );
  return rows;
}

/** Save AP-2's ERP interface config for one brand into the shared per-form tables. */
export async function saveAdvanceInterfacePerForm(
  brandCode: string,
  values: {
    interfaceBrandCode: string;
    glAccountNo: string;
    bankAccountNo: string;
    branchCode: string | null;
    journalBatchName: string | null;
  },
  userId: number,
): Promise<void> {
  await Promise.all([
    upsertFormBrandErpInterfaceMap(brandCode, values.interfaceBrandCode, AP2_FORM_CODE, userId),
    mergeFormBrandAccount("gl",   brandCode, AP2_FORM_CODE, values.glAccountNo, null, userId),
    mergeFormBrandAccount("bank", brandCode, AP2_FORM_CODE, values.bankAccountNo, null, userId),
    mergeFormBrandBranch(brandCode, AP2_FORM_CODE, values.branchCode || null, userId),
    mergeFormBrandBatch(brandCode, AP2_FORM_CODE, values.journalBatchName || null, userId),
  ]);
}
```

- [ ] **Step 2: Verify tsc**

```powershell
$env:Path="C:\Users\pc\AppData\Local\nvm\v22.23.2;$env:Path"
Set-Location R:\Form_Portal
npx tsc --noEmit 2>&1 | Select-Object -Last 10
```

Expected: 0 errors. If errors reference `advance-interface-config-service`, that is resolved in Task 8 (delete file). If errors are in this file, fix them before proceeding.

- [ ] **Step 3: Commit**

```bash
git add src/lib/adv/advance-interface-settings-service.ts
git commit -m "feat(adv): rewrite settings service — per-form read path, remove AccAdvanceInterfaceConfig"
```

---

## Task 7: Simplify advance-erp-context.ts

**Files:**
- Modify: `src/lib/adv/advance-erp-context.ts`

Remove the `getAdvanceInterfaceConfig` call. Read per-form GL/Bank/Branch/Batch explicitly (same pattern as Task 6). `ctx` is still needed for `interfaceByClaim` (target Company) and for department resolution.

- [ ] **Step 1: Replace the entire file content**

```typescript
import { loadErpJournalBuildContext } from "@/lib/acc/erp-journal-context";
import { resolveErpTargetProfile } from "@/lib/acc/erp-target-profile";
import { loadDepartmentErpMapsByTarget } from "@/lib/acc/department-map-service";
import { listBrandAccounts } from "@/lib/acc/brand-account-service";
import { listBrandBranches } from "@/lib/acc/brand-branch-service";
import { listBrandJournalBatches } from "@/lib/acc/brand-journal-batch-service";
import type { ErpBcEnvironment } from "@/lib/acc/erp-environment";
import type { BrandErpAccountConfig } from "@/lib/acc/erp-journal-builder";
import { AP2_FORM_CODE } from "@/features/advance/constants";

export interface AdvanceErpTarget {
  interfaceTarget: string;
  bcConnectionId: number;
  bcId: string;
  baseUrl: string;
  environment: ErpBcEnvironment;
}

export interface AdvanceErpContext {
  config: BrandErpAccountConfig;
  target: AdvanceErpTarget;
  erpDeptCode: string;
}

async function resolveAdvanceErpDept(
  config: BrandErpAccountConfig,
  interfaceTarget: string,
  interfaceByClaim: Record<string, string>,
  hrDeptCode: string | null,
): Promise<string> {
  const fixed = config.fixedErpDeptCode?.trim();
  if (config.deptAsBranch && fixed) return fixed;

  const hr = (hrDeptCode ?? "").trim();
  const deptMaps = await loadDepartmentErpMapsByTarget(new Map(Object.entries(interfaceByClaim)));
  const mapped = hr ? deptMaps.get(interfaceTarget)?.get(hr) ?? null : null;
  if (!mapped) {
    throw new Error(
      `ยังไม่ได้ map แผนก${hr ? ` "${hr}"` : "ของผู้ขอ"} เป็น Department ของ ERP (${interfaceTarget}) — ` +
      `ตั้งค่าที่ Accounting → Interface ERP → แผนก (HR ↔ ERP)`,
    );
  }
  return mapped;
}

/**
 * Resolve the ERP journal config + BC target for one brand's advance.
 *
 * Reads GL/Bank/Branch/Batch from the shared per-form tables (FormCode='AP-2').
 * Falls back to the NULL-default rows (AP-1's shared config) for brands that
 * have no AP-2-specific override. The target Company comes from
 * loadErpJournalBuildContext's interfaceByClaim map, which already resolves
 * the AP-2 override (AccBrandErpInterface FormCode='AP-2') before the NULL default.
 */
export async function loadAdvanceErpContext(
  brandCode: string,
  hrDeptCode?: string | null,
): Promise<AdvanceErpContext> {
  const code = brandCode.trim().toUpperCase();

  const [ctx, glRows, bankRows, branchRows, batchRows] = await Promise.all([
    loadErpJournalBuildContext(AP2_FORM_CODE),
    listBrandAccounts("gl",   code, AP2_FORM_CODE),
    listBrandAccounts("bank", code, AP2_FORM_CODE),
    listBrandBranches(code, AP2_FORM_CODE),
    listBrandJournalBatches(code, AP2_FORM_CODE),
  ]);

  // Prefer FormCode='AP-2' rows; fall back to the picked NULL-default row.
  const gl     = glRows.find(r => r.formCode === AP2_FORM_CODE)     ?? glRows[0]     ?? null;
  const bank   = bankRows.find(r => r.formCode === AP2_FORM_CODE)   ?? bankRows[0]   ?? null;
  const branch = branchRows.find(r => r.formCode === AP2_FORM_CODE) ?? branchRows[0] ?? null;
  const batch  = batchRows.find(r => r.formCode === AP2_FORM_CODE)  ?? batchRows[0]  ?? null;

  const config: BrandErpAccountConfig = {
    glAccountNo:       gl?.accountNo?.trim()       ?? null,
    erpDescription:    gl?.erpDescription?.trim()  ?? null,
    bankAccountNo:     bank?.accountNo?.trim()     ?? null,
    branchCode:        branch?.branchCode?.trim()  ?? null,
    journalBatchName:  batch?.batchName?.trim()    ?? null,
    deptAsBranch:      !!(branch?.deptAsBranch || branch?.fixedErpDeptCode?.trim()),
    fixedErpDeptCode:  branch?.fixedErpDeptCode?.trim() ?? null,
  };

  const interfaceTarget = (ctx.interfaceByClaim[code] ?? code).toUpperCase();
  const profile = await resolveErpTargetProfile(interfaceTarget, AP2_FORM_CODE);
  if (!profile?.profileComplete || !profile.bcConnectionId || !profile.bcId || !profile.baseUrl) {
    throw new Error(
      `การตั้งค่า BC สำหรับ ${interfaceTarget} ยังไม่ครบ — ตรวจสอบที่ Settings → Interface ERP`,
    );
  }

  const erpDeptCode = await resolveAdvanceErpDept(
    config, interfaceTarget, ctx.interfaceByClaim, hrDeptCode ?? null,
  );

  return {
    config,
    erpDeptCode,
    target: {
      interfaceTarget,
      bcConnectionId: profile.bcConnectionId,
      bcId: profile.bcId,
      baseUrl: profile.baseUrl,
      environment: profile.environment,
    },
  };
}
```

- [ ] **Step 2: Verify tsc**

```powershell
$env:Path="C:\Users\pc\AppData\Local\nvm\v22.23.2;$env:Path"
Set-Location R:\Form_Portal
npx tsc --noEmit 2>&1 | Select-Object -Last 10
```

Expected: 0 errors (errors about `advance-interface-config-service` resolved in Task 8).

- [ ] **Step 3: Commit**

```bash
git add src/lib/adv/advance-erp-context.ts
git commit -m "feat(adv): remove AccAdvanceInterfaceConfig from ERP context — use per-form tables"
```

---

## Task 8: Update route + delete advance-interface-config-service.ts

**Files:**
- Modify: `src/app/api/request/advance/settings/erp-interface/route.ts`
- Delete: `src/lib/adv/advance-interface-config-service.ts`

- [ ] **Step 1: Update the POST handler in route.ts**

Replace the import line:
```typescript
// OLD:
import { saveAdvanceInterface } from "@/lib/adv/advance-interface-config-service";
// NEW:
import { saveAdvanceInterfacePerForm } from "@/lib/adv/advance-interface-settings-service";
```

Replace the POST body save call (find `await saveAdvanceInterface(` and replace):
```typescript
// OLD:
await saveAdvanceInterface(brandCode, { interfaceBrandCode, glAccountNo, bankAccountNo, branchCode, journalBatchName }, Number(session.user.id));
// NEW:
await saveAdvanceInterfacePerForm(brandCode, { interfaceBrandCode, glAccountNo, bankAccountNo, branchCode, journalBatchName }, Number(session.user.id));
```

The complete updated route.ts:
```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { isErpInterfaceBrandCode } from "@/lib/acc/erp-interface-brands";
import { listAdvanceInterfaceConfigView, saveAdvanceInterfacePerForm } from "@/lib/adv/advance-interface-settings-service";

export async function GET() {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;
  try {
    const data = await listAdvanceInterfaceConfigView();
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/advance/settings/erp-interface] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;
  try {
    const body = (await req.json().catch(() => ({}))) as {
      brandCode?: string;
      interfaceBrandCode?: string;
      glAccountNo?: string;
      bankAccountNo?: string;
      branchCode?: string;
      journalBatchName?: string;
    };
    const brandCode = (body.brandCode ?? "").trim();
    if (!brandCode) return NextResponse.json({ ok: false, error: "กรุณาเลือกแบรนด์" }, { status: 400 });

    const interfaceBrandCode = (body.interfaceBrandCode ?? "").trim();
    if (!interfaceBrandCode) return NextResponse.json({ ok: false, error: "กรุณาเลือก Company ปลายทาง" }, { status: 400 });
    if (!isErpInterfaceBrandCode(interfaceBrandCode)) return NextResponse.json({ ok: false, error: "Company ปลายทางไม่ถูกต้อง" }, { status: 400 });

    const glAccountNo    = (body.glAccountNo ?? "").trim();
    const bankAccountNo  = (body.bankAccountNo ?? "").trim();
    const branchCode     = (body.branchCode ?? "").trim() || null;
    const journalBatchName = (body.journalBatchName ?? "").trim() || null;
    if (!glAccountNo)   return NextResponse.json({ ok: false, error: "กรุณาเลือก G/L Account" }, { status: 400 });
    if (!bankAccountNo) return NextResponse.json({ ok: false, error: "กรุณาเลือก Bank Account" }, { status: 400 });

    await saveAdvanceInterfacePerForm(
      brandCode,
      { interfaceBrandCode, glAccountNo, bankAccountNo, branchCode, journalBatchName },
      Number(session.user.id),
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/request/advance/settings/erp-interface] POST", err);
    const msg = err instanceof Error ? err.message : "บันทึกไม่สำเร็จ";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
```

- [ ] **Step 2: Delete advance-interface-config-service.ts**

```bash
rm R:/Form_Portal/src/lib/adv/advance-interface-config-service.ts
```

Or in PowerShell:
```powershell
Remove-Item R:\Form_Portal\src\lib\adv\advance-interface-config-service.ts
```

- [ ] **Step 3: Verify tsc — must be 0 errors**

```powershell
$env:Path="C:\Users\pc\AppData\Local\nvm\v22.23.2;$env:Path"
Set-Location R:\Form_Portal
npx tsc --noEmit 2>&1 | Select-Object -Last 10
```

Expected: 0 errors. If any file still imports from `advance-interface-config-service`, fix the import now (should be none after Tasks 6 and 7).

- [ ] **Step 4: Run tests**

```powershell
$env:Path="C:\Users\pc\AppData\Local\nvm\v22.23.2;$env:Path"
Set-Location R:\Form_Portal
npm test 2>&1 | Select-Object -Last 10
```

Expected: all tests pass (312+).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/request/advance/settings/erp-interface/route.ts
git rm src/lib/adv/advance-interface-config-service.ts
git commit -m "feat(adv): route uses saveAdvanceInterfacePerForm; delete advance-interface-config-service"
```

---

## Task 9: E2E Verify on port 3081

This task confirms the end-to-end flow works in the browser after all code and migration changes.

- [ ] **Step 1: Start dev server**

```powershell
$env:Path="C:\Users\pc\AppData\Local\nvm\v22.23.2;$env:Path"
Set-Location R:\Form_Portal
npm run dev
```

Server starts on port 3081.

- [ ] **Step 2: AP-2 Settings read — verify brands load**

Navigate to `http://localhost:3081/request/advance/settings` → Interface ERP tab.  
Expected: brand cards appear with GL/Bank/Branch/Batch values (now from per-form tables), Company selector shows correct target, Active toggles work, "(AP-2)" or "(จาก AP-1)" label on Company field.

- [ ] **Step 3: Save a brand card — verify per-form rows written**

Pick one brand card, select/confirm GL + Bank + Company, click บันทึก.  
Expected: success toast. Then verify in DB (UAT):
```sql
SELECT * FROM AccBrandGlAccount WHERE FormCode = 'AP-2';
SELECT * FROM AccBrandBankAccount WHERE FormCode = 'AP-2';
SELECT * FROM AccBrandErpInterface WHERE FormCode = 'AP-2';
```
Rows should reflect the saved values.

- [ ] **Step 4: AP-2 ERP send — verify context resolves correctly**

Open an AP-2 request in Sent state (or create test request), trigger Preview/Re-send.  
Expected: preview shows correct GL/Bank/Branch from per-form rows; no errors about missing config.

- [ ] **Step 5: AP-3 — confirm completely unaffected**

Navigate to `/request/clear-advance/settings` → Interface ERP tab.  
Expected: active badge shows correctly (from AccFormBrand); no errors; no reference to AccAdvanceInterfaceConfig in logs.

- [ ] **Step 6: Final tsc + tests**

```powershell
$env:Path="C:\Users\pc\AppData\Local\nvm\v22.23.2;$env:Path"
Set-Location R:\Form_Portal
npx tsc --noEmit 2>&1 | Select-Object -Last 5
npm test 2>&1 | Select-Object -Last 10
```

Expected: 0 tsc errors, all tests pass.

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat(ap2): Phase 2 complete — AccAdvanceInterfaceConfig removed, per-form config live"
```
