# AP-2 pays every Friday, and AP-3's journal says ADC — Design

Date: 2026-09-24
Status: design approved (user, 2026-09-24)
Scope: **both consoles** — `R:\Form_Portal` and `R:\Acc_Portal`

## Purpose

Group B of the user's CR of 2026-09-23: the two items that change what the business does rather
than how a screen looks. They are grouped because both are small, both are high-consequence, and
both are the kind of change that is cheap to make and expensive to make wrong.

| CR item | Asked for |
| --- | --- |
| 1 | ฟอร์มเบิก AP-2 ปรับให้เลือกวันจ่ายเป็นทุกวันศุกร์ |
| 6 | Description สำหรับ Interface ERP Revised เป็นรูปแบบนี้ เลขที่ ADC+Description ของฟอร์ม AP-3 |

## Decisions taken

| # | Decision | Who, when |
| --- | --- | --- |
| 1 | **AP-2 only.** AP-1 and AP-3 keep the 2nd and 4th Friday. | user, 2026-09-24 |
| 2 | AP-2's refusal message becomes **"ต้องเป็นวันศุกร์"**. | user, 2026-09-24 |
| 3 | The ERP description is **`ADC26-xxxxx` + the line's own รายละเอียด**, and the ADC number alone on a line that has none. | user, 2026-09-24 |
| 4 | Both consoles, same release. | user, 2026-09-24 |
| 5 | "Every Friday" is **not** expressed as `nths = [1,2,3,4,5]`. See the hazard below. | this design |

---

# 1 · AP-2 pays every Friday

## What is shared today, and what is not

`payment-calendar-core.ts` was already built for this. `paymentRoundsInMonth(year, month0, nths)`
takes the rounds as an argument, and its own docblock says why:

> `nths` is the form's own calendar: AP-1 pays on the 2nd and 4th Friday, AP-4 on the 1st and
> 3rd. That is the *only* difference between them, which is why the cut-off below is shared
> rather than copied.

So the machinery is right and only the callers are wrong. What hardcodes the rounds is one layer
up, and differently in each app:

| | Where the rounds are fixed |
| --- | --- |
| Form Portal | `src/lib/acc/payment-calendar.ts` — `const ROUNDS = [2, 4]` |
| ACC Portal | `src/lib/acc/payment-calendar.ts` — `for (const nth of [2, 4])`, inline, no constant |

AP-4 already has its own calendar through `src/lib/acc/reimburse/payment-calendar`, which is the
proof that per-form rounds were always the intended shape.

## The blast radius, which is larger than the CR implies

`getPaymentDates` has **eight** consumers in Form Portal, and they belong to three different
forms. Every one of them must name which form it is asking for; none may keep the default.

| Consumer | Form |
| --- | --- |
| `src/lib/acc/approval-engine.ts:97` | AP-1 — validates, and owns the "(ศุกร์ที่ 2 หรือ 4)" message |
| `src/lib/adv/advance-approval-engine.ts:82` | **AP-2** — validates, same message today |
| `src/lib/clr/clear-advance-approval-engine.ts:78` | AP-3 — `allowedRounds` |
| `src/app/api/request/accounting/payment-dates` | AP-1 picker |
| `src/app/api/request/accounting/requests/[id]/payment-date` | AP-1 correction |
| `src/app/api/request/advance/erp-queue/payment-date` | **AP-2** ERP queue |
| `src/app/api/request/advance/payment-dates` | **AP-2** picker |
| `src/app/api/request/clear-advance/erp/payment-date` | AP-3 ERP queue |

`src/lib/acc/report-service.ts` also calls `paymentRoundsForApprovals` for a per-row suggestion;
it must say which form each row belongs to, or say plainly that the suggestion is AP-1's.

ACC Portal carries the same set through its own copies.

## AP-3 borrows AP-2's picker, and must stop

AP-3 already has its own server-side consumers. What it does not have is its own **picker
endpoint**: four client call sites fetch `/api/request/advance/payment-dates`, which is AP-2's.

| App | File |
| --- | --- |
| Form Portal | `ClearAdvanceDetail.tsx:282` |
| Form Portal | `features/clear-advance/components/admin/ClrErpInterfaceQueue.tsx:484` |
| ACC Portal | `ClrAccountWorkspace.tsx:180` |
| ACC Portal | `features/clear-advance/components/ClrErpInterfaceQueue.tsx:601` |

Left alone, AP-2 becoming weekly silently makes AP-3 weekly too — on the screen where accounting
picks the วันจ่าย for a clearing that pays an employee. **AP-3 gets its own
`/api/request/clear-advance/payment-dates` and those four call sites move to it.**

This is the same borrowing the bank-account CR fixed a day earlier, in the same pair of files.
It is not a coincidence worth ignoring: AP-3 was built by copying AP-2's screens, and the copies
kept pointing at AP-2's endpoints.

`ClrAccountWorkspace.tsx:323` computes `paymentDateOffCycle` from whatever that endpoint returned.
Once AP-2 is weekly and AP-3 is not, a borrowed set stops warning about dates that really are off
AP-3's cycle — a warning that goes quiet is worse than one that never existed.

## The hazard: "every Friday" is not `nths = [1,2,3,4,5]`

`nthFridayOfMonth` is raw date arithmetic:

```ts
return new Date(year, month0, 1 + offset + (nth - 1) * 7);
```

A month with four Fridays asked for its fifth returns a date in the **following** month — silently,
because `Date` rolls over. That date is then produced a second time when the next month is walked
as its own first Friday. Depending on the caller it either duplicates or attributes a payday to
the wrong month.

So the core gains a primitive that says what it means:

```ts
/** Every Friday that falls inside this month — four in most, five in some. */
export function everyFridayInMonth(year: number, month0: number): Date[]
```

walking from the first Friday in seven-day steps while the date is still in `month0`. It is pure,
it is five lines, and it is testable — which `nths = [1,2,3,4,5]` plus a filter would not honestly
be, because the filter would exist to undo a bug rather than to express a rule.

## What does not change, and why that is safe

**Every claim already approved stays valid.** Every Friday is a superset of the 2nd and 4th, so no
stored `PaymentDate` becomes invalid. Widening a validation is safe in a way narrowing never is;
if this decision is ever reversed, reversing it is not symmetrical and will strand rows.

**The holiday shift is untouched.** `shiftPaymentDay` moves a payday back one day when it lands on
a holiday. Adjacent Fridays are seven days apart, so no two weekly rounds can shift onto the same
date.

**AP-1, AP-3 and AP-4 keep their calendars**, including AP-1's message naming the 2nd and 4th.

## The consequence the CR does not mention

The round a claim lands in is decided by `paymentRoundsForApprovals`: the first round whose own
week's Monday noon has not passed. With fortnightly rounds a claim approved on a Monday afternoon
can wait up to about twenty-five days. With weekly rounds the same claim waits about eleven.

That is almost certainly the point of the request, and it is recorded here so that nobody later
reads "every Friday" as merely a longer dropdown. **It shortens how long an employee waits for
money, and it multiplies the number of payment runs finance makes by roughly two.** If the second
half of that is unwelcome, this is the decision to revisit — not the calendar code.

---

# 2 · The AP-3 journal's Description

## What it says today

`clear-advance-erp-payload.ts`, both apps:

```ts
const advNo = (input.advanceRequestNo ?? "").trim() || requestNo;
const who = (input.requesterName ?? "").trim();
const describe = (detail?: string | null) =>
  [advNo, "เบิก", "เคลียร์เงินทดลอง", who, (detail ?? "").trim()]
    .filter((s) => s !== "")
    .join(" ")
    .slice(0, 100);
```

A real line from the journal sent on 2026-09-23:

```
ADV26-00021 เบิก เคลียร์เงินทดลอง Pasapong Pisanupoj Type-c to HDMI สีดำ
```

Three things are wrong with it for the reader in Business Central:

1. **It leads with the ADV number** — the advance being cleared, not the clearing. Someone
   reconciling a posted journal against AP-3 has the ADC number and cannot search for it.
2. **"เคลียร์เงินทดลอง" is a typo** — *เงินทดลอง* is "experiment money"; the word is
   **ทดรอง**. It has been posting to BC in that form.
3. **It spends its 100 characters on boilerplate.** BC's Description caps at 100 and the comment
   above this code already says the identifying half has to survive the cut. Four fixed words and
   the requester's name push the line's own detail — the only part that differs between lines —
   towards the truncation.

## What it becomes

```ts
const describe = (detail?: string | null) =>
  [requestNo, (detail ?? "").trim()]
    .filter((s) => s !== "")
    .join(" ")
    .slice(0, 100);
```

| Line | Description |
| --- | --- |
| expense / VAT line with a detail | `ADC26-09038 ค่าอาหารและน้ำดื่ม` |
| bank line, vendor line — no detail of their own | `ADC26-09038` |

`requestNo` is the clearing's own number, which is the ADC. `advanceRequestNo`, `requesterName`
and the three fixed words go.

### ⚠ The ADV number then appears nowhere on the journal

An earlier draft of this section claimed the advance number survives in `employeeCode`, which the
codeunit maps to **External Document No.**. That is true of **AP-2**, whose payload sets
`employeeCode = req.requestNo`. It is **not** true of AP-3: `clear-advance-erp-payload.ts:205`
sets

```ts
const employeeCode = input.staffId != null ? String(input.staffId).slice(0, 35) : "";
```

— the requester's staff id. So today the ADV number reaches Business Central in exactly one
place, the Description, and this change removes it. After it, a posted AP-3 journal names the
clearing and not the advance it clears.

**That is accepted, not overlooked.** The ADC number is what somebody holding a posted journal
can search AP-3 for, and AP-3's own screen shows which advance each clearing settles — so the
link survives at one hop instead of zero. It is recorded here because it is a real loss for
anyone reconciling inside BC alone, and because the cheap remedy, if that turns out to matter,
is to put the ADV number in `employeeCode` the way AP-2 already does rather than to put it back
in the Description and spend the characters again.

## What this is allowed to break, and what it is not

**The tests assert the old string literally** and will go red — by design. Both apps:
`clear-advance-erp-payload.test.ts` lines 48, 56 and 62 in ACC Portal, and the equivalents plus
lines 112 and 119 in Form Portal. They are updated to the new format; **no assertion is loosened
to `toContain` or a prefix match to make it pass.** A description is a thing a human reads in
BC, so the test should keep naming it exactly.

**Nothing else may change.** Not the posting date, not the amounts, not the document type, not
`employeeCode`, not the 100-character cut. A description-only change that alters a figure is the
thing this spec exists to prevent.

The comment `// Spec §3.2 format: [ADV no] เบิก เคลียร์เงินทดลอง [employee] [document detail]`
points at an older design. It is replaced by one naming this document and the date.

---

## Tests

**Item 1**
- `everyFridayInMonth` — a month with four Fridays returns four, one with five returns five, and
  none of them is outside the month. Pinned against the fifth-Friday rollover specifically.
- AP-2's dates include Fridays that are neither the 2nd nor the 4th; AP-1's and AP-3's do not.
- A date that was valid before is still valid for AP-2 (the superset property).
- The AP-3 picker endpoint returns the fortnightly set while AP-2's returns the weekly one —
  the regression that the borrowed endpoint would have caused.
- AP-2's refusal says ต้องเป็นวันศุกร์; AP-1's still says ศุกร์ที่ 2 หรือ 4.

**Item 2**
- An expense line's description is the ADC number plus the line detail, exactly.
- A bank line's is the ADC number alone.
- A detail long enough to exceed 100 characters is cut at 100 with the ADC number intact —
  the property the old comment claimed and the new format makes easier to keep.
- No test asserts `เคลียร์เงินทดลอง` anywhere after this change.

## What a reader in six months needs to know

Payment calendars are **per form** and always were meant to be: the core function has taken the
rounds as an argument from the start, and AP-4 has had its own since before this change. If a
form starts paying on the wrong days, look at what its caller passes, not at the calendar.

The AP-3 journal's Description begins with the ADC number because that is what somebody holding a
posted BC journal can search AP-3 for. If it ever begins with an ADV number again, something has
reverted to `advanceRequestNo`.
