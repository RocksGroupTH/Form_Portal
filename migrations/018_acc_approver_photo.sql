-- =============================================
-- Migration: add PhotoUrl to AccApprover
-- Database: Fast_Form
-- Apply: npm run apply-sql -- --db Fast_Form --file migrations/018_acc_approver_photo.sql
-- =============================================

IF COL_LENGTH('dbo.AccApprover', 'PhotoUrl') IS NULL
BEGIN
  ALTER TABLE [dbo].[AccApprover] ADD [PhotoUrl] NVARCHAR(MAX) NULL;
  PRINT 'Added AccApprover.PhotoUrl';
END
ELSE PRINT 'AccApprover.PhotoUrl already exists - skipping';
GO

PRINT '=== Migration 018 complete ===';
GO
