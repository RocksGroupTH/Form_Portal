import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * **The stale-request sweep must stay AP-1 only, or it needs a room-share
 * cascade first.**
 *
 * Found by the AP-17 package E whole-branch review (2026-09-22), which swept
 * every writer of `AccRequest.Status` looking for a sixth cascade trigger.
 * `stale-request-sweep.ts` writes `Status='Cancelled'` from a background job,
 * one transaction and one commit per request, with **no** cascade hook. It is
 * not a trigger today only because `AP1_FORM_CODE` is pinned in both the
 * candidate `SELECT` and the claiming `UPDATE`, and an AP-1 request cannot be
 * an AP-17 room-share host.
 *
 * It is the highest-probability *future* one: AP-17 has a manager step and
 * the same "left for a month" problem, so somebody will point this at it. A
 * `Submitted` or `ManagerApproved` AP-17 host cancelled here would leave
 * every guest un-cancelled, un-detached and untold, drawing per diem on a
 * room that no longer exists — the exact state package E exists to prevent.
 *
 * **Nothing else would catch it.** `room-share-cascade-guard.test.ts` asserts
 * that the five *known* trigger paths call the cascade; no test can assert
 * that a path nobody has written yet does. So this one asserts the scope
 * instead, and fails loudly with the instruction rather than the diagnosis.
 *
 * Source-reading because `stale-request-sweep.ts` reaches `@/lib/acc/pool` →
 * `@/lib/db/mssql` → `@/env`, which validates the whole environment at import
 * and throws in a test run — the same constraint every guard in this
 * neighbourhood works under.
 *
 * **This test is not a veto.** Widening the sweep is a legitimate change; it
 * simply has to bring the cascade with it, and then this file has to be
 * rewritten to assert whatever the new scope is *and* that the cascade is
 * called inside the claiming transaction.
 */

const SWEEP = "lib/acc/stale-request-sweep.ts";

function read(relative: string): string {
  return fs.readFileSync(path.join(process.cwd(), "src", relative), "utf8");
}

/** Comments quoting a rule must not satisfy the check for it — this file's own header included. */
function code(relative: string): string {
  return read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*--.*$/gm, "");
}

test("the stale sweep is still scoped to AP-1 in both of its statements", () => {
  const src = code(SWEEP);
  const pins = src.match(/AP1_FORM_CODE/g) ?? [];
  assert.ok(
    pins.length >= 2,
    `stale-request-sweep.ts names AP1_FORM_CODE ${pins.length} time(s); it must appear in the ` +
      "candidate SELECT's bound parameter AND in the claiming UPDATE's. If the sweep now " +
      "covers another form, read that file's own header first: an AP-17 host cancelled here " +
      "leaves every room-share guest un-cancelled, un-detached and untold, and the cascade " +
      "guards cannot see a trigger path that did not exist when they were written",
  );
  for (const other of ["AP17_FORM_CODE", "AP4_FORM_CODE", "AP2_FORM_CODE", "AP3_FORM_CODE"]) {
    assert.ok(
      src.indexOf(other) === -1,
      `stale-request-sweep.ts now names ${other}. Widening the sweep is allowed — but a ` +
        "cancellation on this path writes Status='Cancelled' with NO room-share cascade, so " +
        "AP-17 in particular needs applyRoomShareDeath(tx, id) inside the claiming " +
        "transaction, before its commit, first. Then rewrite this test to assert the new " +
        "scope and that call",
    );
  }
});

/**
 * The narrower half, and the one that survives a refactor of the imports: the
 * literal form code the two statements bind. A sweep that dropped the
 * constant and typed `'AP-1'` inline would still be correct; one that typed
 * `'AP-17'` would not, and the test above alone would miss it.
 */
test("no other form code reaches the sweep as a literal either", () => {
  const src = code(SWEEP);
  const literals = src.match(/["']AP-\d+["']/g) ?? [];
  for (const literal of literals) {
    assert.ok(
      /["']AP-1["']/.test(literal),
      `stale-request-sweep.ts contains the form-code literal ${literal}. See this file's ` +
        "header and the sweep's own: this path cancels requests with no room-share cascade",
    );
  }
});
