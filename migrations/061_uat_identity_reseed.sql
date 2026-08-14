-- Reseed UAT transactional identities to 900000.
--
-- Per-form routing means a merged list (/my-request, /my-work, the reports) can
-- hold rows from both databases at once, and an id in a URL has to identify its
-- own database. Starting UAT at 900000 makes both true: ids cannot collide, and
-- id >= 900000 means UAT on sight.
--
-- The 19 master/config tables are deliberately absent. Their ids are kept
-- aligned with production by the dual-write helper, which inserts production's
-- id into UAT explicitly — reseeding them would break that.
--
-- Apply with:
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/061_uat_identity_reseed.sql
--
-- Applying this to the production database would push live ids to 900001 and
-- destroy the very property it exists to create, so it refuses to run anywhere
-- but a database whose name ends in _UAT.
SET NOCOUNT ON;

IF DB_NAME() NOT LIKE '%[_]UAT'
BEGIN
  DECLARE @wrong NVARCHAR(128) = DB_NAME();
  RAISERROR (
    'Migration 061 may only be applied to the UAT form database. Current database is %s.',
    16, 1, @wrong
  );
END
ELSE
BEGIN
  DECLARE @sql NVARCHAR(MAX) = N'';

  SELECT @sql = @sql
       + N'DBCC CHECKIDENT (''dbo.' + t.name + N''', RESEED, 900000) WITH NO_INFOMSGS;'
       + CHAR(13) + CHAR(10)
  FROM sys.tables t
  JOIN sys.identity_columns ic ON ic.object_id = t.object_id
  WHERE t.name IN (
    -- Everything reachable from AccRequest by foreign key, plus the queue.
    'AccRequest', 'AccApproval', 'AccActivityLog', 'AccRequestFile',
    'AccPerDiem', 'AccPerDiemDay', 'AccTravelExpense', 'AccTravelExpenseItem',
    'AccTravelVehicleSection', 'AccTravelBooking', 'AccTravelBookingDetail',
    'AccTravelDepartureLocation', 'AccTravelWorkLocation', 'AccEmailQueue',
    -- Form Builder. Always Production today, but reseeded so the property
    -- still holds if that ever changes.
    'OfficeForms', 'OfficeFormVersions', 'OfficeFormSubmissions',
    'OfficeFormApprovals', 'OfficeFormWorkflows', 'OfficeFormWorkflowSteps',
    'OfficeFormFiles', 'OfficeFormEmailQueue', 'OfficeFormActivityLog'
  );

  EXEC sp_executesql @sql;

  PRINT 'Reseeded '
      + CAST((LEN(@sql) - LEN(REPLACE(@sql, 'DBCC', ''))) / 4 AS NVARCHAR(10))
      + ' identity column(s) to 900000.';
END
GO
