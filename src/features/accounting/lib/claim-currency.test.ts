import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_COUNTRY,
  claimCountryOptions,
  defaultClaimCountry,
  effectiveClaimCountry,
  effectiveLineCurrency,
  lineCurrencyOptions,
  lineMoney,
  lineNeedsCurrency,
  resolveLineCurrency,
  typedLineFigure,
  usesCurrencySegments,
  LINE_CURRENCY_SEGMENT_MAX,
} from "./claim-currency";
import type { BrandCurrencyEntry } from "@/lib/acc/currency";

function entry(code: string, isEnabled: boolean, id = 1): BrandCurrencyEntry {
  return { id, countryCode: null, currencyCode: code, isEnabled };
}

const MYR = { currencies: [entry("MYR", true)] };
const MYR_AND_GBP = { currencies: [entry("MYR", true, 1), entry("GBP", true, 2)] };
const EUR = { currencies: [entry("EUR", true)] };
const STAGED = { currencies: [entry("MYR", false)] };
const NOTHING = { currencies: [] };
const BAHT_BRAND = { currencies: [entry("THB", true)] };

/* ── The country picker ── */

/**
 * A brand with nothing configured must leave the form pixel-identical to before
 * this feature shipped, which one option — Thailand — is what produces: the
 * picker renders only for `length > 1`.
 */
test("Thailand is always offered, first, and alone for an unconfigured brand", () => {
  assert.deepEqual(claimCountryOptions(NOTHING), ["TH"]);
  assert.deepEqual(claimCountryOptions(STAGED), ["TH"]);
  assert.deepEqual(claimCountryOptions(BAHT_BRAND), ["TH"]);
  assert.deepEqual(claimCountryOptions(null), ["TH"]);
  assert.deepEqual(claimCountryOptions(undefined), ["TH"]);
  assert.equal(claimCountryOptions(MYR)[0], DEFAULT_COUNTRY);
});

test("a configured currency brings its country onto the picker", () => {
  assert.deepEqual(claimCountryOptions(MYR), ["TH", "MY"]);
});

/** The whole point of `BrandCurrency` being a list: a brand may carry several. */
test("every enabled currency contributes its country", () => {
  assert.deepEqual(claimCountryOptions(MYR_AND_GBP), ["TH", "MY", "GB"]);
});

/**
 * One currency, several countries. The requester names where they went and the
 * currency follows — which is why the picker is countries rather than codes.
 */
test("a shared currency offers every country that uses it", () => {
  assert.deepEqual(claimCountryOptions(EUR), ["TH", "NL", "FR", "DE", "ES", "IT"]);
});

test("a disabled row is left out while its siblings still appear", () => {
  assert.deepEqual(
    claimCountryOptions({ currencies: [entry("MYR", false, 1), entry("GBP", true, 2)] }),
    ["TH", "GB"],
  );
});

test("Thailand is the default, and anything the brand does not offer resolves to it", () => {
  assert.equal(effectiveClaimCountry(null, MYR), "TH");
  assert.equal(effectiveClaimCountry("", MYR), "TH");
  assert.equal(effectiveClaimCountry("TH", MYR), "TH");
  assert.equal(effectiveClaimCountry("MY", MYR), "MY");
  assert.equal(effectiveClaimCountry(" my ", MYR), "MY");
  // A country that was never on the picker; a forged post, not a choice.
  assert.equal(effectiveClaimCountry("JP", MYR), "TH");
});

/**
 * The recovery path. An admin switching a currency off — or removing it — must
 * not strand a draft that already holds `MY`: the picker disappears, so there
 * would be no control on screen to change it back.
 */
test("a draft naming a country the brand has since withdrawn resolves to Thailand", () => {
  assert.equal(effectiveClaimCountry("MY", STAGED), "TH");
  assert.equal(effectiveClaimCountry("MY", NOTHING), "TH");
  assert.equal(effectiveClaimCountry("MY", null), "TH");
});

/**
 * Thailand short-circuits before the brand is consulted at all, so the server's
 * `resolveClaimCountry` can skip its pool read for the ordinary claim.
 */
test("Thailand resolves without needing a brand", () => {
  assert.equal(effectiveClaimCountry("TH", null), "TH");
  assert.equal(effectiveClaimCountry("th", undefined), "TH");
});

/* ── What a line's currency control offers ── */

/** The load-bearing one: Thailand renders no currency control anywhere. */
test("Thailand offers no line currency choice at all", () => {
  assert.deepEqual(lineCurrencyOptions("TH"), []);
  assert.deepEqual(lineCurrencyOptions(null), []);
  assert.deepEqual(lineCurrencyOptions(undefined), []);
  assert.deepEqual(lineCurrencyOptions(""), []);
  // A country the list does not know is not a licence to invent a currency.
  assert.deepEqual(lineCurrencyOptions("ZZ"), []);
});

test("a foreign country offers its own currency and baht, in that order", () => {
  assert.deepEqual(lineCurrencyOptions("MY"), ["MYR", "THB"]);
  assert.deepEqual(lineCurrencyOptions("jp"), ["JPY", "THB"]);
  assert.deepEqual(lineCurrencyOptions("FR"), ["EUR", "THB"]);
});

/* ── Which control asks the question ── */

/**
 * Two options is what the design actually produces, and it is the case the
 * segmented control exists for: a `<select>` for two answers hides half the
 * question behind a click, on the control a requester touches once per receipt.
 */
test("the two options a country produces are asked as segments", () => {
  assert.equal(usesCurrencySegments(lineCurrencyOptions("MY")), true);
  assert.equal(usesCurrencySegments(["MYR", "THB"]), true);
  assert.equal(usesCurrencySegments(["GBP"]), true);
});

/**
 * **Thailand is not "a control with no options"** — it is no control at all,
 * which is the promise the whole feature is held to. Callers still test
 * `options.length > 0` first; this only ever decides *which* control.
 */
test("Thailand asks for no control of either kind", () => {
  assert.equal(usesCurrencySegments([]), false);
  assert.equal(usesCurrencySegments(lineCurrencyOptions("TH")), false);
});

/**
 * Above the threshold it degrades to the dropdown rather than wrapping into a
 * strip. The line's money cell is 192px wide on a phone and cannot grow — it
 * shares the row with the receipt tile and the delete button — so a fourth
 * segment leaves each about 45px, which is not a control anybody can hit.
 *
 * Nothing reaches this today: `lineCurrencyOptions` answers two codes and never
 * more. It is here because that is a property of one function rather than of
 * the design, and a control that degrades on its own beats one that has to be
 * remembered about.
 */
test("above the threshold the question goes back to a dropdown", () => {
  assert.equal(LINE_CURRENCY_SEGMENT_MAX, 3);
  assert.equal(usesCurrencySegments(["MYR", "SGD", "THB"]), true);
  assert.equal(usesCurrencySegments(["MYR", "SGD", "GBP", "THB"]), false);
  assert.equal(usesCurrencySegments(["A", "B", "C", "D", "E"]), false);
});

test("a Thai claim's every line is baht, whatever the line says", () => {
  assert.equal(effectiveLineCurrency(null, "TH"), "THB");
  assert.equal(effectiveLineCurrency("MYR", "TH"), "THB");
  assert.equal(effectiveLineCurrency("MYR", null), "THB");
});

/**
 * **A line with no recorded currency is unanswered, not defaulted.** The read
 * fills the currency in when it can tell, and leaves it blank when it cannot;
 * blanking has to mean something the form can then insist on, which resolving
 * to the country's own currency would have destroyed — a line nobody had priced
 * would have been converted as ringgit because somebody named Malaysia.
 */
test("a line with no currency is unanswered rather than defaulted", () => {
  assert.equal(effectiveLineCurrency(null, "MY"), null);
  assert.equal(effectiveLineCurrency("", "MY"), null);
  assert.equal(effectiveLineCurrency("MYR", "MY"), "MYR");
  assert.equal(effectiveLineCurrency("myr", "MY"), "MYR");
  assert.equal(effectiveLineCurrency("THB", "MY"), "THB");
});

/**
 * A currency the country does not offer — a draft whose country was changed, a
 * brand code this trip could not have been in, a hand-shaped request — is a
 * question, never an assumption. Calling a foreign figure baht converts nothing
 * and shows nothing, which is the silent failure the feature exists to prevent;
 * calling it ringgit on no evidence is the same failure the other way round.
 */
test("a currency the country does not offer is unanswered", () => {
  assert.equal(effectiveLineCurrency("GBP", "MY"), null);
  assert.equal(effectiveLineCurrency("USD", "JP"), null);
});

test("resolveLineCurrency is the same rule against a ready-made option list", () => {
  assert.equal(resolveLineCurrency("THB", ["MYR", "THB"]), "THB");
  assert.equal(resolveLineCurrency("GBP", ["MYR", "THB"]), null);
  assert.equal(resolveLineCurrency(null, ["MYR", "THB"]), null);
  // No options at all is Thailand, where there is no question to leave open.
  assert.equal(resolveLineCurrency("MYR", []), "THB");
  assert.equal(resolveLineCurrency(null, []), "THB");
});

/* ── Which lines the submit refuses ── */

/**
 * The rule the whole blank state exists for: a claim may not be filed carrying
 * a figure nobody has said the currency of.
 */
test("a figure with no currency is refused; an empty row is not", () => {
  const opts = ["MYR", "THB"];
  assert.equal(lineNeedsCurrency({ amount: 0, foreignAmount: 20 }, opts), true);
  assert.equal(lineNeedsCurrency({ amount: 0, currency: "GBP", foreignAmount: 20 }, opts), true);
  // A row written before this claim was foreign: its typed figure is the baht.
  assert.equal(lineNeedsCurrency({ amount: 55 }, opts), true);
  // Blank rows are added freely and are nobody's problem until they carry money.
  assert.equal(lineNeedsCurrency({ amount: 0 }, opts), false);
  assert.equal(lineNeedsCurrency({ amount: 0, foreignAmount: 0 }, opts), false);
  // Answered, either way.
  assert.equal(lineNeedsCurrency({ amount: 164.47, currency: "MYR", foreignAmount: 20 }, opts), false);
  assert.equal(lineNeedsCurrency({ amount: 55, currency: "THB" }, opts), false);
});

/** Thailand can never produce one — it has no control to leave unanswered. */
test("a Thai claim never needs a line currency", () => {
  assert.equal(lineNeedsCurrency({ amount: 55 }, []), false);
  assert.equal(lineNeedsCurrency({ amount: 0, foreignAmount: 20 }, []), false);
});

/* ── The line's four fields ── */

/**
 * The identity branch. A Thai line consults no rate and applies no rounding, so
 * its arithmetic is bit-identical to what it was before migration 129.
 */
test("a baht line passes the figure straight through and records no currency", () => {
  assert.deepEqual(lineMoney(20, "THB", 8.25, []), {
    amount: 20,
    currency: null,
    exchangeRate: null,
    foreignAmount: null,
  });
  // Even a rate of null cannot disturb it — that is what keeps an FX outage
  // from touching the Thai claims that are almost all of them.
  assert.deepEqual(lineMoney(1234.56, "THB", null, []), {
    amount: 1234.56,
    currency: null,
    exchangeRate: null,
    foreignAmount: null,
  });
});

/**
 * On a claim that offers a choice, choosing baht is an **answer** and has to be
 * written down as one — otherwise it is indistinguishable from a line nobody
 * has priced, and the submit would refuse a line whose currency the requester
 * had positively picked.
 */
test("a baht line on a foreign claim records THB, so the answer survives a reload", () => {
  assert.deepEqual(lineMoney(20, "THB", 8.25, ["MYR", "THB"]), {
    amount: 20,
    currency: "THB",
    exchangeRate: null,
    foreignAmount: null,
  });
});

test("a foreign line keeps the typed figure and previews the baht", () => {
  assert.deepEqual(lineMoney(20, "MYR", 8.2235, ["MYR", "THB"]), {
    amount: 164.47,
    currency: "MYR",
    exchangeRate: 8.2235,
    foreignAmount: 20,
  });
});

/**
 * The receipt read's blank answer. The figure is kept — it was legible — and no
 * baht is claimed for it, because nobody knows what it is worth. `amount` at 0
 * is the truth here rather than a failed preview, and the submit refuses the
 * line until somebody says.
 */
test("an unanswered currency banks the typed figure and no baht", () => {
  assert.deepEqual(lineMoney(20, null, 8.2235, ["MYR", "THB"]), {
    amount: 0,
    currency: null,
    exchangeRate: null,
    foreignAmount: 20,
  });
});

/**
 * **Never the unconverted figure.** Returning 20 there would put a ringgit
 * number under a baht total with nothing on screen to reveal it. Zero is
 * visibly wrong beside the `—` the row then shows, and the server's own
 * conversion corrects it on the next save.
 */
test("a foreign line with no rate previews zero, not the foreign figure", () => {
  const opts = ["MYR", "THB"];
  assert.deepEqual(lineMoney(20, "MYR", null, opts), {
    amount: 0,
    currency: "MYR",
    exchangeRate: null,
    foreignAmount: 20,
  });
  assert.equal(lineMoney(20, "MYR", 0, opts).amount, 0);
  assert.equal(lineMoney(20, "MYR", -1, opts).amount, 0);
});

test("a non-finite figure is zero rather than NaN", () => {
  assert.equal(lineMoney(Number.NaN, "THB", null, []).amount, 0);
  assert.equal(lineMoney(Number.NaN, "MYR", 8.25, ["MYR", "THB"]).foreignAmount, 0);
  assert.equal(lineMoney(Number.NaN, null, null, ["MYR", "THB"]).foreignAmount, 0);
});

test("zero converts to zero — a nil line is a real figure, not an absent one", () => {
  assert.deepEqual(lineMoney(0, "MYR", 8.25, ["MYR", "THB"]), {
    amount: 0,
    currency: "MYR",
    exchangeRate: 8.25,
    foreignAmount: 0,
  });
});

/** Which field the input reads from, so a foreign row never shows the baht. */
test("the input shows what was typed, from whichever field holds it", () => {
  const opts = ["MYR", "THB"];
  assert.equal(typedLineFigure({ amount: 164.47, currency: "MYR", foreignAmount: 20 }, opts), 20);
  assert.equal(typedLineFigure({ amount: 55, currency: "THB", foreignAmount: null }, opts), 55);
  // No options at all — the Thailand case, where `amount` is the typed figure.
  assert.equal(typedLineFigure({ amount: 55, currency: "MYR", foreignAmount: 20 }, []), 55);
  // Unanswered: the read banked its figure in `foreignAmount`.
  assert.equal(typedLineFigure({ amount: 0, foreignAmount: 20 }, opts), 20);
  // Unanswered, and written before the claim was foreign: `amount` holds it.
  // Showing 0 would take money off a form its owner had already filled in.
  assert.equal(typedLineFigure({ amount: 55 }, opts), 55);
});

/* ── Switching Thailand off, and the default that replaces it (131) ──────── */

function withDefault(
  code: string,
  countryCode: string | null,
  id = 9,
): BrandCurrencyEntry {
  return { id, countryCode, currencyCode: code, isEnabled: true, isDefault: true };
}

/** A disabled THB row is the only thing that takes Thailand off the picker. */
const NO_BAHT = {
  currencies: [
    { id: 1, countryCode: "TH", currencyCode: "THB", isEnabled: false } as BrandCurrencyEntry,
    entry("MYR", true, 2),
  ],
};

/** An *enabled* THB row changes nothing — baht was always claimable. */
const EXPLICIT_BAHT = {
  currencies: [
    { id: 1, countryCode: "TH", currencyCode: "THB", isEnabled: true } as BrandCurrencyEntry,
    entry("MYR", true, 2),
  ],
};

test("a disabled THB row takes Thailand off the picker", () => {
  assert.deepEqual(claimCountryOptions(NO_BAHT), ["MY"]);
});

test("an enabled THB row leaves the picker exactly as it was", () => {
  assert.deepEqual(claimCountryOptions(EXPLICIT_BAHT), ["TH", "MY"]);
});

/**
 * The reason a default had to exist at all: with Thailand off there is nowhere
 * to fall back to, and the picker has to open on something the brand offers.
 */
test("with baht off the form opens on what the brand does offer", () => {
  assert.equal(defaultClaimCountry(NO_BAHT), "MY");
  assert.equal(effectiveClaimCountry(null, NO_BAHT), "MY");
  assert.equal(effectiveClaimCountry("", NO_BAHT), "MY");
  // A draft written while Thailand was still on, or a hand-made body.
  assert.equal(effectiveClaimCountry("TH", NO_BAHT), "MY");
});

test("Thailand stays the default wherever it is offered and nothing is marked", () => {
  assert.equal(defaultClaimCountry(NOTHING), "TH");
  assert.equal(defaultClaimCountry(MYR), "TH");
  assert.equal(defaultClaimCountry(EXPLICIT_BAHT), "TH");
  assert.equal(defaultClaimCountry(null), "TH");
});

/**
 * A marked row wins over Thailand even where Thailand is still on: that is the
 * whole point of being able to mark one.
 */
test("a marked row wins over Thailand", () => {
  const brand = { currencies: [withDefault("MYR", "MY", 1)] };
  assert.deepEqual(claimCountryOptions(brand), ["TH", "MY"]);
  assert.equal(defaultClaimCountry(brand), "MY");
  assert.equal(effectiveClaimCountry("", brand), "MY");
  // …and an explicit choice of Thailand is still honoured, because it is offered.
  assert.equal(effectiveClaimCountry("TH", brand), "TH");
});

/**
 * One currency, several countries. The row records which of them the admin
 * picked, so `EUR` marked from Germany does not open the form on the
 * Netherlands merely because that sorts first.
 */
test("the marked row's own country decides, not the first that shares its currency", () => {
  assert.equal(defaultClaimCountry({ currencies: [withDefault("EUR", "DE", 1)] }), "DE");
  // With no country recorded, the currency is read back through the table and
  // the first offered country answers.
  assert.equal(defaultClaimCountry({ currencies: [withDefault("EUR", null, 1)] }), "NL");
});

/**
 * The dangling pointer this feature exists to remove. `reconcileDefault` clears
 * such a flag as it disables the row; this proves a *read* is correct even
 * where that has not happened — a row edited directly in SQL.
 */
test("a default flag on a disabled row is ignored, not followed", () => {
  const brand = {
    currencies: [
      { id: 1, countryCode: "MY", currencyCode: "MYR", isEnabled: false, isDefault: true } as BrandCurrencyEntry,
      entry("GBP", true, 2),
    ],
  };
  assert.deepEqual(claimCountryOptions(brand), ["TH", "GB"]);
  assert.equal(defaultClaimCountry(brand), "TH");
});

/**
 * Both halves of the "pixel-identical" promise, restated against the default:
 * a brand nobody has configured offers one country and opens on it, so the
 * picker still renders nothing.
 */
test("an unconfigured brand still offers exactly Thailand", () => {
  assert.deepEqual(claimCountryOptions(NOTHING), ["TH"]);
  assert.equal(defaultClaimCountry(NOTHING), DEFAULT_COUNTRY);
  assert.equal(effectiveClaimCountry("", NOTHING), DEFAULT_COUNTRY);
});

/**
 * A brand nobody can claim against is what the settings writes refuse to
 * create. If one reaches a form anyway, it must open somewhere rather than on
 * nothing.
 */
test("a brand offering nothing still answers Thailand", () => {
  const broken = {
    currencies: [
      { id: 1, countryCode: "TH", currencyCode: "THB", isEnabled: false } as BrandCurrencyEntry,
      entry("MYR", false, 2),
    ],
  };
  assert.deepEqual(claimCountryOptions(broken), []);
  assert.equal(defaultClaimCountry(broken), DEFAULT_COUNTRY);
  assert.equal(effectiveClaimCountry("MY", broken), DEFAULT_COUNTRY);
});
