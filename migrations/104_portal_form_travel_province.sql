-- AP-17's province table moves into the Accounting database.
--
-- Apply with (Rocks_Portal_Form ONLY -- NOT the UAT twin):
--   npm run apply-sql -- --db Rocks_Portal_Form --file migrations/104_portal_form_travel_province.sql
--
-- Then, and only then, apply 105 to Fast_Data. 105 drops the original.
--
-- ---------------------------------------------------------------------------
-- SINGLE COPY. Not created in Rocks_Portal_Form_UAT, not dual-written, not in
-- MASTER_TABLES. Two facts force that rather than merely suggesting it: a
-- synonym points at exactly one database, so the Rocks Fast and ACC Portal
-- siblings could never reach a UAT twin; and NOTHING WRITES THIS TABLE in any
-- of the three applications -- it is seeded by migration 049 and read-only
-- since -- so there is no write for dual-write to carry and nothing that could
-- drift. The list of Thai provinces does not differ by environment.
--
-- This is the third application of the pattern, after 099/100 (DepartmentErpMap
-- out of Fast_Core) and 101/102 (the five ERP sync tables out of Fast_Data).
-- With it, no code in this application reads Fast_Data at all.
--
-- TWO DELIBERATE DEPARTURES FROM THE SOURCE SHAPE:
--   1. UQ_TravelProvince_NameTh is a UNIQUE CONSTRAINT in Fast_Data, not a
--      plain unique index, and is recreated as a constraint. They are different
--      objects: DROP INDEX against a constraint raises Msg 3723.
--   2. The IsActive default is named DF_TravelProvince_IsActive here; the live
--      one is auto-generated (DF__TravelPro__IsAct__2A164134). Nothing
--      references a default constraint by name.
--
-- Batch 2 is an id-keyed MERGE, so a re-run reconciles rather than skipping.
-- ---------------------------------------------------------------------------

SET NOCOUNT ON;

IF DB_NAME() LIKE '%[_]UAT'
BEGIN
  DECLARE @uatDb NVARCHAR(128) = DB_NAME();
  RAISERROR (
    'Migration 104 must not be applied to the UAT form database. TravelProvince is deliberately a single copy. Current database is %s.',
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
    'Migration 104 may only be applied to the production Form Portal database: the name must start with Rocks_Portal_Form and dbo.AccRequest must exist. Current database is %s.',
    16, 1, @notForm
  );
END
ELSE IF OBJECT_ID('dbo.TravelProvince') IS NOT NULL
BEGIN
  PRINT 'dbo.TravelProvince already exists here -- batch 1 skipped.';
END
ELSE
BEGIN
  SET XACT_ABORT ON;
  BEGIN TRANSACTION;

  CREATE TABLE [dbo].[TravelProvince] (
    [Id]       INT           IDENTITY(1,1) NOT NULL,
    [NameTh]   NVARCHAR(100) NOT NULL,
    [NameEn]   NVARCHAR(100) NULL,
    [IsActive] BIT           NOT NULL
      CONSTRAINT [DF_TravelProvince_IsActive] DEFAULT ((1)),
    CONSTRAINT [PK_TravelProvince] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [UQ_TravelProvince_NameTh] UNIQUE ([NameTh])
  );

  COMMIT TRANSACTION;
  PRINT 'Batch 1: dbo.TravelProvince created in the form database.';
END
GO

SET NOCOUNT ON;

IF DB_NAME() LIKE '%[_]UAT'
BEGIN
  DECLARE @uatDb2 NVARCHAR(128) = DB_NAME();
  RAISERROR ('Migration 104 must not be applied to the UAT form database. Current database is %s.', 16, 1, @uatDb2);
END
ELSE IF DB_NAME() NOT LIKE 'Rocks[_]Portal[_]Form%'
     OR OBJECT_ID('dbo.AccRequest', 'U') IS NULL
BEGIN
  DECLARE @notForm2 NVARCHAR(128) = DB_NAME();
  RAISERROR ('Migration 104 may only be applied to the production Form Portal database. Current database is %s.', 16, 1, @notForm2);
END
ELSE IF OBJECT_ID('dbo.TravelProvince', 'U') IS NULL
BEGIN
  RAISERROR ('Migration 104 batch 2: dbo.TravelProvince does not exist as a table -- batch 1 did not run.', 16, 1);
END
ELSE IF OBJECT_ID('[Fast_Data].[dbo].[TravelProvince]', 'U') IS NULL
BEGIN
  RAISERROR (
    'Migration 104 batch 2: [Fast_Data].[dbo].[TravelProvince] is not a table. If migration 105 has already run it is a synonym pointing back here, and there is nothing to copy.',
    16, 1
  );
END
ELSE
BEGIN
  SET XACT_ABORT ON;
  BEGIN TRANSACTION;

  SET IDENTITY_INSERT [dbo].[TravelProvince] ON;

  MERGE INTO [dbo].[TravelProvince] AS t
  USING [Fast_Data].[dbo].[TravelProvince] AS s
    ON t.[Id] = s.[Id]
  WHEN MATCHED THEN
    UPDATE SET t.[NameTh] = s.[NameTh],
               t.[NameEn] = s.[NameEn],
               t.[IsActive] = s.[IsActive]
  WHEN NOT MATCHED BY TARGET THEN
    INSERT ([Id], [NameTh], [NameEn], [IsActive])
    VALUES (s.[Id], s.[NameTh], s.[NameEn], s.[IsActive]);

  SET IDENTITY_INSERT [dbo].[TravelProvince] OFF;

  COMMIT TRANSACTION;
  PRINT 'Batch 2: rows reconciled from Fast_Data with their ids preserved.';
END
GO

SET NOCOUNT ON;

-- A floor, not the mechanism: SET IDENTITY_INSERT already raises the identity
-- to the highest id inserted, and IDENT_CURRENT equals MAX(Id) in the source
-- (77, measured 2026-08-21), so this is inert on every realistic path. It is
-- kept for the pathological case of an empty copy.
IF DB_NAME() <> N'Rocks_Portal_Form'
BEGIN
  DECLARE @notProd NVARCHAR(128) = DB_NAME();
  RAISERROR ('Migration 104 batch 3 may only be applied to Rocks_Portal_Form. Current database is %s.', 16, 1, @notProd);
END
ELSE IF OBJECT_ID('dbo.TravelProvince', 'U') IS NOT NULL
     AND IDENT_CURRENT('dbo.TravelProvince') < 77
BEGIN
  DBCC CHECKIDENT ('dbo.TravelProvince', RESEED, 77);
  PRINT 'Batch 3: identity floor applied.';
END
GO
