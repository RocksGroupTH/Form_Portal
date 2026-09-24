/**
 * The three parts of AP-17 a person on the roster can be given or refused.
 *
 * **These are stored in COLUMNS on the roster row — `CanQueue`, `CanAccount`
 * and `CanReport` (migration 124) — and NOT in `AccBookingApproverTab`.** That
 * is the whole point of this module, and it is a correction rather than a
 * preference: until 2026-09-24 this application kept its own menu vocabulary
 * (`bookingQueue` / `accountApproval`) as rows in that child table while **ACC
 * Portal, reading the same `AccBookingApprover` rows in the same database**,
 * had been using these columns since 2026-08-29. Two apps, one roster, two
 * answers to one question.
 *
 * **Measured 2026-09-24, in both form databases**: the columns said six people
 * could work the booking queue and six the sign-off; our table held **two rows
 * in total**. So the รออนุมัติโดย card named one person per step and — once the
 * tick became real authority earlier that same day — the routes refused
 * everybody else, while the admin who had ticked them in ACC Portal had every
 * reason to think the job was done.
 *
 * **The sharper half was silent data loss.** ACC Portal's own
 * `setBookingApproverTabs` deletes an approver's whole tab set and rewrites it
 * through a filter that knows **settings tabs only**, so every time an admin
 * ticked a settings tab over there, our two menu rows were deleted. While the
 * tick meant "sees a menu" that cost a menu; once it meant "may approve", the
 * same click silently revoked AP-17 approval authority in this app.
 *
 * **Columns rather than a child table**, which is migration 124's own argument
 * and worth keeping: `AccBookingApproverTab` grows with every new settings
 * `[kind]`, so its rows must be able to name keys the schema has never heard
 * of. These three are the module's three menu items — fixed, each mapping to
 * one page and the routes behind it. A child table would model an open set that
 * is not open, and cost a join on the read that gates every request in.
 *
 * **They default to 1, and that is the safe direction HERE and nowhere else in
 * this schema.** `AccBookingApproverTab` and `AccReimburseAccess` both document
 * that no rows means no grants, never "all", because they hand out something
 * the person did not previously have. These do not: being on
 * `AccBookingApprover` already opened all three, so defaulting to 0 would have
 * taken that away from everyone the moment 124 landed.
 *
 * Imports nothing at runtime, so the vocabulary is unit-testable: anything
 * reachable from a pool drags `@/env` in, which validates the whole environment
 * at import and throws in the test runner. The pool half is
 * `./booking-approver-areas`.
 */

export type BookingAreaKey = "queue" | "account" | "report";

/**
 * The roster column each key is stored in — the SQL and the keys in one place,
 * so a fourth area cannot be added without somewhere to put it.
 *
 * **These spellings are ACC Portal's and must not be "tidied".** They are the
 * shared contract between the two applications; renaming one here renames
 * nothing over there and silently splits the answer again.
 */
export const BOOKING_AREA_COLUMN: Record<BookingAreaKey, string> = {
  queue: "CanQueue",
  account: "CanAccount",
  report: "CanReport",
};

/**
 * The tick columns, in the order the สิทธิ์เข้าถึง grid shows them — which is
 * the order of the menu itself: fill the booking in, sign it off, then read
 * about it.
 *
 * **`account` reads "อนุมัติ (HR)" where ACC Portal's reads "อนุมัติ (บัญชี)",
 * and that is deliberate.** The user renamed AP-17's ACCOUNT step to HR on
 * 2026-09-24 ("AP-17 จะเป็น step ที่ชื่อบัญชีเป็น HR แทน") — a decision about
 * this application's copy, taken the same day as this move. The *key* and the
 * *column* are shared; the wording is ours.
 */
export const BOOKING_AREAS: ReadonlyArray<{
  key: BookingAreaKey;
  /** Column header in the สิทธิ์เข้าถึง grid. */
  label: string;
  /** What the page is actually called — for tooltips and refusal copy. */
  pageTitle: string;
}> = [
  { key: "queue", label: "คิวจอง", pageTitle: "คิวจองที่พัก/ตั๋วโดยสาร" },
  { key: "account", label: "อนุมัติ (HR)", pageTitle: "อนุมัติจองที่พัก/ตั๋วโดยสาร (HR)" },
  { key: "report", label: "รายงาน", pageTitle: "รายงานการจองที่พัก/ตั๋วโดยสาร" },
];

const ALL_KEYS: Record<string, true> = {};
for (const a of BOOKING_AREAS) ALL_KEYS[a.key] = true;

export function isBookingAreaKey(value: unknown): value is BookingAreaKey {
  return typeof value === "string" && ALL_KEYS[value] === true;
}

/**
 * The keys worth storing out of whatever a client posted.
 *
 * Order comes from `BOOKING_AREAS`, not from the request, so what is written
 * never depends on the order the boxes happened to be ticked; duplicates
 * collapse and anything unrecognised is dropped. The client's list is a
 * request, not a decision — the rule `filterGrantableBookingTabKeys` applies to
 * the settings tabs.
 */
export function filterBookingAreaKeys(raw: unknown): BookingAreaKey[] {
  if (!Array.isArray(raw)) return [];
  const wanted: Record<string, true> = {};
  for (const v of raw) if (isBookingAreaKey(v)) wanted[v] = true;
  return BOOKING_AREAS.filter((a) => wanted[a.key] === true).map((a) => a.key);
}
