-- The lines printed inside one attached document — what a quotation or tax
-- invoice itemises under the single charge an AP-4 row records.
--
-- Apply with (BOTH form databases, before the code deploy):
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/121_acc_reimburse_item_detail.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/121_acc_reimburse_item_detail.sql
--
-- NUMBERED 121. Read the highest number on *master* before picking one and
-- re-read it before merging.
--
-- ---------------------------------------------------------------------------
-- WHY A CHILD TABLE AND NOT A JSON COLUMN. Both were on the table. A JSON blob
-- on AccReimburseItem would ride along with its row for free, which matters
-- here more than usual (see the next paragraph) -- but these lines are rows a
-- person reads and may one day want to search, and a column nothing can query
-- is a decision that is expensive to undo later.
--
-- THE PARENT'S Id IS NOT STABLE, AND THIS TABLE HAS TO BE WRITTEN WITH THAT IN
-- MIND. `persistReimburseItems` replaces a request's items wholesale -- DELETE
-- every row for the request, then INSERT the new set -- so an item's Id changes
-- on every single save. ON DELETE CASCADE is what makes that safe: the existing
-- delete takes the detail rows with it, and the insert path re-reads each new
-- Id from OUTPUT INSERTED.Id before writing the lines back. A detail row can
-- therefore never outlive the item it describes, and never attach itself to a
-- later item that happens to reuse the number.
--
-- CASCADE IS A CHAIN, NOT A SECOND PATH. AccRequest -> AccReimburseItem is
-- already ON DELETE CASCADE (migration 088); this adds
-- AccReimburseItem -> AccReimburseItemDetail below it. One route from the root
-- to each row, which is what SQL Server requires.
--
-- DESCRIPTION IS NOT NULL. A line with no description is dropped before it
-- reaches storage: it is the only part that makes a line readable, and a row of
-- bare numbers under a charge tells a reader less than no row at all. The
-- three money columns are nullable because a document routinely prints a
-- service line with an amount and no quantity or unit price.
--
-- NOTHING HERE IS SUMMED. These lines are a transcription of what the document
-- says, not a second source of truth for what the claim is worth --
-- AccReimburseItem.Amount remains that, and no code totals this table.
--
-- TRANSACTIONAL, NOT CONFIGURATION. Not dual-written, not in MASTER_TABLES; it
-- belongs to a request the way AccReimburseItem does.
--
-- IDEMPOTENT. Guarded on sys.tables, so a re-run is a no-op.
-- ---------------------------------------------------------------------------

SET XACT_ABORT ON;
SET NOCOUNT ON;
GO

IF OBJECT_ID('dbo.AccReimburseItem', 'U') IS NULL
BEGIN
  RAISERROR('dbo.AccReimburseItem does not exist here. Apply migration 088 first, and check --db.', 16, 1);
END
GO

IF OBJECT_ID('dbo.AccReimburseItemDetail', 'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[AccReimburseItemDetail] (
    [Id]          INT IDENTITY(1,1) NOT NULL
                  CONSTRAINT [PK_AccReimburseItemDetail] PRIMARY KEY,
    [ItemId]      INT NOT NULL,
    [SortOrder]   INT NOT NULL
                  CONSTRAINT [DF_AccReimburseItemDetail_Sort] DEFAULT (0),
    [Description] NVARCHAR(500) NOT NULL,
    [Quantity]    DECIMAL(18,2) NULL,
    [UnitPrice]   DECIMAL(18,2) NULL,
    [Amount]      DECIMAL(18,2) NULL,
    CONSTRAINT [FK_AccReimburseItemDetail_Item] FOREIGN KEY ([ItemId])
      REFERENCES [dbo].[AccReimburseItem]([Id]) ON DELETE CASCADE
  );
  PRINT 'Created AccReimburseItemDetail';
END
ELSE PRINT 'AccReimburseItemDetail already present - skipped';
GO

-- The only way this table is ever read: every line of one item, in order.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AccReimburseItemDetail_Item')
  CREATE INDEX [IX_AccReimburseItemDetail_Item]
    ON [dbo].[AccReimburseItemDetail] ([ItemId], [SortOrder]);
GO

-- Post-apply check: the table, its cascade, and its index.
SELECT
  (SELECT COUNT(*) FROM sys.tables WHERE name = 'AccReimburseItemDetail')            AS tablePresent,
  (SELECT delete_referential_action_desc FROM sys.foreign_keys
    WHERE name = 'FK_AccReimburseItemDetail_Item')                                   AS onDelete,
  (SELECT COUNT(*) FROM sys.indexes WHERE name = 'IX_AccReimburseItemDetail_Item')   AS indexPresent;
GO
