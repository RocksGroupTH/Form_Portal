-- migrations/045_department_erp_fixed_gl.sql
-- AP-1: per-department Fixed G/L account override on DepartmentErpMap. DB = Fast_Core.
SET XACT_ABORT ON;
GO

IF COL_LENGTH('dbo.DepartmentErpMap', 'FixedGlAccountNo') IS NULL
  ALTER TABLE dbo.DepartmentErpMap ADD FixedGlAccountNo NVARCHAR(50) NULL;
GO

IF COL_LENGTH('dbo.DepartmentErpMap', 'FixedGlDescription') IS NULL
  ALTER TABLE dbo.DepartmentErpMap ADD FixedGlDescription NVARCHAR(500) NULL;
GO
