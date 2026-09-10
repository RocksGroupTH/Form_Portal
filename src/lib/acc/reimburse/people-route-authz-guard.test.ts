import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * `GET /api/request/reimburse/requests/[id]/people` answers the requester's and
 * the manager's Entra display name, job title and photo for one AP-4 claim, so
 * the detail view can render their faces. Everything it returns is about a
 * person, keyed on a small integer anyone can type.
 *
 * **AP-1's equivalent route calls `requireAuth()` and stops there** — no object
 * ACL at all, so any signed-in session can walk `/api/request/accounting/requests/
 * <n>/people` and collect who filed each claim and who approves it. That is the
 * gap CLAUDE.md's own convention names: "any route reaching an `AccRequest` by
 * id calls `authorizeAccRequest()` before it reads or writes. `requireAuth()`
 * proves *a* session, not a right to *this* record." AP-4's copy was written
 * with the ACL rather than without it, and this test is what keeps the copy
 * from drifting back toward its source.
 *
 * The route cannot be imported and exercised here — `@/lib/acc/request-acl`
 * reaches `@/lib/acc/pool` → `@/env`, which validates the whole environment at
 * import time and throws in this suite — so this reads the route's SOURCE, the
 * way `erp-queue-route-authz-guard.test.ts` already does.
 */

const ROUTE_FILE = path.resolve(
  process.cwd(),
  "src/app/api/request/reimburse/requests/[id]/people/route.ts",
);

function routeSource(): string {
  return fs.readFileSync(ROUTE_FILE, "utf8");
}

test("the people route authorizes the record, not merely the session", () => {
  const src = routeSource();
  assert.match(
    src,
    /authorizeAccRequest\(\s*session\s*,\s*id\s*,\s*"read"\s*,\s*AP4_FORM_CODE\s*\)/,
    'the route no longer calls authorizeAccRequest(session, id, "read", AP4_FORM_CODE). ' +
      "Without it this is AP-1's route: requireAuth() alone, and every signed-in employee can " +
      "read who filed and who approves any claim by guessing a small integer",
  );
});

test("the form code is pinned, so an AP-1 or AP-17 id answers nothing here", () => {
  // AccRequest holds every form's header. Without the pin, this AP-4 route
  // enriches other forms' claims — and their own ACL rules never run.
  const src = routeSource();
  assert.match(src, /AP4_FORM_CODE/, "AP4_FORM_CODE is not named in the route");
});

test("authorization comes before the Graph lookups it guards", () => {
  // Import lines name both symbols and always sit at the top, so measuring
  // order over the raw file compares an import against a call and always
  // "fails". Bodies only.
  const src = routeSource().replace(/^import .*$/gm, "");
  const acl = src.indexOf("authorizeAccRequest(");
  // indexOf, not a regex: the call sites are literal strings, and an
  // escaped paren in a pattern is one more thing to get wrong.
  let graph = -1;
  for (const call of ["getADUserByEmail(", "getADUserPhoto("]) {
    const at = src.indexOf(call);
    if (at !== -1 && (graph === -1 || at < graph)) graph = at;
  }
  assert.notEqual(acl, -1, "authorizeAccRequest is not called at all");
  assert.notEqual(graph, -1, "the route no longer reads from Graph — retarget this test");
  assert.ok(
    acl < graph,
    "the Graph lookups run before the ACL. An unauthorized caller must not reach an " +
      "external directory on a record they may not see, whatever the response ends up saying",
  );
});

test("the ACL's refusal is returned, not merely computed", () => {
  const src = routeSource();
  assert.match(
    src,
    /if\s*\(\s*\w+\s+instanceof\s+Response\s*\)\s*return\s+\w+\s*;/,
    "the route computes the ACL verdict but never returns its refusal — a Response that is " +
      "not returned is a check that does nothing",
  );
});
