import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * The per-item G/L account save (`PATCH /api/request/reimburse/requests/[id]/items`)
 * is the one write path in AP-4's accounting queue that is not a state
 * transition, so it carries none of the shared transitions' scaffolding —
 * `claimStep`, a step token in the body — to lean on for authorization.
 * Its whole story is two calls, in two different files, agreeing to run:
 * `authorizeAccRequest` in the route (existence, the AP-4 pin, the UAT-tester
 * barrier) and `requireApproverStaffId` in the service (the SAME roster check
 * `approveReimburseAccountCheck` makes for this exact step). Neither is
 * enforced by a type, so a refactor that drops either compiles clean and
 * looks identical to a reviewer reading the diff for the actual money logic.
 *
 * Source-reading, same reasoning as `travel-booking/booking-brand-scope-guard.test.ts`:
 * the failure this guards against is a MISSING call, and no behavioural test
 * of the route would notice its own authorization quietly disappearing —
 * `settings-route-gates.test.ts`'s sibling guard does not reach this file at
 * all, since it only scans `.../reimburse/settings/**`.
 */

const ROUTE_FILE = path.resolve(
  process.cwd(),
  "src/app/api/request/reimburse/requests/[id]/items/route.ts",
);
const SERVICE_FILE = path.resolve(process.cwd(), "src/lib/acc/reimburse/approval-service.ts");

function read(file: string): string {
  return fs.readFileSync(file, "utf8");
}

test("PATCH .../items authorizes the request before it reads the body", () => {
  const src = read(ROUTE_FILE);
  const authIdx = src.indexOf("await authorizeAccRequest(");
  const bodyIdx = src.indexOf("req.json()");
  assert.ok(authIdx !== -1, "PATCH .../items no longer calls authorizeAccRequest");
  assert.ok(
    bodyIdx !== -1,
    "PATCH .../items no longer reads the request body — has the shape changed?",
  );
  assert.ok(authIdx < bodyIdx, "PATCH .../items reads the body before authorizeAccRequest runs");
});

/**
 * `setReimburseItemAccounts`'s own body, isolated from the rest of the file —
 * so a `requireApproverStaffId` call anywhere ELSE in `approval-service.ts`
 * (there already is one, in `approveReimburseAccountCheck`) cannot make this
 * pass for the wrong reason.
 */
function functionBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}`);
  assert.ok(start !== -1, `${name} not found in approval-service.ts — has it been renamed?`);
  const nextExport = src.indexOf("\nexport async function", start + 1);
  return nextExport === -1 ? src.slice(start) : src.slice(start, nextExport);
}

test("setReimburseItemAccounts requires the AccReimburseApprover roster check", () => {
  const body = functionBody(read(SERVICE_FILE), "setReimburseItemAccounts");
  assert.ok(
    /await requireApproverStaffId\(/.test(body),
    "setReimburseItemAccounts no longer calls requireApproverStaffId — the SAME check " +
      "approveReimburseAccountCheck makes for the ACCOUNT step",
  );
});

/**
 * The roster check must run before the write, not merely appear somewhere in
 * the function — a call after the transaction has already claimed the row
 * and written would authorize nothing.
 */
test("the roster check runs before the transaction that writes", () => {
  const body = functionBody(read(SERVICE_FILE), "setReimburseItemAccounts");
  const authIdx = body.indexOf("await requireApproverStaffId(");
  const txIdx = body.indexOf("inTransaction(");
  assert.ok(authIdx !== -1 && txIdx !== -1, "one of the two calls is missing — see the test above");
  assert.ok(authIdx < txIdx, "requireApproverStaffId runs after inTransaction, not before it");
});
