import { test } from "node:test";
import assert from "node:assert/strict";
import {
  displayDayAmountBaht,
  displayDayAmountCell,
  type TravelTableSourceRow,
} from "./expand-travel-table-rows";
import type { ReportTravelDayLine } from "@/lib/acc/report-service";

function day(totalAmount: number): ReportTravelDayLine {
  return {
    travelDate: "2026-08-28",
    totalAmount,
    vehicleNames: [],
    vehicles: [],
    workDetail: null,
  };
}

const bahtRow: TravelTableSourceRow = { id: 1, totalAmount: 900 };
const foreignRow: TravelTableSourceRow = {
  id: 2,
  totalAmount: 825, // baht — AccRequest.TotalAmount, already converted
  currency: "MYR",
  exchangeRate: 8.25,
};

/**
 * The claim's own figure and the baht figure are different questions, and the
 * ERP prep queue asks both on one row: what was spent, and what will post.
 */
test("the raw cell stays in the claim's own currency", () => {
  assert.equal(displayDayAmountCell(foreignRow, day(100), null), 100);
  assert.equal(displayDayAmountCell(foreignRow, day(100), { vehicleName: "รถยนต์", amount: 40 }), 40);
});

test("a foreign day figure converts at the row's stored rate", () => {
  assert.equal(displayDayAmountBaht(foreignRow, day(100), null), 825);
  assert.equal(
    displayDayAmountBaht(foreignRow, day(100), { vehicleName: "รถยนต์", amount: 40 }),
    330,
  );
});

/** The invariant: a baht claim's table cannot move by a satang. */
test("a baht row is untouched — no rate read, no rounding applied", () => {
  assert.equal(displayDayAmountBaht(bahtRow, day(123.45), null), 123.45);
  assert.equal(displayDayAmountBaht(bahtRow, null, null), 900);
  assert.equal(displayDayAmountBaht({ id: 3, totalAmount: null }, null, null), null);
});

/**
 * `row.totalAmount` is `AccRequest.TotalAmount`, which is already baht. Passing
 * it through the converter would multiply by the rate a second time.
 */
test("the request-level fallback is never converted twice", () => {
  assert.equal(displayDayAmountBaht(foreignRow, null, null), 825);
});

/** Never the unconverted figure: that is a ringgit number under a ฿ heading. */
test("a foreign day figure with no rate is null, not itself", () => {
  const noRate: TravelTableSourceRow = { id: 4, totalAmount: 0, currency: "MYR", exchangeRate: null };
  assert.equal(displayDayAmountBaht(noRate, day(100), null), null);
  assert.equal(displayDayAmountCell(noRate, day(100), null), 100);
});
