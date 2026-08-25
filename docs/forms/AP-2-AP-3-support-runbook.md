# AP-2/AP-3 Support Runbook

## Scope และ safety

- ใช้ UAT/sanitized data สำหรับ diagnose และทดสอบ
- ห้ามส่ง BC, post, แก้ Production หรือใช้ credential จริงโดยไม่มี human approval
- ห้าม retry AP-2 ERP send จนกว่าจะ reconcile ผลใน BC
- AP-3 ไม่มี ERP auto-post; ห้ามสรุปว่า ledger ถูกสร้างจากสถานะ Approved

## จุดตรวจ AP-2

| อาการ | จุดตรวจ |
|---|---|
| Submit ไม่ได้ | Brand, วันที่, amount, payee, FX, เหตุผลยอดเกิน 3,000, tier และ active approvers |
| ค้าง approval | `CurrentStepCode`, approval row, role config, requester/approver permissions |
| Preview ไม่ได้ | AP-2 G/L, bank, journal batch, branch, department mapping, PaymentDate |
| Send failed/timeout | ERP interface status/error, activity log, request number และ BC journal/document ก่อน retry |
| ยอดไม่ตรง | currency, exchange rate, base amount และ Dr/Cr payload |

AP-2 BC call และ Portal status update ไม่ใช่ transaction เดียว ผล timeout อาจไม่บอกว่า BC commit หรือไม่ จึงไม่รับประกัน exactly-once

## จุดตรวจ AP-3

| อาการ | จุดตรวจ |
|---|---|
| ไม่พบ AP-2 | ต้อง Approved, staff/Brand เดียวกัน และยังไม่ถูก AP-3 ที่ active อ้าง |
| Submit ไม่ได้ | Manager, expense fields, receipt, WHT reconciliation, refund amount/date/proof |
| OCR ไม่ตรง | ตรวจภาพต้นฉบับและกรอกด้วยคน; OCR เป็น advisory |
| ค้าง approval | Manager → Account → Head, approver config และ approval row |
| Account approve ไม่ได้ | เมื่อบริษัทจ่ายเพิ่มต้องมี PaymentDate; ตรวจ PV/PPEX |
| Approved แต่ไม่พบ BC entry | เป็น expected behavior ของ Phase ปัจจุบัน เพราะไม่มี ERP auto-post |

ที่ Account step การบันทึก PV/PaymentDate เกิดก่อน approval transaction จึงไม่ควรสรุปว่าค่าดังกล่าว rollback พร้อม approval ทุกกรณี

## Evidence ที่ต้องเก็บ

- Environment, build/commit และ request ID/no.
- Status/CurrentStepCode และ approval history
- Activity log, correlation/error โดยไม่บันทึก token หรือ secret
- AP-2: preview hash/amount, interface status, BC document/journal reference
- AP-3: AP-2 reference, expense/VAT/WHT/refund totals, attachment existence และ manual journal reference
- ขั้นตอน reproduce, expected/actual และเวลาที่เกิดเหตุ

## Release checklist

- Migrations, FormEnvironment, UAT users และ Brand access พร้อม
- AP-2 approvers/tiers/banks/G-L/BC connection/batch พร้อม
- AP-3 approvers/G-L/branch พร้อม และ Accounting ยืนยัน manual journal
- ทดสอบ duplicate, concurrent submit, timeout, return/resubmit, reject/cancel และ permission failures
- QA, Accounting owner และ IT Support sign-off; unresolved HIGH risk ต้องไม่ถูกซ่อนในเอกสาร

## Known documentation gaps

- Repository ไม่มีต้นฉบับ Excel/PDF ของ AP-2, AP-3.1 และ AP-3.2 จึงยังไม่รับรองความตรงกับแบบกระดาษ
- AP-2 design spec เดิมบางจุดเก่ากว่า runtime code; ใช้ code เป็นหลักและให้ business owner ยืนยัน
- AP-3 ยังต้อง pin branch/commit หลัง implementation ถูก commit และผ่าน UAT
