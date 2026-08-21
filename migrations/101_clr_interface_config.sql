-- =============================================
-- Migration: AP-3 Interface ERP config — per-brand Journal Batch only.
-- Database: Rocks_Portal_Form (+ Rocks_Portal_Form_UAT)
-- Apply: npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/101_clr_interface_config.sql
--        npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/101_clr_interface_config.sql
--
-- AP-3 clears an approved AP-2 advance and REVERSES its lines, so the G/L, bank and
-- branch come from the cleared entries — the only ERP setting AP-3 needs of its own
-- is which Journal Batch its clearing journal posts into. The target Company is
-- inherited from AP-2 / AP-1 (read-only). Saved via writeBothPools (Prod + UAT) so
-- the config is identical across environments — must exist in BOTH DBs.
-- =============================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'AccClearAdvanceInterfaceConfig')
BEGIN
  CREATE TABLE [dbo].[AccClearAdvanceInterfaceConfig] (
    [Id]               INT           IDENTITY(1,1) NOT NULL CONSTRAINT PK_AccClearAdvanceInterfaceConfig PRIMARY KEY,
    [BrandCode]        NVARCHAR(20)  NOT NULL,
    [JournalBatchName] NVARCHAR(100) NULL,
    [CreatedAt]        DATETIME2     NOT NULL CONSTRAINT DF_AccClrIfaceCfg_Created DEFAULT SYSDATETIME(),
    [CreatedBy]        INT           NULL,
    [UpdatedAt]        DATETIME2     NULL,
    [UpdatedBy]        INT           NULL,
    CONSTRAINT UQ_AccClearAdvanceInterfaceConfig_Brand UNIQUE ([BrandCode])
  );
  PRINT 'Created AccClearAdvanceInterfaceConfig';
END
ELSE PRINT 'AccClearAdvanceInterfaceConfig already exists — skipping';
GO

PRINT '=== Migration 101 complete ===';
GO
