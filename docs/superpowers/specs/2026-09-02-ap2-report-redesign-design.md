# AP-2 Control report — make it readable on a screen

## The problem, measured

The report renders all 28 columns of the AP-2-Control sheet at once.

| | |
| :--- | ---: |
| Columns | 28 |
| Table width | 3,801px |
| Viewport | 1,200px |
| **Off-screen** | **2,601px — 68%** |

What a reader opens this report to find is all off-screen: the amount is column 15,
Payment Date 24, Pending on 27, Overall Status 28. What fills the visible 1,200px instead
is columns 3–6 — staff id, full name, position, department — which repeat the same person
on every row.

So the two questions the report exists to answer, *how much* and *where is it stuck*,
both require scrolling past data that says the same thing on every line.

Three smaller faults compound it:

- The filter row is a strip of small `กรอง…` inputs under the header, so filtering a
  column means scrolling sideways to reach its box.
- Nothing is colour-coded; every cell has the same weight.
- A row opens the request on click, but the only thing that says so is a line of small
  text under the table.

## What this report is actually for

Not "a list of requests" — **a control report for outstanding advances**. The clearing
columns are the point of it, and they are currently hidden at positions 25 and 26.

The data makes that plain: of 27 AP-2 requests, **7** have an AP-3 clearing linked and
**20** do not. Those 20 render as two empty cells today, which reads as missing data
rather than "not cleared yet".

The existing overdue filter already encodes the report's purpose — approved, no approved
AP-3, past its promised clear date — but with the clearing columns off-screen the filter
cannot explain what it just filtered.

## The design

### Default columns — 11 of the 28

`วันที่ส่ง · เลขที่ ADV · ผู้ขอ · ผู้รับเงิน · ยอด (THB) · วันคาดเคลียร์ · วันจ่าย ·
เลขที่ ADC · สถานะเคลียร์ · รอที่ใคร · สถานะรวม`

About 1,150px — it fits, so ordinary use needs no sideways scrolling at all.

The other 17 stay reachable behind a column picker, and the choice is remembered per
browser. Nothing becomes unreachable; it stops being *in the way*.

`โอนให้` leaves the table and becomes a filter. Two possible values do not earn a column
on every row, but they do make a useful filter.

### Clearing status always says something

`advanceStatus` is null when no AP-3 exists, and the cell renders blank. Blank reads as
"we don't know". It becomes four explicit states:

| Shown | When |
| :--- | :--- |
| ยังไม่เคลียร์ | no AP-3 linked |
| กำลังเคลียร์ | an AP-3 exists and is still in approval |
| เคลียร์แล้ว | its AP-3 is approved |
| ส่งกลับแก้ไข | its AP-3 was returned |

This is a display decision, not a data change — the service already returns everything
needed to tell those apart.

### Summary tiles that filter

Above the table, four counts, each clickable as a filter and each showing what it counts:

- **รออนุมัติ** — still in the approval chain
- **รอส่ง ERP** — approved, not yet interfaced
- **ค้างเคลียร์เกินกำหนด** — the existing overdue rule, unchanged
- **ยอดรวม (THB)** — of the rows currently filtered, so it answers "how much am I looking at"

The overdue tile replaces the isolated button that does this today.

### Reading a row

Clicking a row opens `AdvanceDetailPanel` — the side panel AP-2 already has — instead of
navigating away and losing the filters. The full 28 fields live there, which is what makes
hiding 17 of them from the table safe.

### Status as colour

`สถานะรวม` and `สถานะเคลียร์` render as chips using the palette already defined in
`globals.css` (`--status-ok-*`, `--status-pending-*`, `--status-bad-*`). No new colours.

## Out of scope

**The Excel export does not change.** It keeps all 28 columns in AP-2-Control order —
that file is a deliverable with a fixed shape, and it answers a different question from
the screen. The screen answers "what needs attention"; the file answers "give me
everything".

Nothing about the report service, the filters' semantics, or the overdue rule changes.
This is presentation only.

## Testing

The column-visibility default, the clearing-status derivation and the tile counts are pure
functions and get unit tests. Layout, the picker and the panel are verified in the running
app against UAT data, where the expected numbers are known: 27 rows, 7 with a linked ADC,
20 not cleared, 8 overdue.
