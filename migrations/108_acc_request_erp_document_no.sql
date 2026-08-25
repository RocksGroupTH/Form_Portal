-- 097: Store the BC Document No. returned by the PPAP CU (results[].documentNo)
-- so the "ส่งแล้ว" queue can show which BC document each advance landed in.
-- Apply on BOTH Rocks_Portal_Form AND Rocks_Portal_Form_UAT.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.AccRequest') AND name = 'ErpDocumentNo'
)
  ALTER TABLE dbo.AccRequest ADD ErpDocumentNo NVARCHAR(35) NULL;
GO
PRINT '=== Migration 097 complete (AccRequest.ErpDocumentNo) ===';
GO
