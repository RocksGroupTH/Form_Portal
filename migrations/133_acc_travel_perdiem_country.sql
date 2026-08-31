-- A per-diem rate per country, effective-dated.
--
-- TARGET: Rocks_Portal_Form AND Rocks_Portal_Form_UAT — both, symmetrically.
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/133_acc_travel_perdiem_country.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/133_acc_travel_perdiem_country.sql
--
-- NUMBERED 133. Read `ls migrations/` before picking a number: 131 was the
-- highest before this branch, 132 is the worldwide-places spec's
-- TravelProvince.CountryCode, and eleven numbers (088, 089, 090, 091, 094, 103,
-- 117, 118, 119, 120, 124) are each used twice — so counting files is not a
-- substitute for looking.
--
-- Design: docs/superpowers/specs/2026-08-31-ap17-country-and-perdiem-design.md
--
-- ---------------------------------------------------------------------------
-- APPLY BEFORE THE CODE REACHES EITHER DATABASE.
--
-- SQL Server binds object names at compile time, so a table missing from one
-- side is 'Invalid object name', not an empty result. This one is read on
-- AP-17's submit path and inside the transaction that cancels or rejects a
-- trip, so the failure would land mid-write rather than on a list page.
--
-- ---------------------------------------------------------------------------
-- SHARED MASTER TABLE.
--
-- Dual-written by src/lib/acc/travel-booking/perdiem-source.ts through
-- writeBothPools, and asserted by `npm run check:alignment` — which gains one
-- entry: 26 tables if this lands before the approver brand-visibility spec's
-- AccBookingApproverBrand, 27 if after. Read the current count in
-- scripts/checks/verify-master-alignment.ts rather than copying a number.
--
-- It carries NO identity floor and is deliberately ABSENT from migrations 061
-- and 064. Dual-write runs the same statement against both databases and reads
-- no id back, so the two identity counters must stay in lockstep; a
-- CHECK (Id >= 900000) in the UAT twin would reject every row the production
-- side allocated a low id for — which is every row.
--
-- ---------------------------------------------------------------------------
-- AMOUNT IS THAI BAHT PER DAY.
--
-- EmployeeAllowanceLog, the source this falls back to, has no currency column,
-- and AP-17's per diem is baht in every consumer — the stored PerDiemTotal, the
-- request's TotalAmount, the report and the accounting sign-off. A
-- foreign-currency rate would put an FX lookup on the submit path, so a rate
-- provider being down would stop people submitting travel requests.
--
-- Amount > 0 IS LOAD-BEARING, not hygiene. rateForDay returns 0 for a day it
-- cannot match (perdiem.ts:24-33), so a stored 0 would be indistinguishable
-- from "no rate configured" — it would pay nothing while looking configured.
--
-- There is deliberately NO CHECK on CountryCode, and 'TH' is refused in code
-- rather than here. The table is writable from more than one place, so
-- enforcement has to live in code regardless, and reversing that decision must
-- not require a migration applied to two databases.

SET XACT_ABORT ON;
GO

IF DB_NAME() NOT LIKE 'Rocks[_]Portal[_]Form%'
  THROW 50000, 'Run this against Rocks_Portal_Form or Rocks_Portal_Form_UAT only.', 1;
GO

IF OBJECT_ID('dbo.AccRequest', 'U') IS NULL
  THROW 50000, 'dbo.AccRequest is missing — apply 059 first.', 1;
GO

IF OBJECT_ID('dbo.AccTravelPerDiemCountry', 'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[AccTravelPerDiemCountry] (
    [Id]            INT IDENTITY(1,1) NOT NULL
                    CONSTRAINT [PK_AccTravelPerDiemCountry] PRIMARY KEY,
    [CountryCode]   CHAR(2)       NOT NULL,   -- ISO-3166-1 alpha-2, matches AccRequest.CountryCode
    [EffectiveDate] DATE          NOT NULL,   -- from this day inclusive
    [Amount]        DECIMAL(18,2) NOT NULL
                    CONSTRAINT [CK_AccTravelPerDiemCountry_Amount] CHECK ([Amount] > 0),
    [Note]          NVARCHAR(300) NULL,
    [IsActive]      BIT NOT NULL
                    CONSTRAINT [DF_AccTravelPerDiemCountry_Active] DEFAULT (1),
    [CreatedBy]     INT NULL,
    [CreatedAt]     DATETIME2(7) NOT NULL
                    CONSTRAINT [DF_AccTravelPerDiemCountry_Created] DEFAULT (SYSDATETIME()),
    [UpdatedBy]     INT NULL,
    [UpdatedAt]     DATETIME2(7) NOT NULL
                    CONSTRAINT [DF_AccTravelPerDiemCountry_Updated] DEFAULT (SYSDATETIME())
  );
  PRINT 'AccTravelPerDiemCountry created.';
END
ELSE
  PRINT 'AccTravelPerDiemCountry already exists -- nothing to do.';
GO

-- Scoped to the object, not database-wide: an index name is unique only within
-- its own table, so the unscoped form can be satisfied by a same-named index on
-- a different table and skip creating this one without saying so (120's note).
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UX_AccTravelPerDiemCountry'
    AND object_id = OBJECT_ID('dbo.AccTravelPerDiemCountry')
)
  CREATE UNIQUE INDEX [UX_AccTravelPerDiemCountry]
    ON [dbo].[AccTravelPerDiemCountry] ([CountryCode], [EffectiveDate]);
GO

-- Post-apply, on BOTH databases: 0 rows, identity unallocated, and the same
-- answer on each side.
--
-- NO SEED. The feature arrives switched off: with no rows, perDiemCountryLog
-- answers null for every country and every trip computes exactly what it
-- computed before. That is the property to check on deploy day.
SELECT DB_NAME() AS db,
       COUNT(*) AS [Rows],
       IDENT_CURRENT('dbo.AccTravelPerDiemCountry') AS IdentCurrent
FROM dbo.AccTravelPerDiemCountry;
GO
