-- =============================================
-- Migration: AP-1 brand ERP Branch Code (dimension BRANCH)
-- Database: Fast_Form
-- Apply: npm run apply-sql -- --db Fast_Form --file migrations/033_acc_brand_branch_code.sql
-- =============================================

USE [Fast_Form];
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AccBrandBranchCode')
BEGIN
  CREATE TABLE [dbo].[AccBrandBranchCode] (
    [Id]          INT            IDENTITY(1,1) NOT NULL,
    [BrandCode]   NVARCHAR(20)   NOT NULL,
    [BranchCode]  NVARCHAR(50)   NOT NULL,
    [DisplayName] NVARCHAR(200)  NULL,
    [IsActive]    BIT            NOT NULL CONSTRAINT [DF_AccBrandBranchCode_IsActive] DEFAULT (1),
    [SortOrder]   INT            NOT NULL CONSTRAINT [DF_AccBrandBranchCode_SortOrder] DEFAULT (0),
    [CreatedBy]   INT            NULL,
    [CreatedAt]   DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
    [UpdatedAt]   DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT [PK_AccBrandBranchCode] PRIMARY KEY ([Id]),
    CONSTRAINT [UQ_AccBrandBranchCode] UNIQUE ([BrandCode], [BranchCode])
  );

  CREATE INDEX [IX_AccBrandBranchCode_Brand]
    ON [dbo].[AccBrandBranchCode]([BrandCode], [IsActive], [SortOrder]);

  PRINT 'Created AccBrandBranchCode';
END
ELSE PRINT 'AccBrandBranchCode already exists — skipping';
GO

PRINT '=== Migration 033 complete ===';
GO
