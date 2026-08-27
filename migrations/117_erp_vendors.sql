-- Business Central Standard API v2.0 Vendor Master mirror.
-- Apply only to Rocks_ERP_Data.

SET NOCOUNT ON;
SET XACT_ABORT ON;

IF DB_NAME() <> N'Rocks_ERP_Data'
BEGIN
  DECLARE @wrongDb NVARCHAR(128) = DB_NAME();
  RAISERROR (
    'Migration 117 may only be applied to Rocks_ERP_Data. Current database is %s.',
    16, 1, @wrongDb
  );
END
ELSE
BEGIN
  BEGIN TRANSACTION;

  IF OBJECT_ID('dbo.ErpVendors', 'U') IS NULL
  CREATE TABLE [dbo].[ErpVendors] (
    [Id] INT IDENTITY(1,1) NOT NULL,
    [SourceEnvironment] NVARCHAR(20) NOT NULL,
    [BrandCode] NVARCHAR(20) NOT NULL,
    [BcCompanyId] NVARCHAR(50) NOT NULL,
    [BcCompanyName] NVARCHAR(200) NULL,
    [BcConnectionId] INT NOT NULL,
    [BcVendorId] UNIQUEIDENTIFIER NOT NULL,
    [VendorNo] NVARCHAR(50) NOT NULL,
    [DisplayName] NVARCHAR(200) NULL,
    [AddressLine1] NVARCHAR(200) NULL,
    [AddressLine2] NVARCHAR(200) NULL,
    [City] NVARCHAR(100) NULL,
    [State] NVARCHAR(100) NULL,
    [CountryCode] NVARCHAR(20) NULL,
    [PostalCode] NVARCHAR(30) NULL,
    [PhoneNumber] NVARCHAR(50) NULL,
    [Email] NVARCHAR(250) NULL,
    [Website] NVARCHAR(250) NULL,
    [TaxRegistrationNumber] NVARCHAR(50) NULL,
    [CurrencyId] UNIQUEIDENTIFIER NULL,
    [CurrencyCode] NVARCHAR(20) NULL,
    [Irs1099Code] NVARCHAR(50) NULL,
    [PaymentTermsId] UNIQUEIDENTIFIER NULL,
    [PaymentMethodId] UNIQUEIDENTIFIER NULL,
    [TaxLiable] BIT NOT NULL CONSTRAINT [DF_ErpVendors_TaxLiable] DEFAULT ((0)),
    [BlockedStatus] NVARCHAR(20) NULL,
    [IsBlocked] BIT NOT NULL CONSTRAINT [DF_ErpVendors_IsBlocked] DEFAULT ((0)),
    [BcLastModified] DATETIME2(7) NULL,
    [IsActive] BIT NOT NULL CONSTRAINT [DF_ErpVendors_IsActive] DEFAULT ((1)),
    [SourceDeletedAt] DATETIME2(7) NULL,
    [SyncedAt] DATETIME2(7) NOT NULL CONSTRAINT [DF_ErpVendors_SyncedAt] DEFAULT (sysdatetime()),
    CONSTRAINT [PK_ErpVendors] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [UQ_ErpVendors_SourceId]
      UNIQUE ([SourceEnvironment], [BcConnectionId], [BcCompanyId], [BcVendorId]),
    CONSTRAINT [UQ_ErpVendors_BrandVendorNo]
      UNIQUE ([SourceEnvironment], [BrandCode], [VendorNo])
  );

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_ErpVendors_BrandActive'
      AND object_id = OBJECT_ID('dbo.ErpVendors')
  )
    CREATE INDEX [IX_ErpVendors_BrandActive]
      ON [dbo].[ErpVendors] ([BrandCode], [IsActive], [IsBlocked])
      INCLUDE ([VendorNo], [DisplayName], [BcCompanyId], [BcLastModified]);

  COMMIT TRANSACTION;
  PRINT 'ErpVendors table and indexes are present in Rocks_ERP_Data.';
END
GO
