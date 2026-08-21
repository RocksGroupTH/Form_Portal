-- DepartmentErpMap moves into the Accounting database.
--
-- Apply with (Rocks_Portal_Form ONLY -- NOT the UAT twin):
--   npm run apply-sql -- --db Rocks_Portal_Form --file migrations/099_portal_form_department_erp_map.sql
--
-- Then, and only then, apply 100 to Fast_Core. 100 drops the original.
--
-- ---------------------------------------------------------------------------
-- This table is deliberately a SINGLE copy. It is not created in
-- Rocks_Portal_Form_UAT, it is not dual-written, and it is not in
-- MASTER_TABLES. A second copy could not be kept aligned: the Fast_Core
-- synonym that Rocks Fast and ACC Portal write through points at production
-- alone, so a sibling's write would reach production and never UAT, and
-- npm run check:alignment would go red every time either of them edited a
-- department mapping with nothing actually wrong. See
-- docs/superpowers/specs/2026-08-20-department-erp-map-move-design.md, section 3.
--
-- The shape below matches Fast_Core's as measured 2026-08-20, with one
-- deliberate difference: MappedAt's default is named DF_DepartmentErpMap_MappedAt
-- here, where the live table carries a system-generated name
-- (DF__Departmen__Mappe__...) because migration 021 declared the default
-- inline with no CONSTRAINT clause. Functionally identical, and nothing
-- anywhere references either name -- the deterministic name is just better.
-- UQ_DepartmentErpMap_Dept is reproduced exactly: a plain unique INDEX and
-- not a unique constraint -- migration 098 converted it, and CREATE UNIQUE
-- INDEX is what matches what is actually there.
--
-- Batch 2 below is an id-keyed TOP-UP, not a one-time copy: it inserts
-- whatever Fast_Core ids are missing here, so a re-run after a sibling wrote
-- to Fast_Core between 099 and 100 fills the gap instead of silently doing
-- nothing.
--
-- ONCE 100 HAS RUN, THIS FILE IS NO LONGER RE-RUNNABLE. Batch 2 raises on
-- OBJECT_ID('[Fast_Core].[dbo].[DepartmentErpMap]', 'U') IS NULL, and that is
-- exactly what a synonym gives back (measured 2026-08-21 against the live
-- Fast_Core: OBJECT_ID(...,'U') is NULL, OBJECT_ID(...,'SN') is not) -- so
-- apply-sql stops with exit 1 and batch 3, the DBCC CHECKIDENT reseed to 2004,
-- never runs. Nothing is destroyed by that, and the raised message says so.
-- But if the form database is being stood up fresh, batch 1 will have created
-- an EMPTY table with its identity still at 1, which allocates ids from 1
-- rather than from 2004 -- inside the whole 1..2004 span the source had
-- already consumed, which is the range the reseed exists to keep clear.
-- Restore the rows and reseed by hand; see CLAUDE.md, "Standing up a
-- production form database".
-- ---------------------------------------------------------------------------

SET NOCOUNT ON;

IF DB_NAME() LIKE '%[_]UAT'
BEGIN
  DECLARE @uatDb NVARCHAR(128) = DB_NAME();
  RAISERROR (
    'Migration 099 must not be applied to the UAT form database. DepartmentErpMap is deliberately a single copy. Current database is %s.',
    16, 1, @uatDb
  );
END
-- The UAT test comes FIRST and is separate on purpose: Rocks_Portal_Form_UAT
-- also matches the name test below, and it is the one database this table must
-- never be created in.
ELSE IF DB_NAME() NOT LIKE 'Rocks[_]Portal[_]Form%'
     OR OBJECT_ID('dbo.AccRequest', 'U') IS NULL
BEGIN
  DECLARE @notForm NVARCHAR(128) = DB_NAME();
  RAISERROR (
    'Migration 099 may only be applied to the production Form Portal database: the name must start with Rocks_Portal_Form and dbo.AccRequest must exist. Current database is %s.',
    16, 1, @notForm
  );
END
ELSE IF OBJECT_ID('dbo.DepartmentErpMap') IS NOT NULL
BEGIN
  PRINT 'dbo.DepartmentErpMap already exists here -- batch 1 skipped.';
END
ELSE
BEGIN
  SET XACT_ABORT ON;
  BEGIN TRANSACTION;

  CREATE TABLE [dbo].[DepartmentErpMap] (
    [Id]                 INT           IDENTITY(1,1) NOT NULL,
    [BrandCode]          NVARCHAR(20)  NOT NULL,
    [DepartmentCode]     NVARCHAR(50)  NOT NULL,
    [HrDepartmentName]   NVARCHAR(200) NULL,
    [ErpDimensionCode]   NVARCHAR(50)  NOT NULL,
    [ErpCode]            NVARCHAR(50)  NOT NULL,
    [MappedBy]           INT           NULL,
    [MappedAt]           DATETIME2(7)  NOT NULL
      CONSTRAINT [DF_DepartmentErpMap_MappedAt] DEFAULT (sysdatetime()),
    [FixedGlAccountNo]   NVARCHAR(50)  NULL,
    [FixedGlDescription] NVARCHAR(500) NULL,
    [FormCode]           NVARCHAR(20)  NULL,
    CONSTRAINT [PK_DepartmentErpMap] PRIMARY KEY CLUSTERED ([Id])
  );

  CREATE UNIQUE INDEX [UQ_DepartmentErpMap_Dept]
    ON [dbo].[DepartmentErpMap] ([FormCode], [BrandCode], [DepartmentCode]);

  CREATE INDEX [IX_DepartmentErpMap_Brand]
    ON [dbo].[DepartmentErpMap] ([BrandCode]);

  COMMIT TRANSACTION;
  PRINT 'dbo.DepartmentErpMap created in the form database.';
END
GO

SET NOCOUNT ON;

IF DB_NAME() LIKE '%[_]UAT'
BEGIN
  DECLARE @uatDb2 NVARCHAR(128) = DB_NAME();
  RAISERROR (
    'Migration 099 must not be applied to the UAT form database. Current database is %s.',
    16, 1, @uatDb2
  );
END
ELSE IF DB_NAME() NOT LIKE 'Rocks[_]Portal[_]Form%'
     OR OBJECT_ID('dbo.AccRequest', 'U') IS NULL
BEGIN
  DECLARE @notForm2 NVARCHAR(128) = DB_NAME();
  RAISERROR (
    'Migration 099 may only be applied to the production Form Portal database. Current database is %s.',
    16, 1, @notForm2
  );
END
ELSE IF OBJECT_ID('dbo.DepartmentErpMap', 'U') IS NULL
BEGIN
  RAISERROR (
    'Migration 099 batch 2: dbo.DepartmentErpMap does not exist as a table -- batch 1 did not run.',
    16, 1
  );
END
ELSE IF OBJECT_ID('[Fast_Core].[dbo].[DepartmentErpMap]', 'U') IS NULL
BEGIN
  RAISERROR (
    'Migration 099 batch 2: [Fast_Core].[dbo].[DepartmentErpMap] is not a table. If migration 100 has already run it is a synonym pointing back here, and there is nothing to copy.',
    16, 1
  );
END
ELSE
BEGIN
  SET XACT_ABORT ON;
  BEGIN TRANSACTION;

  SET IDENTITY_INSERT [dbo].[DepartmentErpMap] ON;

  -- Top-up, not a one-time copy: id-keyed so a re-run -- whether because a
  -- sibling wrote to Fast_Core in the window between 099 and 100, or because
  -- this batch is simply run twice -- inserts only what is missing. A clean
  -- re-run inserts nothing, which is what keeps this batch idempotent.
  INSERT INTO [dbo].[DepartmentErpMap]
    ([Id], [BrandCode], [DepartmentCode], [HrDepartmentName], [ErpDimensionCode],
     [ErpCode], [MappedBy], [MappedAt], [FixedGlAccountNo], [FixedGlDescription],
     [FormCode])
  SELECT
     s.[Id], s.[BrandCode], s.[DepartmentCode], s.[HrDepartmentName], s.[ErpDimensionCode],
     s.[ErpCode], s.[MappedBy], s.[MappedAt], s.[FixedGlAccountNo], s.[FixedGlDescription],
     s.[FormCode]
  FROM [Fast_Core].[dbo].[DepartmentErpMap] s
  WHERE NOT EXISTS (
    SELECT 1 FROM [dbo].[DepartmentErpMap] t WHERE t.[Id] = s.[Id]
  );

  SET IDENTITY_INSERT [dbo].[DepartmentErpMap] OFF;

  DECLARE @src INT = (SELECT COUNT(*) FROM [Fast_Core].[dbo].[DepartmentErpMap]);
  DECLARE @dst INT = (SELECT COUNT(*) FROM [dbo].[DepartmentErpMap]);

  IF @src <> @dst
  BEGIN
    ROLLBACK TRANSACTION;
    RAISERROR (
      'Migration 099: holds %d rows after the top-up but Fast_Core holds %d. Rolled back.',
      16, 1, @dst, @src
    );
  END
  ELSE
  BEGIN
    COMMIT TRANSACTION;
    PRINT 'Missing rows (if any) topped up from Fast_Core with their ids preserved.';
  END
END
GO

SET NOCOUNT ON;

-- Reseed outside a transaction: DBCC CHECKIDENT is not transactional. 2004 is
-- IDENT_CURRENT on the Fast_Core table as measured 2026-08-20; without this the
-- identity would sit at 1006 (the highest copied id) and the sequence would
-- restart inside a range the source had already left behind.
IF DB_NAME() NOT LIKE '%[_]UAT'
   AND DB_NAME() LIKE 'Rocks[_]Portal[_]Form%'
   AND OBJECT_ID('dbo.DepartmentErpMap', 'U') IS NOT NULL
   AND IDENT_CURRENT('dbo.DepartmentErpMap') < 2004
BEGIN
  DBCC CHECKIDENT ('dbo.DepartmentErpMap', RESEED, 2004);
  PRINT 'Identity reseeded to 2004.';
END
GO
