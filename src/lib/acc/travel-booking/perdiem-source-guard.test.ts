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
 * Every non-test file allowed to name `getPerDiemEmployeeLog` /
 * `getPerDiemEmployeeLogMap`, and why.
 *
 * This is an ALLOW-LIST, not a count. An earlier draft of the country design
 * asserted a single importer of `getAllowanceLog`; that would have been red the
 * day it was written. What made a single-importer assertion finally correct for
 * `getAllowanceLog` is the wrapper below — the four consumers now name the
 * wrapper, not the raw reader.
 */
const ALLOWED_PERDIEM_LOG_IMPORTERS = [
  // Batches one log per subject across a whole report.
  "lib/acc/travel-booking/report-service.ts",
  // Loads one log for a whole submit group, then resolves per tab.
  "lib/acc/travel-booking/request-service.ts",
  // Loads one log per surviving trip inside the cancelling transaction.
  "lib/acc/travel-booking/perdiem-recompute.ts",
  // Serves the requester their own allowance history; prices nothing, but it is
  // what feeds the browser's estimate, so it must resolve the same log.
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

/**
 * `getAllowanceLog` reads HR and nothing else. Once anything but its own file
 * names it, a per-diem figure is being computed from the employee's REAL HR
 * allowance with no chance for a UAT tester's own rate to replace it — which is
 * silent, and lands on `AccRequest.TotalAmount`.
 */
test("only allowance-log.ts names getAllowanceLog", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join("/");
    if (rel === "lib/acc/travel-booking/allowance-log.ts") continue;
    if (/\bgetAllowanceLog\b/.test(code(rel))) offenders.push(rel);
  }
  assert.deepEqual(
    offenders,
    [],
    "these read the HR allowance log directly, bypassing getPerDiemEmployeeLog — a UAT tester " +
      "would be priced at their real compensation: " + offenders.join(", "),
  );
});

/**
 * The naming arm is `\bgetPerDiemEmployeeLog\w*` rather than the narrower
 * `getPerDiemEmployeeLog(Map)?\b` a first draft used — that pattern's trailing
 * `\b` never matches inside `getPerDiemEmployeeLogWithSource`, because the
 * character right after `Log` there is `W`, a word character, so the boundary
 * assertion fails and the whole alternative fails with it. `\w*` instead
 * consumes whatever suffix follows and still lands on a boundary, so it matches
 * `getPerDiemEmployeeLog`, `...Map` and `...WithSource` alike.
 */
test("only the named files import the per-diem log wrapper", () => {
  const importers: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join("/");
    if (rel === "lib/acc/travel-booking/allowance-log.ts") continue;
    if (/\bgetPerDiemEmployeeLog\w*/.test(code(rel))) importers.push(rel);
  }
  assert.ok(importers.length > 0, "nothing imports getPerDiemEmployeeLog — has it been renamed?");
  assert.deepEqual(
    importers.slice().sort(),
    ALLOWED_PERDIEM_LOG_IMPORTERS.slice().sort(),
    "a new file computes a per-diem figure from the employee log. It must go through " +
      "getPerDiemEmployeeLog and perDiemLogFor, or the country rate and the UAT override " +
      "silently do not apply to whatever it computes.",
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
 * The three server pricers and the route that feeds the browser's estimate must
 * all CALL the wrapper — matched as a call, because a comment naming it would
 * satisfy a bare identifier and `code()` only strips whole-line `//` comments.
 *
 * Deliberately not `PRICERS`: that list's fourth member is
 * features/travel-booking/hooks/useTravelBookingForm.ts, a "use client" file
 * that gets its log from the route and must never open a server pool itself —
 * Fast_Core or the UAT form database alike; see the client-bundle test below.
 *
 * The call arm carries the same `\w*` fix as the naming arm above, for the same
 * reason: `getPerDiemEmployeeLogWithSource(` needs the suffix consumed before
 * the `(` is checked for.
 */
test("every server-side pricer calls the per-diem log wrapper", () => {
  for (const file of ALLOWED_PERDIEM_LOG_IMPORTERS) {
    const src = code(file);
    assert.ok(
      /\bgetPerDiemEmployeeLog\w*\s*\(/.test(src),
      `${file} names the wrapper but never calls it — a UAT tester would be priced at their ` +
        "real HR compensation",
    );
  }
});

/**
 * The client half of the same rule. Importing a getCorePool() reader into the
 * form hook pulls @/lib/db/mssql -> @/env into the browser bundle and breaks the
 * build — which no type error predicts, and whose "obvious fix" is to make the
 * override reach the browser some other way. getUatFormPool() carries the
 * identical hazard, not a lesser one: since migrations 139/140 moved UatTester
 * (and UatTesterPerDiem) out of Fast_Core, it is the literal pool `per-diem.ts`
 * and `uat-tester/service.ts` now read through, but it is still exported from
 * the same @/lib/db/mssql that pulls @/env in — naming it here would break the
 * build exactly as naming getCorePool() would.
 */
test("the form hook reaches no server-side per-diem reader", () => {
  const src = code("features/travel-booking/hooks/useTravelBookingForm.ts");
  assert.ok(
    !/getPerDiemEmployeeLog|getCorePool|getUatFormPool|uatPerDiemLog/.test(src),
    "useTravelBookingForm.ts is a client component: it must take the resolved log from " +
      "/api/request/travel-booking/allowance-log, never open a database pool itself",
  );
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

/**
 * The other column in the recompute's SELECT that costs money if it is tidied
 * away. Without `r.StaffId` the UAT override lookup is handed `undefined`, finds
 * nothing, and every UAT trip in the group is re-priced at the tester's real HR
 * allowance — inside the transaction that cancels a sibling, writing both
 * PerDiemTotal and AccRequest.TotalAmount. It fails no typecheck.
 */
test("the recompute reads the request's StaffId", () => {
  const src = code("lib/acc/travel-booking/perdiem-recompute.ts");
  assert.ok(
    /r\.StaffId/.test(src),
    "perdiem-recompute.ts's group SELECT no longer names r.StaffId — a cancellation will " +
      "re-price every surviving UAT trip in the group at the tester's real HR allowance",
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
