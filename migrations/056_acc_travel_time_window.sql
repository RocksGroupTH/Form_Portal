-- =============================================
-- Migration: AP-17 depart/return time becomes a "time window" string (e.g. "05:00-06:00")
-- Database: Fast_Form
-- Apply: npm run apply-sql -- --db Fast_Form --file migrations/056_acc_travel_time_window.sql
-- The form now picks a preset time-range chip per direction instead of a single time,
-- so DepartTime/ReturnTime change from TIME to NVARCHAR(20). Existing TIME values (if any)
-- convert to their string form — acceptable for this new form.
-- =============================================

IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.AccTravelBooking') AND name = 'DepartTime' AND system_type_id = TYPE_ID('time')
)
  ALTER TABLE [dbo].[AccTravelBooking] ALTER COLUMN [DepartTime] NVARCHAR(20) NULL;
GO

IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.AccTravelBooking') AND name = 'ReturnTime' AND system_type_id = TYPE_ID('time')
)
  ALTER TABLE [dbo].[AccTravelBooking] ALTER COLUMN [ReturnTime] NVARCHAR(20) NULL;
GO

PRINT '=== Migration 056 complete ===';
GO
