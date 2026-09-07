-- Fast_Core.dbo.UatTesterPerDiem is dropped. NO synonym is left behind.
--
-- Apply with (Fast_Core ONLY, AFTER migration 139 AND AFTER the code that reads
-- the new home is deployed -- see the ordering note below):
--   npm run apply-sql -- --db Fast_Core --file migrations/140_core_uat_tester_per_diem_drop.sql
--
-- Design: docs/superpowers/specs/2026-09-07-uat-tester-move-design.md
--
-- ---------------------------------------------------------------------------
-- WHY NO SYNONYM.
--
-- Migrations 100, 102 and 105 each left a synonym behind for a named sibling
-- that still read the table two-part. Measured 2026-09-07, NO application
-- other than Form Portal names UatTesterPerDiem anywhere -- not ACC Portal,
-- not Rocks Fast. A synonym with no consumer is a claim that somebody depends
-- on it, and the next person to consider removing it would have to disprove
-- that first.
--
-- ---------------------------------------------------------------------------
-- RUN THIS AFTER 139 AND AFTER THE CODE DEPLOY, NOT BEFORE.
--
-- A synonym is transparent: it lets a build still calling the old pool keep
-- working while the deploy catches up. This table gets no synonym, so there
-- is nothing to be transparent through -- running this before the deploy
-- would give the running build `Invalid object name` on AP-17's pricing path
-- in UAT. The full sequence is 139 -> deploy the code -> 140.
--
-- THE CONTENT CHECK COMPARES WHOLE ROWS. No nvarchar(MAX) column, so all ten
-- columns are in the projection.

SET NOCOUNT ON;

IF DB_NAME() <> N'Fast_Core'
BEGIN
  DECLARE @wrongDb NVARCHAR(128) = DB_NAME();
  RAISERROR ('Migration 140 may only be applied to Fast_Core. Current database is %s.', 16, 1, @wrongDb);
END
ELSE IF OBJECT_ID('dbo.UatTesterPerDiem') IS NULL
BEGIN
  PRINT 'dbo.UatTesterPerDiem does not exist in Fast_Core -- migration 140 has already run.';
END
ELSE IF OBJECT_ID('dbo.UatTesterPerDiem', 'U') IS NULL
BEGIN
  RAISERROR ('Migration 140: dbo.UatTesterPerDiem exists but is not a table. Refusing to guess.', 16, 1);
END
ELSE IF OBJECT_ID('[Rocks_Portal_Form_UAT].[dbo].[UatTesterPerDiem]', 'U') IS NULL
BEGIN
  RAISERROR (
    'Migration 140: [Rocks_Portal_Form_UAT].[dbo].[UatTesterPerDiem] does not exist as a table. Run migration 139 first. Refusing to drop the only copy of the per-diem rates.',
    16, 1
  );
END
ELSE
BEGIN
  SET LOCK_TIMEOUT 5000;
  SET XACT_ABORT ON;
  BEGIN TRANSACTION;

  DECLARE @problem NVARCHAR(400) = NULL;

  IF @problem IS NULL AND (SELECT COUNT(*) FROM [dbo].[UatTesterPerDiem] WITH (TABLOCKX))
                       <> (SELECT COUNT(*) FROM [Rocks_Portal_Form_UAT].[dbo].[UatTesterPerDiem])
    SET @problem = 'row counts differ';

  IF @problem IS NULL AND EXISTS (
    SELECT [Id], [StaffId], [EffectiveDate], [Amount], [Note], [IsActive], [CreatedBy], [CreatedAt], [UpdatedBy], [UpdatedAt]
      FROM [dbo].[UatTesterPerDiem]
    EXCEPT
    SELECT [Id], [StaffId], [EffectiveDate], [Amount], [Note], [IsActive], [CreatedBy], [CreatedAt], [UpdatedBy], [UpdatedAt]
      FROM [Rocks_Portal_Form_UAT].[dbo].[UatTesterPerDiem])
    SET @problem = 'contents differ';

  IF @problem IS NOT NULL
  BEGIN
    ROLLBACK TRANSACTION;
    RAISERROR (
      'Migration 140 refuses to drop: %s. Re-run 139 -- its batch 2 is a MERGE and reconciles both new and changed rows -- then retry this.',
      16, 1, @problem
    );
  END
  ELSE
  BEGIN
    DROP TABLE [dbo].[UatTesterPerDiem];

    COMMIT TRANSACTION;
    PRINT 'Fast_Core.dbo.UatTesterPerDiem dropped. No synonym: nothing outside Form Portal names it.';
  END
END
GO
