-- AP-4's own access list, and the per-tab grants over it.
--
-- Apply with (BOTH databases):
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/106_acc_reimburse_access.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/106_acc_reimburse_access.sql
--
-- Apply this BEFORE the code that reads it reaches either database. A missing
-- table is 'Invalid object name' at compile time, not an empty result, and
-- these are read through the same both-pools machinery migration 090 was.
--
-- WHY A SECOND ROSTER, WHEN AP-4 ALREADY HAS AccReimburseApprover
--
-- AccReimburseApprover is the pool that takes the ACCOUNT and ACCOUNT_FINAL
-- steps -- being on it means approving real reimbursement payments. AP-17's
-- AccBookingApprover is nothing of the sort: it grants sight of a queue and a
-- report. So AP-17 can hang its settings-tab grants off its approver roster and
-- AP-4 cannot: doing that here would make "may edit the payment rules" and "may
-- approve a payment" the same tick, and there would be no way to hand out the
-- first without the second.
--
-- Hence AccReimburseAccess: the same shape as AccBookingApprover, but its own
-- list. Nobody gains an approval step by being granted a settings tab, and
-- nobody on the approver pool gains a settings tab by approving.
--
-- WHAT MAY BE TICKED
--
-- TabKey holds the AP-4 settings page's own tab key -- 'rules' or 'brands'.
-- There is deliberately no CHECK on it, and deliberately no key for the other
-- two tabs:
--
--   'access'    -- the สิทธิ์เข้าถึง tab itself. Whoever can open it can grant
--                  themselves everything else.
--   'approvers' -- the ผู้อนุมัติบัญชี tab. Sharper than AP-1's version of the
--                  same exclusion: that tab is the payment-approval pool, so
--                  granting it would be a route from "may edit the checklist"
--                  to "may approve money".
--
-- Both are refused in code (decideReimburseTabAccess), not here. Enforcement
-- has to be in code anyway, because this table is writable from more than one
-- place -- so a row naming any string can appear, and the grantable test is
-- what makes that inert.
--
-- SHARED MASTER TABLES
--
-- Both are dual-written by src/lib/acc/reimburse/access-service.ts and
-- access-tabs.ts, and asserted by npm run check:alignment, which goes from 23
-- tables to 25. Neither carries an identity floor, exactly as the other master
-- tables do not -- dual-write relies on the two identity counters staying in
-- lockstep, and a CHECK (Id >= 900000) in UAT would reject every write.
--
-- AccessId refers to AccReimburseAccess.Id, with no foreign key, for the reason
-- 096 gives: dual-write inserts into the two databases independently, and an FK
-- would tie these two tables' identity counters to each other as well as across
-- databases.
SET XACT_ABORT ON;
GO

IF OBJECT_ID('dbo.AccReimburseAccess', 'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[AccReimburseAccess] (
    [Id]          INT IDENTITY(1,1) NOT NULL CONSTRAINT [PK_AccReimburseAccess] PRIMARY KEY,
    [StaffId]     INT NOT NULL CONSTRAINT [UQ_AccReimburseAccess_StaffId] UNIQUE,
    [Email]       NVARCHAR(200) NOT NULL,
    [DisplayName] NVARCHAR(200) NOT NULL,
    [IsActive]    BIT NOT NULL CONSTRAINT [DF_AccReimburseAccess_Active] DEFAULT (1),
    [CreatedBy]   INT NULL,
    [CreatedAt]   DATETIME2(7) NOT NULL CONSTRAINT [DF_AccReimburseAccess_Created] DEFAULT (SYSDATETIME()),
    [UpdatedBy]   INT NULL,
    [UpdatedAt]   DATETIME2(7) NOT NULL CONSTRAINT [DF_AccReimburseAccess_Updated] DEFAULT (SYSDATETIME())
  );
  PRINT 'AccReimburseAccess created.';
END
ELSE
  PRINT 'AccReimburseAccess already exists -- nothing to do.';
GO

-- Scoped to the object, not database-wide: an index name is only unique within
-- its table, so the unscoped form can be satisfied by a same-named index on
-- some other table and skip creating this one without saying so.
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_AccReimburseAccess_Email'
    AND object_id = OBJECT_ID('dbo.AccReimburseAccess')
)
  CREATE INDEX [IX_AccReimburseAccess_Email] ON [dbo].[AccReimburseAccess] ([Email]);
GO

IF OBJECT_ID('dbo.AccReimburseAccessTab', 'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[AccReimburseAccessTab] (
    [Id]        INT IDENTITY(1,1) NOT NULL CONSTRAINT [PK_AccReimburseAccessTab] PRIMARY KEY,
    [AccessId]  INT NOT NULL,
    [TabKey]    NVARCHAR(40) NOT NULL,
    [CreatedAt] DATETIME2(7) NOT NULL CONSTRAINT [DF_AccReimburseAccessTab_Created] DEFAULT (SYSDATETIME())
  );
  PRINT 'AccReimburseAccessTab created.';
END
ELSE
  PRINT 'AccReimburseAccessTab already exists -- nothing to do.';
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UX_AccReimburseAccessTab'
    AND object_id = OBJECT_ID('dbo.AccReimburseAccessTab')
)
  CREATE UNIQUE INDEX [UX_AccReimburseAccessTab]
    ON [dbo].[AccReimburseAccessTab] ([AccessId], [TabKey]);
GO
