-- =============================================
-- Migration: Accounting core (header/shared/settings)
-- Database: Fast_Form
-- Apply: npm run apply-sql -- --db Fast_Form --file migrations/013_portal_acc_core.sql
-- =============================================

-- 1. AccFormMaster (form catalog) ------------------------------
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AccFormMaster')
BEGIN
  CREATE TABLE [dbo].[AccFormMaster] (
    [FormCode]      NVARCHAR(20)  NOT NULL PRIMARY KEY,
    [GroupName]     NVARCHAR(50)  NOT NULL,
    [FormNameTh]    NVARCHAR(200) NOT NULL,
    [FormNameEn]    NVARCHAR(200) NOT NULL,
    [RunningPrefix] NVARCHAR(10)  NOT NULL,
    [OwnerContact]  NVARCHAR(200) NULL,
    [IsActive]      BIT           NOT NULL DEFAULT 1,
    [SortOrder]     INT           NOT NULL DEFAULT 0,
    [CreatedAt]     DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    [UpdatedAt]     DATETIME2     NOT NULL DEFAULT SYSDATETIME()
  );
  PRINT 'Created AccFormMaster';
END
GO

-- Seed AP-1
IF NOT EXISTS (SELECT 1 FROM [dbo].[AccFormMaster] WHERE FormCode = 'AP-1')
  INSERT INTO [dbo].[AccFormMaster]
    (FormCode, GroupName, FormNameTh, FormNameEn, RunningPrefix, OwnerContact, SortOrder)
  VALUES
    ('AP-1', 'Accounting',
     N'แบบฟอร์มเบิกค่าเดินทาง (ออฟฟิต)',
     N'Travel Expense Reimbursement Form (Office)',
     'TOF', NULL, 1);
GO

-- 2. AccRequest (shared header) --------------------------------
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AccRequest')
BEGIN
  CREATE TABLE [dbo].[AccRequest] (
    [Id]                     INT           IDENTITY(1,1) PRIMARY KEY,
    [RequestNo]              NVARCHAR(32)  NULL,
    [FormCode]               NVARCHAR(20)  NOT NULL,
    [BrandCode]              NVARCHAR(20)  NULL,
    [Status]                 NVARCHAR(20)  NOT NULL DEFAULT 'Draft',
    [CurrentStepCode]        NVARCHAR(20)  NULL,
    -- requester HR snapshot
    [EmployeeId]             UNIQUEIDENTIFIER NULL,
    [StaffId]                INT           NULL,
    [RequesterFirstName]     NVARCHAR(200) NULL,
    [RequesterLastName]      NVARCHAR(200) NULL,
    [RequesterFullName]      NVARCHAR(200) NULL,
    [RequesterEmail]         NVARCHAR(200) NULL,
    [RequesterPosition]      NVARCHAR(200) NULL,
    [RequesterDepartmentId]  INT           NULL,
    [RequesterDepartmentName] NVARCHAR(200) NULL,
    [ManagerStaffId]         INT           NULL,
    [ManagerEmail]           NVARCHAR(200) NULL,
    [CompanyName]            NVARCHAR(200) NULL,
    -- amounts / payment
    [TotalAmount]            DECIMAL(18,2) NULL,
    [PaymentDate]            DATE          NULL,
    -- audit
    [SubmittedBy]            INT           NULL,
    [SubmittedAt]            DATETIME2     NULL,
    [CancelledBy]            INT           NULL,
    [CancelledAt]            DATETIME2     NULL,
    [CreatedBy]              INT           NULL,
    [CreatedAt]              DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    [UpdatedAt]              DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT [FK_AccRequest_Form] FOREIGN KEY ([FormCode]) REFERENCES [AccFormMaster]([FormCode]),
    CONSTRAINT [CK_AccRequest_Status] CHECK ([Status] IN
      ('Draft','Submitted','ManagerApproved','Approved','Rejected','Returned','Cancelled'))
  );
  CREATE INDEX [IX_AccRequest_Form]    ON [AccRequest]([FormCode]);
  CREATE INDEX [IX_AccRequest_Status]  ON [AccRequest]([Status]);
  CREATE INDEX [IX_AccRequest_Staff]   ON [AccRequest]([StaffId]);
  CREATE INDEX [IX_AccRequest_Brand]   ON [AccRequest]([BrandCode]);
  CREATE UNIQUE INDEX [UX_AccRequest_RequestNo]
    ON [AccRequest]([RequestNo]) WHERE [RequestNo] IS NOT NULL;
  PRINT 'Created AccRequest';
END
GO

-- 3. AccApproval (approval instances) --------------------------
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AccApproval')
BEGIN
  CREATE TABLE [dbo].[AccApproval] (
    [Id]           INT           IDENTITY(1,1) PRIMARY KEY,
    [RequestId]    INT           NOT NULL,
    [StepCode]     NVARCHAR(20)  NOT NULL,
    [StepOrder]    INT           NOT NULL,
    [AssignedTo]   INT           NULL,
    [AssignedEmail] NVARCHAR(200) NULL,
    [Status]       NVARCHAR(20)  NOT NULL DEFAULT 'Pending',
    [Comment]      NVARCHAR(2000) NULL,
    [IsChecked]    BIT           NULL,
    [ActionedBy]   INT           NULL,
    [ActionedAt]   DATETIME2     NULL,
    [CreatedAt]    DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT [FK_AccApproval_Request] FOREIGN KEY ([RequestId]) REFERENCES [AccRequest]([Id]),
    CONSTRAINT [CK_AccApproval_Step]   CHECK ([StepCode] IN ('MANAGER','ACCOUNT')),
    CONSTRAINT [CK_AccApproval_Status] CHECK ([Status] IN ('Pending','Approved','Rejected','Returned'))
  );
  CREATE INDEX [IX_AccApproval_Request]  ON [AccApproval]([RequestId]);
  CREATE INDEX [IX_AccApproval_Assigned] ON [AccApproval]([AssignedTo]);
  CREATE INDEX [IX_AccApproval_Status]   ON [AccApproval]([Status]);
  PRINT 'Created AccApproval';
END
GO

-- 4. AccActivityLog --------------------------------------------
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AccActivityLog')
BEGIN
  CREATE TABLE [dbo].[AccActivityLog] (
    [Id]           INT           IDENTITY(1,1) PRIMARY KEY,
    [RequestId]    INT           NOT NULL,
    [AuthorId]     INT           NULL,
    [Action]       NVARCHAR(50)  NOT NULL,
    [Note]         NVARCHAR(2000) NULL,
    [MetadataJson] NVARCHAR(MAX) NULL,
    [CreatedAt]    DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT [FK_AccActivity_Request] FOREIGN KEY ([RequestId]) REFERENCES [AccRequest]([Id])
  );
  CREATE INDEX [IX_AccActivity_Request] ON [AccActivityLog]([RequestId]);
  PRINT 'Created AccActivityLog';
END
GO

-- 5. AccSequence (running number) ------------------------------
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AccSequence')
BEGIN
  CREATE TABLE [dbo].[AccSequence] (
    [Prefix]    NVARCHAR(10) NOT NULL,
    [Year]      INT          NOT NULL,
    [LastSeq]   INT          NOT NULL DEFAULT 0,
    [UpdatedAt] DATETIME2    NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT [PK_AccSequence] PRIMARY KEY ([Prefix],[Year])
  );
  PRINT 'Created AccSequence';
END
GO

-- 6. AccEmailQueue ---------------------------------------------
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AccEmailQueue')
BEGIN
  CREATE TABLE [dbo].[AccEmailQueue] (
    [Id]           INT           IDENTITY(1,1) PRIMARY KEY,
    [RequestId]    INT           NULL,
    [ToEmail]      NVARCHAR(500) NOT NULL,
    [Subject]      NVARCHAR(500) NOT NULL,
    [BodyHtml]     NVARCHAR(MAX) NOT NULL,
    [TriggerType]  NVARCHAR(50)  NOT NULL,
    [Status]       NVARCHAR(20)  NOT NULL DEFAULT 'Queued',
    [ErrorMessage] NVARCHAR(1000) NULL,
    [AttemptCount] INT           NOT NULL DEFAULT 0,
    [CreatedAt]    DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    [SentAt]       DATETIME2     NULL,
    CONSTRAINT [CK_AccEmail_Status] CHECK ([Status] IN ('Queued','Sent','Failed'))
  );
  CREATE INDEX [IX_AccEmail_Status] ON [AccEmailQueue]([Status]);
  PRINT 'Created AccEmailQueue';
END
GO

-- 7. AccRequestFile (attachments) ------------------------------
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AccRequestFile')
BEGIN
  CREATE TABLE [dbo].[AccRequestFile] (
    [Id]             INT           IDENTITY(1,1) PRIMARY KEY,
    [RequestId]      INT           NOT NULL,
    [RefType]        NVARCHAR(30)  NOT NULL,   -- 'travel_item'
    [RefId]          INT           NULL,       -- AccTravelExpenseItem.Id
    [FileName]       NVARCHAR(400) NOT NULL,
    [FileSize]       INT           NULL,
    [ContentType]    NVARCHAR(200) NULL,
    [StoragePath]    NVARCHAR(800) NOT NULL,
    [StorageBackend] NVARCHAR(30)  NOT NULL DEFAULT 'local',
    [UploadedBy]     INT           NULL,
    [UploadedAt]     DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT [FK_AccFile_Request] FOREIGN KEY ([RequestId]) REFERENCES [AccRequest]([Id])
  );
  CREATE INDEX [IX_AccFile_Request] ON [AccRequestFile]([RequestId]);
  CREATE INDEX [IX_AccFile_Ref]     ON [AccRequestFile]([RefType],[RefId]);
  PRINT 'Created AccRequestFile';
END
GO

-- 8. Settings: AccApprover -------------------------------------
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AccApprover')
BEGIN
  CREATE TABLE [dbo].[AccApprover] (
    [Id]          INT           IDENTITY(1,1) PRIMARY KEY,
    [StaffId]     INT           NULL,
    [Email]       NVARCHAR(200) NOT NULL,
    [DisplayName] NVARCHAR(200) NULL,
    [IsActive]    BIT           NOT NULL DEFAULT 1,
    [CreatedBy]   INT           NULL,
    [CreatedAt]   DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    [UpdatedAt]   DATETIME2     NOT NULL DEFAULT SYSDATETIME()
  );
  CREATE UNIQUE INDEX [UX_AccApprover_Email] ON [AccApprover]([Email]);
  PRINT 'Created AccApprover';
END
GO

-- 9. Settings: AccVehicle --------------------------------------
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AccVehicle')
BEGIN
  CREATE TABLE [dbo].[AccVehicle] (
    [Id]            INT           IDENTITY(1,1) PRIMARY KEY,
    [Name]          NVARCHAR(100) NOT NULL,
    [RatePerKm]     DECIMAL(18,2) NULL,
    [IsManualEntry] BIT           NOT NULL DEFAULT 0,
    [IsActive]      BIT           NOT NULL DEFAULT 1,
    [SortOrder]     INT           NOT NULL DEFAULT 0,
    [CreatedBy]     INT           NULL,
    [CreatedAt]     DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    [UpdatedAt]     DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT [CK_AccVehicle_Rate] CHECK ([IsManualEntry] = 1 OR [RatePerKm] >= 1)
  );
  PRINT 'Created AccVehicle';
END
GO

-- Seed default vehicles (rate values are placeholders; admin edits later)
IF NOT EXISTS (SELECT 1 FROM [dbo].[AccVehicle])
BEGIN
  INSERT INTO [dbo].[AccVehicle] (Name, RatePerKm, IsManualEntry, SortOrder) VALUES
    (N'รถยนต์',        7,    0, 1),
    (N'รถจักรยานยนต์', 4,    0, 2),
    (N'Grab',          NULL, 1, 3),
    (N'Taxi',          NULL, 1, 4),
    (N'อื่นๆ',         NULL, 1, 5);
END
GO

-- 10. Settings: AccFormBrand -----------------------------------
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AccFormBrand')
BEGIN
  CREATE TABLE [dbo].[AccFormBrand] (
    [Id]        INT          IDENTITY(1,1) PRIMARY KEY,
    [FormCode]  NVARCHAR(20) NOT NULL,
    [BrandCode] NVARCHAR(20) NOT NULL,
    [IsActive]  BIT          NOT NULL DEFAULT 1,
    [SortOrder] INT          NOT NULL DEFAULT 0,
    CONSTRAINT [FK_AccFormBrand_Form] FOREIGN KEY ([FormCode]) REFERENCES [AccFormMaster]([FormCode]),
    CONSTRAINT [UQ_AccFormBrand] UNIQUE ([FormCode],[BrandCode])
  );
  PRINT 'Created AccFormBrand';
END
GO

PRINT '=== Migration 013 complete ===';
GO
