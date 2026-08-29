-- Record WHICH DAY'S rate a claim was converted at, and where it came from.
--
-- Apply to BOTH form databases, before the code deploy:
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/130_rate_provenance.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/130_rate_provenance.sql
--
-- NUMBERED 130. Read the highest number on *master* before picking one.
--
-- ---------------------------------------------------------------------------
-- WHY THE RATE ALONE IS NOT ENOUGH
--
-- 125 and 129 stored ExchangeRate and threw away everything else `resolveRate`
-- returns. So a claim records that it was converted at 8.1856 and nothing about
-- WHEN that was the rate or WHO said so. Both matter, and the gap is not
-- academic:
--
--   * The rate source is the ECB via frankfurter, which publishes on WORKING
--     DAYS ONLY, around 16:00 CET. A claim saved on a Saturday carries Friday's
--     rate — measured 2026-08-29, a Saturday, where `latest` answered with
--     date 2026-08-28. Without RateAsOf nobody can tell afterwards whether a
--     figure used that day's rate or one three days stale over a long weekend.
--   * BOT_API_CLIENT_ID is deliberately unprovisioned (spec 9.1), so every rate
--     today is an ECB mid-market reference rate rather than the Bank of
--     Thailand buying-transfer rate a Thai audit expects. If a key is ever
--     bought, rows written before and after that day are converted on different
--     bases — and RateSource is the only thing that would distinguish them.
--     Without it, the change would be invisible and unreconstructable.
--
-- An accounting override (line-rate-override.ts) rewrites ExchangeRate by hand.
-- It sets RateSource to name itself, so a corrected rate is never mistaken for
-- one a provider published.
--
-- ALL NULLABLE, no backfill. A row written before this reads NULL, which is the
-- truth: nobody recorded the provenance, and inventing a date would be worse
-- than admitting there is none.
--
-- BOTH DATABASES, per the usual rule: SQL Server binds object names at compile
-- time, so a query naming RateAsOf fails outright against whichever side is
-- missing it, and both forms resolve either database depending on who is asking.
-- Neither table is in MASTER_TABLES, so check:alignment must still read 25.

SET XACT_ABORT ON;
GO

IF DB_NAME() NOT LIKE 'Rocks[_]Portal[_]Form%'
  THROW 50000, 'Run this against Rocks_Portal_Form or Rocks_Portal_Form_UAT only.', 1;
GO

IF OBJECT_ID('dbo.AccTravelExpenseItem', 'U') IS NULL OR OBJECT_ID('dbo.AccRequest', 'U') IS NULL
  THROW 50000, 'AccTravelExpenseItem or AccRequest is missing — apply 059 first.', 1;
GO

BEGIN TRANSACTION;

-- AP-1: per line, beside the rate it qualifies.
IF COL_LENGTH('dbo.AccTravelExpenseItem', 'RateAsOf') IS NULL
  ALTER TABLE [dbo].[AccTravelExpenseItem] ADD [RateAsOf] DATE NULL;

IF COL_LENGTH('dbo.AccTravelExpenseItem', 'RateSource') IS NULL
  ALTER TABLE [dbo].[AccTravelExpenseItem] ADD [RateSource] NVARCHAR(20) NULL;

-- AP-17: per request, where its booking desk records one rate for the booking.
IF COL_LENGTH('dbo.AccRequest', 'RateAsOf') IS NULL
  ALTER TABLE [dbo].[AccRequest] ADD [RateAsOf] DATE NULL;

IF COL_LENGTH('dbo.AccRequest', 'RateSource') IS NULL
  ALTER TABLE [dbo].[AccRequest] ADD [RateSource] NVARCHAR(20) NULL;

COMMIT TRANSACTION;
GO

SELECT
  COL_LENGTH('dbo.AccTravelExpenseItem','RateAsOf')   AS ItemRateAsOf,
  COL_LENGTH('dbo.AccTravelExpenseItem','RateSource') AS ItemRateSource,
  COL_LENGTH('dbo.AccRequest','RateAsOf')             AS RequestRateAsOf,
  COL_LENGTH('dbo.AccRequest','RateSource')           AS RequestRateSource;
GO
