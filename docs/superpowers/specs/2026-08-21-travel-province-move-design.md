# Moving `TravelProvince` into `Rocks_Portal_Form` — design

**Status:** approved 2026-08-21. A follow-on to the three pieces approved on
2026-08-20, requested after the last of them shipped. It is the **third
application of the same pattern**, after
`2026-08-20-department-erp-map-move-design.md` (one table out of `Fast_Core`)
and `2026-08-21-erp-sync-data-move-design.md` (five tables out of `Fast_Data`).

**Goal.** Move AP-17's province reference table into the Accounting database,
without changing which rows any of the three applications sees.

---

## 1. Why, and what it finishes

The previous piece's spec said, in its out-of-scope section, that
`TravelProvince` stays in `Fast_Data` because it is AP-17 reference data rather
than sync output. The owner has since asked for it to move as well. That is a
scope decision, and it completes something the previous two pieces left one
table short of:

**After this, no code in this application reads `Fast_Data` at all.** Today
`getDataPool()` has exactly two callers in `src/` —
`src/lib/acc/travel-booking/province-service.ts:6` and
`src/lib/acc/travel-booking/request-service.ts:455` — and both read only
`TravelProvince`. Move it and the count is zero.

What this does **not** buy is any change to sharing. Rocks Fast and ACC Portal
keep reading the same physical rows through a synonym, exactly as before.

## 2. Measured starting state (2026-08-21)

`Fast_Data.dbo.TravelProvince`:

```
[Id]       INT IDENTITY(1,1) NOT NULL     -- 77 rows, ids 1..77 with no gaps, IDENT_CURRENT 77
[NameTh]   NVARCHAR(100)     NOT NULL
[NameEn]   NVARCHAR(100)     NULL
[IsActive] BIT               NOT NULL     -- DEFAULT ((1)), auto-named DF__TravelPro__IsAct__2A164134
```

- `PK_TravelProvince` CLUSTERED on `[Id]`
- `UQ_TravelProvince_NameTh` — a unique **constraint**, not a plain unique
  index, on `[NameTh]`
- **No foreign keys, no check constraints, no computed columns**, and no view,
  procedure or function references it
- **No LOB column.** Unlike the five ERP sync tables, every column is
  comparable, so this migration's content guard can compare whole rows — see §5.
- `Rocks_Portal_Form` does not have the table today.

Across all three applications: every statement names it two-part,
`[dbo].[TravelProvince]`, on a pool opened against `Fast_Data`, and — measured
by sweeping `src/` in all three repositories for `INSERT`, `UPDATE`, `DELETE`
and `MERGE` against it — **nothing writes it anywhere.** It is seeded by
migration 049 and read-only thereafter.

Readers: this app's `province-service.ts` and `request-service.ts`; Rocks Fast's
`province-service.ts`, `request-service.ts` and its provinces route; ACC Portal's
`province-service.ts` and its provinces route.

## 3. The shape

The table moves to `Rocks_Portal_Form.dbo.TravelProvince`, reproducing the
definition above: same columns, same nullability, `PK_TravelProvince` clustered
on `Id`, and `UQ_TravelProvince_NameTh` recreated as a **unique constraint**
rather than a unique index, because that is what it is. The 77 rows are copied
with their ids preserved and the identity reseeded to 77.

`Fast_Data` keeps a permanent `SYNONYM` for
`[Rocks_Portal_Form].[dbo].[TravelProvince]`.

The one default constraint is renamed deterministically to
`DF_TravelProvince_IsActive`; the live one is auto-generated and nothing
references it by name.

**One physical copy. No UAT twin**, not dual-written, not in `MASTER_TABLES`.
Two facts force this rather than merely suggesting it: a synonym points at
exactly one database, so a sibling could never reach a UAT twin; and **nothing
writes the table in any application**, so there is no write for dual-write to
carry and nothing that could drift. The list of Thai provinces does not differ
by environment. A UAT AP-17 booking resolves production's province rows, which
is what happens today.

## 4. Who reads it afterwards

**Form Portal.** `province-service.ts` and `request-service.ts` switch their
single `getDataPool()` call each to **`getProductionFormPool()`**, keeping the
two-part table name. **Never `getFormPool()`** — the same rule migration 066
established for `TeamMember` and the two prior moves reapplied: that pool's
answer varies with the viewer's environment and there is one physical copy to
reach.

`getDataPool()` then has no caller in `src/`. It stays defined — the check
scripts for the previous move use it to read through `Fast_Data`'s synonyms, and
deleting it would be a separate decision — but its doc comment must say that
nothing in the application reads `Fast_Data` any more.

**Rocks Fast and ACC Portal.** Unchanged. They open `Fast_Data` and name the
table two-part; the synonym resolves. Every one of their statements is a
`SELECT`, so no write permission across the database boundary is even exercised.

## 5. Cutover

Two migrations, because this crosses a database boundary and
`scripts/apply-sql.ts` opens one pool per run:

- **`104_portal_form_travel_province.sql` → `Rocks_Portal_Form`.** Creates the
  table, copies the rows three-part from `[Fast_Data].[dbo].[TravelProvince]`
  under `IDENTITY_INSERT` as an id-keyed `MERGE` — insert new ids, update
  existing rows — so a re-run reconciles rather than skipping. Reseeds the
  identity to 77 as a floor.
- **`105_fast_data_travel_province_synonym.sql` → `Fast_Data`.** Drops the table
  and creates the synonym in one transaction, so no window exists in which the
  name resolves to nothing.

**105's guard compares whole rows, and this time that claim is true.**
`TravelProvince` has no `nvarchar(MAX)` column, so unlike migration 102 the
`EXCEPT` can project all four columns with nothing left out and nothing reduced
to a `DATALENGTH`. Row counts and contents are both checked inside the
transaction that performs the drop, with the source counted under `TABLOCKX` and
`SET LOCK_TIMEOUT` set beforehand for the reason migration 100 records: the pool
sets no `requestTimeout`, so node-mssql's 15 s default would otherwise send an
attention that cancels the statement without rolling the transaction back.

Because nothing writes `TravelProvince`, the mid-cutover drift that made the
previous two migrations' remedies load-bearing cannot occur here. The `MERGE`
and the guards are kept anyway — they cost nothing and the next person to stand
up a database inherits them.

**Deploy-order-independent.** Old code reaches the table through `getDataPool()`
and a two-part name, which the synonym answers; new code opens
`getProductionFormPool()` directly.

## 6. What else has to change

- `src/lib/db/mssql.ts` — `getDataPool()`'s doc comment currently names
  `TravelProvince` as what `Fast_Data` still holds for this app. After this,
  nothing does.
- `CLAUDE.md` — the architecture table's `Fast_Data` row, the AP-17 section's
  "`Fast_Data` for province lookups", and the migration list.
- `README.md` — the database table's `Fast_Data` row.
- `scripts/checks/verify-erp-data-move.ts` asserts `Fast_Data.dbo.TravelProvince`
  is still a real table, as its proof that the ERP move touched nothing outside
  its five. That assertion becomes false and must be re-aimed at the synonym.

## 7. Verification

`npm run check:travel-province-home`, asserting:

1. `Rocks_Portal_Form.dbo.TravelProvince` is a table with 77 rows, ids 1..77,
   `IDENT_CURRENT` at least `MAX(Id)`, and both indexes present under their
   original names with `UQ_TravelProvince_NameTh` still a unique **constraint**;
2. the `Fast_Data` object is in `sys.synonyms` with `base_object_name` naming
   `[Rocks_Portal_Form].[dbo].[TravelProvince]`, and the base names whatever
   `env.MSSQL_FORM_DATABASE` resolves to, so a repointed variable reds rather
   than silently reading a different database;
3. a read through the synonym returns the same count, taken in one round-trip;
4. `Rocks_Portal_Form_UAT` does **not** have the table;
5. `Fast_Data` still holds its `Intel_*` tables and the five ERP synonyms — the
   move must not have reached anything else.

There is deliberately **no write probe**. Nothing writes this table in any
application, so proving a cross-database write permission would assert something
no caller needs. Say that in the script rather than leaving its absence to be
read as an oversight.

Plus `npx tsc --noEmit`, `npm test`, and both prior gates —
`check:erp-data-home` and `check:dept-map-home` — still green.

## 8. Out of scope

- **Deleting `getDataPool()`.** It has no `src/` caller afterwards but the ERP
  check script still uses it, and removing a pool accessor is a separate change.
- **Repointing the siblings' code.** The synonym makes it unnecessary; it is
  permanent, not a migration aid.
- **A UAT twin**, now or later. §3 is the record of why.
