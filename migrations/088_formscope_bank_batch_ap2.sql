-- 088: Give each form its own Interface config.
-- Form-scope Bank + Journal Batch (like G/L already is), backfill existing rows
-- to AP-1 so AP-1 is unchanged, and register AP-2's interface claim brands.

-- 1) FormCode on AccBrandBankAccount ------------------------------------------
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.AccBrandBankAccount') AND name = 'FormCode'
)
  ALTER TABLE dbo.AccBrandBankAccount ADD FormCode NVARCHAR(20) NULL;
GO
UPDATE dbo.AccBrandBankAccount SET FormCode = 'AP-1' WHERE FormCode IS NULL;
GO

-- 2) FormCode on AccBrandJournalBatch -----------------------------------------
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.AccBrandJournalBatch') AND name = 'FormCode'
)
  ALTER TABLE dbo.AccBrandJournalBatch ADD FormCode NVARCHAR(20) NULL;
GO
UPDATE dbo.AccBrandJournalBatch SET FormCode = 'AP-1' WHERE FormCode IS NULL;
GO

-- 3) Register AP-2's interface claim brands (mirror AP-1's set) ----------------
INSERT INTO dbo.AccFormBrand (FormCode, BrandCode, IsActive, SortOrder)
SELECT 'AP-2', b.BrandCode, 1, b.SortOrder
FROM dbo.AccFormBrand b
WHERE b.FormCode = 'AP-1'
  AND NOT EXISTS (
    SELECT 1 FROM dbo.AccFormBrand x
    WHERE x.FormCode = 'AP-2' AND x.BrandCode = b.BrandCode
  );
GO
