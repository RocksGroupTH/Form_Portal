-- =============================================
-- Migration: Sync AccBankMaster to sheet AP2.1 exactly (34 banks, exact names/codes)
-- Database: Rocks_Portal_Form_UAT (AP-2 is flagged UAT) — also safe on Rocks_Portal_Form
-- Apply: npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/080_acc_bank_master_ap21.sql
--
-- Adds the two missing rows (098 SME Bank, 111 PROMPT PAY) and corrects names to
-- match the AP2.1 master verbatim. Idempotent (MERGE): updates only changed rows.
-- =============================================

MERGE [dbo].[AccBankMaster] AS t
USING (VALUES
  ('002', N'Bangkok Bank',                         1),
  ('004', N'KASIKORNBANK',                         2),
  ('005', N'ABN Amro',                             3),
  ('006', N'KRUNG THAI BANK',                      4),
  ('008', N'JP morgan chase',                      5),
  ('010', N'BAY BTMU',                             6),
  ('011', N'TMB Bank',                             7),
  ('014', N'Siam Commercial Bank',                 8),
  ('015', N'THE SIAM CITY BANK',                   9),
  ('017', N'Citibank',                            10),
  ('018', N'SUMITOMO MITSUI BANKING',             11),
  ('020', N'Standard Chartered Bank',             12),
  ('022', N'CIMB Bank (Bank thai)',               13),
  ('024', N'UOB (Thailand)',                      14),
  ('025', N'Bank of Ayuthaya',                    15),
  ('026', N'Mega International Commercial Bank',   16),
  ('027', N'BANK OF AMERICA, NATIONAL',           17),
  ('028', N'CALYON',                              18),
  ('030', N'Government Saving Bank',              19),
  ('031', N'HSBC',                                20),
  ('032', N'DEUTSCHE BANK',                       21),
  ('033', N'Government Housing Bank',             22),
  ('034', N'BANK FOR AGRICULTURE AND AGRICULTURAL',23),
  ('039', N'MIZUHO CORPORATE BANK',               24),
  ('065', N'THANACHART BANK',                     25),
  ('066', N'Ibank',                               26),
  ('067', N'TISCO BANK',                          27),
  ('069', N'KIATNAKIN BANK',                      28),
  ('070', N'ICBC Thai',                           29),
  ('071', N'The Thai Credit Retail Bank',         30),
  ('072', N'GE money',                            31),
  ('073', N'Land and House',                      32),
  ('098', N'SME Bank',                            33),
  ('111', N'PROMPT PAY',                          34)
) AS s(BankCode, BankName, SortOrder)
ON t.BankCode = s.BankCode
WHEN MATCHED AND (t.BankName <> s.BankName OR t.SortOrder <> s.SortOrder)
  THEN UPDATE SET BankName = s.BankName, SortOrder = s.SortOrder, UpdatedAt = SYSDATETIME()
WHEN NOT MATCHED BY TARGET
  THEN INSERT (BankCode, BankName, SortOrder) VALUES (s.BankCode, s.BankName, s.SortOrder);
GO

PRINT '=== Migration 071 complete (AccBankMaster synced to AP2.1, 34 banks) ===';
GO
