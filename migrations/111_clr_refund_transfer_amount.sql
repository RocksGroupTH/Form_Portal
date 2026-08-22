-- =============================================
-- Migration: AP-3 store the actual refund-transfer amount (from the slip)
-- Database: Rocks_Portal_Form (+ Rocks_Portal_Form_UAT)
-- Apply: npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/100_clr_refund_transfer_amount.sql
--        npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/100_clr_refund_transfer_amount.sql
--
-- The refund-transfer section now has an editable amount field, defaulted from
-- the slip via OCR. Nullable (only used when money is returned to the company).
-- Idempotent.
-- =============================================
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.AccClearAdvance') AND name = 'RefundTransferAmount'
)
BEGIN
  ALTER TABLE [dbo].[AccClearAdvance] ADD [RefundTransferAmount] DECIMAL(18,2) NULL;
  PRINT 'Added AccClearAdvance.RefundTransferAmount';
END
ELSE PRINT 'AccClearAdvance.RefundTransferAmount already exists — skipping';
GO

PRINT '=== Migration 100 complete ===';
GO
