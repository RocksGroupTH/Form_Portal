import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PER_DIEM_HOME_COUNTRY,
  isPerDiemCountry,
  perDiemCountryLog,
  perDiemLogFor,
  type PerDiemCountryRate,
} from "./perdiem-country";

/**
 * The one decision: which effective-dated log prices a trip.
 *
 * This is the module that changes a figure the company pays, so its refusals
 * matter more than its answers. Every case below where it declines to use a
 * country rate is a case where the employee's own HR allowance applies — the
 * number the trip would have been priced at before this feature existed.
 */

const rate = (countryCode: string, effectiveDate: string, amount: number): PerDiemCountryRate => ({
  countryCode,
  effectiveDate,
  amount,
});

const EMPLOYEE = [
  { effectiveDate: "2020-01-01", amount: 500 },
  { effectiveDate: "2026-01-01", amount: 600 },
];

/* ── isPerDiemCountry ─────────────────────────────────────────────────── */

test("Thailand is not a per-diem country, because it is where the HR log applies", () => {
  assert.equal(isPerDiemCountry("TH"), false);
  assert.equal(isPerDiemCountry("th"), false);
  assert.equal(isPerDiemCountry(" TH "), false);
  assert.equal(isPerDiemCountry(PER_DIEM_HOME_COUNTRY), false);
});

test("a foreign country is", () => {
  assert.equal(isPerDiemCountry("MY"), true);
  assert.equal(isPerDiemCountry("gb"), true);
});

test("blank and malformed are not", () => {
  for (const v of [null, undefined, "", "  ", "T", "THA", "12"]) {
    assert.equal(isPerDiemCountry(v), false, `should be false: ${String(v)}`);
  }
});

/* ── perDiemCountryLog ────────────────────────────────────────────────── */

test("a country with rates gets its own log, ascending by date", () => {
  const log = perDiemCountryLog("MY", [
    rate("MY", "2026-06-01", 1200),
    rate("MY", "2026-01-01", 1000),
    rate("GB", "2026-01-01", 3000),
  ]);
  assert.deepEqual(log, [
    { effectiveDate: "2026-01-01", amount: 1000 },
    { effectiveDate: "2026-06-01", amount: 1200 },
  ]);
});

/**
 * THE CENTRAL REFUSAL. Null means "fall back to the employee's log" and an empty
 * array would mean "this country pays nothing" — `rateForDay` returns 0 for a
 * day it cannot match, so an empty log silently pays zero. The two must never be
 * confused, which is why this returns null and never `[]`.
 */
test("a country with no rates answers null, never an empty log", () => {
  assert.equal(perDiemCountryLog("MY", []), null);
  assert.equal(perDiemCountryLog("MY", [rate("GB", "2026-01-01", 3000)]), null);
  assert.equal(perDiemCountryLog(null, [rate("MY", "2026-01-01", 1000)]), null);
});

test("Thailand answers null even when somebody has stored a TH row", () => {
  assert.equal(perDiemCountryLog("TH", [rate("TH", "2026-01-01", 999)]), null);
});

test("the country is matched case- and space-insensitively", () => {
  const log = perDiemCountryLog(" my ", [rate("MY", "2026-01-01", 1000)]);
  assert.deepEqual(log, [{ effectiveDate: "2026-01-01", amount: 1000 }]);
});

/* ── perDiemLogFor ────────────────────────────────────────────────────── */

test("a country with a rate is priced by it, and says so", () => {
  const r = perDiemLogFor("MY", EMPLOYEE, [rate("MY", "2026-01-01", 1000)]);
  assert.equal(r.source, "country");
  assert.equal(r.countryCode, "MY");
  assert.deepEqual(r.log, [{ effectiveDate: "2026-01-01", amount: 1000 }]);
});

test("a country with no rate falls back to the employee's own log", () => {
  const r = perDiemLogFor("MY", EMPLOYEE, []);
  assert.equal(r.source, "employee");
  assert.equal(r.countryCode, null);
  assert.deepEqual(r.log, EMPLOYEE);
});

test("a Thai trip is always the employee's log, whatever is configured", () => {
  const r = perDiemLogFor("TH", EMPLOYEE, [rate("TH", "2026-01-01", 9999)]);
  assert.equal(r.source, "employee");
  assert.deepEqual(r.log, EMPLOYEE);
});

test("no country at all — every trip filed before this shipped — is the employee's log", () => {
  for (const c of [null, undefined, ""]) {
    const r = perDiemLogFor(c, EMPLOYEE, [rate("MY", "2026-01-01", 1000)]);
    assert.equal(r.source, "employee");
    assert.equal(r.countryCode, null);
  }
});

/**
 * An employee with no HR log and a country with no rate has nothing to be
 * priced at. That is honest — an empty log makes `rateForDay` answer 0 — and it
 * must not be papered over here, because the caller can tell the difference
 * between "no rate" and "zero rate" only if this does not invent one.
 */
test("no country rate and no employee log leaves an empty log, not a guess", () => {
  const r = perDiemLogFor("MY", [], []);
  assert.equal(r.source, "employee");
  assert.deepEqual(r.log, []);
});

/**
 * The returned log must never alias the caller's array: the recompute path
 * hands the same employee log to several trips in a group, and a sort in place
 * would reorder somebody else's.
 */
test("the country log is a fresh array, so sorting it cannot disturb the input", () => {
  const rates = [rate("MY", "2026-06-01", 1200), rate("MY", "2026-01-01", 1000)];
  const snapshot = JSON.stringify(rates);
  const r = perDiemLogFor("MY", EMPLOYEE, rates);
  assert.notEqual(r.log, rates as unknown);
  assert.equal(JSON.stringify(rates), snapshot, "the input rate list was mutated");
});

test("the employee fallback hands back the caller's own log without copying it", () => {
  const r = perDiemLogFor(null, EMPLOYEE, []);
  assert.deepEqual(r.log, EMPLOYEE);
});

/** `source` exists so no consumer has to re-derive "did a country rate apply". */
test("source is one of exactly two words", () => {
  for (const [c, rates] of [
    ["MY", [rate("MY", "2026-01-01", 1000)]],
    ["MY", []],
    ["TH", []],
    [null, []],
  ] as const) {
    const r = perDiemLogFor(c, EMPLOYEE, rates as readonly PerDiemCountryRate[]);
    assert.ok(r.source === "country" || r.source === "employee");
    assert.equal(r.countryCode !== null, r.source === "country");
  }
});
