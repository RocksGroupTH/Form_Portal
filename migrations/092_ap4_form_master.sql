-- AP-4 in the form catalogue, and the brands it may be claimed against.
--
-- Apply with (BOTH databases):
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/092_ap4_form_master.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/092_ap4_form_master.sql
IF NOT EXISTS (SELECT 1 FROM [dbo].[AccFormMaster] WHERE FormCode = N'AP-4')
  INSERT INTO [dbo].[AccFormMaster]
    ([FormCode], [GroupName], [FormNameTh], [FormNameEn], [RunningPrefix], [IsActive], [SortOrder])
  VALUES
    (N'AP-4', N'Accounting', N'ขอเบิกเงินคืนพนักงาน (Staff Reimbursement)',
     N'Staff Reimbursement', N'RBM', 1, 4);
GO
-- ROCKS only to begin with; the rest are added from Settings rather than here,
-- so the seed does not decide policy.
IF NOT EXISTS (SELECT 1 FROM [dbo].[AccFormBrand] WHERE FormCode = N'AP-4')
  INSERT INTO [dbo].[AccFormBrand] ([FormCode], [BrandCode], [IsActive], [SortOrder])
  VALUES (N'AP-4', N'ROCKS', 1, 0);
GO
