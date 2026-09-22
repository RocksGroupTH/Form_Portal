-- 154_travel_option_requires_id_card.sql
-- Target: Rocks_Portal_Form AND Rocks_Portal_Form_UAT — apply to BOTH, before the code.
-- NUMBERED 154, NOT 153. `ls migrations/` on this branch stops at 152, but
-- 153_acc_report_access.sql exists on the unmerged feat/all-requests-report
-- branch. CLAUDE.md already records eleven duplicated numbers (088, 089, 090,
-- 091, 094, 103, 117, 118, 119, 120, 124) precisely because a number alone
-- does not name a file — checked `git ls-tree -r --name-only
-- feat/all-requests-report -- migrations/` and every local/remote branch
-- before picking this one; 154 is free everywhere.
--
-- Design: docs/superpowers/specs/2026-09-21-ap17-c-id-card-when-configured.md
-- §2. AP-17's national-ID/Passport upload is currently asked for on every
-- booking, unconditionally. Which bookings actually need identification is a
-- supplier fact ("does this hotel/bus operator ask for one"), not an
-- application fact, so it becomes a per-option setting rather than a
-- hardcoded list of booking types.
--
-- Adds RequiresIdCard BIT NOT NULL DEFAULT 0 to the three option tables a
-- requester picks from:
--   AccTravelAccommodation  ที่พัก
--   AccTravelVehicleOption  พาหนะ
--   AccTravelRentVehicle    รถเช่า
--
-- ---------------------------------------------------------------------------
-- BOTH DATABASES, BEFORE THE CODE.
--
-- All three tables are dual-written and listed in MASTER_TABLES
-- (scripts/checks/verify-master-alignment.ts:77-79), with ids identical on
-- both sides. SQL Server binds column names at COMPILE time, so
-- RequiresIdCard missing from EITHER database is
--   Msg 207, Level 16 — Invalid column name 'RequiresIdCard'.
-- for whoever resolves that side — never a silent NULL — on the AP-17 form and
-- settings paths that read or write it. Same hazard migrations 090, 120, 144
-- and 149 already carry, though note those are TABLE migrations: a missing
-- table is Msg 208, "Invalid object name", which is a different string to grep
-- for. 149 is a column migration and says the table one; it is wrong about the
-- string only, and is left alone rather than rewritten from here.
--
-- npm run check:alignment MUST STILL READ 30 TABLES afterwards. This adds a
-- column to three tables already on the list — it does not add a table. 31
-- means the wrong thing was created. The checker also compares every
-- non-datetime column, so applying this to only one database reds the check
-- on these three tables too — that is the check working as intended, not a
-- fault to silence.
--
-- upsertVehicle (src/lib/acc/travel-booking/settings-service.ts) is the one
-- place in src/ that uses SET IDENTITY_INSERT, replaying production's
-- AccTravelVehicleOption.Id into UAT so AccTravelVehiclePlace's FK resolves.
-- Both of that function's passes must carry RequiresIdCard once Task 3 wires
-- it up, or the two databases would agree on the id and disagree on the flag
-- — this migration only adds the column; it is not what makes the two writes
-- carry it. That is Task 3's job, tracked separately.
--
-- ---------------------------------------------------------------------------
-- THE DEFAULT IS 0, AND THAT IS A CONTROL SWITCHED OFF ON DEPLOY DAY.
--
-- This is not the safe-by-construction direction and it is not softened here:
-- ON THE DAY THIS MIGRATION'S CODE DEPLOYS, NO AP-17 REQUEST ASKS FOR AN ID
-- CARD AT ALL — HOTEL BOOKINGS INCLUDED — UNTIL AN ADMIN GOES AND TICKS THE
-- OPTIONS AT SETTINGS. The strongest control this form has ever had is off by
-- default, and nobody has issued an instruction to turn it off for any
-- particular booking; it is simply the state every row is in the moment this
-- column exists, because there was no data to seed it from.
--
-- The user chose this explicitly on 2026-09-21 — "ไม่ติ๊กทั้งหมด — ค่อยไปติ๊ก
-- ทีหลัง" ("don't tick any of them — go and tick them later"). A DEFAULT OF 1
-- WAS CONSIDERED AND REJECTED. Do not "fix" this back to 1 on the reasoning
-- that it looks safer; that is the exact change the user declined. Two things
-- outside this migration exist so the off state is visible rather than
-- silent: a commissioning banner on the settings page when no option in any
-- of the three tables has RequiresIdCard = 1, and a deployment-checklist line
-- to tick the options immediately after applying, not eventually. Both are
-- later tasks in this same plan.
--
-- ---------------------------------------------------------------------------
-- Idempotent: guarded on sys.columns, so a re-run on either database is a
-- no-op rather than an error.

SET XACT_ABORT ON;
GO

IF DB_NAME() NOT LIKE 'Rocks[_]Portal[_]Form%'
  THROW 50000, 'Run this against Rocks_Portal_Form or Rocks_Portal_Form_UAT only.', 1;
GO

IF OBJECT_ID('dbo.AccTravelAccommodation', 'U') IS NULL
  THROW 50000, 'dbo.AccTravelAccommodation is missing — apply 048/059 first.', 1;
GO
IF OBJECT_ID('dbo.AccTravelVehicleOption', 'U') IS NULL
  THROW 50000, 'dbo.AccTravelVehicleOption is missing — apply 048/059 first.', 1;
GO
IF OBJECT_ID('dbo.AccTravelRentVehicle', 'U') IS NULL
  THROW 50000, 'dbo.AccTravelRentVehicle is missing — apply 048/059 first.', 1;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.AccTravelAccommodation') AND name = 'RequiresIdCard'
)
BEGIN
  ALTER TABLE [dbo].[AccTravelAccommodation]
    ADD [RequiresIdCard] BIT NOT NULL
    CONSTRAINT [DF_AccTravelAccommodation_RequiresIdCard] DEFAULT (0);
  PRINT 'Added AccTravelAccommodation.RequiresIdCard';
END
ELSE PRINT 'AccTravelAccommodation.RequiresIdCard already present - skipped';
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.AccTravelVehicleOption') AND name = 'RequiresIdCard'
)
BEGIN
  ALTER TABLE [dbo].[AccTravelVehicleOption]
    ADD [RequiresIdCard] BIT NOT NULL
    CONSTRAINT [DF_AccTravelVehicleOption_RequiresIdCard] DEFAULT (0);
  PRINT 'Added AccTravelVehicleOption.RequiresIdCard';
END
ELSE PRINT 'AccTravelVehicleOption.RequiresIdCard already present - skipped';
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.AccTravelRentVehicle') AND name = 'RequiresIdCard'
)
BEGIN
  ALTER TABLE [dbo].[AccTravelRentVehicle]
    ADD [RequiresIdCard] BIT NOT NULL
    CONSTRAINT [DF_AccTravelRentVehicle_RequiresIdCard] DEFAULT (0);
  PRINT 'Added AccTravelRentVehicle.RequiresIdCard';
END
ELSE PRINT 'AccTravelRentVehicle.RequiresIdCard already present - skipped';
GO

-- Post-apply, on BOTH databases: every row reads RequiresIdCard = 0.
SELECT DB_NAME() AS db, 'AccTravelAccommodation' AS [Table],
       COUNT(*) AS [Rows], SUM(CASE WHEN [RequiresIdCard] = 1 THEN 1 ELSE 0 END) AS [RequiresIdCardCount]
FROM [dbo].[AccTravelAccommodation]
UNION ALL
SELECT DB_NAME(), 'AccTravelVehicleOption',
       COUNT(*), SUM(CASE WHEN [RequiresIdCard] = 1 THEN 1 ELSE 0 END)
FROM [dbo].[AccTravelVehicleOption]
UNION ALL
SELECT DB_NAME(), 'AccTravelRentVehicle',
       COUNT(*), SUM(CASE WHEN [RequiresIdCard] = 1 THEN 1 ELSE 0 END)
FROM [dbo].[AccTravelRentVehicle];
GO
