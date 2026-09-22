import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * **Notification is the ENTIRE mitigation for three costs the user accepted,
 * and the failure to catch is a missing call.**
 *
 * AP-17 package E, spec §5. `buildRoomShareEmail` is behaviourally tested in
 * full (`email-templates.test.ts` — ten cases, no database). What no
 * behavioural test can see is whether anything *calls* it, on which runner,
 * and under which condition: delete the call and every cascade still cancels,
 * still re-dates, still writes its activity row and still returns the same
 * `GuestAction[]`. The only symptom is a host who first meets their room-mate
 * at check-in, a requester whose trip vanished with no explanation, and an
 * accounting desk that finds a paid-then-cancelled claim months later — which
 * is exactly the state spec §2 accepted *on condition that it is not silent*.
 *
 * Source-reading, and it has to be: `room-share-notify.ts`,
 * `room-share-cascade-apply.ts` and `room-share-service.ts` all reach
 * `getAccPool()` → `@/lib/db/mssql` → `@/env`, which validates the whole
 * environment at import time and throws in a test run. None can be imported.
 * The helpers below are `room-share-cascade-guard.test.ts`'s, copied rather
 * than shared for the reason that file gives — a guard that imports another
 * guard's machinery can be disarmed from a file nobody thinks of as a guard.
 *
 * ## Mutation-verified, 2026-09-22 — 21 mutations, one found green and closed
 *
 * Every assertion here was defeated on purpose before it was trusted: each
 * call removed, the attach notice moved after the commit, the runner argument
 * dropped, `applied` swapped for `decided`, each accounting arm deleted and
 * inverted, `perDiemWritable` replaced by a hardcoded `"Completed"`, the two
 * parties swapped, each mail re-addressed to the wrong side, and the roster
 * switched to AP-1's. **One came back green** — `triggerType` replaced by a
 * single literal — and is closed below; two more probes were added in the
 * same round. Full results are in this branch's Task 8 report.
 *
 * **What this file deliberately cannot catch**, stated so it is not mistaken
 * for coverage: a body gutted with an early `return`. Every call, argument
 * and gate below would still read correctly in the source. The realistic
 * regressions are a deleted call, a moved call and a dropped arm, and those
 * are what these assertions are shaped around; pinning "no early return"
 * would be pinning an implementation detail that legitimately changes.
 */

function read(relative: string): string {
  return fs.readFileSync(path.join(process.cwd(), "src", relative), "utf8");
}

/** Comments quoting a rule must not satisfy or trip the check for it. */
function code(relative: string): string {
  return read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const NOTIFY = "lib/acc/travel-booking/room-share-notify.ts";
const APPLY = "lib/acc/travel-booking/room-share-cascade-apply.ts";
const SERVICE = "lib/acc/travel-booking/room-share-service.ts";

/** One function's body, sliced from its signature to the next top-level function declaration. */
function bodyOf(file: string, signature: string): string {
  const src = code(file);
  const start = src.indexOf(signature);
  assert.notEqual(start, -1, `${signature} not found in ${file} — has it been renamed?`);
  const rest = src.slice(start + signature.length);
  const next = /\n(?:export\s+)?(?:async\s+)?function\s/.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

/** `a` must appear, `b` must appear, and `a` must come first. */
function assertBefore(body: string, a: string, b: string, why: string): void {
  const ai = body.indexOf(a);
  const bi = body.indexOf(b);
  assert.notEqual(ai, -1, `${a} not found — ${why}`);
  assert.notEqual(bi, -1, `${b} not found`);
  assert.ok(ai < bi, `${a} must come before ${b}: ${why}`);
}

/* ─────────────────── the three sites that must notify ─────────────────── */

const CASCADE_SITES: { name: string; signature: string; why: string }[] = [
  {
    name: "applyRoomShareDeath",
    signature: "export async function applyRoomShareDeath",
    why: "a guest cancelled by its host's death is told by nothing else — not by the " +
      "activity row, which is on a record they have no reason to open. And the accounting " +
      "mail for a guest cancelled after payment hangs off this same call: without it, spec " +
      "§2's accepted cost becomes the silent reconciliation it was accepted on condition " +
      "of not being",
  },
  {
    name: "applyRoomShareDates",
    signature: "export async function applyRoomShareDates",
    why: "a guest whose trip moved from 20–24 to 25–30 with no manager re-reviewing it is " +
      "told by nothing else, and this is also the only place accounting hears that a " +
      "Completed guest's dates moved while perDiemWritable froze its figure",
  },
];

for (const site of CASCADE_SITES) {
  test(`${site.name} queues the room-share notifications`, () => {
    const body = bodyOf(APPLY, site.signature);
    assert.ok(
      /queueRoomShareCascadeMails\s*\(\s*runner\s*,/.test(body),
      `${site.name} no longer calls queueRoomShareCascadeMails(runner, …): ${site.why}`,
    );
  });
}

test("the death cascade mails what it APPLIED, never what it merely decided", () => {
  const body = bodyOf(APPLY, "export async function applyRoomShareDeath");
  assert.ok(
    /queueRoomShareCascadeMails\s*\(\s*runner\s*,\s*hostRequestId\s*,\s*applied\s*\)/.test(body),
    "applyRoomShareDeath passes something other than `applied` to queueRoomShareCascadeMails. " +
      "`decided` is what the pure cascade wanted; `applied` is what survived the guarded " +
      "UPDATE, which downgrades a cancel that lost a race to a skip. Mailing `decided` tells " +
      "a requester their trip was cancelled when it was not, and tells accounting to chase a " +
      "payment on a claim nothing touched",
  );
});

test("attachRoomShare tells the host, and does it BEFORE the commit", () => {
  const body = bodyOf(SERVICE, "export async function attachRoomShare");
  assert.ok(
    /queueRoomShareAttachedMail\s*\(\s*tx\s*,/.test(body),
    "attachRoomShare no longer calls queueRoomShareAttachedMail(tx, …). Spec §2 declined to " +
      "ask the host for consent and §5 makes this notice the only mitigation — without it a " +
      "guest attaches to somebody else's room and the host finds out at check-in",
  );
  assertBefore(
    body,
    "queueRoomShareAttachedMail(tx",
    "await tx.commit()",
    "the notice must be queued inside the transaction that inserts the binding. Queued after " +
      "the commit, a binding can exist with no notice ever written — the mitigation silently " +
      "not happening, which is the one failure mode this feature cannot afford",
  );
});

/* ─────────────────── how the notifier queues, and on what ─────────────────── */

test("every room-share mail is queued on the CALLER'S RUNNER, not on a pool", () => {
  const src = code(NOTIFY);
  const calls = src.match(/queueEmail\s*\(/g) ?? [];
  assert.equal(
    calls.length,
    1,
    "room-share-notify.ts has more than one queueEmail call site. One (`queueOne`) is what " +
      "makes 'queued on the transaction' a property of the module rather than of each caller; " +
      "a second can silently omit the runner",
  );
  assert.ok(
    /queueEmail\s*\([\s\S]*?,\s*runner,?\s*\)/.test(src),
    "queueEmail is called without the runner. `on` defaults to getAccPool(), so the row would " +
      "be inserted OUTSIDE the cascade's transaction — committing a notice about a " +
      "cancellation that then rolls back, and, worse, losing the notice when the cascade " +
      "commits but the separate insert fails",
  );
});

/**
 * **Found green, 2026-09-22.** The first version of this file asserted that
 * `queueEmail` was called on the runner and nothing about *what* it was
 * called with, so replacing `triggerType: input.kind` with one constant
 * string passed the whole suite. Nothing breaks immediately — the mail still
 * sends — but `AccEmailQueue.TriggerType` is the only column that says which
 * of the five a queued or `Failed` row is, and an operator looking at a stuck
 * queue, or anyone later counting how often the paid-then-cancelled case
 * actually happens, would have five different notifications flattened into
 * one label.
 */
test("the queued row's TriggerType is the mail's own kind", () => {
  const src = code(NOTIFY);
  assert.ok(
    /triggerType:\s*input\.kind/.test(src),
    "queueEmail's triggerType is no longer input.kind. A literal there is a second place to " +
      "name the same thing and the two drift; a shared constant collapses all five kinds into " +
      "one label, and AccEmailQueue.TriggerType is the only record of which mail a row is",
  );
});

test("each cascaded guest's own mail is addressed to the GUEST", () => {
  const body = bodyOf(NOTIFY, "export async function queueRoomShareCascadeMails");
  const addressed = body.match(/queueOne\(runner,\s*guestFacts\?\.email \?\? null,/g) ?? [];
  assert.equal(
    addressed.length,
    2,
    "the cancel and re-date mails must both be addressed to guestFacts?.email — exactly two of " +
      "them. Addressed to the host instead, the person whose trip was just cancelled or moved " +
      "is told nothing at all, while the host receives a mail per guest about records they " +
      "cannot open",
  );
});

test("the notifier never degrades gracefully", () => {
  const src = code(NOTIFY);
  assert.ok(
    !/\bcatch\b/.test(src),
    "room-share-notify.ts has grown a catch. Same rule room-share-cascade-apply.ts states: a " +
      "swallowed failure here is a cascade that commits while nobody is told, which is " +
      "precisely the silent survival the transaction boundary exists to make impossible",
  );
});

/* ─────────────────── the two accounting triggers ─────────────────── */

test("accounting is told when a cascade cancels a request that had already been paid", () => {
  const src = code(NOTIFY);
  assert.ok(
    /wasCompleted/.test(src) && /RoomShareAccountingCancelled/.test(src),
    "the wasCompleted → RoomShareAccountingCancelled arm is gone. Spec §2 accepted that a " +
      "Completed guest is cancelled anyway EXPLICITLY on the condition that accounting is " +
      "told the moment it happens rather than discovering the reconciliation later",
  );
  assertBefore(
    src,
    "action.wasCompleted",
    "RoomShareAccountingCancelled",
    "the accounting mail must be gated on wasCompleted — sending it for every cascaded guest " +
      "would bury the paid ones in noise",
  );
});

test("accounting is told when a Completed guest's dates move but its money cannot", () => {
  const src = code(NOTIFY);
  assert.ok(
    /perDiemWritable\(/.test(src),
    "room-share-notify.ts no longer consults perDiemWritable. That predicate is the whole " +
      "trigger for the user's 2026-09-22 ruling: a Completed guest is re-dated while its paid " +
      "figure is deliberately left frozen, so the record reads 25–30 against a payment " +
      "computed on 20–24. Without this mail the conservative choice about the money is also " +
      "the silent one",
  );
  assert.ok(
    /!perDiemWritable\([\s\S]{0,400}?RoomShareAccountingRedated/.test(src),
    "the RoomShareAccountingRedated mail is no longer gated on !perDiemWritable(status). " +
      "Gated the other way it mails accounting about every ordinary re-date; ungated it " +
      "stops naming the one case that needs a human",
  );
});

test("the frozen-money check reads the guest's CURRENT status, not the action", () => {
  const body = bodyOf(NOTIFY, "export async function queueRoomShareCascadeMails");
  assert.ok(
    /perDiemWritable\(\s*guestFacts\.status\s*\)/.test(body),
    "the re-date's accounting gate no longer reads guestFacts.status. A GuestAction carries " +
      "`wasCompleted` only on a cancel — a redate action has no status at all — and a re-date " +
      "does not change the row's status, so the freshly-read value is the only honest answer " +
      "to 'can this one's money still move'",
  );
});

/* ─────────────────── who gets told, and about which request ─────────────────── */

test("the host mail goes to the HOST and is about the HOST's request", () => {
  const body = bodyOf(NOTIFY, "export async function queueRoomShareAttachedMail");
  assert.ok(
    /host\?\.email/.test(body),
    "queueRoomShareAttachedMail no longer addresses the host. Addressed to the guest it tells " +
      "somebody what they just did themselves, and the host — the only person this mail " +
      "exists for, because they were never asked — hears nothing",
  );
  assert.ok(
    /subjectOf:\s*toParty\(\s*host\s*,/.test(body),
    "queueRoomShareAttachedMail's subjectOf is no longer the host's request. subjectOf drives " +
      "the CTA link, and decideRequestRead refuses the host the guest's record — so the one " +
      "mail compensating for the missing consent would land on a 404",
  );
  assert.ok(
    /counterpart:\s*toParty\(\s*guest\s*,/.test(body),
    "queueRoomShareAttachedMail no longer names the guest as the counterpart. Spec §5's whole " +
      "requirement is that an unexpected guest is visible immediately",
  );
});

test("accounting means AP-17's own roster, never AP-1's", () => {
  const src = code(NOTIFY);
  assert.ok(
    /listBookingApprovers\(/.test(src),
    "room-share-notify.ts no longer resolves accounting from AccBookingApprover",
  );
  assert.ok(
    !/\blistApprovers\b/.test(src),
    "room-share-notify.ts reaches for listApprovers — AP-1's AccApprover roster. approval.ts " +
      "already carries two comments recording that exact mistake: it mails people who cannot " +
      "act on an AP-17 request and misses the people who can. AP-17's roster is " +
      "AccBookingApprover, and CLAUDE.md records that the two forms deliberately do not share " +
      "one",
  );
});
