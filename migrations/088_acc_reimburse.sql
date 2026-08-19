-- AP-4's own detail tables — the request header stays in AccRequest.
--
-- Apply with (BOTH databases):
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/088_acc_reimburse.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/088_acc_reimburse.sql
IF OBJECT_ID('dbo.AccReimburse', 'U') IS NULL
CREATE TABLE [dbo].[AccReimburse] (
  [RequestId]       INT NOT NULL CONSTRAINT [PK_AccReimburse] PRIMARY KEY,
  [Purpose]         NVARCHAR(500) NULL,
  [TotalAmount]     DECIMAL(18,2) NOT NULL CONSTRAINT [DF_AccReimburse_Total] DEFAULT (0),
  [ExcelFileId]     INT NULL,
  [RulesAcceptedAt] DATETIME2(7) NULL,
  CONSTRAINT [FK_AccReimburse_Request] FOREIGN KEY ([RequestId])
    REFERENCES [dbo].[AccRequest]([Id]) ON DELETE CASCADE
);
GO
-- ExcelFileId is deliberately NOT a foreign key to AccRequestFile: a file row is
-- deleted when the user swaps the workbook, and a FK would either block that or
-- cascade into the request. The service nulls it instead.
IF OBJECT_ID('dbo.AccReimburseItem', 'U') IS NULL
CREATE TABLE [dbo].[AccReimburseItem] (
  [Id]          INT IDENTITY(1,1) NOT NULL CONSTRAINT [PK_AccReimburseItem] PRIMARY KEY,
  [RequestId]   INT NOT NULL,
  [SortOrder]   INT NOT NULL CONSTRAINT [DF_AccReimburseItem_Sort] DEFAULT (0),
  [ExpenseDate] DATE NOT NULL,
  [Description] NVARCHAR(500) NOT NULL,
  [Amount]      DECIMAL(18,2) NOT NULL,
  [VatAmount]   DECIMAL(18,2) NULL,
  [WhtAmount]   DECIMAL(18,2) NULL,
  CONSTRAINT [FK_AccReimburseItem_Request] FOREIGN KEY ([RequestId])
    REFERENCES [dbo].[AccRequest]([Id]) ON DELETE CASCADE
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AccReimburseItem_Request')
  CREATE INDEX [IX_AccReimburseItem_Request] ON [dbo].[AccReimburseItem] ([RequestId], [SortOrder]);
GO
