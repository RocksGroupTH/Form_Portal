-- The seller on one expense line — who issued the tax invoice.
--
-- The OCR already reads all three per receipt and the confirm modal shows them;
-- until now they were kept only on AccClearAdvanceWht, which exists only where
-- withholding does. A VAT receipt without WHT therefore lost its seller
-- entirely, which is what stopped Tax Invoice Name from being sendable at all.
--
-- Nullable: a hand-added line has no receipt behind it, and an OCR that could
-- not read a tax id must leave the column empty rather than carry a guess.
-- Accounting fills those in at the ACCOUNT step, from the invoice they hold.
--
-- Widths match AccClearAdvanceWht so the same OCR value fits in both.
-- Applied to Rocks_Portal_Form_UAT and Rocks_Portal_Form.

SET NOCOUNT ON;
SET XACT_ABORT ON;

IF OBJECT_ID('dbo.AccClearAdvanceItem', 'U') IS NULL
BEGIN
  RAISERROR ('Migration 140 expects dbo.AccClearAdvanceItem — wrong database?', 16, 1);
END
ELSE
BEGIN
  IF COL_LENGTH('dbo.AccClearAdvanceItem', 'TaxId') IS NULL
    ALTER TABLE [dbo].[AccClearAdvanceItem] ADD [TaxId] NVARCHAR(40) NULL;

  IF COL_LENGTH('dbo.AccClearAdvanceItem', 'PayeeName') IS NULL
    ALTER TABLE [dbo].[AccClearAdvanceItem] ADD [PayeeName] NVARCHAR(600) NULL;

  IF COL_LENGTH('dbo.AccClearAdvanceItem', 'PayeeAddress') IS NULL
    ALTER TABLE [dbo].[AccClearAdvanceItem] ADD [PayeeAddress] NVARCHAR(1000) NULL;
END
