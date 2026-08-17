# Parallel UAT — design

**Date:** 2026-08-18
**Status:** approved, ready for an implementation plan
**Supersedes:** the either/or `FormEnvironment.Environment` flag from `2026-08-14-per-form-environment-design.md`

## Problem

Today a form is *either* Production *or* UAT for everybody. Testing AP-1 means
flipping every AP-1 user into the test database, so testing can only happen when
nobody is working — and the tester's approvals land on a real manager who is not
in the test.

What is wanted: **Production and UAT open at the same time**, with UAT visible
only to people configured for it.

## The model

Each form carries two independent switches, not one choice:

| `ProductionEnabled` | `UatEnabled` | Result |
|---|---|---|
| on | off | Today's normal state. Everyone uses the production database. |
| on | on | Everyone stays on production; a tester in UAT mode uses the UAT database. |
| off | on | The form exists only for testers — how a new form (AP-15) is piloted before release. |
| off | off | The form is hidden from everyone. |

A tester is a row in a new `UatTester` list. Being on the list does not move
anyone by itself: each tester flips their own **UAT mode** switch when they want
to test, so someone who is both an admin and a real user keeps working normally
until they ask not to.

## Resolution

`resolveFormEnvironment()`, in order:

1. **The record decides, when there is one.** If the path carries a request id
   and `classifyPath` says the route belongs to a form, the id picks the
   database: `>= 900000` → UAT, below → Production. UAT identities start at
   900000 (migration 061), so an id names its own database.
   This also fixes a bug that exists today: a manager opening a tester's UAT
   request resolves by flag and looks in the wrong database.
2. **The viewer, when they asked for it.** Cookie `form-portal-uat-mode` set,
   **and** the signed-in user is an active `UatTester`, **and** the form has
   `UatEnabled` → UAT. The cookie is only a hint; membership is checked server
   side on every resolve, so a forged cookie changes nothing.
3. **The form's own switch.** `ProductionEnabled` → Production.
4. Neither switch on → the form is unavailable (see below).

## Availability

Environment and availability are different questions, so they get different
answers: `resolveFormEnvironment()` keeps returning `"Production" | "UAT"` and
defaults to Production, while a new `resolveFormAccess(formCode)` returns
`{ environment, available }` for the current viewer.

Which switch answers depends on the mode the viewer is in — one switch each,
never both:

| Viewer | A form is available when | It resolves to |
|---|---|---|
| in UAT mode (active tester, cookie on) | `UatEnabled` | UAT |
| everyone else | `ProductionEnabled` | Production |

So a tester who switches to UAT sees exactly the forms that are open for
testing and nothing else — `ProductionEnabled` stops mattering to them until
they switch back. It also means switching to UAT can shorten the catalogue,
which is the intended signal that you are somewhere else.

Enforcement, deliberately narrow in this pass:

- The Home catalogue and the Request hub hide a form the viewer cannot use.
- The write choke points — `saveDraft` and submit, for both AP-1 and AP-17 —
  refuse with a Thai message naming the reason.

Read routes are not gated. A tester who kept a tab open can still read what they
already have; nothing new is written, and hiding the entry points is what stops
people finding a switched-off form.

## Manager resolution

`resolveManagerInfo()` and `resolveManagerEmail()` in
`src/lib/acc/employee-context.ts` are the only two functions AP-1 and AP-17 use
to find an approver, so the override lives there.

- **Production** — `Rocks_Portal_HR.Employee.ManagerStaffId`, exactly as now.
- **UAT** — `UatTester.ManagerStaffId` for the requester, then HR for that
  person's name, email and photo, so the approval row is shaped identically.
- **UAT with no manager configured** — `hasManager: false` with
  `"โหมด UAT: ยังไม่ได้กำหนดผู้จัดการสำหรับ UAT — ตั้งที่ Settings → UAT Users"`.
  The submit is blocked. Falling back to the HR manager was rejected: a real
  manager would see a test request in their queue, which is the exact thing this
  design exists to prevent.

## Data

Both tables live in `Fast_Core`, beside the existing `FormEnvironment`: they must
be readable whichever pool the request resolves to, they are not per-environment
data, and they survive a rebuild of the UAT database.

**`FormEnvironment`** — replace the `Environment` column:

```sql
ALTER TABLE [dbo].[FormEnvironment] ADD ProductionEnabled bit NOT NULL DEFAULT 1;
ALTER TABLE [dbo].[FormEnvironment] ADD UatEnabled bit NOT NULL DEFAULT 0;
-- literal conversion: a form that was UAT was UAT for everyone, so production was off
UPDATE [dbo].[FormEnvironment]
   SET ProductionEnabled = CASE WHEN Environment = 'UAT' THEN 0 ELSE 1 END,
       UatEnabled        = CASE WHEN Environment = 'UAT' THEN 1 ELSE 0 END;
ALTER TABLE [dbo].[FormEnvironment] DROP COLUMN Environment;
```

The conversion is literal rather than convenient: the three forms currently
flagged UAT become tester-only, and whoever wants them back on Production turns
that switch on deliberately.

**`UatTester`** — new:

| Column | Type | Note |
|---|---|---|
| `Id` | int identity PK | |
| `StaffId` | int NOT NULL UNIQUE | HR StaffId of the tester |
| `Email` | nvarchar(200) NOT NULL | login email, matched case-insensitively |
| `ManagerStaffId` | int NULL | null blocks submits in UAT |
| `ManagerEmail` | nvarchar(200) NULL | denormalised for the approval row |
| `IsActive` | bit NOT NULL DEFAULT 1 | |
| `UpdatedBy` / `UpdatedAt` | int / datetime2 | |

## Screens

- **Settings → Form Environment** — each row gets two switches instead of one
  segmented control, plus the counts it already shows. Turning **Production off**
  hides a form from everyone, so that one keeps the typed-`Confirm` gate;
  the other three transitions take a plain confirmation.
- **Settings → UAT Users** (System Admin) — add a person from AD, set their UAT
  manager, activate/deactivate, remove. New card on the Settings hub.
- **UAT mode switch** — a PRO/UAT control in the navbar, rendered only when both
  are true: the viewer is an active tester, **and** at least one form has
  `UatEnabled`. With no form open for testing there is nothing to switch to, so
  the navbar stays clean and nobody else ever sees the control. While UAT is
  selected the same control is the standing `UAT MODE` marker, because a cookie
  outlives the session that set it.
- **Chips and filters** — every PRO/UAT chip and the My Requests / My Work
  filtering switch from the raw flag to what resolves *for this viewer*, so a
  tester in UAT mode never reads `PRO` while writing to UAT.

## Testing

Two pure functions carry the logic and get `node:test` coverage:

- `requestIdFromPath(path)` — the id a form-scoped route is acting on, or null.
- `pickEnvironment({ idEnvironment, viewerUat, form })` — the precedence table
  above, including the unavailable case.

Everything else is I/O and UI; `tsc` carries the signature changes, and the
end-to-end check is manual: two browsers, one tester in UAT mode and one
ordinary user, both filing AP-1 at the same time, landing in different databases
with different approvers.

## Risks

- **A tester forgets they are in UAT mode** and reports a real request missing.
  Mitigated by the standing navbar marker and by every chip showing the
  viewer's own environment.
- **`Production off` hides a live form.** It is System-Admin only and behind the
  typed confirmation, and the switch is visible on the same page.
- **The two databases drift** in master data. Unchanged from today: dual-write
  covers the 19 shared tables and `npm run check:alignment` asserts it.

## Out of scope

- Gating read routes on availability.
- A UAT twin for anything outside the form database.
- Letting a tester pick *which* form goes UAT for them individually — UAT mode is
  all-or-nothing across the forms that have `UatEnabled`.
