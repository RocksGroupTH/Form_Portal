-- The ภ.ง.ด. type decided for one WHT payee — what picks the BC vendor at send
-- time (WHT-PND.3 / WHT-PND.53), replacing the single G/L line AP-3 sends today.
--
-- Nullable on purpose, and NULL is not a default: it means nobody has decided.
-- A tax id that is not 13 clean digits suggests nothing, and the send refuses a
-- clearing whose WHT has no type rather than choosing a vendor for accounting.
--
-- Existing rows stay NULL. They are already sent; back-filling them from the
-- rule would put a machine's guess where a person's decision belongs, and once
-- stored the two cannot be told apart.
--
-- Applied to Rocks_Portal_Form_UAT and Rocks_Portal_Form. AP-3 runs UAT-gated,
-- but the column goes to both so the schemas do not drift.

SET NOCOUNT ON;
SET XACT_ABORT ON;

IF OBJECT_ID('dbo.AccClearAdvanceWht', 'U') IS NULL
BEGIN
  RAISERROR ('Migration 139 expects dbo.AccClearAdvanceWht — wrong database?', 16, 1);
END
ELSE
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.AccClearAdvanceWht') AND name = 'PndType'
  )
    ALTER TABLE [dbo].[AccClearAdvanceWht] ADD [PndType] NVARCHAR(10) NULL;
END
