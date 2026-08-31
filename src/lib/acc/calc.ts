import type { TravelExpenseDetail } from "@/features/accounting/types";
import { allDayItems, hasRateVehicle, normalizeTravelDay } from "@/features/accounting/lib/travel-sections";
import { summariseLineCurrency } from "./expense-currency-summary";
import { fmtAmountWithCurrency } from "./currency-display";

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

/** One named part of a day's cost, for the summary breakdown. */
export interface DayCostPart {
  label: string;
  /** How the figure was arrived at, where that is not obvious. `null` otherwise. */
  detail: string | null;
  /** Thai baht, like everything `computeTotalAmount` adds. */
  amount: number;
}

/**
 * What a day's total is made of, itemised.
 *
 * **Deliberately built branch-for-branch alongside `computeTotalAmount`**, and
 * `calc.test.ts` asserts the parts sum to it for every shape. A breakdown whose
 * parts do not add up to the figure printed beside them is worse than no
 * breakdown at all: it invites somebody to trust the wrong number, and the two
 * would drift the first time either function learned a new cost.
 *
 * Zero-value parts are omitted. A list of `0.00` rows is noise, and the reader
 * is looking for where the money went.
 */
export function dayCostBreakdown(d: TravelExpenseDetail): DayCostPart[] {
  const day = normalizeTravelDay(d);
  const parts: DayCostPart[] = [];
  const push = (label: string, amount: number, detail: string | null = null) => {
    if (amount > 0) parts.push({ label, detail, amount });
  };
  const trim = (n: number) => Math.round(n * 100) / 100;

  /**
   * What a manual vehicle's rows were paid in, when they were all paid in the
   * same foreign currency. `null` for baht rows and for a mixed block —
   * `summariseLineCurrency` refuses to describe a block whose lines cannot be
   * added, and the caller then names the vehicle alone. See that module for why
   * a header must not borrow one line's currency.
   */
  const foreignDetail = (items: { foreignAmount?: number | null; currency?: string | null }[]) => {
    const s = summariseLineCurrency(items);
    return s.currency && s.foreignTotal != null
      ? fmtAmountWithCurrency(s.foreignTotal, s.currency)
      : null;
  };

  if (hasRateVehicle(day)) {
    const km = computeTotalDistance(day);
    const rate = Number(day.ratePerKm) || 0;
    const name = day.vehicleName ?? "รถ";
    push(name, trim(km * rate), `${trim(km)} กม. × ${trim(rate)} บาท`);
    push(`ค่าผ่านทาง / ทางด่วน (${name})`, trim(sum(day.items, "toll")));
    push(`ค่าจอดรถ (${name})`, trim(sum(day.items, "parking")));
  }

  for (const sec of day.sections ?? []) {
    if (!sec.isManualEntry) continue;
    push(
      sec.vehicleName ?? "พาหนะ",
      trim(sum(sec.items, "fare") + sum(sec.items, "toll")),
      foreignDetail(sec.items ?? []),
    );
  }

  // The legacy shape: one manual vehicle, no sections.
  if ((!day.sections || day.sections.length === 0) && day.isManualEntry) {
    push(
      day.vehicleName ?? "พาหนะ",
      trim(sum(day.items, "fare") + sum(day.items, "toll")),
      foreignDetail(day.items ?? []),
    );
  }

  return parts;
}
