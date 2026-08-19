# Form Portal documentation

The developer guide is [`../CLAUDE.md`](../CLAUDE.md) — architecture, auth, the
parallel Production/UAT design, conventions and deployment. Everything here is
supporting material.

| Path | What it is |
|---|---|
| [`UI-GUIDE.md`](UI-GUIDE.md) | The **Sky** design system — palette, tokens, components, layout rules. Written to be copied into other Rocks Group apps; swap the palette section and the structural guidance still applies. |
| [`superpowers/specs/`](superpowers/specs/) | Design specs — the intended behaviour of a change, written before it was built. |
| [`superpowers/plans/`](superpowers/plans/) | Implementation plans — the step-by-step execution of a spec. |
| [`reviews/`](reviews/) | Completed code and security reviews, kept as the record of what a remediation commit answered. |

## Reading these as history, not as current state

Specs and plans are dated and are **not** revised after the work ships. They
describe the design at the moment it was written, so where one disagrees with
the code, the code wins and `CLAUDE.md` is the current statement of intent.
Several name things that no longer exist — the Form Builder, `Fast_Form` as this
app's database, `ROCKS-UI-GUIDE.md` — because they were true when written.

The exception is `superpowers/specs/2026-08-18-parallel-uat-design.md`, which
`CLAUDE.md` cites as the standing rule for who may see a UAT record.

## Current specs and plans

| Date | Subject |
|---|---|
| 2026-08-10 | Form Portal clone from Rocks Fast — spec + plan |
| 2026-08-13/14 | Splitting this app's data out of `Fast_Form` into `Rocks_Portal_Form` |
| 2026-08-14 | Per-form environment switches; UAT mode |
| 2026-08-17 | Per-form ERP environment |
| 2026-08-18 | Parallel Production/UAT; TeamMember separation |
