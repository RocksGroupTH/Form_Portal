-- The acknowledgement checklist, and which rules each request ticked.
--
-- Apply with (BOTH databases):
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/089_acc_reimburse_rule.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/089_acc_reimburse_rule.sql
--
-- Rules are soft-deleted and the ticks are stored per rule id, so a request
-- approved months ago still renders with the wording that was in force when it
-- was submitted, after Settings has been edited.
IF OBJECT_ID('dbo.AccReimburseRule', 'U') IS NULL
CREATE TABLE [dbo].[AccReimburseRule] (
  [Id]        INT IDENTITY(1,1) NOT NULL CONSTRAINT [PK_AccReimburseRule] PRIMARY KEY,
  [RuleText]  NVARCHAR(1000) NOT NULL,
  [SortOrder] INT NOT NULL CONSTRAINT [DF_AccReimburseRule_Sort] DEFAULT (0),
  [IsActive]  BIT NOT NULL CONSTRAINT [DF_AccReimburseRule_Active] DEFAULT (1),
  [UpdatedBy] INT NULL,
  [UpdatedAt] DATETIME2(7) NOT NULL CONSTRAINT [DF_AccReimburseRule_Updated] DEFAULT (SYSDATETIME())
);
GO
IF OBJECT_ID('dbo.AccReimburseRuleAck', 'U') IS NULL
CREATE TABLE [dbo].[AccReimburseRuleAck] (
  [RequestId] INT NOT NULL,
  [RuleId]    INT NOT NULL,
  CONSTRAINT [PK_AccReimburseRuleAck] PRIMARY KEY ([RequestId], [RuleId]),
  CONSTRAINT [FK_AccReimburseRuleAck_Request] FOREIGN KEY ([RequestId])
    REFERENCES [dbo].[AccRequest]([Id]) ON DELETE CASCADE,
  CONSTRAINT [FK_AccReimburseRuleAck_Rule] FOREIGN KEY ([RuleId])
    REFERENCES [dbo].[AccReimburseRule]([Id])
);
GO
IF NOT EXISTS (SELECT 1 FROM [dbo].[AccReimburseRule])
  INSERT INTO [dbo].[AccReimburseRule] ([RuleText], [SortOrder])
  VALUES (N'ส่งเอกสารตัวจริงให้บัญชีภายในวันจันทร์ 12.00 เพื่อรับเงินวันศุกร์', 1);
GO
