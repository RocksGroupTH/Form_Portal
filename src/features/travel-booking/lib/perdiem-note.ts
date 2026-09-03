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

export interface DatedRate {
  effectiveDate: string;
  amount: number;
}

/**
 * The country's rates split into what is in force, what is coming, and what is
 * gone — the shape the card needs to show one figure and fold the rest.
 */
export interface PerDiemRateSummary {
  current: DatedRate;
  /** The next rate, if one is dated ahead of `today`. Never folded away. */
  upcoming: DatedRate | null;
  /** Superseded rates, newest first. This is what the fold holds. */
  past: DatedRate[];
}

/**
 * Split a country's log around `today`.
 *
 * **`today` is a parameter, not a call to the clock**, so the rule is
 * unit-testable and so a caller cannot accidentally evaluate it in a different
 * zone — every date in these databases is a Thai wall clock (see CLAUDE.md).
 *
 * **Current is the newest rate whose date has ARRIVED**, which is what
 * `rateForDay` would pay today (`perdiem.ts:24-32`) and is not the same as the
 * newest row. The settings tab's `ใช้อยู่` takes the newest active row
 * regardless of date (`perdiem-rows.ts`), so on a day when a future rate exists
 * the two screens name different figures. That is deliberate here and the
 * settings one is the weaker label: a rate that starts next week is not what
 * anybody is being paid now.
 *
 * **Null means nothing is in force yet** — every rate is dated ahead — and that
 * is not the same as an empty log even though both return null: `rateForDay`
 * pays **0** for those days, so the card must not present the earliest future
 * rate as though it applied.
 *
 * Only ACTIVE rates ever reach here: `listPerDiemCountryRates` filters
 * `IsActive = 1` server-side, so a deactivated rate is never in the log and
 * needs no filtering — there is deliberately no `isActive` in `DatedRate`, so a
 * future reader cannot think one is expected.
 */
export function perDiemRateSummary(
  log: readonly DatedRate[],
  today: string,
): PerDiemRateSummary | null {
  const sorted = log.slice();
  sorted.sort((a, b) => (a.effectiveDate < b.effectiveDate ? -1 : a.effectiveDate > b.effectiveDate ? 1 : 0));

  let current: DatedRate | null = null;
  let currentIndex = -1;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].effectiveDate <= today) {
      current = sorted[i];
      currentIndex = i;
    }
  }
  if (!current) return null;

  const past: DatedRate[] = [];
  for (let i = currentIndex - 1; i >= 0; i--) past.push(sorted[i]);
  const upcoming = currentIndex + 1 < sorted.length ? sorted[currentIndex + 1] : null;
  return { current, upcoming, past };
}

function money(n: number): string {
  return "฿" + n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * The one figure the card states — the rate in force and the day it started.
 *
 * It showed the log's first and last as a span until 2026-09-03, which read as
 * two rates with no indication which was live. The date is not decoration: a
 * rate applies only from its own effective date and `rateForDay` pays 0 before
 * the earliest, so a bare figure cannot tell a requester whether their trip is
 * covered.
 */
export function configuredRateNote(summary: PerDiemRateSummary | null): string | null {
  if (!summary) return null;
  return `${money(summary.current.amount)} ต่อวัน (มีผล ${fmtYmdDisplay(summary.current.effectiveDate)})`;
}

/**
 * The next change, stated in full rather than folded away.
 *
 * A rate dated ahead is neither current nor `ย้อนหลัง`, and it may take effect
 * during the very trip being booked — putting it behind a history toggle would
 * hide the one future fact on the card that can change what the requester is
 * paid.
 */
export function upcomingRateNote(summary: PerDiemRateSummary | null): string | null {
  if (!summary?.upcoming) return null;
  return `จะเปลี่ยนเป็น ${money(summary.upcoming.amount)} ต่อวัน ตั้งแต่ ${fmtYmdDisplay(summary.upcoming.effectiveDate)}`;
}

/** The fold's label, counting the PAST alone — an upcoming rate is not history. */
export function historyToggleLabel(summary: PerDiemRateSummary | null): string | null {
  if (!summary || summary.past.length === 0) return null;
  return `ดูเรทย้อนหลัง (${summary.past.length})`;
}

/** One past rate, as the fold lists it. */
export function pastRateLine(rate: DatedRate): string {
  return `${money(rate.amount)} ต่อวัน · มีผล ${fmtYmdDisplay(rate.effectiveDate)}`;
}

/**
 * Today as `YYYY-MM-DD`, from local getters.
 *
 * `now` is a parameter for the reason `earliestTravelDate` takes one: the caller
 * owns the clock, so the rule stays testable. Local getters and not
 * `toISOString()`, which answers in UTC and at UTC+7 names yesterday for most of
 * the evening — the same trap CLAUDE.md records for every date in this app.
 */
export function todayKey(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
