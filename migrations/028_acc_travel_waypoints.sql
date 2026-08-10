-- =============================================
-- Migration: AP-1 route waypoints (multi-stop legs)
-- Database: Fast_Form
-- Apply: npm run apply-sql -- --db Fast_Form --file migrations/028_acc_travel_waypoints.sql
-- =============================================

IF COL_LENGTH('dbo.AccTravelExpense', 'OnwardWaypoints') IS NULL
BEGIN
  ALTER TABLE [dbo].[AccTravelExpense] ADD [OnwardWaypoints] NVARCHAR(MAX) NULL;
  PRINT 'Added AccTravelExpense.OnwardWaypoints';
END
GO

IF COL_LENGTH('dbo.AccTravelExpense', 'ReturnWaypoints') IS NULL
BEGIN
  ALTER TABLE [dbo].[AccTravelExpense] ADD [ReturnWaypoints] NVARCHAR(MAX) NULL;
  PRINT 'Added AccTravelExpense.ReturnWaypoints';
END
GO

PRINT '=== Migration 028 complete ===';
GO
