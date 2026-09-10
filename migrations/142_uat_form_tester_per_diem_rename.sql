-- UatTesterPerDiem -> TesterPerDiem, with a synonym left behind for the
-- still-running build.
--
-- TARGET: Rocks_Portal_Form_UAT ONLY.
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/142_uat_form_tester_per_diem_rename.sql
--
-- ---------------------------------------------------------------------------
-- WHY RENAME.
--
-- Migration 138 created this table in Fast_Core -- a database SHARED with the
-- RocksFast and ACC_Portal siblings, where the `Uat` prefix said which
-- environment a row belonged to and was load-bearing. Migrations 139/140 moved
-- it into Rocks_Portal_Form_UAT, a database that is UAT by definition and where
-- every other table is unprefixed: AccRequest, not UatAccRequest. The prefix is
-- a leftover from the old home.
--
-- UatTester itself is NOT renamed and is not in this file. It stays in
-- Fast_Core, where the prefix still works -- see the design doc's section 2.
--
-- The TypeScript symbols keep their `uat` prefix on purpose: uatPerDiemLogFor,
-- UatPerDiemRateRow, src/lib/uat-tester/. They are called from code that runs in
-- both environments and sit beside getAllowanceLog (the HR source), where `uat`
-- is what says which log is the override. Table and symbols differ deliberately.
--
-- ---------------------------------------------------------------------------
-- RUN THIS BEFORE THE CODE DEPLOY. 143 RUNS AFTER IT.
--
-- The rename and the IsActive drop want OPPOSITE orders, which is the whole
-- reason they are two files:
--
--   * the drop must come AFTER the deploy -- the previous build SELECTs
--     IsActive, and SQL Server binds column names at compile time;
--   * the rename must come BEFORE it -- the new build names TesterPerDiem.
--
-- Combined in one file there is no order in which both builds work. Split, with
-- the synonym below, BOTH work at every moment:
--
--   142 ....... old build reads UatTesterPerDiem -> synonym -> table (IsActive
--               still present, so its SELECTs bind); new build reads
--               TesterPerDiem directly and names no IsActive.
--   deploy .... both names resolve throughout.
--   143 ....... synonym dropped, IsActive dropped. The old build is gone by then.
--
-- Same shape as 139 -> deploy -> 140, and for the same reason: the pricing read
-- runs inside the transaction that rejectRequest / rejectByAdmin /
-- cancelByRequester hold for recomputeGroupPerDiem, so an Invalid object name
-- there does not fail one read, it rolls back a whole cancellation -- the status
-- UPDATE, the approval close and the activity row with it.
--
-- One honest caveat about the synonym: the old build's SAVE goes through
-- `MERGE [dbo].[UatTesterPerDiem] WITH (HOLDLOCK)`, and a table hint on a
-- synonym is the one part of this not verified here. If it refuses, the settings
-- page's save fails loudly for the minutes between 142 and the deploy, and works
-- again afterwards. The path that matters -- the pricing read inside that open
-- transaction -- is a plain SELECT and resolves through a synonym with certainty.
--
-- ---------------------------------------------------------------------------
-- RENAMING A TABLE DOES NOT RENAME ITS CONSTRAINTS.
--
-- Each is renamed explicitly below. 'OBJECT' is the right third argument, not
-- 'INDEX', because PK_UatTesterPerDiem and UQ_UatTesterPerDiem_Staff_Date were
-- declared in 139's CREATE TABLE as CONSTRAINTS rather than as standalone
-- indexes -- migration 098 records the same distinction for
-- UQ_DepartmentErpMap_Dept and notes there that the backing index follows the
-- constraint. The repo's only other sp_rename uses are in 126 and 046.
--
-- No line numbers into 139: this header cited 139:63 and 139:73 when it was
-- written and the same commit added eleven lines to 139's own header, so both
-- were wrong before either file was committed.
--
-- Measured against the live Rocks_Portal_Form_UAT on 2026-09-08, before this
-- ran: the table plus exactly six constraints --
--   PK_UatTesterPerDiem              (clustered, primary key)
--   UQ_UatTesterPerDiem_Staff_Date   (nonclustered, unique)
--   CK_UatTesterPerDiem_Amount
--   DF_UatTesterPerDiem_CreatedAt / _IsActive / _UpdatedAt
-- and no object named TesterPerDiem. DF_..._IsActive is renamed here too rather
-- than left behind: 143 drops it by lookup, so it costs nothing, and a delayed
-- 143 does not leave one object still carrying the old name.
--
-- ---------------------------------------------------------------------------
-- RE-RUNNABLE -- AND 139 MUST NOT BE RE-RUN AFTER THIS.
--
-- Every batch tests for the NEW name first and skips, which is 126's shape. But
-- migration 139's own guard is `OBJECT_ID('dbo.UatTesterPerDiem') IS NOT NULL`,
-- which the synonym satisfies until 143 and nothing satisfies afterwards. Run
-- 139 again on a database that has had 142 and 143 and it will happily CREATE a
-- second, empty UatTesterPerDiem beside the real TesterPerDiem.
--
-- ---------------------------------------------------------------------------
-- STANDING UP A REPLACEMENT DATABASE: 139 STOPS PART-WAY, AND THAT IS EXPECTED.
--
-- The order is 139 -> 142 -> 143, once, and 139 never again. But 139 does not
-- COMPLETE on a fresh database any more, and no amount of care here changes
-- that: its batch 1 creates the table, and its batch 2 copies the rows from
-- [Fast_Core].[dbo].[UatTesterPerDiem] -- which migration 140 dropped on
-- 2026-09-07. So batch 2 raises, apply-sql exits 1, and batch 3 never runs.
--
-- What you are left with is a correct but EMPTY table. Run 139 and expect that
-- failure, then run 142 and 143, then restore the rates from a backup. This is
-- the same shape as the recovery migration 104 documents for TravelProvince,
-- and for the same reason: the source a copy migration reads from is gone once
-- its companion has run.

SET NOCOUNT ON;

IF DB_NAME() NOT LIKE '%[_]UAT' OR OBJECT_ID('dbo.AccRequest', 'U') IS NULL
BEGIN
  DECLARE @wrongDb NVARCHAR(128) = DB_NAME();
  RAISERROR (
    'Migration 142 may only be applied to the UAT form database: the name must end in _UAT and dbo.AccRequest must exist. Current database is %s.',
    16, 1, @wrongDb
  );
END
ELSE IF OBJECT_ID('dbo.TesterPerDiem', 'U') IS NOT NULL
BEGIN
  PRINT 'dbo.TesterPerDiem already exists -- batch 1 skipped.';
END
ELSE IF OBJECT_ID('dbo.UatTesterPerDiem', 'U') IS NULL
BEGIN
  RAISERROR (
    'Migration 142: neither dbo.TesterPerDiem nor dbo.UatTesterPerDiem exists as a table here. Apply migration 139 first.',
    16, 1
  );
END
ELSE
BEGIN
  SET XACT_ABORT ON;
  BEGIN TRANSACTION;

  EXEC sp_rename N'dbo.UatTesterPerDiem', N'TesterPerDiem';

  -- Guarded one at a time so a database left half-renamed by a run that died
  -- mid-batch completes, rather than failing on the first name already changed.
  IF OBJECT_ID('dbo.PK_UatTesterPerDiem') IS NOT NULL
    EXEC sp_rename N'dbo.PK_UatTesterPerDiem', N'PK_TesterPerDiem', N'OBJECT';
  IF OBJECT_ID('dbo.UQ_UatTesterPerDiem_Staff_Date') IS NOT NULL
    EXEC sp_rename N'dbo.UQ_UatTesterPerDiem_Staff_Date', N'UQ_TesterPerDiem_Staff_Date', N'OBJECT';
  IF OBJECT_ID('dbo.CK_UatTesterPerDiem_Amount') IS NOT NULL
    EXEC sp_rename N'dbo.CK_UatTesterPerDiem_Amount', N'CK_TesterPerDiem_Amount', N'OBJECT';
  IF OBJECT_ID('dbo.DF_UatTesterPerDiem_CreatedAt') IS NOT NULL
    EXEC sp_rename N'dbo.DF_UatTesterPerDiem_CreatedAt', N'DF_TesterPerDiem_CreatedAt', N'OBJECT';
  IF OBJECT_ID('dbo.DF_UatTesterPerDiem_UpdatedAt') IS NOT NULL
    EXEC sp_rename N'dbo.DF_UatTesterPerDiem_UpdatedAt', N'DF_TesterPerDiem_UpdatedAt', N'OBJECT';
  IF OBJECT_ID('dbo.DF_UatTesterPerDiem_IsActive') IS NOT NULL
    EXEC sp_rename N'dbo.DF_UatTesterPerDiem_IsActive', N'DF_TesterPerDiem_IsActive', N'OBJECT';

  DECLARE @left INT = (
    SELECT COUNT(*) FROM sys.objects WHERE name LIKE '%UatTesterPerDiem%'
  );
  IF OBJECT_ID('dbo.TesterPerDiem', 'U') IS NULL OR @left <> 0
  BEGIN
    ROLLBACK TRANSACTION;
    RAISERROR (
      'Migration 142 rolled back: after the rename %d object(s) still carry the old name. Nothing was changed.',
      16, 1, @left
    );
  END
  ELSE
  BEGIN
    COMMIT TRANSACTION;
    PRINT 'Batch 1: dbo.UatTesterPerDiem renamed to dbo.TesterPerDiem, with its six constraints.';
  END
END
GO

SET NOCOUNT ON;

-- The bridge. Dropped by 143 once the new build is live; it exists only so that
-- there is no moment at which one of the two builds cannot read this table.
IF DB_NAME() NOT LIKE '%[_]UAT' OR OBJECT_ID('dbo.AccRequest', 'U') IS NULL
BEGIN
  DECLARE @wrongDb2 NVARCHAR(128) = DB_NAME();
  RAISERROR ('Migration 142 batch 2 may only be applied to the UAT form database. Current database is %s.', 16, 1, @wrongDb2);
END
ELSE IF OBJECT_ID('dbo.TesterPerDiem', 'U') IS NULL
BEGIN
  RAISERROR ('Migration 142 batch 2: dbo.TesterPerDiem is not a table here -- batch 1 did not run.', 16, 1);
END
ELSE IF OBJECT_ID('dbo.UatTesterPerDiem') IS NOT NULL
BEGIN
  PRINT 'dbo.UatTesterPerDiem already resolves -- batch 2 skipped.';
END
ELSE
BEGIN
  CREATE SYNONYM [dbo].[UatTesterPerDiem] FOR [dbo].[TesterPerDiem];
  PRINT 'Batch 2: synonym dbo.UatTesterPerDiem -> dbo.TesterPerDiem created. Migration 143 drops it after the deploy.';
END
GO

SET NOCOUNT ON;

-- Post-apply: the new name is a table, the old one is a synonym and NOT a table,
-- and the rates are still there.
SELECT
  OBJECT_ID('dbo.TesterPerDiem', 'U')     AS TesterPerDiem_ShouldBeATable,
  OBJECT_ID('dbo.UatTesterPerDiem', 'SN') AS OldName_ShouldBeASynonym,
  OBJECT_ID('dbo.UatTesterPerDiem', 'U')  AS OldName_ShouldNotBeATable;
GO
SELECT Id, StaffId, EffectiveDate, Amount FROM [dbo].[TesterPerDiem] ORDER BY StaffId, EffectiveDate;
GO
