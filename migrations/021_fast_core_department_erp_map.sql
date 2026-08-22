-- =============================================
-- Migration: HR Department ↔ ERP dimension mapping (org-wide)
-- Database: Fast_Core
-- Apply: npm run apply-sql -- --db Fast_Core --file migrations/021_fast_core_department_erp_map.sql
-- Replaces Fast_Form.AccDepartmentErpMap (see 022 for data migration)
-- =============================================
--
-- HISTORICAL -- already applied. DO NOT RE-RUN: the target moved to
-- Rocks_Portal_Form (migrations 099/100).
--
-- Fast_Core.dbo.DepartmentErpMap is now a SYNONYM for
-- [Rocks_Portal_Form].[dbo].[DepartmentErpMap], and the header above is stale
-- in two ways. The "Database: Fast_Core" line no longer names where the table
-- lives, and this file cannot recreate it there: a synonym does not appear in
-- sys.tables (measured 2026-08-21 -- 0 rows), so the guard below passes and the
-- CREATE TABLE then fails because the synonym already owns the name.
--
-- If DepartmentErpMap ever has to be created again, 099 is the file that does
-- it, against Rocks_Portal_Form.

USE [Fast_Core];
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'DepartmentErpMap')
BEGIN
  CREATE TABLE [dbo].[DepartmentErpMap] (
    [Id]                INT            IDENTITY(1,1) NOT NULL,
    [BrandCode]         NVARCHAR(20)   NOT NULL,
    [HrDepartmentId]    NVARCHAR(50)   NOT NULL,
    [HrDepartmentName]  NVARCHAR(200)  NULL,
    [ErpDimensionCode]  NVARCHAR(50)   NOT NULL,
    [ErpCode]           NVARCHAR(50)   NOT NULL,
    [MappedBy]          INT            NULL,
    [MappedAt]          DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT [PK_DepartmentErpMap] PRIMARY KEY ([Id]),
    CONSTRAINT [UQ_DepartmentErpMap_Dept] UNIQUE ([BrandCode], [HrDepartmentId])
  );

  CREATE INDEX [IX_DepartmentErpMap_Brand]
    ON [dbo].[DepartmentErpMap]([BrandCode]);

  PRINT 'Created DepartmentErpMap';
END
ELSE PRINT 'DepartmentErpMap already exists — skipping';
GO

PRINT '=== Migration 021 complete ===';
GO
