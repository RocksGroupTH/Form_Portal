-- One of a brand's currencies is its DEFAULT — the country AP-1's form opens on.
--
-- Apply with (PRODUCTION form database ONLY — BrandCurrency has no UAT twin, for
-- the same reason BrandSetting has none; migration 127 records it):
--   npm run apply-sql -- --db Rocks_Portal_Form --file migrations/131_brand_currency_default.sql
--
-- NUMBERED 131. Read the highest number on *master* before picking one; 130 was.
--
-- ---------------------------------------------------------------------------
-- WHY
--
-- Until now Thailand was the default country of every AP-1 claim by
-- construction: `claimCountryOptions` put "TH" first, unconditionally, and no
-- brand could switch baht off because THB was never a row — it was implicit.
--
-- A brand may now say it does not claim in baht, by carrying a `THB` row with
-- IsEnabled = 0. The moment that is possible, "Thailand is the default" stops
-- being an answer, and something has to say where the picker starts instead.
--
-- The shape chosen is **one row is the default**, not "a country column on the
-- brand" and not a special case for Thailand. A special case rots: the next
-- person adds a second one beside it. A row already carries a country and a
-- currency and an enable flag, and the default is a property of exactly that —
-- which of these may a claim start in.
--
-- ---------------------------------------------------------------------------
-- WHY THE UNIQUENESS RULE IS AN INDEX AND NOT A HANDLER CHECK
--
-- The same argument migration 127 makes for UQ_BrandCurrency_Brand_Currency.
-- Two admins on two tabs — and there are two tabs, AP-1's and AP-17's, editing
-- the same rows — defeat any read-then-write check, and one replayed request
-- defeats it alone. A filtered unique index cannot be defeated: at most one row
-- per BrandCode may carry IsDefault = 1, and a second one is error 2601, which
-- `isUniqueViolation` in brand-registry.ts already translates.
--
-- The service still clears the old default inside the same transaction that
-- sets the new one. The index is not a substitute for that — it is what makes
-- the transaction's correctness checkable rather than assumed.
--
-- ---------------------------------------------------------------------------
-- NOTHING IS BACKFILLED, DELIBERATELY
--
-- Every existing row stays IsDefault = 0, which is exactly today's behaviour:
-- with nothing marked, `defaultClaimCountry` answers Thailand while Thailand is
-- still offered — and it is offered for every brand configured before this
-- migration, because none of them carries a disabled THB row. So this migration
-- changes no form, no picker and no claim. Marking a default is only *required*
-- once somebody switches Thailand off, and the settings editor is what does it.
--
-- Measured before writing this: 0 rows in dbo.BrandCurrency name THB at all.

SET XACT_ABORT ON;
GO

IF DB_NAME() NOT LIKE 'Rocks[_]Portal[_]Form'
  THROW 50000, 'Run this against Rocks_Portal_Form only — there is no UAT twin.', 1;
GO

IF OBJECT_ID('dbo.BrandCurrency', 'U') IS NULL
  THROW 50000, 'dbo.BrandCurrency is missing — apply 127 first.', 1;
GO

IF COL_LENGTH('dbo.BrandCurrency', 'IsDefault') IS NULL
  ALTER TABLE [dbo].[BrandCurrency]
    ADD [IsDefault] bit NOT NULL
      CONSTRAINT [DF_BrandCurrency_IsDefault] DEFAULT (0);
GO

-- Refuse to build the index over data that already breaks it. A brand holding
-- two defaults can only come from a direct SQL edit, and silently picking one
-- of them is not this migration's decision to make.
IF EXISTS (
  SELECT 1 FROM [dbo].[BrandCurrency]
  WHERE [IsDefault] = 1
  GROUP BY [BrandCode]
  HAVING COUNT(*) > 1
)
  THROW 50000, 'A brand already carries more than one default currency — resolve it by hand before applying 131.', 1;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'UQ_BrandCurrency_Brand_Default'
                 AND object_id = OBJECT_ID('dbo.BrandCurrency'))
  CREATE UNIQUE INDEX [UQ_BrandCurrency_Brand_Default]
    ON [dbo].[BrandCurrency] ([BrandCode])
    WHERE [IsDefault] = 1;
GO

-- Post-apply: the column exists, the filtered unique index exists, and nothing
-- is marked yet (every brand still opens on Thailand).
SELECT COL_LENGTH('dbo.BrandCurrency', 'IsDefault') AS IsDefault_ShouldNotBeNull;
GO
SELECT name AS FilteredUniqueIndex, has_filter, filter_definition
FROM sys.indexes
WHERE object_id = OBJECT_ID('dbo.BrandCurrency') AND name = 'UQ_BrandCurrency_Brand_Default';
GO
SELECT COUNT(*) AS DefaultRows_ExpectZero FROM [dbo].[BrandCurrency] WHERE [IsDefault] = 1;
GO
