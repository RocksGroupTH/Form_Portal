-- =============================================
-- Migration: AP-1 same-day multi-brand allowlist
-- Database: Fast_Form
-- Apply: npm run apply-sql -- --db Fast_Form --file migrations/043_acc_same_day_brand_staff.sql
-- =============================================

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AccSameDayBrandStaff')
BEGIN
  CREATE TABLE [dbo].[AccSameDayBrandStaff] (
    [Id]          INT           IDENTITY(1,1) PRIMARY KEY,
    [StaffId]     INT           NOT NULL,
    [Email]       NVARCHAR(200) NULL,
    [DisplayName] NVARCHAR(200) NULL,
    [IsActive]    BIT           NOT NULL DEFAULT 1,
    [CreatedBy]   INT           NULL,
    [CreatedAt]   DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    [UpdatedAt]   DATETIME2     NOT NULL DEFAULT SYSDATETIME()
  );
  CREATE UNIQUE INDEX [UX_AccSameDayBrandStaff_StaffId] ON [AccSameDayBrandStaff]([StaffId]);
  PRINT 'Created AccSameDayBrandStaff';
END
GO

PRINT '=== Migration 043 complete ===';
GO
