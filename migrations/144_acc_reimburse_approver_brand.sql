-- 144_acc_reimburse_approver_brand.sql
-- Target: Rocks_Portal_Form AND Rocks_Portal_Form_UAT — apply to BOTH, before the code.
--
-- Per-brand scope for AP-4's accounting approvers. Mirrors AccApproverInterfaceBrand
-- (migration 038), including the ON DELETE CASCADE, with ONE deliberate difference:
--
--   AP-1 reads ZERO rows as "unrestricted". AP-4 does not, and must not. Here zero
--   rows means zero brands, and zero brands means the person is not an approver at
--   all -- the tick set IS the on/off switch (AccReimburseApprover.IsActive is kept
--   in step with it by the settings service). In AP-1, clearing an approver's last
--   tick silently promotes them to every brand; there is no state here where absence
--   means "all".
--
-- No backfill. AccReimburseApprover ships empty. If it is NOT empty when this runs,
-- every existing approver has zero brand rows and therefore approves nothing until an
-- admin ticks a brand. That is the fail-safe direction and it is deliberate.
--
-- No CHECK on InterfaceBrandCode, deliberately -- AccApproverInterfaceBrand (038) has
-- none either, and the vocabulary is enforced in TypeScript by isErpInterfaceBrandCode
-- (src/lib/acc/erp-interface-brands.ts). Removing that filter at the call site is what
-- would turn a foreign, unrecognised string into a grant -- the database will store it
-- without complaint either way.
--
-- Same ids on both sides: this table is dual-written (src/lib/acc/dual-write.ts) and
-- listed in MASTER_TABLES (scripts/checks/verify-master-alignment.ts), so production
-- and Rocks_Portal_Form_UAT must agree row for row, id and all.
SET XACT_ABORT ON;
GO
IF OBJECT_ID('dbo.AccReimburseApproverBrand', 'U') IS NULL
CREATE TABLE [dbo].[AccReimburseApproverBrand] (
  [Id]                 INT IDENTITY(1,1) NOT NULL
    CONSTRAINT [PK_AccReimburseApproverBrand] PRIMARY KEY,
  [ApproverId]         INT NOT NULL,
  [InterfaceBrandCode] NVARCHAR(20) NOT NULL,
  [CreatedAt]          DATETIME2(7) NOT NULL
    CONSTRAINT [DF_AccReimburseApproverBrand_Created] DEFAULT (SYSDATETIME()),
  CONSTRAINT [FK_AccReimburseApproverBrand_Approver] FOREIGN KEY ([ApproverId])
    REFERENCES [dbo].[AccReimburseApprover]([Id]) ON DELETE CASCADE,
  CONSTRAINT [UQ_AccReimburseApproverBrand] UNIQUE ([ApproverId], [InterfaceBrandCode])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AccReimburseApproverBrand_Approver')
  CREATE INDEX [IX_AccReimburseApproverBrand_Approver]
    ON [dbo].[AccReimburseApproverBrand] ([ApproverId]);
GO
