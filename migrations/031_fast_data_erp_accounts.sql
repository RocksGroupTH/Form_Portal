-- =============================================
-- Migration: ERP G/L & Bank accounts (BC API snapshot)
-- Database: Fast_Data
-- Apply: npm run apply-sql -- --db Fast_Data --file migrations/031_fast_data_erp_accounts.sql
-- =============================================
--
-- HISTORICAL -- already applied. DO NOT RE-RUN: the target moved to
-- Rocks_ERP_Data (migrations 101/102).
--
-- Fast_Data.dbo.ErpAccounts is now a SYNONYM for
-- [Rocks_ERP_Data].[dbo].[ErpAccounts]. A synonym does not appear in
-- sys.tables, so the guard below
-- (IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ErpAccounts')) passes
-- and the CREATE TABLE then fails with Msg 2714, because the synonym already
-- owns the name. Measured 2026-08-21 against the cut-over Fast_Data: "There is
-- already an object named 'ErpAccounts' in the database". Nothing was created.
--
-- If ErpAccounts ever has to be created again, 101 is the file that does it,
-- against Rocks_ERP_Data.

USE [Fast_Data];
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ErpAccounts')
BEGIN
  CREATE TABLE [dbo].[ErpAccounts] (
    [Id]               INT            IDENTITY(1,1) NOT NULL,
    [BrandCode]        NVARCHAR(20)   NOT NULL,
    [BcCompanyId]      NVARCHAR(50)   NOT NULL,
    [BcConnectionId]   INT            NOT NULL,
    [AccountCategory]  NVARCHAR(20)   NOT NULL,
    [AccountNo]        NVARCHAR(50)   NOT NULL,
    [DisplayName]      NVARCHAR(200)  NULL,
    [BcCategory]       NVARCHAR(50)   NULL,
    [IsBlocked]        BIT            NOT NULL CONSTRAINT [DF_ErpAccounts_IsBlocked] DEFAULT (0),
    [IsActive]         BIT            NOT NULL CONSTRAINT [DF_ErpAccounts_IsActive] DEFAULT (1),
    [SyncedAt]         DATETIME2      NOT NULL CONSTRAINT [DF_ErpAccounts_SyncedAt] DEFAULT SYSDATETIME(),
    [RawJson]          NVARCHAR(MAX)  NULL,
    CONSTRAINT [PK_ErpAccounts] PRIMARY KEY ([Id]),
    CONSTRAINT [UQ_ErpAccounts] UNIQUE ([BrandCode], [AccountCategory], [AccountNo])
  );

  CREATE INDEX [IX_ErpAccounts_BrandCategory]
    ON [dbo].[ErpAccounts]([BrandCode], [AccountCategory])
    INCLUDE ([AccountNo], [DisplayName], [IsActive], [IsBlocked]);

  PRINT 'Created ErpAccounts';
END
ELSE PRINT 'ErpAccounts already exists — skipping';
GO

PRINT '=== Migration 031 complete ===';
GO
