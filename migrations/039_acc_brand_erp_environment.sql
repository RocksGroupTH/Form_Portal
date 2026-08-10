-- Migration: UAT company + connection per Interface ERP target brand
-- Database: Fast_Form
-- Apply: npm run apply-sql -- --db Fast_Form --file migrations/039_acc_brand_erp_environment.sql

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('[dbo].[AccBrandErpTargetSetting]') AND name = 'BcUatId'
)
BEGIN
  ALTER TABLE [dbo].[AccBrandErpTargetSetting]
    ADD [BcUatId]           NVARCHAR(100) NULL,
        [BcUatName]         NVARCHAR(200) NULL,
        [BcUatConnectionId] INT           NULL;
  PRINT 'Added UAT columns to AccBrandErpTargetSetting';
END
ELSE PRINT 'AccBrandErpTargetSetting UAT columns already exist — skipping';
GO

PRINT '=== Migration 039 complete ===';
GO
