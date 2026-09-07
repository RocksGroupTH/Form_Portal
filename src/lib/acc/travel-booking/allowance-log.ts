import { sql } from "@/lib/db/mssql";
import { getHrPool } from "@/lib/hr/pool";
import type { AllowanceLogEntry } from "@/lib/acc/travel-booking/perdiem";
import { uatPerDiemLogsByStaffIds } from "@/lib/uat-tester/per-diem";

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
 * Who a per-diem log is being loaded for, and whether this is a UAT record.
 *
 * `uat` is a PARAMETER, never resolved inside this module. `allowance-log.ts` is
 * reached from inside a `getAccPool()` transaction, so a static import of
 * `@/lib/form-environment` here would be the very loop `getFormPool` dynamically
 * imports the resolver to break — and the recompute could not use that resolver
 * anyway (see `perdiem-uat-gate.ts`).
 */
export interface PerDiemLogSubject {
  employeeId: string | null;
  staffId: number | null;
  uat: boolean;
}

export function perDiemLogSubjectKey(s: PerDiemLogSubject): string {
  return `${s.uat ? "u" : "p"}:${s.staffId ?? ""}:${s.employeeId ?? ""}`;
}

/** Which log answered a subject — `"uat"` for a tester's own configured rate, `"hr"` otherwise. */
export type PerDiemLogSource = "hr" | "uat";

/** A subject's resolved log, plus which log it came from. */
export interface PerDiemEmployeeLogResult {
  log: AllowanceLogEntry[];
  source: PerDiemLogSource;
}

/**
 * The same decision for many people at once — one Fast_Core query for every UAT
 * subject and one HR query per distinct employee, never a lookup per row. The
 * report calls this; routing it through the single-subject version would be N+1.
 *
 * **The single decision point.** A subject answered by the UAT override gets
 * `source: "uat"`; every other subject — including one with no employee id at
 * all, whose log is `[]` — gets `source: "hr"`. `getPerDiemEmployeeLogWithSource`
 * delegates to this rather than re-deciding, so the override-wins rule is made
 * exactly once.
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
    const override =
      s.uat && typeof s.staffId === "number" ? overrides.get(s.staffId) : undefined;
    if (override !== undefined) {
      out.set(key, { log: override, source: "uat" });
    } else {
      out.set(key, { log: s.employeeId ? (hrLogs.get(s.employeeId) ?? []) : [], source: "hr" });
    }
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
