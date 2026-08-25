-- =============================================
-- Migration: AccRequest.RequestNo unique only among assigned numbers
-- Database: Rocks_Portal_Form_UAT (also correct for Rocks_Portal_Form)
-- Apply: npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/084_acc_request_no_filtered_unique.sql
--
-- BUG: UX_AccRequest_RequestNo was a plain UNIQUE index. SQL Server treats NULLs
-- as equal there, so only ONE draft (RequestNo = NULL, assigned at submit) could
-- exist at a time — a second draft failed with "Cannot insert duplicate key ...
-- (<NULL>)". Recreate it FILTERED so many NULL drafts are allowed while assigned
-- numbers stay unique. Shared table (AP-1/AP-2), but this only relaxes the NULL
-- case — non-null RequestNo uniqueness is unchanged.
-- =============================================

IF EXISTS (SELECT 1 FROM sys.indexes
           WHERE name = 'UX_AccRequest_RequestNo' AND object_id = OBJECT_ID('dbo.AccRequest'))
  DROP INDEX UX_AccRequest_RequestNo ON [dbo].[AccRequest];
GO

CREATE UNIQUE INDEX UX_AccRequest_RequestNo
  ON [dbo].[AccRequest] ([RequestNo])
  WHERE [RequestNo] IS NOT NULL;
GO

PRINT '=== Migration 084 complete (RequestNo filtered unique) ===';
GO
