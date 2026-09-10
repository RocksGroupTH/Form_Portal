-- Which G/L account an expense line posts to, decided by its BU.
--
-- A store the company owns books the expense to its own account; a franchise or
-- a managed one books it to a receivable instead, because the money will be
-- charged back. The BU dimension is what says which a Location is, and it is
-- already resolved on every line, so the mapping is BU → account.
--
-- A table rather than a constant for two reasons. G/L accounts move — 110723001
-- is already configurable elsewhere in AP-3 — and the BU list is longer than the
-- rules anyone has written down: PCTH has eight (COCO, DODO-M, DOCO, DODO, CTPS,
-- DODO-A, LICNS, EXPR) against three confirmed mappings. A BU with no row here
-- keeps the account the expense was booked to, which is what every line did
-- before this table existed, so an unmapped BU changes nothing until accounting
-- fills it in.
--
-- Keyed by Company, not by claim brand: G/L accounts belong to the BC company
-- the journal posts into.

SET NOCOUNT ON;
SET XACT_ABORT ON;

IF OBJECT_ID('dbo.AccClrBuGlMap', 'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[AccClrBuGlMap] (
    [Id]           INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AccClrBuGlMap PRIMARY KEY,
    [Company]      NVARCHAR(20)  NOT NULL,
    [BuCode]       NVARCHAR(20)  NOT NULL,
    [GlAccountNo]  NVARCHAR(20)  NOT NULL,
    [IsActive]     BIT           NOT NULL CONSTRAINT DF_AccClrBuGlMap_IsActive DEFAULT (1),
    [Note]         NVARCHAR(200) NULL,
    [CreatedAt]    DATETIME2(7)  NOT NULL CONSTRAINT DF_AccClrBuGlMap_Created DEFAULT (SYSDATETIME()),
    [UpdatedAt]    DATETIME2(7)  NOT NULL CONSTRAINT DF_AccClrBuGlMap_Updated DEFAULT (SYSDATETIME()),
    CONSTRAINT UQ_AccClrBuGlMap_Company_Bu UNIQUE ([Company], [BuCode])
  );
END
GO

-- The three confirmed by accounting on 2026-09-09. COCO is deliberately absent:
-- "บัญชีตาม คชจ" is the absence of a rule, and a row saying so would be a rule.
-- RFM was withdrawn pending accounting's answer and is not seeded.
MERGE [dbo].[AccClrBuGlMap] AS t
USING (VALUES
  ('PCTH', 'DOCO',   '110721001'),
  ('PCTH', 'DODO',   '110721001'),
  ('PCTH', 'DODO-M', '110721001')
) AS s (Company, BuCode, GlAccountNo)
ON t.Company = s.Company AND t.BuCode = s.BuCode
WHEN NOT MATCHED THEN
  INSERT (Company, BuCode, GlAccountNo) VALUES (s.Company, s.BuCode, s.GlAccountNo);
