# UatTester Move Implementation Plan

> **⚠️ SUPERSEDED THE SAME DAY — DO NOT FOLLOW ITS SQL.** The design this plan
> argues from was reversed before anything was applied: `UatTester` **stays in
> `Fast_Core`** and only `UatTesterPerDiem` moves. See
> [`docs/superpowers/specs/2026-09-07-uat-tester-move-design.md`](../specs/2026-09-07-uat-tester-move-design.md),
> §12, for what was wrong and how it was caught. **This file still contains
> complete SQL bodies for a `Fast_Core` synonym migration and a migration 141
> that must never be applied** — neither exists in `migrations/`, which is the
> only place migrations are run from. Kept as written, as implementation
> history, rather than rewritten.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `UatTester` and `UatTesterPerDiem` out of the shared `Fast_Core` database into `Rocks_Portal_Form_UAT`, leaving a permanent `Fast_Core` synonym for `UatTester` alone.

**Architecture:** Three migrations following this repo's established two-file move idiom (099/100, 101/102, 104/105), split into three because the two tables have different consumers and therefore different safe orderings. Ten lines of application change: `getCorePool` → `getUatFormPool` in the two modules that hold every statement naming either table. A source-reading guard test and a `check:` script pin the two hazards that fail silently.

**Tech Stack:** SQL Server (`mssql`/tedious), TypeScript, Next.js 16, `node:test` via `tsx --test`.

**Spec:** [`docs/superpowers/specs/2026-09-07-uat-tester-move-design.md`](../specs/2026-09-07-uat-tester-move-design.md)

## Global Constraints

- **No subagent runs a database command.** Not `npm run apply-sql`, not `npm run check:alignment`, not a probe, not a connection of any kind. Steps marked **[CONTROLLER RUNS THIS]** are executed by the controller or the user, never by an implementer. An implementer that finds itself wanting to run one must stop and report instead.
- **After the move both modules read `getUatFormPool()`** (`src/lib/db/mssql.ts:118-120`). **Never `getFormPool()`, never `getAccPool()`, never `getProductionFormPool()`, never `getCorePool()`.** `src/lib/acc/pool.ts:4` is `export const getAccPool = getFormPool`, so "the accounting pool" closes the resolver loop `getFormPool → resolveFormEnvironment → resolveCurrentFormAccess → viewerIsTesting → getActiveUatTester → getFormPool`. No type error predicts it.
- **A missing table throws.** Nothing degrades to "not a tester" and nothing degrades to "no override".
- **Reseed floors are `IDENT_CURRENT`, measured 2026-09-07 against the live `Fast_Core`: `UatTester` = 20, `UatTesterPerDiem` = 1.** Not `MAX(Id)`, not the row count — `UatTester`'s 15 rows are spread over ids 1..20.
- **Migration 139's database guard is INVERTED relative to 099 and 104.** Those refuse `DB_NAME() LIKE '%[_]UAT'` first and deliberately. 139 must *require* it, plus require `OBJECT_ID('dbo.AccRequest','U')` so a differently-named `_UAT` database cannot be hit by a mistyped `--db`.
- **The content check is a whole-row `EXCEPT`.** Neither table has an `nvarchar(MAX)` column, so nothing is reduced to a `DATALENGTH` the way 102 had to.
- **`UatTesterPerDiem` gets no synonym.** No application other than this one names it.
- **`npm run check:alignment` must stay at 27 tables** at every step.
- **Deployment order: 139 → 140 → deploy the code → 141.** See Task 4's note.
- SQL is parameterised in application code; migrations are literal DDL.
- **ES5 target:** `Array.from(...)`, never spread of a Set or Map.
- Dates are Thai wall clock — local getters, never `toISOString()`.

---

## File Structure

| File | Responsibility |
|---|---|
| `migrations/139_uat_form_uat_tester.sql` | **Create.** Create both tables in `Rocks_Portal_Form_UAT`, copy both from `Fast_Core` with ids preserved, reseed both identities. |
| `migrations/140_core_uat_tester_synonym.sql` | **Create.** `Fast_Core`: content-check and drop `UatTester`, create its synonym. |
| `migrations/141_core_uat_tester_per_diem_drop.sql` | **Create.** `Fast_Core`: content-check and drop `UatTesterPerDiem`. No synonym. |
| `src/lib/uat-tester/service.ts` | **Modify.** Six `getCorePool()` → `getUatFormPool()`; header rewritten. |
| `src/lib/uat-tester/per-diem.ts` | **Modify.** Four `getCorePool()` → `getUatFormPool()`; header rewritten. |
| `src/lib/acc/email-queue.ts` | **Modify.** Remove the swallowing `catch` around the tester lookup. |
| `src/lib/uat-tester/pool-guard.test.ts` | **Create.** Source-reading guard: the two modules name `getUatFormPool` and none of the four forbidden getters. |
| `scripts/checks/verify-uat-tester-move.ts` | **Create.** The env-drift verifier, in `verify-travel-province-move.ts`'s shape. |
| `package.json` | **Modify.** Register `check:uat-tester-home`. |
| `src/lib/form-environment/index.ts` | **Modify.** The resolver-invariant comment at `:76-86`. |
| `src/lib/acc/travel-booking/perdiem-source-guard.test.ts` | **Modify.** Add `getUatFormPool` to the client-bundle arm at `:165`. |
| `CLAUDE.md`, `migrations/063`, `migrations/138`, the 2026-09-07 AP-17 spec + plan | **Modify.** Documentation, Task 9. |

---

### Task 1: Migration 139 — create and copy into `Rocks_Portal_Form_UAT`

**Files:**
- Create: `migrations/139_uat_form_uat_tester.sql`

**Interfaces:**
- Consumes: `Fast_Core.dbo.UatTester` and `Fast_Core.dbo.UatTesterPerDiem`, read three-part.
- Produces: both tables in `Rocks_Portal_Form_UAT` with ids preserved and identities reseeded.

- [ ] **Step 1: Confirm 139 is free**

Run: `ls migrations/ | tail -5`
Expected: the highest number shown is `138_core_uat_tester_per_diem.sql`. If anything named `139_*`, `140_*` or `141_*` exists, stop and report — this plan's three numbers must all be free.

- [ ] **Step 2: Write the migration**

Create `migrations/139_uat_form_uat_tester.sql`:

```sql
-- UatTester and UatTesterPerDiem move into the UAT form database.
--
-- TARGET: Rocks_Portal_Form_UAT ONLY.
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/139_uat_form_uat_tester.sql
--
-- Design: docs/superpowers/specs/2026-09-07-uat-tester-move-design.md
--
-- ---------------------------------------------------------------------------
-- THE DATABASE GUARD IS INVERTED RELATIVE TO 099 AND 104, DELIBERATELY.
--
-- Those two refuse `DB_NAME() LIKE '%[_]UAT'` FIRST and on purpose -- the UAT
-- twin is the one database their table must never be created in. This one is
-- the opposite: the UAT twin is the ONLY database these two tables may live in.
-- Copying 099's ladder verbatim produces a migration that refuses the only
-- database it is meant to run against.
--
-- `dbo.AccRequest` must also exist, so a mistyped --db cannot land this on some
-- other database whose name happens to end in _UAT.
--
-- ---------------------------------------------------------------------------
-- RUN THIS BEFORE 140 AND 141. Both of those drop the Fast_Core originals and
-- refuse to do so unless the copy is already here -- but the refusal is a guard,
-- not a substitute for the order.
--
-- ---------------------------------------------------------------------------
-- THE RESEED FLOORS ARE IDENT_CURRENT, NOT MAX(Id) AND NOT THE ROW COUNT.
--
-- Measured 2026-09-07 against the live Fast_Core: UatTester holds 15 rows whose
-- ids are spread over 1..20, with IDENT_CURRENT = 20; UatTesterPerDiem holds 1
-- row with IDENT_CURRENT = 1. A floor taken from the row count would re-issue
-- ids 16..20, which have already been used.
--
-- ---------------------------------------------------------------------------
-- NO 900000 IDENTITY FLOOR APPLIES HERE.
--
-- Migrations 061 and 064 enumerate 23 transactional table names explicitly
-- (061:39-47, 064:61-69) and neither of these is among them, so ids 1..20 in
-- this database violate nothing. That is safe only because a UatTester.Id never
-- appears in a path the resolver parses -- ROUTE_RULES covers /api/request/*
-- prefixes only, and /api/settings/uat-users is not among them.

SET NOCOUNT ON;

IF DB_NAME() NOT LIKE '%[_]UAT' OR OBJECT_ID('dbo.AccRequest', 'U') IS NULL
BEGIN
  DECLARE @wrongDb NVARCHAR(128) = DB_NAME();
  RAISERROR (
    'Migration 139 may only be applied to the UAT form database: the name must end in _UAT and dbo.AccRequest must exist. Current database is %s.',
    16, 1, @wrongDb
  );
END
ELSE IF OBJECT_ID('dbo.UatTester') IS NOT NULL
     OR OBJECT_ID('dbo.UatTesterPerDiem') IS NOT NULL
BEGIN
  PRINT 'One or both tables already exist here -- batch 1 skipped.';
END
ELSE
BEGIN
  SET XACT_ABORT ON;
  BEGIN TRANSACTION;

  CREATE TABLE [dbo].[UatTester] (
    [Id]              INT IDENTITY(1,1) NOT NULL CONSTRAINT [PK_UatTester] PRIMARY KEY,
    [StaffId]         INT NOT NULL CONSTRAINT [UQ_UatTester_StaffId] UNIQUE,
    [Email]           NVARCHAR(200) NOT NULL,
    [ManagerStaffId]  INT NULL,
    [ManagerEmail]    NVARCHAR(200) NULL,
    [IsActive]        BIT NOT NULL CONSTRAINT [DF_UatTester_IsActive] DEFAULT (1),
    [UpdatedBy]       INT NULL,
    [UpdatedAt]       DATETIME2(7) NOT NULL CONSTRAINT [DF_UatTester_UpdatedAt] DEFAULT (SYSDATETIME())
  );

  CREATE INDEX [IX_UatTester_Email] ON [dbo].[UatTester] ([Email]);

  CREATE TABLE [dbo].[UatTesterPerDiem] (
    [Id]            INT IDENTITY(1,1) NOT NULL CONSTRAINT [PK_UatTesterPerDiem] PRIMARY KEY,
    [StaffId]       INT            NOT NULL,
    [EffectiveDate] DATE           NOT NULL,
    [Amount]        DECIMAL(18,2)  NOT NULL CONSTRAINT [CK_UatTesterPerDiem_Amount] CHECK ([Amount] > 0),
    [Note]          NVARCHAR(300)  NULL,
    [IsActive]      BIT            NOT NULL CONSTRAINT [DF_UatTesterPerDiem_IsActive] DEFAULT (1),
    [CreatedBy]     INT            NULL,
    [CreatedAt]     DATETIME2(7)   NOT NULL CONSTRAINT [DF_UatTesterPerDiem_CreatedAt] DEFAULT (SYSDATETIME()),
    [UpdatedBy]     INT            NULL,
    [UpdatedAt]     DATETIME2(7)   NOT NULL CONSTRAINT [DF_UatTesterPerDiem_UpdatedAt] DEFAULT (SYSDATETIME()),
    CONSTRAINT [UQ_UatTesterPerDiem_Staff_Date] UNIQUE ([StaffId], [EffectiveDate])
  );

  COMMIT TRANSACTION;
  PRINT 'Batch 1: dbo.UatTester and dbo.UatTesterPerDiem created in the UAT form database.';
END
GO

SET NOCOUNT ON;

IF DB_NAME() NOT LIKE '%[_]UAT' OR OBJECT_ID('dbo.AccRequest', 'U') IS NULL
BEGIN
  DECLARE @wrongDb2 NVARCHAR(128) = DB_NAME();
  RAISERROR ('Migration 139 batch 2 may only be applied to the UAT form database. Current database is %s.', 16, 1, @wrongDb2);
END
ELSE IF OBJECT_ID('dbo.UatTester', 'U') IS NULL OR OBJECT_ID('dbo.UatTesterPerDiem', 'U') IS NULL
BEGIN
  RAISERROR ('Migration 139 batch 2: one or both tables do not exist here as tables -- batch 1 did not run.', 16, 1);
END
ELSE IF OBJECT_ID('[Fast_Core].[dbo].[UatTester]', 'U') IS NULL
BEGIN
  RAISERROR (
    'Migration 139 batch 2: [Fast_Core].[dbo].[UatTester] is not a table. If migration 140 has already run it is a synonym pointing back here, and there is nothing to copy.',
    16, 1
  );
END
ELSE IF OBJECT_ID('[Fast_Core].[dbo].[UatTesterPerDiem]', 'U') IS NULL
BEGIN
  RAISERROR (
    'Migration 139 batch 2: [Fast_Core].[dbo].[UatTesterPerDiem] is not a table. If migration 141 has already run it has been dropped, and there is nothing to copy.',
    16, 1
  );
END
ELSE
BEGIN
  SET XACT_ABORT ON;
  BEGIN TRANSACTION;

  SET IDENTITY_INSERT [dbo].[UatTester] ON;

  MERGE INTO [dbo].[UatTester] AS t
  USING [Fast_Core].[dbo].[UatTester] AS s
    ON t.[Id] = s.[Id]
  WHEN MATCHED THEN
    UPDATE SET t.[StaffId] = s.[StaffId],
               t.[Email] = s.[Email],
               t.[ManagerStaffId] = s.[ManagerStaffId],
               t.[ManagerEmail] = s.[ManagerEmail],
               t.[IsActive] = s.[IsActive],
               t.[UpdatedBy] = s.[UpdatedBy],
               t.[UpdatedAt] = s.[UpdatedAt]
  WHEN NOT MATCHED BY TARGET THEN
    INSERT ([Id], [StaffId], [Email], [ManagerStaffId], [ManagerEmail], [IsActive], [UpdatedBy], [UpdatedAt])
    VALUES (s.[Id], s.[StaffId], s.[Email], s.[ManagerStaffId], s.[ManagerEmail], s.[IsActive], s.[UpdatedBy], s.[UpdatedAt]);

  SET IDENTITY_INSERT [dbo].[UatTester] OFF;

  SET IDENTITY_INSERT [dbo].[UatTesterPerDiem] ON;

  MERGE INTO [dbo].[UatTesterPerDiem] AS t
  USING [Fast_Core].[dbo].[UatTesterPerDiem] AS s
    ON t.[Id] = s.[Id]
  WHEN MATCHED THEN
    UPDATE SET t.[StaffId] = s.[StaffId],
               t.[EffectiveDate] = s.[EffectiveDate],
               t.[Amount] = s.[Amount],
               t.[Note] = s.[Note],
               t.[IsActive] = s.[IsActive],
               t.[CreatedBy] = s.[CreatedBy],
               t.[CreatedAt] = s.[CreatedAt],
               t.[UpdatedBy] = s.[UpdatedBy],
               t.[UpdatedAt] = s.[UpdatedAt]
  WHEN NOT MATCHED BY TARGET THEN
    INSERT ([Id], [StaffId], [EffectiveDate], [Amount], [Note], [IsActive], [CreatedBy], [CreatedAt], [UpdatedBy], [UpdatedAt])
    VALUES (s.[Id], s.[StaffId], s.[EffectiveDate], s.[Amount], s.[Note], s.[IsActive], s.[CreatedBy], s.[CreatedAt], s.[UpdatedBy], s.[UpdatedAt]);

  SET IDENTITY_INSERT [dbo].[UatTesterPerDiem] OFF;

  DECLARE @srcT INT = (SELECT COUNT(*) FROM [Fast_Core].[dbo].[UatTester]);
  DECLARE @dstT INT = (SELECT COUNT(*) FROM [dbo].[UatTester]);
  DECLARE @srcP INT = (SELECT COUNT(*) FROM [Fast_Core].[dbo].[UatTesterPerDiem]);
  DECLARE @dstP INT = (SELECT COUNT(*) FROM [dbo].[UatTesterPerDiem]);

  IF @srcT <> @dstT OR @srcP <> @dstP
  BEGIN
    ROLLBACK TRANSACTION;
    RAISERROR (
      'Migration 139: after the merge this database holds %d testers and %d rates; Fast_Core holds %d and %d. Rolled back.',
      16, 1, @dstT, @dstP, @srcT, @srcP
    );
  END
  ELSE
  BEGIN
    COMMIT TRANSACTION;
    PRINT 'Batch 2: rows reconciled from Fast_Core with their ids preserved.';
  END
END
GO

SET NOCOUNT ON;

-- Reseed outside a transaction: DBCC CHECKIDENT is not transactional.
--
-- A floor, not the mechanism: SET IDENTITY_INSERT already raises the identity to
-- the highest id inserted. What this guards is the narrower case of a table that
-- reached this database some other way, already holding rows, with an identity
-- lower than the ids it holds. 20 and 1 are the source IDENT_CURRENT values
-- measured 2026-09-07 -- for UatTester that is higher than MAX(Id) would suggest
-- from a row count, because 15 rows occupy ids 1..20.
--
-- Same predicate as batches 1 and 2, not a stricter one: a differently-named
-- database should skip this floor quietly rather than fail the whole run after
-- batches 1 and 2 have already done their job.
IF DB_NAME() LIKE '%[_]UAT'
   AND OBJECT_ID('dbo.AccRequest', 'U') IS NOT NULL
   AND OBJECT_ID('dbo.UatTester', 'U') IS NOT NULL
   AND IDENT_CURRENT('dbo.UatTester') < 20
BEGIN
  DBCC CHECKIDENT ('dbo.UatTester', RESEED, 20);
  PRINT 'Batch 3: UatTester identity floor applied.';
END
GO

SET NOCOUNT ON;

IF DB_NAME() LIKE '%[_]UAT'
   AND OBJECT_ID('dbo.AccRequest', 'U') IS NOT NULL
   AND OBJECT_ID('dbo.UatTesterPerDiem', 'U') IS NOT NULL
   AND IDENT_CURRENT('dbo.UatTesterPerDiem') < 1
BEGIN
  DBCC CHECKIDENT ('dbo.UatTesterPerDiem', RESEED, 1);
  PRINT 'Batch 4: UatTesterPerDiem identity floor applied.';
END
GO
```

- [ ] **Step 3: Verify by reading, not by running**

Quote these four lines from the file you wrote, in your report:
1. the inverted guard — it must *require* `LIKE '%[_]UAT'`, not refuse it;
2. the `AccRequest` existence test beside it;
3. `DBCC CHECKIDENT ('dbo.UatTester', RESEED, 20)` — the literal 20;
4. `SET IDENTITY_INSERT [dbo].[UatTester] OFF` — present, so the setting does not leak past the batch.

Then confirm the `EXCEPT`-relevant column lists match `migrations/063_core_uat_tester.sql:8-21` and `migrations/138_core_uat_tester_per_diem.sql:47-69` exactly, column for column.

- [ ] **Step 4: Commit**

```bash
git add migrations/139_uat_form_uat_tester.sql
git commit -m "feat(uat): create UatTester and UatTesterPerDiem in the UAT form database"
```

---

### Task 2: Migration 140 — drop `UatTester` from `Fast_Core`, leave the synonym

**Files:**
- Create: `migrations/140_core_uat_tester_synonym.sql`

**Interfaces:**
- Consumes: the copy migration 139 made.
- Produces: `Fast_Core.dbo.UatTester` as a synonym for `[Rocks_Portal_Form_UAT].[dbo].[UatTester]`.

- [ ] **Step 1: Write the migration**

Create `migrations/140_core_uat_tester_synonym.sql`:

```sql
-- Fast_Core.dbo.UatTester becomes a synonym for the UAT form database copy.
--
-- Apply with (Fast_Core ONLY, and ONLY AFTER migration 139):
--   npm run apply-sql -- --db Fast_Core --file migrations/140_core_uat_tester_synonym.sql
--
-- Design: docs/superpowers/specs/2026-09-07-uat-tester-move-design.md
--
-- ---------------------------------------------------------------------------
-- THIS DESTROYS THE ONLY COPY OF THE TESTER ROSTER IF 139 HAS NOT RUN.
-- Everything before the DROP is the guard: the target must exist as a table, the
-- row counts must match, and the contents must match -- all inside the
-- transaction that drops, with the source counted under TABLOCKX so nothing can
-- slip in between.
--
-- THE CONTENT CHECK COMPARES WHOLE ROWS. UatTester has no nvarchar(MAX) column,
-- so unlike migration 102 -- whose EXCEPT had to reduce each table's LOB to a
-- DATALENGTH -- all eight columns are in the projection with nothing left out.
--
-- ---------------------------------------------------------------------------
-- THE SYNONYM IS FOR ACC PORTAL, AND IT IS PERMANENT.
--
-- Measured 2026-09-07: ACC Portal reads this table in exactly one file,
-- ACC_Portal/src/lib/uat-tester/service.ts, as two read-only SELECTs naming it
-- two-part on a fixed pool over env.RF_CORE_DATABASE. It never writes it and
-- never names it three-part, so a synonym resolves both statements with no
-- change on its side. Rocks Fast names UatTester nowhere at all.
--
-- Synonyms do not carry permissions: the login ACC Portal uses must have SELECT
-- on Rocks_Portal_Form_UAT, not merely on Fast_Core.
--
-- ---------------------------------------------------------------------------
-- THIS IS THE FIRST SYNONYM IN THIS REPO POINTING INTO A UAT DATABASE. The seven
-- that exist (100, 102, 105) all point at production databases. It inherits the
-- env-drift hazard CLAUDE.md records for MSSQL_FORM_DATABASE and
-- MSSQL_ERP_DATA_DATABASE: this file hard-codes [Rocks_Portal_Form_UAT] while
-- the app resolves env.MSSQL_FORM_UAT_DATABASE, so repointing that var makes the
-- two applications read different rosters with no error anywhere.
-- `npm run check:uat-tester-home` is what catches it.
--
-- SET LOCK_TIMEOUT before the transaction for the reason migration 100 records:
-- the pool sets no requestTimeout, so node-mssql's 15 s default would otherwise
-- send an attention, and an attention cancels the statement WITHOUT rolling the
-- transaction back -- XACT_ABORT does not cover it.

SET NOCOUNT ON;

IF DB_NAME() <> N'Fast_Core'
BEGIN
  DECLARE @wrongDb NVARCHAR(128) = DB_NAME();
  RAISERROR ('Migration 140 may only be applied to Fast_Core. Current database is %s.', 16, 1, @wrongDb);
END
ELSE IF OBJECT_ID('dbo.UatTester', 'SN') IS NOT NULL
BEGIN
  PRINT 'dbo.UatTester is already a synonym -- migration 140 has already run.';
END
ELSE IF OBJECT_ID('dbo.UatTester', 'U') IS NULL
BEGIN
  RAISERROR ('Migration 140: dbo.UatTester is neither a table nor a synonym in Fast_Core. Refusing to guess.', 16, 1);
END
ELSE IF OBJECT_ID('[Rocks_Portal_Form_UAT].[dbo].[UatTester]', 'U') IS NULL
BEGIN
  RAISERROR (
    'Migration 140: [Rocks_Portal_Form_UAT].[dbo].[UatTester] does not exist as a table. Run migration 139 first. Refusing to drop the only copy of the tester roster.',
    16, 1
  );
END
ELSE
BEGIN
  SET LOCK_TIMEOUT 5000;
  SET XACT_ABORT ON;
  BEGIN TRANSACTION;

  DECLARE @problem NVARCHAR(400) = NULL;

  IF @problem IS NULL AND (SELECT COUNT(*) FROM [dbo].[UatTester] WITH (TABLOCKX))
                       <> (SELECT COUNT(*) FROM [Rocks_Portal_Form_UAT].[dbo].[UatTester])
    SET @problem = 'row counts differ';

  IF @problem IS NULL AND EXISTS (
    SELECT [Id], [StaffId], [Email], [ManagerStaffId], [ManagerEmail], [IsActive], [UpdatedBy], [UpdatedAt]
      FROM [dbo].[UatTester]
    EXCEPT
    SELECT [Id], [StaffId], [Email], [ManagerStaffId], [ManagerEmail], [IsActive], [UpdatedBy], [UpdatedAt]
      FROM [Rocks_Portal_Form_UAT].[dbo].[UatTester])
    SET @problem = 'contents differ';

  IF @problem IS NOT NULL
  BEGIN
    ROLLBACK TRANSACTION;
    RAISERROR (
      'Migration 140 refuses to drop: %s. Re-run 139 -- its batch 2 is a MERGE and reconciles both new and changed rows -- then retry this. If the target instead holds MORE rows than Fast_Core, re-running 139 cannot fix it and that path needs a person.',
      16, 1, @problem
    );
  END
  ELSE
  BEGIN
    DROP TABLE [dbo].[UatTester];

    CREATE SYNONYM [dbo].[UatTester]
      FOR [Rocks_Portal_Form_UAT].[dbo].[UatTester];

    COMMIT TRANSACTION;
    PRINT 'Fast_Core.dbo.UatTester is now a synonym for [Rocks_Portal_Form_UAT].[dbo].[UatTester].';
  END
END
GO
```

- [ ] **Step 2: Verify by reading**

Confirm in your report: the four early-exit branches are present and in this order (wrong database → already a synonym → not a table → destination missing); the `EXCEPT` projects **all eight** columns on both sides; `TABLOCKX` is on the `Fast_Core` side; and the `DROP TABLE` and `CREATE SYNONYM` are inside the same transaction.

- [ ] **Step 3: Commit**

```bash
git add migrations/140_core_uat_tester_synonym.sql
git commit -m "feat(uat): Fast_Core.UatTester becomes a synonym for the UAT form database"
```

---

### Task 3: Migration 141 — drop `UatTesterPerDiem` from `Fast_Core`

**Files:**
- Create: `migrations/141_core_uat_tester_per_diem_drop.sql`

**Interfaces:**
- Consumes: the copy migration 139 made.
- Produces: nothing. `Fast_Core.dbo.UatTesterPerDiem` ceases to exist, with no synonym.

- [ ] **Step 1: Write the migration**

Create `migrations/141_core_uat_tester_per_diem_drop.sql`:

```sql
-- Fast_Core.dbo.UatTesterPerDiem is dropped. NO synonym is left behind.
--
-- Apply with (Fast_Core ONLY, AFTER migration 139 AND AFTER the code that reads
-- the new home is deployed -- see the ordering note below):
--   npm run apply-sql -- --db Fast_Core --file migrations/141_core_uat_tester_per_diem_drop.sql
--
-- Design: docs/superpowers/specs/2026-09-07-uat-tester-move-design.md
--
-- ---------------------------------------------------------------------------
-- WHY NO SYNONYM, WHEN 140 LEAVES ONE.
--
-- 140's synonym exists for one named consumer: ACC Portal reads UatTester from
-- Fast_Core and would otherwise break. Measured 2026-09-07, NO application other
-- than Form Portal names UatTesterPerDiem anywhere -- not ACC Portal, not Rocks
-- Fast. A synonym with no consumer is a claim that somebody depends on it, and
-- the next person to consider removing it would have to disprove that first.
--
-- ---------------------------------------------------------------------------
-- RUN THIS AFTER THE CODE DEPLOY, NOT BEFORE. This is the one ordering
-- difference from 140, and it follows from the paragraph above.
--
-- A synonym is transparent: after 140, a build still calling getCorePool() for
-- UatTester resolves through it and keeps working, which is what lets 140 run
-- before the deploy with no window where Form Portal and ACC Portal disagree.
-- UatTesterPerDiem gets no synonym, so there is nothing to be transparent
-- through -- running this before the deploy would give the running build
-- `Invalid object name` on AP-17's pricing path in UAT.
--
-- THE CONTENT CHECK COMPARES WHOLE ROWS. No nvarchar(MAX) column, so all ten
-- columns are in the projection.

SET NOCOUNT ON;

IF DB_NAME() <> N'Fast_Core'
BEGIN
  DECLARE @wrongDb NVARCHAR(128) = DB_NAME();
  RAISERROR ('Migration 141 may only be applied to Fast_Core. Current database is %s.', 16, 1, @wrongDb);
END
ELSE IF OBJECT_ID('dbo.UatTesterPerDiem') IS NULL
BEGIN
  PRINT 'dbo.UatTesterPerDiem does not exist in Fast_Core -- migration 141 has already run.';
END
ELSE IF OBJECT_ID('dbo.UatTesterPerDiem', 'U') IS NULL
BEGIN
  RAISERROR ('Migration 141: dbo.UatTesterPerDiem exists but is not a table. Refusing to guess.', 16, 1);
END
ELSE IF OBJECT_ID('[Rocks_Portal_Form_UAT].[dbo].[UatTesterPerDiem]', 'U') IS NULL
BEGIN
  RAISERROR (
    'Migration 141: [Rocks_Portal_Form_UAT].[dbo].[UatTesterPerDiem] does not exist as a table. Run migration 139 first. Refusing to drop the only copy of the per-diem rates.',
    16, 1
  );
END
ELSE
BEGIN
  SET LOCK_TIMEOUT 5000;
  SET XACT_ABORT ON;
  BEGIN TRANSACTION;

  DECLARE @problem NVARCHAR(400) = NULL;

  IF @problem IS NULL AND (SELECT COUNT(*) FROM [dbo].[UatTesterPerDiem] WITH (TABLOCKX))
                       <> (SELECT COUNT(*) FROM [Rocks_Portal_Form_UAT].[dbo].[UatTesterPerDiem])
    SET @problem = 'row counts differ';

  IF @problem IS NULL AND EXISTS (
    SELECT [Id], [StaffId], [EffectiveDate], [Amount], [Note], [IsActive], [CreatedBy], [CreatedAt], [UpdatedBy], [UpdatedAt]
      FROM [dbo].[UatTesterPerDiem]
    EXCEPT
    SELECT [Id], [StaffId], [EffectiveDate], [Amount], [Note], [IsActive], [CreatedBy], [CreatedAt], [UpdatedBy], [UpdatedAt]
      FROM [Rocks_Portal_Form_UAT].[dbo].[UatTesterPerDiem])
    SET @problem = 'contents differ';

  IF @problem IS NOT NULL
  BEGIN
    ROLLBACK TRANSACTION;
    RAISERROR (
      'Migration 141 refuses to drop: %s. Re-run 139 -- its batch 2 is a MERGE and reconciles both new and changed rows -- then retry this.',
      16, 1, @problem
    );
  END
  ELSE
  BEGIN
    DROP TABLE [dbo].[UatTesterPerDiem];

    COMMIT TRANSACTION;
    PRINT 'Fast_Core.dbo.UatTesterPerDiem dropped. No synonym: nothing outside Form Portal names it.';
  END
END
GO
```

- [ ] **Step 2: Verify by reading**

Confirm the file contains **no** `CREATE SYNONYM`, and that its second branch treats "already gone" as a skip rather than an error.

- [ ] **Step 3: Commit**

```bash
git add migrations/141_core_uat_tester_per_diem_drop.sql
git commit -m "feat(uat): drop Fast_Core.UatTesterPerDiem, deliberately without a synonym"
```

---

### Task 4: Repoint both modules at `getUatFormPool()`

**Files:**
- Modify: `src/lib/uat-tester/service.ts:2, :53, :96, :235, :259, :370, :394`
- Modify: `src/lib/uat-tester/per-diem.ts:1, :14-31, :55, :81, :135, :161`

**Interfaces:**
- Consumes: `getUatFormPool` from `@/lib/db/mssql`.
- Produces: no signature change. Every exported function keeps its name and type.

**Ordering note for the controller, not a step:** this task's commit is what gets deployed *between* migrations 140 and 141.

- [ ] **Step 1: Repoint `service.ts`**

Change the import at `:2` from `getCorePool` to `getUatFormPool`:

```ts
import { getUatFormPool, sql } from "@/lib/db/mssql";
```

Then replace all six `const pool = await getCorePool();` with `const pool = await getUatFormPool();` — at `:53`, `:96`, `:235`, `:259`, `:370` and `:394`. Do not touch `getHrPool()` at `:151-163` and `:309-320`; those read `Rocks_Portal_HR` and are unrelated.

Add this above the file's first export:

```ts
/**
 * `UatTester` lives in `Rocks_Portal_Form_UAT` (migrations 139/140), not in
 * `Fast_Core` where migration 063 first created it. `Fast_Core` keeps a
 * permanent synonym because ACC Portal reads the table there.
 *
 * **`getUatFormPool()`, and never `getFormPool()` or `getAccPool()`.**
 * `getUatFormPool` is `getNamedPool(env.MSSQL_FORM_UAT_DATABASE)` — a literal
 * that consults no resolver. `getFormPool` asks the resolver which database
 * answers, and this table is one of the things the resolver reads to decide
 * that: `getFormPool → resolveFormEnvironment → resolveCurrentFormAccess →
 * viewerIsTesting → getActiveUatTester → getFormPool`. `src/lib/acc/pool.ts`
 * exports `getAccPool = getFormPool`, so reaching for "the accounting pool"
 * closes that loop, and no type error predicts it. `getProductionFormPool()`
 * is the other wrong answer and fails differently — it resolves
 * `Rocks_Portal_Form`, where the table does not exist.
 *
 * A missing table throws. It is not degraded to "not a tester": that would
 * silently drop a tester back to Production mid-session and route their UAT
 * work into the production database.
 */
```

- [ ] **Step 2: Repoint `per-diem.ts`**

Change the import at `:1` to `import { getUatFormPool, sql } from "@/lib/db/mssql";` and all four `await getCorePool()` at `:55`, `:81`, `:135`, `:161`.

Rewrite the header paragraph at `:14-20` — currently "**`getCorePool()`, and nothing else.** What a UAT tester is paid must not depend on which form database answered…" — to:

```ts
 * **`getUatFormPool()`, and nothing else.** This table lives in
 * `Rocks_Portal_Form_UAT` (migrations 139/141) and has no synonym anywhere:
 * nothing outside this application names it. `getUatFormPool` is a literal
 * (`getNamedPool(env.MSSQL_FORM_UAT_DATABASE)`) and consults no resolver, which
 * is what keeps it off the `getFormPool → … → getActiveUatTester → getFormPool`
 * loop. `getAccPool` IS `getFormPool`; reaching for it closes that loop.
```

Leave the rest of that docblock — the "one physical copy", "not dual-written", "a missing table throws" paragraphs — as they are. They remain true.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean. If `getCorePool` is reported as an unused import in either file, remove it from the import list.

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS. These modules have no unit tests of their own — they open pools — so a failure here means something unrelated broke.

- [ ] **Step 5: Commit**

```bash
git add src/lib/uat-tester/service.ts src/lib/uat-tester/per-diem.ts
git commit -m "refactor(uat): read the tester roster and its rates from the UAT form database"
```

---

### Task 5: The mail drain stops redirecting silently

**Files:**
- Modify: `src/lib/acc/email-queue.ts:138-155`

**Interfaces:**
- Consumes: `listActiveUatTesterAddresses` from `@/lib/uat-tester/service`, unchanged.
- Produces: nothing new.

- [ ] **Step 1: Read the existing rationale before changing it**

Read `src/lib/acc/email-queue.ts:128-155` in full and quote its comment in your report. It says the fallback "fails closed: nobody is exempt, so every UAT message is redirected, which is the safe direction." **That reasoning is sound as far as it goes** — with no way to tell who is a tester, redirecting everything is what guarantees no real person is mailed. Do not describe it as an oversight.

- [ ] **Step 2: Make the change**

Remove the `try`/`catch` so the error propagates, and replace the comment's last paragraph. The block becomes:

```ts
  // Its own read, deliberately: neither this nor the HR lookup is the database
  // being drained.
  //
  // It is NOT wrapped in a catch. Falling back to an empty list would fail
  // closed in one sense — nobody is exempt, so no real person is mailed — but
  // it does so invisibly: the tester who should have received the message does
  // not, their request sits at MANAGER, and the only trace is a log line.
  // Letting the error propagate leaves the rows QUEUED, which protects the same
  // person and is visible. That is also what `applyUatRedirect` already does
  // when neither UAT_MAIL_REDIRECT nor GRAPH_MAIL_FROM is set, so the two
  // halves of this function now agree.
  //
  // Since migration 139 this read is on Rocks_Portal_Form_UAT rather than
  // Fast_Core, which is what made the silent path newly reachable.
  let exemptTesters: UatMailExemptRecord[] = [];
  if (environment === "UAT" && rows.length > 0) {
    exemptTesters = await listActiveUatTesterAddresses();
  }
```

- [ ] **Step 3: Typecheck and run the suite**

Run: `npm run typecheck && npm test`
Expected: both clean. If a test asserted the swallowing behaviour, stop and report it rather than deleting the test — that would be a real disagreement between the plan and an existing contract.

- [ ] **Step 4: Commit**

```bash
git add src/lib/acc/email-queue.ts
git commit -m "fix(mail): a tester lookup failure leaves UAT mail queued, not silently redirected"
```

---

### Task 6: The pool guard test

**Files:**
- Create: `src/lib/uat-tester/pool-guard.test.ts`

**Interfaces:**
- Consumes: nothing (source-reading).
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Create `src/lib/uat-tester/pool-guard.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * `UatTester` and `UatTesterPerDiem` moved out of Fast_Core into
 * `Rocks_Portal_Form_UAT` (migrations 139/140/141), and the pool they are read
 * through is now load-bearing in a way it was not before.
 *
 * `getUatFormPool` is `getNamedPool(env.MSSQL_FORM_UAT_DATABASE)` — a literal
 * that consults no resolver. `getFormPool` asks the resolver which database
 * answers, and `getActiveUatTester` is one of the reads the resolver performs to
 * decide that, so using it closes the loop `getFormPool →
 * resolveFormEnvironment → resolveCurrentFormAccess → viewerIsTesting →
 * getActiveUatTester → getFormPool`. `src/lib/acc/pool.ts` exports
 * `getAccPool = getFormPool`, so the loop is one habitual reach away.
 *
 * Source-reading rather than behavioural: the failure is a swapped identifier
 * that typechecks, and the symptom is either infinite recursion or
 * `Invalid object name` at runtime — neither of which a unit test of these
 * functions would surface, because they open pools.
 */

const SRC = path.resolve(process.cwd(), "src");

/** Comments quoting the rule must not satisfy it, nor trip it. */
function code(file: string): string {
  return fs
    .readFileSync(path.resolve(SRC, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const MOVED_TABLE_MODULES = [
  "lib/uat-tester/service.ts",
  "lib/uat-tester/per-diem.ts",
];

const FORBIDDEN = ["getFormPool", "getAccPool", "getProductionFormPool", "getCorePool"];

test("the moved tables are read through getUatFormPool", () => {
  for (const file of MOVED_TABLE_MODULES) {
    const src = code(file);
    assert.ok(
      /\bgetUatFormPool\s*\(/.test(src),
      `${file} no longer calls getUatFormPool — UatTester and UatTesterPerDiem live in ` +
        "Rocks_Portal_Form_UAT and that literal pool is the only correct way to reach them",
    );
  }
});

test("no forbidden pool getter appears in the moved-table modules", () => {
  for (const file of MOVED_TABLE_MODULES) {
    const src = code(file);
    for (const bad of FORBIDDEN) {
      assert.ok(
        !new RegExp(`\\b${bad}\\b`).test(src),
        `${file} names ${bad}. getFormPool and getAccPool close the resolver loop ` +
          "getFormPool -> resolveFormEnvironment -> viewerIsTesting -> getActiveUatTester -> getFormPool; " +
          "getProductionFormPool and getCorePool resolve databases where these tables do not exist",
      );
    }
  }
});

test("getAccPool really is getFormPool, which is why it is forbidden above", () => {
  // If this ever stops being true the second test's reasoning changes, and the
  // reader deserves to find that out here rather than by tracing it.
  const src = code("lib/acc/pool.ts");
  assert.ok(
    /getAccPool\s*=\s*getFormPool/.test(src),
    "src/lib/acc/pool.ts no longer aliases getAccPool to getFormPool — re-check whether " +
      "getAccPool still closes the resolver loop before relaxing the guard above",
  );
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/lib/uat-tester/pool-guard.test.ts`
Expected: if Task 4 is already committed, all three PASS. **Run it against the pre-Task-4 code to see it fail**: `git stash` is not needed — instead confirm the test would have failed by checking that the failure message names `getCorePool`, and state in your report which of the two tests would have caught the old code (the second: `getCorePool` was present at seven sites).

- [ ] **Step 3: Run the whole suite**

Run: `npm test`
Expected: PASS, with the count risen by 3.

- [ ] **Step 4: Commit**

```bash
git add src/lib/uat-tester/pool-guard.test.ts
git commit -m "test(uat): pin the moved tables to getUatFormPool and off the resolver loop"
```

---

### Task 7: The env-drift check script

**Files:**
- Create: `scripts/checks/verify-uat-tester-move.ts`
- Modify: `package.json` (the scripts block, beside `check:travel-province-home`)

**Interfaces:**
- Consumes: `getUatFormPool` and `getCorePool` from `@/lib/db/mssql`, imported dynamically after the env is loaded.
- Produces: `npm run check:uat-tester-home`.

- [ ] **Step 1: Read the precedent**

Read `scripts/checks/verify-travel-province-move.ts` — in particular its `loadDotEnvLocal()` at `:61`, the dynamic import at `:111`, the synonym check at `:189-205` and the one-round-trip count comparison at `:210-225`. Your script is that shape with the databases swapped.

- [ ] **Step 2: Write the script**

Create `scripts/checks/verify-uat-tester-move.ts`:

```ts
/* eslint-disable no-console */
/**
 * Verify the UatTester move (docs/superpowers/specs/2026-09-07-uat-tester-move-design.md):
 *
 *   - UatTester and UatTesterPerDiem are TABLES in the database this app
 *     actually resolves through getUatFormPool() / MSSQL_FORM_UAT_DATABASE --
 *     not merely in some database called Rocks_Portal_Form_UAT
 *   - Fast_Core.dbo.UatTester is a SYNONYM whose base_object_name names that
 *     SAME database. Migration 140 hard-codes [Rocks_Portal_Form_UAT]; repointing
 *     the env var would make this app and ACC Portal read different rosters with
 *     no error anywhere, which is the hazard this check exists for
 *   - a count through the synonym and a direct count agree, taken in ONE
 *     round-trip -- two separate reads could only disagree because a write
 *     landed between them, which is flakiness, not a fault
 *   - Fast_Core does NOT hold UatTesterPerDiem, as an object of any kind. It
 *     deliberately gets no synonym, and a leftover table there would be a second
 *     copy that silently stops being written
 *
 * Read-only. Run: npm run check:uat-tester-home
 */
import fs from "node:fs";
import path from "node:path";

function loadDotEnvLocal() {
  const p = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const raw of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

async function main() {
  loadDotEnvLocal();
  const { getUatFormPool, getCorePool } = await import("@/lib/db/mssql");
  const { env } = await import("@/env");

  const uatDb = env.MSSQL_FORM_UAT_DATABASE;
  const uat = await getUatFormPool();
  const core = await getCorePool();
  const problems: string[] = [];

  // 1. both tables are real tables in the database the app itself opens
  const there = await uat.request().query<{ tester: number | null; rate: number | null }>(`
    SELECT OBJECT_ID('dbo.UatTester', 'U') AS [tester],
           OBJECT_ID('dbo.UatTesterPerDiem', 'U') AS [rate];`);
  if (there.recordset[0].tester === null) {
    problems.push(`UatTester: not a table in ${uatDb} (the database this app opens with getUatFormPool())`);
  }
  if (there.recordset[0].rate === null) {
    problems.push(`UatTesterPerDiem: not a table in ${uatDb}`);
  }

  // 2. Fast_Core's object is a synonym pointing at that SAME database
  const syn = await core.request().query<{ base: string }>(`
    SELECT base_object_name AS [base] FROM sys.synonyms WHERE name = 'UatTester';`);
  if (syn.recordset.length !== 1) {
    problems.push("UatTester: Fast_Core has no synonym of that name");
  } else {
    const base = String(syn.recordset[0].base);
    if (base.indexOf(`[${uatDb}].`) < 0 || base.indexOf("UatTester") < 0) {
      problems.push(
        `UatTester: synonym points at ${base}, but this app reads ${uatDb} (MSSQL_FORM_UAT_DATABASE) through getUatFormPool()`,
      );
    } else {
      // 3. one round-trip, from the Fast_Core connection
      const both = await core.request().query<{ viaSynonym: number; direct: number }>(`
        SELECT (SELECT COUNT(*) FROM [dbo].[UatTester]) AS [viaSynonym],
               (SELECT COUNT(*) FROM [${uatDb}].[dbo].[UatTester]) AS [direct];`);
      const row = both.recordset[0];
      if (row.viaSynonym !== row.direct) {
        problems.push(
          `UatTester: read through the synonym returned ${row.viaSynonym}, direct count is ${row.direct}`,
        );
      }
    }
  }

  // 4. Fast_Core must NOT hold UatTesterPerDiem in any form
  const leftover = await core.request().query<{ obj: number | null }>(`
    SELECT OBJECT_ID('dbo.UatTesterPerDiem') AS [obj];`);
  if (leftover.recordset[0].obj !== null) {
    problems.push(
      "UatTesterPerDiem: Fast_Core still holds an object of that name. It gets no synonym by design, and a leftover table is a second copy that silently stops being written — run migration 141.",
    );
  }

  if (problems.length > 0) {
    console.error("FAIL — the UatTester move is not in the expected state:");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(
    `PASS — UatTester and UatTesterPerDiem are tables in ${uatDb}, Fast_Core.dbo.UatTester is a synonym pointing there, and Fast_Core holds no UatTesterPerDiem.`,
  );
}

main().catch((err) => {
  console.error("check:uat-tester-home failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 3: Register it**

In `package.json`'s scripts block, add beside the other `check:` entries:

```json
    "check:uat-tester-home": "tsx scripts/checks/verify-uat-tester-move.ts",
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: clean.

**Do not run the script itself** — it opens two live databases. It is run by the controller after the migrations are applied.

- [ ] **Step 5: Commit**

```bash
git add scripts/checks/verify-uat-tester-move.ts package.json
git commit -m "test(uat): verify the tester roster's home and its Fast_Core synonym agree"
```

---

### Task 8: Update the client-bundle guard arm

**Files:**
- Modify: `src/lib/acc/travel-booking/perdiem-source-guard.test.ts:162-169`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Extend the arm**

That test asserts `useTravelBookingForm.ts` names none of `getPerDiemEmployeeLog|getCorePool|uatPerDiemLog`. `getCorePool` is now the wrong pool for these tables, so an author pulling the *new* getter into the client bundle would slip past it. Add `getUatFormPool` rather than replacing `getCorePool` — neither belongs in a client bundle, and `getCorePool` is still a server-only getter used elsewhere.

The pattern becomes:

```ts
    !/getPerDiemEmployeeLog|getCorePool|getUatFormPool|uatPerDiemLog/.test(src),
```

Update the assertion message's trailing clause from "never read Fast_Core itself" to "never open a database pool itself".

- [ ] **Step 2: Run the guard test**

Run: `npm test -- src/lib/acc/travel-booking/perdiem-source-guard.test.ts`
Expected: PASS, all arms.

- [ ] **Step 3: Commit**

```bash
git add src/lib/acc/travel-booking/perdiem-source-guard.test.ts
git commit -m "test(ap-17): the client-bundle guard covers the new pool getter too"
```

---

### Task 9: Documentation

**Files:**
- Modify: `src/lib/form-environment/index.ts:76-86`
- Modify: `migrations/063_core_uat_tester.sql` (header only)
- Modify: `migrations/138_core_uat_tester_per_diem.sql` (header only)
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-09-07-ap17-uat-per-diem-design.md`, `docs/superpowers/plans/2026-09-07-ap17-uat-per-diem.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: The resolver invariant**

`src/lib/form-environment/index.ts:76-86` currently reads, in part, "getActiveUatTester() → getCorePool()" and "So `FormEnvironment` and `UatTester` stay in Fast_Core". Both are now false. Rewrite that passage so it says:

- the invariant itself is unchanged — nothing on the resolution path may be reached through `getFormPool()`;
- `getFormSwitchMap() → getCorePool()` (unchanged);
- `getActiveUatTester() → getUatFormPool()` — a literal, which satisfies the invariant exactly as `getCorePool()` did;
- identity → `getProductionFormPool()` (unchanged);
- **`FormEnvironment` stays in Fast_Core** and why: it is read unconditionally on every classified-form request and holds `ProductionEnabled`, so moving it would make production availability depend on the UAT database.

- [ ] **Step 2: Superseded migration headers**

Add to the top of `migrations/063_core_uat_tester.sql`, above its existing text:

```sql
-- SUPERSEDED BY MIGRATIONS 139 AND 140 (2026-09-07). Do not re-run.
--
-- This file created UatTester in Fast_Core and its header below explains why it
-- lived there, including "it survives a rebuild of the UAT database". That
-- argument was weighed and rejected on a measured fact: Rocks_Portal_Form_UAT is
-- rebuilt essentially never. The table now lives in Rocks_Portal_Form_UAT and
-- Fast_Core keeps a permanent synonym for ACC Portal. See
-- docs/superpowers/specs/2026-09-07-uat-tester-move-design.md.
```

Add the equivalent to `migrations/138_core_uat_tester_per_diem.sql`, naming 139 and 141 and noting that the table gets **no** synonym.

- [ ] **Step 3: CLAUDE.md**

Three places:

1. The 3-database architecture table — `UatTester` and `UatTesterPerDiem` move out of the `Fast_Core` row and into a row naming `Rocks_Portal_Form_UAT` / `getUatFormPool()`, with the note that `Fast_Core` keeps a synonym for `UatTester` only.
2. The **Parallel Production and UAT** section, which currently says "**`FormEnvironment` and `UatTester` must stay in Fast_Core**". It becomes: `FormEnvironment` must stay in Fast_Core, for the availability reason; `UatTester` moved, and what must stay true is that it is read through a pool the resolver never picks — `getUatFormPool()`, never `getFormPool()`/`getAccPool()`.
3. The deployment checklist — a bullet for 139/140/141 stating the order **139 → 140 → deploy the code → 141** and why 141 is after: a synonym is transparent to the old build, and `UatTesterPerDiem` does not get one. Also add that `npm run check:uat-tester-home` exists and what it catches.

- [ ] **Step 4: Note the dated documents**

`docs/superpowers/specs/2026-09-07-ap17-uat-per-diem-design.md` and its plan describe `UatTesterPerDiem` as living in `Fast_Core`. They are dated design history and are **not** rewritten. Add one line near the top of each: superseded on the same day by the UatTester move, with the new spec's path.

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm test`
Expected: both clean; the test count unchanged from Task 8.

**Do not run `npm run check:alignment` or `check:uat-tester-home`** — both open live databases.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md src/lib/form-environment/index.ts migrations/063_core_uat_tester.sql migrations/138_core_uat_tester_per_diem.sql docs/superpowers/specs/2026-09-07-ap17-uat-per-diem-design.md docs/superpowers/plans/2026-09-07-ap17-uat-per-diem.md
git commit -m "docs(uat): the tester roster lives in the UAT form database now"
```

---

## Applying it — controller steps, not implementer steps

**[CONTROLLER RUNS THIS]** in this order, after all nine tasks are committed:

1. `npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/139_uat_form_uat_tester.sql`
2. **Probe the `MERGE`-through-synonym question** (spec §12 item 1) before step 3 commits to it. Create a throwaway synonym under a *different* name in `Fast_Core` pointing at the new `UatTester`, run a `MERGE … WITH (HOLDLOCK)` through it inside a transaction that is **rolled back**, drop the probe synonym. If it fails, the order becomes 139 → deploy → 140 → 141 and the divergence window in spec §7 is accepted.
3. `npm run apply-sql -- --db Fast_Core --file migrations/140_core_uat_tester_synonym.sql`
4. `npm run check:alignment` — must still read **27**.
5. Deploy the code.
6. `npm run apply-sql -- --db Fast_Core --file migrations/141_core_uat_tester_per_diem_drop.sql`
7. `npm run check:uat-tester-home` — must PASS.
8. Confirm ACC Portal still resolves a tester: its SQL login needs SELECT on `Rocks_Portal_Form_UAT` (spec §12 item 2).

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §1 decisions | all |
| §2 `FormEnvironment` stays | 9 (documented; no code change) |
| §3 pool rule and the cycle | 4, 6 |
| §4 storage, ids, reseed floors | 1 |
| §5 the synonym, `UatTester` only | 2, 3 |
| §6 migrations and the inverted guard | 1, 2, 3 |
| §7 deployment order | the controller steps above |
| §8 availability and the mail drain | 5 |
| §9 code changes | 4, 5 |
| §10 testing | 6, 7, 8 |
| §11 documentation | 9 |
| §12 verify-don't-assume | controller steps 2 and 8 |

**Type consistency checked:** no exported signature changes anywhere — Task 4 swaps a pool getter inside function bodies only. `MOVED_TABLE_MODULES` and `FORBIDDEN` (Task 6) are local to that test. `check:uat-tester-home` (Task 7) is the exact script name registered in `package.json` and named in Task 9's CLAUDE.md bullet and in controller step 7.

**Known ordering constraint:** Task 6's guard test passes only after Task 4. If executed out of order it fails on `getCorePool`, which is the test working.
