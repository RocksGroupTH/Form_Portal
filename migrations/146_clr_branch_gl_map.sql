-- Which G/L account an expense line posts to, decided by its BRANCH.
--
-- The BU rule (migration 145) cannot express this one. RFM — "Rocks Malaysia" —
-- is a BRANCH dimension value in PCTH with no Location behind it, so nothing
-- resolves a BU for it: `buCode` comes out null, the codeunit falls back to COCO
-- and a BU-keyed rule never matches. A branch is also simply a different
-- question: BU says what kind of shop it is, branch says which one.
--
-- Branch beats BU where both answer, because it is the more specific of the two.
-- A branch with no row here falls through to the BU rule, and a BU with no row
-- falls through to the account the expense was coded to — so adding this table
-- changes nothing until a row exists.
--
-- Keyed by Company: G/L accounts belong to the BC company the journal posts into.

SET NOCOUNT ON;
SET XACT_ABORT ON;

IF OBJECT_ID('dbo.AccClrBranchGlMap', 'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[AccClrBranchGlMap] (
    [Id]           INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AccClrBranchGlMap PRIMARY KEY,
    [Company]      NVARCHAR(20)  NOT NULL,
    [BranchCode]   NVARCHAR(20)  NOT NULL,
    [GlAccountNo]  NVARCHAR(20)  NOT NULL,
    [IsActive]     BIT           NOT NULL CONSTRAINT DF_AccClrBranchGlMap_IsActive DEFAULT (1),
    [Note]         NVARCHAR(200) NULL,
    [CreatedAt]    DATETIME2(7)  NOT NULL CONSTRAINT DF_AccClrBranchGlMap_Created DEFAULT (SYSDATETIME()),
    [UpdatedAt]    DATETIME2(7)  NOT NULL CONSTRAINT DF_AccClrBranchGlMap_Updated DEFAULT (SYSDATETIME()),
    CONSTRAINT UQ_AccClrBranchGlMap_Company_Branch UNIQUE ([Company], [BranchCode])
  );
END
GO

-- The one accounting has named: a line booked to the Rocks Malaysia branch is
-- money paid on another company's behalf, which is the account 110723001 already
-- means everywhere else in AP-3.
MERGE [dbo].[AccClrBranchGlMap] AS t
USING (VALUES ('PCTH', 'RFM', '110723001')) AS s (Company, BranchCode, GlAccountNo)
ON t.Company = s.Company AND t.BranchCode = s.BranchCode
WHEN NOT MATCHED THEN
  INSERT (Company, BranchCode, GlAccountNo, Note)
  VALUES (s.Company, s.BranchCode, s.GlAccountNo, N'Rocks Malaysia — จ่ายแทนบริษัทอื่น');
