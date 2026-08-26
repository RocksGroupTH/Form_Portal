-- Remove Vendor API identifiers that are not required by the ERP vendor mirror.
-- Apply only to Rocks_ERP_Data after migration 117.

SET NOCOUNT ON;
SET XACT_ABORT ON;

IF DB_NAME() <> N'Rocks_ERP_Data'
BEGIN
  DECLARE @wrongDb NVARCHAR(128) = DB_NAME();
  RAISERROR (
    'Migration 118 may only be applied to Rocks_ERP_Data. Current database is %s.',
    16, 1, @wrongDb
  );
END
ELSE IF OBJECT_ID('dbo.ErpVendors', 'U') IS NULL
BEGIN
  RAISERROR ('Migration 118 requires dbo.ErpVendors from migration 117.', 16, 1);
END
ELSE
BEGIN
  BEGIN TRANSACTION;

  IF EXISTS (
    SELECT 1 FROM sys.key_constraints
    WHERE name = 'UQ_ErpVendors_SourceId'
      AND parent_object_id = OBJECT_ID('dbo.ErpVendors')
  )
    ALTER TABLE [dbo].[ErpVendors] DROP CONSTRAINT [UQ_ErpVendors_SourceId];

  IF COL_LENGTH('dbo.ErpVendors', 'BcVendorId') IS NOT NULL
    ALTER TABLE [dbo].[ErpVendors] DROP COLUMN [BcVendorId];

  IF COL_LENGTH('dbo.ErpVendors', 'Irs1099Code') IS NOT NULL
    ALTER TABLE [dbo].[ErpVendors] DROP COLUMN [Irs1099Code];

  IF COL_LENGTH('dbo.ErpVendors', 'PaymentTermsId') IS NOT NULL
    ALTER TABLE [dbo].[ErpVendors] DROP COLUMN [PaymentTermsId];

  IF COL_LENGTH('dbo.ErpVendors', 'PaymentMethodId') IS NOT NULL
    ALTER TABLE [dbo].[ErpVendors] DROP COLUMN [PaymentMethodId];

  COMMIT TRANSACTION;
  PRINT 'Removed BcVendorId, Irs1099Code, PaymentTermsId and PaymentMethodId from ErpVendors.';
END
GO
