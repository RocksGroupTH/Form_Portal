-- =============================================
-- Migration: AP-1 brand ERP fixed Dept code from ERP dimension
-- Database: Fast_Form
-- Apply: npm run apply-sql -- --db Fast_Form --file migrations/042_acc_brand_fixed_erp_dept.sql
-- =============================================

USE [Fast_Form];
GO

IF COL_LENGTH('dbo.AccBrandBranchCode', 'FixedErpDeptCode') IS NULL
BEGIN
  ALTER TABLE [dbo].[AccBrandBranchCode]
    ADD [FixedErpDeptCode] NVARCHAR(50) NULL;
  PRINT 'Added AccBrandBranchCode.FixedErpDeptCode';
END
ELSE PRINT 'AccBrandBranchCode.FixedErpDeptCode already exists — skipping';
GO

PRINT '=== Migration 042 complete ===';
GO
