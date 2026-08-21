-- 101: AP-2 ERP send-attempt history — one row per PV send, so a Sent advance
-- can be pulled back (attempt -> 'Resent') and re-sent (new attempt -> 'Sent')
-- while keeping the ADV↔PV mapping. Form/DB only; no BC changes.
-- Apply on BOTH Rocks_Portal_Form AND Rocks_Portal_Form_UAT.

IF NOT EXISTS (
  SELECT 1 FROM sys.objects
  WHERE object_id = OBJECT_ID('dbo.AccAdvanceErpAttempt') AND type = 'U'
)
BEGIN
  CREATE TABLE dbo.AccAdvanceErpAttempt (
    Id            INT IDENTITY(1,1) PRIMARY KEY,
    RequestId     INT NOT NULL,
    AttemptNo     INT NOT NULL,
    ErpDocumentNo NVARCHAR(35) NULL,
    Environment   NVARCHAR(20) NULL,
    Company       NVARCHAR(100) NULL,
    Status        NVARCHAR(20) NOT NULL,   -- 'Sent' | 'Resent'
    SentAt        DATETIME2 NULL,
    SentBy        INT NULL,
    ResentBy      INT NULL,
    ResentAt      DATETIME2 NULL,
    CreatedAt     DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    UpdatedAt     DATETIME2 NOT NULL DEFAULT SYSDATETIME()
  );
  CREATE INDEX IX_AccAdvanceErpAttempt_Request
    ON dbo.AccAdvanceErpAttempt (RequestId, AttemptNo);
END
GO

-- Backfill: every AP-2 request currently 'Sent' becomes attempt #1 ('Sent'),
-- so the history is continuous from day one. Company is unknown historically → NULL.
INSERT INTO dbo.AccAdvanceErpAttempt
  (RequestId, AttemptNo, ErpDocumentNo, Environment, Company, Status, SentAt, SentBy)
SELECT r.Id, 1, r.ErpDocumentNo, r.ErpInterfaceEnvironment, NULL, 'Sent',
       r.ErpInterfaceSentAt, r.ErpInterfaceSentBy
FROM dbo.AccRequest r
WHERE r.FormCode = 'AP-2' AND r.ErpInterfaceStatus = 'Sent'
  AND NOT EXISTS (SELECT 1 FROM dbo.AccAdvanceErpAttempt a WHERE a.RequestId = r.Id);
GO

PRINT '=== Migration 101 complete (AccAdvanceErpAttempt + backfill) ===';
GO
