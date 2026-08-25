-- 115: Migrate AccAdvanceInterfaceConfig → shared per-form tables (FormCode='AP-2').
-- Apply on BOTH Rocks_Portal_Form AND Rocks_Portal_Form_UAT (same as all migrations).
--
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/115_migrate_advance_interface_to_per_form.sql
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/115_migrate_advance_interface_to_per_form.sql
--
-- Safe to run multiple times: all INSERTs guarded by NOT EXISTS.
-- AccAdvanceInterfaceConfig is DROPPED at the end.

SET XACT_ABORT ON;
GO

-- ① InterfaceBrandCode → AccBrandErpInterface (FormCode='AP-2')
INSERT INTO [dbo].[AccBrandErpInterface] (BrandCode, InterfaceBrandCode, FormCode, CreatedBy)
SELECT src.BrandCode, src.InterfaceBrandCode, 'AP-2', NULL
FROM [dbo].[AccAdvanceInterfaceConfig] src
WHERE src.InterfaceBrandCode IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM [dbo].[AccBrandErpInterface] x
    WHERE x.BrandCode = src.BrandCode AND x.FormCode = 'AP-2'
  );
PRINT 'Migrated InterfaceBrandCode to AccBrandErpInterface (FormCode=AP-2)';
GO

-- ② GlAccountNo → AccBrandGlAccount (FormCode='AP-2')
INSERT INTO [dbo].[AccBrandGlAccount]
  (BrandCode, AccountNo, ErpDescription, FormCode, IsActive, SortOrder, CreatedBy)
SELECT src.BrandCode, src.GlAccountNo, src.GlErpDescription, 'AP-2', 1, 0, NULL
FROM [dbo].[AccAdvanceInterfaceConfig] src
WHERE src.GlAccountNo IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM [dbo].[AccBrandGlAccount] x
    WHERE x.BrandCode = src.BrandCode AND x.FormCode = 'AP-2'
  );
PRINT 'Migrated GlAccountNo to AccBrandGlAccount (FormCode=AP-2)';
GO

-- ③ BankAccountNo → AccBrandBankAccount (FormCode='AP-2')
INSERT INTO [dbo].[AccBrandBankAccount]
  (BrandCode, AccountNo, FormCode, IsActive, SortOrder, CreatedBy)
SELECT src.BrandCode, src.BankAccountNo, 'AP-2', 1, 0, NULL
FROM [dbo].[AccAdvanceInterfaceConfig] src
WHERE src.BankAccountNo IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM [dbo].[AccBrandBankAccount] x
    WHERE x.BrandCode = src.BrandCode AND x.FormCode = 'AP-2'
  );
PRINT 'Migrated BankAccountNo to AccBrandBankAccount (FormCode=AP-2)';
GO

-- ④ BranchCode → AccBrandBranchCode (FormCode='AP-2')
INSERT INTO [dbo].[AccBrandBranchCode]
  (BrandCode, BranchCode, FormCode, IsActive, SortOrder, DeptAsBranch, CreatedBy)
SELECT src.BrandCode, src.BranchCode, 'AP-2', 1, 0, 0, NULL
FROM [dbo].[AccAdvanceInterfaceConfig] src
WHERE src.BranchCode IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM [dbo].[AccBrandBranchCode] x
    WHERE x.BrandCode = src.BrandCode AND x.FormCode = 'AP-2'
  );
PRINT 'Migrated BranchCode to AccBrandBranchCode (FormCode=AP-2)';
GO

-- ⑤ JournalBatchName → AccBrandJournalBatch (FormCode='AP-2', keyed by claim brand)
INSERT INTO [dbo].[AccBrandJournalBatch]
  (BrandCode, BatchName, FormCode, IsActive, SortOrder, CreatedBy)
SELECT src.BrandCode, src.JournalBatchName, 'AP-2', 1, 0, NULL
FROM [dbo].[AccAdvanceInterfaceConfig] src
WHERE src.JournalBatchName IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM [dbo].[AccBrandJournalBatch] x
    WHERE x.BrandCode = src.BrandCode AND x.FormCode = 'AP-2'
  );
PRINT 'Migrated JournalBatchName to AccBrandJournalBatch (FormCode=AP-2)';
GO

-- ⑥ Drop the old table
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'AccAdvanceInterfaceConfig')
BEGIN
  DROP TABLE [dbo].[AccAdvanceInterfaceConfig];
  PRINT 'Dropped AccAdvanceInterfaceConfig';
END
ELSE
  PRINT 'AccAdvanceInterfaceConfig already gone — skipping';
GO

PRINT '=== Migration 115 complete ===';
GO
