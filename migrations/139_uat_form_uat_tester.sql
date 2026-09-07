-- UatTester and UatTesterPerDiem move into the UAT form database.
--
-- TARGET: Rocks_Portal_Form_UAT ONLY.
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/139_uat_form_uat_tester.sql
--
-- Design: docs/superpowers/specs/2026-09-07-uat-tester-move-design.md
--
-- ---------------------------------------------------------------------------
-- THE DATABASE GUARD IS INVERTED RELATIVE TO 099 AND 104, DELIBERATELY.
--
-- Those two refuse `DB_NAME() LIKE '%[_]UAT'` FIRST and on purpose -- the UAT
-- twin is the one database their table must never be created in. This one is
-- the opposite: the UAT twin is the ONLY database these two tables may live in.
-- Copying 099's ladder verbatim produces a migration that refuses the only
-- database it is meant to run against.
--
-- `dbo.AccRequest` must also exist, so a mistyped --db cannot land this on some
-- other database whose name happens to end in _UAT.
--
-- ---------------------------------------------------------------------------
-- RUN THIS BEFORE 140 AND 141. Both of those drop the Fast_Core originals and
-- refuse to do so unless the copy is already here -- but the refusal is a guard,
-- not a substitute for the order.
--
-- ---------------------------------------------------------------------------
-- THE RESEED FLOORS ARE IDENT_CURRENT, NOT MAX(Id) AND NOT THE ROW COUNT.
--
-- Measured 2026-09-07 against the live Fast_Core: UatTester holds 15 rows whose
-- ids are spread over 1..20, with IDENT_CURRENT = 20; UatTesterPerDiem holds 1
-- row with IDENT_CURRENT = 1. A floor taken from the row count would re-issue
-- ids 16..20, which have already been used.
--
-- ---------------------------------------------------------------------------
-- NO 900000 IDENTITY FLOOR APPLIES HERE.
--
-- Migrations 061 and 064 enumerate 23 transactional table names explicitly
-- (061:39-47, 064:61-69) and neither of these is among them, so ids 1..20 in
-- this database violate nothing. That is safe only because a UatTester.Id never
-- appears in a path the resolver parses -- ROUTE_RULES covers /api/request/*
-- prefixes only, and /api/settings/uat-users is not among them.

SET NOCOUNT ON;

IF DB_NAME() NOT LIKE '%[_]UAT' OR OBJECT_ID('dbo.AccRequest', 'U') IS NULL
BEGIN
  DECLARE @wrongDb NVARCHAR(128) = DB_NAME();
  RAISERROR (
    'Migration 139 may only be applied to the UAT form database: the name must end in _UAT and dbo.AccRequest must exist. Current database is %s.',
    16, 1, @wrongDb
  );
END
ELSE IF OBJECT_ID('dbo.UatTester') IS NOT NULL
     OR OBJECT_ID('dbo.UatTesterPerDiem') IS NOT NULL
BEGIN
  PRINT 'One or both tables already exist here -- batch 1 skipped.';
END
ELSE
BEGIN
  SET XACT_ABORT ON;
  BEGIN TRANSACTION;

  CREATE TABLE [dbo].[UatTester] (
    [Id]              INT IDENTITY(1,1) NOT NULL CONSTRAINT [PK_UatTester] PRIMARY KEY,
    [StaffId]         INT NOT NULL CONSTRAINT [UQ_UatTester_StaffId] UNIQUE,
    [Email]           NVARCHAR(200) NOT NULL,
    [ManagerStaffId]  INT NULL,
    [ManagerEmail]    NVARCHAR(200) NULL,
    [IsActive]        BIT NOT NULL CONSTRAINT [DF_UatTester_IsActive] DEFAULT (1),
    [UpdatedBy]       INT NULL,
    [UpdatedAt]       DATETIME2(7) NOT NULL CONSTRAINT [DF_UatTester_UpdatedAt] DEFAULT (SYSDATETIME())
  );

  CREATE INDEX [IX_UatTester_Email] ON [dbo].[UatTester] ([Email]);

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
  PRINT 'Batch 1: dbo.UatTester and dbo.UatTesterPerDiem created in the UAT form database.';
END
GO

SET NOCOUNT ON;

IF DB_NAME() NOT LIKE '%[_]UAT' OR OBJECT_ID('dbo.AccRequest', 'U') IS NULL
BEGIN
  DECLARE @wrongDb2 NVARCHAR(128) = DB_NAME();
  RAISERROR ('Migration 139 batch 2 may only be applied to the UAT form database. Current database is %s.', 16, 1, @wrongDb2);
END
ELSE IF OBJECT_ID('dbo.UatTester', 'U') IS NULL OR OBJECT_ID('dbo.UatTesterPerDiem', 'U') IS NULL
BEGIN
  RAISERROR ('Migration 139 batch 2: one or both tables do not exist here as tables -- batch 1 did not run.', 16, 1);
END
ELSE IF OBJECT_ID('[Fast_Core].[dbo].[UatTester]', 'U') IS NULL
BEGIN
  RAISERROR (
    'Migration 139 batch 2: [Fast_Core].[dbo].[UatTester] is not a table. If migration 140 has already run it is a synonym pointing back here, and there is nothing to copy.',
    16, 1
  );
END
ELSE IF OBJECT_ID('[Fast_Core].[dbo].[UatTesterPerDiem]', 'U') IS NULL
BEGIN
  RAISERROR (
    'Migration 139 batch 2: [Fast_Core].[dbo].[UatTesterPerDiem] is not a table. If migration 141 has already run it has been dropped, and there is nothing to copy.',
    16, 1
  );
END
ELSE
BEGIN
  SET XACT_ABORT ON;
  BEGIN TRANSACTION;

  SET IDENTITY_INSERT [dbo].[UatTester] ON;

  MERGE INTO [dbo].[UatTester] AS t
  USING [Fast_Core].[dbo].[UatTester] AS s
    ON t.[Id] = s.[Id]
  WHEN MATCHED THEN
    UPDATE SET t.[StaffId] = s.[StaffId],
               t.[Email] = s.[Email],
               t.[ManagerStaffId] = s.[ManagerStaffId],
               t.[ManagerEmail] = s.[ManagerEmail],
               t.[IsActive] = s.[IsActive],
               t.[UpdatedBy] = s.[UpdatedBy],
               t.[UpdatedAt] = s.[UpdatedAt]
  WHEN NOT MATCHED BY TARGET THEN
    INSERT ([Id], [StaffId], [Email], [ManagerStaffId], [ManagerEmail], [IsActive], [UpdatedBy], [UpdatedAt])
    VALUES (s.[Id], s.[StaffId], s.[Email], s.[ManagerStaffId], s.[ManagerEmail], s.[IsActive], s.[UpdatedBy], s.[UpdatedAt]);

  SET IDENTITY_INSERT [dbo].[UatTester] OFF;

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

  DECLARE @srcT INT = (SELECT COUNT(*) FROM [Fast_Core].[dbo].[UatTester]);
  DECLARE @dstT INT = (SELECT COUNT(*) FROM [dbo].[UatTester]);
  DECLARE @srcP INT = (SELECT COUNT(*) FROM [Fast_Core].[dbo].[UatTesterPerDiem]);
  DECLARE @dstP INT = (SELECT COUNT(*) FROM [dbo].[UatTesterPerDiem]);

  IF @srcT <> @dstT OR @srcP <> @dstP
  BEGIN
    ROLLBACK TRANSACTION;
    RAISERROR (
      'Migration 139: after the merge this database holds %d testers and %d rates; Fast_Core holds %d and %d. Rolled back.',
      16, 1, @dstT, @dstP, @srcT, @srcP
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
-- A floor, not the mechanism: SET IDENTITY_INSERT already raises the identity to
-- the highest id inserted. What this guards is the narrower case of a table that
-- reached this database some other way, already holding rows, with an identity
-- lower than the ids it holds. 20 and 1 are the source IDENT_CURRENT values
-- measured 2026-09-07 -- for UatTester that is higher than MAX(Id) would suggest
-- from a row count, because 15 rows occupy ids 1..20.
--
-- Same predicate as batches 1 and 2, not a stricter one: a differently-named
-- database should skip this floor quietly rather than fail the whole run after
-- batches 1 and 2 have already done their job.
IF DB_NAME() LIKE '%[_]UAT'
   AND OBJECT_ID('dbo.AccRequest', 'U') IS NOT NULL
   AND OBJECT_ID('dbo.UatTester', 'U') IS NOT NULL
   AND IDENT_CURRENT('dbo.UatTester') < 20
BEGIN
  DBCC CHECKIDENT ('dbo.UatTester', RESEED, 20);
  PRINT 'Batch 3: UatTester identity floor applied.';
END
GO

SET NOCOUNT ON;

IF DB_NAME() LIKE '%[_]UAT'
   AND OBJECT_ID('dbo.AccRequest', 'U') IS NOT NULL
   AND OBJECT_ID('dbo.UatTesterPerDiem', 'U') IS NOT NULL
   AND IDENT_CURRENT('dbo.UatTesterPerDiem') < 1
BEGIN
  DBCC CHECKIDENT ('dbo.UatTesterPerDiem', RESEED, 1);
  PRINT 'Batch 4: UatTesterPerDiem identity floor applied.';
END
GO
