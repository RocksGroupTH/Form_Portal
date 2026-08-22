-- =============================================
-- Migration: allow AP-3 drafts to be saved before an advance is chosen
-- Database: Rocks_Portal_Form (+ Rocks_Portal_Form_UAT)
-- Apply: npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/099_clr_advance_nullable.sql
--        npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/099_clr_advance_nullable.sql
--
-- AccClearAdvance.AdvanceRequestId was NOT NULL, which blocked saving a draft
-- before the requester picks the AP-2 advance to clear. The advance is required
-- only at submit (enforced in the service), so the column must allow NULL for drafts.
-- Idempotent (only alters if currently NOT NULL). The FK/index are unaffected.
-- =============================================

IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.AccClearAdvance')
    AND name = 'AdvanceRequestId' AND is_nullable = 0
)
BEGIN
  ALTER TABLE [dbo].[AccClearAdvance] ALTER COLUMN [AdvanceRequestId] INT NULL;
  PRINT 'AccClearAdvance.AdvanceRequestId -> NULLable';
END
ELSE PRINT 'AccClearAdvance.AdvanceRequestId already nullable — skipping';
GO

PRINT '=== Migration 099 complete ===';
GO
