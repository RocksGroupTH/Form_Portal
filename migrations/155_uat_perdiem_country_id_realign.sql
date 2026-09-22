-- Realign AccTravelPerDiemCountry's ids in the UAT form database to production's.
--
-- Apply with (Rocks_Portal_Form_UAT ONLY):
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/155_uat_perdiem_country_id_realign.sql
--
-- Afterwards `npm run check:alignment` must PASS at 30 tables. It has been red
-- on this one table since before 2026-09-22.
--
-- ---------------------------------------------------------------------------
-- WHAT IS WRONG, measured 2026-09-22 against the live databases.
--
-- Both form databases hold the same three rows with identical business data.
-- Only the MY row's id differs, and the identity counters have diverged with it:
--
--                        production            UAT
--   GB 2026-09-01  1000       Id 1                  Id 1
--   GB 2026-09-04  1500       Id 2                  Id 2
--   MY 2026-09-21   500       Id 3                  Id 1002
--   IDENT_CURRENT              3                     1002
--
-- Nothing in migrations/ causes this: 133 creates the table with a plain
-- IDENTITY(1,1) and no reseed, and 148 does not name it. A divergent id on a
-- dual-written master table is the signature of a direct SQL edit — or here,
-- more likely, a hand reseed to 1000, which is the correct instinct applied to
-- the wrong kind of table. CLAUDE.md is explicit that these tables are absent
-- from 061/064 precisely BECAUSE their ids must be identical rather than
-- disjoint; the 900000 floor and UAT_SEQUENCE_FLOOR apply to transactional
-- tables, never to this one.
--
-- WHAT IT COSTS TODAY, and why it is worth a migration rather than a note.
--
-- The table has two writers and they do not share the hazard:
--
--   * upsertPerDiemCountryRate MERGEs on (CountryCode, EffectiveDate)
--     (perdiem-source.ts:122) — id-independent, and therefore immune.
--   * setPerDiemCountryRateActive is `UPDATE ... WHERE Id = @id` inside
--     writeBothPools (perdiem-source.ts:146) — id-dependent, and broken.
--
-- So switching a rate off silently applies to one database and not the other,
-- and WHICH one depends on who is looking: the settings page reads through
-- getAccPool(), so an admin in PRO sends Id 3 (production retires MY, UAT
-- matches nothing and keeps pricing it) while a tester in UAT mode sends
-- Id 1002 (the reverse). Neither path errors. Every rate added from now on
-- widens the gap — production would take Id 4, UAT Id 1003.
--
-- Nothing reads this table by id from outside it: zero foreign keys reference
-- it (measured across migrations/), and pricing resolves rates by country and
-- effective date. The ids matter because the two databases are supposed to be
-- identical, because the soft delete addresses rows by id, and because the
-- verifier says so.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DOES.
--
-- Replaces every UAT row with production's, wholesale, inside one transaction —
-- migration 103's operation, for the same reason: afterwards the two tables are
-- equal by construction, with no reasoning needed about which individual id
-- moved where or whether a re-insert collides with a row left in place.
--
-- It is guarded so it can only ever change ids. It refuses unless both tables
-- hold the same set of (CountryCode, EffectiveDate) pairs, in both directions,
-- AND every pair already agrees on Amount, Note, IsActive, CreatedBy and
-- UpdatedBy. Real configuration drift therefore still reports rather than being
-- silently overwritten by production, which is the whole point of the verifier
-- this exists to satisfy.
--
-- CreatedAt / UpdatedAt are copied but deliberately NOT compared. The verifier
-- excludes datetime columns by design, so a difference there is not drift this
-- migration should refuse over — but the real timestamps are still carried
-- across rather than left to the column defaults, which would stamp today over
-- the row's actual history for no reason.
--
-- THE RESEED GOES DOWN HERE, which is the opposite of 103's.
-- UAT's counter is AHEAD (1002 against 3), so the reseed lowers it to match
-- production. That is safe only because nothing references these ids: after the
-- realign UAT holds exactly production's rows, so the highest id present is
-- production's highest, and the next insert on either side takes the same next
-- value. Do not copy this direction to a table with foreign keys pointing at it.
-- ---------------------------------------------------------------------------

SET NOCOUNT ON;
GO

IF DB_NAME() <> N'Rocks_Portal_Form_UAT'
BEGIN
  DECLARE @wrongDb NVARCHAR(128) = DB_NAME();
  RAISERROR (
    'Migration 155 targets Rocks_Portal_Form_UAT only; this connection is on %s. Nothing was changed.',
    16, 1, @wrongDb
  );
END
ELSE IF OBJECT_ID('dbo.AccTravelPerDiemCountry', 'U') IS NULL
BEGIN
  RAISERROR (
    'dbo.AccTravelPerDiemCountry is missing -- apply 133 first. Nothing was changed.',
    16, 1
  );
END
ELSE
BEGIN
  SET XACT_ABORT ON;
  BEGIN TRANSACTION;

  DECLARE @problem NVARCHAR(400) = NULL;

  -- 1. the same set of (CountryCode, EffectiveDate) pairs, in both directions
  IF @problem IS NULL AND EXISTS (
    SELECT [CountryCode], [EffectiveDate] FROM [dbo].[AccTravelPerDiemCountry] WITH (TABLOCKX)
    EXCEPT
    SELECT [CountryCode], [EffectiveDate] FROM [Rocks_Portal_Form].[dbo].[AccTravelPerDiemCountry])
    SET @problem = 'UAT holds a (CountryCode, EffectiveDate) pair production does not';

  IF @problem IS NULL AND EXISTS (
    SELECT [CountryCode], [EffectiveDate] FROM [Rocks_Portal_Form].[dbo].[AccTravelPerDiemCountry]
    EXCEPT
    SELECT [CountryCode], [EffectiveDate] FROM [dbo].[AccTravelPerDiemCountry])
    SET @problem = 'production holds a (CountryCode, EffectiveDate) pair UAT does not';

  -- 2. every pair already agrees on everything except the id
  IF @problem IS NULL AND EXISTS (
    SELECT u.[CountryCode], u.[EffectiveDate], u.[Amount], u.[Note], u.[IsActive], u.[CreatedBy], u.[UpdatedBy]
    FROM [dbo].[AccTravelPerDiemCountry] u
    EXCEPT
    SELECT p.[CountryCode], p.[EffectiveDate], p.[Amount], p.[Note], p.[IsActive], p.[CreatedBy], p.[UpdatedBy]
    FROM [Rocks_Portal_Form].[dbo].[AccTravelPerDiemCountry] p)
    SET @problem = 'a rate differs on Amount, Note, IsActive or a user column, not only on Id -- that is real drift and needs a person';

  IF @problem IS NOT NULL
  BEGIN
    ROLLBACK TRANSACTION;
    RAISERROR (
      'Migration 155 refuses: %s. Nothing was changed. Compare the two tables by hand before retrying.',
      16, 1, @problem
    );
  END
  ELSE IF NOT EXISTS (
    SELECT u.[Id], u.[CountryCode], u.[EffectiveDate] FROM [dbo].[AccTravelPerDiemCountry] u
    EXCEPT
    SELECT p.[Id], p.[CountryCode], p.[EffectiveDate] FROM [Rocks_Portal_Form].[dbo].[AccTravelPerDiemCountry] p)
  BEGIN
    ROLLBACK TRANSACTION;
    PRINT 'AccTravelPerDiemCountry ids already match production -- migration 155 has nothing to do.';
  END
  ELSE
  BEGIN
    DELETE FROM [dbo].[AccTravelPerDiemCountry];

    SET IDENTITY_INSERT [dbo].[AccTravelPerDiemCountry] ON;
    INSERT INTO [dbo].[AccTravelPerDiemCountry]
      ([Id], [CountryCode], [EffectiveDate], [Amount], [Note], [IsActive],
       [CreatedBy], [CreatedAt], [UpdatedBy], [UpdatedAt])
    SELECT
       [Id], [CountryCode], [EffectiveDate], [Amount], [Note], [IsActive],
       [CreatedBy], [CreatedAt], [UpdatedBy], [UpdatedAt]
    FROM [Rocks_Portal_Form].[dbo].[AccTravelPerDiemCountry];
    SET IDENTITY_INSERT [dbo].[AccTravelPerDiemCountry] OFF;

    COMMIT TRANSACTION;
    PRINT 'AccTravelPerDiemCountry realigned to production''s ids.';
  END
END
GO

SET NOCOUNT ON;

-- Put the identity where production's is. Unlike 103 this moves DOWN: UAT's
-- counter ran ahead (1002 against 3), so leaving it would have the next UAT row
-- diverge again on the very next rate an admin adds.
--
-- RESEED is unconditional on direction here, deliberately. 103 guards with
-- `IF IDENT_CURRENT < @prodIdent` because its drift only ever ran one way; this
-- table's runs the other, and a guard copied from 103 would silently do nothing.
IF DB_NAME() = N'Rocks_Portal_Form_UAT'
   AND OBJECT_ID('dbo.AccTravelPerDiemCountry', 'U') IS NOT NULL
BEGIN
  DECLARE @prodIdent INT =
    (SELECT ISNULL(MAX([Id]), 0) FROM [Rocks_Portal_Form].[dbo].[AccTravelPerDiemCountry]);
  IF IDENT_CURRENT('dbo.AccTravelPerDiemCountry') <> @prodIdent
  BEGIN
    DBCC CHECKIDENT ('dbo.AccTravelPerDiemCountry', RESEED, @prodIdent);
    PRINT 'AccTravelPerDiemCountry identity reseeded to match production.';
  END
END
GO
