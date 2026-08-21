-- =============================================
-- Migration: ERP General Journal Batches (BC OData GeneralJournalBatches)
-- Database: Fast_Data
-- Apply: npm run apply-sql -- --db Fast_Data --file migrations/034_fast_data_erp_general_journal_batch.sql
-- =============================================
--
-- HISTORICAL -- already applied. DO NOT RE-RUN: the target moved to
-- Rocks_ERP_Data (migrations 101/102).
--
-- Fast_Data.dbo.ErpGeneralJournalBatch is now a SYNONYM for
-- [Rocks_ERP_Data].[dbo].[ErpGeneralJournalBatch]. A synonym does not appear in
-- sys.tables, so the guard below
-- (IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ErpGeneralJournalBatch'))
-- passes and the CREATE TABLE then fails with Msg 2714, because the synonym
-- already owns the name. Measured 2026-08-21 against the cut-over Fast_Data:
-- "There is already an object named 'ErpGeneralJournalBatch' in the database".
-- Nothing was created.
--
-- Note this file creates ErpGeneralJournalBatch, the mirror of every journal
-- batch Business Central has. It is not AccBrandJournalBatch, which records
-- which of those a brand's claims post to and stays in Rocks_Portal_Form.
--
-- If ErpGeneralJournalBatch ever has to be created again, 101 is the file that
-- does it, against Rocks_ERP_Data.

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
