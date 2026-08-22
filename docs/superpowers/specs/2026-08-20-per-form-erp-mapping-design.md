# Per-form department mapping and Interface ERP configuration — design

**Status:** approved 2026-08-20. First of three related pieces; the other two
are named under "Out of scope" and get their own specs.

**Goal.** Let each form carry its own department mapping and Interface ERP
configuration where it needs to, and share one default where it does not.

---

## 1. Why

Seven configuration tables decide where an approved claim's money posts: which
brand's books, which BC company, which G/L account, bank card, journal batch,
branch code, and which ERP dimension each HR department maps to. **Every one of
them is keyed on brand alone.** A second form that needs a different answer has
nowhere to put it.

Two pieces of evidence that this is already hurting, both measured 2026-08-20:

- **`AccAdvanceInterfaceConfig` (2 rows) exists.** It is a whole table created
  so the AP-2 advance form could have its own interface configuration, because
  the shared tables could not hold a second answer. The next form gets another
  table unless this changes.
- **`AccBrandGlAccount` already has a `FormCode` column**, in both form
  databases, backfilled to `AP-1` on all three rows — and **no code reads or
  writes it.** Someone started this work and stopped. The direction was chosen;
  this finishes it.

## 2. The rule

`FormCode NULL` means *the default, for every form*. A row naming a form
overrides the default for that form only.

```sql
WHERE BrandCode = @brand
  AND (FormCode = @form OR FormCode IS NULL)
ORDER BY CASE WHEN FormCode IS NULL THEN 1 ELSE 0 END
```

Take the first row. Form-specific wins; the default answers everyone else.

This matches how the configuration is actually used — the same answer nearly
always, a different one occasionally — so a new form needs no configuration at
all until somebody wants it to differ.

**Uniqueness becomes `(FormCode, BrandCode, …)`.** SQL Server treats NULLs as
equal in a unique index, so a brand can hold exactly one default row plus one
row per form. That is the constraint we want, and we get it for free.

## 3. The tables

| Table | Rows | `FormCode` today | Action |
|---|---|---|---|
| `AccBrandErpInterface` | 5 | — | add |
| `AccBrandErpTargetSetting` | 2 | — | add |
| `AccBrandGlAccount` | 3 | yes, `AP-1` | rebackfill to NULL |
| `AccBrandBankAccount` | 3 | UAT only | add where missing |
| `AccBrandJournalBatch` | 1 | UAT only | add where missing |
| `AccBrandBranchCode` | 3 | — | add |
| `DepartmentErpMap` (`Fast_Core`) | 3 | — | add, in place |

**Every existing row becomes a default (`FormCode NULL`).** Today's behaviour is
preserved exactly — AP-1 resolves the same rows it always did, through the
fallback — and every other form inherits them until someone overrides. That is
what "default" has to mean for this to be a safe change.

**`AccBrandGlAccount`'s three `AP-1` rows are rewritten to NULL.** Leaving them
form-specific would mean AP-4 or AP-2 silently finds no G/L account, which is
the failure this design exists to prevent. If AP-1 ever needs a G/L account the
others must not inherit, that is a new row, added deliberately.

**`AccAdvanceInterfaceConfig` is not touched.** It belongs to the unmerged AP-2
branch. Folding it into the shared tables is a separate decision for whoever
owns that work; it is named here only as the evidence above.

## 4. The code

Seven services and one route read or write these tables:

| File | Tables |
|---|---|
| `src/lib/acc/brand-erp-interface-map-service.ts` | `AccBrandErpInterface` |
| `src/lib/acc/erp-target-setting-service.ts` | `AccBrandErpTargetSetting` |
| `src/lib/acc/brand-account-service.ts` | `AccBrandGlAccount`, `AccBrandBankAccount` |
| `src/lib/acc/brand-journal-batch-service.ts` | `AccBrandJournalBatch` |
| `src/lib/acc/brand-branch-service.ts` | `AccBrandBranchCode`, `AccBrandErpInterface` |
| `src/lib/acc/department-map-service.ts` | `DepartmentErpMap`, `AccBrandErpInterface` |
| `src/lib/acc/department-map-guard.ts` | both |
| `src/lib/acc/erp-prep-service.ts` | both — the read that decides a posting |
| `src/app/api/request/accounting/settings/departments/map/route.ts` | `DepartmentErpMap` |

**A single shared resolver, not seven copies of the ORDER BY.** One pure
function builds the predicate and one ranks the rows, so the rule is written
once and can be unit-tested without a database. Seven hand-written copies is
how one of them ends up missing the `IS NULL` arm and silently reading another
form's configuration.

**Reads and writes change together.** A write path that ignores `FormCode`
creates a second default row and the unique index rejects it — noisy, which is
the right failure. A *read* path that ignores it takes the first row it finds,
which may belong to another form, and is silent. That asymmetry is the main
risk in this work, and the plan must enumerate every read rather than trusting
a grep.

## 5. Migration

One migration, applied to `Rocks_Portal_Form` and `Rocks_Portal_Form_UAT`, plus
one for `Fast_Core`.

- Every `ALTER` is `IF NOT EXISTS`-guarded, so it converges the two form
  databases rather than assuming their current state. **This closes the drift
  recorded in CLAUDE.md**: `AccBrandBankAccount` and `AccBrandJournalBatch`
  carry `FormCode` in UAT and not in production, and after this they match.
  `npm run check:alignment` goes green for both.
- Backfill sets every existing row to NULL, including the three
  `AccBrandGlAccount` rows currently reading `AP-1`.
- Drop and recreate each unique index with `FormCode` leading. Do it in the
  same batch as the backfill so no window exists where the old index rejects a
  legal row.

## 6. Risks

**`Fast_Core` is shared with two other applications.** `DepartmentErpMap` is
read by `RocksFast` and `ACC_Portal`, both from their own `erp-prep-service.ts`
— the path that prepares financial journal postings. Adding a nullable column
is backward-compatible for their reads, and their writes will leave it NULL,
which is the default and therefore correct. **Before the migration runs,
confirm neither sibling has an `INSERT` without an explicit column list**; such
a statement would break on a widened table.

**A missed read is silent.** See §4.

**No behaviour changes on day one.** Every row is a default, so every form
resolves what AP-1 resolves today. The feature is inert until someone adds a
form-specific row — which is the safest possible shape for a change to the code
that decides where money posts.

## 7. Out of scope — the other two pieces

Both were approved in the same conversation and sequenced after this one.

- **Move the five ERP sync tables** — `ErpAccounts`, `ErpDimensionValue`,
  `ErpGeneralJournalBatch`, `ErpBankAccountCard`, `ErpSyncLog` — from
  `Fast_Data` to `Rocks_ERP_Data`, leaving a `SYNONYM` of each name behind in
  `Fast_Data` so both siblings keep working unchanged, against one physical
  copy with no drift. **Blocked:** the application's login `saai` currently
  gets `Login failed` on `Rocks_ERP_Data` and needs a grant.
- **Move `DepartmentErpMap`** from `Fast_Core` to `Rocks_Portal_Form`, likewise
  behind a `SYNONYM`. Note that this gives it a UAT twin it does not have
  today, so it must join the dual-written master tables and
  `verify-master-alignment.ts` — otherwise the two copies drift.

`TravelProvince` stays in `Fast_Data`. It is AP-17 reference data, not sync
output, and the request was about the sync data.
