/**
 * Whether a trip's days collide with another request of the same person.
 *
 * **One shared day is allowed, and only at the boundary**: the previous trip's
 * return date may equal the new trip's depart date, or the reverse. That is the
 * continuation case — the day is worked once and paid once, and
 * `continuation-chain.ts` drops it from the later trip. Everything else is a
 * duplicate and the submit is refused.
 *
 * Deliberately NOT folded into `continuation-chain.ts`, which reasons about the
 * same touching ranges: that one decides what a day is worth, this one decides
 * whether a submit is allowed. One code path would let a change meant for one
 * silently move the other.
 *
 * Pure and import-free so it is unit-tested without a database.
 */

export interface OtherTrip {
  requestId: number;
  /** Null on a Draft, which has no running number yet. */
  requestNo: string | null;
  departDate: string;
  returnDate: string;
  /**
   * False once Cancelled or Rejected. **A dead trip blocks nothing** — it will
   * never be paid, so it cannot own a day, and refusing a re-file because of
   * the request it replaces is exactly the situation a re-file exists for.
   *
   * The test lives here rather than in the caller's filter so it is a rule with
   * a unit test rather than a line someone can drop from a query.
   */
  alive: boolean;
}

export interface OverlapRefusal {
  /** The first day, in `YYYY-MM-DD`, that both trips claim. */
  date: string;
  requestId: number;
  requestNo: string | null;
  otherDepart: string;
  otherReturn: string;
  /** Thai, ready to show. Names the day and the request it collided with. */
  message: string;
}

/** `YYYY-MM-DD` -> `DD/MM/YYYY`, the format every AP-17 screen shows. */
function thaiDate(ymd: string): string {
  return `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
}

/**
 * Every day of an inclusive range, as `YYYY-MM-DD`.
 *
 * String comparison is safe and intended here: both ends are already fixed-width
 * `YYYY-MM-DD`, so lexicographic order is chronological order, and no `Date` is
 * constructed — which keeps this free of the timezone question entirely.
 */
function daysOf(depart: string, ret: string): string[] {
  const out: string[] = [];
  const start = new Date(`${depart}T00:00:00`);
  const end = new Date(`${ret}T00:00:00`);
  const cur = new Date(start.getTime());
  while (cur <= end) {
    const m = `${cur.getMonth() + 1}`.padStart(2, "0");
    const d = `${cur.getDate()}`.padStart(2, "0");
    out.push(`${cur.getFullYear()}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/** True when the only thing the two ranges share is one boundary day. */
function touchesOnlyAtBoundary(
  candidate: { departDate: string; returnDate: string },
  other: OtherTrip,
): boolean {
  // The candidate starts the day the other ends, or ends the day the other
  // starts — and is not itself a single day sitting on that boundary, which
  // shares the day without continuing anything.
  if (candidate.departDate === candidate.returnDate) return false;
  if (other.departDate === other.returnDate) return false;
  return (
    (candidate.departDate === other.returnDate && candidate.returnDate > other.returnDate) ||
    (candidate.returnDate === other.departDate && candidate.departDate < other.departDate)
  );
}

export function findDateOverlap(
  candidate: { departDate: string; returnDate: string },
  others: readonly OtherTrip[],
): OverlapRefusal | null {
  const mine = daysOf(candidate.departDate, candidate.returnDate);

  let best: OverlapRefusal | null = null;
  for (const other of others) {
    if (!other.alive) continue;
    if (touchesOnlyAtBoundary(candidate, other)) continue;
    const theirs = daysOf(other.departDate, other.returnDate);
    for (const day of mine) {
      if (theirs.indexOf(day) < 0) continue;
      // The FIRST shared day wins, across every colliding trip — the reader is
      // pointed at the start of their problem, not at whichever row the
      // database happened to return first.
      if (best && best.date <= day) break;
      const who = other.requestNo ?? "คำขอฉบับร่าง";
      best = {
        date: day,
        requestId: other.requestId,
        requestNo: other.requestNo,
        otherDepart: other.departDate,
        otherReturn: other.returnDate,
        message:
          `วันที่ ${thaiDate(day)} ซ้ำกับ ${who} ` +
          `(${thaiDate(other.departDate)}–${thaiDate(other.returnDate)})`,
      };
      break;
    }
  }
  return best;
}
