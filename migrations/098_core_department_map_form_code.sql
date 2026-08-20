-- FormCode on DepartmentErpMap -- the seventh brand-keyed ERP configuration
-- table, and the only one that does not live in the form database.
--
-- Apply with (Fast_Core ONLY):
--   npm run apply-sql -- --db Fast_Core --file migrations/098_core_department_map_form_code.sql
--
-- Fast_Core has no UAT twin -- that is the whole reason the environment
-- switches live there -- so unlike migration 097 this file is applied exactly
-- once, to one database.
--
-- ---------------------------------------------------------------------------
-- Fast_Core is SHARED. Read this before running it.
--
-- dbo.DepartmentErpMap is not ours alone. Three applications read and write it
-- against the same rows:
--
--   * Form Portal (this repo)          src/lib/acc/department-map-service.ts
--                                      src/lib/acc/erp-prep-service.ts
--   * Rocks Fast                       src/lib/acc/department-map-service.ts
--                                      src/lib/acc/erp-prep-service.ts
--   * ACC_Portal                       src/lib/acc/department-map-service.ts
--                                      src/lib/acc/erp-prep-service.ts
--
-- Widening it is safe for the two siblings, for three separate reasons, and all
-- three had to hold before this migration was written:
--
--   1. The column is NULLABLE with no default, so adding it rewrites no row and
--      breaks no existing INSERT. A sibling that has never heard of FormCode
--      keeps inserting exactly the columns it always did.
--   2. Their reads are unaffected. Neither sibling's erp-prep-service.ts nor
--      department-map-service.ts selects *, and an extra column changes no
--      result of a query that names its columns. Their lookups are keyed on
--      (BrandCode, DepartmentCode) and continue to match the rows they always
--      matched -- because of point 3.
--   3. Their writes leave FormCode NULL, and NULL is the default that answers
--      every form. Both siblings upsert through a MERGE with an explicit column
--      list (RocksFast department-map-service.ts, ACC_Portal
--      department-map-service.ts), so every row they create is a default row --
--      which is precisely correct for an application that has one form.
--
-- The specific statement that WOULD have broken is an INSERT with no column
-- list -- INSERT INTO dbo.DepartmentErpMap VALUES (...) -- which binds by
-- position and starts failing the moment a table grows a column. All three
-- repositories were grepped for one before this file was written; there is
-- none. Grep again if this is being applied long after it was authored:
--
--   grep -rnE "INSERT[[:space:]]+INTO[[:space:]]+\[?dbo\]?\.?\[?DepartmentErpMap\]?[[:space:]]*(VALUES|SELECT)" \
--     <RocksFast>/src <ACC_Portal>/src src/
--
-- ---------------------------------------------------------------------------
-- The same three moves as migration 097, for the same reasons.
--
-- FormCode NULL is the default and answers every form; a row naming a form
-- overrides it for that form alone (src/lib/acc/per-form-config.ts). Every
-- existing row is backfilled to NULL, so nothing resolves differently on day
-- one and the feature stays inert until somebody adds an override.
--
-- Backfill and index swap share one batch under SET XACT_ABORT ON: the old
-- two-column unique index knows nothing about FormCode and would reject a legal
-- override -- (AP-4, PCTH, 'IT') alongside the default (NULL, PCTH, 'IT') looks
-- like a duplicate to it -- so no window is left in which that can happen. The
-- ALTER is in its own earlier batch because SQL Server defers name resolution
-- for tables, not for columns of an existing table.
--
-- SQL Server treats NULLs as EQUAL in a unique index, so one brand keeps
-- exactly one default row per department plus at most one row per form, with no
-- filtered index and no extra constraint.
--
-- UQ_DepartmentErpMap_Dept was declared as a UNIQUE CONSTRAINT
-- (migrations/021_fast_core_department_erp_map.sql), which DROP INDEX cannot
-- remove; the drop below reads sys.indexes.is_unique_constraint and uses the
-- verb that matches whatever it finds, exactly as 097 does. Its second column
-- is DepartmentCode, not the HrDepartmentId that 021 created: 046 renamed the
-- column in place with sp_rename and the index followed it.
--
-- Index-existence guards are scoped to the object (AND object_id =
-- OBJECT_ID(...)) because an index name is unique only within its own table.
SET XACT_ABORT ON;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.DepartmentErpMap') AND name = 'FormCode'
)
BEGIN
  ALTER TABLE [dbo].[DepartmentErpMap] ADD [FormCode] NVARCHAR(20) NULL;
  PRINT 'DepartmentErpMap: FormCode added.';
END
ELSE
  PRINT 'DepartmentErpMap: FormCode already present.';
GO

UPDATE [dbo].[DepartmentErpMap] SET [FormCode] = NULL WHERE [FormCode] IS NOT NULL;

IF EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UQ_DepartmentErpMap_Dept'
    AND object_id = OBJECT_ID('dbo.DepartmentErpMap')
    AND is_unique_constraint = 1
)
  ALTER TABLE [dbo].[DepartmentErpMap] DROP CONSTRAINT [UQ_DepartmentErpMap_Dept];
ELSE IF EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UQ_DepartmentErpMap_Dept'
    AND object_id = OBJECT_ID('dbo.DepartmentErpMap')
)
  DROP INDEX [UQ_DepartmentErpMap_Dept] ON [dbo].[DepartmentErpMap];

CREATE UNIQUE INDEX [UQ_DepartmentErpMap_Dept]
  ON [dbo].[DepartmentErpMap] ([FormCode], [BrandCode], [DepartmentCode]);

PRINT 'DepartmentErpMap: rows defaulted to NULL; UQ_DepartmentErpMap_Dept now (FormCode, BrandCode, DepartmentCode).';
GO

PRINT '=== Migration 098 complete: DepartmentErpMap carries FormCode, every row a default (NULL). ===';
GO
