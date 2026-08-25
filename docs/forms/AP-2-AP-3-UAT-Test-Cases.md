# AP-2 / AP-3 UAT Test Cases

**Project:** Form Portal  
**Forms:** AP-2 Advance Request, AP-3 Clear Advance  
**Environment:** UAT only  
**Prepared:** 2026-08-21  
**Execution status:** All cases are `NOT RUN`  
**Production:** ห้ามใช้ชุดทดสอบนี้สร้าง แก้ไข อนุมัติ หรือ Post ข้อมูล Production

## 1. Scope and objectives

ชุดทดสอบนี้ครอบคลุม:

- Save, resume, update และ delete Draft
- Validation, boundary, precision และ attachments
- Submit, approval, return, reject และ cancel
- Authorization, ownership และ least privilege
- Transaction rollback, concurrency และ duplicate prevention
- AP-2 Business Central preview/send/retry/reconciliation
- AP-3 Phase 1 reports/manual accounting และยืนยันว่าไม่มี auto-post
- UX parity กับ AP-1: validation, date, loading, feedback, dirty-state และ mobile

## 2. Shared preconditions and test data

### Personas

| Persona | Purpose |
|---|---|
| Requester A | เจ้าของ AP-2/AP-3 หลัก |
| Requester B | ทดสอบ cross-user access |
| Manager A | AP-3 first approval |
| Head Accounting | AP-2/AP-3 accounting approval |
| Accounting Officer | AP-2 final accounting/config/ERP |
| Director | AP-2 high-value tier |
| Unauthorized User | ทดสอบ authorization |

### Master/test data

- Brand A และ Brand B ต้อง map ไปคนละ ERP Company/config
- AP-2 THB: 10,000.00
- AP-2 FX: 100.00 × 35.123456
- Threshold cases: threshold−0.01, threshold, threshold+0.01
- AP-3 ใช้ Approved AP-2 ของ Requester A/Brand A
- AP-3 expense lines ต้องมีกรณี VAT, WHT, refund = positive/zero/negative
- ไฟล์: valid image, valid PDF, invalid executable, oversized file >4 MB

### Evidence required for every executed case

1. Screenshot หรือ screen recording
2. Request/response และ correlation information ที่ไม่เปิดเผย secret
3. Rows ที่เกี่ยวข้องใน `AccRequest`, detail, approval, file และ activity tables
4. ก่อน/หลัง row counts และ status
5. สำหรับ BC: payload ที่ redact แล้ว, interface status/log, document reference และ ledger evidence

**Actual result สำหรับทุกเคสในเอกสารฉบับนี้:** Not executed  
**Status สำหรับทุกเคสในเอกสารฉบับนี้:** `NOT RUN`

## 3. AP-2 Functional, UX and workflow cases

| ID | Layer / Risk | Preconditions / Data | Steps | Expected result | Evidence / Source |
|---|---|---|---|---|---|
| AP2-F-001 | E2E · Save incomplete Draft | Requester A; form ใหม่ | เลือก Brand แล้ว Save โดยข้อมูลอื่นยังไม่ครบ | สร้าง `AccRequest` Draft + `AccAdvance`; URL มี ID; ไม่สร้าง approval | `AdvanceForm.tsx`; `advance-request-service.ts::saveDraft` |
| AP2-F-002 | E2E · Update Draft | Draft จาก F-001 | เปลี่ยน purpose/amount แล้ว Save สองครั้ง | ใช้ ID เดิม; ไม่มี header/detail ซ้ำ; total ล่าสุดถูกต้อง | `persistAdvance`; save route |
| AP2-F-003 | Recovery · Resume | มี Draft หลายรายการ | เปิด AP-2 แล้วเลือก Draft | requester, Brand, payee, dates, amount, currency และ files ตรง DB | `AdvanceDraftPicker.tsx`; drafts route |
| AP2-F-004 | Functional · Start New | มี Draft เดิม | เลือก New แล้ว Save | ได้ ID ใหม่; Draft เดิมไม่เปลี่ยน | page + picker |
| AP2-F-005 | Regression · Delete children | Draft/Returned มี files, activity, own approvals | Delete และยืนยัน | ลบ file → `AccAdvanceApproval` → activity → advance → header ใน transaction; ไม่ orphan | `advance-request-service.ts::deleteDraft` |
| AP2-N-006 | Security · Delete guard | Requester B หรือ status non-editable | เรียก DELETE ด้วย ID เป้าหมาย | 4xx; ไม่มี row ถูกเปลี่ยน | `[id]/route.ts`; `deleteDraft` |
| AP2-F-007 | Attachment · Valid | New และ existing Draft | Upload image/PDF ≤4 MB; reload/open | ใช้ Draft เดียว; metadata/content/owner ถูกต้อง | AP-2 file routes/service |
| AP2-N-008 | Attachment · Invalid | executable, spoofed MIME, >4 MB | Upload ทีละไฟล์ | ปฏิเสธชัด; ไม่เกิด orphan file/partial row | file validation |
| AP2-UX-009 | Recovery · Implicit autosave | New form ไม่มี ID | Upload file แล้ว refresh/back | URL/context ชี้ Draft ที่สร้าง; resume ได้; ไม่สร้าง Draft ซ้ำ | `AdvanceForm.tsx::uploadFiles` |
| AP2-V-010 | Negative · Required fields | ขาด Brand/date/purpose/amount/payee ทีละ field | Submit | persist ล่าสุดคงอยู่; submit ถูกปฏิเสธ; ระบุ field/rule; status ยัง Draft/Returned | `validateAdvanceForSubmit` |
| AP2-V-011 | Boundary · Dates | yesterday/today; clear before/same/+30/+31 | Submit แต่ละชุด | ค่าที่ผิดถูกปฏิเสธ; today/same/+30 ผ่านตาม rule | validator/constants |
| AP2-V-012 | Boundary · Amount | null, 0, negative, 0.01, >2 decimals | Save/Submit | Draft เก็บได้ตาม policy; Submit ปฏิเสธ invalid; rounding ตรง decimal(18,2) | migrations 073/077; service |
| AP2-V-013 | Functional · Payee | Employee; Vendor ขาด/ครบ name/account/bank | Submit | Employee ไม่บังคับ vendor fields; Vendor ขาดข้อมูลไม่ผ่าน; ครบแล้วผ่าน | validator |
| AP2-V-014 | Finance · FX | THB blank rate; USD blank/0/negative/35.123456 | Submit | THB ใช้ 1; FX ต้อง >0; base amount ปัด 2 ตำแหน่งตรงกัน UI/DB | compute/persist service |
| AP2-V-015 | Boundary · Threshold | threshold−0.01, threshold, threshold+0.01 มี/ไม่มี reason | Submit | เหนือ threshold ต้อง reason; tier/steps ถูกต้องทุก boundary | tier lookup + validator |
| AP2-I-016 | Transaction · Submit | Valid Draft; fault หลัง allocate no./ก่อน approval/activity | Submit | RequestNo, status, chain, log commit พร้อมกันหรือ rollback ทั้งหมด | `submitRequest` |
| AP2-I-017 | Configuration · Missing approver | ไม่มี approver ตาม role/tier | Submit | ปฏิเสธก่อน workflow ค้าง; Draft แก้ต่อได้; ไม่มี partial approvals | approval config/service |
| AP2-C-018 | Concurrency · Double submit | Draft เดียวในสอง sessions | Submit พร้อมกัน | หนึ่ง transition/chain/RequestNo; อีก request conflict; ไม่ duplicate | `submitRequest` guards |
| AP2-F-019 | Workflow · Approve | Submitted ในแต่ละ tier | Approve ตามลำดับ | current assignee เท่านั้น; step ต่อไป Pending; final Approved; audit ครบ | `advance-approval-engine.ts` |
| AP2-N-020 | Security · Wrong approver | user/role/step ผิด | Approve/Reject | 403/4xx; state ไม่เปลี่ยน | approval routes/engine |
| AP2-F-021 | Recovery · Return/resubmit | Submitted | Return พร้อม note; requester แก้และ resubmit | status Returned; note/audit แสดง; chain ใหม่หนึ่งชุดจากข้อมูลล่าสุด | return + submit routes |
| AP2-F-022 | Functional · Reject/cancel | สถานะที่อนุญาต | Reject หรือ Cancel | transition/pending approvals/audit/notification ถูกต้อง; edit ต่อไม่ได้ | action routes |
| AP2-UX-023 | UX · Save vs submit failure | Slow network; save ผ่านแต่ submit fail | กด Submit | กัน double click; แจ้ง “บันทึกร่างแล้ว แต่ส่งไม่สำเร็จ”; retry ได้ | `AdvanceForm.tsx` |
| AP2-UX-024 | UX · Unsaved navigation | แก้ Draft ไม่ Save | Back, refresh, close tab, menu | แสดง dirty guard; Stay ไม่เสียข้อมูล; Leave ตาม confirmation | shared guard requirement |
| AP2-UX-025 | UX/A11y · Date/actions | desktop/mobile/keyboard-only | เลือก date; trigger validation; Save/Submit | min/max และ relation ชัด; focus visible; labels/errors accessible; actions หาได้ง่าย | form/date/action components |

## 4. AP-2 Business Central integration cases

> ใช้เฉพาะ BC Sandbox/UAT company ที่อนุมัติ ห้ามใช้ Production tenant/company ในการ execute test cases.

| ID | Layer / Risk | Preconditions / Data | Steps | Expected result | Evidence / Source |
|---|---|---|---|---|---|
| AP2-BC-001 | Contract · Preview mapping | Approved AP-2; config ครบ | เปิด preview | Company/environment/date/template/batch/accounts/bank/description/dimensions/amounts ตรง source/config | ERP context/payload/preview |
| AP2-BC-002 | Integration · Valid send | Approved; not Sent | Send ไป BC Sandbox | Pending→Sent เฉพาะเมื่อ BC ยืนยัน success; เก็บ doc no./env/user/time | `advance-erp-send.ts` |
| AP2-BC-003 | Batch · Company grouping | หลาย AP-2 same/different Company | Batch send | Company เดียว group ตาม design; ต่าง Company แยก; totals ถูกต้อง | batch builder/send |
| AP2-BC-004 | Negative · Missing master/config | account/batch/dimension missing/blocked; invalid date | Preview/Send | ปฏิเสธหรือ mark Failed; ไม่ false Sent; error actionable | context/payload/send |
| AP2-BC-005 | Idempotency · Resend Sent | AP-2 Sent | เรียก send ซ้ำ | ปฏิเสธก่อน BC call; ไม่เกิด document/ledger ซ้ำ | status guard |
| AP2-BC-006 | Concurrency · Send | Approved not sent; two sessions | Send พร้อมกัน | หนึ่ง caller claim Pending; BC ได้หนึ่ง logical document | interface status guard |
| AP2-BC-007 | Retry · Timeout before commit | fault ก่อน BC commit | Send แล้ว retry | outcome ชัด; retry ไม่ duplicate | BC client/send service |
| AP2-BC-008 | Recovery · Timeout after commit | BC commit แล้ว response หาย | Reconcile แล้ว retry | ไม่ blind retry; lookup source/document reference ก่อน resend | BC contract + send service |
| AP2-BC-009 | Partial result | HTTP 200 แต่ failed count >0/inserted=0 | Send mock result | ไม่ mark Sent; group Failed; activity มี summary; ไม่ false success | response assertion |
| AP2-BC-010 | Resilience · 401/403/429/5xx | expired/insufficient credential, throttle, outage | Send | Failed/recoverable; ไม่เปิดเผย token/secret; retry ไม่ซ้ำ | BC client/logs |
| AP2-BC-011 | Finance · Reconciliation | Sent AP-2 | เทียบ app→payload→BC journal/document/G/L | amount, FX, date, account, bank, dimensions, refs และ debit=credit ตรง | interface log + BC entries |
| AP2-BC-012 | Accounting scope | Sent G/L advance journal | ตรวจ BC ledgers | ไม่มี Item Ledger/Value Entries ตาม design; หากพบ = Critical | BC ledger evidence |
| AP2-BC-013 | Audit/Security | failed auth/mapping | ตรวจ logs/API/UI/export | ไม่มี secret/token/connection string; มี correlation/support evidence พอ | logs/activity/export |

## 5. AP-3 Functional, UX and workflow cases

| ID | Layer / Risk | Preconditions / Data | Steps | Expected result | Evidence / Source |
|---|---|---|---|---|---|
| AP3-F-001 | E2E · Save incomplete Draft | Requester A | เลือก Brand/AP-2 บางส่วน; เพิ่ม incomplete line; Save | Header/clear/items/WHT commit; status Draft | `ClearAdvanceForm.tsx`; `saveDraft` |
| AP3-F-002 | Regression · Replace children | Draft มี 3 expense + 2 WHT | ลบ/แก้/เรียง; Save/reload | rows ตรง UI ล่าสุด; ไม่มี stale/duplicate; totals คำนวณใหม่ | `persistClear` |
| AP3-F-003 | Recovery · Resume/New/Delete | Draft/Returned มี files/approvals/activity | Resume; New; Delete | Resume ตรง DB; New ไม่ทับ; Delete cleanup ครบ; guard owner/status | routes + `deleteDraft` |
| AP3-F-004 | Integration · Eligible AP-2 list | Approved AP-2 owner/brand; used/rejected/cancelled cases | เปิด dropdown | แสดงเฉพาะ Approved ของ staff/Brand ที่ยังไม่มี active AP-3; rejected/cancelled release | `listPendingAdvances` |
| AP3-N-005 | Security · Crafted AP-2 ID | not Approved, other owner/brand, missing detail | แก้ payload แล้ว Submit | server ปฏิเสธ; AP-3 ยัง Draft; ไม่สร้าง approval/claim | `submitRequest` revalidation |
| AP3-C-006 | Concurrency · Duplicate claim | สอง Draft อ้าง AP-2 เดียว | Submit พร้อมกัน | หนึ่ง Submitted; อีกใบ deterministic conflict; ไม่ active duplicate | lock/duplicate guard |
| AP3-V-007 | Negative · Required fields | ขาด Manager/Brand/AP-2/line/date/GL/amount | Submit ทีละกรณี | ปฏิเสธพร้อม message; Draft ล่าสุดอยู่; ไม่มี partial workflow | client/server validator |
| AP3-V-008 | Finance · Formulas | หลาย lines/decimal boundaries | Save/reload/Submit | totalInclVAT, net, actual, refund และ rounding ตรง UI/DB | calculation helpers/service |
| AP3-V-009 | Boundary · WHT | WHT 100 vs cert 99.98/99.99/100/100.01/100.02 | Submit | ยอมรับเฉพาะ tolerance ที่กำหนด; WHT>0 ต้อง tax ID/payee | validator/WHT table |
| AP3-V-010 | Functional · Refund states | actual 9k/10k/11k vs advance 10k | Submit | positive ต้อง amount/date/proof; zero/negative ไม่บังคับ proof; summary ถูก | validation/calculation |
| AP3-V-011 | Attachment · Required/invalid | no receipt; refund no proof; invalid/oversize | Submit/upload | receipt/proof rules ทำงาน; invalid ถูกปฏิเสธ; ไม่ orphan | file routes/service |
| AP3-I-012 | Transaction · Submit | Valid Draft; fault ระหว่าง lock/header/approval/log | Submit | claim/header/approval/audit commit หรือ rollback ทั้งหมด; ไม่ phantom claim | `submitRequest` |
| AP3-C-013 | Concurrency · Double submit | Draft เดียวในสอง sessions | Submit พร้อมกัน | RequestNo/approval/activity หนึ่งชุด; อีก call conflict | submit guard |
| AP3-F-014 | Workflow · Manager→Account→Head | Submitted | Approve ตามลำดับ; Account ใส่ PV/PPEX/payment date | assignee/current step เท่านั้น; final status/audit/report ถูกต้อง | approval engine/routes |
| AP3-N-015 | Security · Wrong action | wrong user/role/step | Approve/Reject/Return/Cancel | 403/4xx; state ไม่เปลี่ยน | action routes |
| AP3-F-016 | Recovery · Return/resubmit | Returned AP-3 | แก้ lines/files; resubmit | chain ใหม่หนึ่งชุด; totals/snapshot ล่าสุด; self-reference ไม่ block | submit service |
| AP3-F-017 | Lifecycle · Cancel/reject reuse | Submitted AP-3 | Cancel/Reject; เปิด AP-3 ใหม่ | audit/status ถูก; AP-2 กลับมา eligible ตาม rule | pending query/actions |
| AP3-UX-018 | UX · Save/submit feedback | slow save; validation fail หลัง persist | Save/Submit | กัน double action; บอก Draft saved; inline/focus error; ID context ไม่หาย | form component |
| AP3-UX-019 | UX · Mobile grid | mobile widths; many lines | Add/edit/delete/scroll/save | ทุก field/action ใช้ได้; ไม่แก้ผิด row; totals/actions มองเห็น | responsive form |
| AP3-UX-020 | UX/A11y | keyboard/screen reader | กรอกทั้ง form และ trigger errors | labels, focus order, errors และ date inputs accessible | form primitives |
| AP3-R-021 | Report · Accuracy | ทุก status | Filter/view/export | filters, AP-2 ref, totals, WHT, refund, PV/payment ตรง DB; permissions ถูก | report service/routes |
| AP3-R-022 | Phase boundary · No auto-post | Approved AP-3 | ตรวจ network/queue/DB/BC Sandbox | ไม่มี BC call, ERP queue/status, Gen Journal หรือ ledger posting | AP-3 routes/services |
| AP3-R-023 | Manual reconciliation | Approved AP-3 + AP-2 + report | เทียบ advance/actual/refund/WHT/PV/PPEX/manual record | reconcile ได้; outstanding อธิบายได้; refs/audit ครบ | report + finance evidence |
| AP3-S-024 | Security · Direct API access | users หลาย role/brand | GET/PUT/DELETE/action/file/report URL โดยตรง | least privilege; ไม่เห็น/แก้/download ข้ามสิทธิ์ | routes/services |
| AP3-RCV-025 | Recovery · Boundary failures | DB/file/email/report fault injection | Save/Submit/Approve/Upload | DB rollbackถูก; fileไม่ orphan; email recoverable; financial stateไม่ย้อนผิด | services/email/file |

## 6. Cross-form regression cases

| ID | Risk | Steps | Expected result | Evidence |
|---|---|---|---|---|
| X-001 | Traceability | Approved AP-2 → สร้าง AP-3 | AP-3 snapshotเลขที่/ยอดจาก server ไม่เชื่อ client | DB + API payload |
| X-002 | Source change | หลัง AP-3 Draft เปลี่ยน AP-2 status/amount | Submit revalidate status/owner/brand; snapshot policyตรง business decision | AP-2/AP-3 rows |
| X-003 | Duplicate lifecycle | AP-3 Submitted/Approved/Returned/Rejected/Cancelled | AP-2 eligibility ถูกต้องทุก status; ไม่ concurrent duplicate | pending query + DB |
| X-004 | Audit trail | Save→Submit→Return→Resubmit→Approve/Reject/Cancel→ERP | actor/time/action/note/document refs ครบและเรียงได้ | `AccActivityLog` + interfaces |
| X-005 | No. Series | Submit AP-2/AP-3 พร้อมกันจำนวนมาก | RequestNo ไม่ซ้ำ; rollback ไม่ duplicate; gap policyยอมรับแล้ว | sequences/headers |
| X-006 | DB rollback | fault ระหว่าง header/detail/approval/file cleanup | ไม่มี partial rows และยอด header/detailตรง | before/after queries |
| X-007 | UX parity | เทียบ Save/picker/toast/validation/date/attachments/actions | ความต่างเหลือเฉพาะ business rule; interaction contractสม่ำเสมอ | screenshots/E2E |

## 7. Execution evidence

ยังไม่มี test case ใดถูก execute ในเอกสารฉบับนี้ จึงยังไม่มี actual screenshots, API captures, DB before/after หรือ BC evidence.

Source areas reviewed:

- `src/features/advance/*`
- `src/lib/adv/*`
- `src/app/api/request/advance/*`
- `src/features/clear-advance/*`
- `src/lib/clr/*`
- `src/app/api/request/clear-advance/*`
- `src/lib/acc/advance-erp-*`
- AP-2/AP-3 migrations และ UX QA report

## 8. Coverage gaps and residual risks

- Browser E2E ยังไม่ถูกรัน
- Concurrency/fault injection ยังไม่ถูกรัน
- AP-2 BC Sandbox send/reconciliation ยังไม่ถูกรัน
- Mobile device และ accessibility automation ยังไม่ถูกรัน
- AP-3 PDF attachment policy และ manual journal procedure ต้องได้รับ Accounting sign-off
- Production schema/data/API ไม่ได้ใช้ในการทดสอบนี้

## 9. Release recommendation

**FAIL — NOT READY TO CERTIFY**

เหตุผล: ทุก test case ยังเป็น `NOT RUN`. ก่อนพิจารณา release ต้องผ่านอย่างน้อย:

1. P0/P1 UX regression gates
2. Save/resume/delete/submit transaction tests
3. AP-2/AP-3 concurrency and duplicate tests
4. Ownership/permission tests
5. AP-2 BC timeout/retry/idempotency/reconciliation
6. AP-3 Phase 1 no-auto-post and manual report reconciliation

