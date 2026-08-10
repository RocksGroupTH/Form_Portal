-- =============================================
-- Migration: Allow 'Completed' in AccRequest.Status (AP-17 terminal status)
-- Database: Fast_Form
-- Apply: npm run apply-sql -- --db Fast_Form --file migrations/050_acc_request_status_completed.sql
--
-- migration 013 created CK_AccRequest_Status as
--   CHECK ([Status] IN ('Draft','Submitted','ManagerApproved','Approved','Rejected','Returned','Cancelled'))
-- AP-17 (migration 048) uses 'Completed' as its terminal status instead of 'Approved',
-- which the existing constraint does not allow. Drop + recreate with the same value
-- list plus 'Completed'. Idempotent — only runs when 'Completed' isn't already allowed.
-- =============================================

IF NOT EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = 'CK_AccRequest_Status'
    AND parent_object_id = OBJECT_ID('dbo.AccRequest')
    AND definition LIKE '%Completed%'
)
BEGIN
  ALTER TABLE [dbo].[AccRequest] DROP CONSTRAINT [CK_AccRequest_Status];
  ALTER TABLE [dbo].[AccRequest] ADD CONSTRAINT [CK_AccRequest_Status] CHECK ([Status] IN
    ('Draft','Submitted','ManagerApproved','Approved','Rejected','Returned','Cancelled','Completed'));
  PRINT 'Recreated CK_AccRequest_Status to allow Completed';
END
ELSE PRINT 'CK_AccRequest_Status already allows Completed — skipping';
GO

PRINT '=== Migration 050 complete ===';
GO
