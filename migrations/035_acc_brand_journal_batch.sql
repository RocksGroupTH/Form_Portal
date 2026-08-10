-- =============================================
-- Migration: AP-1 brand ERP General Journal Batch selection
-- Database: Fast_Form
-- Apply: npm run apply-sql -- --db Fast_Form --file migrations/035_acc_brand_journal_batch.sql
-- =============================================

USE [Fast_Form];
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AccBrandJournalBatch')
BEGIN
  CREATE TABLE [dbo].[AccBrandJournalBatch] (
    [Id]              INT            IDENTITY(1,1) NOT NULL,
    [BrandCode]       NVARCHAR(20)   NOT NULL,
    [BatchName]       NVARCHAR(50)   NOT NULL,
    [DisplayName]     NVARCHAR(200)  NULL,
    [IsActive]        BIT            NOT NULL CONSTRAINT [DF_AccBrandJournalBatch_IsActive] DEFAULT (1),
    [SortOrder]       INT            NOT NULL CONSTRAINT [DF_AccBrandJournalBatch_SortOrder] DEFAULT (0),
    [CreatedBy]       INT            NULL,
    [CreatedAt]       DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
    [UpdatedAt]       DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT [PK_AccBrandJournalBatch] PRIMARY KEY ([Id]),
    CONSTRAINT [UQ_AccBrandJournalBatch] UNIQUE ([BrandCode], [BatchName])
  );

  CREATE INDEX [IX_AccBrandJournalBatch_Brand]
    ON [dbo].[AccBrandJournalBatch]([BrandCode], [IsActive], [SortOrder]);

  PRINT 'Created AccBrandJournalBatch';
END
ELSE PRINT 'AccBrandJournalBatch already exists — skipping';
GO

PRINT '=== Migration 035 complete ===';
GO
