import { everyFridayInMonth, paymentRoundsInMonth } from "@/lib/acc/payment-calendar-core";
import type { FormCode } from "@/lib/form-environment/classify-path";

/**
 * The forms whose payday calendar lives here.
 *
 * Narrowed out of `FormCode` rather than respelled, so the two unions cannot
 * drift: a form code renamed there stops compiling here. `classify-path.ts` is
 * pure — no imports at all — so taking the type from it does not cost this
 * module its freedom from `@/env` (see the header of
 * `payment-calendar-core.ts` for why that freedom is load-bearing).
 *
 * AP-4 is deliberately absent: it pays on the 1st and 3rd Friday and keeps its
 * own calendar in `@/lib/acc/reimburse/payment-calendar`, which predates this
 * module and is not in its way.
 */
export type PaydayForm = Extract<FormCode, "AP-1" | "AP-2" | "AP-3">;

/**
 * Which Fridays a form pays on, in one place, so that "when does AP-2 pay?" is
 * answered by reading one function rather than by finding which caller passed
 * what.
 *
 * AP-2 moved to every Friday on 2026-09-24 (user's CR of 2026-09-23, item 1).
 * AP-1 and AP-3 did not, deliberately — the CR named AP-2 and the user confirmed
 * the scope when told the three forms shared one calendar.
 *
 * A `switch` with an exhaustiveness check, not a ternary on `"AP-2"`. The point
 * of making `form` mandatory everywhere was that no caller can inherit another
 * form's calendar by saying nothing; a ternary reintroduces exactly that at the
 * one place it matters most, because adding a fourth form to `PaydayForm`
 * compiles and silently pays it on the 2nd and 4th. The `never` assignment turns
 * that into a build error naming the form nobody decided a rule for, and the
 * throw covers the JavaScript caller the types cannot reach.
 */
export function paydaysInMonth(form: PaydayForm, year: number, month0: number): Date[] {
  switch (form) {
    case "AP-2":
      return everyFridayInMonth(year, month0);
    case "AP-1":
    case "AP-3":
      return paymentRoundsInMonth(year, month0, [2, 4]);
    default: {
      const unreachable: never = form;
      throw new Error(`Unknown payday form: ${String(unreachable)}`);
    }
  }
}
