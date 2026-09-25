# AP-3's reports: the reader's column order, and clicking an ADC number — Design

Date: 2026-09-24
Status: design approved (user, 2026-09-24)
Scope: **both consoles** — `R:\Form_Portal` and `R:\Acc_Portal`

## Purpose

CR group C: items 2 and 7 of the user's CR of 2026-09-23. Both are about AP-3's two reports
(Control and Detail) and neither changes an amount, a date, or anything that reaches Business
Central.

| CR item | Asked for | What it turned out to mean |
| --- | --- | --- |
| 2 | ย้ายคอลัมน์รายงาน | Not "move column X". **Give ACC Portal the drag-to-reorder Form Portal already has**, and make the reader's order carry into the Excel export in both consoles. |
| 7 | กดเลข ADC ดู Detail + Track | Make the ADC number a way into the claim's detail and its approval timeline, on the screens where it is dead text today. |

Item 2's meaning came from the user directly (2026-09-24): *"ทำเป็นแบบรายงานใน Form portal ที่ให้
User จัดเรียงเองได้"*. The original wording reads like a request to move one column; it is a request
for the **capability**, which one console has and the other does not.

## What already exists — this is most of item 7

Neither item starts from nothing, and knowing what is already built decides how much of this is new
code.

- **`ClearAdvanceDetail.tsx` already renders the approval timeline.** It is one component, in both
  repos, and the "Track" half of item 7 is a vertical step list inside it (status-coloured circle,
  connector, actor, comment, timestamp) driven by the pure `clrTimelineSteps()` in
  `src/lib/clr/clear-advance-timeline.ts`. **Nothing about Detail or Track needs building.**
- **Form Portal's Control report already does exactly what item 7 asks.** Its ADC cell is
  link-styled and the whole row pushes to `clearAdvanceDetailHref(row.id)`.
- **Form Portal already has drag-to-reorder**, in `ColumnToggleMenu`'s `onReorder` prop, persisted
  by `makeColumnPrefs` into `localStorage`.

So item 7 is *routing an existing screen from more places*, and item 2 is *porting an existing
control, plus one genuinely new piece* (the export following the order).

## The shape of the problem, in four components

The two repos are **independent copies**, not shared code — ACC's report components carry docblocks
saying they were ported from Form Portal and then diverged deliberately. So every decision below
lands in four places: 2 repos × 2 reports.

| | Form Portal | ACC Portal |
| --- | --- | --- |
| Routes | Control and Detail are two pages | one page, internal tab (`ClrReportTab.tsx`) |
| Reorder | yes | **no** — show/hide only |
| Export | server route, `GET …/report/export` | client-side, `loadXlsx()` |

## 1 · The reader's column order

### 1.1 ACC gets the control Form Portal has

ACC's `ColumnToggleMenu` is its own file and has no `onReorder`. It gains the same prop and the same
drag behaviour as Form Portal's, and both ACC reports pass it, persisting order under their own
`makeColumnPrefs` keys the way visibility already is.

**Persistence stays `localStorage`, per browser, exactly as today.** Nobody asked for a
server-side preference and adding one would mean a table, a migration and a per-user read on every
report load. The cost of the current design is that the order does not follow a reader to another
machine — a cost this change does not make worse.

### 1.2 The export follows the order — the part that is actually new

Today the on-screen order and the export's column list are **two independently maintained lists** in
all four components. Dragging a column on screen does nothing to the file. The user asked for the
move to reach both (*"ย้ายทั้งสองที่"*).

Two decisions, both the user's (2026-09-24):

**The export keeps its own column set; only the order follows the screen.** The Control export is
not the Control screen: it has no ตำแหน่ง and no วันที่โอนคืน column, and it splits the screen's one
signed คืน/เบิกเพิ่ม column back into separate โอนคืนบริษัท and เบิกเพิ่ม columns. Making the file
mirror the screen would silently change what a spreadsheet people already use contains. It does not.

**A hidden column still appears in the file.** Hiding is for reading; the export stays complete, so
a colleague receiving the file is never short a column because the sender had it hidden.

### 1.3 How the Control mapping works, precisely

Because the two lists differ, "order the export by the screen" needs a rule rather than an index.
Each screen column owns zero, one or two export columns:

| Screen column | Export column(s) |
| --- | --- |
| วันที่ส่ง · เลขที่ ADC · รหัสพนักงาน · เลขที่ ADV · ผู้ขอ · แผนก · วงเงินที่ได้รับ · เป็นค่าใช้จ่ายของ · รวมใช้จริง · ผู้จัดการอนุมัติ · บัญชี Action · รอที่ใคร · สถานะ | one each |
| คืน/เบิกเพิ่ม | **two** — โอนคืนบริษัท, เบิกเพิ่ม |
| PV | **two** — PV, Payment Date |
| ตำแหน่ง · วันที่โอนคืน | **none** |

The rule: walk the reader's screen order; emit each screen column's export columns in the fixed
order shown above; a screen column owning none emits nothing. The result is always the same 17
export columns in some permutation — never more, never fewer, and the two-column groups never
separate.

### 1.3.1 Why the export becomes a list of column descriptors, not a reordered header

Reordering the header array alone would be wrong, and silently so. Each Control export today is
three positional arrays that must agree: `header`, each `body` row, and a **totals row** whose sums
sit at fixed indices (`advanceAmount` at 6, `actualTotal` at 8, `refundToCompany` at 9,
`extraToEmployee` at 10). Permute the header and leave the totals row alone and the sums appear
under whichever headers happen to land above them — a report that looks right and is not.

So the export is expressed once, as an ordered list of **descriptors** — `{ key, header,
value(row), total? }` — from which the header row, the body rows and the totals row are all derived.
Reordering then means reordering one list, and the three rows cannot drift apart because there is
only one list. ACC's client-side export has the same three arrays and the same hazard, and takes
the same shape.

This is a pure function of `(screenOrder) → exportKeys[]` with no React and no I/O in it, so it is
the one part of item 2 that can be tested directly, and it is the part most likely to be got wrong.
It is **shared in name and behaviour across the two repos** (each repo its own copy, kept
identical), because a file whose column order depends on which console produced it is worse than
either order.

The Detail report needs the same function but its mapping is 1:1 across all 21 columns. **Its export
headers are worded differently from its screen headers** — "Request no." against "เลขที่เคลียร์",
"รหัสสาขา" against "สาขา", and so on — and that stays. The mapping is by key and position, not by
label; nobody should "tidy" the two wordings into agreement while doing this.

### 1.4 Getting the order to Form Portal's server export

ACC builds its file in the browser and already has the order in hand. Form Portal's export is a
`GET` API route, so the order has to travel: the client appends it to the existing query string and
the route reads it.

**The route validates rather than trusts.** An unknown key is dropped, a duplicate is taken once,
and any export column whose screen column is missing from the submitted order is appended in the
default order. So a stale `localStorage` value, a hand-edited URL, or a future column the browser
has not heard of all degrade to "the default order", never to a missing column or a crash. Absent
the parameter entirely, the route behaves exactly as it does today.

## 2 · Clicking an ADC number

The number becomes a way into `ClearAdvanceDetail` — which is detail *and* track — on these screens
(user, 2026-09-24):

| Screen | Repo | Today | After |
| --- | --- | --- | --- |
| ERP Interface queue | both | plain text, ~8 places | opens the claim |
| Control report | ACC | plain bold text | opens the claim |
| รออนุมัติ approvals queue | Form Portal | plain text + a separate "เปิด →" button | the number opens it too |
| Detail report | both | plain text | opens the claim |
| Control report | Form Portal | already opens it | unchanged |

### 2.1 Form Portal navigates; ACC opens a drawer

Form Portal has a per-claim route and already uses it: `clearAdvanceDetailHref(id)`.

**ACC has no per-claim route at all** — its `ClrControlReport.tsx` says so in a comment, as the
reason its ADC is not link-styled: *"there is nowhere for a click to go"*. It opens the claim as a
`SidePanel` drawer from its approvals queue instead.

The user chose the drawer (2026-09-24) rather than a new ACC route. It keeps the reader's place in a
long filtered report, matches the one ACC pattern that exists, and costs no new page. The price is
that the view has no URL to send anyone — accepted, and worth writing down because the next person
will wonder.

### 2.2 The drawer opened from a report is read-only

ACC's existing drawer renders `ClearAdvanceDetail` **and** `ClrAccountWorkspace` — the ACCOUNT-step
action surface, which is right in an approvals queue because everything there is waiting for that
step.

A report spans every status, and so does the ERP interface queue. **Those drawers render
`ClearAdvanceDetail` alone.** Offering the account actions beside a claim that is sent, cancelled or
still with the manager invites an action that does not belong to the reader's current job, and the
approvals queue remains the one place that step is taken.

### 2.3 Permissions need no change, and that is a finding, not an assumption

`GET /api/request/clear-advance/requests/{id}` is gated by
`authorizeAccRequest(user, id, "read", AP3_FORM_CODE)`, whose read rule is
`isOwner || isRequestSubject || isAssignedManager || viewer.isAccountArea`. **`isAccountArea` already
grants read on any AP-3 claim, not only those in the viewer's queue** — so every screen in the table
above is already reachable by whoever can see the list it sits in. This change exposes no claim that
the viewer could not already open.

## Not in scope

- Changing which columns either report has, or what the export contains.
- Server-side column preferences.
- A per-claim route in ACC Portal.
- Touching AP-1, AP-2 or AP-4 reports.
- CR items 8 (the G/L suggest button) and anything from groups A/B.

## Tests

Form Portal runs `node:test` through `tsx scripts/run-tests.ts` — no vitest, no component renderer.
ACC Portal runs vitest. Neither can render these React tables, so what gets tested is what can be
tested honestly:

- **The export ordering function**, in both repos, directly: the identity case, a dragged order, the
  two-column groups staying adjacent and in their fixed internal order, a screen column with no
  export column contributing nothing, an unknown key ignored, a missing key appended, a duplicate
  taken once — and, as the property that matters most, **the output is always a permutation of the
  default export columns**, for any input.
- **Form Portal's export route**, for the validation above: no parameter behaves as today.
- **Source-scan guards**, in the established `*-guard.test.ts` style, for the two things review
  cannot see and the compiler will not catch: that no ADC cell named in the table above is still
  plain text, and that the report and ERP-queue drawers do **not** import `ClrAccountWorkspace`
  (§2.2 is a decision a later edit could quietly undo).
- The rest — that a drag actually reorders, that a drawer opens — is verified by driving both apps.

## What a reader in six months needs to know

**The export's column set is deliberately not the screen's.** If they ever look identical it is a
coincidence to be checked, not an invariant: the Control export splits one screen column into two
and omits two others, on purpose, because the file is consumed by people who are not looking at the
screen.

**ACC's claim view has no URL.** That is a decision, not an omission — if someone needs to link to a
claim in ACC, the drawer is not the thing to extend; a route is, and the reason ACC never had one is
in `ClrControlReport.tsx`'s own header.
