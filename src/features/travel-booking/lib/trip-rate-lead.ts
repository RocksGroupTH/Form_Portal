import type { TripRateSegment } from "./trip-rate-segments";

/**
 * The one line beside the history button — what this trip is charged per day.
 *
 * A single segment is the whole answer, and there is no button next to it. More
 * than one says a change lands inside the trip and gives the range, leaving the
 * leg-by-leg breakdown to the dialog; repeating every leg here would make the
 * button pointless.
 *
 * The range is by VALUE rather than by date order, so a rate that falls still
 * reads low-to-high. Days no rate reaches count as ฿0 and stay in the range:
 * they are what makes a total look wrong, and a line implying the trip was paid
 * throughout would hide exactly that.
 */
export function tripRateLead(segments: readonly TripRateSegment[]): string {
  if (segments.length === 0) return "—";
  const money = (n: number) =>
    "฿" + n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let lo = segments[0].amount;
  let hi = segments[0].amount;
  for (const s of segments) {
    if (s.amount < lo) lo = s.amount;
    if (s.amount > hi) hi = s.amount;
  }
  if (segments.length === 1 || lo === hi) return `${money(lo)} ต่อวัน`;
  return `${money(lo)} – ${money(hi)} ต่อวัน (เปลี่ยนระหว่างทริป)`;
}
