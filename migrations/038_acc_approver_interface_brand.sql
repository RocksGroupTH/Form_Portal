-- Migration: per-approver Interface ERP group visibility (PCTH, KSI, PCMY, UNO)
-- Empty = approver sees all groups (backward compatible).

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AccApproverInterfaceBrand')
BEGIN
  CREATE TABLE [dbo].[AccApproverInterfaceBrand] (
    [Id]                  INT           IDENTITY(1,1) NOT NULL,
    [ApproverId]          INT           NOT NULL,
    [InterfaceBrandCode]  NVARCHAR(20)  NOT NULL,
    [CreatedAt]           DATETIME2     NOT NULL CONSTRAINT [DF_AccApproverInterfaceBrand_CreatedAt] DEFAULT SYSDATETIME(),
    CONSTRAINT [PK_AccApproverInterfaceBrand] PRIMARY KEY ([Id]),
    CONSTRAINT [FK_AccApproverInterfaceBrand_Approver]
      FOREIGN KEY ([ApproverId]) REFERENCES [dbo].[AccApprover]([Id]) ON DELETE CASCADE,
    CONSTRAINT [UQ_AccApproverInterfaceBrand] UNIQUE ([ApproverId], [InterfaceBrandCode])
  );

  CREATE INDEX [IX_AccApproverInterfaceBrand_Approver]
    ON [dbo].[AccApproverInterfaceBrand]([ApproverId]);

  PRINT 'Created AccApproverInterfaceBrand';
END
ELSE PRINT 'AccApproverInterfaceBrand already exists — skipping';
GO
