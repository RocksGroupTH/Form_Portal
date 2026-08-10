-- =============================================
-- Migration: BrandConfig — BcId / BcName (per brand, not BcConnection FK)
-- Database: Fast_Core
-- Aligns with: BrandCode, BcId, BcName, DbConnectionId, DatabaseName, ...
-- =============================================

USE [Fast_Core];
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.BrandConfig') AND name = N'BcId'
)
BEGIN
    ALTER TABLE [dbo].[BrandConfig] ADD [BcId] NVARCHAR(MAX) NULL;
    PRINT 'Added BrandConfig.BcId';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.BrandConfig') AND name = N'BcName'
)
BEGIN
    ALTER TABLE [dbo].[BrandConfig] ADD [BcName] NVARCHAR(MAX) NULL;
    PRINT 'Added BrandConfig.BcName';
END
GO

-- Migrate CompanyId/CompanyName if present from older scripts
IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.BrandConfig') AND name = N'CompanyId'
)
BEGIN
    UPDATE [dbo].[BrandConfig]
    SET [BcId] = COALESCE([BcId], [CompanyId])
    WHERE [CompanyId] IS NOT NULL;
    ALTER TABLE [dbo].[BrandConfig] DROP COLUMN [CompanyId];
    PRINT 'Migrated CompanyId -> BcId and dropped CompanyId';
END
GO

IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.BrandConfig') AND name = N'CompanyName'
)
BEGIN
    UPDATE [dbo].[BrandConfig]
    SET [BcName] = COALESCE([BcName], [CompanyName])
    WHERE [CompanyName] IS NOT NULL;
    ALTER TABLE [dbo].[BrandConfig] DROP COLUMN [CompanyName];
    PRINT 'Migrated CompanyName -> BcName and dropped CompanyName';
END
GO

IF EXISTS (
    SELECT 1 FROM sys.foreign_keys
    WHERE name = N'FK_BrandConfig_Bc' AND parent_object_id = OBJECT_ID(N'dbo.BrandConfig')
)
BEGIN
    ALTER TABLE [dbo].[BrandConfig] DROP CONSTRAINT [FK_BrandConfig_Bc];
    PRINT 'Dropped FK_BrandConfig_Bc';
END
GO

IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.BrandConfig') AND name = N'BcConnectionId'
)
BEGIN
    ALTER TABLE [dbo].[BrandConfig] DROP COLUMN [BcConnectionId];
    PRINT 'Dropped BrandConfig.BcConnectionId';
END
GO
