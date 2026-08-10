-- =============================================
-- Migration: claim brand → Brand Config target for ERP Interface
-- Database: Fast_Form
-- Apply: npm run apply-sql -- --db Fast_Form --file migrations/030_acc_brand_erp_interface_target.sql
--
-- BrandCode = AP-1 claim brand (ROCKS, PCTH, …)
-- InterfaceBrandCode = Brand Config brand whose BC Id/Name/Connect is used (PCTH, KSI, …)
-- =============================================

IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('[dbo].[AccBrandErpInterface]') AND name = 'BcConnectionCode'
)
BEGIN
  IF EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('[dbo].[AccBrandErpInterface]') AND name = 'IX_AccBrandErpInterface_Connect'
  )
    DROP INDEX [IX_AccBrandErpInterface_Connect] ON [dbo].[AccBrandErpInterface];

  ALTER TABLE [dbo].[AccBrandErpInterface] DROP COLUMN [BcConnectionCode];
  PRINT 'Dropped BcConnectionCode from AccBrandErpInterface';
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('[dbo].[AccBrandErpInterface]') AND name = 'InterfaceBrandCode'
)
BEGIN
  ALTER TABLE [dbo].[AccBrandErpInterface]
    ADD [InterfaceBrandCode] NVARCHAR(20) NULL;
  PRINT 'Added InterfaceBrandCode to AccBrandErpInterface';
END
GO

IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('[dbo].[AccBrandErpInterface]') AND name = 'InterfaceBrandCode'
)
AND NOT EXISTS (
  SELECT 1 FROM [dbo].[AccBrandErpInterface] WHERE InterfaceBrandCode IS NULL
)
BEGIN
  ALTER TABLE [dbo].[AccBrandErpInterface]
    ALTER COLUMN [InterfaceBrandCode] NVARCHAR(20) NOT NULL;
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('[dbo].[AccBrandErpInterface]') AND name = 'IX_AccBrandErpInterface_Target'
)
BEGIN
  CREATE INDEX [IX_AccBrandErpInterface_Target]
    ON [dbo].[AccBrandErpInterface]([InterfaceBrandCode]);
  PRINT 'Created IX_AccBrandErpInterface_Target';
END
GO

PRINT '=== Migration 030 complete ===';
GO
