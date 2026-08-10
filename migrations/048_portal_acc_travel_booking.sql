-- =============================================
-- Migration: AP-17 Accommodation/Ticket Booking Request — detail + settings tables
-- Database: Fast_Form
-- Apply: npm run apply-sql -- --db Fast_Form --file migrations/048_portal_acc_travel_booking.sql
--
-- Reuses shared tables from migration 013 (AccRequest, AccFormMaster, AccApproval,
-- AccActivityLog, AccSequence, AccEmailQueue, AccRequestFile) — NOT recreated here.
-- =============================================

-- 1. AccTravelBooking — one row per request (AP-17 header detail) -----------
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AccTravelBooking')
BEGIN
  CREATE TABLE [dbo].[AccTravelBooking] (
    [Id]                            INT           IDENTITY(1,1) PRIMARY KEY,
    [RequestId]                     INT           NOT NULL,
    -- requester snapshot
    [Phone]                         NVARCHAR(50)  NULL,
    [AllowanceSnapshot]             DECIMAL(18,2) NULL,
    -- reason (ข้อ5)
    [ReasonId]                      INT           NULL,
    [ReasonName]                    NVARCHAR(200) NULL,
    [ReasonCustomText]              NVARCHAR(500) NULL,
    -- work detail (ข้อ7)
    [WorkDetail]                    NVARCHAR(MAX) NULL,
    -- province (ข้อ8)
    [ProvinceId]                    INT           NULL,
    [ProvinceName]                  NVARCHAR(100) NULL,
    -- accommodation (ข้อ10)
    [AccommodationId]               INT           NULL,
    [AccommodationName]             NVARCHAR(200) NULL,
    [AccommodationCustomText]       NVARCHAR(500) NULL,
    [NeedsRoomBooking]              BIT           NOT NULL DEFAULT 0,
    -- date range (ข้อ6) / times (ข้อ11)
    [DepartDate]                    DATE          NULL,
    [ReturnDate]                    DATE          NULL,
    [DepartTime]                    TIME          NULL,
    [ReturnTime]                    TIME          NULL,
    -- go transport (ข้อ12 — go direction)
    [GoVehicleId]                   INT           NULL,
    [GoVehicleName]                 NVARCHAR(200) NULL,
    [GoVehicleCustomText]           NVARCHAR(500) NULL,
    [GoNeedsDepartureLocations]     BIT           NOT NULL DEFAULT 0,
    [GoNeedsTicketBooking]          BIT           NOT NULL DEFAULT 0,
    [GoNeedsDepartTime]             BIT           NOT NULL DEFAULT 0,
    [GoNeedsVehicleRent]            BIT           NOT NULL DEFAULT 0,
    -- return transport (ข้อ12 — return direction)
    [ReturnVehicleId]               INT           NULL,
    [ReturnVehicleName]             NVARCHAR(200) NULL,
    [ReturnVehicleCustomText]       NVARCHAR(500) NULL,
    [ReturnNeedsDepartureLocations] BIT           NOT NULL DEFAULT 0,
    [ReturnNeedsTicketBooking]      BIT           NOT NULL DEFAULT 0,
    [ReturnNeedsDepartTime]         BIT           NOT NULL DEFAULT 0,
    [ReturnNeedsVehicleRent]        BIT           NOT NULL DEFAULT 0,
    -- rent vehicle (ข้อ15/16)
    [RentVehicleId]                 INT           NULL,
    [RentVehicleName]               NVARCHAR(200) NULL,
    [RentVehicleCustomText]         NVARCHAR(500) NULL,
    [NeedsRentBooking]              BIT           NOT NULL DEFAULT 0,
    [RentStartDate]                 DATE          NULL,
    [RentEndDate]                   DATE          NULL,
    -- notes (ข้อ18)
    [Notes]                         NVARCHAR(MAX) NULL,
    -- multi-request chain / per-diem
    [IsContinuation]                BIT           NOT NULL DEFAULT 0,
    [PerDiemDays]                   INT           NOT NULL DEFAULT 0,
    [PerDiemTotal]                  DECIMAL(18,2) NOT NULL DEFAULT 0,
    [GroupKey]                      NVARCHAR(40)  NULL,
    [SortOrder]                     INT           NOT NULL DEFAULT 0,
    [CreatedAt]                     DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    [UpdatedAt]                     DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT [FK_AccTravelBooking_Request] FOREIGN KEY ([RequestId]) REFERENCES [dbo].[AccRequest]([Id]),
    CONSTRAINT [UQ_AccTravelBooking_Request] UNIQUE ([RequestId])
  );
  CREATE INDEX [IX_AccTravelBooking_Request]  ON [dbo].[AccTravelBooking]([RequestId]);
  CREATE INDEX [IX_AccTravelBooking_GroupKey] ON [dbo].[AccTravelBooking]([GroupKey]);
  PRINT 'Created AccTravelBooking';
END
ELSE PRINT 'AccTravelBooking already exists — skipping';
GO

-- 2. AccTravelWorkLocation (ข้อ9, >=1 per request) ---------------------------
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AccTravelWorkLocation')
BEGIN
  CREATE TABLE [dbo].[AccTravelWorkLocation] (
    [Id]              INT           IDENTITY(1,1) PRIMARY KEY,
    [TravelBookingId] INT           NOT NULL,
    [Name]            NVARCHAR(300) NOT NULL,
    [SortOrder]       INT           NOT NULL DEFAULT 0,
    CONSTRAINT [FK_AccTravelWorkLocation_Booking] FOREIGN KEY ([TravelBookingId])
      REFERENCES [dbo].[AccTravelBooking]([Id]) ON DELETE CASCADE
  );
  CREATE INDEX [IX_AccTravelWorkLocation_Booking] ON [dbo].[AccTravelWorkLocation]([TravelBookingId], [SortOrder]);
  PRINT 'Created AccTravelWorkLocation';
END
ELSE PRINT 'AccTravelWorkLocation already exists — skipping';
GO

-- 3. AccTravelDepartureLocation (ข้อ13, when 12.1 flag set) ------------------
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AccTravelDepartureLocation')
BEGIN
  CREATE TABLE [dbo].[AccTravelDepartureLocation] (
    [Id]              INT           IDENTITY(1,1) PRIMARY KEY,
    [TravelBookingId] INT           NOT NULL,
    [Direction]       NVARCHAR(10)  NOT NULL,   -- 'go' | 'return'
    [Name]            NVARCHAR(300) NOT NULL,
    [SortOrder]       INT           NOT NULL DEFAULT 0,
    CONSTRAINT [FK_AccTravelDepartureLocation_Booking] FOREIGN KEY ([TravelBookingId])
      REFERENCES [dbo].[AccTravelBooking]([Id]) ON DELETE CASCADE,
    CONSTRAINT [CK_AccTravelDepartureLocation_Direction] CHECK ([Direction] IN ('go','return'))
  );
  CREATE INDEX [IX_AccTravelDepartureLocation_Booking] ON [dbo].[AccTravelDepartureLocation]([TravelBookingId], [SortOrder]);
  PRINT 'Created AccTravelDepartureLocation';
END
ELSE PRINT 'AccTravelDepartureLocation already exists — skipping';
GO

-- 4. AccTravelBookingDetail (Admin booking fill-in, ข้อ2.x) ------------------
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AccTravelBookingDetail')
BEGIN
  CREATE TABLE [dbo].[AccTravelBookingDetail] (
    [Id]              INT           IDENTITY(1,1) PRIMARY KEY,
    [TravelBookingId] INT           NOT NULL,
    [BookingType]     NVARCHAR(20)  NOT NULL,   -- 'room' | 'ticket' | 'rent'
    [BookingNo]       NVARCHAR(100) NULL,
    [PriceExVat]      DECIMAL(18,2) NULL,
    [CreatedBy]       INT           NULL,
    [CreatedAt]       DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT [FK_AccTravelBookingDetail_Booking] FOREIGN KEY ([TravelBookingId])
      REFERENCES [dbo].[AccTravelBooking]([Id]) ON DELETE CASCADE,
    CONSTRAINT [CK_AccTravelBookingDetail_Type] CHECK ([BookingType] IN ('room','ticket','rent'))
  );
  CREATE INDEX [IX_AccTravelBookingDetail_Booking] ON [dbo].[AccTravelBookingDetail]([TravelBookingId]);
  PRINT 'Created AccTravelBookingDetail';
END
ELSE PRINT 'AccTravelBookingDetail already exists — skipping';
GO

-- 5. Settings: AccTravelReason (ข้อ5) ----------------------------------------
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AccTravelReason')
BEGIN
  CREATE TABLE [dbo].[AccTravelReason] (
    [Id]                   INT           IDENTITY(1,1) PRIMARY KEY,
    [Name]                 NVARCHAR(200) NOT NULL,
    [IsActive]             BIT           NOT NULL DEFAULT 1,
    [SortOrder]            INT           NOT NULL DEFAULT 0,
    [RequiresCustomReason] BIT           NOT NULL DEFAULT 0,
    [CreatedBy]            INT           NULL,
    [CreatedAt]            DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    [UpdatedAt]            DATETIME2     NOT NULL DEFAULT SYSDATETIME()
  );
  PRINT 'Created AccTravelReason';
END
ELSE PRINT 'AccTravelReason already exists — skipping';
GO

IF NOT EXISTS (SELECT 1 FROM [dbo].[AccTravelReason])
BEGIN
  INSERT INTO [dbo].[AccTravelReason] (Name, RequiresCustomReason, SortOrder) VALUES
    (N'สำรวจพื้นที่/สาขาใหม่',    0, 1),
    (N'เปิดสาขาใหม่',             0, 2),
    (N'ปรับปรุง/รีโนเวดสาขา',     0, 3);
  PRINT 'Seeded AccTravelReason defaults';
END
GO

-- 6. Settings: AccTravelAccommodation (ข้อ10) --------------------------------
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AccTravelAccommodation')
BEGIN
  CREATE TABLE [dbo].[AccTravelAccommodation] (
    [Id]                   INT           IDENTITY(1,1) PRIMARY KEY,
    [Name]                 NVARCHAR(200) NOT NULL,
    [IsActive]             BIT           NOT NULL DEFAULT 1,
    [SortOrder]            INT           NOT NULL DEFAULT 0,
    [RequiresCustomReason] BIT           NOT NULL DEFAULT 0,
    [CreatedBy]            INT           NULL,
    [CreatedAt]            DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    [UpdatedAt]            DATETIME2     NOT NULL DEFAULT SYSDATETIME()
  );
  PRINT 'Created AccTravelAccommodation';
END
ELSE PRINT 'AccTravelAccommodation already exists — skipping';
GO

IF NOT EXISTS (SELECT 1 FROM [dbo].[AccTravelAccommodation])
BEGIN
  INSERT INTO [dbo].[AccTravelAccommodation] (Name, RequiresCustomReason, SortOrder) VALUES
    (N'โรงแรม',              0, 1),
    (N'อพาร์ทเม้น/หอพัก',    0, 2),
    (N'ไม่พักค้างคืน',       0, 3);
  PRINT 'Seeded AccTravelAccommodation defaults';
END
GO

-- 7. Settings: AccTravelVehicleOption (ข้อ12) --------------------------------
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AccTravelVehicleOption')
BEGIN
  CREATE TABLE [dbo].[AccTravelVehicleOption] (
    [Id]                   INT           IDENTITY(1,1) PRIMARY KEY,
    [Name]                 NVARCHAR(200) NOT NULL,
    [IsActive]             BIT           NOT NULL DEFAULT 1,
    [SortOrder]            INT           NOT NULL DEFAULT 0,
    [RequiresCustomReason] BIT           NOT NULL DEFAULT 0,
    [CreatedBy]            INT           NULL,
    [CreatedAt]            DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    [UpdatedAt]            DATETIME2     NOT NULL DEFAULT SYSDATETIME()
  );
  PRINT 'Created AccTravelVehicleOption';
END
ELSE PRINT 'AccTravelVehicleOption already exists — skipping';
GO

IF NOT EXISTS (SELECT 1 FROM [dbo].[AccTravelVehicleOption])
BEGIN
  INSERT INTO [dbo].[AccTravelVehicleOption] (Name, RequiresCustomReason, SortOrder) VALUES
    (N'รถยนต์ส่วนตัว', 0, 1),
    (N'รถทัวร์โดยสาร', 0, 2),
    (N'รถตู้โดยสาร',   0, 3),
    (N'เครื่องบิน',    0, 4);
  PRINT 'Seeded AccTravelVehicleOption defaults';
END
GO

-- 8. Settings: AccTravelRentVehicle (ข้อ15) ----------------------------------
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AccTravelRentVehicle')
BEGIN
  CREATE TABLE [dbo].[AccTravelRentVehicle] (
    [Id]                   INT           IDENTITY(1,1) PRIMARY KEY,
    [Name]                 NVARCHAR(200) NOT NULL,
    [IsActive]             BIT           NOT NULL DEFAULT 1,
    [SortOrder]            INT           NOT NULL DEFAULT 0,
    [RequiresCustomReason] BIT           NOT NULL DEFAULT 0,
    [CreatedBy]            INT           NULL,
    [CreatedAt]            DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    [UpdatedAt]            DATETIME2     NOT NULL DEFAULT SYSDATETIME()
  );
  PRINT 'Created AccTravelRentVehicle';
END
ELSE PRINT 'AccTravelRentVehicle already exists — skipping';
GO

IF NOT EXISTS (SELECT 1 FROM [dbo].[AccTravelRentVehicle])
BEGIN
  INSERT INTO [dbo].[AccTravelRentVehicle] (Name, RequiresCustomReason, SortOrder) VALUES
    (N'รถยนต์',            0, 1),
    (N'รถจักรยานยนต์',     0, 2),
    (N'รถตู้พร้อมคนขับ',   0, 3),
    (N'ไม่เช่า',           0, 4);
  PRINT 'Seeded AccTravelRentVehicle defaults';
END
GO

-- 9. Seed AccFormMaster AP-17 (table created in migration 013) --------------
IF NOT EXISTS (SELECT 1 FROM [dbo].[AccFormMaster] WHERE FormCode = 'AP-17')
  INSERT INTO [dbo].[AccFormMaster]
    (FormCode, GroupName, FormNameTh, FormNameEn, RunningPrefix, OwnerContact, SortOrder)
  VALUES
    ('AP-17', 'Accounting',
     N'แบบฟอร์มขอจองที่พัก/ตั๋วโดยสาร (ทำงานต่างจังหวัด)',
     N'Accommodation/Ticket Booking Request Form (for working out of town)',
     'TRL', NULL, 17);
GO

PRINT '=== Migration 048 complete ===';
GO
