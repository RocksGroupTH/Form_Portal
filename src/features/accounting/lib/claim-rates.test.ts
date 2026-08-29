import { test } from "node:test";
import assert from "node:assert/strict";
import { claimRateFacts, multiRateCurrencies } from "./claim-rates";
import type { TravelExpenseDetail, TravelExpenseItem } from "@/features/accounting/types";

/**
 * What the detail page is allowed to say about a filed claim's exchange rates.
 *
 * Every case here is a shape a real claim can be in, and the ones that matter
 * most are the two that are easy to render as a comfortable lie: a claim with
 * two rates for one currency, and a rate whose date nobody recorded.
 */

function item(p: Partial<TravelExpenseItem>): TravelExpenseItem {
  return {
    itemType: "fare",
    amount: 100,
    sortOrder: 0,
    ...p,
  } as TravelExpenseItem;
}

function day(items: TravelExpenseItem[]): TravelExpenseDetail {
  return { items, sections: [] } as unknown as TravelExpenseDetail;
}

/* ── A Thai claim says nothing at all ── */

/**
 * The promise the whole currency feature is held to. A baht claim must render
 * precisely the markup it rendered before any of this existed, and the only way
 * to keep that checkable is for the source of the extra markup to be empty.
 */
test("a baht claim has no rate facts", () => {
  const days = [day([item({ amount: 500 }), item({ itemType: "toll", amount: 60 })])];
  assert.deepEqual(claimRateFacts(days), []);
});

test("an explicit THB line is baht too, and contributes nothing", () => {
  const days = [day([item({ currency: "THB", exchangeRate: 1, foreignAmount: 500 })])];
  assert.deepEqual(claimRateFacts(days), []);
});

test("nothing at all is not an error", () => {
  assert.deepEqual(claimRateFacts(null), []);
  assert.deepEqual(claimRateFacts(undefined), []);
  assert.deepEqual(claimRateFacts([]), []);
});

/* ── The ordinary foreign claim ── */

test("one currency at one rate collapses to a single fact", () => {
  const days = [
    day([
      item({ currency: "MYR", exchangeRate: 8.1856, foreignAmount: 20, rateAsOf: "2026-08-22", rateSource: "ECB" }),
      item({ itemType: "toll", currency: "MYR", exchangeRate: 8.1856, foreignAmount: 5, rateAsOf: "2026-08-22", rateSource: "ECB" }),
    ]),
  ];
  const facts = claimRateFacts(days);
  assert.equal(facts.length, 1);
  assert.equal(facts[0].currency, "MYR");
  assert.equal(facts[0].rate, 8.1856);
  assert.equal(facts[0].asOf, "2026-08-22");
  assert.equal(facts[0].source, "ECB");
  assert.deepEqual(facts[0].lines, ["ค่าโดยสาร", "ค่าผ่านทาง"]);
  assert.deepEqual(multiRateCurrencies(facts), []);
});

test("the code is upper-cased and trimmed, however it was stored", () => {
  const days = [day([item({ currency: " myr ", exchangeRate: 8.1, foreignAmount: 20 })])];
  assert.equal(claimRateFacts(days)[0].currency, "MYR");
});

/** A day number on a single-day claim is noise — there is only one day it could be. */
test("a single-day claim names lines without a day number", () => {
  const days = [day([item({ currency: "MYR", exchangeRate: 8.1, foreignAmount: 20 })])];
  assert.deepEqual(claimRateFacts(days)[0].lines, ["ค่าโดยสาร"]);
});

test("a multi-day claim names the day each line is on", () => {
  const days = [
    day([item({ currency: "MYR", exchangeRate: 8.1, foreignAmount: 20, rateAsOf: "2026-08-22" })]),
    day([item({ itemType: "parking", currency: "MYR", exchangeRate: 8.1, foreignAmount: 5, rateAsOf: "2026-08-22" })]),
  ];
  const facts = claimRateFacts(days);
  assert.equal(facts.length, 1);
  assert.deepEqual(facts[0].lines, ["วันที่ 1 · ค่าโดยสาร", "วันที่ 2 · ค่าจอดรถ"]);
});

/* ── More than one rate on one claim ── */

/**
 * The case the module exists for: a draft saved on one day and submitted on
 * another converts its lines at two different rates, both correctly. Printing
 * either one alone would state something false about the other line.
 */
test("the same currency at two rates is two facts, each naming its own lines", () => {
  const days = [
    day([
      item({ currency: "MYR", exchangeRate: 8.1856, foreignAmount: 20, rateAsOf: "2026-08-03", rateSource: "ECB" }),
      item({ itemType: "toll", currency: "MYR", exchangeRate: 8.2401, foreignAmount: 5, rateAsOf: "2026-08-10", rateSource: "ECB" }),
    ]),
  ];
  const facts = claimRateFacts(days);
  assert.equal(facts.length, 2);
  assert.deepEqual(facts.map((f) => f.rate), [8.1856, 8.2401]);
  assert.deepEqual(facts[0].lines, ["ค่าโดยสาร"]);
  assert.deepEqual(facts[1].lines, ["ค่าผ่านทาง"]);
  assert.deepEqual(multiRateCurrencies(facts), ["MYR"]);
});

/**
 * Same number, different day. These are two different facts about the claim and
 * must not be merged: which day a figure was priced on is exactly what
 * migration 130 exists to record, and a merge would throw one of the two away.
 */
test("one rate quoted on two days stays two facts", () => {
  const days = [
    day([
      item({ currency: "MYR", exchangeRate: 8.1856, foreignAmount: 20, rateAsOf: "2026-08-03" }),
      item({ itemType: "toll", currency: "MYR", exchangeRate: 8.1856, foreignAmount: 5, rateAsOf: "2026-08-10" }),
    ]),
  ];
  const facts = claimRateFacts(days);
  assert.equal(facts.length, 2);
  assert.deepEqual(facts.map((f) => f.asOf), ["2026-08-03", "2026-08-10"]);
  assert.deepEqual(multiRateCurrencies(facts), ["MYR"]);
});

/**
 * A hand-corrected rate is one person's figure and is reproducible from no feed
 * at all, so it must never be folded into a published one — even at the same
 * number on the same day.
 */
test("an overridden line is its own fact even at an identical rate and day", () => {
  const days = [
    day([
      item({ currency: "MYR", exchangeRate: 8.1856, foreignAmount: 20, rateAsOf: "2026-08-22", rateSource: "ECB" }),
      item({ itemType: "toll", currency: "MYR", exchangeRate: 8.1856, foreignAmount: 5, rateAsOf: "2026-08-22", rateSource: "OVERRIDE" }),
    ]),
  ];
  const facts = claimRateFacts(days);
  assert.equal(facts.length, 2);
  assert.deepEqual(facts.map((f) => f.source), ["ECB", "OVERRIDE"]);
});

/** Two currencies is ordinary and needs no explaining — only a repeat does. */
test("two different currencies are two facts but not a multi-rate currency", () => {
  const days = [
    day([
      item({ currency: "MYR", exchangeRate: 8.1856, foreignAmount: 20, rateAsOf: "2026-08-22" }),
      item({ itemType: "toll", currency: "SGD", exchangeRate: 25.4, foreignAmount: 5, rateAsOf: "2026-08-22" }),
    ]),
  ];
  const facts = claimRateFacts(days);
  assert.equal(facts.length, 2);
  assert.deepEqual(multiRateCurrencies(facts), []);
});

/* ── What was never recorded ── */

/**
 * Every line written before migration 130 reads null, and that is the truth
 * rather than a gap. A fact with no date must survive as a fact — the rate is
 * still what the claim used — so the surface can print the rate and stay silent
 * about the day.
 */
test("a line with no recorded date is still a fact, with a null date", () => {
  const days = [day([item({ currency: "MYR", exchangeRate: 8.1856, foreignAmount: 20 })])];
  const facts = claimRateFacts(days);
  assert.equal(facts.length, 1);
  assert.equal(facts[0].rate, 8.1856);
  assert.equal(facts[0].asOf, null);
  assert.equal(facts[0].source, null);
});

/** A foreign line the provider never priced is a real state, and it is named. */
test("a foreign line with no rate at all is reported as a null rate", () => {
  const days = [day([item({ currency: "MYR", foreignAmount: 20 })])];
  const facts = claimRateFacts(days);
  assert.equal(facts.length, 1);
  assert.equal(facts[0].rate, null);
});

test("a non-finite stored rate is treated as no rate, never as NaN", () => {
  const days = [day([item({ currency: "MYR", exchangeRate: Number.NaN, foreignAmount: 20 })])];
  assert.equal(claimRateFacts(days)[0].rate, null);
});

/* ── The manual-section shape ── */

/**
 * A Grab block's rows live under `sections`, not on the day, and they are the
 * lines most likely to be foreign. `allDayItems` is what flattens both shapes,
 * and using it is what keeps this from seeing only half a claim.
 */
test("lines inside a manual vehicle section are read too", () => {
  const days = [
    {
      items: [],
      sections: [
        {
          vehicleId: 2,
          vehicleName: "Grab",
          isManualEntry: true,
          items: [item({ currency: "MYR", exchangeRate: 8.1, foreignAmount: 20, rateAsOf: "2026-08-22" })],
        },
      ],
    } as unknown as TravelExpenseDetail,
  ];
  const facts = claimRateFacts(days);
  assert.equal(facts.length, 1);
  assert.deepEqual(facts[0].lines, ["ค่าโดยสาร"]);
});
