-- 096: AP-2 owns its own Branch dimension (override AP-1's brand default).
-- Apply on BOTH Rocks_Portal_Form AND Rocks_Portal_Form_UAT.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.AccAdvanceInterfaceConfig') AND name = 'BranchCode'
)
  ALTER TABLE dbo.AccAdvanceInterfaceConfig ADD BranchCode NVARCHAR(50) NULL;
GO
PRINT '=== Migration 096 complete (AccAdvanceInterfaceConfig.BranchCode) ===';
GO
