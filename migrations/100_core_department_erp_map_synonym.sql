-- Fast_Core.dbo.DepartmentErpMap becomes a synonym for the form database copy.
--
-- Apply with (Fast_Core ONLY, and ONLY AFTER migration 099):
--   npm run apply-sql -- --db Fast_Core --file migrations/100_core_department_erp_map_synonym.sql
--
-- ---------------------------------------------------------------------------
-- THIS MIGRATION DESTROYS THE ONLY COPY OF THE DATA IF 099 HAS NOT RUN.
--
-- Everything before the DROP is the guard against that: the target must exist
-- as a TABLE, it must hold the same number of rows as the source, counted
-- under TABLOCKX inside the same transaction as the drop so no sibling can
-- insert between the count and the drop, AND every source row must actually
-- be present in the target -- matching counts alone cannot tell "099 copied
-- everything" from "099's batch 2 found the target already non-empty, printed
-- a message and copied nothing, and the target happens to hold as many rows
-- as the source by coincidence." A LOCK_TIMEOUT keeps a conflicting sibling
-- lock from queuing past node-mssql's request timeout, which would leave the
-- transaction open uncommitted rather than cleanly failing it.
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
  -- Set before the transaction starts, so a sibling holding a conflicting
  -- lock on this table becomes a clean server-side error the server itself
  -- rolls back -- rather than node-mssql's request timeout (15s default;
  -- makeConfig sets no requestTimeout, src/lib/db/mssql.ts:30-41) sending an
  -- attention that cancels the statement but leaves the transaction open,
  -- which XACT_ABORT does not cover.
  SET LOCK_TIMEOUT 5000;
  BEGIN TRANSACTION;

  -- TABLOCKX holds the source against inserts for the rest of the
  -- transaction, so both the content check and the count check below stay
  -- true when the drop runs.
  DECLARE @here INT = (
    SELECT COUNT(*) FROM [dbo].[DepartmentErpMap] WITH (TABLOCKX)
  );
  DECLARE @there INT = (
    SELECT COUNT(*) FROM [Rocks_Portal_Form].[dbo].[DepartmentErpMap]
  );

  -- Content check, ahead of the count check: two tables can hold the same
  -- number of rows without holding the same rows -- see the header. This
  -- catches that case even though the counts alone would not.
  IF EXISTS (
    SELECT [Id],[BrandCode],[DepartmentCode],[ErpDimensionCode],[ErpCode],[FormCode]
    FROM [dbo].[DepartmentErpMap]
    EXCEPT
    SELECT [Id],[BrandCode],[DepartmentCode],[ErpDimensionCode],[ErpCode],[FormCode]
    FROM [Rocks_Portal_Form].[dbo].[DepartmentErpMap]
  )
  BEGIN
    ROLLBACK TRANSACTION;
    RAISERROR (
      'Migration 100: Rocks_Portal_Form.dbo.DepartmentErpMap does not hold every row Fast_Core does, even though the row counts agree. Re-run migration 099 (its batch 2 is an id-keyed top-up) and retry. Refusing to drop the only copy of data that has not actually all been copied.',
      16, 1
    );
  END
  ELSE IF @here <> @there
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
