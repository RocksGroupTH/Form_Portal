-- =============================================
-- Migration: Thai province master (AP-17 accommodation/ticket booking)
-- Database: Fast_Data
-- Apply: npm run apply-sql -- --db Fast_Data --file migrations/049_fast_data_travel_province.sql
-- =============================================

USE [Fast_Data];
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'TravelProvince')
BEGIN
  CREATE TABLE [dbo].[TravelProvince] (
    [Id]       INT           IDENTITY(1,1) NOT NULL,
    [NameTh]   NVARCHAR(100) NOT NULL,
    [NameEn]   NVARCHAR(100) NULL,
    [IsActive] BIT           NOT NULL DEFAULT 1,
    CONSTRAINT [PK_TravelProvince] PRIMARY KEY ([Id]),
    CONSTRAINT [UQ_TravelProvince_NameTh] UNIQUE ([NameTh])
  );
  PRINT 'Created TravelProvince';
END
ELSE PRINT 'TravelProvince already exists — skipping';
GO

-- Seed the 77 official Thai provinces (idempotent — only runs on an empty table).
-- NameEn is a best-effort standard romanization (informational display only).
IF NOT EXISTS (SELECT 1 FROM [dbo].[TravelProvince])
BEGIN
  INSERT INTO [dbo].[TravelProvince] (NameTh, NameEn) VALUES
    (N'กรุงเทพมหานคร', N'Bangkok'),
    (N'กระบี่', N'Krabi'),
    (N'กาญจนบุรี', N'Kanchanaburi'),
    (N'กาฬสินธุ์', N'Kalasin'),
    (N'กำแพงเพชร', N'Kamphaeng Phet'),
    (N'ขอนแก่น', N'Khon Kaen'),
    (N'จันทบุรี', N'Chanthaburi'),
    (N'ฉะเชิงเทรา', N'Chachoengsao'),
    (N'ชลบุรี', N'Chon Buri'),
    (N'ชัยนาท', N'Chai Nat'),
    (N'ชัยภูมิ', N'Chaiyaphum'),
    (N'ชุมพร', N'Chumphon'),
    (N'เชียงราย', N'Chiang Rai'),
    (N'เชียงใหม่', N'Chiang Mai'),
    (N'ตรัง', N'Trang'),
    (N'ตราด', N'Trat'),
    (N'ตาก', N'Tak'),
    (N'นครนายก', N'Nakhon Nayok'),
    (N'นครปฐม', N'Nakhon Pathom'),
    (N'นครพนม', N'Nakhon Phanom'),
    (N'นครราชสีมา', N'Nakhon Ratchasima'),
    (N'นครศรีธรรมราช', N'Nakhon Si Thammarat'),
    (N'นครสวรรค์', N'Nakhon Sawan'),
    (N'นนทบุรี', N'Nonthaburi'),
    (N'นราธิวาส', N'Narathiwat'),
    (N'น่าน', N'Nan'),
    (N'บึงกาฬ', N'Bueng Kan'),
    (N'บุรีรัมย์', N'Buriram'),
    (N'ปทุมธานี', N'Pathum Thani'),
    (N'ประจวบคีรีขันธ์', N'Prachuap Khiri Khan'),
    (N'ปราจีนบุรี', N'Prachinburi'),
    (N'ปัตตานี', N'Pattani'),
    (N'พระนครศรีอยุธยา', N'Phra Nakhon Si Ayutthaya'),
    (N'พะเยา', N'Phayao'),
    (N'พังงา', N'Phang Nga'),
    (N'พัทลุง', N'Phatthalung'),
    (N'พิจิตร', N'Phichit'),
    (N'พิษณุโลก', N'Phitsanulok'),
    (N'เพชรบุรี', N'Phetchaburi'),
    (N'เพชรบูรณ์', N'Phetchabun'),
    (N'แพร่', N'Phrae'),
    (N'ภูเก็ต', N'Phuket'),
    (N'มหาสารคาม', N'Maha Sarakham'),
    (N'มุกดาหาร', N'Mukdahan'),
    (N'แม่ฮ่องสอน', N'Mae Hong Son'),
    (N'ยโสธร', N'Yasothon'),
    (N'ยะลา', N'Yala'),
    (N'ร้อยเอ็ด', N'Roi Et'),
    (N'ระนอง', N'Ranong'),
    (N'ระยอง', N'Rayong'),
    (N'ราชบุรี', N'Ratchaburi'),
    (N'ลพบุรี', N'Lopburi'),
    (N'ลำปาง', N'Lampang'),
    (N'ลำพูน', N'Lamphun'),
    (N'เลย', N'Loei'),
    (N'ศรีสะเกษ', N'Sisaket'),
    (N'สกลนคร', N'Sakon Nakhon'),
    (N'สงขลา', N'Songkhla'),
    (N'สตูล', N'Satun'),
    (N'สมุทรปราการ', N'Samut Prakan'),
    (N'สมุทรสงคราม', N'Samut Songkhram'),
    (N'สมุทรสาคร', N'Samut Sakhon'),
    (N'สระแก้ว', N'Sa Kaeo'),
    (N'สระบุรี', N'Saraburi'),
    (N'สิงห์บุรี', N'Sing Buri'),
    (N'สุโขทัย', N'Sukhothai'),
    (N'สุพรรณบุรี', N'Suphan Buri'),
    (N'สุราษฎร์ธานี', N'Surat Thani'),
    (N'สุรินทร์', N'Surin'),
    (N'หนองคาย', N'Nong Khai'),
    (N'หนองบัวลำภู', N'Nong Bua Lamphu'),
    (N'อ่างทอง', N'Ang Thong'),
    (N'อำนาจเจริญ', N'Amnat Charoen'),
    (N'อุดรธานี', N'Udon Thani'),
    (N'อุตรดิตถ์', N'Uttaradit'),
    (N'อุทัยธานี', N'Uthai Thani'),
    (N'อุบลราชธานี', N'Ubon Ratchathani');
  PRINT 'Seeded 77 Thai provinces';
END
GO

PRINT '=== Migration 049 complete ===';
GO
