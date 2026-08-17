# Parallel UAT — design

**Date:** 2026-08-18 (revised the same day, after discovery)
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

**The whole approval chain of a UAT request stays inside the tester group.** A
production user must never see or act on test data, so a UAT request is only
completable if the people it routes to are testers too. Two consequences, both
enforced rather than documented:

- a tester's configured UAT manager must themselves be an active tester;
- at least one account approver (`AccApprover`) must be an active tester, or
  UAT requests stall at the ACCOUNT step. The UAT Users page says so out loud
  when it is not true.

## Resolution

One function answers, and **everything keys off its answer** — never off the
cookie directly. `resolveFormEnvironment()`, in order:

1. **The record decides, when there is one.** If the path carries a request id
   and `classifyPath` says the route belongs to a form, the id picks the
   database: `>= 900000` → UAT, below → Production. UAT identities start at
   900000 (migration 061), so an id names its own database.
   **Bound:** the UAT answer requires the form to have `UatEnabled` *or* the
   viewer to be an active tester. Without that bound, turning UAT off closes
   nothing — any id ≥ 900000 would still open the UAT database to anybody.
2. **The viewer, when they asked for it.** Cookie `form-portal-uat-mode` set,
   **and** the signed-in user is an active `UatTester`, **and** the form has
   `UatEnabled` → UAT. The cookie is only a hint; membership is checked server
   side on every resolve, so a forged cookie changes nothing.
3. **The form's own switch.** `ProductionEnabled` → Production.
4. Neither switch on → the form is unavailable (see below).

Identity reaches the resolver as a header the proxy injects
(`x-user-email`, set beside the existing `x-pathname` from the token
`src/proxy.ts` already decodes). The resolver must **not** import `@/lib/auth`:
`getFormPool()` dynamically imports this module, and `auth()` runs a `jwt`
callback that reads Fast_Core — one future edit away from
`getFormPool → auth → jwt → getFormPool`. The membership lookup itself is a
Node-side `getCorePool()` read, because the proxy runs on the Edge runtime where
`mssql` cannot load. Every request-scoped read added here keeps the existing
`try/catch` around `headers()`, or scripts and background jobs start throwing
instead of resolving Production.

## Availability

Environment and availability are different questions, so they get different
answers: `resolveFormEnvironment()` keeps returning `"Production" | "UAT"` and
defaults to Production, while `resolveFormAccess(formCode)` returns
`{ environment, available }`. It takes the form code as an argument — Home asks
about AP-1 and AP-17 while sitting on `/`, where the path classifies as nothing.

| Viewer | A form is available when | It resolves to |
|---|---|---|
| in UAT mode (active tester, cookie on) | `UatEnabled` | UAT |
| everyone else | `ProductionEnabled` | Production |

So a tester who switches to UAT sees exactly the forms open for testing and
nothing else. Switching can shorten the catalogue, which is the intended signal
that you are somewhere else.

Enforcement:

- The Home catalogue and the Request hub hide a form the viewer cannot use.
- The write choke points — `saveDraft` and submit, for AP-1 and AP-17 — refuse
  with a Thai message naming the reason. **They check the resolved environment,
  not the viewer's mode**: require `productionEnabled` when the request resolves
  Production, and (active tester ∧ `uatEnabled`) when it resolves UAT.
  Otherwise a tester editing a UAT draft with UAT mode off would be green-lit
  by the viewer table while the id rule sent the write to UAT.

Read routes are not gated. Hiding the entry points is what stops people finding
a switched-off form; nothing new is written either way.

## Manager resolution

> **Correction (Task 10).** This section originally said `resolveManagerInfo()`
> and `resolveManagerEmail()` in `src/lib/acc/employee-context.ts` were "the only
> two functions AP-1 and AP-17 use to find an approver, so the override lives
> there". That was wrong on both halves, and the shipped code does something
> else. What follows describes what was built.

There are **three** places an approver is resolved, not one, and the UAT override
lives in two of them:

- **The preview** — `resolveManagerInfo(loginEmail, formCode?, requestId?)`
  (`src/lib/acc/employee-context.ts`), shared by AP-1 and AP-17 and called from
  `/api/me/employee`, `/api/request/accounting/requesters` and
  `/api/request/travel-booking/requesters`. This is the manager card. It swaps in
  `uatManagerFor()` when the resolved environment is UAT, and returns
  `hasManager: false` with `FORM_UNAVAILABLE_ERROR` when the form is not writable
  — judged on `resolveFormWritable`, not `available`, so the card agrees with the
  submit.
- **AP-1's submit** — `resolveRequesterForActor()` → `withUatManager()`
  (`src/lib/acc/employee-context.ts`), on a `RequesterSnapshot`.
- **AP-17's submit** — `resolveEmployeeForActor()` → its own `withUatManager()`
  (`src/lib/hr/employee-lookup.ts`), on an `EmployeeContext`. **AP-17 does not
  share AP-1's resolver.** The two `withUatManager` helpers are deliberate
  duplicates of one rule over two different snapshot types; changing the rule
  means changing both.

`resolveManagerEmail()` is the third function and is **deliberately not
overridden**. It maps a StaffId to an email and nothing else. Overriding it too
would pair the production manager's `AssignedTo` with the UAT manager's
`AssignedEmail`, and `canActManagerStep` accepts either — so both people could
act on the same row.

All of the overrides are **keyed on `resolveFormEnvironment()`, never on the
cookie.** A tester in UAT mode opening their own production claim resolves
Production by id, and must get their real HR manager; keying on the cookie would
write a test manager onto a live claim.

- **Production** — `Rocks_Portal_HR.Employee.ManagerStaffId`, exactly as now.
- **UAT** — `UatTester.ManagerStaffId` for the requester, then HR for that
  person's name, email and photo, so the approval row is shaped identically.
- **UAT with no manager configured** — `hasManager: false` with
  `"โหมด UAT: ยังไม่ได้กำหนดผู้จัดการสำหรับ UAT — ตั้งที่ Settings → UAT Users"`,
  and the submit is blocked. Falling back to the HR manager was rejected: a real
  manager would see a test request in their queue.
- **On behalf of someone else** — both forms resolve the manager of the
  *requester*, not the actor. In UAT the requester must therefore be a tester
  too; if they are not, the submit is refused with a message saying so, rather
  than silently resolving an HR manager.

## Notifications

`applyUatRedirect` currently rewrites every UAT message to `UAT_MAIL_REDIRECT`,
justified by "approval chains resolve against production HR in both
environments" — the assumption this design removes. If it stays as-is, the UAT
manager is never told there is something to approve.

The redirect gains one exception: a recipient who is an active tester (by
`UatTester.Email`) or a configured UAT manager gets the mail at their own
address, still subject-prefixed `[UAT]`. Everyone else keeps the rewrite, and
the loud throw when `UAT_MAIL_REDIRECT` is unset stays.

## Data

Both tables live in `Fast_Core`, beside the existing `FormEnvironment`: they must
be readable whichever pool the request resolves to, they are not per-environment
data, and they survive a rebuild of the UAT database. `Fast_Core` is shared with
Rocks Fast, but nothing in that repo references `FormEnvironment`.

**`FormEnvironment`** — replace the `Environment` column:

```sql
ALTER TABLE [dbo].[FormEnvironment] ADD ProductionEnabled bit NOT NULL DEFAULT 1;
ALTER TABLE [dbo].[FormEnvironment] ADD UatEnabled bit NOT NULL DEFAULT 0;
UPDATE [dbo].[FormEnvironment]
   SET ProductionEnabled = 1,                                   -- every form stays live
       UatEnabled = CASE WHEN Environment = 'UAT' THEN 1 ELSE 0 END;
ALTER TABLE [dbo].[FormEnvironment] DROP COLUMN Environment;
```

The conversion turns Production back on for everything. A literal conversion was
rejected: all three configured forms are `'UAT'` today, so it would set
`ProductionEnabled = 0` across the entire catalogue while `UatTester` is still
empty — every form invisible to every user, including requests mid-approval.

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

**UAT identity floor** — a third migration, guarded like 061
(`IF DB_NAME() NOT LIKE '%[_]UAT' RAISERROR`), puts `CHECK (Id >= 900000)` on the
reseeded transactional tables in the UAT database. Rule 1 makes the 900000 seed
load-bearing for *writes*, and nothing currently asserts it: a UAT database
restored without the reseed would issue small ids that the resolver then reads
as production records.

**Running numbers** — `allocateRequestNo` keys `AccSequence` on Prefix+Year and
inserts `LastSeq = 1` for a year it has not seen. The UAT offset is two seeded
rows for 2026 only, so on 1 January both databases start issuing identical
numbers. The starting value becomes a function of the resolved environment
inside `allocateRequestNo`, not a seeded row.

## Caching

This design is the first time two viewers of one route resolve to different
databases, which breaks an assumption in the process-global caches
(`src/lib/acc/acc-cache.ts`, a `globalThis` Map). `loadPrepDeptContext()` caches
`AccBrandErpInterface` reads under a constant key.

Invariant, to be checked during review: **nothing derived from a form-pool read
may live in a process-global cache under a key that omits the environment.**
`prep-dept-ctx` gets the environment in its key; `journalContextCacheKey`
already has it.

## ERP send

`POST /api/request/accounting/erp-prep/send` carries only `{ interfaceTarget }`
— no ids — so under this design the sender's own cookie decides which Business
Central instance a batch reaches, with nothing tying the click to the queue that
was displayed.

The environment becomes an explicit input: the prep GET returns the resolved
environment and the ids it listed, the POST echoes both, and a mismatch is a 409
rather than a re-resolve. A batch is then posted to the instance the operator was
looking at, or not at all.

## Screens

- **Settings → Form Environment** — two switches per row instead of the
  segmented control, plus the counts it already shows. Turning **Production off**
  hides a form from everyone, so that one keeps the typed-`Confirm` gate; the
  other three transitions take a plain confirmation.
- **Settings → UAT Users** (System Admin) — add a person from AD, set their UAT
  manager, activate/deactivate, remove. Refuses a UAT manager who is not an
  active tester. Warns when no `AccApprover` is a tester, because UAT requests
  would stall at the ACCOUNT step.
- **UAT mode switch** — a PRO/UAT control in the navbar, rendered only when the
  viewer is an active tester **and** at least one form has `UatEnabled`. With
  nothing open for testing there is nothing to switch to, and nobody else ever
  sees the control. While UAT is selected the same control is the standing
  `UAT MODE` marker, because a cookie outlives the session that set it.
- **Chips and filters** — every PRO/UAT chip and the My Requests filtering
  switch from the raw flag to what resolves *for this viewer*. My Work follows
  the same rule: a UAT request is worked by testers in UAT mode, which is what
  keeps production queues clean.
- **Record banners** — `UatDataBanner` gains its counterpart: when the viewer is
  in UAT mode and the record resolves Production, the page says so. A screen may
  label the *record* or the *viewer*, and it must never let the two disagree
  silently while a destructive action is on offer.

## Testing

Pure functions, each with `node:test` coverage:

- `requestIdFromPath(path)` / `environmentFromPath(path)` — done.
- `pickEnvironment({ idEnvironment, viewerUatMode, form })` — done.
- the redirect exception predicate, and the availability check used by the write
  choke points.

Everything else is I/O and UI; `tsc` carries the signature changes. The
end-to-end check is manual and specific: two browsers, a tester in UAT mode and
an ordinary user, both filing AP-1 at the same time, landing in different
databases with different approvers, and the UAT request walking all the way to
ERP prep without ever appearing to the production user.

## What discovery changed

A nine-agent survey of the codebase found seven blocking gaps in the first
draft. Each is now handled above:

1. ACCOUNT step and AP-17 booking queue had no UAT path → the chain must be
   staffed by testers, enforced on the UAT manager and warned about for
   `AccApprover`.
2. A non-tester UAT manager could not discover the request → the UAT manager
   must be a tester, so they see it in UAT mode.
3. The literal migration hid every form from everyone → the conversion turns
   Production on for all.
4. Manager resolution keyed on the viewer would write a test manager onto a real
   claim → it keys on the resolved environment.
5. The ERP send resolved from the sender's cookie → the environment is echoed
   and verified.
6. Rule 1 ignored `UatEnabled`, leaving the UAT database open to everyone →
   bounded.
7. Availability checked the viewer while the pool followed the record → both
   check the resolved environment.

## Out of scope

- Gating read routes on availability.
- A UAT twin for anything outside the form database.
- Per-form UAT mode for an individual tester — UAT mode is all-or-nothing across
  the forms that have `UatEnabled`.
- Extending the settings coverage panel to id-bearing routes (worth doing later:
  nothing warns when a new id-bearing route is added that the resolver should be
  reading).
