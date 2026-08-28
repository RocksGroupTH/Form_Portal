# AP-3: clear the advance against the Vendor, not the G/L

**Date:** 2026-08-28
**Branch:** `feat/ap3-clear-vendor`
**Status:** Design approved (pending spec review)

## Goal

AP-2 now debits a **Vendor** (`accountType: "Vendor"`, `accountNo = AccAdvance.MatchedVendorNo`) instead of a G/L advance account. AP-3's clearing journal still credits the **G/L** advance account, so the vendor's balance is never cleared and the two forms no longer reverse each other.

Change AP-3's advance-reversal line to **credit the same Vendor** the AP-2 it clears debited.

Out of scope: AP-1, AP-2, the expense/VAT/WHT/bank lines, any DB migration, any AL/BC change.

---

## Current state (verified 2026-08-28 on `master` @ de1f903)

- `clear-advance-erp-payload.ts:70` pushes `glLine(c.advanceGlAccountNo, -advanceAmount, null)` — a **G/L Account** credit.
- `clear-advance-erp-context.ts:30,36` inherits that account from AP-2: `ap2.config.glAccountNo`, and throws when it is missing.
- AP-2 no longer maintains that value: its Interface settings, save path, send-ready gate and payload guard all dropped G/L when the Dr moved to Vendor. The rows survive in `AccBrandGlAccount` (`FormCode='AP-2'`, `610116001`, `IsActive=0`), so AP-3 still resolves a **frozen legacy value nobody updates**. This coupling is what the change removes.
- `AccClearAdvance.AdvanceRequestId` already links an AP-3 to the AP-2 it clears, and `req.clear.advanceRequestId` is in hand at both payload call sites (`clear-advance-erp-send.ts:210` preview, `:329` send). **No schema change is needed.**
- `PpapJournalLinePayload` has **no applies-to field**; CU 50263 cannot apply the credit to the original PV document.

**Data (queried, both databases):**
- **Production has zero AP-2 requests** — the form has never been used there, so no legacy exposure.
- UAT: 5 approved advances carry a matched vendor; 3 approved-and-uncleared ones do not (`900037`, `900059`, `900064`) — test rows predating the vendor feature.
- Every advance approved from now on carries a confirmed vendor: the ACC_OFFICER step refuses to approve without `VendorMatchStatus='confirmed'`.

---

## Design

### Journal shape

Only the advance-reversal line changes. Amounts are untouched, so the payload still sums to zero.

| Line | Before | After |
|---|---|---|
| Expense (per item) | Dr G/L | unchanged |
| VAT input | Dr G/L | unchanged |
| WHT payable | Cr G/L | unchanged |
| **Advance reversal** | **Cr G/L `advanceGlAccountNo`** | **Cr Vendor `advanceVendorNo`** |
| Bank difference | Dr/Cr Bank | unchanged |

The vendor line mirrors AP-2's proven shape: `accountType: "Vendor"`, `accountNo` = the matched vendor, and **no `balAccountType`** — the two-explicit-lines form that BC Sandbox accepted for AP-2 (document PVA2608-0012). The `glLine` helper sets `balAccountType: "G/L Account"`, so the vendor line is built separately rather than through it.

### 1. `clear-advance-erp-context.ts`

- Signature gains the AP-2 request id: `loadClearAdvanceErpContext(brandCode, hrDeptCode, advanceRequestId)`.
- Reads `AccAdvance.MatchedVendorNo` for that `RequestId` and returns it as `config.advanceVendorNo`.
- **Drops** `advanceGlAccountNo` from the returned config and drops the `ap2.config.glAccountNo` guard. Bank / target Company / ERP dept keep coming from `loadAdvanceErpContext` (unchanged).
- Throws when the vendor is missing or blank:
  `ยังไม่ได้เลือก Vendor ในใบเบิก AP-2 ที่เคลียร์ใบนี้ — เปิดใบ AP-2 แล้วเลือก Vendor ก่อนส่ง`
  Throws when `advanceRequestId` is null (an AP-3 not linked to an AP-2 cannot be posted):
  `ใบเคลียร์นี้ไม่ได้ผูกกับใบเบิก AP-2 — ส่ง ERP ไม่ได้`

### 2. `clear-advance-erp-payload.ts`

- `ClrJournalConfig.advanceGlAccountNo: string` → `advanceVendorNo: string`.
- The guard message becomes the vendor one (same text as above).
- Line 70 becomes a vendor credit:
  ```ts
  lines.push({
    groupNo: "G1", postingDate, documentType: "Payment",
    accountType: "Vendor", accountNo: c.advanceVendorNo,
    description: `เคลียร์เงินทดรองจ่าย ${requestNo}`.slice(0, 100),
    paymentMethodCode: "BANK", amount: -r2(input.advanceAmount),
    employeeCode, branchCode: defaultBranch, departmentCode,
  });
  ```

### 3. `clear-advance-erp-send.ts`

Both call sites pass the id through: `loadClearAdvanceErpContext(req.brandCode, req.requesterDepartmentCode, req.clear.advanceRequestId)`. Nothing else changes — the pre-flight/two-phase guards already treat a context throw as a refusal that never stamps `Failed`.

### Blocking, not falling back

An AP-2 without a matched vendor **cannot be cleared to ERP**; the send is refused with the message above. Chosen over a G/L fallback because Production carries no such rows, the ACC_OFFICER gate guarantees a vendor on every new advance, and a fallback would keep the dead `advanceGlAccountNo` config alive permanently for three UAT test rows. Those three can be cleared by setting a vendor on the AP-2 first.

---

## Error handling

Every failure is a pre-flight context/payload throw, surfaced in the AP-3 ERP queue and preview as a refusal. The request keeps its current status; nothing is stamped `Failed` and nothing is sent to BC. No partial journal can be produced, because the throw happens before the payload is built.

## Testing

- Unit (`clear-advance-erp-payload.test.ts`, existing file): the advance-reversal line is `accountType: "Vendor"` with the configured vendor no, `amount = -advanceAmount`, and no `balAccountType`; the lines still sum to zero across the VAT/WHT/refund and top-up cases already covered; a blank `advanceVendorNo` throws.
- `npm run typecheck` and `npm test` must pass. **Do not run `npm run build`** — it shares `.next` with the running dev server.
- Manual: preview one UAT AP-3 whose AP-2 has a vendor and confirm the credit line shows the vendor and the journal balances; preview one of `900037` / `900059` / `900064` and confirm it is refused with the vendor message.

## Files

- Modify: `src/lib/clr/clear-advance-erp-context.ts`
- Modify: `src/lib/clr/clear-advance-erp-payload.ts`
- Modify: `src/lib/clr/clear-advance-erp-send.ts` (two call sites)
- Modify: `src/lib/clr/clear-advance-erp-payload.test.ts`

## Follow-ups (not this change)

- Applying the credit to the original PV in BC needs an `appliesToDocNo` on the CU 50263 payload — an AL change, tracked separately. Until then the vendor nets to zero and accounting applies the entries in BC.
- `AccBrandGlAccount` rows with `FormCode='AP-2'` become unused once this ships; leaving them is harmless, deleting them is a separate cleanup.
