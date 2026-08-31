import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Brand scoping is only a control if it holds on the paths that ACT, not merely
 * on the ones that list. Filtering a queue hides rows; a scoped approver holding
 * an id from a link, a bookmark, or a page loaded before the scope was narrowed
 * still reaches the action.
 *
 * Source-reading, because the failure is a MISSING call. No behavioural test of
 * the five routes below would notice a sixth arriving without one — and the
 * routes are where somebody adds the sixth.
 */

const API = path.resolve(process.cwd(), "src/app/api/request/travel-booking");

function code(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) routeFiles(p, out);
    else if (e.name === "route.ts") out.push(p);
  }
  return out;
}

const rel = (p: string) => path.relative(API, p).split(path.sep).join("/");

/**
 * Every route that actions one AP-17 request as the booking desk or accounting.
 * Each reaches a single request by id and changes it, so each must check the
 * brand.
 */
const ACT_ROUTES = [
  "admin/requests/[id]/booking/route.ts",
  "admin/requests/[id]/complete/route.ts",
  "requests/[id]/account-approve/route.ts",
  "requests/[id]/payment-date/route.ts",
  "requests/[id]/exchange-rate/route.ts",
];

test("every booking-area act route checks the request's brand scope", () => {
  for (const r of ACT_ROUTES) {
    const src = code(path.join(API, r));
    assert.ok(
      /requireBookingBrandScope\s*\(/.test(src),
      `${r} actions an AP-17 request without calling requireBookingBrandScope — a scoped ` +
        "approver who has the id can act on a brand they were never shown",
    );
  }
});

/**
 * The pairing is what makes the list above maintainable: any route that gates on
 * `canAccessBookingArea` AND reaches one request by id is an act route, so it
 * needs the scope too. A new file matching both and missing the scope fails here
 * without anybody remembering to extend ACT_ROUTES.
 */
test("no route gates on the booking area, takes an id, and skips the scope", () => {
  const offenders: string[] = [];
  for (const file of routeFiles(API)) {
    const name = rel(file);
    if (name.indexOf("[id]") === -1) continue;
    const src = code(file);
    if (!/canAccessBookingArea\s*\(/.test(src)) continue;
    // Read-only paths are not act paths. `requireBookingBrandScope` on a GET
    // would be defensible, but the queue and detail pages legitimately show a
    // request somebody is about to be told they cannot action.
    if (!/export async function (POST|PATCH|PUT|DELETE)/.test(src)) continue;
    if (!/requireBookingBrandScope\s*\(/.test(src)) offenders.push(name);
  }
  assert.deepEqual(
    offenders,
    [],
    "these gate on the booking area and mutate one request by id, but never check its brand: " +
      offenders.join(", "),
  );
});

/** The two queues and the report must be given a scope, not left to default to one. */
test("the queue and report services take a required access parameter", () => {
  const admin = code(path.resolve(process.cwd(), "src/lib/acc/travel-booking/admin-service.ts"));
  for (const fn of ["listAdminQueue", "listAccountQueue"]) {
    const m = new RegExp(`export async function ${fn}\\s*\\(([^)]*)\\)`).exec(admin);
    assert.ok(m, `${fn} not found — has it been renamed?`);
    assert.ok(
      /access\s*:\s*BookingBrandAccess/.test(m![1]),
      `${fn} must take a REQUIRED access: BookingBrandAccess. An optional parameter that ` +
        "defaults to unrestricted is how a caller added later gets an unscoped queue silently",
    );
    assert.ok(
      !/access\s*\?\s*:/.test(m![1]) && !/access[^,)]*=\s*/.test(m![1]),
      `${fn}'s access parameter must have no default`,
    );
  }

  const report = code(path.resolve(process.cwd(), "src/lib/acc/travel-booking/report-service.ts"));
  const m = /export async function queryTravelBookingReport\s*\(([\s\S]*?)\)\s*:/.exec(report);
  assert.ok(m, "queryTravelBookingReport not found");
  assert.ok(
    /access\s*:\s*BookingBrandAccess/.test(m![1]),
    "queryTravelBookingReport must take a required access parameter — and NOT fold it into " +
      "TravelBookingReportFilters, which is built from the query string",
  );
});

/**
 * The scope must not become a filter. Filters arrive from the query string; a
 * scope is a decision. Merging them puts the scope one `sp.getAll(...)` away
 * from being widened by whoever builds the filters.
 */
test("the brand scope is not part of the report's filter type", () => {
  const src = code(path.resolve(process.cwd(), "src/lib/acc/travel-booking/report-service.ts"));
  const m = /interface TravelBookingReportFilters\s*\{([\s\S]*?)\n\}/.exec(src);
  assert.ok(m, "TravelBookingReportFilters not found");
  assert.ok(
    !/allowedCodes|allAccess|BookingBrandAccess/.test(m![1]),
    "the brand scope has been folded into the report's filters, where a query-string parameter " +
      "can reach it",
  );
});
