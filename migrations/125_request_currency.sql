-- One currency per request, on the shared request header.
--
-- Apply to BOTH form databases, before the code deploy:
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/125_request_currency.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/125_request_currency.sql
--
-- NUMBERED 125. Read the highest number on *master* before picking one.
--
-- ---------------------------------------------------------------------------
-- BOTH SIDES. AccRequest is transactional — neither dual-written nor in
-- MASTER_TABLES, so `npm run check:alignment` is unaffected and its table count
-- must NOT move (a changed count means the wrong table was altered). But SQL
-- Server binds object names at compile time, so a query naming Currency fails
-- outright against whichever database is missing it, and both forms resolve
-- either database depending on who is asking.
--
-- WHY THE HEADER AND NOT AccTravelExpense
--
-- The design is one currency per REQUEST. AccRequest is one row per request by
-- definition and already holds TotalAmount. AccTravelExpense is not: it carries
-- UQ_AccTravel_Request_Date (verified in the live database) and saveDraft
-- deletes and re-inserts one row per travel DAY. Three columns there would be N
-- copies per claim, with no rule about which is authoritative and nothing
-- keeping them equal — and every write would also need bindTravel,
-- TRAVEL_COLUMNS, TRAVEL_VALUES and TRAVEL_SET extended in step.
--
-- AP-2 and AP-3 keep their own Currency/ExchangeRate/BaseAmount on AccAdvance
-- and AccClearAdvance and are untouched by this. The columns added here are
-- nullable and unread by those forms.
--
-- NULL Currency and 'THB' both mean baht. No backfill: an existing row reads
-- NULL, which is correct — nobody recorded a currency, and writing 'THB' would
-- claim somebody had.
--
-- TotalAmount KEEPS ITS MEANING and stays Thai baht for every form. BaseAmount
-- holds the figure as it was entered, before conversion; TotalAmount holds what
-- the company pays. Nothing downstream — the report, the Excel export, the ERP
-- journal — needs to change, because none of them stops reading a baht column.

SET XACT_ABORT ON;
GO

IF DB_NAME() NOT LIKE 'Rocks[_]Portal[_]Form%'
  THROW 50000, 'Run this against Rocks_Portal_Form or Rocks_Portal_Form_UAT only.', 1;
GO

IF OBJECT_ID('dbo.AccRequest', 'U') IS NULL
  THROW 50000, 'dbo.AccRequest is missing — apply 059 first.', 1;
GO

BEGIN TRANSACTION;

IF COL_LENGTH('dbo.AccRequest', 'Currency') IS NULL
  ALTER TABLE [dbo].[AccRequest] ADD [Currency] CHAR(3) NULL;

IF COL_LENGTH('dbo.AccRequest', 'ExchangeRate') IS NULL
  ALTER TABLE [dbo].[AccRequest] ADD [ExchangeRate] DECIMAL(18,6) NULL;

IF COL_LENGTH('dbo.AccRequest', 'BaseAmount') IS NULL
  ALTER TABLE [dbo].[AccRequest] ADD [BaseAmount] DECIMAL(18,2) NULL;

COMMIT TRANSACTION;
GO

-- Post-apply: three non-NULL lengths, and no existing row given a currency.
SELECT
  COL_LENGTH('dbo.AccRequest','Currency')     AS Currency,
  COL_LENGTH('dbo.AccRequest','ExchangeRate') AS ExchangeRate,
  COL_LENGTH('dbo.AccRequest','BaseAmount')   AS BaseAmount;
GO
SELECT COUNT(*) AS RowsWithACurrency FROM dbo.AccRequest WHERE Currency IS NOT NULL;
GO
