-- =============================================
-- Migration: BrandConfig — Dashboard SQL target + allow DbConnectionId = 0 (APP_MSSQL)
-- Database: Fast_Core
-- =============================================

USE [Fast_Core];
GO

-- Allow APP_DB_CONNECTION_ID (0) without a DbConnection row
IF EXISTS (
    SELECT 1 FROM sys.foreign_keys
    WHERE name = N'FK_BrandConfig_Db'
      AND parent_object_id = OBJECT_ID(N'dbo.BrandConfig')
)
BEGIN
    ALTER TABLE [dbo].[BrandConfig] DROP CONSTRAINT [FK_BrandConfig_Db];
    PRINT 'Dropped FK_BrandConfig_Db (app may use DbConnectionId = 0 for MSSQL_HOST)';
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.BrandConfig') AND name = N'DashboardDbConnectionId'
)
BEGIN
    ALTER TABLE [dbo].[BrandConfig] ADD [DashboardDbConnectionId] INT NULL;
    PRINT 'Added BrandConfig.DashboardDbConnectionId';
END
ELSE PRINT 'BrandConfig.DashboardDbConnectionId already exists - skipping';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.BrandConfig') AND name = N'DashboardDatabaseName'
)
BEGIN
    ALTER TABLE [dbo].[BrandConfig] ADD [DashboardDatabaseName] NVARCHAR(128) NULL;
    PRINT 'Added BrandConfig.DashboardDatabaseName';
END
ELSE PRINT 'BrandConfig.DashboardDatabaseName already exists - skipping';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_BrandConfig_DashboardDbConnectionId'
      AND object_id = OBJECT_ID(N'dbo.BrandConfig')
)
BEGIN
    CREATE INDEX [IX_BrandConfig_DashboardDbConnectionId]
        ON [dbo].[BrandConfig]([DashboardDbConnectionId]);
    PRINT 'Created IX_BrandConfig_DashboardDbConnectionId';
END
GO

PRINT '=== Migration 011 complete ===';
GO
