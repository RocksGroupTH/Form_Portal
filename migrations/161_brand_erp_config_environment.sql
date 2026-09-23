-- 161_brand_erp_config_environment.sql
-- Target: BOTH form databases — Rocks_Portal_Form AND Rocks_Portal_Form_UAT.
-- Apply to both BEFORE the code deploys.
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/161_brand_erp_config_environment.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/161_brand_erp_config_environment.sql
--
-- ---------------------------------------------------------------------------
-- WHAT THIS IS.
--
-- The four per-brand Interface ERP settings learn WHICH BUSINESS CENTRAL
-- ENVIRONMENT they were chosen for:
--
--   AccBrandJournalBatch   BatchName   -- a Journal Batch in one BC company
--   AccBrandGlAccount      AccountNo   -- an account in one company's chart
--   AccBrandBankAccount    AccountNo   -- a bank account card in one company
--   AccBrandBranchCode     BranchCode  -- a BRANCH dimension value in one company
--
-- ---------------------------------------------------------------------------
-- WHY. EVERY VALUE IN THESE TABLES IS THE NAME OF AN OBJECT IN ONE COMPANY.
--
-- The user, 2026-09-23: "เวลาส่ง interface ERP หรือ Setting ใช้ข้อมูลคนละชุดกัน
-- ข้อมูลไม่เท่ากันอาจจะทำให้ interface ERP ไม่สำเร็จ".
--
-- Measured the same day, all 31 rows: batch names TRAVELING and Q, accounts
-- 610301014 / 110723001, bank cards K-CA6999 / UOB-2726, branches HQ01 / RFM.
-- Not one of them is a value this application invented — each is a string that
-- must EXIST in the Business Central company the journal is posted into.
--
-- Until 2026-09-23 there was only ever one such company per brand, so one
-- stored value was right by construction. Splitting the BC mirror by
-- environment (migration 159) ended that: the LISTS these settings are chosen
-- from now differ per environment, while the CHOSEN value stayed shared. A
-- batch picked from Production's list may simply not exist in Sandbox — and the
-- failure lands at the moment somebody presses Send, not when they configure it.
--
-- ---------------------------------------------------------------------------
-- WHAT IS DELIBERATELY *NOT* SPLIT.
--
-- `AccBrandErpInterface` — claim brand -> interface target — is untouched. It
-- says which company a brand's claims post into, which is a decision about the
-- business rather than the name of an object inside a company. It is the same
-- answer in both environments, and giving it an environment would invite two
-- different org charts.
--
-- ---------------------------------------------------------------------------
-- THESE TABLES STAY DUAL-WRITTEN, AND THAT IS THE POINT OF DOING IT THIS WAY.
--
-- Both form databases keep IDENTICAL rows, now including both environments' —
-- `MASTER_TABLES` stays at **30** and `npm run check:alignment` must still read
-- 30 afterwards. **31 means a table was wrongly added to the shared list.**
--
-- The alternative — stop dual-writing and let each database hold its own — was
-- measured and rejected: the settings routes `/api/request/accounting/settings`
-- and `/api/request/advance/settings` are pinned to Production in `ROUTE_RULES`
-- (deliberately, so a config-row id in the path is not read as an AccRequest
-- id), so an admin working in UAT mode would still have written the PRO
-- database. Keying on a COLUMN makes the split independent of which database a
-- request happens to resolve: the screen's own PRO/UAT toggle decides which row
-- is being edited.
--
-- ---------------------------------------------------------------------------
-- THE UNIQUE KEYS MUST CARRY IT, OR THE SECOND ENVIRONMENT CANNOT EXIST.
--
-- Measured before writing this — every one leads with FormCode:
--
--   UQ_AccBrandJournalBatch   FormCode, BrandCode, BatchName
--   UQ_AccBrandGlAccount      FormCode, BrandCode, AccountNo
--   UQ_AccBrandBankAccount    FormCode, BrandCode, AccountNo
--   UQ_AccBrandBranchCode     FormCode, BrandCode, BranchCode
--
-- Each is rebuilt with `Environment` FIRST. SQL Server treats NULLs as equal in
-- a unique index, which is what lets `FormCode IS NULL` keep meaning "the
-- default, answering every form" underneath it (migration 097's rule, unchanged).
--
-- ---------------------------------------------------------------------------
-- EXISTING ROWS BECOME 'Production', AND UAT STARTS EMPTY. THAT IS INTENDED.
--
-- Every value stored today was picked from a Production list, so calling it
-- Production is a statement of fact. Nothing is copied into Sandbox: a guess
-- there would be a batch name that may not exist in the test company, which is
-- the exact failure this migration is about. **After deploying, each brand's
-- UAT half has to be set on the Interface ERP tab's UAT toggle** — until it is,
-- a UAT send has no configuration and refuses, which is the fail-safe direction.
--
-- Idempotent: every step is guarded on sys.columns / sys.indexes.

SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

IF DB_NAME() NOT LIKE 'Rocks[_]Portal[_]Form%'
BEGIN
  DECLARE @wrongDb NVARCHAR(128) = DB_NAME();
  RAISERROR (
    'Migration 161 may only be applied to Rocks_Portal_Form or Rocks_Portal_Form_UAT. Current database is %s.',
    16, 1, @wrongDb
  );
END
GO

-- == 1. The column ==========================================================
-- NVARCHAR(20) and the values 'Production' / 'Sandbox', matching
-- `ErpBcEnvironment` and migration 159's `SourceEnvironment`. A different
-- spelling of the same idea is how a WHERE clause comes to match nothing.
--
-- NOT NULL with a DEFAULT in one statement, so there is no window in which the
-- column exists and the rows are unclassified.
DECLARE @t SYSNAME, @sql NVARCHAR(MAX);
DECLARE tabs CURSOR LOCAL FAST_FORWARD FOR
  SELECT name FROM (VALUES
    ('AccBrandJournalBatch'), ('AccBrandGlAccount'),
    ('AccBrandBankAccount'), ('AccBrandBranchCode')
  ) AS x(name);
OPEN tabs;
FETCH NEXT FROM tabs INTO @t;
WHILE @@FETCH_STATUS = 0
BEGIN
  IF OBJECT_ID(N'dbo.' + @t, 'U') IS NULL
    RAISERROR ('Table dbo.%s is missing — this is not a form database migration 059 has built.', 16, 1, @t);
  ELSE IF COL_LENGTH(N'dbo.' + @t, 'Environment') IS NULL
  BEGIN
    SET @sql = N'ALTER TABLE [dbo].[' + @t + N'] ADD [Environment] NVARCHAR(20) NOT NULL '
             + N'CONSTRAINT [DF_' + @t + N'_Environment] DEFAULT (''Production'') WITH VALUES;';
    EXEC sp_executesql @sql;
    PRINT 'Added ' + @t + '.Environment.';
  END
  ELSE
    PRINT @t + '.Environment already present — skipped.';
  FETCH NEXT FROM tabs INTO @t;
END
CLOSE tabs; DEALLOCATE tabs;
GO

-- == 2. Rebuild each unique key to lead with Environment =====================
-- Dropped and recreated: SQL Server has no ALTER INDEX that changes key
-- columns. Each is checked for being a CONSTRAINT rather than an INDEX first —
-- migration 097 records that getting this wrong raises Msg 3723.
DECLARE @ix TABLE (TableName SYSNAME, IndexName SYSNAME, KeyCols NVARCHAR(400));
INSERT INTO @ix (TableName, IndexName, KeyCols) VALUES
  ('AccBrandJournalBatch', 'UQ_AccBrandJournalBatch', '[Environment], [FormCode], [BrandCode], [BatchName]'),
  ('AccBrandGlAccount',    'UQ_AccBrandGlAccount',    '[Environment], [FormCode], [BrandCode], [AccountNo]'),
  ('AccBrandBankAccount',  'UQ_AccBrandBankAccount',  '[Environment], [FormCode], [BrandCode], [AccountNo]'),
  ('AccBrandBranchCode',   'UQ_AccBrandBranchCode',   '[Environment], [FormCode], [BrandCode], [BranchCode]');

DECLARE @tn SYSNAME, @ixn SYSNAME, @cols NVARCHAR(400), @stmt NVARCHAR(MAX), @isConstraint BIT;
DECLARE ixs CURSOR LOCAL FAST_FORWARD FOR SELECT TableName, IndexName, KeyCols FROM @ix;
OPEN ixs;
FETCH NEXT FROM ixs INTO @tn, @ixn, @cols;
WHILE @@FETCH_STATUS = 0
BEGIN
  IF EXISTS (
    SELECT 1 FROM sys.indexes i
    JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.key_ordinal = 1
    JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
    WHERE i.object_id = OBJECT_ID(N'dbo.' + @tn) AND i.name = @ixn AND c.name = 'Environment'
  )
    PRINT @tn + '.' + @ixn + ' already leads with Environment — skipped.';
  ELSE
  BEGIN
    SELECT @isConstraint = ISNULL(MAX(CAST(i.is_unique_constraint AS INT)), 0)
    FROM sys.indexes i WHERE i.object_id = OBJECT_ID(N'dbo.' + @tn) AND i.name = @ixn;

    IF EXISTS (SELECT 1 FROM sys.indexes i WHERE i.object_id = OBJECT_ID(N'dbo.' + @tn) AND i.name = @ixn)
    BEGIN
      SET @stmt = CASE WHEN @isConstraint = 1
        THEN N'ALTER TABLE [dbo].[' + @tn + N'] DROP CONSTRAINT [' + @ixn + N'];'
        ELSE N'DROP INDEX [' + @ixn + N'] ON [dbo].[' + @tn + N'];' END;
      EXEC sp_executesql @stmt;
    END

    SET @stmt = N'CREATE UNIQUE INDEX [' + @ixn + N'] ON [dbo].[' + @tn + N'] (' + @cols + N');';
    EXEC sp_executesql @stmt;
    PRINT 'Rebuilt ' + @tn + '.' + @ixn + ' leading with Environment.';
  END
  FETCH NEXT FROM ixs INTO @tn, @ixn, @cols;
END
CLOSE ixs; DEALLOCATE ixs;
GO

-- == Post-apply =============================================================
-- Every existing row must read 'Production', and Sandbox must be 0 on a first
-- apply — nothing is copied across, by design. Both databases must report the
-- same numbers; they are dual-written and `check:alignment` compares them.
SELECT 'AccBrandJournalBatch' AS TableName, COUNT(*) AS [Rows],
       SUM(CASE WHEN Environment = 'Sandbox' THEN 1 ELSE 0 END) AS Sandbox FROM [dbo].[AccBrandJournalBatch]
UNION ALL SELECT 'AccBrandGlAccount', COUNT(*), SUM(CASE WHEN Environment = 'Sandbox' THEN 1 ELSE 0 END) FROM [dbo].[AccBrandGlAccount]
UNION ALL SELECT 'AccBrandBankAccount', COUNT(*), SUM(CASE WHEN Environment = 'Sandbox' THEN 1 ELSE 0 END) FROM [dbo].[AccBrandBankAccount]
UNION ALL SELECT 'AccBrandBranchCode', COUNT(*), SUM(CASE WHEN Environment = 'Sandbox' THEN 1 ELSE 0 END) FROM [dbo].[AccBrandBranchCode];
GO
