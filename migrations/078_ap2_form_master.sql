-- =============================================
-- Migration: Register AP-2 in AccFormMaster (so it lists in Form Environment settings)
-- Database: Rocks_Portal_Form AND Rocks_Portal_Form_UAT (run on BOTH)
-- Apply: npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/078_ap2_form_master.sql
--        npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/078_ap2_form_master.sql
-- =============================================

IF NOT EXISTS (SELECT 1 FROM [dbo].[AccFormMaster] WHERE FormCode = 'AP-2')
  INSERT INTO [dbo].[AccFormMaster] (FormCode, GroupName, FormNameTh, FormNameEn, RunningPrefix, SortOrder)
  VALUES ('AP-2', 'Accounting', N'แบบฟอร์มขอเบิกเงินทดรองจ่าย (Advance)', 'Advance Request Form', 'ADV', 2);
GO

PRINT '=== Migration 069 complete (AP-2 registered in AccFormMaster) ===';
GO
