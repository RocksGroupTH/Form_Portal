-- =============================================
-- Migration: Accounting generic settings key-value store
-- Database: Fast_Form
-- Apply: npm run apply-sql -- --db Fast_Form --file migrations/015_portal_acc_settings_kv.sql
-- Generic accounting settings store (kept for future accounting-specific settings).
-- NOTE: the global ORS_API_KEY lives in Fast_Core.AppSetting, not here.
-- =============================================

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AccSetting')
BEGIN
  CREATE TABLE [dbo].[AccSetting] (
    [SettingKey]   NVARCHAR(100) NOT NULL PRIMARY KEY,
    [SettingValue] NVARCHAR(MAX) NULL,
    [UpdatedBy]    INT           NULL,
    [UpdatedAt]    DATETIME2     NOT NULL DEFAULT SYSDATETIME()
  );
  PRINT 'Created AccSetting';
END
ELSE PRINT 'AccSetting already exists - skipping';
GO

PRINT '=== Migration 015 complete ===';
GO
