-- AP-2 and AP-3's shared access list, and the per-tab / per-menu grants over it.
--
-- Apply with (BOTH databases):
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/152_adv_clr_access.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/152_adv_clr_access.sql
--
-- Apply this BEFORE the code that reads it reaches either database. A missing
-- table is 'Invalid object name' at compile time, not an empty result.
--
-- ONE ROSTER FOR TWO FORMS, AND THE NAME SAYS SO
--
-- The user chose a single shared list (2026-09-14): a tick says whether
-- somebody may open a menu or a settings tab of AP-2 OR AP-3, not of one of
-- them. That follows what these two forms already do with brands --
-- setBrandActiveShared writes AccFormBrand for 'AP-2' and 'AP-3' in one
-- transaction, so a brand is enabled for both or neither -- and it is why
-- the table is called AccAdvClrAccess rather than AccAdvanceAccess. A name
-- saying AP-2 over a table AP-3 also reads is exactly the kind of trap this
-- repository keeps having to document after the fact.
--
-- There is therefore NO FormCode column, deliberately. Adding one later would
-- mean deciding what a row with FormCode NULL means, and the whole point is
-- that there is one answer rather than a default and an override.
--
-- WHY A SEPARATE ROSTER FROM THE APPROVERS
--
-- AccAdvanceApprover and AccClearAdvanceApprover are the pools that take real
-- approval steps -- HEAD_ACC, DIRECTOR, ACC_OFFICER on AP-2, and AP-3's own.
-- Being on one means approving money. Hanging settings and menu grants off
-- them would make "may edit the approval matrix" and "may approve a payment"
-- the same tick, with no way to hand out the first alone. That is migration
-- 120's argument for AP-4, applied to the two forms that had no such split at
-- all: before this, every AP-2 and AP-3 settings route was requireRole and
-- there was nothing an admin could hand to anybody.
--
-- WHAT MAY BE TICKED
--
-- TabKey holds two vocabularies in one column, the arrangement AP-17 reached
-- first and AP-4 copied:
--
--   settings tabs -- 'brands' | 'matrix' | 'banks' | 'glAccounts' | 'locations'
--   menus         -- 'advanceQueue' | 'advanceReport'
--                    | 'clearQueue'  | 'clearReport'
--
-- and deliberately NO key for two of the settings tabs:
--
--   'access'       -- the สิทธิ์เข้าถึง tab itself. Whoever can open it can
--                     grant themselves everything else, and the same grid also
--                     edits the two approver rosters.
--   'erpInterface' -- which Business Central company each claim brand posts
--                     into, and the journal batch and tax accounts it carries.
--                     Not brand-scoped, exactly as CLAUDE.md records for AP-1's
--                     own gl-accounts / bank-accounts / journal-batches routes:
--                     a grant would be a grant over every brand's posting
--                     configuration. Its route stays requireRole.
--
-- There is deliberately NO CHECK on TabKey. Enforcement has to be in code
-- anyway, because this table is writable from more than one place -- so a row
-- naming any string can appear, and the grantable test in
-- src/lib/adv/settings-tabs.ts is what makes such a row inert. That freedom is
-- also what lets the menu vocabulary share the column without a migration.
--
-- SHARED MASTER TABLES
--
-- Both are dual-written through src/lib/adv/access-service.ts and asserted by
-- npm run check:alignment, which goes from 28 tables to 30. Neither carries an
-- identity floor, exactly as the other master tables do not -- dual-write
-- relies on the two identity counters staying in lockstep, and a
-- CHECK (Id >= 900000) in UAT would reject every write.
--
-- AccessId refers to AccAdvClrAccess.Id with NO foreign key, for the reason
-- migration 096 gives and 120 repeats: dual-write inserts into the two
-- databases independently, and an FK would tie these two tables' identity
-- counters to each other as well as across databases.
--
-- NO SEED. The table ships empty, and an empty table grants nothing to anybody
-- and takes nothing away: every AP-2 and AP-3 route keeps its admin arm, so an
-- admin sees exactly what they saw before and a non-admin sees exactly what
-- they saw before -- nothing. This is a capability an admin can now hand out,
-- not one anybody has been handed.
--
-- ============================================================================
-- AMENDED 2026-09-22 -- THE SCREEN SPLIT PER FORM. THIS TABLE DID NOT.
-- ============================================================================
--
-- User instruction: "สิทธิ์เข้าถึง AP-2 จะใช้แค่ AP-2 เท่านั้น และ สิทธิ์เข้าถึง AP-3
-- ก็ใช้แค่ AP-3 เท่านั้น ปรับให้แยกกันเหมือนของ AP-4". Each form's settings page
-- now shows and saves only its own keys.
--
-- NO MIGRATION WAS NEEDED, AND THE "NO FormCode" ARGUMENT ABOVE IS WHY.
-- That paragraph still stands and was not reversed: there is still one row per
-- person, still no FormCode, still one answer rather than a default and an
-- override. What split is the SCREEN and the WRITE, both in code -- the keys
-- had named their form since the day this shipped, so the partition was
-- already in the data and only the UI was pooling it. Adding a FormCode now
-- would reintroduce exactly the NULL-means-what question that paragraph
-- rejects, and buy nothing the key names do not already give.
--
-- THE WRITE IS THE PART THAT CHANGED, AND IT MATTERS TO THIS TABLE.
-- src/lib/adv/access-service.ts used to clear a person's grants with
--   DELETE FROM AccAdvClrAccessTab WHERE AccessId = @aid
-- which was correct only while one screen posted every key somebody held. With
-- two screens it deletes the other form's grants on every save. It is now
-- bounded -- AND TabKey IN (...) over that form's own keys -- and the partition
-- it binds to is asserted disjoint and covering in settings-tabs.test.ts.
-- Anything else that ever writes this table must be bounded the same way.
--
-- WHAT IS STILL SHARED, because the roster did not split:
--   * membership -- adding somebody on one form's page lists them on the
--     other's (harmless: membership alone grants nothing, as above);
--   * IsActive -- resolveAdvClrTabsByEmail tests it, so ปิดสิทธิ์ on either
--     page revokes BOTH forms' grants. Both settings screens say so.
--
-- ONE CORRECTION TO THE VOCABULARY LIST ABOVE, which predates this amendment
-- and is not caused by it: 'glAccounts' is listed there as a grantable settings
-- tab and has never been one in code. It and 'buGlMap' are refused by
-- GRANTABLE_ADV_CLR_TABS for the reason AP-4 gives for the same two keys --
-- those rows are AP-3's own G/L rules, shared with AP-4 and carrying no
-- FormCode, so a grant would reach another form's posting configuration. The
-- original lines are left as written; this is the accurate list of what may be
-- ticked: 'brands' | 'matrix' | 'banks' | 'locations', plus the four menus.
SET XACT_ABORT ON;
GO

IF OBJECT_ID('dbo.AccAdvClrAccess', 'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[AccAdvClrAccess] (
    [Id]          INT IDENTITY(1,1) NOT NULL CONSTRAINT [PK_AccAdvClrAccess] PRIMARY KEY,
    [StaffId]     INT NOT NULL CONSTRAINT [UQ_AccAdvClrAccess_StaffId] UNIQUE,
    [Email]       NVARCHAR(200) NOT NULL,
    [DisplayName] NVARCHAR(200) NOT NULL,
    [IsActive]    BIT NOT NULL CONSTRAINT [DF_AccAdvClrAccess_Active] DEFAULT (1),
    [CreatedBy]   INT NULL,
    [CreatedAt]   DATETIME2(7) NOT NULL CONSTRAINT [DF_AccAdvClrAccess_Created] DEFAULT (SYSDATETIME()),
    [UpdatedBy]   INT NULL,
    [UpdatedAt]   DATETIME2(7) NOT NULL CONSTRAINT [DF_AccAdvClrAccess_Updated] DEFAULT (SYSDATETIME())
  );
  PRINT 'AccAdvClrAccess created.';
END
ELSE
  PRINT 'AccAdvClrAccess already exists -- nothing to do.';
GO

-- Scoped to the object, not database-wide: an index name is only unique within
-- its table, so the unscoped form can be satisfied by a same-named index on
-- some other table and skip creating this one without saying so.
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_AccAdvClrAccess_Email'
    AND object_id = OBJECT_ID('dbo.AccAdvClrAccess')
)
  CREATE INDEX [IX_AccAdvClrAccess_Email] ON [dbo].[AccAdvClrAccess] ([Email]);
GO

IF OBJECT_ID('dbo.AccAdvClrAccessTab', 'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[AccAdvClrAccessTab] (
    [Id]        INT IDENTITY(1,1) NOT NULL CONSTRAINT [PK_AccAdvClrAccessTab] PRIMARY KEY,
    [AccessId]  INT NOT NULL,
    [TabKey]    NVARCHAR(40) NOT NULL,
    [CreatedAt] DATETIME2(7) NOT NULL CONSTRAINT [DF_AccAdvClrAccessTab_Created] DEFAULT (SYSDATETIME())
  );
  PRINT 'AccAdvClrAccessTab created.';
END
ELSE
  PRINT 'AccAdvClrAccessTab already exists -- nothing to do.';
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UX_AccAdvClrAccessTab'
    AND object_id = OBJECT_ID('dbo.AccAdvClrAccessTab')
)
  CREATE UNIQUE INDEX [UX_AccAdvClrAccessTab]
    ON [dbo].[AccAdvClrAccessTab] ([AccessId], [TabKey]);
GO
