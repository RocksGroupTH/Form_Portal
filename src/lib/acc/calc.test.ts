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
