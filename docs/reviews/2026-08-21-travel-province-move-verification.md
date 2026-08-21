# TravelProvince move — applied to the live databases

Date: 2026-08-21

AP-17's province lookup table moved out of the shared `Fast_Data` database
into this application's own `Rocks_Portal_Form`. Migration 104 created
`dbo.TravelProvince` in `Rocks_Portal_Form` (identical shape, including
`UQ_TravelProvince_NameTh` recreated as a unique **constraint**, matching the
source, not a plain unique index) and copied all 77 rows across by an
id-keyed `MERGE`, preserving ids, then reseeded the identity to a floor.
Migration 105 then, inside one transaction guarded by a row-count check
followed by a content check — both taken under `TABLOCKX` on the `Fast_Data`
side — dropped the original in `Fast_Data` and replaced it with
`CREATE SYNONYM [dbo].[TravelProvince] FOR [Rocks_Portal_Form].[dbo].[TravelProvince]`.
**The synonym is permanent** — not a migration aid to be removed later. All
three applications (this app, Rocks Fast, ACC Portal) name this table
two-part, `[dbo].[TravelProvince]`, against a pool opened on `Fast_Data`; the
synonym resolves every one of their `SELECT`s (nothing writes this table in
any of the three — it has been read-only since migration 049 seeded it).

**The content guard genuinely compared whole rows here** — not an
approximation. `TravelProvince` has no `nvarchar(MAX)` column, so unlike
migration 102's five ERP tables (whose `EXCEPT` had to reduce each LOB column
to a `DATALENGTH`), all four columns (`Id`, `NameTh`, `NameEn`, `IsActive`)
sat in migration 105's `EXCEPT` projection with nothing left out. Migration
105 applied cleanly on the first attempt (see Step 4), meaning that whole-row
comparison passed for real, inside the transaction that then did the drop.

Single copy, as designed: **not** created in `Rocks_Portal_Form_UAT`, **not**
in `src/lib/acc/dual-write.ts`, **not** in `MASTER_TABLES`
(`scripts/checks/verify-master-alignment.ts`). Direct evidence, captured
2026-08-21 after both migrations had run:

```
Fast_Data synonym: [{"name":"TravelProvince","base":"[Rocks_Portal_Form].[dbo].[TravelProvince]"}]
Rocks_Portal_Form shape: {"tableId":1595152728,"rows":77,"identCur":77}
Rocks_Portal_Form_UAT OBJECT_ID (any type): {"oid":null}
```

```
$ grep -n "TravelProvince" src/lib/acc/dual-write.ts scripts/checks/verify-master-alignment.ts
(no output)
$ echo $?
1
```

No output, exit 1 — the name appears in neither file.

## Step 1 — snapshot the source before touching anything

Script run: `npx tsx --env-file=.env.local <scratch>/tp-snapshot.ts` (reads
`Fast_Data.dbo.TravelProvince` via `getDataPool()`, writes
`<scratch>/tp-snapshot.json`).

Output verbatim:

```
rows: 77
```

Exactly the count the brief predicted — no drift between the brief being
written and this task executing (unlike the sibling ERP-data-move task, whose
snapshot had already gone stale). First and last rows of the snapshot are
ordinary Thai province rows (`Id 1` = Bangkok / กรุงเทพมหานคร, `Id 77` = Ubon
Ratchathani / อุบลราชธานี), confirming the read reached all the way to the
end, not an empty, truncated, or otherwise malformed result. Checked twice:
against the snapshot file itself, and independently with a live
`ORDER BY [Id] ASC` / `DESC` query against the post-move table in
`Rocks_Portal_Form`, both agreeing.

## Step 2 — apply 104 to `Rocks_Portal_Form`

Command as run:

```
npm run apply-sql -- --db Rocks_Portal_Form --file migrations/104_portal_form_travel_province.sql
```

Output verbatim:

```
> form-portal@1.0.0 apply-sql
> tsx scripts/apply-sql.ts --db Rocks_Portal_Form --file migrations/104_portal_form_travel_province.sql

Loaded 3 batch(es) from migrations/104_portal_form_travel_province.sql

=== Rocks_Portal_Form ===
  batch 1/3 (5390 chars)
  batch 2/3 (2001 chars)
  batch 3/3 (1341 chars)
  applied 104_portal_form_travel_province.sql to Rocks_Portal_Form OK

Done.
```

Exit code 0, all three batches ran (create table, MERGE-copy, identity
reseed). As with every migration applied through `scripts/apply-sql.ts`, the
batches' own `PRINT` lines are not surfaced — the tool attaches no `info`
handler. Batch completion without error, plus Step 3's direct read, is the
signal.

## Step 3 — confirm the copy landed before dropping anything

Script run: `npx tsx --env-file=.env.local <scratch>/tp-confirm.ts` (reads
`COUNT(*)`, `MAX([Id])` and `IDENT_CURRENT('dbo.TravelProvince')` from
`Rocks_Portal_Form` via `getProductionFormPool()`).

Output verbatim:

```
{"cnt":77,"maxId":77,"identCur":77}
```

`cnt` matches Step 1's snapshot exactly (77), `maxId` equals `cnt` (no gap in
the copied ids), and `identCur` equals `maxId` (the identity has kept pace —
batch 3's reseed was inert here since `SET IDENTITY_INSERT` had already
raised it to 77 during the copy). Not short. Safe to proceed to the
irreversible step.

## Step 4 — apply 105 to `Fast_Data` (irreversible)

Command as run:

```
npm run apply-sql -- --db Fast_Data --file migrations/105_fast_data_travel_province_synonym.sql
```

Output verbatim:

```
> form-portal@1.0.0 apply-sql
> tsx scripts/apply-sql.ts --db Fast_Data --file migrations/105_fast_data_travel_province_synonym.sql

Loaded 1 batch(es) from migrations/105_fast_data_travel_province_synonym.sql

=== Fast_Data ===
  batch 1/1 (4143 chars)
  applied 105_fast_data_travel_province_synonym.sql to Fast_Data OK

Done.
```

Exit code 0. **The guard did not refuse** — no `contents differ`, no `row
counts differ`, no BLOCKED condition. The row-count check and the whole-row
`EXCEPT` both passed inside the transaction on the first attempt, so no
re-run of 104 was needed. `Fast_Data.dbo.TravelProvince` is now a synonym;
the original table and its 77 rows exist only in `Rocks_Portal_Form`.

## Step 5 — re-aim `verify-erp-data-move.ts`'s assertion

`scripts/checks/verify-erp-data-move.ts` (the ERP-sync-data-move gate, an
earlier and unrelated move) asserted `Fast_Data.dbo.TravelProvince` was still
a base table, as its evidence that *that* move's blast radius stayed inside
its five tables. Migration 105 makes that assertion false by design — the
table is now a synonym — so the gate would otherwise go red permanently, not
because of a fault. Changed the assertion from `OBJECT_ID(..., 'U')` (table)
to `OBJECT_ID(..., 'SN')` (synonym specifically, not "exists in any form" —
so an unrelated view or table of the same name would still fail it), and
updated the header comment to say the blast-radius proof is now the
`Intel_*` / `IntelMkt*` tables plus this synonym rather than a base table.
Diff as committed:

```diff
- *   - Fast_Data.dbo.TravelProvince -- a table the move must not touch -- is
- *     still a table
+ *   - Fast_Data.dbo.TravelProvince -- a table this move must not touch -- is
+ *     still reachable. It is no longer a base table: migration 105
+ *     (2026-08-21, a separate and later move) converted it into a synonym
+ *     pointing at Rocks_Portal_Form, so asserting "is a table" here would be
+ *     permanently and uninformatively red rather than catching a real fault.
+ *     This move's blast radius is now proven by the Intel_* / IntelMkt*
+ *     tables above plus this synonym specifically -- not "exists in any form",
+ *     which would also pass if something had dropped it and left an
+ *     unrelated view or table of the same name behind
  *
  // ...
-  const tp = await data.request().query(`SELECT OBJECT_ID('dbo.TravelProvince', 'U') AS [oid];`);
-  if (tp.recordset[0].oid === null) problems.push("Fast_Data.dbo.TravelProvince is no longer a table");
+  const tp = await data.request().query(`SELECT OBJECT_ID('dbo.TravelProvince', 'SN') AS [oid];`);
+  if (tp.recordset[0].oid === null) problems.push("Fast_Data.dbo.TravelProvince is not reachable as a synonym (expected one pointing at Rocks_Portal_Form after migration 105)");
```

**Self-caught mistake, worth recording plainly:** the first draft of this
edit wrote the header comment as `Intel_*/IntelMkt*` (no space around the
slash). That forms the literal substring `*/`, which closed the surrounding
`/** ... */` block comment early and left the rest of the comment's text to
be parsed as code — `npm run check:erp-data-home` failed immediately with an
esbuild transform error (`Expected ";" but found "plus"`) rather than
producing a false pass. The original file had always spaced it
`Intel_* / IntelMkt*` for exactly this reason; the fix was to match that
spacing. Caught and fixed before anything was committed — see Step 6 for the
clean re-run.

## Step 6 — run every gate

`npm run check:travel-province-home`:

```
> form-portal@1.0.0 check:travel-province-home
> tsx scripts/checks/verify-travel-province-move.ts

OK: TravelProvince lives in Rocks_Portal_Form and Fast_Data reaches it by synonym
```

No edit to this script was needed — it ran clean on the first invocation,
confirming (among the other assertions in its header): the table, its
`PK_TravelProvince` and `UQ_TravelProvince_NameTh` (the latter still a unique
constraint, key column `NameTh`), `IDENT_CURRENT >= MAX(Id)`; the `Fast_Data`
synonym's `base_object_name` names the exact database
`getProductionFormPool()` resolves; a direct count and a count read through
the synonym agree in one round-trip; `Rocks_Portal_Form_UAT` has no
`TravelProvince` object of any kind; and `Fast_Data` still holds its
`Intel_*` / `IntelMkt*` tables and all five `Erp*` synonyms.

`npm run check:erp-data-home` (after the Step 5 fix):

```
> form-portal@1.0.0 check:erp-data-home
> tsx scripts/checks/verify-erp-data-move.ts

OK: the five ERP sync tables live in Rocks_ERP_Data and Fast_Data reaches them by synonym
```

`npm run check:dept-map-home`:

```
> form-portal@1.0.0 check:dept-map-home
> tsx scripts/checks/verify-department-erp-map-move.ts

OK: DepartmentErpMap lives in Rocks_Portal_Form and Fast_Core reaches it by synonym
```

Unchanged by this task — confirms the two earlier moves are still intact.

`npm run check:alignment`:

```
> form-portal@1.0.0 check:alignment
> tsx scripts/checks/verify-master-alignment.ts

PASS — 21 configuration tables identical across Rocks_Portal_Form and Rocks_Portal_Form_UAT (84 rows compared; datetime columns and AccSetting.ERP_INTERFACE_ENV excluded by design)
```

**PASS**, as the brief said it now would (migration 103 closed the last
drift on 2026-08-21) — not a fresh break, and no new table listed, confirming
`TravelProvince` was not added to `MASTER_TABLES`.

`npx tsc --noEmit`:

```
(no output)
EXIT CODE: 0
```

`npm test`:

```
ℹ tests 285
ℹ suites 0
ℹ pass 285
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

All six gates green.

## Difference between what the brief predicted and what happened

- Step 1's count (77) matched the brief's prediction exactly — no drift, in
  contrast to the sibling ERP-data-move task where the brief's row counts
  were already stale before that task started. Consistent with
  `TravelProvince` being read-only in all three applications since migration
  049.
- Step 4's contingency — 105 refusing with `contents differ` or a short
  target, needing a re-run of 104 — did not trigger, and neither did the
  BLOCKED condition (target holding more rows than the source). 105 applied
  cleanly on the first attempt.
- Step 5 needed the edit exactly as the brief anticipated, but the first
  draft of that edit introduced a self-inflicted syntax error (an
  accidental `*/` inside prose text, closing the JSDoc comment early) that
  the sibling task's report had no equivalent of. It was caught immediately
  by running the gate — which failed loudly with a transform error rather
  than silently passing — and fixed before anything was committed.
- No edit to `scripts/checks/verify-travel-province-move.ts` (Task 1's own
  check script) was needed; it ran clean on the first invocation.
- No `BLOCKED` condition was encountered anywhere in the run.

## Outcome

- `Rocks_Portal_Form`: now holds `dbo.TravelProvince` as a real table, 77
  rows, `PK_TravelProvince` and `UQ_TravelProvince_NameTh` (a unique
  constraint) both present with the correct key columns, identity at 77.
- `Fast_Data`: `dbo.TravelProvince` is now a synonym pointing at
  `[Rocks_Portal_Form].[dbo].[TravelProvince]`, permanently. Its `Intel_*` /
  `IntelMkt*` tables and its five `Erp*` synonyms (migrations 101/102) are
  untouched.
- `Rocks_Portal_Form_UAT`: no `TravelProvince` object of any kind — single
  copy, as designed.
- `check:travel-province-home`: `OK`.
- `check:erp-data-home`: `OK` after re-aiming its `Fast_Data.dbo.TravelProvince`
  assertion from "is a table" to "is a synonym pointing at
  Rocks_Portal_Form" (Step 5).
- `check:dept-map-home`: `OK`, unchanged by this task.
- `check:alignment`: `PASS`, 21 tables, no fresh break.
- `npx tsc --noEmit`: clean. `npm test`: pass 285, fail 0.
- Files changed: `scripts/checks/verify-erp-data-move.ts` (the Step 5
  re-aim) and this document. No application source under `src/` was
  touched — Task 3 is what repoints AP-17's code at the new table.
