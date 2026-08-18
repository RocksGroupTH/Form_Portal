-- Migration: AccAdvance.OverThresholdReason — เหตุผลเพิ่มเติมเมื่อยอด > 3,000 (แทนการบล็อก)
-- Apply: npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/087_acc_advance_over_threshold_reason.sql
IF COL_LENGTH('dbo.AccAdvance', 'OverThresholdReason') IS NULL
  ALTER TABLE [dbo].[AccAdvance] ADD [OverThresholdReason] NVARCHAR(1000) NULL;
GO
PRINT '=== Migration 087 complete (AccAdvance.OverThresholdReason) ===';
GO
