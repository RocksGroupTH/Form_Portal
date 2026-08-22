-- =============================================
-- Migration: AP-3 (Clear Advance / เคลียร์คืนเงินทดรองจ่าย)
-- Database: Rocks_Portal_Form (+ Rocks_Portal_Form_UAT)
-- Apply: npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/098_clr_clear_advance.sql
--        npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/098_clr_clear_advance.sql
--
-- AP-3 clears an approved AP-2 advance. Faithful to the Excel spec (AP-3 / AP-3.1
-- / AP-3.2). Phase 1: NO ERP auto-post — the form captures full ERP-grade line
-- data (G/L account, VAT, WHT, branch dimension, running balance) so the AP-3-Detail
-- report/export can drive the manual journal, and so auto-post is a later add.
-- AP-3 owns its own approval table (3 steps: Manager → Account → Head — the shared
-- AccApproval CHECK forbids a 3rd step). It reads AP-2 read-only; whether an advance
-- is still open is derived, never written back to AP-2 tables.
-- Not part of the 19 dual-write tables — run on Prod and UAT separately.
-- =============================================

/* 1. Seed AccFormMaster AP-3 ------------------------------------------------- */
IF NOT EXISTS (SELECT 1 FROM [dbo].[AccFormMaster] WHERE FormCode = 'AP-3')
  INSERT INTO [dbo].[AccFormMaster]
    (FormCode, GroupName, FormNameTh, FormNameEn, RunningPrefix, OwnerContact, SortOrder)
  VALUES
    ('AP-3', 'Accounting',
     N'แบบฟอร์มเคลียร์คืนเงินทดรองจ่าย (Clear Advance)',
     N'Clear Advance Form',
     'ADC', NULL, 3);
GO

/* Grant AP-3 the same brand access as AP-1 (so the brand picker is populated) -- */
INSERT INTO [dbo].[AccFormBrand] (FormCode, BrandCode, IsActive, SortOrder)
SELECT 'AP-3', b.BrandCode, b.IsActive, b.SortOrder
FROM [dbo].[AccFormBrand] b
WHERE b.FormCode = 'AP-1'
  AND NOT EXISTS (
    SELECT 1 FROM [dbo].[AccFormBrand] x
    WHERE x.FormCode = 'AP-3' AND x.BrandCode = b.BrandCode
  );
GO

/* 2. AccClearAdvance — detail header, 1:1 with AccRequest --------------------- */
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AccClearAdvance')
BEGIN
  CREATE TABLE [dbo].[AccClearAdvance] (
    [Id]                INT           IDENTITY(1,1) PRIMARY KEY,
    [RequestId]         INT           NOT NULL,          -- FK → AccRequest (this AP-3)
    -- Link to the AP-2 advance being cleared (nullable: chosen before submit, not at draft time)
    [AdvanceRequestId]  INT           NULL,              -- FK → AccRequest (the AP-2)
    [AdvanceRequestNo]  NVARCHAR(32)  NULL,              -- snapshot: RPC-ADVyy-xxxx
    [AdvanceAmount]     DECIMAL(18,2) NULL,              -- snapshot: วงเงินที่ได้รับ (starting balance)
    -- Clearing content
    [ExpenseOf]         NVARCHAR(50)  NULL,              -- เป็นค่าใช้จ่ายของ: Rocks PC / Rocks Malaysia
    [ActualTotal]       DECIMAL(18,2) NULL,              -- Σ NetAmount ของทุกบรรทัด (จ่ายจริงสุทธิ)
    [RefundToCompany]   DECIMAL(18,2) NULL,              -- AdvanceAmount − ActualTotal (บวก = คืนบริษัท, ลบ = บริษัทจ่ายเพิ่ม)
    [Currency]          NVARCHAR(10)  NOT NULL CONSTRAINT [DF_AccClearAdvance_Currency] DEFAULT (N'THB'),
    [WhtNote]           NVARCHAR(500) NULL,
    -- Refund back to company (required when RefundToCompany > 0)
    [RefundTransferDate]   DATE          NULL,           -- วันที่โอนเงินคืน (default จาก OCR สลิป)
    [RefundTransferAmount] DECIMAL(18,2) NULL,           -- ยอดที่โอนคืนจริง (default จาก OCR สลิป, แก้ไขได้)
    -- Captured by the Account step
    [PvDocNo]           NVARCHAR(50)  NULL,              -- เลขที่เอกสาร PV / PPEX
    [PaymentDate]       DATE          NULL,              -- วันจ่าย (ศุกร์) — เฉพาะกรณีบริษัทจ่ายเพิ่ม
    [CreatedAt]         DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    [UpdatedAt]         DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT [FK_AccClearAdvance_Request]  FOREIGN KEY ([RequestId])        REFERENCES [AccRequest]([Id]),
    CONSTRAINT [FK_AccClearAdvance_Advance]  FOREIGN KEY ([AdvanceRequestId]) REFERENCES [AccRequest]([Id]),
    CONSTRAINT [UQ_AccClearAdvance_Request]  UNIQUE ([RequestId])
  );
  CREATE INDEX [IX_AccClearAdvance_Request] ON [AccClearAdvance]([RequestId]);
  CREATE INDEX [IX_AccClearAdvance_Advance] ON [AccClearAdvance]([AdvanceRequestId]);
  PRINT 'Created AccClearAdvance';
END
ELSE PRINT 'AccClearAdvance already exists — skipping';
GO

/* 3. AccClearAdvanceItem — actual expense lines (AP-3.1 section 1) ----------- */
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AccClearAdvanceItem')
BEGIN
  CREATE TABLE [dbo].[AccClearAdvanceItem] (
    [Id]              INT           IDENTITY(1,1) PRIMARY KEY,
    [ClearAdvanceId]  INT           NOT NULL,            -- FK → AccClearAdvance
    [LineNo]          INT           NOT NULL DEFAULT 0,  -- ลำดับที่
    [ExpenseDate]     DATE          NULL,                -- วันที่
    [DocNo]           NVARCHAR(100) NULL,                -- เลขที่เอกสาร (free text)
    [GlAccountNo]     NVARCHAR(20)  NULL,                -- รายการ → AP-3.2 G/L
    [GlAccountName]   NVARCHAR(200) NULL,                -- snapshot ชื่อบัญชี
    [Description]     NVARCHAR(500) NULL,                -- รายละเอียด (free text)
    [BranchCode]      NVARCHAR(40)  NULL,                -- สาขา (BU/Branch dimension)
    [AmountBeforeVat] DECIMAL(18,2) NOT NULL DEFAULT 0,  -- ค่าใช้จ่าย (ยอดก่อน VAT)
    [VatAmount]       DECIMAL(18,2) NOT NULL DEFAULT 0,  -- ภาษีมูลค่าเพิ่ม (VAT)
    [TotalInclVat]    DECIMAL(18,2) NOT NULL DEFAULT 0,  -- ค่าใช้จ่ายรวม (before + VAT)
    [WhtAmount]       DECIMAL(18,2) NOT NULL DEFAULT 0,  -- ภาษีหัก ณ ที่จ่าย (ถ้ามี)
    [NetAmount]       DECIMAL(18,2) NOT NULL DEFAULT 0,  -- จำนวนจ่ายสุทธิ (total − WHT)
    [SortOrder]       INT           NOT NULL DEFAULT 0,
    CONSTRAINT [FK_AccClearAdvanceItem_Parent] FOREIGN KEY ([ClearAdvanceId]) REFERENCES [AccClearAdvance]([Id])
  );
  CREATE INDEX [IX_AccClearAdvanceItem_Parent] ON [AccClearAdvanceItem]([ClearAdvanceId]);
  PRINT 'Created AccClearAdvanceItem';
END
ELSE PRINT 'AccClearAdvanceItem already exists — skipping';
GO

/* 4. AccClearAdvanceWht — WHT certificate lines (AP-3.1 section 2) ----------- */
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AccClearAdvanceWht')
BEGIN
  CREATE TABLE [dbo].[AccClearAdvanceWht] (
    [Id]             INT           IDENTITY(1,1) PRIMARY KEY,
    [ClearAdvanceId] INT           NOT NULL,             -- FK → AccClearAdvance
    [LineNo]         INT           NOT NULL DEFAULT 0,
    [ExpenseDate]    DATE          NULL,
    [DocNo]          NVARCHAR(100) NULL,
    [Description]    NVARCHAR(500) NULL,
    [TaxId]          NVARCHAR(20)  NULL,                 -- เลขที่ผู้เสียภาษี (user fills)
    [PayeeName]      NVARCHAR(300) NULL,                 -- ชื่อ-สกุล/ชื่อบริษัท (user fills)
    [PayeeAddress]   NVARCHAR(500) NULL,                 -- ที่อยู่ (user fills)
    [Amount]         DECIMAL(18,2) NOT NULL DEFAULT 0,   -- ค่าใช้จ่าย
    [WhtAmount]      DECIMAL(18,2) NOT NULL DEFAULT 0,   -- ภาษีหัก ณ ที่จ่าย
    [NetAmount]      DECIMAL(18,2) NOT NULL DEFAULT 0,   -- จำนวนจ่ายสุทธิ
    [SortOrder]      INT           NOT NULL DEFAULT 0,
    CONSTRAINT [FK_AccClearAdvanceWht_Parent] FOREIGN KEY ([ClearAdvanceId]) REFERENCES [AccClearAdvance]([Id])
  );
  CREATE INDEX [IX_AccClearAdvanceWht_Parent] ON [AccClearAdvanceWht]([ClearAdvanceId]);
  PRINT 'Created AccClearAdvanceWht';
END
ELSE PRINT 'AccClearAdvanceWht already exists — skipping';
GO

/* 5. AccClearAdvanceGl — AP-3.2 G/L expense-category master ------------------ */
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AccClearAdvanceGl')
BEGIN
  CREATE TABLE [dbo].[AccClearAdvanceGl] (
    [Id]            INT           IDENTITY(1,1) PRIMARY KEY,
    [GlAccountNo]   NVARCHAR(20)  NOT NULL,
    [NameTh]        NVARCHAR(200) NULL,
    [NameEn]        NVARCHAR(200) NULL,
    [DimensionType] NVARCHAR(20)  NOT NULL DEFAULT 'Employee', -- Employee | Branch | Both
    [IsActive]      BIT           NOT NULL DEFAULT 1,
    [SortOrder]     INT           NOT NULL DEFAULT 0,
    [CreatedAt]     DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    [UpdatedAt]     DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT [UQ_AccClearAdvanceGl_No] UNIQUE ([GlAccountNo]),
    CONSTRAINT [CK_AccClearAdvanceGl_Dim] CHECK ([DimensionType] IN ('Employee','Branch','Both'))
  );
  PRINT 'Created AccClearAdvanceGl';
END
ELSE PRINT 'AccClearAdvanceGl already exists — skipping';
GO

-- Seed AP-3.2 master (idempotent — insert only G/L nos not already present) --
INSERT INTO [dbo].[AccClearAdvanceGl] (GlAccountNo, NameTh, NameEn, DimensionType, SortOrder)
SELECT v.GlAccountNo, v.NameTh, v.NameEn, v.DimensionType, v.SortOrder
FROM (VALUES
  ('610322005', N'ค่าจอดรถ', N'Parking Fee', 'Employee', 1),
  ('610321003', N'ค่าอากรแสตมป์', N'Stamp Duty', 'Employee', 2),
  ('610319001', N'ค่ารับรอง', N'Entertainment Dinner Expense', 'Employee', 3),
  ('610318006', N'ค่าธรรมเนียมอื่นๆ', N'Other Fees', 'Employee', 4),
  ('610318004', N'ค่าธรรมเนียมกรมพัฒนาธุรกิจการค้า', N'Department of Business Development Fee', 'Employee', 5),
  ('610318002', N'ค่าธรรมเนียมธนาคาร', N'Bank Fees', 'Employee', 6),
  ('610316002', N'ค่าวิจัยและพัฒนา - การตลาด', N'Research and Development Expenses - Marketing', 'Employee', 7),
  ('610316001', N'ค่าวิจัยและพัฒนา - สินค้า', N'Research and Development Expenses - Products', 'Employee', 8),
  ('610314003', N'ค่าอาหารเเละน้ำดื่ม', N'Food and Drink Costs', 'Employee', 9),
  ('610314001', N'ค่าเครื่องเขียน อุปกรณ์ และวัสดุสิ้นเปลือง', N'Cost of Stationery, Equipment and Supplies', 'Employee', 10),
  ('610312004', N'ค่าซ่อมบำรุง - อุปกรณ์สำนักงาน', N'Maintenance Expense - Office Equipment', 'Employee', 11),
  ('610312003', N'ค่าซ่อมบำรุง - เครื่องตกแต่ง', N'Maintenance Expense - Furniture and Fixtures', 'Employee', 12),
  ('610311002', N'ค่าใช้จ่ายวัสดุเเละอุปกรณ์ IT', N'IT Equipment and Supplies Expense', 'Employee', 13),
  ('610310003', N'ค่าไปรษณีย์', N'Postage Fee', 'Employee', 14),
  ('610309003', N'ค่าบริการขนส่งสินค้า', N'Shipping Service Fee', 'Employee', 15),
  ('610309002', N'ค่าขนส่งเอกสารและพัสดุ', N'Document and Parcel Delivery Fee', 'Employee', 16),
  ('610303003', N'ค่าใช้จ่ายส่งเสริมการขาย - ค่ารางวัลการตลาด', N'Promotional Expenses - Marketing Awards', 'Employee', 17),
  ('610302006', N'ค่าใช้จ่ายการตลาดอื่นๆ', N'Other Marketing Expenses', 'Employee', 18),
  ('610302001', N'ค่าโฆษณาออนไลน์', N'Online Advertising Expenses', 'Employee', 19),
  ('610301019', N'สวัสดิการพนักงานอื่นๆ', N'Other Employee Benefit Expenses', 'Both', 20),
  ('610301016', N'ค่าอบรมสัมมนา', N'Seminar Fee', 'Employee', 21),
  ('610301014', N'ค่าเดินทาง (น้ำมัน)', N'Travel Expenses (Fuel)', 'Employee', 22),
  ('610301011', N'ค่าเวชภัณฑ์และค่ารักษาพยาบาล', N'Medical Supplies and Medical Expenses', 'Employee', 23),
  ('610204007', N'ค่าขนส่งสินค้า - อื่นๆ', N'Other Shipping Cost', 'Employee', 24),
  ('610204002', N'ค่าขนส่งสินค้า - คลังแช่แข็ง', N'Shipping Cost - Frozen', 'Employee', 25),
  ('610204001', N'ค่าขนส่งสินค้า - คลังแห้ง', N'Shipping Cost - Dry', 'Employee', 26),
  ('610202005', N'ค่าดำเนินงาน - คลังแช่แข็ง', N'Warehouse Operating Cost - Frozen', 'Employee', 27),
  ('610116004', N'ค่าบริการรื้อถอนเเละย้ายร้าน - สาขา', N'Store Demolition and Relocation Fee - Branch', 'Branch', 28),
  ('610116003', N'ค่าใช้จ่ายอื่น - สาขา', N'Other Expenses - Branch', 'Branch', 29),
  ('610113001', N'ค่าเครื่องเขียน อุปกรณ์ และวัสดุสิ้นเปลือง - สาขา', N'Cost of Stationery, Equipment and Supplies - Branch', 'Branch', 30),
  ('610111002', N'ค่าซ่อมบำรุง - เครื่องจักรเเละอุปกรณ์ - สาขา', N'Maintenance Expense - Machinery and Equipment - Branch', 'Branch', 31),
  ('610111001', N'ค่าซ่อมบำรุง - ร้านค้า - สาขา', N'Maintenance Expense - Store - Branch', 'Branch', 32),
  ('610109003', N'ค่าไปรษณีย์ - สาขา', N'Postage Fee - Branch', 'Branch', 33),
  ('610109002', N'ค่าอินเตอร์เน็ต - สาขา', N'Internet Bill - Branch', 'Branch', 34),
  ('610107001', N'ค่าขนส่งสินค้า - สาขา', N'Freight - Branch', 'Branch', 35),
  ('610101021', N'ค่าใช้จ่ายนักศึกษาทวิภาคี-ผลประโยชน์อื่นๆ', N'Student DVE - Other Benefit Expenses', 'Both', 36),
  ('610101016', N'ค่าอบรมสัมมนา - สาขา', N'Seminar Fee - Branch', 'Branch', 37),
  ('610101014', N'ค่าเดินทาง - สาขา', N'Travel Expenses - Branch', 'Branch', 38),
  ('610101011', N'ค่าเวชภัณฑ์และค่ารักษาพยาบาล - สาขา', N'Medical Supplies and Medical Expenses - Branch', 'Branch', 39),
  ('110721001', N'เงินทดรองจ่าย - แฟรนไชส์ - ทั่วไป', N'Advance - Franchise - General', 'Both', 40),
  ('110711005', N'ค่าใช้จ่ายจ่ายล่วงหน้า(ยังไม่ได้รับบริการ/Period expense)', N'Other Prepaid Expenses (Waiting service/Product)', 'Both', 41),
  ('910300003', N'ค่าใช้จ่ายอื่นๆ', N'Other Expenses', 'Both', 42),
  ('110723001', N'เงินจ่ายแทนบ.อื่น (KSI/RFM/Llao Llao/Uno)', N'Advance - Other', 'Both', 43)
) AS v(GlAccountNo, NameTh, NameEn, DimensionType, SortOrder)
WHERE NOT EXISTS (
  SELECT 1 FROM [dbo].[AccClearAdvanceGl] g WHERE g.GlAccountNo = v.GlAccountNo
);
GO

/* 6. AccClearAdvanceApproval — AP-3 owns its 3-step chain -------------------- */
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AccClearAdvanceApproval')
BEGIN
  CREATE TABLE [dbo].[AccClearAdvanceApproval] (
    [Id]                INT            IDENTITY(1,1) PRIMARY KEY,
    [RequestId]         INT            NOT NULL,
    [StepCode]          NVARCHAR(20)   NOT NULL,          -- 'MANAGER' | 'ACCOUNT' | 'HEAD'
    [StepOrder]         INT            NOT NULL,
    [AssignedStaffId]   INT            NULL,
    [AssignedEmail]     NVARCHAR(200)  NULL,
    [Status]            NVARCHAR(20)   NOT NULL DEFAULT 'Pending',
    [Comment]           NVARCHAR(2000) NULL,
    [IsChecked]         BIT            NULL,
    [ActionedByStaffId] INT            NULL,
    [ActionedAt]        DATETIME2      NULL,
    [CreatedAt]         DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT [FK_AccClearAdvanceApproval_Request] FOREIGN KEY ([RequestId]) REFERENCES [AccRequest]([Id]),
    CONSTRAINT [CK_AccClearAdvanceApproval_Step]   CHECK ([StepCode] IN ('MANAGER','ACCOUNT','HEAD')),
    CONSTRAINT [CK_AccClearAdvanceApproval_Status] CHECK ([Status] IN ('Pending','Approved','Rejected','Returned'))
  );
  CREATE INDEX [IX_AccClearAdvanceApproval_Request] ON [AccClearAdvanceApproval]([RequestId]);
  PRINT 'Created AccClearAdvanceApproval';
END
ELSE PRINT 'AccClearAdvanceApproval already exists — skipping';
GO

/* 7. AccClearAdvanceApprover — config for ACCOUNT + HEAD approvers ----------- */
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AccClearAdvanceApprover')
BEGIN
  CREATE TABLE [dbo].[AccClearAdvanceApprover] (
    [Id]          INT           IDENTITY(1,1) PRIMARY KEY,
    [Role]        NVARCHAR(20)  NOT NULL,               -- 'ACCOUNT' | 'HEAD'
    [Email]       NVARCHAR(200) NOT NULL,
    [StaffId]     INT           NULL,
    [DisplayName] NVARCHAR(200) NULL,
    [IsActive]    BIT           NOT NULL DEFAULT 1,
    [CreatedBy]   INT           NULL,
    [CreatedAt]   DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    [UpdatedAt]   DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT [CK_AccClearAdvanceApprover_Role] CHECK ([Role] IN ('ACCOUNT','HEAD'))
  );
  CREATE UNIQUE INDEX [UX_AccClearAdvanceApprover_RoleEmail] ON [AccClearAdvanceApprover]([Role],[Email]);
  PRINT 'Created AccClearAdvanceApprover';
END
ELSE PRINT 'AccClearAdvanceApprover already exists — skipping';
GO

PRINT '=== Migration 098 complete ===';
GO
