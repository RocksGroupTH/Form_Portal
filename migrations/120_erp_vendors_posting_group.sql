-- Add VendorPostingGroup column to ErpVendors for ADV-filter support.
-- Apply only to Rocks_ERP_Data (after migrations 117 and 118).

SET NOCOUNT ON;
SET XACT_ABORT ON;

IF DB_NAME() <> N'Rocks_ERP_Data'
BEGIN
  DECLARE @wrongDb NVARCHAR(128) = DB_NAME();
  RAISERROR (
    'Migration 120 may only be applied to Rocks_ERP_Data. Current database is %s.',
    16, 1, @wrongDb
  );
END
ELSE IF OBJECT_ID('dbo.ErpVendors', 'U') IS NULL
BEGIN
  RAISERROR ('Migration 120 requires dbo.ErpVendors from migration 117.', 16, 1);
END
ELSE
BEGIN
  BEGIN TRANSACTION;

  IF COL_LENGTH('dbo.ErpVendors', 'VendorPostingGroup') IS NULL
    ALTER TABLE [dbo].[ErpVendors] ADD [VendorPostingGroup] NVARCHAR(20) NULL;

  COMMIT TRANSACTION;
  PRINT 'VendorPostingGroup column is present on dbo.ErpVendors in Rocks_ERP_Data.';
END
GO
