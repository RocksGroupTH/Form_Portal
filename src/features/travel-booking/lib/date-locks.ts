/**
 * Which days a trip's date picker must refuse, given the trips already booked.
 *
 * **A day holds two half-slots.** A trip's departure takes one and its return
 * takes one, so two trips can meet on a handover day — one arriving back, one
 * setting off. Every day strictly between departure and return is taken whole,
 * because the traveller is away for it. A day with no half left is refused.
 *
 * That counting is the whole rule, and it is what the previous version got
 * wrong: it disabled the interiors of other trips and left every endpoint open
 * for ever, so a third trip, and a fourth, could each claim the same day as a
 * handover. One day, four journeys starting or ending on it.
 *
 * Pure and import-free so it can be unit-tested: anything reachable from a
 * database pool drags `@/env` in, which validates the whole environment at
 * import time and throws in the test runner.
 */

/** A booked range. Either end may be missing while a draft is half-filled. */
export interface TravelRange {
  departDate: string | null;
  returnDate: string | null;
}

/** Both halves of a day. A day is refused once its count reaches this. */
const SLOTS_PER_DAY = 2;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * The days strictly between departure and return.
 *
 * Local getters throughout, and a `T00:00:00` suffix on the parse, so a date is
 * the calendar day it reads as rather than an instant that can slide across
 * midnight in another zone.
 */
function interiorDays(depart: string, ret: string): string[] {
  const out: string[] = [];
  const cur = new Date(`${depart}T00:00:00`);
  const end = new Date(`${ret}T00:00:00`);
  cur.setDate(cur.getDate() + 1);
  while (cur < end) {
    out.push(ymd(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/**
 * The dates to disable, in ascending order.
 *
 * A range missing either end, or ending before it starts, contributes nothing:
 * a half-filled draft must not start locking days out from under the person
 * still filling it in, and a reversed range is a state the picker prevents
 * rather than a claim to honour.
 */
export function lockedTravelDates(ranges: readonly TravelRange[]): string[] {
  const used = new Map<string, number>();
  const take = (date: string, slots: number) => {
    used.set(date, (used.get(date) ?? 0) + slots);
  };

  for (const range of ranges) {
    const depart = range.departDate;
    const ret = range.returnDate;
    if (!depart || !ret || ret < depart) continue;

    // A single-day trip departs and returns on the same date, so it takes both
    // halves — nobody else can meet it there, which is right: there is no
    // handover to make.
    take(depart, 1);
    take(ret, 1);
    for (const day of interiorDays(depart, ret)) take(day, SLOTS_PER_DAY);
  }

  const out: string[] = [];
  used.forEach((slots, date) => {
    if (slots >= SLOTS_PER_DAY) out.push(date);
  });
  return out.sort();
}
