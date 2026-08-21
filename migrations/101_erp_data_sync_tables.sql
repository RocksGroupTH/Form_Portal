-- The five Business Central sync tables move into their own database.
--
-- Apply with (Rocks_ERP_Data ONLY):
--   npm run apply-sql -- --db Rocks_ERP_Data --file migrations/101_erp_data_sync_tables.sql
--
-- Then, and only then, apply 102 to Fast_Data. 102 drops the originals.
--
-- ---------------------------------------------------------------------------
-- These five are a MIRROR OF BUSINESS CENTRAL: which G/L accounts, dimension
-- values, journal batches and bank account cards exist over there, plus the log
-- of each sync run. They are not this application's configuration -- nothing in
-- them is a decision anybody here made. That is the line: data synced FROM BC
-- lives here; the per-brand and per-form choices this app makes
-- (AccBrandGlAccount, AccBrandJournalBatch, AccBrandBankAccount, ...) stay in
-- Rocks_Portal_Form. See
-- docs/superpowers/specs/2026-08-21-erp-sync-data-move-design.md section 1.
--
-- SINGLE COPY each. Not created in any _UAT database, not dual-written, not in
-- MASTER_TABLES. Fast_Data has no UAT twin, and there is no second version of
-- what Business Central holds to test against.
--
-- TWO DELIBERATE DEPARTURES FROM THE SOURCE SHAPE, both safe and both stated
-- here rather than hidden:
--   1. UQ_ErpAccounts, UQ_ErpDimensionValue, UQ_ErpGeneralJournalBatch and
--      UQ_ErpBankAccountCard are UNIQUE CONSTRAINTS in Fast_Data, not plain
--      unique indexes, and are recreated as constraints below. They are
--      different objects: DROP INDEX against a unique constraint raises
--      Msg 3723, which is what caught migration 097.
--   2. Default constraints are all named DF_<Table>_<Column> here. In Fast_Data
--      some are and some are auto-generated. Nothing references one by name.
--
-- Batch 3 is an ID-KEYED MERGE (insert new ids, update existing ones), not a
-- copy that skips a non-empty target: a re-run reconciles both what a sync
-- added and what it changed since. That is the remedy when 102 refuses
-- because a sync ran between the two migrations -- every BC sync in
-- src/lib/erp/account-sync.ts and dimension-sync.ts both inserts new rows and
-- updates existing ones (SyncedAt on every match, IsActive on the rows BC no
-- longer returns), so an insert-only top-up could never have fixed that; see
-- the note at batch 3 itself.
-- ---------------------------------------------------------------------------

SET NOCOUNT ON;

IF DB_NAME() <> N'Rocks_ERP_Data'
BEGIN
  DECLARE @wrongDb NVARCHAR(128) = DB_NAME();
  RAISERROR (
    'Migration 101 may only be applied to Rocks_ERP_Data. Current database is %s.',
    16, 1, @wrongDb
  );
END
ELSE
BEGIN
  SET XACT_ABORT ON;
  BEGIN TRANSACTION;

  IF OBJECT_ID('dbo.ErpAccounts', 'U') IS NULL
  CREATE TABLE [dbo].[ErpAccounts] (
    [Id] INT IDENTITY(1,1) NOT NULL,
    [BrandCode] NVARCHAR(20) NOT NULL,
    [BcCompanyId] NVARCHAR(50) NOT NULL,
    [BcConnectionId] INT NOT NULL,
    [AccountCategory] NVARCHAR(20) NOT NULL,
    [AccountNo] NVARCHAR(50) NOT NULL,
    [DisplayName] NVARCHAR(200) NULL,
    [BcCategory] NVARCHAR(50) NULL,
    [IsBlocked] BIT NOT NULL CONSTRAINT [DF_ErpAccounts_IsBlocked] DEFAULT ((0)),
    [IsActive] BIT NOT NULL CONSTRAINT [DF_ErpAccounts_IsActive] DEFAULT ((1)),
    [SyncedAt] DATETIME2(7) NOT NULL CONSTRAINT [DF_ErpAccounts_SyncedAt] DEFAULT (sysdatetime()),
    [RawJson] NVARCHAR(MAX) NULL,
    CONSTRAINT [PK_ErpAccounts] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [UQ_ErpAccounts] UNIQUE ([BrandCode], [AccountCategory], [AccountNo])
  );

  IF OBJECT_ID('dbo.ErpDimensionValue', 'U') IS NULL
  CREATE TABLE [dbo].[ErpDimensionValue] (
    [Id] INT IDENTITY(1,1) NOT NULL,
    [BrandCode] NVARCHAR(20) NOT NULL,
    [DimensionCode] NVARCHAR(50) NOT NULL,
    [Code] NVARCHAR(50) NOT NULL,
    [DisplayName] NVARCHAR(200) NULL,
    [IsBlocked] BIT NOT NULL CONSTRAINT [DF_ErpDimensionValue_IsBlocked] DEFAULT ((0)),
    [IsActive] BIT NOT NULL CONSTRAINT [DF_ErpDimensionValue_IsActive] DEFAULT ((1)),
    [BcLastModified] DATETIME2(7) NULL,
    [SyncedAt] DATETIME2(7) NOT NULL CONSTRAINT [DF_ErpDimensionValue_SyncedAt] DEFAULT (sysdatetime()),
    [RawJson] NVARCHAR(MAX) NULL,
    CONSTRAINT [PK_ErpDimensionValue] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [UQ_ErpDimensionValue] UNIQUE ([BrandCode], [DimensionCode], [Code])
  );

  IF OBJECT_ID('dbo.ErpGeneralJournalBatch', 'U') IS NULL
  CREATE TABLE [dbo].[ErpGeneralJournalBatch] (
    [Id] INT IDENTITY(1,1) NOT NULL,
    [BrandCode] NVARCHAR(20) NOT NULL,
    [BcCompanyId] NVARCHAR(50) NOT NULL,
    [BcCompanyName] NVARCHAR(200) NULL,
    [BcConnectionId] INT NOT NULL,
    [BatchName] NVARCHAR(50) NOT NULL,
    [DisplayName] NVARCHAR(200) NULL,
    [TemplateName] NVARCHAR(100) NULL,
    [IsBlocked] BIT NOT NULL CONSTRAINT [DF_ErpGeneralJournalBatch_IsBlocked] DEFAULT ((0)),
    [IsActive] BIT NOT NULL CONSTRAINT [DF_ErpGeneralJournalBatch_IsActive] DEFAULT ((1)),
    [SyncedAt] DATETIME2(7) NOT NULL CONSTRAINT [DF_ErpGeneralJournalBatch_SyncedAt] DEFAULT (sysdatetime()),
    [RawJson] NVARCHAR(MAX) NULL,
    CONSTRAINT [PK_ErpGeneralJournalBatch] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [UQ_ErpGeneralJournalBatch] UNIQUE ([BrandCode], [BatchName])
  );

  IF OBJECT_ID('dbo.ErpBankAccountCard', 'U') IS NULL
  CREATE TABLE [dbo].[ErpBankAccountCard] (
    [Id] INT IDENTITY(1,1) NOT NULL,
    [BrandCode] NVARCHAR(20) NOT NULL,
    [BcCompanyId] NVARCHAR(50) NOT NULL,
    [BcCompanyName] NVARCHAR(200) NULL,
    [BcConnectionId] INT NOT NULL,
    [AccountNo] NVARCHAR(50) NOT NULL,
    [DisplayName] NVARCHAR(200) NULL,
    [BankName] NVARCHAR(200) NULL,
    [CurrencyCode] NVARCHAR(10) NULL,
    [IsBlocked] BIT NOT NULL CONSTRAINT [DF_ErpBankAccountCard_IsBlocked] DEFAULT ((0)),
    [IsActive] BIT NOT NULL CONSTRAINT [DF_ErpBankAccountCard_IsActive] DEFAULT ((1)),
    [SyncedAt] DATETIME2(7) NOT NULL CONSTRAINT [DF_ErpBankAccountCard_SyncedAt] DEFAULT (sysdatetime()),
    [RawJson] NVARCHAR(MAX) NULL,
    CONSTRAINT [PK_ErpBankAccountCard] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [UQ_ErpBankAccountCard] UNIQUE ([BrandCode], [AccountNo])
  );

  IF OBJECT_ID('dbo.ErpSyncLog', 'U') IS NULL
  CREATE TABLE [dbo].[ErpSyncLog] (
    [Id] INT IDENTITY(1,1) NOT NULL,
    [SyncType] NVARCHAR(50) NOT NULL,
    [BrandCode] NVARCHAR(20) NOT NULL,
    [Status] NVARCHAR(20) NOT NULL,
    [RowsUpserted] INT NOT NULL CONSTRAINT [DF_ErpSyncLog_RowsUpserted] DEFAULT ((0)),
    [ErrorMessage] NVARCHAR(MAX) NULL,
    [StartedAt] DATETIME2(7) NOT NULL CONSTRAINT [DF_ErpSyncLog_StartedAt] DEFAULT (sysdatetime()),
    [FinishedAt] DATETIME2(7) NULL,
    [TriggeredBy] INT NULL,
    CONSTRAINT [PK_ErpSyncLog] PRIMARY KEY CLUSTERED ([Id])
  );

  COMMIT TRANSACTION;
  PRINT 'Batch 1: the five tables exist in Rocks_ERP_Data.';
END
GO

SET NOCOUNT ON;

-- The non-unique lookup indexes, separately so a partial batch 1 is repairable.
IF DB_NAME() <> N'Rocks_ERP_Data'
BEGIN
  DECLARE @wrongDb2 NVARCHAR(128) = DB_NAME();
  RAISERROR ('Migration 101 may only be applied to Rocks_ERP_Data. Current database is %s.', 16, 1, @wrongDb2);
END
ELSE
BEGIN
  IF OBJECT_ID('dbo.ErpAccounts', 'U') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ErpAccounts_BrandCategory' AND object_id = OBJECT_ID('dbo.ErpAccounts'))
    CREATE INDEX [IX_ErpAccounts_BrandCategory] ON [dbo].[ErpAccounts] ([BrandCode], [AccountCategory])
      INCLUDE ([AccountNo], [DisplayName], [IsActive], [IsBlocked]);

  IF OBJECT_ID('dbo.ErpDimensionValue', 'U') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ErpDimensionValue_BrandDim' AND object_id = OBJECT_ID('dbo.ErpDimensionValue'))
    CREATE INDEX [IX_ErpDimensionValue_BrandDim] ON [dbo].[ErpDimensionValue] ([BrandCode], [DimensionCode])
      INCLUDE ([Code], [DisplayName], [IsActive]);

  IF OBJECT_ID('dbo.ErpGeneralJournalBatch', 'U') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ErpGeneralJournalBatch_Brand' AND object_id = OBJECT_ID('dbo.ErpGeneralJournalBatch'))
    CREATE INDEX [IX_ErpGeneralJournalBatch_Brand] ON [dbo].[ErpGeneralJournalBatch] ([BrandCode])
      INCLUDE ([BatchName], [DisplayName], [IsActive], [IsBlocked]);

  IF OBJECT_ID('dbo.ErpBankAccountCard', 'U') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ErpBankAccountCard_Brand' AND object_id = OBJECT_ID('dbo.ErpBankAccountCard'))
    CREATE INDEX [IX_ErpBankAccountCard_Brand] ON [dbo].[ErpBankAccountCard] ([BrandCode])
      INCLUDE ([AccountNo], [DisplayName], [IsActive], [IsBlocked]);

  IF OBJECT_ID('dbo.ErpSyncLog', 'U') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ErpSyncLog_BrandStarted' AND object_id = OBJECT_ID('dbo.ErpSyncLog'))
    CREATE INDEX [IX_ErpSyncLog_BrandStarted] ON [dbo].[ErpSyncLog] ([BrandCode], [StartedAt] DESC);

  PRINT 'Batch 2: lookup indexes present.';
END
GO

SET NOCOUNT ON;

-- The id-keyed MERGE (insert-or-update). Reads Fast_Data three-part, so it
-- only works while Fast_Data still holds real tables -- after 102 they are
-- synonyms pointing back here, and OBJECT_ID(..., 'U') is NULL for a synonym.
--
-- MERGE, not INSERT ... WHERE NOT EXISTS: every BC sync
-- (src/lib/erp/account-sync.ts, dimension-sync.ts) both inserts rows BC added
-- AND updates rows already present -- WHEN MATCHED THEN UPDATE SET ...,
-- SyncedAt = SYSDATETIME() on every successful match, plus a separate
-- UPDATE ... SET IsActive = 0 WHERE SyncedAt < @cutoff for rows BC stopped
-- returning. An insert-only top-up would touch neither: if a sync ran between
-- 101 and 102, 102's content check would keep finding SyncedAt or IsActive
-- different and REFUSE forever, looping while holding TABLOCKX on five tables
-- three applications write -- and if that sync found no new BC objects, the
-- row counts would even stay equal, so it would not look like anything needed
-- topping up. Matched on [Id] alone, updating every non-key column, so a
-- re-run reconciles both new and changed rows.
--
-- No WHEN NOT MATCHED BY SOURCE: a row present here and absent from
-- Fast_Data must not be silently deleted by this migration -- that is what
-- 102's row-count check exists to catch and refuse on, not something batch 3
-- should resolve unilaterally by deleting.
IF DB_NAME() <> N'Rocks_ERP_Data'
BEGIN
  DECLARE @wrongDb3 NVARCHAR(128) = DB_NAME();
  RAISERROR ('Migration 101 may only be applied to Rocks_ERP_Data. Current database is %s.', 16, 1, @wrongDb3);
END
ELSE IF OBJECT_ID('[Fast_Data].[dbo].[ErpAccounts]', 'U') IS NULL
BEGIN
  RAISERROR (
    'Migration 101 batch 3: [Fast_Data].[dbo].[ErpAccounts] is not a table. If migration 102 has already run it is a synonym pointing back here, and there is nothing to copy.',
    16, 1
  );
END
ELSE
BEGIN
  SET XACT_ABORT ON;
  BEGIN TRANSACTION;

  SET IDENTITY_INSERT [dbo].[ErpAccounts] ON;
  MERGE INTO [dbo].[ErpAccounts] AS t
  USING [Fast_Data].[dbo].[ErpAccounts] AS s
    ON t.[Id] = s.[Id]
  WHEN MATCHED THEN UPDATE SET
    t.[BrandCode] = s.[BrandCode], t.[BcCompanyId] = s.[BcCompanyId],
    t.[BcConnectionId] = s.[BcConnectionId], t.[AccountCategory] = s.[AccountCategory],
    t.[AccountNo] = s.[AccountNo], t.[DisplayName] = s.[DisplayName],
    t.[BcCategory] = s.[BcCategory], t.[IsBlocked] = s.[IsBlocked],
    t.[IsActive] = s.[IsActive], t.[SyncedAt] = s.[SyncedAt], t.[RawJson] = s.[RawJson]
  WHEN NOT MATCHED BY TARGET THEN
    INSERT ([Id],[BrandCode],[BcCompanyId],[BcConnectionId],[AccountCategory],[AccountNo],
            [DisplayName],[BcCategory],[IsBlocked],[IsActive],[SyncedAt],[RawJson])
    VALUES (s.[Id],s.[BrandCode],s.[BcCompanyId],s.[BcConnectionId],s.[AccountCategory],s.[AccountNo],
            s.[DisplayName],s.[BcCategory],s.[IsBlocked],s.[IsActive],s.[SyncedAt],s.[RawJson]);
  SET IDENTITY_INSERT [dbo].[ErpAccounts] OFF;

  SET IDENTITY_INSERT [dbo].[ErpDimensionValue] ON;
  MERGE INTO [dbo].[ErpDimensionValue] AS t
  USING [Fast_Data].[dbo].[ErpDimensionValue] AS s
    ON t.[Id] = s.[Id]
  WHEN MATCHED THEN UPDATE SET
    t.[BrandCode] = s.[BrandCode], t.[DimensionCode] = s.[DimensionCode], t.[Code] = s.[Code],
    t.[DisplayName] = s.[DisplayName], t.[IsBlocked] = s.[IsBlocked], t.[IsActive] = s.[IsActive],
    t.[BcLastModified] = s.[BcLastModified], t.[SyncedAt] = s.[SyncedAt], t.[RawJson] = s.[RawJson]
  WHEN NOT MATCHED BY TARGET THEN
    INSERT ([Id],[BrandCode],[DimensionCode],[Code],[DisplayName],[IsBlocked],[IsActive],
            [BcLastModified],[SyncedAt],[RawJson])
    VALUES (s.[Id],s.[BrandCode],s.[DimensionCode],s.[Code],s.[DisplayName],s.[IsBlocked],s.[IsActive],
            s.[BcLastModified],s.[SyncedAt],s.[RawJson]);
  SET IDENTITY_INSERT [dbo].[ErpDimensionValue] OFF;

  SET IDENTITY_INSERT [dbo].[ErpGeneralJournalBatch] ON;
  MERGE INTO [dbo].[ErpGeneralJournalBatch] AS t
  USING [Fast_Data].[dbo].[ErpGeneralJournalBatch] AS s
    ON t.[Id] = s.[Id]
  WHEN MATCHED THEN UPDATE SET
    t.[BrandCode] = s.[BrandCode], t.[BcCompanyId] = s.[BcCompanyId], t.[BcCompanyName] = s.[BcCompanyName],
    t.[BcConnectionId] = s.[BcConnectionId], t.[BatchName] = s.[BatchName], t.[DisplayName] = s.[DisplayName],
    t.[TemplateName] = s.[TemplateName], t.[IsBlocked] = s.[IsBlocked], t.[IsActive] = s.[IsActive],
    t.[SyncedAt] = s.[SyncedAt], t.[RawJson] = s.[RawJson]
  WHEN NOT MATCHED BY TARGET THEN
    INSERT ([Id],[BrandCode],[BcCompanyId],[BcCompanyName],[BcConnectionId],[BatchName],
            [DisplayName],[TemplateName],[IsBlocked],[IsActive],[SyncedAt],[RawJson])
    VALUES (s.[Id],s.[BrandCode],s.[BcCompanyId],s.[BcCompanyName],s.[BcConnectionId],s.[BatchName],
            s.[DisplayName],s.[TemplateName],s.[IsBlocked],s.[IsActive],s.[SyncedAt],s.[RawJson]);
  SET IDENTITY_INSERT [dbo].[ErpGeneralJournalBatch] OFF;

  SET IDENTITY_INSERT [dbo].[ErpBankAccountCard] ON;
  MERGE INTO [dbo].[ErpBankAccountCard] AS t
  USING [Fast_Data].[dbo].[ErpBankAccountCard] AS s
    ON t.[Id] = s.[Id]
  WHEN MATCHED THEN UPDATE SET
    t.[BrandCode] = s.[BrandCode], t.[BcCompanyId] = s.[BcCompanyId], t.[BcCompanyName] = s.[BcCompanyName],
    t.[BcConnectionId] = s.[BcConnectionId], t.[AccountNo] = s.[AccountNo], t.[DisplayName] = s.[DisplayName],
    t.[BankName] = s.[BankName], t.[CurrencyCode] = s.[CurrencyCode], t.[IsBlocked] = s.[IsBlocked],
    t.[IsActive] = s.[IsActive], t.[SyncedAt] = s.[SyncedAt], t.[RawJson] = s.[RawJson]
  WHEN NOT MATCHED BY TARGET THEN
    INSERT ([Id],[BrandCode],[BcCompanyId],[BcCompanyName],[BcConnectionId],[AccountNo],
            [DisplayName],[BankName],[CurrencyCode],[IsBlocked],[IsActive],[SyncedAt],[RawJson])
    VALUES (s.[Id],s.[BrandCode],s.[BcCompanyId],s.[BcCompanyName],s.[BcConnectionId],s.[AccountNo],
            s.[DisplayName],s.[BankName],s.[CurrencyCode],s.[IsBlocked],s.[IsActive],s.[SyncedAt],s.[RawJson]);
  SET IDENTITY_INSERT [dbo].[ErpBankAccountCard] OFF;

  SET IDENTITY_INSERT [dbo].[ErpSyncLog] ON;
  MERGE INTO [dbo].[ErpSyncLog] AS t
  USING [Fast_Data].[dbo].[ErpSyncLog] AS s
    ON t.[Id] = s.[Id]
  WHEN MATCHED THEN UPDATE SET
    t.[SyncType] = s.[SyncType], t.[BrandCode] = s.[BrandCode], t.[Status] = s.[Status],
    t.[RowsUpserted] = s.[RowsUpserted], t.[ErrorMessage] = s.[ErrorMessage],
    t.[StartedAt] = s.[StartedAt], t.[FinishedAt] = s.[FinishedAt], t.[TriggeredBy] = s.[TriggeredBy]
  WHEN NOT MATCHED BY TARGET THEN
    INSERT ([Id],[SyncType],[BrandCode],[Status],[RowsUpserted],[ErrorMessage],
            [StartedAt],[FinishedAt],[TriggeredBy])
    VALUES (s.[Id],s.[SyncType],s.[BrandCode],s.[Status],s.[RowsUpserted],s.[ErrorMessage],
            s.[StartedAt],s.[FinishedAt],s.[TriggeredBy]);
  SET IDENTITY_INSERT [dbo].[ErpSyncLog] OFF;

  COMMIT TRANSACTION;
  PRINT 'Batch 3: rows reconciled from Fast_Data -- ids missing here inserted, ids already here updated to match, every id preserved throughout.';
END
GO

SET NOCOUNT ON;

-- Reseed outside a transaction: DBCC CHECKIDENT is not transactional.
--
-- This batch is now a FLOOR, not the mechanism that actually reseeds --
-- batch 3's MERGE runs under SET IDENTITY_INSERT ON, and inserting an
-- explicit identity value raises the table's current identity to that value
-- the same way a normal auto-generated insert would, so by the time this
-- batch runs, IDENT_CURRENT is already at least MAX([Id]) for all five
-- tables on every realistic path. The five literals below are each source
-- table's IDENT_CURRENT as measured 2026-08-21 -- a snapshot, not a live
-- figure to keep chasing; do not update them to match a later read. They
-- exist only to guard a pathological case (a table that reached
-- Rocks_ERP_Data some other way, with an identity lower than the literal ids
-- already in Fast_Data), and the `< target` guard means a re-run after later
-- inserts never rewinds a value batch 3 has already moved past.
IF DB_NAME() <> N'Rocks_ERP_Data'
BEGIN
  DECLARE @wrongDb4 NVARCHAR(128) = DB_NAME();
  RAISERROR ('Migration 101 may only be applied to Rocks_ERP_Data. Current database is %s.', 16, 1, @wrongDb4);
END
ELSE
BEGIN
  IF OBJECT_ID('dbo.ErpAccounts', 'U') IS NOT NULL AND IDENT_CURRENT('dbo.ErpAccounts') < 4793
    DBCC CHECKIDENT ('dbo.ErpAccounts', RESEED, 4793);
  IF OBJECT_ID('dbo.ErpDimensionValue', 'U') IS NOT NULL AND IDENT_CURRENT('dbo.ErpDimensionValue') < 806
    DBCC CHECKIDENT ('dbo.ErpDimensionValue', RESEED, 806);
  IF OBJECT_ID('dbo.ErpGeneralJournalBatch', 'U') IS NOT NULL AND IDENT_CURRENT('dbo.ErpGeneralJournalBatch') < 174
    DBCC CHECKIDENT ('dbo.ErpGeneralJournalBatch', RESEED, 174);
  IF OBJECT_ID('dbo.ErpBankAccountCard', 'U') IS NOT NULL AND IDENT_CURRENT('dbo.ErpBankAccountCard') < 64
    DBCC CHECKIDENT ('dbo.ErpBankAccountCard', RESEED, 64);
  IF OBJECT_ID('dbo.ErpSyncLog', 'U') IS NOT NULL AND IDENT_CURRENT('dbo.ErpSyncLog') < 21
    DBCC CHECKIDENT ('dbo.ErpSyncLog', RESEED, 21);
  PRINT 'Batch 4: identity floor checked (a no-op on every realistic path -- see the comment above).';
END
GO
