-- SUPERSEDED IN PART BY MIGRATIONS 142 AND 143 (2026-09-08). Applied; kept as
-- written. The table this creates is now called TesterPerDiem (142) and no
-- longer has an IsActive column (143).
--
-- *** DO NOT RE-RUN THIS AFTER 142. *** Batch 1's guard is
-- OBJECT_ID('dbo.UatTesterPerDiem') IS NOT NULL, which 142's synonym satisfies
-- until 143 removes it -- and NOTHING satisfies afterwards. Re-run then, and
-- this file will happily CREATE a second, empty UatTesterPerDiem beside the
-- real TesterPerDiem, with no error.
--
-- A rebuilt Rocks_Portal_Form_UAT wants 139 -> 142 -> 143 once, in that order,
-- and 139 never again -- but note that 139 no longer COMPLETES on a fresh
-- database: batch 2 below copies from [Fast_Core].[dbo].[UatTesterPerDiem],
-- which migration 140 dropped, so it raises and apply-sql exits 1 with the
-- table created and empty. That failure is expected. Run 142 and 143 after it
-- and restore the rates from a backup. See 142's header.
--
-- UatTesterPerDiem moves into the UAT form database. UatTester stays in
-- Fast_Core -- see the design doc, section 2 and section 12, for why the two
-- tables were split after the first version of this work moved both.
--
-- TARGET: Rocks_Portal_Form_UAT ONLY.
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/139_uat_form_uat_tester_per_diem.sql
--
-- Design: docs/superpowers/specs/2026-09-07-uat-tester-move-design.md
--
-- ---------------------------------------------------------------------------
-- THE DATABASE GUARD IS INVERTED RELATIVE TO 099 AND 104, DELIBERATELY.
--
-- Those two refuse `DB_NAME() LIKE '%[_]UAT'` FIRST and on purpose -- the UAT
-- twin is the one database their table must never be created in. This one is
-- the opposite: the UAT twin is the ONLY database this table may live in.
-- Copying 099's ladder verbatim produces a migration that refuses the only
-- database it is meant to run against.
--
-- `dbo.AccRequest` must also exist, so a mistyped --db cannot land this on some
-- other database whose name happens to end in _UAT.
--
-- ---------------------------------------------------------------------------
-- RUN THIS BEFORE THE CODE DEPLOY, AND BEFORE 140. 140 drops the Fast_Core
-- original and refuses to do so unless the copy is already here -- but the
-- refusal is a guard, not a substitute for the order. The full sequence is
-- 139 -> deploy the code -> 140.
--
-- ---------------------------------------------------------------------------
-- THE RESEED FLOOR IS IDENT_CURRENT, NOT MAX(Id) AND NOT THE ROW COUNT.
--
-- Measured 2026-09-07 against the live Fast_Core: UatTesterPerDiem holds 1
-- row with IDENT_CURRENT = 1. A floor taken from the row count would happen
-- to agree here, but IDENT_CURRENT is the correct source in general -- a
-- table can hold fewer rows than its identity has already issued.
--
-- ---------------------------------------------------------------------------
-- NO 900000 IDENTITY FLOOR APPLIES HERE.
--
-- Migrations 061 and 064 enumerate 23 transactional table names explicitly
-- (061:39-47, 064:61-69) and this table is not among them, so ids starting at
-- 1 in this database violate nothing.

SET NOCOUNT ON;

IF DB_NAME() NOT LIKE '%[_]UAT' OR OBJECT_ID('dbo.AccRequest', 'U') IS NULL
BEGIN
  DECLARE @wrongDb NVARCHAR(128) = DB_NAME();
  RAISERROR (
    'Migration 139 may only be applied to the UAT form database: the name must end in _UAT and dbo.AccRequest must exist. Current database is %s.',
    16, 1, @wrongDb
  );
END
ELSE IF OBJECT_ID('dbo.UatTesterPerDiem') IS NOT NULL
BEGIN
  PRINT 'dbo.UatTesterPerDiem already exists here -- batch 1 skipped.';
END
ELSE
BEGIN
  SET XACT_ABORT ON;
  BEGIN TRANSACTION;

  CREATE TABLE [dbo].[UatTesterPerDiem] (
    [Id]            INT IDENTITY(1,1) NOT NULL CONSTRAINT [PK_UatTesterPerDiem] PRIMARY KEY,
    [StaffId]       INT            NOT NULL,
    [EffectiveDate] DATE           NOT NULL,
    [Amount]        DECIMAL(18,2)  NOT NULL CONSTRAINT [CK_UatTesterPerDiem_Amount] CHECK ([Amount] > 0),
    [Note]          NVARCHAR(300)  NULL,
    [IsActive]      BIT            NOT NULL CONSTRAINT [DF_UatTesterPerDiem_IsActive] DEFAULT (1),
    [CreatedBy]     INT            NULL,
    [CreatedAt]     DATETIME2(7)   NOT NULL CONSTRAINT [DF_UatTesterPerDiem_CreatedAt] DEFAULT (SYSDATETIME()),
    [UpdatedBy]     INT            NULL,
    [UpdatedAt]     DATETIME2(7)   NOT NULL CONSTRAINT [DF_UatTesterPerDiem_UpdatedAt] DEFAULT (SYSDATETIME()),
    CONSTRAINT [UQ_UatTesterPerDiem_Staff_Date] UNIQUE ([StaffId], [EffectiveDate])
  );

  COMMIT TRANSACTION;
  PRINT 'Batch 1: dbo.UatTesterPerDiem created in the UAT form database.';
END
GO

SET NOCOUNT ON;

IF DB_NAME() NOT LIKE '%[_]UAT' OR OBJECT_ID('dbo.AccRequest', 'U') IS NULL
BEGIN
  DECLARE @wrongDb2 NVARCHAR(128) = DB_NAME();
  RAISERROR ('Migration 139 batch 2 may only be applied to the UAT form database. Current database is %s.', 16, 1, @wrongDb2);
END
ELSE IF OBJECT_ID('dbo.UatTesterPerDiem', 'U') IS NULL
BEGIN
  RAISERROR ('Migration 139 batch 2: dbo.UatTesterPerDiem does not exist here as a table -- batch 1 did not run.', 16, 1);
END
ELSE IF OBJECT_ID('[Fast_Core].[dbo].[UatTesterPerDiem]', 'U') IS NULL
BEGIN
  RAISERROR (
    'Migration 139 batch 2: [Fast_Core].[dbo].[UatTesterPerDiem] is not a table. If migration 140 has already run it has been dropped, and there is nothing to copy.',
    16, 1
  );
END
ELSE
BEGIN
  SET XACT_ABORT ON;
  BEGIN TRANSACTION;

  SET IDENTITY_INSERT [dbo].[UatTesterPerDiem] ON;

  MERGE INTO [dbo].[UatTesterPerDiem] AS t
  USING [Fast_Core].[dbo].[UatTesterPerDiem] AS s
    ON t.[Id] = s.[Id]
  WHEN MATCHED THEN
    UPDATE SET t.[StaffId] = s.[StaffId],
               t.[EffectiveDate] = s.[EffectiveDate],
               t.[Amount] = s.[Amount],
               t.[Note] = s.[Note],
               t.[IsActive] = s.[IsActive],
               t.[CreatedBy] = s.[CreatedBy],
               t.[CreatedAt] = s.[CreatedAt],
               t.[UpdatedBy] = s.[UpdatedBy],
               t.[UpdatedAt] = s.[UpdatedAt]
  WHEN NOT MATCHED BY TARGET THEN
    INSERT ([Id], [StaffId], [EffectiveDate], [Amount], [Note], [IsActive], [CreatedBy], [CreatedAt], [UpdatedBy], [UpdatedAt])
    VALUES (s.[Id], s.[StaffId], s.[EffectiveDate], s.[Amount], s.[Note], s.[IsActive], s.[CreatedBy], s.[CreatedAt], s.[UpdatedBy], s.[UpdatedAt]);

  SET IDENTITY_INSERT [dbo].[UatTesterPerDiem] OFF;

  DECLARE @srcP INT = (SELECT COUNT(*) FROM [Fast_Core].[dbo].[UatTesterPerDiem]);
  DECLARE @dstP INT = (SELECT COUNT(*) FROM [dbo].[UatTesterPerDiem]);

  IF @srcP <> @dstP
  BEGIN
    ROLLBACK TRANSACTION;
    RAISERROR (
      'Migration 139: after the merge this database holds %d rates; Fast_Core holds %d. Rolled back.',
      16, 1, @dstP, @srcP
    );
  END
  ELSE
  BEGIN
    COMMIT TRANSACTION;
    PRINT 'Batch 2: rows reconciled from Fast_Core with their ids preserved.';
  END
END
GO

SET NOCOUNT ON;

-- Reseed outside a transaction: DBCC CHECKIDENT is not transactional.
--
-- A floor, not the mechanism: SET IDENTITY_INSERT already raises the identity
-- to the highest id inserted. What this guards is the narrower case of a
-- table that reached this database some other way, already holding rows,
-- with an identity lower than the ids it holds. 1 is the source
-- IDENT_CURRENT value measured 2026-09-07.
--
-- Same predicate as batches 1 and 2, not a stricter one: a differently-named
-- database should skip this floor quietly rather than fail the whole run
-- after batches 1 and 2 have already done their job.
IF DB_NAME() LIKE '%[_]UAT'
   AND OBJECT_ID('dbo.AccRequest', 'U') IS NOT NULL
   AND OBJECT_ID('dbo.UatTesterPerDiem', 'U') IS NOT NULL
   AND IDENT_CURRENT('dbo.UatTesterPerDiem') < 1
BEGIN
  DBCC CHECKIDENT ('dbo.UatTesterPerDiem', RESEED, 1);
  PRINT 'Batch 3: UatTesterPerDiem identity floor applied.';
END
GO
