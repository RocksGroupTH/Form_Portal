-- The five Fast_Data sync tables become synonyms for the Rocks_ERP_Data copies.
--
-- Apply with (Fast_Data ONLY, and ONLY AFTER migration 101):
--   npm run apply-sql -- --db Fast_Data --file migrations/102_fast_data_erp_synonyms.sql
--
-- ---------------------------------------------------------------------------
-- THIS MIGRATION DESTROYS THE ONLY COPY OF THE DATA IF 101 HAS NOT RUN --
-- 5,858 rows as at 2026-08-21, and larger by the time this actually runs:
-- Business Central syncs land in these tables continuously, so do not chase
-- this number with a fresher one the next time this file is read.
--
-- Everything before the DROPs is the guard, and it runs in two stages. The
-- EXISTENCE checks -- that Fast_Data still holds all five as tables, not
-- already synonyms, and that Rocks_ERP_Data holds all five as tables -- run
-- first, as early-exit branches before BEGIN TRANSACTION even opens. Only
-- once those hold does the transaction that does the dropping begin, and
-- inside it: the row counts must match and the contents must match. The
-- source counts are taken under TABLOCKX, which is held to the end of the
-- transaction, so no sibling can insert between the count and the drop.
--
-- WHAT THE CONTENT CHECK DOES AND DOES NOT PROVE. Every one of the five has an
-- nvarchar(MAX) column -- RawJson on four, ErrorMessage on ErpSyncLog. Dragging
-- thousands of JSON payloads (4,793 as at 2026-08-21, and growing) through a
-- set comparison while holding an exclusive lock on tables a live sync writes
-- is the wrong trade, so the EXCEPT compares every NON-LOB column plus
-- DATALENGTH of the LOB. A payload edited to exactly the same byte length
-- would pass. That is a deliberate weakening and it is stated here rather
-- than described as a whole-row check.
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
  -- XACT_ABORT does not cover it. LOCK_TIMEOUT is per STATEMENT, and this
  -- transaction issues five separately-lockable TABLOCKX counts below, so
  -- five contended waits at the old 5000 ms could sum past the 15s per-batch
  -- requestTimeout on their own, producing the exact client attention this
  -- is meant to prevent. 2000 ms keeps five worst-case waits (10s) under that
  -- budget with room for the rest of the batch.
  SET LOCK_TIMEOUT 2000;
  SET XACT_ABORT ON;
  BEGIN TRANSACTION;

  DECLARE @problem NVARCHAR(400) = NULL;

  -- TABLOCKX is taken on the Fast_Data side only, not on the Rocks_ERP_Data
  -- side below -- deliberately, and NOT because the target is quiet.
  -- Fast_Data is the side this migration DESTROYS, so the lock is what stops
  -- a writer slipping a row in between this count and the DROP, where it
  -- would be lost with no trace. A row that lands in Rocks_ERP_Data during
  -- the window is not lost by anything here: it makes the guard disagree and
  -- refuse, which is the correct outcome.
  --
  -- BEFORE ANY FUTURE RUN OF THE 101/102 PAIR -- a fresh stand-up, a DR
  -- rebuild -- THE WINDOW MUST BE QUIET ON BOTH SIDES, and the two sides have
  -- different writers. Measured 2026-08-21 across the three checked-out
  -- repositories: RocksFast's src/lib/erp/{account,dimension}-sync.ts write
  -- these tables on getDataPool(), i.e. Fast_Data; ACC_Portal only reads them
  -- (erp-options-service.ts, department-map-service.ts, all SELECT); and THIS
  -- app's two sync modules write Rocks_ERP_Data directly through
  -- getErpDataPool(). This app is therefore exactly the writer the TABLOCKX
  -- above cannot reach.
  --
  -- That matters because a sync UPDATEs as well as INSERTs -- SyncedAt on
  -- every match, plus UPDATE ... SET IsActive = 0 for the rows BC stopped
  -- returning -- so an update-only run leaves the counts equal and trips
  -- 'contents differ' instead. Re-running 101 then overwrites those newer
  -- target rows with the older Fast_Data values, because its MERGE's
  -- WHEN MATCHED sets every column from the source. Stop the sync on both
  -- sides before starting, not just on Fast_Data.
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
    -- Two different failures, and only one of them has a mechanical remedy.
    -- Re-running 101 fixes a target that is BEHIND the source, because its
    -- batch 3 MERGEs new and changed rows in by id. It cannot fix a target
    -- that is AHEAD: that MERGE has no WHEN NOT MATCHED BY SOURCE (see 101's
    -- comment on batch 3 -- deleting rows unilaterally is exactly what this
    -- guard exists to prevent), so it inserts nothing, changes no count, and
    -- the operator loops. Say both, so nobody retries the wrong one.
    RAISERROR (
      'Migration 102 refuses to drop: %s. If Rocks_ERP_Data is BEHIND Fast_Data, or the contents differ, the likeliest cause is a sync run between 101 and 102: re-run 101 (its batch 3 is a MERGE that reconciles both new and changed rows by id), then retry this. If Rocks_ERP_Data holds MORE rows than Fast_Data, re-running 101 CANNOT fix it -- it has no WHEN NOT MATCHED BY SOURCE, so it inserts nothing and no count changes. Do not loop: that path needs a person to establish where the extra rows came from before anything is dropped.',
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
