import { everyFridayInMonth, paymentRoundsInMonth } from "@/lib/acc/payment-calendar-core";

/**
 * The forms whose payday calendar lives here.
 *
 * AP-4 is deliberately absent: it pays on the 1st and 3rd Friday and keeps its
 * own calendar in `@/lib/acc/reimburse/payment-calendar`, which predates this
 * module and is not in its way.
 */
export type PaydayForm = "AP-1" | "AP-2" | "AP-3";

/**
 * Which Fridays a form pays on, in one place, so that "when does AP-2 pay?" is
 * answered by reading one function rather than by finding which caller passed
 * what.
 *
 * AP-2 moved to every Friday on 2026-09-24 (user's CR of 2026-09-23, item 1).
 * AP-1 and AP-3 did not, deliberately — the CR named AP-2 and the user confirmed
 * the scope when told the three forms shared one calendar.
 */
export function paydaysInMonth(form: PaydayForm, year: number, month0: number): Date[] {
  return form === "AP-2"
    ? everyFridayInMonth(year, month0)
    : paymentRoundsInMonth(year, month0, [2, 4]);
}
