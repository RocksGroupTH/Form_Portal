-- =============================================
-- Migration: HR Department ↔ ERP dimension mapping (AP-1)
-- Database: Fast_Form
-- Apply: npm run apply-sql -- --db Fast_Form --file migrations/020_fast_form_acc_department_map.sql
--
-- DEPRECATED: Table moved to Fast_Core.DepartmentErpMap (021 + 022).
-- New environments should apply 021 on Fast_Core only.
-- =============================================

USE [Fast_Form];
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AccDepartmentErpMap')
BEGIN
  CREATE TABLE [dbo].[AccDepartmentErpMap] (
    [Id]                INT            IDENTITY(1,1) NOT NULL,
    [BrandCode]         NVARCHAR(20)   NOT NULL,
    [HrDepartmentId]    NVARCHAR(50)   NOT NULL,
    [HrDepartmentName]  NVARCHAR(200)  NULL,
    [ErpDimensionCode]  NVARCHAR(50)   NOT NULL,
    [ErpCode]           NVARCHAR(50)   NOT NULL,
    [MappedBy]          INT            NULL,
    [MappedAt]          DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT [PK_AccDepartmentErpMap] PRIMARY KEY ([Id]),
    CONSTRAINT [UQ_AccDepartmentErpMap_Dept] UNIQUE ([BrandCode], [HrDepartmentId])
  );

  CREATE INDEX [IX_AccDepartmentErpMap_Brand]
    ON [dbo].[AccDepartmentErpMap]([BrandCode]);

  PRINT 'Created AccDepartmentErpMap';
END
ELSE PRINT 'AccDepartmentErpMap already exists — skipping';
GO
