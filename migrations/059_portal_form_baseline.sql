-- Baseline schema for the Form Portal database.
-- Generated from Fast_Form by scripts/generate-form-baseline.ts.
-- Do not edit by hand: regenerate instead.
--
-- Apply with:
--   npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/059_portal_form_baseline.sql
--   npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/059_portal_form_baseline.sql

IF OBJECT_ID('dbo.AccActivityLog', 'U') IS NULL
CREATE TABLE [dbo].[AccActivityLog] (
  [Id] int IDENTITY(1,1) NOT NULL,
  [RequestId] int NOT NULL,
  [AuthorId] int NULL,
  [Action] nvarchar(50) NOT NULL,
  [Note] nvarchar(2000) NULL,
  [MetadataJson] nvarchar(MAX) NULL,
  [CreatedAt] datetime2(7) DEFAULT (sysdatetime()) NOT NULL
);
GO

IF OBJECT_ID('dbo.AccApproval', 'U') IS NULL
CREATE TABLE [dbo].[AccApproval] (
  [Id] int IDENTITY(1,1) NOT NULL,
  [RequestId] int NOT NULL,
  [StepCode] nvarchar(20) NOT NULL,
  [StepOrder] int NOT NULL,
  [AssignedTo] int NULL,
  [AssignedEmail] nvarchar(200) NULL,
  [Status] nvarchar(20) DEFAULT ('Pending') NOT NULL,
  [Comment] nvarchar(2000) NULL,
  [IsChecked] bit NULL,
  [ActionedBy] int NULL,
  [ActionedAt] datetime2(7) NULL,
  [CreatedAt] datetime2(7) DEFAULT (sysdatetime()) NOT NULL,
  [ActionedByStaffId] int NULL
);
GO

IF OBJECT_ID('dbo.AccApprover', 'U') IS NULL
CREATE TABLE [dbo].[AccApprover] (
  [Id] int IDENTITY(1,1) NOT NULL,
  [StaffId] int NULL,
  [Email] nvarchar(200) NOT NULL,
  [DisplayName] nvarchar(200) NULL,
  [IsActive] bit DEFAULT ((1)) NOT NULL,
  [CreatedBy] int NULL,
  [CreatedAt] datetime2(7) DEFAULT (sysdatetime()) NOT NULL,
  [UpdatedAt] datetime2(7) DEFAULT (sysdatetime()) NOT NULL,
  [PhotoUrl] nvarchar(MAX) NULL
);
GO

IF OBJECT_ID('dbo.AccApproverInterfaceBrand', 'U') IS NULL
CREATE TABLE [dbo].[AccApproverInterfaceBrand] (
  [Id] int IDENTITY(1,1) NOT NULL,
  [ApproverId] int NOT NULL,
  [InterfaceBrandCode] nvarchar(20) NOT NULL,
  [CreatedAt] datetime2(7) DEFAULT (sysdatetime()) NOT NULL
);
GO

IF OBJECT_ID('dbo.AccApproverSettingsTab', 'U') IS NULL
CREATE TABLE [dbo].[AccApproverSettingsTab] (
  [Id] int IDENTITY(1,1) NOT NULL,
  [ApproverId] int NOT NULL,
  [TabKey] nvarchar(40) NOT NULL,
  [CreatedAt] datetime DEFAULT (getdate()) NOT NULL
);
GO

IF OBJECT_ID('dbo.AccBrandBankAccount', 'U') IS NULL
CREATE TABLE [dbo].[AccBrandBankAccount] (
  [Id] int IDENTITY(1,1) NOT NULL,
  [BrandCode] nvarchar(20) NOT NULL,
  [AccountNo] nvarchar(50) NOT NULL,
  [DisplayName] nvarchar(200) NULL,
  [IsActive] bit DEFAULT ((1)) NOT NULL,
  [SortOrder] int DEFAULT ((0)) NOT NULL,
  [CreatedBy] int NULL,
  [CreatedAt] datetime2(7) DEFAULT (sysdatetime()) NOT NULL,
  [UpdatedAt] datetime2(7) DEFAULT (sysdatetime()) NOT NULL
);
GO

IF OBJECT_ID('dbo.AccBrandBranchCode', 'U') IS NULL
CREATE TABLE [dbo].[AccBrandBranchCode] (
  [Id] int IDENTITY(1,1) NOT NULL,
  [BrandCode] nvarchar(20) NOT NULL,
  [BranchCode] nvarchar(50) NOT NULL,
  [DisplayName] nvarchar(200) NULL,
  [IsActive] bit DEFAULT ((1)) NOT NULL,
  [SortOrder] int DEFAULT ((0)) NOT NULL,
  [CreatedBy] int NULL,
  [CreatedAt] datetime2(7) DEFAULT (sysdatetime()) NOT NULL,
  [UpdatedAt] datetime2(7) DEFAULT (sysdatetime()) NOT NULL,
  [DeptAsBranch] bit DEFAULT ((0)) NOT NULL,
  [FixedErpDeptCode] nvarchar(50) NULL
);
GO

IF OBJECT_ID('dbo.AccBrandErpInterface', 'U') IS NULL
CREATE TABLE [dbo].[AccBrandErpInterface] (
  [Id] int IDENTITY(1,1) NOT NULL,
  [BrandCode] nvarchar(20) NOT NULL,
  [CreatedBy] int NULL,
  [CreatedAt] datetime2(7) DEFAULT (sysdatetime()) NOT NULL,
  [UpdatedAt] datetime2(7) DEFAULT (sysdatetime()) NOT NULL,
  [InterfaceBrandCode] nvarchar(20) NOT NULL
);
GO

IF OBJECT_ID('dbo.AccBrandErpTargetSetting', 'U') IS NULL
CREATE TABLE [dbo].[AccBrandErpTargetSetting] (
  [Id] int IDENTITY(1,1) NOT NULL,
  [BrandCode] nvarchar(20) NOT NULL,
  [DescriptionPrefix] nvarchar(500) NULL,
  [CreatedBy] int NULL,
  [CreatedAt] datetime2(7) DEFAULT (sysdatetime()) NOT NULL,
  [UpdatedAt] datetime2(7) DEFAULT (sysdatetime()) NOT NULL,
  [BcUatId] nvarchar(100) NULL,
  [BcUatName] nvarchar(200) NULL,
  [BcUatConnectionId] int NULL
);
GO

IF OBJECT_ID('dbo.AccBrandGlAccount', 'U') IS NULL
CREATE TABLE [dbo].[AccBrandGlAccount] (
  [Id] int IDENTITY(1,1) NOT NULL,
  [BrandCode] nvarchar(20) NOT NULL,
  [AccountNo] nvarchar(50) NOT NULL,
  [DisplayName] nvarchar(200) NULL,
  [IsActive] bit DEFAULT ((1)) NOT NULL,
  [SortOrder] int DEFAULT ((0)) NOT NULL,
  [CreatedBy] int NULL,
  [CreatedAt] datetime2(7) DEFAULT (sysdatetime()) NOT NULL,
  [UpdatedAt] datetime2(7) DEFAULT (sysdatetime()) NOT NULL,
  [ErpDescription] nvarchar(500) NULL
);
GO

IF OBJECT_ID('dbo.AccBrandJournalBatch', 'U') IS NULL
CREATE TABLE [dbo].[AccBrandJournalBatch] (
  [Id] int IDENTITY(1,1) NOT NULL,
  [BrandCode] nvarchar(20) NOT NULL,
  [BatchName] nvarchar(50) NOT NULL,
  [DisplayName] nvarchar(200) NULL,
  [IsActive] bit DEFAULT ((1)) NOT NULL,
  [SortOrder] int DEFAULT ((0)) NOT NULL,
  [CreatedBy] int NULL,
  [CreatedAt] datetime2(7) DEFAULT (sysdatetime()) NOT NULL,
  [UpdatedAt] datetime2(7) DEFAULT (sysdatetime()) NOT NULL
);
GO

IF OBJECT_ID('dbo.AccEmailQueue', 'U') IS NULL
CREATE TABLE [dbo].[AccEmailQueue] (
  [Id] int IDENTITY(1,1) NOT NULL,
  [RequestId] int NULL,
  [ToEmail] nvarchar(500) NOT NULL,
  [Subject] nvarchar(500) NOT NULL,
  [BodyHtml] nvarchar(MAX) NOT NULL,
  [TriggerType] nvarchar(50) NOT NULL,
  [Status] nvarchar(20) DEFAULT ('Queued') NOT NULL,
  [ErrorMessage] nvarchar(1000) NULL,
  [AttemptCount] int DEFAULT ((0)) NOT NULL,
  [CreatedAt] datetime2(7) DEFAULT (sysdatetime()) NOT NULL,
  [SentAt] datetime2(7) NULL
);
GO

IF OBJECT_ID('dbo.AccFormBrand', 'U') IS NULL
CREATE TABLE [dbo].[AccFormBrand] (
  [Id] int IDENTITY(1,1) NOT NULL,
  [FormCode] nvarchar(20) NOT NULL,
  [BrandCode] nvarchar(20) NOT NULL,
  [IsActive] bit DEFAULT ((1)) NOT NULL,
  [SortOrder] int DEFAULT ((0)) NOT NULL
);
GO

IF OBJECT_ID('dbo.AccFormMaster', 'U') IS NULL
CREATE TABLE [dbo].[AccFormMaster] (
  [FormCode] nvarchar(20) NOT NULL,
  [GroupName] nvarchar(50) NOT NULL,
  [FormNameTh] nvarchar(200) NOT NULL,
  [FormNameEn] nvarchar(200) NOT NULL,
  [RunningPrefix] nvarchar(10) NOT NULL,
  [OwnerContact] nvarchar(200) NULL,
  [IsActive] bit DEFAULT ((1)) NOT NULL,
  [SortOrder] int DEFAULT ((0)) NOT NULL,
  [CreatedAt] datetime2(7) DEFAULT (sysdatetime()) NOT NULL,
  [UpdatedAt] datetime2(7) DEFAULT (sysdatetime()) NOT NULL
);
GO

IF OBJECT_ID('dbo.AccPerDiem', 'U') IS NULL
CREATE TABLE [dbo].[AccPerDiem] (
  [Id] int IDENTITY(1,1) NOT NULL,
  [RequestId] int NOT NULL,
  [BrandCode] nvarchar(20) NULL,
  [BranchId] int NULL,
  [BranchName] nvarchar(200) NULL,
  [BranchCode] nvarchar(50) NULL,
  [AllowancePerDay] decimal(18, 2) DEFAULT ((0)) NOT NULL,
  [RequestDate] date NULL,
  [DayCount] int DEFAULT ((0)) NOT NULL,
  [TotalAmount] decimal(18, 2) DEFAULT ((0)) NOT NULL,
  [CreatedAt] datetime2(7) DEFAULT (sysdatetime()) NOT NULL,
  [UpdatedAt] datetime2(7) DEFAULT (sysdatetime()) NOT NULL
);
GO

IF OBJECT_ID('dbo.AccPerDiemDay', 'U') IS NULL
CREATE TABLE [dbo].[AccPerDiemDay] (
  [Id] int IDENTITY(1,1) NOT NULL,
  [PerDiemId] int NOT NULL,
  [WorkDate] date NOT NULL,
  [SortOrder] int DEFAULT ((0)) NOT NULL
);
GO

IF OBJECT_ID('dbo.AccRequest', 'U') IS NULL
CREATE TABLE [dbo].[AccRequest] (
  [Id] int IDENTITY(1,1) NOT NULL,
  [RequestNo] nvarchar(32) NULL,
  [FormCode] nvarchar(20) NOT NULL,
  [BrandCode] nvarchar(20) NULL,
  [Status] nvarchar(20) DEFAULT ('Draft') NOT NULL,
  [CurrentStepCode] nvarchar(20) NULL,
  [EmployeeId] uniqueidentifier NULL,
  [StaffId] int NULL,
  [RequesterFirstName] nvarchar(200) NULL,
  [RequesterLastName] nvarchar(200) NULL,
  [RequesterFullName] nvarchar(200) NULL,
  [RequesterEmail] nvarchar(200) NULL,
  [RequesterPosition] nvarchar(200) NULL,
  [RequesterDepartmentId] int NULL,
  [RequesterDepartmentName] nvarchar(200) NULL,
  [ManagerStaffId] int NULL,
  [ManagerEmail] nvarchar(200) NULL,
  [CompanyName] nvarchar(200) NULL,
  [TotalAmount] decimal(18, 2) NULL,
  [PaymentDate] date NULL,
  [SubmittedBy] int NULL,
  [SubmittedAt] datetime2(7) NULL,
  [CancelledBy] int NULL,
  [CancelledAt] datetime2(7) NULL,
  [CreatedBy] int NULL,
  [CreatedAt] datetime2(7) DEFAULT (sysdatetime()) NOT NULL,
  [UpdatedAt] datetime2(7) DEFAULT (sysdatetime()) NOT NULL,
  [ErpInterfaceStatus] nvarchar(20) NULL,
  [ErpInterfaceError] nvarchar(2000) NULL,
  [ErpInterfaceSentAt] datetime2(7) NULL,
  [ErpInterfaceSentBy] int NULL,
  [ErpInterfaceEnvironment] nvarchar(20) NULL,
  [RequesterDepartmentCode] nvarchar(50) NULL
);
GO

IF OBJECT_ID('dbo.AccRequestFile', 'U') IS NULL
CREATE TABLE [dbo].[AccRequestFile] (
  [Id] int IDENTITY(1,1) NOT NULL,
  [RequestId] int NOT NULL,
  [RefType] nvarchar(30) NOT NULL,
  [RefId] int NULL,
  [FileName] nvarchar(400) NOT NULL,
  [FileSize] int NULL,
  [ContentType] nvarchar(200) NULL,
  [StoragePath] nvarchar(800) NOT NULL,
  [StorageBackend] nvarchar(30) DEFAULT ('local') NOT NULL,
  [UploadedBy] int NULL,
  [UploadedAt] datetime2(7) DEFAULT (sysdatetime()) NOT NULL
);
GO

IF OBJECT_ID('dbo.AccSameDayBrandStaff', 'U') IS NULL
CREATE TABLE [dbo].[AccSameDayBrandStaff] (
  [Id] int IDENTITY(1,1) NOT NULL,
  [StaffId] int NOT NULL,
  [Email] nvarchar(200) NULL,
  [DisplayName] nvarchar(200) NULL,
  [IsActive] bit DEFAULT ((1)) NOT NULL,
  [CreatedBy] int NULL,
  [CreatedAt] datetime2(7) DEFAULT (sysdatetime()) NOT NULL,
  [UpdatedAt] datetime2(7) DEFAULT (sysdatetime()) NOT NULL
);
GO

IF OBJECT_ID('dbo.AccSequence', 'U') IS NULL
CREATE TABLE [dbo].[AccSequence] (
  [Prefix] nvarchar(10) NOT NULL,
  [Year] int NOT NULL,
  [LastSeq] int DEFAULT ((0)) NOT NULL,
  [UpdatedAt] datetime2(7) DEFAULT (sysdatetime()) NOT NULL
);
GO

IF OBJECT_ID('dbo.AccSetting', 'U') IS NULL
CREATE TABLE [dbo].[AccSetting] (
  [SettingKey] nvarchar(100) NOT NULL,
  [SettingValue] nvarchar(MAX) NULL,
  [UpdatedBy] int NULL,
  [UpdatedAt] datetime2(7) DEFAULT (sysdatetime()) NOT NULL
);
GO

IF OBJECT_ID('dbo.AccTravelAccommodation', 'U') IS NULL
CREATE TABLE [dbo].[AccTravelAccommodation] (
  [Id] int IDENTITY(1,1) NOT NULL,
  [Name] nvarchar(200) NOT NULL,
  [IsActive] bit DEFAULT ((1)) NOT NULL,
  [SortOrder] int DEFAULT ((0)) NOT NULL,
  [RequiresCustomReason] bit DEFAULT ((0)) NOT NULL,
  [CreatedBy] int NULL,
  [CreatedAt] datetime2(7) DEFAULT (sysdatetime()) NOT NULL,
  [UpdatedAt] datetime2(7) DEFAULT (sysdatetime()) NOT NULL,
  [Icon] nvarchar(32) NULL,
  [NeedsRoomBooking] bit DEFAULT ((0)) NOT NULL
);
GO

IF OBJECT_ID('dbo.AccTravelBooking', 'U') IS NULL
CREATE TABLE [dbo].[AccTravelBooking] (
  [Id] int IDENTITY(1,1) NOT NULL,
  [RequestId] int NOT NULL,
  [Phone] nvarchar(50) NULL,
  [AllowanceSnapshot] decimal(18, 2) NULL,
  [ReasonId] int NULL,
  [ReasonName] nvarchar(200) NULL,
  [ReasonCustomText] nvarchar(500) NULL,
  [WorkDetail] nvarchar(MAX) NULL,
  [ProvinceId] int NULL,
  [ProvinceName] nvarchar(100) NULL,
  [AccommodationId] int NULL,
  [AccommodationName] nvarchar(200) NULL,
  [AccommodationCustomText] nvarchar(500) NULL,
  [NeedsRoomBooking] bit DEFAULT ((0)) NOT NULL,
  [DepartDate] date NULL,
  [ReturnDate] date NULL,
  [DepartTime] nvarchar(20) NULL,
  [ReturnTime] nvarchar(20) NULL,
  [GoVehicleId] int NULL,
  [GoVehicleName] nvarchar(200) NULL,
  [GoVehicleCustomText] nvarchar(500) NULL,
  [GoNeedsDepartureLocations] bit DEFAULT ((0)) NOT NULL,
  [GoNeedsTicketBooking] bit DEFAULT ((0)) NOT NULL,
  [GoNeedsDepartTime] bit DEFAULT ((0)) NOT NULL,
  [GoNeedsVehicleRent] bit DEFAULT ((0)) NOT NULL,
  [ReturnVehicleId] int NULL,
  [ReturnVehicleName] nvarchar(200) NULL,
  [ReturnVehicleCustomText] nvarchar(500) NULL,
  [ReturnNeedsDepartureLocations] bit DEFAULT ((0)) NOT NULL,
  [ReturnNeedsTicketBooking] bit DEFAULT ((0)) NOT NULL,
  [ReturnNeedsDepartTime] bit DEFAULT ((0)) NOT NULL,
  [ReturnNeedsVehicleRent] bit DEFAULT ((0)) NOT NULL,
  [RentVehicleId] int NULL,
  [RentVehicleName] nvarchar(200) NULL,
  [RentVehicleCustomText] nvarchar(500) NULL,
  [NeedsRentBooking] bit DEFAULT ((0)) NOT NULL,
  [RentStartDate] date NULL,
  [RentEndDate] date NULL,
  [Notes] nvarchar(MAX) NULL,
  [IsContinuation] bit DEFAULT ((0)) NOT NULL,
  [PerDiemDays] int DEFAULT ((0)) NOT NULL,
  [PerDiemTotal] decimal(18, 2) DEFAULT ((0)) NOT NULL,
  [GroupKey] nvarchar(40) NULL,
  [SortOrder] int DEFAULT ((0)) NOT NULL,
  [CreatedAt] datetime2(7) DEFAULT (sysdatetime()) NOT NULL,
  [UpdatedAt] datetime2(7) DEFAULT (sysdatetime()) NOT NULL
);
GO

IF OBJECT_ID('dbo.AccTravelBookingDetail', 'U') IS NULL
CREATE TABLE [dbo].[AccTravelBookingDetail] (
  [Id] int IDENTITY(1,1) NOT NULL,
  [TravelBookingId] int NOT NULL,
  [BookingType] nvarchar(20) NOT NULL,
  [BookingNo] nvarchar(100) NULL,
  [PriceExVat] decimal(18, 2) NULL,
  [CreatedBy] int NULL,
  [CreatedAt] datetime2(7) DEFAULT (sysdatetime()) NOT NULL
);
GO

IF OBJECT_ID('dbo.AccTravelDepartureLocation', 'U') IS NULL
CREATE TABLE [dbo].[AccTravelDepartureLocation] (
  [Id] int IDENTITY(1,1) NOT NULL,
  [TravelBookingId] int NOT NULL,
  [Direction] nvarchar(10) NOT NULL,
  [Name] nvarchar(300) NOT NULL,
  [SortOrder] int DEFAULT ((0)) NOT NULL
);
GO

IF OBJECT_ID('dbo.AccTravelExpense', 'U') IS NULL
CREATE TABLE [dbo].[AccTravelExpense] (
  [Id] int IDENTITY(1,1) NOT NULL,
  [RequestId] int NOT NULL,
  [TravelDate] date NULL,
  [WorkDetail] nvarchar(MAX) NULL,
  [VehicleId] int NULL,
  [VehicleName] nvarchar(100) NULL,
  [RatePerKm] decimal(18, 2) NULL,
  [IsManualEntry] bit DEFAULT ((0)) NOT NULL,
  [Direction] nvarchar(10) NULL,
  [OnwardOrigin] nvarchar(400) NULL,
  [OnwardOriginLat] decimal(10, 7) NULL,
  [OnwardOriginLng] decimal(10, 7) NULL,
  [OnwardDestination] nvarchar(400) NULL,
  [OnwardDestLat] decimal(10, 7) NULL,
  [OnwardDestLng] decimal(10, 7) NULL,
  [OnwardDistanceKm] decimal(18, 2) NULL,
  [ReturnOrigin] nvarchar(400) NULL,
  [ReturnOriginLat] decimal(10, 7) NULL,
  [ReturnOriginLng] decimal(10, 7) NULL,
  [ReturnDestination] nvarchar(400) NULL,
  [ReturnDestLat] decimal(10, 7) NULL,
  [ReturnDestLng] decimal(10, 7) NULL,
  [ReturnDistanceKm] decimal(18, 2) NULL,
  [TotalDistanceKm] decimal(18, 2) NULL,
  [TotalAmount] decimal(18, 2) NULL,
  [SortOrder] int DEFAULT ((0)) NOT NULL,
  [OnwardWaypoints] nvarchar(MAX) NULL,
  [ReturnWaypoints] nvarchar(MAX) NULL
);
GO

IF OBJECT_ID('dbo.AccTravelExpenseItem', 'U') IS NULL
CREATE TABLE [dbo].[AccTravelExpenseItem] (
  [Id] int IDENTITY(1,1) NOT NULL,
  [TravelExpenseId] int NOT NULL,
  [ItemType] nvarchar(20) NOT NULL,
  [Amount] decimal(18, 2) DEFAULT ((0)) NOT NULL,
  [SortOrder] int DEFAULT ((0)) NOT NULL,
  [VehicleSectionId] int NULL
);
GO

IF OBJECT_ID('dbo.AccTravelReason', 'U') IS NULL
CREATE TABLE [dbo].[AccTravelReason] (
  [Id] int IDENTITY(1,1) NOT NULL,
  [Name] nvarchar(200) NOT NULL,
  [IsActive] bit DEFAULT ((1)) NOT NULL,
  [SortOrder] int DEFAULT ((0)) NOT NULL,
  [RequiresCustomReason] bit DEFAULT ((0)) NOT NULL,
  [CreatedBy] int NULL,
  [CreatedAt] datetime2(7) DEFAULT (sysdatetime()) NOT NULL,
  [UpdatedAt] datetime2(7) DEFAULT (sysdatetime()) NOT NULL,
  [Icon] nvarchar(32) NULL
);
GO

IF OBJECT_ID('dbo.AccTravelRentVehicle', 'U') IS NULL
CREATE TABLE [dbo].[AccTravelRentVehicle] (
  [Id] int IDENTITY(1,1) NOT NULL,
  [Name] nvarchar(200) NOT NULL,
  [IsActive] bit DEFAULT ((1)) NOT NULL,
  [SortOrder] int DEFAULT ((0)) NOT NULL,
  [RequiresCustomReason] bit DEFAULT ((0)) NOT NULL,
  [CreatedBy] int NULL,
  [CreatedAt] datetime2(7) DEFAULT (sysdatetime()) NOT NULL,
  [UpdatedAt] datetime2(7) DEFAULT (sysdatetime()) NOT NULL,
  [Icon] nvarchar(32) NULL,
  [NeedsRentBooking] bit DEFAULT ((0)) NOT NULL
);
GO

IF OBJECT_ID('dbo.AccTravelVehicleOption', 'U') IS NULL
CREATE TABLE [dbo].[AccTravelVehicleOption] (
  [Id] int IDENTITY(1,1) NOT NULL,
  [Name] nvarchar(200) NOT NULL,
  [IsActive] bit DEFAULT ((1)) NOT NULL,
  [SortOrder] int DEFAULT ((0)) NOT NULL,
  [RequiresCustomReason] bit DEFAULT ((0)) NOT NULL,
  [CreatedBy] int NULL,
  [CreatedAt] datetime2(7) DEFAULT (sysdatetime()) NOT NULL,
  [UpdatedAt] datetime2(7) DEFAULT (sysdatetime()) NOT NULL,
  [Icon] nvarchar(32) NULL,
  [NeedsDepartureLocations] bit DEFAULT ((0)) NOT NULL,
  [NeedsTicketBooking] bit DEFAULT ((0)) NOT NULL,
  [NeedsDepartTime] bit DEFAULT ((0)) NOT NULL,
  [NeedsVehicleRent] bit DEFAULT ((0)) NOT NULL
);
GO

IF OBJECT_ID('dbo.AccTravelVehiclePlace', 'U') IS NULL
CREATE TABLE [dbo].[AccTravelVehiclePlace] (
  [Id] int IDENTITY(1,1) NOT NULL,
  [VehicleOptionId] int NOT NULL,
  [Name] nvarchar(300) NOT NULL,
  [SortOrder] int DEFAULT ((0)) NOT NULL
);
GO

IF OBJECT_ID('dbo.AccTravelVehicleSection', 'U') IS NULL
CREATE TABLE [dbo].[AccTravelVehicleSection] (
  [Id] int IDENTITY(1,1) NOT NULL,
  [TravelExpenseId] int NOT NULL,
  [SortOrder] int DEFAULT ((0)) NOT NULL,
  [VehicleId] int NULL,
  [VehicleName] nvarchar(100) NULL,
  [RatePerKm] decimal(18, 2) NULL,
  [IsManualEntry] bit DEFAULT ((1)) NOT NULL
);
GO

IF OBJECT_ID('dbo.AccTravelWorkLocation', 'U') IS NULL
CREATE TABLE [dbo].[AccTravelWorkLocation] (
  [Id] int IDENTITY(1,1) NOT NULL,
  [TravelBookingId] int NOT NULL,
  [Name] nvarchar(300) NOT NULL,
  [SortOrder] int DEFAULT ((0)) NOT NULL
);
GO

IF OBJECT_ID('dbo.AccVehicle', 'U') IS NULL
CREATE TABLE [dbo].[AccVehicle] (
  [Id] int IDENTITY(1,1) NOT NULL,
  [Name] nvarchar(100) NOT NULL,
  [RatePerKm] decimal(18, 2) NULL,
  [IsManualEntry] bit DEFAULT ((0)) NOT NULL,
  [IsActive] bit DEFAULT ((1)) NOT NULL,
  [SortOrder] int DEFAULT ((0)) NOT NULL,
  [CreatedBy] int NULL,
  [CreatedAt] datetime2(7) DEFAULT (sysdatetime()) NOT NULL,
  [UpdatedAt] datetime2(7) DEFAULT (sysdatetime()) NOT NULL,
  [Icon] nvarchar(32) NULL
);
GO

IF OBJECT_ID('dbo.OfficeFormActivityLog', 'U') IS NULL
CREATE TABLE [dbo].[OfficeFormActivityLog] (
  [Id] int IDENTITY(1,1) NOT NULL,
  [EntityType] nvarchar(50) NOT NULL,
  [EntityId] int NOT NULL,
  [AuthorId] int NOT NULL,
  [LogType] nvarchar(50) NOT NULL,
  [Note] nvarchar(2000) NULL,
  [MetadataJson] nvarchar(MAX) NULL,
  [CreatedAt] datetime2(7) DEFAULT (getdate()) NOT NULL
);
GO

IF OBJECT_ID('dbo.OfficeFormApprovals', 'U') IS NULL
CREATE TABLE [dbo].[OfficeFormApprovals] (
  [Id] int IDENTITY(1,1) NOT NULL,
  [SubmissionId] int NOT NULL,
  [WorkflowStepId] int NOT NULL,
  [AssignedTo] int NULL,
  [Status] nvarchar(20) DEFAULT ('Pending') NOT NULL,
  [Comment] nvarchar(2000) NULL,
  [ActionAt] datetime2(7) NULL,
  [DueAt] datetime2(7) NULL,
  [NotifiedAt] datetime2(7) NULL,
  [ReminderSentAt] datetime2(7) NULL,
  [CreatedAt] datetime2(7) DEFAULT (getdate()) NOT NULL
);
GO

IF OBJECT_ID('dbo.OfficeFormEmailQueue', 'U') IS NULL
CREATE TABLE [dbo].[OfficeFormEmailQueue] (
  [Id] int IDENTITY(1,1) NOT NULL,
  [ToEmail] nvarchar(500) NOT NULL,
  [Subject] nvarchar(500) NOT NULL,
  [BodyHtml] nvarchar(MAX) NOT NULL,
  [SubmissionId] int NULL,
  [TriggerType] nvarchar(50) NOT NULL,
  [Status] nvarchar(20) DEFAULT ('Queued') NOT NULL,
  [ErrorMessage] nvarchar(1000) NULL,
  [AttemptCount] int DEFAULT ((0)) NOT NULL,
  [CreatedAt] datetime2(7) DEFAULT (getdate()) NOT NULL,
  [SentAt] datetime2(7) NULL
);
GO

IF OBJECT_ID('dbo.OfficeFormFiles', 'U') IS NULL
CREATE TABLE [dbo].[OfficeFormFiles] (
  [Id] int IDENTITY(1,1) NOT NULL,
  [SubmissionId] int NOT NULL,
  [FieldKey] nvarchar(100) NOT NULL,
  [FileName] nvarchar(500) NOT NULL,
  [FileSize] bigint NOT NULL,
  [ContentType] nvarchar(200) NOT NULL,
  [StoragePath] nvarchar(1000) NOT NULL,
  [StorageBackend] nvarchar(20) DEFAULT ('local') NOT NULL,
  [UploadedBy] int NOT NULL,
  [UploadedAt] datetime2(7) DEFAULT (getdate()) NOT NULL,
  [IsActive] bit DEFAULT ((1)) NOT NULL
);
GO

IF OBJECT_ID('dbo.OfficeForms', 'U') IS NULL
CREATE TABLE [dbo].[OfficeForms] (
  [Id] int IDENTITY(1,1) NOT NULL,
  [Name] nvarchar(200) NOT NULL,
  [Slug] nvarchar(200) NOT NULL,
  [Description] nvarchar(1000) NULL,
  [Category] nvarchar(100) NULL,
  [Icon] nvarchar(50) NULL,
  [Status] nvarchar(20) DEFAULT ('Draft') NOT NULL,
  [CurrentVersion] int DEFAULT ((1)) NOT NULL,
  [CreatedBy] int NOT NULL,
  [CreatedAt] datetime2(7) DEFAULT (getdate()) NOT NULL,
  [UpdatedAt] datetime2(7) DEFAULT (getdate()) NOT NULL,
  [IsActive] bit DEFAULT ((1)) NOT NULL
);
GO

IF OBJECT_ID('dbo.OfficeFormSubmissions', 'U') IS NULL
CREATE TABLE [dbo].[OfficeFormSubmissions] (
  [Id] int IDENTITY(1,1) NOT NULL,
  [FormId] int NOT NULL,
  [FormVersionId] int NOT NULL,
  [SubmittedBy] int NOT NULL,
  [Status] nvarchar(20) DEFAULT ('Draft') NOT NULL,
  [DataJson] nvarchar(MAX) NOT NULL,
  [SubmittedAt] datetime2(7) NULL,
  [CompletedAt] datetime2(7) NULL,
  [CreatedAt] datetime2(7) DEFAULT (getdate()) NOT NULL,
  [UpdatedAt] datetime2(7) DEFAULT (getdate()) NOT NULL,
  [IsActive] bit DEFAULT ((1)) NOT NULL
);
GO

IF OBJECT_ID('dbo.OfficeFormVersions', 'U') IS NULL
CREATE TABLE [dbo].[OfficeFormVersions] (
  [Id] int IDENTITY(1,1) NOT NULL,
  [FormId] int NOT NULL,
  [Version] int NOT NULL,
  [FieldsJson] nvarchar(MAX) NOT NULL,
  [PublishedAt] datetime2(7) NULL,
  [PublishedBy] int NULL,
  [CreatedAt] datetime2(7) DEFAULT (getdate()) NOT NULL
);
GO

IF OBJECT_ID('dbo.OfficeFormWorkflows', 'U') IS NULL
CREATE TABLE [dbo].[OfficeFormWorkflows] (
  [Id] int IDENTITY(1,1) NOT NULL,
  [FormId] int NOT NULL,
  [Name] nvarchar(200) DEFAULT ('Default') NOT NULL,
  [SLADays] int DEFAULT ((30)) NULL,
  [IsActive] bit DEFAULT ((1)) NOT NULL,
  [CreatedAt] datetime2(7) DEFAULT (getdate()) NOT NULL,
  [UpdatedAt] datetime2(7) DEFAULT (getdate()) NOT NULL
);
GO

IF OBJECT_ID('dbo.OfficeFormWorkflowSteps', 'U') IS NULL
CREATE TABLE [dbo].[OfficeFormWorkflowSteps] (
  [Id] int IDENTITY(1,1) NOT NULL,
  [WorkflowId] int NOT NULL,
  [StepOrder] int NOT NULL,
  [ParallelGroup] nvarchar(50) NULL,
  [Name] nvarchar(200) NOT NULL,
  [AssigneeType] nvarchar(20) NOT NULL,
  [AssigneeValue] nvarchar(200) NULL,
  [AutoApproveCondition] nvarchar(MAX) NULL,
  [IsActive] bit DEFAULT ((1)) NOT NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_AccApproval_Status')
ALTER TABLE [dbo].[AccApproval] ADD CONSTRAINT [CK_AccApproval_Status] CHECK ([Status]='Returned' OR [Status]='Rejected' OR [Status]='Approved' OR [Status]='Pending');
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_AccApproval_Step')
ALTER TABLE [dbo].[AccApproval] ADD CONSTRAINT [CK_AccApproval_Step] CHECK ([StepCode]='ACCOUNT' OR [StepCode]='MANAGER');
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_AccEmail_Status')
ALTER TABLE [dbo].[AccEmailQueue] ADD CONSTRAINT [CK_AccEmail_Status] CHECK ([Status]='Failed' OR [Status]='Sent' OR [Status]='Queued');
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_AccRequest_ErpInterfaceStatus')
ALTER TABLE [dbo].[AccRequest] ADD CONSTRAINT [CK_AccRequest_ErpInterfaceStatus] CHECK ([ErpInterfaceStatus] IS NULL OR ([ErpInterfaceStatus]='Failed' OR [ErpInterfaceStatus]='Sent' OR [ErpInterfaceStatus]='Pending'));
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_AccRequest_Status')
ALTER TABLE [dbo].[AccRequest] ADD CONSTRAINT [CK_AccRequest_Status] CHECK ([Status]='Completed' OR [Status]='Cancelled' OR [Status]='Returned' OR [Status]='Rejected' OR [Status]='Approved' OR [Status]='ManagerApproved' OR [Status]='Submitted' OR [Status]='Draft');
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_AccTravelBookingDetail_Type')
ALTER TABLE [dbo].[AccTravelBookingDetail] ADD CONSTRAINT [CK_AccTravelBookingDetail_Type] CHECK ([BookingType]='rent' OR [BookingType]='ticket' OR [BookingType]='room');
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_AccTravelDepartureLocation_Direction')
ALTER TABLE [dbo].[AccTravelDepartureLocation] ADD CONSTRAINT [CK_AccTravelDepartureLocation_Direction] CHECK ([Direction]='return' OR [Direction]='go');
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_AccTravel_Direction')
ALTER TABLE [dbo].[AccTravelExpense] ADD CONSTRAINT [CK_AccTravel_Direction] CHECK ([Direction] IS NULL OR ([Direction]='return' OR [Direction]='onward' OR [Direction]='round'));
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_AccTravelItem_Type')
ALTER TABLE [dbo].[AccTravelExpenseItem] ADD CONSTRAINT [CK_AccTravelItem_Type] CHECK ([ItemType]='parking' OR [ItemType]='toll' OR [ItemType]='fare');
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_AccVehicle_Rate')
ALTER TABLE [dbo].[AccVehicle] ADD CONSTRAINT [CK_AccVehicle_Rate] CHECK ([IsManualEntry]=(1) OR [RatePerKm]>=(1));
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Approvals_Status')
ALTER TABLE [dbo].[OfficeFormApprovals] ADD CONSTRAINT [CK_Approvals_Status] CHECK ([Status]='Skipped' OR [Status]='Returned' OR [Status]='Rejected' OR [Status]='Approved' OR [Status]='Pending');
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_EmailQueue_Status')
ALTER TABLE [dbo].[OfficeFormEmailQueue] ADD CONSTRAINT [CK_EmailQueue_Status] CHECK ([Status]='Failed' OR [Status]='Sent' OR [Status]='Queued');
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_OfficeForms_Status')
ALTER TABLE [dbo].[OfficeForms] ADD CONSTRAINT [CK_OfficeForms_Status] CHECK ([Status]='Archived' OR [Status]='Published' OR [Status]='Draft');
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Submissions_Status')
ALTER TABLE [dbo].[OfficeFormSubmissions] ADD CONSTRAINT [CK_Submissions_Status] CHECK ([Status]='Cancelled' OR [Status]='Returned' OR [Status]='Rejected' OR [Status]='Approved' OR [Status]='InReview' OR [Status]='Submitted' OR [Status]='Draft');
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_WorkflowSteps_AssigneeType')
ALTER TABLE [dbo].[OfficeFormWorkflowSteps] ADD CONSTRAINT [CK_WorkflowSteps_AssigneeType] CHECK ([AssigneeType]='submitter_manager' OR [AssigneeType]='role' OR [AssigneeType]='user');
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'PK__AccActiv__3214EC07A0FAFF32' AND object_id = OBJECT_ID('dbo.AccActivityLog'))
ALTER TABLE [dbo].[AccActivityLog] ADD CONSTRAINT [PK__AccActiv__3214EC07A0FAFF32] PRIMARY KEY CLUSTERED ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AccActivity_Request' AND object_id = OBJECT_ID('dbo.AccActivityLog'))
CREATE INDEX [IX_AccActivity_Request] ON [dbo].[AccActivityLog] ([RequestId]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'PK__AccAppro__3214EC07C3DE9947' AND object_id = OBJECT_ID('dbo.AccApproval'))
ALTER TABLE [dbo].[AccApproval] ADD CONSTRAINT [PK__AccAppro__3214EC07C3DE9947] PRIMARY KEY CLUSTERED ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AccApproval_Request' AND object_id = OBJECT_ID('dbo.AccApproval'))
CREATE INDEX [IX_AccApproval_Request] ON [dbo].[AccApproval] ([RequestId]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AccApproval_Assigned' AND object_id = OBJECT_ID('dbo.AccApproval'))
CREATE INDEX [IX_AccApproval_Assigned] ON [dbo].[AccApproval] ([AssignedTo]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AccApproval_Status' AND object_id = OBJECT_ID('dbo.AccApproval'))
CREATE INDEX [IX_AccApproval_Status] ON [dbo].[AccApproval] ([Status]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AccApproval_ActionedByStaffId' AND object_id = OBJECT_ID('dbo.AccApproval'))
CREATE INDEX [IX_AccApproval_ActionedByStaffId] ON [dbo].[AccApproval] ([ActionedByStaffId]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'PK__AccAppro__3214EC07231D85B3' AND object_id = OBJECT_ID('dbo.AccApprover'))
ALTER TABLE [dbo].[AccApprover] ADD CONSTRAINT [PK__AccAppro__3214EC07231D85B3] PRIMARY KEY CLUSTERED ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_AccApprover_Email' AND object_id = OBJECT_ID('dbo.AccApprover'))
CREATE UNIQUE INDEX [UX_AccApprover_Email] ON [dbo].[AccApprover] ([Email]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'PK_AccApproverInterfaceBrand' AND object_id = OBJECT_ID('dbo.AccApproverInterfaceBrand'))
ALTER TABLE [dbo].[AccApproverInterfaceBrand] ADD CONSTRAINT [PK_AccApproverInterfaceBrand] PRIMARY KEY CLUSTERED ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_AccApproverInterfaceBrand' AND object_id = OBJECT_ID('dbo.AccApproverInterfaceBrand'))
ALTER TABLE [dbo].[AccApproverInterfaceBrand] ADD CONSTRAINT [UQ_AccApproverInterfaceBrand] UNIQUE NONCLUSTERED ([ApproverId], [InterfaceBrandCode]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AccApproverInterfaceBrand_Approver' AND object_id = OBJECT_ID('dbo.AccApproverInterfaceBrand'))
CREATE INDEX [IX_AccApproverInterfaceBrand_Approver] ON [dbo].[AccApproverInterfaceBrand] ([ApproverId]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'PK_AccApproverSettingsTab' AND object_id = OBJECT_ID('dbo.AccApproverSettingsTab'))
ALTER TABLE [dbo].[AccApproverSettingsTab] ADD CONSTRAINT [PK_AccApproverSettingsTab] PRIMARY KEY CLUSTERED ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_AccApproverSettingsTab' AND object_id = OBJECT_ID('dbo.AccApproverSettingsTab'))
CREATE UNIQUE INDEX [UX_AccApproverSettingsTab] ON [dbo].[AccApproverSettingsTab] ([ApproverId], [TabKey]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'PK_AccBrandBankAccount' AND object_id = OBJECT_ID('dbo.AccBrandBankAccount'))
ALTER TABLE [dbo].[AccBrandBankAccount] ADD CONSTRAINT [PK_AccBrandBankAccount] PRIMARY KEY CLUSTERED ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_AccBrandBankAccount' AND object_id = OBJECT_ID('dbo.AccBrandBankAccount'))
ALTER TABLE [dbo].[AccBrandBankAccount] ADD CONSTRAINT [UQ_AccBrandBankAccount] UNIQUE NONCLUSTERED ([BrandCode], [AccountNo]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AccBrandBankAccount_Brand' AND object_id = OBJECT_ID('dbo.AccBrandBankAccount'))
CREATE INDEX [IX_AccBrandBankAccount_Brand] ON [dbo].[AccBrandBankAccount] ([BrandCode], [IsActive], [SortOrder]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'PK_AccBrandBranchCode' AND object_id = OBJECT_ID('dbo.AccBrandBranchCode'))
ALTER TABLE [dbo].[AccBrandBranchCode] ADD CONSTRAINT [PK_AccBrandBranchCode] PRIMARY KEY CLUSTERED ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_AccBrandBranchCode' AND object_id = OBJECT_ID('dbo.AccBrandBranchCode'))
ALTER TABLE [dbo].[AccBrandBranchCode] ADD CONSTRAINT [UQ_AccBrandBranchCode] UNIQUE NONCLUSTERED ([BrandCode], [BranchCode]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AccBrandBranchCode_Brand' AND object_id = OBJECT_ID('dbo.AccBrandBranchCode'))
CREATE INDEX [IX_AccBrandBranchCode_Brand] ON [dbo].[AccBrandBranchCode] ([BrandCode], [IsActive], [SortOrder]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'PK_AccBrandErpInterface' AND object_id = OBJECT_ID('dbo.AccBrandErpInterface'))
ALTER TABLE [dbo].[AccBrandErpInterface] ADD CONSTRAINT [PK_AccBrandErpInterface] PRIMARY KEY CLUSTERED ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_AccBrandErpInterface_Brand' AND object_id = OBJECT_ID('dbo.AccBrandErpInterface'))
ALTER TABLE [dbo].[AccBrandErpInterface] ADD CONSTRAINT [UQ_AccBrandErpInterface_Brand] UNIQUE NONCLUSTERED ([BrandCode]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AccBrandErpInterface_Target' AND object_id = OBJECT_ID('dbo.AccBrandErpInterface'))
CREATE INDEX [IX_AccBrandErpInterface_Target] ON [dbo].[AccBrandErpInterface] ([InterfaceBrandCode]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'PK_AccBrandErpTargetSetting' AND object_id = OBJECT_ID('dbo.AccBrandErpTargetSetting'))
ALTER TABLE [dbo].[AccBrandErpTargetSetting] ADD CONSTRAINT [PK_AccBrandErpTargetSetting] PRIMARY KEY CLUSTERED ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_AccBrandErpTargetSetting_Brand' AND object_id = OBJECT_ID('dbo.AccBrandErpTargetSetting'))
ALTER TABLE [dbo].[AccBrandErpTargetSetting] ADD CONSTRAINT [UQ_AccBrandErpTargetSetting_Brand] UNIQUE NONCLUSTERED ([BrandCode]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AccBrandErpTargetSetting_Brand' AND object_id = OBJECT_ID('dbo.AccBrandErpTargetSetting'))
CREATE INDEX [IX_AccBrandErpTargetSetting_Brand] ON [dbo].[AccBrandErpTargetSetting] ([BrandCode]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'PK_AccBrandGlAccount' AND object_id = OBJECT_ID('dbo.AccBrandGlAccount'))
ALTER TABLE [dbo].[AccBrandGlAccount] ADD CONSTRAINT [PK_AccBrandGlAccount] PRIMARY KEY CLUSTERED ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_AccBrandGlAccount' AND object_id = OBJECT_ID('dbo.AccBrandGlAccount'))
ALTER TABLE [dbo].[AccBrandGlAccount] ADD CONSTRAINT [UQ_AccBrandGlAccount] UNIQUE NONCLUSTERED ([BrandCode], [AccountNo]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AccBrandGlAccount_Brand' AND object_id = OBJECT_ID('dbo.AccBrandGlAccount'))
CREATE INDEX [IX_AccBrandGlAccount_Brand] ON [dbo].[AccBrandGlAccount] ([BrandCode], [IsActive], [SortOrder]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'PK_AccBrandJournalBatch' AND object_id = OBJECT_ID('dbo.AccBrandJournalBatch'))
ALTER TABLE [dbo].[AccBrandJournalBatch] ADD CONSTRAINT [PK_AccBrandJournalBatch] PRIMARY KEY CLUSTERED ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_AccBrandJournalBatch' AND object_id = OBJECT_ID('dbo.AccBrandJournalBatch'))
ALTER TABLE [dbo].[AccBrandJournalBatch] ADD CONSTRAINT [UQ_AccBrandJournalBatch] UNIQUE NONCLUSTERED ([BrandCode], [BatchName]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AccBrandJournalBatch_Brand' AND object_id = OBJECT_ID('dbo.AccBrandJournalBatch'))
CREATE INDEX [IX_AccBrandJournalBatch_Brand] ON [dbo].[AccBrandJournalBatch] ([BrandCode], [IsActive], [SortOrder]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'PK__AccEmail__3214EC07A8660233' AND object_id = OBJECT_ID('dbo.AccEmailQueue'))
ALTER TABLE [dbo].[AccEmailQueue] ADD CONSTRAINT [PK__AccEmail__3214EC07A8660233] PRIMARY KEY CLUSTERED ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AccEmail_Status' AND object_id = OBJECT_ID('dbo.AccEmailQueue'))
CREATE INDEX [IX_AccEmail_Status] ON [dbo].[AccEmailQueue] ([Status]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'PK__AccFormB__3214EC075D1BB328' AND object_id = OBJECT_ID('dbo.AccFormBrand'))
ALTER TABLE [dbo].[AccFormBrand] ADD CONSTRAINT [PK__AccFormB__3214EC075D1BB328] PRIMARY KEY CLUSTERED ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_AccFormBrand' AND object_id = OBJECT_ID('dbo.AccFormBrand'))
ALTER TABLE [dbo].[AccFormBrand] ADD CONSTRAINT [UQ_AccFormBrand] UNIQUE NONCLUSTERED ([FormCode], [BrandCode]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'PK__AccFormM__F69A6BF69F5E91CC' AND object_id = OBJECT_ID('dbo.AccFormMaster'))
ALTER TABLE [dbo].[AccFormMaster] ADD CONSTRAINT [PK__AccFormM__F69A6BF69F5E91CC] PRIMARY KEY CLUSTERED ([FormCode]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'PK_AccPerDiem' AND object_id = OBJECT_ID('dbo.AccPerDiem'))
ALTER TABLE [dbo].[AccPerDiem] ADD CONSTRAINT [PK_AccPerDiem] PRIMARY KEY CLUSTERED ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_AccPerDiem_Request' AND object_id = OBJECT_ID('dbo.AccPerDiem'))
ALTER TABLE [dbo].[AccPerDiem] ADD CONSTRAINT [UQ_AccPerDiem_Request] UNIQUE NONCLUSTERED ([RequestId]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'PK_AccPerDiemDay' AND object_id = OBJECT_ID('dbo.AccPerDiemDay'))
ALTER TABLE [dbo].[AccPerDiemDay] ADD CONSTRAINT [PK_AccPerDiemDay] PRIMARY KEY CLUSTERED ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_AccPerDiemDay_Date' AND object_id = OBJECT_ID('dbo.AccPerDiemDay'))
ALTER TABLE [dbo].[AccPerDiemDay] ADD CONSTRAINT [UQ_AccPerDiemDay_Date] UNIQUE NONCLUSTERED ([PerDiemId], [WorkDate]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AccPerDiemDay_PerDiem' AND object_id = OBJECT_ID('dbo.AccPerDiemDay'))
CREATE INDEX [IX_AccPerDiemDay_PerDiem] ON [dbo].[AccPerDiemDay] ([PerDiemId]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'PK__AccReque__3214EC0708254D73' AND object_id = OBJECT_ID('dbo.AccRequest'))
ALTER TABLE [dbo].[AccRequest] ADD CONSTRAINT [PK__AccReque__3214EC0708254D73] PRIMARY KEY CLUSTERED ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AccRequest_Form' AND object_id = OBJECT_ID('dbo.AccRequest'))
CREATE INDEX [IX_AccRequest_Form] ON [dbo].[AccRequest] ([FormCode]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AccRequest_Status' AND object_id = OBJECT_ID('dbo.AccRequest'))
CREATE INDEX [IX_AccRequest_Status] ON [dbo].[AccRequest] ([Status]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AccRequest_Staff' AND object_id = OBJECT_ID('dbo.AccRequest'))
CREATE INDEX [IX_AccRequest_Staff] ON [dbo].[AccRequest] ([StaffId]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AccRequest_Brand' AND object_id = OBJECT_ID('dbo.AccRequest'))
CREATE INDEX [IX_AccRequest_Brand] ON [dbo].[AccRequest] ([BrandCode]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_AccRequest_RequestNo' AND object_id = OBJECT_ID('dbo.AccRequest'))
CREATE UNIQUE INDEX [UX_AccRequest_RequestNo] ON [dbo].[AccRequest] ([RequestNo]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AccRequest_ErpInterfaceStatus' AND object_id = OBJECT_ID('dbo.AccRequest'))
CREATE INDEX [IX_AccRequest_ErpInterfaceStatus] ON [dbo].[AccRequest] ([ErpInterfaceStatus]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'PK__AccReque__3214EC07E867C8D1' AND object_id = OBJECT_ID('dbo.AccRequestFile'))
ALTER TABLE [dbo].[AccRequestFile] ADD CONSTRAINT [PK__AccReque__3214EC07E867C8D1] PRIMARY KEY CLUSTERED ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AccFile_Request' AND object_id = OBJECT_ID('dbo.AccRequestFile'))
CREATE INDEX [IX_AccFile_Request] ON [dbo].[AccRequestFile] ([RequestId]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AccFile_Ref' AND object_id = OBJECT_ID('dbo.AccRequestFile'))
CREATE INDEX [IX_AccFile_Ref] ON [dbo].[AccRequestFile] ([RefType], [RefId]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'PK__AccSameD__3214EC0794AB54CD' AND object_id = OBJECT_ID('dbo.AccSameDayBrandStaff'))
ALTER TABLE [dbo].[AccSameDayBrandStaff] ADD CONSTRAINT [PK__AccSameD__3214EC0794AB54CD] PRIMARY KEY CLUSTERED ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_AccSameDayBrandStaff_StaffId' AND object_id = OBJECT_ID('dbo.AccSameDayBrandStaff'))
CREATE UNIQUE INDEX [UX_AccSameDayBrandStaff_StaffId] ON [dbo].[AccSameDayBrandStaff] ([StaffId]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'PK_AccSequence' AND object_id = OBJECT_ID('dbo.AccSequence'))
ALTER TABLE [dbo].[AccSequence] ADD CONSTRAINT [PK_AccSequence] PRIMARY KEY CLUSTERED ([Prefix], [Year]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'PK__AccSetti__01E719AC822C9279' AND object_id = OBJECT_ID('dbo.AccSetting'))
ALTER TABLE [dbo].[AccSetting] ADD CONSTRAINT [PK__AccSetti__01E719AC822C9279] PRIMARY KEY CLUSTERED ([SettingKey]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'PK__AccTrave__3214EC0743914589' AND object_id = OBJECT_ID('dbo.AccTravelAccommodation'))
ALTER TABLE [dbo].[AccTravelAccommodation] ADD CONSTRAINT [PK__AccTrave__3214EC0743914589] PRIMARY KEY CLUSTERED ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'PK__AccTrave__3214EC070B5DF7A9' AND object_id = OBJECT_ID('dbo.AccTravelBooking'))
ALTER TABLE [dbo].[AccTravelBooking] ADD CONSTRAINT [PK__AccTrave__3214EC070B5DF7A9] PRIMARY KEY CLUSTERED ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_AccTravelBooking_Request' AND object_id = OBJECT_ID('dbo.AccTravelBooking'))
ALTER TABLE [dbo].[AccTravelBooking] ADD CONSTRAINT [UQ_AccTravelBooking_Request] UNIQUE NONCLUSTERED ([RequestId]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AccTravelBooking_Request' AND object_id = OBJECT_ID('dbo.AccTravelBooking'))
CREATE INDEX [IX_AccTravelBooking_Request] ON [dbo].[AccTravelBooking] ([RequestId]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AccTravelBooking_GroupKey' AND object_id = OBJECT_ID('dbo.AccTravelBooking'))
CREATE INDEX [IX_AccTravelBooking_GroupKey] ON [dbo].[AccTravelBooking] ([GroupKey]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'PK__AccTrave__3214EC0784FB068A' AND object_id = OBJECT_ID('dbo.AccTravelBookingDetail'))
ALTER TABLE [dbo].[AccTravelBookingDetail] ADD CONSTRAINT [PK__AccTrave__3214EC0784FB068A] PRIMARY KEY CLUSTERED ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AccTravelBookingDetail_Booking' AND object_id = OBJECT_ID('dbo.AccTravelBookingDetail'))
CREATE INDEX [IX_AccTravelBookingDetail_Booking] ON [dbo].[AccTravelBookingDetail] ([TravelBookingId]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'PK__AccTrave__3214EC073FBF73E4' AND object_id = OBJECT_ID('dbo.AccTravelDepartureLocation'))
ALTER TABLE [dbo].[AccTravelDepartureLocation] ADD CONSTRAINT [PK__AccTrave__3214EC073FBF73E4] PRIMARY KEY CLUSTERED ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AccTravelDepartureLocation_Booking' AND object_id = OBJECT_ID('dbo.AccTravelDepartureLocation'))
CREATE INDEX [IX_AccTravelDepartureLocation_Booking] ON [dbo].[AccTravelDepartureLocation] ([TravelBookingId], [SortOrder]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'PK__AccTrave__3214EC077C6B5E93' AND object_id = OBJECT_ID('dbo.AccTravelExpense'))
ALTER TABLE [dbo].[AccTravelExpense] ADD CONSTRAINT [PK__AccTrave__3214EC077C6B5E93] PRIMARY KEY CLUSTERED ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AccTravel_Request' AND object_id = OBJECT_ID('dbo.AccTravelExpense'))
CREATE INDEX [IX_AccTravel_Request] ON [dbo].[AccTravelExpense] ([RequestId]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_AccTravel_Request_Date' AND object_id = OBJECT_ID('dbo.AccTravelExpense'))
CREATE UNIQUE INDEX [UQ_AccTravel_Request_Date] ON [dbo].[AccTravelExpense] ([RequestId], [TravelDate]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AccTravel_Request_Sort' AND object_id = OBJECT_ID('dbo.AccTravelExpense'))
CREATE INDEX [IX_AccTravel_Request_Sort] ON [dbo].[AccTravelExpense] ([RequestId], [SortOrder], [TravelDate]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'PK__AccTrave__3214EC07CB983257' AND object_id = OBJECT_ID('dbo.AccTravelExpenseItem'))
ALTER TABLE [dbo].[AccTravelExpenseItem] ADD CONSTRAINT [PK__AccTrave__3214EC07CB983257] PRIMARY KEY CLUSTERED ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AccTravelItem_Parent' AND object_id = OBJECT_ID('dbo.AccTravelExpenseItem'))
CREATE INDEX [IX_AccTravelItem_Parent] ON [dbo].[AccTravelExpenseItem] ([TravelExpenseId]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'PK__AccTrave__3214EC07885719FA' AND object_id = OBJECT_ID('dbo.AccTravelReason'))
ALTER TABLE [dbo].[AccTravelReason] ADD CONSTRAINT [PK__AccTrave__3214EC07885719FA] PRIMARY KEY CLUSTERED ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'PK__AccTrave__3214EC072ECE91A1' AND object_id = OBJECT_ID('dbo.AccTravelRentVehicle'))
ALTER TABLE [dbo].[AccTravelRentVehicle] ADD CONSTRAINT [PK__AccTrave__3214EC072ECE91A1] PRIMARY KEY CLUSTERED ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'PK__AccTrave__3214EC07C6F40BB7' AND object_id = OBJECT_ID('dbo.AccTravelVehicleOption'))
ALTER TABLE [dbo].[AccTravelVehicleOption] ADD CONSTRAINT [PK__AccTrave__3214EC07C6F40BB7] PRIMARY KEY CLUSTERED ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'PK__AccTrave__3214EC07DA818787' AND object_id = OBJECT_ID('dbo.AccTravelVehiclePlace'))
ALTER TABLE [dbo].[AccTravelVehiclePlace] ADD CONSTRAINT [PK__AccTrave__3214EC07DA818787] PRIMARY KEY CLUSTERED ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AccTravelVehiclePlace_Vehicle' AND object_id = OBJECT_ID('dbo.AccTravelVehiclePlace'))
CREATE INDEX [IX_AccTravelVehiclePlace_Vehicle] ON [dbo].[AccTravelVehiclePlace] ([VehicleOptionId], [SortOrder]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'PK__AccTrave__3214EC079954DFB3' AND object_id = OBJECT_ID('dbo.AccTravelVehicleSection'))
ALTER TABLE [dbo].[AccTravelVehicleSection] ADD CONSTRAINT [PK__AccTrave__3214EC079954DFB3] PRIMARY KEY CLUSTERED ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AccTravelSection_Parent' AND object_id = OBJECT_ID('dbo.AccTravelVehicleSection'))
CREATE INDEX [IX_AccTravelSection_Parent] ON [dbo].[AccTravelVehicleSection] ([TravelExpenseId], [SortOrder]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'PK__AccTrave__3214EC07ABCCB953' AND object_id = OBJECT_ID('dbo.AccTravelWorkLocation'))
ALTER TABLE [dbo].[AccTravelWorkLocation] ADD CONSTRAINT [PK__AccTrave__3214EC07ABCCB953] PRIMARY KEY CLUSTERED ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_AccTravelWorkLocation_Booking' AND object_id = OBJECT_ID('dbo.AccTravelWorkLocation'))
CREATE INDEX [IX_AccTravelWorkLocation_Booking] ON [dbo].[AccTravelWorkLocation] ([TravelBookingId], [SortOrder]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'PK__AccVehic__3214EC07BD254879' AND object_id = OBJECT_ID('dbo.AccVehicle'))
ALTER TABLE [dbo].[AccVehicle] ADD CONSTRAINT [PK__AccVehic__3214EC07BD254879] PRIMARY KEY CLUSTERED ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'PK__OfficeFo__3214EC07B57DD451' AND object_id = OBJECT_ID('dbo.OfficeFormActivityLog'))
ALTER TABLE [dbo].[OfficeFormActivityLog] ADD CONSTRAINT [PK__OfficeFo__3214EC07B57DD451] PRIMARY KEY CLUSTERED ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ActivityLog_Entity' AND object_id = OBJECT_ID('dbo.OfficeFormActivityLog'))
CREATE INDEX [IX_ActivityLog_Entity] ON [dbo].[OfficeFormActivityLog] ([EntityType], [EntityId]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ActivityLog_AuthorId' AND object_id = OBJECT_ID('dbo.OfficeFormActivityLog'))
CREATE INDEX [IX_ActivityLog_AuthorId] ON [dbo].[OfficeFormActivityLog] ([AuthorId]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'PK__OfficeFo__3214EC0728168696' AND object_id = OBJECT_ID('dbo.OfficeFormApprovals'))
ALTER TABLE [dbo].[OfficeFormApprovals] ADD CONSTRAINT [PK__OfficeFo__3214EC0728168696] PRIMARY KEY CLUSTERED ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Approvals_SubmissionId' AND object_id = OBJECT_ID('dbo.OfficeFormApprovals'))
CREATE INDEX [IX_Approvals_SubmissionId] ON [dbo].[OfficeFormApprovals] ([SubmissionId]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Approvals_AssignedTo' AND object_id = OBJECT_ID('dbo.OfficeFormApprovals'))
CREATE INDEX [IX_Approvals_AssignedTo] ON [dbo].[OfficeFormApprovals] ([AssignedTo]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Approvals_Status' AND object_id = OBJECT_ID('dbo.OfficeFormApprovals'))
CREATE INDEX [IX_Approvals_Status] ON [dbo].[OfficeFormApprovals] ([Status]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Approvals_WorkflowStepId' AND object_id = OBJECT_ID('dbo.OfficeFormApprovals'))
CREATE INDEX [IX_Approvals_WorkflowStepId] ON [dbo].[OfficeFormApprovals] ([WorkflowStepId]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'PK__OfficeFo__3214EC072B724807' AND object_id = OBJECT_ID('dbo.OfficeFormEmailQueue'))
ALTER TABLE [dbo].[OfficeFormEmailQueue] ADD CONSTRAINT [PK__OfficeFo__3214EC072B724807] PRIMARY KEY CLUSTERED ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_EmailQueue_Status' AND object_id = OBJECT_ID('dbo.OfficeFormEmailQueue'))
CREATE INDEX [IX_EmailQueue_Status] ON [dbo].[OfficeFormEmailQueue] ([Status]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_EmailQueue_SubmissionId' AND object_id = OBJECT_ID('dbo.OfficeFormEmailQueue'))
CREATE INDEX [IX_EmailQueue_SubmissionId] ON [dbo].[OfficeFormEmailQueue] ([SubmissionId]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'PK__OfficeFo__3214EC07A4239B8E' AND object_id = OBJECT_ID('dbo.OfficeFormFiles'))
ALTER TABLE [dbo].[OfficeFormFiles] ADD CONSTRAINT [PK__OfficeFo__3214EC07A4239B8E] PRIMARY KEY CLUSTERED ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FormFiles_SubmissionId' AND object_id = OBJECT_ID('dbo.OfficeFormFiles'))
CREATE INDEX [IX_FormFiles_SubmissionId] ON [dbo].[OfficeFormFiles] ([SubmissionId]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'PK__OfficeFo__3214EC076DEEED77' AND object_id = OBJECT_ID('dbo.OfficeForms'))
ALTER TABLE [dbo].[OfficeForms] ADD CONSTRAINT [PK__OfficeFo__3214EC076DEEED77] PRIMARY KEY CLUSTERED ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_OfficeForms_Slug' AND object_id = OBJECT_ID('dbo.OfficeForms'))
ALTER TABLE [dbo].[OfficeForms] ADD CONSTRAINT [UQ_OfficeForms_Slug] UNIQUE NONCLUSTERED ([Slug]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_OfficeForms_Status' AND object_id = OBJECT_ID('dbo.OfficeForms'))
CREATE INDEX [IX_OfficeForms_Status] ON [dbo].[OfficeForms] ([Status]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_OfficeForms_CreatedBy' AND object_id = OBJECT_ID('dbo.OfficeForms'))
CREATE INDEX [IX_OfficeForms_CreatedBy] ON [dbo].[OfficeForms] ([CreatedBy]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_OfficeForms_IsActive' AND object_id = OBJECT_ID('dbo.OfficeForms'))
CREATE INDEX [IX_OfficeForms_IsActive] ON [dbo].[OfficeForms] ([IsActive]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'PK__OfficeFo__3214EC071367D765' AND object_id = OBJECT_ID('dbo.OfficeFormSubmissions'))
ALTER TABLE [dbo].[OfficeFormSubmissions] ADD CONSTRAINT [PK__OfficeFo__3214EC071367D765] PRIMARY KEY CLUSTERED ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Submissions_FormId' AND object_id = OBJECT_ID('dbo.OfficeFormSubmissions'))
CREATE INDEX [IX_Submissions_FormId] ON [dbo].[OfficeFormSubmissions] ([FormId]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Submissions_FormVersionId' AND object_id = OBJECT_ID('dbo.OfficeFormSubmissions'))
CREATE INDEX [IX_Submissions_FormVersionId] ON [dbo].[OfficeFormSubmissions] ([FormVersionId]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Submissions_SubmittedBy' AND object_id = OBJECT_ID('dbo.OfficeFormSubmissions'))
CREATE INDEX [IX_Submissions_SubmittedBy] ON [dbo].[OfficeFormSubmissions] ([SubmittedBy]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Submissions_Status' AND object_id = OBJECT_ID('dbo.OfficeFormSubmissions'))
CREATE INDEX [IX_Submissions_Status] ON [dbo].[OfficeFormSubmissions] ([Status]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Submissions_IsActive' AND object_id = OBJECT_ID('dbo.OfficeFormSubmissions'))
CREATE INDEX [IX_Submissions_IsActive] ON [dbo].[OfficeFormSubmissions] ([IsActive]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'PK__OfficeFo__3214EC0771F9FDCA' AND object_id = OBJECT_ID('dbo.OfficeFormVersions'))
ALTER TABLE [dbo].[OfficeFormVersions] ADD CONSTRAINT [PK__OfficeFo__3214EC0771F9FDCA] PRIMARY KEY CLUSTERED ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_FormVersions' AND object_id = OBJECT_ID('dbo.OfficeFormVersions'))
ALTER TABLE [dbo].[OfficeFormVersions] ADD CONSTRAINT [UQ_FormVersions] UNIQUE NONCLUSTERED ([FormId], [Version]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FormVersions_FormId' AND object_id = OBJECT_ID('dbo.OfficeFormVersions'))
CREATE INDEX [IX_FormVersions_FormId] ON [dbo].[OfficeFormVersions] ([FormId]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'PK__OfficeFo__3214EC072940CEEC' AND object_id = OBJECT_ID('dbo.OfficeFormWorkflows'))
ALTER TABLE [dbo].[OfficeFormWorkflows] ADD CONSTRAINT [PK__OfficeFo__3214EC072940CEEC] PRIMARY KEY CLUSTERED ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Workflows_FormId' AND object_id = OBJECT_ID('dbo.OfficeFormWorkflows'))
CREATE INDEX [IX_Workflows_FormId] ON [dbo].[OfficeFormWorkflows] ([FormId]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'PK__OfficeFo__3214EC078545D811' AND object_id = OBJECT_ID('dbo.OfficeFormWorkflowSteps'))
ALTER TABLE [dbo].[OfficeFormWorkflowSteps] ADD CONSTRAINT [PK__OfficeFo__3214EC078545D811] PRIMARY KEY CLUSTERED ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_WorkflowSteps_WorkflowId' AND object_id = OBJECT_ID('dbo.OfficeFormWorkflowSteps'))
CREATE INDEX [IX_WorkflowSteps_WorkflowId] ON [dbo].[OfficeFormWorkflowSteps] ([WorkflowId]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_AccActivity_Request')
ALTER TABLE [dbo].[AccActivityLog] ADD CONSTRAINT [FK_AccActivity_Request] FOREIGN KEY ([RequestId]) REFERENCES [dbo].[AccRequest] ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_AccApproval_Request')
ALTER TABLE [dbo].[AccApproval] ADD CONSTRAINT [FK_AccApproval_Request] FOREIGN KEY ([RequestId]) REFERENCES [dbo].[AccRequest] ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_AccApproverInterfaceBrand_Approver')
ALTER TABLE [dbo].[AccApproverInterfaceBrand] ADD CONSTRAINT [FK_AccApproverInterfaceBrand_Approver] FOREIGN KEY ([ApproverId]) REFERENCES [dbo].[AccApprover] ([Id]) ON DELETE CASCADE;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_AccFile_Request')
ALTER TABLE [dbo].[AccRequestFile] ADD CONSTRAINT [FK_AccFile_Request] FOREIGN KEY ([RequestId]) REFERENCES [dbo].[AccRequest] ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_AccFormBrand_Form')
ALTER TABLE [dbo].[AccFormBrand] ADD CONSTRAINT [FK_AccFormBrand_Form] FOREIGN KEY ([FormCode]) REFERENCES [dbo].[AccFormMaster] ([FormCode]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_AccPerDiem_Request')
ALTER TABLE [dbo].[AccPerDiem] ADD CONSTRAINT [FK_AccPerDiem_Request] FOREIGN KEY ([RequestId]) REFERENCES [dbo].[AccRequest] ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_AccPerDiemDay_PerDiem')
ALTER TABLE [dbo].[AccPerDiemDay] ADD CONSTRAINT [FK_AccPerDiemDay_PerDiem] FOREIGN KEY ([PerDiemId]) REFERENCES [dbo].[AccPerDiem] ([Id]) ON DELETE CASCADE;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_AccRequest_Form')
ALTER TABLE [dbo].[AccRequest] ADD CONSTRAINT [FK_AccRequest_Form] FOREIGN KEY ([FormCode]) REFERENCES [dbo].[AccFormMaster] ([FormCode]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_AccTravel_Request')
ALTER TABLE [dbo].[AccTravelExpense] ADD CONSTRAINT [FK_AccTravel_Request] FOREIGN KEY ([RequestId]) REFERENCES [dbo].[AccRequest] ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_AccTravelBooking_Request')
ALTER TABLE [dbo].[AccTravelBooking] ADD CONSTRAINT [FK_AccTravelBooking_Request] FOREIGN KEY ([RequestId]) REFERENCES [dbo].[AccRequest] ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_AccTravelBookingDetail_Booking')
ALTER TABLE [dbo].[AccTravelBookingDetail] ADD CONSTRAINT [FK_AccTravelBookingDetail_Booking] FOREIGN KEY ([TravelBookingId]) REFERENCES [dbo].[AccTravelBooking] ([Id]) ON DELETE CASCADE;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_AccTravelDepartureLocation_Booking')
ALTER TABLE [dbo].[AccTravelDepartureLocation] ADD CONSTRAINT [FK_AccTravelDepartureLocation_Booking] FOREIGN KEY ([TravelBookingId]) REFERENCES [dbo].[AccTravelBooking] ([Id]) ON DELETE CASCADE;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_AccTravelItem_Parent')
ALTER TABLE [dbo].[AccTravelExpenseItem] ADD CONSTRAINT [FK_AccTravelItem_Parent] FOREIGN KEY ([TravelExpenseId]) REFERENCES [dbo].[AccTravelExpense] ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_AccTravelItem_Section')
ALTER TABLE [dbo].[AccTravelExpenseItem] ADD CONSTRAINT [FK_AccTravelItem_Section] FOREIGN KEY ([VehicleSectionId]) REFERENCES [dbo].[AccTravelVehicleSection] ([Id]) ON DELETE CASCADE;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_AccTravelSection_Travel')
ALTER TABLE [dbo].[AccTravelVehicleSection] ADD CONSTRAINT [FK_AccTravelSection_Travel] FOREIGN KEY ([TravelExpenseId]) REFERENCES [dbo].[AccTravelExpense] ([Id]) ON DELETE CASCADE;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_AccTravelVehiclePlace_Vehicle')
ALTER TABLE [dbo].[AccTravelVehiclePlace] ADD CONSTRAINT [FK_AccTravelVehiclePlace_Vehicle] FOREIGN KEY ([VehicleOptionId]) REFERENCES [dbo].[AccTravelVehicleOption] ([Id]) ON DELETE CASCADE;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_AccTravelWorkLocation_Booking')
ALTER TABLE [dbo].[AccTravelWorkLocation] ADD CONSTRAINT [FK_AccTravelWorkLocation_Booking] FOREIGN KEY ([TravelBookingId]) REFERENCES [dbo].[AccTravelBooking] ([Id]) ON DELETE CASCADE;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Approvals_SubmissionId')
ALTER TABLE [dbo].[OfficeFormApprovals] ADD CONSTRAINT [FK_Approvals_SubmissionId] FOREIGN KEY ([SubmissionId]) REFERENCES [dbo].[OfficeFormSubmissions] ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Approvals_WorkflowStepId')
ALTER TABLE [dbo].[OfficeFormApprovals] ADD CONSTRAINT [FK_Approvals_WorkflowStepId] FOREIGN KEY ([WorkflowStepId]) REFERENCES [dbo].[OfficeFormWorkflowSteps] ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_EmailQueue_SubmissionId')
ALTER TABLE [dbo].[OfficeFormEmailQueue] ADD CONSTRAINT [FK_EmailQueue_SubmissionId] FOREIGN KEY ([SubmissionId]) REFERENCES [dbo].[OfficeFormSubmissions] ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_FormFiles_SubmissionId')
ALTER TABLE [dbo].[OfficeFormFiles] ADD CONSTRAINT [FK_FormFiles_SubmissionId] FOREIGN KEY ([SubmissionId]) REFERENCES [dbo].[OfficeFormSubmissions] ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_FormVersions_FormId')
ALTER TABLE [dbo].[OfficeFormVersions] ADD CONSTRAINT [FK_FormVersions_FormId] FOREIGN KEY ([FormId]) REFERENCES [dbo].[OfficeForms] ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Submissions_FormId')
ALTER TABLE [dbo].[OfficeFormSubmissions] ADD CONSTRAINT [FK_Submissions_FormId] FOREIGN KEY ([FormId]) REFERENCES [dbo].[OfficeForms] ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Submissions_FormVersionId')
ALTER TABLE [dbo].[OfficeFormSubmissions] ADD CONSTRAINT [FK_Submissions_FormVersionId] FOREIGN KEY ([FormVersionId]) REFERENCES [dbo].[OfficeFormVersions] ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_Workflows_FormId')
ALTER TABLE [dbo].[OfficeFormWorkflows] ADD CONSTRAINT [FK_Workflows_FormId] FOREIGN KEY ([FormId]) REFERENCES [dbo].[OfficeForms] ([Id]);
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_WorkflowSteps_WorkflowId')
ALTER TABLE [dbo].[OfficeFormWorkflowSteps] ADD CONSTRAINT [FK_WorkflowSteps_WorkflowId] FOREIGN KEY ([WorkflowId]) REFERENCES [dbo].[OfficeFormWorkflows] ([Id]);
GO
