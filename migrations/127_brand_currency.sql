-- A brand may claim in SEVERAL currencies, not one.
--
-- Apply with (PRODUCTION form database ONLY — there is no UAT twin, for the
-- same reason BrandSetting has none):
--   npm run apply-sql -- --db Rocks_Portal_Form --file migrations/127_brand_currency.sql
--
-- NUMBERED 127. Read the highest number on *master* before picking one.
--
-- ---------------------------------------------------------------------------
-- WHY THIS REPLACES THREE COLUMNS ON BrandSetting
--
-- 124 gave BrandSetting one CountryCode, one CurrencyCode and one
-- CurrencyEnabled, on the design that a brand claims in one currency. It does
-- not: KSI may need Thailand (THB) and England (GBP), and more later. One row
-- per brand per currency is the only shape that holds that.
--
-- The old columns are NOT dropped here. Code still reads them until the
-- follow-up lands, and dropping a column out from under running code is how a
-- deploy takes the app down. Migration 128 drops them once nothing reads them.
-- Until then BrandCurrency is the source of truth and the old columns are dead
-- weight — which is exactly why 128 must not be skipped: two places that could
-- answer "which currency" is the confusion this whole feature exists to avoid.
--
-- UNIQUE (BrandCode, CurrencyCode) is the "no duplicates" rule, in the schema
-- rather than in a handler. A UI check alone is not a rule: two admins on two
-- tabs, or one request replayed, both defeat it.
--
-- IsEnabled per ROW, so a brand can carry a currency it is not currently using
-- without losing the configuration. Default 1 here — unlike BrandSetting's
-- CurrencyEnabled, which defaulted 0 — because adding a row is now a deliberate
-- act naming one currency, where the old flag sat on every brand whether anyone
-- had configured it or not.
--
-- PRODUCTION ONLY. Rocks_Portal_Form_UAT has no BrandSetting and gets no
-- BrandCurrency: every read goes through brand-registry.ts on
-- getProductionFormPool(), which src/lib/acc/currency-pool-guard.test.ts pins
-- per file.

SET XACT_ABORT ON;
GO

IF DB_NAME() NOT LIKE 'Rocks[_]Portal[_]Form'
  THROW 50000, 'Run this against Rocks_Portal_Form only — there is no UAT twin.', 1;
GO

IF OBJECT_ID('dbo.BrandSetting', 'U') IS NULL
  THROW 50000, 'dbo.BrandSetting is missing — apply 122 and 124 first.', 1;
GO

IF OBJECT_ID('dbo.BrandCurrency', 'U') IS NULL
CREATE TABLE [dbo].[BrandCurrency] (
  [Id]           int IDENTITY(1,1) NOT NULL CONSTRAINT [PK_BrandCurrency] PRIMARY KEY,
  [BrandCode]    nvarchar(40) NOT NULL,
  [CountryCode]  char(2)      NULL,   -- ISO-3166-1 alpha-2; the currency's country
  [CurrencyCode] char(3)      NOT NULL,-- ISO-4217
  [IsEnabled]    bit          NOT NULL CONSTRAINT [DF_BrandCurrency_IsEnabled] DEFAULT (1),
  [SortOrder]    int          NOT NULL CONSTRAINT [DF_BrandCurrency_SortOrder] DEFAULT (0),
  [CreatedAt]    datetime2(7) NOT NULL CONSTRAINT [DF_BrandCurrency_CreatedAt] DEFAULT (sysdatetime()),
  [UpdatedAt]    datetime2(7) NULL,
  CONSTRAINT [UQ_BrandCurrency_Brand_Currency] UNIQUE ([BrandCode], [CurrencyCode])
);
GO

IF OBJECT_ID('dbo.BrandCurrency', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes
                   WHERE name = 'IX_BrandCurrency_Brand'
                     AND object_id = OBJECT_ID('dbo.BrandCurrency'))
  CREATE INDEX [IX_BrandCurrency_Brand]
    ON [dbo].[BrandCurrency] ([BrandCode], [SortOrder]);
GO

-- Carry across anything 124's columns already hold. Measured before writing
-- this: all six rows are NULL/0, so this moves nothing today — it is here so
-- the migration is correct if applied to a database where somebody had
-- configured a brand in the meantime.
IF COL_LENGTH('dbo.BrandSetting', 'CurrencyCode') IS NOT NULL
INSERT INTO [dbo].[BrandCurrency] ([BrandCode], [CountryCode], [CurrencyCode], [IsEnabled])
SELECT bs.[BrandCode], bs.[CountryCode], bs.[CurrencyCode], bs.[CurrencyEnabled]
FROM [dbo].[BrandSetting] bs
WHERE bs.[CurrencyCode] IS NOT NULL
  AND LTRIM(RTRIM(bs.[CurrencyCode])) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM [dbo].[BrandCurrency] bc
    WHERE bc.[BrandCode] = bs.[BrandCode] AND bc.[CurrencyCode] = bs.[CurrencyCode]
  );
GO

-- Post-apply: the table exists with its uniqueness rule, and whatever 124 held
-- has been carried over.
SELECT COUNT(*) AS BrandCurrencyRows FROM [dbo].[BrandCurrency];
GO
SELECT name AS UniqueConstraint FROM sys.key_constraints
WHERE parent_object_id = OBJECT_ID('dbo.BrandCurrency') AND type = 'UQ';
GO
