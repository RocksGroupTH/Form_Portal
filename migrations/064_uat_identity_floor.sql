-- Make the UAT identity floor structural.
--
-- migrations/061_uat_identity_reseed.sql reseeded every transactional identity
-- in the UAT form database to 900000, and the application now leans on that:
-- `isUatId` (src/lib/form-environment/uat-identity.ts) reads a bare id as
-- "this row lives in UAT", and resolution rule 1 -- the record named in the path
-- wins over both of the form's switches -- is decided by that same test in
-- `boundIdEnvironment` (src/lib/form-environment/pick-environment.ts).
--
-- A reseed is a one-time act, not an invariant. Anything that resets an identity
-- -- a table rebuilt from a production script, a restore, an ad-hoc
-- DBCC CHECKIDENT -- silently starts handing out ids below 900000 again, and
-- those rows then read as production ids while sitting in the UAT database.
-- Nothing in the app or the schema currently notices. This adds the CHECK that
-- does, so the write fails at the point of the mistake instead of producing a
-- row that routes itself to the wrong database.
--
-- The same 23 tables as 061, and for the same reason the 19 shared master/config
-- tables are absent there: their ids are kept aligned with production by
-- src/lib/acc/dual-write.ts, which inserts production's id into UAT explicitly.
-- A floor on those would reject every dual-write.
--
-- Added WITH CHECK. Every existing row was verified to satisfy the floor before
-- this migration was written (AccRequest min 900001, AccTravelExpense min
-- 900000, the remaining 21 tables empty), so the validation pass has nothing to
-- reject. Do not weaken this to WITH NOCHECK: an unvalidated constraint would
-- leave exactly the sub-900000 rows this exists to prevent.
--
-- Apply with:
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/064_uat_identity_floor.sql
--
-- Applying this to the production database would reject every insert there --
-- production ids start at 1 -- so, like 061, it refuses to run anywhere but a
-- database whose name ends in _UAT.
SET NOCOUNT ON;

IF DB_NAME() NOT LIKE '%[_]UAT'
BEGIN
  DECLARE @wrong NVARCHAR(128) = DB_NAME();
  RAISERROR (
    'Migration 064 may only be applied to the UAT form database. Current database is %s.',
    16, 1, @wrong
  );
END
ELSE
BEGIN
  DECLARE @sql NVARCHAR(MAX) = N'';

  -- The identity column is read from sys.identity_columns rather than assumed to
  -- be [Id]: 061 found the tables the same way, and a constraint written against
  -- a guessed column name would fail on the one table that disagrees.
  SELECT @sql = @sql
       + N'ALTER TABLE [dbo].' + QUOTENAME(t.name)
       + N' WITH CHECK ADD CONSTRAINT ' + QUOTENAME(N'CK_' + t.name + N'_UatIdFloor')
       + N' CHECK (' + QUOTENAME(ic.name) + N' >= 900000);'
       + CHAR(13) + CHAR(10)
  FROM sys.tables t
  JOIN sys.identity_columns ic ON ic.object_id = t.object_id
  WHERE t.name IN (
    -- Everything reachable from AccRequest by foreign key, plus the queue.
    'AccRequest', 'AccApproval', 'AccActivityLog', 'AccRequestFile',
    'AccPerDiem', 'AccPerDiemDay', 'AccTravelExpense', 'AccTravelExpenseItem',
    'AccTravelVehicleSection', 'AccTravelBooking', 'AccTravelBookingDetail',
    'AccTravelDepartureLocation', 'AccTravelWorkLocation', 'AccEmailQueue',
    -- Form Builder. Always Production today, but 061 reseeded these so the
    -- property still holds if that ever changes; the floor follows.
    'OfficeForms', 'OfficeFormVersions', 'OfficeFormSubmissions',
    'OfficeFormApprovals', 'OfficeFormWorkflows', 'OfficeFormWorkflowSteps',
    'OfficeFormFiles', 'OfficeFormEmailQueue', 'OfficeFormActivityLog'
  )
    -- Re-runnable: skip any table that already carries its floor.
    AND NOT EXISTS (
      SELECT 1 FROM sys.check_constraints cc
      WHERE cc.parent_object_id = t.object_id
        AND cc.name = N'CK_' + t.name + N'_UatIdFloor'
    );

  IF LEN(@sql) = 0
    PRINT 'Identity floor already present on every listed table. Nothing to do.';
  ELSE
  BEGIN
    -- All 23 ALTERs in one transaction. Without it, a table that turns out to
    -- hold a sub-900000 row fails its own ALTER with 547 while the rest carry
    -- on, leaving a half-floored database and 23 lines of output to read. The
    -- migration is re-runnable either way; this just makes a bad run report one
    -- error and change nothing.
    SET XACT_ABORT ON;
    BEGIN TRANSACTION;
    EXEC sp_executesql @sql;
    COMMIT TRANSACTION;

    PRINT 'Added identity floor CHECK (>= 900000) to '
        + CAST((LEN(@sql) - LEN(REPLACE(@sql, 'ALTER', ''))) / 5 AS NVARCHAR(10))
        + ' table(s).';
  END
END
GO
