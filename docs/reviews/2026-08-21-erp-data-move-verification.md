# ERP sync table move — applied to the live databases

Date: 2026-08-21

The five Business Central sync tables — `ErpAccounts`, `ErpDimensionValue`,
`ErpGeneralJournalBatch`, `ErpBankAccountCard`, `ErpSyncLog` — moved out of the
shared `Fast_Data` database into their own `Rocks_ERP_Data`. Migration 101
created the five tables in `Rocks_ERP_Data` (identical shape, including the
four `UQ_*` unique constraints and the lookup indexes) and copied every row
across by an id-keyed `MERGE`, preserving ids and reseeding each identity to a
floor. Migration 102 then, inside one transaction guarded by a row-count check
per table followed by a content check per table, dropped the five originals in
`Fast_Data` and replaced them with
`CREATE SYNONYM [dbo].[<name>] FOR [Rocks_ERP_Data].[dbo].[<name>]`. **The
synonyms are permanent** — not a migration aid to be removed later. All three
applications (this app, Rocks Fast, ACC Portal) that sync Business Central
data continue to name these tables two-part (`[dbo].[ErpAccounts]` etc.)
against a pool opened on `Fast_Data`; the synonym resolves every `INSERT`,
`MERGE`, `UPDATE` and `SELECT` those sync jobs issue. Nothing writes
`Rocks_ERP_Data` directly until a later task repoints this app's own sync code
at it.

**What the content guard proves and does not.** Each of the five tables has
an `nvarchar(MAX)` column (`RawJson` on four, `ErrorMessage` on
`ErpSyncLog`). Dragging thousands of JSON payloads through a full-row `EXCEPT`
while holding `TABLOCKX` on tables three applications write continuously was
judged the wrong trade, so migration 102's content check compares every
non-LOB column plus `DATALENGTH` of the LOB column, not the LOB's bytes
themselves. A payload edited to exactly the same byte length would pass. That
weakening is deliberate and stated in the migration's own header rather than
described as a whole-row check. `TABLOCKX` is taken on the `Fast_Data` side
only — the side three applications can still write during the migration
window — not on `Rocks_ERP_Data`, which nothing writes yet.

Single copy, as designed: neither table exists in any `_UAT` database, neither
is in `src/lib/acc/dual-write.ts`, and neither is in `MASTER_TABLES`
(`scripts/checks/verify-master-alignment.ts`). `Fast_Data` has no UAT twin and
there is no second copy of what Business Central holds to test against.

## Step 1 — confirm no sync is running, snapshot the row counts

Script run: `npx tsx --env-file=.env.local <scratch>/erp-snapshot.ts` (reads
the five tables in `Fast_Data` via `getDataPool()`).

**The brief's row counts were already stale before this task started** — a
sync had run since the 2026-08-21 measurement the brief itself was written
against. Measured here:

```
counts: {"ErpAccounts":4813,"ErpDimensionValue":808,"ErpGeneralJournalBatch":182,"ErpBankAccountCard":64,"ErpSyncLog":21}
most recent sync runs: [{"Id":21,"SyncType":"DIMENSION_VALUES","BrandCode":"UNO","Status":"success","StartedAt":"2026-06-22T09:04:29.549Z","FinishedAt":"2026-06-22T16:04:25.677Z"},{"Id":20,"SyncType":"DIMENSION_VALUES","BrandCode":"PCMY","Status":"success","StartedAt":"2026-06-22T09:04:28.476Z","FinishedAt":"2026-06-22T16:04:24.317Z"},{"Id":19,"SyncType":"DIMENSION_VALUES","BrandCode":"KSI","Status":"success","StartedAt":"2026-06-22T09:04:27.590Z","FinishedAt":"2026-06-22T16:04:23.302Z"}]
unfinished sync runs: 0
```

This matches the corrected figures already noted in the task-2 brief
(`ErpAccounts` 4813, `ErpDimensionValue` 808, `ErpGeneralJournalBatch` 182;
the other two unchanged from the original 2026-08-21 snapshot). No sync ran
in the seconds between this read and migration 101 being applied next —
confirmed in Step 3, where the post-101 counts in `Rocks_ERP_Data` match these
exactly. `unfinished sync runs: 0`, so no sync was in flight — not a blocker.
These counts, not the brief's literal ones, are what the rest of this task was
measured against.

## Step 2 — apply 101 to `Rocks_ERP_Data`

Command as run:

```
npm run apply-sql -- --db Rocks_ERP_Data --file migrations/101_erp_data_sync_tables.sql
```

Output verbatim:

```
> form-portal@1.0.0 apply-sql
> tsx scripts/apply-sql.ts --db Rocks_ERP_Data --file migrations/101_erp_data_sync_tables.sql

Loaded 4 batch(es) from migrations/101_erp_data_sync_tables.sql

=== Rocks_ERP_Data ===
  batch 1/4 (6803 chars)
  batch 2/4 (2113 chars)
  batch 3/4 (6988 chars)
  batch 4/4 (2094 chars)
  applied 101_erp_data_sync_tables.sql to Rocks_ERP_Data OK

Done.
```

Exit code 0, all four batches ran. As with every migration applied through
`scripts/apply-sql.ts`, the batch's own `PRINT` lines (`'Batch 1: the five
tables exist in Rocks_ERP_Data.'`, etc.) are not surfaced — the tool runs each
batch with `pool.request().batch(...)` and attaches no `info` handler. Batch
completion without error, plus Step 3's direct read, is the signal.

## Step 3 — confirm the copy landed before dropping anything

Script run: `npx tsx --env-file=.env.local <scratch>/erp-confirm.ts` (reads
the five tables in `Rocks_ERP_Data` via `getAppPool("Rocks_ERP_Data")`).

```
ErpAccounts {"n":4813,"cur":4813}
ErpDimensionValue {"n":808,"cur":808}
ErpGeneralJournalBatch {"n":182,"cur":182}
ErpBankAccountCard {"n":64,"cur":64}
ErpSyncLog {"n":21,"cur":21}
```

Every `n` matches Step 1's snapshot exactly, and every `cur`
(`IDENT_CURRENT`) equals `n` — no gap between the highest copied id and the
identity's current value on any of the five tables. Safe to proceed to the
irreversible step.

## Step 4 — apply 102 to `Fast_Data`

Command as run:

```
npm run apply-sql -- --db Fast_Data --file migrations/102_fast_data_erp_synonyms.sql
```

Output verbatim:

```
> form-portal@1.0.0 apply-sql
> tsx scripts/apply-sql.ts --db Fast_Data --file migrations/102_fast_data_erp_synonyms.sql

Loaded 1 batch(es) from migrations/102_fast_data_erp_synonyms.sql

=== Fast_Data ===
  batch 1/1 (10029 chars)
  applied 102_fast_data_erp_synonyms.sql to Fast_Data OK

Done.
```

Exit code 0. **The guard did not refuse** — no sync landed in the window
between Step 2 and this step (consistent with Step 3's counts matching Step 1
exactly), so no re-run of 101 was needed. This ran on the first attempt.

## Step 5 — run the verification gate

Command as run: `npm run check:erp-data-home`

Output verbatim:

```
> form-portal@1.0.0 check:erp-data-home
> tsx scripts/checks/verify-erp-data-move.ts

OK: the five ERP sync tables live in Rocks_ERP_Data and Fast_Data reaches them by synonym
```

Passed on the first run — no fix to `scripts/checks/verify-erp-data-move.ts`
was needed (unlike the sibling `DepartmentErpMap` move, whose check script had
shipped with an unbracketed-`rowCount`-alias syntax error nobody had run
against a live database; this script's two prior review rounds evidently did
get executed). This confirms, for all five tables: each exists as a table in
`Rocks_ERP_Data`, holds more than zero rows, has `IDENT_CURRENT >= MAX(Id)`,
carries the expected index set (names, which are unique constraints vs plain
indexes, which is the primary key, and key column order including the `DESC`
on `IX_ErpSyncLog_BrandStarted`); that `Fast_Data` holds a synonym of the same
name pointing at the `Rocks_ERP_Data` copy; that a direct count and a count
read through the synonym agree in one round-trip; that a rolled-back `MERGE`
write through the `ErpSyncLog` synonym succeeds; and that
`Fast_Data.dbo.TravelProvince` — a table this move must not touch — is still
a table.

## Step 6 — confirm the previous move is undisturbed

Command as run: `npm run check:dept-map-home`

Output verbatim:

```
> form-portal@1.0.0 check:dept-map-home
> tsx scripts/checks/verify-department-erp-map-move.ts

OK: DepartmentErpMap lives in Rocks_Portal_Form and Fast_Core reaches it by synonym
```

Command as run: `npm run check:alignment`

Output verbatim:

```
> form-portal@1.0.0 check:alignment
> tsx scripts/checks/verify-master-alignment.ts

FAIL — configuration has drifted between Rocks_Portal_Form and Rocks_Portal_Form_UAT
  AccFormBrand: Rocks_Portal_Form has 23 row(s), Rocks_Portal_Form_UAT has 23
      Rocks_Portal_Form: {"BrandCode":"KSI","FormCode":"AP-11","Id":1014,"IsActive":false,"SortOrder":3}
      Rocks_Portal_Form_UAT: {"BrandCode":"KSI","FormCode":"AP-11","Id":1019,"IsActive":false,"SortOrder":3}

Every mutation should go through writeBothPools (src/lib/acc/dual-write.ts).
A direct SQL edit against one database alone is the usual cause.
```

This is exactly the pre-existing, already-documented drift (one `AccFormBrand`
row, `KSI`/`AP-11`, `Id` 1014 in production against 1019 in UAT — see
`CLAUDE.md`'s "Known pre-existing drift" section) and nothing else — no new
table appears, confirming the five ERP tables were not added to
`MASTER_TABLES` and this move did not touch `Rocks_Portal_Form` or its UAT
twin at all.

## Difference between what the brief predicted and what happened

- The brief's Step 1 "Expected" counts (`ErpAccounts` 4793, `ErpDimensionValue`
  806, `ErpGeneralJournalBatch` 174) were already known-stale per the task
  instructions before this task ran; the corrected figures given up front
  (4813 / 808 / 182) are exactly what Step 1 measured, so no further drift
  occurred between the brief being written and this task executing.
- The brief's Step 4 contingency — 102 refusing with `row counts differ` or
  `contents differ`, requiring a re-run of 101's `MERGE` — did not trigger.
  102 applied cleanly on the first attempt.
- No edit to `scripts/checks/verify-erp-data-move.ts` was needed; it ran clean
  on the first invocation, unlike the sibling `DepartmentErpMap` check script
  in the previous move, which had a syntax bug nobody had executed.
- No `BLOCKED` condition was encountered: no sync was in flight (Step 1), the
  post-101 counts were not short of the snapshot (Step 3), and 102 never
  reported `Rocks_ERP_Data` holding *more* rows than `Fast_Data`.

## Outcome

- `Rocks_ERP_Data`: now holds `ErpAccounts` (4813 rows), `ErpDimensionValue`
  (808 rows), `ErpGeneralJournalBatch` (182 rows), `ErpBankAccountCard` (64
  rows), `ErpSyncLog` (21 rows) as real tables, each with its `PK_*`, its
  `UQ_*` unique constraint (`UQ_ErpSyncLog` does not exist — that table has no
  natural-key unique constraint, matching `Fast_Data`'s original shape) and
  its lookup index, and identities at least at each table's copied maximum id.
- `Fast_Data`: the same five names are now synonyms pointing at
  `[Rocks_ERP_Data].[dbo].[<name>]`, permanently. `Fast_Data.dbo.TravelProvince`
  is untouched.
- `check:erp-data-home`: `OK`.
- `check:dept-map-home`: `OK`, unchanged by this task.
- `check:alignment`: red only with the pre-existing `AccFormBrand` (KSI/AP-11,
  1014 vs 1019) drift, unchanged by this task; no new table listed.
- No source file was edited to make any of this pass.
