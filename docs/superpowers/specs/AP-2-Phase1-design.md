# AP-2 Phase 1 — เบิกเงินทดรองจ่าย (Advance)
## Implementation-Ready Solution Design

**วันที่:** 2026-08-18
**เขียนโดย:** Nova (ERP Business Analyst)
**Status:** Implementation-Ready — อ่านโค้ดจริง verified ทุก pattern

---

## 0. Executive Summary

ฟอร์ม AP-2 (เบิกเงินทดรองจ่าย) Phase 1 สร้างบน Form Portal (Next.js) โดย reuse BC posting rail เดิมของ AP-1 ทั้งหมด (**ไม่มี AL ใหม่**) เพิ่มเฉพาะ:
- ตาราง `AccAdvance` (1 ตาราง) + column เพิ่มใน `AccRequest`
- ตาราง `AccBankMaster` (ใหม่ — seed Phase 1, เรียกใช้จริง Phase 2)
- **Migration เพิ่มคอลัมน์ `FormCode` ใน `AccBrandGlAccount`** (per-form G/L config)
- Feature module `src/features/advance/` เทียบกับ `src/features/accounting/`
- Service `advance-request-service.ts` เทียบกับ `request-service.ts`
- Route rules ใน `classify-path.ts` (2 entries ใหม่)
- No. Series prefix `ADV` ผ่าน `allocateRequestNo` เดิม

**Phase 1 Constraint (lock อยู่ใน design นี้):**
- THB เท่านั้น
- โอนให้พนักงานเท่านั้น (ไม่มีคู่ค้า) — ดึงธนาคารจาก HR master
- Issue advance อย่างเดียว (ไม่มี clear/AP-3)
- BU=COCO, Template=PAYMENTS (ไม่แตะ AL)
- `AccBankMaster` seed แต่ยังไม่เรียกใช้ใน UI Phase 1

---

## 1. Data Model

### 1.1 ตาราง AccAdvance (ใหม่)

เทียบกับ `AccTravelExpense` ของ AP-1 — เป็น child table ของ `AccRequest`

```sql
CREATE TABLE [dbo].[AccAdvance] (
    [Id]               INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [RequestId]        INT NOT NULL
        REFERENCES [dbo].[AccRequest]([Id]),
    -- เนื้อหา Advance
    [NeedByDate]       DATE NULL,             -- วันที่ต้องการเริ่มใช้เงิน
    [ExpectedClearDate] DATE NULL,            -- วันที่คาดว่าจะเคลียร์ (≤30 วันจาก NeedByDate)
    [Purpose]          NVARCHAR(MAX) NULL,    -- รายละเอียดค่าใช้จ่าย (free text)
    [Currency]         NVARCHAR(10) NOT NULL DEFAULT N'THB', -- Phase 1: THB เท่านั้น
    [Amount]           DECIMAL(18,2) NULL,   -- จำนวนเงินที่ขอเบิก
    [WhtNote]          NVARCHAR(500) NULL,   -- หมายเหตุ WHT (manual เท่านั้น — ไม่ post journal)
    -- Audit
    [CreatedAt]        DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    [UpdatedAt]        DATETIME2 NOT NULL DEFAULT SYSDATETIME()
);
CREATE INDEX IX_AccAdvance_RequestId ON [dbo].[AccAdvance]([RequestId]);
```

### 1.2 ตาราง AccBankMaster (ใหม่)

**ตรวจสอบแล้ว:** ระบบปัจจุบันมี `AccBrandBankAccount` (เก็บ bank account ของ **บริษัท** ฝั่ง Cr ใน journal) แต่ไม่มีตารางที่เก็บ bank ของ **ผู้รับโอน** เลย — ต้องสร้างใหม่

`AccBrandBankAccount` ≠ `AccBankMaster`:
- `AccBrandBankAccount` = bank account No. ของบริษัท (เลขบัญชีใช้ใน journal line Cr)
- `AccBankMaster` = รายชื่อธนาคารไทยสำหรับ dropdown "ธนาคารของผู้รับโอน" (metadata เท่านั้น)

```sql
CREATE TABLE [dbo].[AccBankMaster] (
    [Id]          INT           IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [BankCode]    NVARCHAR(10)  NOT NULL,   -- รหัสตาม BOT: '002', '004', ...
    [BankName]    NVARCHAR(200) NOT NULL,   -- ชื่อธนาคาร
    [IsActive]    BIT           NOT NULL DEFAULT 1,
    [SortOrder]   INT           NOT NULL DEFAULT 0,
    [CreatedAt]   DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    [UpdatedAt]   DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT [UQ_AccBankMaster_Code] UNIQUE ([BankCode])
);
```

**Phase 1 note:** ตาราง AccBankMaster เป็น master ข้อมูล (ไม่มี FK จาก AccAdvance ใน Phase 1) — Phase 2 จะเพิ่ม column `PayeeBankCode` ใน AccAdvance แล้ว FK มาที่นี่

**Master tables alignment:** `AccBankMaster` ไม่ใช่ 1 ใน 19 shared config tables (ตาม `verify-master-alignment.ts`) — จึงต้อง **seed ด้วย `writeBothPools` แยก** เพื่อให้ทั้ง Prod และ UAT ได้ข้อมูลเหมือนกัน

### 1.3 Column เพิ่มใน AccRequest (migration)

ไม่ต้องเพิ่ม column ใหม่ใน `AccRequest` — ใช้ column ที่มีอยู่แล้ว:

| Column ใน AccRequest | ใช้สำหรับ AP-2 |
|---|---|
| `FormCode` | `'AP-2'` |
| `StaffId` | รหัสพนักงานผู้ขอ |
| `RequesterFullName` | ชื่อ-สกุล (auto-fill จาก HR) |
| `RequesterPosition` | ตำแหน่ง (auto-fill) |
| `RequesterDepartmentName` | แผนก (auto-fill) |
| `ManagerStaffId` / `ManagerEmail` | ผู้จัดการ (auto-fill จาก HR) |
| `TotalAmount` | = AccAdvance.Amount |
| `BrandCode` | แบรนด์ที่เบิก (required สำหรับ ERP journal) |
| `RequestNo` | `ADV26-xxxxx` |
| `Status` | Draft / Submitted / ManagerApproved / Approved / Rejected / Returned / Cancelled |
| `ErpInterfaceStatus` | Pending / Sent / Failed |
| `PaymentDate` | วันจ่าย (บัญชีกำหนดตอน Approve) |

**หมายเหตุ:** Column `RequesterDepartmentCode` ต้องมีอยู่แล้ว (ใช้ใน AP-1) — ใช้ร่วมกันได้

### 1.4 Migration: FormCode ใน AccBrandGlAccount (ใหม่ — สำคัญ)

#### ที่มาของปัญหา

จากโค้ดจริงใน `brand-account-service.ts`:
- `assertClaimBrandAllowed` ผูก `AP1_FORM_CODE` hardcode — ตรวจ brand allowed เฉพาะ AP-1
- `primaryByBrand()` ใน `erp-journal-context.ts` เลือก G/L row ที่ active + sortOrder ต่ำสุด **1 ตัวต่อ brand** โดยไม่มี form filter

ผลคือ AP-2 ถ้าดึง `brandAccounts[brandCode].glAccountNo` จาก `loadErpJournalBuildContext()` โดยตรง จะได้ **บัญชีค่าเดินทาง (AP-1)** ไม่ใช่ **บัญชีเงินทดรองจ่าย (AP-2)** เพราะ row แรกสุดของ AccBrandGlAccount ต่อ brand = AP-1 เสมอ

#### Design Decision: เพิ่มคอลัมน์ FormCode ใน AccBrandGlAccount

เพิ่ม column `FormCode NVARCHAR(20) NULL` ใน `AccBrandGlAccount` เพื่อให้ config G/L **แยกต่อฟอร์ม** รองรับ scale ทั้ง 18 ฟอร์ม

```sql
-- Migration C: adv-003-accbrandglaccount-formcode.sql
-- รันบน: Rocks_Portal_Form (Production) และ Rocks_Portal_Form_UAT
ALTER TABLE [dbo].[AccBrandGlAccount]
ADD [FormCode] NVARCHAR(20) NULL;
GO

-- Backfill: row ที่มีอยู่ทั้งหมด = AP-1 (backward-compatible)
UPDATE [dbo].[AccBrandGlAccount]
SET [FormCode] = 'AP-1'
WHERE [FormCode] IS NULL;
GO

-- Optional index เพื่อ query by FormCode เร็วขึ้น
CREATE INDEX IX_AccBrandGlAccount_FormCode
ON [dbo].[AccBrandGlAccount] ([FormCode], [BrandCode]);
GO

PRINT 'AccBrandGlAccount.FormCode migration complete';
```

**หมายเหตุ Backward-Compatibility:**
- AP-1 โค้ดเดิม (`listBrandAccounts("gl")`) ยังทำงานได้ตามเดิม — เพิ่ม filter `WHERE FormCode = 'AP-1'` ใน query ของ `loadErpJournalBuildContext` เพื่อให้ AP-1 ยังได้ค่าถูกต้อง
- แนะนำให้ `listBrandAccounts(kind, brandCode, formCode?)` รับ optional `formCode` parameter — ถ้า null = query ทั้งหมด (admin view), ถ้าระบุ = filter by FormCode

#### Bank Account + Journal Batch — ไม่จำเป็นต้อง per-form

| ตาราง | Per-Form หรือ Per-Brand? | เหตุผล |
|---|---|---|
| `AccBrandGlAccount` | **Per-Form** (ต้องเพิ่ม FormCode) | G/L ค่าเดินทาง (AP-1) ≠ G/L เงินทดรอง (AP-2) — คนละบัญชีต่างประเภท |
| `AccBrandBankAccount` | **Per-Brand** (reuse ได้) | Bank ของบริษัทไม่เปลี่ยนตามประเภทฟอร์ม — AP-1 และ AP-2 จ่ายออกจาก bank account เดิม |
| `AccBrandJournalBatch` | **Per-Brand** (reuse ได้ เบื้องต้น) | Journal Batch ใน BC ปกติแยกตาม company/template ไม่แยกตามประเภทรายจ่าย — ถ้าบัญชียืนยันว่า AP-2 ใช้ Batch เดิมได้เลย ไม่ต้องแก้ตาราง |

**ข้อยกเว้น Journal Batch:** ถ้าบัญชีต้องการ Batch แยกสำหรับ Advance เปลี่ยน pattern ได้โดยเพิ่ม `FormCode` ใน `AccBrandJournalBatch` เช่นกัน (scope เพิ่มเล็กน้อย) แต่ design นี้ assume = reuse Batch เดิม รอยืนยัน OQ-2

### 1.5 Migration Scripts (รันทั้ง Rocks_Portal_Form + _UAT)

**Migration A — AccAdvance table** (`migrations/adv-001-create-acc-advance.sql`):

```sql
-- Migration: เพิ่มตาราง AccAdvance
-- รันบน: Rocks_Portal_Form (Production) และ Rocks_Portal_Form_UAT
-- วันที่: 2026-08-xx
-- คำสั่ง: npm run apply-sql -- --db Rocks_Portal_Form --file migrations/adv-001-create-acc-advance.sql
--         npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/adv-001-create-acc-advance.sql

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'AccAdvance')
BEGIN
    CREATE TABLE [dbo].[AccAdvance] (
        [Id]                INT IDENTITY(1,1) NOT NULL,
        [RequestId]         INT NOT NULL,
        [NeedByDate]        DATE NULL,
        [ExpectedClearDate] DATE NULL,
        [Purpose]           NVARCHAR(MAX) NULL,
        [Currency]          NVARCHAR(10) NOT NULL DEFAULT N'THB',
        [Amount]            DECIMAL(18,2) NULL,
        [WhtNote]           NVARCHAR(500) NULL,
        [CreatedAt]         DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
        [UpdatedAt]         DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
        CONSTRAINT PK_AccAdvance PRIMARY KEY ([Id]),
        CONSTRAINT FK_AccAdvance_Request FOREIGN KEY ([RequestId])
            REFERENCES [dbo].[AccRequest]([Id])
    );
    CREATE INDEX IX_AccAdvance_RequestId ON [dbo].[AccAdvance]([RequestId]);
    PRINT 'AccAdvance table created';
END
ELSE
    PRINT 'AccAdvance table already exists';
```

**Migration B — AccBankMaster table + seed** (`migrations/adv-002-create-acc-bank-master.sql`):

```sql
-- Migration: สร้างตาราง AccBankMaster + seed ธนาคารไทย ~40 แห่ง (จาก sheet AP2.1)
-- รันบน: Rocks_Portal_Form (Production) และ Rocks_Portal_Form_UAT
-- วันที่: 2026-08-xx
-- คำสั่ง: npm run apply-sql -- --db Rocks_Portal_Form --file migrations/adv-002-create-acc-bank-master.sql
--         npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/adv-002-create-acc-bank-master.sql
--
-- หมายเหตุ: Phase 1 seed เพื่อ migration ถูกต้อง + Phase 2 เสียบใช้ได้ทันที
--           UI Phase 1 ยังไม่เรียกใช้ตารางนี้ (payee = พนักงานเท่านั้น ดึงธนาคารจาก HR master)

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'AccBankMaster')
BEGIN
    CREATE TABLE [dbo].[AccBankMaster] (
        [Id]        INT           IDENTITY(1,1) NOT NULL,
        [BankCode]  NVARCHAR(10)  NOT NULL,
        [BankName]  NVARCHAR(200) NOT NULL,
        [IsActive]  BIT           NOT NULL DEFAULT 1,
        [SortOrder] INT           NOT NULL DEFAULT 0,
        [CreatedAt] DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        [UpdatedAt] DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        CONSTRAINT PK_AccBankMaster PRIMARY KEY ([Id]),
        CONSTRAINT UQ_AccBankMaster_Code UNIQUE ([BankCode])
    );
    PRINT 'AccBankMaster table created';
END
ELSE
    PRINT 'AccBankMaster table already exists';
GO

-- Seed ธนาคาร (idempotent — ตรวจ BankCode ก่อน insert)
IF NOT EXISTS (SELECT 1 FROM [dbo].[AccBankMaster] WHERE BankCode = '002')
  INSERT INTO [dbo].[AccBankMaster] (BankCode, BankName, SortOrder) VALUES
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
    ('022', N'CIMB (Bank Thai)',          13),
    ('024', N'UOB (Thailand)',            14),
    ('025', N'Bank of Ayudhya',          15),
    ('026', N'Mega International',       16),
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
    ('073', N'Land and House',           32);
GO

PRINT 'AccBankMaster seeded (or already existed)';
GO
```

**Verification หลัง migrate:**
```sql
-- ตรวจทั้ง 2 DB
SELECT COUNT(*) AS BankCount FROM [dbo].[AccBankMaster];  -- expect >= 32
SELECT * FROM [dbo].[AccBankMaster] ORDER BY SortOrder;
```

**Migration C — FormCode ใน AccBrandGlAccount** (`migrations/adv-003-accbrandglaccount-formcode.sql`):

```sql
-- Migration: เพิ่มคอลัมน์ FormCode ใน AccBrandGlAccount + backfill 'AP-1'
-- รันบน: Rocks_Portal_Form (Production) และ Rocks_Portal_Form_UAT
-- วันที่: 2026-08-xx
-- คำสั่ง: npm run apply-sql -- --db Rocks_Portal_Form --file migrations/adv-003-accbrandglaccount-formcode.sql
--         npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/adv-003-accbrandglaccount-formcode.sql

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME='AccBrandGlAccount' AND COLUMN_NAME='FormCode'
)
BEGIN
    ALTER TABLE [dbo].[AccBrandGlAccount]
    ADD [FormCode] NVARCHAR(20) NULL;
    PRINT 'AccBrandGlAccount.FormCode column added';
END
ELSE
    PRINT 'AccBrandGlAccount.FormCode already exists';
GO

-- Backfill: row ทั้งหมดที่ไม่มีค่า = ของ AP-1
UPDATE [dbo].[AccBrandGlAccount]
SET [FormCode] = 'AP-1'
WHERE [FormCode] IS NULL;
PRINT 'Backfill AccBrandGlAccount.FormCode = AP-1 done';
GO

-- Index เพื่อ performance query by FormCode + BrandCode
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name='IX_AccBrandGlAccount_FormCode' AND object_id=OBJECT_ID('AccBrandGlAccount')
)
BEGIN
    CREATE INDEX IX_AccBrandGlAccount_FormCode
    ON [dbo].[AccBrandGlAccount] ([FormCode], [BrandCode]);
    PRINT 'Index IX_AccBrandGlAccount_FormCode created';
END
GO

PRINT 'Migration C complete';
```

**Verification หลัง migrate:**
```sql
-- ตรวจ backfill — ต้องไม่มี NULL เหลือ
SELECT COUNT(*) AS NullCount FROM [dbo].[AccBrandGlAccount] WHERE FormCode IS NULL;  -- expect 0
-- ตรวจ AP-1 rows ยังครบ
SELECT FormCode, COUNT(*) AS Cnt FROM [dbo].[AccBrandGlAccount] GROUP BY FormCode;
```

---

## 2. Form UI

### 2.1 File Structure

```
src/features/advance/
  constants.ts            -- AP2_FORM_CODE = 'AP-2', AP2_SEQUENCE_PREFIX = 'ADV'
  types.ts                -- AdvanceDetail, AdvanceDraftSummary (เทียบกับ types.ts ของ accounting)
  components/
    AdvanceForm.tsx        -- Form หลัก (client component)
    AdvanceDraftPicker.tsx -- เลือก draft ที่บันทึกไว้
    AdvanceStatusBadge.tsx -- Badge แสดงสถานะ (reuse STATUS_LABEL_TH จาก accounting/constants)
src/lib/adv/
  advance-request-service.ts  -- saveDraft, submitRequest, getRequest, listMyDrafts
  advance-approval-engine.ts  -- approveManager, approveAccount, reject, returnForEdit
  advance-erp-payload.ts      -- buildAdvanceJournalPayload (เรียกใช้ erp-ppap-payload เดิม)
  advance-erp-context.ts      -- loadAdvanceErpContext() — wrapper loadErpJournalBuildContext + filter FormCode='AP-2'
  bank-master-service.ts      -- listBanks() — เตรียมไว้ Phase 2 (ไม่เรียกใน Phase 1 UI)
src/app/request/advance/
  page.tsx                -- /request/advance (form หน้าหลัก)
  [id]/
    page.tsx              -- /request/advance/[id] (ดู/แก้ไข draft + status)
src/app/api/request/advance/
  route.ts                -- POST /api/request/advance (saveDraft)
  [id]/
    route.ts              -- GET/PATCH /api/request/advance/[id]
    submit/route.ts       -- POST .../submit
    cancel/route.ts       -- POST .../cancel
  work/route.ts           -- GET /api/request/advance/work (approver inbox)
  approve/manager/route.ts
  approve/account/route.ts
  reject/route.ts
  return/route.ts
  erp-prep/route.ts       -- GET/POST ERP send queue (เทียบกับ /api/request/accounting/erp-prep)
```

### 2.2 Fields Phase 1

| Field | Type | Required | Source | หมายเหตุ |
|---|---|---|---|---|
| รหัสพนักงาน | text input | Yes | user input | ค้นหาจาก HR master |
| ชื่อ-สกุล | text (readonly) | auto | HR master | auto-fill เมื่อกรอกรหัส |
| ตำแหน่ง | text (readonly) | auto | HR master | auto-fill |
| แผนก | text (readonly) | auto | HR master | auto-fill |
| แบรนด์ | dropdown | Yes | AccBrandOption | ใช้ `getAllowedBrands(AP2_FORM_CODE)` |
| โอนให้ | text (readonly) | - | Phase 1: "พนักงาน" เท่านั้น | hardcode label |
| วันที่ต้องการเริ่มใช้เงิน | date | Yes | user input | ต้อง >= วันนี้ |
| วันที่คาดว่าจะเคลียร์ | date | Yes | user input | <= NeedByDate + 30 วัน |
| รายละเอียดค่าใช้จ่าย | textarea | Yes | user input | free text |
| จำนวนเงิน | number | Yes | user input | THB, > 0 |
| หมายเหตุ WHT | textarea | No | user input | manual note เท่านั้น |
| แนบไฟล์ | file upload | No | user upload | ใบเสนอราคา — ใช้ AccRequestFile (RefType='advance') |

**Phase 1: ไม่มี field "ธนาคารของผู้รับโอน"** (payee = พนักงานเท่านั้น ดึงจาก HR master) — Phase 2 จะเพิ่ม dropdown ที่เรียก `listBanks()` จาก `AccBankMaster`

### 2.3 Validation Rules

```typescript
// advance-request-service.ts :: validateForSubmit
function validateAdvanceForSubmit(input: AdvanceSaveInput, requester: RequesterSnapshot): string[] {
  const errs: string[] = [];
  if (!requester.managerStaffId)     errs.push("ยังไม่ได้กำหนดผู้จัดการใน HR");
  if (!input.brandCode)              errs.push("กรุณาเลือกแบรนด์");
  if (!input.advance.needByDate)     errs.push("กรุณาระบุวันที่ต้องการเริ่มใช้เงิน");
  if (!input.advance.expectedClearDate) errs.push("กรุณาระบุวันที่คาดว่าจะเคลียร์");
  if (input.advance.needByDate && input.advance.expectedClearDate) {
    const need = new Date(input.advance.needByDate);
    const clear = new Date(input.advance.expectedClearDate);
    const diffDays = (clear.getTime() - need.getTime()) / 86400000;
    if (diffDays > 30) errs.push("วันเคลียร์ต้องไม่เกิน 30 วันจากวันที่ต้องการใช้เงิน");
    if (clear < need)  errs.push("วันเคลียร์ต้องไม่ก่อนวันที่ต้องการใช้เงิน");
    const today = new Date(); today.setHours(0,0,0,0);
    if (need < today)  errs.push("วันที่ต้องการเริ่มใช้เงินต้องไม่เป็นอดีต");
  }
  if (!input.advance.purpose?.trim()) errs.push("กรุณากรอกรายละเอียดค่าใช้จ่าย");
  if (!input.advance.amount || input.advance.amount <= 0) errs.push("กรุณาระบุจำนวนเงินที่ถูกต้อง");
  if (input.advance.amount && input.advance.amount > 3000) {
    // Business rule: ยอด >3,000 ให้ไป PR/PO — แจ้งเตือนเท่านั้น ไม่ block
    // (ฝ่ายบัญชียืนยันว่า block หรือ warn เท่านั้น — รอ Open Question #3)
    errs.push("ยอดเกิน 3,000 บาท ควรผ่าน PR/PO — กรุณาติดต่อฝ่ายจัดซื้อ");
  }
  return errs;
}
```

> **Open Question #3:** ยอด >3,000 บาท — block ไม่ให้ submit หรือแค่ warning?
> Design นี้ assume = **block** (ตาม spec) รอยืนยันจากบัญชี

### 2.4 Resume Draft

เหมือน AP-1 ทุกประการ:
- `listMyAdvanceDrafts(userId)` — query `AccRequest WHERE FormCode='AP-2' AND Status IN ('Draft','Returned')`
- `AdvanceDraftPicker` component แสดง draft list เมื่อเปิดหน้า `/request/advance`
- User กด "แก้ไข" → load draft ด้วย `id` → pre-fill form

---

## 3. Approval Workflow

### 3.1 Flow (เหมือน AP-1 ทุก step)

```
[Draft] → submit → [Submitted / MANAGER]
    → Manager อนุมัติ → [ManagerApproved / ACCOUNT]
    → Account อนุมัติ (+ กำหนด PaymentDate) → [Approved]

ทางเลือก:
    Manager Reject  → [Rejected]
    Manager Return  → [Returned] → ผู้ขอแก้ไข → submit ใหม่
    Account Reject  → [Rejected]
```

### 3.2 Approval Steps

| Step | StepCode | ผู้อนุมัติ | Logic |
|---|---|---|---|
| Step 1 | MANAGER | Manager ของผู้ขอ (ManagerStaffId จาก HR) | เหมือน AP-1 — auto-assign จาก HR master |
| Step 2 | ACCOUNT | Accounting approver (ใช้ `AccApprover` table เดิม) | เหมือน AP-1 — any active approver |

**หมายเหตุ:** ใช้ `approval-engine.ts` เดิมทั้งหมด แต่ wrap ใน `advance-approval-engine.ts` เพื่อแยก query pool ไม่ให้ cross-contaminate กับ AP-1

> **Open Question #4:** AP-2 ใช้ `AccApprover` table เดียวกับ AP-1 หรือมี accounting approver แยก?
> Design นี้ assume = **ใช้ร่วมกัน** (ACCOUNT approver list เดิม) รอยืนยัน

### 3.3 Account Approval — Additional Check

ตอน Account อนุมัติ AP-2 ต้องกำหนด `PaymentDate` (วันที่โอนเงิน) เหมือน AP-1
- ใช้ `getPaymentDates()` (ศุกร์ที่ 2 หรือ 4 ของเดือน) — reuse เดิม

> **Open Question #5:** รอบจ่าย AP-2 ใช้รอบเดียวกับ AP-1 (ศุกร์ที่ 2/4) หรือรอบพิเศษ?
> Design assume = **ใช้รอบเดิม** รอยืนยัน

---

## 4. ERP Journal Mapping

### 4.1 Journal Entry (Dr/Cr)

```
Dr  เงินทดรองจ่าย  (G/L Account — config-driven, FormCode='AP-2')   Amount
    Cr  Bank Account  (Bank Account — config-driven, per-brand เดิม)  Amount
```

**documentType:** `"Payment"` (เหมือน AP-1)
**accountType line 1:** `"G/L Account"` → accountNo = **เลข G/L เงินทดรองจ่าย จาก AccBrandGlAccount WHERE FormCode='AP-2'**
**accountType line 2:** `"Bank Account"` → accountNo = **เลข Bank จาก AccBrandBankAccount (reuse per-brand เดิม)**

**หมายเหตุสำคัญ:** Bank ในบรรทัด Cr คือ `AccBrandBankAccount` (bank ของ **บริษัท**) ไม่ใช่ `AccBankMaster` — ทั้งสองตารางแยกกันคนละวัตถุประสงค์

### 4.2 ERP Account Resolution (Config-Driven Pattern)

**ก่อนหน้า (design เดิม):** G/L และ Bank hardcode รอเลขจาก OQ-1/OQ-2 ก่อนจึง build ได้

**ปัจจุบัน (design ใหม่):** ทั้ง G/L, Bank, และ Journal Batch มาจาก config ผ่าน pattern เดียวกับ AP-1

```
บัญชีกรอกใน Settings UI
        ↓
AccBrandGlAccount (FormCode='AP-2', BrandCode=X)   → glAccountNo
AccBrandBankAccount (BrandCode=X)                   → bankAccountNo (reuse AP-1)
AccBrandJournalBatch (BrandCode=X)                  → journalBatchName (reuse AP-1 เบื้องต้น)
        ↓
loadAdvanceErpContext()  →  brandAccounts[brandCode] = { glAccountNo, bankAccountNo, journalBatchName, ... }
        ↓
buildAdvanceJournalPayload(req, advance, ctx.brandAccounts[brandCode])
```

**`loadAdvanceErpContext()`** (ไฟล์ใหม่ `src/lib/adv/advance-erp-context.ts`):
- เรียก `listBrandAccounts("gl", brandCode, "AP-2")` — ดึงเฉพาะ G/L ของ AP-2
- เรียก `listBrandAccounts("bank", brandCode)` — reuse Bank per-brand เดิม
- เรียก `listBrandJournalBatches(brandCode)` — reuse Batch per-brand เดิม
- ประกอบเป็น `BrandErpAccountConfig` แบบเดียวกับที่ `loadErpJournalBuildContext` ทำ

**ผลกระทบต่อ `listBrandAccounts` ใน `brand-account-service.ts`:**
- เพิ่ม optional parameter `formCode?: string | null` ในฟังก์ชัน
- ถ้า `formCode` ระบุ → เพิ่ม `AND FormCode = @formCode` ใน WHERE
- AP-1 เดิมที่เรียก `listBrandAccounts("gl")` ไม่ส่ง formCode → ต้องเพิ่ม default filter `WHERE FormCode = 'AP-1'` เพื่อ backward-compat (หรือ migrate call ใน erp-journal-context.ts ให้ส่ง `'AP-1'` explicit)

**ผลกระทบต่อ `upsertBrandAccount` ใน `brand-account-service.ts`:**
- เพิ่ม `formCode?: string` ใน input object
- ถ้า kind = `"gl"` → บันทึก FormCode column ด้วย
- `assertClaimBrandAllowed` ยังผูก AP1_FORM_CODE อยู่ — ต้องแยกเป็น `assertBrandAllowed(brandCode, formCode)` หรือ relax เป็น check brand exists ใน AccBrandOption โดยไม่จำกัด form

### 4.3 Settings UI — กรอกค่า G/L ของ AP-2

บัญชีกรอกเลข G/L เงินทดรองจ่ายต่อ brand ใน Settings UI (**ไม่ต้องรอ hardcode — build ได้เลย**):
- หน้า Brand Config เดิม (Settings) **extend** ให้มี tab หรือ dropdown เลือก Form ก่อน แล้วแสดง G/L ของ form นั้น
- หรือเพิ่มหน้าใหม่ `/settings/brand-accounts/ap2` สำหรับ AP-2 โดยเฉพาะ (simpler)
- บัญชีกรอกเลข G/L ต่อ brand ก่อน UAT ยิงเข้า BC จริง — ไม่ block build

**OQ-1 และ OQ-2 ลดระดับเป็น "ค่าที่บัญชีกรอกใน Settings" ไม่ใช่ hard blocker อีกต่อไป**

### 4.4 PPAP Payload Mapping

| PPAP Field | AP-2 Source | หมายเหตุ |
|---|---|---|
| `groupNo` | `G1` (1 advance = 1 group เสมอ Phase 1) | ใช้ `buildPpapGroupNoByPairKey` เดิม |
| `postingDate` | `AccRequest.PaymentDate` | วันที่บัญชีกำหนด |
| `documentType` | `"Payment"` | fixed |
| `accountType` (Dr) | `"G/L Account"` | |
| `accountNo` (Dr) | `ctx.brandAccounts[brandCode].glAccountNo` | จาก config FormCode='AP-2' |
| `accountType` (Cr) | `"Bank Account"` | |
| `accountNo` (Cr) | `ctx.brandAccounts[brandCode].bankAccountNo` | จาก config per-brand เดิม |
| `description` | `"เงินทดรองจ่าย {RequestNo} {RequesterFullName}"` | format ยืนยัน OQ-6 |
| `paymentMethodCode` | `"BANK"` | fixed |
| `amount` (Dr) | `AccRequest.TotalAmount` (positive) | |
| `amount` (Cr) | `-AccRequest.TotalAmount` (negative) | |
| `employeeCode` | `AccRequest.StaffId` (→ externalDocument) | staff ID เป็น External Doc No. |
| `branchCode` | `ctx.brandAccounts[brandCode].branchCode` | ผ่าน brand config เดิม |
| `departmentCode` | จาก HR dept mapping | เหมือน AP-1 |
| `journalBatchName` | `ctx.brandAccounts[brandCode].journalBatchName` | จาก config per-brand เดิม |

### 4.5 Payload Builder (advance-erp-payload.ts)

AP-2 ง่ายกว่า AP-1 มาก — 1 request = 1 person = 1 payment date = **2 lines** เท่านั้น (Dr + Cr) ไม่มี multi-day aggregation

```typescript
// src/lib/adv/advance-erp-payload.ts
import type { BrandErpAccountConfig } from "@/lib/acc/erp-journal-builder";

export function buildAdvanceJournalPayload(
  req: AccRequest,
  advance: AdvanceDetail,
  brandConfig: BrandErpAccountConfig,
  departmentCode: string,
): PpapJournalPayload {
  const { glAccountNo, bankAccountNo, journalBatchName, branchCode } = brandConfig;
  if (!glAccountNo)       throw new Error("ยังไม่ได้ตั้งค่า G/L Account ของ AP-2 สำหรับแบรนด์นี้");
  if (!bankAccountNo)     throw new Error("ยังไม่ได้ตั้งค่า Bank Account สำหรับแบรนด์นี้");
  if (!journalBatchName)  throw new Error("ยังไม่ได้ตั้งค่า Journal Batch สำหรับแบรนด์นี้");

  const amount = advance.amount ?? 0;
  const postingDate = req.paymentDate!;
  const description = `เงินทดรองจ่าย ${req.requestNo} ${req.requesterFullName ?? ""}`.trim();
  const employeeCode = req.staffId != null ? String(req.staffId) : "";

  return {
    journalBatchName,
    lines: [
      {
        groupNo: "G1",
        postingDate,
        documentType: "Payment",
        accountType: "G/L Account",
        accountNo: glAccountNo,
        description,
        paymentMethodCode: "BANK",
        amount,
        balAccountType: "G/L Account",
        employeeCode,
        branchCode: branchCode ?? "",
        departmentCode,
      },
      {
        groupNo: "G1",
        postingDate,
        documentType: "Payment",
        accountType: "Bank Account",
        accountNo: bankAccountNo,
        description,
        paymentMethodCode: "BANK",
        amount: -amount,
        employeeCode,
        branchCode: branchCode ?? "",
        departmentCode,
      },
    ],
  };
}
```

**ข้อสังเกต:** Parameter `brandConfig: BrandErpAccountConfig` รับ object เดียวกับที่ AP-1 ใช้ใน `erp-journal-builder.ts` — type นี้ reuse ได้ทันที ไม่ต้องสร้างใหม่

### 4.6 ERP Send Flow

AP-2 reuse `postBcPpapJournalCreateFromJson` เดิม เหมือน AP-1 ทุกอย่าง:
1. บัญชี approve → Status = `Approved`, PaymentDate เซ็ต
2. บัญชีเปิดหน้า ERP Prep Queue (ใหม่ สำหรับ AP-2 แยกจาก AP-1)
3. กด "ส่ง ERP" → `advance-erp-send.ts` → `loadAdvanceErpContext()` → `buildAdvanceJournalPayload(req, advance, ctx.brandAccounts[brandCode], deptCode)` → `postBcPpapJournalCreateFromJson`
4. BC insert Gen. Journal Line (staging) → บัญชี post ใน BC UI

---

## 5. Route Rules (classify-path.ts)

### 5.1 เพิ่ม FormCode

```typescript
// src/lib/form-environment/classify-path.ts
export type FormCode = "AP-1" | "AP-15" | "AP-17" | "AP-2"; // เพิ่ม AP-2
```

### 5.2 เพิ่ม Rules (ใส่ก่อน AP-1 catch-all)

```typescript
// เพิ่มก่อน AP-1 block
{ prefix: "/api/request/advance", result: "AP-2" },
{ prefix: "/request/advance",     result: "AP-2" },
```

### 5.3 Pool Routing

AP-2 ใช้ database แยก (เหมือน AP-1 vs AP-17):
- Production: `Rocks_Portal_Form` (เดิม หรือ database ใหม่?)
- UAT: `Rocks_Portal_Form_UAT` (เดิม)

> **Open Question #7:** AP-2 ใช้ database เดียวกับ AP-1 (`Rocks_Portal_Form`) หรือแยก DB?
> Design assume = **ใช้ DB เดิม** (AccRequest รองรับ FormCode แยกอยู่แล้ว) รอยืนยัน
> ถ้า = ใช้ร่วม: `classify-path` return `"AP-2"` แล้ว pool routing map ไปที่ production pool เดิม
> ถ้า = แยก DB: ต้องเพิ่ม pool ใหม่ใน `mssql.ts` (scope เพิ่มขึ้นมาก)

---

## 6. Running Number / No. Series

### 6.1 Web-Side (AccSequence)

ใช้ `allocateRequestNo` เดิมใน `src/lib/acc/sequence.ts` ไม่ต้องเปลี่ยนโค้ด:

```typescript
// advance-request-service.ts :: submitRequest
const requestNo = await allocateRequestNo("ADV"); // → ADV26-00001, ADV26-00002, ...
// ผลลัพธ์: "ADV26-00001"
```

**หมายเหตุ:** Spec ระบุ format `RPC-ADVyy-xxxx` (4 หลัก) แต่ `allocateRequestNo` ปัจจุบัน pad 5 หลัก (`yy-xxxxx`)

> **Open Question #8:** Format running no. ที่ต้องการจริงคืออะไร?
> - Option A: `ADV26-00001` (5 หลัก — ใช้ function เดิมได้เลย, prefix = "ADV")
> - Option B: `RPC-ADV26-0001` (4 หลัก — ต้องแก้ allocateRequestNo หรือ override)
>
> Design recommend = **Option A** (สม่ำเสมอกับ TOF ของ AP-1) รอยืนยัน

### 6.2 BC-Side (Document No.)

Document No. ใน Gen. Journal Line ใน BC มาจาก `journalBatchName` + batch ของ BC เอง (CU 50263 จัดการ) — ไม่มี No. Series ใหม่ใน BC ที่ต้องตั้งสำหรับ AP-2

---

## 7. Open Questions

OQ-1 และ OQ-2 ลดระดับจาก **"hard blocker ก่อน build"** เป็น **"ค่าที่บัญชีกรอกใน Settings UI ก่อน UAT ยิงจริง"** — build task ทั้งหมดไม่ถูก block แล้ว

### ต้องได้จากฝ่ายบัญชี (ก่อน UAT เท่านั้น ไม่ใช่ก่อน build)

| # | คำถาม | ผลกระทบ | ค่า Default ที่ใช้ใน design นี้ |
|---|---|---|---|
| **OQ-1** | เลข G/L Account เงินทดรองจ่าย (Dr) ต่อ brand คืออะไร? | **บัญชีกรอกใน Settings UI ก่อน UAT** — ไม่ block build | รอบัญชีกรอก |
| **OQ-2** | Bank Account No. (Cr) ใช้อันเดิมต่อ brand ได้เลยหรือไม่? Journal Batch ใช้ Batch เดิมได้เลย? | บัญชียืนยันใน Settings — ถ้า Bank/Batch ต้องแยก → เพิ่ม FormCode ในตารางนั้นด้วย | Reuse per-brand เดิม |
| **OQ-3** | ยอด >3,000 บาท — block ไม่ให้ submit หรือแค่ warning + ให้ submit ได้? | กระทบ validation logic | Block (ตาม spec) |
| **OQ-4** | Accounting Approver (Step 2) ใช้ `AccApprover` list เดิมของ AP-1 หรือแยก? | กระทบ approval engine | ใช้ร่วมกัน |
| **OQ-5** | รอบจ่าย (PaymentDate) ใช้รอบเดียวกับ AP-1 (ศุกร์ที่ 2/4) หรือรอบพิเศษ? | กระทบ `getPaymentDates()` | ใช้รอบเดิม |
| **OQ-9** | Bank codes ใน AP2.1 (เช่น 002, 004) ต้อง map กับ BC Bank Account No. ใน AccBrandBankAccount หรือเป็น reference เฉยๆ สำหรับโอนเงินให้คู่ค้าใน Phase 2? | กระทบ schema Phase 2 (ถ้า map ต้องเพิ่ม FK จาก AccBankMaster ไปที่ AccBrandBankAccount) | Reference เฉยๆ (Phase 2 พิจารณา) |

### ต้องได้จาก IT/Atlas

| # | คำถาม | ผลกระทบ |
|---|---|---|
| **OQ-6** | Description format ใน Gen. Journal — ใช้ `"เงินทดรองจ่าย {RequestNo} {Name}"` ได้เลย? | Journal description |
| **OQ-7** | AP-2 ใช้ DB เดิม (`Rocks_Portal_Form`) หรือต้องการ DB ใหม่? | ขนาด scope migration ต่างกันมาก |
| **OQ-8** | Running no. format: `ADV26-00001` (5 หลัก) หรือ `RPC-ADV26-0001` (4 หลัก, มี prefix "RPC-")? | กระทบ allocateRequestNo |

---

## 8. Task Breakdown (Implementation-Ready Handoff)

**Phase 0 Gate เดิม (รอ OQ-1/OQ-2 ก่อน build Task 6) ถูกยกเลิกแล้ว** — build ทุก Task ได้ทันที บัญชีกรอกค่า G/L/Bank/Batch ใน Settings ก่อน UAT

---

### Task 1: Migration A — AccAdvance (ไม่ขึ้นกับ OQ ใด)

**Scope:** สร้าง SQL migration script สำหรับ AccAdvance + รันบน UAT ก่อน prod
**Files:** `migrations/adv-001-create-acc-advance.sql`
**คำสั่ง:**
```
npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/adv-001-create-acc-advance.sql
npm run apply-sql -- --db Rocks_Portal_Form --file migrations/adv-001-create-acc-advance.sql
```
**Verification:** `SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='AccAdvance'` ทั้ง 2 DB

---

### Task 1.5: Migration B — AccBankMaster + Seed (ไม่ขึ้นกับ OQ ใด)

**Scope:** สร้างตาราง `AccBankMaster` และ seed ธนาคาร ~32 แห่งจาก sheet AP2.1
**Files:** `migrations/adv-002-create-acc-bank-master.sql`
**คำสั่ง:**
```
npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/adv-002-create-acc-bank-master.sql
npm run apply-sql -- --db Rocks_Portal_Form --file migrations/adv-002-create-acc-bank-master.sql
```
**Verification:**
```sql
SELECT COUNT(*) FROM [dbo].[AccBankMaster];         -- expect >= 32
SELECT BankCode, BankName FROM [dbo].[AccBankMaster] ORDER BY SortOrder;
```
**หมายเหตุ:**
- Phase 1: seed แต่ **ไม่เรียกใช้ใน UI** (payee = พนักงาน ดึง bank จาก HR master)
- Phase 2: เพิ่ม `PayeeBankCode` column ใน AccAdvance + dropdown ใน AdvanceForm ที่เรียก `listBanks()`
- `AccBankMaster` ไม่ใช่ 1 ใน 19 dual-write tables — migration รัน manual บน Prod และ UAT แยก (ตาม pattern นี้อยู่แล้ว)
- สร้าง service `src/lib/adv/bank-master-service.ts` เปล่าไว้รอ Phase 2 (เพื่อให้ import path นิ่ง)

---

### Task 1.6: Migration C — FormCode ใน AccBrandGlAccount (dependency: รัน **ก่อน** Task 6 และ Task SettingsUI)

**Scope:** เพิ่มคอลัมน์ `FormCode` ใน `AccBrandGlAccount` + backfill `'AP-1'` + index
**Files:** `migrations/adv-003-accbrandglaccount-formcode.sql`
**คำสั่ง:**
```
npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/adv-003-accbrandglaccount-formcode.sql
npm run apply-sql -- --db Rocks_Portal_Form --file migrations/adv-003-accbrandglaccount-formcode.sql
```
**Verification:**
```sql
SELECT COUNT(*) AS NullCount FROM [dbo].[AccBrandGlAccount] WHERE FormCode IS NULL;  -- expect 0
SELECT FormCode, COUNT(*) AS Cnt FROM [dbo].[AccBrandGlAccount] GROUP BY FormCode;   -- AP-1: N rows
```
**AP-1 backward-compat:** หลัง migration ต้องแก้ `brand-account-service.ts` ให้ filter `FormCode = 'AP-1'` explicit เมื่อ AP-1 เรียก `listBrandAccounts("gl")` — รายละเอียดใน Task 1.7

---

### Task 1.7: Code — ปรับ brand-account-service.ts รองรับ FormCode filter (dependency: Task 1.6)

**Scope:** ปรับ `listBrandAccounts` และ `upsertBrandAccount` รองรับ `formCode` parameter
**Files:** `src/lib/acc/brand-account-service.ts`
**การเปลี่ยนแปลง:**
- `listBrandAccounts(kind, brandCode?, formCode?)` — เพิ่ม optional `formCode` parameter
  - ถ้า `kind === "gl"` และ `formCode` ระบุ → เพิ่ม `AND FormCode = @formCode`
  - เรียก `listBrandAccounts("gl", null, "AP-1")` จาก `erp-journal-context.ts` เพื่อ backward-compat
- `upsertBrandAccount(kind, input { ..., formCode? }, userId)` — เมื่อ kind = "gl" บันทึก FormCode
- `assertClaimBrandAllowed` ปรับให้รับ formCode หรือ relax เป็น check brand active โดยไม่จำกัด AP-1

**ผลกระทบต่อ AP-1:** ต้องแก้ caller ใน `erp-journal-context.ts` บรรทัด `listBrandAccounts("gl")` → ส่ง `"AP-1"` explicit

---

### Task 2: Types & Constants

**Scope:** สร้าง feature module skeleton
**Files:**
- `src/features/advance/constants.ts` — `AP2_FORM_CODE`, `AP2_SEQUENCE_PREFIX`
- `src/features/advance/types.ts` — `AdvanceDetail`, `AdvanceSaveInput`, `AdvanceDraftSummary`

**Depends on:** OQ-8 (sequence prefix) — ถ้ารอไม่ได้ ใช้ Option A `"ADV"` ไปก่อน

---

### Task 3: classify-path.ts + tests

**Scope:** เพิ่ม FormCode AP-2 และ route rules
**Files:**
- `src/lib/form-environment/classify-path.ts` — เพิ่ม 2 rules
- `src/lib/form-environment/classify-path.test.ts` — เพิ่ม test cases ครอบ `/api/request/advance/*` และ `/request/advance/*`

**Verification:** `npm test classify-path` ผ่านทั้งหมด
**Depends on:** OQ-7 (ถ้าแยก DB ต้องเพิ่ม pool mapping ด้วย)

---

### Task 4: advance-request-service.ts

**Scope:** CRUD service สำหรับ AP-2
**Files:** `src/lib/adv/advance-request-service.ts`
**Functions:**
- `saveDraft(input, userId, loginEmail)` → insert/update AccRequest + AccAdvance
- `submitRequest(id, requester, userId)` → validate + allocateRequestNo('ADV') + create MANAGER approval
- `getRequest(id)` → load AccRequest + AccAdvance + approvals
- `listMyAdvanceDrafts(userId)` → drafts กรอง FormCode='AP-2'
- `deleteDraft(id, userId)`
- `validateAdvanceForSubmit(input, requester)` → validation rules section 2.3

**Pattern:** เหมือน `src/lib/acc/request-service.ts` แต่ child table = AccAdvance แทน AccTravelExpense
**Depends on:** Task 1, Task 2, OQ-3 (validation block vs warn), OQ-8

---

### Task 5: advance-approval-engine.ts

**Scope:** Approval actions สำหรับ AP-2
**Files:** `src/lib/adv/advance-approval-engine.ts`
**Functions:** `approveManager`, `approveAccount`, `reject`, `returnForEdit`, `cancelByRequester`
**Pattern:** Wrapper บน logic เดิมของ `approval-engine.ts` แต่ใช้ pool ของ AP-2

> ถ้า OQ-7 = ใช้ DB เดิม → wrapper แทบไม่ต่าง
> ถ้า OQ-7 = DB ใหม่ → ต้องสร้าง pool function ใหม่

**Depends on:** Task 4, OQ-4, OQ-5

---

### Task 6: advance-erp-context.ts + advance-erp-payload.ts + advance-erp-send.ts

**Scope:** ERP context loader + journal payload builder + send function
**Files:**
- `src/lib/adv/advance-erp-context.ts` — `loadAdvanceErpContext()` (filter FormCode='AP-2')
- `src/lib/adv/advance-erp-payload.ts` — `buildAdvanceJournalPayload` (section 4.5)
- `src/lib/adv/advance-erp-send.ts` — `sendAdvanceErpBatch` (เหมือน erp-interface-send.ts)

**ไม่ถูก block โดย OQ-1/OQ-2 แล้ว** — builder เชื่อมกับ config; ค่า G/L/Bank บัญชีกรอกใน Settings ก่อน UAT
**Depends on:** Task 1.6, Task 1.7, Task 2, Task 4

---

### Task 6.5: Settings UI — กรอก G/L Account ของ AP-2

**Scope:** UI ให้บัญชีตั้งค่า G/L เงินทดรองจ่ายต่อ brand
**Options (เลือก 1):**
- A (simpler): หน้า `/settings/brand-accounts/ap2` ใหม่ — เรียก `upsertBrandAccount("gl", { formCode: "AP-2", ... })`
- B (scalable): extend หน้า Brand Config เดิมให้มี FormCode selector dropdown

**Recommend: Option A** สำหรับ Phase 1 (เร็วกว่า ไม่แตะหน้าเดิม)
**Depends on:** Task 1.6, Task 1.7

---

### Task 7: API Routes

**Scope:** Next.js route handlers
**Files:** ทั้งหมดใน `src/app/api/request/advance/`
**Pattern:** เหมือน `src/app/api/request/accounting/` แต่เรียก advance services

**Verification:** curl tests ทุก endpoint

---

### Task 8: UI Components

**Scope:** Form UI Phase 1
**Files:**
- `src/features/advance/components/AdvanceForm.tsx`
- `src/features/advance/components/AdvanceDraftPicker.tsx`
- `src/app/request/advance/page.tsx`
- `src/app/request/advance/[id]/page.tsx`

**Fields:** ตาม section 2.2 (ไม่มี bank dropdown Phase 1)
**Depends on:** Task 4, OQ-6 (description)

---

### Task 9: Email Templates (advance)

**Scope:** เพิ่ม email template สำหรับ AP-2
**Files:** `src/lib/adv/advance-email-templates.ts`
**Pattern:** เหมือน `email-templates.ts` แต่ใช้ข้อความ "เบิกเงินทดรองจ่าย" แทน "เบิกค่าเดินทาง"
**URL:** `/request/advance/${req.id}`

---

### Task 10: ERP Prep Queue UI (AP-2)

**Scope:** หน้า Accounting Queue สำหรับ AP-2 (แยกจาก AP-1)
**Files:**
- `src/app/request/advance/erp-prep/page.tsx`
- Component แสดง approved advances + "ส่ง ERP" button

**ไม่ถูก block โดย OQ-1/OQ-2 แล้ว** — ปุ่ม "ส่ง ERP" จะ error แบบ friendly ถ้าบัญชียังไม่กรอก G/L ใน Settings
**Depends on:** Task 6, Task 7

---

### Task 11: Sandbox Flag + classify-path coverage check

**Scope:** ตรวจว่า `/settings/form-environment` coverage check ครอบ AP-2 routes ใหม่
**Verification:** เปิด `/settings/form-environment` → ไม่มี "unclassified" routes ที่ขึ้นต้นด้วย `/api/request/advance`

---

### Dependency Graph (ลำดับ build)

```
Task 1  → Task 4 → Task 5
Task 1.5            (parallel)
Task 1.6 → Task 1.7 → Task 6 → Task 10
Task 1.6 → Task 1.7 → Task 6.5
Task 2  → Task 4 → Task 6
Task 3  → Task 7
Task 7  → Task 10
Task 4  → Task 7 → Task 8
Task 9              (parallel เมื่อ Task 4 เสร็จ)
Task 11             (ทำสุดท้ายก่อน deploy)
```

---

### Checkpoint: UAT Testing

ก่อน production deploy:
1. รัน Migration A, B, C บน UAT DB
2. ตรวจ `AccBankMaster` มี >= 32 rows, `AccBrandGlAccount.FormCode` ไม่มี NULL
3. บัญชีกรอก G/L ของ AP-2 ต่อ brand ใน Settings UI (ตอบ OQ-1)
4. บัญชียืนยัน Bank Account + Journal Batch ที่ใช้ (ตอบ OQ-2)
5. สร้าง draft advance, submit, manager approve, account approve
6. ตรวจ `AccRequest` + `AccAdvance` rows ถูกต้อง
7. กด "ส่ง ERP" (Sandbox) → ตรวจ BC Gen. Journal Line ใน BC Sandbox
8. ตรวจ email notifications ทุก step

---

## 9. Customization Needed

- **AL Customization:** ไม่ต้อง (No) — reuse CU 50263 เดิม Phase 1 ใช้ COCO/PAYMENTS
- **DB Schema:** Migration A (AccAdvance) + Migration B (AccBankMaster + seed) + **Migration C (FormCode ใน AccBrandGlAccount)**
- **Code Change (non-breaking):** ปรับ `brand-account-service.ts` รองรับ `formCode` param; ปรับ caller ใน `erp-journal-context.ts` ส่ง `"AP-1"` explicit
- **New BC Setup:** G/L Account ของ AP-2 ต่อ brand (บัญชีกรอกใน Settings UI — ไม่ hardcode)

---

## 10. Risk & Dependency

| Risk | Level | Mitigation |
|---|---|---|
| AP-1 เดิมดึง G/L ผิด หลัง Migration C (ถ้าไม่ filter FormCode) | HIGH | Task 1.7 บังคับก่อน deploy — เพิ่ม `formCode='AP-1'` explicit ใน caller ของ erp-journal-context.ts; มี test case ยืนยัน |
| บัญชีไม่กรอก G/L ใน Settings ก่อน UAT ยิงจริง | MEDIUM | payload builder throw friendly error เมื่อ glAccountNo null; ERP Prep Queue UI แสดง warning ถ้า config ยังไม่ครบ |
| AP-2 route fall-through ไป Production เงียบๆ | HIGH | Task 3 + test cases บังคับก่อน deploy |
| DB pool ผิด (AP-2 อ่าน AP-1 DB) | HIGH | OQ-7 ต้องยืนยันก่อน Task 3 |
| AccBankMaster seed ไม่ครบ (AP2.1 อาจมีมากกว่า 32 แห่ง) | LOW | ให้ builder ตรวจ sheet AP2.1 อีกครั้งก่อนรัน migration — migration script ใช้ idempotent insert ปลอดภัย |
| allocateRequestNo prefix ชนกับ prefix อื่น | LOW | "ADV" ยังไม่มีใน AccSequence — ตรวจก่อนรัน |
| CU 50263 hardcode BU=COCO ไม่ตรง advance G/L | MEDIUM | ยืนยันกับบัญชีว่า advance G/L อยู่ใน COCO company |
| AccBankMaster drift ระหว่าง Prod/UAT (ไม่ผ่าน dual-write) | LOW | Migration รันบน Prod+UAT คนละ command — บันทึก checklist ไว้ใน UAT testing step |
| Phase 2 เพิ่ม FK จาก AccAdvance → AccBankMaster ต้องระวัง NULL | LOW | Phase 2 design ต้องกำหนด `PayeeBankCode NULLABLE` (Phase 1 rows จะเป็น NULL) |
| Journal Batch ของ AP-2 ต้องแยก (OQ-2 ตอบว่าแยก) | LOW | ถ้าแยก → เพิ่ม FormCode ใน AccBrandJournalBatch ตาม pattern เดียวกัน (scope น้อย) |

---

*Design นี้ build-ready ทันที — ไม่มี hard blocker; บัญชีกรอก G/L/Bank/Batch ใน Settings UI ก่อน UAT ยิง BC จริง*
