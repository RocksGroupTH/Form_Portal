-- Fast_Core.dbo.UatTester becomes a synonym for the UAT form database copy.
--
-- Apply with (Fast_Core ONLY, and ONLY AFTER migration 139):
--   npm run apply-sql -- --db Fast_Core --file migrations/140_core_uat_tester_synonym.sql
--
-- Design: docs/superpowers/specs/2026-09-07-uat-tester-move-design.md
--
-- ---------------------------------------------------------------------------
-- THIS DESTROYS THE ONLY COPY OF THE TESTER ROSTER IF 139 HAS NOT RUN.
-- Everything before the DROP is the guard: the target must exist as a table, the
-- row counts must match, and the contents must match -- all inside the
-- transaction that drops, with the source counted under TABLOCKX so nothing can
-- slip in between.
--
-- THE CONTENT CHECK COMPARES WHOLE ROWS. UatTester has no nvarchar(MAX) column,
-- so unlike migration 102 -- whose EXCEPT had to reduce each table's LOB to a
-- DATALENGTH -- all eight columns are in the projection with nothing left out.
--
-- ---------------------------------------------------------------------------
-- THE SYNONYM IS FOR ACC PORTAL, AND IT IS PERMANENT.
--
-- Measured 2026-09-07: ACC Portal reads this table in exactly one file,
-- ACC_Portal/src/lib/uat-tester/service.ts, as two read-only SELECTs naming it
-- two-part on a fixed pool over env.RF_CORE_DATABASE. It never writes it and
-- never names it three-part, so a synonym resolves both statements with no
-- change on its side. Rocks Fast names UatTester nowhere at all.
--
-- Synonyms do not carry permissions: the login ACC Portal uses must have SELECT
-- on Rocks_Portal_Form_UAT, not merely on Fast_Core.
--
-- ---------------------------------------------------------------------------
-- THIS IS THE FIRST SYNONYM IN THIS REPO POINTING INTO A UAT DATABASE. The seven
-- that exist (100, 102, 105) all point at production databases. It inherits the
-- env-drift hazard CLAUDE.md records for MSSQL_FORM_DATABASE and
-- MSSQL_ERP_DATA_DATABASE: this file hard-codes [Rocks_Portal_Form_UAT] while
-- the app resolves env.MSSQL_FORM_UAT_DATABASE, so repointing that var makes the
-- two applications read different rosters with no error anywhere.
-- `npm run check:uat-tester-home` is what catches it.
--
-- SET LOCK_TIMEOUT before the transaction for the reason migration 100 records:
-- the pool sets no requestTimeout, so node-mssql's 15 s default would otherwise
-- send an attention, and an attention cancels the statement WITHOUT rolling the
-- transaction back -- XACT_ABORT does not cover it.

SET NOCOUNT ON;

IF DB_NAME() <> N'Fast_Core'
BEGIN
  DECLARE @wrongDb NVARCHAR(128) = DB_NAME();
  RAISERROR ('Migration 140 may only be applied to Fast_Core. Current database is %s.', 16, 1, @wrongDb);
END
ELSE IF OBJECT_ID('dbo.UatTester', 'SN') IS NOT NULL
BEGIN
  PRINT 'dbo.UatTester is already a synonym -- migration 140 has already run.';
END
ELSE IF OBJECT_ID('dbo.UatTester', 'U') IS NULL
BEGIN
  RAISERROR ('Migration 140: dbo.UatTester is neither a table nor a synonym in Fast_Core. Refusing to guess.', 16, 1);
END
ELSE IF OBJECT_ID('[Rocks_Portal_Form_UAT].[dbo].[UatTester]', 'U') IS NULL
BEGIN
  RAISERROR (
    'Migration 140: [Rocks_Portal_Form_UAT].[dbo].[UatTester] does not exist as a table. Run migration 139 first. Refusing to drop the only copy of the tester roster.',
    16, 1
  );
END
ELSE
BEGIN
  SET LOCK_TIMEOUT 5000;
  SET XACT_ABORT ON;
  BEGIN TRANSACTION;

  DECLARE @problem NVARCHAR(400) = NULL;

  IF @problem IS NULL AND (SELECT COUNT(*) FROM [dbo].[UatTester] WITH (TABLOCKX))
                       <> (SELECT COUNT(*) FROM [Rocks_Portal_Form_UAT].[dbo].[UatTester])
    SET @problem = 'row counts differ';

  IF @problem IS NULL AND EXISTS (
    SELECT [Id], [StaffId], [Email], [ManagerStaffId], [ManagerEmail], [IsActive], [UpdatedBy], [UpdatedAt]
      FROM [dbo].[UatTester]
    EXCEPT
    SELECT [Id], [StaffId], [Email], [ManagerStaffId], [ManagerEmail], [IsActive], [UpdatedBy], [UpdatedAt]
      FROM [Rocks_Portal_Form_UAT].[dbo].[UatTester])
    SET @problem = 'contents differ';

  IF @problem IS NOT NULL
  BEGIN
    ROLLBACK TRANSACTION;
    RAISERROR (
      'Migration 140 refuses to drop: %s. Re-run 139 -- its batch 2 is a MERGE and reconciles both new and changed rows -- then retry this. If the target instead holds MORE rows than Fast_Core, re-running 139 cannot fix it and that path needs a person.',
      16, 1, @problem
    );
  END
  ELSE
  BEGIN
    DROP TABLE [dbo].[UatTester];

    CREATE SYNONYM [dbo].[UatTester]
      FOR [Rocks_Portal_Form_UAT].[dbo].[UatTester];

    COMMIT TRANSACTION;
    PRINT 'Fast_Core.dbo.UatTester is now a synonym for [Rocks_Portal_Form_UAT].[dbo].[UatTester].';
  END
END
GO
