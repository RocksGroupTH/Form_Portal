-- Per-form Production/UAT flag.
--
-- Lives in Fast_Core, not the form database, because it must be readable
-- BEFORE the form database is chosen. Putting it behind the very decision it
-- informs would be circular.
--
-- A form with no row here is Production, so nothing changes until something is
-- configured.
--
-- Apply with:
--   npm run apply-sql -- --db Fast_Core --file migrations/060_core_form_environment.sql
IF OBJECT_ID('dbo.FormEnvironment', 'U') IS NULL
CREATE TABLE [dbo].[FormEnvironment] (
  [FormCode]    NVARCHAR(20)  NOT NULL CONSTRAINT [PK_FormEnvironment] PRIMARY KEY,
  [Environment] NVARCHAR(20)  NOT NULL CONSTRAINT [CK_FormEnvironment_Env]
                  CHECK ([Environment] IN ('Production','UAT')),
  [UpdatedBy]   INT           NULL,
  [UpdatedAt]   DATETIME2(7)  NOT NULL CONSTRAINT [DF_FormEnvironment_UpdatedAt]
                  DEFAULT (SYSDATETIME())
);
GO
