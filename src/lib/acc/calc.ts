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

/** Grand total (baht) — rate vehicle + all manual sections. */
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
