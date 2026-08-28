-- Which parts of AP-17 each person on the roster may see.
--
-- Apply with (BOTH databases):
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/124_acc_booking_approver_areas.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/124_acc_booking_approver_areas.sql
--
-- Apply this BEFORE the code that reads it reaches either database. A missing
-- column is 'Invalid column name' at compile time, not a NULL, and these are
-- read through the same both-pools machinery the rest of AccBookingApprover is.
--
-- WHY COLUMNS AND NOT A CHILD TABLE
--
-- AccBookingApproverTab (096) is a child table because its granted set grows:
-- every new [kind] segment of the settings API is another tab somebody might
-- be handed, and the rows have to be able to name keys the schema has never
-- heard of. These three are the opposite — they are the three AP-17 menu items,
-- fixed, and each maps to exactly one page and the routes behind it. A child
-- table would model an open set that is not open, and cost a join on the read
-- that gates every request in the module.
--
-- DEFAULT 1, AND WHY THAT IS THE SAFE DIRECTION HERE
--
-- Everywhere else in this schema a grant defaults to nothing: AccBookingApproverTab
-- and AccReimburseAccess both document that no rows means no grants, never
-- "all", because they hand out something the person did not previously have.
--
-- These do not. Being on AccBookingApprover ALREADY opened the queue, the
-- accounting approvals and the report — one row, all three. Defaulting to 0
-- would take that away from everyone on the roster the moment this lands, and
-- the only way back would be an admin re-ticking every box for every person.
-- DEFAULT 1 on the ALTER writes 1 into every existing row, so the split
-- changes nothing until somebody actually unticks something, which is what a
-- refinement of an existing permission should do.
--
-- New rows inserted without naming these columns are all-three as well. That is
-- also deliberate: the roster's own meaning is "this person works on AP-17",
-- and narrowing it is the exception the admin ticks, not the default they have
-- to undo.
SET XACT_ABORT ON;
GO

IF COL_LENGTH('dbo.AccBookingApprover', 'CanQueue') IS NULL
BEGIN
  ALTER TABLE [dbo].[AccBookingApprover]
    ADD [CanQueue] BIT NOT NULL
      CONSTRAINT [DF_AccBookingApprover_CanQueue] DEFAULT (1);
  PRINT 'AccBookingApprover.CanQueue added.';
END
ELSE
  PRINT 'AccBookingApprover.CanQueue already exists -- nothing to do.';
GO

IF COL_LENGTH('dbo.AccBookingApprover', 'CanAccount') IS NULL
BEGIN
  ALTER TABLE [dbo].[AccBookingApprover]
    ADD [CanAccount] BIT NOT NULL
      CONSTRAINT [DF_AccBookingApprover_CanAccount] DEFAULT (1);
  PRINT 'AccBookingApprover.CanAccount added.';
END
ELSE
  PRINT 'AccBookingApprover.CanAccount already exists -- nothing to do.';
GO

IF COL_LENGTH('dbo.AccBookingApprover', 'CanReport') IS NULL
BEGIN
  ALTER TABLE [dbo].[AccBookingApprover]
    ADD [CanReport] BIT NOT NULL
      CONSTRAINT [DF_AccBookingApprover_CanReport] DEFAULT (1);
  PRINT 'AccBookingApprover.CanReport added.';
END
ELSE
  PRINT 'AccBookingApprover.CanReport already exists -- nothing to do.';
GO
