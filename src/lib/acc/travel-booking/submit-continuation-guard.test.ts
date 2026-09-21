import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * I1 (2026-09-22). `submitTravelBookingGroup` feeds `continuationFlags` the
 * requester's WHOLE calendar — this submission's own tabs plus every other
 * live trip (`liveOthers`) — but until this fix only ever wrote its own tabs
 * back. `liveOthers` were inputs and never outputs: filing a trip that made
 * an ALREADY-STORED trip a continuation never rewrote that stored trip, so a
 * shared boundary day could be paid on both, in one filing order and not the
 * other (the whole-branch review reproduced 8 days paid for a 20–26 span
 * worth 7). Nothing else recomputes at submit —
 * `recomputeGroupPerDiem` has exactly one caller, the cancel/reject path.
 *
 * `request-service.ts` cannot be imported into a test — it reaches `@/env`
 * through its pool at module load. **`perdiem-recompute.ts` genuinely CAN**
 * (corrected, fix round 2, 2026-09-22, N2 — this docblock previously claimed
 * otherwise, which was false and is exactly the kind of claim this branch
 * exists to stop making): `perdiem-recompute.test.ts`, in this same
 * directory, already imports it dynamically after setting four dummy env
 * vars, and drives it through a `makeFakeTx` whose SQL-text routing already
 * covers `loadOutsideDetailRows`' `WHERE t.RequestId IN` query —
 * `rewriteSubmitAffectedTrips`' own only query. So the behavioural properties
 * that matter (`perDiemWritable`'s gate, the `locked: true` row for a
 * `Completed` trip, the no-op on an unchanged flag, the room rule, and — for
 * N1 — a row skipped when `causeFor` returns `null`) are pinned there as real
 * tests, not reasoned about here.
 *
 * **What THIS file still covers that a behavioural test cannot**: the CALL
 * SITE inside `submitTravelBookingGroup` — that `rewriteSubmitAffectedTrips`
 * is actually called, with the right arguments, in the right place relative
 * to `tx.commit()`, tagged with the right `cause.kind`. `request-service.ts`
 * is what cannot be imported, and that is what this file exists for; the pure
 * chain logic the fix depends on (`continuationPredecessors`) has its own
 * behavioural tests in `continuation-chain.test.ts` too.
 */

function read(relative: string): string {
  return fs.readFileSync(path.join(process.cwd(), "src", relative), "utf8");
}

/** Comments quoting a rule must not satisfy or trip the check for it. */
function code(relative: string): string {
  return read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*--.*$/gm, "");
}

const REQUEST_SERVICE = "lib/acc/travel-booking/request-service.ts";
const PERDIEM_RECOMPUTE = "lib/acc/travel-booking/perdiem-recompute.ts";

/**
 * `submitTravelBookingGroup` is the LAST top-level function in
 * `request-service.ts` (confirmed by reading the file's own function list),
 * so it is sliced to the end of the source rather than to a following
 * function's marker — unlike `continuation-predecessor-guard.test.ts`'s
 * `saveTravelBookingDraft`, which has one. If a function is ever added after
 * it, this slice would silently start including that function's body too;
 * the "at least one call" assertions below would still hold, but a future
 * reader adding a function afterward should know to revisit this.
 */
function submitBody(): string {
  const src = code(REQUEST_SERVICE);
  const start = src.indexOf("export async function submitTravelBookingGroup");
  assert.notEqual(start, -1, "submitTravelBookingGroup not found — has it been renamed?");
  return src.slice(start);
}

test("submitTravelBookingGroup rewrites the requester's other affected live trips, not only its own tabs", () => {
  const body = submitBody();
  assert.ok(
    /rewriteSubmitAffectedTrips\s*\(/.test(body),
    "submitTravelBookingGroup no longer calls rewriteSubmitAffectedTrips — an existing trip whose " +
      "continuation flag this submission changes will silently keep its stale figure, and the shared " +
      "boundary day can be paid on both requests",
  );
});

test("the rewrite runs before the transaction commits, not after", () => {
  const body = submitBody();
  const rewriteAt = body.indexOf("rewriteSubmitAffectedTrips(");
  const commitAt = body.indexOf("tx.commit()");
  assert.notEqual(rewriteAt, -1, "rewriteSubmitAffectedTrips not found");
  assert.notEqual(commitAt, -1, "tx.commit() not found");
  assert.ok(
    rewriteAt < commitAt,
    "rewriteSubmitAffectedTrips must run inside the same transaction as the rest of the submit, " +
      "before tx.commit() — a submit that commits its own tabs but fails to rewrite an affected " +
      "trip (or the reverse) leaves the two permanently disagreeing about the same shared day",
  );
});

test("the rewrite is scoped to liveOthers, not to every trip on the requester's calendar", () => {
  const body = submitBody();
  assert.ok(
    /rewriteSubmitAffectedTrips\(\s*tx,\s*liveOthers\.map/.test(body),
    "rewriteSubmitAffectedTrips must be called with liveOthers' ids — passing something wider " +
      "(e.g. every trip in chainTrips, which also includes this submission's own tabs) would ask " +
      "it to rewrite a tab this same transaction is already writing directly",
  );
});

/**
 * Fix round 2, N6. The test above pins the FIRST argument (the id list) and,
 * until this one, nothing pinned the THIRD (the flags map) at all — `new
 * Map()` passes every other assertion in this file, typechecks, and — proven
 * by execution, not reasoned about — causes REAL rewrites: with no stored
 * flag to compare against, `nowFlags.get(requestId) ?? false` answers `false`
 * for every row, so any row currently stored as a continuation reads as
 * "changed" and is rewritten back to its full, un-dropped span. Silent
 * overpayment, and it is the single most load-bearing argument of the call —
 * it is the one thing that tells the function what changed.
 */
test("the rewrite is fed the real flagsByRequest map, not an empty or ad-hoc one", () => {
  const body = submitBody();
  assert.ok(
    /rewriteSubmitAffectedTrips\(\s*tx,\s*liveOthers\.map\([\s\S]*?\),\s*flagsByRequest,/.test(body),
    "rewriteSubmitAffectedTrips's third argument must be exactly flagsByRequest — the same " +
      "map used to write this submission's own tabs' IsContinuation. Anything else (an empty " +
      "Map, a freshly-computed one that does not match what was actually stored/decided) would " +
      "make every stored continuation read as changed and re-pay its dropped day",
  );
});

test("the cause passed for a rewritten trip is kind: \"submitted\", not cancelled or rejected", () => {
  const body = submitBody();
  const start = body.indexOf("rewriteSubmitAffectedTrips(");
  assert.notEqual(start, -1);
  // The call spans to the closing of the outer statement; a generous window
  // is enough to contain the whole cause object literal without needing to
  // balance parens by hand.
  const window = body.slice(start, start + 1200);
  assert.ok(
    /kind:\s*"submitted"/.test(window),
    'the rewrite\'s cause must be tagged kind: "submitted" — perdiem-recompute.ts\'s causeLabel ' +
      "has no case for an unrecognised kind, and a wrong tag (e.g. reusing \"cancelled\") would " +
      "write an activity-log sentence claiming a trip was cancelled when it was not",
  );
});

test("perdiem-recompute.ts's RecomputeCause admits \"submitted\" and rewriteSubmitAffectedTrips is exported", () => {
  const src = code(PERDIEM_RECOMPUTE);
  assert.ok(
    /kind:\s*"cancelled"\s*\|\s*"rejected"\s*\|\s*"submitted"/.test(src),
    'RecomputeCause\'s kind union no longer admits "submitted" — request-service.ts\'s cause object ' +
      "would fail to typecheck, which is the only thing standing between this guard and a silent " +
      "narrowing back to the two-cause world",
  );
  assert.ok(
    /export async function rewriteSubmitAffectedTrips/.test(src),
    "rewriteSubmitAffectedTrips is no longer exported from perdiem-recompute.ts — request-service.ts " +
      "cannot import what request-service.ts's own guard test just confirmed it calls",
  );
});
