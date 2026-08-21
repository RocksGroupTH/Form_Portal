# Moving the five ERP sync tables into `Rocks_ERP_Data` — design

**Status:** approved 2026-08-21. Third and last of the three pieces approved
together on 2026-08-20. The first shipped as
`2026-08-20-per-form-erp-mapping-design.md`, the second as
`2026-08-20-department-erp-map-move-design.md`.

**Goal.** Give the data this application syncs out of Business Central its own
database, without changing which rows any of the three applications sees.

---

## 1. Why, and where the line falls

The five tables are a **mirror of Business Central**: what G/L accounts,
dimension values, journal batches and bank account cards exist over there, plus
the log of each sync run. They are not this application's configuration; nothing
in them is a decision anybody here made. Putting them in their own database says
that.

**The line was drawn explicitly on 2026-08-21, in response to the question
"shouldn't journal batch data live in `Rocks_ERP_Data`?":**

> Data **synced from** Business Central goes to `Rocks_ERP_Data`. The
> per-brand and per-form **choices this app makes** stay in `Rocks_Portal_Form`.

There are two journal-batch tables and the distinction is the whole point:

| Table | What it is | Where it lives |
|---|---|---|
| `ErpGeneralJournalBatch` (174 rows) | every journal batch BC has, with `BcCompanyId`, `SyncedAt` and the raw OData payload | **moves** to `Rocks_ERP_Data` |
| `AccBrandJournalBatch` (1 row: `PCTH → TRAVELING`) | which of those 174 AP-1's PCTH claims post to, picked by a person at Settings | **stays** in `Rocks_Portal_Form` |

The same pairing holds for `ErpAccounts` against `AccBrandGlAccount`, and
`ErpBankAccountCard` against `AccBrandBankAccount`. Moving the right-hand column
would be a different change and a worse one: those tables are five of the seven
that migration 097 gave a `FormCode` column and a unique index leading with it,
they are dual-written with UAT twins and live in `MASTER_TABLES`, and
`AccBrandJournalBatch.CreatedBy` refers to `TeamMember` in
`Rocks_Portal_Form`. Relocating them would drop the UAT twin — a behaviour
change, not a change of address.

**What this does not buy.** The rows stay shared: Rocks Fast and ACC Portal read
and write the same physical rows through a synonym, exactly as before. This
application still needs `Fast_Data` for other tables (`TravelProvince`, the
department lookups).

## 2. Measured starting state (2026-08-21)

`Rocks_ERP_Data` exists, is **empty** (0 tables), is `Thai_CI_AS` — the same
collation as `Fast_Core`, `Rocks_Portal_Form` and `Rocks_Portal_Form_UAT` — and
`saai` is `db_owner` in it with `CREATE TABLE` / `DROP TABLE` proven. The login
grant that blocked this piece since 2026-08-20 is in place.

In `Fast_Data`:

| Table | Rows | `IDENT_CURRENT` | Columns | Indexes |
|---|---:|---:|---:|---:|
| `ErpAccounts` | 4,793 | 4793 | 12 | 3 |
| `ErpDimensionValue` | 806 | 806 | 10 | 3 |
| `ErpGeneralJournalBatch` | 174 | 174 | 12 | 3 |
| `ErpBankAccountCard` | 64 | 64 | 13 | 3 |
| `ErpSyncLog` | 21 | 21 | 9 | 2 |

Every one has an `IDENTITY` column and two or three default constraints. Across
all five: **no foreign keys, no check constraints, no computed columns, and no
view, procedure or function references them.** Total data is a few megabytes.

Three details of their shape, taken from the live catalog rather than assumed,
each of which changes how the migration must be written:

- **All five have an `nvarchar(MAX)` column**, not four. Four carry `RawJson`,
  holding the OData payload each row was built from; `ErpSyncLog` carries
  `ErrorMessage`. That type is what shapes the migration's guard — see §5.
- **Four of the five carry their `UQ_*` as a UNIQUE *constraint*, not a plain
  unique index** — `UQ_ErpAccounts`, `UQ_ErpDimensionValue`,
  `UQ_ErpGeneralJournalBatch`, `UQ_ErpBankAccountCard`. `ErpSyncLog` has no
  `UQ_*` at all, only the non-unique `IX_ErpSyncLog_BrandStarted`. The
  recreation must use `CONSTRAINT [UQ_…] UNIQUE (…)` and not `CREATE UNIQUE
  INDEX`: they are different objects, and CLAUDE.md already records the cost of
  confusing them — a `DROP INDEX` against a unique constraint raises Msg 3723,
  which is what caught migration 097.
- **Some default constraints are auto-named and some are not** —
  `DF_ErpAccounts_IsBlocked` beside `DF__ErpDimens__IsBlo__5DCAEF64` and
  `DF__ErpSyncLo__RowsU__628FA481`. The new tables name all of them
  deterministically (`DF_<Table>_<Column>`). Nothing references a default
  constraint by name, so this is safe, and it must be stated in the migration
  header rather than described as an exact reproduction.

Three facts about the code, measured across all three repositories:

- **Every statement names the table two-part**, `[dbo].[ErpAccounts]` and so on,
  on a pool opened against `Fast_Data`. No three-part name anywhere.
- **Every statement is DML** — `INSERT`, `MERGE`, `UPDATE`, `SELECT`. A synonym
  resolves all of them.
- **There is no `TRUNCATE` in any of the three applications.** This matters
  because `TRUNCATE TABLE` is the one common statement that does *not* resolve
  through a synonym; had the sync used it instead of `MERGE`, the synonym
  approach would not work and this design would need the siblings changed.

Readers and writers: this app's `src/lib/erp/account-sync.ts` (all four data
tables plus the log) and `src/lib/erp/dimension-sync.ts`
(`ErpDimensionValue`, the log), plus `src/lib/acc/department-map-service.ts`'s
`loadErpDeptDisplayNamesByTargetBrand()`. Rocks Fast has the same two sync
modules; ACC Portal reads through its `erp-options-service.ts` and
`department-map-service.ts`.

## 3. The shape

The five tables move to `Rocks_ERP_Data`, reproducing their definitions exactly:
same columns, same nullability, same primary keys and indexes under their
existing names, same default constraints. Rows are copied with their `Id` values
preserved and each table's identity reseeded to the value measured above.

`Fast_Data` keeps **five synonyms**, one per table, each pointing at
`[Rocks_ERP_Data].[dbo].[<name>]`.

**One physical copy each. No UAT twin**, no dual-write, no `MASTER_TABLES`
entries. `Fast_Data` has no UAT twin today, and these rows are a mirror of what
Business Central actually holds — there is no second version of that to test
against. This matches the decision recorded for `DepartmentErpMap` and, by the
line in §1, is the same decision applied to the same kind of data.

## 4. Who reads it afterwards

**Form Portal.** A new pool, `getErpDataPool()`, backed by a new
`MSSQL_ERP_DATA_DATABASE` environment variable defaulting to `Rocks_ERP_Data`,
alongside the existing `MSSQL_DATA_DATABASE`. `src/lib/erp/account-sync.ts`,
`src/lib/erp/dimension-sync.ts` and
`loadErpDeptDisplayNamesByTargetBrand()` in `src/lib/acc/department-map-service.ts`
open it instead of `getDataPool()`, keeping their two-part table names.

Everything else that uses `getDataPool()` stays on it — `Fast_Data` still holds
`TravelProvince` and the department lookups, and this move does not touch them.

**Rocks Fast and ACC Portal.** Unchanged. They open `Fast_Data` and name the
tables two-part; the synonyms resolve. After this, the synonyms exist purely for
those two applications, which is a rule that can be stated in one sentence and
checked.

## 5. Cutover

Two migration files, because this crosses a database boundary and
`scripts/apply-sql.ts` opens one pool per run:

- **`101_erp_data_sync_tables.sql` → `Rocks_ERP_Data`.** Creates the five
  tables, copies their rows three-part from `[Fast_Data].[dbo].[…]` under
  `IDENTITY_INSERT` as an **id-keyed top-up** (`WHERE NOT EXISTS … t.Id = s.Id`,
  so a re-run tops up rather than skipping or duplicating), and reseeds each
  identity.
- **`102_fast_data_erp_synonyms.sql` → `Fast_Data`.** Drops the five tables and
  creates the five synonyms, all inside one transaction so no window exists in
  which any of the names resolves to nothing.

**102's guard is the load-bearing part**, as it was for migration 100. Per
table, inside the transaction that performs the drops, under `TABLOCKX` on the
source: the target must exist as a table, the row counts must match, and the
contents must match.

**The content check cannot be the whole-row `EXCEPT` migration 100 used.** Every
one of the five has an `nvarchar(MAX)` column, and dragging 4,793 JSON payloads
through a set comparison while holding an exclusive lock on a table three
applications write is the wrong trade. Instead the `EXCEPT` covers **every
non-LOB column plus `DATALENGTH(<lob>)`** — `RawJson` on four tables,
`ErrorMessage` on `ErpSyncLog` — which detects a changed payload without
materialising it.

That is weaker than a whole-row check: a payload edited to exactly the same byte
length passes. **Say so in the header.** The previous piece shipped two false
claims of precisely this kind — a guard described as comparing more than it did
— and one of them was written while correcting the other.

**Order is 101 then 102**, and 102 must refuse if any table's counts or contents
disagree. `SET LOCK_TIMEOUT` before the transaction, for the same reason as
migration 100: `makeConfig` sets no `requestTimeout`, so node-mssql's 15 s
default would otherwise send an attention that cancels the statement without
rolling the transaction back.

**The cutover is deploy-order-independent.** Old code reaches the tables through
`getDataPool()` and a two-part name, which the synonyms answer; new code opens
`getErpDataPool()` directly. Both work once the synonyms exist.

**A sync run during the window is the likeliest way this refuses.** All three
applications write `ErpSyncLog`, and the sync also `MERGE`s the four data
tables. If one runs between 101 and 102, counts diverge and 102 refuses —
correctly. The remedy is to re-run 101, which tops up, and then 102. Confirm no
sync is scheduled or running before starting.

## 6. What else has to change

- `src/env.ts` — add `MSSQL_ERP_DATA_DATABASE`, defaulting to `Rocks_ERP_Data`,
  in both the schema and the `process.env` mapping.
- `.env.local` and `.env.example` — add the variable beside `MSSQL_DATA_DATABASE`.
- `src/lib/db/mssql.ts` — add `getErpDataPool()`.
- `CLAUDE.md` — the 3-database architecture table gains a row; the "Environment
  Variables" block gains the variable; the Business Central section says the
  sync modules query `Rocks_ERP_Data` rather than `Fast_Data`; and the
  `Fast_Data` row must stop claiming the ERP sync tables while keeping what it
  still does hold.

## 7. Verification

A check script, `npm run check:erp-data-home`, asserting for each of the five:

1. the table exists in `Rocks_ERP_Data` with the row count and `IDENT_CURRENT`
   measured in §2, and its indexes present under their original names;
2. the `Fast_Data` object is in `sys.synonyms` with a `base_object_name` naming
   `[Rocks_ERP_Data].[dbo].[<name>]`;
3. a read through the synonym returns the same count;
4. a **write** through the synonym succeeds — a `MERGE` inside a transaction
   that is rolled back, proving the siblings' cross-database permission, which
   would otherwise be discovered the next time either app ran a sync;
5. `Fast_Data` still holds `TravelProvince` as a real table, so the move is
   proven not to have touched anything outside its five.

Plus: `npx tsc --noEmit` clean, `npm test` green, and
`npm run check:dept-map-home` still `OK` — the previous piece's gate, which
shares the `Fast_Data` pool and must not have been disturbed.

## 8. Out of scope

- **Moving `AccBrandJournalBatch`, `AccBrandGlAccount`, `AccBrandBankAccount`,
  `AccBrandBranchCode` or `AccBrandErpInterface`.** §1 is the record of why.
- **`TravelProvince` and the department lookups** stay in `Fast_Data`. They are
  AP-17 reference data and HR-facing lookups, not sync output.
- **Repointing the siblings' code.** They are separate repositories and the
  synonyms make it unnecessary. The synonyms are permanent, not a migration aid.
- **Giving these tables UAT twins**, now or later.
