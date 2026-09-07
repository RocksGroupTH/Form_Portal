import type { AllowanceLogEntry } from "@/lib/acc/travel-booking/perdiem";

/**
 * A UAT tester's own per-diem rate log — the pure half of `UatTesterPerDiem`
 * (`Rocks_Portal_Form_UAT`, migrations 139/141 — this file never opens a pool
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
  isActive: boolean;
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
 * The result is a fresh, sorted array: the report hands one row set to many
 * trips, and sorting the caller's array in place would reorder somebody else's.
 */
export function uatPerDiemLogFrom(
  rows: readonly UatPerDiemRateRow[],
): AllowanceLogEntry[] | null {
  const mine: AllowanceLogEntry[] = [];
  for (const r of rows) {
    if (!r.isActive) continue;
    mine.push({ effectiveDate: r.effectiveDate, amount: r.amount });
  }
  if (mine.length === 0) return null;

  mine.sort((a, b) =>
    a.effectiveDate < b.effectiveDate ? -1 : a.effectiveDate > b.effectiveDate ? 1 : 0,
  );
  return mine;
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
