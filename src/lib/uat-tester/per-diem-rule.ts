import type { AllowanceLogEntry } from "@/lib/acc/travel-booking/perdiem";

/**
 * A UAT tester's own per-diem rate log — the pure half of `UatTesterPerDiem`
 * (`Rocks_Portal_Form_UAT`, migrations 139/140 — this file never opens a pool
 * to read it).
 *
 * This file imports nothing at runtime (the one import is a type and is
 * erased), so the rules below are unit-tested with no database and no
 * environment — the split `perdiem-country.ts` / `perdiem-source.ts` already
 * uses, and for the same reason: `@/env` validates the whole environment at
 * import time, so anything reachable from a pool drags a live configuration
 * into the test run.
 */

/** Longest a Note may be — `UatTesterPerDiem.Note` is `nvarchar(300)`. */
export const UAT_PER_DIEM_NOTE_MAX = 300;

export interface UatPerDiemRateRow {
  id: number;
  staffId: number;
  /** 'YYYY-MM-DD', inclusive. */
  effectiveDate: string;
  /** Thai baht per day. Always > 0 — the table's CHECK, and `parseUatPerDiemInput`. */
  amount: number;
  note: string | null;
}

/**
 * This tester's effective-dated log, or `null` meaning "no override — fall back
 * to the employee's HR allowance". **Never an empty array.**
 *
 * `rateForDay` (`perdiem.ts:24-33`) answers 0 for a day no entry covers, so `[]`
 * would price every day of the trip at zero — a different claim from "this
 * tester has no override", on a path that writes `AccRequest.TotalAmount`.
 * `perDiemCountryLog` states the same rule in its own header.
 *
 * **Every stored row counts. The effective date is the only selector**, which is
 * exactly what `getAllowanceLog` does with `EmployeeAllowanceLog` — a table with
 * no such flag and a query with no filter. This function used to skip rows whose
 * `IsActive` was 0, and the column is gone (migration 143): switching a tester's
 * rates off did not blank a column somewhere, it removed the override entirely
 * and priced them at their real HR salary, silently, on the path that writes
 * `AccRequest.TotalAmount`.
 *
 * **So `null` is now reachable only from an empty input — and it is a one-way
 * door.** With no flag and no delete, a tester who has ever had a rate stored
 * can never be returned to HR pricing; the way to change what they are paid is
 * another dated row. The `mine.length === 0` guard below therefore looks
 * redundant and is not: it is the whole never-return-`[]` invariant, and
 * `uatPerDiemLogFrom([])` is a live call — `uatPerDiemLogsByStaffIds` builds a
 * per-StaffId array and hands it straight here.
 *
 * The result is a fresh, sorted array: the report hands one row set to many
 * trips, and sorting the caller's array in place would reorder somebody else's.
 */
export function uatPerDiemLogFrom(
  rows: readonly UatPerDiemRateRow[],
): AllowanceLogEntry[] | null {
  const mine: AllowanceLogEntry[] = [];
  for (const r of rows) {
    mine.push({ effectiveDate: r.effectiveDate, amount: r.amount });
  }
  if (mine.length === 0) return null;

  mine.sort((a, b) =>
    a.effectiveDate < b.effectiveDate ? -1 : a.effectiveDate > b.effectiveDate ? 1 : 0,
  );
  return mine;
}

/**
 * The most recently DATED rate this tester has, or `null` — what the UAT Users
 * grid prints in its เบี้ยเลี้ยง UAT column.
 *
 * **"Latest configured", deliberately not "in force today".** An AP-17 trip
 * cannot depart before tomorrow (`earliest-travel-date.ts`), so a rate dated
 * tomorrow is the one that will price the next trip that can exist — and the
 * rule this replaced hid it, leaving an admin who had just saved a rate looking
 * at the old figure, or at `—`. The caller pairs the date with the amount so a
 * future one can be labelled rather than passed off as today's.
 *
 * It is the ONLY reader on this rule. Two others answer "in force today" and are
 * right to: `withUatOverrides` (`src/lib/hr/employee-lookup.ts`), whose value is
 * stamped into `AllowanceSnapshot`, and the AP-17 form's wallet chip
 * (`useTravelBookingForm.ts`). Do not "align" them with this one.
 */
export function latestUatPerDiemRate(
  rows: readonly UatPerDiemRateRow[],
  staffId: number,
): { amount: number; effectiveDate: string } | null {
  let best: UatPerDiemRateRow | null = null;
  for (const r of rows) {
    if (r.staffId !== staffId) continue;
    // Strict `>` keeps the first of an exact-date tie, which the table's own
    // UNIQUE (StaffId, EffectiveDate) makes unreachable anyway.
    if (!best || r.effectiveDate > best.effectiveDate) best = r;
  }
  return best ? { amount: best.amount, effectiveDate: best.effectiveDate } : null;
}

/** Refusals are Thai and name the problem, so a constraint name never reaches an admin. */
export class UatPerDiemInputError extends Error {}

/**
 * Validate one posted rate, **before** any `Number()` coercion reaches the
 * database.
 *
 * `Number(null)`, `Number("")`, `Number(" ")`, `Number([])` and `Number(false)`
 * are all a finite **0**, which the `CHECK` would then reject with
 * `CK_UatTesterPerDiem_Amount` — a message no admin can act on. More
 * importantly, this is the layer that exists whether or not the constraint does.
 *
 * The date is checked for shape *and* for being a real calendar day: the regex
 * alone admits `2026-02-30`, which `sql.Date` turns into a driver error rather
 * than the Thai refusal beside the field.
 *
 * The note is bounded the same way — `ApiKey.Name` (`nvarchar(200)`) taught
 * this codebase that an over-long value otherwise reaches the admin as SQL
 * Server's own untranslated truncation error, since the duplicate-code path is
 * the only one here that used to translate a driver error.
 */
export function parseUatPerDiemInput(raw: {
  staffId: unknown;
  effectiveDate: unknown;
  amount: unknown;
  note?: unknown;
}): { staffId: number; effectiveDate: string; amount: number; note: string | null } {
  const staffId = typeof raw.staffId === "number" ? raw.staffId : Number(raw.staffId);
  if (!Number.isInteger(staffId) || staffId <= 0) {
    throw new UatPerDiemInputError("ไม่พบผู้ทดสอบรายนี้");
  }

  const effectiveDate = typeof raw.effectiveDate === "string" ? raw.effectiveDate.trim() : "";
  if (!isCalendarDate(effectiveDate)) {
    throw new UatPerDiemInputError("กรุณาเลือกวันที่เริ่มมีผล");
  }

  const amount =
    typeof raw.amount === "number" ? raw.amount : Number(String(raw.amount ?? "").trim());
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new UatPerDiemInputError("จำนวนเงินต่อวันต้องมากกว่า 0");
  }

  const note = typeof raw.note === "string" && raw.note.trim() ? raw.note.trim() : null;
  if (note !== null && note.length > UAT_PER_DIEM_NOTE_MAX) {
    throw new UatPerDiemInputError(`หมายเหตุยาวเกิน ${UAT_PER_DIEM_NOTE_MAX} ตัวอักษร`);
  }
  return { staffId, effectiveDate, amount, note };
}

/** 'YYYY-MM-DD' AND a day that exists. Local getters, never toISOString. */
function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const probe = new Date(y, m - 1, d);
  return probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d;
}
