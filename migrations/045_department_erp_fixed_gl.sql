-- migrations/045_department_erp_fixed_gl.sql
-- AP-1: per-department Fixed G/L account override on DepartmentErpMap. DB = Fast_Core.
--
-- HISTORICAL -- already applied. DO NOT RE-RUN: the target moved to
-- Rocks_Portal_Form (migrations 099/100). Fast_Core.dbo.DepartmentErpMap is a
-- SYNONYM now, the "DB = Fast_Core" line above is stale, and DDL does not
-- resolve synonyms -- neither does COL_LENGTH, which returns NULL for every
-- column of the Fast_Core name (measured 2026-08-21). So both guards below
-- pass and both ALTER TABLE statements then fail. The columns exist on the
-- real table; scripts/checks/verify-045.ts confirms that against
-- Rocks_Portal_Form.
SET XACT_ABORT ON;
GO

IF COL_LENGTH('dbo.DepartmentErpMap', 'FixedGlAccountNo') IS NULL
  ALTER TABLE dbo.DepartmentErpMap ADD FixedGlAccountNo NVARCHAR(50) NULL;
GO

IF COL_LENGTH('dbo.DepartmentErpMap', 'FixedGlDescription') IS NULL
  ALTER TABLE dbo.DepartmentErpMap ADD FixedGlDescription NVARCHAR(500) NULL;
GO
