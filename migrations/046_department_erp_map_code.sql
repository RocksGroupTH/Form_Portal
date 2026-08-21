-- migrations/046_department_erp_map_code.sql
-- AP-1: rekey DepartmentErpMap from HrDepartmentId (numeric dept id) to DepartmentCode. DB = Fast_Core.
--
-- HISTORICAL -- already applied. DO NOT RE-RUN: the target moved to
-- Rocks_Portal_Form (migrations 099/100), so the "DB = Fast_Core" line above is
-- stale -- that name is a SYNONYM now.
--
-- This one does not fail loudly, which is worse. COL_LENGTH does not resolve
-- synonyms (measured 2026-08-21: NULL for every column of the Fast_Core name),
-- so the HrDepartmentId test below is false and the whole block is skipped --
-- a silent no-op that looks like success. The guard is the only thing standing
-- between this file and the DELETE inside it, and DELETE is DML, which DOES
-- resolve synonyms: it would empty the live table in Rocks_Portal_Form that all
-- three applications read. Do not "fix" the guard to make this file run again.
-- The rename it performs is long since done; scripts/checks/verify-046.ts
-- confirms it against Rocks_Portal_Form.
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
