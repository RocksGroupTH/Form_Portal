/**
 * Pure date-math helpers shared by every Accounting payment calendar.
 *
 * Deliberately free of any database import (contrast with payment-calendar.ts,
 * which pulls in getCorePool for the holiday lookup): src/lib/db/mssql.ts reads
 * @/env at module scope, so anything that statically imports it — even just to
 * reach an unrelated named export — fails immediately outside a Next.js request
 * unless every MSSQL_* / AUTH_SECRET var is already in process.env, which the
 * test runner (tsx, no .env loading) never sets. Keeping nthFridayOfMonth and
 * ymd here, with no import chain back to the DB layer, is what lets AP-4's
 * payment-calendar tests (src/lib/acc/reimburse/payment-calendar.test.ts) run
 * as plain unit tests. src/lib/acc/payment-calendar.ts (AP-1) re-exports both
 * from here unchanged, so this is a relocation, not a behaviour change.
 */

export function nthFridayOfMonth(year: number, month0: number, nth: number): Date {
  const d = new Date(year, month0, 1);
  const offset = (5 - d.getDay() + 7) % 7; // 5 = Friday
  return new Date(year, month0, 1 + offset + (nth - 1) * 7);
}

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
