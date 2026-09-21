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
 * outer layer, worth having anyway because the failure mode here is a
 * *reverted predicate* (GroupKey/SortOrder scoping put back, or the
 * draft-save estimate's database read deleted), which IS textual — a query
 * that quietly changed its JOIN order or its tiebreak instead would slip past
 * this file unnoticed.
 *
 * 1. **The predecessor-naming subqueries must not scope by `GroupKey` again.**
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
 * The predecessor-subquery comments in both target files spell out the exact
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

for (const file of [REQUEST_SERVICE, REPORT_SERVICE]) {
  test(`the predecessor subquery in ${file} is not GroupKey-scoped`, () => {
    const src = code(file);
    assert.equal(
      /pt\.GroupKey/.test(src),
      false,
      `${file} names pt.GroupKey again — the predecessor lookup has regressed ` +
        "to booking-group scoping, so a cross-group continuation's predecessor " +
        "will not be found and the detail page/report will name no one",
    );
  });

  test(`the predecessor subquery in ${file} carries the requester predicate`, () => {
    const src = code(file);
    assert.ok(
      /\(r\.StaffId IS NOT NULL AND pr\.StaffId = r\.StaffId\)/.test(src) &&
        /\(r\.EmployeeId IS NOT NULL AND pr\.EmployeeId = r\.EmployeeId\)/.test(src),
      `${file}'s predecessor subquery must match on the requester (StaffId OR ` +
        "EmployeeId, each arm IS NOT NULL-guarded) — the same predicate " +
        "requester-trips.ts and perdiem-dependency-load.ts use",
    );
    assert.ok(
      /pr\.FormCode = 'AP-17'/.test(src),
      `${file}'s predecessor subquery must pin pr.FormCode = 'AP-17'`,
    );
    assert.ok(
      /pr\.Status NOT IN \('Draft', 'Cancelled', 'Rejected'\)/.test(src),
      `${file}'s predecessor subquery must exclude Draft, Cancelled and ` +
        "Rejected candidates — a dead or unsubmitted trip cannot own a day, " +
        "so it must not be named as the reason one was dropped",
    );
    assert.ok(
      /pt\.RequestId <> r\.Id/.test(src),
      `${file}'s predecessor subquery must exclude the request from matching ` +
        "itself — without GroupKey/SortOrder providing that for free, a " +
        "single-day trip's own ReturnDate = DepartDate would otherwise self-match",
    );
  });

  test(`the predecessor subquery in ${file} orders nearest-first the way continuationFlags does`, () => {
    const src = code(file);
    assert.ok(
      /ORDER BY pt\.DepartDate DESC, pt\.SortOrder DESC, pt\.Id DESC/.test(src),
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
