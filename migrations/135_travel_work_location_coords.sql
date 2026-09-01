-- Coordinates on an AP-17 work location, so the detail page can pin it.
--
-- Apply to BOTH form databases, before the code:
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/135_travel_work_location_coords.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/135_travel_work_location_coords.sql
--
-- NUMBERED 135. Read `ls migrations/` before picking a number: 132, 133 and 134
-- were taken by this same run of work, and eleven earlier numbers (088, 089,
-- 090, 091, 094, 103, 117, 118, 119, 120, 124) each exist twice, so counting
-- files is not a substitute for looking.
--
-- ---------------------------------------------------------------------------
-- BOTH DATABASES, AND check:alignment WILL NOT CATCH A ONE-SIDED APPLY.
--
-- AccTravelWorkLocation is TRANSACTIONAL, not shared configuration: it is
-- absent from MASTER_TABLES and is in migrations 061/064's list, so it carries
-- the UAT 900000 identity floor. That means it is not dual-written and
-- `npm run check:alignment` says nothing about it — unlike 133 and 134, whose
-- one-sided apply the check would have reported. SQL Server binds object names
-- at compile time, so a column missing from one side is a hard error on the
-- path that reads a work location, and AP-17 resolves either database depending
-- on who is asking. Apply both, then run the post-apply block below on each.
--
-- Adding NULLABLE columns does not disturb the identity floor: 064's CHECK is
-- on Id, and nothing here touches it.
--
-- ---------------------------------------------------------------------------
-- DECIMAL(10,7), the shape AP-1 already uses
--
-- Migration 014 gave AccTravelExpense its six route coordinates as
-- DECIMAL(10,7) NULL, and this matches rather than inventing a second
-- convention. Seven decimal places is about a centimetre — far more than a map
-- pin needs, and the point is that a reader comparing the two tables sees one
-- shape.
--
-- ---------------------------------------------------------------------------
-- NULLABLE, AND NOTHING CAN BACKFILL THEM
--
-- The Google key this app holds is HTTP-referrer restricted: a server-side
-- Places or Geocoding call answers 403 API_KEY_HTTP_REFERRER_BLOCKED (measured
-- 2026-09-01). Coordinates can therefore only be captured in the browser, at
-- the moment somebody picks a place — so every work location already stored,
-- and every one typed by hand rather than picked, has no coordinates and never
-- will. The map renders nothing for those, which is the honest answer.
--
-- NOTE (0,0) IS A REAL POINT, in the Gulf of Guinea. Both existing coordinate
-- validators in this repo reject it explicitly rather than treating it as
-- "unset", and the reader of these columns must do the same.

SET XACT_ABORT ON;
GO

IF DB_NAME() NOT LIKE 'Rocks[_]Portal[_]Form%'
  THROW 50000, 'Run this against Rocks_Portal_Form or Rocks_Portal_Form_UAT only.', 1;
GO

IF OBJECT_ID('dbo.AccTravelWorkLocation', 'U') IS NULL
  THROW 50000, 'dbo.AccTravelWorkLocation is missing — apply 048/059 first.', 1;
GO

IF COL_LENGTH('dbo.AccTravelWorkLocation', 'Lat') IS NULL
BEGIN
  ALTER TABLE [dbo].[AccTravelWorkLocation] ADD [Lat] DECIMAL(10,7) NULL;
  PRINT 'Lat added.';
END
ELSE
  PRINT 'Lat already present -- skipped.';
GO

IF COL_LENGTH('dbo.AccTravelWorkLocation', 'Lng') IS NULL
BEGIN
  ALTER TABLE [dbo].[AccTravelWorkLocation] ADD [Lng] DECIMAL(10,7) NULL;
  PRINT 'Lng added.';
END
ELSE
  PRINT 'Lng already present -- skipped.';
GO

-- Post-apply, on BOTH databases: two non-NULL lengths, and every existing row
-- still without coordinates — nothing is backfilled and nothing can be.
SELECT DB_NAME() AS db,
       COL_LENGTH('dbo.AccTravelWorkLocation','Lat') AS LatLen,
       COL_LENGTH('dbo.AccTravelWorkLocation','Lng') AS LngLen,
       (SELECT COUNT(*) FROM dbo.AccTravelWorkLocation) AS [Rows],
       (SELECT COUNT(*) FROM dbo.AccTravelWorkLocation WHERE Lat IS NOT NULL) AS WithCoords;
GO
