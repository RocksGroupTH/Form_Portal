-- migrations/046_department_erp_map_code.sql
-- AP-1: rekey DepartmentErpMap from HrDepartmentId (numeric dept id) to DepartmentCode. DB = Fast_Core.
SET XACT_ABORT ON;
GO

-- Rename the key column in place (only if not already renamed). The unique index follows the column.
-- The DELETE below runs ONLY inside this same first-time rename event, so the whole
-- file is a true no-op on re-run (re-running after admins re-map must not wipe live data).
IF COL_LENGTH('dbo.DepartmentErpMap', 'HrDepartmentId') IS NOT NULL
   AND COL_LENGTH('dbo.DepartmentErpMap', 'DepartmentCode') IS NULL
BEGIN
  EXEC sp_rename 'dbo.DepartmentErpMap.HrDepartmentId', 'DepartmentCode', 'COLUMN';

  -- Old rows keyed on numeric Department Ids are invalid under the new code key — start fresh.
  DELETE FROM dbo.DepartmentErpMap;
END
GO
