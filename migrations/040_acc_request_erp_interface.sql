-- ERP Interface send status on approved travel-expense requests (Fast_Form)

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('[dbo].[AccRequest]') AND name = 'ErpInterfaceStatus'
)
BEGIN
  ALTER TABLE [dbo].[AccRequest]
    ADD [ErpInterfaceStatus]      NVARCHAR(20)   NULL,
        [ErpInterfaceError]         NVARCHAR(2000) NULL,
        [ErpInterfaceSentAt]        DATETIME2      NULL,
        [ErpInterfaceSentBy]        INT            NULL,
        [ErpInterfaceEnvironment]   NVARCHAR(20)   NULL;

  PRINT 'Added ErpInterface* columns to AccRequest';
END
ELSE PRINT 'AccRequest ErpInterface columns already exist — skipping';
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = 'CK_AccRequest_ErpInterfaceStatus'
)
BEGIN
  ALTER TABLE [dbo].[AccRequest]
    ADD CONSTRAINT [CK_AccRequest_ErpInterfaceStatus]
      CHECK ([ErpInterfaceStatus] IS NULL OR [ErpInterfaceStatus] IN ('Pending', 'Sent', 'Failed'));
  PRINT 'Added CK_AccRequest_ErpInterfaceStatus';
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_AccRequest_ErpInterfaceStatus' AND object_id = OBJECT_ID('[dbo].[AccRequest]')
)
BEGIN
  CREATE INDEX [IX_AccRequest_ErpInterfaceStatus]
    ON [dbo].[AccRequest]([ErpInterfaceStatus])
    WHERE [ErpInterfaceStatus] IS NOT NULL;
  PRINT 'Created IX_AccRequest_ErpInterfaceStatus';
END
GO
