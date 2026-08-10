-- =============================================
-- Migration: Fast_Core - generic app settings key-value store
-- Database: Fast_Core
-- Apply: npm run apply-sql -- --db Fast_Core --file migrations/016_fast_core_app_setting.sql
-- System-wide editable settings (e.g. ORS_API_KEY) configurable via the
-- admin Settings UI instead of .env. Always available (not tied to 161).
-- =============================================

USE [Fast_Core];
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AppSetting')
BEGIN
  CREATE TABLE [dbo].[AppSetting] (
    [SettingKey]   NVARCHAR(100) NOT NULL PRIMARY KEY,
    [SettingValue] NVARCHAR(MAX) NULL,
    [UpdatedBy]    INT           NULL,
    [UpdatedAt]    DATETIME2     NOT NULL DEFAULT SYSDATETIME()
  );
  PRINT 'Created AppSetting';
END
ELSE PRINT 'AppSetting already exists - skipping';
GO

PRINT '=== Migration 016 complete ===';
GO
