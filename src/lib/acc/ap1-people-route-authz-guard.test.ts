import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * `GET /api/request/accounting/requests/[id]/people` answers the requester's
 * and the manager's Entra display name, job title and photo for one AP-1 claim.
 *
 * Until 2026-09-10 it called `requireAuth()` and stopped there — no object ACL
 * at all — so any signed-in session could walk small integers and collect who
 * filed each travel claim and who approves it. That is exactly the gap
 * CLAUDE.md's own convention names: "any route reaching an `AccRequest` by id
 * calls `authorizeAccRequest()` before it reads or writes. `requireAuth()`
 * proves *a* session, not a right to *this* record."
 *
 * AP-4's copy of this route was written with the check from the start and
 * carries its own guard; this is that guard pointed at the original, which the
 * AP-4 branch deliberately left alone as out of scope.
 *
 * The route cannot be imported and exercised here — `@/lib/acc/request-acl`
 * reaches `@/lib/acc/pool` → `@/env`, which validates the whole environment at
 * import time and throws in this suite — so this reads the route's SOURCE.
 */

const ROUTE_FILE = path.resolve(
  process.cwd(),
  "src/app/api/request/accounting/requests/[id]/people/route.ts",
);

function routeSource(): string {
  return fs.readFileSync(ROUTE_FILE, "utf8");
}

test("the AP-1 people route authorizes the record, not merely the session", () => {
  assert.match(
    routeSource(),
    /authorizeAccRequest\(\s*session\s*,\s*id\s*,\s*"read"\s*,\s*AP1_FORM_CODE\s*\)/,
    'the route no longer calls authorizeAccRequest(session, id, "read", AP1_FORM_CODE). ' +
      "Without it every signed-in employee can read who filed and who approves any claim by " +
      "guessing a small integer",
  );
});

test("the form code is pinned, so an AP-4 or AP-17 id answers nothing here", () => {
  // AccRequest holds every form's header. Unpinned, this AP-1 route enriches
  // other forms' claims and their own rules never run.
  assert.match(routeSource(), /AP1_FORM_CODE/, "AP1_FORM_CODE is not named in the route");
});

test("authorization comes before the Graph lookups it guards", () => {
  // Import lines name both symbols and sit at the top, so measuring order over
  // the raw file compares an import against a call. Bodies only.
  const src = routeSource().replace(/^import .*$/gm, "");
  const acl = src.indexOf("authorizeAccRequest(");
  let graph = -1;
  for (const call of ["getADUserByEmail(", "getADUserPhoto("]) {
    const at = src.indexOf(call);
    if (at !== -1 && (graph === -1 || at < graph)) graph = at;
  }
  assert.notEqual(acl, -1, "authorizeAccRequest is not called at all");
  assert.notEqual(graph, -1, "the route no longer reads from Graph — retarget this test");
  assert.ok(
    acl < graph,
    "the Graph lookups run before the ACL. An unauthorized caller must not reach an external " +
      "directory on a record they may not see, whatever the response ends up saying",
  );
});

test("the ACL's refusal is returned, not merely computed", () => {
  assert.match(
    routeSource(),
    /if\s*\(\s*\w+\s+instanceof\s+Response\s*\)\s*return\s+\w+\s*;/,
    "the route computes the ACL verdict but never returns its refusal — a Response that is not " +
      "returned is a check that does nothing",
  );
});
