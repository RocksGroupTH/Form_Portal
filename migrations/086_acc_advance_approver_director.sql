-- =============================================
-- Migration: allow DIRECTOR as an AccAdvanceApprover role
-- Database: Rocks_Portal_Form_UAT
-- Apply: npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/086_acc_advance_approver_director.sql
--
-- Approver roles now: HEAD_ACC, ACC_OFFICER, DIRECTOR. (HEAD_DEPT is not a
-- configured approver — it resolves to the requester's manager at submit.)
-- =============================================

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_AccAdvanceApprover_Role')
  ALTER TABLE [dbo].[AccAdvanceApprover] DROP CONSTRAINT CK_AccAdvanceApprover_Role;
GO

ALTER TABLE [dbo].[AccAdvanceApprover]
  ADD CONSTRAINT CK_AccAdvanceApprover_Role
      CHECK ([ApproverRole] IN ('HEAD_ACC', 'ACC_OFFICER', 'DIRECTOR'));
GO

PRINT '=== Migration 086 complete (DIRECTOR role allowed) ===';
GO
