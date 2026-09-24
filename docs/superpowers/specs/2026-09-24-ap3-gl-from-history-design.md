# AP-3: remembering a G/L account before asking the model — Design

Date: 2026-09-24
Status: design approved (user, 2026-09-24)
Scope: **both consoles** — `R:\Form_Portal` and `R:\Acc_Portal`
Builds on: `2026-09-24-ap3-suggest-gl-at-the-account-step-design.md`

## Purpose

The suggest button asks a model for every eligible line. The user asked whether a line whose
description an officer has already accounted for could be filled from that decision instead
(2026-09-24). It can, and it should: it is faster, it costs nothing, and — the part that matters
most — it is **consistent**. A model asked the same question twice may answer twice differently; a
lookup cannot.

**Decisions taken** (user, 2026-09-24):

| # | Decision |
| --- | --- |
| 1 | **Look up first; ask the model only when the lookup does not answer.** Not a replacement. |
| 2 | **When history disagrees with itself, ask the model.** A key that has meant two things is not a memory, it is a coin toss. |
| 3 | **No "AI guessed / a human chose" marker.** Offered and declined — see the consequence in §5. |

## 1 · The key is not the description

This is the whole design, and it came out of the data rather than out of a guess.

`Type-c to HDMI สีดำ` appears nine times in the UAT corpus with **two** different accounts, which
reads like noise until you group it:

| Branch | Account | Uses |
| --- | --- | --- |
| `HQ01` | `610311002` | 5 |
| `PC1001`, `PC1073`, `PCCT01` | `610113001` — …**- สาขา** | 4 |

The split is head office against branches, exactly and without exception. Keyed on the description
alone this is a conflict and rule 2 would send it to the model every time. Keyed on the description
**and whether the line is at head office**, both groups are perfectly consistent and it is two clean
answers.

So the key is:

```
normalised description + company + isHqBranch(branchCode)
```

**The branch part is the HQ/branch *classification*, not the branch code.** Two reasons, and the
second is the important one:

- Keying on the code would have made four keys here with one or two uses each. A brand with a
  hundred branches would almost never see the same description at the same branch twice, and the
  cache would never warm up.
- `isHqBranch` is not a rule invented for this. It is the existing function `allowedDimensionTypes`
  uses to decide which accounts a line may charge at all — `Employee`+`Both` at head office,
  `Branch`+`Both` elsewhere. **The key is keyed on the same thing the constraint is keyed on**,
  which is why the grouping is clean rather than lucky.

The company belongs in the key because the candidate list is company-scoped; an account remembered
for one company may not exist in another.

Normalising the description means trimming and collapsing runs of whitespace, and lower-casing —
Thai is unaffected, Latin is not (`Type-C` and `type-c` are the same expense).

## 2 · What counts as history

Lines in `AccClearAdvanceItem` that have both a description and a G/L account, on claims that were
not **Cancelled** or **Rejected**. A rejected claim is weak evidence and may have been rejected
*because* of the account.

**A remembered account is still only a candidate.** It is checked against the same per-branch
candidate list the model's answer is checked against, and dropped the same way if it is not in it.
An account that has since been deactivated, blocked, or moved out of this branch's dimension type
must not come back from the dead because it was right once. One gate, both paths.

## 3 · The order, and what the officer is told

For each eligible line: look up → if exactly one account is remembered for the key, take it → else
ask the model → else leave it empty.

The counts the button reports gain one bucket. The officer already sees why a line was *not* filled;
they should also see where a filled value came from, because **a remembered value was never checked
by anything on this run** — it is a past decision replayed, and the officer is the one signing for
it.

| Bucket | Meaning |
| --- | --- |
| **from history** | This description, at this kind of location, in this company, has been accounted for before and always the same way. |
| **from the model** | Asked and answered. |
| no description / no branch / no answer | Unchanged from the existing design. |

## 4 · What this does not change

- The eligibility rule (`planGlSuggestions`) — the same lines are targeted.
- The route still **does not write**. The screen applies, the existing autosave saves.
- Sequential model calls. Fewer of them, but still one at a time.
- The button is still hidden for a forced-G/L brand and when there is nothing to fill.

## 5 · The consequence of declining the provenance marker

On 2026-09-10 it was decided that AP-3 records no marker distinguishing an AI suggestion from a
human choice, and that doc says plainly why it matters: *"an account officer can approve a grid of
unreviewed AI suggestions."* Adding the marker was offered with this change and declined
(user, 2026-09-24).

So, stated once, here, rather than discovered later:

> **History includes the model's own past answers.** A line the model filled and nobody looked at is
> indistinguishable from one an officer chose deliberately. A wrong answer that is *consistently*
> wrong becomes the remembered answer, and from then on the model is not consulted about it at
> all — so the mistake stops being re-examined rather than being caught.

Two things limit it, and neither removes it. Rule 2 means an inconsistent mistake falls through to
the model. And §2's re-validation means a remembered account that is no longer selectable is
dropped. What is not limited is a mistake that is steady and still selectable.

If this turns out to matter, the marker is still the fix, and the 2026-09-10 doc says it *"can be
added later without disturbing anything"*. It would apply from the day it is added — earlier rows
cannot be re-classified.

## 6 · There is nothing to remember yet

`AccClearAdvanceItem` in the production database has **zero rows**; so does AP-4's equivalent. The
whole AP suite is still UAT-only — the schema shipped, the forms did not. The 46 usable lines in
UAT are test data.

So on the day this ships, nearly every line will fall through to the model, which is exactly
today's behaviour. **That is the expected outcome, not a failure**, and it is worth writing down so
nobody spends an afternoon debugging a cache that is empty because the corpus is.

## Tests

- **The key** is a pure function and gets the corpus's own cases: `HQ01` and `PC1073` for one
  description produce different keys; two spellings differing only in whitespace or Latin case
  produce the same key; a different company produces a different key.
- **The decision** — given history rows for a key, one account is returned when they agree, nothing
  when they disagree, nothing when there are none.
- **The re-validation** — a remembered account absent from the candidate list is dropped, and the
  line falls through to the model exactly as if nothing had been remembered.
- **The order** — the model is not called for a line the lookup answered. Provable with the same
  injected-function technique the sequential test already uses: a fake `suggest` that records its
  calls must not see that line.
- The counts, and that they still add up to the target set.

## What a reader in six months needs to know

**The key is `isHqBranch`, not the branch code, and that is load-bearing.** If someone "improves" it
to the exact branch, the cache will look correct in a test with two branches and will stop hitting
almost entirely in a business with a hundred.

**A remembered account is re-validated, never trusted.** It goes through the same candidate check
the model's answer does. If that check is ever skipped for the history path "because it was already
valid once", deactivated accounts will start reappearing on new claims.
