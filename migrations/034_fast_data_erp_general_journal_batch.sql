-- =============================================
-- Migration: ERP General Journal Batches (BC OData GeneralJournalBatches)
-- Database: Fast_Data
-- Apply: npm run apply-sql -- --db Fast_Data --file migrations/034_fast_data_erp_general_journal_batch.sql
-- =============================================

USE [Fast_Data];
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ErpGeneralJournalBatch')
BEGIN
  CREATE TABLE [dbo].[ErpGeneralJournalBatch] (
    [Id]               INT            IDENTITY(1,1) NOT NULL,
    [BrandCode]        NVARCHAR(20)   NOT NULL,
    [BcCompanyId]      NVARCHAR(50)   NOT NULL,
    [BcCompanyName]    NVARCHAR(200)  NULL,
    [BcConnectionId]   INT            NOT NULL,
    [BatchName]        NVARCHAR(50)   NOT NULL,
    [DisplayName]      NVARCHAR(200)  NULL,
    [TemplateName]     NVARCHAR(100)  NULL,
    [IsBlocked]        BIT            NOT NULL CONSTRAINT [DF_ErpGeneralJournalBatch_IsBlocked] DEFAULT (0),
    [IsActive]         BIT            NOT NULL CONSTRAINT [DF_ErpGeneralJournalBatch_IsActive] DEFAULT (1),
    [SyncedAt]         DATETIME2      NOT NULL CONSTRAINT [DF_ErpGeneralJournalBatch_SyncedAt] DEFAULT SYSDATETIME(),
    [RawJson]          NVARCHAR(MAX)  NULL,
    CONSTRAINT [PK_ErpGeneralJournalBatch] PRIMARY KEY ([Id]),
    CONSTRAINT [UQ_ErpGeneralJournalBatch] UNIQUE ([BrandCode], [BatchName])
  );

  CREATE INDEX [IX_ErpGeneralJournalBatch_Brand]
    ON [dbo].[ErpGeneralJournalBatch]([BrandCode])
    INCLUDE ([BatchName], [DisplayName], [IsActive], [IsBlocked]);

  PRINT 'Created ErpGeneralJournalBatch';
END
ELSE PRINT 'ErpGeneralJournalBatch already exists — skipping';
GO

PRINT '=== Migration 034 complete ===';
GO
