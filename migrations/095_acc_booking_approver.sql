-- AP-17's own access list.
--
-- Apply with (BOTH databases):
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/095_acc_booking_approver.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/095_acc_booking_approver.sql
--
-- ACC Portal gates AP-17 with AP-1's AccApprover. Form Portal deliberately does
-- not: someone who arranges hotel bookings should not thereby gain the
-- travel-expense approval queue, or the reverse.
--
-- This is a shared master table: it is dual-written by
-- src/lib/acc/booking-approver-service.ts and asserted by
-- npm run check:alignment. It carries no identity floor, exactly as the other
-- master tables do not — dual-write relies on the two identity counters staying
-- in lockstep, and a CHECK (Id >= 900000) in UAT would reject every write.
--
-- Numbered 095 rather than 067: 088-094 are claimed by the unmerged AP-4 branch.
SET XACT_ABORT ON;
GO

IF OBJECT_ID('dbo.AccBookingApprover', 'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[AccBookingApprover] (
    [Id]          INT IDENTITY(1,1) NOT NULL CONSTRAINT [PK_AccBookingApprover] PRIMARY KEY,
    [StaffId]     INT NOT NULL CONSTRAINT [UQ_AccBookingApprover_StaffId] UNIQUE,
    [Email]       NVARCHAR(200) NOT NULL,
    [DisplayName] NVARCHAR(200) NOT NULL,
    [IsActive]    BIT NOT NULL CONSTRAINT [DF_AccBookingApprover_Active] DEFAULT (1),
    [CreatedBy]   INT NULL,
    [CreatedAt]   DATETIME2(7) NOT NULL CONSTRAINT [DF_AccBookingApprover_Created] DEFAULT (SYSDATETIME()),
    [UpdatedBy]   INT NULL,
    [UpdatedAt]   DATETIME2(7) NOT NULL CONSTRAINT [DF_AccBookingApprover_Updated] DEFAULT (SYSDATETIME())
  );
  PRINT 'AccBookingApprover created.';
END
ELSE
  PRINT 'AccBookingApprover already exists — nothing to do.';
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AccBookingApprover_Email')
  CREATE INDEX [IX_AccBookingApprover_Email] ON [dbo].[AccBookingApprover] ([Email]);
GO
