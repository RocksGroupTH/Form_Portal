-- AP-4 expense lines gain the three identifying columns the AP-4.1 sheet has:
-- เลขที่เอกสาร, รายการ and สาขา.
--
-- Apply with (BOTH form databases, before the code deploy):
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/117_acc_reimburse_item_ap41_columns.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/117_acc_reimburse_item_ap41_columns.sql
--
-- NUMBERED 117 because 106 was taken twice on this branch at the time. That
-- collision is closed: the AP-4 access migration was renumbered to 120 on
-- 2026-08-25. Read the highest number on *master* before picking one, and
-- re-read it before merging.
--
-- ---------------------------------------------------------------------------
-- WHY THREE COLUMNS AND NOT FIVE. The AP-4.1 sheet has eleven columns; five of
-- them are money. Only three are new *stored* facts:
--
--   ใช้จ่ายก่อนภาษีมูลค่าเพิ่ม = Amount - VatAmount   (derived)
--   ค่าใช้จ่ายรวม              = Amount               (already stored)
--   จำนวนจ่ายสุทธิ             = Amount - WhtAmount   (derived)
--
-- Storing all five would give a line five money columns that must agree, and
-- nothing to say which one is right when a rounding difference puts two of them
-- at odds. `Amount` stays the single authority for what a line costs — it is
-- what `sumReimburseItems` totals, what `validateItemMoney` gates at submit,
-- and what every already-submitted request holds.
--
-- ALL THREE ARE NULLABLE, WITH NO DEFAULT. Every existing row predates them and
-- is left alone: a request filed before this migration keeps working, shows
-- blanks in the three new cells, and can still be approved and paid. Nothing
-- backfills, because there is nothing to backfill from — the values were only
-- ever in the attached workbook.
--
-- `Category` holds free text such as 'AP-4.2'. There is deliberately no master
-- table and no CHECK: the sheet's own list is a convention the accounting team
-- changes without asking anybody, and a constraint here would turn that into a
-- migration. If a fixed list is ever wanted, it belongs in a settings table
-- beside AccReimburseRule, not in this column's definition.
--
-- WIDTHS. Matched to what the column actually holds rather than to
-- Description's 500: a document number and a branch name are short, and a
-- generous NVARCHAR on a table read for every claim buys nothing.
--
-- IDEMPOTENT. Each ALTER is guarded on sys.columns, so a re-run is a no-op and
-- a partly-applied database completes cleanly.
-- ---------------------------------------------------------------------------

SET XACT_ABORT ON;
SET NOCOUNT ON;
GO

-- Guard: this must not be pointed at a database that has no AP-4 at all. A
-- mistyped --db would otherwise fail with a bare "Invalid object name" three
-- batches later, after the first ALTER had already been reported as skipped.
IF OBJECT_ID('dbo.AccReimburseItem', 'U') IS NULL
BEGIN
  RAISERROR('dbo.AccReimburseItem does not exist here. Apply migration 088 first, and check --db.', 16, 1);
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.AccReimburseItem') AND name = 'DocumentNo'
)
BEGIN
  ALTER TABLE [dbo].[AccReimburseItem] ADD [DocumentNo] NVARCHAR(100) NULL;
  PRINT 'Added AccReimburseItem.DocumentNo';
END
ELSE PRINT 'AccReimburseItem.DocumentNo already present - skipped';
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.AccReimburseItem') AND name = 'Category'
)
BEGIN
  ALTER TABLE [dbo].[AccReimburseItem] ADD [Category] NVARCHAR(50) NULL;
  PRINT 'Added AccReimburseItem.Category';
END
ELSE PRINT 'AccReimburseItem.Category already present - skipped';
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.AccReimburseItem') AND name = 'BranchName'
)
BEGIN
  ALTER TABLE [dbo].[AccReimburseItem] ADD [BranchName] NVARCHAR(200) NULL;
  PRINT 'Added AccReimburseItem.BranchName';
END
ELSE PRINT 'AccReimburseItem.BranchName already present - skipped';
GO

-- Post-apply check: all three present, all three nullable.
SELECT name, TYPE_NAME(system_type_id) AS type, max_length, is_nullable
FROM sys.columns
WHERE object_id = OBJECT_ID('dbo.AccReimburseItem')
  AND name IN ('DocumentNo', 'Category', 'BranchName')
ORDER BY name;
GO
