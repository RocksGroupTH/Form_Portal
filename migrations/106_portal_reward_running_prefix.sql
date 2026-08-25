-- Change AP-11 reward request numbering from TOPyy-nnnnn to OPRyy-nnnnn.
-- Apply to both Rocks_Portal_Form and Rocks_Portal_Form_UAT.
-- Existing request numbers are historical identifiers and are intentionally
-- unchanged. The OPR sequence starts independently in AccSequence.

SET NOCOUNT ON;
SET XACT_ABORT ON;

IF DB_NAME() NOT IN (N'Rocks_Portal_Form', N'Rocks_Portal_Form_UAT')
  THROW 51000, 'Migration 106 must run on Rocks_Portal_Form or Rocks_Portal_Form_UAT.', 1;

IF OBJECT_ID(N'dbo.AccFormMaster', N'U') IS NULL
  THROW 51001, 'dbo.AccFormMaster does not exist.', 1;

BEGIN TRANSACTION;

UPDATE [dbo].[AccFormMaster]
SET [RunningPrefix] = N'OPR'
WHERE [FormCode] = N'AP-11'
  AND [RunningPrefix] <> N'OPR';

IF NOT EXISTS (
  SELECT 1
  FROM [dbo].[AccFormMaster]
  WHERE [FormCode] = N'AP-11'
    AND [RunningPrefix] = N'OPR'
)
BEGIN
  ROLLBACK TRANSACTION;
  THROW 51002, 'AP-11 was not found in dbo.AccFormMaster.', 1;
END;

COMMIT TRANSACTION;

PRINT 'AP-11 RunningPrefix is OPR. Existing TOP request numbers were preserved.';
