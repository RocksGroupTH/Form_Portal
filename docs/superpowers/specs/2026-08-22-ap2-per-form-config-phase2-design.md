# AP-2 Phase 2: Migrate off AccAdvanceInterfaceConfig — Design Spec

**Date:** 2026-08-22  
**Branch:** `feat/ap-3-clear-advance`  
**Author:** Plume / Pasapong

---

## Goal

Remove `AccAdvanceInterfaceConfig` (AP-2's dedicated config table) and migrate its data into the seven shared per-form ERP tables that master introduced. After migration, `loadErpJournalBuildContext("AP-2")` is the single source of truth for AP-2's journal config — the same path every other form uses.

---

## Background

Master added a `FormCode` column to seven shared ERP config tables (`AccBrandErpInterface`, `AccBrandGlAccount`, `AccBrandBankAccount`, `AccBrandBranchCode`, `AccBrandJournalBatch`, `AccBrandErpTargetSetting`, `DepartmentErpMap`) and a pure rule module `src/lib/acc/per-form-config.ts` (`perFormPredicate` / `pickForForm` / `pickAllForForm` / `perFormWriteMatch`). A `FormCode IS NULL` row is the default (answers every form); a form-specific row overrides it for that form only.

`AccAdvanceInterfaceConfig` was created before this model existed. It is the anti-pattern the per-form model replaces.

---

## Architecture

### Before

```
AP-2 settings write  →  AccAdvanceInterfaceConfig (5 cols, 1 row/brand)
AP-2 journal context →  loadErpJournalBuildContext("AP-2")
                        + manual merge with AccAdvanceInterfaceConfig rows
```

### After

```
AP-2 settings write  →  FormCode='AP-2' rows in 5 shared per-form tables
AP-2 journal context →  loadErpJournalBuildContext("AP-2") only
                        (FormCode='AP-2' rows win over NULL default via pickForForm — automatic)
```

---

## What Is NOT Changing

The following survive Phase 2 completely unchanged:

- `AccFormBrand` / `brand-active-service.ts` — Active toggle (IsActive per form+brand)
- `AccAdvanceErpAttempt` / `advance-erp-attempt-service.ts` — ERP re-send attempt log
- `advance-batch-service.ts` — journal batch sync + dropdown
- All `src/lib/clr/` files — AP-3 clear-advance is unaffected
- `AdvanceErpInterfaceSettings.tsx` — UI data shape unchanged; no component changes
- AP-3 settings UI (`ClrErpInterfaceSettings.tsx`) — unaffected

---

## Components

### 1. SQL Migration — `migrations/115_migrate_advance_interface_to_per_form.sql`

Runs on **both** `Rocks_Portal_Form` and `Rocks_Portal_Form_UAT` (same as all migrations).

Steps:
1. INSERT `InterfaceBrandCode` rows → `AccBrandErpInterface` with `FormCode='AP-2'` (skip if row already exists)
2. INSERT `GlAccountNo` / `GlErpDescription` rows → `AccBrandGlAccount` with `FormCode='AP-2'`
3. INSERT `BankAccountNo` rows → `AccBrandBankAccount` with `FormCode='AP-2'`
4. INSERT `BranchCode` rows → `AccBrandBranchCode` with `FormCode='AP-2'`
5. INSERT `JournalBatchName` rows → `AccBrandJournalBatch` with `FormCode='AP-2'`
6. `DROP TABLE AccAdvanceInterfaceConfig`

Each INSERT: skips NULL source values (no row inserted if the field is null), uses `NOT EXISTS` guard (idempotent), sets `IsActive = 1` and `SortOrder = 0` for the migrated rows (required by the shared tables' schema).

---

### 2. New Per-Form Write Functions in `acc/` (Approach A)

One new exported function per service. Existing AP-1 write functions are **not modified** — their `assertClaimBrandAllowed` / `perFormWriteMatch(null)` logic remains unchanged.

| File | New Function |
|------|-------------|
| `src/lib/acc/brand-erp-interface-map-service.ts` | `upsertFormBrandErpInterfaceMap(brand, target, formCode, userId)` |
| `src/lib/acc/brand-account-service.ts` | `mergeFormBrandAccount(kind, brand, formCode, accountNo, erpDesc?, userId)` |
| `src/lib/acc/brand-branch-service.ts` | `mergeFormBrandBranch(brand, formCode, branchCode, userId)` |
| `src/lib/acc/brand-journal-batch-service.ts` | `mergeFormBrandBatch(brand, formCode, batchName, userId)` |

Design rules for each new function:
- **No `assertClaimBrandAllowed`** — the AP-2 settings route is admin-gated and brand comes from `listFormBrands("AP-2")`, so validation is already done at the caller.
- **MERGE** keyed on `(BrandCode, FormCode)` — idempotent, safe to retry.
- **`writeBothPools`** — dual-write Prod + UAT, same as all other settings writes.
- **`FormCode = @formCode`** in both WHEN MATCHED and WHEN NOT MATCHED arms.

---

### 3. AP-2 Save Layer — `src/lib/adv/advance-interface-settings-service.ts`

Delete `advance-interface-config-service.ts` (all exports replaced).

Add `saveAdvanceInterfacePerForm(brandCode, fields, userId)`:

```typescript
await Promise.all([
  upsertFormBrandErpInterfaceMap(brand, fields.interfaceBrandCode, "AP-2", userId),
  mergeFormBrandAccount("gl",   brand, "AP-2", fields.glAccountNo, null, userId),
  mergeFormBrandAccount("bank", brand, "AP-2", fields.bankAccountNo, null, userId),
  mergeFormBrandBranch(brand, "AP-2", fields.branchCode, userId),
  mergeFormBrandBatch(brand, "AP-2", fields.batchName, userId),
]);
```

Five writes run in parallel. Each is an idempotent MERGE — if one fails, the client retries safely.

---

### 4. Route Update — `src/app/api/request/advance/settings/erp-interface/route.ts`

POST handler: replace `saveAdvanceInterface(...)` with `saveAdvanceInterfacePerForm(...)`. No change to request/response shape.

---

### 5. Read Path Simplification

#### `src/lib/adv/advance-interface-settings-service.ts` (`listAdvanceInterfaceConfigView`)

Remove:
- `listAdvanceInterfaceConfig()` call and all usage of `ap2` variable
- `resolveFormAccess("AP-2")` call and `ap2Access`, `ap2Environment` variables (dead code since `resolveErpTargetProfile` no longer takes an env override)

Add:
- `listBrandErpInterfaceMaps("AP-2")` — the picked rows carry `formCode` which reveals whether AP-2 has its own override

Replace target resolution:
```typescript
const ifaceMap = new Map(
  (await listBrandErpInterfaceMaps("AP-2")).map(m => [m.brandCode.toUpperCase(), m])
);
// Per brand:
const ifaceRow = ifaceMap.get(code);
const targetFromAp2 = ifaceRow?.formCode === "AP-2";
const target = (ifaceRow?.interfaceBrandCode ?? code).toUpperCase();
// GL / Bank / Branch / Batch come from ctx.brandAccounts[code] — already per-form resolved
```

#### `src/lib/adv/advance-erp-context.ts` (`loadAdvanceErpContext`)

Remove:
- `getAdvanceInterfaceConfig()` call and `cfg` variable
- All `cfg?.field ?? ...` fallback chains

Replace:
```typescript
const ctx = await loadErpJournalBuildContext("AP-2");
const base = ctx.brandAccounts[code];
// base already contains AP-2's own values (FormCode='AP-2' wins via pickForForm)
const interfaceTarget = (ctx.interfaceByClaim[code] ?? code).toUpperCase();
```

---

## Data Flow After Phase 2

### Settings Read

```
GET /api/request/advance/settings/erp-interface
  → listAdvanceInterfaceConfigView()
  → Promise.all([
      loadErpJournalBuildContext("AP-2"),   // GL/Bank/Branch/Batch/InterfaceMap all per-form
      listBrandErpInterfaceMaps("AP-2"),    // for targetFromAp2 flag
      listFormBrands("AP-2"),               // card list + active flag
    ])
  → returns AdvanceInterfaceConfigView[] (same shape as before)
```

### Settings Write

```
POST /api/request/advance/settings/erp-interface
  {brandCode, interfaceBrandCode, glAccountNo, bankAccountNo, branchCode, journalBatchName}
  → saveAdvanceInterfacePerForm(brand, fields, userId)
  → Promise.all([5 MERGE writes into shared tables with FormCode='AP-2'])
```

### AP-2 ERP Send

```
loadAdvanceErpContext(brandCode)
  → loadErpJournalBuildContext("AP-2")
     ctx.brandAccounts[code]    // GL/Bank/Branch/Batch — AP-2 row wins via pickForForm
     ctx.interfaceByClaim[code] // target Company — AP-2 row wins via pickAllForForm
  → resolveErpTargetProfile(interfaceTarget, "AP-2")
  → build journal + send to BC
```

---

## File Summary

| File | Action |
|------|--------|
| `migrations/115_migrate_advance_interface_to_per_form.sql` | Create |
| `src/lib/acc/brand-erp-interface-map-service.ts` | Add `upsertFormBrandErpInterfaceMap` |
| `src/lib/acc/brand-account-service.ts` | Add `mergeFormBrandAccount` |
| `src/lib/acc/brand-branch-service.ts` | Add `mergeFormBrandBranch` |
| `src/lib/acc/brand-journal-batch-service.ts` | Add `mergeFormBrandBatch` |
| `src/lib/adv/advance-interface-config-service.ts` | **Delete** |
| `src/lib/adv/advance-interface-settings-service.ts` | Simplify read + add per-form save |
| `src/lib/adv/advance-erp-context.ts` | Remove AccAdvanceInterfaceConfig dependency |
| `src/app/api/request/advance/settings/erp-interface/route.ts` | POST calls new save |

---

## Acceptance Criteria

1. `tsc --noEmit` → 0 errors
2. `npm test` → all pass (≥312)
3. AP-2 settings page loads correctly — card list from AccFormBrand AP-2, GL/Bank/Branch/Batch and Company from per-form tables
4. Save button writes FormCode='AP-2' rows into the five shared tables (verify via SQL)
5. "(AP-2)" label shows for configured brands; "(จาก AP-1)" for unconfigured (falling back to default)
6. AP-2 ERP send still works end-to-end (loadAdvanceErpContext resolves correct GL/target)
7. `AccAdvanceInterfaceConfig` table no longer exists in DB
8. AP-3 settings and ERP send completely unaffected
