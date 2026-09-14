-- 150_reimburse_item_vendor_match.sql
-- Target: Rocks_Portal_Form AND Rocks_Portal_Form_UAT — apply to BOTH, before the code.
--
-- One column: has anybody looked for this seller's Business Central vendor
-- card, and what did they find?
--
--   NULL      nobody has looked yet
--   'none'    looked, and this seller has no card in this company
--   'auto'    filled by the matcher (an exact tax id, or the model choosing
--             from the cards that survived a name filter)
--   'manual'  an accountant picked it by hand
--
-- *** NULL AND 'none' ARE THE WHOLE POINT OF THE COLUMN ***
--
-- AP-4's accounting queue refuses to enable a claim's checkbox until every
-- expense line carries a Vendor. That is wrong twice over: Tax Vendor No.
-- travels on the VAT line and nowhere else, so a line with no VAT is complete
-- without one (AccClearAdvanceItem has had exactly this rule since AP-3), and
-- AccReimburseItem.VendorNo's own docblock already says a null is ordinary —
-- a one-off purchase from a seller who is not a vendor of ours.
--
-- The new rule is "a vendor is required when the line has VAT AND the answer
-- is not 'none'". Derived rather than stored, that reads as "not required" for
-- EVERY line from the moment the claim arrives, including the ones whose card
-- exists and has simply not been looked for — the checkbox would unlock before
-- anyone had checked anything. Only a stored verdict tells "asked, and the
-- answer is no" apart from "not asked".
--
-- 'auto' vs 'manual' is the same distinction AccAdvance.VendorConfirmedBy
-- makes for AP-2: a row a person chose stays distinguishable from one a
-- machine chose, and the re-match must not overwrite the first.
--
-- NULLABLE, NO DEFAULT, NO BACKFILL. Every line written before today reads
-- NULL, which is honest: nobody has looked. Stamping 'none' on them would
-- silently retire the requirement on claims already in the queue.
--
-- NO CHECK CONSTRAINT, deliberately. The four values are a code-side union
-- (`VendorMatchStatus` in vendor-match-core.ts) and setReimburseItemAccounts
-- is the single writer. A CHECK here would have to be migrated on both
-- databases before a fifth value could ship, and AccAdvance.VendorMatchStatus
-- — the column this one is named after — carries none either.
--
-- *** BOTH FORM DATABASES, BEFORE THE CODE ***
-- SQL Server binds column names at COMPILE time, so the column missing from
-- EITHER database is "Invalid object name" — the whole query fails rather than
-- answering NULL — and AP-4 resolves either database depending on who is
-- asking. Same hazard migrations 090, 120, 144, 147 and 149 already carry.
--
-- check:alignment MUST STILL READ 28 TABLES afterwards. AccReimburseItem is
-- transactional: not dual-written, not in MASTER_TABLES. A count of 29 means
-- the wrong table was altered.

SET NOCOUNT ON;
SET XACT_ABORT ON;

IF OBJECT_ID('dbo.AccReimburseItem', 'U') IS NULL
BEGIN
  RAISERROR ('Migration 150 expects dbo.AccReimburseItem — wrong database? Apply 088 first.', 16, 1);
END
ELSE
BEGIN
  IF COL_LENGTH('dbo.AccReimburseItem', 'VendorNo') IS NULL
  BEGIN
    RAISERROR ('Migration 150 expects AccReimburseItem.VendorNo (migration 147) — apply 147 first.', 16, 1);
  END
  ELSE IF COL_LENGTH('dbo.AccReimburseItem', 'VendorMatchStatus') IS NULL
  BEGIN
    ALTER TABLE [dbo].[AccReimburseItem] ADD [VendorMatchStatus] NVARCHAR(20) NULL;
    PRINT 'Added AccReimburseItem.VendorMatchStatus';
  END
  ELSE PRINT 'AccReimburseItem.VendorMatchStatus already present - skipped';
END
