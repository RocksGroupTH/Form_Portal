-- =============================================
-- Migration: AP-1 brand → BC Interface connect mapping
-- Database: Fast_Form
-- Apply: npm run apply-sql -- --db Fast_Form --file migrations/029_acc_brand_erp_interface.sql
--
-- Maps claim brand (ROCKS, PCTH, …) to BcConnection code (PC, KSI, UNO, …)
-- for Interface ERP export — separate from BrandConfig BC Id/Name.
-- =============================================

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AccBrandErpInterface')
BEGIN
  CREATE TABLE [dbo].[AccBrandErpInterface] (
    [Id]               INT            IDENTITY(1,1) NOT NULL,
    [BrandCode]        NVARCHAR(20)   NOT NULL,
    [BcConnectionCode] NVARCHAR(50)   NOT NULL,
    [CreatedBy]        INT            NULL,
    [CreatedAt]        DATETIME2      NOT NULL CONSTRAINT [DF_AccBrandErpInterface_CreatedAt] DEFAULT SYSDATETIME(),
    [UpdatedAt]        DATETIME2      NOT NULL CONSTRAINT [DF_AccBrandErpInterface_UpdatedAt] DEFAULT SYSDATETIME(),
    CONSTRAINT [PK_AccBrandErpInterface] PRIMARY KEY ([Id]),
    CONSTRAINT [UQ_AccBrandErpInterface_Brand] UNIQUE ([BrandCode])
  );

  CREATE INDEX [IX_AccBrandErpInterface_Connect]
    ON [dbo].[AccBrandErpInterface]([BcConnectionCode]);

  PRINT 'Created AccBrandErpInterface';
END
ELSE PRINT 'AccBrandErpInterface already exists — skipping';
GO

PRINT '=== Migration 029 complete ===';
GO
