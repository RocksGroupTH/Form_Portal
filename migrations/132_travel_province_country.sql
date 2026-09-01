-- Give TravelProvince a country, so it can hold somewhere other than Thailand.
--
-- TARGET: Rocks_Portal_Form ONLY — NEVER Rocks_Portal_Form_UAT.
--   npm run apply-sql -- --db Rocks_Portal_Form --file migrations/132_travel_province_country.sql
--
-- NUMBERED 132. Read `ls migrations/` before picking a number: 131 is the
-- highest present, but eleven numbers are duplicated (088, 089, 090, 091, 094,
-- 103, 117, 118, 119, 120, 124), so counting the files gives the wrong answer.
--
-- Design: docs/superpowers/specs/2026-08-31-ap17-worldwide-places-design.md
--
-- ---------------------------------------------------------------------------
-- SINGLE COPY, exactly as migration 104 left it. Rocks_Portal_Form_UAT holds no
-- dbo.TravelProvince object of any kind and must not gain one: Fast_Data's
-- synonym (migration 105) names exactly one database, so the Rocks Fast sibling
-- could never reach a UAT twin even if one existed. This migration therefore
-- REFUSES a database whose name ends in _UAT rather than quietly creating a
-- second version of a table that is supposed to have one.
--
-- Not dual-written. NOT added to MASTER_TABLES
-- (scripts/checks/verify-master-alignment.ts, still 25): a dual-written table's
-- ids must be identical in BOTH form databases, and this table exists in only
-- one of them, so the alignment check would have no second side to compare and
-- would red permanently. Not in migrations 061/064 either.
--
-- ---------------------------------------------------------------------------
-- WIDENING THE COLUMN IS SAFE FOR THE TWO SIBLING APPLICATIONS. ADDING ROWS IS
-- NOT.
--
-- Neither sibling SELECTs *. Rocks Fast names three columns —
--   SELECT Id, NameTh, NameEn FROM [dbo].[TravelProvince] WHERE IsActive = 1
-- (../RocksFast/src/lib/acc/travel-booking/province-service.ts) and NameTh
-- alone in its own request-service.ts. So this ALTER changes nothing for it.
--
-- CORRECTION, 2026-09-01. The line that stood here said "ACC_Portal never
-- mentions the table at all". THAT WAS WRONG, and wrong in the direction that
-- matters: ACC Portal reads this table DIRECTLY out of Rocks_Portal_Form
-- through its own getProductionFormPool(), not through Fast_Data's synonym
-- (ACC_Portal/src/lib/acc/travel-booking/province-service.ts), and it selects
-- Id, NameTh, NameEn the same way. The ALTER is still safe for it — no
-- SELECT * anywhere — but the row hazard below applies to ACC Portal as well,
-- and there it CANNOT be fixed by filtering a synonym, because it reads the
-- base table. ACC Portal was committed against on 2026-08-31; it is not
-- frozen. This migration is left applied and only its comment corrected.
--
-- What DOES change for them is the first foreign row somebody adds through the
-- new admin screen. That Rocks Fast query has NO country filter, so a city in
-- another country appears in ITS "จังหวัด" dropdown the moment the row commits.
-- The remedy is one line in that repository —
--   AND CountryCode = 'TH'
-- — and it belongs to whoever owns Rocks Fast. This migration deliberately does
-- not add any foreign row, so applying it is safe on its own and the two
-- applications can be coordinated afterwards.
--
-- ---------------------------------------------------------------------------
-- WHY THE DEFAULT IS ADDED AND THEN DROPPED
--
-- CHAR(2) NOT NULL cannot be added to a table that already has 77 rows without
-- a default to fill them, and every one of those rows is Thai. Once they are
-- filled the default has done its job, and keeping it would mean a future
-- INSERT that forgets the column silently files a foreign city as a Thai
-- province — in the sibling's dropdown as well as ours. Dropping it makes that
-- INSERT fail instead, which is the direction to be wrong in.

SET XACT_ABORT ON;
GO

SET NOCOUNT ON;

IF DB_NAME() LIKE '%[_]UAT'
BEGIN
  DECLARE @uatDb NVARCHAR(128) = DB_NAME();
  RAISERROR ('Migration 132 must not be applied to the UAT form database — TravelProvince has one copy, in production. Current database is %s.', 16, 1, @uatDb);
END
ELSE IF DB_NAME() NOT LIKE 'Rocks[_]Portal[_]Form%'
     OR OBJECT_ID('dbo.AccRequest', 'U') IS NULL
BEGIN
  DECLARE @notForm NVARCHAR(128) = DB_NAME();
  RAISERROR ('Migration 132 may only be applied to the production Form Portal database. Current database is %s.', 16, 1, @notForm);
END
ELSE IF OBJECT_ID('dbo.TravelProvince', 'U') IS NULL
BEGIN
  RAISERROR ('dbo.TravelProvince does not exist — apply migration 104 first.', 16, 1);
END
GO

-- Batch of its own: a batch that both adds a column and then names it does not
-- compile. apply-sql.ts splits on GO and runs each batch separately.
IF COL_LENGTH('dbo.TravelProvince', 'CountryCode') IS NULL
BEGIN
  ALTER TABLE [dbo].[TravelProvince]
    ADD [CountryCode] CHAR(2) NOT NULL
        CONSTRAINT [DF_TravelProvince_CountryCode] DEFAULT ('TH');
  PRINT 'Batch 2: CountryCode added; all existing rows defaulted to TH.';
END
ELSE
  PRINT 'Batch 2: CountryCode already present — skipped.';
GO

IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_TravelProvince_CountryCode')
BEGIN
  ALTER TABLE [dbo].[TravelProvince] DROP CONSTRAINT [DF_TravelProvince_CountryCode];
  PRINT 'Batch 3: backfill default dropped — an INSERT must now name the country.';
END
ELSE
  PRINT 'Batch 3: no backfill default to drop — skipped.';
GO

-- Post-apply: expect exactly one group — TH, 77.
SELECT CountryCode, COUNT(*) AS [Rows] FROM [dbo].[TravelProvince] GROUP BY CountryCode ORDER BY CountryCode;
GO
