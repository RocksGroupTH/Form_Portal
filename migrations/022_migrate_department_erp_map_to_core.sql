-- =============================================
-- Migration: Move AccDepartmentErpMap data Fast_Form → Fast_Core.DepartmentErpMap
-- Run on Fast_Core (cross-DB read from Fast_Form)
-- Apply: npm run apply-sql -- --db Fast_Core --file migrations/022_migrate_department_erp_map_to_core.sql
-- =============================================

USE [Fast_Core];
GO

IF EXISTS (SELECT * FROM [Fast_Form].sys.tables WHERE name = 'AccDepartmentErpMap')
   AND EXISTS (SELECT * FROM sys.tables WHERE name = 'DepartmentErpMap')
BEGIN
  INSERT INTO [dbo].[DepartmentErpMap]
    (BrandCode, HrDepartmentId, HrDepartmentName, ErpDimensionCode, ErpCode, MappedBy, MappedAt)
  SELECT
    s.BrandCode,
    s.HrDepartmentId,
    s.HrDepartmentName,
    s.ErpDimensionCode,
    s.ErpCode,
    s.MappedBy,
    s.MappedAt
  FROM [Fast_Form].[dbo].[AccDepartmentErpMap] s
  WHERE NOT EXISTS (
    SELECT 1
    FROM [dbo].[DepartmentErpMap] t
    WHERE t.BrandCode = s.BrandCode AND t.HrDepartmentId = s.HrDepartmentId
  );

  PRINT 'Migrated rows from Fast_Form.AccDepartmentErpMap → Fast_Core.DepartmentErpMap';
END
ELSE
  PRINT 'Skip data migration — source or target table missing';
GO

-- Drop legacy table on Fast_Form
IF EXISTS (SELECT * FROM [Fast_Form].sys.tables WHERE name = 'AccDepartmentErpMap')
BEGIN
  DROP TABLE [Fast_Form].[dbo].[AccDepartmentErpMap];
  PRINT 'Dropped Fast_Form.AccDepartmentErpMap';
END
GO

PRINT '=== Migration 022 complete ===';
GO
