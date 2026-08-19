-- AP-4's Production/UAT switches.
--
-- Fast_Core, like the other three forms': resolving which form database answers
-- must not itself depend on a form database.
--
-- Apply with:
--   npm run apply-sql -- --db Fast_Core --file migrations/093_core_ap4_form_environment.sql
--
-- Production on, UAT off — the same default a form with no row gets, stated
-- explicitly so the Settings page has a row to show.
IF NOT EXISTS (SELECT 1 FROM [dbo].[FormEnvironment] WHERE FormCode = N'AP-4')
  INSERT INTO [dbo].[FormEnvironment] ([FormCode], [ProductionEnabled], [UatEnabled])
  VALUES (N'AP-4', 1, 0);
GO
