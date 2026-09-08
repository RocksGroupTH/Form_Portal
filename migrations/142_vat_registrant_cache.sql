-- What the Revenue Department says about a seller's tax id.
--
-- rdws.rd.go.th answers a 13-digit number with the registered name, the branch
-- and the date the RD approved the business to issue tax invoices. Cached
-- because a registration does not change from one receipt to the next, and the
-- RD publishes no rate limit for us to guess at.
--
-- NotRegistered is a real answer, not a miss: a small seller is not on the VAT
-- register, and input tax from one cannot be claimed. Storing it stops us asking
-- the same question about the same number on every upload.

SET NOCOUNT ON;
SET XACT_ABORT ON;

IF OBJECT_ID('dbo.AccVatRegistrant', 'U') IS NULL
CREATE TABLE [dbo].[AccVatRegistrant] (
  [TaxId]           NVARCHAR(13)  NOT NULL,
  [NotRegistered]   BIT           NOT NULL CONSTRAINT DF_AccVatRegistrant_NotReg DEFAULT (0),
  [TitleName]       NVARCHAR(100) NULL,
  [Name]            NVARCHAR(300) NULL,
  [BranchNumber]    INT           NULL,
  [BranchCode]      NVARCHAR(5)   NULL,
  [VatRegisteredOn] DATE          NULL,
  [Address]         NVARCHAR(600) NULL,
  [CheckedAt]       DATETIME2(7)  NOT NULL CONSTRAINT DF_AccVatRegistrant_CheckedAt DEFAULT (SYSDATETIME()),
  CONSTRAINT PK_AccVatRegistrant PRIMARY KEY CLUSTERED ([TaxId])
);
