# AP-2 — เบิกเงินทดรองจ่าย

## ภาพรวม

AP-2 ใช้ขอเงินล่วงหน้าให้พนักงานหรือคู่ค้าก่อนเกิดค่าใช้จ่ายจริง และนำรายการที่อนุมัติแล้วไปเคลียร์ผ่าน AP-3

| รายการ | ค่า/กฎ |
|---|---|
| Form code | `AP-2` |
| Running no. | `ADVyy-xxxxx` |
| สกุลเริ่มต้น | `THB` |
| วันเคลียร์ | ตั้งแต่วันเริ่มใช้เงินและไม่เกิน 30 วัน |
| ยอดเกินเกณฑ์ | ยอดฐาน THB เกิน 3,000 บาทต้องมีเหตุผลเพิ่มเติม |

## ข้อมูลที่ต้องกรอก

- Brand/บริษัท
- ผู้รับโอน: พนักงานหรือคู่ค้า; คู่ค้าต้องมีชื่อ เลขบัญชี และธนาคาร
- วันที่เริ่มใช้เงิน ซึ่งต้องไม่เป็นอดีต
- วันที่คาดว่าจะเคลียร์
- วัตถุประสงค์และจำนวนเงินที่มากกว่า 0
- เงินต่างประเทศต้องมี exchange rate; ยอดที่ใช้ลง journal คือยอดฐาน THB
- หมายเหตุ WHT เป็นข้อมูลประกอบและไม่สร้าง journal line แยกใน AP-2

## Approval workflow

1. ผู้ขอบันทึก `Draft`
2. Submit แล้วระบบ validate และออกเลข `ADVyy-xxxxx`
3. ระบบเลือก approval tier จากยอดฐานบาท และสร้างลำดับจาก `HEAD_ACC`, `DIRECTOR`, `ACC_OFFICER` ตาม config
4. ผู้อนุมัติเลือก Approve, Return for edit หรือ Reject
5. Accounting Officer กำหนด `PaymentDate` ใน step ที่ต้องชำระ
6. เมื่อครบทุก step สถานะเป็น `Approved`
7. ฝ่ายบัญชี Preview และส่ง Journal จาก ERP queue

`HEAD_DEPT` ยังรองรับข้อมูล tier เดิม แต่ไม่ใช่ step ที่เปิดให้ตั้งใหม่ สายอนุมัติจึงต้องอ่านจาก config ไม่ควรเขียนเป็นลำดับตายตัว

ผู้ขอแก้ไขหรือลบได้เฉพาะรายการของตนในสถานะ `Draft` หรือ `Returned` การยกเลิกไม่ใช่การย้อนรายการที่ส่งเข้า BC แล้ว

## Business Central journal

หนึ่ง AP-2 สร้างคู่บัญชี 2 lines ใน group เดียว:

| Line | Account | Amount |
|---|---|---|
| Debit | G/L เงินทดรองจาก config AP-2/Brand | ยอดฐาน THB |
| Credit | Bank Account จาก config Brand | ยอดฐาน THB ติดลบ |

- Posting date ใช้ `PaymentDate`
- Document type คือ `Payment`; payment method คือ `BANK`
- External document reference ใช้เลขคำขอ AP-2
- Description ใช้วัตถุประสงค์ สูงสุด 100 ตัวอักษร
- G/L, bank, journal batch, branch และ department ต้องมาจาก config
- การเรียก BC กับการอัปเดตสถานะ Portal ไม่ใช่ distributed transaction หาก timeout ต้อง reconcile ด้วย request number ก่อน retry

## หน้าจอและ API

- สร้าง/แก้: `/request/advance`
- รายละเอียด: `/request/advance/{id}`
- Inbox: `/request/advance/inbox`
- รายงาน: `/request/advance/report`
- ตั้งค่า: `/request/advance/settings`
- API: `/api/request/advance/requests` และ actions `submit`, `approve`, `return`, `reject`, `cancel`
- ERP: `/api/request/advance/erp-queue` พร้อม `preview`, `export`, `send`

## Checklist

- Approval tiers ครอบคลุมทุกวงเงินและแต่ละ role มี active approver
- ตั้ง G/L AP-2, bank, journal batch, branch และ department mapping ครบ
- ตรวจ Environment/company ก่อนส่ง
- ตรวจ amount, PaymentDate และคู่บัญชีจาก Preview
- หลัง error/timeout ค้นหาใน BC และ audit log ก่อนส่งซ้ำ
- `Approved` ใน Portal ไม่ได้แปลว่า BC สำเร็จ ต้องตรวจ document/journal/ledger เพิ่ม

## หลักฐานโค้ด

`src/features/advance/constants.ts`, `types.ts`, `src/lib/adv/advance-request-service.ts`, `approval-steps.ts`, `advance-tier-service.ts`, `advance-erp-payload.ts`, `advance-erp-send.ts`
