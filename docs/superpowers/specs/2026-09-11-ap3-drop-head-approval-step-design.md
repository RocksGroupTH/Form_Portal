# AP-3 — the head-accounting approval step is removed

Date: 2026-09-11
Status: approved, ready for implementation
CR item: 1 (ไม่มีหัวหน้าบัญชี Approve แล้ว)

## Why

AP-3 approves through MANAGER → ACCOUNT → HEAD. The CR removes the third step:
accounting approves and the clearing is done.

The step was never a second decision. The account officer chooses the G/L
accounts, the vendors, the ภ.ง.ด. types and the payment date; the head step can
edit none of them and offers a checkbox, an approve and a reject. In practice
it is a signature after the work, and the business has decided it is not worth
the wait.

## The chain

`CLR_NEXT_STEP.ACCOUNT` becomes `null`. Approving the account step sets the
request `Approved` with no current step, which is what puts it in the ERP
interface queue — the same transition HEAD used to make, one step earlier.

**No migration.** Both CHECK constraints keep `'HEAD'`:
`CK_AccClearAdvanceApproval_Step` because 29 historical approval rows carry it
and narrowing the constraint would fail against them, and
`CK_AccClearAdvanceApprover_Role` for the same reason on the roster table. The
chain has never been enforced by the database — `CLR_NEXT_STEP` is what decides
what comes next, and nothing writes a `HEAD` row once it says `null`.

No request is sitting at HEAD (checked on both databases), so there is nothing
to drain before this ships.

## History stays readable

`CLR_STEP_CODES` becomes `["MANAGER", "ACCOUNT"]` — it is the chain, and it is
what the detail timeline draws.

A request approved before today has a third approval row, and dropping it from
the timeline would quietly rewrite what happened to it. So the timeline draws
the chain plus any step the request actually has an approval row for. New
requests show two; the old ones still show all three, with the head step's name
and date where they always were. `CLR_STEP_LABEL_TH` keeps its `HEAD` entry for
exactly that.

## Removed from the screens

| Where | What |
|---|---|
| `ClearAdvanceDetail.tsx` | the head step's action block (`isHeadStep`) |
| `ClrApprovalsQueue.tsx` | the `หัวหน้าบัญชี` queue filter |
| `ClrApproverSettings.tsx` | the `HEAD` role tab and its column |
| `ClearAdvanceForm.tsx` | `ลำดับอนุมัติ: ผู้จัดการ → บัญชี → หัวหน้าบัญชี` |
| `admin/page.tsx` | the card description naming both roles |
| `ClrControlReport.tsx`, `report/export/route.ts` | the `หัวหน้าบัญชีอนุมัติ` column and its CSV pair (user, 2026-09-11) |

The report columns go with the rest. They are the last place the 29 historical
approvals were visible, and the decision is that a column blank on every row
from here on is worse than losing sight of them — the approval rows themselves
are still in `AccClearAdvanceApproval`.

## Permissions

Being in the `HEAD` roster alone grants four things today: the AP-3 approvals
page, ERP cancel, ERP pullback, and counting as accounting for row visibility.
All four narrow to `ACCOUNT`.

Safe to narrow now: the production roster is empty, and UAT's single approver
holds both roles. The roster table and its `HEAD` rows are left alone — nothing
reads them any more.

## Comments to correct

Four checks on the account step are justified in their comments by "the head
step cannot edit lines, so this is the last chance". The reason holds — the
account step is now simply the last step — but the sentence names something
that no longer exists. `clear-advance-approval-engine.ts` (×3) and
`ClearAdvanceDetail.tsx` (×1).

## Accepted trade-off

A clearing approved in error reaches the ERP queue with one approval behind it
instead of two. The send is still a separate manual action, and the admin who
makes it can pull the document back or cancel it — so the check exists, it has
moved after the approval rather than before it, and it is done by accounting
rather than by their head.

## Tests

| Test | Where |
|---|---|
| `CLR_NEXT_STEP` ends at `ACCOUNT`; `MANAGER` still leads to it | `clear-advance-chain.test.ts` (new) |
| The timeline's step list: the chain for a request with only chain rows, the chain plus `HEAD` for one carrying a historical row, and the order in both | same, against the pure helper the component uses |
| `roleForStep` — `ACCOUNT` for the account step, `null` for the manager step | existing `clear-advance-approver-service` coverage, updated |
