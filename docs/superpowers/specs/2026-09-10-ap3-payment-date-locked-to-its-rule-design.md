# AP-3 — the payment date is locked to the rule that governs it

Date: 2026-09-10
Status: approved, ready for planning
Branch: continues on `feat/ap3-vendor-and-rd-in-grid`

## Why

At the account step the payment date is a bare `<input type="date">` whose only
constraint is `min={today}`. The word **(ศุกร์)** in its label is the entire
expression of the rule — nothing enforces it at the client, the route, the
engine, or the database. Any Wednesday, any non-round Friday, any date years
out is accepted and stored.

That date becomes the journal's **G/L Posting Date** in Business Central. Off
cycle it posts fine and simply dates the entry to a payment run that never
happened, leaving treasury nothing to reconcile against; in a closed period BC
rejects the whole journal at send time — three approvals late, discovered by
whoever pressed "ส่งเข้า ERP". That is precisely the failure the account step's
other guards were written to prevent.

AP-2 solved this: a picker locked to the allowed rounds, and a server check
that the submitted date is one of them. **AP-3 already contains a faithful port
of both** — `PaymentDatePicker` plus `getPaymentDates().includes()` — in the
admin ERP queue and its `erp/payment-date` route. But that screen comes *after*
approval. This moves the same pair upstream, to where the date is first set.

Nothing new is built. It is one component and one check, moved.

## The rule depends on which way the money goes

This is the part AP-2 does not have to think about, because an AP-2 advance
only ever pays out.

`refundToCompany = advanceAmount − actualTotal`.

| | Direction | The date means |
|---|---|---|
| `refund < 0` | The company owes the employee | Treasury's own payment run — the 2nd or 4th Friday |
| `refund > 0` | The employee has transferred money back | The day their transfer cleared |
| `refund = 0` | Nothing moves | Nothing |

So the Friday-round rule belongs to the company-pays case **only**. A refund
transfer lands on whatever day the employee sent it, and holding that to a
treasury calendar would reject every honest one.

## Decisions

| Case | The field | The server |
|---|---|---|
| `refund < 0` | `PaymentDatePicker`, locked to the allowed rounds, seeded with the default round, **required** | Must be present **and** a member of `getPaymentDates()` |
| `refund > 0` | Read-only, showing `refundTransferDate` and saying where it came from | Derived from stored `refundTransferDate`; the client's value is ignored |
| `refund = 0` | Read-only; the stored value or `—` | Passed through unchanged |

A stored date that is no longer an allowed round is **shown, flagged, and
blocks approval** until it is re-picked — but only in the `refund < 0` case,
which is the only one the round rule governs.

`refundTransferDate` is required at submit when `refund > 0`
(`clear-advance-request-service.ts:437`), so the derivation can never find
nothing.

### Why the refund case is read-only rather than pre-filled and editable

An editable field there would change nothing. `journalPostingDate`
(`clear-advance-erp-payload.ts:176-178`) reads
`refund || payment || today` on that branch, so `refundTransferDate` always
wins, and it is always present. An accountant could edit the payment date, see
it saved, and watch BC receive the transfer date regardless.

A control that accepts input and discards it is worse than no control. If the
date is wrong the fix is `วันที่โอนคืน` itself, which is both the source of
truth and the value BC actually uses. One field, one meaning.

## Changes

| # | File | Change |
|---|---|---|
| 1 | `ClearAdvanceDetail.tsx` | Fetch `/api/request/advance/payment-dates` on entering the account step — the same endpoint the AP-3 ERP queue already calls; there is no AP-3-specific one |
| 2 | `ClearAdvanceDetail.tsx:492` | Swap `<input type="date">` for `<PaymentDatePicker>` in the `refund < 0` case; read-only text otherwise. Drop `min={todayYmd()}` — the returned list already excludes past rounds |
| 3 | `ClearAdvanceDetail.tsx` | Seed `data.default` when the field is empty and `refund < 0` |
| 4 | `ClearAdvanceDetail.tsx` | Flag a stored date outside the current rounds, and add it to `accountBlocked` |
| 5 | `clear-advance-approval-engine.ts:62` | Membership check beside the existing presence check; derive the refund case's date |

## Unchanged

`payment-calendar.ts` and its 2nd/4th-Friday rule, the holiday shift, the
Monday-noon cutoff that picks the default, and the endpoint — all shared with
AP-1 and AP-2 and none of it moves. `PaymentDatePicker` itself. The ERP
queue's per-row picker and `erp/payment-date` route stay exactly as they are:
accounting sets the date at their step, and an admin can still re-target it
before sending if a round is missed. `AccClearAdvance.PaymentDate` keeps its
shape — no migration.

`journalPostingDate`'s precedence is deliberately not touched. Its doc comment
explains at length why each branch prefers what it does, and changing it to
make an edit in the refund case meaningful would be a separate decision about
posting dates, not part of locking a picker.

## Found along the way, not fixed here

`setAccountAction` is called at `clear-advance-approval-engine.ts:95`, **before**
the transaction that begins at `:99`. The PV number and payment date are
therefore written even when the step-advance guard at `:103-109` rolls the
step back. Pre-existing, and moving the call inside the transaction changes
that transaction's shape, so it wants its own change. The new guard is placed
*before* `setAccountAction` like every other guard there, so a rejected date
is never written.

## Tests

| Test | Where |
|---|---|
| The engine's payment-date decision as a pure rule — required and round-checked when the company pays, derived from the transfer date when the employee refunds, untouched at zero | new pure helper + test |
| An allowed round passes; a Wednesday, a 3rd Friday and a past round are refused | same |
| A refund case whose `refundTransferDate` is a Tuesday is accepted, and the round rule is not applied to it | same |
| `PaymentDatePicker` in the account step, the read-only refund case, the stale-date flag | not covered — React; the browser pass covers them |

## Open questions

None.
