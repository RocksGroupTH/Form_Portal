-- =============================================
-- Migration: BrandConfig - add BcConnectionId FK
-- Database: Fast_Core
-- Lets each brand pick which BcConnection (OAuth creds) to use
-- =============================================

USE [Fast_Core];
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.BrandConfig') AND name = N'BcConnectionId'
)
BEGIN
    ALTER TABLE [dbo].[BrandConfig] ADD [BcConnectionId] INT NULL;
    PRINT 'Added BrandConfig.BcConnectionId';
END
ELSE PRINT 'BrandConfig.BcConnectionId already exists - skipping';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys
    WHERE name = N'FK_BrandConfig_BcConnection'
      AND parent_object_id = OBJECT_ID(N'dbo.BrandConfig')
)
AND EXISTS (SELECT 1 FROM sys.tables WHERE name = 'BcConnection')
BEGIN
    ALTER TABLE [dbo].[BrandConfig] WITH CHECK
    ADD CONSTRAINT [FK_BrandConfig_BcConnection] FOREIGN KEY ([BcConnectionId])
        REFERENCES [dbo].[BcConnection]([Id]);
    PRINT 'Added FK_BrandConfig_BcConnection';
END
ELSE PRINT 'FK_BrandConfig_BcConnection already exists or BcConnection missing - skipping';
GO

PRINT '=== Migration 010 complete ===';
GO
