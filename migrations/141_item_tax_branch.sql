-- The seller's branch on the tax invoice, as the five-digit code the Revenue
-- Department uses: 00000 for the head office, 00001 for the first branch.
--
-- BC keeps it as Code[5] on the Vendor ("NWTH Branch Code"), and the journal
-- line's Branch Code is filled from the vendor card — so this is the SELLER's
-- branch, never ours. Code[5] is why the column is 5 wide: a longer value could
-- not be a branch code.
--
-- Nullable, and nothing is sent when it is null: BC then keeps whatever the
-- vendor card holds. A guess would put a branch onto a tax filing.

SET NOCOUNT ON;
SET XACT_ABORT ON;

IF OBJECT_ID('dbo.AccClearAdvanceItem', 'U') IS NULL
BEGIN
  RAISERROR ('Migration 141 expects dbo.AccClearAdvanceItem — wrong database?', 16, 1);
END
ELSE
BEGIN
  IF COL_LENGTH('dbo.AccClearAdvanceItem', 'TaxBranchCode') IS NULL
    ALTER TABLE [dbo].[AccClearAdvanceItem] ADD [TaxBranchCode] NVARCHAR(5) NULL;
END
