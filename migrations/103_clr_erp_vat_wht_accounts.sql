-- =============================================
-- Migration: AP-3 Phase 2 — per-brand VAT-input + WHT-payable GL accounts.
-- Database: Rocks_Portal_Form (+ Rocks_Portal_Form_UAT)
-- Apply: npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/103_clr_erp_vat_wht_accounts.sql
--        npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/103_clr_erp_vat_wht_accounts.sql
--
-- The clearing journal debits VAT input (ภาษีซื้อ) and credits WHT payable
-- (ภาษีหัก ณ ที่จ่ายค้างจ่าย). These two GL accounts are configured per brand,
-- alongside the existing Journal Batch. NULL until set; only required at send
-- time when a request actually carries VAT / WHT.
-- =============================================
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.AccClearAdvanceInterfaceConfig') AND name = 'VatInputGlAccountNo')
BEGIN
  ALTER TABLE [dbo].[AccClearAdvanceInterfaceConfig] ADD [VatInputGlAccountNo] NVARCHAR(20) NULL;
  PRINT 'Added VatInputGlAccountNo';
END
ELSE PRINT 'VatInputGlAccountNo already exists — skipping';
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.AccClearAdvanceInterfaceConfig') AND name = 'WhtPayableGlAccountNo')
BEGIN
  ALTER TABLE [dbo].[AccClearAdvanceInterfaceConfig] ADD [WhtPayableGlAccountNo] NVARCHAR(20) NULL;
  PRINT 'Added WhtPayableGlAccountNo';
END
ELSE PRINT 'WhtPayableGlAccountNo already exists — skipping';
GO
PRINT '=== Migration 103 complete ===';
GO
