import type { TravelExpenseDetail } from "@/features/accounting/types";
import { allDayItems, hasRateVehicle, normalizeTravelDay } from "@/features/accounting/lib/travel-sections";

function sum(items: { itemType: string; amount: number }[], type: string): number {
  return items.filter((i) => i.itemType === type).reduce((a, b) => a + (Number(b.amount) || 0), 0);
}

/** Total distance (km) — rate vehicle only. Manual vehicles enter fares directly. */
export function computeTotalDistance(d: TravelExpenseDetail): number {
  const day = normalizeTravelDay(d);
  if (!hasRateVehicle(day)) return Number(day.totalDistanceKm) || 0;
  const onward = day.direction === "return" ? 0 : Number(day.onwardDistanceKm) || 0;
  const ret = day.direction === "onward" ? 0 : Number(day.returnDistanceKm) || 0;
  return onward + ret;
}

/**
 * Grand total for one travel day — rate vehicle + all manual sections.
 *
 * **Thai baht**, on everything written since migration 129. The items it adds
 * are `AccTravelExpenseItem.Amount`, which is baht whatever currency the line
 * was typed in — `request-service.ts` converts each line on the way in and
 * refuses the save rather than storing an unconverted figure. The `km × rate`
 * branch is baht × baht for the same reason it always was.
 *
 * That invariant is why this function never learned what a currency is, and it
 * is what every other summer in the application depends on. **The one exception
 * is a claim filed during migration 125's request-level design**, where the
 * items hold the claim's own currency and only `AccRequest.TotalAmount` was
 * converted; those rows still carry `AccRequest.Currency`, and the display
 * surfaces that read it (`amountInBaht` in `@/lib/acc/currency-display`) are
 * what keep them from being misread as baht.
 */
export function computeTotalAmount(d: TravelExpenseDetail): number {
  const day = normalizeTravelDay(d);
  let total = 0;

  if (hasRateVehicle(day)) {
    const toll = sum(day.items, "toll");
    const parking = sum(day.items, "parking");
    const km = computeTotalDistance(day);
    const rate = Number(day.ratePerKm) || 0;
    total += km * rate + toll + parking;
  }

  for (const sec of day.sections ?? []) {
    if (sec.isManualEntry) {
      total += sum(sec.items, "fare") + sum(sec.items, "toll");
    }
  }

  if ((!day.sections || day.sections.length === 0) && day.isManualEntry) {
    total += sum(day.items, "fare") + sum(day.items, "toll");
  }

  return total;
}

/** Sum distance across all travel days. */
export function computeRequestTotalDistance(days: TravelExpenseDetail[]): number {
  let total = 0;
  for (const d of days) total += computeTotalDistance(d);
  return total;
}

/** Sum amount across all travel days. */
export function computeRequestTotalAmount(days: TravelExpenseDetail[]): number {
  let total = 0;
  for (const d of days) total += computeTotalAmount(d);
  return total;
}

/** All expense rows on a day (rate + manual sections) — for receipt validation. */
export { allDayItems };
