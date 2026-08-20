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
