-- =============================================
-- Migration: Travel Expense (AP-1) detail tables
-- Database: Fast_Form
-- Apply: npm run apply-sql -- --db Fast_Form --file migrations/014_portal_acc_travel_expense.sql
-- =============================================

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AccTravelExpense')
BEGIN
  CREATE TABLE [dbo].[AccTravelExpense] (
    [Id]               INT           IDENTITY(1,1) PRIMARY KEY,
    [RequestId]        INT           NOT NULL,
    [TravelDate]       DATE          NULL,
    [WorkDetail]       NVARCHAR(MAX) NULL,
    -- vehicle snapshot
    [VehicleId]        INT           NULL,
    [VehicleName]      NVARCHAR(100) NULL,
    [RatePerKm]        DECIMAL(18,2) NULL,
    [IsManualEntry]    BIT           NOT NULL DEFAULT 0,
    -- direction (rate mode)
    [Direction]        NVARCHAR(10)  NULL,   -- round | onward | return
    -- onward leg
    [OnwardOrigin]     NVARCHAR(400) NULL,
    [OnwardOriginLat]  DECIMAL(10,7) NULL,
    [OnwardOriginLng]  DECIMAL(10,7) NULL,
    [OnwardDestination] NVARCHAR(400) NULL,
    [OnwardDestLat]    DECIMAL(10,7) NULL,
    [OnwardDestLng]    DECIMAL(10,7) NULL,
    [OnwardDistanceKm] DECIMAL(18,2) NULL,
    -- return leg
    [ReturnOrigin]     NVARCHAR(400) NULL,
    [ReturnOriginLat]  DECIMAL(10,7) NULL,
    [ReturnOriginLng]  DECIMAL(10,7) NULL,
    [ReturnDestination] NVARCHAR(400) NULL,
    [ReturnDestLat]    DECIMAL(10,7) NULL,
    [ReturnDestLng]    DECIMAL(10,7) NULL,
    [ReturnDistanceKm] DECIMAL(18,2) NULL,
    -- totals
    [TotalDistanceKm]  DECIMAL(18,2) NULL,
    [TotalAmount]      DECIMAL(18,2) NULL,
    CONSTRAINT [FK_AccTravel_Request] FOREIGN KEY ([RequestId]) REFERENCES [AccRequest]([Id]),
    CONSTRAINT [UQ_AccTravel_Request] UNIQUE ([RequestId]),
    CONSTRAINT [CK_AccTravel_Direction] CHECK ([Direction] IS NULL OR [Direction] IN ('round','onward','return'))
  );
  CREATE INDEX [IX_AccTravel_Request] ON [AccTravelExpense]([RequestId]);
  PRINT 'Created AccTravelExpense';
END
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AccTravelExpenseItem')
BEGIN
  CREATE TABLE [dbo].[AccTravelExpenseItem] (
    [Id]              INT           IDENTITY(1,1) PRIMARY KEY,
    [TravelExpenseId] INT           NOT NULL,
    [ItemType]        NVARCHAR(20)  NOT NULL,  -- fare | toll | parking
    [Amount]          DECIMAL(18,2) NOT NULL DEFAULT 0,
    [SortOrder]       INT           NOT NULL DEFAULT 0,
    CONSTRAINT [FK_AccTravelItem_Parent] FOREIGN KEY ([TravelExpenseId]) REFERENCES [AccTravelExpense]([Id]),
    CONSTRAINT [CK_AccTravelItem_Type] CHECK ([ItemType] IN ('fare','toll','parking'))
  );
  CREATE INDEX [IX_AccTravelItem_Parent] ON [AccTravelExpenseItem]([TravelExpenseId]);
  PRINT 'Created AccTravelExpenseItem';
END
GO

PRINT '=== Migration 014 complete ===';
GO
