-- =============================================
-- Migration: AccBrandGlAccount.FormCode — per-form G/L config
-- Database: Rocks_Portal_Form (+ Rocks_Portal_Form_UAT)
-- Apply: npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/075_acc_brand_gl_formcode.sql
--        npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/075_acc_brand_gl_formcode.sql
--
-- ⚠️ HIGH RISK — pairs with the brand-account-service.ts code change (T1.7).
--    หลังรัน migration นี้ AP-1 caller ต้อง filter FormCode='AP-1' explicit
--    ไม่งั้น AP-1 อาจดึง G/L ของฟอร์มอื่นมา. อย่ารันบน Production ก่อน T1.7 merge.
--
-- เหตุผล: G/L ค่าเดินทาง (AP-1) != G/L เงินทดรองจ่าย (AP-2) — ต้องแยก config ต่อฟอร์ม.
--         backfill row เดิมทั้งหมด = 'AP-1' (backward-compatible).
-- =============================================

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.AccBrandGlAccount') AND name = 'FormCode'
)
BEGIN
  ALTER TABLE [dbo].[AccBrandGlAccount] ADD [FormCode] NVARCHAR(20) NULL;
  PRINT 'Added AccBrandGlAccount.FormCode';
END
ELSE PRINT 'AccBrandGlAccount.FormCode already exists — skipping';
GO

-- Backfill: row เดิมทั้งหมด = AP-1 (config G/L ที่มีอยู่คือของ AP-1)
UPDATE [dbo].[AccBrandGlAccount]
SET [FormCode] = 'AP-1'
WHERE [FormCode] IS NULL;
PRINT 'Backfilled AccBrandGlAccount.FormCode = AP-1';
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_AccBrandGlAccount_FormCode' AND object_id = OBJECT_ID('dbo.AccBrandGlAccount')
)
BEGIN
  CREATE INDEX [IX_AccBrandGlAccount_FormCode]
    ON [dbo].[AccBrandGlAccount]([FormCode], [BrandCode], [IsActive], [SortOrder]);
  PRINT 'Created IX_AccBrandGlAccount_FormCode';
END
ELSE PRINT 'IX_AccBrandGlAccount_FormCode already exists — skipping';
GO

PRINT '=== Migration 064 complete ===';
GO
