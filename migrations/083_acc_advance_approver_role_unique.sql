-- =============================================
-- Migration: AccAdvanceApprover unique per (Email, ApproverRole)
-- Database: Rocks_Portal_Form_UAT
-- Apply: npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/083_acc_advance_approver_role_unique.sql
--
-- One person may serve at both levels (Head Accounting and Accounting Officer),
-- so uniqueness is per (Email, ApproverRole) rather than Email alone.
-- =============================================

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_AccAdvanceApprover_Email'
           AND object_id = OBJECT_ID('dbo.AccAdvanceApprover'))
  DROP INDEX UX_AccAdvanceApprover_Email ON [dbo].[AccAdvanceApprover];
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_AccAdvanceApprover_EmailRole'
               AND object_id = OBJECT_ID('dbo.AccAdvanceApprover'))
  CREATE UNIQUE INDEX UX_AccAdvanceApprover_EmailRole
    ON [dbo].[AccAdvanceApprover] ([Email], [ApproverRole]);
GO

PRINT '=== Migration 083 complete (unique per Email+ApproverRole) ===';
GO
