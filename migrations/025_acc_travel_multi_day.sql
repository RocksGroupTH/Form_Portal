-- =============================================
-- Migration: AP-1 multi-day travel (multiple AccTravelExpense per request)
-- Database: Fast_Form
-- Apply: npm run apply-sql -- --db Fast_Form --file migrations/025_acc_travel_multi_day.sql
-- =============================================

IF EXISTS (
  SELECT 1 FROM sys.key_constraints
  WHERE name = 'UQ_AccTravel_Request' AND parent_object_id = OBJECT_ID('dbo.AccTravelExpense')
)
BEGIN
  ALTER TABLE [dbo].[AccTravelExpense] DROP CONSTRAINT [UQ_AccTravel_Request];
  PRINT 'Dropped UQ_AccTravel_Request';
END
GO

IF COL_LENGTH('dbo.AccTravelExpense', 'SortOrder') IS NULL
BEGIN
  ALTER TABLE [dbo].[AccTravelExpense] ADD [SortOrder] INT NOT NULL CONSTRAINT [DF_AccTravel_SortOrder] DEFAULT 0;
  PRINT 'Added SortOrder';
END
GO

-- Backfill sort order for existing rows (one per request today).
UPDATE t SET SortOrder = 0
FROM [dbo].[AccTravelExpense] t
WHERE t.SortOrder IS NULL OR t.SortOrder < 0;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UQ_AccTravel_Request_Date' AND object_id = OBJECT_ID('dbo.AccTravelExpense')
)
BEGIN
  CREATE UNIQUE INDEX [UQ_AccTravel_Request_Date]
    ON [dbo].[AccTravelExpense]([RequestId], [TravelDate])
    WHERE [TravelDate] IS NOT NULL;
  PRINT 'Created UQ_AccTravel_Request_Date';
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_AccTravel_Request_Sort' AND object_id = OBJECT_ID('dbo.AccTravelExpense')
)
BEGIN
  CREATE INDEX [IX_AccTravel_Request_Sort]
    ON [dbo].[AccTravelExpense]([RequestId], [SortOrder], [TravelDate]);
  PRINT 'Created IX_AccTravel_Request_Sort';
END
GO

PRINT '=== Migration 025 complete ===';
GO
