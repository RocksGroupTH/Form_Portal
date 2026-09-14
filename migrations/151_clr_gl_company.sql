-- 151_clr_gl_company.sql
-- Target: Rocks_Portal_Form AND Rocks_Portal_Form_UAT — apply to BOTH, before the code.
--
-- AP-3.2's G/L category master, split in two: what every company shares, and
-- what each company decides for itself.
--
--   AccClearAdvanceGl         the CATEGORY — its number, its Thai name, its
--                             English name, its order. One row per account,
--                             shared by every company, unchanged by this file.
--
--   AccClearAdvanceGlCompany  that company's RULES for it — which dimension a
--                             line charging it must carry, and whether it is
--                             offered at all. One row per (Company, account).
--
-- *** WHY THE SPLIT RATHER THAN A BrandCode COLUMN ON THE EXISTING TABLE ***
-- The two names are a fact about the account and are the same wherever it is
-- charged; duplicating them per company is four places for one Thai name to
-- drift. The dimension and the on/off switch are genuinely per company, which
-- is the whole request. The user chose this shape directly on 2026-09-14:
-- "เลขบัญชี+ชื่อเป็นชุดเดียวทุกแบรนด์ ... ติ๊ก Dimension ต่างกันได้".
--
-- *** Company IS THE BC COMPANY, NOT THE CLAIM BRAND ***
-- PCTH / KSI / PCMY / UNO. Measured 2026-09-14, AP-3's active claim brands are
-- ROCKS and PCTH — ROCKS maps to PCTH through AccBrandErpInterface — so keying
-- these rules on the claim brand would answer NOTHING for every ROCKS claim,
-- which is most of them. The chart of accounts is the company's, and so is a
-- rule about which of its accounts AP-3 may charge. Every neighbouring lookup
-- (AccClrBuGlMap, the BRANCH dimension list, the vendor cards) keys the same
-- way, for the same reason.
--
-- *** DimensionType KEEPS ITS THREE VALUES ***
-- The screen shows two checkboxes and this column stores what they mean:
-- Employee alone, Branch alone, or Both. There is deliberately NO value for
-- "neither" — a category nobody may charge is `IsActive = 0`, not a row with an
-- empty dimension — which is what makes "at least one dimension" a property of
-- the storage rather than a check somebody has to remember to run.
--
-- *** THE BACKFILL COPIES TODAY'S ANSWER TO ALL FOUR COMPANIES ***
-- 43 categories × 4 = 172 rows, each carrying the DimensionType and IsActive
-- the single shared row holds today. Nothing about AP-3 changes on the day this
-- lands; the four copies only start to differ once somebody edits one.
--
-- AccClearAdvanceGl.DimensionType and .IsActive are NOT dropped here and are
-- NOT read by the new code. Dropping a column out from under a running build is
-- its own outage — migration 128's rule — so they stay until a later migration
-- after this deploy.
--
-- *** BOTH FORM DATABASES, BEFORE THE CODE ***
-- SQL Server binds object names at COMPILE time, so the table missing from
-- EITHER database is "Invalid object name" — the whole query fails rather than
-- answering empty — and AP-3 resolves either database depending on who is
-- asking. Same hazard migrations 090, 120, 144, 147, 149 and 150 carry.
--
-- NOT dual-written and NOT in MASTER_TABLES, exactly like the AccClearAdvanceGl
-- it hangs off: each environment keeps its own answer, reached through
-- getAccPool(). `check:alignment` MUST STILL READ 28 afterwards; 29 means the
-- wrong table was created.

SET NOCOUNT ON;
SET XACT_ABORT ON;

IF OBJECT_ID('dbo.AccClearAdvanceGl', 'U') IS NULL
BEGIN
  RAISERROR ('Migration 151 expects dbo.AccClearAdvanceGl — wrong database? Apply 109 first.', 16, 1);
END
GO

IF OBJECT_ID('dbo.AccClearAdvanceGlCompany', 'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[AccClearAdvanceGlCompany] (
    [Id]            INT           IDENTITY(1,1) NOT NULL
      CONSTRAINT [PK_AccClearAdvanceGlCompany] PRIMARY KEY,
    [Company]       NVARCHAR(20)  NOT NULL,
    [GlAccountNo]   NVARCHAR(20)  NOT NULL,
    [DimensionType] NVARCHAR(20)  NOT NULL
      CONSTRAINT [DF_AccClearAdvanceGlCompany_Dim] DEFAULT ('Employee'),
    [IsActive]      BIT           NOT NULL
      CONSTRAINT [DF_AccClearAdvanceGlCompany_Active] DEFAULT (1),
    [CreatedAt]     DATETIME2(7)  NOT NULL
      CONSTRAINT [DF_AccClearAdvanceGlCompany_Created] DEFAULT (SYSDATETIME()),
    [UpdatedAt]     DATETIME2(7)  NOT NULL
      CONSTRAINT [DF_AccClearAdvanceGlCompany_Updated] DEFAULT (SYSDATETIME()),
    CONSTRAINT [UQ_AccClearAdvanceGlCompany] UNIQUE ([Company], [GlAccountNo]),
    -- No 'None'. See the header: a category nobody may charge is IsActive = 0.
    CONSTRAINT [CK_AccClearAdvanceGlCompany_Dim]
      CHECK ([DimensionType] IN ('Employee', 'Branch', 'Both'))
  );
  PRINT 'Created AccClearAdvanceGlCompany';
END
ELSE PRINT 'AccClearAdvanceGlCompany already exists - skipped';
GO

-- Backfill: today's single answer, copied to each company. Idempotent — only
-- (Company, account) pairs that do not exist yet are inserted, so re-running
-- never overwrites an edit somebody has since made.
INSERT INTO [dbo].[AccClearAdvanceGlCompany] (Company, GlAccountNo, DimensionType, IsActive)
SELECT c.Company, g.GlAccountNo, g.DimensionType, g.IsActive
FROM [dbo].[AccClearAdvanceGl] AS g
CROSS JOIN (VALUES ('PCTH'), ('KSI'), ('PCMY'), ('UNO')) AS c(Company)
WHERE NOT EXISTS (
  SELECT 1 FROM [dbo].[AccClearAdvanceGlCompany] AS x
  WHERE x.Company = c.Company AND x.GlAccountNo = g.GlAccountNo
);
PRINT CONCAT('Backfilled ', CAST(@@ROWCOUNT AS NVARCHAR(10)), ' company rules');
GO

-- Post-apply check: one row per company per category, and nothing lost.
DECLARE @cats INT = (SELECT COUNT(*) FROM [dbo].[AccClearAdvanceGl]);
DECLARE @rules INT = (SELECT COUNT(*) FROM [dbo].[AccClearAdvanceGlCompany]);
PRINT CONCAT('AccClearAdvanceGl: ', @cats, ' categories; AccClearAdvanceGlCompany: ', @rules, ' rules (expect ', @cats * 4, ' after a first apply)');
GO
