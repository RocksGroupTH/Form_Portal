# AP-3 Control report — make it fit the screen, and let filters stack

## Why

The two Control reports are read together: AP-2 answers *who has not cleared their
advance*, AP-3 answers *how they cleared it*. AP-2's report was widened past the screen by
carrying every export column, and was fixed on 2026-09-02
(`docs/superpowers/specs/2026-09-02-ap2-report-redesign-design.md`). AP-3 has the same
fault, smaller.

Measured on the running app: 18 columns, table **1,975px** in a **1,341px** container —
**634px off-screen**.

## Scope

Two things: reduce the default columns behind a picker, and make the column filters accept
several values at once.

### Stacked filters

A column filter takes repeated picks instead of one value; each becomes a removable chip.
Values OR within a column and AND across columns — the same semantics and the same CSV
state shape as AP-2, so the two reports behave identically rather than merely similarly.

The from/to submission range **stays a range**. AP-2 uses multi-pick dates because payment
rounds land on fixed Fridays and accountants pick individual rounds; a submission window is
not that.

Deliberately **not** included:

- **Summary tiles.** Not asked for.
- **The overdue/aging filter.** In AP-2 it means *money went out and no clearing came back
  past its due date*. Every row in the AP-3 report **is** a clearing that was filed, so
  the same rule matches nothing meaningful here. Ageing an approval queue is a different
  question with a different threshold, and nobody has asked for it.

## Already correct — do not "fix"

The audit found two of the three things AP-2 needed are already right here:

- **Christian-era years, in full.** `fmtDateTime` / `fmtDateOnly` in `ClrReportShared.tsx`
  use local getters and `getFullYear()`; dates render `28/08/2026`. No `+543` anywhere.
- **No timezone date bug.** Those helpers never call `toISOString()` for display and say so
  in a comment. AP-2's off-by-one never existed here.

Leave both alone.

## The design

### Default columns — 10 of the 18

`วันที่ส่ง · เลขที่ ADC · เลขที่ ADV · ผู้ขอ · วงเงินที่ได้รับ · รวมใช้จริง ·
คืน/เบิกเพิ่ม · PV · รอที่ใคร · สถานะ`

`คืน/เบิกเพิ่ม` is one column, not two. `refundToCompany` and `extraToEmployee` are the
two signs of the same number — on the current data every non-zero case is one or the
other, never both — so one signed column with the direction shown reads better than two
mostly-empty ones. **On screen only:** the export keeps both columns exactly as they are.

The other eight — staff id, position, department, expense-of, refund transfer date, and
the three approver name/date pairs — go behind a column picker, remembered per browser,
using the same `ColumnToggleMenu` AP-2 uses.

### Width, learned from AP-2

Fewer columns was not enough there; the filter row set the widths. An eleven-character
document number reserved 161px because the filter box under it did, and a native `select`
was as wide as its longest option. Apply the same three fixes if they appear here:
`size={1}` on text filter inputs, a cap on select filters, and a max-width with ellipsis
(plus `title`) on free-text columns like the requester name.

Target: fits 1,341px with no horizontal scrolling.

## Out of scope

**The Excel export keeps all 18 columns in their current order.** Same rule as AP-2: the
file is the complete record, the screen answers "what needs attention". No change to
`clear-advance-report-service.ts` or to the row data.

What a filter *means* does not change either — only how many values it takes at once.

## Testing

The default-visible column set and the direction column are pure functions and get unit
tests. Live figures on UAT: **7 rows** (5 Approved, 2 Submitted), **2** pay-extra cases,
**0** refund cases. Verify the rendered table width before and after in the running app.

For the filters, check the two directions explicitly: two picks in one column must *widen*
the result, and picks in two different columns must *narrow* it. A stacked filter that
quietly ANDs within a column looks like it works until someone picks two statuses and gets
nothing.
