import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * `GET /api/request/reimburse/approvals` answers the WHOLE AP-4 accounting
 * queue — every claim parked at `(ManagerApproved, ACCOUNT)`, with requester
 * names, amounts and document numbers on every row. Between that payload and
 * every authenticated employee in the company there is exactly one thing: the
 * `decideReimburseMenuAccess(…, "approvalQueue")` check in the handler.
 *
 * Nothing else stands behind it. `listReimburseAccountQueue` takes no viewer
 * and filters on nothing but the form code and the state tuple — by design,
 * per this stage's ruling that the queue shows every claim and authority is
 * re-decided per action (see the route's own docblock). That ruling is what
 * makes THIS gate load-bearing: it is the only place sight is decided.
 *
 * **Measured, not assumed:** the whole check was deleted from the route
 * locally and `npm test` reported 1300 pass, 0 fail. Not one existing test
 * touched it — `settings-route-gates.test.ts` scans only
 * `.../reimburse/settings/**`, and the route cannot be imported and exercised
 * here at all (`@/lib/acc/pool` → `@/env` validates the whole environment at
 * import time and throws in this suite). So this file reads the route's
 * SOURCE, the technique `item-account-authz-guard.test.ts` and
 * `booking-brand-scope-guard.test.ts` already use for exactly this class of
 * failure: a MISSING call, which no behavioural test notices going away.
 */

const ROUTE_FILE = path.resolve(
  process.cwd(),
  "src/app/api/request/reimburse/approvals/route.ts",
);

function routeSource(): string {
  return fs.readFileSync(ROUTE_FILE, "utf8");
}

test("the approvals route gates sight on the approvalQueue menu grant", () => {
  const src = routeSource();
  assert.match(
    src,
    /decideReimburseMenuAccess\(\s*admin\s*,\s*granted\s*,\s*"approvalQueue"\s*\)/,
    "GET /api/request/reimburse/approvals no longer calls " +
      'decideReimburseMenuAccess(admin, granted, "approvalQueue") — that check is the ONLY thing ' +
      "between every authenticated employee and the full AP-4 accounting queue, because the queue " +
      "loader itself filters on form code and state and knows nothing about the viewer",
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
  const loadIdx = src.indexOf("listReimburseAccountQueue(");
  assert.ok(gateIdx !== -1, "the gate is gone — see the first test in this file");
  assert.ok(
    loadIdx !== -1,
    "listReimburseAccountQueue is no longer called — has the route's shape changed? This " +
      "assertion must be repointed at whatever now loads the rows, not dropped",
  );
  assert.ok(
    gateIdx < loadIdx,
    "the queue is loaded before the approvalQueue gate decides. Even with the 403 still returned, " +
      "that reads the whole queue for a caller who may not see it — and any later edit that " +
      "returns rows alongside an error, or logs them, leaks it outright",
  );
  assert.match(
    src,
    /if\s*\(\s*!\s*decideReimburseMenuAccess\([^)]*\)\s*\)\s*\{\s*\n?\s*return\s+NextResponse\.json\(\s*\{\s*ok:\s*false/,
    "the gate's answer must be guarded with `if (!…) return NextResponse.json({ ok: false … })`. " +
      "A bare call computes a verdict and throws it away, which passes a grep for the function " +
      "name while granting everyone the queue",
  );
});
