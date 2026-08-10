-- =============================================
-- Migration: Fast_Core - New Item Inventory tables
-- Database: Fast_Core
-- Feature: /request/new-item-inventory
-- =============================================

USE [Fast_Core];
GO

-- ── 1. NewItemInventoryRequest ──────────────────
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'NewItemInventoryRequest')
BEGIN
    CREATE TABLE [dbo].[NewItemInventoryRequest] (
        [Id]                          INT            IDENTITY(1,1) PRIMARY KEY,
        [RequestNo]                   NVARCHAR(32)   NULL,
        [BrandCode]                   NVARCHAR(20)   NOT NULL,
        [ItemType]                    NVARCHAR(20)   NOT NULL,
        [ItemFor]                     NVARCHAR(20)   NOT NULL DEFAULT 'ALL',
        [DescriptionTH]               NVARCHAR(40)   NULL,
        [DescriptionEN]               NVARCHAR(40)   NULL,
        [ItemReference]               NVARCHAR(100)  NULL,
        [VendorNo]                    NVARCHAR(50)   NULL,
        [VendorName]                  NVARCHAR(200)  NULL,
        [LocationCode]                NVARCHAR(50)   NULL,
        [PackSize]                    NVARCHAR(100)  NULL,
        [StockCountingCode]           NVARCHAR(50)   NULL,
        [BaseUomCode]                 NVARCHAR(50)   NULL,
        [PurchUomCode]                NVARCHAR(50)   NULL,
        [SalesUomCode]                NVARCHAR(50)   NULL,
        [LeadtimeFirstLot]            INT            NULL,
        [LeadtimeReorder]             INT            NULL,
        -- Costing ACC fields (filled at step 4)
        [NoSeriesCode]                NVARCHAR(50)   NULL,
        [ItemTypeAcc]                 NVARCHAR(50)   NULL,
        [AllowInvoiceDisc]            BIT            NULL,
        [CostingMethod]               NVARCHAR(50)   NULL,
        [PurchasingCode]              NVARCHAR(50)   NULL,
        [GenProdPostingGroup]         NVARCHAR(50)   NULL,
        [VatProdPostingGroup]         NVARCHAR(50)   NULL,
        [InventoryPostingGroup]       NVARCHAR(50)   NULL,
        [ItemCategoryCode]            NVARCHAR(50)   NULL,
        [PhysInvtCountingPeriodCode]  NVARCHAR(50)   NULL,
        -- Workflow
        [Status]                      NVARCHAR(20)   NOT NULL DEFAULT 'Draft',
        [CurrentStepCode]             NVARCHAR(20)   NULL,
        -- BC sync
        [BcItemNo]                    NVARCHAR(50)   NULL,
        [BcSyncedAt]                  DATETIME2      NULL,
        [SalesPriceApprovedAt]        DATETIME2      NULL,
        -- Audit
        [SubmittedBy]                 INT            NULL,
        [SubmittedAt]                 DATETIME2      NULL,
        [CreatedBy]                   INT            NULL,
        [CreatedAt]                   DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
        [UpdatedAt]                   DATETIME2      NOT NULL DEFAULT SYSDATETIME(),

        CONSTRAINT [CK_NIIRequest_ItemType] CHECK ([ItemType] IN ('RM', 'FIXED_ASSET')),
        CONSTRAINT [CK_NIIRequest_Status] CHECK ([Status] IN
            ('Draft','Submitted','InReview','Approved','Returned','Rejected','BcSynced','Complete'))
    );

    CREATE INDEX [IX_NIIRequest_BrandCode]   ON [NewItemInventoryRequest]([BrandCode]);
    CREATE INDEX [IX_NIIRequest_Status]      ON [NewItemInventoryRequest]([Status]);
    CREATE INDEX [IX_NIIRequest_SubmittedBy] ON [NewItemInventoryRequest]([SubmittedBy]);

    -- Filtered unique index: RequestNo is NULL for drafts (many allowed),
    -- unique only once allocated at submit. A plain UNIQUE constraint would
    -- permit just one NULL row in SQL Server, breaking multi-draft.
    CREATE UNIQUE INDEX [UX_NIIRequest_RequestNo]
        ON [NewItemInventoryRequest]([RequestNo]) WHERE [RequestNo] IS NOT NULL;

    PRINT 'Created NewItemInventoryRequest';
END
ELSE PRINT 'NewItemInventoryRequest already exists - skipping';
GO

-- ── 2. NewItemInventoryRequestPrice ─────────────
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'NewItemInventoryRequestPrice')
BEGIN
    CREATE TABLE [dbo].[NewItemInventoryRequestPrice] (
        [Id]            INT            IDENTITY(1,1) PRIMARY KEY,
        [RequestId]     INT            NOT NULL,
        [PriceInclSST]  DECIMAL(18,4)  NULL,
        [Moq]           DECIMAL(18,4)  NULL,
        [Unit]          NVARCHAR(50)   NULL,
        [SortOrder]     INT            NOT NULL DEFAULT 0,

        CONSTRAINT [FK_NIIPrice_Request] FOREIGN KEY ([RequestId])
            REFERENCES [NewItemInventoryRequest]([Id])
    );
    CREATE INDEX [IX_NIIPrice_RequestId] ON [NewItemInventoryRequestPrice]([RequestId]);
    PRINT 'Created NewItemInventoryRequestPrice';
END
ELSE PRINT 'NewItemInventoryRequestPrice already exists - skipping';
GO

-- ── 3. NewItemInventoryRequestUom ───────────────
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'NewItemInventoryRequestUom')
BEGIN
    CREATE TABLE [dbo].[NewItemInventoryRequestUom] (
        [Id]         INT            IDENTITY(1,1) PRIMARY KEY,
        [RequestId]  INT            NOT NULL,
        [Uom1Code]   NVARCHAR(50)   NULL,
        [Qty]        DECIMAL(18,4)  NULL,
        [Uom2Code]   NVARCHAR(50)   NULL,
        [SortOrder]  INT            NOT NULL DEFAULT 0,

        CONSTRAINT [FK_NIIUom_Request] FOREIGN KEY ([RequestId])
            REFERENCES [NewItemInventoryRequest]([Id])
    );
    CREATE INDEX [IX_NIIUom_RequestId] ON [NewItemInventoryRequestUom]([RequestId]);
    PRINT 'Created NewItemInventoryRequestUom';
END
ELSE PRINT 'NewItemInventoryRequestUom already exists - skipping';
GO

-- ── 4. NewItemInventoryApprover ─────────────────
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'NewItemInventoryApprover')
BEGIN
    CREATE TABLE [dbo].[NewItemInventoryApprover] (
        [Id]         INT            IDENTITY(1,1) PRIMARY KEY,
        [BrandCode]  NVARCHAR(20)   NOT NULL,
        [StepCode]   NVARCHAR(20)   NOT NULL,
        [MemberId]   INT            NOT NULL,
        [IsActive]   BIT            NOT NULL DEFAULT 1,
        [CreatedBy]  INT            NULL,
        [CreatedAt]  DATETIME2      NOT NULL DEFAULT SYSDATETIME(),

        CONSTRAINT [CK_NIIApprover_StepCode] CHECK ([StepCode] IN
            ('PCM_MGR','PLAN_MGR','SR_SCM','COSTING_ACC','ASSIST_AP','SALES_PL'))
    );
    CREATE INDEX [IX_NIIApprover_BrandStep] ON [NewItemInventoryApprover]([BrandCode],[StepCode],[IsActive]);
    PRINT 'Created NewItemInventoryApprover';
END
ELSE PRINT 'NewItemInventoryApprover already exists - skipping';
GO

-- ── 5. NewItemInventoryApproval ─────────────────
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'NewItemInventoryApproval')
BEGIN
    CREATE TABLE [dbo].[NewItemInventoryApproval] (
        [Id]          INT            IDENTITY(1,1) PRIMARY KEY,
        [RequestId]   INT            NOT NULL,
        [StepCode]    NVARCHAR(20)   NOT NULL,
        [AssignedTo]  INT            NULL,
        [Status]      NVARCHAR(20)   NOT NULL DEFAULT 'Pending',
        [Comment]     NVARCHAR(2000) NULL,
        [ActionedBy]  INT            NULL,
        [ActionedAt]  DATETIME2      NULL,
        [CreatedAt]   DATETIME2      NOT NULL DEFAULT SYSDATETIME(),

        CONSTRAINT [FK_NIIApproval_Request] FOREIGN KEY ([RequestId])
            REFERENCES [NewItemInventoryRequest]([Id]),
        CONSTRAINT [CK_NIIApproval_Status] CHECK ([Status] IN
            ('Pending','Approved','Rejected','Returned','Skipped'))
    );
    CREATE INDEX [IX_NIIApproval_RequestId]  ON [NewItemInventoryApproval]([RequestId]);
    CREATE INDEX [IX_NIIApproval_AssignedTo] ON [NewItemInventoryApproval]([AssignedTo]);
    CREATE INDEX [IX_NIIApproval_Status]     ON [NewItemInventoryApproval]([Status]);
    PRINT 'Created NewItemInventoryApproval';
END
ELSE PRINT 'NewItemInventoryApproval already exists - skipping';
GO

-- ── 6. NewItemInventoryActivityLog ──────────────
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'NewItemInventoryActivityLog')
BEGIN
    CREATE TABLE [dbo].[NewItemInventoryActivityLog] (
        [Id]            INT            IDENTITY(1,1) PRIMARY KEY,
        [RequestId]     INT            NOT NULL,
        [AuthorId]      INT            NULL,
        [Action]        NVARCHAR(50)   NOT NULL,
        [Note]          NVARCHAR(2000) NULL,
        [MetadataJson]  NVARCHAR(MAX)  NULL,
        [CreatedAt]     DATETIME2      NOT NULL DEFAULT SYSDATETIME(),

        CONSTRAINT [FK_NIIActivity_Request] FOREIGN KEY ([RequestId])
            REFERENCES [NewItemInventoryRequest]([Id])
    );
    CREATE INDEX [IX_NIIActivity_RequestId] ON [NewItemInventoryActivityLog]([RequestId]);
    PRINT 'Created NewItemInventoryActivityLog';
END
ELSE PRINT 'NewItemInventoryActivityLog already exists - skipping';
GO

-- ── 7. NewItemInventoryLocation ─────────────────
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'NewItemInventoryLocation')
BEGIN
    CREATE TABLE [dbo].[NewItemInventoryLocation] (
        [Id]         INT            IDENTITY(1,1) PRIMARY KEY,
        [BrandCode]  NVARCHAR(20)   NOT NULL,
        [Code]       NVARCHAR(50)   NOT NULL,
        [Name]       NVARCHAR(200)  NOT NULL,
        [IsActive]   BIT            NOT NULL DEFAULT 1,
        [CreatedBy]  INT            NULL,
        [UpdatedBy]  INT            NULL,
        [CreatedAt]  DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
        [UpdatedAt]  DATETIME2      NOT NULL DEFAULT SYSDATETIME(),

        CONSTRAINT [UQ_NIILocation_BrandCode] UNIQUE ([BrandCode],[Code])
    );
    CREATE INDEX [IX_NIILocation_Brand] ON [NewItemInventoryLocation]([BrandCode],[IsActive]);
    PRINT 'Created NewItemInventoryLocation';
END
ELSE PRINT 'NewItemInventoryLocation already exists - skipping';
GO

-- ── 8. NewItemInventorySequence ─────────────────
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'NewItemInventorySequence')
BEGIN
    CREATE TABLE [dbo].[NewItemInventorySequence] (
        [BrandCode]  NVARCHAR(20)   NOT NULL,
        [YearMonth]  INT            NOT NULL,   -- YYYYMM
        [LastSeq]    INT            NOT NULL DEFAULT 0,
        [UpdatedAt]  DATETIME2      NOT NULL DEFAULT SYSDATETIME(),

        CONSTRAINT [PK_NIISequence] PRIMARY KEY ([BrandCode],[YearMonth])
    );
    PRINT 'Created NewItemInventorySequence';
END
ELSE PRINT 'NewItemInventorySequence already exists - skipping';
GO

-- ── 9. NewItemInventoryEmailQueue ───────────────
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'NewItemInventoryEmailQueue')
BEGIN
    CREATE TABLE [dbo].[NewItemInventoryEmailQueue] (
        [Id]            INT            IDENTITY(1,1) PRIMARY KEY,
        [RequestId]     INT            NULL,
        [ToEmail]       NVARCHAR(500)  NOT NULL,
        [Subject]       NVARCHAR(500)  NOT NULL,
        [BodyHtml]      NVARCHAR(MAX)  NOT NULL,
        [TriggerType]   NVARCHAR(50)   NOT NULL,
        [Status]        NVARCHAR(20)   NOT NULL DEFAULT 'Queued',
        [ErrorMessage]  NVARCHAR(1000) NULL,
        [AttemptCount]  INT            NOT NULL DEFAULT 0,
        [CreatedAt]     DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
        [SentAt]        DATETIME2      NULL,

        CONSTRAINT [CK_NIIEmail_Status] CHECK ([Status] IN ('Queued','Sent','Failed'))
    );
    CREATE INDEX [IX_NIIEmail_Status] ON [NewItemInventoryEmailQueue]([Status]);
    PRINT 'Created NewItemInventoryEmailQueue';
END
ELSE PRINT 'NewItemInventoryEmailQueue already exists - skipping';
GO

-- ── 10. NewItemInventoryBcSyncLog ───────────────
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'NewItemInventoryBcSyncLog')
BEGIN
    CREATE TABLE [dbo].[NewItemInventoryBcSyncLog] (
        [Id]              INT            IDENTITY(1,1) PRIMARY KEY,
        [RequestId]       INT            NOT NULL,
        [AttemptedBy]     INT            NULL,
        [Success]         BIT            NULL,   -- NULL = in-flight
        [HttpStatus]      INT            NULL,
        [BcResponseJson]  NVARCHAR(MAX)  NULL,
        [ErrorMessage]    NVARCHAR(2000) NULL,
        [CreatedAt]       DATETIME2      NOT NULL DEFAULT SYSDATETIME(),

        CONSTRAINT [FK_NIIBcSync_Request] FOREIGN KEY ([RequestId])
            REFERENCES [NewItemInventoryRequest]([Id])
    );
    CREATE INDEX [IX_NIIBcSync_RequestId] ON [NewItemInventoryBcSyncLog]([RequestId]);
    -- Filtered unique index: at most one in-flight attempt per request
    CREATE UNIQUE INDEX [UX_NIIBcSync_InFlight]
        ON [NewItemInventoryBcSyncLog]([RequestId]) WHERE [Success] IS NULL;
    PRINT 'Created NewItemInventoryBcSyncLog';
END
ELSE PRINT 'NewItemInventoryBcSyncLog already exists - skipping';
GO

PRINT '=== Migration 009 complete ===';
GO
