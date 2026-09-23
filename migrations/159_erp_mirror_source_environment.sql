-- 159_erp_mirror_source_environment.sql
-- Target: Rocks_ERP_Data ONLY. Apply BEFORE 160, and before the code deploys.
--   npm run apply-sql -- --db Rocks_ERP_Data --file migrations/159_erp_mirror_source_environment.sql
--
-- ---------------------------------------------------------------------------
-- WHAT THIS IS.
--
-- The Business Central mirror learns WHICH BC ENVIRONMENT each row was synced
-- from, so a tester's Sandbox data and production's live data can sit in one
-- set of tables without touching each other.
--
-- The user's instruction, 2026-09-23: "ตอน sync ข้อมูลของ ERP ถ้า Sync และ
-- อ่านแยกกันระหว่าง PRO กับ UAT ด้วย" -- and, asked how: แยก column.
--
-- ---------------------------------------------------------------------------
-- THIS IS NOT A NEW IDEA. ErpVendors HAS HAD IT SINCE MIGRATION 117.
--
-- ErpVendors.SourceEnvironment NVARCHAR(20) NOT NULL already exists and already
-- LEADS its unique key (UQ_ErpVendors_BrandVendorNo). What was never built is
-- the wiring: ERP_VENDOR_SOURCE_ENVIRONMENT in vendor-sync.ts is the literal
-- 'Production'. So this extends a design that was chosen once and left
-- half-done rather than inventing one -- same column name, same type, same
-- position at the head of the key, and the values are ErpBcEnvironment's own:
-- 'Production' and 'Sandbox'.
--
-- ErpVendors is therefore NOT touched here. It is already correct.
--
-- ---------------------------------------------------------------------------
-- THE PART THAT IS ABOUT ANOTHER APPLICATION, AND WHY THE VIEWS EXIST.
--
-- Five of these tables are reached by Rocks Fast through permanent synonyms in
-- Fast_Data (migration 102), and it does not merely read them -- measured
-- 2026-09-23 against ../RocksFast/src, it MERGEs and UPDATEs ErpAccounts,
-- ErpDimensionValue, ErpGeneralJournalBatch and ErpBankAccountCard, and INSERTs
-- into ErpSyncLog.
--
-- Its MERGE is keyed like this, and the omission is the whole problem:
--
--     MERGE [dbo].[ErpAccounts] AS t
--       ON t.BrandCode = s.BrandCode
--         AND t.AccountCategory = s.AccountCategory
--         AND t.AccountNo = s.AccountNo
--
-- No environment in the ON clause, and no SourceEnvironment in its INSERT
-- column list. Add the column, leave the synonyms pointing at the tables, and
-- the sibling's next sync MATCHES a Sandbox row of the same key and overwrites
-- it with Production data -- silently, no error, every run. That is worse than
-- the sibling merely SEEING Sandbox rows, and it is why this migration does not
-- stop at the column.
--
-- So each of those five gets a Production-filtered view, and migration 160
-- repoints its Fast_Data synonym at the view. The sibling then reads and writes
-- exactly the rows it does today:
--
--   * its MERGE's ON clause can only ever match Production rows;
--   * its INSERT omits SourceEnvironment, which the DEFAULT fills as
--     'Production';
--   * WITH CHECK OPTION refuses a write that would move a row out of the view,
--     so the sibling cannot create or convert a Sandbox row even by accident.
--
-- The views are single-table, key-preserving and carry no computed columns, so
-- they are updatable: SQL Server allows INSERT, UPDATE, DELETE and MERGE
-- through them. SELECT * is deliberately NOT used -- a view defined with * does
-- not pick up columns added later, so a sibling selecting a newer column would
-- fail against a stale view. Every column is listed, generated from the table's
-- current shape.
--
-- ---------------------------------------------------------------------------
-- THE UNIQUE KEYS MUST LEAD WITH THE ENVIRONMENT, OR NOTHING ELSE WORKS.
--
-- Measured before writing this: not one of the five carries an environment in
-- its unique key (UQ_ErpAccounts is BrandCode, AccountCategory, AccountNo).
-- Until they do, the first Sandbox row of a key production already holds fails
-- with a duplicate-key error rather than sitting beside it. Each key is rebuilt
-- with SourceEnvironment FIRST, which both admits the second row and keeps the
-- index useful to every existing query: they all filter on BrandCode, and after
-- this they filter on the environment too.
--
-- ---------------------------------------------------------------------------
-- IDEMPOTENT, AND THE BACKFILL IS A STATEMENT OF FACT.
--
-- Every row that exists when this runs was synced from Production -- there has
-- never been anywhere else to sync from -- so the DEFAULT is not a guess. Each
-- step is guarded on sys.columns / sys.indexes, so a re-run is a no-op and a
-- half-applied run resumes.
--
-- ---------------------------------------------------------------------------
-- ROW COUNTS MEASURED 2026-09-23, BEFORE: ErpAccounts 4,858 ·
-- ErpBankAccountCard 64 · ErpDimensionValue 820 · ErpGeneralJournalBatch 182 ·
-- ErpLocation 341 · ErpSyncLog 85 · ErpVendors 3,076 (already has the column).
-- Every one of them must read 'Production' afterwards.

SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

IF DB_NAME() <> N'Rocks_ERP_Data'
BEGIN
  DECLARE @wrongDb NVARCHAR(128) = DB_NAME();
  RAISERROR (
    'Migration 159 may only be applied to Rocks_ERP_Data. Current database is %s.',
    16, 1, @wrongDb
  );
END
GO

-- == 1. The column, on the six tables that do not already have it ============
-- ErpVendors is absent on purpose: migration 117 gave it this exact column.
-- ErpLocation has no Fast_Data synonym (measured), so it takes the column and
-- no view -- nothing outside this application reads it.
DECLARE @t SYSNAME, @sql NVARCHAR(MAX);
DECLARE tabs CURSOR LOCAL FAST_FORWARD FOR
  SELECT name FROM (VALUES
    ('ErpAccounts'), ('ErpBankAccountCard'), ('ErpDimensionValue'),
    ('ErpGeneralJournalBatch'), ('ErpLocation'), ('ErpSyncLog')
  ) AS x(name);
OPEN tabs;
FETCH NEXT FROM tabs INTO @t;
WHILE @@FETCH_STATUS = 0
BEGIN
  IF OBJECT_ID(N'dbo.' + @t, 'U') IS NULL
    RAISERROR ('Table dbo.%s is missing -- this is not a Rocks_ERP_Data that 101/117 have built.', 16, 1, @t);
  ELSE IF COL_LENGTH(N'dbo.' + @t, 'SourceEnvironment') IS NULL
  BEGIN
    -- NOT NULL with a DEFAULT in one statement: every existing row is stamped
    -- as the column is created, so there is no window in which the column
    -- exists and the rows are unclassified, and the sibling's INSERT (which
    -- does not name this column) keeps working from the first second.
    SET @sql = N'ALTER TABLE [dbo].[' + @t + N'] ADD [SourceEnvironment] NVARCHAR(20) NOT NULL '
             + N'CONSTRAINT [DF_' + @t + N'_SourceEnvironment] DEFAULT (''Production'') WITH VALUES;';
    EXEC sp_executesql @sql;
    PRINT 'Added ' + @t + '.SourceEnvironment.';
  END
  ELSE
    PRINT @t + '.SourceEnvironment already present -- skipped.';
  FETCH NEXT FROM tabs INTO @t;
END
CLOSE tabs; DEALLOCATE tabs;
GO

-- == 2. Rebuild each unique key to lead with SourceEnvironment ===============
-- Dropped and recreated rather than altered: SQL Server has no ALTER INDEX that
-- changes the key columns. Each is checked for being a CONSTRAINT rather than an
-- INDEX first -- migration 097 records that getting this wrong raises Msg 3723
-- -- and the verb that matches what is found is the one used.
DECLARE @ix TABLE (TableName SYSNAME, IndexName SYSNAME, KeyCols NVARCHAR(400));
INSERT INTO @ix (TableName, IndexName, KeyCols) VALUES
  ('ErpAccounts',            'UQ_ErpAccounts',            '[SourceEnvironment], [BrandCode], [AccountCategory], [AccountNo]'),
  ('ErpBankAccountCard',     'UQ_ErpBankAccountCard',     '[SourceEnvironment], [BrandCode], [AccountNo]'),
  ('ErpDimensionValue',      'UQ_ErpDimensionValue',      '[SourceEnvironment], [BrandCode], [DimensionCode], [Code]'),
  ('ErpGeneralJournalBatch', 'UQ_ErpGeneralJournalBatch', '[SourceEnvironment], [BrandCode], [BatchName]'),
  ('ErpLocation',            'UQ_ErpLocation_Brand_Code', '[SourceEnvironment], [BrandCode], [Code]');

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
    WHERE i.object_id = OBJECT_ID(N'dbo.' + @tn) AND i.name = @ixn AND c.name = 'SourceEnvironment'
  )
    PRINT @tn + '.' + @ixn + ' already leads with SourceEnvironment -- skipped.';
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
    PRINT 'Rebuilt ' + @tn + '.' + @ixn + ' leading with SourceEnvironment.';
  END
  FETCH NEXT FROM ixs INTO @tn, @ixn, @cols;
END
CLOSE ixs; DEALLOCATE ixs;
GO

-- == 3. Production-filtered views, for migration 160's synonyms ==============
-- Columns listed explicitly rather than SELECT * -- see the header. Each view is
-- generated from the table's CURRENT column list, so a table that gains a column
-- later needs this step re-run, which is exactly the discipline SELECT * would
-- hide until a sibling query failed.
--
-- WITH CHECK OPTION is what stops the sibling writing a row that would fall out
-- of the view: an UPDATE setting SourceEnvironment = 'Sandbox' through the view
-- is refused rather than silently hiding the row from its own writer.
DECLARE @v SYSNAME, @vt SYSNAME, @vcols NVARCHAR(MAX), @vsql NVARCHAR(MAX);
DECLARE vws CURSOR LOCAL FAST_FORWARD FOR
  SELECT name FROM (VALUES
    ('ErpAccounts'), ('ErpBankAccountCard'), ('ErpDimensionValue'),
    ('ErpGeneralJournalBatch'), ('ErpSyncLog')
  ) AS x(name);
OPEN vws;
FETCH NEXT FROM vws INTO @vt;
WHILE @@FETCH_STATUS = 0
BEGIN
  SET @v = N'vw' + @vt + N'Production';
  SELECT @vcols = STUFF((
    SELECT N', [' + c.name + N']'
    FROM sys.columns c
    WHERE c.object_id = OBJECT_ID(N'dbo.' + @vt)
    ORDER BY c.column_id
    FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(MAX)'), 1, 2, N'');

  SET @vsql = N'CREATE OR ALTER VIEW [dbo].[' + @v + N'] AS SELECT ' + @vcols
            + N' FROM [dbo].[' + @vt + N'] WHERE [SourceEnvironment] = ''Production'' WITH CHECK OPTION;';
  EXEC sp_executesql @vsql;
  PRINT 'Created or refreshed view dbo.' + @v + '.';
  FETCH NEXT FROM vws INTO @vt;
END
CLOSE vws; DEALLOCATE vws;
GO

-- == Post-apply =============================================================
-- Every row should read 'Production', so NotProduction must be 0 on a first
-- apply. Once the code is live it may legitimately be non-zero -- those are a
-- tester's Sandbox rows, which is the whole point.
SELECT 'ErpAccounts' AS TableName, COUNT(*) AS [Rows],
       SUM(CASE WHEN SourceEnvironment <> 'Production' THEN 1 ELSE 0 END) AS NotProduction FROM [dbo].[ErpAccounts]
UNION ALL SELECT 'ErpBankAccountCard', COUNT(*), SUM(CASE WHEN SourceEnvironment <> 'Production' THEN 1 ELSE 0 END) FROM [dbo].[ErpBankAccountCard]
UNION ALL SELECT 'ErpDimensionValue', COUNT(*), SUM(CASE WHEN SourceEnvironment <> 'Production' THEN 1 ELSE 0 END) FROM [dbo].[ErpDimensionValue]
UNION ALL SELECT 'ErpGeneralJournalBatch', COUNT(*), SUM(CASE WHEN SourceEnvironment <> 'Production' THEN 1 ELSE 0 END) FROM [dbo].[ErpGeneralJournalBatch]
UNION ALL SELECT 'ErpLocation', COUNT(*), SUM(CASE WHEN SourceEnvironment <> 'Production' THEN 1 ELSE 0 END) FROM [dbo].[ErpLocation]
UNION ALL SELECT 'ErpSyncLog', COUNT(*), SUM(CASE WHEN SourceEnvironment <> 'Production' THEN 1 ELSE 0 END) FROM [dbo].[ErpSyncLog]
UNION ALL SELECT 'ErpVendors', COUNT(*), SUM(CASE WHEN SourceEnvironment <> 'Production' THEN 1 ELSE 0 END) FROM [dbo].[ErpVendors];
GO
