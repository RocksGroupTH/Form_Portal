-- Which brands each AP-17 approver may see.
--
-- Apply with (BOTH databases, before the code):
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/134_acc_booking_approver_brand.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/134_acc_booking_approver_brand.sql
--
-- NUMBERED 134. Read `ls migrations/` rather than counting or trusting
-- CLAUDE.md: eleven numbers are already duplicated (088, 089, 090, 091, 094,
-- 103, 117, 118, 119, 120, 124). 132 is the worldwide-places spec's
-- TravelProvince.CountryCode and 133 the per-diem-by-country table, both applied
-- before this one. The rule that is not negotiable is 124's: never renumber a
-- migration that has been applied anywhere.
--
-- Design: docs/superpowers/specs/2026-08-31-ap17-brand-access-design.md
--
-- SQL Server binds object names at compile time, so a table missing from one
-- side is 'Invalid object name', not an empty result — and this one is read on
-- the paths that list and action AP-17 requests.
--
-- ---------------------------------------------------------------------------
-- NO ROWS FOR AN APPROVER MEANS EVERY BRAND.
--
-- That is the opposite of AccBookingApproverTab (096) and AccReimburseAccess
-- (120), and it is deliberate. Those hand out something new, so empty means
-- none. This NARROWS a permission the people on the roster already have:
-- measured 2026-08-31, all four active AccBookingApprover rows — identical ids
-- in both databases — see every AP-17 request today, so "empty = none" would
-- blind all four on the day this deploys. Same reading as 038's header for
-- AccApproverInterfaceBrand, and the same reading 124 encodes as DEFAULT (1).
--
-- ---------------------------------------------------------------------------
-- SHARED MASTER TABLE.
--
-- Dual-written by src/lib/acc/travel-booking/booking-approver-brands.ts and
-- asserted by `npm run check:alignment`, which gains one entry — 27 here,
-- because AccTravelPerDiemCountry (133) already took it to 26. Read the current
-- count in scripts/checks/verify-master-alignment.ts rather than copying a
-- number.
--
-- It carries NO identity floor and must NOT be added to migrations 061/064:
-- dual-write runs the same statement against both databases and reads no id
-- back, so the two identity counters must stay in lockstep, and a
-- CHECK (Id >= 900000) in the UAT twin would reject every row.
--
-- ApproverId refers to AccBookingApprover.Id with NO foreign key, following 096
-- rather than 038. A dual-written child table with an FK depends on the parent's
-- ids matching across both databases, which is the very thing lockstep is only
-- assumed to give; without the FK a drifted parent id leaves an orphan row that
-- check:alignment reports, instead of a write that fails on one side and
-- succeeds on the other.

SET XACT_ABORT ON;
GO

IF DB_NAME() NOT LIKE 'Rocks[_]Portal[_]Form%'
  THROW 50000, 'Run this against Rocks_Portal_Form or Rocks_Portal_Form_UAT only.', 1;
GO

IF OBJECT_ID('dbo.AccBookingApprover', 'U') IS NULL
  THROW 50000, 'dbo.AccBookingApprover is missing — apply 095 first.', 1;
GO

IF OBJECT_ID('dbo.AccBookingApproverBrand', 'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[AccBookingApproverBrand] (
    [Id]         INT IDENTITY(1,1) NOT NULL
                 CONSTRAINT [PK_AccBookingApproverBrand] PRIMARY KEY,
    [ApproverId] INT NOT NULL,
    -- NVARCHAR(20) to match AccFormBrand.BrandCode and AccRequest.BrandCode —
    -- the two columns this is ever compared with.
    [BrandCode]  NVARCHAR(20) NOT NULL,
    [CreatedAt]  DATETIME2(7) NOT NULL
                 CONSTRAINT [DF_AccBookingApproverBrand_Created] DEFAULT (SYSDATETIME())
  );
  PRINT 'AccBookingApproverBrand created.';
END
ELSE
  PRINT 'AccBookingApproverBrand already exists -- nothing to do.';
GO

-- Scoped to the object, not database-wide: an index name is unique only within
-- its own table, so the unscoped form can be satisfied by a same-named index
-- elsewhere and skip this one silently. Same correction 096 records.
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UX_AccBookingApproverBrand'
    AND object_id = OBJECT_ID('dbo.AccBookingApproverBrand')
)
  CREATE UNIQUE INDEX [UX_AccBookingApproverBrand]
    ON [dbo].[AccBookingApproverBrand] ([ApproverId], [BrandCode]);
GO

-- Post-apply, on BOTH databases: 0 rows and the same answer on each side. It
-- ships empty, which by the rule above means every approver keeps seeing every
-- brand until somebody narrows one.
SELECT DB_NAME() AS db,
       COUNT(*) AS [Rows],
       IDENT_CURRENT('dbo.AccBookingApproverBrand') AS IdentCurrent
FROM dbo.AccBookingApproverBrand;
GO
