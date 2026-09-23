-- 160_fast_data_erp_production_views.sql
-- Target: Fast_Data ONLY. Apply AFTER 159, and before this code deploys.
--   npm run apply-sql -- --db Fast_Data --file migrations/160_fast_data_erp_production_views.sql
--
-- ---------------------------------------------------------------------------
-- WHAT THIS IS, AND WHY IT IS A SEPARATE FILE FROM 159.
--
-- It repoints the five permanent Fast_Data synonyms migration 102 left behind
-- -- the ones Rocks Fast and ACC Portal reach the Business Central mirror
-- through -- from the TABLES onto the Production-filtered VIEWS that 159
-- created.
--
-- Separate because the two files target different databases and 102's own
-- companion split the same way. It also means the synonyms can be repointed and
-- rolled back without touching the mirror itself.
--
-- ---------------------------------------------------------------------------
-- WHAT IT PROTECTS, IN ONE PARAGRAPH.
--
-- 159 lets a tester's Sandbox rows sit in the same tables as production's. Left
-- pointing at those tables, the synonyms would hand Rocks Fast both -- and Rocks
-- Fast does not only read. Measured 2026-09-23 against ../RocksFast/src, it
-- MERGEs and UPDATEs four of the five, with an ON clause that names BrandCode
-- and the natural key and NO environment at all. Its next sync would therefore
-- match a Sandbox row and overwrite it with Production data, silently, on every
-- run. Pointed at the filtered views, its MERGE cannot see a Sandbox row to
-- match, and its INSERT -- which does not name SourceEnvironment -- takes the
-- DEFAULT and stays Production.
--
-- ---------------------------------------------------------------------------
-- WHAT THE SIBLINGS SEE AFTERWARDS: EXACTLY WHAT THEY SEE TODAY.
--
-- Two-part names are unchanged (Fast_Data.dbo.ErpAccounts), the column list is
-- unchanged, every existing row is Production, and the views are updatable, so
-- SELECT, INSERT, UPDATE, DELETE and MERGE all behave as before. No sibling code
-- changes. That is the whole point of doing it this way rather than by moving
-- Sandbox rows into tables of their own.
--
-- The one behaviour that IS new, and is intended: a sibling write that would
-- take a row out of the Production set is refused by WITH CHECK OPTION rather
-- than making the row vanish from its own writer's view.
--
-- ---------------------------------------------------------------------------
-- ORDER, AND WHAT A WRONG ORDER COSTS.
--
--   159 (Rocks_ERP_Data) -> 160 (Fast_Data) -> deploy the code.
--
-- 160 before 159 fails outright and changes nothing: the views do not exist yet
-- and this file refuses rather than dropping a working synonym -- a dropped
-- synonym with nothing to replace it is an immediate outage in two other
-- applications, so every synonym here is only ever CREATE-d after its target has
-- been confirmed present.
--
-- Deploying the code before EITHER is the ordinary missing-column failure this
-- repository documents elsewhere: SQL Server binds column names at compile time,
-- so a query naming SourceEnvironment answers Msg 207 rather than an empty set.
--
-- ---------------------------------------------------------------------------
-- REVERSAL.
--
-- Re-pointing each synonym back at [Rocks_ERP_Data].[dbo].[<table>] restores the
-- previous arrangement exactly, and is safe for the siblings the moment no
-- Sandbox rows exist. With Sandbox rows present it re-opens the overwrite
-- described above, so delete them first:
--   DELETE FROM [Rocks_ERP_Data].[dbo].[<table>] WHERE SourceEnvironment <> 'Production';
-- Idempotent, so it may be re-run.

SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

IF DB_NAME() <> N'Fast_Data'
BEGIN
  DECLARE @wrongDb NVARCHAR(128) = DB_NAME();
  RAISERROR (
    'Migration 160 may only be applied to Fast_Data. Current database is %s.',
    16, 1, @wrongDb
  );
END
GO

-- Refuse unless every view 159 should have created is actually there. Checked
-- BEFORE anything is dropped, and as a set rather than one at a time: a partial
-- repoint would leave the two siblings reading a mixture of filtered and
-- unfiltered objects, which is harder to reason about than either end state.
DECLARE @missing NVARCHAR(MAX) = N'';
SELECT @missing = @missing + CASE WHEN OBJECT_ID(N'[Rocks_ERP_Data].[dbo].[vw' + x.name + N'Production]', 'V') IS NULL
                                  THEN N' ' + x.name ELSE N'' END
FROM (VALUES
  ('ErpAccounts'), ('ErpBankAccountCard'), ('ErpDimensionValue'),
  ('ErpGeneralJournalBatch'), ('ErpSyncLog')
) AS x(name);

IF LEN(@missing) > 0
  RAISERROR ('Migration 159 has not been applied to Rocks_ERP_Data -- missing view(s) for:%s. Apply 159 first; nothing has been changed.', 16, 1, @missing);
GO

DECLARE @t SYSNAME, @syn SYSNAME, @target SYSNAME, @sql NVARCHAR(MAX), @base NVARCHAR(400);
DECLARE tabs CURSOR LOCAL FAST_FORWARD FOR
  SELECT name FROM (VALUES
    ('ErpAccounts'), ('ErpBankAccountCard'), ('ErpDimensionValue'),
    ('ErpGeneralJournalBatch'), ('ErpSyncLog')
  ) AS x(name);
OPEN tabs;
FETCH NEXT FROM tabs INTO @t;
WHILE @@FETCH_STATUS = 0
BEGIN
  SET @target = N'[Rocks_ERP_Data].[dbo].[vw' + @t + N'Production]';

  SELECT @base = s.base_object_name FROM sys.synonyms s WHERE s.name = @t;

  IF @base IS NULL
  BEGIN
    -- Not a synonym at all. On a Fast_Data that still holds the real tables,
    -- 102 has not run, and repointing is not this migration's job to guess at.
    IF OBJECT_ID(N'dbo.' + @t, 'U') IS NOT NULL
      RAISERROR ('Fast_Data.dbo.%s is still a TABLE, not a synonym -- migration 102 has not been applied here. Nothing changed.', 16, 1, @t);
    ELSE
      PRINT 'Fast_Data.dbo.' + @t + ' does not exist at all -- skipped (nothing for the siblings to read through).';
  END
  ELSE IF @base = @target
    PRINT 'Fast_Data.dbo.' + @t + ' already points at the Production view -- skipped.';
  ELSE
  BEGIN
    -- Drop and create is the only way to repoint a synonym. The window between
    -- them is inside one batch on one connection and spans no I/O; the guard
    -- above has already proved the new target exists, which is what keeps that
    -- window from becoming an outage.
    SET @sql = N'DROP SYNONYM [dbo].[' + @t + N'];';
    EXEC sp_executesql @sql;
    SET @sql = N'CREATE SYNONYM [dbo].[' + @t + N'] FOR ' + @target + N';';
    EXEC sp_executesql @sql;
    PRINT 'Repointed Fast_Data.dbo.' + @t + ' -> ' + @target + ' (was ' + @base + ').';
  END

  FETCH NEXT FROM tabs INTO @t;
END
CLOSE tabs; DEALLOCATE tabs;
GO

-- == Post-apply =============================================================
-- Each of the five must name a vw...Production view. TravelProvince is listed
-- too and must be UNCHANGED -- it is migration 105's synonym into
-- Rocks_Portal_Form and has nothing to do with this.
SELECT s.name, s.base_object_name
FROM sys.synonyms s
ORDER BY s.name;
GO
