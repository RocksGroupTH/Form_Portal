-- Realign AccFormBrand's ids in the UAT form database to production's.
--
-- Apply with (Rocks_Portal_Form_UAT ONLY):
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/103_uat_form_brand_id_realign.sql
--
-- ---------------------------------------------------------------------------
-- WHAT IS WRONG, measured 2026-08-21.
--
-- AccFormBrand holds the same 23 (FormCode, BrandCode) pairs in both form
-- databases with identical IsActive and SortOrder, but AP-3 and AP-11 hold
-- each other's id blocks:
--
--            production            UAT
--   AP-11    1011 .. 1015          1016 .. 1020
--   AP-3     1016 .. 1020          1011 .. 1015
--
-- Each block was inserted into the two databases in the opposite order, by
-- something other than writeBothPools -- dual-write inserts production's id
-- into UAT explicitly, so a divergent id is the signature of a direct SQL edit
-- against one database alone. npm run check:alignment has been red on this
-- ever since; it reports only the first differing row (it breaks out of the
-- loop), which is why this looked like one row and is in fact ten.
--
-- Nothing reads AccFormBrand by id: there are zero foreign keys referencing it
-- (measured), and the application resolves brands by (FormCode, BrandCode).
-- The ids matter only because the two databases are supposed to be identical
-- and the verifier says so.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DOES.
--
-- Replaces every UAT row with production's, wholesale, inside one transaction.
-- That is the operation whose correctness is obvious: afterwards the two
-- tables are equal by construction, with no reasoning needed about which
-- individual id moved where or whether a re-insert collides with a row that
-- was left in place. AP-3's and AP-11's blocks each occupy the other's target
-- ids, so a per-row update could not be done in any order without a temporary
-- collision on PK or on UQ_AccFormBrand.
--
-- It is guarded so that it can only ever change ids:
--
--   1. The database must be named Rocks_Portal_Form_UAT. This writes UAT and
--      must never be pointed at production.
--   2. Both tables must hold exactly the same set of (FormCode, BrandCode).
--   3. Every pair must already agree on IsActive and SortOrder.
--
-- If 2 or 3 fails the migration refuses and changes nothing. That is real
-- configuration drift rather than an id swap, and overwriting UAT wholesale
-- would destroy it silently instead of reporting it -- which is the opposite
-- of what the verifier this migration exists to satisfy is for.
--
-- Idempotent: a second run finds the ids already equal and does nothing.
-- ---------------------------------------------------------------------------

SET NOCOUNT ON;

IF DB_NAME() <> N'Rocks_Portal_Form_UAT'
BEGIN
  DECLARE @wrongDb NVARCHAR(128) = DB_NAME();
  RAISERROR (
    'Migration 103 may only be applied to Rocks_Portal_Form_UAT. It rewrites AccFormBrand from production and must never run against production itself. Current database is %s.',
    16, 1, @wrongDb
  );
END
ELSE IF OBJECT_ID('[Rocks_Portal_Form].[dbo].[AccFormBrand]', 'U') IS NULL
BEGIN
  RAISERROR (
    'Migration 103: [Rocks_Portal_Form].[dbo].[AccFormBrand] is not reachable as a table. Refusing.',
    16, 1
  );
END
ELSE
BEGIN
  SET XACT_ABORT ON;
  BEGIN TRANSACTION;

  DECLARE @problem NVARCHAR(400) = NULL;

  -- 2. the same set of pairs, in both directions
  IF @problem IS NULL AND EXISTS (
    SELECT [FormCode], [BrandCode] FROM [dbo].[AccFormBrand] WITH (TABLOCKX)
    EXCEPT
    SELECT [FormCode], [BrandCode] FROM [Rocks_Portal_Form].[dbo].[AccFormBrand])
    SET @problem = 'UAT holds a (FormCode, BrandCode) pair production does not';

  IF @problem IS NULL AND EXISTS (
    SELECT [FormCode], [BrandCode] FROM [Rocks_Portal_Form].[dbo].[AccFormBrand]
    EXCEPT
    SELECT [FormCode], [BrandCode] FROM [dbo].[AccFormBrand])
    SET @problem = 'production holds a (FormCode, BrandCode) pair UAT does not';

  -- 3. every pair already agrees on everything except the id
  IF @problem IS NULL AND EXISTS (
    SELECT u.[FormCode], u.[BrandCode], u.[IsActive], u.[SortOrder]
    FROM [dbo].[AccFormBrand] u
    EXCEPT
    SELECT p.[FormCode], p.[BrandCode], p.[IsActive], p.[SortOrder]
    FROM [Rocks_Portal_Form].[dbo].[AccFormBrand] p)
    SET @problem = 'a pair differs on IsActive or SortOrder, not only on Id -- that is real drift and needs a person';

  IF @problem IS NOT NULL
  BEGIN
    ROLLBACK TRANSACTION;
    RAISERROR (
      'Migration 103 refuses: %s. Nothing was changed. Compare the two tables by hand before retrying.',
      16, 1, @problem
    );
  END
  ELSE IF NOT EXISTS (
    SELECT u.[Id], u.[FormCode], u.[BrandCode] FROM [dbo].[AccFormBrand] u
    EXCEPT
    SELECT p.[Id], p.[FormCode], p.[BrandCode] FROM [Rocks_Portal_Form].[dbo].[AccFormBrand] p)
  BEGIN
    ROLLBACK TRANSACTION;
    PRINT 'AccFormBrand ids already match production -- migration 103 has nothing to do.';
  END
  ELSE
  BEGIN
    DELETE FROM [dbo].[AccFormBrand];

    SET IDENTITY_INSERT [dbo].[AccFormBrand] ON;
    INSERT INTO [dbo].[AccFormBrand] ([Id], [FormCode], [BrandCode], [IsActive], [SortOrder])
    SELECT [Id], [FormCode], [BrandCode], [IsActive], [SortOrder]
    FROM [Rocks_Portal_Form].[dbo].[AccFormBrand];
    SET IDENTITY_INSERT [dbo].[AccFormBrand] OFF;

    COMMIT TRANSACTION;
    PRINT 'AccFormBrand realigned to production''s ids.';
  END
END
GO

SET NOCOUNT ON;

-- Leave the identity where production's is, so the next row minted directly in
-- UAT -- which should never happen, because every write goes through
-- writeBothPools with production's id supplied explicitly -- does not land on
-- an id production has already used.
IF DB_NAME() = N'Rocks_Portal_Form_UAT'
   AND OBJECT_ID('dbo.AccFormBrand', 'U') IS NOT NULL
BEGIN
  DECLARE @prodIdent INT =
    (SELECT ISNULL(MAX([Id]), 0) FROM [Rocks_Portal_Form].[dbo].[AccFormBrand]);
  IF IDENT_CURRENT('dbo.AccFormBrand') < @prodIdent
  BEGIN
    DBCC CHECKIDENT ('dbo.AccFormBrand', RESEED, @prodIdent);
    PRINT 'AccFormBrand identity reseeded to match production.';
  END
END
GO
