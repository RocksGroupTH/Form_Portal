# Moving `TravelProvince` into `Rocks_Portal_Form` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move AP-17's 77-row province table out of `Fast_Data` into `Rocks_Portal_Form`, leaving a synonym so Rocks Fast and ACC Portal keep reading the same rows unchanged.

**Architecture:** Two migrations — one creates the table and copies the rows, the other drops the original and replaces it with a `SYNONYM` in a single transaction. This app then names the new home through `getProductionFormPool()`. One physical copy: no UAT twin, no dual-write, no `MASTER_TABLES` entry.

**Tech Stack:** MSSQL (T-SQL migrations applied by `scripts/apply-sql.ts`), TypeScript on Node (`tsx`), `node:test` via `npm test`.

**Spec:** `docs/superpowers/specs/2026-08-21-travel-province-move-design.md`

## Global Constraints

- **ES5 target.** `Array.from()` and `indexOf`; never `[...set]` or `[...map.values()]`.
- **Parameterized SQL only.** Never `sql.connect()`.
- **One physical copy.** Never create this table in any `_UAT` database. Never add it to `src/lib/acc/dual-write.ts`. Never add it to `MASTER_TABLES` in `scripts/checks/verify-master-alignment.ts`.
- **Never `getFormPool()` for this table** — `getProductionFormPool()`, the rule migration 066 established for `TeamMember`.
- **Only `TravelProvince` moves.** `Fast_Data`'s `Intel_*` tables belong to Rocks Fast and its five `Erp*` synonyms were created by migrations 101/102 — leave every one of them alone.
- **Every migration names its target database in its header** and guards on `DB_NAME()`.
- Use scratch `.ts` files run with `npx tsx --env-file=.env.local <path>` for any probe. **Never `node -e` or `tsx -e`.**
- Do not start the dev server. Do not run `npm run build`.
- **Done means:** `npx tsc --noEmit` clean under `src/` and `scripts/` (delete `.next/types` first — it holds a stale artifact from an unrelated branch) and `npm test` at `pass 285, fail 0`.

## File Structure

| File | Responsibility |
|---|---|
| `migrations/104_portal_form_travel_province.sql` | Create the table in `Rocks_Portal_Form`, MERGE the rows in by id, reseed. Target: `Rocks_Portal_Form` only. |
| `migrations/105_fast_data_travel_province_synonym.sql` | Guard, then drop and create the synonym, atomically. Target: `Fast_Data` only. |
| `scripts/checks/verify-travel-province-move.ts` | Post-apply proof. |
| `scripts/checks/verify-erp-data-move.ts` | Its `TravelProvince`-is-still-a-table assertion becomes false and must be re-aimed. |
| `src/lib/acc/travel-booking/province-service.ts`, `request-service.ts` | One `getDataPool()` call each → `getProductionFormPool()`. |
| `src/lib/db/mssql.ts` | `getDataPool()`'s doc comment. |
| `CLAUDE.md`, `README.md` | The `Fast_Data` rows and the AP-17 section. |
| `docs/reviews/2026-08-21-travel-province-move-verification.md` | The captured verification output. |

## Measured starting state (2026-08-21)

`Fast_Data.dbo.TravelProvince`: **77 rows, ids 1..77 with no gaps, `IDENT_CURRENT` 77.** No foreign keys, no check constraints, no computed columns, no view/procedure/function references it, and **no `nvarchar(MAX)` column** — so unlike the ERP move, the content guard can compare whole rows. `Rocks_Portal_Form` does not have the table.

**Nothing writes it, in any of the three applications** — swept for `INSERT`/`UPDATE`/`DELETE`/`MERGE` across all three `src/` trees. Seeded by migration 049, read-only since.

---

### Task 1: Write the two migrations and the check script — apply nothing

**Files:**
- Create: `migrations/104_portal_form_travel_province.sql`
- Create: `migrations/105_fast_data_travel_province_synonym.sql`
- Create: `scripts/checks/verify-travel-province-move.ts`
- Modify: `package.json` (the `scripts` block, currently ending at `"check:erp-data-home"`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `npm run check:travel-province-home`. Exits 0 on success, 1 with printed reasons.

**Do not run `npm run apply-sql` in this task.** Task 2 applies these, after a reviewer has read 105's guard.

- [ ] **Step 1: Write migration 104**

The column definitions below came from the live catalog on 2026-08-21. Two deliberate departures, both of which the header must state rather than claim an exact reproduction: `UQ_TravelProvince_NameTh` is a unique **constraint** in the source and is recreated as one (`DROP INDEX` against a constraint raises Msg 3723 — the trap migration 097 hit), and the `IsActive` default is renamed from the auto-generated `DF__TravelPro__IsAct__2A164134` to `DF_TravelProvince_IsActive`.

```sql
-- AP-17's province table moves into the Accounting database.
--
-- Apply with (Rocks_Portal_Form ONLY -- NOT the UAT twin):
--   npm run apply-sql -- --db Rocks_Portal_Form --file migrations/104_portal_form_travel_province.sql
--
-- Then, and only then, apply 105 to Fast_Data. 105 drops the original.
--
-- ---------------------------------------------------------------------------
-- SINGLE COPY. Not created in Rocks_Portal_Form_UAT, not dual-written, not in
-- MASTER_TABLES. Two facts force that rather than merely suggesting it: a
-- synonym points at exactly one database, so the Rocks Fast and ACC Portal
-- siblings could never reach a UAT twin; and NOTHING WRITES THIS TABLE in any
-- of the three applications -- it is seeded by migration 049 and read-only
-- since -- so there is no write for dual-write to carry and nothing that could
-- drift. The list of Thai provinces does not differ by environment.
--
-- This is the third application of the pattern, after 099/100 (DepartmentErpMap
-- out of Fast_Core) and 101/102 (the five ERP sync tables out of Fast_Data).
-- With it, no code in this application reads Fast_Data at all.
--
-- TWO DELIBERATE DEPARTURES FROM THE SOURCE SHAPE:
--   1. UQ_TravelProvince_NameTh is a UNIQUE CONSTRAINT in Fast_Data, not a
--      plain unique index, and is recreated as a constraint. They are different
--      objects: DROP INDEX against a constraint raises Msg 3723.
--   2. The IsActive default is named DF_TravelProvince_IsActive here; the live
--      one is auto-generated (DF__TravelPro__IsAct__2A164134). Nothing
--      references a default constraint by name.
--
-- Batch 2 is an id-keyed MERGE, so a re-run reconciles rather than skipping.
-- ---------------------------------------------------------------------------

SET NOCOUNT ON;

IF DB_NAME() LIKE '%[_]UAT'
BEGIN
  DECLARE @uatDb NVARCHAR(128) = DB_NAME();
  RAISERROR (
    'Migration 104 must not be applied to the UAT form database. TravelProvince is deliberately a single copy. Current database is %s.',
    16, 1, @uatDb
  );
END
-- The UAT test comes FIRST and is separate on purpose: Rocks_Portal_Form_UAT
-- also matches the name test below, and it is the one database this table must
-- never be created in.
ELSE IF DB_NAME() NOT LIKE 'Rocks[_]Portal[_]Form%'
     OR OBJECT_ID('dbo.AccRequest', 'U') IS NULL
BEGIN
  DECLARE @notForm NVARCHAR(128) = DB_NAME();
  RAISERROR (
    'Migration 104 may only be applied to the production Form Portal database: the name must start with Rocks_Portal_Form and dbo.AccRequest must exist. Current database is %s.',
    16, 1, @notForm
  );
END
ELSE IF OBJECT_ID('dbo.TravelProvince') IS NOT NULL
BEGIN
  PRINT 'dbo.TravelProvince already exists here -- batch 1 skipped.';
END
ELSE
BEGIN
  SET XACT_ABORT ON;
  BEGIN TRANSACTION;

  CREATE TABLE [dbo].[TravelProvince] (
    [Id]       INT           IDENTITY(1,1) NOT NULL,
    [NameTh]   NVARCHAR(100) NOT NULL,
    [NameEn]   NVARCHAR(100) NULL,
    [IsActive] BIT           NOT NULL
      CONSTRAINT [DF_TravelProvince_IsActive] DEFAULT ((1)),
    CONSTRAINT [PK_TravelProvince] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [UQ_TravelProvince_NameTh] UNIQUE ([NameTh])
  );

  COMMIT TRANSACTION;
  PRINT 'Batch 1: dbo.TravelProvince created in the form database.';
END
GO

SET NOCOUNT ON;

IF DB_NAME() LIKE '%[_]UAT'
BEGIN
  DECLARE @uatDb2 NVARCHAR(128) = DB_NAME();
  RAISERROR ('Migration 104 must not be applied to the UAT form database. Current database is %s.', 16, 1, @uatDb2);
END
ELSE IF DB_NAME() NOT LIKE 'Rocks[_]Portal[_]Form%'
     OR OBJECT_ID('dbo.AccRequest', 'U') IS NULL
BEGIN
  DECLARE @notForm2 NVARCHAR(128) = DB_NAME();
  RAISERROR ('Migration 104 may only be applied to the production Form Portal database. Current database is %s.', 16, 1, @notForm2);
END
ELSE IF OBJECT_ID('dbo.TravelProvince', 'U') IS NULL
BEGIN
  RAISERROR ('Migration 104 batch 2: dbo.TravelProvince does not exist as a table -- batch 1 did not run.', 16, 1);
END
ELSE IF OBJECT_ID('[Fast_Data].[dbo].[TravelProvince]', 'U') IS NULL
BEGIN
  RAISERROR (
    'Migration 104 batch 2: [Fast_Data].[dbo].[TravelProvince] is not a table. If migration 105 has already run it is a synonym pointing back here, and there is nothing to copy.',
    16, 1
  );
END
ELSE
BEGIN
  SET XACT_ABORT ON;
  BEGIN TRANSACTION;

  SET IDENTITY_INSERT [dbo].[TravelProvince] ON;

  MERGE INTO [dbo].[TravelProvince] AS t
  USING [Fast_Data].[dbo].[TravelProvince] AS s
    ON t.[Id] = s.[Id]
  WHEN MATCHED THEN
    UPDATE SET t.[NameTh] = s.[NameTh],
               t.[NameEn] = s.[NameEn],
               t.[IsActive] = s.[IsActive]
  WHEN NOT MATCHED BY TARGET THEN
    INSERT ([Id], [NameTh], [NameEn], [IsActive])
    VALUES (s.[Id], s.[NameTh], s.[NameEn], s.[IsActive]);

  SET IDENTITY_INSERT [dbo].[TravelProvince] OFF;

  COMMIT TRANSACTION;
  PRINT 'Batch 2: rows reconciled from Fast_Data with their ids preserved.';
END
GO

SET NOCOUNT ON;

-- A floor, not the mechanism: SET IDENTITY_INSERT already raises the identity
-- to the highest id inserted, and IDENT_CURRENT equals MAX(Id) in the source
-- (77, measured 2026-08-21), so this is inert on every realistic path. It is
-- kept for the pathological case of an empty copy.
IF DB_NAME() <> N'Rocks_Portal_Form'
BEGIN
  DECLARE @notProd NVARCHAR(128) = DB_NAME();
  RAISERROR ('Migration 104 batch 3 may only be applied to Rocks_Portal_Form. Current database is %s.', 16, 1, @notProd);
END
ELSE IF OBJECT_ID('dbo.TravelProvince', 'U') IS NOT NULL
     AND IDENT_CURRENT('dbo.TravelProvince') < 77
BEGIN
  DBCC CHECKIDENT ('dbo.TravelProvince', RESEED, 77);
  PRINT 'Batch 3: identity floor applied.';
END
GO
```

- [ ] **Step 2: Write migration 105**

```sql
-- Fast_Data.dbo.TravelProvince becomes a synonym for the form database copy.
--
-- Apply with (Fast_Data ONLY, and ONLY AFTER migration 104):
--   npm run apply-sql -- --db Fast_Data --file migrations/105_fast_data_travel_province_synonym.sql
--
-- ---------------------------------------------------------------------------
-- THIS DESTROYS THE ONLY COPY OF 77 ROWS IF 104 HAS NOT RUN. Everything before
-- the DROP is the guard: the target must exist as a table, the row counts must
-- match, and the contents must match -- all inside the transaction that drops,
-- with the source counted under TABLOCKX so nothing can slip in between.
--
-- THE CONTENT CHECK COMPARES WHOLE ROWS, and here that is literally true.
-- TravelProvince has no nvarchar(MAX) column, so unlike migration 102 -- whose
-- EXCEPT had to reduce each table's LOB to a DATALENGTH -- every one of the four
-- columns is in the projection with nothing left out.
--
-- Nothing writes this table in any of the three applications, so the
-- mid-cutover drift that made 101/102's remedy load-bearing cannot occur here.
-- The guards are kept anyway; they cost nothing and a future stand-up inherits
-- them.
--
-- SET LOCK_TIMEOUT before the transaction for the reason migration 100 records:
-- the pool sets no requestTimeout, so node-mssql's 15 s default would otherwise
-- send an attention, and an attention cancels the statement WITHOUT rolling the
-- transaction back -- XACT_ABORT does not cover it. One TABLOCKX here, so 5000
-- is comfortably inside the budget.
--
-- Why a synonym rather than editing the siblings: all three applications name
-- the table two-part, [dbo].[TravelProvince], on a pool opened against
-- Fast_Data, and every one of their statements is a SELECT. A synonym resolves
-- all of them. Both databases are on the same instance, so any transaction that
-- now spans them stays local; MSDTC is involved only across instances.
--
-- The synonym is permanent, not a migration aid.
-- ---------------------------------------------------------------------------

SET NOCOUNT ON;

IF DB_NAME() <> N'Fast_Data'
BEGIN
  DECLARE @wrongDb NVARCHAR(128) = DB_NAME();
  RAISERROR ('Migration 105 may only be applied to Fast_Data. Current database is %s.', 16, 1, @wrongDb);
END
ELSE IF OBJECT_ID('dbo.TravelProvince', 'SN') IS NOT NULL
BEGIN
  PRINT 'dbo.TravelProvince is already a synonym -- migration 105 has already run.';
END
ELSE IF OBJECT_ID('dbo.TravelProvince', 'U') IS NULL
BEGIN
  RAISERROR ('Migration 105: dbo.TravelProvince is neither a table nor a synonym in Fast_Data. Refusing to guess.', 16, 1);
END
ELSE IF OBJECT_ID('[Rocks_Portal_Form].[dbo].[TravelProvince]', 'U') IS NULL
BEGIN
  RAISERROR (
    'Migration 105: [Rocks_Portal_Form].[dbo].[TravelProvince] does not exist as a table. Run migration 104 first. Refusing to drop the only copy of the data.',
    16, 1
  );
END
ELSE
BEGIN
  SET LOCK_TIMEOUT 5000;
  SET XACT_ABORT ON;
  BEGIN TRANSACTION;

  DECLARE @problem NVARCHAR(400) = NULL;

  IF @problem IS NULL AND (SELECT COUNT(*) FROM [dbo].[TravelProvince] WITH (TABLOCKX))
                       <> (SELECT COUNT(*) FROM [Rocks_Portal_Form].[dbo].[TravelProvince])
    SET @problem = 'row counts differ';

  IF @problem IS NULL AND EXISTS (
    SELECT [Id], [NameTh], [NameEn], [IsActive] FROM [dbo].[TravelProvince]
    EXCEPT
    SELECT [Id], [NameTh], [NameEn], [IsActive] FROM [Rocks_Portal_Form].[dbo].[TravelProvince])
    SET @problem = 'contents differ';

  IF @problem IS NOT NULL
  BEGIN
    ROLLBACK TRANSACTION;
    RAISERROR (
      'Migration 105 refuses to drop: %s. Re-run 104 -- its batch 2 is a MERGE and reconciles both new and changed rows -- then retry this. If the target instead holds MORE rows than Fast_Data, re-running 104 cannot fix it and that path needs a person.',
      16, 1, @problem
    );
  END
  ELSE
  BEGIN
    DROP TABLE [dbo].[TravelProvince];

    CREATE SYNONYM [dbo].[TravelProvince]
      FOR [Rocks_Portal_Form].[dbo].[TravelProvince];

    COMMIT TRANSACTION;
    PRINT 'Fast_Data.dbo.TravelProvince is now a synonym for [Rocks_Portal_Form].[dbo].[TravelProvince].';
  END
END
GO
```

- [ ] **Step 3: Write the check script**

Create `scripts/checks/verify-travel-province-move.ts`, following `scripts/checks/verify-erp-data-move.ts`'s conventions: `/* eslint-disable no-console */`, `loadDotEnvLocal()` copied verbatim from `verify-059.ts`, pools imported by **relative** path, **every column alias bracketed** (a sibling script shipped unrunnable because `AS rowCount` collides with the reserved `ROWCOUNT`), and no literal row count that a future edit would make stale.

It asserts the five things the spec's §7 lists:

1. the table exists in `Rocks_Portal_Form` with more than zero rows, `IDENT_CURRENT >= MAX([Id])`, and both index objects present under their original names — projecting `is_primary_key`, `is_unique_constraint` and key column order, so a `UQ_TravelProvince_NameTh` rebuilt as a plain index fails;
2. the `Fast_Data` object is in `sys.synonyms`, and its `base_object_name` names **the database `getProductionFormPool()` actually resolves** — read `DB_NAME()` from that pool rather than hard-coding `Rocks_Portal_Form`, so a repointed `MSSQL_FORM_DATABASE` reds instead of passing;
3. the direct count and the count through the synonym agree, **taken in one query** so a concurrent change cannot make a healthy system red;
4. `Rocks_Portal_Form_UAT` does **not** have the table;
5. `Fast_Data` still holds its `Intel_*` tables and the five `Erp*` synonyms.

Include a comment saying **why there is no write probe**: nothing writes this table in any of the three applications, so proving a cross-database write permission would assert something no caller needs — its absence is a decision, not an oversight.

- [ ] **Step 4: Add the npm script**

`package.json`'s `scripts` block currently ends:

```json
    "check:erp-data-home": "tsx scripts/checks/verify-erp-data-move.ts"
```

Make it:

```json
    "check:erp-data-home": "tsx scripts/checks/verify-erp-data-move.ts",
    "check:travel-province-home": "tsx scripts/checks/verify-travel-province-move.ts"
```

- [ ] **Step 5: Verify and commit**

Run: `npx tsc --noEmit` (delete `.next/types` first) — clean under `src/` and `scripts/`.
Run: `npm test` — `pass 285, fail 0`. This task adds no unit test; the migrations are SQL and the check script talks to live databases, and Task 2 runs it.

```bash
git add migrations/104_portal_form_travel_province.sql migrations/105_fast_data_travel_province_synonym.sql scripts/checks/verify-travel-province-move.ts package.json
git commit -m "feat(db): migrations to move TravelProvince into the form database"
```

---

### Task 2: Apply the migrations and capture the proof

**Files:**
- Modify: `scripts/checks/verify-erp-data-move.ts`
- Create: `docs/reviews/2026-08-21-travel-province-move-verification.md`

**Interfaces:**
- Consumes: `migrations/104_…sql`, `migrations/105_…sql`, `npm run check:travel-province-home`.
- Produces: the move itself. Task 3's code change depends on the table existing in `Rocks_Portal_Form`.

**This is the irreversible task.**

- [ ] **Step 1: Snapshot the source**

Write `<scratch>/tp-snapshot.ts`:

```ts
import fs from "node:fs";
import { getDataPool } from "@/lib/db/mssql";

async function main() {
  const pool = await getDataPool();
  const r = await pool.request().query(
    `SELECT [Id], [NameTh], [NameEn], [IsActive] FROM [dbo].[TravelProvince] ORDER BY [Id];`
  );
  fs.writeFileSync("<scratch>/tp-snapshot.json", JSON.stringify(r.recordset, null, 2));
  console.log("rows:", r.recordset.length);
  process.exit(0);
}
main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
```

Run: `npx tsx --env-file=.env.local <scratch>/tp-snapshot.ts` — expect `rows: 77`, written to your scratch directory, **not the repo**. If it is not 77, record the number and use it; the migrations tolerate it, and the check script carries no literal.

- [ ] **Step 2: Apply 104 to `Rocks_Portal_Form`**

Run: `npm run apply-sql -- --db Rocks_Portal_Form --file migrations/104_portal_form_travel_province.sql`

- [ ] **Step 3: Confirm the copy before dropping anything**

Write `<scratch>/tp-confirm.ts` reading `COUNT(*)`, `MAX([Id])` and `IDENT_CURRENT('dbo.TravelProvince')` from `getProductionFormPool()`. Expect the count to equal Step 1's. **If it is short, stop.**

- [ ] **Step 4: Apply 105 to `Fast_Data`**

Run: `npm run apply-sql -- --db Fast_Data --file migrations/105_fast_data_travel_province_synonym.sql`

If it refuses, read the reason. `contents differ` or a short target means re-run Step 2 and retry. A target holding **more** rows than the source is not something re-running 104 fixes — **stop and report BLOCKED**.

- [ ] **Step 5: Re-aim the ERP check script's assertion**

`scripts/checks/verify-erp-data-move.ts` asserts `Fast_Data.dbo.TravelProvince` is still a real table, as its evidence that the ERP move touched nothing outside its five. That is now false by design. Change it to assert `Fast_Data` still has the table **reachable** — as a synonym after this migration — and update the comment to say the ERP move's blast radius is now proven by the `Intel_*` tables plus this synonym rather than by a base table. Do not weaken it to "exists in any form"; name what it should be.

> **Correction (2026-08-22, final whole-branch review).** "The `Intel_*` tables" were not in `verify-erp-data-move.ts` to be cited — that file had no `sys.tables` query at all, and `Intel` appeared nowhere in it. The count lives in `verify-travel-province-move.ts` (part 5). Following this step as written therefore produced a header comment that justified the gate by evidence the gate did not gather, and the sentence propagated into `docs/reviews/2026-08-21-travel-province-move-verification.md`. Closed on 2026-08-22 by copying the `Intel[_]%` / `IntelMkt%` count assertion into `verify-erp-data-move.ts` as part 5a, making the claim true rather than rewording it. Left in place because plans are dated history; the script itself and its header are the current statement.

- [ ] **Step 6: Run every gate**

- `npm run check:travel-province-home` → `OK`
- `npm run check:erp-data-home` → `OK` (it will fail before Step 5; that is expected and is why Step 5 is in this task)
- `npm run check:dept-map-home` → `OK`
- `npm run check:alignment` → **`PASS`**. It went green on 2026-08-21 after migration 103; a failure here is a fresh break and must be reported, not accepted as pre-existing.
- `npx tsc --noEmit` clean, `npm test` `pass 285, fail 0`

- [ ] **Step 7: Write the record and commit**

Create `docs/reviews/2026-08-21-travel-province-move-verification.md` with every command as run and its verbatim output, the before and after counts, and whether any guard refused. Open with a paragraph saying what moved, that the synonym is permanent, and that the content guard genuinely compared whole rows here.

```bash
git add scripts/checks/verify-erp-data-move.ts docs/reviews/2026-08-21-travel-province-move-verification.md
git commit -m "docs: record the TravelProvince move against the live databases"
```

---

### Task 3: Point the application at the new home

**Files:**
- Modify: `src/lib/acc/travel-booking/province-service.ts`, `src/lib/acc/travel-booking/request-service.ts`
- Modify: `src/lib/db/mssql.ts`

**Interfaces:**
- Consumes: the table in `Rocks_Portal_Form`, created by Task 2.
- Produces: no new exports. Every function keeps its name and signature.

- [ ] **Step 1: Switch the two call sites**

Each file has exactly one `getDataPool()` call and each serves statements against `[dbo].[TravelProvince]` only. Both become `getProductionFormPool()`; update the imports. **Find them by the table their SQL names, not by line number**, and if either file turns out to read something else from `Fast_Data` too, **stop and report BLOCKED** — that would be a cross-database join this move has broken.

Add above each converted call:

```ts
// TravelProvince moved to Rocks_Portal_Form in migrations 104/105; Fast_Data
// keeps a synonym for the Rocks Fast and ACC Portal siblings. This app names
// the new home directly. getProductionFormPool() and never getFormPool():
// there is one physical copy, so the environment-varying pool has nothing to
// choose between.
```

- [ ] **Step 2: Correct `getDataPool()`'s doc comment**

It currently names `TravelProvince` as what `Fast_Data` still holds for this app. After Task 2 that is false, and **no code in `src/` reads `Fast_Data` at all**. Say that, and say that the accessor stays because the ERP move's check script reads through `Fast_Data`'s synonyms. Verify the "no caller in `src/`" claim by grepping before you write it.

- [ ] **Step 3: Verify**

`npx tsc --noEmit` clean; `npm test` `pass 285, fail 0`; `check:travel-province-home`, `check:erp-data-home` and `check:dept-map-home` all `OK`.

- [ ] **Step 4: Prove the service reads the new home**

The unit suite touches no database. Write `<scratch>/tp-probe.ts` calling the province-listing function `province-service.ts` exports — **read its real signature first** — and print how many provinces come back. Expect the Step 1 count. If it throws `Invalid object name`, the switch is wrong or Task 2 did not complete.

- [ ] **Step 5: Commit**

```bash
git add src/lib/acc/travel-booking/province-service.ts src/lib/acc/travel-booking/request-service.ts src/lib/db/mssql.ts
git commit -m "refactor(acc): read TravelProvince from the form database"
```

---

### Task 4: Update the documentation

**Files:** `CLAUDE.md`, `README.md`

**Interfaces:** Documentation only — **no executable line changes.**

- [ ] **Step 1: `CLAUDE.md`**

Four things, each verified against the code before writing:

1. The architecture table's `Fast_Data` row says the database holds `TravelProvince` for this app. It no longer holds anything this app reads. Say what is true — including that `Fast_Data` still physically holds Rocks Fast's `Intel_*` tables and the five `Erp*` synonyms — and that `getDataPool()` has no caller in `src/`.
2. The `Rocks_Portal_Form` row gains `TravelProvince`.
3. AP-17's feature section says it uses "`Fast_Data` for province lookups (`province-service.ts`)". Correct it.
4. Add the move to the same place migrations 099/100 and 101/102 are recorded, including that this one completes the set: **no code in this app reads `Fast_Data` any more.**

- [ ] **Step 2: `README.md`**

Its database table has a `Fast_Data` row and a `Rocks_ERP_Data` row. Correct the `Fast_Data` row and add `TravelProvince` to the `Rocks_Portal_Form` row. Check every row against what the code opens today rather than only patching the one line, but **do not restructure the table**.

- [ ] **Step 3: Verify and commit**

`git diff --stat` — expected: `CLAUDE.md` and `README.md` only.
`npx tsc --noEmit` clean; `npm test` `pass 285, fail 0`.

```bash
git add CLAUDE.md README.md
git commit -m "docs: TravelProvince's new home, and the end of Fast_Data in this app"
```

---

## Self-review

**Spec coverage.** §1 (why, and what it finishes) — Task 3 Step 2 and Task 4 Step 1.4. §2 (measured state) — the plan's own block, consumed by Tasks 1 and 2. §3 (shape, single copy, the two departures) — Task 1 Step 1 and the Global Constraints. §4 (who reads it) — Task 3 Steps 1-2. §5 (cutover, whole-row guard) — Task 1 Steps 1-2, Task 2 Steps 2-4. §6 (what else changes) — Task 2 Step 5, Task 3 Step 2, Task 4. §7 (verification, all five assertions plus the no-write-probe rationale) — Task 1 Step 3, Task 2 Step 6. §8 (out of scope) — Task 3 Step 2 says explicitly that `getDataPool()` stays.

**Placeholder scan.** No TBD/TODO. Both migrations are written out in full. Task 1 Step 3 and Task 2 Steps 1/3 describe the scripts by their assertions rather than pasting them, because each is a variation on `verify-erp-data-move.ts` that the implementer must read anyway — the assertions, the bracketing rule and the no-literal-counts rule are all stated.

**Type consistency.** `getProductionFormPool()` is exported at `src/lib/db/mssql.ts:94`. The npm script `check:travel-province-home` is spelled identically in Task 1 Step 4, Task 2 Step 6 and Task 3 Step 3. Migration numbers 104 and 105 are used consistently, and follow 103, which is the highest on `master`.

**One thing deliberately left to the implementer.** Task 2 Step 1 allows the row count to have moved from 77 and says what to do; the check script carries no literal, so nothing needs updating if it has.
