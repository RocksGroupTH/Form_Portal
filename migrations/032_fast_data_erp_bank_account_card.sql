-- =============================================
-- Migration: ERP Bank Account Card (BC OData BankAccountCard snapshot)
-- Database: Fast_Data
-- Apply: npm run apply-sql -- --db Fast_Data --file migrations/032_fast_data_erp_bank_account_card.sql
-- =============================================
--
-- HISTORICAL -- already applied. DO NOT RE-RUN: the target moved to
-- Rocks_ERP_Data (migrations 101/102).
--
-- Fast_Data.dbo.ErpBankAccountCard is now a SYNONYM for
-- [Rocks_ERP_Data].[dbo].[ErpBankAccountCard]. A synonym does not appear in
-- sys.tables, so the guard below
-- (IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ErpBankAccountCard'))
-- passes and the CREATE TABLE then fails with Msg 2714, because the synonym
-- already owns the name. Measured 2026-08-21 against the cut-over Fast_Data:
-- "There is already an object named 'ErpBankAccountCard' in the database".
-- Nothing was created.
--
-- If ErpBankAccountCard ever has to be created again, 101 is the file that does
-- it, against Rocks_ERP_Data.

USE [Fast_Data];
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ErpBankAccountCard')
BEGIN
  CREATE TABLE [dbo].[ErpBankAccountCard] (
    [Id]               INT            IDENTITY(1,1) NOT NULL,
    [BrandCode]        NVARCHAR(20)   NOT NULL,
    [BcCompanyId]      NVARCHAR(50)   NOT NULL,
    [BcCompanyName]    NVARCHAR(200)  NULL,
    [BcConnectionId]   INT            NOT NULL,
    [AccountNo]        NVARCHAR(50)   NOT NULL,
    [DisplayName]      NVARCHAR(200)  NULL,
    [BankName]         NVARCHAR(200)  NULL,
    [CurrencyCode]     NVARCHAR(10)   NULL,
    [IsBlocked]        BIT            NOT NULL CONSTRAINT [DF_ErpBankAccountCard_IsBlocked] DEFAULT (0),
    [IsActive]         BIT            NOT NULL CONSTRAINT [DF_ErpBankAccountCard_IsActive] DEFAULT (1),
    [SyncedAt]         DATETIME2      NOT NULL CONSTRAINT [DF_ErpBankAccountCard_SyncedAt] DEFAULT SYSDATETIME(),
    [RawJson]          NVARCHAR(MAX)  NULL,
    CONSTRAINT [PK_ErpBankAccountCard] PRIMARY KEY ([Id]),
    CONSTRAINT [UQ_ErpBankAccountCard] UNIQUE ([BrandCode], [AccountNo])
  );

  CREATE INDEX [IX_ErpBankAccountCard_Brand]
    ON [dbo].[ErpBankAccountCard]([BrandCode])
    INCLUDE ([AccountNo], [DisplayName], [IsActive], [IsBlocked]);

  PRINT 'Created ErpBankAccountCard';
END
ELSE PRINT 'ErpBankAccountCard already exists — skipping';
GO

PRINT '=== Migration 032 complete ===';
GO
