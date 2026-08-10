-- =============================================
-- Migration: AP-1 brand ERP — use Branch Code as Department dimension
-- Database: Fast_Form
-- Apply: npm run apply-sql -- --db Fast_Form --file migrations/041_acc_brand_dept_as_branch.sql
-- =============================================

USE [Fast_Form];
GO

IF COL_LENGTH('dbo.AccBrandBranchCode', 'DeptAsBranch') IS NULL
BEGIN
  ALTER TABLE [dbo].[AccBrandBranchCode]
    ADD [DeptAsBranch] BIT NOT NULL
      CONSTRAINT [DF_AccBrandBranchCode_DeptAsBranch] DEFAULT (0);
  PRINT 'Added AccBrandBranchCode.DeptAsBranch';
END
ELSE PRINT 'AccBrandBranchCode.DeptAsBranch already exists — skipping';
GO

PRINT '=== Migration 041 complete ===';
GO
