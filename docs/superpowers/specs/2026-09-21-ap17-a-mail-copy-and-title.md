# AP-17 package A — the manager's mail, and one field title

Design, 2026-09-21. Approved by the user the same day.

Two small changes with nothing between them but size. They travel together
because neither is worth a branch of its own and neither touches anything the
other four AP-17 packages touch.

---

## Amendment — 2026-09-21 (same-day correction, found in the fix-wave review)

**§2's claim that "the `claude-sonnet-5` verification behind it are all
unchanged" is true and, left on its own, misleading.** The field now invites a
passport (`แนบรูปบัตรประชาชน หรือ Passport`), but the verification it is
unchanged from still refuses one, four ways over, in
`src/app/api/request/travel-booking/id-card-check/route.ts`:

- `:45` — the prompt instructs the model to answer `true` only for a genuine
  Thai national ID card;
- `:46` — the prompt's own reject list names `พาสปอร์ต` (passport) explicitly;
- `:34` — `AnswerSchema.isIdCard`'s own description reads "True only if the
  image shows a Thai national ID card";
- `:54` — `FALLBACK_REASON = "รูปนี้ไม่ใช่บัตรประจำตัวประชาชน"`.

The check fails closed and the card is required to submit ("It fails closed,
and that is a decision with a stated cost," CLAUDE.md's AP-17 ID-card
section), so **a passport holder cannot file AP-17 at all** — the exact
population this package's new wording invites.

This is known and deliberately not fixed in this pass. Widening what counts
as identity proof is a policy decision for the user, not a copy fix, and it
spans four places that must move together: the prompt's reject list, the
schema description, `FALLBACK_REASON`, and the refusal dialog's title
(currently "ไม่ใช่บัตรประชาชน" — see `IdCardUpload` and
`features/travel-booking/lib/idcard-check.ts`). Recorded here because the
workspace holding the original review notes is gitignored and does not
survive, and because leaving §2's sentence uncorrected would make the next
reader conclude there is nothing to check. See CLAUDE.md's AP-17 ID-card
section for the same note in that section's own house style.

---

## 1. The three manager mails already send. Their copy is written for the wrong reader

**Measured before designing.** `approveByManager`, `rejectRequest` and
`returnRequest` each already call `notify(...)` with `requesterEmail`
(`travel-booking/approval.ts:243, 285, 326`), and `email-templates.ts` has a
`case` for all three. **Nothing needs wiring.** The request was for better
content, and reading the templates shows exactly what is wrong with it:

```ts
case "Rejected": {
  const rows = [
    row("เลขที่", no),
    row("ผู้ขอ", req.requesterFullName ?? "-"),   // ← the recipient's own name
    note ? row("เหตุผล", note) : "",
  ].join("");
}
```

These were written from an approver's seat — where "ผู้ขอ" is the useful
column — and then pointed at the requester. So the mail spends a line telling
someone their own name, and spends none on what they actually need.

### What each one says now, and what it must say

| | now | add | remove |
|---|---|---|---|
| **Approved** | เลขที่ · กำหนดจ่าย · เบี้ยเลี้ยงรวม | วันเดินทาง · สถานที่ปฏิบัติงาน · อนุมัติโดย · **ขั้นถัดไป** | — |
| **Rejected** | เลขที่ · ผู้ขอ · เหตุผล | วันเดินทาง · สถานที่ปฏิบัติงาน · ไม่อนุมัติโดย | ผู้ขอ |
| **Returned** | เลขที่ · ผู้ขอ · หมายเหตุ | วันเดินทาง · สถานที่ปฏิบัติงาน · ส่งกลับโดย · **สิ่งที่ต้องทำ** | ผู้ขอ |

**วันเดินทาง and สถานที่ปฏิบัติงาน go on all three** because a person with
several requests open cannot tell which one a mail is about from a running
number alone, and the whole point of a notification is not having to open the
app to find out. Both helpers already exist — `dateRangeLabel(req)` and
`workLocationLine(req)` are used by the `ReadyForAdmin` and `Completed` cases in
the same file.

**Approved must name the next step.** Its subject is "อนุมัติแล้ว", which reads
as finished. It is not: the request goes to the Admin booking desk and then to
accounting. A requester who thinks it is done does not chase a booking that
never happened.

**Returned must say what to do.** "ส่งกลับแก้ไข" states a status. The reader
needs the instruction — open it, fix what the note says, submit again — and that
the running number survives, so they do not file a second request.

**Who acted is a new field on all three.** The templates take `note` today but
no actor. `buildTravelBookingEmail` gains an optional `actorName`, and the three
`notify` calls pass it. Optional rather than required because the other four
triggers (`Submitted`, `ReadyForAdmin`, `Completed`, and the Admin/account
rejections) have no single actor to name and must keep compiling unchanged.

### Not in scope

The Admin and accounting rejections (`approval.ts:414, 433, 597`) reuse the same
`Rejected` / `Returned` cases. They inherit the improved copy — which is
correct, the copy is better for any recipient — but nothing about their triggers
or recipients changes. `Submitted`, `ReadyForAdmin` and `Completed` are
untouched.

---

## 2. The ID-card field title, in both places it exists

`แนบรูปบัตรประชาชน (1 รูป) *` → **`แนบรูปบัตรประชาชน หรือ Passport *`**

**It appears twice, and changing one leaves the other lying.** Besides the field
title there is the product tour, which still says *"ต้องแนบรูปบัตรประชาชน 1 รูป
เพื่อใช้จองที่พัก/ตั๋ว"* (`features/travel-booking/components/tour/TravelBookingTour.tsx:62`).
A reader who takes the tour and then meets the field would be told two different
things about what is acceptable.

Dropping "(1 รูป)" is deliberate and not merely tidier: the count was never the
constraint worth stating, and keeping it beside "หรือ Passport" invites the
reading that one of each is wanted.

**This is copy only.** What the upload accepts, how many files it takes, and the
`claude-sonnet-5` verification behind it are all unchanged — package C is what
changes when the field is required at all.

---

## 3. Testing

`email-templates.ts` is pure — it takes a request shape and returns
`{ subject, html }`, touching no pool — so it is unit-testable directly, and
there is no existing test file for it. Add one asserting, per trigger:

- the three manager triggers render วันเดินทาง and สถานที่ปฏิบัติงาน;
- **none of the three renders a "ผู้ขอ" row** — pinned as an absence, because
  that is the defect and an absence is what a later edit silently restores;
- `actorName` appears when supplied and the template still renders without it;
- Approved names the next step and Returned names the action, asserted on the
  copy constants rather than on prose fragments, so rewording does not red the
  suite for no reason.

The title change gets no test. A string in JSX asserted by a test that reads the
same string proves nothing; the tour and the field are kept honest by being
changed in one commit and named together here.

---

## 4. Ordering against package C

Both packages touch the ID-card block: A changes the field's **title**, C
changes **whether it renders at all**. They are in the same component and will
conflict textually if built in parallel.

**A goes first.** It is the smaller change and it leaves C editing a title that
is already correct, rather than C having to carry A's copy change through its
own conditional. If for any reason C lands first, A's change is still exactly
the same two strings — the title and the tour — and neither moves.

## 5. Out of scope, recorded so it is not mistaken for an omission

- No new recipients, no cc, no change to who is mailed. The user confirmed the
  three mails reach the right person already.
- `AccEmailQueue`, `applyUatRedirect` and the UAT `[UAT] ` subject prefix are
  untouched.
- The other four triggers' own copy.
