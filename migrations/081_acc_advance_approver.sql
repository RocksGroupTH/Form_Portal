-- =============================================
-- Migration: AccAdvanceApprover — AP-2's own accounting-approver list
-- Database: Rocks_Portal_Form_UAT (AP-2 is pinned to the UAT form DB)
-- Apply: npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/081_acc_advance_approver.sql
--
-- AP-2 keeps a SEPARATE approver list from AP-1 (AccApprover) so editing AP-2
-- approvers never affects AP-1. Same shape as AccApprover. Governs the ACCOUNT
-- step only; the MANAGER step is the requester's HR line manager (per request).
-- =============================================

IF OBJECT_ID('dbo.AccAdvanceApprover', 'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[AccAdvanceApprover] (
    [Id]          INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [StaffId]     INT NULL,
    [Email]       NVARCHAR(400) NOT NULL,
    [DisplayName] NVARCHAR(400) NULL,
    [IsActive]    BIT NOT NULL CONSTRAINT DF_AccAdvanceApprover_IsActive DEFAULT (1),
    [PhotoUrl]    NVARCHAR(MAX) NULL,
    [CreatedBy]   INT NULL,
    [CreatedAt]   DATETIME2 NOT NULL CONSTRAINT DF_AccAdvanceApprover_CreatedAt DEFAULT (SYSDATETIME()),
    [UpdatedAt]   DATETIME2 NOT NULL CONSTRAINT DF_AccAdvanceApprover_UpdatedAt DEFAULT (SYSDATETIME())
  );
  CREATE UNIQUE INDEX UX_AccAdvanceApprover_Email ON [dbo].[AccAdvanceApprover] ([Email]);
END
GO

PRINT '=== Migration 072 complete (AccAdvanceApprover) ===';
GO
