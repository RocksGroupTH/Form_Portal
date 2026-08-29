import { test } from "node:test";
import assert from "node:assert/strict";
import { computeTotalDistance } from "./calc";
import type { TravelExpenseDetail } from "@/features/accounting/types";

/** A rate-based day with both legs measured — `vehicleId` set and not manual entry. */
function day(direction: string): TravelExpenseDetail {
  return {
    vehicleId: 1,
    ratePerKm: 3.5,
    isManualEntry: false,
    direction,
    onwardDistanceKm: 12,
    returnDistanceKm: 8,
    items: [],
  } as unknown as TravelExpenseDetail;
}

test("ไป-กลับ counts both legs", () => {
  assert.equal(computeTotalDistance(day("round")), 20);
});

/**
 * The reason this file exists. The form showed onward + return regardless of
 * direction, while this function — which the payable amount is computed from —
 * drops the unused leg. So picking ขาไป displayed 20 km and paid for 12.
 */
test("ขาไป counts the onward leg only", () => {
  assert.equal(computeTotalDistance(day("onward")), 12);
});

test("ขากลับ counts the return leg only", () => {
  assert.equal(computeTotalDistance(day("return")), 8);
});

test("a missing leg contributes nothing rather than NaN", () => {
  const d = day("round");
  (d as unknown as { returnDistanceKm: number | null }).returnDistanceKm = null;
  assert.equal(computeTotalDistance(d), 12);
});

/** A manual-entry vehicle has no measured legs — the typed total is the answer. */
test("a manual vehicle uses its own typed total, whatever the direction says", () => {
  const d = {
    isManualEntry: true,
    direction: "onward",
    totalDistanceKm: 40,
    onwardDistanceKm: 12,
    returnDistanceKm: 8,
    items: [],
  } as unknown as TravelExpenseDetail;
  assert.equal(computeTotalDistance(d), 40);
});

import { dayCostBreakdown, computeTotalAmount } from "./calc";

/** A day with a rate vehicle and a manual Grab section. */
function mixedDay(): TravelExpenseDetail {
  return {
    vehicleId: 1,
    vehicleName: "รถยนต์",
    ratePerKm: 5,
    isManualEntry: false,
    direction: "round",
    onwardDistanceKm: 10,
    returnDistanceKm: 10,
    items: [
      { itemType: "toll", amount: 60 },
      { itemType: "parking", amount: 40 },
    ],
    sections: [
      {
        vehicleId: 2,
        vehicleName: "Grab",
        isManualEntry: true,
        items: [
          { itemType: "fare", amount: 150 },
          { itemType: "toll", amount: 25 },
        ],
      },
    ],
  } as unknown as TravelExpenseDetail;
}

/**
 * The property that matters more than any individual label: a breakdown whose
 * parts do not add up to the figure printed beside them is worse than no
 * breakdown, because it invites somebody to trust the wrong number.
 */
test("the parts always sum to computeTotalAmount", () => {
  for (const d of [mixedDay(), day("onward"), day("return"), day("round")]) {
    const parts = dayCostBreakdown(d);
    const summed = parts.reduce((a, p) => a + p.amount, 0);
    assert.equal(Math.round(summed * 100) / 100, Math.round(computeTotalAmount(d) * 100) / 100);
  }
});

test("a mixed day names the rate vehicle, its extras and each manual section", () => {
  const parts = dayCostBreakdown(mixedDay());
  const labels = parts.map((p) => p.label);
  assert.ok(labels.some((l) => l.indexOf("รถยนต์") !== -1), labels.join(" | "));
  assert.ok(labels.some((l) => l.indexOf("ทางด่วน") !== -1), labels.join(" | "));
  assert.ok(labels.some((l) => l.indexOf("จอดรถ") !== -1), labels.join(" | "));
  assert.ok(labels.some((l) => l.indexOf("Grab") !== -1), labels.join(" | "));
});

test("the mileage part shows the distance and the rate it was priced at", () => {
  const km = dayCostBreakdown(mixedDay()).find((p) => p.label.indexOf("รถยนต์") !== -1);
  assert.ok(km);
  assert.equal(km.amount, 100); // 20 km x 5
  assert.equal(km.detail, "20 กม. × 5 บาท");
});

/** Nothing spent is nothing listed — a row of zeroes is noise, not information. */
test("parts worth nothing are left out", () => {
  const d = mixedDay();
  (d as unknown as { items: unknown[] }).items = [];
  const labels = dayCostBreakdown(d).map((p) => p.label);
  assert.equal(labels.some((l) => l.indexOf("ทางด่วน") !== -1), false);
  assert.equal(labels.some((l) => l.indexOf("จอดรถ") !== -1), false);
});

test("an empty day breaks down to nothing at all", () => {
  const empty = { items: [], sections: [] } as unknown as TravelExpenseDetail;
  assert.deepEqual(dayCostBreakdown(empty), []);
});
