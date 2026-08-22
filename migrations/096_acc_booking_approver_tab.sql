-- Per-tab grants for AP-17's option settings.
--
-- Apply with (BOTH databases):
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/096_acc_booking_approver_tab.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/096_acc_booking_approver_tab.sql
--
-- AP-1 has AccApproverSettingsTab (migration 059, dbo.AccApprover); this is
-- AP-17's equivalent over AccBookingApprover, covering the four option tabs the
-- travel-booking settings page shows. TabKey holds the same string as the
-- [kind] segment of /api/request/travel-booking/settings/[kind] -- reasons,
-- accommodations, vehicles, rent-vehicles -- so a grant and a URL name each
-- other without a translation table.
--
-- There is deliberately no CHECK on TabKey and no row for 'access', the
-- สิทธิ์เข้าถึง tab: whoever can open that tab can grant themselves everything
-- else, so it is refused in code (decideBookingTabAccess) rather than here.
-- Enforcement has to be in code anyway, because this table is writable from
-- more than one place.
--
-- This is a shared master table: it is dual-written by
-- src/lib/acc/travel-booking/booking-approver-tabs.ts and asserted by
-- npm run check:alignment. It carries no identity floor, exactly as the other
-- master tables do not -- dual-write relies on the two identity counters
-- staying in lockstep, and a CHECK (Id >= 900000) in UAT would reject every
-- write.
--
-- ApproverId refers to AccBookingApprover.Id, with no foreign key. AP-1's
-- AccApproverSettingsTab has none either: dual-write inserts into the two
-- databases independently, and an FK would tie these two tables' identity
-- counters to each other as well as across databases.
SET XACT_ABORT ON;
GO

IF OBJECT_ID('dbo.AccBookingApproverTab', 'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[AccBookingApproverTab] (
    [Id]         INT IDENTITY(1,1) NOT NULL CONSTRAINT [PK_AccBookingApproverTab] PRIMARY KEY,
    [ApproverId] INT NOT NULL,
    [TabKey]     NVARCHAR(40) NOT NULL,
    [CreatedAt]  DATETIME2(7) NOT NULL CONSTRAINT [DF_AccBookingApproverTab_Created] DEFAULT (SYSDATETIME())
  );
  PRINT 'AccBookingApproverTab created.';
END
ELSE
  PRINT 'AccBookingApproverTab already exists -- nothing to do.';
GO

-- Scoped to the object, not database-wide. An index name is only unique within
-- its table, so the unscoped form 095 uses can be satisfied by a same-named
-- index on some other table and skip creating this one without saying so.
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UX_AccBookingApproverTab'
    AND object_id = OBJECT_ID('dbo.AccBookingApproverTab')
)
  CREATE UNIQUE INDEX [UX_AccBookingApproverTab]
    ON [dbo].[AccBookingApproverTab] ([ApproverId], [TabKey]);
GO
