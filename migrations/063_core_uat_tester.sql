-- Who may test, and who approves their test requests.
--
-- Lives in Fast_Core, beside FormEnvironment: readable whichever pool a
-- request resolves to, and it survives a rebuild of the UAT database.
--
-- Apply with:
--   npm run apply-sql -- --db Fast_Core --file migrations/063_core_uat_tester.sql
IF OBJECT_ID('dbo.UatTester', 'U') IS NULL
CREATE TABLE [dbo].[UatTester] (
  [Id]              INT IDENTITY(1,1) NOT NULL CONSTRAINT [PK_UatTester] PRIMARY KEY,
  [StaffId]         INT NOT NULL CONSTRAINT [UQ_UatTester_StaffId] UNIQUE,
  [Email]           NVARCHAR(200) NOT NULL,
  [ManagerStaffId]  INT NULL,
  [ManagerEmail]    NVARCHAR(200) NULL,
  [IsActive]        BIT NOT NULL CONSTRAINT [DF_UatTester_IsActive] DEFAULT (1),
  [UpdatedBy]       INT NULL,
  [UpdatedAt]       DATETIME2(7) NOT NULL CONSTRAINT [DF_UatTester_UpdatedAt] DEFAULT (SYSDATETIME())
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_UatTester_Email')
  CREATE INDEX [IX_UatTester_Email] ON [dbo].[UatTester] ([Email]);
GO
