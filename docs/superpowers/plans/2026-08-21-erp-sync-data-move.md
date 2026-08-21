# Moving the five ERP sync tables into `Rocks_ERP_Data` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the five Business Central sync tables out of `Fast_Data` into `Rocks_ERP_Data`, leaving synonyms behind so Rocks Fast and ACC Portal keep reaching the same rows unchanged.

**Architecture:** Two migrations — one creates the five tables in the new database and copies their rows, the other drops the originals and replaces them with synonyms inside a single transaction. This application then opens a new `getErpDataPool()` and names the new home directly. One physical copy each: no UAT twin, no dual-write, no `MASTER_TABLES` entries.

**Tech Stack:** MSSQL (T-SQL migrations applied by `scripts/apply-sql.ts`), TypeScript on Node (`tsx`), `node:test` via `npm test`.

**Spec:** `docs/superpowers/specs/2026-08-21-erp-sync-data-move-design.md`

## Global Constraints

- **ES5 target.** Use `Array.from()` and `indexOf`; never `[...set]` or `[...map.values()]`.
- **Parameterized SQL only** — `pool.request().input("name", sql.NVarChar, value).query(...)`. Never `sql.connect()` (global singleton).
- **One physical copy each.** Never create these tables in any `_UAT` database. Never add them to `src/lib/acc/dual-write.ts`. Never add them to `MASTER_TABLES` in `scripts/checks/verify-master-alignment.ts`.
- **Only the five sync tables move.** `TravelProvince` and the department lookups stay in `Fast_Data`, and `getDataPool()` keeps every other caller it has today.
- **`AccBrandJournalBatch`, `AccBrandGlAccount`, `AccBrandBankAccount`, `AccBrandBranchCode` and `AccBrandErpInterface` do not move.** They are this app's per-form configuration, not sync output — see the spec's §1. Touching them is out of scope and would drop a UAT twin.
- **Every migration names its target database in its header** and guards on `DB_NAME()`.
- **Do not start the dev server.** Do not run `npm run build`.
- Use scratch `.ts` files run with `npx tsx --env-file=.env.local <path>` for any database probe. **Never `node -e` or `tsx -e`** — a one-liner carrying SQL through a shell string has had `${...}` and backticked words eaten by bash in this repo.
- **Done means:** `npx tsc --noEmit` clean under `src/` and `scripts/` (stale `.next/types` errors for a `reimburse` route tree are pre-existing and not yours) and `npm test` at `pass 285, fail 0`.

## File Structure

| File | Responsibility |
|---|---|
| `migrations/101_erp_data_sync_tables.sql` | Create the five tables in `Rocks_ERP_Data`, copy rows as an id-keyed top-up, reseed each identity. Target: `Rocks_ERP_Data` only. |
| `migrations/102_fast_data_erp_synonyms.sql` | Guard, then drop the five `Fast_Data` tables and create five synonyms, atomically. Target: `Fast_Data` only. |
| `scripts/checks/verify-erp-data-move.ts` | Post-apply proof for all five, plus a rolled-back write through a synonym. |
| `src/env.ts` | `MSSQL_ERP_DATA_DATABASE`, in both the schema and the `process.env` mapping. |
| `src/lib/db/mssql.ts` | `getErpDataPool()`. |
| `src/lib/erp/account-sync.ts`, `src/lib/erp/dimension-sync.ts`, `src/lib/acc/department-map-service.ts` | Open the new pool for these five tables only. |
| `.env.local`, `.env.example` | The new variable. |
| `CLAUDE.md` | Architecture table, env block, the ERP section. |
| `docs/reviews/2026-08-21-erp-data-move-verification.md` | The captured verification output. |

## Measured starting state (2026-08-21) — do not re-derive, but re-confirm before destroying anything

`Rocks_ERP_Data` exists, holds **0 tables**, is `Thai_CI_AS` (matching `Fast_Data`), and `saai` is `db_owner` with `CREATE TABLE` / `DROP TABLE` proven.

| Table | Rows | `IDENT_CURRENT` |
|---|---:|---:|
| `ErpAccounts` | 4793 | 4793 |
| `ErpDimensionValue` | 806 | 806 |
| `ErpGeneralJournalBatch` | 174 | 174 |
| `ErpBankAccountCard` | 64 | 64 |
| `ErpSyncLog` | 21 | 21 |

Across all five: **no foreign keys, no check constraints, no computed columns, and no view, procedure or function references them.** Every statement in all three applications is DML (`INSERT`, `MERGE`, `UPDATE`, `SELECT`) against a two-part `[dbo].[…]` name on a `Fast_Data` pool; **there is no `TRUNCATE` anywhere**, which is the one common statement a synonym would not resolve.

---

### Task 1: Write the two migrations and the verification script — apply nothing

**Files:**
- Create: `migrations/101_erp_data_sync_tables.sql`
- Create: `migrations/102_fast_data_erp_synonyms.sql`
- Create: `scripts/checks/verify-erp-data-move.ts`
- Modify: `package.json` (the `scripts` block, currently ending at `"check:dept-map-home"`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `npm run check:erp-data-home` — the verification entry point Task 2 runs. Exits 0 on success, 1 with printed reasons on failure.

**Do not run `npm run apply-sql` in this task, for any file, against any database.** Task 2 applies these, after a reviewer has read 102's guard. That guard is what stands between this work and destroying the only copy of 5,858 rows that three applications read.

- [ ] **Step 1: Write migration 101**

Create `migrations/101_erp_data_sync_tables.sql`. The column definitions below were generated from the live `Fast_Data` catalog on 2026-08-21 — use them exactly.

Two deliberate departures from the source, both of which the header must state rather than claim an exact reproduction:

1. The four `UQ_*` objects are **unique constraints** in the source, not plain unique indexes, and are recreated as constraints. Getting this backwards produces a different object: `DROP INDEX` against a unique constraint raises Msg 3723, which is the trap migration 097 hit.
2. Every default constraint is named deterministically `DF_<Table>_<Column>`. In the source some are named that way and some are auto-generated (`DF__ErpDimens__IsBlo__5DCAEF64`, `DF__ErpSyncLo__RowsU__628FA481`). Nothing references a default constraint by name.

```sql
-- The five Business Central sync tables move into their own database.
--
-- Apply with (Rocks_ERP_Data ONLY):
--   npm run apply-sql -- --db Rocks_ERP_Data --file migrations/101_erp_data_sync_tables.sql
--
-- Then, and only then, apply 102 to Fast_Data. 102 drops the originals.
--
-- ---------------------------------------------------------------------------
-- These five are a MIRROR OF BUSINESS CENTRAL: which G/L accounts, dimension
-- values, journal batches and bank account cards exist over there, plus the log
-- of each sync run. They are not this application's configuration -- nothing in
-- them is a decision anybody here made. That is the line: data synced FROM BC
-- lives here; the per-brand and per-form choices this app makes
-- (AccBrandGlAccount, AccBrandJournalBatch, AccBrandBankAccount, ...) stay in
-- Rocks_Portal_Form. See
-- docs/superpowers/specs/2026-08-21-erp-sync-data-move-design.md section 1.
--
-- SINGLE COPY each. Not created in any _UAT database, not dual-written, not in
-- MASTER_TABLES. Fast_Data has no UAT twin, and there is no second version of
-- what Business Central holds to test against.
--
-- TWO DELIBERATE DEPARTURES FROM THE SOURCE SHAPE, both safe and both stated
-- here rather than hidden:
--   1. UQ_ErpAccounts, UQ_ErpDimensionValue, UQ_ErpGeneralJournalBatch and
--      UQ_ErpBankAccountCard are UNIQUE CONSTRAINTS in Fast_Data, not plain
--      unique indexes, and are recreated as constraints below. They are
--      different objects: DROP INDEX against a unique constraint raises
--      Msg 3723, which is what caught migration 097.
--   2. Default constraints are all named DF_<Table>_<Column> here. In Fast_Data
--      some are and some are auto-generated. Nothing references one by name.
--
-- Batch 2 is an ID-KEYED TOP-UP, not a copy that skips a non-empty target: a
-- re-run inserts only the ids the target lacks. That is the remedy when 102
-- refuses because a sync ran between the two migrations.
-- ---------------------------------------------------------------------------

SET NOCOUNT ON;

IF DB_NAME() <> N'Rocks_ERP_Data'
BEGIN
  DECLARE @wrongDb NVARCHAR(128) = DB_NAME();
  RAISERROR (
    'Migration 101 may only be applied to Rocks_ERP_Data. Current database is %s.',
    16, 1, @wrongDb
  );
END
ELSE
BEGIN
  SET XACT_ABORT ON;
  BEGIN TRANSACTION;

  IF OBJECT_ID('dbo.ErpAccounts', 'U') IS NULL
  CREATE TABLE [dbo].[ErpAccounts] (
    [Id] INT IDENTITY(1,1) NOT NULL,
    [BrandCode] NVARCHAR(20) NOT NULL,
    [BcCompanyId] NVARCHAR(50) NOT NULL,
    [BcConnectionId] INT NOT NULL,
    [AccountCategory] NVARCHAR(20) NOT NULL,
    [AccountNo] NVARCHAR(50) NOT NULL,
    [DisplayName] NVARCHAR(200) NULL,
    [BcCategory] NVARCHAR(50) NULL,
    [IsBlocked] BIT NOT NULL CONSTRAINT [DF_ErpAccounts_IsBlocked] DEFAULT ((0)),
    [IsActive] BIT NOT NULL CONSTRAINT [DF_ErpAccounts_IsActive] DEFAULT ((1)),
    [SyncedAt] DATETIME2(7) NOT NULL CONSTRAINT [DF_ErpAccounts_SyncedAt] DEFAULT (sysdatetime()),
    [RawJson] NVARCHAR(MAX) NULL,
    CONSTRAINT [PK_ErpAccounts] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [UQ_ErpAccounts] UNIQUE ([BrandCode], [AccountCategory], [AccountNo])
  );

  IF OBJECT_ID('dbo.ErpDimensionValue', 'U') IS NULL
  CREATE TABLE [dbo].[ErpDimensionValue] (
    [Id] INT IDENTITY(1,1) NOT NULL,
    [BrandCode] NVARCHAR(20) NOT NULL,
    [DimensionCode] NVARCHAR(50) NOT NULL,
    [Code] NVARCHAR(50) NOT NULL,
    [DisplayName] NVARCHAR(200) NULL,
    [IsBlocked] BIT NOT NULL CONSTRAINT [DF_ErpDimensionValue_IsBlocked] DEFAULT ((0)),
    [IsActive] BIT NOT NULL CONSTRAINT [DF_ErpDimensionValue_IsActive] DEFAULT ((1)),
    [BcLastModified] DATETIME2(7) NULL,
    [SyncedAt] DATETIME2(7) NOT NULL CONSTRAINT [DF_ErpDimensionValue_SyncedAt] DEFAULT (sysdatetime()),
    [RawJson] NVARCHAR(MAX) NULL,
    CONSTRAINT [PK_ErpDimensionValue] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [UQ_ErpDimensionValue] UNIQUE ([BrandCode], [DimensionCode], [Code])
  );

  IF OBJECT_ID('dbo.ErpGeneralJournalBatch', 'U') IS NULL
  CREATE TABLE [dbo].[ErpGeneralJournalBatch] (
    [Id] INT IDENTITY(1,1) NOT NULL,
    [BrandCode] NVARCHAR(20) NOT NULL,
    [BcCompanyId] NVARCHAR(50) NOT NULL,
    [BcCompanyName] NVARCHAR(200) NULL,
    [BcConnectionId] INT NOT NULL,
    [BatchName] NVARCHAR(50) NOT NULL,
    [DisplayName] NVARCHAR(200) NULL,
    [TemplateName] NVARCHAR(100) NULL,
    [IsBlocked] BIT NOT NULL CONSTRAINT [DF_ErpGeneralJournalBatch_IsBlocked] DEFAULT ((0)),
    [IsActive] BIT NOT NULL CONSTRAINT [DF_ErpGeneralJournalBatch_IsActive] DEFAULT ((1)),
    [SyncedAt] DATETIME2(7) NOT NULL CONSTRAINT [DF_ErpGeneralJournalBatch_SyncedAt] DEFAULT (sysdatetime()),
    [RawJson] NVARCHAR(MAX) NULL,
    CONSTRAINT [PK_ErpGeneralJournalBatch] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [UQ_ErpGeneralJournalBatch] UNIQUE ([BrandCode], [BatchName])
  );

  IF OBJECT_ID('dbo.ErpBankAccountCard', 'U') IS NULL
  CREATE TABLE [dbo].[ErpBankAccountCard] (
    [Id] INT IDENTITY(1,1) NOT NULL,
    [BrandCode] NVARCHAR(20) NOT NULL,
    [BcCompanyId] NVARCHAR(50) NOT NULL,
    [BcCompanyName] NVARCHAR(200) NULL,
    [BcConnectionId] INT NOT NULL,
    [AccountNo] NVARCHAR(50) NOT NULL,
    [DisplayName] NVARCHAR(200) NULL,
    [BankName] NVARCHAR(200) NULL,
    [CurrencyCode] NVARCHAR(10) NULL,
    [IsBlocked] BIT NOT NULL CONSTRAINT [DF_ErpBankAccountCard_IsBlocked] DEFAULT ((0)),
    [IsActive] BIT NOT NULL CONSTRAINT [DF_ErpBankAccountCard_IsActive] DEFAULT ((1)),
    [SyncedAt] DATETIME2(7) NOT NULL CONSTRAINT [DF_ErpBankAccountCard_SyncedAt] DEFAULT (sysdatetime()),
    [RawJson] NVARCHAR(MAX) NULL,
    CONSTRAINT [PK_ErpBankAccountCard] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [UQ_ErpBankAccountCard] UNIQUE ([BrandCode], [AccountNo])
  );

  IF OBJECT_ID('dbo.ErpSyncLog', 'U') IS NULL
  CREATE TABLE [dbo].[ErpSyncLog] (
    [Id] INT IDENTITY(1,1) NOT NULL,
    [SyncType] NVARCHAR(50) NOT NULL,
    [BrandCode] NVARCHAR(20) NOT NULL,
    [Status] NVARCHAR(20) NOT NULL,
    [RowsUpserted] INT NOT NULL CONSTRAINT [DF_ErpSyncLog_RowsUpserted] DEFAULT ((0)),
    [ErrorMessage] NVARCHAR(MAX) NULL,
    [StartedAt] DATETIME2(7) NOT NULL CONSTRAINT [DF_ErpSyncLog_StartedAt] DEFAULT (sysdatetime()),
    [FinishedAt] DATETIME2(7) NULL,
    [TriggeredBy] INT NULL,
    CONSTRAINT [PK_ErpSyncLog] PRIMARY KEY CLUSTERED ([Id])
  );

  COMMIT TRANSACTION;
  PRINT 'Batch 1: the five tables exist in Rocks_ERP_Data.';
END
GO

SET NOCOUNT ON;

-- The non-unique lookup indexes, separately so a partial batch 1 is repairable.
IF DB_NAME() <> N'Rocks_ERP_Data'
BEGIN
  DECLARE @wrongDb2 NVARCHAR(128) = DB_NAME();
  RAISERROR ('Migration 101 may only be applied to Rocks_ERP_Data. Current database is %s.', 16, 1, @wrongDb2);
END
ELSE
BEGIN
  IF OBJECT_ID('dbo.ErpAccounts', 'U') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ErpAccounts_BrandCategory' AND object_id = OBJECT_ID('dbo.ErpAccounts'))
    CREATE INDEX [IX_ErpAccounts_BrandCategory] ON [dbo].[ErpAccounts] ([BrandCode], [AccountCategory])
      INCLUDE ([AccountNo], [DisplayName], [IsActive], [IsBlocked]);

  IF OBJECT_ID('dbo.ErpDimensionValue', 'U') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ErpDimensionValue_BrandDim' AND object_id = OBJECT_ID('dbo.ErpDimensionValue'))
    CREATE INDEX [IX_ErpDimensionValue_BrandDim] ON [dbo].[ErpDimensionValue] ([BrandCode], [DimensionCode])
      INCLUDE ([Code], [DisplayName], [IsActive]);

  IF OBJECT_ID('dbo.ErpGeneralJournalBatch', 'U') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ErpGeneralJournalBatch_Brand' AND object_id = OBJECT_ID('dbo.ErpGeneralJournalBatch'))
    CREATE INDEX [IX_ErpGeneralJournalBatch_Brand] ON [dbo].[ErpGeneralJournalBatch] ([BrandCode])
      INCLUDE ([BatchName], [DisplayName], [IsActive], [IsBlocked]);

  IF OBJECT_ID('dbo.ErpBankAccountCard', 'U') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ErpBankAccountCard_Brand' AND object_id = OBJECT_ID('dbo.ErpBankAccountCard'))
    CREATE INDEX [IX_ErpBankAccountCard_Brand] ON [dbo].[ErpBankAccountCard] ([BrandCode])
      INCLUDE ([AccountNo], [DisplayName], [IsActive], [IsBlocked]);

  IF OBJECT_ID('dbo.ErpSyncLog', 'U') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ErpSyncLog_BrandStarted' AND object_id = OBJECT_ID('dbo.ErpSyncLog'))
    CREATE INDEX [IX_ErpSyncLog_BrandStarted] ON [dbo].[ErpSyncLog] ([BrandCode], [StartedAt] DESC);

  PRINT 'Batch 2: lookup indexes present.';
END
GO

SET NOCOUNT ON;

-- The id-keyed top-up. Reads Fast_Data three-part, so it only works while
-- Fast_Data still holds real tables -- after 102 they are synonyms pointing
-- back here, and OBJECT_ID(..., 'U') is NULL for a synonym.
IF DB_NAME() <> N'Rocks_ERP_Data'
BEGIN
  DECLARE @wrongDb3 NVARCHAR(128) = DB_NAME();
  RAISERROR ('Migration 101 may only be applied to Rocks_ERP_Data. Current database is %s.', 16, 1, @wrongDb3);
END
ELSE IF OBJECT_ID('[Fast_Data].[dbo].[ErpAccounts]', 'U') IS NULL
BEGIN
  RAISERROR (
    'Migration 101 batch 3: [Fast_Data].[dbo].[ErpAccounts] is not a table. If migration 102 has already run it is a synonym pointing back here, and there is nothing to copy.',
    16, 1
  );
END
ELSE
BEGIN
  SET XACT_ABORT ON;
  BEGIN TRANSACTION;

  SET IDENTITY_INSERT [dbo].[ErpAccounts] ON;
  INSERT INTO [dbo].[ErpAccounts]
    ([Id],[BrandCode],[BcCompanyId],[BcConnectionId],[AccountCategory],[AccountNo],
     [DisplayName],[BcCategory],[IsBlocked],[IsActive],[SyncedAt],[RawJson])
  SELECT s.[Id],s.[BrandCode],s.[BcCompanyId],s.[BcConnectionId],s.[AccountCategory],s.[AccountNo],
         s.[DisplayName],s.[BcCategory],s.[IsBlocked],s.[IsActive],s.[SyncedAt],s.[RawJson]
  FROM [Fast_Data].[dbo].[ErpAccounts] s
  WHERE NOT EXISTS (SELECT 1 FROM [dbo].[ErpAccounts] t WHERE t.[Id] = s.[Id]);
  SET IDENTITY_INSERT [dbo].[ErpAccounts] OFF;

  SET IDENTITY_INSERT [dbo].[ErpDimensionValue] ON;
  INSERT INTO [dbo].[ErpDimensionValue]
    ([Id],[BrandCode],[DimensionCode],[Code],[DisplayName],[IsBlocked],[IsActive],
     [BcLastModified],[SyncedAt],[RawJson])
  SELECT s.[Id],s.[BrandCode],s.[DimensionCode],s.[Code],s.[DisplayName],s.[IsBlocked],s.[IsActive],
         s.[BcLastModified],s.[SyncedAt],s.[RawJson]
  FROM [Fast_Data].[dbo].[ErpDimensionValue] s
  WHERE NOT EXISTS (SELECT 1 FROM [dbo].[ErpDimensionValue] t WHERE t.[Id] = s.[Id]);
  SET IDENTITY_INSERT [dbo].[ErpDimensionValue] OFF;

  SET IDENTITY_INSERT [dbo].[ErpGeneralJournalBatch] ON;
  INSERT INTO [dbo].[ErpGeneralJournalBatch]
    ([Id],[BrandCode],[BcCompanyId],[BcCompanyName],[BcConnectionId],[BatchName],
     [DisplayName],[TemplateName],[IsBlocked],[IsActive],[SyncedAt],[RawJson])
  SELECT s.[Id],s.[BrandCode],s.[BcCompanyId],s.[BcCompanyName],s.[BcConnectionId],s.[BatchName],
         s.[DisplayName],s.[TemplateName],s.[IsBlocked],s.[IsActive],s.[SyncedAt],s.[RawJson]
  FROM [Fast_Data].[dbo].[ErpGeneralJournalBatch] s
  WHERE NOT EXISTS (SELECT 1 FROM [dbo].[ErpGeneralJournalBatch] t WHERE t.[Id] = s.[Id]);
  SET IDENTITY_INSERT [dbo].[ErpGeneralJournalBatch] OFF;

  SET IDENTITY_INSERT [dbo].[ErpBankAccountCard] ON;
  INSERT INTO [dbo].[ErpBankAccountCard]
    ([Id],[BrandCode],[BcCompanyId],[BcCompanyName],[BcConnectionId],[AccountNo],
     [DisplayName],[BankName],[CurrencyCode],[IsBlocked],[IsActive],[SyncedAt],[RawJson])
  SELECT s.[Id],s.[BrandCode],s.[BcCompanyId],s.[BcCompanyName],s.[BcConnectionId],s.[AccountNo],
         s.[DisplayName],s.[BankName],s.[CurrencyCode],s.[IsBlocked],s.[IsActive],s.[SyncedAt],s.[RawJson]
  FROM [Fast_Data].[dbo].[ErpBankAccountCard] s
  WHERE NOT EXISTS (SELECT 1 FROM [dbo].[ErpBankAccountCard] t WHERE t.[Id] = s.[Id]);
  SET IDENTITY_INSERT [dbo].[ErpBankAccountCard] OFF;

  SET IDENTITY_INSERT [dbo].[ErpSyncLog] ON;
  INSERT INTO [dbo].[ErpSyncLog]
    ([Id],[SyncType],[BrandCode],[Status],[RowsUpserted],[ErrorMessage],
     [StartedAt],[FinishedAt],[TriggeredBy])
  SELECT s.[Id],s.[SyncType],s.[BrandCode],s.[Status],s.[RowsUpserted],s.[ErrorMessage],
         s.[StartedAt],s.[FinishedAt],s.[TriggeredBy]
  FROM [Fast_Data].[dbo].[ErpSyncLog] s
  WHERE NOT EXISTS (SELECT 1 FROM [dbo].[ErpSyncLog] t WHERE t.[Id] = s.[Id]);
  SET IDENTITY_INSERT [dbo].[ErpSyncLog] OFF;

  COMMIT TRANSACTION;
  PRINT 'Batch 3: rows topped up from Fast_Data with their ids preserved.';
END
GO

SET NOCOUNT ON;

-- Reseed outside a transaction: DBCC CHECKIDENT is not transactional. Each
-- target is the source's IDENT_CURRENT as measured 2026-08-21; the guard means
-- a re-run after later inserts never rewinds.
IF DB_NAME() = N'Rocks_ERP_Data'
BEGIN
  IF OBJECT_ID('dbo.ErpAccounts', 'U') IS NOT NULL AND IDENT_CURRENT('dbo.ErpAccounts') < 4793
    DBCC CHECKIDENT ('dbo.ErpAccounts', RESEED, 4793);
  IF OBJECT_ID('dbo.ErpDimensionValue', 'U') IS NOT NULL AND IDENT_CURRENT('dbo.ErpDimensionValue') < 806
    DBCC CHECKIDENT ('dbo.ErpDimensionValue', RESEED, 806);
  IF OBJECT_ID('dbo.ErpGeneralJournalBatch', 'U') IS NOT NULL AND IDENT_CURRENT('dbo.ErpGeneralJournalBatch') < 174
    DBCC CHECKIDENT ('dbo.ErpGeneralJournalBatch', RESEED, 174);
  IF OBJECT_ID('dbo.ErpBankAccountCard', 'U') IS NOT NULL AND IDENT_CURRENT('dbo.ErpBankAccountCard') < 64
    DBCC CHECKIDENT ('dbo.ErpBankAccountCard', RESEED, 64);
  IF OBJECT_ID('dbo.ErpSyncLog', 'U') IS NOT NULL AND IDENT_CURRENT('dbo.ErpSyncLog') < 21
    DBCC CHECKIDENT ('dbo.ErpSyncLog', RESEED, 21);
  PRINT 'Batch 4: identities reseeded.';
END
GO
```

- [ ] **Step 2: Write migration 102**

Create `migrations/102_fast_data_erp_synonyms.sql`.

```sql
-- The five Fast_Data sync tables become synonyms for the Rocks_ERP_Data copies.
--
-- Apply with (Fast_Data ONLY, and ONLY AFTER migration 101):
--   npm run apply-sql -- --db Fast_Data --file migrations/102_fast_data_erp_synonyms.sql
--
-- ---------------------------------------------------------------------------
-- THIS MIGRATION DESTROYS THE ONLY COPY OF 5,858 ROWS IF 101 HAS NOT RUN.
--
-- Everything before the DROPs is the guard. Per table, inside the transaction
-- that does the dropping: the target must exist as a table, the row counts must
-- match, and the contents must match. The source counts are taken under
-- TABLOCKX, which is held to the end of the transaction, so no sibling can
-- insert between the count and the drop.
--
-- WHAT THE CONTENT CHECK DOES AND DOES NOT PROVE. Every one of the five has an
-- nvarchar(MAX) column -- RawJson on four, ErrorMessage on ErpSyncLog. Dragging
-- 4,793 JSON payloads through a set comparison while holding an exclusive lock
-- on tables three applications write is the wrong trade, so the EXCEPT compares
-- every NON-LOB column plus DATALENGTH of the LOB. A payload edited to exactly
-- the same byte length would pass. That is a deliberate weakening and it is
-- stated here rather than described as a whole-row check.
--
-- Why a synonym rather than editing the siblings: all three applications name
-- these tables two-part, [dbo].[ErpAccounts] and so on, on a pool opened
-- against Fast_Data, and every statement is DML -- INSERT, MERGE, UPDATE,
-- SELECT. A synonym resolves all of them. Notably there is no TRUNCATE
-- anywhere, which is the one common statement it would not resolve. Both
-- databases are on the same SQL Server instance, so a sibling transaction that
-- now spans two databases stays local; MSDTC is involved only across instances.
--
-- The synonyms are permanent, not a migration aid.
-- ---------------------------------------------------------------------------

SET NOCOUNT ON;

IF DB_NAME() <> N'Fast_Data'
BEGIN
  DECLARE @wrongDb NVARCHAR(128) = DB_NAME();
  RAISERROR ('Migration 102 may only be applied to Fast_Data. Current database is %s.', 16, 1, @wrongDb);
END
ELSE IF OBJECT_ID('dbo.ErpAccounts', 'SN') IS NOT NULL
BEGIN
  PRINT 'dbo.ErpAccounts is already a synonym -- migration 102 has already run.';
END
ELSE IF OBJECT_ID('dbo.ErpAccounts', 'U') IS NULL
     OR OBJECT_ID('dbo.ErpDimensionValue', 'U') IS NULL
     OR OBJECT_ID('dbo.ErpGeneralJournalBatch', 'U') IS NULL
     OR OBJECT_ID('dbo.ErpBankAccountCard', 'U') IS NULL
     OR OBJECT_ID('dbo.ErpSyncLog', 'U') IS NULL
BEGIN
  RAISERROR ('Migration 102: not all five tables are present as tables in Fast_Data. Refusing to guess.', 16, 1);
END
ELSE IF OBJECT_ID('[Rocks_ERP_Data].[dbo].[ErpAccounts]', 'U') IS NULL
     OR OBJECT_ID('[Rocks_ERP_Data].[dbo].[ErpDimensionValue]', 'U') IS NULL
     OR OBJECT_ID('[Rocks_ERP_Data].[dbo].[ErpGeneralJournalBatch]', 'U') IS NULL
     OR OBJECT_ID('[Rocks_ERP_Data].[dbo].[ErpBankAccountCard]', 'U') IS NULL
     OR OBJECT_ID('[Rocks_ERP_Data].[dbo].[ErpSyncLog]', 'U') IS NULL
BEGIN
  RAISERROR ('Migration 102: not all five tables exist in Rocks_ERP_Data. Run migration 101 first. Refusing to drop the only copy of the data.', 16, 1);
END
ELSE
BEGIN
  -- A clean server-side error the server rolls back, rather than a client
  -- attention at node-mssql's 15s default requestTimeout -- an attention
  -- cancels the statement without rolling the transaction back, and
  -- XACT_ABORT does not cover it.
  SET LOCK_TIMEOUT 5000;
  SET XACT_ABORT ON;
  BEGIN TRANSACTION;

  DECLARE @problem NVARCHAR(400) = NULL;

  IF @problem IS NULL AND (SELECT COUNT(*) FROM [dbo].[ErpAccounts] WITH (TABLOCKX))
                       <> (SELECT COUNT(*) FROM [Rocks_ERP_Data].[dbo].[ErpAccounts])
    SET @problem = 'ErpAccounts row counts differ';
  IF @problem IS NULL AND (SELECT COUNT(*) FROM [dbo].[ErpDimensionValue] WITH (TABLOCKX))
                       <> (SELECT COUNT(*) FROM [Rocks_ERP_Data].[dbo].[ErpDimensionValue])
    SET @problem = 'ErpDimensionValue row counts differ';
  IF @problem IS NULL AND (SELECT COUNT(*) FROM [dbo].[ErpGeneralJournalBatch] WITH (TABLOCKX))
                       <> (SELECT COUNT(*) FROM [Rocks_ERP_Data].[dbo].[ErpGeneralJournalBatch])
    SET @problem = 'ErpGeneralJournalBatch row counts differ';
  IF @problem IS NULL AND (SELECT COUNT(*) FROM [dbo].[ErpBankAccountCard] WITH (TABLOCKX))
                       <> (SELECT COUNT(*) FROM [Rocks_ERP_Data].[dbo].[ErpBankAccountCard])
    SET @problem = 'ErpBankAccountCard row counts differ';
  IF @problem IS NULL AND (SELECT COUNT(*) FROM [dbo].[ErpSyncLog] WITH (TABLOCKX))
                       <> (SELECT COUNT(*) FROM [Rocks_ERP_Data].[dbo].[ErpSyncLog])
    SET @problem = 'ErpSyncLog row counts differ';

  IF @problem IS NULL AND EXISTS (
    SELECT [Id],[BrandCode],[BcCompanyId],[BcConnectionId],[AccountCategory],[AccountNo],
           [DisplayName],[BcCategory],[IsBlocked],[IsActive],[SyncedAt],DATALENGTH([RawJson])
    FROM [dbo].[ErpAccounts]
    EXCEPT
    SELECT [Id],[BrandCode],[BcCompanyId],[BcConnectionId],[AccountCategory],[AccountNo],
           [DisplayName],[BcCategory],[IsBlocked],[IsActive],[SyncedAt],DATALENGTH([RawJson])
    FROM [Rocks_ERP_Data].[dbo].[ErpAccounts])
    SET @problem = 'ErpAccounts contents differ';

  IF @problem IS NULL AND EXISTS (
    SELECT [Id],[BrandCode],[DimensionCode],[Code],[DisplayName],[IsBlocked],[IsActive],
           [BcLastModified],[SyncedAt],DATALENGTH([RawJson])
    FROM [dbo].[ErpDimensionValue]
    EXCEPT
    SELECT [Id],[BrandCode],[DimensionCode],[Code],[DisplayName],[IsBlocked],[IsActive],
           [BcLastModified],[SyncedAt],DATALENGTH([RawJson])
    FROM [Rocks_ERP_Data].[dbo].[ErpDimensionValue])
    SET @problem = 'ErpDimensionValue contents differ';

  IF @problem IS NULL AND EXISTS (
    SELECT [Id],[BrandCode],[BcCompanyId],[BcCompanyName],[BcConnectionId],[BatchName],
           [DisplayName],[TemplateName],[IsBlocked],[IsActive],[SyncedAt],DATALENGTH([RawJson])
    FROM [dbo].[ErpGeneralJournalBatch]
    EXCEPT
    SELECT [Id],[BrandCode],[BcCompanyId],[BcCompanyName],[BcConnectionId],[BatchName],
           [DisplayName],[TemplateName],[IsBlocked],[IsActive],[SyncedAt],DATALENGTH([RawJson])
    FROM [Rocks_ERP_Data].[dbo].[ErpGeneralJournalBatch])
    SET @problem = 'ErpGeneralJournalBatch contents differ';

  IF @problem IS NULL AND EXISTS (
    SELECT [Id],[BrandCode],[BcCompanyId],[BcCompanyName],[BcConnectionId],[AccountNo],
           [DisplayName],[BankName],[CurrencyCode],[IsBlocked],[IsActive],[SyncedAt],DATALENGTH([RawJson])
    FROM [dbo].[ErpBankAccountCard]
    EXCEPT
    SELECT [Id],[BrandCode],[BcCompanyId],[BcCompanyName],[BcConnectionId],[AccountNo],
           [DisplayName],[BankName],[CurrencyCode],[IsBlocked],[IsActive],[SyncedAt],DATALENGTH([RawJson])
    FROM [Rocks_ERP_Data].[dbo].[ErpBankAccountCard])
    SET @problem = 'ErpBankAccountCard contents differ';

  IF @problem IS NULL AND EXISTS (
    SELECT [Id],[SyncType],[BrandCode],[Status],[RowsUpserted],[StartedAt],[FinishedAt],
           [TriggeredBy],DATALENGTH([ErrorMessage])
    FROM [dbo].[ErpSyncLog]
    EXCEPT
    SELECT [Id],[SyncType],[BrandCode],[Status],[RowsUpserted],[StartedAt],[FinishedAt],
           [TriggeredBy],DATALENGTH([ErrorMessage])
    FROM [Rocks_ERP_Data].[dbo].[ErpSyncLog])
    SET @problem = 'ErpSyncLog contents differ';

  IF @problem IS NOT NULL
  BEGIN
    ROLLBACK TRANSACTION;
    RAISERROR (
      'Migration 102 refuses to drop: %s. The likeliest cause is a sync run between 101 and 102. Re-run 101 (its batch 3 tops up by id), then retry this.',
      16, 1, @problem
    );
  END
  ELSE
  BEGIN
    DROP TABLE [dbo].[ErpAccounts];
    DROP TABLE [dbo].[ErpDimensionValue];
    DROP TABLE [dbo].[ErpGeneralJournalBatch];
    DROP TABLE [dbo].[ErpBankAccountCard];
    DROP TABLE [dbo].[ErpSyncLog];

    CREATE SYNONYM [dbo].[ErpAccounts]            FOR [Rocks_ERP_Data].[dbo].[ErpAccounts];
    CREATE SYNONYM [dbo].[ErpDimensionValue]      FOR [Rocks_ERP_Data].[dbo].[ErpDimensionValue];
    CREATE SYNONYM [dbo].[ErpGeneralJournalBatch] FOR [Rocks_ERP_Data].[dbo].[ErpGeneralJournalBatch];
    CREATE SYNONYM [dbo].[ErpBankAccountCard]     FOR [Rocks_ERP_Data].[dbo].[ErpBankAccountCard];
    CREATE SYNONYM [dbo].[ErpSyncLog]             FOR [Rocks_ERP_Data].[dbo].[ErpSyncLog];

    COMMIT TRANSACTION;
    PRINT 'Fast_Data now reaches the five ERP sync tables in Rocks_ERP_Data by synonym.';
  END
END
GO
```

- [ ] **Step 3: Write the verification script**

Create `scripts/checks/verify-erp-data-move.ts`. Follow `scripts/checks/verify-059.ts`'s convention exactly: `/* eslint-disable no-console */`, its `loadDotEnvLocal()` helper copied verbatim, and pools imported by **relative** path (`../../src/lib/db/mssql`), not the `@/` alias.

**Bracket every column alias.** `scripts/checks/verify-department-erp-map-move.ts` shipped with `AS rowCount` unbracketed, `ROWCOUNT` is a reserved T-SQL keyword, and the whole batch was a syntax error — reviewed twice and never run, because `tsc` and `npm test` do not execute it.

```ts
const EXPECTED = [
  { table: "ErpAccounts", rows: 4793, ident: 4793,
    indexes: ["IX_ErpAccounts_BrandCategory", "PK_ErpAccounts", "UQ_ErpAccounts"] },
  { table: "ErpDimensionValue", rows: 806, ident: 806,
    indexes: ["IX_ErpDimensionValue_BrandDim", "PK_ErpDimensionValue", "UQ_ErpDimensionValue"] },
  { table: "ErpGeneralJournalBatch", rows: 174, ident: 174,
    indexes: ["IX_ErpGeneralJournalBatch_Brand", "PK_ErpGeneralJournalBatch", "UQ_ErpGeneralJournalBatch"] },
  { table: "ErpBankAccountCard", rows: 64, ident: 64,
    indexes: ["IX_ErpBankAccountCard_Brand", "PK_ErpBankAccountCard", "UQ_ErpBankAccountCard"] },
  { table: "ErpSyncLog", rows: 21, ident: 21,
    indexes: ["IX_ErpSyncLog_BrandStarted", "PK_ErpSyncLog"] },
];

async function main() {
  loadDotEnvLocal();
  const { getDataPool, getAppPool } = await import("../../src/lib/db/mssql");
  const data = await getDataPool();
  const erp = await getAppPool("Rocks_ERP_Data");
  const problems: string[] = [];

  for (const e of EXPECTED) {
    // 1. the table, its rows, its identity
    const r = await erp.request().query(`
      SELECT OBJECT_ID('dbo.${e.table}', 'U') AS [tableId],
             (SELECT COUNT(*) FROM [dbo].[${e.table}]) AS [rowCnt],
             IDENT_CURRENT('dbo.${e.table}') AS [identCur];`);
    const row = r.recordset[0];
    if (row.tableId === null) problems.push(`${e.table}: not a table in Rocks_ERP_Data`);
    if (row.rowCnt !== e.rows) problems.push(`${e.table}: ${row.rowCnt} rows, expected ${e.rows}`);
    if (Number(row.identCur) !== e.ident) problems.push(`${e.table}: IDENT_CURRENT ${row.identCur}, expected ${e.ident}`);

    // the indexes, by name
    const idx = await erp.request().query(`
      SELECT name FROM sys.indexes
      WHERE object_id = OBJECT_ID('dbo.${e.table}') AND type > 0 ORDER BY name;`);
    const got = idx.recordset.map((x: { name: string }) => x.name).join(",");
    if (got !== e.indexes.join(",")) problems.push(`${e.table}: indexes are ${got}, expected ${e.indexes.join(",")}`);

    // 2. the Fast_Data object is a synonym pointing at the new home
    const syn = await data.request().query(`
      SELECT base_object_name AS [base] FROM sys.synonyms WHERE name = '${e.table}';`);
    if (syn.recordset.length !== 1) {
      problems.push(`${e.table}: Fast_Data has no synonym of that name`);
    } else {
      const base = String(syn.recordset[0].base);
      if (base.indexOf("Rocks_ERP_Data") < 0 || base.indexOf(e.table) < 0) {
        problems.push(`${e.table}: synonym points at ${base}`);
      }
    }

    // 3. a read through the synonym sees the same rows
    const thru = await data.request().query(`SELECT COUNT(*) AS [n] FROM [dbo].[${e.table}];`);
    if (thru.recordset[0].n !== e.rows) {
      problems.push(`${e.table}: read through the synonym returned ${thru.recordset[0].n}, expected ${e.rows}`);
    }
  }

  // 4. a WRITE through a synonym succeeds. This is the siblings' cross-database
  //    permission, which would otherwise be discovered the next time either app
  //    ran a sync. MERGE, because that is the shape all three actually use.
  //    Rolled back, so no data moves.
  const tx = data.transaction();
  await tx.begin();
  try {
    const w = await tx.request().query(`
      MERGE [dbo].[ErpSyncLog] AS t
      USING (SELECT TOP (1) [Id] FROM [dbo].[ErpSyncLog] ORDER BY [Id]) AS s
        ON t.[Id] = s.[Id]
      WHEN MATCHED THEN UPDATE SET t.[Status] = t.[Status];`);
    if (!w.rowsAffected[0]) problems.push("write through the ErpSyncLog synonym affected no rows");
  } catch (err) {
    problems.push(`write through the synonym failed: ${(err as Error).message}`);
  } finally {
    await tx.rollback();
  }

  // 5. Fast_Data still holds what it is supposed to hold. The move must not
  //    have reached anything outside its five.
  const tp = await data.request().query(`SELECT OBJECT_ID('dbo.TravelProvince', 'U') AS [oid];`);
  if (tp.recordset[0].oid === null) problems.push("Fast_Data.dbo.TravelProvince is no longer a table");

  if (problems.length) {
    console.error("FAIL");
    for (const p of problems) console.error("  - " + p);
    process.exit(1);
  }
  console.log("OK: the five ERP sync tables live in Rocks_ERP_Data and Fast_Data reaches them by synonym");
  process.exit(0);
}
```

- [ ] **Step 4: Add the npm script**

In `package.json`, the `scripts` block currently ends:

```json
    "check:dept-map-home": "tsx scripts/checks/verify-department-erp-map-move.ts"
```

Make it:

```json
    "check:dept-map-home": "tsx scripts/checks/verify-department-erp-map-move.ts",
    "check:erp-data-home": "tsx scripts/checks/verify-erp-data-move.ts"
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: no errors under `src/` or `scripts/`.

Run: `npm test`
Expected: `pass 285, fail 0`. This task adds no unit test — the migrations are SQL and the check script talks to live databases, neither of which `npm test` covers. The check script *is* the test, and Task 2 runs it.

- [ ] **Step 6: Commit**

```bash
git add migrations/101_erp_data_sync_tables.sql migrations/102_fast_data_erp_synonyms.sql scripts/checks/verify-erp-data-move.ts package.json
git commit -m "feat(db): migrations to move the ERP sync tables into Rocks_ERP_Data"
```

---

### Task 2: Apply the migrations and capture the proof

**Files:**
- Create: `docs/reviews/2026-08-21-erp-data-move-verification.md`

**Interfaces:**
- Consumes: `migrations/101_…sql`, `migrations/102_…sql`, `npm run check:erp-data-home` from Task 1.
- Produces: the move itself, in the live databases. Task 3 depends on the five tables existing in `Rocks_ERP_Data`.

**This is the irreversible task.**

- [ ] **Step 1: Confirm no sync is running, and snapshot the row counts**

All three applications write these tables. Write `<scratch>/erp-snapshot.ts`:

```ts
import fs from "node:fs";
import { getDataPool } from "@/lib/db/mssql";

const FIVE = ["ErpAccounts","ErpDimensionValue","ErpGeneralJournalBatch","ErpBankAccountCard","ErpSyncLog"];

async function main() {
  const pool = await getDataPool();
  const counts: Record<string, number> = {};
  for (const t of FIVE) {
    const r = await pool.request().query(`SELECT COUNT(*) AS [n] FROM [dbo].[${t}];`);
    counts[t] = r.recordset[0].n;
  }
  console.log("counts:", JSON.stringify(counts));
  const recent = await pool.request().query(`
    SELECT TOP (3) [Id],[SyncType],[BrandCode],[Status],[StartedAt],[FinishedAt]
    FROM [dbo].[ErpSyncLog] ORDER BY [StartedAt] DESC;`);
  console.log("most recent sync runs:", JSON.stringify(recent.recordset));
  const unfinished = await pool.request().query(`
    SELECT COUNT(*) AS [n] FROM [dbo].[ErpSyncLog] WHERE [FinishedAt] IS NULL;`);
  console.log("unfinished sync runs:", unfinished.recordset[0].n);
  fs.writeFileSync("<scratch>/erp-snapshot.json", JSON.stringify(counts, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
```

Run: `npx tsx --env-file=.env.local <scratch>/erp-snapshot.ts`

Expected: `{"ErpAccounts":4793,"ErpDimensionValue":806,"ErpGeneralJournalBatch":174,"ErpBankAccountCard":64,"ErpSyncLog":21}` and **`unfinished sync runs: 0`**.

If `unfinished` is not 0, **stop and report BLOCKED** — a sync is in flight and 102 will refuse. If the counts differ from the expected ones, that is fine and expected if a sync has run since 2026-08-21: record the new numbers, use them for the rest of the task, and say so in your report. **The identity values in migration 101's batch 4 are floors guarded by `<`, so a higher count does not break them.**

- [ ] **Step 2: Apply 101 to `Rocks_ERP_Data`**

Run: `npm run apply-sql -- --db Rocks_ERP_Data --file migrations/101_erp_data_sync_tables.sql`

Expected: four `PRINT` lines, or none — `apply-sql` attaches no `info` handler, so `PRINT` output may not surface. Judge by exit code 0 and by Step 3.

- [ ] **Step 3: Confirm the copy landed before dropping anything**

Write `<scratch>/erp-confirm.ts`:

```ts
import { getAppPool } from "@/lib/db/mssql";

const FIVE = ["ErpAccounts","ErpDimensionValue","ErpGeneralJournalBatch","ErpBankAccountCard","ErpSyncLog"];

async function main() {
  const pool = await getAppPool("Rocks_ERP_Data");
  for (const t of FIVE) {
    const r = await pool.request().query(`
      SELECT COUNT(*) AS [n], IDENT_CURRENT('dbo.${t}') AS [cur] FROM [dbo].[${t}];`);
    console.log(t, JSON.stringify(r.recordset[0]));
  }
  process.exit(0);
}
main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
```

Run: `npx tsx --env-file=.env.local <scratch>/erp-confirm.ts`

Expected: each table's `n` equals the count from Step 1 and `cur` is at least that. **If any count is short, stop** — 102 would refuse anyway, but do not rely on that.

- [ ] **Step 4: Apply 102 to `Fast_Data`**

Run: `npm run apply-sql -- --db Fast_Data --file migrations/102_fast_data_erp_synonyms.sql`

Expected: exit code 0.

If it fails with `refuses to drop: <table> row counts differ` or `contents differ`, a sync ran during the window. That is the guard working. Re-run Step 2 (101 tops up by id), then this step. Record that it happened.

- [ ] **Step 5: Run the verification**

Run: `npm run check:erp-data-home`
Expected: `OK: the five ERP sync tables live in Rocks_ERP_Data and Fast_Data reaches them by synonym`

If the counts moved in Step 1, the script's `EXPECTED` table needs those numbers — update it, and say so in your report. Do not proceed to Task 3 with a failing verification.

- [ ] **Step 6: Confirm the previous move is undisturbed**

Run: `npm run check:dept-map-home`
Expected: `OK: DepartmentErpMap lives in Rocks_Portal_Form and Fast_Core reaches it by synonym`

Run: `npm run check:alignment`
Expected: unchanged from before this task — one `AccFormBrand` row, `KSI`/`AP-11`, `Id` 1014 production against 1019 UAT. No new table appears; these five are not in `MASTER_TABLES`.

- [ ] **Step 7: Write the verification record and commit**

Create `docs/reviews/2026-08-21-erp-data-move-verification.md` containing: the date, every command as run with its output verbatim, the before/after counts, whether the guard refused at any point and why, and the three check commands' output. Open with one paragraph saying what moved, that the synonyms are permanent, and what the content guard does and does not prove.

```bash
git add docs/reviews/2026-08-21-erp-data-move-verification.md
git commit -m "docs: record the ERP sync table move against the live databases"
```

---

### Task 3: Give this app its own pool and point the sync at it

**Files:**
- Modify: `src/env.ts` (schema around `:13`, mapping around `:48`)
- Modify: `src/lib/db/mssql.ts` (after `getDataPool()`, around `:103`)
- Modify: `.env.local`, `.env.example`
- Modify: `src/lib/erp/account-sync.ts`, `src/lib/erp/dimension-sync.ts`, `src/lib/acc/department-map-service.ts`

**Interfaces:**
- Consumes: the five tables in `Rocks_ERP_Data`, created by Task 2.
- Produces: `getErpDataPool(): Promise<sql.ConnectionPool>` exported from `src/lib/db/mssql.ts`. No other new exports; every function in the three modified modules keeps its name and signature.

- [ ] **Step 1: Add the environment variable**

In `src/env.ts`, the server schema currently reads:

```ts
    MSSQL_DATA_DATABASE: z.string().default("Fast_Data"),
```

Add beneath it:

```ts
    MSSQL_ERP_DATA_DATABASE: z.string().default("Rocks_ERP_Data"),
```

And in the `process.env` mapping, beneath `MSSQL_DATA_DATABASE: process.env.MSSQL_DATA_DATABASE,`:

```ts
    MSSQL_ERP_DATA_DATABASE: process.env.MSSQL_ERP_DATA_DATABASE,
```

In `.env.local` and `.env.example`, beneath the `MSSQL_DATA_DATABASE` line:

```
MSSQL_ERP_DATA_DATABASE=Rocks_ERP_Data
```

- [ ] **Step 2: Add the pool**

In `src/lib/db/mssql.ts`, `getDataPool()` currently reads:

```ts
/** Data DB — reports, dashboards, BI */
export function getDataPool(): Promise<sql.ConnectionPool> {
  return getNamedPool(env.MSSQL_DATA_DATABASE);
}
```

That comment is wrong and CLAUDE.md already says so — `Fast_Data` is not a BI database in this app. Replace the comment and add the new pool beneath:

```ts
/**
 * Fast_Data — AP-17 province lookups and the HR department lookups. Not a
 * BI or reporting database in this app, whatever the name suggests.
 *
 * The five Business Central sync tables are no longer here: migrations 101/102
 * moved them to Rocks_ERP_Data and left synonyms behind for the two sibling
 * applications. Use getErpDataPool() for those.
 */
export function getDataPool(): Promise<sql.ConnectionPool> {
  return getNamedPool(env.MSSQL_DATA_DATABASE);
}

/**
 * Rocks_ERP_Data — the mirror of Business Central: ErpAccounts,
 * ErpDimensionValue, ErpGeneralJournalBatch, ErpBankAccountCard and ErpSyncLog.
 *
 * Sync output only. The per-brand and per-form choices this app makes about
 * where money posts — AccBrandGlAccount, AccBrandJournalBatch and the rest —
 * stay in the form database and are reached through getFormPool().
 */
export function getErpDataPool(): Promise<sql.ConnectionPool> {
  return getNamedPool(env.MSSQL_ERP_DATA_DATABASE);
}
```

- [ ] **Step 3: Point the three modules at the new pool**

`src/lib/erp/account-sync.ts` and `src/lib/erp/dimension-sync.ts` reach `ErpAccounts`, `ErpBankAccountCard`, `ErpGeneralJournalBatch`, `ErpDimensionValue` and `ErpSyncLog`. Every `getDataPool()` call in those two files that serves a statement against one of those five becomes `getErpDataPool()`, and the imports change with them. Leave the two-part table names alone.

In `src/lib/acc/department-map-service.ts`, `loadErpDeptDisplayNamesByTargetBrand()` (around `:845`) opens `getDataPool()` and reads `[dbo].[ErpDimensionValue]`. That one call becomes `getErpDataPool()`. **Every other pool call in that file is `getProductionFormPool()` and must stay** — they read `DepartmentErpMap`, which migrations 099/100 moved to the form database and which is not moving again.

**Find each site by which table its SQL names, not by line number.** If any `getDataPool()` call in these files serves a statement against a table that is *not* one of the five, leave it and report it.

Add this comment above the first converted call in each of the two `erp/` files:

```ts
// The five Business Central sync tables moved to Rocks_ERP_Data in migrations
// 101/102; Fast_Data keeps synonyms for the two sibling applications. This app
// names the new home directly.
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: clean under `src/` and `scripts/`. If `getDataPool` is now unused in a file, remove it from that file's import; if `getErpDataPool` is undefined, the import is missing.

Run: `npm test`
Expected: `pass 285, fail 0`.

Run: `npm run check:erp-data-home`
Expected: still `OK`.

- [ ] **Step 5: Prove the sync modules read the new home**

The unit suite touches no database. Write `<scratch>/erp-probe.ts`:

```ts
import { listErpGlAccountOptions } from "@/lib/erp/account-sync";
import { loadErpDeptDisplayNamesByTargetBrand } from "@/lib/acc/department-map-service";

async function main() {
  const accounts = await listErpGlAccountOptions("PCTH");
  console.log("gl account options for PCTH:", accounts.length);
  const names = await loadErpDeptDisplayNamesByTargetBrand();
  console.log("dept display-name brands:", Array.from(names.keys()).join(",") || "(none)");
  process.exit(0);
}
main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
```

Run: `npx tsx --env-file=.env.local <scratch>/erp-probe.ts`

Expected: a non-zero count of G/L account options and at least one brand. If it throws `Invalid object name`, the pool switch is wrong or Task 2 did not complete. **If `listErpGlAccountOptions` takes different arguments than shown, read its signature and adapt — the point of the probe is that a real read reaches the new database, not the exact call.**

- [ ] **Step 6: Commit**

```bash
git add src/env.ts src/lib/db/mssql.ts src/lib/erp/account-sync.ts src/lib/erp/dimension-sync.ts src/lib/acc/department-map-service.ts .env.example
git commit -m "feat(erp): read the Business Central sync tables from Rocks_ERP_Data"
```

`.env.local` is gitignored — change it, do not commit it.

---

### Task 4: Update the documentation

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: nothing. Documentation only — **no executable line changes.**
- Produces: nothing.

- [ ] **Step 1: The architecture table**

`CLAUDE.md`'s 3-database table has a `Fast_Data` row whose purpose text names the ERP sync modules: `src/lib/erp/account-sync.ts` and `src/lib/erp/dimension-sync.ts`. Those no longer read `Fast_Data`. Correct that row to what `Fast_Data` still holds — the AP-17 province lookups (`src/lib/acc/travel-booking/province-service.ts`, `request-service.ts`) and the department maps — and add a new row for `Rocks_ERP_Data` / `getErpDataPool()` naming the five tables and saying `Fast_Data` reaches them by synonym for the two siblings.

Verify against the files before writing: open `src/lib/acc/department-map-service.ts` and confirm which of its reads are still on `getDataPool()` after Task 3.

- [ ] **Step 2: The environment block**

Add to the `Database` section of the env block, beneath `MSSQL_DATA_DATABASE`:

```
MSSQL_ERP_DATA_DATABASE=Rocks_ERP_Data          # BC sync mirror; Fast_Data keeps synonyms for the two siblings
```

- [ ] **Step 3: The Business Central section**

It says the sync logic in `src/lib/erp/account-sync.ts` and `src/lib/erp/dimension-sync.ts` "both query `Fast_Data`". They query `Rocks_ERP_Data` now. Correct it, and add a sentence drawing the line the spec's §1 records: data synced from Business Central lives in `Rocks_ERP_Data`; the per-brand and per-form choices about where money posts stay in the form database.

- [ ] **Step 4: A subsection recording the move**

Add a short subsection near the architecture table: what moved, that the synonyms are permanent and exist for Rocks Fast and ACC Portal, that there is one physical copy with no UAT twin, and **what migration 102's content guard does and does not prove** — non-LOB columns plus `DATALENGTH` of the LOB, so a payload edited to the same byte length would pass. Also note that a stood-up `Rocks_ERP_Data` needs migration 101, and that 101 cannot bootstrap once 102 has run, because its batch 3 raises when `OBJECT_ID('[Fast_Data].[dbo].[ErpAccounts]','U')` is NULL — which it is for a synonym.

**Check that last claim against `migrations/101_…sql` before writing it.**

- [ ] **Step 5: Verify and commit**

Run: `git diff --stat` — expected: `CLAUDE.md` only.
Run: `npx tsc --noEmit` and `npm test` — expected clean, `pass 285, fail 0`.

```bash
git add CLAUDE.md
git commit -m "docs: Rocks_ERP_Data, and the line between synced data and our own choices"
```

---

## Self-review

**Spec coverage.** §1 (why, and the line) — Task 1's migration 101 header, Task 3's `getErpDataPool()` doc comment, Task 4 Steps 3-4. §2 (measured state) — the plan's own measured-state block, consumed by Tasks 1 and 2; the unique-constraint and mixed-default-name findings are Task 1 Step 1's two stated departures; the "all five have a LOB" finding drives 102's guard. §3 (the shape, single copy) — Task 1 Step 1 and the Global Constraints; Task 2 Step 6 proves `MASTER_TABLES` is untouched. §4 (who reads it) — Task 3 Steps 2-3. §5 (cutover, guard, the sync-during-the-window risk) — Task 1 Step 2, Task 2 Steps 1 and 4. §6 (what else changes) — Task 3 Step 1 and all of Task 4. §7 (verification, all five assertions) — Task 1 Step 3 and Task 2 Steps 5-6. §8 (out of scope) — the Global Constraints name the five tables that must not move.

**Placeholder scan.** No TBD/TODO. Both migrations and the check script are written out in full. Task 3 Step 3 deliberately says "find each site by which table its SQL names" rather than listing line numbers, because the file moved under Task 3 of the previous plan and stale numbers are worse than a rule.

**Type consistency.** `getErpDataPool()` is named identically in Task 3 Steps 2, 3 and Task 4; `getAppPool(databaseName: string)` exists at `src/lib/db/mssql.ts:112` and is what the check script and the Task 2 probes use for `Rocks_ERP_Data`. The npm script `check:erp-data-home` is spelled the same in Task 1 Step 4, Task 2 Step 5 and Task 3 Step 4. The five table names and their index-name lists in the check script's `EXPECTED` match the `CREATE` statements in migration 101 exactly, including that `ErpSyncLog` has two indexes and the others three.

**One thing the plan deliberately leaves to the implementer.** Task 2 Step 1 allows the row counts to have moved since 2026-08-21 and says what to do about it, rather than hard-failing on numbers that a scheduled sync can legitimately change. The identity reseeds are floors guarded by `<`, so they tolerate it; the check script's `EXPECTED` does not, and the step says to update it.
