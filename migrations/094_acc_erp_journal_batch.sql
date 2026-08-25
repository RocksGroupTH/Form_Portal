-- 094: Environment-aware Journal Batch cache — batches synced from BC per Company
-- AND environment (Production vs Sandbox), so AP-2 (Sandbox) and AP-1 (Production)
-- each see only the batches that exist where they post. In the form database.
-- Apply on BOTH Rocks_Portal_Form AND Rocks_Portal_Form_UAT.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'AccErpJournalBatch')
CREATE TABLE dbo.AccErpJournalBatch (
  Id          INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AccErpJournalBatch PRIMARY KEY,
  Company     NVARCHAR(20)  NOT NULL,   -- interface target (Company)
  Environment NVARCHAR(20)  NOT NULL,   -- 'Production' | 'Sandbox'
  BatchName   NVARCHAR(100) NOT NULL,
  DisplayName NVARCHAR(200) NULL,
  TemplateName NVARCHAR(100) NULL,
  SyncedAt    DATETIME2     NOT NULL CONSTRAINT DF_AccErpJournalBatch_SyncedAt DEFAULT SYSDATETIME(),
  CONSTRAINT UQ_AccErpJournalBatch UNIQUE (Company, Environment, BatchName)
);
GO
PRINT '=== Migration 094 complete (AccErpJournalBatch) ===';
GO
