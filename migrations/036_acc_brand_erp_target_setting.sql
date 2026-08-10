-- =============================================
-- Migration: AP-1 ERP target group settings (description prefix)
-- Database: Fast_Form
-- Apply: npm run apply-sql -- --db Fast_Form --file migrations/036_acc_brand_erp_target_setting.sql
-- =============================================

USE [Fast_Form];
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AccBrandErpTargetSetting')
BEGIN
  CREATE TABLE [dbo].[AccBrandErpTargetSetting] (
    [Id]                INT            IDENTITY(1,1) NOT NULL,
    [BrandCode]         NVARCHAR(20)   NOT NULL,
    [DescriptionPrefix] NVARCHAR(500)  NULL,
    [CreatedBy]         INT            NULL,
    [CreatedAt]         DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
    [UpdatedAt]         DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT [PK_AccBrandErpTargetSetting] PRIMARY KEY ([Id]),
    CONSTRAINT [UQ_AccBrandErpTargetSetting_Brand] UNIQUE ([BrandCode])
  );

  CREATE INDEX [IX_AccBrandErpTargetSetting_Brand]
    ON [dbo].[AccBrandErpTargetSetting]([BrandCode]);

  PRINT 'Created AccBrandErpTargetSetting';
END
ELSE PRINT 'AccBrandErpTargetSetting already exists — skipping';
GO

PRINT '=== Migration 036 complete ===';
GO
