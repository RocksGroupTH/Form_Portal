# AP-2 / AP-3 UX Parity QA Report

**Baseline:** AP-1 Travel Expense  
**Scope:** AP-2 Advance และ AP-3 Clear Advance  
**Review date:** 2026-08-21  
**Method:** Static end-to-end code trace (UI → API → service → database transaction)  
**Environment:** Source code และ UAT schema metadata แบบ read-only; ไม่แก้ข้อมูลและไม่ทดสอบ Production  
**Release recommendation:** **FAIL / FIX-THEN-STANDARDIZE**

## 1. Scope and intent

รายงานนี้ใช้ AP-1 เป็น UX baseline เพื่อประเมินว่า AP-2/AP-3:

1. ใช้ interaction pattern เดียวกับ AP-1 หรือไม่
2. แตกต่างเพราะ business workflow จริง หรือเกิดจากการ copy implementation
3. มี defect ที่ทำให้ข้อมูลสูญหาย ลบ Draft ไม่ได้ ส่งคำขอซ้ำ หรือทำให้ผู้ใช้สับสนหรือไม่
4. ควรปรับส่วนใดก่อนหลังตามระดับ P0–P3

หลักการที่แนะนำไม่ใช่การบังคับให้ทุกฟอร์มเหมือนกันทั้งหมด แต่ให้ใช้ design primitives และ feedback contract ชุดเดียวกัน โดยเก็บความต่างไว้เฉพาะ business rule ของแต่ละฟอร์ม

## 2. Confirmed behavior

- Save Draft ของทั้งสามฟอร์มใช้ `POST` สำหรับรายการใหม่และ `PUT` สำหรับรายการเดิม
- Header และ detail ถูกบันทึกใน SQL transaction ของแต่ละฟอร์ม
- Draft อนุญาตให้ข้อมูลยังไม่ครบได้ ซึ่งเป็นพฤติกรรมที่ตั้งใจ
- Submit จะ persist ค่าล่าสุดก่อน แล้วจึงเรียก submit endpoint แยกอีก request
- หาก persist สำเร็จแต่ submit ล้มเหลว ข้อมูลล่าสุดยังอยู่ใน Draft/Returned
- AP-1, AP-2 และ AP-3 ยังไม่มี shared unsaved-change navigation guard
- AP-2/AP-3 reuse shell บางส่วนจาก AP-1 แต่ form internals จำนวนมากเป็น markup/style ที่คัดลอกมา ไม่ใช่ shared component

## 3. UX parity matrix

| หัวข้อ | AP-1 baseline | AP-2 | AP-3 | Assessment | Priority |
|---|---|---|---|---|---|
| Save Draft transport | POST ใหม่ / PUT เดิม | เหมือน AP-1 | เหมือน AP-1 | ผ่าน | — |
| Save Draft transaction | Header + travel detail ใน transaction | Header + `AccAdvance` ใน transaction | Header + clear/items/WHT ใน transaction | ผ่าน | — |
| Incomplete Draft | อนุญาต | อนุญาต | อนุญาต | เหมาะสม | — |
| URL หลัง Manual Save ครั้งแรก | เปลี่ยนเป็น URL ที่มี request ID | เปลี่ยนเป็น `?id=` | เปลี่ยนเป็น URL ที่มี ID | ผ่าน | — |
| Post-save freshness | Toast แล้ว reload state จาก server | Toast แต่คง local state | Toast แต่คง local state | ควรมี saved-state contract กลาง | P2 |
| Save/Submit action bar | Sticky พร้อมยอดรวม | อยู่ท้ายฟอร์ม | อยู่ท้ายฟอร์มยาว | AP-2/AP-3 หา action ยาก | P1 |
| Submit validation | Inline error, highlight และ focus ช่องแรก | รอ server แล้วแสดง toast | ตรวจ client แต่แสดง toast ช่องแรก | Interaction ไม่เท่ากัน | P1 |
| Partial submit failure | ข้อมูลล่าสุดถูก Save แต่ข้อความ generic | เหมือน AP-1 | เหมือน AP-1 | ข้อความทำให้เข้าใจว่า Save ล้มเหลวด้วย | P1 |
| Duplicate prevention | ตรวจวันเดินทางซ้ำก่อน Save | ไม่มี business rule เทียบตรง | Dropdown กรอง AP-2 ที่ถูกใช้ | AP-3 filtering ฝั่ง UI ไม่ป้องกัน concurrency | P0 |
| Draft loading gate | ตรวจ Draft ก่อนแสดงฟอร์ม | ฟอร์มอาจแสดงก่อน picker โหลด | ฟอร์มอาจแสดงก่อน picker โหลด | เกิด flicker/กรอกฟอร์มใหม่ผิดรายการ | P2 |
| Resume Draft | Dialog สมบูรณ์และ metadata ชัด | Dialog แยกอีกชุด | Dialog inline อีกชุด | ทำงานใกล้เคียงแต่ implementation ซ้ำ | P2 |
| Delete Draft | Confirm + cleanup ใน transaction | Cleanup ผิด/ไม่ครบเมื่อมีไฟล์หรือ approval | Cleanup ครบกว่า AP-2 | AP-2 มี functional defect | P0 |
| Attachment ก่อนมี Draft | เก็บ pending ใน memory รอ Save/Submit | สร้าง Draft อัตโนมัติ | สร้าง Draft อัตโนมัติ | Product behavior ไม่ตรงกัน | P1 |
| URL หลัง implicit attachment save | ไม่เกิด implicit save | URL ยังเป็นหน้า New | URL ยังเป็นหน้า New | Refresh/Back ทำให้ context ดูเหมือนหาย | P1 |
| Attachment type | Image ตาม travel item | Image/PDF ≤4 MB | Image only ≤4 MB | ต้องยืนยัน PDF สำหรับใบเสร็จ/ใบกำกับ AP-3 | P2 |
| Delete attachment feedback | มี feedback | ไม่มี success toast | มี success toast | ปรับ consistency | P3 |
| Unsaved changes | ไม่มี guard | ไม่มี guard | ไม่มี guard | Baseline เองยังมีช่องว่าง | P1 |
| Date picker | Custom multi-date พร้อม min/max/blocked dates | Native date 2 ช่อง | Native date ต่อ expense row/refund | Business cardinality ต่าง แต่ UX contract ควรร่วม | P1 |
| Inline field errors | มี | แทบไม่มี | แทบไม่มี | UX regression | P1 |
| Section hierarchy | `SectionCard` + icon/title/hint | กล่อง plain | กล่อง plain | ลำดับการอ่านอ่อนกว่า AP-1 | P2 |
| Requester/first approver | Requester + Manager | Requester + Head Accounting | Requester + Manager | ต่างตาม workflow อย่างถูกต้อง | — |
| Brand selector | Brand chips | Copy markup | Copy markup | เสี่ยง style/behavior drift | P2 |
| Resolved ERP Company | Mapping อยู่ใน config | สืบทอด Company จาก AP-1 แต่ไม่เด่นใน form | ไม่แสดงชัด | ควรแสดง read-only ก่อน financial action | P2 |
| Mobile layout | Responsive โดยรวม | Responsive grid | ตารางกว้างขั้นต่ำประมาณ 1120px | AP-3 ใช้งานมือถือยาก | P2 |
| Status/approval timeline | Implementation ของ AP-1 | Mapping/Panel ของตัวเอง | Timeline ของตัวเอง | สี คำ และ state เสี่ยง drift | P2 |
| Accessibility | ยังมี gap บางจุด | label/input association ไม่ครบ | เช่นเดียวกับ AP-2 | ควรแก้ผ่าน shared primitives | P2 |

## 4. Priority 0 — Blocking defects

### P0.1 AP-2 Delete Draft ลบไฟล์และ approval ไม่ครบ

**Finding**  
`deleteDraft()` ของ AP-2 ลบ `AccApproval` ซึ่งไม่ใช่ approval table ของ AP-2 และไม่ลบ `AccRequestFile` ก่อนลบ `AccRequest`.

**Impact**

- Draft AP-2 ที่มีไฟล์แนบอาจลบไม่สำเร็จเพราะ Foreign Key
- Returned AP-2 อาจทิ้ง orphan row ใน `AccAdvanceApproval`
- ผู้ใช้เห็นข้อความลบไม่สำเร็จทั้งที่ flow ของ AP-1/AP-3 ทำได้

**Evidence**

- `src/lib/adv/advance-request-service.ts` — AP-2 `deleteDraft()`
- `migrations/013_portal_acc_core.sql` — `FK_AccFile_Request`
- `migrations/085_acc_advance_own_approval.sql` — `AccAdvanceApproval`

**Suggested change**

ลบตามลำดับภายใน transaction:

1. `AccRequestFile`
2. `AccAdvanceApproval`
3. `AccActivityLog`
4. `AccAdvance`
5. `AccRequest`

**Acceptance criteria**

- ลบ Draft และ Returned AP-2 ที่ไม่มีไฟล์ได้
- ลบ Draft และ Returned AP-2 ที่มีหลายไฟล์ได้
- ไม่เหลือ orphan rows ในไฟล์, approval, activity และ detail
- ผู้ใช้อื่นไม่สามารถลบรายการได้
- รายการ Submitted/Approved/Cancelled ลบไม่ได้

### P0.2 AP-3 สามารถเคลียร์ AP-2 ซ้ำหรือผิดเจ้าของภายใต้ concurrency

**Finding**  
AP-3 ใช้ dropdown filtering เพื่อซ่อน AP-2 ที่ถูกเลือกแล้ว แต่ server/database ยังไม่มี guarantee ว่า AP-2 หนึ่งรายการมี active AP-3 ได้เพียงรายการเดียว และยังตรวจ ownership/status/brand ไม่ครบใน submit path.

**Impact**

- AP-2 เดียวอาจถูกเคลียร์สองครั้ง
- อาจเลือก AP-2 ที่ไม่ Approved, คนละพนักงาน หรือคนละ Brand ผ่าน crafted request
- กระทบยอดบัญชีและ reconciliation

**Evidence**

- `src/lib/clr/clear-advance-request-service.ts` — pending advance query, snapshot และ submit
- `migrations/098_clr_clear_advance.sql` — `AdvanceRequestId` มี index แต่ไม่ใช่ active-claim uniqueness

**Suggested change**

1. Revalidate AP-2 ใน submit transaction: FormCode, Status, StaffId, BrandCode และ `AccAdvance`
2. Lock/serialize claim ของ `AdvanceRequestId`
3. เพิ่ม server/DB strategy ป้องกัน active duplicate
4. ทดสอบ concurrent submit สอง session

**Acceptance criteria**

- AP-2 ที่ไม่ Approved ถูกปฏิเสธ
- AP-2 คนละพนักงาน/Brand ถูกปฏิเสธ
- concurrent submit สองรายการสำเร็จได้เพียงหนึ่งรายการ
- retry หลัง timeout reconcile ได้โดยไม่สร้าง duplicate

## 5. Priority 1 — High-value UX corrections

### P1.1 Standardize submit validation and focus behavior

AP-2 ต้องมี client validation contract และ AP-3 ต้องแสดง inline error พร้อม focus/scroll ไปช่องแรกแบบ AP-1 โดย server validation ยังคงเป็น source of truth.

**Acceptance criteria**

- ช่องผิดมีข้อความใกล้ field และ `aria-describedby`
- Submit แล้ว focus ช่องแรกที่ผิด
- Toast ใช้เป็น summary ไม่ใช่ error location เพียงอย่างเดียว
- Client/server validation message ไม่ขัดแย้งกัน

### P1.2 Add shared unsaved-change guard

ทั้งสามฟอร์มต้องเตือนเมื่อกด Back, เปลี่ยน route, refresh หรือปิด tab หลังมีการแก้ไขที่ยังไม่ Save.

**Acceptance criteria**

- ไม่เตือนเมื่อ form pristine หรือ Save สำเร็จแล้ว
- เตือนเมื่อ field/file เปลี่ยนและยังไม่ Save
- Submit สำเร็จแล้ว navigation ไม่ถูก block
- รองรับ browser refresh และ in-app navigation

### P1.3 Fix implicit attachment autosave URL

AP-2/AP-3 เมื่อแนบไฟล์ครั้งแรกแล้วระบบสร้าง Draft อัตโนมัติ ต้องเปลี่ยน URL ให้มี request ID และแสดงสถานะ “สร้างแบบร่างอัตโนมัติแล้ว” โดยไม่แสดงว่า Manual Save เกิดขึ้น.

**Acceptance criteria**

- แนบไฟล์ครั้งแรกสร้าง Draft เพียงรายการเดียว
- URL เปลี่ยนทันทีหลัง persist สำเร็จ
- refresh แล้วกลับเข้ารายการเดิม
- upload ล้มเหลวไม่สร้าง duplicate Draft จาก retry

### P1.4 Shared sticky action bar

สร้าง action bar กลางสำหรับ Save/Submit พร้อม summary ที่เหมาะกับแต่ละฟอร์ม:

- AP-1: total travel expense
- AP-2: requested/base amount
- AP-3: actual total/refund or additional payment

**Acceptance criteria**

- เห็นปุ่มบน desktop/mobile โดยไม่ต้องเลื่อนถึงท้ายฟอร์ม
- Save และ Submit mutually disabled ระหว่าง request
- แสดง saving/submitting state ชัดเจน
- ไม่บัง field หรือ mobile keyboard

### P1.5 Distinguish “saved but submit failed”

เมื่อ persist สำเร็จแต่ submit endpoint ล้มเหลว ให้แจ้งว่า:

> บันทึกแบบร่างล่าสุดแล้ว แต่ส่งคำขอไม่สำเร็จ กรุณาลองส่งอีกครั้ง

ห้ามแจ้งข้อความที่ทำให้ผู้ใช้เข้าใจว่าข้อมูลล่าสุดสูญหาย

### P1.6 Shared date-control contract

ไม่ควรบังคับใช้ AP-1 MultiDatePicker ตรง ๆ กับทุกฟอร์ม ให้สร้าง component family:

```text
FormDatePicker
├── mode="multiple" → AP-1 travel dates
└── mode="single"   → AP-2/AP-3 dates
```

AP-2 ต้องแสดง/บังคับ relationship ของ Need-by และ Expected-clear (≤30 วัน) ใน UI ส่วน AP-3 ต้องใช้ single-date presentation เดียวกันสำหรับ expense/refund โดยปรับ rendering สำหรับ table cell ได้

## 6. Priority 2 — Standardization and maintainability

### P2.1 Shared form primitives

แยก component กลาง:

1. `FormField` — id/htmlFor, help, required, error, aria
2. `SectionCard` — title, icon, hint, lock state, tour anchor
3. `BrandChipGroup`
4. `AttachmentArea` — policy props สำหรับ MIME, size, multiple, camera และ required
5. `DraftPickerDialog` — render summary ตามฟอร์ม
6. `RequestStatusBadge` และ approval timeline primitives

### P2.2 Draft picker loading gate

AP-2/AP-3 ควรรอผล draft lookup ก่อนเปิดฟอร์มใหม่ เพื่อลด flicker และป้องกันการเริ่มกรอกใหม่ก่อน dialog เด้งขึ้น.

### P2.3 Saved-state indicator

แสดง `ยังไม่บันทึก`, `กำลังบันทึก`, `บันทึกแล้ว HH:mm`, `บันทึกไม่สำเร็จ` แบบเดียวกันทั้งสามฟอร์ม ไม่จำเป็นต้อง reload หลัง Save ทุกครั้งหาก server ไม่ normalize ค่า.

### P2.4 AP-3 mobile expense editor

Desktop ใช้ table ได้ แต่ mobile ควร render expense/WHT เป็น card rows ที่แก้ไขได้ โดยยังใช้ state/validation contract เดียวกัน.

### P2.5 Show resolved ERP Company read-only

AP-2/AP-3 ควรแสดง Company/Environment ที่ระบบ resolve ได้ก่อน action ทางการเงิน เพื่อให้ผู้ใช้และ Support ตรวจ mapping ผิดได้เร็ว โดยห้ามให้ผู้ใช้แก้ Company ตรงจาก field นี้.

### P2.6 Confirm AP-3 PDF policy

Accounting owner ต้องยืนยันว่า AP-3 ต้องแนบ PDF ใบเสร็จ/ใบกำกับภาษีหรือไม่ หากต้องรองรับ ให้ใช้ AttachmentArea policy เดียวกับ AP-2 พร้อม OCR เป็น optional enhancement ไม่ใช่ข้อบังคับสำหรับไฟล์ทุกประเภท.

## 7. Priority 3 — Consistency polish

### P3.1 Attachment delete success feedback

เพิ่ม success feedback หลังลบไฟล์ AP-2 ให้เหมือน AP-1/AP-3.

### P3.2 Shared terminology

กำหนดคำกลางสำหรับ:

- บันทึกแบบร่าง
- ส่งคำขอ
- ส่งกลับเพื่อแก้ไข
- ยกเลิกคำขอ
- ลบแบบร่าง
- บันทึกแล้วแต่ส่งไม่สำเร็จ

### P3.3 Accessibility cleanup

- เชื่อม `label` กับ input ด้วย `id/htmlFor`
- เพิ่ม `aria-label` ให้ icon-only buttons
- date popover ต้องมี `aria-expanded`, `aria-controls` และ keyboard navigation
- error ต้องประกาศผ่าน accessible description/live region ที่เหมาะสม

## 8. Test matrix

| ID | Priority | Scenario | Expected result | Status |
|---|---|---|---|---|
| UX-DRAFT-001 | P1 | Save draft ใหม่ที่ข้อมูลไม่ครบ | สร้าง Draft หนึ่งรายการและเปลี่ยน URL เป็น ID | NOT RUN |
| UX-DRAFT-002 | P1 | Save draft เดิมซ้ำ | Update รายการเดิม ไม่สร้าง duplicate | NOT RUN |
| UX-DRAFT-003 | P1 | Refresh หลัง Save | โหลด Draft เดิมพร้อมข้อมูลล่าสุด | NOT RUN |
| UX-DRAFT-004 | P1 | Back/refresh ขณะ dirty | แสดง unsaved-change confirmation | NOT RUN |
| UX-FILE-001 | P1 | แนบไฟล์ครั้งแรกบน AP-2/AP-3 ใหม่ | Auto-create หนึ่ง Draft, URL เปลี่ยน, upload สำเร็จ | NOT RUN |
| UX-FILE-002 | P0 | ลบ AP-2 Draft ที่มีหลายไฟล์ | ลบสำเร็จและไม่มี orphan | NOT RUN |
| UX-FILE-003 | P2 | AP-3 แนบ PDF | ผลตาม policy ที่ Accounting อนุมัติ | NOT RUN |
| UX-SUBMIT-001 | P1 | Submit โดยข้อมูลไม่ครบ | Inline error และ focus ช่องแรก | NOT RUN |
| UX-SUBMIT-002 | P1 | Save สำเร็จแต่ submit endpoint ล้มเหลว | แจ้งว่า Draft ถูก Save แล้วและ retry ได้ | NOT RUN |
| UX-SUBMIT-003 | P0 | AP-3 concurrent submit อ้าง AP-2 เดียวกัน | สำเร็จเพียงหนึ่ง request | NOT RUN |
| UX-DATE-001 | P1 | AP-2 clear date เกิน 30 วัน | UI ปิด/เตือน field และ server ปฏิเสธ | NOT RUN |
| UX-DATE-002 | P1 | AP-3 วันที่ต่อ expense row บนมือถือ | เลือกได้โดยไม่ต้อง zoom/scroll ผิดตำแหน่ง | NOT RUN |
| UX-MOBILE-001 | P2 | AP-3 expense editor ที่ 375px | แก้ทุก field ได้และ action bar ไม่บังข้อมูล | NOT RUN |
| UX-A11Y-001 | P2 | Keyboard-only form completion | เข้าถึง field/date/dialog/actions ครบ | NOT RUN |
| UX-ERP-001 | P2 | Company mapping ไม่ครบ | แสดง resolved target/error ชัดก่อน ERP action | NOT RUN |

## 9. Execution evidence

ตรวจแบบ static trace จากไฟล์หลัก:

- `src/features/accounting/components/TravelExpenseForm.tsx`
- `src/features/accounting/components/FilterMultiDatePicker.tsx`
- `src/features/advance/components/AdvanceForm.tsx`
- `src/features/clear-advance/components/ClearAdvanceForm.tsx`
- `src/app/(dashboard)/request/travel-expense/page.tsx`
- `src/app/(dashboard)/request/advance/page.tsx`
- `src/app/(dashboard)/request/clear-advance/page.tsx`
- `src/lib/acc/request-service.ts`
- `src/lib/adv/advance-request-service.ts`
- `src/lib/clr/clear-advance-request-service.ts`
- migrations ที่เกี่ยวข้องกับ `AccRequestFile`, `AccAdvanceApproval` และ `AccClearAdvance*`

ยังไม่ได้รัน browser E2E, accessibility automation, concurrent submit หรือ mutation test กับฐานข้อมูล รายการเหล่านี้จึงระบุเป็น `NOT RUN` ตามจริง

## 10. Coverage gaps and residual risks

- ยังไม่มี browser E2E ยืนยัน Save/Resume/Delete/Submit ทั้งสามฟอร์ม
- ยังไม่ได้ทดสอบ network timeout ระหว่าง persist และ submit
- ยังไม่ได้ทดสอบสอง browser session ส่ง AP-3 พร้อมกัน
- ยังไม่ได้ทดสอบ touch/mobile device จริง
- ยังไม่ได้ให้ Accounting owner ยืนยัน AP-3 PDF policy และ resolved Company presentation
- ยังไม่ได้ทดสอบ Business Central posting/reconciliation จาก AP-2 หลัง UX changes

## 11. Recommended delivery sequence

1. แก้ P0 และเพิ่ม regression tests
2. สร้าง shared validation/dirty-state/action-bar/date contracts ใน P1
3. นำ AP-2 มาใช้ก่อนและรัน UAT
4. นำ AP-3 มาใช้พร้อม concurrency protection และ mobile editor
5. Refactor shared primitives ใน P2 โดยไม่เปลี่ยน business workflow
6. ทำ accessibility/terminology polish ใน P3
7. ทดสอบ UAT ครบก่อนพิจารณา Production

