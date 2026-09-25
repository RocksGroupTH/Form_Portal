# AP-3: suggesting a G/L account at the account step — Design

Date: 2026-09-24
Status: design approved (user, 2026-09-24)
Scope: **both consoles** — `R:\Form_Portal` and `R:\Acc_Portal`

## Purpose

CR item 8 of the user's CR of 2026-09-23: *"ทำไมไม่ suggest Account code"*. The account
officer wants a button at the ACCOUNT step that fills in the G/L account for the lines that
have none (user, 2026-09-24: *"ปุ่มที่ขั้นบัญชี กดแล้วเติมแถวที่ว่าง"*).

**This is the other half of group A.** Group A added a way to attach a receipt without the AI
read. Those attachments produce no expense row at all, so the requester types one by hand and it
arrives at the account step with no G/L — group A's own design doc says so and asks for item 8 to
ship with it: *"These two should ship in the same release, or accounting gets more empty rows than
before with no way to fill them but by hand."*

## The feature already exists, for AP-4

`POST /api/request/reimburse/requests/[id]/suggest-gl` does exactly this for reimbursements, in
**both** repos, and its docblock already contains the arguments this design would otherwise have to
make from scratch:

- **A button, not an automatic sweep.** *"Suggesting on every keystroke would spend a model call
  per character; suggesting for the whole queue on open would spend one per line of every claim
  before anyone had decided to look. A button is also what makes the cost legible."*
- **Empty lines only.** *"A line an accountant has already set is their answer, and a model is not
  entitled to overwrite it — that is the difference between a suggestion and a correction."*
- **Sequential, not `Promise.all`.** *"a claim with twenty lines firing twenty at once is a rate
  limit waiting to happen."*
- **`filled: 0` is a success, not an error.**
- **The button appears only when there is something to fill.** *"A button that can only report
  'nothing to do' is a button people learn to ignore."*

All of that carries over unchanged. What follows is only where AP-3 differs.

## 1 · The one place AP-3 cannot copy AP-4: who writes

**AP-4's route writes the accounts itself.** AP-3's must not.

AP-3's account step is a grid with **debounced autosave** — `saveNow` on a 900 ms timer, PUTting the
whole `clear` object including every line (`ClearAdvanceDetail.tsx:466-514`,
`ClrAccountWorkspace.tsx:218-274`). If the route wrote directly, the browser would still be holding
the pre-suggestion `editItems`, and the next autosave — fired by any later keystroke — would post
those back and **erase what the server had just filled in**. Silently, and only sometimes, which is
the worst shape a bug can take.

So:

> **The route suggests; the screen applies; the existing autosave saves.**

The route reads the claim, asks the model per eligible line, and returns the answers. The screen
merges them into `editItems`, which marks the grid dirty and lets the save path that already exists
— with its validation, its roster check and its conflict handling — do the writing. One writer, no
race.

**The screen flushes its pending save before calling.** The button chains on `flushSave()` so the
route reads the officer's current text rather than whatever was last persisted; AP-4's UI chains on
its `saveChains` promise for the same reason.

## 2 · Which lines the button targets

**The target set must be the set the approval gate complains about, minus the lines that cannot be
suggested.** If it were narrower, pressing the button would leave the gate red with nothing said
about why; if it were wider, it would touch lines nobody was blocked on.

`linesMissingGl` (`clear-advance-line-validation.ts:122-131`) is the gate. It flags a line when the
G/L is empty **and** `amountBeforeVat !== 0`. So the button targets:

| Condition | Why |
| --- | --- |
| `glAccountNo` is empty | An account already set is the officer's answer (AP-4's rule). |
| `amountBeforeVat !== 0` | Matches the gate. A zero-amount line blocks nothing. |
| `description` is non-empty | The model is given the description and nothing else — see §3. |
| `branchCode` is non-empty | Without it the candidate list silently becomes the **HQ** list — see §3. |

## 3 · What the suggestion actually depends on, and the two ways it fails quietly

`suggestGlAccountWithAI` is given **the line's description and the candidate account list. Nothing
else** — not the payee, not the amount, not the date, not the claim. The candidate list is built
server-side from the claim's brand and the line's branch and the answer is matched back against it,
so a suggestion can only ever be an account that branch may charge.

Two inputs, two silent failures, both already on record in this codebase:

- **No brand → `listGlAccounts` returns `[]` → the model is never called → `null`.** Recorded at
  `ClearAdvanceForm.tsx:1112-1113` as a lived bug: *"a suggestion that silently stopped
  happening."* The route must fail loudly here rather than report "nothing to fill".
- **No branch → not an empty list but the *wrong* list.** `allowedDimensionTypes` treats a blank
  branch as HQ, so a branch line would be offered head-office accounts, which `validateLineGlBranch`
  then refuses at save time. This is why a line with no branch is skipped rather than guessed at.

In practice every submitted line has a branch — the submit validator requires it
(`ClearAdvanceForm.tsx:702`) — so the branch condition is a guard, not a common case. **The
description is the one that will actually bite**: it is optional on a hand-typed row, and a
hand-typed row is precisely what group A's raw attach produces.

## 4 · What the button says

The user chose separate counts (2026-09-24) over a single number, because an officer who sees rows
left empty needs to know whether the model declined or was never asked.

Three outcomes, reported separately:

| Outcome | Meaning to the officer |
| --- | --- |
| **filled** | An account was suggested and put in the cell. Still theirs to change. |
| **no description** | Nothing to go on. Type a description, or pick the account by hand. |
| **no answer** | There was a description; the model would not pick from the allowed list. |

A single toast, naming only the non-zero ones. `filled: 0` is not an error.

**The button is hidden when the target set is empty**, per AP-4's precedent — including the case
where the only empty lines are ones it cannot help with, since offering to fill nothing is worse
than not offering.

## 5 · Where it does not appear

**A non-home brand.** `FORCE_GL_NON_ROCKS_PC` makes the server overwrite every line's G/L with
`110723001` on save (`clear-advance-request-service.ts:565`), and the picker is already replaced by
a read-only chip for the same reason — *"offering a picker there would invite a choice the server
discards."* A suggest button there would spend model calls on values that are about to be
discarded. It is hidden, on the same test the chip uses.

## 6 · Placement

Beside the existing **ตรวจสรรพากร** bulk button in the account step's toolbar
(`ClearAdvanceDetail.tsx:710-735`, `ClrAccountWorkspace.tsx:508-526`). That button is this screen's
established shape for a bulk action: derive the pending set from `editItems`, disable when empty,
label with the count. The new button follows it rather than inventing a second idiom two
centimetres away.

## 7 · ACC Portal

ACC has **no AP-3 `/suggest-gl` of any kind** — deliberately, as the requester's side was out of
scope when AP-3 was ported (`2026-09-17-ap3-read-and-approve.md:447`). This design puts the account
step's button in both consoles, so ACC gains its own claim-scoped route.

It does not gain it from nothing: ACC already has AP-4's `suggestGlAccountWithAI` and its own
Anthropic client, and it already has the AP-3 candidate-list machinery behind its
`/options/gl-accounts` route. The new route joins the two.

## Not in scope

- The requester's form, and the OCR-time suggestion — unchanged.
- Changing what the model is given. Adding the payee or the amount to the prompt might well improve
  it; that is a separate change with its own evidence.
- A marker recording that a value was AI-suggested rather than chosen. Decided against on
  2026-09-10 and not revisited here.
- Rate limiting. Recorded as a deliberate omission for the AP-4 buttons; adding it is *"a new
  decision with its own test, not a port."*
- Tightening the existing claim-less `POST /api/request/clear-advance/suggest-gl`, which is gated by
  `requireAuth()` alone with no ACL — see the finding below.

## A finding, recorded not fixed

Form Portal's existing `/api/request/clear-advance/suggest-gl` takes `{ description, branch, brand }`
from the client and is gated by `requireAuth()` only. Any logged-in portal user can ask it for any
brand and branch. It discloses no claim data — the answer is one account number from a list the
picker already shows — so this is not a leak, and the new route does not inherit the weakness: it is
claim-scoped and authorised like the rest of the account step. Worth a separate look; not worth
widening this change to carry.

## Tests

Form Portal runs `node:test` through `tsx scripts/run-tests.ts`; ACC runs vitest. Neither can render
these grids, and neither should call a model in a test.

- **The eligibility rule is a pure function** — `(lines) → { targets, noDescription, notEligible }`
  — and that is where the thinking is. Tested directly in both repos: an empty G/L with a
  description and an amount is a target; a set G/L is not; a zero-amount line is not, matching
  `linesMissingGl`; a line with no description is counted separately, not silently dropped; a line
  with no branch is excluded. **And the property that matters: every line `linesMissingGl` flags is
  either a target or in one of the reported counts** — nothing the gate complains about may vanish
  without being mentioned.
- **The route**, with the model call faked: it asks only for eligible lines, it is sequential, it
  returns counts that add up to the target set, and a model error on one line does not lose the
  others.
- **A source-scan guard**, in the established style: the button is not rendered for a forced-G/L
  brand, and the route is not called with `Promise.all`.
- The rest — that the toast reads well, that the grid saves after — is verified by driving both apps.

## What a reader in six months needs to know

**The route deliberately does not write.** If someone "simplifies" it to write the accounts itself
the way AP-4's does, the next autosave from a screen still holding the old grid will erase them. The
one-writer rule is the whole reason this differs from its own precedent.

**The model sees the description and nothing else.** When a suggestion looks stupid, that is why —
not a bad prompt, an incomplete one. Improving it means deciding what else to send, which is a
change with a cost per line and needs its own evidence.
