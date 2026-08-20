# Moving `DepartmentErpMap` into `Rocks_Portal_Form` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the physical `DepartmentErpMap` table out of `Fast_Core` and into `Rocks_Portal_Form`, leaving a synonym behind so the two sibling applications keep reaching the same rows unchanged.

**Architecture:** Two migrations — one creates the table and copies the rows into the Accounting database, the other drops the original and replaces it with a `SYNONYM`. This application's own code then names the new home directly through `getProductionFormPool()`. There is exactly one physical copy: no UAT twin, no dual-write, no `MASTER_TABLES` entry.

**Tech Stack:** MSSQL (T-SQL migrations applied by `scripts/apply-sql.ts`), TypeScript on Node (`tsx`), `node:test` via `npm test`.

**Spec:** `docs/superpowers/specs/2026-08-20-department-erp-map-move-design.md`

## Global Constraints

- **ES5 target.** Use `Array.from()` and `indexOf`; never `[...set]` or `[...map.values()]`.
- **Parameterized SQL only** — `pool.request().input("name", sql.NVarChar, value).query(...)`. Never `sql.connect()` (global singleton).
- **One physical copy.** Never create this table in `Rocks_Portal_Form_UAT`. Never add it to `src/lib/acc/dual-write.ts`. Never add it to `MASTER_TABLES` in `scripts/checks/verify-master-alignment.ts`.
- **Never `getFormPool()` for this table.** That pool's answer varies with the viewer's environment; there is only one copy to reach. Use `getProductionFormPool()`, the rule migration 066 established for `TeamMember`.
- **`settings/departments/map` stays `requireRole` (admin-only).** Do not tab-gate it, now or as a "tidy-up". The rows are still shared with two sibling applications.
- **Every migration names its target database in its header** and guards on `DB_NAME()`.
- **Do not start the dev server.** Do not run `npm run build`.
- **Done means:** `npx tsc --noEmit` clean under `src/` (stale `.next/types` errors are pre-existing and not yours) and `npm test` green at **285**.

## File Structure

| File | Responsibility |
|---|---|
| `migrations/099_portal_form_department_erp_map.sql` | Create the table in `Rocks_Portal_Form`, copy the three rows, reseed the identity. Target: `Rocks_Portal_Form` **only**. |
| `migrations/100_core_department_erp_map_synonym.sql` | Drop the `Fast_Core` table and create the synonym, atomically. Target: `Fast_Core` only. |
| `scripts/checks/verify-department-erp-map-move.ts` | Post-apply proof: the table, the synonym, a read through it and a rolled-back write through it. |
| `src/lib/acc/department-map-service.ts` | Six `getCorePool()` call sites become `getProductionFormPool()`. |
| `scripts/checks/verify-045.ts`, `verify-046.ts` | Repointed at the new home; `COL_LENGTH` does not resolve synonyms. |
| `src/lib/acc/department-map-guard.ts`, `src/lib/acc/settings-tabs.ts`, `src/app/api/request/accounting/settings/departments/map/route.ts` | Comments that name the old home. |
| `CLAUDE.md` | Four places name the old home. |
| `docs/reviews/2026-08-20-department-erp-map-move-verification.md` | The captured verification output, as the record that the move actually happened. |

## Measured starting state — do not re-derive, but do re-confirm before destroying anything

`Fast_Core.dbo.DepartmentErpMap` as at 2026-08-20:

- **3 rows**, ids **1004, 1005, 1006**, all `BrandCode = 'PCTH'`, all `FormCode NULL`
- `Id` is `INT IDENTITY(1,1)`, `IDENT_CURRENT` = **2004**
- `PK_DepartmentErpMap` CLUSTERED on `Id`
- `UQ_DepartmentErpMap_Dept` — a plain **unique index** (not a constraint; migration 098 converted it) on `(FormCode, BrandCode, DepartmentCode)`
- `IX_DepartmentErpMap_Brand` on `(BrandCode)`
- One default constraint on `MappedAt` = `sysdatetime()`
- **No inbound foreign keys, no check constraints**
- `saai` is `db_owner` in both `Fast_Core` and `Rocks_Portal_Form`

---

### Task 1: Write the two migrations and the verification script — apply nothing

**Files:**
- Create: `migrations/099_portal_form_department_erp_map.sql`
- Create: `migrations/100_core_department_erp_map_synonym.sql`
- Create: `scripts/checks/verify-department-erp-map-move.ts`
- Modify: `package.json` (the `scripts` block, currently ending at `"check:alignment"`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `npm run check:dept-map-home` — the verification entry point Task 2 runs. Exits 0 on success, 1 with a printed reason on failure.

**Nothing in this task touches a database except the read-only probe in Step 1.** Do not run `apply-sql`. Task 2 applies these files, after a reviewer has looked at the guard in 100 — that guard is what stands between this work and deleting the only copy of the data.

- [ ] **Step 1: Prove that DROP TABLE and CREATE SYNONYM can share one transaction**

Migration 100 drops the table and creates the synonym in the same transaction so no window exists in which the name resolves to nothing. Prove the pattern on a throwaway name first, and roll it back.

Write `scratch-synonym-probe.ts` in your scratch directory:

```ts
import { getCorePool } from "@/lib/db/mssql";

async function main() {
  const pool = await getCorePool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    await tx.request().query(`CREATE TABLE [dbo].[ZzProbeDeptMap] ([Id] INT NOT NULL);`);
    await tx.request().query(`DROP TABLE [dbo].[ZzProbeDeptMap];`);
    await tx.request().query(
      `CREATE SYNONYM [dbo].[ZzProbeDeptMap] FOR [Rocks_Portal_Form].[dbo].[AccRequest];`
    );
    const r = await tx.request().query(
      `SELECT COUNT(*) AS n FROM sys.synonyms WHERE name = 'ZzProbeDeptMap';`
    );
    console.log("synonym visible inside the transaction:", r.recordset[0].n === 1);
  } finally {
    await tx.rollback();
  }
  const after = await pool.request().query(
    `SELECT OBJECT_ID('dbo.ZzProbeDeptMap') AS oid;`
  );
  console.log("cleaned up after rollback:", after.recordset[0].oid === null);
  process.exit(0);
}
main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
```

Run: `npx tsx --env-file=.env.local <scratch>/scratch-synonym-probe.ts`

Expected: both lines print `true`. If either prints `false`, or the script throws, **stop and report BLOCKED** — migration 100 must then be written as two batches with the window documented, which is a design change and not yours to make silently.

- [ ] **Step 2: Write migration 099**

Create `migrations/099_portal_form_department_erp_map.sql`:

```sql
-- DepartmentErpMap moves into the Accounting database.
--
-- Apply with (Rocks_Portal_Form ONLY -- NOT the UAT twin):
--   npm run apply-sql -- --db Rocks_Portal_Form --file migrations/099_portal_form_department_erp_map.sql
--
-- Then, and only then, apply 100 to Fast_Core. 100 drops the original.
--
-- ---------------------------------------------------------------------------
-- This table is deliberately a SINGLE copy. It is not created in
-- Rocks_Portal_Form_UAT, it is not dual-written, and it is not in
-- MASTER_TABLES. A second copy could not be kept aligned: the Fast_Core
-- synonym that Rocks Fast and ACC Portal write through points at production
-- alone, so a sibling's write would reach production and never UAT, and
-- npm run check:alignment would go red every time either of them edited a
-- department mapping with nothing actually wrong. See
-- docs/superpowers/specs/2026-08-20-department-erp-map-move-design.md, section 3.
--
-- The shape below reproduces Fast_Core's exactly as measured 2026-08-20,
-- including that UQ_DepartmentErpMap_Dept is a plain unique INDEX and not a
-- unique constraint -- migration 098 converted it, and CREATE UNIQUE INDEX is
-- what reproduces what is actually there.
-- ---------------------------------------------------------------------------

SET NOCOUNT ON;

IF DB_NAME() LIKE '%[_]UAT'
BEGIN
  DECLARE @uatDb NVARCHAR(128) = DB_NAME();
  RAISERROR (
    'Migration 099 must not be applied to the UAT form database. DepartmentErpMap is deliberately a single copy. Current database is %s.',
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
    'Migration 099 may only be applied to the production Form Portal database: the name must start with Rocks_Portal_Form and dbo.AccRequest must exist. Current database is %s.',
    16, 1, @notForm
  );
END
ELSE IF OBJECT_ID('dbo.DepartmentErpMap') IS NOT NULL
BEGIN
  PRINT 'dbo.DepartmentErpMap already exists here -- batch 1 skipped.';
END
ELSE
BEGIN
  SET XACT_ABORT ON;
  BEGIN TRANSACTION;

  CREATE TABLE [dbo].[DepartmentErpMap] (
    [Id]                 INT           IDENTITY(1,1) NOT NULL,
    [BrandCode]          NVARCHAR(20)  NOT NULL,
    [DepartmentCode]     NVARCHAR(50)  NOT NULL,
    [HrDepartmentName]   NVARCHAR(200) NULL,
    [ErpDimensionCode]   NVARCHAR(50)  NOT NULL,
    [ErpCode]            NVARCHAR(50)  NOT NULL,
    [MappedBy]           INT           NULL,
    [MappedAt]           DATETIME2(7)  NOT NULL
      CONSTRAINT [DF_DepartmentErpMap_MappedAt] DEFAULT (sysdatetime()),
    [FixedGlAccountNo]   NVARCHAR(50)  NULL,
    [FixedGlDescription] NVARCHAR(500) NULL,
    [FormCode]           NVARCHAR(20)  NULL,
    CONSTRAINT [PK_DepartmentErpMap] PRIMARY KEY CLUSTERED ([Id])
  );

  CREATE UNIQUE INDEX [UQ_DepartmentErpMap_Dept]
    ON [dbo].[DepartmentErpMap] ([FormCode], [BrandCode], [DepartmentCode]);

  CREATE INDEX [IX_DepartmentErpMap_Brand]
    ON [dbo].[DepartmentErpMap] ([BrandCode]);

  COMMIT TRANSACTION;
  PRINT 'dbo.DepartmentErpMap created in the form database.';
END
GO

SET NOCOUNT ON;

IF DB_NAME() LIKE '%[_]UAT'
BEGIN
  DECLARE @uatDb2 NVARCHAR(128) = DB_NAME();
  RAISERROR (
    'Migration 099 must not be applied to the UAT form database. Current database is %s.',
    16, 1, @uatDb2
  );
END
ELSE IF DB_NAME() NOT LIKE 'Rocks[_]Portal[_]Form%'
     OR OBJECT_ID('dbo.AccRequest', 'U') IS NULL
BEGIN
  DECLARE @notForm2 NVARCHAR(128) = DB_NAME();
  RAISERROR (
    'Migration 099 may only be applied to the production Form Portal database. Current database is %s.',
    16, 1, @notForm2
  );
END
ELSE IF OBJECT_ID('dbo.DepartmentErpMap', 'U') IS NULL
BEGIN
  RAISERROR (
    'Migration 099 batch 2: dbo.DepartmentErpMap does not exist as a table -- batch 1 did not run.',
    16, 1
  );
END
ELSE IF EXISTS (SELECT 1 FROM [dbo].[DepartmentErpMap])
BEGIN
  PRINT 'dbo.DepartmentErpMap already holds rows -- the copy is skipped.';
END
ELSE IF OBJECT_ID('[Fast_Core].[dbo].[DepartmentErpMap]', 'U') IS NULL
BEGIN
  RAISERROR (
    'Migration 099 batch 2: [Fast_Core].[dbo].[DepartmentErpMap] is not a table. If migration 100 has already run it is a synonym pointing back here, and there is nothing to copy.',
    16, 1
  );
END
ELSE
BEGIN
  SET XACT_ABORT ON;
  BEGIN TRANSACTION;

  SET IDENTITY_INSERT [dbo].[DepartmentErpMap] ON;

  INSERT INTO [dbo].[DepartmentErpMap]
    ([Id], [BrandCode], [DepartmentCode], [HrDepartmentName], [ErpDimensionCode],
     [ErpCode], [MappedBy], [MappedAt], [FixedGlAccountNo], [FixedGlDescription],
     [FormCode])
  SELECT
     [Id], [BrandCode], [DepartmentCode], [HrDepartmentName], [ErpDimensionCode],
     [ErpCode], [MappedBy], [MappedAt], [FixedGlAccountNo], [FixedGlDescription],
     [FormCode]
  FROM [Fast_Core].[dbo].[DepartmentErpMap];

  SET IDENTITY_INSERT [dbo].[DepartmentErpMap] OFF;

  DECLARE @src INT = (SELECT COUNT(*) FROM [Fast_Core].[dbo].[DepartmentErpMap]);
  DECLARE @dst INT = (SELECT COUNT(*) FROM [dbo].[DepartmentErpMap]);

  IF @src <> @dst
  BEGIN
    ROLLBACK TRANSACTION;
    RAISERROR (
      'Migration 099: copied %d rows but Fast_Core holds %d. Rolled back.',
      16, 1, @dst, @src
    );
  END
  ELSE
  BEGIN
    COMMIT TRANSACTION;
    PRINT 'Rows copied from Fast_Core with their ids preserved.';
  END
END
GO

SET NOCOUNT ON;

-- Reseed outside a transaction: DBCC CHECKIDENT is not transactional. 2004 is
-- IDENT_CURRENT on the Fast_Core table as measured 2026-08-20; without this the
-- identity would sit at 1006 (the highest copied id) and the sequence would
-- restart inside a range the source had already left behind.
IF DB_NAME() NOT LIKE '%[_]UAT'
   AND DB_NAME() LIKE 'Rocks[_]Portal[_]Form%'
   AND OBJECT_ID('dbo.DepartmentErpMap', 'U') IS NOT NULL
   AND IDENT_CURRENT('dbo.DepartmentErpMap') < 2004
BEGIN
  DBCC CHECKIDENT ('dbo.DepartmentErpMap', RESEED, 2004);
  PRINT 'Identity reseeded to 2004.';
END
GO
```

- [ ] **Step 3: Write migration 100**

Create `migrations/100_core_department_erp_map_synonym.sql`:

```sql
-- Fast_Core.dbo.DepartmentErpMap becomes a synonym for the form database copy.
--
-- Apply with (Fast_Core ONLY, and ONLY AFTER migration 099):
--   npm run apply-sql -- --db Fast_Core --file migrations/100_core_department_erp_map_synonym.sql
--
-- ---------------------------------------------------------------------------
-- THIS MIGRATION DESTROYS THE ONLY COPY OF THE DATA IF 099 HAS NOT RUN.
--
-- Everything before the DROP is the guard against that: the target must exist
-- as a TABLE, and it must hold the same number of rows, counted under TABLOCKX
-- inside the same transaction as the drop so no sibling can insert between the
-- count and the drop.
--
-- Why a synonym rather than editing the siblings: all three applications name
-- the table two-part, [dbo].[DepartmentErpMap], on a pool opened against
-- Fast_Core. A synonym answers all three -- SELECT, MERGE and DELETE alike --
-- with no change to either sibling repository. Both databases are on the same
-- SQL Server instance, so a sibling transaction that now spans two databases
-- stays a local transaction; MSDTC is involved only across instances.
--
-- The synonym is permanent, not a migration aid.
-- ---------------------------------------------------------------------------

SET NOCOUNT ON;

IF DB_NAME() <> N'Fast_Core'
BEGIN
  DECLARE @wrongDb NVARCHAR(128) = DB_NAME();
  RAISERROR (
    'Migration 100 may only be applied to Fast_Core. Current database is %s.',
    16, 1, @wrongDb
  );
END
ELSE IF OBJECT_ID('dbo.DepartmentErpMap', 'SN') IS NOT NULL
BEGIN
  PRINT 'dbo.DepartmentErpMap is already a synonym -- migration 100 has already run.';
END
ELSE IF OBJECT_ID('dbo.DepartmentErpMap', 'U') IS NULL
BEGIN
  RAISERROR (
    'Migration 100: dbo.DepartmentErpMap is neither a table nor a synonym in Fast_Core. Refusing to guess.',
    16, 1
  );
END
ELSE IF OBJECT_ID('[Rocks_Portal_Form].[dbo].[DepartmentErpMap]', 'U') IS NULL
BEGIN
  RAISERROR (
    'Migration 100: [Rocks_Portal_Form].[dbo].[DepartmentErpMap] does not exist as a table. Run migration 099 first. Refusing to drop the only copy of the data.',
    16, 1
  );
END
ELSE
BEGIN
  SET XACT_ABORT ON;
  BEGIN TRANSACTION;

  -- TABLOCKX holds the source against inserts for the rest of the transaction,
  -- so the count that authorises the drop is still true when the drop runs.
  DECLARE @here INT = (
    SELECT COUNT(*) FROM [dbo].[DepartmentErpMap] WITH (TABLOCKX)
  );
  DECLARE @there INT = (
    SELECT COUNT(*) FROM [Rocks_Portal_Form].[dbo].[DepartmentErpMap]
  );

  IF @here <> @there
  BEGIN
    ROLLBACK TRANSACTION;
    RAISERROR (
      'Migration 100: Fast_Core holds %d rows, Rocks_Portal_Form holds %d. Refusing to drop the only copy until the counts match.',
      16, 1, @here, @there
    );
  END
  ELSE
  BEGIN
    DROP TABLE [dbo].[DepartmentErpMap];

    CREATE SYNONYM [dbo].[DepartmentErpMap]
      FOR [Rocks_Portal_Form].[dbo].[DepartmentErpMap];

    COMMIT TRANSACTION;
    PRINT 'Fast_Core.dbo.DepartmentErpMap is now a synonym for [Rocks_Portal_Form].[dbo].[DepartmentErpMap].';
  END
END
GO
```

- [ ] **Step 4: Write the verification script**

Create `scripts/checks/verify-department-erp-map-move.ts`. Follow the convention in `scripts/checks/verify-059.ts` exactly: `/* eslint-disable no-console */`, its `loadDotEnvLocal()` helper copied verbatim (tsx does not auto-load `.env.local`), and the pool imported by **relative** path (`../../src/lib/db/mssql`) rather than the `@/` alias.

The script asserts the five things the spec's section 8 names. Each failure pushes onto a `problems` array; the script prints them all and exits 1 if any.

```ts
async function main() {
  loadDotEnvLocal();
  const { getCorePool, getProductionFormPool } = await import("../../src/lib/db/mssql");
  const core = await getCorePool();
  const form = await getProductionFormPool();
  const problems: string[] = [];

  // 1. the table, its rows and its shape
  const shape = await form.request().query(`
    SELECT
      (SELECT COUNT(*) FROM [dbo].[DepartmentErpMap]) AS rowCount,
      IDENT_CURRENT('dbo.DepartmentErpMap') AS identCurrent,
      OBJECT_ID('dbo.DepartmentErpMap', 'U') AS tableId;
  `);
  const s = shape.recordset[0];
  if (s.tableId === null) problems.push("Rocks_Portal_Form.dbo.DepartmentErpMap is not a table");
  if (s.rowCount !== 3) problems.push(`expected 3 rows, found ${s.rowCount}`);
  if (Number(s.identCurrent) !== 2004) problems.push(`IDENT_CURRENT is ${s.identCurrent}, expected 2004`);

  const ids = await form.request().query(
    `SELECT Id FROM [dbo].[DepartmentErpMap] ORDER BY Id;`
  );
  const idList = ids.recordset.map((r: { Id: number }) => r.Id).join(",");
  if (idList !== "1004,1005,1006") problems.push(`ids are ${idList}, expected 1004,1005,1006`);

  const idx = await form.request().query(`
    SELECT name FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.DepartmentErpMap') AND type > 0
    ORDER BY name;
  `);
  const idxNames = idx.recordset.map((r: { name: string }) => r.name).join(",");
  const expectedIdx = "IX_DepartmentErpMap_Brand,PK_DepartmentErpMap,UQ_DepartmentErpMap_Dept";
  if (idxNames !== expectedIdx) problems.push(`indexes are ${idxNames}, expected ${expectedIdx}`);

  // 2. the Fast_Core object is a synonym pointing at the new home
  const syn = await core.request().query(`
    SELECT base_object_name FROM sys.synonyms WHERE name = 'DepartmentErpMap';
  `);
  if (syn.recordset.length !== 1) {
    problems.push("Fast_Core has no synonym named DepartmentErpMap");
  } else {
    const base = String(syn.recordset[0].base_object_name);
    if (base.indexOf("Rocks_Portal_Form") < 0 || base.indexOf("DepartmentErpMap") < 0) {
      problems.push(`synonym points at ${base}`);
    }
  }

  // 3. a read through the synonym sees the same rows
  const through = await core.request().query(
    `SELECT COUNT(*) AS n FROM [dbo].[DepartmentErpMap];`
  );
  if (through.recordset[0].n !== 3) {
    problems.push(`read through the synonym returned ${through.recordset[0].n} rows, expected 3`);
  }

  // 4. a WRITE through the synonym succeeds -- this is the siblings'
  //    cross-database permission, and it would otherwise only be discovered
  //    the next time ACC Portal saved a mapping. Rolled back, so no data moves.
  const tx = core.transaction();
  await tx.begin();
  try {
    const w = await tx.request().query(`
      UPDATE [dbo].[DepartmentErpMap]
      SET HrDepartmentName = HrDepartmentName
      WHERE BrandCode = 'PCTH';
    `);
    if (!w.rowsAffected[0]) problems.push("write through the synonym affected no rows");
  } catch (e) {
    problems.push(`write through the synonym failed: ${(e as Error).message}`);
  } finally {
    await tx.rollback();
  }

  if (problems.length) {
    console.error("FAIL");
    for (const p of problems) console.error("  - " + p);
    process.exit(1);
  }
  console.log("OK: DepartmentErpMap lives in Rocks_Portal_Form and Fast_Core reaches it by synonym");
  process.exit(0);
}
```

- [ ] **Step 5: Add the npm script**

In `package.json`, the `scripts` block currently ends:

```json
    "check:alignment": "tsx scripts/checks/verify-master-alignment.ts"
```

Make it:

```json
    "check:alignment": "tsx scripts/checks/verify-master-alignment.ts",
    "check:dept-map-home": "tsx scripts/checks/verify-department-erp-map-move.ts"
```

- [ ] **Step 6: Verify nothing broke**

Run: `npx tsc --noEmit`
Expected: no errors under `src/` or `scripts/`. Pre-existing `.next/types` errors are not yours.

Run: `npm test`
Expected: `pass 285`, `fail 0`. This task adds no unit test — the migrations are SQL and the check script talks to live databases, neither of which `npm test` covers. The check script *is* the test, and Task 2 runs it.

- [ ] **Step 7: Commit**

```bash
git add migrations/099_portal_form_department_erp_map.sql migrations/100_core_department_erp_map_synonym.sql scripts/checks/verify-department-erp-map-move.ts package.json
git commit -m "feat(db): migrations to move DepartmentErpMap into the form database"
```

---

### Task 2: Apply the migrations and capture the proof

**Files:**
- Create: `docs/reviews/2026-08-20-department-erp-map-move-verification.md`

**Interfaces:**
- Consumes: `migrations/099_…sql`, `migrations/100_…sql`, `npm run check:dept-map-home` from Task 1.
- Produces: the move itself, in the live databases. Task 3's code change depends on `Rocks_Portal_Form.dbo.DepartmentErpMap` existing.

**This is the irreversible task.** Step 1 exists so that if anything later goes wrong there is a copy of the data in a file. Do not skip it.

- [ ] **Step 1: Snapshot the source rows before touching anything**

```bash
npx tsx --env-file=.env.local -e "import('./src/lib/db/mssql').then(async (m) => { const p = await m.getCorePool(); const r = await p.request().query('SELECT * FROM [dbo].[DepartmentErpMap] ORDER BY Id'); require('node:fs').writeFileSync('dept-erp-map-snapshot.json', JSON.stringify(r.recordset, null, 2)); console.log('rows:', r.recordset.length); process.exit(0); })"
```

Write the file into your scratch directory, not the repo. Expected: `rows: 3`. If it is not 3, **stop and report BLOCKED** — the plan's measured state is stale and the migration's row-count guard will refuse anyway.

- [ ] **Step 2: Apply 099 to `Rocks_Portal_Form`**

Run: `npm run apply-sql -- --db Rocks_Portal_Form --file migrations/099_portal_form_department_erp_map.sql`

Expected output includes `dbo.DepartmentErpMap created in the form database.`, `Rows copied from Fast_Core with their ids preserved.` and `Identity reseeded to 2004.`

- [ ] **Step 3: Confirm the copy landed before dropping the original**

```bash
npx tsx --env-file=.env.local -e "import('./src/lib/db/mssql').then(async (m) => { const p = await m.getProductionFormPool(); const r = await p.request().query('SELECT COUNT(*) n, IDENT_CURRENT(''dbo.DepartmentErpMap'') cur FROM [dbo].[DepartmentErpMap]'); console.log(JSON.stringify(r.recordset[0])); process.exit(0); })"
```

Expected: `{"n":3,"cur":2004}`. **If `n` is not 3, stop.** Migration 100 would refuse anyway, but do not rely on that.

- [ ] **Step 4: Apply 100 to `Fast_Core`**

Run: `npm run apply-sql -- --db Fast_Core --file migrations/100_core_department_erp_map_synonym.sql`

Expected: `Fast_Core.dbo.DepartmentErpMap is now a synonym for [Rocks_Portal_Form].[dbo].[DepartmentErpMap].`

- [ ] **Step 5: Run the verification**

Run: `npm run check:dept-map-home`
Expected: `OK: DepartmentErpMap lives in Rocks_Portal_Form and Fast_Core reaches it by synonym`

If it prints `FAIL`, read the listed problems. Do not proceed to Task 3 with a failing verification.

- [ ] **Step 6: Confirm `check:alignment` is unchanged**

Run: `npm run check:alignment`

Expected: the two **pre-existing** AP-3 mismatches and nothing else — `AccFormMaster` (production 6 rows, UAT 7) and `AccFormBrand` (production 18, UAT 23). This table is not in `MASTER_TABLES`, so the table count must be the same as before this work: **21**. If a `DepartmentErpMap` line appears, someone added it to `MASTER_TABLES` against the Global Constraints — remove it.

- [ ] **Step 7: Write the verification record and commit**

Create `docs/reviews/2026-08-20-department-erp-map-move-verification.md` containing: the date, the two `apply-sql` commands as run, their output verbatim, the `check:dept-map-home` output verbatim, and the `check:alignment` summary line. Open it with one paragraph saying what moved and that the synonym is permanent.

```bash
git add docs/reviews/2026-08-20-department-erp-map-move-verification.md
git commit -m "docs: record the DepartmentErpMap move against the live databases"
```

---

### Task 3: Point the application code at the new home

**Files:**
- Modify: `src/lib/acc/department-map-service.ts` (import at `:18`; pool calls at `:153`, `:232`, `:478`, `:632`, `:732`, `:820`)
- Modify: `scripts/checks/verify-045.ts:41`
- Modify: `scripts/checks/verify-046.ts:43`

**Interfaces:**
- Consumes: `Rocks_Portal_Form.dbo.DepartmentErpMap`, created by Task 2.
- Produces: no new exports. Every function in `department-map-service.ts` keeps its current name and signature.

**Line numbers will have shifted if earlier tasks edited this file — they did not, but confirm by content rather than trusting the numbers.**

- [ ] **Step 1: Switch the six pool calls**

All six `getCorePool()` calls in `src/lib/acc/department-map-service.ts` read or write `DepartmentErpMap` and nothing else in `Fast_Core`. Every one becomes `getProductionFormPool()`:

| Line | Function | Statement |
|---|---|---|
| `:153` | (read) | `SELECT … FROM [dbo].[DepartmentErpMap]` |
| `:232` | (purge) | `DELETE FROM [dbo].[DepartmentErpMap]` |
| `:478` | `saveDepartmentMappings` | `DELETE` + `MERGE` |
| `:632` | `loadDepartmentErpMapsByTarget` | `SELECT` |
| `:732` | `loadDeptGlOverridesByTarget` | `SELECT` |
| `:820` | `loadAllDepartmentErpMaps` | `SELECT` |

Leave the SQL alone — the two-part `[dbo].[DepartmentErpMap]` is correct against the form pool.

**Do not touch `loadErpDeptDisplayNamesByTargetBrand()` at `:839`.** It calls `getDataPool()` and reads `Fast_Data`, which is a different table and is not moving.

Change the import at `:18` from:

```ts
import { getCorePool, getDataPool, sql } from "@/lib/db/mssql";
```

to:

```ts
import { getDataPool, getProductionFormPool, sql } from "@/lib/db/mssql";
```

`getCorePool` must no longer be imported by this file. If `npx tsc --noEmit` reports it as unused, you missed a call site; if it reports it as undefined, you missed the import.

Add this comment immediately above the first converted call:

```ts
  // DepartmentErpMap lives in Rocks_Portal_Form since migration 099/100, and
  // Fast_Core reaches it by synonym. getProductionFormPool() and never
  // getFormPool(): there is one physical copy, so the environment-varying pool
  // has nothing to choose between, and a UAT posting must resolve production's
  // mapping — which is what happened when the table was in Fast_Core.
```

- [ ] **Step 2: Repoint the two verification scripts**

`scripts/checks/verify-045.ts:41` reads:

```ts
  const pool = await getAppPool("Fast_Core");
```

Change to:

```ts
  // DepartmentErpMap moved to the form database (migrations 099/100). Fast_Core
  // now holds a synonym, and COL_LENGTH does not resolve synonyms — pointed at
  // Fast_Core this check would fail on a table that is perfectly healthy.
  const pool = await getAppPool("Rocks_Portal_Form");
```

`scripts/checks/verify-046.ts:43` reads:

```ts
  const corePool = await getAppPool("Fast_Core");
```

That script checks `DepartmentErpMap` columns on `corePool` and `AccRequest.RequesterDepartmentCode` on a second pool at `:61`. Point the `DepartmentErpMap` half at `Rocks_Portal_Form` with the same comment, and rename the variable to `deptMapPool` so the name stops claiming Fast_Core. Leave the `:61` pool alone.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: clean under `src/` and `scripts/`.

Run: `npm test`
Expected: `pass 285`, `fail 0`.

Run: `npm run check:dept-map-home`
Expected: still `OK`. The code change cannot affect it — the script talks to the databases directly — but a green run proves the databases are still as Task 2 left them.

- [ ] **Step 4: Prove the service reads the new home**

The unit suite does not touch a database, so prove this one by hand:

```bash
npx tsx --env-file=.env.local -e "import('./src/lib/acc/department-map-service').then(async (m) => { const r = await m.loadAllDepartmentErpMaps(); console.log('brands:', Array.from(r.keys()).join(',')); console.log('PCTH entries:', r.get('PCTH') ? r.get('PCTH').size : 0); process.exit(0); })"
```

Expected: `brands: PCTH` and `PCTH entries: 3`. If it throws `Invalid object name`, the pool switch is wrong or Task 2 did not complete.

- [ ] **Step 5: Commit**

```bash
git add src/lib/acc/department-map-service.ts scripts/checks/verify-045.ts scripts/checks/verify-046.ts
git commit -m "refactor(acc): read DepartmentErpMap from the form database"
```

---

### Task 4: Update the prose that names the old home

**Files:**
- Modify: `src/lib/acc/department-map-guard.ts` (the paragraph beginning "That table is not this app's alone")
- Modify: `src/lib/acc/settings-tabs.ts` (the `departments/map` entry, around `:111`-`:123`)
- Modify: `src/app/api/request/accounting/settings/departments/map/route.ts` (the header comment, around `:15`)
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: nothing. This task changes comments and documentation only — **no executable line changes.**
- Produces: nothing.

**The point of this task is one idea, and it is a security idea, not a bookkeeping one:** the move did *not* unshare the table, so `settings/departments/map` stays admin-only. Someone reading the code next year will see the table sitting in this app's own database and conclude the tab grant is now harmless. Every comment you touch must make that wrong on its face — say the rows are shared with two sibling applications, and do not let "which database" carry the argument.

- [ ] **Step 1: `department-map-guard.ts`**

Replace:

```
 * That table is not this app's alone: `DepartmentErpMap` lives in the shared
 * configuration database, and both the Rocks Fast and ACC Portal siblings read
 * it from their own `erp-prep-service.ts` — the path that prepares financial
 * journal postings.
```

with:

```
 * That table is not this app's alone. Since migrations 099/100 it lives in
 * `Rocks_Portal_Form` and `Fast_Core` reaches it by synonym — which moved the
 * rows and shared them no less: both the Rocks Fast and ACC Portal siblings
 * still read exactly these rows from their own `erp-prep-service.ts`, the path
 * that prepares financial journal postings. The file cabinet changed, the
 * ownership did not.
```

- [ ] **Step 2: `settings-tabs.ts`**

Replace the `note` on the `departments/map` entry:

```ts
    note:
      "writes DepartmentErpMap in the shared configuration database, which two sibling "
      + "applications read to prepare financial journal postings",
```

with:

```ts
    note:
      "writes DepartmentErpMap, which two sibling applications read to prepare "
      + "financial journal postings — shared rows, whichever database holds them",
```

And in the comment above it, replace `saveDepartmentMappings` opens the core pool and writes` with `saveDepartmentMappings` writes`, then append this sentence to that comment:

```
    // Migrations 099/100 moved the table into this app's own database behind a
    // Fast_Core synonym. That changed nothing here: the siblings read the same
    // rows through the synonym, so the grant is exactly as unsafe as it was.
```

- [ ] **Step 3: `departments/map/route.ts`**

Replace:

```
 * `saveDepartmentMappings` opens the core pool and writes
 * `DepartmentErpMap`, which lives in the configuration database shared with the
 * Rocks Fast and ACC Portal siblings — both read it from their own
 * `erp-prep-service.ts`, the path that prepares financial journal postings.
```

with:

```
 * `saveDepartmentMappings` writes `DepartmentErpMap` — which since migrations
 * 099/100 lives in this app's own form database, reached from `Fast_Core` by a
 * synonym. That is a change of address and nothing more: the Rocks Fast and ACC
 * Portal siblings read the same rows through that synonym, from their own
 * `erp-prep-service.ts`, the path that prepares financial journal postings.
```

- [ ] **Step 4: `CLAUDE.md` — four places**

1. **The 3-database architecture table** — the `Fast_Data` row's description and the `Rocks_Portal_Form` row are both fine; add `DepartmentErpMap` to the `Rocks_Portal_Form` row's purpose list, and note that `Fast_Core` keeps a synonym for the two siblings.
2. **"Per-form ERP configuration — the default and override rule"** — it says the seven tables are six "in the form databases, plus **`Fast_Core.dbo.DepartmentErpMap`**, which is the same kind of table living in the shared database." All seven now live in the form database; the seventh is the one the siblings reach by synonym, and it is the only one of the seven with **no UAT twin**. Say both.
3. **The สิทธิ์เข้าถึง section** — two places say `settings/departments/map` "writes `Fast_Core.dbo.DepartmentErpMap`". Reword to name the shared rows rather than the database, keeping the ruling itself unchanged.
4. **Migration 098's description** — it is described as widening a `Fast_Core` table. Add that 099/100 subsequently moved that table into `Rocks_Portal_Form`, so 098's target database is historical.

Add a short subsection under the architecture heading recording the move: what moved, that the synonym is permanent, that there is exactly one copy and why (a synonym points at one database, so a sibling's write could never reach a UAT twin), and that it is therefore absent from `dual-write.ts` and `MASTER_TABLES`.

- [ ] **Step 5: Verify nothing executable changed**

Run: `git diff --stat`
Expected: `CLAUDE.md` plus the three source files. The three source files' changes must be comments and one string literal only.

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npm test`
Expected: `pass 285`, `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md src/lib/acc/department-map-guard.ts src/lib/acc/settings-tabs.ts src/app/api/request/accounting/settings/departments/map/route.ts
git commit -m "docs: DepartmentErpMap's new home, and why the admin-only gate stays"
```

---

## Self-review

**Spec coverage.** §1 (why) — Task 4's CLAUDE.md subsection. §2 (measured state) — the plan's own measured-state block, consumed by Tasks 1 and 2. §3 (the shape, single copy) — Task 1 Step 2 and the Global Constraints; Task 2 Step 6 proves the `MASTER_TABLES` count is unchanged. §4 (who reads it) — Task 3 Steps 1-2, and the same-instance transaction note is in migration 100's header. §5 (cutover, guards) — Task 1 Steps 2-3, Task 2 Steps 2-4. §6 (what else changes) — Task 3 Step 2 and all of Task 4. §7 (the trap) — Task 4, which exists mainly for it. §8 (verification) — Task 1 Step 4 and Task 2 Steps 5-6, all five numbered assertions present. §9 (out of scope) — nothing in the plan touches the sync tables or the siblings' repositories.

**Placeholder scan.** No TBD/TODO. Every code step carries the code. The two migrations and the check script are written out in full rather than described.

**Type consistency.** `getProductionFormPool()` is the name exported at `src/lib/db/mssql.ts:94`; `getAppPool(databaseName: string)` at `:112`. `loadAllDepartmentErpMaps(): Promise<Map<string, Map<string, string>>>` — the Task 3 Step 4 probe calls `.keys()` and `.size` on that shape, which matches. The npm script name `check:dept-map-home` is used identically in Task 1 Step 5, Task 2 Step 5 and Task 3 Step 3.

**One gap found and closed while reviewing:** the spec said 099 must refuse a database "whose name does not begin `Rocks_Portal_Form`", which admits `Rocks_Portal_Form_UAT` — the one database this table must never exist in. The spec was corrected and migration 099 tests `%[_]UAT` first, as a separate guard, before the name test.
