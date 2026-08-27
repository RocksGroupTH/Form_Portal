# AP-17 — an accounting step, an editable payout month, and a per-diem audit trail

**Date:** 2026-08-27
**Branch:** `fix/ap17-continuation-note` (spec only; implementation not started)
**Status:** design agreed, not built

AP-17 today ends at the Admin booking desk. Nobody from accounting signs it off,
the payout month is decided once by a formula and never revisited, and a
per-diem figure computed at submit is never recomputed — so a day dropped as a
duplicate stays dropped even when the trip that took it is cancelled.

This closes all three, and they are one piece of work because the last two only
become safe once the first exists: a figure may be corrected up to the moment
accounting signs, and not after.

---

## 1. Decisions taken

| Question | Decision |
|---|---|
| Where does the accounting step sit? | **ผู้จัดการ → Admin จอง → บัญชี.** Accounting signs last, seeing the real booking cost. |
| Who may sign it? | **`AccBookingApprover`, unchanged.** AP-17's roster already exists; สิทธิ์เข้าถึง decides which menu a member sees. No new table, no new dual-write. |
| Which requests get a recomputed per diem? | **Only those that have not passed the accounting step.** A signed figure never moves. |
| What happens to a signed request? | The amount is locked. The page shows it read-only. |

### What already exists, and is not being rebuilt

Three things make this smaller than it looks, all verified in the code today:

- **`AccRequest.PaymentDate` is already set for AP-17**, at manager approval
  (`approval.ts`), and `payment-month.ts` already holds the end-of-month rule —
  approved on or before the 20th pays at that month's end, after the 20th rolls
  to the next. The new picker changes *who may change it*, not the convention.
- **`CurrentStepCode = 'ADMIN'` is not an `AccApproval` row**, it is a marker on
  `AccRequest`. `CK_AccApproval_Step` already permits `MANAGER`, `ACCOUNT` and
  `ACCOUNT_FINAL` (migration 091), so **the new step needs no constraint change**.
- **`AccBookingApprover` and `AccBookingApproverTab` are in place**, with the
  per-person tick grid this extends.

---

## 2. The state machine

```
Submitted (MANAGER)
   │ approve → PaymentDate set from payment-month.ts
   ▼
ManagerApproved · CurrentStepCode = 'ADMIN'      ← Admin fills the booking in
   │ admin done
   ▼
ManagerApproved · CurrentStepCode = 'ACCOUNT'    ← NEW: the accounting queue
   │ approve
   ▼
Approved                                          ← amount locked from here
```

Reject and return stay available at every step and are unchanged.

**The recompute window is exactly the span above `Approved`.** A request whose
`CurrentStepCode` is `MANAGER`, `ADMIN` or `ACCOUNT` may have its per diem
recomputed; one that is `Approved` may not, and neither may one that is
`Rejected` or `Cancelled`, which are not going to be paid at all.

---

## 3. Recomputing the per diem

### When

When a request moves to `Cancelled` or `Rejected`, every **later** trip in the
same `GroupKey` that was treated as a continuation of it is reconsidered.

Concretely: on that transition, re-derive `IsContinuation` for the group the
same way `submitTravelBookingGroup` derives it — a trip is a continuation when
the trip before it, **among those still alive**, returns on the day it departs —
then recompute `PerDiemDays` and `PerDiemTotal` for any trip that changed *and*
has not passed accounting.

"Among those still alive" is the whole change. Today the chain is fixed at
submit; a cancelled trip stays in it and keeps absorbing a day it will never be
paid for.

### What it must not do

- **Never touch a request past the accounting step.** A signed figure is a
  decision somebody made; if a predecessor is cancelled afterwards, the trail
  records it and a person decides.
- **Never raise a figure above what the days actually support.** The recompute
  reruns the same `computePerDiem`; it does not add days from anywhere else.
- **Run inside the cancelling transaction.** A cancel that succeeds while the
  recompute fails leaves the group inconsistent in exactly the way this exists
  to prevent.

---

## 4. The audit trail

Every recompute writes a row to **`AccActivityLog`**, the table this app already
uses for per-request history and already renders in the timeline:

```
Action        'perdiem_recalculated'
Note          human-readable, e.g.
              "Per diem 0 → 1 วัน (0.00 → 300.00) เพราะ TRL26-09002 ถูกยกเลิก"
MetadataJson  { before: {days, total}, after: {days, total},
                causedByRequestId, causedByRequestNo, cause: 'cancelled' | 'rejected' }
```

**A new table was considered and rejected.** A dedicated `AccTravelPerDiemLog`
would make "show me every per-diem change" one query instead of a JSON read —
but it would also be a second history for one request, shown in a second place,
and the timeline is where a reader already looks. `MetadataJson` carries the
numbers so nothing has to be parsed out of Thai prose. If a report over
per-diem changes is ever wanted, that is the moment to reconsider, and the rows
are already there to migrate from.

**The trail is written even where the figure is locked.** A request past
accounting whose predecessor is cancelled gets the log row with
`after == before` and a note saying the figure was left alone — that is the case
somebody most needs to find later.

---

## 5. สิทธิ์เข้าถึง — two menus, ticked separately

`AccBookingApproverTab` gains two keys, in the shape AP-4's access tab already
uses:

| Key | Grants sight of |
|---|---|
| `bookingQueue` | คิวจองที่พัก/ตั๋วโดยสาร |
| `accountApproval` | อนุมัติ (บัญชี) |

**No migration.** `AccBookingApproverTab` has no CHECK on its key column, which
is why `decideBookingTabAccess` refusing an unknown key is what makes a stray row
inert. Both keys are excluded from the *settings* tab union — they grant sight
of a work queue, not the right to edit configuration, and
`requireBookingSettingsTab` must not accept them.

**Membership alone grants nothing**, as with AP-4: an approver with no tick sees
neither menu. Admins see both.

**Being on `AccBookingApprover` is still what lets somebody act.** The tick
decides what they see; the roster decides what they may do. An approver with the
tick and no roster row sees an empty queue, which is correct and needs no
special case.

---

## 6. The accounting page

New page `/request/accounting/travel-booking/approvals`, listing requests at
`ManagerApproved` / `ACCOUNT`.

**Payment month, editable.** A month picker — the *date* is always that month's
last day, matching `computePayoutDate`, so there is nothing to get wrong by
typing. Months offered run from the current month forward; a payout already in
the past is not a schedule, and unlike AP-1 there is no correction case here
because the figure is not yet signed.

Saved by `POST /api/request/travel-booking/requests/[id]/payment-date`, which
re-derives the end-of-month date from the posted month server-side rather than
trusting a date from the client, and refuses any request not at the accounting
step.

**After approval the amount is read-only.** Both halves: the page renders it as
text, and the route refuses a request whose status is `Approved` — a control
removed from a page is not a rule.

**Per-diem history is visible on the row**, from the activity log, so an
accountant signing a figure that moved can see why before they sign it.

---

## 7. Migrations

**None.** The step code is already permitted, the tab keys need no constraint,
the activity log has the columns, and `PaymentDate` exists. This is the one
piece of good news in the whole spec and it is worth stating plainly so nobody
goes looking for a migration that is not there.

---

## 8. Testing

Pure and unit-tested, in the shape this repo already uses:

- **the continuation chain over a group with holes** — the heart of it. A
  three-trip group where the middle is cancelled; the third stops being a
  continuation of the second and becomes one of the first only if the dates
  still touch, which they usually will not.
- the recompute window: which `(status, stepCode)` tuples may move and which
  may not, including the locked case that still writes a log row
- the payout month: last-day-of-month for each offered month, the current month
  included, December rolling to the next year
- the two new tab keys: granted, not granted, unknown key inert, and **not**
  accepted by `requireBookingSettingsTab`

Route-gate coverage extends the existing `settings-tabs.test.ts` sweep to the
new route.

---

## 9. Open items

1. **What the Admin desk does on a cancelled predecessor.** The booking may
   already have been made and paid for. This spec changes the per diem only; a
   hotel already booked is not its business, and nobody has said what should
   happen there.
2. **Notification.** Nothing here emails anybody when a figure moves. The
   accountant sees it when they open the queue. If a requester should be told
   their allowance changed, that is a separate decision.
3. **The existing rows.** Nothing backfills. Groups already submitted keep the
   per diem they were given, including any day dropped for a trip since
   cancelled — the recompute runs on future transitions only. Fixing the
   existing ones means a one-off script and a list of who is owed what.
