-- =============================================
-- Migration: AP-2 brand access (AccFormBrand) — mirrors AP-1's enabled brands
-- Database: Rocks_Portal_Form (+ Rocks_Portal_Form_UAT)
-- Apply: npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/076_acc_ap2_brand_access.sql
--        npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/076_acc_ap2_brand_access.sql
--
-- Enables AP-2 for the same brands AP-1 uses so the form's brand dropdown is
-- populated. Idempotent — inserts only brands not already present for AP-2.
-- Adjust the brand list later via the AP-2 brand settings when that UI lands.
-- =============================================

INSERT INTO [dbo].[AccFormBrand] ([FormCode], [BrandCode], [IsActive], [SortOrder])
SELECT 'AP-2', v.BrandCode, 1, v.SortOrder
FROM (VALUES
    ('ROCKS', 0),
    ('PCTH',  1),
    ('PCMY',  2),
    ('KSI',   3),
    ('UNO',   4)
) AS v(BrandCode, SortOrder)
WHERE NOT EXISTS (
  SELECT 1 FROM [dbo].[AccFormBrand] b
  WHERE b.FormCode = 'AP-2' AND b.BrandCode = v.BrandCode
);
PRINT 'Seeded AP-2 brand access (idempotent)';
GO

PRINT '=== Migration 065 complete ===';
GO
