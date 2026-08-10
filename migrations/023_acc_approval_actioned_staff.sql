-- =============================================
-- Migration: ActionedByStaffId on AccApproval
-- Database: Fast_Form
-- Apply: npm run apply-sql -- --db Fast_Form --file migrations/023_acc_approval_actioned_staff.sql
-- =============================================

IF COL_LENGTH('dbo.AccApproval', 'ActionedByStaffId') IS NULL
BEGIN
  ALTER TABLE [dbo].[AccApproval] ADD [ActionedByStaffId] INT NULL;
  CREATE INDEX [IX_AccApproval_ActionedByStaffId] ON [dbo].[AccApproval]([ActionedByStaffId]);
  PRINT 'Added AccApproval.ActionedByStaffId';
END
ELSE PRINT 'AccApproval.ActionedByStaffId already exists - skipping';
GO

PRINT '=== Migration 023 complete ===';
GO
