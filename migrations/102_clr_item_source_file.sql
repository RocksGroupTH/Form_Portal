-- =============================================
-- Migration: AP-3 expense line → source receipt link.
-- Database: Rocks_Portal_Form (+ Rocks_Portal_Form_UAT)
-- Apply: npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/102_clr_item_source_file.sql
--        npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/102_clr_item_source_file.sql
--
-- Each expense line (AccClearAdvanceItem) is OCR-filled from one attached receipt
-- (1 file = 1 line). SourceFileId records which AccRequestFile it came from, so the
-- line can be cleared again when its receipt is deleted — and that link now survives
-- a page reload (the form re-hydrates SourceFileId from the DB). NULL for lines the
-- user typed by hand or created before this column existed.
-- =============================================
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.AccClearAdvanceItem') AND name = 'SourceFileId'
)
BEGIN
  ALTER TABLE [dbo].[AccClearAdvanceItem] ADD [SourceFileId] INT NULL;
  PRINT 'Added AccClearAdvanceItem.SourceFileId';
END
ELSE PRINT 'AccClearAdvanceItem.SourceFileId already exists — skipping';
GO

PRINT '=== Migration 102 complete ===';
GO
