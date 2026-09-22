import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * **A room-share host's fate must move its guests, inside the host's own
 * transaction — and the failure to catch is a MISSING CALL.**
 *
 * AP-17 package E, spec §4. `room-share-cascade.ts` decides what happens to
 * each guest and is behaviourally tested in full (`room-share-cascade.test.ts`
 * — 14 cases, no database). What no behavioural test of the four public
 * cancel/reject paths can see is whether anything **calls** it: delete the
 * call and every one of those paths still cancels the host, still writes its
 * own activity row, still gives the group's day back, and still returns the
 * same `TravelBookingRequest`. The only symptom is a guest who quietly
 * survives their host — which is precisely the state the whole feature exists
 * to prevent.
 *
 * Source-reading, and it has to be: `approval.ts` and `request-service.ts`
 * both reach `getAccPool()` → `@/lib/db/mssql` → `@/env`, which validates the
 * whole environment at import time and throws in a test run. Neither can be
 * imported. The same constraint `perdiem-source-guard.test.ts`,
 * `submit-continuation-guard.test.ts` and `room-share-response-shape-guard.test.ts`
 * already work under; the per-function slicing below is
 * `submit-continuation-guard.test.ts`'s, widened because `approval.ts` holds
 * nine `tx.commit()`s and a whole-file index comparison would be meaningless.
 *
 * ## The five sites, and why there are five rather than four
 *
 * Spec §4 names four triggers and they are all status transitions. There are
 * five call sites and they live in **two** files:
 *
 * | trigger | file | how |
 * |---|---|---|
 * | `rejectRequest` | `approval.ts` | its own `recomputeAfterDeath` |
 * | `rejectByAdmin` | `approval.ts` | `transitionFromStage` |
 * | `rejectByAccount` | `approval.ts` | `transitionFromStage` (the same one) |
 * | `cancelByRequester` | `approval.ts` | its own `recomputeAfterDeath` |
 * | host's dates change | `request-service.ts` | `saveTravelBookingDraft` |
 * | **host hard-deleted** | `request-service.ts` | `collectAndDeleteRequestArtifacts` |
 *
 * So four public paths reach **three** `recomputeAfterDeath` calls, which is
 * why this file asserts the hook lives in `recomputeAfterDeath` itself and
 * that each of the three sites calls *that* before its commit — rather than
 * looking for four cascade calls, of which there must never be four. And the
 * hard delete is a **fifth trigger the spec never considered**: a `Returned`
 * host its owner discards is not a status transition, but its guests are just
 * as stranded.
 *
 * ## Mutation-verified, 2026-09-22
 *
 * Because a guard nobody has tried to defeat is a guard nobody knows the
 * strength of, and this branch has shipped two that were green against six
 * real regressions. Each mutation below was applied to the source, the full
 * suite re-run, and the tree confirmed clean with `git status` afterwards.
 * The results are recorded in this branch's Task 6 report; where one stayed
 * green it is named there rather than quietly dropped.
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

const APPROVAL = "lib/acc/travel-booking/approval.ts";
const REQUEST_SERVICE = "lib/acc/travel-booking/request-service.ts";
const APPLY = "lib/acc/travel-booking/room-share-cascade-apply.ts";

/**
 * One function's body, sliced from its signature to the next top-level
 * function declaration.
 *
 * Comments are already stripped, so every remaining top-level declaration
 * starts at column 0 — which is what makes the terminator regex reliable here
 * and what would make it unreliable against the raw source, where a docblock's
 * own text can contain the word `function` at the start of a line.
 */
function bodyOf(file: string, signature: string): string {
  const src = code(file);
  const start = src.indexOf(signature);
  assert.notEqual(start, -1, `${signature} not found in ${file} — has it been renamed?`);
  const rest = src.slice(start + signature.length);
  const next = /\n(?:export\s+)?(?:async\s+)?function\s/.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

/**
 * `a` must appear, `b` must appear, and `a` must come first. Used for every
 * "inside the transaction" assertion: `tx.commit()` is the boundary, and a
 * cascade call after it is a cascade that cannot be rolled back with the
 * action that caused it.
 */
function assertBefore(body: string, a: string, b: string, why: string): void {
  const ai = body.indexOf(a);
  const bi = body.indexOf(b);
  assert.notEqual(ai, -1, `${a} not found — ${why}`);
  assert.notEqual(bi, -1, `${b} not found`);
  assert.ok(ai < bi, `${a} must come before ${b}: ${why}`);
}

/* ───────────────────────── the death cascade ───────────────────────── */

test("recomputeAfterDeath cascades to the host's room-share guests", () => {
  const body = bodyOf(APPROVAL, "async function recomputeAfterDeath");
  assert.ok(
    /applyRoomShareDeath\s*\(\s*tx\s*,/.test(body),
    "recomputeAfterDeath no longer calls applyRoomShareDeath(tx, …) — every guest of a " +
      "cancelled or rejected host would survive it, un-cancelled and untold, still drawing " +
      "per diem on a room that no longer exists. This is the single call that serves all " +
      "four public cancel/reject paths",
  );
});

/**
 * Not a style point. The give-back returns early on a null `GroupKey`, and a
 * request with no group key can still be somebody's host — so a cascade placed
 * inside that guarded branch, or before it behind the same `return`, silently
 * covers fewer requests than the one above appears to.
 */
test("the cascade is not gated on the host having a GroupKey", () => {
  const body = bodyOf(APPROVAL, "async function recomputeAfterDeath");

  // Spelling 1: the shape this function had before the cascade existed —
  // `if (!groupKey) return;` and then the give-back. Anything placed after
  // that return is reached only for a request that HAS a group key.
  assert.ok(
    !/if\s*\(\s*!groupKey\s*\)\s*return\s*;[\s\S]*applyRoomShareDeath/.test(body),
    "applyRoomShareDeath sits after an `if (!groupKey) return;` — a host with no GroupKey " +
      "would keep its guests. The give-back is what the group key gates, not the cascade",
  );

  // Spelling 2, and the likelier one: the call tidied INSIDE the
  // `if (groupKey) { … }` block, which reads like a harmless tightening and
  // is the same defect. The block is sliced on its own indentation — every
  // statement in it is indented deeper than the closing brace.
  const opens = body.indexOf("if (groupKey) {");
  if (opens !== -1) {
    const after = body.slice(opens);
    const closes = after.indexOf("\n  }");
    assert.notEqual(closes, -1, "could not find the end of recomputeAfterDeath's `if (groupKey)` block");
    assert.ok(
      !/applyRoomShareDeath/.test(after.slice(0, closes)),
      "applyRoomShareDeath is inside recomputeAfterDeath's `if (groupKey)` block. A request " +
        "with no GroupKey can still be somebody's room-share host, and its guests would " +
        "survive it — the group key gates the per-diem give-back and nothing else",
    );
  }
});

const DEATH_SITES: { name: string; signature: string }[] = [
  { name: "rejectRequest", signature: "export async function rejectRequest" },
  { name: "cancelByRequester", signature: "export async function cancelByRequester" },
  {
    // Serves rejectByAdmin AND rejectByAccount — the two public paths with no
    // recomputeAfterDeath call of their own.
    name: "transitionFromStage",
    signature: "async function transitionFromStage",
  },
];

for (const site of DEATH_SITES) {
  test(`${site.name} reaches the cascade before it commits`, () => {
    const body = bodyOf(APPROVAL, site.signature);
    assertBefore(
      body,
      "recomputeAfterDeath(tx",
      "tx.commit()",
      "recomputeAfterDeath is where the room-share cascade hangs, so calling it after the " +
        "commit would let the host's own cancellation stand while the cascade that cancels " +
        "its guests fails and rolls back nothing. Spec §4: a host cancelled while its guests " +
        "survive is the state this feature exists to prevent, and it is worse than a " +
        "cancellation the user has to retry",
    );
  });
}

/**
 * `transitionFromStage` serves FOUR public functions and only two of them kill
 * the request — `rejectByAdmin` and `rejectByAccount`. Its call is inside an
 * `if (target.status === "Rejected")`, and it must stay there: a return sends
 * the request back to the requester **alive**, and cascading on that would
 * cancel every guest of a host that is still perfectly real.
 */
test("transitionFromStage cascades only on a rejection, never on a return", () => {
  const body = bodyOf(APPROVAL, "async function transitionFromStage");
  assert.ok(
    /if\s*\(\s*target\.status\s*===\s*"Rejected"\s*\)\s*\{\s*await\s+recomputeAfterDeath\(/.test(body),
    'transitionFromStage\'s recomputeAfterDeath is no longer guarded by `target.status === "Rejected"` ' +
      "— returnByAdmin and returnByAccount share this function, and a request sent back to its " +
      "requester is still alive. Cascading there would cancel the guests of a host nobody killed",
  );
});

/**
 * There must be exactly THREE `recomputeAfterDeath` call sites in
 * `approval.ts`, not four. `rejectByAccount` reaches it through
 * `transitionFromStage`; a fourth call added there on the belief it was
 * missing would cascade twice — the second pass finding every guest already
 * `Cancelled` and writing a second, contradictory audit row about it.
 */
test("approval.ts has exactly three recomputeAfterDeath call sites", () => {
  const src = code(APPROVAL);
  const calls = src.match(/recomputeAfterDeath\(tx/g) ?? [];
  assert.equal(
    calls.length,
    3,
    `expected 3 recomputeAfterDeath(tx, …) call sites, found ${calls.length}. Four means ` +
      "somebody added one to rejectByAccount, which already reaches it through " +
      "transitionFromStage — the cascade would run twice on one rejection",
  );
});

/* ───────────────────────── the date cascade ───────────────────────── */

test("saveTravelBookingDraft cascades a host's changed dates before it commits", () => {
  const body = bodyOf(REQUEST_SERVICE, "export async function saveTravelBookingDraft");
  assert.ok(
    /applyRoomShareDates\s*\(\s*tx\s*,/.test(body),
    "saveTravelBookingDraft no longer calls applyRoomShareDates(tx, …). BOOKING_SET is the only " +
      "writer of DepartDate/ReturnDate in src/, so this is the only place a host's dates can " +
      "move — without the call a guest keeps travelling on dates their host abandoned, and is " +
      "paid for them",
  );
  assertBefore(
    body,
    "applyRoomShareDates(tx",
    "tx.commit()",
    "the date cascade must run inside the save's own transaction — a save that commits the " +
      "host's new dates while failing to move its guests' leaves the two permanently disagreeing " +
      "about which days the room was booked for",
  );
});

/**
 * Two properties of the trigger that neither the cascade's own decisions nor
 * the "before the commit" tests can express, and that are each one deleted
 * condition away from a live defect.
 */
test("the date cascade fires on a CHANGE, and never on a half-filled range", () => {
  const body = bodyOf(REQUEST_SERVICE, "export async function saveTravelBookingDraft");
  assert.ok(
    /before\.depart\s*!==\s*newDepart\s*\|\|\s*before\.return\s*!==\s*newReturn/.test(body),
    "the date cascade no longer compares the saved dates against `datesBefore`. It would then " +
      "fire on every save of a Returned host — including one that touched only the work " +
      "detail — and hand each guest an activity row claiming the host changed its dates when " +
      "it did not",
  );
  assert.ok(
    /newDepart\s*&&\s*\n?\s*newReturn\s*&&/.test(body),
    "the date cascade no longer requires both new dates to be present. A draft save " +
      "legitimately passes through a half-filled state, and following a host into a blank " +
      "range nulls out the dates the guest chose and re-prices them at zero days",
  );

  // …and the same rule inside the callee, because a call site's check protects
  // only that call site.
  const apply = bodyOf(APPLY, "export async function applyRoomShareDates");
  assert.ok(
    /if\s*\(\s*!hostDates\.depart\s*\|\|\s*!hostDates\.return\s*\)\s*return\s*\[\s*\]\s*;/.test(apply),
    "applyRoomShareDates no longer refuses an incomplete host range of its own accord. The " +
      "call site's check is not enough — the next caller inherits nothing from it, and the " +
      "cost of getting this wrong is a guest's dates nulled and their per diem zeroed",
  );
});

/* ───────────────────────── the hard delete ───────────────────────── */

/**
 * The fifth trigger, and the one spec §4 does not contain. A `Returned` host
 * hard-deleted by its owner's ordinary save leaves its guests exactly as
 * stranded as a cancellation would — more so, because the request they point
 * at no longer exists at all.
 */
test("collectAndDeleteRequestArtifacts cascades before it deletes the bindings", () => {
  const body = bodyOf(REQUEST_SERVICE, "async function collectAndDeleteRequestArtifacts");
  assert.ok(
    /applyRoomShareDeath\s*\(\s*tx\s*,/.test(body),
    "collectAndDeleteRequestArtifacts no longer calls applyRoomShareDeath(tx, …). Deleting the " +
      "AccTravelRoomShare row is not cascading: the guest is left un-cancelled, un-re-dated and " +
      "untold, pointing at a request that has been erased",
  );
  assertBefore(
    body,
    "applyRoomShareDeath(tx",
    "DELETE FROM [dbo].[AccTravelRoomShare]",
    "the cascade reads the binding rows through loadGuestsOf, so it must run before the " +
      "statement that removes them — afterwards it finds no guests and does nothing at all, " +
      "silently",
  );
  assertBefore(
    body,
    "applyRoomShareDeath(tx",
    "DELETE FROM [dbo].[AccRequest]",
    "the cascade must run inside the same transaction as the delete it reacts to",
  );
});

/* ───────────────────── what the cascade actually writes ───────────────────── */

test("the applied cascade writes both activity actions spec §4 names", () => {
  const src = code(APPLY);
  for (const action of ["cancelled_by_room_share_host", "dates_followed_room_share_host"]) {
    assert.ok(
      src.includes(action),
      `${action} is gone from room-share-cascade-apply.ts — spec §4 requires an activity row ` +
        "for every cascaded guest. Without it a requester finds their trip cancelled or " +
        "re-dated with nothing in the timeline saying why, and accounting has nothing to " +
        "reconcile a paid-then-cancelled claim against",
    );
  }
  assert.ok(
    /INSERT INTO \[dbo\]\.\[AccActivityLog\][\s\S]*?VALUES \(@gid, NULL, @action/.test(src),
    "the cascade's activity rows must carry AuthorId NULL — nobody acted on the guest's " +
      "request. Stamping the host's owner on it claims they cancelled or re-dated somebody " +
      "else's trip, which they have never seen",
  );
});

/**
 * The plan is explicit: *"Re-dating recomputes per diem through the **existing**
 * `recomputeGroupPerDiem` — do not write a second recompute."* Four things
 * compute an AP-17 per-diem figure and CLAUDE.md records that keeping them from
 * disagreeing is the whole discipline; a fifth, hand-rolled inside the cascade,
 * is exactly the drift that discipline exists to stop.
 */
/**
 * **Per function, not per file — mutation-measured (2026-09-22, M13).** The
 * first version of this asserted `recomputeGroupPerDiem(` appeared *somewhere*
 * in `room-share-cascade-apply.ts`, and removing it from the **re-date** path
 * alone left the guard green: the death path still called it, so the file-wide
 * regex still matched, while a re-dated guest kept a figure priced for dates
 * it was no longer travelling on. Both paths reprice, for different reasons —
 * the death path gives the guest's day back to the guest's own group, the
 * date path re-prices the guest's new span — so both are asserted separately.
 */
const REPRICE_SITES: { name: string; signature: string; why: string }[] = [
  {
    name: "applyRoomShareDeath",
    signature: "export async function applyRoomShareDeath",
    why: "a cancelled guest must give its day back to its OWN group, exactly as it would " +
      "had it been cancelled directly — recomputeAfterDeath does nothing for it, because " +
      "the guest is in a different group on a different person's calendar",
  },
  {
    name: "applyRoomShareDates",
    signature: "export async function applyRoomShareDates",
    why: "a re-dated guest's span changed, so its days count did — without the reprice it " +
      "keeps the figure priced for the dates it is no longer travelling on, silently, and " +
      "AccRequest.TotalAmount with it",
  },
];

for (const site of REPRICE_SITES) {
  test(`${site.name} reprices through recomputeGroupPerDiem`, () => {
    const body = bodyOf(APPLY, site.signature);
    assert.ok(
      /recomputeGroupPerDiem\(/.test(body),
      `${site.name} no longer calls recomputeGroupPerDiem: ${site.why}`,
    );
  });
}

test("the cascade never rolls its own per-diem arithmetic", () => {
  const src = code(APPLY);
  assert.ok(
    !/computePerDiem\(/.test(src),
    "room-share-cascade-apply.ts calls computePerDiem directly. That is a fifth independent " +
      "per-diem computation; it must go through recomputeGroupPerDiem like the other three",
  );
  assert.ok(
    !/PerDiemTotal\s*=/.test(src),
    "room-share-cascade-apply.ts writes PerDiemTotal itself. recomputeGroupPerDiem owns that " +
      "column, together with AccRequest.TotalAmount beside it and perDiemWritable's gate over " +
      "both — a direct write skips all three",
  );
});

/**
 * The reprice's two options are what make it correct for a **re-date** rather
 * than a cancellation, and both are silent when dropped: `repriceRequestIds`
 * because `rewritePerDiemRow` returns early on an unchanged continuation flag
 * — which a span change very often leaves alone — and `affectedFromDate`
 * because a cancellation only ever affects later trips while a re-date can
 * move one earlier.
 */
test("the date cascade forces the guest's own reprice and re-anchors the outside arm", () => {
  // Sliced to `applyRoomShareDates` for M13's reason: a file-wide match would
  // be satisfied by these options sitting on some other call.
  const src = bodyOf(APPLY, "export async function applyRoomShareDates");
  assert.ok(
    /recomputeGroupPerDiem\([\s\S]*repriceRequestIds:\s*\[\s*action\.requestId\s*\]/.test(src),
    "the re-date's recomputeGroupPerDiem call no longer passes repriceRequestIds. " +
      "rewritePerDiemRow returns early when the continuation flag has not moved, and a guest " +
      "re-dated from 20–24 to 25–30 usually does not move it — the guest would keep a figure " +
      "priced for dates it is no longer travelling on, silently, on the path that writes " +
      "AccRequest.TotalAmount",
  );
  assert.ok(
    /recomputeGroupPerDiem\([\s\S]*affectedFromDate:\s*anchor/.test(src),
    "the re-date's recomputeGroupPerDiem call no longer passes affectedFromDate. The default " +
      "anchor is the cause's own depart date, which is right for a cancellation (only later " +
      "trips can gain a day) and wrong for a re-date that moves a guest EARLIER — every trip " +
      "between the old span and the new one would be dropped from the recompute",
  );
});

/**
 * `perdiem-recompute.ts`'s own half of the two options above. A narrowing back
 * to the three-cause world, or a quiet removal of `forceReprice`, breaks the
 * date cascade from the other end — where nothing in `room-share-cascade-apply.ts`
 * would go red.
 */
test("perdiem-recompute.ts still admits the host_redated cause and the forced reprice", () => {
  const src = code("lib/acc/travel-booking/perdiem-recompute.ts");
  assert.ok(
    /"host_redated"/.test(src),
    'RecomputeCause no longer admits "host_redated" — the date cascade\'s cause object would ' +
      "fail to typecheck, and reusing \"cancelled\" would write an activity-log sentence " +
      "claiming a guest's trip was cancelled when its dates merely moved",
  );
  assert.ok(
    /cause\.kind === "host_redated" \?/.test(src),
    "causeLabel has no branch for \"host_redated\" — the chain's final else is \"submitted\", " +
      'so every re-dated guest\'s audit row would read "ถูกยื่นคำขอเพิ่ม", which is false',
  );
  assert.ok(
    /forceReprice/.test(src) && /!forceReprice/.test(src),
    "rewritePerDiemRow's forceReprice override is gone. Its early return compares only the " +
      "continuation flag, so without the override a re-dated guest's days are never recomputed",
  );
  assert.ok(
    /perDiemWritable\(status\)/.test(src),
    "perDiemWritable's gate is gone from rewritePerDiemRow. forceReprice must override the " +
      "flag comparison and nothing else — an already-paid figure staying frozen is the one " +
      "rule a cascade must not be able to walk past",
  );
});

/**
 * The safety property, asserted where it is easiest to lose: a `try`/`catch`
 * added inside the cascade turns "the host's cancellation rolls back" into
 * "the guest silently survives", which is the exact outcome spec §4 calls
 * worse than a cancellation the user has to retry — and it is the change a
 * later reader is most likely to make, because an unhandled throw on a cancel
 * path looks like a robustness gap.
 */
test("the cascade never swallows its own failure", () => {
  const src = code(APPLY);
  assert.ok(
    !/\bcatch\s*[({]/.test(src),
    "room-share-cascade-apply.ts has grown a catch. Spec §4: the cascade runs in the host's " +
      "transaction so that a failure rolls the host's own cancellation back. A swallowed " +
      "failure leaves the host cancelled and its guests alive — the precise state this " +
      "feature exists to prevent",
  );
});
