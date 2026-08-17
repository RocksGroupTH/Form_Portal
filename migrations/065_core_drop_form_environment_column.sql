-- Drop FormEnvironment.Environment -- the contract half of expand-then-contract.
--
-- migrations/060_core_form_environment.sql gave each form one Environment string,
-- 'Production' or 'UAT', because a form was in one place or the other. Parallel
-- UAT ended that: ProductionEnabled and UatEnabled
-- (migrations/062_core_form_environment_switches.sql) are independent, both can
-- be on at once, and no single string can express that. 062 backfilled the two
-- switches from this column and left it in place so the running app kept working
-- while the code moved across; nothing reads it any more.
--
-- Order matters. CK_FormEnvironment_Env is a named check constraint ON this
-- column (migrations/060_core_form_environment.sql:15) -- SQL Server refuses to
-- drop a column a constraint depends on, so the constraint goes first, in its
-- own batch.
--
-- src/lib/form-environment/service.ts is updated in the same commit: setFormFlag's
-- MERGE named Environment in its INSERT list only to satisfy this NOT NULL
-- column with no default. Leaving that behind would make every first write to a
-- form fail on a column that no longer exists.
--
-- Apply with:
--   npm run apply-sql -- --db Fast_Core --file migrations/065_core_drop_form_environment_column.sql
--
-- No _UAT guard here, unlike 061 and 064: FormEnvironment lives in Fast_Core,
-- which is a single shared database with no UAT twin -- that is the whole reason
-- the switches live there rather than in the form database they select.
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_FormEnvironment_Env')
  ALTER TABLE [dbo].[FormEnvironment] DROP CONSTRAINT [CK_FormEnvironment_Env];
GO
IF COL_LENGTH('dbo.FormEnvironment', 'Environment') IS NOT NULL
  ALTER TABLE [dbo].[FormEnvironment] DROP COLUMN [Environment];
GO
