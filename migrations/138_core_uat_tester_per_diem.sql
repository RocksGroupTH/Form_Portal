-- SUPERSEDED BY MIGRATIONS 139 AND 140 (2026-09-07). Do not re-run.
--
-- This file created UatTesterPerDiem in Fast_Core, beside UatTester and
-- FormEnvironment, and its header below explains why: what a tester is paid
-- must not depend on which form database answered. UatTesterPerDiem alone has
-- since moved, into Rocks_Portal_Form_UAT: every one of its readers is already
-- inside UAT before it reads, which is not true of UatTester or FormEnvironment
-- (both stay in Fast_Core, unmoved). It gets NO synonym in Fast_Core: measured
-- 2026-09-07, no application other than this one names UatTesterPerDiem
-- anywhere. See docs/superpowers/specs/2026-09-07-uat-tester-move-design.md,
-- especially §2 and §12 for why only this one table moves.

-- A per-diem rate per UAT tester, effective-dated.
--
-- TARGET: Fast_Core — one copy, and only this database.
--   npm run apply-sql -- --db Fast_Core --file migrations/138_core_uat_tester_per_diem.sql
--
-- NUMBERED 138. Read `ls migrations/` before picking a number: 137 was the
-- highest before this branch, and eleven numbers (088, 089, 090, 091, 094, 103,
-- 117, 118, 119, 120, 124) are each used twice — so counting files is not a
-- substitute for looking.
--
-- Design: docs/superpowers/specs/2026-09-07-ap17-uat-per-diem-design.md
--
-- ---------------------------------------------------------------------------
-- WHY Fast_Core, beside UatTester and FormEnvironment.
--
-- What a UAT tester is paid must not depend on which form database answered.
-- getCorePool() is the one pool the environment resolver never picks, which is
-- the same reason UatTester and FormEnvironment live here. Do NOT apply this to
-- Rocks_Portal_Form or Rocks_Portal_Form_UAT: there is exactly one copy, it is
-- not dual-written, and it is not in MASTER_TABLES — `npm run check:alignment`
-- must stay at 27 tables after this lands.
--
-- ---------------------------------------------------------------------------
-- APPLY BEFORE THE CODE.
--
-- SQL Server binds object names at compile time, so a missing table is
-- 'Invalid object name', not an empty result. The read is reached only in UAT,
-- so an unapplied migration errors UAT AP-17 loudly rather than silently
-- pricing a tester at their real HR allowance — which is the outcome this whole
-- feature exists to prevent, and why the read is deliberately NOT degraded to
-- "no override".
--
-- ---------------------------------------------------------------------------
-- CK_UatTesterPerDiem_Amount IS NOT HYGIENE.
--
-- rateForDay (src/lib/acc/travel-booking/perdiem.ts) returns 0 for a day it
-- cannot match, so a stored 0 is indistinguishable from "no rate configured"
-- while looking configured on screen — on a path that writes
-- AccRequest.TotalAmount. AccTravelPerDiemCountry defends this twice, at the
-- constraint and in its service, and so does this table.
--
-- ---------------------------------------------------------------------------
-- NO FOREIGN KEY TO UatTester, deliberately: rates outlive a soft-deleted
-- tester row and are read by StaffId, which UQ_UatTester_StaffId already makes
-- that table's real identity key.

IF DB_NAME() NOT LIKE 'Fast_Core%'
  THROW 50000, 'This migration targets Fast_Core. Re-run with --db Fast_Core.', 1;
GO

IF OBJECT_ID('dbo.UatTesterPerDiem', 'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[UatTesterPerDiem] (
    [Id]            INT IDENTITY(1,1) NOT NULL CONSTRAINT [PK_UatTesterPerDiem] PRIMARY KEY,
    [StaffId]       INT            NOT NULL,
    [EffectiveDate] DATE           NOT NULL,
    [Amount]        DECIMAL(18,2)  NOT NULL CONSTRAINT [CK_UatTesterPerDiem_Amount] CHECK ([Amount] > 0),
    [Note]          NVARCHAR(300)  NULL,
    [IsActive]      BIT            NOT NULL CONSTRAINT [DF_UatTesterPerDiem_IsActive] DEFAULT (1),
    [CreatedBy]     INT            NULL,
    [CreatedAt]     DATETIME2(7)   NOT NULL CONSTRAINT [DF_UatTesterPerDiem_CreatedAt] DEFAULT (SYSDATETIME()),
    [UpdatedBy]     INT            NULL,
    [UpdatedAt]     DATETIME2(7)   NOT NULL CONSTRAINT [DF_UatTesterPerDiem_UpdatedAt] DEFAULT (SYSDATETIME()),
    CONSTRAINT [UQ_UatTesterPerDiem_Staff_Date] UNIQUE ([StaffId], [EffectiveDate])
  );
  PRINT 'Created dbo.UatTesterPerDiem';
END
ELSE PRINT 'dbo.UatTesterPerDiem already present - skipped';
GO
