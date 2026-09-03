/**
 * Which dated per-diem rates a chosen trip falls under, and for how many days
 * each.
 *
 * **This is not `computePerDiem`'s `groups`, and cannot be built from it.** That
 * groups by the rate's AMOUNT — a `Map<number, number>` keyed on the value
 * (`perdiem.ts:75-83`) — which answers "which distinct figures, and how many days
 * each". Right for a one-line breakdown, wrong for a history: two dated rates
 * carrying the same amount collapse into one entry, a rate returned to after a
 * change merges with its earlier stretch, and no entry carries a date at all.
 *
 * The day walk mirrors `computePerDiem` exactly — inclusive range, local date
 * parsing, `isContinuation` dropping the first day — so the segments always sum
 * to what the engine charges. A test asserts that rather than trusting it.
 *
 * Imports nothing, so the rule is unit-testable: anything reachable from a pool
 * drags `@/env` in, which validates the whole environment at import.
 */

export interface DatedRateLike {
  /** `YYYY-MM-DD`. */
  effectiveDate: string;
  amount: number;
}

export interface TripRateSegment {
  /**
   * The rate's own effective date, or **null for days no rate reaches**.
   *
   * `rateForDay` answers 0 when no entry's date has arrived (`perdiem.ts:24-32`),
   * so a trip beginning before the earliest configured rate really is paid
   * nothing for those days. They get their own segment rather than being folded
   * into the first real one, because a total nobody can account for is worse
   * than a line saying ฿0.
   */
  effectiveDate: string | null;
  amount: number;
  days: number;
}

/** Parse `YYYY-MM-DD` into a local Date — never `new Date(string)`, which is UTC. */
function parseKey(key: string): Date {
  const parts = key.split("-");
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}

function toKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The log entry in force on `day`, or null when none has started. */
function entryForDay(day: string, log: readonly DatedRateLike[]): DatedRateLike | null {
  let best: DatedRateLike | null = null;
  for (const e of log) {
    if (e.effectiveDate > day) continue;
    if (!best || e.effectiveDate > best.effectiveDate) best = e;
  }
  return best;
}

export function tripRateSegments(
  departDate: string | null | undefined,
  returnDate: string | null | undefined,
  isContinuation: boolean,
  log: readonly DatedRateLike[],
): TripRateSegment[] {
  if (!departDate || !returnDate || returnDate < departDate) return [];

  const days: string[] = [];
  const cursor = parseKey(departDate);
  const end = parseKey(returnDate);
  while (cursor <= end) {
    days.push(toKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  const counted = isContinuation ? days.slice(1) : days;

  const out: TripRateSegment[] = [];
  for (const d of counted) {
    const entry = entryForDay(d, log);
    const effectiveDate = entry ? entry.effectiveDate : null;
    const amount = entry ? entry.amount : 0;
    const last = out.length > 0 ? out[out.length - 1] : null;
    // Consecutive days extend the segment they belong to. Keyed on the effective
    // DATE, not the amount: two dated rates at the same figure are two segments,
    // which is the distinction `groups` cannot make.
    if (last && last.effectiveDate === effectiveDate) last.days += 1;
    else out.push({ effectiveDate, amount, days: 1 });
  }
  return out;
}
