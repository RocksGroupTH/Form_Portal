-- =============================================
-- Migration: Multi-vehicle sections per travel day (AP-1)
-- Database: Fast_Form
-- Apply: npm run apply-sql -- --db Fast_Form --file migrations/026_acc_travel_vehicle_sections.sql
-- =============================================

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AccTravelVehicleSection')
BEGIN
  CREATE TABLE [dbo].[AccTravelVehicleSection] (
    [Id]              INT           IDENTITY(1,1) PRIMARY KEY,
    [TravelExpenseId] INT           NOT NULL,
    [SortOrder]       INT           NOT NULL DEFAULT 0,
    [VehicleId]       INT           NULL,
    [VehicleName]     NVARCHAR(100) NULL,
    [RatePerKm]       DECIMAL(18,2) NULL,
    [IsManualEntry]   BIT           NOT NULL DEFAULT 1,
    CONSTRAINT [FK_AccTravelSection_Travel] FOREIGN KEY ([TravelExpenseId])
      REFERENCES [dbo].[AccTravelExpense]([Id]) ON DELETE CASCADE
  );
  CREATE INDEX [IX_AccTravelSection_Parent] ON [dbo].[AccTravelVehicleSection]([TravelExpenseId], [SortOrder]);
  PRINT 'Created AccTravelVehicleSection';
END
GO

IF COL_LENGTH('dbo.AccTravelExpenseItem', 'VehicleSectionId') IS NULL
BEGIN
  ALTER TABLE [dbo].[AccTravelExpenseItem] ADD [VehicleSectionId] INT NULL;
  ALTER TABLE [dbo].[AccTravelExpenseItem] ADD CONSTRAINT [FK_AccTravelItem_Section]
    FOREIGN KEY ([VehicleSectionId]) REFERENCES [dbo].[AccTravelVehicleSection]([Id]) ON DELETE CASCADE;
  PRINT 'Added AccTravelExpenseItem.VehicleSectionId';
END
GO

PRINT '=== Migration 026 complete ===';
GO
