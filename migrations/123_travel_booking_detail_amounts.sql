-- AP-17 booking rows carry a full price breakdown, not just a price.
--
-- Apply to BOTH form databases, before the code deploy:
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/123_travel_booking_detail_amounts.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/123_travel_booking_detail_amounts.sql
--
-- NUMBERED 123. Read the highest number on *master* before picking one and
-- re-read it before merging.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS ADDS. AccTravelBookingDetail held BookingNo and PriceExVat, so a
-- booking recorded a number and one figure. A hotel or ticket invoice states
-- five: the number, the price before VAT, the VAT, any discount, and the total
-- actually charged. Accounting signs off against that invoice, so the row has
-- to hold what the invoice says.
--
-- ONE TABLE COVERS ALL THREE BOOKING KINDS. AccTravelBookingDetail discriminates
-- room / ticket / vehicle rental with BookingType, so these three columns give
-- every kind the same shape at once -- which is what was asked for, and is why
-- no per-kind table was needed.
--
-- WHY TotalAmount IS STORED AND NOT DERIVED. PriceExVat + VatAmount -
-- DiscountAmount does not always equal what was charged: rounding, service
-- charges and how a supplier applies a discount all move it. The invoice's own
-- total is a fact about the transaction; the arithmetic is a check on it. The
-- form computes the arithmetic as a suggestion and flags a mismatch, but what
-- is stored is what the person entering it saw on the paper.
--
-- NULLABLE, NO DEFAULT, NO BACKFILL. Every existing row keeps its BookingNo and
-- PriceExVat untouched and reads NULL for the three new columns -- which is
-- honest: nobody recorded those figures at the time, and writing 0 would claim
-- a booking had no VAT rather than that its VAT is unknown.
--
-- BOTH FORM DATABASES. AccTravelBookingDetail is transactional, not shared
-- configuration -- it is not in MASTER_TABLES and not dual-written, so
-- check:alignment says nothing about it. It still needs the column on both
-- sides: SQL Server binds object names at compile time, so a query naming
-- VatAmount fails outright against whichever database is missing it, and AP-17
-- resolves either one depending on who is asking.

SET XACT_ABORT ON;
GO

IF DB_NAME() NOT LIKE 'Rocks[_]Portal[_]Form%'
  THROW 50000, 'Run this against Rocks_Portal_Form or Rocks_Portal_Form_UAT only.', 1;
GO

IF OBJECT_ID('dbo.AccTravelBookingDetail', 'U') IS NULL
  THROW 50000, 'dbo.AccTravelBookingDetail is missing -- apply 059 (or 048) first.', 1;
GO

BEGIN TRANSACTION;

IF COL_LENGTH('dbo.AccTravelBookingDetail', 'VatAmount') IS NULL
  ALTER TABLE [dbo].[AccTravelBookingDetail] ADD [VatAmount] decimal(18, 2) NULL;

IF COL_LENGTH('dbo.AccTravelBookingDetail', 'DiscountAmount') IS NULL
  ALTER TABLE [dbo].[AccTravelBookingDetail] ADD [DiscountAmount] decimal(18, 2) NULL;

IF COL_LENGTH('dbo.AccTravelBookingDetail', 'TotalAmount') IS NULL
  ALTER TABLE [dbo].[AccTravelBookingDetail] ADD [TotalAmount] decimal(18, 2) NULL;

COMMIT TRANSACTION;
GO

-- Post-apply check: all three report a non-NULL length on both databases.
SELECT
  COL_LENGTH('dbo.AccTravelBookingDetail', 'VatAmount')      AS VatAmount,
  COL_LENGTH('dbo.AccTravelBookingDetail', 'DiscountAmount') AS DiscountAmount,
  COL_LENGTH('dbo.AccTravelBookingDetail', 'TotalAmount')    AS TotalAmount;
GO
