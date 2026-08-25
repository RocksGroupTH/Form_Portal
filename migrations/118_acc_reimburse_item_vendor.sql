-- AP-4 expense lines record who was paid: เลขประจำตัวผู้เสียภาษี, ชื่อ/ชื่อบริษัท
-- and ที่อยู่ of the seller, read off the attached document.
--
-- Apply with (BOTH form databases, before the code deploy):
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/118_acc_reimburse_item_vendor.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/118_acc_reimburse_item_vendor.sql
--
-- NUMBERED 118. Read the highest number on *master* before picking one and
-- re-read it before merging: 117 is this branch's own, and the branch still
-- carries the unresolved 106 collision (106_acc_reimburse_access.sql here vs
-- master's 106_acc_erp_journal_batch_template_key.sql). Whoever renumbers that
-- file must not take 117 or 118.
--
-- ---------------------------------------------------------------------------
-- WHY THESE THREE ARE STORED AND NOT DERIVED. Unlike ค่าใช้จ่ายรวม and
-- จำนวนจ่ายสุทธิ, which are arithmetic on Amount and never stored, these are
-- facts about a third party that exist only on the attached document. The
-- document is kept in SharePoint, but reading a claim should not mean opening
-- every attachment to find out who was paid.
--
-- VendorTaxId IS NVARCHAR, NOT A NUMERIC TYPE. A Thai tax id is a 13-character
-- identifier, not a quantity: it can lead with a zero (0105547161674 does),
-- arithmetic on it is meaningless, and BIGINT would silently drop that zero on
-- the way in. Stored digits-only -- the application strips the grouping a
-- document prints (0-1055-47161-67-4), because a value that varies by
-- punctuation matches nothing later. NVARCHAR(20) rather than (13) leaves room
-- for a foreign registration number if that rule is ever relaxed.
--
-- ALL THREE ARE NULLABLE, WITH NO DEFAULT. Every existing row predates them and
-- is left alone: a request filed before this migration keeps working, shows
-- blanks in the three new cells, and can still be approved and paid. Nothing
-- backfills, because there is nothing to backfill from -- the values were only
-- ever on the attachment.
--
-- NO INDEX. Nothing looks a claim up by vendor today. An index on columns that
-- are only ever read back with their own row costs writes and buys nothing;
-- add one when a report actually filters on it.
--
-- IDEMPOTENT. Each ALTER is guarded on sys.columns, so a re-run is a no-op and
-- a partly-applied database completes cleanly.
-- ---------------------------------------------------------------------------

SET XACT_ABORT ON;
SET NOCOUNT ON;
GO

-- Guard: this must not be pointed at a database that has no AP-4 at all. A
-- mistyped --db would otherwise fail with a bare "Invalid object name".
IF OBJECT_ID('dbo.AccReimburseItem', 'U') IS NULL
BEGIN
  RAISERROR('dbo.AccReimburseItem does not exist here. Apply migration 088 first, and check --db.', 16, 1);
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.AccReimburseItem') AND name = 'VendorTaxId'
)
BEGIN
  ALTER TABLE [dbo].[AccReimburseItem] ADD [VendorTaxId] NVARCHAR(20) NULL;
  PRINT 'Added AccReimburseItem.VendorTaxId';
END
ELSE PRINT 'AccReimburseItem.VendorTaxId already present - skipped';
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.AccReimburseItem') AND name = 'VendorName'
)
BEGIN
  ALTER TABLE [dbo].[AccReimburseItem] ADD [VendorName] NVARCHAR(300) NULL;
  PRINT 'Added AccReimburseItem.VendorName';
END
ELSE PRINT 'AccReimburseItem.VendorName already present - skipped';
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.AccReimburseItem') AND name = 'VendorAddress'
)
BEGIN
  ALTER TABLE [dbo].[AccReimburseItem] ADD [VendorAddress] NVARCHAR(500) NULL;
  PRINT 'Added AccReimburseItem.VendorAddress';
END
ELSE PRINT 'AccReimburseItem.VendorAddress already present - skipped';
GO

-- Post-apply check: all three present, all three nullable.
SELECT name, TYPE_NAME(system_type_id) AS type, max_length, is_nullable
FROM sys.columns
WHERE object_id = OBJECT_ID('dbo.AccReimburseItem')
  AND name IN ('VendorTaxId', 'VendorName', 'VendorAddress')
ORDER BY name;
GO
