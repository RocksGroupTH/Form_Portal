# AP-17 package B — three per-diem rules that only work together

Design, 2026-09-21. Approved by the user the same day.

Items 1, 2 and 4 of the AP-17 batch. They are one package because all three
change what a day is worth, and two of them contradict each other unless
designed in the same breath.

---

## 0. What the code does today

**`computePerDiem`** (`travel-booking/perdiem.ts:57`) walks every day from
`departDate` to `returnDate` inclusive and drops the first one when
`isContinuation`. A same-day trip is therefore worth one day. Accommodation is
not consulted at all.

**`continuation-chain.ts`** decides `isContinuation` — a trip continues the one
before it when it departs on the day that one returned, so the shared day is
paid once. It is **scoped to a booking group**: it takes the group's trips,
orders them by `AccTravelBooking.SortOrder`, and walks backwards to the nearest
live predecessor. Two requests submitted in separate rounds never see each
other.

**Nothing refuses a duplicate date.** AP-1 has a unique-date rule per StaffId;
AP-17 has never had one. The only handling of an overlap is the silent
deduction above, and the detail page explains it with
`ต่อเนื่องจากทริปก่อนหน้า จึงไม่นับซ้ำที่นี่ (−1 วัน)`
(`TravelBookingDetail.tsx:1197`) — without naming the date or the request it
collided with.

---

## 1. Item 2 — no accommodation booking, no per diem

**The cut is the booking, not the calendar** (user, 2026-09-21). When the
selected accommodation option has `needsRoomBooking = false`, the trip is worth
**zero** per-diem days, however many nights it spans.

So a three-night trip staying with relatives pays nothing. That is the stated
intent and it is the whole point of the rule — per diem here follows the
company having booked a room, not the person having been away.

`deriveBookingFlags` already derives `needsRoomBooking` from the selected
option, so the input exists and no schema change is needed.

**There is exactly one exception, and it is package E**: a requester who picks
*พักห้องเดียวกับ* has no booking of their own and **does** get per diem
(user, same day). Written here rather than only in E's spec because a reader
who finds this rule first must not conclude the exception is a bug. E owns the
mechanism; B owns the rule that makes the exception necessary.

**Zero days is a real answer, not a missing one.** `computePerDiem` must return
`days: 0, total: 0, groups: []` — never null and never "no rate configured".
`perDiemCountryLog`'s own docblock already records why that distinction matters
on a path that writes `AccRequest.TotalAmount`.

---

## 2. Item 1 — a duplicate date refuses the submit, and says what it hit

**Submit is refused** when any travel day of the request being filed is already
covered by another live request of the same StaffId (user, 2026-09-21 — "ห้ามส่ง
ถ้าวันซ้ำ").

**With exactly one exception, and it is item 4's whole case**: the previous
request's **return date** may equal the new request's **depart date**. One
shared day, at the boundary, in that direction only.

| case | verdict |
|---|---|
| 20–24 then 24–26 | **allowed** — the 24th is a return meeting a depart |
| 20–24 then 22–26 | refused — three days overlap |
| 20–24 then 21–23 | refused — contained inside |
| 20–24 then 24–24 | refused — the 24th is not a depart meeting a return, it is the whole trip |

Confirmed with the user as "ชนได้แค่วันกลับชนวันออก".

**The message names the date and the running number**, not just "วันซ้ำ" —
`วันที่ 22/09/2026 ซ้ำกับคำขอ TRL26-00123 (20/09–24/09)`. A requester cannot act
on a refusal that does not say what to look at, and the request they collided
with may be one they filed weeks ago.

**"Live" means not Cancelled and not Rejected**, the same test
`continuation-chain.ts` already applies through its `alive` flag. A cancelled
trip must not block a re-file — that is the situation a re-file exists for.

**Both the client validator and the server refuse.** The client so the person
learns before filling the rest; the server because a client-enforced invariant
is not one, and a resumed draft can hold dates that were free when it was saved.

---

## 3. Item 4 — continuation across separately submitted requests

`continuationFlags` widens from *the group* to *every live AP-17 request of this
StaffId*, ordered by depart date rather than by `SortOrder`.

**`SortOrder` cannot be the key any more.** It orders trips within one group and
means nothing between groups filed weeks apart. Depart date is the only ordering
both cases share.

**The chain still skips dead trips.** That is the entire reason
`continuation-chain.ts` exists — its docblock says so — and widening the input
set does not change it: a cancelled predecessor gives its day back to the
survivor.

### This makes `recomputeGroupPerDiem` under-scoped, and that is the real cost

`recomputeGroupPerDiem` runs inside the cancelling transaction of
`rejectRequest`, `rejectByAdmin` and `cancelByRequester`, and rewrites the
*group's* figures. Once the chain crosses groups, cancelling a trip in group 1
can change what a trip in group 2 is owed — and nothing recomputes group 2.

So the recompute widens with the chain: from the group to **every live request
of that StaffId whose chain position could have moved**. In practice that is the
requests whose depart date is at or after the cancelled trip's depart date.

**`perdiem-window.ts` still decides what may be written.** Widening which rows
are *considered* must not widen which rows are *rewritten* — a request past
accounting keeps its figure and gets the `perdiem_recalculated` activity row
with `after == before` and `locked: true`, exactly as today. That allow-list is
untouched by this package.

---

## 4. Where the rules live

Three pure modules, because none of this can be unit-tested through the query
layer — `report-service.ts` and friends reach `@/env` through a pool:

| module | owns |
|---|---|
| `travel-booking/date-overlap.ts` (new) | the overlap verdict and its Thai message. Pure: takes the candidate range and the other requests' ranges, returns allowed / refused-with-reason. |
| `travel-booking/continuation-chain.ts` (widened) | unchanged shape, wider input, ordered by depart date |
| `travel-booking/perdiem.ts` (extended) | `computePerDiem` gains the no-booking arm |

`date-overlap.ts` is separate from `continuation-chain.ts` deliberately, even
though both reason about touching date ranges: one decides whether a submit is
allowed, the other decides what a day is worth. Folding them would make the
refusal and the payment share a code path where a change meant for one silently
moves the other.

---

## 5. Testing

Everything above is pure and gets real unit tests, not source-reading guards.
The cases that must be present, because each is a boundary somebody will get
wrong:

- **`date-overlap`**: the four rows of the table in §2, plus — a same-day trip
  meeting a return; a cancelled predecessor not blocking; two requests that do
  not touch; and the message naming both the date and the running number.
- **`continuation-chain`**: the existing group cases still pass unchanged; a
  cross-group boundary is detected; a dead predecessor is skipped to the live
  one behind it; and **trips ordered by depart date rather than by insertion**,
  which is the change.
- **`computePerDiem`**: `needsRoomBooking = false` gives 0 days and a `total` of
  0 with an empty `groups`; the shared-room exception still pays; and a
  continuation on top of a no-booking trip does not go negative.

The `−1 วัน` explanation on the detail page gains the date and the running
number it was missing; that is display, and it reads its text from the same pure
module the refusal uses, so the two cannot describe the same collision
differently.

---

## 6. Out of scope

- AP-1's own duplicate-date rule. Different form, different table, untouched.
- The per-diem **rate** — `perdiem-source.ts`, `AccTravelPerDiemCountry` and the
  UAT `TesterPerDiem` override all decide what a day is worth in baht. This
  package only changes **which days count**.
- Backfilling. Requests already submitted keep the figures they were given,
  exactly as the 2026-08-27 recompute work chose. The wider chain applies to
  future transitions only.
