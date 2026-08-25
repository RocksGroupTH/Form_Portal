-- =============================================
-- Migration: Bank Master (from AP2.1) — payee-bank reference list
-- Database: Rocks_Portal_Form (+ Rocks_Portal_Form_UAT)
-- Apply: npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/074_acc_bank_master.sql
--        npm run apply-sql -- --db Rocks_Portal_Form     --file migrations/074_acc_bank_master.sql
--
-- NOTE: AccBankMaster = ธนาคารของ "ผู้รับโอน" (dropdown metadata) — คนละตารางกับ
--       AccBrandBankAccount (= bank ของ "บริษัท" ที่ใช้ในบรรทัด Cr ของ journal).
--       Phase 1: seed ไว้แต่ยังไม่เรียกใช้ใน UI (payee = พนักงาน ดึง bank จาก HR master).
--       Phase 2: AccAdvance.PayeeBankCode จะ FK มาที่ตารางนี้.
--       ไม่ใช่ 1 ใน 19 dual-write tables — ต้องรัน migration บน Prod และ UAT แยกกัน.
-- =============================================

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'AccBankMaster')
BEGIN
  CREATE TABLE [dbo].[AccBankMaster] (
    [Id]        INT           IDENTITY(1,1) NOT NULL,
    [BankCode]  NVARCHAR(10)  NOT NULL,   -- รหัสตาม BOT: '002', '004', ...
    [BankName]  NVARCHAR(200) NOT NULL,
    [IsActive]  BIT           NOT NULL CONSTRAINT [DF_AccBankMaster_IsActive] DEFAULT (1),
    [SortOrder] INT           NOT NULL CONSTRAINT [DF_AccBankMaster_SortOrder] DEFAULT (0),
    [CreatedAt] DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    [UpdatedAt] DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT [PK_AccBankMaster] PRIMARY KEY ([Id]),
    CONSTRAINT [UQ_AccBankMaster_Code] UNIQUE ([BankCode])
  );
  PRINT 'Created AccBankMaster';
END
ELSE PRINT 'AccBankMaster already exists — skipping';
GO

-- Seed ธนาคาร (idempotent — insert เฉพาะ BankCode ที่ยังไม่มี)
INSERT INTO [dbo].[AccBankMaster] ([BankCode], [BankName], [SortOrder])
SELECT v.BankCode, v.BankName, v.SortOrder
FROM (VALUES
    ('002', N'Bangkok Bank',              1),
    ('004', N'KASIKORNBANK',              2),
    ('005', N'ABN Amro',                  3),
    ('006', N'KRUNG THAI BANK',           4),
    ('008', N'JP Morgan Chase',           5),
    ('010', N'BAY BTMU',                  6),
    ('011', N'TMB Bank',                  7),
    ('014', N'Siam Commercial Bank',      8),
    ('015', N'THE SIAM CITY BANK',        9),
    ('017', N'Citibank',                 10),
    ('018', N'SUMITOMO MITSUI',          11),
    ('020', N'Standard Chartered',       12),
    ('022', N'CIMB (Bank Thai)',         13),
    ('024', N'UOB (Thailand)',           14),
    ('025', N'Bank of Ayudhya',          15),
    ('026', N'Mega International',        16),
    ('027', N'Bank of America',          17),
    ('028', N'Calyon',                   18),
    ('030', N'Government Saving Bank',   19),
    ('031', N'HSBC',                     20),
    ('032', N'Deutsche Bank',            21),
    ('033', N'Government Housing Bank',  22),
    ('034', N'BAAC',                     23),
    ('039', N'Mizuho',                   24),
    ('065', N'Thanachart',               25),
    ('066', N'Ibank',                    26),
    ('067', N'TISCO',                    27),
    ('069', N'Kiatnakin',                28),
    ('070', N'ICBC Thai',                29),
    ('071', N'Thai Credit Retail',       30),
    ('072', N'GE Money',                 31),
    ('073', N'Land and House',           32)
) AS v(BankCode, BankName, SortOrder)
WHERE NOT EXISTS (
  SELECT 1 FROM [dbo].[AccBankMaster] m WHERE m.BankCode = v.BankCode
);
PRINT 'Seeded AccBankMaster (idempotent)';
GO

PRINT '=== Migration 063 complete ===';
GO
