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
-- Batch 2 is an ID-KEYED TOP-UP, not a copy that skips a non-empty target: a
-- re-run inserts only the ids the target lacks. That is the remedy when 102
-- refuses because a sync ran between the two migrations.
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

-- The id-keyed top-up. Reads Fast_Data three-part, so it only works while
-- Fast_Data still holds real tables -- after 102 they are synonyms pointing
-- back here, and OBJECT_ID(..., 'U') is NULL for a synonym.
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
  INSERT INTO [dbo].[ErpAccounts]
    ([Id],[BrandCode],[BcCompanyId],[BcConnectionId],[AccountCategory],[AccountNo],
     [DisplayName],[BcCategory],[IsBlocked],[IsActive],[SyncedAt],[RawJson])
  SELECT s.[Id],s.[BrandCode],s.[BcCompanyId],s.[BcConnectionId],s.[AccountCategory],s.[AccountNo],
         s.[DisplayName],s.[BcCategory],s.[IsBlocked],s.[IsActive],s.[SyncedAt],s.[RawJson]
  FROM [Fast_Data].[dbo].[ErpAccounts] s
  WHERE NOT EXISTS (SELECT 1 FROM [dbo].[ErpAccounts] t WHERE t.[Id] = s.[Id]);
  SET IDENTITY_INSERT [dbo].[ErpAccounts] OFF;

  SET IDENTITY_INSERT [dbo].[ErpDimensionValue] ON;
  INSERT INTO [dbo].[ErpDimensionValue]
    ([Id],[BrandCode],[DimensionCode],[Code],[DisplayName],[IsBlocked],[IsActive],
     [BcLastModified],[SyncedAt],[RawJson])
  SELECT s.[Id],s.[BrandCode],s.[DimensionCode],s.[Code],s.[DisplayName],s.[IsBlocked],s.[IsActive],
         s.[BcLastModified],s.[SyncedAt],s.[RawJson]
  FROM [Fast_Data].[dbo].[ErpDimensionValue] s
  WHERE NOT EXISTS (SELECT 1 FROM [dbo].[ErpDimensionValue] t WHERE t.[Id] = s.[Id]);
  SET IDENTITY_INSERT [dbo].[ErpDimensionValue] OFF;

  SET IDENTITY_INSERT [dbo].[ErpGeneralJournalBatch] ON;
  INSERT INTO [dbo].[ErpGeneralJournalBatch]
    ([Id],[BrandCode],[BcCompanyId],[BcCompanyName],[BcConnectionId],[BatchName],
     [DisplayName],[TemplateName],[IsBlocked],[IsActive],[SyncedAt],[RawJson])
  SELECT s.[Id],s.[BrandCode],s.[BcCompanyId],s.[BcCompanyName],s.[BcConnectionId],s.[BatchName],
         s.[DisplayName],s.[TemplateName],s.[IsBlocked],s.[IsActive],s.[SyncedAt],s.[RawJson]
  FROM [Fast_Data].[dbo].[ErpGeneralJournalBatch] s
  WHERE NOT EXISTS (SELECT 1 FROM [dbo].[ErpGeneralJournalBatch] t WHERE t.[Id] = s.[Id]);
  SET IDENTITY_INSERT [dbo].[ErpGeneralJournalBatch] OFF;

  SET IDENTITY_INSERT [dbo].[ErpBankAccountCard] ON;
  INSERT INTO [dbo].[ErpBankAccountCard]
    ([Id],[BrandCode],[BcCompanyId],[BcCompanyName],[BcConnectionId],[AccountNo],
     [DisplayName],[BankName],[CurrencyCode],[IsBlocked],[IsActive],[SyncedAt],[RawJson])
  SELECT s.[Id],s.[BrandCode],s.[BcCompanyId],s.[BcCompanyName],s.[BcConnectionId],s.[AccountNo],
         s.[DisplayName],s.[BankName],s.[CurrencyCode],s.[IsBlocked],s.[IsActive],s.[SyncedAt],s.[RawJson]
  FROM [Fast_Data].[dbo].[ErpBankAccountCard] s
  WHERE NOT EXISTS (SELECT 1 FROM [dbo].[ErpBankAccountCard] t WHERE t.[Id] = s.[Id]);
  SET IDENTITY_INSERT [dbo].[ErpBankAccountCard] OFF;

  SET IDENTITY_INSERT [dbo].[ErpSyncLog] ON;
  INSERT INTO [dbo].[ErpSyncLog]
    ([Id],[SyncType],[BrandCode],[Status],[RowsUpserted],[ErrorMessage],
     [StartedAt],[FinishedAt],[TriggeredBy])
  SELECT s.[Id],s.[SyncType],s.[BrandCode],s.[Status],s.[RowsUpserted],s.[ErrorMessage],
         s.[StartedAt],s.[FinishedAt],s.[TriggeredBy]
  FROM [Fast_Data].[dbo].[ErpSyncLog] s
  WHERE NOT EXISTS (SELECT 1 FROM [dbo].[ErpSyncLog] t WHERE t.[Id] = s.[Id]);
  SET IDENTITY_INSERT [dbo].[ErpSyncLog] OFF;

  COMMIT TRANSACTION;
  PRINT 'Batch 3: rows topped up from Fast_Data with their ids preserved.';
END
GO

SET NOCOUNT ON;

-- Reseed outside a transaction: DBCC CHECKIDENT is not transactional. Each
-- target is the source's IDENT_CURRENT as measured 2026-08-21; the guard means
-- a re-run after later inserts never rewinds.
IF DB_NAME() = N'Rocks_ERP_Data'
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
  PRINT 'Batch 4: identities reseeded.';
END
GO
