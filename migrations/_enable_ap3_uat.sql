-- Enable AP-3 on UAT only (Production off) — matches AP-1/AP-2/AP-17.
-- Fast_Core.dbo.FormEnvironment: a missing row = Production-only, which is why
-- the AP-3 form errored (its tables live in UAT so far). Idempotent.
-- Apply: npm run apply-sql -- --db Fast_Core --file migrations/_enable_ap3_uat.sql
IF NOT EXISTS (SELECT 1 FROM [dbo].[FormEnvironment] WHERE FormCode = 'AP-3')
  INSERT INTO [dbo].[FormEnvironment] (FormCode, ProductionEnabled, UatEnabled, UpdatedAt)
  VALUES ('AP-3', 0, 1, SYSDATETIME());
ELSE
  UPDATE [dbo].[FormEnvironment]
  SET ProductionEnabled = 0, UatEnabled = 1, UpdatedAt = SYSDATETIME()
  WHERE FormCode = 'AP-3';
GO
PRINT 'AP-3 FormEnvironment set to UAT-only';
GO
