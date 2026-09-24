-- 163 — Who owns each form, so a requester has somebody to ask.
--
-- Apply with:
--   npm run apply-sql -- --db Fast_Core --file migrations/163_core_form_owner.sql
--
-- TARGET: Fast_Core, and only Fast_Core.
--
-- ## Why here
--
-- It sits beside `FormEnvironment`, which the same settings page already
-- writes, and for the same practical reason: the page is one screen listing
-- every form, and a second database would make it two reads that can disagree
-- about which forms exist. It is **not** here for `FormEnvironment`'s own
-- reason — that table must live outside the form databases because it decides
-- *which one answers*, and nothing here decides anything.
--
-- **One physical copy. Not dual-written, not in MASTER_TABLES.** An owner is
-- the same person whichever database a request lands in, so there is no second
-- side to keep in step: `npm run check:alignment` must still report **30**
-- tables afterwards, and 31 means this was wrongly added to that list.
--
-- ## What a row is, and what it is not
--
-- **It grants nothing.** Being named here does not let somebody approve,
-- cancel, configure or read anything they could not read before; it is a
-- contact line printed at the foot of a form. That is why there is no
-- `IsActive` column and removal is a real DELETE, unlike `UatTester`,
-- `AccApprover` and every other roster in this application — those are soft
-- deleted because switching somebody off is a revocation with a history worth
-- keeping, and there is no access here to revoke.
--
-- `Email` is the key and the thing that matters: it is what a requester
-- actually uses. `DisplayName` is a snapshot taken when an admin picks the
-- person from the directory, refreshed whenever they save that form's owners
-- again — a stale display name beside a working address is a much cheaper
-- wrongness than a per-render directory lookup on every form page.
-- `StaffId` is nullable because the directory search answers Azure AD, which
-- holds people `Rocks_Portal_HR` may not.
--
-- FormCode is NOT foreign-keyed to AccFormMaster: that table lives in
-- Rocks_Portal_Form and this database cannot reference it. The settings page
-- lists the catalogue from there and writes codes from that list, so the
-- values are constrained by where they come from rather than by a constraint.
--
-- Idempotent. Safe to re-run.

SET XACT_ABORT ON;
GO

IF DB_NAME() NOT LIKE 'Fast_Core%'
BEGIN
  RAISERROR('163 targets Fast_Core. Current database is %s — refusing.', 16, 1, DB_NAME());
END
GO

IF OBJECT_ID('dbo.FormOwner', 'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[FormOwner] (
    [Id]          INT IDENTITY(1,1) NOT NULL CONSTRAINT [PK_FormOwner] PRIMARY KEY,
    [FormCode]    NVARCHAR(20)  NOT NULL,
    [Email]       NVARCHAR(200) NOT NULL,
    [DisplayName] NVARCHAR(200) NULL,
    [StaffId]     INT           NULL,
    [UpdatedBy]   INT           NULL,
    [UpdatedAt]   DATETIME2(7)  NOT NULL CONSTRAINT [DF_FormOwner_UpdatedAt] DEFAULT (SYSDATETIME())
  );
  PRINT '163: created dbo.FormOwner';
END
ELSE
  PRINT '163: dbo.FormOwner already exists — nothing to do';
GO

-- One row per person per form. Without it a double-click on Save, or two
-- admins on two tabs, leaves the same person printed twice on the form's
-- footer — which reads as two different people with the same name.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_FormOwner_Form_Email')
BEGIN
  CREATE UNIQUE INDEX [UQ_FormOwner_Form_Email]
    ON [dbo].[FormOwner] ([FormCode], [Email]);
  PRINT '163: created UQ_FormOwner_Form_Email';
END
GO

-- The read is always "every owner of these forms", from a page that lists the
-- whole catalogue at once, so the covering index is on FormCode alone.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FormOwner_FormCode')
BEGIN
  CREATE INDEX [IX_FormOwner_FormCode] ON [dbo].[FormOwner] ([FormCode]);
  PRINT '163: created IX_FormOwner_FormCode';
END
GO

SELECT
  (SELECT COUNT(*) FROM [dbo].[FormOwner])                     AS Owners,
  (SELECT COUNT(DISTINCT FormCode) FROM [dbo].[FormOwner])     AS FormsWithAnOwner;
GO
