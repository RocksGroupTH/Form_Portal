-- Drop 124's single-currency columns, now that BrandCurrency has replaced them.
--
-- Apply with (PRODUCTION form database ONLY):
--   npm run apply-sql -- --db Rocks_Portal_Form --file migrations/128_brand_setting_drop_single_currency.sql
--
-- NUMBERED 128. Read the highest number on *master* before picking one.
--
-- ---------------------------------------------------------------------------
-- APPLY THIS ONLY AFTER THE MULTI-CURRENCY CODE IS DEPLOYED (commit 15a20c5).
--
-- 124 gave BrandSetting one CountryCode, one CurrencyCode and one
-- CurrencyEnabled. 127 replaced that with BrandCurrency — one row per brand per
-- currency — because a brand may claim in several. 127 deliberately left the old
-- columns in place, because dropping a column out from under running code is how
-- a deploy takes the app down.
--
-- WHY THEY MUST NOT SIMPLY BE LEFT. Two places that could answer "which currency
-- may this brand claim in" is the confusion this whole feature exists to avoid.
-- A stale CurrencyCode on BrandSetting is not inert: it is a plausible-looking
-- answer sitting one join away from the real one, and the next person to write a
-- query has no way to tell from the schema which is live. 127 carried the values
-- across, so nothing is lost.
--
-- Verified before writing this: no file under src/ reads any of the three. The
-- only remaining mentions are comments recording that they are dead, and
-- BrandCurrency's own identically-named columns.
--
-- The DEFAULT constraint on CurrencyEnabled must go first — SQL Server refuses
-- to drop a column a constraint still references, and the constraint's name is
-- known because 124 named it rather than letting SQL Server generate one.

SET XACT_ABORT ON;
GO

IF DB_NAME() NOT LIKE 'Rocks[_]Portal[_]Form'
  THROW 50000, 'Run this against Rocks_Portal_Form only — there is no UAT twin.', 1;
GO

IF OBJECT_ID('dbo.BrandCurrency', 'U') IS NULL
  THROW 50000, 'dbo.BrandCurrency is missing — apply 127 first, or the configuration would be lost.', 1;
GO

-- Refuse if 127 has not actually carried the values across. Dropping a
-- configured currency that exists nowhere else is not a schema tidy-up, it is
-- data loss.
IF COL_LENGTH('dbo.BrandSetting', 'CurrencyCode') IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM [dbo].[BrandSetting] bs
     WHERE bs.[CurrencyCode] IS NOT NULL
       AND LTRIM(RTRIM(bs.[CurrencyCode])) <> ''
       AND NOT EXISTS (
         SELECT 1 FROM [dbo].[BrandCurrency] bc
         WHERE bc.[BrandCode] = bs.[BrandCode] AND bc.[CurrencyCode] = bs.[CurrencyCode]
       )
   )
  THROW 50000, 'A BrandSetting currency has no BrandCurrency row — re-run 127 before dropping.', 1;
GO

BEGIN TRANSACTION;

IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = 'DF_BrandSetting_CurrencyEnabled')
  ALTER TABLE [dbo].[BrandSetting] DROP CONSTRAINT [DF_BrandSetting_CurrencyEnabled];

IF COL_LENGTH('dbo.BrandSetting', 'CurrencyEnabled') IS NOT NULL
  ALTER TABLE [dbo].[BrandSetting] DROP COLUMN [CurrencyEnabled];

IF COL_LENGTH('dbo.BrandSetting', 'CurrencyCode') IS NOT NULL
  ALTER TABLE [dbo].[BrandSetting] DROP COLUMN [CurrencyCode];

IF COL_LENGTH('dbo.BrandSetting', 'CountryCode') IS NOT NULL
  ALTER TABLE [dbo].[BrandSetting] DROP COLUMN [CountryCode];

COMMIT TRANSACTION;
GO

-- Post-apply: all three gone, and BrandSetting still holds its six rows with
-- their logos and enable flags.
SELECT
  COL_LENGTH('dbo.BrandSetting','CountryCode')     AS CountryCode_ShouldBeNull,
  COL_LENGTH('dbo.BrandSetting','CurrencyCode')    AS CurrencyCode_ShouldBeNull,
  COL_LENGTH('dbo.BrandSetting','CurrencyEnabled') AS CurrencyEnabled_ShouldBeNull;
GO
SELECT COUNT(*) AS BrandSettingRows FROM [dbo].[BrandSetting];
GO
