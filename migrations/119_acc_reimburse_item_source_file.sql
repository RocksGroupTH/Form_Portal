-- An AP-4 expense line records which attachment it was read from, so removing
-- the document removes the lines it created — after a reload as well as before.
--
-- Apply with (BOTH form databases, before the code deploy):
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/119_acc_reimburse_item_source_file.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/119_acc_reimburse_item_source_file.sql
--
-- NUMBERED 119. Read the highest number on *master* before picking one and
-- re-read it before merging. The 106 collision this file used to warn about is
-- closed: the AP-4 access migration was renumbered to 120 on 2026-08-25.
--
-- ---------------------------------------------------------------------------
-- WHY IT IS STORED AT ALL. Attaching a document creates expense rows from it.
-- Until this column, the link between the two lived only in browser state, so
-- deleting an attachment removed its rows before the first save and silently
-- left them behind afterwards -- the same gesture doing two different things
-- depending on when it happened.
--
-- DELIBERATELY NOT A FOREIGN KEY, for the reason migration 088 gives about
-- AccReimburse.ExcelFileId: a file row is removed by the delete route, which
-- would otherwise have to reorder its work around a constraint, and a dangling
-- id here is harmless -- it means "the document this came from is gone", which
-- is exactly what the application then shows. The application clears it in the
-- same transaction as the delete; nothing depends on the database refusing.
--
-- NULLABLE, WITH NO DEFAULT. Every existing row predates the column, and a row
-- typed by hand through "เพิ่มรายการ" has no source document at all -- NULL is
-- a real and common answer, not a missing value. Nothing backfills: there is
-- nothing to backfill from.
--
-- NO INDEX. The lookup is always "the rows of this request", already covered by
-- IX_AccReimburseItem_Request, and the source id is then compared in memory
-- over a handful of rows. An index here would cost writes and buy nothing.
--
-- IDEMPOTENT. The ALTER is guarded on sys.columns, so a re-run is a no-op.
-- ---------------------------------------------------------------------------

SET XACT_ABORT ON;
SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.AccReimburseItem', 'U') IS NULL
BEGIN
  RAISERROR('dbo.AccReimburseItem does not exist here. Apply migration 088 first, and check --db.', 16, 1);
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.AccReimburseItem') AND name = 'SourceFileId'
)
BEGIN
  ALTER TABLE [dbo].[AccReimburseItem] ADD [SourceFileId] INT NULL;
  PRINT 'Added AccReimburseItem.SourceFileId';
END
ELSE PRINT 'AccReimburseItem.SourceFileId already present - skipped';
GO

-- Post-apply check: present, nullable, int.
SELECT name, TYPE_NAME(system_type_id) AS type, is_nullable
FROM sys.columns
WHERE object_id = OBJECT_ID('dbo.AccReimburseItem') AND name = 'SourceFileId';
GO
