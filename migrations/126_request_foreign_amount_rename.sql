-- Rename AccRequest.BaseAmount to ForeignAmount.
--
-- Apply to BOTH form databases:
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/126_request_foreign_amount_rename.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/126_request_foreign_amount_rename.sql
--
-- NUMBERED 126. Read the highest number on *master* before picking one.
--
-- ---------------------------------------------------------------------------
-- WHY, AND WHY NOW
--
-- Migration 125 named this column BaseAmount, following the spec's wording
-- ("the foreign figure, before conversion"). That is the OPPOSITE of what the
-- same name means twelve inches away: AccAdvance.BaseAmount (migration 077) is
-- `Amount x Rate` — the figure in BAHT — and its own header says so:
-- "ยอดเป็นบาท (Amount×Rate)".
--
-- Two adjacent tables in one database using one name for opposite things, in
-- code that decides what a company pays, is a trap that costs somebody a wrong
-- number eventually. `ForeignAmount` cannot be read backwards.
--
-- Now, because it is free now. Zero rows carry a currency (verified before
-- applying: SELECT COUNT(*) FROM AccRequest WHERE Currency IS NOT NULL = 0 in
-- both databases), so this is a rename and not a data migration. The same
-- change after the first foreign claim is filed is neither.
--
-- sp_rename rather than drop-and-add: it keeps the column's position, type and
-- any future dependency intact, and it is a no-op to re-run because the guard
-- below tests for the new name first.

SET XACT_ABORT ON;
GO

IF DB_NAME() NOT LIKE 'Rocks[_]Portal[_]Form%'
  THROW 50000, 'Run this against Rocks_Portal_Form or Rocks_Portal_Form_UAT only.', 1;
GO

IF OBJECT_ID('dbo.AccRequest', 'U') IS NULL
  THROW 50000, 'dbo.AccRequest is missing — apply 059 first.', 1;
GO

-- Refuse if anything has already been written under the old name. This is a
-- rename, not a data migration, and the difference matters: a populated column
-- means somebody has filed a foreign claim and the meaning of these rows has to
-- be established before touching them.
IF COL_LENGTH('dbo.AccRequest', 'BaseAmount') IS NOT NULL
   AND EXISTS (SELECT 1 FROM [dbo].[AccRequest] WHERE [BaseAmount] IS NOT NULL)
  THROW 50000, 'AccRequest.BaseAmount holds data — stop and establish what it means before renaming.', 1;
GO

IF COL_LENGTH('dbo.AccRequest', 'ForeignAmount') IS NULL
   AND COL_LENGTH('dbo.AccRequest', 'BaseAmount') IS NOT NULL
  EXEC sp_rename 'dbo.AccRequest.BaseAmount', 'ForeignAmount', 'COLUMN';
GO

-- Post-apply: the new name present, the old one gone.
SELECT
  COL_LENGTH('dbo.AccRequest','ForeignAmount') AS ForeignAmount,
  COL_LENGTH('dbo.AccRequest','BaseAmount')    AS BaseAmount_ShouldBeNull;
GO
