-- 164 — Each form's notice copy, so it can be changed without a deploy.
--
-- Apply with:
--   npm run apply-sql -- --db Fast_Core --file migrations/164_core_form_message.sql
--
-- TARGET: Fast_Core, and only Fast_Core.
--
-- ## Why here
--
-- Beside `FormOwner` (163), and for reasons stronger than that one's. There is
-- no identity column at all — `FormCode` is the key — so none of the
-- dual-write lockstep hazards can apply. **One physical copy. Not
-- dual-written, not in MASTER_TABLES:** `npm run check:alignment` must still
-- report **30** afterwards, and 31 means this was wrongly added to that list.
--
-- One copy is the correct answer rather than a convenience. The notice is
-- process copy — "จ่ายทุกศุกร์ที่ 2 และ 4" is the same sentence whether a
-- request lands in Rocks_Portal_Form or Rocks_Portal_Form_UAT. A
-- per-environment copy would be a way for the two to disagree silently.
--
-- The read rides on /api/form-environment, which already opens this pool and
-- already carries `owners` — so the text and the names the {เจ้าของฟอร์ม}
-- token expands to arrive in one payload.
--
-- ## The body format
--
-- **A BLANK line separates two bullets; a single newline does not.** AP-4's
-- six compliance paragraphs each contain single newlines, and measured
-- 2026-09-25 none contains a blank line — so this rule round-trips that
-- notice exactly, where one-line-per-bullet would split it into about fifteen.
-- `src/features/reimburse/constants.test.ts` asserts that round trip against
-- this file, so corrupting the seed here fails the suite.
--
-- FormCode is NOT foreign-keyed to AccFormMaster: that table lives in
-- Rocks_Portal_Form and this database cannot reference it.
--
-- AP-2 and AP-3 are deliberately NOT seeded. Neither form has a notice today,
-- and an absent row means "fall back to the constant" while an empty body
-- means "show nothing" — seeding them empty would assert a decision nobody
-- has taken.
--
-- Idempotent. Safe to re-run: the seed is guarded by NOT EXISTS, so a re-run
-- never overwrites an edit made from the settings page.

SET XACT_ABORT ON;
GO

-- `DB_NAME()` has to go through a variable: RAISERROR's substitution arguments
-- are constants or variables and never expressions, so calling it inline is a
-- parse error — the mistake migration 163's first apply found. The `[_]`
-- escapes LIKE's single-character wildcard.
IF DB_NAME() NOT LIKE 'Fast[_]Core%'
BEGIN
  DECLARE @wrongDb NVARCHAR(128) = DB_NAME();
  RAISERROR('164 targets Fast_Core. Current database is %s — refusing.', 16, 1, @wrongDb);
END
GO

IF OBJECT_ID('dbo.FormMessage', 'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[FormMessage] (
    [FormCode]  NVARCHAR(20)  NOT NULL CONSTRAINT [PK_FormMessage] PRIMARY KEY,
    [BodyText]  NVARCHAR(MAX) NOT NULL,
    [UpdatedBy] NVARCHAR(200) NULL,
    [UpdatedAt] DATETIME2(7)  NOT NULL CONSTRAINT [DF_FormMessage_UpdatedAt] DEFAULT (SYSDATETIME())
  );
  PRINT '164: created dbo.FormMessage';
END
ELSE
  PRINT '164: dbo.FormMessage already exists — nothing to do';
GO

-- AP-1 — the four bullets the user specified on 2026-09-25. The first three
-- are AP1_HEADER_MESSAGE_LINES verbatim; the fourth is the contact line that
-- used to sit in a second box at the foot of the form.
IF NOT EXISTS (SELECT 1 FROM [dbo].[FormMessage] WHERE FormCode = N'AP-1')
  INSERT INTO [dbo].[FormMessage] (FormCode, BodyText, UpdatedBy)
  VALUES (N'AP-1', N'รอบการเบิกจ่ายค่าเดินทาง — ตัดรอบวันจันทร์ (อนุมัติแล้ว) และจ่ายตามปฏิทินการชำระของบริษัท (ทุกศุกร์ที่ 2 และศุกร์ที่ 4 ของเดือน)

ถ้า ผจก. อนุมัติก่อนเที่ยง เข้ารอบจ่ายถัดไป · ตั้งแต่เที่ยงเป็นต้นไป ข้ามไปอีกหนึ่งรอบ

พนักงานออฟฟิศที่กลับบ้านเกิน 21.00 น. หรือมีชั่วโมงทำงานเกิน 8 ชั่วโมง เบิกค่าเดินทางกลับบ้านได้

กรณีต้องการยกเลิกติดต่อเจ้าของฟอร์ม: {เจ้าของฟอร์ม}', NULL);
GO

-- AP-17 — AP17_HEADER_MESSAGE_LINES verbatim.
IF NOT EXISTS (SELECT 1 FROM [dbo].[FormMessage] WHERE FormCode = N'AP-17')
  INSERT INTO [dbo].[FormMessage] (FormCode, BodyText, UpdatedBy)
  VALUES (N'AP-17', N'กรุณาแจ้งข้อมูลการเดินทางล่วงหน้าอย่างน้อย 3 วันทำการ — ทีม Admin ตรวจสอบรายการจองทุกวันจันทร์–ศุกร์ เวลา 16.00

หากระยะเวลาเดินทางไม่ถึง 7 วัน และสัมภาระที่ซื้อเพิ่มไม่เกี่ยวข้องกับการทำงาน ผู้ขอเบิกรับผิดชอบค่ากระเป๋าเพิ่มเอง (กรณีซื้อกระเป๋าเพิ่ม กรุณากรอกในแบบฟอร์มครั้งแรก)

กรณีเช่ารถและต้องการประกันภัยส่วนเพิ่ม พนักงานรับผิดชอบค่าประกันเอง', NULL);
GO

-- AP-4 — REIMBURSE_NOTICE verbatim. This is the owner's own compliance copy:
-- the ** markers, the double space inside the first parenthetical and the
-- leading space on the fourth block's second line are all part of the source
-- text. Do not tidy, translate, re-order or reflow any of it.
IF NOT EXISTS (SELECT 1 FROM [dbo].[FormMessage] WHERE FormCode = N'AP-4')
  INSERT INTO [dbo].[FormMessage] (FormCode, BodyText, UpdatedBy)
  VALUES (N'AP-4', N'วิธีการเบิกค่าใช้จ่าย
- ปริ้นใบสรุปค่าใช้จ่าย Excel เเละเเนบใบเสร็จ/ใบกำกับภาษี (ตัวจริง) มาที่บัญชี ภายใน 1 เดือนหลังจากที่มีการจ่ายชำระค่าสินค้า/ค่าบริการ
- หากเป็นค่าบริการที่มีการจ่ายชำระมากกว่า 1,000 บาท ต้องมีการหัก ณ ที่จ่ายและนำส่งเอกสารภายในวันที่ 5 ของเดือนถัดไปของวันที่มีการจ่ายชำระค่าบริการ (จ่ายค่าบริการวันที่ 01-31/08/2024 ส่งเอกสารภายในวันที่ 01/09/2024  ติดวันหยุดส่งวันถัดไปตามปฎิทินวันทำงาน)

**เอกสารตัวจริงนำให้น้องQ (Senior AP Accountant)
**ไม่อนุญาตให้เบิกค่าเดินทาง/เงินมัดจำทุกรายการ
** สำหรับค่าใช้จ่ายที่เกิน 3,000 บาทต่อรายการ หากไม่เร่งด่วน รบกวนดำเนินการผ่านกระบวนการ PR นะคะ แต่หากมีความจำเป็นเร่งด่วนจริงๆ ขอความกรุณาระบุเหตุผลของความเร่งด่วนให้ด้วยค่า
(For SC/PCM : Inventory Item ต้องเปิด PO ทุกครั้งนะคะ)

**กรณีเบิกเงินเพื่อจ่ายค่าบริการมูลค่าเกิน 1,000 รบกวนติดต่อแผนกบัญชีเพื่อออกหนังสือ หัก ณ ที่จ่าย

กรณีเหมารถตู้/ค่าน้ำมัน ระบุเลขทะเบียนรถในใบเสร็จรับเงิน/ใบกำกับภาษี(ออกใบกำกับเต็มรูปเท่านั้น)
 และแนบรูปที่เห็นทะเบียนรถมาด้วยค่ะ

กรณีที่มีการเบิกค่าใช้จ่ายยอดไม่เกิน 500 บาทสามารถเบิกผ่านทาง Petty cash ของแต่ละแผนก เพื่อลดค่าใช้จ่ายค่าธรรมเนียมในการโอน แผนกไหนที่ไม่มีวงเงิน petty cash สามารถเบิกได้แผนก Admin
**ยกเว้นค่าเค้กวันเกิด/ค่ากระเช้าเยี่ยมพนักงาน สามารถเบิกได้กับทางแผนก HR เท่านั้น**

**ตัดรอบจ่ายจาก Request ที่อนุมัติแล้ววันจันทร์ 12.00 จ่ายเงิน ศุกร์ที่ 1 และ 3 ของทุกเดือน', NULL);
GO

SELECT FormCode, LEN(BodyText) AS BodyChars, UpdatedAt FROM [dbo].[FormMessage] ORDER BY FormCode;
GO
