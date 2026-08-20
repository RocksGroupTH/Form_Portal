# Per-form ERP Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each form carry its own department mapping and Interface ERP configuration where it needs to, and share one default where it does not.

**Architecture:** Seven brand-keyed configuration tables gain a nullable `FormCode`. `NULL` is the default for every form; a row naming a form overrides it. One pure resolver builds the predicate and ranks the rows, so the rule exists once and is unit-tested without a database.

**Tech Stack:** TypeScript (ES5 target), MSSQL via `mssql`, `node:test` through `tsx`.

## Global Constraints

- **Every existing row becomes a default (`FormCode NULL`)**, including the three `AccBrandGlAccount` rows currently reading `AP-1`. Nothing resolves differently on day one.
- **One shared resolver, not seven copies of the ORDER BY.** A hand-written copy that omits the `IS NULL` arm silently reads another form's configuration.
- **A missed read is silent; a missed write is loud.** The unique index rejects a second default. Enumerate every read rather than trusting a grep.
- `Fast_Core` is shared with `RocksFast` and `ACC_Portal`. Both read `DepartmentErpMap` from their own `erp-prep-service.ts`.
- Parameterized SQL only. ES5: `Array.from()`, `indexOf`, never `[...set]`.
- Migrations name their target databases in the header and are `IF NOT EXISTS`-guarded so they converge Production and UAT rather than assuming either.
- **Migration numbering starts at 097.** 088–094 belong to the unmerged AP-4 branch, 095–096 are merged.
- Never write `Fast_Data`. Every shared-master-table write goes through `writeBothPools`.
- **Do not apply migrations.** The controller applies them and verifies both databases.

---

## File Structure

**Create:**

| File | Responsibility |
|---|---|
| `src/lib/acc/per-form-config.ts` | The default/override rule. Pure, no imports. |
| `src/lib/acc/per-form-config.test.ts` | Tests for it. |
| `migrations/097_per_form_erp_config.sql` | `FormCode` on the six form-database tables. |
| `migrations/098_core_department_map_form_code.sql` | `FormCode` on `Fast_Core.dbo.DepartmentErpMap`. |

**Modify:** `brand-erp-interface-map-service.ts`, `erp-target-setting-service.ts`, `brand-account-service.ts`, `brand-journal-batch-service.ts`, `brand-branch-service.ts`, `department-map-service.ts`, `department-map-guard.ts`, `erp-prep-service.ts`, `settings/departments/map/route.ts`, `CLAUDE.md`.

---

## Task 1: The rule, written once

**Files:**
- Create: `src/lib/acc/per-form-config.ts`, `src/lib/acc/per-form-config.test.ts`

**Interfaces produced:**
- `PER_FORM_PREDICATE: string` — the SQL fragment
- `perFormOrderBy(alias?: string): string`
- `pickForForm<T extends { formCode: string | null }>(rows: T[], formCode: string): T | null`
- `defaultsOnly<T extends { formCode: string | null }>(rows: T[]): T[]`

- [ ] **Step 1: Write the failing test**

Create `src/lib/acc/per-form-config.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickForForm, defaultsOnly, PER_FORM_PREDICATE, perFormOrderBy } from "./per-form-config";

const DEFAULT_ROW = { formCode: null, v: "default" };
const AP1_ROW = { formCode: "AP-1", v: "ap1" };
const AP4_ROW = { formCode: "AP-4", v: "ap4" };

test("a form-specific row beats the default", () => {
  assert.equal(pickForForm([DEFAULT_ROW, AP1_ROW], "AP-1")?.v, "ap1");
  assert.equal(pickForForm([AP1_ROW, DEFAULT_ROW], "AP-1")?.v, "ap1");
});

test("a form with no row of its own falls back to the default", () => {
  assert.equal(pickForForm([DEFAULT_ROW, AP1_ROW], "AP-4")?.v, "default");
});

test("another form's row is never returned", () => {
  assert.equal(pickForForm([AP1_ROW], "AP-4"), null);
  assert.equal(pickForForm([AP1_ROW, AP4_ROW], "AP-17"), null);
});

test("no rows at all yields null, not undefined", () => {
  assert.equal(pickForForm([], "AP-1"), null);
});

test("defaultsOnly keeps exactly the shared rows", () => {
  assert.deepEqual(defaultsOnly([DEFAULT_ROW, AP1_ROW, AP4_ROW]), [DEFAULT_ROW]);
});

test("the predicate names both arms, so a caller cannot half-apply it", () => {
  assert.ok(PER_FORM_PREDICATE.indexOf("@formCode") !== -1);
  assert.ok(PER_FORM_PREDICATE.indexOf("IS NULL") !== -1);
});

test("the order by puts the form-specific row first", () => {
  assert.ok(perFormOrderBy().indexOf("IS NULL THEN 1 ELSE 0") !== -1);
  assert.ok(perFormOrderBy("t").indexOf("t.FormCode") !== -1);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/lib/acc/per-form-config.test.ts`
Expected: FAIL — cannot find module `./per-form-config`.

- [ ] **Step 3: Write the module**

```ts
/**
 * The default/override rule for the brand-keyed ERP configuration tables.
 *
 * `FormCode NULL` is the default and answers every form. A row naming a form
 * overrides the default for that form alone. Most configuration is the same
 * for every form, so a new form needs no rows at all until somebody wants it
 * to differ.
 *
 * This lives in one place on purpose. Seven hand-written copies of the same
 * ORDER BY is how one of them loses the `IS NULL` arm and silently reads
 * another form's configuration — and a wrong read here decides where money
 * posts. Imports nothing, so the rule is unit-tested without a database.
 */

/** Bind `@formCode` alongside `@brandCode`. Both arms, always. */
export const PER_FORM_PREDICATE = "(FormCode = @formCode OR FormCode IS NULL)";

/** Form-specific rows sort before the default. */
export function perFormOrderBy(alias?: string): string {
  const col = alias ? `${alias}.FormCode` : "FormCode";
  return `CASE WHEN ${col} IS NULL THEN 1 ELSE 0 END`;
}

/**
 * Pick the row that answers for `formCode`: its own if it has one, else the
 * default. Returns null when neither exists — never another form's row.
 */
export function pickForForm<T extends { formCode: string | null }>(
  rows: T[],
  formCode: string,
): T | null {
  let fallback: T | null = null;
  for (const row of rows) {
    if (row.formCode === formCode) return row;
    if (row.formCode === null && fallback === null) fallback = row;
  }
  return fallback;
}

/** The shared rows — what an editor shows when it is editing the default. */
export function defaultsOnly<T extends { formCode: string | null }>(rows: T[]): T[] {
  const out: T[] = [];
  for (const row of rows) if (row.formCode === null) out.push(row);
  return out;
}
```

- [ ] **Step 4: Run the test again**

Run: `npm test -- src/lib/acc/per-form-config.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit && npm test
git add src/lib/acc/per-form-config.ts src/lib/acc/per-form-config.test.ts
git commit -m "feat(erp): the per-form default/override rule, written once"
```

---

## Task 2: The migrations

**Files:**
- Create: `migrations/097_per_form_erp_config.sql`, `migrations/098_core_department_map_form_code.sql`

**Before writing anything, run the safety check the spec requires:**

```bash
grep -rnE "INSERT[[:space:]]+INTO[[:space:]]+\[?dbo\]?\.\[?DepartmentErpMap\]?[[:space:]]*(VALUES|SELECT)" \
  "c:/Users/PC/source/repos/Web/RocksFast/src" \
  "c:/Users/PC/source/repos/Web/ACC_Portal/ACC_Portal/src" \
  src/
```

An `INSERT` with no column list breaks on a widened table. Expected: no matches. **If there is a match, stop and report it** — do not widen the shared table until it is resolved.

- [ ] **Step 1: `migrations/097_per_form_erp_config.sql`**

Header names both `Rocks_Portal_Form` and `Rocks_Portal_Form_UAT`. For **each** of the six tables — `AccBrandErpInterface`, `AccBrandErpTargetSetting`, `AccBrandGlAccount`, `AccBrandBankAccount`, `AccBrandJournalBatch`, `AccBrandBranchCode` — in this order:

1. `ALTER TABLE … ADD [FormCode] NVARCHAR(20) NULL` guarded by
   `IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.<T>') AND name = 'FormCode')`.
   Two of them already have the column in UAT only; the guard is what converges the two databases.
2. `UPDATE [dbo].<T> SET FormCode = NULL WHERE FormCode IS NOT NULL` — this is what rewrites `AccBrandGlAccount`'s three `AP-1` rows to defaults. Harmless everywhere else.
3. Drop and recreate the unique index with `FormCode` leading, **in the same batch as the backfill** so no window exists where the old index rejects a legal row:

| Table | Drop | Recreate as |
|---|---|---|
| `AccBrandErpInterface` | `UQ_AccBrandErpInterface_Brand` | `(FormCode, BrandCode)` |
| `AccBrandErpTargetSetting` | `UQ_AccBrandErpTargetSetting_Brand` | `(FormCode, BrandCode)` |
| `AccBrandGlAccount` | `UQ_AccBrandGlAccount` | `(FormCode, BrandCode, AccountNo)` |
| `AccBrandBankAccount` | `UQ_AccBrandBankAccount` | `(FormCode, BrandCode, AccountNo)` |
| `AccBrandJournalBatch` | `UQ_AccBrandJournalBatch` | `(FormCode, BrandCode, BatchName)` |
| `AccBrandBranchCode` | `UQ_AccBrandBranchCode` | `(FormCode, BrandCode, BranchCode)` |

Keep each index's original name. SQL Server treats NULLs as equal in a unique index, so a brand keeps exactly one default row plus at most one per form — the constraint we want, for free.

4. A lookup index, following the name and shape the half-finished work already established (`IX_AccBrandGlAccount_FormCode (FormCode, BrandCode, IsActive, SortOrder)`): create `IX_<T>_FormCode` on `(FormCode, BrandCode, IsActive, SortOrder)` for the four tables that have `IsActive` and `SortOrder`, and on `(FormCode, BrandCode)` for `AccBrandErpInterface` and `AccBrandErpTargetSetting`, which have neither. Guard each with `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = '<IX name>' AND object_id = OBJECT_ID('dbo.<T>'))` — object-scoped, because index names are not schema-unique.

Wrap the whole file in `SET XACT_ABORT ON;` and print a per-table line so a partial apply is visible.

- [ ] **Step 2: `migrations/098_core_department_map_form_code.sql`**

Header names **`Fast_Core` only**, and says in full why: the table is read by `RocksFast` and `ACC_Portal` from their own `erp-prep-service.ts`, a nullable column is backward-compatible for their reads, and their writes leave it NULL, which is the default and therefore correct.

Same three moves: add `[FormCode] NVARCHAR(20) NULL` guarded; backfill to NULL; drop `UQ_DepartmentErpMap_Dept` and recreate it as `(FormCode, BrandCode, DepartmentCode)` keeping the name. Add `IX_DepartmentErpMap_FormCode` on `(FormCode, BrandCode)`.

- [ ] **Step 3: Verify by reading, not running**

Run: `npx tsc --noEmit && npm test`
Expected: unchanged — this task adds no TypeScript.

Re-read both files and check each `ALTER`, `UPDATE`, `DROP INDEX` and `CREATE UNIQUE INDEX` names a table that exists and a column that will exist by the time that statement runs.

- [ ] **Step 4: Commit**

```bash
git add migrations/097_per_form_erp_config.sql migrations/098_core_department_map_form_code.sql
git commit -m "feat(erp): FormCode on the seven configuration tables"
```

**Do not apply either migration.**

---

## Task 3: The six form-database services

**Files:**
- Modify: `src/lib/acc/brand-erp-interface-map-service.ts`, `src/lib/acc/erp-target-setting-service.ts`, `src/lib/acc/brand-account-service.ts`, `src/lib/acc/brand-journal-batch-service.ts`, `src/lib/acc/brand-branch-service.ts`

**Interfaces consumed:** `PER_FORM_PREDICATE`, `perFormOrderBy`, `pickForForm`, `defaultsOnly` from Task 1.

- [ ] **Step 1: Enumerate every read before changing one**

Run and keep the output — the plan's own list is a starting point, not the authority:

```bash
grep -rnE "FROM \[?dbo\]?\.\[?AccBrand(ErpInterface|ErpTargetSetting|GlAccount|BankAccount|JournalBatch|BranchCode)\]?" src/
```

Every hit is a read that must either take a `formCode` or be justified in the report as deliberately reading defaults only.

- [ ] **Step 2: Widen the read signatures**

Each list/get function that resolves configuration for a *request* gains a
`formCode: string` parameter and applies `PER_FORM_PREDICATE` with
`perFormOrderBy()`. Each function that feeds a *settings editor* keeps its
current shape and uses `defaultsOnly` — the editor edits the default until the
UI can choose a form (see "Deliberately not in this plan").

Bind `@formCode` with `sql.NVarChar(20)` beside the existing `@brandCode`.

- [ ] **Step 3: Widen the writes**

Every `INSERT` names `FormCode`; every `MERGE` matches on it. A write that
omits it creates a second default and the unique index rejects it — which is
the loud failure we want, but the code should not rely on it.

- [ ] **Step 4: Typecheck and test**

Run: `npx tsc --noEmit && npm test`
Expected: `tsc` clean under `src/`; the suite green. `tsc` is the tool that finds every caller of a widened signature — treat each error as a call site to decide about, not a nuisance.

- [ ] **Step 5: Commit**

```bash
git add src/lib/acc/brand-erp-interface-map-service.ts src/lib/acc/erp-target-setting-service.ts src/lib/acc/brand-account-service.ts src/lib/acc/brand-journal-batch-service.ts src/lib/acc/brand-branch-service.ts
git commit -m "feat(erp): resolve the brand configuration per form"
```

---

## Task 4: The department map, and the read that decides a posting

**Files:**
- Modify: `src/lib/acc/department-map-service.ts`, `src/lib/acc/department-map-guard.ts`, `src/lib/acc/erp-prep-service.ts`, `src/app/api/request/accounting/settings/departments/map/route.ts`

**This is the task where a mistake costs money.** `erp-prep-service.ts` is the read that decides which ERP dimension an approved claim posts to.

- [ ] **Step 1: `department-map-service.ts`**

`loadDepartmentErpMapsByTarget` and every sibling read take `formCode` and apply the predicate. `saveDepartmentMappings` writes `FormCode`.

**Preserve the bound added in August:** `legacyClaimCodes` is validated against
`claimCodesForInterfaceTarget(await listBrandErpInterfaceMaps(), brandCode)`
before the delete loop, and `saveDepartmentMappings`'s target is bounded by
`isErpInterfaceBrandCode`. Both stay. If `listBrandErpInterfaceMaps` gained a
`formCode` parameter in Task 3, thread the same value through — the purge must
be bounded by the claim brands of *this form's* interface map, not another's.

- [ ] **Step 2: `erp-prep-service.ts`**

It already pins `r.FormCode = @formCode` on `AccRequest`. That form code is the one to pass into the configuration reads. Do not introduce a second source.

- [ ] **Step 3: `department-map-guard.ts`**

Its pure functions gain `formCode` only where the bound genuinely differs per form. If a function's decision does not depend on the form, leave its signature alone and say so in the report — a parameter nothing reads is worse than none.

- [ ] **Step 4: The route**

`settings/departments/map` is admin-only and edits the default. Pass `null` explicitly rather than letting the column default, so the intent is in the code.

- [ ] **Step 5: Typecheck and test**

Run: `npx tsc --noEmit && npm test`

- [ ] **Step 6: Commit**

```bash
git add src/lib/acc/department-map-service.ts src/lib/acc/department-map-guard.ts src/lib/acc/erp-prep-service.ts src/app/api/request/accounting/settings/departments/map/route.ts
git commit -m "feat(erp): resolve the department map per form"
```

---

## Task 5: Write it down

**Files:** Modify `CLAUDE.md`

- [ ] **Step 1: The rule and the tables**

Under the Business Central section, record: `FormCode NULL` is the default and answers every form, a row naming a form overrides it, the seven tables it applies to, and that `src/lib/acc/per-form-config.ts` is the one place the rule lives.

- [ ] **Step 2: What the migrations did**

097 converges Production and UAT — `AccBrandBankAccount` and `AccBrandJournalBatch` had `FormCode` in UAT only, and **this closes the drift CLAUDE.md currently records as unresolved**. Update that section rather than leaving two accounts of the same fact. 098 widens a table two sibling applications read.

- [ ] **Step 3: The state it ships in**

Every row is a default, so nothing resolves differently until someone adds an override — and there is no UI to add one yet, so today that means a SQL insert. Say so plainly.

- [ ] **Step 4: Commit**

```bash
npx tsc --noEmit && npm test
git add CLAUDE.md
git commit -m "docs(erp): the per-form default and override rule"
```

---

## Deliberately not in this plan

- **A form selector in the settings UI.** The request was to *prepare* the mapping to support several forms. Until the selector exists, an override is added by SQL — recorded in CLAUDE.md rather than left to be discovered.
- **`AccAdvanceInterfaceConfig`.** It belongs to the unmerged AP-2 branch. Folding it into the shared tables is that work's decision.
- **Moving the five ERP sync tables to `Rocks_ERP_Data`**, and **moving `DepartmentErpMap` into `Rocks_Portal_Form`.** Both approved, both sequenced after this, both get their own spec. The first is blocked on a database grant: `saai` currently gets `Login failed` on `Rocks_ERP_Data`.

---

## Self-Review

**Spec coverage:** §1 why → Task 5 records it. §2 the rule → Task 1. §3 the seven tables and the NULL backfill → Task 2. §4 the code, one shared resolver, reads-and-writes-together → Tasks 1, 3, 4. §5 migration, idempotent, drift closed → Task 2, Task 5 step 2. §6 risks: the sibling `INSERT` check → Task 2's pre-step; the silent missed read → Task 3 step 1 and Task 4; no day-one behaviour change → Task 2 step 1's backfill. §7 out of scope → carried verbatim.

**Placeholder scan:** none. Tasks 3 and 4 name the exact files and the exact rule to apply rather than restating every query, because the query bodies differ per table and the instruction that matters — which functions take `formCode` and which read defaults — is stated for each. Task 2's table-by-table index mapping is written out in full because getting one wrong is a silent constraint change.

**Type consistency:** `PER_FORM_PREDICATE`, `perFormOrderBy`, `pickForForm` and `defaultsOnly` are defined in Task 1 and consumed under those names in 3 and 4. `FormCode NVARCHAR(20) NULL` is the same type in both migrations and matches `AccRequest.FormCode`.

**One thing the spec left open, now closed:** the spec did not say whether the settings UI gains a form selector. It does not, in this plan — the request said *prepare*, and an override is a SQL insert until a selector exists. Named under "Deliberately not in this plan" and required in CLAUDE.md so it is a stated limitation rather than a surprise.
