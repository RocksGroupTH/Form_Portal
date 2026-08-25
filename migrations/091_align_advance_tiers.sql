-- 091: Pin the AP-2 tier matrix to identical rows + identical ids in every form
-- database, so the dual-write by-id UPDATE/DELETE path stays aligned once AP-2
-- follows per-form routing. Supersedes 090 (which only aligned Steps).
--
-- Safe: tiers are a fixed 3-row matrix with no FK from any request row
-- (approvals store the resolved step list, not a tier id). Apply on BOTH
-- Rocks_Portal_Form AND Rocks_Portal_Form_UAT.

DELETE FROM dbo.AccAdvanceApprovalTier;
GO
SET IDENTITY_INSERT dbo.AccAdvanceApprovalTier ON;
INSERT INTO dbo.AccAdvanceApprovalTier (Id, MinAmount, MaxAmount, Steps, IsActive, SortOrder) VALUES
  (1, 0,          10000,  'HEAD_ACC,ACC_OFFICER',          1, 0),
  (2, 10000.01,   100000, 'HEAD_ACC,ACC_OFFICER',          1, 1),
  (3, 100000.01,  NULL,   'HEAD_ACC,DIRECTOR,ACC_OFFICER', 1, 2);
SET IDENTITY_INSERT dbo.AccAdvanceApprovalTier OFF;
GO
PRINT '=== Migration 091 complete (tiers aligned, ids 1-3) ===';
GO
