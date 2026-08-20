-- FormCode on the six brand-keyed ERP configuration tables.
--
-- Apply with (BOTH databases):
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/097_per_form_erp_config.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/097_per_form_erp_config.sql
--
-- Every one of these tables is keyed on BrandCode alone, which was right while
-- AP-1 was the only form posting to Business Central. It is not right with a
-- second and a third: a G/L account, a bank account, a journal batch or a
-- branch code is per-brand *and* increasingly per-form, and today there is
-- nowhere to say so.
--
-- FormCode NULL is the default and answers every form; a row naming a form
-- overrides the default for that form alone. The rule is written once, in
-- src/lib/acc/per-form-config.ts, and every read goes through it.
--
-- The feature is inert the moment this lands. Step 2 for each table backfills
-- every existing row to NULL, so afterwards these tables hold nothing but
-- defaults and every form resolves exactly what AP-1 resolved beforehand.
-- Nothing changes until somebody adds an override.
--
-- ---------------------------------------------------------------------------
-- Why every statement is guarded: this file converges two databases that are
-- not in the same state.
--
-- Half of this work was already done by hand, unevenly, and CLAUDE.md records
-- the result under "Known pre-existing drift":
--
--   * AccBrandGlAccount already has the FormCode column, already has data in
--     it, and already has IX_AccBrandGlAccount_FormCode -- in BOTH databases.
--     Its three rows read 'AP-1'.
--   * AccBrandBankAccount and AccBrandJournalBatch have the column in
--     Rocks_Portal_Form_UAT and NOT in Rocks_Portal_Form, which is why
--     npm run check:alignment reports every row of both as unequal despite
--     identical data.
--   * The other three tables have no FormCode in either database.
--
-- So this is not an "add a column" migration, it is a "make these two databases
-- agree" migration. Every ALTER and every lookup-index CREATE is IF NOT EXISTS,
-- every drop is IF EXISTS, and running the file twice, or against either
-- database, ends in the same place.
--
-- The unique index is the one thing NOT skipped when it already exists: it is
-- dropped and recreated unconditionally-after-the-drop, because a surviving
-- two-column index is indistinguishable from a correct one by name and would
-- silently refuse the first override anyone writes. Rebuilding an index that is
-- already right costs nothing on tables this size.
--
-- AccBrandGlAccount's three rows are the only real data this migration
-- rewrites, from 'AP-1' to NULL. That is the point, not a side effect: left
-- form-specific they answer AP-1 and nothing else, so AP-2 and AP-4 would find
-- no G/L account at all -- the exact failure the default/override rule exists
-- to prevent.
--
-- ---------------------------------------------------------------------------
-- Why the backfill and the index swap share a batch.
--
-- The old unique index is on (BrandCode, ...) and knows nothing about FormCode,
-- so for as long as it stands it rejects a perfectly legal override: (AP-4,
-- PCTH, '540100') alongside the default (NULL, PCTH, '540100') reads to it as a
-- duplicate. Backfill, drop and recreate therefore go in one batch under
-- SET XACT_ABORT ON, so no window exists in which a legal row is refused.
--
-- The ALTER has to be in its own earlier batch. SQL Server does deferred name
-- resolution for tables, not for columns of an existing table, so an UPDATE
-- naming FormCode in the same batch that adds it fails to compile.
--
-- Why the new unique index needs no filter and no extra work: SQL Server treats
-- NULLs as EQUAL in a unique index. One brand therefore keeps exactly one
-- default row plus at most one row per form -- precisely the constraint we
-- want, for free.
--
-- Why each drop tests what it is dropping. The originals were declared as
-- UNIQUE CONSTRAINTS (ALTER TABLE ... ADD CONSTRAINT, migrations 027/029/033/
-- 035/036, restated in 059), and a unique constraint cannot be removed with
-- DROP INDEX. But wherever the by-hand work has already replaced one with a
-- plain unique index, ALTER TABLE ... DROP CONSTRAINT is the wrong verb
-- instead. Each drop below reads sys.indexes.is_unique_constraint and uses the
-- verb that matches what it actually finds. The recreate is always CREATE
-- UNIQUE INDEX, so afterwards all six are uniformly indexes -- nothing in src/
-- names these objects, so the change of object class is invisible to the app.
--
-- Index-existence guards are scoped to the object (AND object_id =
-- OBJECT_ID(...)). An index name is unique only within its own table, so the
-- unscoped form can be satisfied by a same-named index on some other table and
-- skip creating this one without saying so.
--
-- The lookup index follows the name and shape the by-hand work already
-- established on AccBrandGlAccount: IX_<T>_FormCode on
-- (FormCode, BrandCode, IsActive, SortOrder) for the four tables that have
-- IsActive and SortOrder, and on (FormCode, BrandCode) for AccBrandErpInterface
-- and AccBrandErpTargetSetting, which have neither column. On those two it
-- duplicates the key of the unique index; it is created anyway so all six
-- tables carry the same index under the same name, and both hold one row per
-- brand, so the duplication costs nothing measurable.
SET XACT_ABORT ON;
GO

-- ===========================================================================
-- 1/6  AccBrandErpInterface -- one row per brand; no IsActive/SortOrder
-- ===========================================================================
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.AccBrandErpInterface') AND name = 'FormCode'
)
BEGIN
  ALTER TABLE [dbo].[AccBrandErpInterface] ADD [FormCode] NVARCHAR(20) NULL;
  PRINT 'AccBrandErpInterface: FormCode added.';
END
ELSE
  PRINT 'AccBrandErpInterface: FormCode already present.';
GO

UPDATE [dbo].[AccBrandErpInterface] SET [FormCode] = NULL WHERE [FormCode] IS NOT NULL;

IF EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UQ_AccBrandErpInterface_Brand'
    AND object_id = OBJECT_ID('dbo.AccBrandErpInterface')
    AND is_unique_constraint = 1
)
  ALTER TABLE [dbo].[AccBrandErpInterface] DROP CONSTRAINT [UQ_AccBrandErpInterface_Brand];
ELSE IF EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UQ_AccBrandErpInterface_Brand'
    AND object_id = OBJECT_ID('dbo.AccBrandErpInterface')
)
  DROP INDEX [UQ_AccBrandErpInterface_Brand] ON [dbo].[AccBrandErpInterface];

CREATE UNIQUE INDEX [UQ_AccBrandErpInterface_Brand]
  ON [dbo].[AccBrandErpInterface] ([FormCode], [BrandCode]);

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_AccBrandErpInterface_FormCode'
    AND object_id = OBJECT_ID('dbo.AccBrandErpInterface')
)
  CREATE INDEX [IX_AccBrandErpInterface_FormCode]
    ON [dbo].[AccBrandErpInterface] ([FormCode], [BrandCode]);

PRINT 'AccBrandErpInterface: rows defaulted to NULL; UQ_AccBrandErpInterface_Brand now (FormCode, BrandCode).';
GO

-- ===========================================================================
-- 2/6  AccBrandErpTargetSetting -- one row per brand; no IsActive/SortOrder
-- ===========================================================================
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.AccBrandErpTargetSetting') AND name = 'FormCode'
)
BEGIN
  ALTER TABLE [dbo].[AccBrandErpTargetSetting] ADD [FormCode] NVARCHAR(20) NULL;
  PRINT 'AccBrandErpTargetSetting: FormCode added.';
END
ELSE
  PRINT 'AccBrandErpTargetSetting: FormCode already present.';
GO

UPDATE [dbo].[AccBrandErpTargetSetting] SET [FormCode] = NULL WHERE [FormCode] IS NOT NULL;

IF EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UQ_AccBrandErpTargetSetting_Brand'
    AND object_id = OBJECT_ID('dbo.AccBrandErpTargetSetting')
    AND is_unique_constraint = 1
)
  ALTER TABLE [dbo].[AccBrandErpTargetSetting] DROP CONSTRAINT [UQ_AccBrandErpTargetSetting_Brand];
ELSE IF EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UQ_AccBrandErpTargetSetting_Brand'
    AND object_id = OBJECT_ID('dbo.AccBrandErpTargetSetting')
)
  DROP INDEX [UQ_AccBrandErpTargetSetting_Brand] ON [dbo].[AccBrandErpTargetSetting];

CREATE UNIQUE INDEX [UQ_AccBrandErpTargetSetting_Brand]
  ON [dbo].[AccBrandErpTargetSetting] ([FormCode], [BrandCode]);

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_AccBrandErpTargetSetting_FormCode'
    AND object_id = OBJECT_ID('dbo.AccBrandErpTargetSetting')
)
  CREATE INDEX [IX_AccBrandErpTargetSetting_FormCode]
    ON [dbo].[AccBrandErpTargetSetting] ([FormCode], [BrandCode]);

PRINT 'AccBrandErpTargetSetting: rows defaulted to NULL; UQ_AccBrandErpTargetSetting_Brand now (FormCode, BrandCode).';
GO

-- ===========================================================================
-- 3/6  AccBrandGlAccount -- column, data and lookup index already present in
--      both databases; this is where the three 'AP-1' rows become defaults.
-- ===========================================================================
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.AccBrandGlAccount') AND name = 'FormCode'
)
BEGIN
  ALTER TABLE [dbo].[AccBrandGlAccount] ADD [FormCode] NVARCHAR(20) NULL;
  PRINT 'AccBrandGlAccount: FormCode added.';
END
ELSE
  PRINT 'AccBrandGlAccount: FormCode already present.';
GO

UPDATE [dbo].[AccBrandGlAccount] SET [FormCode] = NULL WHERE [FormCode] IS NOT NULL;

IF EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UQ_AccBrandGlAccount'
    AND object_id = OBJECT_ID('dbo.AccBrandGlAccount')
    AND is_unique_constraint = 1
)
  ALTER TABLE [dbo].[AccBrandGlAccount] DROP CONSTRAINT [UQ_AccBrandGlAccount];
ELSE IF EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UQ_AccBrandGlAccount'
    AND object_id = OBJECT_ID('dbo.AccBrandGlAccount')
)
  DROP INDEX [UQ_AccBrandGlAccount] ON [dbo].[AccBrandGlAccount];

CREATE UNIQUE INDEX [UQ_AccBrandGlAccount]
  ON [dbo].[AccBrandGlAccount] ([FormCode], [BrandCode], [AccountNo]);

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_AccBrandGlAccount_FormCode'
    AND object_id = OBJECT_ID('dbo.AccBrandGlAccount')
)
  CREATE INDEX [IX_AccBrandGlAccount_FormCode]
    ON [dbo].[AccBrandGlAccount] ([FormCode], [BrandCode], [IsActive], [SortOrder]);

PRINT 'AccBrandGlAccount: rows defaulted to NULL; UQ_AccBrandGlAccount now (FormCode, BrandCode, AccountNo).';
GO

-- ===========================================================================
-- 4/6  AccBrandBankAccount -- column exists in Rocks_Portal_Form_UAT only
-- ===========================================================================
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.AccBrandBankAccount') AND name = 'FormCode'
)
BEGIN
  ALTER TABLE [dbo].[AccBrandBankAccount] ADD [FormCode] NVARCHAR(20) NULL;
  PRINT 'AccBrandBankAccount: FormCode added.';
END
ELSE
  PRINT 'AccBrandBankAccount: FormCode already present.';
GO

UPDATE [dbo].[AccBrandBankAccount] SET [FormCode] = NULL WHERE [FormCode] IS NOT NULL;

IF EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UQ_AccBrandBankAccount'
    AND object_id = OBJECT_ID('dbo.AccBrandBankAccount')
    AND is_unique_constraint = 1
)
  ALTER TABLE [dbo].[AccBrandBankAccount] DROP CONSTRAINT [UQ_AccBrandBankAccount];
ELSE IF EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UQ_AccBrandBankAccount'
    AND object_id = OBJECT_ID('dbo.AccBrandBankAccount')
)
  DROP INDEX [UQ_AccBrandBankAccount] ON [dbo].[AccBrandBankAccount];

CREATE UNIQUE INDEX [UQ_AccBrandBankAccount]
  ON [dbo].[AccBrandBankAccount] ([FormCode], [BrandCode], [AccountNo]);

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_AccBrandBankAccount_FormCode'
    AND object_id = OBJECT_ID('dbo.AccBrandBankAccount')
)
  CREATE INDEX [IX_AccBrandBankAccount_FormCode]
    ON [dbo].[AccBrandBankAccount] ([FormCode], [BrandCode], [IsActive], [SortOrder]);

PRINT 'AccBrandBankAccount: rows defaulted to NULL; UQ_AccBrandBankAccount now (FormCode, BrandCode, AccountNo).';
GO

-- ===========================================================================
-- 5/6  AccBrandJournalBatch -- column exists in Rocks_Portal_Form_UAT only
-- ===========================================================================
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.AccBrandJournalBatch') AND name = 'FormCode'
)
BEGIN
  ALTER TABLE [dbo].[AccBrandJournalBatch] ADD [FormCode] NVARCHAR(20) NULL;
  PRINT 'AccBrandJournalBatch: FormCode added.';
END
ELSE
  PRINT 'AccBrandJournalBatch: FormCode already present.';
GO

UPDATE [dbo].[AccBrandJournalBatch] SET [FormCode] = NULL WHERE [FormCode] IS NOT NULL;

IF EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UQ_AccBrandJournalBatch'
    AND object_id = OBJECT_ID('dbo.AccBrandJournalBatch')
    AND is_unique_constraint = 1
)
  ALTER TABLE [dbo].[AccBrandJournalBatch] DROP CONSTRAINT [UQ_AccBrandJournalBatch];
ELSE IF EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UQ_AccBrandJournalBatch'
    AND object_id = OBJECT_ID('dbo.AccBrandJournalBatch')
)
  DROP INDEX [UQ_AccBrandJournalBatch] ON [dbo].[AccBrandJournalBatch];

CREATE UNIQUE INDEX [UQ_AccBrandJournalBatch]
  ON [dbo].[AccBrandJournalBatch] ([FormCode], [BrandCode], [BatchName]);

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_AccBrandJournalBatch_FormCode'
    AND object_id = OBJECT_ID('dbo.AccBrandJournalBatch')
)
  CREATE INDEX [IX_AccBrandJournalBatch_FormCode]
    ON [dbo].[AccBrandJournalBatch] ([FormCode], [BrandCode], [IsActive], [SortOrder]);

PRINT 'AccBrandJournalBatch: rows defaulted to NULL; UQ_AccBrandJournalBatch now (FormCode, BrandCode, BatchName).';
GO

-- ===========================================================================
-- 6/6  AccBrandBranchCode
-- ===========================================================================
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.AccBrandBranchCode') AND name = 'FormCode'
)
BEGIN
  ALTER TABLE [dbo].[AccBrandBranchCode] ADD [FormCode] NVARCHAR(20) NULL;
  PRINT 'AccBrandBranchCode: FormCode added.';
END
ELSE
  PRINT 'AccBrandBranchCode: FormCode already present.';
GO

UPDATE [dbo].[AccBrandBranchCode] SET [FormCode] = NULL WHERE [FormCode] IS NOT NULL;

IF EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UQ_AccBrandBranchCode'
    AND object_id = OBJECT_ID('dbo.AccBrandBranchCode')
    AND is_unique_constraint = 1
)
  ALTER TABLE [dbo].[AccBrandBranchCode] DROP CONSTRAINT [UQ_AccBrandBranchCode];
ELSE IF EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UQ_AccBrandBranchCode'
    AND object_id = OBJECT_ID('dbo.AccBrandBranchCode')
)
  DROP INDEX [UQ_AccBrandBranchCode] ON [dbo].[AccBrandBranchCode];

CREATE UNIQUE INDEX [UQ_AccBrandBranchCode]
  ON [dbo].[AccBrandBranchCode] ([FormCode], [BrandCode], [BranchCode]);

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_AccBrandBranchCode_FormCode'
    AND object_id = OBJECT_ID('dbo.AccBrandBranchCode')
)
  CREATE INDEX [IX_AccBrandBranchCode_FormCode]
    ON [dbo].[AccBrandBranchCode] ([FormCode], [BrandCode], [IsActive], [SortOrder]);

PRINT 'AccBrandBranchCode: rows defaulted to NULL; UQ_AccBrandBranchCode now (FormCode, BrandCode, BranchCode).';
GO

PRINT '=== Migration 097 complete: six tables carry FormCode, every row a default (NULL). ===';
GO
