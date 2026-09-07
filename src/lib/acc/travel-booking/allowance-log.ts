import { sql } from "@/lib/db/mssql";
import { getHrPool } from "@/lib/hr/pool";
import type { AllowanceLogEntry } from "@/lib/acc/travel-booking/perdiem";
import { uatPerDiemLogsByStaffIds } from "@/lib/uat-tester/per-diem";
import {
  chooseSubjectLog,
  perDiemLogSubjectKey,
  type PerDiemEmployeeLogResult,
  type PerDiemLogSource,
  type PerDiemLogSubject,
} from "@/lib/acc/travel-booking/allowance-log-rule";

// Re-exported so no consumer's import path changes: these lived here before
// the override-wins decision moved into the pure, import-free
// `allowance-log-rule.ts` (see that file for why it had to move).
export {
  perDiemLogSubjectKey,
  type PerDiemEmployeeLogResult,
  type PerDiemLogSource,
  type PerDiemLogSubject,
};

/**
 * Effective-dated per-diem allowance history for one employee
 * (Rocks_Portal_HR.dbo.EmployeeAllowanceLog), keyed by Employee.Id (uniqueidentifier).
 * Feeds `computePerDiem` (see `src/lib/acc/travel-booking/perdiem.ts`).
 */
export async function getAllowanceLog(employeeId: string): Promise<AllowanceLogEntry[]> {
  const pool = await getHrPool();
  const r = await pool.request()
    .input("id", sql.UniqueIdentifier, employeeId)
    .query(`
      SELECT EffectiveDate, Amount
      FROM [dbo].[EmployeeAllowanceLog]
      WHERE EmployeeId = @id
      ORDER BY EffectiveDate
    `);
  return r.recordset.map((x: Record<string, unknown>) => ({
    effectiveDate: toDateKey(x.EffectiveDate as Date),
    amount: Number(x.Amount),
  }));
}

/** Format a local Date back to a 'YYYY-MM-DD' string using local getters (never toISOString — server is Thai time). */
function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The same decision for many people at once — one batched `Fast_Core` query
 * covering every UAT subject at once (not one query per subject) and one HR
 * query per distinct employee, never a lookup per row. The report calls this;
 * routing it through the single-subject version would be N+1.
 *
 * **The single decision point** is `chooseSubjectLog` (`allowance-log-rule.ts`,
 * pure and unit-tested with no database): a subject answered by the UAT
 * override gets `source: "uat"`; every other subject — including one with no
 * employee id at all, whose log is `[]` — gets `source: "hr"`.
 * `getPerDiemEmployeeLogWithSource` delegates to this function rather than
 * re-deciding, so the override-wins rule is made exactly once.
 */
export async function getPerDiemEmployeeLogMap(
  subjects: readonly PerDiemLogSubject[],
): Promise<Map<string, PerDiemEmployeeLogResult>> {
  const out = new Map<string, PerDiemEmployeeLogResult>();
  if (subjects.length === 0) return out;

  const uatStaffIds: number[] = [];
  for (const s of subjects) {
    if (s.uat && typeof s.staffId === "number") uatStaffIds.push(s.staffId);
  }
  const overrides = await uatPerDiemLogsByStaffIds(uatStaffIds);

  // Only the subjects the override did not answer reach HR, and each distinct
  // employee is read once.
  const needHr = new Set<string>();
  for (const s of subjects) {
    const hasOverride = s.uat && typeof s.staffId === "number" && overrides.has(s.staffId);
    if (!hasOverride && s.employeeId) needHr.add(s.employeeId);
  }
  const hrLogs = new Map<string, AllowanceLogEntry[]>();
  await Promise.all(
    Array.from(needHr).map(async (employeeId) => {
      hrLogs.set(employeeId, await getAllowanceLog(employeeId));
    }),
  );

  for (const s of subjects) {
    const key = perDiemLogSubjectKey(s);
    if (out.has(key)) continue;
    out.set(key, chooseSubjectLog(s, overrides, hrLogs));
  }
  return out;
}

/**
 * One subject's resolved log and which log answered it — the single-subject
 * convenience over `getPerDiemEmployeeLogMap`, which is where the override-wins
 * decision is actually made. This never re-decides it; it builds the one-element
 * subject list, calls the map, and reads back its own key.
 */
export async function getPerDiemEmployeeLogWithSource(
  employeeId: string | null,
  staffId: number | null,
  uat: boolean,
): Promise<PerDiemEmployeeLogResult> {
  const subject: PerDiemLogSubject = { employeeId, staffId, uat };
  const map = await getPerDiemEmployeeLogMap([subject]);
  return map.get(perDiemLogSubjectKey(subject)) ?? { log: [], source: "hr" };
}

/**
 * The per-diem employee log for one person — the single-subject entry point
 * every non-batch caller uses. The decision that substitutes a UAT tester's
 * own rate for their real HR allowance is made once, in
 * `getPerDiemEmployeeLogMap`; this delegates to it through
 * `getPerDiemEmployeeLogWithSource` rather than re-deciding.
 *
 * Every consumer that prices an AP-17 trip calls this or its batched twin, and
 * `perdiem-source-guard.test.ts` asserts that lexically, because the failure is
 * a *missing* call that no behavioural test of the four would notice.
 *
 * A null `staffId` falls back to HR — `AccRequest.StaffId` is nullable
 * (`059_portal_form_baseline.sql:231`), and "no id" is the same answer as "no
 * rate set", which is the fail-safe direction.
 */
export async function getPerDiemEmployeeLog(
  employeeId: string | null,
  staffId: number | null,
  uat: boolean,
): Promise<AllowanceLogEntry[]> {
  const { log } = await getPerDiemEmployeeLogWithSource(employeeId, staffId, uat);
  return log;
}
