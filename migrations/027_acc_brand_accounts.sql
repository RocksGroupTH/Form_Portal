-- =============================================
-- Migration: AP-1 brand G/L & Bank account numbers
-- Database: Fast_Form
-- Apply: npm run apply-sql -- --db Fast_Form --file migrations/027_acc_brand_accounts.sql
-- =============================================

USE [Fast_Form];
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AccBrandGlAccount')
BEGIN
  CREATE TABLE [dbo].[AccBrandGlAccount] (
    [Id]          INT            IDENTITY(1,1) NOT NULL,
    [BrandCode]   NVARCHAR(20)   NOT NULL,
    [AccountNo]   NVARCHAR(50)   NOT NULL,
    [DisplayName] NVARCHAR(200)  NULL,
    [IsActive]    BIT            NOT NULL CONSTRAINT [DF_AccBrandGlAccount_IsActive] DEFAULT (1),
    [SortOrder]   INT            NOT NULL CONSTRAINT [DF_AccBrandGlAccount_SortOrder] DEFAULT (0),
    [CreatedBy]   INT            NULL,
    [CreatedAt]   DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
    [UpdatedAt]   DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT [PK_AccBrandGlAccount] PRIMARY KEY ([Id]),
    CONSTRAINT [UQ_AccBrandGlAccount] UNIQUE ([BrandCode], [AccountNo])
  );

  CREATE INDEX [IX_AccBrandGlAccount_Brand]
    ON [dbo].[AccBrandGlAccount]([BrandCode], [IsActive], [SortOrder]);

  PRINT 'Created AccBrandGlAccount';
END
ELSE PRINT 'AccBrandGlAccount already exists — skipping';
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AccBrandBankAccount')
BEGIN
  CREATE TABLE [dbo].[AccBrandBankAccount] (
    [Id]          INT            IDENTITY(1,1) NOT NULL,
    [BrandCode]   NVARCHAR(20)   NOT NULL,
    [AccountNo]   NVARCHAR(50)   NOT NULL,
    [DisplayName] NVARCHAR(200)  NULL,
    [IsActive]    BIT            NOT NULL CONSTRAINT [DF_AccBrandBankAccount_IsActive] DEFAULT (1),
    [SortOrder]   INT            NOT NULL CONSTRAINT [DF_AccBrandBankAccount_SortOrder] DEFAULT (0),
    [CreatedBy]   INT            NULL,
    [CreatedAt]   DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
    [UpdatedAt]   DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT [PK_AccBrandBankAccount] PRIMARY KEY ([Id]),
    CONSTRAINT [UQ_AccBrandBankAccount] UNIQUE ([BrandCode], [AccountNo])
  );

  CREATE INDEX [IX_AccBrandBankAccount_Brand]
    ON [dbo].[AccBrandBankAccount]([BrandCode], [IsActive], [SortOrder]);

  PRINT 'Created AccBrandBankAccount';
END
ELSE PRINT 'AccBrandBankAccount already exists — skipping';
GO

PRINT '=== Migration 027 complete ===';
GO
