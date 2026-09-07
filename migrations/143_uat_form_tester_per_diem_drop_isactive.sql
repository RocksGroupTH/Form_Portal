-- Drop the synonym 142 left behind, and drop TesterPerDiem.IsActive.
--
-- TARGET: Rocks_Portal_Form_UAT ONLY.
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/143_uat_form_tester_per_diem_drop_isactive.sql
--
-- ---------------------------------------------------------------------------
-- RUN THIS AFTER THE CODE DEPLOY. 142 RAN BEFORE IT.
--
-- The full sequence is 139 -> 142 -> deploy -> 143. 142's header explains why
-- the rename and this drop cannot share a file: they want opposite orders, and
-- the synonym is what makes the gap between them safe for both builds.
--
-- Running this early is the one thing that hurts. The previous build SELECTs
-- IsActive in three statements and SQL Server binds column names at compile
-- time, so dropping it while that build is still serving turns AP-17's UAT
-- pricing read into `Invalid column name 'IsActive'` -- and that read happens
-- inside the transaction rejectRequest / rejectByAdmin / cancelByRequester hold
-- for recomputeGroupPerDiem, so it does not fail one query, it rolls back a
-- whole cancellation: the status UPDATE, the approval close and the activity row.
--
-- ---------------------------------------------------------------------------
-- WHY THE COLUMN GOES.
--
-- It was a second gate that HR does not have. `getAllowanceLog` reads every row
-- of Rocks_Portal_HR.dbo.EmployeeAllowanceLog with no filter, and rateForDay
-- picks the greatest effective date <= the day; this table filtered
-- `IsActive = 1` on top of that. Measured here on 2026-09-07 and recorded in
-- 141:19-23, both of this tester's rates were switched off -- which did not
-- blank a figure, it removed the override entirely and priced them at their real
-- HR salary, silently, on the path that writes AccRequest.TotalAmount. The
-- settings grid showed "—", indistinguishable from "never configured".
--
-- So this drop is NOT data-neutral, and that is the point: it is what puts those
-- two rates back into service. After it, the tester's override reads 300/day
-- from 2026-09-07 and 400/day from 2026-09-08. Nothing needs un-setting -- the
-- column simply stops being consulted, because it stops existing.
--
-- The near-identical AccTravelPerDiemCountry KEEPS its IsActive and its pricing
-- really does filter on it. Do not follow this migration there.
--
-- ---------------------------------------------------------------------------
-- THE DEFAULT CONSTRAINT COMES OFF FIRST.
--
-- SQL Server refuses to drop a column that carries one. 142 renamed it to
-- DF_TesterPerDiem_IsActive; it is dropped below by lookup rather than by name
-- so that a database where 142 was skipped, or where the constraint was created
-- unnamed, still works. Shape follows 128:61-65.

SET NOCOUNT ON;

IF DB_NAME() NOT LIKE '%[_]UAT' OR OBJECT_ID('dbo.AccRequest', 'U') IS NULL
BEGIN
  DECLARE @wrongDb NVARCHAR(128) = DB_NAME();
  RAISERROR (
    'Migration 143 may only be applied to the UAT form database: the name must end in _UAT and dbo.AccRequest must exist. Current database is %s.',
    16, 1, @wrongDb
  );
END
ELSE IF OBJECT_ID('dbo.TesterPerDiem', 'U') IS NULL
BEGIN
  RAISERROR (
    'Migration 143: dbo.TesterPerDiem is not a table here. Apply migrations 139 and 142 first.',
    16, 1
  );
END
ELSE IF OBJECT_ID('dbo.UatTesterPerDiem', 'SN') IS NULL
BEGIN
  PRINT 'No dbo.UatTesterPerDiem synonym -- batch 1 skipped.';
END
ELSE
BEGIN
  DROP SYNONYM [dbo].[UatTesterPerDiem];
  PRINT 'Batch 1: synonym dbo.UatTesterPerDiem dropped. Only the new name resolves from here.';
END
GO

SET NOCOUNT ON;

IF DB_NAME() NOT LIKE '%[_]UAT' OR OBJECT_ID('dbo.AccRequest', 'U') IS NULL
BEGIN
  DECLARE @wrongDb2 NVARCHAR(128) = DB_NAME();
  RAISERROR ('Migration 143 batch 2 may only be applied to the UAT form database. Current database is %s.', 16, 1, @wrongDb2);
END
ELSE IF OBJECT_ID('dbo.TesterPerDiem', 'U') IS NULL
BEGIN
  RAISERROR ('Migration 143 batch 2: dbo.TesterPerDiem is not a table here. Apply migrations 139 and 142 first.', 16, 1);
END
ELSE IF COL_LENGTH('dbo.TesterPerDiem', 'IsActive') IS NULL
BEGIN
  PRINT 'dbo.TesterPerDiem.IsActive is already gone -- batch 2 skipped.';
END
ELSE
BEGIN
  SET XACT_ABORT ON;
  BEGIN TRANSACTION;

  DECLARE @df SYSNAME = (
    SELECT dc.name
    FROM sys.default_constraints dc
    JOIN sys.columns c
      ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
    WHERE dc.parent_object_id = OBJECT_ID('dbo.TesterPerDiem') AND c.name = 'IsActive'
  );
  IF @df IS NOT NULL
    EXEC ('ALTER TABLE [dbo].[TesterPerDiem] DROP CONSTRAINT [' + @df + ']');

  ALTER TABLE [dbo].[TesterPerDiem] DROP COLUMN [IsActive];

  COMMIT TRANSACTION;
  PRINT 'Batch 2: dbo.TesterPerDiem.IsActive dropped. Every stored rate now counts and the effective date alone selects, as in HR.';
END
GO

SET NOCOUNT ON;

-- Post-apply: the column gone, the old name gone entirely, and the rates that
-- 141:19-23 recorded as switched off now readable and in service.
SELECT
  COL_LENGTH('dbo.TesterPerDiem','IsActive') AS IsActive_ShouldBeNull,
  OBJECT_ID('dbo.UatTesterPerDiem')          AS OldName_ShouldBeNull,
  OBJECT_ID('dbo.TesterPerDiem', 'U')        AS TesterPerDiem_ShouldBeATable;
GO
SELECT Id, StaffId, EffectiveDate, Amount, Note FROM [dbo].[TesterPerDiem] ORDER BY StaffId, EffectiveDate;
GO
