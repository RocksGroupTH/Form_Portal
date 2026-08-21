# AP-2 — Future Consideration: Re-send after ERP posting (delete Document No. → re-post)

**Status:** 🟡 Deferred (study only) — proceed with the main process for the initial phase.
**Raised:** 2026-08-21 · **Owner of decision:** Atlas / Nova (ERP domain) · **Probability:** Low (rare case).

> Requirement (verbatim intent): เมื่อส่ง Interface เข้า ERP แล้ว แต่ต้องแก้ไข/ป้อนผิด — ศึกษาความเป็นไปได้ในการเพิ่ม Journey สำหรับ "ลบ Document No. ในระบบ ERP แล้วส่งใหม่ทับอีกรอบ". ระยะแรกเดินตามกระบวนการหลักก่อน เพราะโอกาสเกิดจริงน้อย.

---

## 1. Current behaviour (as built)

- ACC_OFFICER กด **"ดำเนินการ"** → `advance-erp-send` เรียก BC CU (`APJournalCreate`) ซึ่ง **insert General Journal line(s)** และคืน `results[].documentNo` (เช่น `PVA2608-0003`).
- สำเร็จ (`Failed: 0`) → `AccRequest.ErpInterfaceStatus = 'Sent'`, เก็บ `ErpDocumentNo`, `ErpInterfaceSentAt/By/Environment`.
- Drift-guard: กันยิงซ้ำ record ที่ไม่ได้อยู่สถานะที่อนุญาต. **ไม่มี** ทางย้อน (un-send / delete / re-post) หลังเป็น `Sent`.

**สรุป:** ตอนนี้ `Sent` = จุดจบของ lifecycle ฝั่งฟอร์ม แก้ไม่ได้.

---

## 2. Open domain questions (ต้องให้ Atlas/Nova + BC ยืนยันก่อนออกแบบ)

จุดชี้ขาดคือ CU **แค่ stage (insert unposted journal line) หรือ post ไปเลย** — คนละโลกกันเรื่องความยากและความปลอดภัย:

| ประเด็น | ถ้า "stage" (line ยังไม่ post) | ถ้า "post แล้ว" (GL/Vendor Ledger เกิดแล้ว) |
|---|---|---|
| ลบเอกสาร | ลบ Gen. Journal Line ได้ตรงๆ (ยังไม่กระทบบัญชี) | **ลบไม่ได้** — ต้อง Reverse/Correcting entry (audit trail คงอยู่) |
| ผลกระทบบัญชี | ต่ำ | สูง — กระทบงบ, VAT/WHT, reconciliation |
| Reversibility | สูง | ต่ำ (นี่คือโซน "low reversibility" ตาม governance) |

**คำถามที่ต้องตอบ:**
1. CU `APJournalCreate` post หรือ stage? (ให้ **Scout/Atlas** อ่าน AL ยืนยัน)
2. ถ้า post แล้ว — นโยบายบัญชีอนุญาต "ลบ" จริงไหม หรือบังคับเป็น **reverse + re-issue** เท่านั้น? (Nova/ฝ่ายบัญชี)
3. ใครมีสิทธิ์สั่ง re-send? (ACC_OFFICER เดิม / Head Acc อนุมัติซ้ำ?)
4. เลขเอกสารใหม่ = เลขเดิม (ทับ) หรือเลขใหม่ + อ้างอิงเลขเก่า? (No. Series + Allow Gaps — ระวังเคส series ที่เคยเจอใน RIV/SINV/BRSTOCK)
5. External Document No. (= Request No.) ซ้ำได้ไหมใน BC?

---

## 3. Feasibility sketch (เผื่อทีมศึกษาต่อ — ยังไม่ตัดสิน)

### แนวทาง A — "Void + Re-send" (ปลอดภัยกว่า, แนะนำให้ศึกษาก่อน)
- เพิ่มสถานะ `ErpInterfaceStatus = 'Voided'` (ไม่ลบ record, เก็บ audit)
- Journey: Head Acc อนุมัติการ void → BC action (reverse ถ้า posted / delete line ถ้า staged) → ปลดล็อกฟอร์มกลับเป็น `Approved` (แก้ได้) → ยิงใหม่เป็นเอกสารใหม่ + ผูก `PrevErpDocumentNo`
- ต้องมี CU ฝั่ง BC ใหม่ (`APJournalReverse`/`APJournalDelete`) — งานฝั่ง Forge/Atlas
- ข้อดี: audit ครบ, ไม่ทับข้อมูลเดิม, สอดคล้องหลักบัญชี

### แนวทาง B — "Delete + Overwrite" (ตรงตามคำขอ แต่เสี่ยงกว่า)
- ลบ Document No. เดิมใน BC แล้วยิงใหม่ด้วยเลขเดิม
- ทำได้เฉพาะกรณี **staged/unposted** เท่านั้น; ถ้า posted แล้ว = ขัดหลัก audit ของ ERP
- ความเสี่ยง: gap ใน No. Series, ข้อมูล reconcile ไม่ตรง, ไม่มีร่องรอยการแก้

**ข้อเสนอเบื้องต้น:** ถ้าจะทำจริงในอนาคต ให้เอียงไป **แนวทาง A (void + re-issue)** มากกว่า delete-overwrite ตรงๆ เพราะ ERP ให้คุณค่าเรื่อง audit trail

> ✅ **เลือกแล้ว (2026-08-21): แนวทาง A — Void + Re-issue** เป็น direction ที่ผู้ใช้ต้องการเมื่อ activate.
> ยัง **Deferred** — ยังไม่ build ในเฟสนี้. ตอน activate ให้ออกแบบตาม A: ไม่ลบ record, เพิ่มสถานะ `Voided`,
> ยิงใหม่เป็นเอกสารใหม่ผูก `PrevErpDocumentNo`, และ (ถ้า posted) ใช้ reverse ไม่ใช่ delete.
> ยังต้องเปิดกับ Nova/Scout ก่อนเขียนโค้ด เพื่อยืนยัน CU post-vs-stage + accounting policy.

---

## 4. Decision for now

✅ **ไม่ทำในเฟสนี้.** เดินตามกระบวนการหลัก (Sent = final). ถ้าเกิดเคสผิดจริงในช่วงต้น → แก้แบบ manual ที่ BC โดยฝ่ายบัญชี + บันทึกใน support runbook.

Trigger ที่จะยกกลับมาพิจารณา: เคสเกิดถี่ขึ้น / ฝ่ายบัญชีร้องขอ formal flow / มีการ post ผิดที่กระทบงบจริง.

**Next step เมื่อ activate:** เปิดกับ **Nova** (process design + accounting policy) และ **Scout/Atlas** (ยืนยัน CU post-vs-stage) ก่อนเขียนโค้ดใดๆ — อย่า invent domain rule เอง.
