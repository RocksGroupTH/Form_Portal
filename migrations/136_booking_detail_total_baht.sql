-- The baht equivalent of a booking row's total, stored rather than re-derived.
--
-- Apply to BOTH form databases, before the code:
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/136_booking_detail_total_baht.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/136_booking_detail_total_baht.sql
--
-- NUMBERED 136. Read `ls migrations/` before picking a number rather than
-- counting files: eleven earlier numbers (088, 089, 090, 091, 094, 103, 117,
-- 118, 119, 120, 124) each exist twice, from parallel branches.
--
-- ---------------------------------------------------------------------------
-- WHY A STORED COLUMN, WHEN BOTH FACTORS ARE ALREADY STORED
--
-- `AccTravelBookingDetail`'s four figures are written in the request's own
-- currency, unconverted, and `AccRequest.Currency` / `.ExchangeRate` say which
-- and at what rate. Every baht figure on every AP-17 screen was therefore a
-- multiplication done at render — three of them, in `AdminBookingPanel`,
-- `TravelBookingDetail` and `report-service`.
--
-- This is the shape AP-1 already has and AP-17 did not. Migration 129 states it
-- for the expense line in capitals: `AccTravelExpenseItem.Amount` IS THAI BAHT,
-- ALWAYS, with `ForeignAmount` holding the figure as it was typed. AP-17 chose
-- the opposite orientation, so it gains the baht column instead of the foreign
-- one, and ends up carrying both figures exactly as AP-1 does.
--
-- The property that makes this worth a column is that it removes a branch
-- rather than adding one. `TotalAmountBaht` is written for EVERY row, baht rows
-- included, where it simply equals `TotalAmount`. A reader therefore never asks
-- what currency a row is in before summing it, and DOUBLE CONVERSION — the one
-- defect this shape can produce — stops being expressible at all rather than
-- being a rule three call sites have to keep.
--
-- ---------------------------------------------------------------------------
-- IT CAN GO STALE, AND TWO WRITERS ARE WHY
--
-- A derived value is only safe while everything that can move its inputs moves
-- it too. `AccRequest.ExchangeRate` has TWO writers, not one:
--
--   1. `saveBookingDetail` (travel-booking/admin-service.ts), on every row save
--   2. `applyRateOverride` (acc/rate-override.ts), when accounting corrects the
--      rate at sign-off — shared with AP-1 and pinned only by FormCode
--
-- Both now recompute every booking row of the request inside the same
-- transaction as their rate write. Not just the row being saved: one rate is
-- recorded per request, so rows saved on different days all convert at whatever
-- rate landed last, and rewriting one row alone would leave the others quoting a
-- rate the header no longer holds. A third writer of `ExchangeRate` added later
-- must do the same, or this column silently starts lying.
--
-- ---------------------------------------------------------------------------
-- THE BACKFILL IS EXACT, NOT AN ESTIMATE
--
-- Measured 2026-09-02 across both databases: ZERO AP-17 requests carry a
-- non-baht `Currency` — every one of them is NULL — and the whole estate holds
-- one `AccTravelBookingDetail` row. So for every row that exists, the baht
-- figure IS `TotalAmount`, with no rate applied and none needed.
--
-- That is why this backfills where the usual answer is not to. Writing a
-- converted figure from today's rate would claim a conversion nobody performed;
-- writing a baht figure for a row that was always baht claims nothing. Batch 3
-- proves the precondition rather than trusting this paragraph, and raises if any
-- foreign request exists — in which case the backfill is not exact and must not
-- run.
--
-- Nullable even so. A row whose header has no rate yet has no baht figure, and
-- NULL says that where 0 would claim the booking was free.

SET XACT_ABORT ON;
GO

IF DB_NAME() NOT LIKE 'Rocks[_]Portal[_]Form%'
  THROW 50000, 'Run this against Rocks_Portal_Form or Rocks_Portal_Form_UAT only.', 1;
GO

IF OBJECT_ID('dbo.AccTravelBookingDetail', 'U') IS NULL
  THROW 50000, 'dbo.AccTravelBookingDetail is missing -- apply 059 first.', 1;
GO

IF COL_LENGTH('dbo.AccTravelBookingDetail', 'TotalAmount') IS NULL
  THROW 50000, 'dbo.AccTravelBookingDetail has no TotalAmount -- apply 123 first.', 1;
GO

IF COL_LENGTH('dbo.AccTravelBookingDetail', 'TotalAmountBaht') IS NULL
BEGIN
  ALTER TABLE [dbo].[AccTravelBookingDetail] ADD [TotalAmountBaht] DECIMAL(18,2) NULL;
  PRINT 'TotalAmountBaht added.';
END
ELSE
  PRINT 'TotalAmountBaht already present -- skipped.';
GO

-- Backfill, guarded. Refuses rather than guessing if the precondition the
-- header states has stopped holding since it was measured.
DECLARE @foreign INT =
  (SELECT COUNT(*) FROM [dbo].[AccRequest]
    WHERE FormCode = 'AP-17' AND Currency IS NOT NULL AND Currency <> 'THB');

IF @foreign > 0
  THROW 50000, 'An AP-17 request carries a foreign currency -- the baht backfill is no longer exact. Recompute those rows from AccRequest.ExchangeRate by hand, then re-run.', 1;

UPDATE bd
   SET bd.[TotalAmountBaht] = bd.[TotalAmount]
  FROM [dbo].[AccTravelBookingDetail] bd
 WHERE bd.[TotalAmount] IS NOT NULL
   AND bd.[TotalAmountBaht] IS NULL;

PRINT CONCAT('Backfilled ', @@ROWCOUNT, ' baht-only row(s).');
GO

-- Post-apply, on BOTH databases: the column exists, and no row has a total
-- without a baht figure beside it.
SELECT DB_NAME() AS db,
       COL_LENGTH('dbo.AccTravelBookingDetail','TotalAmountBaht') AS BahtLen,
       (SELECT COUNT(*) FROM dbo.AccTravelBookingDetail) AS [Rows],
       (SELECT COUNT(*) FROM dbo.AccTravelBookingDetail
         WHERE TotalAmount IS NOT NULL AND TotalAmountBaht IS NULL) AS Unconverted;
GO
