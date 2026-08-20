-- Extend the UAT identity floor to AP-11's transactional table.
--
-- Database: Rocks_Portal_Form_UAT  ONLY
-- Apply with:
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/068_uat_reward_identity_floor.sql
--
-- 061 reseeded every transactional identity in the UAT form database to 900000
-- and 064 made that structural with a CHECK, because the app reads a bare id as
-- naming its own database: `isUatId` (src/lib/form-environment/uat-identity.ts)
-- and `boundIdEnvironment` (pick-environment.ts) both decide on the 900000 test.
-- Migration 067 adds AccRewardRequest, a new transactional table, so it needs
-- the same two things or AP-11's UAT rows would carry ids that read as
-- production.
--
-- AccReward and AccRewardOfficer are deliberately absent, for the same reason
-- the 19 shared masters are absent from 061 and 064: they are configuration
-- rather than transactions. They are not dual-written either -- Qty is
-- inventory, not a setting, and mirroring it would mean a UAT test draining the
-- production count or a production edit resetting a tester's stock -- so their
-- ids simply start at 1 in each database independently and are never compared
-- across the two.
--
-- Like 061 and 064, this refuses to run anywhere but a database whose name ends
-- in _UAT: applying it to production would reject every insert there, because
-- production ids start at 1.
SET NOCOUNT ON;

IF DB_NAME() NOT LIKE '%[_]UAT'
BEGIN
  DECLARE @wrong NVARCHAR(128) = DB_NAME();
  RAISERROR (
    'Migration 068 may only be applied to the UAT form database. Current database is %s.',
    16, 1, @wrong
  );
END
ELSE IF OBJECT_ID('dbo.AccRewardRequest', 'U') IS NULL
BEGIN
  RAISERROR (
    'Migration 068 expects dbo.AccRewardRequest to exist. Apply 067 to this database first.',
    16, 1
  );
END
ELSE
BEGIN
  -- Reseed first, then floor -- the same order 061 and 064 ran in. Reseeding a
  -- table that already has rows at or above the floor is a no-op in effect:
  -- DBCC CHECKIDENT ... RESEED sets the *next* value, and the CHECK below then
  -- rejects anything that would land under it.
  --
  -- The identity column is read from sys.identity_columns rather than assumed to
  -- be [Id], matching 064, so this keeps working if the column is ever renamed.
  DECLARE @ident SYSNAME =
    (SELECT TOP 1 ic.name FROM sys.identity_columns ic
      WHERE ic.object_id = OBJECT_ID('dbo.AccRewardRequest'));

  IF EXISTS (SELECT 1 FROM [dbo].[AccRewardRequest])
    PRINT 'AccRewardRequest already holds rows -- skipping RESEED, adding the floor only.';
  ELSE
  BEGIN
    DBCC CHECKIDENT ('dbo.AccRewardRequest', RESEED, 900000) WITH NO_INFOMSGS;
    PRINT 'Reseeded dbo.AccRewardRequest identity to 900000.';
  END

  IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.AccRewardRequest')
      AND name = 'CK_AccRewardRequest_UatIdFloor'
  )
  BEGIN
    -- WITH CHECK, never WITH NOCHECK: an unvalidated constraint would leave
    -- exactly the sub-900000 rows this exists to prevent. On a fresh 067 the
    -- table is empty, so validation has nothing to reject.
    DECLARE @sql NVARCHAR(MAX) =
      N'ALTER TABLE [dbo].[AccRewardRequest] WITH CHECK ADD CONSTRAINT [CK_AccRewardRequest_UatIdFloor] CHECK ('
      + QUOTENAME(@ident) + N' >= 900000);';
    EXEC sp_executesql @sql;
    PRINT 'Added CK_AccRewardRequest_UatIdFloor (>= 900000).';
  END
  ELSE PRINT 'CK_AccRewardRequest_UatIdFloor already present -- skipping.';
END
GO

PRINT '=== Migration 068 complete ===';
GO
