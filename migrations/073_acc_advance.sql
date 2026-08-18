-- =============================================
-- Migration: Advance (AP-2) detail table
-- Database: Rocks_Portal_Form (+ Rocks_Portal_Form_UAT)
-- Apply: npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/073_acc_advance.sql
--        npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/073_acc_advance.sql
-- =============================================

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AccAdvance')
BEGIN
  CREATE TABLE [dbo].[AccAdvance] (
    [Id]                INT           IDENTITY(1,1) PRIMARY KEY,
    [RequestId]         INT           NOT NULL,
    -- เนื้อหา Advance
    [NeedByDate]        DATE          NULL,           -- วันที่ต้องการเริ่มใช้เงิน
    [ExpectedClearDate] DATE          NULL,           -- วันที่คาดว่าจะเคลียร์ (<= NeedByDate + 30 วัน)
    [Purpose]           NVARCHAR(MAX) NULL,           -- รายละเอียดค่าใช้จ่าย (free text)
    [Currency]          NVARCHAR(10)  NOT NULL CONSTRAINT [DF_AccAdvance_Currency] DEFAULT (N'THB'), -- Phase 1: THB เท่านั้น
    [Amount]            DECIMAL(18,2) NULL,           -- จำนวนเงินที่ขอเบิก
    [WhtNote]           NVARCHAR(500) NULL,           -- หมายเหตุ WHT (manual เท่านั้น — ไม่ post journal)
    -- Audit
    [CreatedAt]         DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    [UpdatedAt]         DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT [FK_AccAdvance_Request] FOREIGN KEY ([RequestId]) REFERENCES [AccRequest]([Id]),
    CONSTRAINT [UQ_AccAdvance_Request] UNIQUE ([RequestId])
  );
  CREATE INDEX [IX_AccAdvance_Request] ON [AccAdvance]([RequestId]);
  PRINT 'Created AccAdvance';
END
ELSE PRINT 'AccAdvance already exists — skipping';
GO

PRINT '=== Migration 062 complete ===';
GO
