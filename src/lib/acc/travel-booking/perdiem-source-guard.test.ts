import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Four things compute an AP-17 per-diem figure, independently: the live estimate
 * on the form, the write at submit, the recompute after a cancellation, and the
 * rate the report prints. Before per-diem-by-country they could not disagree,
 * because there was only one input — the employee's HR allowance log.
 *
 * Adding a second input is exactly the kind of change that lets them drift, and
 * the drift is invisible: each is correct in isolation, and the only symptom is
 * that a trip's stored total does not match the rate printed beside it. So they
 * all resolve through `perDiemLogFor`, and this file is what keeps that true.
 *
 * Source-reading rather than behavioural, because the failure is a *missing*
 * call — no unit test of the four functions would notice a fifth consumer
 * arriving without one.
 */

const SRC = path.resolve(process.cwd(), "src");

/** Comments quoting the rule must not satisfy it. */
function code(file: string): string {
  return fs
    .readFileSync(path.resolve(SRC, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Every non-test file allowed to import `getAllowanceLog`, and why.
 *
 * This is an ALLOW-LIST, not a count of one. An earlier draft of the design
 * asserted a single importer; that would have been red the day it was written
 * and would have contradicted the design's own instructions, which keep the two
 * batching services and the history route exactly as they are.
 */
const ALLOWED_ALLOWANCE_IMPORTERS = [
  // The resolver itself — the one place that decides country-vs-employee.
  "lib/acc/travel-booking/perdiem-source.ts",
  // Batches one log per employee across a whole report; routing that through a
  // per-request resolver would be N+1.
  "lib/acc/travel-booking/report-service.ts",
  // Loads one log for a whole submit group, then resolves per tab.
  "lib/acc/travel-booking/request-service.ts",
  // Loads one log per surviving trip inside the cancelling transaction.
  "lib/acc/travel-booking/perdiem-recompute.ts",
  // Serves the requester their own allowance history verbatim; prices nothing.
  "app/api/request/travel-booking/allowance-log/route.ts",
];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

test("only the named files import getAllowanceLog", () => {
  const importers: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join("/");
    // Its own definition is not an import of itself.
    if (rel === "lib/acc/travel-booking/allowance-log.ts") continue;
    if (/\bgetAllowanceLog\b/.test(code(rel))) importers.push(rel);
  }

  assert.ok(importers.length > 0, "nothing imports getAllowanceLog — has it been renamed?");
  assert.deepEqual(
    importers.slice().sort(),
    ALLOWED_ALLOWANCE_IMPORTERS.slice().sort(),
    "a new file computes a per-diem figure from the employee log directly. It must go through " +
      "perDiemLogFor, or the country rate silently does not apply to whatever it computes.",
  );
});

/**
 * Each of the three that prices something must also name the resolver. Importing
 * the employee log and not the resolver is precisely the pre-country behaviour,
 * and it is what a careless merge restores.
 */
test("every file that prices a trip also resolves the rate", () => {
  const PRICERS = [
    "lib/acc/travel-booking/request-service.ts",
    "lib/acc/travel-booking/perdiem-recompute.ts",
    "lib/acc/travel-booking/report-service.ts",
    "features/travel-booking/hooks/useTravelBookingForm.ts",
  ];
  for (const file of PRICERS) {
    const src = code(file);
    assert.ok(
      /\bperDiemLogFor\b/.test(src),
      `${file} computes a per-diem figure without calling perDiemLogFor — it would price every ` +
        "trip at the employee's rate, ignoring the country entirely",
    );
  }
});

/**
 * The recompute's SELECT is the one that costs money. `r.CountryCode` can be
 * deleted from it while tidying and nothing fails to compile: the value simply
 * arrives `undefined`, `perDiemLogFor` answers "employee", and a foreign trip is
 * silently re-priced at the domestic rate — inside the transaction that cancels
 * a sibling, writing both PerDiemTotal and AccRequest.TotalAmount.
 */
test("the recompute reads the request's country", () => {
  const src = code("lib/acc/travel-booking/perdiem-recompute.ts");
  assert.ok(
    /r\.CountryCode/.test(src),
    "perdiem-recompute.ts's group SELECT no longer names r.CountryCode — a cancellation will " +
      "re-price every surviving foreign trip in the group at the employee's Thai allowance",
  );
});

test("the report's CTE reads the request's country", () => {
  const src = code("lib/acc/travel-booking/report-service.ts");
  assert.ok(
    /r\.CountryCode/.test(src),
    "the AP-17 report's BASE_CTE no longer names r.CountryCode — it will print the employee's " +
      "rate against a country-rate total, and a reader dividing one by the other gets a day " +
      "count that contradicts the column beside it",
  );
});

/**
 * `AccTravelPerDiemCountry` is dual-written configuration, so every write must
 * go through `writeBothPools` and every read through the environment-varying
 * pool. A `getProductionFormPool()` read here would serve production's rates to
 * a UAT tester — the opposite mistake from TravelProvince's, and just as quiet.
 */
test("the rate table is read and written through the shared-config pools", () => {
  const src = code("lib/acc/travel-booking/perdiem-source.ts");
  assert.ok(/getAccPool/.test(src), "reads must use getAccPool — this table exists in both databases");
  assert.ok(/writeBothPools/.test(src), "writes must go through writeBothPools");
  assert.ok(
    !/getProductionFormPool/.test(src),
    "perdiem-source.ts must not open the production pool: the rates are per environment, and a " +
      "UAT tester rehearsing a trip has to see the rates their own environment holds",
  );
});

/** Nothing else may name the table — one access point, like TeamMember's. */
test("only perdiem-source.ts holds SQL naming AccTravelPerDiemCountry", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join("/");
    if (rel === "lib/acc/travel-booking/perdiem-source.ts") continue;
    if (/\bAccTravelPerDiemCountry\b/.test(code(rel))) offenders.push(rel);
  }
  assert.deepEqual(
    offenders,
    [],
    "these name the rate table outside its service, so a read could miss IsActive or a write " +
      "could miss writeBothPools: " + offenders.join(", "),
  );
});
