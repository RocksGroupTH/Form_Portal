import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COMMON_COUNTRY_CODES,
  FALLBACK_CURRENCIES,
  brandCurrencyChanges,
  parseBrandCurrencyBody,
  type BrandCurrencyPatch,
} from "./brand-currency-input";

const OFF: BrandCurrencyPatch = { countryCode: null, currencyCode: null, currencyEnabled: false };

function ok(body: unknown) {
  const r = parseBrandCurrencyBody(body);
  assert.equal(r.ok, true, `expected a parse, got: ${r.ok ? "" : r.error}`);
  return r as Extract<typeof r, { ok: true }>;
}

function refused(body: unknown): string {
  const r = parseBrandCurrencyBody(body);
  assert.equal(r.ok, false, "expected a refusal");
  return (r as Extract<typeof r, { ok: false }>).error;
}

/* ── parse ───────────────────────────────────────────────────────────────── */

test("a complete body parses, upper-cased and trimmed", () => {
  const r = ok({ brandCode: " PCMY ", countryCode: " my ", currencyCode: "myr", currencyEnabled: true });
  assert.equal(r.brandCode, "PCMY");
  assert.deepEqual(r.patch, { countryCode: "MY", currencyCode: "MYR", currencyEnabled: true });
});

test("blank, absent and null all mean not set", () => {
  for (const empty of ["", "   ", null, undefined]) {
    const r = ok({ brandCode: "PCTH", countryCode: empty, currencyCode: empty });
    assert.deepEqual(r.patch, OFF);
  }
});

/** CHAR(2)/CHAR(3) pads a short value and raises on a long one — refuse here. */
test("a country code that is not two letters is refused, never truncated", () => {
  for (const bad of ["M", "MYS", "Malaysia", "M1", "12", " M Y "]) {
    assert.match(refused({ brandCode: "X", countryCode: bad }), /ISO-3166-1/);
  }
});

test("a currency code that is not three letters is refused", () => {
  for (const bad of ["MY", "MYRR", "12A", "Ringgit"]) {
    assert.match(refused({ brandCode: "X", currencyCode: bad }), /ISO-4217/);
  }
});

test("a non-string code is refused rather than coerced", () => {
  assert.match(refused({ brandCode: "X", currencyCode: 826 }), /ISO-4217/);
  assert.match(refused({ brandCode: "X", countryCode: { a: 1 } }), /ISO-3166-1/);
});

test("a missing brand code is refused", () => {
  assert.match(refused({}), /แบรนด์/);
  assert.match(refused({ brandCode: "   " }), /แบรนด์/);
});

test("a brand code longer than the column is refused", () => {
  assert.match(refused({ brandCode: "B".repeat(41) }), /ยาวเกินไป/);
});

/** The flag without a code names nothing — see brandCurrencyState. */
test("enabling without a currency is refused", () => {
  assert.match(refused({ brandCode: "PCMY", currencyEnabled: true }), /เลือกสกุลเงิน/);
});

test("a currency may be set without being switched on", () => {
  const r = ok({ brandCode: "PCMY", currencyCode: "MYR" });
  assert.deepEqual(r.patch, { countryCode: null, currencyCode: "MYR", currencyEnabled: false });
});

test("only a real boolean switches it on", () => {
  assert.equal(ok({ brandCode: "X", currencyCode: "MYR" }).patch.currencyEnabled, false);
  assert.equal(ok({ brandCode: "X", currencyCode: "MYR", currencyEnabled: null }).patch.currencyEnabled, false);
  assert.match(refused({ brandCode: "X", currencyCode: "MYR", currencyEnabled: "true" }), /ไม่ถูกต้อง/);
  assert.match(refused({ brandCode: "X", currencyCode: "MYR", currencyEnabled: 1 }), /ไม่ถูกต้อง/);
});

test("a body that is not an object at all is refused, not thrown on", () => {
  assert.match(refused(null), /แบรนด์/);
  assert.match(refused(undefined), /แบรนด์/);
});

/* ── the diff that becomes the audit trail ───────────────────────────────── */

test("an unchanged save logs nothing", () => {
  assert.deepEqual(brandCurrencyChanges(OFF, OFF), []);
  const set: BrandCurrencyPatch = { countryCode: "MY", currencyCode: "MYR", currencyEnabled: true };
  assert.deepEqual(brandCurrencyChanges(set, set), []);
});

test("one row per changed field, spelled as the column is", () => {
  const changes = brandCurrencyChanges(OFF, { countryCode: "MY", currencyCode: "MYR", currencyEnabled: true });
  assert.deepEqual(changes, [
    { field: "CountryCode", oldValue: null, newValue: "MY" },
    { field: "CurrencyCode", oldValue: null, newValue: "MYR" },
    { field: "CurrencyEnabled", oldValue: "0", newValue: "1" },
  ]);
});

test("only the field that moved is logged", () => {
  const before: BrandCurrencyPatch = { countryCode: "MY", currencyCode: "MYR", currencyEnabled: false };
  assert.deepEqual(brandCurrencyChanges(before, { ...before, currencyEnabled: true }), [
    { field: "CurrencyEnabled", oldValue: "0", newValue: "1" },
  ]);
});

test("clearing a value is a change, and records what it was", () => {
  const before: BrandCurrencyPatch = { countryCode: "MY", currencyCode: "MYR", currencyEnabled: false };
  assert.deepEqual(brandCurrencyChanges(before, OFF), [
    { field: "CountryCode", oldValue: "MY", newValue: null },
    { field: "CurrencyCode", oldValue: "MYR", newValue: null },
  ]);
});

/* ── the offered lists ───────────────────────────────────────────────────── */

test("every fallback currency is a plausible ISO-4217 code, and baht is among them", () => {
  for (const c of FALLBACK_CURRENCIES) assert.match(c.code, /^[A-Z]{3}$/);
  assert.ok(FALLBACK_CURRENCIES.some((c) => c.code === "THB"));
  assert.ok(FALLBACK_CURRENCIES.some((c) => c.code === "MYR"));
});

test("every suggested country is a plausible ISO-3166-1 alpha-2 code", () => {
  for (const c of COMMON_COUNTRY_CODES) assert.match(c, /^[A-Z]{2}$/);
  assert.ok(COMMON_COUNTRY_CODES.indexOf("TH") !== -1);
  assert.ok(COMMON_COUNTRY_CODES.indexOf("MY") !== -1);
});

/** The suggestions are a datalist, so anything else valid must still parse. */
test("a country outside the suggestion list is still accepted", () => {
  assert.equal(ok({ brandCode: "X", countryCode: "IS" }).patch.countryCode, "IS");
});
