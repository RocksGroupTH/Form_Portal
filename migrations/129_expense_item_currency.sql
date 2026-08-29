-- A currency per expense LINE, and a country per request.
--
-- Apply to BOTH form databases, before the code deploy:
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/129_expense_item_currency.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/129_expense_item_currency.sql
--
-- NUMBERED 129. Read the highest number on *master* before picking one.
--
-- ---------------------------------------------------------------------------
-- WHAT CHANGED, AND WHY IT IS SMALLER THAN IT LOOKS
--
-- 125 put one currency on AccRequest, on the design that a claim is filed in one
-- currency. It is not: one Grab section can hold a 20 MYR ride and a 20 THB ride,
-- and both belong on the same claim. The currency moves to the line.
--
-- The trick that keeps this small is the same one that made the request-level
-- design safe, applied one level down:
--
--   AccTravelExpenseItem.Amount IS THAI BAHT, ALWAYS.
--
-- ForeignAmount holds the figure as it was typed and Currency/ExchangeRate say
-- what it was and how it was converted. Because `Amount` never stops being baht,
-- EVERY existing summer keeps working untouched — calc.ts's sum(), the T-SQL
-- SUM(i.Amount) in TRAVEL_DAYS_CSV_SELECT that feeds the ERP prep queue, the
-- journal builder, the approval queue's per-vehicle cell. Not one of them has to
-- learn about currency. A design where Amount held the foreign figure would have
-- required all four to change, on the path that posts money.
--
-- The country goes on the REQUEST, not the line: a trip is to one country, and
-- it is what decides which currencies the line dropdown may offer. Thailand is
-- the default and shows no dropdown at all — a Thai claim looks exactly as it
-- always has.
--
-- 125's AccRequest.Currency / ExchangeRate / ForeignAmount are NOT dropped here,
-- and a later migration can drop LESS of them than this header first claimed.
--
-- Corrected 2026-08-29 after the code landed: AP-17 writes AccRequest.Currency
-- and .ExchangeRate itself (travel-booking/admin-service.ts:535) — its booking
-- desk records one currency for the whole booking, which is right for it. Those
-- two columns are therefore live, not dead, and must NOT be dropped.
--
-- Only AccRequest.ForeignAmount becomes unwritten once AP-1 moved to per-line,
-- and applyRateOverride still reads it for legacy rows. So the follow-up is
-- narrower than "drop 125's three columns", and is better left until the rate
-- override is rebuilt per line.
--
-- NULL Currency and 'THB' both mean baht. No backfill: every existing line was
-- baht and reads NULL, which is the truth — nobody recorded a currency for it.

SET XACT_ABORT ON;
GO

IF DB_NAME() NOT LIKE 'Rocks[_]Portal[_]Form%'
  THROW 50000, 'Run this against Rocks_Portal_Form or Rocks_Portal_Form_UAT only.', 1;
GO

IF OBJECT_ID('dbo.AccTravelExpenseItem', 'U') IS NULL OR OBJECT_ID('dbo.AccRequest', 'U') IS NULL
  THROW 50000, 'AccTravelExpenseItem or AccRequest is missing — apply 059 first.', 1;
GO

BEGIN TRANSACTION;

-- The line's own money. Amount stays as it is: baht.
IF COL_LENGTH('dbo.AccTravelExpenseItem', 'Currency') IS NULL
  ALTER TABLE [dbo].[AccTravelExpenseItem] ADD [Currency] CHAR(3) NULL;

IF COL_LENGTH('dbo.AccTravelExpenseItem', 'ExchangeRate') IS NULL
  ALTER TABLE [dbo].[AccTravelExpenseItem] ADD [ExchangeRate] DECIMAL(18,6) NULL;

IF COL_LENGTH('dbo.AccTravelExpenseItem', 'ForeignAmount') IS NULL
  ALTER TABLE [dbo].[AccTravelExpenseItem] ADD [ForeignAmount] DECIMAL(18,2) NULL;

-- The trip's country, which decides what the line dropdown may offer.
IF COL_LENGTH('dbo.AccRequest', 'CountryCode') IS NULL
  ALTER TABLE [dbo].[AccRequest] ADD [CountryCode] CHAR(2) NULL;

COMMIT TRANSACTION;
GO

-- Post-apply: four non-NULL lengths, and no existing line given a currency.
SELECT
  COL_LENGTH('dbo.AccTravelExpenseItem','Currency')      AS ItemCurrency,
  COL_LENGTH('dbo.AccTravelExpenseItem','ExchangeRate')  AS ItemRate,
  COL_LENGTH('dbo.AccTravelExpenseItem','ForeignAmount') AS ItemForeign,
  COL_LENGTH('dbo.AccRequest','CountryCode')             AS RequestCountry;
GO
SELECT COUNT(*) AS LinesWithACurrency FROM dbo.AccTravelExpenseItem WHERE Currency IS NOT NULL;
GO
