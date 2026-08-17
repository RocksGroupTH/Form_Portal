-- FormEnvironment gains two independent switches.
--
-- Production and UAT now run side by side, so a single Environment string can
-- no longer say which pool a form uses for which users. ProductionEnabled and
-- UatEnabled are independent per-form switches: both can be on at once, so
-- ordinary users keep working against Production while configured testers
-- (see migrations/063_core_uat_tester.sql) use UAT.
--
-- Environment stays untouched here and keeps deciding behaviour until the code
-- that reads it is moved onto the two new columns; it is dropped in
-- migrations/065_core_drop_form_environment_column.sql, at the end of the plan.
--
-- Apply with:
--   npm run apply-sql -- --db Fast_Core --file migrations/062_core_form_environment_switches.sql
IF COL_LENGTH('dbo.FormEnvironment', 'ProductionEnabled') IS NULL
  ALTER TABLE [dbo].[FormEnvironment] ADD [ProductionEnabled] BIT NOT NULL CONSTRAINT [DF_FormEnvironment_ProductionEnabled] DEFAULT (1);
GO
IF COL_LENGTH('dbo.FormEnvironment', 'UatEnabled') IS NULL
  ALTER TABLE [dbo].[FormEnvironment] ADD [UatEnabled] BIT NOT NULL CONSTRAINT [DF_FormEnvironment_UatEnabled] DEFAULT (0);
GO
-- Every form stays live. A literal conversion would set ProductionEnabled = 0
-- on all three configured forms — the whole catalogue invisible to everyone
-- while UatTester is still empty.
UPDATE [dbo].[FormEnvironment]
   SET [ProductionEnabled] = 1,
       [UatEnabled] = CASE WHEN [Environment] = N'UAT' THEN 1 ELSE 0 END;
GO
