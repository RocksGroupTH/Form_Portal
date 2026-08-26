# AP-2 Preview Vendor Picker + Employee Bank — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let the ACC_OFFICER pick the Vendor, see Match/Unmatch, and approve inside the `AdvanceDetailPanel` preview (approval queue) without opening the full page; and show the employee's HR bank account (live) when the advance payee is an employee.

**Architecture:** Extract the existing full-page ACC_OFFICER vendor UX into a shared `AdvanceVendorPicker`; reuse it in both the full page and the preview drawer, and give the drawer an approve footer. For the employee bank account, surface `Employee.BankAccountNo` in the HR lookups (form display) and live-overlay it onto `advance.payeeBankAccount` in the advance read (preview/full display) — nothing stored.

**Tech Stack:** Next.js 15 App Router, TypeScript, mssql (T-SQL), `SearchableSelect`, existing advance endpoints. Verify with `npm run typecheck` + `npm test`. **Do NOT run `npm run build`** (shares `.next` with the running dev server).

**Spec:** `docs/superpowers/specs/2026-08-27-ap2-preview-vendor-and-employee-bank.md`

---

## File Structure

- `src/lib/hr/types.ts` — add `bankAccountNo` to `EmployeeContext`.
- `src/lib/hr/employee-lookup.ts` — select `BankAccountNo` in employee + colleague queries; map it (`EmployeeContext`, `DepartmentColleague`).
- `src/lib/adv/advance-request-service.ts` — `getRequest` live-overlays employee bank account.
- `src/features/advance/components/AdvanceForm.tsx` — show the live employee bank account in the note.
- `src/features/advance/components/AdvanceVendorPicker.tsx` — NEW shared vendor picker (match + select + badge).
- `src/app/(dashboard)/request/advance/[id]/page.tsx` — use the shared picker.
- `src/features/advance/components/AdvanceDetailPanel.tsx` — vendor section + approve footer + `onChanged`.
- `src/features/advance/components/AdvanceApproveQueue.tsx` — pass `onChanged`.

Two independent slices: **B (employee bank, Tasks 1–3)** and **A (vendor-in-panel, Tasks 4–7)**. Each is shippable on its own.

---

## Task 1: Surface `bankAccountNo` in HR lookups

**Files:**
- Modify: `src/lib/hr/types.ts`
- Modify: `src/lib/hr/employee-lookup.ts`

- [ ] **Step 1: Add the field to `EmployeeContext`**

In `src/lib/hr/types.ts`, add to the `EmployeeContext` interface (near `email`/`phone`):

```ts
  bankAccountNo: string | null;
```

- [ ] **Step 2: Add `bankAccountNo` to `DepartmentColleague` + `ColleagueRow`**

In `src/lib/hr/employee-lookup.ts`, add to `DepartmentColleague` (after `email`):

```ts
  bankAccountNo: string | null;
```

Add to `ColleagueRow` (after `EmailCompBr`):

```ts
  BankAccountNo: string | null;
```

Add to `EmployeeRow` (after `Email`):

```ts
  BankAccountNo: string | null;
```

- [ ] **Step 3: Map the field in `rowToEmployee` and `mapColleagueRow`**

In `rowToEmployee` (after `email: row.Email,`):

```ts
    bankAccountNo: row.BankAccountNo ?? null,
```

In `mapColleagueRow` (after `email: row.Email ?? row.EmailCompBr ?? null,`):

```ts
    bankAccountNo: row.BankAccountNo ?? null,
```

- [ ] **Step 4: Select `e.BankAccountNo` in every employee/colleague query**

Add `e.BankAccountNo,` to the SELECT column list in these five queries (place it right after the `e.Email`/`e.EmailCompBr` columns; **never** add `PhotoUrl`):
1. `findActiveEmployeeByEmail` (after `e.Email,` — note this query also selects `e.EmailCompBr,`)
2. `findActiveEmployeeByStaffId` (after `e.Email, e.EmailCompBr,`)
3. `listDepartmentColleagues` (after `e.Email, e.EmailCompBr,`)
4. `findColleagueByStaffId` (after `e.Email, e.EmailCompBr,`)
5. `searchActiveEmployees` (after `e.Email, e.EmailCompBr,`)

Example (query 3, the `listDepartmentColleagues` SELECT head):

```sql
      SELECT
        e.StaffId, e.FullName, e.FirstName, e.LastName, e.Nickname, e.Position,
        e.DepartmentId, d.Name AS DepartmentName,
        e.Email, e.EmailCompBr, e.BankAccountNo,
        mgr.StaffId AS MgrStaffId, mgr.FullName AS MgrFullName,
```

Do NOT add `BankAccountNo` to `listActiveManagersByStaffIds` (managers don't need it).

- [ ] **Step 5: Verify types compile**

Run: `npm run typecheck`
Expected: no errors. (`ColleagueManager` has no `bankAccountNo`; only `EmployeeContext` and `DepartmentColleague` gained it.)

- [ ] **Step 6: Verify existing tests still pass**

Run: `npm test`
Expected: all pass (no behavior change yet).

- [ ] **Step 7: Commit**

```bash
git add src/lib/hr/types.ts src/lib/hr/employee-lookup.ts
git commit -m "feat(hr): surface Employee.BankAccountNo in employee + colleague lookups"
```

---

## Task 2: Live-overlay the employee bank account in the advance read

**Files:**
- Modify: `src/lib/adv/advance-request-service.ts` (`getRequest`, ~line 116)

The advance read (`getRequest`) is what `/api/request/advance/requests/[id]` returns
(used by the panel and the full page). For an employee payee, overlay the current HR
`BankAccountNo` onto `advance.payeeBankAccount`. `req.staffId` is the requester's
StaffId; `hrEmployeeTable()` is already imported/used in this file.

- [ ] **Step 1: Add the overlay after the advance is loaded**

In `getRequest`, replace:

```ts
  const advance = await loadAdvance(pool, id);
  if (advance) req.advance = advance;
```

with:

```ts
  const advance = await loadAdvance(pool, id);
  if (advance) {
    // Employee payees have no stored bank account — resolve it live from HR so
    // the value always reflects the current Employee record. Select ONLY
    // BankAccountNo (never the multi-MB PhotoUrl column) keyed by the indexed
    // StaffId, so this is a sub-millisecond lookup.
    if (advance.payeeType === "employee" && req.staffId != null) {
      const bankRes = await pool.request().input("sid", sql.Int, req.staffId)
        .query(`SELECT TOP 1 BankAccountNo FROM ${hrEmployeeTable()} WHERE StaffId = @sid AND Status = N'Active'`);
      const acct = ((bankRes.recordset[0]?.BankAccountNo as string) ?? "").trim();
      if (acct) advance.payeeBankAccount = acct;
    }
    req.advance = advance;
  }
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: no errors (`hrEmployeeTable` and `sql` are already imported).

- [ ] **Step 3: Verify tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 4: Manual DB sanity (read-only, via mssql-rocks MCP)**

Confirm an employee-payee advance's requester has a BankAccountNo:

```sql
SELECT TOP 5 r.Id, r.StaffId, a.PayeeType, e.BankAccountNo
FROM Rocks_Portal_Form_UAT.dbo.AccRequest r
JOIN Rocks_Portal_Form_UAT.dbo.AccAdvance a ON a.RequestId = r.Id
LEFT JOIN Rocks_Portal_HR.dbo.Employee e ON e.StaffId = r.StaffId
WHERE r.FormCode='AP-2' AND a.PayeeType='employee'
ORDER BY r.Id DESC
```

Expected: employee-payee rows show a `BankAccountNo`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/adv/advance-request-service.ts
git commit -m "feat(ap-2): live-resolve employee bank account on advance read"
```

---

## Task 3: Show the employee bank account in `AdvanceForm`

**Files:**
- Modify: `src/features/advance/components/AdvanceForm.tsx`

The form must display the resolved requester's bank account in the employee note.
The requester is either self (`emp` from `/api/me/employee`) or an on-behalf
colleague. `emp` is set from `m.data.employee` (Task 1 adds `bankAccountNo`).

- [ ] **Step 1: Carry `bankAccountNo` into the `emp` state**

Find where `setEmp({...})` is called (the `/api/me/employee` handler, ~line 145) and
add `bankAccountNo: e.bankAccountNo ?? null,` to the object. Add `bankAccountNo?: string | null`
to the local `emp` state type/shape if it is explicitly typed (match the existing
fields such as `email`, `photoUrl`).

- [ ] **Step 2: Resolve the selected requester's bank account**

Near `const effectivePayeeName = payeeType === "employee" ? reqName : payeeName;`
(~line 270), add a resolver that prefers the selected on-behalf colleague, else self:

```ts
  const selectedColleague = requesterStaffId != null
    ? colleagues.find((c) => c.staffId === requesterStaffId) ?? null
    : null;
  const employeeBankAccountNo =
    (selectedColleague?.bankAccountNo ?? emp?.bankAccountNo ?? "").trim() || null;
```

(Use the existing `colleagues` and `requesterStaffId` state. If `colleagues`'
element type is a local interface, add `bankAccountNo?: string | null` to it.)

- [ ] **Step 3: Show it in the employee note**

Replace the `payeeType === "employee"` note (~line 680):

```tsx
        {payeeType === "employee" && (
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            โอนเข้าบัญชีของผู้ขอเบิก ({effectivePayeeName || "—"}) ตามข้อมูล HR
            {" · "}เลขบัญชี {employeeBankAccountNo ?? "— ไม่พบใน HR"}
          </p>
        )}
```

- [ ] **Step 4: Verify typecheck + tests**

Run: `npm run typecheck` — expected: no errors.
Run: `npm test` — expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/advance/components/AdvanceForm.tsx
git commit -m "feat(ap-2): show requester's HR bank account when payee is employee"
```

---

## Task 4: Extract `AdvanceVendorPicker` (shared)

**Files:**
- Create: `src/features/advance/components/AdvanceVendorPicker.tsx`

Encapsulate the ACC_OFFICER vendor UX (auto AI match + searchable select +
Match/Unmatch badge + confirm-on-select) currently inline in the full page.

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { SearchableSelect } from "@/features/accounting/components/settings/SearchableSelect";

export interface AdvanceVendorPickerProps {
  requestId: number;
  /** request.brandCode — the API resolves it to the interface company. */
  company: string;
  /** true in the drawer: show a small inline spinner instead of the parent popup. */
  compact?: boolean;
  /** notified after a successful confirm (parent tracks the confirmed vendorNo). */
  onConfirmed?: (vendorNo: string) => void;
  /** notified when the AI match run starts/stops (full page drives its own popup). */
  onMatchingChange?: (matching: boolean) => void;
}

export function AdvanceVendorPicker({
  requestId,
  company,
  compact = false,
  onConfirmed,
  onMatchingChange,
}: AdvanceVendorPickerProps) {
  const [vendors, setVendors] = useState<{ vendorNo: string; displayName: string | null }[]>([]);
  const [selectedVendor, setSelectedVendor] = useState("");
  const [reason, setReason] = useState<string | null>(null);
  const [matching, setMatching] = useState(false);

  useEffect(() => {
    if (!company) return;
    let cancelled = false;
    fetch(`/api/request/advance/vendors?company=${encodeURIComponent(company)}`)
      .then((r) => r.json())
      .then((j: { ok: boolean; vendors?: { vendorNo: string; displayName: string | null }[] }) => {
        if (!cancelled && j.ok && j.vendors) setVendors(j.vendors);
      })
      .catch(() => {});

    setMatching(true);
    onMatchingChange?.(true);
    fetch(`/api/request/advance/vendor-match/${requestId}`, { method: "POST" })
      .then((r) => r.json())
      .then((j: { ok: boolean; data?: { vendorNo: string | null; reason: string | null } }) => {
        if (cancelled) return;
        if (j.ok && j.data) {
          setReason(j.data.reason);
          setSelectedVendor((prev) => prev || (j.data?.vendorNo ?? ""));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) { setMatching(false); onMatchingChange?.(false); }
      });
    return () => { cancelled = true; };
  }, [requestId, company, onMatchingChange]);

  function confirm(vendorNo: string) {
    setSelectedVendor(vendorNo);
    if (!vendorNo) return;
    fetch("/api/request/advance/vendor-confirm", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: requestId, vendorNo }),
    })
      .then((r) => r.json())
      .then((j: { ok: boolean; error?: string }) => {
        if (!j.ok) toast.error(j.error ?? "ยืนยัน Vendor ไม่สำเร็จ");
        else { toast.success("ยืนยัน Vendor แล้ว"); onConfirmed?.(vendorNo); }
      })
      .catch(() => toast.error("ยืนยัน Vendor ไม่สำเร็จ"));
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-[12px]" style={{ color: "var(--text-secondary)" }}>
      <span>Vendor:</span>
      <div style={{ minWidth: 260, maxWidth: 400 }}>
        <SearchableSelect
          value={selectedVendor}
          onChange={confirm}
          options={vendors.map((v) => ({ value: v.vendorNo, label: v.displayName ?? v.vendorNo, subLabel: v.vendorNo }))}
          placeholder="— เลือก Vendor —"
          emptyLabel="— เลือก Vendor —"
          searchPlaceholder="ค้นหาชื่อ หรือ รหัส vendor..."
        />
      </div>
      {compact && matching && (
        <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
          <Loader2 size={12} className="animate-spin" /> AI กำลังจับคู่...
        </span>
      )}
      {selectedVendor ? (
        <span title={reason ?? ""} className="text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
          style={{ background: "rgba(79,163,122,0.15)", color: "#4fa37a" }}>● Match</span>
      ) : (
        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
          style={{ background: "color-mix(in srgb, var(--color-danger) 12%, transparent)", color: "var(--color-danger)" }}>● Unmatch</span>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/advance/components/AdvanceVendorPicker.tsx
git commit -m "feat(ap-2): extract shared AdvanceVendorPicker component"
```

---

## Task 5: Use `AdvanceVendorPicker` in the full page

**Files:**
- Modify: `src/app/(dashboard)/request/advance/[id]/page.tsx`

Replace the inline vendor UI with the shared component; keep confirm-on-approve.

- [ ] **Step 1: Import + track confirmed vendor**

Add import:

```ts
import { AdvanceVendorPicker } from "@/features/advance/components/AdvanceVendorPicker";
```

Remove the now-unused vendor state (`vendors`, `vendorMatch`) and the two vendor
`useEffect`/fetch blocks (the `/vendors` load and the `/vendor-match` POST at
~lines 46–48, 86–110) and the `SearchableSelect` import if no longer used. Keep
`selectedVendor` and `matchingVendor`:

```ts
  const [selectedVendor, setSelectedVendor] = useState<string>("");
  const [matchingVendor, setMatchingVendor] = useState(false);
```

- [ ] **Step 2: Render the shared picker in the ACC_OFFICER block**

Replace the inline `Vendor:` + `SearchableSelect` + Match/Unmatch markup
(~lines 260–305) with:

```tsx
              <AdvanceVendorPicker
                requestId={requestId!}
                company={request.brandCode ?? ""}
                onConfirmed={setSelectedVendor}
                onMatchingChange={setMatchingVendor}
              />
```

Keep the `PaymentDatePicker` row and the full-screen `matchingVendor` popup
(`TravelExpenseLoadingPopup`) as-is — `onMatchingChange` drives it.

- [ ] **Step 3: Keep confirm-on-approve**

`handleApprove` is unchanged: it still checks `!selectedVendor` and POSTs
`/vendor-confirm` then approve. (Confirm-on-select in the picker makes the
pre-approve confirm idempotent.)

- [ ] **Step 4: Verify typecheck + tests**

Run: `npm run typecheck` — expected: no errors, no unused-var errors.
Run: `npm test` — expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/request/advance/[id]/page.tsx"
git commit -m "refactor(ap-2): full page uses shared AdvanceVendorPicker"
```

---

## Task 6: Vendor section + approve footer in `AdvanceDetailPanel`

**Files:**
- Modify: `src/features/advance/components/AdvanceDetailPanel.tsx`

Add `onChanged`, a vendor section (ACC_OFFICER only), and an approve footer
(any approval step). The panel already has `data` (`AdvanceRequest`), `requestId`,
`router`, and `onClose`.

- [ ] **Step 1: Props + imports + state**

Change the signature to accept `onChanged`:

```ts
export function AdvanceDetailPanel({ requestId, onClose, onChanged }:
  { requestId: number | null; onClose: () => void; onChanged?: () => void }) {
```

Add imports:

```ts
import { toast } from "sonner";
import { PaymentDatePicker } from "@/components/ui/PaymentDatePicker";
import { AdvanceVendorPicker } from "./AdvanceVendorPicker";
```

Add state (near the other `useState`s):

```ts
  const [selectedVendor, setSelectedVendor] = useState<string>("");
  const [paymentDates, setPaymentDates] = useState<string[]>([]);
  const [paymentDate, setPaymentDate] = useState<string>("");
  const [approving, setApproving] = useState(false);
```

- [ ] **Step 2: Derive the approval flags + load payment dates at ACC_OFFICER**

After `const adv = data?.advance;` add:

```ts
  const atApproval = data?.status === "Submitted" && !!data?.currentStepCode;
  const atAccOfficer = atApproval && data?.currentStepCode === "ACC_OFFICER";
```

Add an effect (after the existing data-loading effects):

```ts
  useEffect(() => {
    if (!atAccOfficer) return;
    fetch("/api/request/advance/payment-dates")
      .then((r) => r.json())
      .then((j: { ok: boolean; data?: { dates: string[]; default: string } }) => {
        if (j.ok && j.data) { setPaymentDates(j.data.dates); setPaymentDate(j.data.default); }
      })
      .catch(() => {});
  }, [atAccOfficer]);
```

- [ ] **Step 3: Vendor section in the body (ACC_OFFICER only)**

Inside the `data` branch, just before the "approval history" block, add:

```tsx
              {atAccOfficer && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--text-faint)" }}>
                    Vendor (สำหรับลง ERP)
                  </p>
                  <AdvanceVendorPicker
                    requestId={requestId}
                    company={data.brandCode ?? ""}
                    compact
                    onConfirmed={setSelectedVendor}
                  />
                </div>
              )}
```

- [ ] **Step 4: Approve action in the footer**

Add an approve handler (above the `return`):

```ts
  async function handleApprove() {
    if (requestId == null) return;
    if (atAccOfficer) {
      if (!paymentDate) return toast.error("กรุณาเลือกวันจ่าย");
      if (!selectedVendor) return toast.error("กรุณาเลือก Vendor");
    }
    setApproving(true);
    try {
      if (atAccOfficer) {
        const c = await fetch("/api/request/advance/vendor-confirm", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: requestId, vendorNo: selectedVendor }),
        }).then((r) => r.json()) as { ok: boolean; error?: string };
        if (!c.ok) { toast.error(c.error ?? "ยืนยัน Vendor ไม่สำเร็จ"); return; }
      }
      const res = await fetch(`/api/request/advance/requests/${requestId}/approve`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(atAccOfficer ? { paymentDate } : {}),
      });
      const j = (await res.json()) as { ok: boolean; error?: string };
      if (!j.ok) { toast.error(j.error ?? "อนุมัติไม่สำเร็จ"); return; }
      toast.success("อนุมัติสำเร็จ");
      onChanged?.();
      onClose();
    } catch {
      toast.error("อนุมัติไม่สำเร็จ");
    } finally {
      setApproving(false);
    }
  }
```

Replace the footer block (the `เปิดใบเต็ม` button container) with:

```tsx
        {/* footer */}
        <div className="px-4 py-3 flex flex-col gap-2" style={{ borderTop: "1px solid var(--border-card)" }}>
          {atApproval && (
            <div className="flex items-center gap-2">
              {atAccOfficer && (
                <PaymentDatePicker value={paymentDate} onChange={setPaymentDate} allowedDates={paymentDates} />
              )}
              <button type="button" onClick={handleApprove} disabled={approving}
                className="ml-auto text-[13px] font-bold px-4 py-2 rounded-lg cursor-pointer border-none disabled:opacity-60"
                style={{ background: "var(--color-action, #A3121B)", color: "#fff" }}>
                {approving ? "กำลังดำเนินการ..." : atAccOfficer ? "ดำเนินการ" : "อนุมัติ"}
              </button>
            </div>
          )}
          <button type="button" onClick={() => router.push(`/request/advance/${requestId}`)}
            className="flex items-center gap-1.5 text-[12px] font-semibold cursor-pointer bg-transparent border-none p-0"
            style={{ color: "var(--nav-active-text)" }}>
            เปิดใบเต็ม <ExternalLink size={13} />
          </button>
        </div>
```

- [ ] **Step 5: Verify typecheck + tests**

Run: `npm run typecheck` — expected: no errors.
Run: `npm test` — expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/features/advance/components/AdvanceDetailPanel.tsx
git commit -m "feat(ap-2): vendor picker + approve action in preview drawer"
```

---

## Task 7: Wire `onChanged` from `AdvanceApproveQueue`

**Files:**
- Modify: `src/features/advance/components/AdvanceApproveQueue.tsx`

- [ ] **Step 1: Pass `onChanged`**

Change the panel usage (~line 215):

```tsx
      <AdvanceDetailPanel requestId={panelId} onClose={() => setPanelId(null)} onChanged={load} />
```

(`AdvanceErpQueue` keeps calling it without `onChanged` — its rows are past
approval so `atApproval` is false and the footer stays read-only there.)

- [ ] **Step 2: Verify typecheck + tests**

Run: `npm run typecheck` — expected: no errors.
Run: `npm test` — expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add src/features/advance/components/AdvanceApproveQueue.tsx
git commit -m "feat(ap-2): approve queue refreshes after inline approve in drawer"
```

---

## Final verification (after all tasks)

- `npm run typecheck` — clean.
- `npm test` — all pass.
- Manual E2E (user, after restarting dev server): approve queue → 👁 on an
  ACC_OFFICER row → drawer shows AI match → pick/confirm vendor → Match badge →
  pick payment date → ดำเนินการ → queue refreshes; earlier-step row → อนุมัติ works;
  create an employee-payee advance → note shows the HR bank account → preview shows
  it under เลขบัญชี. Full page ACC_OFFICER still matches + approves as before.
- Do **not** run `npm run build` in this workspace.

---

## Self-review notes

- **Spec coverage:** A1 → Task 4/5; A2 → Task 6/7; A3 (approve-only in panel) → Task 6 footer (no reject/return); B1 → Task 1; B2 → Task 3; B3 → Task 2. All covered.
- **Type consistency:** `bankAccountNo` added to `EmployeeContext` + `DepartmentColleague`; `AdvanceVendorPicker` props (`requestId`, `company`, `compact`, `onConfirmed`, `onMatchingChange`) used identically in Tasks 5 and 6. `onChanged` optional on the panel, passed only by the approve queue.
- **No new endpoints, no migration.**
