/**
 * AP-17's payout date: when a travel-booking claim is scheduled to be paid.
 *
 * **Imports nothing**, so every rule here is unit-tested without a database —
 * anything reachable from a pool drags `@/env` in, which validates the whole
 * environment at import. It is also imported by the accounting queue, a client
 * component, so it must stay free of `next/headers` the way
 * `api-keys/codes.ts` records.
 *
 * **Strings in, strings out.** Dates arrive and leave as `"YYYY-MM-DD"` and are
 * compared as strings, which for that format is the same order as the calendar.
 * `Date` is constructed only for month arithmetic, never to *parse* an input —
 * so no rule here depends on the host's timezone and no test has to pin one.
 *
 * ── The rule ──
 *
 * One determining date, two country arms:
 *
 *   **D = the later of (manager approval date, travel return date)**
 *
 *   domestic  D.day <= 20         -> last day of D's month
 *             D.day >  20         -> last day of the NEXT month
 *
 *   foreign   D.day in 1..5       -> the 10th of D's OWN month
 *             D.day in 6..20      -> last day of D's month
 *             D.day in 21..end    -> the 10th of the NEXT month
 *
 * ── Why the determining date takes two inputs ──
 *
 * It replaces `computePayoutDate`, which read the approval date alone. Neither
 * single input reproduces the cases this was specified with: approval-alone
 * (i.e. the old behaviour) pays a trip returning on the 21st at the end of the
 * approval month, and return-alone pays a trip approved on the 21st at the end
 * of the return month. Both are wrong by a month, in opposite directions.
 *
 * Taking the later date and then applying the rule is the same answer as
 * applying the rule to each date and taking the later result — both arms are
 * monotone non-decreasing in D — so there is no third reading to choose
 * between.
 *
 * ── The two asymmetries a later editor will try to "fix" ──
 *
 * **Domestic has no 1..5 case.** It is a single split at the 20th; foreign has
 * three bands because it pays twice a month. Adding a 1..5 arm to domestic
 * would move real payments a month.
 *
 * **The foreign 21..5 band wraps across the month boundary, and its two halves
 * resolve to the same day.** 21 Sep and 3 Oct both pay on 10 Oct. That is what
 * makes the calendar continuous — 6-20 Sep pays 30 Sep, 21 Sep-5 Oct pays 10
 * Oct, 6-20 Oct pays 31 Oct — with every day covered exactly once. Confirmed
 * with the user 2026-09-04; no worked case exercised it.
 *
 * ── What this deliberately does NOT do ──
 *
 * **No weekend or holiday shifting.** AP-1 and AP-4 both step their payment day
 * backwards off a holiday through `shiftPaymentDay`; AP-17 never has, and the
 * user confirmed on 2026-09-04 that it should stay that way. A month end
 * already lands on a weekend regularly and nobody has asked for it to move.
 * Adding one would also pull a `Rocks_Codex.Holiday` read into a module whose
 * whole value is having no imports.
 */

export type PayoutTripKind = "domestic" | "foreign";

/** The round a payout date belongs to — what the queue's copy names it. */
export type PayoutRound = "month-end" | "tenth";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

const THAI_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Last day of `month1` (1-indexed) — `new Date(y, m1, 0)` is day zero of the
 * next month, which `Date` normalises to the previous month's last day. Passing
 * 13 therefore gives January of `y + 1` with no special case.
 */
function lastDayOfMonth(year: number, month1: number): string {
  return toYmd(new Date(year, month1, 0));
}

/** The 10th of `month1` (1-indexed); 13 rolls into January of the next year. */
function tenthOfMonth(year: number, month1: number): string {
  return toYmd(new Date(year, month1 - 1, 10));
}

function valid(ymd: string | null | undefined): string | null {
  const s = (ymd ?? "").trim();
  return YMD.test(s) ? s : null;
}

/**
 * Domestic or foreign, from `AccRequest.CountryCode`.
 *
 * **Absent means Thailand**, and that is load-bearing rather than lenient:
 * `CountryCode` was added by migration 129 with no backfill, so every AP-17
 * request filed before 2026-08-31 carries NULL — measured 2026-09-04, five of
 * the seven in UAT, including both rows sitting in the accounting queue, which
 * are Bangkok trips. Treating absence as "unknown" would make the whole back
 * catalogue unpayable. Same rule `isBaht` applies to a missing currency, for
 * the same reason.
 *
 * `CHAR(2)` pads, so a stored `"TH"` can come back as `"TH"` with trailing
 * space; the trim is not decoration.
 */
export function payoutTripKind(countryCode: string | null | undefined): PayoutTripKind {
  const c = (countryCode ?? "").trim().toUpperCase();
  return c === "" || c === "TH" ? "domestic" : "foreign";
}

/**
 * The later of the two dates, or null when either is missing or malformed.
 *
 * Null is a refusal, not a fallback to whichever date is present. Falling back
 * to the approval date alone would silently restore the old behaviour for
 * exactly the row whose data is broken, and the difference is a whole month.
 */
export function payoutDeterminingDate(
  approvalYmd: string | null | undefined,
  travelReturnYmd: string | null | undefined,
): string | null {
  const a = valid(approvalYmd);
  const r = valid(travelReturnYmd);
  if (!a || !r) return null;
  return a > r ? a : r;
}

/** The payout date for an already-resolved determining date. */
export function payoutDateForDetermining(
  kind: PayoutTripKind,
  determiningYmd: string | null | undefined,
): string | null {
  const d = valid(determiningYmd);
  if (!d) return null;
  const year = Number(d.slice(0, 4));
  const month1 = Number(d.slice(5, 7));
  const day = Number(d.slice(8, 10));

  if (kind === "domestic") {
    return day <= 20 ? lastDayOfMonth(year, month1) : lastDayOfMonth(year, month1 + 1);
  }
  if (day >= 6 && day <= 20) return lastDayOfMonth(year, month1);
  if (day >= 21) return tenthOfMonth(year, month1 + 1);
  // 1..5 — the tail of the previous month's 21st..5th band, so the SAME month's
  // 10th. See the header: this is the branch no worked case covered.
  return tenthOfMonth(year, month1);
}

/** The payout date for a request, or null when it cannot be computed. */
export function payoutDateFor(
  kind: PayoutTripKind,
  approvalYmd: string | null | undefined,
  travelReturnYmd: string | null | undefined,
): string | null {
  return payoutDateForDetermining(kind, payoutDeterminingDate(approvalYmd, travelReturnYmd));
}

/** Which round a date is, judged by its day alone. */
export function payoutRoundOf(ymd: string): PayoutRound {
  return Number(ymd.slice(8, 10)) === 10 ? "tenth" : "month-end";
}

/** `"31 ตุลาคม 2026"` — Thai month, Gregorian year, like every other date here. */
export function payoutDateLabel(ymd: string | null | undefined): string | null {
  const d = valid(ymd);
  if (!d) return null;
  const year = Number(d.slice(0, 4));
  const month1 = Number(d.slice(5, 7));
  const day = Number(d.slice(8, 10));
  if (month1 < 1 || month1 > 12) return null;
  return `${day} ${THAI_MONTHS[month1 - 1]} ${year}`;
}

export interface PayoutOption {
  /** `"YYYY-MM-DD"` — what the client posts back. A date, not a month. */
  date: string;
  round: PayoutRound;
  label: string;
}

/**
 * The payout dates accounting may choose between, for one kind of trip.
 *
 * **Concrete dates, not months** (the user's choice, 2026-09-04). The month
 * vocabulary this replaces could not express the 10th at all: `payoutMonthOptions`
 * posted a `"YYYY-MM"` token and the server derived that month's last day, so
 * "pick a month" had exactly one answer per month and the foreign rule has two.
 *
 * `alwaysInclude` exists for one specific row: the one whose own scheduled date
 * has already gone past. Without it the option list cannot contain the value the
 * row currently holds, so the `<select>` renders blank and the server — which
 * validates by membership of this same list — refuses the date it is already
 * storing. That is not hypothetical: recomputing an old row can produce a date
 * in the past when the trip and the approval are both months old.
 */
export function payoutOptions(
  kind: PayoutTripKind,
  fromYmd: string,
  months = 12,
  alwaysInclude?: string | null,
): PayoutOption[] {
  const from = valid(fromYmd);
  if (!from) return [];
  const year = Number(from.slice(0, 4));
  const month1 = Number(from.slice(5, 7));

  const dates: string[] = [];
  for (let i = 0; i < months; i++) {
    const anchor = new Date(year, month1 - 1 + i, 1);
    const y = anchor.getFullYear();
    const m = anchor.getMonth() + 1;
    if (kind === "foreign") dates.push(tenthOfMonth(y, m));
    dates.push(lastDayOfMonth(y, m));
  }

  const keep: string[] = [];
  for (let i = 0; i < dates.length; i++) {
    if (dates[i] >= from && keep.indexOf(dates[i]) === -1) keep.push(dates[i]);
  }
  const extra = valid(alwaysInclude);
  if (extra && keep.indexOf(extra) === -1) keep.push(extra);
  keep.sort();

  const out: PayoutOption[] = [];
  for (let i = 0; i < keep.length; i++) {
    out.push({
      date: keep[i],
      round: payoutRoundOf(keep[i]),
      label: payoutDateLabel(keep[i]) as string,
    });
  }
  return out;
}

/**
 * The rule, in Thai, for the queue page (the user's part 3).
 *
 * It lives here rather than in the component so the sentence on screen and the
 * date the server computes cannot drift — the shape
 * `perdiem-dependency-text.ts` already uses for the same reason.
 */
export const PAYOUT_RULE_LINES: Record<PayoutTripKind, string[]> = {
  domestic: [
    "วันที่ 1–20 → จ่ายสิ้นเดือนนั้น",
    "วันที่ 21–สิ้นเดือน → จ่ายสิ้นเดือนถัดไป",
  ],
  foreign: [
    "วันที่ 6–20 → จ่ายสิ้นเดือนนั้น",
    "วันที่ 21–5 (ข้ามเดือน) → จ่ายวันที่ 10",
  ],
};

/** The sentence that says which date the bands above are measured against. */
export const PAYOUT_DETERMINING_NOTE =
  "นับจากวันที่ช้ากว่า ระหว่างวันที่ผู้จัดการอนุมัติ กับวันที่เดินทางกลับ";

export const PAYOUT_KIND_LABEL: Record<PayoutTripKind, string> = {
  domestic: "ในประเทศ",
  foreign: "ต่างประเทศ",
};
