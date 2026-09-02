import { test } from "node:test";
import assert from "node:assert/strict";
import { perDiemCountryRows, type PerDiemRateLike } from "./perdiem-rows";

/**
 * The เบี้ยเลี้ยงต่างประเทศ tab lists a row per country up front and each is
 * saved on its own — there is no Add dialog to choose a country from.
 *
 * That makes "which countries get a row" a real rule rather than a rendering
 * detail, and it has two halves that pull in opposite directions: the countries
 * a trip can be filed against today, and the countries a rate already exists
 * for. A row list that showed only the first would hide a live rate the moment
 * a brand dropped a currency; only the second and the tab would be empty, which
 * is exactly the screen this replaced.
 */

const rate = (
  id: number,
  countryCode: string,
  effectiveDate: string,
  amount: number,
  isActive = true,
): PerDiemRateLike => ({ id, countryCode, effectiveDate, amount, note: null, isActive });

test("every reachable country gets a row, whether or not it has a rate", () => {
  const rows = perDiemCountryRows(["GB", "MY"], []);
  assert.deepEqual(rows.map((r) => r.countryCode), ["GB", "MY"]);
  assert.equal(rows[0].latest, null);
  assert.deepEqual(rows[0].history, []);
  assert.equal(rows[0].reachable, true);
});

/**
 * **A rate for a country no brand offers any more still gets a row.** Dropping a
 * currency from a brand does not unprice the trips already filed against it —
 * `listPerDiemCountryRates` has no idea which countries are reachable — so a row
 * that vanished would leave a live rate editable from nowhere.
 */
test("a country with a rate but no longer reachable keeps its row, marked", () => {
  const rows = perDiemCountryRows(["GB"], [rate(1, "JP", "2026-01-01", 2000)]);
  assert.deepEqual(rows.map((r) => r.countryCode), ["GB", "JP"]);
  assert.equal(rows[0].reachable, true);
  assert.equal(rows[1].reachable, false);
  assert.equal(rows[1].latest?.amount, 2000);
});

/** Reachable countries lead; the leftovers follow, so the list reads as the form's own. */
test("reachable countries come first, each half sorted", () => {
  const rows = perDiemCountryRows(
    ["MY", "GB"],
    [rate(1, "JP", "2026-01-01", 2000), rate(2, "DE", "2026-01-01", 3000)],
  );
  assert.deepEqual(rows.map((r) => r.countryCode), ["GB", "MY", "DE", "JP"]);
});

/**
 * `latest` is what is in force, and pricing only ever sees ACTIVE rates —
 * `listPerDiemCountryRates` filters on `IsActive = 1`. So a newer deactivated
 * rate must not be the one the row offers for editing, or the panel would show a
 * figure no trip is priced at.
 */
test("latest is the newest ACTIVE rate, not simply the newest", () => {
  const rows = perDiemCountryRows(
    ["GB"],
    [rate(1, "GB", "2026-01-01", 2000), rate(2, "GB", "2026-06-01", 2500, false)],
  );
  assert.equal(rows[0].latest?.id, 1);
  assert.equal(rows[0].latest?.amount, 2000);
});

test("with no active rate at all, latest is null but the history is kept", () => {
  const rows = perDiemCountryRows(["GB"], [rate(1, "GB", "2026-01-01", 2000, false)]);
  assert.equal(rows[0].latest, null);
  assert.equal(rows[0].history.length, 1);
});

/** Newest first: an admin reads the current rate before the ones it replaced. */
test("history is every rate for the country, newest first", () => {
  const rows = perDiemCountryRows(
    ["GB"],
    [
      rate(1, "GB", "2026-01-01", 2000),
      rate(3, "GB", "2026-09-01", 2800),
      rate(2, "GB", "2026-06-01", 2500),
    ],
  );
  assert.deepEqual(rows[0].history.map((h) => h.id), [3, 2, 1]);
  assert.equal(rows[0].latest?.id, 3);
});

/**
 * Thailand never gets a row. The employee's HR allowance answers there and
 * `upsertPerDiemCountryRate` refuses a TH row server-side, so offering one would
 * be a control whose every save fails.
 */
test("Thailand is never listed, however it arrives", () => {
  const rows = perDiemCountryRows(["TH", "GB"], [rate(1, "TH", "2026-01-01", 500)]);
  assert.deepEqual(rows.map((r) => r.countryCode), ["GB"]);
});

test("codes are normalised and never duplicated", () => {
  const rows = perDiemCountryRows([" gb ", "GB"], [rate(1, "gb", "2026-01-01", 2000)]);
  assert.deepEqual(rows.map((r) => r.countryCode), ["GB"]);
  assert.equal(rows[0].latest?.amount, 2000);
});

test("nothing reachable and nothing stored is an empty list, not a row", () => {
  assert.deepEqual(perDiemCountryRows([], []), []);
});
