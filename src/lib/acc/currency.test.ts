import { test } from "node:test";
import assert from "node:assert/strict";
import {
  THB,
  bahtEnabled,
  defaultCurrencyRow,
  enabledClaimCurrencies,
  isBaht,
  resolvedDefaultCurrency,
  toBaht,
  admitModelCurrency,
  brandCurrencyState,
  enabledForeignCurrencies,
  sameCurrency,
  type BrandCurrencyEntry,
} from "./currency";

test("null, empty and THB all mean baht", () => {
  assert.equal(isBaht(null), true);
  assert.equal(isBaht(undefined), true);
  assert.equal(isBaht(""), true);
  assert.equal(isBaht(THB), true);
  assert.equal(isBaht("thb"), true);
  assert.equal(isBaht("  THB  "), true);
  assert.equal(isBaht("MYR"), false);
});

test("converting applies the rate and rounds to satang", () => {
  assert.equal(toBaht(100, 8.25), 825);
  assert.equal(toBaht(12.34, 8.25), 101.81);
});

/**
 * A foreign amount with no usable rate is not zero and not itself — it is
 * unknown. Returning the unconverted figure would put a foreign number into a
 * baht column, which is the one failure this feature exists to prevent, and it
 * would be invisible.
 */
test("a foreign amount with no usable rate converts to null, never to itself", () => {
  assert.equal(toBaht(100, null), null);
  assert.equal(toBaht(100, 0), null);
  assert.equal(toBaht(100, -1), null);
  assert.equal(toBaht(100, Number.NaN), null);
  assert.equal(toBaht(100, Number.POSITIVE_INFINITY), null);
});

test("a non-finite amount converts to null", () => {
  assert.equal(toBaht(Number.NaN, 8.25), null);
  assert.equal(toBaht(Number.POSITIVE_INFINITY, 8.25), null);
});

/** Zero is a real figure — a nil claim line converts to a nil baht line. */
test("zero converts to zero, not to null", () => {
  assert.equal(toBaht(0, 8.25), 0);
});

/**
 * The admission rule. The model may answer only with one of the brand's own
 * currencies or baht; anything else means the user picks, which is what null
 * signals.
 */
test("the model's answer is admitted only if it is one of the brand's currencies or baht", () => {
  assert.equal(admitModelCurrency("MYR", ["MYR"]), "MYR");
  assert.equal(admitModelCurrency("myr", ["MYR"]), "MYR");
  assert.equal(admitModelCurrency(" MYR ", ["MYR"]), "MYR");
  assert.equal(admitModelCurrency("THB", ["MYR"]), THB);
  assert.equal(admitModelCurrency("USD", ["MYR"]), null);
  assert.equal(admitModelCurrency("", ["MYR"]), null);
  assert.equal(admitModelCurrency(null, ["MYR"]), null);
  assert.equal(admitModelCurrency(undefined, ["MYR"]), null);
});

/**
 * The reason this takes a list. A brand carrying THB and GBP must admit a GBP
 * receipt: with a single-code parameter the second currency was a misread
 * invented by the shape of the argument.
 */
test("every currency the brand carries is admitted, not only the first", () => {
  const brand = ["GBP", "MYR"];
  assert.equal(admitModelCurrency("GBP", brand), "GBP");
  assert.equal(admitModelCurrency("MYR", brand), "MYR");
  assert.equal(admitModelCurrency("THB", brand), THB);
  assert.equal(admitModelCurrency("USD", brand), null);
});

/** With no brand currency the only admissible answer is baht. */
test("an unconfigured brand admits baht alone", () => {
  assert.equal(admitModelCurrency("THB", []), THB);
  assert.equal(admitModelCurrency("MYR", []), null);
  assert.equal(admitModelCurrency("THB", null), THB);
  assert.equal(admitModelCurrency("MYR", null), null);
  assert.equal(admitModelCurrency("MYR", undefined), null);
});

/** A THB entry is not a choice — baht is admitted anyway, and nothing else is. */
test("a list holding only THB admits baht and nothing else", () => {
  assert.equal(admitModelCurrency("THB", ["THB"]), THB);
  assert.equal(admitModelCurrency("MYR", ["THB"]), null);
});

function entry(
  code: string,
  isEnabled: boolean,
  id = 1,
): { id: number; countryCode: string | null; currencyCode: string; isEnabled: boolean } {
  return { id, countryCode: null, currencyCode: code, isEnabled };
}

test("the currencies on offer are the enabled, non-baht ones, deduplicated", () => {
  assert.deepEqual(
    enabledForeignCurrencies([entry("GBP", true, 1), entry("MYR", true, 2)]),
    ["GBP", "MYR"],
  );
  assert.deepEqual(enabledForeignCurrencies([entry("MYR", false)]), []);
  assert.deepEqual(enabledForeignCurrencies([entry("THB", true)]), []);
  assert.deepEqual(enabledForeignCurrencies([entry(" myr ", true)]), ["MYR"]);
  assert.deepEqual(enabledForeignCurrencies([entry("", true)]), []);
  assert.deepEqual(enabledForeignCurrencies([]), []);
  assert.deepEqual(enabledForeignCurrencies(null), []);
  assert.deepEqual(enabledForeignCurrencies(undefined), []);
});

/** Belt and braces over UQ_BrandCurrency_Brand_Currency — a picker must not list one twice. */
test("a duplicate code is offered once", () => {
  assert.deepEqual(
    enabledForeignCurrencies([entry("MYR", true, 1), entry("myr", true, 2)]),
    ["MYR"],
  );
});

test("a brand is configured only while at least one foreign currency is switched on", () => {
  assert.equal(brandCurrencyState({ currencies: [entry("MYR", true)] }), "configured");
  assert.equal(
    brandCurrencyState({ currencies: [entry("THB", true, 1), entry("GBP", true, 2)] }),
    "configured",
  );
  assert.equal(brandCurrencyState({ currencies: [entry("MYR", false)] }), "none");
  assert.equal(brandCurrencyState({ currencies: [entry("THB", true)] }), "none");
  assert.equal(brandCurrencyState({ currencies: [] }), "none");
  assert.equal(brandCurrencyState({ currencies: null }), "none");
  assert.equal(brandCurrencyState(null), "none");
  assert.equal(brandCurrencyState(undefined), "none");
});

/**
 * The three spellings of baht are why this exists: a bare `===` on the codes
 * would call a null claim currency different from a `"THB"` read and blank a
 * field that was perfectly fillable.
 */
test("sameCurrency treats null, empty and THB as one currency", () => {
  assert.equal(sameCurrency(null, THB), true);
  assert.equal(sameCurrency("", null), true);
  assert.equal(sameCurrency(undefined, "thb"), true);
  assert.equal(sameCurrency("MYR", "myr"), true);
  assert.equal(sameCurrency("MYR", THB), false);
  assert.equal(sameCurrency("MYR", null), false);
  assert.equal(sameCurrency("MYR", "USD"), false);
});

/* ── The default a brand's claims start in (migration 131) ───────────────── */

function row(
  code: string,
  isEnabled: boolean,
  extra: { id?: number; countryCode?: string | null; isDefault?: boolean } = {},
): BrandCurrencyEntry {
  return {
    id: extra.id ?? 1,
    countryCode: extra.countryCode ?? null,
    currencyCode: code,
    isEnabled,
    isDefault: extra.isDefault,
  };
}

/**
 * The rule that makes every brand configured before 131 behave exactly as it
 * did: baht is claimable while no row says otherwise.
 */
test("baht is claimable unless an explicit THB row is switched off", () => {
  assert.equal(bahtEnabled([]), true);
  assert.equal(bahtEnabled(null), true);
  assert.equal(bahtEnabled(undefined), true);
  assert.equal(bahtEnabled([row("MYR", true)]), true);
  assert.equal(bahtEnabled([row("MYR", false)]), true);
  assert.equal(bahtEnabled([row("THB", true)]), true);
  assert.equal(bahtEnabled([row("THB", false)]), false);
  assert.equal(bahtEnabled([row("THB", false, { id: 1 }), row("MYR", true, { id: 2 })]), false);
});

/** Padding and case are the shapes `CHAR(3)` actually hands back. */
test("bahtEnabled recognises a THB row however it is spelt", () => {
  assert.equal(bahtEnabled([row(" thb ", false)]), false);
});

test("the claim currencies are baht first, then the enabled foreign codes", () => {
  assert.deepEqual(enabledClaimCurrencies([]), ["THB"]);
  assert.deepEqual(enabledClaimCurrencies([row("MYR", true)]), ["THB", "MYR"]);
  assert.deepEqual(
    enabledClaimCurrencies([row("THB", false, { id: 1 }), row("MYR", true, { id: 2 })]),
    ["MYR"],
  );
  assert.deepEqual(enabledClaimCurrencies([row("MYR", false)]), ["THB"]);
});

/**
 * The state the settings writes refuse to create, and the only one for which
 * this list is empty. It is asserted here because `assertStillClaimable` is
 * defined in terms of it.
 */
test("a brand with baht off and nothing else enabled can claim in nothing", () => {
  assert.deepEqual(
    enabledClaimCurrencies([row("THB", false, { id: 1 }), row("MYR", false, { id: 2 })]),
    [],
  );
});

test("a marked default only counts while its row is enabled", () => {
  const on = row("MYR", true, { id: 7, countryCode: "MY", isDefault: true });
  assert.equal(defaultCurrencyRow([on])?.id, 7);
  assert.equal(defaultCurrencyRow([row("MYR", false, { id: 7, isDefault: true })]), null);
  assert.equal(defaultCurrencyRow([row("MYR", true, { id: 7 })]), null);
  assert.equal(defaultCurrencyRow([]), null);
  assert.equal(defaultCurrencyRow(null), null);
});

/**
 * What the settings panel ticks. It has to be the default **in force**, not the
 * one somebody flagged: no brand configured before migration 131 carries a flag
 * at all, and baht is the answer for every one of them.
 */
test("the resolved default is baht until something says otherwise", () => {
  assert.equal(resolvedDefaultCurrency([]), "THB");
  assert.equal(resolvedDefaultCurrency([row("MYR", true)]), "THB");
  assert.equal(
    resolvedDefaultCurrency([row("MYR", true, { id: 1, isDefault: true })]),
    "MYR",
  );
  // Baht off and nothing marked: the first enabled foreign code answers. The
  // writes reconcile this away, but a direct SQL edit can produce it.
  assert.equal(
    resolvedDefaultCurrency([row("THB", false, { id: 1 }), row("GBP", true, { id: 2 })]),
    "GBP",
  );
  // Nothing enabled at all — the state the writes refuse to create.
  assert.equal(resolvedDefaultCurrency([row("THB", false, { id: 1 })]), null);
});

/** A flag on a row somebody has since switched off must not win. */
test("the resolved default ignores a stale flag on a disabled row", () => {
  assert.equal(
    resolvedDefaultCurrency([
      row("THB", true, { id: 1 }),
      row("MYR", false, { id: 2, isDefault: true }),
    ]),
    "THB",
  );
});

/**
 * **Rounding each figure separately can miss the rounded total by a satang, and
 * that is accepted rather than fixed.**
 *
 * `toBaht` rounds to 2dp, so three separately-rounded addends need not sum to
 * the conversion of their total. AP-17's booking card shows all four —
 * ราคา / VAT / ส่วนลด / ราคารวม — each converted from its own figure, so a reader
 * adding the column can land a satang away from the total's own line.
 *
 * The case below is not contrived: it uses the rate the desk was looking at on
 * 2026-09-02, 45.0110, and three entirely ordinary figures.
 *
 * **The fix that suggests itself — deriving the total's baht by summing the
 * parts — would be worse, and must not be made.** `recomputeBookingBaht` stores
 * `ROUND(TotalAmount * @rate, 2)`, the total converted directly, and
 * `report-service` sums that stored column. A screen showing a summed figure
 * would disagree with the database and with the report, which is a real
 * discrepancy rather than a displayed satang. Every figure carries `≈`.
 */
test("separately rounded parts need not sum to the rounded total", () => {
  const rate = 45.011;
  const price = 46.06;
  const vat = 3.22;
  const discount = 0;
  const total = 49.28; // price + vat - discount, as the field holds it

  const parts =
    Math.round(
      ((toBaht(price, rate) ?? 0) + (toBaht(vat, rate) ?? 0) - (toBaht(discount, rate) ?? 0)) * 100,
    ) / 100;

  assert.equal(toBaht(price, rate), 2073.21);
  assert.equal(toBaht(vat, rate), 144.94);
  assert.equal(parts, 2218.15);
  assert.equal(toBaht(total, rate), 2218.14);
  assert.notEqual(parts, toBaht(total, rate));
});

/** And the gap is bounded: three addends each within half a satang of their true value. */
test("the parts-versus-total gap stays within two satang", () => {
  const rate = 45.011;
  let worst = 0;
  for (let p = 1; p <= 4000; p++) {
    const price = p / 4;
    const vat = Math.round(price * 7) / 100;
    const discount = Math.round(price / 3 * 100) / 100;
    const total = Math.round((price + vat - discount) * 100) / 100;
    const parts =
      Math.round(
        ((toBaht(price, rate) ?? 0) + (toBaht(vat, rate) ?? 0) - (toBaht(discount, rate) ?? 0)) * 100,
      ) / 100;
    const gap = Math.abs(parts - (toBaht(total, rate) ?? 0));
    if (gap > worst) worst = gap;
  }
  assert.ok(worst <= 0.02, `expected at most two satang, saw ${worst.toFixed(4)}`);
  assert.ok(worst > 0, "the sweep found no gap at all — has toBaht stopped rounding?");
});
