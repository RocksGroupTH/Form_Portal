import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * `GET /api/request/reimburse/erp-queue` answers every APPROVED AP-4 claim —
 * request number, requester name, amount, payment date, and its current
 * (always-unset-today) Business Central posting status. Between that payload
 * and every authenticated employee in the company there is exactly one thing:
 * the `decideReimburseMenuAccess(…, "approvalQueue")` check in the handler.
 *
 * This is `approvals-route-authz-guard.test.ts`, repointed at this route and
 * `listReimburseErpQueue`. Its own docblock records why it exists at all:
 * that file's check was deleted locally and `npm test` reported 1300 pass, 0
 * fail — nothing else in the suite noticed a full accounting queue becoming
 * readable by anyone signed in. This route is in the identical position for
 * the ENDPOINT itself: `decideReimburseMenuAccess` is the only thing between
 * every authenticated employee and this endpoint answering at all.
 *
 * **Updated 2026-09-10 (Task 5's fix round, mirroring the identical
 * correction on `approvals-route-authz-guard.test.ts`): `listReimburseErpQueue`
 * no longer "takes no viewer and filters on nothing but form code and
 * status" — it now filters further by brand scope
 * (`AccReimburseApproverBrand`, migration 144), the same as
 * `listReimburseAccountQueue`.** That is a SECOND, later filter on WHICH rows
 * a granted viewer's own request returns; it is not a substitute for this
 * gate, which still decides whether the endpoint answers anything at all.
 * `erp-queue/route.ts`'s own docblock carries the corrected account. This
 * queue is still read-only with no per-row re-decision behind it — unlike
 * `approvals/route.ts`, there is no action step to fall back on if the menu
 * gate were ever silently lost.
 *
 * Same technique as the file this copies, for the same reason: the route
 * cannot be imported and exercised here (`@/lib/acc/pool` → `@/env`
 * validates the whole environment at import time and throws in this suite),
 * so this reads the route's SOURCE instead.
 */

const ROUTE_FILE = path.resolve(
  process.cwd(),
  "src/app/api/request/reimburse/erp-queue/route.ts",
);

function routeSource(): string {
  return fs.readFileSync(ROUTE_FILE, "utf8");
}

test("the erp-queue route gates sight on the approvalQueue menu grant", () => {
  const src = routeSource();
  assert.match(
    src,
    /decideReimburseMenuAccess\(\s*admin\s*,\s*granted\s*,\s*"approvalQueue"\s*\)/,
    "GET /api/request/reimburse/erp-queue no longer calls " +
      'decideReimburseMenuAccess(admin, granted, "approvalQueue") — that check is the ONLY thing ' +
      "between every authenticated employee and this endpoint answering at all. " +
      "listReimburseErpQueue filters further by brand scope since migration 144, but that is a " +
      "second, later filter on WHICH rows a granted viewer's own request returns — not a substitute " +
      "for this gate",
  );
  assert.match(
    src,
    /import\s*\{[^}]*\bdecideReimburseMenuAccess\b[^}]*\}\s*from\s*"@\/lib\/acc\/reimburse\/settings-tabs"/,
    "decideReimburseMenuAccess must come from settings-tabs, not be redefined locally — a local " +
      "copy is a second answer to the question, and only one of the two would keep the " +
      "grantable/menu vocabularies apart",
  );
});

test("the grant list is resolved from the roster, never assumed", () => {
  const src = routeSource();
  assert.match(
    src,
    /await\s+resolveReimburseTabsByEmail\(/,
    "the route no longer reads the viewer's grants from AccReimburseAccess/AccReimburseAccessTab. " +
      "A hardcoded `granted` list would make decideReimburseMenuAccess pass or fail for everyone " +
      "alike, which is the same hole as deleting the check",
  );
  // The admin arm may legitimately skip the read (an admin passes on the
  // `isAdmin` arm alone, and skipping keeps the page open while a migration
  // lands on one database) — but a NON-admin must still be resolved, so the
  // conditional has to name the admin flag rather than short-circuit for all.
  assert.doesNotMatch(
    src,
    /const\s+granted\s*(?::\s*string\[\])?\s*=\s*\[\s*\]\s*;/,
    "`granted` must never be an unconditional empty list — decideReimburseMenuAccess would then " +
      "answer for the admin arm alone and no menu grant could ever be honoured",
  );
});

test("the gate runs before the queue is loaded, and its refusal is returned", () => {
  const src = routeSource();
  const gateIdx = src.indexOf("decideReimburseMenuAccess(");
  const loadIdx = src.indexOf("listReimburseErpQueue(");
  assert.ok(gateIdx !== -1, "the gate is gone — see the first test in this file");
  assert.ok(
    loadIdx !== -1,
    "listReimburseErpQueue is no longer called — has the route's shape changed? This assertion " +
      "must be repointed at whatever now loads the rows, not dropped",
  );
  assert.ok(
    gateIdx < loadIdx,
    "the queue is loaded before the approvalQueue gate decides. Even with the 403 still returned, " +
      "that reads every APPROVED AP-4 claim for a caller who may not see it — and any later edit " +
      "that returns rows alongside an error, or logs them, leaks it outright",
  );
  assert.match(
    src,
    /if\s*\(\s*!\s*decideReimburseMenuAccess\([^)]*\)\s*\)\s*\{\s*\n?\s*return\s+NextResponse\.json\(\s*\{\s*ok:\s*false/,
    "the gate's answer must be guarded with `if (!…) return NextResponse.json({ ok: false … })`. " +
      "A bare call computes a verdict and throws it away, which passes a grep for the function " +
      "name while granting everyone the queue",
  );
});
