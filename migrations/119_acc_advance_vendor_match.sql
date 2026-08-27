-- Vendor-match result for AP-2 advances. Portal-form DB ONLY (Rocks_Portal_Form
-- and its _UAT twin) -- never Rocks_ERP_Data, never Fast_*.
-- Apply:
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/119_acc_advance_vendor_match.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/119_acc_advance_vendor_match.sql

SET NOCOUNT ON;
SET XACT_ABORT ON;

IF DB_NAME() NOT IN (N'Rocks_Portal_Form', N'Rocks_Portal_Form_UAT')
BEGIN
  DECLARE @wrongDb NVARCHAR(128) = DB_NAME();
  RAISERROR('Migration 119 targets Rocks_Portal_Form / _UAT only. Current: %s.', 16, 1, @wrongDb);
END
ELSE IF OBJECT_ID('dbo.AccAdvance', 'U') IS NULL
BEGIN
  RAISERROR('Migration 119 requires dbo.AccAdvance.', 16, 1);
END
ELSE
BEGIN
  BEGIN TRANSACTION;

  IF COL_LENGTH('dbo.AccAdvance', 'MatchedVendorNo') IS NULL
    ALTER TABLE [dbo].[AccAdvance] ADD [MatchedVendorNo] NVARCHAR(50) NULL;
  IF COL_LENGTH('dbo.AccAdvance', 'MatchedVendorName') IS NULL
    ALTER TABLE [dbo].[AccAdvance] ADD [MatchedVendorName] NVARCHAR(200) NULL;
  IF COL_LENGTH('dbo.AccAdvance', 'VendorMatchStatus') IS NULL
    ALTER TABLE [dbo].[AccAdvance] ADD [VendorMatchStatus] NVARCHAR(20) NULL;
  IF COL_LENGTH('dbo.AccAdvance', 'VendorMatchConfidence') IS NULL
    ALTER TABLE [dbo].[AccAdvance] ADD [VendorMatchConfidence] NVARCHAR(10) NULL;
  IF COL_LENGTH('dbo.AccAdvance', 'VendorMatchReason') IS NULL
    ALTER TABLE [dbo].[AccAdvance] ADD [VendorMatchReason] NVARCHAR(500) NULL;
  IF COL_LENGTH('dbo.AccAdvance', 'VendorMatchedAt') IS NULL
    ALTER TABLE [dbo].[AccAdvance] ADD [VendorMatchedAt] DATETIME2(7) NULL;
  IF COL_LENGTH('dbo.AccAdvance', 'VendorConfirmedBy') IS NULL
    ALTER TABLE [dbo].[AccAdvance] ADD [VendorConfirmedBy] INT NULL;

  COMMIT TRANSACTION;
  PRINT 'AccAdvance vendor-match columns present.';
END
GO
