-- Materialized report tables for Fast Intelligence
-- Run against Fast_Data database

-- 1. Daily Sales (Sales Monitor report)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Intel_DailySales')
CREATE TABLE [dbo].[Intel_DailySales] (
    Id          INT IDENTITY(1,1) PRIMARY KEY,
    Brand       NVARCHAR(10)    NOT NULL,
    ReportDate  DATE            NOT NULL,
    BranchName  NVARCHAR(200)   NULL,
    OrderType   NVARCHAR(100)   NULL,
    Channel     NVARCHAR(100)   NULL,
    Bills       INT             NOT NULL DEFAULT 0,
    Items       FLOAT           NOT NULL DEFAULT 0,
    Revenue     FLOAT           NOT NULL DEFAULT 0,
    ComputedAt  DATETIME2       NOT NULL DEFAULT GETDATE(),
    INDEX IX_DailySales_Lookup (Brand, ReportDate)
);

-- 2. Sales by Item
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Intel_SalesItem')
CREATE TABLE [dbo].[Intel_SalesItem] (
    Id          INT IDENTITY(1,1) PRIMARY KEY,
    Brand       NVARCHAR(10)    NOT NULL,
    ReportDate  DATE            NOT NULL,
    MenuName    NVARCHAR(200)   NULL,
    Category    NVARCHAR(200)   NULL,
    BranchName  NVARCHAR(200)   NULL,
    Quantity    FLOAT           NOT NULL DEFAULT 0,
    Revenue     FLOAT           NOT NULL DEFAULT 0,
    AvgPrice    FLOAT           NOT NULL DEFAULT 0,
    Bills       INT             NOT NULL DEFAULT 0,
    ComputedAt  DATETIME2       NOT NULL DEFAULT GETDATE(),
    INDEX IX_SalesItem_Lookup (Brand, ReportDate)
);

-- 3. Tender
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Intel_Tender')
CREATE TABLE [dbo].[Intel_Tender] (
    Id          INT IDENTITY(1,1) PRIMARY KEY,
    Brand       NVARCHAR(10)    NOT NULL,
    ReportDate  DATE            NOT NULL,
    TenderGroup NVARCHAR(100)   NULL,
    TenderDetail NVARCHAR(200)  NULL,
    Bills       INT             NOT NULL DEFAULT 0,
    Revenue     FLOAT           NOT NULL DEFAULT 0,
    ComputedAt  DATETIME2       NOT NULL DEFAULT GETDATE(),
    INDEX IX_Tender_Lookup (Brand, ReportDate)
);

-- 4. VAT
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Intel_VAT')
CREATE TABLE [dbo].[Intel_VAT] (
    Id          INT IDENTITY(1,1) PRIMARY KEY,
    Brand       NVARCHAR(10)    NOT NULL,
    ReportDate  DATE            NOT NULL,
    BranchName  NVARCHAR(200)   NULL,
    GrossSales  FLOAT           NOT NULL DEFAULT 0,
    NetSales    FLOAT           NOT NULL DEFAULT 0,
    VatAmount   FLOAT           NOT NULL DEFAULT 0,
    Bills       INT             NOT NULL DEFAULT 0,
    ComputedAt  DATETIME2       NOT NULL DEFAULT GETDATE(),
    INDEX IX_VAT_Lookup (Brand, ReportDate)
);

-- 5. Waste
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Intel_Waste')
CREATE TABLE [dbo].[Intel_Waste] (
    Id          INT IDENTITY(1,1) PRIMARY KEY,
    Brand       NVARCHAR(10)    NOT NULL,
    ReportDate  DATE            NOT NULL,
    BranchName  NVARCHAR(200)   NULL,
    WasteType   NVARCHAR(100)   NULL,
    MenuName    NVARCHAR(200)   NULL,
    Quantity    FLOAT           NOT NULL DEFAULT 0,
    Amount      FLOAT           NOT NULL DEFAULT 0,
    ComputedAt  DATETIME2       NOT NULL DEFAULT GETDATE(),
    INDEX IX_Waste_Lookup (Brand, ReportDate)
);
