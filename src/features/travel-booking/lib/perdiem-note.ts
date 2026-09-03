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

import { fmtYmdDisplay } from "@/features/accounting/lib/format-travel-dates";

export type PerDiemSource = "country" | "employee";

/**
 * The footnote about where the FINAL figure comes from.
 *
 * It must not name HR for a trip a country rate prices. The server re-derives
 * through the same `perDiemLogFor` at submit, so whichever source the estimate
 * landed on is the one the stored figure will use — naming the other would
 * promise a number from a table nobody is going to read.
 */
function perDiemFootnote(source: PerDiemSource): string {
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

/**
 * Which rate priced the trip, as the CARD has to say it — four states, not
 * `perDiemLogFor`'s two.
 *
 * Its `source` answers "which log did I read", which is the right question for
 * the submit and the wrong one for a sentence. `"employee"` comes back both when
 * the answer is settled — Thailand, or a country nobody has configured — and
 * while the rates are still arriving, and a card that cannot tell those apart
 * asserts HR in the same breath as `foreignPending` withholds the money for not
 * knowing. `countryCode` is null on that branch by design, so the destination
 * has to travel separately from the priced country.
 */
export type PerDiemAttribution =
  | { kind: "country"; countryCode: string }
  | { kind: "home" }
  | { kind: "unconfigured"; countryCode: string }
  | { kind: "pending"; countryCode: string };

/** One line naming the rate in use, or saying why there is not one yet. */
export function perDiemAttributionNote(
  a: PerDiemAttribution,
  countryLabel: string | null | undefined,
): string {
  const label = (countryLabel ?? "").trim();
  if (a.kind === "country") {
    return label
      ? `ใช้เบี้ยเลี้ยงที่บริษัทกำหนดไว้สำหรับ ${label}`
      : "ใช้เบี้ยเลี้ยงที่บริษัทกำหนดไว้สำหรับประเทศปลายทาง";
  }
  if (a.kind === "unconfigured") {
    const who = label || a.countryCode;
    return `ยังไม่ได้กำหนดเบี้ยเลี้ยงสำหรับ ${who} — ใช้เบี้ยเลี้ยงตามข้อมูล HR ของผู้ขอเบิก`;
  }
  if (a.kind === "pending") return "กำลังตรวจสอบเรทเบี้ยเลี้ยงของประเทศปลายทาง...";
  return "ใช้เบี้ยเลี้ยงตามข้อมูล HR ของผู้ขอเบิก";
}

/**
 * The footnote about where the FINAL figure comes from.
 *
 * Only a configured country rate drops HR. An **unconfigured** foreign country
 * really is priced from the employee's allowance, so its footnote still names
 * HR — the note above is what says a rate is missing, and the two must not both
 * try to carry that.
 */
export function perDiemAttributionFootnote(a: PerDiemAttribution): string {
  if (a.kind === "country") return perDiemFootnote("country");
  if (a.kind === "pending") {
    return "* ยอดจริงคำนวณเมื่อกด “ส่งคำขอ” หลังระบบตรวจเรทของประเทศปลายทางแล้ว";
  }
  return perDiemFootnote("employee");
}

/**
 * The configured rate **and the day it starts**, summarised from its log alone —
 * stated before any date is typed, which is the state this was asked for.
 *
 * `computePerDiem` needs dates to produce a breakdown; naming the rate does not,
 * and a requester who has just picked a country wants to know what it pays.
 *
 * **The date is not decoration.** A rate only applies from its own effective
 * date, and `rateForDay` pays **0** for any day before the earliest one
 * (`perdiem.ts:24-32`) — so a requester who sees `฿2,500 ต่อวัน` with no date
 * cannot tell whether their trip is covered by it. With several dated rates,
 * each figure carries its own day, because which one applies is decided by the
 * travel dates and two bare amounts do not say that.
 *
 * More than two is summarised by its ends rather than listed: this is one line
 * under a total, and the breakdown above already itemises what a given trip is
 * actually charged.
 *
 * The log arrives sorted ascending by date — `perDiemCountryLog` sorts it — and
 * is `perDiemLogFor`'s own pick, never a second scan of every country's rates.
 */
export function configuredRateNote(
  log: readonly { effectiveDate: string; amount: number }[],
): string | null {
  if (log.length === 0) return null;
  const money = (n: number) =>
    "฿" + n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const on = (ymd: string) => `(มีผล ${fmtYmdDisplay(ymd)})`;
  const first = log[0];
  if (log.length === 1) return `${money(first.amount)} ต่อวัน ${on(first.effectiveDate)}`;
  const last = log[log.length - 1];
  return (
    `${money(first.amount)} ${on(first.effectiveDate)}` +
    ` → ${money(last.amount)} ${on(last.effectiveDate)} ต่อวัน`
  );
}
