# AP-3 Phase 2 — ERP posting of the clearing journal

**Date:** 2026-08-22
**Status:** Design (approved in brainstorming; pending spec review)
**Form:** AP-3 (เคลียร์คืนเงินทดรองจ่าย / Clear Advance) — see `project_ap3_clear_advance`
**Depends on:** AP-2 ERP rail (`src/lib/adv/…`), shared BC PPAP CU, `Rocks_ERP_Data`

---

## 1. Goal

Phase 1 records the clearing (expenses + refund) but does **not** post to Business Central — an accountant keys the journal manually. Phase 2 posts the **clearing journal** to BC automatically, via the same manual queue + preview rail AP-2 uses, keeping AP-3's isolated `clr/` namespace.

Scope this phase: settings (VAT/WHT accounts) + payload builder + preview + send + status, **UAT-gated** (posts to BC Sandbox only; Prod enabled later after accountant sign-off).

---

## 2. Confirmed decisions (from brainstorming)

| # | Decision |
|---|---|
| Trigger/flow | **Manual queue + preview**, mirror AP-2 (no auto-post on approval) |
| Journal structure | Standard clearing entry (section 4) — user-confirmed |
| VAT-input & WHT-payable accounts | **New** per-brand config in AP-3 Interface ERP settings, from `Rocks_ERP_Data.ErpAccounts` (GL, by Company) |
| Advance-clearing GL + Bank | **Inherit** from AP-2 config of the cleared Company |
| Rail | **Reuse full AP-2 rail** — shared `postBcPpapJournalCreateFromJson` CU + `AccRequest.ErpInterface*` status columns + `ErpDocumentNo` (idempotent, drift guard) |
| Code structure | **Mirror in `clr/` namespace** (do not touch AP-2 code) |
| Rollout | Full build, **UAT-gated**; Prod posting after sign-off |
| postingDate | `refundTransferDate ?? paymentDate ?? sendDate` |
| documentType | `"Payment"` |
| Batching | **1 AP-3 request = 1 BC document** (self-contained clearing; differs from AP-2's per-Company batch — intentional) |
| ACCOUNT-step edit | **New:** the accountant edits/corrects the clearing data at the ACCOUNT step before it goes to the Head Accountant; the posted journal reflects those edits (section 6) |

---

## 3. Architecture / components

All new, under the AP-3 `clr/` namespace; reuse shared BC + status:

- **`src/lib/clr/clear-advance-erp-context.ts`** — resolve per-request ERP config:
  - advance-clearing GL + Bank — inherit from AP-2's `AccAdvanceInterfaceConfig` / AP-1 shared, for the cleared Company (via `interfaceTarget`)
  - Journal Batch — AP-3's own (`AccClearAdvanceInterfaceConfig`)
  - VAT-input GL + WHT-payable GL — AP-3's own (new columns, section 5)
  - ERP department code — resolved from HR / fixed, same helper AP-2 uses
  - resolve target Company + BC connection + environment (Sandbox/Prod)
- **`src/lib/clr/clear-advance-erp-payload.ts`** — `buildClrJournalPayload(req, clear, config, deptCode)` → PPAP payload (section 4)
- **`src/lib/clr/clear-advance-erp-send.ts`**:
  - `previewClrErpJournal(ids)` → per-item lines (for the preview modal; per-item try/catch)
  - `sendClrErpBatch(ids, userId)` → post each request as its own BC document; idempotent; drift guard; stamp status + activity log
- **Routes** (admin-gated): `GET /api/request/clear-advance/erp/preview?ids=…`, `POST /api/request/clear-advance/erp/send`
- **UI**: AP-3 admin **Interface ERP queue** page — lists `Approved` + not-yet-`Sent`, preview modal, send button, status/Doc No. column (mirror AP-2's Interface tab)

---

## 4. Clearing journal → BC lines

One AP-3 request = one PPAP payload = one BC document. Group `G1`, `documentType: "Payment"`, `postingDate = refundTransferDate ?? paymentDate ?? sendDate`, External Document No. = ADC no. (carried in `employeeCode`, per the CU).

Given advance amount `A` (วงเงิน) and net actual `actualTotal`:

| Line | accountType | accountNo | amount (signed) | notes |
|---|---|---|---|---|
| per expense item | G/L Account | `item.glAccountNo` (AP-3.2 / forced GL) | **+ amountBeforeVat** (Dr) | dims: branch = `item.branchCode`, dept = resolved |
| VAT input (if Σvat > 0) | G/L Account | VAT-input GL (config) | **+ ΣvatAmount** (Dr) | one aggregate line |
| WHT payable (if Σwht > 0) | G/L Account | WHT-payable GL (config) | **− ΣwhtAmount** (Cr) | one aggregate line |
| advance clearing | G/L Account | advance GL (inherit AP-2) | **− A** (Cr) | clears the advance |
| bank difference (if ≠ 0) | Bank Account | bank (inherit AP-2) | refund>0 → **+refund** (Dr, in); pay-extra → **−extra** (Cr, out) | omitted when A == actualTotal |

**Balance proof:** debits = Σbefore + Σvat; credits = Σwht + A + bankDiff. Since Σ(before+vat) − Σwht = actualTotal, bankDiff = actualTotal − A = −refundToCompany. Refund (A>actualTotal) → Dr Bank; pay-extra (actualTotal>A) → Cr Bank. Always balances.

Amounts follow the AP-2 sign convention (`amount > 0` = debit, `< 0` = credit); `assertBcJournalCreated` treats `Failed: 0` as the only success.

---

## 5. Config additions

- **Migration 103** (`103_clr_erp_vat_wht_accounts.sql`, idempotent, UAT + Prod): add to `AccClearAdvanceInterfaceConfig`:
  - `VatInputGlAccountNo NVARCHAR(20) NULL`
  - `WhtPayableGlAccountNo NVARCHAR(20) NULL`
- **AP-3 Interface ERP settings card**: add two `SearchableSelect` dropdowns (VAT input GL, WHT payable GL) reading `Rocks_ERP_Data.ErpAccounts` (Category='GL', active, not blocked) by the card's Company — reuse the existing `listClrErpGlOptions` pattern + a GL-options endpoint.
- `listClrInterfaceConfigView` + save (`writeBothPools`) extended for the two fields. `ready` flag stays as-is (Journal Batch + BC profile); VAT/WHT are only required when a request actually has VAT/WHT (validated at preview/send, not on the config card).

---

## 6. ACCOUNT-step edit (new capability)

Approval flow is unchanged in order (**Manager → Account → Head**), but the **Account** step gains an edit capability so the accountant corrects the clearing before the Head sees it and before it posts.

- While `Status='Submitted'` **and** `currentStepCode='ACCOUNT'`, the assigned Account approver (or an admin) can **edit the clearing data**: expense items (date/docNo/GL/description/branch/before-VAT/VAT/WHT), WHT certificate rows, `PvDocNo`, `PaymentDate`, refund fields.
- New endpoint `PUT /api/request/clear-advance/requests/[id]/account-edit` (or reuse `saveDraft` with a status/step/role guard) — writes the same `AccClearAdvance*` tables; **rejects** if not at the ACCOUNT step or actor lacks the ACCOUNT role. Recomputes actualTotal/refund server-side.
- On **Account approve** → moves to **Head** with the edited data. The Head reviews read-only (approve / reject / return). If the Head returns, it goes back to Account for another edit pass.
- On **Head approve** → `Approved` → eligible for the **Interface ERP** queue. The posted journal (section 4) is built from the final, Account-edited data.
- The AP-3 form/detail component renders editable at the ACCOUNT step for the authorized actor (reuse `ClearAdvanceForm` in an "account-edit" mode), read-only otherwise.

---

## 7. Send flow & status

- **Queue source:** AP-3 `FormCode='AP-3'`, `Status='Approved'`, `ErpInterfaceStatus` ≠ `Sent`.
- **Flow:** select → **preview journal** (per-request lines) → confirm send → CU posts each request as one document → stamp `ErpInterfaceStatus='Sent'`, `ErpDocumentNo`, `ErpInterfaceEnvironment`, `ErpInterfaceSentAt/By` + activity log.
- **Idempotency:** `Sent` → refuse re-send; `Pending` → in flight; drift guard (id set frozen at confirm) → 409, reload.
- **UAT gate:** send permitted only when the resolved target environment = Sandbox until Prod is explicitly enabled (env flag / setup), same gating AP-3 already uses for form visibility.

---

## 8. Error handling & edge cases

- Incomplete config (missing advance GL / Bank / Journal Batch / VAT GL when VAT present / WHT GL when WHT present) → friendly per-request error at preview and send; never posts a partial journal.
- BC returns HTTP 200 with `Failed > 0` or `status:error` → `assertBcJournalCreated` throws → status `Failed` + error stored; re-sendable.
- Zero-difference (A == actualTotal) → no bank line.
- Foreign-currency advance: `A` uses the THB base amount already stored on AP-3 (same rule as the form's วงเงิน).
- Re-open after send: out of scope (no un-send in this phase; corrections handled before posting via the ACCOUNT-step edit).

---

## 9. Testing

- **Unit** (`clear-advance-erp-payload`): balance + line shape across 3 cases (refund=0 / refund>0 / pay-extra) × (no VAT/WHT, VAT only, WHT only, VAT+WHT).
- **Integration:** config resolution (inherit advance GL/bank from AP-2; VAT/WHT from AP-3 config); idempotency (Sent→refuse); ACCOUNT-edit guard (wrong step/role rejected).
- **E2E UAT:** create → submit → Manager → **Account edits** → Head → Approved → preview → send → verify BC Sandbox document created, `ErpInterfaceStatus=Sent` + `ErpDocumentNo`, Control report reconciles.

---

## 10. Out of scope

- No changes to AP-2 code.
- No Prod posting until accountant sign-off (build ships UAT-gated).
- No auto-post (manual queue only).
- No un-send / reversal of a posted clearing (future phase).
