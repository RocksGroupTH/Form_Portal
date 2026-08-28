import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * The picker and the rule must answer for the same person.
 *
 * `listBlockedTravelDates` greys days out; `isDuplicateTravelDate` is what
 * actually refuses a submit. They drifted: the picker also matched `CreatedBy`
 * and `SubmittedBy`, so filing on behalf of a colleague blocked that day in the
 * filer's own calendar — a day the submit rule would have accepted. And the
 * route resolved the session's own email unconditionally, so an on-behalf form
 * was shown the wrong person's calendar entirely.
 *
 * Neither half is unit-testable — both need a pool, and `@/env` validates the
 * whole environment at import. So this reads the sources, which is enough to
 * catch the drift coming back.
 */

const ROOT = process.cwd();
const SERVICE = path.join(ROOT, "src/lib/acc/request-service.ts");
const ROUTE = path.join(
  ROOT,
  "src/app/api/request/accounting/requests/blocked-travel-dates/route.ts",
);
const FORM = path.join(ROOT, "src/features/accounting/components/TravelExpenseForm.tsx");

/** The body of one exported function, comments stripped. */
function bodyOf(file: string, name: string): string {
  const src = fs.readFileSync(file, "utf8");
  const start = src.indexOf(`export async function ${name}`);
  assert.notEqual(start, -1, `${name} not found in ${path.basename(file)}`);
  const end = src.indexOf("\n}", start);
  return src
    .slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

test("the picker's query keys on StaffId, like the rule that refuses a submit", () => {
  const picker = bodyOf(SERVICE, "listBlockedTravelDates");
  assert.ok(/r\.StaffId\s*=\s*@staff/.test(picker), "must filter on StaffId");
  assert.ok(
    !/r\.CreatedBy|r\.SubmittedBy/.test(picker),
    "must NOT match CreatedBy/SubmittedBy — that blocks the filer's own calendar " +
      "for a day they did not travel on, which the submit rule would allow",
  );
});

test("the rule it must agree with is still keyed the same way", () => {
  const rule = bodyOf(SERVICE, "isDuplicateTravelDate");
  assert.ok(/r\.StaffId\s*=\s*@staff/.test(rule));
  assert.ok(!/r\.CreatedBy|r\.SubmittedBy/.test(rule));
});

test("the route answers for the requester being filed for, not the session user", () => {
  const src = fs.readFileSync(ROUTE, "utf8");
  assert.ok(
    src.includes('searchParams.get("requesterStaffId")'),
    "must read requesterStaffId — AP-17's equivalent always has",
  );
  assert.ok(
    src.includes("resolveRequesterForActor"),
    "must resolve through the same helper the submit route uses, so the calendar " +
      "and the rule answer for the same person and the pairing is authorized",
  );
});

test("the form sends requesterStaffId, and refetches when it changes", () => {
  const src = fs.readFileSync(FORM, "utf8");
  assert.ok(src.includes('params.set("requesterStaffId"'), "must send it");
  assert.ok(
    /\}, \[requestId, brandCode, requesterStaffId\]\)/.test(src),
    "requesterStaffId must be in the effect's deps, or เปลี่ยนผู้ขอเบิก leaves a stale calendar",
  );
});
