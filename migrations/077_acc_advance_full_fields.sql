-- =============================================
-- Migration: AccAdvance full AP-2 fields — payee, bank, currency/FX
-- Database: Rocks_Portal_Form (+ Rocks_Portal_Form_UAT)
-- Apply: npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/077_acc_advance_full_fields.sql
--        npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/077_acc_advance_full_fields.sql
--
-- Adds the AP-2 fields the Excel form has beyond Phase-1 minimal:
--   PayeeType  employee | vendor          (โอนให้ พนักงาน/คู่ค้า)
--   PayeeName  ชื่อคู่ค้า/พนักงาน
--   PayeeBankAccount / PayeeBankCode      เลขที่บัญชี / ธนาคาร (FK-ish AccBankMaster.BankCode)
--   ExchangeRate / BaseAmount             อัตราแลกเปลี่ยน (BOT) + ยอดเป็นบาท (Amount×Rate)
-- Currency already exists (062). All nullable — additive, safe.
-- =============================================

IF COL_LENGTH('dbo.AccAdvance', 'PayeeType') IS NULL
  ALTER TABLE [dbo].[AccAdvance] ADD [PayeeType] NVARCHAR(20) NULL;
GO
IF COL_LENGTH('dbo.AccAdvance', 'PayeeName') IS NULL
  ALTER TABLE [dbo].[AccAdvance] ADD [PayeeName] NVARCHAR(200) NULL;
GO
IF COL_LENGTH('dbo.AccAdvance', 'PayeeBankAccount') IS NULL
  ALTER TABLE [dbo].[AccAdvance] ADD [PayeeBankAccount] NVARCHAR(50) NULL;
GO
IF COL_LENGTH('dbo.AccAdvance', 'PayeeBankCode') IS NULL
  ALTER TABLE [dbo].[AccAdvance] ADD [PayeeBankCode] NVARCHAR(10) NULL;
GO
IF COL_LENGTH('dbo.AccAdvance', 'ExchangeRate') IS NULL
  ALTER TABLE [dbo].[AccAdvance] ADD [ExchangeRate] DECIMAL(18,6) NULL;
GO
IF COL_LENGTH('dbo.AccAdvance', 'BaseAmount') IS NULL
  ALTER TABLE [dbo].[AccAdvance] ADD [BaseAmount] DECIMAL(18,2) NULL;
GO

PRINT '=== Migration 066 complete ===';
GO
