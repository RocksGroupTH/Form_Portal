-- =============================================
-- Migration: add Icon (emoji) to the 4 AP-17 settings tables
--   AccTravelReason / AccTravelAccommodation / AccTravelVehicleOption / AccTravelRentVehicle
-- Database: Fast_Form
-- Apply: npm run apply-sql -- --db Fast_Form --file migrations/051_acc_travel_booking_option_icon.sql
-- Mirrors migration 017 (AccVehicle.Icon) — lets AP-17 options pick an emoji like AP-1.
-- =============================================

-- 1. AccTravelReason --------------------------------------------------------
IF COL_LENGTH('dbo.AccTravelReason', 'Icon') IS NULL
BEGIN
  ALTER TABLE [dbo].[AccTravelReason] ADD [Icon] NVARCHAR(32) NULL;
  PRINT 'Added AccTravelReason.Icon';
END
ELSE PRINT 'AccTravelReason.Icon already exists — skipping';
GO

-- 2. AccTravelAccommodation -------------------------------------------------
IF COL_LENGTH('dbo.AccTravelAccommodation', 'Icon') IS NULL
BEGIN
  ALTER TABLE [dbo].[AccTravelAccommodation] ADD [Icon] NVARCHAR(32) NULL;
  PRINT 'Added AccTravelAccommodation.Icon';
END
ELSE PRINT 'AccTravelAccommodation.Icon already exists — skipping';
GO

-- 3. AccTravelVehicleOption -------------------------------------------------
IF COL_LENGTH('dbo.AccTravelVehicleOption', 'Icon') IS NULL
BEGIN
  ALTER TABLE [dbo].[AccTravelVehicleOption] ADD [Icon] NVARCHAR(32) NULL;
  PRINT 'Added AccTravelVehicleOption.Icon';
END
ELSE PRINT 'AccTravelVehicleOption.Icon already exists — skipping';
GO

-- 4. AccTravelRentVehicle ---------------------------------------------------
IF COL_LENGTH('dbo.AccTravelRentVehicle', 'Icon') IS NULL
BEGIN
  ALTER TABLE [dbo].[AccTravelRentVehicle] ADD [Icon] NVARCHAR(32) NULL;
  PRINT 'Added AccTravelRentVehicle.Icon';
END
ELSE PRINT 'AccTravelRentVehicle.Icon already exists — skipping';
GO

-- Seed sensible default emojis for the originally-seeded rows (only if unset) --
UPDATE [dbo].[AccTravelAccommodation] SET Icon = N'🏨' WHERE Icon IS NULL AND Name = N'โรงแรม';
UPDATE [dbo].[AccTravelAccommodation] SET Icon = N'🏠' WHERE Icon IS NULL AND Name = N'อพาร์ทเม้น/หอพัก';
UPDATE [dbo].[AccTravelAccommodation] SET Icon = N'🚫' WHERE Icon IS NULL AND Name = N'ไม่พักค้างคืน';

UPDATE [dbo].[AccTravelVehicleOption] SET Icon = N'🚗' WHERE Icon IS NULL AND Name = N'รถยนต์ส่วนตัว';
UPDATE [dbo].[AccTravelVehicleOption] SET Icon = N'🚌' WHERE Icon IS NULL AND Name = N'รถทัวร์โดยสาร';
UPDATE [dbo].[AccTravelVehicleOption] SET Icon = N'🚐' WHERE Icon IS NULL AND Name = N'รถตู้โดยสาร';
UPDATE [dbo].[AccTravelVehicleOption] SET Icon = N'✈️' WHERE Icon IS NULL AND Name = N'เครื่องบิน';

UPDATE [dbo].[AccTravelRentVehicle] SET Icon = N'🚗' WHERE Icon IS NULL AND Name = N'รถยนต์';
UPDATE [dbo].[AccTravelRentVehicle] SET Icon = N'🏍️' WHERE Icon IS NULL AND Name = N'รถจักรยานยนต์';
UPDATE [dbo].[AccTravelRentVehicle] SET Icon = N'🚐' WHERE Icon IS NULL AND Name = N'รถตู้พร้อมคนขับ';
UPDATE [dbo].[AccTravelRentVehicle] SET Icon = N'🚫' WHERE Icon IS NULL AND Name = N'ไม่เช่า';
GO

PRINT '=== Migration 051 complete ===';
GO
