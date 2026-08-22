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
