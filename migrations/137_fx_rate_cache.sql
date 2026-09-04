-- Cache what the exchange-rate providers answer, so one rate is fetched once a day.
--
-- Apply with (Rocks_Portal_Form ONLY -- NOT the UAT twin):
--   npm run apply-sql -- --db Rocks_Portal_Form --file migrations/137_fx_rate_cache.sql
--
-- NUMBERED 137. Read `ls migrations/` before picking a number rather than
-- counting files: eleven earlier numbers (088, 089, 090, 091, 094, 103, 117,
-- 118, 119, 120, 124) each exist twice, from parallel branches.
--
-- ---------------------------------------------------------------------------
-- SINGLE COPY, PRODUCTION ONLY. Not created in Rocks_Portal_Form_UAT, not
-- dual-written, not in MASTER_TABLES -- the same argument migration 116 makes
-- for ApiKey, and for the same reason. An exchange rate is a fact about the
-- world on a given day, not configuration that differs by environment: there is
-- one answer for USD on 2026-09-04, and a tester in UAT mode must convert at
-- the rate a production user converts at, or the two environments disagree
-- about what a claim is worth. Reads and writes go through
-- getProductionFormPool(), never getFormPool(), which would resolve
-- Rocks_Portal_Form_UAT for a tester and find no table at all -- the hazard
-- CLAUDE.md records for DepartmentErpMap, BrandCurrency and ApiKey.
--
-- WHY THE KEY IS THE DAY ASKED FOR, NOT THE DAY THE PROVIDER ANSWERED WITH.
-- These are different dates and the difference is the whole design. Both
-- sources publish on WORKING DAYS ONLY, so a lookup on a Saturday comes back
-- carrying Friday's rate, and over a long weekend a three-day-old one. Keyed on
-- the provider's own date, a Saturday lookup would search for Saturday, never
-- find it, and call the API again -- every time, on exactly the days the cache
-- is meant to cover. Keyed on QueryDate, the second Saturday lookup is a hit.
--
-- RateAsOf is stored beside it and is NOT redundant: it is the provenance
-- migration 130 exists to preserve. Without it nothing afterwards can tell
-- which day's rate a figure actually used, and a row saved on a Monday holiday
-- looks identical to one saved on the Friday it really came from.
--
-- WHY Source IS IN THE UNIQUE KEY. A deployment with no BOT_CURRENCY_RATE key
-- registered falls back to the keyless ECB mid-market figure. The day somebody
-- registers the real Bank of Thailand credential, every cached ECB row for
-- today would otherwise go on being served -- so the operator would configure
-- BOT, see no change, and have no way to tell why. With Source in the key the
-- switch simply misses and re-fetches. Deactivating the key does the reverse,
-- just as cleanly.
--
-- NOTHING HERE IS AUTHORITATIVE AND NOTHING EXPIRES A CLAIM. A stored claim
-- keeps its own ExchangeRate / RateAsOf / RateSource columns (migrations 125,
-- 129, 130); this table only saves a network round trip on the way to writing
-- them. Deleting every row costs nothing but some API calls, which is why there
-- is no pruning job: the table grows by roughly (currencies in use) x (days),
-- and the currencies in use are the handful BrandCurrency allows.
--
-- A WRITE HERE IS BEST-EFFORT, BY DESIGN. src/lib/adv/fx-rate-cache.ts swallows
-- its own failures: a cache that cannot be written must never be the reason a
-- requester cannot file a claim. The consequence is that this table can be
-- missing or unreachable and the application still works, just chattier -- so a
-- deployment that has not applied this migration is degraded, not broken.
-- ---------------------------------------------------------------------------

-- Batch 1 -- refuse the UAT twin outright.
IF DB_NAME() LIKE '%[_]UAT'
BEGIN
  RAISERROR('137 must not be applied to a UAT database. FX rates are production-only, single-copy.', 16, 1);
END
GO

-- Batch 2 -- refuse anything that is not a form database, so a mistyped --db
-- cannot create this in Fast_Core or in the Rocks Fast sibling's Fast_Form.
IF DB_NAME() NOT LIKE 'Rocks[_]Portal[_]Form%'
BEGIN
  RAISERROR('137 targets Rocks_Portal_Form. Check --db.', 16, 1);
END
GO

SET XACT_ABORT ON;
GO

-- Batch 3 -- the table.
IF OBJECT_ID('dbo.FxRateCache', 'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[FxRateCache] (
    [Id]         int IDENTITY(1,1) NOT NULL,
    -- ISO-4217, upper case. CHAR(3) pads a short value and raises on a long
    -- one, which is what we want: a bad currency must fail here, not truncate.
    [Currency]   char(3) NOT NULL,
    -- The day the caller asked about -- today, or an explicit historical date.
    -- This is the lookup key. See the header for why it is not RateAsOf.
    [QueryDate]  date NOT NULL,
    -- 'BOT' or 'ECB'. Part of the key, deliberately -- see the header.
    [Source]     nvarchar(10) NOT NULL,
    [Rate]       decimal(18,6) NOT NULL,
    -- The provider's OWN date, which may be earlier than QueryDate whenever the
    -- market did not trade. This is the provenance, not the key.
    [RateAsOf]   date NOT NULL,
    [FetchedAt]  datetime2(7) NOT NULL CONSTRAINT DF_FxRateCache_FetchedAt DEFAULT (sysdatetime()),
    CONSTRAINT PK_FxRateCache PRIMARY KEY CLUSTERED ([Id]),
    -- A rate is THB per one unit and is never zero or negative. A provider that
    -- answers 0 is a provider we must not have cached.
    CONSTRAINT CK_FxRateCache_Rate CHECK ([Rate] > 0),
    CONSTRAINT CK_FxRateCache_Source CHECK ([Source] IN ('BOT', 'ECB')),
    -- The provider cannot answer with a date in the future relative to the day
    -- asked about; if it does, something is wrong enough not to cache.
    CONSTRAINT CK_FxRateCache_AsOf CHECK ([RateAsOf] <= [QueryDate])
  );

  -- One row per currency per day per source. The upsert MERGEs on exactly this,
  -- so two concurrent misses converge instead of racing to insert twice.
  CREATE UNIQUE INDEX UQ_FxRateCache_Lookup
    ON [dbo].[FxRateCache] ([Currency], [QueryDate], [Source]);
END
GO

-- Batch 4 -- report.
SELECT
  CASE WHEN OBJECT_ID('dbo.FxRateCache', 'U') IS NULL THEN 'MISSING' ELSE 'OK' END AS FxRateCache,
  (SELECT COUNT(*) FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.FxRateCache') AND name = 'UQ_FxRateCache_Lookup') AS UniqueIndex,
  DB_NAME() AS AppliedTo;
GO
