-- The seller's Vendor No. in BC, chosen by accounting.
--
-- Becomes Tax Vendor No. on the VAT line, whose OnValidate fills Tax Invoice
-- Name, Branch Code and the VAT registration from the vendor card.
--
-- Chosen, never derived. A tax id maps to many vendor cards — Central Pattana
-- has 24 under one number, one per mall, told apart only by a prefix in the
-- name — so matching by tax id narrows the list and a person picks from it.
-- Blank where the seller is not a vendor of ours, which is the ordinary case for
-- a one-off purchase.

SET NOCOUNT ON;
SET XACT_ABORT ON;

IF OBJECT_ID('dbo.AccClearAdvanceItem', 'U') IS NULL
BEGIN
  RAISERROR ('Migration 143 expects dbo.AccClearAdvanceItem — wrong database?', 16, 1);
END
ELSE
BEGIN
  IF COL_LENGTH('dbo.AccClearAdvanceItem', 'TaxVendorNo') IS NULL
    ALTER TABLE [dbo].[AccClearAdvanceItem] ADD [TaxVendorNo] NVARCHAR(20) NULL;
END
