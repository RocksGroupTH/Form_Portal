-- 149_reimburse_item_branch_codes.sql
-- Target: Rocks_Portal_Form AND Rocks_Portal_Form_UAT — apply to BOTH, before the code.
--
-- Two branch columns on AP-4's expense line, mirroring AP-3's, which is what the
-- user asked for by name ("เหมือน AP-03").
--
-- *** THEY ARE TWO DIFFERENT BRANCHES AND THE NAMES ARE WORTH READING ***
--
--   BranchCode        สาขาที่ใช้จ่าย — OURS. Which of the company's own
--                     branches the spend belongs to. Picked from the synced
--                     BC Locations (ErpLocation), which is what lets the
--                     accounting queue join it to a Business Unit; a free-text
--                     branch cannot be joined to anything. NVARCHAR(20),
--                     matching AccBranchGlMap.BranchCode (migration 146).
--
--   VendorBranchCode  สาขาผู้ขาย — THEIRS. The seller's establishment as the
--                     Revenue Department numbers it: 00000 is the head office,
--                     00001 the first branch. It reaches Business Central as
--                     the vendor's Thai Branch Code on the tax line, so it is
--                     the SELLER's and never the buyer's. NVARCHAR(5), matching
--                     AccClearAdvanceItem.TaxBranchCode (migration 141).
--
-- Putting one in the other's column posts a tax filing against the wrong
-- establishment, which is why they are separate columns rather than one
-- "branch".
--
-- BranchName (migration 117) IS KEPT AND IS NOT REPLACED. It holds the free
-- text every row written before today carries — "เซ็นทรัล พระราม9" and the
-- like — and rewriting that into a code would be a guess about where money was
-- spent. Old rows keep their words; new rows get a code beside them.
--
-- NULLABLE, NO DEFAULT, NO BACKFILL. An existing line reads NULL, which is
-- honest: nobody has chosen a branch for it. `00000` is applied by the FORM
-- when the seller's branch is left blank (the head office is overwhelmingly
-- the case and chasing the field row by row costs more than it saves) — as a
-- default the requester can see and change, never as a silent stamp on rows
-- that predate the column.
--
-- NOT FOREIGN KEYS. ErpLocation lives in Rocks_ERP_Data, a different database
-- and a mirror of Business Central; the RD's branch numbers are not ours at
-- all. Migrations 141 and 147 made the same call for the same reason.
--
-- *** BOTH FORM DATABASES, BEFORE THE CODE ***
-- SQL Server binds column names at COMPILE time, so either column missing from
-- EITHER database is "Invalid object name" — the whole query fails rather than
-- answering NULL — and AP-4 resolves either database depending on who is
-- asking. Same hazard migrations 090, 120, 144 and 147 already carry.
--
-- check:alignment MUST STILL READ 28 TABLES afterwards. AccReimburseItem is
-- transactional: not dual-written, not in MASTER_TABLES. A count of 29 means
-- the wrong table was altered.

SET NOCOUNT ON;
SET XACT_ABORT ON;

IF OBJECT_ID('dbo.AccReimburseItem', 'U') IS NULL
BEGIN
  RAISERROR ('Migration 149 expects dbo.AccReimburseItem — wrong database? Apply 088 first.', 16, 1);
END
ELSE
BEGIN
  IF COL_LENGTH('dbo.AccReimburseItem', 'BranchCode') IS NULL
  BEGIN
    ALTER TABLE [dbo].[AccReimburseItem] ADD [BranchCode] NVARCHAR(20) NULL;
    PRINT 'Added AccReimburseItem.BranchCode';
  END
  ELSE PRINT 'AccReimburseItem.BranchCode already present - skipped';

  IF COL_LENGTH('dbo.AccReimburseItem', 'VendorBranchCode') IS NULL
  BEGIN
    ALTER TABLE [dbo].[AccReimburseItem] ADD [VendorBranchCode] NVARCHAR(5) NULL;
    PRINT 'Added AccReimburseItem.VendorBranchCode';
  END
  ELSE PRINT 'AccReimburseItem.VendorBranchCode already present - skipped';
END
