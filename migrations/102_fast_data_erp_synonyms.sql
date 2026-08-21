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

  -- TABLOCKX is taken on the Fast_Data side only, not on the Rocks_ERP_Data
  -- side below -- deliberately, not an oversight. Fast_Data is the side that
  -- can move: ACC Portal, RocksFast and this app all write it continuously,
  -- so the lock is what stops one of them inserting between this count and
  -- the DROP. Nothing writes Rocks_ERP_Data at all until Task 3 repoints this
  -- app's code at it, and the two siblings never name that database, so
  -- there is nothing on that side for a lock to guard against yet.
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
