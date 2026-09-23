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
 * ## Mutation-verified again, 2026-09-23 — 18 mutations, two found green and closed
 *
 * The round that moved the attach notice from the tab save to the submit. Each
 * of the new assertions was defeated on purpose before it was trusted: the
 * notice put back into `applyRoomShareSelection`; the mail deleted from
 * `claimRoomShareHostNotice`; `AND NotifiedAt IS NULL` dropped; `SYSDATETIME()`
 * replaced by a bound parameter; the conditional `UPDATE` rewritten as
 * `SELECT`-then-`UPDATE` and as `UPDATE`-then-`SELECT`; `OUTPUT inserted.
 * HostRequestId` removed; the null check on the claimed host removed; a
 * transaction of its own opened **through a cast**, the spelling measured green
 * in 2026-09-22's round; the runner swapped for a pool at both the queue call
 * and the submit's call site; the host id swapped for the guest's; the submit's
 * call deleted, moved after `tx.commit()`, moved before the running-number
 * allocation, and duplicated into `saveTravelBookingDraft`; and a new export
 * added to the service.
 *
 * **Two came back green**, and neither was in the functions this round touched:
 * the whole 2441-test suite passed against a narrowed `unchanged` early return
 * in `applyRoomShareSelection`, and against its delete-then-insert rewritten as
 * an in-place `UPDATE`. Both defeat once-per-binding from the other end — see
 * "the binding's write shape…" below, which closes them.
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
const REQUEST_SERVICE = "lib/acc/travel-booking/request-service.ts";

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

/**
 * Where a pattern first matches — the receiver-agnostic counterpart of
 * `assertBefore`, for ordering against things like `tx.commit()` that this
 * file has **measured** can be dodged by a cast (see the note on the transaction
 * assertions below). Fails closed: a pattern that no longer matches at all is
 * a red, not a skipped assertion.
 */
function indexOfMatch(body: string, re: RegExp, what: string): number {
  const m = re.exec(body);
  assert.notEqual(m, null, `${what} not found — has this function been rewritten?`);
  return (m as RegExpExecArray).index;
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

/* ══════════ the host notice — MOVED from the save to the submit, 2026-09-23 ══════════
 *
 * **These four tests ARE the assertion this file used to make about
 * `applyRoomShareSelection`. It was moved, not deleted**, and that sentence is
 * here so the next reader does not conclude the mail was dropped.
 *
 * What changed and why: the notice used to be queued at the end of
 * `applyRoomShareSelection`, which runs inside `saveTravelBookingDraft` — so a
 * host was told *"มีผู้ขอพักห้องร่วมกับคำขอของคุณ"* the moment somebody picked
 * them on a **draft**, before the guest had submitted anything and whether or
 * not they ever did. The user's instruction, 2026-09-23: *"เมลจะส่งเมื่อ
 * ส่งคำขอเท่านั้น"*.
 *
 * Moving the call alone would have answered only half of it. A `Returned`
 * request is resubmitted through the same path, so a submit-time send with no
 * memory mails the host a second identical notice for ONE guest — and since
 * spec §2 declined to ask the host's consent precisely on the condition that
 * §5's notice compensates, a host reading it twice may reasonably conclude
 * **two people** have attached. So the send is keyed on `AccTravelRoomShare.
 * NotifiedAt` (migration 158) and is exactly-once per binding.
 *
 * The atomicity argument did not change, only which transaction it is about,
 * and it is asserted here the same way: queued **on the caller's open
 * transaction**, by a function that **opens none of its own**.
 */

test("the tab SAVE no longer tells the host", () => {
  const body = bodyOf(SERVICE, "export async function applyRoomShareSelection");
  assert.ok(
    !/queueRoomShareAttachedMail\s*\(/.test(body),
    "applyRoomShareSelection queues the host notice again. That is the bug the 2026-09-23 " +
      "change removed: it runs inside saveTravelBookingDraft, so the host is mailed when a " +
      "DRAFT is saved — before the guest has submitted anything, and a requester who then " +
      "changes their mind has already mailed a colleague. The notice belongs to " +
      "claimRoomShareHostNotice, called from submitTravelBookingGroup",
  );
  /* And nobody else may write the binding: a second writer is a second place
     the stamp can be got wrong, which is how "the host is told exactly once"
     becomes "the host is told about as often as it happens to work out". */
  const save = code(REQUEST_SERVICE);
  const calls = save.match(/applyRoomShareSelection\s*\(/g) ?? [];
  assert.equal(
    calls.length,
    1,
    `request-service.ts calls applyRoomShareSelection ${calls.length} times, not once — the ` +
      "group save is the single writer of the binding",
  );
});

/**
 * **Found GREEN on 2026-09-23 and closed the same round.** The whole
 * 2441-test suite passed against a narrowed `unchanged` early return, and
 * against replacing the delete-then-insert with an in-place `UPDATE`. Both
 * matter because "once per binding" rests on TWO things and only one of them
 * is in `claimRoomShareHostNotice`:
 *
 * - **the early return is what PRESERVES the stamp.** Narrow it and an
 *   ordinary re-save of an untouched guest tab deletes and re-inserts the
 *   binding, so `NotifiedAt` is NULL again and a `Returned` request's
 *   resubmit tells the host a second time — which is exactly what they may
 *   read as a SECOND person having attached;
 * - **delete-then-insert is what DROPS it.** Rewrite the replace path as an
 *   `UPDATE … SET HostRequestId` and the stamp survives a change of host, so
 *   the guest attaches to somebody new and **that person is never told at
 *   all** — the mitigation §2 traded the host's consent for, silently absent.
 *
 * Neither is visible from `claimRoomShareHostNotice`, and neither can be
 * reached by a behavioural test (`@/env`). They are pinned here rather than in
 * `room-share-response-shape-guard.test.ts` because what they protect is the
 * notification, not the response shape.
 */
test("the binding's write shape is what makes the notice once-per-binding", () => {
  const body = bodyOf(SERVICE, "export async function applyRoomShareSelection");
  assert.ok(
    /if\s*\(\s*currentHostId\s*===\s*input\.hostRequestId\s*\)\s*return\s*\{\s*changed:\s*false\s*\}/.test(body),
    "applyRoomShareSelection's `unchanged` early return is gone or no longer tests exactly " +
      "`currentHostId === input.hostRequestId`. It is what leaves an untouched binding — and its " +
      "NotifiedAt stamp — alone on an ordinary re-save; without it every save of a guest tab " +
      "re-creates the row, and the next submit of a Returned request tells the host a second time",
  );
  assertBefore(
    body,
    "return { changed: false }",
    "DELETE FROM [dbo].[AccTravelRoomShare]",
    "the early return must come before anything is deleted, or it is not an early return",
  );
  assert.ok(
    /DELETE FROM \[dbo\]\.\[AccTravelRoomShare\]/.test(body) &&
      /INSERT INTO \[dbo\]\.\[AccTravelRoomShare\]/.test(body) &&
      !/UPDATE\s+\[dbo\]\.\[AccTravelRoomShare\]/.test(body),
    "applyRoomShareSelection changes a host in place instead of DELETE-then-INSERT. An UPDATE " +
      "carries NotifiedAt across to the new host, so a guest who switches colleagues is never " +
      "announced to the one they actually attached to — the row reads as already notified",
  );
});

test("the SUBMIT tells the host, on the caller's own transaction", () => {
  const body = bodyOf(SERVICE, "export async function claimRoomShareHostNotice");
  assert.ok(
    /queueRoomShareAttachedMail\s*\(\s*tx\s*,\s*\{\s*guestRequestId\s*,\s*hostRequestId\s*\}\s*\)/.test(body),
    "claimRoomShareHostNotice no longer calls queueRoomShareAttachedMail(tx, { guestRequestId, " +
      "hostRequestId }). Spec §2 declined to ask the host for consent and §5 makes this notice " +
      "the only mitigation — without it a guest attaches to somebody else's room and the host " +
      "finds out at check-in. `hostRequestId` must be the one the claim OUTPUT, not a second read",
  );
  /* Matched as `.commit(` / `.begin(` rather than `tx.commit()`, because the
     literal spelling was **measured green** against a mutation on 2026-09-22:
     `await (tx as unknown as { commit: () => Promise<void> }).commit();`
     contains no `tx.commit()` at all and sailed past. A receiver-agnostic
     pattern cannot be dodged by renaming the variable or casting it. */
  assert.ok(
    !/\.\s*begin\s*\(/.test(body) && !/\.\s*commit\s*\(/.test(body),
    "claimRoomShareHostNotice runs a transaction of its own. Queuing on a transaction it owns " +
      "would let the notice commit while the submit that caused it rolls back, and the " +
      "reverse — the stamp, the notice and the submission it announces must be one atomic thing",
  );
});

/**
 * **The stamp IS the claim.** One conditional `UPDATE … WHERE NotifiedAt IS
 * NULL` that `OUTPUT`s the host it just claimed, and the mail only where that
 * matched.
 *
 * A `SELECT` then an `UPDATE` would look identical in review and be wrong
 * twice: READ COMMITTED releases the SELECT's shared lock at statement end, so
 * two submits racing one guest both read NULL and both mail; and an
 * unconditional UPDATE re-stamps a binding the host was told about at its
 * first submit, which is the `Returned` → resubmit double-notice this column
 * exists to prevent. Hence the shape is pinned rather than the outcome — no
 * behavioural test can reach this function at all (`@/env`).
 */
test("the host notice is claimed exactly once per binding, not read-then-written", () => {
  const body = bodyOf(SERVICE, "export async function claimRoomShareHostNotice");
  assert.ok(
    /UPDATE\s+\[dbo\]\.\[AccTravelRoomShare\][\s\S]*?SET\s+NotifiedAt\s*=\s*SYSDATETIME\(\)/.test(body),
    "claimRoomShareHostNotice no longer stamps AccTravelRoomShare.NotifiedAt with SYSDATETIME(). " +
      "Without the stamp every resubmit of a Returned guest mails the host again; a JS Date " +
      "instead of SYSDATETIME() writes the wrong wall clock, which every other audit timestamp " +
      "in these databases avoids the same way",
  );
  assert.ok(
    /WHERE\s+GuestRequestId\s*=\s*@gid\s+AND\s+NotifiedAt\s+IS\s+NULL/.test(body),
    "the claim's WHERE no longer carries `AND NotifiedAt IS NULL`. Unconditional, it re-stamps " +
      "and re-mails on every submit — so a Returned request resubmitted tells the host a second " +
      "time, which reads as a SECOND person having attached to their room",
  );
  assert.ok(
    /OUTPUT\s+inserted\.HostRequestId/.test(body),
    "the claim no longer OUTPUTs the host it claimed. Read separately, the host can come from a " +
      "row this statement did not win — and the whole point of the conditional UPDATE is that " +
      "the winner is the only one who mails",
  );
  const queries = body.match(/\.query\(/g) ?? [];
  assert.equal(
    queries.length,
    1,
    `claimRoomShareHostNotice runs ${queries.length} statements, not one. The single conditional ` +
      "UPDATE is what makes the claim atomic; a second statement is either the read half of a " +
      "read-then-write or a second writer of the same column",
  );
  assert.ok(
    !/\bSELECT\b/.test(body),
    "claimRoomShareHostNotice reads before it writes. READ COMMITTED releases a SELECT's shared " +
      "lock at statement end, so two submits racing one guest both see NotifiedAt IS NULL and " +
      "both mail the host — the exact duplicate this column exists to prevent",
  );
  assert.ok(
    /if\s*\(\s*(?:!\s*hostRequestId|hostRequestId\s*==\s*null)\s*\)/.test(body),
    "the null check on the claimed host is gone, so a guest with NO binding — the overwhelmingly " +
      "common case — would reach queueRoomShareAttachedMail with nothing to name",
  );
  assertBefore(
    body,
    "NotifiedAt IS NULL",
    "queueRoomShareAttachedMail",
    "the claim must come before the mail: mailing first and stamping afterwards sends a notice " +
      "that a concurrent submit may have already sent",
  );
});

/**
 * And it is `submitTravelBookingGroup` that calls it, once per tab, **inside
 * the submit's own transaction**.
 *
 * Two separate failures are pinned here because they look alike and are not.
 * A call moved *after* `tx.commit()` sends a notice that a rolled-back submit
 * cannot take back, and stamps `NotifiedAt` on a binding nothing was sent
 * about — either way the two halves stop being atomic. A *second* call site is
 * a second place the once-per-binding rule has to hold; it happens to hold
 * (the claim is conditional), but a second site is also a second place the
 * mail can be sent from a path that is not a submit, which is what this whole
 * change was about.
 */
test("submitTravelBookingGroup is the one site, and it is inside the transaction", () => {
  const src = code(REQUEST_SERVICE);
  const calls = src.match(/claimRoomShareHostNotice\s*\(/g) ?? [];
  assert.equal(
    calls.length,
    1,
    `request-service.ts calls claimRoomShareHostNotice ${calls.length} times, not once. The ` +
      "submit is the only event that may tell the host — the tab save deliberately does not, " +
      "which is the whole of the 2026-09-23 change",
  );

  const body = bodyOf(REQUEST_SERVICE, "export async function submitTravelBookingGroup");
  const begin = indexOfMatch(body, /\.\s*begin\s*\(/, "the submit's tx.begin()");
  const notice = indexOfMatch(
    body,
    /claimRoomShareHostNotice\s*\(\s*tx\s*,/,
    "claimRoomShareHostNotice(tx, …) inside submitTravelBookingGroup",
  );
  const commit = indexOfMatch(body, /\.\s*commit\s*\(/, "the submit's tx.commit()");
  assert.ok(
    begin < notice && notice < commit,
    "claimRoomShareHostNotice is no longer called between the submit's begin and commit. After " +
      "the commit the host is told about a submission that may have rolled back, and the stamp " +
      "saying they were told commits separately from the mail saying it",
  );

  /* And AFTER the running number, which is the half of this change that is a
     repair rather than a move: the mail renders the guest's number and its
     per-diem figures, both minted by statements in this same loop. Called
     ahead of them it prints `เลขที่คำขอของผู้พักร่วม: -` — exactly what the
     old save-time send did, the guest being an unnumbered draft. */
  const allocate = indexOfMatch(body, /allocateRequestNo\s*\(/, "the running-number allocation");
  assert.ok(
    allocate < notice,
    "claimRoomShareHostNotice now runs before the tab's running number is allocated, so the " +
      "host's mail names `-` where the guest's number belongs. Spec §5 asks for the guest to be " +
      "identifiable immediately; an unnumbered one is not",
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
 * of the six a queued or `Failed` row is, and an operator looking at a stuck
 * queue, or anyone later counting how often the paid-then-cancelled case
 * actually happens, would have six different notifications flattened into
 * one label.
 */
test("the queued row's TriggerType is the mail's own kind", () => {
  const src = code(NOTIFY);
  assert.ok(
    /triggerType:\s*input\.kind/.test(src),
    "queueEmail's triggerType is no longer input.kind. A literal there is a second place to " +
      "name the same thing and the two drift; a shared constant collapses all six kinds into " +
      "one label, and AccEmailQueue.TriggerType is the only record of which mail a row is",
  );
});

test("each cascaded guest's own mail is addressed to the GUEST", () => {
  const body = bodyOf(NOTIFY, "export async function queueRoomShareCascadeMails");
  const addressed = body.match(/queueOne\(runner,\s*guestFacts\?\.email \?\? null,/g) ?? [];
  assert.equal(
    addressed.length,
    3,
    "the cancel, detach and re-date mails must all be addressed to guestFacts?.email — exactly " +
      "three of them since final review C1 added the detach. Addressed to the host instead, the " +
      "person whose trip was just cancelled, detached or moved is told nothing at all, while the " +
      "host receives a mail per guest about records they cannot open",
  );
});

/**
 * The detach arm exists at all, and it is addressed to the guest rather than
 * folded into the cancel one.
 *
 * Final review C1: a `Draft`/`Returned` guest is detached rather than
 * cancelled, and the two need different copy — the cancelled guest is told to
 * file a new request, the detached one is told their request survives and
 * owes the form an accommodation. Reusing `RoomShareGuestCancelled` for both
 * would tell somebody their request had been cancelled when it had not, on
 * the one mail that is their only notice of the change.
 */
test("a detached guest is told, with its own mail kind", () => {
  const body = bodyOf(NOTIFY, "export async function queueRoomShareCascadeMails");
  assert.ok(
    /action\.kind === "detach"/.test(body),
    "queueRoomShareCascadeMails no longer branches on the detach action. A guest detached from " +
      "a dying host would be told nothing — and unlike a cancellation there is no other signal " +
      "at all, since their own request is left exactly as it was apart from an accommodation " +
      "field that is suddenly required again",
  );
  assert.ok(
    /kind: "RoomShareGuestDetached"/.test(body),
    "the detach arm no longer queues RoomShareGuestDetached. Reusing the cancelled kind tells " +
      "somebody their request was cancelled when it was not",
  );
  assert.ok(
    /a\.kind === "detach"/.test(body),
    "the `affected` filter no longer admits detach actions, so the arm below it is unreachable " +
      "— the mail would silently never be queued",
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
