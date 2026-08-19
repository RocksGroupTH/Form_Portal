-- AP-4's accounting approver pool. One pool covers both accounting steps; the
-- rule that the same person cannot take both is enforced in the service, not
-- here, because it is a property of one request rather than of the roster.
--
-- Its own table rather than AP-1's AccApprover, so editing AP-4's list cannot
-- silently change who approves AP-1.
--
-- Apply with (BOTH databases):
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/090_acc_reimburse_approver.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/090_acc_reimburse_approver.sql
IF OBJECT_ID('dbo.AccReimburseApprover', 'U') IS NULL
CREATE TABLE [dbo].[AccReimburseApprover] (
  [Id]          INT IDENTITY(1,1) NOT NULL CONSTRAINT [PK_AccReimburseApprover] PRIMARY KEY,
  [StaffId]     INT NOT NULL CONSTRAINT [UQ_AccReimburseApprover_StaffId] UNIQUE,
  [Email]       NVARCHAR(200) NOT NULL,
  [DisplayName] NVARCHAR(200) NOT NULL,
  [IsActive]    BIT NOT NULL CONSTRAINT [DF_AccReimburseApprover_Active] DEFAULT (1),
  [CreatedBy]   INT NULL,
  [CreatedAt]   DATETIME2(7) NOT NULL CONSTRAINT [DF_AccReimburseApprover_Created] DEFAULT (SYSDATETIME()),
  [UpdatedBy]   INT NULL,
  [UpdatedAt]   DATETIME2(7) NOT NULL CONSTRAINT [DF_AccReimburseApprover_Updated] DEFAULT (SYSDATETIME())
);
GO
