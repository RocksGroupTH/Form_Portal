-- =============================================
-- Migration: add Icon (emoji) to AccVehicle
-- Database: Fast_Form
-- Apply: npm run apply-sql -- --db Fast_Form --file migrations/017_acc_vehicle_icon.sql
-- =============================================

IF COL_LENGTH('dbo.AccVehicle', 'Icon') IS NULL
BEGIN
  ALTER TABLE [dbo].[AccVehicle] ADD [Icon] NVARCHAR(32) NULL;
  PRINT 'Added AccVehicle.Icon';
END
ELSE PRINT 'AccVehicle.Icon already exists - skipping';
GO

-- Seed sensible default emojis for the originally-seeded vehicles (only if unset)
UPDATE [dbo].[AccVehicle] SET Icon = N'🚗'  WHERE Icon IS NULL AND Name = N'รถยนต์';
UPDATE [dbo].[AccVehicle] SET Icon = N'🏍️' WHERE Icon IS NULL AND Name = N'รถจักรยานยนต์';
UPDATE [dbo].[AccVehicle] SET Icon = N'🚙'  WHERE Icon IS NULL AND Name = N'Grab';
UPDATE [dbo].[AccVehicle] SET Icon = N'🚕'  WHERE Icon IS NULL AND Name = N'Taxi';
UPDATE [dbo].[AccVehicle] SET Icon = N'🧾'  WHERE Icon IS NULL AND Name = N'อื่นๆ';
GO

PRINT '=== Migration 017 complete ===';
GO
