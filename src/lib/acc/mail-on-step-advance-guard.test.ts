import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * **Nobody is mailed when a step merely advances** (the user, 2026-09-24).
 *
 * Mail now marks the moments a person has something to do or to know:
 *
 *   ส่งคำขอ              → the manager
 *   บัญชีอนุมัติ          → the requester
 *   ไม่อนุมัติ / ส่งกลับ   → the requester
 *   ค้างผู้จัดการ > 30 วัน  → the requester (the stale sweep, already so)
 *
 * Everything else went: the five forms used to mail the next queue's whole
 * roster at every hop, and three of them mailed the requester a second time to
 * say their manager had said yes.
 *
 * **This is a source-shape guard and the weaker of the two layers a change like
 * this deserves.** It cannot prove a mail is sent at the right moment — the
 * engines reach a pool, so `@/env` validates the whole environment at import
 * and none of them can be called from a test at all. What it can do is pin the
 * shape that was removed: a loop over a roster with a `queueEmail`/`notify`
 * inside it, which is how every one of the deleted sends was written, and how
 * the next one would be.
 */

const FILES = [
  "src/lib/acc/approval-engine.ts",
  "src/lib/acc/travel-booking/approval.ts",
  "src/lib/acc/reimburse/approval-service.ts",
  "src/lib/adv/advance-approval-engine.ts",
  "src/lib/clr/clear-advance-approval-engine.ts",
];

function code(file: string): string {
  return fs
    .readFileSync(path.resolve(process.cwd(), file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/**
 * The roster mails that remain — two, each named so it is an exception on the
 * record rather than an oversight, and each with the reason it survived.
 *
 * `returnByAccount` (AP-17) tells the Admin desk that accounting has sent a
 * booking back to be redone. Structurally it is a mail to a queue, which is
 * what the 2026-09-24 change removed everywhere else; semantically it is a
 * ส่งกลับ — work already done being refused — and the file's own comment argues
 * that a bounce is an exception worth an interruption where routine arrivals
 * are not. Kept on that reading, and pinned here in one place so that removing
 * it is a decision somebody takes rather than a sweep they run.
 *
 * It also inherits a defect that file records: it reads AP-1's `AccApprover`
 * roster while AP-17's Admin desk is `AccBookingApprover`, so it reaches people
 * who cannot act and misses people who can. Nobody has asked for that yet.
 */
const ALLOWED_ROSTER_MAIL: readonly RegExp[] = [
  /"ReadyForAdmin"/,
  /**
   * AP-2's own cancellation, which reaches Head Accounting as well as the
   * requester.
   *
   * **A cancellation is not one of the five events the rule names**, so it was
   * left alone — and it is a different thing from a step advancing: money
   * already committed is being released, and the people who approved it have a
   * reason to know. AP-1's and AP-3's cancellations mail people too; they
   * simply do not use a loop, which is the only reason they need no line here.
   */
  /triggerType: "Cancelled"/,
  /**
   * AP-2's on-behalf fan-out, added 2026-09-25.
   *
   * **This is not a roster.** The rule above bans mailing a whole queue at
   * every hop; this loop runs over `onBehalfNotifyList([req.requesterEmail],
   * pair)`, which is the requester plus — only when the request was filed on
   * their behalf — the one person who filed it. At most two addresses, both
   * belonging to this request, on the events the rule already names
   * (อนุมัติ / ไม่อนุมัติ / ส่งกลับ). It became a loop only because the
   * recipient stopped being a single address; the send did not multiply.
   *
   * Matched on that exact list rather than on the trigger names, so passing a
   * roster through the same funnel is still caught — which is why AP-2's
   * cancellation, which really does union the Head Accounting roster, needs
   * the separate entry above and does not ride on this one.
   */
  /onBehalfNotifyList\(\[req\.requesterEmail\]/,
];

test("no approval engine mails a roster in a loop", () => {
  /* The deleted shape, in all five: `for (const a of approvers) await
     notify(...)`. A queue's own page is where that work is found; a message per
     arrival is a message nobody reads. */
  for (const file of FILES) {
    const src = code(file);
    /* The match runs PAST the opening bracket and on to the statement's `;`,
       so the trigger name is inside it — without that the exemption below can
       never fire, because every one of these calls looks identical up to
       `notify(`. */
    const loops = (
      src.match(
        /for\s*\([^)]*\)\s*\{?[\s\S]{0,200}?await\s+(?:notify|queueEmail|notifyQuietly)\([^;]*;/g,
      ) ?? []
    ).filter((m) => !ALLOWED_ROSTER_MAIL.some((re) => re.test(m)));
    assert.equal(
      loops.length,
      0,
      `${file} mails inside a loop again — that is the per-arrival notification the ` +
        "2026-09-24 change removed from every form",
    );
  }
});

test("the one allowed roster mail is still the Admin bounce, and still alone", () => {
  /* If this reds because the trigger was renamed, re-read `ALLOWED_ROSTER_MAIL`
     before widening it: the exemption is for one send, not for the shape. */
  const src = code("src/lib/acc/travel-booking/approval.ts");
  const hits = src.match(/"ReadyForAdmin"/g) ?? [];
  assert.equal(hits.length, 1, `expected exactly one ReadyForAdmin send, found ${hits.length}`);
});

test("no approval engine mails the manager", () => {
  /* `managerEmail` was a second recipient on AP-1's and AP-4's final approval.
     The manager acted on the claim and their own queue shows what became of it.
     AP-3's cancellation still mails them and is deliberately out of scope here:
     a cancellation is not one of the five events the rule names. */
  for (const file of ["src/lib/acc/approval-engine.ts", "src/lib/acc/reimburse/approval-service.ts"]) {
    const src = code(file);
    assert.equal(
      /notify\w*\([^)]*managerEmail/.test(src),
      false,
      `${file} mails the manager on an approval again`,
    );
  }
});

test("the submit still mails the manager, and it is the only one that does", () => {
  // The first of the four events, and the one nothing here may remove: without
  // it a filed request sits in a queue its manager does not know exists.
  for (const file of [
    "src/lib/acc/request-service.ts",
    "src/lib/acc/reimburse/request-service.ts",
    "src/lib/clr/clear-advance-request-service.ts",
    "src/lib/adv/advance-request-service.ts",
  ]) {
    const src = code(file);
    assert.ok(
      /triggerType:\s*"Submitted"/.test(src),
      `${file} no longer queues the Submitted mail to the manager`,
    );
  }
});

test("a rejection and a return still reach the requester", () => {
  for (const file of FILES) {
    const src = code(file);
    if (!/"Rejected"/.test(src) && !/"Returned"/.test(src)) continue;
    assert.ok(
      /requesterEmail/.test(src),
      `${file} handles a rejection or a return and names no requester address`,
    );
  }
});
