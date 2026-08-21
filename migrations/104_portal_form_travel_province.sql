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
-- drift. The list of Thai provinces does not differ by environment. See
-- docs/superpowers/specs/2026-08-21-travel-province-move-design.md, section 3.
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
--
-- ONCE 105 HAS RUN, THIS FILE IS NO LONGER RE-RUNNABLE ON A DATABASE WHERE
-- BATCH 1 HAS NOT ALREADY SUCCEEDED. Batch 2 raises on
-- OBJECT_ID('[Fast_Data].[dbo].[TravelProvince]', 'U') IS NULL, and that is
-- exactly what a synonym gives back once 105 has converted it -- so apply-sql
-- stops with exit 1 and batch 3 never runs. Nothing is destroyed by that on a
-- database that already has its 77 rows.
--
-- BUT ON A FRESH STAND-UP OF Rocks_Portal_Form AFTER 105 HAS ALREADY RUN
-- against the shared Fast_Data -- a rebuild, a DR restore -- batch 1 commits
-- an EMPTY table before batch 2 ever gets to inspect the source, and batch 2
-- then raises and aborts. Fast_Data's synonym already points at this database
-- by name, so the moment batch 1 commits, it resolves to that empty table
-- immediately: Form Portal, Rocks Fast and ACC Portal all show an empty
-- province picker at once, not just this application. This does not self-heal
-- the way 101/102's equivalent risk does on the next Business Central sync --
-- nothing ever writes this table, so nothing ever repopulates it on its own.
--
-- THE RECOVERY IS NOT migrations/049_fast_data_travel_province.sql. Its first
-- batch is bare USE [Fast_Data]; (049:7), and apply-sql.ts splits a file on GO
-- and runs every batch through the same pool, so once that USE executes,
-- later batches in that run can act on Fast_Data instead of whatever --db
-- named, whenever apply-sql's pool hands back the same connection -- the same
-- trap CLAUDE.md documents for migration 001. Pointed at --db
-- Rocks_Portal_Form, 049 acts on Fast_Data instead -- not on the database
-- recovery actually needs.
--
-- Recovery is manual: restore the 77 rows into
-- [Rocks_Portal_Form].[dbo].[TravelProvince] from a backup or from whatever
-- snapshot was taken before applying (Task 2's own working copy, not part of
-- this repository), then reseed the identity to the restored MAX(Id) -- batch
-- 3 below, or a direct DBCC CHECKIDENT, once the rows are back.
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

  DECLARE @src INT = (SELECT COUNT(*) FROM [Fast_Data].[dbo].[TravelProvince]);
  DECLARE @dst INT = (SELECT COUNT(*) FROM [dbo].[TravelProvince]);

  IF @src <> @dst
  BEGIN
    ROLLBACK TRANSACTION;
    RAISERROR (
      'Migration 104: holds %d rows after the merge but Fast_Data holds %d. Rolled back.',
      16, 1, @dst, @src
    );
  END
  ELSE
  BEGIN
    COMMIT TRANSACTION;
    PRINT 'Batch 2: rows reconciled from Fast_Data with their ids preserved.';
  END
END
GO

SET NOCOUNT ON;

-- Reseed outside a transaction: DBCC CHECKIDENT is not transactional.
--
-- A floor, not the mechanism: SET IDENTITY_INSERT already raises the identity
-- to the highest id inserted, and IDENT_CURRENT equals MAX(Id) in the source
-- (77, measured 2026-08-21), so on any run where batch 2 actually copies rows
-- this is inert. It does NOT guard the empty-copy case the hazard note above
-- describes: if 105 has already run, batch 2 raises and apply-sql aborts
-- before batch 3 is ever reached, so a table left empty by that path stays
-- empty and un-reseeded -- see that note for the actual recovery. What this
-- batch guards is narrower: a table that reached Rocks_Portal_Form some other
-- way, already holding rows, with an identity lower than the data it holds.
--
-- Same predicate as batches 1 and 2, not a stricter one: a differently-named
-- production database should skip this floor quietly, the way 099's batch 3
-- does, rather than fail the whole run with a RAISERROR after batches 1 and 2
-- already did their job.
IF DB_NAME() NOT LIKE '%[_]UAT'
   AND DB_NAME() LIKE 'Rocks[_]Portal[_]Form%'
   AND OBJECT_ID('dbo.TravelProvince', 'U') IS NOT NULL
   AND IDENT_CURRENT('dbo.TravelProvince') < 77
BEGIN
  DBCC CHECKIDENT ('dbo.TravelProvince', RESEED, 77);
  PRINT 'Batch 3: identity floor applied.';
END
GO
