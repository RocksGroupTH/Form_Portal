-- Realign Fast_Core.dbo.UatTesterPerDiem to the live UAT copy, so migration
-- 140's content guard can do its job.
--
-- TARGET: Fast_Core ONLY.
--   npm run apply-sql -- --db Fast_Core --file migrations/141_core_uat_tester_per_diem_realign.sql
--
-- ---------------------------------------------------------------------------
-- THIS IS NOT THE "MIGRATION 141" THE SUPERSEDED PLAN DESCRIBES.
--
-- docs/superpowers/plans/2026-09-07-uat-tester-move.md still contains the SQL
-- for a migration 141 that created a Fast_Core SYNONYM for UatTester. That
-- design was reversed before anything was applied -- UatTester stays in
-- Fast_Core as a real table -- and that 141 must never run. It shares only a
-- number with this file, which touches UatTesterPerDiem and nothing else.
--
-- ---------------------------------------------------------------------------
-- WHY THIS EXISTS.
--
-- Measured on the live databases 2026-09-07 22:37 (server local time):
--
--   Fast_Core            Id=1  300  eff 09-07  IsActive=1   updated 17:52:46
--   Rocks_Portal_Form_UAT Id=1  300  eff 09-07  IsActive=0   updated 20:44:56
--   Rocks_Portal_Form_UAT Id=2  400  eff 09-08  IsActive=0   created 20:44:27
--
-- 139 ran at 20:44:13 and copied Id=1 across with its CreatedAt intact. From
-- that moment the deployed code read and wrote through getUatFormPool(), so
-- every change since -- the new rate and both deactivations -- landed in the
-- UAT copy alone, and the Fast_Core copy froze at its 17:52 state.
--
-- So the UAT copy is not behind, it is AHEAD: it holds everything Fast_Core
-- holds plus later edits to the same rows. Dropping Fast_Core loses nothing.
-- But 140's guard is `source EXCEPT target` -- it asks whether the source is
-- contained in the target -- and a stale IsActive=1 row is not contained in
-- anything. The guard cannot tell "the target moved on" from "the copy failed",
-- and it must not: only a person can, and that is the whole reason 140 refuses
-- rather than dropping.
--
-- This file records the answer a person gave, in the direction that keeps 140
-- exactly as written and as reviewed: make the source match the live copy,
-- then let 140's guard pass honestly. The alternative -- editing 140 or
-- forcing past it -- would leave the repo with a guard nobody can trust.
--
-- ---------------------------------------------------------------------------
-- THE TARGET DATABASE NAME IS HARD-CODED, AND THAT IS THE USUAL HAZARD.
--
-- [Rocks_Portal_Form_UAT] is written out below rather than resolved from
-- MSSQL_FORM_UAT_DATABASE, the same shape CLAUDE.md records for 100/102/105.
-- It is acceptable here only because this file is a one-off run immediately
-- before 140 drops the table it writes. Do not copy the pattern into anything
-- that lives longer.
--
-- ---------------------------------------------------------------------------
-- IT VERIFIES BOTH DIRECTIONS, NOT ONE.
--
-- 140 checks `source EXCEPT target` because it only needs to know nothing is
-- lost by the drop. This one is making two tables equal, so it checks the
-- counts AND both EXCEPT directions and rolls back on any of the three. The
-- table carries no nvarchar(MAX) column, so every column is compared for real
-- -- none is reduced to a DATALENGTH the way migration 102's guard had to be.

SET NOCOUNT ON;

IF DB_NAME() <> N'Fast_Core'
BEGIN
  DECLARE @wrongDb NVARCHAR(128) = DB_NAME();
  RAISERROR (
    'Migration 141 (realign) may only be applied to Fast_Core. Current database is %s.',
    16, 1, @wrongDb
  );
END
ELSE IF OBJECT_ID('dbo.UatTesterPerDiem', 'U') IS NULL
BEGIN
  PRINT 'Fast_Core.dbo.UatTesterPerDiem does not exist -- migration 140 has already run. Nothing to realign.';
END
ELSE IF OBJECT_ID('[Rocks_Portal_Form_UAT].[dbo].[UatTesterPerDiem]', 'U') IS NULL
BEGIN
  RAISERROR (
    'Migration 141 (realign): [Rocks_Portal_Form_UAT].[dbo].[UatTesterPerDiem] is not a table. Run migration 139 first -- there is nothing to realign towards.',
    16, 1
  );
END
ELSE
BEGIN
  SET XACT_ABORT ON;
  BEGIN TRANSACTION;

  SET IDENTITY_INSERT [dbo].[UatTesterPerDiem] ON;

  MERGE INTO [dbo].[UatTesterPerDiem] AS t
  USING [Rocks_Portal_Form_UAT].[dbo].[UatTesterPerDiem] AS s
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
    VALUES (s.[Id], s.[StaffId], s.[EffectiveDate], s.[Amount], s.[Note], s.[IsActive], s.[CreatedBy], s.[CreatedAt], s.[UpdatedBy], s.[UpdatedAt])
  WHEN NOT MATCHED BY SOURCE THEN
    DELETE;

  SET IDENTITY_INSERT [dbo].[UatTesterPerDiem] OFF;

  DECLARE @here INT = (SELECT COUNT(*) FROM [dbo].[UatTesterPerDiem]);
  DECLARE @there INT = (SELECT COUNT(*) FROM [Rocks_Portal_Form_UAT].[dbo].[UatTesterPerDiem]);

  DECLARE @onlyHere INT = (
    SELECT COUNT(*) FROM (
      SELECT [Id], [StaffId], [EffectiveDate], [Amount], [Note], [IsActive], [CreatedBy], [CreatedAt], [UpdatedBy], [UpdatedAt]
      FROM [dbo].[UatTesterPerDiem]
      EXCEPT
      SELECT [Id], [StaffId], [EffectiveDate], [Amount], [Note], [IsActive], [CreatedBy], [CreatedAt], [UpdatedBy], [UpdatedAt]
      FROM [Rocks_Portal_Form_UAT].[dbo].[UatTesterPerDiem]
    ) d);

  DECLARE @onlyThere INT = (
    SELECT COUNT(*) FROM (
      SELECT [Id], [StaffId], [EffectiveDate], [Amount], [Note], [IsActive], [CreatedBy], [CreatedAt], [UpdatedBy], [UpdatedAt]
      FROM [Rocks_Portal_Form_UAT].[dbo].[UatTesterPerDiem]
      EXCEPT
      SELECT [Id], [StaffId], [EffectiveDate], [Amount], [Note], [IsActive], [CreatedBy], [CreatedAt], [UpdatedBy], [UpdatedAt]
      FROM [dbo].[UatTesterPerDiem]
    ) d);

  IF @here <> @there OR @onlyHere <> 0 OR @onlyThere <> 0
  BEGIN
    ROLLBACK TRANSACTION;
    RAISERROR (
      'Migration 141 (realign) rolled back: Fast_Core holds %d row(s), the UAT copy %d; %d row(s) only here, %d only there.',
      16, 1, @here, @there, @onlyHere, @onlyThere
    );
  END
  ELSE
  BEGIN
    COMMIT TRANSACTION;
    PRINT 'Fast_Core.dbo.UatTesterPerDiem now matches the UAT copy row for row. Migration 140 can run.';
  END
END
GO
