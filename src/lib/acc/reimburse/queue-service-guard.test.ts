import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * `queue-service.ts` pins two things that make AP-4's accounting queue AP-4's,
 * rather than a queue that also lists AP-1's travel claims: the
 * `FormCode = @form` predicate (bound to `AP4_FORM_CODE`), and the
 * `belongsInAccountQueue` re-assertion applied to every row before it is
 * returned. Deleting either one changes nothing the typecheck or any of the
 * other 1280 tests would catch — AP-1 parks at the identical
 * `(ManagerApproved, ACCOUNT)` tuple (`STATUS_AT_STEP`, AP-1's
 * `approval-engine.ts`), so the query keeps compiling, keeps returning rows,
 * and every returned row keeps matching `ReimburseQueueRow`'s shape. It just
 * starts returning the WRONG rows, offered to a client that will loop
 * `POST .../requests/[id]/approve` over them — which, for an AP-1 id, calls
 * `approveReimburseAccountCheck` and writes AP-4-shaped columns onto an AP-1
 * request. CLAUDE.md names this exact pin on AP-4's own claim functions:
 * "Removing a pin re-opens a Critical; two reviews have now spent effort
 * rediscovering this."
 *
 * Source-reading rather than behavioural, for the reason
 * `perdiem-source-guard.test.ts` gives for the same shape of test: the
 * failure here is a MISSING call, and no test of
 * `listReimburseAccountQueue`'s return shape would notice a later edit
 * dropping it — a query missing `FormCode = @form` still returns rows that
 * satisfy every assertion a behavioural test would think to write, because
 * AP-1's rows at this tuple are shaped enough like AP-4's own that nothing
 * downstream refuses them either.
 *
 * Every assertion below was proven against a local removal before being kept:
 * deleting the `AND r.FormCode = @form` clause reds the first test only,
 * changing the bound value to a literal or another form's constant reds the
 * second only, and deleting the `belongsInAccountQueue(...)` line reds the
 * third only — see the fix report for this round for what was observed at
 * each step.
 */

const FILE = "lib/acc/reimburse/queue-service.ts";

/** Comments quoting the rule must not satisfy it — matches `perdiem-source-guard.test.ts`'s own `code()`. */
function code(): string {
  return fs
    .readFileSync(path.resolve(process.cwd(), "src", FILE), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

test("the query's WHERE clause names FormCode = @form", () => {
  const src = code();
  assert.ok(
    /FormCode\s*=\s*@form\b/.test(src),
    "queue-service.ts's WHERE clause no longer names FormCode = @form — AP-1's claims, parked at " +
      "the identical (ManagerApproved, ACCOUNT) tuple, will appear in AP-4's accounting queue",
  );
});

test("@form is bound to AP4_FORM_CODE — not a literal string, not another form's constant", () => {
  const src = code();
  assert.ok(
    /\.input\(\s*["']form["']\s*,\s*sql\.NVarChar\s*,\s*AP4_FORM_CODE\s*\)/.test(src),
    "the @form parameter is no longer bound to AP4_FORM_CODE — the WHERE clause's " +
      "FormCode = @form predicate is only as trustworthy as what @form actually holds",
  );
});

test("every row is re-checked against belongsInAccountQueue before it is returned", () => {
  const src = code();
  assert.ok(
    /belongsInAccountQueue\(/.test(src),
    "queue-service.ts no longer calls belongsInAccountQueue — the SQL predicate and the pure " +
      "rule in queue-policy.ts are meant to be two independent enforcements of one tuple, and " +
      "this is the call that makes the second one real rather than aspirational",
  );
});
