# DepartmentErpMap move — applied to the live databases

Date: 2026-08-20

`DepartmentErpMap` moved out of the shared `Fast_Core` database into
`Rocks_Portal_Form`, its actual owner (Accounting/ERP department-to-dimension
mapping, read by this app's `department-map-service.ts` and by the Rocks Fast
and ACC Portal siblings' own `erp-prep-service.ts`). Migration 099 created the
table in `Rocks_Portal_Form` and copied its 3 rows across with their ids
preserved (1004, 1005, 1006), reseeding the identity to 2004 to match
`Fast_Core`'s `IDENT_CURRENT` at the time of the move. Migration 100 then
dropped the original table in `Fast_Core` and replaced it with
`CREATE SYNONYM [dbo].[DepartmentErpMap] FOR [Rocks_Portal_Form].[dbo].[DepartmentErpMap]`,
inside a transaction guarded by a row-count check and a full content check
(`EXCEPT` on both directions) so the drop could not run unless every source
row was confirmed present in the target. **The synonym is permanent** — all
three applications (this app, Rocks Fast, ACC Portal) keep naming the table
two-part, `[dbo].[DepartmentErpMap]`, against a pool opened on `Fast_Core`,
and it is not a migration aid to be removed later. `DepartmentErpMap` is
deliberately a single copy: it was not created in `Rocks_Portal_Form_UAT`, it
is not in `dual-write.ts`, and it is not in `MASTER_TABLES`.

## Step 1 — snapshot before touching anything

Snapshot script run: `npx tsx --env-file=.env.local <scratch>/snapshot-dept-map.ts`
(reads `Fast_Core.dbo.DepartmentErpMap` via `getCorePool()`, writes the full
recordset to a JSON file in the session scratch directory, outside the repo).

```
rows: 3
```

3 rows matched the plan's measured state, so the migration's row-count guard
was expected to pass. Snapshot ids: 1004, 1005, 1006 (BrandCode `PCTH`,
DepartmentCode `IT` / `ACC` / `OP-TRAINING`).

## Step 2 — apply 099 to `Rocks_Portal_Form`

Command as run:

```
npm run apply-sql -- --db Rocks_Portal_Form --file migrations/099_portal_form_department_erp_map.sql
```

Output verbatim:

```
> form-portal@1.0.0 apply-sql
> tsx scripts/apply-sql.ts --db Rocks_Portal_Form --file migrations/099_portal_form_department_erp_map.sql

Loaded 3 batch(es) from migrations/099_portal_form_department_erp_map.sql

=== Rocks_Portal_Form ===
  batch 1/3 (4016 chars)
  batch 2/3 (2536 chars)
  batch 3/3 (610 chars)
  applied 099_portal_form_department_erp_map.sql to Rocks_Portal_Form OK

Done.
```

**Difference from the brief:** the brief's "Expected output" quotes the SQL
`PRINT` messages the migration emits (`dbo.DepartmentErpMap created in the
form database.`, etc.). `scripts/apply-sql.ts` runs each batch with
`pool.request().batch(...)` and does not attach an `info` handler, so
SQL Server `PRINT` output is never surfaced to the console — only batch
progress and a final `... OK` per database. This is true of every migration
applied with this tool, not specific to 099; the absence of the `PRINT` text
here is not a sign anything went wrong. Step 3 confirms the actual effect
directly against the database instead of relying on console text.

## Step 3 — confirm the copy landed

Script run: `npx tsx --env-file=.env.local <scratch>/confirm-copy.ts` (reads
`Rocks_Portal_Form.dbo.DepartmentErpMap` via `getProductionFormPool()`).

```
{"n":3,"cur":2004}
```

`n` is 3 and `cur` (`IDENT_CURRENT`) is 2004, matching the brief exactly. Safe
to proceed to the irreversible step.

## Step 4 — apply 100 to `Fast_Core`

Command as run:

```
npm run apply-sql -- --db Fast_Core --file migrations/100_core_department_erp_map_synonym.sql
```

Output verbatim:

```
> form-portal@1.0.0 apply-sql
> tsx scripts/apply-sql.ts --db Fast_Core --file migrations/100_core_department_erp_map_synonym.sql

Loaded 1 batch(es) from migrations/100_core_department_erp_map_synonym.sql

=== Fast_Core ===
  batch 1/1 (4888 chars)
  applied 100_core_department_erp_map_synonym.sql to Fast_Core OK

Done.
```

Same difference as Step 2: the migration's `PRINT
'Fast_Core.dbo.DepartmentErpMap is now a synonym for
[Rocks_Portal_Form].[dbo].[DepartmentErpMap].'` is not surfaced by
`apply-sql.ts`; the batch completing without error is the signal. The
migration ran on the first attempt — no `LOCK_TIMEOUT` retry was needed.

## Step 5 — verification

Command as run: `npm run check:dept-map-home`

Output verbatim:

```
> form-portal@1.0.0 check:dept-map-home
> tsx scripts/checks/verify-department-erp-map-move.ts

verify-department-erp-map-move failed: Incorrect syntax near the keyword 'rowCount'.
```

**This is a bug in the shipped check script, not a sign the move failed.**
`scripts/checks/verify-department-erp-map-move.ts` line 62 selects
`(SELECT COUNT(*) FROM [dbo].[DepartmentErpMap]) AS rowCount` — `ROWCOUNT` is
a reserved T-SQL keyword (`SET ROWCOUNT`) and cannot be used as an unbracketed
alias. Reproduced in isolation: even a bare `SELECT 1 AS rowCount;` against
`Rocks_Portal_Form` fails with the identical message, and `SELECT 1 AS
[rowCount];` succeeds. This is unrelated to whether 099/100 ran correctly.

Per this task's constraints, no source file was touched to fix it. Instead, a
scratch copy of the script's own logic was run with only that one alias
bracketed, to get an authoritative answer on every property the shipped
script checks. Full output:

```
shape: {"rowCount":3,"identCurrent":2004,"tableId":715149593}
ids: 1004,1005,1006
indexes: IX_DepartmentErpMap_Brand,PK_DepartmentErpMap,UQ_DepartmentErpMap_Dept
uq cols: FormCode,BrandCode,DepartmentCode
synonym rows: [{"base_object_name":"[Rocks_Portal_Form].[dbo].[DepartmentErpMap]"}]
through synonym n: 3
write rowsAffected: [1]
uat oid: {"oid":null}
OK: DepartmentErpMap lives in Rocks_Portal_Form and Fast_Core reaches it by synonym
```

Every check the shipped script performs — table shape and row count (3),
`IDENT_CURRENT` (2004), the id list (1004/1005/1006), the index set including
`UQ_DepartmentErpMap_Dept` as a plain unique index (not a constraint) keyed
`FormCode, BrandCode, DepartmentCode`, the `Fast_Core` synonym resolving to
`[Rocks_Portal_Form].[dbo].[DepartmentErpMap]`, a read through the synonym
returning 3 rows, a rolled-back write through the synonym (the siblings'
`MERGE` shape) succeeding, and no `DepartmentErpMap` object existing in
`Rocks_Portal_Form_UAT` — passed.

The record above is kept rather than deleted: it is the fact that this script
had been written and reviewed twice, in Task 1, without ever once being
executed against a live database — the syntax error was there from the first
draft and nothing caught it until this task actually ran the gate.

### The fix, and the real gate

Authorized as a follow-up correction to this same task (the "no source
changes" constraint had been a mistake — a task that leaves Step 5's gate
unrunnable is not finished). `scripts/checks/verify-department-erp-map-move.ts`
line 62 now reads `AS [rowCount]`, with a comment at the fix site explaining
why the brackets are load-bearing: `ROWCOUNT` is a reserved T-SQL keyword, so
an unbracketed alias turns the whole batch into a syntax error rather than a
failed assertion, which is what made this look like the migration had broken
when it had not. The rest of the file's aliases (`identCurrent`, `tableId`,
`colName`, `n`, `tgt`, `src`, `oid`) were each probed individually
(`SELECT 1 AS <alias>;`) and none collide with a reserved word — only
`rowCount` needed the fix.

Command as run: `npm run check:dept-map-home`

Output verbatim:

```
> form-portal@1.0.0 check:dept-map-home
> tsx scripts/checks/verify-department-erp-map-move.ts

OK: DepartmentErpMap lives in Rocks_Portal_Form and Fast_Core reaches it by synonym
```

The actual npm script now reports `OK`, matching the brief exactly. This
supersedes the scratch run above as the authoritative Step 5 result;
`npx tsc --noEmit` (clean under `src/` and `scripts/`; unrelated pre-existing
`.next/types/validator.ts` errors about a `reimburse` route not present in
this branch's `src/`) and `npm test` (`pass 285, fail 0`) were also re-run
clean after the fix.

## Step 6 — `check:alignment` unchanged

Command as run: `npm run check:alignment`

Summary line and the two pre-existing mismatches (verbatim row counts):

```
FAIL — configuration has drifted between Rocks_Portal_Form and Rocks_Portal_Form_UAT
  AccFormMaster: Rocks_Portal_Form has 6 row(s), Rocks_Portal_Form_UAT has 7
  AccFormBrand: Rocks_Portal_Form has 18 row(s), Rocks_Portal_Form_UAT has 23
```

Both counts match the brief's expected pre-existing AP-3 drift exactly (6 vs
7, 18 vs 23) and no `DepartmentErpMap` line appears. `MASTER_TABLES` in
`scripts/checks/verify-master-alignment.ts` still lists exactly 21 tables and
does not include `DepartmentErpMap`; `src/lib/acc/dual-write.ts` does not
reference it either.

## Outcome

- `Rocks_Portal_Form.dbo.DepartmentErpMap`: table, 3 rows (ids 1004–1006),
  identity reseeded to 2004.
- `Fast_Core.dbo.DepartmentErpMap`: synonym for
  `[Rocks_Portal_Form].[dbo].[DepartmentErpMap]`, permanent.
- `Rocks_Portal_Form_UAT`: no `DepartmentErpMap` object, as required.
- `check:alignment`: only the pre-existing AP-3 data drift, unchanged by this
  work.
- `check:dept-map-home`: the shipped script originally crashed on a
  pre-existing unbracketed-`rowCount`-alias bug (`ROWCOUNT` is a reserved
  T-SQL keyword). Fixed in `scripts/checks/verify-department-erp-map-move.ts`
  and re-run for real: `OK: DepartmentErpMap lives in Rocks_Portal_Form and
  Fast_Core reaches it by synonym`.
- `npx tsc --noEmit`: clean under `src/` and `scripts/`.
- `npm test`: `pass 285, fail 0`.
