# AP-2: Vendor picker in the approval preview panel + employee bank auto-fill

**Date:** 2026-08-27
**Branch:** `feat/erp-vendors-sync`
**Status:** Design approved (pending spec review)

## Goal

Two AP-2 (advance) improvements:

1. **Feature A — Vendor + approve in the preview drawer.** In the *รออนุมัติ*
   approval queue (`AdvanceApproveQueue`, the ACC_OFFICER step before Interface),
   let the officer pick the Vendor, see the Match/Unmatch status, and approve —
   directly in the side preview drawer (`AdvanceDetailPanel`), without opening the
   full `/request/advance/[id]` page.

2. **Feature B — Employee bank account auto-fill.** When an advance's payee is an
   employee (โอนให้ = พนักงาน), pull the requester employee's bank account number
   from HR and store/show it (today it is dropped to `null`).

Out of scope: AP-1, `AdvanceErpQueue` (รอส่ง — already has its own vendor select),
WHT, any new BC/ERP endpoint, any DB migration.

---

## Current state (verified)

- `AdvanceApproveQueue` lists ACC_OFFICER/earlier steps; each row's 👁 opens the
  shared, **read-only** `AdvanceDetailPanel` (info · attachments · approval
  history · "เปิดใบเต็ม"). No vendor UI. Approval is bulk via "อนุมัติที่เลือก".
- The full page `request/advance/[id]/page.tsx` already implements, at ACC_OFFICER:
  auto AI match (`POST /api/request/advance/vendor-match/[id]`), a vendor
  `SearchableSelect` (`GET /api/request/advance/vendors?company=<interfaceCompany>`),
  a Match/Unmatch badge, confirm-on-select (`POST /api/request/advance/vendor-confirm`),
  a payment-date picker (`GET /api/request/advance/payment-dates`), and a
  "ดำเนินการ" button that confirms the vendor then `POST /requests/[id]/approve`.
- `AdvanceDetailPanel` fetches the full `AdvanceRequest` (`data`), which includes
  `currentStepCode`, `status`, `brandCode`, and `advance.*`.
- `AdvanceForm`: for `payeeType === "employee"` it shows only a note and sets
  `payeeBankAccount`/`payeeBankCode` to `null` on save (lines ~297, ~639, ~680).
- HR `Rocks_Portal_HR.dbo.Employee` has **`BankAccountNo`** (nvarchar, populated),
  and **no** bank-name/code column. It is not surfaced by the HR lookup services.

---

## Feature A — Vendor + approve in `AdvanceDetailPanel`

### A1. Extract a shared `AdvanceVendorPicker` component

New: `src/features/advance/components/AdvanceVendorPicker.tsx`.

Encapsulates the ACC_OFFICER vendor UX so the full page and the panel share one
implementation (no logic drift):

Props:
```ts
interface AdvanceVendorPickerProps {
  requestId: number;
  company: string;            // request.brandCode (resolved to interface company server-side)
  compact?: boolean;          // true in the drawer → inline spinner, not full-screen popup
  onConfirmed?: (vendorNo: string) => void;
}
```

Behavior (moved verbatim from the full page):
- On mount: `GET /api/request/advance/vendors?company=<company>` for options and
  `POST /api/request/advance/vendor-match/<requestId>` for the AI suggestion; set
  `selectedVendor` from the suggestion if not already set.
- `SearchableSelect` (name + code searchable). On select → `POST /vendor-confirm`
  `{ id, vendorNo }`; on success mark status confirmed + toast + `onConfirmed(v)`.
- Match/Unmatch badge: `● Match` (green) when a vendor is selected, else
  `● Unmatch` (red). `title` = match reason.
- While matching: `compact` → small inline spinner + "AI กำลังจับคู่ Vendor…";
  non-compact → existing `TravelExpenseLoadingPopup` (full page keeps current look).

`request/advance/[id]/page.tsx` is refactored to render `<AdvanceVendorPicker
compact={false} …>` in its ACC_OFFICER block, replacing the inline copy. Approve
logic (`handleApprove`) stays on the page; it reads the confirmed vendor via
`onConfirmed`/local state. No behavior change for the full page.

### A2. `AdvanceDetailPanel` gains a context-aware action footer

`AdvanceDetailPanel` already has `data` (the `AdvanceRequest`). Add:

- New prop `onChanged?: () => void` (queue reload after approve).
- **Vendor section** (body, above the footer) shown only when
  `data.status === "Submitted" && data.currentStepCode === "ACC_OFFICER"`:
  render `<AdvanceVendorPicker requestId={requestId} company={data.brandCode}
  compact onConfirmed={setPanelVendor} />`.
- **Approve footer** shown when `data.status === "Submitted"` and a
  `currentStepCode` exists (i.e. the viewer is at an approval step):
  - ACC_OFFICER: payment-date picker (`GET /payment-dates`) + **"ดำเนินการ"**.
    On click: if no vendor selected → toast error; else confirm vendor
    (idempotent `POST /vendor-confirm`) then `POST /requests/[id]/approve`
    `{ paymentDate }`.
  - Earlier step (HEAD_ACC/DIRECTOR): **"อนุมัติ"** → `POST /requests/[id]/approve`.
  - On success: toast, `onChanged?.()`, `onClose()`.
  - Keep "เปิดใบเต็ม" as a secondary link.
- Server remains the source of truth for authorization; the panel does not
  reimplement any gate (approve endpoint already enforces role + confirmed-vendor).

`AdvanceApproveQueue` passes `onChanged={load}` to the panel. `AdvanceErpQueue`
passes nothing new (its rows are past approval; `currentStepCode` won't be an
approval step there, so the vendor/approve UI stays hidden — the panel remains
read-only for it, unchanged).

### A3. Reject/return

The full page's ACC_OFFICER view has no reject/return (only ดำเนินการ); earlier
steps do. To keep the panel focused and avoid a reason-box in a small drawer, the
panel offers **approve only**. Reject/return stay on the full page ("เปิดใบเต็ม").
(Matches today's queue, which is approve-only too.)

---

## Feature B — Employee bank account auto-fill

Source of truth: `Rocks_Portal_HR.dbo.Employee.BankAccountNo`. There is no bank
name/code in HR, so only the account number is pulled; `payeeBankCode` stays null
for employee payees.

### B1. Surface `bankAccountNo` in HR lookups

Add `bankAccountNo: string | null` (`SELECT … BankAccountNo`) to the employee
lookup rows used by the advance flow:
- `src/lib/hr/employee-lookup.ts` — `findActiveEmployeeByEmail` and
  `listDepartmentColleagues` (self + on-behalf colleagues).
- The advance requesters endpoint (`/api/request/advance/requesters`) and
  `/api/me/employee` include `bankAccountNo` in their employee/colleague payloads.

Only add the column to the SELECT and the returned shape; do not change the
existing photo/perf handling.

### B2. `AdvanceForm` fills + stores it

- Track the resolved requester's `bankAccountNo` (self from `/me/employee`, or the
  selected on-behalf colleague from the requesters list).
- When `payeeType === "employee"`: the note becomes
  "โอนเข้าบัญชีของผู้ขอเบิก (<name>) · เลขบัญชี <bankAccountNo | "— ไม่พบใน HR">".
- On save: `payeeBankAccount = payeeType === "vendor" ? payeeBankAccount
  : payeeType === "employee" ? (resolvedEmployeeBankAccountNo || null) : null`.
  `payeeBankCode` stays null for employee. (Snapshot at submit time is correct for
  a payment record.)
- `AdvanceDetailPanel` already renders `adv.payeeBankAccount` under "เลขบัญชี", so
  it will show for employee payees automatically once stored.

No new validation (employee bank account is informational; absence shows a hint,
does not block submit).

---

## Data flow

- **A:** panel `data` → `AdvanceVendorPicker` (match/options/confirm) → approve
  endpoint → `onChanged` reloads queue.
- **B:** HR `Employee.BankAccountNo` → lookup services → form state → `payeeBankAccount`
  on the advance → shown in panel/preview.

## Error handling

- Reuse existing endpoint errors + `toast`. Approve failures keep the panel open.
- Missing employee bank account → hint text only, never blocks.
- No vendor selected at ACC_OFFICER approve → toast "กรุณาเลือก Vendor" (same as full page).

## Testing

- Extract-and-reuse of `AdvanceVendorPicker` must not change full-page behavior
  (manual E2E: full page ACC_OFFICER match + approve still works).
- Employee bank auto-fill: unit-test the payload rule (employee → account from HR;
  vendor → typed account; neither → null) where the pure mapping is testable.
- Manual E2E via the approve queue: open drawer at ACC_OFFICER → AI match →
  pick/confirm vendor → status badge → pick payment date → ดำเนินการ → queue
  refreshes; and create an employee-payee advance → bank account shows in preview.
- `npm run typecheck` + `npm test` only. Do **not** run `npm run build` against the
  live dev workspace (shares `.next` with the running dev server).

## Files

- New: `src/features/advance/components/AdvanceVendorPicker.tsx`
- Edit: `src/app/(dashboard)/request/advance/[id]/page.tsx` (use the shared picker)
- Edit: `src/features/advance/components/AdvanceDetailPanel.tsx` (vendor section + approve footer + `onChanged`)
- Edit: `src/features/advance/components/AdvanceApproveQueue.tsx` (pass `onChanged`)
- Edit: `src/lib/hr/employee-lookup.ts` (+`bankAccountNo`)
- Edit: advance requesters route + `/api/me/employee` shape (+`bankAccountNo`)
- Edit: `src/features/advance/components/AdvanceForm.tsx` (fill + store employee bank account)
