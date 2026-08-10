-- =============================================
-- Migration: Fast_Core - NII requester HR snapshot columns
-- Database: Fast_Core
-- Feature: persist Employee/HrBrand context at submit time
-- =============================================

USE [Fast_Core];
GO

IF COL_LENGTH('dbo.NewItemInventoryRequest', 'EmployeeId') IS NULL
BEGIN
    ALTER TABLE [dbo].[NewItemInventoryRequest] ADD
        [EmployeeId]                UNIQUEIDENTIFIER NULL,
        [StaffId]                   INT              NULL,
        [HrBrandId]                 INT              NULL,
        [RequesterFullName]         NVARCHAR(200)    NULL,
        [RequesterFullNameTh]       NVARCHAR(200)    NULL,
        [RequesterEmail]            NVARCHAR(200)    NULL,
        [RequesterPhone]            NVARCHAR(50)     NULL,
        [RequesterPosition]         NVARCHAR(200)    NULL,
        [RequesterDepartmentId]     INT              NULL,
        [RequesterDepartmentName]     NVARCHAR(200)    NULL,
        [ManagerStaffId]            INT              NULL,
        [CompanyName]               NVARCHAR(200)    NULL,
        [CompanyTaxId]              NVARCHAR(30)     NULL;

    PRINT 'Added HR requester snapshot columns to NewItemInventoryRequest';
END
ELSE
    PRINT 'NewItemInventoryRequest HR snapshot columns already exist — skipping';
GO
