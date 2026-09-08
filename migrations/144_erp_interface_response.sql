-- What Business Central actually answered on the last interface attempt.
--
-- We stored a message we had derived from it — a count on failure, a summary on
-- success — and threw the response away. When BC refused one line out of four it
-- said which and why, in its own words, and nobody could read them without
-- opening BC.
--
-- Kept for the last attempt only: a retry replaces it, because what anyone needs
-- is the answer to the send they are looking at. NVARCHAR(MAX) rather than a
-- guess at a ceiling — the writer truncates, the column does not have to.

SET NOCOUNT ON;
SET XACT_ABORT ON;

IF OBJECT_ID('dbo.AccRequest', 'U') IS NULL
BEGIN
  RAISERROR ('Migration 144 expects dbo.AccRequest — wrong database?', 16, 1);
END
ELSE
BEGIN
  IF COL_LENGTH('dbo.AccRequest', 'ErpInterfaceResponse') IS NULL
    ALTER TABLE [dbo].[AccRequest] ADD [ErpInterfaceResponse] NVARCHAR(MAX) NULL;
END
