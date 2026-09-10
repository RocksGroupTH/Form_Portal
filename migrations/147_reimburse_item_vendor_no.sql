-- 147_reimburse_item_vendor_no.sql
-- Target: Rocks_Portal_Form AND Rocks_Portal_Form_UAT — apply to BOTH, before the code.
--
-- The BC vendor card an AP-4 expense line posts against, chosen by accounting on
-- คิวอนุมัติ (บัญชี) beside the G/L account it already picks there.
--
-- Design: docs/superpowers/specs/2026-09-10-ap4-vendor-on-the-accounting-queue-design.md
--
-- CHOSEN, NEVER DERIVED, and not the same fact as the seller already on the row.
-- AccReimburseItem carries VendorName / VendorTaxId / VendorAddress (migration
-- 118) — the seller as PRINTED ON THE RECEIPT, read by the AI and owned by the
-- requester. This is accounting's answer to a different question: which vendor
-- card in Business Central to post against. One tax id maps to many cards
-- (Central Pattana has 24 under one number, one per mall, told apart only by a
-- prefix in the name), so the tax id narrows a list and a person picks from it.
-- Both are kept, and keeping both is what lets somebody check the right card was
-- chosen. Blank is ordinary and legitimate: a one-off purchase from a seller who
-- is not a vendor of ours.
--
-- NULLABLE, NO DEFAULT, NO BACKFILL. An existing line reads NULL, which is
-- honest — nobody has chosen a vendor for it — where a default would claim
-- somebody had.
--
-- NOT A FOREIGN KEY. ErpVendors lives in Rocks_ERP_Data, a different database,
-- and is a mirror of Business Central rather than something this app owns.
-- Migration 143 made exactly this call for AccClearAdvanceItem.TaxVendorNo.
--
-- NVARCHAR(20) matches ErpVendors.VendorNo and AccClearAdvanceItem.TaxVendorNo.
--
-- *** BOTH FORM DATABASES, BEFORE THE CODE ***
-- SQL Server binds column names at COMPILE time, so this column missing from
-- EITHER database is "Invalid object name" — the whole query fails rather than
-- answering NULL — and AP-4 resolves either database depending on who is asking.
-- Same hazard migrations 090, 120 and 144 already carry.
--
-- check:alignment MUST STILL READ 28 TABLES afterwards. AccReimburseItem is
-- transactional: not dual-written, not in MASTER_TABLES. A count of 29 means the
-- wrong table was altered. (That command already reports FAIL today, on
-- pre-existing identity drift across four AP-4 config tables — see the design's
-- §9. The count is what this migration must not move.)

SET NOCOUNT ON;
SET XACT_ABORT ON;

IF OBJECT_ID('dbo.AccReimburseItem', 'U') IS NULL
BEGIN
  RAISERROR ('Migration 147 expects dbo.AccReimburseItem — wrong database? Apply 088 first.', 16, 1);
END
ELSE
BEGIN
  IF COL_LENGTH('dbo.AccReimburseItem', 'VendorNo') IS NULL
  BEGIN
    ALTER TABLE [dbo].[AccReimburseItem] ADD [VendorNo] NVARCHAR(20) NULL;
    PRINT 'Added AccReimburseItem.VendorNo';
  END
  ELSE PRINT 'AccReimburseItem.VendorNo already present - skipped';
END
