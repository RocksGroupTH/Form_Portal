-- 166_settings_message_grant.sql
-- Target: BOTH form databases — Rocks_Portal_Form AND Rocks_Portal_Form_UAT.
-- Apply to both BEFORE the code deploys.
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/166_settings_message_grant.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/166_settings_message_grant.sql
--
-- ---------------------------------------------------------------------------
-- WHAT THIS IS, AND WHY IT IS COLUMNS RATHER THAN AccApproverSettingsTab ROWS.
--
-- The Message settings tab (migration 164's FormMessage, Fast_Core) shipped
-- admin-only on every one of the five forms, because the ordinary grant
-- mechanism — a row in AccApproverSettingsTab / AccBookingApproverTab /
-- AccReimburseAccessTab / AccAdvClrAccessTab, naming a TabKey — cannot hold it.
-- All four of those tables are shared with ACC Portal, and every one of that
-- app's own savers replaces an approver's WHOLE tab set with only the keys its
-- own list knows (measured against the sibling checkout: AP-1's
-- approver-settings-tabs.ts:47-56, AP-17's booking-approver-tabs.ts:93-102, and
-- the AP-4 / AP-2 / AP-3 equivalents are the same shape). A `messages` row
-- written here would survive until the next time an admin ticked ANY settings
-- tab for that same person over there, and then vanish with no error on either
-- side — the exact defect 8a3ab358 fixed for AP-17's CanQueue/CanAccount/
-- CanReport menu ticks, which moved off AccBookingApproverTab onto columns for
-- precisely this reason.
--
-- So the Message grant follows that same, already-proven shape: a BIT column
-- on the roster/access row itself, which ACC Portal's savers write with
-- explicit column lists (`UPDATE ... SET StaffId=..., Email=..., ...` /
-- `MERGE ... WHEN MATCHED THEN UPDATE SET ...`) and never `SELECT *` or a
-- wholesale row rewrite — verified against the live sibling checkout
-- (../ACC_Portal/ACC_Portal) for all four tables before writing this file:
--   AccApprover        settings-service.ts:153,161      (AP-1)
--   AccBookingApprover  booking-approver-service.ts:141  (AP-17)
--   AccReimburseAccess  access-service.ts:137            (AP-4)
--   AccAdvClrAccess     access-service.ts:270            (AP-2 / AP-3)
-- A column ACC Portal does not name is a column ACC Portal never touches.
--
-- ---------------------------------------------------------------------------
-- FIVE COLUMNS ON FOUR TABLES, BECAUSE AP-2 AND AP-3 SHARE ONE ROSTER ROW.
--
--   AccApprover.CanMessage           -- AP-1
--   AccBookingApprover.CanMessage    -- AP-17
--   AccReimburseAccess.CanMessage    -- AP-4
--   AccAdvClrAccess.CanAdvanceMessage -- AP-2
--   AccAdvClrAccess.CanClearMessage   -- AP-3
--
-- AccAdvClrAccess (migration 152) carries no FormCode: one person, one row,
-- shared by both forms — the same reason its settings-tab keys stay TWO
-- entries (`advanceMessages` / `clearMessages`) rather than one `messages`.
-- Two columns are what let the two forms' grids show and save this tick
-- independently, exactly as advanceErpInterface / clearErpInterface do for
-- Interface ERP.
--
-- ---------------------------------------------------------------------------
-- DEFAULT 0 — NOBODY GAINS THE TAB ON THE DAY THIS LANDS.
--
-- This is new reach, not a narrowing of something the roster already implied
-- (unlike AP-17's CanQueue/CanAccount/CanReport, which migration 124 defaulted
-- to 1 because being on that roster had always opened all three). Nobody has
-- asked for this tab to open for anybody on deploy day; admins keep seeing it
-- exactly as they do today, and the user ticks people in one at a time from
-- each form's สิทธิ์เข้าถึง grid.
--
-- ---------------------------------------------------------------------------
-- ALL FOUR TABLES ARE ALREADY IN MASTER_TABLES AND DUAL-WRITTEN.
--
-- npm run check:alignment MUST STILL READ 30 AFTERWARDS. This adds columns to
-- tables already on the list — it does not add a table. 31 means something was
-- wrongly added to that list. The checker compares every non-datetime column,
-- so applying this to only one database reds the check on these four tables —
-- that is the check working, not a fault to silence.
--
-- ---------------------------------------------------------------------------
-- Idempotent: every ADD is guarded on sys.columns, so a re-run on either
-- database is a no-op rather than an error.

SET XACT_ABORT ON;
GO

-- `DB_NAME()` goes through a DECLAREd variable: RAISERROR's substitution
-- arguments are constants or variables and never expressions, so calling it
-- inline is a parse error — the mistake migration 163's first apply found.
IF DB_NAME() NOT LIKE 'Rocks[_]Portal[_]Form%'
BEGIN
  DECLARE @wrongDb NVARCHAR(128) = DB_NAME();
  RAISERROR('166 targets Rocks_Portal_Form or Rocks_Portal_Form_UAT. Current database is %s — refusing.', 16, 1, @wrongDb);
END
GO

IF OBJECT_ID('dbo.AccApprover', 'U') IS NULL
  THROW 50000, 'dbo.AccApprover is missing — apply 059 first.', 1;
GO
IF OBJECT_ID('dbo.AccBookingApprover', 'U') IS NULL
  THROW 50000, 'dbo.AccBookingApprover is missing — apply 095 first.', 1;
GO
IF OBJECT_ID('dbo.AccReimburseAccess', 'U') IS NULL
  THROW 50000, 'dbo.AccReimburseAccess is missing — apply 120 first.', 1;
GO
IF OBJECT_ID('dbo.AccAdvClrAccess', 'U') IS NULL
  THROW 50000, 'dbo.AccAdvClrAccess is missing — apply 152 first.', 1;
GO

-- == AP-1 =====================================================================
IF NOT EXISTS (
  SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.AccApprover') AND name = 'CanMessage'
)
BEGIN
  ALTER TABLE [dbo].[AccApprover]
    ADD [CanMessage] BIT NOT NULL CONSTRAINT [DF_AccApprover_CanMessage] DEFAULT (0);
  PRINT 'Added AccApprover.CanMessage';
END
ELSE PRINT 'AccApprover.CanMessage already present - skipped';
GO

-- == AP-17 ====================================================================
IF NOT EXISTS (
  SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.AccBookingApprover') AND name = 'CanMessage'
)
BEGIN
  ALTER TABLE [dbo].[AccBookingApprover]
    ADD [CanMessage] BIT NOT NULL CONSTRAINT [DF_AccBookingApprover_CanMessage] DEFAULT (0);
  PRINT 'Added AccBookingApprover.CanMessage';
END
ELSE PRINT 'AccBookingApprover.CanMessage already present - skipped';
GO

-- == AP-4 =====================================================================
IF NOT EXISTS (
  SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.AccReimburseAccess') AND name = 'CanMessage'
)
BEGIN
  ALTER TABLE [dbo].[AccReimburseAccess]
    ADD [CanMessage] BIT NOT NULL CONSTRAINT [DF_AccReimburseAccess_CanMessage] DEFAULT (0);
  PRINT 'Added AccReimburseAccess.CanMessage';
END
ELSE PRINT 'AccReimburseAccess.CanMessage already present - skipped';
GO

-- == AP-2 / AP-3 — one row, two columns ======================================
IF NOT EXISTS (
  SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.AccAdvClrAccess') AND name = 'CanAdvanceMessage'
)
BEGIN
  ALTER TABLE [dbo].[AccAdvClrAccess]
    ADD [CanAdvanceMessage] BIT NOT NULL CONSTRAINT [DF_AccAdvClrAccess_CanAdvanceMessage] DEFAULT (0);
  PRINT 'Added AccAdvClrAccess.CanAdvanceMessage';
END
ELSE PRINT 'AccAdvClrAccess.CanAdvanceMessage already present - skipped';
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.AccAdvClrAccess') AND name = 'CanClearMessage'
)
BEGIN
  ALTER TABLE [dbo].[AccAdvClrAccess]
    ADD [CanClearMessage] BIT NOT NULL CONSTRAINT [DF_AccAdvClrAccess_CanClearMessage] DEFAULT (0);
  PRINT 'Added AccAdvClrAccess.CanClearMessage';
END
ELSE PRINT 'AccAdvClrAccess.CanClearMessage already present - skipped';
GO

-- == Post-apply ===============================================================
-- Every existing row must read 0 — nobody is granted the tab by this migration.
SELECT DB_NAME() AS db, 'AccApprover' AS [Table], COUNT(*) AS [Rows],
       SUM(CASE WHEN [CanMessage] = 1 THEN 1 ELSE 0 END) AS [GrantedCount]
FROM [dbo].[AccApprover]
UNION ALL
SELECT DB_NAME(), 'AccBookingApprover', COUNT(*), SUM(CASE WHEN [CanMessage] = 1 THEN 1 ELSE 0 END)
FROM [dbo].[AccBookingApprover]
UNION ALL
SELECT DB_NAME(), 'AccReimburseAccess', COUNT(*), SUM(CASE WHEN [CanMessage] = 1 THEN 1 ELSE 0 END)
FROM [dbo].[AccReimburseAccess]
UNION ALL
SELECT DB_NAME(), 'AccAdvClrAccess (Advance)', COUNT(*), SUM(CASE WHEN [CanAdvanceMessage] = 1 THEN 1 ELSE 0 END)
FROM [dbo].[AccAdvClrAccess]
UNION ALL
SELECT DB_NAME(), 'AccAdvClrAccess (Clear)', COUNT(*), SUM(CASE WHEN [CanClearMessage] = 1 THEN 1 ELSE 0 END)
FROM [dbo].[AccAdvClrAccess];
GO
