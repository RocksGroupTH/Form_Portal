-- migrations/047_acc_request_department_code.sql
-- AP-1: snapshot the requester DepartmentCode on the request. DB = Fast_Form.
SET XACT_ABORT ON;
GO

IF COL_LENGTH('dbo.AccRequest', 'RequesterDepartmentCode') IS NULL
  ALTER TABLE dbo.AccRequest ADD RequesterDepartmentCode NVARCHAR(50) NULL;
GO
