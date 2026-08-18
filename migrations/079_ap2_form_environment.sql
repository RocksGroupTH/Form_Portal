-- =============================================
-- Migration: Flag AP-2 = UAT in FormEnvironment (its tables live in the UAT form DB)
-- Database: Fast_Core
-- Apply: npm run apply-sql -- --db Fast_Core --file migrations/079_ap2_form_environment.sql
--
-- Uses the live ProductionEnabled/UatEnabled bit columns. Flip AP-2 later from
-- Settings → Form Environment once its tables also exist in Rocks_Portal_Form.
-- =============================================

IF NOT EXISTS (SELECT 1 FROM [dbo].[FormEnvironment] WHERE FormCode = 'AP-2')
  INSERT INTO [dbo].[FormEnvironment] (FormCode, ProductionEnabled, UatEnabled)
  VALUES ('AP-2', 0, 1);
GO

PRINT '=== Migration 070 complete (AP-2 flagged UAT) ===';
GO
