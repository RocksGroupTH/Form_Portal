# Form Portal — AP-2 และ AP-3

เอกสารชุดนี้อธิบายพฤติกรรมจาก implementation ณ วันที่ 21 สิงหาคม 2026 สำหรับผู้ใช้งาน ฝ่ายบัญชี Support และ Developer

- [AP-2 — เบิกเงินทดรองจ่าย](AP-2.md)
- [AP-3 — เคลียร์เงินทดรองจ่าย](AP-3.md)
- [AP-2 → AP-3 Process Flow](AP-2-AP-3-flow.md)
- [Support Runbook](AP-2-AP-3-support-runbook.md)

```text
AP-2 เบิกเงินทดรอง → อนุมัติตามวงเงิน → Accounting กำหนดวันจ่าย
→ ส่ง Journal เข้า Business Central → AP-3 บันทึกค่าใช้จ่ายจริง/เงินคืน
→ Manager → Account Office → Head Accounting
```

> AP-3 Phase ปัจจุบันยังไม่มี ERP auto-post การ Approved AP-3 จึงไม่เท่ากับสร้างรายการบัญชีใน Business Central

หลักฐานมาจาก `src/features/advance`, `src/lib/adv`, `src/features/clear-advance`, `src/lib/clr` และ API routes โดยไม่ใช้ข้อมูล Production
