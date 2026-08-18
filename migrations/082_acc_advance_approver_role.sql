-- =============================================
-- Migration: AccAdvanceApprover.ApproverRole — AP-2's two accounting levels
-- Database: Rocks_Portal_Form_UAT (AP-2 is a UAT pilot)
-- Apply: npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/082_acc_advance_approver_role.sql
--
-- AP-2's account approval is two levels (no line-manager step):
--   HEAD_ACC     → Head Accounting (first approval)
--   ACC_OFFICER  → Accounting Officer (final; picks payment date + checks)
-- Both map onto the existing MANAGER/ACCOUNT step codes on AccApproval so the
-- shared CK_AccApproval_Step constraint (MANAGER|ACCOUNT) is untouched:
--   MANAGER step row  ← HEAD_ACC approvers
--   ACCOUNT step row  ← ACC_OFFICER approvers
--
-- Column and its CHECK are in separate batches: a CHECK that names a column
-- added in the same batch fails to compile ("Invalid column name").
-- =============================================

IF COL_LENGTH('dbo.AccAdvanceApprover', 'ApproverRole') IS NULL
  ALTER TABLE [dbo].[AccAdvanceApprover]
    ADD [ApproverRole] NVARCHAR(20) NOT NULL
        CONSTRAINT DF_AccAdvanceApprover_Role DEFAULT ('ACC_OFFICER');
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_AccAdvanceApprover_Role')
  ALTER TABLE [dbo].[AccAdvanceApprover]
    ADD CONSTRAINT CK_AccAdvanceApprover_Role
        CHECK ([ApproverRole] IN ('HEAD_ACC', 'ACC_OFFICER'));
GO

PRINT '=== Migration 082 complete (AccAdvanceApprover.ApproverRole) ===';
GO
