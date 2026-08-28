import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BRAND_CURRENCY_LOG_FIELD,
  brandCurrencyLogValue,
  FALLBACK_CURRENCIES,
  parseBrandCurrencyAdd,
  parseBrandCurrencyId,
  parseBrandCurrencyToggle,
  type BrandCurrencyAdd,
} from "./brand-currency-input";

function added(body: unknown): BrandCurrencyAdd {
  const r = parseBrandCurrencyAdd(body);
  assert.ok(r.ok, `expected a parse, got: ${r.ok ? "" : r.error}`);
  return r.value;
}

function refusedAdd(body: unknown): string {
  const r = parseBrandCurrencyAdd(body);
  assert.equal(r.ok, false, "expected a refusal");
  return r.ok ? "" : r.error;
}

test("an add is trimmed and upper-cased on both codes", () => {
  assert.deepEqual(added({ brandCode: " KSI ", countryCode: " gb ", currencyCode: "gbp" }), {
    brandCode: "KSI",
    countryCode: "GB",
    currencyCode: "GBP",
  });
});

test("the country is optional; the currency is not", () => {
  assert.deepEqual(added({ brandCode: "KSI", currencyCode: "GBP" }), {
    brandCode: "KSI",
    countryCode: null,
    currencyCode: "GBP",
  });
  for (const empty of [null, undefined, "", "   "]) {
    assert.deepEqual(added({ brandCode: "KSI", countryCode: empty, currencyCode: "GBP" }).countryCode, null);
    assert.match(refusedAdd({ brandCode: "KSI", currencyCode: empty }), /เลือกสกุลเงิน/);
  }
});

/**
 * `CurrencyCode` is `CHAR(3)`. SQL Server pads a short value with spaces and
 * raises on a long one, so a wrong length has to be a 400 here rather than a
 * truncated row there.
 */
test("a code of the wrong length or shape is refused, never coerced", () => {
  for (const bad of ["GB", "GBPP", "GB1", "G B", "£££"]) {
    assert.match(refusedAdd({ brandCode: "KSI", currencyCode: bad }), /ISO-4217/);
  }
  for (const bad of ["G", "GBP", "G1", 12]) {
    assert.match(refusedAdd({ brandCode: "KSI", countryCode: bad, currencyCode: "GBP" }), /ISO-3166-1/);
  }
  assert.match(refusedAdd({ brandCode: "KSI", currencyCode: 826 }), /ISO-4217/);
});

/**
 * An unknown country would render as a row with no country at all —
 * `countryLabel` answers null for it — which is indistinguishable from one that
 * never had one. Refuse it instead.
 */
test("a country COUNTRIES does not carry is refused", () => {
  assert.match(refusedAdd({ brandCode: "KSI", countryCode: "ZZ", currencyCode: "GBP" }), /ไม่รู้จักประเทศ/);
  assert.deepEqual(added({ brandCode: "KSI", countryCode: "GB", currencyCode: "GBP" }).countryCode, "GB");
});

/**
 * A brand may genuinely settle in a currency other than its country's, and the
 * picker fills the currency in from the country anyway — so the pair is not
 * required to agree.
 */
test("the currency need not be the country's own", () => {
  assert.deepEqual(added({ brandCode: "KSI", countryCode: "GB", currencyCode: "USD" }).currencyCode, "USD");
});

test("a missing or over-long brand code is refused", () => {
  assert.match(refusedAdd({ currencyCode: "GBP" }), /ระบุแบรนด์/);
  assert.match(refusedAdd({ brandCode: "   ", currencyCode: "GBP" }), /ระบุแบรนด์/);
  assert.match(refusedAdd({ brandCode: "X".repeat(41), currencyCode: "GBP" }), /ยาวเกินไป/);
});

/**
 * **Duplicates are not this module's job.** `UQ_BrandCurrency_Brand_Currency`
 * is the rule; a check here would be a second, weaker answer that two admins on
 * two tabs defeat. The parse must therefore accept a currency the brand already
 * carries and leave the refusal to the insert.
 */
test("a duplicate parses cleanly — the unique constraint is what refuses it", () => {
  assert.deepEqual(added({ brandCode: "KSI", currencyCode: "GBP" }).currencyCode, "GBP");
});

test("a toggle needs a positive integer id and a real boolean", () => {
  assert.deepEqual(parseBrandCurrencyToggle({ id: 7, isEnabled: false }), {
    ok: true,
    id: 7,
    isEnabled: false,
  });
  assert.deepEqual(parseBrandCurrencyToggle({ id: "7", isEnabled: true }), {
    ok: true,
    id: 7,
    isEnabled: true,
  });
  for (const bad of [0, -1, 1.5, "abc", null, undefined]) {
    const r = parseBrandCurrencyToggle({ id: bad, isEnabled: true });
    assert.equal(r.ok, false, `expected ${String(bad)} to be refused as an id`);
  }
  for (const bad of ["true", 1, null, undefined]) {
    const r = parseBrandCurrencyToggle({ id: 7, isEnabled: bad });
    assert.equal(r.ok, false, `expected ${String(bad)} to be refused as a flag`);
  }
});

test("a remove needs a positive integer id, from a query string or a body", () => {
  assert.deepEqual(parseBrandCurrencyId("7"), { ok: true, id: 7 });
  assert.deepEqual(parseBrandCurrencyId(7), { ok: true, id: 7 });
  for (const bad of ["", "0", "-3", "1.5", "abc", null, undefined]) {
    assert.equal(parseBrandCurrencyId(bad).ok, false, `expected ${String(bad)} to be refused`);
  }
});

/**
 * The log has to answer what the row *was*, not merely that something changed:
 * a value reading only `GBP` cannot tell a currency being switched off from one
 * being removed outright.
 */
test("the log value carries the currency, its country and its state", () => {
  assert.equal(
    brandCurrencyLogValue({ countryCode: "GB", currencyCode: "GBP", isEnabled: true }),
    "GBP (GB) 1",
  );
  assert.equal(
    brandCurrencyLogValue({ countryCode: null, currencyCode: "gbp", isEnabled: false }),
    "GBP (-) 0",
  );
  assert.equal(
    brandCurrencyLogValue({ countryCode: "  ", currencyCode: "GBP", isEnabled: false }),
    "GBP (-) 0",
  );
});

/** It has to fit `BrandSettingLog.NewValue`, which is `nvarchar(100)`. */
test("the log value fits the column it is written to", () => {
  const v = brandCurrencyLogValue({ countryCode: "GB", currencyCode: "GBP", isEnabled: true });
  assert.ok(v.length <= 100, `expected <= 100 chars, got ${v.length}`);
  assert.ok(BRAND_CURRENCY_LOG_FIELD.length <= 40);
});

/**
 * Offering a currency no rate can be had for is a trap: a foreign claim in it
 * fails closed at submit, and the admin who picked it would have no way to know
 * why. THB belongs in the list because it is a real answer, not because it is
 * addable — the panel filters it out separately.
 */
test("the fallback currency list is well formed and holds baht", () => {
  const seen: Record<string, true> = {};
  for (const c of FALLBACK_CURRENCIES) {
    assert.match(c.code, /^[A-Z]{3}$/, `bad code: ${c.code}`);
    assert.ok(c.name.trim().length > 0, `missing name for ${c.code}`);
    assert.ok(!seen[c.code], `duplicate code: ${c.code}`);
    seen[c.code] = true;
  }
  assert.ok(seen.THB);
});
