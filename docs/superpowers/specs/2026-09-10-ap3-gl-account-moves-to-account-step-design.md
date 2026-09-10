# AP-3 — the G/L account moves from the requester to the account officer

Date: 2026-09-10
Status: approved, ready for planning

## Why

The "รายการ" column on the actual-expense grid (`รายการค่าใช้จ่ายจริง`) is the
G/L account each receipt is charged to. It is asked of the requester today, and
the requester is the wrong person to ask: the chart of accounts is accounting's
instrument, the choice is branch-dependent, and getting it wrong is invisible to
the person making the choice.

It moves to the account officer — the `ACCOUNT` step — where it becomes
mandatory. Nothing about how the account is chosen changes; only who chooses it,
and when.

## Scope

The field is `AccClearAdvanceItem.GlAccountNo` / `GlAccountName`, rendered by
`GlPicker` and labelled "รายการ".

| | Decision |
|---|---|
| Requester's form | Column removed entirely — not merely optional |
| Manager step | Does not see the column |
| Account step (`ACCOUNT`) | Picks it, and must fill every posting line before approving |
| AI suggestion | Still runs at OCR time and rides along, so the account officer arrives at a pre-filled grid |
| Requester's later view | Does not see the column |
| Print sheet (AP-3.1) | Keeps the G/L — it is accounting's attachment |

Explicitly out of scope: the G/L master and its admin screens, the BU→G/L and
branch→G/L override maps, `FORCE_GL_NON_ROCKS_PC`, `allowedDimensionTypes`, the
ERP payload builder, and the AP-3 detail report.

## No schema change

`AccClearAdvanceItem.GlAccountNo` is `NVARCHAR(20) NULL` with no FK, CHECK or
default (`migrations/109_clr_clear_advance.sql:83`), and `saveAccountEdit` →
`persistClear` already rewrites every line field on each save. Nothing in the
database needs to move; what moves is who may write the column and who is
stopped when it is empty.

No backfill either. On 2026-09-10 no AP-3 line in UAT has an empty G/L in any
status, and production holds one AP-3 request, a Draft. Every request that
already passed the old submit-time check carries its account.

## Where the field lives

The per-branch option cache, the `glForced` lock, the "keep showing a stored
account the current filter no longer offers" fallback, and the clear-on-branch-
change rule are one behaviour that currently lives inline in
`ClearAdvanceForm.tsx`. Rather than copy it into `ClearAdvanceDetail.tsx`, it is
extracted so it has one home:

- `useGlOptionsByBranch()` — fetch + per-branch cache + retry
- `<GlCell>` — the cell: the picker, the locked cell when `glForced`, and the
  "เลือกสาขาก่อน" empty state

`ClearAdvanceForm.tsx` (2,142 lines) loses the logic; `ClearAdvanceDetail.tsx`
gains a caller. Total lines go down.

## Changes

| # | File | Change |
|---|---|---|
| 1 | `LinePickers.tsx` + new `useGlOptionsByBranch` | Extract `<GlCell>` and the option-cache hook |
| 2 | `ClearAdvanceForm.tsx` | Remove the `รายการ` header and cell (desktop `:1427`, mobile `:1539`), `glOptionsFor`, `glByBranch`, and the `glForced` banner `:1332` |
| 3 | `ClearAdvanceForm.tsx:631` | Remove the client-side presence check |
| 4 | `ClearAdvanceForm.tsx:335-348` | Keep clearing the G/L when a line's branch changes — now unconditionally, with no master fetch needed |
| 5 | `OcrConfirmModal.tsx` | Hide the cell and the "AI แนะนำ" badge; keep the suggestion effect `:220-251` so the guess still reaches the saved line |
| 6 | `clear-advance-request-service.ts:408` | Remove `!it.glAccountNo` from `validateForSubmit` |
| 7 | `clear-advance-approval-engine.ts` | New gate in the `step === "ACCOUNT"` block |
| 8 | `ClearAdvanceDetail.tsx:557` | Add the `รายการ` column with `<GlCell>` to the account-step grid, on the existing autosave |
| 9 | `ClearAdvanceDetail.tsx:265` | Add `missingGlLines` to `accountBlocked` |
| 10 | `requests/[id]/route.ts` GET + `ClearAdvanceDetail.tsx:1134` | Read-only grid shows the G/L only to accounting — see below |

## The gate

`clear-advance-approval-engine.ts` already refuses to leave the account step
when a VAT line has no vendor (`:74`), for a reason that reads the same here:
the account step is the last one that can edit lines, so anything the journal
needs must be present before it advances. The new check sits beside it and takes
the same shape — a pure helper returning 1-based row numbers, and a Thai error
naming them.

`linesMissingGl(items)` goes in `clear-advance-line-validation.ts`, which
already owns the line-level G/L rules (`isFilledLine`, `validateLineGlBranch`).

**Which lines it applies to.** Not `isFilledLine` — that counts a line carrying
only a description, which never reaches the journal and would block the step for
nothing. The rule is `amountBeforeVat !== 0`, the same condition `toJournalItems`
uses, so the gate demands an account for exactly the lines the journal will
carry and no others.

The UI reads the same helper against unsaved edits, the way the vendor block
already does at `ClearAdvanceDetail.tsx:257`:

```ts
const missingGlLines = linesMissingGl(isAccountStep ? editItems : items);
```

so the officer is blocked by what is on screen, not by what the 900 ms autosave
has managed to store.

### Where the gate is not

- Not in `saveAccountEdit` — the autosave would error on every keystroke while
  the grid is still being filled.
- Not in `validateForSubmit` — that is the check being removed.
- Not at the `HEAD` step. Once `ACCOUNT` approves, lines are frozen:
  `saveAccountEdit` requires `Status='Submitted' AND CurrentStepCode='ACCOUNT'`,
  and `saveDraft` requires Draft/Returned plus ownership, enforced both at
  `requests/[id]/route.ts:62` and again inside the transaction.

One gate is therefore sufficient to keep an empty account out of BC: the ERP
queue lists only `Status='Approved'`, `sendClrErpBatch` re-checks it, and the
only route from the account step to Approved passes through the gate.

## Who may see the column

`ClearAdvanceDetail` takes only `{ request, onChanged }` — it knows the
request's state but nothing about who is looking, and its `isAccountStep` flag
means "this request is sitting at ACCOUNT", not "you are the account officer".
It cannot answer this question on its own.

The server already answers it. `GET /api/request/clear-advance/requests/[id]`
calls `authorizeAccRequest`, which returns `{ row, viewer }`, and the route
currently discards it. `viewer.isAccountArea` is true when the viewer has
accounting-area access or is an active approver on this form's own roster, and
for AP-3 that roster check is literally `["ACCOUNT", "HEAD"]`
(`request-acl.ts:112-117`). The AP-3 roster holds only those two roles — the
line manager comes from the requester's `ManagerStaffId` in HR, not from the
roster — so the flag already means exactly "accounting, not the requester and
not the manager".

So the route keeps the value it already computes and returns
`canSeeGlAccount: viewer.isAccountArea` alongside the request, and
`ClearAdvanceDetail` takes it as a prop defaulting to `false`.

Two mount points, both correct under that default:

- `[id]/page.tsx:92` — fed by that GET, so it carries the real flag. This is
  where the account officer works; the approvals queue links here
  (`ClrApprovalsQueue.tsx:204`).
- `MyRequestsPanel.tsx:619` — the requester's own list. The flag is not passed,
  so the column stays hidden, which is the intended answer for that screen.

The editable account-step column is governed by the same flag, so an accountant
sees one grid rather than a picker they cannot save. Authorisation itself is
unchanged and stays where it is: `account-edit` refuses anyone who is not an
`ACCOUNT` approver or an admin, whatever the browser chose to render.

## Returned requests

`submitRequest:771` accepts only `Draft` and `Returned`, and a resubmit always
restarts at `MANAGER`. So:

```
Account fills the G/L → returns it → requester edits → resubmits
  → MANAGER → ACCOUNT again
```

The stored account survives that round trip: `glAccountNo` stays on the form's
line state, it is simply not rendered, and `persistClear` writes back what the
payload carries.

The exception is deliberate. If the requester changes a line's **branch**, the
G/L is cleared and the account officer picks again — the account is
branch-dependent, so a branch change genuinely invalidates it. Without this,
`assertLinesWritable` would reject the requester's own save with "หมวดบัญชี X
ใช้กับสาขา Y ไม่ได้" — an error about a field they can neither see nor fix.

## Behaviour that does not change

The account is still filtered by the line's branch through
`allowedDimensionTypes` (HQ or blank → `Employee` + `Both`; any other branch →
`Branch` + `Both`), still filtered server-side in `listGlAccounts` so the browser
never receives accounts it may not charge, still forced to
`FORCE_GL_NON_ROCKS_PC` for a non-home brand at `persistClear:515` with the cell
locked, and still validated for branch compatibility by `validateLineGlBranch`
inside `assertLinesWritable` on every save path. The branch is still chosen by
the requester, which is what makes the filter work when the account officer
arrives.

## Accepted trade-off

There is no "AI guessed / a human confirmed" marker. The gate checks that a
value is present, not that anyone looked at it, so an account officer can
approve a grid of unreviewed AI suggestions. This was chosen over adding a
column: the suggestion is already constrained to accounts that branch may
charge, and the marker can be added later without disturbing anything here.

## Tests

| Test | Where | Status |
|---|---|---|
| `linesMissingGl` — zero-amount lines ignored, blank and whitespace caught, 1-based row numbers, several rows | `clear-advance-line-validation.test.ts`, mirroring `tax-vendor-core.test.ts:51-67` | done |
| `glMissingMessage` — the officer is told which rows | `clear-advance-line-validation.test.ts` | done, replaces the planned approval-engine test |
| `glOptionsForLine` — branch's list, no branch, list not yet arrived, no duplicate, a stored account the branch no longer offers still renders first | `useGlOptionsByBranch.test.ts` | done |
| `useGlOptionsByBranch`'s fetch-and-cache effect | — | **not covered.** It is a React hook and this repo carries no renderer; adding one is a dependency decision for the owner, not something to slip into this change. The gap was not free: the effect shipped with a bug that dropped a 200 response and left the picker empty, caught in the browser and fixed in a follow-up commit |
| `<GlCell>` rendering — `glForced` lock, disabled with no branch | — | not covered, same reason |
| The detail GET returns `canSeeGlAccount` true for an `ACCOUNT`/`HEAD` approver and an admin, false for the requester and the line manager | — | **not covered.** `isAccountArea` is assembled from three IO calls in `buildAccAclViewer` with no pure seam to test against; verified by hand in the browser instead (true for an accounting viewer) |

## Open questions

None.
