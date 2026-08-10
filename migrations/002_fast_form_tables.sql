-- =============================================
-- Migration: Fast_Form - All form tables
-- Database: Fast_Form
-- Run this on the Fast_Form database
-- =============================================

USE [Fast_Form];
GO

-- ── 1. OfficeForms ──────────────────────────────

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'OfficeForms')
BEGIN
    CREATE TABLE [dbo].[OfficeForms] (
        [Id]              INT            IDENTITY(1,1) PRIMARY KEY,
        [Name]            NVARCHAR(200)  NOT NULL,
        [Slug]            NVARCHAR(200)  NOT NULL,
        [Description]     NVARCHAR(1000) NULL,
        [Category]        NVARCHAR(100)  NULL,
        [Icon]            NVARCHAR(50)   NULL,
        [Status]          NVARCHAR(20)   NOT NULL DEFAULT 'Draft',
        [CurrentVersion]  INT            NOT NULL DEFAULT 1,
        [CreatedBy]       INT            NOT NULL,
        [CreatedAt]       DATETIME2      NOT NULL DEFAULT GETDATE(),
        [UpdatedAt]       DATETIME2      NOT NULL DEFAULT GETDATE(),
        [IsActive]        BIT            NOT NULL DEFAULT 1,

        CONSTRAINT [UQ_OfficeForms_Slug] UNIQUE ([Slug]),
        CONSTRAINT [CK_OfficeForms_Status] CHECK ([Status] IN ('Draft', 'Published', 'Archived'))
    );

    CREATE INDEX [IX_OfficeForms_Status] ON [OfficeForms]([Status]);
    CREATE INDEX [IX_OfficeForms_CreatedBy] ON [OfficeForms]([CreatedBy]);
    CREATE INDEX [IX_OfficeForms_IsActive] ON [OfficeForms]([IsActive]);

    PRINT 'Created OfficeForms';
END
GO

-- ── 2. OfficeFormVersions ───────────────────────

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'OfficeFormVersions')
BEGIN
    CREATE TABLE [dbo].[OfficeFormVersions] (
        [Id]              INT            IDENTITY(1,1) PRIMARY KEY,
        [FormId]          INT            NOT NULL,
        [Version]         INT            NOT NULL,
        [FieldsJson]      NVARCHAR(MAX)  NOT NULL,
        [PublishedAt]     DATETIME2      NULL,
        [PublishedBy]     INT            NULL,
        [CreatedAt]       DATETIME2      NOT NULL DEFAULT GETDATE(),

        CONSTRAINT [FK_FormVersions_FormId] FOREIGN KEY ([FormId]) REFERENCES [OfficeForms]([Id]),
        CONSTRAINT [UQ_FormVersions] UNIQUE ([FormId], [Version])
    );

    CREATE INDEX [IX_FormVersions_FormId] ON [OfficeFormVersions]([FormId]);

    PRINT 'Created OfficeFormVersions';
END
GO

-- ── 3. OfficeFormSubmissions ────────────────────

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'OfficeFormSubmissions')
BEGIN
    CREATE TABLE [dbo].[OfficeFormSubmissions] (
        [Id]              INT            IDENTITY(1,1) PRIMARY KEY,
        [FormId]          INT            NOT NULL,
        [FormVersionId]   INT            NOT NULL,
        [SubmittedBy]     INT            NOT NULL,
        [Status]          NVARCHAR(20)   NOT NULL DEFAULT 'Draft',
        [DataJson]        NVARCHAR(MAX)  NOT NULL,
        [SubmittedAt]     DATETIME2      NULL,
        [CompletedAt]     DATETIME2      NULL,
        [CreatedAt]       DATETIME2      NOT NULL DEFAULT GETDATE(),
        [UpdatedAt]       DATETIME2      NOT NULL DEFAULT GETDATE(),
        [IsActive]        BIT            NOT NULL DEFAULT 1,

        CONSTRAINT [FK_Submissions_FormId] FOREIGN KEY ([FormId]) REFERENCES [OfficeForms]([Id]),
        CONSTRAINT [FK_Submissions_FormVersionId] FOREIGN KEY ([FormVersionId]) REFERENCES [OfficeFormVersions]([Id]),
        CONSTRAINT [CK_Submissions_Status] CHECK ([Status] IN ('Draft', 'Submitted', 'InReview', 'Approved', 'Rejected', 'Returned', 'Cancelled'))
    );

    CREATE INDEX [IX_Submissions_FormId] ON [OfficeFormSubmissions]([FormId]);
    CREATE INDEX [IX_Submissions_FormVersionId] ON [OfficeFormSubmissions]([FormVersionId]);
    CREATE INDEX [IX_Submissions_SubmittedBy] ON [OfficeFormSubmissions]([SubmittedBy]);
    CREATE INDEX [IX_Submissions_Status] ON [OfficeFormSubmissions]([Status]);
    CREATE INDEX [IX_Submissions_IsActive] ON [OfficeFormSubmissions]([IsActive]);

    PRINT 'Created OfficeFormSubmissions';
END
GO

-- ── 4. OfficeFormFiles ──────────────────────────

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'OfficeFormFiles')
BEGIN
    CREATE TABLE [dbo].[OfficeFormFiles] (
        [Id]              INT            IDENTITY(1,1) PRIMARY KEY,
        [SubmissionId]    INT            NOT NULL,
        [FieldKey]        NVARCHAR(100)  NOT NULL,
        [FileName]        NVARCHAR(500)  NOT NULL,
        [FileSize]        BIGINT         NOT NULL,
        [ContentType]     NVARCHAR(200)  NOT NULL,
        [StoragePath]     NVARCHAR(1000) NOT NULL,
        [StorageBackend]  NVARCHAR(20)   NOT NULL DEFAULT 'local',
        [UploadedBy]      INT            NOT NULL,
        [UploadedAt]      DATETIME2      NOT NULL DEFAULT GETDATE(),
        [IsActive]        BIT            NOT NULL DEFAULT 1,

        CONSTRAINT [FK_FormFiles_SubmissionId] FOREIGN KEY ([SubmissionId]) REFERENCES [OfficeFormSubmissions]([Id])
    );

    CREATE INDEX [IX_FormFiles_SubmissionId] ON [OfficeFormFiles]([SubmissionId]);

    PRINT 'Created OfficeFormFiles';
END
GO

-- ── 5. OfficeFormWorkflows ──────────────────────

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'OfficeFormWorkflows')
BEGIN
    CREATE TABLE [dbo].[OfficeFormWorkflows] (
        [Id]              INT            IDENTITY(1,1) PRIMARY KEY,
        [FormId]          INT            NOT NULL,
        [Name]            NVARCHAR(200)  NOT NULL DEFAULT 'Default',
        [SLADays]         INT            NULL DEFAULT 30,
        [IsActive]        BIT            NOT NULL DEFAULT 1,
        [CreatedAt]       DATETIME2      NOT NULL DEFAULT GETDATE(),
        [UpdatedAt]       DATETIME2      NOT NULL DEFAULT GETDATE(),

        CONSTRAINT [FK_Workflows_FormId] FOREIGN KEY ([FormId]) REFERENCES [OfficeForms]([Id])
    );

    CREATE INDEX [IX_Workflows_FormId] ON [OfficeFormWorkflows]([FormId]);

    PRINT 'Created OfficeFormWorkflows';
END
GO

-- ── 6. OfficeFormWorkflowSteps ──────────────────

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'OfficeFormWorkflowSteps')
BEGIN
    CREATE TABLE [dbo].[OfficeFormWorkflowSteps] (
        [Id]              INT            IDENTITY(1,1) PRIMARY KEY,
        [WorkflowId]      INT            NOT NULL,
        [StepOrder]       INT            NOT NULL,
        [ParallelGroup]   NVARCHAR(50)   NULL,
        [Name]            NVARCHAR(200)  NOT NULL,
        [AssigneeType]    NVARCHAR(20)   NOT NULL,
        [AssigneeValue]   NVARCHAR(200)  NULL,
        [AutoApproveCondition] NVARCHAR(MAX) NULL,
        [IsActive]        BIT            NOT NULL DEFAULT 1,

        CONSTRAINT [FK_WorkflowSteps_WorkflowId] FOREIGN KEY ([WorkflowId]) REFERENCES [OfficeFormWorkflows]([Id]),
        CONSTRAINT [CK_WorkflowSteps_AssigneeType] CHECK ([AssigneeType] IN ('user', 'role', 'submitter_manager'))
    );

    CREATE INDEX [IX_WorkflowSteps_WorkflowId] ON [OfficeFormWorkflowSteps]([WorkflowId]);

    PRINT 'Created OfficeFormWorkflowSteps';
END
GO

-- ── 7. OfficeFormApprovals ──────────────────────

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'OfficeFormApprovals')
BEGIN
    CREATE TABLE [dbo].[OfficeFormApprovals] (
        [Id]              INT            IDENTITY(1,1) PRIMARY KEY,
        [SubmissionId]    INT            NOT NULL,
        [WorkflowStepId]  INT            NOT NULL,
        [AssignedTo]      INT            NULL,
        [Status]          NVARCHAR(20)   NOT NULL DEFAULT 'Pending',
        [Comment]         NVARCHAR(2000) NULL,
        [ActionAt]        DATETIME2      NULL,
        [DueAt]           DATETIME2      NULL,
        [NotifiedAt]      DATETIME2      NULL,
        [ReminderSentAt]  DATETIME2      NULL,
        [CreatedAt]       DATETIME2      NOT NULL DEFAULT GETDATE(),

        CONSTRAINT [FK_Approvals_SubmissionId] FOREIGN KEY ([SubmissionId]) REFERENCES [OfficeFormSubmissions]([Id]),
        CONSTRAINT [FK_Approvals_WorkflowStepId] FOREIGN KEY ([WorkflowStepId]) REFERENCES [OfficeFormWorkflowSteps]([Id]),
        CONSTRAINT [CK_Approvals_Status] CHECK ([Status] IN ('Pending', 'Approved', 'Rejected', 'Returned', 'Skipped'))
    );

    CREATE INDEX [IX_Approvals_SubmissionId] ON [OfficeFormApprovals]([SubmissionId]);
    CREATE INDEX [IX_Approvals_AssignedTo] ON [OfficeFormApprovals]([AssignedTo]);
    CREATE INDEX [IX_Approvals_Status] ON [OfficeFormApprovals]([Status]);
    CREATE INDEX [IX_Approvals_WorkflowStepId] ON [OfficeFormApprovals]([WorkflowStepId]);

    PRINT 'Created OfficeFormApprovals';
END
GO

-- ── 8. OfficeFormActivityLog ────────────────────

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'OfficeFormActivityLog')
BEGIN
    CREATE TABLE [dbo].[OfficeFormActivityLog] (
        [Id]              INT            IDENTITY(1,1) PRIMARY KEY,
        [EntityType]      NVARCHAR(50)   NOT NULL,
        [EntityId]        INT            NOT NULL,
        [AuthorId]        INT            NOT NULL,
        [LogType]         NVARCHAR(50)   NOT NULL,
        [Note]            NVARCHAR(2000) NULL,
        [MetadataJson]    NVARCHAR(MAX)  NULL,
        [CreatedAt]       DATETIME2      NOT NULL DEFAULT GETDATE()
    );

    CREATE INDEX [IX_ActivityLog_Entity] ON [OfficeFormActivityLog]([EntityType], [EntityId]);
    CREATE INDEX [IX_ActivityLog_AuthorId] ON [OfficeFormActivityLog]([AuthorId]);

    PRINT 'Created OfficeFormActivityLog';
END
GO

-- ── 9. OfficeFormEmailQueue ─────────────────────

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'OfficeFormEmailQueue')
BEGIN
    CREATE TABLE [dbo].[OfficeFormEmailQueue] (
        [Id]              INT            IDENTITY(1,1) PRIMARY KEY,
        [ToEmail]         NVARCHAR(500)  NOT NULL,
        [Subject]         NVARCHAR(500)  NOT NULL,
        [BodyHtml]        NVARCHAR(MAX)  NOT NULL,
        [SubmissionId]    INT            NULL,
        [TriggerType]     NVARCHAR(50)   NOT NULL,
        [Status]          NVARCHAR(20)   NOT NULL DEFAULT 'Queued',
        [ErrorMessage]    NVARCHAR(1000) NULL,
        [AttemptCount]    INT            NOT NULL DEFAULT 0,
        [CreatedAt]       DATETIME2      NOT NULL DEFAULT GETDATE(),
        [SentAt]          DATETIME2      NULL,

        CONSTRAINT [FK_EmailQueue_SubmissionId] FOREIGN KEY ([SubmissionId]) REFERENCES [OfficeFormSubmissions]([Id]),
        CONSTRAINT [CK_EmailQueue_Status] CHECK ([Status] IN ('Queued', 'Sent', 'Failed'))
    );

    CREATE INDEX [IX_EmailQueue_Status] ON [OfficeFormEmailQueue]([Status]);
    CREATE INDEX [IX_EmailQueue_SubmissionId] ON [OfficeFormEmailQueue]([SubmissionId]);

    PRINT 'Created OfficeFormEmailQueue';
END
GO

PRINT '=== All Fast_Form tables created successfully ===';
GO
