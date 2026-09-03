/**
 * What the AP-17 form says about WHICH per-diem rate priced a trip.
 *
 * The figure was already right — `useTravelBookingForm` prices through
 * `perDiemLogFor` and the card renders its `groups` as `N วัน × ฿rate` — but
 * nothing said where the rate came from, and the footnote said the wrong thing
 * outright: every trip claimed its final figure would come from
 * `อัตราเบี้ยเลี้ยง...ในระบบ HR`, which is false for every trip a configured
 * country rate prices.
 *
 * `perdiem-country.ts` returns `source` for exactly this, and its header says
 * so: *"the form's note, the report's rate column and the recompute's audit row
 * all have to state which rate applied"*. The form was the one that did not.
 *
 * Imports nothing, so the wording is unit-testable.
 */

export type PerDiemSource = "country" | "employee";

/**
 * One line naming the rate in use, shown beside the estimate.
 *
 * The employee case says so rather than saying nothing: silence is what let the
 * HR footnote read as though it covered every trip.
 */
export function perDiemSourceNote(
  source: PerDiemSource,
  countryLabel: string | null | undefined,
): string {
  if (source === "employee") return "ใช้เบี้ยเลี้ยงตามข้อมูล HR ของผู้ขอเบิก";
  const label = (countryLabel ?? "").trim();
  return label
    ? `ใช้เบี้ยเลี้ยงที่บริษัทกำหนดไว้สำหรับ ${label}`
    : "ใช้เบี้ยเลี้ยงที่บริษัทกำหนดไว้สำหรับประเทศปลายทาง";
}

/**
 * The footnote about where the FINAL figure comes from.
 *
 * It must not name HR for a trip a country rate prices. The server re-derives
 * through the same `perDiemLogFor` at submit, so whichever source the estimate
 * landed on is the one the stored figure will use — naming the other would
 * promise a number from a table nobody is going to read.
 */
export function perDiemFootnote(source: PerDiemSource): string {
  return source === "country"
    ? "* ยอดจริงคำนวณจากเรทเบี้ยเลี้ยงของประเทศปลายทาง ตามวันที่เดินทาง เมื่อกด “ส่งคำขอ”"
    : "* ยอดจริงคำนวณจากอัตราเบี้ยเลี้ยงย้อนหลังตามวันที่ในระบบ HR เมื่อกด “ส่งคำขอ”";
}

/**
 * Whether any counted day was priced at nothing.
 *
 * `rateForDay` returns **0** when no entry's `effectiveDate` is `<= day`
 * (`perdiem.ts:24-32`), so a trip that starts before the earliest configured
 * rate has those days counted and paid nothing. The breakdown already shows it
 * as `1 วัน × ฿0.00` — a true statement that explains none of itself — and this
 * is what lets the card say why.
 *
 * Exactly zero, not "small": the table's CHECK keeps every configured amount
 * above zero, so a zero group can only be a day the log could not reach.
 */
export function hasUnratedDay(groups: readonly { rate: number; days: number }[]): boolean {
  for (const g of groups) if (g.rate === 0) return true;
  return false;
}

/** Shown beside a zero-rate day, naming the cause rather than the symptom. */
export const PER_DIEM_UNRATED_NOTE =
  "บางวันยังไม่มีเรทที่มีผลครอบคลุม จึงคิดเป็น ฿0 — ตรวจวันที่เริ่มมีผลของเรทที่ตั้งไว้";
