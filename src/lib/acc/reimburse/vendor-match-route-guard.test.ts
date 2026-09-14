import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * `POST .../requests/[id]/match-vendors` writes `AccReimburseItem.VendorNo` and
 * `VendorMatchStatus` on a claim somebody else filed and a manager already
 * approved — and one of the values it can write, `"none"`, **removes the
 * requirement that the line carry a vendor at all** before the claim can be
 * approved.
 *
 * So the route has to keep two properties that no type enforces, both of which
 * a plausible refactor removes silently:
 *
 * - it goes through `setReimburseItemAccounts`, inheriting the roster check,
 *   the `(AP-4, ManagerApproved, ACCOUNT)` predicate claimed with a conditional
 *   UPDATE inside the transaction, the brand scope re-decided from the
 *   database, and the activity row. A direct `UPDATE` here would compile,
 *   pass every behavioural test, and carry none of the four;
 * - it authorizes the request before it reads it.
 *
 * Source-reading for the reason every guard in this directory gives: the
 * failure is a MISSING call, and nothing observable from outside the route
 * distinguishes a write with four guards from the same write with none.
 */

const ROUTE_FILE = path.resolve(
  process.cwd(),
  "src/app/api/request/reimburse/requests/[id]/match-vendors/route.ts",
);
const SERVICE_FILE = path.resolve(process.cwd(), "src/lib/acc/reimburse/vendor-match-service.ts");

const read = (file: string): string => fs.readFileSync(file, "utf8");

test("the route writes through setReimburseItemAccounts and nothing else", () => {
  const src = read(ROUTE_FILE);
  assert.ok(
    src.includes("await setReimburseItemAccounts("),
    "match-vendors no longer writes through setReimburseItemAccounts — the four guards are gone with it",
  );
  assert.ok(
    !/\bUPDATE\s+\[dbo\]/i.test(src),
    "match-vendors is issuing SQL of its own instead of going through the service",
  );
});

test("the route authorizes before it loads the claim", () => {
  const src = read(ROUTE_FILE);
  const authIdx = src.indexOf("await authorizeAccRequest(");
  const loadIdx = src.indexOf("await getReimburseRequest(");
  assert.ok(authIdx !== -1, "match-vendors no longer calls authorizeAccRequest");
  assert.ok(loadIdx !== -1, "match-vendors no longer loads the claim — has the shape changed?");
  assert.ok(authIdx < loadIdx, "match-vendors reads the claim before authorizeAccRequest runs");
});

test("the route re-sends each line's current G/L account", () => {
  // `ItemAccountEdit.category` treats an ABSENT field as a clear, so an edit
  // that names only the vendor wipes the account the accountant or the AI had
  // just chosen. Measured as a real hazard rather than a hypothetical: it is
  // the one asymmetry `item-account-edits.ts` documents at length.
  const src = read(ROUTE_FILE);
  assert.ok(
    src.includes("categoryById"),
    "match-vendors no longer carries each line's existing category into the edit — it will clear the G/L account",
  );
});

test("the claim brand is resolved to the Interface company before the vendor list is read", () => {
  // ErpVendors is keyed on the BC company. Passing the claim brand through
  // answers an empty list for every ROCKS claim, which then reads as "this
  // seller has no card" — a wrong 'none' on every line of every ROCKS claim.
  const src = read(ROUTE_FILE);
  const mapIdx = src.indexOf("getBrandErpInterfaceMap(");
  const callIdx = src.indexOf("matchVendorsForClaim(");
  assert.ok(mapIdx !== -1, "match-vendors no longer resolves the claim brand to a Company");
  assert.ok(callIdx !== -1, "match-vendors no longer calls the matcher");
  assert.ok(mapIdx < callIdx, "match-vendors reads vendors before resolving the Company");
});

test("the matcher asks the model only about cards a filter already produced", () => {
  // The constraint that makes an AI answer safe here: it chooses BETWEEN two or
  // three near-identical cards, never from the company's whole ledger. A call
  // taking the unfiltered list would be one edit away and would look the same.
  const src = read(SERVICE_FILE);
  assert.ok(
    /matchVendorWithAI\([\s\S]{0,200}plan\.candidates/.test(src),
    "the model is being given something other than the plan's candidate list",
  );
});
