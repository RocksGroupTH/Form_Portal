import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COUNTRIES,
  currencyForCountry,
  countryLabel,
  isKnownCountry,
} from "./country-currency";

test("a country resolves to its currency", () => {
  assert.equal(currencyForCountry("TH"), "THB");
  assert.equal(currencyForCountry("MY"), "MYR");
  assert.equal(currencyForCountry("GB"), "GBP");
  assert.equal(currencyForCountry("JP"), "JPY");
});

test("the code is matched case- and space-insensitively", () => {
  assert.equal(currencyForCountry("th"), "THB");
  assert.equal(currencyForCountry("  my  "), "MYR");
});

/** An unknown country is not a guess — the caller must not invent a currency. */
test("an unknown or empty country resolves to null", () => {
  assert.equal(currencyForCountry("ZZ"), null);
  assert.equal(currencyForCountry(""), null);
  assert.equal(currencyForCountry(null), null);
  assert.equal(currencyForCountry(undefined), null);
});

test("isKnownCountry agrees with currencyForCountry", () => {
  assert.equal(isKnownCountry("TH"), true);
  assert.equal(isKnownCountry("zz"), false);
  assert.equal(isKnownCountry(null), false);
});

test("a country carries a Thai and an English label", () => {
  const th = COUNTRIES.find((c) => c.code === "TH");
  assert.ok(th);
  assert.equal(th.currency, "THB");
  assert.ok(th.nameTh.length > 0);
  assert.ok(th.nameEn.length > 0);
});

test("countryLabel reads as the picker shows it", () => {
  assert.equal(countryLabel("TH"), "ไทย (THB)");
  assert.equal(countryLabel("GB"), "อังกฤษ (GBP)");
  assert.equal(countryLabel("ZZ"), null);
});

/**
 * The list is data somebody will extend. These hold whoever does that to the
 * shape the rest of the code assumes.
 */
test("every entry is a well-formed ISO pair", () => {
  for (const c of COUNTRIES) {
    assert.match(c.code, /^[A-Z]{2}$/, `country code: ${c.code}`);
    assert.match(c.currency, /^[A-Z]{3}$/, `currency for ${c.code}: ${c.currency}`);
    assert.ok(c.nameTh.trim().length > 0, `nameTh for ${c.code}`);
    assert.ok(c.nameEn.trim().length > 0, `nameEn for ${c.code}`);
  }
});

test("no country appears twice", () => {
  const seen = new Set<string>();
  for (const c of COUNTRIES) {
    assert.equal(seen.has(c.code), false, `duplicate country: ${c.code}`);
    seen.add(c.code);
  }
});

/** Two countries may share a currency (EUR), so only the country is unique. */
test("the list is sorted by Thai name, so the picker needs no sort", () => {
  const names = COUNTRIES.map((c) => c.nameTh);
  const sorted = names.slice().sort((a, b) => a.localeCompare(b, "th"));
  assert.deepEqual(names, sorted);
});

test("Thailand is present, because it is the default everything falls back to", () => {
  assert.equal(isKnownCountry("TH"), true);
});
