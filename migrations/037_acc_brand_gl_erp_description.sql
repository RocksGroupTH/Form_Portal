-- =============================================
-- Migration: AP-1 G/L ERP journal description per claim brand
-- Database: Fast_Form
-- Apply: npm run apply-sql -- --db Fast_Form --file migrations/037_acc_brand_gl_erp_description.sql
-- =============================================

USE [Fast_Form];
GO

IF COL_LENGTH('dbo.AccBrandGlAccount', 'ErpDescription') IS NULL
BEGIN
  ALTER TABLE [dbo].[AccBrandGlAccount]
    ADD [ErpDescription] NVARCHAR(500) NULL;
  PRINT 'Added AccBrandGlAccount.ErpDescription';
END
ELSE PRINT 'AccBrandGlAccount.ErpDescription already exists — skipping';
GO

PRINT '=== Migration 037 complete ===';
GO
