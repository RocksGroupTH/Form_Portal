-- =============================================
-- Migration: per-vehicle travel config for AP-17 "การเดินทาง" tab
--   AccTravelVehicleOption gains 4 behaviour flags + a departure-place child list.
-- Database: Fast_Form
-- Apply: npm run apply-sql -- --db Fast_Form --file migrations/052_acc_travel_vehicle_config.sql
-- =============================================

-- 1. Behaviour flags on AccTravelVehicleOption ------------------------------
IF COL_LENGTH('dbo.AccTravelVehicleOption', 'NeedsDepartureLocations') IS NULL
  ALTER TABLE [dbo].[AccTravelVehicleOption] ADD [NeedsDepartureLocations] BIT NOT NULL DEFAULT 0;
GO
IF COL_LENGTH('dbo.AccTravelVehicleOption', 'NeedsTicketBooking') IS NULL
  ALTER TABLE [dbo].[AccTravelVehicleOption] ADD [NeedsTicketBooking] BIT NOT NULL DEFAULT 0;
GO
IF COL_LENGTH('dbo.AccTravelVehicleOption', 'NeedsDepartTime') IS NULL
  ALTER TABLE [dbo].[AccTravelVehicleOption] ADD [NeedsDepartTime] BIT NOT NULL DEFAULT 0;
GO
IF COL_LENGTH('dbo.AccTravelVehicleOption', 'NeedsVehicleRent') IS NULL
  ALTER TABLE [dbo].[AccTravelVehicleOption] ADD [NeedsVehicleRent] BIT NOT NULL DEFAULT 0;
GO

-- 2. AccTravelVehiclePlace — per-vehicle departure/place list ---------------
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AccTravelVehiclePlace')
BEGIN
  CREATE TABLE [dbo].[AccTravelVehiclePlace] (
    [Id]              INT           IDENTITY(1,1) PRIMARY KEY,
    [VehicleOptionId] INT           NOT NULL,
    [Name]            NVARCHAR(300) NOT NULL,
    [SortOrder]       INT           NOT NULL DEFAULT 0,
    CONSTRAINT [FK_AccTravelVehiclePlace_Vehicle] FOREIGN KEY ([VehicleOptionId])
      REFERENCES [dbo].[AccTravelVehicleOption]([Id]) ON DELETE CASCADE
  );
  CREATE INDEX [IX_AccTravelVehiclePlace_Vehicle] ON [dbo].[AccTravelVehiclePlace]([VehicleOptionId], [SortOrder]);
  PRINT 'Created AccTravelVehiclePlace';
END
ELSE PRINT 'AccTravelVehiclePlace already exists — skipping';
GO

-- 3. Seed example config for เครื่องบิน ------------------------------------
UPDATE [dbo].[AccTravelVehicleOption]
  SET NeedsTicketBooking = 1, NeedsDepartTime = 1, NeedsDepartureLocations = 1
  WHERE Name = N'เครื่องบิน';
GO

INSERT INTO [dbo].[AccTravelVehiclePlace] (VehicleOptionId, Name, SortOrder)
SELECT v.Id, p.Name, p.SortOrder
FROM [dbo].[AccTravelVehicleOption] v
CROSS APPLY (VALUES (N'สุวรรณภูมิ (BKK)', 0), (N'ดอนเมือง (DMK)', 1)) AS p(Name, SortOrder)
WHERE v.Name = N'เครื่องบิน'
  AND NOT EXISTS (SELECT 1 FROM [dbo].[AccTravelVehiclePlace] x WHERE x.VehicleOptionId = v.Id);
GO

PRINT '=== Migration 052 complete ===';
GO
