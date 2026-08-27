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

## Feature B — Employee bank account (live, always fresh)

Source of truth: `Rocks_Portal_HR.dbo.Employee.BankAccountNo`. There is no bank
name/code in HR, so only the account number is pulled; `payeeBankCode` stays null
for employee payees.

**Resolution model: live, not stored.** For employee payees the bank account is
**resolved fresh from HR on every read** (form load and advance read), never
snapshotted into `AccAdvance`. So an HR change is reflected on existing advances
too. This is safe for performance because we `SELECT` only `BankAccountNo` (a tiny
nvarchar) keyed by the indexed `StaffId` on a ~1.1k-row table — the known HR
slowness was solely the multi-MB base64 `PhotoUrl` column ([[project_formportal_photo_perf]]),
which we never select here. No DB write, no migration.

### B1. Surface `bankAccountNo` in HR lookups

Add `bankAccountNo: string | null` (`SELECT … BankAccountNo`, **never** PhotoUrl)
to the employee lookup rows used by the advance flow:
- `src/lib/hr/employee-lookup.ts` — `findActiveEmployeeByEmail` and
  `listDepartmentColleagues` (self + on-behalf colleagues).
- The advance requesters endpoint (`/api/request/advance/requesters`) and
  `/api/me/employee` include `bankAccountNo` in their employee/colleague payloads.

### B2. `AdvanceForm` shows it live (create/edit)

- Track the resolved requester's `bankAccountNo` (self from `/me/employee`, or the
  selected on-behalf colleague from the requesters list — both now carry it).
- When `payeeType === "employee"`, the note becomes:
  "โอนเข้าบัญชีของผู้ขอเบิก (<name>) · เลขบัญชี <bankAccountNo | "— ไม่พบใน HR">".
- **Do not** write it into the payload: `payeeBankAccount`/`payeeBankCode` stay
  `null` for employee payees on save (unchanged), because the value is resolved
  live at read time (B3).

### B3. Advance read overlays the live value (view/preview)

In the advance read service (`getAdvanceRequest` in
`src/lib/adv/advance-request-service.ts`), when the advance's `payeeType ===
"employee"`, `LEFT JOIN Employee ON Employee.StaffId = <requester staffId>` and set
the returned `advance.payeeBankAccount` to `Employee.BankAccountNo` (select only
that column). Because `AdvanceDetailPanel` and the full page already render
`adv.payeeBankAccount` under "เลขบัญชี", both show the live employee account with
no further UI change.

No new validation (employee bank account is informational; absence shows a hint,
does not block submit).

---

## Data flow

- **A:** panel `data` → `AdvanceVendorPicker` (match/options/confirm) → approve
  endpoint → `onChanged` reloads queue.
- **B (create/edit):** HR `Employee.BankAccountNo` → lookup services → form note.
- **B (view/preview):** advance read `LEFT JOIN Employee` by requester StaffId →
  overlay onto `advance.payeeBankAccount` (employee payees only) → shown in
  panel/full page. Always current; nothing stored.

## Error handling

- Reuse existing endpoint errors + `toast`. Approve failures keep the panel open.
- Missing employee bank account → hint text only, never blocks.
- No vendor selected at ACC_OFFICER approve → toast "กรุณาเลือก Vendor" (same as full page).

## Testing

- Extract-and-reuse of `AdvanceVendorPicker` must not change full-page behavior
  (manual E2E: full page ACC_OFFICER match + approve still works).
- Employee bank live-resolve: verify a live join returns the account for an
  employee-payee advance and that `SELECT` avoids the PhotoUrl column (perf).
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
- Edit: `src/lib/hr/employee-lookup.ts` (+`bankAccountNo`, never PhotoUrl)
- Edit: advance requesters route + `/api/me/employee` shape (+`bankAccountNo`)
- Edit: `src/features/advance/components/AdvanceForm.tsx` (show live employee bank account in the note)
- Edit: `src/lib/adv/advance-request-service.ts` (`getAdvanceRequest` live-overlays employee bank account)
