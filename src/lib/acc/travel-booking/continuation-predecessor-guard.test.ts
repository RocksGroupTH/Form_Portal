import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Two things this branch changed on 2026-09-22 are now source-readable
 * invariants with no behavioural test that could catch their loss —
 * `request-service.ts` and `report-service.ts` both reach `@/env` through
 * their pool, so neither can be imported into a test, which is exactly why
 * this repo reads source for checks like this one (see
 * `perdiem-source-guard.test.ts`, `booking-currency-guard.test.ts`).
 *
 * **Pin on structure, not on prose.** A regex over SQL text cannot verify SQL
 * semantics — CLAUDE.md records AP-4's `queue-service-guard.test.ts` being
 * defeated three times by a rewrite that kept every pinned substring while
 * changing what the query actually selected. This file is the same weaker,
 * outer layer.
 *
 * **Fix round 1 (2026-09-22): the first version of this file asserted over
 * the WHOLE FILE, and each file held TWO near-identical scalar subqueries —
 * so any presence assertion was satisfied by whichever copy still carried the
 * text, and six real regressions on the *other* copy passed cleanly (review's
 * section E). The worst: reverting one subquery's ORDER BY let
 * `ContinuationFromRequestNo` and `ContinuationFromRequestId` name DIFFERENT
 * trips, and `OR 1=1` on one copy's requester predicate named a third party's
 * running number — the guard saw neither.
 *
 * Both files now compute both columns from ONE `OUTER APPLY` block instead of
 * two independent scalar subqueries, which makes that whole class of
 * regression unrepresentable (one row, both columns) rather than merely
 * harder to write. This file's job changed to match: assert there is exactly
 * ONE `OUTER APPLY` block per file (so a revert back to two scalar
 * subqueries — or a second block appearing — is itself caught), slice that
 * one block out, and run every property assertion against it. There is
 * nothing left for a "surviving copy" to hide behind.
 *
 * 1. **The predecessor block must not scope by `GroupKey` again.**
 *    `getTravelBookingRequest` (`request-service.ts`) and the report's row
 *    CTE (`report-service.ts`) each name a request's continuation
 *    predecessor — `ContinuationFromRequestNo`/`Id` — for the detail page
 *    and the report to display. Both were `pt.GroupKey = mt.GroupKey AND
 *    pt.SortOrder < mt.SortOrder` until 2026-09-22, which matched how
 *    `IsContinuation` was decided at save time when they were written and
 *    stopped matching once the continuation chain widened to a requester's
 *    whole calendar (Tasks 3-5b). A regression back to `GroupKey` scoping
 *    would make the detail-page label (Task 6) fall back to generic
 *    "ทริปก่อนหน้า" text on exactly the cross-group case this feature exists
 *    for — silently, since `isContinuation` itself would still read `true`.
 * 2. **The draft-save continuation estimate must keep calling
 *    `loadRequesterTrips` + `continuationFlags`.** Real logic Task 6
 *    rewrote with zero test of any kind before this file — a revert to the
 *    old `input.tabs[i - 1]` comparison fails no other test today, and it is
 *    a figure a requester reads off the screen while filling the form.
 */

function read(relative: string): string {
  return fs.readFileSync(path.join(process.cwd(), "src", relative), "utf8");
}

/**
 * Comments quoting a rule must not satisfy or trip the check for it.
 *
 * The predecessor-block comments in both target files spell out the exact
 * SQL fragments they explain (`pt.RequestId <> r.Id`, for one) in prose, so
 * `--` SQL comment lines are stripped here too, not only `//`/`/* *\/` —
 * otherwise a reverted WHERE clause with its explanatory comment left in
 * place would still satisfy these assertions from the comment text alone.
 */
function code(relative: string): string {
  return read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*--.*$/gm, "");
}

const REQUEST_SERVICE = "lib/acc/travel-booking/request-service.ts";
const REPORT_SERVICE = "lib/acc/travel-booking/report-service.ts";

/**
 * Slices the ONE `OUTER APPLY ( … ) cont` block out of a file's (comment-
 * stripped) source, asserting there is exactly one — not zero (reverted to
 * scalar subqueries, or renamed) and not two or more (a second block added
 * for some other purpose, which every assertion below would then run against
 * ambiguously). Matched on `OUTER APPLY (` specifically, with the open paren,
 * so a stripped comment merely mentioning the words "OUTER APPLY" (both files
 * have one, explaining why) cannot be mistaken for the real clause.
 */
function predecessorApplyBlock(file: string): string {
  const src = code(file);
  const marker = /OUTER APPLY \(/g;
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = marker.exec(src))) starts.push(m.index);
  assert.equal(
    starts.length,
    1,
    `${file} must have exactly one "OUTER APPLY (" for the predecessor lookup, found ${starts.length} — ` +
      "either it reverted to two scalar subqueries (0) or a second APPLY block was added (2+), " +
      "either of which this file's per-block assertions can no longer usefully cover",
  );
  const start = starts[0];
  const end = src.indexOf(") cont", start);
  assert.notEqual(end, -1, `${file}: no closing ") cont" found after "OUTER APPLY (" — has the alias been renamed?`);
  return src.slice(start, end + ") cont".length);
}

for (const file of [REQUEST_SERVICE, REPORT_SERVICE]) {
  test(`the predecessor APPLY block in ${file} is not GroupKey-scoped`, () => {
    const block = predecessorApplyBlock(file);
    assert.equal(
      /pt\.GroupKey/.test(block),
      false,
      `${file} names pt.GroupKey again inside the predecessor block — the lookup has ` +
        "regressed to booking-group scoping, so a cross-group continuation's " +
        "predecessor will not be found and the detail page/report will name no one",
    );
  });

  test(`the predecessor APPLY block in ${file} carries the requester predicate, and nothing else`, () => {
    const block = predecessorApplyBlock(file);
    // Anchored end-to-end, not just "both substrings appear somewhere" — a
    // presence-only check passes `OR 1=1` appended right beside the real
    // predicate just as easily as the real predicate alone. The regex
    // requires the closing paren to follow the EmployeeId arm IMMEDIATELY
    // (only whitespace between), so nothing can be inserted into the group
    // without breaking this match. Verified by mutation: `OR 1=1` appended
    // after the EmployeeId arm passed this test before this comment was
    // added to explain why the anchoring is what actually catches it.
    assert.ok(
      /AND\s*\(\s*\(r\.StaffId IS NOT NULL AND pr\.StaffId = r\.StaffId\)\s*OR\s*\(r\.EmployeeId IS NOT NULL AND pr\.EmployeeId = r\.EmployeeId\)\s*\)/.test(
        block,
      ),
      `${file}'s predecessor block must match on the requester (StaffId OR ` +
        "EmployeeId, each arm IS NOT NULL-guarded) — the same predicate " +
        "requester-trips.ts and perdiem-dependency-load.ts use — and the group " +
        "must contain exactly those two arms, or a widening like OR 1=1 would " +
        "name another person's running number",
    );
    assert.ok(
      // request-service.ts reuses the @form parameter already bound from
      // AP17_FORM_CODE for its outer WHERE; report-service.ts's BASE_CTE
      // is a shared constant with no bound parameters of its own, so it
      // pins the same literal (N-prefixed, matching the file's own other
      // literal at its outer WHERE) instead. Either is an acceptable pin;
      // dropping the condition entirely, or answering neither pattern, is not.
      /pr\.FormCode = (@form|N?'AP-17')/.test(block),
      `${file}'s predecessor block must pin pr.FormCode to AP-17 (via @form or a literal)`,
    );
    assert.ok(
      /pr\.Status NOT IN \('Draft', 'Cancelled', 'Rejected'\)/.test(block),
      `${file}'s predecessor block must exclude Draft, Cancelled and ` +
        "Rejected candidates — a dead or unsubmitted trip cannot own a day, " +
        "so it must not be named as the reason one was dropped",
    );
    assert.ok(
      /pt\.RequestId <> r\.Id/.test(block),
      `${file}'s predecessor block must exclude the request from matching ` +
        "itself — without GroupKey/SortOrder providing that for free, a " +
        "single-day trip's own ReturnDate = DepartDate would otherwise self-match",
    );
  });

  test(`the predecessor APPLY block in ${file} correlates on ReturnDate = this request's own DepartDate`, () => {
    const block = predecessorApplyBlock(file);
    // request-service.ts joins its own row's booking via `mt`; report-service.ts
    // already has it as `t` from the CTE's own FROM clause — see each file's
    // comment for why. Either alias is a correct correlation; neither file's
    // block may drop the join to the wrong column (e.g. ReturnDate = ReturnDate,
    // one of the reviewer's six mutations, which finds every trip touching the
    // SAME day range as itself rather than the one preceding it).
    assert.ok(
      /pt\.ReturnDate = mt\.DepartDate/.test(block) || /pt\.ReturnDate = t\.DepartDate/.test(block),
      `${file}'s predecessor block must correlate pt.ReturnDate to THIS request's ` +
        "own DepartDate (via mt or t) — the continuation definition itself",
    );
  });

  test(`the predecessor APPLY block in ${file} orders nearest-first the way continuationFlags does`, () => {
    const block = predecessorApplyBlock(file);
    assert.ok(
      /ORDER BY pt\.DepartDate DESC, pt\.SortOrder DESC, pt\.Id DESC/.test(block),
      `${file} must order candidates by depart date (then SortOrder, then Id) ` +
        'descending — the gate, the recompute and this label must agree on ' +
        'which trip is "the predecessor"',
    );
  });
}

/**
 * `saveTravelBookingDraft` is isolated by slicing to the next top-level
 * function it precedes in the file (`deleteTravelBookingDraft`), not by a
 * fixed line range, so this survives the function growing or shrinking.
 */
function draftSaveBody(): string {
  const src = code(REQUEST_SERVICE);
  const start = src.indexOf("export async function saveTravelBookingDraft");
  const end = src.indexOf("export async function deleteTravelBookingDraft");
  assert.notEqual(start, -1, "saveTravelBookingDraft not found — has it been renamed?");
  assert.notEqual(end, -1, "deleteTravelBookingDraft not found — has it moved or been renamed?");
  assert.ok(start < end, "deleteTravelBookingDraft must still follow saveTravelBookingDraft in the file");
  return src.slice(start, end);
}

test("the draft-save continuation estimate still reads the requester's whole calendar", () => {
  const body = draftSaveBody();
  assert.ok(
    /loadRequesterTrips\s*\(/.test(body),
    "saveTravelBookingDraft no longer calls loadRequesterTrips — its " +
      "IsContinuation estimate has reverted to comparing only " +
      "input.tabs[i - 1], which can disagree with what submit actually " +
      "computes and stores for the exact same dates",
  );
  assert.ok(
    /continuationFlags\s*\(/.test(body),
    "saveTravelBookingDraft no longer calls continuationFlags — its " +
      "IsContinuation estimate is no longer derived the same way " +
      "submitTravelBookingGroup and the cancellation recompute derive it",
  );
  // The two calls above are not enough by themselves — verified by mutation:
  // reverting only the per-tab ASSIGNMENT back to `input.tabs[i - 1]` while
  // leaving the loadRequesterTrips()/continuationFlags() calls in place
  // (their result simply unused) passes both checks above. These two close
  // that gap by pinning the assignment itself, not just that the functions
  // are called somewhere in the function.
  assert.ok(
    /const isContinuation = \w+\.get\(/.test(body),
    "saveTravelBookingDraft's per-tab IsContinuation is no longer read via a " +
      "Map#get lookup — it must come from the continuationFlags() map, not a " +
      "direct comparison",
  );
  assert.equal(
    /input\.tabs\[i - 1\]/.test(body),
    false,
    "saveTravelBookingDraft compares against input.tabs[i - 1] again — that is " +
      "the narrow, single-group estimate the requester-wide walk replaced",
  );
});
