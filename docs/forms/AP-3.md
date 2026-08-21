# AP-3 — เคลียร์เงินทดรองจ่าย

## ภาพรวม

AP-3 บันทึกค่าใช้จ่ายจริงเพื่อเคลียร์ AP-2 ที่อนุมัติแล้วของพนักงานและ Brand เดียวกัน ระบบไม่แสดง AP-2 ที่ถูก AP-3 อื่นซึ่งยังไม่ Rejected/Cancelled อ้างอยู่

| รายการ | ค่า/กฎ |
|---|---|
| Form code | `AP-3` |
| Running no. | `ADCyy-xxxxx` |
| สกุลเงิน Phase ปัจจุบัน | `THB` |
| ERP | ยังไม่มี auto-post |

## สูตรคำนวณ

```text
ยอดรวม VAT       = จำนวนก่อน VAT + VAT
ยอดจ่ายสุทธิ      = ยอดรวม VAT - WHT
ค่าใช้จ่ายจริงรวม = ผลรวมยอดจ่ายสุทธิ
ยอดคืนบริษัท      = เงินทดรอง AP-2 - ค่าใช้จ่ายจริงรวม
```

- ค่าบวก: ผู้ขอโอนคืนบริษัท
- ศูนย์: เคลียร์พอดี
- ค่าลบ: บริษัทจ่ายเพิ่ม

## ข้อมูลและ validation

- ต้องมี Manager ใน HR, Brand และ AP-2 อ้างอิง
- ต้องมี expense อย่างน้อย 1 line พร้อมวันที่ G/L และยอดก่อน VAT มากกว่า 0
- ต้องมี receipt/tax invoice อย่างน้อย 1 ไฟล์ก่อน Submit
- หากมี WHT ต้องกรอก Tax ID และชื่อผู้รับ และยอด certificate ต้องตรงกับ WHT ของ expense lines ภายใน 0.01
- หากต้องคืนเงิน ต้องกรอกยอด/วันที่โอนและแนบหลักฐาน
- หากบริษัทต้องจ่ายเพิ่ม Account Office ต้องระบุ Payment Date
- Account Office สามารถบันทึกเลข PV/PPEX
- Brand `PCTH`/`ROCKS` เลือก G/L ตามรายการ; Brand อื่นถูกบังคับเป็น `110723001` ตาม implementation ปัจจุบัน

## Approval workflow

```text
Requester → Manager → Account Office → Head Accounting → Approved
```

Approver สามารถ Reject หรือ Return for edit โดยต้องระบุเหตุผล รายการที่ Return กลับมาแก้และส่งใหม่ได้ ผู้ขอยกเลิกได้ภายใน 24 ชั่วโมงหลัง Submit ขณะที่ยังรอ Manager

## OCR สลิปคืนเงิน

Local Tesseract OCR พยายามอ่านยอดและวันที่จากสลิป รองรับวันที่ตัวเลข เดือนภาษาไทย/อังกฤษ และแปลงปี พ.ศ. เป็น ค.ศ. ผล OCR ใช้ช่วยกรอกเท่านั้น ไม่ใช่การยืนยันทางบัญชี ผู้ใช้และ approver ต้องตรวจไฟล์จริง ยอด ผู้รับ และวันที่อีกครั้ง

## หน้าจอและ API

- สร้าง/แก้: `/request/clear-advance`
- รายละเอียด: `/request/clear-advance/{id}`
- Admin/approval: `/request/clear-advance/admin`
- รายงาน: `/request/clear-advance/report`
- ตรวจสลิป: `/api/request/clear-advance/verify-slip`
- AP-2 ที่รอเคลียร์: `/api/request/clear-advance/pending-advances`
- API: `/api/request/clear-advance/requests` และ actions `submit`, `approve`, `return`, `reject`, `cancel`

## ข้อจำกัดทางบัญชี

AP-3 Phase ปัจจุบันระบุ `no ERP auto-post` ดังนั้น Approved ไม่ได้สร้าง G/L Entry, VAT Entry, WHT หรือ payment journal ใน BC โดยอัตโนมัติ ต้องให้ Accounting ยืนยัน manual journal/reconciliation process ก่อนใช้งานจริง

Application query ช่วยกัน AP-2 ถูกเคลียร์ซ้ำ แต่ฐานข้อมูลยังไม่ได้ยืนยัน unique constraint สำหรับ `AdvanceRequestId`; concurrent requests ยังต้องทดสอบและ reconcile

## หลักฐานโค้ด

`src/features/clear-advance/constants.ts`, `types.ts`, `src/lib/clr/clear-advance-request-service.ts`, `clear-advance-approval-engine.ts`, `slip-verify.ts`, `src/app/api/request/clear-advance`
