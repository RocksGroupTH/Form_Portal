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
 * Neither `request-service.ts` nor `perdiem-recompute.ts` can be imported
 * into a test — both reach `@/env` through their pool — which is exactly why
 * this repo reads source for checks like this one (see
 * `continuation-predecessor-guard.test.ts`, `perdiem-source-guard.test.ts`).
 * The pure chain logic this fix depends on (`continuationPredecessors`) has
 * its own behavioural tests in `continuation-chain.test.ts`; this file is the
 * source-reading half that pins the write path those tests cannot reach.
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
