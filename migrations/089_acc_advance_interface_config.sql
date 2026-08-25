-- 089: AP-2's own Interface ERP config — a dedicated table, fully separate from
-- AP-1's shared config tables. One row per claim brand. Written via writeBothPools
-- (Prod + UAT) but never touches any AP-1 table.
--
-- NOTE: must be applied to BOTH Rocks_Portal_Form_UAT and Rocks_Portal_Form (prod)
-- for the dual-write save to succeed.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'AccAdvanceInterfaceConfig')
CREATE TABLE dbo.AccAdvanceInterfaceConfig (
  Id                 INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AccAdvanceInterfaceConfig PRIMARY KEY,
  BrandCode          NVARCHAR(20)  NOT NULL,
  InterfaceBrandCode NVARCHAR(20)  NULL,   -- target Company (ส่งเข้าแบรนด์)
  GlAccountNo        NVARCHAR(50)  NULL,
  GlErpDescription   NVARCHAR(500) NULL,
  BankAccountNo      NVARCHAR(50)  NULL,
  JournalBatchName   NVARCHAR(100) NULL,
  CreatedAt          DATETIME2     NOT NULL CONSTRAINT DF_AccAdvIfaceCfg_Created DEFAULT SYSDATETIME(),
  CreatedBy          INT           NULL,
  UpdatedAt          DATETIME2     NULL,
  UpdatedBy          INT           NULL,
  CONSTRAINT UQ_AccAdvanceInterfaceConfig_Brand UNIQUE (BrandCode)
);
GO
