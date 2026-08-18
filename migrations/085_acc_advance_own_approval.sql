-- =============================================
-- Migration: AP-2's own approval subsystem (isolated from AP-1's AccApproval)
-- Database: Rocks_Portal_Form_UAT
-- Apply: npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/085_acc_advance_own_approval.sql
--
-- AP-2 needs a variable-length, amount-driven approval chain, which the shared
-- AccApproval (CK StepCode IN MANAGER|ACCOUNT) cannot hold. AP-2 gets its own
-- approval rows + an amount matrix. StepType is open per AP-2:
--   HEAD_DEPT   → requester's department head (= their manager, AP-1 logic)
--   HEAD_ACC    → Head Accounting (AccAdvanceApprover role)
--   DIRECTOR    → ผู้บริหาร (AccAdvanceApprover role)
--   ACC_OFFICER → Accounting Officer (final; payment date + check)
-- =============================================

IF OBJECT_ID('dbo.AccAdvanceApproval', 'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[AccAdvanceApproval] (
    [Id]                INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [RequestId]         INT NOT NULL,
    [StepOrder]         INT NOT NULL,
    [StepType]          NVARCHAR(20) NOT NULL,
    [AssignedStaffId]   INT NULL,
    [AssignedEmail]     NVARCHAR(400) NULL,
    [Status]            NVARCHAR(20) NOT NULL CONSTRAINT DF_AccAdvApproval_Status DEFAULT ('Pending'),
    [IsChecked]         BIT NULL,
    [PaymentDate]       DATE NULL,
    [Comment]           NVARCHAR(MAX) NULL,
    [ActionedByStaffId] INT NULL,
    [ActionedByEmail]   NVARCHAR(400) NULL,
    [ActionedAt]        DATETIME2 NULL,
    [CreatedAt]         DATETIME2 NOT NULL CONSTRAINT DF_AccAdvApproval_Created DEFAULT (SYSDATETIME())
  );
  CREATE UNIQUE INDEX UX_AccAdvApproval_ReqStep ON [dbo].[AccAdvanceApproval] ([RequestId], [StepOrder]);
  CREATE INDEX IX_AccAdvApproval_Req ON [dbo].[AccAdvanceApproval] ([RequestId]);
END
GO

IF OBJECT_ID('dbo.AccAdvanceApprovalTier', 'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[AccAdvanceApprovalTier] (
    [Id]        INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [MinAmount] DECIMAL(18,2) NOT NULL CONSTRAINT DF_AccAdvTier_Min DEFAULT (0),
    [MaxAmount] DECIMAL(18,2) NULL,               -- null = no upper bound
    [Steps]     NVARCHAR(200) NOT NULL,           -- ordered CSV of StepType
    [IsActive]  BIT NOT NULL CONSTRAINT DF_AccAdvTier_Active DEFAULT (1),
    [SortOrder] INT NOT NULL CONSTRAINT DF_AccAdvTier_Sort DEFAULT (0),
    [UpdatedAt] DATETIME2 NOT NULL CONSTRAINT DF_AccAdvTier_Upd DEFAULT (SYSDATETIME())
  );
END
GO

-- Seed example tiers (edit later at Settings › Approval Matrix). Amounts in THB.
IF NOT EXISTS (SELECT 1 FROM [dbo].[AccAdvanceApprovalTier])
  INSERT INTO [dbo].[AccAdvanceApprovalTier] (MinAmount, MaxAmount, Steps, SortOrder) VALUES
    (0,        10000,   'HEAD_DEPT,ACC_OFFICER',                    1),
    (10000.01, 100000,  'HEAD_DEPT,HEAD_ACC,ACC_OFFICER',           2),
    (100000.01, NULL,   'HEAD_DEPT,HEAD_ACC,DIRECTOR,ACC_OFFICER',  3);
GO

PRINT '=== Migration 085 complete (AP-2 own approval + amount matrix) ===';
GO
