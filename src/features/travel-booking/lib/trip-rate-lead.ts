import { fmtYmdDisplay } from "@/features/accounting/lib/format-travel-dates";
import type { DatedRateLike, TripRateSegment } from "./trip-rate-segments";

function money(n: number): string {
  return "฿" + n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * The segments that are an actual configured rate.
 *
 * **A null-dated segment is the ABSENCE of a rate, not a ฿0 one.** Every
 * configured amount is greater than zero by the table's CHECK, restated in
 * `perdiem-country.ts`, so those days must not count toward "how many rates does
 * this trip fall under", must not set the low end of the range, and must not
 * raise a history button on a trip that really falls under a single rate. They
 * get `unratedNote` instead, which says what they are.
 */
export function ratedSegments(segments: readonly TripRateSegment[]): TripRateSegment[] {
  const out: TripRateSegment[] = [];
  for (const s of segments) if (s.effectiveDate !== null) out.push(s);
  return out;
}

/**
 * The one line beside the history button — what this trip is charged per day, or
 * null when no configured rate reaches it at all.
 *
 * A single rate carries its effective date, which the requester asked for and
 * which the first version of this dropped. More than one gives the range and
 * leaves the leg-by-leg breakdown to the dialog; repeating every leg here would
 * make the button pointless.
 *
 * The range is by VALUE rather than by date order, so a rate that falls still
 * reads low-to-high.
 */
export function tripRateLead(segments: readonly TripRateSegment[]): string | null {
  const rated = ratedSegments(segments);
  if (rated.length === 0) return null;
  if (rated.length === 1) {
    const only = rated[0];
    return `${money(only.amount)} ต่อวัน (มีผล ${fmtYmdDisplay(only.effectiveDate as string)})`;
  }
  let lo = rated[0].amount;
  let hi = rated[0].amount;
  for (const s of rated) {
    if (s.amount < lo) lo = s.amount;
    if (s.amount > hi) hi = s.amount;
  }
  if (lo === hi) return `${money(lo)} ต่อวัน (เปลี่ยนระหว่างทริป)`;
  return `${money(lo)} – ${money(hi)} ต่อวัน (เปลี่ยนระหว่างทริป)`;
}

/**
 * The sentence for days no configured rate reaches — worth ฿0, and the only
 * thing that explains a total the requester cannot otherwise account for.
 *
 * A null-dated segment can only ever be the FIRST: `entryForDay` returns the
 * latest entry on or before a day, so once a day passes the earliest rate every
 * later day matches one too. "Unrated" is a leading prefix, never a hole, which
 * is why the copy can say `N วันแรก`.
 *
 * `log` names the day the rate does start. For a trip wholly before it, no
 * segment carries that date — the rate is outside the trip by construction — so
 * it is read from the country's own list. This is what replaced the deleted
 * `จะเริ่มใช้` line, which was the only remedy for that state.
 */
export function unratedNote(
  segments: readonly TripRateSegment[],
  log: readonly DatedRateLike[] = [],
): string | null {
  const first = segments.length > 0 ? segments[0] : null;
  if (!first || first.effectiveDate !== null) return null;

  let starts: string | null = null;
  const rated = ratedSegments(segments);
  if (rated.length > 0) starts = rated[0].effectiveDate;
  else {
    for (const e of log) if (starts === null || e.effectiveDate < starts) starts = e.effectiveDate;
  }

  const whole = rated.length === 0;
  const head = whole
    ? "ทุกวันของทริปนี้ยังไม่มีเรทที่มีผลครอบคลุม จึงคิดเป็น ฿0"
    : `${first.days} วันแรกยังไม่มีเรทที่มีผลครอบคลุม จึงคิดเป็น ฿0`;
  return starts ? `${head} — เรทเริ่มมีผล ${fmtYmdDisplay(starts)}` : head;
}
