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
const SERVICE = "lib/acc/travel-booking/room-share-service.ts";

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

test("the applied cascade writes every activity action spec §4 names", () => {
  const src = code(APPLY);
  /* THE LITERALS MOVED on 2026-09-22 (final review I3) into
     `room-share-actions.ts`, which imports nothing, so the detail page's
     renderer could share them without dragging `@/env` into the client
     bundle. So this test now checks two things instead of one: that the
     literals still exist, in that module, and that the apply layer still
     reaches for each of them BY NAME. Keeping only the first would let the
     apply layer stop writing a row while the constant sat unused; keeping
     only the second would let a literal be renamed out from under the
     reader. */
  const actions = code("lib/acc/travel-booking/room-share-actions.ts");
  for (const [name, literal] of [
    ["CASCADE_CANCEL_ACTION", "cancelled_by_room_share_host"],
    ["CASCADE_DETACH_ACTION", "detached_by_room_share_host"],
    ["CASCADE_REDATE_ACTION", "dates_followed_room_share_host"],
  ]) {
    assert.ok(
      actions.includes(`"${literal}"`),
      `${literal} is gone from room-share-actions.ts. Spec §4 requires an activity row for ` +
        "every cascaded guest, and the detail page reads these exact values back — a requester " +
        "would find their trip cancelled, detached or re-dated with nothing in the timeline " +
        "saying why, and accounting nothing to reconcile a paid-then-cancelled claim against",
    );
    assert.ok(
      src.includes(name),
      `${name} is no longer named in room-share-cascade-apply.ts — the constant exists and ` +
        "nothing writes it, so that arm of the cascade leaves no audit row at all",
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

/* ═════════════ mutation M1 — the same rule, at the CALL SITES ═════════════
 *
 * **Measured GREEN on 2026-09-22 and closed here.** The ban above covers
 * room-share-cascade-apply.ts and nothing else, while the calls live in
 * approval.ts and request-service.ts. Wrapping one of them —
 *
 *     try { await applyRoomShareDeath(tx, requestId); } catch { }
 *
 * — passed the entire suite, 2211 of 2211, and converted this branch's whole
 * safety story from "if it fails, the host's own cancellation rolls back"
 * into "the host is cancelled and its guests silently survive": the one state
 * spec §4 says the feature exists to prevent. A file-wide catch ban is not
 * available in either file, because both legitimately contain
 * transaction-owner try/catch pairs.
 *
 * So the property is expressed exactly: the cascade call MAY sit inside a
 * try, but only one whose catch RETHROWS. That admits the transaction owner
 * in saveTravelBookingDraft (catch (e) { await tx.rollback(); throw e; }),
 * which is the shape that makes the guarantee rather than breaking it, and
 * refuses a catch that degrades gracefully — which is the whole mutation.
 */

/**
 * The try blocks open at `index`, outermost first.
 *
 * Brace-depth scan over already-comment-stripped source, so the word try in a
 * docblock — and both files have several — cannot register. A brace counts as
 * a try body when the non-space text immediately before it ends in the
 * keyword try, so `.catch(() => {})` and an identifier ending in "try" are
 * both ignored.
 */
function enclosingTryBlocks(body: string, index: number): number[] {
  const stack: { open: number; isTry: boolean }[] = [];
  for (let i = 0; i < index; i++) {
    const ch = body[i];
    if (ch === "{") {
      const before = body.slice(Math.max(0, i - 8), i).replace(/\s+$/, "");
      stack.push({ open: i, isTry: /(^|[^A-Za-z0-9_$])try$/.test(before) });
    } else if (ch === "}") {
      stack.pop();
    }
  }
  const out: number[] = [];
  for (const frame of stack) if (frame.isTry) out.push(frame.open);
  return out;
}

/** The catch clause belonging to the try block whose body opens at `open`, or null for try/finally. */
function catchClauseFor(body: string, open: number): string | null {
  let depth = 0;
  for (let i = open; i < body.length; i++) {
    if (body[i] === "{") depth++;
    else if (body[i] === "}") {
      depth--;
      if (depth === 0) {
        const m = /^\s*catch\s*(\([^)]*\))?\s*\{/.exec(body.slice(i + 1));
        if (!m) return null;
        const start = i + m[0].length;
        let d = 0;
        for (let j = start; j < body.length; j++) {
          if (body[j] === "{") d++;
          else if (body[j] === "}") {
            d--;
            if (d === 0) return body.slice(start, j + 1);
          }
        }
        return body.slice(start);
      }
    }
  }
  return null;
}

const CASCADE_CALL_SITES: { file: string; name: string; signature: string; call: string; why: string }[] = [
  {
    file: APPROVAL,
    name: "recomputeAfterDeath",
    signature: "async function recomputeAfterDeath",
    call: "applyRoomShareDeath(tx",
    why: "this ONE call serves all four public cancel/reject paths — rejectRequest, " +
      "cancelByRequester, and transitionFromStage for both rejectByAdmin and rejectByAccount",
  },
  {
    file: REQUEST_SERVICE,
    name: "collectAndDeleteRequestArtifacts",
    signature: "async function collectAndDeleteRequestArtifacts",
    call: "applyRoomShareDeath(tx",
    why: "the fifth trigger — a Returned host hard-deleted by its owner, whose guests point " +
      "at a request that is about to stop existing",
  },
  {
    file: REQUEST_SERVICE,
    name: "saveTravelBookingDraft",
    signature: "export async function saveTravelBookingDraft",
    call: "applyRoomShareDates(tx",
    why: "BOOKING_SET is the only writer of DepartDate/ReturnDate in src/, so this is the " +
      "only place a host's dates can move",
  },
];

for (const site of CASCADE_CALL_SITES) {
  test(`the cascade call in ${site.name} is never swallowed`, () => {
    const body = bodyOf(site.file, site.signature);
    const at = body.indexOf(site.call);
    assert.notEqual(at, -1, `${site.call} not found in ${site.name} — ${site.why}`);
    for (const open of enclosingTryBlocks(body, at)) {
      const clause = catchClauseFor(body, open);
      if (clause === null) continue; // try/finally with no catch swallows nothing
      assert.ok(
        /\bthrow\b/.test(clause),
        `${site.call} in ${site.name} sits inside a try whose catch does not rethrow. That ` +
          "converts the cascade's whole guarantee — if it fails, the host's own cancellation " +
          "rolls back — into the host dying while its guests silently survive, the state spec " +
          "§4 names as the one this feature exists to prevent. Measured: exactly this edit " +
          "passed 2211/2211 before this test existed. " +
          site.why,
      );
    }
  });
}

/* ═════════ mutation M2 — the death UPDATE's own predicate ═════════
 *
 * **Measured GREEN.** Widening it to NOT IN ('Cancelled','Rejected','Completed')
 * passed the whole suite while quietly retiring the single most contested
 * decision in the spec: §2's "a guest is cancelled even after it has been
 * paid". A Completed guest is then downgraded to a skip — no activity row,
 * and no mail to accounting, which is the entire mitigation the decision was
 * accepted on.
 *
 * It looked covered and was not: room-share-cascade.test.ts asserts the
 * DECISION layer emits cancel for a Completed guest, and nothing read the
 * APPLY layer's SQL at all. Both halves are pinned now, and loadGuestsOf's
 * WHERE with them — narrowing there removes the guest from the cascade
 * entirely, which is the same defect one query earlier and quieter still.
 */
test("the death UPDATE spares only what is ALREADY dead — never what is merely paid", () => {
  const body = bodyOf(APPLY, "export async function applyRoomShareDeath");
  assert.ok(
    /WHERE Id=@gid AND Status NOT IN \('Cancelled','Rejected'\);/.test(body),
    "applyRoomShareDeath's claiming UPDATE no longer reads exactly " +
      "WHERE Id=@gid AND Status NOT IN ('Cancelled','Rejected'); — that predicate IS spec §2's " +
      "most contested decision, a guest cancelled even after its per diem has been paid, and " +
      "the only other expression of it is the decision layer, which this statement silently " +
      "overrules. Adding 'Completed' downgrades such a guest to a skip: no activity row, and " +
      "no mail to accounting",
  );
  // The STATUS VALUE, not the word: `action.wasCompleted` is read a few lines
  // on and is the thing that tells Task 8 to mail accounting, so a bare
  // /Completed/ would forbid the arm this rule exists to protect.
  assert.ok(
    !/['"]Completed['"]/.test(body),
    "applyRoomShareDeath now names the status value 'Completed'. The apply layer must hold no " +
      "opinion about it — cascadeForHostDeath decides, and it decides cancel; sparing a paid " +
      "guest here reverses the user's ruling in the one place no test was reading",
  );
});

test("loadGuestsOf hands the cascade every guest, alive or dead, paid or not", () => {
  const body = bodyOf(SERVICE, "export async function loadGuestsOf");
  assert.ok(
    !/r\.Status\s*(<>|!=|=|NOT IN|IN)/.test(body),
    "loadGuestsOf's query now filters on r.Status. A guest dropped HERE never reaches " +
      "cascadeForHostDeath at all, so it is neither cancelled nor detached nor skipped nor " +
      "logged nor mailed — the same defect as sparing it in the UPDATE, one query earlier. " +
      "Which statuses are acted on is room-share-cascade.ts's decision, and it cannot make it " +
      "for rows it is never shown",
  );
});

/* ═════ mutation M6 — forceReprice must not reach `writable` ═════
 *
 * **Measured GREEN.** The assertion in the test above used to be
 * /perDiemWritable\(status\)/, so changing rewritePerDiemRow to
 *
 *     const writable = (perDiemWritable(status) || forceReprice) && …
 *
 * kept the string present, kept the guard green, and let a cascade rewrite
 * PerDiemTotal and AccRequest.TotalAmount on a Completed request — the exact
 * rule the old assertion's own message said it existed to hold.
 *
 * Pinned as the whole expression now, plus the mirror: forceReprice appears
 * exactly twice in the comment-stripped source, its parameter and the early
 * return it overrides, so a third occurrence is a new reach that has to be
 * argued for here.
 */
test("forceReprice overrides the flag comparison and NOTHING else", () => {
  const src = code("lib/acc/travel-booking/perdiem-recompute.ts");
  assert.ok(
    /const writable = perDiemWritable\(status\) && !!departDate && !!returnDate;/.test(src),
    "rewritePerDiemRow's `writable` is no longer exactly " +
      "perDiemWritable(status) && !!departDate && !!returnDate. That line is the only thing " +
      "standing between a room-share cascade and a figure accounting has already signed — " +
      "ORing forceReprice into it keeps every string the previous version of this guard looked " +
      "for while removing the rule, which is how it was measured GREEN on 2026-09-22",
  );
  const uses = src.match(/forceReprice/g) ?? [];
  assert.equal(
    uses.length,
    2,
    `forceReprice appears ${uses.length} times in perdiem-recompute.ts, not twice. It must be ` +
      "exactly its parameter and the `wasContinuation === nowContinuation && !forceReprice` " +
      "early return: a third use is a second thing a cascade can force, and the one worth " +
      "forcing was the flag comparison alone",
  );
});

/* ═════ C1 — the detach set and the group guards must agree ═════
 *
 * cascadeForHostDeath detaches exactly EDITABLE_STATUSES and cancels
 * everything else alive, and room-share-cascade.test.ts pins that against the
 * constant. This is the OTHER half: the three AP-17 group operations are the
 * hardcoded expression of the same pair, and the brick lives exactly where
 * the two disagree — a status those guards admit but the cascade cancels
 * makes the guest's whole group unsavable, unsubmittable AND undeletable,
 * with no in-app remedy at all.
 *
 * Source-reading because there is nothing else to read: the three guards are
 * inline `if`s inside functions that cannot be imported (@/env).
 */
test("all three AP-17 group guards still admit exactly Draft and Returned", () => {
  const src = code(REQUEST_SERVICE);
  const guards = src.match(/row\.Status !== "Draft" && row\.Status !== "Returned"/g) ?? [];
  assert.equal(
    guards.length,
    3,
    "expected the Draft/Returned group guard in all three of saveTravelBookingDraft, " +
      `deleteTravelBookingDraft and submitTravelBookingGroup, found ${guards.length}. If one ` +
      "gained a status, cascadeForHostDeath must gain it too — it detaches EDITABLE_STATUSES " +
      "and cancels everything else alive, so otherwise a cascade-cancelled tab bricks the " +
      "whole group again, which is final review C1. If one LOST its guard, that is a " +
      "different and larger problem",
  );
});
