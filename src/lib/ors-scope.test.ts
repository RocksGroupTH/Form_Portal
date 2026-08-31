import { test } from "node:test";
import assert from "node:assert/strict";
import { ORS_DEFAULT_COUNTRY, ORS_WORLDWIDE, resolveOrsCountry } from "./ors-scope";

/**
 * AP-17 went worldwide; AP-1 did not. `resolveOrsCountry` is the one place that
 * decides which, and it is deliberately import-free so it can be tested with no
 * environment — `@/env` validates the whole environment at import, so anything
 * reachable from a pool drags a live configuration into the test run.
 *
 * **The fallback arm is the point.** The country arrives from a query string,
 * so it is attacker-controlled text, and `boundary.country` is interpolated
 * into an upstream URL. Anything this function does not positively recognise
 * becomes "TH" — narrowing a search, never widening one, and never forwarding
 * an arbitrary string to OpenRouteService.
 */

test("the sentinel means no boundary at all", () => {
  assert.equal(resolveOrsCountry(ORS_WORLDWIDE), null);
  assert.equal(resolveOrsCountry("*"), null);
});

test("a two-letter code is honoured, uppercased and trimmed", () => {
  assert.equal(resolveOrsCountry("TH"), "TH");
  assert.equal(resolveOrsCountry("gb"), "GB");
  assert.equal(resolveOrsCountry("  jp  "), "JP");
});

test("absent means Thailand, which is what keeps AP-1 unchanged", () => {
  assert.equal(resolveOrsCountry(null), ORS_DEFAULT_COUNTRY);
  assert.equal(resolveOrsCountry(undefined), ORS_DEFAULT_COUNTRY);
  assert.equal(resolveOrsCountry(""), ORS_DEFAULT_COUNTRY);
  assert.equal(resolveOrsCountry("   "), ORS_DEFAULT_COUNTRY);
});

/**
 * Every one of these would otherwise reach the upstream URL. Narrowing to TH is
 * the safe direction to be wrong in: the searcher sees Thai results for a
 * malformed country instead of the request carrying arbitrary text to ORS.
 */
test("anything else narrows to Thailand rather than being forwarded", () => {
  for (const bad of [
    "THA", "T", "12", "T H", "TH,GB", "**", "TH*",
    "TH&layers=venue", "../..", "%2A", "<script>", "null", "undefined",
  ]) {
    assert.equal(resolveOrsCountry(bad), ORS_DEFAULT_COUNTRY, `should have narrowed: ${bad}`);
  }
});

test("the default is Thailand and the sentinel is not a country code", () => {
  assert.equal(ORS_DEFAULT_COUNTRY, "TH");
  assert.equal(ORS_WORLDWIDE, "*");
  assert.notEqual(ORS_WORLDWIDE, ORS_DEFAULT_COUNTRY);
});
