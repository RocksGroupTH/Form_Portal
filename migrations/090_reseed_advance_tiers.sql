-- 090: Align AP-2 approval tier matrix — HEAD_DEPT retired (Head Accounting is the
-- first step, not the requester's line manager). Matches the corrected UAT matrix.
-- Idempotent: sets Steps per amount band.
-- Apply on Rocks_Portal_Form AND Rocks_Portal_Form_UAT.

UPDATE dbo.AccAdvanceApprovalTier SET Steps = 'HEAD_ACC,ACC_OFFICER'
  WHERE MinAmount = 0;
UPDATE dbo.AccAdvanceApprovalTier SET Steps = 'HEAD_ACC,ACC_OFFICER'
  WHERE MinAmount = 10000.01;
UPDATE dbo.AccAdvanceApprovalTier SET Steps = 'HEAD_ACC,DIRECTOR,ACC_OFFICER'
  WHERE MinAmount = 100000.01;
GO
PRINT '=== Migration 090 complete (tiers aligned, HEAD_DEPT retired) ===';
GO
